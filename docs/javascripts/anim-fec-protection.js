// @ts-check
/* ===========================================================================
 * anim-fec-protection.js: slug "fec-protection" (ch10, plan N6)
 * ---------------------------------------------------------------------------
 * What US 5,870,405's unequal error protection buys, drawn three ways:
 *
 *   - the chance that each priority vector arrives wrong against the bit
 *     error rate, for errors that fall independently: Golay (23,12) on u0
 *     to u3, Hamming (15,11) on u4 to u6, nothing on u7, or no code at all;
 *   - the same chance for each of the eight vectors at the chosen rate, as
 *     bars on the same log scale;
 *   - one frame on the air taking a burst of adjacent errors, and where the
 *     errors land in the codewords, in the order sent or through an
 *     interleaver invented for the figure (lib/fec.js), with the
 *     corrections the decoder counts and an illustrative threshold for a
 *     frame repeat.
 *
 * Its 3D view (anim-fec-protection-3d.js, head-on, owner decision O2)
 * draws the curves, bars and cells in three.js and plays the burst: the
 * errors arrive in transmitted order, then each slides to its codeword's
 * row; a codeword with more errors than its code corrects turns to the
 * highlight. This canvas is the view under reduced motion and without
 * WebGL 2, at the burst's end state, and the 3D view draws its text from it.
 *
 * Mount point: <div data-anim="fec-protection" markdown="1"> with the
 * poster and the steps inside; the live figure goes after the poster.
 *
 * Data read: none. Everything is computed by lib/fec.js from the code
 * parameters US 5,870,405 states. No decoding, no generator matrices, no
 * measured bits: the cells mark positions, not bit values.
 *
 * Steps (data-* on each <li>): code ("none" or "patent"), interleave ("on"
 * or "off"), burst (bits), start (first errored position), ber (percent).
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  clearCanvas,
  crisp,
  getTheme,
  markEnhanced,
  onThemeChange,
  prefersReducedMotion,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import {
  FRAME_BITS,
  VECTORS,
  burstResult,
  chipText,
  cosetMean,
  errorsText,
  failCurve,
  failProb,
  groupCode,
  vectorCode,
} from "./lib/fec.js";
import { createViewSwitch } from "./lib/view-switch.js";

/** @typedef {import("./anim-core.js").Theme} Theme */
/** @typedef {import("./lib/fec.js").CodeMode} CodeMode */
/** @typedef {import("./lib/fec.js").BurstResult} BurstResult */

/** What a step may set (data-* on its <li>). */
const STEP_KEYS = /** @type {const} */ (["code", "interleave", "burst", "start", "ber", "view"]);

/** The bit error rate axis: 0 to 10%. The failure axis: 10^-5 to 1, log. */
export const BER_MAX = 0.1;
export const LOG_FLOOR = -5;
/** Burst lengths the slider offers. */
const BURST_MAX = 24;
/** The threshold slider: corrections counted in u1 to u6 (at most 12). */
const THRESHOLD_MAX = 12;
/** Each group's colour token: u0 to u3, u4 to u6, u7. */
export const GROUP_TOKENS = ["--ambe-cat-1", "--ambe-cat-2", "--ambe-cat-3"];
/** How far a cell's colour goes toward the plot background: payload, check bits. */
export const CELL_MIX = { payload: 0.45, check: 0.78, air: 0.5 };
/** The longest codeword, and the most cells a row is laid out for. */
const ROW_CELLS = 23;

/**
 * @typedef {Object} State
 * @property {CodeMode} mode
 * @property {boolean} interleave
 * @property {number} burst  burst length, bits
 * @property {number} start  first errored position on the air
 * @property {number} ber  bit error rate, 0 to BER_MAX
 * @property {number} threshold  corrections in u1 to u6 that repeat a frame
 */

/** @typedef {{x: number, y: number, w: number, h: number}} Rect */
/** @typedef {{width: number, height: number}} Size */

/**
 * @typedef {Object} Layout
 * @property {number} W
 * @property {number} H  the height this width needs
 * @property {number} pad
 * @property {boolean} wide  the bars sit beside the curves
 * @property {Rect} curves  the curve plot's area
 * @property {Rect} bars  the bars' area (same log scale)
 * @property {number} burstTop  the burst band's title line
 * @property {Rect} air  the 144 positions on the air
 * @property {number} pitch  CSS px per position on the air
 * @property {{x: number, y: number, cellsX: number, statusX: number, w: number}[]} rows
 *           per vector: its row's left edge, top, first cell and status text
 * @property {number} cell  a row cell's side
 * @property {number} rowPitch  a row cell's pitch, across
 * @property {number} rowH
 * @property {Rect} meter  the corrections meter's track
 * @property {number} labelSize  font size of the small labels
 */

/**
 * What the 3D part is handed (lib/view-switch.js `state`). It computes
 * nothing: the result, the geometry, the colours' recipe and the backing
 * all come from here.
 * @typedef {Object} FecView
 * @property {State} state
 * @property {BurstResult} result
 * @property {"intro" | "step" | "input"} pace  what changed the burst last
 * @property {number} burstKey  changes whenever the burst does
 * @property {string} label  the canvas sentence
 * @property {string} chip  the subject's chip
 * @property {(size: Size) => Geometry} geometry  every mark, CSS px of a
 *           frame this size
 * @property {(ctx: CanvasRenderingContext2D, size: Size, landed: boolean) => void} backing
 *           the text, axes and tints the 2D view draws, on transparent;
 *           landed: false leaves out what the burst decides
 * @property {(kind: "down" | "move" | "up", x: number, y: number) => void} pointer
 *           a press or drag at a point of the frame (CSS px)
 * @property {{groups: string[], mix: typeof CELL_MIX, dash: number[][]}} look
 *           each group's token, how far cells go toward the plot
 *           background, and each curve's dash (CSS px)
 */

