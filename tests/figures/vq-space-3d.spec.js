// vq-space (ch09), its 3D view and its walk-through (three-everywhere plan
// F11): the first-view reveal and its end state, the Front fit against the
// 2D plot, the highlight, the Speech dots, and Play.
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const PAGE = "09-quantization/";
const HOST = '[data-anim="vq-space"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/**
 * @param {import("@playwright/test").Page} page
 * @param {{motion?: "reduce" | "no-preference", query?: string}} [opts]
 */
async function open(page, { motion = "no-preference", query = "" } = {}) {
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await host.scrollIntoViewIfNeeded();
  return host;
}

/** @param {import("@playwright/test").Page} page */
const three = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures["vq-space-3d"];
  return f ? { played: f.played, lift: f.lift, cells: f.cells, chips: f.chips, pose: f.pose(), zoom: f.zoom(), frontPx: f.frontPx } : null;
});
/** @param {import("@playwright/test").Page} page */
const flat = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures["vq-space"];
  return { state: f.state, readout: f.readout, plotPx: f.plotPx, rectPx: f.rectPx, playing: f.playing, caption: f.caption, step: f.step };
});
/**
 * @param {import("@playwright/test").Locator} host
 * @param {number} n 1-based
 */
async function toStep(host, n) {
  for (let i = 1; i < n; i += 1) await host.locator('[data-step="next"]').click();
}

test("first view: step 1 is flat; step 5 opens 3D with three numbers and lands the reveal: lifted, cells in, 55 of 64 empty, at the corner", async ({ page }) => {
  const host = await open(page);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect((await flat(page)).readout).toContain("1200 dots, two numbers each, 4 bits");
  await toStep(host, 5);
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const t = await three(page);
  expect(t?.played).toBe(1);
  expect(t?.lift).toBe(1);
  expect(t?.cells).toEqual({ cellsIn: 1, hatchIn: 1 });
  expect(t?.chips).toContain("55 of 64 cubes empty");
  expect(t?.pose).toEqual({ yaw: -35, pitch: 22 });
  expect((await flat(page)).readout).toContain("6 bits, grid");
  expect((await hook(page)).played["vq-space"]).toBe(1);
});

test("the reveal goes one beat at a time: from Front, the turn, then the lift, the cells, the sweep", async ({ page }) => {
  const host = await open(page);
  await settle(page, host);
  await toStep(host, 5);
  await page.locator(CANVAS_3D).waitFor();
  // It starts at Front, where the 2D plot was, with the dots flat.
  await expect.poll(async () => (await three(page))?.pose.yaw ?? -1, { intervals: [10] }).toBeGreaterThan(0);
  expect((await three(page))?.lift).toBe(0);
  // The dots lift at the raised three-quarter view, before any cell shows.
  await expect.poll(async () => (await three(page))?.lift ?? 0, { intervals: [10] }).toBeGreaterThan(0);
  const mid = await three(page);
  expect(mid?.pose).toEqual({ yaw: 70, pitch: 16 });
  expect(mid?.cells.cellsIn).toBe(0);
  // The cells' chip waits for the cells; the probe's entry chip may show.
  expect(mid?.chips.filter((/** @type {string} */ c) => /cubes empty/.test(c))).toEqual([]);
  await settle(page, host);
  expect((await three(page))?.pose.yaw).toBe(-35);
});

test("reduced motion: opens 2D at two numbers; 3D on request lands on the reveal's end state with no motion", async ({ page }) => {
  const host = await open(page, { motion: "reduce" });
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect((await flat(page)).readout).toContain("two numbers each, 4 bits");
  await toStep(host, 5);
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(300);
  const t = await three(page);
  expect(t?.played).toBe(0);
  expect(t?.lift).toBe(1);
  expect(t?.cells).toEqual({ cellsIn: 1, hatchIn: 1 });
  expect(t?.chips).toContain("55 of 64 cubes empty");
});

