// anim-listen-terrain.js's arithmetic, in Node, against tools/listen-stats.py
// --json (three-everywhere plan N8): the harmonic profile, the peak above
// valley, the band deltas, and the steps' picks.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CLIPS, PICKS, bandDeltas, harmonicProfile, prepare } from "../../docs/javascripts/anim-listen-terrain.js";

const ROOT = new URL("../../", import.meta.url);
/** @param {string} clip @param {string} name */
const read = (clip, name) => JSON.parse(readFileSync(new URL(`docs/assets/data/${clip}/${name}.json`, ROOT), "utf8"));
/** @type {any} */
// Python writes NaN for a band over no frames (lr-d has no unpitched frame).
const STATS = JSON.parse(execFileSync("python3", [new URL("tools/listen-stats.py", ROOT).pathname, "--json"], { encoding: "utf8" })
  .replace(/\bNaN\b/g, "null"));

for (const { id } of CLIPS) {
  test(`${id}: the harmonic profile and peak above valley match tools/listen-stats.py`, () => {
    const spectra = read(id, "spectra");
    const frames = read(id, "frames");
    const got = harmonicProfile(spectra, frames.frames.map((/** @type {any} */ f) => f.derived));
    const want = STATS.clips.find((/** @type {any} */ c) => c.id === id).peak_above_valley;
    expect(got.frames).toBe(want.frames);
    expect(got.u).toHaveLength(want.u.length);
    got.original.forEach((v, k) => expect(v).toBeCloseTo(want.original[k], 9));
    got.decoded.forEach((v, k) => expect(v).toBeCloseTo(want.decoded[k], 9));
    got.harmonics.forEach((h, j) => expect(h.deeper_db).toBeCloseTo(want.harmonics[j].deeper_db, 9));
    expect(got.deeper_db[0]).toBeCloseTo(want.deeper_db[0], 9);
    expect(got.deeper_db[1]).toBeCloseTo(want.deeper_db[1], 9);
  });

  test(`${id}: the band deltas over the energetic frames match tools/listen-stats.py`, () => {
    const data = prepare(read(id, "spectra"), read(id, "frames"));
    const want = STATS.clips.find((/** @type {any} */ c) => c.id === id).bands_all;
    data.bands.forEach((b, j) => {
      expect([b.lo, b.hi]).toEqual([want[j].lo, want[j].hi]);
      expect(b.energy_db).toBeCloseTo(want[j].energy_db, 9);
    });
    const rows = [];
    for (let i = 0; i < data.n; i += 1) if (data.energetic[i]) rows.push(i);
    expect(rows).toHaveLength(STATS.clips.find((/** @type {any} */ c) => c.id === id).energetic_frames);
    expect(bandDeltas(read(id, "spectra"), rows)).toEqual(data.bands);
  });
}

test("the steps' picks: the loudest frame with a pitch in both files, the loudest with none in the original", () => {
  /** @type {Record<string, [number, number]>} */
  const expected = { "lr-b": [8, 79], "lr-c": [16, 36], "lj-c": [86, 24], "lj-b": [123, 89] };
  for (const [clip, [pitched, unpitched]] of Object.entries(expected)) {
    const data = prepare(read(clip, "spectra"), read(clip, "frames"));
    const p = PICKS["loudest-pitched"](data);
    const u = PICKS["loudest-unpitched"](data);
    expect([p, u], clip).toEqual([pitched, unpitched]);
    expect(p === null || (data.f0o[p] > 0 && data.f0d[p] > 0 && data.energetic[p] === 1)).toBe(true);
    expect(u === null || (data.f0o[u] <= 0 && data.energetic[u] === 1)).toBe(true);
  }
});

test("quiet frames are masked: no difference where the original is below -40 dBFS", () => {
  const data = prepare(read("lr-c", "spectra"), read("lr-c", "frames"));
  let masked = 0;
  for (let i = 0; i < data.n; i += 1) {
    if (data.energetic[i]) continue;
    masked += 1;
    for (let k = 0; k < data.bins; k += 1) expect(data.diff[i * data.bins + k]).toBe(0);
  }
  expect(masked).toBeGreaterThan(0);
});

test("the figure's modules never read the measured .hex field", () => {
  for (const name of ["anim-listen-terrain.js", "anim-listen-terrain-3d.js"]) {
    const source = readFileSync(new URL(`docs/javascripts/${name}`, ROOT), "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(source, name).not.toMatch(/\.hex\b|frameHex|hexBits/);
  }
});
