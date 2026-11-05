// The harmonic-sum figure's 3D view and walk-through (ch11, plan F13): the
// Front preset against the flat view, the first-view animation, the sum
// accumulating, Scaled phases, Play, and the reduced-motion and no-WebGL
// paths. Expected values come from the committed JSON through lib/.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as H from "../../docs/javascripts/lib/harmonics.js";
import { topSteadyPitched } from "../../docs/javascripts/lib/picks.js";
import { CUTOFF_HZ } from "../../docs/javascripts/lib/cutoff.js";
import { hook, snapToPixel } from "./helpers.js";

const STYLE_PATH = fileURLToPath(new URL("./screens.css", import.meta.url));
const PAGE = "11-synthesis/";
const HOST = '[data-anim="harmonic-sum"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;
const FLAT = `${HOST} canvas[data-ref="flat"]`;
const READOUT = `${HOST} output[data-ref="readout"]`;
/** The flat view's sum panel spans this many times the zero-phase peak, each way. */
const SUM_RANGE = 1.05;

const load = (/** @type {string} */ clip, /** @type {string} */ file) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/${file}.json`, import.meta.url), "utf8"));

/** The default frame of lj-b, as the figure shows it. */
function expected() {
  const frame = topSteadyPitched(load("lj-b", "frames").frames, 4)[0];
  const f0 = frame.derived.orig_f0_hz;
  const L = H.harmonicCount(f0, CUTOFF_HZ);
  const A = H.harmonicAmplitudes(load("lj-b", "spectra").original[frame.i], f0, L);
  /** @param {Float64Array} phi */
  const ratio = (phi) => H.peakToRms(H.samplePeriod(A, phi, L)).toFixed(2);
  return { L, A, maxA: Math.max(...A.slice(1)), ratio };
}

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only probe
  const p = window.__ambeAnim.figures["harmonic-sum"];
  return { state: p.state, numbers: p.numbers, playing: p.playing, caption: p.caption, step: p.step, layout: p.layout() };
});
/** @param {import("@playwright/test").Page} page */
const three = (page) => page.evaluate(() => {
  // @ts-ignore test-only probe
  const t = window.__ambeAnim.figures["harmonic-sum-3d"];
  return t ? { pose: t.pose, zoom: t.zoom, newest: t.newest, trip: t.trip, chip: t.chip, played: t.played, frontPoints: t.frontPoints,
    heights: t.ribbonMaxAbs(), ghost: t.ghost, crestOnSum: t.crestOnSum } : null;
});
/** @param {import("@playwright/test").Page} page */
const finish = async (page) => {
  // @ts-ignore test-only hook
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(250);
};

/**
 * @param {import("@playwright/test").Page} page
 * @param {{query?: string, three?: boolean}} [options]
 */
async function open(page, { query = "", three: want3d = true } = {}) {
  await page.goto(`${PAGE}${query}`);
  await page.locator(HOST).scrollIntoViewIfNeeded();
  await page.locator(`${HOST}.is-enhanced`).waitFor();
  await page.locator(`${HOST} .anim-hsum__frame`).scrollIntoViewIfNeeded();
  // @ts-ignore test-only probe
  await page.waitForFunction(() => window.__ambeAnim?.figures?.["harmonic-sum"]);
  if (want3d) {
    await page.locator(CANVAS_3D).waitFor();
    await expect.poll(async () => (await probe(page)).state.view).toBe("3d");
  }
}

/** @param {import("@playwright/test").Page} page */
const next = (page) => page.locator(`${HOST} [data-step="next"]`).click();

for (const size of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
  test(`Front puts the sum on the flat view's lower panel within 0.5 px at ${size.width}`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: size });
    await open(page);
    await next(page);
    await page.locator(`${HOST} button[data-preset="front"]`).click();
    await finish(page);
    const t = await three(page);
    const { layout } = await probe(page);
    const area = layout.sum;
    expect(area.width).toBeGreaterThan(100);
    expect(t?.zoom).toBe(1);
    for (const [u, v, x, y] of t?.frontPoints ?? []) {
      expect(Math.abs(x - (area.x + ((u + 1) / 2) * area.width)), `x at u ${u}`).toBeLessThan(0.5);
      expect(Math.abs(y - (area.y + ((SUM_RANGE - v) / (2 * SUM_RANGE)) * area.height)), `y at u ${u}`).toBeLessThan(0.5);
    }
    expect(t?.frontPoints.length).toBeGreaterThan(5);
    await page.close();
  });
}

