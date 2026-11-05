// three-numbers (ch01), the 3D view: Front equals the 2D plot, the opening
// rule and its one animation, the highlight, zoom, context loss, phones.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

// Several 3D views open and settle per case; give each room on a busy machine.
test.describe.configure({ timeout: 90_000 });

const PATH = "01-why-sinusoids/";
const HOST = '[data-anim="three-numbers"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;
const TOGGLE = `${HOST} .anim-controls button[data-view="3d"]`;

/**
 * The 3D part's probe (TEST_HOOK.figures["three-numbers-3d"]), serialisable fields.
 * @param {import("@playwright/test").Page} page
 */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const p = window.__ambeAnim.figures["three-numbers-3d"];
  return p && { builds: p.builds, pose: p.pose, zoom: p.zoom, played: p.played, shown: p.shown, counts: p.counts() };
});

/**
 * Whether the sheet, the 360 slice, the crest lines and the highlight's outline show.
 * @param {import("@playwright/test").Page} page
 */
// @ts-ignore test-only global
const context = (page) => page.evaluate(() => window.__ambeAnim.figures["three-numbers-3d"].context());

/** @param {import("@playwright/test").Page} page */
const finish = (page) => page.evaluate(() => window.__ambeAnim?.finishAll());

/**
 * Open the page in normal motion and wait for the 3D view at its end state.
 * @param {import("@playwright/test").Page} page
 */
async function open(page) {
  await page.goto(PATH);
  const host = page.locator(HOST);
  await settle(page, host);
  await page.locator(CANVAS_3D).waitFor();
  await finish(page);
  await page.waitForTimeout(100);
  await finish(page);
  return host;
}

for (const width of [1280, 375]) {
  test(`Front at ${width}: reference, live wave, bar and bracket land on the 2D mapping within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page);
    await host.locator('[data-role="phase"]').fill("100");
    await host.locator('[data-role="amp"]').fill("120");
    await host.locator('[data-preset="front"]').click();
    await finish(page);
    expect((await probe(page)).pose).toEqual({ yaw: 0, pitch: 0 });
    expect((await probe(page)).zoom).toBe(1);
    const front = await page.evaluate(() => {
      // @ts-ignore test-only global
      return window.__ambeAnim.figures["three-numbers-3d"].frontPoints();
    });
    const { rect } = front;
    const x = (/** @type {number} */ t) => rect.x + (t / 3) * rect.width;
    const y = (/** @type {number} */ v) => rect.y + ((1.6 - v) / 3.2) * rect.height;
    const all = [...front.reference, ...front.live, ...front.bracket, ...front.bar];
    expect(front.bracket.length).toBe(2);
    // Read back from the scene: each point is where the model puts it, in
    // the plane it belongs to (Front cannot show a wrong depth, so it is
    // checked here).
    const phase = (100 / 360) * 2 * Math.PI;
    for (const p of front.live) {
      expect(p.degrees).toBeCloseTo(100, 4);
      expect(p.v).toBeCloseTo(1.2 * Math.sin(2 * Math.PI * p.t + phase), 3);
    }
    for (const p of front.reference) {
      expect([0, 360].some((d) => Math.abs(p.degrees - d) < 1e-3), `reference at ${p.degrees}`).toBe(true);
      expect(p.v).toBeCloseTo(Math.sin(2 * Math.PI * p.t), 3);
    }
    expect(front.bar.map((p) => p.t)).toEqual(front.bar.map(() => expect.closeTo(0.135, 4)));
    expect(front.bar.map((p) => p.v).sort()).toEqual([expect.closeTo(0, 4), expect.closeTo(1.2, 4)]);
    expect(front.bracket.map((p) => p.t).sort()).toEqual([expect.closeTo(1 - 100 / 360, 4), expect.closeTo(1, 4)]);
    for (const p of [...front.bar, ...front.bracket]) expect(p.degrees).toBeCloseTo(100, 4);
    // Front is the 2D panel: the sheet, the 360 slice, the crest lines and
    // the highlight's outline are gone.
    expect(await context(page)).toEqual([false, false, false, false]);
    expect(all.length).toBeGreaterThan(80);
    for (const p of all) {
      expect(Math.abs(p.x - x(p.t)), `x at t ${p.t}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.y - y(p.v)), `y at v ${p.v}`).toBeLessThanOrEqual(0.5);
    }
    // The 2D canvas maps with the same rectangle.
    const size = await host.locator(".anim-figure__frame").evaluate((f) => [f.clientWidth, f.clientHeight]);
    expect(rect.x).toBe(size[0] < 560 ? 30 : 40);
  });
}

