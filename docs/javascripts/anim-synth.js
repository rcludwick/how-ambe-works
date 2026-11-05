// @ts-check
/* ===========================================================================
 * anim-synth.js: slug "synth" (ch11), two generators and one voice.
 * ---------------------------------------------------------------------------
 * The flat view: a bank of harmonic oscillators for the bands measured
 * voiced, shaped noise for the bands measured unvoiced, and their sum, with
 * the spectrum and the per-band voicing beside them. A Mix control fades
 * between the noise alone, the measured mix and the oscillators alone.
 *
 * The 3D view (anim-synth-3d.js, loaded on request) is the spectrum panel
 * through time: the selected frame's slice and twelve frames on each side,
 * split by generator. With WebGL 2 and motion allowed it opens in 3D and
 * plays its opening once (lib/view-switch.js); its Front preset is the
 * spectrum panel this module draws when 3D is wanted, which is also the
 * view a parked 3D view shows.
 *
 * Data read (precomputed; nothing here decodes AMBE):
 *   assets/data/frames.json    derived.decoded_f0_hz, band_voicing[8],
 *                              band_voiced[8], decoded_rms_dbfs: generic DSP
 *                              on the chip's decoded WAV, per SCHEMA.md.
 *   assets/data/spectra.json   decoded[frame][128]: FFT magnitude in dBFS
 *                              of the same audio.
 *
 * WHAT THIS IS NOT. The curves are an illustration drawn from precomputed
 * measurements (lib/synth-model.js). There is no MBE synthesizer here: no
 * phase model, no window, no overlap-add, no audio output, and no
 * reconstruction of the decoded speech, which is a pre-rendered WAV on the
 * Listen page. Do not turn this into a codec.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createLoop,
  createPlot,
  createTransport,
  crisp,
  drawAxes,
  drawGrid,
  drawPolyline,
  getTheme,
  loadJSON,
  markEnhanced,
  onThemeChange,
  opensIn3D,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { PICKS } from "./lib/picks.js";
import { createViewSwitch } from "./lib/view-switch.js";
import {
  BANDS,
  BAND_HZ,
  DB_FLOOR,
  DB_TOP,
  NYQUIST,
  TRACE_N,
  buildFrameModel,
  linToDb,
  pitchChange,
  pitchChangeText,
  weights,
} from "./lib/synth-model.js";

/** @typedef {import("./lib/synth-model.js").FrameModel} FrameModel */
/** @typedef {import("./anim-core.js").Theme} Theme */
/** @typedef {{x: number, y: number, w: number, h: number}} Rect */
/** @typedef {{left: number, right: number, top: number, bottom: number}} Pad */
/** @typedef {"full" | "spectrum"} Layout */

const SLUG = "synth";
const FRAMES = "assets/data/frames.json";
const SPECTRA = "assets/data/spectra.json";
const PLAY_FPS = 10;
const START_FRAME = 98;
const STEP_KEYS = /** @type {const} */ (["view", "preset", "mix", "pick"]);
const PRESETS = ["corner", "front", "top"];

/**
 * What the 3D part reads from this module: the frame, the Mix, and the
 * arrays it draws (anim-synth-3d.js computes no model data).
 * @typedef {Object} SynthState
 * @property {number} frame
 * @property {number} frames  how many there are
 * @property {number} mix  0 to 100
 * @property {boolean} overlay  the measured spectrum is shown
 * @property {string} preset  the camera preset the view rests on
 * @property {(i: number) => FrameModel} model
 * @property {(i: number) => number[]} measured  dBFS, 128 bins to 4 kHz
 * @property {() => {x: number, y: number, width: number, height: number}} plotRect
 *           the flat spectrum panel's plot area in the frame (the Front fit)
 * @property {() => boolean} playing
 * @property {() => void} introDone  the opening has ended
 */

/* ---------------------------------------------------------------------------
 * Markup
 * ------------------------------------------------------------------------ */

