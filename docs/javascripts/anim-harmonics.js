// @ts-check
/* ===========================================================================
 * anim-harmonics.js: the fundamental and its harmonic series.
 * ---------------------------------------------------------------------------
 * SLUG          harmonics        <div data-anim="harmonics"></div>
 *               (index and docs/07-multi-band-excitation.md, steps on 07)
 *
 * DATA READ     assets/data/lr-b/frames.json   (male input recording, on demand)
 *               assets/data/lj-b/frames.json   (female input recording, on demand)
 *               Only `frames[].derived.orig_f0_hz` and `orig_f0_confidence`
 *               are used, to snap the pitch slider to a pitch derived from
 *               the input audio of each recording.
 *
 *               Each voice is reduced to ONE number: the median f0 over its
 *               confidently voiced frames. Stepping frame by frame was tried
 *               and removed. The autocorrelation pitch track has octave
 *               errors at both ends (male reaches 381 Hz, female drops to
 *               79 Hz), so a per-frame walk regularly showed the female voice
 *               with MORE harmonics than the male, the opposite of the point
 *               the figure exists to make. The median is stable, is honest
 *               about being a summary, and always orders the two voices.
 *
 * CONTROLS      pitch slider, 60 to 400 Hz (arrow keys step 1 Hz); a
 *               harmonic slider, 1 (the fundamental) to L, whose harmonic is
 *               drawn thick on the comb and as its own wave under the sum. Its
 *               top follows L, so raising the pitch pulls it down; "Male
 *               recording" and "Female recording" snap the slider to that
 *               voice's median pitch and ghost the other one behind it;
 *               3D, with its Camera group (lib/view-switch.js loads
 *               anim-harmonics-3d.js, where depth is the fundamental);
 *               Play and a volume slider, which sound the summed wave.
 *
 * WHAT IT DRAWS Two linked panels for one fundamental f0: a 0 to 4 kHz
 *               harmonic comb (stems at f0, 2f0, 3f0 ...) and the time-domain
 *               sum of those harmonics over 30 ms. The live readout is L,
 *               the number of harmonics under the cutoff:
 *               L = floor(alpha pi / w0) with alpha = 0.925, so
 *               floor(3700 Hz / f0) (US 5,701,390; US 5,754,974, as
 *               summarised in docs/08-analysis.md). The pitch-search bracket
 *               22 <= P < 115 samples at 8 kHz is from US 5,216,747.
 *
 * NOT A CODEC   There is no AMBE analysis or synthesis here, and no codec
 *               state is drawn. The spectral envelope that shapes the comb is
 *               a FIXED ILLUSTRATIVE SHAPE defined in this file (a sum of
 *               Lorentzian resonances): a picture of "a speech-like
 *               envelope", not a measurement and not an estimator. The
 *               time-domain trace is an ordinary sum of sinusoids: generic
 *               display maths. The
 *               only numbers from outside are pitches from the precomputed
 *               JSON. The ghost comb is the same envelope sampled at the
 *               other voice's median pitch. Play sounds the drawn sum through
 *               one Web Audio oscillator whose wave is built from the same
 *               amplitudes and phases, so what you hear is what is drawn.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createLoop,
  createPlot,
  crisp,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  loadJSON,
  markEnhanced,
  onThemeChange,
  prefersReducedMotion,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { CUTOFF_BADGE, CUTOFF_HZ, CUTOFF_LABEL } from "./lib/cutoff.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "harmonics";
const STEP_KEYS = /** @type {const} */ (["f0", "view", "preset"]);

/* --- constants that carry a citation ------------------------------------ */

/** Sampling is 8 kHz, so the analysis band runs to 4 kHz. */
export const NYQUIST_HZ = 4000;

/** Pitch-period search bracket, 22 <= P < 115 samples at 8 kHz (US 5,216,747). */
export const SEARCH_MIN_HZ = 8000 / 115; // about 69.6 Hz
export const SEARCH_MAX_HZ = 8000 / 22; //  about 363.6 Hz

/* --- purely illustrative display shapes --------------------------------- */

export const PITCH_MIN_HZ = 60;
export const PITCH_MAX_HZ = 400;
const DEFAULT_PITCH_HZ = 120;
/** The comb panel's top, in envelope units. */
export const Y_MAX = 1.08;

/** Window shown in the time panel. The first 20 ms is shaded as "one frame". */
const WINDOW_MS = 30;
const FRAME_MS = 20;
const TIME_POINTS = 720;

/**
 * A fixed, made-up spectral envelope: resonances plus a floor, drawn so the
 * comb has a speech-like shape. Display decoration only: nothing reads
 * this back, and it encodes nothing about AMBE.
 */
const RESONANCES = [
  { f: 480, bw: 190, gain: 1.0 },
  { f: 1480, bw: 260, gain: 0.62 },
  { f: 2520, bw: 340, gain: 0.34 },
  { f: 3420, bw: 400, gain: 0.17 },
];

/**
 * @param {number} hz
 * @returns {number} the illustrative envelope, just under 1 at its peak
 */
export function envelopeAt(hz) {
  let v = 0.035;
  for (const r of RESONANCES) {
    const d = (hz - r.f) / r.bw;
    v += r.gain / (1 + d * d);
  }
  return v / 1.09;
}

/** L, the harmonics under the cutoff. @param {number} f0 */
export const harmonicsFor = (f0) => Math.floor(CUTOFF_HZ / f0);

/**
 * Stable pseudo-random per-harmonic phases, so the summed waveform looks
 * like speech rather than a single impulse and does not jitter as the
 * pitch changes. Decoration: speech phases are not this, and AMBE does not
 * transmit phase at all.
 */
const PHASES = (() => {
  const out = new Float64Array(96);
  for (let k = 0; k < out.length; k += 1) {
    const h = Math.sin((k + 1) * 12.9898) * 43758.5453;
    out[k] = 2 * Math.PI * (h - Math.floor(h));
  }
  return out;
})();

