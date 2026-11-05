// The harmonics figure's harmonic slider (Figures 1 and 7.1): it picks one
// harmonic, 1 to L, and comes down with L when the pitch rises.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "07-multi-band-excitation/";
const HOST = "#fig-7-1";

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await settle(page, host);
  return host;
}

/**
 * @param {import("@playwright/test").Locator} input
 * @param {string} value
 */
async function slide(input, value) {
  await input.evaluate((el, v) => {
    const range = /** @type {HTMLInputElement} */ (el);
    range.value = v;
    range.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("the harmonic slider starts on the fundamental and runs to L", async ({ page }) => {
  const host = await open(page);
  const pick = host.locator('[data-role="pick"]');
  await expect(pick).toHaveAttribute("min", "1");
  await expect(pick).toHaveAttribute("max", "30");
  await expect(pick).toHaveValue("1");
  await expect(host.locator('[data-role="pick-readout"]')).toHaveText("f₀ = 120 Hz");
});

test("picking harmonic 3 names it, and the canvas label says so", async ({ page }) => {
  const host = await open(page);
  await slide(host.locator('[data-role="pick"]'), "3");
  await expect(host.locator('[data-role="pick-readout"]')).toHaveText("3f₀ = 360 Hz");
  await expect(host.locator("canvas").first()).toHaveAttribute("aria-label", /Harmonic 3, 3f₀ = 360 Hz, is drawn thick/);
});

test("raising the pitch brings a harmonic past the cutoff down to L, and the slider's top with it", async ({ page }) => {
  const host = await open(page);
  const pick = host.locator('[data-role="pick"]');
  await slide(pick, "25");
  await expect(host.locator('[data-role="pick-readout"]')).toHaveText("25f₀ = 3000 Hz");
  await slide(host.locator('[data-role="pitch"]'), "400");
  await expect(pick).toHaveAttribute("max", "9");
  await expect(pick).toHaveValue("9");
  await expect(host.locator('[data-role="pick-readout"]')).toHaveText("9f₀ = 3600 Hz");
  // Lowering the pitch again keeps the pick where it came down to.
  await slide(host.locator('[data-role="pitch"]'), "120");
  await expect(pick).toHaveAttribute("max", "30");
  await expect(pick).toHaveValue("9");
});

test("Play sounds the comb and turns into Stop, and the volume slider sits beside it", async ({ page }) => {
  const host = await open(page);
  const play = host.locator('[data-role="play"]');
  await expect(play).toHaveText("Play");
  await expect(play).toHaveAttribute("data-kind", "audio");
  await expect(host.locator('[data-role="volume"]')).toHaveValue("50");
  await play.click();
  await expect(play).toHaveText("Stop");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  // The pitch can move while it plays.
  await slide(host.locator('[data-role="pitch"]'), "200");
  await slide(host.locator('[data-role="volume"]'), "20");
  await play.click();
  await expect(play).toHaveText("Play");
  await expect(play).toHaveAttribute("aria-pressed", "false");
});