test("first view: opens in 3D, the sum accumulates to every harmonic once, and lands on step 1's state at the corner", async ({ page }) => {
  // A fake clock from the start steps the first view frame by frame, whatever the load.
  // Each fake frame draws for real, which takes a while on a busy machine.
  test.setTimeout(120_000);
  await page.clock.install();
  await page.goto(PAGE);
  await page.locator(HOST).scrollIntoViewIfNeeded();
  await page.locator(`${HOST}.is-enhanced`).waitFor();
  await page.locator(`${HOST} .anim-hsum__frame`).scrollIntoViewIfNeeded();
  const want0 = expected();
  // Every harmonic is added in turn, the first leaving its slot for the
  // sum's plane, so the pulse forms; then the scene goes back to step 1's one.
  let most = 0;
  let tripped = false;
  for (let i = 0; i < 700 && most < want0.L; i += 1) {
    await page.clock.runFor(17);
    const t0 = await three(page);
    most = Math.max(most, t0?.newest.k ?? 0);
    if ((t0?.trip ?? 0) > (t0?.newest.z ?? 0) + 0.3) tripped = true;
  }
  expect(tripped).toBe(true);
  expect(most).toBe(want0.L);
  await finish(page);
  const t = await three(page);
  expect(t?.played).toBe(true);
  expect((await hook(page)).played["harmonic-sum"]).toBe(1);
  expect(t?.pose).toEqual({ yaw: -20, pitch: 30 });
  expect(t?.newest.k).toBe(1);
  expect(t?.chip).toBe("newest: harmonic 1");
  const want = expected();
  expect(Math.abs((t?.heights[1] ?? 0) - (0.55 * want.A[1]) / want.maxA)).toBeLessThan(1e-6);
  // It ends by pointing at Next, which adds the rest.
  // @ts-ignore test-only probe
  await expect.poll(() => page.evaluate(() => window.__ambeAnim.figures["harmonic-sum"].nudges)).toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(`${HOST} .anim-hsum__frame`).scrollIntoViewIfNeeded();
  expect((await hook(page)).played["harmonic-sum"]).toBe(1);
});

test("Next pressed as the opening turns from Front lands the corner on the fit the turn ends on", async ({ browser }) => {
  // A fake clock, so the press lands in the turn's first frames whatever the load.
  test.setTimeout(120_000);
  /** Where three scene points fall once Next has landed, pressed after `ms` of fake time. @param {number} ms */
  const shot = async (ms) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.clock.install();
    await page.goto(PAGE);
    await page.locator(`${HOST}.is-enhanced`).waitFor();
    await page.locator(`${HOST} .anim-hsum__frame`).scrollIntoViewIfNeeded();
    await page.locator(CANVAS_3D).waitFor();
    const start = (await three(page))?.pose;
    let turning = false;
    for (let t = 0; t < ms; t += 17) {
      await page.clock.runFor(17);
      const pose = (await three(page))?.pose;
      turning ||= pose?.yaw !== start?.yaw;
      if (ms < 1000 && turning) break;
    }
    expect(turning, "the opening's camera turn has begun").toBe(true);
    await next(page);
    await finish(page);
    await page.clock.runFor(1000);
    const points = await page.evaluate(() => [[0, 0, 0], [-1, 0, -0.5], [1, 0.3, 0.5]].map(
      // @ts-ignore test-only probe
      (at) => window.__ambeAnim.figures["harmonic-sum-3d"].screenOf(at)));
    await page.close();
    return points;
  };
  const early = await shot(900);
  const late = await shot(8000);
  for (const [i, p] of early.entries()) {
    expect(Math.abs(p.x - late[i].x), `x of point ${i}`).toBeLessThan(0.5);
    expect(Math.abs(p.y - late[i].y), `y of point ${i}`).toBeLessThan(0.5);
  }
});

