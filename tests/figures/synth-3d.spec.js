// The synth figure's 3D view (anim-synth-3d.js): the opening rule, the end
// state of its opening, Front equal to the flat spectrum panel, and the
// readouts the flat view shows.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "11-synthesis/";
const CANVAS_3D = '[data-anim="synth"] canvas.anim-figure__canvas--3d';
const DB_FLOOR = -95;
const DB_TOP = -8;

/** @param {import("@playwright/test").Page} page */
const host = (page) => page.locator('[data-anim="synth"]');

/** @param {import("@playwright/test").Page} page @param {string} expr */
const probe = (page, expr) => page.evaluate(`(() => { const p = window.__ambeAnim.figures["synth-3d"]; return ${expr}; })()`);

/**
 * Open in 3D (motion allowed), land the opening on its end, hold frame 98.
 * @param {import("@playwright/test").Page} page
 */
async function open(page) {
  await page.goto(PAGE);
  const h = host(page);
  // The frame itself in view: a phone's host is taller than the screen, and
  // the 3D view draws (and so finishes opening) only where it can be seen.
  await h.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
  await settle(page, h);
  await page.locator(CANVAS_3D).waitFor();
  await h.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
  await settle(page, h);
  await h.locator(".anim-range").first().evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("no range");
    el.value = "98";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await h.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
  await settle(page, h);
  return h;
}

/**
 * @param {import("@playwright/test").Locator} h
 * @param {number} mix
 */
async function setMix(h, mix) {
  await h.locator('[data-ref="mix"]').evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("no mix");
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, mix);
}

test("motion allowed: opens in 3D, plays the opening once, and ends on the split", async ({ page }) => {
  const h = await open(page);
  expect(await probe(page, "p.played")).toBe(1);
  expect(await page.evaluate(() => window.__ambeAnim?.played.synth)).toBe(1);
  await expect(h.locator('button[data-view="3d"]')).toHaveAttribute("aria-pressed", "true");
  await expect(h.locator(".anim-figure")).toHaveAttribute("data-view", "3d");
  // The end state: the Corner preset, and on the selected slice only the
  // harmonics of the voiced bands keep their sticks (frame 98: four, all
  // in the 0 to 500 Hz band).
  expect(await probe(page, "p.pose")).toEqual({ yaw: 32, pitch: 24 });
  const tips = /** @type {{f: number, db: number}[]} */ (await probe(page, "p.sliceTips()"));
  expect(tips).toHaveLength(4);
  for (const t of tips) expect(t.f).toBeLessThan(500);
  // The chip states the fact; the opening's own labels are gone.
  await expect(h.locator(".anim-chip").first()).toHaveText("this frame: 110.1 Hz, 1 of 8 bands voiced");
  await expect(h.locator(".synth-intro-labels")).toHaveCount(0);
  // Playback starts once the opening has ended.
  await expect(h.locator(".anim-btn--play")).toHaveText("Play");
});

test("the slice's sticks equal the model at mix 0, 50 and 100", async ({ page }) => {
  const h = await open(page);
  for (const mix of [0, 50, 100]) {
    await setMix(h, mix);
    await settle(page, h);
    const { tips, want } = await page.evaluate(async (m) => {
      const lib = await import(new URL("javascripts/lib/synth-model.js", document.baseURI.replace(/11-synthesis\/.*$/, "")).href);
      const base = document.baseURI.replace(/11-synthesis\/.*$/, "");
      const [frames, spectra] = await Promise.all(["frames", "spectra"].map((n) => fetch(`${base}assets/data/${n}.json`).then((r) => r.json())));
      const model = lib.buildFrameModel(frames.frames, spectra, 98);
      const w = lib.weights(m);
      const want = model.harmonics.filter((/** @type {any} */ x) => x.voiced && lib.linToDb(x.amp * w.v) > lib.DB_FLOOR)
        .map((/** @type {any} */ x) => ({ f: x.f, db: Math.min(lib.DB_TOP, lib.linToDb(x.amp * w.v)) }));
      // @ts-ignore test hook
      return { tips: window.__ambeAnim.figures["synth-3d"].sliceTips(), want };
    }, mix);
    expect(tips).toHaveLength(want.length);
    tips.forEach((/** @type {{f: number, db: number}} */ t, /** @type {number} */ i) => {
      expect(Math.abs(t.f - want[i].f)).toBeLessThan(1e-6 * 4000);
      expect(Math.abs(t.db - want[i].db)).toBeLessThan(1e-6 * 87);
    });
  }
});

