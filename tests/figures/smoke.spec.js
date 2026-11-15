// The harness itself: the server starts, a page loads, a figure mounts, and
// nothing logs an error on the way.
import { test, expect } from "@playwright/test";

test("index loads and mounts the harmonics figure", async ({ page, baseURL }) => {
  /** @type {string[]} */
  const errors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The theme asks api.github.com for the repository's stars, which answers
    // 403 once its rate limit is spent. Only the site's own errors count.
    const where = message.location().url;
    if (where && baseURL && !where.startsWith(baseURL)) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("");
  // The figure's first canvas: once it opens in 3D (owner decision O1) the
  // host holds the hidden flat canvas, the 3D canvas and the waveform strip.
  await expect(page.locator('[data-anim="harmonics"] canvas').first()).toBeAttached();
  await expect(page.locator('[data-anim="harmonics"] canvas:not([hidden])').first()).toBeVisible();
  expect(errors).toEqual([]);
});
