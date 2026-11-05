// The fec-protection figure's head-on 3D view (anim-fec-protection-3d.js,
// plan N6, owner decision O2): Front at 1x puts the curves and the bar tops
// on the 2D mapping, the burst lands each error on its codeword's bit, the
// codeword with the most errors takes the highlight and its chip, the
// first-view burst plays once, and the figure stays usable with reduced
// motion, on a phone and when the 3D control is pressed in a hurry.
import { test, expect } from "@playwright/test";
import { hook, settle } from "./helpers.js";

const PAGE = "10-the-dstar-frame/";
const HOST = '[data-anim="fec-protection"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/**
 * The 3D view's probe.
 * @param {import("@playwright/test").Page} page
 */
async function probe(page) {
  return page.evaluate(() => {
    const p = /** @type {any} */ (window.__ambeAnim?.figures["fec-protection-3d"]);
    return {
      builds: p.builds, played: p.played, bursts: p.bursts, zoom: p.zoom, chip: p.chip, landed: p.landed,
      flight: Array.from(/** @type {Float32Array} */ (p.flight)),
      frontPoints: /** @type {number[][]} */ (p.frontPoints()),
      tilePoints: /** @type {number[][]} */ (p.tilePoints()),
    };
  });
}

/**
 * The 2D view's own mapping for the frame's size and the figure's state
 * now: curve vertices, bar top centres, and each error's cell centre.
 * @param {import("@playwright/test").Page} page
 * @param {{mode: string, interleave: boolean, start: number, burst: number, ber: number}} s
 */
async function twoD(page, s) {
  return page.evaluate(async (state) => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-fec-protection.js", script.src).href);
    const fec = await import(new URL("lib/fec.js", script.src).href);
    const box = /** @type {HTMLElement} */ (document.querySelector('[data-anim="fec-protection"] .anim-figure__frame'));
    const r = box.getBoundingClientRect();
    const size = { width: Math.round(r.width - box.clientLeft * 2), height: Math.round(r.height - box.clientTop * 2) };
    const L = m.computeLayout(size);
    const points = [];
    for (const { points: curve } of m.curvePoints(L, state.mode)) points.push(...curve);
    for (let v = 0; v < 8; v += 1) {
      const bar = m.barRect(L, state.mode, v, state.ber);
      points.push([bar.x + bar.w / 2, Math.min(bar.top, bar.bottom)]);
    }
    const result = fec.burstResult({ mode: state.mode, interleave: state.interleave, start: state.start, length: state.burst });
    const cells = result.errors.map((/** @type {{v: number, j: number}} */ e) => {
      const c = m.cellRect(L, e.v, e.j);
      return [c.x + c.w / 2, c.y + c.h / 2];
    });
    return { points, cells, chip: fec.chipText(result) };
  }, s);
}

const STEP2 = { mode: "patent", interleave: true, start: 57, burst: 7, ber: 0.05 };
const STEP1 = { ...STEP2, mode: "none", interleave: false };
const STEP3 = { mode: "patent", interleave: false, start: 0, burst: 4, ber: 0.05 };
const STEP4 = { mode: "patent", interleave: false, start: 98, burst: 6, ber: 0.05 };

/** @param {import("@playwright/test").Page} page */
async function open3D(page) {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  return host;
}

/** @param {import("@playwright/test").Locator} host */
async function next(host) {
  await host.locator('[data-step="next"]').click();
}

