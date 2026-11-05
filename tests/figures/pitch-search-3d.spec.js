// pitch-search (ch08), the 3D view: Front and Top equal the 2D panels,
// Side fills the frame with the score (layout().side), the first 3D open and its one animation, the highlight, zoom,
// context loss, phones, and the steps' views. Every step asks for 2D, so the
// figure opens in 2D on ch08 and these tests press 3D.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

test.describe.configure({ timeout: 90_000 });

const PATH = "08-analysis/";
const HOST = '[data-anim="pitch-search"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;
const TOGGLE = `${HOST} .anim-controls button[data-view="3d"]`;
const PART = /anim-pitch-search-3d\.js|three\.module/;

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const p = window.__ambeAnim.figures["pitch-search-3d"];
  return p && { builds: p.builds, pose: p.pose, zoom: p.zoom, played: p.played, shown: { ...p.shown }, counts: p.counts() };
});
/** @param {import("@playwright/test").Page} page */
const front = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  return window.__ambeAnim.figures["pitch-search-3d"].frontPoints();
});
/** @param {import("@playwright/test").Page} page */
const finish = (page) => page.evaluate(() => window.__ambeAnim?.finishAll());

/** Open the page in normal motion, press 3D and wait for its end state. @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.goto(PATH);
  const host = page.locator(HOST);
  await settle(page, host);
  if ((await page.locator(TOGGLE).getAttribute("aria-pressed")) !== "true") await page.locator(TOGGLE).click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await finish(page);
  await page.waitForTimeout(100);
  await finish(page);
  return host;
}

/** @param {import("@playwright/test").Locator} host @param {string} name */
async function preset(host, name) {
  await host.locator(`button[data-preset="${name}"]`).click();
  await host.page().evaluate(() => window.__ambeAnim?.finishAll());
  await host.page().waitForTimeout(50);
}

for (const width of [1280, 375]) {
  test(`at ${width}: Front lands on the phi panel, Side on the full-width score rectangle, Top on the heat map, within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page);
    await preset(host, "front");
    expect((await probe(page)).pose).toEqual({ yaw: 0, pitch: 0 });
    let f = await front(page);
    const phi = f.rects.phi;
    expect(f.phi.length).toBeGreaterThan(30);
    for (const p of f.phi) {
      expect(Math.abs(p.x - (phi.x + (p.lag / 254) * phi.width)), `x at lag ${p.lag}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.y - (phi.y + ((1 - p.v) / 1.75) * phi.height)), `y at lag ${p.lag}`).toBeLessThanOrEqual(0.5);
    }
    await preset(host, "side");
    expect((await probe(page)).pose).toEqual({ yaw: 90, pitch: 0 });
    f = await front(page);
    const psi = f.rects.side;
    const [lo, hi] = f.psiDomain;
    const [p0, p1] = f.pDomain;
    expect([p0, p1]).toEqual([20, 114]);
    // The score across the frame, not squeezed into the 2D view's side panel.
    const frameWidth = (await host.locator(".anim-figure__frame").boundingBox())?.width ?? 0;
    expect(psi.width).toBeGreaterThan(0.8 * frameWidth);
    expect(f.psi.length).toBeGreaterThan(20);
    for (const p of f.psi) {
      expect(Math.abs(p.x - (psi.x + ((p.p - p0) / (p1 - p0)) * psi.width)), `x at P ${p.p}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.y - (psi.y + ((hi - p.v) / (hi - lo)) * psi.height)), `y at P ${p.p}`).toBeLessThanOrEqual(0.5);
    }
    await host.locator('button[data-mode="clip"]').click();
    await preset(host, "top");
    expect((await probe(page)).pose).toEqual({ yaw: 0, pitch: 90 });
    f = await front(page);
    const heat = f.rects.heat;
    expect(f.heat.length).toBe(9);
    for (const p of f.heat) {
      expect(Math.abs(p.x - (heat.x + ((p.lag - 21.5) / 93) * heat.width)), `x at lag ${p.lag}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.y - (heat.y + ((158.5 - p.f) / 159) * heat.height)), `y at frame ${p.f}`).toBeLessThanOrEqual(0.5);
    }
  });
}

