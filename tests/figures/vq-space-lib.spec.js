// lib/vq.js on the seeded cloud, run in node (no page). The literals are
// the plan's measured facts; a difference means the code changed.
import { test, expect } from "@playwright/test";
import * as V from "../../docs/javascripts/lib/vq.js";

/** @type {[number, number, number, number, number, number[], number, number][]} */
const CASES = [
  // dims, bits, rho, grid mse, empty, first three Lloyd mses, converged mse, used at the grid start
  [2, 4, 0.5, 0.0154, 7, [0.0056, 0.0037, 0.0030], 0.0024, 9],
  [2, 4, 0.9, 0.0164, 10, [0.0039, 0.0018, 0.0012], 0.0006, 6],
  [3, 6, 0.5, 0.0175, 43, [0.0054, 0.0037, 0.0031], 0.0025, 21],
  [3, 6, 0.9, 0.0183, 55, [0.0024, 0.0013, 0.0009], 0.0004, 9],
];

for (const [dims, bits, rho, gridMse, empty, first3, done, startUsed] of CASES) {
  test(`${dims} numbers, ${bits} bits, stretch ${rho}`, () => {
    const pts = V.makeCloud({ rho, angleDeg: 45 });
    const grid = V.gridQuantize(pts, dims, bits);
    expect(grid.mse.toFixed(4)).toBe(gridMse.toFixed(4));
    expect(grid.empty).toBe(empty);
    const cb = V.gridCodebook(pts, dims, bits);
    const start = V.codebookStats(pts, dims, cb);
    expect(start.mse.toFixed(4)).toBe(gridMse.toFixed(4)); // the codebook starts as the grid
    expect(start.used).toBe(startUsed);
    for (const want of first3) {
      V.lloydStep(pts, dims, cb);
      expect(V.codebookStats(pts, dims, cb).mse.toFixed(4)).toBe(want.toFixed(4));
    }
    V.train(pts, dims, cb, 17);
    const end = V.codebookStats(pts, dims, cb);
    expect(end.mse.toFixed(4)).toBe(done.toFixed(4));
    expect(end.used).toBe(end.cells);
  });
}

test("the cloud is deterministic and the 2-number view is its first two coordinates", () => {
  const a = V.makeCloud({ rho: 0.5, angleDeg: 45 });
  const b = V.makeCloud({ rho: 0.5, angleDeg: 45 });
  expect(Array.from(a)).toEqual(Array.from(b));
  expect(a.length).toBe(3600);
});

test("the probe off the cloud pays for the codebook's saving", () => {
  const pts = V.makeCloud({ rho: 0.9, angleDeg: 45 });
  const cb = V.gridCodebook(pts, 2, 4);
  V.train(pts, 2, cb);
  const grid = V.gridCodebook(pts, 2, 4);
  expect(V.nearest([0.7, -0.7], cb.codebook, 2).mse.toFixed(4)).toBe("0.4475");
  expect(V.nearest([0.7, -0.7], grid.codebook, 2).mse.toFixed(4)).toBe("0.0025");
  let mx = 0;
  let my = 0;
  for (let i = 0; i < V.CLOUD_SIZE; i += 1) {
    mx += pts[i * 3] / V.CLOUD_SIZE;
    my += pts[i * 3 + 1] / V.CLOUD_SIZE;
  }
  expect([mx.toFixed(4), my.toFixed(4)]).toEqual(["-0.0062", "-0.0132"]);
  expect(V.nearest([mx, my], cb.codebook, 2).mse.toFixed(4)).toBe("0.0008");
});

for (const [dims, bits] of [[2, 2], [2, 4], [2, 6], [3, 3], [3, 6]]) {
  test(`cell colours: no two touching cells alike, ${dims} numbers, ${bits} bits`, () => {
    const m = 2 ** (bits / dims);
    /** @param {number[]} q */
    const index = (q) => q.reduce((k, v) => k * m + v, 0);
    /** @type {number[][]} */
    const cells = [];
    for (let k = 0; k < m ** dims; k += 1) {
      const q = [];
      let rest = k;
      for (let j = 0; j < dims; j += 1) { q.unshift(rest % m); rest = Math.floor(rest / m); }
      cells.push(q);
    }
    let pairs = 0;
    for (const a of cells) {
      for (const b of cells) {
        const near = a.every((v, j) => Math.abs(v - b[j]) <= 1) && a.some((v, j) => v !== b[j]);
        if (!near) continue;
        pairs += 1;
        expect(V.cellCategory(index(a), dims, bits)).not.toBe(V.cellCategory(index(b), dims, bits));
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });
}
