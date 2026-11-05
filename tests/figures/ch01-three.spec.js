// Every 3D figure on its real page, at the default cap and with motion
// allowed (three-everywhere plan, Task Z; design §3.6, ch01-three). Each page
// is read top to bottom, a figure at a time, and back up again:
//   - each figure opens in 3D near the viewport (or, when its first step is
//     a flat graph in 2D, on its first step that asks for 3D) and plays its
//     animation once;
//   - the page never holds more than the cap's live contexts (ch01 has four
//     3D figures, so it must park one and unpark it on the way back);
//   - on the way back every figure is in 3D again, unparked, not replayed.
import { test, expect } from "@playwright/test";
import { REGISTRY, hook, hostOf, settle, to3D } from "./helpers.js";

// anim-three.js MAX_LIVE, with no ?three-cap override.
const CAP = 3;

/** @type {Map<string, string[]>} page path -> 3D slugs with an animation */
const PAGES = new Map();
for (const r of REGISTRY.filter((x) => x.animation)) {
  for (const path of [r.page, ...(r.alsoOn ?? [])]) {
    PAGES.set(path, [...(PAGES.get(path) ?? []), r.slug]);
  }
}

/**
 * The page's 3D figures in document order.
 * @param {import("@playwright/test").Page} page
 * @param {string[]} slugs
 */
const inOrder = (page, slugs) => page.evaluate((wanted) =>
  [...document.querySelectorAll("[data-anim]")]
    .map((el) => el.getAttribute("data-anim") ?? "")
    .filter((slug, i, all) => wanted.includes(slug) && all.indexOf(slug) === i), slugs);

/**
 * Bring a figure into view and wait until its 3D view is up and unparked.
 * @param {import("@playwright/test").Page} page
 * @param {string} slug
 */
async function in3D(page, slug) {
  const host = page.locator(hostOf(slug)).first();
  await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await settle(page, host);
  await to3D(page, slug, host);
  await expect(host.locator("canvas.anim-figure__canvas--3d").first(), slug).toBeVisible({ timeout: 15_000 });
  await expect(host.locator(".anim-figure__frame").first(), slug).not.toHaveAttribute("data-three", /parked|loading/);
  return host;
}

for (const [path, slugs] of PAGES) {
  test(`${path || "index"}: ${slugs.join(", ")} open in 3D, play once, and stay within the cap down and back`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto(path);
    await page.locator(`[data-anim="${slugs[0]}"]`).first().waitFor();
    const order = await inOrder(page, slugs);
    expect(order.sort()).toEqual([...slugs].sort());
    const down = await inOrder(page, slugs);
    for (const slug of down) {
      await in3D(page, slug);
      await expect.poll(async () => (await hook(page)).played[slug], { message: slug }).toBe(1);
      expect((await hook(page)).liveContexts).toBeLessThanOrEqual(CAP);
    }
    for (const slug of [...down].reverse()) {
      await in3D(page, slug);
      expect((await hook(page)).played[slug], slug).toBe(1);
      expect((await hook(page)).liveContexts).toBeLessThanOrEqual(CAP);
    }
    const h = await hook(page);
    expect(h.peakContexts).toBeLessThanOrEqual(CAP);
    if (slugs.length > CAP) {
      // More figures than slots: the reader's way down parked one, the way
      // back unparked it.
      expect(h.parks).toBeGreaterThan(0);
      expect(h.unparks).toBeGreaterThan(0);
    }
    for (const slug of slugs) expect(h.played[slug], slug).toBe(1);
  });
}
