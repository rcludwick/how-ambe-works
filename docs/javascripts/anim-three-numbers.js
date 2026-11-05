// @ts-check
/* ===========================================================================
 * anim-three-numbers.js: amplitude, frequency, phase, one at a time.
 * ---------------------------------------------------------------------------
 * SLUG          three-numbers    <div data-anim="three-numbers"></div>
 *
 * DATA READ     none. Three sliders and a sine.
 *
 * CONTROLS      • amplitude, frequency and phase sliders
 *               • "Reset", which puts the wave back on the reference
 *               • "3D" and its camera presets (Corner, Front, Top)
 *
 * WHAT IT DRAWS One sinusoid, and behind it a fixed reference sinusoid at
 *               amplitude 1, frequency 1 and phase 0. Every slider moves the
 *               live wave off the reference in one specific way, and the
 *               reference stays put so the reader can see which way.
 *
 * WHY A REFERENCE
 *               Amplitude and frequency are legible from a single wave: taller
 *               is louder, more cycles is higher. Phase is not. A sinusoid
 *               shifted in time looks exactly like a sinusoid, because it is
 *               one. Phase only becomes visible as a relationship between two
 *               waves, so the figure draws two. That is also the honest
 *               preparation for chapter 04, where phase turns out to matter
 *               far less to the ear than the other two: the reader should
 *               already have noticed that the phase slider is the one whose
 *               effect is hardest to see.
 *
 * THE 3D VIEW   anim-three-numbers-3d.js, loaded by lib/view-switch.js. It
 *               lays out every phase of the live wave at once, with phase as
 *               depth (0 to 360 degrees, a slice every 15), and one straight
 *               line per crest: crest k sits at t = (1/4 + k - phi/2pi)/f, so
 *               a full turn moves it back by one period, 1/f, onto the place
 *               its neighbour started. That is how the wrap shows. Its Front
 *               preset is this canvas. It is a parameter sweep of a formula,
 *               nothing more. The 3D part takes its arrays from here and
 *               computes none of its own.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  clearCanvas,
  createPlot,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  markEnhanced,
  onThemeChange,
  setupCanvas,
} from "./anim-core.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "three-numbers";

/** Cycles of the reference wave across the panel. */
export const SPAN = 3;
/** Segments per wave: POINTS + 1 samples from t = 0 to SPAN. */
export const POINTS = 720;
const TAU = Math.PI * 2;
/** The wave value the panel shows, bottom to top. */
export const Y_DOMAIN = /** @type {[number, number]} */ ([-1.6, 1.6]);
/** The 3D view's slices: one every PHASE_STEP degrees, 0 to 360. */
export const PHASE_STEP = 15;
export const SLICES = 360 / PHASE_STEP + 1;
/** Where the amplitude bar stands, in cycles of the reference. */
export const BAR_T = SPAN * 0.045;
/** The reference upward zero crossing the phase bracket measures from. */
const REF_T = 1;

/** @typedef {{amp: number, freq: number, phase: number}} WaveState  phase in radians */

/** @type {Readonly<WaveState>} */
export const DEFAULTS = Object.freeze({ amp: 1, freq: 1, phase: 0 });

/* --- the model: every array either view draws ---------------------------- */

/**
 * amp · sin(2π · freq · t + phase) at POINTS + 1 times from 0 to SPAN.
 * @param {number} amp
 * @param {number} freq  in multiples of the reference frequency
 * @param {number} phase radians
 * @returns {{x: number, y: number}[]}
 */
export function wave(amp, freq, phase) {
  const pts = [];
  for (let i = 0; i <= POINTS; i += 1) {
    const t = (i / POINTS) * SPAN;
    pts.push({ x: t, y: amp * Math.sin(TAU * freq * t + phase) });
  }
  return pts;
}

/**
 * One period of the live wave, in cycles of the reference: 1/f. One full
 * turn of phase moves the wave by exactly this much.
 * @param {number} freq
 * @returns {number}
 */
export const period = (freq) => 1 / freq;

/**
 * How far a phase moves the wave along time, in cycles of the reference
 * (earlier, to the left): (phase / 2π) / f.
 * @param {number} freq
 * @param {number} phase radians
 * @returns {number}
 */
