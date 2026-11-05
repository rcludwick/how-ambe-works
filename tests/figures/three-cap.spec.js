// The live-context cap in anim-three.js (design §3.2 R1, §3.3, §3.6).
//
// The spike (plan P0) asks the browser, without the runtime, whether a
// context lost on purpose through WEBGL_lose_context still counts against
// its cap on active contexts (16 in Chromium and in WebKit). It runs in
// Chromium and in WebKit. The webkit project in playwright.config.js runs
// the spike cases and the runtime cases tagged @webkit, since WebKit is the
// engine the pool exists for. The runtime cases check the live count two
// ways: TEST_HOOK's own, and countLive()'s, which counts every WebGL 2
// context the page makes that is not lost.
//
// Outcome, 2026-10-09: Chromium drops a lost context from its count at
// once. WebKit keeps counting it, and a torn-down context (lost, sized 0 by
// 0, removed, unreferenced) as well, until it is garbage collected; past
// 16 it evicts the oldest context, live or not. Restoring a context does
// not add to the count. So in both engines a page stays clear of the cap
// only by reusing context objects, which anim-three.js does: a parked or
// closed view loses its context and puts the canvas in a pool, and the
// next view to start restores a pooled context before it makes a new one.
import { test, expect } from "@playwright/test";
import { countAnimObservers, hook, useFixture } from "./helpers.js";

/** Both engines warn with this phrase when they evict the oldest context. */
const TOO_MANY = /too many active webgl contexts/i;

/**
 * @param {import("@playwright/test").Page} page
 * @returns {string[]} the eviction warnings, filled as they arrive
 */
function warnings(page) {
  /** @type {string[]} */
  const seen = [];
  page.on("console", (message) => {
    if (TOO_MANY.test(message.text())) seen.push(message.text());
  });
  return seen;
}

/**
 * Make `older` live contexts, then `lost` more that are lost at once (and,
 * with `teardown`, sized 0 by 0, removed and dropped), then `newer` live
 * ones, then restore and lose the second group `rounds` times. Returns how
 * many of the older live contexts the engine evicted.
 * @param {import("@playwright/test").Page} page
 * @param {{older: number, lost: number, newer: number, teardown?: boolean, rounds?: number}} plan
 */
function run(page, plan) {
  return page.evaluate(async ({ older, lost, newer, teardown = false, rounds = 0 }) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    /** @param {number} n */
    const make = (n) => Array.from({ length: n }, () => {
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      const gl = /** @type {WebGL2RenderingContext} */ (canvas.getContext("webgl2"));
      const ext = /** @type {WEBGL_lose_context} */ (gl.getExtension("WEBGL_lose_context"));
      canvas.addEventListener("webglcontextlost", (event) => event.preventDefault());
      return { canvas, gl, ext };
    });
    const first = make(older);
    let middle = make(lost);
    for (const { canvas, ext } of middle) {
      ext.loseContext();
      if (teardown) {
        canvas.width = 0;
        canvas.height = 0;
        canvas.remove();
      }
    }
    if (teardown) middle = [];
    await frame();
    make(newer);
    for (let i = 0; i < rounds; i += 1) {
      await frame();
      for (const { ext } of middle) ext.restoreContext();
      await frame();
      for (const { ext } of middle) ext.loseContext();
    }
    await frame();
    await frame();
    return first.filter(({ gl }) => gl.isContextLost()).length;
  }, plan);
}

