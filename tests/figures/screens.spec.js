// Pixel baselines for the eleven figures as they are at main (637c585).
// M0 must not change any of them. Two pictures per figure and viewport:
//   - the plot frame under reduced motion, where every figure holds still;
//   - the whole figure in normal motion, with the moving parts masked, which
//     covers the controls, legend and caption.
// Each host is shot on a whole CSS pixel (snap), so the page above it does
// not move its antialiasing. Baselines change only in a commit of their own.
import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { FIGURES, settle, hostOf } from "./helpers.js";

const STYLE_PATH = fileURLToPath(new URL("./screens.css", import.meta.url));

/**
 * Put the host on a whole CSS pixel. Its offset on the page depends on the
 * figures and prose above it (and on whether a figure above has opened its
 * 3D view yet), and a fractional offset antialiases every edge in it
 * differently. Shifting the host alone by under a pixel leaves its inside
 * as it is and makes the shot independent of the page above.
 * @param {import("@playwright/test").Locator} host
 */
async function snap(host) {
  await host.evaluate((el) => {
    if (!(el instanceof HTMLElement)) return;
    el.style.position = "relative";
    el.style.top = "0px";
    el.style.left = "0px";
    const box = el.getBoundingClientRect();
    const y = box.top + window.scrollY;
    const x = box.left + window.scrollX;
    el.style.top = `${Math.floor(y) - y}px`;
    el.style.left = `${Math.floor(x) - x}px`;
  });
}

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  { name: "phone", viewport: { width: 375, height: 800 }, deviceScaleFactor: 3 },
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor });

    for (const { page: path, slug } of FIGURES) {
      test(`${slug}: plot frame, reduced motion`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(path);
        const host = page.locator(hostOf(slug)).first();
        await settle(page, host);
        await snap(host);
        await expect(host.locator(".anim-figure__frame").first()).toHaveScreenshot(
          `${vp.name}-${slug}-frame-reduced.png`,
          { maxDiffPixels: 0, stylePath: STYLE_PATH }
        );
      });

      test(`${slug}: whole figure, normal motion`, async ({ page }) => {
        await page.goto(path);
        const host = page.locator(hostOf(slug)).first();
        await settle(page, host);
        // Playwright draws no mask on a figure taller than the viewport (synth
        // on desktop, bits on a phone), so make the viewport tall enough to
        // hold the whole figure. The width, and so the layout, stays the same.
        const box = await host.boundingBox();
        if (box && box.height + 100 > vp.viewport.height) {
          await page.setViewportSize({ width: vp.viewport.width, height: Math.ceil(box.height) + 100 });
          await settle(page, host);
        }
        // bits and synth play on their own, and their frame readout widens
        // with the frame number, which moves the slider beside it. Hold them
        // on frame 98 (their start frame) so the controls row does not depend
        // on how long the page has been playing.
        if (slug === "bits" || slug === "synth") {
          await host.locator(".anim-range").first().evaluate((el) => {
            if (!(el instanceof HTMLInputElement)) throw new Error("no range");
            el.value = "98";
            el.dispatchEvent(new Event("input", { bubbles: true }));
          });
          await settle(page, host);
        }
        await snap(host);
        await expect(host).toHaveScreenshot(`${vp.name}-${slug}-figure.png`, {
          maxDiffPixels: 0,
          stylePath: STYLE_PATH,
          animations: "disabled",
          // .anim-range: in the figures that play on their own (bits, synth,
          // voicing) the slider thumb follows the playing frame.
          mask: [host.locator(".anim-figure__frame, output, .anim-readout, [aria-live], .anim-range")],
        });
      });
    }
  });
}
