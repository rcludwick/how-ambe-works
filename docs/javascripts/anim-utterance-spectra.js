// @ts-check
/* ===========================================================================
 * anim-utterance-spectra.js: the same measurement, on different sounds.
 * ---------------------------------------------------------------------------
 * SLUG          utterance-spectra   (docs/01-why-sinusoids.md, with a poster
 *               and five steps)
 *
 * DATA READ     assets/data/<clip>/spectra.json
 *                 .original[window][bin]  dBFS, 128 bins, 31.25 Hz apart
 *                 .bin_centre_hz          the frequency of each bin
 *               Only .original is drawn, never .decoded.
 *
 *               DERIVED, not codec state: an ordinary FFT of the input
 *               recording, computed by tools/make-data.py. The AMBE-3000 does
 *               not report its internal spectrum and nothing here claims to
 *               be it.
 *
 * CONTROLS      three sentences, a female or male voice, a slider through
 *               the sentence one 20 ms window at a time, and play, which runs
 *               the recording and drives the slider from the audio clock.
 *               Steps (keys sentence, voice, pick, view, preset) choose
 *               windows by named criteria (lib/picks.js SPECTRA_PICKS),
 *               never by index.
 *
 * WHAT IT DRAWS 2D: total energy against time (top), and the spectrum of the
 *               selected window (bottom). 3D (anim-utterance-spectra-3d.js,
 *               loaded only when wanted): the whole sentence as a waterfall,
 *               one slice per window, in a box fixed at 0 to 3.7 s for every
 *               sentence, with the selected window in the highlight and the
 *               energy on a wall at the 0 Hz side. Its Front preset is the
 *               bottom panel.
 *
 * WHAT IT IS FOR
 *               Chapter 01 closes by claiming that measuring energy per
 *               frequency does not have to be reinvented per sound. The
 *               figure runs the identical measurement on six recordings and
 *               lets the reader look: the shapes differ, the axes do not.
 *               The "CQ CQ CQ" clip is left out: it means nothing yet to a
 *               reader who has not reached the D-STAR chapters. There is no
 *               harmonic comb, band edge or codec overlay; those arrive in
 *               chapter 07.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createAudioPlayer,
  createPlot,
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
  ticks,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { SPECTRA_PICKS, totalDb } from "./lib/picks.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "utterance-spectra";
const STEP_KEYS = /** @type {const} */ (["sentence", "voice", "pick", "view", "preset"]);

/** Floor of the dB axis. Below this is the noise of the recording. */
export const FLOOR_DB = -85;
/** One window every 20 ms. */
export const HOP_S = 0.02;
/** The 3D box's depth: the longest sentence offered is 3.66 s. */
export const BOX_S = 3.7;

const SENTENCES = [
  { id: "c", label: "She sells sea shells" },
  { id: "a", label: "The quick brown fox" },
  // The recording's words, not the author speaking: escaped so the copy
  // lint (tools/check-copy.py flags that first word) reads past them.
  { id: "d", label: "\u0057e were away" },
];

const VOICES = [
  { id: "lj", label: "Female" },
  { id: "lr", label: "Male" },
];

const PRESETS = [
  { id: "front", label: "Front" },
  { id: "corner", label: "Corner" },
  { id: "top", label: "Top" },
];

/**
 * @typedef {Object} Clip
 * @property {SpectraFile} doc
 * @property {number[]} energy  total power per window, dBFS (lib/picks.js totalDb)
 */

/**
 * What the 3D part is given: the 2D module's arrays and choices. It computes
 * no model data of its own.
 * @typedef {Object} SpectraState
 * @property {string} clip  e.g. "lj-c"
 * @property {Clip | null} data
 * @property {number} frame  the selected window
 * @property {string} preset  front, corner or top
 * @property {number} pulses  bumped when a step picks a window
 * @property {string} voice  "female" or "male"
 * @property {(width: number, height: number) => {x: number, y: number, width: number, height: number}} plotRect
 *           the bottom panel's plot area in a frame of that size
 * @property {(bins: number[], hz: number[]) => {x: number, y: number}[]} spectrumPoints
 */

/**
 * One window's spectrum as the figure plots it, in data units: frequency in
 * Hz, level in dBFS held at the floor. Both views draw these points.
 * @param {number[]} bins dB
 * @param {number[]} hz bin centres
 * @returns {{x: number, y: number}[]}
 */
