// @ts-check
/* ===========================================================================
 * anim-filter.js: push four shapes through a filter, and see which survives.
 * ---------------------------------------------------------------------------
 * SLUG          filter           <div data-anim="filter" markdown="1">, with
 *               a poster fallback and four steps (01-why-sinusoids.md)
 *
 * DATA READ     none. Every sample is synthesised and filtered in the
 *               browser (lib/filter.js). Nothing here is measured, and
 *               nothing is specific to speech or to AMBE.
 *
 * CONTROLS      four shapes; a cutoff slider, which moves the filter's
 *               resonance; "Rescale and realign". 2D only: its 3D view, a
 *               lane per harmonic in front of a gain wall, was removed on
 *               2026-10-19 because the wall did not read (Rob).
 *
 * WHAT IT DRAWS One plot: the shape going in (dashed) and the same shape
 *               after a two-pole resonant low-pass (thick), run as a
 *               difference equation over the samples.
 *
 * THE CLAIM     Chapter 01 argues that sinusoids are the only inputs a
 *               linear time-invariant filter cannot reshape: it may scale
 *               them and delay them, nothing else. "Rescale and realign"
 *               undoes exactly those two liberties, with the one gain and
 *               the one whole-sample shift that best match the output to the
 *               input. That rescaled, realigned output is the copy, and the
 *               figure draws the original minus the copy, labelled "signal
 *               filtered out". The sine lies on its
 *               input. The other three do not, because the filter gives each
 *               of their harmonics its own gain and its own delay, which the
 *               "each sine inside" readout shows.
 *
 * HONESTY       The sine's residual is not exactly zero. Its true delay
 *               falls between two samples, and the realignment moves by whole
 *               samples only, which leaves a fraction of a percent (0.48% at
 *               330 Hz, at most 0.98% over the slider). The readout says the
 *               number rather than claiming a clean zero.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
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
  TEST_HOOK,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { CYCLES, F0, PER_CYCLE, SHAPES, align, harmonic, laneResponse, run } from "./lib/filter.js";

const SLUG = "filter";

/** Keys a step may set (anim-steps.js). */
const STEP_KEYS = /** @type {const} */ (["shape", "aligned"]);

/** Harmonics the "each sine inside" readout looks at: 1 to 12, 150 to 1800 Hz. */
export const LANES = 12;

/** @type {Record<import("./lib/filter.js").Shape, string>} */
const LABELS = { sine: "Sine", square: "Square", triangle: "Triangle", sawtooth: "Sawtooth" };

/**
 * @typedef {Object} Lane
 * @property {number} k  harmonic number
 * @property {number} amp  its size going in (0: the shape has no such harmonic)
 * @property {number} gain  the filter's gain there
 * @property {number} delayMs  the filter's phase delay there
 */

/**
 * Everything the plot and readouts show, worked out once per change of
 * shape, cutoff or alignment.
 * @typedef {Object} Model
 * @property {import("./lib/filter.js").Shape} shape
 * @property {number} cutoff
 * @property {boolean} aligned
 * @property {number} extent  the shared y range is -extent to extent
 * @property {Float32Array} ts  drawn sample times, cycles
 * @property {Float32Array} input
 * @property {Float32Array} output  as drawn: rescaled and realigned when on
 * @property {Float32Array} residual  input minus output, when aligned
 * @property {import("./lib/filter.js").Fit} fit
 * @property {Lane[]} lanes  harmonics 1 to LANES
 */

/**
 * The model for a state.
 * @param {{shape: import("./lib/filter.js").Shape, cutoff: number, aligned: boolean}} s
 * @returns {Model}
 */
