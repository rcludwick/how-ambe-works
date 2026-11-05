// frames (ch08), its 3D view over the inset: Front folds rows i-1 to i+1
// onto the inset's samples, the first view lands on the windows in depth,
// the view comes and goes cleanly, and survives a lost context.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const PAGE = "08-analysis/";
const CANVAS_3D = '[data-anim="frames"] canvas.anim-figure__canvas--3d';

/** @param {import("@playwright/test").Page} page */
const host = (page) => page.locator('[data-anim="frames"]');
/** @param {import("@playwright/test").Page} page */
const probe3d = async (page) => /** @type {any} */ ((await hook(page)).figures["frames-3d"]);
/** @param {import("@playwright/test").Page} page */
const finish = async (page) => {
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(150);
};

/**
 * Open the page in normal motion, press 3D (the first step asks for 2D),
 * and wait for the 3D view's first animation to land.
 * @param {import("@playwright/test").Page} page
 */
async function open(page) {
  await page.goto(PAGE);
  const h = host(page);
  await h.locator(".frames__main").scrollIntoViewIfNeeded();
  await settle(page, h);
  await expect(h.locator('button[data-view="3d"]')).toBeEnabled();
  await h.locator('button[data-view="3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, h);
  return h;
}

test("opens in 2D on step 1; the 3D control lands on the end state of its animation: Corner, windows grown, the shared strips lit", async ({ page }) => {
  await page.goto(PAGE);
  await host(page).locator(".frames__main").scrollIntoViewIfNeeded();
  await settle(page, host(page));
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  const h = await open(page);
  const p = await probe3d(page);
  expect(p.played).toBe(true);
  expect(p.pose).toEqual({ yaw: 28, pitch: 22 });
  expect(p.zoom).toBe(1);
  await expect(h.locator(".anim-chip__text")).toHaveText("this frame's window: 255 samples");
  // One label on each floor strip that touches frame i.
  await expect(h.locator(".frames__overlay .anim-figure__label").filter({ hasText: "95 shared" })).toHaveCount(2);
  for (const label of await h.locator(".frames__overlay .anim-figure__label").filter({ hasText: "95 shared" }).all()) {
    await expect(label).toBeVisible();
  }
  expect(p.bands).toBe(0);
  await expect(h.locator('[aria-label="Camera"]')).toBeVisible();
  await expect(h.locator('button[data-view="lanes"]')).toBeHidden();
  // Before the frame is half seen, the rows wait in the inset; finishAll lands them.
  expect((await hook(page)).played.frames).toBe(1);
});

for (const track of /** @type {const} */ (["original", "decoded"])) {
  test(`Front with Windows off puts rows i-1 to i+1 on the inset's samples within 0.5 px (${track})`, async ({ page }) => {
    const h = await open(page);
    await h.locator('[data-role="windows"]').click();
    if (track === "decoded") await h.locator('[data-track="decoded"]').click();
    await h.locator('button[data-preset="front"]').click();
    await finish(page);
    const p = await probe3d(page);
    expect(p.pose).toEqual({ yaw: 0, pitch: 0 });
    const flat = /** @type {{u: number, x: number, y: number}[]} */ ((await hook(page)).figures.frames.points);
    const deep = /** @type {{u: number, x: number, y: number}[]} */ (p.frontPoints);
    // The rows' union is the inset's samples exactly: u from -160 to 319.
    expect(deep.map((q) => q.u)).toEqual(Array.from({ length: 480 }, (_, i) => i - 160));
    expect(flat.map((q) => q.u)).toEqual(deep.map((q) => q.u));
    let worst = 0;
    deep.forEach((q, i) => {
      worst = Math.max(worst, Math.abs(q.x - flat[i].x), Math.abs(q.y - flat[i].y));
    });
    expect(worst).toBeLessThan(0.5);
  });
}

test("a frame change keeps the pose; Top looks down on the windows", async ({ page }) => {
  const h = await open(page);
  await h.locator('[data-role="frame"]').evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("no range");
    el.value = "60";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await finish(page);
  expect((await probe3d(page)).pose).toEqual({ yaw: 28, pitch: 22 });
  expect((await hook(page)).figures.frames.index).toBe(60);
  await h.locator('button[data-preset="top"]').click();
  await finish(page);
  expect((await probe3d(page)).pose.pitch).toBe(90);
  // From above the stack labels go; the chip stays.
  await expect(h.locator(".frames__overlay .anim-figure__label")).toHaveCount(0);
  await expect(h.locator(".anim-chip__text")).toBeVisible();
});

test("toggling 3D five times quickly leaves one view or none, no stray layer", async ({ page }) => {
  const h = await open(page);
  const toggle = h.locator('button[data-view="3d"]');
  for (let i = 0; i < 5; i += 1) await toggle.click();
  await settle(page, h);
  // An odd number of presses from 3D: 2D, with nothing left over.
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(h.locator(".frames__overlay > *")).toHaveCount(0);
  expect((await hook(page)).liveContexts).toBe(0);
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, h);
  expect((await hook(page)).liveContexts).toBe(1);
  // The first-view animation does not play again.
  expect((await hook(page)).played.frames).toBe(1);
});

