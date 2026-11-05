// Expand and the view row (lib/expand.js, lib/view-switch.js viewRow()):
//   - every 3D figure has Expand in its view row: full screen with the
//     keyboard, "Exit full screen" in the screen's top right corner takes
//     the focus, Escape and that button leave it, the focus comes back to
//     Expand and the page is where it was; the frame is clearly taller than
//     in the page, and the 2D canvas and the 3D renderer follow it at the
//     pixel ratio, as one view;
//   - on every 3D figure at 1440 by 900 the way out is on screen, the frame
//     and a peek of what follows fit, and Tab stays in the figure;
//   - without element full screen (iOS Safari on a phone) the figure is
//     laid over the page, the page held still and inert;
//   - the view row holds the 3D controls' room from the first paint, so
//     the row is as tall in 2D as in 3D, except on a phone, where a figure
//     in 2D keeps only Expand; without WebGL 2 it gives the room back and
//     keeps Expand;
//   - at 1440 px, on the wider frames, every chip and label stays inside.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { REGISTRY, hook, settle, hostOf, stepOn } from "./helpers.js";

const CH01 = "01-why-sinusoids/";
const UTTERANCE = '[data-anim="utterance"]';

test.describe("Expand", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** @param {import("@playwright/test").Page} page */
  const openUtterance = async (page) => {
    await page.goto(CH01);
    const host = page.locator(UTTERANCE);
    await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settle(page, host);
    // Step 1 is the flat closeup, in 2D; step 2 asks for 3D.
    await host.locator('[data-step="next"]').click();
    await expect(host.locator("canvas.anim-figure__canvas--3d")).toBeVisible({ timeout: 15_000 });
    await settle(page, host);
    return host;
  };
  /** The 3D canvas's backing store against its frame, at the pixel ratio. */
  const sizes = (/** @type {import("@playwright/test").Locator} */ host) => host.evaluate((el) => {
    const frame = /** @type {HTMLElement} */ (el.querySelector(".anim-figure__frame"));
    const canvas = /** @type {HTMLCanvasElement} */ (el.querySelector("canvas.anim-figure__canvas--3d"));
    const ratio = Math.min(devicePixelRatio, 2);
    return {
      frame: { w: frame.clientWidth, h: frame.clientHeight },
      canvas: { w: canvas.width, h: canvas.height },
      expected: { w: Math.round(frame.clientWidth * ratio), h: Math.round(frame.clientHeight * ratio) },
      screen: innerHeight,
    };
  });

  test("full screen from the keyboard; Escape leaves it and the focus returns; one view throughout", async ({ page }) => {
    const host = await openUtterance(page);
    const button = host.getByRole("button", { name: "Expand" });
    // Reaching the button scrolls the page, which can bring the next
    // figure near enough to open its own view: count from there.
    await button.scrollIntoViewIfNeeded();
    await settle(page, host);
    const before = await sizes(host);
    const contexts = (await hook(page)).liveContexts;
    await button.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("anim-utterance") ?? false)).toBe(true);
    const exit = host.getByRole("button", { name: "Exit full screen" });
    await expect(exit).toBeVisible();
    await expect(exit).toBeFocused();
    await expect(host.locator(".anim-figure")).toHaveClass(/is-full/);
    // The frame takes the screen's width and most of its height, so the
    // picture is drawn larger, and the renderer follows it.
    await expect.poll(async () => (await sizes(host)).frame.w).toBeGreaterThan(before.frame.w * 1.25);
    // A 3D step can already be most of the screen tall, so only ask it to grow.
    await expect.poll(async () => (await sizes(host)).frame.h).toBeGreaterThan(before.frame.h);
    await expect.poll(async () => { const s = await sizes(host); return s.canvas.w === s.expected.w && s.canvas.h === s.expected.h; }).toBe(true);
    const full = await sizes(host);
    // The step text and controls share the screen with it.
    expect(full.frame.h).toBeGreaterThan(full.screen * 0.7);
    expect((await hook(page)).liveContexts).toBe(contexts);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect(button).toBeFocused();
    await expect(host.locator(".anim-figure")).not.toHaveClass(/is-full/);
    await expect.poll(async () => (await sizes(host)).frame.h).toBe(before.frame.h);
    await expect.poll(async () => { const s = await sizes(host); return s.canvas.h === s.expected.h; }).toBe(true);
    const hooked = await hook(page);
    expect(hooked.liveContexts).toBe(contexts);
    expect(hooked.peakContexts).toBeLessThanOrEqual(hooked.cap);
  });

  test("the button leaves full screen too", async ({ page }) => {
    const host = await openUtterance(page);
    await host.getByRole("button", { name: "Expand" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await host.getByRole("button", { name: "Exit full screen" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect(host.getByRole("button", { name: "Expand" })).toBeFocused();
  });

  for (const [page_, slug, width, height] of [
    ["02-fourier-and-the-dft/", "probe", 1920, 1080],
    ["10-the-dstar-frame/", "fec-protection", 1440, 900],
  ]) {
    test(`leaving puts the page back where it was: ${slug} at ${width} px`, async ({ page }) => {
      // Chromium moved ch02's page to the top as it left full screen.
      await page.setViewportSize({ width, height });
      await page.goto(page_);
      const host = page.locator(hostOf(slug)).first();
      await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await settle(page, host);
      const button = host.locator(".anim-view__expand");
      await button.scrollIntoViewIfNeeded();
      await settle(page, host);
      const y = await page.evaluate(() => window.scrollY);
      await button.click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
      // Through the frames in which the page used to move.
      for (let i = 0; i < 20; i += 1) {
        expect(await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(window.scrollY))))).toBe(y);
      }
    });
  }

  test("a resize while expanded refits the frame, and the renderer follows", async ({ page }) => {
    // A browser window in full screen cannot be resized from a test, so
    // this runs on the overlay, which fits the frame the same way.
    await page.addInitScript(() => {
      for (const name of ["fullscreenEnabled", "webkitFullscreenEnabled"]) {
        Object.defineProperty(Document.prototype, name, { get: () => false, configurable: true });
      }
    });
    // A short screen, where the height binds; then a narrower, taller one.
    await page.setViewportSize({ width: 1440, height: 800 });
    const host = await openUtterance(page);
    await host.getByRole("button", { name: "Expand" }).click();
    await expect(host.locator(".anim-figure")).toHaveClass(/is-overlay/);
    await expect.poll(async () => { const s = await sizes(host); return s.canvas.w === s.expected.w && s.canvas.h === s.expected.h; }).toBe(true);
    const tall = await sizes(host);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await expect.poll(async () => (await sizes(host)).frame.h).toBeGreaterThan(tall.frame.h);
    await expect.poll(async () => (await sizes(host)).frame.w).toBeLessThan(tall.frame.w);
    await expect.poll(async () => { const s = await sizes(host); return s.canvas.w === s.expected.w && s.canvas.h === s.expected.h; }).toBe(true);
  });

  test("the 2D view follows the frame too", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(CH01);
    const host = page.locator(UTTERANCE);
    await settle(page, host);
    const flat = host.locator("canvas.anim-figure__canvas").first();
    const store = () => flat.evaluate((c) => {
      const canvas = /** @type {HTMLCanvasElement} */ (c);
      const box = canvas.getBoundingClientRect();
      return { w: canvas.width, h: canvas.height, cssW: Math.round(box.width), cssH: Math.round(box.height) };
    });
    const before = await store();
    await host.getByRole("button", { name: "Expand" }).click();
    await expect.poll(async () => (await store()).w).toBeGreaterThan(before.w * 1.25);
    // The backing store matches the box at the pixel ratio (1 here).
    await expect.poll(async () => { const s = await store(); return Math.abs(s.w - s.cssW) <= 1 && Math.abs(s.h - s.cssH) <= 1; }).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await store()).w).toBe(before.w);
  });

  test("without element full screen the figure is laid over the page, the page under it inert", async ({ page }) => {
    await page.addInitScript(() => {
      // As on iOS Safari on a phone: no element full screen.
      for (const name of ["fullscreenEnabled", "webkitFullscreenEnabled"]) {
        Object.defineProperty(Document.prototype, name, { get: () => false, configurable: true });
      }
      Reflect.deleteProperty(Element.prototype, "requestFullscreen");
    });
    const host = await openUtterance(page);
    const figure = host.locator(".anim-figure");
    await host.getByRole("button", { name: "Expand" }).scrollIntoViewIfNeeded();
    await settle(page, host);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const scrolled = await page.evaluate(() => window.scrollY);
    const contexts = (await hook(page)).liveContexts;
    await host.getByRole("button", { name: "Expand" }).click();
    await expect(figure).toHaveClass(/is-overlay/);
    const close = host.getByRole("button", { name: "Exit full screen" });
    await expect(close).toBeVisible();
    await expect(close).toBeFocused();
    // Tab and Shift+Tab stay in the figure, and the page under it, inert,
    // keeps its place.
    for (const key of [...Array(30).fill("Tab"), ...Array(10).fill("Shift+Tab")]) {
      await page.keyboard.press(key);
      expect(await figure.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    expect(await page.locator("header.md-header").evaluate((el) => /** @type {HTMLElement} */ (el).inert)).toBe(true);
    await close.focus();
    const box = await figure.boundingBox();
    expect(box).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
    // The page under it keeps its length and its place.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeCloseTo(height, -1);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    await expect.poll(async () => { const s = await sizes(host); return s.canvas.h === s.expected.h && s.frame.h > 400; }).toBe(true);
    expect((await hook(page)).liveContexts).toBe(contexts);
    await page.keyboard.press("Escape");
    await expect(figure).not.toHaveClass(/is-overlay/);
    await expect(host.getByRole("button", { name: "Expand" })).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    expect(await page.locator("header.md-header").evaluate((el) => /** @type {HTMLElement} */ (el).inert)).toBe(false);
    // The button works as well.
    await host.getByRole("button", { name: "Expand" }).click();
    await expect(close).toBeFocused();
    await close.press("Enter");
    await expect(figure).not.toHaveClass(/is-overlay/);
    await expect(close).toBeHidden();
    await expect(host.getByRole("button", { name: "Expand" })).toBeFocused();
  });

  test("axe finds nothing serious in the row, in the page or in full screen; the Zoom slot is out of the tree", async ({ page }) => {
    const host = await openUtterance(page);
    const row = host.locator(".anim-view");
    await expect(host.getByRole("button", { name: "Expand" })).toBeVisible();
    // The slot that holds the Zoom group's room is never read or reached.
    const slot = row.locator(".anim-view__slot");
    await expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(await slot.evaluate((el) => /** @type {HTMLElement} */ (el).inert)).toBe(true);
    await expect(host.getByRole("group", { name: "Zoom" })).toHaveCount(1);
    const serious = async () => (await new AxeBuilder({ page }).include(UTTERANCE).analyze()).violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(await serious()).toEqual([]);
    await host.getByRole("button", { name: "Expand" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    expect(await serious()).toEqual([]);
  });
});

test("the view row is there before the figure first paints", async ({ page }) => {
  await page.addInitScript(() => {
    /** @type {string[]} */
    const seen = [];
    Object.assign(window, { __rows: seen });
    new MutationObserver((records) => {
      for (const record of records) {
        const host = /** @type {Element} */ (record.target);
        if (record.attributeName !== "class" || !host.matches?.("[data-anim].is-enhanced")) continue;
        if (record.oldValue?.includes("is-enhanced")) continue;
        seen.push(`${host.getAttribute("data-anim")}:${host.querySelector(".anim-view") ? "row" : "none"}`);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  });
  await page.goto(CH01);
  await page.waitForLoadState("networkidle");
  const rows = await page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (window).__rows));
  expect(rows.sort()).toEqual(["filter:none", "three-numbers:row", "utterance-spectra:row", "utterance:row"]);
});

test.describe("Expand sits in the controls row, and the view row shows only in 3D", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  for (const { page: path, slug, control } of REGISTRY.filter((r) => r.control)) {
    test(`${slug}`, async ({ page }) => {
      // Reduced motion opens every figure in 2D.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      const host = page.locator(hostOf(slug)).first();
      await settle(page, host);
      // A step about a flat graph can hide the 3D control: step on until it shows.
      const toggle = host.locator(`.anim-controls ${control}`).first();
      await stepOn(page, host, () => toggle.isVisible());
      const expand = host.locator(".anim-view__expand");
      await expect(expand).toBeVisible();
      expect(await expand.evaluate((el) => el.parentElement?.classList.contains("anim-controls"))).toBe(true);
      const row = host.locator(".anim-view");
      await expect(row).toBeHidden();
      await toggle.click();
      await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(host.locator("canvas.anim-figure__canvas--3d").first()).toBeVisible({ timeout: 15_000 });
      await settle(page, host);
      await expect(host.getByRole("group", { name: "Zoom" })).toBeVisible();
      await expect(row).toBeVisible();
      expect(await expand.evaluate((el) => el.parentElement?.classList.contains("anim-controls"))).toBe(true);
    });
  }
});

test("without WebGL 2 the view row takes no room and Expand stays in the controls row", async ({ page }) => {
  await page.goto(`${CH01}?nowebgl`);
  const host = page.locator(UTTERANCE);
  await host.locator(".anim-figure").waitFor();
  const row = host.locator(".anim-view");
  await expect(row).toHaveAttribute("data-no3d", "");
  await expect(row).toBeHidden();
  await expect(host.locator(".anim-controls .anim-view__expand")).toBeVisible();
});

test.describe("chips stay inside the wider frames", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  for (const { page: path, slug, control } of REGISTRY.filter((r) => r.control)) {
    test(`${slug} at 1440 px, in 3D on its end state`, async ({ page }) => {
      await page.goto(path);
      const host = page.locator(hostOf(slug)).first();
      await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await settle(page, host);
      const toggle = host.locator(`.anim-controls ${control}`).first();
      // A step about a flat graph can hide the 3D control: step on until it shows.
      await stepOn(page, host, () => toggle.isVisible());
      if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
      await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(host.locator("canvas.anim-figure__canvas--3d").first()).toBeVisible({ timeout: 15_000 });
      await settle(page, host);
      const out = await host.evaluate((el) => {
        const frame = el.querySelector(".anim-figure__frame")?.getBoundingClientRect();
        if (!frame) return ["no frame"];
        return [...el.querySelectorAll(".anim-chip, .anim-figure__label")].flatMap((chip) => {
          const style = getComputedStyle(chip);
          const box = chip.getBoundingClientRect();
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || !box.width) return [];
          if (!chip.closest(".anim-figure__frame")) return [];
          const off = box.left < frame.left - 1 || box.right > frame.right + 1 || box.top < frame.top - 1 || box.bottom > frame.bottom + 1;
          return off ? [`${chip.textContent?.trim()} at ${Math.round(box.left)},${Math.round(box.top)}-${Math.round(box.right)},${Math.round(box.bottom)}`] : [];
        });
      });
      expect(out).toEqual([]);
    });
  }
});

