// @ts-check
/* ===========================================================================
 * anim-vq-space.js: a scalar grid against a codebook of the same size, on
 * synthetic dots, then on measurements from the input clips (ch09,
 * three-figures plan Figure B; three-everywhere plan F11, design §5.10).
 * ---------------------------------------------------------------------------
 * The synthetic dots come from lib/vq.js, a seeded generator; nothing here
 * is AMBE data, an AMBE table, dimension or bit allocation. The codebook is
 * trained in the browser by Lloyd steps from the grid's own levels, so the
 * reader watches the grid turn into a codebook. The Speech dots
 * (harmonic-triples.json, tools/data/harmonic_triples.py) are levels of
 * harmonics 4, 5 and 6 measured on the input clips: a precomputed scatter,
 * plotted only. No codebook is trained on them; Codebook, Lloyd, Stretch
 * and Angle are off while they show.
 *
 * Views:
 *   - 2D (Canvas 2D): two numbers per dot, and the front view of three
 *     (the third number points out of the screen). The path under reduced
 *     motion and without WebGL.
 *   - 3D (anim-vq-space-3d.js, through lib/view-switch.js): the same model
 *     in a cube, two numbers flat on its front face. It opens on the first
 *     view when opensIn3D() (owner decision O1), with three numbers, and
 *     plays the reveal: the dots lift into depth, the cells fade in as
 *     faint cubes, the empty ones hatch and dim, a chip counts them, and
 *     the camera sweeps 120 degrees round the cube. The Front preset is the
 *     2D picture.
 *   - Play: the steps in order as one walk-through, each step's text as a
 *     caption a sentence at a time, with the camera moves and the step's
 *     own motion (the stretch rising, Lloyd steps, the probe leaving the
 *     cloud, the lift). Pause, the step slider, any control or the zoom
 *     hand it back to the reader. Under reduced motion it steps through the
 *     end states.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createPlot,
  drawAxes,
  drawLabel,
  getTheme,
  loadJSON,
  markEnhanced,
  onThemeChange,
  prefersReducedMotion,
  setupCanvas,
  tokenColor,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { createViewSwitch } from "./lib/view-switch.js";
import {
  CATS,
  CLOUD_SIZE,
  cellCategory,
  codebookStats,
  gridCodebook,
  gridQuantize,
  lloydStep,
  makeCloud,
  nearest,
  train,
} from "./lib/vq.js";

const SLUG = "vq-space";
const STEP_KEYS = /** @type {const} */ (["dims", "method", "bits", "rho", "probe", "train", "view", "data"]);
const ANGLE = 45;
const OFF_CLOUD = [0.7, -0.7];
const RASTER_PX = 4;
const TWEEN_MS = 250;
const DESCRIBE_MS = 250;
/** The most spokes the chosen entry draws, as in 3D. */
const STAR = 24;
const SPEECH_URL = "assets/data/harmonic-triples.json";

const CAPTION =
  "Synthetic data from a seeded generator. The codebook is trained here, in " +
  "your browser, on these dots. AMBE's tables are not public and are not shown.";
const SPEECH_CAPTION =
  "Levels of harmonics 4, 5 and 6 in 702 voiced frames of the eight input clips, each " +
  "against its frame's mean and then centred on its average over the frames, measured " +
  "from the input audio. Plotted only: no codebook is trained on them, and AMBE's " +
  "tables are not shown.";

const KEYS_HINT =
  "Probe: drag, or focus the plot and use the arrow keys; [ and ] step through the dots";
const KEYS_HINT_3D =
  "Drag sideways to turn the cube. Probe: focus the plot and use the arrow keys; " +
  "[ and ] step through the dots";
const KEYS_HINT_SPEECH = "Drag sideways to turn the cube; the line marks the cloud's long axis";

/**
 * What Play says in place of a step sentence that asks the reader to do
 * something Play then does itself, matched by the sentence's start.
 * @type {Array<[RegExp, string[]]>}
 */
const PLAY_LINES = [
  [/^Drag Stretch/, ["Watch the stretch fall back and rise again: the empty cells come and go."]],
  [/^Press One Lloyd step/, ["Watch the Lloyd steps, one at a time."]],
  [/^Drag the probe/, ["The grid's error at the same spot is far smaller, as the readout shows."]],
  [/^Drag sideways to turn the cube/, [
    "Turned slowly, the band shows from each side, with the empty cubes round it.",
    "Switched to Codebook and trained, all 64 entries land on the band.",
  ]],
];

/** Reading pace of a caption sentence, and its floor, in ms. */
const MS_PER_WORD = 290;
const MIN_SENTENCE_MS = 2200;

/**
 * @typedef {Object} State
 * @property {"synthetic" | "speech"} data
 * @property {2 | 3} dims
 * @property {"none" | "grid" | "codebook"} method
 * @property {number} bits
 * @property {number} rho
 * @property {number} angle
 * @property {number[]} probe  length 3; the 2-number view uses x and y
 * @property {"entry" | "error"} focus  the step's subject: the probe's
 *           entry, or (the probe off the cloud) its error
 */

/**
 * What the 3D part offers the walk-through and the steps, once it is up.
 * @typedef {Object} VqView
 * @property {(opts?: {full?: boolean}) => Promise<void>} reveal  the turn,
 *           the lift, the cells with the empty ones dimmed and counted, and
 *           the sweep; full: one beat after another from Front, else all
 *           together within 1.2 s
 * @property {() => Promise<void>} flatten  three numbers down to two
 * @property {(from: Float32Array, ms?: number) => Promise<void>} entries
 *           the drawn entries from `from` to the scene's, the spokes attached
 * @property {(dyaw: number, ms: number) => Promise<void>} turnBy
 * @property {(name: string) => Promise<void>} preset
 * @property {(points: number[][], most: number) => Promise<void>} closeUp
 *           zoom until the points fill the frame, `most` times at the most
 * @property {() => Promise<void>} resetView
 * @property {() => Promise<void>} pulse
 * @property {() => void} finish
 * @property {() => string} shows  the dims and data it draws, "3|synthetic"
 */

/**
 * The 2D module's link to its 3D part: the part sets `view` while it is up.
 * @typedef {{view: VqView | null}} VqLink
 */

/**
 * Everything the 3D part draws: the 2D module's arrays, never computed
 * there.
 * @typedef {Object} VqScene
 * @property {"synthetic" | "speech"} data
 * @property {2 | 3} dims
 * @property {"none" | "grid" | "codebook"} method
 * @property {number} bits
 * @property {number} n  dots
 * @property {Float32Array} pts  n x 3, in the cube's -1 to 1
 * @property {Float32Array} entries  K x dims, the active entries
 * @property {Uint16Array} assign  each dot's entry
 * @property {Uint32Array} count  dots per entry
 * @property {Uint8Array} cats  colour category of each entry
 * @property {{m: number, used: Uint32Array, empty: number, cats: Uint8Array}} cells
 *           the grid the bits buy (cell k in gridQuantize's order), whether
 *           or not it is the quantizer
 * @property {number[]} probe
 * @property {boolean} showProbe
 * @property {number} chosen  the probe's nearest entry, -1 when none
 * @property {"entry" | "error"} focus
 * @property {{code: number, grid: number}} probeErr  the probe's squared
 *           error with the active entries and with the grid
 * @property {{from: number[], to: number[], spread: number} | null} axis
 * @property {string[]} names  the three axis names
 * @property {string[]} ends  the end values at -0.75 and 0.75
 * @property {() => {x: number, y: number, width: number, height: number}} plotRect
 * @property {(target: HTMLCanvasElement, size: number) => void} paintCells
 *           the 2-number cell layer (colours, hatch, grid lines) over -1 to 1
 * @property {string} label  the canvas description
 * @property {VqLink} link
 */

/** @param {number} v */
const f4 = (v) => v.toFixed(4);
/** @param {number} t */
const ease = (t) => 1 - (1 - t) ** 3;
/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A tween on its own animation frames for the 2D canvas, when no 3D view
 * runs one; one call with t = 1 under reduced motion.
 * @param {number} ms
 * @param {(t: number) => void} step
 * @returns {() => void} cancels it where it stands
 */
function run2d(ms, step) {
  if (prefersReducedMotion()) {
    step(1);
    return () => {};
  }
  let id = 0;
  const begin = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - begin) / ms);
    step(t);
    if (t < 1) id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

/**
 * A step's text, a sentence at a time, for the walk-through's captions.
 * @param {string} text
 * @returns {string[]}
 */
export function sentences(text) {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.!?:])\s+(?=[A-Z])/).filter(Boolean);
}

