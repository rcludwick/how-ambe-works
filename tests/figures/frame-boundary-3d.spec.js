// The frame-boundary figure's 3D view (ch11; three-everywhere plan N7,
// design §5.7): Front equals the flat view, the opening plays once and lands
// on the dip bars, the steps pick the view (2D for a flat plot, 3D for the
// gate plane) and drive the presets and the gate, and the 2D path holds
// without WebGL or motion.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const PAGE = "11-synthesis/";
const HOST = '[data-anim="frame-boundary"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {import("@playwright/test").Page} page @param {string} [query] */
async function open(page, query = "") {
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "center" }));
  return host;
}

/** @param {import("@playwright/test").Page} page @param {string} expr */
const three = (page, expr) => page.evaluate((e) => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures["frame-boundary-3d"];
  return new Function("f", `return ${e}`)(f);
}, expr);

/**
 * Step 1 is a flat plot, so the figure opens in 2D: press 3D, then wait for it.
 * @param {import("@playwright/test").Page} page
 */
async function in3D(page) {
  const host = page.locator(HOST);
  const toggle = host.locator('button[data-view="3d"]');
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForFunction(() => window.__ambeAnim?.figures["frame-boundary-3d"]);
  await settle(page, host);
  return host;
}

/** @param {import("@playwright/test").Page} page */
const finish = (page) => page.evaluate(() => window.__ambeAnim.finishAll());

