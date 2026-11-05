// @ts-check
/* ===========================================================================
 * anim-envelope-blocks.js: "envelope-blocks", one frame's amplitudes cut
 * into blocks, each block redrawn from fewer DCT coefficients (ch09).
 * ---------------------------------------------------------------------------
 * Place it with <div data-anim="envelope-blocks" markdown="1"> and its
 * fallback and steps (docs/09-quantization.md, section 3).
 *
 * Data: assets/data/frames.json and spectra.json (lr-b). The amplitudes are
 * read off the input audio's spectrum at multiples of the input's pitch,
 * as the envelope figure reads them (lib/harmonics.js envelopeAmplitudes),
 * up to the 3.7 kHz cutoff. Their mean is removed and drawn on its own as
 * the level. The rest is cut into six blocks, an even split (illustrative),
 * and each block is redrawn from its first k DCT coefficients (lib/dct.js).
 * One frame's amplitudes stand in for the prediction residual: no residual
 * is computed from a sequence of frames, nothing is quantized, and nothing
 * is sounded.
 *
 * The flat view draws the selected k. The 3D view (anim-envelope-blocks-3d.js,
 * loaded only when wanted, lib/view-switch.js) stacks every k in depth,
 * all coefficients at the front and one per block at the back.
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
  drawLabel,
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
import { blockCoefficients, blockSizes, energyByOrder, energyKept, keepCoefficients, rmsDifference } from "./lib/dct.js";
import { envelopeAmplitudes } from "./lib/harmonics.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "envelope-blocks";
const STEP_KEYS = /** @type {const} */ (["k", "preset", "view"]);
/** Blocks per frame: "for instance six" (US 5,630,011). */
const BLOCKS = 6;
/** The level bar's own scale, dBFS, bottom to top. */
export const LEVEL_RANGE = /** @type {const} */ ([-100, 0]);
/** Harmonic units right of the last harmonic for the level bar, apart from the dB axis. */
const GUTTER = 3;

/**
 * The level bar's left and right edges, in harmonic units: in the gutter
 * past harmonic L, a gap away from the divider, so it does not read as a
 * value on the plot's dB axis.
 * @param {number} L
 * @returns {[number, number]}
 */
export const barSpan = (L) => [L + 1.5, L + 2.5];

/**
 * Everything both views draw, for one frame. The 3D part takes these
 * arrays and computes nothing itself.
 * @typedef {Object} BlocksModel
 * @property {number} frame  frame index in the clip
 * @property {number} t  seconds
 * @property {number} f0  Hz
 * @property {number} L  harmonics below the cutoff
 * @property {number} level  the removed mean, dBFS
 * @property {number[]} exact  the mean-removed amplitudes, dB, harmonic 1 first
 * @property {number[]} sizes  block lengths
 * @property {number} kMax  the longest block's length
 * @property {number[][]} slices  slices[k - 1]: the values kept with k coefficients
 * @property {number[]} energies  energy by coefficient order
 * @property {[number, number]} xDomain  harmonic number, the level gutter (at the right) included
 * @property {[number, number]} yDomain  dB, mean removed
 * @property {[number, number]} bar  the level bar's left and right edges,
 *           harmonic units (barSpan)
 * @property {number} levelTop  where the level bar's top sits on the dB axis
 *           (the level on its own scale, LEVEL_RANGE, over the plot's height)
 */

/**
 * The 2D module's state, as the 3D part receives it.
 * @typedef {Object} BlocksState
 * @property {BlocksModel} model
 * @property {number} k  coefficients kept per block, 1 to model.kMax
 * @property {"front" | "oblique"} preset
 * @property {(width: number, height: number) => import("./lib/orbit.js").PlotRect} rect
 *           the plot rectangle for a frame of that size
 * @property {string} chip  the fact the highlight's chip states
 */

/**
 * The model for one frame.
 * @param {FrameRecord} record
 * @param {number[]} row the frame's spectra.json row, dBFS
 * @param {number} binHz
 * @returns {BlocksModel}
 */
