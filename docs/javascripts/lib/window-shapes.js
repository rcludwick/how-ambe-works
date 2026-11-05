// @ts-check
/* ===========================================================================
 * lib/window-shapes.js: three windows over one 160-sample block.
 * ---------------------------------------------------------------------------
 * The window-shapes figure's model (ch03). One cosine at 6.5 cycles per
 * block (325 Hz at 8 kHz, phase 0), the tone the leakage figure cuts half
 * a bin off, and the windows of one family:
 *
 *   w(n) = a - (1 - a) cos(2 pi n / N),   a = (1 + e) / 2
 *
 * where e is the window's value at the block's ends. e = 1 is the
 * rectangular window (every weight 1), e = 0.08 is Hamming (a = 0.54) and
 * e = 0 is Hann (a = 0.5). Every member is 1 in the middle of the block.
 * These are the periodic forms, N in the denominator, so w(N), the next
 * copy's first sample, equals w(0), as lib/leakage.js has it.
 *
 * Generic DSP on synthetic data only: no audio is read or made, and nothing
 * here is specific to AMBE. The shapes are the textbook ones (Harris 1978,
 * "On the use of windows for harmonic analysis with the discrete Fourier
 * transform", Proc. IEEE 66(1)).
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** Samples in the block: 20 ms at 8 kHz. */
export const N = 160;
/** The tone: 6.5 cycles in the block, half a bin off (the leakage figure's worst case). */
export const CYCLES = 6.5;

const TAU = 2 * Math.PI;

/** @typedef {"rect" | "hamming" | "hann"} WindowName */

/** The three named windows: their value at the block's ends, and their names. */
export const WINDOWS = /** @type {const} */ ({
  rect: { end: 1, name: "rectangular", title: "Rectangular" },
  hamming: { end: 0.08, name: "Hamming", title: "Hamming" },
  hann: { end: 0, name: "Hann", title: "Hann" },
});
/** @type {readonly WindowName[]} button order */
export const WINDOW_NAMES = ["rect", "hann", "hamming"];

/**
 * The 3D view's depth for a window with end value `end`: its square root,
 * 0 (Hann) at the back to 1 (rectangular) at the front. On a straight
 * scale Hamming (0.08) and Hann (0) would share the last twelfth of the
 * depth; the square root puts Hamming 0.28 of the way forward.
 * @param {number} end
 * @returns {number}
 */
export const depthOf = (end) => Math.sqrt(Math.max(0, end));

/**
 * The end value at a depth, depthOf's inverse.
 * @param {number} depth
 * @returns {number}
 */
export const endAt = (depth) => depth * depth;

/**
 * The family along the 3D view's depth, front (rectangular) to back (Hann):
 * evenly spaced in depth, every tenth, with Hamming's 0.08 in place of the
 * 0.09 at depth 0.3.
 */
export const ENDS = Array.from({ length: 11 }, (_, i) => Math.round(endAt(1 - i * 0.1) * 100) / 100)
  .map((end) => (end === 0.09 ? WINDOWS.hamming.end : end));

/**
 * The window with end value `end` at sample n (any n; periodic in N).
 * @param {number} end  0 (Hann) to 1 (rectangular)
 * @param {number} n
 * @returns {number}
 */
export function windowAt(end, n) {
  const a = (1 + end) / 2;
  return a - (1 - a) * Math.cos((TAU * n) / N);
}

/**
 * The tone at sample n, before the window.
 * @param {number} n
 * @returns {number}
 */
export function toneAt(n) {
  return Math.cos((TAU * CYCLES * n) / N);
}

/**
 * The windowed block w(n) x(n) at sample n.
 * @param {number} end
 * @param {number} n
 * @returns {number}
 */
export function windowedAt(end, n) {
  return windowAt(end, n) * toneAt(n);
}

/**
 * The step at the joint: where the windowed block was heading one sample
 * past its end, against where the next copy starts. With the tone half a
 * bin off it is 2e: 2 for the rectangular cut, 0.16 for Hamming, 0 for Hann.
 * @param {number} end
 * @returns {number}
 */
export function jointStep(end) {
  return Math.abs(windowedAt(end, N) - windowedAt(end, 0));
}

/**
 * The share of the block's energy the window keeps: the sum of the windowed
 * samples squared over the sum of the plain ones squared.
 * @param {number} end
 * @returns {number}
 */
export function energyKept(end) {
  let kept = 0;
  let all = 0;
  for (let n = 0; n < N; n += 1) {
    const x = toneAt(n);
    kept += (windowAt(end, n) * x) ** 2;
    all += x * x;
  }
  return kept / all;
}

/**
 * The named window at an end value, or null between them.
 * @param {number} end
 * @returns {WindowName | null}
 */
export function named(end) {
  for (const key of WINDOW_NAMES) if (Math.abs(WINDOWS[key].end - end) < 1e-6) return key;
  return null;
}

/**
 * A curve sampled every half sample from 0 to `to`: [n, value] pairs.
 * @param {(n: number) => number} f
 * @param {number} [from=0]
 * @param {number} [to=N]
 * @returns {[number, number][]}
 */
export function curve(f, from = 0, to = N) {
  /** @type {[number, number][]} */
  const out = [];
  for (let i = from * 2; i <= to * 2; i += 1) out.push([i / 2, f(i / 2)]);
  return out;
}
