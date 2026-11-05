// The amplitude picker (plan decision 14), in node: envelope's plotted
// amplitudes against harmonicAmplitudes() on the voiced stretch of lr-b
// that the envelope figure shows, frames 95 to 124.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { envelopeAmplitudes, harmonicAmplitudes } from "../../docs/javascripts/lib/harmonics.js";

const load = (/** @type {string} */ file) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${file}.json`, import.meta.url), "utf8"));
const spectra = load("spectra");
const frames = load("frames").frames;

test("harmonicAmplitudes differs from envelope's picker on frames 95 to 124, so envelope's is its own export", () => {
  let differ = 0;
  let total = 0;
  let worst = 0;
  for (let i = 95; i <= 124; i += 1) {
    const f0 = frames[i].derived.orig_f0_hz;
    const env = envelopeAmplitudes(spectra.original[i], f0, spectra.bin_hz);
    const A = harmonicAmplitudes(spectra.original[i], f0, env.length);
    for (const { m, db } of env) {
      total += 1;
      const gap = Math.abs(20 * Math.log10(A[m]) - db);
      if (gap > 1e-6) differ += 1;
      worst = Math.max(worst, gap);
    }
  }
  expect({ differ, total, worst }).toEqual({ differ: 100, total: 916, worst: 16 });
});

test("envelopeAmplitudes gives the envelope figure's values", () => {
  /** @type {[number, number, number, number[], number[]][]} frame, f0, count, first six dB, last two dB */
  const want = [
    [95, 132.5, 29, [-22, -23, -22, -41, -44, -52], [-61, -70]],
    [112, 130.6, 29, [-18, -22, -29, -40, -62, -58], [-71, -74]],
    [124, 122, 31, [-23, -30, -33, -38, -61, -59], [-50, -54]],
  ];
  for (const [i, f0, count, first, last] of want) {
    expect(frames[i].derived.orig_f0_hz).toBe(f0);
    const env = envelopeAmplitudes(spectra.original[i], f0, spectra.bin_hz);
    expect(env).toHaveLength(count);
    expect(env.slice(0, 6).map((h) => h.db)).toEqual(first);
    expect(env.slice(-2).map((h) => h.db)).toEqual(last);
    expect(env.map((h) => h.m)).toEqual(Array.from({ length: count }, (_, k) => k + 1));
    expect(env[count - 1].hz).toBeLessThanOrEqual(3900);
  }
  expect(envelopeAmplitudes(spectra.original[95], 0, spectra.bin_hz)).toEqual([]);
});
