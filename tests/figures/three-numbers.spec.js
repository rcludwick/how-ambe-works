// three-numbers (ch01), the 2D side: the model's numbers, the readouts, the
// poster without JS, and printing. The 3D view is in three-numbers-3d.spec.js.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PATH = "01-why-sinusoids/";
const HOST = '[data-anim="three-numbers"]';

/**
 * The figure's module, the same instance the page runs.
 * @param {import("@playwright/test").Page} page
 * @param {string} body  a function of `m`, the module
 */
const withModule = (page, body) => page.evaluate(async (source) => {
  const script = document.querySelector('script[src*="javascripts/anim.js"]');
  if (!(script instanceof HTMLScriptElement)) throw new Error("no anim.js script tag");
  const m = await import(new URL("anim-three-numbers.js", script.src).href);
  return new Function("m", `return (${source})(m);`)(m);
}, body);

test("the model: SPAN 3, POINTS 720, one period 1/f, 25 slices, crest lines one period apart", async ({ page }) => {
  await page.goto(PATH);
  const got = await withModule(page, `(m) => ({
    span: m.SPAN, points: m.POINTS, wave: m.wave(1, 1, 0).length,
    periods: [0.5, 1, 4].map((f) => m.period(f).toFixed(3)),
    slices: m.slices(1, 1).length, slicePoints: m.slices(1, 1)[0].points.length,
    lastIsFirst: m.slices(1.2, 2).at(-1).points.every((p, i) => Math.abs(p.y - m.slices(1.2, 2)[0].points[i].y) < 1e-9),
    crests: m.crestLines(1),
    crestsF2: m.crestLines(2),
    shift: m.shiftCycles(2, Math.PI),
    bracket: m.bracket(1, Math.PI / 2),
    rect: m.plotRect(600, 262),
    rectPhone: m.plotRect(300, 131),
  })`);
  expect(got.span).toBe(3);
  expect(got.points).toBe(720);
  expect(got.wave).toBe(721);
  expect(got.periods).toEqual(["2.000", "1.000", "0.250"]);
  expect(got.slices).toBe(25);
  expect(got.slicePoints).toBe(721);
  expect(got.lastIsFirst).toBe(true);
  // Every crest line falls by one period over one turn, and lies in the panel.
  for (const set of [{ lines: got.crests, f: 1 }, { lines: got.crestsF2, f: 2 }]) {
    for (const c of set.lines) {
      expect(c.p0).toBeGreaterThanOrEqual(0);
      expect(c.p1).toBeLessThanOrEqual(360);
      for (const t of [c.t0, c.t1]) {
        expect(t).toBeGreaterThanOrEqual(-1e-9);
        expect(t).toBeLessThanOrEqual(3 + 1e-9);
      }
      const slope = (c.t1 - c.t0) / ((c.p1 - c.p0) / 360);
      expect(slope).toBeCloseTo(-1 / set.f, 9);
    }
  }
  // The wrap: crest k ends at 360 degrees where crest k - 1 started at 0.
  const whole = got.crests.filter((c) => c.p0 === 0 && c.p1 === 360);
  expect(whole.map((c) => [c.t0, c.t1])).toEqual([[1.25, 0.25], [2.25, 1.25]]);
  expect(got.shift).toBeCloseTo(0.25, 12);
  expect(got.bracket.refT).toBe(1);
  expect(got.bracket.liveT).toBeCloseTo(0.75, 12);
  expect(got.rect).toEqual({ x: 40, y: 14, width: 544, height: 218 });
  expect(got.rectPhone).toEqual({ x: 30, y: 14, width: 254, height: 87 });
});

test("readouts: the equation, and the 3D-only turn of phase in cycles of the reference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PATH);
  const host = page.locator(HOST);
  await settle(page, host);
  const turn = host.locator('[data-role="r-turn"]');
  await expect(turn).toHaveText("one period: 1.000 cycles of the reference");
  await expect(turn).toBeHidden();
  for (const [value, text] of [["50", "2.000"], ["400", "0.250"]]) {
    await host.locator('[data-role="freq"]').fill(value);
    await expect(turn).toHaveText(`one period: ${text} cycles of the reference`);
  }
  await host.locator('[data-role="phase"]').fill("90");
  await expect(host.locator('[data-role="r-eq"]')).toHaveText("1.00 · sin(2π · 4.00f · t + 0.250 turn)");
  await expect(host.locator("canvas").first()).toHaveAttribute("aria-label", /phase 90 degrees\.$/);
});

test("STYLE.md: no em dash in the figure's text", async ({ page }) => {
  await page.goto(PATH);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  expect(await host.locator(".anim-figure").innerText()).not.toContain("\u2014");
});

test.describe("without JS", () => {
  test.use({ javaScriptEnabled: false });
  test("the poster loads from under the base path", async ({ page }) => {
    await page.goto(PATH);
    const img = page.locator(`${HOST} .anim-fallback img`);
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => /** @type {HTMLImageElement} */ (el).naturalWidth)).toBe(1280);
    expect(new URL(await img.evaluate((el) => /** @type {HTMLImageElement} */ (el).src)).pathname)
      .toBe("/how-ambe-works/assets/posters/three-numbers.png");
  });
});

test("print: the poster and its caption, dark on white; the live figure stays off the page", async ({ page }) => {
  await page.goto(PATH);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await page.emulateMedia({ media: "print" });
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  const caption = host.locator(".anim-fallback figcaption");
  await expect(caption).toBeVisible();
  await expect(host.locator(".anim-figure__frame")).toBeHidden();
  await expect(host.locator(".anim-controls").first()).toBeHidden();
  const [ink, paper] = await caption.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(document.body).backgroundColor]);
  expect(paper).toBe("rgb(255, 255, 255)");
  const [r, g, b] = (ink.match(/\d+/g) ?? []).map(Number);
  expect(Math.max(r, g, b)).toBeLessThan(110);
});

test("enhanced: the poster hides on screen and the live figure follows it", async ({ page }) => {
  await page.goto(PATH);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await expect(host.locator(".anim-fallback")).toBeHidden();
  await expect(host.locator(".anim-fallback + figure.anim-figure")).toHaveCount(1);
});
