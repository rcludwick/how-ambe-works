// @ts-check
/* ===========================================================================
 * anim-listen-terrain.js: what the round trip keeps, as terrain.
 * ---------------------------------------------------------------------------
 * SLUG          listen-terrain   (docs/12-listen.md, after the note "How to
 *               check any number on this page", with a poster and seven
 *               steps)
 *
 * DATA READ     assets/data/<clip>/spectra.json
 *                 .original[frame][bin], .decoded[frame][bin]  dBFS, 128
 *                 bins 31.25 Hz apart, a 32 ms Hann window per 20 ms frame
 *               assets/data/<clip>/frames.json
 *                 .frames[].derived only: orig_rms_dbfs, orig_f0_hz,
 *                 decoded_f0_hz. The measured .hex field is never read.
 *               assets/audio/<clip>-original.wav and <clip>-ambe.wav, played
 *               a short segment at a time from the reader's press.
 *
 *               DERIVED, not codec state: FFTs and pitch tracks of the input
 *               and of the AMBE-3000's decoded audio, by tools/make-data.py.
 *               The chip reports neither, and nothing here claims to be its
 *               internal spectrum. Every statistic matches
 *               tools/listen-stats.py, which states its criteria.
 *
 * CONTROLS      four clips (CQ and sea shells, male and female), the
 *               difference shown or not, a slider through the clip one 20 ms
 *               frame at a time, and two segment players (0.6 s around the
 *               frame, original or decoded). Steps (keys clip, show, pick,
 *               view, preset, play) choose frames by named criteria (PICKS),
 *               never by index; play="valleys" asks the 3D view to replay
 *               its valleys beat for the step's clip.
 *
 * WHAT IT DRAWS 2D: three strips against time, the original's spectrogram
 *               on top, decoded minus original in the middle (blue where
 *               the decoded audio is lower, amber where it is higher, quiet
 *               frames grey), the decoded spectrogram below, and the selected
 *               frame as a line through all three. Directly under them, "Line
 *               up the harmonics": the clip's mean peak-normalised spectrum
 *               against f / f0, each track on its own pitch, the gap where
 *               the decoded curve is lower filled in the diverge blue. 3D
 *               (anim-listen-terrain-3d.js, loaded only when wanted): the
 *               same strips as terrain, one sheet per strip side by side in
 *               depth; its Top preset is this 2D layout.
 *
 * WHAT IT IS FOR
 *               Chapter 12 says the round trip keeps pitch, envelope and band
 *               level, and changes texture. The figure shows one way the
 *               texture changes on pitched frames: the decoded audio keeps
 *               the harmonic peaks and deepens the valleys between them.
 *               There is no claim about what a listener hears.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  clearCanvas,
  createAudioPlayer,
  createPlot,
  drawAxes,
  drawGrid,
  drawLabel,
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
import { mix, rampColor, tokenHex } from "./lib/style.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "listen-terrain";
const STEP_KEYS = /** @type {const} */ (["clip", "show", "pick", "view", "preset", "play"]);

/** One frame every 20 ms. */
export const HOP_S = 0.02;
/** The sheets' floor, dBFS. Below it is the noise of the recordings. */
export const FLOOR_DB = -80;
/** The difference's colour and height run out at this many dB either way. */
export const DIFF_DB = 20;
/** tools/listen-stats.py ENERGETIC_DBFS: frames quieter than this are masked. */
export const ENERGETIC_DBFS = -40;
/** tools/listen-stats.py PROFILE_U, PROFILE_STEP, PROFILE_HARMONICS. */
export const PROFILE_U = /** @type {const} */ ([0.5, 7.5]);
export const PROFILE_STEP = 0.05;
export const PROFILE_HARMONICS = 7;
/** tools/listen-stats.py KHZ_BANDS. */
export const KHZ_BANDS = /** @type {const} */ ([[0, 1000], [1000, 2000], [2000, 3000], [3000, 4000]]);
/** The three strips (and sheets): their depth and the gap between, as parts of one. */
export const STRIP = { depth: 0.7, gap: 0.12 };
/** Seconds of audio a segment player plays around the frame. */
const SEGMENT_S = 0.6;

export const CLIPS = [
  { id: "lr-b", label: "CQ, male" },
  { id: "lr-c", label: "Sea shells, male" },
  { id: "lj-c", label: "Sea shells, female" },
  { id: "lj-b", label: "CQ, female" },
];

const PRESETS = [
  { id: "corner", label: "Corner" },
  { id: "top", label: "Top" },
  { id: "side", label: "Side" },
];

const SHOWS = [
  { id: "both", label: "Both sheets" },
  { id: "difference", label: "With difference" },
];

/**
 * A clip as the figure draws it: levels held at the floor, the difference
 * masked on quiet frames. Flat arrays, frame-major: [frame * bins + bin].
 * @typedef {Object} ListenData
 * @property {string} clip
 * @property {string} text
 * @property {"male" | "female"} voice
 * @property {number} n  frames
 * @property {number} bins
 * @property {number} nyquist  the top bin's centre, Hz
 * @property {number} duration  n * HOP_S
 * @property {number} delayS  how late the decoded audio arrives
 * @property {Float32Array} original  dBFS, at least FLOOR_DB
 * @property {Float32Array} decoded
 * @property {Float32Array} diff  decoded minus original, dB; 0 where masked
 * @property {Uint8Array} energetic  1 where the original frame is at least ENERGETIC_DBFS
 * @property {Float32Array} f0o  the original's pitch per frame, 0 where none
 * @property {Float32Array} f0d  the decoded audio's pitch per frame
 * @property {Float32Array} rms  the original's RMS per frame, dBFS
 * @property {Profile} profile
 * @property {{lo: number, hi: number, energy_db: number}[]} bands  over the energetic frames
 * @property {number} loudDb  the 95th percentile of the energetic frames'
 *           levels (both tracks): the top of the colour ramp
 * @property {string} originalAudio
 * @property {string} decodedAudio
 */

