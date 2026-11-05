// The leakage figure's 3D view (plan N2, three-everywhere design §5.2):
// Front, with the field hidden, puts the reader's stem tips on the 2D
// stems within 0.5 px; the first view plays once and lands on the corner
// with every row grown; Hann morphs every row to its end state; reduced
// motion and ?nowebgl stay in 2D; the steps read the same either way.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "03-windows-and-frames/";
const HOST = '[data-anim="leakage"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  // Step 1 is a flat spectrum, so the figure opens in 2D.
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  return host;
}

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test hook
  const p = window.__ambeAnim.figures["leakage-3d"];
  return { played: p.played, pose: p.pose(), zoom: p.zoom(), grown: p.grown, parts: p.parts, looking: p.looking, selected: p.selected };
});

for (const width of [1280, 375]) {
  test(`leakage 3D at ${width} px: Front hides the field and puts the stem tips on the 2D stems, within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page);
    // Half a bin off, so every tip sits somewhere different.
    await host.locator('[data-role="cycles"]').fill("650");
    await host.locator('button[data-preset="front"]').click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    await page.waitForTimeout(100);
    const result = await page.evaluate(async () => {
      const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
      const mod = await import(new URL("anim-leakage.js", script.src).href);
      const frame = /** @type {HTMLElement} */ (document.querySelector('[data-anim="leakage"] .anim-figure__frame'));
      const { plot } = mod.layout(frame.clientWidth, frame.clientHeight);
      // @ts-ignore test hook
      const p = window.__ambeAnim.figures["leakage-3d"];
      return {
        zoom: p.zoom(),
        looking: p.looking,
        parts: p.parts,
        pairs: p.frontPoints.map((/** @type {any} */ q) => ({ got: p.project(q.at), want: [plot.x(q.bin), plot.y(q.db)] })),
      };
    });
    expect(result.zoom).toBe(1);
    expect(result.looking).toBe("front");
    expect(result.parts.field).toBe(false);
    expect(result.parts.sheet).toBe(false);
    expect(result.pairs).toHaveLength(81);
    for (const { got, want } of result.pairs) {
      expect(Math.abs(got[0] - want[0]), "x").toBeLessThanOrEqual(0.5);
      expect(Math.abs(got[1] - want[1]), "y").toBeLessThanOrEqual(0.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("leakage 3D: the first view plays once and lands on the corner with every row grown", async ({ page }) => {
  const host = await open(page);
  const p = await probe(page);
  expect(p.played).toBe(1);
  expect(await page.evaluate(() => window.__ambeAnim.played.leakage)).toBe(1);
  expect(p.pose).toEqual({ yaw: 26, pitch: 38 });
  expect(p.grown).toEqual(new Array(21).fill(1));
  expect(p.parts.field).toBe(true);
  await expect(host.locator(".anim-chip")).toHaveText("6.00 cycles: 1 bin above −40 dB");
  await expect(host.locator('button[data-preset="corner"]')).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator('[data-ref="legend-3d"]')).toBeVisible();
  await expect(host.locator('[data-ref="legend-2d"]')).toBeHidden();
  await expect(host.locator('[data-ref="legend-3d"]')).toContainText("(thick, outlined)");
  // Leaving 3D and coming back does not play it again.
  const toggle = host.locator('[data-ref="view3d"]');
  await toggle.click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect((await probe(page)).played).toBe(0);
  expect(await page.evaluate(() => window.__ambeAnim.played.leakage)).toBe(1);
});

test("leakage 3D: half a bin off the chip counts all 81 bins, and Hann morphs every row to its own levels", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="cycles"]').fill("650");
  await expect(host.locator(".anim-chip")).toHaveText("6.50 cycles: all 81 bins above −40 dB");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /6\.50 cycles, with all 81 bins above −40 dB/);
  await host.locator('[data-ref="weak"]').click();
  await host.locator('button[data-window="hann"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const rows = await page.evaluate(() => {
    // @ts-ignore test hook
    const p = window.__ambeAnim.figures["leakage-3d"];
    return { r10: p.shown(10), r0: p.shown(0) };
  });
  expect(rows.r10.slice(28, 33).map((/** @type {number} */ v) => Number(v.toFixed(1)))).toEqual([-86.6, -55.1, -49, -55.1, -90.8]);
  // On a bin, Hann gives three bins: the peak and two at -6.02 dB.
  expect(rows.r0.slice(5, 8).map((/** @type {number} */ v) => Number(v.toFixed(2)))).toEqual([-6.02, 0, -6.02]);
  await expect(host.locator(".anim-chip")).toHaveText("6.50 cycles: 6 bins above −40 dB");
});

test("leakage 3D: a new setting moves the highlight to its row", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="cycles"]').fill("690");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page)).selected).toBe(18);
  await expect(host.locator(".anim-chip")).toHaveText("6.90 cycles: 16 bins above −40 dB");
});

test("leakage, reduced motion: opens in 2D, loads nothing 3D, and the 3D control lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => {
    if (/anim-leakage-3d\.js|vendor\/three\//.test(r.url())) requests.push(r.url());
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
  expect(p.pose).toEqual({ yaw: 26, pitch: 38 });
  expect(p.grown).toEqual(new Array(21).fill(1));
});

test("leakage, ?nowebgl: the field step stays in 2D and reads there", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator('[data-ref="view3d"]')).toBeDisabled();
  await expect(host.locator(".anim-figure__hint--webgl")).toHaveText("3D needs WebGL 2");
  const next = host.locator('[data-step="next"]');
  await next.click();
  await next.click();
  await expect(host.locator(".anim-steps > li:not([hidden])")).toContainText("stands one behind the other");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator("canvas.anim-figure__canvas")).toHaveAttribute("aria-label", /6\.10 cycles/);
  await expect(host.locator('[data-role="r-count"]')).toHaveText("13 of 81");
});

test("leakage 3D: toggling five times quickly leaves one view or none, never a stray", async ({ page }) => {
  const host = await open(page);
  const button = host.locator('[data-ref="view3d"]');
  for (let i = 0; i < 5; i += 1) await button.click();
  await page.waitForTimeout(800);
  await settle(page, host);
  const pressed = await button.getAttribute("aria-pressed");
  await expect(page.locator(CANVAS_3D)).toHaveCount(pressed === "true" ? 1 : 0);
  await expect(host.locator(".anim-chip-layer")).toHaveCount(pressed === "true" ? 1 : 0);
  await expect(host.getByRole("group", { name: "Zoom" })).toHaveCount(pressed === "true" ? 1 : 0);
  expect(await page.evaluate(() => window.__ambeAnim.liveContexts)).toBeLessThanOrEqual(1);
});

test("leakage 3D at 1280 px: the frame keeps its shape across the 3D control, so the page does not move", async ({ page }) => {
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
  expect(flat && deep).toBeTruthy();
  expect(Math.abs((deep?.height ?? 0) - (flat?.height ?? 0))).toBeLessThanOrEqual(1);
  expect((flat?.width ?? 0) / (flat?.height ?? 1)).toBeGreaterThan(1.2);
});

test("leakage: the steps pick the view, 3D only for the stack of spectra", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const toggle = host.locator('[data-ref="view3d"]');
  const next = host.locator('[data-step="next"]');
  for (const want of ["false", "false", "true", "false", "false", "false"]) {
    await expect(toggle).toHaveAttribute("aria-pressed", want);
    if (want === "true") {
      await page.locator(CANVAS_3D).waitFor();
      await settle(page, host);
      await page.evaluate(() => window.__ambeAnim?.finishAll());
      const p = await probe(page);
      expect(p.parts.field).toBe(true);
      expect(p.pose).toEqual({ yaw: 26, pitch: 38 });
    } else {
      await expect(page.locator(CANVAS_3D)).toHaveCount(0);
    }
    if ((await next.textContent()) === "Next") await next.click();
  }
  // The last step reads the peak on the flat spectrum: three bins.
  await expect(host.locator('[data-role="r-count"]')).toHaveText("3 of 81");
});

test("leakage 3D: colouring a frame of the intro makes no new MediaQueryList (WebKit spent 30 ms a frame on them)", async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    // @ts-ignore test counter
    window.__mediaQueries = 0;
    window.matchMedia = (/** @type {string} */ query) => {
      // @ts-ignore test counter
      window.__mediaQueries += 1;
      return real(query);
    };
  });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(() => page.evaluate(() => window.__ambeAnim.played.leakage)).toBe(1);
  // @ts-ignore test counter
  const before = await page.evaluate(() => window.__mediaQueries);
  // Let the intro run for half a second: some 30 frames of 3,200 vertex colours.
  await page.waitForTimeout(500);
  // @ts-ignore test counter
  const during = (await page.evaluate(() => window.__mediaQueries)) - before;
  expect(during).toBeLessThan(10);
});
