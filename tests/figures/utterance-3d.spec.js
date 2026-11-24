// The utterance figure's 3D view (anim-utterance-3d.js): the front view,
// laid end to end, is the 2D closeup; the animation's end state; the
// highlight; the opening rule; and the phone layout.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "01-why-sinusoids/";
const CANVAS_3D = "canvas.anim-figure__canvas--3d";

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  const figures = /** @type {any} */ (window).__ambeAnim.figures;
  const p = figures["utterance-3d"];
  return {
    rect: figures.utterance.rect(),
    state: figures.utterance.state(),
    pose: p.pose, zoom: p.zoom, layout: p.layout, fold: p.fold, stretch: p.stretch, played: p.played,
    frontPoints: p.frontPoints, markerPoints: p.markerPoints,
  };
});

/**
 * Open the page and go to step 2, the first step that asks for 3D (step 1
 * is the flat closeup).
 * @param {import("@playwright/test").Page} page
 */
async function open3D(page) {
  await page.goto(PAGE);
  const host = page.locator('[data-anim="utterance"]');
  await settle(page, host);
  await host.getByRole("button", { name: "Next" }).click();
  await host.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  return host;
}

/**
 * Go to step `n` (1-based) from step 2, where open3D leaves the figure,
 * and land every animation.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 * @param {number} n
 */
async function step(page, host, n) {
  for (let i = 2; i < n; i += 1) await host.getByRole("button", { name: "Next" }).click();
  await settle(page, host);
}