test("Next to every harmonic adds them one at a time, the chip and readout following, and lands within 6 s", async ({ page }) => {
  const want = expected();
  // The frame and the Next button on screen together: a track below 25% visible lands at once.
  await page.setViewportSize({ width: 1280, height: 1800 });
  await open(page);
  await finish(page);
  // A fake clock, paused, so the build is stepped frame by frame whatever the load.
  // Each fake frame draws for real, which takes a while on a busy machine.
  test.setTimeout(180_000);
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  await page.locator(`${HOST} [data-step="next"]`).evaluate((b) => /** @type {HTMLElement} */ (b).click());
  const seen = [];
  /** @type {string[]} */
  const readouts = [];
  let ms = 0;
  for (; ms < 6000; ms += 100) {
    await page.clock.runFor(100);
    const t = await three(page);
    seen.push(t?.newest.k ?? 0);
    expect(t?.chip).toBe(`newest: harmonic ${t?.newest.k}`);
    readouts.push((await page.locator(READOUT).textContent()) ?? "");
    if (t?.newest.k === want.L) break;
  }
  // One at a time, in order, never all at once.
  const distinct = [...new Set(seen)];
  expect(distinct.length).toBeGreaterThan(8);
  expect(distinct).toEqual([...distinct].sort((a, b) => a - b));
  expect(readouts.some((r) => r.startsWith(`3 of ${want.L} harmonics`))).toBe(true);
  expect(ms).toBeGreaterThan(2000);
  expect(ms).toBeLessThan(6000);
  await finish(page);
  const t = await three(page);
  expect(t?.newest.k).toBe(want.L);
  expect(t?.chip).toBe(`newest: harmonic ${want.L}`);
  await expect(page.locator(READOUT)).toContainText(`${want.L} of ${want.L} harmonics`);
  expect(t?.heights.length).toBe(want.L + 1);
  for (let k = 1; k <= want.L; k += 1) {
    expect(Math.abs((t?.heights[k] ?? 0) - (0.55 * want.A[k]) / want.maxA), `k=${k}`).toBeLessThan(1e-6);
  }
  // Every crest at t = 0, and the crest line lands on the sum's pulse there.
  expect(t?.crestOnSum?.[0]).toBe(0);
  expect(t?.crestOnSum?.[1]).toBeCloseTo(0.9, 6);
  expect(t?.ghost).toBe(false);
});

test("a reader's input during the build lands it on every harmonic", async ({ page }) => {
  const want = expected();
  await page.setViewportSize({ width: 1280, height: 1800 });
  await open(page);
  await finish(page);
  test.setTimeout(120_000);
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  await page.locator(`${HOST} [data-step="next"]`).evaluate((b) => /** @type {HTMLElement} */ (b).click());
  await page.clock.runFor(700);
  expect((await three(page))?.newest.k).toBeLessThan(want.L);
  await page.locator(`${HOST} .anim-hsum__frame`).dispatchEvent("pointerdown");
  await page.clock.runFor(50);
  const t = await three(page);
  expect(t?.newest.k).toBe(want.L);
  await expect(page.locator(READOUT)).toContainText(`${want.L} of ${want.L} harmonics`);
});

