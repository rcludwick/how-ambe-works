import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as H from "../../docs/javascripts/lib/harmonics.js";
import { topSteady } from "../../docs/javascripts/lib/picks.js";

const load = (/** @type {string} */ clip, /** @type {string} */ file) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/${file}.json`, import.meta.url), "utf8"));

const CASES = [
  // clip, frame, f0, L, peak/RMS zero, peak/RMS random (reroll 0), crests off by > 0.1 period
  ["lj-b", 11, 251.4, 14, 2.82, 2.18, 13],
  ["lr-a", 86, 131.5, 28, 2.84, 1.85, 22],
  ["lr-d", 23, 168.0, 22, 3.59, 2.16, 19],
];

for (const [clip, frame, f0, L, zeroPr, randPr, offCount] of CASES) {
  test(`${clip} frame ${frame}`, () => {
    const frames = load(clip, "frames").frames;
    expect(topSteady(frames, 1)[0].i).toBe(frame);
    const row = load(clip, "spectra").original[frame];
    expect(frames[frame].derived.orig_f0_hz).toBe(f0);
    expect(H.harmonicCount(f0, 3700)).toBe(L);
    const A = H.harmonicAmplitudes(row, f0, L);
    const zero = H.samplePeriod(A, H.phases(L, "zero", 0), L);
    const rand = H.samplePeriod(A, H.phases(L, "random", 0), L);
    expect(H.peakToRms(zero).toFixed(2)).toBe(zeroPr.toFixed(2));
    expect(H.peakToRms(rand).toFixed(2)).toBe(randPr.toFixed(2));
    const change = H.largestChangeDb(H.harmonicMagnitudes(zero, L), H.harmonicMagnitudes(rand, L), L);
    expect(change).toBeLessThan(0.05);
    const offsets = [...H.phases(L, "random", 0)].slice(1).map(H.crestOffset);
    expect(offsets.filter((x) => Math.abs(x) > 0.1).length).toBe(offCount);
    expect([...H.phases(L, "zero", 0)].map(H.crestOffset).every((x) => x === 0)).toBe(true);
  });
}

test("the readout reports a changed amplitude", () => {
  const A = new Float64Array([0, 1, 0.5, 0.25]);
  const phi = H.phases(3, "random", 0);
  const a = H.harmonicMagnitudes(H.samplePeriod(A, phi, 3), 3);
  const B = A.slice();
  B[2] *= 1.122;
  const b = H.harmonicMagnitudes(H.samplePeriod(B, phi, 3), 3);
  expect(H.largestChangeDb(a, b, 3).toFixed(3)).toBe("1.000");
});

test("f0 90 Hz: every harmonic gets a bin, no bin counts twice", () => {
  const L = H.harmonicCount(90, 3700);
  expect(L).toBe(41);
  /** @type {Map<number, number[]>} */
  const owners = new Map();
  for (let b = 1; b < 128; b += 1) {
    const k = Math.round((b * H.BIN_HZ) / 90);
    if (k >= 1 && k <= L) owners.set(k, [...(owners.get(k) ?? []), b]);
  }
  for (let k = 1; k <= L; k += 1) expect(owners.get(k)?.length ?? 0).toBeGreaterThanOrEqual(2);
  const all = [...owners.values()].flat();
  expect(new Set(all).size).toBe(all.length);
});

test("scaledPhases: zero at alpha 0, Random unchanged at alpha 1, alpha times the wrapped phase between", () => {
  for (const L of [1, 14, 28]) {
    for (const reroll of [0, 1, 5]) {
      expect([...H.scaledPhases(L, 0, reroll)]).toEqual([...H.phases(L, "zero", reroll)]);
      expect([...H.scaledPhases(L, 1, reroll)]).toEqual([...H.phases(L, "random", reroll)]);
      const random = H.phases(L, "random", reroll);
      const half = H.scaledPhases(L, 0.5, reroll);
      expect(half[0]).toBe(0);
      for (let k = 1; k <= L; k += 1) {
        const wrapped = H.wrapPhase(random[k]);
        expect(wrapped).toBeGreaterThan(-Math.PI);
        expect(wrapped).toBeLessThanOrEqual(Math.PI);
        // The same angle: the wrap changes the number, never the cosine.
        expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(random[k]), 12);
        expect(half[k]).toBeCloseTo(0.5 * wrapped, 12);
      }
    }
  }
  // Clamped outside 0 to 1.
  expect([...H.scaledPhases(5, -1, 0)]).toEqual([...H.phases(5, "zero", 0)]);
  expect([...H.scaledPhases(5, 2, 0)]).toEqual([...H.phases(5, "random", 0)]);
});

// Peak-to-RMS of the default frames as alpha rises: most of the drop
// happens by alpha 0.5 to 0.7, and past that it moves by a few tenths, not
// always down (lr-d rises from 0.5 to 0.7). ch11 says so.
const SCALED = [
  ["lj-b", 11, 251.4, ["2.82", "2.40", "2.21", "2.18"]],
  ["lr-a", 86, 131.5, ["2.84", "2.07", "1.96", "1.85"]],
  ["lr-d", 23, 168.0, ["3.59", "2.37", "2.58", "2.16"]],
];
for (const [clip, frame, f0, ratios] of SCALED) {
  test(`scaledPhases: ${clip} frame ${frame} peak-to-RMS at alpha 0, 0.5, 0.7, 1`, () => {
    const L = H.harmonicCount(f0, 3700);
    const A = H.harmonicAmplitudes(load(clip, "spectra").original[frame], f0, L);
    const at = [0, 0.5, 0.7, 1].map((alpha) => H.peakToRms(H.samplePeriod(A, H.scaledPhases(L, alpha, 0), L)).toFixed(2));
    expect(at).toEqual(ratios);
    // At alpha 1, exactly the Random mode's numbers.
    expect(H.peakToRms(H.samplePeriod(A, H.scaledPhases(L, 1, 0), L)))
      .toBe(H.peakToRms(H.samplePeriod(A, H.phases(L, "random", 0), L)));
  });
}
