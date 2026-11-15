// Print: every figure page with a poster prints its step list, captions and legends
// in dark ink on white, at WCAG AA contrast, whatever the screen scheme.
import { test, expect } from "@playwright/test";
import { REGISTRY, hostOf } from "./helpers.js";

// The figures with the fallback markup (a poster and its caption) and steps.
const PAGES = REGISTRY.filter((r) => r.poster);

/** @param {string} css an rgb() or rgba() colour */
function rgb(css) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(css);
  if (!m) throw new Error(`not an rgb colour: ${css}`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

/** Relative luminance, WCAG 2.x. @param {{r: number, g: number, b: number}} c */
function luminance({ r, g, b }) {
  const lin = (/** @type {number} */ v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast of a colour, composited over white, against white. @param {string} css */
function contrastOnWhite(css) {
  const c = rgb(css);
  const over = (/** @type {number} */ v) => v * c.a + 255 * (1 - c.a);
  const L = luminance({ r: over(c.r), g: over(c.g), b: over(c.b) });
  return 1.05 / (L + 0.05);
}

for (const { page: path, slug } of PAGES) {
  test(`print: ${slug} steps, captions and legends in dark ink on white`, async ({ page }) => {
    await page.goto(path);
    const host = page.locator(hostOf(slug));
    await host.locator(".anim-figure").waitFor();
    await page.emulateMedia({ media: "print" });

    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(rgb(background)).toEqual({ r: 255, g: 255, b: 255, a: 1 });

    /** Every printed text element under the host that the test cares about. */
    const colours = await host.evaluate((root) => {
      const pick = [
        ".anim-figure__step .anim-steps > li",
        ".anim-fallback figcaption",
        ".anim-figure__caption",
        ".anim-legend",
      ];
      /** @type {{sel: string, color: string}[]} */
      const out = [];
      for (const sel of pick) {
        for (const el of root.querySelectorAll(sel)) {
          if (!(el instanceof HTMLElement) || !el.getClientRects().length) continue;
          out.push({ sel, color: getComputedStyle(el).color });
        }
      }
      return out;
    });
    const sels = new Set(colours.map((c) => c.sel));
    expect(sels).toContain(".anim-figure__step .anim-steps > li");
    expect(sels).toContain(".anim-fallback figcaption");
    for (const { sel, color } of colours) {
      expect(contrastOnWhite(color), `${sel}: ${color}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
