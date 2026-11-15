// anim-three.js (design §3.4), through the fixture figure in 3D.
import { test, expect } from "@playwright/test";
import { REGISTRY, countAnimObservers, gate, hook, settle, useFixture, visit, hostOf, stepOn, to3D } from "./helpers.js";

const CANVAS_3D = '[data-anim="fixture"] canvas.anim-figure__canvas--3d';

/**
 * @param {import("@playwright/test").Page} page
 * @param {{view?: "2d" | "3d", at?: "top" | "end", query?: string}} [options]
 */
async function open(page, { view = "3d", at = "top", query = "" } = {}) {
  /** @type {string[]} */
  const vendor = [];
  page.on("request", (r) => { if (r.url().includes("/vendor/three/")) vendor.push(r.url()); });
  // 14 is short: at "end", empty space keeps the host out of reach at first.
  await useFixture(page, { chapters: ["14-how-to-measure/"], view, at, lead: at === "end" ? 4000 : 0 });
  await page.goto(`14-how-to-measure/${query}`);
  await page.locator('[data-anim="fixture"].is-enhanced').waitFor();
  return vendor;
}

/** @param {import("@playwright/test").Page} page */
const fixture = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  return window.__fixture;
});

test("no three on a page without a 3D request", async ({ page }) => {
  const vendor = await open(page, { view: "2d" });
  await page.waitForLoadState("networkidle");
  expect(vendor).toEqual([]);
  expect((await hook(page)).webglProbes).toBe(0);
});

test("3D: one context, three and its line addons, role img, touch-action", async ({ page }) => {
  const vendor = await open(page);
  await page.locator(CANVAS_3D).waitFor();
  expect((await hook(page)).liveContexts).toBe(1);
  expect(vendor.map((u) => u.split("/").pop()).sort()).toEqual([
    "LineMaterial.js", "LineSegments2.js", "LineSegmentsGeometry.js", "three.core.min.js", "three.module.min.js",
  ]);
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("role", "img");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /\S/);
  // No zoom on this view, so a pinch still zooms the page.
  expect(await page.locator(CANVAS_3D).evaluate((c) => getComputedStyle(c).touchAction)).toBe("pan-y pinch-zoom");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("tabindex", "0");
  expect((await fixture(page)).builds).toBe(1);
});

test("lazy start: no context until the host is near the viewport", async ({ page }) => {
  await open(page, { at: "end" });
  await page.waitForLoadState("networkidle");
  expect((await hook(page)).liveContexts).toBe(0);
  await page.locator('[data-anim="fixture"]').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(1);
});

test("renders on demand, not every frame", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(300);
  const before = (await hook(page)).renders;
  await page.waitForTimeout(1000);
  expect((await hook(page)).renders).toBe(before);
});

test("no render while hidden", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(300);
  const before = (await hook(page)).renders;
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    // @ts-ignore test-only global
    window.__fixture.three.requestRender();
  });
  await page.waitForTimeout(300);
  expect((await hook(page)).renders).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await hook(page)).renders).toBe(before + 1);
});

test("pixel ratio is capped at 2", async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  await open(page);
  const canvas = page.locator(CANVAS_3D);
  await canvas.waitFor();
  await expect.poll(() => canvas.evaluate((c) => {
    if (!(c instanceof HTMLCanvasElement)) return -1;
    return c.width / c.getBoundingClientRect().width;
  })).toBeCloseTo(2, 1);
  await context.close();
});

test("theme tokens colour the materials and follow a scheme change", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const colours = await page.evaluate(() => {
    // @ts-ignore test-only global
    const points = window.__fixture.pointsMaterial;
    const before = points.color.getHex();
    document.body.setAttribute("data-md-color-scheme", "default");
    return new Promise((resolve) => requestAnimationFrame(() => resolve([before, points.color.getHex()])));
  });
  expect(colours).toEqual([0x3ddbc0, 0x067a68]); // --ambe-accent-cool, slate then light
});

