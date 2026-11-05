// listen-terrain's 3D view (three-everywhere plan N8): Top equals the 2D
// layout, the first-view animation's end state and its play-once rule, the
// highlight following the steps, the cutaway, the caps, and the opening rule.
import { test, expect } from "@playwright/test";
import { hook, settle, useFixture } from "./helpers.js";

const PAGE = "12-listen/";

// The suite renders WebGL in software: three sheets of a whole clip take a
// while to draw, the more so on a busy machine.
test.describe.configure({ timeout: 90_000 });
const HOST = '[data-anim="listen-terrain"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {import("@playwright/test").Page} page @param {string} expr */
const probe3d = (page, expr) =>
  page.evaluate((e) => {
    const f = /** @type {any} */ (window.__ambeAnim?.figures["listen-terrain-3d"]);
    return f ? new Function("f", `return (${e})`)(f) : null;
  }, expr);

/** @param {import("@playwright/test").Page} page */
async function open3D(page, query = "") {
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await host.scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  return host;
}

/** @param {import("@playwright/test").Page} page @param {import("@playwright/test").Locator} host @param {string} name */
async function preset(page, host, name) {
  await host.locator(`button[data-preset="${name}"]`).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(100);
}

for (const width of [1280, 375]) {
  test(`Top at ${width} px: the selected frame's bins in the original and decoded sheets land on the 2D strips within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open3D(page);
    await preset(page, host, "top");
    const result = await page.evaluate(() => {
      const two = /** @type {any} */ (window.__ambeAnim?.figures["listen-terrain"]);
      const three = /** @type {any} */ (window.__ambeAnim?.figures["listen-terrain-3d"]);
      const strips = two.strips();
      const { n, bins, duration } = two.data();
      const i = two.state().frame;
      /** @type {number[][]} */
      const expected = [];
      for (const s of [strips[0], strips[2]]) {
        for (let k = 0; k < bins; k += 1) {
          expected.push([s.x + (((i + 0.5) * 0.02) / duration) * s.width, s.y + s.height * (1 - k / (bins - 1))]);
        }
      }
      return { expected, got: three.frontPoints(), zoom: three.zoom, n };
    });
    expect(result.zoom).toBe(1);
    expect(result.got).toHaveLength(result.expected.length);
    let worst = 0;
    result.got.forEach((/** @type {number[]} */ [x, y], /** @type {number} */ j) => {
      worst = Math.max(worst, Math.abs(x - result.expected[j][0]), Math.abs(y - result.expected[j][1]));
    });
    expect(worst).toBeLessThanOrEqual(0.5);
  });
}

test("the first view ends at Corner with the sheets apart, the difference grown and the valleys deepened, played once, chip on the first step's frame", async ({ page }) => {
  await open3D(page);
  expect((await hook(page)).played["listen-terrain"]).toBe(1);
  expect(await probe3d(page, "f.played")).toBe(1);
  const pose = await probe3d(page, "f.pose");
  expect(pose.yaw).toBeCloseTo(-34, 5);
  expect(pose.pitch).toBeCloseTo(30, 5);
  expect(await probe3d(page, "f.grown()")).toEqual([1, 1, 1, 1]);
  expect(await probe3d(page, "f.beat()")).toBe("");
  expect(await probe3d(page, "f.diffShown()")).toBe(true);
  expect(await probe3d(page, "f.chip()")).toBe("this frame: 0.17 s");
  // The scene's result panel has folded away after its beat: the 2D panel
  // under the frame carries lr-b's valleys, and the sheets have the frame.
  await expect.poll(() => probe3d(page, "f.panel()")).toBe(0);
  expect(await probe3d(page, "f.labels()")).not.toContain("decoded valleys\n1.7 to 5.2 dB deeper");
  await expect(page.locator(`${HOST} [data-role="r-valleys"]`)).toContainText("1.7 to 5.2 dB");
  // lr-b has 159 frames: every third one and the last, 54 surface columns.
  expect(await probe3d(page, "f.columns()")).toBe(54);
});

test("a park and unpark does not replay the animation", async ({ page }) => {
  // One context for the page, and a fixture figure at the top that opens
  // in 3D: scrolling back to it takes the slot, which parks this view.
  await useFixture(page, { chapters: ["12-listen/"], view: "auto", at: "top" });
  await page.goto(`${PAGE}?three-cap=1`);
  const host = page.locator(HOST);
  const frame = host.locator(".anim-figure__frame");
  await host.scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect((await hook(page)).played["listen-terrain"]).toBe(1);
  expect(await probe3d(page, "f.played")).toBe(1);
  const builds = await probe3d(page, "f.builds");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(frame).toHaveAttribute("data-three", "parked", { timeout: 20_000 });
  expect((await hook(page)).parks).toBeGreaterThan(0);
  await host.scrollIntoViewIfNeeded();
  await expect(frame).not.toHaveAttribute("data-three", "parked", { timeout: 20_000 });
  await expect(page.locator(CANVAS_3D)).toHaveCount(1);
  await expect.poll(() => probe3d(page, "f.builds")).toBeGreaterThan(builds);
  await settle(page, host);
  expect((await hook(page)).unparks).toBeGreaterThan(0);
  expect((await hook(page)).played["listen-terrain"]).toBe(1);
  expect(await probe3d(page, "f.played")).toBe(1);
  expect(await probe3d(page, "f.grown()")).toEqual([1, 1, 1, 1]);
});

test("a Clip button lands on the new clip's end state; the flat steps after it leave 3D", async ({ page }) => {
  const host = await open3D(page);
  expect(await probe3d(page, "f.played")).toBe(1);
  await host.locator('button[data-clip="lj-c"]').click();
  await expect(host.locator('[data-role="r-valleys"]')).toContainText("3.2 to 10.4 dB");
  // No finishAll here: nothing was started.
  expect(await probe3d(page, "f.grown()")).toEqual([1, 1, 1, 1]);
  expect(await probe3d(page, "f.beat()")).toBe("");
  expect(await probe3d(page, "f.played")).toBe(1);
  for (let i = 0; i < 3; i += 1) {
    await host.locator('[data-step="next"]').click();
    await settle(page, host);
  }
  // Step 4, lj-b's valleys on the panel, is a flat plot: no 3D view.
  await expect(host.locator('[data-role="r-valleys"]')).toContainText("6.3 to 10.1 dB");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
});

test("a step change moves the highlight to the new pick, pulses it, and the 3D label follows", async ({ page }) => {
  const host = await open3D(page);
  expect(await probe3d(page, "f.chip()")).toBe("this frame: 0.17 s");
  for (let i = 0; i < 5; i += 1) {
    await host.locator('[data-step="next"]').click();
    await settle(page, host);
  }
  // Step 6 asks for 3D again: lr-c, the loudest frame with a pitch in both files (16).
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await expect.poll(() => probe3d(page, "f.chip()")).toBe("this frame: 0.33 s");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /frame at 0\.33 s/);
});

test("Both sheets hides the difference sheet and its label; With difference brings them back", async ({ page }) => {
  const host = await open3D(page);
  await host.locator('button[data-show="both"]').click();
  await settle(page, host);
  expect(await probe3d(page, "f.diffShown()")).toBe(false);
  expect(await probe3d(page, "f.labels()")).not.toContain("difference");
  await host.locator('button[data-show="difference"]').click();
  await settle(page, host);
  expect(await probe3d(page, "f.diffShown()")).toBe(true);
  expect(await probe3d(page, "f.labels()")).toContain("difference");
});

test("Top shows the 2D strips' own pictures; the panel stays folded at Top, Side and Corner; Side names 0 dB of the difference", async ({ page }) => {
  const host = await open3D(page);
  expect(await probe3d(page, "f.flat()")).toBe(false);
  await preset(page, host, "top");
  expect(await probe3d(page, "f.flat()")).toBe(true);
  expect(await probe3d(page, "f.panel()")).toBe(0);
  await preset(page, host, "side");
  expect(await probe3d(page, "f.flat()")).toBe(false);
  expect(await probe3d(page, "f.panel()")).toBe(0);
  expect(await probe3d(page, "f.labels()")).toContain("0 dB (difference)");
  await preset(page, host, "corner");
  // Folded away for good once the opening's beat has played.
  expect(await probe3d(page, "f.panel()")).toBe(0);
  expect(await probe3d(page, "f.labels()")).not.toContain("0 dB (difference)");
});

test("the labels and chips wait, hidden, until the 3D view's first frame", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  const frame = host.locator(".anim-figure__frame");
  // Record the frame's label state each time a label layer is added.
  await frame.evaluate((el) => {
    const seen = /** @type {string[]} */ ([]);
    /** @type {any} */ (window).__ltSeen = seen;
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("anim-figure__overlay")) {
            seen.push(`${/** @type {HTMLElement} */ (el).dataset.ltLabels ?? "shown"}:${el.querySelector("canvas.anim-figure__canvas--3d") ? "3d" : "none"}`);
          }
        }
      }
    }).observe(el, { childList: true });
  });
  await host.scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const seen = await page.evaluate(() => /** @type {any} */ (window).__ltSeen);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((/** @type {string} */ s) => s.startsWith("wait:"))).toBe(true);
  await expect(frame).not.toHaveAttribute("data-lt-labels", /./);
});

test("cutaway: at Corner the surfaces on the camera's side of the frame are not drawn; at Top all are", async ({ page }) => {
  const host = await open3D(page);
  // Corner looks from the early side: frame 8 of lr-b, columns 0 to 4 are cut.
  const [start] = await probe3d(page, "f.drawnFrom()");
  expect(start).toBeGreaterThan(0);
  await preset(page, host, "top");
  expect((await probe3d(page, "f.drawnFrom()"))[0]).toBe(0);
});

test("a reader who left 3D stays in 2D through the flat steps that follow", async ({ page }) => {
  const host = await open3D(page);
  const toggle = host.locator('button[data-view="3d"]');
  await toggle.click();
  await settle(page, host);
  await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  for (let i = 0; i < 2; i += 1) {
    await host.locator('[data-step="next"]').click();
    await settle(page, host);
    await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  }
});

test("nothing 3D is requested before the figure comes near", async ({ page }) => {
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  // The figure sits about 1,560 px down the page: a short window keeps it
  // outside the one-screen margin that counts as near (KEEP_MARGIN).
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(PAGE);
  await expect(page.locator(HOST)).toHaveClass(/is-enhanced/);
  await page.waitForLoadState("networkidle");
  expect(asked.filter((u) => /anim-listen-terrain-3d\.js|three\.module/.test(u))).toEqual([]);
  await page.locator(HOST).scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  expect(asked.some((u) => u.includes("anim-listen-terrain-3d.js"))).toBe(true);
});

test("reduced motion: opens in 2D, loads no 3D until asked, then lands at Corner with nothing played", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator(".anim-figure")).toHaveAttribute("data-view", "2d");
  expect(asked.filter((u) => u.includes("anim-listen-terrain-3d.js"))).toEqual([]);
  await host.locator('button[data-view="3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const pose = await probe3d(page, "f.pose");
  expect(pose.yaw).toBeCloseTo(-34, 5);
  expect(await probe3d(page, "f.played")).toBe(0);
  expect(await probe3d(page, "f.grown()")).toEqual([1, 1, 1, 1]);
  expect((await hook(page)).played["listen-terrain"] ?? 0).toBe(0);
});

test("toggling 3D five times quickly leaves at most one view and no stray canvas", async ({ page }) => {
  const host = await open3D(page);
  const toggle = host.locator('button[data-view="3d"]');
  for (let i = 0; i < 5; i += 1) await toggle.click();
  await settle(page, host);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect((await hook(page)).liveContexts).toBe(0);
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(1);
  expect((await hook(page)).liveContexts).toBe(1);
});

test("context loss pauses the view and resume rebuilds it", async ({ page }) => {
  await open3D(page);
  const before = await probe3d(page, "f.builds");
  await page.locator(CANVAS_3D).evaluate((c) => {
    const gl = /** @type {HTMLCanvasElement} */ (c).getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_lose_context");
    ext?.loseContext();
    setTimeout(() => ext?.restoreContext(), 200);
  });
  await expect.poll(() => probe3d(page, "f.builds"), { timeout: 5000 }).toBeGreaterThan(before);
});

test("within the caps on the longest clip: 60,000 line segments, 100k triangles", async ({ page }) => {
  const host = await open3D(page);
  await host.locator('button[data-clip="lj-b"]').click();
  await settle(page, host);
  expect(await probe3d(page, "f.columns()")).toBeLessThanOrEqual(64);
  const segments = await probe3d(page, "f.segments()");
  expect(segments).toBeGreaterThan(0);
  expect(segments).toBeLessThanOrEqual(60_000);
  const draws = (await hook(page)).draws["listen-terrain"];
  expect(draws.triangles).toBeLessThanOrEqual(100_000);
  expect(draws.calls).toBeLessThanOrEqual(30);
});

test("phone 375 px: no horizontal scroll, chip inside the frame", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open3D(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  // The frame's chip; the valleys chip shows only during the beat.
  await expect(host.locator(".anim-chip-layer:not([hidden]) .anim-chip")).toHaveCount(1);
  const chip = await host.locator(".anim-chip-layer:not([hidden]) .anim-chip").boundingBox();
  expect(frame && chip).toBeTruthy();
  if (!frame || !chip) return;
  expect(chip.x).toBeGreaterThanOrEqual(frame.x);
  expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(chip.y).toBeGreaterThanOrEqual(frame.y);
});

test("Zoom in goes toward the highlighted slice, which sits near the frame's left edge, and keeps it in the frame; Reset view brings it back", async ({ page }) => {
  const host = await open3D(page);
  const frame = host.locator(".anim-figure__frame");
  const inside = async () => {
    const box = await frame.boundingBox();
    const points = await probe3d(page, "f.frontPoints()");
    if (!box) throw new Error("no frame");
    const xs = points.map((/** @type {number[]} */ p) => p[0]);
    return { left: Math.min(...xs), right: Math.max(...xs), width: box.width };
  };
  const before = await inside();
  for (let i = 0; i < 3; i += 1) {
    await host.locator('button[data-zoom="in"]').click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
  }
  expect(await probe3d(page, "f.zoom")).toBeCloseTo(1.25 ** 3, 5);
  const after = await inside();
  expect(after.left).toBeGreaterThanOrEqual(0);
  expect(after.right).toBeLessThanOrEqual(after.width);
  // Toward the middle: the slice's centre is nearer the frame's.
  const off = (/** @type {{left: number, right: number, width: number}} */ r) => Math.abs((r.left + r.right) / 2 - r.width / 2);
  expect(off(after)).toBeLessThan(off(before));
  await host.locator('button[data-zoom="reset"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect(await probe3d(page, "f.zoom")).toBe(1);
  const back = await inside();
  expect(Math.abs(back.left - before.left)).toBeLessThan(0.5);
});
