// Instant navigation away from a page whose figures are still waiting for
// data must not leak their observers, listeners or mount records (design
// §0 item 9, §3.3).
import { test, expect } from "@playwright/test";
import { countAnimObservers, gate } from "./helpers.js";

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} chapter path segment, e.g. "01-why-sinusoids/"
 * @param {string} slug a figure on that page, to wait for
 */
async function visit(page, chapter, slug) {
  await page.locator(`a.md-nav__link[href$="${chapter}"]`).first().click();
  await page.waitForURL(new RegExp(`${chapter}$`));
  await page.locator(`[data-anim="${slug}"] canvas`).first().waitFor();
}

test("leaving ch01 mid-load, ten times, leaks nothing", async ({ page }) => {
  await countAnimObservers(page);
  await page.goto("02-fourier-and-the-dft/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    // @ts-ignore test-only global: survives instant navigation, not a reload
    window.__sameDocument = true;
  });
  const before = await page.evaluate(() => ({
    // @ts-ignore test-only global
    live: window.__obs.live,
    // @ts-ignore test-only global
    visibility: window.__obs.visibility,
    mounted: window.__ambeAnim?.mounted,
  }));
  // complex, and any other figure ch02 mounts (probe, from N1): the count
  // only has to come back to where it started.
  expect(before.mounted).toBeGreaterThanOrEqual(1);

  const held = gate();
  await page.route("**/assets/data/**/*.json", async (route) => {
    await held.wait;
    await route.continue();
  });

  for (let i = 0; i < 10; i += 1) {
    await visit(page, "01-why-sinusoids/", "utterance");
    await visit(page, "02-fourier-and-the-dft/", "complex");
  }
  held.release();
  await page.waitForLoadState("networkidle");

  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBe(before.live);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__obs.visibility)).toBe(before.visibility);
  expect(await page.evaluate(() => window.__ambeAnim?.mounted)).toBe(before.mounted);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);

  // Review Focus 1: the page still works after all that.
  await page.unroute("**/assets/data/**/*.json");
  await visit(page, "01-why-sinusoids/", "utterance");
  await expect(page.locator('[data-anim="utterance"] .anim-figure__frame')).toHaveAttribute("data-state", "ready");
});
