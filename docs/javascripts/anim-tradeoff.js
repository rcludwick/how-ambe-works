// @ts-check
/* ===========================================================================
 * anim-tradeoff.js: "tradeoff", one synthetic sound cut into blocks of one
 * length, to show that block length trades time detail for frequency
 * detail (ch03; three-everywhere design §5.3).
 * ---------------------------------------------------------------------------
 * SLUG      tradeoff
 *
 * DATA READ  none. The sound is synthetic, made here from a seeded
 *            generator (lib/prng.js), so every visit draws the same one.
 *
 * The sound, 400 ms at 8 kHz: a vowel with an "ah" shape (0 to 200 ms),
 * 40 ms of silence with a one-sample click at 230 ms, then a vowel with an
 * "oh" shape (240 to 400 ms). Both vowels are a harmonic series on one
 * pitch f0 (80 to 250 Hz), with phases drawn once from the seed and a
 * 10 ms fade at each end. Each block is Hann-windowed and transformed
 * with lib/fft.js (4096 points, zero-padded); levels are dB below the
 * loudest point of the whole picture, floored at -60 dB.
 *
 * Views:
 *   - 2D (Canvas 2D): the spectrogram (frequency across, time down, one
 *     strip per block) above the spectrum of the selected block.
 *   - 3D (anim-tradeoff-3d.js, loaded only when wanted): the same blocks as
 *     a waterfall, depth is time. Its Top preset is the spectrogram and its
 *     Front preset the block spectrum. Steps 2 to 5 fly to a pose the
 *     Camera group has no button for (STEP_POSES): "high", up over the
 *     front, where every strip is surface.
 *
 * WHAT THIS FILE IS NOT
 *   A codec or a model of one. It draws textbook short-time Fourier
 *   analysis of a made-up sound. No AMBE analysis, quantizer or
 *   synthesis; nothing is played.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createPlot,
  crisp,
  drawAxes,
  drawGrid,
  getTheme,
  markEnhanced,
  onThemeChange,
  opensIn3D,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { hann, magnitudes } from "./lib/fft.js";
import { mulberry32 } from "./lib/prng.js";
import { darkGround, mix, printing, rampColor, tokenHex } from "./lib/style.js";
import { createViewSwitch } from "./lib/view-switch.js";

/* ---------------------------------------------------------------------------
 * The model: the sound and its blocks. Pure functions, tested in node
 * (tests/figures/tradeoff-lib.spec.js); the 3D part reads their results
 * through the state and computes none of its own.
 * ------------------------------------------------------------------------ */

export const FS = 8000;
export const SOUND_MS = 400;
const SAMPLES = (FS * SOUND_MS) / 1000;
/** Transform size: every block, up to the whole 3200 samples, zero-padded. */
export const NFFT = 4096;
/** Hz per transform bin. */
export const BIN_HZ = FS / NFFT;
/** The figure shows 0 to 2 kHz. */
export const MAX_HZ = 2000;
/** Fine bins up to MAX_HZ, both ends included. */
export const FINE = MAX_HZ / BIN_HZ + 1;
/** Spectrogram columns, 15.625 Hz each; a column holds the loudest of its bins. */
export const COLUMNS = 128;
const PER_COLUMN = (FINE - 1) / COLUMNS;
/** Levels are clamped here, dB below the loudest point. */
export const FLOOR_DB = -60;
/** Block lengths the slider offers, ms; 400 is the whole sound. */
export const BLOCKS_MS = [5, 10, 20, 40, 80, 400];
export const F0_MIN = 80;
export const F0_MAX = 250;
export const SEED = 1;
/** Where things are in the sound, ms. */
export const VOWEL_A = /** @type {[number, number]} */ ([0, 200]);
export const VOWEL_B = /** @type {[number, number]} */ ([240, 400]);
export const CLICK_MS = 230;
const CLICK_AMPLITUDE = 60;
const FADE_MS = 10;
/** Formants (Hz) and their bandwidths of the two vowel shapes, rough
 *  textbook values for an "ah" and an "oh"; the figure needs two
 *  different shapes, not a particular speaker. */
const SHAPE_A = [[700, 130], [1220, 70], [2600, 160]];
const SHAPE_B = [[450, 80], [850, 90], [2600, 160]];
/** Harmonics up to this frequency are made. */
const TOP_HZ = 3800;
/** Valleys are measured between harmonics up to this frequency. */
export const VALLEY_TOP_HZ = 1500;

/**
 * The level of a harmonic at f under a vowel shape: a product of
 * second-order resonances, 1 at 0 Hz.
 * @param {number} f
 * @param {number[][]} shape
 */
function shapeGain(f, shape) {
  let g = 1;
  for (const [F, B] of shape) g *= (F * F) / Math.hypot(F * F - f * f, B * f);
  return g;
}

