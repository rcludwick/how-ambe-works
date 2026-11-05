// ?nowebgl on every live figure with a 3D control (from the registry): the
// control is disabled, with the "3D needs WebGL 2" hint, from the start and
// before anything asks for 3D, with and without reduced motion.
import { test, expect } from "@playwright/test";
import { REGISTRY, hostOf } from "./helpers.js";

const FIGURES = REGISTRY.filter((r) => r.control);

for (const motion of /** @type {const} */ (["no-preference", "reduce"])) {
  for (const { page: path, slug, control } of FIGURES) {
    test(`?nowebgl, motion ${motion}: ${slug} disables 3D with the hint`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto(`${path}?nowebgl`);
      const host = page.locator(hostOf(slug));
      await host.locator(".anim-figure").waitFor();
      await expect(host.locator(`.anim-controls ${control}`)).toBeDisabled();
      const hint = host.locator(".anim-figure__hint--webgl");
      await expect(hint).toHaveText("3D needs WebGL 2");
      await host.scrollIntoViewIfNeeded();
      await expect(hint).toBeVisible();
      await expect(host.locator(`.anim-controls ${control}`)).toBeDisabled();
      await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
      // No other hint on the figure may say the 3D view works.
      await expect(host.locator(".anim-figure__hint").filter({ hasText: /3D view still works/ })).toHaveCount(0);
    });
  }
}