test("opens in 3D near the viewport, plays its animation once, ends on the slider's phase", async ({ page }) => {
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  // The figure opens ch01, so the page loads at the last figure, far from it.
  await page.goto(`${PATH}#fig-1-4`);
  await page.waitForLoadState("networkidle");
  // Far from the figure, nothing of its 3D is asked for.
  expect(requests.filter((u) => /anim-three-numbers-3d\.js/.test(u))).toEqual([]);
  const host = page.locator(HOST);
  // From here, on every change to the frame or the 2D canvas: a 3D label
  // or the chip never shows while the 2D canvas still does. (Headless
  // Chromium runs few animation frames here, so changes are watched, not frames.)
  await host.locator(".anim-figure__frame").evaluate((frame) => {
    const flat = frame.querySelector("canvas.anim-figure__canvas:not(.anim-figure__canvas--3d)");
    const swap = { both: 0, checks: 0 };
    // @ts-ignore test-only global
    window.__tnSwap = swap;
    const check = () => {
      const layers = [...frame.querySelectorAll(":scope > .anim-figure__overlay")];
      if (!layers.length) return;
      swap.checks += 1;
      const shown = layers.some((layer) => getComputedStyle(layer).opacity !== "0" &&
        [...layer.children].some((n) => n instanceof HTMLElement && !n.hidden));
      if (shown && flat instanceof HTMLElement && !flat.hidden) swap.both += 1;
    };
    const watch = new MutationObserver(check);
    watch.observe(frame, { attributes: true, childList: true, subtree: true });
    frame.scrollIntoView({ block: "center" });
  });
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await probe(page))?.played).toBe(true);
  // Mid-sweep: the live wave travels through depth and the sheet follows
  // it. Watched from the page, frame by frame, so a slow poll cannot miss it.
  const mid = await page.evaluate(() => new Promise((resolve) => {
    const look = () => {
      // @ts-ignore test-only global
      const shown = window.__ambeAnim.figures["three-numbers-3d"].shown;
      if (shown.phase > 30 && shown.reveal < 1) resolve(shown);
      else if (shown.reveal >= 1) resolve(null);
      else requestAnimationFrame(look);
    };
    look();
  }));
  expect(mid).not.toBeNull();
  // @ts-ignore test-only global
  const swap = () => page.evaluate(() => window.__tnSwap);
  expect((await swap()).checks).toBeGreaterThan(5);
  expect((await swap()).both).toBe(0);
  await finish(page);
  await page.waitForTimeout(100);
  const end = await probe(page);
  expect(end.shown).toEqual({ phase: 0, reveal: 1 });
  expect(end.pose).toEqual({ yaw: -22, pitch: 30 });
  expect((await hook(page)).played["three-numbers"]).toBe(1);
  await expect(host.locator(".anim-chip__text")).toHaveText("phase 0°: shifted 0.000 cycles");
  // Leaving and coming back does not replay it.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await host.scrollIntoViewIfNeeded();
  await settle(page, host);
  expect((await hook(page)).played["three-numbers"]).toBe(1);
});

test("the end state: every slice, the crest lines, inside the per-view caps", async ({ page }) => {
  const host = await open(page);
  const p = await probe(page);
  expect(p.counts.draws).toBeLessThanOrEqual(30);
  expect(p.counts.segments).toBeLessThanOrEqual(30_000);
  const h = await hook(page);
  expect(h.draws["three-numbers"].triangles).toBeLessThanOrEqual(100_000);
  expect(h.tracks["three-numbers"] ?? 0).toBeLessThanOrEqual(3);
  await host.locator('[data-role="phase"]').fill("90");
  await expect(host.locator(".anim-chip__text")).toHaveText("phase 90°: shifted 0.250 cycles");
  await host.locator('[data-role="freq"]').fill("200");
  await expect(host.locator(".anim-chip__text")).toHaveText("phase 90°: shifted 0.125 cycles");
  // The chip sits in a corner of the frame, off the box, its leader to the wave.
  const chipBox = await host.locator(".anim-chip").boundingBox();
  const frameBox = await host.locator(".anim-figure__frame").boundingBox();
  if (!chipBox || !frameBox) throw new Error("no chip or frame");
  expect(chipBox.y - frameBox.y).toBeLessThan(12);
  await expect.poll(() => page.locator(CANVAS_3D).getAttribute("aria-label"))
    .toMatch(/Depth is phase, 0 to 360 degrees\..*one turn of phase is one period of this wave, 0\.500 cycles/);
  // The revoice hid the text readout: the picture already shows the turn.
  await expect(host.locator('[data-role="readout"]')).toBeHidden();
});

