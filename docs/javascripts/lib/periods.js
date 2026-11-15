// @ts-check
/* ===========================================================================
 * lib/periods.js: a stretch of samples cut into pitch periods (utterance).
 * ---------------------------------------------------------------------------
 * Pure functions, no DOM. The utterance figure's 3D view stacks the pieces
 * these return, and its readout quotes how alike neighbouring periods are.
 * Generic display DSP on 60 ms of the input recording: nothing here comes
 * from or goes to the codec.
 *
 * Cuts (three-everywhere design §4.4): c_k = t0 - T/4 + (k - m) T, where
 * t0 is the largest sample and T the period in samples, for every k that
 * lands inside the window. A quarter period before the largest sample
 * puts each pulse a little after the start of its slice. Neighbouring
 * slices share their cut point, interpolated between samples, so the
 * pieces tile the window exactly: a head before the first cut, one slice
 * per period, and a tail after the last cut.
 *
 * Comparisons resample each slice at round(T) points spaced T / round(T)
 * apart from its cut, linearly interpolated, so slices that start between
 * samples line up point for point.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/**
 * One piece of the window: the samples between two cuts, with the cut
 * points themselves interpolated. Times are in samples from the window's
 * start (fractional at the cuts).
 * @typedef {Object} Piece
 * @property {"head" | "period" | "tail"} kind
 * @property {number} start  the cut it starts at (0 for the head)
 * @property {number} end    the cut it ends at (the last sample for the tail)
 * @property {number[]} ts   sample times, start and end included
 * @property {number[]} vs   sample values at ts
 */

/**
 * @typedef {Object} Periods
 * @property {number} t0       index of the largest |sample|
 * @property {number} period   T, in samples
 * @property {number[]} cuts   every cut inside the window, in order
 * @property {Piece[]} pieces  head (if any), one per period, tail (if any)
 * @property {number[][]} slices  each period resampled at round(T) points
 * @property {number} peak     the period (index into slices) that holds t0
 */

/**
 * A sample value at a fractional time, linearly interpolated, held at the
 * ends.
 * @param {ArrayLike<number>} samples
 * @param {number} t
 * @returns {number}
 */
export function sampleAt(samples, t) {
  const last = samples.length - 1;
  if (t <= 0) return samples[0];
  if (t >= last) return samples[last];
  const i = Math.floor(t);
  const f = t - i;
  return samples[i] * (1 - f) + samples[i + 1] * f;
}

/**
 * Index of the largest |sample| (the first, on a tie).
 * @param {ArrayLike<number>} samples
 * @returns {number}
 */
export function largest(samples) {
  let at = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) > Math.abs(samples[at])) at = i;
  }
  return at;
}

/**
 * Cut a window into pitch periods of `period` samples around its largest
 * sample.
 * @param {ArrayLike<number>} samples
 * @param {number} period T, in samples (8000 / f0 at 8 kHz)
 * @returns {Periods}
 */
export function slicePeriods(samples, period) {
  const last = samples.length - 1;
  const t0 = largest(samples);
  let c = t0 - period / 4;
  while (c - period >= 0) c -= period;
  /** @type {number[]} */
  const cuts = [];
  for (; c <= last; c += period) if (c >= 0) cuts.push(c);
  /**
   * @param {"head" | "period" | "tail"} kind
   * @param {number} start
   * @param {number} end
   * @returns {Piece}
   */
  const piece = (kind, start, end) => {
    const ts = [start];
    for (let i = Math.floor(start) + 1; i < end; i += 1) ts.push(i);
    if (end > start) ts.push(end);
    return { kind, start, end, ts, vs: ts.map((t) => sampleAt(samples, t)) };
  };
  /** @type {Piece[]} */
  const pieces = [];
  if (cuts.length && cuts[0] > 0) pieces.push(piece("head", 0, cuts[0]));
  for (let k = 0; k + 1 < cuts.length; k += 1) pieces.push(piece("period", cuts[k], cuts[k + 1]));
  if (cuts.length && cuts[cuts.length - 1] < last) pieces.push(piece("tail", cuts[cuts.length - 1], last));
  const n = Math.round(period);
  const slices = cuts.slice(0, -1).map((start) =>
    Array.from({ length: n }, (_, j) => sampleAt(samples, start + (j * period) / n)));
  const peak = Math.max(0, cuts.findIndex((cut, k) => k + 1 < cuts.length && t0 >= cut && t0 < cuts[k + 1]));
  return { t0, period, cuts, pieces, slices, peak };
}

/**
 * Pearson correlation of two equal-length runs.
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number}
 */
export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i += 1) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * How alike each slice is to the next: one correlation per neighbouring
 * pair.
 * @param {number[][]} slices from slicePeriods
 * @returns {number[]}
 */
export function neighbourCorrelation(slices) {
  return slices.slice(1).map((slice, k) => correlation(slices[k], slice));
}

/**
 * Each slice's peak-to-peak range, in the samples' own units.
 * @param {number[][]} slices
 * @returns {number[]}
 */
export function peakToPeak(slices) {
  return slices.map((slice) => Math.max(...slice) - Math.min(...slice));
}

/**
 * The lag, from minLag to maxLag samples, at which the window is most like
 * itself shifted, and that normalised autocorrelation. A window with a
 * period scores near 1 at it; noise scores low at every lag.
 * @param {ArrayLike<number>} samples
 * @param {number} minLag
 * @param {number} maxLag
 * @returns {{lag: number, r: number}}
 */
export function bestLag(samples, minLag, maxLag) {
  let best = { lag: minLag, r: -Infinity };
  for (let lag = minLag; lag <= maxLag && lag < samples.length; lag += 1) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i + lag < samples.length; i += 1) {
      ab += samples[i] * samples[i + lag];
      aa += samples[i] ** 2;
      bb += samples[i + lag] ** 2;
    }
    const r = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
    if (r > best.r) best = { lag, r };
  }
  return best;
}

/**
 * The mean of a run.
 * @param {ArrayLike<number>} values
 * @returns {number}
 */
export function mean(values) {
  let s = 0;
  for (let i = 0; i < values.length; i += 1) s += values[i];
  return values.length ? s / values.length : 0;
}