/**
 * "Line up the harmonics" (tools/listen-stats.py profile_summary).
 * @typedef {Object} Profile
 * @property {number} frames
 * @property {number[]} u
 * @property {number[]} original  mean peak-normalised dB at each u
 * @property {number[]} decoded
 * @property {{h: number, original_db: number, decoded_db: number, deeper_db: number}[]} harmonics
 * @property {[number, number]} deeper_db  the least and most, over the harmonics
 */

/**
 * What the 3D part is given: the 2D module's arrays and choices. It computes
 * no model data of its own.
 * @typedef {Object} ListenState
 * @property {string} clip
 * @property {ListenData | null} data
 * @property {number} frame  the selected frame
 * @property {"both" | "difference"} show
 * @property {string} preset  corner, top or side
 * @property {number} pulses  bumped when a step picks a frame
 * @property {number} replays  bumped when a step asks for the valleys beat
 * @property {(width: number, height: number) => {x: number, y: number, width: number, height: number}} plotRect
 *           the three strips' area in a frame of that size
 */

/* ---------------------------------------------------------------------------
 * Arithmetic, mirrored from tools/listen-stats.py (the lib spec pins it)
 * ------------------------------------------------------------------------ */

/** @param {number} db */
const power = (db) => 10 ** (db / 10);

/**
 * Energy-summed level change per 1 kHz band over the given frames:
 * 10 log10(decoded power / original power), summed over bins and frames.
 * @param {SpectraFile} spectra
 * @param {number[]} rows frame indices
 * @returns {{lo: number, hi: number, energy_db: number}[]}
 */
export function bandDeltas(spectra, rows) {
  const hz = spectra.bin_centre_hz;
  return KHZ_BANDS.map(([lo, hi]) => {
    let po = 0;
    let pd = 0;
    for (const r of rows) {
      for (let k = 0; k < hz.length; k += 1) {
        if (hz[k] < lo || hz[k] >= hi) continue;
        po += power(spectra.original[r][k]);
        pd += power(spectra.decoded[r][k]);
      }
    }
    return { lo, hi, energy_db: po > 0 && pd > 0 ? 10 * Math.log10(pd / po) : NaN };
  });
}

/**
 * The mean peak-normalised spectrum against u = f / f0, each track read on
 * its own pitch, over the energetic frames where both tracks have one; and
 * the peak above valley, profile(h) - profile(h + 0.5), for h = 1 to 7.
 * @param {SpectraFile} spectra
 * @param {FrameDerived[]} derived
 * @returns {Profile}
 */
export function harmonicProfile(spectra, derived) {
  const count = Math.round((PROFILE_U[1] - PROFILE_U[0]) / PROFILE_STEP);
  const u = Array.from({ length: count + 1 }, (_, k) => PROFILE_U[0] + k * PROFILE_STEP);
  const sums = { original: new Float64Array(u.length), decoded: new Float64Array(u.length) };
  let frames = 0;
  /** @param {number[]} row @param {number} f0 @param {Float64Array} into */
  const add = (row, f0, into) => {
    const top = Math.max(...row);
    u.forEach((x, k) => {
      const at = (x * f0) / spectra.bin_hz;
      const i = Math.floor(at);
      const t = at - i;
      into[k] += row[i] * (1 - t) + row[i + 1] * t - top;
    });
  };
  derived.forEach((d, i) => {
    if (d.orig_rms_dbfs < ENERGETIC_DBFS || d.orig_f0_hz <= 0 || d.decoded_f0_hz <= 0) return;
    frames += 1;
    add(spectra.original[i], d.orig_f0_hz, sums.original);
    add(spectra.decoded[i], d.decoded_f0_hz, sums.decoded);
  });
  const original = Array.from(sums.original, (s) => s / Math.max(1, frames));
  const decoded = Array.from(sums.decoded, (s) => s / Math.max(1, frames));
  const per = Math.round(1 / PROFILE_STEP);
  /** @param {number} h */
  const at = (h) => Math.round((h - PROFILE_U[0]) / PROFILE_STEP);
  const harmonics = Array.from({ length: PROFILE_HARMONICS }, (_, j) => {
    const h = j + 1;
    const o = original[at(h)] - original[at(h) + per / 2];
    const d = decoded[at(h)] - decoded[at(h) + per / 2];
    return { h, original_db: o, decoded_db: d, deeper_db: d - o };
  });
  const deeper = harmonics.map((x) => x.deeper_db);
  return { frames, u, original, decoded, harmonics, deeper_db: [Math.min(...deeper), Math.max(...deeper)] };
}

/**
 * The clip as the figure draws it.
 * @param {SpectraFile} spectra
 * @param {FramesFile} frames
 * @returns {ListenData}
 */
