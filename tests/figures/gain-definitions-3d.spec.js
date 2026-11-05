// The gain-definitions figure's 3D view (plan N9, design §5.9): Front lies
// on the 2D comb panel, the first view plays once and lands on its end
// state, Side shows the scatter, reduced motion stays in 2D, and the
// highlight stands out. Every step is a flat plot and opens in 2D, so each
// test presses 3D itself.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "13-what-is-not-established/";
const HOST = '[data-anim="gain-definitions"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;
/** The highlight's chip; the partner's has a layer of its own. */
const CHIP = ".anim-chip-layer:not(.anim-gain__partner-chip) .anim-chip";
const PARTNER_CHIP = ".anim-gain__partner-chip .anim-chip";

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await settle(page, host);
  // The 3D view draws only on screen: on a phone the host is taller than
  // the viewport, so bring the frame itself into view.
  await host.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
  return to3D(page, host);
}

/**
 * Press 3D (a step leaves it) and wait for the view to settle.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 */
async function to3D(page, host) {
  const button = host.locator('[data-ref="view3d"]');
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForLoadState("networkidle");
  await expect(host.locator(".anim-figure__frame")).not.toHaveAttribute("data-three", "loading", { timeout: 15000 });
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  return host;
}

/** @param {import("@playwright/test").Page} page */
const hook = (page) => page.evaluate(() => {
  // @ts-ignore test hook
  const p = window.__ambeAnim.figures["gain-definitions-3d"];
  return { played: p.played, builds: p.builds, pose: p.pose(), parts: p.parts, looking: p.looking };
});

/**
 * The selected comb's tips projected through the live camera, beside the
 * 2D comb panel's mapping of the same numbers.
 * @param {import("@playwright/test").Page} page
 */
const frontPairs = (page) => page.evaluate(async () => {
  const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
  const mod = await import(new URL("anim-gain-definitions.js", script.src).href);
  const frame = /** @type {HTMLElement} */ (document.querySelector('[data-anim="gain-definitions"] .anim-figure__frame'));
  const comb = mod.layout(frame.clientWidth, frame.clientHeight).comb;
  // @ts-ignore test hook
  const p = window.__ambeAnim.figures["gain-definitions-3d"];
  return { zoom: p.zoom(), looking: p.looking,
    pairs: p.frontPoints.map((/** @type {any} */ q) => ({ got: p.project(q.at), want: [comb.x(q.k), comb.y(q.level)] })) };
});

