// The probe figure's 3D view (plan N1, three-everywhere design §5.1): Top,
// Front and End on put the scene on the 2D sine row, cosine row and plane
// of the sums, the first view plays once and lands on its end state,
// and the steps read the same either way. Only the figure with both tests
// (#fig-2-2) has a 3D view; its first step asks for it.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "02-fourier-and-the-dft/";
const HOST = "#fig-2-2";
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  await page.locator(CANVAS_3D).waitFor();
  // Step 1 asks for 3D: wait for its first view to start playing, then end it.
  await expect.poll(() => page.evaluate(() => window.__ambeAnim.figures["probe-3d"]?.played ?? 0)).toBe(1);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  return host;
}

/** @param {import("@playwright/test").Page} page */
const hook = (page) => page.evaluate(() => {
  // @ts-ignore test hook
  const p = window.__ambeAnim.figures["probe-3d"];
  return { played: p.played, builds: p.builds, pose: p.pose(), parts: p.parts, looking: p.looking };
});

/**
 * Fly to a preset and land with the scene laid on the 2D panels (the
 * opening's hand-off frame), then the probe's points projected through the
 * live camera beside the 2D module's own mapping of the same numbers, and
 * each point's numbers beside lib/probe.js's for the state on show.
 * @param {import("@playwright/test").Page} page
 * @param {"end" | "top" | "front"} name
 */
async function compare(page, name) {
  await page.locator(`${HOST} button[data-preset="${name}"]`).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(100);
  return page.evaluate(async (preset) => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const mod = await import(new URL("anim-probe.js", script.src).href);
    const lib = await import(new URL("lib/probe.js", script.src).href);
    const host = /** @type {HTMLElement} */ (document.querySelector("#fig-2-2"));
    const f = Number(/** @type {HTMLInputElement} */ (host.querySelector('[data-role="freq"]')).value);
    const phase = Number(/** @type {HTMLInputElement} */ (host.querySelector('[data-role="phase"]')).value);
    const d = lib.probe(f, lib.radians(phase));
    // @ts-ignore test hook
    window.__ambeAnim.figures["probe-3d"].matchPlot(true);
    const frame = /** @type {HTMLElement} */ (document.querySelector("#fig-2-2 .anim-figure__frame"));
    const geo = mod.layout(frame.clientWidth, frame.clientHeight);
    // @ts-ignore test hook
    const probe = window.__ambeAnim.figures["probe-3d"];
    /** The 2D mapping of one probe point: products as drawn in the rows, sums on the plane. */
    const want = (/** @type {any} */ p) => {
      if (preset === "end") return p.kind === "run" ? [geo.plane.x(p.sine), geo.plane.y(p.cosine)] : null;
      const row = preset === "top" ? geo.rows[1] : geo.rows[2];
      const v = preset === "top" ? p.sine : p.cosine;
      return [row.x(p.n), row.y(p.kind === "run" ? v / mod.SCALE : v)];
    };
    /** How far a point's numbers are from the lib's, for its sample. */
    const off = (/** @type {any} */ p) => p.kind === "tip"
      ? Math.max(Math.abs(p.sine - d.sineProducts[p.n]), Math.abs(p.cosine - d.cosineProducts[p.n]))
      : Math.max(Math.abs(p.sine - d.sineRun[p.n - 1]), Math.abs(p.cosine - d.cosineRun[p.n - 1]));
    const out = {
      zoom: probe.zoom(),
      looking: probe.looking,
      pairs: probe.frontPoints.map((/** @type {any} */ p) => ({ got: probe.project(p.at), want: want(p) })).filter((/** @type {any} */ q) => q.want),
      numbers: Math.max(...probe.frontPoints.map(off)),
    };
    probe.matchPlot(false);
    return out;
  }, name);
}

