// The tradeoff figure's 3D view (ch03): the opening rule, the morph's end
// state, Front against the block spectrum and Top against the spectrogram,
// the highlight, rebuild on release only, and the view's lifecycle. Every
// step is a flat graph, so the steps keep the figure in 2D; a reader opens
// 3D with the 3D control, and the view takes the step's camera.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const HOST = '[data-anim="tradeoff"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const p = window.__ambeAnim.figures["tradeoff-3d"];
  return p ? { builds: p.builds, pose: p.pose, zoom: p.zoom, played: p.played, morphs: p.morphs, t: p.t, rows: p.rows } : null;
});

/**
 * Press the 3D control as a reader does, and bring the frame back into
 * view: the press scrolls to the control, below the frame, and the view
 * plays only while its frame shows.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 */
const press3D = async (page, host) => {
  await host.locator('[data-ref="view3d"]').click();
  await host.locator(".anim-figure__frame").evaluate((f) => f.scrollIntoView({ block: "center" }));
  await page.locator(CANVAS_3D).waitFor();
};

/**
 * Open the 3D view if it is not open (a step leaves the figure in 2D), and
 * land it on its end state.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 */
const deep = async (page, host) => {
  const toggle = host.locator('[data-ref="view3d"]');
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await press3D(page, host);
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
};

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

/** Move a range and release it, as a reader does. @param {import("@playwright/test").Locator} input @param {string} value */
const release = (input, value) => input.evaluate((el, v) => {
  const range = /** @type {HTMLInputElement} */ (el);
  range.value = v;
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
}, value);

test("nothing 3D is asked for, at the top of the page or near the figure; the 3D control opens it and it morphs once, 5 ms to 20 ms", async ({ page }) => {
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/anim-tradeoff-3d/.test(r.url())) asked.push(r.url()); });
  await page.goto("03-windows-and-frames/");
  await page.locator(`${HOST}.is-enhanced`).waitFor();
  await page.waitForLoadState("networkidle");
  expect(asked).toEqual([]);
  const host = page.locator(HOST);
  await settle(page, host);
  expect(asked).toEqual([]);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await press3D(page, host);
  expect(asked).toHaveLength(1);
  // With the page's other 3D figures near, this view can start after settle()
  // returns; once it has played, land it on its end state.
  await expect.poll(async () => (await hook(page)).played.tradeoff).toBe(1);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const p = await probe(page);
  expect(p).toMatchObject({ played: true, morphs: 1, t: 1, rows: 40, pose: { yaw: 30, pitch: 32 } });
  await expect(host.locator('[data-ref="camera"]')).toBeVisible();
  await expect(host.locator(".anim-chip")).toHaveText("block 20 ms: 1/T = 50 Hz");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label",
    /120 Hz pitch, cut into 20 ms blocks, a strip every 10 ms, 40 strips.* 70 to 80 ms, .* Camera: corner\. Zoom with the buttons/);
});

