// @ts-check
/* ===========================================================================
 * anim-frames.js: "frames", what a 20 ms frame is, and what the coder's
 * analysis window sees around it (ch08).
 * ---------------------------------------------------------------------------
 * SLUG  frames   host: <div data-anim="frames" markdown="1"> with a poster
 *                fallback and a step list (docs/08-analysis.md)
 *
 * DATA READ (precomputed, site-root-relative; see docs/assets/data/SCHEMA.md)
 *   assets/data/waveform.json   min/max envelope of the clip, both tracks,
 *                               the decoded one already delay-compensated
 *   assets/data/frames.json     the 72 channel bits per frame (measured),
 *                               plus level, pitch and band voicing (derived)
 *   assets/audio/<clip>-original.wav, -ambe.wav   the samples of the inset
 *                               and of the 3D rows, and the playback
 *
 * VIEWS
 *   The whole clip on top, a three-frame inset below it. Windows draws the
 *   255-sample Hamming window over frame i and its neighbours (illustrative
 *   placement: where the chip puts it is not public), on the input track
 *   only. Lanes puts frames i-1, i and i+1 in lanes of their own, the 2D
 *   form of the 3D view. The 3D view (anim-frames-3d.js) sits over the
 *   inset only: rows i-4 to i+4 stacked in depth, which the Front preset
 *   folds back onto the inset.
 *
 * WHAT THIS FILE IS NOT
 *   A drawing program. It plots the samples of two WAV files and plays
 *   them, and prints numbers computed offline. It holds no AMBE analysis,
 *   no synthesis, no quantiser and no bit unpacking: the 72-bit channel
 *   frame is printed as opaque spaced hex, as the chip emitted it, and is
 *   never taken apart (the mapping from those bits to parameters is not
 *   public, SCHEMA.md).
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  TEST_HOOK,
  assetURL,
  clearCanvas,
  createLoop,
  crisp,
  drawLabel,
  getTheme,
  loadJSON,
  loadPCM,
  markEnhanced,
  onThemeChange,
  prefersReducedMotion,
  setupCanvas,
  supportsWebGL2,
  NO_WEBGL_HINT,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { PICKS } from "./lib/picks.js";
import { rampColor } from "./lib/style.js";
import { createViewSwitch } from "./lib/view-switch.js";

/** Samples per frame, 20 ms at 8 kHz. */
export const FRAME = 160;
/** The analysis window: 255-point symmetric Hamming (US 5,701,390). */
export const WINDOW = 255;
/** Samples two neighbouring windows share. */
export const SHARED = WINDOW - FRAME;
/** The samples frame i's window shares with the one before and the one after, from frame i's start. */
export const SPANS = /** @type {const} */ ([[-SHARED / 2, SHARED / 2], [FRAME - SHARED / 2, FRAME + SHARED / 2]]);
/** CSS px the 3D view's frame reaches past the inset on the right and below. */
export const OVERHANG = 1;
/** Rows either side of frame i in the 3D view. */
export const REACH = 4;
const RATE = 8000;
const HALF = (WINDOW - 1) / 2;
const STEP_KEYS = /** @type {const} */ (["windows", "view", "preset", "pick", "replay"]);
/**
 * The inset's full scale as a fraction of its half height, shared with the
 * 3D rows: the band left above and below holds two rows of labels, clear of
 * the data.
 */
export const SCALE = 0.74;
/** The text the 3D view's chip and the 2D inset both state. */
export const CHIP = "this frame: 160 samples, 20 ms";
export const CHIP_WINDOW = "this frame's window: 255 samples";
const NEEDS_PCM = "Needs the audio samples";

/** @typedef {"original" | "decoded"} Track */
/** @typedef {"corner" | "front" | "top"} Preset */

/**
 * One row of the 3D view, and of the 2D lanes: frame i + k as its 160
 * samples and as its 255-sample window. Both shapes have WINDOW points, so
 * one morphs into the other; the frame shape clamps the window's positions
 * to the frame and its joining sample (the next frame's first).
 * @typedef {Object} Row
 * @property {number} k  frames from the selected one
 * @property {boolean} present  the frame is inside the clip
 * @property {Float32Array} frameU  positions, samples from frame i's start
 * @property {Float32Array} frameV  the samples there, -1 to 1
 * @property {Float32Array} windowU
 * @property {Float32Array} windowV  the samples there times the window
 */

/**
 * What the 3D part draws: everything is computed here (a 3D part computes
 * no model data).
 * @typedef {Object} FramesState
 * @property {number} index
 * @property {Track} track
 * @property {boolean} windows
 * @property {Preset} preset
 * @property {boolean} playing
 * @property {number} peak  the inset's full scale (largest |sample| of frames i-1 to i+1)
 * @property {number} scale  the inset's full scale as a fraction of its half height (SCALE)
 * @property {number} period  one pitch period in samples at this frame's f0, 0 with no pitch
 * @property {number} replay  bumped by a step that shows the slide into depth again
 * @property {Row[]} rows  k = -REACH to REACH
 * @property {Float32Array} weights  the Hamming window, WINDOW points
 * @property {number[]} tones  each row's place on the ramp (tone), 0 for frame i
 * @property {{frame: string, window: string}} chips  the chip's text for a row as a frame, and as a window
 * @property {string} label  the sentence for the 3D canvas
 */

/**
 * Where row k sits on the ramp: time, earliest frame 0, latest 1, with
 * frame i (the highlight) left out. Both views colour the rows by it.
 * @param {number} k -REACH to REACH, not 0
 * @returns {number}
 */
export const tone = (k) => (k + REACH - (k > 0 ? 1 : 0)) / (2 * REACH - 1);

/** The Hamming window, w(j) = 0.54 - 0.46 cos(2 pi j / 254). */
export const WEIGHTS = Float32Array.from({ length: WINDOW }, (_, j) => 0.54 - 0.46 * Math.cos((2 * Math.PI * j) / (WINDOW - 1)));