const MARKUP = `
  <div class="anim-figure__head">
    <p class="anim-figure__title">Combining harmonic oscillators and shaped noise across bands</p>
    <p class="anim-figure__subtitle">An oscillator bank and shaped noise, chosen band by band</p>
  </div>
  <div class="anim-figure__frame synth-frame" data-state="loading">
    <canvas class="anim-figure__canvas" role="img" aria-label="Loading the synthesis figure"></canvas>
  </div>
  <output class="synth-readouts" aria-live="polite" data-ref="readouts"></output>
  <ul class="anim-legend">
    <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch is-data-2"></i>voiced: harmonic oscillators</li>
    <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch is-data-3"></i>unvoiced: shaped noise</li>
    <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch is-data-1"></i>sum</li>
    <li class="anim-legend__item" data-for="2d"><i class="anim-legend__swatch is-data-4"></i>measured spectrum of the decoded audio (dashed)</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch synth-swatch--voiced"></i>voiced band: one stick per harmonic</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch synth-swatch--unvoiced"></i>unvoiced band: a block of shaped noise</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch synth-swatch--outline"></i>this frame: the outlined slice</li>
    <li class="anim-legend__item" data-for="3d" data-ref="measured3d"><i class="anim-legend__swatch synth-swatch--highlight"></i>its measured spectrum (thick)</li>
    <li class="anim-legend__item" data-for="3d"><i class="anim-legend__swatch synth-swatch--muted"></i>earlier frames behind it, later in front, 20 ms apart (thin)</li>
  </ul>
  <div class="anim-controls">
    <button class="anim-btn anim-btn--play" type="button" data-kind="motion" aria-pressed="false">Play</button>
    <label class="anim-field">
      <span class="anim-field__label">Frame</span>
      <input class="anim-range" type="range" min="0" max="0" step="1" value="0" aria-label="Frame index">
    </label>
    <output class="anim-readout anim-readout--wide">frame 0</output>
  </div>
  <div class="anim-controls synth-controls--tight">
    <label class="anim-field">
      <span class="anim-field__label">Mix</span>
      <input class="anim-range" type="range" min="0" max="100" step="1" value="50" data-ref="mix"
             aria-label="Mix between unvoiced only, the measured mix, and voiced only">
    </label>
    <output class="anim-readout anim-readout--wide" data-ref="mixout">measured mix</output>
    <button class="anim-btn" type="button" data-ref="snap">Measured mix</button>
    <label class="anim-field synth-field--check">
      <input class="anim-check" type="checkbox" data-ref="overlay" checked>
      <span class="anim-field__label">Spectrum overlay</span>
    </label>
  </div>
  <div class="anim-controls synth-controls--tight">
    <div class="anim-controls__group">
      <span class="anim-field__label">View</span>
      <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
    </div>
    <div class="anim-controls__group" data-ref="camera" hidden>
      <span class="anim-field__label">Camera</span>
      <div class="anim-toggle-group" role="group" aria-label="Camera">
        ${PRESETS.map((p) => `<button class="anim-btn" type="button" data-preset="${p}" aria-pressed="${p === "corner"}">${p[0].toUpperCase()}${p.slice(1)}</button>`).join("")}
      </div>
    </div>
  </div>
  <div class="anim-figure__step"></div>
  <p class="anim-figure__hint">Held on one frame because your system asks for
    reduced motion. Both sliders still work.</p>
  <p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
  <figcaption class="anim-figure__caption">
    Drag <em>Mix</em> all the way left and the frame is nothing but band-shaped
    noise; all the way right and it is a pure harmonic buzz. The centre is the
    mix measured on this frame. In a vowel the low bands are periodic and the
    high bands are not, which is the point of a multi-band model. In 3D each
    slice is one 20 ms frame, and the dots at the stick tips are harmonics:
    when the pitch moves, harmonic <em>l</em> moves <em>l</em> times as far.
    The three waveform panels of the flat view are each drawn at their own
    vertical scale, so a quiet frame still fills them; the real level is
    the one in the readout.
    <span class="anim-figure__source" data-ref="source">Source: per-band voicing
      strength, f<sub>0</sub> and levels measured on the audio a DVSI
      AMBE-3000 decoded (<code>assets/data/frames.json</code>,
      <code>assets/data/spectra.json</code>; windows and thresholds in
      <code>assets/data/SCHEMA.md</code>). The two generators, and the noise
      filter's zero response in voiced bands, are from US 5,754,974 and
      Griffin &amp; Lim 1988. The sticks, blocks and waves are drawn from
      those measurements with arbitrary phase. They are not the decoder's
      output, which you can hear on the Listen page.</span>
  </figcaption>`;

/* ---------------------------------------------------------------------------
 * Layout
 * ------------------------------------------------------------------------ */

const TWO_COL = 720; // canvas width at which the panels sit in two columns
const WAVE_H = 74; // stacked-layout heights
const WAVE_GAP = 10;
const SPEC_H = 182;
const BAND_H = 126;
/** The spectrum's plot inset inside its panel, flat layout. */
const PANEL_PAD = { left: 34, right: 6, top: 18, bottom: 26 };
/** The same when the panel fills the frame (3D wanted). */
const WIDE_PAD = { left: 44, right: 18, top: 34, bottom: 72 };