test("context loss pauses with a resume button; restore rebuilds", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__fixture.three.renderer.getContext().getExtension("WEBGL_lose_context").loseContext();
  });
  const frame = page.locator('[data-anim="fixture"] .anim-figure__frame');
  await expect(frame).toHaveAttribute("data-state", "paused");
  const resume = frame.locator(".anim-figure__resume");
  await expect(resume).toHaveText("Graphics paused. Select to resume.");
  await resume.click();
  await expect(frame).not.toHaveAttribute("data-state", "paused");
  await expect.poll(async () => (await fixture(page)).builds).toBe(2);
});

test("?nowebgl: 2D stays, the 3D control is disabled with the hint", async ({ page }) => {
  const vendor = await open(page, { query: "?nowebgl" });
  const button = page.locator('[data-anim="fixture"] [data-ref="view3d"]');
  await expect(button).toBeDisabled();
  await expect(page.locator('[data-anim="fixture"] .anim-figure__hint--webgl')).toHaveText("3D needs WebGL 2");
  await expect(page.locator('[data-anim="fixture"] canvas:not(.anim-figure__canvas--3d)')).toBeVisible();
  expect(vendor).toEqual([]);
  expect((await hook(page)).liveContexts).toBe(0);
});

test("getContext('webgl2') returning null: same fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    // @ts-ignore stub for the test
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      return kind === "webgl2" ? null : native.call(this, kind, ...rest);
    };
  });
  await open(page);
  await expect(page.locator('[data-anim="fixture"] [data-ref="view3d"]')).toBeDisabled();
  expect((await hook(page)).webglProbes).toBe(1);
});

test("toggle ten times: one context at most, one probe", async ({ page }) => {
  await open(page, { view: "2d" });
  const button = page.locator('[data-anim="fixture"] [data-ref="view3d"]');
  for (let i = 0; i < 10; i += 1) {
    await button.click(); // on
    await page.locator(CANVAS_3D).waitFor();
    await button.click(); // off
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  }
  const h = await hook(page);
  expect(h.peakContexts).toBe(1);
  expect(h.liveContexts).toBe(0);
  expect(h.webglProbes).toBe(1);
});

test("mountThree twice on one frame: one renderer", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const same = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const again = await window.__fixture.mountAgain();
    // @ts-ignore test-only global
    return again === window.__fixture.three;
  });
  expect(same).toBe(true);
  expect((await hook(page)).liveContexts).toBe(1);
});

test("reduced motion: animate jumps to the end in one render", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const steps = await page.evaluate(async () => {
    /** @type {number[]} */
    const seen = [];
    // @ts-ignore test-only global
    await window.__fixture.three.animate(250, (t) => seen.push(t));
    return seen;
  });
  expect(steps).toEqual([1]);
});

test("teardown: navigating away frees the context", async ({ page }) => {
  await countAnimObservers(page);
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__keep = { canvas: document.querySelector("canvas.anim-figure__canvas--3d"),
      // @ts-ignore test-only global
      gl: window.__fixture.three.renderer.getContext() };
  });
  await visit(page, "15-exact-reproduction/");
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
  const kept = await page.evaluate(() => {
    // @ts-ignore test-only global
    const { canvas, gl } = window.__keep;
    return { width: canvas.width, height: canvas.height, lost: gl.isContextLost() };
  });
  expect(kept).toEqual({ width: 0, height: 0, lost: true }); // forceContextLoss ran
});

test("import held, navigate away: no context afterwards", async ({ page }) => {
  const held = gate();
  await page.route("**/vendor/three/three.core.min.js", async (route) => {
    await held.wait;
    await route.continue();
  });
  await useFixture(page, { chapters: ["14-how-to-measure/"], view: "3d" });
  await page.goto("14-how-to-measure/");
  await page.locator('[data-anim="fixture"].is-enhanced').waitFor();
  await visit(page, "15-exact-reproduction/");
  held.release();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  const h = await hook(page);
  expect(h.liveContexts).toBe(0);
  expect(h.peakContexts).toBe(0);
});

test("context lost, then leave 3D: the paused scrim goes with the view", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__fixture.three.renderer.getContext().getExtension("WEBGL_lose_context").loseContext();
  });
  const frame = page.locator('[data-anim="fixture"] .anim-figure__frame');
  await expect(frame).toHaveAttribute("data-state", "paused");
  await page.locator('[data-anim="fixture"] [data-ref="view3d"]').click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(frame).not.toHaveAttribute("data-state", /./);
});

