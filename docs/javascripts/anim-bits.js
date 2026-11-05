// @ts-check
/* ===========================================================================
 * anim-bits.js: slug "bits"
 * ---------------------------------------------------------------------------
 * The frame-bit dissector. Draws one hardware-captured D-STAR voice frame as
 * 72 bit cells, steps through the whole clip, and shows where the 72 bits
 * per 20 ms sit in the 4800 bit/s air budget. Its 3D view
 * (anim-bits-3d.js, head-on, owner decision O2) turns each cell into a thin
 * tile and flips over, like a card, every tile whose bit changed since the
 * previous frame. This canvas is the view under reduced motion and without
 * WebGL 2, and the 3D view draws everything but the cells from it.
 *
 * Mount point: <div data-anim="bits" markdown="1"> with the poster
 * (<figure class="anim-fallback">) inside; the live figure goes after it.
 *
 * Data read (precomputed; this file performs no AMBE analysis of any kind):
 *   assets/data/frames.json   frames[].hex, the 72 channel bits the
 *                             AMBE-3000 emitted per 20 ms, MSB first
 *                             (SCHEMA.md, "MEASURED").
 *
 * Controls:
 *   Play / Pause          steps frames at 10 fps (half real time)
 *   Previous / Next       single-frame step
 *   Frame slider          scrub, arrow-key steppable
 *   Colour toggle         bit value or change rate
 *   Flash changes         mark the bits that changed since the last frame
 *   3D                    the tile view (no depth axis, Front only)
 *   Bit grid              hover, tap, or Tab in and use the arrow keys to
 *                         inspect one bit, in either view
 *   Steps                 the host's <ol class="anim-steps">; a step sets
 *                         the colouring (data-mode="value" or "rate")
 *
 * Playback: the figure plays on its own once scrolled into view, from frame
 * 98. When it opens in 3D (opensIn3D()), the clip holds on 98 and the cells
 * show frame 97, with no outlines, until the 3D view is up and half seen;
 * then the 3D view flips the cells that changed into 98, slowly, once, and
 * the clip plays. If the 3D view does not come up (it fails to load or
 * open, or the reader leaves it first), the cells show 98 and it plays.
 *
 * HONESTY NOTE: read before "improving" this figure.
 * The assignment of D-STAR's 72 voice bits to codec fields (fundamental,
 * voicing, gain, spectral amplitudes, FEC) is NOT published: not in the JARL
 * D-STAR system specification, and not in any expired patent. US 5,870,405
 * additionally states the codewords are interleaved with a minimum separation
 * of 6 bits, so contiguous coloured "fields" would be wrong even if the
 * assignment were known. This figure therefore colours bits by what was
 * measured (their value, and how often each position changes) and states
 * the field layout as not publicly documented. Do not invent one. The 3D
 * view adds no grouping and no depth axis, for the same reason.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createLoop,
  createTransport,
  crisp,
  getTheme,
  hexBits,
  loadJSON,
  markEnhanced,
  onThemeChange,
  opensIn3D,
  prefersReducedMotion,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { createViewSwitch } from "./lib/view-switch.js";

/** @typedef {import("./anim-core.js").Theme} Theme */

const DATA = "assets/data/frames.json";

/* Frame arithmetic from the JARL D-STAR system specification (Ch. 4). */
const VOICE_BITS = 72; // AMBE with FEC, per 20 ms: 3600 bit/s
const DATA_BITS = 24; // data slot, per 20 ms: 1200 bit/s
const PARAM_BITS = 48; // vocoder parameters: 2400 bit/s
const FEC_BITS = 24; // error correction: 1200 bit/s
const FRAME_MS = 20;
const PLAY_FPS = 10; // half real time, so the bits are readable
const START_FRAME = 98;
/** Opening in 3D: how long a frame on screen but not half seen waits for
 *  the first-view flip, ms. */
const INTRO_WAIT_MS = 1500;
/** What a step may set (data-mode on its <li>): the colouring. */
const STEP_KEYS = /** @type {const} */ (["mode", "view"]);

const UNDOCUMENTED =
  "Which codec field this bit belongs to is not publicly documented. " +
  "The JARL specification gives the rates, not the bit map, and US 5,870,405 " +
  "interleaves the codewords across the frame.";

/**
 * @typedef {Object} Row
 * @property {number} i  frame index
 * @property {number} t  seconds
 * @property {string} hex  the 18 hex characters as captured
 * @property {Uint8Array} bits  72 single bits, wire order
 */

/**
 * @typedef {Object} Model
 * @property {Row[]} rows
 * @property {number[]} rate  share of frame transitions in which each position changed
 * @property {number[]} rateNorm  rate stretched over 0 to 1
 * @property {number} rateMin
 * @property {number} rateMax
 * @property {Uint8Array[]} changed  per frame, 1 where the bit differs from the previous frame
 * @property {number[]} changedCount
 * @property {number} transitions
 */

/**
 * @typedef {Object} State
 * @property {number} frame
 * @property {number} selected  the inspected bit, or -1
 * @property {"value" | "rate"} mode
 * @property {boolean} flash
 * @property {boolean} reduced
 * @property {number} changeAt  performance.now() of the last frame change
 * @property {boolean} playing  the transport is running
 * @property {boolean} holding  until the 3D view's first-view flip, the
 *           cells, labels and budget show the frame before, with no outlines
 * @property {Layout | null} hits
 */

/**
 * @typedef {Object} Grid
 * @property {number} x
 * @property {number} y
 * @property {number} labelX
 * @property {number} cellX
 * @property {number} hexX
 * @property {number} cell
 * @property {number} gap
 * @property {number} headerH
 * @property {number} width
 * @property {number} height
 * @property {number} top
 */

