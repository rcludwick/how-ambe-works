// lib/fft.js against numpy, in node: the transform, the magnitude spectrum
// of a zero-padded real block and the Hann window the tradeoff figure uses.
import { test, expect } from "@playwright/test";
import { fft, hann, isPowerOfTwo, magnitudes } from "../../docs/javascripts/lib/fft.js";

/** x[n] = sin(0.3 n) + 0.5 cos(1.1 n + 0.2), n = 0 to 9. */
const X10 = Array.from({ length: 10 }, (_, n) => Math.sin(0.3 * n) + 0.5 * Math.cos(1.1 * n + 0.2));

// numpy.fft.fft(numpy.concatenate([x, numpy.zeros(6)])), numpy 2.5.3.
const NUMPY_RE = [6.226909812664, -1.422090041976, -0.465403687234, 1.972157204726, -0.018597830648,
  0.282989715039, 0.133340719294, 0.247484079457, 0.153862492749, 0.247484079457, 0.133340719294,
  0.282989715039, -0.018597830648, 1.972157204726, -0.465403687234, -1.422090041976];
const NUMPY_IM = [0, -4.080387561909, 2.25459027669, -0.735133792839, -0.725909920335, -0.217965102489,
  -0.170611244167, -0.05936758156, 0, 0.05936758156, 0.170611244167, 0.217965102489, 0.725909920335,
  0.735133792839, -2.25459027669, 4.080387561909];
// numpy.abs(numpy.fft.rfft(x, 16)).
const NUMPY_ABS = [6.226909812664, 4.321099714525, 2.302124650804, 2.104715119328, 0.726148119702,
  0.357200174582, 0.216536241904, 0.254505165616, 0.153862492749];
// 0.5 - 0.5 * numpy.cos(2 * numpy.pi * (numpy.arange(8) + 0.5) / 8).
const NUMPY_HANN8 = [0.038060233744, 0.308658283817, 0.691341716183, 0.961939766256, 0.961939766256,
  0.691341716183, 0.308658283817, 0.038060233744];

test("fft matches numpy.fft.fft on a zero-padded block of 16", () => {
  const re = new Float64Array(16);
  const im = new Float64Array(16);
  re.set(X10);
  fft(re, im);
  for (let k = 0; k < 16; k += 1) {
    expect(re[k]).toBeCloseTo(NUMPY_RE[k], 10);
    expect(im[k]).toBeCloseTo(NUMPY_IM[k], 10);
  }
});

test("magnitudes matches numpy.abs(numpy.fft.rfft(x, 16)); a size that is not a power of two throws", () => {
  const m = magnitudes(X10, 16);
  expect(m).toHaveLength(9);
  for (let k = 0; k < 9; k += 1) expect(m[k]).toBeCloseTo(NUMPY_ABS[k], 10);
  expect(isPowerOfTwo(4096)).toBe(true);
  expect(isPowerOfTwo(3200)).toBe(false);
  expect(() => magnitudes(X10, 12)).toThrow(RangeError);
});

test("a 4096-point transform puts a tone on its bin, and Parseval holds", () => {
  const n = 4096;
  const x = Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 100 * i) / n));
  const m = magnitudes(x, n);
  expect(m[100]).toBeCloseTo(n / 2, 6);
  expect(Math.max(...m.slice(0, 100), ...m.slice(101))).toBeLessThan(1e-6);
  const re = new Float64Array(n).map((_, i) => Math.sin(i * 0.37) * Math.exp(-i / 900));
  const energy = re.reduce((s, v) => s + v * v, 0);
  const im = new Float64Array(n);
  fft(re, im);
  const spectral = re.reduce((s, v, k) => s + v * v + im[k] * im[k], 0) / n;
  expect(spectral).toBeCloseTo(energy, 8);
});

test("hann matches numpy, sampled at the centres of its samples", () => {
  const w = hann(8);
  for (let i = 0; i < 8; i += 1) expect(w[i]).toBeCloseTo(NUMPY_HANN8[i], 10);
});

/* ---------------------------------------------------------------------------
 * The tradeoff figure's model (anim-tradeoff.js), on its seeded sound. The
 * steps in docs/03-windows-and-frames.md quote these numbers.
 * ------------------------------------------------------------------------ */

const model = await import("../../docs/javascripts/anim-tradeoff.js");

/** The valley depth of the block holding `at` ms. @param {number} block @param {number} f0 @param {number} [at] */
const valley = (block, f0, at = 75) => {
  const r = model.rowAt(block, at);
  return model.insideVowel(block, r) ? model.valleyDepth(model.picture(f0, block).fine[r], f0) : null;
};

