// The window-shapes figure in 2D, under reduced motion so it opens there:
// each step's readouts carry the numbers its text gives, the canvas label
// follows the window, and a phone has no horizontal scroll.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "03-windows-and-frames/";
const HOST = '[data-anim="window-shapes"]';

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  return host;
}

/** What each step leaves in the readouts: window, ends, middle, step, energy. */
const STEPS = [
  ["rect", "1.00", "1.00", "2.00 out of a possible 2.00", "100.0% of the block's"],
  ["hann", "0.00", "1.00", "0.00 out of a possible 2.00", "37.5% of the block's"],
  ["hamming", "0.08", "1.00", "0.16 out of a possible 2.00", "39.7% of the block's"],
  ["hamming", "0.08", "1.00", "0.16 out of a possible 2.00", "39.7% of the block's"],
];

/** A phrase from each step's text. */
const TEXT = ["jumps where the next copy starts", "the jump at the joint disappears", "a small jump is left", "the whole family"];

test("window-shapes 2D: every step's readouts carry the numbers its text gives", async ({ page }) => {
  const host = await open(page);
  const next = host.locator('[data-step="next"]');
  for (const [index, [win, ends, middle, step, energy]] of STEPS.entries()) {
    if (index > 0) await next.click();
    await expect(host.locator(`button[data-window="${win}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(host.locator('[data-role="r-ends"]')).toHaveText(ends);
    await expect(host.locator('[data-role="r-middle"]')).toHaveText(middle);
    await expect(host.locator('[data-role="r-step"]')).toHaveText(step);
    await expect(host.locator('[data-role="r-energy"]')).toHaveText(energy);
    // The step text says what the readout shows at the joint.
    await expect(host.locator(".anim-steps > li:not([hidden])")).toContainText(TEXT[index]);
  }
  // Reduced motion: the last step's 3D request stays a request; the figure is in 2D.
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator(".anim-steps > li:not([hidden])")).toContainText("the whole family stands in a row");
});

test("window-shapes 2D: Previous lands each step's whole state", async ({ page }) => {
  const host = await open(page);
  const next = host.locator('[data-step="next"]');
  for (let i = 1; i < STEPS.length; i += 1) await next.click();
  for (let i = STEPS.length - 2; i >= 0; i -= 1) {
    await host.locator('[data-step="prev"]').click();
    await expect(host.locator(`button[data-window="${STEPS[i][0]}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(host.locator('[data-role="r-ends"]')).toHaveText(STEPS[i][1]);
  }
});

test("window-shapes 2D: the canvas label follows the window", async ({ page }) => {
  const host = await open(page);
  const canvas = host.locator("canvas.anim-figure__canvas");
  await expect(canvas).toHaveAttribute("aria-label", /rectangular window.*1\.00 at the block's ends.*a step of 2\.00 at the joint/);
  await host.locator('button[data-window="hann"]').click();
  await expect(canvas).toHaveAttribute("aria-label", /Hann window.*0\.00 at the block's ends.*no step at the joint/);
  await host.locator('button[data-window="hamming"]').click();
  await expect(canvas).toHaveAttribute("aria-label", /Hamming window.*0\.08 at the block's ends.*a step of 0\.16/);
});

test("window-shapes 2D at 375 px: no horizontal scroll, and the frame fits", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const box = await host.locator(".anim-figure__frame").boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
});