export const shiftCycles = (freq, phase) => phase / TAU / freq;

/**
 * The phase bracket: from the reference's upward zero crossing at t = 1 to
 * the live wave's nearest upward crossing, or null when they coincide or
 * the crossing leaves the panel.
 *
 * The live wave crosses upward wherever 2π·freq·t + phase is a multiple
 * of 2π, so at t = (k - turns) / freq. Take whichever k lands nearest the
 * reference crossing at t = 1, so the marker stays in the middle of the
 * panel instead of running off the left edge at large phase.
 * @param {number} freq
 * @param {number} phase radians
 * @returns {{refT: number, liveT: number} | null}
 */
export function bracket(freq, phase) {
  const turnsNow = phase / TAU;
  const k = Math.round(REF_T * freq + turnsNow);
  const liveT = (k - turnsNow) / freq;
  if (Math.abs(liveT - REF_T) > 1e-4 && liveT >= 0 && liveT <= SPAN) return { refT: REF_T, liveT };
  return null;
}

/**
 * The crest lines of the 3D view: crest k sits at t = (1/4 + k - p/360)/f
 * for phase p in degrees, a straight line in (t, p). Each is clipped to t in
 * [0, SPAN] and p in [0, 360]. They are parallel, 1/f apart along t, and
 * each ends at 360 degrees where its neighbour started at 0.
 * @param {number} freq
 * @returns {{k: number, t0: number, p0: number, t1: number, p1: number}[]}  p in degrees, p0 < p1
 */
export function crestLines(freq) {
  const out = [];
  const at = (/** @type {number} */ k, /** @type {number} */ p) => (0.25 + k - p / 360) / freq;
  for (let k = 0; k <= Math.ceil(SPAN * freq + 0.75); k += 1) {
    const p0 = Math.max(0, 360 * (0.25 + k - SPAN * freq));
    const p1 = Math.min(360, 360 * (0.25 + k));
    if (p1 - p0 < 1e-9) continue;
    out.push({ k, t0: at(k, p0), p0, t1: at(k, p1), p1 });
  }
  return out;
}

/**
 * The live wave at every phase from 0 to 360 degrees, a slice every
 * PHASE_STEP: SLICES waves of POINTS + 1 points each.
 * @param {number} amp
 * @param {number} freq
 * @returns {{degrees: number, points: {x: number, y: number}[]}[]}
 */
export function slices(amp, freq) {
  return Array.from({ length: SLICES }, (_, s) => {
    const degrees = s * PHASE_STEP;
    return { degrees, points: wave(amp, freq, (degrees / 360) * TAU) };
  });
}

/**
 * The 2D plot's padding at a frame width; the 3D view's Front preset fits
 * the same rectangle (lib/orbit.js matchPlot).
 * @param {number} width CSS px
 */
const padding = (width) => ({ top: 14, right: 16, bottom: 30, left: width < 560 ? 30 : 40 });

/**
 * The 2D plot's area in a frame of this size, CSS px.
 * @param {number} width
 * @param {number} height
 * @returns {import("./lib/orbit.js").PlotRect}
 */
export function plotRect(width, height) {
  const { area } = createPlot({ width, height }, { xDomain: [0, SPAN], yDomain: Y_DOMAIN, padding: padding(width) });
  return { x: area.x, y: yArea(area), width: area.width, height: area.height };
}

/** @param {{y: number}} area */
function yArea(area) {
  return area.y;
}