for (const vp of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
  test(`Front at zoom 1 puts the stick tips on the flat panel's plot within 1 px (${vp.width} px)`, async ({ page }) => {
    await page.setViewportSize(vp);
    const h = await open(page);
    await h.locator('button[data-preset="front"]').click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    await settle(page, h);
    expect(await probe(page, "p.pose")).toEqual({ yaw: 0, pitch: 0 });
    expect(await probe(page, "p.zoom")).toBe(1);
    const tips = /** @type {{f: number, db: number}[]} */ (await probe(page, "p.sliceTips()"));
    const shown = /** @type {number[][]} */ (await probe(page, "p.frontPoints"));
    // The rectangle the flat view last painted its spectrum plot at (while
    // the 3D view loaded), on a canvas the size of the frame.
    const painted = /** @type {{x: number, y: number, width: number, height: number, canvas: {width: number, height: number}}} */ (
      await page.evaluate(() => /** @type {any} */ (window.__ambeAnim?.figures).synth.painted()));
    const box = await h.locator(".anim-figure__frame").evaluate((f) => ({ width: f.clientWidth, height: f.clientHeight }));
    expect(painted.canvas).toEqual(box);
    expect(painted.width).toBeGreaterThan(0);
    const rect = painted;
    expect(tips.length).toBeGreaterThan(0);
    tips.forEach((t, i) => {
      const x = rect.x + (rect.width * t.f) / 4000;
      const y = rect.y + (rect.height * (DB_TOP - t.db)) / (DB_TOP - DB_FLOOR);
      expect(Math.abs(shown[i][0] - x)).toBeLessThan(1);
      expect(Math.abs(shown[i][1] - y)).toBeLessThan(1);
    });
    // No horizontal scroll at phone width; the chip stays inside the frame.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const frame = await h.locator(".anim-figure__frame").boundingBox();
    const chip = await h.locator(".anim-chip").first().boundingBox();
    if (!frame || !chip) throw new Error("no frame or chip");
    expect(chip.x).toBeGreaterThanOrEqual(frame.x - 0.5);
    expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
  });
}

test("a frame change rebuilds the stack around the new frame, and the chip follows", async ({ page }) => {
  const h = await open(page);
  await h.locator(".anim-range").first().evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("no range");
    el.value = "102";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(page, h);
  await expect(h.locator(".anim-chip").first()).toHaveText("this frame: 124.7 Hz, 7 of 8 bands voiced");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /The outlined slice is frame 102: f0 124\.7 Hz, 7 of 8 bands voiced/);
});

test("reduced motion: opens in 2D, loads nothing 3D until asked, then lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/anim-synth-3d\.js|vendor\/three/.test(r.url())) asked.push(r.url()); });
  await page.goto(PAGE);
  const h = host(page);
  await settle(page, h);
  await expect(h.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect(asked.filter((u) => /anim-synth-3d/.test(u))).toEqual([]);
  await h.locator('button[data-view="3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, h);
  expect(await probe(page, "p.played")).toBe(0);
  expect(await probe(page, "p.pose")).toEqual({ yaw: 32, pitch: 24 });
  expect(await probe(page, "p.sliceTips().length")).toBe(4);
});

test("toggling 3D five times quickly leaves at most one context and no stray overlay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const h = host(page);
  await settle(page, h);
  const button = h.locator('button[data-view="3d"]');
  for (let i = 0; i < 5; i += 1) await button.click();
  await page.waitForTimeout(1500);
  await settle(page, h);
  await expect(page.locator(CANVAS_3D)).toHaveCount(1);
  await button.click();
  await settle(page, h);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(h.locator(".anim-chip")).toHaveCount(0);
  await expect(h.locator(".anim-figure__overlay")).toHaveCount(0);
  expect(await page.evaluate(() => window.__ambeAnim?.liveContexts)).toBe(0);
});