/** @param {number} k */
const phaseFor = (k) => PHASES[k % PHASES.length];

/** The harmonics drawn in the time panel: every one below 4 kHz. @param {number} f0 */
const drawnHarmonics = (f0) => Math.floor((NYQUIST_HZ - 1) / f0);

/** Loudest the volume slider goes, as a gain on the normalised wave. */
const MAX_GAIN = 0.35;
/** Fade in and out over this, in seconds, so starting and stopping does not click. */
const FADE_S = 0.03;

/**
 * Plays the drawn sum: one oscillator whose wave holds harmonics 1 to
 * drawnHarmonics(f0), each with the envelope's amplitude and the figure's
 * phase. The browser normalises the wave's peak, so the volume slider alone
 * sets the loudness.
 * @param {HTMLButtonElement} button
 * @param {HTMLInputElement} volume
 */
function createCombSound(button, volume) {
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {OscillatorNode | null} */
  let osc = null;
  /** @type {GainNode | null} */
  let gain = null;
  let f0 = DEFAULT_PITCH_HZ;
  let builtFor = 0;
  let playing = false;

  const level = () => MAX_GAIN * (Number(volume.value) / 100) ** 2;

  /** @param {AudioContext} c */
  function wave(c) {
    const kMax = drawnHarmonics(f0);
    const real = new Float32Array(kMax + 1);
    const imag = new Float32Array(kMax + 1);
    // a sin(kwt + p) = a sin(p) cos(kwt) + a cos(p) sin(kwt)
    for (let k = 1; k <= kMax; k += 1) {
      const a = envelopeAt(k * f0);
      real[k] = a * Math.sin(phaseFor(k));
      imag[k] = a * Math.cos(phaseFor(k));
    }
    builtFor = kMax;
    return c.createPeriodicWave(real, imag);
  }

  function setLabel() {
    button.textContent = playing ? "Stop" : "Play";
    button.setAttribute("aria-pressed", String(playing));
  }

  function start() {
    ctx ??= new AudioContext();
    void ctx.resume();
    const now = ctx.currentTime;
    gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(level(), now, FADE_S);
    gain.connect(ctx.destination);
    osc = ctx.createOscillator();
    osc.setPeriodicWave(wave(ctx));
    osc.frequency.setValueAtTime(f0, now);
    osc.connect(gain);
    osc.start(now);
    playing = true;
    setLabel();
  }

  function stop() {
    if (ctx && osc && gain) {
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(0, now, FADE_S);
      osc.stop(now + FADE_S * 6);
    }
    osc = null;
    gain = null;
    playing = false;
    setLabel();
  }

  return {
    toggle() {
      if (playing) stop();
      else start();
    },
    /** Follow the pitch as it eases. @param {number} hz */
    pitch(hz) {
      f0 = hz;
      if (!ctx || !osc) return;
      osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.01);
      // More or fewer harmonics fit under 4 kHz: rebuild the wave.
      if (drawnHarmonics(hz) !== builtFor) osc.setPeriodicWave(wave(ctx));
    },
    volume() {
      if (ctx && gain) gain.gain.setTargetAtTime(level(), ctx.currentTime, FADE_S);
    },
    destroy() {
      stop();
      void ctx?.close();
      ctx = null;
    },
  };
}

/**
 * The comb panel's padding in CSS px for a frame `width` wide; the 3D
 * view's front preset fits the same left and right (anim-harmonics-3d.js).
 * @param {number} width
 */
export function plotPad(width) {
  const compact = width < 560;
  return { compact, left: compact ? 30 : 44, right: compact ? 12 : 16, top: compact ? 14 : 18 };
}