/** @typedef {{x: number, y: number, width: number, height: number}} Box */
/** @typedef {{x: number, y: number, w: number, h: number}} Rect */
/** @typedef {{width: number, height: number}} Size */

/**
 * @typedef {Object} Layout
 * @property {number} W
 * @property {number} H
 * @property {number} pad
 * @property {boolean} twoCol
 * @property {Grid} grid
 * @property {Box} panel
 */

/**
 * What the 3D part is handed (lib/view-switch.js `state`). It computes
 * nothing from the data: the bits, the changes, the rates and the layout
 * all come from here.
 * @typedef {Object} BitsView
 * @property {Model} model
 * @property {number} frame
 * @property {"value" | "rate"} mode
 * @property {boolean} flash
 * @property {number} selected
 * @property {boolean} playing  the transport is running (flips go fast)
 * @property {boolean} holding  the cells show the frame before this one,
 *           for the first-view flip; when it turns false the flip plays
 * @property {string} label  the canvas sentence
 * @property {(size: Size) => {cells: Rect[], block: Rect, title: {x: number, y: number}}} cells
 *           the 72 cell rectangles, the grid block and the top left of the
 *           title line, in CSS px of a frame this size
 * @property {(ctx: CanvasRenderingContext2D, size: Size) => void} backing
 *           everything the 2D view draws except the cells and the title
 *           line, on transparent
 * @property {(x: number, y: number) => void} pick  inspect the bit at a
 *           point of the frame (CSS px); off the grid clears it
 * @property {() => void} introDone  the first-view flip has ended
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
      <p class="anim-figure__title">Bit transitions across 72-bit AMBE channel frames</p>
      <p class="anim-figure__subtitle">Channel frames captured from a DVSI AMBE-3000</p>
    </div>

    <div class="anim-figure__frame">
      <canvas class="anim-figure__canvas" role="img" tabindex="0"
              aria-label="Grid of the 72 bits of one D-STAR voice frame. Use the arrow keys to move between bits; the description below updates."></canvas>
    </div>

    <div class="bits-inspect" role="status" aria-live="polite">
      <div class="bits-inspect__head" data-ref="head">Hover, tap, or Tab into the grid and use the arrow keys.</div>
      <div class="bits-inspect__meta" data-ref="meta">72 bits every 20 ms, 3600 bit/s of voice.</div>
      <div class="bits-inspect__note" data-ref="note">Bit 0 is the most significant bit of the first byte on the wire.</div>
    </div>

    <ul class="anim-legend">
      <li class="anim-legend__item" data-legend="value"><i class="anim-legend__swatch is-data-1"></i>bit = 1</li>
      <li class="anim-legend__item" data-legend="value"><i class="anim-legend__swatch"></i>bit = 0</li>
      <li class="anim-legend__item" data-legend="rate" hidden><i class="anim-legend__swatch is-data-2 bits-swatch--often"></i>changes often</li>
      <li class="anim-legend__item" data-legend="rate" hidden><i class="anim-legend__swatch bits-swatch--seldom"></i>seldom changes</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch bits-swatch--changed"></i>changed since the previous frame (outlined)</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch is-data-2"></i>hatched: layout not publicly documented</li>
    </ul>

    <div class="anim-controls">
      <button class="anim-btn anim-btn--play" type="button" data-kind="motion" aria-pressed="false">Play</button>
      <div class="anim-controls__group">
        <button class="anim-btn" type="button" data-ref="prev" aria-label="Previous frame">&#9664;</button>
        <button class="anim-btn" type="button" data-ref="next" aria-label="Next frame">&#9654;</button>
      </div>
      <label class="anim-field">
        <span class="anim-field__label">Frame</span>
        <input class="anim-range" type="range" min="0" max="0" step="1" value="0"
               aria-label="Frame index">
      </label>
      <output class="anim-readout anim-readout--wide">frame 0</output>
      <div class="anim-toggle-group" role="group" aria-label="Bit colouring">
        <button class="anim-btn" type="button" data-mode="value" aria-pressed="true">Bit value</button>
        <button class="anim-btn" type="button" data-mode="rate" aria-pressed="false">Change rate</button>
      </div>
      <label class="anim-field bits-flash">
        <input class="anim-check" type="checkbox" data-ref="flash" checked>
        <span class="anim-field__label">Flash changes</span>
      </label>
      <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
    </div>

    <!-- After the controls: the transport's readout is the figure's first. -->
    <div class="anim-figure__step"></div>

    <p class="anim-figure__hint">Held on one representative frame because your
      system asks for reduced motion. The slider and the arrow keys still step
      through every frame by hand.</p>
    <p class="anim-figure__hint anim-figure__hint--webgl" hidden>${NO_WEBGL_HINT}</p>

    <figcaption class="anim-figure__caption">
      Every cell is one bit the vocoder chip put on the wire. Scrub the frame
      slider and see how much of the frame turns over in 20 ms; then switch
      to <em>change rate</em> to see that no position is ever still. In 3D,
      step a frame at a time and each bit that changed flips over like a card.
      Hover a bit for its byte, its value and how often it flips.
      <strong>The colours are measurements, not a field map.</strong> Which of
      these 72 positions carries the fundamental, the voicing bits, the gain or
      the error-correction parity is not publicly documented.
      <span class="anim-figure__source">Source: frames[].hex from
        <code>assets/data/frames.json</code>, 72-bit channel frames captured
        from a DVSI AMBE-3000 (ThumbDV). Frame and rate arithmetic: JARL D-STAR
        system specification. Interleaving and unequal error protection:
        US 5,870,405 (expired).</span>
      <span data-measured="hex"></span>
    </figcaption>
  `;
  host.append(figure);
  $(figure, '[data-measured="hex"]', HTMLElement).append(badge("measured"));
  return {
    figure,
    frame: $(figure, ".anim-figure__frame", HTMLElement),
    canvas: $(figure, ".anim-figure__canvas", HTMLCanvasElement),
    head: $(figure, '[data-ref="head"]', HTMLElement),
    meta: $(figure, '[data-ref="meta"]', HTMLElement),
    note: $(figure, '[data-ref="note"]', HTMLElement),
    prev: $(figure, '[data-ref="prev"]', HTMLButtonElement),
    next: $(figure, '[data-ref="next"]', HTMLButtonElement),
    flash: $(figure, '[data-ref="flash"]', HTMLInputElement),
    play: $(figure, ".anim-btn--play", HTMLButtonElement),
    range: $(figure, ".anim-range", HTMLInputElement),
    toggle: $(figure, 'button[data-view="3d"]', HTMLButtonElement),
    hint: $(figure, ".anim-figure__hint--webgl", HTMLElement),
    modes: /** @type {HTMLButtonElement[]} */ (Array.from(figure.querySelectorAll("[data-mode]"))),
    legend: /** @type {HTMLElement[]} */ (Array.from(figure.querySelectorAll("[data-legend]"))),
  };
}