for (const width of [1280, 375]) {
  test(`Front at zoom 1 puts the envelopes and the waveform on the flat plot within 0.5 px, ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page);
    await in3D(page);
    for (const scheme of ["crossfade", "switch"]) {
      await host.locator(`button[data-scheme="${scheme}"]`).click();
      await host.locator('button[data-preset="front"]').click();
      await finish(page);
      expect(await three(page, "f.zoom()")).toBe(1);
      const { points, area } = await page.evaluate(() => {
        // @ts-ignore test-only global
        const figs = window.__ambeAnim.figures;
        return { points: figs["frame-boundary-3d"].frontPoints(), area: figs["frame-boundary"].plot() };
      });
      expect(points.length).toBeGreaterThan(40);
      let worst = 0;
      for (const p of points) {
        const x = area.left + (p.t / 20) * area.width;
        const y = area.top + ((1.1 - p.v) / 2.2) * area.height;
        worst = Math.max(worst, Math.abs(x - p.x), Math.abs(y - p.y));
      }
      expect(worst, scheme).toBeLessThanOrEqual(0.5);
      // At Front the ribbons, the plane and the bars are gone: the flat view.
      expect(await three(page, "f.parts()")).toMatchObject({ ribbons: false, plane: false, bars: false });
    }
  });
}

test("step 1 is flat: opens in 2D; 3D plays its animation once, ending on the dip bars from the side", async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForLoadState("networkidle");
  // Nothing 3D for this figure while it is far below the fold.
  expect(await page.evaluate(() => Boolean(window.__ambeAnim?.figures["frame-boundary-3d"]))).toBe(false);
  const opened = await open(page);
  await settle(page, opened);
  // Step 1 asks for 2D: nothing 3D loads near the viewport either.
  await expect(opened.locator('button[data-view="3d"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  const host = await in3D(page);
  expect(await three(page, "f.played")).toBe(1);
  expect((await hook(page)).played["frame-boundary"]).toBe(1);
  expect(await three(page, "f.pose()")).toEqual({ yaw: 90, pitch: 0 });
  expect(await three(page, "f.parts()")).toMatchObject({ bars: true, drawn: 1, dropped: 1, playhead: false });
  // The end state carries the point: harmonic 8's bar is far deeper than harmonic 1's.
  const bars = /** @type {number[]} */ (await three(page, "f.bars()"));
  expect(bars[7]).toBeGreaterThan(0.9);
  expect(bars[0]).toBeLessThan(0.05);
  // From the side the chip states what the bars show, the lowest level, by the bar's foot.
  await expect(host.locator(".anim-chip")).toHaveText("harmonic 8: lowest 0.03");
  await expect(host.locator(".anim-figure__label", { hasText: "dips" })).toHaveText(/dips\s*twice/);
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /harmonic 8, highlighted, its envelope is 0\.06 at the midpoint/);
  // Scrolled away and back: not replayed.
  await page.evaluate(() => window.scrollTo(0, 0));
  await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await settle(page, host);
  expect(await three(page, "f.played")).toBe(1);
});

test("the animation's middle: the rule runs across the 20 ms at Front, then the camera turns to Side", async ({ page }) => {
  await open(page);
  const host = await in3D(page);
  await three(page, "f.seek(0.25)");
  expect(await three(page, "f.pose()")).toEqual({ yaw: 0, pitch: 0 });
  const mid = await three(page, "f.parts()");
  expect(mid.playhead).toBe(true);
  expect(mid.drawn).toBeGreaterThan(0.3);
  expect(mid.drawn).toBeLessThan(0.7);
  // At Front the plot's own axes and labels are drawn over the scene.
  const frontLabels = host.locator(".fb-front .anim-figure__label:not([hidden])");
  await expect(frontLabels.filter({ hasText: "time between the two frames (ms)" })).toBeVisible();
  await expect(frontLabels.filter({ hasText: "120 Hz frame" })).toBeVisible();
  await three(page, "f.seek(0.68)");
  const yaw = (await three(page, "f.pose()")).yaw;
  expect(yaw).toBeGreaterThan(10);
  expect(yaw).toBeLessThan(90);
  // Mid-turn: no lane labels, and the Front labels have gone.
  await expect(host.locator(".anim-figure__overlay:not(.fb-front):not(.anim-chip-layer) .anim-figure__label")).toHaveCount(0);
  await expect(host.locator(".fb-front")).toBeHidden();
  await three(page, "f.seek(1)");
  expect(await three(page, "f.pose()")).toEqual({ yaw: 90, pitch: 0 });
});

test("the steps pick the view: 2D for the flat plots, 3D at Oblique for the gate plane", async ({ page }) => {
  const host = await open(page);
  await in3D(page);
  const toggle = host.locator('button[data-view="3d"]');
  const next = host.getByRole("button", { name: "Next" });
  // Step 2, the switch, is a flat plot: it leaves 3D.
  await next.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator("canvas.anim-figure__canvas").first()).toBeVisible();
  // Step 3, the patent's rule: 3D, at Oblique, with the gate plane.
  await next.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await in3D(page);
  await finish(page);
  expect(await three(page, "f.pose()")).toEqual({ yaw: 30, pitch: 26 });
  expect(await three(page, "f.parts()")).toMatchObject({ plane: true, edge: true, ribbons: true });
  // Steps 4 and 5, the gate closed and the handover: flat again.
  for (let i = 0; i < 2; i += 1) {
    await next.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  }
});

test("free play in 3D keeps the presets and the gate: Front, Side with it closed, the handover", async ({ page }) => {
  const host = await open(page);
  await in3D(page);
  await host.locator('button[data-scheme="switch"]').click();
  await host.locator('button[data-preset="front"]').click();
  await finish(page);
  expect(await three(page, "f.pose()")).toEqual({ yaw: 0, pitch: 0 });
  await expect(host.locator(".anim-chip")).toHaveText("harmonic 8: phase jumps 173°");
  // The switch at 10 ms is marked in 3D as in the flat view, and named.
  expect(await three(page, "f.parts()")).toMatchObject({ cut: true, waves: true });
  await expect(host.locator(".fb-front .anim-figure__label", { hasText: "switch" })).toBeVisible();
  await host.locator('button[data-scheme="rule"]').click();
  await host.locator('input[data-role="change"]').fill("15");
  await host.locator('button[data-preset="side"]').click();
  await finish(page);
  expect(await three(page, "f.pose()")).toEqual({ yaw: 90, pitch: 0 });
  // The gate closed: no plane, every lane dips, harmonic 1 too.
  expect(await three(page, "f.parts()")).toMatchObject({ plane: false, bars: true });
  const bars = /** @type {number[]} */ (await three(page, "f.bars()"));
  expect(bars[0]).toBeGreaterThan(0.2);
  await host.locator('input[data-role="change"]').fill("5");
  await host.locator('button[data-scheme="handover"]').click();
  await host.locator('button[data-preset="oblique"]').click();
  await finish(page);
  expect(await three(page, "f.parts()")).toMatchObject({ dashed: true, plane: true, waves: false });
  await expect(host.locator(".anim-chip")).toHaveText("harmonics 9 to 12: power 0.50 at 10 ms");
});

test("reduced motion opens 2D and asks for nothing 3D; the control then lands on the end state without the animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/anim-frame-boundary-3d/.test(r.url())) asked.push(r.url()); });
  const host = await open(page);
  await settle(page, host);
  // Under reduced motion no step opens 3D: step 3 asks for it and stays flat.
  const next = host.getByRole("button", { name: "Next" });
  for (let i = 0; i < 2; i += 1) await next.click();
  await settle(page, host);
  expect(asked).toEqual([]);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await host.locator('button[data-view="3d"]').click();
  await in3D(page);
  expect(await three(page, "f.played")).toBe(0);
  expect(await three(page, "f.pose()")).toEqual({ yaw: 30, pitch: 26 });
  expect(await three(page, "f.parts()")).toMatchObject({ drawn: 1, dropped: 1 });
});

test("?nowebgl: the 3D control is disabled with the hint and the steps that ask for 3D stay in 2D", async ({ page }) => {
  const host = await open(page, "?nowebgl");
  await settle(page, host);
  await expect(host.locator('button[data-view="3d"]')).toBeDisabled();
  await expect(host.locator(".anim-figure__hint--webgl")).toBeVisible();
  const next = host.getByRole("button", { name: "Next" });
  for (let i = 0; i < 2; i += 1) await next.click();
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator("canvas.anim-figure__canvas")).toBeVisible();
});

test("toggling 3D five times quickly leaves no stray context or overlay", async ({ page }) => {
  const host = await open(page);
  await in3D(page);
  const toggle = host.locator('button[data-view="3d"]');
  // Reaching the button scrolls the page, which can bring the figure below
  // near enough to open its own view: count from there.
  await toggle.scrollIntoViewIfNeeded();
  await settle(page, host);
  const before = (await hook(page)).liveContexts;
  for (let i = 0; i < 5; i += 1) await toggle.click();
  await page.waitForTimeout(800);
  await settle(page, host);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator(".anim-chip-layer, .anim-figure__overlay")).toHaveCount(0);
  expect((await hook(page)).liveContexts).toBe(before - 1);
  await expect(host.locator('[data-role="camera"]')).toBeHidden();
});

test("the highlight token holds 3:1 on the plot and the stage bottom, both themes", async ({ page }) => {
  const host = await open(page);
  await in3D(page);
  for (const scheme of ["slate", "default"]) {
    const [hl, bg, stage] = await host.locator(".anim-figure__frame").evaluate((el, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(el);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    /** @param {string} hex */
    const lum = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    /** @param {string} a @param {string} b */
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    expect(ratio(hl, bg), scheme).toBeGreaterThanOrEqual(3);
    expect(ratio(hl, stage), scheme).toBeGreaterThanOrEqual(3);
  }
});

test("phone, 375 px: no sideways scroll, and the chip stays inside the frame at zoom 1 and 6", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open(page);
  await in3D(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const zoomIn = host.getByRole("button", { name: "Zoom in" });
  for (const clicks of [0, 9]) {
    for (let i = 0; i < clicks; i += 1) {
      if (await zoomIn.isEnabled()) await zoomIn.click();
      await finish(page);
    }
    await page.waitForTimeout(300);
    const frame = await host.locator(".anim-figure__frame").boundingBox();
    const chip = await host.locator(".anim-chip").boundingBox();
    expect(chip && frame).toBeTruthy();
    if (!chip || !frame) return;
    expect(chip.x).toBeGreaterThanOrEqual(frame.x);
    expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(chip.y).toBeGreaterThanOrEqual(frame.y);
    expect(chip.y + chip.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
  }
});