for (const width of [1280, 375]) {
  test(`probe 3D at ${width} px: Top, Front and End on lie on the sine row, the cosine row and the plane, within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page);
    // Both tests on, phase 45: every coordinate is non-zero.
    await host.locator('[data-role="phase"]').fill("45");
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    for (const name of /** @type {const} */ (["top", "front", "end"])) {
      const result = await compare(page, name);
      expect(result.zoom).toBe(1);
      expect(result.looking).toBe(name);
      expect(result.pairs.length).toBeGreaterThanOrEqual(name === "end" ? 9 : 17);
      expect(result.numbers, `${name} numbers`).toBeLessThanOrEqual(1e-9);
      for (const { got, want } of result.pairs) {
        expect(Math.abs(got[0] - want[0]), `${name} x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(got[1] - want[1]), `${name} y`).toBeLessThanOrEqual(0.5);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("probe 3D: the first view plays once and rests on Corner (step 1), every stem grown, the path's end on the plane at 80", async ({ page }) => {
  const host = await open(page);
  const h = await hook(page);
  expect(h.played).toBe(1);
  expect(await page.evaluate(() => window.__ambeAnim.played.probe)).toBe(1);
  expect(h.pose).toEqual({ yaw: 38, pitch: 24 });
  expect(h.parts.stems).toEqual([true, 160]);
  expect(h.parts.path).toBe(true);
  // Step 1, both tests at phase 90: the path ends on the plane (x = 3), 80 from its centre.
  expect(h.parts.end[0]).toBeCloseTo(3, 9);
  expect(Math.hypot(h.parts.end[1], h.parts.end[2])).toBeCloseTo(1, 9);
  await expect(host.locator(".anim-chip")).toHaveText("sum: 80.00");
  await expect(host.locator('button[data-preset="corner"]')).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator('[data-ref="legend-3d"]')).toBeVisible();
  await expect(host.locator('[data-ref="legend-2d"]')).toBeHidden();
  await expect(host.locator('[data-ref="legend-3d"]')).toContainText("(thick, glowing)");
});

test("probe 3D: the sliders morph the numbers; at 250 Hz the path comes back to 0 and the chip says so", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="phase"]').fill("45");
  await host.locator('button[data-preset="end"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await hook(page)).looking).toBe("end");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /80\.00 from the centre at 45 degrees/);
  await host.locator('[data-role="phase"]').fill("0");
  await host.locator('[data-role="freq"]').fill("250");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await expect(host.locator(".anim-chip")).toHaveText("sum: 0.00");
  const end = (await hook(page)).parts.end;
  expect(Math.hypot(end[1], end[2])).toBeLessThan(1e-9);
});

test("probe 3D: the steps pick the view: step 1 in 3D, the plane and the 250 Hz steps in 2D", async ({ page }) => {
  const host = await open(page);
  const toggle = host.locator('[data-ref="view3d"]');
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const next = host.locator('[data-step="next"]');
  for (let i = 0; i < 2; i += 1) {
    await next.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  }
  await host.locator('[data-step="prev"]').click();
  await host.locator('[data-step="prev"]').click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.locator(CANVAS_3D).waitFor();
});

test("probe 3D: the plane hides on Top and Front, where it is edge on", async ({ page }) => {
  const host = await open(page);
  for (const [name, plane] of /** @type {const} */ ([["top", false], ["front", false], ["end", true], ["corner", true]])) {
    await host.locator(`button[data-preset="${name}"]`).click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    expect((await hook(page)).parts.plane, name).toBe(plane);
  }
});

test("probe, reduced motion: opens in 2D though step 1 asks for 3D, loads nothing 3D, and the 3D control lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => {
    if (/anim-probe-3d\.js|vendor\/three\//.test(r.url())) requests.push(r.url());
  });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect(requests).toEqual([]);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const h = await hook(page);
  expect(h.played).toBe(0);
  expect(h.pose).toEqual({ yaw: 38, pitch: 24 });
  expect(h.parts.stems).toEqual([true, 160]);
  // A step the reader moves to still picks its view.
  await host.locator('[data-step="next"]').click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await host.locator('[data-step="prev"]').click();
  await page.locator(CANVAS_3D).waitFor();
});

