// The stepper (design §3.5), on the fixture figure.
import { test, expect } from "@playwright/test";
import { useFixture } from "./helpers.js";

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  await page.goto("14-how-to-measure/");
  const figure = page.locator('[data-anim="fixture"] .anim-figure');
  await figure.locator(".anim-figure__step").waitFor();
  return figure;
}

/** @param {import("@playwright/test").Page} page */
const applied = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  return window.__fixture.applied;
});

test("moves the list into the figure and shows one step at a time", async ({ page }) => {
  const figure = await open(page);
  await expect(page.locator('[data-anim="fixture"] > ol.anim-steps')).toHaveCount(0);
  await expect(figure.locator(".anim-figure__step ol.anim-steps > li")).toHaveCount(3);
  await expect(figure.locator(".anim-steps > li:visible")).toHaveText("First step, with a source.1");
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 1 of 3");
  await expect(figure.locator('[data-step="prev"]')).toBeDisabled();
});

test("applies only whitelisted keys", async ({ page }) => {
  await open(page);
  expect((await applied(page))[0]).toEqual({ n: "1", view: "2d" });
});

test("Next, Previous, Free play", async ({ page }) => {
  const figure = await open(page);
  const next = figure.locator('[data-step="next"]');
  await next.click();
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 2 of 3");
  await next.click();
  await expect(next).toHaveText("Free play");
  await next.click();
  await expect(figure).toHaveAttribute("data-steps", "free");
  await figure.locator('[data-step="prev"]').click();
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 2 of 3");
  await expect(figure.locator('[data-step="prev"]')).toHaveAttribute("aria-controls", /.+/);
});

test("keyboard: Right, End, Home, Left", async ({ page }) => {
  const figure = await open(page);
  await figure.locator('[data-step="next"]').focus();
  await page.keyboard.press("End");
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 3 of 3");
  await page.keyboard.press("Home");
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 1 of 3");
  await page.keyboard.press("ArrowRight");
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 2 of 3");
  await page.keyboard.press("ArrowLeft");
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 1 of 3");
});

test("arrow keys in a range input do not change step", async ({ page }) => {
  const figure = await open(page);
  const range = figure.locator(".anim-range");
  await range.focus();
  await page.keyboard.press("ArrowRight");
  await expect(range).toHaveValue("1");
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 1 of 3");
});

test("footnote reference in a step still links to the footnote list", async ({ page }) => {
  const figure = await open(page);
  await figure.locator('.anim-steps a.footnote-ref[href$="#fn:fx"]').click();
  await expect(page).toHaveURL(/#fn:fx$/);
  await expect(page.locator("#fnref\\:fx")).toHaveCount(1); // moved, not duplicated
});

test("reduced motion: apply is told not to animate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const figure = await open(page);
  await figure.locator('[data-step="next"]').click();
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__fixture.animate.at(-1))).toBe(false);
});

test("Previous back to step 1 keeps focus in the figure", async ({ page }) => {
  const figure = await open(page);
  await figure.locator('[data-step="next"]').click();
  await figure.locator('[data-step="prev"]').focus();
  await page.keyboard.press("Enter");
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 1 of 3");
  await expect(figure.locator('[data-step="next"]')).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 2 of 3");
});

test("arrow keys on a focused canvas do not change step", async ({ page }) => {
  const figure = await open(page);
  const canvas = figure.locator("canvas.anim-figure__canvas").first();
  await canvas.evaluate((c) => c.setAttribute("tabindex", "0"));
  await canvas.focus();
  await expect(canvas).toBeFocused();
  for (const key of ["ArrowRight", "End"]) {
    await page.keyboard.press(key);
    await expect(figure.locator(".anim-steps__nav output")).toHaveText("Step 1 of 3");
  }
});

test("the step list is a polite live region, so each step's text is read", async ({ page }) => {
  const figure = await open(page);
  await expect(figure.locator(".anim-figure__step ol.anim-steps")).toHaveAttribute("aria-live", "polite");
});
