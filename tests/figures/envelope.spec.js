// The envelope figure's 2D view (ch09): readouts, steps and controls, under
// reduced motion (it opens in 2D) and with ?nowebgl.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const HOST = '[data-anim="envelope"]';

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} [query]
 */
async function open(page, query = "") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`09-quantization/${query}`);
  const host = page.locator(HOST);
  await settle(page, host);
  return host;
}

/** @param {import("@playwright/test").Locator} host */
const readouts = async (host) => ({
  info: await host.locator('[data-ref="info"]').textContent(),
  error: await host.locator('[data-ref="error"]').textContent(),
});

test("opens in 2D under reduced motion on frame 112, and asks for nothing 3D", async ({ page }) => {
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/vendor\/three|anim-envelope-3d/.test(r.url())) asked.push(r.url()); });
  const host = await open(page);
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator('[data-ref="view3d"]')).toHaveAttribute("aria-pressed", "false");
  expect(await readouts(host)).toEqual({ info: "frame 112 · 2.24 s · f0 130.6 Hz · L = 28 harmonics", error: "full precision" });
  await expect(host.locator('[data-ref="cutoff"]')).toContainText("cutoff at 3.7 kHz");
  await expect(host.locator('[data-ref="cutoff"] .anim-badge')).toHaveText("illustrative");
  await expect(host.locator(".anim-figure__caption .anim-badge")).toHaveText("derived (from the input audio)");
  await expect(host.locator('[data-ref="camera"]')).toBeHidden();
  expect(asked).toEqual([]);
});

test("the sliders: eight rounding grids without 0.5 and 1 dB, thirty frames of the stretch; 6 and 12 dB cost 1.68 and 3.68 dB", async ({ page }) => {
  const host = await open(page);
  const step = host.locator('[data-ref="step"]');
  await expect(step).toHaveAttribute("max", "7");
  await expect(host.locator('[data-ref="frame"]')).toHaveAttribute("max", "29");
  for (const [index, text, error] of [["5", "6 dB", "rounded to 6 dB · RMS error 1.68 dB"], ["7", "12 dB", "rounded to 12 dB · RMS error 3.68 dB"], ["1", "1.5 dB", null]]) {
    await step.fill(index);
    await expect(host.locator('[data-ref="step-out"]')).toHaveText(/** @type {string} */ (text));
    if (error) await expect(host.locator('[data-ref="error"]')).toHaveText(error);
  }
  await host.locator('[data-ref="frame"]').fill("0");
  await expect(host.locator('[data-ref="info"]')).toHaveText("frame 95 · 1.90 s · f0 132.5 Hz · L = 27 harmonics");
  await host.locator('[data-ref="frame"]').fill("29");
  await expect(host.locator('[data-ref="info"]')).toHaveText("frame 124 · 2.48 s · f0 122.0 Hz · L = 30 harmonics");
});

test("the steps set the rounding and the frame; the last two show the ends of the stretch", async ({ page }) => {
  const host = await open(page, "?nowebgl");
  const next = host.locator('.anim-steps__nav [data-step="next"]');
  const want = [
    ["frame 112", "full precision"],
    ["frame 112", "rounded to 6 dB · RMS error 1.68 dB"],
    ["frame 112", "full precision"],
    ["frame 95 · 1.90 s · f0 132.5 Hz · L = 27", "full precision"],
    ["frame 124 · 2.48 s · f0 122.0 Hz · L = 30", "full precision"],
  ];
  for (let k = 0; k < want.length; k += 1) {
    if (k) await next.click();
    await expect(host.locator('[data-ref="info"]')).toContainText(want[k][0]);
    await expect(host.locator('[data-ref="error"]')).toHaveText(want[k][1]);
  }
  // Steps 3 to 5 ask for 3D; without WebGL they stay in 2D with the rings.
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator('[data-ref="neighbours"]')).toBeChecked();
  await expect(host.locator('[data-ref="key-ring"]')).toBeVisible();
  await expect(host.locator(".anim-figure__canvas").first()).toHaveAttribute("aria-label", /frame 124 .* ringed\./);
});

test("hovering a harmonic names it in the readout", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-ref="step"]').fill("5");
  const canvas = host.locator(".anim-figure__canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const point = await page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures.envelope.plotPoints()[0];
  });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + point[0], box.y + point[1]);
  await expect(host.locator('[data-ref="hover"]')).toHaveText("harmonic 1 · 131 Hz · -18 dB, rounded to -18 dB (+0 dB)");
  await page.mouse.move(box.x + 2, box.y + box.height + 40);
  await expect(host.locator('[data-ref="hover"]')).toHaveText("");
});

test("phone 375: no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
