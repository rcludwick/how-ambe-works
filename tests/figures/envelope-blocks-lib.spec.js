// lib/dct.js in node, on the envelope-blocks figure's default frame (lr-b
// frame 112, f0 130.6 Hz, L = 28, blocks 5, 5, 5, 5, 4, 4).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  blockCoefficients, blockSizes, dct, energyByOrder, energyKept, idct, keepCoefficients, rmsDifference,
} from "../../docs/javascripts/lib/dct.js";
import { envelopeAmplitudes } from "../../docs/javascripts/lib/harmonics.js";

const load = (/** @type {string} */ file) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${file}.json`, import.meta.url), "utf8"));
const spectra = load("spectra");
const frames = load("frames").frames;

/** Frame 112's amplitudes, mean removed, as the figure draws them. */
function frame112() {
  const f0 = frames[112].derived.orig_f0_hz;
  const amps = envelopeAmplitudes(spectra.original[112], f0, spectra.bin_hz, 3700).map((h) => h.db);
  const mean = amps.reduce((s, v) => s + v, 0) / amps.length;
  return { f0, mean, values: amps.map((v) => v - mean) };
}

test("blockSizes splits evenly, the longer blocks first", () => {
  expect(blockSizes(28)).toEqual([5, 5, 5, 5, 4, 4]);
  expect(blockSizes(20)).toEqual([4, 4, 3, 3, 3, 3]);
  expect(blockSizes(40)).toEqual([7, 7, 7, 7, 6, 6]);
  expect(blockSizes(4)).toEqual([1, 1, 1, 1]);
});

test("dct is orthonormal and idct inverts it", () => {
  const x = [3, -1, 4, 1, -5, 9, 2];
  const c = dct(x);
  expect(c.reduce((s, v) => s + v * v, 0)).toBeCloseTo(x.reduce((s, v) => s + v * v, 0), 10);
  expect(c[0] / Math.sqrt(x.length)).toBeCloseTo(x.reduce((s, v) => s + v, 0) / x.length, 12);
  idct(c).forEach((v, i) => expect(v).toBeCloseTo(x[i], 12));
});

test("frame 112: the round trip is exact at k = max, k = 1 is the block means, and the energy by order", () => {
  const { f0, mean, values } = frame112();
  expect(f0).toBe(130.6);
  expect(values).toHaveLength(28);
  expect(mean).toBeCloseTo(-58.607, 3);
  const sizes = blockSizes(values.length);
  const coefficients = blockCoefficients(values, sizes);
  const exact = keepCoefficients(coefficients, Math.max(...sizes));
  exact.forEach((v, i) => expect(Math.abs(v - values[i])).toBeLessThan(1e-9));
  expect(rmsDifference(exact, values)).toBeLessThan(1e-9);
  const means = keepCoefficients(coefficients, 1);
  let at = 0;
  for (const size of sizes) {
    const block = values.slice(at, at + size);
    const m = block.reduce((s, v) => s + v, 0) / size;
    for (let i = 0; i < size; i += 1) expect(means[at + i]).toBeCloseTo(m, 10);
    at += size;
  }
  const energies = energyByOrder(coefficients);
  expect(energies.map(Math.round)).toEqual([6266, 1301, 204, 77, 13]);
  expect((energyKept(energies, 1) * 100).toFixed(1)).toBe("79.7");
  expect((energyKept(energies, 2) * 100).toFixed(1)).toBe("96.3");
  expect(energyKept(energies, 5)).toBeCloseTo(1, 12);
});

test("every frame the figure offers: 89 frames, L from 20 to 40, blocks of 3 to 7, exact at k = max", () => {
  const offered = frames.filter((/** @type {FrameRecord} */ f) => f.derived.voiced && f.derived.orig_f0_hz > 0 &&
    f.derived.orig_f0_confidence >= 0.6 && f.derived.orig_rms_dbfs > -32);
  expect(offered).toHaveLength(89);
  const Ls = [];
  const lengths = new Set();
  for (const f of offered) {
    const amps = envelopeAmplitudes(spectra.original[f.i], f.derived.orig_f0_hz, spectra.bin_hz, 3700).map((h) => h.db);
    Ls.push(amps.length);
    const sizes = blockSizes(amps.length);
    sizes.forEach((s) => lengths.add(s));
    const back = keepCoefficients(blockCoefficients(amps, sizes), Math.max(...sizes));
    back.forEach((v, i) => expect(Math.abs(v - amps[i])).toBeLessThan(1e-9));
  }
  expect([Math.min(...Ls), Math.max(...Ls)]).toEqual([20, 40]);
  expect([Math.min(...lengths), Math.max(...lengths)]).toEqual([3, 7]);
});
