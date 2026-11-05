// @ts-check
/* ===========================================================================
 * anim-pitch-search.js: the coarse pitch search's score, candidate by
 * candidate (ch08, "Sub-multiples").
 * ---------------------------------------------------------------------------
 * SLUG          pitch-search    <div data-anim="pitch-search">
 *
 * DATA READ     assets/data/lr-b/correlogram.json (tools/data/correlogram.py):
 *               one stored window of 255 input samples (frame 8 of lr-b),
 *               the whole clip's autocorrelation rows at lags 22 to 114, and
 *               the site's own pitch track. Derived from the input clip.
 *
 * WHAT IT DRAWS One frame: phi, the autocorrelation of w^2(n) s(n) (Griffin
 *               and Lim 1988, eq. 13), with the comb of one candidate period
 *               P, a tooth at every multiple of P; beside it the score
 *               Psi(P) = P x the sum of phi(kP), k = 1, 2, ... (eq. 12
 *               without its k = 0 line; lib/pitch.js says why), at every
 *               candidate from 22 to 114 (US 5,216,747). Two synthetic
 *               windows show the 2P trap and a period between two whole
 *               candidates. Whole clip: one row of phi per frame, as a heat
 *               map, the site tracker's period over it, and the 20%
 *               look-back corridor of US 5,216,747 around it.
 *
 * SCOPE         Display DSP on one window's values (owner decision O3). It
 *               never picks a pitch, never computes the unbiased error and
 *               never runs a tracker: the track is the stored site output.
 *
 * THE 3D VIEW   anim-pitch-search-3d.js, loaded by lib/view-switch.js. One
 *               frame: lag across, phi up, candidate P in depth; phi is a
 *               curtain along depth, every candidate's comb stands on it,
 *               and Psi(P) runs along the end wall. Front is the phi panel,
 *               Side the Psi panel. Whole clip: lag across, phi up, time in
 *               depth; Top is the heat map. It takes its arrays from here.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createPlot,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  loadJSON,
  markEnhanced,
  onThemeChange,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { readSteps, createStepper } from "./anim-steps.js";
import { P_MAX, P_MIN, autocorrelation, comb, corridor, phiAt, psi, psiCurve, synthetic } from "./lib/pitch.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "pitch-search";
const DATA = "assets/data/lr-b/correlogram.json";
const STEP_KEYS = /** @type {const} */ (["mode", "source", "cand", "preset", "pick", "view"]);

/** phi / phi(0), bottom to top, every source. */
export const PHI_DOMAIN = /** @type {[number, number]} */ ([-0.75, 1]);
/** Lags the phi panel shows. */
export const LAG_DOMAIN = /** @type {[number, number]} */ ([0, 254]);
/**
 * Candidates, across the Psi panel: from 20, two short of the searched
 * range, so the score's hump at 23 shows both of its sides. 20 and 21 are
 * drawn faint, outside the range.
 */
export const P_DOMAIN = /** @type {[number, number]} */ ([20, P_MAX]);
/** Psi, bottom to top, per source: room for its lowest and highest score. */
export const PSI_DOMAINS = Object.freeze({ frame: [-25, 50], alternate: [-10, 30], fraction: [-10, 50] });

/**
 * @typedef {Object} Correlogram  assets/data/lr-b/correlogram.json
 * @property {{frame: number, start: number, samples: number[]}} window
 * @property {number} lag_min
 * @property {number} lag_max
 * @property {number} frames
 * @property {number[]} rows  integer percent, frame by frame
 * @property {number[]} tracker_period  samples; 0 where unvoiced
 * @property {number} corridor_exit
 */

/** @typedef {import("./lib/pitch.js").Source} Source */
/** @typedef {"frame" | "clip"} Mode */

/**
 * Everything both views draw, from one state (the 3D part takes this).
 * @typedef {Object} PitchView
 * @property {Mode} mode
 * @property {Source} source
 * @property {number} cand  the candidate period, samples
 * @property {Float64Array} phi  phi / phi(0) at lags 0 to 254
 * @property {Float64Array} curve  Psi at P_MIN to P_MAX
 * @property {[number, number]} psiDomain
 * @property {number | null} tracker  the site tracker's period on the stored
 *           frame, a marker only (frame source)
 * @property {Correlogram} clip
 * @property {number} row  the selected frame, whole-clip mode
 * @property {string} preset  the camera preset the step asks for
 * @property {string} label  the canvas's sentence
 * @property {(p: number) => number} scoreAt  Psi at any candidate, whole or
 *           not (the 3D view's sweep and glide pass between candidates)
 * @property {(p: number) => [number, number][]} teeth  the comb at P: each
 *           tooth's lag and phi there
 * @property {(f: number) => [number, number] | null} corridorAt  the 20%
 *           corridor around frame f - 1's period, null where it is unvoiced
 * @property {number | null} ref  the candidate the chip compares with (46
 *           when the speech frame's comb is at 23)
 */

