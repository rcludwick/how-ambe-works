// @ts-check
/* ===========================================================================
 * lib/leakage.js: one cosine in one 160-sample block, and its 81 bins
 * (three-everywhere design §5.2).
 * ---------------------------------------------------------------------------
 * The leakage figure's model. A cosine of `cycles` whole or partial cycles
 * per 160-sample block (6.00 to 7.00, so 300 to 350 Hz at 8 kHz), phase 0
 * unless a caller says otherwise, cut out with a rectangular or a periodic
 * Hann window and transformed by a direct DFT. Each spectrum is in dB
 * below its own peak, floored at -100 dB. An optional weak second tone at
 * 1500 Hz (bin 30), amplitude 0.003, stands for a quiet harmonic higher up.
 *
 * Generic DSP on synthetic data only: no audio is read or made, and nothing
 * here is specific to AMBE. The window shapes are the textbook ones
 * (Harris 1978, "On the use of windows for harmonic analysis with the
 * discrete Fourier transform", Proc. IEEE 66(1)).
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** Samples in the block: 20 ms at 8 kHz. */
export const N = 160;
export const SAMPLE_RATE = 8000;
/** Hz per bin. */
export const BIN_HZ = SAMPLE_RATE / N;
/** Bins 0 (DC) to 80 (4 kHz). */
export const BINS = N / 2 + 1;
/** Every level is at least this far below the peak. */
export const FLOOR_DB = -100;
/** The level the readouts and the chip count bins against. */
export const COUNT_DB = -40;
/** The field: cycles in the block, 6.00 to 7.00 in 0.05 steps. */
export const CYCLES_MIN = 6;
export const CYCLES_MAX = 7;
export const CYCLES_STEP = 0.05;
export const ROWS = Math.round((CYCLES_MAX - CYCLES_MIN) / CYCLES_STEP) + 1;
/** The weak second tone: 1500 Hz, bin 30, 0.003 of the main tone. */
export const WEAK_HZ = 1500;
export const WEAK_BIN = WEAK_HZ / BIN_HZ;
export const WEAK_AMPLITUDE = 0.003;

const TAU = 2 * Math.PI;

/** @typedef {"rect" | "hann"} WindowName */

/**
 * @typedef {Object} ToneOptions
 * @property {number} [phase=0]  the main tone's phase, radians
 * @property {boolean} [weak=false]  add the weak tone at 1500 Hz
 */

/** cos and sin of 2 pi m / N, so a DFT is table reads. */
const COS = new Float64Array(N);
const SIN = new Float64Array(N);
for (let m = 0; m < N; m += 1) {
  COS[m] = Math.cos((TAU * m) / N);
  SIN[m] = Math.sin((TAU * m) / N);
}

/**
 * The cycles of field row `row` (0 is 6.00), rounded to the step.
 * @param {number} row
 * @returns {number}
 */
export function rowCycles(row) {
  return Math.round((CYCLES_MIN + row * CYCLES_STEP) * 100) / 100;
}

/**
 * The field row nearest `cycles`.
 * @param {number} cycles
 * @returns {number}
 */
export function cyclesRow(cycles) {
  return Math.max(0, Math.min(ROWS - 1, Math.round((cycles - CYCLES_MIN) / CYCLES_STEP)));
}

/**
 * The window's value at sample n. Periodic Hann, w(n) = 0.5 - 0.5 cos(2 pi
 * n / N), is zero at n = 0 and again at n = N, where the next copy starts.
 * @param {WindowName} name
 * @param {number} n  0 to N (N is the next copy's first sample)
 * @returns {number}
 */
export function windowAt(name, n) {
  return name === "hann" ? 0.5 - 0.5 * Math.cos((TAU * n) / N) : 1;
}

/**
 * The tone (and the weak tone, if asked) at sample n, before the window.
 * Defined for any n, so a caller can draw the tone as it really continues.
 * @param {number} cycles
 * @param {number} n
 * @param {ToneOptions} [opts]
 * @returns {number}
 */
export function toneAt(cycles, n, opts = {}) {
  const main = Math.cos((TAU * cycles * n) / N + (opts.phase ?? 0));
  return opts.weak ? main + WEAK_AMPLITUDE * Math.cos((TAU * WEAK_HZ * n) / SAMPLE_RATE) : main;
}

/**
 * The block as the transform sees it: N samples, windowed.
 * @param {number} cycles
 * @param {WindowName} name
 * @param {ToneOptions} [opts]
 * @returns {Float64Array}
 */
export function block(cycles, name, opts = {}) {
  const x = new Float64Array(N);
  for (let n = 0; n < N; n += 1) x[n] = toneAt(cycles, n, opts) * windowAt(name, n);
  return x;
}

/**
 * Magnitudes of bins 0 to 80 of a block, by a direct DFT.
 * @param {ArrayLike<number>} x  N samples
 * @returns {Float64Array}
 */
export function magnitudes(x) {
  const out = new Float64Array(BINS);
  for (let k = 0; k < BINS; k += 1) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n += 1) {
      const m = (k * n) % N;
      re += x[n] * COS[m];
      im -= x[n] * SIN[m];
    }
    out[k] = Math.hypot(re, im);
  }
  return out;
}

/**
 * Levels of bins 0 to 80 in dB below the spectrum's own peak, at least
 * FLOOR_DB.
 * @param {number} cycles
 * @param {WindowName} name
 * @param {ToneOptions} [opts]
 * @returns {Float64Array}
 */
export function spectrumDb(cycles, name, opts = {}) {
  const mag = magnitudes(block(cycles, name, opts));
  let peak = 0;
  for (const v of mag) peak = Math.max(peak, v);
  return mag.map((v) => (v > 0 && peak > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(v / peak)) : FLOOR_DB));
}

/**
 * How many bins sit above `threshold` dB.
 * @param {ArrayLike<number>} db
 * @param {number} [threshold=COUNT_DB]
 * @returns {number}
 */
export function binsAbove(db, threshold = COUNT_DB) {
  let count = 0;
  for (let k = 0; k < db.length; k += 1) if (db[k] > threshold) count += 1;
  return count;
}

/**
 * The step at each joint of the repeated block: what the windowed tone
 * would be one sample past the end, against what the next copy starts
 * with. 0 on a whole number of cycles; with phase 0 and no window it is
 * |cos(2 pi c) - 1|, at most 2 at half a cycle off. A periodic Hann window
 * is 0 at both, so its step is 0 whatever the tone does.
 * @param {number} cycles
 * @param {WindowName} name
 * @param {ToneOptions} [opts]
 * @returns {number}
 */
export function jointStep(cycles, name, opts = {}) {
  const past = toneAt(cycles, N, opts) * windowAt(name, N);
  const start = toneAt(cycles, 0, opts) * windowAt(name, 0);
  return Math.abs(past - start);
}

/** @type {Map<string, Float64Array[]>} */
const fields = new Map();

/**
 * Every row of the field, 6.00 to 7.00 cycles, phase 0. Cached: a figure
 * asks for the same four fields (two windows, weak tone on or off) again
 * and again.
 * @param {WindowName} name
 * @param {boolean} weak
 * @returns {Float64Array[]}
 */
export function field(name, weak) {
  const key = `${name}:${weak}`;
  let rows = fields.get(key);
  if (!rows) {
    rows = Array.from({ length: ROWS }, (_, r) => spectrumDb(rowCycles(r), name, { weak }));
    fields.set(key, rows);
  }
  return rows;
}
