// frames (ch08), its 2D side: the default frame, the window readouts, the
// Windows toggle on the input only, Lanes where 3D cannot open, and the
// samples failing to load.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const PAGE = "08-analysis/";

/** @param {import("@playwright/test").Page} page */
const host = (page) => page.locator('[data-anim="frames"]');
/** @param {import("@playwright/test").Page} page */
const state2d = async (page) => /** @type {any} */ ((await hook(page)).figures.frames);

/**
 * PICKS from the page's own lib/picks.js, applied to frames.json.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
const pick = (page, name) => page.evaluate(async (n) => {
  const script = document.querySelector('script[src*="javascripts/anim.js"]');
  if (!(script instanceof HTMLScriptElement)) throw new Error("no anim.js");
  const { PICKS } = await import(new URL("lib/picks.js", script.src).href);
  const data = await (await fetch(new URL("../assets/data/frames.json", script.src))).json();
  return PICKS[n](data.frames).i;
}, name);

test.describe("reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("opens in 2D on the mixed pick, with the window readouts", async ({ page }) => {
    await page.goto(PAGE);
    await settle(page, host(page));
    expect((await state2d(page)).index).toBe(await pick(page, "mixed"));
    expect((await state2d(page)).index).toBe(112);
    const h = host(page);
    await expect(h.locator('[data-role="r-window"]')).toHaveText("255 samples, 31.9 ms");
    await expect(h.locator('[data-role="r-step"]')).toHaveText("160 samples, 20 ms");
    await expect(h.locator('[data-role="r-shared"]')).toHaveText("95 samples");
    // 255 x 130.6 Hz / 8000
    await expect(h.locator('[data-role="r-periods"]')).toHaveText("4.2 periods");
    await expect(h.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
    await expect(h.locator('button[data-view="3d"]')).toBeEnabled();
  });

  test("Windows forces the input track; a frame with no pitch has no period to count", async ({ page }) => {
    await page.goto(PAGE);
    const h = host(page);
    await settle(page, h);
    const windows = h.locator('[data-role="windows"]');
    // Step 1 turns Windows on.
    await expect(windows).toHaveAttribute("aria-pressed", "true");
    await expect(h.locator('[data-track="decoded"]')).toBeDisabled();
    await windows.click();
    await h.locator('[data-track="decoded"]').click();
    expect((await state2d(page)).track).toBe("decoded");
    await windows.click();
    expect((await state2d(page)).track).toBe("original");
    await expect(h.locator('[data-track="original"]')).toHaveAttribute("aria-pressed", "true");
    // The first loud frame with no voiced band and no input pitch.
    const fricative = await page.evaluate(async () => {
      const script = document.querySelector('script[src*="javascripts/anim.js"]');
      if (!(script instanceof HTMLScriptElement)) throw new Error("no anim.js");
      const data = await (await fetch(new URL("../assets/data/frames.json", script.src))).json();
      return data.frames.find((/** @type {FrameRecord} */ f) => f.derived.orig_f0_hz === 0 &&
        f.derived.orig_rms_dbfs > -40 && !f.derived.band_voiced.some(Boolean)).i;
    });
    await h.locator('[data-role="frame"]').evaluate((el, i) => {
      if (!(el instanceof HTMLInputElement)) throw new Error("no range");
      el.value = String(i);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, fricative);
    await expect(h.locator('[data-role="r-periods"]')).toHaveText("no periodicity");
  });

  test("the depth step shows Lanes and asks for nothing 3D", async ({ page }) => {
    /** @type {string[]} */
    const asked = [];
    page.on("request", (r) => {
      if (/anim-frames-3d\.js|anim-three\.js/.test(r.url())) asked.push(r.url());
    });
    await page.goto(PAGE);
    const h = host(page);
    await settle(page, h);
    for (let i = 0; i < 3; i += 1) await h.locator('[data-step="next"]').click();
    expect((await state2d(page)).lanes).toBe(true);
    await expect(h.locator('button[data-view="lanes"]')).toHaveAttribute("aria-pressed", "true");
    await expect(h.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
    expect(asked).toEqual([]);
    // The 3D control still opens it, on the end state.
    await h.locator('button[data-view="3d"]').click();
    await h.locator("canvas.anim-figure__canvas--3d").waitFor();
    await settle(page, h);
    expect(/** @type {any} */ ((await hook(page)).figures["frames-3d"]).played).toBe(false);
  });
});

test("?nowebgl: the depth step shows Lanes, the 3D control stays disabled", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const h = host(page);
  await settle(page, h);
  await expect(h.locator('button[data-view="3d"]')).toBeDisabled();
  for (let i = 0; i < 3; i += 1) await h.locator('[data-step="next"]').click();
  expect((await state2d(page)).lanes).toBe(true);
  await expect(h.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
});

test("without the samples, 3D stays off with the reason", async ({ page }) => {
  await page.route(/\/assets\/audio\/lr-b-(original|ambe)\.wav$/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto(PAGE);
  const h = host(page);
  await settle(page, h);
  await expect(h.locator('button[data-view="3d"]')).toBeDisabled();
  await expect(h.locator(".anim-figure__hint--webgl")).toHaveText("Needs the audio samples");
  await expect(h.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test("no horizontal scroll, in 3D and in 2D", async ({ page }) => {
    await page.goto(PAGE);
    const h = host(page);
    await settle(page, h);
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await wide()).toBeLessThanOrEqual(0);
    await h.locator('button[data-view="3d"]').click();
    await settle(page, h);
    expect(await wide()).toBeLessThanOrEqual(0);
  });
});
