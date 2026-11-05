// The tradeoff figure's 2D view (ch03): readouts, steps and controls, under
// reduced motion (it opens in 2D) and with ?nowebgl.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const HOST = '[data-anim="tradeoff"]';

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} [query]
 */
async function open(page, query = "") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`03-windows-and-frames/${query}`);
  const host = page.locator(HOST);
  await settle(page, host);
  return host;
}

test("opens in 2D under reduced motion on 20 ms blocks at 120 Hz, and asks for nothing 3D", async ({ page }) => {
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/vendor\/three|anim-tradeoff-3d/.test(r.url())) asked.push(r.url()); });
  const host = await open(page);
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator('[data-ref="block-info"]')).toHaveText(
    "block 20 ms · 1/T = 50 Hz · Hann main lobe about 4/T = 200 Hz wide · a strip every 10 ms");
  await expect(host.locator('[data-ref="valley"]')).toHaveText(
    "harmonics 120 Hz apart · valleys between them in this block: 7.0 dB deep");
  await expect(host.locator('[data-ref="at-out"]')).toHaveText("block 65 to 85 ms");
  await expect(host.locator(".anim-figure__caption .anim-badge")).toHaveText("synthetic");
  await expect(host.locator('[data-ref="camera"]')).toBeHidden();
  expect(asked).toEqual([]);
});

test("the steps set block, pitch and time; their readouts are the numbers the steps quote", async ({ page }) => {
  const host = await open(page, "?nowebgl");
  const next = host.locator('.anim-steps__nav [data-step="next"]');
  const want = [
    ["block 20 ms · 1/T = 50 Hz", "120 Hz apart · valleys between them in this block: 7.0 dB deep"],
    ["block 5 ms · 1/T = 200 Hz · Hann main lobe about 4/T = 800 Hz wide", "valleys between them in this block: 0.2 dB deep"],
    ["block 80 ms · 1/T = 12.5 Hz", "valleys between them in this block: 49.2 dB deep"],
    ["block 10 ms · 1/T = 100 Hz · Hann main lobe about 4/T = 400 Hz wide", "80 Hz apart · valleys between them in this block: 0.5 dB deep"],
    ["whole sound as one block · 1/T = 2.5 Hz · Hann main lobe about 4/T = 10 Hz wide · one strip", "this block is not inside one vowel"],
  ];
  for (let k = 0; k < want.length; k += 1) {
    if (k) await next.click();
    await expect(host.locator('[data-ref="block-info"]')).toContainText(want[k][0]);
    await expect(host.locator('[data-ref="valley"]')).toContainText(want[k][1]);
  }
  // The steps ask for presets; without WebGL they stay in 2D.
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator(".anim-figure__canvas").first()).toHaveAttribute("aria-label", /whole sound \(400 ms\) blocks: 1 strip/);
});

test("step 4's other half: back at 20 ms the 80 Hz valleys are 1.6 dB", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-ref="f0"]').fill("80");
  await expect(host.locator('[data-ref="valley"]')).toHaveText("harmonics 80 Hz apart · valleys between them in this block: 1.6 dB deep");
  await host.locator('[data-ref="block"]').fill("1");
  await expect(host.locator('[data-ref="block-out"]')).toHaveText("10 ms");
  await expect(host.locator('[data-ref="valley"]')).toHaveText("harmonics 80 Hz apart · valleys between them in this block: 0.5 dB deep");
  await host.locator('[data-ref="at"]').fill("230");
  await expect(host.locator('[data-ref="at-out"]')).toHaveText("block 227.5 to 237.5 ms");
  await expect(host.locator('[data-ref="valley"]')).toHaveText("harmonics 80 Hz apart · this block is not inside one vowel");
});

test("phone 375: no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