/**
 * @typedef {Object} Geometry
 * @property {Layout} layout
 * @property {{group: number, points: number[][]}[]} curves  [x, y] in px
 * @property {{x: number, top: number, bottom: number, text: string}} marker  the bit error rate
 * @property {{v: number, x: number, w: number, top: number, bottom: number, P: number}[]} bars
 * @property {{rect: Rect, v: number, check: boolean, hit: boolean}[]} air
 *           one per position sent
 * @property {{rect: Rect, v: number, j: number, check: boolean, hit: boolean}[]} cells
 *           every vector's cells, u0 first
 * @property {{from: Rect, to: Rect, v: number}[]} errors  in transmitted order
 * @property {Rect[]} randomRows  the cells of rows a wrong key left random
 * @property {number[][]} hatch  their hatching, [x0, y0, x1, y1] each
 * @property {Rect} subjectBar  around the subject's bar
 * @property {Rect} subjectRow  around the subject's row
 */

/* ---------------------------------------------------------------------------
 * Markup
 * ------------------------------------------------------------------------ */

/** @param {Element} host */
function buildMarkup(host) {
  const figure = document.createElement("figure");
  figure.className = "anim-figure";
  figure.innerHTML = `
    <div class="anim-figure__head">
      <p class="anim-figure__title">Golay and Hamming error correction with bit interleaving</p>
      <p class="anim-figure__subtitle">US 5,870,405's protection, with an interleaver invented for the figure</p>
    </div>

    <div class="anim-figure__frame">
      <canvas class="anim-figure__canvas" role="img" tabindex="0"
              aria-label="Failure curves of the three codes, the eight vectors at one bit error rate, and one frame taking a burst of errors."></canvas>
    </div>

    <p class="fec-status" role="status" aria-live="polite" data-ref="status"></p>

    <ul class="anim-legend">
      <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line fec-swatch--g0"></i><span data-legend="0"></span></li>
      <li class="anim-legend__item"><i class="anim-legend__swatch fec-swatch--dashed fec-swatch--g1"></i><span data-legend="1"></span></li>
      <li class="anim-legend__item"><i class="anim-legend__swatch fec-swatch--dotted fec-swatch--g2"></i><span data-legend="2"></span></li>
      <li class="anim-legend__item"><i class="anim-legend__swatch fec-swatch--error"></i>an error (solid ink cell)</li>
      <li class="anim-legend__item" data-legend="check"><i class="anim-legend__swatch fec-swatch--check"></i>check bits (paler)</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch fec-swatch--subject"></i>the codeword with the most errors (outlined)</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch fec-swatch--fails"></i>more errors than its code corrects (tinted)</li>
    </ul>

    <div class="anim-controls">
      <div class="anim-toggle-group" role="group" aria-label="Error correction">
        <button class="anim-btn" type="button" data-code="none" aria-pressed="false">No code</button>
        <button class="anim-btn" type="button" data-code="patent" aria-pressed="true">The patent's codes</button>
      </div>
      <label class="anim-field fec-check">
        <input class="anim-check" type="checkbox" data-ref="interleave" checked>
        <span class="anim-field__label">Interleave</span>
      </label>
      <span class="fec-pair">
        <label class="anim-field">
          <span class="anim-field__label">Burst</span>
          <input class="anim-range" type="range" min="0" max="${BURST_MAX}" step="1" value="7"
                 data-ref="burst" aria-label="Burst length, bits">
        </label>
        <output class="anim-readout" data-ref="burstOut">7 bits</output>
      </span>
      <label class="anim-field">
        <span class="anim-field__label">From bit</span>
        <input class="anim-range" type="range" min="0" max="143" step="1" value="57"
               data-ref="start" aria-label="First bit of the burst">
      </label>
      <span class="fec-pair">
        <label class="anim-field">
          <span class="anim-field__label">Bit errors</span>
          <input class="anim-range" type="range" min="1" max="100" step="1" value="50"
                 data-ref="ber" aria-label="Bit error rate, in tenths of a percent">
        </label>
        <output class="anim-readout" data-ref="berOut">5.0%</output>
      </span>
      <span class="fec-pair">
        <label class="anim-field">
          <span class="anim-field__label">Threshold</span>
          <input class="anim-range" type="range" min="1" max="${THRESHOLD_MAX}" step="1" value="6"
                 data-ref="threshold" aria-label="Corrections in u1 to u6 that repeat the frame (illustrative)">
        </label>
        <output class="anim-readout" data-ref="thresholdOut">6</output>
      </span>
      <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
    </div>

    <div class="anim-figure__step"></div>

    <p class="anim-figure__hint">Shown at the end of the burst because your
      system asks for reduced motion. Every control still works.</p>
    <p class="anim-figure__hint anim-figure__hint--webgl" hidden>${NO_WEBGL_HINT}</p>

    <figcaption class="anim-figure__caption">
      Top: the chance that a vector arrives wrong when each bit is wrong
      with the chosen probability, independently. Golay (23,12) corrects
      three errors in 23 bits, Hamming (15,11) one in 15, and a bare vector
      none. Bottom: one frame takes a burst of errors in the order it was
      sent, and each error lands in its codeword. The interleaver is invented
      for the figure with the patent's minimum separation of 6; D-STAR's own
      pattern is not published, and the threshold is illustrative. The
      cells mark positions, not bit values.
      <span class="anim-figure__source">Source: codes, assignment, minimum
        separation and error counting from US 5,870,405 (expired); the
        curves are binomial sums, and the counts on a random word come from
        the perfect codes' coset weights.</span>
      <span data-ref="badge"></span>
    </figcaption>
  `;
  host.append(figure);
  $(figure, '[data-ref="badge"]', HTMLElement).append(badge("illustrative"));
  /** @param {string} ref */
  const input = (ref) => $(figure, `[data-ref="${ref}"]`, HTMLInputElement);
  /** @param {string} ref */
  const out = (ref) => $(figure, `[data-ref="${ref}"]`, HTMLOutputElement);
  return {
    figure,
    frame: $(figure, ".anim-figure__frame", HTMLElement),
    canvas: $(figure, ".anim-figure__canvas", HTMLCanvasElement),
    status: $(figure, '[data-ref="status"]', HTMLElement),
    codes: /** @type {HTMLButtonElement[]} */ (Array.from(figure.querySelectorAll("[data-code]"))),
    interleave: input("interleave"),
    burst: input("burst"),
    start: input("start"),
    ber: input("ber"),
    threshold: input("threshold"),
    burstOut: out("burstOut"),
    berOut: out("berOut"),
    thresholdOut: out("thresholdOut"),
    toggle: $(figure, 'button[data-view="3d"]', HTMLButtonElement),
    hint: $(figure, ".anim-figure__hint--webgl", HTMLElement),
    legend: /** @type {HTMLElement[]} */ (Array.from(figure.querySelectorAll("[data-legend]"))),
  };
}