test("opens in 2D on its first step; the first 3D press plays the sweep once and ends on P = 46", async ({ page }) => {
  /** @type {string[]} */
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(PATH);
  await page.waitForLoadState("networkidle");
  // No settle() on the way: its finishAll would land this sweep too.
  const host = page.locator(HOST);
  await host.locator(".anim-figure__frame").evaluate((frame) => frame.scrollIntoView({ block: "center" }));
  // Mounted, with step 1 applied (its readout is up).
  await expect(host.locator('[data-role="readout"]')).toHaveText(/Ψ\(P\) = 44\.45$/);
  await page.waitForTimeout(500);
  // Step 1 asks for 2D, so nothing 3D loads near the viewport.
  expect(requests.filter((u) => /anim-pitch-search-3d\.js/.test(u))).toEqual([]);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await page.locator(TOGGLE).click();
  await page.locator(CANVAS_3D).waitFor();
  // Pressing the control scrolled it into view; the sweep waits for the frame to show.
  await host.locator(".anim-figure__frame").evaluate((frame) => frame.scrollIntoView({ block: "center" }));
  await expect.poll(async () => (await probe(page))?.played).toBe(true);
  // The sweep ran over frames: the comb travelled back through depth.
  await expect.poll(() => page.evaluate(() => {
    // @ts-ignore test-only global
    const p = window.__ambeAnim.figures["pitch-search-3d"];
    return p.swept > 0 || p.shown.sweep === Infinity;
  }), { timeout: 15_000 }).toBe(true);
  // At least one frame between its ends (a loaded machine draws few).
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__ambeAnim.figures["pitch-search-3d"].swept)).toBeGreaterThan(0);
  await finish(page);
  await page.waitForTimeout(100);
  const end = await probe(page);
  expect(end.shown).toEqual({ cand: 46, sweep: Infinity });
  expect(end.pose).toEqual({ yaw: 42, pitch: 24 });
  expect((await hook(page)).played["pitch-search"]).toBe(1);
  await expect(host.locator(".anim-chip__text").first()).toHaveText("P = 46 samples: Ψ 44.45");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await settle(page, host);
  expect((await hook(page)).played["pitch-search"]).toBe(1);
});

test("the end state inside the per-view caps; the candidate, the window and the clip move the comb and the chip", async ({ page }) => {
  const host = await open(page);
  const p = await probe(page);
  expect(p.counts.draws).toBeLessThanOrEqual(30);
  expect(p.counts.segments).toBeLessThanOrEqual(30_000);
  const h = await hook(page);
  expect(h.draws["pitch-search"].triangles).toBeLessThanOrEqual(100_000);
  expect(h.tracks["pitch-search"] ?? 0).toBeLessThanOrEqual(3);
  await host.locator('[data-role="cand"]').fill("23");
  await finish(page);
  await expect(host.locator(".anim-chip__text").first()).toHaveText("P = 23 samples: Ψ 34.92, 79% of the score at 46");
  await host.locator('button[data-source="alternate"]').click();
  await host.locator('[data-role="cand"]').fill("92");
  await finish(page);
  await expect(host.locator(".anim-chip__text").first()).toHaveText("P = 92 samples: Ψ 23.66");
  await expect(host.locator(".anim-figure__head .anim-badge")).toHaveText("synthetic");
  await host.locator('button[data-mode="clip"]').click();
  await host.locator('[data-role="row"]').fill("67");
  await finish(page);
  await expect(host.locator(".anim-chip__text").nth(1)).toHaveText("frame 67: tracker 57.3 samples");
  // From the top, the chip sits right of the arrow's head (57.3), clear of
  // the jump and the corridor it leaves (33.5 to 50.2).
  await preset(host, "top");
  const rects = (await front(page)).rects;
  const frameBox = await host.locator(".anim-figure__frame").boundingBox();
  const chipBox = await host.locator(".anim-chip").nth(1).boundingBox();
  if (!frameBox || !chipBox) throw new Error("no frame or chip");
  const head = rects.heat.x + ((57.3 - 21.5) / 93) * rects.heat.width;
  expect(chipBox.x - frameBox.x).toBeGreaterThan(head);
  const clip = await probe(page);
  expect(clip.counts.draws).toBeLessThanOrEqual(30);
  await expect.poll(() => page.locator(CANVAS_3D).getAttribute("aria-label")).toMatch(/frame 67: tracker 57\.3 samples/);
});

