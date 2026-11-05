// Two load races in legacy figures (design §7 R0, riders 4 and 5).
import { test, expect } from "@playwright/test";
import { gate } from "./helpers.js";

test("harmonics: a second voice pressed during the first load is the one applied", async ({ page }) => {
  // Control: what the slider reads after pressing Female on its own.
  const control = await page.context().newPage(); // same baseURL, no routes
  await control.goto("");
  const controlHost = control.locator('[data-anim="harmonics"]');
  await controlHost.getByRole("button", { name: "Female recording", exact: true }).click();
  await expect(controlHost.locator('[data-role="pitch"]')).not.toHaveValue("120");
  const expected = await controlHost.locator('[data-role="pitch"]').inputValue();
  await control.close();

  const held = gate();
  // A RegExp: Playwright globs have no character classes.
  await page.route(/\/assets\/data\/l[rj]-b\/frames\.json$/, async (route) => {
    await held.wait;
    await route.continue();
  });
  await page.goto("");
  const host = page.locator('[data-anim="harmonics"]');
  await host.getByRole("button", { name: "Male recording", exact: true }).click();
  await host.getByRole("button", { name: "Female recording", exact: true }).click();
  held.release();

  await expect(host.getByRole("button", { name: "Female recording", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator('[data-role="pitch"]')).toHaveValue(expected);
});

test("utterance-spectra: a slow earlier clip does not replace the one chosen after it", async ({ page, request, baseURL }) => {
  const doc = await (await request.get(`${baseURL}assets/data/lj-d/spectra.json`)).json();
  const wanted = doc.clip.text;

  const held = gate();
  await page.route("**/assets/data/lj-a/spectra.json", async (route) => {
    await held.wait;
    await route.continue();
  });
  await page.goto("01-why-sinusoids/");
  const host = page.locator('[data-anim="utterance-spectra"]');
  const readout = host.locator('[data-role="r-window"]');
  await expect(host.locator(".anim-figure__frame")).toHaveAttribute("data-state", "ready");

  await host.locator('[data-sentence="a"]').click(); // lj-a, held
  await host.locator('[data-sentence="d"]').click(); // lj-d
  await expect(readout).toContainText(wanted);
  held.release();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(200);
  await expect(readout).toContainText(wanted);
});

test("utterance-spectra: a cached clip clears an earlier error", async ({ page }) => {
  await page.route("**/assets/data/lj-a/spectra.json", (route) => route.fulfill({ status: 500, body: "" }));
  await page.goto("01-why-sinusoids/");
  const host = page.locator('[data-anim="utterance-spectra"]');
  const frame = host.locator(".anim-figure__frame");
  await expect(frame).toHaveAttribute("data-state", "ready"); // lj-c, now cached

  await host.locator('[data-sentence="a"]').click(); // lj-a
  await expect(frame).toHaveAttribute("data-state", "error");
  await host.locator('[data-sentence="c"]').click(); // lj-c from the cache
  await expect(frame).toHaveAttribute("data-state", "ready");
});

test("utterance-spectra: a clip still loading when the reader leaves builds no player", async ({ page }) => {
  // Review finding: reload() went on to build a player after the cleanup.
  await page.addInitScript(() => {
    // @ts-ignore test-only global
    window.__audios = 0;
    const Native = window.Audio;
    // @ts-ignore replacing a DOM constructor for the test
    window.Audio = class extends Native {
      /** @param {string} [src] */
      constructor(src) {
        super(src);
        // @ts-ignore test-only global
        window.__audios += 1;
      }
    };
  });
  const held = gate();
  await page.route("**/assets/data/lj-a/spectra.json", async (route) => {
    await held.wait;
    await route.continue();
  });
  await page.goto("01-why-sinusoids/");
  const host = page.locator('[data-anim="utterance-spectra"]');
  await expect(host.locator(".anim-figure__frame")).toHaveAttribute("data-state", "ready");

  await host.locator('[data-sentence="a"]').click(); // lj-a, held
  await page.locator('a.md-nav__link[href$="02-fourier-and-the-dft/"]').first().click();
  await page.waitForURL(/02-fourier-and-the-dft\/$/);
  await page.locator('[data-anim="complex"] canvas').waitFor();
  // @ts-ignore test-only global
  const before = await page.evaluate(() => window.__audios);
  held.release();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(200);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__audios)).toBe(before);
});