test("restore puts back the state set after mount, not the one at mount", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const frame = page.locator('[data-anim="fixture"] .anim-figure__frame');
  await page.evaluate(() => {
    const el = /** @type {HTMLElement} */ (document.querySelector('[data-anim="fixture"] .anim-figure__frame'));
    el.dataset.state = "error";
    // @ts-ignore test-only global
    window.__fixture.three.renderer.getContext().getExtension("WEBGL_lose_context").loseContext();
  });
  await expect(frame).toHaveAttribute("data-state", "paused");
  await frame.locator(".anim-figure__resume").click();
  await expect(frame).toHaveAttribute("data-state", "error");
});

test("animate: a tween cut short by another, or by dispose, still resolves", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const settled = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const three = window.__fixture.three;
    const within = (/** @type {Promise<void>} */ p) =>
      Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 600))]);
    const first = three.animate(250, () => {});
    await new Promise((r) => requestAnimationFrame(r));
    const second = three.animate(250, () => {});
    const replaced = await within(first);
    three.dispose();
    return [replaced, await within(second)];
  });
  expect(settled).toEqual([true, true]);
});

test("3D on, then off while three loads: no view opens", async ({ page }) => {
  const held = gate();
  await page.route("**/vendor/three/three.core.min.js", async (route) => {
    await held.wait;
    await route.continue();
  });
  await open(page, { view: "2d" });
  const button = page.locator('[data-anim="fixture"] [data-ref="view3d"]');
  await button.click(); // on
  await button.click(); // off, before three has loaded
  held.release();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toBeEnabled();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator('[data-anim="fixture"] canvas:not(.anim-figure__canvas--3d)')).toBeVisible();
  expect((await hook(page)).liveContexts).toBe(0);
  await button.click(); // and a later request still opens
  await page.locator(CANVAS_3D).waitFor();
  expect((await hook(page)).liveContexts).toBe(1);
});

test("build() throws: the context is released and 2D stays", async ({ page }) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, { view: "2d" });
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__fixture.failBuild = true;
  });
  const button = page.locator('[data-anim="fixture"] [data-ref="view3d"]');
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator('[data-anim="fixture"] canvas:not(.anim-figure__canvas--3d)')).toBeVisible();
  expect((await hook(page)).liveContexts).toBe(0);
  expect(errors).toEqual([]); // no unhandled rejection
});

/* ---------------------------------------------------------------------------
 * ctx.timeline() (three-visual-language design §6, plan P6)
 * ------------------------------------------------------------------------ */

test("timeline: two tracks run in parallel from one loop and both resolve on t = 1", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const result = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const tl = window.__fixture.three.timeline();
    /** @type {Record<string, number[]>} */
    const seen = { a: [], b: [] };
    const begin = performance.now();
    const ends = await Promise.all([
      tl.play("a", { ms: 200, ease: "linear", step: (/** @type {number} */ t) => seen.a.push(t) }).then(() => performance.now() - begin),
      tl.play("b", { ms: 300, ease: "inout", step: (/** @type {number} */ t) => seen.b.push(t) }).then(() => performance.now() - begin),
    ]);
    await tl.done();
    return { seen, ends };
  });
  expect(result.seen.a.at(-1)).toBe(1);
  expect(result.seen.b.at(-1)).toBe(1);
  expect(result.seen.a.length).toBeGreaterThan(3);
  expect(result.seen.b.some((t) => t > 0 && t < 1)).toBe(true);
  // In parallel: the 300 ms track ends well before 500 ms.
  expect(result.ends[1]).toBeLessThan(480);
  expect((await hook(page)).tracks.fixture).toBe(2);
});

test("timeline: restarting a running name settles the old track at t = 1", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const result = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const tl = window.__fixture.three.timeline();
    /** @type {number[]} */
    const first = [];
    const old = tl.play("camera", { ms: 5000, step: (/** @type {number} */ t) => first.push(t) });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const again = tl.play("camera", { ms: 100, step: () => {} });
    await old;
    await again;
    return first.at(-1);
  });
  expect(result).toBe(1);
});

