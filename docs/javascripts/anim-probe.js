// @ts-check
/* ===========================================================================
 * anim-probe.js: the chapter 2 test for one frequency, drawn while it runs.
 * ---------------------------------------------------------------------------
 * SLUG          probe            <div data-anim="probe"></div>
 *
 * DATA READ     none. The recording is a computed 200 Hz sine (lib/probe.js).
 *
 * CONTROLS      Test frequency and the recording's phase (sliders); the
 *               cosine test and the sweep (toggles); the 3D control and, in
 *               3D, the Camera presets and the Zoom group.
 *
 * WHAT IT DRAWS Three rows over the 160 samples: the recording with the test
 *               waves; the sine test's products (stems) with their running
 *               sum; the cosine test's, once it is on. Beside them, the plane
 *               of the two sums: the running sum walks from the centre to
 *               the point (sine sum, cosine sum), whose length is how much
 *               200 Hz there is and whose angle is the phase. Below, with
 *               the sweep on, the length at every test frequency from 0 to
 *               400 Hz: 80 at 200 Hz, exactly 0 at every other multiple of
 *               50 Hz, and not 0 between them.
 *
 *               3D (anim-probe-3d.js, loaded only when 3D is wanted): the
 *               samples run left to right; each sample's two products are
 *               one stem across, and the running sum is a path that ends on
 *               the plane point. Top is the sine row, Front the cosine row,
 *               End on the plane.
 *
 * NOT A CODEC   Generic DSP on a synthetic sine: the definition of one DFT
 *               bin, worked one sample at a time. Nothing AMBE-specific.
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
  NO_WEBGL_HINT,
  onThemeChange,
  opensIn3D,
  setupCanvas,
  supportsWebGL2,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { createViewSwitch } from "./lib/view-switch.js";
import { N, probe, radians, sweep } from "./lib/probe.js";

/** The plane's half extent, in sum units; the ring sits at 80. */
export const PLANE = 96;
/** The rows' half extent: products are at most 1 in size. */
export const ROW = 1.2;
/** Sums are drawn in the rows (and in 3D) divided by this, so 80 reaches 1. */
export const SCALE = 80;
/** The sweep strip's test frequencies, Hz. */
export const SWEEP_MAX = 400;

const STEP_KEYS = /** @type {const} */ (["view", "preset", "f", "phase", "cosine", "sweep"]);

/** The figure's state before any step: what a step leaves out starts here. */
const START = Object.freeze({ f: "200", phase: "0", cosine: "off", sweep: "off", preset: "corner" });

/**
 * Each step's full state: what a step leaves out carries forward from the
 * step before it (from START for the first), so a step reads the same
 * however it is reached, by Next, by Previous or after a slider moved.
 * The view is never carried: only a step that names one switches it.
 * @template {{state: Record<string, string>}} T
 * @param {T[]} steps
 * @returns {T[]}
 */
export function foldSteps(steps) {
  /** @type {Record<string, string>} */
  let carried = { ...START };
  for (const step of steps) {
    const { view, ...rest } = step.state;
    carried = { ...carried, ...rest };
    step.state = view === undefined ? { ...carried } : { ...carried, view };
  }
  return steps;
}

/** The Camera presets of the 3D view, in button order. */
export const PRESET_NAMES = /** @type {const} */ (["end", "top", "front", "corner"]);
/** @typedef {typeof PRESET_NAMES[number]} PresetName */

/**
 * @typedef {Object} ProbeState
 * @property {number} f  the test frequency, Hz
 * @property {number} phase  the recording's phase, degrees
 * @property {boolean} cosine  the cosine test is on
 * @property {boolean} sweep  the sweep strip is on
 * @property {PresetName} preset  the 3D view's camera preset
 * @property {number} morphs  counts the steps that changed the numbers; the
 *           3D view morphs to the new ones when it changes, and jumps when
 *           a slider moved them
 * @property {import("./lib/probe.js").Probe} data  both tests, from lib/probe.js
 */

/**
 * A number to two decimal places, with no "-0.00".
 * @param {number} v
 * @param {number} [places=1]
 */
