// @ts-check
/* ===========================================================================
 * anim-voicing.js: one voicing switch per frame against one per band.
 * ---------------------------------------------------------------------------
 * SLUG          voicing   <div data-anim="voicing" data-clips="lr-b,lr-c,lj-c">
 *               with a static fallback and a step list (docs/07).
 *
 * DATA READ     assets/data/<clip>/frames.json    (band strengths, f0, level)
 *               assets/data/<clip>/spectra.json   (128-bin dBFS spectra)
 *               assets/audio/<clip>-ambe.wav      (Sound, via <audio>)
 *
 * WHAT IT DRAWS The spectrum of one 20 ms frame of the chip's decoded audio,
 *               cut into the eight 500 Hz bands of
 *               derived_notes.band_edges_hz, and under it a map of the whole
 *               clip. The reader sets a model of the frame's excitation: one
 *               switch for the whole frame, or one per band. Voiced bands get
 *               stems at k times the decoded f0, unvoiced bands a flat noise
 *               level at the band's mean. With Band strengths on, each band
 *               shows its voicing strength against a threshold, and a band whose
 *               model choice differs from strength >= threshold is tinted.
 *               "Whole clip (3D)" (anim-voicing-3d.js, through
 *               lib/view-switch.js) shows every band's strength over the
 *               clip. It opens there, with its animation, when
 *               opensIn3D() (owner decision O1), and in this one-frame
 *               view otherwise, which is the reduced-motion and no-WebGL
 *               path.
 *
 * WALK-THROUGH  "Play the walk-through" runs the steps in order as one
 *               continuous animation: each step's text a sentence at a
 *               time as a caption, with its camera moves and its own
 *               motion (the frame sliding to its place, the switch tried
 *               both ways, the bands set by hand, the threshold up and
 *               down, the floor from above). Previous and Next on the
 *               step row move it on from their step; Pause, any other
 *               control or the zoom hand it back to the reader. Under
 *               reduced motion it steps through the end states.
 *
 * PROVENANCE    The band strengths are NOT the codec's transmitted V/UV
 *               decisions: the AMBE-3000 has no packet that reports them.
 *               They are a band-limited autocorrelation estimate computed
 *               from the chip's decoded output by tools/make-data.py (see
 *               docs/assets/data/SCHEMA.md). This module only compares stored
 *               numbers with a slider; it analyses and synthesises nothing.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  markEnhanced,
  assetURL,
  setupCanvas,
  createPlot,
  createLoop,
  clearCanvas,
  crisp,
  linearScale,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  onThemeChange,
  loadJSON,
  prefersReducedMotion,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { PICKS } from "./lib/picks.js";
import { darkGround, mix, rampColor, tokenHex } from "./lib/style.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "voicing";
const STEP_KEYS = /** @type {const} */ (["pick", "mode", "one", "choice", "model", "measure", "threshold", "view"]);

const FRAME_S = 0.02; // 20 ms per frame, 50 frames a second
const NYQUIST_HZ = 4000;
/** @type {[number, number]} */
const DB_DOMAIN = [-95, -5];
const DB_TICKS = [-90, -70, -50, -30, -10];
/** tools/make-data.py BAND_VOICED_THRESH, SCHEMA.md */
const THRESHOLD_DEFAULT = 0.55;

/** @type {Record<string, {label: string, voice: string}>} */
const CLIP_NAMES = {
  "lr-b": { label: "CQ", voice: "male" },
  "lr-c": { label: "Shells", voice: "male" },
  "lj-c": { label: "Shells", voice: "female" },
};
const DEFAULT_CLIPS = ["lr-b", "lr-c", "lj-c"];

/** @typedef {"vowel" | "fricative" | "mixed"} PickName */
/** @type {readonly PickName[]} */
const PICK_NAMES = ["vowel", "fricative", "mixed"];

/** @typedef {"corner" | "top" | "side"} PresetName */

/** @typedef {import("./anim-core.js").Theme} Theme */
/** @typedef {import("./anim-core.js").Plot} Plot */

/**
 * What the 3D part draws: the 2D module's numbers, never computed there.
 * @typedef {Object} VoicingScene
 * @property {string} key  the clip; a new key redraws everything
 * @property {FrameDerived[]} frames  each frame's band strengths and level
 * @property {number} index  the frame on screen
 * @property {number} threshold
 * @property {PresetName} preset
 * @property {boolean} compact  a phone-sized frame: short labels
 * @property {{xs: number[], top: number, bottom: number}} side  where the
 *           One frame view puts each band's centre, and its spectrum's top
 *           and bottom, px of the frame; the Side preset lines up with it
 * @property {string} label  the 3D canvas's sentence
 * @property {VoicingLink} link
 */

/**
 * The 2D module's link to its 3D part: the part sets `view` while it is up,
 * and `leave` while it waits for its first draw; the 2D module calls it on
 * leaving 3D, so a view not yet drawn lets its context go at once.
 * @typedef {{view: import("./anim-voicing-3d.js").VoicingView | null, leave: (() => void) | null}} VoicingLink
 */

/**
 * @typedef {Object} Strip  the voicing map's box, in CSS pixels
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} Geo
 * @property {number} W
 * @property {number} H
 * @property {boolean} compact
 * @property {number} chipH
 * @property {Plot} spec
 * @property {Strip} strip
 */

/**
 * @typedef {Object} VoicingState
 * @property {string} clipId
 * @property {FramesFile | null} frames
 * @property {SpectraFile | null} spectra
 * @property {[number, number][]} bands
 * @property {number} count
 * @property {number} delay     seconds the decoded WAV lags the original
 * @property {number} index
 * @property {number} playhead  seconds, virtual clock when sound is off
 * @property {boolean} sound
 * @property {boolean} original
 * @property {"one" | "bands"} mode   one switch for the frame, or one per band
 * @property {"voiced" | "unvoiced"} one  the one switch
 * @property {boolean[]} choice  per band, true = voiced (eight-band mode)
 * @property {boolean} model     draw the model over the spectrum
 * @property {boolean} measure   show the band strengths and the threshold
 * @property {number} threshold
 * @property {PresetName} preset
 * @property {PickName | null} pick  the step's pick, re-found on a clip change
 * @property {HTMLCanvasElement | null} raster
 * @property {string | null} rasterKey
 */

/**
 * @param {string[]} clips
 * @returns {string}
 */