test("timeline: reader input, a hidden tab and finishAll land every track on its end", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  /** @param {string} how */
  const cut = (how) => page.evaluate(async (way) => {
    // @ts-ignore test-only global
    const ctx = window.__fixture.three;
    /** @type {number[]} */
    const seen = [];
    const begin = performance.now();
    const track = ctx.timeline().play("x", { ms: 10_000, step: (/** @type {number} */ t) => seen.push(t) });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (way === "pointer") ctx.renderer.domElement.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    if (way === "key") ctx.renderer.domElement.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    if (way === "hidden") {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    }
    if (way === "finishAll") window.__ambeAnim?.finishAll();
    await track;
    if (way === "hidden") {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    }
    return { last: seen.at(-1), ms: performance.now() - begin };
  }, how);
  for (const how of ["pointer", "key", "hidden", "finishAll"]) {
    const { last, ms } = await cut(how);
    expect(last, how).toBe(1);
    expect(ms, how).toBeLessThan(2000);
  }
});

test("timeline: a build waits until the frame is half visible; below a quarter, a running track ends", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const frame = page.locator('[data-anim="fixture"] .anim-figure__frame');
  // The viewport's bottom edge cuts the frame so that `part` of it shows.
  const showing = async (/** @type {number} */ part) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await frame.evaluate((f) => {
      const r = f.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    await page.setViewportSize({ width: 1280, height: Math.round(box.top + box.height * part) });
    await page.waitForTimeout(200);
  };
  await showing(0.35);
  await page.evaluate(() => {
    // @ts-ignore test-only global
    const ctx = window.__fixture.three;
    // @ts-ignore test-only global
    window.__built = [];
    // @ts-ignore test-only global
    ctx.timeline().play("build", { ms: 100, build: true, step: (t) => window.__built.push(t) });
  });
  await page.waitForTimeout(400);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__built.length)).toBe(0);
  await showing(1);
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__built.at(-1))).toBe(1);
  // A running track ends as soon as less than a quarter shows.
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__long = [];
    // @ts-ignore test-only global
    window.__fixture.three.timeline().play("long", { ms: 20_000, step: (t) => window.__long.push(t) });
  });
  await showing(0.1);
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__long.at(-1))).toBe(1);
});

test("timeline: reduced motion lands every track on its end in one render", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(300);
  const before = (await hook(page)).renders;
  const steps = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const tl = window.__fixture.three.timeline();
    /** @type {[number, number][]} */
    const seen = [];
    await Promise.all([
      tl.play("a", { ms: 900, count: 4, stagger: 35, step: (/** @type {number} */ t, /** @type {number} */ i) => seen.push([t, i]) }),
      tl.play("b", { ms: 700, ease: "inout", step: (/** @type {number} */ t) => seen.push([t, -1]) }),
    ]);
    return seen;
  });
  expect(steps).toEqual([[1, 0], [1, 1], [1, 2], [1, 3], [1, -1]]);
  await page.waitForTimeout(300);
  expect((await hook(page)).renders).toBe(before + 1);
});

test("timeline: no animation frame is asked for while no track runs", async ({ page }) => {
  await page.addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window);
    // @ts-ignore test-only global
    window.__rafs = 0;
    window.requestAnimationFrame = (cb) => {
      // @ts-ignore test-only global
      window.__rafs += 1;
      return native(cb);
    };
  });
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(async () => {
    // @ts-ignore test-only global
    await window.__fixture.three.timeline().play("a", { ms: 150, step: () => {} });
  });
  await page.waitForTimeout(300);
  // @ts-ignore test-only global
  const idle = await page.evaluate(() => window.__rafs);
  await page.waitForTimeout(1000);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__rafs)).toBe(idle);
});

/* ---------------------------------------------------------------------------
 * Zoom (three-visual-language design §5, plan P8), on the fixture's 3D part
 * ------------------------------------------------------------------------ */

/**
 * The fixture's 3D part, zoom on, settled on its intro's end.
 * @param {import("@playwright/test").Page} page
 */