/* --- markup ------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Harmonic comb spacing under the 3.7 kHz cutoff</p>
  <span data-role="status-badge"></span>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 16 / 10">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="A harmonic comb from 0 to 4 kHz for the selected fundamental, above the waveform of those harmonics summed."></canvas>
</div>

<div class="harmonics-status" data-role="status">
  <span class="harmonics-status__text" data-role="status-text"></span>
</div>

<div class="anim-figure__step"></div>

<ul class="anim-legend">
  <li class="anim-legend__item" data-legend="2d"><i class="anim-legend__swatch is-data-1"></i>harmonic amplitudes: the L numbers that get transmitted</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line" style="background-color: var(--ambe-accent-warm)"></i>the harmonic you picked: on the comb and as its own wave, and in 3D as its ray on the floor</li>
  <li class="anim-legend__item" data-legend="3d" hidden><i class="anim-legend__swatch harmonics-swatch--highlight"></i>this fundamental (thick, outlined)</li>
  <li class="anim-legend__item" data-legend="3d" hidden><i class="anim-legend__swatch harmonics-swatch--ramp"></i>harmonic number, 1 (dark) to 61 (light); rays on the floor follow each one</li>
  <li class="anim-legend__item" data-legend="3d" hidden><i class="anim-legend__swatch anim-legend__swatch--line" style="color: var(--ambe-plot-ink)"></i>L for every fundamental (the staircase on the wall)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--dashed" style="color: var(--ambe-data-3)"></i>spectral envelope (illustrative shape)</li>
  <li class="anim-legend__item" data-legend="2d"><i class="anim-legend__swatch anim-legend__swatch--line is-data-2"></i>the harmonics added together</li>
  <li class="anim-legend__item anim-legend__item--ghost" data-role="ghost-key" hidden><i class="anim-legend__swatch anim-legend__swatch--ghost"></i><span data-role="ghost-key-text">the other voice, for comparison</span></li>
</ul>

<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Fundamental f₀</span>
    <input class="anim-range" type="range" min="${PITCH_MIN_HZ}" max="${PITCH_MAX_HZ}"
           step="1" value="${DEFAULT_PITCH_HZ}" data-role="pitch"
           aria-label="Fundamental frequency in hertz">
  </label>
  <output class="anim-readout anim-readout--wide" data-role="readout">120 Hz · L = 30</output>
  <label class="anim-field">
    <span class="anim-field__label">Harmonic</span>
    <input class="anim-range" type="range" min="1" max="${harmonicsFor(DEFAULT_PITCH_HZ)}"
           step="1" value="1" data-role="pick"
           aria-label="Harmonic number, where 1 is the fundamental">
  </label>
  <output class="anim-readout" data-role="pick-readout">f₀ = 120 Hz</output>
  <span class="harmonics-cutoff" data-role="cutoff">${CUTOFF_LABEL}</span>
  <div class="anim-controls__group" role="group" aria-label="Snap to a recorded voice"
       style="flex-wrap: wrap; max-width: 100%">
    <div class="anim-toggle-group" style="flex-wrap: wrap; max-width: 100%">
      <button class="anim-btn" type="button" data-voice="lr" aria-pressed="false">Male recording</button>
      <button class="anim-btn" type="button" data-voice="lj" aria-pressed="false">Female recording</button>
    </div>
  </div>
</div>
<div class="anim-controls">
  <button class="anim-btn anim-btn--play" type="button" data-kind="audio" data-role="play"
          aria-pressed="false">Play</button>
  <label class="anim-field" style="flex: 0 1 14rem">
    <span class="anim-field__label">Volume</span>
    <input class="anim-range" type="range" min="0" max="100" step="1" value="50"
           data-role="volume" aria-label="Volume">
  </label>
  <span class="anim-field__label">A steady tone built from this comb. It isn't codec output.</span>
</div>
<div class="anim-controls">
  <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
  <div class="anim-controls__group" data-role="camera" hidden>
    <span class="anim-field__label">Camera</span>
    <div class="anim-toggle-group" role="group" aria-label="Camera">
      <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
      <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
      <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
      <button class="anim-btn" type="button" data-preset="side" aria-pressed="false">Side</button>
    </div>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>

<div class="anim-compare" data-role="compare" hidden aria-live="polite">
  <div class="anim-compare__row" data-compare-row="lr">
    <span class="anim-compare__name">Male</span>
    <span class="anim-compare__f0" data-role="lr-f0"></span>
    <span class="anim-compare__l" data-role="lr-l"></span>
    <span class="anim-compare__bar"><i data-role="lr-bar"></i></span>
  </div>
  <div class="anim-compare__row" data-compare-row="lj">
    <span class="anim-compare__name">Female</span>
    <span class="anim-compare__f0" data-role="lj-f0"></span>
    <span class="anim-compare__l" data-role="lj-l"></span>
    <span class="anim-compare__bar"><i data-role="lj-bar"></i></span>
  </div>
  <p class="anim-compare__delta" data-role="delta"></p>
</div>

<figcaption class="anim-figure__caption">
  Drag the fundamental. The comb thins out as the pitch rises, and
  <strong>L</strong>, the count of harmonics under the cutoff at 3.7 kHz,
  falls with it. That count is how many spectral amplitudes the encoder has
  to fit into the same fixed budget of bits, so a deep voice and a high voice
  are not the same problem. Press <em>Male recording</em> or <em>Female
  recording</em>: the slider snaps to that voice's median pitch, and the
  other voice stays on the plot as a faint ghost comb, with the gap in
  amplitudes written under the controls. In 3D, depth is the fundamental
  from 60 to 400 Hz: the coloured rays on the floor follow each harmonic,
  and the staircase on the wall at the cutoff counts them.
  <span class="harmonics-badges">Envelope, comb and cutoff: <span data-badge="illustrative"></span>
  Snapped pitches: <span data-badge="derived"></span></span>
  <span class="anim-figure__source">L = ⌊α·π/ω₀⌋ with α = 0.925 (a 3700 Hz band):
  US 5,701,390 and US 5,754,974. Pitch search range 22 ≤ P &lt; 115 samples at 8 kHz:
  US 5,216,747. Snapped pitches: the
  <em>median</em> autocorrelation pitch over the confidently voiced frames
  (confidence at least 0.5) of each input recording, from
  assets/data/&lt;clip&gt;/frames.json. A median, not a single frame: the pitch
  track has octave errors at both ends, so no one frame is representative.
  The envelope shape is drawn for illustration and is not a measurement.</span>
</figcaption>
`;

/* --- module ------------------------------------------------------------- */

/** @typedef {"lr" | "lj"} Voice */
/** @typedef {{clip: string, f0: number, n: number}} VoiceStats */

/**
 * What the 3D part reads (it computes no model data of its own).
 * @typedef {Object} HarmonicsState
 * @property {number} pitch  drawn now (eases toward target)
 * @property {number} target  what the reader asked for
 * @property {number} harmonic  the harmonic picked, 1 (the fundamental) to L
 * @property {Voice | null} voice
 * @property {{lr: VoiceStats | null, lj: VoiceStats | null}} stats
 */

/** @type {Record<Voice, {clip: string, label: string}>} */
const VOICES = {
  lr: { clip: "lr-b", label: "male" },
  lj: { clip: "lj-b", label: "female" },
};
const VOICE_KEYS = /** @type {Voice[]} */ (["lr", "lj"]);

/** A frame's pitch counts only if the tracker was reasonably sure of it. */
const MIN_CONFIDENCE = 0.5;

/** @param {Voice} voice @returns {Voice} */
const otherVoice = (voice) => (voice === "lr" ? "lj" : "lr");

/**
 * Reduce a clip to its median confidently voiced pitch. The median rather
 * than the mean: the tracker's octave errors are wild outliers.
 * @param {{clip: {id: string}, frames: {derived: {orig_f0_hz: number, orig_f0_confidence: number}}[]}} data
 * @returns {VoiceStats | null}
 */
