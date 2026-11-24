// vq-space (ch09): a scalar grid against a codebook on synthetic dots, in
// 2D and in 3D (three-figures plan, Figure B; design §2.2, M4).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { countAnimObservers, hook, settle } from "./helpers.js";

const PAGE = "09-quantization/";
const HOST = '[data-anim="vq-space"]';
const FLAT = `${HOST} canvas.anim-vq__plot`;
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/**
 * The figure opens in 3D under normal motion (owner decision O1), so the
 * cases about the 2D model run under reduced motion, which opens 2D.
 * @param {import("@playwright/test").Page} page
 * @param {string} [query]
 * @param {{motion?: "reduce" | "no-preference"}} [opts]
 */
async function open(page, query = "", { motion = "reduce" } = {}) {
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await host.scrollIntoViewIfNeeded();
  return host;
}

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures["vq-space"];
  // @ts-ignore test-only global
  const three = window.__ambeAnim.figures["vq-space-3d"];
  return { state: f.state, readout: f.readout, builds: three?.builds ?? 0, objects: three?.objects ?? 0 };
});

/** @param {import("@playwright/test").Page} page */
const drawn = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  return window.__ambeAnim.figures["vq-space"].drawn;
});

/**
 * Every listed number equal within float32 rounding.
 * @param {number[]} a
 * @param {number[]} b
 */
function same(a, b) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i += 1) expect(a[i]).toBeCloseTo(b[i], 5);
}

/** @param {import("@playwright/test").Locator} host */
const readout = (host) => host.locator('[data-ref="readout"]');

/**
 * @param {import("@playwright/test").Locator} host
 * @param {number} n 1-based
 */
async function toStep(host, n) {
  for (let i = 1; i < n; i += 1) await host.locator('[data-step="next"]').click();
}

/** @param {string} text */
function numbers(text) {
  const mse = /mean squared error ([\d.]+)/.exec(text);
  const empty = /(\d+) of (\d+) (?:cells|cubes) never used/.exec(text);
  const used = /(\d+) of (\d+) (?:cells|cubes) used/.exec(text);
  return {
    mse: mse ? Number(mse[1]) : NaN,
    empty: empty ? Number(empty[1]) : null,
    used: used ? Number(used[1]) : null,
    cells: Number((empty || used || [0, 0, 0])[2]),
  };
}

test("JS off: fallback image, caption and every step are visible", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  expect(await host.locator(".anim-fallback img").evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth)).toBe(1280);
  await expect(host.locator(".anim-fallback figcaption")).toContainText("Comparing a scalar grid against a trained vector codebook");
  const steps = host.locator(".anim-steps > li");
  await expect(steps).toHaveCount(6);
  for (const step of await steps.all()) await expect(step).toBeVisible();
  await context.close();
});

test("print: fallback image, numbered steps, no live chrome", async ({ page }) => {
  const host = await open(page);
  await page.emulateMedia({ media: "print" });
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  await expect(host.locator(".anim-figure__frame")).toBeHidden();
  await expect(host.locator(".anim-controls")).toBeHidden();
  for (const step of await host.locator(".anim-steps > li").all()) await expect(step).toBeVisible();
  expect(await host.locator(".anim-figure__step .anim-steps").evaluate((ol) => getComputedStyle(ol).listStyleType)).toBe("decimal");
});

test("steps: each step applies its state", async ({ page }) => {
  const host = await open(page);
  const out = readout(host);
  await expect(out).toContainText("1200 dots, two numbers each, 4 bits");
  await toStep(host, 2);
  await expect(out).toContainText("4 bits, grid, mean squared error 0.0154, 7 of 16 cells never used");
  await toStep(host, 2);
  await expect(out).toContainText("mean squared error 0.0164, 10 of 16 cells never used");
  await toStep(host, 2);
  await expect(out).toContainText("6 of 16 cells used");
  await host.getByRole("button", { name: "One Lloyd step" }).click();
  await expect(out).toContainText("mean squared error 0.0039 (grid 0.0164)");
  await host.getByRole("button", { name: "Train to convergence" }).click();
  await expect(out).toContainText("0.0006 (grid 0.0164), 16 of 16 cells used");
  await toStep(host, 2);
  await expect(page.locator(CANVAS_3D)).toBeVisible();
  await expect(out).toContainText("55 of 64 cubes never used");
  await host.getByRole("button", { name: "Codebook", exact: true }).click();
  await host.getByRole("button", { name: "Train to convergence" }).click();
  await expect(out).toContainText("mean squared error 0.0004 (grid 0.0183), 64 of 64 cubes used");
});