test("Random: the zero-phase sum shows dashed behind the sum, and the crest line leaves t = 0", async ({ page }) => {
  await open(page);
  await next(page);
  await finish(page);
  expect((await three(page))?.ghost).toBe(false);
  await page.locator(`${HOST} input[value="random"]`).check();
  await finish(page);
  const t = await three(page);
  expect(t?.ghost).toBe(true);
  expect(t?.crestOnSum?.[0]).toBe(0);
  expect(Math.abs(t?.crestOnSum?.[1] ?? 0)).toBeLessThan(0.85);
});

test("one more harmonic: it slides to the sum and back to its slot", async ({ page }) => {
  // The slider and the frame on screen together: a track below 25% visible lands at once.
  await page.setViewportSize({ width: 1280, height: 1800 });
  await open(page);
  await finish(page);
  // A fake clock steps the animation frame by frame, whatever the load.
  // Each fake frame draws for real, which takes a while on a busy machine.
  test.setTimeout(120_000);
  await page.clock.install();
  const n = page.locator(`${HOST} input[data-ref="n"]`);
  await n.fill("2");
  const zs = [];
  for (let i = 0; i < 90; i += 1) {
    await page.clock.runFor(17);
    zs.push((await three(page))?.newest.z ?? 0);
  }
  await finish(page);
  const t = await three(page);
  expect(t?.newest.k).toBe(2);
  expect(Math.max(...zs)).toBeGreaterThan((t?.newest.z ?? 0) + 0.3);
});

test("reduced motion: opens 2D, loads nothing 3D, and the 3D control lands on the end state", async ({ page }) => {
  // Tall enough that the frame shows beside the 3D control: a view draws
  // only while its frame is visible.
  await page.setViewportSize({ width: 1280, height: 1800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await open(page, { three: false });
  await page.waitForTimeout(500);
  await expect(page.locator(FLAT)).toBeVisible();
  expect(requests.filter((u) => /harmonic-sum-3d|vendor\/three/.test(u))).toEqual([]);
  await page.locator(`${HOST} button[data-view="3d"]`).click();
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await probe(page)).state.view).toBe("3d");
  const t = await three(page);
  expect(t?.played).toBe(false);
  expect((await hook(page)).played["harmonic-sum"]).toBeUndefined();
  expect(t?.newest.k).toBe(1);
  expect(t?.pose).toEqual({ yaw: -20, pitch: 30 });
});

test("?nowebgl: 2D only, the steps read there, and Play adds the harmonics one at a time in the flat view", async ({ page }) => {
  const want = expected();
  await open(page, { query: "?nowebgl", three: false });
  await expect(page.locator(`${HOST} button[data-view="3d"]`)).toBeDisabled();
  await expect(page.locator(`${HOST} .anim-figure__hint--webgl`)).toHaveText("3D needs WebGL 2");
  await page.locator(`${HOST} input[data-ref="scrub"]`).fill("2");
  await expect(page.locator(READOUT)).toContainText(`${want.L} of ${want.L} harmonics`);
  await page.locator(`${HOST} [data-step="prev"]`).click();
  await page.locator(`${HOST} [data-ref="play"]`).click();
  await expect.poll(async () => (await probe(page)).step, { timeout: 30_000 }).toBe(1);
  const counts = new Set();
  for (let i = 0; i < 12; i += 1) {
    counts.add((await probe(page)).state.n);
    await page.waitForTimeout(250);
  }
  // Several counts on the way up, not one jump.
  expect(counts.size).toBeGreaterThan(2);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
});