test("reduced motion: 2D first; the 3D control lands on the end state with no animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await press3D(page, host);
  await settle(page, host);
  expect(await probe(page)).toMatchObject({ played: false, morphs: 0, t: 1, rows: 40 });
  expect((await hook(page)).played.tradeoff).toBeUndefined();
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
  test(`at ${viewport.width}: Front within 1 px of the 2D block spectrum, Top within 1 px of the 2D spectrogram's cells`, async ({ page }) => {
    // Nine morphs and twelve camera flights, on a software renderer.
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto("03-windows-and-frames/");
    const host = page.locator(HOST);
    await settle(page, host);
    await press3D(page, host);
    for (const block of ["2", "0", "5"]) {
      await release(host.locator('[data-ref="block"]'), block);
      await page.evaluate(() => window.__ambeAnim?.finishAll());
      for (const [preset, flatKey, deepKey] of [["front", "plotPoints", "frontPoints"], ["top", "gramPoints", "topPoints"]]) {
        await host.locator(`button[data-preset="${preset}"]`).click();
        await page.evaluate(() => window.__ambeAnim?.finishAll());
        const [flat, deep] = await page.evaluate(([a, b]) => {
          // @ts-ignore test-only global
          const f = window.__ambeAnim.figures;
          return [f.tradeoff[a](), f["tradeoff-3d"][b]()];
        }, [flatKey, deepKey]);
        expect(deep).toHaveLength(flat.length);
        for (let k = 0; k < flat.length; k += 1) {
          expect(Math.abs(deep[k][0] - flat[k][0]), `${preset} x ${k}, block ${block}`).toBeLessThanOrEqual(1);
          expect(Math.abs(deep[k][1] - flat[k][1]), `${preset} y ${k}, block ${block}`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}

test("the block slider rebuilds 3D on release only, morphing; the chip follows; the highlight keeps 3:1", async ({ page }) => {
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await settle(page, host);
  await press3D(page, host);
  const before = (await probe(page))?.morphs ?? 0;
  await host.locator('[data-ref="block"]').evaluate((el) => {
    const range = /** @type {HTMLInputElement} */ (el);
    range.value = "4";
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(host.locator('[data-ref="block-out"]')).toHaveText("80 ms");
  expect((await probe(page))?.morphs).toBe(before);
  await expect(host.locator(".anim-chip")).toHaveText("block 20 ms: 1/T = 50 Hz");
  await host.locator('[data-ref="block"]').dispatchEvent("change");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect(await probe(page)).toMatchObject({ morphs: before + 1, t: 1, rows: 10 });
  await expect(host.locator(".anim-chip")).toHaveText("block 80 ms: 1/T = 12.5 Hz");
  await release(host.locator('[data-ref="block"]'), "5");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await expect(host.locator(".anim-chip")).toHaveText("whole sound as one block: 1/T = 2.5 Hz");
  for (const scheme of ["slate", "default"]) {
    const [hl, bg, stage] = await host.locator(".anim-figure__frame").evaluate((frame, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(frame);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    expect(contrast(hl, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(hl, stage)).toBeGreaterThanOrEqual(3);
  }
});

test("each step sets the pose that frames its subject, and the 3D control shows it: Corner, high over the front three times, Corner", async ({ page }) => {
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await settle(page, host);
  await press3D(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const next = host.locator('.anim-steps__nav [data-step="next"]');
  const high = { yaw: 10, pitch: 62 };
  const want = [
    [high, 160, "block 5 ms: 1/T = 200 Hz", "high over the front"],
    [high, 10, "block 80 ms: 1/T = 12.5 Hz", "high over the front"],
    [high, 80, "block 10 ms: 1/T = 100 Hz", "high over the front"],
    [{ yaw: 30, pitch: 32 }, 1, "whole sound as one block: 1/T = 2.5 Hz", "corner"],
  ];
  for (const [pose, rows, chip, name] of want) {
    await next.click();
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
    await deep(page, host);
    expect(await probe(page)).toMatchObject({ pose, rows, t: 1 });
    await expect(host.locator(".anim-chip")).toHaveText(/** @type {string} */ (chip));
    await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", new RegExp(`Camera: ${name}\\.`));
    // A pose with no button presses none; Corner presses its own.
    for (const preset of ["corner", "front", "top"]) {
      await expect(host.locator(`button[data-preset="${preset}"]`)).toHaveAttribute("aria-pressed", String(name === preset));
    }
  }
});

test("high over the front every strip is surface; the click bracket shows at 80 ms, as a span, and not at 5 ms or as one block; Reset view comes back to the pose", async ({ page }) => {
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await settle(page, host);
  await press3D(page, host);
  const next = host.locator('.anim-steps__nav [data-step="next"]');
  const read = () => page.evaluate(() => {
    // @ts-ignore test-only global
    const p = window.__ambeAnim.figures["tradeoff-3d"];
    return { surface: p.surfaceRows, rows: p.rows, click: p.clickBracket() };
  });
  await next.click();
  await deep(page, host);
  expect(await read()).toEqual({ surface: 160, rows: 160, click: null });
  await expect(page.locator(CANVAS_3D)).not.toHaveAttribute("aria-label", /bracket/);
  await next.click();
  await deep(page, host);
  const h = await read();
  expect(h.surface).toBe(10);
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  for (const [x, y] of h.click) {
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(frame?.width ?? 0);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(frame?.height ?? 0);
  }
  // 200 to 280 ms reads as a span on screen, not a mark.
  expect(Math.hypot(h.click[1][0] - h.click[0][0], h.click[1][1] - h.click[0][1])).toBeGreaterThan(30);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /a bracket by the time axis spans the strips holding the click, 200 to 280 ms\./);
  await page.locator(CANVAS_3D).dragTo(page.locator(CANVAS_3D), { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 260, y: 220 } });
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page))?.pose).not.toMatchObject({ yaw: 10, pitch: 62 });
  await host.getByRole("button", { name: "Reset view" }).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page))?.pose).toMatchObject({ yaw: 10, pitch: 62 });
  for (let k = 0; k < 2; k += 1) await next.click();
  await deep(page, host);
  expect((await read()).click).toBeNull();
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`at ${viewport.width}, at every step: the chip covers neither the outlined spectrum nor a label, and the level axis is named left of its axis or above it`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("03-windows-and-frames/");
    const host = page.locator(HOST);
    await settle(page, host);
    await press3D(page, host);
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    const next = host.locator('.anim-steps__nav [data-step="next"]');
    for (let step = 1; step <= 5; step += 1) {
      if (step > 1) {
        await next.click();
        await deep(page, host);
      }
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const got = await host.locator(".anim-figure__frame").evaluate((frame) => {
        const origin = frame.getBoundingClientRect();
        /** @param {Element} el */
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top };
        };
        const labels = [...frame.querySelectorAll(".anim-figure__label")]
          .filter((n) => !(/** @type {HTMLElement} */ (n).hidden) && n.checkVisibility({ visibilityProperty: true }))
          .map((n) => ({ text: n.textContent, ...box(n) }));
        // @ts-ignore test-only global
        const curve = window.__ambeAnim.figures["tradeoff-3d"].frontPoints();
        return { chip: box(/** @type {Element} */ (frame.querySelector(".anim-chip"))), labels, curve };
      });
      const { chip } = got;
      for (const [x, y] of got.curve) {
        expect(x > chip.left && x < chip.right && y > chip.top && y < chip.bottom, `step ${step}: curve point ${x}, ${y} under the chip`).toBe(false);
      }
      for (const l of got.labels) {
        const over = l.left < chip.right && l.right > chip.left && l.top < chip.bottom && l.bottom > chip.top;
        expect(over, `step ${step}: "${l.text}" under the chip`).toBe(false);
      }
      const title = got.labels.find((l) => l.text === "level (dB)");
      expect(title, `step ${step}: level (dB)`).toBeTruthy();
      const floor = got.labels.find((l) => l.text === "-60");
      expect(floor, `step ${step}: -60`).toBeTruthy();
      if (step >= 2 && step <= 4) {
        // High over the front the surface stands right of the axis: the name keeps left of it.
        expect(title?.right ?? Infinity).toBeLessThanOrEqual((floor?.right ?? 0) + 1);
      }
    }
  });
}

test("toggle 3D five times quickly: no stray context, chip or label layer", async ({ page }) => {
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await settle(page, host);
  await press3D(page, host);
  const toggle = host.locator('[data-ref="view3d"]');
  for (let k = 0; k < 5; k += 1) {
    await toggle.click();
    await toggle.click();
  }
  await toggle.click();
  await page.waitForTimeout(500);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator(".anim-figure__overlay")).toHaveCount(0);
  await expect(host.locator(".anim-figure__canvas").first()).toBeVisible();
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await expect(host.locator(".anim-chip")).toHaveCount(1);
});