async function openZoom(page) {
  // Tall enough that the canvas's middle is on screen at the top of the
  // page (the step card and title above it put it at y 633), short enough
  // that the page still scrolls.
  await page.setViewportSize({ width: 1280, height: 900 });
  await useFixture(page, { chapters: ["14-how-to-measure/"], view: "auto" });
  await page.goto("14-how-to-measure/");
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  return {
    canvas: page.locator(CANVAS_3D),
    group: page.locator('[data-anim="fixture"] .anim-zoom'),
    zoom: () => page.evaluate(() => {
      window.__ambeAnim?.finishAll();
      // @ts-ignore test-only global
      return window.__fixture.orbit.zoom();
    }),
  };
}

test("zoom: a plain wheel over the canvas scrolls the page and shows the hint; Ctrl+wheel zooms", async ({ page }) => {
  const { canvas, zoom } = await openZoom(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('[data-anim="fixture"] .anim-zoom-hint')).toBeVisible();
  await expect(page.locator('[data-anim="fixture"] .anim-zoom-hint')).toHaveText("Hold Ctrl (⌘ on a Mac) and scroll to zoom");
  expect(await zoom()).toBe(1);
  await expect(page.locator('[data-anim="fixture"] .anim-zoom-hint')).toBeHidden({ timeout: 3000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const again = await canvas.boundingBox();
  if (!again) throw new Error("no canvas box");
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(zoom).toBeGreaterThan(1.2);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("zoom: the buttons step by 1.25, stop at 1x and 6x, and the readout follows", async ({ page }) => {
  const { group, zoom } = await openZoom(page);
  const out = group.getByRole("button", { name: "Zoom out" });
  const into = group.getByRole("button", { name: "Zoom in" });
  const reset = group.getByRole("button", { name: "Reset view" });
  const readout = group.locator("output");
  await expect(readout).toHaveText("1.0×");
  await expect(readout).toHaveAttribute("aria-live", "polite");
  await expect(out).toBeDisabled();
  await expect(reset).toBeDisabled();
  await into.click();
  expect(await zoom()).toBeCloseTo(1.25, 5);
  await expect(readout).toHaveText("1.3×");
  await expect(out).toBeEnabled();
  for (let i = 0; i < 12 && (await into.isEnabled()); i += 1) {
    await into.click();
    await zoom();
  }
  expect(await zoom()).toBe(6);
  await expect(into).toBeDisabled();
  await expect(readout).toHaveText("6.0×");
  await reset.click();
  expect(await zoom()).toBe(1);
  await expect(reset).toBeDisabled();
});

test("zoom: a preset flies back to 1x; a drag keeps the zoom", async ({ page }) => {
  const { canvas, group, zoom } = await openZoom(page);
  await group.getByRole("button", { name: "Zoom in" }).click();
  await group.getByRole("button", { name: "Zoom in" }).click();
  expect(await zoom()).toBeCloseTo(1.5625, 5);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + 200, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 100, { steps: 4 });
  await page.mouse.up();
  expect(await zoom()).toBeCloseTo(1.5625, 5);
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__fixture.switch.preset("top");
  });
  expect(await zoom()).toBe(1);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__fixture.orbit.pose())).toEqual({ yaw: 0, pitch: 90 });
});

test("zoom: a double-click zooms 2x toward the point, the next returns to 1x", async ({ page }) => {
  const { canvas, zoom } = await openZoom(page);
  await canvas.dblclick({ position: { x: 100, y: 80 } });
  expect(await zoom()).toBe(2);
  await canvas.dblclick({ position: { x: 100, y: 80 } });
  expect(await zoom()).toBe(1);
});

test("zoom: + and - and 0 on the focused canvas; its label says how", async ({ page }) => {
  const { canvas, zoom } = await openZoom(page);
  await expect(canvas).toHaveAttribute("aria-label", /Zoom with the buttons, or with plus and minus when focused\.$/);
  await canvas.focus();
  await page.keyboard.press("+");
  expect(await zoom()).toBeCloseTo(1.25, 5);
  await page.keyboard.press("=");
  expect(await zoom()).toBeCloseTo(1.5625, 5);
  await page.keyboard.press("-");
  expect(await zoom()).toBeCloseTo(1.25, 5);
  await page.keyboard.press("0");
  expect(await zoom()).toBe(1);
});