test("steps: Previous after free play restores the step", async ({ page }) => {
  const host = await open(page);
  await toStep(host, 5);
  await host.locator('[data-step="next"]').click(); // step 6
  await host.locator('[data-step="next"]').click(); // free play
  await host.locator('[data-ref="bits"]').fill("3");
  await host.locator('[data-step="prev"]').click();
  await expect(readout(host)).toContainText("6 bits, grid, mean squared error 0.0183, 55 of 64 cubes never used");
  // Moving a control does not move the step.
  await host.locator('[data-ref="bits"]').fill("3");
  await expect(host.locator(".anim-steps__nav output")).toHaveText("Step 5 of 6");
});

test("grid vs codebook at 4 bits, stretch 0.9", async ({ page }) => {
  const host = await open(page);
  await toStep(host, 3);
  const grid = numbers((await readout(host).textContent()) || "");
  await host.getByRole("button", { name: "Codebook", exact: true }).click();
  await host.getByRole("button", { name: "Train to convergence" }).click();
  const book = numbers((await readout(host).textContent()) || "");
  expect(grid.empty).toBeGreaterThan(0);
  expect(book.used).toBe(16);
  expect(book.cells).toBe(16);
  expect(book.mse).toBeLessThan(grid.mse);
});

test("probe moves by keyboard", async ({ page }) => {
  const host = await open(page);
  await toStep(host, 2);
  const before = (await probe(page)).state.probe;
  await page.locator(FLAT).focus();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
  const after = (await probe(page)).state.probe;
  expect(after[0] - before[0]).toBeCloseTo(0.1, 6);
  expect(await host.locator(".anim-steps__nav output").textContent()).toBe("Step 2 of 6");
  await page.keyboard.press("]");
  const dot = await page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures["vq-space"].state.probe;
  });
  const { makeCloud } = await import("../../docs/javascripts/lib/vq.js");
  const pts = makeCloud({ rho: 0.5, angleDeg: 45 });
  expect(dot[0]).toBeCloseTo(pts[3], 6);
  expect(dot[1]).toBeCloseTo(pts[4], 6);
  await page.keyboard.press("Home");
  const home = (await probe(page)).state.probe;
  expect(home[0]).toBeCloseTo(before[0], 6);
});

test("synthetic caption present with the synthetic badge; no measured badge", async ({ page }) => {
  const host = await open(page);
  const caption = host.locator(".anim-figure .anim-figure__caption");
  await expect(caption).toContainText("Synthetic data from a seeded generator. The codebook is trained here");
  await expect(caption.locator(".anim-badge--synthetic")).toHaveText("synthetic");
  await expect(host.locator(".anim-badge--measured")).toHaveCount(0);
});

test("three is fetched only when 3D is asked for", async ({ page }) => {
  /** @type {string[]} */
  const vendor = [];
  page.on("request", (r) => { if (r.url().includes("/vendor/three/")) vendor.push(r.url()); });
  const host = await open(page);
  await toStep(host, 4);
  await page.waitForLoadState("networkidle");
  expect(vendor).toEqual([]);
  await host.getByRole("button", { name: "3 numbers" }).click();
  await page.locator(CANVAS_3D).waitFor();
  expect(vendor.length).toBeGreaterThan(0);
});

test("no WebGL: 2D works, 3D control disabled with the hint", async ({ page }) => {
  const host = await open(page, "?nowebgl", { motion: "no-preference" });
  await toStep(host, 5);
  await expect(host.getByRole("button", { name: "3D view" })).toBeDisabled();
  await expect(host.getByRole("button", { name: "3 numbers" })).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator(".anim-figure__hint--webgl")).toHaveText("3D needs WebGL 2");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator(FLAT)).toBeVisible();
  const without = await readout(host).textContent();

  const page2 = await page.context().newPage();
  const host2 = await open(page2, "", { motion: "no-preference" });
  await toStep(host2, 5);
  await page2.locator(CANVAS_3D).waitFor();
  expect(await readout(host2).textContent()).toBe(without);
  await page2.close();
});

