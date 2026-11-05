// The envelope figure's 3D view (ch09): the opening rule, the first-view
// animation's end state, Front against the 2D plot, the highlight, and the
// view's lifecycle.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const HOST = '[data-anim="envelope"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const p = window.__ambeAnim.figures["envelope-3d"];
  return p ? { builds: p.builds, pose: p.pose, zoom: p.zoom, played: p.played, reveal: p.reveal } : null;
});

/**
 * Open 3D with the control: step 1 is a flat graph and shows in 2D.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 */
async function to3D(page, host) {
  await settle(page, host);
  const toggle = host.locator('[data-ref="view3d"]');
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
}

/** WCAG contrast of two #rrggbb colours. @param {string} a @param {string} b */
function contrast(a, b) {
  const lum = (/** @type {string} */ hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("step 1 is flat: nothing 3D is asked for; the first 3D step opens it and plays once, to its end state", async ({ page }) => {
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/anim-envelope-3d/.test(r.url())) asked.push(r.url()); });
  await page.goto("09-quantization/");
  await page.locator(`${HOST}.is-enhanced`).waitFor();
  const host = page.locator(HOST);
  await settle(page, host);
  expect(asked).toEqual([]);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  const next = host.locator('.anim-steps__nav [data-step="next"]');
  await next.click();
  await settle(page, host);
  expect(asked).toEqual([]);
  // Step 3 sets the frame against its neighbours, in depth.
  await next.click();
  await page.locator(CANVAS_3D).waitFor();
  expect(asked).toHaveLength(1);
  await expect.poll(async () => (await hook(page)).played.envelope).toBe(1);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const p = await probe(page);
  expect(p?.played).toBe(true);
  // The end state carries the point: every row out, at Corner.
  expect(p?.reveal).toBe(29);
  expect(p?.pose).toEqual({ yaw: 30, pitch: 30 });
  await expect(host.locator('[data-ref="camera"]')).toBeVisible();
  await expect(host.locator(".anim-chip")).toHaveText("frame 112: L = 28");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /frames 95 to 124 .* Frame 112, outlined, has 28 harmonics .* from 27 to 34, with 27 in the first frame and 30 in the last\. Camera: corner\. Zoom with the buttons/);
});