test("each step shows the view its data-view names, entered from 3D", async ({ page }) => {
  const host = await open(page);
  const views = await host.locator(".anim-steps > li").evaluateAll((items) => items.map((li) => li.getAttribute("data-view")));
  expect(views.length).toBeGreaterThan(1);
  const output = host.locator(".anim-steps__nav output");
  /** @param {number} i  0-based step; press 3D first, then go to the step from its neighbour */
  const visit = async (i) => {
    if ((await page.locator(TOGGLE).getAttribute("aria-pressed")) !== "true") {
      await page.locator(TOGGLE).click();
      await page.locator(CANVAS_3D).waitFor();
      await settle(page, host);
    }
    // Next from the step before, or Previous from the step after for step 1.
    await host.locator(i > 0 ? '[data-step="next"]' : '[data-step="prev"]').click();
    await expect(output).toHaveText(`Step ${i + 1} of ${views.length}`);
    await settle(page, host);
    if (views[i] === "3d") {
      await expect(page.locator(CANVAS_3D)).toHaveCount(1);
      await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true");
    } else if (views[i] === "2d") {
      await expect(page.locator(CANVAS_3D)).toHaveCount(0);
      await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
      await expect(host.locator("canvas.anim-figure__canvas:not(.anim-figure__canvas--3d)")).toBeVisible();
    }
  };
  // On step 1 now, in 3D: walk forward through every later step.
  for (let i = 1; i < views.length; i += 1) {
    await visit(i);
  }
  // Back to step 2, then into step 1 with Previous, from 3D.
  for (let i = views.length - 1; i > 1; i -= 1) await host.locator('[data-step="prev"]').click();
  await expect(output).toHaveText(`Step 2 of ${views.length}`);
  await visit(0);
});

for (const width of [1280, 375]) {
  test(`at ${width}: every view names its axes and shows the ticks the steps read`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page);
    const shown = () => host.locator(".anim-figure__label:not([hidden])").allTextContents();
    const corner = await shown();
    for (const t of ["lag, samples", "candidate P", "23", "46"]) expect(corner, `corner: ${t}`).toContain(t);
    await preset(host, "front");
    await page.waitForTimeout(100);
    const front = await shown();
    for (const t of ["lag, samples", "0", "100", "200"]) expect(front, `front: ${t}`).toContain(t);
    await preset(host, "side");
    await page.waitForTimeout(100);
    const side = await shown();
    for (const t of ["candidate P", "23", "46", "69", "92", "114"]) expect(side, `side: ${t}`).toContain(t);
    await host.locator('button[data-mode="clip"]').click();
    await preset(host, "top");
    await page.waitForTimeout(100);
    const top = await shown();
    for (const t of ["lag, samples", "time", "22", "46", "114"]) expect(top, `top: ${t}`).toContain(t);
  });
}

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
  expect(requests.filter((u) => PART.test(u))).toEqual([]);
  await page.locator(TOGGLE).click();
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await probe(page))?.builds).toBe(1);
  const p = await probe(page);
  expect(p.played).toBe(false);
  expect(p.shown).toEqual({ cand: 46, sweep: Infinity });
  expect((await hook(page)).played["pitch-search"]).toBeUndefined();
});

