// lib/picks.js SPECTRA_PICKS (utterance-spectra, design §4.3), in Node.
// The same windows are pinned for the Python mirror in
// tests/tools/test_poster_utterance_spectra.py.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SPECTRA_GATE_DBFS, SPECTRA_PICKS, totalDb } from "../../docs/javascripts/lib/picks.js";

/** @param {string} clip */
const spectra = (clip) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/spectra.json`, import.meta.url), "utf8"));

const EXPECTED = {
  "lj-c": [24, 62], "lr-c": [16, 36], "lj-a": [110, 108],
  "lr-a": [67, 54], "lj-d": [16, null], "lr-d": [19, null],
};

for (const [clip, [low, high]] of Object.entries(EXPECTED)) {
  test(`SPECTRA_PICKS on ${clip}: low-heavy ${low}, high-heavy ${high}`, () => {
    const doc = spectra(clip);
    expect(SPECTRA_PICKS["low-heavy"](doc.original, doc.bin_centre_hz)).toBe(low);
    expect(SPECTRA_PICKS["high-heavy"](doc.original, doc.bin_centre_hz)).toBe(high);
  });
}

test("each pick is above the gate and has more than half its power on its side", () => {
  for (const clip of Object.keys(EXPECTED)) {
    const doc = spectra(clip);
    for (const [name, inBand] of /** @type {const} */ ([["low-heavy", (/** @type {number} */ f) => f < 1000], ["high-heavy", (/** @type {number} */ f) => f >= 2000]])) {
      const i = SPECTRA_PICKS[name](doc.original, doc.bin_centre_hz);
      if (i === null) continue;
      const bins = doc.original[i];
      expect(totalDb(bins)).toBeGreaterThan(SPECTRA_GATE_DBFS);
      const powers = bins.map((/** @type {number} */ db) => 10 ** (db / 10));
      const part = powers.reduce((s, p, k) => s + (inBand(doc.bin_centre_hz[k]) ? p : 0), 0);
      expect(part).toBeGreaterThan(powers.reduce((s, p) => s + p, 0) / 2);
    }
  }
});

test("a window's total is never below its highest bin, and silence is gated out", () => {
  for (const clip of Object.keys(EXPECTED)) {
    for (const bins of spectra(clip).original) expect(totalDb(bins)).toBeGreaterThanOrEqual(Math.max(...bins) - 1e-9);
  }
  // A window below the gate never counts, whatever its shape.
  const hz = Array.from({ length: 128 }, (_, k) => k * 31.25);
  const quiet = [Array(128).fill(-90)];
  expect(SPECTRA_PICKS["low-heavy"](quiet, hz)).toBeNull();
});
