// @ts-check
/* ===========================================================================
 * lib/filter.js: the filter figure's signals and its one filter, pure.
 * ---------------------------------------------------------------------------
 * A 150 Hz tone in one of four shapes, built from its Fourier series below
 * the Nyquist rate (160 harmonics at 48 kHz), goes through a two-pole
 * resonant low-pass (the RBJ biquad, Q 4). run() filters the samples as a
 * difference equation; laneResponse() gives the same filter's gain and
 * phase at one harmonic in closed form, which is what the 3D view's lanes
 * draw. Nothing here is particular to speech or to AMBE: it is the
 * textbook filter every audio tool ships, on synthetic tones.
 *
 * No DOM. The figure (anim-filter.js) and its tests import it.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** Internal sample rate. High enough that a square edge draws as an edge. */
export const SR = 48000;

/** The input's fundamental. Fixed: the cutoff moves the filter, not the tone. */
export const F0 = 150;

/** How many cycles are drawn. */
export const CYCLES = 3;

/** Cycles run before capture, so what is drawn is the settled response. */
export const SETTLE_CYCLES = 120;

/**
 * Filter sharpness. High enough that the resonance visibly rings a square
 * wave; its peak gain is ×4.03 wherever the cutoff sits.
 */
export const Q = 4;

/** Harmonics below the Nyquist rate: 160 at 150 Hz and 48 kHz. */
export const MAX_HARMONIC = Math.floor(SR / 2 / F0);

/** Samples in one cycle of the input. */
export const PER_CYCLE = Math.round(SR / F0);

/** @typedef {"sine" | "square" | "triangle" | "sawtooth"} Shape */

/** @type {readonly Shape[]} */
export const SHAPES = Object.freeze(["sine", "square", "triangle", "sawtooth"]);

const TAU = Math.PI * 2;

/**
 * The amplitude of harmonic k in a shape, as the coefficient of
 * sin(2 pi k p): 0 for the harmonics a shape does not have (every one but
 * the first in a sine, the even ones in a square and a triangle). The
 * triangle's sign alternates, so its coefficient can be negative.
 * @param {Shape} shape
 * @param {number} k 1 to MAX_HARMONIC
 * @returns {number}
 */
export function harmonic(shape, k) {
  if (shape === "sine") return k === 1 ? 1 : 0;
  if (shape === "sawtooth") return 2 / (Math.PI * k);
  if (k % 2 === 0) return 0;
  if (shape === "square") return 4 / (Math.PI * k);
  const sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1;
  return (sign * 8) / (Math.PI * Math.PI * k * k);
}

/**
 * One cycle of a shape at phase p in [0, 1), summed from its harmonics. A
 * literal square wave sampled at 48 kHz aliases, and the aliases would
 * show in the output as artefacts of the sampling rather than of the
 * filter, which is the confusion this figure exists to avoid.
 * @param {Shape} shape
 * @param {number} p
 * @returns {number}
 */
export function shapeValue(shape, p) {
  let sum = 0;
  for (let k = 1; k <= MAX_HARMONIC; k += 1) {
    const b = harmonic(shape, k);
    if (b) sum += b * Math.sin(TAU * k * p);
  }
  return sum;
}

/**
 * RBJ biquad low-pass coefficients, normalised so a0 = 1.
 * @param {number} cutoffHz
 * @returns {{b0: number, b1: number, b2: number, a1: number, a2: number}}
 */
export function lowpass(cutoffHz) {
  const w0 = (TAU * cutoffHz) / SR;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * The filter's response at a frequency, in closed form: |H| and arg H,
 * with the phase continuous from 0 at 0 Hz (it falls toward -2 pi near
 * the Nyquist rate: -pi from the two poles, -w from the double zero).
 * @param {number} hz
 * @param {number} cutoffHz
 * @returns {{gain: number, phase: number}}
 */
export function response(hz, cutoffHz) {
  const c = lowpass(cutoffHz);
  const w = (TAU * hz) / SR;
  // H = b0 (1 + e^-jw)^2 / (1 + a1 e^-jw + a2 e^-2jw). The numerator's
  // phase is exactly -w; its size is 4 b0 cos^2(w / 2).
  const num = 4 * c.b0 * Math.cos(w / 2) ** 2;
  const re = 1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w);
  const im = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w));
  // The denominator's phase runs from 0 up to pi without leaving [0, pi]
  // below the Nyquist rate (its poles are inside the unit circle).
  let den = Math.atan2(im, re);
  if (den < 0) den += TAU;
  return { gain: num / Math.hypot(re, im), phase: -w - den };
}

/**
 * What the filter does to harmonic k of the 150 Hz tone: its gain, its
 * phase, and the phase delay -arg H / (2 pi k F0) in milliseconds. The 3D
 * view moves each lane's zero crossing by that delay.
 * @param {number} k
 * @param {number} cutoffHz
 * @returns {{gain: number, phase: number, delayMs: number}}
 */
export function laneResponse(k, cutoffHz) {
  const { gain, phase } = response(k * F0, cutoffHz);
  return { gain, phase, delayMs: (-phase / (TAU * k * F0)) * 1000 };
}

