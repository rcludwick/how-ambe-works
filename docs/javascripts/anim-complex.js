// @ts-check
/* ===========================================================================
 * anim-complex.js: one point, written three ways, and the wave it traces.
 * ---------------------------------------------------------------------------
 * SLUG          complex          <div data-anim="complex"></div>
 *
 * DATA READ     none. Every number here is computed from the reader's own
 *               dragging. There is nothing measured to load.
 *
 * CONTROLS      drag anywhere in the circle panel to move the point; radius
 *               and angle sliders, which are the same point; "Spin" runs the
 *               angle forward so the wave panel draws; the 3D control and,
 *               in 3D, the Camera presets and the Zoom group.
 *
 * WHAT IT DRAWS The circle panel (left, or on top in a narrow frame): a
 *               plane with one point on it, labelled simultaneously as a
 *               pair (x, y), as a length and a turn (r, θ), and as a complex
 *               number r·e^(iθ) = x + iy. Those are three names for one thing,
 *               which is the whole content of the figure: the complex plane
 *               is the plane the reader already had, with a second name for
 *               its points.
 *
 *               The wave panel (right, or below): the horizontal projection
 *               of that point as the angle advances. A point going round at a steady rate projects to a
 *               cosine. That is why the DFT probes with e^(-iωn) rather than
 *               with a sine and a cosine separately: one rotating point
 *               carries both, and its angle is the phase.
 *
 *               3D (anim-complex-3d.js, loaded only when 3D is wanted): the
 *               turns become depth, so the point's path is a helix, with its
 *               shadow on the floor (x, the cosine) and on the back wall (y,
 *               the sine). Seen end on it is the circle panel; seen from above
 *               it is the wave panel.
 *
 * ONE PHASE     The angle at time t (in turns) is phi(t) = θ - 2π(head - t),
 *               where θ is the angle now and head is how far the point has
 *               turned since it was last set. Every curve here, 2D and 3D,
 *               comes from helix() below, so the trace always lies on the
 *               dashed path and the two views never disagree.
 *
 * NOT A CODEC   No AMBE anywhere near this. It is the definition of polar form
 *               and Euler's identity, drawn. Chapter 02 uses it to introduce
 *               the complex exponential before the DFT sum needs it.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  clearCanvas,
  createLoop,
  createPlot,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  markEnhanced,
  NO_WEBGL_HINT,
  onThemeChange,
  opensIn3D,
  prefersReducedMotion,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { createViewSwitch } from "./lib/view-switch.js";

/** The plane is drawn on [-1.35, 1.35] so a unit circle sits comfortably in it. */
export const EXTENT = 1.35;

/** How many turns of history the wave panel keeps. */
export const WAVE_TURNS = 2;
export const WAVE_POINTS = 480;

/** Radians per second while spinning. Slow enough to follow by eye. */
const SPIN_RATE = Math.PI / 2.4;

export const TAU = Math.PI * 2;

const STEP_KEYS = /** @type {const} */ (["view", "preset", "r", "theta", "spin"]);

/** The Camera presets of the 3D view, in button order. */
export const PRESET_NAMES = /** @type {const} */ (["end", "real", "imag", "corner"]);
/** @typedef {typeof PRESET_NAMES[number]} PresetName */

/**
 * @typedef {Object} ComplexState
 * @property {number} r  radius
 * @property {number} theta  the angle now, radians
 * @property {number} head  turns since the point was last set, 0 to WAVE_TURNS
 * @property {number} tail  where the traced part starts, 0 to head
 * @property {boolean} spinning
 * @property {PresetName} preset  the 3D view's camera preset
 * @property {number} sweeps  counts the steps that trace two turns; the 3D
 *           view draws the helix out again when it changes
 */

/**
 * @param {number} v
 * @param {number} [places=2]
 */
function fmt(v, places = 2) {
  const s = v.toFixed(places);
  return s === "-0.00" ? "0.00" : s;
}