/** @typedef {ReturnType<typeof buildMarkup>} Refs */

/* ---------------------------------------------------------------------------
 * Data shaping: generic bit bookkeeping over the captured hex strings.
 * ------------------------------------------------------------------------ */

/**
 * @param {{i: number, t: number, hex: string}[]} frames
 * @returns {Model}
 */
export function unpack(frames) {
  const rows = frames.map((f) => ({ i: f.i, t: f.t, hex: f.hex, bits: hexBits(f.hex) }));

  // How often each position differs from the same position one frame earlier.
  const flips = new Float64Array(VOICE_BITS);
  const changed = rows.map(() => new Uint8Array(VOICE_BITS));
  for (let i = 1; i < rows.length; i += 1) {
    for (let n = 0; n < VOICE_BITS; n += 1) {
      if (rows[i].bits[n] !== rows[i - 1].bits[n]) {
        flips[n] += 1;
        changed[i][n] = 1;
      }
    }
  }
  const transitions = Math.max(1, rows.length - 1);
  const rate = Array.from(flips, (c) => c / transitions);
  const rateMax = Math.max(0.05, ...rate);
  const rateMin = Math.min(...rate);
  // Stretch the observed spread across the whole ramp, or every cell would
  // land in the same narrow band of colour.
  const rateNorm = rate.map((r) =>
    rateMax > rateMin ? (r - rateMin) / (rateMax - rateMin) : 0.5
  );
  const changedCount = changed.map((c) => c.reduce((a, b) => a + b, 0));
  return { rows, rate, rateNorm, rateMin, rateMax, changed, changedCount, transitions };
}

/* ---------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------ */

const TWO_COL = 720; // canvas width at which the budget panel moves alongside
const PANEL_H = 278; // height the budget panel wants when it sits underneath
const TITLE_H = 26;
const HEADER_H = 14;

/** @param {number} W */
function metrics(W) {
  const pad = W < 420 ? 10 : 14;
  const twoCol = W >= TWO_COL;
  const gridW = twoCol ? Math.round((W - pad * 3) * 0.54) : W - pad * 2;
  const labelW = W < 420 ? 34 : 42;
  const hexW = W < 420 ? 34 : 44;
  const gap = W < 420 ? 3 : 4;
  const inner = gridW - labelW - hexW - 10;
  // Beside the panel the grid may grow to fill the wide figure's frame.
  const cell = Math.max(12, Math.min(twoCol ? 56 : 44, Math.floor((inner - gap * 7) / 8)));
  return { pad, twoCol, gridW, labelW, hexW, gap, cell };
}

/**
 * Height this figure needs at a given width, so the frame's aspect can be
 * set from JS instead of guessed by a media query.
 * @param {number} W
 */
function naturalHeight(W) {
  const m = metrics(W);
  if (m.twoCol) return Math.round((W * 9) / 16);
  const gridH = 9 * m.cell + 8 * m.gap;
  return m.pad * 2 + TITLE_H + HEADER_H + gridH + 22 + PANEL_H;
}

/**
 * @param {Size} size
 * @returns {Layout}
 */
export function computeLayout(size) {
  const W = size.width;
  const H = size.height;
  const m = metrics(W);
  const { pad, twoCol, gridW, labelW, hexW, gap } = m;

  // Never let the grid outgrow the box: shrink the cells before overflowing.
  const availH =
    H - pad * 2 - TITLE_H - HEADER_H - (twoCol ? 0 : 22 + 120);
  const cell = Math.max(10, Math.min(m.cell, Math.floor((availH - gap * 8) / 9)));

  const gridTop = pad + TITLE_H;
  const headerH = HEADER_H;
  const rows = 9;
  const gridH = rows * cell + (rows - 1) * gap;

  // Centre the grid block when it stands alone, so a wide column does not
  // leave it hugging the left edge.
  const blockW = labelW + cell * 8 + gap * 7 + 10 + hexW;
  const x0 = twoCol ? pad : Math.max(pad, Math.round((W - blockW) / 2));

  /** @type {Grid} */
  const grid = {
    x: x0,
    y: gridTop,
    labelX: x0,
    cellX: x0 + labelW,
    hexX: x0 + labelW + cell * 8 + gap * 7 + 10,
    cell,
    gap,
    headerH,
    width: labelW + cell * 8 + gap * 7 + 10 + hexW,
    height: gridH,
    top: gridTop + headerH,
  };

  const panel = twoCol
    ? {
        x: pad * 2 + gridW,
        y: pad + TITLE_H,
        width: W - (pad * 2 + gridW) - pad,
        height: H - pad * 2 - TITLE_H,
      }
    : {
        x: x0,
        y: grid.top + gridH + 22,
        width: W - x0 * 2,
        height: H - (grid.top + gridH + 22) - pad,
      };

  return { W, H, pad, twoCol, grid, panel };
}

