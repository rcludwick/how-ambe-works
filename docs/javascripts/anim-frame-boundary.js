// @ts-check
/* ===========================================================================
 * anim-frame-boundary.js: what each way of crossing a frame boundary does to
 * every harmonic.
 * ---------------------------------------------------------------------------
 * SLUG          frame-boundary   <div data-anim="frame-boundary" markdown="1">,
 *               with a poster fallback and five steps (11-synthesis.md)
 *
 * DATA READ     none. Two synthetic frames, 120 Hz and 120 Hz plus the
 *               pitch change, harmonics 1 to 16 at equal amplitude, every
 *               value in closed form (lib/boundary.js). Nothing here is
 *               measured, nothing is read from a file, and no audio is made.
 *
 * CONTROLS      the rule (Switch, Crossfade, The patent's rule, Voicing
 *               change), the pitch change (0 to 20%, the one free slider),
 *               the 3D view and its camera presets (Front, Oblique, Side).
 *
 * WHAT IT DRAWS One plot across the 20 ms between the frames: every
 *               harmonic's envelope, the level its waveform swings between,
 *               overlaid and coloured by harmonic number, with the waveform
 *               itself under the envelopes of harmonics 1 to 4 for a
 *               switch. The highlight is each rule's subject (topOf). The 3D view (anim-frame-boundary-3d.js)
 *               spreads the harmonics out along depth, one lane each, with
 *               the patent's l < 8 gate as a plane; its Front preset is this
 *               plot, and its Side preset stands each lane's dip as a bar.
 *
 * THE CLAIM     Crossfading two steady oscillators makes each harmonic's
 *               envelope dip where their phases disagree, and the phase
 *               difference grows l times faster at harmonic l: harmonic 1
 *               barely dips, every harmonic from 5 up falls below half,
 *               harmonic 8 is half a cycle out at the midpoint, and above
 *               it the envelope dips more than once. A switch does not
 *               dip but jumps; a sweep neither dips nor jumps. US 5,701,390
 *               sweeps only harmonics below 8, and only when the pitch moved
 *               less than 10%.
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
  TEST_HOOK,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import {
  CARRIERS, CHANGE, F_OLD, GATE_L, HANDOVER, LANES, SCHEMES, T_MS,
  carrier, deepest, envelope, gateOpen, handoverPower, laneMode, newF0, phaseJump, times, weights,
} from "./lib/boundary.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "frame-boundary";

/** Keys a step may set (anim-steps.js). */
const STEP_KEYS = /** @type {const} */ (["scheme", "change", "view", "preset"]);

/** The lane the highlight marks by default: the first one the patent crossfades. */
export const TOP = GATE_L;
/** The handover lane the highlight marks in the voicing change. */
const HAND_TOP = 10;
/** The lane it marks once the pitch gate closes: a low harmonic that now dips. */
const CLOSED_TOP = 4;

/**
 * The highlighted harmonic: each rule's subject. Harmonic 8 for a switch,
 * a crossfade and the patent's rule; harmonic 4 when the pitch gate has
 * closed, so the low harmonics dip too; harmonic 10, one of the handover
 * lanes, in the voicing change.
 * @param {import("./lib/boundary.js").Scheme} scheme
 * @param {number} change
 * @returns {number}
 */
export function topOf(scheme, change) {
  if (scheme === "handover") return HAND_TOP;
  if (scheme === "rule" && !gateOpen(change)) return CLOSED_TOP;
  return TOP;
}

/** How far the waveforms of harmonics 1 to 4 mix toward the plot background, under the envelopes. */
export const WAVE_DIM = 0.45;

/** The waveforms carry only the switch (its phase jump); every other rule draws envelopes alone. */
export const showsWaves = (/** @type {import("./lib/boundary.js").Scheme} */ scheme) => scheme === "switch";

/** A local minimum of an envelope below this counts as a dip. */
const DIP = 0.9;

/** The plot's value range, -EXTENT to EXTENT. */
export const EXTENT = 1.1;