/** Phases of harmonics 1, 2, ..., drawn once from SEED. */
const PHASES = (() => {
  const random = mulberry32(SEED);
  return Array.from({ length: 64 }, () => 2 * Math.PI * random());
})();

/** @type {Map<number, Float64Array>} */
const sounds = new Map();

/**
 * The 400 ms sound for one pitch.
 * @param {number} f0 Hz
 * @returns {Float64Array} 3200 samples at 8 kHz
 */
export function sound(f0) {
  const cached = sounds.get(f0);
  if (cached) return cached;
  const x = new Float64Array(SAMPLES);
  const fade = (FS * FADE_MS) / 1000;
  for (const [[from, to], shape] of /** @type {[[number, number], number[][]][]} */ ([[VOWEL_A, SHAPE_A], [VOWEL_B, SHAPE_B]])) {
    const n0 = (FS * from) / 1000;
    const n1 = (FS * to) / 1000;
    for (let k = 1; k * f0 < TOP_HZ; k += 1) {
      const a = shapeGain(k * f0, shape);
      const w = (2 * Math.PI * k * f0) / FS;
      for (let n = n0; n < n1; n += 1) x[n] += a * Math.cos(w * n + PHASES[k - 1]);
    }
    for (let i = 0; i < fade; i += 1) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
      x[n0 + i] *= g;
      x[n1 - 1 - i] *= g;
    }
  }
  x[(FS * CLICK_MS) / 1000] += CLICK_AMPLITUDE;
  sounds.set(f0, x);
  return x;
}

/**
 * How a block length cuts the sound: rows of `hop` ms, half a block each,
 * row r covering r * hop to (r + 1) * hop and analysed by the block of
 * `block` ms centred on it. The whole sound is one row.
 * @param {number} block ms
 * @returns {{block: number, hop: number, rows: number}}
 */
export function layout(block) {
  if (block >= SOUND_MS) return { block: SOUND_MS, hop: SOUND_MS, rows: 1 };
  const hop = block / 2;
  return { block, hop, rows: Math.round(SOUND_MS / hop) };
}

/**
 * The magnitude spectrum, 0 to MAX_HZ, of row r's block (zero outside
 * the sound).
 * @param {Float64Array} x
 * @param {number} block ms
 * @param {number} r
 * @returns {Float64Array} FINE magnitudes
 */
function rowMagnitudes(x, block, r) {
  const { hop } = layout(block);
  const length = Math.round((FS * Math.min(block, SOUND_MS)) / 1000);
  const start = Math.round((FS * (r + 0.5) * hop) / 1000 - length / 2);
  const w = hann(length);
  const seg = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const j = start + i;
    if (j >= 0 && j < x.length) seg[i] = x[j] * w[i];
  }
  return magnitudes(seg, NFFT).subarray(0, FINE);
}

/**
 * One block length's picture of the sound.
 * @typedef {Object} Picture
 * @property {number} f0
 * @property {number} block  ms
 * @property {number} hop    ms
 * @property {number} rows
 * @property {Float32Array} cells  rows x COLUMNS, dB, row-major, earliest first
 * @property {Float32Array[]} fine  each row's spectrum, FINE points, dB
 */

/** @type {Map<string, Picture>} */
const pictures = new Map();

/**
 * The spectrogram of the sound for one pitch and block length: each cell
 * the loudest of its column's bins, in dB below the loudest point,
 * floored at FLOOR_DB; and each row's spectrum at every bin.
 * @param {number} f0
 * @param {number} block ms
 * @returns {Picture}
 */
export function picture(f0, block) {
  const key = `${f0}:${block}`;
  const cached = pictures.get(key);
  if (cached) return cached;
  const x = sound(f0);
  const { hop, rows } = layout(block);
  const mags = Array.from({ length: rows }, (_, r) => rowMagnitudes(x, block, r));
  let peak = 0;
  for (const m of mags) for (const v of m) peak = Math.max(peak, v);
  /** @param {number} v */
  const db = (v) => Math.max(FLOOR_DB, 20 * Math.log10(Math.max(v, 1e-12) / peak));
  const fine = mags.map((m) => Float32Array.from(m, db));
  const cells = new Float32Array(rows * COLUMNS);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < COLUMNS; c += 1) {
      let best = FLOOR_DB;
      for (let k = c * PER_COLUMN; k < (c + 1) * PER_COLUMN; k += 1) best = Math.max(best, fine[r][k]);
      cells[r * COLUMNS + c] = best;
    }
  }
  const out = { f0, block: Math.min(block, SOUND_MS), hop, rows, cells, fine };
  if (pictures.size > 24) pictures.clear();
  pictures.set(key, out);
  return out;
}

/**
 * The row whose strip holds time t.
 * @param {number} block ms
 * @param {number} t ms
 */
