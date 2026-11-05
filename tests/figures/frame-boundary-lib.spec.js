// lib/boundary.js in node: the numbers the frame-boundary figure (ch11) and
// its steps rest on (three-everywhere plan N7, design §5.7).
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  CHANGE, F_OLD, LANES, T_MS, carrier, deepest, envelope, gateOpen, handoverPower, laneMode, midpoint, newF0,
  phaseJump, weights,
} from "../../docs/javascripts/lib/boundary.js";

/** @param {number} v @param {number} [d] */
const round = (v, d = 2) => Number(v.toFixed(d));

test("120 to 126 Hz: the crossfade's midpoint is cos(pi l delta_f T / 2): 0.98 at l = 1, 0.73 at 4, 0.06 at 8", () => {
  expect(newF0(CHANGE)).toBeCloseTo(126, 9);
  for (const [l, want] of [[1, 0.98], [4, 0.73], [8, 0.06]]) {
    const closed = Math.abs(Math.cos((Math.PI * l * 6 * 0.02) / 2));
    expect(midpoint(l, CHANGE)).toBeCloseTo(closed, 12);
    // The envelope the figure draws agrees with the closed form at 10 ms.
    expect(envelope("crossfade", l, T_MS / 2, CHANGE)).toBeCloseTo(closed, 9);
    expect(round(midpoint(l, CHANGE))).toBe(want);
  }
});

test("the envelope is the magnitude of the two weighted phasors, everywhere in the interval", () => {
  for (const l of [1, 5, 8, 13, 16]) {
    for (let t = 0; t <= T_MS; t += 0.37) {
      const { old: a, new: b } = weights(t);
      const d = 2 * Math.PI * l * 6 * (t / 1000);
      const re = a + b * Math.cos(d);
      const im = b * Math.sin(d);
      expect(envelope("crossfade", l, t, CHANGE)).toBeCloseTo(Math.hypot(re, im), 9);
      // The waveform never leaves its envelope.
      expect(Math.abs(carrier("crossfade", l, t, CHANGE))).toBeLessThanOrEqual(envelope("crossfade", l, t, CHANGE) + 1e-9);
    }
  }
});

test("the crossfade barely dips harmonic 1 and takes every harmonic from 5 up below half; switch and sweep never dip", () => {
  const depth = (/** @type {number} */ l) => deepest("crossfade", l, CHANGE).depth;
  for (let l = 5; l <= LANES; l += 1) expect(deepest("crossfade", l, CHANGE).level, `l = ${l}`).toBeLessThan(0.5);
  expect(round(depth(1))).toBe(0.03);
  expect(round(depth(4))).toBe(0.4);
  expect(depth(8)).toBeGreaterThan(0.94);
  for (let l = 8; l <= LANES; l += 1) expect(depth(l), `l = ${l}`).toBeGreaterThan(depth(4));
  for (const mode of /** @type {const} */ (["switch", "sweep"])) {
    for (let l = 1; l <= LANES; l += 1) expect(deepest(mode, l, CHANGE).depth).toBe(0);
  }
});

test("the patent's gate: lanes 1 to 7 swept and 8 to 16 crossfaded while the change is under 10% of the new fundamental", () => {
  const modes = Array.from({ length: LANES }, (_, i) => laneMode(i + 1, "rule", CHANGE));
  expect(modes.slice(0, 7).every((m) => m === "sweep")).toBe(true);
  expect(modes.slice(7).every((m) => m === "crossfade")).toBe(true);
  // |w0(0) - w0(-S)| < .1 w0(0): measured against the new frame.
  expect(gateOpen(0.11)).toBe(true); // 13.2 Hz of 133.2
  expect(gateOpen(0.12)).toBe(false); // 14.4 Hz of 134.4
  expect(laneMode(1, "rule", 0.15)).toBe("crossfade");
  expect(laneMode(10, "handover", CHANGE)).toBe("handover");
  expect(laneMode(13, "handover", CHANGE)).toBe("crossfade");
  expect(laneMode(3, "handover", CHANGE)).toBe("sweep");
});

test("the sweep starts on the old oscillator and ends at the new frequency, its phase continuous", () => {
  for (const l of [1, 4, 7]) {
    expect(carrier("sweep", l, 0, CHANGE)).toBeCloseTo(carrier("crossfade", l, 0, CHANGE), 12);
    // Instantaneous frequency from a centred difference, at each end.
    const freq = (/** @type {number} */ t) => {
      const h = 1e-4;
      const ph = (/** @type {number} */ u) => 2 * Math.PI * l * (F_OLD * u + (6 * u * u) / (2 * 0.02));
      return (ph(t + h) - ph(t - h)) / (2 * h) / (2 * Math.PI);
    };
    expect(freq(0)).toBeCloseTo(l * 120, 6);
    expect(freq(0.02)).toBeCloseTo(l * 126, 6);
  }
});

test("a switch jumps the phase by pi l delta_f T: 22 degrees at harmonic 1, 173 at harmonic 8", () => {
  expect(round(phaseJump(1, CHANGE), 0)).toBe(22);
  expect(round(phaseJump(8, CHANGE), 0)).toBe(173);
  expect(phaseJump(16, CHANGE)).toBeLessThanOrEqual(180);
});

test("a voiced to unvoiced handover: weights sum to 1, the expected power falls to 0.5 at the midpoint", () => {
  for (let t = 0; t <= T_MS; t += 2.5) {
    const w = weights(t);
    expect(w.old + w.new).toBeCloseTo(1, 12);
  }
  expect(handoverPower(0)).toBe(1);
  expect(handoverPower(T_MS / 2)).toBeCloseTo(0.5, 12);
  expect(handoverPower(T_MS)).toBe(1);
  expect(envelope("handover", 10, T_MS / 2, CHANGE)).toBeCloseTo(Math.SQRT1_2, 12);
});

test("scope: the figure's modules read nothing, no frames, no audio, no data file", () => {
  for (const name of ["anim-frame-boundary.js", "anim-frame-boundary-3d.js", "lib/boundary.js"]) {
    const file = new URL(`../../docs/javascripts/${name}`, import.meta.url);
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(source, name).not.toMatch(/\b(fetch|loadJSON|loadPCM|frameHex|hexBits|AudioContext)\s*\(/);
    expect(source, name).not.toMatch(/assets\/(data|audio)|\.json\b|\.wav\b/);
  }
});
