// Pure helpers under docs/javascripts/lib/, run in node (no page).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mulberry32 } from "../../docs/javascripts/lib/prng.js";
import { PICKS, rankSteady, steadyScore, topSteady } from "../../docs/javascripts/lib/picks.js";

const frames = (/** @type {string} */ clip) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/frames.json`, import.meta.url), "utf8")).frames;

test("mulberry32 matches the reference sequence", () => {
  const r = mulberry32(1);
  expect([r(), r(), r()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  const s = mulberry32(0x20260810);
  expect(s()).toBe(0.784643278690055);
});

test("picks on the committed data", () => {
  /** @type {Record<string, (number | null)[]>} vowel, default, mixed, fricative, silence */
  const want = {
    "lr-b": [101, 102, 112, 141, 3], "lr-c": [19, 60, 60, 36, 96], "lj-c": [94, 69, 95, 24, 0],
    "lj-b": [11, 10, 26, 89, 2], "lr-a": [86, 84, 79, 12, 1], "lr-d": [23, 16, 10, null, 57],
  };
  for (const [clip, ids] of Object.entries(want)) {
    const f = frames(clip);
    const names = /** @type {const} */ (["vowel", "default", "mixed", "fricative", "silence"]);
    const got = names.map((k) => PICKS[k](f)?.i ?? null);
    expect(got, clip).toEqual(ids);
  }
  expect(steadyScore(frames("lr-b")[101])).toBeCloseTo(0.657, 3);
  expect(topSteady(frames("lj-b"), 4).map((f) => f.i)).toEqual([11, 10, 50, 49]);
  expect(rankSteady(frames("lr-d"))[3].i).toBe(34);
});

/* ---------------------------------------------------------------------------
 * lib/scene.js and lib/orbit.js, with three itself (it loads in node)
 * ------------------------------------------------------------------------ */

const THREE_URL = new URL("../../docs/javascripts/vendor/three/three.module.min.js", import.meta.url).href;

test("toScene: data to scene and back, centred, with a reversed axis", async () => {
  const { toScene } = await import("../../docs/javascripts/lib/scene.js");
  const map = toScene({ x: [0, 4000], y: [-85, 0], z: [3.7, 0] }, { x: 4, y: 1.5, z: 3 });
  expect(map.box).toEqual({ min: [-2, -0.75, -1.5], max: [2, 0.75, 1.5] });
  expect(map.point(0, -85, 3.7)).toEqual([-2, -0.75, -1.5]);
  expect(map.point(4000, 0, 0)).toEqual([2, 0.75, 1.5]);
  for (const [x, y, z] of [[1234.5, -40.25, 1.1], [0, 0, 0], [4000, -85, 3.7]]) {
    expect(map.invert.x(map.x(x))).toBeCloseTo(x, 9);
    expect(map.invert.y(map.y(y))).toBeCloseTo(y, 9);
    expect(map.invert.z(map.z(z))).toBeCloseTo(z, 9);
  }
});

for (const size of [{ width: 1280 - 64, height: 560 }, { width: 375 - 32, height: 260 }]) {
  test(`matchPlot: the front preset puts the box corners on the plot rect corners, frame ${size.width} px`, async () => {
    const T = await import(THREE_URL);
    const { createPlot } = await import("../../docs/javascripts/anim-core.js");
    const { FRONT, createOrbit, matchPlot } = await import("../../docs/javascripts/lib/orbit.js");
    const plot = createPlot(size, { xDomain: [0, 4000], yDomain: [-85, 0], padding: { left: 40, bottom: 30 } });
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    /** @type {(() => void)[]} */
    const fits = [];
    const frame = { clientWidth: size.width, clientHeight: size.height, addEventListener: () => {} };
    const ctx = /** @type {any} */ ({
      three: T, camera, frame, parked: false, signal: new AbortController().signal,
      requestRender: () => {}, onResize: (/** @type {() => void} */ f) => fits.push(f),
    });
    // A box of another shape than the plot, off the origin.
    const box = { min: /** @type {[number, number, number]} */ ([1, -2, -1]), max: /** @type {[number, number, number]} */ ([4, 0.5, 2]) };
    const fitted = matchPlot(ctx, plot.area, box);
    const orbit = createOrbit(ctx, { target: fitted.target, fit: fitted.fit, distance: 6, zoom: 1, presets: { front: FRONT }, start: "front" });
    expect(orbit.pose()).toEqual(FRONT);
    camera.updateMatrixWorld();
    const project = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
      const v = new T.Vector3(x, y, z).project(camera);
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
    };
    const { left, right, top, bottom } = plot.area;
    for (const z of [box.min[2], box.max[2]]) {
      const corners = [project(1, -2, z), project(4, -2, z), project(1, 0.5, z), project(4, 0.5, z)];
      const want = [[left, bottom], [right, bottom], [left, top], [right, top]];
      corners.forEach(([px, py], i) => {
        expect(Math.abs(px - want[i][0])).toBeLessThan(0.5);
        expect(Math.abs(py - want[i][1])).toBeLessThan(0.5);
      });
    }
    // The fit runs again on a resize.
    expect(fits).toHaveLength(1);
  });
}

test("axisLabels: a name and ticks per axis, along its edge", async () => {
  const { toScene } = await import("../../docs/javascripts/lib/scene.js");
  const { axisLabels } = await import("../../docs/javascripts/lib/labels.js");
  const map = toScene({ x: [0, 4000], y: [-80, 0], z: [0, 1] }, { x: 4, y: 2, z: 2 });
  const labels = axisLabels(map.box, map, [
    { axis: "x", name: "frequency (Hz)", ticks: [0, 2000, 4000] },
    { axis: "y", name: "level (dBFS)", ticks: [-80, 0], format: (v) => `${v}` },
    { axis: "z", name: "time (s)" },
  ]);
  expect(labels.map((l) => l.text)).toEqual(["0", "2000", "4000", "frequency (Hz)", "-80", "0", "level (dBFS)", "time (s)"]);
  expect(labels[1].at).toEqual([0, -1, 1]);
  expect(labels[4].at).toEqual([-2, -1, 1]);
  expect(labels[7].at).toEqual([2, -1, 0]);
  expect(labels.filter((l) => l.tick)).toHaveLength(5);
});

/** A ThreeContext stand-in for the scene helpers: tokens by name, no page. */
async function fakeContext() {
  const T = await import(THREE_URL);
  /** @type {Record<string, number>} */
  const tokens = { "--ambe-plot-bg": 0x000000, "--ambe-plot-ink": 0xffffff, "--ambe-plot-grid": 0x333333, "--ambe-plot-axis": 0x666666 };
  return /** @type {any} */ ({
    three: T,
    token: (/** @type {string} */ name) => ({ hex: tokens[name], opacity: 1 }),
    paint: (/** @type {any} */ material, /** @type {string} */ name) => {
      material.color.setHex(tokens[name]);
      material.userData.token = name;
      return material;
    },
  });
}

test("scene helpers (not curveFamily): one draw call each, the right vertex counts, colours from tokens", async () => {
  const S = await import("../../docs/javascripts/lib/scene.js");
  const ctx = await fakeContext();
  // curveFamily reads tokens and print through the page: style.spec.js.

  const field = S.heightField(ctx, [0, 1, 2], [0, 1], [[0, 1, 0], [1, 2, 1]], { token: "--ambe-plot-ink", fill: "--ambe-plot-grid" });
  expect(field.children).toHaveLength(2);
  expect(field.children[0].geometry.getAttribute("position").count).toBe(2 * (2 * 2 + 1 * 3));
  expect(field.children[1].geometry.getIndex().count).toBe(2 * 3 * 2);
  expect(field.children[1].material.polygonOffset).toBe(true);

  const stems = S.stems(ctx, [{ x: 0, y0: 0, y1: 1, z: 0 }, { x: 1, y0: 0, y1: 2, z: 0 }], { token: "--ambe-plot-ink" });
  expect(Array.from(stems.geometry.getAttribute("position").array)).toEqual([0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 2, 0]);

  const frame = S.axisFrame(ctx, { min: [-1, -1, -1], max: [1, 1, 1] }, { xs: [0], ys: [0], zs: [0] });
  expect(frame.children.map((c) => c.material.userData.token)).toEqual(["--ambe-plot-grid", "--ambe-plot-axis"]);
  expect(frame.children[0].geometry.getAttribute("position").count).toBe(8);

  const buffer = S.lineBuffer(ctx, 4, "--ambe-plot-ink");
  expect(buffer.geometry.drawRange.count).toBe(0);
  S.writePoints(buffer, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
  expect(buffer.geometry.drawRange.count).toBe(4);
  expect(buffer.geometry.getAttribute("position").getX(3)).toBe(3);
});
