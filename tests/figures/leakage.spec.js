// The leakage figure in 2D (plan N2, design §5.2), under reduced motion so
// it opens there: each step's readouts carry the numbers its text gives,
// the strip says the step at each joint, the controls are free after the
// last step, and a phone has no horizontal scroll.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "03-windows-and-frames/";
const HOST = '[data-anim="leakage"]';

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  return host;
}

/** What each step leaves in the readouts: the hertz, the joint, the count, the weak tone. */
const STEPS = [
  ["6.00, 300.0 Hz", "0.00, the copies meet", "1 of 81", null],
  ["6.50, 325.0 Hz", "2.00 out of a possible 2.00", "81 of 81", null],
  ["6.10, 305.0 Hz", "0.19 out of a possible 2.00", "13 of 81", null],
  ["6.50, 325.0 Hz", "2.00 out of a possible 2.00", "81 of 81", "−28.4 dB, level with the bins beside it (−28.7 and −29.3 dB)"],
  ["6.50, 325.0 Hz", "0.00, the copies meet", "6 of 81", "−49.0 dB, 6.0 dB above the bins beside it"],
  ["6.00, 300.0 Hz", "0.00, the copies meet", "3 of 81", null],
];

test("leakage 2D: every step's readouts carry the numbers its text gives", async ({ page }) => {
  const host = await open(page);
  const next = host.locator('[data-step="next"]');
  for (const [index, [hz, step, count, weak]] of STEPS.entries()) {
    if (index > 0) await next.click();
    await expect(host.locator('[data-role="hz"]')).toHaveText(hz);
    await expect(host.locator('[data-role="r-step"]')).toHaveText(step);
    await expect(host.locator('[data-role="r-count"]')).toHaveText(count);
    if (weak) await expect(host.locator('[data-role="r-weak"]')).toHaveText(weak);
    else await expect(host.locator('[data-ref="weak-row"]')).toBeHidden();
  }
  // Step 6 on Hann: three bins, and the text says so.
  await expect(host.locator(".anim-steps > li:not([hidden])")).toContainText("turns the single stem into three");
  await expect(host.locator('button[data-window="hann"]')).toHaveAttribute("aria-pressed", "true");
});

/**
 * The readouts and the pressed controls hold `index`'s row of STEPS.
 * @param {import("@playwright/test").Locator} host
 * @param {number} index
 */
async function expectStep(host, index) {
  const [hz, step, count, weak] = STEPS[index];
  await expect(host.locator('[data-role="hz"]')).toHaveText(hz);
  await expect(host.locator('[data-role="r-step"]')).toHaveText(step);
  await expect(host.locator('[data-role="r-count"]')).toHaveText(count);
  if (weak) await expect(host.locator('[data-role="r-weak"]')).toHaveText(weak);
  else await expect(host.locator('[data-ref="weak-row"]')).toBeHidden();
  const hann = index === 4 || index === 5;
  await expect(host.locator('button[data-window="hann"]')).toHaveAttribute("aria-pressed", String(hann));
  await expect(host.locator('[data-ref="weak"]')).toHaveAttribute("aria-pressed", String(index === 3 || index === 4));
}

test("leakage 2D: every step sets its whole state, so Previous, Home and End land where its text says", async ({ page }) => {
  const host = await open(page);
  const next = host.locator('[data-step="next"]');
  const prev = host.locator('[data-step="prev"]');
  for (let i = 1; i < STEPS.length; i += 1) await next.click();
  await expectStep(host, 5);
  // Backwards, one step at a time.
  for (let i = STEPS.length - 2; i >= 0; i -= 1) {
    await prev.click();
    await expectStep(host, i);
  }
  // End from the first step, then Home from the last.
  await next.focus();
  await page.keyboard.press("End");
  await expectStep(host, 5);
  await expect(host.locator(".anim-steps > li:not([hidden])")).toContainText("turns the single stem into three");
  await page.keyboard.press("Home");
  await expectStep(host, 0);
  // A jump into the middle from the end: step 3 has the weak tone off and a rectangular cut.
  await page.keyboard.press("End");
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowLeft");
  await expectStep(host, 2);
});

test("leakage 2D: the canvases' labels follow the controls", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="cycles"]').fill("650");
  await expect(host.locator("canvas.anim-figure__canvas")).toHaveAttribute("aria-label", /6\.50 cycles .*all 81 bins above −40 dB/);
  await expect(host.locator('[data-ref="strip"]')).toHaveAttribute("aria-label", /a step of 2\.00/);
  await host.locator('button[data-window="hann"]').click();
  await expect(host.locator('[data-ref="strip"]')).toHaveAttribute("aria-label", /no step\. The Hann window fades/);
  await expect(host.locator("canvas.anim-figure__canvas")).toHaveAttribute("aria-label", /a Hann window/);
});

test("leakage 2D: the slider moves in steps of 0.05 cycles between 6.00 and 7.00", async ({ page }) => {
  const host = await open(page);
  const slider = host.locator('[data-role="cycles"]');
  await expect(slider).toHaveAttribute("min", "600");
  await expect(slider).toHaveAttribute("max", "700");
  await expect(slider).toHaveAttribute("step", "5");
  await slider.fill("700");
  await expect(host.locator('[data-role="hz"]')).toHaveText("7.00, 350.0 Hz");
  await expect(host.locator('[data-role="r-count"]')).toHaveText("1 of 81");
});

test("leakage 2D at 375 px: no horizontal scroll, and the strip and the frame fit", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  for (const selector of [".anim-leakage__strip", ".anim-figure__frame"]) {
    const box = await host.locator(selector).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
  }
});
