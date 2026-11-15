// The bits figure's 2D side and its steps (plan F10). The numbers its step
// text states are counted here from the same frames the figure reads, so a
// change to the data that would make them false fails.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "10-the-dstar-frame/";
const HOST = '[data-anim="bits"]';

/** The clip's change counts, from the module the page runs. @param {import("@playwright/test").Page} page */
function stats(page) {
  return page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-bits.js", script.src).href);
    const core = await import(new URL("anim-core.js", script.src).href);
    const model = m.unpack((await core.loadJSON("assets/data/frames.json")).frames);
    const counts = model.changedCount.slice(1).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    return {
      transitions: model.transitions,
      fewest: counts[0],
      most: counts[counts.length - 1],
      median: (counts[Math.floor((counts.length - 1) / 2)] + counts[Math.ceil((counts.length - 1) / 2)]) / 2,
      steadiest: Math.round(model.rateMin * 100),
      busiest: Math.round(model.rateMax * 100),
      at98: model.changedCount[98],
    };
  });
}

test("the chapter states the clip's own counts", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const s = await stats(page);
  expect(s).toEqual({ transitions: 158, fewest: 14, most: 48, median: 33, steadiest: 13, busiest: 59, at98: 35 });
  const items = host.locator(".anim-steps > li");
  await expect(items).toHaveCount(3);
  // The steps leave the counts to the picture; the prose under it states them.
  const prose = page.locator("article");
  await expect(prose).toContainText(`between ${s.fewest} and ${s.most} of the 72\nbits flip`.replace("\n", " "));
  await expect(prose).toContainText(`changes less\nthan ${s.steadiest}% of the time`.replace("\n", " "));
  await expect(host.locator(".anim-fallback img")).toHaveAttribute("alt", new RegExp(`the ${s.at98} bits that changed`));
});

test("the steps set the colouring, and the legend follows", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const rate = host.locator('button[data-mode="rate"]');
  await expect(rate).toHaveAttribute("aria-pressed", "false");
  await expect(host.locator('[data-legend="rate"]').first()).toBeHidden();
  const next = host.locator('[data-step="next"]');
  await next.click();
  await next.click();
  await expect(host.locator(".anim-steps__nav output")).toHaveText("Step 3 of 3");
  await expect(rate).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator('[data-legend="rate"]').first()).toBeVisible();
  await host.locator('[data-step="prev"]').click();
  await expect(rate).toHaveAttribute("aria-pressed", "false");
});

test("the live figure replaces the poster, and the caption keeps its honesty note", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await expect(host.locator(".anim-fallback")).toBeHidden();
  await expect(host.locator(".anim-figure__caption")).toContainText("The colours are measurements, not a field map.");
  await expect(host.locator('.anim-figure__caption [data-measured="hex"] .anim-badge--measured')).toHaveText("measured (AMBE-3000)");
});

test("2D: hover and the arrow keys inspect a bit", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const canvas = host.locator("canvas.anim-figure__canvas");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(host.locator('[data-ref="head"]')).toContainText("Bit 0 of 72 = 1 · byte 0, bit 0 (MSB first) · byte = 0xf0");
  await page.keyboard.press("ArrowDown");
  await expect(host.locator('[data-ref="head"]')).toContainText("Bit 8 of 72");
  await expect(host.locator('[data-ref="meta"]')).toContainText("since frame 97");
});

test("2D: held still, the changed bits stay outlined in the highlight", async ({ page }) => {
  // The 2D path at normal motion (no WebGL): the outlines flash while the
  // clip plays and stay at full strength once it is paused or stepped.
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  await host.locator(".anim-btn--play").click();
  await expect(host.locator(".anim-btn--play")).toHaveAttribute("aria-pressed", "false");
  await host.locator('[data-ref="next"]').click();
  await page.waitForTimeout(1200);
  const probe = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-bits.js", script.src).href);
    const core = await import(new URL("anim-core.js", script.src).href);
    const model = m.unpack((await core.loadJSON("assets/data/frames.json")).frames);
    const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('[data-anim="bits"] canvas.anim-figure__canvas'));
    const frame = Number(/** @type {HTMLInputElement} */ (document.querySelector('[data-anim="bits"] .anim-range')).value);
    const box = canvas.getBoundingClientRect();
    const L = m.computeLayout({ width: Math.round(box.width), height: Math.round(box.height) });
    const scale = canvas.width / Math.round(box.width);
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    const hl = getComputedStyle(document.body).getPropertyValue("--ambe-highlight").trim();
    const want = [1, 3, 5].map((i) => parseInt(hl.slice(i, i + 2), 16));
    // The outline's left edge, 1.5 px outside the cell, at the cell's middle.
    // The closest pixel to the highlight in a 4 px run across that edge.
    const at = (/** @type {number} */ n) => {
      const r = m.cellRect(L.grid, n);
      const d = g.getImageData(Math.floor((r.x - 3.5) * scale), Math.round((r.y + r.h / 2) * scale), Math.ceil(4 * scale), 1).data;
      let best = 255;
      for (let k = 0; k < d.length; k += 4) best = Math.min(best, Math.max(...want.map((c, i) => Math.abs(c - d[k + i]))));
      return best;
    };
    const changed = Array.from(/** @type {Uint8Array} */ (model.changed[frame]));
    return {
      frame,
      outlined: changed.flatMap((c, n) => (c ? [at(n)] : [])),
      // Unchanged cells with no outlined cell to their left.
      plain: changed.flatMap((c, n) => (c || (n % 8 && changed[n - 1]) ? [] : [at(n)])),
    };
  });
  expect(probe.outlined.length).toBeGreaterThan(10);
  expect(Math.max(...probe.outlined), `frame ${probe.frame}`).toBeLessThanOrEqual(40);
  expect(Math.min(...probe.plain)).toBeGreaterThan(40);
});