export function rowAt(block, t) {
  const { hop, rows } = layout(block);
  return Math.max(0, Math.min(rows - 1, Math.floor(t / hop)));
}

/**
 * Where row r's block sits in the sound, ms.
 * @param {number} block
 * @param {number} r
 * @returns {{centre: number, start: number, end: number}}
 */
export function blockSpan(block, r) {
  const { block: b, hop } = layout(block);
  const centre = (r + 0.5) * hop;
  return { centre, start: centre - b / 2, end: centre + b / 2 };
}

/**
 * The block lies inside one vowel (fades included), so its spectrum is a
 * harmonic series on f0 and its valleys can be measured.
 * @param {number} block
 * @param {number} r
 */
export function insideVowel(block, r) {
  const { start, end } = blockSpan(block, r);
  return [VOWEL_A, VOWEL_B].some(([a, b]) => start >= a - 1e-9 && end <= b + 1e-9);
}

/**
 * How deep the valleys between neighbouring harmonics are: for each pair
 * of harmonics k f0 and (k + 1) f0 up to VALLEY_TOP_HZ, the lower of the
 * two peaks (the loudest bin within 2 of each harmonic) less the lowest
 * bin between them; the median over the pairs. Near 0 dB the harmonics
 * have merged into one ridge.
 * @param {ArrayLike<number>} spectrum FINE levels, dB
 * @param {number} f0
 * @returns {number} dB
 */
export function valleyDepth(spectrum, f0) {
  /** @type {number[]} */
  const depths = [];
  /** @param {number} k */
  const peak = (k) => {
    let best = -Infinity;
    for (let j = k - 2; j <= k + 2; j += 1) best = Math.max(best, spectrum[j]);
    return best;
  };
  for (let k = 1; (k + 1) * f0 <= VALLEY_TOP_HZ; k += 1) {
    const a = Math.round((k * f0) / BIN_HZ);
    const b = Math.round(((k + 1) * f0) / BIN_HZ);
    let low = Infinity;
    for (let j = a; j <= b; j += 1) low = Math.min(low, spectrum[j]);
    depths.push(Math.min(peak(a), peak(b)) - low);
  }
  depths.sort((p, q) => p - q);
  const m = depths.length;
  return m % 2 ? depths[(m - 1) / 2] : (depths[m / 2 - 1] + depths[m / 2]) / 2;
}


/* ---------------------------------------------------------------------------
 * Display: colour by level, and the two plots, shared with the 3D part
 * ------------------------------------------------------------------------ */

const SLUG = "tradeoff";
const STEP_KEYS = /** @type {const} */ (["block", "f0", "at", "view", "preset"]);
/** Camera presets of the 3D view, in the order of the Camera group. */
export const PRESET_NAMES = /** @type {const} */ (["corner", "front", "top"]);
/**
 * Poses only a step asks for, on a wide frame and on a phone; while one
 * holds, no Camera button is pressed. "high": up over the front, above the
 * 3D view's cutaway (60 degrees), so every strip is surface, frequency
 * runs across and time up the frame: the click is a band (thin at 5 ms,
 * wide at 80 ms) and a harmonic is a ridge through every block.
 * @type {Record<string, [import("./lib/orbit.js").Pose, import("./lib/orbit.js").Pose]>}
 */
export const STEP_POSES = { high: [{ yaw: 10, pitch: 62 }, { yaw: 6, pitch: 62 }] };
/** The block the figure opens on, and the one its first-view animation starts from. */
export const START = { block: 20, f0: 120, at: 75 };
export const INTRO_BLOCK = 5;
const DESCRIBE_MS = 250;

/** @type {{theme: unknown, print: boolean, lut: number[]}} */
let levelCache = { theme: null, print: false, lut: [] };

/**
 * The colour of a level, 0xRRGGBB: the ramp from FLOOR_DB (ramp-0) to
 * 0 dB (ramp-4), the quiet end mixed toward the plot background so the
 * loud cells stand out. One table per theme (getTheme() is memoised until
 * the scheme changes) and per print state, a quarter dB per entry; both
 * views read it, so Top and the 2D spectrogram agree.
 * @param {number} db
 * @returns {number}
 */
export function levelColour(db) {
  const theme = getTheme();
  const print = printing();
  if (levelCache.theme !== theme || levelCache.print !== print) {
    const bg = tokenHex("--ambe-plot-bg");
    const steps = -FLOOR_DB * 4;
    // On a white ground the light ramp is already pale: the mix falls off
    // faster, so only the quietest cells go near white.
    const power = darkGround() ? 2 : 3;
    levelCache = {
      theme,
      print,
      lut: Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        return mix(rampColor(t), bg, 0.82 * (1 - t) ** power);
      }),
    };
  }
  return levelCache.lut[Math.round((Math.min(0, Math.max(FLOOR_DB, db)) - FLOOR_DB) * 4)];
}

