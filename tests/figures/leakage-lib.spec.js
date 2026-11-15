// lib/leakage.js, the leakage figure's model (three-everywhere design §5.2):
// the pinned numbers, with phase 0 as the figure states it, and a phase
// pi/2 check that shows why the phase has to be stated. Reference values
// from numpy's rfft of the same blocks.
import { test, expect } from "@playwright/test";
import * as L from "../../docs/javascripts/lib/leakage.js";

/** @param {ArrayLike<number>} db @param {number} from @param {number} to */
const round1 = (db, from, to) => Array.from(db).slice(from, to).map((v) => Number(v.toFixed(1)));

test("the block: 160 samples, 81 bins of 50 Hz, 21 rows from 6.00 to 7.00 cycles", () => {
  expect(L.N).toBe(160);
  expect(L.BINS).toBe(81);
  expect(L.BIN_HZ).toBe(50);
  expect(L.ROWS).toBe(21);
  expect(L.rowCycles(0)).toBe(6);
  expect(L.rowCycles(10)).toBe(6.5);
  expect(L.rowCycles(20)).toBe(7);
  expect(L.cyclesRow(6.5)).toBe(10);
  expect(L.cyclesRow(6.549)).toBe(11);
  expect(L.WEAK_BIN).toBe(30);
});

test("on a whole number of cycles, rectangular: one bin, every other at the floor", () => {
  for (const c of [6, 7]) {
    const db = L.spectrumDb(c, "rect");
    expect(L.binsAbove(db, L.FLOOR_DB)).toBe(1);
    expect(db[c]).toBe(0);
  }
  expect(L.jointStep(6, "rect")).toBeLessThan(1e-12);
});

test("rectangular at 6.50 cycles: all 81 bins above -40 dB, and a step of 2 at each joint", () => {
  const db = L.spectrumDb(6.5, "rect");
  expect(L.binsAbove(db, -40)).toBe(81);
  expect(Math.min(...db)).toBeCloseTo(-34.45, 2);
  expect(L.jointStep(6.5, "rect")).toBeCloseTo(2, 12);
});

test("phase 0 leaks unevenly: 50 bins above -60 dB at 6.1 cycles, 81 at 6.9", () => {
  expect(L.binsAbove(L.spectrumDb(6.1, "rect"), -60)).toBe(50);
  expect(L.binsAbove(L.spectrumDb(6.9, "rect"), -60)).toBe(81);
  expect(L.binsAbove(L.spectrumDb(6.1, "rect"), -40)).toBe(13);
  expect(L.binsAbove(L.spectrumDb(6.9, "rect"), -40)).toBe(16);
});

test("phase pi/2 (a sine) leaks differently: 6.1 and 6.9 match, 6.50 has 27 bins above -40 dB and no step", () => {
  const phase = Math.PI / 2;
  expect(L.binsAbove(L.spectrumDb(6.1, "rect", { phase }), -40)).toBe(21);
  expect(L.binsAbove(L.spectrumDb(6.9, "rect", { phase }), -40)).toBe(21);
  expect(L.binsAbove(L.spectrumDb(6.5, "rect", { phase }), -40)).toBe(27);
  // A sine that starts at zero ends at zero on half a cycle: the step is in
  // its slope, not its value. The figure uses a cosine for that reason.
  expect(L.jointStep(6.5, "rect", { phase })).toBeLessThan(1e-12);
});

test("the weak tone is buried under the rectangular skirts at 6.50", () => {
  const db = L.spectrumDb(6.5, "rect", { weak: true });
  expect(round1(db, 28, 33)).toEqual([-28.4, -28.7, -28.4, -29.3, -29.6]);
});

test("Hann at 6.50 with the weak tone: bins 28 to 32 at -86.6, -55.1, -49.0, -55.1, -90.8 dB", () => {
  const db = L.spectrumDb(6.5, "hann", { weak: true });
  expect(round1(db, 28, 33)).toEqual([-86.6, -55.1, -49, -55.1, -90.8]);
  // Without it the skirt there runs on down.
  expect(round1(L.spectrumDb(6.5, "hann"), 28, 33)).toEqual([-86.6, -87.7, -88.8, -89.8, -90.8]);
  expect(L.jointStep(6.5, "hann")).toBe(0);
});

test("the price: on a bin, Hann gives three bins, the two beside the peak at -6.02 dB", () => {
  const db = L.spectrumDb(6, "hann");
  expect(L.binsAbove(db, L.FLOOR_DB)).toBe(3);
  expect(db[6]).toBe(0);
  expect(db[5]).toBeCloseTo(-6.02, 2);
  expect(db[7]).toBeCloseTo(-6.02, 2);
});

test("the field is cached and its rows are the spectra", () => {
  const rows = L.field("rect", false);
  expect(rows).toHaveLength(21);
  expect(L.field("rect", false)).toBe(rows);
  expect(Array.from(rows[10])).toEqual(Array.from(L.spectrumDb(6.5, "rect")));
  expect(L.field("hann", true)[10][30]).toBeCloseTo(-49.0, 1);
});
