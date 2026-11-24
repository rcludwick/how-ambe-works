// lib/fec.js (plan N6, design §5.6): the numbers the fec-protection figure
// and its steps state. Pure arithmetic, run in Node.
import { test, expect } from "@playwright/test";
import {
  CODES, FRAME_BITS, INTERLEAVER, INTERLEAVER_BARE, MIN_SEPARATION, VECTORS,
  airOrder, burstResult, chipText, cosetMean, failCurve, failProb, groupCode, minSeparation, vectorCode,
} from "../../docs/javascripts/lib/fec.js";

test("the patent's assignment: four Golay, three Hamming, one bare, 88 payload bits in 144", () => {
  expect(VECTORS.map((v) => v.payload)).toEqual([12, 12, 12, 12, 11, 11, 11, 7]);
  expect(VECTORS.map((_, v) => vectorCode(v, "patent").n)).toEqual([23, 23, 23, 23, 15, 15, 15, 7]);
  expect(VECTORS.map((_, v) => vectorCode(v, "patent").t)).toEqual([3, 3, 3, 3, 1, 1, 1, 0]);
  expect(VECTORS.map((_, v) => vectorCode(v, "none").n)).toEqual([12, 12, 12, 12, 11, 11, 11, 7]);
  expect(VECTORS.map((_, v) => vectorCode(v, "none").t)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  expect(FRAME_BITS).toEqual({ patent: 144, none: 88 });
  expect(VECTORS.map((v) => v.name)).toEqual(["u₀", "u₁", "u₂", "u₃", "u₄", "u₅", "u₆", "u₇"]);
});

test("failure chances: the values the steps and the caption state", () => {
  const golay = CODES.golay;
  const hamming = CODES.hamming;
  /** @param {number} x */
  const sig = (x) => Number(x.toPrecision(4));
  // At 5%: u0 bare 46%, Golay 2.6%, Hamming 17%, the bare u7 30%.
  expect(sig(failProb(12, 0, 0.05))).toBe(0.4596);
  expect(sig(failProb(golay.n, golay.t, 0.05))).toBe(0.02581);
  expect(sig(failProb(hamming.n, hamming.t, 0.05))).toBe(0.171);
  expect(sig(failProb(7, 0, 0.05))).toBe(0.3017);
  // At 1%: Golay 7.6 in 100,000, Hamming 0.96%, bare 12 bits 11%.
  expect(sig(failProb(golay.n, golay.t, 0.01))).toBe(0.00007605);
  expect(sig(failProb(hamming.n, hamming.t, 0.01))).toBe(0.00963);
  expect(sig(failProb(12, 0, 0.01))).toBe(0.1136);
  // At 10%.
  expect(sig(failProb(golay.n, golay.t, 0.1))).toBe(0.1927);
  expect(sig(failProb(hamming.n, hamming.t, 0.1))).toBe(0.451);
  expect(sig(failProb(7, 0, 0.1))).toBe(0.5217);
  // The tail agrees with one minus the head.
  for (const p of [0.001, 0.02, 0.07]) {
    let head = 0;
    for (let e = 0; e <= 3; e += 1) {
      let c = 1;
      for (let i = 1; i <= e; i += 1) c = (c * (23 - e + i)) / i;
      head += c * p ** e * (1 - p) ** (23 - e);
    }
    expect(Math.abs(failProb(23, 3, p) - (1 - head))).toBeLessThan(1e-12);
  }
  expect(failProb(23, 3, 0)).toBe(0);
});

test("coset expectations: 2.85 per Golay, 0.94 per Hamming, about 11.4 of 12 for u1 to u6", () => {
  expect(cosetMean(CODES.golay)).toBeCloseTo(5842 / 2048, 12);
  expect(cosetMean(CODES.golay).toFixed(2)).toBe("2.85");
  expect(cosetMean(CODES.hamming)).toBe(15 / 16);
  expect(cosetMean(CODES.hamming).toFixed(2)).toBe("0.94");
  // Perfect codes: the spheres of radius t fill the space, one per coset.
  for (const code of [CODES.golay, CODES.hamming]) {
    let sum = 0;
    for (let w = 0; w <= code.t; w += 1) {
      let c = 1;
      for (let i = 1; i <= w; i += 1) c = (c * (code.n - w + i)) / i;
      sum += c;
    }
    expect(sum).toBe(2 ** (code.n - code.k));
  }
  const r = burstResult({ mode: "patent", interleave: false, start: 0, length: 4 });
  expect(r.wrongKey).toBe(true);
  expect(r.counted.toFixed(1)).toBe("11.4");
  expect(r.countedMax).toBe(12);
  expect(r.vectors[0]).toMatchObject({ e: 4, fails: true, counted: 3 });
  expect(chipText(r)).toBe("Golay u₀: 4 errors, corrects 3");
});

test("interleaver: each vector's bits, and at least 6 positions between two of one codeword, over all 144", () => {
  expect(INTERLEAVER).toHaveLength(144);
  expect(INTERLEAVER_BARE).toHaveLength(88);
  for (const [mode, text] of /** @type {const} */ ([["patent", INTERLEAVER], ["none", INTERLEAVER_BARE]])) {
    const counts = [0, 1, 2, 3, 4, 5, 6, 7].map((v) => [...text].filter((c) => Number(c) === v).length);
    expect(counts).toEqual(VECTORS.map((_, v) => vectorCode(v, mode).n));
    const order = airOrder(mode, true);
    // Brute force, every pair of positions.
    let worst = Infinity;
    for (let a = 0; a < order.length; a += 1) {
      for (let b = a + 1; b < order.length; b += 1) {
        if (order[a].v === order[b].v) worst = Math.min(worst, b - a);
      }
    }
    expect(worst).toBeGreaterThanOrEqual(MIN_SEPARATION);
    expect(minSeparation(order)).toBe(worst);
    // A permutation: every vector bit once.
    const seen = new Set(order.map((s) => `${s.v}:${s.j}`));
    expect(seen.size).toBe(order.length);
  }
  // Without interleaving the codewords go out one after another.
  expect(minSeparation(airOrder("patent", false))).toBe(1);
  expect(airOrder("patent", false).slice(22, 24)).toEqual([{ v: 0, j: 22 }, { v: 1, j: 0 }]);
});

test("any burst of 6 hits each codeword at most once; a burst of 7 can put two in a Hamming word", () => {
  for (let start = 0; start <= 138; start += 1) {
    const r = burstResult({ mode: "patent", interleave: true, start, length: 6 });
    expect(Math.max(...r.vectors.map((v) => v.e))).toBe(1);
  }
  // The default burst of the first two steps.
  const seven = burstResult({ mode: "patent", interleave: true, start: 57, length: 7 });
  expect(seven.vectors.map((v) => v.e)).toEqual([1, 1, 1, 1, 2, 0, 1, 0]);
  expect(seven.vectors.map((v) => v.fails)).toEqual([false, false, false, false, true, false, false, false]);
  expect(seven.subject).toBe(4);
  expect(chipText(seven)).toBe("Hamming u₄: 2 errors, corrects 1");
  expect(seven.wrongKey).toBe(false);
  // With no code, the same burst damages every vector it touches.
  const bare = burstResult({ mode: "none", interleave: true, start: 57, length: 7 });
  expect(bare.frameBits).toBe(88);
  expect(bare.vectors.map((v) => v.e)).toEqual([1, 1, 2, 0, 1, 1, 1, 0]);
  expect(bare.vectors.filter((v) => v.fails)).toHaveLength(6);
  expect(chipText(bare)).toBe("Bare u₂: 2 errors, corrects 0");
  // Step 4: without interleaving, six in a row land in u4 and overrun it.
  const off = burstResult({ mode: "patent", interleave: false, start: 98, length: 6 });
  expect(off.vectors[4].e).toBe(6);
  expect(off.vectors.filter((v) => v.fails)).toHaveLength(1);
  expect(chipText(off)).toBe("Hamming u₄: 6 errors, corrects 1");
  const on = burstResult({ mode: "patent", interleave: true, start: 98, length: 6 });
  expect(on.vectors.some((v) => v.fails)).toBe(false);
});

test("burstResult clamps the burst into the frame", () => {
  const r = burstResult({ mode: "none", interleave: false, start: 120, length: 7 });
  expect(r.start).toBe(81);
  expect(r.errors.map((e) => e.pos)).toEqual([81, 82, 83, 84, 85, 86, 87]);
  expect(burstResult({ mode: "patent", interleave: true, start: 3, length: 0 }).errors).toEqual([]);
  expect(burstResult({ mode: "patent", interleave: true, start: 3, length: 0 }).subject).toBe(0);
});

test("failCurve starts on the axis floor and rises", () => {
  const curve = failCurve(groupCode(0, "patent"), 0.1, 1e-5);
  expect(curve[0][1]).toBe(1e-5);
  expect(curve[0][0]).toBeGreaterThan(0.005);
  expect(curve[0][0]).toBeLessThan(0.007);
  for (let i = 1; i < curve.length; i += 1) expect(curve[i][1]).toBeGreaterThanOrEqual(curve[i - 1][1]);
  expect(curve.at(-1)?.[0]).toBeCloseTo(0.1, 12);
});