/* --- layout: the 3D part matches these rectangles -------------------------- */

/** @typedef {{x: number, y: number, width: number, height: number}} Rect */

/**
 * CSS px under a plot whose bottom edge is near the frame's: the 3D view's
 * tick labels sit 14 px under the edge and its axis names 30 px, and
 * lib/labels.js hides a label in the bottom 56 px of the frame.
 */
const FOOT = 88;

/**
 * The plot rectangles of each panel in a frame of this size, CSS px.
 * Wide frames put the Psi panel beside phi; narrow ones put it below.
 * `side` is the score on its own across the frame, the rectangle the 3D
 * view's Side preset fills (the 2D view never draws it alone).
 * @param {number} width
 * @param {number} height
 * @returns {{phi: Rect, psi: Rect, heat: Rect, side: Rect, narrow: boolean}}
 */
export function layout(width, height) {
  const narrow = width < 560;
  const left = narrow ? 34 : 42;
  /** @type {Rect} */
  let phi;
  /** @type {Rect} */
  let psiRect;
  if (narrow) {
    const split = Math.round(height * 0.56);
    phi = { x: left, y: 22, width: width - left - 10, height: split - 22 - 30 };
    psiRect = { x: left, y: split + 22, width: width - left - 10, height: height - split - 22 - 30 };
  } else {
    const gap = Math.round(width * 0.29);
    phi = { x: left, y: 26, width: width - left - gap - 14, height: height - 26 - FOOT };
    psiRect = { x: width - gap + 30, y: 26, width: gap - 30 - 14, height: height - 26 - FOOT };
  }
  const right = narrow ? 14 : 22;
  const heat = { x: left, y: 30, width: width - left - right, height: height - 30 - FOOT };
  const side = { x: left, y: 30, width: width - left - right, height: height - 30 - FOOT };
  return { phi, psi: psiRect, heat, side, narrow };
}

/**
 * A Plot over a rectangle (createPlot's mapping, from a rect).
 * @param {Rect} r
 * @param {[number, number]} xDomain
 * @param {[number, number]} yDomain
 * @param {{width: number, height: number}} size
 */
const plotIn = (r, xDomain, yDomain, size) => createPlot(size, {
  xDomain, yDomain,
  padding: { left: r.x, top: r.y, right: size.width - r.x - r.width, bottom: size.height - r.y - r.height },
});

/** The heat map's x domain: lag cells centred on whole lags. */
export const HEAT_X = /** @type {[number, number]} */ ([P_MIN - 0.5, P_MAX + 0.5]);
/**
 * The heat map's y domain: frame cells centred on whole frames, time up.
 * @param {number} frames
 * @returns {[number, number]}
 */
export const heatY = (frames) => [-0.5, frames - 0.5];

/* --- colour: the ramp, for the 2D heat map -------------------------------- */

/** @param {string} css #rrggbb @returns {number[]} */
const rgbOf = (css) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(css.trim());
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : [128, 128, 128];
};

/**
 * The ramp's five stops, interpolated in sRGB (the 3D view uses OKLab:
 * the two differ by a shade between stops, never in order).
 * @param {import("./anim-core.js").Theme} th
 * @returns {(t: number) => number[]}
 */
const rampOf = (th) => {
  const stops = [0, 1, 2, 3, 4].map((i) => rgbOf(th.css(`--ambe-ramp-${i}`, "#808080")));
  return (t) => {
    const x = Math.min(1, Math.max(0, t)) * 4;
    const i = Math.min(3, Math.floor(x));
    const f = x - i;
    return stops[i].map((c, k) => c + (stops[i + 1][k] - c) * f);
  };
};

/* --- the model ------------------------------------------------------------ */

/** @param {number} p @returns {string} */
const samplesText = (p) => (Number.isInteger(p) ? String(p) : p.toFixed(1));
/** The comb's teeth, to one decimal when P is not whole. @param {number} p @returns {string} */
const teethText = (p) => comb(p).map((t) => (Number.isInteger(p) ? String(t) : t.toFixed(1))).join(", ");
/** @param {number} p period in samples @returns {string} Hz */
const hz = (p) => (8000 / p).toFixed(1);