test("toggling 3D five times quickly leaves no stray context or overlay", async ({ page }) => {
  await open(page);
  for (let i = 0; i < 5; i += 1) await page.locator(TOGGLE).click();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await page.locator(TOGGLE).click();
  await page.locator(CANVAS_3D).waitFor();
  await page.locator(TOGGLE).click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator(`${HOST} .anim-chip-layer, ${HOST} .anim-figure__overlay`)).toHaveCount(0);
  await expect(page.locator(`${HOST} [role="group"][aria-label="Zoom"]`)).toHaveCount(0);
  await expect(page.locator(`${HOST} canvas.anim-figure__canvas:not(.anim-figure__canvas--3d)`)).toBeVisible();
});

test("context loss: paused, resume rebuilds at the same candidate", async ({ page }) => {
  const host = await open(page);
  await host.locator('[data-role="cand"]').fill("69");
  await finish(page);
  const before = await probe(page);
  await page.locator(CANVAS_3D).evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(host.locator('.anim-figure__frame[data-state="paused"]')).toHaveCount(1);
  await host.locator(".anim-figure__resume").click();
  await expect.poll(async () => (await probe(page)).builds).toBe(before.builds + 1);
  expect((await probe(page)).shown.cand).toBe(69);
  await expect(host.locator(".anim-chip__text").first()).toHaveText(/^P = 69 samples: Ψ /);
});

test("presets and zoom: Side, a zoom, and Front back at 1x", async ({ page }) => {
  const host = await open(page);
  await preset(host, "side");
  await expect(host.locator('button[data-preset="side"]')).toHaveAttribute("aria-pressed", "true");
  await host.getByRole("button", { name: "Zoom in" }).click();
  await finish(page);
  expect((await probe(page)).zoom).toBeCloseTo(1.25, 6);
  await preset(host, "front");
  expect((await probe(page)).zoom).toBe(1);
});

for (const width of [375, 390]) {
  test(`phone, ${width} px: no horizontal scroll, chip and labels inside the frame on every step`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const host = await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // The states the walk-through reads, driven in 3D through free play.
    /** @type {((h: import("@playwright/test").Locator) => Promise<void>)[]} */
    const states = [
      async () => {},
      async (h) => preset(h, "front"),
      async (h) => preset(h, "side"),
      async (h) => { await h.locator('[data-role="cand"]').fill("23"); await preset(h, "corner"); },
      async (h) => { await h.locator('button[data-source="alternate"]').click(); await h.locator('[data-role="cand"]').fill("92"); await preset(h, "front"); },
      async (h) => { await h.locator('button[data-source="fraction"]').click(); await h.locator('[data-role="cand"]').fill("45.6"); },
      async (h) => { await h.locator('button[data-mode="clip"]').click(); await h.locator('[data-role="row"]').fill("67"); await preset(h, "corner"); },
    ];
    for (let step = 1; step <= states.length; step += 1) {
      await states[step - 1](host);
      await finish(page);
      await page.waitForTimeout(100);
      const frame = await host.locator(".anim-figure__frame").boundingBox();
      if (!frame) throw new Error("no frame");
      let chips = 0;
      for (const node of await host.locator(".anim-chip, .anim-figure__label:not([hidden])").all()) {
        const box = await node.boundingBox();
        if (!box || !(await node.isVisible())) continue;
        if (await node.evaluate((n) => n.classList.contains("anim-chip"))) chips += 1;
        expect(box.x, `step ${step}`).toBeGreaterThanOrEqual(frame.x - 0.5);
        expect(box.x + box.width, `step ${step}`).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
        expect(box.y, `step ${step}`).toBeGreaterThanOrEqual(frame.y - 0.5);
        expect(box.y + box.height, `step ${step}`).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
      }
      expect(chips, `step ${step}`).toBe(1);
    }
  });
}

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
