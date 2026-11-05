// lib/window-shapes.js, the window-shapes figure's model: the three named
// windows of one family, their values at the ends and in the middle, the
// step at the joint (2e) and the energy each keeps. The poster's Python
// mirror pins the same numbers (tests/tools/test_poster_window_shapes.py).
import { test, expect } from "@playwright/test";
import * as W from "../../docs/javascripts/lib/window-shapes.js";

test("the family holds the three named windows as the textbook formulas give them", () => {
  for (let n = 0; n <= W.N; n += 1) {
    expect(W.windowAt(1, n)).toBe(1);
    expect(W.windowAt(0, n)).toBeCloseTo(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / W.N), 12);
    expect(W.windowAt(0.08, n)).toBeCloseTo(0.54 - 0.46 * Math.cos((2 * Math.PI * n) / W.N), 12);
  }
});

test("each window's ends, middle, step at the joint and energy kept", () => {
  /** @type {[number, number, number, number][]} end, middle, step, energy % */
  const want = [[1, 1, 2, 100], [0, 1, 0, 37.5], [0.08, 1, 0.16, 39.7]];
  for (const [end, middle, step, energy] of want) {
    expect(W.windowAt(end, 0)).toBeCloseTo(end, 12);
    expect(W.windowAt(end, W.N)).toBeCloseTo(end, 12);
    expect(W.windowAt(end, W.N / 2)).toBeCloseTo(middle, 12);
    expect(W.jointStep(end)).toBeCloseTo(step, 9);
    expect(Number((W.energyKept(end) * 100).toFixed(1))).toBe(energy);
  }
});

test("the depth axis: the family every tenth of the depth on a square root scale, Hamming's 0.08 for 0.09", () => {
  expect(W.ENDS).toEqual([1, 0.81, 0.64, 0.49, 0.36, 0.25, 0.16, 0.08, 0.04, 0.01, 0]);
  expect(W.depthOf(0.25)).toBe(0.5);
  expect(W.endAt(W.depthOf(0.08))).toBeCloseTo(0.08, 12);
  // Hamming sits over a quarter of the depth in front of Hann.
  expect(W.depthOf(W.WINDOWS.hamming.end)).toBeGreaterThan(0.25);
  expect(W.named(0.08)).toBe("hamming");
  expect(W.named(0)).toBe("hann");
  expect(W.named(1)).toBe("rect");
  expect(W.named(0.5)).toBe(null);
  expect(W.CYCLES).toBe(6.5);
});