test("steps: Stretch and Angle moved in a step come back with Previous and Next", async ({ page }) => {
  const host = await open(page);
  await toStep(host, 3);
  await host.locator('[data-ref="rho"]').fill("0.2");
  await host.locator('[data-ref="angle"]').fill("10");
  await expect(readout(host)).not.toContainText("10 of 16 cells never used");
  await host.locator('[data-step="prev"]').click();
  await expect(readout(host)).toContainText("4 bits, grid, mean squared error 0.0154, 7 of 16 cells never used");
  await expect(host.locator('[data-ref="rho-out"]')).toHaveText("0.50");
  await expect(host.locator('[data-ref="angle-out"]')).toHaveText("45°");
  await host.locator('[data-ref="rho"]').fill("0.2");
  await host.locator('[data-ref="angle"]').fill("10");
  await host.locator('[data-step="next"]').click();
  await expect(readout(host)).toContainText("mean squared error 0.0164, 10 of 16 cells never used");
  await expect(host.locator('[data-ref="rho-out"]')).toHaveText("0.90");
  await expect(host.locator('[data-ref="angle-out"]')).toHaveText("45°");
});

test("context loss at two numbers: resume paints the front face again", async ({ page }) => {
  const host = await open(page, "", { motion: "no-preference" });
  await toStep(host, 2);
  // Step 2 is a flat graph and shows in 2D; the control opens 3D on it.
  await host.getByRole("button", { name: "3D view" }).click();
  await page.locator(CANVAS_3D).waitFor();
  const face = () => page.evaluate(() => /** @type {any} */ (window).__ambeAnim.figures["vq-space-3d"].faceWidth);
  await expect.poll(face).toBe(1024);
  const before = await probe(page);
  await page.locator(CANVAS_3D).evaluate((c) => {
    const gl = /** @type {HTMLCanvasElement} */ (c).getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await host.locator(".anim-figure__resume").click();
  await expect.poll(async () => (await probe(page)).builds).toBe(before.builds + 1);
  await expect.poll(face).toBe(1024);
});

test("context loss: paused, resume rebuilds, readouts unchanged", async ({ page }) => {
  const host = await open(page, "", { motion: "no-preference" });
  await toStep(host, 5);
  await page.locator(CANVAS_3D).waitFor();
  const before = await probe(page);
  await page.locator(CANVAS_3D).evaluate((c) => {
    const gl = /** @type {HTMLCanvasElement} */ (c).getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(host.locator('.anim-figure__frame[data-state="paused"]')).toHaveCount(1);
  await host.locator(".anim-figure__resume").click();
  await expect.poll(async () => (await probe(page)).builds).toBe(before.builds + 1);
  const after = await probe(page);
  expect(after.objects).toBe(before.objects);
  expect(after.readout).toBe(before.readout);
});

test("ten navigations: one context at most, observers back to baseline", async ({ page }) => {
  test.setTimeout(90_000);
  /** @type {string[]} */
  const messages = [];
  page.on("console", (m) => messages.push(m.text()));
  await countAnimObservers(page);
  // Under reduced motion the other ch08 and ch09 figures stay in 2D, so
  // every live context is vq-space's, opened by its own "3 numbers".
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  await page.locator(`${HOST} .anim-figure`).waitFor();
  // @ts-ignore test-only global
  const baseline = await page.evaluate(() => window.__obs.live);
  for (let i = 0; i < 10; i += 1) {
    await page.locator('a.md-nav__link[href$="08-analysis/"]').first().click();
    await page.locator('[data-anim="frames"] canvas').first().waitFor();
    await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
    await page.locator('a.md-nav__link[href$="09-quantization/"]').first().click();
    const host = page.locator(HOST);
    await host.locator(".anim-figure").waitFor();
    await host.scrollIntoViewIfNeeded();
    await host.getByRole("button", { name: "3 numbers" }).click();
    await page.locator(CANVAS_3D).waitFor();
  }
  const h = await hook(page);
  expect(h.peakContexts).toBe(1);
  expect(h.webglProbes).toBe(1);
  await page.locator('a.md-nav__link[href$="08-analysis/"]').first().click();
  await page.locator('[data-anim="frames"] canvas').first().waitFor();
  await page.locator('a.md-nav__link[href$="09-quantization/"]').first().click();
  await page.locator(`${HOST} .anim-figure`).waitFor();
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBe(baseline);
  expect(messages.filter((m) => /too many active webgl contexts/i.test(m))).toEqual([]);
});

test("toggle 3D five times quickly: no stray context or labels", async ({ page }) => {
  const host = await open(page);
  const toggle = host.getByRole("button", { name: "3D view" });
  for (let i = 0; i < 5; i += 1) {
    await toggle.click();
    await toggle.click();
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const h = await hook(page);
  expect(h.liveContexts).toBe(0);
  expect(h.peakContexts).toBeLessThanOrEqual(1);
  await expect(host.locator(".anim-figure__overlay")).toHaveCount(0);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await page.locator('a.md-nav__link[href$="08-analysis/"]').first().click();
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
});

test("reduced motion: opens 2D, 3D still available, no tween", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const host = await open(page);
  await expect(page.locator(FLAT)).toBeVisible();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await host.getByRole("button", { name: "3 numbers" }).click();
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(400);
  for (const name of ["Front", "Top", "Corner"]) {
    const before = (await hook(page)).renders;
    await host.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(300);
    expect((await hook(page)).renders - before).toBe(1);
  }
});

test("budget: one render at most 8 ms and training at most 50 ms at 4x CPU throttle", async ({ page }) => {
  const host = await open(page);
  await host.getByRole("button", { name: "3 numbers" }).click();
  await page.locator(CANVAS_3D).waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const times = await page.evaluate(() => {
    // @ts-ignore test-only global
    const f = window.__ambeAnim.figures["vq-space"];
    /** @param {() => number} fn */
    const median = (fn) => {
      const runs = [fn(), fn(), fn(), fn(), fn()].sort((a, b) => a - b);
      return runs[2];
    };
    // @ts-ignore test-only global
    const three = window.__ambeAnim.figures["vq-space-3d"];
    return { render: median(() => three.timeRender()), train: median(() => f.timeTrain(6)) };
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  console.log(`vq-space budget at 4x: render ${times.render.toFixed(2)} ms, train ${times.train.toFixed(2)} ms`);
  expect(times.render).toBeGreaterThanOrEqual(0);
  expect(times.render).toBeLessThanOrEqual(8);
  expect(times.train).toBeLessThanOrEqual(50);
});

test("3D: a preset pressed during the lift still lands every dot at its depth", async ({ page }) => {
  const host = await open(page, "", { motion: "no-preference" });
  await toStep(host, 5);
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await drawn(page)).lift, { intervals: [10] }).toBeGreaterThan(0);
  expect((await drawn(page)).lift).toBeLessThan(1);
  await host.getByRole("button", { name: "Top", exact: true }).click();
  await page.waitForTimeout(800);
  const d = await drawn(page);
  expect(d.lift).toBe(1);
  same(d.dotZ, d.ptsZ);
});

test("3D: Codebook and Train during the lift still land the lift and the entries", async ({ page }) => {
  const host = await open(page, "", { motion: "no-preference" });
  await toStep(host, 5);
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await drawn(page)).lift, { intervals: [10] }).toBeGreaterThan(0);
  await host.getByRole("button", { name: "Codebook", exact: true }).click();
  await host.getByRole("button", { name: "Train to convergence" }).click();
  await host.getByRole("button", { name: "Front", exact: true }).click();
  await page.waitForTimeout(800);
  const d = await drawn(page);
  expect(d.lift).toBe(1);
  same(d.dotZ, d.ptsZ);
  same(d.shown, d.entries);
  expect((await probe(page)).state.view).toBe("3d");
});

test("2D: a method change during an entry tween shows the new method's entries", async ({ page }) => {
  const host = await open(page, "?nowebgl", { motion: "no-preference" });
  await toStep(host, 4);
  await host.getByRole("button", { name: "Train to convergence" }).click();
  await host.getByRole("button", { name: "Grid", exact: true }).click();
  await page.waitForTimeout(500);
  const d = await drawn(page);
  same(d.shown, d.entries);
  // Bits up in the same window: the drawn entries follow the new size.
  await host.getByRole("button", { name: "Codebook", exact: true }).click();
  await host.getByRole("button", { name: "One Lloyd step" }).click();
  await host.locator('[data-ref="bits"]').fill("6");
  await page.waitForTimeout(500);
  const e = await drawn(page);
  expect(e.shown.length).toBe(64 * 2);
  same(e.shown, e.entries);
});

test("legend: step 1 lists only the dots; 3D lists a ring probe and the turn", async ({ page }) => {
  const host = await open(page);
  const keys = host.locator(".anim-vq__keys");
  await expect(host.locator('[data-ref="entry-key"]')).toBeHidden();
  await expect(host.locator('[data-ref="hatch-key"]')).toBeHidden();
  await expect(host.locator('[data-ref="probe-key"]')).toBeHidden();
  await expect(keys).toBeHidden();
  await toStep(host, 2);
  await expect(host.locator('[data-ref="hatch-key"]')).toBeVisible();
  await expect(host.locator('[data-ref="probe-key"]')).toBeVisible();
  await expect(keys).toContainText("Probe: drag");
  await toStep(host, 4);
  await page.locator(CANVAS_3D).waitFor();
  await expect(keys).toContainText("Drag sideways to turn the cube");
  await expect(keys).not.toContainText("Probe: drag");
  await expect(host.locator('[data-ref="probe-key"] i')).toHaveClass(/anim-vq__key--probe-ring/);
  // The cube hatches its empty cells, so the key says so.
  await expect(host.locator('[data-ref="hatch-key"]')).toContainText("cube no dot falls in");
});

test("no WebGL, 3 numbers: the legend matches the front view", async ({ page }) => {
  const host = await open(page, "?nowebgl");
  await toStep(host, 5);
  await expect(host.locator('[data-ref="hatch-key"]')).toBeHidden();
  await expect(host.locator('[data-ref="ring-key"]')).toBeVisible();
  await expect(host.locator('[data-ref="dot-key"]')).toContainText("coloured by the entry");
});

test("3D: the label for the axis that points at the viewer is hidden", async ({ page }) => {
  const host = await open(page, "", { motion: "no-preference" });
  await toStep(host, 5);
  await page.locator(CANVAS_3D).waitFor();
  const visible = async () => (await host.locator(".anim-figure__overlay > :not([hidden])").allTextContents());
  await host.getByRole("button", { name: "Front", exact: true }).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(300);
  expect(await visible()).toContain("first number");
  expect(await visible()).not.toContain("third number");
  await host.getByRole("button", { name: "Top", exact: true }).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(300);
  expect(await visible()).toContain("third number");
  expect(await visible()).not.toContain("second number");
});

test("touch: a vertical swipe on either canvas scrolls the page", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  const host = await open(page);
  // Step 4 has a live probe; a swipe past the plot must not move it.
  await toStep(host, 4);
  const probeBefore = (await probe(page)).state.probe;
  for (const selector of [FLAT, CANVAS_3D]) {
    if (selector === CANVAS_3D) {
      await host.getByRole("button", { name: "3 numbers" }).click();
      await page.locator(CANVAS_3D).waitFor();
    }
    const canvas = page.locator(selector);
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas box");
    const before = await page.evaluate(() => window.scrollY);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", {
      x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2),
      yDistance: -200, gestureSourceType: "touch", speed: 800,
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    expect(await canvas.evaluate((c) => getComputedStyle(c).touchAction)).toContain("pan-y");
    if (selector === FLAT) expect((await probe(page)).state.probe).toEqual(probeBefore);
  }
  await context.close();
});