test.describe("expanded, every 3D figure fits the screen and keeps the keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  for (const { page: path, slug } of REGISTRY.filter((r) => r.control)) {
    test(`${slug} at 1440 by 900`, async ({ page }) => {
      await page.goto(path);
      const host = page.locator(hostOf(slug)).first();
      await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await settle(page, host);
      const button = host.locator(".anim-view__expand");
      await button.scrollIntoViewIfNeeded();
      const inPage = await host.locator(".anim-figure__frame--view").first().evaluate((el) => el.getBoundingClientRect().height);
      await button.click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
      const exit = host.getByRole("button", { name: "Exit full screen" });
      await expect(exit).toBeFocused();
      await expect.poll(() => host.locator(".anim-figure__frame--full").count()).toBe(1);
      const at = await page.evaluate(() => {
        const box = (/** @type {string} */ q) => document.querySelector(q)?.getBoundingClientRect() ?? null;
        return { exit: box(".is-full .anim-figure__close"), frame: box(".is-full .anim-figure__frame--full"), screen: innerHeight };
      });
      if (!at.exit || !at.frame) throw new Error("no exit or frame");
      // The way out is on screen, the frame fits, and it is never shorter
      // than in the page unless the screen is.
      expect(at.exit.top).toBeGreaterThanOrEqual(0);
      expect(at.exit.bottom).toBeLessThanOrEqual(at.screen);
      expect(at.frame.bottom).toBeLessThanOrEqual(at.screen);
      expect(at.frame.height).toBeGreaterThanOrEqual(Math.min(inPage, at.screen - at.frame.top - 20) - 1);
      for (let i = 0; i < 30; i += 1) {
        await page.keyboard.press("Tab");
        expect(await host.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
      await expect(button).toBeFocused();
    });
  }
});

test("on a phone a figure in 2D has no view row, and Expand stays in the controls row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(CH01);
  const host = page.locator(UTTERANCE);
  await settle(page, host);
  await expect(host.locator(".anim-view")).toBeHidden();
  await expect(host.locator(".anim-controls .anim-view__expand")).toBeVisible();
  // Step 1 is the flat closeup, with no 3D control; step 2 has it.
  await host.locator('[data-step="next"]').click();
  await host.locator('.anim-controls [data-ref="view3d"]').click();
  await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toBeVisible({ timeout: 15_000 });
  await settle(page, host);
  await expect(host.getByRole("group", { name: "Camera" })).toBeVisible();
  await expect(host.getByRole("group", { name: "Zoom" })).toBeVisible();
});