export function modelFor(record, row, binHz) {
  const f0 = record.derived.orig_f0_hz;
  const amps = envelopeAmplitudes(row, f0, binHz, CUTOFF_HZ).map((h) => h.db);
  const L = amps.length;
  const level = amps.reduce((s, v) => s + v, 0) / L;
  const exact = amps.map((v) => v - level);
  const sizes = blockSizes(L, BLOCKS);
  const kMax = Math.max(...sizes);
  const coefficients = blockCoefficients(exact, sizes);
  const slices = Array.from({ length: kMax }, (_, i) => keepCoefficients(coefficients, i + 1));
  let lo = Infinity;
  let hi = -Infinity;
  for (const slice of slices) for (const v of slice) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  /** @type {[number, number]} */
  const yDomain = [Math.floor(lo / 5) * 5 - 5, Math.ceil(hi / 5) * 5 + 5];
  return {
    frame: record.i, t: record.t, f0, L, level, exact, sizes, kMax, slices,
    energies: energyByOrder(coefficients),
    xDomain: [0.5, L + 0.5 + GUTTER],
    yDomain,
    bar: barSpan(L),
    levelTop: levelY(level, yDomain),
  };
}

/**
 * Frames worth showing, as the envelope figure offers them: voiced, with
 * a confident input pitch, and not near silence. The first is the most
 * confidently pitched one (frame 112 of lr-b).
 * @param {FrameRecord[]} frames
 * @returns {{choices: FrameRecord[], best: number}}
 */
export function voicedChoices(frames) {
  const choices = frames.filter((f) => f.derived.voiced && f.derived.orig_f0_hz > 0 &&
    f.derived.orig_f0_confidence >= 0.6 && f.derived.orig_rms_dbfs > -32);
  let best = 0;
  choices.forEach((c, i) => {
    if (c.derived.orig_f0_confidence > choices[best].derived.orig_f0_confidence) best = i;
  });
  return { choices, best };
}

/**
 * The plot rectangle in a frame of the given size; the 3D part's Front
 * preset puts its box exactly here.
 * @param {number} width
 * @param {number} height
 */
export function plotFor(width, height) {
  const narrow = width < 520;
  // At phone width the top keeps room for the 3D view's chip over the peak.
  return { top: narrow ? 36 : 14, right: narrow ? 10 : 18, bottom: 72, left: narrow ? 34 : 44 };
}

/** @param {number} k @param {BlocksModel} m */
const chipText = (k, m) => {
  const kept = energyKept(m.energies, k);
  const share = kept > 0.9995 ? "100" : (kept * 100).toFixed(1);
  return `${k} coefficient${k === 1 ? "" : "s"}: ${share}% of the energy`;
};

/** @param {number} v */
const signed = (v) => (v < 0 ? `−${Math.abs(v).toFixed(1)}` : v.toFixed(1));

const TEMPLATE = `
  <div class="anim-figure__head">
    <p class="anim-figure__title">Spectral envelope reconstruction from DCT coefficients</p>
  </div>
  <div class="anim-figure__frame" data-state="loading">
    <canvas class="anim-figure__canvas" role="img" aria-label="Loading the frame"></canvas>
  </div>
  <div class="anim-figure__step"></div>
  <ul class="anim-legend">
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line anim-eb__swatch--kept"></i>kept with k coefficients per block (thick)</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-eb__swatch--ring"></i>the frame's own amplitudes, mean removed (rings)</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch anim-legend__swatch--line anim-eb__swatch--ramp"></i>one slice per k: every coefficient at the front, one per block at the back (thin)</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-eb__swatch--level"></i>level: the mean, sent separately as the gain (bar)</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-eb__swatch--block"></i>the six blocks (alternate bands, numbered)</li>
  </ul>
  <div class="anim-controls">
    <label class="anim-field">
      <span class="anim-field__label">Coefficients kept per block</span>
      <input class="anim-range" data-ref="k" type="range" min="1" max="1" step="1" value="1">
    </label>
    <output class="anim-readout" data-ref="k-out">1 of 1</output>
    <label class="anim-field">
      <span class="anim-field__label">Frame</span>
      <input class="anim-range" data-ref="frame" type="range" min="0" max="0" step="1" value="0">
    </label>
    <output class="anim-readout anim-readout--wide" data-ref="frame-out"></output>
    <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
    <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
      <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
      <button class="anim-btn" type="button" data-preset="oblique" aria-pressed="true">Oblique</button>
    </div>
  </div>
  <div class="anim-controls anim-eb__readouts">
    <span>RMS error <output class="anim-readout" data-ref="rms" aria-live="polite"></output></span>
    <span>energy kept <output class="anim-readout" data-ref="energy" aria-live="polite"></output></span>
    <span data-ref="cutoff"></span>
  </div>
  <p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
  <figcaption class="anim-figure__caption">One 20 ms frame of a vowel from the
    input audio: the amplitude of each harmonic below 3.7 kHz, with their
    mean removed and drawn on its own as the level. The amplitudes are cut
    into six blocks, an even split, and each block is redrawn from its first
    k DCT coefficients. One frame's amplitudes stand in for the residual. A
    real prediction residual is less smooth, so its energy spreads over
    more coefficients than it does here.
    <span class="anim-figure__source">Source: the input audio's spectrum
    (<code>assets/data/spectra.json</code>) at multiples of its pitch
    (<code>assets/data/frames.json</code>). Blocks and a DCT per block:
    US 5,630,011. The D-STAR block count and lengths are not public.</span>
  </figcaption>`;

