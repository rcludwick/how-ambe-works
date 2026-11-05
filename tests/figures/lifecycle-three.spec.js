// Ten instant navigations between chapters with 3D figures must not pile up
// WebGL contexts, observers or probes (design §3.4, §5 M4, generalised to
// every chapter carrying one 3D figure).
import { test, expect } from "@playwright/test";
import { countAnimObservers, hook, useFixture, visit } from "./helpers.js";

const CANVAS_3D = '[data-anim="fixture"] canvas.anim-figure__canvas--3d';

/**
 * @param {import("@playwright/test").Page} page
 * @param {string[]} chapters
 */
async function setUp(page, chapters) {
  /** @type {string[]} */
  const messages = [];
  page.on("console", (m) => messages.push(m.text()));
  await countAnimObservers(page);
  await useFixture(page, { chapters, view: "3d" });
  await page.goto("14-how-to-measure/");
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__sameDocument = true;
  });
  // @ts-ignore test-only global
  const observers = await page.evaluate(() => window.__obs.live);
  return { messages, observers };
}

test("14 -> 15 -> 14, ten times, 3D on 14 only", async ({ page }) => {
  const { messages, observers } = await setUp(page, ["14-how-to-measure/"]);
  for (let i = 0; i < 10; i += 1) {
    await visit(page, "15-exact-reproduction/");
    await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
    await visit(page, "14-how-to-measure/");
    await page.locator(CANVAS_3D).waitFor();
    expect((await hook(page)).liveContexts).toBe(1);
  }
  const h = await hook(page);
  expect(h.peakContexts).toBe(1);
  expect(h.webglProbes).toBe(1);
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBe(observers);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  expect(messages.filter((m) => /too many active webgl contexts/i.test(m))).toEqual([]);
});

test("14 -> 15 -> 14, ten times, a 3D figure on both", async ({ page }) => {
  const { messages, observers } = await setUp(page, ["14-how-to-measure/", "15-exact-reproduction/"]);
  for (let i = 0; i < 10; i += 1) {
    await visit(page, "15-exact-reproduction/");
    await page.locator(CANVAS_3D).waitFor();
    await visit(page, "14-how-to-measure/");
    await page.locator(CANVAS_3D).waitFor();
  }
  const h = await hook(page);
  expect(h.liveContexts).toBe(1);
  expect(h.peakContexts).toBe(1);
  expect(h.webglProbes).toBe(1);
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBe(observers);
  expect(messages.filter((m) => /too many active webgl contexts/i.test(m))).toEqual([]);
});

test("07 -> 09 -> 10 -> 11, ten times, through every chapter's real 3D figure", async ({ page }) => {
  test.setTimeout(120_000);
  /** @type {string[]} */
  const messages = [];
  page.on("console", (m) => messages.push(m.text()));
  await countAnimObservers(page);
  // Every chapter here now holds more than one 3D figure. Under reduced
  // motion none opens on its own, so the one live context is the figure
  // each step opens with its control.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("07-multi-band-excitation/");
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__sameDocument = true;
  });
  /** @param {string} chapter */
  const go = async (chapter) => {
    await page.locator(`a.md-nav__link[href$="${chapter}"]`).first().click();
    await page.waitForURL(new RegExp(`${chapter}$`));
  };
  /**
   * @param {string} slug
   * @param {string} [control] the button that opens the 3D view, when it is
   *        not the usual `[data-view="3d"]` (vq-space's is "3 numbers")
   */
  const in3d = async (slug, control = '.anim-controls [data-view="3d"]') => {
    const host = page.locator(`[data-anim="${slug}"]`);
    await expect(host).toHaveClass(/is-enhanced/);
    await host.scrollIntoViewIfNeeded();
    const button = host.locator(control);
    if ((await button.count()) && (await button.getAttribute("aria-pressed")) !== "true") await button.click();
    await page.locator(`[data-anim="${slug}"] canvas.anim-figure__canvas--3d`).waitFor();
    expect((await hook(page)).liveContexts).toBe(1);
  };
  for (let i = 0; i < 10; i += 1) {
    if (i > 0) await go("07-multi-band-excitation/");
    await in3d("voicing");
    await go("09-quantization/");
    await in3d("vq-space", 'button[data-dims="3"]');
    await go("10-the-dstar-frame/");
    await in3d("frame-path");
    await go("11-synthesis/");
    await in3d("harmonic-sum");
  }
  const h = await hook(page);
  expect(h.liveContexts).toBeLessThanOrEqual(1);
  expect(h.peakContexts).toBe(1);
  expect(h.webglProbes).toBe(1);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  expect(messages.filter((m) => /too many active webgl contexts/i.test(m))).toEqual([]);
});