/**
 * Keep the frame on whole CSS pixels. The aspect ratio alone gives a
 * fractional height (672.75 px at 1280), and the text above puts the
 * frame's top between two pixels. Then an edit above the figure moves the
 * frame by a fraction of a pixel, and its screenshot shifts by a row. Here
 * the height is the aspect ratio's height rounded to a pixel, and a
 * relative `top` of under a pixel lifts the frame's top onto the grid. That
 * `top` moves only the frame's paint, so the page's layout stays put.
 *
 * It refits a frame later, when the frame or the article around it changes
 * size, or when a style changes. The frame's style can change its aspect
 * ratio, and a box around it can move by a relative offset of its own. A
 * refit sets only what differs, so its own writes end there.
 *
 * @param {HTMLElement} frame
 * @param {AbortSignal} signal
 */
function holdOnPixels(frame, signal) {
  let queued = 0;
  let top = 0;
  const fit = () => {
    queued = 0;
    const box = frame.getBoundingClientRect();
    if (!box.width) return;
    const ratio = getComputedStyle(frame).aspectRatio.match(/[\d.]+/g)?.map(Number);
    if (ratio?.length === 2 && ratio[0] > 0) {
      const height = `${Math.round((box.width * ratio[1]) / ratio[0])}px`;
      if (frame.style.height !== height) frame.style.height = height;
    } else if (frame.style.height) {
      // Expanded, the frame drops its aspect ratio and takes its height
      // from lib/expand.js, which an inline height would override.
      frame.style.height = "";
    }
    // Where the frame's top sits in the page, without the lift from last time.
    const y = box.top - document.documentElement.getBoundingClientRect().top - top;
    const lift = Math.ceil(y - 1e-3) - y;
    top = lift > 1e-3 ? lift : 0;
    const value = top ? `${top}px` : "";
    if (frame.style.top !== value) frame.style.top = value;
  };
  const refit = () => {
    if (!queued) queued = requestAnimationFrame(fit);
  };
  // A refit waits for the next frame: a height set inside a ResizeObserver
  // callback would resize what it observes and raise a loop error.
  const sizes = new ResizeObserver(refit);
  sizes.observe(frame);
  const styles = new MutationObserver(refit);
  const article = frame.closest("article") || document.body;
  for (let el = /** @type {Element | null} */ (frame); el && el !== article; el = el.parentElement) {
    styles.observe(el, { attributes: true, attributeFilter: ["style"] });
  }
  sizes.observe(article);
  fit();
  signal.addEventListener("abort", () => {
    sizes.disconnect();
    styles.disconnect();
    cancelAnimationFrame(queued);
  }, { once: true });
}