/** @typedef {ReturnType<typeof buildMarkup>} Refs */

/* ---------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------ */

/** Bars beside the curves from this width; rows in two columns from the next. */
const WIDE = 560;
const TWO_COLUMNS = 780;

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * The layout for a frame `size.width` wide. It depends on the width only,
 * so the frame's aspect can be set from it (naturalHeight).
 * @param {Size} size
 * @returns {Layout}
 */
export function computeLayout(size) {
  const W = size.width;
  const wide = W >= WIDE;
  const pad = W < 420 ? 10 : 14;
  // Never under 10 CSS px; a phone gets 11, its rows and axes being the
  // ones read closest.
  const labelSize = W < 420 ? 11 : 10;

  // The curves, and beside them (wide) or under them, the bars.
  const plotH = wide ? clamp(Math.round(W * 0.26), 150, 230) : clamp(Math.round(W * 0.5), 140, 210);
  const left = pad + (W < 420 ? 40 : 46);
  const top = pad + 20;
  const right = wide ? pad + Math.round((W - 3 * pad) * 0.6) : W - pad - 6;
  const curves = { x: left, y: top, w: right - left, h: plotH };
  const bars = wide
    ? { x: right + pad + 10, y: top, w: W - pad - (right + pad + 10), h: plotH }
    : { x: left, y: top + plotH + 40 + 22, w: W - pad - 6 - left, h: Math.round(plotH * 0.7) };
  const bandEnd = (wide ? curves.y + curves.h : bars.y + bars.h) + (wide ? 38 : 22);

  // The burst: the air, then the codeword rows (two columns when wide).
  const burstTop = bandEnd + 12;
  const airH = W < 420 ? 11 : 14;
  const air = { x: pad, y: burstTop + 20, w: W - 2 * pad, h: airH };
  const pitch = air.w / FRAME_BITS.patent;
  const twoCols = W >= TWO_COLUMNS;
  const cols = twoCols ? 2 : 1;
  const colW = (W - (cols + 1) * pad) / cols;
  const labelW = W < 420 ? 24 : 76;
  const statusW = W < 420 ? 116 : 136;
  const rowPitch = clamp(Math.floor((colW - labelW - statusW) / ROW_CELLS), 6, 14);
  const cell = rowPitch - (rowPitch > 8 ? 2 : 1);
  const rowH = cell + 7;
  // On a phone the chip gets a band of its own between the air's labels
  // and the rows, clear of "bit 0" and the burst's bracket.
  const rowsTop = air.y + airH + 46 + (W < 480 ? 22 : 0);
  const rows = VECTORS.map((_, v) => {
    const col = twoCols ? Math.floor(v / 4) : 0;
    const line = twoCols ? v % 4 : v;
    const x = pad + col * (colW + pad);
    const cellsX = x + labelW;
    return { x, y: rowsTop + line * rowH, cellsX, statusX: cellsX + ROW_CELLS * rowPitch + 8, w: colW };
  });
  const rowsEnd = rowsTop + (twoCols ? 4 : 8) * rowH;
  const meterLeft = pad + (W < 420 ? 0 : labelW);
  const meter = { x: meterLeft, y: rowsEnd + 26, w: clamp(W - pad - meterLeft - (W < 420 ? 0 : 190), 120, 420), h: 9 };
  const H = Math.ceil(meter.y + meter.h + 24 + pad);
  return { W, H, pad, wide, curves, bars, burstTop, air, pitch, rows, cell, rowPitch, rowH, meter, labelSize };
}

/**
 * The height the figure needs at a width.
 * @param {number} W
 */
export function naturalHeight(W) {
  return computeLayout({ width: W, height: 0 }).H;
}

/** x of a bit error rate in the curve plot. @param {Layout} L @param {number} p */
export const berX = (L, p) => L.curves.x + (L.curves.w * p) / BER_MAX;

/**
 * y of a failure chance in a plot area (log, 10^-5 at the bottom, 1 at the top).
 * @param {Rect} area
 * @param {number} P
 */
export function chanceY(area, P) {
  const lg = Math.log10(Math.max(P, 10 ** LOG_FLOOR));
  return area.y + (area.h * -lg) / -LOG_FLOOR;
}

/**
 * Each group's failure curve, in px.
 * @param {Layout} L
 * @param {CodeMode} mode
 * @returns {{group: number, points: number[][]}[]}
 */
export function curvePoints(L, mode) {
  return [0, 1, 2].map((group) => ({
    group,
    points: failCurve(groupCode(group, mode), BER_MAX, 10 ** LOG_FLOOR)
      .map(([p, P]) => [berX(L, p), chanceY(L.curves, P)]),
  }));
}

/**
 * The bar of vector v at bit error rate p: its column and its top.
 * @param {Layout} L
 * @param {CodeMode} mode
 * @param {number} v
 * @param {number} p
 */
export function barRect(L, mode, v, p) {
  const col = L.bars.w / 8;
  const w = Math.max(4, Math.round(col * 0.56));
  const x = L.bars.x + col * (v + 0.5) - w / 2;
  const { n, t } = vectorCode(v, mode);
  const P = failProb(n, t, p);
  const bottom = L.bars.y + L.bars.h;
  return { v, x, w, top: P < 10 ** LOG_FLOOR ? bottom : chanceY(L.bars, P), bottom, P };
}