/* --- markup -------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Amplitude frequency and phase of a sinusoid</p>
</div>

<div class="anim-figure__frame" data-state="ready">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="A sinusoid controlled by amplitude, frequency and phase sliders, drawn over a fixed reference sinusoid so that a phase shift is visible as a displacement between the two."></canvas>
</div>

<ul class="anim-legend">
  <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch is-data-1"></i>the wave you are changing</li>
  <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-tn__swatch--highlight"></i>the wave you are changing (thick, outlined)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--ghost"></i>the reference it started as</li>
  <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-tn__swatch--ramp"></i>the same wave at every phase, 15 degrees apart (thin, coloured by phase)</li>
  <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-tn__swatch--ink"></i>where each crest sits at each phase</li>
</ul>

<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Amplitude</span>
    <input class="anim-range" type="range" min="10" max="150" step="1" value="100"
           data-role="amp" aria-label="Amplitude, hundredths">
  </label>
  <label class="anim-field">
    <span class="anim-field__label">Frequency</span>
    <input class="anim-range" type="range" min="50" max="400" step="5" value="100"
           data-role="freq" aria-label="Frequency, as a percentage of the reference">
  </label>
  <label class="anim-field">
    <span class="anim-field__label">Phase</span>
    <input class="anim-range" type="range" min="0" max="360" step="1" value="0"
           data-role="phase" aria-label="Phase, in degrees">
  </label>
  <button class="anim-btn" type="button" data-role="reset">Reset</button>
</div>

<div class="anim-controls anim-tn__view">
  <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
  <div class="anim-toggle-group" role="group" aria-label="Camera" data-role="camera" hidden>
    <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
    <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
    <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>

<div class="anim-forms" data-role="readout" aria-live="polite" hidden>
  <p class="anim-forms__row"><span class="anim-forms__tag">this wave is</span>
    <code data-role="r-eq"></code></p>
  <p class="anim-forms__row" data-for="3d"><span class="anim-forms__tag">one turn of phase moves it</span>
    <code data-role="r-turn"></code></p>
</div>

<figcaption class="anim-figure__caption">
  Move each slider to compare the live wave against the fixed reference behind
  it. In 3D, depth shows every starting phase from 0 to 360 degrees at once.
  <span class="anim-figure__source">Synthetic sinusoid.</span>
</figcaption>
`;

/* --- module -------------------------------------------------------------- */

/**
 * Mount the three-numbers figure.
 * @param {Element} host a `[data-anim="three-numbers"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {() => void} cleanup
 */
