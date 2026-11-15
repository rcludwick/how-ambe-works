// @ts-check
/* ===========================================================================
 * lib/harmonics.js: one frame's harmonics, for the harmonic-sum figure, and
 * the envelope figure's amplitude picker.
 * ---------------------------------------------------------------------------
 * Generic display DSP on one frame's precomputed values (design §3.13): a
 * sum of cosines for a picture, and a DFT of that picture to show what the
 * picture contains. Nothing here reads hex, makes sound, or walks frames.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { mulberry32 } from "./prng.js";

export const BIN_HZ = 31.25;
export const PERIOD_SAMPLES = 512;
export const PHASE_SEED = 0x20260810;

/**
 * Harmonics k·f0 below the cutoff.
 * @param {number} f0 Hz; 0 means no pitch
 * @param {number} cutoffHz
 * @returns {number}
 */
export function harmonicCount(f0, cutoffHz) {
  return f0 > 0 ? Math.floor(cutoffHz / f0) : 0;
}

/**
 * A_k for k = 1..L. Each spectrum bin goes to its nearest harmonic,
 * round(bin·31.25 / f0); A_k is the largest bin given to k, from dB to
 * linear, and 0 if no bin was given to k. Unlike fixed ±2-bin windows, no
 * bin can count for two harmonics.
 * @param {number[]} row dBFS, one spectra.json row
 * @param {number} f0
 * @param {number} L
 * @returns {Float64Array} length L + 1; index 0 unused
 */
export function harmonicAmplitudes(row, f0, L) {
  const A = new Float64Array(L + 1);
  for (let b = 1; b < row.length; b += 1) {
    const k = Math.round((b * BIN_HZ) / f0);
    if (k < 1 || k > L) continue;
    A[k] = Math.max(A[k], 10 ** (row[b] / 20));
  }
  return A;
}

/**
 * The envelope figure's harmonic amplitudes (ch09): for each harmonic m with
 * m·f0 at or below topHz, the largest of the three bins nearest m·f0, in
 * dBFS. A harmonic rarely lands on a bin centre, and the analysis window's
 * main lobe is a few bins wide. This is not harmonicAmplitudes(): there a
 * bin counts for one harmonic only, and on lr-b frames 95 to 124 the two
 * disagree on 100 of 916 harmonics, by up to 16 dB (plan decision 14), so
 * envelope and envelope-blocks share this one.
 * @param {number[]} row dBFS, one spectra.json row
 * @param {number} f0 Hz; 0 means no pitch, and gives no harmonics
 * @param {number} binHz the row's bin spacing
 * @param {number} [topHz=3900]
 * @returns {{m: number, hz: number, db: number}[]}
 */
export function envelopeAmplitudes(row, f0, binHz, topHz = 3900) {
  /** @type {{m: number, hz: number, db: number}[]} */
  const out = [];
  if (!(f0 > 0)) return out;
  for (let m = 1; m * f0 <= topHz; m += 1) {
    const hz = m * f0;
    const centre = Math.round(hz / binHz);
    let db = -Infinity;
    for (let d = -1; d <= 1; d += 1) {
      const k = centre + d;
      if (k >= 0 && k < row.length) db = Math.max(db, row[k]);
    }
    if (Number.isFinite(db)) out.push({ m, hz, db });
  }
  return out;
}

/**
 * Starting phases φ_k, k = 1..L. "random" draws all L in order, so changing
 * N never changes a phase; reroll picks another seeded set.
 * @param {number} L
 * @param {"zero" | "random"} mode
 * @param {number} reroll 0, 1, 2, ...
 * @returns {Float64Array} length L + 1
 */
export function phases(L, mode, reroll) {
  const out = new Float64Array(L + 1);
  if (mode === "zero") return out;
  const random = mulberry32(PHASE_SEED + reroll);
  for (let k = 1; k <= L; k += 1) out[k] = 2 * Math.PI * random();
  return out;
}