test("reduced motion: 2D first; the 3D control lands on the end state with no animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("09-quantization/");
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const p = await probe(page);
  expect(p?.played).toBe(false);
  expect(p?.reveal).toBe(29);
  expect((await hook(page)).played.envelope).toBeUndefined();
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
  test(`Front at ${viewport.width}: every harmonic within 1 px of the 2D plot's`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("09-quantization/");
    const host = page.locator(HOST);
    await to3D(page, host);
    for (const frame of ["17", "0", "29"]) {
      await host.locator('[data-ref="frame"]').fill(frame);
      await host.locator('button[data-preset="front"]').click();
      await page.evaluate(() => window.__ambeAnim?.finishAll());
      const [flat, front] = await page.evaluate(() => {
        // @ts-ignore test-only global
        const f = window.__ambeAnim.figures;
        return [f.envelope.plotPoints(), f["envelope-3d"].frontPoints()];
      });
      expect(front).toHaveLength(flat.length);
      for (let k = 0; k < flat.length; k += 1) {
        expect(Math.abs(front[k][0] - flat[k][0]), `x of harmonic ${k + 1}, frame ${frame}`).toBeLessThanOrEqual(1);
        expect(Math.abs(front[k][1] - flat[k][1]), `y of harmonic ${k + 1}, frame ${frame}`).toBeLessThanOrEqual(1);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}

test("the highlight follows the frame: chip text; the highlight token keeps 3:1 on the plot and the stage", async ({ page }) => {
  await page.goto("09-quantization/");
  const host = page.locator(HOST);
  await to3D(page, host);
  await host.locator('[data-ref="frame"]').fill("0");
  await expect(host.locator(".anim-chip")).toHaveText("frame 95: L = 27");
  await host.locator('[data-ref="frame"]').fill("29");
  await expect(host.locator(".anim-chip")).toHaveText("frame 124: L = 30");
  for (const scheme of ["slate", "default"]) {
    const [hl, bg, stage] = await host.locator(".anim-figure__frame").evaluate((frame, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(frame);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    expect(contrast(hl, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(hl, stage)).toBeGreaterThanOrEqual(3);
  }
});

test("frame 124 has more harmonics than frame 112: the highlight's line, glow and core run to its last dot", async ({ page }) => {
  await page.goto("09-quantization/");
  const host = page.locator(HOST);
  await to3D(page, host);
  await host.locator('button[data-preset="front"]').click();
  for (const frame of ["17", "29"]) {
    await host.locator('[data-ref="frame"]').fill(frame);
    // Reaching the slider can scroll the frame out of sight, where the
    // view does not draw.
    await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    // Two frames: the draw that counts the new segments, then the read.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const [lines, dots] = await page.evaluate(() => {
      // @ts-ignore test-only global
      const p = window.__ambeAnim.figures["envelope-3d"];
      return [p.highlightLines(), p.frontPoints()];
    });
    const last = dots[dots.length - 1];
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines.filter((l) => l.segments > 8)) {
      expect(line.drawn, `frame index ${frame}: segments drawn`).toBe(line.segments);
      expect(Math.hypot(line.end[0] - last[0], line.end[1] - last[1]), `frame index ${frame}: end of the line`).toBeLessThanOrEqual(1.5);
    }
  }
});

test("the rounding step is a flat graph: it leaves 3D, with the moved-by stems in the legend", async ({ page }) => {
  await page.goto("09-quantization/");
  const host = page.locator(HOST);
  await to3D(page, host);
  await host.locator('.anim-steps__nav [data-step="next"]').click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator('[data-ref="view3d"]')).toHaveAttribute("aria-pressed", "false");
  await expect(host.locator('[data-ref="key-moved"]')).toBeVisible();
  await expect(host.locator('[data-ref="key-ghost"]')).toBeVisible();
  await expect(host.locator('[data-ref="key-ring"]')).toBeHidden();
});

test("Top and back to Corner; a step that asks for Top flies there", async ({ page }) => {
  await page.goto("09-quantization/");
  const host = page.locator(HOST);
  await to3D(page, host);
  await host.locator('button[data-preset="top"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page))?.pose).toEqual({ yaw: 0, pitch: 90 });
  await host.locator('button[data-preset="corner"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page))?.pose).toEqual({ yaw: 30, pitch: 30 });
  const next = host.locator('.anim-steps__nav [data-step="next"]');
  // Step 5 asks for Top; step 2 on the way is flat, so 3D closes and opens again.
  for (let k = 0; k < 4; k += 1) await next.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page))?.pose).toEqual({ yaw: 0, pitch: 90 });
  await expect(host.locator('button[data-preset="top"]')).toHaveAttribute("aria-pressed", "true");
});

test("toggle 3D five times quickly: no stray context, chip or label layer", async ({ page }) => {
  await page.goto("09-quantization/");
  const host = page.locator(HOST);
  await to3D(page, host);
  const toggle = host.locator('[data-ref="view3d"]');
  for (let k = 0; k < 5; k += 1) {
    await toggle.click();
    await toggle.click();
  }
  await toggle.click();
  await page.waitForTimeout(500);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator(".anim-figure__overlay")).toHaveCount(0);
  await expect(host.locator(".anim-figure__canvas").first()).toBeVisible();
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await expect(host.locator(".anim-chip")).toHaveCount(1);
});

test("context loss pauses; resume rebuilds at the same frame", async ({ page }) => {
  await page.goto("09-quantization/");
  const host = page.locator(HOST);
  await to3D(page, host);
  await host.locator('[data-ref="frame"]').fill("3");
  const before = (await probe(page))?.builds ?? 0;
  await page.locator(CANVAS_3D).evaluate((c) => {
    const gl = /** @type {HTMLCanvasElement} */ (c).getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  const frame = host.locator(".anim-figure__frame");
  await expect(frame).toHaveAttribute("data-state", "paused");
  await frame.locator(".anim-figure__resume").click();
  await expect(frame).not.toHaveAttribute("data-state", "paused");
  await expect.poll(async () => (await probe(page))?.builds).toBe(before + 1);
  await expect(host.locator(".anim-chip")).toHaveText("frame 98: L = 34");
});
