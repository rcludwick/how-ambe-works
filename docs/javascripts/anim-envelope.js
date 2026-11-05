// @ts-check
/* ===========================================================================
 * anim-envelope.js: "envelope", harmonic levels over one voiced stretch and
 * the envelope they draw (ch09; three-everywhere design §2.1, §4.7).
 * ---------------------------------------------------------------------------
 * SLUG      envelope
 *
 * DATA READ (precomputed, site-root-relative; see docs/assets/data/SCHEMA.md)
 *   assets/data/spectra.json   FFT magnitude of the input audio, per frame,
 *                              in whole dBFS
 *   assets/data/frames.json    per-frame pitch, level and voicing of the input
 *
 * Views:
 *   - 2D (Canvas 2D): one frame of the stretch. Each dot is the level of one
 *     harmonic of the frame's pitch (lib/harmonics.js envelopeAmplitudes,
 *     up to the cutoff in lib/cutoff.js); the line through the dots is a
 *     curve for the eye. "Neighbouring frames" rings the previous and next
 *     frames' dots, so the steps that compare frames read without WebGL.
 *   - 3D (anim-envelope-3d.js, loaded only when wanted): the frames of the
 *     stretch as a waterfall, depth is time. Its Front preset is this plot.
 *
 * The stretch and its frame come from lib/picks.js voicedStretch ("voiced-
 * stretch"): lr-b frames 95 to 124, frame 112.
 *
 * WHAT THIS FILE IS NOT
 *   A drawing program. It holds no AMBE analysis, no quantizer, no codebook,
 *   no bit packing and no synthesis. The levels are read off a precomputed
 *   FFT of the input WAV at multiples of a precomputed pitch estimate; the
 *   "Amplitude step" control is Math.round(dB / step) * step, plain
 *   rounding for illustration. The codec's own amplitude representation is
 *   not observable from outside the chip (SCHEMA.md, "What is deliberately
 *   absent") and is not modelled here.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createPlot,
  crisp,
  drawAxes,
  drawGrid,
  drawPolyline,
  getTheme,
  loadJSON,
  markEnhanced,
  onThemeChange,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { CUTOFF_BADGE, CUTOFF_HZ, CUTOFF_LABEL } from "./lib/cutoff.js";
import { envelopeAmplitudes } from "./lib/harmonics.js";
import { ENVELOPE_PICKS } from "./lib/picks.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "envelope";
const STEP_KEYS = /** @type {const} */ (["pick", "at", "round", "spectrum", "neighbours", "view", "preset"]);

/** Rounding grids offered by the slider, in dB; 0 is no rounding. The data
 *  is whole dB, so grids of 0.5 and 1 dB would change nothing. */
export const STEPS_DB = [0, 1.5, 2, 3, 4, 6, 9, 12];

/** The plot's frequency range, Hz. */
export const X_DOMAIN = /** @type {[number, number]} */ ([0, 4000]);

/** Camera presets of the 3D view, in the order of the Camera group. */
export const PRESET_NAMES = /** @type {const} */ (["corner", "front", "top"]);

const DESCRIBE_MS = 250;

/**
 * @typedef {{x: number, y: number}} XY
 * @typedef {{m: number, hz: number, db: number}} Harmonic
 */

/**
 * One frame of the stretch, as both views draw it.
 * @typedef {Object} Row
 * @property {number} i  frame index in the clip
 * @property {number} t  seconds
 * @property {number} f0  input pitch, Hz
 * @property {Harmonic[]} harmonics  every harmonic up to the cutoff
 * @property {number[]} shown  each level at the displayed precision, dB
 * @property {XY[]} curve  the line through the shown dots (Hz, dB)
 * @property {XY[]} exact  the line through the exact levels
 * @property {[number, number]} y  the frame's own dB range (yDomain)
 */