/**
 * The two plots in a frame of this size: the spectrogram (frequency
 * across, time down) above the selected block's spectrum. The 2D drawing
 * and the 3D Top and Front fits all use it, so the views agree.
 * @param {{width: number, height: number}} size
 */
export function plotsFor(size) {
  const compact = size.width < 520;
  const left = compact ? 40 : 58;
  const right = compact ? 40 : 54;
  const top = 10;
  const bottom = compact ? 34 : 40;
  const gap = 16;
  const room = Math.max(40, size.height - top - bottom - gap);
  const gramHeight = Math.round(room * 0.56);
  const gram = createPlot(size, {
    xDomain: [0, MAX_HZ],
    yDomain: [SOUND_MS, 0],
    padding: { top, right, left, bottom: size.height - top - gramHeight },
  });
  const spec = createPlot(size, {
    xDomain: [0, MAX_HZ],
    yDomain: [FLOOR_DB, 0],
    padding: { top: top + gramHeight + gap, right, left, bottom },
  });
  return { gram, spec };
}

/**
 * What the 3D part draws: the 2D module's arrays, nothing to compute.
 * @typedef {Object} TradeoffState
 * @property {Picture} picture  the blocks now
 * @property {Picture | null} intro  the blocks the first-view animation
 *           starts from (5 ms), or null
 * @property {number} selected  row of the outlined block
 * @property {number} f0
 * @property {boolean} inside  the outlined block lies inside one vowel, so
 *           its harmonics are marked
 * @property {number} lobe  the Hann main lobe's width, 4/T, Hz
 * @property {string} chip  the highlight's fact
 * @property {string} introChip  its fact for the intro picture
 * @property {(db: number) => number} colour  levelColour
 * @property {(width: number, height: number) => {gram: import("./lib/orbit.js").PlotRect, spec: import("./lib/orbit.js").PlotRect}} rects
 * @property {string | null} preset  a camera preset a step asks for
 * @property {{start: number, end: number}} click  the strips holding the
 *           click, ms (clickStrips)
 */

/**
 * The strips whose blocks hold the click: from the first strip's start to
 * the last one's end, ms. One strip for a short block, the whole sound for
 * the whole sound.
 * @param {number} block ms
 * @returns {{start: number, end: number}}
 */
export function clickStrips(block) {
  const { block: b, hop, rows } = layout(block);
  let first = rows;
  let last = -1;
  for (let r = 0; r < rows; r += 1) {
    const { start, end } = blockSpan(b, r);
    if (start <= CLICK_MS && CLICK_MS < end) {
      first = Math.min(first, r);
      last = r;
    }
  }
  return { start: first * hop, end: (last + 1) * hop };
}

/**
 * The readout facts for a block length, as both views word them.
 * @param {number} block ms
 */
export function blockFacts(block) {
  const { block: b, hop, rows } = layout(block);
  const t = b / 1000;
  return {
    name: b >= SOUND_MS ? `whole sound (${SOUND_MS} ms)` : `${b} ms`,
    label: b >= SOUND_MS ? "whole sound as one block" : `block ${b} ms`,
    resolution: Math.round(1 / t * 10) / 10,
    lobe: Math.round(4 / t * 10) / 10,
    hop,
    rows,
  };
}

/** @param {number} v */
const hz = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/* ---------------------------------------------------------------------------
 * Markup
 * ------------------------------------------------------------------------ */