export function prepare(spectra, frames) {
  const n = Math.min(spectra.original.length, frames.frames.length);
  const bins = spectra.bins;
  const derived = frames.frames.slice(0, n).map((f) => f.derived);
  const original = new Float32Array(n * bins);
  const decoded = new Float32Array(n * bins);
  const diff = new Float32Array(n * bins);
  const energetic = Uint8Array.from(derived, (d) => (d.orig_rms_dbfs >= ENERGETIC_DBFS ? 1 : 0));
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < bins; k += 1) {
      const o = Math.max(FLOOR_DB, spectra.original[i][k]);
      const d = Math.max(FLOOR_DB, spectra.decoded[i][k]);
      original[i * bins + k] = o;
      decoded[i * bins + k] = d;
      diff[i * bins + k] = energetic[i] ? d - o : 0;
    }
  }
  const rows = [];
  for (let i = 0; i < n; i += 1) if (energetic[i]) rows.push(i);
  const levels = new Float32Array(rows.length * bins * 2);
  rows.forEach((i, r) => {
    levels.set(original.subarray(i * bins, (i + 1) * bins), r * 2 * bins);
    levels.set(decoded.subarray(i * bins, (i + 1) * bins), (r * 2 + 1) * bins);
  });
  levels.sort();
  const loudDb = levels.length ? levels[Math.floor(0.95 * (levels.length - 1))] : 0;
  return {
    clip: spectra.clip.id,
    text: spectra.clip.text,
    voice: spectra.clip.voice.sex === "male" ? "male" : "female",
    n,
    bins,
    nyquist: spectra.bin_centre_hz[bins - 1],
    duration: n * HOP_S,
    delayS: spectra.clip.decoded_delay_ms / 1000,
    original,
    decoded,
    diff,
    energetic,
    f0o: Float32Array.from(derived, (d) => d.orig_f0_hz),
    f0d: Float32Array.from(derived, (d) => d.decoded_f0_hz),
    rms: Float32Array.from(derived, (d) => d.orig_rms_dbfs),
    profile: harmonicProfile(spectra, derived),
    bands: bandDeltas(spectra, rows),
    loudDb: Math.max(FLOOR_DB + 20, loudDb),
    originalAudio: spectra.clip.original_audio,
    decodedAudio: spectra.clip.decoded_audio,
  };
}

/**
 * Named frame criteria for the steps (never an index in the Markdown).
 * @type {Record<string, (data: ListenData) => number | null>}
 */
export const PICKS = {
  // The loudest energetic frame where both tracks have a pitch.
  "loudest-pitched": (data) => loudest(data, (i) => data.f0o[i] > 0 && data.f0d[i] > 0),
  // The loudest energetic frame where the original has no pitch.
  "loudest-unpitched": (data) => loudest(data, (i) => data.f0o[i] <= 0),
};

/**
 * @param {ListenData} data
 * @param {(i: number) => boolean} keep
 * @returns {number | null}
 */
function loudest(data, keep) {
  let best = null;
  for (let i = 0; i < data.n; i += 1) {
    if (!data.energetic[i] || !keep(i)) continue;
    if (best === null || data.rms[i] > data.rms[best]) best = i;
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * Colour: one mapping for both views
 * ------------------------------------------------------------------------ */

/** 0 at the floor to 1 at 0 dBFS: a sheet's height. @param {number} db */
export const levelT = (db) => Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));

/**
 * A level's place on the colour ramp: 0 at the floor (the clip's 5th
 * percentile) to 1 at its 95th percentile, so the loud harmonics reach the
 * ramp's far end. @param {ListenData} data @param {number} db
 */
export const colourT = (data, db) => Math.min(1, Math.max(0, (db - FLOOR_DB) / (data.loudDb - FLOOR_DB)));

/**
 * How much of the ramp a level shows: the quiet floor fades into the ground,
 * so the harmonics stand out of it. @param {number} t
 */
export const levelWeight = (t) => {
  const x = Math.min(1, Math.max(0, (t - 0.12) / 0.4));
  return x * x * (3 - 2 * x);
};

/**
 * A level's colour, the ramp faded into `ground` by levelWeight.
 * @param {number} t colourT (or levelT)
 * @param {number} ground 0xRRGGBB
 * @returns {number}
 */
export const levelColour = (t, ground) => mix(ground, rampColor(t), levelWeight(t));

/**
 * The difference's colour: --ambe-diverge-neg (decoded lower) through -mid
 * to -pos (decoded higher), saturating at DIFF_DB.
 * @param {number} db
 * @returns {number}
 */
export const diffColour = (db) => {
  const t = Math.max(-1, Math.min(1, db / DIFF_DB));
  return mix(tokenHex("--ambe-diverge-mid"), tokenHex(t < 0 ? "--ambe-diverge-neg" : "--ambe-diverge-pos"), Math.abs(t));
};

/**
 * Where a difference shows: where either track is loud enough for its
 * level to show (levelWeight of the louder), in 16 steps, times 256, plus
 * the difference in 256 steps; -1 on a quiet (masked) frame. Two tracks
 * that are both near the floor differ by noise, and fade out with it.
 * @param {ListenData} data
 * @param {number} i
 * @param {number} k
 * @returns {number}
 */