/** @type {readonly string[]} */
const PRESETS = ["front", "oblique", "side"];

/** @type {Record<import("./lib/boundary.js").Scheme, string>} */
const LABELS = { switch: "Switch", crossfade: "Crossfade", rule: "The patent's rule", handover: "Voicing change" };

/**
 * @typedef {Object} Lane
 * @property {number} l  harmonic number
 * @property {import("./lib/boundary.js").LaneMode} mode
 * @property {Float32Array} env  its envelope at each sample
 * @property {Float32Array | null} wave  its waveform (harmonics 1 to 4 only)
 * @property {number} mid  its envelope at 10 ms
 * @property {{level: number, tMs: number, depth: number}} low  its lowest envelope
 * @property {number} jump  the phase jump at 10 ms of a switch, degrees
 * @property {{level: number, tMs: number}[]} dips  its envelope's local minima below 0.9, in time order
 */

/**
 * Everything both views draw, worked out once per change of rule or pitch.
 * The 3D part takes these arrays and computes nothing.
 * @typedef {Object} Model
 * @property {import("./lib/boundary.js").Scheme} scheme
 * @property {number} change  the pitch change, a fraction of 120 Hz
 * @property {number} f1  the new fundamental, Hz
 * @property {boolean} open  the patent's pitch gate holds
 * @property {Float32Array} ts  sample times, ms
 * @property {Lane[]} lanes  harmonics 1 to LANES
 * @property {number} top  the highlighted harmonic
 * @property {string} preset  the 3D camera preset
 */

/**
 * The model for a state.
 * @param {{scheme: import("./lib/boundary.js").Scheme, change: number, preset: string}} s
 * @returns {Model}
 */
export function derive(s) {
  const ts = times();
  /** @type {Lane[]} */
  const lanes = [];
  for (let l = 1; l <= LANES; l += 1) {
    const mode = laneMode(l, s.scheme, s.change);
    const env = new Float32Array(ts.length);
    const wave = l <= CARRIERS ? new Float32Array(ts.length) : null;
    for (let i = 0; i < ts.length; i += 1) {
      env[i] = envelope(mode, l, ts[i], s.change);
      if (wave) wave[i] = carrier(mode, l, ts[i], s.change);
    }
    /** @type {{level: number, tMs: number}[]} */
    const dips = [];
    for (let i = 1; i + 1 < ts.length; i += 1) {
      if (env[i] < env[i - 1] && env[i] <= env[i + 1] && env[i] < DIP) dips.push({ level: env[i], tMs: ts[i] });
    }
    lanes.push({
      l, mode, env, wave,
      mid: envelope(mode, l, T_MS / 2, s.change),
      low: deepest(mode, l, s.change),
      jump: phaseJump(l, s.change),
      dips,
    });
  }
  return {
    scheme: s.scheme, change: s.change, f1: newF0(s.change), open: gateOpen(s.change),
    ts, lanes, top: topOf(s.scheme, s.change), preset: s.preset,
  };
}

/**
 * The plot both views share: the 2D canvas draws in it, and the 3D view's
 * Front preset puts its box exactly on it (lib/orbit.js matchPlot).
 * @param {{width: number, height: number}} size
 * @returns {import("./anim-core.js").Plot}
 */
export function layout(size) {
  const narrow = size.width < 560;
  return createPlot(size, {
    xDomain: [0, T_MS],
    yDomain: [-EXTENT, EXTENT],
    padding: { top: 30, right: 14, bottom: 34, left: narrow ? 30 : 38 },
  });
}

/**
 * How far a lane fades toward the plot background with its distance from
 * the highlight, as lib/style.js fadeAmount() does in 3D (VL3), so the 2D
 * view and the 3D Front read alike. Lanes in front of the highlight fade a
 * further 0.15 (the cutaway rule, at the Front pose).
 * @param {number} l
 * @param {boolean} dark
 * @param {number} [top] the highlighted harmonic
 */
