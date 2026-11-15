// The complex figure's 3D view (plan F5, three-everywhere design §4.5):
// End on and Real part put the scene on the 2D plots' own rectangles, the
// wall is the floor a quarter turn on, the first view plays once and lands
// on its end state, reduced motion and ?nowebgl stay in 2D, and the steps
// read the same either way. Step 1 is a flat graph, so the figure opens in
// 2D; the 3D view comes with the 3D control or the helix step.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "02-fourier-and-the-dft/";
const HOST = '[data-anim="complex"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  return host;
}

/**
 * Fly to a preset and land, then the probe's points projected through the
 * live camera beside the 2D module's own mapping of the same data.
 * @param {import("@playwright/test").Page} page
 * @param {"end" | "real"} name
 */
async function compare(page, name) {
  await page.locator(`${HOST} button[data-preset="${name}"]`).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(100);
  return page.evaluate(async (preset) => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const mod = await import(new URL("anim-complex.js", script.src).href);
    const frame = /** @type {HTMLElement} */ (document.querySelector('[data-anim="complex"] .anim-figure__frame'));
    const geo = mod.layout(frame.clientWidth, frame.clientHeight);
    // @ts-ignore test hook
    const probe = window.__ambeAnim.figures["complex-3d"];
    return {
      zoom: probe.zoom(),
      looking: probe.looking,
      pairs: probe.frontPoints.map((/** @type {any} */ p) => ({
        got: probe.project(p.at),
        want: preset === "end" ? [geo.plane.x(p.re), geo.plane.y(p.im)] : [geo.wave.x(p.t), geo.wave.y(p.re)],
      })),
    };
  }, name);
}

for (const width of [1280, 375]) {
  test(`complex 3D at ${width} px: End on is the plane panel and Real part the wave panel, within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    for (const name of /** @type {const} */ (["end", "real"])) {
      const result = await compare(page, name);
      expect(result.zoom).toBe(1);
      expect(result.looking).toBe(name);
      expect(result.pairs).toHaveLength(9);
      for (const { got, want } of result.pairs) {
        expect(Math.abs(got[0] - want[0]), `${name} x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(got[1] - want[1]), `${name} y`).toBeLessThanOrEqual(0.5);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const width of [1280, 375]) {
  test(`complex 3D at ${width} px: the companion panel lies on the other 2D panel, within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    for (const name of /** @type {const} */ (["end", "real", "imag"])) {
      await page.locator(`${HOST} button[data-preset="${name}"]`).click();
      await page.evaluate(() => window.__ambeAnim?.finishAll());
      await page.waitForTimeout(100);
      const pairs = await page.evaluate(async (preset) => {
        const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
        const mod = await import(new URL("anim-complex.js", script.src).href);
        const frame = /** @type {HTMLElement} */ (document.querySelector('[data-anim="complex"] .anim-figure__frame'));
        const geo = mod.layout(frame.clientWidth, frame.clientHeight);
        // @ts-ignore test hook
        const probe = window.__ambeAnim.figures["complex-3d"];
        const panel = preset === "end" ? "wave" : "plane";
        const plot = preset === "end" ? geo.wave : geo.plane;
        const out = [];
        for (const [a, b] of [[0, 0], [1, 1], [-1, 0.5], [preset === "end" ? 2 : 1.35, -1.35]]) {
          out.push({ got: probe.project(probe.panelAt(panel, a, b)), want: [plot.x(a), plot.y(b)] });
        }
        return { out, parts: probe.parts, panel };
      }, name);
      expect(pairs.parts[pairs.panel === "wave" ? "wave" : "circle"][0], `${name} companion shown`).toBe(true);
      for (const { got, want } of pairs.out) {
        expect(Math.abs(got[0] - want[0]), `${name} x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(got[1] - want[1]), `${name} y`).toBeLessThanOrEqual(0.5);
      }
    }
    await page.locator(`${HOST} button[data-preset="corner"]`).click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    const parts = await page.evaluate(() => window.__ambeAnim.figures["complex-3d"].parts);
    expect(parts.circle[0]).toBe(false);
    expect(parts.wave[0]).toBe(false);
  });
}

test("complex 3D: while the helix draws out, the chip states the angle of the point as drawn", async ({ page }) => {
  // The first view draws the helix out; catch it on the way.
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(350);
  const seen = await page.evaluate(() => {
    // @ts-ignore test hook
    const p = window.__ambeAnim.figures["complex-3d"].frontPoints[0];
    const deg = Math.round(((Math.atan2(p.im, p.re) * 180) / Math.PI + 360) % 360) % 360;
    return { deg, t: p.t, chip: document.querySelector('[data-anim="complex"] .anim-chip')?.textContent };
  });
  expect(seen.t).toBeLessThan(2);
  expect(seen.chip).toBe(`r 1.00, θ ${seen.deg}°`);
});

test("complex 3D: end on, the unit circle is as wide as it is tall", async ({ page }) => {
  await open(page);
  await page.locator(`${HOST} button[data-preset="end"]`).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const [w, h] = await page.evaluate(() => {
    // @ts-ignore test hook
    const probe = window.__ambeAnim.figures["complex-3d"];
    const xs = [];
    const ys = [];
    for (let i = 0; i < 360; i += 1) {
      const a = (i / 180) * Math.PI;
      const [x, y] = probe.project([0, Math.sin(a), -Math.cos(a)]);
      xs.push(x);
      ys.push(y);
    }
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  });
  expect(w).toBeGreaterThan(50);
  expect(Math.abs(w - h)).toBeLessThanOrEqual(0.5);
});

