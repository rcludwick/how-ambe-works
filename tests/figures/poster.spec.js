// JS off: every live figure with a poster shows it, loaded from under the
// base path (zensical serve also answers /assets/ at the host root, which
// the deployed site does not). One case per registry file with a poster.
import { test, expect } from "@playwright/test";
import { REGISTRY, hostOf } from "./helpers.js";

test.use({ javaScriptEnabled: false });

for (const { page: path, slug, poster } of REGISTRY.filter((r) => r.poster)) {
  test(`${slug}: the poster loads from under the base path`, async ({ page }) => {
    await page.goto(path);
    const img = page.locator(`${hostOf(slug)} .anim-fallback img`);
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => /** @type {HTMLImageElement} */ (el).naturalWidth)).toBe(1280);
    expect(new URL(await img.evaluate((el) => /** @type {HTMLImageElement} */ (el).src)).pathname)
      .toBe(`/how-ambe-works/${poster}`);
  });
}