/**
 * The candidate the chip compares with: 46, when the speech frame's comb
 * is at its half, 23.
 * @param {{mode: Mode, source: Source, cand: number}} s
 * @returns {number | null}
 */
const refOf = (s) => (s.mode === "frame" && s.source === "frame" && s.cand === 23 ? 46 : null);

/**
 * The chip's fact, both views. `narrow` puts a line break before the
 * comparison, for a narrow frame.
 * @param {PitchView} v
 * @param {{narrow?: boolean}} [opts]
 */
export function chipText(v, opts = {}) {
  if (v.mode === "clip") {
    const p = v.clip.tracker_period[v.row];
    return `frame ${v.row}: tracker ${p ? `${p.toFixed(1)} samples` : "unvoiced"}`;
  }
  const at = psi(v.phi, v.cand);
  const head = `P = ${samplesText(v.cand)} samples: Ψ ${at.toFixed(2)}`;
  const ref = refOf(v);
  if (ref) return `${head},${opts.narrow ? "\n" : " "}${Math.round((100 * at) / psi(v.phi, ref))}% of the score at ${ref}`;
  return head;
}

/* --- markup ----------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Pitch period search across candidate delays</p>
  <span data-role="badge"></span>
</div>

<div class="anim-figure__frame" data-state="loading" style="--anim-aspect: var(--anim-ps-aspect, 3 / 2)">
  <canvas class="anim-figure__canvas" role="img" aria-label="The pitch search's score, loading."></canvas>
</div>

<ul class="anim-legend">
  <li class="anim-legend__item" data-show="frame" data-for="2d"><i class="anim-legend__swatch anim-ps__swatch--ink"></i>φ, the autocorrelation of the windowed frame</li>
  <li class="anim-legend__item" data-show="frame" data-for="3d"><i class="anim-legend__swatch anim-ps__swatch--ink"></i>φ, the autocorrelation of the windowed frame, and its curtain along depth</li>
  <li class="anim-legend__item" data-show="frame"><i class="anim-legend__swatch anim-ps__swatch--highlight"></i>the comb at P: a tooth at P, 2P, 3P, … (thick)</li>
  <li class="anim-legend__item" data-show="frame" data-for="3d"><i class="anim-legend__swatch anim-ps__swatch--ramp"></i>every other candidate's comb, set back by P (thin, coloured by tooth number)</li>
  <li class="anim-legend__item" data-show="frame"><i class="anim-legend__swatch anim-ps__swatch--cool"></i>score Ψ(P) = P · Σ φ(kP) over k = 1, 2, 3, …</li>
  <li class="anim-legend__item" data-show="clip"><i class="anim-legend__swatch anim-ps__swatch--ramp"></i>φ of each frame at lags 22 to 114 (dark low, bright high)</li>
  <li class="anim-legend__item" data-show="clip"><i class="anim-legend__swatch anim-ps__swatch--ink"></i>the site tracker's period</li>
  <li class="anim-legend__item" data-show="clip"><i class="anim-legend__swatch anim-legend__swatch--dashed anim-ps__swatch--muted"></i>20% either side of the frame before (US 5,216,747)</li>
  <li class="anim-legend__item" data-show="clip"><i class="anim-legend__swatch anim-ps__swatch--highlight"></i>the tracker's step into this frame (thick arrow), on its row (thin)</li>
  <li class="anim-legend__item" data-show="clip"><i class="anim-legend__swatch anim-ps__swatch--ink"></i>the bracket under the row: that frame's 20% corridor</li>
</ul>

<div class="anim-controls">
  <div class="anim-toggle-group" role="group" aria-label="Data" data-role="mode">
    <button class="anim-btn" type="button" data-mode="frame" aria-pressed="true">One frame</button>
    <button class="anim-btn" type="button" data-mode="clip" aria-pressed="false">Whole clip</button>
  </div>
  <div class="anim-toggle-group" role="group" aria-label="Window" data-role="source" data-show="frame">
    <button class="anim-btn" type="button" data-source="frame" aria-pressed="true">Speech</button>
    <button class="anim-btn" type="button" data-source="alternate" aria-pressed="false">Alternating</button>
    <button class="anim-btn" type="button" data-source="fraction" aria-pressed="false">45.6</button>
  </div>
  <label class="anim-field" data-show="frame">
    <span class="anim-field__label">Candidate P</span>
    <input class="anim-range" type="range" min="${P_MIN}" max="${P_MAX}" step="0.1" value="46"
           data-role="cand" aria-label="Candidate period P, in samples">
  </label>
  <label class="anim-field" data-show="clip">
    <span class="anim-field__label">Frame</span>
    <input class="anim-range" type="range" min="0" max="158" step="1" value="67"
           data-role="row" aria-label="Frame of the clip">
  </label>
</div>

<div class="anim-controls anim-ps__view">
  <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
  <div class="anim-toggle-group" role="group" aria-label="Camera" data-role="camera" hidden>
    <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
    <button class="anim-btn" type="button" data-preset="front" data-show="frame" aria-pressed="false">Front</button>
    <button class="anim-btn" type="button" data-preset="side" data-show="frame" aria-pressed="false">Side</button>
    <button class="anim-btn" type="button" data-preset="top" data-show="clip" aria-pressed="false">Top</button>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>

<output class="anim-readout anim-ps__readout" data-role="readout" aria-live="polite"></output>

<div class="anim-figure__step"></div>

<figcaption class="anim-figure__caption">
  The coarse search scores every whole candidate period P from 22 to 114
  samples (US 5,216,747) by adding the autocorrelation φ at P, 2P, 3P, … and
  multiplying by P (Griffin and Lim 1988, eqs. 12 and 13). Eq. 12 also adds
  k = 0 and the negative k: that is P·φ(0), the same straight line for any
  sound, and the sum drawn here once more. The figure leaves both out so the
  peaks show. It never picks a pitch. Speech: 255 samples of lr-b around
  frame 8, Hamming windowed (a display choice), and the site's own pitch
  track, a generic tracker described in SCHEMA.md, not the codec's.
  Alternating and 45.6 are formulas.
  <span class="anim-figure__source" data-role="source-badge"></span>
</figcaption>
`;

/* --- module -------------------------------------------------------------- */

