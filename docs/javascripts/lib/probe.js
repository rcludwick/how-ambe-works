// @ts-check
/* ===========================================================================
 * lib/probe.js: the one-frequency test of chapter 2, as numbers.
 * ---------------------------------------------------------------------------
 * A recording of 160 samples at 8000 samples a second (20 ms) holds one
 * sine at 200 Hz with phase phi: s[n] = sin(2 pi 200 n / 8000 + phi). A test
 * wave at frequency f is multiplied against it sample by sample and the
 * products are added up. The sine test gives 80 cos(phi) at 200 Hz, the
 * cosine test 80 sin(phi), so the pair has length 80 at every phase. At
 * every other multiple of 50 Hz (1/T for a 20 ms block) both sums are 0;
 * between the multiples they are not.
 *
 * Pure arithmetic on a synthetic signal: no DOM, no codec, nothing read.
 * anim-probe.js draws it in 2D and hands the same arrays to its 3D part.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** Samples in the block. */
export const N = 160;
/** Samples a second. */
export const RATE = 8000;
/** The recording's one frequency, Hz. */
export const SIGNAL_HZ = 200;
/** 1/T for the block: the spacing of the DFT's bins, Hz. */
export const BIN_HZ = RATE / N;

const TAU = 2 * Math.PI;

/**
 * @typedef {Object} Probe
 * @property {number} f  the test frequency, Hz
 * @property {number} phi  the recording's phase, radians
 * @property {Float64Array} signal  the recording
 * @property {Float64Array} sineTest
 * @property {Float64Array} cosineTest
 * @property {Float64Array} sineProducts  signal x sine test, per sample
 * @property {Float64Array} cosineProducts  signal x cosine test, per sample
 * @property {Float64Array} sineRun  the sine products added up to sample n
 * @property {Float64Array} cosineRun  the cosine products added up to sample n
 * @property {number} sine  the sine test's sum
 * @property {number} cosine  the cosine test's sum
 * @property {number} length  the pair's length, hypot(sine, cosine)
 * @property {number} angle  the pair's angle, radians, atan2(cosine, sine)
 */

/**
 * Run both tests at `f` against the recording with phase `phi`.
 * @param {number} f Hz
 * @param {number} phi radians
 * @returns {Probe}
 */
export function probe(f, phi) {
  const signal = new Float64Array(N);
  const sineTest = new Float64Array(N);
  const cosineTest = new Float64Array(N);
  const sineProducts = new Float64Array(N);
  const cosineProducts = new Float64Array(N);
  const sineRun = new Float64Array(N);
  const cosineRun = new Float64Array(N);
  let sine = 0;
  let cosine = 0;
  for (let n = 0; n < N; n += 1) {
    signal[n] = Math.sin((TAU * SIGNAL_HZ * n) / RATE + phi);
    sineTest[n] = Math.sin((TAU * f * n) / RATE);
    cosineTest[n] = Math.cos((TAU * f * n) / RATE);
    sineProducts[n] = signal[n] * sineTest[n];
    cosineProducts[n] = signal[n] * cosineTest[n];
    sine += sineProducts[n];
    cosine += cosineProducts[n];
    sineRun[n] = sine;
    cosineRun[n] = cosine;
  }
  return {
    f, phi, signal, sineTest, cosineTest, sineProducts, cosineProducts, sineRun, cosineRun,
    sine, cosine, length: Math.hypot(sine, cosine), angle: Math.atan2(cosine, sine),
  };
}

/**
 * The pair's length at each test frequency, for the sweep strip.
 * @param {ArrayLike<number>} freqs Hz
 * @param {number} phi radians
 * @returns {Float64Array}
 */
export function sweep(freqs, phi) {
  const out = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i += 1) out[i] = probe(freqs[i], phi).length;
  return out;
}

/**
 * Degrees to radians.
 * @param {number} degrees
 */
export const radians = (degrees) => (degrees * Math.PI) / 180;