test("context loss pauses; resume rebuilds on the same block", async ({ page }) => {
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await settle(page, host);
  // The first view ends on 20 ms: let it end before the slider moves.
  await deep(page, host);
  await release(host.locator('[data-ref="block"]'), "3");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const before = (await probe(page))?.builds ?? 0;
  await page.locator(CANVAS_3D).evaluate((c) => {
    const gl = /** @type {HTMLCanvasElement} */ (c).getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  const frame = host.locator(".anim-figure__frame");
  await expect(frame).toHaveAttribute("data-state", "paused");
  await frame.locator(".anim-figure__resume").click();
  await expect(frame).not.toHaveAttribute("data-state", "paused");
  await expect.poll(async () => (await probe(page))?.builds).toBe(before + 1);
  await expect(host.locator(".anim-chip")).toHaveText("block 40 ms: 1/T = 25 Hz");
  expect((await probe(page))?.rows).toBe(20);
});

/** Visible flat labels by data-ref: their centres, CSS px in the frame. @param {import("@playwright/test").Page} page */
const flatLabels = (page) => page.locator(`${HOST} .anim-figure__frame`).evaluate((frame) => {
  const box = frame.getBoundingClientRect();
  /** @type {Record<string, {x: number, y: number, text: string}>} */
  const out = {};
  for (const node of frame.querySelectorAll(".anim-figure__label[data-ref]")) {
    const el = /** @type {HTMLElement} */ (node);
    if (el.hidden || !el.checkVisibility({ visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    out[el.dataset.ref ?? ""] = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, text: el.textContent ?? "" };
  }
  return out;
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
  test(`at ${viewport.width}: Top labels time as the 2D spectrogram does, each centred on its tick, and Front labels the spectrum's frequencies`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("03-windows-and-frames/");
    const host = page.locator(HOST);
    await settle(page, host);
    await press3D(page, host);
    // A block in the second vowel: its loudest peak, and so the chip, sits
    // away from the time axis (an end value under the chip yields to it).
    await release(host.locator('[data-ref="at"]'), "300");
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    for (const preset of ["top", "front"]) {
      await host.locator(`button[data-preset="${preset}"]`).click();
      await page.evaluate(() => window.__ambeAnim?.finishAll());
      await expect.poll(async () => (await probe(page))?.pose?.pitch).toBe(preset === "top" ? 90 : 0);
      await page.waitForTimeout(100);
      const labels = await flatLabels(page);
      const ticks = await page.evaluate(() => {
        // @ts-ignore test-only global
        const pts = window.__ambeAnim.figures.tradeoff.gramPoints();
        return pts;
      });
      // gramPoints: every strip edge, 5 columns each; at 20 ms, strips 10 ms apart, every 4th edge row.
      const rows = /** @type {number[]} */ ([...new Set(ticks.map((/** @type {[number, number]} */ p) => p[1]))]);
      const yOf = (/** @type {number} */ ms) => rows[0] + ((rows[rows.length - 1] - rows[0]) * ms) / 400;
      for (const t of [0, 100, 200, 300, 400]) {
        const label = labels[`time-${t}`];
        expect(label, `${preset}: time ${t}`).toBeTruthy();
        expect(label.text).toBe(String(t));
        expect(Math.abs(label.y - yOf(t)), `${preset}: time ${t}`).toBeLessThanOrEqual(2);
      }
      expect(Math.abs(labels["part-230"].y - yOf(230))).toBeLessThanOrEqual(2);
      expect(labels["part-230"].text).toBe("click");
      for (const hz of [0, 500, 1000, 1500, 2000]) expect(labels[`hz-${hz}`], `${preset}: ${hz} Hz`).toBeTruthy();
      // The frequency ticks sit below the time axis's last label.
      expect(labels["hz-2000"].y).toBeGreaterThan(labels["time-400"].y + 20);
      await expect(host.locator(".anim-figure__label", { hasText: /^-60$/ }).filter({ visible: true })).toHaveCount(1);
    }
  });
}

test("the 3D view's labels and chip stay hidden while the 2D canvas still shows", async ({ page }) => {
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await host.locator(".anim-figure__canvas").first().waitFor();
  await page.evaluate((h) => {
    const w = /** @type {any} */ (window);
    w.__overlap = 0;
    w.__frames = 0;
    const tick = () => {
      const frame = document.querySelector(`${h} .anim-figure__frame`);
      const flat = frame?.querySelector("canvas.anim-figure__canvas:not(.anim-figure__canvas--3d)");
      if (flat && !(/** @type {HTMLElement} */ (flat)).hidden) {
        w.__frames += 1;
        for (const node of frame?.querySelectorAll(".anim-figure__label, .anim-chip") ?? []) {
          const el = /** @type {HTMLElement} */ (node);
          if (!el.hidden && el.checkVisibility({ visibilityProperty: true })) w.__overlap += 1;
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  }, HOST);
  await settle(page, host);
  await press3D(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const [overlap, frames] = await page.evaluate(() => [/** @type {any} */ (window).__overlap, /** @type {any} */ (window).__frames]);
  expect(frames).toBeGreaterThan(0);
  expect(overlap).toBe(0);
  await expect(host.locator(".anim-chip")).toBeVisible();
});

test("step 1 shows the 20 ms picture in 2D; the first 3D view ends at the corner on 20 ms, and 2D comes back on it", async ({ page }) => {
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await settle(page, host);
  expect(await page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures.tradeoff.drawnBlock();
  })).toBe(20);
  await press3D(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect(await probe(page)).toMatchObject({ t: 1, rows: 40, pose: { yaw: 30, pitch: 32 } });
  await host.locator('[data-ref="view3d"]').click();
  expect(await page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures.tradeoff.drawnBlock();
  })).toBe(20);
});

test("Zoom in zooms toward the chip's anchor on the outlined spectrum, which stays in the frame", async ({ page }) => {
  await page.goto("03-windows-and-frames/");
  const host = page.locator(HOST);
  await settle(page, host);
  await press3D(page, host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const focus = () => page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures["tradeoff-3d"].focus();
  });
  const before = await focus();
  const zoomIn = host.locator('button[data-zoom="in"]');
  for (let k = 0; k < 5; k += 1) {
    await zoomIn.click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
  }
  expect((await probe(page))?.zoom).toBeCloseTo(1.25 ** 5, 2);
  const after = await focus();
  expect(Math.abs(after[0] - before[0])).toBeLessThanOrEqual(2);
  expect(Math.abs(after[1] - before[1])).toBeLessThanOrEqual(2);
  await expect(host.locator(".anim-chip-layer--pinned")).toHaveCount(0);
});
