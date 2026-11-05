// lib/pitch.js in node: the score on lr-b frame 8's stored window, the
// synthetic traps, and the stored track's corridor exit (plan N4).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  ALPHA, N, P_MAX, P_MIN, autocorrelation, comb, corridor, hamming, phiAt, psi, psiCurve, synthetic,
} from "../../docs/javascripts/lib/pitch.js";

const data = JSON.parse(readFileSync(new URL("../../docs/assets/data/lr-b/correlogram.json", import.meta.url), "utf8"));
const frames = JSON.parse(readFileSync(new URL("../../docs/assets/data/lr-b/frames.json", import.meta.url), "utf8")).frames;

/** The whole candidate with the largest score (the test looks; the library never picks). */
const largest = (/** @type {Float64Array} */ curve) => P_MIN + curve.indexOf(Math.max(...curve));

test("Hamming taper and phi: phi(0) is 1, phi is at most 1, and the taper matches numpy's", () => {
  const w = hamming();
  expect(w.length).toBe(N);
  expect(w[0]).toBeCloseTo(0.08, 12);
  expect(w[127]).toBeCloseTo(1, 12);
  const phi = autocorrelation(data.window.samples);
  expect(phi[0]).toBe(1);
  expect(Math.max(...phi.slice(1))).toBeLessThan(1);
});

test("lr-b frame 8: the score is largest at 46 (44.45); 23 scores 34.92, 79% of it", () => {
  expect(data.window.frame).toBe(8);
  expect(data.window.samples.length).toBe(255);
  const phi = autocorrelation(data.window.samples);
  const curve = psiCurve(phi);
  expect(curve.length).toBe(P_MAX - P_MIN + 1);
  expect(largest(curve)).toBe(46);
  expect(psi(phi, 46)).toBeCloseTo(44.45, 2);
  expect(psi(phi, 23)).toBeCloseTo(34.92, 2);
  expect(Math.round((100 * psi(phi, 23)) / psi(phi, 46))).toBe(79);
  // 23 is half of 46, so its comb holds every tooth of 46's.
  expect(comb(46).every((lag) => comb(23).includes(lag))).toBe(true);
  // Eq. 12 sums every integer k: P phi(0) plus twice this score, 69% at 23.
  const eq12 = (/** @type {number} */ p) => p * phi[0] + 2 * psi(phi, p);
  expect(Math.round((100 * eq12(23)) / eq12(46))).toBe(69);
  // The site tracker's 45.6 is a marker only: the score at 46 is above it.
  expect(8000 / frames[8].derived.orig_f0_hz).toBeCloseTo(45.61, 2);
  expect(psi(phi, 46)).toBeGreaterThan(psi(phi, 45.6));
});

test("the whole-clip rows hold the same phi, as integer percent", () => {
  const phi = autocorrelation(data.window.samples);
  const lags = data.lag_max - data.lag_min + 1;
  const row = data.rows.slice(8 * lags, 9 * lags);
  for (let m = data.lag_min; m <= data.lag_max; m += 1) {
    expect(row[m - data.lag_min]).toBe(Math.max(0, Math.min(100, Math.round(phi[m] * 100))));
  }
});

test("alternating cycles: one peak at 92 above 46, the score highest at 92, 46 within 5% of it", () => {
  const phi = autocorrelation(synthetic("alternate"));
  expect(phi[92]).toBeGreaterThan(phi[46]);
  const curve = psiCurve(phi);
  expect(largest(curve)).toBe(92);
  expect(psi(phi, 46) / psi(phi, 92)).toBeGreaterThan(0.94);
});

test("a period of 45.6: the comb at 46 drifts off by k x 0.4, and 45.6 scores above every whole candidate", () => {
  const phi = autocorrelation(synthetic("fraction"));
  expect(largest(psiCurve(phi))).toBe(46);
  expect(psi(phi, 45.6)).toBeGreaterThan(psi(phi, 46));
  expect(comb(46)[4] - comb(45.6)[4]).toBeCloseTo(2, 9);
  expect(phiAt(phi, 45.5)).toBeCloseTo((phi[45] + phi[46]) / 2, 12);
});

test("the stored track leaves the 20% corridor at frames 66 to 67, 41.8 to 57.3 samples", () => {
  expect(ALPHA).toBe(0.2);
  const period = data.tracker_period;
  expect(period.length).toBe(frames.length);
  expect(period[66]).toBeCloseTo(41.82, 2);
  expect(period[67]).toBeCloseTo(57.27, 2);
  const [lo, hi] = corridor(period[66]);
  expect(period[67]).toBeGreaterThan(hi);
  expect(lo).toBeCloseTo(33.46, 2);
  expect(data.corridor_exit).toBe(67);
  for (let i = 1; i < 67; i += 1) {
    if (!period[i] || !period[i - 1]) continue;
    const [a, b] = corridor(period[i - 1]);
    expect(period[i] >= a && period[i] <= b, `frame ${i}`).toBe(true);
  }
});
