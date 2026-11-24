// createTransport plays from where the reader put the figure: startFrame on
// first play, the scrubbed or stepped frame after that (design §5 M0).
// bits and synth start at frame 98, play on their own once scrolled into
// view, and step at 10 frames per second. synth has a second range and
// readout (Mix), so the frame controls are the first of each. bits and synth
// have step lists too, whose Step readout comes before their controls.
import { test, expect } from "@playwright/test";
import { frameOf } from "./helpers.js";

const PLAY_MS = 600; // about 6 frames at 10 fps
const SLACK = 15; // frames of tolerance for a slow machine

/**
 * @param {import("@playwright/test").Locator} host
 * @param {number} index
 */
async function scrubTo(host, index) {
  await host.locator(".anim-range").first().evaluate((el, i) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("no range");
    el.value = String(i);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, index);
}

test("bits autoplays from frame 98", async ({ page }) => {
  await page.goto("10-the-dstar-frame/");
  const host = page.locator('[data-anim="bits"]');
  await host.scrollIntoViewIfNeeded();
  await page.waitForTimeout(PLAY_MS);
  const frame = await frameOf(host.locator(".anim-controls .anim-readout").first());
  expect(frame).toBeGreaterThanOrEqual(98);
  expect(frame).toBeLessThanOrEqual(98 + SLACK);
});

test("bits: scrub to 20, then play, resumes at 20", async ({ page }) => {
  await page.goto("10-the-dstar-frame/");
  const host = page.locator('[data-anim="bits"]');
  await host.scrollIntoViewIfNeeded();
  await page.waitForTimeout(PLAY_MS);
  await scrubTo(host, 20);
  await expect(host.locator(".anim-controls .anim-readout").first()).toContainText("frame 20 ");
  await host.locator(".anim-btn--play").click();
  await page.waitForTimeout(PLAY_MS);
  const frame = await frameOf(host.locator(".anim-controls .anim-readout").first());
  expect(frame).toBeGreaterThanOrEqual(20);
  expect(frame).toBeLessThanOrEqual(20 + SLACK);
});

test("bits: Next after a scrub, then play, resumes at 21", async ({ page }) => {
  await page.goto("10-the-dstar-frame/");
  const host = page.locator('[data-anim="bits"]');
  await host.scrollIntoViewIfNeeded();
  await scrubTo(host, 20);
  await host.locator('[data-ref="next"]').click();
  await expect(host.locator(".anim-controls .anim-readout").first()).toContainText("frame 21 ");
  await host.locator(".anim-btn--play").click();
  await page.waitForTimeout(PLAY_MS);
  const frame = await frameOf(host.locator(".anim-controls .anim-readout").first());
  expect(frame).toBeGreaterThanOrEqual(21);
  expect(frame).toBeLessThanOrEqual(21 + SLACK);
});

test("synth autoplays from frame 98", async ({ page }) => {
  await page.goto("11-synthesis/");
  const host = page.locator('[data-anim="synth"]');
  await host.scrollIntoViewIfNeeded();
  await page.waitForTimeout(PLAY_MS);
  const frame = await frameOf(host.locator(".anim-readout--wide").first());
  expect(frame).toBeGreaterThanOrEqual(98);
  expect(frame).toBeLessThanOrEqual(98 + SLACK);
});

test("synth: play from the last frame wraps to the start", async ({ page }) => {
  // Review Focus 2.
  await page.goto("11-synthesis/");
  const host = page.locator('[data-anim="synth"]');
  await host.scrollIntoViewIfNeeded();
  const last = Number(await host.locator(".anim-range").first().getAttribute("max"));
  await scrubTo(host, last);
  await host.locator(".anim-btn--play").click();
  await page.waitForTimeout(PLAY_MS);
  const frame = await frameOf(host.locator(".anim-readout--wide").first());
  expect(frame).toBeGreaterThanOrEqual(0);
  expect(frame).toBeLessThanOrEqual(SLACK);
});

test("synth: pause and play continue from the paused frame", async ({ page }) => {
  // Review Focus 3.
  await page.goto("11-synthesis/");
  const host = page.locator('[data-anim="synth"]');
  await host.scrollIntoViewIfNeeded();
  const play = host.locator(".anim-btn--play");
  // It plays only when asked: the opening holds step 1's frame.
  await expect(play).toHaveText("Play");
  await play.click();
  await expect(play).toHaveText("Pause");
  await page.waitForTimeout(PLAY_MS);
  await play.click(); // pause
  const paused = await frameOf(host.locator(".anim-readout--wide").first());
  await page.waitForTimeout(PLAY_MS);
  expect(await frameOf(host.locator(".anim-readout--wide").first())).toBe(paused);
  await play.click();
  await page.waitForTimeout(300);
  const resumed = await frameOf(host.locator(".anim-readout--wide").first());
  expect(resumed).toBeGreaterThanOrEqual(paused);
  expect(resumed).toBeLessThanOrEqual(paused + SLACK);
});