test("the readout gives the pitch change as a share of this frame's f0", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const h = host(page);
  await settle(page, h);
  const readouts = h.locator('[data-ref="readouts"]');
  await expect(readouts).toContainText("pitch change from the previous frame -11.6 Hz, 10.5% of this frame's");
  await h.locator(".anim-range").first().evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("no range");
    el.value = "99";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(readouts).toContainText("pitch change from the previous frame +11.5 Hz, 9.5% of this frame's");
  await h.locator(".anim-range").first().evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("no range");
    el.value = "93";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(readouts).toContainText("f0 133.3 Hz");
  await expect(readouts).toContainText("pitch change from the previous frame none (the previous frame has no pitch)");
  // No em dash anywhere in the figure's own text.
  expect(await h.locator(".anim-figure").evaluate((f) => f.textContent?.includes(String.fromCharCode(0x2014)))).toBe(false);
});

test("steps: step 3 sets the noise end of the mix; in 2D a step that asks for 3D stays 2D", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const h = host(page);
  await settle(page, h);
  const next = h.locator('[data-step="next"]');
  await next.click();
  await next.click();
  await expect(h.locator('[data-ref="mixout"]')).toHaveText("noise 100%");
  await expect(h.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
});

test("steps: step 2 stays in 3D (the map of frames from above), step 3 leaves it for the flat spectrum", async ({ page }) => {
  const h = await open(page);
  const next = h.locator('[data-step="next"]');
  await next.click();
  await settle(page, h);
  await expect(h.locator(".anim-figure")).toHaveAttribute("data-view", "3d");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect(await probe(page, "p.pose")).toEqual({ yaw: 0, pitch: 90 });
  await next.click();
  await expect(h.locator('[data-ref="mixout"]')).toHaveText("noise 100%");
  await expect(h.locator('button[data-view="3d"]')).toHaveAttribute("aria-pressed", "false");
  await expect(h.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
});

test("left alone, the opening plays once and the figure holds step 1's frame: nothing plays until the reader presses Play", async ({ page }) => {
  await page.goto(PAGE);
  const h = host(page);
  await h.locator(".anim-figure__frame").evaluate((f) => f.scrollIntoView({ block: "center" }));
  // While the split plays, both generators are named on the figure.
  await expect(h.locator(".synth-intro-labels")).toContainText("oscillator bank (sticks)", { timeout: 15_000 });
  await expect(h.locator(".synth-intro-labels")).toContainText("shaped noise (blocks)");
  await expect.poll(() => probe(page, "p.played"), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => probe(page, "p.pose"), { timeout: 15_000 }).toEqual({ yaw: 32, pitch: 24 });
  await page.waitForTimeout(1500);
  await expect(h.locator(".anim-btn--play")).toHaveText("Play");
  await expect(h.locator(".anim-readout--wide").first()).toHaveText(/^frame 98 /);
  await expect(h.locator(".anim-chip").first()).toHaveText("this frame: 110.1 Hz, 1 of 8 bands voiced");
});

test("with the overlay off the slice keeps its outline and chip, and the legend drops the measured line", async ({ page }) => {
  const h = await open(page);
  await h.locator('[data-ref="overlay"]').uncheck();
  await settle(page, h);
  await expect(h.locator(".anim-chip").first()).toBeVisible();
  await expect(h.locator(".anim-chip").first()).toHaveText("this frame: 110.1 Hz, 1 of 8 bands voiced");
  await expect(h.locator('.anim-legend__item[data-ref="measured3d"]')).toBeHidden();
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /The outlined slice is frame 98/);
});

test("a step holds its picked frame (the vowel pick, frame 101) and stops playback", async ({ page }) => {
  await page.goto(PAGE);
  const h = host(page);
  await settle(page, h);
  await h.locator(".anim-range").first().evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("no range");
    el.value = "40";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await h.locator(".anim-btn--play").click();
  await expect(h.locator(".anim-btn--play")).toHaveText("Pause");
  await h.locator('[data-step="next"]').click();
  await expect(h.locator(".anim-btn--play")).toHaveText("Play");
  await expect(h.locator(".anim-readout--wide").first()).toHaveText(/^frame 101 /);
  await page.waitForTimeout(400);
  await expect(h.locator(".anim-readout--wide").first()).toHaveText(/^frame 101 /);
});
