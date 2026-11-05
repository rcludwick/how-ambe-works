// @ts-check
/* ===========================================================================
 * anim-leakage.js: one pure tone, one cut, and the spread across the bins.
 * ---------------------------------------------------------------------------
 * SLUG          leakage          <div data-anim="leakage"></div>
 *
 * DATA READ     none. One cosine (phase 0) is generated and transformed in
 *               the browser by lib/leakage.js. Nothing here is measured and
 *               nothing here is specific to AMBE.
 *
 * CONTROLS      the tone, 6.00 to 7.00 cycles in the block (300 to 350 Hz)
 *               in steps of 0.05; the window, Rectangular or Hann; a weak
 *               second tone at 1500 Hz; the 3D control and, in 3D, the
 *               Camera presets and the Zoom group.
 *
 * WHAT IT DRAWS The strip (above the frame, in both views): three copies of
 *               the block end to end, which is the signal the DFT treats
 *               the block as, with the step at each joint marked and, under
 *               Hann, the window drawn over it.
 *               The frame, 2D: the block's 81 bins as stems, in dB below
 *               the peak, coloured on the ramp by level, with -40 dB marked.
 *               The frame, 3D (anim-leakage-3d.js, loaded only when 3D is
 *               wanted): one row of stems for every setting from 6.00 to
 *               7.00 cycles, so the spread opens and closes across the
 *               field, with the reader's setting as the highlight. Seen
 *               from the front with the field hidden, it is the 2D stems.
 *
 * WHY A COSINE  A sine that starts at zero also ends at zero on half a
 *               cycle, so its copies join with no step in value at the
 *               setting where the leakage is worst. A cosine makes the step
 *               a step (leakage-lib.spec.js holds the phase pi/2 case).
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  clearCanvas,
  createPlot,
  crisp,
  drawAxes,
  drawGrid,
  drawLabel,
  getTheme,
  markEnhanced,
  NO_WEBGL_HINT,
  onThemeChange,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import {
  BIN_HZ,
  BINS,
  COUNT_DB,
  CYCLES_MAX,
  CYCLES_MIN,
  CYCLES_STEP,
  FLOOR_DB,
  N,
  WEAK_BIN,
  binsAbove,
  cyclesRow,
  field,
  jointStep,
  rowCycles,
  toneAt,
  windowAt,
} from "./lib/leakage.js";
import { rampColor } from "./lib/style.js";
import { createViewSwitch } from "./lib/view-switch.js";

/** The plot's dB range: the floor, and a little room above the peak. */
export const DB_RANGE = /** @type {[number, number]} */ ([FLOOR_DB, 6]);
/** The plot's bin range: half a bin's room either side, and a little more. */
export const BIN_RANGE = /** @type {[number, number]} */ ([-1.5, BINS + 0.5]);

const STEP_KEYS = /** @type {const} */ (["cycles", "window", "weak", "view", "preset", "focus"]);

/** The Camera presets of the 3D view, in button order. */
export const PRESET_NAMES = /** @type {const} */ (["front", "corner"]);
/** @typedef {typeof PRESET_NAMES[number]} PresetName */
/** @typedef {import("./lib/leakage.js").WindowName} WindowName */

/**
 * @typedef {Object} LeakageState
 * @property {number} cycles  cycles of the tone in the block, 6.00 to 7.00
 * @property {number} row  the field row of `cycles`
 * @property {WindowName} window
 * @property {boolean} weak  the weak tone at 1500 Hz is on
 * @property {PresetName} preset  the 3D view's camera preset
 * @property {boolean} focus  the last step's close-up of bins 0 to 16 (a
 *           magnified inset in 2D, Front zoomed on them in 3D); a step or a
 *           Camera preset sets it
 * @property {Float64Array[]} rows  the field for this window and weak tone,
 *           one spectrum in dB per row; rows[row] is the reader's setting
 */

/**
 * The frame's one plot, for a frame of W x H CSS px. The 3D view's Front
 * preset puts the stems on `plot.area`.
 * @param {number} W
 * @param {number} H
 */