/**
 * The filter's largest gain, read off a fine grid from 20 Hz to 2 kHz past
 * the cutoff (the RBJ peak at Q 4 is ×4.03 at every cutoff).
 * @param {number} cutoffHz
 * @returns {{gain: number, hz: number}}
 */
export function peakGain(cutoffHz) {
  let best = { gain: 0, hz: 0 };
  for (let hz = 20; hz <= cutoffHz + 2000; hz += 0.5) {
    const { gain } = response(hz, cutoffHz);
    if (gain > best.gain) best = { gain, hz };
  }
  return best;
}

/**
 * @typedef {Object} Run
 * @property {Float64Array} input  CYCLES + 1 settled cycles going in
 * @property {Float64Array} output  the same samples coming out
 * @property {number} perCycle  samples per cycle
 */

/**
 * Generate the input, run the filter as a difference equation, and keep
 * one settled window of each. The filter runs for SETTLE_CYCLES first, so
 * the window is the steady-state response and not the switch-on transient
 * (which decays with a time constant of 2 Q / w0, 10.6 ms at the lowest
 * cutoff, against 800 ms of settling). One cycle more than is drawn is
 * kept: align() may shift the output by up to a whole cycle, and that
 * shift comes out of spare samples rather than out of the visible window.
 * @param {Shape} shape
 * @param {number} cutoffHz
 * @returns {Run}
 */
export function run(shape, cutoffHz) {
  const perCycle = PER_CYCLE;
  const keep = perCycle * (CYCLES + 1);
  const total = perCycle * SETTLE_CYCLES + keep;
  const c = lowpass(cutoffHz);
  // One cycle of the input, reused: the tone is exactly periodic.
  const cycle = new Float64Array(perCycle);
  for (let n = 0; n < perCycle; n += 1) cycle[n] = shapeValue(shape, n / perCycle);

  const input = new Float64Array(keep);
  const output = new Float64Array(keep);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let n = 0; n < total; n += 1) {
    const x = cycle[n % perCycle];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    const k = n - (total - keep);
    if (k >= 0) {
      input[k] = x;
      output[k] = y;
    }
  }
  return { input, output, perCycle };
}

/**
 * @typedef {Object} Fit
 * @property {number} shift  whole samples the output is moved back by
 * @property {number} gain  maps the output onto the input (the filter's own
 *           gain is its reciprocal)
 * @property {number} residual  squared error left after gain and shift
 * @property {number} pct  that error as a percentage of the input, RMS
 */

/**
 * The two liberties a filter is allowed: a gain and a delay. Searches
 * whole-sample shifts for the one that best matches the output to the
 * input, then takes the least-squares gain at that shift. A measurement of
 * the output, not an assumption about it: if the filter has reshaped the
 * signal, the best gain and shift are still found and the residual stays
 * large. For a sine the residual is not zero: the true delay falls between
 * two samples, and realigning by whole samples leaves a fraction of a
 * percent.
 * @param {Float64Array} input
 * @param {Float64Array} output
 * @param {number} perCycle
 * @returns {Fit}
 */
export function align(input, output, perCycle) {
  let best = { shift: 0, gain: 1, residual: Infinity };
  const n = input.length - perCycle;
  for (let s = 0; s < perCycle; s += 1) {
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < n; i += 1) {
      const o = output[i + s];
      dot += o * input[i];
      energy += o * o;
    }
    if (energy <= 0) continue;
    const gain = dot / energy;
    let err = 0;
    for (let i = 0; i < n; i += 1) {
      const d = input[i] - gain * output[i + s];
      err += d * d;
    }
    // A shape with odd harmonics only (square, triangle) fits as well
    // inverted half a cycle later; the upright fit is kept on a tie.
    const tie = Number.isFinite(best.residual) && Math.abs(err - best.residual) <= 1e-9 * best.residual;
    if (tie ? gain > 0 && best.gain < 0 : err < best.residual) best = { shift: s, gain, residual: err };
  }
  let inputEnergy = 0;
  for (let i = 0; i < n; i += 1) inputEnergy += input[i] * input[i];
  const pct = inputEnergy > 0 ? Math.sqrt(best.residual / inputEnergy) * 100 : 0;
  return { ...best, pct };
}

/**
 * The settled output at time t (cycles), summed in closed form over every
 * harmonic: sum of b_k |H_k| sin(2 pi k t + arg H_k). Equal to run()'s
 * samples (tests pin it to 1e-9), so the 3D view's lanes, which are its
 * terms, add up to the line the 2D view draws.
 * @param {Shape} shape
 * @param {number} cutoffHz
 * @param {number} t cycles
 * @returns {number}
 */
export function settledOutput(shape, cutoffHz, t) {
  let sum = 0;
  for (let k = 1; k <= MAX_HARMONIC; k += 1) {
    const b = harmonic(shape, k);
    if (!b) continue;
    const { gain, phase } = response(k * F0, cutoffHz);
    sum += b * gain * Math.sin(TAU * k * t + phase);
  }
  return sum;
}
