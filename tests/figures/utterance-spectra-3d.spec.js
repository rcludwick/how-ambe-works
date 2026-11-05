// utterance-spectra's 3D view (three-everywhere plan F3): Front equals the
// 2D bottom panel, the wall property, the cutaway, the first-view animation's
// end state and the opening rule.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const PAGE = "01-why-sinusoids/";

// The suite renders WebGL in software: a whole sentence of slices takes a
// while to draw, the more so on a busy machine.
test.describe.configure({ timeout: 90_000 });
const HOST = '[data-anim="utterance-spectra"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {import("@playwright/test").Page} page @param {string} expr */
const probe3d = (page, expr) =>
  page.evaluate((e) => {
    const f = /** @type {any} */ (window.__ambeAnim?.figures["utterance-spectra-3d"]);
    return f ? new Function("f", `return (${e})`)(f) : null;
  }, expr);

/** @param {import("@playwright/test").Page} page */
async function open3D(page, query = "") {
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await host.scrollIntoViewIfNeeded();
  // Steps 1 and 2 are single spectra, in 2D; step 3 asks for 3D.
  for (let i = 0; i < 2; i += 1) await host.locator('[data-step="next"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  return host;
}

/** @param {import("@playwright/test").Page} page @param {import("@playwright/test").Locator} host @param {string} name */
async function preset(page, host, name) {
  await host.locator(`button[data-preset="${name}"]`).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(100);
}

/**
 * Where the 2D panel's mapping puts the selected window, in the 3D frame:
 * the panel's rectangle as Front fits it (the same scale, lifted so the
 * axis labels clear the frame's bottom), against what the highlight draws.
 * @param {import("@playwright/test").Page} page
 */
const frontCheck = (page) => page.evaluate(() => {
  const two = /** @type {any} */ (window.__ambeAnim?.figures["utterance-spectra"]);
  const three = /** @type {any} */ (window.__ambeAnim?.figures["utterance-spectra-3d"]);
  const panel = two.plotRect();
  const rect = three.frontRect();
  const nyquist = two.nyquist();
  const expected = two.points().map((/** @type {{x: number, y: number}} */ p) =>
    [rect.x + (p.x / nyquist) * rect.width, rect.y + (-p.y / 85) * rect.height]);
  const got = three.frontPoints();
  let worst = got.length === expected.length ? 0 : Infinity;
  got.forEach((/** @type {number[]} */ [x, y], /** @type {number} */ i) => {
    worst = Math.max(worst, Math.abs(x - expected[i][0]), Math.abs(y - expected[i][1]));
  });
  return { worst, panel, rect, context: three.contextShown(), zoom: three.zoom, frame: two.state().frame,
    curtainsFrom: three.curtainsFrom(), height: /** @type {HTMLElement} */ (document.querySelector(
      '[data-anim="utterance-spectra"] .anim-figure__frame')).clientHeight };
});

for (const width of [1280, 375]) {
  test(`Front at ${width} px: the highlight lands on the 2D panel's mapping within 0.5 px, other slices hidden`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open3D(page);
    await preset(page, host, "front");
    const result = await frontCheck(page);
    expect(result.zoom).toBe(1);
    expect(result.worst).toBeLessThanOrEqual(0.5);
    expect(result.context).toBe(false);
    // The panel's own size and scale, lifted so the frequency ticks and
    // name sit above the frame's bottom 56 px.
    expect(result.rect.width).toBe(result.panel.width);
    expect(result.rect.height).toBe(result.panel.height);
    expect(result.rect.x).toBe(result.panel.x);
    expect(result.height - (result.rect.y + result.rect.height)).toBeGreaterThanOrEqual(56 + 30);
    await expect(host.locator(".anim-figure__label", { hasText: "frequency, Hz" })).toBeVisible();
    await expect(host.locator(".anim-figure__label--tick", { hasText: "4k" })).toBeVisible();
    await expect(host.locator(".anim-figure__label--tick", { hasText: "-80" })).toBeVisible();
  });
}

test("the highlight, its fade and the cutaway follow the window on the same clip, as the slider moves", async ({ page }) => {
  const host = await open3D(page);
  await host.locator(".anim-range").evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = "62";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(page, host);
  await preset(page, host, "front");
  let result = await frontCheck(page);
  expect(result.frame).toBe(62);
  expect(result.worst).toBeLessThanOrEqual(0.5);
  await preset(page, host, "corner");
  expect(await probe3d(page, "f.curtainsFrom()")).toBe(63);
  await host.locator(".anim-range").evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = "100";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(page, host);
  expect(await probe3d(page, "f.curtainsFrom()")).toBe(101);
  expect(await probe3d(page, "f.chip()")).toBe("this frame: 20 ms at 2.00 s");
  await preset(page, host, "front");
  result = await frontCheck(page);
  expect(result.frame).toBe(100);
  expect(result.worst).toBeLessThanOrEqual(0.5);
});

test("Top labels time on the right edge without a 0 tick, and keeps the frequency name", async ({ page }) => {
  const host = await open3D(page);
  await preset(page, host, "top");
  const ticks = await host.locator(".anim-figure__label--tick:visible").allTextContents();
  expect(ticks.filter((t) => t === "0")).toHaveLength(1);
  expect(ticks).toEqual(expect.arrayContaining(["4k", "1", "2", "3"]));
  await expect(host.locator(".anim-figure__label", { hasText: "frequency, Hz" })).toBeVisible();
  await expect(host.locator(".anim-figure__label", { hasText: "time, s" })).toBeVisible();
});