for (const { name, width } of [{ name: "desktop", width: 1280 }, { name: "phone", width: 375 }]) {
  test(`Front preset at 1x puts the dots where the 2D plot does, within 0.5 px (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // The 2D plot, drawn: its mapping is the square the 3D view fits to.
    const host = await open(page, { motion: "reduce" });
    await settle(page, host);
    await toStep(host, 2);
    const flatNow = await flat(page);
    for (let i = 0; i < 8; i += 1) {
      expect(Math.abs(flatNow.rectPx[i][0] - flatNow.plotPx[i][0])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(flatNow.rectPx[i][1] - flatNow.plotPx[i][1])).toBeLessThanOrEqual(0.5);
    }
    // Two numbers on the front face, then three numbers at Front.
    await host.getByRole("button", { name: "3D view" }).click();
    await page.locator(CANVAS_3D).waitFor();
    for (const pass of [0, 1]) {
      if (pass) await host.getByRole("button", { name: "3 numbers" }).click();
      await host.getByRole("button", { name: "Front", exact: true }).click();
      await settle(page, host);
      const t = await three(page);
      expect(t?.zoom).toBe(1);
      const want = (await flat(page)).rectPx;
      for (let i = 0; i < want.length; i += 1) {
        expect(Math.abs((t?.frontPx[i][0] ?? 0) - want[i][0])).toBeLessThanOrEqual(0.5);
        expect(Math.abs((t?.frontPx[i][1] ?? 0) - want[i][1])).toBeLessThanOrEqual(0.5);
      }
    }
  });
}

test("highlight: the probe's entry has its chip; the highlight keeps 3:1 on the plot and the stage in both themes", async ({ page }) => {
  const host = await open(page);
  await settle(page, host);
  await toStep(host, 5);
  await settle(page, host);
  expect((await three(page))?.chips).toContain("entry 23 of 64");
  for (const scheme of ["slate", "default"]) {
    const [hl, ...grounds] = await host.locator(".anim-figure__frame").evaluate((frame, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(frame);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    for (const g of grounds) expect(contrast(hl, g), `${hl} on ${g} (${scheme})`).toBeGreaterThanOrEqual(3);
  }
});

test("Speech (step 6): 702 frames, 36 of 64 cubes empty, the long axis as the subject; codebook, stretch and angle off", async ({ page }) => {
  const host = await open(page);
  await settle(page, host);
  await toStep(host, 6);
  await settle(page, host);
  const out = (await flat(page)).readout;
  expect(out).toContain("702 voiced frames");
  expect(out).toContain("36 of 64 cubes never used");
  expect(out).toContain("21.3, 5.8, 3.6 dB");
  const t = await three(page);
  expect(t?.chips).toContain("most of the spread lies along this line: 21.3 dB");
  expect(t?.chips).toContain("36 of 64 cubes empty");
  await expect(host.getByRole("button", { name: "Codebook", exact: true })).toBeDisabled();
  await expect(host.locator('[data-ref="rho"]')).toBeDisabled();
  await expect(host.locator('[data-ref="angle"]')).toBeDisabled();
  await expect(host.locator(".anim-figure .anim-figure__caption .anim-badge--derived")).toHaveText("derived (from the input audio)");
  await expect(host.getByRole("button", { name: "Speech" })).toHaveAttribute("aria-pressed", "true");
  // Two numbers go back to the synthetic dots; Speech brings three again.
  await host.getByRole("button", { name: "2 numbers" }).click();
  expect((await flat(page)).state.data).toBe("synthetic");
  // Speech is offered with three numbers only.
  await expect(host.getByRole("button", { name: "Speech" })).toBeHidden();
  await host.getByRole("button", { name: "3 numbers" }).click();
  await host.getByRole("button", { name: "Speech" }).click();
  await expect.poll(async () => (await flat(page)).state).toMatchObject({ data: "speech", dims: 3 });
});

test("Speech in the data: 702 triples within +-30 dB, 4 of 16 squares and 36 of 64 cubes empty", () => {
  const doc = JSON.parse(readFileSync(new URL("../../docs/assets/data/harmonic-triples.json", import.meta.url), "utf8"));
  expect(doc.points.length).toBe(702 * 3);
  expect(Math.max(...doc.points.map(Math.abs))).toBeLessThanOrEqual(300);
  /** @param {number} dims @param {number} bits */
  const empty = (dims, bits) => {
    const m = 2 ** (bits / dims);
    const cells = new Set();
    for (let i = 0; i < doc.points.length; i += 3) {
      cells.add(doc.points.slice(i, i + dims).map((/** @type {number} */ v) => Math.min(m - 1, Math.floor((v / 300 + 1) / 2 * m))).join(","));
    }
    return m ** dims - cells.size;
  };
  expect(empty(2, 4)).toBe(4);
  expect(empty(3, 6)).toBe(36);
});

test("?nowebgl Speech: the front view of harmonics 4 and 5 with the axis", async ({ page }) => {
  const host = await open(page, { query: "?nowebgl" });
  await page.addStyleTag({ content: ".md-header { visibility: hidden; }" });
  await settle(page, host);
  await toStep(host, 6);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator(".anim-figure__frame")).toHaveScreenshot("vq-space-speech-nowebgl.png", { maxDiffPixelRatio: 0.01 });
});

test("Play: walks the steps with captions, Pause holds, the step slider jumps, a control takes over", async ({ page }) => {
  const host = await open(page);
  await settle(page, host);
  const play = host.getByRole("button", { name: "Play" });
  await play.click();
  await expect(host.locator('[data-ref="caption"]')).toBeVisible();
  await expect.poll(async () => (await flat(page)).caption).toContain("Each dot is a pair of numbers");
  await expect.poll(async () => (await flat(page)).step, { timeout: 20_000 }).toBe(1);
  expect((await flat(page)).readout).toContain("4 bits, grid");
  await host.getByRole("button", { name: "Pause" }).click();
  expect((await flat(page)).playing).toBe(false);
  await expect(host.locator('[data-ref="caption"]')).toBeHidden();
  await page.waitForTimeout(3000);
  expect((await flat(page)).step).toBe(1);
  await host.locator('[data-ref="scrub"]').fill("5");
  expect((await flat(page)).step).toBe(4);
  await expect(host.locator(".anim-steps__nav output")).toHaveText("Step 5 of 6");
  await host.getByRole("button", { name: "Play" }).click();
  expect((await flat(page)).playing).toBe(true);
  await host.getByRole("button", { name: "Front", exact: true }).click();
  expect((await flat(page)).playing).toBe(false);
});

test("Play under reduced motion steps through the end states", async ({ page }) => {
  test.setTimeout(90_000);
  const host = await open(page, { motion: "reduce" });
  await settle(page, host);
  await host.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await flat(page)).step, { timeout: 60_000 }).toBe(2);
  expect((await flat(page)).readout).toContain("10 of 16 cells never used");
  await host.getByRole("button", { name: "Pause" }).click();
});

/** WCAG contrast of two #rrggbb colours. @param {string} a @param {string} b */
function contrast(a, b) {
  const lum = (/** @type {string} */ hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
