// envelope-blocks (ch09), flat view: its readouts, its frame choice, its
// badges and its canvas label, under reduced motion (it opens in 2D).
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const HOST = '[data-anim="envelope-blocks"]';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("09-quantization/");
  await settle(page, page.locator(HOST));
});

test("opens on frame 112 with every coefficient, then reads 79.7% and 96.3% at one and two", async ({ page }) => {
  const host = page.locator(HOST);
  await expect(host.locator('[data-ref="frame-out"]')).toHaveText("#112 · 2.24 s · 131 Hz · L = 28");
  await expect(host.locator('[data-ref="k-out"]')).toHaveText("5 of 5");
  await expect(host.locator('[data-ref="rms"]')).toHaveText("0.00 dB");
  await expect(host.locator('[data-ref="energy"]')).toHaveText("100.0%");
  await host.locator('[data-ref="k"]').fill("1");
  await expect(host.locator('[data-ref="energy"]')).toHaveText("79.7%");
  await host.locator('[data-ref="k"]').fill("2");
  await expect(host.locator('[data-ref="energy"]')).toHaveText("96.3%");
  await expect(host.locator(".anim-figure__frame > canvas")).toHaveAttribute("aria-label",
    /Frame 112, 28 harmonic amplitudes .* blocks of 5, 5, 5, 5, 4, 4, .* 2 coefficients: 96\.3% of the energy, .* −58\.6 dBFS/);
});

test("the frame slider offers 89 frames, and k follows the new frame's longest block", async ({ page }) => {
  const host = page.locator(HOST);
  const frame = host.locator('[data-ref="frame"]');
  await expect(frame).toHaveAttribute("max", "88");
  await frame.fill("0");
  const k = host.locator('[data-ref="k"]');
  const max = Number(await k.getAttribute("max"));
  expect(max).toBeGreaterThanOrEqual(3);
  expect(max).toBeLessThanOrEqual(7);
  await expect(host.locator('[data-ref="k-out"]')).toHaveText(new RegExp(`of ${max}$`));
});

test("badges: derived from the input audio, the illustrative split and cutoff; nothing measured", async ({ page }) => {
  const host = page.locator(HOST);
  await expect(host.locator(".anim-figure__caption .anim-badge--derived[data-from=input]")).toHaveCount(1);
  await expect(host.locator(".anim-badge--illustrative")).toHaveCount(2);
  await expect(host.locator(".anim-badge--measured")).toHaveCount(0);
});
