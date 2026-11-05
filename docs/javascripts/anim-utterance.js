// @ts-check
/* ===========================================================================
 * anim-utterance.js: a sentence, and what it looks like close up.
 * ---------------------------------------------------------------------------
 * SLUG          utterance        <div data-anim="utterance" markdown="1">
 *
 * DATA READ     assets/data/<clip>/waveform.json
 *                 .original.min / .max   2.5 ms envelope of the whole sentence
 *                 .closeups.voiced       60 ms of RAW samples, a vowel
 *                 .closeups.unvoiced     60 ms of RAW samples, a fricative
 *
 *               DERIVED, not codec state. These are the 8 kHz samples of the
 *               recording before it ever reached the AMBE-3000. Nothing on
 *               this figure came out of the chip.
 *
 * CONTROLS      vowel or fricative, which moves the closeup window; play,
 *               which plays the recording with a cursor tracking it; 3D;
 *               in 3D, the layout (laid end to end or stacked) and the
 *               camera presets. Steps in the chapter set window, layout
 *               and preset.
 *
 * AUDIO         `clip.original_audio` from the same JSON, so the figure and
 *               the sound are always the same recording. It is the audio
 *               BEFORE the codec, matching the samples drawn. Nothing here
 *               plays the decoded track; chapter 12 is where the two are
 *               compared.
 *
 * WHAT IT DRAWS Top: the whole sentence, as an envelope (drawStrip). Bottom:
 *               60 ms of it at full sample resolution, with the pitch period
 *               marked when the window is periodic (drawCloseup).
 *
 * 3D VIEW       anim-utterance-3d.js, loaded only when a 3D view is wanted
 *               (lib/view-switch.js). It cuts the closeup into pitch periods
 *               (lib/periods.js; the arrays come from here) and stacks them
 *               in depth, one period per row, so a vowel's periods lie
 *               nearly on top of one another and a fricative's do not. The
 *               strip, and in the front view the closeup's grid and axis,
 *               stay 2D: the 2D canvas moves above the 3D canvas and draws
 *               only those, so the frame holds two canvases.
 *
 * WHY BOTH      Chapter 01 opens by proposing the obvious compression: record
 *               the shape of one pulse and how often it repeats. The figure
 *               has to make that proposal look reasonable before the chapter
 *               knocks it down, so the vowel closeup really does repeat, and
 *               the readout really does give a period. Neighbouring periods
 *               in the window this clip selects correlate at about 0.95 on
 *               average (0.90 at the least), which is "clearly the same
 *               motif again" rather than "identical", and the prose is
 *               worded to match. Then the fricative button shows that the
 *               same sentence has stretches with no period at all (its
 *               slices, cut at the vowel's period, correlate at 0.06 on
 *               average), which is the first crack in the plan and the
 *               reason chapter 07 needs voicing decisions.
 *
 * WHY 60 ms     waveform.json's min/max buckets are 2.5 ms, about a third of a
 *               pitch period. They can draw a sentence and cannot show that it
 *               is periodic. The closeups exist for exactly this figure; see
 *               `closeups()` in tools/make-data.py.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  setupCanvas,
  createPlot,
  clearCanvas,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  onThemeChange,
  loadJSON,
  markEnhanced,
  opensIn3D,
  ticks,
  createAudioPlayer,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { mean, neighbourCorrelation, slicePeriods } from "./lib/periods.js";
import { createViewSwitch } from "./lib/view-switch.js";

const STEP_KEYS = /** @type {const} */ (["window", "layout", "preset", "view"]);

/**
 * Tick values that will not collide, given how much room the axis has.
 * The default tick count is fixed, which is fine on a laptop and runs the
 * labels into each other on a phone.
 * @param {[number, number]} domain
 * @param {number} pixels
 * @param {number} [perLabel=62]
 * @returns {number[]}
 */
function fittedTicks(domain, pixels, perLabel = 62) {
  return ticks(domain, Math.max(2, Math.floor(pixels / perLabel)));
}

