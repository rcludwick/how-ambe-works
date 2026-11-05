// @ts-check
/* ===========================================================================
 * anim-harmonic-sum.js: one frame's harmonics, added back up (ch11).
 * ---------------------------------------------------------------------------
 * The frame gives a decoder a fundamental and one amplitude per harmonic,
 * and no phase. This figure takes one frame of the input audio, reads f0
 * and the harmonic amplitudes A_k from the precomputed JSON, and sums
 * A_k cos(2πk·f0·t + φ_k) with the phases set to zero, to a seeded random
 * draw, or to that draw scaled by alpha (the form of US 5,081,681's
 * jitter, with alpha chosen by the reader). Two readouts come from a DFT of
 * the drawn period (lib/harmonics.js): the largest amplitude change against
 * zero phase, and the peak-to-RMS ratio.
 *
 * Views (owner decision O1, lib/view-switch.js):
 *   - 3D (anim-harmonic-sum-3d.js): one curtain per harmonic, depth =
 *     harmonic number, the sum in front. It opens when opensIn3D() and the
 *     frame is near, and plays "the sum accumulates" once.
 *   - Flat: the amplitudes as stems above two periods of the sum. The
 *     reduced-motion and no-WebGL path; its Front preset in 3D puts the sum
 *     on this view's lower panel.
 *   - Play: the steps in order as one walk-through, each step's text as a
 *     caption a sentence at a time, with the camera moves and the step's
 *     motion (the harmonics added one at a time, the phases drifting, the
 *     side view while the phases flip). Pause, the step slider, or any
 *     other control hands the figure back. Under reduced motion it steps
 *     through the end states.
 *
 * Generic display DSP on one frame's values (anim-core.js header). Nothing
 * here reads hex, makes sound from numbers, or walks frames. The only audio
 * is the chip's own decoded WAV, played as it is.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  TEST_HOOK,
  clearCanvas,
  createAudioPlayer,
  createPlot,
  drawAxes,
  drawLabel,
  drawPolyline,
  getTheme,
  loadJSON,
  loadPCM,
  markEnhanced,
  onThemeChange,
  prefersReducedMotion,
  setupCanvas,
  ticks,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { createViewSwitch } from "./lib/view-switch.js";
import { CUTOFF_BADGE, CUTOFF_HZ, CUTOFF_LABEL } from "./lib/cutoff.js";
import { topSteadyPitched } from "./lib/picks.js";
import {
  PERIOD_SAMPLES,
  crestOffset,
  harmonicAmplitudes,
  harmonicCount,
  harmonicMagnitudes,
  largestChangeDb,
  peakToRms,
  phases,
  samplePeriod,
  scaledPhases,
} from "./lib/harmonics.js";

// verify-site's 3D check reads the hint's name here: NO_WEBGL_HINT comes
// through lib/view-switch.js, which shows it.

const SLUG = "harmonic-sum";
const STEP_KEYS = /** @type {const} */ (["n", "phase", "alpha", "view", "preset"]);

/** @type {Readonly<Record<string, string>>} */
const CLIP_NAMES = Object.freeze({
  "lj-b": "CQ, female",
  "lr-a": "Quick brown fox, male",
  "lr-d": "A year ago, male",
});

/** The flat view's sum panel runs from -SUM_RANGE to SUM_RANGE of the zero-phase peak. */
export const SUM_RANGE = 1.05;
const SUM_POINTS = 2 * PERIOD_SAMPLES; // two periods, one point per period sample

/** Reading pace of a caption sentence: per word, plus a pause, with a floor, in ms. */
const MS_PER_WORD = 200;
const SENTENCE_PAUSE_MS = 500;
const MIN_SENTENCE_MS = 1500;
/** @param {string} line */
const readingMs = (line) => Math.max(MIN_SENTENCE_MS, line.split(" ").length * MS_PER_WORD + SENTENCE_PAUSE_MS);

/** @typedef {"zero" | "random" | "scaled"} PhaseMode */
/** @typedef {"corner" | "front" | "side"} Preset */

/**
 * @typedef {Object} ClipData
 * @property {string} id
 * @property {FrameRecord[]} frames
 * @property {number[][]} spectra  spectra.json original, one row per frame
 * @property {number} delayMs      decoded_delay_ms (derived)
 * @property {FrameRecord[]} picks topSteadyPitched(frames, 4)
 * @property {Float32Array | null} pcm  the input WAV, once loaded
 */

/**
 * @typedef {Object} FrameModel
 * @property {number} i
 * @property {number} f0
 * @property {number} L
 * @property {Float64Array} A     index 0 unused
 * @property {number} maxA
 * @property {number} sumA
 */

/**
 * What the 3D part offers the steps and the walk-through, once it is up.
 * @typedef {Object} HsumView
 * @property {() => void} finish  every running track to its end
 * @property {() => Promise<void>} idle  resolves when no track runs
 * @property {() => Promise<void>} pulse
 * @property {(name: string) => Promise<void>} go  fly to a preset
 * @property {(slow: boolean) => Promise<void>} introduce  start at Front and
 *           turn to the preset while the harmonics accumulate (the first
 *           view's animation; slow in the walk-through)
 * @property {(k: number, slow: boolean) => Promise<void>} accumulate
 * @property {(to: Float64Array, ms: number) => Promise<void>} drift
 * @property {(name: string, ms: number) => Promise<void>} turn  a slow camera move
 */