test("context loss: paused, resume rebuilds on the same state", async ({ page }) => {
  const h = await open(page);
  const before = await probe3d(page);
  await page.locator(CANVAS_3D).evaluate((c) => {
    if (!(c instanceof HTMLCanvasElement)) throw new Error("no canvas");
    c.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(h.locator('.frames__overlay[data-state="paused"]')).toBeAttached();
  await h.locator(".anim-figure__resume").click();
  await expect.poll(async () => (await probe3d(page)).builds).toBe(before.builds + 1);
  expect((await probe3d(page)).pose).toEqual(before.pose);
  await expect(h.locator(".anim-chip__text")).toHaveText("this frame's window: 255 samples");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test("the chip sits inside the 3D frame", async ({ page }) => {
    const h = await open(page);
    const frame = await h.locator(".frames__overlay").boundingBox();
    const chip = await h.locator(".anim-chip").boundingBox();
    if (!frame || !chip) throw new Error("no boxes");
    expect(chip.x).toBeGreaterThanOrEqual(frame.x);
    expect(chip.y).toBeGreaterThanOrEqual(frame.y);
    expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(chip.y + chip.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
  });
});

test("Front with Windows on stands the two shared spans up as bands, labelled as on the inset", async ({ page }) => {
  const h = await open(page);
  await h.locator('button[data-preset="front"]').click();
  await finish(page);
  expect((await probe3d(page)).bands).toBeCloseTo(1, 5);
  const labels = h.locator(".frames__overlay .anim-figure__label");
  await expect(labels.filter({ hasText: "95 shared" })).toHaveCount(2);
  await expect(labels.filter({ hasText: /^frame 11[123]$/ })).toHaveCount(3);
  await expect(labels.filter({ hasText: /^one period, \d+ samples$/ })).toHaveCount(1);
  // No two labels overlap.
  const boxes = [];
  for (const l of await labels.all()) boxes.push(await l.boundingBox());
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const [a, b] = [boxes[i], boxes[j]];
    if (!a || !b) continue;
    const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    expect(apart).toBe(true);
  }
  // Turned away, the bands go and the floor strips speak.
  await h.locator('button[data-preset="corner"]').click();
  await finish(page);
  expect((await probe3d(page)).bands).toBe(0);
});

test("the steps pick the view: 2D, then 3D at Corner with the slide into depth on step 4, then 2D again", async ({ page }) => {
  await page.goto(PAGE);
  const h = host(page);
  await h.locator(".frames__main").scrollIntoViewIfNeeded();
  await settle(page, h);
  const toggle = h.locator('button[data-view="3d"]');
  await expect(toggle).toBeEnabled();
  for (let i = 0; i < 3; i += 1) {
    await expect(page.locator(CANVAS_3D), `step ${i + 1}`).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await h.locator('[data-step="next"]').click();
  }
  // Step 4 asks for depth.
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, h);
  await finish(page);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect((await probe3d(page)).pose).toEqual({ yaw: 28, pitch: 22 });
  // Step 5 is flat again.
  await h.locator('[data-step="next"]').click();
  await settle(page, h);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // With 3D open again by hand, going back to step 4 plays the slide into
  // depth again as the camera flies to Corner.
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, h);
  await finish(page);
  await h.locator('[data-step="prev"]').click();
  await settle(page, h);
  await finish(page);
  expect((await probe3d(page)).replays).toBeGreaterThanOrEqual(1);
  expect((await probe3d(page)).pose).toEqual({ yaw: 28, pitch: 22 });
});

for (const frameIndex of [3, 145]) {
  test(`a quiet frame next to loud ones keeps every row inside the box (frame ${frameIndex})`, async ({ page }) => {
    const h = await open(page);
    await h.locator('[data-role="windows"]').click();
    await h.locator('[data-role="frame"]').evaluate((el, i) => {
      if (!(el instanceof HTMLInputElement)) throw new Error("no range");
      el.value = String(i);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, frameIndex);
    await finish(page);
    expect((await probe3d(page)).maxY).toBeLessThanOrEqual(1);
    await expect(h.locator(".frames__legend")).toContainText("squeezed to fit");
  });
}