/**
 * "She sells sea shells by the sea shore", female voice. Chosen because it has
 * the smallest gap in the set between its loudest vowel and its loudest
 * fricative, 10.7 dB. Every clip has a gap: turbulence is a much less
 * efficient sound source than the vocal folds, so a fricative is always
 * quieter than a vowel. The panels are therefore each scaled to their own
 * peak, and the caption says so, because the contrast the figure is making is
 * in shape and drawing them at true relative level would hide it.
 *
 * An earlier version of this claimed the two were within a decibel. That came
 * from a selection bug: the closeup picked the loudest frame the pitch tracker
 * failed on, which on this clip was a loud low-frequency sound with 93% of its
 * energy below 1 kHz, and called it a fricative. See closeups() in
 * tools/make-data.py.
 */
const CLIP = "lj-c";

const FULL_SCALE = 32768;
const SR = 8000;

/** @typedef {"voiced" | "unvoiced"} WindowId */
/** @typedef {"laid" | "stacked"} Layout */
/** @typedef {"none" | "strip" | "all"} Face */

/** @type {{id: WindowId, label: string}[]} */
const WINDOWS = [
  { id: "voiced", label: "A vowel" },
  { id: "unvoiced", label: "A fricative" },
];

/**
 * @typedef {Object} Closeup
 * @property {number} frame
 * @property {number} start_s
 * @property {number | null} f0_hz
 * @property {number[]} samples
 */

/**
 * @typedef {Object} Waveform
 * @property {{text: string, duration_s: number, original_audio: string}} clip
 * @property {number} bucket_ms
 * @property {number} closeup_samples
 * @property {{min: number[], max: number[]}} original
 * @property {Partial<Record<WindowId, Closeup>>} closeups
 */

/* --- markup -------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Periodic vowel cycles and unvoiced consonant noise</p>
</div>

<div class="anim-figure__frame" data-state="loading">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="Top: the waveform envelope of a whole spoken sentence. Bottom: sixty milliseconds of it at full sample resolution, showing either a repeating pulse train from a vowel or aperiodic noise from a fricative."></canvas>
</div>

<div class="anim-figure__step"></div>

<div class="anim-controls">
  <button class="anim-btn anim-btn--play" type="button" data-kind="audio" data-role="play"
          aria-pressed="false">Play</button>
  <div class="anim-controls__group" role="group" aria-label="Which part of the sentence to magnify">
    ${WINDOWS.map(
      (w, i) =>
        `<button class="anim-btn" type="button" data-window="${w.id}"
                 aria-pressed="${i === 0 ? "true" : "false"}">${w.label}</button>`
    ).join("\n    ")}
  </div>
  <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
  <div class="anim-controls__group" data-role="layout" hidden>
    <span class="anim-field__label">Periods</span>
    <div class="anim-toggle-group" role="group" aria-label="Periods">
      <button class="anim-btn" type="button" data-layout="laid" aria-pressed="false">Laid end to end</button>
      <button class="anim-btn" type="button" data-layout="stacked" aria-pressed="true">Stacked</button>
    </div>
  </div>
  <div class="anim-controls__group" data-role="camera" hidden>
    <span class="anim-field__label">Camera</span>
    <div class="anim-toggle-group" role="group" aria-label="Camera">
      <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
      <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
      <button class="anim-btn" type="button" data-preset="along" aria-pressed="false">Along the stack</button>
    </div>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>

<div class="anim-forms" data-role="readout" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">this window</span>
    <output data-role="r-window"></output></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">periods</span>
    <output data-role="r-periods"></output></p>
</div>

<figcaption class="anim-figure__caption"><span data-role="caption"></span>
  <span class="anim-utterance__badges">Samples: <span data-badge="input"></span>
  Periods: <span data-badge="derived-input"></span></span></figcaption>
`;

const CAPTIONS = {
  voiced:
    "A 60 ms window on the vowel in “sells”: the vocal cords produce a " +
    "repeating pulse every 5.38 ms (186 Hz). Press Play to hear the sentence.",
  unvoiced:
    "A 60 ms window on the “sh” in “shells”: turbulent air noise with no " +
    "repeating pitch period (scaled up 10.7 dB for comparison).",
};

/** The captions while the 3D view is up. */
const CAPTIONS_3D = {
  voiced:
    "Ten consecutive 5.38 ms slices of the vowel stacked from front to back " +
    "(0.95 average correlation between neighboring slices). Drag to rotate.",
  unvoiced:
    "The unvoiced “sh” cut at the same 5.38 ms interval: no two slices agree " +
    "(0.06 average correlation). Drag to rotate.",
};