/** Position i on the air. @param {Layout} L @param {number} i @returns {Rect} */
export function airRect(L, i) {
  const gap = L.pitch > 4 ? 1 : 0.5;
  return { x: L.air.x + i * L.pitch, y: L.air.y, w: L.pitch - gap, h: L.air.h };
}

/** Bit j of vector v's row. @param {Layout} L @param {number} v @param {number} j @returns {Rect} */
export function cellRect(L, v, j) {
  const row = L.rows[v];
  return { x: row.cellsX + j * L.rowPitch, y: row.y, w: L.cell, h: L.cell };
}

/**
 * Every mark the 3D view draws, from the state and the burst's result.
 * @param {Layout} L
 * @param {State} state
 * @param {BurstResult} r
 * @returns {Geometry}
 */
export function geometry(L, state, r) {
  const hits = new Set(r.errors.map((e) => e.pos));
  const hitBits = new Set(r.errors.map((e) => `${e.v}:${e.j}`));
  const cells = [];
  for (let v = 0; v < 8; v += 1) {
    const code = vectorCode(v, state.mode);
    for (let j = 0; j < code.n; j += 1) {
      cells.push({ rect: cellRect(L, v, j), v, j, check: j >= code.k, hit: hitBits.has(`${v}:${j}`) });
    }
  }
  const bars = VECTORS.map((_, v) => barRect(L, state.mode, v, state.ber));
  const sb = bars[r.subject];
  const row = L.rows[r.subject];
  const n = vectorCode(r.subject, state.mode).n;
  const randomRows = r.vectors.flatMap((x, v) => (x.random ? [{ x: L.rows[v].cellsX - 2, y: L.rows[v].y - 2, w: x.code.n * L.rowPitch + 2, h: L.cell + 4 }] : []));
  return {
    layout: L,
    curves: curvePoints(L, state.mode),
    marker: { x: berX(L, state.ber), top: L.curves.y, bottom: L.curves.y + L.curves.h, text: berText(state.ber) },
    bars,
    air: r.order.map((slot, i) => ({ rect: airRect(L, i), v: slot.v, check: slot.j >= vectorCode(slot.v, state.mode).k, hit: hits.has(i) })),
    cells,
    errors: r.errors.map((e) => ({ from: airRect(L, e.pos), to: cellRect(L, e.v, e.j), v: e.v })),
    randomRows,
    hatch: randomRows.flatMap((box) => hatchSegments(box)),
    subjectBar: { x: sb.x - 3, y: Math.min(sb.top, sb.bottom - 2) - 3, w: sb.w + 6, h: sb.bottom - Math.min(sb.top, sb.bottom - 2) + 6 },
    subjectRow: { x: row.x - 4, y: row.y - 4, w: row.cellsX - row.x + n * L.rowPitch + 6, h: L.cell + 8 },
  };
}

/* ---------------------------------------------------------------------------
 * Text
 * ------------------------------------------------------------------------ */

/** The bit error rate as the marker and the bars' title give it: "5.0%". @param {number} p */
export const berText = (p) => `${(p * 100).toFixed(1)}%`;

/** "5.0%", "0.26%", "0.0076%". @param {number} P */
export function percent(P) {
  if (P >= 0.1) return `${(P * 100).toFixed(0)}%`;
  if (P >= 0.01) return `${(P * 100).toFixed(1)}%`;
  if (P >= 1e-5) return `${Number((P * 100).toPrecision(2))}%`;
  return "under 0.001%";
}

/** The legend's line for a group under a mode. @param {number} group @param {CodeMode} mode */
export function groupLabel(group, mode) {
  const who = ["u₀ to u₃", "u₄ to u₆", "u₇"][group];
  const style = ["solid", "dashed", "dotted"][group];
  const code = groupCode(group, mode);
  if (code.t === 0) return `${who}: ${code.n} bits, no code (${style})`;
  return `${who}: ${code.name}, corrects ${code.t} (${style})`;
}

/**
 * A row's status: what the burst did to the vector.
 * @param {BurstResult} r
 * @param {number} v
 */
export function rowStatus(r, v) {
  const x = r.vectors[v];
  if (x.random) return "wrong key: random word";
  if (x.e === 0) return "no errors";
  if (x.code.t === 0) return `${errorsText(x.e)}: wrong`;
  if (x.fails) return v === 0 && r.wrongKey ? `${errorsText(x.e)}: fails, wrong key` : `${errorsText(x.e)}: fails`;
  return `${errorsText(x.e)}: corrected`;
}

/**
 * The verdict on the corrections counted in u1 to u6.
 * @param {BurstResult} r
 * @param {number} threshold
 */
export function meterText(r, threshold) {
  if (r.mode === "none") return "With no code there is nothing for the decoder to count, so every frame is used";
  const n = r.counted.toFixed(r.wrongKey ? 1 : 0);
  const over = r.counted > threshold;
  return `${n} of ${r.countedMax} corrections counted in u₁ to u₆: ${over ? "over" : "within"} the threshold of ${threshold}, so the frame is ${over ? "repeated" : "used"}`;
}

/**
 * The sentence both canvases carry, and the status line.
 * @param {State} state
 * @param {BurstResult} r
 */
function describeAll(state, r) {
  const p = state.ber;
  const at = [0, 1, 2].map((g) => {
    const code = groupCode(g, state.mode);
    return `${["u₀ to u₃", "u₄ to u₆", "u₇"][g]} ${percent(failProb(code.n, code.t, p))}`;
  }).join(", ");
  const coding = state.mode === "patent" ? "with the patent's codes" : "with no code";
  const burst = r.length
    ? `A burst of ${r.length} errors from bit ${r.start} of ${r.frameBits}, ${state.interleave ? "interleaved" : "sent in order"}: ${chipText(r)}${r.vectors[r.subject].fails ? ", so it fails" : ""}. `
    : `No burst on this frame of ${r.frameBits} bits. `;
  const fails = r.vectors.filter((x) => x.fails).length;
  const others = fails > (r.vectors[r.subject].fails ? 1 : 0) ? `${fails} vectors in all arrive wrong. ` : "";
  return {
    label: `Chance that a vector arrives wrong against the bit error rate, ${coding}. At ${(p * 100).toFixed(1)}% bit errors: ${at}. ${burst}${others}${meterText(r, state.threshold)}.`,
    status: `${burst}${others}${meterText(r, state.threshold)}.`,
  };
}