/**
 * Mount the pitch-search figure.
 * @param {Element} host a `[data-anim="pitch-search"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>} cleanup
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-ps";
  figure.dataset.view = "2d";
  figure.dataset.mode = "frame";
  figure.innerHTML = FIGURE_HTML;
  const fallback = host.querySelector(":scope > .anim-fallback");
  if (fallback) fallback.after(figure);
  else host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const candEl = $(figure, '[data-role="cand"]', HTMLInputElement);
  const rowEl = $(figure, '[data-role="row"]', HTMLInputElement);
  const readout = $(figure, '[data-role="readout"]', HTMLOutputElement);
  const toggle = $(figure, '[data-view="3d"]', HTMLButtonElement);
  const camera = $(figure, '[data-role="camera"]', HTMLElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const badgeHead = $(figure, '[data-role="badge"]', HTMLElement);
  const badgeFoot = $(figure, '[data-role="source-badge"]', HTMLElement);
  const presets = /** @type {HTMLButtonElement[]} */ ([...camera.querySelectorAll("[data-preset]")]);
  const modeButtons = /** @type {HTMLButtonElement[]} */ ([...figure.querySelectorAll("[data-mode]")]).filter((b) => b.tagName === "BUTTON");
  const sourceButtons = /** @type {HTMLButtonElement[]} */ ([...figure.querySelectorAll("button[data-source]")]);
  hint.textContent = NO_WEBGL_HINT;
  if (!steps.length) $(figure, ".anim-figure__step", HTMLElement).remove();

  /** @type {Correlogram} */
  let clip;
  try {
    clip = await loadJSON(DATA, { signal });
  } catch (error) {
    if (signal.aborted) return () => {};
    frame.dataset.state = "error";
    throw error;
  }
  if (signal.aborted) return () => {};
  frame.dataset.state = "ready";
  rowEl.max = String(clip.frames - 1);

  /** The phi of each source, computed once. @type {Map<Source, Float64Array>} */
  const phis = new Map();
  /** @param {Source} source */
  const phiOf = (source) => {
    let phi = phis.get(source);
    if (!phi) {
      phi = autocorrelation(source === "frame" ? clip.window.samples : synthetic(source));
      phis.set(source, phi);
    }
    return phi;
  };
  /** @type {Map<Source, Float64Array>} */
  const curves = new Map();
  /** @param {Source} source */
  const curveOf = (source) => {
    let curve = curves.get(source);
    if (!curve) {
      curve = psiCurve(phiOf(source));
      curves.set(source, curve);
    }
    return curve;
  };

  const state = {
    mode: /** @type {Mode} */ ("frame"),
    source: /** @type {Source} */ ("frame"),
    cand: 46,
    row: clip.corridor_exit,
    preset: "corner",
  };

  /** @returns {PitchView} */
  const view = () => ({
    ...state,
    phi: phiOf(state.source),
    curve: curveOf(state.source),
    psiDomain: /** @type {[number, number]} */ ([...PSI_DOMAINS[state.source]]),
    tracker: state.source === "frame" ? clip.tracker_period[clip.window.frame] : null,
    clip,
    label: describe2D(),
    scoreAt: (p) => psi(phiOf(state.source), p),
    teeth: (p) => comb(p).map((lag) => /** @type {[number, number]} */ ([lag, phiAt(phiOf(state.source), lag)])),
    corridorAt: (f) => {
      const before = clip.tracker_period[f - 1];
      return f > 0 && before ? corridor(before) : null;
    },
    ref: refOf(state),
  });

  const handle = setupCanvas(canvas, { onResize: () => render() });
  /** The heat map's pixels, made once per theme. @type {HTMLCanvasElement | null} */
  let heatImage = null;
  let heatScheme = "";

  function render() {
    const th = getTheme();
    const g = handle.ctx;
    clearCanvas(g, handle);
    const L = layout(handle.width, handle.height);
    if (state.mode === "clip") drawClip(g, th, L);
    else drawFrame(g, th, L);
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {import("./anim-core.js").Theme} th
   * @param {ReturnType<typeof layout>} L
   */
  function drawFrame(g, th, L) {
    const v = view();
    const hi = th.css("--ambe-highlight", th.accentWarm);
    const size = { width: handle.width, height: handle.height };
    const plot = plotIn(L.phi, LAG_DOMAIN, PHI_DOMAIN, size);
    const lagTicks = L.narrow ? [0, 100, 200] : [0, 50, 100, 150, 200, 250];
    drawGrid(g, plot, { xTicks: lagTicks, yTicks: [-0.5, 0, 0.5, 1] });
    drawAxes(g, plot, { xTicks: lagTicks, yTicks: [-0.5, 0, 0.5, 1], xLabel: L.narrow ? "" : "lag, samples" });
    drawLabel(g, L.narrow ? "φ / φ(0), by lag" : "φ / φ(0)", plot.area.left, plot.area.top - 8, { size: 11, color: th.muted });
    g.save();
    plot.clip(g);
    drawPolyline(g, Array.from(v.phi, (y, m) => [m, y]), { plot, color: th.ink, width: 1.4 });
    // The comb: a tooth at every multiple of P, from 0 to phi there.
    g.strokeStyle = hi;
    g.fillStyle = hi;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(plot.x(0), plot.y(0));
    g.lineTo(plot.x(LAG_DOMAIN[1]), plot.y(0));
    g.stroke();
    for (const lag of comb(v.cand)) {
      const y = phiAt(v.phi, lag);
      g.beginPath();
      g.moveTo(plot.x(lag), plot.y(0));
      g.lineTo(plot.x(lag), plot.y(y));
      g.stroke();
      g.beginPath();
      g.arc(plot.x(lag), plot.y(y), 3.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    const sp = plotIn(L.psi, P_DOMAIN, v.psiDomain, size);
    const [lo, top] = v.psiDomain;
    const psiTicks = [lo, 0, top / 2, top].filter((t, i, a) => a.indexOf(t) === i);
    const pTicks = [23, 46, 69, 92, 114];
    drawGrid(g, sp, { xTicks: pTicks, yTicks: psiTicks });
    drawAxes(g, sp, { xTicks: pTicks, yTicks: psiTicks, xLabel: L.narrow ? "" : "candidate P, samples" });
    drawLabel(g, L.narrow ? "score Ψ, by candidate P" : "score Ψ(P)", sp.area.left, sp.area.top - 8, { size: 11, color: th.muted });
    g.save();
    sp.clip(g);
    // 20 and 21 lie outside the searched range: shaded, the score faint.
    g.fillStyle = th.muted;
    g.globalAlpha = 0.14;
    g.fillRect(sp.x(P_DOMAIN[0]), sp.area.top, sp.x(P_MIN) - sp.x(P_DOMAIN[0]), sp.area.bottom - sp.area.top);
    g.globalAlpha = 1;
    g.setLineDash([3, 3]);
    drawPolyline(g, [P_DOMAIN[0], P_DOMAIN[0] + 1, P_MIN].map((p) => [p, v.scoreAt(p)]), { plot: sp, color: th.accentCool, width: 1.4 });
    g.setLineDash([]);
    drawPolyline(g, Array.from(v.curve, (y, i) => [P_MIN + i, y]), { plot: sp, color: th.accentCool, width: 2 });
    if (v.ref) {
      // The comparison the chip states: the score at 46, and the level at 23.
      const at = v.scoreAt(v.cand);
      g.strokeStyle = th.muted;
      g.lineWidth = 1.2;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(sp.x(v.ref), sp.y(0));
      g.lineTo(sp.x(v.ref), sp.y(v.scoreAt(v.ref)));
      g.moveTo(sp.x(v.cand), sp.y(at));
      g.lineTo(sp.x(v.ref), sp.y(at));
      g.stroke();
      g.setLineDash([]);
    }
    if (v.tracker) {
      // The site tracker's period on this frame: a marker, not a choice.
      g.strokeStyle = th.muted;
      g.setLineDash([2, 3]);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(sp.x(v.tracker), sp.area.top);
      g.lineTo(sp.x(v.tracker), sp.area.bottom);
      g.stroke();
      g.setLineDash([]);
    }
    g.strokeStyle = hi;
    g.fillStyle = hi;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(sp.x(v.cand), sp.y(0));
    g.lineTo(sp.x(v.cand), sp.y(psi(v.phi, v.cand)));
    g.stroke();
    g.beginPath();
    g.arc(sp.x(v.cand), sp.y(psi(v.phi, v.cand)), 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
    if (v.tracker && !L.narrow) {
      // At the top of its dotted line, beside the heading.
      drawLabel(g, `site tracker ${v.tracker.toFixed(1)}`, sp.x(v.tracker) + 4, sp.area.top + 10, { size: 10, color: th.muted });
    }
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {import("./anim-core.js").Theme} th
   * @param {ReturnType<typeof layout>} L
   */
  function drawClip(g, th, L) {
    const size = { width: handle.width, height: handle.height };
    const plot = plotIn(L.heat, HEAT_X, heatY(clip.frames), size);
    const lags = clip.lag_max - clip.lag_min + 1;
    if (!heatImage || heatScheme !== th.scheme) {
      heatImage = document.createElement("canvas");
      heatImage.width = lags;
      heatImage.height = clip.frames;
      const c = /** @type {CanvasRenderingContext2D} */ (heatImage.getContext("2d"));
      const img = c.createImageData(lags, clip.frames);
      const ramp = rampOf(th);
      for (let f = 0; f < clip.frames; f += 1) {
        for (let m = 0; m < lags; m += 1) {
          const [r, gg, b] = ramp(clip.rows[f * lags + m] / 100);
          const o = ((clip.frames - 1 - f) * lags + m) * 4;
          img.data[o] = r;
          img.data[o + 1] = gg;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      }
      c.putImageData(img, 0, 0);
      heatScheme = th.scheme;
    }
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(heatImage, L.heat.x, L.heat.y, L.heat.width, L.heat.height);
    g.restore();
    const secs = [0, 1, 2, 3].filter((s) => s * 50 < clip.frames);
    drawAxes(g, plot, {
      xTicks: [22, 46, 69, 92, 114], yTicks: secs.map((s) => s * 50), formatY: (f) => `${(f * 0.02).toFixed(0)} s`,
      xLabel: L.narrow ? "" : "lag, samples",
    });
    // The bracket: the range the search covers.
    const by = L.heat.y - 9;
    g.save();
    g.strokeStyle = th.muted;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(plot.x(22), by + 5);
    g.lineTo(plot.x(22), by);
    g.lineTo(plot.x(114), by);
    g.lineTo(plot.x(114), by + 5);
    g.stroke();
    g.restore();
    drawLabel(g, "22 ≤ P < 115, the range US 5,216,747 searches", plot.x(68), by - 3, { size: 10, align: "center", color: th.muted });

    g.save();
    plot.clip(g);
    // The corridor: 20% either side of the frame before, where both are voiced.
    const per = clip.tracker_period;
    g.strokeStyle = th.ink;
    g.globalAlpha = 0.7;
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    for (const side of [0, 1]) {
      g.beginPath();
      let on = false;
      for (let f = 1; f < clip.frames; f += 1) {
        if (!per[f - 1]) {
          on = false;
          continue;
        }
        const x = plot.x(corridor(per[f - 1])[side]);
        if (on) g.lineTo(x, plot.y(f));
        else g.moveTo(x, plot.y(f));
        on = true;
      }
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    // The site tracker's period, broken where it calls a frame unvoiced.
    g.lineWidth = 2;
    g.beginPath();
    let on = false;
    for (let f = 0; f < clip.frames; f += 1) {
      if (!per[f]) {
        on = false;
        continue;
      }
      if (on) g.lineTo(plot.x(per[f]), plot.y(f));
      else g.moveTo(plot.x(per[f]), plot.y(f));
      on = true;
    }
    g.stroke();
    // This frame: a thin row, the corridor around the frame before as a
    // bracket on it, and the tracker's step into it as the thick arrow.
    const hi = th.css("--ambe-highlight", th.accentWarm);
    const v = view();
    const y = plot.y(state.row);
    g.strokeStyle = hi;
    g.globalAlpha = 0.6;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(L.heat.x, y);
    g.lineTo(L.heat.x + L.heat.width, y);
    g.stroke();
    g.globalAlpha = 1;
    const band = v.corridorAt(state.row);
    if (band) {
      g.strokeStyle = th.ink;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(plot.x(band[0]), y);
      g.lineTo(plot.x(band[0]), y + 5);
      g.lineTo(plot.x(band[1]), y + 5);
      g.lineTo(plot.x(band[1]), y);
      g.stroke();
    }
    const now = per[state.row];
    const before = per[state.row - 1];
    /** @type {[number, number] | null} */
    let anchor = null;
    if (now) {
      const to = /** @type {[number, number]} */ ([plot.x(now), y]);
      const from = before ? [plot.x(before), plot.y(state.row - 1)] : [to[0] - 10, y];
      g.strokeStyle = hi;
      g.fillStyle = hi;
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(from[0], from[1]);
      g.lineTo(to[0], to[1]);
      g.stroke();
      const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
      g.beginPath();
      g.moveTo(to[0], to[1]);
      g.lineTo(to[0] - 8 * Math.cos(a - 0.45), to[1] - 8 * Math.sin(a - 0.45));
      g.lineTo(to[0] - 8 * Math.cos(a + 0.45), to[1] - 8 * Math.sin(a + 0.45));
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(from[0], from[1], 3, 0, Math.PI * 2);
      g.fill();
      anchor = to;
    }
    g.restore();
    // The chip, right of the arrow's head and clear of the ridge.
    const text = chipText(v);
    g.save();
    g.font = `400 11px ${th.font}`;
    const tw = g.measureText(text).width + 6;
    g.restore();
    const cx = anchor ? Math.min(anchor[0] + 14, L.heat.x + L.heat.width - tw) : L.heat.x + L.heat.width - tw;
    drawLabel(g, text, cx + 3, y - 12, {
      size: 11, color: th.ink, background: th.css("--ambe-highlight-chip", th.plotBg), padding: 3,
    });
  }

  /** The 2D canvas's sentence. */
  function describe2D() {
    if (state.mode === "clip") {
      const p = clip.tracker_period;
      const [a, b] = p[state.row - 1] ? corridor(p[state.row - 1]) : [0, 0];
      return "The autocorrelation of every frame of the input clip lr-b at lags 22 to 114, as a heat map, lag " +
        "across and time up, with the site tracker's period drawn over it and dashed lines 20% either side of " +
        `the frame before. Frame ${state.row}: tracker ${p[state.row] ? `${p[state.row].toFixed(1)} samples` : "unvoiced"}` +
        (a ? `, corridor ${a.toFixed(1)} to ${b.toFixed(1)} samples.` : ".");
    }
    const phi = phiOf(state.source);
    const what = state.source === "frame" ? "255 samples of the input clip lr-b around frame 8"
      : state.source === "alternate" ? "a synthetic pulse train, a pulse every 46 samples, every second one a different shape"
        : "a synthetic pulse train, a pulse every 45.6 samples";
    return `The autocorrelation φ of ${what}, with a comb of teeth at every multiple of the candidate period, ` +
      `and beside it the score Ψ at every candidate from 22 to 114 samples. Candidate ${samplesText(state.cand)} ` +
      `samples: teeth at ${teethText(state.cand)}; Ψ ${psi(phi, state.cand).toFixed(2)}.`;
  }

  function readouts() {
    if (state.mode === "clip") {
      const p = clip.tracker_period;
      const [a, b] = p[state.row - 1] ? corridor(p[state.row - 1]) : [0, 0];
      readout.value = `Frame ${state.row} (${(state.row * 0.02).toFixed(2)} s): site tracker ` +
        `${p[state.row] ? `${p[state.row].toFixed(1)} samples` : "unvoiced"}` +
        (a ? `; 20% corridor from frame ${state.row - 1}: ${a.toFixed(1)} to ${b.toFixed(1)} samples` : "");
      return;
    }
    const phi = phiOf(state.source);
    readout.value = `P = ${samplesText(state.cand)} samples (${hz(state.cand)} Hz): teeth at ` +
      `${teethText(state.cand)}; Ψ(P) = ${psi(phi, state.cand).toFixed(2)}`;
  }

  let labelTimer = 0;
  const describe = () => {
    window.clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => canvas.setAttribute("aria-label", describe2D()), 250);
  };

  /** @param {"2d" | "3d" | "parked"} next */
  const onView = (next) => {
    const live = next === "3d";
    figure.dataset.view = live ? "3d" : "2d";
    camera.hidden = !live;
    if (!live) render();
  };

  const switcher = createViewSwitch({
    frame, flat: canvas, toggle, hint, signal,
    state: view,
    load: () => import("./anim-pitch-search-3d.js"),
    onView, id: SLUG,
    onDrag: () => presets.forEach((b) => b.setAttribute("aria-pressed", "false")),
  });

  /** Show the pressed preset; hide the ones this mode has not. */
  const pressPreset = () => {
    for (const b of presets) b.setAttribute("aria-pressed", String(b.dataset.preset === state.preset));
  };

  /** Apply the state to the controls, both views and the readouts. */
  function sync() {
    figure.dataset.mode = state.mode;
    for (const b of modeButtons) b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
    for (const b of sourceButtons) b.setAttribute("aria-pressed", String(b.dataset.source === state.source));
    candEl.value = String(state.cand);
    rowEl.value = String(state.row);
    const kind = state.mode === "frame" && state.source !== "frame" ? "synthetic" : "derived-input";
    if (badgeHead.dataset.kind !== kind) {
      badgeHead.dataset.kind = kind;
      badgeHead.replaceChildren(badge(kind));
      badgeFoot.replaceChildren(badge(kind));
    }
    pressPreset();
    render();
    readouts();
    describe();
    switcher.update(view());
    if (TEST_HOOK) TEST_HOOK.figures[SLUG] = { state: { ...state }, label: describe2D() };
  }

  /** The preset a mode opens on, when the step names none. @param {Mode} mode */
  const homePreset = (mode) => (mode === "clip" ? "corner" : "corner");

  /** @param {Partial<typeof state>} next */
  function set(next) {
    const modeChanged = next.mode !== undefined && next.mode !== state.mode;
    Object.assign(state, next);
    if (modeChanged && next.preset === undefined) state.preset = homePreset(state.mode);
    if (state.mode === "frame" && state.preset === "top") state.preset = "corner";
    if (state.mode === "clip" && (state.preset === "front" || state.preset === "side")) state.preset = "corner";
    sync();
    switcher.preset(state.preset);
  }

  for (const b of modeButtons) {
    b.addEventListener("click", () => set({ mode: /** @type {Mode} */ (b.dataset.mode) }), { signal });
  }
  for (const b of sourceButtons) {
    b.addEventListener("click", () => set({ source: /** @type {Source} */ (b.dataset.source) }), { signal });
  }
  candEl.addEventListener("input", () => {
    state.cand = Math.round(Number(candEl.value) * 10) / 10;
    sync();
  }, { signal });
  rowEl.addEventListener("input", () => {
    state.row = Number(rowEl.value);
    sync();
  }, { signal });
  for (const button of presets) {
    button.addEventListener("click", () => {
      const name = button.dataset.preset ?? "corner";
      if (!switcher.preset(name)) return;
      state.preset = name;
      pressPreset();
      switcher.update(view());
    }, { signal });
  }

  const offTheme = onThemeChange(() => render());
  sync();

  if (steps.length) {
    createStepper(figure, steps, (s) => {
      /** @type {Partial<typeof state>} */
      const next = {};
      if (s.mode === "frame" || s.mode === "clip") next.mode = s.mode;
      if (s.source === "frame" || s.source === "alternate" || s.source === "fraction") next.source = s.source;
      if (s.cand !== undefined && Number.isFinite(Number(s.cand))) next.cand = Number(s.cand);
      if (s.preset) next.preset = s.preset;
      if (s.pick === "corridor-exit") next.row = clip.corridor_exit;
      set(next);
      // The step picks the view that fits its graph: 2D for a flat one.
      if (s.view === "2d") switcher.show2D();
      if (s.view === "3d") void switcher.show3D();
    }, { signal });
  }

  return () => {
    window.clearTimeout(labelTimer);
    offTheme();
    handle.destroy();
  };
}