export function derive(s) {
  const { input, output, perCycle } = run(s.shape, s.cutoff);
  const fit = align(input, output, perCycle);
  let peak = 0;
  for (let i = 0; i < input.length; i += 1) peak = Math.max(peak, Math.abs(input[i]), Math.abs(output[i]));
  const n = input.length - perCycle;
  const ts = new Float32Array(n);
  const inp = new Float32Array(n);
  const out = new Float32Array(n);
  const residual = new Float32Array(n);
  const shift = s.aligned ? fit.shift : 0;
  const g = s.aligned ? fit.gain : 1;
  for (let i = 0; i < n; i += 1) {
    ts[i] = i / perCycle;
    inp[i] = input[i];
    out[i] = g * output[i + shift];
    residual[i] = inp[i] - out[i];
  }
  /** @type {Lane[]} */
  const lanes = [];
  for (let k = 1; k <= LANES; k += 1) {
    const { gain, delayMs } = laneResponse(k, s.cutoff);
    lanes.push({ k, amp: Math.abs(harmonic(s.shape, k)), gain, delayMs });
  }
  return {
    shape: s.shape, cutoff: s.cutoff, aligned: s.aligned, extent: (peak || 1) * 1.12,
    ts, input: inp, output: out, residual, fit, lanes,
  };
}

/**
 * The plot the canvas draws in.
 * @param {{width: number, height: number}} size
 * @param {number} extent
 * @returns {import("./anim-core.js").Plot}
 */
export function layout(size, extent) {
  const narrow = size.width < 560;
  return createPlot(size, {
    xDomain: [0, CYCLES],
    yDomain: [-extent, extent],
    padding: { top: 30, right: 14, bottom: 30, left: narrow ? 30 : 42 },
  });
}

/**
 * The names of the two lines over the plot. A narrow plot gets the short
 * form, so the two never meet.
 * @param {boolean} aligned
 * @param {boolean} narrow
 * @returns {[string, string]}
 */
export function lineLabels(aligned, narrow) {
  return ["going in (dashed)", aligned ? (narrow ? "out, realigned" : "coming out, rescaled and realigned") : "coming out"];
}

/** @param {number} x @param {number} digits */
const fixed = (x, digits) => x.toFixed(digits);

/**
 * The fit as the filter's own gain and delay, for the readouts.
 * @param {Model} m
 */
function did(m) {
  const own = 1 / m.fit.gain;
  const cycles = m.fit.shift / PER_CYCLE;
  const ms = (cycles / F0) * 1000;
  const sign = own < 0 ? " and inverted" : "";
  return `cutoff ${m.cutoff} Hz · scaled by ×${fixed(Math.abs(own), 3)}${sign} · delayed by ${fixed(cycles, 3)} cycle (${fixed(ms, 2)} ms)`;
}

/** @param {Lane} lane */
const laneText = (lane) => `${lane.k * F0} Hz ×${fixed(lane.gain, 2)}, ${fixed(lane.delayMs, 2)} ms`;

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Wave shapes passing through a low-pass filter</p>
</div>

<div class="anim-figure__frame">
  <canvas class="anim-figure__canvas" role="img" aria-label="A sine wave going into a filter and coming out."></canvas>
</div>

<div class="anim-figure__step"></div>

<ul class="anim-legend filter-legend">
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--dashed filter-swatch--muted"></i>going in (dashed)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line filter-swatch--ink"></i>coming out (thick)</li>
  <li class="anim-legend__item" data-for="aligned"><i class="anim-legend__swatch anim-legend__swatch--line filter-swatch--warm"></i>signal filtered out</li>
</ul>

<div class="anim-controls">
  <div class="anim-toggle-group" role="group" aria-label="Input shape">
    ${SHAPES.map((s, i) => `<button class="anim-btn" type="button" data-shape="${s}" aria-pressed="${i === 0}">${LABELS[s]}</button>`).join("\n    ")}
  </div>
  <label class="anim-field">
    <span class="anim-field__label">Cutoff</span>
    <input class="anim-range" type="range" min="120" max="1600" step="10" value="330"
           data-role="cutoff" aria-label="Filter cutoff frequency in hertz">
    <output class="anim-readout" data-role="cutoff-value">330 Hz</output>
  </label>
  <button class="anim-btn" type="button" data-role="align" aria-pressed="false">Rescale and realign</button>
</div>