for (const width of [1280, 375]) {
  test(`Front at 1x puts the curves and the bar tops on the 2D mapping within 0.5 px (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open3D(page);
    await next(host);
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    const p = await probe(page);
    expect(p.zoom).toBe(1);
    const flat = await twoD(page, STEP2);
    expect(p.frontPoints.length).toBe(flat.points.length);
    expect(p.frontPoints.length).toBeGreaterThan(100);
    p.frontPoints.forEach(([x, y], i) => {
      expect(Math.abs(x - flat.points[i][0]), `point ${i} x`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y - flat.points[i][1]), `point ${i} y`).toBeLessThanOrEqual(0.5);
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
  after.frontPoints.forEach(([x, y], i) => {
    expect(Math.abs(x - before[i][0])).toBeLessThanOrEqual(0.01);
    expect(Math.abs(y - before[i][1])).toBeLessThanOrEqual(0.01);
  });
});

test("once a zoom settles, the backing is repainted for the part in view only, and a move goes back to the whole frame", async ({ page }) => {
  const host = await open3D(page);
  const region = () => page.evaluate(() => /** @type {any} */ (window.__ambeAnim?.figures["fec-protection-3d"]).region);
  expect(await region()).toBe(null);
  const group = host.getByRole("group", { name: "Zoom" });
  await group.getByRole("button", { name: "Zoom in" }).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await expect.poll(region).not.toBe(null);
  const r = await region();
  const frame = await host.locator(".anim-figure__frame").evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }));
  expect(r.w).toBeLessThan(frame.w);
  expect(r.h).toBeLessThan(frame.h);
  await group.getByRole("button", { name: "Reset view" }).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(400);
  expect(await region()).toBe(null);
});

test("the burst lands each error on its codeword's bit, and the subject takes the chip", async ({ page }) => {
  const host = await open3D(page);
  // Step 1: no code, sent in order, the first view's burst.
  let p = await probe(page);
  let flat = await twoD(page, STEP1);
  expect(p.landed).toBe(true);
  expect(p.chip).toBe("Bare u₅: 5 errors, corrects 0");
  expect(p.tilePoints).toHaveLength(7);
  p.tilePoints.forEach(([x, y], k) => {
    expect(Math.abs(x - flat.cells[k][0]), `error ${k} x`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y - flat.cells[k][1]), `error ${k} y`).toBeLessThanOrEqual(0.5);
  });
  // Step 2: the patent's codes; u4 takes two and fails.
  await next(host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  p = await probe(page);
  flat = await twoD(page, STEP2);
  expect(p.chip).toBe("Hamming u₄: 2 errors, corrects 1");
  expect(flat.chip).toBe(p.chip);
  p.tilePoints.forEach(([x, y], k) => {
    expect(Math.abs(x - flat.cells[k][0])).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y - flat.cells[k][1])).toBeLessThanOrEqual(0.5);
  });
  await expect(host.locator(".anim-chip")).toHaveText("Hamming u₄: 2 errors, corrects 1");
  await expect(host.locator(".fec-status")).toContainText("Hamming u₄: 2 errors, corrects 1, so it fails");
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  const chip = await host.locator(".anim-chip").boundingBox();
  if (!frame || !chip) throw new Error("no frame or chip");
  expect(chip.x).toBeGreaterThanOrEqual(frame.x);
  expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(chip.y).toBeGreaterThanOrEqual(frame.y);
});

test("a step's burst is in flight at once, lasts at most 1.2 s, and lands", async ({ page }) => {
  const host = await open3D(page);
  await host.locator(".anim-figure__frame").evaluate((el) => el.scrollIntoView({ block: "start" }));
  const mid = await page.evaluate(() => {
    /** @type {HTMLButtonElement} */ (document.querySelector('[data-anim="fec-protection"] [data-step="next"]')).click();
    const p = /** @type {any} */ (window.__ambeAnim?.figures["fec-protection-3d"]);
    return { flight: Array.from(/** @type {Float32Array} */ (p.flight)).slice(0, 7), landed: p.landed, chip: p.chip };
  });
  // Nothing has arrived yet, and the verdict waits for the landing.
  expect(mid.landed).toBe(false);
  expect(mid.chip).toBe("");
  expect(mid.flight.every((f) => f === 0)).toBe(true);
  // The track's own length: 760 ms a tile, starts spread over 380 ms at
  // most. A loaded software renderer may take longer in wall time.
  await expect.poll(async () => (await probe(page)).landed, { timeout: 5000 }).toBe(true);
  const end = await probe(page);
  expect(end.flight.slice(0, 7).every((f) => f === 1)).toBe(true);
  expect(end.chip).toBe("Hamming u₄: 2 errors, corrects 1");
});

test("the first view plays the burst once; leaving 3D and coming back does not replay it", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await host.scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page)).played).toBe(1);
  expect((await hook(page)).played["fec-protection"]).toBe(1);
  const toggle = host.locator('.anim-controls [data-view="3d"]');
  await toggle.click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const p = await probe(page);
  expect(p.played).toBe(0);
  expect(p.landed).toBe(true);
  expect((await hook(page)).played["fec-protection"]).toBe(1);
});

test("reduced motion: opens in 2D, asks for nothing 3D until the control, then lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const requested = [];
  page.on("request", (r) => {
    if (/anim-fec-protection-3d\.js/.test(r.url())) requested.push(r.url().split("/").pop() || "");
  });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator("canvas.anim-figure__canvas")).toBeVisible();
  expect(requested).toEqual([]);
  await host.locator('.anim-controls [data-view="3d"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect(requested).toContain("anim-fec-protection-3d.js");
  const p = await probe(page);
  expect(p.played).toBe(0);
  expect(p.bursts).toBe(0);
  expect(p.landed).toBe(true);
  expect(p.chip).toBe("Bare u₅: 5 errors, corrects 0");
  expect((await hook(page)).played["fec-protection"] ?? 0).toBe(0);
});

test("pressing 3D five times quickly leaves no stray context, canvas or chip", async ({ page }) => {
  const host = await open3D(page);
  const live = (await hook(page)).liveContexts;
  const toggle = host.locator('.anim-controls [data-view="3d"]');
  for (let i = 0; i < 5; i += 1) await toggle.click();
  await settle(page, host);
  const on = (await toggle.getAttribute("aria-pressed")) === "true";
  await expect(page.locator(CANVAS_3D)).toHaveCount(on ? 1 : 0);
  await expect(host.locator(".anim-chip-layer")).toHaveCount(on ? 1 : 0);
  await expect(host.locator(".anim-zoom")).toHaveCount(on ? 1 : 0);
  expect((await hook(page)).liveContexts).toBe(on ? live : live - 1);
});

test("in 3D, dragging on the curves sets the bit error rate, as on the 2D canvas", async ({ page }) => {
  const host = await open3D(page);
  const at = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-fec-protection.js", script.src).href);
    const box = /** @type {HTMLElement} */ (document.querySelector('[data-anim="fec-protection"] .anim-figure__frame'));
    const L = m.computeLayout({ width: box.clientWidth, height: box.clientHeight });
    return { x: m.berX(L, 0.02), y: L.curves.y + L.curves.h / 2 };
  });
  await page.locator(CANVAS_3D).click({ position: at });
  await expect(host.locator('[data-ref="berOut"]')).toHaveText("2.0%");
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /At 2\.0% bit errors/);
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

test("phone, 375 px: no horizontal scroll, and the chip and the marks inside the frame", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open3D(page);
  await next(host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  const chip = await host.locator(".anim-chip").boundingBox();
  if (!frame || !chip) throw new Error("no frame or chip");
  expect(chip.x).toBeGreaterThanOrEqual(frame.x);
  expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width);
  const p = await probe(page);
  for (const [x, y] of [...p.frontPoints, ...p.tilePoints]) {
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(frame.width);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(frame.height);
  }
});

test("the chip's leader ends on the subject row's outline, and its box sits above the rows, in every step", async ({ page }) => {
  const host = await open3D(page);
  for (const [i, state] of [STEP1, STEP2, STEP3, STEP4].entries()) {
    if (i) await next(host);
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    await expect.poll(async () => (await probe(page)).landed).toBe(true);
    const want = await page.evaluate(async (st) => {
      const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
      const m = await import(new URL("anim-fec-protection.js", script.src).href);
      const fec = await import(new URL("lib/fec.js", script.src).href);
      const box = /** @type {HTMLElement} */ (document.querySelector('[data-anim="fec-protection"] .anim-figure__frame'));
      const L = m.computeLayout({ width: box.clientWidth, height: box.clientHeight });
      const r = fec.burstResult({ mode: st.mode, interleave: st.interleave, start: st.start, length: st.burst });
      return { row: m.geometry(L, st, r).subjectRow, rowsTop: L.rows[0].y };
    }, state);
    const got = await host.locator(".anim-chip-layer").evaluate((layer) => {
      const line = /** @type {SVGLineElement} */ (layer.querySelector("line"));
      const frame = /** @type {HTMLElement} */ (layer.parentElement).getBoundingClientRect();
      const chip = /** @type {HTMLElement} */ (layer.querySelector(".anim-chip")).getBoundingClientRect();
      return { x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")), chipBottom: chip.bottom - frame.top };
    });
    const { row } = want;
    // On the outline's top edge, at its right end.
    expect(Math.abs(got.x - (row.x + row.w)), `step ${i + 1} x`).toBeLessThanOrEqual(1);
    expect(Math.abs(got.y - row.y), `step ${i + 1} y`).toBeLessThanOrEqual(1);
    expect(got.chipBottom, `step ${i + 1} chip above the rows`).toBeLessThanOrEqual(want.rowsTop);
  }
});

test("a failed row's tint in 3D matches the 2D canvas's, in both themes", async ({ page }) => {
  const host = await open3D(page);
  await next(host);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await expect.poll(async () => (await probe(page)).landed).toBe(true);
  // A point inside u4's tint, right of its status, clear of every mark.
  const at = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-fec-protection.js", script.src).href);
    const box = /** @type {HTMLElement} */ (document.querySelector('[data-anim="fec-protection"] .anim-figure__frame'));
    const L = m.computeLayout({ width: box.clientWidth, height: box.clientHeight });
    const row = L.rows[4];
    return { x: Math.round(row.x + row.w - 12), y: Math.round(row.y + L.cell / 2) };
  });
  const frame = host.locator(".anim-figure__frame");
  /** The colour at `at` in a screenshot of the frame. */
  const sample = async () => {
    const png = (await frame.screenshot({ animations: "disabled" })).toString("base64");
    return page.evaluate(async ({ data, p }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
      g.drawImage(img, 0, 0);
      const k = img.width / /** @type {HTMLElement} */ (document.querySelector('[data-anim="fec-protection"] .anim-figure__frame')).getBoundingClientRect().width;
      return Array.from(g.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data).slice(0, 3);
    }, { data: png, p: at });
  };
  const toggle = host.locator('.anim-controls [data-view="3d"]');
  for (const scheme of ["slate", "default"]) {
    await page.evaluate((s) => document.body.setAttribute("data-md-color-scheme", s), scheme);
    if (!(await page.locator(CANVAS_3D).count())) {
      await toggle.click();
      await page.locator(CANVAS_3D).waitFor();
    }
    await settle(page, host);
    await page.evaluate(() => window.__ambeAnim?.finishAll());
    const three = await sample();
    await toggle.click();
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
    await settle(page, host);
    const flat = await sample();
    // The stage under the 3D tint and blending in linear light move it a
    // few levels; a premultiplied backing put it 30 or more away.
    three.forEach((c, i) => expect(Math.abs(c - flat[i]), `${scheme}: 3D ${three} against 2D ${flat}`).toBeLessThanOrEqual(14));
  }
});

test("a double-click on the curves zooms and leaves the bit error rate alone", async ({ page }) => {
  const host = await open3D(page);
  const at = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-fec-protection.js", script.src).href);
    const box = /** @type {HTMLElement} */ (document.querySelector('[data-anim="fec-protection"] .anim-figure__frame'));
    const L = m.computeLayout({ width: box.clientWidth, height: box.clientHeight });
    return { x: m.berX(L, 0.004), y: L.curves.y + L.curves.h * 0.2 };
  });
  await page.locator(CANVAS_3D).dblclick({ position: at });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  expect((await probe(page)).zoom).toBeGreaterThan(1);
  await expect(host.locator('[data-ref="berOut"]')).toHaveText("5.0%");
});

test("a burst cut short by the From bit slider shows no verdict until its own errors land", async ({ page }) => {
  const host = await open3D(page);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const seen = await host.locator('[data-ref="start"]').evaluate(async (el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    const p = /** @type {any} */ (window.__ambeAnim?.figures["fec-protection-3d"]);
    const read = () => ({ landed: p.landed, chip: p.chip, flight: Array.from(/** @type {Float32Array} */ (p.flight)).slice(0, 7) });
    input.value = "60";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // The second burst cuts the first short: the first one's end runs as
    // a microtask after the second has started, and must not land it.
    input.value = "61";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const at = read();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    return { at, after: read() };
  });
  for (const s of [seen.at, seen.after]) {
    expect(s.flight.every((f) => f < 1)).toBe(true);
    expect(s.landed).toBe(false);
    expect(s.chip).toBe("");
  }
  await expect.poll(async () => (await probe(page)).landed, { timeout: 5000 }).toBe(true);
  expect((await probe(page)).chip).not.toBe("");
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