/**
 * @param {Grid} grid
 * @param {number} n bit position, 0 to 71
 * @returns {Rect}
 */
export function cellRect(grid, n) {
  const row = Math.floor(n / 8);
  const col = n % 8;
  return {
    x: grid.cellX + col * (grid.cell + grid.gap),
    y: grid.top + row * (grid.cell + grid.gap),
    w: grid.cell,
    h: grid.cell,
  };
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

/* Blend two CSS colours numerically. Canvas `fillStyle` does not reliably
   accept `color-mix()`, so parse and interpolate instead. */
/** @type {Map<string, number[] | null>} */
const colourCache = new Map();

/**
 * @param {string} value
 * @returns {number[] | null} r, g, b (0 to 255) and alpha (0 to 1)
 */
function parseColour(value) {
  const cached = colourCache.get(value);
  if (cached !== undefined) return cached;
  /** @type {number[] | null} */
  let out = null;
  const s = String(value).trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      out = [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
        h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1,
      ];
    } else if (h.length === 6 || h.length === 8) {
      out = [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      ];
    }
  } else {
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
      if (parts.length >= 3 && parts.every((v) => !Number.isNaN(v))) {
        out = [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
      }
    }
  }
  colourCache.set(value, out);
  return out;
}

/** @param {string} colour */
function luminance(colour) {
  const c = parseColour(colour);
  if (!c) return 0;
  /** @param {number} v */
  const f = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/**
 * Pick whichever of the theme's two extreme inks reads better on `fill`.
 * @param {string} fill
 * @param {Theme} th
 */
function contrastInk(fill, th) {
  const l = luminance(fill);
  const a = luminance(th.ink);
  const b = luminance(th.plotBg);
  /** @param {number} x @param {number} y */
  const ratio = (x, y) =>
    (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  return ratio(l, a) >= ratio(l, b) ? th.ink : th.plotBg;
}

/**
 * @param {string} a @param {string} b @param {number} t
 */
function mix(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  const ca = parseColour(a);
  const cb = parseColour(b);
  if (!ca || !cb) return u > 0.5 ? b : a;
  /** @param {number} i */
  const c = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * u);
  const alpha = ca[3] + (cb[3] - ca[3]) * u;
  return `rgba(${c(0)}, ${c(1)}, ${c(2)}, ${alpha.toFixed(3)})`;
}

/* ---------------------------------------------------------------------------
 * Painting
 * ------------------------------------------------------------------------ */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Size} size
 * @param {Model} model
 * @param {State} held
 * @param {{cells?: boolean, title?: boolean}} [opts] cells: false draws
 *        everything but the cells, on transparent (the 3D view's backing);
 *        title: false leaves out the line above the grid (the 3D view's
 *        chip stands there)
 */
function paint(ctx, size, model, held, opts = {}) {
  // Held for the first-view flip, everything drawn is the frame before.
  const state = held.holding ? { ...held, frame: Math.max(0, held.frame - 1) } : held;
  const cells = opts.cells !== false;
  const th = getTheme();
  const L = computeLayout(size);
  clearCanvas(ctx, size, cells ? th.plotBg : undefined);

  const row = model.rows[state.frame];
  const changed = model.changed[state.frame];
  // While the clip plays, each frame's outlines flash and fade; held still
  // (paused, stepped, reduced motion), they stay at full strength, so the
  // end state carries the point.
  const flashAge = (performance.now() - state.changeAt) / 420;
  const flash = !state.flash || state.holding ? 0
    : state.playing && !state.reduced ? Math.max(0, 1 - flashAge) : 1;

  drawGridBlock(ctx, th, L, model, state, row, changed, flash, cells, opts.title !== false);
  drawPanel(ctx, th, L, model, state);
  return L;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Theme} th
 * @param {Layout} L
 * @param {Model} model
 * @param {State} state
 * @param {Row} row
 * @param {Uint8Array} changed
 * @param {number} flash
 * @param {boolean} cells
 * @param {boolean} title
 */
function drawGridBlock(ctx, th, L, model, state, row, changed, flash, cells, title) {
  const g = L.grid;

  ctx.save();
  ctx.font = `600 11px ${th.font}`;
  ctx.fillStyle = th.text2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if (title) ctx.fillText("One 20 ms voice frame: 72 bits as transmitted", g.x, L.pad + 12);

  // Column header: bit position inside the byte, MSB first.
  ctx.font = `10px ${th.mono}`;
  ctx.fillStyle = th.text4;
  ctx.textAlign = "center";
  for (let c = 0; c < 8; c += 1) {
    const r = cellRect(g, c);
    ctx.fillText(String(c), r.x + r.w / 2, g.top - 4);
  }

  const digit = g.cell >= 20;
  for (let n = 0; cells && n < 72; n += 1) {
    const r = cellRect(g, n);
    const v = row.bits[n];
    const fill = cellFill(th, state.mode, v, model.rateNorm[n]);
    roundRect(ctx, r.x, r.y, r.w, r.h, 3);
    ctx.fillStyle = fill;
    ctx.fill();
    if (!v || state.mode === "rate") {
      ctx.strokeStyle = th.hairline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (digit) {
      ctx.font = `600 ${Math.round(g.cell * 0.42)}px ${th.mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle =
        state.mode === "rate" || v ? contrastInk(fill, th) : th.text4;
      ctx.fillText(String(v), r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    }

    if (flash > 0 && changed[n]) {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * flash;
      roundRect(ctx, r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3, 4.5);
      ctx.strokeStyle = highlight();
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    if (n === state.selected) {
      roundRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 6);
      ctx.strokeStyle = th.ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Byte labels and the hex the chip emitted.
  ctx.textBaseline = "middle";
  for (let b = 0; b < 9; b += 1) {
    const r = cellRect(g, b * 8);
    ctx.font = `10px ${th.mono}`;
    ctx.fillStyle = th.text4;
    // Right-aligned to the cells, so a narrow frame's label never runs
    // under the first cell.
    ctx.textAlign = "right";
    ctx.fillText(`byte ${b}`, g.cellX - 6, r.y + r.h / 2);
    ctx.textAlign = "left";
    ctx.fillStyle = th.text3;
    ctx.fillText(
      `0x${row.hex.slice(b * 2, b * 2 + 2)}`,
      g.hexX,
      r.y + r.h / 2
    );
  }
  ctx.restore();
}

/** The highlight token, read once per theme (getTheme() has no entry). */
let highlightCache = { theme: /** @type {unknown} */ (null), colour: "" };
function highlight() {
  const theme = getTheme();
  if (highlightCache.theme !== theme) {
    const colour = getComputedStyle(document.body).getPropertyValue("--ambe-highlight").trim();
    highlightCache = { theme, colour: colour || theme.accentWarm };
  }
  return highlightCache.colour;
}

/**
 * A cell's fill in the 2D view.
 * @param {Theme} th
 * @param {"value" | "rate"} mode
 * @param {number} v the bit
 * @param {number} rate 0 to 1
 */
function cellFill(th, mode, v, rate) {
  if (mode === "rate") return mix(th.surface2, th.accentCool, rate);
  return v ? th.series[0] : th.surface2;
}

/** @param {number} n */
function fmtInt(n) {
  return n.toLocaleString("en-US");
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Theme} th
 * @param {Layout} L
 * @param {Model} model
 * @param {State} state
 */
function drawPanel(ctx, th, L, model, state) {
  const p = L.panel;
  if (p.height < 90) return;
  let y = p.y;

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  ctx.font = `600 11px ${th.font}`;
  ctx.fillStyle = th.text2;
  ctx.fillText("Where the bits go", p.x, y + 10);
  y += 24;

  /* Bar 1: the 96-bit air frame */
  const barH = 20;
  const voiceW = (p.width * VOICE_BITS) / (VOICE_BITS + DATA_BITS);
  roundRect(ctx, p.x, y, voiceW, barH, 3);
  ctx.fillStyle = th.series[0];
  ctx.fill();
  roundRect(ctx, p.x + voiceW + 2, y, p.width - voiceW - 2, barH, 3);
  ctx.fillStyle = th.surface3;
  ctx.fill();

  ctx.font = `600 10px ${th.mono}`;
  ctx.fillStyle = th.plotBg;
  ctx.textAlign = "center";
  ctx.fillText("72 voice", p.x + voiceW / 2, y + barH / 2 + 3.5);
  ctx.fillStyle = th.text3;
  ctx.fillText(
    "24 data",
    p.x + voiceW + 2 + (p.width - voiceW - 2) / 2,
    y + barH / 2 + 3.5
  );
  y += barH + 13;

  ctx.font = `10px ${th.font}`;
  ctx.fillStyle = th.text4;
  ctx.textAlign = "left";
  ctx.fillText("96 bits every 20 ms on the air = 4800 bit/s", p.x, y);
  y += 20;

  /* Bar 2: inside the 72 */
  const paramW = (p.width * PARAM_BITS) / VOICE_BITS;
  roundRect(ctx, p.x, y, paramW, barH, 3);
  ctx.fillStyle = th.surface2;
  ctx.fill();
  ctx.strokeStyle = th.accentCool;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Hatch the parameter block: its interior arrangement is not published.
  ctx.save();
  roundRect(ctx, p.x, y, paramW, barH, 3);
  ctx.clip();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = th.accentCool;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = p.x - barH; x < p.x + paramW + barH; x += 7) {
    ctx.moveTo(x, y + barH);
    ctx.lineTo(x + barH, y);
  }
  ctx.stroke();
  ctx.restore();

  const fecW = (p.width * FEC_BITS) / VOICE_BITS - 2;
  roundRect(ctx, p.x + paramW + 2, y, fecW, barH, 3);
  ctx.fillStyle = th.accentWarm;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.font = `600 10px ${th.mono}`;
  ctx.textAlign = "center";
  ctx.fillStyle = th.text2;
  ctx.fillText("48 parameters", p.x + paramW / 2, y + barH / 2 + 3.5);
  ctx.fillStyle = th.plotBg;
  ctx.fillText(
    "24 FEC",
    p.x + paramW + 2 + fecW / 2,
    y + barH / 2 + 3.5
  );
  y += barH + 13;

  ctx.font = `10px ${th.font}`;
  ctx.textAlign = "left";
  ctx.fillStyle = th.text4;
  ctx.fillText("2400 bit/s of vocoder + 1200 bit/s of FEC = 3600 bit/s", p.x, y);
  y += 15;
  ctx.fillStyle = th.accentCool;
  ctx.fillText("hatched: which position holds which field is not", p.x, y);
  y += 13;
  ctx.fillText("publicly documented, and the codewords are interleaved", p.x, y);
  y += 20;

  /* Running budget */
  const shown = state.frame + 1;
  const bits = shown * VOICE_BITS;
  const secs = (shown * FRAME_MS) / 1000;
  ctx.font = `10px ${th.mono}`;
  ctx.fillStyle = th.text3;
  ctx.fillText(
    `${fmtInt(shown)} frames · ${fmtInt(bits)} voice bits · ${secs.toFixed(2)} s`,
    p.x,
    y
  );
  y += 14;
  ctx.fillStyle = th.text2;
  ctx.fillText(
    `${fmtInt(bits)} / ${secs.toFixed(2)} s = 3600 bit/s`,
    p.x,
    y
  );
  y += 22;

  /* Activity strip */
  const stripH = Math.min(46, Math.max(20, p.y + p.height - y - 26));
  if (stripH >= 20) {
    ctx.font = `10px ${th.font}`;
    ctx.fillStyle = th.text4;
    ctx.fillText(
      `Change rate per position, over ${model.transitions} transitions ` +
        `(tallest = ${(model.rateMax * 100).toFixed(0)}%)`,
      p.x,
      y
    );
    y += 8;
    const bw = p.width / 72;
    const base = y + stripH;
    for (let n = 0; n < 72; n += 1) {
      const h = Math.max(1, (model.rateNorm[n]) * stripH);
      ctx.fillStyle =
        n === state.selected
          ? th.ink
          : mix(th.surface3, th.accentCool, model.rateNorm[n]);
      ctx.fillRect(p.x + n * bw, base - h, Math.max(1, bw - 1), h);
    }
    ctx.strokeStyle = th.hairline;
    ctx.beginPath();
    ctx.moveTo(p.x, crisp(base));
    ctx.lineTo(p.x + p.width, crisp(base));
    ctx.stroke();
    ctx.font = `9px ${th.mono}`;
    ctx.fillStyle = th.text4;
    ctx.fillText("bit 0", p.x, base + 11);
    ctx.textAlign = "right";
    ctx.fillText("bit 71", p.x + p.width, base + 11);
  }
  ctx.restore();
}

/* ---------------------------------------------------------------------------
 * Hit testing
 * ------------------------------------------------------------------------ */

/**
 * @param {Layout} L
 * @param {number} x
 * @param {number} y
 */
function hitTest(L, x, y) {
  const g = L.grid;
  for (let n = 0; n < 72; n += 1) {
    const r = cellRect(g, n);
    if (x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 2 && y <= r.y + r.h + 2) {
      return n;
    }
  }
  const p = L.panel;
  if (x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height) {
    const bw = p.width / 72;
    const n = Math.floor((x - p.x) / bw);
    if (n >= 0 && n < 72 && y > p.y + p.height - 70) return n;
  }
  return -1;
}

/* ---------------------------------------------------------------------------
 * Text
 * ------------------------------------------------------------------------ */

/**
 * The inspector under the figure.
 * @param {Refs} refs
 * @param {Model} model
 * @param {State} state
 */
function describe(refs, model, state) {
  const row = model.rows[state.frame];
  const n = state.selected;
  if (n < 0) {
    refs.head.textContent = `Frame ${row.i} · ${row.t.toFixed(2)} s · ${row.hex}`;
    refs.meta.textContent = `${changedText(model, state.frame)} · 72 bits every 20 ms = 3600 bit/s`;
    refs.note.textContent =
      "Hover, tap, or Tab into the grid and use the arrow keys to inspect one bit.";
    return;
  }
  const byte = Math.floor(n / 8);
  const inByte = n % 8;
  const flipped = model.changed[state.frame][n] === 1;
  refs.head.textContent = `Bit ${n} of 72 = ${row.bits[n]} · byte ${byte}, bit ${inByte} (MSB first) · byte = 0x${row.hex.slice(
    byte * 2,
    byte * 2 + 2
  )}`;
  const since = row.i > 0 ? `${flipped ? "Changed" : "Held"} since frame ${row.i - 1}` : "First frame of the clip";
  refs.meta.textContent = `${since} · this position changes in ${(
    model.rate[n] * 100
  ).toFixed(0)}% of the ${model.transitions} frame transitions in this clip`;
  refs.note.innerHTML = `<b>Field: not publicly documented.</b> ${UNDOCUMENTED}`;
}

/**
 * "<n> of 72 bits changed since the previous frame", or the first frame's
 * own sentence.
 * @param {Model} model
 * @param {number} frame
 */
export function changedText(model, frame) {
  if (frame === 0) return "First frame of the clip: nothing to compare with";
  return `${model.changedCount[frame]} of 72 bits changed since the previous frame`;
}

/**
 * The sentence both canvases carry.
 * @param {Model} model
 * @param {State} state
 */
function canvasLabel(model, state) {
  const row = model.rows[state.frame];
  const colour = state.mode === "rate" ? "how often each position changes" : "bit value";
  return `Grid of the 72 bits of D-STAR voice frame ${row.i}, at ${row.t.toFixed(2)} s, ` +
    `coloured by ${colour}. ${changedText(model, state.frame)}. ` +
    "Use the arrow keys to move between bits; the description below updates.";
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
  const refs = buildMarkup(host);
  markEnhanced(host);
  refs.frame.dataset.state = "loading";

  /** @type {{frames: {i: number, t: number, hex: string}[]}} */
  const data = /** @type {any} */ (await loadJSON(DATA, { signal }));
  delete refs.frame.dataset.state;
  const model = unpack(data.frames);
  const startFrame = Math.min(START_FRAME, model.rows.length - 1);

  // Opening in 3D, the figure holds still one frame back until the 3D view
  // is up, then steps into the start frame: the first-view flip.
  const holdForIntro = opensIn3D() && startFrame > 0;

  /** @type {State} */
  const state = {
    frame: startFrame,
    selected: -1,
    mode: "value",
    flash: true,
    reduced: prefersReducedMotion(),
    changeAt: 0,
    playing: false,
    holding: holdForIntro,
    hits: null,
  };

  // Give the frame the aspect ratio the content needs at its width. Width
  // does not depend on height here, so this converges. Measured on the
  // frame, which keeps its width while the 2D canvas is hidden under 3D.
  const fitFrame = () => {
    const width = refs.frame.clientWidth;
    if (width < 100) return;
    const aspect = metrics(width).twoCol ? "var(--anim-aspect-house)" : `${width} / ${naturalHeight(width)}`;
    if (refs.frame.style.getPropertyValue("--anim-aspect") !== aspect) {
      refs.frame.style.setProperty("--anim-aspect", aspect);
    }
  };
  fitFrame();
  const framed = new ResizeObserver(fitFrame);
  framed.observe(refs.frame);

  /** @type {ReturnType<typeof createLoop> | null} */
  let loop = null;
  /** The size the 2D canvas last drew at (the tests compare the 3D view's). */
  let painted = { width: 0, height: 0 };
  const handle = setupCanvas(refs.canvas, {
    onResize: () => loop?.render(),
  });

  loop = createLoop(
    () => {
      // Hidden under the 3D view: nothing to draw.
      if (refs.canvas.hidden) return;
      state.hits = paint(handle.ctx, handle, model, state);
      painted = { width: handle.width, height: handle.height };
    },
    { element: refs.figure, staticTime: 0, autoplay: !state.reduced }
  );

  /* -- the 3D view ------------------------------------------------------ */

  // A reader who has already moved the frame or pressed Play keeps control.
  let touched = false;
  let started = false;
  // The clip is held for the first-view flip (state.holding is the part of
  // the hold the cells show).
  let held = holdForIntro;
  const startPlaying = () => {
    if (touched || started || state.reduced) return;
    started = true;
    transport.play();
  };
  /** @type {IntersectionObserver | null} */
  let introSeen = null;
  let introTimer = 0;
  const introWaitEnd = () => {
    clearTimeout(introTimer);
    introSeen?.disconnect();
    introSeen = null;
  };
  /**
   * The 3D view is up: once the frame is half seen, the cells may show the
   * start frame, and the 3D view flips them into it, slowly. A frame that is
   * on screen but never half seen (a tall phone layout scrolled past) goes
   * after INTRO_WAIT_MS, so the clip is never left held.
   */
  const beginIntro = () => {
    if (!state.holding || introSeen) return;
    const go = () => {
      introWaitEnd();
      if (!state.holding) return;
      state.holding = false;
      changed();
    };
    introSeen = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      const tall = Math.min(entry.boundingClientRect.height, entry.rootBounds?.height ?? Infinity);
      const seen = tall > 0 ? entry.intersectionRect.height / tall : 0;
      if (seen >= 0.5) go();
      else if (entry.isIntersecting && !introTimer) introTimer = window.setTimeout(go, INTRO_WAIT_MS);
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    introSeen.observe(refs.frame);
  };
  /**
   * The hold ends: the first-view flip is over, or there will be none (the
   * 3D view failed, closed, or the reader took over). Idempotent.
   */
  const release = () => {
    introWaitEnd();
    if (!held) return;
    held = false;
    if (state.holding) {
      state.holding = false;
      changed();
    }
    startPlaying();
  };

  /** @type {BitsView} */
  const view = {
    model,
    frame: state.frame,
    mode: state.mode,
    flash: state.flash,
    selected: state.selected,
    playing: false,
    label: canvasLabel(model, state),
    holding: state.holding,
    cells: (size) => {
      const L = computeLayout(size);
      const cells = Array.from({ length: 72 }, (_, n) => cellRect(L.grid, n));
      const g = L.grid;
      return { cells, block: { x: g.cellX, y: g.top, w: g.cell * 8 + g.gap * 7, h: g.height }, title: { x: g.x, y: L.pad } };
    },
    backing: (ctx, size) => {
      paint(ctx, size, model, state, { cells: false, title: false });
    },
    pick: (x, y) => {
      const r = refs.frame.getBoundingClientRect();
      const size = { width: Math.round(r.width - refs.frame.clientLeft * 2), height: Math.round(r.height - refs.frame.clientTop * 2) };
      select(x < 0 ? -1 : hitTest(computeLayout(size), x, y));
    },
    introDone: () => release(),
  };
  /** A fresh view each time, so the 3D view can tell what changed. @returns {BitsView} */
  const snapshot = () => ({
    ...view,
    frame: state.frame,
    mode: state.mode,
    flash: state.flash,
    selected: state.selected,
    playing: state.playing,
    holding: state.holding,
    label: canvasLabel(model, state),
  });

  const views = createViewSwitch({
    frame: refs.frame,
    flat: refs.canvas,
    toggle: refs.toggle,
    hint: refs.hint,
    signal,
    state: snapshot,
    // An open that throws ends the hold too.
    load: () => import("./anim-bits-3d.js").then((part) => ({
      /** @type {import("./lib/view-switch.js").Open3D} */
      open3D: async (frame, opts) => {
        try {
          return await part.open3D(frame, opts);
        } catch (error) {
          release();
          throw error;
        }
      },
    })),
    headOn: true,
    id: "bits",
    onView: (now) => {
      refs.figure.dataset.view = now;
      if (now !== "3d") loop?.render();
      if (now === "3d") beginIntro();
      // Left before the 3D view ever played: play as the 2D view would.
      if (now === "2d") release();
    },
  });
  // The 3D control let go with no view open (the part failed to load, or
  // WebGL 2 is missing): nothing will flip, so play as the 2D view would.
  // The Play button's state redraws the 2D outlines (full when held).
  const watched = new MutationObserver(() => {
    if (refs.toggle.getAttribute("aria-pressed") !== "true" && views.view() === "2d") release();
    const playing = refs.play.getAttribute("aria-pressed") === "true";
    if (playing !== state.playing) {
      state.playing = playing;
      loop?.render();
      views.update(snapshot());
    }
  });
  for (const el of [refs.toggle, refs.play]) watched.observe(el, { attributes: true, attributeFilter: ["aria-pressed"] });
  signal.addEventListener("abort", () => {
    watched.disconnect();
    introWaitEnd();
  }, { once: true });
  if (TEST_HOOK) {
    TEST_HOOK.figures.bits = { size: () => painted };
  }

  /* -- labels ----------------------------------------------------------- */

  let labelTimer = 0;
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      const label = canvasLabel(model, state);
      refs.canvas.setAttribute("aria-label", label);
      refs.frame.querySelector("canvas.anim-figure__canvas--3d")?.setAttribute("aria-label", label);
    }, 250);
  };

  /** Everything after a change of state: text, 2D, 3D. */
  const changed = () => {
    describe(refs, model, state);
    relabel();
    loop?.render();
    views.update(snapshot());
  };

  const transport = createTransport(refs.figure, {
    frames: model.rows.length,
    fps: PLAY_FPS,
    startFrame,
    autoplay: !holdForIntro,
    format: (i) => `frame ${i} · ${(i * 0.02).toFixed(2)} s`,
    onFrame: (i) => {
      state.frame = i;
      state.changeAt = performance.now();
      state.playing = refs.play.getAttribute("aria-pressed") === "true";
      changed();
    },
  });
  if (!holdForIntro) started = true;

  /* -- interaction -------------------------------------------------- */
  /** @param {number} n */
  function select(n) {
    if (n === state.selected) return;
    state.selected = n;
    changed();
  }

  /** @param {PointerEvent} event */
  const onPointer = (event) => {
    if (!state.hits) return;
    const rect = refs.canvas.getBoundingClientRect();
    select(hitTest(state.hits, event.clientX - rect.left, event.clientY - rect.top));
  };
  const onLeave = () => select(-1);

  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    /** @type {Record<string, number>} */
    const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8, Home: -1000, End: 1000 };
    const step = steps[event.key] ?? 0;
    if (!step) return;
    event.preventDefault();
    const from = state.selected < 0 ? (step > 0 ? -1 : 72) : state.selected;
    select(Math.max(0, Math.min(71, from + step)));
  };

  const opts = { signal };
  refs.canvas.addEventListener("pointermove", onPointer, opts);
  refs.canvas.addEventListener("pointerdown", onPointer, opts);
  refs.canvas.addEventListener("pointerleave", onLeave, opts);
  refs.frame.addEventListener("keydown", onKey, opts);
  refs.frame.addEventListener("focusout", (event) => {
    if (event.target instanceof HTMLCanvasElement) onLeave();
  }, opts);

  // The reader takes over: no hold, no autoplay. Caught on the way down,
  // before the transport's own listeners move the frame.
  const touch = () => {
    touched = true;
    introWaitEnd();
    if (state.holding) {
      state.holding = false;
      changed();
    }
  };
  refs.figure.addEventListener("input", (event) => {
    if (event.target === refs.range) touch();
  }, { signal, capture: true });
  refs.figure.addEventListener("click", (event) => {
    if (event.target === refs.play) touch();
  }, { signal, capture: true });

  /** @param {number} d */
  const stepFrame = (d) => () => {
    touch();
    transport.seek((transport.frame() + d + model.rows.length) % model.rows.length);
  };
  refs.prev.addEventListener("click", stepFrame(-1), opts);
  refs.next.addEventListener("click", stepFrame(1), opts);

  /** @param {string | undefined} mode */
  const setMode = (mode) => {
    state.mode = mode === "rate" ? "rate" : "value";
    for (const b of refs.modes) {
      b.setAttribute("aria-pressed", b.dataset.mode === state.mode ? "true" : "false");
    }
    for (const li of refs.legend) li.hidden = li.dataset.legend !== state.mode;
    changed();
  };
  for (const b of refs.modes) b.addEventListener("click", () => setMode(b.dataset.mode), opts);

  refs.flash.addEventListener("change", () => {
    state.flash = refs.flash.checked;
    changed();
  }, opts);

  const offTheme = onThemeChange(() => loop?.render());

  if (steps.length) {
    let opening = true;
    createStepper(refs.figure, steps, (step) => {
      setMode(step.mode);
      // A step shows the view that fits its graph. The first step's 3D is
      // the opening rule's to give, and under reduced motion the steps stay flat. Leaving 3D
      // before its first-view flip releases the hold, so the clip plays.
      if (step.view === "3d" && !opening && !prefersReducedMotion()) void views.show3D();
      else if (step.view === "2d") views.show2D();
      opening = false;
    }, { signal });
  }

  describe(refs, model, state);
  relabel();
  loop.render();

  return () => {
    clearTimeout(labelTimer);
    offTheme();
    framed.disconnect();
    transport.destroy();
    loop?.destroy();
    handle.destroy();
  };
}