for (const width of [1280, 375]) {
  test(`gain-definitions 3D at ${width} px: Front puts the selected comb on the 2D comb panel, within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page);
    for (let i = 0; i < 3; i += 1) await host.locator('[data-step="next"]').click();
    await host.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
    await settle(page, host);
    await to3D(page, host);
    await host.locator('button[data-preset="front"]').click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    await page.waitForTimeout(100);
    const result = await frontPairs(page);
    expect(result.zoom).toBe(1);
    expect(result.looking).toBe("front");
    expect(result.pairs.length).toBe(29);
    for (const { got, want } of result.pairs) {
      expect(Math.abs(got[0] - want[0]), "x").toBeLessThanOrEqual(0.5);
      expect(Math.abs(got[1] - want[1]), "y").toBeLessThanOrEqual(0.5);
    }
    const h = await hook(page);
    expect(h.parts.context[0]).toBe(false);
    expect(h.parts.wall).toBe(false);
    expect(h.parts.partner).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("gain-definitions 3D: the first view plays once and lands on the corner, every comb at its spread, every marker dropped", async ({ page }) => {
  const host = await open(page);
  const h = await hook(page);
  expect(h.played).toBe(1);
  expect(await page.evaluate(() => window.__ambeAnim.played["gain-definitions"])).toBe(1);
  expect(h.pose).toEqual({ yaw: 44, pitch: 20 });
  expect(h.parts.slid).toBe(1);
  expect(h.parts.dropped).toBe(1);
  expect(h.parts.selected).toBe("lr-a frame 36");
  // The wall holds every frame of the eight recordings, the step only lr-a.
  expect(h.parts.marks).toEqual([true, 661]);
  expect(h.parts.holding).toBe(false);
  expect(h.parts.dim).toBe(1);
  // lr-a frame 36 stands at spread 3.07 dB.
  const z = await page.evaluate(() => window.__ambeAnim.figures["gain-definitions-3d"].z(3.0694621));
  expect(h.parts.z).toBeCloseTo(z, 4);
  await expect(host.locator(CHIP)).toHaveText("spread 3.1 dB, gap 1.1 dB");
  await expect(host.locator('[data-ref="key-context"]')).toBeVisible();
  await expect(host.locator('button[data-preset="corner"]')).toHaveAttribute("aria-pressed", "true");
});

test("gain-definitions 3D: 3D on each step shows its frame; step 4 looks from the Side at the equal-spread pair", async ({ page }) => {
  const host = await open(page);
  const next = host.locator('[data-step="next"]');
  await next.click();
  await settle(page, host);
  await to3D(page, host);
  await expect(host.locator(CHIP)).toHaveText("spread 26.8 dB, gap 31.5 dB");
  await next.click();
  await settle(page, host);
  await to3D(page, host);
  // Step 3 looks at the wall from the Side.
  expect((await hook(page)).looking).toBe("side");
  await expect(host.locator(PARTNER_CHIP)).toBeHidden();
  await next.click();
  await settle(page, host);
  await to3D(page, host);
  const h = await hook(page);
  expect(h.looking).toBe("side");
  expect(h.parts.selected).toBe("lr-a frame 96");
  expect(h.parts.marks).toEqual([true, 661]);
  expect(h.parts.context[0]).toBe(false);
  // Edge on, the comb hides: the two frames are rings on their G_L
  // markers, each with a bracket from 0 to its gap and a chip.
  expect([h.parts.kit, h.parts.teeth, h.parts.fill]).toEqual([false, false, false]);
  expect(h.parts.rings).toEqual([true, true]);
  expect(h.parts.brackets).toEqual([true, true]);
  await expect(host.locator(CHIP)).toHaveText("lr-a: spread 18.4 dB, gap 36.9 dB");
  await expect(host.locator(PARTNER_CHIP)).toBeVisible();
  await expect(host.locator(PARTNER_CHIP)).toHaveText("lj-c: spread 18.5 dB, gap 17.7 dB");
  // Neither chip covers a G_L marker of the scatter.
  const covered = await page.evaluate((sel) => {
    const p = window.__ambeAnim.figures["gain-definitions-3d"];
    const frame = /** @type {HTMLElement} */ (document.querySelector('[data-anim="gain-definitions"] .anim-figure__frame'));
    const f = frame.getBoundingClientRect();
    return [...document.querySelectorAll(sel)].map((chip) => {
      const c = chip.getBoundingClientRect();
      return p.sidePoints.filter((/** @type {any} */ q) => {
        const [x, y] = p.project(q.at);
        return x + f.left > c.left && x + f.left < c.right && y + f.top > c.top && y + f.top < c.bottom;
      }).length;
    });
  }, `${HOST} .anim-chip`);
  expect(covered).toEqual([0, 0]);
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /lj-c frame 52 has a gap of 17\.7 dB/);
});

test("gain-definitions, reduced motion: opens in 2D, loads nothing 3D, and the 3D control lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => {
    if (/anim-gain-definitions-3d\.js|vendor\/three\//.test(r.url())) requests.push(r.url());
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
  expect(h.pose).toEqual({ yaw: 44, pitch: 20 });
  expect(h.parts.slid).toBe(1);
  expect(h.parts.dropped).toBe(1);
});

test("gain-definitions 3D: toggling five times quickly leaves one view or none, never a stray", async ({ page }) => {
  const host = await open(page);
  const button = host.locator('[data-ref="view3d"]');
  for (let i = 0; i < 5; i += 1) await button.click();
  await page.waitForTimeout(800);
  await settle(page, host);
  const pressed = await button.getAttribute("aria-pressed");
  await expect(page.locator(CANVAS_3D)).toHaveCount(pressed === "true" ? 1 : 0);
  await expect(host.locator(".anim-chip-layer")).toHaveCount(pressed === "true" ? 2 : 0);
  await expect(host.getByRole("group", { name: "Zoom" })).toHaveCount(pressed === "true" ? 1 : 0);
  expect(await page.evaluate(() => window.__ambeAnim.liveContexts)).toBeLessThanOrEqual(1);
});

test("gain-definitions 3D: context loss pauses; resume rebuilds on the same frame", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-step="next"]').click();
  await settle(page, host);
  await to3D(page, host);
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
  await expect(host.locator(CHIP)).toHaveText("spread 26.8 dB, gap 31.5 dB");
});

test("gain-definitions 3D on a phone: the chip stays inside the frame at 1x and 6x", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open(page);
  const inside = async () => {
    const f = await host.locator(".anim-figure__frame").boundingBox();
    const c = await host.locator(CHIP).boundingBox();
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

test("gain-definitions: the highlight at 3:1 on the plot and the stage, in both themes", async ({ page }) => {
  const host = await open(page);
  for (const scheme of ["slate", "default"]) {
    const values = await host.locator(".anim-figure__frame").evaluate((frame, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(frame);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    const lum = (/** @type {string} */ hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const ground of values.slice(1)) {
      const [x, y] = [lum(values[0]), lum(ground)].sort((a, b) => b - a);
      expect((x + 0.05) / (y + 0.05), `${scheme} on ${ground}`).toBeGreaterThanOrEqual(3);
    }
  }
});