export function laneFade(l, dark, top = TOP) {
  const d = Math.abs(l - top);
  const base = d <= 1 ? 0 : Math.min(dark ? 0.6 : 0.45, 0.12 + 0.06 * (d - 1));
  return Math.min(1, base + (l < top ? 0.15 : 0));
}

/** @param {string} css @returns {number[]} */
const rgbOf = (css) => {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** @param {number[]} a @param {number[]} b @param {number} t */
const mixRGB = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(", ")})`;

/**
 * Harmonic l's colour on the ramp (ramp-0 at 1, ramp-4 at 16), faded.
 * @param {import("./anim-core.js").Theme} th
 * @param {number} l
 * @param {number} top the highlighted harmonic
 * @param {number} [dim] a further mix toward the background
 */
function laneColour(th, l, top, dim = 0) {
  const stops = [0, 1, 2, 3, 4].map((i) => rgbOf(th.css(`--ambe-ramp-${i}`)));
  const x = ((l - 1) / (LANES - 1)) * 4;
  const i = Math.min(3, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f);
  const bg = rgbOf(th.plotBg);
  const faded = laneFade(l, th.dark, top);
  return mixRGB(c, bg, faded + (1 - faded) * dim);
}

/** @param {number} v @param {number} [d] */
const fixed = (v, d = 2) => v.toFixed(d);

/** What the pitch did, for the readout. @param {Model} m */
function pitchText(m) {
  const df = m.f1 - F_OLD;
  const share = (df / m.f1) * 100;
  return `${F_OLD} Hz to ${fixed(m.f1, 1)} Hz: ${fixed(df, 1)} Hz, ${fixed(share, 1)}% of the new fundamental ` +
    `(${m.open ? "under 10%, the gate is open" : "10% or more, the gate is closed"})`;
}

/** @param {Model} m */
function ruleText(m) {
  if (m.scheme === "switch") return "Switch at 10 ms on every harmonic: the old oscillator stops, the new one starts";
  if (m.scheme === "crossfade") return "Crossfade on every harmonic: the old oscillator fades out as the new one fades in";
  const head = m.open
    ? `Harmonics 1 to ${TOP - 1} swept by one oscillator each, ${TOP} to ${LANES} crossfaded`
    : "The pitch gate is closed, so every harmonic is crossfaded";
  return m.scheme === "handover" ? `${head}; ${HANDOVER[0]} to ${HANDOVER[HANDOVER.length - 1]} go from voiced to unvoiced` : head;
}

/** @param {Model} m */
function midText(m) {
  return [1, 4, 8, 12, 16].map((l) => `${l}: ${fixed(m.lanes[l - 1].mid)}`).join(" · ");
}

/** @param {Model} m */
function dipText(m) {
  if (m.scheme === "switch") {
    const [a, b] = [m.lanes[0], m.lanes[TOP - 1]];
    return `none, every envelope stays at 1; the phase jumps ${fixed(a.jump, 0)}° on harmonic 1 and ${fixed(b.jump, 0)}° on harmonic ${TOP}`;
  }
  const worst = m.lanes.reduce((a, b) => (b.low.depth > a.low.depth ? b : a), m.lanes[0]);
  if (worst.low.depth < 1e-6) return "none, every envelope stays at 1";
  const last = m.lanes[LANES - 1];
  const twice = last.mode === "crossfade" && last.dips.length > 1
    ? `; harmonic ${LANES} dips ${last.dips.length === 2 ? "twice" : `${last.dips.length} times`}, to ${last.dips.map((d) => fixed(d.level)).join(" and ")}`
    : "";
  return `harmonic ${worst.l}, down to ${fixed(worst.low.level)} at ${fixed(worst.low.tMs, 1)} ms; harmonic 1 only to ${fixed(m.lanes[0].low.level)}${twice}`;
}

/** @param {Model} m */
function weightText(m) {
  const w = weights(T_MS / 2);
  if (m.scheme === "switch") return "old 1, then new 1: no overlap";
  const sum = `old ${fixed(w.old)}, new ${fixed(w.new)}, sum ${fixed(w.old + w.new)}`;
  if (m.scheme !== "handover") return sum;
  const p = handoverPower(T_MS / 2);
  return `${sum}; harmonics 9 to 12, oscillator and noise uncorrelated: power ${fixed(w.old ** 2)} + ${fixed(w.new ** 2)} = ${fixed(p)} of either frame's`;
}