/**
 * An angle normalised to [0, 2π), for the readouts.
 * @param {number} angle
 */
export function wrap(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

/**
 * The angle, in whole degrees from 0 to 359, that the readouts and the
 * chip show.
 * @param {number} theta
 */
export function degrees(theta) {
  return Math.round((wrap(theta) * 180) / Math.PI) % 360;
}

/**
 * The point's path: n + 1 samples from turn `from` to turn `to`, each with
 * its time t (turns), real part and imaginary part, on the one phase
 * phi(t) = θ - 2π(head - t). The 2D wave panel draws the real parts; the
 * 3D view places all three.
 * @param {{r: number, theta: number, head: number}} s
 * @param {number} from
 * @param {number} to
 * @param {number} n
 * @returns {{t: Float64Array, re: Float64Array, im: Float64Array}}
 */
export function helix(s, from, to, n) {
  const t = new Float64Array(n + 1);
  const re = new Float64Array(n + 1);
  const im = new Float64Array(n + 1);
  for (let i = 0; i <= n; i += 1) {
    // Written as the 2D figure always wrote it, so the dashed path at
    // head = 0 is the same curve to the last bit.
    const at = from === 0 && to === WAVE_TURNS ? (i / n) * WAVE_TURNS : from + ((to - from) * i) / n;
    const phi = s.theta - TAU * (s.head - at);
    t[i] = at;
    re[i] = s.r * Math.cos(phi);
    im[i] = s.r * Math.sin(phi);
  }
  return { t, re, im };
}

/**
 * The whole dashed path, 0 to WAVE_TURNS, and the traced part, tail to head
 * (empty when nothing has been traced).
 * @param {ComplexState} s
 */
export function curves(s) {
  const ideal = helix(s, 0, WAVE_TURNS, WAVE_POINTS);
  const span = s.head - s.tail;
  const trace = span > 1e-9 ? helix(s, s.tail, s.head, Math.max(2, Math.ceil((span / WAVE_TURNS) * WAVE_POINTS))) : null;
  return { ideal, trace };
}

/**
 * The two 2D panels for a canvas of W x H CSS px: the square plane on the
 * left (on top on a phone) and the wave on the right (below). The 3D
 * view's End on preset puts the plane on `plane.area`, and its Real part
 * preset the wave on `wave.area`.
 * @param {number} W
 * @param {number} H
 */
export function layout(W, H) {
  const stacked = W < 620;
  const pad = stacked ? 10 : 16;

  // THE PLANE MUST BE SQUARE. Both axes carry the same units, so a plot area
  // that is wider than it is tall draws the unit circle as an ellipse and
  // makes r look like something other than a length. That is fatal here:
  // the figure's whole claim is that (x, y) and (r, θ) describe one point.
  // So fit the largest square that fits the space and centre it, rather than
  // letting the padding decide the shape.
  const axisL = stacked ? 30 : 40;
  const capT = stacked ? 8 : 14;
  const capB = stacked ? 26 : 28;
  const boxW = (stacked ? W : Math.min(H * 1.02, W * 0.46)) - axisL - pad;
  const boxH = (stacked ? H * 0.5 : H) - capT - capB;
  const size = Math.max(40, Math.min(boxW, boxH));

  const left = axisL + Math.max(0, (boxW - size) / 2);
  const top = capT + Math.max(0, (boxH - size) / 2);
  const plane = createPlot(
    { width: W, height: H },
    {
      xDomain: [-EXTENT, EXTENT],
      yDomain: [-EXTENT, EXTENT],
      padding: { top, right: W - left - size, bottom: H - top - size, left },
    }
  );

  // The wave panel has no such constraint: its axes are turns against
  // amplitude, which are not comparable, so it takes whatever is left.
  const wave = createPlot(
    { width: W, height: H },
    {
      xDomain: [0, WAVE_TURNS],
      yDomain: [-EXTENT, EXTENT],
      padding: stacked
        ? { top: H * 0.56, right: pad + 6, bottom: 26, left: 34 }
        : { top: capT, right: pad + 6, bottom: capB, left: left + size + 34 },
    }
  );

  return { W, H, stacked, plane, wave };
}

/** @typedef {ReturnType<typeof layout>} Layout */

/* --- markup ------------------------------------------------------------- */

const CAPTION = `
  Drag the point. The three lines underneath never disagree, because they are
  three ways of writing the same thing. The pair is what you measure off the
  axes. The length and turn is the same point in polar form, with
  <em>r</em> = √(x² + y²) and <em>θ</em> = atan2(y, x). The third line is
  Euler's identity, which says a turn of θ at radius r <em>is</em> the pair
  (r·cos θ, r·sin θ).
  Press <em>Spin</em> and watch the wave panel: a point going round at a steady
  rate projects to a cosine, and where it starts is the phase. In 3D the turns
  are laid out in depth, so the point's path is a helix: its shadow on the
  floor is x, the cosine, and its shadow on the back wall is y, the same wave
  a quarter turn later. One rotating
  point carries an amplitude and a phase at once, which is the reason the next
  chapter's transform probes with e<sup>−iωn</sup> instead of with a sine and a
  cosine separately.
  <span class="anim-figure__source">Definitions only. Nothing here is measured
  and nothing here is specific to AMBE.</span>`;

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Three ways to write one point on the complex plane</p>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 16 / 8">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="The circle panel: a plane carrying one point, shown as x and y coordinates, as a radius and angle, and as a complex number. The wave panel: the horizontal projection of that point plotted against angle, which traces a cosine."></canvas>
</div>

<div class="anim-figure__step"></div>

<ul class="anim-legend" data-ref="legend-2d">
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-1"></i>the point, and the radius drawn to it</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-2"></i>x, the horizontal part (the real axis)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-3"></i>y, the vertical part (the imaginary axis)</li>
</ul>
<ul class="anim-legend" data-ref="legend-3d" hidden>
  <li class="anim-legend__item"><i class="anim-complex__key anim-complex__key--point"></i>the point and its radius now (thick, outlined)</li>
  <li class="anim-legend__item"><i class="anim-complex__key anim-complex__key--turns"></i>its path through time, a helix, x + iy, violet to indigo by turn, oldest faintest</li>
  <li class="anim-legend__item"><i class="anim-complex__key anim-complex__key--path"></i>the path it is heading along (dashed)</li>
  <li class="anim-legend__item"><i class="anim-complex__key anim-complex__key--x"></i>x, its shadow on the floor, a cosine</li>
  <li class="anim-legend__item"><i class="anim-complex__key anim-complex__key--y"></i>y, its shadow on the back wall, a sine</li>
</ul>

<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Radius r</span>
    <input class="anim-range" type="range" min="0" max="130" step="1" value="100"
           data-role="radius" aria-label="Radius, hundredths">
  </label>
  <label class="anim-field">
    <span class="anim-field__label">Angle θ</span>
    <input class="anim-range" type="range" min="0" max="360" step="1" value="35"
           data-role="angle" aria-label="Angle in degrees">
  </label>
  <button class="anim-btn anim-btn--play" type="button" data-kind="motion" data-role="spin" aria-pressed="false">Spin</button>
  <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
  <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
    <button class="anim-btn" type="button" data-preset="end" aria-pressed="false">End on</button>
    <button class="anim-btn" type="button" data-preset="real" aria-pressed="false">Real part</button>
    <button class="anim-btn" type="button" data-preset="imag" aria-pressed="false">Imaginary part</button>
    <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>

<div class="anim-forms" data-role="forms" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">as a pair</span>
    <code data-role="f-rect"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">as length and turn</span>
    <code data-role="f-polar"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">as one complex number</span>
    <code data-role="f-euler"></code></p>
</div>

<figcaption class="anim-figure__caption"></figcaption>
`;

/* --- drawing (2D) --------------------------------------------------------- */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {Layout} geo
 * @param {ComplexState} state
 */
function drawPlane(ctx, th, geo, state) {
  const { plane, stacked } = geo;
  const { r, theta } = state;
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);

  drawGrid(ctx, plane, { xTicks: [-1, 0, 1], yTicks: [-1, 0, 1] });
  drawAxes(ctx, plane, {
    xTicks: [-1, 0, 1],
    yTicks: [-1, 1],
    formatX: (v) => String(v),
    formatY: (v) => (v === 1 ? "i" : v === -1 ? "-i" : String(v)),
    xLabel: stacked ? "real" : "real axis",
  });

  ctx.save();
  plane.clip(ctx);

  // Unit circle: the reference the angle is read against.
  const circle = [];
  for (let i = 0; i <= 180; i += 1) {
    const a = (i / 180) * TAU;
    circle.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  drawPolyline(ctx, circle, { plot: plane, color: th.border, width: 1, dash: [3, 4] });

  const ox = plane.x(0);
  const oy = plane.y(0);
  const px = plane.x(x);
  const py = plane.y(y);

  // The two components, drawn as the sides of the right triangle they are.
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = th.series[1];
  ctx.beginPath();
  ctx.moveTo(ox, py);
  ctx.lineTo(px, py);
  ctx.stroke();
  ctx.strokeStyle = th.series[2];
  ctx.beginPath();
  ctx.moveTo(px, oy);
  ctx.lineTo(px, py);
  ctx.stroke();
  ctx.setLineDash([]);

  // x along the real axis, y along the imaginary axis.
  ctx.lineWidth = 3;
  ctx.strokeStyle = th.series[1];
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(px, oy);
  ctx.stroke();
  ctx.strokeStyle = th.series[2];
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox, py);
  ctx.stroke();

  // The angle, as an arc from the real axis round to the radius.
  const arcR = Math.min(38, Math.max(20, Math.abs(px - ox) * 0.42 + 20));
  ctx.strokeStyle = th.accentWarm;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(ox, oy, arcR, 0, -wrap(theta), true);
  ctx.stroke();

  // The radius itself, and the point.
  ctx.strokeStyle = th.series[0];
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(px, py);
  ctx.stroke();

  ctx.fillStyle = th.series[0];
  ctx.beginPath();
  ctx.arc(px, py, 5.5, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Labels sit outside the clip so they are never half-eaten at the edge.
  drawLabel(ctx, `θ = ${fmt(wrap(theta) / TAU, 3)} turn`, ox + arcR + 6, oy - 6, {
    align: "left",
    baseline: "bottom",
    size: 11,
    color: th.accentWarm,
    background: th.plotBg,
    padding: 2,
  });
  drawLabel(ctx, `r = ${fmt(r)}`, (ox + px) / 2, (oy + py) / 2 - 8, {
    align: "center",
    baseline: "bottom",
    size: 11,
    weight: 600,
    color: th.series[0],
    background: th.plotBg,
    padding: 2,
  });
  if (Math.abs(x) > 0.12) {
    drawLabel(ctx, `x = ${fmt(x)}`, (ox + px) / 2, oy + 6, {
      align: "center",
      baseline: "top",
      size: 10,
      color: th.series[1],
      background: th.plotBg,
      padding: 2,
    });
  }
  if (Math.abs(y) > 0.12) {
    drawLabel(ctx, `y = ${fmt(y)}`, ox - 6, (oy + py) / 2, {
      align: "right",
      baseline: "middle",
      size: 10,
      color: th.series[2],
      background: th.plotBg,
      padding: 2,
    });
  }
}

/**
 * @param {Float64Array} t
 * @param {Float64Array} v
 */
const points = (t, v) => Array.from(t, (x, i) => ({ x, y: v[i] }));

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {Layout} geo
 * @param {ComplexState} state
 */
function drawWave(ctx, th, geo, state) {
  const { wave, stacked } = geo;
  // The Imaginary part preset draws y as well: the sine, a quarter turn
  // behind the cosine.
  const withY = state.preset === "imag";

  drawGrid(ctx, wave, { xTicks: [0.5, 1, 1.5], yTicks: [0] });
  drawAxes(ctx, wave, {
    xTicks: [0, 0.5, 1, 1.5, 2],
    yTicks: [],
    formatX: (v) => (v === 0 ? "0" : `${v}`),
    xLabel: stacked ? "turns" : "turns of the point",
  });

  ctx.save();
  wave.clip(ctx);

  // The cosine the current radius traces over two full turns, ending at
  // the point now. Drawn faint, as the shape the reader is heading towards.
  const { ideal, trace } = curves(state);
  drawPolyline(ctx, points(ideal.t, ideal.re), { plot: wave, color: th.muted, width: 1, dash: [3, 4] });
  if (withY) drawPolyline(ctx, points(ideal.t, ideal.im), { plot: wave, color: th.series[2], width: 1, dash: [3, 4] });

  // What the point has actually traced so far.
  if (trace) {
    const last = trace.t.length - 1;
    if (withY) {
      drawPolyline(ctx, points(trace.t, trace.im), { plot: wave, color: th.series[2], width: 2 });
      ctx.fillStyle = th.series[2];
      ctx.beginPath();
      ctx.arc(wave.x(trace.t[last]), wave.y(trace.im[last]), 4, 0, TAU);
      ctx.fill();
    }
    drawPolyline(ctx, points(trace.t, trace.re), { plot: wave, color: th.series[1], width: 2 });
    ctx.fillStyle = th.series[1];
    ctx.beginPath();
    ctx.arc(wave.x(trace.t[last]), wave.y(trace.re[last]), 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  drawLabel(
    ctx,
    stacked ? "x, as the point turns" : "x, plotted as the point turns",
    wave.area.left + 6,
    wave.area.top + 6,
    { align: "left", baseline: "top", size: 11, color: th.text3 }
  );
  if (withY) {
    drawLabel(ctx, "y, a quarter turn behind", wave.area.left + 6, wave.area.top + 22,
      { align: "left", baseline: "top", size: 11, color: th.series[2] });
  }
}

/**
 * The sentence for the 2D canvas's label.
 * @param {ComplexState} s
 */
function describe2D(s) {
  const x = s.r * Math.cos(s.theta);
  const y = s.r * Math.sin(s.theta);
  const traced = s.head - s.tail > 1e-9 ? `, ${fmt(s.head - s.tail)} turns traced` : "";
  return `The circle panel: one point at radius ${fmt(s.r)} and angle ${degrees(s.theta)} degrees, so x is ${fmt(x)} ` +
    `and y is ${fmt(y)}. The wave panel: x plotted against turns of the point, a cosine${traced}` +
    `${s.preset === "imag" ? ", with y beside it, the same wave a quarter turn later" : ""}.`;
}

/* --- module ------------------------------------------------------------- */

/**
 * Mount the complex-plane figure.
 * @param {Element} host a `[data-anim="complex"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-complex";
  figure.innerHTML = FIGURE_HTML;
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  caption.innerHTML = CAPTION;
  caption.append(" ", badge("illustrative"));
  host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const radiusEl = $(figure, '[data-role="radius"]', HTMLInputElement);
  const angleEl = $(figure, '[data-role="angle"]', HTMLInputElement);
  const spinEl = $(figure, '[data-role="spin"]', HTMLButtonElement);
  const toggle = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const camera = $(figure, '[data-ref="camera"]', HTMLElement);
  const legend2D = $(figure, '[data-ref="legend-2d"]', HTMLElement);
  const legend3D = $(figure, '[data-ref="legend-3d"]', HTMLElement);
  const reduced = prefersReducedMotion();

  /** @type {ComplexState} */
  const state = {
    r: 1.0,
    theta: (35 * Math.PI) / 180,
    // Opening in 3D, the figure draws the point's last two turns out as a
    // helix (its first-view animation), so the 2D view behind it holds the
    // same two turns. Opening in 2D, nothing is traced yet.
    head: opensIn3D() ? WAVE_TURNS : 0,
    tail: 0,
    spinning: false,
    preset: "corner",
    sweeps: 0,
  };

  const handle = setupCanvas(canvas, { onResize: () => render() });

  /* -- drawing ----------------------------------------------------------- */

  let labelTimer = 0;
  const describe = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      canvas.setAttribute("aria-label", describe2D(state));
    }, 250);
  };

  function render() {
    const th = getTheme();
    const ctx = handle.ctx;
    const geo = layout(handle.width, handle.height);

    // From the frame, not the canvas: in 3D the 2D canvas is hidden and
    // measures 1 px, which turned the frame portrait under the 3D view.
    const aspect = (frame.clientWidth || geo.W) < 620 ? "1 / 1.15" : "16 / 8";
    if (frame.style.getPropertyValue("--anim-aspect") !== aspect) {
      frame.style.setProperty("--anim-aspect", aspect);
    }

    clearCanvas(ctx, handle, th.plotBg);
    drawPlane(ctx, th, geo, state);
    drawWave(ctx, th, geo, state);
    updateForms();
    describe();
  }

  function updateForms() {
    const { r, theta } = state;
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    const t = wrap(theta);
    /** @param {string} role @param {string} text */
    const set = (role, text) => {
      const el = figure.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };
    set("f-rect", `(x, y)  =  (${fmt(x)}, ${fmt(y)})`);
    set("f-polar", `r = ${fmt(r)},  θ = ${fmt((t * 180) / Math.PI, 1)}°`);
    set(
      "f-euler",
      `${fmt(r)}·e^(i${fmt(t, 2)})  =  ${fmt(x)} ${y < 0 ? "−" : "+"} ${fmt(Math.abs(y))}i`
    );
  }

  /** Redraw both views from the state. */
  const changed = () => {
    render();
    views.update(state);
  };

  /* -- interaction ------------------------------------------------------- */

  function syncSliders() {
    const rv = String(Math.round(state.r * 100));
    if (radiusEl.value !== rv) radiusEl.value = rv;
    const av = String(degrees(state.theta));
    if (angleEl.value !== av) angleEl.value = av;
  }

  /** The point was set by hand: nothing has been traced since. */
  const restart = () => {
    state.head = 0;
    state.tail = 0;
  };

  /**
   * Advance the point, keeping WAVE_TURNS of history.
   * @param {number} turns
   */
  function advance(turns) {
    state.head += turns;
    // Slide the window rather than growing without bound.
    if (state.head > WAVE_TURNS) {
      state.tail = Math.max(0, state.tail - (state.head - WAVE_TURNS));
      state.head = WAVE_TURNS;
    }
  }

  const loop = createLoop(
    ({ dt }) => {
      if (!state.spinning) {
        loop.stop();
        return;
      }
      const step = Math.min(dt, 0.05);
      state.theta += SPIN_RATE * step;
      advance((SPIN_RATE * step) / TAU);
      syncSliders();
      changed();
    },
    { element: figure, autoplay: false }
  );

  /** @param {boolean} on */
  function setSpinning(on) {
    state.spinning = on && !reduced;
    spinEl.setAttribute("aria-pressed", state.spinning ? "true" : "false");
    spinEl.textContent = state.spinning ? "Pause" : "Spin";
    if (state.spinning) loop.start();
    else loop.stop();
  }

  /**
   * Move the point from a pointer position, in CSS pixels within the canvas.
   * @param {PointerEvent} event
   */
  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const { plane } = layout(handle.width, handle.height);
    if (cx > plane.area.right + 8) return false;
    // Invert the plot's own mapping rather than re-deriving the scale.
    const ux = ((cx - plane.area.left) / plane.area.width) * (EXTENT * 2) - EXTENT;
    const uy = EXTENT - ((cy - plane.area.top) / plane.area.height) * (EXTENT * 2);
    state.r = Math.min(Math.hypot(ux, uy), EXTENT);
    state.theta = Math.atan2(uy, ux);
    restart();
    syncSliders();
    changed();
    return true;
  }

  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => {
    if (!pointFromEvent(e)) return;
    dragging = true;
    setSpinning(false);
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, { signal });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) pointFromEvent(e);
  }, { signal });
  /** @param {PointerEvent} e */
  const onUp = (e) => {
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  canvas.addEventListener("pointerup", onUp, { signal });
  canvas.addEventListener("pointercancel", onUp, { signal });
  radiusEl.addEventListener("input", () => {
    state.r = Number(radiusEl.value) / 100;
    restart();
    changed();
  }, { signal });
  angleEl.addEventListener("input", () => {
    state.theta = (Number(angleEl.value) * Math.PI) / 180;
    restart();
    changed();
  }, { signal });
  spinEl.addEventListener("click", () => setSpinning(!state.spinning), { signal });
  const unsubscribeTheme = onThemeChange(() => render());

  if (reduced) {
    spinEl.disabled = true;
    spinEl.title = "Disabled because your system asks for reduced motion";
  }

  /* -- the 3D view ------------------------------------------------------- */

  /** @param {PresetName} name */
  const pressPreset = (name) => {
    for (const button of camera.querySelectorAll("[data-preset]")) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-preset") === name));
    }
  };

  /** @param {"2d" | "3d" | "parked"} view */
  const onView = (view) => {
    const live = view === "3d";
    camera.hidden = !live;
    legend3D.hidden = !live;
    legend2D.hidden = live;
    if (!live) render();
  };

  const views = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: () => state,
    load: () => import("./anim-complex-3d.js"),
    onView,
    id: "complex",
  });

  // The switch shows the hint beside a disabled control; the control's own
  // tooltip says the same.
  if (!views.available()) toggle.title = NO_WEBGL_HINT;

  for (const button of camera.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => {
      const name = /** @type {PresetName} */ (button.getAttribute("data-preset"));
      setPreset(name);
    }, { signal });
  }

  /** @param {PresetName} name */
  function setPreset(name) {
    state.preset = name;
    pressPreset(name);
    views.preset(name);
    render();
  }

  /**
   * One step's state.
   * @param {Record<string, string>} s
   */
  function apply(s) {
    if (s.r !== undefined || s.theta !== undefined) {
      const r = s.r !== undefined ? Number(s.r) : state.r;
      const theta = s.theta !== undefined ? (Number(s.theta) * Math.PI) / 180 : state.theta;
      if (Math.abs(r - state.r) > 1e-9 || degrees(theta) !== degrees(state.theta)) {
        setSpinning(false);
        state.r = r;
        state.theta = theta;
        restart();
      }
    }
    if (s.spin === "trace") {
      // The last two turns, ending at the angle now, drawn out at once (the
      // 3D view draws them out over its build time).
      setSpinning(false);
      state.head = WAVE_TURNS;
      state.tail = 0;
      state.sweeps += 1;
    } else if (s.spin === "off") {
      setSpinning(false);
    }
    syncSliders();
    if (s.preset && /** @type {readonly string[]} */ (PRESET_NAMES).includes(s.preset)) {
      setPreset(/** @type {PresetName} */ (s.preset));
    }
    if (s.view === "3d") void views.show3D();
    else if (s.view === "2d") views.show2D();
    changed();
  }

  syncSliders();
  pressPreset(state.preset);
  if (steps.length) createStepper(figure, steps, apply, { signal });
  else render();

  return () => {
    clearTimeout(labelTimer);
    unsubscribeTheme();
    loop.destroy();
    handle.destroy();
  };
}
