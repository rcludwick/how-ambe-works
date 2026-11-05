// @ts-check
/* ===========================================================================
 * lib/dct.js: blocks and a DCT per block, for the envelope-blocks figure
 * (ch09, "Split the residual into blocks and transform each one").
 * ---------------------------------------------------------------------------
 * Generic display DSP on one frame's values: an orthonormal DCT-II of each
 * block, kept to its first k coefficients and turned back into a line to
 * draw. Nothing is rounded to a grid or matched against a codebook, no
 * block lengths or bit allocations from any codec are used (the even split
 * is the figure's illustrative choice), nothing reads hex, and nothing
 * makes sound. US 5,630,011 describes the blocks and the DCT; the D-STAR
 * block count and lengths are not public.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/**
 * Split `length` values into `count` contiguous blocks as evenly as
 * possible, the longer blocks first: 28 into 6 is 5, 5, 5, 5, 4, 4.
 * @param {number} length
 * @param {number} [count=6]
 * @returns {number[]} block lengths, summing to `length`
 */
export function blockSizes(length, count = 6) {
  const n = Math.max(1, Math.min(count, length));
  const base = Math.floor(length / n);
  const extra = length % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Orthonormal DCT-II: c[j] = s(j) sum_n x[n] cos(pi (2n + 1) j / 2N), with
 * s(0) = sqrt(1/N) and s(j) = sqrt(2/N), so the energy of c equals the
 * energy of x, and c[0] / sqrt(N) is the block's mean.
 * @param {ArrayLike<number>} x
 * @returns {number[]}
 */
export function dct(x) {
  const N = x.length;
  return Array.from({ length: N }, (_, j) => {
    let sum = 0;
    for (let n = 0; n < N; n += 1) sum += x[n] * Math.cos((Math.PI * (2 * n + 1) * j) / (2 * N));
    return sum * Math.sqrt((j === 0 ? 1 : 2) / N);
  });
}

/**
 * The inverse of dct().
 * @param {ArrayLike<number>} c
 * @returns {number[]}
 */
export function idct(c) {
  const N = c.length;
  return Array.from({ length: N }, (_, n) => {
    let sum = 0;
    for (let j = 0; j < N; j += 1) {
      sum += Math.sqrt((j === 0 ? 1 : 2) / N) * c[j] * Math.cos((Math.PI * (2 * n + 1) * j) / (2 * N));
    }
    return sum;
  });
}

/**
 * Each block's DCT coefficients.
 * @param {ArrayLike<number>} values
 * @param {number[]} sizes from blockSizes()
 * @returns {number[][]}
 */
export function blockCoefficients(values, sizes) {
  /** @type {number[][]} */
  const out = [];
  let at = 0;
  for (const size of sizes) {
    out.push(dct(Array.from({ length: size }, (_, i) => values[at + i])));
    at += size;
  }
  return out;
}

/**
 * The values redrawn from the first `k` coefficients of each block (all of
 * them for a block of `k` or fewer). k = 1 gives each block's mean; k at
 * the longest block's length gives the values back.
 * @param {number[][]} coefficients from blockCoefficients()
 * @param {number} k
 * @returns {number[]}
 */
export function keepCoefficients(coefficients, k) {
  return coefficients.flatMap((c) => idct(c.map((v, j) => (j < k ? v : 0))));
}

/**
 * Energy by coefficient order: entry j is the sum over blocks of c[j]²
 * (frame 112 of lr-b: 6266, 1301, 204, 77, 13).
 * @param {number[][]} coefficients
 * @returns {number[]} one entry per order, up to the longest block
 */
export function energyByOrder(coefficients) {
  const orders = Math.max(...coefficients.map((c) => c.length));
  const out = new Array(orders).fill(0);
  for (const c of coefficients) c.forEach((v, j) => (out[j] += v * v));
  return out;
}

/**
 * The share of the energy in the first `k` orders, 0 to 1.
 * @param {number[]} energies from energyByOrder()
 * @param {number} k
 * @returns {number}
 */
export function energyKept(energies, k) {
  const total = energies.reduce((s, e) => s + e, 0);
  if (!(total > 0)) return 1;
  return energies.slice(0, k).reduce((s, e) => s + e, 0) / total;
}

/**
 * Root-mean-square difference of two equal-length arrays.
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number}
 */
export function rmsDifference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return a.length ? Math.sqrt(sum / a.length) : 0;
}