/**
 * The chip's fact about the highlighted harmonic (3D) and the 2D label.
 * One measure per view: the level at the midpoint in the plot (Front, 2D,
 * Oblique), where the readout "level at 10 ms" gives it too, and the
 * lowest level from the side, where the bars show it.
 * @param {Model} m
 * @param {boolean} [side] the 3D view's Side preset
 * @param {boolean} [short] a phone: the gate's state is left to the step text and the readouts
 */
export function chipText(m, side = false, short = false) {
  const lane = m.lanes[m.top - 1];
  if (lane.mode === "switch") return `harmonic ${lane.l}: phase jumps ${fixed(lane.jump, 0)}°`;
  if (lane.mode === "handover") {
    return `harmonics ${HANDOVER[0]} to ${HANDOVER[HANDOVER.length - 1]}: power ${fixed(handoverPower(T_MS / 2))} at 10 ms`;
  }
  const closed = m.scheme === "rule" && !m.open && !short ? " (gate closed)" : "";
  return side ? `harmonic ${lane.l}: lowest ${fixed(lane.low.level)}${closed}` : `harmonic ${lane.l}: midpoint ${fixed(lane.mid)}${closed}`;
}

/** The legend's words for the highlight. @param {Model} m */
const highlightLegend = (m) => (m.scheme === "handover"
  ? `harmonic ${m.top}, one of ${HANDOVER[0]} to ${HANDOVER[HANDOVER.length - 1]} (thick)`
  : `harmonic ${m.top} (thick)`);

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Harmonic phase and amplitude interpolation across a frame boundary</p>
</div>

<div class="anim-figure__frame" style="--anim-aspect: var(--anim-aspect-house)">
  <canvas class="anim-figure__canvas" role="img" aria-label="Sixteen harmonics crossing a frame boundary."></canvas>
</div>

<div class="anim-figure__step"></div>

<ul class="anim-legend fb-legend">
  <li class="anim-legend__item"><i class="anim-legend__swatch fb-swatch--ramp"></i>each harmonic's envelope, 1 (darkest) to 16</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line fb-swatch--highlight"></i><span data-role="legend-top">harmonic 8 (thick)</span></li>
  <li class="anim-legend__item" data-for="switch" hidden><i class="anim-legend__swatch anim-legend__swatch--line fb-swatch--thin"></i>the waveform of harmonics 1 to 4 (thin)</li>
  <li class="anim-legend__item" data-for="handover" hidden><i class="anim-legend__swatch anim-legend__swatch--dashed fb-swatch--muted"></i>harmonics 9 to 12 going unvoiced: expected level (dashed)</li>
  <li class="anim-legend__item" data-for="3d" hidden><i class="anim-legend__swatch fb-swatch--plane"></i>the patent's gate, l &lt; 8 (plane)</li>
  <li class="anim-legend__item" data-for="3d" hidden><i class="anim-legend__swatch fb-swatch--bar"></i>from the side: each harmonic's bar runs from 1 down to its lowest level</li>
</ul>

<div class="anim-controls">
  <div class="anim-toggle-group" role="group" aria-label="Rule at the boundary">
    ${SCHEMES.map((s) => `<button class="anim-btn" type="button" data-scheme="${s}" aria-pressed="${s === "crossfade"}">${LABELS[s]}</button>`).join("\n    ")}
  </div>
  <label class="anim-field">
    <span class="anim-field__label">Pitch change</span>
    <input class="anim-range" type="range" min="0" max="20" step="1" value="${CHANGE * 100}"
           data-role="change" aria-label="Pitch change from the old frame to the new one, in percent">
    <output class="anim-readout" data-role="change-value">${CHANGE * 100}%</output>
  </label>
