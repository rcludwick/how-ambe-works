// lib/synth-model.js in node: the frame model the flat and 3D views share,
// the Mix weights, and the pitch-change readout (divided by this frame's f0).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  BANDS, buildFrameModel, linToDb, pitchChange, pitchChangeText, weights,
} from "../../docs/javascripts/lib/synth-model.js";

const load = (/** @type {string} */ file) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${file}.json`, import.meta.url), "utf8"));
const spectra = load("spectra");
const frames = load("frames").frames;

test("weights: noise alone at 0, both at 50, oscillators alone at 100", () => {
  expect(weights(0)).toEqual({ v: 0, u: 1 });
  expect(weights(50)).toEqual({ v: 1, u: 1 });
  expect(weights(100)).toEqual({ v: 1, u: 0 });
});

test("frame 98: f0 110.1 Hz, one voiced band, 36 harmonics of which 4 voiced", () => {
  const m = buildFrameModel(frames, spectra, 98);
  expect(m.f0).toBe(110.1);
  expect(m.voicedBand.filter(Boolean).length).toBe(1);
  expect(m.harmonicCount).toBe(36);
  expect(m.voicedHarmonics).toBe(4);
  expect(m.bandNoise).toHaveLength(BANDS);
  expect(m.noiseBands.map((b) => b.band)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  // The unvoiced bands' noise is the same in both lists.
  for (const nb of m.noiseBands) expect(m.bandNoise[nb.band]).toEqual(nb);
  // Each harmonic's level is the decoded spectrum's bin at k f0.
  for (const h of m.harmonics) {
    expect(linToDb(h.amp)).toBeCloseTo(spectra.decoded[98][Math.round(h.f / 31.25)], 9);
  }
});

test("the same frame always draws the same traces", () => {
  const a = buildFrameModel(frames, spectra, 102);
  const b = buildFrameModel(frames, spectra, 102);
  expect(Array.from(a.noiseTrace)).toEqual(Array.from(b.noiseTrace));
  expect(Array.from(a.voicedTrace)).toEqual(Array.from(b.voicedTrace));
});

test("pitch change from the previous frame, as a share of this frame's f0", () => {
  expect(pitchChangeText(pitchChange(frames, 98))).toBe("-11.6 Hz, 10.5% of this frame's");
  expect(pitchChangeText(pitchChange(frames, 99))).toBe("+11.5 Hz, 9.5% of this frame's");
  // Frames 90 and 91 have no pitch; frame 93 has one (133.3 Hz) and the
  // frame before it does not, so the readout names the previous frame.
  expect(frames[90].derived.decoded_f0_hz).toBe(0);
  expect(frames[91].derived.decoded_f0_hz).toBe(0);
  expect(pitchChangeText(pitchChange(frames, 91))).toBe("none (a frame without pitch)");
  expect(frames[92].derived.decoded_f0_hz).toBe(0);
  expect(frames[93].derived.decoded_f0_hz).toBeCloseTo(133.3, 1);
  expect(pitchChange(frames, 93)).toEqual({ missing: "previous" });
  expect(pitchChangeText(pitchChange(frames, 93))).toBe("none (the previous frame has no pitch)");
  expect(pitchChange(frames, 0)).toHaveProperty("missing");
});
