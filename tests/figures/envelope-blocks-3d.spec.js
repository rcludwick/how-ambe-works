// envelope-blocks (ch09): its 3D view against its flat view, the opening
// rule (O1), the first-view animation and its end state, the highlight's
// chip, parking, the toggle, ?nowebgl and the phone width.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const PAGE = "09-quantization/";
const HOST = '[data-anim="envelope-blocks"]';

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  const f = /** @type {any} */ (window.__ambeAnim?.figures["envelope-blocks-3d"]);
  return f ? { builds: f.builds, played: f.played, pose: f.pose, zoom: f.zoom, progress: f.progress } : null;
});

/** @param {import("@playwright/test").Page} page */
async function open3D(page, query = "") {
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  // Step 1 is a flat graph and shows in 2D: the control opens 3D.
  const toggle = host.locator('.anim-controls button[data-view="3d"]');
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await host.locator("canvas.anim-figure__canvas--3d").waitFor();
  await settle(page, host);
  return host;
}

for (const vp of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
  test(`Front puts the selected slice on the flat view's points within 0.5 px at ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const host = await open3D(page);
    for (const k of ["5", "2", "1"]) {
      await host.locator('[data-ref="k"]').fill(k);
      await host.getByRole("button", { name: "Front" }).click();
      await page.evaluate(() => window.__ambeAnim?.finishAll());
      await page.waitForTimeout(100);
      const { flat, deep, zoom } = await page.evaluate(() => {
        const figures = /** @type {any} */ (window.__ambeAnim?.figures);
        return { flat: figures["envelope-blocks"].points2d(), deep: figures["envelope-blocks-3d"].frontPoints,
          zoom: figures["envelope-blocks-3d"].zoom };
      });
      expect(zoom).toBe(1);
      expect(deep).toHaveLength(flat.length);
      deep.forEach((/** @type {number[]} */ p, /** @type {number} */ i) => {
        expect(Math.abs(p[0] - flat[i][0]), `k ${k}, harmonic ${i + 1}, x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(p[1] - flat[i][1]), `k ${k}, harmonic ${i + 1}, y`).toBeLessThanOrEqual(0.5);
      });
    }
  });
}

test("opens in 2D at step 1; step 4 opens 3D, plays its animation once, and ends on Oblique with every slice in place", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  // Step 4: two coefficients per block, the slices stacked in depth.
  for (let i = 0; i < 3; i += 1) await host.locator('[data-step="next"]').click();
  await host.locator("canvas.anim-figure__canvas--3d").waitFor();
  await settle(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const p = await probe(page);
  expect(p?.played).toBe(1);
  expect(p?.pose).toEqual({ yaw: 28, pitch: 22 });
  // Every slice has peeled back into place.
  expect(p?.progress).toEqual([1, 1, 1, 1, 1]);
  expect((await hook(page)).played["envelope-blocks"]).toBe(1);
  await expect(host.locator(".anim-chip")).toHaveText("2 coefficients: 96.3% of the energy");
  await expect(host.locator('[data-ref="energy"]')).toHaveText("96.3%");
  await expect(host.locator('[data-ref="k-out"]')).toHaveText("2 of 5");
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveAttribute("aria-label", /2 coefficients: 96\.3% of the energy/);
});

test("nothing 3D is requested before a step asks for it", async ({ page }) => {
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/vendor\/three|envelope-blocks-3d/.test(r.url())) asked.push(r.url()); });
  await page.goto(PAGE);
  await page.locator(HOST).locator(".anim-figure").waitFor();
  await page.waitForLoadState("networkidle");
  expect(asked.filter((u) => u.includes("envelope-blocks-3d"))).toEqual([]);
  const host = page.locator(HOST);
  await settle(page, host);
  expect(asked.filter((u) => u.includes("envelope-blocks-3d"))).toEqual([]);
  for (let i = 0; i < 3; i += 1) await host.locator('[data-step="next"]').click();
  await host.locator("canvas.anim-figure__canvas--3d").waitFor();
  expect(asked.some((u) => u.includes("envelope-blocks-3d"))).toBe(true);
});

test("reduced motion opens 2D and asks for nothing 3D until the control, then lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/vendor\/three|envelope-blocks-3d/.test(r.url())) asked.push(r.url()); });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  expect(asked).toEqual([]);
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await host.locator('.anim-controls [data-view="3d"]').click();
  await host.locator("canvas.anim-figure__canvas--3d").waitFor();
  await settle(page, host);
  const p = await probe(page);
  expect(p?.played).toBe(0);
  expect(p?.pose).toEqual({ yaw: 28, pitch: 22 });
});

test("a park and unpark rebuilds the view and does not replay the animation", async ({ page }) => {
  const host = await open3D(page, "?three-cap=1");
  const before = await probe(page);
  // vq-space, far above, takes the only slot when it asks for 3D.
  const vq = page.locator('[data-anim="vq-space"]');
  await vq.scrollIntoViewIfNeeded();
  await settle(page, vq);
  const vqToggle = vq.locator('.anim-controls [data-dims="3"]');
  if ((await vqToggle.getAttribute("aria-pressed")) !== "true") await vqToggle.click();
  await expect.poll(async () => (await hook(page)).parks).toBeGreaterThan(0);
  await expect(host.locator(".anim-figure__frame")).toHaveAttribute("data-three", "parked");
  await host.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await hook(page)).unparks).toBeGreaterThan(0);
  await settle(page, host);
  const after = await probe(page);
  expect(after?.builds).toBeGreaterThan(before?.builds ?? 0);
  expect(after?.played).toBe(1);
  expect((await hook(page)).played["envelope-blocks"]).toBe(1);
});

test("toggling 3D five times quickly leaves at most one view and no stray canvas", async ({ page }) => {
  const host = await open3D(page);
  const toggle = host.locator('.anim-controls [data-view="3d"]');
  for (let i = 0; i < 5; i += 1) await toggle.click();
  await page.waitForTimeout(800);
  await settle(page, host);
  const on = (await toggle.getAttribute("aria-pressed")) === "true";
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(on ? 1 : 0);
  await expect(host.locator(".anim-chip-layer")).toHaveCount(on ? 1 : 0);
  expect((await hook(page)).liveContexts).toBeLessThanOrEqual(1);
});

test("?nowebgl: the steps stay in 2D and read there", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  for (let i = 0; i < 3; i += 1) {
    await host.locator('[data-step="next"]').click();
    await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
    await expect(host.locator(".anim-figure__frame > canvas")).toBeVisible();
  }
  // Step 4 keeps two coefficients per block.
  await expect(host.locator('[data-ref="k-out"]')).toHaveText("2 of 5");
  await expect(host.locator('[role="group"][aria-label="Camera"]')).toBeHidden();
});

test("phone, 375 px: no horizontal scroll, and the chip stays inside the frame at 1x and 6x", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open3D(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const inside = async () => {
    const frame = await host.locator(".anim-figure__frame").boundingBox();
    const chip = await host.locator(".anim-chip").boundingBox();
    if (!frame || !chip) throw new Error("no box");
    expect(chip.x).toBeGreaterThanOrEqual(frame.x);
    expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(chip.y).toBeGreaterThanOrEqual(frame.y);
  };
  await inside();
  const into = host.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 12 && (await into.isEnabled()); i += 1) {
    await into.click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
  }
  await page.waitForTimeout(300);
  await inside();
});
