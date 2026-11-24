// Provenance badges (design §2): one wording everywhere, and "measured" only
// on the chip's hex frames and on playback of its decoded audio.
import { test, expect } from "@playwright/test";
import { FIGURE_PAGES, useFixture } from "./helpers.js";

const WORDING = {
  "anim-badge--measured": "measured (AMBE-3000)",
  "anim-badge--derived[data-from=decoded]": "derived (from the chip's decoded audio)",
  "anim-badge--input": "input (Piper TTS, 8 kHz)",
  "anim-badge--derived[data-from=input]": "derived (from the input audio)",
  "anim-badge--synthetic": "synthetic",
  "anim-badge--illustrative": "illustrative",
};

/**
 * Measured badges that are not on a hex group or a decoded-audio player.
 * @param {import("@playwright/test").Page} page
 */
const strayMeasured = (page) =>
  page.locator(".anim-badge--measured").evaluateAll((badges) =>
    badges.filter((b) => !["hex", "decoded-audio"].includes(
      b.closest("[data-measured]")?.getAttribute("data-measured") ?? "")).length
  );

const PAGES = FIGURE_PAGES;
for (const path of PAGES) {
  test(`${path || "index"}: measured badges sit only on hex or decoded audio`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await strayMeasured(page)).toBe(0);
  });
}

test("the fixture shows every badge with the fixed wording", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  await page.goto("14-how-to-measure/");
  const caption = page.locator('[data-anim="fixture"] .anim-figure');
  for (const [selector, text] of Object.entries(WORDING)) {
    const [cls, attr] = selector.split("[");
    const locator = caption.locator(`.${cls}${attr ? `[${attr}` : ""}`);
    await expect(locator).toHaveText(text);
  }
  expect(await strayMeasured(page)).toBe(0);
});

test("the check catches a stray measured badge", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  await page.goto("14-how-to-measure/");
  await page.locator('[data-anim="fixture"].is-enhanced').waitFor();
  await page.evaluate(() => {
    const stray = document.createElement("span");
    stray.className = "anim-badge anim-badge--measured";
    document.querySelector(".anim-figure__caption")?.append(stray);
  });
  expect(await strayMeasured(page)).toBe(1);
});