/**
 * @typedef {Object} HsumLink
 * @property {HsumView | null} view  set by the 3D part while it is up
 * @property {(k: number) => void} onCount  the harmonic a build is adding
 *           now; the readout follows it until k reaches the step's count
 * @property {() => void} introduced  the first view's animation has ended
 */

/**
 * The state the 3D part draws (lib/view-switch.js passes it on).
 * @typedef {Object} HsumScene
 * @property {FrameModel} model
 * @property {number} n
 * @property {Float64Array} phi  the phases asked for
 * @property {PhaseMode} mode
 * @property {number} alpha
 * @property {number} peakToRms
 * @property {Preset} preset
 * @property {"none" | "auto" | "slow"} motion  how the 3D part gets there
 * @property {boolean} build  a step to every harmonic: add them one at a time
 * @property {HsumLink} link
 */

/**
 * The flat view's sum panel (createPlot's area), in CSS px of a frame
 * W x H. The 3D Front preset puts the sum on it.
 * @param {number} W
 * @param {number} H
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function sumArea(W, H) {
  const split = Math.round(H * 0.4);
  const left = W < 480 ? 30 : 40;
  const top = split + 22;
  return { x: left, y: top, width: Math.max(1, W - left - 14), height: Math.max(1, H - top - 34) };
}

/**
 * @param {ClipData} clip
 * @param {FrameRecord} frame
 * @returns {FrameModel}
 */
function frameModel(clip, frame) {
  const f0 = frame.derived.orig_f0_hz;
  const L = harmonicCount(f0, CUTOFF_HZ);
  const A = harmonicAmplitudes(clip.spectra[frame.i], f0, L);
  let maxA = 0;
  let sumA = 0;
  for (let k = 1; k <= L; k += 1) {
    maxA = Math.max(maxA, A[k]);
    sumA += A[k];
  }
  return { i: frame.i, f0, L, A, maxA: maxA || 1, sumA: sumA || 1 };
}

/**
 * A step's text, a sentence at a time, for the walk-through's captions.
 * @param {string} text
 * @returns {string[]}
 */