const TEMPLATE = `
  <div class="anim-figure__head">
    <p class="anim-figure__title">One sound, cut into blocks of one length: what the length buys and what it costs</p>
  </div>
  <div class="anim-figure__frame anim-tradeoff__frame" data-state="loading">
    <canvas class="anim-figure__canvas" role="img" aria-label="Loading the spectrogram"></canvas>
  </div>
  <div class="anim-tradeoff__readouts">
    <p class="anim-tradeoff__line"><output class="anim-tradeoff__value" data-ref="block-info"></output></p>
    <p class="anim-tradeoff__line"><output class="anim-tradeoff__value" data-ref="valley" aria-live="polite"></output></p>
  </div>
  <div class="anim-figure__step"></div>
  <ul class="anim-legend">
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-tradeoff__key--ramp"></i>level, -60 dB (dim) to 0 dB (bright)</li>
    <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch anim-tradeoff__key--box"></i>the outlined block, one strip of the spectrogram</li>
    <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch anim-legend__swatch--line anim-tradeoff__key--highlight"></i>its spectrum (thick)</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-tradeoff__key--comb"></i>where the harmonics of f0 are (ticks)</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-tradeoff__key--lobe"></i>main lobe width, 4/T (bar)</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-legend__swatch--line anim-tradeoff__key--highlight"></i>the outlined block's spectrum (thick, outlined)</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-legend__swatch--line anim-tradeoff__key--ramp"></i>every other block, earlier at the back; height and colour are level</li>
  </ul>
  <div class="anim-controls">
    <label class="anim-field">
      <span class="anim-field__label">Block</span>
      <input class="anim-range" data-ref="block" type="range" min="0" max="${BLOCKS_MS.length - 1}" step="1" value="2"
             aria-label="Block length">
    </label>
    <output class="anim-readout" data-ref="block-out"></output>
  </div>
  <div class="anim-controls">
    <label class="anim-field">
      <span class="anim-field__label">Pitch</span>
      <input class="anim-range" data-ref="f0" type="range" min="${F0_MIN}" max="${F0_MAX}" step="10" value="${START.f0}"
             aria-label="Pitch of the voice, f0">
    </label>
    <output class="anim-readout" data-ref="f0-out"></output>
  </div>
  <div class="anim-controls">
    <label class="anim-field">
      <span class="anim-field__label">Time</span>
      <input class="anim-range" data-ref="at" type="range" min="0" max="${SOUND_MS - 2.5}" step="2.5" value="${START.at}"
             aria-label="Which block to outline, by time">
    </label>
    <output class="anim-readout anim-readout--wide" data-ref="at-out"></output>
  </div>
  <div class="anim-controls">
    <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
    <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
      <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
      <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
      <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
    </div>
  </div>
  <p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
  <figcaption class="anim-figure__caption">A made-up sound, 400 ms at 8 kHz: a
    vowel with an "ah" shape, 40 ms of silence with a click at 230 ms, then a
    vowel with an "oh" shape, both on one pitch. Each block is
    Hann-windowed and transformed (4096 points); levels are in dB below the
    loudest point of the picture, floored at -60 dB. A block of T seconds
    puts its strips T/2 apart and has a main lobe 4/T wide.
    <span class="anim-figure__source">Source: computed in the page from the
    seeded sound; nothing is recorded or played.</span></figcaption>`;

/* ---------------------------------------------------------------------------
 * Mount
 * ------------------------------------------------------------------------ */