test("probe 3D: toggling five times quickly leaves one view or none, never a stray", async ({ page }) => {
  const host = await open(page);
  const button = host.locator('[data-ref="view3d"]');
  for (let i = 0; i < 5; i += 1) await button.click();
  await page.waitForTimeout(800);
  await settle(page, host);
  const pressed = await button.getAttribute("aria-pressed");
  await expect(page.locator(CANVAS_3D)).toHaveCount(pressed === "true" ? 1 : 0);
  await expect(host.locator(".anim-chip-layer")).toHaveCount(pressed === "true" ? 1 : 0);
  await expect(host.getByRole("group", { name: "Zoom" })).toHaveCount(pressed === "true" ? 1 : 0);
  expect(await page.evaluate(() => window.__ambeAnim.liveContexts)).toBeLessThanOrEqual(1);
});

test("probe 3D: context loss pauses; resume rebuilds with the same numbers", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="phase"]').fill("0");
  await host.locator('[data-role="freq"]').fill("225");
  const before = (await hook(page)).builds;
  await page.locator(CANVAS_3D).evaluate((c) => {
    const gl = /** @type {HTMLCanvasElement} */ (c).getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  const frame = host.locator(".anim-figure__frame");
  await expect(frame).toHaveAttribute("data-state", "paused");
  await frame.locator(".anim-figure__resume").click();
  await expect(frame).not.toHaveAttribute("data-state", "paused");
  await expect.poll(async () => (await hook(page)).builds).toBe(before + 1);
  await expect(host.locator(".anim-chip")).toHaveText("sum: 47.96");
});

test("probe 3D on a phone: the chip stays inside the frame at 1x and 6x", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open(page);
  const inside = async () => {
    const f = await host.locator(".anim-figure__frame").boundingBox();
    const c = await host.locator(".anim-chip").boundingBox();
    if (!f || !c) throw new Error("no box");
    return c.x >= f.x - 0.5 && c.x + c.width <= f.x + f.width + 0.5 && c.y >= f.y - 0.5 && c.y + c.height <= f.y + f.height + 0.5;
  };
  expect(await inside()).toBe(true);
  const into = host.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 12 && (await into.isEnabled()); i += 1) {
    await into.click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
  }
  expect(await inside()).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("probe 3D: the walk counts up as it goes, and resting presets frame their subject centred", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  // The frame in full view: the walk waits for it, and ends early if it
  // leaves. Scroll anchoring once moved the page about 1,070 px here as the
  // walk started (fixed in anim-probe.js holdToGrid), so the test runs with
  // anchoring on, as a reader's browser has it.
  await host.locator(".anim-figure__frame").first().evaluate((f) => f.scrollIntoView({ block: "center" }));
  await page.locator(CANVAS_3D).waitFor();
  // Mid-walk: some stems drawn, not all, and the chip below 80.
  await expect.poll(async () => (await hook(page)).parts.stems?.[1] ?? 0, { timeout: 5000, intervals: [50] }).toBeGreaterThan(20);
  const mid = await hook(page);
  expect(mid.parts.stems[1]).toBeLessThan(160);
  const chip = Number((await host.locator(".anim-chip").textContent())?.replace("sum: ", ""));
  expect(chip).toBeGreaterThan(0);
  expect(chip).toBeLessThan(80);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  // End on: the plane fills at least 80% of the frame's height, centred.
  await host.locator('button[data-preset="end"]').click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const fill = await page.evaluate(() => {
    // @ts-ignore test hook
    const probe = window.__ambeAnim.figures["probe-3d"];
    const frame = /** @type {HTMLElement} */ (document.querySelector("#fig-2-2 .anim-figure__frame"));
    const a = probe.project([3, 1.2, 1.2]);
    const b = probe.project([3, -1.2, -1.2]);
    return { height: Math.abs(a[1] - b[1]) / frame.clientHeight, centre: (a[0] + b[0]) / 2 / frame.clientWidth };
  });
  expect(fill.height).toBeGreaterThanOrEqual(0.8);
  expect(Math.abs(fill.centre - 0.5)).toBeLessThan(0.02);
});