/* ---------------------------------------------------------------------------
 * Painting
 * ------------------------------------------------------------------------ */

/* Mix two CSS colours numerically: canvas fillStyle does not reliably take
   color-mix(). Token values are #rrggbb or rgb()/rgba(). */
/** @param {string} value @returns {number[]} */
function rgba(value) {
  const s = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return [128, 128, 128, 1];
}

/** `a` moved toward `b` by `t`, per sRGB channel. @param {string} a @param {string} b @param {number} t */
export function mixCss(a, b, t) {
  const x = rgba(a);
  const y = rgba(b);
  const c = (/** @type {number} */ i) => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** The dash of each group's curve, in CSS px: solid, dashed, dotted. */
export const GROUP_DASH = [[], [7, 4], [2, 3]];

/**
 * @typedef {Object} PaintOptions
 * @property {boolean} [marks=true]  false: only what the 3D view takes as
 *           its backing (text, axes, tints), on transparent
 * @property {boolean} [landed=true]  false: leave out the row statuses,
 *           tints and the meter's verdict (the burst is still in flight)
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Size} size
 * @param {State} state
 * @param {BurstResult} r
 * @param {PaintOptions} [opts]
 */
function paint(ctx, size, state, r, opts = {}) {
  const marks = opts.marks !== false;
  const landed = opts.landed !== false;
  const th = getTheme();
  const L = computeLayout(size);
  clearCanvas(ctx, size, marks ? th.plotBg : undefined);
  const G = geometry(L, state, r);
  const cat = GROUP_TOKENS.map((name) => th.css(name, th.series[0]));
  const highlight = th.css("--ambe-highlight", th.accentWarm);
  const fs = L.labelSize;

  ctx.save();
  ctx.textBaseline = "alphabetic";

  /* -- the curves ------------------------------------------------------- */
  const A = L.curves;
  ctx.font = `600 11px ${th.font}`;
  ctx.fillStyle = th.text2;
  ctx.textAlign = "left";
  ctx.fillText("Chance a vector arrives wrong", L.pad, L.pad + 10);
  drawLogAxis(ctx, th, A, fs, true);
  ctx.font = `${fs}px ${th.font}`;
  ctx.fillStyle = th.text3;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let k = 0; k <= 5; k += 1) {
    const p = (k * BER_MAX) / 5;
    const x = berX(L, p);
    ctx.fillText(`${Math.round(p * 100)}%`, x, A.y + A.h + 6);
  }
  ctx.fillText("bit error rate (errors falling independently)", A.x + A.w / 2, A.y + A.h + 20);
  ctx.strokeStyle = th.grid;
  ctx.beginPath();
  for (let k = 1; k <= 5; k += 1) {
    const x = crisp(berX(L, (k * BER_MAX) / 5));
    ctx.moveTo(x, A.y);
    ctx.lineTo(x, A.y + A.h);
  }
  ctx.stroke();

  if (marks) {
    for (const { group, points } of G.curves) {
      if (group === VECTORS[r.subject].group) continue;
      strokePath(ctx, points, cat[group], 1.75, GROUP_DASH[group]);
    }
    const own = G.curves[VECTORS[r.subject].group];
    strokePath(ctx, own.points, highlight, 3.25, []);
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(G.marker.x, G.marker.top);
    ctx.lineTo(G.marker.x, G.marker.bottom);
    ctx.stroke();
  }
  // At the foot of the marker, where the curves have long left the floor.
  // The 3D view puts it over its frosted fill as a label of its own.
  if (marks) {
    ctx.font = `600 ${fs}px ${th.font}`;
    ctx.fillStyle = th.ink;
    ctx.textBaseline = "bottom";
    ctx.textAlign = G.marker.x > A.x + A.w - 40 ? "right" : "left";
    ctx.fillText(berText(state.ber), G.marker.x + (ctx.textAlign === "right" ? -4 : 4), A.y + A.h - 3);
  }

  /* -- the bars ---------------------------------------------------------- */
  const B = L.bars;
  ctx.font = `600 11px ${th.font}`;
  ctx.fillStyle = th.text2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`Each vector at ${berText(state.ber)}`, B.x, B.y - 8);
  drawLogAxis(ctx, th, B, fs, !L.wide);
  ctx.font = `${fs}px ${th.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const bar of G.bars) {
    ctx.fillStyle = th.text3;
    ctx.fillText(VECTORS[bar.v].name, bar.x + bar.w / 2, B.y + B.h + 5);
    if (marks) {
      const colour = cat[VECTORS[bar.v].group];
      if (bar.bottom - bar.top > 0.5) {
        const fill = ctx.createLinearGradient(0, bar.top, 0, bar.bottom);
        fill.addColorStop(0, mixCss(colour, th.plotBg, 0.35));
        fill.addColorStop(1, mixCss(colour, th.plotBg, 0.9));
        ctx.fillStyle = fill;
        ctx.fillRect(bar.x, bar.top, bar.w, bar.bottom - bar.top);
      }
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(bar.x, bar.top);
      ctx.lineTo(bar.x + bar.w, bar.top);
      ctx.stroke();
    }
  }
  if (L.bars.w / 8 >= 30) {
    ctx.font = `${fs - 1}px ${th.font}`;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = th.text2;
    for (const bar of G.bars) {
      const text = bar.P < 1e-5 ? "<0.001%" : percent(bar.P);
      ctx.fillText(text, bar.x + bar.w / 2, Math.max(B.y + 10, bar.top - 3));
    }
  }

  /* -- the burst ---------------------------------------------------------- */
  ctx.font = `600 11px ${th.font}`;
  ctx.fillStyle = th.text2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const sent = state.mode === "patent" ? (L.W < 420 ? "144 bits" : "144 bits, 88 of them payload") : (L.W < 420 ? "88 bits" : "88 bits, no check bits");
  const order = state.interleave ? "interleaved" : L.W < 420 ? "in order" : "codewords in order";
  ctx.fillText(`One frame on the air: ${sent}, ${order}`, L.pad, L.burstTop + 10);

  // The 56 check bits a frame without codes leaves out.
  if (r.frameBits < FRAME_BITS.patent) {
    const a = airRect(L, r.frameBits);
    const z = airRect(L, FRAME_BITS.patent - 1);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = th.border;
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, z.x + z.w - a.x - 1, a.h - 1);
    ctx.restore();
    ctx.font = `${fs}px ${th.font}`;
    ctx.fillStyle = th.text4;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("not sent", (a.x + z.x + z.w) / 2, a.y + a.h / 2 + 0.5);
  }
  if (marks) {
    for (const a of G.air) {
      ctx.fillStyle = a.hit ? th.ink : mixCss(cat[VECTORS[a.v].group], th.plotBg, a.check ? CELL_MIX.check : CELL_MIX.air);
      ctx.fillRect(a.rect.x, a.rect.y, a.rect.w, a.rect.h);
    }
  }
  // The burst's extent, under the air.
  if (r.length) {
    const a = airRect(L, r.start);
    const z = airRect(L, r.start + r.length - 1);
    const y = L.air.y + L.air.h + 4;
    ctx.strokeStyle = th.text3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, y);
    ctx.lineTo(a.x, y + 4);
    ctx.lineTo(z.x + z.w, y + 4);
    ctx.lineTo(z.x + z.w, y);
    ctx.stroke();
  }
  ctx.font = `${fs}px ${th.font}`;
  ctx.fillStyle = th.text4;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("bit 0", L.air.x, L.air.y + L.air.h + 11);
  ctx.textAlign = "right";
  const last = airRect(L, r.frameBits - 1);
  ctx.fillText(`bit ${r.frameBits - 1}`, last.x + last.w, L.air.y + L.air.h + 11);

  // The codeword rows.
  for (let v = 0; v < 8; v += 1) {
    const row = L.rows[v];
    const x = r.vectors[v];
    const code = x.code;
    if (landed && x.fails) {
      ctx.fillStyle = th.css("--ambe-mismatch", th.hairline);
      roundRect(ctx, row.x - 4, row.y - 4, row.w + 4, L.cell + 8, 4);
      ctx.fill();
    }
    ctx.font = `600 ${fs}px ${th.font}`;
    ctx.fillStyle = th.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const mid = row.y + L.cell / 2 + 0.5;
    ctx.fillText(VECTORS[v].name, row.x, mid);
    ctx.font = `${fs}px ${th.font}`;
    ctx.fillStyle = th.text3;
    // On a phone the row holds the vector's name only; the legend names the codes.
    if (L.W >= 420) ctx.fillText(code.t ? code.short : "bare", row.x + 18, mid);
    if (landed) {
      ctx.fillStyle = x.fails || (x.e && !code.t) ? th.text : x.random ? th.text2 : th.text3;
      ctx.font = `${x.fails ? 600 : 400} ${fs}px ${th.font}`;
      ctx.fillText(rowStatus(r, v), row.cellsX + code.n * L.rowPitch + 8, mid);
    }
  }
  if (marks) {
    for (const c of G.cells) {
      const hit = landed && c.hit;
      ctx.fillStyle = hit ? th.ink : mixCss(cat[VECTORS[c.v].group], th.plotBg, c.check ? CELL_MIX.check : CELL_MIX.payload);
      roundRect(ctx, c.rect.x, c.rect.y, c.rect.w, c.rect.h, 1.5);
      ctx.fill();
    }
    // A wrong key leaves u1 to u6 random words: hatched.
    if (landed) {
      for (const box of G.randomRows) hatch(ctx, box, th.text3);
    }
    // The subject: its bar and its row, outlined in the highlight.
    if (landed) {
      ctx.strokeStyle = highlight;
      ctx.lineWidth = 2;
      for (const box of [G.subjectBar, G.subjectRow]) {
        roundRect(ctx, box.x, box.y, box.w, box.h, 3);
        ctx.stroke();
      }
    }
  }

  // The corrections meter, with the illustrative threshold.
  const M = L.meter;
  ctx.font = `${fs}px ${th.font}`;
  ctx.fillStyle = th.text2;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(L.W < 420 ? "Corrections counted in u₁ to u₆ (threshold illustrative)" : "Corrections the decoder counts in u₁ to u₆ (threshold illustrative)", M.x, M.y - 4);
  ctx.fillStyle = th.css("--ambe-surface-2", th.grid);
  roundRect(ctx, M.x, M.y, M.w, M.h, 3);
  ctx.fill();
  ctx.strokeStyle = th.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  const over = r.counted > state.threshold;
  if (landed && r.counted > 0) {
    ctx.fillStyle = over ? th.accentWarm : th.css("--ambe-cat-1", th.accent);
    roundRect(ctx, M.x, M.y, (M.w * r.counted) / THRESHOLD_MAX, M.h, 3);
    ctx.fill();
  }
  const tx = M.x + (M.w * state.threshold) / THRESHOLD_MAX;
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx, M.y - 3);
  ctx.lineTo(tx, M.y + M.h + 3);
  ctx.stroke();
  ctx.font = `${fs}px ${th.font}`;
  ctx.fillStyle = th.text3;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("0", M.x, M.y + M.h + 4);
  ctx.textAlign = "right";
  ctx.fillText(String(THRESHOLD_MAX), M.x + M.w, M.y + M.h + 4);
  if (landed) {
    ctx.textAlign = "left";
    ctx.fillStyle = over ? th.text : th.text3;
    ctx.font = `${over ? 600 : 400} ${fs}px ${th.font}`;
    const verdict = r.mode === "none" ? "no code: nothing counted" : `${r.counted.toFixed(r.wrongKey ? 1 : 0)} counted: frame ${over ? "repeated" : "used"}`;
    const vx = M.x + M.w + 8;
    if (vx + ctx.measureText(verdict).width < L.W - L.pad) {
      ctx.textBaseline = "middle";
      ctx.fillText(verdict, vx, M.y + M.h / 2);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(verdict, M.x + M.w / 2, M.y + M.h + 4);
    }
  }
  ctx.restore();
  return L;
}

/**
 * A log axis from 10^-5 to 1 at the left of `area`, with its grid.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Theme} th
 * @param {Rect} area
 * @param {number} fs
 * @param {boolean} labels
 */
function drawLogAxis(ctx, th, area, fs, labels) {
  ctx.save();
  ctx.strokeStyle = th.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k <= -LOG_FLOOR; k += 1) {
    const y = crisp(chanceY(area, 10 ** -k));
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
  }
  ctx.stroke();
  ctx.strokeStyle = th.axis;
  ctx.beginPath();
  ctx.moveTo(crisp(area.x), area.y);
  ctx.lineTo(crisp(area.x), area.y + area.h);
  ctx.lineTo(area.x + area.w, crisp(area.y + area.h));
  ctx.stroke();
  if (labels) {
    ctx.font = `${fs}px ${th.font}`;
    ctx.fillStyle = th.text3;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let k = 0; k <= -LOG_FLOOR; k += 1) {
      ctx.fillText(["100%", "10%", "1%", "0.1%", "0.01%", "0.001%"][k], area.x - 5, chanceY(area, 10 ** -k));
    }
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} points
 * @param {string} colour
 * @param {number} width
 * @param {number[]} dash
 */
function strokePath(ctx, points, colour, width, dash) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = dash.length ? "butt" : "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
}

/**
 * Diagonal hatching over a box (a random word, under a wrong key).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Rect} box
 * @param {string} colour
 */
function hatch(ctx, box, colour) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of hatchSegments(box)) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The hatch's lines across a box, 6 px apart, clipped to it.
 * @param {Rect} box
 * @returns {number[][]} [x0, y0, x1, y1] each
 */
export function hatchSegments(box) {
  const out = [];
  for (let x = box.x - box.h; x < box.x + box.w; x += 6) {
    // From (x, bottom) up to (x + h, top), clipped to the box's sides.
    let ax = x;
    let ay = box.y + box.h;
    let bx = x + box.h;
    let by = box.y;
    if (ax < box.x) {
      ay -= box.x - ax;
      ax = box.x;
    }
    if (bx > box.x + box.w) {
      by += bx - (box.x + box.w);
      bx = box.x + box.w;
    }
    if (bx > ax) out.push([ax, ay, bx, by]);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Mount
 * ------------------------------------------------------------------------ */

/**
 * @param {Element} host
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  // Read once: the list is moved into the figure, where these attributes
  // would match the controls' own selectors ([data-code]).
  for (const step of steps) for (const key of STEP_KEYS) step.item.removeAttribute(`data-${key}`);
  const refs = buildMarkup(host);
  markEnhanced(host);

  /** @type {State} */
  const state = { mode: "patent", interleave: true, burst: 7, start: 57, ber: 0.05, threshold: 6 };
  let result = burstResult({ mode: state.mode, interleave: state.interleave, start: state.start, length: state.burst });
  /** @type {"intro" | "step" | "input"} */
  let pace = "intro";
  let burstKey = 0;

  const fitFrame = () => {
    const width = refs.frame.clientWidth;
    if (width < 100) return;
    const aspect = `${width} / ${naturalHeight(width)}`;
    if (refs.frame.style.getPropertyValue("--anim-aspect") !== aspect) {
      refs.frame.style.setProperty("--anim-aspect", aspect);
    }
  };
  fitFrame();
  const framed = new ResizeObserver(fitFrame);
  framed.observe(refs.frame);

  const draw = () => {
    if (refs.canvas.hidden) return;
    paint(handle.ctx, handle, state, result);
  };
  const handle = setupCanvas(refs.canvas, { onResize: () => draw() });

  /** The frame's inner size, as setupCanvas() rounds the canvas. */
  const frameSize = () => {
    const r = refs.frame.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(r.width - refs.frame.clientLeft * 2)),
      height: Math.max(1, Math.round(r.height - refs.frame.clientTop * 2)),
    };
  };

  /* -- pointer: drag the bit error rate, the burst, the threshold ------- */

  /** @type {"ber" | "start" | "threshold" | null} */
  let dragging = null;
  /**
   * @param {"down" | "move" | "up"} kind
   * @param {number} x
   * @param {number} y
   */
  const pointer = (kind, x, y) => {
    const L = computeLayout(frameSize());
    if (kind === "up") {
      dragging = null;
      return;
    }
    if (kind === "down") {
      const A = L.curves;
      const M = L.meter;
      if (x >= A.x - 6 && x <= A.x + A.w + 6 && y >= A.y && y <= A.y + A.h) dragging = "ber";
      else if (y >= L.air.y - 10 && y <= L.air.y + L.air.h + 12 && x >= L.air.x - 4 && x <= L.air.x + L.air.w + 4) dragging = "start";
      else if (y >= M.y - 10 && y <= M.y + M.h + 10 && x >= M.x - 8 && x <= M.x + M.w + 8) dragging = "threshold";
      else dragging = null;
    }
    if (!dragging) return;
    if (dragging === "ber") {
      setBer(clamp(((x - L.curves.x) / L.curves.w) * BER_MAX, 0.001, BER_MAX));
    } else if (dragging === "start") {
      const at = Math.floor((x - L.air.x) / L.pitch);
      setBurst(state.burst, at - Math.floor(state.burst / 2), "input");
    } else {
      setThreshold(Math.round(((x - L.meter.x) / L.meter.w) * THRESHOLD_MAX));
    }
  };
  /** @param {PointerEvent} event */
  const onCanvasPointer = (event) => {
    const rect = refs.canvas.getBoundingClientRect();
    const kind = event.type === "pointerdown" ? "down" : event.type === "pointermove" ? "move" : "up";
    if (kind === "move" && !dragging) return;
    if (kind === "down") refs.canvas.setPointerCapture?.(event.pointerId);
    pointer(kind, event.clientX - rect.left, event.clientY - rect.top);
  };
  const opts = { signal };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    refs.canvas.addEventListener(type, /** @type {EventListener} */ (onCanvasPointer), opts);
  }

  /* -- the 3D view ------------------------------------------------------- */

  /** @type {FecView} */
  const view = {
    state: { ...state },
    result,
    pace,
    burstKey,
    label: "",
    chip: chipText(result),
    geometry: (size) => geometry(computeLayout(size), view.state, view.result),
    backing: (ctx, size, landed) => paint(ctx, size, view.state, view.result, { marks: false, landed }),
    pointer,
    look: { groups: GROUP_TOKENS, mix: CELL_MIX, dash: GROUP_DASH },
  };
  /** @returns {FecView} */
  const snapshot = () => Object.assign(view, {
    state: { ...state },
    result,
    pace,
    burstKey,
    label: describeAll(state, result).label,
    chip: chipText(result),
  });

  const views = createViewSwitch({
    frame: refs.frame,
    flat: refs.canvas,
    toggle: refs.toggle,
    hint: refs.hint,
    signal,
    state: snapshot,
    load: () => import("./anim-fec-protection-3d.js"),
    headOn: true,
    id: "fec-protection",
    onView: (now) => {
      refs.figure.dataset.view = now;
      if (now !== "3d") draw();
    },
  });

  /* -- labels and state ---------------------------------------------------- */

  let labelTimer = 0;
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      const { label } = describeAll(state, result);
      refs.canvas.setAttribute("aria-label", label);
      refs.frame.querySelector("canvas.anim-figure__canvas--3d")?.setAttribute("aria-label", label);
    }, 250);
  };

  const showControls = () => {
    for (const b of refs.codes) b.setAttribute("aria-pressed", String(b.dataset.code === state.mode));
    refs.interleave.checked = state.interleave;
    refs.burst.value = String(state.burst);
    refs.burstOut.value = `${state.burst} bit${state.burst === 1 ? "" : "s"}`;
    refs.start.max = String(result.frameBits - 1);
    refs.start.value = String(result.start);
    refs.ber.value = String(Math.round(state.ber * 1000));
    refs.berOut.value = `${(state.ber * 100).toFixed(1)}%`;
    refs.threshold.value = String(state.threshold);
    refs.thresholdOut.value = String(state.threshold);
    for (const item of refs.legend) {
      const g = item.dataset.legend;
      if (g === "check") item.hidden = state.mode !== "patent";
      else item.textContent = groupLabel(Number(g), state.mode);
    }
  };

  /** Everything after a change: the result, the text, both views. */
  const changed = () => {
    result = burstResult({ mode: state.mode, interleave: state.interleave, start: state.start, length: state.burst });
    // The start the burst actually took (clamped into the frame).
    state.start = result.start;
    showControls();
    refs.status.textContent = describeAll(state, result).status;
    relabel();
    draw();
    views.update(snapshot());
  };

  /**
   * @param {number} length
   * @param {number} start
   * @param {"step" | "input"} how
   */
  function setBurst(length, start, how) {
    const b = clamp(Math.round(length), 0, BURST_MAX);
    const s = Math.max(0, Math.round(start));
    if (b === state.burst && s === state.start) return;
    state.burst = b;
    state.start = s;
    pace = how;
    burstKey += 1;
    changed();
  }
  /** @param {number} p */
  function setBer(p) {
    state.ber = Math.round(clamp(p, 0.001, BER_MAX) * 1000) / 1000;
    changed();
  }
  /** @param {number} n */
  function setThreshold(n) {
    state.threshold = clamp(Math.round(n), 1, THRESHOLD_MAX);
    changed();
  }
  /** @param {CodeMode} mode @param {boolean} interleave @param {"step" | "input"} how */
  function setCoding(mode, interleave, how) {
    if (mode === state.mode && interleave === state.interleave) return;
    state.mode = mode;
    state.interleave = interleave;
    pace = how;
    burstKey += 1;
    changed();
  }

  for (const b of refs.codes) {
    b.addEventListener("click", () => setCoding(b.dataset.code === "none" ? "none" : "patent", state.interleave, "input"), opts);
  }
  refs.interleave.addEventListener("change", () => setCoding(state.mode, refs.interleave.checked, "input"), opts);
  refs.burst.addEventListener("input", () => setBurst(Number(refs.burst.value), state.start, "input"), opts);
  refs.start.addEventListener("input", () => setBurst(state.burst, Number(refs.start.value), "input"), opts);
  refs.ber.addEventListener("input", () => setBer(Number(refs.ber.value) / 1000), opts);
  refs.threshold.addEventListener("input", () => setThreshold(Number(refs.threshold.value)), opts);

  const offTheme = onThemeChange(() => draw());

  if (steps.length) {
    let first = true;
    createStepper(refs.figure, steps, (step) => {
      const mode = step.code === "none" ? "none" : step.code === "patent" ? "patent" : state.mode;
      const interleave = step.interleave === undefined ? state.interleave : step.interleave !== "off";
      const length = step.burst === undefined ? state.burst : Number(step.burst);
      const start = step.start === undefined ? state.start : Number(step.start);
      if (step.ber !== undefined) state.ber = clamp(Number(step.ber) / 100, 0.001, BER_MAX);
      state.mode = mode;
      state.interleave = interleave;
      state.burst = clamp(Math.round(length), 0, BURST_MAX);
      state.start = Math.max(0, Math.round(start));
      // The first step sets the opening state; the 3D view's first-view
      // burst plays it. Every later step replays the burst.
      if (!first) {
        pace = "step";
        burstKey += 1;
      }
      const opening = first;
      first = false;
      changed();
      // A step shows the view that fits its graph. The first step's 3D is
      // the opening rule's to give, and under reduced motion the steps stay flat.
      if (step.view === "3d" && !opening && !prefersReducedMotion()) void views.show3D();
      else if (step.view === "2d") views.show2D();
    }, { signal });
  } else {
    changed();
  }

  return () => {
    clearTimeout(labelTimer);
    offTheme();
    framed.disconnect();
    handle.destroy();
  };
}
