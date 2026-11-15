// lib/periods.js, in node: the utterance figure's vowel and fricative
// windows (lj-c) cut at the vowel's period. Bounds, not prose values
// (three-everywhere design §4.4).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  bestLag, correlation, mean, neighbourCorrelation, peakToPeak, sampleAt, slicePeriods,
} from "../../docs/javascripts/lib/periods.js";

const waveform = JSON.parse(readFileSync(new URL("../../docs/assets/data/lj-c/waveform.json", import.meta.url), "utf8"));
const FULL_SCALE = 32768;
const vowel = waveform.closeups.voiced;
const fricative = waveform.closeups.unvoiced;
// The fricative borrows the vowel's period: it has none of its own.
const T = 8000 / vowel.f0_hz;

test("the vowel's f0 is the one the figure quotes", () => {
  expect(vowel.f0_hz).toBe(185.9);
  expect((1000 * T) / 8000).toBeCloseTo(5.38, 2);
  expect(fricative.f0_hz).toBeNull();
});

for (const [name, win] of [["vowel", vowel], ["fricative", fricative]]) {
  test(`${name}: ten periods, and the pieces tile the window with shared cuts`, () => {
    const p = slicePeriods(win.samples, T);
    expect(p.slices).toHaveLength(10);
    expect(p.pieces.filter((x) => x.kind === "period")).toHaveLength(10);
    expect(p.pieces).toHaveLength(12);
    expect(p.pieces[0]).toMatchObject({ kind: "head", start: 0 });
    expect(p.pieces[11]).toMatchObject({ kind: "tail", end: win.samples.length - 1 });
    for (let k = 0; k + 1 < p.pieces.length; k += 1) {
      expect(p.pieces[k].end).toBe(p.pieces[k + 1].start);
      expect(p.pieces[k].vs.at(-1)).toBe(p.pieces[k + 1].vs[0]);
    }
    // Every sample of the window appears in exactly one piece.
    const seen = p.pieces.flatMap((x) => x.ts.filter((t) => Number.isInteger(t) && t !== x.start));
    expect(new Set(seen).size).toBe(seen.length);
    // The slice that holds the largest sample starts a quarter period before it.
    expect(p.t0 - p.cuts[p.peak]).toBeCloseTo(T / 4, 9);
    for (let k = 1; k < p.cuts.length; k += 1) expect(p.cuts[k] - p.cuts[k - 1]).toBeCloseTo(T, 9);
  });
}

test("vowel: neighbouring periods alike, the last one unlike the early ones", () => {
  const p = slicePeriods(vowel.samples, T);
  const r = neighbourCorrelation(p.slices);
  expect(r).toHaveLength(9);
  expect(mean(r)).toBeGreaterThanOrEqual(0.94);
  expect(mean(r)).toBeLessThanOrEqual(0.96);
  expect(Math.min(...r)).toBeGreaterThanOrEqual(0.9);
  // Slice 10 against the other nine: the vowel drifts over 60 ms.
  const last = p.slices[9];
  expect(mean(p.slices.slice(0, 9).map((s) => correlation(s, last)))).toBeLessThan(0.65);
  expect(correlation(p.slices[0], last)).toBeLessThan(0.65);
});

test("vowel: peak-to-peak stays within 0.80 to 1.07 of full scale and falls over the last four periods", () => {
  const p = slicePeriods(vowel.samples, T);
  const pp = peakToPeak(p.slices).map((v) => v / FULL_SCALE);
  for (const v of pp) {
    expect(v).toBeGreaterThanOrEqual(0.8);
    expect(v).toBeLessThanOrEqual(1.07);
  }
  for (let k = 6; k < 10; k += 1) expect(pp[k]).toBeLessThan(pp[k - 1]);
});

test("fricative: no period to stack", () => {
  const p = slicePeriods(fricative.samples, T);
  const r = neighbourCorrelation(p.slices);
  expect(mean(r)).toBeLessThan(0.2);
  expect(Math.min(...r)).toBeGreaterThan(-0.3);
  expect(Math.max(...r)).toBeLessThan(0.6);
  // At any lag a voice could have (50 to 400 Hz), the fricative is unlike itself.
  expect(bestLag(fricative.samples, 20, 160).r).toBeLessThan(0.35);
  // The vowel, by contrast, is most like itself one period on.
  const v = bestLag(vowel.samples, 20, 160);
  expect(v.lag).toBe(Math.round(T));
  expect(v.r).toBeGreaterThan(0.9);
});

test("sampleAt interpolates and holds the ends", () => {
  expect(sampleAt([0, 10, 20], 0.5)).toBe(5);
  expect(sampleAt([0, 10, 20], -1)).toBe(0);
  expect(sampleAt([0, 10, 20], 9)).toBe(20);
});