/**
 * @param {Element} host  an element carrying data-anim="tradeoff"
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-tradeoff";
  figure.dataset.view = "2d";
  figure.innerHTML = TEMPLATE;
  const fallback = host.querySelector(":scope > .anim-fallback");
  if (fallback) fallback.after(figure);
  else host.append(figure);
  markEnhanced(host);

  const frameBox = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frameBox, "canvas", HTMLCanvasElement);
  const blockInfo = $(figure, '[data-ref="block-info"]', HTMLOutputElement);
  const valleyOut = $(figure, '[data-ref="valley"]', HTMLOutputElement);
  const blockInput = $(figure, '[data-ref="block"]', HTMLInputElement);
  const blockOut = $(figure, '[data-ref="block-out"]', HTMLOutputElement);
  const f0Input = $(figure, '[data-ref="f0"]', HTMLInputElement);
  const f0Out = $(figure, '[data-ref="f0-out"]', HTMLOutputElement);
  const atInput = $(figure, '[data-ref="at"]', HTMLInputElement);
  const atOut = $(figure, '[data-ref="at-out"]', HTMLOutputElement);
  const toggle = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const cameraGroup = $(figure, '[data-ref="camera"]', HTMLElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  // Shown, by the view switch, only where 3D cannot run.
  hint.textContent = NO_WEBGL_HINT;
  const presetButtons = [...cameraGroup.querySelectorAll("button")].map((b) => /** @type {HTMLButtonElement} */ (b));
  caption.insertBefore(badge("synthetic"), caption.querySelector(".anim-figure__source"));
  delete frameBox.dataset.state;

  let block = START.block;
  let f0 = START.f0;
  let at = START.at;
  /** @type {string | null} */
  let preset = null;
  /** The 5 ms picture the 3D view's first animation starts from, until it has played. */
  let introFrom = true;
  /**
   * Where the figure will open in 3D with its animation, the 2D canvas
   * waits on the animation's first picture (5 ms blocks), so the hand-off
   * shows the same picture and the morph runs once, forward. Any reader
   * input, a view change or the 3D view failing ends it.
   */
  let placeholder = opensIn3D();
  /** The block the 2D canvas draws now. */
  const drawnBlock = () => (placeholder && block === START.block && f0 === START.f0 ? INTRO_BLOCK : block);

  const current = () => picture(f0, block);
  const selectedRow = () => rowAt(block, at);

  /** @param {number} b */
  const chipOf = (b) => {
    const facts = blockFacts(b);
    return `${facts.label}: 1/T = ${hz(facts.resolution)} Hz`;
  };

  /** @returns {TradeoffState} */
  const snapshot = () => {
    const p = current();
    const facts = blockFacts(block);
    return {
      picture: p,
      intro: introFrom && block !== INTRO_BLOCK ? picture(f0, INTRO_BLOCK) : null,
      selected: selectedRow(),
      f0,
      inside: insideVowel(block, selectedRow()),
      lobe: facts.lobe,
      chip: chipOf(block),
      introChip: chipOf(INTRO_BLOCK),
      colour: levelColour,
      rects: (width, height) => {
        const { gram, spec } = plotsFor({ width, height });
        return { gram: gram.area, spec: spec.area };
      },
      preset,
      click: clickStrips(block),
    };
  };

  /* -- readouts ---------------------------------------------------------- */

  /** The valley sentence for the outlined block, or why there is none. */
  const valleyText = () => {
    const r = selectedRow();
    if (!insideVowel(block, r)) return `harmonics ${f0} Hz apart · this block is not inside one vowel`;
    const depth = valleyDepth(current().fine[r], f0);
    return `harmonics ${f0} Hz apart · valleys between them in this block: ${depth.toFixed(1)} dB deep`;
  };

  const syncReadouts = () => {
    const facts = blockFacts(block);
    const span = blockSpan(block, selectedRow());
    blockInfo.value = `${facts.label} · 1/T = ${hz(facts.resolution)} Hz · Hann main lobe about 4/T = ` +
      `${hz(facts.lobe)} Hz wide · ${facts.rows === 1 ? "one strip" : `a strip every ${hz(facts.hop)} ms`}`;
    valleyOut.value = valleyText();
    blockInput.value = String(BLOCKS_MS.indexOf(block));
    blockOut.value = facts.name;
    blockInput.setAttribute("aria-valuetext", facts.name);
    f0Input.value = String(f0);
    f0Out.value = `${f0} Hz`;
    f0Input.setAttribute("aria-valuetext", `${f0} hertz`);
    atInput.value = String(at);
    const from = Math.max(0, span.start);
    const to = Math.min(SOUND_MS, span.end);
    atOut.value = `block ${hz(from)} to ${hz(to)} ms`;
    atInput.setAttribute("aria-valuetext", `the block from ${hz(from)} to ${hz(to)} milliseconds`);
  };

  /** The sentence for the 2D canvas. */
  const describeFlat = () => {
    const facts = blockFacts(block);
    const span = blockSpan(block, selectedRow());
    return `Spectrogram of a 400 ms made-up sound (a vowel, silence, a click at 230 ms, a second vowel) on a ` +
      `${f0} Hz pitch, cut into ${facts.name} blocks: ${facts.rows} strip${facts.rows === 1 ? "" : "s"}, 0 to 2 kHz across. ` +
      `Below it, the spectrum of the block from ${hz(Math.max(0, span.start))} to ${hz(Math.min(SOUND_MS, span.end))} ms. ` +
      `${valleyText().replace(/ · /g, ", ")}.`;
  };

  /* -- 2D drawing -------------------------------------------------------- */

  const view = setupCanvas(canvas, { onResize: () => draw() });
  const g = view.ctx;
  /** Offscreen cells, one pixel per cell. */
  const cellsCanvas = document.createElement("canvas");

  function draw() {
    const theme = getTheme();
    clearCanvas(g, view, theme.plotBg);
    const { gram, spec } = plotsFor(view);
    const shownBlock = drawnBlock();
    const p = picture(f0, shownBlock);
    const r = rowAt(shownBlock, at);
    const compact = view.width < 520;

    // The spectrogram, one pixel per cell, scaled up without smoothing.
    cellsCanvas.width = COLUMNS;
    cellsCanvas.height = p.rows;
    const c2 = /** @type {CanvasRenderingContext2D} */ (cellsCanvas.getContext("2d"));
    const image = c2.createImageData(COLUMNS, p.rows);
    for (let i = 0; i < p.cells.length; i += 1) {
      const hex = levelColour(p.cells[i]);
      image.data.set([hex >> 16, (hex >> 8) & 255, hex & 255, 255], i * 4);
    }
    c2.putImageData(image, 0, 0);
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(cellsCanvas, gram.area.x, gram.area.y, gram.area.width, gram.area.height);
    g.restore();
    const timeTicks = [0, 100, 200, 300, 400];
    drawAxes(g, gram, {
      xTicks: [],
      yTicks: timeTicks,
      formatY: (v) => `${v}`,
      yLabel: compact ? "" : "time (ms)",
    });
    // Where the parts of the sound are, beside the strips.
    g.save();
    g.font = `11px ${theme.font}`;
    g.fillStyle = theme.text3;
    g.textBaseline = "middle";
    g.textAlign = "left";
    for (const [label, t] of /** @type {[string, number][]} */ ([["vowel", 100], ["click", CLICK_MS], ["vowel", 320]])) {
      g.fillText(label, gram.area.right + 6, gram.y(t));
    }
    g.restore();

    // The outlined block: its strip, in the highlight.
    const highlight = theme.css("--ambe-highlight");
    const { hop } = layout(shownBlock);
    const y0 = gram.y(r * hop);
    const y1 = gram.y(Math.min(SOUND_MS, (r + 1) * hop));
    g.save();
    g.strokeStyle = highlight;
    g.lineWidth = 2;
    g.strokeRect(gram.area.left - 1, y0 - 1, gram.area.width + 2, Math.max(2, y1 - y0) + 2);
    g.restore();

    // The block's spectrum.
    const xTicks = [0, 500, 1000, 1500, 2000];
    drawGrid(g, spec, { xTicks, yTicks: [-60, -40, -20, 0] });
    drawAxes(g, spec, {
      xTicks,
      yTicks: [-60, -40, -20, 0],
      formatX: (v) => (v === 0 ? "0" : `${v / 1000}k`),
      formatY: (v) => String(v),
      xLabel: compact ? "" : "frequency (Hz)",
      yLabel: compact ? "" : "level (dB)",
    });
    const fine = p.fine[r];
    g.save();
    spec.clip(g);
    // The harmonics of f0, as dashed ticks along the top, when the block
    // is inside one vowel.
    if (insideVowel(shownBlock, r)) {
      g.strokeStyle = theme.muted;
      g.lineWidth = 1.5;
      g.setLineDash([3, 3]);
      g.beginPath();
      for (let k = 1; k * f0 <= MAX_HZ; k += 1) {
        const x = crisp(spec.x(k * f0));
        g.moveTo(x, spec.area.top);
        g.lineTo(x, spec.area.top + 12);
      }
      g.stroke();
      g.setLineDash([]);
    }
    g.beginPath();
    g.moveTo(spec.x(0), spec.y(FLOOR_DB));
    for (let k = 0; k < FINE; k += 1) g.lineTo(spec.x(k * BIN_HZ), spec.y(fine[k]));
    g.lineTo(spec.x(MAX_HZ), spec.y(FLOOR_DB));
    g.closePath();
    const fill = g.createLinearGradient(0, spec.area.top, 0, spec.area.bottom);
    fill.addColorStop(0, theme.css("--ambe-highlight-fill-top"));
    fill.addColorStop(1, theme.css("--ambe-highlight-fill-bottom"));
    g.fillStyle = fill;
    g.fill();
    g.beginPath();
    for (let k = 0; k < FINE; k += 1) {
      const x = spec.x(k * BIN_HZ);
      const y = spec.y(fine[k]);
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.strokeStyle = highlight;
    g.lineWidth = 2.4;
    g.lineJoin = "round";
    g.stroke();
    // The main lobe's width, 4/T, as a bar under the loudest peak.
    let loud = 0;
    for (let k = 1; k < FINE; k += 1) if (fine[k] > fine[loud]) loud = k;
    const facts = blockFacts(shownBlock);
    const lx0 = spec.x(loud * BIN_HZ - facts.lobe / 2);
    const lx1 = spec.x(loud * BIN_HZ + facts.lobe / 2);
    const ly = Math.max(spec.area.top + 18, spec.y(fine[loud]) - 10);
    g.strokeStyle = theme.ink;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(lx0, ly - 4);
    g.lineTo(lx0, ly + 4);
    g.moveTo(lx0, ly);
    g.lineTo(lx1, ly);
    g.moveTo(lx1, ly - 4);
    g.lineTo(lx1, ly + 4);
    g.stroke();
    g.fillStyle = theme.ink;
    g.font = `11px ${theme.font}`;
    g.textBaseline = "bottom";
    g.textAlign = lx1 + 40 > spec.area.right ? "right" : "left";
    g.fillText("4/T", g.textAlign === "right" ? lx0 - 4 : lx1 + 4, ly + 5);
    g.restore();
  }

  /* -- views ------------------------------------------------------------- */

  let describeTimer = 0;
  const describeSoon = () => {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      canvas.setAttribute("aria-label", describeFlat());
    }, DESCRIBE_MS);
  };

  /** @param {string | null} name */
  const pressPreset = (name) => {
    for (const b of presetButtons) b.setAttribute("aria-pressed", String(b.dataset.preset === name));
  };

  const sw = createViewSwitch({
    frame: frameBox,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: snapshot,
    load: () => import("./anim-tradeoff-3d.js"),
    id: SLUG,
    onView: (v) => {
      placeholder = false;
      const three = v === "3d";
      figure.dataset.view = three ? "3d" : "2d";
      cameraGroup.hidden = !three;
      if (three) {
        introFrom = false;
        pressPreset(preset ?? "corner");
      } else draw();
    },
  });

  /** Redraw the 2D view and the readouts; `to3D` passes the state on. */
  const refresh = (to3D = true) => {
    syncReadouts();
    draw();
    describeSoon();
    if (to3D) sw.update(snapshot());
  };

  /* -- steps and controls ------------------------------------------------ */

  /** The figure no longer waits on the 3D view's first picture. */
  const settle2D = () => {
    if (!placeholder) return;
    placeholder = false;
    draw();
  };
  // The view switch asked for 3D at once; if that ends without a 3D view
  // (no WebGL after all, a failed load), the control is released.
  const watch = new MutationObserver(() => {
    if (toggle.disabled || toggle.getAttribute("aria-pressed") === "false") settle2D();
  });
  watch.observe(toggle, { attributes: true, attributeFilter: ["disabled", "aria-pressed"] });
  signal.addEventListener("abort", () => watch.disconnect(), { once: true });
  if (toggle.disabled || toggle.getAttribute("aria-pressed") === "false") placeholder = false;

  /**
   * @param {Record<string, string>} state
   * @param {{animate?: boolean}} [how]  animate: a reader's step, not the first
   */
  const applyState = (state, how = {}) => {
    if (how.animate) placeholder = false;
    if (state.block !== undefined && BLOCKS_MS.includes(Number(state.block))) block = Number(state.block);
    if (state.f0 !== undefined) f0 = Math.min(F0_MAX, Math.max(F0_MIN, Math.round(Number(state.f0) / 10) * 10 || START.f0));
    if (state.at !== undefined) at = Math.min(SOUND_MS - 2.5, Math.max(0, Number(state.at) || 0));
    if (state.preset) {
      preset = state.preset;
      pressPreset(preset);
    }
    refresh();
    if (state.view === "3d") void sw.show3D();
    else if (state.view === "2d") sw.show2D();
    if (state.preset) sw.preset(state.preset);
  };

  // The sliders redraw the 2D view as they move; the 3D view rebuilds
  // once, on release, and morphs from the old picture to the new one.
  blockInput.addEventListener("input", () => {
    placeholder = false;
    block = BLOCKS_MS[Math.min(Math.max(Number(blockInput.value) | 0, 0), BLOCKS_MS.length - 1)];
    refresh(false);
  }, { signal });
  f0Input.addEventListener("input", () => {
    placeholder = false;
    f0 = Number(f0Input.value) || START.f0;
    refresh(false);
  }, { signal });
  for (const input of [blockInput, f0Input]) input.addEventListener("change", () => sw.update(snapshot()), { signal });
  atInput.addEventListener("input", () => {
    placeholder = false;
    at = Number(atInput.value) || 0;
    refresh();
  }, { signal });
  for (const button of presetButtons) {
    button.addEventListener("click", () => {
      preset = button.dataset.preset ?? "corner";
      pressPreset(preset);
      sw.preset(preset);
    }, { signal });
  }

  const unsubscribe = onThemeChange(() => draw());

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = {
      state: snapshot,
      view: () => sw.view(),
      /** The outlined block's spectrum on the 2D plot at every 64th bin, CSS px in the frame. */
      plotPoints: () => {
        const { spec } = plotsFor({ width: frameBox.clientWidth, height: frameBox.clientHeight });
        const fine = current().fine[selectedRow()];
        /** @type {[number, number][]} */
        const out = [];
        for (let k = 0; k < FINE; k += 64) out.push([spec.x(k * BIN_HZ), spec.y(fine[k])]);
        return out;
      },
      /** Corners of the spectrogram's cells (every 32nd column, every strip edge), CSS px. */
      gramPoints: () => {
        const { gram } = plotsFor({ width: frameBox.clientWidth, height: frameBox.clientHeight });
        const { hop, rows } = layout(block);
        /** @type {[number, number][]} */
        const out = [];
        for (let r = 0; r <= rows; r += Math.max(1, rows / 10)) {
          for (let c = 0; c <= COLUMNS; c += 32) out.push([gram.x((c * MAX_HZ) / COLUMNS), gram.y(r * hop)]);
        }
        return out;
      },
      /** The block the 2D canvas draws (the 5 ms placeholder before the first 3D view). */
      drawnBlock,
      valley: () => (insideVowel(block, selectedRow()) ? valleyDepth(current().fine[selectedRow()], f0) : null),
    };
  }

  syncReadouts();
  draw();
  canvas.setAttribute("aria-label", describeFlat());
  if (steps.length) createStepper(figure, steps, (state, how) => applyState(state, how), { signal });

  return () => {
    unsubscribe();
    view.destroy();
    clearTimeout(describeTimer);
    if (TEST_HOOK) delete TEST_HOOK.figures[SLUG];
  };
}
