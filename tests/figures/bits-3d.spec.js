// The bits figure's head-on 3D view (anim-bits-3d.js, plan F10, owner
// decision O2): Front at 1x puts every tile, as drawn, on its 2D cell, the
// flip lands on the frame's bits and turns exactly the bits that changed
// into the frame shown (forward or back), the highlight marks them, change
// rate recolours every tile, the first-view flip shows frame 97 with no
// outlines until it runs, plays once and always lets the clip play, and
// the figure stays usable with reduced motion, on a phone and when the 3D
// control is pressed in a hurry.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const PAGE = "10-the-dstar-frame/";
const HOST = '[data-anim="bits"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/**
 * @typedef {Object} BitsProbe
 * @property {number} builds
 * @property {number} played
 * @property {number} flips
 * @property {number} zoom
 * @property {{yaw: number, pitch: number}} pose
 * @property {number} ringed
 * @property {string} chip
 * @property {() => {drawn: number, wanted: number}[]} faces
 */

/**
 * The 3D view's probe, with its front points and per-tile state read out.
 * @param {import("@playwright/test").Page} page
 */
async function probe(page) {
  return page.evaluate(() => {
    const p = /** @type {any} */ (window.__ambeAnim?.figures["bits-3d"]);
    return {
      builds: p.builds, played: p.played, flips: p.flips, zoom: p.zoom, ringed: p.ringed, chip: p.chip,
      shown: Array.from(/** @type {Uint8Array} */ (p.shown)), angle: Array.from(/** @type {Float32Array} */ (p.angle)),
      frontPoints: /** @type {number[][]} */ (p.frontPoints()),
      faces: /** @type {{drawn: number, wanted: number}[]} */ (p.faces()),
    };
  });
}

/**
 * The 2D view's own mapping: the cell centres anim-bits.js draws, for the
 * frame's size, and the frame's bits and changes, from the module the page
 * runs.
 * @param {import("@playwright/test").Page} page
 * @param {number} frame
 */
async function twoD(page, frame) {
  return page.evaluate(async (i) => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-bits.js", script.src).href);
    const core = await import(new URL("anim-core.js", script.src).href);
    const box = /** @type {HTMLElement} */ (document.querySelector('[data-anim="bits"] .anim-figure__frame'));
    const r = box.getBoundingClientRect();
    const size = { width: Math.round(r.width - box.clientLeft * 2), height: Math.round(r.height - box.clientTop * 2) };
    const L = m.computeLayout(size);
    const centres = Array.from({ length: 72 }, (_, n) => {
      const c = m.cellRect(L.grid, n);
      return [c.x + c.w / 2, c.y + c.h / 2];
    });
    const data = await core.loadJSON("assets/data/frames.json");
    const model = m.unpack(data.frames);
    return {
      size,
      centres,
      bits: Array.from(/** @type {Uint8Array} */ (model.rows[i].bits)),
      changed: Array.from(/** @type {Uint8Array} */ (model.changed[i])),
      count: model.changedCount[i],
    };
  }, frame);
}

/**
 * Hold the clip on a frame (the slider, as a reader would).
 * @param {import("@playwright/test").Page} page
 * @param {number} i
 */
async function scrubTo(page, i) {
  await page.locator(`${HOST} .anim-range`).evaluate((el, index) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = String(index);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, i);
}

/** @param {import("@playwright/test").Page} page */
async function open3D(page) {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  return host;
}