export function fmt(v, places = 2) {
  const s = v.toFixed(places);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/**
 * The pair's angle in whole degrees, 0 to 359.
 * @param {number} a radians
 */
export const degrees = (a) => ((Math.round((a * 180) / Math.PI) % 360) + 360) % 360;

/**
 * The pair's length and angle as the readout shows them; a pair of length
 * 0 has no angle.
 * @param {import("./lib/probe.js").Probe} d
 */
export const polar = (d) => (d.length < 1e-6 ? "0.00, no angle" : `${fmt(d.length)} at ${degrees(d.angle)}°`);

/**
 * The sum the figure reports: the sine sum alone while the cosine test is
 * off, else the pair's length.
 * @param {ProbeState} s
 */
export const reported = (s) => (s.cosine ? s.data.length : s.data.sine);

/**
 * The chip's fact.
 * @param {ProbeState} s
 */
export const chipText = (s) => `sum: ${fmt(reported(s))}`;

/**
 * The 2D panels for a canvas of W x H CSS px: three rows over the samples
 * (the recording, the sine products, the cosine products) and the square
 * plane of the two sums, beside them (below them on a phone). The 3D
 * view's Top preset puts its sine products on rows[1].area, Front its
 * cosine products on rows[2].area, End on its sums on plane.area.
 * Figure 2.1 has no cosine test yet, so it asks for two rows.
 * @param {number} W
 * @param {number} H
 * @param {number} [count=3] how many rows: 2 leaves out the cosine row
 */
export function layout(W, H, count = 3) {
  const stacked = W < 480;
  const size = { width: W, height: H };
  const label = 16;
  const left = stacked ? 30 : 40;
  let rowsRight;
  let rowsBottom;
  /** @type {import("./anim-core.js").Plot} */
  let plane;
  if (stacked) {
    const side = Math.max(60, Math.min(W - 60, H * 0.42));
    const top = H - 30 - side;
    const x = (W - side) / 2 + 12;
    plane = createPlot(size, {
      xDomain: [-PLANE, PLANE],
      yDomain: [-PLANE, PLANE],
      padding: { top, left: x, right: W - x - side, bottom: H - top - side },
    });
    rowsRight = W - 10;
    rowsBottom = top - 44;
  } else {
    const top = 20;
    const side = Math.max(60, Math.min(H - top - 34, W * 0.37));
    const x = W - 16 - side;
    plane = createPlot(size, {
      xDomain: [-PLANE, PLANE],
      yDomain: [-PLANE, PLANE],
      padding: { top, left: x, right: W - x - side, bottom: H - top - side },
    });
    rowsRight = x - 46;
    rowsBottom = H - 28;
  }
  const rowTop = 4;
  const h = (rowsBottom - rowTop - count * label - (count - 1) * 6) / count;
  const rows = Array.from({ length: count }, (_, i) => {
    const top = rowTop + label + i * (label + h + 6);
    return createPlot(size, {
      xDomain: [0, N],
      yDomain: i === 0 ? [-1.3, 1.3] : [-ROW, ROW],
      padding: { top, left, right: W - rowsRight, bottom: H - top - h },
    });
  });
  return { W, H, stacked, rows, plane };
}

/** @typedef {ReturnType<typeof layout>} Layout */

/* --- markup ------------------------------------------------------------- */

const CAPTIONS = {
  sine:
    "Multiply the 200 Hz recording (solid) by a test sine wave (dashed) sample by sample. " +
    "At 200 Hz and 0° phase the products stay positive and the running sum climbs to 80; shift the phase to 90° and the sine test alone sums to 0.",
  cosine:
    "Running both a sine test and a cosine test produces a 3D running-sum path that lands on the radius-80 circle at every recording phase.",
  sweep:
    "Sweeping the combined sine-and-cosine test across 0 to 400 Hz: a 20 ms (160-sample) block reaches 80 at 200 Hz and hits 0 at every other multiple of 50 Hz.",
  both:
    "A 200 Hz recording (160 samples, 20 ms at 8 kHz) tested by multiplying and summing against sine and cosine test waves.",
};

const SOURCE_NOTE = `<span class="anim-figure__source">Synthetic 200 Hz sine wave (160 samples at 8 kHz).</span>`;

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Detecting a target frequency by multiplication and summing</p>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 16 / 10">
  <canvas class="anim-figure__canvas" role="img" aria-label="The probe figure."></canvas>
</div>

<div class="anim-probe__strip" data-ref="strip" hidden>
  <canvas class="anim-figure__canvas" role="img" data-ref="strip-canvas"
          aria-label="The length of the sum at every test frequency."></canvas>
</div>

<div class="anim-figure__step"></div>

<ul class="anim-legend" data-ref="legend-2d">
  <li class="anim-legend__item"><i class="anim-probe__key anim-probe__key--signal"></i>the recording (solid)</li>
  <li class="anim-legend__item"><i class="anim-probe__key anim-probe__key--sine"></i>sine test (dashed)</li>
  <li class="anim-legend__item" data-ref="key-cosine"><i class="anim-probe__key anim-probe__key--cosine"></i>cosine test (dashed)</li>
  <li class="anim-legend__item"><i class="anim-probe__key anim-probe__key--stems"></i>one product per sample (stems), first sample darkest</li>
  <li class="anim-legend__item"><i class="anim-probe__key anim-probe__key--sum"></i>the running sum, divided by 80 in the rows, and where it ends (thick)</li>
</ul>
<ul class="anim-legend" data-ref="legend-3d" hidden>
  <li class="anim-legend__item"><i class="anim-probe__key anim-probe__key--stems"></i>each sample's two products, one stem across, first sample darkest</li>
  <li class="anim-legend__item"><i class="anim-probe__key anim-probe__key--sum"></i>the running sum, divided by 80 (thick, glowing)</li>
  <li class="anim-legend__item"><i class="anim-probe__key anim-probe__key--ring"></i>the plane of the two sums, ring at 80 (dashed)</li>
</ul>

<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Test frequency</span>
    <input class="anim-range" type="range" min="50" max="400" step="25" value="200"
           data-role="freq" aria-label="Test frequency in hertz">
    <output class="anim-readout" data-role="freq-out">200 Hz</output>
  </label>
  <label class="anim-field">
    <span class="anim-field__label">Recording's phase</span>
    <input class="anim-range" type="range" min="0" max="345" step="15" value="0"
           data-role="phase" aria-label="Phase of the recording in degrees">
    <output class="anim-readout" data-role="phase-out">0°</output>
  </label>
  <button class="anim-btn" type="button" data-role="cosine" aria-pressed="false">Cosine test</button>
  <button class="anim-btn" type="button" data-role="sweep" aria-pressed="false">Sweep</button>
  <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
  <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
    <button class="anim-btn" type="button" data-preset="end" aria-pressed="false">End on</button>
    <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
    <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
    <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>

<output class="anim-forms" data-role="forms" aria-live="polite" hidden>
  <span class="anim-forms__row"><span class="anim-forms__tag">sine test sum</span>
    <code data-role="f-sine"></code></span>
  <span class="anim-forms__row"><span class="anim-forms__tag">cosine test sum</span>
    <code data-role="f-cosine"></code></span>
  <span class="anim-forms__row"><span class="anim-forms__tag">length and angle</span>
    <code data-role="f-polar"></code></span>
</output>

<figcaption class="anim-figure__caption"></figcaption>
`;

/* --- drawing (2D) --------------------------------------------------------- */

/** @param {string} hex #rrggbb @returns {number[]} */
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * The ramp tokens at t (0 to 1), mixed in sRGB between neighbouring stops.
 * @param {ReturnType<typeof getTheme>} th
 * @param {number} t
 */
function ramp2D(th, t) {
  const stops = [0, 1, 2, 3, 4].map((i) => th.css(`--ambe-ramp-${i}`, "#808080"));
  const x = Math.min(1, Math.max(0, t)) * 4;
  const i = Math.min(3, Math.floor(x));
  const f = x - i;
  const a = channels(stops[i]);
  const b = channels(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(", ")})`;
}