/**
 * The rows around frame `index`, from display samples (the decoded track
 * moved back by its delay, so both tracks share one clock).
 * @param {(d: number) => number} sample display sample d, 0 outside the clip
 * @param {number} index
 * @param {number} count frames in the clip
 * @returns {Row[]}
 */
export function rowsAround(sample, index, count) {
  /** @type {Row[]} */
  const rows = [];
  const base = index * FRAME;
  for (let k = -REACH; k <= REACH; k += 1) {
    const frameU = new Float32Array(WINDOW);
    const frameV = new Float32Array(WINDOW);
    const windowU = new Float32Array(WINDOW);
    const windowV = new Float32Array(WINDOW);
    const start = k * FRAME;
    for (let j = 0; j < WINDOW; j += 1) {
      const uw = start + FRAME / 2 - HALF + j;
      const uf = Math.min(start + FRAME, Math.max(start, uw));
      windowU[j] = uw;
      windowV[j] = sample(base + uw) * WEIGHTS[j];
      frameU[j] = uf;
      frameV[j] = sample(base + uf);
    }
    rows.push({ k, present: index + k >= 0 && index + k < count, frameU, frameV, windowU, windowV });
  }
  return rows;
}

/** @param {number} n @param {number} digits */
const fixed = (n, digits) => n.toFixed(digits);

const TEMPLATE = `
  <div class="anim-figure__head">
    <p class="anim-figure__title">Overlapping analysis windows at 50 frames per second</p>
  </div>
  <div class="anim-figure__scroll">
    <div class="anim-figure__frame frames__main" data-state="loading">
      <canvas class="anim-figure__canvas" role="img"
              aria-label="The whole clip as a waveform with one 20 millisecond frame marked, and a zoomed view of that frame and its neighbours"></canvas>
      <div class="anim-figure__frame frames__overlay"></div>
    </div>
  </div>
  <div class="anim-figure__step" hidden></div>
  <ul class="anim-legend frames__legend"></ul>
  <div class="fp">
    <div class="fp__cell"><span class="fp__key">Frame</span><span class="fp__val" data-role="p-frame">0</span></div>
    <div class="fp__cell"><span class="fp__key">Time</span><span class="fp__val" data-role="p-time">0</span></div>
    <div class="fp__cell"><span class="fp__key">Level <em>derived</em></span><span class="fp__val" data-role="p-level">0</span></div>
    <div class="fp__cell"><span class="fp__key">Pitch <em>derived</em></span><span class="fp__val" data-role="p-pitch">0</span></div>
    <div class="fp__cell fp__cell--wide frames__window">
      <span class="fp__item"><span class="fp__key">Window <em>illustrative</em></span>
        <output class="fp__val" aria-live="polite" data-role="r-window">255 samples, 31.9 ms</output></span>
      <span class="fp__item"><span class="fp__key">Step</span>
        <output class="fp__val" aria-live="polite" data-role="r-step">160 samples, 20 ms</output></span>
      <span class="fp__item"><span class="fp__key">Shared</span>
        <output class="fp__val" aria-live="polite" data-role="r-shared">95 samples</output></span>
      <span class="fp__item"><span class="fp__key">Periods in window <em>derived</em></span>
        <output class="fp__val" aria-live="polite" data-role="r-periods">0</output></span>
    </div>
    <div class="fp__cell fp__cell--wide" data-measured="hex">
      <span class="fp__key">Channel frame <em class="is-measured">measured</em></span>
      <span class="fp__val" data-role="p-hex">0</span>
    </div>
    <div class="fp__cell fp__cell--wide">
      <span class="fp__key">Band voicing <em>derived from the decoded audio</em></span>
      <span class="fp__bands" data-role="p-bands"></span>
      <span class="fp__scale"><span>0 Hz</span><span>4 kHz</span></span>
    </div>
  </div>
  <div class="anim-controls">
    <button class="anim-btn anim-btn--play" type="button" data-kind="motion" aria-pressed="false">Play</button>
    <label class="anim-field">
      <span class="anim-field__label">Frame</span>
      <input class="anim-range" data-role="frame" type="range" min="0" max="0" step="1" value="0"
             aria-label="Which 20 millisecond frame is selected">
    </label>
    <output class="anim-readout anim-readout--wide" data-role="time-out">0.00 s</output>
    <div class="anim-toggle-group" role="group" aria-label="Which audio track to show">
      <button class="anim-btn" type="button" data-track="original" aria-pressed="true">Original</button>
      <button class="anim-btn" type="button" data-track="decoded" aria-pressed="false">Through AMBE</button>
    </div>
    <button class="anim-btn" type="button" data-role="windows" aria-pressed="false">Windows</button>
    <div class="anim-toggle-group" role="group" aria-label="View">
      <button class="anim-btn" type="button" data-view="3d" aria-pressed="false" disabled>3D</button>
      <button class="anim-btn" type="button" data-view="lanes" aria-pressed="false">Lanes</button>
    </div>
    <div class="anim-toggle-group" role="group" aria-label="Camera" hidden>
      <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
      <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
      <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
    </div>
  </div>
  <p class="anim-figure__hint">Playback is off because your system asks for reduced
     motion. Drag the waveform, or use the Frame slider, to step through the clip by hand.</p>
  <p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
  <figcaption class="anim-figure__caption"></figcaption>`;