test("the first view ends at Corner, played once, with the chip on the first step's window", async ({ page }) => {
  await open3D(page);
  expect((await hook(page)).played["utterance-spectra"]).toBe(1);
  expect(await probe3d(page, "f.played")).toBe(1);
  const pose = await probe3d(page, "f.pose");
  expect(pose.yaw).toBeCloseTo(42, 5);
  expect(pose.pitch).toBeCloseTo(24, 5);
  expect(await probe3d(page, "f.contextShown()")).toBe(true);
  expect(await probe3d(page, "f.chip()")).toBe("this frame: 20 ms at 0.48 s");
  expect(await probe3d(page, "f.slices()")).toBe(138);
});

test("the energy wall is never below a slice's highest point", async ({ page }) => {
  const host = await open3D(page);
  expect(await probe3d(page, "f.wallAboveSlices()")).toBe(true);
  await host.locator('button[data-sentence="a"]').click();
  await settle(page, host);
  expect(await probe3d(page, "f.slices()")).toBe(183);
  expect(await probe3d(page, "f.wallAboveSlices()")).toBe(true);
});

test("cutaway: at Corner only the curtains behind the selection; at Top all of them", async ({ page }) => {
  const host = await open3D(page);
  expect(await probe3d(page, "f.curtainsFrom()")).toBe(25);
  await preset(page, host, "top");
  expect(await probe3d(page, "f.curtainsFrom()")).toBe(0);
  await preset(page, host, "corner");
  expect(await probe3d(page, "f.curtainsFrom()")).toBe(25);
});

test("nothing 3D is requested before the figure comes near", async ({ page }) => {
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  await page.goto(PAGE);
  await expect(page.locator(HOST)).toHaveClass(/is-enhanced/);
  await page.waitForLoadState("networkidle");
  // utterance, at the top of ch01, opens in 3D there, so three itself may
  // already be loaded; this figure's part is not.
  expect(asked.filter((u) => /anim-utterance-spectra-3d\.js/.test(u))).toEqual([]);
  // Near the viewport, step 1 is one spectrum, in 2D: still nothing 3D.
  const host = page.locator(HOST);
  await host.scrollIntoViewIfNeeded();
  await settle(page, host);
  expect(asked.filter((u) => /anim-utterance-spectra-3d\.js/.test(u))).toEqual([]);
  for (let i = 0; i < 2; i += 1) await host.locator('[data-step="next"]').click();
  await page.locator(CANVAS_3D).waitFor();
  expect(asked.some((u) => u.includes("anim-utterance-spectra-3d.js"))).toBe(true);
});

test("reduced motion: opens in 2D, loads no 3D until asked, then lands at Corner with nothing played", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  expect(asked.filter((u) => u.includes("anim-utterance-spectra-3d.js"))).toEqual([]);
  await host.locator('button[data-view="3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const pose = await probe3d(page, "f.pose");
  expect(pose.yaw).toBeCloseTo(42, 5);
  expect(await probe3d(page, "f.played")).toBe(0);
  expect((await hook(page)).played["utterance-spectra"] ?? 0).toBe(0);
});

test("toggling 3D five times quickly leaves at most one view and no stray canvas", async ({ page }) => {
  // Under reduced motion the other ch01 figures stay in 2D, so every live
  // context on the page is this figure's. The control opens it in 3D.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const toggle = host.locator('button[data-view="3d"]');
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect((await hook(page)).liveContexts).toBe(1);
  for (let i = 0; i < 5; i += 1) await toggle.click();
  await settle(page, host);
  // Five presses from 3D end in 2D.
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect((await hook(page)).liveContexts).toBe(0);
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(1);
  expect((await hook(page)).liveContexts).toBe(1);
});

test("a step back to a single spectrum leaves 3D, and the 2D label follows its window", async ({ page }) => {
  const host = await open3D(page);
  await host.locator('[data-step="prev"]').click();
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  await expect(host.locator(".anim-figure__frame > canvas").first()).toHaveAttribute("aria-label", /window at 1\.24 s/);
});

test("context loss pauses the view and resume rebuilds it", async ({ page }) => {
  await open3D(page);
  const before = await probe3d(page, "f.builds");
  await page.locator(CANVAS_3D).evaluate((c) => {
    const gl = /** @type {HTMLCanvasElement} */ (c).getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_lose_context");
    ext?.loseContext();
    setTimeout(() => ext?.restoreContext(), 200);
  });
  await expect.poll(() => probe3d(page, "f.builds"), { timeout: 5000 }).toBeGreaterThan(before);
});

test("phone 375 px: no horizontal scroll, chip inside the frame", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open3D(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  const chip = await host.locator(".anim-chip").boundingBox();
  expect(frame && chip).toBeTruthy();
  if (!frame || !chip) return;
  expect(chip.x).toBeGreaterThanOrEqual(frame.x);
  expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(chip.y).toBeGreaterThanOrEqual(frame.y);
});