</div>
<div class="anim-controls">
  <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
  <div class="anim-controls__group" data-role="camera" hidden>
    <span class="anim-field__label">Camera</span>
    <div class="anim-toggle-group" role="group" aria-label="Camera">
      ${PRESETS.map((p) => `<button class="anim-btn" type="button" data-preset="${p}" aria-pressed="${p === "side"}">${p[0].toUpperCase()}${p.slice(1)}</button>`).join("\n      ")}
    </div>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden>${NO_WEBGL_HINT}</p>

<div class="anim-forms fb-readouts">
  <p class="anim-forms__row"><span class="anim-forms__tag">rule</span>
    <output aria-live="polite" data-role="r-rule"></output></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">pitch</span>
    <output aria-live="polite" data-role="r-pitch"></output></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">level at 10 ms</span>
    <output aria-live="polite" data-role="r-mid"></output></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">deepest dip</span>
    <output aria-live="polite" data-role="r-dip"></output></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">weights at 10 ms</span>
    <output aria-live="polite" data-role="r-weights"></output></p>
</div>

<figcaption class="anim-figure__caption">
  Two made-up frames 20&nbsp;ms apart, ${F_OLD}&nbsp;Hz and then a little
  higher, harmonics 1 to 16 at equal strength and all voiced. Each line is
  one harmonic's envelope, the level its waveform swings between, across
  the 20&nbsp;ms. Both oscillators of a crossfade start in step, so their
  phases drift apart l times faster at harmonic l. The sweep keeps its
  phase continuous from the old oscillator and makes no claim about the
  phase it ends on. The rules and the gate (l&nbsp;&lt;&nbsp;8, a pitch
  change under 10%) follow US&nbsp;5,701,390.
  <span class="fb-badges"><span data-badge="synthetic"></span></span>
  <span class="anim-figure__source">Computed in your browser from closed-form
  expressions. Nothing here is measured, nothing is read from a recording,
  and no sound is made.</span>
