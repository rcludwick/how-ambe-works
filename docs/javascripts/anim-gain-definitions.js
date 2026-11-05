// @ts-check
/* ===========================================================================
 * anim-gain-definitions.js: two definitions of a frame's gain, and why no
 * constant converts one to the other (ch13, "Nothing fixes absolute level").
 * ---------------------------------------------------------------------------
 * SLUG          gain-definitions   <div data-anim="gain-definitions">
 *
 * DATA READ     assets/data/<clip>/frames.json and spectra.json, one clip at
 *               a time, all eight only when "All eight" is chosen.
 *
 * CONTROLS      Recording, a frame slider ordered by spread, the 3D control
 *               and, in 3D, the Camera presets and the Zoom group.
 *
 * WHAT IT DRAWS For one voiced frame of the chip's decoded audio, the level
 *               of each harmonic k = 1..L as a comb, shifted so the log of
 *               the mean energy, G_E, sits at 0 dB; the mean of the log
 *               levels, G_L, as a dashed line below it; the gap between
 *               them. Beside it, every loaded frame's G_L against its spread
 *               (the standard deviation of its levels in dB).
 *
 *               3D (anim-gain-definitions-3d.js, loaded only when 3D is
 *               wanted): depth is the spread, a real axis in dB. Front is
 *               the comb panel, Side the scatter.
 *
 * NOT A CODEC   Display arithmetic on precomputed spectra of the decoded
 *               audio: A_k as lib/harmonics.js harmonicAmplitudes() reads
 *               it, then a mean, a log and a standard deviation. Neither
 *               definition is claimed to be the one the chip uses; no gain
 *               index, quantizer or bit field is read. tools/gain-stats.py
 *               computes the same numbers in Python.
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
  loadJSON,
  markEnhanced,
  NO_WEBGL_HINT,
  onThemeChange,
  opensIn3D,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { CUTOFF_BADGE, CUTOFF_HZ, CUTOFF_LABEL } from "./lib/cutoff.js";
import { harmonicAmplitudes, harmonicCount } from "./lib/harmonics.js";
import { GAIN_PICKS, equalSpreadPair } from "./lib/picks.js";
import { createViewSwitch } from "./lib/view-switch.js";

/** The eight clips, in clips.json order; a clip's place sets its colour. */
export const CLIPS = /** @type {const} */ (["lj-a", "lj-b", "lj-c", "lj-d", "lr-a", "lr-b", "lr-c", "lr-d"]);
/** A frame counts only if the input is at least this loud. */
export const MIN_RMS_DBFS = -40;
/** The spectra stop at -100 dBFS; a level at or below this is that floor. */
export const FLOOR_DB = -99;
/** The axes: harmonic number, level relative to G_E, spread. */
export const K_MAX = 42;
/** @type {[number, number]} */
export const DB = [-72, 16];
export const SIGMA_MAX = 28;
export const K_TICKS = [1, 10, 20, 30, 40];
export const DB_TICKS = [-60, -40, -20, 0];
export const SIGMA_TICKS = [0, 10, 20];

const STEP_KEYS = /** @type {const} */ (["clip", "pick", "view", "preset"]);
export const PRESET_NAMES = /** @type {const} */ (["front", "side", "corner"]);
/** @typedef {typeof PRESET_NAMES[number]} PresetName */

/**
 * @typedef {import("./lib/picks.js").GainFrame & {t: number, f0: number, L: number,
 *           levels: Float64Array, ge: number, gl: number}} GainRecord
 *           levels: A_k in dBFS, k = 1..L at index k - 1
 */

/**
 * One frame's two gains, or null when it does not count: not voiced, no
 * decoded f0, an input below MIN_RMS_DBFS, or any level on the floor.
 * @param {FrameRecord} frame
 * @param {number[]} row its decoded spectrum, dBFS
 * @param {string} clip
 * @returns {GainRecord | null}
 */