/**
 * What the 3D part draws: the 2D module's arrays, nothing to compute.
 * @typedef {Object} EnvelopeState
 * @property {Row[]} rows  the stretch, in time order
 * @property {number} selected  index into rows
 * @property {number} step  rounding grid, dB (0: none)
 * @property {number} error  RMS of the rounding on the selected frame, dB
 * @property {boolean} spectrum  draw the selected frame's input spectrum
 * @property {XY[]} trace  that spectrum (Hz, dB), clamped to its y range
 * @property {[number, number]} runY  a dB range that holds every row
 * @property {(width: number, height: number) => import("./lib/orbit.js").PlotRect} plotRect
 *           the 2D plot's area for a frame of that size
 * @property {string | null} preset  a camera preset a step asks for
 */

/* ---------------------------------------------------------------------------
 * Display maths, shared with the 3D part through the state
 * ------------------------------------------------------------------------ */

/**
 * The y range a frame is drawn in: 9 dB of room above its loudest
 * harmonic and below its quietest, on 5 dB lines, at least 40 dB tall.
 * The 3D Front preset fits the same range.
 * @param {number[]} dbs
 * @returns {[number, number]}
 */
export function yDomain(dbs) {
  const hi = Math.max(...dbs);
  const lo = Math.min(...dbs);
  const top = Math.ceil((hi + 9) / 5) * 5;
  return [Math.min(Math.floor((lo - 9) / 5) * 5, top - 40), top];
}

/**
 * The plot for a canvas of this size: the 2D drawing and the 3D Front fit
 * both use it, so the two views put a harmonic at the same pixel.
 * @param {{width: number, height: number}} size
 * @param {[number, number]} y
 */
export function plotFor(size, y) {
  const compact = size.width < 520;
  return createPlot(size, {
    xDomain: X_DOMAIN,
    yDomain: y,
    padding: { top: 12, right: 14, bottom: compact ? 34 : 42, left: 46 },
  });
}

/**
 * Uniform Catmull-Rom through evenly spaced points: a smooth curve for the
 * eye, nothing more.
 * @param {XY[]} points sorted, equally spaced in x
 * @param {number} [perSegment=6]
 * @returns {XY[]}
 */
export function smoothCurve(points, perSegment = 6) {
  if (points.length < 3) return points.slice();
  const p = [points[0], ...points, points[points.length - 1]];
  /** @type {XY[]} */
  const out = [];
  for (let i = 1; i < p.length - 2; i += 1) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    for (let s = 0; s < perSegment; s += 1) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      /** @param {"x" | "y"} k */
      const at = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push({ x: at("x"), y: at("y") });
    }
  }
  out.push(p[p.length - 2]);
  return out;
}

/** @param {number} db @param {number} step */
const coarsen = (db, step) => (step > 0 ? Math.round(db / step) * step : db);

/**
 * RMS of the change rounding made to a frame's levels, dB.
 * @param {Row} row
 * @returns {number}
 */
export function roundingError(row) {
  let sum = 0;
  row.harmonics.forEach((h, k) => {
    sum += (row.shown[k] - h.db) ** 2;
  });
  return row.harmonics.length ? Math.sqrt(sum / row.harmonics.length) : 0;
}

/* ---------------------------------------------------------------------------
 * Markup
 * ------------------------------------------------------------------------ */