test("complex 3D: the wall at turn t equals the floor at t + 0.25, in the lines as drawn", async ({ page }) => {
  await open(page);
  // At the corner both shadows are drawn.
  await page.locator(`${HOST} button[data-preset="corner"]`).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const { pushed, drawn, perTurn } = await page.evaluate(() => window.__ambeAnim.figures["complex-3d"].shadows);
  // The geometry holds what was pushed into it (Float32).
  for (const name of /** @type {const} */ (["wall", "floor"])) {
    expect(drawn[name].length).toBe(pushed[name].length);
    expect(drawn[name].length / 3).toBeGreaterThan(400);
    for (let i = 0; i < drawn[name].length; i += 1) {
      expect(Math.abs(drawn[name][i] - pushed[name][i])).toBeLessThanOrEqual(1e-6);
    }
  }
  // Points are x, y, z; the wall's height is y, the floor's depth z. A
  // quarter turn is perTurn / 4 scene units along x.
  const { wall, floor } = pushed;
  const quarter = floor.findIndex((/** @type {number} */ v, /** @type {number} */ i) =>
    i % 3 === 0 && Math.abs(v - wall[0] - perTurn / 4) < 1e-9) / 3;
  expect(quarter).toBeGreaterThan(0);
  let checked = 0;
  for (let i = 0; i + quarter < wall.length / 3; i += 1) {
    const j = i + quarter;
    expect(Math.abs(floor[j * 3] - wall[i * 3] - perTurn / 4)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(wall[i * 3 + 1] - floor[j * 3 + 2])).toBeLessThanOrEqual(1e-9);
    // And in the drawn geometry, to Float32.
    expect(Math.abs(drawn.wall[i * 3 + 1] - drawn.floor[j * 3 + 2])).toBeLessThanOrEqual(1e-6);
    checked += 1;
  }
  expect(checked).toBeGreaterThan(400);
});

test("complex 3D: the first view plays once and lands on Real part, the circle panel beside the wave, two turns drawn out", async ({ page }) => {
  const host = await open(page);
  const probe = await page.evaluate(() => {
    // @ts-ignore test hook
    const p = window.__ambeAnim.figures["complex-3d"];
    return { played: p.played, pose: p.pose(), parts: p.parts, hookPlayed: window.__ambeAnim.played.complex };
  });
  expect(probe.played).toBe(1);
  expect(probe.hookPlayed).toBe(1);
  expect(probe.pose).toEqual({ yaw: 0, pitch: 90 });
  expect(probe.parts.trace).toEqual([true, 480]);
  // Real part names the floor's shadow; the wall's is edge on.
  expect(probe.parts.floorShadows[0]).toBe(true);
  expect(probe.parts.wallShadows[0]).toBe(false);
  // The companion: the circle panel shows, the wave panel does not.
  expect(probe.parts.circle[0]).toBe(true);
  expect(probe.parts.wave[0]).toBe(false);
  await expect(host.locator(".anim-chip")).toHaveText("r 1.00, θ 35°");
  await expect(host.locator('button[data-preset="real"]')).toHaveAttribute("aria-pressed", "true");
  // Step 1 reads in 3D as in 2D: the pair is labelled.
  await expect(host.locator(".anim-figure__label", { hasText: "x = 0.82" })).toBeVisible();
  await expect(host.locator(".anim-figure__label", { hasText: "y = 0.57" })).toBeVisible();
  // The 3D legend replaces the 2D one, and says the highlight in words.
  await expect(host.locator('[data-ref="legend-3d"]')).toBeVisible();
  await expect(host.locator('[data-ref="legend-2d"]')).toBeHidden();
  await expect(host.locator('[data-ref="legend-3d"]')).toContainText("(thick, outlined)");
});

test("complex 3D: the canvas label follows the point", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="angle"]').fill("90");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /angle 90 degrees/);
  await expect(host.locator(".anim-chip")).toHaveText("r 1.00, θ 90°");
  // A slider sets the point by hand: nothing is traced since.
  expect(await page.evaluate(() => window.__ambeAnim.figures["complex-3d"].parts.trace[0])).toBe(false);
});

test("complex, reduced motion: opens in 2D, loads nothing 3D, and the 3D control lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => {
    if (/anim-complex-3d\.js|vendor\/three\//.test(r.url())) requests.push(r.url());
  });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect(requests).toEqual([]);
  await host.locator('[data-ref="view3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const probe = await page.evaluate(() => {
    // @ts-ignore test hook
    const p = window.__ambeAnim.figures["complex-3d"];
    return { played: p.played, pose: p.pose() };
  });
  expect(probe.played).toBe(0);
  expect(probe.pose).toEqual({ yaw: 0, pitch: 90 });
});

test("complex, ?nowebgl: the 3D step stays in 2D and the Imaginary part step draws y in 2D", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator('[data-ref="view3d"]')).toBeDisabled();
  const next = host.locator('[data-step="next"]');
  await next.click();
  await next.click();
  await expect(host.locator(".anim-steps > li:not([hidden])")).toContainText("helix");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await next.click();
  await expect(host.locator("canvas.anim-figure__canvas")).toHaveAttribute("aria-label", /a quarter turn later/);
});

test("complex 3D: toggling five times quickly leaves one view or none, never a stray", async ({ page }) => {
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

test("complex: the steps pick the view, 3D only for the helix", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const toggle = host.locator('[data-ref="view3d"]');
  const next = host.locator('[data-step="next"]');
  for (const want of ["false", "false", "true", "false"]) {
    await expect(toggle).toHaveAttribute("aria-pressed", want);
    if (want === "true") await page.locator(CANVAS_3D).waitFor();
    else await expect(page.locator(CANVAS_3D)).toHaveCount(0);
    if ((await next.textContent()) === "Next") await next.click();
  }
});