export function diffIndex(data, i, k) {
  if (!data.energetic[i]) return -1;
  const at = i * data.bins + k;
  const w = Math.round(levelWeight(colourT(data, Math.max(data.original[at], data.decoded[at]))) * 15);
  return w * 256 + Math.round(Math.max(-1, Math.min(1, data.diff[at] / DIFF_DB)) * 127.5 + 127.5);
}

/**
 * The colours diffIndex() indexes, faded into `ground` where both are quiet.
 * @param {number} ground 0xRRGGBB
 * @returns {number[]}
 */
export function diffTable(ground) {
  const hues = Array.from({ length: 256 }, (_, j) => diffColour(((j - 127.5) / 127.5) * DIFF_DB));
  return Array.from({ length: 16 * 256 }, (_, j) => mix(ground, hues[j % 256], Math.floor(j / 256) / 15));
}

/** The masked (quiet) frames' grey. @returns {number} */
export const maskColour = () => mix(tokenHex("--ambe-diverge-mid"), tokenHex("--ambe-plot-bg"), 0.55);

/**
 * A strip's picture, one pixel per frame and bin, high frequencies at the
 * top, in the 2D colours: the levels on the ramp faded into --ambe-plot-bg
 * when quiet, the difference in --ambe-diverge-*, quiet frames grey. The
 * 3D view's Top preset shows the same pictures.
 * @param {ListenData} data
 * @param {number} b strip: 0 original, 1 difference, 2 decoded
 * @returns {HTMLCanvasElement}
 */
export function stripImage(data, b) {
  const ground = tokenHex("--ambe-plot-bg");
  const image = document.createElement("canvas");
  image.width = data.n;
  image.height = data.bins;
  const g = /** @type {CanvasRenderingContext2D} */ (image.getContext("2d"));
  const pixels = g.createImageData(data.n, data.bins);
  const levels = b === 0 ? data.original : data.decoded;
  const levelLut = Array.from({ length: 256 }, (_, j) => levelColour(j / 255, ground));
  const diffLut = b === 1 ? diffTable(ground) : [];
  const mask = maskColour();
  for (let i = 0; i < data.n; i += 1) {
    for (let k = 0; k < data.bins; k += 1) {
      let hex;
      if (b === 1) {
        const e = diffIndex(data, i, k);
        hex = e < 0 ? mask : diffLut[e];
      } else {
        hex = levelLut[Math.round(colourT(data, levels[i * data.bins + k]) * 255)];
      }
      const at = ((data.bins - 1 - k) * data.n + i) * 4;
      pixels.data[at] = Math.floor(hex / 65536) % 256;
      pixels.data[at + 1] = Math.floor(hex / 256) % 256;
      pixels.data[at + 2] = hex % 256;
      pixels.data[at + 3] = 255;
    }
  }
  g.putImageData(pixels, 0, 0);
  return image;
}

/* ---------------------------------------------------------------------------
 * Layout
 * ------------------------------------------------------------------------ */

/**
 * The three strips' area in a canvas of `width` x `height` CSS px. The 3D
 * view's Top preset fits to it.
 * @param {number} width
 * @param {number} height
 */
export function plotRect(width, height) {
  const left = width < 560 ? 40 : 54;
  const right = width < 560 ? 10 : 16;
  const top = 10;
  const bottom = 34;
  return { x: left, y: top, width: Math.max(1, width - left - right), height: Math.max(1, height - top - bottom) };
}

/**
 * The strips inside the plot rect, top to bottom: original, difference,
 * decoded. Their heights keep STRIP's proportions, as the 3D sheets do.
 * @param {{x: number, y: number, width: number, height: number}} rect
 */
export function strips(rect) {
  const whole = 3 * STRIP.depth + 2 * STRIP.gap;
  const h = (rect.height * STRIP.depth) / whole;
  const g = (rect.height * STRIP.gap) / whole;
  return [0, 1, 2].map((s) => ({ x: rect.x, y: rect.y + s * (h + g), width: rect.width, height: h }));
}

/** @param {number} i */
const seconds = (i) => `${((i + 0.5) * HOP_S).toFixed(2)} s`;
const pressed = (/** @type {boolean} */ on) => (on ? "true" : "false");
/** @param {number} v */
const signed = (v) => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? "0.0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
};

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Original versus AMBE-3000 decoded spectrogram terrain</p>
</div>
<div class="anim-figure__frame" data-state="loading">
  <canvas class="anim-figure__canvas" role="img" aria-label="Spectrograms of a clip and its decoded audio, loading."></canvas>
</div>
<div class="lt-harmonics">
  <p class="lt-harmonics__title">Line up the harmonics</p>
  <div class="lt-harmonics__frame">
    <canvas class="anim-figure__canvas" data-role="harmonics" role="img" aria-label="Mean spectrum against harmonic number, loading."></canvas>
  </div>
  <ul class="anim-legend">
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line lt__swatch--orig"></i>original (dashed)</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line lt__swatch--dec"></i>decoded (thick)</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch lt__swatch--gap"></i>where the decoded curve is lower: the deeper valleys</li>
  </ul>
