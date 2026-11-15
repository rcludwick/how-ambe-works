// The window-shapes figure's 3D view: Front, with the family hidden, puts
// the windowed block and the window on the 2D plot within 0.5 px; the first
// view plays once ("the window settles onto the block") and lands on the
// corner with every block laid and the highlight on the reader's window; a
// window pressed later moves the highlight to its slice; reduced motion and
// ?nowebgl stay in 2D; the steps read the same either way. The first three
// steps are flat graphs, so the figure opens in 2D; the 3D view comes with
// the 3D control or the last step.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "03-windows-and-frames/";
const HOST = '[data-anim="window-shapes"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;
const CORNER = { yaw: 28, pitch: 30 };

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  return host;
}

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test hook
  const p = window.__ambeAnim.figures["window-shapes-3d"];
  return { played: p.played, pose: p.pose(), zoom: p.zoom(), shown: p.shown, laid: p.laid, parts: p.parts, looking: p.looking };
});

for (const width of [1280, 375]) {
  test(`window-shapes 3D at ${width} px: Front hides the family and puts the block and the window on the 2D plot, within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page);
    await host.locator('button[data-window="hamming"]').click();
    await host.locator('button[data-preset="front"]').click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    await page.waitForTimeout(100);
    const result = await page.evaluate(async () => {
      const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
      const mod = await import(new URL("anim-window-shapes.js", script.src).href);
      const frame = /** @type {HTMLElement} */ (document.querySelector('[data-anim="window-shapes"] .anim-figure__frame'));
      const { plot } = mod.layout(frame.clientWidth, frame.clientHeight);
      // @ts-ignore test hook
      const p = window.__ambeAnim.figures["window-shapes-3d"];
      return {
        zoom: p.zoom(),
        looking: p.looking,
        parts: p.parts,
        shown: p.shown,
        pairs: p.frontPoints.map((/** @type {any} */ q) => ({ got: p.project(q.at), want: [plot.x(q.n), plot.y(q.v)] })),
      };
    });
    expect(result.zoom).toBe(1);
    expect(result.looking).toBe("front");
    expect(result.shown).toBeCloseTo(0.08, 9);
    expect(result.parts.family).toBe(false);
    expect(result.parts.rails).toBe(false);
    expect(result.parts.band).toBe(true);
    await expect(host.locator(".anim-figure__label", { hasText: width < 560 ? /^next$/ : /^next copy$/ })).toHaveCount(1);
    // The block and the window every 4 samples (82), the next copy every 2
    // (10), the joint, and the next copy band's two corners.
    expect(result.pairs).toHaveLength(95);
    for (const { got, want } of result.pairs) {
      expect(Math.abs(got[0] - want[0]), "x").toBeLessThanOrEqual(0.5);
      expect(Math.abs(got[1] - want[1]), "y").toBeLessThanOrEqual(0.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("window-shapes 3D: the first view plays once and lands on the corner, every block laid, on the reader's window", async ({ page }) => {
  const host = await open(page);
  const p = await probe(page);
  expect(p.played).toBe(1);
  expect(await page.evaluate(() => window.__ambeAnim.played["window-shapes"])).toBe(1);
  expect(p.pose).toEqual(CORNER);
  expect(p.laid).toBe(0);
  expect(p.shown).toBe(1);
  expect(p.parts.family).toBe(true);
  expect(p.parts.band).toBe(false);
  // Every block but the highlight's: 11 in the family, less one.
  expect(p.parts.blocks).toBe(10);
  await expect(host.locator(".anim-chip")).toHaveText("Rectangular: ends 1.00, middle 1.00");
  await expect(host.locator('[data-ref="legend-3d"]')).toBeVisible();
  await expect(host.locator('[data-ref="legend-2d"]')).toBeHidden();
  await expect(host.locator(".anim-figure__label", { hasText: "Hamming, 0.08" })).toHaveCount(1);
  await expect(host.locator(".anim-figure__label", { hasText: "Hann, 0.00" })).toHaveCount(1);
  // Leaving 3D and coming back does not play it again.
  const toggle = host.locator('[data-ref="view3d"]');
  await toggle.click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect((await probe(page)).played).toBe(0);
  expect(await page.evaluate(() => window.__ambeAnim.played["window-shapes"])).toBe(1);
});

test("window-shapes 3D: the first view's highlight moves back through the family, ends falling, before it settles", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  // Sample the end value on show while the sweep runs: it pauses on
  // Hamming and holds on Hann long enough to read, before it returns.
  const seen = await page.evaluate(() => new Promise((resolve) => {
    /** @type {[number, number][]} */
    const samples = [];
    const begin = performance.now();
    const tick = () => {
      // @ts-ignore test hook
      const p = window.__ambeAnim.figures["window-shapes-3d"];
      if (p) samples.push([performance.now(), p.shown]);
      if (performance.now() - begin < 10000) requestAnimationFrame(tick);
      else resolve(samples);
    };
    tick();
  }));
  const samples = /** @type {[number, number][]} */ (seen);
  const values = samples.map(([, v]) => v);
  /**
   * The ms between the last sample before the highlight reaches a stretch
   * where `inside` holds and the first sample after it: never less than
   * the stretch itself, however far apart the frames fall.
   * @param {(v: number) => boolean} inside
   */
  const stretch = (inside) => {
    const first = samples.findIndex(([, v]) => inside(v));
    let last = first;
    while (last + 1 < samples.length && inside(samples[last + 1][1])) last += 1;
    if (first < 1 || last + 1 >= samples.length) return 0;
    return samples[last + 1][0] - samples[first - 1][0];
  };
  expect(Math.min(...values)).toBe(0);
  // The pause on Hamming and the hold on Hann, long enough to read the chip.
  expect(stretch((v) => Math.abs(v - 0.08) < 1e-6)).toBeGreaterThanOrEqual(1100);
  expect(stretch((v) => v === 0)).toBeGreaterThanOrEqual(1800);
  expect(values[values.length - 1]).toBe(1);
});

test("window-shapes 3D: a window pressed moves the highlight to its slice, and the chip names it", async ({ page }) => {
  const host = await open(page);
  await host.locator('button[data-window="hann"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page)).shown).toBe(0);
  await expect(host.locator(".anim-chip")).toHaveText("Hann: ends 0.00, middle 1.00");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /under the Hann window: Hann: ends 0\.00, middle 1\.00, and no step at the joint/);
  await host.locator('button[data-window="hamming"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page)).shown).toBeCloseTo(0.08, 9);
  await expect(host.locator(".anim-chip")).toHaveText("Hamming: ends 0.08, middle 1.00");
});

test("window-shapes, reduced motion: opens in 2D, loads nothing 3D, and the 3D control lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => {
    if (/anim-window-shapes-3d\.js/.test(r.url())) requests.push(r.url());
  });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect(requests).toEqual([]);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const p = await probe(page);
  expect(p.played).toBe(0);
  expect(p.pose).toEqual(CORNER);
  expect(p.laid).toBe(0);
  expect(p.parts.blocks).toBe(10);
});

test("window-shapes, ?nowebgl: the 3D step stays in 2D and reads there", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator('[data-ref="view3d"]')).toBeDisabled();
  await expect(host.locator(".anim-figure__hint--webgl")).toHaveText("3D needs WebGL 2");
  const next = host.locator('[data-step="next"]');
  for (let i = 0; i < 3; i += 1) await next.click();
  await expect(host.locator(".anim-steps > li:not([hidden])")).toContainText("the whole family stands in a row");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator('[data-role="r-step"]')).toHaveText("0.16 out of a possible 2.00");
});

test("window-shapes 3D: toggling five times quickly leaves one view or none, never a stray", async ({ page }) => {
  const host = await open(page);
  const button = host.locator('[data-ref="view3d"]');
  for (let i = 0; i < 5; i += 1) await button.click();
  await page.waitForTimeout(800);
  await settle(page, host);
  const pressed = await button.getAttribute("aria-pressed");
  await expect(page.locator(CANVAS_3D)).toHaveCount(pressed === "true" ? 1 : 0);
  await expect(host.locator(".anim-chip-layer")).toHaveCount(pressed === "true" ? 1 : 0);
  await expect(host.getByRole("group", { name: "Zoom" })).toHaveCount(pressed === "true" ? 1 : 0);
});

test("window-shapes 3D at 1280 px: the frame keeps its shape across the 3D control", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const frame = host.locator(".anim-figure__frame");
  const flat = await frame.boundingBox();
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const deep = await frame.boundingBox();
  expect(Math.abs((deep?.height ?? 0) - (flat?.height ?? 0))).toBeLessThanOrEqual(1);
});

test("window-shapes: the steps pick the view, 3D only for the family", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const toggle = host.locator('[data-ref="view3d"]');
  const next = host.locator('[data-step="next"]');
  for (const want of ["false", "false", "false", "true"]) {
    await expect(toggle).toHaveAttribute("aria-pressed", want);
    if (want === "true") await page.locator(CANVAS_3D).waitFor();
    else await expect(page.locator(CANVAS_3D)).toHaveCount(0);
    if ((await next.textContent()) === "Next") await next.click();
  }
  await host.locator('[data-step="prev"]').click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
});