export function gainFrame(frame, row, clip) {
  const d = frame.derived;
  const f0 = d.decoded_f0_hz;
  if (!d.voiced || !(f0 > 0) || d.orig_rms_dbfs < MIN_RMS_DBFS) return null;
  const L = harmonicCount(f0, CUTOFF_HZ);
  const A = harmonicAmplitudes(row, f0, L);
  const levels = new Float64Array(L);
  let energy = 0;
  let sum = 0;
  for (let k = 1; k <= L; k += 1) {
    const db = A[k] > 0 ? 20 * Math.log10(A[k]) : -Infinity;
    if (!(db > FLOOR_DB)) return null;
    levels[k - 1] = db;
    energy += 10 ** (db / 10);
    sum += db;
  }
  if (!L) return null;
  const ge = 10 * Math.log10(energy / L);
  const gl = sum / L;
  let spread = 0;
  for (const db of levels) spread += (db - gl) ** 2;
  const order = /** @type {readonly string[]} */ (CLIPS).indexOf(clip);
  return { clip, order, i: frame.i, t: frame.t, f0, L, levels, ge, gl, sigma: Math.sqrt(spread / L), gap: ge - gl };
}

/**
 * Every counting frame of one clip, in frame order.
 * @param {FramesFile} frames
 * @param {SpectraFile} spectra
 * @param {string} clip
 * @returns {GainRecord[]}
 */
export function gainRecords(frames, spectra, clip) {
  /** @type {GainRecord[]} */
  const out = [];
  for (const frame of frames.frames) {
    const record = gainFrame(frame, spectra.decoded[frame.i], clip);
    if (record) out.push(record);
  }
  return out;
}

/**
 * Linear interpolation between order statistics, as numpy and
 * tools/gain-stats.py do.
 * @param {number[]} values
 * @param {number} p percent
 */