</div>
<div class="anim-figure__step"></div>
<ul class="anim-legend">
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line lt__swatch--this"></i>this frame (thick line, outlined in 3D)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch lt__swatch--ramp"></i>level, from quiet (faded into the ground) to loud</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch lt__swatch--neg"></i>decoded lower than the original (to -20 dB)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch lt__swatch--pos"></i>decoded higher (to +20 dB)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch lt__swatch--mask"></i>quiet frames, below -40 dBFS: not compared (flat in 3D)</li>
</ul>
<div class="anim-controls">
  <div class="anim-controls__group" role="group" aria-label="Clip">
    ${CLIPS.map((c) => `<button class="anim-btn" type="button" data-clip="${c.id}" aria-pressed="false">${c.label}</button>`).join("\n    ")}
  </div>
  <div class="anim-controls__group" role="group" aria-label="Show">
    ${SHOWS.map((s) => `<button class="anim-btn" type="button" data-show="${s.id}" aria-pressed="false">${s.label}</button>`).join("\n    ")}
  </div>
</div>
<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Through the clip</span>
    <input class="anim-range" type="range" min="0" max="0" step="1" value="0"
           data-role="frame" aria-label="Frame in the clip">
  </label>
  <div class="anim-controls__group" role="group" aria-label="Hear 0.6 s around this frame">
    <span class="anim-field__label">Hear 0.6 s</span>
    <button class="anim-btn anim-btn--play" type="button" data-kind="audio" data-role="play-original" aria-pressed="false">Original</button>
    <button class="anim-btn anim-btn--play" type="button" data-kind="audio" data-role="play-decoded" aria-pressed="false">Decoded</button>
  </div>
</div>
<div class="anim-controls">
  <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">Terrain (3D)</button>
  <div class="anim-controls__group" data-role="camera" hidden>
    <span class="anim-field__label">Camera</span>
    <div class="anim-toggle-group" role="group" aria-label="Camera">
      ${PRESETS.map((p) => `<button class="anim-btn" type="button" data-preset="${p.id}" aria-pressed="false">${p.label}</button>`).join("\n      ")}
    </div>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
<div class="anim-forms" data-role="readout" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">this frame</span>
    <code data-role="r-frame"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">band level</span>
    <code data-role="r-bands"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">valleys</span>
    <code data-role="r-valleys"></code></p>
</div>
<figcaption class="anim-figure__caption">
  Each strip is a spectrogram: time across, 0 to 4&nbsp;kHz up, level as
  colour. Top, the clip as it went into the ThumbDV; bottom, as it came
  back; middle, decoded minus original, in dB. In 3D each strip is a sheet
  whose height is its level, the sheets side by side in depth, and the
  difference a flat carpet of colour. The panel under it lines the
  harmonics up: every pitched frame's spectrum is read
  at multiples of its own pitch, normalised to its peak and averaged, for
  each track on that track's pitch. The 32&nbsp;ms analysis window limits
  how deep a valley can look, more at a male pitch, where the harmonics
  sit closer together.
  <span class="anim-figure__source">FFTs and pitch tracks of the input
  audio and of the chip's decoded audio, computed by tools/make-data.py and
  reduced by tools/listen-stats.py. The AMBE-3000 reports neither.</span>