export function summarise(data) {
  const f0s = [];
  for (const fr of data.frames) {
    const d = fr.derived;
    if (!(d.orig_f0_hz > 0)) continue;
    if (!(d.orig_f0_confidence >= MIN_CONFIDENCE)) continue;
    f0s.push(d.orig_f0_hz);
  }
  if (f0s.length === 0) return null;
  f0s.sort((a, b) => a - b);
  const mid = f0s.length >> 1;
  const f0 = f0s.length % 2 === 0 ? (f0s[mid - 1] + f0s[mid]) / 2 : f0s[mid];
  return { clip: data.clip.id, f0, n: f0s.length };
}

/**
 * A harmonic as the figure names it: "f₀" for the first, "3f₀" after.
 * @param {number} k
 */
export const harmonicName = (k) => (k === 1 ? "f₀" : `${k}f₀`);

/**
 * Harmonic k at a pitch, in the hertz the readout prints: "3f₀ = 360 Hz".
 * @param {number} k @param {number} f0
 */
export const pickText = (k, f0) => {
  const v = k * f0;
  return `${harmonicName(k)} = ${v.toFixed(Math.abs(v - Math.round(v)) >= 0.05 ? 1 : 0)} Hz`;
};

/** @param {number} f0 */
// A snapped median keeps its tenth (132.2 Hz), so L = floor(3700 / f0)
// checks against the number printed beside it.
const pitchText = (f0) => `${f0.toFixed(f0 < 100 || Math.abs(f0 - Math.round(f0)) >= 0.05 ? 1 : 0)} Hz`;