export function layout(W, H) {
  const narrow = W < 560;
  const plot = createPlot(
    { width: W, height: H },
    {
      xDomain: BIN_RANGE,
      yDomain: DB_RANGE,
      // The bottom clears the 56 px the 3D view's labels keep free
      // (lib/labels.js), so Front shows the same axis as the 2D plot.
      // The top keeps a band for the y axis's title, off the data.
      padding: narrow
        ? { top: 22, right: 10, bottom: 92, left: 38 }
        : { top: 24, right: 18, bottom: 92, left: 48 },
    }
  );
  return { W, H, narrow, plot };
}

/** @param {number} v @param {number} [places=1] */
const fmt = (v, places = 1) => {
  const s = v.toFixed(places);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace("-", "−");
};

/** "#rrggbb" of a 0xRRGGBB number. @param {number} hex */
const css = (hex) => `#${hex.toString(16).padStart(6, "0")}`;

/**
 * The ramp position of a level: 0 at the floor, 1 at the peak.
 * @param {number} db
 */
export const level = (db) => (db - FLOOR_DB) / -FLOOR_DB;

/**
 * Bins above -40 dB, as the readout and the chip say it.
 * @param {ArrayLike<number>} db
 */
export function countText(db) {
  const n = binsAbove(db, COUNT_DB);
  if (n === BINS) return `all ${BINS} bins above −40 dB`;
  return `${n} ${n === 1 ? "bin" : "bins"} above −40 dB`;
}

/* --- markup ------------------------------------------------------------- */

const CAPTION = `
  One cosine, starting at its peak (phase 0), cut to 160 samples (20 ms at
  8 kHz) and transformed. The strip shows what the transform assumes: the
  block repeated end to end. On a whole number of cycles the copies join
  cleanly and the spectrum is one line. Off it, every joint has a step, and
  the step's energy lands in every bin. A window fades the block to zero at
  both ends, so the step goes and the skirts drop, and the peak widens. The
  windows and their skirts are the textbook ones (Harris, "On the use of
  windows for harmonic analysis with the discrete Fourier transform",
  Proc. IEEE, 1978). AMBE's own analysis window is not shown here.
  <span class="anim-figure__source">Computed in your browser from a
  synthetic tone. Nothing here is measured.</span>`;

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Spectral leakage across DFT frequency bins</p>
</div>

<div class="anim-leakage__strip">
  <canvas class="anim-leakage__strip-canvas" role="img" data-ref="strip"
          aria-label="Three copies of the 20 millisecond block laid end to end."></canvas>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 4 / 3">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="The block's 81 frequency bins as stems, in decibels below the peak."></canvas>
</div>

<div class="anim-figure__step"></div>

<ul class="anim-legend" data-ref="legend-2d">
  <li class="anim-legend__item"><i class="anim-leakage__key anim-leakage__key--ramp"></i>each bin's level, low (dark) to high (bright)</li>
  <li class="anim-legend__item"><i class="anim-leakage__key anim-leakage__key--count"></i>−40 dB (dashed)</li>
  <li class="anim-legend__item"><i class="anim-leakage__key anim-leakage__key--joint"></i>in the strip, the step at each joint (thick)</li>
</ul>
<ul class="anim-legend" data-ref="legend-3d" hidden>
  <li class="anim-legend__item"><i class="anim-leakage__key anim-leakage__key--this"></i>this setting's spectrum (thick, outlined)</li>
  <li class="anim-legend__item"><i class="anim-leakage__key anim-leakage__key--ramp"></i>every setting from 6.00 to 7.00 cycles, by level, low (dark) to high (bright)</li>
  <li class="anim-legend__item"><i class="anim-leakage__key anim-leakage__key--count"></i>−40 dB (dashed)</li>
</ul>