/**
 * A fact in the highlight's chip, as the 3D view draws it: the chip fill
 * with a 1.5 px border in the highlight.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {{align: CanvasTextAlign, baseline: "top" | "bottom", mono?: boolean, pad?: number}} at
 */
function chip2D(ctx, th, text, x, y, at) {
  const size = 11;
  const pad = at.pad ?? 3;
  ctx.save();
  ctx.font = `600 ${size}px ${at.mono ? th.mono : th.font}`;
  const width = ctx.measureText(text).width;
  const height = size * 1.2;
  const bx = at.align === "right" ? x - width : at.align === "center" ? x - width / 2 : x;
  const by = at.baseline === "top" ? y : y - height * 0.8;
  ctx.beginPath();
  ctx.roundRect(bx - pad, by - pad, width + 2 * pad, height + 2 * pad, 4);
  ctx.fillStyle = th.css("--ambe-highlight-chip", th.plotBg);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = th.css("--ambe-highlight", th.accentWarm);
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, text, x, y, { align: at.align, baseline: at.baseline, size, weight: 600, mono: at.mono, color: th.ink });
}

/**
 * One row of products: stems from 0, coloured by sample on the ramp, and the
 * running sum divided by SCALE as the thick highlight line.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {import("./anim-core.js").Plot} row
 * @param {Float64Array} products
 * @param {Float64Array} run
 */