</figcaption>
`;

/**
 * @param {Element} host the `[data-anim="listen-terrain"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  // The steps keep their state from here; their data-* would otherwise
  // match the buttons' selectors too.
  for (const step of steps) for (const key of STEP_KEYS) step.item.removeAttribute(`data-${key}`);
  const root = document.createElement("figure");
  root.className = "anim-figure anim-lt";
  root.innerHTML = FIGURE_HTML;
  root.dataset.view = "2d";
  host.append(root);
  markEnhanced(host);
  $(root, ".anim-figure__caption", HTMLElement).append(" ", badge("derived-input"), " ", badge("derived-decoded"));

  const frame = $(root, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const harmCanvas = $(root, '[data-role="harmonics"]', HTMLCanvasElement);
  const slider = $(root, '[data-role="frame"]', HTMLInputElement);
  const frameEl = $(root, '[data-role="r-frame"]', HTMLElement);
  const bandsEl = $(root, '[data-role="r-bands"]', HTMLElement);
  const valleysEl = $(root, '[data-role="r-valleys"]', HTMLElement);
  const playOriginal = $(root, '[data-role="play-original"]', HTMLButtonElement);
  const playDecoded = $(root, '[data-role="play-decoded"]', HTMLButtonElement);
  const toggle = $(root, '[data-view="3d"]', HTMLButtonElement);
  const camera = $(root, '[data-role="camera"]', HTMLElement);
  const hint = $(root, ".anim-figure__hint--webgl", HTMLElement);
  /** @param {string} selector */
  const all = (selector) => /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll(selector)]);
  const clipEls = all("[data-clip]");
  const showEls = all("[data-show]");
  const presetEls = all("[data-preset]");

  const first = steps[0]?.state ?? {};
  /** @type {ListenState} */
  const state = {
    clip: first.clip ?? CLIPS[0].id,
    data: null,
    frame: 0,
    show: first.show === "both" ? "both" : "difference",
    preset: first.preset ?? "corner",
    pulses: 0,
    replays: 0,
    plotRect,
  };
  /** @type {Map<string, ListenData>} */
  const cache = new Map();
  /** @type {ReturnType<typeof createAudioPlayer>[]} */
  let players = [];
  /** The players' windows, seconds into each file. */
  /** @type {{original: {from: number, until: number}, decoded: {from: number, until: number}} | null} */
  let windows = null;
  /** Seconds into the original's timeline while a segment plays. */
  /** @type {number | null} */
  let playhead = null;
  /** @type {ReturnType<typeof createViewSwitch> | null} */
  let views = null;
  /** The strips' pictures for the clip and theme in hand. */
  /** @type {{key: string, images: HTMLCanvasElement[]} | null} */
  let pictures = null;

  const handle = setupCanvas(canvas, { onResize: () => draw2D() });
  const harm = setupCanvas(harmCanvas, { onResize: () => drawHarmonics() });

  const pressAll = () => {
    for (const el of clipEls) el.setAttribute("aria-pressed", pressed(el.dataset.clip === state.clip));
    for (const el of showEls) el.setAttribute("aria-pressed", pressed(el.dataset.show === state.show));
    for (const el of presetEls) el.setAttribute("aria-pressed", pressed(el.dataset.preset === state.preset));
  };

  /** Bumped on every load, so a slow clip the reader has left cannot land
   *  after the one chosen next; the cleanup bumps it too. */
  let loadSeq = 0;

  /** @returns {Promise<boolean>} true once the chosen clip is in state */
  async function load() {
    const clip = state.clip;
    const seq = ++loadSeq;
    /** @param {ListenData} data */
    const use = (data) => {
      const before = state.data ? state.frame : null;
      state.data = data;
      state.frame = Math.min(data.n - 1, before ?? (PICKS["loudest-pitched"](data) ?? 0));
      slider.max = String(data.n - 1);
      pictures = null;
      frame.dataset.state = "ready";
      return true;
    };
    const cached = cache.get(clip);
    if (cached) return use(cached);
    frame.dataset.state = "loading";
    try {
      const [spectra, frames] = await Promise.all([
        /** @type {Promise<SpectraFile>} */ (loadJSON(`assets/data/${clip}/spectra.json`)),
        /** @type {Promise<FramesFile>} */ (loadJSON(`assets/data/${clip}/frames.json`)),
      ]);
      const data = prepare(spectra, frames);
      cache.set(clip, data);
      if (seq !== loadSeq) return false;
      return use(data);
    } catch (error) {
      if (seq !== loadSeq) return false;
      frame.dataset.state = "error";
      frameEl.textContent = `could not load ${clip}`;
      return false;
    }
  }

  /** The 2D canvases, the readouts, and the 3D view (if up). */
  function render() {
    if (!state.data) return;
    const data = state.data;
    const i = Math.max(0, Math.min(data.n - 1, state.frame));
    state.frame = i;
    slider.value = String(i);
    slider.setAttribute("aria-valuetext", seconds(i));
    draw2D();
    drawHarmonics();

    const pitch = data.f0o[i] > 0 && data.f0d[i] > 0
      ? `pitched, ${Math.round(data.f0o[i])} Hz in and ${Math.round(data.f0d[i])} Hz out`
      : data.energetic[i] ? "no pitch tracked in the original" : "quiet (below -40 dBFS), not compared";
    frameEl.textContent = `${seconds(i)} into “${data.text}”: ${pitch}`;
    bandsEl.textContent = `decoded minus original, energetic frames: ${data.bands
      .map((b) => `${b.lo / 1000}–${b.hi / 1000} kHz ${signed(b.energy_db)} dB`).join(", ")}`;
    const [lo, hi] = data.profile.deeper_db;
    valleysEl.textContent = `decoded deeper by ${lo.toFixed(1)} to ${hi.toFixed(1)} dB at harmonics 1 to ${PROFILE_HARMONICS}, ` +
      `over ${data.profile.frames} pitched frames`;
    views?.update(state);
    describeSoon();
  }

  /** The strip pictures, one pixel per frame and bin, for the clip and theme. */
  function stripPictures() {
    const data = /** @type {ListenData} */ (state.data);
    const th = getTheme();
    const key = `${data.clip}|${th.scheme}|${state.show}`;
    if (pictures?.key === key) return pictures.images;
    pictures = { key, images: [0, 1, 2].map((b) => stripImage(data, b)) };
    return pictures.images;
  }

  function draw2D() {
    if (!state.data || canvas.hidden) return;
    const data = state.data;
    const th = getTheme();
    const g = handle.ctx;
    const W = handle.width;
    const H = handle.height;
    clearCanvas(g, handle);
    const rect = plotRect(W, H);
    const rows = strips(rect);
    const images = stripPictures();
    const names = ["original (into the ThumbDV)", "decoded minus original", "decoded (out of the ThumbDV)"];
    rows.forEach((s, b) => {
      if (b === 1 && state.show === "both") {
        g.save();
        g.strokeStyle = th.grid;
        g.setLineDash([4, 4]);
        g.strokeRect(s.x + 0.5, s.y + 0.5, s.width - 1, s.height - 1);
        g.restore();
        return;
      }
      g.imageSmoothingEnabled = true;
      g.drawImage(images[b], s.x, s.y, s.width, s.height);
      const plot = createPlot({ width: W, height: H }, {
        xDomain: [0, data.duration], yDomain: [0, 4000],
        padding: { top: s.y, bottom: H - s.y - s.height, left: s.x, right: W - s.x - s.width },
      });
      const yTicks = [0, 2000, 4000];
      drawAxes(g, plot, {
        xTicks: b === 2 ? timeTicks(data.duration, s.width) : [],
        yTicks,
        formatX: (v) => `${v} s`,
        formatY: (v) => (v ? `${v / 1000}k` : "0"),
        xLabel: b === 2 ? "time, s" : undefined,
      });
    });
    drawLabel(g, "Hz", 4, rect.y + 2, { align: "left", baseline: "top", size: 10, color: th.text3 });

    // This frame: one line through all three strips, in the highlight.
    const x = rect.x + ((state.frame + 0.5) * HOP_S / data.duration) * rect.width;
    g.save();
    g.strokeStyle = th.css("--ambe-highlight-chip");
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(x, rect.y);
    g.lineTo(x, rect.y + rect.height);
    g.stroke();
    g.strokeStyle = th.css("--ambe-highlight");
    g.lineWidth = 2.5;
    g.stroke();
    g.restore();
    if (playhead !== null) {
      const px = rect.x + (playhead / data.duration) * rect.width;
      g.save();
      g.strokeStyle = th.ink;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(px, rect.y);
      g.lineTo(px, rect.y + rect.height);
      g.stroke();
      g.restore();
    }
    // The strips' names last, over the line.
    rows.forEach((s, b) => {
      if (b === 1 && state.show === "both") {
        drawLabel(g, "difference hidden: press “With difference”", s.x + s.width / 2, s.y + s.height / 2, {
          align: "center", baseline: "middle", size: 11, color: th.text3, background: th.plotBg, padding: 3,
        });
        return;
      }
      drawLabel(g, names[b], s.x + 6, s.y + 4, {
        align: "left", baseline: "top", size: 11, color: th.text2, background: th.plotBg, padding: 3,
      });
    });
  }

  /**
   * Tick values that fit the width.
   * @param {number} duration
   * @param {number} width
   */
  function timeTicks(duration, width) {
    const step = width / duration > 120 ? 0.5 : 1;
    const out = [];
    for (let t = 0; t <= duration + 1e-9; t += step) out.push(Math.round(t * 10) / 10);
    return out;
  }

  function drawHarmonics() {
    if (!state.data) return;
    const { profile } = state.data;
    const th = getTheme();
    const g = harm.ctx;
    const W = harm.width;
    const H = harm.height;
    clearCanvas(g, harm);
    const plot = createPlot({ width: W, height: H }, {
      xDomain: [PROFILE_U[0], PROFILE_U[1]],
      yDomain: [-60, 0],
      padding: { top: 10, right: W < 560 ? 10 : 16, bottom: 34, left: W < 560 ? 40 : 54 },
    });
    const xTicks = Array.from({ length: PROFILE_HARMONICS }, (_, j) => j + 1);
    drawGrid(g, plot, { xTicks, yTicks: [-60, -40, -20, 0] });
    drawAxes(g, plot, {
      xTicks, yTicks: [-60, -40, -20, 0],
      formatX: (v) => `${v}`,
      xLabel: "frequency over the frame's own pitch, f / f0",
      yLabel: W < 560 ? undefined : "dB re peak",
    });
    g.save();
    plot.clip(g);
    const points = (/** @type {number[]} */ ys) => profile.u.map((x, k) => ({ x, y: ys[k] }));
    // The valleys' gap: where the decoded curve is under the original.
    g.beginPath();
    profile.u.forEach((x, k) => g.lineTo(plot.x(x), plot.y(profile.original[k])));
    for (let k = profile.u.length - 1; k >= 0; k -= 1) {
      g.lineTo(plot.x(profile.u[k]), plot.y(Math.min(profile.original[k], profile.decoded[k])));
    }
    g.closePath();
    g.globalAlpha = 0.45;
    g.fillStyle = th.css("--ambe-diverge-neg");
    g.fill();
    g.globalAlpha = 1;
    g.setLineDash([5, 4]);
    drawPolyline(g, points(profile.original), { plot, color: th.css("--ambe-plot-muted"), width: 1.75 });
    g.setLineDash([]);
    drawPolyline(g, points(profile.decoded), { plot, color: th.ink, width: 3 });
    g.restore();
    const [lo, hi] = profile.deeper_db;
    // On a phone the valleys readout says it; the label would not fit.
    if (W < 560) return;
    drawLabel(g, `${profile.frames} pitched frames; decoded valleys deeper by ${lo.toFixed(1)} to ${hi.toFixed(1)} dB`,
      plot.area.right - 4, plot.area.top + 2, {
        align: "right", baseline: "top", size: 11, color: th.text2, background: th.plotBg, padding: 3,
      });
  }

  /** The canvases' sentences, rebuilt 250 ms after the last change. */
  let describeTimer = 0;
  function describeSoon() {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      if (!state.data) return;
      const data = state.data;
      canvas.setAttribute("aria-label",
        `Three spectrograms of “${data.text}”, ${data.voice} voice, time across and 0 to 4 kilohertz up: ` +
        `the original on top, ${state.show === "both" ? "the difference hidden in the middle" : "decoded minus original in the middle"}, ` +
        `the decoded audio below. A line marks the frame at ${seconds(state.frame)}.` +
        (views && !views.available() ? ` ${NO_WEBGL_HINT}; the terrain is not shown in 3D here.` : ""));
      const [lo, hi] = data.profile.deeper_db;
      harmCanvas.setAttribute("aria-label",
        `Mean spectrum against harmonic number over ${data.profile.frames} pitched frames, original dashed and decoded thick, ` +
        "the gap where the decoded curve is lower shaded. " +
        `The decoded valleys between harmonics 1 and ${PROFILE_HARMONICS} are deeper by ${lo.toFixed(1)} to ${hi.toFixed(1)} dB.`);
    }, 250);
  }

  /** Point the two segment players at 0.6 s around the frame. */
  function attachPlayers() {
    for (const p of players) p.destroy();
    players = [];
    if (!state.data) return;
    const data = state.data;
    const centre = (state.frame + 0.5) * HOP_S;
    const from = Math.max(0, centre - SEGMENT_S / 2);
    /** @param {HTMLButtonElement} button @param {string} src @param {number} shift @param {string} name */
    const make = (button, src, shift, name) => {
      button.disabled = false;
      return createAudioPlayer({
        src, button, playLabel: name, stopLabel: "Stop",
        from: from + shift, until: from + shift + SEGMENT_S,
        onFrame: (time) => {
          playhead = time === null ? null : time - shift;
          draw2D();
        },
      });
    };
    players = [
      make(playOriginal, data.originalAudio, 0, "Original"),
      make(playDecoded, data.decodedAudio, data.delayS, "Decoded"),
    ];
    windows = {
      original: { from, until: from + SEGMENT_S },
      decoded: { from: from + data.delayS, until: from + data.delayS + SEGMENT_S },
    };
  }

  async function reload() {
    pressAll();
    if (!(await load())) return false;
    attachPlayers();
    render();
    return true;
  }

  /** Bumped by every step, so a step whose clip is still loading gives way. */
  let stepSeq = 0;
  /** @param {Record<string, string>} step */
  async function applyStep(step) {
    const seq = ++stepSeq;
    if (step.clip) state.clip = step.clip;
    if (step.show === "both" || step.show === "difference") state.show = step.show;
    if (step.preset) state.preset = step.preset;
    pressAll();
    if (state.clip !== state.data?.clip) {
      if (!(await reload())) return;
    } else if (frame.dataset.state === "loading") {
      // Back on the clip in hand: a load in flight for another step's clip
      // must not land after this one.
      loadSeq += 1;
      frame.dataset.state = "ready";
    }
    if (seq !== stepSeq || !state.data) return;
    const found = PICKS[step.pick]?.(state.data) ?? null;
    if (found !== null) {
      state.frame = found;
      state.pulses += 1;
      attachPlayers();
    }
    if (step.play === "valleys") state.replays += 1;
    // A step picks its view: 2D for a flat plot, 3D where depth is the
    // point. 3D opens only where the figure would open it by itself (not
    // under reduced motion or without WebGL); the step reads the same in 2D.
    if (step.view === "3d" && opensIn3D()) void views?.show3D();
    else if (step.view === "2d") views?.show2D();
    if (step.preset) views?.preset(step.preset);
    render();
  }

  for (const el of clipEls) {
    el.addEventListener("click", () => {
      state.clip = el.dataset.clip ?? state.clip;
      void reload();
    }, { signal });
  }
  for (const el of showEls) {
    el.addEventListener("click", () => {
      state.show = el.dataset.show === "both" ? "both" : "difference";
      pressAll();
      render();
    }, { signal });
  }
  for (const el of presetEls) {
    el.addEventListener("click", () => {
      state.preset = el.dataset.preset ?? state.preset;
      pressAll();
      views?.preset(state.preset);
    }, { signal });
  }
  slider.addEventListener("input", () => {
    state.frame = Number(slider.value);
    attachPlayers();
    render();
  }, { signal });

  const offTheme = onThemeChange(() => {
    pictures = null;
    render();
  });
  /** @type {unknown} */
  let hooked = null;
  const cleanup = () => {
    loadSeq += 1;
    stepSeq += 1;
    clearTimeout(describeTimer);
    for (const p of players) p.destroy();
    offTheme();
    handle.destroy();
    harm.destroy();
    if (TEST_HOOK && TEST_HOOK.figures[SLUG] === hooked) delete TEST_HOOK.figures[SLUG];
  };
  await reload();
  // Gone while the first clip loaded: start nothing that would outlive it.
  if (signal.aborted) return cleanup;

  /** @param {"2d" | "3d" | "parked"} view */
  const onView = (view) => {
    const three = view === "3d";
    root.dataset.view = three ? "3d" : "2d";
    camera.hidden = !three;
    if (!three) render();
  };
  views = createViewSwitch({
    frame, flat: canvas, toggle, hint, signal,
    state: () => state,
    load: () => import("./anim-listen-terrain-3d.js"),
    onView,
    id: SLUG,
  });
  if (steps.length) createStepper(root, steps, (step) => void applyStep(step), { signal });

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = hooked = {
      state: () => ({ clip: state.clip, frame: state.frame, show: state.show, preset: state.preset, view: views?.view() }),
      plotRect: () => plotRect(frame.clientWidth, frame.clientHeight),
      windows: () => windows,
      strips: () => strips(plotRect(frame.clientWidth, frame.clientHeight)),
      data: () => (state.data ? {
        n: state.data.n, bins: state.data.bins, nyquist: state.data.nyquist, duration: state.data.duration, delayS: state.data.delayS,
        profile: state.data.profile, bands: state.data.bands,
      } : null),
    };
  }

  return cleanup;
}