function figureHTML(clips) {
  return `
<div class="anim-figure__head">
  <p class="anim-figure__title">One voicing switch, or eight</p>
</div>
<p class="anim-figure__subtitle" data-role="subtitle">&nbsp;</p>

<div class="anim-figure__frame" data-state="loading" style="--anim-aspect: 16 / 10">
  <canvas class="anim-figure__canvas" role="img" aria-label="Loading the spectrum of one frame."></canvas>
</div>

<div class="anim-controls voicing-controls--view">
  <div class="anim-controls__group">
    <span class="anim-field__label">View</span>
    <div class="anim-toggle-group" role="group" aria-label="View">
      <button class="anim-btn" type="button" data-view="2d" aria-pressed="true">One frame</button>
      <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">Whole clip (3D)</button>
    </div>
  </div>
  <div class="anim-controls__group" data-role="camera" hidden>
    <span class="anim-field__label">Camera</span>
    <div class="anim-toggle-group" role="group" aria-label="Camera">
      <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
      <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
      <button class="anim-btn" type="button" data-preset="side" aria-pressed="false">Side</button>
    </div>
  </div>
</div>

<div class="voicing-tour" data-role="tour" hidden>
  <button class="anim-btn voicing-tour__play" type="button" data-role="tour-play" aria-pressed="false">Play the walk-through</button>
  <label class="anim-field voicing-tour__scrub" hidden>
    <span class="anim-field__label">Step</span>
    <input class="anim-range" type="range" min="1" max="1" step="1" value="1"
           data-role="tour-step" aria-label="Walk-through step">
  </label>
  <output class="anim-readout" data-role="tour-out" hidden>step 1 of 1</output>
</div>
<p class="voicing-tour__caption" data-role="tour-caption" aria-hidden="true" hidden></p>

<div class="anim-figure__step"></div>

<ul class="anim-legend">
  <li class="anim-legend__item" data-legend="three" hidden><i class="anim-legend__swatch anim-legend__swatch--line voicing-swatch--voiced"></i>ridge above the threshold: the band repeats at the pitch period</li>
  <li class="anim-legend__item" data-legend="three" hidden><i class="anim-legend__swatch voicing-swatch--hatch"></i>ridge below it: noise, its floor cells hatched</li>
  <li class="anim-legend__item" data-legend="three" hidden><i class="anim-legend__swatch voicing-swatch--plane"></i>the threshold (plane)</li>
  <li class="anim-legend__item" data-legend="three" hidden><i class="anim-legend__swatch anim-legend__swatch--line voicing-swatch--frame"></i>this frame (thick line), one row of the clip</li>
  <li class="anim-legend__item" data-legend="three" hidden><i class="anim-legend__swatch anim-legend__swatch--line voicing-swatch--cut"></i>where the threshold cuts this frame (thick), a dashed stem from each band</li>
  <li class="anim-legend__item" data-legend="measured"><i class="anim-legend__swatch voicing-swatch--voiced"></i>band strength at or above the threshold</li>
  <li class="anim-legend__item" data-legend="measured"><i class="anim-legend__swatch voicing-swatch--unvoiced"></i>band strength below it</li>
  <li class="anim-legend__item" data-legend="model"><i class="anim-legend__swatch anim-legend__swatch--line voicing-swatch--voiced"></i>model: harmonic stems</li>
  <li class="anim-legend__item" data-legend="model"><i class="anim-legend__swatch voicing-swatch--noise"></i>model: noise at the band's level</li>
  <li class="anim-legend__item" data-legend="model"><i class="anim-legend__swatch voicing-swatch--mismatch"></i>model and band strength disagree</li>
  <li class="anim-legend__item" data-legend="spectrum"><i class="anim-legend__swatch anim-legend__swatch--line is-data-1"></i>spectrum of the decoded audio</li>
  <li class="anim-legend__item" data-legend="original"><i class="anim-legend__swatch anim-legend__swatch--dashed" style="color: var(--ambe-plot-muted)"></i>spectrum before the codec</li>
</ul>

<div class="anim-controls">
  <button class="anim-btn anim-btn--play" type="button" data-kind="motion" aria-pressed="false">Play</button>
  <label class="anim-field">
    <span class="anim-field__label">Frame</span>
    <input class="anim-range" type="range" min="0" max="0" step="1" value="0"
           data-role="frame" aria-label="Frame index, 20 milliseconds per frame">
  </label>
  <output class="anim-readout anim-readout--wide voicing-readout" data-role="readout" aria-live="polite">0.00 s</output>
</div>
<div class="anim-controls voicing-controls--tight">
  <div class="anim-toggle-group voicing-clips" role="group" aria-label="Recording">
    ${clips
      .map((id, i) => {
        const name = CLIP_NAMES[id] ?? { label: id, voice: "" };
        const text = name.voice ? `${name.label} · ${name.voice}` : name.label;
        return `<button class="anim-btn" type="button" data-clip="${id}" aria-pressed="${i === 0}">${text}</button>`;
      })
      .join("\n    ")}
  </div>
  <label class="anim-controls__group">
    <input class="anim-check" type="checkbox" data-kind="audio" data-role="sound">
    <span class="anim-field__label">Sound</span>
  </label>
  <label class="anim-controls__group">
    <input class="anim-check" type="checkbox" data-role="original">
    <span class="anim-field__label">Show original</span>
  </label>
</div>
<div class="anim-controls voicing-controls--tight">
  <div class="anim-controls__group">
    <span class="anim-field__label">Pick a frame</span>
    <div class="anim-toggle-group" role="group" aria-label="Pick a frame">
      <button class="anim-btn" type="button" data-pick="vowel">Vowel</button>
      <button class="anim-btn" type="button" data-pick="fricative">Fricative</button>
      <button class="anim-btn" type="button" data-pick="mixed">Mixed</button>
    </div>
  </div>
  <button class="anim-btn" type="button" data-role="model" aria-pressed="true">Model</button>
  <button class="anim-btn" type="button" data-role="measure" aria-pressed="false">Band strengths</button>
</div>
<div class="anim-controls voicing-controls--tight">
  <div class="anim-controls__group">
    <span class="anim-field__label">Excitation</span>
    <div class="anim-toggle-group" role="group" aria-label="Excitation">
      <button class="anim-btn" type="button" data-mode="one" aria-pressed="true">One switch</button>
      <button class="anim-btn" type="button" data-mode="bands" aria-pressed="false">Eight bands</button>
    </div>
  </div>
  <div class="anim-controls__group" data-role="one">
    <div class="anim-toggle-group" role="group" aria-label="The one switch">
      <button class="anim-btn" type="button" data-one="voiced" aria-pressed="true">Voiced</button>
      <button class="anim-btn" type="button" data-one="unvoiced" aria-pressed="false">Unvoiced</button>
    </div>
  </div>
  <div class="anim-controls__group" data-role="bands" hidden>
    <span class="anim-field__label">Voiced bands</span>
    <div class="voicing-bands" role="group" aria-label="Voicing per band">
      ${[0, 1, 2, 3, 4, 5, 6, 7]
        .map((b) => `<button class="anim-btn voicing-band" type="button" data-band="${b}" aria-pressed="true">${b + 1}</button>`)
        .join("\n      ")}
    </div>
  </div>
</div>
<div class="anim-controls voicing-controls--tight">
  <label class="anim-field voicing-threshold" data-role="threshold-field" hidden>
    <span class="anim-field__label">Threshold</span>
    <input class="anim-range" type="range" min="0.3" max="0.8" step="0.05" value="${THRESHOLD_DEFAULT}"
           data-role="threshold" aria-label="Voicing threshold" aria-valuetext="${THRESHOLD_DEFAULT.toFixed(2)}">
    <output class="anim-readout" data-role="threshold-value">${THRESHOLD_DEFAULT.toFixed(2)}</output>
  </label>
</div>

<p class="anim-figure__hint">Held on one frame because your system asks for
  reduced motion. Use the slider, or drag on the map, to step through it.</p>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden>${NO_WEBGL_HINT}</p>

<figcaption class="anim-figure__caption">
  <span data-role="caption-text">Band voicing strengths over one sentence,
  derived from the decoded audio of a real AMBE-3000 round trip. Band
  strengths are an autocorrelation estimate computed from the decoded audio,
  not the codec's transmitted voicing bits. Stems use the f0 of the chip's
  decoded audio.</span>
  <span class="voicing-badges">Spectrum, stems and strengths: <span data-badge="derived"></span>
  Sound: <span data-measured="decoded-audio" data-badge="measured"></span></span>
  <span class="anim-figure__source">Spectra and band strengths: precomputed
  from real DVSI AMBE-3000 round trips, assets/data/&lt;clip&gt;/{frames,spectra}.json;
  method and limits in docs/assets/data/SCHEMA.md. The eight 500 Hz bands
  match the eight V/UV decisions of the AMBE-rate system (Griffin &amp; Lim
  1988 §II; US 5,826,222).</span>
</figcaption>
`;
}