test("zoom: a two-finger pinch zooms around its middle", async ({ page }) => {
  const { canvas, zoom } = await openZoom(page);
  await canvas.evaluate((c) => {
    const box = c.getBoundingClientRect();
    const at = (/** @type {string} */ type, /** @type {number} */ id, /** @type {number} */ x) => c.dispatchEvent(new PointerEvent(type,
      { pointerId: id, pointerType: "touch", clientX: box.left + x, clientY: box.top + box.height / 2, bubbles: true }));
    at("pointerdown", 11, 300);
    at("pointerdown", 12, 400);
    at("pointermove", 12, 500);
    at("pointerup", 11, 300);
    at("pointerup", 12, 500);
  });
  expect(await zoom()).toBeCloseTo(2, 5);
});

test("zoom: the front view at 1x is the same after a zoom round trip", async ({ page }) => {
  await openZoom(page);
  const corners = () => page.evaluate(() => {
    window.__ambeAnim?.finishAll();
    // @ts-ignore test-only global
    const ctx = window.__fixture.three;
    ctx.camera.updateMatrixWorld();
    const out = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const v = new ctx.three.Vector3(x, y, 1).project(ctx.camera);
      out.push(Math.round(((v.x + 1) / 2) * ctx.frame.clientWidth * 100) / 100, Math.round(((1 - v.y) / 2) * ctx.frame.clientHeight * 100) / 100);
    }
    return out;
  });
  // @ts-ignore test-only global
  await page.evaluate(() => window.__fixture.switch.preset("front"));
  const before = await corners();
  await page.evaluate(async () => {
    // @ts-ignore test-only global
    const orbit = window.__fixture.orbit;
    await orbit.zoomBy(3, 0.6, -0.4);
    await orbit.zoomBy(1 / 3, -0.2, 0.3);
  });
  expect(await corners()).toEqual(before);
});

test("zoom: a click or a drag holds the wheel only until Escape or the pointer leaves; at 1x a wheel down scrolls the page", async ({ page }) => {
  const { canvas, zoom } = await openZoom(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const scrollY = () => page.evaluate(() => window.scrollY);
  // Pressed and still over the canvas: engaged, so a wheel up zooms.
  await page.mouse.click(middle.x, middle.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(zoom).toBeGreaterThan(1);
  // Engaged at 1x, a wheel down has nothing to zoom out of: the page scrolls.
  await page.evaluate(async () => {
    // @ts-ignore test-only global
    await window.__fixture.orbit.resetView();
  });
  await page.mouse.wheel(0, 100);
  await expect.poll(scrollY).toBeGreaterThan(0);
  expect(await zoom()).toBe(1);
  // Escape lets the page have the wheel back, though the canvas keeps focus.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.click(middle.x, middle.y);
  await page.keyboard.press("Escape");
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  expect(await zoom()).toBe(1);
  // A drag, then the pointer leaving and coming back: the page scrolls.
  await page.evaluate(() => window.scrollTo(0, 0));
  const again = await canvas.boundingBox();
  if (!again) throw new Error("no canvas box");
  await page.mouse.move(again.x + 200, again.y + 100);
  await page.mouse.down();
  await page.mouse.move(again.x + 260, again.y + 100, { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(again.x + again.width / 2, again.y - 40);
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.wheel(0, 100);
  await expect.poll(scrollY).toBeGreaterThan(0);
  expect(await zoom()).toBe(1);
});

test("zoom: the canvas focused from the keyboard holds the wheel", async ({ page }) => {
  const { canvas, zoom } = await openZoom(page);
  await page.locator('[data-anim="fixture"] [data-ref="view3d"]').focus();
  for (let i = 0; i < 10 && !(await canvas.evaluate((c) => c === document.activeElement)); i += 1) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(canvas).toBeFocused();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  // Focusing scrolled the canvas into view; the wheel scrolls nothing.
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await expect.poll(zoom).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("zoom: Reset view after a drag flies back to the current preset at 1x, and is enabled until it gets there", async ({ page }) => {
  const { canvas, group } = await openZoom(page);
  const reset = group.getByRole("button", { name: "Reset view" });
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__fixture.switch.preset("top");
    window.__ambeAnim?.finishAll();
  });
  await expect(reset).toBeDisabled();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + 200, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 100, { steps: 4 });
  await page.mouse.up();
  // @ts-ignore test-only global
  expect((await page.evaluate(() => window.__fixture.orbit.pose())).yaw).not.toBe(0);
  await expect(reset).toBeEnabled();
  await reset.click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__fixture.orbit.pose())).toEqual({ yaw: 0, pitch: 90 });
  await expect(reset).toBeDisabled();
});

test("zoom: one Zoom in press writes the readout once", async ({ page }) => {
  const { group } = await openZoom(page);
  const readout = group.locator("output");
  await readout.evaluate((out) => {
    /** @type {string[]} */
    const writes = [];
    // @ts-ignore test-only global
    window.__writes = writes;
    new MutationObserver(() => writes.push(out.textContent ?? "")).observe(out, { childList: true, characterData: true, subtree: true });
  });
  await group.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(800);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__writes)).toEqual(["1.3×"]);
});

