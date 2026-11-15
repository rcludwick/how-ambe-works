// The harmonics figure's 3D view (plan F9; three-everywhere design §4.9):
// Front equals the flat comb panel, the pose fades, the first-view
// animation (the comb sweeps from 400 Hz back to 60 Hz) and its end state,
// the opening rule, the steps on ch07, the badge in the title row, and the
// phone layout. L and the voice gap are computed from the JSON here, never
// pinned.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { hook, settle } from "./helpers.js";

const CH07 = "07-multi-band-excitation/";
const HOST = '[data-anim="harmonics"]';
const CANVAS_3D = "canvas.anim-figure__canvas--3d";

/** Median orig_f0_hz over frames at confidence 0.5 or more, as the figure takes it. @param {string} clip */
function median(clip) {
  const { frames } = JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/frames.json`, import.meta.url), "utf8"));
  const f0s = frames.map((/** @type {any} */ f) => f.derived)
    .filter((/** @type {any} */ d) => d.orig_f0_hz > 0 && d.orig_f0_confidence >= 0.5)
    .map((/** @type {any} */ d) => d.orig_f0_hz)
    .sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
  const mid = f0s.length >> 1;
  return f0s.length % 2 ? f0s[mid] : (f0s[mid - 1] + f0s[mid]) / 2;
}
const L = (/** @type {number} */ f0) => Math.floor(3700 / f0);

/** @param {import("@playwright/test").Page} page */
const probe = async (page) => /** @type {any} */ ((await hook(page)).figures["harmonics-3d"]);

/**
 * Open a page with motion allowed and wait for the 3D view, on its end state.
 * On ch07 the first step asks for 2D, so the 3D control opens it; the index
 * page has no steps and opens in 3D on its own.
 * @param {import("@playwright/test").Page} page
 * @param {string} [path]
 */
async function open3D(page, path = CH07) {
  await page.goto(path);
  const host = page.locator(HOST).first();
  await host.scrollIntoViewIfNeeded();
  await settle(page, host);
  if ((await host.locator(CANVAS_3D).count()) === 0) {
    await host.locator('.anim-controls button[data-view="3d"]').click();
  }
  await host.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  return host;
}

/**
 * Press a preset and land it.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 * @param {string} name
 */
async function preset(page, host, name) {
  await host.locator(`button[data-preset="${name}"]`).click();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(100);
}

for (const width of [1280, 375]) {
  test(`at ${width} px, Front puts every stem on the flat comb's x within 0.5 px, and hides the depth`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open3D(page);
    await preset(page, host, "front");
    const h = await hook(page);
    const flat = /** @type {any} */ (h.figures.harmonics);
    const p = await probe(page);
    expect(p.zoom).toBe(1);
    expect(p.pose).toEqual({ yaw: 0, pitch: 0 });
    expect(p.frontPoints).toHaveLength(L(flat.pitch));
    for (const [hz, x] of p.frontPoints) {
      const want = flat.plot.left + (hz / 4000) * (flat.plot.right - flat.plot.left);
      expect(Math.abs(x - want), `${hz} Hz`).toBeLessThanOrEqual(0.5);
    }
    // The fades that belong to Front are all the way down there.
    expect(p.fades.front).toBe(0);
    await preset(page, host, "side");
    expect((await probe(page)).fades.side).toBe(0);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.evaluate(() => document.body.clientWidth));
  });
}

test("opens in 3D and plays the sweep once: it lands on the corner pose at the reader's pitch, with the chip stating L", async ({ page }) => {
  // The index page: on ch07 the first step asks for 2D.
  await page.goto("");
  const host = page.locator(HOST).first();
  // Nothing 3D is asked for before the figure comes near.
  expect((await hook(page)).figures["harmonics-3d"]).toBeUndefined();
  await host.scrollIntoViewIfNeeded();
  await host.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const p = await probe(page);
  expect(p.played).toBe(true);
  expect(p.pose).toEqual({ yaw: -36, pitch: 24 });
  expect((await hook(page)).played.harmonics).toBe(1);
  await expect(host.locator(".anim-chip__text:visible")).toHaveText(`f₀ 120 Hz: L = ${L(120)} harmonics`);
  await expect(host.locator('button[data-preset="corner"]')).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator(".harmonics-strip")).toBeVisible();
  // Leaving 3D and coming back does not replay it.
  const toggle = host.locator('.anim-controls button[data-view="3d"]');
  await toggle.click();
  await expect(host.locator(CANVAS_3D)).toHaveCount(0);
  await toggle.click();
  await host.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect((await probe(page)).played).toBe(false);
  expect((await hook(page)).played.harmonics).toBe(1);
});