<div class="anim-forms filter-readouts" data-role="readouts">
  <p class="anim-forms__row"><span class="anim-forms__tag">filter did</span>
    <output aria-live="polite" data-role="r-what"></output></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">each sine inside</span>
    <output aria-live="polite" data-role="r-lanes"></output></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">signal filtered out</span>
    <output aria-live="polite" data-role="r-residual"></output></p>
</div>

<figcaption class="anim-figure__caption">
  <span>The input is fixed at ${F0}&nbsp;Hz. The slider moves the filter cutoff.</span>
  <span class="filter-badges"><span data-badge="synthetic"></span></span>
  <span class="anim-figure__source">Two-pole resonant low-pass filter (Q&nbsp;4).</span>
</figcaption>
`;

/**
 * Mount the filter figure into its host.
 * @param {Element} host a `[data-anim="filter"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const root = document.createElement("figure");
  root.className = "anim-figure anim-figure--filter";
  root.innerHTML = FIGURE_HTML;
  host.append(root);
  markEnhanced(host);

  const frame = $(root, ".anim-figure__frame", HTMLElement);
  const canvas = $(root, "canvas", HTMLCanvasElement);
  const cutoffEl = $(root, '[data-role="cutoff"]', HTMLInputElement);
  const cutoffOut = $(root, '[data-role="cutoff-value"]', HTMLOutputElement);
  const alignEl = $(root, '[data-role="align"]', HTMLButtonElement);
  const whatEl = $(root, '[data-role="r-what"]', HTMLOutputElement);
  const lanesEl = $(root, '[data-role="r-lanes"]', HTMLOutputElement);
  const residEl = $(root, '[data-role="r-residual"]', HTMLOutputElement);
  const shapeEls = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll("button[data-shape]")]);
  const legendAligned = $(root, '[data-for="aligned"]', HTMLElement);
  $(root, '[data-badge="synthetic"]', HTMLElement).append(badge("synthetic"));

  /** @type {{shape: import("./lib/filter.js").Shape, cutoff: number, aligned: boolean}} */
  const state = { shape: "sine", cutoff: 330, aligned: false };
  for (const el of shapeEls) el.setAttribute("aria-pressed", String(el.dataset.shape === state.shape));
  alignEl.setAttribute("aria-pressed", String(state.aligned));
  let model = derive(state);
  /** The two line labels' left and right edges, px, as last drawn. */
  let labelBoxes = [[0, 0], [0, 0]];
  const handle = setupCanvas(canvas, { onResize: () => render() });

  /** Repaint the 2D plot. */
  function render() {
    const m = model;
    const th = getTheme();
    const ctx = handle.ctx;
    clearCanvas(ctx, handle);
    const plot = layout(handle, m.extent);
    const xTicks = [0, 1, 2, 3];
    drawGrid(ctx, plot, { xTicks, yTicks: [0] });
    drawAxes(ctx, plot, { xTicks, yTicks: [], formatX: (v) => `${v}`, xLabel: "cycles" });
    /** @param {Float32Array} ys */
    const series = (ys) => Array.from(ys, (y, i) => ({ x: m.ts[i], y }));
    ctx.save();
    plot.clip(ctx);
    drawPolyline(ctx, series(m.input), { plot, color: th.muted, width: 1.8, dash: [5, 4] });
    if (m.aligned) drawPolyline(ctx, series(m.residual), { plot, color: th.accentWarm, width: 1.6 });
    drawPolyline(ctx, series(m.output), { plot, color: th.ink, width: 2.4 });
    ctx.restore();
    const label = { baseline: /** @type {const} */ ("top"), size: 11, background: th.plotBg, padding: 3 };
    const [inText, outText] = lineLabels(m.aligned, handle.width < 560);
    const a = drawLabel(ctx, inText, plot.area.left + 6, 6, { ...label, align: "left", color: th.text3 });
    const b = drawLabel(ctx, outText, plot.area.right - 6, 6, { ...label, align: "right", color: th.ink });
    // Each box with its 3 px of padding, for the test that they never meet.
    labelBoxes = [[plot.area.left + 3, plot.area.left + 9 + a.width], [plot.area.right - 9 - b.width, plot.area.right - 3]];
  }

  function readouts() {
    const m = model;
    whatEl.textContent = did(m);
    const present = m.lanes.filter((l) => l.amp > 0);
    const shown = present.slice(0, 4).map(laneText).join(" · ");
    lanesEl.textContent = present.length === 1
      ? `one sine, ${laneText(present[0])}`
      : `${shown} · and ${present.length > 4 ? "more" : "no more"} below ${LANES * F0} Hz`;
    const pct = m.fit.pct;
    residEl.textContent = pct < 1
      ? `${fixed(pct, 2)}% of the original. The shape survived.`
      : `${fixed(pct, 1)}% of the original. The shape did not survive.`;
    residEl.dataset.verdict = pct < 1 ? "survived" : "reshaped";
    legendAligned.hidden = !m.aligned;
    cutoffOut.textContent = `${m.cutoff} Hz`;
  }

  /** The 2D canvas's label, from the state. */
  const describe2D = () => {
    const m = model;
    const shape = LABELS[m.shape].toLowerCase();
    const left = m.aligned
      ? ` The signal filtered out, the original minus its rescaled copy, is ${fixed(m.fit.pct, m.fit.pct < 1 ? 2 : 1)}% of the original.`
      : "";
    return `A ${shape} wave at ${F0} Hz going into a low-pass filter with its cutoff at ${m.cutoff} Hz, drawn dashed, and coming out, drawn thick, over ${CYCLES} cycles.${left}`;
  };
  let labelTimer = 0;
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => canvas.setAttribute("aria-label", describe2D()), 250);
  };

  /** @param {boolean} recompute */
  const refresh = (recompute) => {
    if (recompute) model = derive(state);
    render();
    readouts();
    relabel();
  };

  /**
   * The short description under the figure follows the shape: the
   * chapter's data-caption for the sine, data-caption-reshaped for the
   * others, with {shape} standing for the shape's name.
   * @param {import("./lib/filter.js").Shape} shape
   */
  const describeShape = (shape) => {
    if (!(host instanceof HTMLElement)) return;
    const text = shape === "sine" ? host.dataset.caption : host.dataset.captionReshaped;
    const summary = root.querySelector(":scope > .anim-figure__summary");
    if (text && summary) summary.textContent = text.replace("{shape}", LABELS[shape].toLowerCase());
  };

  /** @param {import("./lib/filter.js").Shape} shape */
  const setShape = (shape) => {
    state.shape = shape;
    for (const el of shapeEls) el.setAttribute("aria-pressed", String(el.dataset.shape === shape));
    describeShape(shape);
  };
  /** @param {boolean} on */
  const setAligned = (on) => {
    state.aligned = on;
    alignEl.setAttribute("aria-pressed", String(on));
  };

  for (const el of shapeEls) {
    el.addEventListener("click", () => {
      setShape(/** @type {import("./lib/filter.js").Shape} */ (el.dataset.shape));
      refresh(true);
    }, { signal });
  }
  cutoffEl.addEventListener("input", () => {
    state.cutoff = Number(cutoffEl.value);
    refresh(true);
  }, { signal });
  alignEl.addEventListener("click", () => {
    setAligned(!state.aligned);
    refresh(true);
  }, { signal });

  /** @param {Record<string, string>} step */
  const applyStep = (step) => {
    if (step.shape && /** @type {readonly string[]} */ (SHAPES).includes(step.shape)) {
      setShape(/** @type {import("./lib/filter.js").Shape} */ (step.shape));
    }
    if (step.aligned) setAligned(step.aligned === "on");
    refresh(true);
  };

  const offTheme = onThemeChange(() => render());
  refresh(true);
  if (steps.length) createStepper(root, steps, applyStep, { signal });

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = {
      model: () => model,
      plot: () => layout({ width: frame.clientWidth, height: frame.clientHeight }, model.extent).area,
      labelBoxes: () => labelBoxes,
    };
  }

  return () => {
    offTheme();
    clearTimeout(labelTimer);
    handle.destroy();
    if (TEST_HOOK) delete TEST_HOOK.figures[SLUG];
  };
}