export function init(host, { signal }) {
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-tn";
  figure.dataset.view = "2d";
  figure.innerHTML = FIGURE_HTML;
  const fallback = host.querySelector(":scope > .anim-fallback");
  if (fallback) fallback.after(figure);
  else host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const ampEl = $(figure, '[data-role="amp"]', HTMLInputElement);
  const freqEl = $(figure, '[data-role="freq"]', HTMLInputElement);
  const phaseEl = $(figure, '[data-role="phase"]', HTMLInputElement);
  const resetEl = $(figure, '[data-role="reset"]', HTMLButtonElement);
  const eqEl = $(figure, '[data-role="r-eq"]', HTMLElement);
  const turnEl = $(figure, '[data-role="r-turn"]', HTMLElement);
  const toggle = $(figure, '[data-view="3d"]', HTMLButtonElement);
  const camera = $(figure, '[data-role="camera"]', HTMLElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const presets = /** @type {HTMLButtonElement[]} */ ([...camera.querySelectorAll("[data-preset]")]);
  // Hidden until the view switch finds no WebGL 2 (lib/view-switch.js no3d()).
  hint.textContent = NO_WEBGL_HINT;

  /** @type {WaveState} */
  const state = { ...DEFAULTS };

  const handle = setupCanvas(canvas, { onResize: () => render() });

  function render() {
    const th = getTheme();
    const ctx = handle.ctx;
    clearCanvas(ctx, handle);

    const plot = createPlot(handle, {
      xDomain: [0, SPAN],
      yDomain: Y_DOMAIN,
      padding: padding(handle.width),
    });

    drawGrid(ctx, plot, { xTicks: [0, 1, 2, 3], yTicks: [-1, 0, 1] });
    drawAxes(ctx, plot, {
      xTicks: [0, 1, 2, 3],
      yTicks: [-1, 0, 1],
      formatX: (v) => String(v),
      formatY: (v) => String(v),
      xLabel: "time, in cycles of the reference",
    });

    ctx.save();
    plot.clip(ctx);
    drawPolyline(ctx, wave(DEFAULTS.amp, DEFAULTS.freq, DEFAULTS.phase), {
      plot,
      color: th.muted,
      width: 1.4,
      dash: [4, 4],
    });
    drawPolyline(ctx, wave(state.amp, state.freq, state.phase), {
      plot,
      color: th.series[0],
      width: 2.4,
    });

    // Amplitude, drawn as the thing it is: the height of the swing.
    const topY = plot.y(state.amp);
    const midY = plot.y(0);
    const ax = plot.x(BAR_T);
    ctx.strokeStyle = th.accentCool;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ax, midY);
    ctx.lineTo(ax, topY);
    ctx.stroke();

    // Phase, drawn as the gap between one upward zero crossing of the
    // reference and the nearest upward crossing of the live wave. This is the
    // only one of the three that needs two waves to be visible at all.
    const gap = bracket(state.freq, state.phase);
    let markerX = null;
    if (gap) {
      const y = plot.y(0);
      ctx.strokeStyle = th.accentWarm;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(plot.x(gap.refT), y);
      ctx.lineTo(plot.x(gap.liveT), y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const t of [gap.refT, gap.liveT]) {
        ctx.beginPath();
        ctx.moveTo(plot.x(t), y - 5);
        ctx.lineTo(plot.x(t), y + 5);
        ctx.stroke();
      }
      markerX = (plot.x(gap.refT) + plot.x(gap.liveT)) / 2;
    }
    ctx.restore();

    if (markerX !== null) {
      drawLabel(ctx, "phase", markerX, plot.y(0) + 9, {
        align: "center", baseline: "top", size: 11, color: th.accentWarm,
        background: th.plotBg, padding: 3,
      });
    }

    drawLabel(ctx, "amplitude", ax + 6, (topY + midY) / 2, {
      align: "left", baseline: "middle", size: 11, color: th.accentCool,
      background: th.plotBg, padding: 3,
    });
  }

  /** The readouts, from the state. */
  function readouts() {
    const turns = state.phase / TAU;
    eqEl.textContent =
      `${state.amp.toFixed(2)} · sin(2π · ${state.freq.toFixed(2)}f · t` +
      `${turns > 0.0005 ? ` + ${turns.toFixed(3)} turn` : ""})`;
    turnEl.textContent = `one period: ${period(state.freq).toFixed(3)} cycles of the reference`;
  }

  /** The 2D canvas's label, rebuilt 250 ms after the last change. */
  let labelTimer = 0;
  const describe = () => {
    window.clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      const degrees = Math.round((state.phase / TAU) * 360);
      canvas.setAttribute("aria-label",
        "A sinusoid controlled by amplitude, frequency and phase sliders, drawn over a fixed reference " +
        "sinusoid so that a phase shift is visible as a displacement between the two. " +
        `Now amplitude ${state.amp.toFixed(2)}, frequency ${state.freq.toFixed(2)} times the reference, ` +
        `phase ${degrees} degrees.`);
    }, 250);
  };

  /** @param {"2d" | "3d" | "parked"} view */
  const onView = (view) => {
    const live = view === "3d";
    figure.dataset.view = live ? "3d" : "2d";
    camera.hidden = !live;
    if (!live) render();
  };

  const switcher = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: () => ({ ...state }),
    load: () => import("./anim-three-numbers-3d.js"),
    onView,
    id: SLUG,
    onDrag: () => presets.forEach((b) => b.setAttribute("aria-pressed", "false")),
  });

  for (const button of presets) {
    button.addEventListener("click", () => {
      if (!switcher.preset(button.dataset.preset ?? "corner")) return;
      for (const b of presets) b.setAttribute("aria-pressed", String(b === button));
    }, { signal });
  }

  function sync() {
    state.amp = Number(ampEl.value) / 100;
    state.freq = Number(freqEl.value) / 100;
    state.phase = (Number(phaseEl.value) / 360) * TAU;
    render();
    readouts();
    describe();
    switcher.update({ ...state });
  }

  for (const el of [ampEl, freqEl, phaseEl]) {
    el.addEventListener("input", sync, { signal });
  }
  resetEl.addEventListener("click", () => {
    ampEl.value = "100";
    freqEl.value = "100";
    phaseEl.value = "0";
    sync();
  }, { signal });

  const offTheme = onThemeChange(() => render());
  sync();

  return () => {
    window.clearTimeout(labelTimer);
    offTheme();
    handle.destroy();
  };
}