test.describe("spike", () => {
  test("spike: control, 20 live contexts make the engine evict the oldest and warn", async ({ page }) => {
    const seen = warnings(page);
    await page.goto("14-how-to-measure/");
    expect(await run(page, { older: 4, lost: 0, newer: 16 })).toBeGreaterThan(0);
    await expect.poll(() => seen.length).toBeGreaterThan(0);
  });

  test("spike: 12 contexts lost on purpose, then 4 new ones; the 4 older live ones survive in Chromium only", async ({ page, browserName }) => {
    const seen = warnings(page);
    await page.goto("14-how-to-measure/");
    const evicted = await run(page, { older: 4, lost: 12, newer: 4 });
    await page.waitForTimeout(100);
    // The P0 result: WebKit counts a context lost on purpose.
    expect(evicted).toBe(browserName === "webkit" ? 4 : 0);
    expect(seen.length > 0).toBe(browserName === "webkit");
  });

  test("spike: a full teardown frees no slot in WebKit before garbage collection", async ({ page, browserName }) => {
    await page.goto("14-how-to-measure/");
    const evicted = await run(page, { older: 4, lost: 12, newer: 4, teardown: true });
    expect(evicted).toBe(browserName === "webkit" ? 4 : 0);
  });

  test("spike: restoring a lost context adds nothing to the count", async ({ page }) => {
    const seen = warnings(page);
    await page.goto("14-how-to-measure/");
    // 16 context objects, at most 16 live: restore and lose 12 of them
    // twice, as unparking and parking would.
    expect(await run(page, { older: 4, lost: 12, newer: 0, rounds: 2 })).toBe(0);
    await page.waitForTimeout(100);
    expect(seen).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * The cap in the runtime, on the fixture (design §3.6)
 * ------------------------------------------------------------------------ */

const PAGE = "14-how-to-measure/";
/** Empty space between hosts: more than KEEP_MARGIN, so one host is near at a time. */
const FAR = 2400;

/**
 * Open the fixture page with `count` hosts, each asking for 3D at once.
 * @param {import("@playwright/test").Page} page
 * @param {{count: number, gap?: number, cap?: number}} options
 */
async function openHosts(page, { count, gap = FAR, cap = 2 }) {
  await countLive(page);
  /** @type {string[]} */
  const vendor = [];
  page.on("request", (r) => { if (r.url().includes("/vendor/three/")) vendor.push(r.url()); });
  await useFixture(page, { chapters: [PAGE], view: "3d", count, gap });
  await page.goto(`${PAGE}?three-cap=${cap}`);
  await page.locator('[data-anim="fixture"].is-enhanced').first().waitFor();
  return vendor;
}

/**
 * Count live contexts without the runtime's help: wrap getContext, and on
 * every new context, every animation frame and just after every restore,
 * count the contexts not lost. After a restore it counts once the task that
 * dispatched the event has run, so the runtime has had its turn to answer
 * it. Reads window.__live {now, peak}. Call before goto().
 * @param {import("@playwright/test").Page} page
 */
async function countLive(page) {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    /** @type {WebGL2RenderingContext[]} */
    const made = [];
    const live = { now: 0, peak: 0 };
    // @ts-ignore test-only global
    window.__live = live;
    const sample = () => {
      live.now = made.filter((gl) => !gl.isContextLost()).length;
      live.peak = Math.max(live.peak, live.now);
    };
    // @ts-ignore stub for the test
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      // @ts-ignore forwarding the original arguments
      const gl = native.call(this, kind, ...rest);
      if (kind === "webgl2" && gl && !made.includes(gl)) {
        made.push(gl);
        this.addEventListener("webglcontextrestored", () => setTimeout(sample));
        sample();
      }
      return gl;
    };
    const each = () => {
      sample();
      requestAnimationFrame(each);
    };
    requestAnimationFrame(each);
  });
}

/** @param {import("@playwright/test").Page} page @returns {Promise<{now: number, peak: number}>} */
// @ts-ignore test-only global
const live = (page) => page.evaluate(() => ({ ...window.__live }));

/** @param {number} i */
const hostAt = (i) => `[data-anim="fixture"][data-fixture-index="${i}"]`;

/**
 * Host i's state: whether it holds a 3D canvas, whether it is parked, and
 * whether its 2D canvas shows.
 * @param {import("@playwright/test").Page} page
 * @param {number} i
 */
function hostState(page, i) {
  return page.locator(hostAt(i)).evaluate((host) => {
    const frame = /** @type {HTMLElement} */ (host.querySelector(".anim-figure__frame"));
    const flat = /** @type {HTMLCanvasElement} */ (frame.querySelector("canvas:not(.anim-figure__canvas--3d)"));
    return {
      live: Boolean(frame.querySelector("canvas.anim-figure__canvas--3d")),
      parked: frame.dataset.three === "parked",
      flat: !flat.hidden,
    };
  });
}

/**
 * Scroll host i to the middle of the viewport and wait until it is live.
 * @param {import("@playwright/test").Page} page
 * @param {number} i
 */
async function visit(page, i) {
  await page.locator(hostAt(i)).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect.poll(() => hostState(page, i)).toEqual({ live: true, parked: false, flat: false });
}

/** @param {import("@playwright/test").Page} page */
const probes = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  return /** @type {{builds: number, parks: number, unparks: number}[]} */ (window.__fixtures).map(
    (p) => ({ builds: p.builds, parks: p.parks, unparks: p.unparks }));
});