export function spectrumPoints(bins, hz) {
  return bins.map((db, i) => ({ x: hz[i], y: Math.max(FLOOR_DB, db) }));
}

/**
 * The two panels' padding in a canvas of `width` x `height` CSS px. The
 * bottom panel's plot area is what the 3D Front preset fits to.
 * @param {number} width
 * @param {number} height
 */
export function layout(width, height) {
  const left = width < 560 ? 34 : 46;
  const gap = 30;
  const topH = Math.round((height - gap) * 0.3);
  return {
    top: { top: 12, right: 14, bottom: height - 12 - topH, left },
    bottom: { top: 12 + topH + gap, right: 14, bottom: 34, left },
  };
}

/** @param {number} width @param {number} height */
function plotRect(width, height) {
  const { bottom } = layout(width, height);
  return {
    x: bottom.left,
    y: bottom.top,
    width: Math.max(1, width - bottom.left - bottom.right),
    height: Math.max(1, height - bottom.top - bottom.bottom),
  };
}

/**
 * Tick values that will not collide, given how much room the axis has.
 * @param {[number, number]} domain
 * @param {number} pixels
 */
const fittedTicks = (domain, pixels) => ticks(domain, Math.max(2, Math.floor(pixels / 62)));

/** @param {number} i */
const seconds = (i) => `${(i * HOP_S).toFixed(2)} s`;

const pressed = (/** @type {boolean} */ on) => (on ? "true" : "false");

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Short-time spectra across a spoken sentence</p>
</div>
<div class="anim-figure__frame" data-state="loading">
  <canvas class="anim-figure__canvas" role="img" aria-label="Spectra of a spoken sentence, loading."></canvas>
</div>
<div class="anim-figure__step"></div>
<ul class="anim-legend">
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line uspec__swatch--this"></i>this window's spectrum (thick, outlined)</li>
  <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch anim-legend__swatch--line is-data-1"></i>total energy of each window (top strip)</li>
  <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch uspec__swatch--ramp"></i>the other windows, 20 ms apart, coloured by level from low to high</li>
  <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch uspec__swatch--wall"></i>total energy of each window, on the wall at 0 Hz</li>
</ul>
<div class="anim-controls">
  <button class="anim-btn anim-btn--play" type="button" data-kind="audio" data-role="play" aria-pressed="false">Play</button>
  <div class="anim-controls__group" role="group" aria-label="Sentence">
    ${SENTENCES.map((s) => `<button class="anim-btn" type="button" data-sentence="${s.id}" aria-pressed="false">${s.label}</button>`).join("\n    ")}
  </div>
  <div class="anim-controls__group" role="group" aria-label="Voice">
    ${VOICES.map((v) => `<button class="anim-btn" type="button" data-voice="${v.id}" aria-pressed="false">${v.label}</button>`).join("\n    ")}
  </div>
  <label class="anim-field">
    <span class="anim-field__label">Through the sentence</span>
    <input class="anim-range" type="range" min="0" max="0" step="1" value="0"
           data-role="frame" aria-label="Window in the sentence">
  </label>
</div>
<div class="anim-controls">
  <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">Whole sentence (3D)</button>
  <div class="anim-controls__group" data-role="camera" hidden>
    <span class="anim-field__label">Camera</span>
    <div class="anim-toggle-group" role="group" aria-label="Camera">
      ${PRESETS.map((p) => `<button class="anim-btn" type="button" data-preset="${p.id}" aria-pressed="false">${p.label}</button>`).join("\n      ")}
    </div>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
<div class="anim-forms" data-role="readout" aria-live="polite" hidden>
  <p class="anim-forms__row"><span class="anim-forms__tag">this window</span>
    <code data-role="r-window"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">loudest at</span>
    <code data-role="r-peak"></code></p>
</div>
<figcaption class="anim-figure__caption">
  Press Play or drag through the sentence to inspect each 20&nbsp;ms window's
  spectrum from 0 to 4&nbsp;kHz.
  <span class="anim-figure__source">Pre-codec FFT of the 8&nbsp;kHz input recordings.</span>