/**
 * Mount the harmonics figure into its host.
 * @param {Element} host a `[data-anim="harmonics"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>} cleanup
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const root = document.createElement("figure");
  root.className = "anim-figure anim-figure--harmonics";
  root.innerHTML = FIGURE_HTML;
  host.append(root);
  markEnhanced(host);
  // The index page's host has no steps, so no empty step panel either.
  if (!steps.length) root.querySelector(".anim-figure__step")?.remove();

  const frame = $(root, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const range = $(root, '[data-role="pitch"]', HTMLInputElement);
  const pick = $(root, '[data-role="pick"]', HTMLInputElement);
  const pickReadout = $(root, '[data-role="pick-readout"]', HTMLOutputElement);
  const readout = $(root, '[data-role="readout"]', HTMLOutputElement);
  const statusBadge = $(root, '[data-role="status-badge"]', HTMLElement);
  const statusText = $(root, '[data-role="status-text"]', HTMLElement);
  const compare = $(root, '[data-role="compare"]', HTMLElement);
  const ghostKey = $(root, '[data-role="ghost-key"]', HTMLElement);
  const ghostKeyText = $(root, '[data-role="ghost-key-text"]', HTMLElement);
  const deltaEl = $(root, '[data-role="delta"]', HTMLElement);
  const toggle = $(root, '[data-view="3d"]', HTMLButtonElement);
  const cameraGroup = $(root, '[data-role="camera"]', HTMLElement);
  const hint = $(root, ".anim-figure__hint--webgl", HTMLElement);
  /** @param {string} selector */
  const all = (selector) => /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll(selector)));
  const voiceButtons = all("button[data-voice]");
  const presetButtons = all("button[data-preset]");
  $(root, '[data-role="cutoff"]', HTMLElement).append(" ", badge(CUTOFF_BADGE ?? "illustrative"));
  $(root, '[data-badge="illustrative"]', HTMLElement).append(badge("illustrative"));
  $(root, '[data-badge="derived"]', HTMLElement).append(badge("derived-input"));
  const reduced = prefersReducedMotion();
  const sound = createCombSound(
    $(root, '[data-role="play"]', HTMLButtonElement),
    $(root, '[data-role="volume"]', HTMLInputElement)
  );

  /** @type {HarmonicsState} */
  const state = {
    pitch: DEFAULT_PITCH_HZ,
    target: DEFAULT_PITCH_HZ,
    harmonic: 1,
    voice: null,
    stats: { lr: null, lj: null },
  };

  /** @type {import("./lib/view-switch.js").ViewSwitch | null} */
  let view = null;
  /** A step's preset, for the 3D view once it is up. @type {string | null} */
  let wantPreset = null;

  /** The voice being compared against, if its data is in hand. */
  const ghostStats = () => (state.voice ? state.stats[otherVoice(state.voice)] : null);

  const handle = setupCanvas(canvas, { onResize: () => render() });
  /**
   * The waveform strip under the 3D view, made the first time 3D is up,
   * so the figure holds one canvas until then.
   * @type {{canvas: HTMLCanvasElement, handle: import("./anim-core.js").CanvasHandle} | null}
   */
  let strip = null;

  /* -- geometry ---------------------------------------------------------- */

  function layout() {
    const W = handle.width;
    const H = handle.height;
    const { compact, left, right, top } = plotPad(W);
    const splitY = Math.round(H * 0.6);
    const spec = createPlot(
      { width: W, height: H },
      { xDomain: [0, NYQUIST_HZ], yDomain: [0, Y_MAX], padding: { top, right, bottom: H - splitY + 20, left } }
    );
    const wave = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, WINDOW_MS],
        yDomain: [-1.12, 1.12],
        padding: { top: splitY + (compact ? 16 : 22), right, bottom: compact ? 30 : 34, left },
      }
    );
    return { W, H, compact, spec, wave };
  }

  /* -- drawing ----------------------------------------------------------- */

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} th
   * @param {ReturnType<typeof layout>} geo
   */
  function drawSpectrum(ctx, th, geo) {
    const { spec, compact } = geo;
    const f0 = state.pitch;
    const coded = harmonicsFor(f0);

    // Region above the cutoff: present in the audio, never transmitted.
    ctx.save();
    ctx.fillStyle = th.hairline;
    const cutX = spec.x(CUTOFF_HZ);
    ctx.fillRect(cutX, spec.area.top, spec.area.right - cutX, spec.area.height);
    ctx.restore();

    drawGrid(ctx, spec, { xTicks: [1000, 2000, 3000], yTicks: [] });
    drawAxes(ctx, spec, {
      xTicks: [0, 1000, 2000, 3000, 4000],
      yTicks: [],
      formatX: (v) => (v === 0 ? "0" : `${v / 1000}k`),
      xLabel: compact ? "kHz" : "frequency (kHz)",
    });

    // Envelope: the illustrative shape the harmonics sample.
    const envPoints = [];
    for (let px = 0; px <= 160; px += 1) {
      const hz = (px / 160) * NYQUIST_HZ;
      envPoints.push({ x: hz, y: envelopeAt(hz) });
    }
    drawPolyline(ctx, envPoints, { plot: spec, color: th.series[2], width: 1.5, dash: [4, 4] });

    // The other voice, ghosted underneath and kept faint: a reference.
    const ghost = ghostStats();
    if (ghost) {
      ctx.save();
      spec.clip(ctx);
      const gBase = spec.y(0);
      ctx.strokeStyle = th.muted;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (let k = 1; k * ghost.f0 < NYQUIST_HZ; k += 1) {
        const hz = k * ghost.f0;
        const x = crisp(spec.x(hz), 1);
        ctx.beginPath();
        ctx.moveTo(x, gBase);
        ctx.lineTo(x, spec.y(envelopeAt(hz)));
        ctx.stroke();
      }
      ctx.restore();
    }

    // The comb.
    ctx.save();
    spec.clip(ctx);
    const baseY = spec.y(0);
    for (let k = 1; k * f0 < NYQUIST_HZ; k += 1) {
      const hz = k * f0;
      const inBand = hz < CUTOFF_HZ;
      const x = crisp(spec.x(hz), 2);
      const y = spec.y(envelopeAt(hz));
      ctx.strokeStyle = inBand ? th.series[0] : th.series[3];
      ctx.globalAlpha = inBand ? 1 : 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (f0 > 95 || k % 2 === 0 || !compact) {
        ctx.fillStyle = inBand ? th.series[0] : th.series[3];
        ctx.beginPath();
        ctx.arc(x, y, f0 > 140 ? 2.6 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // The harmonic the reader picked: thick, with its name above it.
    const pickHz = shownHarmonic() * f0;
    const px = spec.x(pickHz);
    const py = spec.y(envelopeAt(pickHz));
    ctx.save();
    ctx.strokeStyle = th.accentWarm;
    ctx.fillStyle = th.accentWarm;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px, baseY);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const pickLabel = pickText(shownHarmonic(), f0);
    const half = pickLabel.length * 3.3 + 6;
    drawLabel(ctx, pickLabel, Math.min(Math.max(px, spec.area.left + half), spec.area.right - half), py - 10, {
      align: "center",
      baseline: "bottom",
      size: 11,
      weight: 600,
      color: th.accentWarm,
      background: th.plotBg,
      padding: 3,
    });

    // The cut at the cutoff.
    ctx.save();
    ctx.strokeStyle = th.border;
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crisp(cutX), spec.area.top);
    ctx.lineTo(crisp(cutX), spec.area.bottom);
    ctx.stroke();
    ctx.restore();
    if (!compact) {
      drawLabel(ctx, CUTOFF_LABEL, cutX - 6, spec.area.bottom - 6, {
        align: "right",
        baseline: "bottom",
        size: 10,
        color: th.text3,
        background: th.plotBg,
        padding: 3,
      });
    }

    // Spacing bracket between the first two harmonics.
    if (f0 * 2 < NYQUIST_HZ) {
      const x1 = spec.x(f0);
      const x2 = spec.x(f0 * 2);
      const by = spec.area.bottom - 8;
      ctx.save();
      ctx.strokeStyle = th.series[0];
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(crisp(x1), by - 4);
      ctx.lineTo(crisp(x1), by);
      ctx.lineTo(crisp(x2), by);
      ctx.lineTo(crisp(x2), by - 4);
      ctx.stroke();
      ctx.restore();
      if (x2 - x1 > 34) {
        drawLabel(ctx, "f₀", (x1 + x2) / 2, by - 3, {
          align: "center",
          baseline: "bottom",
          size: 10,
          color: th.series[0],
          background: th.plotBg,
          padding: 2,
        });
      }
    }

    // The headline number, on a panel so it stays readable over a dense comb.
    const outOfRange = f0 < SEARCH_MIN_HZ || f0 > SEARCH_MAX_HZ;
    const ghostL = ghost ? harmonicsFor(ghost.f0) : null;
    const ghostDelta = ghostL === null ? 0 : coded - ghostL;
    const subLineY = compact ? 22 : 30;
    const ghostLineY = subLineY + (compact ? 14 : 16);
    const warnLineY = (ghostL === null ? subLineY : ghostLineY) + (compact ? 16 : 18);

    const hx = spec.area.left + 10;
    const hy = spec.area.top + (compact ? 6 : 10);
    const panelW = compact ? 168 : 236;
    const panelH = (compact ? 46 : 58) + (ghostL === null ? 0 : compact ? 14 : 16) + (outOfRange ? 16 : 0);
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = th.plotBg;
    ctx.beginPath();
    ctx.roundRect(hx - 8, hy - 6, panelW, panelH, 6);
    ctx.fill();
    ctx.restore();
    drawLabel(ctx, `L = ${coded}`, hx, hy, {
      align: "left",
      baseline: "top",
      size: compact ? 20 : 26,
      weight: 600,
      color: th.ink,
      mono: true,
    });
    drawLabel(ctx, compact ? "amplitudes to send" : "spectral amplitudes to transmit", hx, hy + subLineY, {
      align: "left",
      baseline: "top",
      size: 11,
      color: th.muted,
    });

    // The comparison, stated as a number rather than left to counting.
    if (ghostL !== null && state.voice) {
      const other = VOICES[otherVoice(state.voice)].label;
      const text =
        ghostDelta === 0
          ? `same as the ${other} voice`
          : `${Math.abs(ghostDelta)} ${ghostDelta > 0 ? "more" : "fewer"} than the ${other} voice`;
      drawLabel(ctx, text, hx, hy + ghostLineY, {
        align: "left",
        baseline: "top",
        size: 11,
        weight: 600,
        color: th.series[0],
      });
    }

    // Out-of-range warning: the coder's pitch search does not go here.
    if (outOfRange) {
      drawLabel(
        ctx,
        compact ? "outside the coder's pitch range" : "outside the coder's pitch search range (P = 22…115 samples)",
        hx,
        hy + warnLineY,
        { align: "left", baseline: "top", size: 10, color: th.accentWarm }
      );
    }
  }

  /**
   * The sum of the harmonics over 30 ms, in the bottom panel of the flat
   * view, or on its own canvas under the 3D view.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} th
   * @param {import("./anim-core.js").Plot} wave
   * @param {boolean} compact
   */
  function drawWaveform(ctx, th, wave, compact) {
    const f0 = state.pitch;

    // One 20 ms frame, shaded.
    ctx.save();
    ctx.fillStyle = th.hairline;
    const fx = wave.x(FRAME_MS);
    ctx.fillRect(wave.area.left, wave.area.top, fx - wave.area.left, wave.area.height);
    ctx.restore();

    drawGrid(ctx, wave, { xTicks: [5, 10, 15, 20, 25], yTicks: [0] });
    drawAxes(ctx, wave, {
      xTicks: [0, 5, 10, 15, 20, 25, 30],
      yTicks: [],
      formatX: (v) => String(v),
      xLabel: compact ? "ms" : "milliseconds",
    });

    // Sum of the harmonics: ordinary display maths, sin() and addition.
    const kMax = drawnHarmonics(f0);
    const amps = new Float64Array(kMax + 1);
    for (let k = 1; k <= kMax; k += 1) amps[k] = envelopeAt(k * f0);

    const points = new Array(TIME_POINTS + 1);
    let peak = 1e-9;
    for (let i = 0; i <= TIME_POINTS; i += 1) {
      const ms = (i / TIME_POINTS) * WINDOW_MS;
      const t = ms / 1000;
      let sum = 0;
      for (let k = 1; k <= kMax; k += 1) sum += amps[k] * Math.sin(2 * Math.PI * k * f0 * t + phaseFor(k));
      points[i] = { x: ms, y: sum };
      peak = Math.max(peak, Math.abs(sum));
    }
    const scale = 0.94 / peak;
    for (const p of points) p.y *= scale;

    ctx.save();
    wave.clip(ctx);
    drawPolyline(ctx, points, { plot: wave, color: th.series[1], width: 1.6 });
    // The picked harmonic on its own, at the size it has inside the sum.
    const k = shownHarmonic();
    const one = new Array(TIME_POINTS + 1);
    for (let i = 0; i <= TIME_POINTS; i += 1) {
      const ms = (i / TIME_POINTS) * WINDOW_MS;
      one[i] = { x: ms, y: scale * amps[k] * Math.sin(2 * Math.PI * k * f0 * (ms / 1000) + phaseFor(k)) };
    }
    drawPolyline(ctx, one, { plot: wave, color: th.accentWarm, width: 1.8 });
    ctx.restore();

    // One pitch period, bracketed.
    const periodMs = 1000 / f0;
    const startMs = 4;
    if (startMs + periodMs <= WINDOW_MS) {
      const x1 = wave.x(startMs);
      const x2 = wave.x(startMs + periodMs);
      const y = wave.area.top + 10;
      ctx.save();
      ctx.strokeStyle = th.series[1];
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(crisp(x1), wave.area.top);
      ctx.lineTo(crisp(x1), wave.area.bottom);
      ctx.moveTo(crisp(x2), wave.area.top);
      ctx.lineTo(crisp(x2), wave.area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, crisp(y));
      ctx.lineTo(x2, crisp(y));
      ctx.stroke();
      ctx.restore();
      if (x2 - x1 > 34) {
        const text = x2 - x1 > 78 ? `1 / f₀ = ${periodMs.toFixed(1)} ms` : `${periodMs.toFixed(1)} ms`;
        drawLabel(ctx, text, (x1 + x2) / 2, y, {
          align: "center",
          baseline: "middle",
          size: 10,
          color: th.series[1],
          background: th.plotBg,
          padding: 3,
        });
      }
    }

    if (!compact) {
      drawLabel(ctx, "one 20 ms frame", wave.area.left + 6, wave.area.bottom - 6, {
        align: "left",
        baseline: "bottom",
        size: 10,
        color: th.text4,
        background: th.plotBg,
        padding: 3,
      });
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} th
   * @param {ReturnType<typeof layout>} geo
   */
  function drawSourceChip(ctx, th, geo) {
    if (!state.voice) return;
    const s = state.stats[state.voice];
    if (!s) return;
    const { spec, compact } = geo;
    const x = spec.area.right - 8;
    const y = spec.area.top + 6;
    const line1 = compact ? `${s.clip} · median` : `${s.clip} · median of ${s.n} voiced frames`;
    drawLabel(ctx, line1, x, y, {
      align: "right",
      baseline: "top",
      size: 11,
      mono: true,
      color: th.text2,
      background: th.surface2,
      padding: 4,
    });
    if (!compact) {
      drawLabel(ctx, `f₀ ${s.f0.toFixed(1)} Hz, derived from the input recording`, x, y + 22, {
        align: "right",
        baseline: "top",
        size: 10,
        color: th.text4,
      });
    }
  }

  function render() {
    sound.pitch(state.pitch);
    // Hidden under the 3D view, the flat canvas has no size: it is drawn
    // again when it comes back (its resize calls render).
    if (!canvas.hidden && handle.width > 1) {
      const th = getTheme();
      const geo = layout();
      // Taller on a phone so both panels stay legible without page-level scroll.
      const aspect = geo.W < 480 ? "1 / 1.05" : geo.W < 620 ? "16 / 12" : "16 / 10";
      if (frame.style.getPropertyValue("--anim-aspect") !== aspect) frame.style.setProperty("--anim-aspect", aspect);
      clearCanvas(handle.ctx, handle, th.plotBg);
      drawSpectrum(handle.ctx, th, geo);
      drawWaveform(handle.ctx, th, geo.wave, geo.compact);
      drawSourceChip(handle.ctx, th, geo);
    }
    updateReadout();
    drawStrip();
    view?.update(snapshot());
    describe();
    if (TEST_HOOK) {
      // The comb panel's left and right as the frame's width sets them.
      const W = frame.clientWidth;
      const pad = plotPad(W);
      TEST_HOOK.figures[SLUG] = {
        pitch: state.pitch,
        L: harmonicsFor(state.pitch),
        harmonic: shownHarmonic(),
        plot: { left: pad.left, right: W - pad.right },
      };
    }
  }

  /** The waveform alone, under the 3D view. */
  function drawStrip() {
    if (!strip || strip.canvas.hidden) return;
    const stripHandle = strip.handle;
    const th = getTheme();
    const W = stripHandle.width;
    const H = stripHandle.height;
    const { compact, left, right } = plotPad(W);
    const wave = createPlot(
      { width: W, height: H },
      { xDomain: [0, WINDOW_MS], yDomain: [-1.12, 1.12], padding: { top: 8, right, bottom: compact ? 30 : 34, left } }
    );
    clearCanvas(stripHandle.ctx, stripHandle, th.plotBg);
    drawWaveform(stripHandle.ctx, th, wave, compact);
  }

  function updateReadout() {
    const L = harmonicsFor(state.pitch);
    const pText = pitchText(state.pitch);
    readout.textContent = `${pText} · L = ${L}`;
    pickReadout.textContent = pickText(shownHarmonic(), state.pitch);
    const voice = state.voice;
    const vStats = voice ? state.stats[voice] : null;
    // The slider's readout already announces each value; this line is
    // plain text, and its badge changes only with the voice.
    const kind = vStats ? "derived-input" : "illustrative";
    if (statusBadge.dataset.kind !== kind) {
      statusBadge.dataset.kind = kind;
      statusBadge.replaceChildren(badge(kind));
    }
    statusText.textContent = voice && vStats
      ? `This is the ${VOICES[voice].label} recording's typical pitch, ${pText}, the median of its ${vStats.n} clearly voiced frames. At that pitch, ${L} harmonics fit under the codec's 3.7 kHz cutoff.`
      : `At ${pText}, ${L} harmonics fit under the codec's 3.7 kHz cutoff. Each one needs its own amplitude, and they all share the frame's 48 voice bits with the pitch, voicing and gain.`;
  }

  /** The canvas label, rebuilt 250 ms after the last change. */
  let describeTimer = 0;
  function describe() {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      const L = harmonicsFor(state.pitch);
      canvas.setAttribute(
        "aria-label",
        `A harmonic comb from 0 to 4 kHz at a fundamental of ${pitchText(state.pitch)}: L = ${L} harmonics ` +
          `under the ${CUTOFF_LABEL}, ` +
          "above the waveform of those harmonics summed over 30 ms. " +
          `Harmonic ${shownHarmonic()}, ${pickText(shownHarmonic(), state.pitch)}, is drawn thick on the comb and as its own wave.`
      );
    }, 250);
  }

  /**
   * The harmonic drawn now: the one picked, unless the pitch is still
   * easing up past where it fits.
   */
  function shownHarmonic() {
    return Math.min(state.harmonic, harmonicsFor(state.pitch));
  }

  /**
   * The harmonic slider's top is L at the pitch asked for, and a harmonic
   * past it comes down to it.
   */
  function syncPick() {
    const L = harmonicsFor(state.target);
    if (pick.max !== String(L)) pick.max = String(L);
    if (state.harmonic > L) state.harmonic = L;
    if (pick.value !== String(state.harmonic)) pick.value = String(state.harmonic);
  }

  /** A copy of the state for the 3D part. @returns {HarmonicsState} */
  const snapshot = () => ({ ...state, stats: { ...state.stats } });

  /* -- pitch easing ------------------------------------------------------ */

  const loop = createLoop(
    ({ dt }) => {
      const diff = state.target - state.pitch;
      if (Math.abs(diff) < 0.05) {
        state.pitch = state.target;
        render();
        loop.stop();
        return;
      }
      state.pitch += diff * (1 - Math.exp(-Math.min(dt, 0.05) * 16));
      render();
    },
    { element: root, autoplay: false }
  );

  /**
   * @param {number} hz
   * @param {{immediate?: boolean}} [opts]
   */
  function setPitch(hz, { immediate = false } = {}) {
    state.target = Math.min(Math.max(hz, PITCH_MIN_HZ), PITCH_MAX_HZ);
    const v = String(Math.round(state.target));
    if (range.value !== v) range.value = v;
    syncPick();
    if (immediate || reduced) {
      state.pitch = state.target;
      render();
    } else {
      loop.start();
    }
  }

  /* -- recorded voices --------------------------------------------------- */

  function syncButtons() {
    for (const b of voiceButtons) b.setAttribute("aria-pressed", String(b.dataset.voice === state.voice));
  }

  /** The comparison, restated as text for readers who are not reading pixels. */
  function syncCompare() {
    const { lr, lj } = state.stats;
    const show = Boolean(state.voice && lr && lj);
    compare.hidden = !show;
    ghostKey.hidden = !show;
    if (!show || !state.voice || !lr || !lj) return;
    const maxL = Math.max(harmonicsFor(lr.f0), harmonicsFor(lj.f0));
    for (const key of VOICE_KEYS) {
      const s = key === "lr" ? lr : lj;
      const L = harmonicsFor(s.f0);
      compare.querySelector(`[data-compare-row="${key}"]`)?.classList.toggle("is-current", key === state.voice);
      $(compare, `[data-role="${key}-f0"]`, HTMLElement).textContent = `${s.f0.toFixed(0)} Hz`;
      $(compare, `[data-role="${key}-l"]`, HTMLElement).textContent = `L = ${L}`;
      // Relative to the larger, so the gap reads as a proportion.
      $(compare, `[data-role="${key}-bar"]`, HTMLElement).style.width = `${(L / maxL) * 100}%`;
    }
    ghostKeyText.textContent = `${VOICES[otherVoice(state.voice)].label} voice, ghosted for comparison`;
    const lrL = harmonicsFor(lr.f0);
    const ljL = harmonicsFor(lj.f0);
    const gap = Math.abs(lrL - ljL);
    deltaEl.textContent =
      gap === 0
        ? "Both voices land on the same number of amplitudes."
        : `Same nine bytes either way. The ${lrL < ljL ? "male" : "female"} voice needs ${gap} fewer amplitudes to describe.`;
  }

  /**
   * Both clips load the first time either button is pressed, because the
   * ghost comb needs the voice the reader did NOT pick. Every caller shares
   * the load in flight.
   * @type {Promise<void> | null}
   */
  let pending = null;
  function loadAll() {
    pending ??= Promise.all(
      VOICE_KEYS.map(async (key) => {
        if (state.stats[key]) return;
        state.stats[key] = summarise(await loadJSON(`assets/data/${VOICES[key].clip}/frames.json`));
      })
    ).then(() => {}).finally(() => {
      pending = null;
    });
    return pending;
  }

  /** @param {Voice} voice */
  async function chooseVoice(voice) {
    if (state.voice === voice) return;
    state.voice = voice;
    syncButtons();
    await loadAll();
    if (state.voice !== voice || signal.aborted) return;
    const s = state.stats[voice];
    if (!s) return;
    setPitch(s.f0);
    syncCompare();
    render();
  }

  function goFree() {
    if (!state.voice) return;
    state.voice = null;
    syncButtons();
    syncCompare();
    render();
  }

  /* -- the 3D view ------------------------------------------------------- */

  /** @param {string} name */
  const pressPreset = (name) => {
    for (const b of presetButtons) b.setAttribute("aria-pressed", String(b.dataset.preset === name));
  };
  view = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: snapshot,
    load: () => import("./anim-harmonics-3d.js"),
    onView: (v) => {
      const in3D = v === "3d";
      cameraGroup.hidden = !in3D;
      if (in3D && !strip) {
        const node = document.createElement("canvas");
        node.className = "harmonics-strip";
        node.setAttribute("role", "img");
        node.setAttribute("aria-label", "The harmonics of the selected fundamental summed over 30 milliseconds.");
        frame.after(node);
        strip = { canvas: node, handle: setupCanvas(node, { onResize: () => drawStrip() }) };
      }
      if (strip) strip.canvas.hidden = !in3D;
      for (const item of all('[data-legend="3d"]')) item.hidden = !in3D;
      for (const item of all('[data-legend="2d"]')) item.hidden = in3D;
      if (!in3D) pressPreset("corner");
      else if (wantPreset && view?.preset(wantPreset)) pressPreset(wantPreset);
      wantPreset = null;
      render();
    },
  });
  // verify-site holds every 3D figure's 2D module to the shared hint text.
  void NO_WEBGL_HINT;

  /* -- events ------------------------------------------------------------ */

  range.addEventListener("input", () => {
    goFree();
    setPitch(Number(range.value), { immediate: true });
  }, { signal });
  $(root, '[data-role="play"]', HTMLButtonElement).addEventListener("click", () => sound.toggle(), { signal });
  $(root, '[data-role="volume"]', HTMLInputElement).addEventListener("input", () => sound.volume(), { signal });
  pick.addEventListener("input", () => {
    state.harmonic = Number(pick.value);
    render();
  }, { signal });
  for (const b of voiceButtons) {
    b.addEventListener("click", () => {
      const voice = /** @type {Voice} */ (b.dataset.voice);
      chooseVoice(voice).catch((error) => {
        console.error(`anim-${SLUG}: could not load the recorded pitches`, error);
        state.voice = null;
        syncButtons();
      });
    }, { signal });
  }
  for (const b of presetButtons) {
    b.addEventListener("click", () => {
      const name = b.dataset.preset ?? "corner";
      if (view?.preset(name)) pressPreset(name);
    }, { signal });
  }
  const unsubscribeTheme = onThemeChange(() => render());

  /**
   * A step's state: f0 (Hz), view (2d/3d), preset.
   * @param {Record<string, string>} s
   */
  const applyStep = (s) => {
    if (s.f0) {
      goFree();
      setPitch(Number(s.f0));
    }
    if (!view) return;
    if (s.view === "2d") view.show2D();
    if (s.view === "3d") void view.show3D();
    if (s.preset) {
      if (view.preset(s.preset)) pressPreset(s.preset);
      else wantPreset = s.preset;
    }
  };

  syncButtons();
  syncCompare();
  render();
  if (steps.length) createStepper(root, steps, applyStep, { signal });

  return () => {
    unsubscribeTheme();
    clearTimeout(describeTimer);
    loop.destroy();
    sound.destroy();
    handle.destroy();
    strip?.handle.destroy();
  };
}