test("mid-sweep, the highlighted comb has moved back from 400 Hz and the chip counts its harmonics", async ({ page }) => {
  await page.goto("");
  // A long build (a 20 s sweep), so the test can catch it midway.
  await page.evaluate(() => document.body.style.setProperty("--ambe-dur-3d-build", "6000ms"));
  const host = page.locator(HOST).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator(CANVAS_3D).waitFor();
  const chip = host.locator(".anim-chip__text:visible").first();
  const f0Of = async () => Number(/f₀ ([\d.]+) Hz/.exec((await chip.textContent()) ?? "")?.[1] ?? 400);
  // The camera turns first; then the sweep moves the comb back.
  await expect.poll(f0Of, { timeout: 15_000 }).toBeLessThan(380);
  const text = await chip.textContent();
  const match = /f₀ (\d+) Hz: L = (\d+) harmonics/.exec(text ?? "");
  expect(match).not.toBeNull();
  const f0 = Number(match?.[1]);
  expect(f0).toBeLessThan(380);
  expect(f0).toBeGreaterThan(60);
  expect(Math.abs(Number(match?.[2]) - L(f0))).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await expect(host.locator(".anim-chip__text:visible")).toHaveText(`f₀ 120 Hz: L = ${L(120)} harmonics`);
});

test("under reduced motion it opens in 2D, asks for nothing 3D, and the 3D control lands on the end state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  /** @type {string[]} */
  const asked = [];
  page.on("request", (r) => { if (/harmonics-3d|vendor\/three/.test(r.url())) asked.push(r.url()); });
  await page.goto(CH07);
  const host = page.locator(HOST).first();
  await settle(page, host);
  await expect(host.locator(CANVAS_3D)).toHaveCount(0);
  expect(asked).toEqual([]);
  await host.locator('.anim-controls button[data-view="3d"]').click();
  await host.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  const p = await probe(page);
  expect(p.played).toBe(false);
  expect(p.pose).toEqual({ yaw: -36, pitch: 24 });
});

test("pressing 3D five times quickly leaves one canvas or none, and no stray overlay", async ({ page }) => {
  const host = await open3D(page);
  const toggle = host.locator('.anim-controls button[data-view="3d"]');
  for (let i = 0; i < 5; i += 1) await toggle.click();
  await settle(page, host);
  const on = (await toggle.getAttribute("aria-pressed")) === "true";
  await expect(host.locator(CANVAS_3D)).toHaveCount(on ? 1 : 0);
  await expect(host.locator(".anim-chip:visible")).toHaveCount(on ? 1 : 0);
  expect((await hook(page)).liveContexts).toBeLessThanOrEqual(on ? 2 : 1);
});

test("the steps on ch07: one pitch in 2D, every pitch in 3D, then back to 2D; the voice gap comes from the JSON", async ({ page }) => {
  await page.goto(CH07);
  const host = page.locator(HOST).first();
  await host.scrollIntoViewIfNeeded();
  await settle(page, host);
  const toggle = host.locator('.anim-controls button[data-view="3d"]');
  // Step 1: the flat comb.
  await expect(host.locator(CANVAS_3D)).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(host.locator('[data-role="readout"]')).toHaveText(`120 Hz · L = ${L(120)}`);
  // Step 2: 3D at Corner.
  await host.locator('[data-step="next"]').click();
  await host.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await host.locator('[data-role="pitch"]').evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = "60";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(page, host);
  await expect(host.locator(".anim-chip__text:visible")).toHaveText(`f₀ 60 Hz: L = ${L(60)} harmonics`);
  // Step 3: back to the flat comb.
  await host.locator('[data-step="next"]').click();
  await settle(page, host);
  await expect(host.locator(CANVAS_3D)).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const male = median("lr-b");
  const female = median("lj-b");
  await host.locator('[data-voice="lr"]').click();
  await settle(page, host);
  // A snapped median keeps its tenth, so L = floor(3700 / f0) checks against it.
  await expect(host.locator('[data-role="readout"]')).toHaveText(`${male.toFixed(1)} Hz · L = ${L(male)}`);
  await expect(host.locator('[data-role="delta"]')).toContainText(`${Math.abs(L(male) - L(female))} fewer amplitudes`);
  await host.locator('[data-voice="lj"]').click();
  await settle(page, host);
  await expect(host.locator('[data-role="readout"]')).toHaveText(`${female.toFixed(1)} Hz · L = ${L(female)}`);
});

test("with ?nowebgl the step that asks for 3D stays in 2D and reads correctly there", async ({ page }) => {
  await page.goto(`${CH07}?nowebgl`);
  const host = page.locator(HOST).first();
  await settle(page, host);
  await host.locator('[data-step="next"]').click();
  await settle(page, host);
  await expect(host.locator(CANVAS_3D)).toHaveCount(0);
  await expect(host.locator(".anim-figure__canvas")).toBeVisible();
  await expect(host.locator(".anim-figure__canvas")).toHaveAttribute("aria-label", /harmonic comb from 0 to 4 kHz/);
  await host.locator('[data-step="next"]').click();
  await settle(page, host);
  await expect(host.locator(".anim-figure__canvas")).toBeVisible();
  await expect(host.locator('[data-role="readout"]')).toHaveText(`120 Hz · L = ${L(120)}`);
});