export function sentences(text) {
  return text.replace(/\s+/g, " ").replace(/ ([.,;:])/g, "$1").trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {Element} host
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const clipIds = (host.getAttribute("data-clips") || "lj-b")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id in CLIP_NAMES);
  if (!clipIds.length) clipIds.push("lj-b");
  const reduced = prefersReducedMotion();

  /* ---- markup ---------------------------------------------------------- */

  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-hsum";
  // The flat view until 3D opens; the legend shows the items for this view.
  figure.dataset.view = "2d";
  figure.innerHTML = `
    <div class="anim-figure__head">
      <p class="anim-figure__title">Waveform synthesis by summing harmonic cosines</p>
      <p class="anim-figure__subtitle">A fundamental and one amplitude per harmonic, summed with phases the frame does not carry</p>
    </div>
    <div class="anim-figure__frame anim-hsum__frame" data-state="loading">
      <canvas class="anim-figure__canvas" role="img" data-ref="flat" aria-label="Loading the harmonics of one frame"></canvas>
    </div>
    <div class="anim-hsum__play" data-ref="play-row" hidden>
      <button class="anim-btn anim-hsum__play-button" type="button" data-ref="play" aria-pressed="false">Play</button>
      <label class="anim-field anim-hsum__scrub">
        <span class="anim-field__label">Step</span>
        <input class="anim-range" data-ref="scrub" type="range" min="1" max="1" step="1" value="1">
      </label>
      <output class="anim-readout" data-ref="scrub-out">1 of 1</output>
    </div>
    <p class="anim-hsum__caption" data-ref="caption" aria-hidden="true" hidden></p>
    <div class="anim-hsum__readouts">
      <output class="anim-readout anim-readout--wide" aria-live="polite" data-ref="readout"></output>
      <p class="anim-hsum__notes"><span>phase: illustrative, not transmitted</span>
        <span class="anim-hsum__cutoff"><span data-ref="cutoff"></span></span></p>
    </div>
    <div class="anim-hsum__input">
      <p class="anim-hsum__input-title">The input around this frame</p>
      <div class="anim-figure__frame anim-hsum__input-frame">
        <canvas class="anim-figure__canvas" role="img" data-ref="input" aria-label="The input audio around this frame"></canvas>
      </div>
    </div>
    <div class="anim-figure__step"></div>
    <ul class="anim-legend">
      <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch is-data-1"></i>one harmonic</li>
      <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch anim-hsum__swatch--ink"></i>the newest harmonic, and the sum</li>
      <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-hsum__swatch--ramp"></i>one harmonic, coloured by its number</li>
      <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-hsum__swatch--highlight"></i>newest harmonic (outlined)</li>
      <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-hsum__swatch--ink"></i>the sum (thick, front)</li>
      <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-hsum__swatch--dash"></i>each harmonic's crest nearest t = 0 (dashed)</li>
      <li class="anim-legend__item" data-for="both"><i class="anim-legend__swatch anim-legend__swatch--line anim-hsum__swatch--muted"></i>the sum with every phase zero (dashed)</li>
    </ul>
    <div class="anim-controls">
      <label class="anim-field">
        <span class="anim-field__label">Harmonics</span>
        <input class="anim-range" type="range" min="1" max="1" step="1" value="1" data-ref="n">
      </label>
      <fieldset class="anim-hsum__group">
        <legend class="anim-field__label">Phase</legend>
        <label class="anim-hsum__radio"><input type="radio" name="phase" value="zero" checked> All zero</label>
        <label class="anim-hsum__radio"><input type="radio" name="phase" value="random"> Random</label>
        <label class="anim-hsum__radio"><input type="radio" name="phase" value="scaled"> Scaled</label>
        <button class="anim-btn" type="button" data-ref="reroll" disabled>Re-roll</button>
      </fieldset>
    </div>
    <div class="anim-controls anim-hsum__scaled" data-ref="scaled" hidden>
      <label class="anim-field">
        <span class="anim-field__label">alpha</span>
        <input class="anim-range" type="range" min="0" max="1" step="0.05" value="0.5" data-ref="alpha">
        <output class="anim-readout" data-ref="alpha-out">0.50</output>
      </label>
      <p class="anim-hsum__note" data-ref="scaled-note">Each random phase times alpha: 0 is every
        phase zero, 1 is Random. US 5,081,681 writes the jitter as alpha times a
        uniform draw on [−π, π], with alpha set by voicing; here you set it.</p>
    </div>
    <div class="anim-controls anim-hsum__row">
      <label class="anim-field">
        <span class="anim-field__label">Recording</span>
        <select class="anim-hsum__select" data-ref="clip"></select>
      </label>
      <label class="anim-field">
        <span class="anim-field__label">Frame</span>
        <select class="anim-hsum__select" data-ref="frame"></select>
      </label>
    </div>
    <div class="anim-controls anim-hsum__row">
      <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
      <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
        <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
        <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
        <button class="anim-btn" type="button" data-preset="side" aria-pressed="false">Side</button>
      </div>
      <span class="anim-hsum__player" data-measured="decoded-audio">
        <button class="anim-btn anim-btn--play" type="button" data-kind="audio" aria-pressed="false">Hear the hardware around this frame</button>
      </span>
    </div>
    <p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
    <figcaption class="anim-figure__caption">One 20 ms frame of a vowel from the
      input audio, rebuilt from a fundamental and one amplitude per harmonic.
      Amplitudes are read from the input audio's spectrum at 31.25 Hz
      resolution, not from the codec. Phases are chosen here for
      illustration: an MBE frame carries none (US 5,701,390). The player
      plays 300 ms of the chip's decoded output around the frame.</figcaption>`;

  const fallback = host.querySelector(":scope > .anim-fallback");
  if (fallback) fallback.after(figure);
  else host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-hsum__frame", HTMLElement);
  const flatCanvas = $(figure, '[data-ref="flat"]', HTMLCanvasElement);
  const inputCanvas = $(figure, '[data-ref="input"]', HTMLCanvasElement);
  const readout = $(figure, '[data-ref="readout"]', HTMLOutputElement);
  const cutoffText = $(figure, '[data-ref="cutoff"]', HTMLElement);
  const nInput = $(figure, '[data-ref="n"]', HTMLInputElement);
  const reroll = $(figure, '[data-ref="reroll"]', HTMLButtonElement);
  const scaledRow = $(figure, '[data-ref="scaled"]', HTMLElement);
  const alphaInput = $(figure, '[data-ref="alpha"]', HTMLInputElement);
  const alphaOut = $(figure, '[data-ref="alpha-out"]', HTMLOutputElement);
  const scaledNote = $(figure, '[data-ref="scaled-note"]', HTMLElement);
  const clipSelect = $(figure, '[data-ref="clip"]', HTMLSelectElement);
  const frameSelect = $(figure, '[data-ref="frame"]', HTMLSelectElement);
  const cameraGroup = $(figure, '[data-ref="camera"]', HTMLElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const playerSpan = $(figure, ".anim-hsum__player", HTMLElement);
  const playButton = $(playerSpan, "button", HTMLButtonElement);
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  const view3d = $(figure, '[data-view="3d"]', HTMLButtonElement);
  const inputTitle = $(figure, ".anim-hsum__input-title", HTMLElement);
  const playRow = $(figure, '[data-ref="play-row"]', HTMLElement);
  const walkButton = $(figure, '[data-ref="play"]', HTMLButtonElement);
  const scrub = $(figure, '[data-ref="scrub"]', HTMLInputElement);
  const scrubOut = $(figure, '[data-ref="scrub-out"]', HTMLOutputElement);
  const captionLine = $(figure, '[data-ref="caption"]', HTMLElement);

  cutoffText.textContent = CUTOFF_LABEL;
  if (CUTOFF_BADGE) cutoffText.after(" ", badge(CUTOFF_BADGE));
  inputTitle.append(" ", badge("input"));
  playerSpan.append(" ", badge("measured"));
  scaledNote.append(" ", badge("illustrative"));
  caption.append(" ", badge("derived-input"), " ", badge("input"), " ", badge("illustrative"));
  for (const id of clipIds) clipSelect.add(new Option(CLIP_NAMES[id], id));

  /* ---- data ------------------------------------------------------------ */

  /** @type {Map<string, ClipData>} */
  const clips = new Map();
  /**
   * @param {string} id
   * @returns {Promise<ClipData>}
   */
  const loadClip = async (id) => {
    const known = clips.get(id);
    if (known) return known;
    const [framesFile, spectraFile] = await Promise.all([
      /** @type {Promise<{clip: {decoded_delay_ms: number}, frames: FrameRecord[]}>} */
      (loadJSON(`assets/data/${id}/frames.json`, { signal })),
      /** @type {Promise<{original: number[][]}>} */ (loadJSON(`assets/data/${id}/spectra.json`, { signal })),
    ]);
    const frames = framesFile.frames;
    /** @type {ClipData} */
    const data = {
      id,
      frames,
      spectra: spectraFile.original,
      delayMs: framesFile.clip.decoded_delay_ms,
      picks: topSteadyPitched(frames, 4),
      pcm: null,
    };
    clips.set(id, data);
    return data;
  };

  /* ---- state ----------------------------------------------------------- */

  const state = {
    clip: clipIds[0],
    rank: 0,
    n: 1,
    /** n follows L when the frame changes */
    nAll: false,
    /** @type {PhaseMode} */
    phase: "zero",
    alpha: 0.5,
    reroll: 0,
    /** @type {Preset} */
    preset: "corner",
  };

  let clip = await loadClip(state.clip);
  if (signal.aborted) return () => {};
  let model = frameModel(clip, clip.picks[0]);

  /** @param {PhaseMode} mode */
  const phasesFor = (mode) => (mode === "scaled"
    ? scaledPhases(model.L, state.alpha, state.reroll)
    : phases(model.L, mode, state.reroll));
  const targetPhi = () => phasesFor(state.phase);

  /** Set while a step to every harmonic passes its state on: 3D adds them one at a time. */
  let buildNext = false;
  /** Times the Next button was pulsed after the first view (the test hook reads it). */
  let nudges = 0;
  /** @type {HsumLink} */
  const link = {
    view: null,
    onCount: (k) => {
      const busy = k < state.n;
      if (busy) readout.setAttribute("aria-busy", "true");
      else readout.removeAttribute("aria-busy");
      updateReadout(busy ? k : state.n);
      nInput.value = String(busy ? k : state.n);
    },
    introduced: () => {
      // The reader is still on step 1: point at Next, which adds the rest.
      if (playing || stepIndex !== 0 || reduced) return;
      nudges += 1;
      figure.classList.remove("anim-hsum--nudge");
      void figure.offsetWidth;
      figure.classList.add("anim-hsum--nudge");
      window.setTimeout(() => figure.classList.remove("anim-hsum--nudge"), 2400);
    },
  };

  /* ---- readouts -------------------------------------------------------- */

  /** @type {{change: number, peakToRms: number}} */
  let numbers = { change: 0, peakToRms: 0 };
  /**
   * The readout for N harmonics: the step's count, or, while a build adds
   * them one at a time, the one it has reached (numbers keeps the step's).
   * @param {number} [N]
   */
  const updateReadout = (N = state.n) => {
    const zero = samplePeriod(model.A, phases(model.L, "zero", 0), N);
    const now = state.phase === "zero" ? zero : samplePeriod(model.A, targetPhi(), N);
    const measured = {
      change: largestChangeDb(harmonicMagnitudes(zero, N), harmonicMagnitudes(now, N), N),
      peakToRms: peakToRms(now),
    };
    if (N === state.n) numbers = measured;
    // One span per segment, each kept whole, so a line breaks only between
    // segments and never inside "peak-to-RMS".
    const parts = [
      `${N} of ${model.L} harmonics`,
      `f0 ${model.f0.toFixed(1)} Hz (input)`,
      `largest amplitude change ${measured.change.toFixed(1)} dB`,
      `peak-to-RMS ${measured.peakToRms.toFixed(2)}`,
    ];
    readout.replaceChildren(...parts.flatMap((text, j) => {
      const span = document.createElement("span");
      span.className = "anim-hsum__segment";
      span.textContent = text;
      return j ? [" · ", span] : [span];
    }));
  };

  /* ---- the view switch ------------------------------------------------- */

  /**
   * The state for the 3D part.
   * @param {"none" | "auto" | "slow"} motion
   * @returns {HsumScene}
   */
  const scene = (motion) => ({
    model, n: state.n, phi: targetPhi(), mode: state.phase, alpha: state.alpha,
    peakToRms: numbers.peakToRms, preset: state.preset, motion: reduced ? "none" : motion, build: buildNext, link,
  });

  /** @param {Preset | null} name */
  const pressPreset = (name) => {
    for (const button of cameraGroup.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.preset === name));
    }
  };
  /** The reader has dragged the camera off the preset it was sent to. */
  let dragged = false;

  const sw = createViewSwitch({
    frame,
    flat: flatCanvas,
    toggle: view3d,
    hint,
    signal,
    state: () => scene("none"),
    load: () => import("./anim-harmonic-sum-3d.js"),
    id: SLUG,
    onDrag: () => {
      dragged = true;
      pressPreset(null);
    },
    onView: (v) => {
      figure.dataset.view = v === "3d" ? "3d" : "2d";
      cameraGroup.hidden = v !== "3d";
      if (v === "3d") {
        dragged = false;
        pressPreset(state.preset);
      } else {
        if (v === "2d") link.view = null;
        flat.sync();
        drawFlat();
      }
      describe();
    },
  });
  const in3d = () => sw.view() === "3d";

  /* ---- describe (aria-label), debounced -------------------------------- */

  let describeTimer = 0;
  const description = () => {
    const where = state.phase === "zero"
      ? "Phases all zero: the crests line up at the centre."
      : state.phase === "random" ? "Phases random: the crests are scattered."
        : `Phases scaled by alpha ${state.alpha.toFixed(2)}: the crests spread from the centre.`;
    return `Stems for ${state.n} of ${model.L} harmonic amplitudes of one frame at f0 ${model.f0.toFixed(1)} Hz, ` +
      `above two periods of their sum. ${where} Peak-to-RMS ${numbers.peakToRms.toFixed(2)}.`;
  };
  const describe = () => {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      flatCanvas.setAttribute("aria-label", description());
      const start = Math.max(0, model.i - 1) * 0.02;
      inputCanvas.setAttribute("aria-label",
        `The input audio from ${start.toFixed(2)} s, three frames, with frame ${model.i} at ${(model.i * 0.02).toFixed(2)} s drawn brighter.`);
    }, 250);
  };

  /* ---- the flat view --------------------------------------------------- */

  /** @type {{stems: DOMRect, wave: DOMRect, sum: {x: number, y: number, width: number, height: number}}} */
  let layout = { stems: new DOMRect(), wave: new DOMRect(), sum: { x: 0, y: 0, width: 0, height: 0 } };

  const flat = setupCanvas(flatCanvas, { onResize: () => drawFlat() });
  const input = setupCanvas(inputCanvas, { onResize: () => drawInput() });

  function drawFlat() {
    if (flatCanvas.hidden) return;
    const theme = getTheme();
    const { ctx, width: W, height: H } = flat;
    clearCanvas(ctx, flat, theme.plotBg);
    const split = Math.round(H * 0.4);
    const area = sumArea(W, H);
    layout = { stems: new DOMRect(0, 0, W, split), wave: new DOMRect(0, split, W, H - split), sum: area };
    const font = W < 480 ? 10 : 11;
    const left = area.x;

    // Amplitudes. Nothing in this panel depends on the phases.
    const top = createPlot(flat, {
      xDomain: [0, 4000],
      yDomain: [0, model.maxA * 1.12],
      padding: { top: 24, right: 14, bottom: H - split + 20, left },
    });
    drawLabel(ctx, "Amplitude of each harmonic", top.area.left, 14,
      { color: theme.text3, size: font, baseline: "middle" });
    drawAxes(ctx, top, {
      xTicks: [0, 1000, 2000, 3000, 4000],
      yTicks: [],
      formatX: (v) => (v === 4000 ? "4 kHz" : String(v / 1000)),
      fontSize: font,
    });
    const cx = top.x(CUTOFF_HZ);
    ctx.save();
    ctx.strokeStyle = theme.muted;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, top.area.top);
    ctx.lineTo(Math.round(cx) + 0.5, top.area.bottom);
    ctx.stroke();
    ctx.restore();
    drawLabel(ctx, "3.7 kHz", cx - 4, top.area.top + 2,
      { color: theme.muted, size: font, align: "right", baseline: "top" });
    for (let k = 1; k <= state.n; k += 1) {
      const colour = k === state.n ? theme.ink : theme.series[0];
      const x = top.x(k * model.f0);
      drawPolyline(ctx, [[x, top.y(0)], [x, top.y(model.A[k])]], { color: colour, width: 1.5 });
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, top.y(model.A[k]), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // The sum over two periods, on the same fixed scale as the 3D view.
    const T0 = 1000 / model.f0;
    const bottom = createPlot(flat, {
      xDomain: [-T0, T0],
      yDomain: [-SUM_RANGE, SUM_RANGE],
      padding: { top: area.y, right: 14, bottom: 34, left },
    });
    drawLabel(ctx, "Their sum, two periods", bottom.area.left, split + 12,
      { color: theme.text3, size: font, baseline: "middle" });
    const msTicks = ticks([-T0, T0], 4);
    drawAxes(ctx, bottom, {
      xTicks: msTicks,
      yTicks: [],
      formatX: (v) => (Math.abs(v) < 1e-9 ? "0" : String(Math.round(v * 10) / 10)),
      xLabel: "time (ms)",
      fontSize: font,
    });
    ctx.save();
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(bottom.area.left, Math.round(bottom.y(0)) + 0.5);
    ctx.lineTo(bottom.area.right, Math.round(bottom.y(0)) + 0.5);
    ctx.moveTo(Math.round(bottom.x(0)) + 0.5, bottom.area.top);
    ctx.lineTo(Math.round(bottom.x(0)) + 0.5, bottom.area.bottom);
    ctx.stroke();
    ctx.restore();
    /** @param {Float64Array} period */
    const curve = (period) => {
      /** @type {[number, number][]} */
      const points = [];
      for (let j = 0; j <= SUM_POINTS; j += 1) {
        const t = -T0 + (2 * T0 * j) / SUM_POINTS;
        points.push([bottom.x(t), bottom.y(period[j % PERIOD_SAMPLES] / model.sumA)]);
      }
      return points;
    };
    if (state.phase !== "zero") {
      drawPolyline(ctx, curve(samplePeriod(model.A, phases(model.L, "zero", 0), state.n)),
        { color: theme.muted, width: 1.25, dash: [4, 3] });
    }
    drawPolyline(ctx, curve(samplePeriod(model.A, targetPhi(), state.n)), { color: theme.ink, width: 1.75 });
  }

  /** The 160 input samples of the frame, for the hook. */
  let inputSamples = new Float32Array(0);

  function drawInput() {
    const theme = getTheme();
    const { ctx } = input;
    clearCanvas(ctx, input, theme.plotBg);
    const pcm = clip.pcm;
    if (!pcm) return;
    const first = model.i * 160;
    inputSamples = pcm.slice(first, first + 160);
    let peak = 1e-6;
    for (let j = first - 160; j < first + 320; j += 1) peak = Math.max(peak, Math.abs(pcm[j] ?? 0));
    const plot = createPlot(input, {
      xDomain: [-160, 320],
      yDomain: [-peak * 1.1, peak * 1.1],
      padding: { top: 18, right: 8, bottom: 4, left: 8 },
    });
    ctx.save();
    ctx.fillStyle = theme.css("--ambe-accent-soft");
    ctx.fillRect(plot.x(0), plot.area.top, plot.x(160) - plot.x(0), plot.area.height);
    ctx.restore();
    /**
     * @param {number} from
     * @param {number} to
     * @param {string} colour
     */
    const run = (from, to, colour) => {
      /** @type {[number, number][]} */
      const points = [];
      for (let j = from; j <= to; j += 1) points.push([plot.x(j), plot.y(pcm[first + j] ?? 0)]);
      drawPolyline(ctx, points, { color: colour, width: 1.25 });
    };
    run(-160, 0, theme.muted);
    run(159, 319, theme.muted);
    run(0, 159, theme.ink);
    drawLabel(ctx, "this frame, 20 ms", (plot.x(0) + plot.x(160)) / 2, 3,
      { color: theme.text3, size: input.width < 480 ? 10 : 11, align: "center", baseline: "top" });
  }

  /** Redraw the flat view (when it shows) and pass the state to 3D. */
  const redraw = (/** @type {"none" | "auto" | "slow"} */ motion) => {
    if (!in3d()) drawFlat();
    sw.update(scene(motion));
  };

  /* ---- controls -------------------------------------------------------- */

  /**
   * @param {PhaseMode} mode
   * @param {number} rerollCount
   * @param {"none" | "auto" | "slow"} motion
   */
  function setPhase(mode, rerollCount, motion) {
    state.phase = mode;
    state.reroll = rerollCount;
    for (const radio of figure.querySelectorAll('input[name="phase"]')) {
      if (radio instanceof HTMLInputElement) radio.checked = radio.value === mode;
    }
    reroll.disabled = mode === "zero";
    scaledRow.hidden = mode !== "scaled";
    updateReadout();
    describe();
    redraw(motion);
  }

  /**
   * @param {number} alpha
   * @param {"none" | "auto" | "slow"} motion
   */
  function setAlpha(alpha, motion) {
    state.alpha = Math.min(1, Math.max(0, alpha));
    alphaInput.value = String(state.alpha);
    alphaOut.value = state.alpha.toFixed(2);
    alphaInput.setAttribute("aria-valuetext", state.alpha.toFixed(2));
    if (state.phase !== "scaled") return;
    updateReadout();
    describe();
    redraw(motion);
  }

  /**
   * @param {number} n
   * @param {"none" | "auto" | "slow"} motion
   */
  function setN(n, motion) {
    state.n = Math.max(1, Math.min(model.L, Math.round(n)));
    state.nAll = state.n === model.L;
    nInput.value = String(state.n);
    nInput.setAttribute("aria-valuetext", `${state.n} of ${model.L}`);
    updateReadout();
    describe();
    redraw(motion);
  }

  /** @type {ReturnType<typeof createAudioPlayer> | null} */
  let player = null;
  /** @type {{from: number, until: number}} */
  let span = { from: 0, until: 0 };
  const makePlayer = () => {
    player?.destroy();
    const from = model.i * 0.02 + 0.01 + clip.delayMs / 1000 - 0.15;
    span = { from, until: from + 0.3 };
    playButton.disabled = false;
    player = createAudioPlayer({
      src: `assets/audio/${clip.id}-ambe.wav`,
      button: playButton,
      from: span.from,
      until: span.until,
      onFrame: () => {},
      playLabel: "Hear the hardware around this frame",
      stopLabel: "Stop",
    });
  };

  const fillFrames = () => {
    frameSelect.replaceChildren();
    clip.picks.forEach((f, rank) => {
      const label = `${(f.i * 0.02).toFixed(2)} s, f0 ${Math.round(f.derived.orig_f0_hz)} Hz`;
      frameSelect.add(new Option(label, String(rank)));
    });
    frameSelect.value = String(state.rank);
  };

  /** Load the input WAV once per clip, then draw the strip. */
  const loadInput = async () => {
    const id = clip.id;
    if (!clip.pcm) {
      try {
        const pcm = await loadPCM(`assets/audio/${id}-original.wav`, { signal });
        const data = clips.get(id);
        if (data) data.pcm = pcm;
      } catch (error) {
        if (!signal.aborted) console.error("harmonic-sum: input audio failed to load", error);
        return;
      }
    }
    if (signal.aborted || clip.id !== id) return;
    drawInput();
    describe();
  };

  /** A new frame or clip: rebuild everything, no tween. */
  const setFrame = () => {
    model = frameModel(clip, clip.picks[state.rank]);
    nInput.max = String(model.L);
    const n = state.nAll ? model.L : Math.min(state.n, model.L);
    state.n = n;
    nInput.value = String(n);
    nInput.setAttribute("aria-valuetext", `${n} of ${model.L}`);
    updateReadout();
    redraw("none");
    makePlayer();
    loadInput();
    describe();
  };

  /** @param {Preset} name */
  const goPreset = (name) => {
    state.preset = name;
    dragged = false;
    pressPreset(name);
    sw.preset(name);
  };

  nInput.addEventListener("input", () => setN(Number(nInput.value), "auto"), { signal });
  for (const radio of figure.querySelectorAll('input[name="phase"]')) {
    radio.addEventListener("change", () => {
      if (radio instanceof HTMLInputElement && radio.checked) {
        setPhase(/** @type {PhaseMode} */ (radio.value), state.reroll, "auto");
      }
    }, { signal });
  }
  reroll.addEventListener("click", () => setPhase(state.phase, state.reroll + 1, "auto"), { signal });
  alphaInput.addEventListener("input", () => setAlpha(Number(alphaInput.value), "auto"), { signal });
  frameSelect.addEventListener("change", () => {
    state.rank = Number(frameSelect.value);
    setFrame();
  }, { signal });
  clipSelect.addEventListener("change", async () => {
    const id = clipSelect.value;
    const data = await loadClip(id);
    if (signal.aborted || clipSelect.value !== id) return;
    clip = data;
    state.clip = id;
    state.rank = 0;
    fillFrames();
    setFrame();
  }, { signal });
  for (const button of cameraGroup.querySelectorAll("button")) {
    button.addEventListener("click", () => goPreset(/** @type {Preset} */ (button.dataset.preset)), { signal });
  }

  const stopTheme = onThemeChange(() => {
    if (!in3d()) drawFlat();
    drawInput();
  });

  /* ---- first paint ----------------------------------------------------- */

  delete frame.dataset.state;
  fillFrames();
  setFrame();

  /** The walk-through runs (Play). */
  let playing = false;
  /** Bumped by every start and every pause, so an old run stops at its next await. */
  let playRun = 0;
  /** Set while the walk-through applies a step whose harmonics it adds itself. */
  let deferN = false;
  /** The walk-through's build step runs in the flat view (it counts the harmonics itself). */
  let deferredFlat = false;
  let stepIndex = 0;

  /**
   * @param {Record<string, string>} s
   * @param {{animate: boolean}} how
   */
  const apply = (s, how) => {
    link.view?.finish();
    stepIndex = stepper?.index ?? 0;
    syncScrub();
    // The walk-through moves slowly; a step from the reader stays short.
    const motion = playing && how.animate ? "slow" : how.animate ? "auto" : "none";
    if (s.view === "2d") sw.show2D();
    // Under reduced motion the reader opens 3D; steps do not. Not
    // awaited: 3D starts only once the figure is near the viewport.
    else if (s.view === "3d" && !reduced) void sw.show3D();
    if (s.preset === "corner" || s.preset === "front" || s.preset === "side") {
      if (dragged || s.preset !== state.preset) goPreset(s.preset);
    }
    if (s.alpha) {
      state.alpha = Math.min(1, Math.max(0, Number(s.alpha)));
      alphaInput.value = String(state.alpha);
      alphaOut.value = state.alpha.toFixed(2);
    }
    const n = s.n === "all" ? model.L : s.n ? Number(s.n) : state.n;
    // A step to every harmonic, from a few, adds them one at a time in 3D.
    buildNext = how.animate && !reduced && !deferN && s.n === "all" && model.L - state.n > 1;
    state.n = Math.max(1, Math.min(model.L, deferN ? state.n : n));
    state.nAll = state.n === model.L;
    nInput.value = String(state.n);
    nInput.setAttribute("aria-valuetext", `${state.n} of ${model.L}`);
    try {
      if (s.phase === "zero" || s.phase === "random" || s.phase === "scaled") setPhase(s.phase, state.reroll, motion);
      else setPhase(state.phase, state.reroll, motion);
    } finally {
      buildNext = false;
    }
  };

  /** @type {import("./anim-steps.js").Stepper | null} */
  let stepper = null;
  if (steps.length) {
    stepper = createStepper(figure, steps, apply, { signal });
  } else {
    setN(model.L, "none");
  }

  /* ---- Play: the steps as one walk-through ------------------------------- */

  /** @param {boolean} on */
  const setPlaying = (on) => {
    playing = on;
    walkButton.setAttribute("aria-pressed", String(on));
    walkButton.textContent = on ? "Pause" : "Play";
    captionLine.hidden = !on;
    figure.classList.toggle("anim-hsum--playing", on);
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
   * The motion a step adds in the walk-through, after its state is set.
   * In 3D the camera moves and the curtains move; in the flat view the
   * same changes land in turn. Under reduced motion nothing moves: the
   * step's end state is already set.
   * @param {number} run
   * @param {number} i the step
   * @param {Record<string, string>} s
   * @param {boolean} build  the step adds every harmonic, one at a time
   */
  const beat = async (run, i, s, build) => {
    const still = () => run === playRun && playing && !signal.aborted;
    if (reduced) return;
    const view = () => (in3d() ? link.view : null);
    if (i === 0) {
      // One harmonic: from where the flat view is, turning to the corner
      // while it grows, slides into the sum and settles back.
      await view()?.introduce(true);
      return;
    }
    if (build) {
      // One harmonic at a time: slowly for the first few, which carry most
      // of the shape, then quicker for the rest, which refine it. In 3D the
      // step's state started the build (one track); the flat view counts here.
      if (!deferredFlat) {
        await link.view?.idle();
        return;
      }
      for (let k = state.n + 1; k <= model.L && still(); k += 1) {
        const slow = k <= 5;
        state.n = k;
        state.nAll = k === model.L;
        nInput.value = String(k);
        nInput.setAttribute("aria-valuetext", `${k} of ${model.L}`);
        updateReadout();
        if (!in3d()) drawFlat();
        sw.update(scene("auto"));
        if (!(await hold(run, slow ? 1100 : 260))) return;
      }
      describe();
      return;
    }
    if (s.phase === "random" && s.preset !== "side") {
      // The crests slide out of line, slowly; then the camera comes round
      // to the front, where the pulse is gone, and back.
      const v = view();
      if (!v) return;
      await v.idle();
      if (!(await hold(run, 600))) return;
      await v.turn("front", 1600);
      if (!(await hold(run, 1800))) return;
      await v.turn(/** @type {Preset} */ (s.preset || "corner"), 1600);
      return;
    }
    if (s.preset === "side") {
      // From the side the curtains are the amplitudes. Flip the phases
      // back and forth: the bars stay, and in the flat view the stems
      // stay while the sum changes.
      if (!(await hold(run, 1600))) return;
      for (const mode of /** @type {PhaseMode[]} */ (["zero", "random"])) {
        setPhase(mode, state.reroll, "slow");
        if (!(await hold(run, 2000))) return;
      }
    }
  };

  /** @param {number} from 0-based */
  const playFrom = async (from) => {
    if (!stepper) return;
    const run = (playRun += 1);
    setPlaying(true);
    for (let i = from; i < steps.length; i += 1) {
      // The walk-through adds the harmonics of an "every harmonic" step one
      // at a time, from the count the step before left: in 3D through the
      // step's own build, in the flat view here (deferN keeps the count).
      const build = !reduced && steps[i].state.n === "all" && i > 0 && (steps[i - 1].state.n ?? "") !== "all";
      deferredFlat = deferN = build && !in3d();
      stepper.go(i);
      deferN = false;
      if (run !== playRun) return;
      // The caption reads the step without its inline citations.
      const text = /** @type {HTMLElement} */ (steps[i].item.cloneNode(true));
      for (const cite of text.querySelectorAll(".cite")) cite.remove();
      const lines = sentences(text.textContent ?? "");
      const motion = beat(run, i, steps[i].state, build);
      // A build's step shows its first sentence while the harmonics are
      // added, and the rest, about the finished pulse, once they all are.
      if (build && lines.length) {
        captionLine.textContent = lines[0];
        await Promise.all([motion, hold(run, readingMs(lines[0]))]);
        if (!(await hold(run, 300))) return;
      }
      for (const line of build ? lines.slice(1) : lines) {
        captionLine.textContent = line;
        if (!(await hold(run, readingMs(line)))) return;
      }
      await motion;
      if (run !== playRun) return;
      if (!(await hold(run, 500))) return;
    }
    if (run === playRun) setPlaying(false);
  };

  walkButton.addEventListener("click", () => {
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

  /* ---- test hook ------------------------------------------------------- */

  /** @returns {any} the 3D part's probe, while it is up */
  const three = () => (TEST_HOOK && in3d() ? TEST_HOOK.figures[`${SLUG}-3d`] : null);
  const probe = {
    get state() {
      return { ...state, view: sw.view(), f0: model.f0, L: model.L, frame: model.i, clip: clip.id };
    },
    get numbers() {
      return { ...numbers };
    },
    get crestOffsets() {
      return [...targetPhi()].slice(1, state.n + 1).map(crestOffset);
    },
    get phases() {
      return [...targetPhi()];
    },
    get builds() {
      return TEST_HOOK?.figures[`${SLUG}-3d`] ? /** @type {any} */ (TEST_HOOK.figures[`${SLUG}-3d`]).builds : 0;
    },
    get pose() {
      return three()?.pose ?? null;
    },
    get camera() {
      return three()?.camera ?? null;
    },
    get objects() {
      return three()?.objects ?? 0;
    },
    get player() {
      return { ...span };
    },
    get inputSamples() {
      return Array.from(inputSamples);
    },
    get amplitudes() {
      return Array.from(model.A);
    },
    get maxA() {
      return model.maxA;
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
    get nudges() {
      return nudges;
    },
    ribbonMaxAbs() {
      return three()?.ribbonMaxAbs() ?? [];
    },
    layout() {
      return {
        stems: { x: layout.stems.x, y: layout.stems.y, width: layout.stems.width, height: layout.stems.height },
        wave: { x: layout.wave.x, y: layout.wave.y, width: layout.wave.width, height: layout.wave.height },
        sum: { ...layout.sum },
      };
    },
    go: (/** @type {Preset} */ name) => goPreset(name),
    play: () => playFrom(0),
    /**
     * Where a scene point lands in the frame, in CSS px.
     * @param {[number, number, number]} at
     */
    screenOf(at) {
      return three()?.screenOf(at) ?? null;
    },
  };
  if (TEST_HOOK) TEST_HOOK.figures[SLUG] = probe;

  return () => {
    clearTimeout(describeTimer);
    playRun += 1;
    player?.destroy();
    flat.destroy();
    input.destroy();
    stopTheme();
    if (TEST_HOOK && TEST_HOOK.figures[SLUG] === probe) delete TEST_HOOK.figures[SLUG];
  };
}