const SOURCE_NOTE =
  '<span class="anim-figure__source">8 kHz pre-codec input recording.</span>';

/* --- layout and drawing -------------------------------------------------- */

/**
 * The two panels of a canvas W x H: the whole sentence on top, the
 * closeup below.
 * @param {number} W
 * @param {number} H
 * @param {Waveform} d
 * @returns {{top: import("./anim-core.js").Plot, bottom: import("./anim-core.js").Plot, ms: number}}
 */
export function panels(W, H, d) {
  const stacked = W < 560;
  const padL = stacked ? 32 : 46;
  const gap = 30;
  const topH = Math.round((H - gap) * 0.38);
  const top = createPlot(
    { width: W, height: H },
    {
      xDomain: [0, d.clip.duration_s],
      yDomain: [-1, 1],
      padding: { top: 12, right: 14, bottom: H - 12 - topH, left: padL },
    }
  );
  const ms = (d.closeup_samples / SR) * 1000;
  const bottom = createPlot(
    { width: W, height: H },
    {
      xDomain: [0, ms],
      yDomain: [-1, 1],
      padding: { top: 12 + topH + gap, right: 14, bottom: 30, left: padL },
    }
  );
  return { top, bottom, ms };
}

/**
 * The closeup's samples, each scaled so the window's peak sits at 0.92.
 * @param {Closeup} win
 * @returns {number[]}
 */