/**
 * @param {Element} host
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-eb";
  figure.dataset.view = "2d";
  figure.innerHTML = TEMPLATE;
  host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const kInput = $(figure, '[data-ref="k"]', HTMLInputElement);
  const kOut = $(figure, '[data-ref="k-out"]', HTMLOutputElement);
  const frameInput = $(figure, '[data-ref="frame"]', HTMLInputElement);
  const frameOut = $(figure, '[data-ref="frame-out"]', HTMLOutputElement);
  const rmsOut = $(figure, '[data-ref="rms"]', HTMLOutputElement);
  const energyOut = $(figure, '[data-ref="energy"]', HTMLOutputElement);
  const toggle = $(figure, 'button[data-view="3d"]', HTMLButtonElement);
  const camera = $(figure, '[data-ref="camera"]', HTMLElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  const cutoff = $(figure, '[data-ref="cutoff"]', HTMLElement);
  // Hidden until lib/view-switch.js finds no WebGL 2; the same words then.
  hint.textContent = NO_WEBGL_HINT;
  caption.append(" ", badge("derived-input"), " ", badge("illustrative"));
  cutoff.textContent = CUTOFF_LABEL;
  if (CUTOFF_BADGE) cutoff.append(" ", badge(CUTOFF_BADGE));

  /** @type {[FramesFile, SpectraFile]} */
  let data;
  try {
    data = /** @type {[FramesFile, SpectraFile]} */ (await Promise.all([
      loadJSON("assets/data/frames.json", { signal }),
      loadJSON("assets/data/spectra.json", { signal }),
    ]));
  } catch (error) {
    if (!signal.aborted) {
      console.error(`${SLUG}: data failed to load`, error);
      frame.dataset.state = "error";
    }
    return () => {};
  }
  if (signal.aborted) return () => {};
  delete frame.dataset.state;
  const [frames, spectra] = data;
  const { choices, best } = voicedChoices(frames.frames);
  frameInput.max = String(choices.length - 1);
  frameInput.value = String(best);

  /** @type {Map<number, BlocksModel>} */
  const models = new Map();
  /** @param {number} choice */
  const modelAt = (choice) => {
    const record = choices[choice];
    let model = models.get(record.i);
    if (!model) {
      model = modelFor(record, spectra.original[record.i], spectra.bin_hz);
      models.set(record.i, model);
    }
    return model;
  };

  let choice = best;
  let model = modelAt(choice);
  let k = model.kMax;
  /** @type {"front" | "oblique"} */
  let preset = "oblique";

  /** @returns {BlocksState} */
  const state = () => ({
    model, k, preset, chip: chipText(k, model),
    rect: (width, height) => {
      const pad = plotFor(width, height);
      return { x: pad.left, y: pad.top, width: width - pad.left - pad.right, height: height - pad.top - pad.bottom };
    },
  });

  const handle = setupCanvas(canvas, { onResize: () => draw() });
  signal.addEventListener("abort", () => handle.destroy(), { once: true });

  const plot = () => createPlot(handle, {
    xDomain: model.xDomain, yDomain: model.yDomain, padding: plotFor(handle.width, handle.height),
  });

  function draw() {
    if (canvas.hidden) return;
    const theme = getTheme();
    const g = handle.ctx;
    const p = plot();
    const { area } = p;
    clearCanvas(g, handle, theme.plotBg);
    const narrow = handle.width < 520;
    // The blocks: every other one shaded, a number at the foot of each
    // (the top is left to the data and, in 3D, to the highlight's chip).
    let at = 1;
    model.sizes.forEach((size, b) => {
      const x0 = p.x(at - 0.5);
      const x1 = p.x(at + size - 0.5);
      if (b % 2 === 0) {
        g.fillStyle = theme.css("--ambe-surface-2");
        g.fillRect(x0, area.top, x1 - x0, area.height);
      }
      drawLabel(g, narrow ? String(b + 1) : `block ${b + 1}`, (x0 + x1) / 2, area.bottom - 4, {
        align: "center", baseline: "bottom", size: 11, color: theme.muted,
      });
      at += size;
    });
    // Zero, and the line between harmonic L and the level gutter.
    const edge = p.x(model.L + 0.5);
    g.save();
    g.strokeStyle = theme.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(area.left, crisp(p.y(0)));
    g.lineTo(edge, crisp(p.y(0)));
    g.moveTo(crisp(edge), area.top);
    g.lineTo(crisp(edge), area.bottom);
    g.stroke();
    g.restore();
    const xTicks = [1, ...Array.from({ length: Math.floor(model.L / 5) }, (_, i) => (i + 1) * 5)];
    const yTicks = [];
    for (let v = Math.ceil(model.yDomain[0] / 10) * 10; v <= model.yDomain[1]; v += 10) yTicks.push(v);
    drawAxes(g, p, {
      xTicks, yTicks, formatY: (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0"),
      xLabel: "harmonic number", fontSize: 11,
    });
    // The level bar on its own scale, 0 dBFS at the top of the plot, past
    // the divider at the right, away from the dB axis.
    const levelTop = model.levelTop;
    const [ba, bb] = model.bar;
    const bx0 = p.x(ba);
    const bx1 = p.x(bb);
    // Its track, the whole scale, outlined: the bar is not on the dB axis.
    g.strokeStyle = theme.axis;
    g.lineWidth = 1;
    g.strokeRect(crisp(bx0), crisp(area.top), Math.round(bx1 - bx0), Math.round(area.height));
    g.fillStyle = theme.css("--ambe-plot-muted");
    g.fillRect(bx0, p.y(levelTop), bx1 - bx0, area.bottom - p.y(levelTop));
    g.strokeStyle = theme.ink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(bx0, crisp(p.y(levelTop), 2));
    g.lineTo(bx1, crisp(p.y(levelTop), 2));
    g.stroke();
    // Its name and value over it, clear of the dB axis and the ticks, on
    // a halo of the ground so the track's outline does not run through them.
    g.save();
    g.font = `400 11px ${theme.font}`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.lineJoin = "round";
    g.lineWidth = 4;
    g.strokeStyle = theme.plotBg;
    const bm = (bx0 + bx1) / 2;
    for (const [text, y, colour] of /** @type {const} */ ([["level", p.y(levelTop) - 18, theme.muted], [signed(model.level), p.y(levelTop) - 4, theme.ink]])) {
      g.strokeText(text, bm, y);
      g.fillStyle = colour;
      g.fillText(text, bm, y);
    }
    g.restore();
    // The frame's own amplitudes as rings, then the kept slice on top.
    g.save();
    g.strokeStyle = theme.ink;
    g.lineWidth = 1.25;
    model.exact.forEach((v, i) => {
      g.beginPath();
      g.arc(p.x(i + 1), p.y(v), 3.5, 0, Math.PI * 2);
      g.stroke();
    });
    g.restore();
    const highlight = theme.css("--ambe-highlight");
    const kept = model.slices[k - 1];
    drawPolyline(g, kept.map((v, i) => [i + 1, v]), { plot: p, color: highlight, width: 3 });
    g.fillStyle = highlight;
    kept.forEach((v, i) => {
      g.beginPath();
      g.arc(p.x(i + 1), p.y(v), 2.5, 0, Math.PI * 2);
      g.fill();
    });
  }

  let labelTimer = 0;
  signal.addEventListener("abort", () => clearTimeout(labelTimer), { once: true });
  /** The canvas label (250 ms after the last change), the readouts and the 3D view, from the state. */
  const sync = () => {
    const record = choices[choice];
    kInput.max = String(model.kMax);
    kInput.value = String(k);
    kOut.value = `${k} of ${model.kMax}`;
    kInput.setAttribute("aria-valuetext", `${k} of ${model.kMax} coefficients per block`);
    frameOut.value = `#${record.i} · ${record.t.toFixed(2)} s · ${Math.round(model.f0)} Hz · L = ${model.L}`;
    frameInput.setAttribute("aria-valuetext", `frame ${record.i}, ${model.L} harmonics`);
    const rms = rmsDifference(model.slices[k - 1], model.exact);
    rmsOut.value = `${rms.toFixed(2)} dB`;
    energyOut.value = `${(energyKept(model.energies, k) * 100).toFixed(1)}%`;
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => canvas.setAttribute("aria-label", describe()), 250);
    draw();
    view.update(state());
  };

  const describe = () => `Frame ${model.frame}, ${model.L} harmonic amplitudes with their mean removed, ` +
    `cut into blocks of ${model.sizes.join(", ")}, redrawn from ${k} of up to ${model.kMax} DCT coefficients per block: ` +
    `${chipText(k, model)}, RMS error ${rmsDifference(model.slices[k - 1], model.exact).toFixed(2)} dB. ` +
    `The level, ${signed(model.level)} dBFS, is drawn as a bar at the right and does not change with k.`;

  /** @param {"front" | "oblique" | ""} name  "" after a drag: no preset holds */
  const pressCamera = (name) => {
    for (const b of camera.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.preset === name));
  };

  const view = createViewSwitch({
    frame, flat: canvas, toggle, hint, signal, state,
    load: () => import("./anim-envelope-blocks-3d.js"),
    onView: (next) => {
      figure.dataset.view = next === "3d" ? "3d" : "2d";
      camera.hidden = next !== "3d";
      if (next !== "3d") draw();
    },
    onDrag: () => pressCamera(""),
  });

  kInput.addEventListener("input", () => {
    k = Number(kInput.value);
    sync();
  }, { signal });
  frameInput.addEventListener("input", () => {
    choice = Number(frameInput.value);
    model = modelAt(choice);
    k = Math.min(k, model.kMax);
    sync();
  }, { signal });
  camera.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    const name = button?.dataset.preset;
    if (name !== "front" && name !== "oblique") return;
    preset = name;
    pressCamera(name);
    view.preset(name);
  }, { signal });
  const unTheme = onThemeChange(() => draw());
  signal.addEventListener("abort", unTheme, { once: true });

  if (steps.length) {
    createStepper(figure, steps, (s) => {
      if (s.k) k = s.k === "max" ? model.kMax : Math.max(1, Math.min(model.kMax, Number(s.k)));
      if (s.preset === "front" || s.preset === "oblique") {
        preset = s.preset;
        pressCamera(preset);
        view.preset(preset);
      }
      sync();
      // A step shows the view that fits its graph; the 3D view opens at
      // the step's preset (state().preset).
      if (s.view === "3d") void view.show3D();
      else if (s.view === "2d") view.show2D();
    }, { signal });
  } else {
    sync();
  }

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = {
      state,
      view: () => view.view(),
      /** The kept slice's points in the flat view, CSS px in the frame. */
      points2d: () => {
        const p = createPlot({ width: frame.clientWidth, height: frame.clientHeight }, {
          xDomain: model.xDomain, yDomain: model.yDomain, padding: plotFor(frame.clientWidth, frame.clientHeight),
        });
        return model.slices[k - 1].map((v, i) => [p.x(i + 1), p.y(v)]);
      },
    };
  }
  return () => {
    if (TEST_HOOK && /** @type {any} */ (TEST_HOOK.figures[SLUG])?.state === state) delete TEST_HOOK.figures[SLUG];
  };
}

/**
 * Where the level bar's top sits on the plot's dB axis: the level on its
 * own scale (LEVEL_RANGE), laid over the plot's height.
 * @param {number} level dBFS
 * @param {[number, number]} yDomain
 * @returns {number}
 */
export function levelY(level, yDomain) {
  const [lo, hi] = LEVEL_RANGE;
  const f = Math.max(0, Math.min(1, (level - lo) / (hi - lo)));
  return yDomain[0] + f * (yDomain[1] - yDomain[0]);
}