for (const width of [1280, 375]) {
  test(`Front at 1x puts every tile centre on its 2D cell centre within 0.5 px (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open3D(page);
    await scrubTo(page, 98);
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    const p = await probe(page);
    expect(p.zoom).toBe(1);
    const flat = await twoD(page, 98);
    // The 2D canvas laid its cells out for the same size.
    expect(await page.evaluate(() => /** @type {any} */ (window.__ambeAnim?.figures.bits).size())).toEqual(flat.size);
    expect(p.frontPoints).toHaveLength(72);
    p.frontPoints.forEach(([x, y], n) => {
      expect(Math.abs(x - flat.centres[n][0]), `bit ${n} x`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y - flat.centres[n][1]), `bit ${n} y`).toBeLessThanOrEqual(0.5);
    });
  });
}

test("a zoom round trip leaves the front points where they were", async ({ page }) => {
  const host = await open3D(page);
  const before = (await probe(page)).frontPoints;
  const group = host.getByRole("group", { name: "Zoom" });
  await group.getByRole("button", { name: "Zoom in" }).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page)).zoom).toBeGreaterThan(1);
  await group.getByRole("button", { name: "Reset view" }).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const after = await probe(page);
  expect(after.zoom).toBe(1);
  after.frontPoints.forEach(([x, y], n) => {
    expect(Math.abs(x - before[n][0])).toBeLessThanOrEqual(0.01);
    expect(Math.abs(y - before[n][1])).toBeLessThanOrEqual(0.01);
  });
});

test("the flip lands on the frame's bits, flat, with the changed bits outlined and counted", async ({ page }) => {
  const host = await open3D(page);
  await scrubTo(page, 97);
  const flips = (await probe(page)).flips;
  await host.locator('[data-ref="next"]').click();
  await expect(host.locator(".anim-controls .anim-readout")).toContainText("frame 98 ");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const p = await probe(page);
  const flat = await twoD(page, 98);
  expect(p.flips).toBe(flips + 1);
  expect(p.shown).toEqual(flat.bits);
  expect(p.angle.every((a) => a === 0)).toBe(true);
  expect(flat.count).toBe(35);
  expect(p.ringed).toBe(35);
  expect(p.chip).toBe("35 of 72 bits changed since the last frame");
  await expect(host.locator(".anim-chip")).toHaveText("35 of 72 bits changed since the last frame");
  // The chip sits inside the frame.
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  const chip = await host.locator(".anim-chip").boundingBox();
  expect(frame && chip).toBeTruthy();
  if (frame && chip) {
    expect(chip.x).toBeGreaterThanOrEqual(frame.x);
    expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(chip.y).toBeGreaterThanOrEqual(frame.y);
  }
});

test("a step's flip is under way between frames and done within 1.2 s", async ({ page }) => {
  const host = await open3D(page);
  await scrubTo(page, 97);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "start" }));
  // Press Next and read the tiles three animation frames later, in one go.
  const mid = await page.evaluate(async () => {
    /** @type {HTMLButtonElement} */ (document.querySelector('[data-anim="bits"] [data-ref="next"]')).click();
    for (let i = 0; i < 3; i += 1) await new Promise((r) => requestAnimationFrame(r));
    const p = /** @type {any} */ (window.__ambeAnim?.figures["bits-3d"]);
    return Array.from(/** @type {Float32Array} */ (p.angle));
  });
  expect(mid.some((a) => a > 0 && a < Math.PI)).toBe(true);
  const flat = await twoD(page, 98);
  // Unchanged tiles never move.
  mid.forEach((a, n) => {
    if (!flat.changed[n]) expect(a, `bit ${n}`).toBe(0);
  });
  await page.waitForTimeout(1250);
  const end = await probe(page);
  expect(end.angle.every((a) => a === 0)).toBe(true);
  expect(end.shown).toEqual(flat.bits);
});

test("Flash changes off hides the outlines and the chip", async ({ page }) => {
  const host = await open3D(page);
  await scrubTo(page, 98);
  await host.locator('[data-ref="flash"]').uncheck();
  expect((await probe(page)).chip).toBe("");
  await expect(host.locator(".anim-chip")).toBeHidden();
  await host.locator('[data-ref="flash"]').check();
  await expect(host.locator(".anim-chip")).toBeVisible();
});

test("the first view shows frame 97 unmarked until it runs, flips into 98 once, then plays", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  // Near (the 3D view loads) but not yet on screen: held.
  await host.locator(".anim-figure__frame").evaluate((el) =>
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - innerHeight - 40));
  // The 3D view draws its first frame only once it is on screen.
  await page.locator(CANVAS_3D).waitFor({ state: "attached" });
  await page.waitForTimeout(300);
  const held = await probe(page);
  const before = await twoD(page, 97);
  expect(held.played).toBe(0);
  expect(held.shown).toEqual(before.bits);
  expect(held.ringed).toBe(0);
  expect(held.chip).toBe("");
  await expect(host.locator(".anim-chip-layer")).toBeHidden();
  await expect(host.locator(".anim-controls .anim-btn--play")).toHaveText("Play");
  // Seen: the flip runs, then the clip plays on its own.
  await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect.poll(async () => (await probe(page)).played).toBe(1);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await hook(page)).played.bits).toBe(1);
  await expect(host.locator(".anim-btn--play")).toHaveText("Pause");
  await expect.poll(async () => Number(/frame (\d+)/.exec(await host.locator(".anim-controls .anim-readout").textContent() ?? "")?.[1])).toBeGreaterThan(98);
  // Leaving 3D and coming back does not play it again.
  const toggle = host.locator('.anim-controls [data-view="3d"]');
  await toggle.click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect((await probe(page)).played).toBe(0);
  expect((await hook(page)).played.bits).toBe(1);
});

for (const [width, block] of /** @type {const} */ ([[1280, "start"], [390, "center"]])) {
  test(`scrolled in at ${width} px (${block}), the clip is never left held: it plays past 98 after the first view`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
    await page.goto(PAGE);
    const host = page.locator(HOST);
    await host.locator(".anim-figure").waitFor();
    // At 390 px, centring the host leaves the frame on screen but less
    // than half seen, so the first view waits, then gives up and plays.
    await host.evaluate((el, b) => el.scrollIntoView({ block: b }), block);
    await expect.poll(async () => page.evaluate(() => /** @type {any} */ (window.__ambeAnim?.figures["bits-3d"])?.played ?? 0), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(2000);
    await expect(host.locator(".anim-btn--play")).toHaveAttribute("aria-pressed", "true");
    expect(Number(/frame (\d+)/.exec(await host.locator(".anim-controls .anim-readout").textContent() ?? "")?.[1])).not.toBe(98);
  });
}

test("if the 3D part fails to load, the figure stays in 2D and the clip plays from 98", async ({ page }) => {
  await page.route(/anim-bits-3d\.js/, (route) => route.abort());
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(host.locator('.anim-controls [data-view="3d"]')).toHaveAttribute("aria-pressed", "false");
  await expect(host.locator(".anim-btn--play")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => Number(/frame (\d+)/.exec(await host.locator(".anim-controls .anim-readout").textContent() ?? "")?.[1])).toBeGreaterThan(98);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator("canvas.anim-figure__canvas")).toBeVisible();
});

test("Change rate recolours every tile on the ramp, held or stepped, and Bit value brings the values back", async ({ page }) => {
  const host = await open3D(page);
  await scrubTo(page, 98);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const same = async () => (await probe(page)).faces.every((f) => f.drawn === f.wanted);
  await host.locator('button[data-mode="rate"]').click();
  const rate = await page.evaluate(async () => {
    const style = await import(new URL("lib/style.js", /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]')).src).href);
    const p = /** @type {any} */ (window.__ambeAnim?.figures["bits-3d"]);
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-bits.js", script.src).href);
    const core = await import(new URL("anim-core.js", script.src).href);
    const model = m.unpack((await core.loadJSON("assets/data/frames.json")).frames);
    return p.faces().map((/** @type {{drawn: number}} */ f, /** @type {number} */ n) => f.drawn === style.rampColor(model.rateNorm[n]));
  });
  expect(rate.every(Boolean)).toBe(true);
  expect(await same()).toBe(true);
  // A step: the unchanged tiles stay on the ramp too.
  await host.locator('[data-ref="next"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect(await same()).toBe(true);
  const ramp = (await probe(page)).faces;
  await host.locator('button[data-mode="value"]').click();
  const values = (await probe(page)).faces;
  expect(await same()).toBe(true);
  expect(values.some((f, n) => f.drawn !== ramp[n].drawn)).toBe(true);
});

test("a step back or a scrub turns exactly the bits that changed into the frame shown", async ({ page }) => {
  const host = await open3D(page);
  await scrubTo(page, 98);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "start" }));
  for (const [act, to] of /** @type {const} */ ([["prev", 97], ["scrub", 50]])) {
    const turned = await page.evaluate(async ([a, i]) => {
      const host = /** @type {HTMLElement} */ (document.querySelector('[data-anim="bits"]'));
      if (a === "prev") /** @type {HTMLButtonElement} */ (host.querySelector('[data-ref="prev"]')).click();
      else {
        const input = /** @type {HTMLInputElement} */ (host.querySelector(".anim-range"));
        input.value = String(i);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const p = /** @type {any} */ (window.__ambeAnim?.figures["bits-3d"]);
      /** @type {Set<number>} */
      const moved = new Set();
      const end = performance.now() + 1500;
      while (performance.now() < end) {
        await new Promise((r) => requestAnimationFrame(r));
        Array.from(/** @type {Float32Array} */ (p.angle)).forEach((x, n) => { if (x > 0) moved.add(n); });
      }
      return [...moved].sort((x, y) => x - y);
    }, /** @type {const} */ ([act, to]));
    const flat = await twoD(page, to);
    const want = flat.changed.flatMap((c, n) => (c ? [n] : []));
    expect(turned, `${act} to ${to}`).toEqual(want);
    const p = await probe(page);
    expect(p.shown).toEqual(flat.bits);
    expect(p.ringed).toBe(flat.count);
  }
});

test("reduced motion: opens in 2D, asks for nothing 3D until the control, then lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requested = [];
  page.on("request", (r) => {
    if (/\/vendor\/three\/|anim-bits-3d\.js/.test(r.url())) requested.push(r.url().split("/").pop() || "");
  });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator("canvas.anim-figure__canvas")).toBeVisible();
  expect(requested).toEqual([]);
  await host.locator('.anim-controls [data-view="3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect(requested).toContain("anim-bits-3d.js");
  const p = await probe(page);
  const flat = await twoD(page, 98);
  expect(p.played).toBe(0);
  expect(p.flips).toBe(0);
  expect(p.shown).toEqual(flat.bits);
  expect(p.angle.every((a) => a === 0)).toBe(true);
  expect(p.ringed).toBe(35);
  expect((await hook(page)).played.bits ?? 0).toBe(0);
  // .is-static shows the motion hint; the WebGL hint stays hidden while
  // WebGL 2 works.
  await expect(host.locator(".anim-figure__hint--webgl")).toBeHidden();
  await expect(host.locator('.anim-controls [data-view="3d"]')).toBeEnabled();
});

test("pressing 3D five times quickly leaves no stray context, canvas or chip", async ({ page }) => {
  const host = await open3D(page);
  // Other figures on the page hold contexts of their own.
  const live = (await hook(page)).liveContexts;
  const toggle = host.locator('.anim-controls [data-view="3d"]');
  for (let i = 0; i < 5; i += 1) await toggle.click();
  await settle(page, host);
  const on = (await toggle.getAttribute("aria-pressed")) === "true";
  await expect(page.locator(CANVAS_3D)).toHaveCount(on ? 1 : 0);
  await expect(host.locator(".anim-chip-layer")).toHaveCount(on ? 1 : 0);
  await expect(host.locator(".anim-zoom")).toHaveCount(on ? 1 : 0);
  expect((await hook(page)).liveContexts).toBe(on ? live : live - 1);
  await expect(host.locator("canvas.anim-figure__canvas").first()).toBeVisible({ visible: !on });
});

test("in 3D, hover and the arrow keys inspect a bit, as on the 2D canvas", async ({ page }) => {
  const host = await open3D(page);
  await scrubTo(page, 98);
  const flat = await twoD(page, 98);
  const [x, y] = flat.centres[10];
  await page.locator(CANVAS_3D).hover({ position: { x, y } });
  await expect(host.locator('[data-ref="head"]')).toContainText(`Bit 10 of 72 = ${flat.bits[10]}`);
  await page.locator(CANVAS_3D).focus();
  await page.keyboard.press("ArrowDown");
  await expect(host.locator('[data-ref="head"]')).toContainText(`Bit 18 of 72 = ${flat.bits[18]}`);
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /voice frame 98, at 1\.96 s.*35 of 72 bits changed since the previous frame/);
});

test("the highlight keeps 3:1 against the plot and the stage, in both themes", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  for (const scheme of ["slate", "default"]) {
    const [hl, ...grounds] = await page.evaluate((s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(document.body);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom", "--ambe-3d-floor"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    for (const ground of grounds) expect(contrast(hl, ground), `${hl} on ${ground}, ${scheme}`).toBeGreaterThanOrEqual(3);
  }
});

test("phone, 375 px: no horizontal scroll, and the chip and the tiles inside the frame", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open3D(page);
  await scrubTo(page, 98);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  const chip = await host.locator(".anim-chip").boundingBox();
  if (!frame || !chip) throw new Error("no frame or chip");
  expect(chip.x).toBeGreaterThanOrEqual(frame.x);
  expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width);
  for (const [x, y] of (await probe(page)).frontPoints) {
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(frame.width);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(frame.height);
  }
});

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