test("the highlight is 3:1 or more on the plot and the stage, in both themes", async ({ page }) => {
  const host = await open(page);
  for (const scheme of ["slate", "default"]) {
    const [line, ...grounds] = await host.locator(".anim-figure__frame").evaluate((frame, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(frame);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    for (const ground of grounds) expect(contrast(line, ground), `${scheme} on ${ground}`).toBeGreaterThanOrEqual(3);
  }
});

test("reduced motion: opens in 2D, nothing 3D until the control; then the end state with no motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(PATH);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect(requests.filter((u) => /anim-three-numbers-3d\.js|three\.module/.test(u))).toEqual([]);
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
  await page.locator(TOGGLE).click();
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await probe(page))?.builds).toBe(1);
  const p = await probe(page);
  expect(p.played).toBe(false);
  expect(p.shown).toEqual({ phase: 0, reveal: 1 });
  expect(p.pose).toEqual({ yaw: -22, pitch: 30 });
  expect((await hook(page)).played["three-numbers"]).toBeUndefined();
});

test("toggling 3D five times quickly leaves no stray context or overlay", async ({ page }) => {
  // Under reduced motion the other ch01 figures stay in 2D, so every live
  // context on the page is this figure's. The control opens it in 3D.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PATH);
  await settle(page, page.locator(HOST));
  await page.locator(TOGGLE).click();
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(1);
  // From 3D, five presses end in 2D, and one more asks for 3D again.
  for (let i = 0; i < 5; i += 1) await page.locator(TOGGLE).click();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await page.locator(TOGGLE).click();
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(1);
  await page.locator(TOGGLE).click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
  await expect(page.locator(`${HOST} .anim-chip-layer, ${HOST} .anim-figure__overlay`)).toHaveCount(0);
  await expect(page.locator(`${HOST} [role="group"][aria-label="Zoom"]`)).toHaveCount(0);
  await expect(page.locator(`${HOST} canvas.anim-figure__canvas:not(.anim-figure__canvas--3d)`)).toBeVisible();
});

test("context loss: paused, resume rebuilds at the same state", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="phase"]').fill("45");
  const before = await probe(page);
  await page.locator(CANVAS_3D).evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(host.locator('.anim-figure__frame[data-state="paused"]')).toHaveCount(1);
  await host.locator(".anim-figure__resume").click();
  await expect.poll(async () => (await probe(page)).builds).toBe(before.builds + 1);
  expect((await probe(page)).shown).toEqual({ phase: 45, reveal: 1 });
  await expect(host.locator(".anim-chip__text")).toHaveText("phase 45°: shifted 0.125 cycles");
  expect(await context(page)).toEqual([true, true, true, true]);
});

test("context loss at Front: the rebuilt view is still the 2D panel", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="phase"]').fill("100");
  await host.locator('[data-preset="front"]').click();
  await finish(page);
  expect(await context(page)).toEqual([false, false, false, false]);
  const before = await probe(page);
  await page.locator(CANVAS_3D).evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await host.locator(".anim-figure__resume").click();
  await expect.poll(async () => (await probe(page)).builds).toBe(before.builds + 1);
  expect((await probe(page)).pose).toEqual({ yaw: 0, pitch: 0 });
  expect(await context(page)).toEqual([false, false, false, false]);
  // The plane's marks show at Front, on their plates.
  await expect(host.locator(".anim-tn__marks .anim-figure__label").first()).toHaveText("amplitude");
});

test("presets and zoom: Top, a zoom, and Front back at 1x", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-preset="top"]').click();
  await finish(page);
  expect((await probe(page)).pose).toEqual({ yaw: 0, pitch: 90 });
  await expect(host.locator('[data-preset="top"]')).toHaveAttribute("aria-pressed", "true");
  await host.getByRole("button", { name: "Zoom in" }).click();
  await finish(page);
  expect((await probe(page)).zoom).toBeCloseTo(1.25, 6);
  await host.locator('[data-preset="front"]').click();
  await finish(page);
  expect((await probe(page)).zoom).toBe(1);
});

test("phone, 375 px: no horizontal scroll, chip and labels inside the frame", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  if (!frame) throw new Error("no frame");
  for (const node of await host.locator(".anim-chip, .anim-figure__label:not([hidden])").all()) {
    const box = await node.boundingBox();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(frame.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
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