const TEMPLATE = `
  <div class="anim-figure__head">
    <p class="anim-figure__title">Harmonic amplitude quantization across voiced frames</p>
  </div>
  <div class="anim-figure__frame anim-env__frame" data-state="loading">
    <canvas class="anim-figure__canvas" role="img" aria-label="Loading the harmonic levels of one frame"></canvas>
  </div>
  <div class="anim-env__readouts">
    <p class="anim-env__line"><output class="anim-env__frame-info" data-ref="info"></output>
      <span class="anim-env__cutoff" data-ref="cutoff"></span></p>
    <p class="anim-env__line"><output class="anim-env__error" data-ref="error" aria-live="polite"></output>
      <output class="anim-env__hover" data-ref="hover" aria-live="polite"></output></p>
  </div>
  <div class="anim-figure__step"></div>
  <ul class="anim-legend">
    <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch anim-env__key--dot"></i>harmonic level (dot)</li>
    <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch anim-legend__swatch--line anim-env__key--highlight"></i>envelope through the dots</li>
    <li class="anim-legend__item" data-ref="key-ghost"><i class="anim-legend__swatch anim-env__key--dashed"></i>envelope before rounding (dashed)</li>
    <li class="anim-legend__item" data-ref="key-moved"><i class="anim-legend__swatch anim-env__key--moved"></i>how far each level moved (stem)</li>
    <li class="anim-legend__item" data-for="2d" data-ref="key-ring"><i class="anim-legend__swatch anim-env__key--ring"></i>previous and next frame (ring)</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-legend__swatch--line anim-env__key--highlight"></i>this frame (thick, outlined)</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-legend__swatch--line anim-env__key--ramp"></i>the other frames, 20 ms apart, earlier to later (thin, coloured by time)</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-env__key--dots"></i>one dot per harmonic, coloured by time</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-env__key--end"></i>where each frame's harmonics end (tick)</li>
    <li class="anim-legend__item" data-ref="key-spectrum"><i class="anim-legend__swatch anim-legend__swatch--line anim-env__key--spectrum"></i>input spectrum of this frame (faint)</li>
  </ul>
  <div class="anim-controls">
    <label class="anim-field">
      <span class="anim-field__label">Amplitude step</span>
      <input class="anim-range" data-ref="step" type="range" min="0" max="${STEPS_DB.length - 1}" step="1" value="0"
             aria-label="Amplitude rounding step, in decibels">
    </label>
    <output class="anim-readout" data-ref="step-out">exact</output>
    <label class="anim-field">
      <span class="anim-field__label">Frame</span>
      <input class="anim-range" data-ref="frame" type="range" min="0" max="0" step="1" value="0"
             aria-label="Which 20 millisecond frame of the stretch to show">
    </label>
    <output class="anim-readout anim-readout--wide" data-ref="frame-out"></output>
  </div>
  <div class="anim-controls">
    <label class="anim-controls__group anim-env__check">
      <input class="anim-check" data-ref="spectrum" type="checkbox" checked>
      <span class="anim-field__label">Input spectrum</span>
    </label>
    <label class="anim-controls__group anim-env__check">
      <input class="anim-check" data-ref="neighbours" type="checkbox">
      <span class="anim-field__label">Neighbouring frames</span>
    </label>
    <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
    <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
      <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
      <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
      <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
    </div>
  </div>
  <p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
  <figcaption class="anim-figure__caption">One voiced stretch of the input audio, a
    vowel, 20 ms per frame. Each dot is the level of one harmonic of the
    frame's pitch, read as the largest of the three spectrum bins nearest it;
    the line through the dots is drawn for the eye. The rounding is
    round(dB / step) × step, arithmetic for illustration: AMBE's quantizer
    predicts from the previous frame and uses trained codebooks whose
    contents are not public (US 5,630,011). The chip reports no amplitude
    parameters, so no figure on this site shows them.
    <span class="anim-figure__source">Source: <code>assets/data/spectra.json</code>, an FFT of
    the input audio in whole dB, sampled at multiples of the input pitch in
    <code>assets/data/frames.json</code>.</span></figcaption>`;

/* ---------------------------------------------------------------------------
 * Mount
 * ------------------------------------------------------------------------ */

