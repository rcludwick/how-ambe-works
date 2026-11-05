// lib/filter.js in node: the residuals, lane gains and delays the filter
// figure (ch01) and its prose rest on (three-everywhere plan, F1).
import { test, expect } from "@playwright/test";
import { F0, SHAPES, align, laneResponse, peakGain, run, settledOutput } from "../../docs/javascripts/lib/filter.js";

/** @param {import("../../docs/javascripts/lib/filter.js").Shape} shape @param {number} cutoff */
const residual = (shape, cutoff) => {
  const r = run(shape, cutoff);
  return align(r.input, r.output, r.perCycle);
};

test("residual at a 330 Hz cutoff: sine 0.48%, square 53.61%, triangle 19.46%, sawtooth 65.56%", () => {
  const got = SHAPES.map((s) => Number(residual(s, 330).pct.toFixed(2)));
  expect(got).toEqual([0.48, 53.61, 19.46, 65.56]);
});

test("over the slider, 120 to 1600 Hz: the sine stays under 0.98%, the others never get close", () => {
  /** @type {Record<string, number[]>} */
  const range = { sine: [Infinity, 0], square: [Infinity, 0], triangle: [Infinity, 0], sawtooth: [Infinity, 0] };
  for (let c = 120; c <= 1600; c += 10) {
    for (const s of SHAPES) {
      const p = residual(s, c).pct;
      range[s] = [Math.min(range[s][0], p), Math.max(range[s][1], p)];
    }
  }
  // Pinned to the two places the prose and the plan quote.
  const two = (/** @type {number} */ v) => Number(v.toFixed(2));
  expect(two(range.sine[1])).toBe(0.98);
  expect([range.square[0], range.triangle[0], range.sawtooth[0]].map(two)).toEqual([36.88, 4.8, 43.01]);
});

test("lane gains and delays at 330 Hz, harmonics 1 to 6", () => {
  const lanes = [1, 2, 3, 4, 5, 6].map((k) => laneResponse(k, 330));
  expect(lanes.map((l) => Number(l.gain.toFixed(3)))).toEqual([1.248, 3.497, 1.081, 0.425, 0.237, 0.154]);
  expect(lanes.map((l) => Number(l.delayMs.toFixed(3)))).toEqual([0.151, 0.487, 0.978, 0.782, 0.638, 0.537]);
  // The delay is the phase delay: -arg H / (2 pi k f0).
  for (const [i, l] of lanes.entries()) expect(l.delayMs).toBeCloseTo((-l.phase / (2 * Math.PI * (i + 1) * F0)) * 1000, 12);
});

test("the peak gain is ×4.03 at every cutoff", () => {
  for (const c of [120, 330, 800, 1600]) expect(Number(peakGain(c).gain.toFixed(2))).toBe(4.03);
});

test("the closed-form sum over every harmonic equals run()'s output to 1e-9", () => {
  for (const shape of SHAPES) {
    for (const cutoff of [120, 330, 1600]) {
      const r = run(shape, cutoff);
      let worst = 0;
      for (let i = 0; i < r.output.length; i += 7) worst = Math.max(worst, Math.abs(r.output[i] - settledOutput(shape, cutoff, i / r.perCycle)));
      expect(worst, `${shape} at ${cutoff} Hz`).toBeLessThan(1e-9);
    }
  }
});

test("the square's fit is upright: ×1.388 and 0.48 ms, not inverted half a cycle later", () => {
  const fit = residual("square", 330);
  expect(Number((1 / fit.gain).toFixed(3))).toBe(1.388);
  expect(Number(((fit.shift / 320 / F0) * 1000).toFixed(2))).toBe(0.48);
});