test("zoom: the canvas label keeps the zoom sentence when the figure rewrites it", async ({ page }) => {
  const { canvas } = await openZoom(page);
  await expect(canvas).toHaveAttribute("aria-label", "Fixture curve of 300 points on three axes. Zoom with the buttons, or with plus and minus when focused.");
  await canvas.evaluate((c) => c.setAttribute("aria-label", "Fixture curve, step two"));
  await expect(canvas).toHaveAttribute("aria-label", "Fixture curve, step two. Zoom with the buttons, or with plus and minus when focused.");
  await canvas.evaluate((c) => c.setAttribute("aria-label", "Fixture curve, step three."));
  await expect(canvas).toHaveAttribute("aria-label", "Fixture curve, step three. Zoom with the buttons, or with plus and minus when focused.");
});

test("zoom: the zoomable canvas takes the pinch (pan-y); a 3D canvas without zoom leaves the pinch to the page", async ({ page }) => {
  const { canvas } = await openZoom(page);
  expect(await canvas.evaluate((c) => getComputedStyle(c).touchAction)).toBe("pan-y");
  const plain = await canvas.evaluate((c) => {
    const frame = /** @type {HTMLElement} */ (c.parentElement);
    frame.classList.remove("anim-figure__frame--zoom");
    return getComputedStyle(c).touchAction;
  });
  expect(plain).toBe("pan-y pinch-zoom");
});

test("zoom: 3D on and off leaves no listener on the frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useFixture(page, { chapters: ["14-how-to-measure/"], view: "auto" });
  await page.goto("14-how-to-measure/");
  const host = page.locator('[data-anim="fixture"]');
  await host.locator(".anim-figure__frame").waitFor();
  const cdp = await page.context().newCDPSession(page);
  const listeners = async () => {
    const { result } = await cdp.send("Runtime.evaluate", { expression: 'document.querySelector(\'[data-anim="fixture"] .anim-figure__frame\')' });
    const { listeners: found } = await cdp.send("DOMDebugger.getEventListeners", { objectId: /** @type {string} */ (result.objectId) });
    /** @type {Record<string, number>} */
    const count = {};
    for (const l of found) count[l.type] = (count[l.type] ?? 0) + 1;
    return count;
  };
  const before = await listeners();
  const button = host.locator('[data-ref="view3d"]');
  for (let i = 0; i < 3; i += 1) {
    await button.click();
    await page.locator(CANVAS_3D).waitFor();
    await button.click();
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  }
  expect(await listeners()).toEqual(before);
});

/* ---------------------------------------------------------------------------
 * Every live 3D figure, from the registry (plan P11; VL7's per-view caps)
 * ------------------------------------------------------------------------ */

