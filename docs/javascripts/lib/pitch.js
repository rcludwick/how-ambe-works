// @ts-check
/* ===========================================================================
 * lib/pitch.js: the pitch-search figure's arithmetic (ch08).
 * ---------------------------------------------------------------------------
 * Generic DSP on one window of 255 samples: a Hamming taper, the
 * autocorrelation phi of w^2(n) s(n) (Griffin and Lim 1988, eq. 13), and
 * the score Psi(P) at a candidate period P. Two synthetic windows, made
 * here from a formula, show the traps the real frame does not.
 *
 * The score, and its k = 0 term. Eq. 12 of the paper is
 *   Psi(P) = P x sum of phi(kP) over every integer k, minus to plus infinity.
 * phi is even, so that is P phi(0), a straight line in P whatever the
 * sound, plus twice the sum over k = 1, 2, 3, .... The figure draws
 * psi() below: P x the sum over k >= 1, with phi divided by phi(0). It
 * leaves out the k = 0 line (eq. 11's denominator, 1 - P sum w^4, is what
 * balances it there) and the factor 2, so the peaks at multiples show and
 * the numbers stay small. Lags past the window (254) contribute nothing.
 *
 * It never picks a pitch: there is no argmax here, no error criterion and
 * no tracker. The figure shows the score at every candidate and lets the
 * reader look.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** Window length, samples. */
export const N = 255;
/** The candidate periods US 5,216,747 searches, 22 <= P < 115. */
export const P_MIN = 22;
export const P_MAX = 114;
/** The look-back corridor of US 5,216,747: (1 - a) P-1 <= P <= (1 + a) P-1. */
export const ALPHA = 0.2;

/**
 * The 255-point Hamming taper, a display choice.
 * @param {number} [n=N]
 * @returns {Float64Array}
 */
export function hamming(n = N) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i += 1) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/**
 * phi(m) for m = 0 to n - 1: the autocorrelation of w^2(n) s(n), over
 * phi(0), so phi[0] is 1 (all zero for a silent window).
 * @param {ArrayLike<number>} samples n samples, untapered
 * @returns {Float64Array}
 */
export function autocorrelation(samples) {
  const n = samples.length;
  const w = hamming(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i += 1) v[i] = w[i] * w[i] * samples[i];
  const phi = new Float64Array(n);
  for (let m = 0; m < n; m += 1) {
    let s = 0;
    for (let i = 0; i + m < n; i += 1) s += v[i] * v[i + m];
    phi[m] = s;
  }
  const zero = phi[0];
  if (zero > 0) for (let m = 0; m < n; m += 1) phi[m] /= zero;
  return phi;
}

/**
 * phi at a lag that need not be whole, by r(n + d) = (1 - d) r(n) + d r(n + 1)
 * (US 5,216,747); 0 past the last lag.
 * @param {ArrayLike<number>} phi
 * @param {number} lag
 * @returns {number}
 */
export function phiAt(phi, lag) {
  const i = Math.floor(lag);
  const d = lag - i;
  if (i < 0 || i >= phi.length) return 0;
  if (d < 1e-9 || i + 1 >= phi.length) return d < 1e-9 ? phi[i] : 0;
  return (1 - d) * phi[i] + d * phi[i + 1];
}

/**
 * The lags a candidate's comb samples: P, 2P, 3P, ... up to the last lag.
 * @param {number} period
 * @param {number} [last=N - 1]
 * @returns {number[]}
 */
export function comb(period, last = N - 1) {
  const out = [];
  for (let k = 1; k * period <= last + 1e-9; k += 1) out.push(k * period);
  return out;
}

/**
 * The figure's score: P x the sum of phi(kP) over k = 1, 2, 3, ...
 * (see the header for eq. 12's k = 0 term).
 * @param {ArrayLike<number>} phi from autocorrelation()
 * @param {number} period
 * @returns {number}
 */
export function psi(phi, period) {
  let s = 0;
  for (const lag of comb(period, phi.length - 1)) s += phiAt(phi, lag);
  return period * s;
}

/**
 * psi() at every whole candidate from P_MIN to P_MAX.
 * @param {ArrayLike<number>} phi
 * @returns {Float64Array} index 0 is P_MIN
 */
export function psiCurve(phi) {
  const out = new Float64Array(P_MAX - P_MIN + 1);
  for (let p = P_MIN; p <= P_MAX; p += 1) out[p - P_MIN] = psi(phi, p);
  return out;
}

/**
 * The look-back corridor around the frame before.
 * @param {number} previous period, samples
 * @returns {[number, number]}
 */
export const corridor = (previous) => [(1 - ALPHA) * previous, (1 + ALPHA) * previous];

/* ---------------------------------------------------------------------------
 * Synthetic windows (illustrative): a train of decaying two-resonance
 * pulses, one every `period` samples, from sample 10.3 on. Nothing here is
 * speech or a codec: a formula, sampled.
 * ------------------------------------------------------------------------ */

/**
 * One pulse t samples after it starts.
 * @param {number} t
 * @param {number} f1 Hz
 * @param {number} f2 Hz
 */
const pulse = (t, f1, f2) =>
  Math.exp(-t / 9) * (Math.sin((2 * Math.PI * t * f1) / 8000) + 0.6 * Math.sin((2 * Math.PI * t * f2) / 8000));

/**
 * @param {number} period samples, need not be whole
 * @param {number} odd how far every second pulse turns into another shape
 *        (0: all alike; 0.7: mostly the other shape, as a creaky voice's
 *        alternate cycles differ)
 * @returns {Float64Array} N samples
 */
export function pulseTrain(period, odd = 0) {
  const out = new Float64Array(N);
  for (let j = -3; j * period < N; j += 1) {
    const start = 10.3 + j * period;
    for (let i = Math.max(0, Math.ceil(start)); i < N; i += 1) {
      const t = i - start;
      let a = pulse(t, 700, 1200);
      if (j % 2 !== 0 && odd) a = (1 - odd) * a - odd * pulse(t, 1900, 2600);
      out[i] += a;
    }
  }
  return out;
}

/**
 * The windows the figure can show.
 * @typedef {"frame" | "alternate" | "fraction"} Source
 */

/** Pulses every 46 samples, every second one mostly another shape. */
export const ALTERNATE = { period: 46, odd: 0.7 };
/** Pulses every 45.6 samples, between two whole candidates. */
export const FRACTION = { period: 45.6, odd: 0 };

/**
 * The samples of a synthetic source.
 * @param {Exclude<Source, "frame">} source
 * @returns {Float64Array}
 */
export function synthetic(source) {
  const spec = source === "alternate" ? ALTERNATE : FRACTION;
  return pulseTrain(spec.period, spec.odd);
}
