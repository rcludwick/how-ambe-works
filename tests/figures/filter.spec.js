// The filter figure's 2D view and readouts (ch01; three-everywhere plan F1).
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "01-why-sinusoids/";
const HOST = '[data-anim="filter"]';

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await settle(page, host);
  return host;
}

test("step 3 is the sawtooth at 330 Hz; the readouts give ms beside cycles, each sine inside, and no em dash", async ({ page }) => {
  const host = await open(page);
  const next = host.getByRole("button", { name: "Next" });
  await next.click();
  await next.click();
  await expect(host.locator('button[data-shape="sawtooth"]')).toHaveAttribute("aria-pressed", "true");
  const what = host.locator('output[data-role="r-what"]');
  const lanes = host.locator('output[data-role="r-lanes"]');
  const left = host.locator('output[data-role="r-residual"]');
  await expect(what).toHaveText(/^cutoff 330 Hz · scaled by ×\d\.\d{3} · delayed by \d\.\d{3} cycle \(\d\.\d{2} ms\)$/);
  await expect(lanes).toHaveText("150 Hz ×1.25, 0.15 ms · 300 Hz ×3.50, 0.49 ms · 450 Hz ×1.08, 0.98 ms · 600 Hz ×0.43, 0.78 ms · and more below 1800 Hz");
  await expect(left).toHaveText("65.6% of the original. The shape did not survive.");
  for (const text of await host.locator(".anim-figure").allInnerTexts()) expect(text).not.toContain(String.fromCharCode(0x2014));
});

test("the sine with Rescale and realign on leaves 0.48%, and the square fits upright at ×1.388, 0.48 ms", async ({ page }) => {
  const host = await open(page);
  await host.locator('button[data-shape="sine"]').click();
  await host.locator('button[data-role="align"]').click();
  await expect(host.locator('output[data-role="r-residual"]')).toHaveText("0.48% of the original. The shape survived.");
  await expect(host.locator('output[data-role="r-lanes"]')).toHaveText("one sine, 150 Hz ×1.25, 0.15 ms");
  await host.locator('button[data-shape="square"]').click();
  await expect(host.locator('output[data-role="r-what"]')).toHaveText("cutoff 330 Hz · scaled by ×1.388 · delayed by 0.072 cycle (0.48 ms)");
  await expect(host.locator('output[data-role="r-residual"]')).toHaveText("53.6% of the original. The shape did not survive.");
  await expect(host.locator('[data-for="aligned"]')).toBeVisible();
});

test("the 2D canvas is labelled from the state, and the steps set shape and alignment", async ({ page }) => {
  const host = await open(page);
  const canvas = host.locator("canvas.anim-figure__canvas").first();
  await expect(canvas).toHaveAttribute("aria-label", /^A sine wave at 150 Hz going into a low-pass filter with its cutoff at 330 Hz/);
  const next = host.getByRole("button", { name: "Next" });
  await next.click();
  await expect(host.locator('button[data-shape="sine"]')).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator('button[data-role="align"]')).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("aria-label", /The signal filtered out, the original minus its rescaled copy, is 0\.48% of the original/);
  // The 3D legend rows and the camera stay hidden in 2D.
  await expect(host.locator('[data-for="3d"]').first()).toBeHidden();
  await expect(host.locator('[data-role="camera"]')).toBeHidden();
});

test("phone, 375 px: with Rescale and realign on, the two line labels over the plot never meet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open(page);
  await host.locator('button[data-role="align"]').click();
  for (const shape of ["sine", "square", "triangle", "sawtooth"]) {
    await host.locator(`button[data-shape="${shape}"]`).click();
    // @ts-ignore test-only global
    const [a, b] = await page.evaluate(() => window.__ambeAnim.figures.filter.labelBoxes());
    expect(a[1], shape).toBeLessThan(b[0]);
  }
});