test("cap 2: live never above it while scrolling, the victim is the host out of reach longest, parked hosts show 2D @webkit", async ({ page }) => {
  await openHosts(page, { count: 5 });
  for (let i = 0; i < 5; i += 1) {
    await visit(page, i);
    expect((await hook(page)).liveContexts).toBeLessThanOrEqual(2);
    if (i >= 2) {
      // i - 2 left reach before i - 1 did, so it is the one parked.
      expect(await hostState(page, i - 2)).toEqual({ live: false, parked: true, flat: true });
      expect((await hostState(page, i - 1)).live).toBe(true);
    }
  }
  const h = await hook(page);
  expect(h.peakContexts).toBe(2);
  expect((await live(page)).peak).toBeLessThanOrEqual(2);
  expect(h.parks).toBe(3);
  expect(h.cap).toBe(2);
  expect((await probes(page)).map((p) => p.parks)).toEqual([1, 1, 1, 0, 0]);
});

test("scrolling back unparks at the same pose, builds once more, and hides 2D again @webkit", async ({ page }) => {
  await openHosts(page, { count: 3 });
  await visit(page, 0);
  // A pose of the reader's, away from the one build() sets.
  await page.evaluate(() => {
    // @ts-ignore test-only global
    const { camera } = window.__fixtures[0].three;
    camera.position.set(0.3, 3.1, 0.4);
    camera.lookAt(0, 0, 0);
  });
  const pose = () => page.evaluate(() => {
    // @ts-ignore test-only global
    const { camera } = window.__fixtures[0].three;
    return [...camera.position.toArray(), ...camera.quaternion.toArray()].map((v) => Number(v.toFixed(6)));
  });
  const before = await pose();
  await visit(page, 1);
  await visit(page, 2);
  expect(await hostState(page, 0)).toEqual({ live: false, parked: true, flat: true });
  const builds = (await probes(page))[0].builds;
  // While parked, animate() lands on its end at once.
  const parkedTween = await page.evaluate(async () => {
    /** @type {number[]} */
    const seen = [];
    // @ts-ignore test-only global
    const three = window.__fixtures[0].three;
    await three.animate(250, (/** @type {number} */ t) => seen.push(t));
    return { seen, parked: three.parked };
  });
  expect(parkedTween).toEqual({ seen: [1], parked: true });
  await visit(page, 0);
  expect(await pose()).toEqual(before);
  const after = (await probes(page))[0];
  expect(after.builds).toBe(builds + 1);
  expect(after.unparks).toBe(1);
  expect((await hook(page)).unparks).toBe(1);
});

test("a host that finds nothing to park waits with its 2D view up, and opens when a slot frees @webkit", async ({ page }) => {
  // All three hosts near (a screen above and below): the figures span the
  // content column now, so three of them need a taller window.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await openHosts(page, { count: 3, gap: 0 });
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(2);
  await page.waitForTimeout(300);
  const states = await Promise.all([0, 1, 2].map((i) => hostState(page, i)));
  expect(states.filter((s) => s.live)).toHaveLength(2);
  const waiting = states.findIndex((s) => !s.live);
  expect(states[waiting]).toEqual({ live: false, parked: false, flat: true });
  expect((await hook(page)).waits).toBe(1);
  // Leaving 3D on a live host releases its slot to the one waiting.
  const other = waiting === 0 ? 1 : 0;
  await page.locator(`${hostAt(other)} [data-ref="view3d"]`).click();
  await expect.poll(() => hostState(page, waiting)).toEqual({ live: true, parked: false, flat: false });
  expect((await hook(page)).liveContexts).toBe(2);
  expect((await live(page)).peak).toBeLessThanOrEqual(2);
});

test("a real loss releases the slot; resume takes one again @webkit", async ({ page }) => {
  // All three hosts near (a screen above and below): the figures span the
  // content column now, so three of them need a taller window.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await openHosts(page, { count: 3, gap: 0 });
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(2);
  const states = await Promise.all([0, 1, 2].map((i) => hostState(page, i)));
  const [a, b] = [0, 1, 2].filter((i) => states[i].live);
  const waiting = [0, 1, 2].find((i) => !states[i].live);
  await page.evaluate((i) => {
    // @ts-ignore test-only global
    window.__fixtures[i].three.renderer.getContext().getExtension("WEBGL_lose_context").loseContext();
  }, a);
  await expect(page.locator(`${hostAt(a)} .anim-figure__frame`)).toHaveAttribute("data-state", "paused");
  await expect.poll(async () => (await hostState(page, /** @type {number} */ (waiting))).live).toBe(true);
  // Resume asks for a slot; both are held, and every host is near, so it waits.
  await page.locator(`${hostAt(a)} .anim-figure__resume`).click();
  await page.waitForTimeout(300);
  await expect(page.locator(`${hostAt(a)} .anim-figure__frame`)).toHaveAttribute("data-state", "paused");
  await page.locator(`${hostAt(b)} [data-ref="view3d"]`).click();
  await expect(page.locator(`${hostAt(a)} .anim-figure__frame`)).not.toHaveAttribute("data-state", "paused");
  // The resumed view takes its slot as its restored context comes back,
  // which can be a frame after the pause clears.
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(2);
  expect((await live(page)).peak).toBeLessThanOrEqual(2);
});