for (const { page: path, slug, control } of REGISTRY.filter((r) => r.control)) {
  test(`${slug}: in 3D, at most 30 draw calls and 100k triangles a frame, 3 tracks at once`, async ({ page }) => {
    await page.goto(path);
    const host = page.locator(hostOf(slug));
    await expect(host).toHaveClass(/is-enhanced/);
    await host.scrollIntoViewIfNeeded();
    const button = host.locator(`.anim-controls ${control}`);
    // A step about a flat graph can hide the 3D control: step on until it shows.
    await stepOn(page, host, () => button.isVisible());
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    await host.locator("canvas.anim-figure__canvas--3d").waitFor();
    await settle(page, host);
    const h = await hook(page);
    const draws = h.draws[slug];
    expect(draws.calls).toBeGreaterThan(0);
    expect(draws.calls).toBeLessThanOrEqual(30);
    expect(draws.triangles).toBeLessThanOrEqual(100_000);
    expect(h.tracks[slug] ?? 0).toBeLessThanOrEqual(3);
  });
}

// Zoom comes from createOrbit({zoom: true}) with no figure code (VL5). A
// shipped figure turns it on in its own task, and sets `zoom` in its own
// registry file; until then its case skips. With `zoom` set, a figure that
// shows no Zoom group fails.
for (const { page: path, slug, control, zoom } of REGISTRY.filter((r) => r.control)) {
  test(`${slug}: in 3D, the Zoom group stops at 1x and 6x and its readout follows`, async ({ page }) => {
    test.skip(!zoom, `${slug} has not turned zoom on yet (registry "zoom": false)`);
    await page.goto(path);
    const host = page.locator(hostOf(slug));
    await expect(host).toHaveClass(/is-enhanced/);
    await host.scrollIntoViewIfNeeded();
    const button = host.locator(`.anim-controls ${control}`);
    // A step about a flat graph can hide the 3D control: step on until it shows.
    await stepOn(page, host, () => button.isVisible());
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    await host.locator("canvas.anim-figure__canvas--3d").waitFor();
    await settle(page, host);
    const group = host.getByRole("group", { name: "Zoom" });
    await expect(group).toHaveCount(1);
    const into = group.getByRole("button", { name: "Zoom in" });
    const out = group.getByRole("button", { name: "Zoom out" });
    await expect(out).toBeDisabled();
    for (let i = 0; i < 12 && (await into.isEnabled()); i += 1) {
      await into.click();
      await page.evaluate(() => window.__ambeAnim?.finishAll());
    }
    await expect(group.locator("output")).toHaveText("6.0×");
    await expect(into).toBeDisabled();
    await group.getByRole("button", { name: "Reset view" }).click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    await expect(group.locator("output")).toHaveText("1.0×");
    await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveAttribute("tabindex", "0");
  });
}

// The first-view animation plays once per page load, and leaving the figure
// and coming back never replays it (owner decision O1). Figures name their
// animation in their registry file when their task builds it. Parking and
// unparking real figures without a replay is ch01-three.spec's case.
for (const { page: path, slug } of REGISTRY.filter((r) => r.animation)) {
  test(`${slug}: opens in 3D and plays its animation once`, async ({ page }) => {
    // Headless Chromium draws WebGL with SwiftShader, on the CPU, in its GPU
    // process. Opening a view compiles its shaders there, and the first-view
    // animation redraws for several seconds after. On a loaded machine one
    // frame of that can take 5 to 19 s (measured on probe, whose frames stay
    // under 0.2 s with its 3D part blocked), and settle() waits on frames, so
    // the case ran past the 30 s default though nothing in it was wrong.
    // Alone it takes about 2 s.
    test.slow();
    // One slot, and only this figure may take it: the page's other figures
    // keep their 3D parts unloaded (they stay in 2D), since one of them near
    // this one could hold the slot for as long as both stay in reach.
    await page.route((url) => /\/anim-[\w-]+-3d\.js$/.test(url.pathname) && !url.pathname.endsWith(`/anim-${slug}-3d.js`),
      (route) => route.abort());
    await page.goto(`${path}?three-cap=1`);
    const host = page.locator(hostOf(slug));
    await settle(page, host);
    // A figure whose first step is a flat graph opens 3D on its control.
    await to3D(page, slug, host);
    await host.locator("canvas.anim-figure__canvas--3d").waitFor();
    await expect.poll(async () => (await hook(page)).played[slug]).toBe(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page, host);
    expect((await hook(page)).played[slug]).toBe(1);
  });
}
