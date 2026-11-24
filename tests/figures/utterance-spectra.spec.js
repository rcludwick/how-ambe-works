// utterance-spectra in ch01 (three-everywhere plan F3): the steps pick
// windows by criterion, the 2D view reads on its own, and the load races
// the riders tests cover in riders.spec.js hold for steps and for 3D too.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gate, settle } from "./helpers.js";

const PAGE = "01-why-sinusoids/";

// Some cases open the 3D view, which the suite renders in software.
test.describe.configure({ timeout: 90_000 });
const HOST = '[data-anim="utterance-spectra"]';

/** @param {import("@playwright/test").Page} page */
const state = (page) => page.evaluate(() => /** @type {any} */ (window.__ambeAnim?.figures["utterance-spectra"]).state());

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

test("the steps pick windows by criterion: low-heavy, high-heavy, then the whole sentence at Corner", async ({ page }) => {
  const host = await open2D(page);
  await expect.poll(() => state(page)).toMatchObject({ clip: "lj-c", frame: 24, preset: "corner", view: "2d" });
  await expect(host.locator('[data-role="r-window"]')).toContainText("0.48 s into");
  await next(host);
  await expect.poll(() => state(page)).toMatchObject({ clip: "lj-c", frame: 62, view: "2d" });
  await next(host);
  await expect.poll(() => state(page)).toMatchObject({ clip: "lj-c", frame: 24, preset: "corner" });
  await expect(host.locator(".anim-range")).toHaveValue("24");
});

test("reduced motion: the step that asks for 3D stays in 2D and loads nothing 3D", async ({ page }) => {
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  const host = await open2D(page);
  for (let i = 0; i < 2; i += 1) await next(host);
  await settle(page, host);
  await expect.poll(() => state(page)).toMatchObject({ clip: "lj-c", preset: "corner", view: "2d" });
  await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  expect(asked.filter((u) => /anim-utterance-spectra-3d\.js|three\.module/.test(u))).toEqual([]);
});

test("the slider moves one 20 ms window at a time and the 2D label follows", async ({ page }) => {
  const host = await open2D(page);
  const slider = host.locator(".anim-range");
  await slider.evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = "100";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(host.locator('[data-role="r-window"]')).toContainText("2.00 s into");
  await expect(host.locator(".anim-figure__frame > canvas").first()).toHaveAttribute("aria-label", /window at 2\.00 s/);
  await expect(slider).toHaveAttribute("aria-valuetext", "2.00 s");
});

test("in 3D, a slow earlier clip does not replace the one chosen after it", async ({ page }) => {
  const held = gate();
  await page.route("**/assets/data/lj-a/spectra.json", async (route) => {
    await held.wait;
    await route.continue();
  });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await host.scrollIntoViewIfNeeded();
  for (let i = 0; i < 2; i += 1) await next(host); // step 3 asks for 3D
  await host.locator("canvas.anim-figure__canvas--3d").waitFor();
  await settle(page, host);
  await host.locator('button[data-sentence="a"]').click(); // held
  await host.locator('button[data-sentence="d"]').click();
  await settle(page, host);
  held.release();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(200);
  expect((await state(page)).clip).toBe("lj-d");
  const slices = await page.evaluate(() => /** @type {any} */ (window.__ambeAnim?.figures["utterance-spectra-3d"]).slices());
  expect(slices).toBe(84);
});

test("?nowebgl: the step that asks for 3D stays in 2D, and the label says why", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  for (let i = 0; i < 2; i += 1) await next(host);
  await settle(page, host);
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  await expect(host.locator(".anim-figure__frame > canvas").first()).toHaveAttribute("aria-label", /3D needs WebGL 2/);
});

test("only the input spectra are drawn, never .decoded, under the derived-input badge", async ({ page }) => {
  for (const name of ["anim-utterance-spectra.js", "anim-utterance-spectra-3d.js"]) {
    const source = readFileSync(new URL(`../../docs/javascripts/${name}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(source, name).not.toMatch(/\.decoded\b/);
  }
  const host = await open2D(page);
  await expect(host.locator(".anim-figure__caption .anim-badge")).toHaveText("derived (from the input audio)");
});
