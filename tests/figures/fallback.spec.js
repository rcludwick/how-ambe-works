// The static fallback: shown without JS and in print, hidden once the live
// figure is in place (design §2 "Hosts are never cleared", §3.6 print).
import { test, expect } from "@playwright/test";
import { useFixture } from "./helpers.js";

test.describe("JS off", () => {
  test.use({ javaScriptEnabled: false });
  test("shows the fallback and every step", async ({ page }) => {
    await useFixture(page, { chapters: ["14-how-to-measure/"] });
    await page.goto("14-how-to-measure/");
    const host = page.locator('[data-anim="fixture"]');
    await expect(host.locator(".anim-fallback img")).toBeVisible();
    await expect(host.locator(".anim-fallback figcaption")).toBeVisible();
    await expect(host.locator(".anim-steps > li")).toHaveCount(3);
    for (const step of await host.locator(".anim-steps > li").all()) await expect(step).toBeVisible();
  });
});

test("JS on: the fallback hides once the figure is enhanced", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  await page.goto("14-how-to-measure/");
  const host = page.locator('[data-anim="fixture"]');
  await expect(host).toHaveClass(/is-enhanced/);
  await expect(host.locator(".anim-fallback")).toBeHidden();
  await expect(host.locator(".anim-fallback")).toHaveCount(1); // appended after, never cleared
});

test("print: the fallback and every step print, the live frame does not", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  await page.goto("14-how-to-measure/");
  const host = page.locator('[data-anim="fixture"]');
  await expect(host).toHaveClass(/is-enhanced/);
  await page.emulateMedia({ media: "print" });
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  await expect(host.locator(".anim-figure__frame")).toBeHidden();
  for (const step of await host.locator(".anim-steps > li").all()) await expect(step).toBeVisible();
});

test("print: a figure that is not enhanced keeps its frame", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"], enhanced: false });
  await page.goto("14-how-to-measure/");
  const host = page.locator('[data-anim="fixture"]');
  await host.locator(".anim-figure canvas").waitFor();
  await expect(host).not.toHaveClass(/is-enhanced/);
  await page.emulateMedia({ media: "print" });
  await expect(host.locator(".anim-figure__frame")).toBeVisible();
});

test("print, enhanced host: one caption, numbered steps, no live chrome", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"], view: "3d" });
  await page.goto("14-how-to-measure/?nowebgl");
  const host = page.locator('[data-anim="fixture"]');
  await expect(host).toHaveClass(/is-enhanced/);
  await expect(host.locator(".anim-figure__hint--webgl")).toBeVisible(); // on screen
  await page.emulateMedia({ media: "print" });
  await expect(host.locator("figcaption:visible")).toHaveCount(1);
  await expect(host.locator(".anim-fallback figcaption")).toBeVisible();
  for (const hidden of [".anim-figure__head", ".anim-figure__hint--webgl", ".anim-figure__caption", ".anim-controls"]) {
    await expect(host.locator(`.anim-figure ${hidden}`)).toBeHidden();
  }
  const list = host.locator(".anim-figure__step ol.anim-steps");
  expect(await list.evaluate((ol) => getComputedStyle(ol).listStyleType)).toBe("decimal");
  expect(await host.locator(".anim-figure").evaluate((f) => getComputedStyle(f).borderTopWidth)).toBe("0px");
});