test("the badge sits in the title row, and there is no Lobes control", async ({ page }) => {
  await page.goto(CH07);
  const host = page.locator(HOST).first();
  await host.scrollIntoViewIfNeeded();
  await settle(page, host);
  await expect(host.locator('.anim-figure__head [data-role="status-badge"]')).toContainText("illustrative");
  await expect(host.locator('.harmonics-status [data-role="status-badge"]')).toHaveCount(0);
  await expect(host.locator('[data-role="lobes"], [data-legend="lobes"]')).toHaveCount(0);
  await host.locator('[data-voice="lr"]').click();
  await settle(page, host);
  await expect(host.locator('.anim-figure__head [data-role="status-badge"]')).not.toContainText("illustrative");
});

test("on the index page it opens in 3D too, and on a phone the chip stays inside the frame at 1x and 6x", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const host = await open3D(page, "");
  await expect(host.locator(".anim-figure__step")).toHaveCount(0);
  const inside = async () => host.locator(".anim-figure__frame").first().evaluate((frame) => {
    const f = frame.getBoundingClientRect();
    const c = /** @type {Element} */ (frame.querySelector(".anim-chip")).getBoundingClientRect();
    return c.left >= f.left - 1 && c.right <= f.right + 1 && c.top >= f.top - 1 && c.bottom <= f.bottom + 1;
  });
  expect(await inside()).toBe(true);
  const into = host.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 12 && (await into.isEnabled()); i += 1) {
    await into.click();
    await page.evaluate(() => window.__ambeAnim?.finishAll());
  }
  await page.waitForTimeout(150);
  expect(await inside()).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the highlight holds 3:1 against the plot and the stage bottom in both themes", async ({ page }) => {
  const host = await open3D(page);
  for (const scheme of ["slate", "default"]) {
    const [hl, ...grounds] = await host.locator(".anim-figure__frame").first().evaluate((frame, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(frame);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    const lum = (/** @type {string} */ hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    for (const g of grounds) {
      const [a, b] = [lum(hl), lum(g)].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05), `${scheme} ${g}`).toBeGreaterThanOrEqual(3);
    }
  }
});

/**
 * The visible labels' and the visible chips' boxes in the frame.
 * @param {import("@playwright/test").Locator} host
 */
const boxes = (host) => host.locator(".anim-figure__frame").first().evaluate((frame) => {
  const shown = (/** @type {Element} */ n) => !n.closest("[hidden]") && n.getClientRects().length > 0;
  const rect = (/** @type {Element} */ n) => {
    const r = n.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  return {
    labels: [...frame.querySelectorAll(".anim-figure__label")].filter(shown)
      .map((n) => ({ text: n.textContent ?? "", tick: n.classList.contains("anim-figure__label--tick"), ...rect(n) })),
    chips: [...frame.querySelectorAll(".anim-chip")].filter(shown).map(rect),
  };
});
/** @param {{left: number, right: number, top: number, bottom: number}} a @param {{left: number, right: number, top: number, bottom: number}} b */
const meet = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

for (const width of [1280, 375]) {
  test(`at ${width} px, at Corner and Side the cutoff is named, the chip covers no name, and no two names overprint`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open3D(page);
    for (const name of ["corner", "side", "front", "top"]) {
      await preset(page, host, name);
      await page.waitForTimeout(150);
      const { labels, chips } = await boxes(host);
      const names = labels.filter((l) => !l.tick);
      expect(names.some((l) => l.text.includes("cutoff at 3.7 kHz")), name).toBe(true);
      expect(chips, name).toHaveLength(1);
      for (const l of names) expect(meet(l, chips[0]), `${name}: chip over "${l.text}"`).toBe(false);
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          expect(meet(names[i], names[j]), `${name}: "${names[i].text}" over "${names[j].text}"`).toBe(false);
        }
      }
    }
  });
}

test("parked by another figure's 3D, a pitch change throws nothing", async ({ page }) => {
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const host = await open3D(page, `${CH07}?three-cap=1`);
  const voicing = page.locator('[data-anim="voicing"]').first();
  await voicing.scrollIntoViewIfNeeded();
  await voicing.locator('button[data-view="3d"]').first().click();
  await expect(host.locator(".anim-figure__frame").first()).toHaveAttribute("data-three", "parked");
  await host.locator('[data-role="pitch"]').evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = "200";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  expect(errors).toEqual([]);
});