function drawProducts(ctx, th, row, products, run) {
  ctx.save();
  row.clip(ctx);
  ctx.lineWidth = 1.2;
  const y0 = row.y(0);
  for (let n = 0; n < N; n += 1) {
    ctx.strokeStyle = ramp2D(th, n / (N - 1));
    ctx.beginPath();
    ctx.moveTo(row.x(n), y0);
    ctx.lineTo(row.x(n), row.y(products[n]));
    ctx.stroke();
  }
  const highlight = th.css("--ambe-highlight", th.accentWarm);
  // The sum after n + 1 samples sits at n + 1, so it ends at the block's end.
  const path = [{ x: 0, y: 0 }, ...Array.from(run, (v, n) => ({ x: n + 1, y: v / SCALE }))];
  drawPolyline(ctx, path, { plot: row, color: highlight, width: 2.6 });
  ctx.restore();
  // The end dot sits on the row's right edge, outside the clip, so it is
  // drawn whole.
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(row.x(N), row.y(Math.max(-ROW, Math.min(ROW, run[N - 1] / SCALE))), 3.5, 0, 2 * Math.PI);
  ctx.fill();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {Layout} geo
 * @param {ProbeState} s
 * @param {boolean} pending  the 3D view is about to play the walk: the rows
 *        and the plane stand empty, as the walk starts
 */
function drawRows(ctx, th, geo, s, pending) {
  const { rows, stacked } = geo;
  const d = s.data;
  const sineColour = th.css("--ambe-cat-1", th.series[0]);
  const cosineColour = th.css("--ambe-cat-2", th.series[1]);
  // Figure 2.1 (two rows) has one test wave, the sine.
  const waves = rows.length === 3 ? "the test waves" : "the test wave";
  const titles = stacked
    ? [`the recording and ${waves}`, "sine test × recording", "cosine test × recording"]
    : [`the recording (solid) and ${waves} (dashed)`,
      "sine test × recording",
      "cosine test × recording"];
  const last = rows.length - 1;
  rows.forEach((row, i) => {
    drawGrid(ctx, row, { xTicks: [40, 80, 120], yTicks: [0] });
    drawAxes(ctx, row, {
      xTicks: i === last ? [0, 40, 80, 120, 160] : [],
      yTicks: i === 0 ? [-1, 1] : [-1, 1],
      formatY: (v) => String(v),
      xLabel: i === last ? "sample n" : undefined,
      fontSize: 10,
    });
    drawLabel(ctx, titles[i], row.area.left, row.area.top - 3, {
      align: "left", baseline: "bottom", size: 11, color: i === 2 && !s.cosine ? th.text4 : th.text3,
    });
  });

  // The recording and the test waves.
  const r0 = rows[0];
  ctx.save();
  r0.clip(ctx);
  const at = (/** @type {Float64Array} */ v) => Array.from(v, (y, n) => ({ x: n, y }));
  drawPolyline(ctx, at(d.sineTest), { plot: r0, color: sineColour, width: 1.4, dash: [4, 3] });
  if (s.cosine) drawPolyline(ctx, at(d.cosineTest), { plot: r0, color: cosineColour, width: 1.4, dash: [2, 3] });
  drawPolyline(ctx, at(d.signal), { plot: r0, color: th.ink, width: 2 });
  ctx.restore();
  drawLabel(ctx, `test ${s.f} Hz`, r0.area.right - 4, r0.area.top + 3, {
    align: "right", baseline: "top", size: 10, color: sineColour, background: th.plotBg, padding: 2,
  });

  if (pending) {
    drawSum(ctx, th, rows[1], "sum 0.00");
    if (s.cosine) drawSum(ctx, th, rows[2], "sum 0.00");
  } else {
    drawProducts(ctx, th, rows[1], d.sineProducts, d.sineRun);
    drawSum(ctx, th, rows[1], `sum ${fmt(d.sine)}`);
    if (s.cosine) {
      drawProducts(ctx, th, rows[2], d.cosineProducts, d.cosineRun);
      drawSum(ctx, th, rows[2], `sum ${fmt(d.cosine)}`);
    }
  }
  if (!s.cosine && rows[2]) {
    const r2 = rows[2];
    drawLabel(ctx, "cosine test off", (r2.area.left + r2.area.right) / 2, (r2.area.top + r2.area.bottom) / 2, {
      align: "center", baseline: "middle", size: 11, color: th.text4,
    });
  }
}

/**
 * The sum's value above the right end of a row, clear of the stems, in the
 * highlight's chip.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {import("./anim-core.js").Plot} row
 * @param {string} text
 */
function drawSum(ctx, th, row, text) {
  chip2D(ctx, th, text, row.area.right, row.area.top - 5, { align: "right", baseline: "bottom", mono: true, pad: 2 });
}

/**
 * The plane of the two sums: the running sum's walk and where it ends.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {Layout} geo
 * @param {ProbeState} s
 * @param {boolean} pending  as in drawRows
 */
function drawPlane(ctx, th, geo, s, pending) {
  const { plane } = geo;
  const d = s.data;
  // Figure 2.1 (two rows) has no cosine test: its sum walks along the sine
  // axis alone, so the vertical axis carries no label and no numbers.
  const cosineAxis = geo.rows.length === 3;
  drawGrid(ctx, plane, { xTicks: [-80, 0, 80], yTicks: [-80, 0, 80] });
  drawAxes(ctx, plane, {
    xTicks: [-80, 0, 80],
    yTicks: cosineAxis ? [-80, 80] : [],
    xLabel: "sine test sum",
    fontSize: 10,
  });
  if (cosineAxis) {
    drawLabel(ctx, s.cosine ? "cosine test sum" : "cosine test sum (off)", plane.area.left + 4, plane.area.top + 3, {
      align: "left", baseline: "top", size: 10, color: s.cosine ? th.text3 : th.text4,
    });
  }
  ctx.save();
  plane.clip(ctx);
  /** @type {{x: number, y: number}[]} */
  const ring = [];
  for (let i = 0; i <= 180; i += 1) ring.push({ x: 80 * Math.cos((i / 90) * Math.PI), y: 80 * Math.sin((i / 90) * Math.PI) });
  drawPolyline(ctx, ring, { plot: plane, color: th.muted, width: 1, dash: [3, 4] });
  if (pending) {
    ctx.restore();
    return;
  }
  const ys = s.cosine ? d.cosineRun : null;
  const walk = [{ x: 0, y: 0 }, ...Array.from(d.sineRun, (x, n) => ({ x, y: ys ? ys[n] : 0 }))];
  const end = walk[walk.length - 1];
  drawPolyline(ctx, [{ x: 0, y: 0 }, end], { plot: plane, color: th.ink, width: 1.2, dash: [4, 3] });
  const highlight = th.css("--ambe-highlight", th.accentWarm);
  drawPolyline(ctx, walk, { plot: plane, color: highlight, width: 2.6 });
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(plane.x(end.x), plane.y(end.y), 5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
  // The chip: the same fact the 3D view's chip states.
  const ex = plane.x(end.x);
  const ey = plane.y(end.y);
  const right = ex < (plane.area.left + plane.area.right) / 2 + 20;
  chip2D(ctx, th, chipText(s), ex + (right ? 10 : -10), ey - 10, { align: right ? "left" : "right", baseline: "bottom" });
}

/**
 * The sweep strip: the length of the pair at every test frequency.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {{width: number, height: number}} size
 * @param {ProbeState} s
 * @param {{f: number[], length: Float64Array}} curve
 */
function drawStrip(ctx, th, size, s, curve) {
  const narrow = size.width < 620;
  const plot = createPlot(size, {
    xDomain: [0, SWEEP_MAX],
    yDomain: [0, 92],
    padding: { top: 20, right: 14, bottom: 28, left: narrow ? 30 : 40 },
  });
  drawGrid(ctx, plot, { xTicks: [50, 100, 150, 200, 250, 300, 350], yTicks: [40, 80] });
  drawAxes(ctx, plot, {
    xTicks: narrow ? [0, 100, 200, 300, 400] : [0, 50, 100, 150, 200, 250, 300, 350, 400],
    yTicks: [0, 40, 80],
    xLabel: "test frequency, Hz",
    fontSize: 10,
  });
  drawLabel(ctx, `length of the sum at each test frequency, recording's phase ${s.phase}°`, plot.area.left, plot.area.top - 4, {
    align: "left", baseline: "bottom", size: 11, color: th.text3,
  });
  ctx.save();
  plot.clip(ctx);
  drawPolyline(ctx, curve.f.map((f, i) => ({ x: f, y: curve.length[i] })), { plot, color: th.ink, width: 1.8 });
  // The bins: every multiple of 50 Hz.
  ctx.fillStyle = th.ink;
  for (let f = 50; f <= SWEEP_MAX; f += 50) {
    const v = probe(f, radians(s.phase)).length;
    ctx.beginPath();
    ctx.arc(plot.x(f), plot.y(v), 3, 0, 2 * Math.PI);
    ctx.fill();
  }
  const highlight = th.css("--ambe-highlight", th.accentWarm);
  ctx.strokeStyle = highlight;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(plot.x(s.f), plot.area.bottom);
  ctx.lineTo(plot.x(s.f), plot.y(s.data.length));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(plot.x(s.f), plot.y(s.data.length), 5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
  const left = s.f < SWEEP_MAX * 0.7;
  chip2D(ctx, th, `${s.f} Hz: ${fmt(s.data.length)}`, plot.x(s.f) + (left ? 9 : -9), plot.y(s.data.length) - 6, { align: left ? "left" : "right", baseline: "bottom" });
}

/**
 * The sentence for the 2D canvas's label.
 * @param {ProbeState} s
 * @param {boolean} [cosineTest=true] false in Figure 2.1, which has no cosine test
 */
export function describe2D(s, cosineTest = true) {
  const d = s.data;
  const cosine = !cosineTest ? "" : s.cosine
    ? ` The cosine test's products add up to ${fmt(d.cosine)}. On the plane of the two sums the running sum ends ` +
      (d.length < 1e-6 ? "at the centre, length 0." : `${fmt(d.length)} from the centre, at an angle of ${degrees(d.angle)} degrees.`)
    : " The cosine test is off.";
  return `A 200 Hz recording with phase ${s.phase} degrees, 160 samples, tested at ${s.f} Hz. ` +
    `The sine test's products, one per sample, add up to ${fmt(d.sine)}.${cosine}`;
}

/* --- the page's pixel grid ---------------------------------------------- */

/**
 * @param {{el: HTMLElement, padded: HTMLElement}[]} items
 */
export function holdToGrid(items) {
  // Hiding a host to measure it can move the browser's scroll anchor, and
  // the page followed it (1346 px on ch02). Turning anchoring off for the
  // whole page instead let other figures that grew meanwhile push a heading
  // the reader had jumped to off the screen. So the page's place is noted
  // first, with the layout up to date, and put back if measuring moved it.
  void document.documentElement.offsetHeight;
  const left = window.scrollX;
  const top = window.scrollY;
  for (const { padded } of items) padded.style.paddingBottom = "";
  const pads = items.map(({ el }) => {
    const next = el.nextElementSibling;
    if (!next) return 0;
    const shown = next.getBoundingClientRect().top;
    const display = el.style.display;
    el.style.display = "none";
    const hidden = next.getBoundingClientRect().top;
    el.style.display = display;
    const share = Math.round((shown - hidden) * 64) / 64;
    return Math.ceil(share) - share;
  });
  items.forEach(({ padded }, i) => {
    if (pads[i]) padded.style.paddingBottom = `calc(${getComputedStyle(padded).paddingBottom} + ${pads[i]}px)`;
  });
  void document.documentElement.offsetHeight;
  if (window.scrollX !== left || window.scrollY !== top) window.scrollTo({ left, top, behavior: "instant" });
}

/* --- module ------------------------------------------------------------- */

/**
 * Mount the probe figure.
 * @param {Element} host a `[data-anim="probe"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const mode = host instanceof HTMLElement ? (host.dataset.mode ?? "both") : "both";
  const steps = foldSteps(readSteps(host, STEP_KEYS));
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-probe";
  figure.innerHTML = FIGURE_HTML;
  const titleEl = $(figure, ".anim-figure__title", HTMLElement);
  if (mode === "sine") {
    titleEl.textContent = "Multiplying and summing a single test frequency";
  } else if (mode === "cosine") {
    titleEl.textContent = "Recovering magnitude and phase with sine and cosine tests";
  } else if (mode === "sweep") {
    titleEl.textContent = "Frequency resolution across the 50 Hz DFT bins";
  }
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  const capKey = (mode === "sine" || mode === "cosine" || mode === "sweep") ? mode : "both";
  caption.innerHTML = `${CAPTIONS[capKey]} ${SOURCE_NOTE}`;
  caption.append(" ", badge("synthetic"));
  host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const strip = $(figure, '[data-ref="strip"]', HTMLElement);
  const stripCanvas = $(strip, "canvas", HTMLCanvasElement);
  const freqEl = $(figure, '[data-role="freq"]', HTMLInputElement);
  const phaseEl = $(figure, '[data-role="phase"]', HTMLInputElement);
  const freqOut = $(figure, '[data-role="freq-out"]', HTMLElement);
  const phaseOut = $(figure, '[data-role="phase-out"]', HTMLElement);
  const cosineEl = $(figure, '[data-role="cosine"]', HTMLButtonElement);
  const sweepEl = $(figure, '[data-role="sweep"]', HTMLButtonElement);
  const toggle = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const camera = $(figure, '[data-ref="camera"]', HTMLElement);
  const legend2D = $(figure, '[data-ref="legend-2d"]', HTMLElement);
  const legend3D = $(figure, '[data-ref="legend-3d"]', HTMLElement);
  const keyCosine = $(figure, '[data-ref="key-cosine"]', HTMLElement);

  /** @type {ProbeState} */
  const state = {
    f: mode === "sweep" ? 225 : 200,
    phase: mode === "cosine" ? 45 : 0,
    cosine: mode === "cosine" || mode === "sweep",
    sweep: mode === "sweep",
    preset: "corner",
    morphs: 0,
    data: probe(mode === "sweep" ? 225 : 200, radians(mode === "cosine" ? 45 : 0)),
  };

  if (mode === "sine") {
    cosineEl.hidden = true;
    sweepEl.hidden = true;
    toggle.hidden = true;
  } else if (mode === "cosine") {
    cosineEl.hidden = true;
    sweepEl.hidden = true;
  } else if (mode === "sweep") {
    frame.hidden = true;
    legend2D.hidden = true;
    cosineEl.hidden = true;
    sweepEl.hidden = true;
    toggle.hidden = true;
    strip.hidden = false;
    strip.style.height = "220px";
  }

  /** The sweep curve, computed for one phase at a time. */
  let curve = { phase: NaN, f: /** @type {number[]} */ ([]), length: new Float64Array(0) };

  /** The opening rule will open 3D and play the walk (view-switch.js). */
  const start3D = mode === "cosine" || mode === "both";
  const opening = start3D && supportsWebGL2() && opensIn3D();
  /** @type {import("./lib/view-switch.js").ViewSwitch | null} */
  let switcher = null;
  const handle = setupCanvas(canvas, { onResize: () => render() });
  const stripHandle = setupCanvas(stripCanvas, { onResize: () => renderStrip() });

  /* -- drawing ----------------------------------------------------------- */

  let labelTimer = 0;
  const describe = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      canvas.setAttribute("aria-label", describe2D(state, mode !== "sine"));
      const v = state.data.length;
      stripCanvas.setAttribute("aria-label", `The length of the sum at each test frequency from 0 to ${SWEEP_MAX} Hz, ` +
        `recording's phase ${state.phase} degrees: 80 at 200 Hz, 0 at every other multiple of 50 Hz, and not 0 between them. ` +
        `At ${state.f} Hz it is ${fmt(v)}.`);
    }, 250);
  };

  function render() {
    if (!frame.hidden) {
      const th = getTheme();
      const ctx = handle.ctx;
      const geo = layout(handle.width, handle.height, mode === "sine" ? 2 : 3);
      const width = frame.getBoundingClientRect().width;
      const deep = toggle.getAttribute("aria-pressed") === "true";
      const tall = width >= 480 ? 10 / 16 : deep ? 3 / 4 : 1.6;
      const aspect = width ? `${width} / ${Math.round(width * tall)}` : "16 / 10";
      if (frame.style.getPropertyValue("--anim-aspect") !== aspect) frame.style.setProperty("--anim-aspect", aspect);
      clearCanvas(ctx, handle, th.plotBg);
      const pending = opening && switcher?.view() === "loading";
      drawRows(ctx, th, geo, state, pending);
      drawPlane(ctx, th, geo, state, pending);
    }
    renderStrip();
    updateForms();
    describe();
  }

  function renderStrip() {
    if (strip.hidden || !stripHandle.width) return;
    const th = getTheme();
    if (curve.phase !== state.phase) {
      const f = Array.from({ length: SWEEP_MAX / 2 + 1 }, (_, i) => i * 2);
      curve = { phase: state.phase, f, length: sweep(f, radians(state.phase)) };
    }
    clearCanvas(stripHandle.ctx, stripHandle, th.plotBg);
    drawStrip(stripHandle.ctx, th, stripHandle, state, curve);
  }

  function updateForms() {
    const d = state.data;
    /** @param {string} role @param {string} text */
    const set = (role, text) => {
      const el = figure.querySelector(`[data-role="${role}"]`);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set("f-sine", fmt(d.sine));
    set("f-cosine", state.cosine ? fmt(d.cosine) : "off");
    set("f-polar", state.cosine ? polar(d) : "needs both tests");
    freqOut.textContent = `${state.f} Hz`;
    phaseOut.textContent = `${state.phase}°`;
  }

  /** Recompute the tests and redraw both views. */
  const changed = () => {
    state.data = probe(state.f, radians(state.phase));
    render();
    views.update(state);
  };

  /* -- interaction ------------------------------------------------------- */

  function syncControls() {
    if (freqEl.value !== String(state.f)) freqEl.value = String(state.f);
    if (phaseEl.value !== String(state.phase)) phaseEl.value = String(state.phase);
    cosineEl.setAttribute("aria-pressed", String(state.cosine));
    sweepEl.setAttribute("aria-pressed", String(state.sweep));
    keyCosine.hidden = !state.cosine;
    if (strip.hidden === state.sweep) {
      strip.hidden = !state.sweep;
    }
  }

  freqEl.addEventListener("input", () => {
    state.f = Number(freqEl.value);
    changed();
  }, { signal });
  phaseEl.addEventListener("input", () => {
    state.phase = Number(phaseEl.value);
    changed();
  }, { signal });
  cosineEl.addEventListener("click", () => {
    state.cosine = !state.cosine;
    if (!state.cosine) state.sweep = false;
    state.morphs += 1;
    syncControls();
    changed();
  }, { signal });
  sweepEl.addEventListener("click", () => {
    state.sweep = !state.sweep;
    if (state.sweep && !state.cosine) {
      state.cosine = true;
      state.morphs += 1;
      syncControls();
      changed();
      return;
    }
    syncControls();
    render();
  }, { signal });
  const unsubscribeTheme = onThemeChange(() => render());

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
    legend2D.hidden = live || mode === "sweep";
    if (!live) render();
  };

  const views = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    start: start3D ? "auto" : "2d",
    state: () => state,
    load: () => import("./anim-probe-3d.js"),
    onView,
    id: "probe",
  });
  switcher = views;
  const shape = new MutationObserver(() => render());
  shape.observe(toggle, { attributes: true, attributeFilter: ["aria-pressed"] });
  signal.addEventListener("abort", () => shape.disconnect(), { once: true });
  if (!views.available()) toggle.title = NO_WEBGL_HINT;
  const released = new MutationObserver(() => {
    if (views.view() !== "loading") {
      released.disconnect();
      render();
    }
  });
  if (opening) released.observe(toggle, { attributes: true, attributeFilter: ["aria-pressed", "disabled"] });
  signal.addEventListener("abort", () => released.disconnect(), { once: true });

  for (const button of camera.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => {
      setPreset(/** @type {PresetName} */ (button.getAttribute("data-preset")));
    }, { signal });
  }

  /** @param {PresetName} name */
  function setPreset(name) {
    state.preset = name;
    pressPreset(name);
    views.preset(name);
  }

  /** The first step is applied as the figure mounts, before any reader acts. */
  let mounting = true;

  /**
   * One step's state. A first step that asks for 3D opens it by the
   * opening rule (view-switch.js, owner decision O1): not under reduced
   * motion or without WebGL; a step the reader moves to opens it always.
   * @param {Record<string, string>} s
   */
  function apply(s) {
    const first = mounting;
    mounting = false;
    const before = `${state.f} ${state.phase} ${state.cosine}`;
    if (s.f !== undefined) state.f = Number(s.f);
    if (s.phase !== undefined) state.phase = Number(s.phase);
    if (s.cosine !== undefined) state.cosine = s.cosine === "on";
    if (s.sweep !== undefined) state.sweep = s.sweep === "on";
    if (`${state.f} ${state.phase} ${state.cosine}` !== before) state.morphs += 1;
    syncControls();
    if (s.preset && /** @type {readonly string[]} */ (PRESET_NAMES).includes(s.preset)) {
      setPreset(/** @type {PresetName} */ (s.preset));
    }
    if (s.view === "3d" && (!first || opening)) void views.show3D();
    else if (s.view === "2d") views.show2D();
    changed();
  }

  syncControls();
  pressPreset(state.preset);
  if (steps.length) createStepper(figure, steps, apply, { signal });
  else render();

  const hooks = [/** @type {HTMLElement} */ (host), ...document.querySelectorAll(".anim-probe-hook")]
    .filter((el) => el instanceof HTMLElement);
  const items = hooks.map((el) => ({ el, padded: el === host ? figure : el }));
  let gridFrame = 0;
  let heights = "";
  const grid = new ResizeObserver(() => {
    cancelAnimationFrame(gridFrame);
    gridFrame = requestAnimationFrame(() => {
      const now = hooks.map((el) => el.getBoundingClientRect().height.toFixed(3)).join(" ") + ` ${document.documentElement.clientWidth}`;
      if (now === heights) return;
      holdToGrid(items);
      heights = hooks.map((el) => el.getBoundingClientRect().height.toFixed(3)).join(" ") + ` ${document.documentElement.clientWidth}`;
    });
  });
  for (const el of [...hooks, figure]) grid.observe(el);
  holdToGrid(items);

  return () => {
    clearTimeout(labelTimer);
    cancelAnimationFrame(gridFrame);
    grid.disconnect();
    for (const { padded } of items) padded.style.paddingBottom = "";
    unsubscribeTheme();
    handle.destroy();
    stripHandle.destroy();
  };
}