for (const width of [1280, 375]) {
  test(`at ${width} px, Front laid end to end puts every vertex and every period mark on the 2D closeup within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open3D(page);
    // No step lays the periods out at the Front: the controls do.
    await host.getByRole("button", { name: "Laid end to end" }).click();
    await host.locator('button[data-preset="front"]').click();
    await settle(page, host);
    const p = await probe(page);
    expect(p.layout).toBe("laid");
    expect(p.pose).toEqual({ yaw: 0, pitch: 0 });
    expect(p.zoom).toBe(1);
    expect(p.fold.every((/** @type {number} */ f) => f === 0)).toBe(true);
    expect(p.stretch).toBe(0);
    // The 2D mapping (createPlot): x over 0 to 60 ms, y over -1 to 1.
    const X = (/** @type {number} */ ms) => p.rect.x + (ms / 60) * p.rect.width;
    const Y = (/** @type {number} */ y) => p.rect.y + ((1 - y) / 2) * p.rect.height;
    expect(p.frontPoints.length).toBeGreaterThan(480);
    let worst = 0;
    for (const v of p.frontPoints) worst = Math.max(worst, Math.abs(v.px - X(v.ms)), Math.abs(v.py - Y(v.y)));
    expect(worst).toBeLessThanOrEqual(0.5);
    // The ten 2D period marks, from the largest sample one period apart.
    expect(p.markerPoints).toHaveLength(10);
    const t0 = (63 / 8000) * 1000;
    p.markerPoints.forEach((/** @type {{px: number, top: number, bottom: number}} */ m, k) => {
      expect(Math.abs(m.px - X(t0 + (k * 1000) / 185.9))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(m.top - p.rect.y)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(m.bottom - (p.rect.y + p.rect.height))).toBeLessThanOrEqual(0.5);
    });
    // The overlay draws the closeup's axis over the front view.
    expect(p.state.face).toBe("all");
    // The chip sits on the closeup, below the strip's time axis (whose
    // labels end about 12 px above the closeup).
    const frame = await host.locator(".anim-figure__frame").boundingBox();
    const chip = await host.locator(".anim-chip").boundingBox();
    if (!frame || !chip) throw new Error("no frame or chip");
    expect(chip.y - frame.y).toBeGreaterThanOrEqual(p.rect.y - 10);
    expect(chip.y + chip.height - frame.y).toBeLessThanOrEqual(p.rect.y + p.rect.height + 0.5);
  });
}

test("opens in 3D and lands the animation on its end state: every period stacked, one period across, at the Corner", async ({ page }) => {
  const host = await open3D(page);
  const p = await probe(page);
  expect(p.played).toBe(1);
  expect(p.layout).toBe("stacked");
  expect(p.fold.every((/** @type {number} */ f) => f === 1)).toBe(true);
  expect(p.stretch).toBe(1);
  expect(p.pose).toEqual({ yaw: -24, pitch: 30 });
  // Stacked, every period starts at 0 ms: the stacked vertices span one period.
  const ms = p.frontPoints.map((/** @type {{px: number}} */ v) => v.px);
  expect(Math.max(...ms) - Math.min(...ms)).toBeGreaterThan(100);
  // The overlay is out of the way of the turned stack.
  expect(p.state.face).toBe("none");
  const over = host.locator("canvas.anim-utterance__over");
  await expect(over).toHaveAttribute("data-away", "");
  await expect(over).toHaveAttribute("aria-hidden", "true");
  await expect(over).toHaveCSS("opacity", "0");
  await expect(host.locator(".anim-chip")).toHaveText("one period: 5.38 ms");
  await expect(host.locator(CANVAS_3D)).toHaveAttribute("aria-label", /stacked in depth.*The thick slice holds the window's largest sample\./);
});

test("the fricative morphs in place and its chip says whose period cuts it", async ({ page }) => {
  const host = await open3D(page);
  await step(page, host, 3);
  const p = await probe(page);
  expect(p.state.which).toBe("unvoiced");
  expect(p.layout).toBe("stacked");
  await expect(host.locator(".anim-chip")).toHaveText("the vowel's period: 5.38 ms");
  await expect(host.locator('[data-role="r-periods"]')).toContainText("no two alike");
  await expect(host.locator(CANVAS_3D)).toHaveAttribute("aria-label", /No two slices agree/);
});

test("after a window change the context fills follow the new highlight, as a fresh open on that window draws them", async ({ page }) => {
  const host = await open3D(page);
  await step(page, host, 3);
  /** @returns {Promise<{highlight: number, fills: {piece: number, visible: boolean}[]}>} */
  const fills = () => page.evaluate(() => {
    const p = /** @type {any} */ (window).__ambeAnim.figures["utterance-3d"];
    return { highlight: p.highlight, fills: p.fills };
  });
  const switched = await fills();
  // The fricative's largest sample lies in its first whole period.
  expect(switched.highlight).toBe(1);
  expect(switched.fills.find((f) => f.piece === switched.highlight)?.visible).toBe(false);
  // A fresh build on the fricative: leave 3D and come back.
  const toggle = host.locator('[data-ref="view3d"]');
  await toggle.click();
  await settle(page, host);
  await toggle.click();
  await host.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect(await fills()).toEqual(switched);
});

test("the highlight keeps 3:1 against the plot and the stage, in both themes", async ({ page }) => {
  const host = await open3D(page);
  /** @param {string} hex */
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const scheme of ["slate", "default"]) {
    const [hi, ...grounds] = await host.locator(".anim-figure__frame").evaluate((frame, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(frame);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    for (const g of grounds) {
      const [a, b] = [lum(hi), lum(g)].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05), `${scheme}: ${hi} on ${g}`).toBeGreaterThanOrEqual(3);
    }
  }
});

test("reduced motion opens 2D and asks for nothing 3D, even on a step that asks for it, until the 3D control, which lands on the end state at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/anim-utterance-3d\.js|three\.module/.test(r.url())) asked.push(r.url()); });
  await page.goto(PAGE);
  const host = page.locator('[data-anim="utterance"]');
  await settle(page, host);
  // Step 1 is the flat closeup, with no 3D control. Step 2 asks for 3D.
  await expect(host.locator('.anim-controls [data-ref="view3d"]')).toBeHidden();
  await host.getByRole("button", { name: "Next" }).click();
  await settle(page, host);
  await expect(host.locator(CANVAS_3D)).toHaveCount(0);
  expect(asked).toEqual([]);
  await expect(host.locator('[data-role="layout"]')).toBeHidden();
  await host.locator('.anim-controls [data-ref="view3d"]').click();
  await host.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const p = await probe(page);
  expect(p.played).toBe(0);
  expect(p.fold.every((/** @type {number} */ f) => f === 1)).toBe(true);
  expect(p.stretch).toBe(1);
  expect(p.pose).toEqual({ yaw: -24, pitch: 30 });
  await expect(host.locator('[data-role="layout"]')).toBeVisible();
});

test("five quick presses of 3D leave one view or none, and no stray overlay", async ({ page }) => {
  const host = await open3D(page);
  const button = host.locator('.anim-controls [data-ref="view3d"]');
  for (let i = 0; i < 5; i += 1) await button.click();
  await settle(page, host);
  // Five presses from 3D end in 2D.
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(host.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator("canvas")).toHaveCount(1);
  await expect(host.locator("canvas")).not.toHaveClass(/anim-utterance__over/);
  await expect(host.locator("canvas")).not.toHaveAttribute("aria-hidden", "true");
  await expect(host.locator(".anim-chip")).toHaveCount(0);
  await expect(host.locator(".anim-figure__canvas").first()).toBeVisible();
  // Figure 1.1 above it may hold its own 3D view; this figure leaves none.
  const others = await page.locator("canvas.anim-figure__canvas--3d").count();
  expect(await page.evaluate(() => /** @type {any} */ (window).__ambeAnim.liveContexts)).toBe(others);
});

test("on a 375 px phone: no sideways scroll, and the chip and labels sit inside the frame", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open3D(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  if (!frame) throw new Error("no frame");
  for (const node of await host.locator(".anim-chip, .anim-figure__label:not([hidden])").all()) {
    const box = await node.boundingBox();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(frame.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(box.y).toBeGreaterThanOrEqual(frame.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
  }
});

test("a context loss pauses the view behind the resume button, and resuming builds it again", async ({ page }) => {
  const host = await open3D(page);
  const before = await page.evaluate(() => /** @type {any} */ (window).__ambeAnim.figures["utterance-3d"].builds);
  await host.locator(CANVAS_3D).evaluate((c) => {
    /** @type {HTMLCanvasElement} */ (c).getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  const resume = host.locator(".anim-figure__resume");
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(resume).toBeHidden();
  await settle(page, host);
  const after = await page.evaluate(() => /** @type {any} */ (window).__ambeAnim.figures["utterance-3d"].builds);
  expect(after).toBeGreaterThan(before);
  const p = await probe(page);
  expect(p.fold.every((/** @type {number} */ f) => f === 1)).toBe(true);
});
