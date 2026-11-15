// lib/view-switch.js through the fixture's data-view="auto" host and its
// 3D part, anim-fixture-3d.js (design §3.4, owner decision O1).
import { test, expect } from "@playwright/test";
import { gate, hook, useFixture } from "./helpers.js";

const PAGE = "14-how-to-measure/";
const HOST = '[data-anim="fixture"][data-fixture-index="0"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;
const FLAT = `${HOST} canvas:not(.anim-figure__canvas--3d)`;

/**
 * @param {import("@playwright/test").Page} page
 * @param {{query?: string, lead?: number, headOn?: boolean, count?: number, gap?: number}} [options]
 * @returns {Promise<string[]>} the URLs of 3D requests, filled as they come
 */
async function open(page, { query = "", lead = 0, headOn = false, count = 1, gap = 0 } = {}) {
  /** @type {string[]} */
  const requested = [];
  page.on("request", (r) => {
    if (/\/vendor\/three\/|anim-fixture-3d\.js/.test(r.url())) requested.push(r.url().split("/").pop() || "");
  });
  await useFixture(page, { chapters: [PAGE], view: "auto", lead, headOn, count, gap });
  await page.goto(`${PAGE}${query}`);
  await page.locator(`${HOST}.is-enhanced`).waitFor();
  return requested;
}

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const p = window.__fixtures[0];
  return { views: p.views, intros: p.intros, headOn: p.headOn, pose: p.pose, builds: p.builds };
});

test("motion allowed: opens in 3D with its intro, once, and hides 2D after the first draw", async ({ page }) => {
  const requested = await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await probe(page)).views).toEqual(["3d"]);
  await expect(page.locator(FLAT)).toBeHidden();
  await expect(page.locator(`${HOST} [data-ref="view3d"]`)).toHaveAttribute("aria-pressed", "true");
  expect((await probe(page)).intros).toEqual([true]);
  expect((await hook(page)).played).toEqual({ "fixture-0": 1 });
  expect(requested).toContain("anim-fixture-3d.js");
  // Leaving and coming back does not replay the intro.
  const button = page.locator(`${HOST} [data-ref="view3d"]`);
  await button.click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator(FLAT)).toBeVisible();
  await button.click();
  await page.locator(CANVAS_3D).waitFor();
  expect((await probe(page)).intros).toEqual([true, false]);
  expect((await hook(page)).played).toEqual({ "fixture-0": 1 });
});

test("motion allowed: nothing 3D is requested before the frame comes near", async ({ page }) => {
  const requested = await open(page, { lead: 4000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  expect(requested).toEqual([]);
  expect((await hook(page)).liveContexts).toBe(0);
  await page.locator(HOST).scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  expect(requested).toContain("anim-fixture-3d.js");
  expect(requested).toContain("three.module.min.js");
});

test("reduced motion: opens in 2D and requests nothing 3D until the control is pressed, then lands with no intro", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requested = await open(page);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  expect(requested).toEqual([]);
  await expect(page.locator(FLAT)).toBeVisible();
  const button = page.locator(`${HOST} [data-ref="view3d"]`);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await page.locator(CANVAS_3D).waitFor();
  expect((await probe(page)).intros).toEqual([false]);
  expect((await hook(page)).played).toEqual({});
});

for (const motion of /** @type {const} */ (["no-preference", "reduce"])) {
  test(`?nowebgl, motion ${motion}: the control is disabled with the hint from the start`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    const requested = await open(page, { query: "?nowebgl" });
    const button = page.locator(`${HOST} [data-ref="view3d"]`);
    await expect(button).toBeDisabled();
    await expect(page.locator(`${HOST} .anim-figure__hint--webgl`)).toHaveText("3D needs WebGL 2");
    await expect(page.locator(FLAT)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(requested).toEqual([]);
  });
}

test("pressed twice while the 3D part loads: no view opens, and a later press still does", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const held = gate();
  await page.route("**/javascripts/anim-fixture-3d.js", async (route) => {
    await held.wait;
    await route.fallback();
  });
  await open(page);
  const button = page.locator(`${HOST} [data-ref="view3d"]`);
  await button.click(); // on
  await button.click(); // off, before the part has loaded
  held.release();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toBeEnabled();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator(FLAT)).toBeVisible();
  expect((await hook(page)).liveContexts).toBe(0);
  await button.click();
  await page.locator(CANVAS_3D).waitFor();
  expect((await hook(page)).liveContexts).toBe(1);
});

test("on, off and on again while three.js loads: the second request opens, and the control stays usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const held = gate();
  await page.route("**/vendor/three/three.module.min.js", async (route) => {
    await held.wait;
    await route.fallback();
  });
  await open(page);
  const button = page.locator(`${HOST} [data-ref="view3d"]`);
  const asked = page.waitForRequest(/three\.module\.min\.js/);
  await button.click(); // on: the first view starts and waits for three
  await asked;
  await button.click(); // off: that request is no longer wanted
  await button.click(); // on again, while the first is still pending
  held.release();
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(300);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${HOST} .anim-figure__hint--webgl`)).not.toHaveText("3D needs WebGL 2");
  await expect(page.locator(CANVAS_3D)).toHaveCount(1);
  expect((await hook(page)).liveContexts).toBe(1);
});

test("pressed five times quickly: no stray context, canvas or scrim", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const button = page.locator(`${HOST} [data-ref="view3d"]`);
  for (let i = 0; i < 5; i += 1) await button.click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  // Five presses from 3D end in 2D.
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator(`${HOST} .anim-figure__resume`)).toHaveCount(0);
  await expect(page.locator(FLAT)).toBeVisible();
  expect((await hook(page)).liveContexts).toBe(0);
});

test("a parked view shows its 2D canvas, and unparks into 3D", async ({ page }) => {
  await open(page, { query: "?three-cap=1", count: 2, gap: 2400 });
  await page.locator(CANVAS_3D).waitFor();
  await page.locator('[data-anim="fixture"][data-fixture-index="1"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(page.locator(`${HOST} .anim-figure__frame`)).toHaveAttribute("data-three", "parked");
  await expect(page.locator(FLAT)).toBeVisible();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await page.locator(HOST).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.locator(CANVAS_3D).waitFor();
  await expect(page.locator(FLAT)).toBeHidden();
  expect((await probe(page)).views).toEqual(["3d", "parked", "3d"]);
  // The unpark replays nothing.
  expect((await probe(page)).intros).toEqual([true]);
});

test("headOn: Front only, no yaw drag, other presets refused", async ({ page }) => {
  await open(page, { headOn: true });
  await page.locator(CANVAS_3D).waitFor();
  expect((await probe(page)).headOn).toEqual([true]);
  const box = await page.locator(CANVAS_3D).boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await probe(page)).pose).toEqual({ yaw: 0, pitch: 0 });
  const refused = await page.evaluate(() => {
    // @ts-ignore test-only global
    const sw = window.__fixtures[0].switch;
    return [sw.preset("corner"), sw.preset("front")];
  });
  expect(refused).toEqual([false, true]);
});

test("not headOn: a sideways drag turns the view", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.locator(`${HOST} [data-ref="view3d"]`).click();
  await page.locator(CANVAS_3D).waitFor();
  const before = (await probe(page)).pose;
  // Pressing 3D scrolled to the button, which can leave the canvas above the screen.
  await page.locator(CANVAS_3D).evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await page.locator(CANVAS_3D).boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await probe(page)).pose?.yaw).not.toBe(before?.yaw);
});