/**
 * Exactly one period of sum_{k<=N} A_k cos(2πkm/M + φ_k), m = 0..M-1.
 * @param {Float64Array} A
 * @param {Float64Array} phi
 * @param {number} N
 * @returns {Float64Array} PERIOD_SAMPLES values
 */
export function samplePeriod(A, phi, N) {
  const M = PERIOD_SAMPLES;
  const s = new Float64Array(M);
  for (let k = 1; k <= N; k += 1) {
    if (!A[k]) continue;
    for (let m = 0; m < M; m += 1) s[m] += A[k] * Math.cos((2 * Math.PI * k * m) / M + phi[k]);
  }
  return s;
}

/**
 * The harmonic magnitudes of a drawn period, by a direct DFT. One period
 * puts bin k exactly on harmonic k, so this returns A_k when the drawing
 * is right.
 * @param {Float64Array} period
 * @param {number} N
 * @returns {Float64Array} length N + 1
 */
export function harmonicMagnitudes(period, N) {
  const M = period.length;
  const out = new Float64Array(N + 1);
  for (let k = 1; k <= N; k += 1) {
    let re = 0;
    let im = 0;
    for (let m = 0; m < M; m += 1) {
      const a = (2 * Math.PI * k * m) / M;
      re += period[m] * Math.cos(a);
      im -= period[m] * Math.sin(a);
    }
    out[k] = (2 / M) * Math.hypot(re, im);
  }
  return out;
}

/**
 * Largest |20·log10(b_k / a_k)| over k <= N where both are above zero.
 * @param {Float64Array} a
 * @param {Float64Array} b
 * @param {number} N
 * @returns {number} dB
 */
export function largestChangeDb(a, b, N) {
  let worst = 0;
  for (let k = 1; k <= N; k += 1) {
    if (!(a[k] > 0) || !(b[k] > 0)) continue;
    worst = Math.max(worst, Math.abs(20 * Math.log10(b[k] / a[k])));
  }
  return worst;
}

/**
 * @param {Float64Array} period
 * @returns {number} peak / RMS; 0 for silence
 */
export function peakToRms(period) {
  let peak = 0;
  let sq = 0;
  for (const v of period) {
    peak = Math.max(peak, Math.abs(v));
    sq += v * v;
  }
  return sq ? peak / Math.sqrt(sq / period.length) : 0;
}

/**
 * Where harmonic k's crest nearest t = 0 sits, as a fraction of its own
 * period, in [-0.5, 0.5]. Zero for every k under zero phase.
 * @param {number} phi
 * @returns {number}
 */
export function crestOffset(phi) {
  const x = -phi / (2 * Math.PI);
  return x - Math.round(x);
}

/* slot: harmonic-sum */

/**
 * A phase in (-π, π], the same angle as `v`.
 * @param {number} v
 * @returns {number}
 */
export function wrapPhase(v) {
  const w = v - 2 * Math.PI * Math.round(v / (2 * Math.PI));
  return w <= -Math.PI ? w + 2 * Math.PI : w;
}

/**
 * The figure's "Scaled" phases: alpha times each random phase, wrapped to
 * (-π, π], so 0 is every phase zero and 1 is phases(L, "random", reroll),
 * returned unchanged. It follows the form of US 5,081,681's disorder term,
 * r_k = alpha·u_k with u_k uniform on [-π, π]; the alpha here is the
 * reader's choice (illustrative), not one derived from voicing.
 * @param {number} L
 * @param {number} alpha 0 to 1, clamped
 * @param {number} reroll 0, 1, 2, ...
 * @returns {Float64Array} length L + 1
 */
export function scaledPhases(L, alpha, reroll) {
  const a = Math.min(1, Math.max(0, alpha));
  if (a === 0) return phases(L, "zero", reroll);
  const random = phases(L, "random", reroll);
  if (a === 1) return random;
  return random.map((v, k) => (k ? a * wrapPhase(v) : 0));
}
/* end slot: harmonic-sum */
