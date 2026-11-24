// lib/probe.js (plan N1, design §5.1): the numbers the probe figure and its
// steps state. Pure arithmetic, run in Node.
import { test, expect } from "@playwright/test";
import { BIN_HZ, N, probe, radians, sweep } from "../../docs/javascripts/lib/probe.js";

/** The phase slider's positions, degrees. */
const PHASES = Array.from({ length: 24 }, (_, i) => i * 15);

test("probe: a 20 ms block at 8000 samples a second, bins 50 Hz apart", () => {
  expect(N).toBe(160);
  expect(BIN_HZ).toBe(50);
});

test("probe at 200 Hz: the sine sum is 80 cos phi and the cosine sum 80 sin phi", () => {
  for (const degrees of [...PHASES, 7, 101, 263]) {
    const phi = radians(degrees);
    const p = probe(200, phi);
    expect(Math.abs(p.sine - 80 * Math.cos(phi))).toBeLessThan(1e-9);
    expect(Math.abs(p.cosine - 80 * Math.sin(phi))).toBeLessThan(1e-9);
    expect(Math.abs(p.length - 80)).toBeLessThan(1e-9);
  }
  expect(probe(200, 0).sine.toFixed(2)).toBe("80.00");
  expect(Math.abs(probe(200, radians(90)).sine)).toBeLessThan(1e-9);
});

test("probe: zero at every bin other than 4 (k = 1 to 20), both tests, every phase", () => {
  for (let k = 1; k <= 20; k += 1) {
    if (k === 4) continue;
    for (const degrees of PHASES) {
      const p = probe(k * BIN_HZ, radians(degrees));
      expect(Math.abs(p.sine), `bin ${k}, ${degrees} degrees`).toBeLessThan(1e-9);
      expect(Math.abs(p.cosine), `bin ${k}, ${degrees} degrees`).toBeLessThan(1e-9);
    }
  }
});

test("probe at 225 Hz: length 47.96 to 53.91 over the slider's phases", () => {
  const lengths = PHASES.map((d) => probe(225, radians(d)).length);
  expect(Math.min(...lengths).toFixed(2)).toBe("47.96");
  expect(Math.max(...lengths).toFixed(2)).toBe("53.91");
  expect(probe(225, 0).length.toFixed(2)).toBe("47.96");
  expect(probe(225, radians(90)).length.toFixed(2)).toBe("53.91");
});

test("probe at 225 Hz: the running sum turns half a turn; at 250 Hz a whole turn, back to 0", () => {
  /** Total turn of the running-sum path's direction, in turns. */
  const turning = (/** @type {number} */ f) => {
    const p = probe(f, 0);
    let total = 0;
    let last = null;
    for (let n = 8; n < N; n += 8) {
      const a = Math.atan2(p.cosineRun[n] - p.cosineRun[n - 8], p.sineRun[n] - p.sineRun[n - 8]);
      if (last !== null) total += ((a - last + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      last = a;
    }
    return Math.abs(total) / (2 * Math.PI);
  };
  expect(turning(225)).toBeGreaterThan(0.35);
  expect(turning(225)).toBeLessThan(0.65);
  expect(turning(250)).toBeGreaterThan(0.8);
  expect(Math.abs(probe(250, 0).length)).toBeLessThan(1e-9);
});

test("probe sweep at phase 0: 54.30, 80 and 47.96 at 175, 200 and 225 Hz", () => {
  const values = sweep([175, 200, 225], 0);
  expect([...values].map((v) => v.toFixed(2))).toEqual(["54.30", "80.00", "47.96"]);
});

test("probe: each product's stem tip lies on a circle of radius 1/2 around (cos phi, sin phi)/2", () => {
  for (const degrees of [0, 45, 210]) {
    const phi = radians(degrees);
    const p = probe(200, phi);
    for (let n = 0; n < N; n += 1) {
      const r = Math.hypot(p.sineProducts[n] - Math.cos(phi) / 2, p.cosineProducts[n] - Math.sin(phi) / 2);
      expect(Math.abs(r - 0.5)).toBeLessThan(1e-12);
    }
  }
});