/**
 * @param {Element} host
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);

  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-vq";
  figure.innerHTML = `
    <div class="anim-figure__head">
      <p class="anim-figure__title">The same bits, spent on a grid or on a codebook</p>
      <p class="anim-figure__subtitle" data-ref="subtitle">${CLOUD_SIZE} synthetic dots</p>
    </div>
    <div class="anim-figure__frame anim-vq__frame--flat" style="--anim-aspect: 4 / 3">
      <canvas class="anim-figure__canvas anim-vq__plot" role="img" tabindex="0"
              aria-label="Synthetic dots"></canvas>
    </div>
    <div class="anim-vq__play" data-ref="play-row" hidden>
      <button class="anim-btn anim-vq__play-button" type="button" data-ref="play" aria-pressed="false">Play</button>
      <label class="anim-field anim-vq__scrub">
        <span class="anim-field__label">Step</span>
        <input class="anim-range" data-ref="scrub" type="range" min="1" max="1" step="1" value="1">
      </label>
      <output class="anim-readout" data-ref="scrub-out">1 of 1</output>
    </div>
    <p class="anim-vq__caption" data-ref="caption" aria-hidden="true" hidden></p>
    <p class="anim-vq__readout"><output data-ref="readout" aria-live="polite"></output></p>
    <div class="anim-figure__step"></div>
    <ul class="anim-legend">
      <li class="anim-legend__item"><i class="anim-vq__key anim-vq__key--dot"></i><span data-ref="dot-key">synthetic dot</span></li>
      <li class="anim-legend__item" data-ref="entry-key"><i class="anim-vq__key anim-vq__key--entry"></i>grid level or codebook entry</li>
      <li class="anim-legend__item" data-ref="chosen-key" hidden><i class="anim-vq__key anim-vq__key--chosen"></i><span data-ref="chosen-text">the probe's entry (large, outlined), joined to its dots</span></li>
      <li class="anim-legend__item" data-ref="hatch-key"><i class="anim-vq__key anim-vq__key--hatch"></i><span data-ref="hatch-text">cell no dot falls in</span></li>
      <li class="anim-legend__item" data-ref="ring-key" hidden><i class="anim-vq__key anim-vq__key--ring"></i><span data-ref="ring-text">grid cube no dot falls in</span></li>
      <li class="anim-legend__item" data-ref="probe-key"><i class="anim-vq__key anim-vq__key--probe"></i>probe, joined to its nearest entry</li>
    </ul>
    <div class="anim-controls">
      <div class="anim-toggle-group" role="group" aria-label="Numbers per dot">
        <button class="anim-btn" type="button" data-dims="2" aria-pressed="true">2 numbers</button>
        <button class="anim-btn" type="button" data-dims="3" aria-pressed="false">3 numbers</button>
        <button class="anim-btn" type="button" data-data="speech" aria-pressed="false">Speech</button>
      </div>
      <div class="anim-toggle-group" role="group" aria-label="Quantizer">
        <button class="anim-btn" type="button" data-method="grid" aria-pressed="false">Grid</button>
        <button class="anim-btn" type="button" data-method="codebook" aria-pressed="false">Codebook</button>
      </div>
      <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D view</button>
      <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
        <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
        <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
        <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
      </div>
      <label class="anim-field">
        <span class="anim-field__label">Bits</span>
        <input class="anim-range" data-ref="bits" type="range" min="2" max="6" step="2" value="4">
      </label>
      <output class="anim-readout" data-ref="bits-out">4</output>
      <label class="anim-field">
        <span class="anim-field__label">Stretch</span>
        <input class="anim-range" data-ref="rho" type="range" min="0" max="0.95" step="0.05" value="0.5">
      </label>
      <output class="anim-readout" data-ref="rho-out">0.50</output>
      <label class="anim-field">
        <span class="anim-field__label">Angle</span>
        <input class="anim-range" data-ref="angle" type="range" min="0" max="90" step="5" value="${ANGLE}">
      </label>
      <output class="anim-readout" data-ref="angle-out">${ANGLE}°</output>
      <div class="anim-controls__group">
        <button class="anim-btn" type="button" data-ref="lloyd">One Lloyd step</button>
        <button class="anim-btn" type="button" data-ref="train">Train to convergence</button>
      </div>
    </div>
    <p class="anim-figure__hint anim-vq__keys" data-ref="keys">${KEYS_HINT}</p>
    <p class="anim-figure__hint anim-figure__hint--webgl" hidden>${NO_WEBGL_HINT}</p>
    <figcaption class="anim-figure__caption"></figcaption>`;
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  holdOnPixels(frame, signal);
  const flat = $(frame, "canvas", HTMLCanvasElement);
  const subtitle = $(figure, '[data-ref="subtitle"]', HTMLElement);
  const readout = $(figure, '[data-ref="readout"]', HTMLOutputElement);
  const bitsInput = $(figure, '[data-ref="bits"]', HTMLInputElement);
  const rhoInput = $(figure, '[data-ref="rho"]', HTMLInputElement);
  const angleInput = $(figure, '[data-ref="angle"]', HTMLInputElement);
  const bitsOut = $(figure, '[data-ref="bits-out"]', HTMLOutputElement);
  const rhoOut = $(figure, '[data-ref="rho-out"]', HTMLOutputElement);
  const angleOut = $(figure, '[data-ref="angle-out"]', HTMLOutputElement);
  const lloydButton = $(figure, '[data-ref="lloyd"]', HTMLButtonElement);
  const trainButton = $(figure, '[data-ref="train"]', HTMLButtonElement);
  const cameraGroup = $(figure, '[data-ref="camera"]', HTMLElement);
  const view3d = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const webglHint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const dotKey = $(figure, '[data-ref="dot-key"]', HTMLElement);
  const hatchKey = $(figure, '[data-ref="hatch-key"]', HTMLElement);
  const hatchText = $(figure, '[data-ref="hatch-text"]', HTMLElement);
  const hatchMark = $(hatchKey, "i", HTMLElement);
  const ringKey = $(figure, '[data-ref="ring-key"]', HTMLElement);
  const ringText = $(figure, '[data-ref="ring-text"]', HTMLElement);
  const entryKey = $(figure, '[data-ref="entry-key"]', HTMLElement);
  const chosenKey = $(figure, '[data-ref="chosen-key"]', HTMLElement);
  const chosenText = $(figure, '[data-ref="chosen-text"]', HTMLElement);
  const probeKey = $(figure, '[data-ref="probe-key"]', HTMLElement);
  const probeMark = $(probeKey, "i", HTMLElement);
  const keysHint = $(figure, '[data-ref="keys"]', HTMLElement);
  const playRow = $(figure, '[data-ref="play-row"]', HTMLElement);
  const playButton = $(figure, '[data-ref="play"]', HTMLButtonElement);
  const scrub = $(figure, '[data-ref="scrub"]', HTMLInputElement);
  const scrubOut = $(figure, '[data-ref="scrub-out"]', HTMLOutputElement);
  const captionLine = $(figure, '[data-ref="caption"]', HTMLElement);
  const dimsButtons = [...figure.querySelectorAll("[data-dims]")].map((b) => /** @type {HTMLButtonElement} */ (b));
  const dataButtons = [...figure.querySelectorAll("[data-data]")].map((b) => /** @type {HTMLButtonElement} */ (b));
  const methodButtons = [...figure.querySelectorAll("[data-method]")].map((b) => /** @type {HTMLButtonElement} */ (b));
  const presetButtons = [...figure.querySelectorAll("[data-preset]")].map((b) => /** @type {HTMLButtonElement} */ (b));

  /* -------------------------------------------------------------------------
   * Model
   * ---------------------------------------------------------------------- */

  /** @type {State} */
  const state = {
    data: "synthetic", dims: 2, method: "none", bits: 4, rho: 0.5, angle: ANGLE, probe: [0, 0, 0], focus: "entry",
  };
  /** The dots now: synthetic or speech, n x 3. */
  let pts = makeCloud({ rho: state.rho, angleDeg: state.angle });
  let n = CLOUD_SIZE;
  /** The Speech dots, in the cube's -1 to 1, once loaded. @type {Float32Array | null} */
  let speech = null;
  /** @type {{spread: number[], axis: number[]} | null} */
  let speechMeta = null;
  let grid = gridQuantize(pts, state.dims, state.bits);
  let gridBook = gridCodebook(pts, state.dims, state.bits);
  let book = gridCodebook(pts, state.dims, state.bits);
  /** Entries as the 2D canvas draws them: the active ones except during a 2D tween. */
  let shown = new Float32Array(0);
  let probeDot = 0;
  /** Bumped when the drawn entries jump; the 3D part tweens from `tweenFrom`. */
  /** @type {Float32Array | null} */
  let tweenFrom = null;

  /** The walk-through runs (Play). */
  let playing = false;
  /** Bumped on every start and stop; a beat that sees it change gives up. */
  let playRun = 0;

  /** Cancels the running 2D entry tween; reset() calls it before `shown` is replaced. */
  let stopTween = () => {};

  /** The colour category of entry or grid cell k at the current size. */
  const catOf = (/** @type {number} */ k) => cellCategory(k, state.dims, state.bits);
  const isSpeech = () => state.data === "speech";

  /**
   * The grid on any dots: gridQuantize() for the synthetic cloud (its
   * numbers are the chapter's), the same rule on the Speech dots.
   * @returns {{mse: number, cells: number, empty: number, used: Uint32Array}}
   */
  const quantize = () => {
    if (!isSpeech()) return gridQuantize(pts, state.dims, state.bits);
    const m = 2 ** (state.bits / state.dims);
    const used = new Uint32Array(m ** state.dims);
    let err = 0;
    for (let i = 0; i < n; i += 1) {
      let cell = 0;
      for (let j = 0; j < state.dims; j += 1) {
        const v = pts[i * 3 + j];
        const q = Math.min(m - 1, Math.floor(((v + 1) / 2) * m));
        err += (v - (-1 + (2 * q + 1) / m)) ** 2;
        cell = cell * m + q;
      }
      used[cell] += 1;
    }
    let empty = 0;
    for (const u of used) if (!u) empty += 1;
    return { mse: err / (n * state.dims), cells: m ** state.dims, empty, used };
  };

  /** The grid's levels as entries, each Speech dot sent as its cell's. */
  const speechBook = () => {
    const m = 2 ** (state.bits / state.dims);
    const K = m ** state.dims;
    const codebook = new Float32Array(K * state.dims);
    for (let k = 0; k < K; k += 1) {
      let rest = k;
      for (let j = state.dims - 1; j >= 0; j -= 1) {
        codebook[k * state.dims + j] = -1 + (2 * (rest % m) + 1) / m;
        rest = Math.floor(rest / m);
      }
    }
    const assign = new Uint16Array(n);
    for (let i = 0; i < n; i += 1) {
      let cell = 0;
      for (let j = 0; j < state.dims; j += 1) {
        cell = cell * m + Math.min(m - 1, Math.floor(((pts[i * 3 + j] + 1) / 2) * m));
      }
      assign[i] = cell;
    }
    return { codebook, assign };
  };

  /** The mean of the dots, in all three numbers. */
  const centre = () => {
    const c = [0, 0, 0];
    for (let i = 0; i < n; i += 1) for (let j = 0; j < 3; j += 1) c[j] += pts[i * 3 + j] / n;
    return c;
  };
  /** @returns {Float32Array} */
  const activeEntries = () => (state.method === "codebook" ? book.codebook : gridBook.codebook);
  /** @returns {Uint16Array} */
  const activeAssign = () => (state.method === "codebook" ? book.assign : gridBook.assign);

  /** The z of the dot nearest the probe in x and y, for the 3-number probe. */
  const settleProbeZ = () => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = (pts[i * 3] - state.probe[0]) ** 2 + (pts[i * 3 + 1] - state.probe[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    state.probe[2] = pts[best * 3 + 2];
  };

  /** Rebuild the grid and restart the codebook from it. */
  const reset = () => {
    stopTween();
    grid = quantize();
    if (isSpeech()) {
      gridBook = speechBook();
      book = gridBook;
    } else {
      gridBook = gridCodebook(pts, state.dims, state.bits);
      book = gridCodebook(pts, state.dims, state.bits);
    }
    shown = Float32Array.from(activeEntries());
    tweenFrom = null;
    rasterKey = "";
  };
  /** @param {boolean} [keepProbe] */
  const reshape = (keepProbe = true) => {
    if (!isSpeech()) {
      pts = makeCloud({ rho: state.rho, angleDeg: state.angle });
      n = CLOUD_SIZE;
    }
    if (!keepProbe) state.probe = centre();
    reset();
  };

  /** @param {"synthetic" | "speech"} data */
  const useData = (data) => {
    state.data = data === "speech" && speech ? "speech" : "synthetic";
    if (isSpeech() && speech) {
      pts = speech;
      n = speech.length / 3;
      state.method = "grid";
    } else {
      pts = makeCloud({ rho: state.rho, angleDeg: state.angle });
      n = CLOUD_SIZE;
    }
    probeDot = 0;
  };

  const loadSpeech = async () => {
    if (speech) return true;
    try {
      const doc = /** @type {{points: number[], range_db: number, spread_db: number[], axis: number[]}} */ (
        await loadJSON(SPEECH_URL, { signal }));
      const scale = 10 * doc.range_db;
      speech = Float32Array.from(doc.points, (v) => v / scale);
      speechMeta = { spread: doc.spread_db, axis: doc.axis };
      return true;
    } catch (error) {
      if (!signal.aborted) console.error("vq-space: the Speech dots failed to load", error);
      return false;
    }
  };

  /** @param {2 | 3} dims */
  const fitBits = (dims) => {
    if (dims === 3) return state.bits >= 4 ? 6 : 3;
    return state.bits <= 3 ? 2 : state.bits >= 6 ? 6 : 4;
  };

  /** The cloud's long axis, through its mean, 2 spreads each way, for Speech. */
  const speechAxis = () => {
    if (!isSpeech() || !speechMeta) return null;
    const c = centre();
    const s = (2 * speechMeta.spread[0]) / 30;
    const a = speechMeta.axis;
    return {
      from: c.map((v, j) => Math.max(-1, Math.min(1, v - s * a[j]))),
      to: c.map((v, j) => Math.max(-1, Math.min(1, v + s * a[j]))),
      spread: speechMeta.spread[0],
    };
  };

  /* -------------------------------------------------------------------------
   * Readout and description
   * ---------------------------------------------------------------------- */

  /** The probe's error with the active entries and with the grid. */
  const probeErrors = () => {
    const p = state.probe.slice(0, state.dims);
    const grid = nearest(p, gridBook.codebook, state.dims).mse;
    return { code: state.method === "codebook" ? nearest(p, book.codebook, state.dims).mse : grid, grid };
  };
  const probeLine = () => {
    if (state.method === "none" || isSpeech()) return "";
    const { code, grid: g } = probeErrors();
    if (state.method === "grid") return `probe error ${f4(g)}`;
    return `probe error ${f4(code)} (grid ${f4(g)})`;
  };

  const statsLine = () => {
    const word = state.dims === 2 ? "two" : "three";
    const unit = state.dims === 2 ? "cells" : "cubes";
    if (isSpeech()) {
      const spread = speechMeta ? speechMeta.spread : [0, 0, 0];
      return `${n} voiced frames, harmonics 4, 5 and 6 each, ${state.bits} bits, grid, ` +
        `${grid.empty} of ${grid.cells} ${unit} never used; spread along the cloud's axes ` +
        `${spread.map((v) => v.toFixed(1)).join(", ")} dB`;
    }
    if (state.method === "none") {
      return `${CLOUD_SIZE} dots, ${word} numbers each, ${state.bits} bits to spend on each dot`;
    }
    if (state.method === "grid") {
      return `${state.bits} bits, grid, mean squared error ${f4(grid.mse)}, ` +
        `${grid.empty} of ${grid.cells} ${unit} never used`;
    }
    const s = codebookStats(pts, state.dims, book);
    return `${state.bits} bits, codebook, mean squared error ${f4(s.mse)} (grid ${f4(grid.mse)}), ` +
      `${s.used} of ${s.cells} ${unit} used`;
  };

  const writeReadout = () => {
    const probe = probeLine();
    readout.value = probe ? `${statsLine()}; ${probe}` : statsLine();
  };

  /** The sentence both canvases carry. */
  const sentence = () => {
    if (isSpeech()) {
      const spread = speechMeta ? speechMeta.spread : [0, 0, 0];
      return `${n} voiced frames of the input clips in three numbers, the levels of harmonics 4, 5 and 6, ` +
        `crowded along one line: spreads ${spread.map((v) => v.toFixed(1)).join(", ")} dB. ` +
        `${state.bits}-bit grid: ${grid.empty} of ${grid.cells} cubes empty.`;
    }
    const shape = state.rho >= 0.7 ? "crowded onto a thin tilted band" : "in three loose clumps";
    const word = state.dims === 2 ? "two" : "three";
    let text = `${CLOUD_SIZE} synthetic dots in ${word} numbers, ${shape}.`;
    if (state.method === "grid") {
      const unit = state.dims === 2 ? "cells" : "cubes";
      text += ` ${state.bits}-bit grid: ${grid.empty} of ${grid.cells} ${unit} empty, ` +
        `mean squared error ${f4(grid.mse)}.`;
    } else if (state.method === "codebook") {
      const s = codebookStats(pts, state.dims, book);
      text += ` ${state.bits}-bit codebook: ${s.used} of ${s.cells} entries used, ` +
        `mean squared error ${f4(s.mse)}, grid ${f4(grid.mse)}.`;
    }
    const probe = probeLine();
    if (probe) text += ` Probe at ${state.probe.slice(0, state.dims).map((v) => v.toFixed(2)).join(", ")}, ${probe}.`;
    return text;
  };

  let describeTimer = 0;
  const describe = () => {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      flat.setAttribute("aria-label", sentence());
    }, DESCRIBE_MS);
  };

  /* -------------------------------------------------------------------------
   * 2D view
   * ---------------------------------------------------------------------- */

  const handle = setupCanvas(flat, { onResize: () => draw2d() });

  /** @type {HTMLCanvasElement} */
  const raster = document.createElement("canvas");
  let rasterKey = "";

  /** The square plot, centred in the frame. */
  const layout = () => {
    const w = handle.width;
    const h = handle.height;
    const top = 12;
    const bottom = 40;
    const side = Math.max(40, Math.min(h - top - bottom, w - 72));
    const left = Math.round((w - side) / 2 + 10);
    return createPlot(handle, {
      xDomain: [-1, 1],
      yDomain: [-1, 1],
      padding: { top, bottom: h - top - side, left, right: w - left - side },
    });
  };
  /** The plot square in CSS px of the frame, for the 3D view's Front fit. */
  const plotRect = () => {
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const side = Math.max(40, Math.min(h - 52, w - 72));
    return { x: Math.round((w - side) / 2 + 10), y: 12, width: side, height: side };
  };

  /** @param {number} c a colour category, 0 to CATS - 1 */
  const catName = (c) => `--ambe-cat-${c + 1}`;

  /**
   * Fill each raster cell with the colour of its nearest entry, n cells a
   * side, cached until the entries or n change.
   * @param {HTMLCanvasElement} target
   * @param {number} cells
   * @param {Float32Array} entries
   * @param {string} key
   * @returns {string} the new key
   */
  const paintRaster = (target, cells, entries, key) => {
    const next = `${cells}|${state.method}|${state.bits}|${entries.join(",")}`;
    if (next === key) return key;
    target.width = cells;
    target.height = cells;
    const rctx = target.getContext("2d");
    if (!rctx) return next;
    const image = rctx.createImageData(cells, cells);
    const colours = Array.from({ length: CATS }, (_, k) => {
      const { hex } = tokenColor(catName(k));
      return hex;
    });
    const m = 2 ** (state.bits / 2);
    for (let row = 0; row < cells; row += 1) {
      const y = 1 - ((row + 0.5) / cells) * 2;
      for (let col = 0; col < cells; col += 1) {
        const x = ((col + 0.5) / cells) * 2 - 1;
        let k = 0;
        if (state.method === "grid") {
          const qx = Math.min(m - 1, Math.floor(((x + 1) / 2) * m));
          const qy = Math.min(m - 1, Math.floor(((y + 1) / 2) * m));
          k = qx * m + qy;
        } else {
          k = nearest([x, y], entries, 2).k;
        }
        const hex = colours[catOf(k)];
        const at = (row * cells + col) * 4;
        image.data[at] = Math.floor(hex / 65536);
        image.data[at + 1] = Math.floor(hex / 256) % 256;
        image.data[at + 2] = hex % 256;
        image.data[at + 3] = 41; // 0.16 of full alpha
      }
    }
    rctx.putImageData(image, 0, 0);
    return next;
  };

  /**
   * The 2-number cells: colours, then the grid's empty-cell hatch and its
   * lines, over `area`. The 2D plot and the 3D view's front face share it.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{left: number, top: number, right: number, bottom: number, width: number, height: number}} area
   * @param {HTMLCanvasElement} cellsCanvas the painted raster
   * @param {number} hatchPx gap between hatch lines
   */
  const drawCells = (ctx, area, cellsCanvas, hatchPx) => {
    const theme = getTheme();
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cellsCanvas, area.left, area.top, area.width, area.height);
    ctx.restore();
    if (state.method !== "grid") return;
    const m = 2 ** (state.bits / 2);
    const cell = area.width / m;
    ctx.save();
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = hatchPx / 7;
    for (let q = 0; q < m; q += 1) {
      for (let r = 0; r < m; r += 1) {
        if (grid.used[q * m + r]) continue;
        const x0 = area.left + q * cell;
        const y0 = area.bottom - (r + 1) * cell;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, cell, cell);
        ctx.clip();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        for (let d = -cell; d < cell; d += hatchPx) {
          ctx.moveTo(x0 + d, y0 + cell);
          ctx.lineTo(x0 + d + cell, y0);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.beginPath();
    for (let q = 1; q < m; q += 1) {
      const x = Math.round(area.left + q * cell) + 0.5;
      const y = Math.round(area.top + q * cell) + 0.5;
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
    }
    ctx.stroke();
    ctx.restore();
  };

  /** The 3D view's front-face texture: the cells over the whole canvas. */
  const texRaster = document.createElement("canvas");
  let texKey = "";
  /**
   * @param {HTMLCanvasElement} target
   * @param {number} size px
   */
  const paintCells = (target, size) => {
    target.width = target.height = size;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    if (state.method === "none" || state.dims !== 2) return;
    texKey = paintRaster(texRaster, Math.round(size / RASTER_PX), activeEntries(), texKey);
    drawCells(ctx, { left: 0, top: 0, right: size, bottom: size, width: size, height: size }, texRaster, 7 * size / 400);
  };

  const draw2d = () => {
    if (flat.hidden || !handle.width) return;
    const ctx = handle.ctx;
    const theme = getTheme();
    clearCanvas(ctx, handle);
    const plot = layout();
    const { area } = plot;
    const two = state.dims === 2;
    const entries = shown.length ? shown : activeEntries();
    const dims = state.dims;

    if (state.method !== "none" && two) {
      rasterKey = paintRaster(raster, Math.max(2, Math.round(plot.area.width / RASTER_PX)), entries, rasterKey);
      drawCells(ctx, area, raster, 7);
    }

    const speechNow = isSpeech();
    const tickValues = [-1, -0.5, 0, 0.5, 1];
    drawAxes(ctx, plot, {
      xTicks: tickValues,
      yTicks: tickValues,
      xLabel: speechNow ? "harmonic 4 (dB, centred)" : "first number",
      formatX: (v) => (speechNow ? String(v * 30) : String(v)),
      formatY: (v) => (speechNow ? String(v * 30) : String(v)),
    });
    ctx.save();
    ctx.translate(area.left - 30, (area.top + area.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    drawLabel(ctx, speechNow ? "harmonic 5 (dB, centred)" : "second number", 0, 0,
      { align: "center", baseline: "bottom", size: 11, color: theme.muted });
    ctx.restore();
    if (!two) {
      drawLabel(ctx, speechNow ? "Front view: harmonic 6 points out of the screen"
        : "Front view: the third number points out of the screen", area.left + 6, area.top + 6,
      { baseline: "top", size: 11, color: theme.muted, background: theme.plotBg, padding: 3 });
      if (state.method === "grid" && !speechNow) {
        const m = 2 ** (state.bits / 3);
        drawLabel(ctx, `Each mark is ${m} cubes, one behind another`, area.left + 6, area.top + 26,
          { baseline: "top", size: 11, color: theme.muted, background: theme.plotBg, padding: 3 });
      }
    }

    // Two numbers: ink dots over the coloured cells. Three numbers (no
    // WebGL): no cells to colour, so each dot takes its entry's colour, as
    // in the 3D view's Front preset.
    const byEntry = !two && state.method !== "none";
    const assign = activeAssign();
    ctx.save();
    plot.clip(ctx);
    ctx.globalAlpha = byEntry ? 1 : 0.75;
    for (let c = 0; c < (byEntry ? CATS : 1); c += 1) {
      ctx.fillStyle = byEntry ? theme.css(catName(c)) : theme.ink;
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        if (byEntry && catOf(assign[i]) !== c) continue;
        const x = plot.x(pts[i * 3]);
        const y = plot.y(pts[i * 3 + 1]);
        ctx.moveTo(x + 1.5, y);
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();

    if (speechNow) {
      // The long axis, as in 3D: the front view shows its harmonic 4 and 5 part.
      const axis = speechAxis();
      if (axis) {
        ctx.save();
        ctx.strokeStyle = theme.css("--ambe-highlight");
        ctx.lineWidth = 3.25;
        ctx.beginPath();
        ctx.moveTo(plot.x(axis.from[0]), plot.y(axis.from[1]));
        ctx.lineTo(plot.x(axis.to[0]), plot.y(axis.to[1]));
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

    if (state.method !== "none") {
      const K = entries.length / dims;
      const assign = activeAssign();
      const count = new Uint32Array(K);
      for (const k of assign) count[k] += 1;
      const p = state.probe.slice(0, dims);
      const near = nearest(p, entries, dims).k;
      const ex = plot.x(entries[near * dims]);
      const ey = plot.y(entries[near * dims + 1]);
      const px = plot.x(p[0]);
      const py = plot.y(p[1]);
      const hl = theme.css("--ambe-highlight");
      const errorOn = state.focus === "error";

      // The subject's spokes, under the marks: at most STAR of its dots.
      if (!errorOn) {
        /** @type {number[]} */
        const members = [];
        for (let i = 0; i < n; i += 1) if (assign[i] === near) members.push(i);
        const every = Math.max(1, members.length / STAR);
        ctx.save();
        plot.clip(ctx);
        ctx.strokeStyle = hl;
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        for (let j = 0; j < members.length; j += every) {
          const i = members[Math.floor(j)];
          ctx.moveTo(ex, ey);
          ctx.lineTo(plot.x(pts[i * 3]), plot.y(pts[i * 3 + 1]));
        }
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.lineWidth = 1.5;
      // Unused entries first: in the front view a mark that hides a used
      // entry behind an unused one is drawn filled.
      const order = [...Array(K).keys()].sort((a, b) => Number(Boolean(count[a])) - Number(Boolean(count[b])));
      for (const k of order) {
        if (k === near) continue;
        const x = plot.x(entries[k * dims]);
        const y = plot.y(entries[k * dims + 1]);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = count[k] ? theme.ink : theme.plotBg;
        ctx.strokeStyle = theme.ink;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      // The probe, joined to its entry: thin, or (the probe off the cloud)
      // thick in the highlight, its error being the subject.
      ctx.save();
      ctx.strokeStyle = errorOn ? hl : theme.accentWarm;
      ctx.lineWidth = errorOn ? 3.25 : 1.5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // The chosen entry: a large highlight disc with a 2 px ring.
      ctx.beginPath();
      ctx.arc(ex, ey, 6.4, 0, Math.PI * 2);
      ctx.fillStyle = hl;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = theme.accentWarm;
      ctx.fill();
      ctx.restore();

      // The chips: the subject's fact, then the count, kept apart.
      const err = probeErrors();
      const subject = errorOn
        ? drawChip(ctx, `probe error ${err.code.toPrecision(2)}, grid ${err.grid.toPrecision(2)}`,
          (px + ex) / 2, (py + ey) / 2, area, null)
        : drawChip(ctx, `entry ${near + 1} of ${K}`, ex, ey, area, null);
      if (errorOn) {
        // The error's chip alone.
      } else if (state.method === "codebook") {
        let used = 0;
        let far = -1;
        let best = -1;
        for (let k = 0; k < K; k += 1) {
          if (!count[k]) continue;
          used += 1;
          const d = (entries[k * dims] - entries[near * dims]) ** 2 + (entries[k * dims + 1] - entries[near * dims + 1]) ** 2;
          if (d > best) {
            best = d;
            far = k;
          }
        }
        if (far >= 0) {
          drawChip(ctx, `${used} of ${K} entries used`, plot.x(entries[far * dims]), plot.y(entries[far * dims + 1]), area, subject);
        }
      } else if (two) {
        // The empty cell nearest the top left.
        const m = 2 ** (state.bits / 2);
        let cell = -1;
        let best = -Infinity;
        for (let k = 0; k < grid.used.length; k += 1) {
          if (grid.used[k]) continue;
          const score = -Math.floor(k / m) + (k % m);
          if (score > best) {
            best = score;
            cell = k;
          }
        }
        if (cell >= 0) {
          const cx = -1 + (2 * Math.floor(cell / m) + 1) / m;
          const cy = -1 + (2 * (cell % m) + 1) / m;
          drawChip(ctx, `${grid.empty} of ${grid.cells} cells empty`, plot.x(cx), plot.y(cy), area, subject);
        }
      }
    }
  };

  /**
   * A chip on the 2D canvas, as lib/labels.js draws one in 3D: the fact on
   * --ambe-highlight-chip with a highlight border, joined by a leader to a
   * dot on its anchor; above and to the right of it, or wherever it fits
   * inside `area` without covering `avoid`.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {{left: number, top: number, right: number, bottom: number}} area
   * @param {{left: number, top: number, right: number, bottom: number} | null} avoid
   * @returns {{left: number, top: number, right: number, bottom: number}}
   */
  function drawChip(ctx, text, x, y, area, avoid) {
    const theme = getTheme();
    const hl = theme.css("--ambe-highlight");
    ctx.save();
    ctx.font = `400 11px ${theme.font}`;
    const bw = ctx.measureText(text).width + 12;
    const bh = 19;
    const gap = 12;
    /** @param {number} v @param {number} lo @param {number} hi */
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const places = [[x + gap, y - gap - bh], [x - gap - bw, y - gap - bh], [x + gap, y + gap], [x - gap - bw, y + gap]]
      .map(([l, t]) => [clamp(l, area.left + 3, area.right - 3 - bw), clamp(t, area.top + 3, area.bottom - 3 - bh)]);
    const clear = (/** @type {number[]} */ [l, t]) => !avoid || l + bw < avoid.left || l > avoid.right || t + bh < avoid.top || t > avoid.bottom;
    const [left, top] = places.find(clear) ?? places[0];
    ctx.strokeStyle = hl;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(clamp(x, left, left + bw), clamp(y, top, top + bh));
    ctx.stroke();
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(left, top, bw, bh, 3);
    else ctx.rect(left, top, bw, bh);
    ctx.fillStyle = theme.css("--ambe-highlight-chip");
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "middle";
    ctx.fillText(text, left + 6, top + bh / 2 + 0.5);
    ctx.restore();
    return { left, top, right: left + bw, bottom: top + bh };
  }

  /* -------------------------------------------------------------------------
   * 3D view (anim-vq-space-3d.js, loaded on request)
   * ---------------------------------------------------------------------- */

  /** @type {VqLink} */
  const link = { view: null };

  /** @returns {VqScene} */
  const scene = () => {
    const entries = activeEntries();
    const assign = activeAssign();
    const K = entries.length / state.dims;
    const count = new Uint32Array(K);
    for (let i = 0; i < n; i += 1) count[assign[i]] += 1;
    const cats = Uint8Array.from({ length: K }, (_, k) => catOf(k));
    const m = 2 ** (state.bits / state.dims);
    const cells = {
      m,
      used: grid.used,
      empty: grid.empty,
      cats: Uint8Array.from({ length: m ** state.dims }, (_, k) => catOf(k)),
    };
    const on = state.method !== "none" && !isSpeech();
    const speechNow = isSpeech();
    return {
      data: state.data,
      dims: state.dims,
      method: state.method,
      bits: state.bits,
      n,
      pts,
      entries,
      assign,
      count,
      cats,
      cells,
      probe: [...state.probe],
      showProbe: on,
      chosen: on ? nearest(state.probe.slice(0, state.dims), entries, state.dims).k : -1,
      focus: state.focus,
      probeErr: probeErrors(),
      axis: speechAxis(),
      names: speechNow ? ["harmonic 4", "harmonic 5", "harmonic 6"] : ["first number", "second number", "third number"],
      // The end values sit at 0.75 of the cube's half width, 30 dB for Speech.
      ends: speechNow ? ["-22.5 dB", "22.5 dB"] : ["-1", "1"],
      plotRect,
      paintCells,
      label: sentence(),
      link,
    };
  };

  /** @param {string} name */
  const pressPreset = (name) => {
    for (const b of presetButtons) b.setAttribute("aria-pressed", String(b.dataset.preset === name));
  };

  const sw = createViewSwitch({
    frame,
    flat,
    toggle: view3d,
    hint: webglHint,
    signal,
    state: scene,
    load: () => import("./anim-vq-space-3d.js"),
    id: SLUG,
    onView: (view) => {
      // The 3D labels and chips show with the 3D canvas, never over the 2D plot.
      frame.classList.toggle("anim-vq__frame--flat", view !== "3d");
      cameraGroup.hidden = view !== "3d";
      if (view === "3d") pressPreset(state.dims === 3 ? "corner" : "front");
      // A step taken while the view loaded: it opened on the state before.
      if (view === "3d" && link.view && link.view.shows() !== `${state.dims}|${state.data}`) {
        sw.update(scene());
        void link.view.preset(state.dims === 3 ? "corner" : "front");
      }
      syncKeys();
      draw2d();
    },
  });
  /** The 3D view is up or on its way. */
  const in3d = () => sw.view() !== "2d";

  /* -------------------------------------------------------------------------
   * Changes
   * ---------------------------------------------------------------------- */

  const syncControls = () => {
    const speechOn = state.data === "speech";
    for (const b of dimsButtons) b.setAttribute("aria-pressed", String(!speechOn && Number(b.dataset.dims) === state.dims));
    for (const b of dataButtons) {
      b.setAttribute("aria-pressed", String(speechOn));
      // Speech is three numbers: offered with three (it keeps its place).
      b.style.visibility = state.dims === 3 ? "" : "hidden";
    }
    for (const b of methodButtons) b.setAttribute("aria-pressed", String(b.dataset.method === state.method));
    const speechNow = isSpeech();
    const step = state.dims;
    bitsInput.min = String(step === 2 ? 2 : 3);
    bitsInput.max = "6";
    bitsInput.step = String(step);
    bitsInput.value = String(state.bits);
    const cells = 2 ** state.bits;
    bitsInput.setAttribute("aria-valuetext", `${state.bits} bits, ${cells} cells`);
    bitsOut.value = `${state.bits} bits, ${cells} cells`;
    rhoInput.value = String(state.rho);
    rhoOut.value = state.rho.toFixed(2);
    angleInput.value = String(state.angle);
    angleOut.value = `${state.angle}°`;
    rhoInput.disabled = speechNow;
    angleInput.disabled = speechNow;
    methodButtons[1].disabled = speechNow;
    const trainable = state.method === "codebook" && !speechNow;
    lloydButton.disabled = !trainable;
    trainButton.disabled = !trainable;
    subtitle.textContent = speechNow ? `${n} voiced frames of the input clips` : `${CLOUD_SIZE} synthetic dots`;
    const kind = speechNow ? "derived-input" : "synthetic";
    if (caption.dataset.kind !== kind) {
      caption.dataset.kind = kind;
      caption.replaceChildren(speechNow ? SPEECH_CAPTION : CAPTION, " ", badge(kind));
    }
  };

  /** The legend and the hint list only what the plot draws now. */
  const syncKeys = () => {
    const on = state.method !== "none";
    const live = sw.view() === "3d";
    const three3 = state.dims === 3;
    const speechNow = isSpeech();
    // Before a quantizer is chosen the keys for what is not drawn yet keep
    // their place, invisible, so the figure does not change height when
    // the reader picks one.
    for (const el of [entryKey, probeKey, hatchKey, keysHint]) el.style.visibility = on ? "" : "hidden";
    // The 3D view's legend has no height to keep: keys for what it does not
    // draw go, rather than leave blank rows.
    for (const el of [entryKey, probeKey]) el.style.display = live && !on ? "none" : "";
    // The 3D view hatches the empty cells and cubes (in three numbers even
    // before a quantizer is chosen: the cubes the bits would buy); the 2D
    // front view of three numbers marks a column of them with a ring.
    const cubes = live && three3 && state.method !== "codebook";
    hatchKey.hidden = !(cubes || (!three3 && state.method !== "codebook"));
    if (cubes) hatchKey.style.visibility = "";
    hatchText.textContent = three3 ? "cube no dot falls in (bare edges, dim)" : "cell no dot falls in";
    hatchMark.classList.toggle("anim-vq__key--bare", cubes);
    ringKey.hidden = !(state.method === "grid" && three3 && !live);
    ringText.textContent = "grid mark with no dot in any of its cubes";
    entryKey.hidden = speechNow;
    probeKey.hidden = speechNow;
    chosenKey.hidden = !live || !on;
    chosenText.textContent = speechNow ? "the cloud's long axis (thick, outlined)"
      : "the probe's entry (large, outlined), joined to its dots";
    dotKey.textContent = speechNow ? "one voiced frame of the input clips"
      : three3 && on ? "synthetic dot, coloured by the entry it is sent as" : "synthetic dot";
    keysHint.textContent = speechNow ? KEYS_HINT_SPEECH : live ? KEYS_HINT_3D : KEYS_HINT;
    probeMark.classList.toggle("anim-vq__key--probe-ring", live);
  };

  const redraw = () => {
    writeReadout();
    syncControls();
    syncKeys();
    draw2d();
    sw.update(scene());
    describe();
  };

  /**
   * Move the drawn entries from `from` to the active ones: on the 3D
   * view's timeline when it is up, else on the 2D canvas's own frames.
   * @param {Float32Array} from
   * @param {number} [ms]
   * @returns {Promise<void>}
   */
  const tweenEntries = (from, ms = TWEEN_MS) => {
    const to = Float32Array.from(activeEntries());
    stopTween();
    if (link.view) {
      shown = to;
      draw2d();
      sw.update(scene());
      return link.view.entries(from, ms);
    }
    return new Promise((resolve) => {
      stopTween = run2d(ms, (t) => {
        const e = ease(t);
        shown = t === 1 ? to : to.map((v, i) => from[i] + (v - from[i]) * e);
        draw2d();
        if (t === 1) resolve();
      });
    });
  };

  /**
   * @param {boolean} all
   * @param {number} [ms] the entries' move
   * @returns {Promise<void>}
   */
  const trainNow = (all, ms = TWEEN_MS) => {
    if (state.method !== "codebook" || isSpeech()) return Promise.resolve();
    const from = Float32Array.from(shown.length ? shown : book.codebook);
    if (all) train(pts, state.dims, book);
    else lloydStep(pts, state.dims, book);
    rasterKey = "";
    writeReadout();
    describe();
    return tweenEntries(from, ms);
  };

  /**
   * @param {2 | 3} dims
   * @param {boolean} [animate=true]
   */
  const setDims = (dims, animate = true) => {
    if (dims === state.dims) {
      if (dims === 3 && !in3d()) void sw.show3D();
      return;
    }
    const was = state.dims;
    state.dims = dims;
    state.bits = fitBits(dims);
    if (dims === 2 && isSpeech()) useData("synthetic");
    if (dims === 3) settleProbeZ();
    reset();
    if (dims === 3 && !in3d()) void sw.show3D();
    redraw();
    if (animate && link.view) {
      if (was === 3) void link.view.flatten();
      else void link.view.reveal();
    }
  };

  /* -------------------------------------------------------------------------
   * Probe: pointer and keys
   * ---------------------------------------------------------------------- */

  /** @param {number[]} p */
  const moveProbe = (p) => {
    state.probe[0] = Math.max(-1, Math.min(1, p[0]));
    state.probe[1] = Math.max(-1, Math.min(1, p[1]));
    if (p.length > 2) state.probe[2] = p[2];
    else if (state.dims === 3) settleProbeZ();
    writeReadout();
    draw2d();
    sw.update(scene());
    describe();
  };

  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const big = event.shiftKey ? 0.2 : 0.02;
    /** @type {Record<string, [number, number]>} */
    const arrows = { ArrowLeft: [-big, 0], ArrowRight: [big, 0], ArrowUp: [0, big], ArrowDown: [0, -big] };
    if (event.key in arrows) {
      const [dx, dy] = arrows[event.key];
      moveProbe([state.probe[0] + dx, state.probe[1] + dy]);
    } else if (event.key === "]" || event.key === "[") {
      probeDot = (probeDot + (event.key === "]" ? 1 : n - 1)) % n;
      moveProbe([pts[probeDot * 3], pts[probeDot * 3 + 1], pts[probeDot * 3 + 2]]);
    } else if (event.key === "Home") {
      moveProbe(centre());
    } else {
      return;
    }
    event.preventDefault();
  }
  // On the frame, so the 3D canvas (a new one after an unpark) has the keys too.
  frame.addEventListener("keydown", onKey, { signal });

  let dragging = false;
  /**
   * A touch that has not yet shown which way it goes. The plot is
   * touch-action: pan-y, so a vertical swipe scrolls the page and ends in
   * pointercancel; the probe moves only on a tap or a sideways drag.
   * @type {{x: number, y: number} | null}
   */
  let touch = null;
  /** @param {PointerEvent} event */
  const probeAt = (event) => {
    const rect = flat.getBoundingClientRect();
    const plot = layout();
    moveProbe([plot.invertX(event.clientX - rect.left), plot.invertY(event.clientY - rect.top)]);
  };
  flat.addEventListener("pointerdown", (event) => {
    if (state.method === "none" || isSpeech()) return;
    if (event.pointerType === "touch") {
      touch = { x: event.clientX, y: event.clientY };
      return;
    }
    dragging = true;
    flat.setPointerCapture(event.pointerId);
    probeAt(event);
  }, { signal });
  flat.addEventListener("pointermove", (event) => {
    if (touch) {
      const dx = Math.abs(event.clientX - touch.x);
      const dy = Math.abs(event.clientY - touch.y);
      if (dx < 6 || dx <= dy) return;
      touch = null;
      dragging = true;
      flat.setPointerCapture(event.pointerId);
    }
    if (dragging) probeAt(event);
  }, { signal });
  flat.addEventListener("pointerup", (event) => {
    if (touch) probeAt(event);
    touch = null;
    dragging = false;
  }, { signal });
  flat.addEventListener("pointercancel", () => {
    touch = null;
    dragging = false;
  }, { signal });

  /* -------------------------------------------------------------------------
   * Controls
   * ---------------------------------------------------------------------- */

  /**
   * Speech dots on or off; they are three numbers, so Speech brings three.
   * @param {"synthetic" | "speech"} want
   */
  const setData = async (want) => {
    if (want === state.data) return;
    if (want === "speech" && !(await loadSpeech())) return;
    const was = state.dims;
    if (want === "speech" && state.dims !== 3) {
      state.dims = 3;
      state.bits = fitBits(3);
    }
    state.method = "grid";
    useData(want);
    settleProbeZ();
    reset();
    if (!in3d()) void sw.show3D();
    redraw();
    void link.view?.reveal();
  };
  for (const b of dimsButtons) {
    b.addEventListener("click", () => {
      const dims = b.dataset.dims === "3" ? 3 : 2;
      if (isSpeech() && dims === 3) void setData("synthetic");
      else setDims(dims);
    }, { signal });
  }
  for (const b of dataButtons) {
    b.addEventListener("click", () => void setData(isSpeech() ? "synthetic" : "speech"), { signal });
  }
  for (const b of methodButtons) {
    b.addEventListener("click", () => {
      state.method = b.dataset.method === "codebook" ? "codebook" : "grid";
      reset();
      redraw();
    }, { signal });
  }
  for (const b of presetButtons) {
    b.addEventListener("click", () => {
      const name = b.dataset.preset || "corner";
      pressPreset(name);
      sw.preset(name);
    }, { signal });
  }
  bitsInput.addEventListener("input", () => {
    state.bits = Number(bitsInput.value);
    reset();
    redraw();
  }, { signal });
  rhoInput.addEventListener("input", () => {
    state.rho = Number(rhoInput.value);
    reshape();
    if (state.dims === 3) settleProbeZ();
    redraw();
  }, { signal });
  angleInput.addEventListener("input", () => {
    state.angle = Number(angleInput.value);
    reshape();
    if (state.dims === 3) settleProbeZ();
    redraw();
  }, { signal });
  lloydButton.addEventListener("click", () => void trainNow(false), { signal });
  trainButton.addEventListener("click", () => void trainNow(true), { signal });

  const stopTheme = onThemeChange(() => {
    rasterKey = "";
    texKey = "";
    draw2d();
    sw.update(scene());
  });

  /* -------------------------------------------------------------------------
   * Steps
   * ---------------------------------------------------------------------- */

  /** The step on show, 0-based. */
  let stepIndex = 0;

  /**
   * @param {Record<string, string>} s
   * @param {{animate: boolean}} [how]
   */
  const apply = (s, how = { animate: false }) => {
    const index = steps.findIndex((step) => step.state === s);
    if (index >= 0) stepIndex = index;
    syncScrub();
    // "auto": three numbers when the figure has opened in 3D, two otherwise.
    const was = { dims: state.dims, data: state.data, view: link.view !== null };
    const dims = s.dims === "3" || s.view === "3d" || (s.dims === "auto" && s.view !== "2d" && in3d()) ? 3 : 2;
    state.rho = Number(s.rho ?? 0.5);
    state.angle = ANGLE;
    state.dims = dims;
    state.method = s.method === "grid" || s.method === "codebook" ? s.method : "none";
    state.bits = Number(s.bits ?? (dims === 3 ? 6 : 4));
    if (state.bits % dims) state.bits = fitBits(dims);
    useData(s.data === "speech" ? "speech" : "synthetic");
    if (s.data === "speech" && !speech) {
      // Shown as soon as the dots arrive, if the step is still on show.
      void loadSpeech().then((ok) => {
        if (ok && steps[stepIndex]?.state === s) apply(s, how);
      });
    }
    state.probe = s.probe === "off" ? [...OFF_CLOUD, 0] : centre();
    state.focus = s.probe === "off" ? "error" : "entry";
    if (state.dims === 3) settleProbeZ();
    if (s.probe === "off") state.probe[2] = 0;
    reset();
    if (s.train === "done") {
      train(pts, state.dims, book);
      shown = Float32Array.from(book.codebook);
    }
    if (dims === 3 && !in3d() && s.view === "3d") void sw.show3D();
    // A step on a flat graph shows it flat.
    if (s.view === "2d" && in3d()) sw.show2D();
    redraw();
    const view = link.view;
    if (!view || !was.view) return;
    pressPreset(state.dims === 3 ? "corner" : "front");
    if (!how.animate || playing) return;
    if (was.dims === 3 && state.dims === 2) void view.flatten();
    else if (state.dims === 3 && (was.dims === 2 || was.data !== state.data)) void view.reveal();
    else void view.preset(state.dims === 3 ? "corner" : "front");
  };

  /** @type {import("./anim-steps.js").Stepper | null} */
  let stepper = null;
  if (steps.length) stepper = createStepper(figure, steps, apply, { signal });
  else redraw();

  /* -------------------------------------------------------------------------
   * Play: the steps as one walk-through
   * ---------------------------------------------------------------------- */

  /** @param {boolean} on */
  const setPlaying = (on) => {
    playing = on;
    playButton.setAttribute("aria-pressed", String(on));
    playButton.textContent = on ? "Pause" : "Play";
    captionLine.hidden = !on;
    figure.classList.toggle("anim-vq--playing", on);
  };

  function syncScrub() {
    scrub.max = String(Math.max(1, steps.length));
    scrub.value = String(stepIndex + 1);
    scrubOut.value = `${stepIndex + 1} of ${steps.length}`;
    scrub.setAttribute("aria-valuetext", `step ${stepIndex + 1} of ${steps.length}`);
  }

  const pause = () => {
    if (!playing) return;
    playRun += 1;
    setPlaying(false);
    link.view?.finish();
  };

  /**
   * Wait `ms`, then say whether this run still holds the figure.
   * @param {number} run
   * @param {number} ms
   */
  const hold = async (run, ms) => {
    await sleep(ms);
    return run === playRun && playing && !signal.aborted;
  };

  /**
   * Animate a value from `a` to `b` on the 2D or 3D side alike (one model
   * change per frame), or jump under reduced motion.
   * @param {number} run
   * @param {number} ms
   * @param {(t: number) => void} step
   */
  const sweepValue = (run, ms, step) => new Promise((resolve) => {
    if (prefersReducedMotion()) {
      step(1);
      resolve(undefined);
      return;
    }
    const begin = performance.now();
    const tick = () => {
      if (run !== playRun) {
        step(1);
        resolve(undefined);
        return;
      }
      const t = Math.min(1, (performance.now() - begin) / ms);
      step(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve(undefined);
    };
    requestAnimationFrame(tick);
  });

  /**
   * Play's caption lines for a step: its sentences, with each one that
   * asks the reader to do something swapped for what Play does instead.
   * @param {string} text
   */
  const playLines = (text) => sentences(text).flatMap((line) => {
    const swap = PLAY_LINES.find(([start]) => start.test(line));
    return swap ? swap[1] : [line];
  });

  /** Entry moves Play shows one at a time: their length, and the gap between starts. */
  const LLOYD_MS = 900;
  const LLOYD_GAP = 1200;

  /**
   * Single Lloyd steps the reader can follow, the chosen entry pulsing on each.
   * @param {number} run
   * @param {number} count
   */
  const lloydSteps = async (run, count) => {
    for (let i = 0; i < count; i += 1) {
      if (run !== playRun || !playing) return;
      void link.view?.pulse();
      await Promise.all([trainNow(false, LLOYD_MS), sleep(LLOYD_GAP)]);
    }
  };

  /**
   * What Play does on each caption line of a step, after the step's state
   * is set: an array as long as `lines`, a function or null for each.
   * @param {number} run
   * @param {Record<string, string>} s
   * @param {{dims: number, data: string}} was
   * @param {string[]} lines
   * @returns {Array<null | (() => Promise<unknown>)>}
   */
  const cues = (run, s, was, lines) => {
    const view = link.view;
    /** @type {Array<null | (() => Promise<unknown>)>} */
    const out = lines.map(() => null);
    /** The first line that matches, or -1. @param {RegExp} re */
    const at = (re) => lines.findIndex((line) => re.test(line));
    /** @param {RegExp} re @param {() => Promise<unknown>} fn */
    const on = (re, fn) => {
      const i = at(re);
      if (i >= 0) out[i] = fn;
    };
    const still = () => run === playRun && playing;

    // The opening move, on the first line.
    if (state.dims === 3 && !isSpeech() && (was.dims !== 3 || stepIndex === 0)) {
      out[0] = () => view?.reveal({ full: true }) ?? Promise.resolve();
    } else if (state.dims === 3 && was.data !== state.data) {
      out[0] = () => view?.reveal() ?? Promise.resolve();
    } else if (was.dims === 3 && state.dims === 2) {
      out[0] = () => view?.flatten() ?? Promise.resolve();
    } else {
      out[0] = () => view?.preset(state.dims === 3 ? "corner" : "front") ?? Promise.resolve();
    }

    if (state.method === "grid" && state.dims === 2 && Number(s.rho) >= 0.9) {
      // The stretch rising: the dots close up into a band and cells empty;
      // later it falls back and rises again.
      const target = state.rho;
      /** @param {number} a @param {number} b @param {number} ms */
      const stretch = (a, b, ms) => sweepValue(run, ms, (t) => {
        state.rho = t === 1 ? b : Math.round((a + (b - a) * ease(t)) * 100) / 100;
        reshape();
        redraw();
      });
      const open = out[0];
      out[0] = async () => {
        await open?.();
        if (still()) await stretch(0.5, target, 2400);
      };
      on(/stretch fall back/, async () => {
        await stretch(target, 0.5, 1800);
        if (still()) await stretch(0.5, target, 1800);
      });
    } else if (state.method === "codebook" && s.train !== "done" && state.dims === 2) {
      // The codebook starts on the grid's centres; Lloyd steps one at a
      // time, the spokes following the entries; then the rest at once.
      on(/one at a time/, () => lloydSteps(run, 3));
      on(/^Each entry moves/, () => lloydSteps(run, 2));
      on(/ends up used/, () => trainNow(true, LLOYD_MS));
    } else if (s.probe === "off" && state.method === "codebook") {
      // The probe leaves the cloud, then a close look at its error.
      const to = [...state.probe];
      const from = centre();
      const open = out[0];
      out[0] = async () => {
        await open?.();
        if (!still()) return;
        await sweepValue(run, 1400, (t) => {
          const e = ease(t);
          moveProbe([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, 0]);
        });
        if (still()) void view?.pulse();
      };
      on(/^Its error is large/, async () => {
        const entries = activeEntries();
        const k = nearest(state.probe.slice(0, state.dims), entries, state.dims).k;
        const entry = Array.from(entries.slice(k * state.dims, (k + 1) * state.dims));
        await view?.closeUp([state.probe, entry], 3);
      });
      on(/^The saving/, () => view?.resetView() ?? Promise.resolve());
    } else if (state.dims === 3 && state.method === "grid" && !isSpeech()) {
      // A slow look round the empty cubes, then the same bits as a
      // codebook, trained a step at a time.
      on(/^Turned slowly/, async () => {
        await view?.turnBy(-60, 2000);
        if (still()) await view?.turnBy(60, 2000);
      });
      on(/^Switched to Codebook/, async () => {
        state.method = "codebook";
        reset();
        redraw();
        await hold(run, LLOYD_GAP);
        await lloydSteps(run, 4);
        if (still()) await trainNow(true, LLOYD_MS);
      });
    } else if (isSpeech()) {
      on(/^From the front/, () => view?.preset("front") ?? Promise.resolve());
      on(/^Turn the cube/, async () => {
        await view?.preset("corner");
        if (still()) await view?.pulse();
      });
    }
    return out;
  };

  /** @param {number} from 0-based */
  const playFrom = async (from) => {
    if (!stepper) return;
    const run = (playRun += 1);
    setPlaying(true);
    for (let i = from; i < steps.length; i += 1) {
      const was = { dims: state.dims, data: state.data };
      stepper.go(i);
      // A Speech step waits for its dots.
      if (steps[i].state.data === "speech" && !speech) {
        await loadSpeech();
        stepper.go(i);
      }
      if (run !== playRun) return;
      const lines = playLines(steps[i].item.textContent ?? "");
      const acts = cues(run, steps[i].state, was, lines);
      for (let j = 0; j < lines.length; j += 1) {
        captionLine.textContent = lines[j];
        const words = lines[j].split(" ").length;
        const act = acts[j];
        // A line holds for its reading time, or for its motion if longer.
        const [ok] = await Promise.all([
          hold(run, Math.max(MIN_SENTENCE_MS, words * MS_PER_WORD)),
          act ? act() : Promise.resolve(),
        ]);
        if (!ok || run !== playRun || !playing) return;
      }
      if (!(await hold(run, 600))) return;
    }
    if (run === playRun) setPlaying(false);
  };

  playButton.addEventListener("click", () => {
    if (playing) pause();
    else void playFrom(stepIndex === steps.length - 1 ? 0 : stepIndex);
  }, { signal });
  scrub.addEventListener("input", () => {
    const to = Number(scrub.value) - 1;
    if (playing) void playFrom(to);
    else stepper?.go(to);
  }, { signal });
  // Any other control, the step buttons, a press on the plot or the zoom
  // hands the figure back to the reader.
  const takeOver = (/** @type {Event} */ event) => {
    if (!playing || !(event.target instanceof Element) || event.target.closest('[data-ref="play-row"]')) return;
    if (event.isTrusted) pause();
  };
  figure.addEventListener("pointerdown", takeOver, { capture: true, signal });
  figure.addEventListener("keydown", takeOver, { capture: true, signal });
  figure.addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) takeOver(event);
  }, { capture: true, signal });
  playRow.hidden = steps.length < 2;
  syncScrub();

  /* -------------------------------------------------------------------------
   * Test hook (localhost only)
   * ---------------------------------------------------------------------- */

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = {
      get state() {
        return { ...state, probe: [...state.probe], view: sw.view() === "3d" ? "3d" : "2d" };
      },
      get readout() {
        return readout.value;
      },
      get presets() {
        return ["front", "top", "corner"];
      },
      get playing() {
        return playing;
      },
      get caption() {
        return captionLine.textContent;
      },
      get step() {
        return stepIndex;
      },
      /** The first 8 dots on the 2D plot, CSS px of the frame (the canvas must be up). */
      get plotPx() {
        const plot = layout();
        return Array.from({ length: 8 }, (_, i) => [plot.x(pts[i * 3]), plot.y(pts[i * 3 + 1])]);
      },
      /** The same dots on plotRect(), the square the 3D view fits its Front preset to. */
      get rectPx() {
        const r = plotRect();
        return Array.from({ length: 8 }, (_, i) => [
          r.x + ((pts[i * 3] + 1) / 2) * r.width, r.y + ((1 - pts[i * 3 + 1]) / 2) * r.height,
        ]);
      },
      /** What the 2D view draws now: the drawn and the active entries. */
      get drawn() {
        const three = /** @type {any} */ (TEST_HOOK)?.figures[`${SLUG}-3d`];
        return {
          lift: three ? three.lift : 1,
          shown: Array.from(three ? three.shown : shown),
          entries: Array.from(activeEntries()),
          dotZ: three ? three.dotZ : [],
          ptsZ: Array.from({ length: n }, (_, i) => pts[i * 3 + 2]),
        };
      },
      /** @param {number} bits */
      timeTrain: (bits) => {
        const dims = bits % 3 === 0 ? 3 : 2;
        const p = makeCloud({ rho: 0.9, angleDeg: ANGLE });
        const b = gridCodebook(p, dims, bits);
        const t0 = performance.now();
        train(p, dims, b);
        return performance.now() - t0;
      },
      play: () => playFrom(0),
      pause,
    };
  }

  return () => {
    clearTimeout(describeTimer);
    stopTween();
    playRun += 1;
    stopTheme();
    handle.destroy();
    if (TEST_HOOK) delete TEST_HOOK.figures[SLUG];
  };
}