/**
 * @param {Element} host
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const authored = host.querySelector(":scope > .anim-fallback figcaption");
  // The live caption is the fallback's, so the two cannot drift apart.
  const captionNodes = authored ? [...authored.cloneNode(true).childNodes] : [];
  const figure = document.createElement("figure");
  figure.className = "anim-figure frames";
  figure.innerHTML = TEMPLATE;
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  caption.append(...captionNodes, " ", badge("input"), " ", badge("illustrative"));
  host.append(figure);
  markEnhanced(host);

  const frameBox = $(figure, ".frames__main", HTMLElement);
  const overlay = $(figure, ".frames__overlay", HTMLElement);
  const canvas = $(frameBox, "canvas", HTMLCanvasElement);
  const playButton = $(figure, ".anim-btn--play", HTMLButtonElement);
  const frameInput = $(figure, '[data-role="frame"]', HTMLInputElement);
  const timeOut = $(figure, '[data-role="time-out"]', HTMLOutputElement);
  const trackButtons = [...figure.querySelectorAll("[data-track]")].filter((b) => b instanceof HTMLButtonElement);
  const windowsButton = $(figure, '[data-role="windows"]', HTMLButtonElement);
  const view3d = $(figure, 'button[data-view="3d"]', HTMLButtonElement);
  const lanesButton = $(figure, 'button[data-view="lanes"]', HTMLButtonElement);
  const cameraGroup = $(figure, '[aria-label="Camera"]', HTMLElement);
  const presetButtons = [...cameraGroup.querySelectorAll("[data-preset]")].filter((b) => b instanceof HTMLButtonElement);
  const webglHint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const legend = $(figure, ".frames__legend", HTMLElement);
  /** @param {string} role */
  const field = (role) => $(figure, `[data-role="${role}"]`, HTMLElement);
  const panel = {
    frame: field("p-frame"), time: field("p-time"), level: field("p-level"), pitch: field("p-pitch"),
    hex: field("p-hex"), bands: field("p-bands"), periods: field("r-periods"),
  };
  const bandEls = Array.from({ length: 8 }, () => {
    const el = document.createElement("i");
    el.className = "fp__band";
    el.style.setProperty("--v", "0");
    panel.bands.append(el);
    return el;
  });
  if (!supportsWebGL2()) {
    webglHint.textContent = NO_WEBGL_HINT;
    webglHint.hidden = false;
  }

  const [wave, frameData] = await Promise.all([
    /** @type {Promise<WaveformFile>} */ (loadJSON("assets/data/waveform.json", { signal })),
    /** @type {Promise<FramesFile>} */ (loadJSON("assets/data/frames.json", { signal })),
  ]);
  delete frameBox.dataset.state;

  const clip = wave.clip;
  const frames = frameData.frames;
  const frameCount = clip.frame_count;
  const frameS = clip.frame_ms / 1000;
  const duration = frameCount * frameS;
  const bucketS = wave.bucket_ms / 1000;
  const buckets = wave.bucket_count;
  const fullScale = wave.sample_full_scale;
  const bandEdges = frameData.derived_notes.band_edges_hz;
  /** @type {Record<Track, {env: WaveformEnvelope, path: string, delay: number, peak: number}>} */
  const tracks = {
    original: { env: wave.original, path: clip.original_audio, delay: 0, peak: 1 },
    decoded: { env: wave.decoded, path: clip.decoded_audio, delay: clip.decoded_delay_samples, peak: 1 },
  };
  for (const track of Object.values(tracks)) {
    let peak = 1;
    for (let b = 0; b < buckets; b += 1) peak = Math.max(peak, Math.abs(track.env.min[b]), Math.abs(track.env.max[b]));
    track.peak = peak / fullScale;
  }

  /** @type {Record<Track, HTMLAudioElement>} */
  const audio = { original: new Audio(), decoded: new Audio() };
  for (const key of /** @type {Track[]} */ (["original", "decoded"])) {
    audio[key].src = assetURL(tracks[key].path);
    audio[key].preload = "metadata";
  }

  // The samples, for the inset and the 3D rows. Without them the inset
  // falls back to the 2.5 ms buckets and the 3D view stays off.
  /** @type {Record<Track, Float32Array | null>} */
  const pcm = { original: null, decoded: null };

  /* -- state ------------------------------------------------------------ */

  const mixed = PICKS.mixed(frames);
  const state = {
    index: mixed ? mixed.i : Math.round(0.4 * (frameCount - 1)),
    /** @type {Track} */ track: "original",
    windows: false,
    lanes: false,
    /** @type {Preset} */ preset: "corner",
    playing: false,
    replay: 0,
  };
  frameInput.max = String(frameCount - 1);
  /** @type {null | "overview" | "inset"} */
  let dragging = null;
  /** @type {null | {overview: Box, inset: Box}} */
  let geom = null;
  /** @type {ReturnType<typeof createViewSwitch> | null} */
  let views = null;
  /** The 3D view is up (or loading): the inset belongs to it. */
  const in3D = () => (views ? views.view() === "3d" || views.view() === "loading" : false);

  const clampIndex = (/** @type {number} */ i) => Math.min(Math.max(Math.trunc(i), 0), frameCount - 1);
  const activeAudio = () => audio[state.track];
  /** Display sample d of the current track: the decoded one moved back by its delay. */
  const sample = (/** @type {number} */ d) => {
    const data = pcm[state.track];
    const n = d + tracks[state.track].delay;
    return data && n >= 0 && n < data.length ? data[n] : 0;
  };
  /** The inset's full scale: the largest |sample| of frames i-1 to i+1, at least 0.015. */
  const insetPeak = () => {
    let peak = 0.015;
    for (let d = (state.index - 1) * FRAME; d < (state.index + 2) * FRAME; d += 1) peak = Math.max(peak, Math.abs(sample(d)));
    return peak;
  };
  const f0Now = () => {
    const d = frames[state.index].derived;
    return state.track === "decoded" ? d.decoded_f0_hz : d.orig_f0_hz;
  };

  /** @returns {FramesState} */
  const snapshot = () => ({
    index: state.index,
    track: state.track,
    windows: state.windows,
    preset: state.preset,
    playing: state.playing,
    peak: insetPeak(),
    period: f0Now() > 0 ? RATE / f0Now() : 0,
    scale: SCALE,
    replay: state.replay,
    rows: rowsAround(sample, state.index, frameCount),
    weights: WEIGHTS,
    chips: { frame: CHIP, window: CHIP_WINDOW },
    tones: Array.from({ length: 2 * REACH + 1 }, (_, r) => (r === REACH ? 0 : tone(r - REACH))),
    label: describe3D(),
  });

  const describe3D = () => {
    const f = frames[state.index];
    return `Frames ${Math.max(0, f.i - REACH)} to ${Math.min(frameCount - 1, f.i + REACH)} as rows in depth, ` +
      `frame ${f.i} thick and outlined, ${state.track === "decoded" ? "through AMBE" : "the input"}. ` +
      (state.windows
        ? `Each row is its 255-sample window, so neighbouring rows share 95 samples, shaded on the floor.`
        : `Each row is its 160 samples; seen from the front they tile with no gap.`);
  };

  /* -- panel ------------------------------------------------------------ */

  const paintPanel = () => {
    const f = frames[state.index];
    const d = f.derived;
    const decoded = state.track === "decoded";
    panel.frame.textContent = `${f.i} of ${frameCount}`;
    panel.time.textContent = `${fixed(f.t, 3)} to ${fixed(f.t + frameS, 3)} s`;
    panel.level.textContent = `${fixed(decoded ? d.decoded_rms_dbfs : d.orig_rms_dbfs, 1)} dBFS`;
    const f0 = f0Now();
    const conf = decoded ? d.decoded_f0_confidence : d.orig_f0_confidence;
    panel.pitch.textContent = f0 > 0 ? `${fixed(f0, 1)} Hz, conf ${fixed(conf, 2)}` : "no periodicity";
    panel.pitch.classList.toggle("fp__val--dim", !(f0 > 0));
    panel.periods.textContent = f0 > 0 ? `${fixed((WINDOW * f0) / RATE, 1)} periods` : "no periodicity";
    panel.hex.textContent = f.hex.replace(/(.{2})/g, "$1 ").trim();
    bandEls.forEach((el, b) => {
      const v = d.band_voicing[b] || 0;
      el.style.setProperty("--v", String(Math.min(1, Math.max(0, v))));
      el.dataset.on = d.band_voiced[b] ? "1" : "0";
      el.title = `${bandEdges[b][0]} to ${bandEdges[b][1]} Hz: ${fixed(v, 2)}${d.band_voiced[b] ? " (voiced)" : ""}`;
    });
    timeOut.textContent = `#${f.i}, ${fixed(f.t, 2)} s`;
    if (frameInput.value !== String(state.index)) frameInput.value = String(state.index);
    frameInput.setAttribute("aria-valuetext",
      `frame ${f.i} of ${frameCount}, ${fixed(f.t, 2)} seconds, ${f0 > 0 ? `${fixed(f0, 0)} hertz` : "no periodicity"}`);
  };

  /** A row of the 3D view louder than the inset's three frames, which the view squeezes to fit. */
  const loudNeighbour = () => {
    const peak = insetPeak();
    const from = (state.index - REACH) * FRAME + FRAME / 2 - HALF;
    const to = (state.index + REACH) * FRAME + FRAME / 2 + HALF;
    for (let d = Math.max(0, from); d <= to; d += 1) if (Math.abs(sample(d)) > peak) return true;
    return false;
  };
  let legendKey = "";
  const paintLegend = () => {
    /** @type {[string, string][]} */
    const items = [["frames__key--this", "this frame (thick)"], ["frames__key--near", "neighbouring frames (thin, coloured by time)"]];
    if (state.windows) {
      items.push(["frames__key--window", "Hamming window, 255 samples (dashed)"],
        ["frames__key--shared", "samples two windows share (shaded)"]);
    }
    if (in3D() && loudNeighbour()) items.push(["frames__key--note", "rows louder than these three frames are squeezed to fit"]);
    const key = items.map(([k]) => k).join();
    if (key === legendKey) return;
    legendKey = key;
    legend.replaceChildren(...items.map(([key, text]) => {
      const li = document.createElement("li");
      li.className = `anim-legend__item ${key}`;
      li.innerHTML = `<span class="anim-legend__swatch"></span>`;
      li.append(text);
      return li;
    }));
  };

  /* -- drawing ---------------------------------------------------------- */

  /** @typedef {{x: number, y: number, width: number, height: number}} Box */

  const view = setupCanvas(canvas, { onResize: () => draw() });
  const ctx = view.ctx;
  /** Inset points, for the test hook: display sample u (from frame i's start) and its CSS px. */
  /** @type {{u: number, x: number, y: number}[]} */
  let insetPoints = [];

  /** @param {WaveformEnvelope} env @param {number} tA @param {number} tB */
  const extremes = (env, tA, tB) => {
    const b0 = Math.max(0, Math.floor(tA / bucketS));
    const b1 = Math.min(buckets - 1, Math.ceil(tB / bucketS) - 1);
    let lo = 0;
    let hi = 0;
    for (let b = b0; b <= b1; b += 1) {
      lo = Math.min(lo, env.min[b]);
      hi = Math.max(hi, env.max[b]);
    }
    return [lo / fullScale, hi / fullScale];
  };

  /**
   * @param {import("./anim-core.js").Theme} theme
   * @param {Box} box
   */
  const drawOverview = (theme, box) => {
    const track = tracks[state.track];
    const mid = box.y + box.height / 2;
    const half = (box.height / 2) * (0.94 / track.peak);
    const highlight = theme.css("--ambe-highlight");
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let px = 0; px < box.width; px += 1) {
      const [lo, hi] = extremes(track.env, (px / box.width) * duration, ((px + 1) / box.width) * duration);
      const x = crisp(box.x + px);
      ctx.moveTo(x, mid - hi * half);
      ctx.lineTo(x, mid - lo * half + 0.5);
    }
    ctx.stroke();
    // Frame tick ruler: one tick per frame, 159 of them, a longer one every ten.
    const perFrame = box.width / frameCount;
    if (perFrame >= 2.5) {
      ctx.strokeStyle = theme.hairline;
      ctx.beginPath();
      for (let i = 0; i <= frameCount; i += 1) {
        const x = crisp(box.x + i * perFrame);
        ctx.moveTo(x, box.y + box.height);
        ctx.lineTo(x, box.y + box.height - (i % 10 === 0 ? 7 : 4));
      }
      ctx.stroke();
    }
    const xa = box.x + ((state.index * frameS) / duration) * box.width;
    const wide = Math.max(box.width / frameCount, 3);
    ctx.fillStyle = theme.css("--ambe-highlight-fill-top");
    ctx.fillRect(xa, box.y, wide, box.height);
    ctx.strokeStyle = highlight;
    ctx.beginPath();
    for (let px = Math.floor(xa); px <= Math.ceil(xa + wide); px += 1) {
      const tA = ((px - box.x) / box.width) * duration;
      const [lo, hi] = extremes(track.env, tA, tA + duration / box.width);
      ctx.moveTo(crisp(px), mid - hi * half);
      ctx.lineTo(crisp(px), mid - lo * half + 0.5);
    }
    ctx.moveTo(crisp(xa), box.y - 4);
    ctx.lineTo(crisp(xa), box.y + box.height + 2);
    ctx.moveTo(crisp(xa + wide), box.y - 4);
    ctx.lineTo(crisp(xa + wide), box.y + box.height + 2);
    ctx.stroke();
    if (state.playing) {
      const tp = Math.min(Math.max(activeAudio().currentTime - track.delay / RATE, 0), duration);
      const xp = crisp(box.x + (tp / duration) * box.width);
      ctx.strokeStyle = theme.ink;
      ctx.beginPath();
      ctx.moveTo(xp, box.y - 4);
      ctx.lineTo(xp, box.y + box.height + 2);
      ctx.stroke();
    }
    return { xa, xb: xa + wide };
  };

  /**
   * The inset: frames i-1 to i+1 on one time axis, 480 samples across.
   * u is a display sample counted from frame i's start, -160 to 320.
   * @param {import("./anim-core.js").Theme} theme
   * @param {Box} box
   * @param {boolean} compact
   */
  const drawInset = (theme, box, compact) => {
    const xOf = (/** @type {number} */ u) => box.x + ((u + FRAME) / (3 * FRAME)) * box.width;
    const near = (/** @type {number} */ k) => `#${rampColor(tone(k)).toString(16).padStart(6, "0")}`;
    const highlight = theme.css("--ambe-highlight");
    const shared = theme.css("--ambe-cat-5");
    const peak = insetPeak();
    const base = state.index * FRAME;
    const lanes = state.lanes && !in3D();
    const laneH = lanes ? box.height / 3 : box.height;
    /** Middle and scale of row k (-1, 0, 1): a lane each, or all on the one axis. */
    const rowMid = (/** @type {number} */ k) => (lanes ? box.y + laneH * (k + 1) + laneH / 2 : box.y + box.height / 2);
    const half = (laneH / 2) * (SCALE / peak);
    const envHalf = (laneH / 2) * SCALE;
    // Labels sit in the bands SCALE leaves above and below the samples.
    const labelSize = compact ? 9 : 10.5;
    const topRow = box.y + (compact ? 10 : 11);
    const secondRow = box.y + (compact ? 26 : 29);
    const chipSize = compact ? 9.5 : 11;
    ctx.save();
    ctx.font = `550 ${chipSize}px ${theme.font}`;
    const chipText = ctx.measureText(CHIP).width <= box.width / 3 - 10 ? CHIP : "160 samples, 20 ms";
    const chipW = ctx.measureText(chipText).width + 8;
    ctx.font = `600 ${labelSize}px ${theme.font}`;
    const sharedW = ctx.measureText(`${SHARED} shared`).width + 4;
    ctx.restore();
    /** Where the top row's first label starts. */
    const topClear = state.windows ? xOf(0) - sharedW / 2 : xOf(FRAME / 2) - chipW / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    // Frame i's own 20 ms, and the samples two windows share.
    ctx.fillStyle = theme.css("--ambe-highlight-fill-top");
    ctx.fillRect(xOf(0), lanes ? box.y + laneH : box.y, xOf(FRAME) - xOf(0), laneH);
    if (state.windows) {
      // The one colour the legend's swatch and the 3D strips use, shaded.
      ctx.fillStyle = shared;
      ctx.strokeStyle = shared;
      for (const [a, b] of SPANS) {
        ctx.globalAlpha = theme.dark ? 0.2 : 0.13;
        ctx.fillRect(xOf(a), box.y, xOf(b) - xOf(a), box.height);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        for (const x of [xOf(a), xOf(b)]) {
          ctx.moveTo(crisp(x), box.y);
          ctx.lineTo(crisp(x), box.y + box.height);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Frame boundaries, and the zero line of each row.
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let k = -1; k <= 2; k += 1) {
      ctx.moveTo(crisp(xOf(k * FRAME)), box.y);
      ctx.lineTo(crisp(xOf(k * FRAME)), box.y + box.height);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    for (const k of lanes ? [-1, 0, 1] : [0]) {
      ctx.moveTo(box.x, crisp(rowMid(k)));
      ctx.lineTo(box.x + box.width, crisp(rowMid(k)));
    }
    ctx.stroke();

    /** @param {number} k @param {string} colour @param {number} width @param {boolean} dots */
    const drawRow = (k, colour, width, dots) => {
      const mid = rowMid(k);
      const windowed = lanes && state.windows;
      const from = windowed ? k * FRAME + FRAME / 2 - HALF : k * FRAME;
      const to = windowed ? from + WINDOW - 1 : k * FRAME + FRAME;
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let u = from; u <= to; u += 1) {
        const v = sample(base + u) * (windowed ? WEIGHTS[u - from] : 1);
        const y = mid - v * half;
        if (u === from) ctx.moveTo(xOf(u), y);
        else ctx.lineTo(xOf(u), y);
        if (!lanes && u < to && u >= -FRAME && u < 2 * FRAME) insetPoints.push({ u, x: xOf(u), y });
      }
      ctx.stroke();
      if (dots && box.width / (3 * FRAME) > 4) {
        ctx.fillStyle = colour;
        for (let u = from; u < to; u += 1) {
          ctx.beginPath();
          ctx.arc(xOf(u), mid - sample(base + u) * half, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    insetPoints = [];
    if (pcm[state.track]) {
      drawRow(-1, near(-1), 1.4, false);
      drawRow(1, near(1), 1.4, false);
      drawRow(0, highlight, 2.2, true);
      insetPoints.sort((a, b) => a.u - b.u);
    } else {
      // No samples: the 2.5 ms buckets, drawn as a band.
      const track = tracks[state.track];
      const tStart = (state.index - 1) * frameS;
      const b0 = Math.max(0, Math.floor(tStart / bucketS));
      const b1 = Math.min(buckets, Math.ceil((tStart + 3 * frameS) / bucketS));
      const scale = (box.height / 2) * (0.9 / track.peak);
      const xT = (/** @type {number} */ t) => box.x + ((t - tStart) / (3 * frameS)) * box.width;
      ctx.fillStyle = theme.muted;
      ctx.beginPath();
      for (let b = b0; b < b1; b += 1) ctx.lineTo(xT(b * bucketS), rowMid(0) - (track.env.max[b] / fullScale) * scale);
      for (let b = b1 - 1; b >= b0; b -= 1) ctx.lineTo(xT(b * bucketS), rowMid(0) - (track.env.min[b] / fullScale) * scale);
      ctx.closePath();
      ctx.fill();
    }

    // The Hamming windows of frames i-1, i and i+1, dashed, over the samples.
    if (state.windows) {
      ctx.setLineDash([5, 4]);
      for (const k of [-1, 1, 0]) {
        const mid = rowMid(k);
        const from = k * FRAME + FRAME / 2 - HALF;
        ctx.strokeStyle = k === 0 ? theme.ink : near(k);
        ctx.lineWidth = k === 0 ? 1.5 : 1.25;
        for (const sign of [1, -1]) {
          ctx.beginPath();
          for (let j = 0; j < WINDOW; j += 1) {
            const y = mid - sign * WEIGHTS[j] * envHalf;
            if (j === 0) ctx.moveTo(xOf(from + j), y);
            else ctx.lineTo(xOf(from + j), y);
          }
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      for (const centre of [0, FRAME]) {
        drawLabel(ctx, `${SHARED} shared`, xOf(centre), topRow, {
          align: "center", baseline: "middle", size: labelSize, weight: 600, color: shared,
          background: theme.plotBg, padding: 2,
        });
      }
    }

    if (state.playing) {
      const tp = activeAudio().currentTime - tracks[state.track].delay / RATE;
      const u = tp * RATE - base;
      if (u >= -FRAME && u <= 2 * FRAME) {
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crisp(xOf(u)), box.y);
        ctx.lineTo(crisp(xOf(u)), box.y + box.height);
        ctx.stroke();
      }
    }

    // One pitch period, from this frame's f0: a scale, not an epoch mark. It
    // sits in the band above the samples, on the top row when that row has
    // room left of its first label, else on the row under it.
    const f0 = f0Now();
    const size = compact ? 9.5 : 10.5;
    if (f0 > 0 && !lanes) {
      const len = ((RATE / f0) / (3 * FRAME)) * box.width;
      const text = `one period, ${fixed(RATE / f0, 0)} samples`;
      ctx.save();
      ctx.font = `400 ${size}px ${theme.font}`;
      const x0 = box.x + 8;
      const end = x0 + len + 6 + ctx.measureText(text).width + 8;
      ctx.restore();
      const y0 = end <= topClear ? topRow : secondRow;
      ctx.strokeStyle = theme.text3;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0 - 4);
      ctx.lineTo(x0, y0 + 4);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + len, y0);
      ctx.moveTo(x0 + len, y0 - 4);
      ctx.lineTo(x0 + len, y0 + 4);
      ctx.stroke();
      drawLabel(ctx, text, x0 + len + 6, y0, {
        baseline: "middle", size, color: theme.text2, background: theme.plotBg, padding: 2,
      });
    }

    // Names of the three frames.
    for (let k = -1; k <= 1; k += 1) {
      const i = state.index + k;
      if (i < 0 || i >= frameCount) continue;
      const y = lanes ? rowMid(k) - laneH / 2 + 12 : box.y + box.height - (compact ? 9 : 12);
      drawLabel(ctx, `frame ${i}`, lanes ? box.x + 6 : xOf(k * FRAME + FRAME / 2), y, {
        align: lanes ? "left" : "center", baseline: "middle",
        size, weight: k === 0 ? 600 : 400, color: k === 0 ? highlight : theme.text3,
        background: lanes ? undefined : theme.plotBg, padding: 2,
      });
    }
    ctx.restore();

    if (!state.windows) {
      drawLabel(ctx, chipText, xOf(FRAME / 2), topRow + (lanes ? laneH : 0), {
        align: "center", baseline: "middle", size: chipSize, weight: 550,
        color: theme.ink, background: theme.css("--ambe-highlight-chip"), padding: 4,
      });
    }
  };

  const draw = () => {
    const theme = getTheme();
    clearCanvas(ctx, view, theme.plotBg);
    const compact = view.width < 520;
    const padX = 12;
    const headerH = compact ? 18 : 22;
    const width = Math.max(40, view.width - padX * 2);
    const bodyH = view.height - headerH - 8;
    const overviewH = Math.round(bodyH * 0.28);
    const linkH = compact ? 16 : 22;
    const overview = { x: padX, y: headerH, width, height: overviewH };
    // Whole pixels: the 3D view over the inset is sized from its frame's
    // clientWidth and clientHeight, which round.
    const inset = { x: padX, y: headerH + overviewH + linkH, width: Math.floor(width), height: Math.max(40, Math.floor(bodyH - overviewH - linkH)) };
    const headSize = compact ? 10 : 11;
    const right = `${fixed(duration, 2)} s, ${frameCount} frames, ${state.track === "decoded" ? "after AMBE" : "original"}`;
    ctx.save();
    ctx.font = `500 ${headSize}px ${theme.font}`;
    const room = width - ctx.measureText(right).width - 16;
    let left = clip.text;
    while (left.length > 1 && ctx.measureText(`${left}…`).width > room) left = left.slice(0, -1);
    if (left !== clip.text) left = `${left.trim()}…`;
    ctx.restore();
    drawLabel(ctx, left, padX, compact ? 4 : 5, { baseline: "top", size: headSize, weight: 500, color: theme.text3 });
    drawLabel(ctx, right, padX + width, compact ? 4 : 5, { align: "right", baseline: "top", size: headSize, weight: 500, color: theme.text3 });

    const marks = drawOverview(theme, overview);
    drawInset(theme, inset, compact);
    const xOf = (/** @type {number} */ u) => inset.x + ((u + FRAME) / (3 * FRAME)) * inset.width;
    // The sliver above, opened out into frame i below.
    ctx.save();
    ctx.strokeStyle = theme.css("--ambe-highlight");
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(marks.xa, overview.y + overview.height + 3);
    ctx.lineTo(xOf(0), inset.y - 3);
    ctx.moveTo(marks.xb, overview.y + overview.height + 3);
    ctx.lineTo(xOf(FRAME), inset.y - 3);
    ctx.stroke();
    ctx.restore();

    geom = { overview, inset };
    paintLegend();
    // One pixel past the inset on the right and below, so no sliver of it
    // shows under the 3D view where the two canvases round apart; the 3D
    // view fits its box to the inset's own size (OVERHANG).
    Object.assign(overlay.style, {
      left: `${inset.x}px`, top: `${inset.y}px`, width: `${inset.width + OVERHANG}px`, height: `${inset.height + OVERHANG}px`,
    });
    paintPanel();
    if (TEST_HOOK) {
      TEST_HOOK.figures.frames = { index: state.index, track: state.track, windows: state.windows, lanes: state.lanes,
        inset, points: insetPoints, view: views?.view() ?? "2d" };
    }
  };

  /* -- the 3D view ------------------------------------------------------ */

  /** Push the state to the 3D view, if one is up. */
  const push = () => views?.update(snapshot());

  const showControls = () => {
    const up = in3D();
    cameraGroup.hidden = !up;
    lanesButton.hidden = up;
    lanesButton.setAttribute("aria-pressed", String(state.lanes));
    for (const b of presetButtons) b.setAttribute("aria-pressed", String(b.dataset.preset === state.preset));
    windowsButton.setAttribute("aria-pressed", String(state.windows));
    for (const b of trackButtons) {
      b.setAttribute("aria-pressed", String(b.dataset.track === state.track));
      b.disabled = state.windows && b.dataset.track === "decoded";
    }
  };

  /* -- playback --------------------------------------------------------- */

  const loop = createLoop(() => {
    const t = activeAudio().currentTime - tracks[state.track].delay / RATE;
    const next = clampIndex(Math.floor(t / frameS));
    if (next !== state.index) {
      state.index = next;
      push();
    }
    draw();
  }, {
    element: figure,
    autoplay: false,
    onStateChange(running) {
      if (!running && state.playing) pause();
    },
  });

  /** Seeking before metadata arrives throws in some engines; never fatal. */
  const setTime = (/** @type {HTMLAudioElement} */ el, /** @type {number} */ t) => {
    try {
      el.currentTime = Math.min(Math.max(t, 0), Number.isFinite(el.duration) ? el.duration : Infinity);
    } catch (error) {
      // the next seek lands once metadata is in
    }
  };
  const setPlayButton = (/** @type {boolean} */ on) => {
    playButton.setAttribute("aria-pressed", String(on));
    playButton.textContent = on ? "Pause" : "Play";
  };
  const play = () => {
    const el = activeAudio();
    const want = state.index * frameS + tracks[state.track].delay / RATE;
    if (Math.abs(el.currentTime - want) > frameS * 1.5) setTime(el, want);
    el.play().catch((error) => {
      console.warn("anim-frames: playback blocked", error);
      pause();
    });
    state.playing = true;
    setPlayButton(true);
    loop.start();
    push();
  };
  function pause() {
    state.playing = false;
    for (const el of Object.values(audio)) el.pause();
    setPlayButton(false);
    loop.stop();
    push();
    draw();
  }
  const onEnded = () => {
    pause();
    state.index = 0;
    for (const el of Object.values(audio)) setTime(el, 0);
    push();
    draw();
  };
  playButton.addEventListener("click", () => (state.playing ? pause() : play()), { signal });
  for (const el of Object.values(audio)) el.addEventListener("ended", onEnded, { signal });

  /* -- input ------------------------------------------------------------ */

  const seek = (/** @type {number} */ i) => {
    const next = clampIndex(i);
    if (next === state.index && !state.playing) return;
    state.index = next;
    setTime(activeAudio(), state.index * frameS + tracks[state.track].delay / RATE);
    push();
    draw();
  };
  const local = (/** @type {PointerEvent} */ event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * view.width,
      y: ((event.clientY - rect.top) / rect.height) * view.height,
    };
  };
  const scrub = (/** @type {PointerEvent} */ event) => {
    if (!geom) return;
    const { x } = local(event);
    if (dragging === "inset") {
      const u = ((x - geom.inset.x) / geom.inset.width) * 3 * FRAME - FRAME;
      seek(state.index + Math.floor(u / FRAME));
    } else {
      seek(Math.floor((((x - geom.overview.x) / geom.overview.width) * duration) / frameS));
    }
  };
  canvas.style.touchAction = "pan-y";
  canvas.addEventListener("pointerdown", (event) => {
    if (!geom) return;
    dragging = local(event).y >= geom.inset.y - 6 ? "inset" : "overview";
    if (state.playing) pause();
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = "grabbing";
    scrub(event);
    event.preventDefault();
  }, { signal });
  canvas.addEventListener("pointermove", (event) => {
    if (dragging) scrub(event);
  }, { signal });
  const release = (/** @type {PointerEvent} */ event) => {
    if (!dragging) return;
    dragging = null;
    canvas.style.cursor = "";
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerup", release, { signal });
  canvas.addEventListener("pointercancel", release, { signal });
  frameInput.addEventListener("input", () => {
    if (state.playing) pause();
    seek(Number(frameInput.value));
  }, { signal });

  const setTrack = (/** @type {Track} */ key) => {
    if (key === state.track || (state.windows && key === "decoded")) return;
    const was = state.playing;
    if (was) pause();
    state.track = key;
    setTime(activeAudio(), state.index * frameS + tracks[key].delay / RATE);
    showControls();
    push();
    draw();
    if (was) play();
  };
  for (const b of trackButtons) {
    b.addEventListener("click", () => setTrack(b.dataset.track === "decoded" ? "decoded" : "original"), { signal });
  }
  /** Windows: the input track only, so the track goes back to Original. */
  const setWindows = (/** @type {boolean} */ on) => {
    if (on && state.track === "decoded") setTrack("original");
    state.windows = on;
    paintLegend();
    showControls();
    push();
    draw();
  };
  windowsButton.addEventListener("click", () => setWindows(!state.windows), { signal });
  lanesButton.addEventListener("click", () => {
    state.lanes = !state.lanes;
    showControls();
    draw();
  }, { signal });
  const setPreset = (/** @type {Preset} */ name) => {
    state.preset = name;
    views?.preset(name);
    showControls();
  };
  for (const b of presetButtons) {
    b.addEventListener("click", () => setPreset(/** @type {Preset} */ (b.dataset.preset)), { signal });
  }

  const unsubscribe = onThemeChange(() => draw());
  if (prefersReducedMotion()) figure.classList.add("is-static");
  setPlayButton(false);
  paintLegend();
  showControls();
  draw();

  // The samples, then the view switch: the 3D rows need them.
  const ready = Promise.all((/** @type {Track[]} */ (["original", "decoded"])).map((key) =>
    loadPCM(tracks[key].path, { signal }).then((data) => {
      pcm[key] = data;
    }))).then(() => true, (error) => {
    if (!signal.aborted) console.warn("anim-frames: no samples, the inset shows the envelope", error);
    return false;
  });

  /** A step asks for depth: 3D where it opens, Lanes where it cannot. */
  const askDepth = () => {
    if (views && views.available() && !prefersReducedMotion()) void views.show3D();
    else if (!in3D()) state.lanes = true;
  };

  /** The last step that named a view asked for 2D: the switch, made once the samples are in, opens there. */
  let stepWants2D = false;

  /** @param {Record<string, string>} s */
  const applyStep = (s) => {
    if (state.playing) pause();
    if (s.view === "2d") stepWants2D = true;
    else if (s.view) stepWants2D = false;
    if (s.pick && s.pick in PICKS) {
      const pick = PICKS[/** @type {keyof typeof PICKS} */ (s.pick)](frames);
      if (pick) state.index = pick.i;
    }
    if (s.windows) {
      state.windows = s.windows === "on";
      if (state.windows) state.track = "original";
    }
    if (s.preset === "corner" || s.preset === "front" || s.preset === "top") state.preset = s.preset;
    // A step that shows the slide into depth again (O1: a step that shows
    // the figure's point may replay it).
    if (s.replay === "slide") state.replay += 1;
    // A step that names no view keeps 3D as it is and leaves Lanes.
    if (s.view === "3d") askDepth();
    else if (s.view === "lanes") state.lanes = true;
    else state.lanes = false;
    if (s.view === "2d") views?.show2D();
    views?.preset(state.preset);
    paintLegend();
    showControls();
    push();
    draw();
  };
  if (steps.length) {
    $(figure, ".anim-figure__step", HTMLElement).hidden = false;
    createStepper(figure, steps, (s) => applyStep(s), { signal });
  }

  if (await ready && !signal.aborted) {
    draw();
    // settle() in the tests watches the main frame; the switch marks the overlay.
    const mirror = new MutationObserver(() => {
      if (overlay.dataset.three === "loading") frameBox.dataset.three = "loading";
      else delete frameBox.dataset.three;
    });
    mirror.observe(overlay, { attributes: true, attributeFilter: ["data-three"] });
    signal.addEventListener("abort", () => mirror.disconnect(), { once: true });
    if (supportsWebGL2()) view3d.disabled = false;
    views = createViewSwitch({
      frame: overlay,
      flat: null,
      toggle: view3d,
      hint: webglHint,
      signal,
      id: "frames",
      start: stepWants2D ? "2d" : "auto",
      state: snapshot,
      load: () => import("./anim-frames-3d.js"),
      onView: () => {
        showControls();
        draw();
      },
    });
    showControls();
  } else if (!signal.aborted) {
    view3d.disabled = true;
    webglHint.textContent = supportsWebGL2() ? NEEDS_PCM : NO_WEBGL_HINT;
    webglHint.hidden = false;
  }

  return () => {
    unsubscribe();
    loop.destroy();
    view.destroy();
    for (const el of Object.values(audio)) {
      el.pause();
      el.src = "";
    }
  };
}