/**
 * Height this figure needs at a width, so the frame's aspect is set from JS
 * rather than guessed by a media query.
 * @param {number} W
 * @param {Layout} layout
 */
function naturalHeight(W, layout) {
  if (W >= TWO_COL) return Math.round((W * 9) / 16);
  if (layout === "spectrum") return Math.round(W * (W >= 480 ? 0.78 : 1.05));
  const pad = W < 420 ? 8 : 12;
  return pad * 2 + 3 * (WAVE_H + WAVE_GAP) + 6 + SPEC_H + 18 + BAND_H;
}

/**
 * @typedef {Object} Panels
 * @property {Rect[]} wave  empty in the spectrum layout
 * @property {Rect} spectrum
 * @property {Pad} specPad
 * @property {Rect | null} bands
 */

/**
 * @param {{width: number, height: number}} size
 * @param {Layout} layout
 * @returns {Panels}
 */
function computeLayout(size, layout) {
  const W = size.width;
  const H = size.height;
  const pad = W < 420 ? 8 : 12;
  if (layout === "spectrum") {
    return { wave: [], spectrum: { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 }, specPad: WIDE_PAD, bands: null };
  }
  if (W >= TWO_COL) {
    const colW = Math.round((W - pad * 3) * 0.5);
    const rightX = pad * 2 + colW;
    const rightW = W - rightX - pad;
    const waveH = Math.floor((H - pad * 2 - 24) / 3);
    const specH = Math.round((H - pad * 2 - 16) * 0.62);
    return {
      wave: [0, 1, 2].map((i) => ({ x: pad, y: pad + i * (waveH + 12), w: colW, h: waveH })),
      spectrum: { x: rightX, y: pad, w: rightW, h: specH },
      specPad: PANEL_PAD,
      bands: { x: rightX, y: pad + specH + 16, w: rightW, h: H - pad - (pad + specH + 16) },
    };
  }
  // Stacked: fixed heights, scaled down if some other stylesheet gives the
  // frame less room than naturalHeight() asked for.
  const colW = W - pad * 2;
  const k = Math.min(1, (H - pad * 2) / (naturalHeight(W, layout) - pad * 2));
  const waveH = Math.floor(WAVE_H * k);
  const specH = Math.floor(SPEC_H * k);
  const gap = Math.floor(WAVE_GAP * k);
  const specY = pad + 3 * (waveH + gap) + Math.floor(6 * k);
  const bandY = specY + specH + Math.floor(18 * k);
  return {
    wave: [0, 1, 2].map((i) => ({ x: pad, y: pad + i * (waveH + gap), w: colW, h: waveH })),
    spectrum: { x: pad, y: specY, w: colW, h: specH },
    specPad: PANEL_PAD,
    bands: { x: pad, y: bandY, w: colW, h: Math.floor(BAND_H * k) },
  };
}

/**
 * @param {{width: number, height: number}} size
 * @param {Rect} rect
 * @param {[number, number]} xDomain
 * @param {[number, number]} yDomain
 * @param {Pad} pad
 */
function subPlot(size, rect, xDomain, yDomain, pad) {
  return createPlot(size, {
    xDomain,
    yDomain,
    padding: {
      left: rect.x + pad.left,
      top: rect.y + pad.top,
      right: size.width - (rect.x + rect.w) + pad.right,
      bottom: size.height - (rect.y + rect.h) + pad.bottom,
    },
  });
}

/**
 * The spectrum panel's plot.
 * @param {{width: number, height: number}} size
 * @param {Panels} L
 */
const spectrumPlot = (size, L) => subPlot(size, L.spectrum, [0, NYQUIST], [DB_FLOOR, DB_TOP], L.specPad);

/* ---------------------------------------------------------------------------
 * Painting
 * ------------------------------------------------------------------------ */

/**
 * @param {CanvasRenderingContext2D} g
 * @param {Theme} th
 * @param {string} text
 * @param {number} x
 * @param {number} y
 */