</figcaption>
`;

/**
 * Mount the frame-boundary figure into its host.
 * @param {Element} host a `[data-anim="frame-boundary"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const root = document.createElement("figure");
  root.className = "anim-figure anim-figure--frame-boundary";
  root.innerHTML = FIGURE_HTML;
  host.append(root);
  markEnhanced(host);

  const frame = $(root, ".anim-figure__frame", HTMLElement);
  const canvas = $(root, "canvas", HTMLCanvasElement);
  const changeEl = $(root, '[data-role="change"]', HTMLInputElement);
  const changeOut = $(root, '[data-role="change-value"]', HTMLOutputElement);
  const toggle = $(root, '[data-view="3d"]', HTMLButtonElement);
  const camera = $(root, '[data-role="camera"]', HTMLElement);
  const hint = $(root, ".anim-figure__hint--webgl", HTMLElement);
  /** @type {Record<string, HTMLOutputElement>} */
  const out = {};
  for (const key of ["rule", "pitch", "mid", "dip", "weights"]) out[key] = $(root, `[data-role="r-${key}"]`, HTMLOutputElement);
  const schemeEls = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll("button[data-scheme]")]);
  const presetEls = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll("button[data-preset]")]);
  const legend3d = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-for="3d"]')]);
  const legendHandover = $(root, '[data-for="handover"]', HTMLElement);
  const legendSwitch = $(root, '[data-for="switch"]', HTMLElement);
  const legendTop = $(root, '[data-role="legend-top"]', HTMLElement);
  $(root, '[data-badge="synthetic"]', HTMLElement).append(badge("synthetic"));

  /** @type {{scheme: import("./lib/boundary.js").Scheme, change: number, preset: string}} */
  const state = { scheme: "crossfade", change: CHANGE, preset: "side" };
  let model = derive(state);
  const handle = setupCanvas(canvas, { onResize: () => render() });

  // On a phone the 3D view (wanted while its control is pressed: loading,
  // up or parked) gets a 4:3 frame: at 16:9 a 320 px frame left the lane
  // rows over the bars no room, and the deepest bar ran off the foot.
  const shape = () => {
    const deep = toggle.getAttribute("aria-pressed") === "true" && frame.clientWidth < 480;
    const aspect = deep ? "4 / 3" : "var(--anim-aspect-house)";
    if (frame.style.getPropertyValue("--anim-aspect") !== aspect) frame.style.setProperty("--anim-aspect", aspect);
  };
  const pressed = new MutationObserver(shape);
  pressed.observe(toggle, { attributes: true, attributeFilter: ["aria-pressed"] });
  const widths = new ResizeObserver(shape);
  widths.observe(frame);
  signal.addEventListener("abort", () => {
    pressed.disconnect();
    widths.disconnect();
  }, { once: true });
  shape();

  /** Repaint the 2D plot: the 3D view's Front. */
  function render() {
    const m = model;
    const th = getTheme();
    const ctx = handle.ctx;
    clearCanvas(ctx, handle);
    const plot = layout(handle);
    const xTicks = [0, 5, 10, 15, 20];
    drawGrid(ctx, plot, { xTicks, yTicks: [-1, 0, 1] });
    // The 3D view's Front draws these same axes and labels over its own scene (anim-frame-boundary-3d.js).
    drawAxes(ctx, plot, { xTicks, yTicks: [-1, 0, 1], formatX: (v) => `${v}`, formatY: (v) => `${v}`, xLabel: "time between the two frames (ms)" });
    /** @param {Float32Array} ys */
    const series = (ys) => Array.from(ys, (y, i) => ({ x: m.ts[i], y }));
    ctx.save();
    plot.clip(ctx);
    if (m.scheme === "switch") {
      drawPolyline(ctx, [{ x: T_MS / 2, y: -EXTENT }, { x: T_MS / 2, y: EXTENT }], { plot, color: th.muted, width: 1, dash: [3, 4] });
    }
    for (const lane of m.lanes) {
      if (lane.wave && showsWaves(m.scheme)) drawPolyline(ctx, series(lane.wave), { plot, color: laneColour(th, lane.l, m.top, WAVE_DIM), width: 1.1 });
    }
    // Back to front, as the 3D view stacks them: harmonic 16 first.
    for (const lane of [...m.lanes].reverse()) {
      if (lane.l === m.top) continue;
      const dashed = lane.mode === "handover";
      drawPolyline(ctx, series(lane.env), { plot, color: laneColour(th, lane.l, m.top), width: 1.6, dash: dashed ? [5, 4] : undefined });
    }
    const top = m.lanes[m.top - 1];
    drawPolyline(ctx, series(top.env), { plot, color: th.css("--ambe-highlight"), width: 3.25 });
    ctx.restore();
    const label = { baseline: /** @type {const} */ ("top"), size: 11, background: th.plotBg, padding: 3 };
    drawLabel(ctx, `${F_OLD} Hz frame`, plot.area.left + 6, 6, { ...label, align: "left", color: th.text3 });
    drawLabel(ctx, `${fixed(m.f1, 1)} Hz frame`, plot.area.right - 6, 6, { ...label, align: "right", color: th.text3 });
    if (m.scheme === "switch") drawLabel(ctx, "switch", plot.x(T_MS / 2), 6, { ...label, align: "center", color: th.text3 });
    // The highlight's fact, beside its level at 10 ms, the measure it states (the 3D view has the chip).
    const at = top.mode === "switch" ? { t: T_MS / 2, v: 1 } : { t: T_MS / 2, v: top.mid };
    ctx.font = `11px ${th.font}`;
    const text = chipText(m);
    const width = ctx.measureText(text).width + 8;
    const x = Math.min(plot.area.right - 4 - width, Math.max(plot.area.left + 4, plot.x(at.t) + 4));
    drawLabel(ctx, text, x, plot.y(at.v) + 10, { ...label, align: "left", color: th.ink });
  }

  function readouts() {
    const m = model;
    out.rule.textContent = ruleText(m);
    out.pitch.textContent = pitchText(m);
    out.mid.textContent = midText(m);
    out.dip.textContent = dipText(m);
    out.weights.textContent = weightText(m);
    changeOut.textContent = `${Math.round(m.change * 100)}%`;
    legendHandover.hidden = m.scheme !== "handover";
    legendSwitch.hidden = !showsWaves(m.scheme);
    legendTop.textContent = highlightLegend(m);
  }

  /** The 2D canvas's label, from the state. */
  const describe2D = () => {
    const m = model;
    return `Sixteen harmonics across the 20 ms between a frame at ${F_OLD} Hz and one at ${fixed(m.f1, 1)} Hz, ` +
      `each drawn as its envelope. ${ruleText(m)}. Level at 10 ms, by harmonic, ${midText(m)}. Deepest dip: ${dipText(m)}.`;
  };
  let labelTimer = 0;
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      canvas.setAttribute("aria-label", describe2D());
      const c3 = frame.querySelector("canvas.anim-figure__canvas--3d");
      if (c3 && view.describe()) c3.setAttribute("aria-label", view.describe());
    }, 250);
  };

  const view = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: () => model,
    load: () => import("./anim-frame-boundary-3d.js"),
    onView: (v) => {
      const in3d = v === "3d";
      camera.hidden = !in3d;
      for (const item of legend3d) item.hidden = !in3d;
      root.dataset.view = v;
      if (!in3d) render();
      relabel();
    },
  });

  /** @param {boolean} recompute */
  const refresh = (recompute) => {
    if (recompute) model = derive(state);
    render();
    readouts();
    view.update(model);
    relabel();
  };

  /** @param {import("./lib/boundary.js").Scheme} scheme */
  const setScheme = (scheme) => {
    state.scheme = scheme;
    for (const el of schemeEls) el.setAttribute("aria-pressed", String(el.dataset.scheme === scheme));
  };
  /** @param {number} change */
  const setChange = (change) => {
    state.change = change;
    changeEl.value = String(Math.round(change * 100));
  };
  /** @param {string} name */
  const setPreset = (name) => {
    state.preset = name;
    model.preset = name;
    for (const el of presetEls) el.setAttribute("aria-pressed", String(el.dataset.preset === name));
    view.preset(name);
  };

  for (const el of schemeEls) {
    el.addEventListener("click", () => {
      setScheme(/** @type {import("./lib/boundary.js").Scheme} */ (el.dataset.scheme));
      refresh(true);
    }, { signal });
  }
  changeEl.addEventListener("input", () => {
    state.change = Number(changeEl.value) / 100;
    refresh(true);
  }, { signal });
  for (const el of presetEls) {
    el.addEventListener("click", () => setPreset(el.dataset.preset ?? "side"), { signal });
  }

  /** @param {Record<string, string>} step */
  const applyStep = (step) => {
    if (step.scheme && /** @type {readonly string[]} */ (SCHEMES).includes(step.scheme)) {
      setScheme(/** @type {import("./lib/boundary.js").Scheme} */ (step.scheme));
    }
    if (step.change) setChange(Number(step.change) / 100);
    if (step.preset && PRESETS.includes(step.preset)) setPreset(step.preset);
    refresh(true);
    // A step that asks for 3D opens it only where the figure would open in
    // 3D by itself; elsewhere it stays in 2D, where the readouts carry the
    // same numbers. A step that asks for 2D (a flat plot) leaves 3D.
    if (step.view === "3d" && view.view() === "2d" && opensIn3D() && view.available()) void view.show3D();
    else if (step.view === "2d") view.show2D();
  };

  const offTheme = onThemeChange(() => render());
  refresh(true);
  if (steps.length) createStepper(root, steps, applyStep, { signal });

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = {
      model: () => model,
      plot: () => layout({ width: frame.clientWidth, height: frame.clientHeight }).area,
      view: () => view.view(),
    };
  }

  return () => {
    offTheme();
    clearTimeout(labelTimer);
    handle.destroy();
    if (TEST_HOOK) delete TEST_HOOK.figures[SLUG];
  };
}
