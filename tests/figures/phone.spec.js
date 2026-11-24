// A phone pass over every page with a figure (three-everywhere plan, Task Z):
// at 375 px the page never scrolls sideways, and every 3D figure, in 3D on
// its end state, keeps its visible chips inside its frame at zoom 1 and at
// the 6x limit (lib/labels.js pins a chip whose anchor leaves the frame).
import { test, expect } from "@playwright/test";
import { FIGURE_PAGES, REGISTRY, settle, hostOf, to3D } from "./helpers.js";

test.use({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });

/** @type {Map<string, string[]>} page path -> 3D slugs on it */
const THREE_D = new Map();
for (const r of REGISTRY.filter((x) => x.presets?.length)) {
  for (const path of [r.page, ...(r.alsoOn ?? [])]) THREE_D.set(path, [...(THREE_D.get(path) ?? []), r.slug]);
}

/**
 * Visible chips that stick out of the frame by more than 1 px.
 * @param {import("@playwright/test").Locator} host
 */
const outside = (host) => host.evaluate((el) => {
  const frame = el.querySelector(".anim-figure__frame")?.getBoundingClientRect();
  if (!frame) return ["no frame"];
  return [...el.querySelectorAll(".anim-chip")].flatMap((chip) => {
    const style = getComputedStyle(chip);
    const box = chip.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || !box.width) return [];
    const out = box.left < frame.left - 1 || box.right > frame.right + 1 || box.top < frame.top - 1 || box.bottom > frame.bottom + 1;
    return out ? [`${chip.textContent?.trim()} at ${Math.round(box.left)},${Math.round(box.top)}-${Math.round(box.right)},${Math.round(box.bottom)}`] : [];
  });
});

for (const path of FIGURE_PAGES) {
  test(`${path || "index"}: no sideways scroll at 375 px; chips inside the frame at zoom 1 and 6`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto(path);
    await page.locator("[data-anim]").first().waitFor();
    for (const slug of THREE_D.get(path) ?? []) {
      const host = page.locator(hostOf(slug)).first();
      await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await settle(page, host);
      await to3D(page, slug, host);
      await expect(host.locator("canvas.anim-figure__canvas--3d").first(), slug).toBeVisible({ timeout: 15_000 });
      await settle(page, host);
      expect(await outside(host), `${slug} at zoom 1`).toEqual([]);
      const zoomIn = host.getByRole("button", { name: "Zoom in" });
      for (let i = 0; i < 12 && (await zoomIn.isEnabled()); i += 1) {
        await zoomIn.click();
        await page.evaluate(() => window.__ambeAnim?.finishAll());
      }
      await expect(zoomIn, slug).toBeDisabled();
      await settle(page, host);
      expect(await outside(host), `${slug} at zoom 6`).toEqual([]);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
}