function panelTitle(g, th, text, x, y) {
  g.save();
  g.font = `600 10px ${th.font}`;
  g.fillStyle = th.text3;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText(text, x, y);
  g.restore();
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {Theme} th
 * @param {Rect} rect
 * @param {(n: number) => number} trace
 * @param {number} gain
 * @param {number} scale
 * @param {string} colour
 * @param {{long: string, short: string}} label
 * @param {string} note
 */
function drawWave(g, th, rect, trace, gain, scale, colour, label, note) {
  g.save();
  g.fillStyle = th.sunken;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.strokeStyle = th.hairline;
  g.lineWidth = 1;
  g.strokeRect(crisp(rect.x), crisp(rect.y), rect.w - 1, rect.h - 1);
  const mid = rect.y + rect.h / 2;
  g.strokeStyle = th.grid;
  g.beginPath();
  g.moveTo(rect.x, crisp(mid));
  g.lineTo(rect.x + rect.w, crisp(mid));
  g.stroke();

  /** @type {[number, number][]} */
  const points = new Array(TRACE_N);
  const half = rect.h / 2 - 4;
  for (let n = 0; n < TRACE_N; n += 1) {
    points[n] = [rect.x + (n / (TRACE_N - 1)) * rect.w, mid - trace(n) * gain * scale * half];
  }
  drawPolyline(g, points, { color: colour, width: 1.5 });

  g.font = `600 10px ${th.font}`;
  g.fillStyle = colour;
  g.textAlign = "left";
  g.textBaseline = "top";
  const text = rect.w < 420 ? label.short : label.long;
  g.fillText(text, rect.x + 7, rect.y + 5);
  g.font = `10px ${th.mono}`;
  g.fillStyle = th.text4;
  g.textAlign = "right";
  const room = rect.w - 14 - g.measureText(text).width - 12;
  if (g.measureText(note).width <= room) g.fillText(note, rect.x + rect.w - 7, rect.y + 5);
  g.restore();
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {{width: number, height: number}} size
 * @param {Theme} th
 * @param {Panels} L
 * @param {FrameModel} model
 * @param {number[]} row
 * @param {boolean} overlay
 * @param {{v: number, u: number}} w
 * @param {boolean} neutral  the 3D opening's first picture: both generators
 *        in every band, no ribbon, no title (the flat view while the 3D
 *        view loads, so the split is seen once, in 3D)
 */
function drawSpectrum(g, size, th, L, model, row, overlay, w, neutral) {
  const rect = L.spectrum;
  const plot = spectrumPlot(size, L);
  g.save();
  g.fillStyle = th.sunken;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.restore();
  drawGrid(g, plot, { xTicks: [1000, 2000, 3000], yTicks: [-80, -60, -40, -20] });

  g.save();
  plot.clip(g);
  // A ribbon along the top says which generator owns each 500 Hz band.
  for (let b = 0; b < (neutral ? 0 : BANDS); b += 1) {
    g.fillStyle = model.voicedBand[b] ? th.series[1] : th.series[2];
    g.globalAlpha = 0.8;
    g.fillRect(plot.x(b * BAND_HZ) + 1, plot.area.top, plot.x(BAND_HZ) - plot.x(0) - 2, 4);
  }
  g.globalAlpha = 1;

  // Shaped-noise levels, one block per unvoiced band (every band before
  // the opening's split).
  for (const nb of neutral ? model.bandNoise : model.noiseBands) {
    const db = linToDb(nb.amp * (model.voicedBand[nb.band] ? 1 : w.u));
    if (db <= DB_FLOOR) continue;
    const x0 = plot.x(nb.lo) + 1;
    const x1 = plot.x(nb.hi) - 1;
    const y = plot.y(Math.min(DB_TOP, db));
    g.fillStyle = th.series[2];
    g.globalAlpha = 0.22;
    g.fillRect(x0, y, x1 - x0, Math.min(16, plot.area.bottom - y));
    g.globalAlpha = 1;
    g.strokeStyle = th.series[2];
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, crisp(y, 2));
    g.lineTo(x1, crisp(y, 2));
    g.stroke();
  }

  // Measured spectrum of the decoded audio, on top of the blocks.
  if (overlay) {
    /** @type {[number, number][]} */
    const pts = row.map((db, i) => [plot.x(i * (NYQUIST / row.length)), plot.y(Math.max(DB_FLOOR, db))]);
    drawPolyline(g, pts, { color: th.series[3], width: 1, dash: [3, 3] });
  }

  // One stick per harmonic in a voiced band.
  g.strokeStyle = th.series[1];
  g.lineWidth = 1.5;
  for (const h of model.harmonics) {
    if (!h.voiced && !neutral) continue;
    const db = linToDb(h.voiced ? h.amp * w.v : h.amp);
    if (db <= DB_FLOOR) continue;
    const x = crisp(plot.x(h.f), 1.5);
    const y = plot.y(Math.min(DB_TOP, db));
    g.beginPath();
    g.moveTo(x, plot.area.bottom);
    g.lineTo(x, y);
    g.stroke();
    if (!h.voiced) continue;
    g.fillStyle = th.series[1];
    g.beginPath();
    g.arc(x, y, 2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  drawAxes(g, plot, {
    xTicks: [0, 1000, 2000, 3000, 4000],
    yTicks: [-80, -60, -40, -20],
    formatX: (v) => `${v / 1000}k`,
    formatY: (v) => String(v),
    fontSize: 10,
  });
  if (!neutral) panelTitle(g, th, "Spectrum: sticks are harmonics, blocks are noise bands", rect.x, rect.y + 11);
  return plot.area;
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {{width: number, height: number}} size
 * @param {Theme} th
 * @param {Rect} rect
 * @param {FrameModel} model
 */
function drawBands(g, size, th, rect, model) {
  const plot = subPlot(size, rect, [0, BANDS], [0, 1], { left: 30, right: 6, top: 18, bottom: 26 });
  g.save();
  g.fillStyle = th.sunken;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.restore();

  const bw = (plot.area.width / BANDS) * 0.78;
  for (let b = 0; b < BANDS; b += 1) {
    const x = plot.x(b + 0.5) - bw / 2;
    const y = plot.y(Math.max(0.012, model.bandVoicing[b]));
    g.fillStyle = model.voicedBand[b] ? th.series[1] : th.series[2];
    g.globalAlpha = model.voicedBand[b] ? 0.95 : 0.75;
    g.fillRect(x, y, bw, plot.area.bottom - y);
    g.globalAlpha = 1;
  }

  // The 0.55 threshold that splits voiced from unvoiced in the derived data.
  g.save();
  g.strokeStyle = th.axis;
  g.setLineDash([3, 3]);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(plot.area.left, crisp(plot.y(0.55)));
  g.lineTo(plot.area.right, crisp(plot.y(0.55)));
  g.stroke();
  g.restore();

  g.save();
  g.font = `9px ${th.mono}`;
  g.fillStyle = th.text4;
  g.textAlign = "right";
  g.textBaseline = "middle";
  g.fillText("0.55", plot.area.left - 4, plot.y(0.55));
  g.textAlign = "center";
  g.textBaseline = "top";
  for (let b = 0; b < BANDS; b += 1) {
    if (b % 2 && plot.area.width < 260) continue;
    g.fillText(`${(b * BAND_HZ) / 1000}k`, plot.x(b), plot.area.bottom + 6);
  }
  g.fillText("4k", plot.x(BANDS), plot.area.bottom + 6);
  g.restore();

  g.save();
  g.strokeStyle = th.axis;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(plot.area.left, crisp(plot.area.bottom));
  g.lineTo(plot.area.right, crisp(plot.area.bottom));
  g.stroke();
  g.restore();

  panelTitle(g, th, "Measured voicing strength per 500 Hz band", rect.x, rect.y + 11);
}

/**
 * @typedef {Object} Data
 * @property {{decoded: number[][]}} spectra
 * @property {(i: number) => FrameModel} frameModel
 */

/**
 * @typedef {Object} View
 * @property {number} frame
 * @property {number} mix
 * @property {boolean} overlay
 * @property {Layout} layout
 * @property {string} preset
 * @property {boolean} neutral  the opening's first picture (drawSpectrum)
 */

/**
 * @param {CanvasRenderingContext2D} g
 * @param {{width: number, height: number}} size
 * @param {Data} data
 * @param {View} state
 * @returns {{left: number, top: number, width: number, height: number}} the spectrum's plot area
 */
function paint(g, size, data, state) {
  const th = getTheme();
  const L = computeLayout(size, state.layout);
  clearCanvas(g, size, th.plotBg);
  const model = data.frameModel(state.frame);
  const w = weights(state.mix);
  if (L.wave.length) {
    const bands = model.noiseBands.length;
    drawWave(g, th, L.wave[0], (n) => model.voicedTrace[n], w.v, model.scale, th.series[1],
      { long: "Voiced: harmonic oscillator bank", short: "Voiced: oscillators" },
      model.voicedHarmonics ? `${model.voicedHarmonics} osc x${w.v.toFixed(2)}` : "silent");
    drawWave(g, th, L.wave[1], (n) => model.noiseTrace[n], w.u, model.scale, th.series[2],
      { long: "Unvoiced: noise shaped to the unvoiced bands", short: "Unvoiced: shaped noise" },
      bands ? `${bands} band${bands === 1 ? "" : "s"} x${w.u.toFixed(2)}` : "silent");
    drawWave(g, th, L.wave[2], (n) => model.voicedTrace[n] * w.v + model.noiseTrace[n] * w.u, 1, model.scale,
      th.series[0], { long: "Sum: what the two generators add up to", short: "Sum" },
      state.mix === 50 ? "measured mix" : "your mix");
  }
  const area = drawSpectrum(g, size, th, L, model, data.spectra.decoded[state.frame], state.overlay, w,
    state.neutral && state.layout === "spectrum");
  if (L.bands) drawBands(g, size, th, L.bands, model);
  return area;
}

/* ---------------------------------------------------------------------------
 * Text
 * ------------------------------------------------------------------------ */

/** @param {number} mix */
const mixText = (mix) =>
  mix === 50 ? "measured mix" : mix > 50 ? `voiced ${Math.round((mix - 50) * 2)}%` : `noise ${Math.round((50 - mix) * 2)}%`;

/** @param {FrameModel} model */
const f0Text = (model) => (model.f0 > 0 ? `${model.f0.toFixed(1)} Hz` : "none, a frame without pitch");

/**
 * The bands measured voiced, as ranges in kHz: "0 to 1 kHz and 2 to 2.5 kHz".
 * @param {boolean[]} voiced
 */
function bandList(voiced) {
  /** @type {string[]} */
  const runs = [];
  for (let b = 0; b < BANDS; b += 1) {
    if (!voiced[b] || voiced[b - 1]) continue;
    let e = b;
    while (e + 1 < BANDS && voiced[e + 1]) e += 1;
    runs.push(`${(b * BAND_HZ) / 1000} to ${((e + 1) * BAND_HZ) / 1000} kHz`);
  }
  return runs.length ? runs.join(" and ") : "none";
}

/* ---------------------------------------------------------------------------
 * Mount
 * ------------------------------------------------------------------------ */

/**
 * @param {Element} host
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure synth";
  figure.innerHTML = MARKUP;
  host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const readoutsEl = $(figure, '[data-ref="readouts"]', HTMLOutputElement);
  const mixEl = $(figure, '[data-ref="mix"]', HTMLInputElement);
  const mixOut = $(figure, '[data-ref="mixout"]', HTMLOutputElement);
  const snap = $(figure, '[data-ref="snap"]', HTMLButtonElement);
  const overlayEl = $(figure, '[data-ref="overlay"]', HTMLInputElement);
  const toggle = $(figure, 'button[data-view="3d"]', HTMLButtonElement);
  const camera = $(figure, '[data-ref="camera"]', HTMLElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const play = $(figure, ".anim-btn--play", HTMLButtonElement);
  const range = $(figure, ".anim-range", HTMLInputElement);
  const source = $(figure, '[data-ref="source"]', HTMLElement);
  source.append(" ", badge("derived-decoded"), " ", badge("illustrative"));
  figure.dataset.view = "2d";

  const [framesFile, spectra] = /** @type {[{frames: import("./lib/synth-model.js").SynthFrame[]}, {decoded: number[][]}]} */ (
    await Promise.all([loadJSON(FRAMES, { signal }), loadJSON(SPECTRA, { signal })]));
  if (signal.aborted) return () => {};
  delete frame.dataset.state;
  const frames = framesFile.frames;
  /** @type {Map<number, FrameModel>} */
  const cache = new Map();
  /** @type {Data} */
  const data = {
    spectra,
    frameModel(i) {
      let model = cache.get(i);
      if (!model) cache.set(i, (model = buildFrameModel(frames, spectra, i)));
      return model;
    },
  };

  // With WebGL 2 and motion allowed the figure opens in 3D (owner decision
  // O1), so it lays out the spectrum panel from the start and the frame
  // never changes shape when the 3D view arrives; it holds its frame until
  // the reader presses Play. Until the 3D view is up the
  // panel shows the opening's first picture, so the split is seen once.
  const intro = opensIn3D();
  /** @type {View} */
  const state = {
    frame: Math.min(START_FRAME, frames.length - 1),
    mix: 50,
    overlay: true,
    layout: intro ? "spectrum" : "full",
    preset: "corner",
    neutral: intro,
  };

  /** @type {ReturnType<typeof createLoop> | null} */
  let loop = null;
  // From the frame's width, which the aspect does not change; the canvas
  // measures 1 px while the 3D view hides it.
  const fitFrame = () => {
    const width = frame.clientWidth;
    if (!width) return;
    const aspect = width >= TWO_COL ? "var(--anim-aspect-house)" : `${width} / ${naturalHeight(width, state.layout)}`;
    if (frame.style.getPropertyValue("--anim-aspect") !== aspect) frame.style.setProperty("--anim-aspect", aspect);
  };
  const handle = setupCanvas(canvas, {
    onResize: () => {
      fitFrame();
      loop?.render();
    },
  });
  fitFrame();
  /** The spectrum's plot area as last painted at the frame's size (the tests' Front check). */
  let painted = { x: 0, y: 0, width: 0, height: 0, canvas: { width: 0, height: 0 } };
  loop = createLoop(() => {
    const area = paint(handle.ctx, handle, data, state);
    if (handle.width > 1 && state.layout === "spectrum") {
      painted = { x: area.left, y: area.top, width: area.width, height: area.height, canvas: { width: handle.width, height: handle.height } };
    }
  }, { element: figure, autoplay: false });
  if (TEST_HOOK) /** @type {Record<string, unknown>} */ (TEST_HOOK.figures)[SLUG] = { painted: () => painted };

  /* ---- labels and readouts ---------------------------------------------- */

  const describe = () => {
    const model = data.frameModel(state.frame);
    const voiced = model.voicedBand.filter(Boolean).length;
    const what = state.layout === "full"
      ? "Three waveform panels (voiced oscillators, shaped noise, and their sum) beside the spectrum and the measured voicing per band."
      : "The spectrum panel: sticks for the harmonics in voiced bands, blocks for the noise in unvoiced bands.";
    return `Frame ${state.frame} of ${frames.length - 1} at ${(state.frame * 0.02).toFixed(2)} s. ` +
      `f0 ${f0Text(model)}, measured on the decoded audio. ${voiced} of 8 bands voiced (${bandList(model.voicedBand)}). ` +
      `Mix: ${mixText(state.mix)}. ${what}`;
  };
  let labelTimer = 0;
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => canvas.setAttribute("aria-label", describe()), 250);
  };
  canvas.setAttribute("aria-label", describe());

  const readouts = () => {
    const model = data.frameModel(state.frame);
    const w = weights(state.mix);
    const voiced = model.voicedBand.filter(Boolean).length;
    readoutsEl.innerHTML = [
      `f<sub>0</sub> <b>${f0Text(model)}</b>`,
      `pitch change from the previous frame <b>${pitchChangeText(pitchChange(frames, state.frame))}</b>`,
      `harmonics below 4 kHz <b>${model.harmonicCount}</b>, in voiced bands <b>${model.voicedHarmonics}</b>`,
      `voiced bands <b>${voiced} of 8</b>`,
      `level <b>${model.rms.toFixed(1)} dBFS</b>`,
      `mix <b>voiced &times;${w.v.toFixed(2)}, noise &times;${w.u.toFixed(2)}</b>`,
    ].map((s) => `<span>${s}</span>`).join("");
    mixOut.textContent = mixText(state.mix);
  };

  /* ---- the 3D view ------------------------------------------------------ */

  /** When the reader last scrubbed or pressed Play. */
  let lastTouch = -Infinity;
  /** @type {ReturnType<typeof createTransport> | null} */
  let transport = null;
  // Nothing starts playback but the reader: the frame the step talks about
  // stays on show after the opening until Play is pressed, so playback never
  // walks off it onto silence while the step asks about it.
  const touch = () => {
    lastTouch = performance.now();
  };
  play.addEventListener("click", touch, { signal, capture: true });
  range.addEventListener("input", touch, { signal, capture: true });
  // Loading and first drawing the 3D part holds the page up for a moment,
  // so it waits until the frame and Play have been left alone for CALM ms:
  // a press on Play or a scrub is never held up by it.
  const CALM = 800;
  const calm = () => new Promise((resolve) => {
    const check = () => {
      const left = lastTouch + CALM - performance.now();
      if (left <= 0 || signal.aborted) resolve(undefined);
      else window.setTimeout(check, left);
    };
    check();
  });

  /** @returns {SynthState} */
  const forThree = () => ({
    frame: state.frame,
    frames: frames.length,
    mix: state.mix,
    overlay: state.overlay,
    preset: state.preset,
    model: data.frameModel,
    measured: (i) => spectra.decoded[i],
    plotRect: () => {
      const size = { width: frame.clientWidth, height: frame.clientHeight };
      const { area } = spectrumPlot(size, computeLayout(size, "spectrum"));
      return { x: area.left, y: area.top, width: area.width, height: area.height };
    },
    playing: () => play.getAttribute("aria-pressed") === "true",
    introDone: () => {},
  });

  const views = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: forThree,
    load: () => calm().then(() => import("./anim-synth-3d.js")),
    id: SLUG,
    onView: (view) => {
      state.neutral = false;
      figure.dataset.view = view === "2d" ? "2d" : "3d";
      camera.hidden = view === "2d";
      loop?.render();
    },
  });

  // The 3D control's pressed state is the one source of the layout: it is
  // pressed while 3D is wanted (loading, up or parked), and released when
  // the reader leaves 3D, or when 3D turns out not to work. The opening
  // rule (O1) is the view switch's own (start "auto"): it presses the
  // control at once and loads the 3D part when the frame comes near.
  const syncLayout = () => {
    const wanted = toggle.getAttribute("aria-pressed") === "true";
    const layout = wanted ? "spectrum" : "full";
    if (!wanted) {
      state.neutral = false;
      figure.dataset.view = "2d";
      camera.hidden = true;
    }
    if (layout === state.layout) return;
    state.layout = layout;
    fitFrame();
    loop?.render();
    relabel();
  };
  const pressed = new MutationObserver(syncLayout);
  pressed.observe(toggle, { attributes: true, attributeFilter: ["aria-pressed", "disabled"] });
  syncLayout();
  if (toggle.disabled) hint.textContent ||= NO_WEBGL_HINT;

  const cameraButtons = [...camera.querySelectorAll("button[data-preset]")];
  const showPreset = () => {
    for (const b of cameraButtons) b.setAttribute("aria-pressed", String(b.getAttribute("data-preset") === state.preset));
  };
  /** @param {string} name */
  const goPreset = (name) => {
    if (!PRESETS.includes(name)) return;
    state.preset = name;
    showPreset();
    views.preset(name);
  };
  for (const b of cameraButtons) {
    b.addEventListener("click", () => goPreset(b.getAttribute("data-preset") ?? "corner"), { signal });
  }

  /* ---- controls --------------------------------------------------------- */

  const repaint = () => {
    readouts();
    loop?.render();
    relabel();
    views.update(forThree());
  };

  transport = createTransport(figure, {
    frames: frames.length,
    fps: PLAY_FPS,
    startFrame: state.frame,
    autoplay: false,
    format: (i) => `frame ${i} · ${(i * 0.02).toFixed(2)} s`,
    onFrame: (i) => {
      state.frame = i;
      repaint();
    },
  });

  /** @param {number} mix */
  const setMix = (mix) => {
    state.mix = Math.max(0, Math.min(100, Math.round(mix)));
    mixEl.value = String(state.mix);
    repaint();
  };
  mixEl.addEventListener("input", () => setMix(Number(mixEl.value)), { signal });
  snap.addEventListener("click", () => setMix(50), { signal });
  overlayEl.addEventListener("change", () => {
    state.overlay = overlayEl.checked;
    figure.dataset.overlay = state.overlay ? "on" : "off";
    repaint();
  }, { signal });

  if (steps.length) {
    // Each step holds the frame it talks about, found by a named criterion
    // (lib/picks.js); the first, applied as the figure mounts, keeps the
    // frame the figure opens on.
    let mounted = false;
    createStepper(figure, steps, (s, { animate }) => {
      const pick = s.pick && Object.hasOwn(PICKS, s.pick) ? PICKS[/** @type {keyof typeof PICKS} */ (s.pick)] : null;
      const picked = pick ? pick(/** @type {any} */ (frames)) : null;
      if (picked && mounted) transport?.seek(picked.i);
      mounted = true;
      if (s.mix !== undefined) setMix(Number(s.mix));
      if (s.preset) goPreset(s.preset);
      // A step asks for 3D only when the reader moves to it, never under
      // reduced motion: under reduced motion nothing 3D loads until the 3D
      // control is pressed, and the step reads correctly in 2D.
      if (s.view === "3d" && animate && views.available()) void views.show3D();
      // A step about one flat frame asks for 2D, and leaves 3D.
      else if (s.view === "2d") views.show2D();
    }, { signal });
  }

  const offTheme = onThemeChange(() => loop?.render());
  readouts();
  loop.render();

  return () => {
    offTheme();
    pressed.disconnect();
    clearTimeout(labelTimer);
    transport?.destroy();
    loop?.destroy();
    handle.destroy();
  };
}
