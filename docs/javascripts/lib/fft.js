// @ts-check
/* ===========================================================================
 * lib/fft.js: a radix-2 FFT for display DSP on synthetic signals.
 * ---------------------------------------------------------------------------
 * Generic textbook arithmetic, nothing from any codec: an in-place
 * iterative Cooley-Tukey transform, the magnitude spectrum of a real block
 * zero-padded to a power of two, and the Hann window (sampled at the
 * centres of its samples) that the tradeoff figure (ch03) uses.
 * tests/figures/tradeoff-lib.spec.js checks it against numpy.fft.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/**
 * Twiddle tables by size, so a figure that runs hundreds of transforms of
 * one size computes its sines once.
 * @type {Map<number, {cos: Float64Array, sin: Float64Array, rev: Uint32Array}>}
 */
const tables = new Map();

/** @param {number} n a power of two */
function table(n) {
  let t = tables.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = -Math.sin((2 * Math.PI * k) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i += 1) {
    let r = 0;
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  tables.set(n, t);
  return t;
}

/**
 * True when n is a power of two of at least 2.
 * @param {number} n
 * @returns {boolean}
 */
export const isPowerOfTwo = (n) => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;

/**
 * The DFT X[k] = sum x[n] e^(-2 pi i k n / N), in place, for N a power of
 * two (numpy.fft.fft's sign and scale).
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @returns {void}
 */
export function fft(re, im) {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) throw new RangeError(`fft: size ${n} is not a power of two`);
  const { cos, sin, rev } = table(n);
  for (let i = 0; i < n; i += 1) {
    const j = rev[i];
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * |X[k]| for k = 0 to n / 2 of a real block, zero-padded (or cut) to n
 * samples (numpy.abs(numpy.fft.rfft(x, n))).
 * @param {ArrayLike<number>} x
 * @param {number} n a power of two
 * @returns {Float64Array} n / 2 + 1 magnitudes
 */
export function magnitudes(x, n) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < Math.min(n, x.length); i += 1) re[i] = x[i];
  fft(re, im);
  const out = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k += 1) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

/**
 * A Hann window of length L sampled at the centres of L equal parts,
 * 0.5 - 0.5 cos(2 pi (i + 0.5) / L): never exactly zero, symmetric, and
 * its main lobe is 4 / T wide (2 / T either side of the peak) for a block
 * of T seconds.
 * @param {number} length
 * @returns {Float64Array}
 */
export function hann(length) {
  const w = new Float64Array(length);
  for (let i = 0; i < length; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / length);
  return w;
}