test("a GPU crash: the contexts the browser restores by itself take a slot first, so live stays within the cap", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Browser.crashGpuProcess is Chromium's");
  await openHosts(page, { count: 3, gap: 0 });
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(2);
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__events = [];
    for (const canvas of document.querySelectorAll("canvas")) {
      for (const type of ["webglcontextlost", "webglcontextrestored"]) {
        // @ts-ignore test-only global
        canvas.addEventListener(type, () => window.__events.push(type));
      }
    }
  });
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser");
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send("Browser.crashGpuProcess").catch(() => {});
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__events.filter((e) => e === "webglcontextrestored").length),
    { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect((await live(page)).now).toBeLessThanOrEqual(2);
  expect((await live(page)).peak).toBeLessThanOrEqual(2);
  expect((await hook(page)).liveContexts).toBeLessThanOrEqual(2);
  await cdp.detach();
});

test("ten round trips: observers back to baseline, no more context objects than the cap @webkit", async ({ page }) => {
  await countAnimObservers(page);
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    // @ts-ignore test-only global
    window.__made = 0;
    // @ts-ignore stub for the test
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      const existing = this.__gl;
      if (kind === "webgl2" && !existing) {
        // @ts-ignore test-only global
        window.__made += 1;
      }
      // @ts-ignore forwarding the original arguments
      const gl = native.call(this, kind, ...rest);
      if (kind === "webgl2") this.__gl = gl;
      return gl;
    };
  });
  const seen = warnings(page);
  await openHosts(page, { count: 4 });
  const trip = async () => {
    for (const i of [1, 2, 3, 2, 1, 0]) await visit(page, i);
  };
  // The baseline is taken once every host has opened, so each holds its
  // own observers.
  await visit(page, 0);
  await trip();
  await page.waitForTimeout(300);
  // @ts-ignore test-only global
  const baseline = await page.evaluate(() => ({ ...window.__obs }));
  for (let round = 0; round < 10; round += 1) await trip();
  await page.waitForTimeout(300);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => ({ ...window.__obs }))).toEqual(baseline);
  const h = await hook(page);
  expect(h.peakContexts).toBe(2);
  expect((await live(page)).peak).toBeLessThanOrEqual(2);
  // The probe's context, then one per slot: every park and unpark reuses them.
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__made)).toBe(3);
  expect(seen).toEqual([]);
});

test("spike: the runtime parks and unparks 20 hosts twice with no eviction warning", async ({ page }) => {
  const seen = warnings(page);
  await openHosts(page, { count: 20, gap: FAR, cap: 3 });
  for (let round = 0; round < 2; round += 1) {
    for (let i = 0; i < 20; i += 1) await visit(page, i);
    for (let i = 19; i >= 0; i -= 1) await visit(page, i);
  }
  const h = await hook(page);
  expect(h.peakContexts).toBeLessThanOrEqual(3);
  expect((await live(page)).peak).toBeLessThanOrEqual(3);
  expect(h.parks).toBeGreaterThanOrEqual(2 * 2 * 17);
  expect(seen).toEqual([]);
});

test("opening rule, five hosts at the default cap: nothing 3D before the first is near, live at most 3, parked hosts in 2D, each intro played once @webkit", async ({ page }) => {
  await countLive(page);
  /** @type {string[]} */
  const requested = [];
  page.on("request", (r) => {
    if (/\/vendor\/three\/|anim-fixture-3d\.js/.test(r.url())) requested.push(r.url());
  });
  await useFixture(page, { chapters: [PAGE], view: "auto", count: 5, gap: FAR, lead: FAR });
  await page.goto(PAGE);
  await page.locator('[data-anim="fixture"].is-enhanced').first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  expect(requested).toEqual([]);
  expect((await hook(page)).cap).toBe(3);
  const order = [0, 1, 2, 3, 4, 3, 2, 1, 0];
  for (const i of order) {
    await visit(page, i);
    expect((await hook(page)).liveContexts).toBeLessThanOrEqual(3);
    for (let j = 0; j < 5; j += 1) {
      const state = await hostState(page, j);
      if (state.parked) expect(state.flat).toBe(true);
    }
  }
  const h = await hook(page);
  expect(h.peakContexts).toBe(3);
  expect((await live(page)).peak).toBeLessThanOrEqual(3);
  expect(h.parks).toBeGreaterThan(0);
  expect(h.played).toEqual({ "fixture-0": 1, "fixture-1": 1, "fixture-2": 1, "fixture-3": 1, "fixture-4": 1 });
});