for (const motion of /** @type {const} */ (["no-preference", "reduce"])) {
  test(`phone: no horizontal scroll, labels inside the frame, before and after a resize (${motion})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 3, reducedMotion: motion });
    const page = await context.newPage();
    const host = await open(page, "", { motion });
    await toStep(host, 5);
    await page.locator(CANVAS_3D).waitFor();
    // Step 5 is the first 3D view, so its reveal plays here: land it first.
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    await page.waitForTimeout(300);
    for (const width of [375, 330, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(900);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const frame = await host.locator(".anim-figure__frame").boundingBox();
      if (!frame) throw new Error("no frame box");
      const labels = host.locator(".anim-figure__overlay:not(.anim-chip-layer) > :not([hidden])");
      expect(await labels.count()).toBeGreaterThan(0);
      for (const label of await labels.all()) {
        const b = await label.boundingBox();
        if (!b) throw new Error("no label box");
        expect(b.x).toBeGreaterThanOrEqual(frame.x);
        expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width);
        expect(b.y).toBeGreaterThanOrEqual(frame.y);
        expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height - 56);
      }
    }
    await context.close();
  });
}

for (const { name, width, height } of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 375, height: 800 },
]) {
  test(`screens: 2D and 3D at ${width}x${height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await context.newPage();
    // The 2D view under reduced motion: its pixels have not moved.
    const host = await open(page);
    // The sticky site header would otherwise sit over the frame.
    await page.addStyleTag({ content: ".md-header { visibility: hidden; }" });
    await toStep(host, 2);
    await page.waitForTimeout(300);
    await expect(host.locator(".anim-figure__frame")).toHaveScreenshot(`vq-space-2d-${name}.png`, { maxDiffPixels: 0 });
    await toStep(host, 4);
    await page.locator(CANVAS_3D).waitFor();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    await page.waitForTimeout(1200);
    await expect(host.locator(".anim-figure__frame")).toHaveScreenshot(`vq-space-3d-${name}.png`, { maxDiffPixelRatio: 0.01 });
    await context.close();
  });
}

