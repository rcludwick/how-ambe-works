// pitch-search (ch08), the 2D view under reduced motion: the five steps,
// the readouts, the badge, free play, and what it loads.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PATH = "08-analysis/";
const HOST = '[data-anim="pitch-search"]';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("the five steps read their state into the readout, the badge and the canvas label", async ({ page }) => {
  await page.goto(PATH);
  const host = page.locator(HOST);
  await settle(page, host);
  const readout = host.locator('[data-role="readout"]');
  const next = host.locator('[data-step="next"]');
  const head = host.locator(".anim-figure__head .anim-badge");
  await expect(host.locator(".anim-steps__nav output")).toHaveText("Step 1 of 5");
  await expect(readout).toHaveText("P = 46 samples (173.9 Hz): teeth at 46, 92, 138, 184, 230; Ψ(P) = 44.45");
  await expect(head).toHaveText("derived (from the input audio)");
  await next.click();
  await expect(readout).toHaveText(/^P = 23 samples .*Ψ\(P\) = 34\.92$/);
  await next.click();
  await expect(readout).toHaveText(/^P = 92 samples .*Ψ\(P\) = 23\.66$/);
  await expect(head).toHaveText("synthetic");
  await next.click();
  await expect(readout).toHaveText("P = 45.6 samples (175.4 Hz): teeth at 45.6, 91.2, 136.8, 182.4, 228.0; Ψ(P) = 44.83");
  await next.click();
  await expect(readout).toHaveText("Frame 67 (1.34 s): site tracker 57.3 samples; 20% corridor from frame 66: 33.5 to 50.2 samples");
  await expect(head).toHaveText("derived (from the input audio)");
  await expect(host.locator('[data-role="source"]')).toBeHidden();
  await expect.poll(() => host.locator("canvas.anim-figure__canvas").getAttribute("aria-label"))
    .toMatch(/Frame 67: tracker 57\.3 samples, corridor 33\.5 to 50\.2 samples\./);
});

test("free play: the candidate slider and the window buttons", async ({ page }) => {
  await page.goto(PATH);
  const host = page.locator(HOST);
  await settle(page, host);
  await host.locator('[data-role="cand"]').fill("92");
  await expect(host.locator('[data-role="readout"]')).toHaveText(/^P = 92 samples \(87\.0 Hz\): teeth at 92, 184; Ψ\(P\) = 21\.57$/);
  await host.locator('button[data-source="fraction"]').click();
  await expect(host.locator('button[data-source="fraction"]')).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator(".anim-figure__head .anim-badge")).toHaveText("synthetic");
  await host.locator('button[data-mode="clip"]').click();
  await host.locator('[data-role="row"]').fill("8");
  await expect(host.locator('[data-role="readout"]')).toHaveText(/^Frame 8 \(0\.16 s\): site tracker 45\.6 samples/);
});

test("it loads its one data file and nothing 3D under reduced motion", async ({ page }) => {
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));
  await page.goto(PATH);
  await settle(page, page.locator(HOST));
  expect(requests.filter((u) => /correlogram\.json$/.test(u))).toEqual(["/how-ambe-works/assets/data/lr-b/correlogram.json"]);
  expect(requests.filter((u) => /anim-pitch-search-3d\.js|three\.module/.test(u))).toEqual([]);
});

test("the steps send you to the figure from 2D and read correctly without 3D (?nowebgl)", async ({ page }) => {
  await page.goto(`${PATH}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  const next = host.locator('[data-step="next"]');
  await next.click();
  await expect(host.locator('[data-role="camera"]')).toBeHidden();
  await expect(host.locator("canvas.anim-figure__canvas")).toBeVisible();
  await expect(host.locator('[data-role="readout"]')).toHaveText(/Ψ\(P\) = 34\.92$/);
});