test("layout: strips half a block apart, the whole sound one strip; 4096 points, 128 columns to 2 kHz", () => {
  expect(model.layout(20)).toEqual({ block: 20, hop: 10, rows: 40 });
  expect(model.layout(5)).toEqual({ block: 5, hop: 2.5, rows: 160 });
  expect(model.layout(400)).toEqual({ block: 400, hop: 400, rows: 1 });
  expect(model.FINE).toBe(1025);
  const p = model.picture(120, 20);
  expect(p.cells).toHaveLength(40 * model.COLUMNS);
  expect(Math.max(...p.cells)).toBe(0);
  expect(Math.min(...p.cells)).toBe(model.FLOOR_DB);
  expect(model.blockSpan(20, model.rowAt(20, 75))).toEqual({ centre: 75, start: 65, end: 85 });
});

test("the sound: silence from 200 to 240 ms but for the click; the same samples on every call", () => {
  const x = model.sound(120);
  expect(x).toBe(model.sound(120));
  expect(x[1840]).toBe(60);
  for (let n = 1600; n < 1920; n += 1) if (n !== 1840) expect(x[n]).toBe(0);
  expect(Math.max(...x.slice(0, 1600).map(Math.abs))).toBeGreaterThan(5);
});

test("valley depths the steps quote, at 75 ms (seed 1)", () => {
  expect(valley(20, 120)).toBeCloseTo(7.04, 2);
  expect(valley(5, 120)).toBeCloseTo(0.16, 2);
  expect(valley(80, 120)).toBeGreaterThan(40);
  expect(valley(10, 80)).toBeCloseTo(0.5, 1);
  expect(valley(20, 80)).toBeCloseTo(1.62, 2);
  expect(valley(20, 150)).toBeCloseTo(11.47, 2);
  expect(valley(400, 120)).toBeNull();
});

test("the spread of valley depths over the vowels at 20 ms: 8.3 to 11.9 dB at 150 Hz, 2.0 to 7.7 dB at 120 Hz", () => {
  for (const [f0, lo, hi] of [[150, 8.3, 11.9], [120, 2.0, 7.7]]) {
    const p = model.picture(f0, 20);
    const depths = [];
    for (let r = 0; r < p.rows; r += 1) if (model.insideVowel(20, r)) depths.push(model.valleyDepth(p.fine[r], f0));
    expect(Math.min(...depths).toFixed(1)).toBe(lo.toFixed(1));
    expect(Math.max(...depths).toFixed(1)).toBe(hi.toFixed(1));
  }
});

test("an 80 Hz voice at the edge: 0.2 to 0.6 dB at 10 ms in every block, 0.4 to 1.7 dB at 20 ms with most under 1 dB", () => {
  const spread = (/** @type {number} */ block) => {
    const p = model.picture(80, block);
    const depths = [];
    for (let r = 0; r < p.rows; r += 1) if (model.insideVowel(block, r)) depths.push(model.valleyDepth(p.fine[r], 80));
    return depths;
  };
  const short = spread(10);
  expect(Math.min(...short).toFixed(1)).toBe("0.2");
  expect(Math.max(...short).toFixed(1)).toBe("0.6");
  const mid = spread(20);
  expect(Math.min(...mid).toFixed(1)).toBe("0.4");
  expect(Math.max(...mid).toFixed(1)).toBe("1.7");
  expect(mid.filter((d) => d < 1).length).toBeGreaterThan(mid.length / 2);
});

test("the click: a flat line in the 5 ms strips at 230 ms; at 80 ms it spreads over the strips from 200 to 280 ms", () => {
  const short = model.picture(120, 5);
  for (const r of [91, 92]) {
    const row = short.cells.slice(r * model.COLUMNS, (r + 1) * model.COLUMNS);
    expect(Math.max(...row) - Math.min(...row)).toBeLessThan(0.5);
    expect(Math.max(...row)).toBeGreaterThan(-20);
  }
  const clicked = [];
  for (let r = 0; r < model.layout(80).rows; r += 1) {
    const span = model.blockSpan(80, r);
    if (span.start <= model.CLICK_MS && span.end >= model.CLICK_MS) clicked.push([r * 40, (r + 1) * 40]);
  }
  expect(clicked).toEqual([[200, 240], [240, 280]]);
  expect(model.blockFacts(20)).toMatchObject({ resolution: 50, lobe: 200, hop: 10 });
  expect(model.blockFacts(400)).toMatchObject({ resolution: 2.5, lobe: 10, rows: 1 });
});

test("clickStrips, the span the 3D view brackets beside its time axis: 227.5 to 232.5 ms at 5 ms, 200 to 280 ms at 80 ms, all of it as one block", () => {
  expect(model.clickStrips(5)).toEqual({ start: 227.5, end: 232.5 });
  expect(model.clickStrips(20)).toEqual({ start: 220, end: 240 });
  expect(model.clickStrips(80)).toEqual({ start: 200, end: 280 });
  expect(model.clickStrips(400)).toEqual({ start: 0, end: 400 });
});