/**
 * @param {Element} host  an element carrying data-anim="envelope"
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-env";
  figure.dataset.view = "2d";
  figure.innerHTML = TEMPLATE;
  const fallback = host.querySelector(":scope > .anim-fallback");
  if (fallback) fallback.after(figure);
  else host.append(figure);
  markEnhanced(host);

  const frameBox = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frameBox, "canvas", HTMLCanvasElement);
  const info = $(figure, '[data-ref="info"]', HTMLOutputElement);
  const cutoff = $(figure, '[data-ref="cutoff"]', HTMLElement);
  const errorOut = $(figure, '[data-ref="error"]', HTMLOutputElement);
  const hoverOut = $(figure, '[data-ref="hover"]', HTMLOutputElement);
  const stepInput = $(figure, '[data-ref="step"]', HTMLInputElement);
  const stepOut = $(figure, '[data-ref="step-out"]', HTMLOutputElement);
  const frameInput = $(figure, '[data-ref="frame"]', HTMLInputElement);
  const frameOut = $(figure, '[data-ref="frame-out"]', HTMLOutputElement);
  const spectrumInput = $(figure, '[data-ref="spectrum"]', HTMLInputElement);
  const neighboursInput = $(figure, '[data-ref="neighbours"]', HTMLInputElement);
  const toggle = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const cameraGroup = $(figure, '[data-ref="camera"]', HTMLElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  // Shown, by the view switch, only where 3D cannot run.
  hint.textContent = NO_WEBGL_HINT;
  const keyGhost = $(figure, '[data-ref="key-ghost"]', HTMLElement);
  const keyMoved = $(figure, '[data-ref="key-moved"]', HTMLElement);
  const keyRing = $(figure, '[data-ref="key-ring"]', HTMLElement);
  const keySpectrum = $(figure, '[data-ref="key-spectrum"]', HTMLElement);
  const presetButtons = [...cameraGroup.querySelectorAll("button")].map((b) => /** @type {HTMLButtonElement} */ (b));
  caption.insertBefore(badge("derived-input"), caption.querySelector(".anim-figure__source"));
  cutoff.append(CUTOFF_LABEL);
  if (CUTOFF_BADGE) cutoff.append(" ", badge(CUTOFF_BADGE));

  const [frameData, spectra] = await Promise.all([
    loadJSON("assets/data/frames.json", { signal }).then((d) => /** @type {FramesFile} */ (d)),
    loadJSON("assets/data/spectra.json", { signal }).then((d) => /** @type {SpectraFile} */ (d)),
  ]);
  if (signal.aborted) return () => {};
  delete frameBox.dataset.state;

  const frames = frameData.frames;
  const picked = ENVELOPE_PICKS["voiced-stretch"](frames);
  if (!picked) {
    frameBox.dataset.state = "error";
    return () => {};
  }
  const [first, last] = picked.run;

  /* -- the stretch, read once -------------------------------------------- */

  /** @type {Row[]} */
  const rows = [];
  for (let i = first; i <= last; i += 1) {
    const f0 = frames[i].derived.orig_f0_hz;
    const harmonics = envelopeAmplitudes(spectra.original[i], f0, spectra.bin_hz, CUTOFF_HZ);
    const dbs = harmonics.map((h) => h.db);
    const exact = smoothCurve(harmonics.map((h) => ({ x: h.hz, y: h.db })));
    rows.push({ i, t: frames[i].t, f0, harmonics, shown: dbs, curve: exact, exact, y: yDomain(dbs) });
  }
  /** @type {[number, number]} */
  const runY = [Math.min(...rows.map((r) => r.y[0])), Math.max(...rows.map((r) => r.y[1]))];

  let selected = picked.frame - first;
  let stepIndex = 0;
  let showSpectrum = true;
  let showNeighbours = false;
  /** @type {string | null} */
  let preset = null;
  /** @type {number | null} */
  let hoverHz = null;

  frameInput.max = String(rows.length - 1);
  frameInput.value = String(selected);

  /** Round every row to the current grid. */
  const applyStep = () => {
    const step = STEPS_DB[stepIndex];
    for (const row of rows) {
      row.shown = row.harmonics.map((h) => coarsen(h.db, step));
      row.curve = step > 0 ? smoothCurve(row.harmonics.map((h, k) => ({ x: h.hz, y: row.shown[k] }))) : row.exact;
    }
  };

  /** The selected frame's input spectrum, clamped to its own y range. @returns {XY[]} */
  const trace = () => {
    const row = rows[selected];
    const values = spectra.original[row.i];
    /** @type {XY[]} */
    const out = [];
    for (let k = 0; k < spectra.bins; k += 1) {
      const hz = spectra.bin_centre_hz[k];
      if (hz > X_DOMAIN[1]) break;
      out.push({ x: hz, y: Math.max(values[k], row.y[0]) });
    }
    return out;
  };

  /** @returns {EnvelopeState} */
  const snapshot = () => ({
    rows,
    selected,
    step: STEPS_DB[stepIndex],
    error: roundingError(rows[selected]),
    spectrum: showSpectrum,
    trace: trace(),
    runY,
    plotRect: (width, height) => plotFor({ width, height }, rows[selected].y).area,
    preset,
  });

  /* -- readouts ---------------------------------------------------------- */

  const syncReadouts = () => {
    const row = rows[selected];
    const step = STEPS_DB[stepIndex];
    const L = row.harmonics.length;
    info.value = `frame ${row.i} · ${row.t.toFixed(2)} s · f0 ${row.f0.toFixed(1)} Hz · L = ${L} harmonics`;
    errorOut.value = step > 0
      ? `rounded to ${step} dB · RMS error ${roundingError(row).toFixed(2)} dB`
      : "full precision";
    errorOut.classList.toggle("is-rounded", step > 0);
    stepOut.value = step > 0 ? `${step} dB` : "exact";
    stepInput.setAttribute("aria-valuetext", step > 0 ? `${step} decibel steps` : "full precision");
    frameInput.value = String(selected);
    frameOut.value = `frame ${row.i} · ${row.t.toFixed(2)} s`;
    frameInput.setAttribute("aria-valuetext", `frame ${row.i}, ${row.t.toFixed(2)} seconds, ${L} harmonics`);
    spectrumInput.checked = showSpectrum;
    neighboursInput.checked = showNeighbours;
    keyGhost.hidden = keyMoved.hidden = step === 0;
    keyRing.hidden = !showNeighbours;
    keySpectrum.hidden = !showSpectrum;
  };

  /** The sentence for the 2D canvas. */
  const describeFlat = () => {
    const row = rows[selected];
    const step = STEPS_DB[stepIndex];
    const rounding = step > 0
      ? `, rounded to ${step} dB steps, an RMS error of ${roundingError(row).toFixed(2)} dB`
      : ", at full precision";
    const around = showNeighbours ? " The previous and next frames' levels are ringed." : "";
    return `Harmonic levels of frame ${row.i} at ${row.t.toFixed(2)} s: ${row.harmonics.length} harmonics of ` +
      `${row.f0.toFixed(1)} Hz under the ${CUTOFF_LABEL}${rounding}, with the envelope through them.${around}`;
  };

  /* -- 2D drawing -------------------------------------------------------- */

  const view = setupCanvas(canvas, { onResize: () => draw() });
  const g = view.ctx;

  function draw() {
    const theme = getTheme();
    const row = rows[selected];
    const step = STEPS_DB[stepIndex];
    clearCanvas(g, view, theme.plotBg);
    if (row.harmonics.length === 0) return;
    const [yBot, yTop] = row.y;
    const plot = plotFor(view, row.y);
    const compact = view.width < 520;
    const xTicks = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
    /** @type {number[]} */
    const yTicks = [];
    for (let v = yBot; v <= yTop; v += 10) yTicks.push(v);
    drawGrid(g, plot, { xTicks, yTicks });
    const ink = theme.css("--ambe-highlight", theme.series[0]);
    drawAxes(g, plot, {
      xTicks,
      yTicks,
      formatX: (v) => (v === 0 ? "0" : `${(v / 1000).toFixed(1)}k`),
      formatY: (v) => String(v),
      xLabel: compact ? "" : "frequency (Hz)",
      yLabel: compact ? "" : "level (dBFS)",
    });

    g.save();
    plot.clip(g);

    // The selected frame in the highlight's colours, as the 3D view draws
    // it: its fill first, then the spectrum, the rounding grid and the
    // exact envelope over the fill, then its line.
    const fill = theme.css("--ambe-highlight-fill-top", "rgba(254,116,91,0.14)");
    drawPolyline(g, row.curve, { plot, color: fill, width: 0.5, fill, fillBaseline: yBot });
    if (showSpectrum) {
      g.globalAlpha = 0.45;
      drawPolyline(g, trace(), { plot, color: theme.series[3], width: 1 });
      g.globalAlpha = 1;
    }
    // The rounding grid: the levels a rounded dot can take.
    if (step > 0) {
      g.strokeStyle = theme.css("--ambe-plot-axis", theme.muted);
      g.lineWidth = 1;
      for (let v = Math.ceil(yBot / step) * step; v <= yTop; v += step) {
        g.beginPath();
        g.moveTo(plot.area.left, crisp(plot.y(v)));
        g.lineTo(plot.area.right, crisp(plot.y(v)));
        g.stroke();
      }
    }
    if (step > 0) drawPolyline(g, row.exact, { plot, color: theme.muted, width: 1.5, dash: [5, 4] });
    drawPolyline(g, row.curve, { plot, color: ink, width: 2.4 });

    // The previous and next frames' levels, as rings: same envelope or not?
    if (showNeighbours) {
      for (const n of [selected - 1, selected + 1]) {
        const other = rows[n];
        if (!other) continue;
        g.strokeStyle = theme.ink;
        g.lineWidth = 1.3;
        other.harmonics.forEach((h, k) => {
          g.beginPath();
          g.arc(plot.x(h.hz), plot.y(other.shown[k]), 4.2, 0, Math.PI * 2);
          g.stroke();
        });
      }
    }

    let hoverIndex = -1;
    if (hoverHz !== null) {
      const at = hoverHz;
      let best = Infinity;
      row.harmonics.forEach((h, n) => {
        const d = Math.abs(h.hz - at);
        if (d < best) {
          best = d;
          hoverIndex = n;
        }
      });
    }

    row.harmonics.forEach((h, n) => {
      const px = plot.x(h.hz);
      const py = plot.y(row.shown[n]);
      const raw = plot.y(h.db);
      g.globalAlpha = 0.35;
      g.strokeStyle = ink;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(crisp(px), plot.area.bottom);
      g.lineTo(crisp(px), py);
      g.stroke();
      g.globalAlpha = 1;
      if (Math.abs(row.shown[n] - h.db) > 0.05) {
        g.strokeStyle = theme.series[2];
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, raw);
        g.lineTo(px, py);
        g.stroke();
        g.strokeStyle = theme.muted;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(px, raw, 2.6, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = ink;
      g.beginPath();
      g.arc(px, py, n === hoverIndex ? 5 : 3.4, 0, Math.PI * 2);
      g.fill();
      if (n === hoverIndex) {
        g.strokeStyle = theme.plotBg;
        g.lineWidth = 1.5;
        g.stroke();
      }
    });

    if (hoverIndex >= 0) {
      const px = crisp(plot.x(row.harmonics[hoverIndex].hz));
      g.globalAlpha = 0.5;
      g.strokeStyle = ink;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(px, plot.area.top);
      g.lineTo(px, plot.area.bottom);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    g.restore();
    syncHover(hoverIndex);
  }

  /** @param {number} n the harmonic under the pointer, or -1 */
  function syncHover(n) {
    const row = rows[selected];
    if (n < 0) {
      hoverOut.value = "";
      return;
    }
    const h = row.harmonics[n];
    const shown = row.shown[n];
    const moved = shown - h.db;
    const sign = moved >= 0 ? "+" : "";
    hoverOut.value = `harmonic ${h.m} · ${Math.round(h.hz)} Hz · ` +
      (STEPS_DB[stepIndex] > 0 ? `${h.db} dB, rounded to ${shown} dB (${sign}${moved} dB)` : `${h.db} dB`);
  }

  /* -- views ------------------------------------------------------------- */

  let describeTimer = 0;
  const describeSoon = () => {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      canvas.setAttribute("aria-label", describeFlat());
    }, DESCRIBE_MS);
  };

  /** @param {string | null} name */
  const pressPreset = (name) => {
    for (const b of presetButtons) b.setAttribute("aria-pressed", String(b.dataset.preset === name));
  };

  const sw = createViewSwitch({
    frame: frameBox,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: snapshot,
    load: () => import("./anim-envelope-3d.js"),
    id: SLUG,
    onView: (v) => {
      const three = v === "3d";
      figure.dataset.view = three ? "3d" : "2d";
      cameraGroup.hidden = !three;
      if (three) pressPreset(preset ?? "corner");
      else draw();
    },
  });

  const refresh = () => {
    syncReadouts();
    draw();
    describeSoon();
    sw.update(snapshot());
  };

  /* -- steps and controls ------------------------------------------------ */

  /** @param {Record<string, string>} state */
  const applyState = (state) => {
    if (state.pick) {
      const found = ENVELOPE_PICKS[/** @type {"voiced-stretch"} */ (state.pick)]?.(frames);
      if (found) {
        const at = state.at === "first" ? found.run[0] : state.at === "last" ? found.run[1] : found.frame;
        selected = Math.max(0, Math.min(rows.length - 1, at - first));
      }
    }
    if (state.round !== undefined) {
      const k = STEPS_DB.indexOf(Number(state.round));
      if (k >= 0) stepIndex = k;
      stepInput.value = String(stepIndex);
      applyStep();
    }
    if (state.spectrum) showSpectrum = state.spectrum === "on";
    if (state.neighbours) showNeighbours = state.neighbours === "on";
    if (state.preset) {
      preset = state.preset;
      pressPreset(preset);
    }
    hoverHz = null;
    refresh();
    if (state.view === "3d") void sw.show3D();
    else if (state.view === "2d") sw.show2D();
    if (state.preset) sw.preset(state.preset);
  };

  stepInput.addEventListener("input", () => {
    stepIndex = Math.min(Math.max(Number(stepInput.value) | 0, 0), STEPS_DB.length - 1);
    applyStep();
    refresh();
  }, { signal });
  frameInput.addEventListener("input", () => {
    selected = Math.min(Math.max(Number(frameInput.value) | 0, 0), rows.length - 1);
    refresh();
  }, { signal });
  spectrumInput.addEventListener("change", () => {
    showSpectrum = spectrumInput.checked;
    refresh();
  }, { signal });
  neighboursInput.addEventListener("change", () => {
    showNeighbours = neighboursInput.checked;
    refresh();
  }, { signal });
  for (const button of presetButtons) {
    button.addEventListener("click", () => {
      preset = button.dataset.preset ?? "corner";
      pressPreset(preset);
      sw.preset(preset);
    }, { signal });
  }

  /** @param {PointerEvent} event */
  const pointerHz = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * view.width;
    const plot = plotFor(view, rows[selected].y);
    if (x < plot.area.left - 14 || x > plot.area.right + 14) return null;
    return Math.min(Math.max(plot.invertX(x), X_DOMAIN[0]), X_DOMAIN[1]);
  };
  canvas.addEventListener("pointermove", (event) => {
    const hz = pointerHz(event);
    if (hz === hoverHz) return;
    hoverHz = hz;
    draw();
  }, { signal });
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    hoverHz = pointerHz(event);
    draw();
  }, { signal });
  for (const type of ["pointerleave", "pointercancel"]) {
    canvas.addEventListener(type, () => {
      if (hoverHz === null) return;
      hoverHz = null;
      draw();
    }, { signal });
  }

  const unsubscribe = onThemeChange(() => draw());

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = {
      state: snapshot,
      view: () => sw.view(),
      /** The selected frame's dots on the 2D plot, CSS px in the frame. */
      plotPoints: () => {
        const row = rows[selected];
        const plot = plotFor({ width: frameBox.clientWidth, height: frameBox.clientHeight }, row.y);
        return row.harmonics.map((h, k) => [plot.x(h.hz), plot.y(row.shown[k])]);
      },
    };
  }

  syncReadouts();
  draw();
  canvas.setAttribute("aria-label", describeFlat());
  if (steps.length) createStepper(figure, steps, (state) => applyState(state), { signal });

  return () => {
    unsubscribe();
    view.destroy();
    clearTimeout(describeTimer);
    if (TEST_HOOK) delete TEST_HOOK.figures[SLUG];
  };
}
