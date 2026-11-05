// Every page with a figure, read top to bottom at a reading pace and back,
// raises no page error (QA, Task Z). WebKit reports a ResizeObserver loop
// ("ResizeObserver loop completed with undelivered notifications") as a page
// error where Chromium stays quiet, so this runs in both projects (tagged
// @webkit): frame-path's old sub-pixel snap raised it on every ch10 load.
import { test, expect } from "@playwright/test";
import { REGISTRY } from "./helpers.js";

const PAGES = [...new Set(REGISTRY.flatMap((r) => [r.page, ...(r.alsoOn ?? [])]))].sort();

for (const path of PAGES) {
  test(`${path || "index"}: scrolling through raises no page error @webkit`, async ({ page }) => {
    test.setTimeout(90_000);
    /** @type {string[]} */
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(path);
    await page.waitForLoadState("load");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= height; y += 600) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
}
