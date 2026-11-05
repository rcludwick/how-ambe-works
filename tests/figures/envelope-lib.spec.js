// The envelope figure's pick (lib/picks.js voicedStretch, "voiced-stretch")
// and the counts its steps quote, in node, on the featured clip (lr-b).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { CUTOFF_HZ } from "../../docs/javascripts/lib/cutoff.js";
import { envelopeAmplitudes, harmonicCount } from "../../docs/javascripts/lib/harmonics.js";
import { ENVELOPE_PICKS, strongVoiced, voicedStretch } from "../../docs/javascripts/lib/picks.js";

const load = (/** @type {string} */ file) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${file}.json`, import.meta.url), "utf8"));
const spectra = load("spectra");
const frames = load("frames").frames;

test("voiced-stretch picks run 95 to 124 and frame 112", () => {
  expect(voicedStretch(frames)).toEqual({ run: [95, 124], frame: 112 });
  expect(ENVELOPE_PICKS["voiced-stretch"]).toBe(voicedStretch);
  expect(strongVoiced(frames[94])).toBe(false);
  expect(strongVoiced(frames[125])).toBe(false);
});

test("L at frames 95, 112 and 124 is 27, 28 and 30, and the picker gives that many levels", () => {
  for (const [i, L, f0] of [[95, 27, 132.5], [112, 28, 130.6], [124, 30, 122.0]]) {
    expect(frames[i].derived.orig_f0_hz).toBe(f0);
    expect(harmonicCount(f0, CUTOFF_HZ)).toBe(L);
    expect(envelopeAmplitudes(spectra.original[i], f0, spectra.bin_hz, CUTOFF_HZ)).toHaveLength(L);
  }
});

test("rounding frame 112 to 6 and 12 dB costs 1.68 and 3.68 dB RMS; whole-dB data makes 1 dB cost nothing", () => {
  const f0 = frames[112].derived.orig_f0_hz;
  const dbs = envelopeAmplitudes(spectra.original[112], f0, spectra.bin_hz, CUTOFF_HZ).map((h) => h.db);
  const rms = (/** @type {number} */ step) =>
    Math.sqrt(dbs.reduce((s, d) => s + (Math.round(d / step) * step - d) ** 2, 0) / dbs.length);
  expect(rms(6).toFixed(2)).toBe("1.68");
  expect(rms(12).toFixed(2)).toBe("3.68");
  expect(rms(1)).toBe(0);
});

test("step 4's median: the same harmonic moves a median of 4 dB from frame to frame over the stretch", () => {
  /** @type {number[]} */
  const moves = [];
  for (let i = 95; i < 124; i += 1) {
    const a = envelopeAmplitudes(spectra.original[i], frames[i].derived.orig_f0_hz, spectra.bin_hz, CUTOFF_HZ);
    const b = envelopeAmplitudes(spectra.original[i + 1], frames[i + 1].derived.orig_f0_hz, spectra.bin_hz, CUTOFF_HZ);
    for (let k = 0; k < Math.min(a.length, b.length); k += 1) moves.push(Math.abs(a[k].db - b[k].db));
  }
  moves.sort((x, y) => x - y);
  const mid = moves.length / 2;
  expect(moves.length % 2 ? moves[Math.floor(mid)] : (moves[mid - 1] + moves[mid]) / 2).toBe(4);
});