<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Cycles in the block</span>
    <input class="anim-range" type="range" min="600" max="700" step="5" value="600"
           data-role="cycles" aria-label="Cycles of the tone in the block, in hundredths">
  </label>
  <output class="anim-readout" data-role="hz">6.00, 300.0 Hz</output>
  <div class="anim-toggle-group" role="group" aria-label="Window" data-ref="window">
    <button class="anim-btn" type="button" data-window="rect" aria-pressed="true">Rectangular</button>
    <button class="anim-btn" type="button" data-window="hann" aria-pressed="false">Hann</button>
  </div>
  <button class="anim-btn" type="button" data-ref="weak" aria-pressed="false">Weak tone at 1500 Hz</button>
  <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
  <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
    <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
    <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>

<div class="anim-forms" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">step at each joint</span>
    <code data-role="r-step"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">bins above −40 dB</span>
    <code data-role="r-count"></code></p>
  <p class="anim-forms__row" data-ref="weak-row" hidden><span class="anim-forms__tag">bin 30, the weak tone</span>
    <code data-role="r-weak"></code></p>
</div>

<figcaption class="anim-figure__caption"></figcaption>
`;

/* --- drawing (2D) --------------------------------------------------------- */

/**
 * The strip: three copies of the windowed block, the tone as it really
 * continues (dashed, rectangular only), the window's shape (Hann), and the
 * step at each joint.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{width: number, height: number}} size
 * @param {LeakageState} state
 */
function drawStrip(ctx, size, state) {
  const th = getTheme();
  const W = size.width;
  const H = size.height;
  const narrow = W < 560;
  const copies = 3;
  const plot = createPlot(size, {
    xDomain: [0, copies * N],
    yDomain: [-1.25, 1.25],
    // The right keeps room for half of "60 ms", the last tick's label.
    padding: narrow ? { top: 6, right: 18, bottom: 20, left: 38 } : { top: 8, right: 18, bottom: 22, left: 48 },
  });
  clearCanvas(ctx, size, th.plotBg);
  const { area } = plot;
  // Alternate copies on a faint band, so the joints read before the step.
  ctx.fillStyle = th.surface2;
  ctx.fillRect(plot.x(N), area.top, plot.x(2 * N) - plot.x(N), area.height);
  drawGrid(ctx, plot, { xTicks: [N, 2 * N], yTicks: [0] });
  drawAxes(ctx, plot, {
    xTicks: [0, N, 2 * N, 3 * N],
    yTicks: [],
    formatX: (v) => `${Math.round((v / N) * 20)} ms`,
  });

  ctx.save();
  plot.clip(ctx);
  const opts = { weak: state.weak };
  const per = Math.max(160, Math.round(area.width / copies));
  // The tone as it really continues past the first copy, for comparison.
  if (state.window === "rect") {
    ctx.strokeStyle = th.muted;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let i = 0; i <= per * 2; i += 1) {
      const n = (N * i) / per;
      const x = plot.x(n);
      const y = plot.y(toneAt(state.cycles, n, opts));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // The window's shape, above and below.
    ctx.strokeStyle = th.muted;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 3]);
    for (const sign of [1, -1]) {
      ctx.beginPath();
      for (let c = 0; c < copies; c += 1) {
        for (let i = 0; i <= per; i += 1) {
          const n = (N * i) / per;
          const x = plot.x(c * N + n);
          const y = plot.y(sign * windowAt("hann", n));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // The copies.
  ctx.strokeStyle = th.series[0];
  ctx.lineWidth = 1.8;
  for (let c = 0; c < copies; c += 1) {
    ctx.beginPath();
    for (let i = 0; i <= per; i += 1) {
      const n = (N * i) / per;
      // The last point is the sample one past the block's end, as the next
      // copy would need it: drawn from this copy's tone so the gap shows.
      const x = plot.x(c * N + n);
      const y = plot.y(toneAt(state.cycles, n, opts) * windowAt(state.window, n));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // The joints: from where one copy was heading to where the next starts.
  const end = toneAt(state.cycles, N, opts) * windowAt(state.window, N);
  const start = toneAt(state.cycles, 0, opts) * windowAt(state.window, 0);
  ctx.strokeStyle = th.accentWarm;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  for (let c = 1; c < copies; c += 1) {
    const x = plot.x(c * N);
    if (Math.abs(end - start) < 0.02) {
      ctx.fillStyle = th.accentWarm;
      ctx.beginPath();
      ctx.arc(x, plot.y(start), 3.5, 0, 2 * Math.PI);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(x, plot.y(end));
    ctx.lineTo(x, plot.y(start));
    ctx.stroke();
  }
  ctx.restore();

  const step = jointStep(state.cycles, state.window, opts);
  drawLabel(ctx, step < 0.005 ? "the copies meet: no step" : `a step of ${fmt(step, 2)} at each joint`,
    plot.x(N) + 6, area.top + 2, {
      align: "left", baseline: "top", size: 11, color: th.accentWarm, background: th.plotBg, padding: 2,
    });
  if (!narrow) {
    drawLabel(ctx, state.window === "rect" ? "the tone, continued (dashed)" : "the Hann window (dashed)",
      plot.x(2.5 * N), area.bottom - 2, {
        align: "center", baseline: "bottom", size: 11, color: th.text3, background: th.plotBg, padding: 2,
      });
  }
}

/**
 * The spectrum: 81 stems in dB below the peak, coloured on the ramp by
 * level, the -40 dB line, and the weak tone's bin when it is on.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof layout>} geo
 * @param {LeakageState} state
 */
function drawSpectrum(ctx, geo, state) {
  const th = getTheme();
  const { plot, narrow } = geo;
  const db = state.rows[state.row];
  const binTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80];
  drawGrid(ctx, plot, { xTicks: binTicks, yTicks: [-80, -60, -40, -20, 0] });
  drawAxes(ctx, plot, {
    xTicks: narrow ? [0, 20, 40, 60, 80] : binTicks,
    yTicks: [-100, -80, -60, -40, -20, 0],
    formatX: (v) => String(v),
    formatY: (v) => fmt(v, 0),
    xLabel: narrow ? "bin (50 Hz each)" : "bin, 50 Hz apart (bin 80 is 4 kHz)",
  });
  // The y axis's title, in the band above the plot, where no stem reaches.
  drawLabel(ctx, "dB below the peak", 4, 4, {
    align: "left", baseline: "top", size: 11, color: th.text3,
  });

  ctx.save();
  plot.clip(ctx);
  // -40 dB, which the readout and the chip count against.
  ctx.strokeStyle = th.ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(plot.area.left, crisp(plot.y(COUNT_DB)));
  ctx.lineTo(plot.area.right, crisp(plot.y(COUNT_DB)));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const width = narrow ? 1.6 : 2.4;
  const base = plot.y(FLOOR_DB);
  for (let k = 0; k < BINS; k += 1) {
    if (db[k] <= FLOOR_DB) continue;
    const colour = css(rampColor(level(db[k])));
    const x = plot.x(k);
    const y = plot.y(db[k]);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, width + 0.6, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();

  // The 3D chip's fact, in the band the 3D labels keep clear.
  drawLabel(ctx, `${state.cycles.toFixed(2)} cycles: ${countText(db)}`, plot.area.left, geo.H - 12, {
    align: "left", baseline: "bottom", size: 12, weight: 600, color: th.text2,
  });
  if (state.focus && whole(state.cycles)) drawInset(ctx, geo, state);
  if (state.weak) {
    const x = plot.x(WEAK_BIN);
    ctx.fillStyle = th.text2;
    ctx.beginPath();
    ctx.moveTo(x, plot.area.bottom + 1);
    ctx.lineTo(x - 5, plot.area.bottom + 9);
    ctx.lineTo(x + 5, plot.area.bottom + 9);
    ctx.fill();
    drawLabel(ctx, "weak tone", x, plot.y(-12), {
      align: "center", baseline: "bottom", size: 11, color: th.text2, background: th.plotBg, padding: 2,
    });
    ctx.strokeStyle = th.text3;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(crisp(x), plot.y(-12));
    ctx.lineTo(crisp(x), plot.y(Math.max(db[WEAK_BIN], COUNT_DB + 2)) - 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** The setting is a whole number of cycles. @param {number} cycles */
const whole = (cycles) => Math.abs(cycles - Math.round(cycles)) < 1e-9;

/** The inset's bins and levels. */
const INSET_BINS = /** @type {[number, number]} */ ([-0.5, 16.5]);
const INSET_DB = /** @type {[number, number]} */ ([-40, 6]);

/**
 * The last step's close-up: bins 0 to 16 magnified, in the top right of
 * the plot, which is empty on a whole number of cycles (every bin from 9
 * up sits on the floor, bar the weak tone's at 30). Each stem above the
 * inset's -40 dB floor is labelled with its level, so one stem against
 * three, and the two at -6.02 dB, read at a glance.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof layout>} geo
 * @param {LeakageState} state
 */
function drawInset(ctx, geo, state) {
  const th = getTheme();
  const { plot, narrow } = geo;
  const db = state.rows[state.row];
  const left = plot.x(narrow ? 32 : 35);
  const right = plot.x(BINS - 2);
  const top = plot.y(0);
  const bottom = plot.y(-50);
  const inset = createPlot(
    { width: geo.W, height: geo.H },
    {
      xDomain: INSET_BINS,
      yDomain: INSET_DB,
      padding: { top: top + 16, right: geo.W - right, bottom: geo.H - bottom, left },
    }
  );
  const a = inset.area;
  ctx.save();
  ctx.fillStyle = th.plotBg;
  ctx.fillRect(a.left - 4, a.top - 18, a.width + 8, a.height + 34);
  ctx.strokeStyle = th.hairline;
  ctx.lineWidth = 1;
  ctx.strokeRect(crisp(a.left - 4), crisp(a.top - 18), Math.round(a.width + 8), Math.round(a.height + 34));
  ctx.restore();
  drawLabel(ctx, "bins 0 to 16, magnified", a.left, a.top - 16, {
    align: "left", baseline: "top", size: 11, color: th.text2,
  });
  for (const k of [0, 6, 12, 16]) {
    drawLabel(ctx, String(k), inset.x(k), a.bottom + 2, {
      align: "center", baseline: "top", size: 10, color: th.text3,
    });
  }
  ctx.strokeStyle = th.hairline;
  ctx.beginPath();
  ctx.moveTo(a.left, crisp(a.bottom));
  ctx.lineTo(a.right, crisp(a.bottom));
  ctx.stroke();
  const width = narrow ? 2.4 : 3;
  for (let k = 0; k <= 16; k += 1) {
    if (db[k] <= INSET_DB[0]) continue;
    const colour = css(rampColor(level(db[k])));
    const x = inset.x(k);
    const y = inset.y(db[k]);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, a.bottom);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, width + 0.6, 0, 2 * Math.PI);
    ctx.fill();
    if (db[k] < -0.005) {
      const side = k < 6 ? -1 : 1;
      drawLabel(ctx, `${fmt(db[k], 2)} dB`, x + side * 7, y, {
        align: side < 0 ? "right" : "left", baseline: "middle", size: 11, color: th.text2,
      });
    }
  }
}

/**
 * The weak tone's readout: its bin against the bins either side.
 * @param {ArrayLike<number>} db
 */
export function weakText(db) {
  const k = WEAK_BIN;
  const above = db[k] - Math.max(db[k - 1], db[k + 1]);
  return above > 1
    ? `${fmt(db[k])} dB, ${fmt(above)} dB above the bins beside it`
    : `${fmt(db[k])} dB, level with the bins beside it (${fmt(db[k - 1])} and ${fmt(db[k + 1])} dB)`;
}

/**
 * The sentence for the 2D canvas's label.
 * @param {LeakageState} s
 */
function describe2D(s) {
  const db = s.rows[s.row];
  const win = s.window === "hann" ? "a Hann window" : "a rectangular cut";
  return `The spectrum of one cosine at ${s.cycles.toFixed(2)} cycles in the block (${fmt(s.cycles * BIN_HZ)} Hz), ` +
    `cut with ${win}: 81 bins as stems in decibels below the peak, ${countText(db)}.` +
    (s.weak ? ` A weak second tone at 1500 Hz is on; bin 30 reads ${weakText(db)}.` : "");
}

/**
 * The sentence for the strip's label.
 * @param {LeakageState} s
 */
function describeStrip(s) {
  const step = jointStep(s.cycles, s.window, { weak: s.weak });
  return `Three copies of the 20 millisecond block laid end to end, as the transform treats it. ` +
    (step < 0.005 ? "Each copy meets the next with no step." : `Each joint has a step of ${fmt(step, 2)}.`) +
    (s.window === "hann" ? " The Hann window fades every copy to zero at both ends." : "");
}

/* --- module ------------------------------------------------------------- */

/**
 * Mount the leakage figure.
 * @param {Element} host a `[data-anim="leakage"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-leakage";
  figure.innerHTML = FIGURE_HTML;
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  caption.innerHTML = CAPTION;
  caption.append(" ", badge("synthetic"));
  host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const stripCanvas = $(figure, '[data-ref="strip"]', HTMLCanvasElement);
  const cyclesEl = $(figure, '[data-role="cycles"]', HTMLInputElement);
  const hzEl = $(figure, '[data-role="hz"]', HTMLOutputElement);
  const weakEl = $(figure, '[data-ref="weak"]', HTMLButtonElement);
  const windowGroup = $(figure, '[data-ref="window"]', HTMLElement);
  const toggle = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const camera = $(figure, '[data-ref="camera"]', HTMLElement);
  const legend2D = $(figure, '[data-ref="legend-2d"]', HTMLElement);
  const legend3D = $(figure, '[data-ref="legend-3d"]', HTMLElement);
  const weakRow = $(figure, '[data-ref="weak-row"]', HTMLElement);

  /** @type {LeakageState} */
  const state = {
    cycles: CYCLES_MIN,
    row: 0,
    window: "rect",
    weak: false,
    preset: "corner",
    focus: false,
    rows: field("rect", false),
  };

  const handle = setupCanvas(canvas, { onResize: () => render() });
  const strip = setupCanvas(stripCanvas, { onResize: () => render() });

  let labelTimer = 0;
  const describe = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      canvas.setAttribute("aria-label", describe2D(state));
      stripCanvas.setAttribute("aria-label", describeStrip(state));
    }, 250);
  };

  /** @param {string} role @param {string} text */
  const set = (role, text) => {
    const el = figure.querySelector(`[data-role="${role}"]`);
    if (el && el.textContent !== text) el.textContent = text;
  };

  function render() {
    const th = getTheme();
    const geo = layout(handle.width, handle.height);
    // From the frame, not the canvas: in 3D the 2D canvas is hidden and
    // narrow, and the frame must keep its shape across the switch.
    const aspect = (frame.clientWidth || geo.W) < 560 ? "1 / 1.1" : "4 / 3";
    if (frame.style.getPropertyValue("--anim-aspect") !== aspect) frame.style.setProperty("--anim-aspect", aspect);
    clearCanvas(handle.ctx, handle, th.plotBg);
    drawSpectrum(handle.ctx, geo, state);
    drawStrip(strip.ctx, strip, state);

    const db = state.rows[state.row];
    const step = jointStep(state.cycles, state.window, { weak: state.weak });
    set("hz", `${state.cycles.toFixed(2)}, ${fmt(state.cycles * BIN_HZ)} Hz`);
    set("r-step", step < 0.005 ? "0.00, the copies meet" : `${fmt(step, 2)} out of a possible 2.00`);
    const n = binsAbove(db, COUNT_DB);
    set("r-count", `${n} of ${BINS}`);
    weakRow.hidden = !state.weak;
    set("r-weak", state.weak ? weakText(db) : "");
    describe();
  }

  /** Redraw both views from the state. */
  const changed = () => {
    state.rows = field(state.window, state.weak);
    state.row = cyclesRow(state.cycles);
    render();
    views.update(state);
  };

  /* -- interaction ------------------------------------------------------- */

  const sync = () => {
    const v = String(Math.round(state.cycles * 100));
    if (cyclesEl.value !== v) cyclesEl.value = v;
    for (const button of windowGroup.querySelectorAll("[data-window]")) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-window") === state.window));
    }
    weakEl.setAttribute("aria-pressed", String(state.weak));
  };

  cyclesEl.addEventListener("input", () => {
    state.cycles = rowCycles(cyclesRow(Number(cyclesEl.value) / 100));
    changed();
  }, { signal });
  for (const button of windowGroup.querySelectorAll("[data-window]")) {
    button.addEventListener("click", () => {
      state.window = button.getAttribute("data-window") === "hann" ? "hann" : "rect";
      sync();
      changed();
    }, { signal });
  }
  weakEl.addEventListener("click", () => {
    state.weak = !state.weak;
    sync();
    changed();
  }, { signal });
  const unsubscribeTheme = onThemeChange(() => render());

  /* -- the 3D view ------------------------------------------------------- */

  /** @param {PresetName} name */
  const pressPreset = (name) => {
    for (const button of camera.querySelectorAll("[data-preset]")) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-preset") === name));
    }
  };

  /** @param {"2d" | "3d" | "parked"} view */
  const onView = (view) => {
    const live = view === "3d";
    camera.hidden = !live;
    legend3D.hidden = !live;
    legend2D.hidden = live;
    if (!live) render();
  };

  const views = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: () => state,
    load: () => import("./anim-leakage-3d.js"),
    onView,
    id: "leakage",
  });
  // The switch shows the hint beside a disabled control; the control's own
  // tooltip says the same.
  if (!views.available()) toggle.title = NO_WEBGL_HINT;

  /**
   * A camera preset; with `focus`, Front closes in on bins 0 to 16 (the
   * 3D view's "peak" request) and the 2D plot shows its inset.
   * @param {PresetName} name
   * @param {boolean} [focus=false]
   */
  function setPreset(name, focus = false) {
    state.preset = name;
    state.focus = focus && name === "front";
    pressPreset(name);
    views.preset(state.focus ? "peak" : name);
  }
  for (const button of camera.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => {
      setPreset(/** @type {PresetName} */ (button.getAttribute("data-preset")));
      render();
    }, { signal });
  }

  /**
   * One step's state.
   * @param {Record<string, string>} s
   */
  function apply(s) {
    if (s.cycles !== undefined) {
      const c = Number(s.cycles);
      if (Number.isFinite(c)) state.cycles = rowCycles(cyclesRow(Math.min(CYCLES_MAX, Math.max(CYCLES_MIN, c))));
    }
    if (s.window === "rect" || s.window === "hann") state.window = s.window;
    if (s.weak === "on" || s.weak === "off") state.weak = s.weak === "on";
    sync();
    if (s.preset && /** @type {readonly string[]} */ (PRESET_NAMES).includes(s.preset)) {
      setPreset(/** @type {PresetName} */ (s.preset), s.focus === "peak");
    } else {
      state.focus = false;
    }
    if (s.view === "3d") void views.show3D();
    else if (s.view === "2d") views.show2D();
    changed();
  }

  // The slider moves in the field's steps.
  cyclesEl.step = String(Math.round(CYCLES_STEP * 100));
  sync();
  pressPreset(state.preset);
  if (steps.length) createStepper(figure, steps, apply, { signal });
  else changed();

  return () => {
    clearTimeout(labelTimer);
    unsubscribeTheme();
    handle.destroy();
    strip.destroy();
  };
}