export function scaled(win) {
  const peak = Math.max(1, win.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
  const scale = 0.92 / (peak / FULL_SCALE);
  return win.samples.map((v) => (v / FULL_SCALE) * scale);
}

/**
 * The pitch-period marks the closeup draws: from the largest sample, one
 * period apart, to the end of the window. None without an f0.
 * @param {Closeup} win
 * @param {number} ms the window's length in ms
 * @returns {{t0: number, period: number, times: number[]}}
 */
export function markers(win, ms) {
  if (!win.f0_hz) return { t0: 0, period: 0, times: [] };
  const period = 1000 / win.f0_hz;
  // Start the marker at the largest peak, which is a pulse.
  let peakIdx = 0;
  for (let i = 0; i < win.samples.length; i += 1) {
    if (Math.abs(win.samples[i]) > Math.abs(win.samples[peakIdx])) peakIdx = i;
  }
  const t0 = (peakIdx / SR) * 1000;
  /** @type {number[]} */
  const times = [];
  for (let t = t0; t <= ms; t += period) times.push(t);
  return { t0, period, times };
}

/**
 * Top: the whole sentence as an envelope, the closeup's window marked on
 * it, and the playhead while the recording plays.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./anim-core.js").Plot} top
 * @param {Waveform} d
 * @param {Closeup} win
 * @param {number | null} playhead
 */
function drawStrip(ctx, top, d, win, playhead) {
  const th = getTheme();
  const duration = d.clip.duration_s;
  const bucketS = d.bucket_ms / 1000;

  const timeTicks = fittedTicks([0, duration], top.area.width);
  drawGrid(ctx, top, { xTicks: timeTicks, yTicks: [0] });
  drawAxes(ctx, top, {
    xTicks: timeTicks,
    yTicks: [],
    formatX: (v) => `${v.toFixed(1)}s`,
  });

  ctx.save();
  top.clip(ctx);
  // The envelope is drawn as a filled band between the per-bucket minimum
  // and maximum, which is what those arrays are.
  ctx.fillStyle = th.series[0];
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  const mins = d.original.min;
  const maxs = d.original.max;
  for (let i = 0; i < maxs.length; i += 1) {
    const x = top.x(i * bucketS);
    const y = top.y(maxs[i] / FULL_SCALE);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = mins.length - 1; i >= 0; i -= 1) {
    ctx.lineTo(top.x(i * bucketS), top.y(mins[i] / FULL_SCALE));
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Mark where the closeup is taken from, so the bottom panel is anchored
  // in the top one rather than floating free.
  const winStart = win.start_s;
  const winEnd = winStart + d.closeup_samples / SR;
  ctx.fillStyle = th.accentWarm;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(
    top.x(winStart),
    top.area.top,
    Math.max(2, top.x(winEnd) - top.x(winStart)),
    top.area.height
  );
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.accentWarm;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(top.x(winStart), top.area.top);
  ctx.lineTo(top.x(winStart), top.area.bottom);
  ctx.moveTo(top.x(winEnd), top.area.top);
  ctx.lineTo(top.x(winEnd), top.area.bottom);
  ctx.stroke();

  // The playhead, when the recording is running. Drawn last inside the clip
  // so it rides over the envelope rather than under it.
  if (playhead !== null) {
    const px = top.x(Math.min(playhead, duration));
    ctx.strokeStyle = th.accentCool;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, top.area.top);
    ctx.lineTo(px, top.area.bottom);
    ctx.stroke();
  }
  ctx.restore();

  drawLabel(ctx, `“${d.clip.text}”`, top.area.left + 6, top.area.top + 2, {
    align: "left", baseline: "top", size: 11, color: th.text3,
    background: th.plotBg, padding: 3,
  });
}

/**
 * Bottom: the closeup. With `wave: false` (the 3D view's overlay, front
 * view) only its grid and axis: the 3D view draws the samples and the
 * period marks, and its chip states the period, so the bracket and its
 * label would say it twice.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./anim-core.js").Plot} bottom
 * @param {Closeup} win
 * @param {number} ms
 * @param {{wave: boolean}} opts
 */
function drawCloseup(ctx, bottom, win, ms, opts) {
  const th = getTheme();
  drawGrid(ctx, bottom, { yTicks: [0] });
  drawAxes(ctx, bottom, {
    yTicks: [],
    formatX: (v) => `${v.toFixed(0)}ms`,
    xLabel: "milliseconds",
  });

  ctx.save();
  bottom.clip(ctx);
  if (opts.wave) {
    const ys = scaled(win);
    const pts = ys.map((y, i) => ({ x: (i / SR) * 1000, y }));
    drawPolyline(ctx, pts, { plot: bottom, color: th.series[1], width: 1.6 });
  }

  // One pitch period, marked, when there is one. The point of the vowel
  // panel is that the pulses repeat at a rate you can measure, so measure
  // it on screen rather than only asserting it in the caption.
  const mark = markers(win, ms);
  if (mark.times.length) {
    const y = bottom.y(-0.99);
    ctx.strokeStyle = th.accentWarm;
    ctx.lineWidth = 1.6;
    if (opts.wave) {
      for (const t of mark.times) {
        ctx.beginPath();
        ctx.moveTo(bottom.x(t), bottom.area.top);
        ctx.lineTo(bottom.x(t), bottom.area.bottom);
        ctx.globalAlpha = 0.28;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (opts.wave && mark.t0 + mark.period <= ms) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(bottom.x(mark.t0), y);
      ctx.lineTo(bottom.x(mark.t0 + mark.period), y);
      ctx.stroke();
    }
  }
  ctx.restore();

  if (opts.wave && win.f0_hz) {
    drawLabel(
      ctx,
      `one period, ${(1000 / win.f0_hz).toFixed(1)} ms`,
      bottom.x((win.samples.length / SR) * 1000 * 0.5),
      bottom.y(-0.99) - 6,
      {
        align: "center", baseline: "bottom", size: 11, color: th.accentWarm,
        background: th.plotBg, padding: 3,
      }
    );
  }
}

/* --- module -------------------------------------------------------------- */

/**
 * What the 3D part draws from (lib/view-switch.js passes it on). Every
 * array is the 2D module's; the 3D part only places them.
 * @typedef {Object} UtteranceState
 * @property {WindowId} which
 * @property {Layout} layout
 * @property {string} preset
 * @property {number[]} wave  the closeup's samples as plotted (peak 0.92)
 * @property {number} ms  the window's length in ms
 * @property {number} sr
 * @property {import("./lib/periods.js").Periods} periods  cut at the vowel's period
 * @property {number} periodMs
 * @property {number[]} marks  the 2D period marks, in ms
 * @property {() => import("./lib/orbit.js").PlotRect} rect  the closeup's plot area in the frame
 * @property {(face: Face) => void} front  how much of the 2D overlay the
 *           3D view's pose leaves room for: at the front preset at 1x the
 *           strip ("strip"), and laid end to end there the closeup's grid,
 *           axis and bracket too ("all"); turned away, nothing ("none")
 */

/**
 * Mount the utterance figure into its host.
 * @param {Element} host a `[data-anim="utterance"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>} cleanup
 */
export async function init(host, { signal }) {
  const mode = host instanceof HTMLElement ? (host.dataset.mode ?? "both") : "both";
  const steps = readSteps(host, STEP_KEYS);
  const root = document.createElement("figure");
  root.className = "anim-figure anim-utterance";
  root.innerHTML = FIGURE_HTML;
  const titleEl = $(root, ".anim-figure__title", HTMLElement);
  if (mode === "2d") {
    titleEl.textContent = "Magnifying a spoken sentence";
  } else if (mode === "3d") {
    titleEl.textContent = "Ten pitch periods stacked in 3D";
  }
  host.append(root);
  markEnhanced(host);

  const frame = $(root, ".anim-figure__frame", HTMLElement);
  const canvas = $(root, ".anim-figure__canvas", HTMLCanvasElement);
  const readoutBox = $(root, '[data-role="readout"]', HTMLElement);
  const windowOut = $(root, '[data-role="r-window"]', HTMLOutputElement);
  const periodsOut = $(root, '[data-role="r-periods"]', HTMLOutputElement);
  const captionEl = $(root, '[data-role="caption"]', HTMLElement);
  const playEl = $(root, '[data-role="play"]', HTMLButtonElement);
  const toggle = $(root, '[data-ref="view3d"]', HTMLButtonElement);
  const hint = $(root, ".anim-figure__hint--webgl", HTMLElement);
  const layoutGroup = $(root, '[data-role="layout"]', HTMLElement);
  const cameraGroup = $(root, '[data-role="camera"]', HTMLElement);
  $(root, '[data-badge="input"]', HTMLElement).append(badge("input"));
  $(root, '[data-badge="derived-input"]', HTMLElement).append(badge("derived-input"));
  if (mode === "2d" || mode === "3d") {
    readoutBox.hidden = true;
    toggle.hidden = true;
  }
  if (mode === "3d") {
    playEl.hidden = true;
  }
  /** @param {string} selector */
  const buttons = (selector) =>
    Array.from(root.querySelectorAll(selector)).filter((b) => b instanceof HTMLButtonElement);
  const windowButtons = buttons("[data-window]");
  const layoutButtons = buttons("[data-layout]");
  const presetButtons = buttons("[data-preset]");

  /** @type {{which: WindowId, layout: Layout, preset: string, playhead: number | null, face: Face, view: "2d" | "3d" | "parked"}} */
  const state = { which: "voiced", layout: "stacked", preset: "corner", playhead: null, face: "none", view: "2d" };

  const handle = setupCanvas(canvas, { onResize: () => render() });

  /** @type {Waveform} */
  let data;
  try {
    data = /** @type {Waveform} */ (await loadJSON(`assets/data/${CLIP}/waveform.json`, { signal }));
  } catch (err) {
    if (signal.aborted) return () => handle.destroy();
    frame.dataset.state = "error";
    windowOut.textContent = "could not load the waveform data";
    return () => handle.destroy();
  }
  // Left while the data loaded: the mount runs this cleanup at once.
  if (signal.aborted) return () => handle.destroy();
  frame.dataset.state = "ready";
  const d = data;
  /** @type {Closeup} */
  const vowel = /** @type {Closeup} */ (d.closeups.voiced);
  // The vowel's period cuts both windows: the fricative has none of its own.
  const periodSamples = SR / /** @type {number} */ (vowel.f0_hz);
  const periodMs = (1000 * periodSamples) / SR;

  /** @param {WindowId} which */
  const windowOf = (which) => d.closeups[which] || vowel;

  /** The closeup's plot area in the frame, as the 2D canvas lays it out. */
  const rect = () => {
    if (mode === "3d") {
      const W = frame.clientWidth;
      const H = frame.clientHeight;
      const padL = W < 560 ? 24 : 36;
      return {
        x: padL,
        y: 22,
        width: Math.max(1, W - padL - 20),
        height: Math.max(1, H - 56),
      };
    }
    const { bottom } = panels(frame.clientWidth, frame.clientHeight, d);
    const { x, y, width, height } = bottom.area;
    return { x, y, width, height };
  };

  /** @returns {UtteranceState} */
  const viewState = () => {
    const win = windowOf(state.which);
    const ms = (d.closeup_samples / SR) * 1000;
    return {
      which: state.which,
      layout: state.layout,
      preset: state.preset,
      wave: scaled(win),
      ms,
      sr: SR,
      periods: slicePeriods(win.samples, periodSamples),
      periodMs,
      marks: markers(win, ms).times,
      rect,
      front: (face) => {
        if (mode === "3d") return;
        if (face === state.face) return;
        state.face = face;
        render();
      },
    };
  };

  function render() {
    const win = windowOf(state.which);
    const g = handle.ctx;
    clearCanvas(g, handle);
    if (mode === "3d") {
      if (state.view !== "3d") {
        const ms = (d.closeup_samples / SR) * 1000;
        const padL = handle.width < 560 ? 32 : 46;
        const plot = createPlot(
          { width: handle.width, height: handle.height },
          { xDomain: [0, ms], yDomain: [-1, 1], padding: { top: 20, right: 14, bottom: 30, left: padL } }
        );
        drawCloseup(g, plot, win, ms, { wave: true });
      }
      describe();
      return;
    }
    const { top, bottom, ms } = panels(handle.width, handle.height, d);
    drawStrip(g, top, d, win, state.playhead);
    if (state.view === "3d") {
      // The 3D view is up and this canvas lies over it (anim.css): the
      // strip, and laid end to end at the front the closeup's frame.
      // Turned away, it fades out and the stack has the whole frame.
      if (state.face === "all") drawCloseup(g, bottom, win, ms, { wave: false });
    } else {
      drawCloseup(g, bottom, win, ms, { wave: true });
    }
    canvas.toggleAttribute("data-away", state.view === "3d" && state.face === "none");
    describe();
  }

  /** Readouts and caption: they follow the window and the view. */
  function describe() {
    const win = windowOf(state.which);
    windowOut.textContent = win.f0_hz
      ? `${win.start_s.toFixed(2)}s, repeating ${Math.round(win.f0_hz)} times a second`
      : `${win.start_s.toFixed(2)}s, no repeat rate the tracker will commit to`;
    const r = mean(neighbourCorrelation(slicePeriods(win.samples, periodSamples).slices));
    periodsOut.textContent = state.which === "voiced"
      ? `10 of ${periodMs.toFixed(2)} ms; each like the next (correlation ${r.toFixed(2)} on average)`
      : `cut at the vowel's ${periodMs.toFixed(2)} ms: no two alike (correlation ${r.toFixed(2)} on average)`;
    const text = (state.view === "3d" || mode === "3d") ? CAPTIONS_3D[state.which] : CAPTIONS[state.which];
    captionEl.innerHTML = `${text} ${SOURCE_NOTE}`;
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      canvas.setAttribute("aria-label", state.which === "voiced"
        ? "Top: the waveform envelope of a whole spoken sentence. Bottom: sixty milliseconds of it at full " +
          `sample resolution, a vowel: a train of pulses, one every ${periodMs.toFixed(2)} ms.`
        : "Top: the waveform envelope of a whole spoken sentence. Bottom: sixty milliseconds of it at full " +
          "sample resolution, a fricative: noise, with no pulse and no repeat rate.");
    }, 250);
  }
  let labelTimer = 0;

  // A sentence with no fricative in it gets no `unvoiced` window, which is the
  // honest outcome rather than a fabricated one. Disable the button instead of
  // silently showing the vowel under a "fricative" label.
  for (const el of windowButtons) {
    if (!d.closeups[/** @type {WindowId} */ (el.dataset.window)]) {
      el.disabled = true;
      el.title = "this sentence has no fricative loud enough to show";
    }
  }

  /**
   * @param {HTMLButtonElement[]} group
   * @param {string} key
   * @param {string} value
   */
  const press = (group, key, value) => {
    for (const b of group) b.setAttribute("aria-pressed", String(b.dataset[key] === value));
  };

  /**
   * The short description under the figure follows the window: the
   * chapter's data-caption for the vowel, data-caption-unvoiced for the
   * fricative (anim-core.js puts the first one there).
   * @param {WindowId} which
   */
  const describeWindow = (which) => {
    if (!(host instanceof HTMLElement)) return;
    const text = which === "unvoiced" ? host.dataset.captionUnvoiced : host.dataset.caption;
    const summary = root.querySelector(":scope > .anim-figure__summary");
    if (text && summary) summary.textContent = text;
  };

  /** @param {WindowId} which */
  const setWindow = (which) => {
    if (!d.closeups[which]) return;
    state.which = which;
    press(windowButtons, "window", which);
    describeWindow(which);
    views.update(viewState());
    render();
  };
  /** @param {Layout} layout */
  const setLayout = (layout) => {
    state.layout = layout;
    press(layoutButtons, "layout", layout);
    views.update(viewState());
  };
  /** @param {string} name */
  const setPreset = (name) => {
    state.preset = name;
    press(presetButtons, "preset", name);
    views.preset(name);
  };

  const views = createViewSwitch({
    frame,
    // In 3d-only mode, hide the 2D canvas once 3D is up; in combined mode,
    // keep the 2D canvas as the sentence-strip overlay.
    flat: mode === "3d" ? canvas : null,
    toggle,
    hint,
    signal,
    start: mode === "2d" ? "2d" : "auto",
    state: viewState,
    load: () => import("./anim-utterance-3d.js"),
    onView: (view) => {
      state.view = view;
      const live = view === "3d";
      canvas.classList.toggle("anim-utterance__over", live && mode !== "3d");
      if (live) canvas.setAttribute("aria-hidden", "true");
      else canvas.removeAttribute("aria-hidden");
      layoutGroup.hidden = !live;
      cameraGroup.hidden = !live;
      if (!live) state.face = "none";
      render();
    },
  });

  // Without WebGL 2 the switch disables the 3D control and shows the hint;
  // the control says why as well, for a pointer resting on it.
  if (!views.available()) toggle.title = NO_WEBGL_HINT;

  for (const el of windowButtons) {
    el.addEventListener("click", () => {
      if (!el.disabled) setWindow(/** @type {WindowId} */ (el.dataset.window));
    }, { signal });
  }
  for (const el of layoutButtons) {
    el.addEventListener("click", () => setLayout(/** @type {Layout} */ (el.dataset.layout)), { signal });
  }
  for (const el of presetButtons) {
    el.addEventListener("click", () => setPreset(el.dataset.preset ?? "corner"), { signal });
  }

  const player = createAudioPlayer({
    src: d.clip.original_audio,
    button: playEl,
    onFrame: (seconds) => {
      state.playhead = seconds;
      render();
    },
  });

  const offTheme = onThemeChange(() => render());

  if (TEST_HOOK) {
    TEST_HOOK.figures.utterance = { rect, state: () => ({ ...state, view: views.view() }) };
  }

  if (steps.length) {
    createStepper(root, steps, (s) => {
      const no3d = s.view === "2d";
      if (mode === "both") toggle.hidden = no3d;
      if (no3d) {
        views.show2D();
      } else if (s.view === "3d" && opensIn3D()) {
        // Under reduced motion a step is not a request for 3D; the 3D
        // control still loads it.
        void views.show3D();
      }
      // The camera first: a preset lands every running track, and the
      // fold the layout starts must run alongside the flight.
      if (s.preset) setPreset(s.preset);
      if (s.window === "voiced" || s.window === "unvoiced") setWindow(s.window);
      if (s.layout === "laid" || s.layout === "stacked") setLayout(s.layout);
    }, {
      signal,
      onFree: () => {
        if (mode === "both") toggle.hidden = false;
      },
    });
  }
  render();

  return () => {
    clearTimeout(labelTimer);
    player.destroy();
    offTheme();
    handle.destroy();
  };
}