test("step 1: the step text never states a bit count or a count of numbers the controls can change", async ({ page }) => {
  const host = await open(page, "", { motion: "no-preference" });
  const step = host.locator(".anim-figure__step .anim-steps > li:not([hidden])");
  const words = { two: 2, three: 3 };
  /** Bit counts and numbers-per-dot the step text states, checked against the readout. */
  const check = async () => {
    const text = (await step.textContent()) || "";
    const out = (await readout(host).textContent()) || "";
    const bits = /(\d+) bits/.exec(out)?.[1];
    const dims = /(two|three) numbers each/.exec(out)?.[1];
    for (const m of text.matchAll(/(\d+) bits/g)) expect(m[1], `step says ${m[0]}; readout: ${out}`).toBe(bits);
    for (const m of text.matchAll(/\b(two|three) numbers\b/g)) {
      expect(words[/** @type {"two" | "three"} */ (m[1])], `step says ${m[0]}; readout: ${out}`)
        .toBe(words[/** @type {"two" | "three"} */ (dims)]);
    }
  };
  await expect(host.locator(".anim-steps__nav output")).toHaveText(/Step 1 of/);
  await check();
  await host.getByRole("button", { name: "3 numbers" }).click();
  await expect(readout(host)).toContainText("three numbers each, 6 bits");
  await check();
  await host.locator('[data-ref="bits"]').fill("3");
  await check();
  await host.getByRole("button", { name: "2 numbers" }).click();
  await host.locator('[data-ref="bits"]').fill("6");
  await check();
});