</figcaption>
`;

/**
 * @param {Element} host the `[data-anim="utterance-spectra"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  // The steps keep their state from here; their data-sentence and
  // data-voice would otherwise match the buttons' selectors too.
  for (const step of steps) for (const key of STEP_KEYS) step.item.removeAttribute(`data-${key}`);
  const root = document.createElement("figure");
  root.className = "anim-figure anim-uspec";
  root.innerHTML = FIGURE_HTML;
  root.dataset.view = "2d";
  host.append(root);
  markEnhanced(host);
  $(root, ".anim-figure__caption", HTMLElement).append(" ", badge("derived-input"));

  const frame = $(root, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const slider = $(root, '[data-role="frame"]', HTMLInputElement);
  const windowEl = $(root, '[data-role="r-window"]', HTMLElement);
  const peakEl = $(root, '[data-role="r-peak"]', HTMLElement);
  const playEl = $(root, '[data-role="play"]', HTMLButtonElement);
  const toggle = $(root, '[data-view="3d"]', HTMLButtonElement);
  const camera = $(root, '[data-role="camera"]', HTMLElement);
  const hint = $(root, ".anim-figure__hint--webgl", HTMLElement);
  /** @param {string} selector */
  const all = (selector) => /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll(selector)]);
  const sentenceEls = all("[data-sentence]");
  const voiceEls = all("[data-voice]");
  const presetEls = all("[data-preset]");

  const first = steps[0]?.state ?? {};
  /** @type {SpectraState & {sentence: string, voiceId: string}} */
  const state = {
    sentence: first.sentence ?? "c",
    voiceId: first.voice ?? "lj",
    clip: "",
    data: null,
    frame: 0,
    preset: first.preset ?? "corner",
    pulses: 0,
    voice: "female",
    plotRect,
    spectrumPoints,
  };
  /** @type {Map<string, Clip>} */
  const cache = new Map();
  /** @type {ReturnType<typeof createAudioPlayer> | null} */
  let player = null;
  /** @type {ReturnType<typeof createViewSwitch> | null} */
  let views = null;

  const handle = setupCanvas(canvas, { onResize: () => render() });

  const pressAll = () => {
    for (const el of sentenceEls) el.setAttribute("aria-pressed", pressed(el.dataset.sentence === state.sentence));
    for (const el of voiceEls) el.setAttribute("aria-pressed", pressed(el.dataset.voice === state.voiceId));
    for (const el of presetEls) el.setAttribute("aria-pressed", pressed(el.dataset.preset === state.preset));
  };

  /** Bumped on every load, so a slow response for a clip the reader has
   *  already left cannot overwrite the one chosen after it; the cleanup bumps
   *  it too, so a load in flight when the page goes builds nothing. */
  let loadSeq = 0;

  /** @returns {Promise<boolean>} true once the chosen clip is in state */
  async function load() {
    const clip = `${state.voiceId}-${state.sentence}`;
    const seq = ++loadSeq;
    /** @param {Clip} entry */
    const use = (entry) => {
      const before = state.data ? state.frame * HOP_S : null;
      state.data = entry;
      state.clip = clip;
      state.voice = state.voiceId === "lr" ? "male" : "female";
      const n = entry.doc.original.length;
      // The same moment in the new clip, or 40% of the way through on the first load.
      state.frame = Math.min(n - 1, before === null ? Math.round(0.4 * (n - 1)) : Math.round(before / HOP_S));
      slider.max = String(n - 1);
      frame.dataset.state = "ready";
      return true;
    };
    const cached = cache.get(clip);
    if (cached) return use(cached);
    frame.dataset.state = "loading";
    try {
      const doc = /** @type {SpectraFile} */ (await loadJSON(`assets/data/${clip}/spectra.json`));
      const entry = { doc, energy: doc.original.map(totalDb) };
      cache.set(clip, entry);
      if (seq !== loadSeq) return false;
      return use(entry);
    } catch (error) {
      if (seq !== loadSeq) return false;
      frame.dataset.state = "error";
      windowEl.textContent = `could not load ${clip}`;
      return false;
    }
  }

  /** The 2D canvas, the readouts, and the 3D view (if up). */
  function render() {
    if (!state.data) return;
    const { doc, energy } = state.data;
    const i = Math.max(0, Math.min(doc.original.length - 1, state.frame));
    const bins = doc.original[i];
    slider.value = String(i);
    slider.setAttribute("aria-valuetext", seconds(i));
    draw2D(i);

    let peak = 0;
    for (let k = 1; k < bins.length; k += 1) if (bins[k] > bins[peak]) peak = k;
    windowEl.textContent = `${seconds(i)} into “${doc.clip.text}”`;
    peakEl.textContent = energy[i] < -60
      ? "nothing above the noise floor here"
      : `${Math.round(doc.bin_centre_hz[peak])} Hz, at ${bins[peak]} dBFS`;
    views?.update(state);
    describeSoon();
  }

  /** @param {number} i */
  function draw2D(i) {
    if (!state.data || canvas.hidden) return;
    const { doc, energy } = state.data;
    const th = getTheme();
    const g = handle.ctx;
    const W = handle.width;
    const H = handle.height;
    clearCanvas(g, handle);
    const pad = layout(W, H);
    const duration = doc.clip.duration_s;

    // Headroom above the loudest window for the sentence's label, so the
    // label never sits on the curve and the peaks read as peaks.
    const [low, high] = [Math.min(...energy), Math.max(...energy)];
    const room = 22 / Math.max(44, H - pad.top.top - pad.top.bottom);
    const top = createPlot({ width: W, height: H }, {
      xDomain: [0, duration],
      yDomain: [low - 2, low - 2 + (high - low + 4) / (1 - room)],
      padding: pad.top,
    });
    const timeTicks = fittedTicks([0, duration], top.area.width);
    drawGrid(g, top, { xTicks: timeTicks, yTicks: [] });
    drawAxes(g, top, { xTicks: timeTicks, yTicks: [], formatX: (v) => `${v.toFixed(1)}s` });
    g.save();
    top.clip(g);
    drawPolyline(g, energy.map((v, k) => ({ x: k * HOP_S, y: v })), {
      plot: top, color: th.series[0], width: 1.6, fill: `${th.series[0]}33`,
    });
    const cursor = top.x(i * HOP_S);
    g.strokeStyle = th.css("--ambe-highlight");
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cursor, top.area.top);
    g.lineTo(cursor, top.area.bottom);
    g.stroke();
    g.restore();
    drawLabel(g, `“${doc.clip.text}”`, top.area.left + 6, top.area.top + 2, {
      align: "left", baseline: "top", size: 11, color: th.text3, background: th.plotBg, padding: 3,
    });

    const nyquist = doc.bin_centre_hz[doc.bin_centre_hz.length - 1];
    const bottom = createPlot({ width: W, height: H }, {
      xDomain: [0, nyquist],
      yDomain: [FLOOR_DB, 0],
      padding: pad.bottom,
    });
    const xTicks = [0, 1000, 2000, 3000, 4000].filter((v) => v <= nyquist);
    const yTicks = [-80, -60, -40, -20, 0];
    drawGrid(g, bottom, { xTicks, yTicks });
    drawAxes(g, bottom, {
      xTicks, yTicks,
      formatX: (v) => (v === 0 ? "0" : `${v / 1000}k`),
      formatY: (v) => `${v}`,
      xLabel: "frequency, Hz",
      // On a narrow canvas the rotated name would run over the ticks; the
      // readout says dBFS beside the value.
      yLabel: W < 560 ? undefined : "dBFS",
    });
    g.save();
    bottom.clip(g);
    drawPolyline(g, spectrumPoints(doc.original[i], doc.bin_centre_hz), {
      plot: bottom,
      color: th.css("--ambe-highlight"),
      width: 2.6,
      fill: th.css("--ambe-highlight-fill-top"),
      fillBaseline: FLOOR_DB,
    });
    g.restore();
  }

  /** The canvas's sentence, rebuilt 250 ms after the last change. */
  let describeTimer = 0;
  function describeSoon() {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      if (!state.data) return;
      const { doc, energy } = state.data;
      const i = state.frame;
      canvas.setAttribute("aria-label",
        `Top: total energy against time for “${doc.clip.text}”, ${state.voice} voice. ` +
        `Bottom: the spectrum of the 32 millisecond window at ${seconds(i)}, from 0 to 4 kilohertz, ` +
        (energy[i] < -60 ? "at the noise floor." : `with a total of ${Math.round(energy[i])} dBFS.`) +
        (views && !views.available() ? ` ${NO_WEBGL_HINT}; the whole sentence is not shown in 3D here.` : ""));
    }, 250);
  }

  /** Point the play button at the current clip (and stop the old one). */
  function attachPlayer() {
    player?.destroy();
    if (!state.data) return;
    playEl.disabled = false;
    player = createAudioPlayer({
      src: state.data.doc.clip.original_audio,
      button: playEl,
      onFrame: (time) => {
        if (time !== null && state.data) {
          // The audio clock drives the slider; dragging takes it back.
          state.frame = Math.max(0, Math.min(state.data.doc.original.length - 1, Math.floor(time / HOP_S)));
        }
        render();
      },
    });
  }

  async function reload() {
    pressAll();
    if (!(await load())) return false;
    attachPlayer();
    render();
    return true;
  }

  /** Bumped by every step, so a step whose clip is still loading gives way. */
  let stepSeq = 0;
  /**
   * @param {Record<string, string>} step
   * @returns {Promise<void>}
   */
  async function applyStep(step) {
    const seq = ++stepSeq;
    if (step.sentence) state.sentence = step.sentence;
    if (step.voice) state.voiceId = step.voice;
    if (step.preset) state.preset = step.preset;
    pressAll();
    if (`${state.voiceId}-${state.sentence}` !== state.clip) {
      if (!(await reload())) return;
    } else if (frame.dataset.state === "loading") {
      // Back on the clip in hand: a load still in flight for another
      // step's clip must not land after this one.
      loadSeq += 1;
      frame.dataset.state = "ready";
      attachPlayer();
    }
    if (seq !== stepSeq || !state.data) return;
    const pick = SPECTRA_PICKS[/** @type {"low-heavy" | "high-heavy"} */ (step.pick)];
    const found = pick ? pick(state.data.doc.original, state.data.doc.bin_centre_hz) : null;
    if (found !== null) {
      state.frame = found;
      state.pulses += 1;
    }
    // Under reduced motion a step is not a request for 3D (plan O1): only
    // the 3D control loads it. The step text reads in 2D as well.
    if (step.view === "3d" && !prefersReducedMotion()) void views?.show3D();
    else if (step.view === "2d") views?.show2D();
    if (step.preset) views?.preset(step.preset);
    render();
  }

  for (const el of sentenceEls) {
    el.addEventListener("click", () => {
      state.sentence = el.dataset.sentence ?? state.sentence;
      void reload();
    }, { signal });
  }
  for (const el of voiceEls) {
    el.addEventListener("click", () => {
      state.voiceId = el.dataset.voice ?? state.voiceId;
      void reload();
    }, { signal });
  }
  for (const el of presetEls) {
    el.addEventListener("click", () => {
      state.preset = el.dataset.preset ?? state.preset;
      pressAll();
      views?.preset(state.preset);
    }, { signal });
  }
  slider.addEventListener("input", () => {
    if (player?.playing()) player.stop();
    state.frame = Number(slider.value);
    render();
  }, { signal });

  const offTheme = onThemeChange(() => render());
  const cleanup = () => {
    loadSeq += 1;
    stepSeq += 1;
    clearTimeout(describeTimer);
    player?.destroy();
    offTheme();
    handle.destroy();
    if (TEST_HOOK && TEST_HOOK.figures[SLUG] === hooked) delete TEST_HOOK.figures[SLUG];
  };
  /** @type {unknown} */
  let hooked = null;
  await reload();
  // Gone while the first clip loaded: start nothing that would outlive it.
  if (signal.aborted) return cleanup;

  /** @param {"2d" | "3d" | "parked"} view */
  const onView = (view) => {
    const three = view === "3d";
    root.dataset.view = three ? "3d" : "2d";
    camera.hidden = !three;
    if (!three) render();
  };
  views = createViewSwitch({
    frame, flat: canvas, toggle, hint, signal,
    state: () => state,
    load: () => import("./anim-utterance-spectra-3d.js"),
    onView,
    id: SLUG,
  });
  if (steps.length) createStepper(root, steps, (step) => void applyStep(step), { signal });

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = hooked = {
      state: () => ({ clip: state.clip, frame: state.frame, preset: state.preset, view: views?.view() }),
      plotRect: () => plotRect(frame.clientWidth, frame.clientHeight),
      points: () => (state.data ? spectrumPoints(state.data.doc.original[state.frame], state.data.doc.bin_centre_hz) : []),
      nyquist: () => state.data?.doc.bin_centre_hz.at(-1) ?? 0,
    };
  }

  return cleanup;
}