test("Scaled: the alpha slider shows, alpha 0 is All zero, alpha 1 is Random, and the stems never move", async ({ page }) => {
  const want = expected();
  await open(page);
  await next(page);
  await finish(page);
  const alphaRow = page.locator(`${HOST} [data-ref="scaled"]`);
  await expect(alphaRow).toBeHidden();
  await page.locator(`${HOST} input[value="scaled"]`).check();
  await expect(alphaRow).toBeVisible();
  await expect(alphaRow.locator(".anim-badge--illustrative")).toHaveCount(1);
  await expect(page.locator(`${HOST} button[data-ref="reroll"]`)).toBeEnabled();
  const alpha = page.locator(`${HOST} input[data-ref="alpha"]`);
  await alpha.fill("0");
  await expect(page.locator(READOUT)).toContainText(`peak-to-RMS ${want.ratio(H.phases(want.L, "zero", 0))}`);
  await alpha.fill("1");
  await expect(page.locator(READOUT)).toContainText(`peak-to-RMS ${want.ratio(H.phases(want.L, "random", 0))}`);
  await alpha.fill("0.5");
  await expect(page.locator(READOUT)).toContainText(`peak-to-RMS ${want.ratio(H.scaledPhases(want.L, 0.5, 0))}`);
  await expect(page.locator(READOUT)).toContainText("largest amplitude change 0.0 dB");
  await finish(page);
  const t = await three(page);
  for (let k = 1; k <= want.L; k += 1) {
    expect(Math.abs((t?.heights[k] ?? 0) - (0.55 * want.A[k]) / want.maxA), `k=${k}`).toBeLessThan(1e-6);
  }
  // The flat view: the stems panel does not change with alpha.
  await page.locator(`${HOST} button[data-view="3d"]`).click();
  await expect(page.locator(FLAT)).toBeVisible();
  const stems = () => page.locator(FLAT).evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
    // @ts-ignore test-only probe
    const r = window.__ambeAnim.figures["harmonic-sum"].layout().stems;
    const dpr = canvas.width / canvas.clientWidth;
    const data = canvas.getContext("2d")?.getImageData(0, 0, Math.round(r.width * dpr), Math.round(r.height * dpr)).data ?? [];
    let h = 2166136261;
    for (let j = 0; j < data.length; j += 1) h = Math.imul(h ^ data[j], 16777619);
    return h >>> 0;
  });
  // The first read moves the canvas off the GPU (Chrome does so for a
  // canvas that is read back), and the next draw can then differ from the
  // GPU's by an antialiased pixel; on the 16:10 frame the 3.7 kHz dashed
  // line had one. So read once, redraw, and compare two software draws.
  await stems();
  await alpha.fill("0.6");
  await page.waitForTimeout(100);
  const before = await stems();
  await alpha.fill("0.85");
  await page.waitForTimeout(100);
  expect(await stems()).toBe(before);
});

test("Play: captions a sentence at a time without citations, Pause, the step slider, and taking over", async ({ page }) => {
  await open(page);
  await finish(page);
  const play = page.locator(`${HOST} [data-ref="play"]`);
  const caption = page.locator(`${HOST} [data-ref="caption"]`);
  await expect(caption).toBeHidden();
  await play.click();
  await expect(play).toHaveText("Pause");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(caption).toBeVisible();
  await expect(caption).toHaveText(/^The frame gives the decoder a pitch and one amplitude per harmonic, and no phases\.$/);
  await expect(caption).not.toContainText("US 5,701,390");
  expect((await probe(page)).step).toBe(0);
  // The slider moves the walk-through on.
  await page.locator(`${HOST} input[data-ref="scrub"]`).fill("3");
  await expect.poll(async () => (await probe(page)).step).toBe(2);
  await expect(caption).toHaveText(/^Give each harmonic a random starting phase\.$/);
  expect((await probe(page)).playing).toBe(true);
  await play.click();
  await expect(play).toHaveText("Play");
  await expect(caption).toBeHidden();
  expect((await probe(page)).playing).toBe(false);
  // A press on the view hands the figure back.
  await play.click();
  await expect(play).toHaveText("Pause");
  await page.locator(CANVAS_3D).click();
  await expect(play).toHaveText("Play");
});