/**
 * Keep the frame on whole CSS pixels. The aspect ratio alone gives a
 * fractional height (560.625 px at 1280), and the text above puts the
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
 * Mount the voicing figure into its host.
 * @param {Element} host a `[data-anim="voicing"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>} cleanup
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const listed = (host.getAttribute("data-clips") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const clips = listed.length ? listed : DEFAULT_CLIPS;

  // The first clip, before any DOM change: the steps pick frames from it.
  const first = await loadClip(clips[0], signal);
  if (signal.aborted) return () => {};

  const root = document.createElement("figure");
  root.className = "anim-figure anim-figure--voicing";
  root.innerHTML = figureHTML(clips);
  host.append(root);
  markEnhanced(host);

  const frame = $(root, ".anim-figure__frame", HTMLElement);
  holdOnPixels(frame, signal);
  const canvas = $(root, "canvas", HTMLCanvasElement);
  const range = $(root, '[data-role="frame"]', HTMLInputElement);
  const playButton = $(root, ".anim-btn--play", HTMLButtonElement);
  const readout = $(root, '[data-role="readout"]', HTMLOutputElement);
  const subtitle = $(root, '[data-role="subtitle"]', HTMLElement);
  const soundToggle = $(root, '[data-role="sound"]', HTMLInputElement);
  const originalToggle = $(root, '[data-role="original"]', HTMLInputElement);
  const modelButton = $(root, '[data-role="model"]', HTMLButtonElement);
  const measureButton = $(root, '[data-role="measure"]', HTMLButtonElement);
  const thresholdField = $(root, '[data-role="threshold-field"]', HTMLElement);
  const thresholdInput = $(root, '[data-role="threshold"]', HTMLInputElement);
  const thresholdValue = $(root, '[data-role="threshold-value"]', HTMLOutputElement);
  const oneGroup = $(root, '[data-role="one"]', HTMLElement);
  const bandsGroup = $(root, '[data-role="bands"]', HTMLElement);
  const cameraGroup = $(root, '[data-role="camera"]', HTMLElement);
  const webglHint = $(root, ".anim-figure__hint--webgl", HTMLElement);
  const tourRow = $(root, '[data-role="tour"]', HTMLElement);
  const tourButton = $(root, '[data-role="tour-play"]', HTMLButtonElement);
  const tourScrub = $(root, '[data-role="tour-step"]', HTMLInputElement);
  const tourOut = $(root, '[data-role="tour-out"]', HTMLOutputElement);
  const tourCaption = $(root, '[data-role="tour-caption"]', HTMLElement);
  /** @param {string} selector */
  const buttons = (selector) =>
    Array.from(root.querySelectorAll(selector)).filter((b) => b instanceof HTMLButtonElement);
  const clipButtons = buttons("[data-clip]");
  const pickButtons = buttons("[data-pick]");
  const modeButtons = buttons("[data-mode]");
  const oneButtons = buttons("[data-one]");
  const bandButtons = buttons("[data-band]");
  const viewButtons = buttons("[data-view]");
  const presetButtons = buttons("[data-preset]");
  $(root, '[data-badge="derived"]', HTMLElement).append(badge("derived-decoded"));
  $(root, '[data-badge="measured"]', HTMLElement).append(badge("measured"));

  const reduced = prefersReducedMotion();
  if (reduced) root.classList.add("is-static");

  const audio = document.createElement("audio");
  audio.preload = "none";
  audio.setAttribute("aria-hidden", "true");
  audio.hidden = true;
  root.appendChild(audio);

  /** @type {VoicingState} */
  const state = {
    clipId: clips[0],
    frames: null,
    spectra: null,
    bands: [],
    count: 0,
    delay: 0,
    index: 0,
    playhead: 0,
    sound: false,
    original: false,
    mode: "one",
    one: "voiced",
    choice: [true, true, true, true, true, true, true, true],
    model: true,
    measure: false,
    threshold: THRESHOLD_DEFAULT,
    preset: "corner",
    pick: null,
    raster: null,
    rasterKey: null,
  };

  canvas.style.touchAction = "pan-y";
  const handle = setupCanvas(canvas, { onResize: () => render() });

  /* -- what the model says, band by band -------------------------------- */

  /** @returns {FrameDerived | null} */
  const current = () => state.frames?.frames[state.index]?.derived ?? null;

  /**
   * The reader's choice for band b: true = voiced.
   * @param {number} b
   */
  const chosen = (b) => (state.mode === "one" ? state.one === "voiced" : state.choice[b]);

  /**
   * Band strength at or above the threshold.
   * @param {FrameDerived} d
   * @param {number} b
   */
  const periodic = (d, b) => d.band_voicing[b] >= state.threshold - 1e-9;

  /**
   * The model and the measurement disagree in band b. With no decoded f0
   * there are no stems to draw, so a voiced choice cannot fit.
   * @param {FrameDerived} d
   * @param {number} b
   */
  const mismatch = (d, b) => chosen(b) !== periodic(d, b) || (chosen(b) && !(d.decoded_f0_hz > 0));

  /** @param {FrameDerived} d */
  const periodicCount = (d) => d.band_voicing.filter((_, b) => periodic(d, b)).length;
  /** @param {FrameDerived} d */
  const mismatchCount = (d) => d.band_voicing.filter((_, b) => mismatch(d, b)).length;

  /**
   * Stem frequencies the model draws in voiced bands: k times the decoded f0.
   * @param {FrameDerived} d
   * @returns {number[]}
   */
  function stemFrequencies(d) {
    const f0 = d.decoded_f0_hz;
    /** @type {number[]} */
    const out = [];
    if (!(f0 > 0)) return out;
    for (let k = 1; k * f0 < NYQUIST_HZ; k += 1) {
      const f = k * f0;
      const b = state.bands.findIndex(([lo, hi]) => f >= lo && f < hi);
      if (b >= 0 && chosen(b)) out.push(f);
    }
    return out;
  }

  /* -- layout ------------------------------------------------------------ */

  /**
   * @param {number} [W] CSS px; the canvas's own size if absent
   * @param {number} [H]
   * @returns {Geo}
   */
  function layout(W = handle.width, H = handle.height) {
    const compact = W < 560;
    const padL = compact ? 30 : 44;
    const padR = compact ? 10 : 16;
    const chipH = compact ? 24 : 30;
    const stripH = compact ? 66 : 92;
    const stripBottom = H - (compact ? 24 : 28);
    const stripTop = Math.max(chipH + 60, stripBottom - stripH);
    const specTop = (compact ? 8 : 12) + chipH;
    const specBottom = stripTop - (compact ? 30 : 40);

    const spec = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, NYQUIST_HZ],
        yDomain: DB_DOMAIN,
        padding: {
          top: specTop,
          right: padR,
          bottom: H - specBottom,
          left: padL,
        },
      }
    );

    const strip = {
      left: padL,
      right: W - padR,
      top: stripTop,
      bottom: stripBottom,
      width: W - padR - padL,
      height: stripBottom - stripTop,
    };

    return { W, H, compact, chipH, spec, strip };
  }

  /* -- the voicing map (prerendered per clip, theme and threshold) -------- */

  /** @param {Theme} th */
  function rasterKey(th) {
    return `${th.scheme}|${state.measure ? state.threshold.toFixed(2) : "off"}`;
  }

  /**
   * @param {Theme} th
   * @param {FramesFile} frames
   */
  function buildRaster(th, frames) {
    const n = state.count;
    const bands = state.bands.length || 8;
    const off = document.createElement("canvas");
    off.width = n;
    off.height = bands;
    const c = off.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, n, bands);
    const voicedColour = th.css("--ambe-voiced", th.series[1]);
    const unvoicedColour = th.css("--ambe-unvoiced", th.series[2]);
    // Level alone is the site's level ramp, as tradeoff's spectrogram draws
    // it: the quiet end mixed toward the plot ground.
    const bg = tokenHex("--ambe-plot-bg");
    const power = darkGround() ? 2 : 3;
    /** @param {number} t */
    const levelColour = (t) => `#${mix(rampColor(t), bg, 0.82 * (1 - t) ** power).toString(16).padStart(6, "0")}`;

    for (let i = 0; i < n; i += 1) {
      const d = frames.frames[i].derived;
      // Dim by level so silent frames do not masquerade as fricatives.
      const level = Math.min(1, Math.max(0.04, (d.decoded_rms_dbfs + 65) / 40));
      for (let b = 0; b < bands; b += 1) {
        if (state.measure) {
          const voiced = periodic(d, b);
          c.globalAlpha = level * (voiced ? 1 : 0.86);
          c.fillStyle = voiced ? voicedColour : unvoicedColour;
        } else {
          // Without the measurement the map shows level only.
          c.globalAlpha = 1;
          // Up to the ramp's middle: the level of a whole frame, not a
          // cell's peak, so the loudest frames read teal, not yellow.
          c.fillStyle = levelColour(level * 0.62);
        }
        c.fillRect(i, bands - 1 - b, 1, 1);
      }
    }
    c.globalAlpha = 1;
    state.raster = off;
    state.rasterKey = rasterKey(th);
  }

  /* -- drawing ----------------------------------------------------------- */

  /**
   * One chip per band above the spectrum. With Band strengths on: the band's
   * strength, a bar, and a tick at the threshold. Without: the band number,
   * to match the eight band buttons.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Theme} th
   * @param {Geo} geo
   * @param {FrameDerived} d
   */
  function drawBandChips(ctx, th, geo, d) {
    const { spec, chipH, compact } = geo;
    const top = compact ? 4 : 6;
    const h = chipH - (compact ? 6 : 8);
    const voicedColour = th.css("--ambe-voiced", th.series[1]);
    const unvoicedColour = th.css("--ambe-unvoiced", th.series[2]);
    // Level alone is the site's level ramp, as tradeoff's spectrogram draws
    // it: the quiet end mixed toward the plot ground.
    const bg = tokenHex("--ambe-plot-bg");
    const power = darkGround() ? 2 : 3;
    /** @param {number} t */
    const levelColour = (t) => `#${mix(rampColor(t), bg, 0.82 * (1 - t) ** power).toString(16).padStart(6, "0")}`;

    for (let b = 0; b < state.bands.length; b += 1) {
      const [lo, hi] = state.bands[b];
      const x0 = spec.x(lo);
      const x1 = spec.x(hi);
      const w = x1 - x0 - 2;

      if (!state.measure) {
        drawLabel(ctx, w > 56 ? `band ${b + 1}` : String(b + 1), x0 + 1 + w / 2, top + h / 2 - 1, {
          align: "center",
          baseline: "middle",
          size: compact ? 9 : 10,
          mono: true,
          color: th.text4,
        });
        continue;
      }

      const voiced = periodic(d, b);
      const strength = d.band_voicing[b];
      const color = voiced ? voicedColour : unvoicedColour;

      ctx.save();
      ctx.globalAlpha = voiced ? 0.2 : 0.15;
      ctx.fillStyle = color;
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(x0 + 1, top, w, h, 4);
        ctx.fill();
      } else {
        ctx.fillRect(x0 + 1, top, w, h);
      }
      ctx.restore();

      const label =
        w > 56 ? `${voiced ? "V" : "UV"}  ${strength.toFixed(2)}` : voiced ? "V" : "UV";
      drawLabel(ctx, label, x0 + 1 + w / 2, top + h / 2 - 2, {
        align: "center",
        baseline: "middle",
        size: compact ? 9 : 10,
        weight: 600,
        mono: true,
        color,
      });

      // Voicing strength, with the threshold marked.
      const barY = top + h - 4;
      const barW = w - 8;
      ctx.save();
      ctx.fillStyle = th.hairline;
      ctx.fillRect(x0 + 5, barY, barW, 2);
      ctx.fillStyle = color;
      ctx.fillRect(x0 + 5, barY, barW * Math.min(1, strength), 2);
      ctx.fillStyle = th.text3;
      ctx.fillRect(crisp(x0 + 5 + barW * state.threshold), barY - 1, 1, 4);
      ctx.restore();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Theme} th
   * @param {Geo} geo
   * @param {FrameDerived} d
   * @param {SpectraFile} spectra
   */
  function drawSpectrum(ctx, th, geo, d, spectra) {
    const { spec, compact } = geo;
    const i = state.index;
    const row = spectra.decoded[i];
    const binHz = spectra.bin_hz;
    const voicedColour = th.css("--ambe-voiced", th.series[1]);
    const unvoicedColour = th.css("--ambe-unvoiced", th.series[2]);
    // Level alone is the site's level ramp, as tradeoff's spectrogram draws
    // it: the quiet end mixed toward the plot ground.
    const bg = tokenHex("--ambe-plot-bg");
    const power = darkGround() ? 2 : 3;
    /** @param {number} t */
    const levelColour = (t) => `#${mix(rampColor(t), bg, 0.82 * (1 - t) ** power).toString(16).padStart(6, "0")}`;

    // Disagreement first, under everything.
    if (state.model) {
      ctx.save();
      ctx.fillStyle = th.css("--ambe-mismatch", th.hairline);
      for (let b = 0; b < state.bands.length; b += 1) {
        if (!mismatch(d, b)) continue;
        const [lo, hi] = state.bands[b];
        ctx.fillRect(spec.x(lo), spec.area.top, spec.x(hi) - spec.x(lo), spec.area.height);
      }
      ctx.restore();
    }

    // Band backgrounds from the measurement.
    if (state.measure) {
      for (let b = 0; b < state.bands.length; b += 1) {
        const [lo, hi] = state.bands[b];
        const voiced = periodic(d, b);
        ctx.save();
        ctx.globalAlpha = voiced ? 0.16 : 0.11;
        ctx.fillStyle = voiced ? voicedColour : unvoicedColour;
        ctx.fillRect(spec.x(lo), spec.area.top, spec.x(hi) - spec.x(lo), spec.area.height);
        ctx.restore();
      }
    }

    drawGrid(ctx, spec, { xTicks: [], yTicks: DB_TICKS });

    // Band edges.
    ctx.save();
    ctx.strokeStyle = th.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let b = 1; b < state.bands.length; b += 1) {
      const x = crisp(spec.x(state.bands[b][0]));
      ctx.moveTo(x, spec.area.top);
      ctx.lineTo(x, spec.area.bottom);
    }
    ctx.stroke();
    ctx.restore();

    drawAxes(ctx, spec, {
      xTicks: [0, 1000, 2000, 3000, 4000],
      yTicks: DB_TICKS,
      formatX: (v) => (v === 0 ? "0" : `${v / 1000}k`),
      formatY: (v) => String(v),
      xLabel: compact ? "kHz" : "frequency (kHz)",
    });

    // Harmonic ticks, where the frame has a decoded fundamental.
    const f0 = d.decoded_f0_hz;
    if (f0 > 0) {
      ctx.save();
      ctx.strokeStyle = th.muted;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k * f0 < NYQUIST_HZ; k += 1) {
        const x = crisp(spec.x(k * f0));
        ctx.moveTo(x, spec.area.top);
        ctx.lineTo(x, spec.area.top + 6);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    spec.clip(ctx);

    // Model, unvoiced bands: a flat noise level at the band's mean.
    if (state.model) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = unvoicedColour;
      for (let b = 0; b < state.bands.length; b += 1) {
        if (chosen(b)) continue;
        const [lo, hi] = state.bands[b];
        let sum = 0;
        let n = 0;
        for (let k = 0; k < row.length; k += 1) {
          if (k * binHz >= lo && k * binHz < hi) {
            sum += Math.max(row[k], DB_DOMAIN[0]);
            n += 1;
          }
        }
        if (!n) continue;
        const y = spec.y(sum / n);
        ctx.fillRect(spec.x(lo), y, spec.x(hi) - spec.x(lo), spec.area.bottom - y);
      }
      ctx.restore();
    }

    // Spectra. Original first, so the decoded trace sits on top.
    if (state.original) {
      const orig = spectra.original[i];
      const pts = new Array(orig.length);
      for (let k = 0; k < orig.length; k += 1) {
        pts[k] = { x: k * binHz, y: Math.max(orig[k], DB_DOMAIN[0]) };
      }
      drawPolyline(ctx, pts, {
        plot: spec,
        color: th.muted,
        width: 1.2,
        dash: [3, 3],
      });
    }
    const pts = new Array(row.length);
    for (let k = 0; k < row.length; k += 1) {
      pts[k] = { x: k * binHz, y: Math.max(row[k], DB_DOMAIN[0]) };
    }
    // The fill under the decoded trace: the accent at low alpha.
    const base = spec.y(DB_DOMAIN[0]);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(spec.x(pts[0].x), base);
    for (const p of pts) ctx.lineTo(spec.x(p.x), spec.y(p.y));
    ctx.lineTo(spec.x(pts[pts.length - 1].x), base);
    ctx.closePath();
    ctx.globalAlpha = th.dark ? 0.16 : 0.13;
    ctx.fillStyle = th.series[0];
    ctx.fill();
    ctx.restore();
    drawPolyline(ctx, pts, { plot: spec, color: th.series[0], width: 1.6 });

    // Model, voiced bands: a stem at every harmonic of the decoded f0, up to
    // the decoded spectrum at that frequency.
    if (state.model) {
      ctx.save();
      ctx.strokeStyle = voicedColour;
      ctx.lineWidth = compact ? 1.25 : 1.5;
      ctx.beginPath();
      for (const f of stemFrequencies(d)) {
        const k = Math.min(row.length - 1, Math.round(f / binHz));
        const x = spec.x(f);
        ctx.moveTo(x, spec.area.bottom);
        ctx.lineTo(x, spec.y(Math.max(row[k], DB_DOMAIN[0])));
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Frame summary chip.
    const text =
      f0 > 0
        ? state.measure
          ? `f₀ ${f0.toFixed(0)} Hz · ${periodicCount(d)} of 8 bands voiced`
          : `f₀ ${f0.toFixed(0)} Hz`
        : "no fundamental found in this frame";
    drawLabel(ctx, text, spec.area.right - 8, spec.area.top + 6, {
      align: "right",
      baseline: "top",
      size: compact ? 10 : 11,
      mono: true,
      color: f0 > 0 ? th.text2 : th.text4,
      background: th.surface2,
      padding: 4,
    });
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Theme} th
   * @param {Geo} geo
   */
  function drawStrip(ctx, th, geo) {
    const { strip, compact } = geo;
    const n = state.count;

    ctx.save();
    ctx.fillStyle = th.sunken;
    ctx.fillRect(strip.left, strip.top, strip.width, strip.height);
    const raster = state.raster;
    if (raster) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        raster,
        0,
        0,
        raster.width,
        raster.height,
        strip.left,
        strip.top,
        strip.width,
        strip.height
      );
      ctx.imageSmoothingEnabled = true;
    }
    ctx.strokeStyle = th.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      crisp(strip.left),
      crisp(strip.top),
      Math.round(strip.width),
      Math.round(strip.height)
    );
    ctx.restore();

    // Frequency labels on the map's left edge.
    drawLabel(ctx, "4k", strip.left - 6, strip.top + 4, {
      align: "right",
      baseline: "top",
      size: 9,
      color: th.text4,
    });
    drawLabel(ctx, "0", strip.left - 6, strip.bottom - 4, {
      align: "right",
      baseline: "bottom",
      size: 9,
      color: th.text4,
    });

    // Time axis.
    const t = linearScale([0, n * FRAME_S], [strip.left, strip.right]);
    const step = n * FRAME_S > 3 ? 1 : 0.5;
    ctx.save();
    ctx.strokeStyle = th.axis;
    ctx.beginPath();
    for (let s = 0; s <= n * FRAME_S + 1e-6; s += step) {
      const x = crisp(t.of(s));
      ctx.moveTo(x, strip.bottom);
      ctx.lineTo(x, strip.bottom + 4);
    }
    ctx.stroke();
    ctx.restore();
    for (let s = 0; s <= n * FRAME_S + 1e-6; s += step) {
      drawLabel(ctx, `${s.toFixed(step < 1 ? 1 : 0)}s`, t.of(s), strip.bottom + 6, {
        align: "center",
        baseline: "top",
        size: 9,
        color: th.text4,
      });
    }

    // Playhead.
    const x = strip.left + ((state.index + 0.5) / n) * strip.width;
    ctx.save();
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crisp(x), strip.top - 4);
    ctx.lineTo(crisp(x), strip.bottom + 1);
    ctx.stroke();
    ctx.fillStyle = th.ink;
    ctx.beginPath();
    ctx.moveTo(x, strip.top - 4);
    ctx.lineTo(x - 4, strip.top - 9);
    ctx.lineTo(x + 4, strip.top - 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (!compact) {
      drawLabel(ctx, "drag to scrub ↔", strip.right, strip.top - 5, {
        align: "right",
        baseline: "bottom",
        size: 9,
        color: th.text4,
      });
    }
  }

  function render() {
    const th = getTheme();
    const ctx = handle.ctx;
    const geo = layout();

    // The 2D canvas is hidden in 3D, so the frame's own width decides. The
    // 3D view keeps the same frame, so its Side preset lines up with this,
    // except on a phone: there the One frame view needs the height and the
    // whole clip, seen from a corner, the width.
    const width = frame.clientWidth || geo.W;
    const aspect = width < 480 ? (in3d() ? "7 / 6" : "1 / 1.05") : width < 620 ? "16 / 12" : "16 / 10";
    if (frame.style.getPropertyValue("--anim-aspect") !== aspect) {
      frame.style.setProperty("--anim-aspect", aspect);
    }

    clearCanvas(ctx, handle, th.plotBg);
    const { frames, spectra } = state;
    const d = current();
    if (!frames || !spectra || !d) return;
    if (!state.raster || state.rasterKey !== rasterKey(th)) buildRaster(th, frames);

    drawSpectrum(ctx, th, geo, d, spectra);
    drawBandChips(ctx, th, geo, d);
    drawStrip(ctx, th, geo);
  }

  /* -- text: readout and canvas label ------------------------------------ */

  function readoutText() {
    const d = current();
    let text = `${(state.index * FRAME_S).toFixed(2)} s · frame ${state.index}`;
    if (!d) return text;
    if (state.measure) {
      text += ` · ${periodicCount(d)} of 8 bands periodic at ${state.threshold.toFixed(2)}`;
    }
    if (state.model) {
      const m = mismatchCount(d);
      text += m
        ? ` · Model and band strengths disagree in ${m} band${m === 1 ? "" : "s"}`
        : " · Model and band strengths agree in every band";
    }
    return text;
  }

  function describe2d() {
    const d = current();
    if (!d) return "Loading the spectrum of one frame.";
    const f0 = d.decoded_f0_hz;
    const parts = [
      `Spectrum of frame ${state.index} of ${state.count} of the chip's decoded audio, at ${(state.index * FRAME_S).toFixed(2)} s, in eight 500 Hz bands.`,
      f0 > 0 ? `Decoded f0 ${f0.toFixed(0)} Hz.` : "No decoded fundamental in this frame.",
    ];
    if (state.model) {
      const voiced = state.choice.map((_, b) => chosen(b)).filter(Boolean).length;
      parts.push(
        state.mode === "one"
          ? `Model: one switch, set to ${state.one}.`
          : `Model: ${voiced} of 8 bands set voiced.`
      );
      const m = mismatchCount(d);
      parts.push(m ? `It disagrees with the band strengths in ${m} of 8 bands.` : "It agrees in every band.");
    }
    if (state.measure) {
      parts.push(`${periodicCount(d)} of 8 band strengths at or above ${state.threshold.toFixed(2)}.`);
    }
    parts.push("Under it, a map of the clip's bands over time.");
    return parts.join(" ");
  }

  let describeTimer = 0;
  function describe() {
    window.clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      canvas.setAttribute("aria-label", describe2d());
    }, 250);
  }

  function updateText() {
    readout.value = readoutText();
    describe();
  }

  /* -- controls in step with state -------------------------------------- */

  /** @param {HTMLButtonElement} button @param {boolean} on */
  const press = (button, on) => button.setAttribute("aria-pressed", String(on));

  function syncControls() {
    for (const b of modeButtons) press(b, b.dataset.mode === state.mode);
    for (const b of oneButtons) press(b, b.dataset.one === state.one);
    oneGroup.hidden = state.mode !== "one";
    bandsGroup.hidden = state.mode !== "bands";
    bandButtons.forEach((button, b) => {
      press(button, state.choice[b]);
      const [lo, hi] = state.bands[b] ?? [b * 500, (b + 1) * 500];
      button.setAttribute(
        "aria-label",
        `Band ${b + 1}, ${lo} to ${hi} Hz, ${state.choice[b] ? "voiced" : "unvoiced"}`
      );
    });
    press(modelButton, state.model);
    press(measureButton, state.measure);
    const three = in3d();
    // The 3D view is the band strengths: the switch stays on while it shows.
    measureButton.disabled = three;
    thresholdField.hidden = !state.measure && !three;
    thresholdInput.value = String(state.threshold);
    thresholdInput.setAttribute("aria-valuetext", state.threshold.toFixed(2));
    thresholdValue.value = state.threshold.toFixed(2);
    for (const b of viewButtons) press(b, (b.dataset.view === "3d") === three);
    for (const b of presetButtons) press(b, b.dataset.preset === state.preset);
    // The presets work once the view is up.
    cameraGroup.hidden = !up3d();
    // The legend lists what the view on show draws.
    for (const legend of root.querySelectorAll("[data-legend]")) {
      if (!(legend instanceof HTMLElement)) continue;
      const key = legend.dataset.legend;
      legend.hidden = key === "three" ? !three
        : three ||
          (key === "measured" && !state.measure) ||
          (key === "model" && !state.model) ||
          (key === "original" && !state.original);
    }
  }

  /** Redraw everything that depends on state. */
  function refresh() {
    syncControls();
    render();
    updateText();
  }

  /* -- playback ---------------------------------------------------------- */

  /** @param {number} i */
  function clamp(i) {
    return Math.min(Math.max(i | 0, 0), Math.max(0, state.count - 1));
  }

  /**
   * @param {number} i
   * @param {{syncRange?: boolean}} [options]
   */
  function setIndex(i, { syncRange = true } = {}) {
    const next = clamp(i);
    if (next === state.index && syncRange) return;
    state.index = next;
    if (syncRange && range.value !== String(next)) range.value = String(next);
    updateText();
  }

  /** @param {number} i */
  function audioTimeFor(i) {
    return i * FRAME_S + state.delay;
  }

  /** Seek the decoded WAV to the frame on screen. The decoded audio lags the
   *  original by clip.decoded_delay_samples (SCHEMA.md), so the offset matters.
   * @param {number} i */
  function seekAudio(i) {
    try {
      audio.currentTime = Math.max(0, audioTimeFor(i));
    } catch (error) {
      /* not seekable yet; playback starts from the beginning */
    }
  }

  let lastPlayAttempt = 0;

  function startAudio() {
    if (!state.sound || !state.frames) return;
    lastPlayAttempt = performance.now();
    seekAudio(state.index);
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        /* autoplay refused: the picture keeps running silently */
      });
    }
  }

  const loop = createLoop(
    ({ dt, static: isStatic }) => {
      if (!state.frames) return;
      if (isStatic) {
        render();
        return;
      }
      const endTime = state.count * FRAME_S + state.delay;
      const audible = state.sound && !audio.paused && !audio.ended && audio.readyState >= 2;

      if (state.sound && (audio.ended || audio.currentTime >= endTime)) {
        // Wrap: the clip is short, so it loops rather than stopping.
        state.playhead = 0;
        setIndex(0);
        startAudio();
      } else if (audible) {
        // The picture follows the sound, not a separate clock.
        state.playhead = Math.max(0, audio.currentTime - state.delay);
        setIndex(Math.round(state.playhead / FRAME_S));
      } else {
        // No usable audio clock: run a virtual one, and keep trying to get
        // the sound back.
        state.playhead += Math.min(dt, 0.1);
        let i = Math.floor(state.playhead / FRAME_S);
        if (i >= state.count) {
          state.playhead = 0;
          i = 0;
        }
        setIndex(i);
        if (state.sound && audio.paused && performance.now() - lastPlayAttempt > 900) {
          startAudio();
        }
      }
      frameChanged();
    },
    {
      element: root,
      fps: 50,
      // A stepped figure holds the step's frame until the reader presses Play.
      autoplay: steps.length === 0,
      onStateChange(running) {
        playButton.setAttribute("aria-pressed", running ? "true" : "false");
        playButton.textContent = running ? "Pause" : "Play";
        if (!running) audio.pause();
        else if (state.sound && audio.paused) startAudio();
      },
    }
  );

  /* -- data -------------------------------------------------------------- */

  /**
   * Show a loaded clip.
   * @param {string} id
   * @param {{frames: FramesFile, spectra: SpectraFile}} data
   * @param {number} index the frame to land on
   */
  function showClip(id, { frames, spectra }, index) {
    state.clipId = id;
    state.frames = frames;
    state.spectra = spectra;
    state.bands = frames.derived_notes.band_edges_hz;
    state.count = frames.frames.length;
    state.delay = frames.clip.decoded_delay_samples / frames.clip.sample_rate_hz;
    state.raster = null;
    for (const b of clipButtons) press(b, b.dataset.clip === id);
    range.max = String(state.count - 1);
    subtitle.textContent = `“${frames.clip.text}”, ${frames.clip.voice.model}, round-tripped through a DVSI AMBE-3000`;
    audio.src = assetURL(frames.clip.decoded_audio);
    audio.load();
    for (const b of pickButtons) {
      const name = /** @type {PickName} */ (b.dataset.pick);
      b.disabled = PICKS[name](frames.frames) === null;
    }
    frame.dataset.state = "ready";
    state.index = -1;
    setIndex(index);
    state.playhead = state.index * FRAME_S;
    refresh();
    clipChanged();
  }

  /**
   * The frame a clip opens on: the step's pick if a step set one, else a
   * frame worth looking at.
   * @param {FramesFile} frames
   */
  function landing(frames) {
    if (state.pick) {
      const picked = PICKS[state.pick](frames.frames);
      if (picked) return picked.i;
    }
    return representativeFrame(frames);
  }

  /** Under reduced motion the figure never animates, so the one frame it holds
   *  has to earn its place: the loudest frame whose eight bands are mixed.
   * @param {FramesFile} frames */
  function representativeFrame(frames) {
    const count = frames.frames.length;
    let best = Math.floor(count * 0.42);
    let bestScore = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const d = frames.frames[i].derived;
      const voiced = d.band_voiced.filter(Boolean).length;
      if (voiced < 2 || voiced > 6) continue;
      if (d.decoded_rms_dbfs > bestScore) {
        bestScore = d.decoded_rms_dbfs;
        best = i;
      }
    }
    return best;
  }

  /** @param {string} id */
  async function selectClip(id) {
    if (id === state.clipId && state.frames) return;
    const wasRunning = loop.isRunning();
    loop.stop();
    frame.dataset.state = "loading";
    state.clipId = id;
    const data = await loadClip(id, signal);
    if (signal.aborted || state.clipId !== id) return;
    showClip(id, data, landing(data.frames));
    if (wasRunning) loop.start();
    if (state.sound) startAudio();
  }

  /**
   * Seek to a named pick on the current clip.
   * @param {PickName} name
   */
  function seekPick(name) {
    const picked = state.frames ? PICKS[name](state.frames.frames) : null;
    if (!picked) return;
    loop.stop();
    setIndex(picked.i);
    state.playhead = state.index * FRAME_S;
    if (state.sound) seekAudio(state.index);
    frameChanged();
  }

  /* -- the whole clip in 3D (anim-voicing-3d.js) ------------------------- */

  /** @type {VoicingLink} */
  const link = { view: null, leave: null };
  /** Each clip's per-frame numbers, as the 3D part draws them. */
  let derivedKey = "";
  /** @type {FrameDerived[]} */
  let derived = [];

  /** Where the One frame view puts each band's centre, and its spectrum's
   *  top and bottom, in px of the frame. */
  function sideRect() {
    const geo = layout(frame.clientWidth || handle.width, frame.clientHeight || handle.height);
    const bands = state.bands.length ? state.bands : Array.from({ length: 8 }, (_, b) => [b * 500, b * 500 + 500]);
    return {
      xs: bands.map(([lo, hi]) => geo.spec.x((lo + hi) / 2)),
      top: geo.spec.area.top,
      bottom: geo.spec.area.bottom,
    };
  }

  function describe3d() {
    const frames = state.frames;
    const d = current();
    if (!frames || !d) return "Voicing strength of eight bands over the clip.";
    let above = 0;
    for (const f of frames.frames) above += f.derived.band_voicing.filter((_, b) => periodic(f.derived, b)).length;
    const t = state.threshold.toFixed(2);
    return (
      `Voicing strength of eight bands over ${frames.frames.length} frames of the decoded audio, ` +
      `cut by a threshold at ${t}. ${above} of ${frames.frames.length * 8} band frames lie above it. ` +
      `Frame ${state.index} marked: ${periodicCount(d)} of 8 bands above.`
    );
  }

  /** What the 3D part draws now. @returns {VoicingScene} */
  function scene() {
    if (derivedKey !== state.clipId && state.frames) {
      derivedKey = state.clipId;
      derived = state.frames.frames.map((f) => f.derived);
    }
    return {
      key: state.clipId,
      frames: derived,
      index: Math.max(0, state.index),
      threshold: state.threshold,
      preset: state.preset,
      compact: frame.clientWidth < 480,
      // Read on every fit: the frame's shape changes with the view on a phone.
      get side() {
        return sideRect();
      },
      label: describe3d(),
      link,
    };
  }

  const view3dButton = /** @type {HTMLButtonElement} */ (viewButtons.find((b) => b.dataset.view === "3d"));
  const view2dButton = /** @type {HTMLButtonElement} */ (viewButtons.find((b) => b.dataset.view === "2d"));
  /** The 3D view is up or on its way; up and drawing. */
  let in3d = () => false;
  let up3d = () => false;
  // Whole clip pressed while it shows keeps it (the switch would leave).
  view3dButton.addEventListener("click", (event) => {
    if (in3d()) event.stopImmediatePropagation();
  }, { signal });
  /** The 3D view has been up once: the next entry is a step's to animate. */
  let seen3d = false;
  const sw = createViewSwitch({
    frame,
    flat: canvas,
    toggle: view3dButton,
    hint: webglHint,
    signal,
    state: scene,
    load: () => import("./anim-voicing-3d.js"),
    id: SLUG,
    onView: (view) => {
      if (view === "3d") {
        seen3d = true;
        // The ridges and floor are the band strengths, so their legend and
        // readout go with them.
        state.measure = true;
      }
      refresh();
    },
  });
  in3d = () => sw.view() !== "2d";
  up3d = () => sw.view() === "3d";
  view3dButton.addEventListener("click", () => {
    // On a phone the controls sit far below the frame, and the 3D view
    // draws only once its frame is on screen: bring it up.
    const box = frame.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) {
      frame.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }
    refresh();
  }, { signal });
  view2dButton.addEventListener("click", () => {
    sw.show2D();
    link.leave?.();
    stepMeasure();
    refresh();
  }, { signal });

  /** Back in One frame within the steps, Band strengths is the step's
   *  again (the 3D view held it on). */
  function stepMeasure() {
    const s = steps[stepIndex]?.state;
    if (s?.measure && root.dataset.steps !== "free") state.measure = s.measure === "on";
  }

  /** The 3D view, at the step's or the reader's request. A step that
   *  animates plays the entry again unless the view's first-view one runs.
   * @param {boolean} animate */
  async function enter3d(animate) {
    if (!sw.available()) return;
    const ticket = viewTicket;
    if (in3d()) {
      if (animate && link.view) {
        state.preset = "corner";
        syncControls();
        await link.view.enter();
      }
      return;
    }
    const first = !seen3d && !prefersReducedMotion();
    state.preset = "corner";
    const wait = sw.show3D();
    refresh();
    await wait;
    if (ticket !== viewTicket || !link.view) return;
    if (animate && !first) await link.view.enter();
  }

  /** Back to One frame; from 3D, through the Side view, which lines up with it.
   * @param {boolean} animate */
  async function leave3d(animate) {
    if (!in3d()) return;
    const ticket = viewTicket;
    if (animate && link.view && !prefersReducedMotion()) {
      state.preset = "side";
      syncControls();
      await link.view.preset("side");
      if (ticket !== viewTicket) return;
    }
    sw.show2D();
    link.leave?.();
    stepMeasure();
    refresh();
  }

  /** @param {PresetName} name */
  function goPreset(name) {
    state.preset = name;
    syncControls();
    sw.preset(name);
  }

  function frameChanged() {
    render();
    sw.update(scene());
  }

  function clipChanged() {
    sw.update(scene());
  }

  function thresholdChanged() {
    sw.update(scene());
  }

  /* -- steps ------------------------------------------------------------- */

  /** Bumped by every step; a view change still waiting on its last one gives up. */
  let viewTicket = 0;
  /** The step on show, 0-based. */
  let stepIndex = 0;

  /**
   * @param {Record<string, string>} s
   * @param {{animate: boolean}} how
   */
  function applyStep(s, how) {
    viewTicket += 1;
    const index = steps.findIndex((step) => step.state === s);
    if (index >= 0) stepIndex = index;
    syncScrub();
    loop.stop();
    if (s.mode === "one" || s.mode === "bands") {
      if (s.mode === "bands" && state.mode === "one") state.choice.fill(state.one === "voiced");
      state.mode = s.mode;
    }
    if (s.one === "voiced" || s.one === "unvoiced") state.one = s.one;
    if (s.model) state.model = s.model === "on";
    if (s.measure) state.measure = s.measure === "on" || in3d();
    if (s.threshold && Number.isFinite(Number(s.threshold))) state.threshold = Number(s.threshold);
    if (s.pick && PICK_NAMES.includes(/** @type {PickName} */ (s.pick))) {
      state.pick = /** @type {PickName} */ (s.pick);
      seekPick(state.pick);
    }
    // The eight switches: all voiced, or set to fit the frame on screen at
    // the threshold. Applied after the pick, so "fit" fits the step's frame.
    const d = current();
    if (s.choice === "voiced") state.choice.fill(true);
    else if (s.choice === "fit" && d) state.choice.forEach((_, b) => (state.choice[b] = periodic(d, b)));
    refresh();
    thresholdChanged();
    const animate = how.animate && !playing;
    if (s.view === "3d") void enter3d(animate || (playing && !prefersReducedMotion()));
    else if (s.view === "2d") void leave3d(animate || playing);
  }

  /** @type {import("./anim-steps.js").Stepper | null} */
  let stepper = null;

  /* -- the walk-through: the steps as one continuous animation ---------- */

  /** The walk-through runs. */
  let playing = false;
  /** Bumped on every start and stop; a beat that sees it change gives up. */
  let playRun = 0;

  /** @param {boolean} on */
  function setPlaying(on) {
    playing = on;
    tourButton.setAttribute("aria-pressed", String(on));
    tourButton.textContent = on ? "Pause the walk-through" : "Play the walk-through";
    tourCaption.hidden = !on;
    root.classList.toggle("voicing--touring", on);
  }

  function syncScrub() {
    tourScrub.max = String(Math.max(1, steps.length));
    tourScrub.value = String(stepIndex + 1);
    tourOut.value = `step ${stepIndex + 1} of ${steps.length}`;
    tourScrub.setAttribute("aria-valuetext", `step ${stepIndex + 1} of ${steps.length}`);
  }

  function pause() {
    if (!playing) return;
    playRun += 1;
    setPlaying(false);
    link.view?.finish();
  }

  /**
   * Wait `ms`, then say whether this run still holds the figure.
   * @param {number} run @param {number} ms
   */
  const hold = (run, ms) =>
    new Promise((resolve) => window.setTimeout(resolve, ms)).then(() => run === playRun && playing && !signal.aborted);

  /**
   * Move the frame on screen from `from` to `to` over `ms`, as the clip's
   * own Play would, with no sound.
   * @param {number} run @param {number} from @param {number} to @param {number} ms
   */
  const glide = (run, from, to, ms) => new Promise((resolve) => {
    const begin = performance.now();
    const tick = () => {
      const t = run === playRun ? Math.min(1, (performance.now() - begin) / ms) : 1;
      setIndex(Math.round(from + (to - from) * t));
      state.playhead = state.index * FRAME_S;
      frameChanged();
      if (t < 1) requestAnimationFrame(tick);
      else resolve(undefined);
    };
    requestAnimationFrame(tick);
  });

  /**
   * What a step adds in the walk-through, after its state is set. Under
   * reduced motion only its end state.
   * @param {number} run
   * @param {Record<string, string>} s
   * @param {(pattern: RegExp) => Promise<unknown>} when  resolves as the
   *        caption reaches the first sentence matching `pattern`
   */
  async function beat(run, s, when) {
    const still = () => run === playRun && playing;
    const reduced = prefersReducedMotion();
    if (!s.view) {
      // One frame is one row of the clip: the clip grows out from the row,
      // the row runs along the ridges to this frame, then it pulses where
      // the text names it.
      if (in3d() && link.view && !reduced) {
        await link.view.enter();
        await when(/each ridge/);
        if (!still()) return;
        const to = state.index;
        const voiced = (state.frames?.frames ?? []).findIndex((f) => f.derived.decoded_rms_dbfs > -45);
        await glide(run, Math.max(0, voiced), to, 2200);
        await when(/thick line/);
        if (!still()) return;
        link.view?.pulse();
      }
      // The text says to press One frame: the walk-through presses it, and
      // the camera turns to Side, which lines up with it, on the way.
      await when(/One frame/);
      if (still()) await leave3d(!reduced);
    } else if (s.mode === "one" && s.pick === "mixed") {
      // Try both settings of the switch, as the text does, and again when
      // it says neither clears every tint.
      if (reduced) return;
      /** @param {"voiced" | "unvoiced"} one */
      const set = (one) => {
        state.one = one;
        refresh();
      };
      await when(/Try both/);
      if (!(await hold(run, 1200))) return;
      set("unvoiced");
      await when(/is tinted where/);
      if (!still()) return;
      set("voiced");
      await when(/Neither/);
      if (!still()) return;
      set("unvoiced");
      if (!(await hold(run, 1500))) return;
      set("voiced");
    } else if (s.mode === "bands" && s.choice === "voiced") {
      // Set each band by hand until no band is tinted.
      const d = current();
      if (!d) return;
      await when(/by hand/);
      for (let b = 0; b < 8 && still(); b += 1) {
        if (!mismatch(d, b)) continue;
        state.choice[b] = periodic(d, b);
        refresh();
        if (!reduced && !(await hold(run, 650))) return;
      }
    } else if (s.view === "3d") {
      // The threshold down and up as the text says to drag it, then the
      // floor from above: the map.
      await when(/Drag Threshold/);
      if (reduced || !still()) return;
      for (const t of [0.4, 0.7, THRESHOLD_DEFAULT]) {
        state.threshold = t;
        refresh();
        thresholdChanged();
        if (!(await hold(run, 1400))) return;
      }
      await when(/Press Top/);
      if (!still() || !in3d()) return;
      goPreset("top");
      await when(/At 0\.55/);
      if (!still() || !in3d()) return;
      goPreset("corner");
    }
  }

  /** Reading pace of a caption sentence, and its floor, in ms. */
  const MS_PER_WORD = 290;
  const MIN_SENTENCE_MS = 2200;

  /** @param {number} from 0-based */
  async function playFrom(from) {
    if (!stepper) return;
    const run = (playRun += 1);
    setPlaying(true);
    for (let i = from; i < steps.length; i += 1) {
      stepper.go(i);
      // A step hides the free-play rows (anim.css), the walk-through's own
      // Pause among them: while it plays, the figure keeps them.
      root.dataset.steps = "free";
      if (run !== playRun) return;
      const lines = sentences(captionText(steps[i].item));
      /** @type {(() => void)[]} */
      const starts = [];
      const started = lines.map(() => new Promise((resolve) => starts.push(() => resolve(undefined))));
      const when = (/** @type {RegExp} */ pattern) => {
        const k = lines.findIndex((line) => pattern.test(line));
        return started[k >= 0 ? k : lines.length - 1] ?? Promise.resolve();
      };
      const motion = beat(run, steps[i].state, when);
      for (const [k, line] of lines.entries()) {
        starts[k]();
        tourCaption.textContent = line;
        const words = line.split(" ").length;
        if (!(await hold(run, Math.max(MIN_SENTENCE_MS, words * MS_PER_WORD)))) return;
      }
      await motion;
      if (!(await hold(run, 600))) return;
    }
    if (run === playRun) setPlaying(false);
  }

  /* -- events ------------------------------------------------------------ */

  const on = { signal };

  playButton.addEventListener("click", () => {
    if (loop.isRunning()) {
      loop.stop();
    } else {
      state.playhead = state.index * FRAME_S;
      loop.start();
    }
  }, on);

  range.addEventListener("input", () => {
    loop.stop();
    setIndex(Number(range.value), { syncRange: false });
    state.playhead = state.index * FRAME_S;
    if (state.sound) seekAudio(state.index);
    frameChanged();
  }, on);

  for (const b of clipButtons) {
    b.addEventListener("click", () => {
      const id = b.dataset.clip;
      if (!id) return;
      selectClip(id).catch((error) => {
        if (signal.aborted) return;
        console.error(`anim-${SLUG}: could not load ${id}`, error);
        frame.dataset.state = "error";
      });
    }, on);
  }

  soundToggle.addEventListener("change", () => {
    state.sound = soundToggle.checked;
    if (!state.sound) audio.pause();
    else if (loop.isRunning()) startAudio();
  }, on);

  originalToggle.addEventListener("change", () => {
    state.original = originalToggle.checked;
    refresh();
  }, on);

  for (const b of pickButtons) {
    b.addEventListener("click", () => {
      const name = /** @type {PickName} */ (b.dataset.pick);
      state.pick = name;
      seekPick(name);
    }, on);
  }
  for (const b of modeButtons) {
    b.addEventListener("click", () => {
      const mode = b.dataset.mode === "bands" ? "bands" : "one";
      if (mode === "bands" && state.mode === "one") state.choice.fill(state.one === "voiced");
      state.mode = mode;
      refresh();
    }, on);
  }
  for (const b of oneButtons) {
    b.addEventListener("click", () => {
      state.one = b.dataset.one === "unvoiced" ? "unvoiced" : "voiced";
      refresh();
    }, on);
  }
  bandButtons.forEach((button, b) => {
    button.addEventListener("click", () => {
      state.choice[b] = !state.choice[b];
      refresh();
    }, on);
  });
  modelButton.addEventListener("click", () => {
    state.model = !state.model;
    refresh();
  }, on);
  measureButton.addEventListener("click", () => {
    state.measure = !state.measure;
    refresh();
    thresholdChanged();
  }, on);
  thresholdInput.addEventListener("input", () => {
    state.threshold = Math.round(Number(thresholdInput.value) * 100) / 100;
    refresh();
    thresholdChanged();
  }, on);
  for (const b of presetButtons) {
    b.addEventListener("click", () => {
      const name = b.dataset.preset;
      if (name === "corner" || name === "top" || name === "side") goPreset(name);
    }, on);
  }

  tourButton.addEventListener("click", () => {
    if (playing) pause();
    else void playFrom(stepIndex === steps.length - 1 ? 0 : stepIndex);
  }, on);
  tourScrub.addEventListener("input", () => {
    const to = Number(tourScrub.value) - 1;
    if (playing) void playFrom(to);
    else stepper?.go(to);
  }, on);
  // The step row is the one stepping control: Previous and Next move the
  // walk-through on from the step they land on while it plays. (Its own
  // step slider stays hidden, so the figure never shows two.)
  root.addEventListener("click", (event) => {
    if (!playing || !(event.target instanceof Element) || !event.target.closest("[data-step]")) return;
    void playFrom(stepIndex);
  }, on);
  // Any other control, a press on the figure or the zoom hands the figure
  // back to the reader.
  const takeOver = (/** @type {Event} */ event) => {
    if (!playing || !(event.target instanceof Element)) return;
    if (event.target.closest('[data-role="tour"]') || event.target.closest("[data-step]")) return;
    if (event.isTrusted) pause();
  };
  root.addEventListener("pointerdown", takeOver, { capture: true, signal });
  root.addEventListener("keydown", takeOver, { capture: true, signal });
  root.addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) takeOver(event);
  }, { capture: true, signal });

  // Dragging on the voicing map scrubs.
  let dragging = false;
  /** @param {PointerEvent} event */
  function seekFromPointer(event) {
    if (!state.count) return;
    const rect = canvas.getBoundingClientRect();
    const geo = layout();
    const x = event.clientX - rect.left;
    const f = (x - geo.strip.left) / Math.max(1, geo.strip.width);
    setIndex(Math.round(f * (state.count - 1)));
    state.playhead = state.index * FRAME_S;
    if (state.sound) seekAudio(state.index);
    frameChanged();
  }
  /** @param {PointerEvent} event */
  const overStrip = (event) => {
    const rect = canvas.getBoundingClientRect();
    const geo = layout();
    const y = event.clientY - rect.top;
    return y >= geo.strip.top - 12 && y <= geo.strip.bottom + 8;
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (!state.count || !overStrip(event)) return;
    dragging = true;
    loop.stop();
    canvas.setPointerCapture(event.pointerId);
    seekFromPointer(event);
    event.preventDefault();
  }, on);
  canvas.addEventListener("pointermove", (event) => {
    if (dragging) seekFromPointer(event);
    else if (state.count) canvas.style.cursor = overStrip(event) ? "ew-resize" : "";
  }, on);
  /** @param {PointerEvent} event */
  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* pointer already released */
    }
  };
  canvas.addEventListener("pointerup", endDrag, on);
  canvas.addEventListener("pointercancel", endDrag, on);

  const unsubscribeTheme = onThemeChange(() => {
    state.raster = null;
    render();
  });

  /* -- start --------------------------------------------------------------- */

  if (steps.length) {
    // The first step's pick decides the opening frame.
    const pick = steps[0].state.pick;
    if (pick && PICK_NAMES.includes(/** @type {PickName} */ (pick))) {
      state.pick = /** @type {PickName} */ (pick);
    }
  }
  showClip(clips[0], first, state.pick || reduced ? landing(first.frames) : 0);
  if (steps.length) stepper = createStepper(root, steps, applyStep, { signal });
  tourRow.hidden = steps.length < 2;
  syncScrub();

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = {
      get state() {
        return {
          clip: state.clipId,
          index: state.index,
          mode: state.mode,
          one: state.one,
          choice: [...state.choice],
          model: state.model,
          measure: state.measure,
          threshold: state.threshold,
          view: in3d() ? "3d" : "2d",
          preset: state.preset,
        };
      },
      readout: () => readout.value,
      label: () => describe2d(),
      representativeFrame: () => (state.frames ? representativeFrame(state.frames) : -1),
      spectrumSource: "decoded",
      stemFrequencies: () => {
        const d = current();
        return d ? stemFrequencies(d) : [];
      },
      decodedF0: () => current()?.decoded_f0_hz ?? 0,
      /** Where the One frame view puts each band and its spectrum's height, frame px. */
      side: () => sideRect(),
      describe3d: () => describe3d(),
      get playing() {
        return playing;
      },
      get caption() {
        return tourCaption.textContent;
      },
      get step() {
        return stepIndex;
      },
    };
  }

  return () => {
    window.clearTimeout(describeTimer);
    playRun += 1;
    unsubscribeTheme();
    loop.destroy();
    handle.destroy();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (TEST_HOOK) delete TEST_HOOK.figures[SLUG];
  };
}

/**
 * A step's text as the caption shows it: without its citations, which stay
 * in the step panel.
 * @param {HTMLElement} item
 * @returns {string}
 */
function captionText(item) {
  const copy = /** @type {HTMLElement} */ (item.cloneNode(true));
  for (const cite of copy.querySelectorAll(".cite")) cite.remove();
  return (copy.textContent ?? "").replace(/\s+([.,;:])/g, "$1");
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
 * Load one clip's frames and spectra.
 * @param {string} id
 * @param {AbortSignal} signal
 * @returns {Promise<{frames: FramesFile, spectra: SpectraFile}>}
 */
async function loadClip(id, signal) {
  const [frames, spectra] = await Promise.all([
    /** @type {Promise<FramesFile>} */ (loadJSON(`assets/data/${id}/frames.json`, { signal })),
    /** @type {Promise<SpectraFile>} */ (loadJSON(`assets/data/${id}/spectra.json`, { signal })),
  ]);
  return { frames, spectra };
}