const SCREENS_CSS = readFileSync(new URL("./screens.css", import.meta.url), "utf8");

// The frame sits on whole CSS pixels: its height and its top in the page.
// Text above the figure that grows by a fraction of a pixel then leaves the
// frame's screenshot as it was (baselines re-recorded in 9a28edb).
for (const width of [375, 390, 768, 1280, 1440, 1920]) {
  test(`the frame sits on whole pixels at ${width} px, wherever the text above ends`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, deviceScaleFactor: width < 480 ? 3 : 1, colorScheme: "dark" });
    const page = await context.newPage();
    const host = await open(page);
    await settle(page, host);
    const frame = host.locator(".anim-figure__frame");
    const box = () => frame.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - document.documentElement.getBoundingClientRect().top, height: r.height };
    });
    /** @type {Buffer | undefined} */
    let first;
    for (const extra of [0.4, 1, 2.7]) {
      await page.evaluate(({ sel, extra }) => {
        let spacer = document.getElementById("whole-pixel-spacer");
        if (!spacer) {
          spacer = document.createElement("div");
          spacer.id = "whole-pixel-spacer";
          const figure = document.querySelector(sel);
          figure?.parentNode?.insertBefore(spacer, figure);
        }
        spacer.style.height = `${extra}px`;
      }, { sel: HOST, extra });
      await expect.poll(async () => Number.isInteger((await box()).top)).toBe(true);
      expect(Number.isInteger((await box()).height)).toBe(true);
      // The whole frame on screen, so the picture needs no scroll.
      await frame.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const shot = await frame.screenshot({ animations: "disabled", caret: "hide", style: SCREENS_CSS });
      if (first) expect(shot.equals(first)).toBe(true);
      else first = shot;
    }
    await context.close();
  });
}
