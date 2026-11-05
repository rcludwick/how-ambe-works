// listen-terrain in ch12 (three-everywhere plan N8): the steps pick frames
// by criterion, the 2D view and the harmonic panel read on their own, the
// segment players play only 0.6 s, and the load races hold.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gate, settle } from "./helpers.js";

const PAGE = "12-listen/";

// Some cases open the 3D view, which the suite renders in software.
test.describe.configure({ timeout: 90_000 });
const HOST = '[data-anim="listen-terrain"]';

/** @param {import("@playwright/test").Page} page */
const state = (page) => page.evaluate(() => /** @type {any} */ (window.__ambeAnim?.figures["listen-terrain"]).state());

/** @param {import("@playwright/test").Page} page */
async function open2D(page, query = "") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await settle(page, host);
  return host;
}

/** @param {import("@playwright/test").Locator} host */
const next = (host) => host.locator('[data-step="next"]').click();

test("the six steps pick frames by criterion across three clips", async ({ page }) => {
  const host = await open2D(page, "?nowebgl");
  const want = [
    { clip: "lr-b", frame: 8, show: "difference", preset: "corner" },
    { clip: "lr-b", frame: 8, preset: "top" },
    { clip: "lr-b", frame: 8, preset: "side" },
    { clip: "lj-b", frame: 123, preset: "corner" },
    { clip: "lr-c", frame: 36, show: "difference" },
    { clip: "lr-c", frame: 16, show: "both" },
  ];
  await expect(host.locator(".anim-steps > li, .anim-figure__step li")).toHaveCount(want.length);
  for (const [i, expected] of want.entries()) {
    if (i) await next(host);
    await expect.poll(() => state(page)).toMatchObject(expected);
  }
  await expect(host.locator(".anim-range")).toHaveValue("16");
});

test("the readouts: the frame, the clip's band levels and its valleys, from listen-stats' numbers", async ({ page }) => {
  const host = await open2D(page);
  await expect(host.locator('[data-role="r-frame"]')).toHaveText(/^0\.17 s into “CQ CQ CQ.*”: pitched, 175 Hz in and 173 Hz out$/);
  await expect(host.locator('[data-role="r-bands"]')).toContainText("0–1 kHz 0.0 dB, 1–2 kHz +0.1 dB, 2–3 kHz +0.7 dB, 3–4 kHz +1.2 dB");
  await expect(host.locator('[data-role="r-valleys"]')).toHaveText("decoded deeper by 1.7 to 5.2 dB at harmonics 1 to 7, over 106 pitched frames");
  await expect(host.locator('canvas[data-role="harmonics"]')).toHaveAttribute("aria-label", /106 pitched frames.*deeper by 1\.7 to 5\.2 dB/);
  await expect(host.locator('[data-role="readout"]')).toHaveAttribute("aria-live", "polite");
});

test("the slider moves one 20 ms frame at a time; a quiet frame says it is not compared", async ({ page }) => {
  const host = await open2D(page);
  const slider = host.locator(".anim-range");
  await slider.evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(host.locator('[data-role="r-frame"]')).toContainText("0.01 s into");
  await expect(host.locator('[data-role="r-frame"]')).toContainText("quiet (below -40 dBFS), not compared");
  await expect(slider).toHaveAttribute("aria-valuetext", "0.01 s");
  await expect(host.locator(".anim-figure__frame > canvas").first()).toHaveAttribute("aria-label", /frame at 0\.01 s/);
});

test("the segment players play 0.6 s around the frame, the decoded one shifted by the clip's delay", async ({ page }) => {
  /** @type {string[]} */
  const audio = [];
  page.on("request", (r) => { if (r.url().endsWith(".wav")) audio.push(r.url()); });
  const host = await open2D(page);
  expect(audio).toEqual([]);
  const original = host.locator('button[data-role="play-original"]');
  const decoded = host.locator('button[data-role="play-decoded"]');
  await expect(original).toHaveText("Original");
  await expect(decoded).toHaveText("Decoded");
  await expect(original).toBeEnabled();
  await expect(decoded).toBeEnabled();
  const delay = JSON.parse(readFileSync(new URL("../../docs/assets/data/lr-b/spectra.json", import.meta.url), "utf8"))
    .clip.decoded_delay_ms / 1000;
  /** @param {number} frame */
  const windowsAt = async (frame) => {
    await host.locator(".anim-range").evaluate((el, f) => {
      const input = /** @type {HTMLInputElement} */ (el);
      input.value = String(f);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, frame);
    return page.evaluate(() => /** @type {any} */ (window.__ambeAnim?.figures["listen-terrain"]).windows());
  };
  // Frame 80 is 1.61 s in: the window runs 0.3 s either side of it.
  const mid = await windowsAt(80);
  expect(mid.original.until - mid.original.from).toBeCloseTo(0.6, 9);
  expect((mid.original.from + mid.original.until) / 2).toBeCloseTo((80 + 0.5) * 0.02, 9);
  expect(mid.decoded.until - mid.decoded.from).toBeCloseTo(0.6, 9);
  expect(mid.decoded.from - mid.original.from).toBeCloseTo(delay, 9);
  expect(delay).toBeGreaterThan(0);
  // Near the start the window keeps its 0.6 s and starts at 0.
  const start = await windowsAt(2);
  expect(start.original).toEqual({ from: 0, until: 0.6 });
  expect(start.decoded.from).toBeCloseTo(delay, 9);
  expect(audio).toEqual([]);
});

test("Both sheets leaves the middle strip empty, and the 2D label says so", async ({ page }) => {
  const host = await open2D(page);
  await host.locator('button[data-show="both"]').click();
  await expect(host.locator('button[data-show="both"]')).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator(".anim-figure__frame > canvas").first()).toHaveAttribute("aria-label", /difference hidden in the middle/);
});

test("a step whose clip is still loading gives way to the step after it", async ({ page }) => {
  const held = gate();
  await page.route("**/assets/data/lj-b/spectra.json", async (route) => {
    await held.wait;
    await route.continue();
  });
  const host = await open2D(page, "?nowebgl");
  for (let i = 0; i < 3; i += 1) await next(host); // step 4: lj-b, held
  await host.locator('[data-step="prev"]').click(); // back to lr-b
  held.release();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(200);
  await expect.poll(() => state(page)).toMatchObject({ clip: "lr-b", frame: 8 });
});

test("?nowebgl: step 1 asks for 3D and stays in 2D, and the label says why", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  await expect(host.locator(".anim-figure__frame > canvas").first()).toHaveAttribute("aria-label", /3D needs WebGL 2/);
});

test("the steps pick the view: 3D for the two sheets, 2D for the flat spectrograms and the panel", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await page.locator(`${HOST} canvas.anim-figure__canvas--3d`).waitFor();
  const views = ["3d", "2d", "2d", "2d", "2d", "3d"];
  for (const [i, view] of views.entries()) {
    if (i) await next(host);
    await settle(page, host);
    await expect(host.locator(".anim-figure"), `step ${i + 1}`).toHaveAttribute("data-view", view);
    await expect(host.locator("canvas.anim-figure__canvas--3d"), `step ${i + 1}`).toHaveCount(view === "3d" ? 1 : 0);
  }
});

test("both provenance badges sit under the figure", async ({ page }) => {
  const host = await open2D(page);
  await expect(host.locator(".anim-figure__caption .anim-badge")).toHaveText([
    "derived (from the input audio)", "derived (from the chip's decoded audio)",
  ]);
});