test("Play: step 2 adds the harmonics one at a time in 3D, captioned by the build", async ({ page }) => {
  const want = expected();
  await open(page);
  await finish(page);
  // A paused fake clock steps the walk-through, whatever the load.
  test.setTimeout(180_000);
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  await page.locator(`${HOST} [data-ref="play"]`).evaluate((b) => /** @type {HTMLElement} */ (b).click());
  await page.locator(`${HOST} input[data-ref="scrub"]`).fill("2");
  await page.clock.runFor(50);
  expect((await probe(page)).step).toBe(1);
  const counts = new Set();
  /** @type {[number, string][]} */
  const seen = [];
  for (let i = 0; i < 60; i += 1) {
    await page.clock.runFor(200);
    const k = (await three(page))?.newest.k ?? 0;
    counts.add(k);
    seen.push([k, (await probe(page)).caption ?? ""]);
    if (seen[seen.length - 1][1].startsWith("Their crests line up")) break;
  }
  expect(counts.size).toBeGreaterThan(8);
  expect(Math.max(...[...counts])).toBe(want.L);
  // The pulse is described only once every harmonic is in.
  for (const [k, caption] of seen) {
    if (k < want.L) expect(caption).toBe("Now every harmonic, each starting at phase zero.");
  }
  expect(seen[seen.length - 1][1]).toMatch(/^Their crests line up into one sharp pulse/);
});

test("Play under reduced motion: the steps' end states, no motion", async ({ page }) => {
  const want = expected();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { three: false });
  await page.locator(`${HOST} [data-ref="play"]`).click();
  await expect(page.locator(`${HOST} [data-ref="caption"]`)).toBeVisible();
  await expect.poll(async () => (await probe(page)).step, { timeout: 30_000 }).toBe(1);
  // Every harmonic at once: the end state, not a count rising.
  expect((await probe(page)).state.n).toBe(want.L);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
});

test("phone: the chip stays inside the frame at 1x and 6x", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });
  await open(page);
  await next(page);
  await finish(page);
  const zoomIn = page.locator(`${HOST} .anim-zoom button`, { hasText: "Zoom in" });
  for (const clicks of [0, 9]) {
    for (let i = 0; i < clicks; i += 1) {
      await zoomIn.click();
      await finish(page);
    }
    await page.locator(`${HOST} .anim-hsum__frame`).scrollIntoViewIfNeeded();
    const frame = await page.locator(`${HOST} .anim-hsum__frame`).boundingBox();
    if (!frame) throw new Error("no frame");
    const chip = await page.locator(`${HOST} .anim-chip`).boundingBox();
    if (!chip) throw new Error("no chip");
    expect(chip.x).toBeGreaterThanOrEqual(frame.x - 0.5);
    expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(chip.y).toBeGreaterThanOrEqual(frame.y - 0.5);
    expect(chip.y + chip.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.close();
});

test("screens: Scaled at alpha 0.5, in 3D and flat", async ({ page }) => {
  await open(page);
  await next(page);
  await page.locator(`${HOST} input[value="scaled"]`).check();
  await page.locator(`${HOST} input[data-ref="alpha"]`).fill("0.5");
  await finish(page);
  await page.waitForTimeout(300);
  const frame = page.locator(`${HOST} .anim-hsum__frame`);
  // On a whole pixel, whatever the step text above it: a frame at a
  // fractional offset takes a row of its neighbour into the shot.
  await snapToPixel(frame);
  await page.waitForTimeout(100);
  await expect(frame).toHaveScreenshot("harmonic-sum-scaled-3d-1280.png", { maxDiffPixelRatio: 0.01, stylePath: STYLE_PATH });
  await page.locator(`${HOST} button[data-view="3d"]`).click();
  await expect(page.locator(FLAT)).toBeVisible();
  await page.waitForTimeout(300);
  await expect(frame).toHaveScreenshot("harmonic-sum-scaled-2d-1280.png", { maxDiffPixels: 0, stylePath: STYLE_PATH });
});