export function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  const pos = ((s.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Pearson's r.
 * @param {number[]} xs
 * @param {number[]} ys
 */
export function pearson(xs, ys) {
  const mean = (/** @type {number[]} */ v) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * The numbers the caption and the readout state.
 * @param {GainRecord[]} records
 */
export function gainStats(records) {
  const gaps = records.map((r) => r.gap);
  const sigmas = records.map((r) => r.sigma);
  return {
    frames: records.length,
    gapMin: Math.min(...gaps),
    gapMax: Math.max(...gaps),
    gap: [10, 50, 90].map((p) => percentile(gaps, p)),
    sigma: [10, 50, 90].map((p) => percentile(sigmas, p)),
    r: records.length > 2 ? pearson(sigmas, gaps) : NaN,
  };
}

/** @param {number} v */
export const fmt1 = (v) => {
  const s = v.toFixed(1);
  return s === "-0.0" ? "0.0" : s;
};

/**
 * What a chip states. `named` puts the recording first, for when two
 * frames are on show.
 * @param {GainRecord} r
 * @param {boolean} [named]
 */
export const chipText = (r, named = false) => `${named ? `${r.clip}: ` : ""}spread ${fmt1(r.sigma)} dB, gap ${fmt1(r.gap)} dB`;

/** @param {GainRecord} r */
export const frameName = (r) => `${r.clip} frame ${r.i}`;

/** @param {string} clip */
const clipName = (clip) => (clip === "all" ? "all eight recordings" : `${clip} (${clip.startsWith("lj") ? "female" : "male"} voice)`);

/**
 * The 2D panels for a canvas of W x H CSS px: the comb (one frame's
 * levels) and the scatter (every frame's G_L against spread), side by side,
 * or stacked on a phone. Both share the level axis. The 3D view's Front
 * preset puts its comb on comb.area, Side its scatter on scatter.area.
 * @param {number} W
 * @param {number} H
 */
export function layout(W, H) {
  const stacked = W < 560;
  const size = { width: W, height: H };
  const left = stacked ? 34 : 44;
  if (stacked) {
    const mid = Math.round(H * 0.54);
    return {
      stacked,
      comb: createPlot(size, { xDomain: [0, K_MAX], yDomain: DB, padding: { top: 22, left, right: 12, bottom: H - mid + 40 } }),
      scatter: createPlot(size, { xDomain: [0, SIGMA_MAX], yDomain: DB, padding: { top: mid + 22, left, right: 12, bottom: 40 } }),
    };
  }
  const split = Math.round(W * 0.6);
  return {
    stacked,
    comb: createPlot(size, { xDomain: [0, K_MAX], yDomain: DB, padding: { top: 24, left, right: W - split, bottom: 72 } }),
    scatter: createPlot(size, { xDomain: [0, SIGMA_MAX], yDomain: DB, padding: { top: 24, left: split + 34, right: 14, bottom: 72 } }),
  };
}

/* --- markup ------------------------------------------------------------- */

const CAPTION = `
  Each comb is one voiced 20 ms frame of the chip's decoded audio: the level
  of each harmonic up to the cutoff, read from the spectrum of a 32 ms Hann
  window at 31.25 Hz resolution, not from the codec's own amplitude
  estimator, and shifted so that the log of the mean energy, G_E, sits at
  0 dB. The dashed line is the mean of the log levels, G_L. Spread (sigma)
  is the standard deviation of the levels in dB; in 3D it is the depth.
  G_E and G_L are two definitions a designer could choose. The patents
  describe the gain term as an average of log magnitudes (US 5,870,405); the
  definition the deployed D-STAR codec uses is not public. G_L depends on
  how far down the quiet harmonics are measured: these spectra stop at
  -100 dBFS, so a frame with any harmonic on that floor is left out, which
  leaves 661 voiced frames across the eight recordings.
  <span class="anim-figure__source">Derived from the chip's decoded audio
  (ThumbDV recordings of Piper TTS input, see the Listen page); the numbers
  are recomputed by tools/gain-stats.py.</span>`;

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Comparing linear RMS and log-mean frame gain definitions</p>
</div>
<div class="anim-figure__frame" data-state="loading" style="--anim-aspect: 16 / 10">
  <canvas class="anim-figure__canvas" role="img" aria-label="The gain definitions figure, loading."></canvas>
</div>
<div class="anim-figure__step"></div>
<ul class="anim-legend">
  <li class="anim-legend__item"><i class="anim-gain__key anim-gain__key--comb"></i>this frame's harmonic levels (thick stems)</li>
  <li class="anim-legend__item"><i class="anim-gain__key anim-gain__key--ge"></i>G_E, log of the mean energy (solid, at 0)</li>
  <li class="anim-legend__item"><i class="anim-gain__key anim-gain__key--gl"></i>G_L, mean of the log levels (dashed)</li>
  <li class="anim-legend__item"><i class="anim-gain__key anim-gain__key--dots"></i>every frame's G_L against its spread (dots, colour by recording)</li>
  <li class="anim-legend__item" data-ref="key-partner" hidden><i class="anim-gain__key anim-gain__key--partner"></i>a frame with the same spread (dotted)</li>
  <li class="anim-legend__item" data-ref="key-context" hidden><i class="anim-gain__key anim-gain__key--context"></i>other frames, each at its spread in depth and coloured by it (thin lines)</li>
</ul>
<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Recording</span>
    <select class="anim-gain__select" data-ref="clip">
      ${CLIPS.map((c) => `<option value="${c}">${c}, ${c.startsWith("lj") ? "female" : "male"}</option>`).join("")}
      <option value="all">All eight</option>
    </select>
  </label>
  <label class="anim-field">
    <span class="anim-field__label">Frame, by spread</span>
    <input class="anim-range" type="range" min="0" max="0" step="1" value="0" data-ref="frame"
           aria-label="Frame, ordered from the flattest to the steepest">
    <output class="anim-readout" data-ref="frame-out"></output>
  </label>
  <div class="anim-gain__view">
    <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
    <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
      <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
      <button class="anim-btn" type="button" data-preset="side" aria-pressed="false">Side</button>
      <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
    </div>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
<output class="anim-forms" data-ref="forms" aria-live="polite">
  <span class="anim-forms__row"><span class="anim-forms__tag">frame</span><code data-role="frame"></code></span>
  <span class="anim-forms__row"><span class="anim-forms__tag">harmonics</span><span data-role="harmonics"></span></span>
  <span class="anim-forms__row"><span class="anim-forms__tag">G_E, log of mean energy</span><code data-role="ge"></code></span>
  <span class="anim-forms__row"><span class="anim-forms__tag">G_L, mean of logs</span><code data-role="gl"></code></span>
  <span class="anim-forms__row"><span class="anim-forms__tag">gap, spread</span><code data-role="gap"></code></span>
  <span class="anim-forms__row" data-ref="partner-row" hidden><span class="anim-forms__tag">same spread</span><code data-role="partner"></code></span>
  <span class="anim-forms__row"><span class="anim-forms__tag">frames shown</span><code data-role="loaded"></code></span>
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
export function ramp2D(th, t) {
  const stops = [0, 1, 2, 3, 4].map((i) => th.css(`--ambe-ramp-${i}`, "#808080"));
  const x = Math.min(1, Math.max(0, t)) * 4;
  const i = Math.min(3, Math.floor(x));
  const f = x - i;
  const a = channels(stops[i]);
  const b = channels(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(", ")})`;
}

/** A recording's place on the ramp. @param {GainRecord} r */
export const rampT = (r) => r.order / (CLIPS.length - 1);

/**
 * @typedef {Object} GainState
 * @property {string} clip  one clip id, or "all"
 * @property {GainRecord[]} records  the frames shown, flattest first
 * @property {number} index  the selected frame, in that order
 * @property {GainRecord | null} partner  the other frame of an equal-spread pick
 * @property {GainRecord[]} all  every frame of the eight recordings, flattest
 *           first; loaded before the 3D view opens, for its wall, and empty
 *           until then
 * @property {{frame: GainRecord, partner: GainRecord} | null} pair  the
 *           equal-spread pick among `all`
 * @property {PresetName} preset  the 3D view's camera preset
 * @property {number} loads  counts the times `records` changed
 */

/**
 * A chip on the canvas: ink on the highlight chip colour, with a highlight
 * border, as the 3D chip is drawn.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {string} text
 * @param {number} x anchor
 * @param {number} y anchor
 * @param {{left: number, right: number, top: number, bottom: number}} area
 */
function chip(ctx, th, text, x, y, area) {
  ctx.save();
  ctx.font = `600 11px ${th.font}`;
  const w = ctx.measureText(text).width + 12;
  const h = 19;
  let left = x + 12;
  if (left + w > area.right - 2) left = x - 12 - w;
  left = Math.max(area.left + 2, left);
  const top = Math.max(area.top + 2, y - 12 - h);
  const highlight = th.css("--ambe-highlight", th.accentWarm);
  ctx.strokeStyle = highlight;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(Math.max(left, Math.min(left + w, x)), Math.max(top, Math.min(top + h, y)));
  ctx.stroke();
  ctx.fillStyle = th.css("--ambe-highlight-chip", th.plotBg);
  ctx.fillRect(left, top, w, h);
  ctx.strokeRect(left + 0.75, top + 0.75, w - 1.5, h - 1.5);
  ctx.fillStyle = th.ink;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 6, top + h / 2 + 0.5);
  ctx.restore();
}

/**
 * The comb panel: one frame's levels relative to its G_E, the two level
 * lines and the gap; the equal-spread partner dotted behind it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {import("./anim-core.js").Plot} plot
 * @param {GainState} s
 * @param {boolean} narrow
 */
function drawComb(ctx, th, plot, s, narrow) {
  drawGrid(ctx, plot, { xTicks: [10, 20, 30, 40], yTicks: DB_TICKS });
  drawAxes(ctx, plot, {
    xTicks: K_TICKS, yTicks: DB_TICKS, fontSize: 10,
    xLabel: "harmonic number k", ...(narrow ? {} : { yLabel: "level, dB relative to G_E" }),
  });
  drawLabel(ctx, narrow ? "one frame, dB relative to G_E" : "one frame: the level of each harmonic", plot.area.left, plot.area.top - 6, {
    align: "left", baseline: "bottom", size: 11, color: th.text3,
  });
  const r = s.records[s.index];
  if (!r) return;
  const floor = DB[0];
  const highlight = th.css("--ambe-highlight", th.accentWarm);
  const p = s.partner;
  ctx.save();
  plot.clip(ctx);
  // The frosted fill under the tips, as the 3D highlight has.
  const tips = Array.from(r.levels, (db, k) => ({ x: k + 1, y: db - r.ge }));
  const top = Math.min(...tips.map((q) => plot.y(q.y)));
  const fill = ctx.createLinearGradient(0, top, 0, plot.y(floor));
  fill.addColorStop(0, th.css("--ambe-highlight-fill-top", th.plotBg));
  fill.addColorStop(1, th.css("--ambe-highlight-fill-bottom", th.plotBg));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(plot.x(1), plot.y(floor));
  for (const q of tips) ctx.lineTo(plot.x(q.x), plot.y(q.y));
  ctx.lineTo(plot.x(r.L), plot.y(floor));
  ctx.closePath();
  ctx.fill();
  if (p) {
    const ptips = Array.from(p.levels, (db, k) => ({ x: k + 1, y: db - p.ge }));
    drawPolyline(ctx, ptips, { plot, color: th.ink, width: 1.5, dash: [2, 3] });
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1.2;
    for (const q of ptips) {
      ctx.beginPath();
      ctx.arc(plot.x(q.x), plot.y(q.y), 2.6, 0, 2 * Math.PI);
      ctx.stroke();
    }
    drawPolyline(ctx, [{ x: 0.5, y: -p.gap }, { x: p.L + 0.5, y: -p.gap }], { plot, color: th.muted, width: 1.5, dash: [3, 3] });
  }
  ctx.strokeStyle = highlight;
  ctx.fillStyle = highlight;
  ctx.lineWidth = 2.6;
  for (const q of tips) {
    ctx.beginPath();
    ctx.moveTo(plot.x(q.x), plot.y(floor));
    ctx.lineTo(plot.x(q.x), plot.y(q.y));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(plot.x(q.x), plot.y(q.y), 2.6, 0, 2 * Math.PI);
    ctx.fill();
  }
  const end = Math.max(r.L, p ? p.L : 0) + 0.5;
  drawPolyline(ctx, [{ x: 0.5, y: 0 }, { x: end, y: 0 }], { plot, color: th.ink, width: 2 });
  drawPolyline(ctx, [{ x: 0.5, y: -r.gap }, { x: r.L + 0.5, y: -r.gap }], { plot, color: th.ink, width: 2, dash: [7, 4] });
  // The gap: a bracket past the comb's end.
  const bx = plot.x(Math.min(end + 1.2, K_MAX - 0.8));
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx - 4, plot.y(0));
  ctx.lineTo(bx, plot.y(0));
  ctx.lineTo(bx, plot.y(-r.gap));
  ctx.lineTo(bx - 4, plot.y(-r.gap));
  ctx.stroke();
  ctx.restore();
  const room = plot.area.right - bx > 60;
  const lx = room ? bx + 5 : bx - 7;
  const align = room ? "left" : "right";
  drawLabel(ctx, "G_E", lx, plot.y(0) - 3, { align, baseline: "bottom", size: 11, weight: 600, color: th.ink });
  drawLabel(ctx, "G_L", lx, plot.y(-r.gap) + 3, { align, baseline: "top", size: 11, weight: 600, color: th.ink });
  if (r.gap > 7) {
    drawLabel(ctx, `${fmt1(r.gap)} dB`, lx, plot.y(-r.gap / 2), { align, baseline: "middle", size: 10, color: th.text2 });
  }
  // The chip at the highest tip, stating what the 3D chip states.
  let high = 0;
  tips.forEach((q, k) => {
    if (q.y > tips[high].y) high = k;
  });
  chip(ctx, th, chipText(r, Boolean(p)), plot.x(tips[high].x), plot.y(tips[high].y), plot.area);
}

/**
 * The scatter panel: every shown frame's G_L below its G_E, against its
 * spread; the selected frame's gap in the highlight.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof getTheme>} th
 * @param {import("./anim-core.js").Plot} plot
 * @param {GainState} s
 */
function drawScatter(ctx, th, plot, s) {
  drawGrid(ctx, plot, { xTicks: [5, 10, 15, 20, 25], yTicks: DB_TICKS });
  drawAxes(ctx, plot, { xTicks: SIGMA_TICKS, yTicks: DB_TICKS, fontSize: 10, xLabel: "spread, dB" });
  drawLabel(ctx, "every frame: G_L below G_E", plot.area.left, plot.area.top - 6, {
    align: "left", baseline: "bottom", size: 11, color: th.text3,
  });
  ctx.save();
  plot.clip(ctx);
  ctx.fillStyle = th.muted;
  for (const r of s.records) ctx.fillRect(plot.x(r.sigma) - 1.5, plot.y(0) - 1.5, 3, 3);
  for (const r of s.records) {
    ctx.fillStyle = ramp2D(th, rampT(r));
    ctx.beginPath();
    ctx.arc(plot.x(r.sigma), plot.y(-r.gap), 2.3, 0, 2 * Math.PI);
    ctx.fill();
  }
  const r = s.records[s.index];
  const p = s.partner;
  if (p) {
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(plot.x(p.sigma), plot.y(0));
    ctx.lineTo(plot.x(p.sigma), plot.y(-p.gap));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(plot.x(p.sigma), plot.y(-p.gap), 4.5, 0, 2 * Math.PI);
    ctx.stroke();
  }
  if (r) {
    const highlight = th.css("--ambe-highlight", th.accentWarm);
    ctx.strokeStyle = highlight;
    ctx.fillStyle = highlight;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(plot.x(r.sigma), plot.y(0));
    ctx.lineTo(plot.x(r.sigma), plot.y(-r.gap));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(plot.x(r.sigma), plot.y(-r.gap), 4.5, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The sentence for the 2D canvas's label.
 * @param {GainState} s
 */
export function describe2D(s) {
  const r = s.records[s.index];
  if (!r) return "Two definitions of a frame's level, loading.";
  const partner = s.partner
    ? ` Dotted behind it, ${frameName(s.partner)} has the same spread to within 0.25 dB, ${fmt1(s.partner.sigma)} dB, and a gap of ${fmt1(s.partner.gap)} dB.`
    : "";
  return `The levels of harmonics 1 to ${r.L} of ${frameName(r)}, relative to its log of mean energy G_E at 0 dB. ` +
    `Its mean of logs, G_L, is ${fmt1(r.gap)} dB lower, and its spread is ${fmt1(r.sigma)} dB.${partner} ` +
    `Beside it, the ${s.records.length} frames of ${clipName(s.clip)}: each one's G_L below its G_E against its spread.`;
}

/* --- module ------------------------------------------------------------- */

/** Loaded records per clip, kept for the page's life. @type {Map<string, Promise<GainRecord[]>>} */
const cache = new Map();

/**
 * One clip's records, fetched on first use.
 * @param {string} clip
 * @param {AbortSignal} signal
 * @returns {Promise<GainRecord[]>}
 */
function loadClip(clip, signal) {
  let pending = cache.get(clip);
  if (!pending) {
    pending = Promise.all([
      loadJSON(`assets/data/${clip}/frames.json`),
      loadJSON(`assets/data/${clip}/spectra.json`),
    ]).then(([frames, spectra]) => gainRecords(/** @type {FramesFile} */ (frames), /** @type {SpectraFile} */ (spectra), clip));
    pending.catch(() => cache.delete(clip));
    cache.set(clip, pending);
  }
  return pending.then((records) => {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    return records;
  });
}

/**
 * Records for a clip or "all", flattest first (lib/picks.js order).
 * @param {string} clip
 * @param {AbortSignal} signal
 */
export async function loadRecords(clip, signal) {
  const lists = await Promise.all((clip === "all" ? CLIPS : [clip]).map((c) => loadClip(c, signal)));
  return lists.flat().sort((a, b) => a.sigma - b.sigma || a.order - b.order || a.i - b.i);
}

/**
 * Mount the gain-definitions figure.
 * @param {Element} host a `[data-anim="gain-definitions"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-gain";
  figure.innerHTML = FIGURE_HTML;
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  caption.innerHTML = CAPTION;
  caption.append(" ", badge("derived-decoded"));
  const fallback = host.querySelector(":scope > .anim-fallback");
  if (fallback) fallback.after(figure);
  else host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const clipEl = $(figure, '[data-ref="clip"]', HTMLSelectElement);
  const frameEl = $(figure, '[data-ref="frame"]', HTMLInputElement);
  const frameOut = $(figure, '[data-ref="frame-out"]', HTMLOutputElement);
  const toggle = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const camera = $(figure, '[data-ref="camera"]', HTMLElement);
  const keyPartner = $(figure, '[data-ref="key-partner"]', HTMLElement);
  const keyContext = $(figure, '[data-ref="key-context"]', HTMLElement);
  const partnerRow = $(figure, '[data-ref="partner-row"]', HTMLElement);
  const harmonicsEl = $(figure, '[data-role="harmonics"]', HTMLElement);

  /** @type {GainState} */
  const state = { clip: "lr-a", records: [], index: 0, partner: null, all: [], pair: null, preset: "corner", loads: 0 };
  /** The pick the steps last asked for, applied again once a clip loads. */
  let pick = "flattest";
  let generation = 0;

  const handle = setupCanvas(canvas, { onResize: () => render() });

  let labelTimer = 0;
  const describe = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => canvas.setAttribute("aria-label", describe2D(state)), 250);
  };

  function render() {
    const th = getTheme();
    const ctx = handle.ctx;
    // From the frame, not the canvas: the canvas is hidden (width 0) in 3D.
    const aspect = frame.clientWidth < 560 ? "1 / 1.25" : "16 / 10";
    if (frame.style.getPropertyValue("--anim-aspect") !== aspect) frame.style.setProperty("--anim-aspect", aspect);
    clearCanvas(ctx, handle, th.plotBg);
    const geo = layout(handle.width, handle.height);
    drawComb(ctx, th, geo.comb, state, geo.stacked);
    drawScatter(ctx, th, geo.scatter, state);
    updateForms();
    describe();
  }

  function updateForms() {
    const r = state.records[state.index];
    /** @param {string} role @param {string} text */
    const set = (role, text) => {
      const el = figure.querySelector(`[data-role="${role}"]`);
      if (el && el.textContent !== text) el.textContent = text;
    };
    if (!r) return;
    set("frame", `${frameName(r)}, ${r.t.toFixed(2)} s, f0 ${r.f0.toFixed(1)} Hz`);
    const count = `${r.L}, ${CUTOFF_LABEL}`;
    if (harmonicsEl.dataset.text !== count) {
      harmonicsEl.dataset.text = count;
      const code = document.createElement("code");
      code.textContent = count;
      harmonicsEl.replaceChildren(code, ...(CUTOFF_BADGE ? [" ", badge(CUTOFF_BADGE)] : []));
    }
    set("ge", `${fmt1(r.ge)} dBFS`);
    set("gl", `${fmt1(r.gl)} dBFS`);
    set("gap", `gap ${fmt1(r.gap)} dB at spread ${fmt1(r.sigma)} dB`);
    const p = state.partner;
    partnerRow.hidden = !p;
    keyPartner.hidden = !p;
    if (p) set("partner", `${frameName(p)}: spread ${fmt1(p.sigma)} dB, gap ${fmt1(p.gap)} dB`);
    const st = gainStats(state.records);
    set("loaded", `${st.frames} from ${clipName(state.clip)}` + (Number.isFinite(st.r) ? `; spread against gap, r = ${st.r.toFixed(2)}` : ""));
    frameOut.textContent = `spread ${fmt1(r.sigma)} dB`;
  }

  /** Redraw both views from the state. */
  const changed = () => {
    syncControls();
    render();
    views.update(state);
  };

  function syncControls() {
    if (clipEl.value !== state.clip) clipEl.value = state.clip;
    const max = String(Math.max(0, state.records.length - 1));
    if (frameEl.max !== max) frameEl.max = max;
    if (frameEl.value !== String(state.index)) frameEl.value = String(state.index);
  }

  /** Select the step's pick among the records shown. */
  function applyPick() {
    const records = state.records;
    state.partner = null;
    if (pick === "equal-spread") {
      const pair = equalSpreadPair(records);
      if (pair) {
        state.index = records.indexOf(pair.frame);
        state.partner = pair.partner;
        return;
      }
    }
    const chosen = pick === "steepest" ? GAIN_PICKS.steepest(records) : GAIN_PICKS.flattest(records);
    state.index = chosen ? records.indexOf(chosen) : 0;
  }

  /**
   * Show a clip (or all eight); then apply `pick` if given.
   * @param {string} clip
   * @param {string | null} nextPick
   */
  async function show(clip, nextPick) {
    const mine = (generation += 1);
    if (nextPick) pick = nextPick;
    if (clip !== state.clip || !state.records.length) {
      frame.dataset.state = "loading";
      let records;
      try {
        records = await loadRecords(clip, signal);
      } catch (error) {
        if (signal.aborted || mine !== generation) return;
        console.error("gain-definitions: the data failed to load", error);
        frame.dataset.state = "error";
        return;
      }
      if (mine !== generation) return;
      state.clip = clip;
      state.records = records;
      state.loads += 1;
      if (!nextPick) pick = "flattest";
    }
    if (mine !== generation) return;
    // Every path that draws says so: a call that finds its clip already
    // loaded may follow one still loading for another clip.
    frame.dataset.state = "ready";
    applyPick();
    changed();
  }

  clipEl.addEventListener("change", () => void show(clipEl.value, "flattest"), { signal });
  frameEl.addEventListener("input", () => {
    state.index = Number(frameEl.value);
    state.partner = null;
    changed();
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
    keyContext.hidden = !live;
    if (!live) render();
  };

  const views = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: () => state,
    load: async () => {
      // The 3D wall shows every frame of the eight recordings, whichever
      // the step loads; this module reads the data, the 3D part none.
      if (!state.all.length) {
        try {
          state.all = await loadRecords("all", signal);
          state.pair = equalSpreadPair(state.all);
        } catch (error) {
          if (signal.aborted) throw error;
          console.error("gain-definitions: the eight recordings failed to load", error);
        }
      }
      return import("./anim-gain-definitions-3d.js");
    },
    onView,
    id: "gain-definitions",
  });
  if (!views.available()) toggle.title = NO_WEBGL_HINT;

  /** @param {PresetName} name */
  function setPreset(name) {
    state.preset = name;
    pressPreset(name);
    views.preset(name);
  }
  for (const button of camera.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => setPreset(/** @type {PresetName} */ (button.getAttribute("data-preset"))), { signal });
  }

  /**
   * One step's state.
   * @param {Record<string, string>} s
   */
  function apply(s) {
    if (s.preset && /** @type {readonly string[]} */ (PRESET_NAMES).includes(s.preset)) {
      setPreset(/** @type {PresetName} */ (s.preset));
    }
    const clip = s.clip && (s.clip === "all" || /** @type {readonly string[]} */ (CLIPS).includes(s.clip)) ? s.clip : state.clip;
    void show(clip, s.pick ?? null);
    // A step picks the view its point needs: a flat plot in 2D, depth in
    // 3D. 3D opens only where the figure would open it by itself; under
    // reduced motion or without WebGL the step reads the same in 2D.
    if (s.view === "2d") views.show2D();
    else if (s.view === "3d" && opensIn3D() && views.available()) void views.show3D();
  }

  pressPreset(state.preset);
  if (steps.length) createStepper(figure, steps, apply, { signal });
  else void show("lr-a", "flattest");

  return () => {
    clearTimeout(labelTimer);
    unsubscribeTheme();
    handle.destroy();
  };
}
