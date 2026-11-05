// The harmonic-sum figure in ch11 (three-figures plan, Figure A).
// Expected values are computed here from the committed JSON through the same
// lib/ modules the figure uses; only harmonic-sum-lib.spec.js holds literals.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as H from "../../docs/javascripts/lib/harmonics.js";
import { topSteadyPitched } from "../../docs/javascripts/lib/picks.js";
import { CUTOFF_BADGE, CUTOFF_HZ, CUTOFF_LABEL } from "../../docs/javascripts/lib/cutoff.js";
import { fileURLToPath } from "node:url";
import { countAnimObservers, hook, installCoreLoader, routeOrphans, snapToPixel, visit } from "./helpers.js";

const STYLE_PATH = fileURLToPath(new URL("./screens.css", import.meta.url));

const PAGE = "11-synthesis/";
const HOST = '[data-anim="harmonic-sum"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;
const FLAT = `${HOST} canvas[data-ref="flat"]`;
const READOUT = `${HOST} output[data-ref="readout"]`;

/**
 * @param {string} clip
 * @param {string} file
 */
const load = (clip, file) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/${file}.json`, import.meta.url), "utf8"));

/** What the figure should show for a clip's frame of a given rank. */
function expected(clip = "lj-b", rank = 0) {
  const file = load(clip, "frames");
  /** @type {FrameRecord[]} */
  const frames = file.frames;
  const frame = topSteadyPitched(frames, 4)[rank];
  const f0 = frame.derived.orig_f0_hz;
  const L = H.harmonicCount(f0, CUTOFF_HZ);
  const A = H.harmonicAmplitudes(load(clip, "spectra").original[frame.i], f0, L);
  const zero = H.samplePeriod(A, H.phases(L, "zero", 0), L);
  const rand = H.samplePeriod(A, H.phases(L, "random", 0), L);
  const offsets = [...H.phases(L, "random", 0)].slice(1).map(H.crestOffset);
  return {
    i: frame.i, f0, L, A,
    maxA: Math.max(...A.slice(1)),
    zero: H.peakToRms(zero).toFixed(2),
    random: H.peakToRms(rand).toFixed(2),
    scattered: offsets.filter((x) => Math.abs(x) > 0.1).length,
    from: frame.i * 0.02 + 0.01 + file.clip.decoded_delay_ms / 1000 - 0.15,
  };
}

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only probe
  const p = window.__ambeAnim.figures["harmonic-sum"];
  return { state: p.state, numbers: p.numbers, crestOffsets: p.crestOffsets, builds: p.builds,
    pose: p.pose, objects: p.objects, player: p.player, inputSamples: p.inputSamples };
});

/**
 * @param {import("@playwright/test").Page} page
 * @param {{query?: string, three?: boolean}} [options]
 */
async function open(page, { query = "", three = true } = {}) {
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await host.scrollIntoViewIfNeeded();
  await page.locator(`${HOST}.is-enhanced`).waitFor();
  // The 3D view draws only while its frame shows; on a phone the host is
  // taller than the screen, so bring the frame itself into view.
  await page.locator(`${HOST} .anim-hsum__frame`).scrollIntoViewIfNeeded();
  // @ts-ignore test-only probe
  await page.waitForFunction(() => window.__ambeAnim?.figures?.["harmonic-sum"]);
  if (three) await page.locator(CANVAS_3D).waitFor();
  return host;
}

/**
 * Leave 3D for the flat view (the 3D control is a toggle).
 * @param {import("@playwright/test").Page} page
 */
async function toFlat(page) {
  const toggle = page.locator(`${HOST} button[data-view="3d"]`);
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await expect(page.locator(FLAT)).toBeVisible();
}

/** @param {import("@playwright/test").Page} page */
const next = (page) => page.locator(`${HOST} [data-step="next"]`).click();

/** @param {import("@playwright/test").Page} page */
const settleTweens = async (page) => {
  await page.waitForTimeout(300);
  // @ts-ignore test-only hook
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(300);
};

test("JS off: fallback image, caption and every step are visible", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  await expect(host.locator(".anim-fallback figcaption")).toContainText("US 5,701,390");
  const steps = host.locator(".anim-steps > li");
  await expect(steps).toHaveCount(4);
  for (const step of await steps.all()) await expect(step).toBeVisible();
  expect(await host.locator(".anim-fallback img").evaluate((img) =>
    img instanceof HTMLImageElement && img.complete && img.naturalWidth)).toBe(1280);
  await context.close();
});

test("print: fallback image, numbered steps, no live chrome", async ({ page }) => {
  await open(page, { three: false });
  await page.emulateMedia({ media: "print" });
  const host = page.locator(HOST);
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  const steps = host.locator(".anim-steps > li");
  await expect(steps).toHaveCount(4);
  for (const step of await steps.all()) await expect(step).toBeVisible();
  await expect(host.locator(".anim-figure__frame").first()).toBeHidden();
  for (const row of await host.locator(".anim-controls").all()) await expect(row).toBeHidden();
  await expect(host.locator(".anim-steps__nav")).toBeHidden();
});

test("steps: each step applies its state", async ({ page }) => {
  const want = expected();
  await open(page);
  const readout = page.locator(READOUT);
  await expect(readout).toHaveText(new RegExp(`^1 of ${want.L} harmonics · f0 ${want.f0.toFixed(1)} Hz \\(input\\)`));

  await next(page);
  await expect(readout).toContainText(`${want.L} of ${want.L} harmonics`);
  await expect(readout).toContainText(`peak-to-RMS ${want.zero}`);
  await expect(page.locator(`${HOST} input[value="zero"]`)).toBeChecked();

  await next(page);
  await expect(page.locator(`${HOST} input[value="random"]`)).toBeChecked();
  await expect(readout).toContainText("largest amplitude change 0.0 dB");
  await expect(readout).toContainText(`peak-to-RMS ${want.random}`);
  const { crestOffsets, numbers } = await probe(page);
  expect(crestOffsets.filter((/** @type {number} */ x) => Math.abs(x) > 0.1).length).toBe(want.scattered);
  expect(numbers.change).toBeLessThan(0.05);

  // Step 4 is about the stems, a flat plot: it leaves 3D for the flat view.
  await next(page);
  await settleTweens(page);
  await expect(page.locator(`${HOST} button[data-view="3d"]`)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(FLAT)).toBeVisible();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(readout).toContainText(`peak-to-RMS ${want.random}`);
  // Back to step 3: 3D again.
  await page.locator(`${HOST} [data-step="prev"]`).click();
  await page.locator(CANVAS_3D).waitFor();
});

test("steps: Previous after free play restores the step", async ({ page }) => {
  const want = expected();
  await open(page);
  await next(page);
  await next(page);
  await settleTweens(page);
  await page.locator(`${HOST} input[data-ref="n"]`).fill("3");
  await page.locator(`${HOST} input[value="zero"]`).check();
  await expect(page.locator(READOUT)).toContainText(`3 of ${want.L}`);
  // Moving a control does not move the step.
  await expect(page.locator(`${HOST} .anim-steps__nav output`)).toHaveText("Step 3 of 4");
  await page.locator(`${HOST} [data-step="prev"]`).click();
  await expect(page.locator(READOUT)).toContainText(`${want.L} of ${want.L} harmonics`);
  await expect(page.locator(READOUT)).toContainText(`peak-to-RMS ${want.zero}`);
  await page.locator(`${HOST} [data-step="next"]`).click();
  await expect(page.locator(READOUT)).toContainText(`peak-to-RMS ${want.random}`);
});

test("no WebGL: 2D works, 3D control disabled with the hint", async ({ page }) => {
  await open(page, { query: "?nowebgl", three: false });
  const view3d = page.locator(`${HOST} button[data-view="3d"]`);
  await expect(view3d).toBeDisabled();
  await expect(page.locator(`${HOST} .anim-figure__hint--webgl`)).toHaveText("3D needs WebGL 2");
  await expect(page.locator(FLAT)).toBeVisible();
  await next(page);
  await next(page);
  const flat = await page.locator(READOUT).textContent();

  await open(page);
  await next(page);
  await next(page);
  await expect(page.locator(READOUT)).toHaveText(flat || "");
});

test("context loss: paused, resume rebuilds, readouts unchanged", async ({ page }) => {
  await open(page);
  await next(page);
  await settleTweens(page);
  const before = await probe(page);
  const text = await page.locator(READOUT).textContent();
  await page.locator(CANVAS_3D).evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.locator(`${HOST} .anim-figure__frame[data-state="paused"]`)).toHaveCount(1);
  await page.locator(`${HOST} .anim-figure__resume`).click();
  await expect.poll(async () => (await probe(page)).builds).toBe(before.builds + 1);
  expect((await probe(page)).objects).toBe(before.objects);
  await expect(page.locator(READOUT)).toHaveText(text || "");
});

test("ten navigations: one context at most, observers back to baseline", async ({ page }) => {
  /** @type {string[]} */
  const messages = [];
  page.on("console", (m) => messages.push(m.text()));
  await countAnimObservers(page);
  await routeOrphans(page);
  await open(page);
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__sameDocument = true;
  });
  // @ts-ignore test-only global
  const observers = await page.evaluate(() => window.__obs.live);
  for (let i = 0; i < 10; i += 1) {
    await visit(page, "14-how-to-measure/");
    await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
    await page.locator('a.md-nav__link[href$="11-synthesis/"]').first().click();
    await page.waitForURL(/11-synthesis\/$/);
    await page.locator(HOST).scrollIntoViewIfNeeded();
    await page.locator(CANVAS_3D).waitFor();
    expect((await hook(page)).liveContexts).toBe(1);
  }
  const h = await hook(page);
  expect(h.peakContexts).toBe(1);
  expect(h.webglProbes).toBe(1);
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBe(observers);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  expect(messages.filter((m) => /too many active webgl contexts/i.test(m))).toEqual([]);
});

test("toggle 3D five times quickly: no stray context or labels", async ({ page }) => {
  await routeOrphans(page);
  await open(page);
  const view3d = page.locator(`${HOST} button[data-view="3d"]`);
  for (let i = 0; i < 5; i += 1) {
    await view3d.click();
    await view3d.click();
  }
  await view3d.click();
  await page.waitForTimeout(500);
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
  expect((await hook(page)).peakContexts).toBe(1);
  await expect(page.locator(`${HOST} .anim-figure__overlay`)).toHaveCount(0);
  await expect(page.locator(FLAT)).toBeVisible();
  await view3d.click();
  await page.locator(CANVAS_3D).waitFor();
  await expect(page.locator(`${HOST} .anim-figure__overlay:not(.anim-chip-layer)`)).toHaveCount(1);
  await visit(page, "14-how-to-measure/");
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
});

test("reduced motion: opens 2D, 3D still available, no tween", async ({ page }) => {
  // Tall enough that the frame and the camera buttons are on screen together:
  // a view draws only while its frame is visible.
  await page.setViewportSize({ width: 1280, height: 1800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { three: false });
  await next(page);
  await expect(page.locator(FLAT)).toBeVisible();
  await expect(page.locator(`${HOST} button[data-view="3d"]`)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await page.locator(`${HOST} button[data-view="3d"]`).click();
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(300);
  for (const preset of ["side", "front", "corner"]) {
    const before = (await hook(page)).renders;
    await page.locator(`${HOST} button[data-preset="${preset}"]`).click();
    await page.waitForTimeout(400);
    expect((await hook(page)).renders - before, preset).toBe(1);
  }
});

test("phone: no horizontal scroll, labels inside the frame", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 3,
    colorScheme: "dark" });
  const page = await context.newPage();
  await open(page);
  for (const preset of ["corner", "front", "side"]) {
    await page.locator(`${HOST} button[data-preset="${preset}"]`).click();
    await settleTweens(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const frame = await page.locator(`${HOST} .anim-hsum__frame`).boundingBox();
    if (!frame) throw new Error("no frame box");
    const labels = page.locator(`${HOST} .anim-figure__label:visible`);
    expect(await labels.count(), preset).toBeGreaterThan(0);
    for (const label of await labels.all()) {
      const b = await label.boundingBox();
      if (!b) continue;
      expect(b.x, `${preset} ${await label.textContent()}`).toBeGreaterThanOrEqual(frame.x - 0.5);
      expect(b.x + b.width, `${preset} ${await label.textContent()}`).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height - 56 + 0.5);
    }
  }
  await context.close();
});

test("phone 375: every control stays inside the figure, in every phase mode", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2,
    colorScheme: "dark" });
  const page = await context.newPage();
  await open(page);
  for (const mode of ["zero", "random", "scaled"]) {
    await page.locator(`${HOST} input[value="${mode}"]`).check();
    const over = await page.evaluate((host) => {
      const figure = document.querySelector(`${host} .anim-figure`);
      if (!figure) return ["no figure"];
      const right = figure.getBoundingClientRect().right;
      return [...figure.querySelectorAll(".anim-controls button, .anim-controls input, .anim-controls select, .anim-controls label")]
        .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > right + 0.5)
        .map((el) => `${el.tagName} ${(el.textContent ?? "").trim()} ${el.getBoundingClientRect().right} > ${right}`);
    }, HOST);
    expect(over, mode).toEqual([]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await context.close();
});

test("2D: stems do not change with phase, the waveform does", async ({ page }) => {
  await open(page);
  await next(page);
  await settleTweens(page);
  await toFlat(page);
  const hashes = async () => page.locator(FLAT).evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
    const ctx = canvas.getContext("2d");
    // @ts-ignore test-only probe
    const layout = window.__ambeAnim.figures["harmonic-sum"].layout();
    const dpr = canvas.width / canvas.clientWidth;
    /** @param {{x: number, y: number, width: number, height: number}} r */
    const hash = (r) => {
      const data = ctx?.getImageData(Math.round(r.x * dpr), Math.round(r.y * dpr),
        Math.round(r.width * dpr), Math.round(r.height * dpr)).data ?? [];
      let h = 2166136261;
      for (let j = 0; j < data.length; j += 1) h = Math.imul(h ^ data[j], 16777619);
      return h >>> 0;
    };
    return { stems: hash(layout.stems), wave: hash(layout.wave) };
  });
  const zero = await hashes();
  await page.locator(`${HOST} input[value="random"]`).check();
  await expect(page.locator(`${HOST} input[value="random"]`)).toBeChecked();
  await page.waitForTimeout(200);
  const random = await hashes();
  expect(random.stems).toBe(zero.stems);
  expect(random.wave).not.toBe(zero.wave);
});

test("3D: side silhouette is the spectrum in both phase modes", async ({ page }) => {
  const want = expected();
  await open(page);
  await next(page);
  await settleTweens(page);
  for (const mode of ["zero", "random"]) {
    await page.locator(`${HOST} input[value="${mode}"]`).check();
    await settleTweens(page);
    const heights = await page.evaluate(() => {
      // @ts-ignore test-only probe
      return window.__ambeAnim.figures["harmonic-sum"].ribbonMaxAbs();
    });
    expect(heights.length).toBe(want.L + 1);
    for (let k = 1; k <= want.L; k += 1) {
      expect(Math.abs(heights[k] - (0.55 * want.A[k]) / want.maxA), `${mode} k=${k}`).toBeLessThan(1e-6);
    }
  }
});

test("input strip: 160 samples of the original WAV for any frame", async ({ page }) => {
  await installCoreLoader(page);
  await open(page);
  const frames = load("lj-b", "frames").frames;
  const picks = topSteadyPitched(frames, 4);
  const wav = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const core = await window.__loadCore();
    return Array.from(await core.loadPCM("assets/audio/lj-b-original.wav"));
  });
  for (let rank = 0; rank < 4; rank += 1) {
    await page.locator(`${HOST} select[data-ref="frame"]`).selectOption(String(rank));
    await expect.poll(async () => (await probe(page)).state.frame).toBe(picks[rank].i);
    await expect.poll(async () => (await probe(page)).inputSamples.length).toBe(160);
    const samples = (await probe(page)).inputSamples;
    expect(samples[0]).toBeCloseTo(wav[picks[rank].i * 160], 6);
    expect(samples[159]).toBeCloseTo(wav[picks[rank].i * 160 + 159], 6);
  }
});

test("hardware snippet: aligned with decoded_delay_ms", async ({ page }) => {
  const want = expected();
  await open(page);
  const { player } = await probe(page);
  expect(Math.abs(player.from - want.from)).toBeLessThan(1e-9);
  expect(Math.abs(player.until - (want.from + 0.3))).toBeLessThan(1e-9);
  const button = page.locator(`${HOST} button[data-kind="audio"]`);
  await expect(button.locator("xpath=..")).toHaveAttribute("data-measured", "decoded-audio");
  const measured = page.locator(`${HOST} .anim-figure .anim-badge--measured`);
  await expect(measured).toHaveCount(1);
  await expect(page.locator(`${HOST} [data-measured="decoded-audio"] .anim-badge--measured`)).toHaveCount(1);
});

test("cutoff label follows lib/cutoff.js", async ({ page }) => {
  await open(page, { three: false });
  const label = page.locator(`${HOST} [data-ref="cutoff"]`);
  await expect(label).toHaveText(CUTOFF_LABEL);
  const badge = page.locator(`${HOST} .anim-hsum__cutoff .anim-badge--illustrative`);
  if (CUTOFF_BADGE === "illustrative") {
    await expect(badge).toHaveCount(1);
    expect(CUTOFF_LABEL).not.toMatch(/US \d/);
    // The badge says it; the label beside it does not repeat the word.
    expect(CUTOFF_LABEL).not.toMatch(/illustrative/i);
  } else {
    await expect(badge).toHaveCount(0);
  }
});

test("no synthesis: the figure never constructs an AudioContext", async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-ignore test-only global
    window.__audioContexts = 0;
    const Native = window.AudioContext;
    // @ts-ignore replacing a constructor for the test
    window.AudioContext = class extends Native {
      /** @param {any[]} args */
      constructor(...args) {
        super(...args);
        // @ts-ignore test-only global
        window.__audioContexts += 1;
      }
    };
  });
  await open(page);
  await next(page);
  await next(page);
  await settleTweens(page);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__audioContexts)).toBe(0);
});

for (const size of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
  test(`screens: 2D and 3D at ${size.width}x${size.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: size.width < 500 ? 3 : 1,
      colorScheme: "dark" });
    const page = await context.newPage();
    await open(page);
    await next(page);
    await next(page);
    await settleTweens(page);
    await snapToPixel(page.locator(HOST).first());
    const frame = page.locator(`${HOST} .anim-hsum__frame`);
    // The frame too: the step text above it can leave it at a fractional offset.
    await snapToPixel(frame);
    await page.waitForTimeout(100);
    await expect(frame).toHaveScreenshot(`harmonic-sum-3d-${size.width}.png`, { maxDiffPixelRatio: 0.01, stylePath: STYLE_PATH });
    await toFlat(page);
    await page.waitForTimeout(300);
    await expect(frame).toHaveScreenshot(`harmonic-sum-2d-${size.width}.png`, { maxDiffPixels: 0, stylePath: STYLE_PATH });
    await context.close();
  });
}

test("a new frame during a phase tween: every ribbon and the sum stay finite", async ({ page }) => {
  await open(page);
  await next(page);
  await settleTweens(page);
  // Random starts a 600 ms tween; frame rank 2 has another L and lands mid-tween.
  await page.evaluate((host) => {
    const random = document.querySelector(`${host} input[value="random"]`);
    if (random instanceof HTMLInputElement) random.click();
    setTimeout(() => {
      const select = document.querySelector(`${host} select[data-ref="frame"]`);
      if (!(select instanceof HTMLSelectElement)) return;
      select.value = "2";
      select.dispatchEvent(new Event("change"));
    }, 100);
  }, HOST);
  const want = expected("lj-b", 2);
  await expect.poll(async () => (await probe(page)).state.L).toBe(want.L);
  await settleTweens(page);
  const heights = await page.evaluate(() => {
    // @ts-ignore test-only probe
    return window.__ambeAnim.figures["harmonic-sum"].ribbonMaxAbs();
  });
  expect(heights.length).toBe(want.L + 1);
  for (let k = 1; k <= want.L; k += 1) {
    expect(Math.abs(heights[k] - (0.55 * want.A[k]) / want.maxA), `k=${k}`).toBeLessThan(1e-6);
  }
});

test("3D, Flat, 3D in one task: one overlay, none left after Flat", async ({ page }) => {
  await open(page);
  await page.evaluate((host) => {
    const b3 = document.querySelector(`${host} button[data-view="3d"]`);
    if (!(b3 instanceof HTMLButtonElement)) return;
    b3.click();
    b3.click();
    b3.click();
    b3.click();
  }, HOST);
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(500);
  await expect(page.locator(`${HOST} .anim-figure__overlay:not(.anim-chip-layer)`)).toHaveCount(1);
  await toFlat(page);
  await expect(page.locator(`${HOST} .anim-figure__overlay`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .anim-figure__label`)).toHaveCount(0);
  await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
});

/**
 * Drag the 3D canvas sideways by dx px from its centre.
 * @param {import("@playwright/test").Page} page
 * @param {number} dx
 */
async function drag(page, dx) {
  // The Next button that came before can leave a tall figure's canvas above the screen.
  await page.locator(CANVAS_3D).evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await page.locator(CANVAS_3D).boundingBox();
  if (!box) throw new Error("no 3D canvas");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

test("steps: Previous after a drag puts the camera back on the step's preset", async ({ page }) => {
  await open(page);
  await next(page);
  await next(page);
  await settleTweens(page);
  await drag(page, 120);
  const dragged = (await probe(page)).pose;
  expect(dragged.yaw).not.toBeCloseTo(-20, 0);
  await expect(page.locator(`${HOST} button[data-preset][aria-pressed="true"]`)).toHaveCount(0);
  await page.locator(`${HOST} [data-step="prev"]`).click();
  await expect.poll(async () => (await probe(page)).pose).toEqual({ yaw: -20, pitch: 30 });
  await expect(page.locator(`${HOST} button[data-preset="corner"]`)).toHaveAttribute("aria-pressed", "true");
});

test("a tap on the 3D view leaves the preset, its labels and its zoom alone", async ({ page }) => {
  await open(page);
  await page.locator(`${HOST} button[data-preset="side"]`).click();
  await settleTweens(page);
  const camera = () => page.evaluate(() => {
    // @ts-ignore test-only probe
    return window.__ambeAnim.figures["harmonic-sum"].camera;
  });
  const before = await camera();
  const labels = await page.locator(`${HOST} .anim-figure__label`).allTextContents();
  await page.locator(CANVAS_3D).click();
  await page.waitForTimeout(300);
  expect(await camera()).toEqual(before);
  expect((await probe(page)).pose).toEqual({ yaw: 90, pitch: 0 });
  expect(await page.locator(`${HOST} .anim-figure__label`).allTextContents()).toEqual(labels);
  await expect(page.locator(`${HOST} button[data-preset="side"]`)).toHaveAttribute("aria-pressed", "true");
});

test("a pixel-ratio change keeps the scene where the labels are", async ({ page }) => {
  await open(page);
  await settleTweens(page);
  await settleTweens(page);
  const where = () => page.evaluate(() => {
    // @ts-ignore test-only probe
    return window.__ambeAnim.figures["harmonic-sum"].screenOf([-1.5, 0, 0.35]);
  });
  const before = await where();
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBe(2);
  await page.waitForTimeout(300);
  const after = await where();
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.5);
});

test("axis labels: time and harmonic number at the corner, harmonic number from the side", async ({ page }) => {
  await open(page);
  await next(page);
  await settleTweens(page);
  const shown = () => page.locator(`${HOST} .anim-figure__label:visible`).allTextContents();
  expect(await shown()).toEqual(expect.arrayContaining(["time", "harmonic number", "sum"]));
  await page.locator(`${HOST} button[data-preset="side"]`).click();
  await settleTweens(page);
  expect(await shown()).toEqual(expect.arrayContaining(["harmonic number", "1", String(expected().L)]));
  await page.locator(`${HOST} button[data-preset="front"]`).click();
  await settleTweens(page);
  expect((await shown()).some((t) => /ms$/.test(t))).toBe(true);
});

test("readout: no segment breaks across lines", async ({ browser }) => {
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await open(page, { three: false });
    await next(page);
    await next(page);
    await expect(page.locator(`${HOST} .anim-hsum__segment`)).toHaveCount(4);
    const split = await page.locator(`${HOST} .anim-hsum__segment`).evaluateAll((spans) =>
      spans.filter((s) => s.getClientRects().length > 1).map((s) => s.textContent));
    expect(split, String(width)).toEqual([]);
    await page.close();
  }
});

test("reduced motion: the legend shows only the flat view's items", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { three: false });
  await expect(page.locator(`${HOST} .anim-hsum`)).toHaveAttribute("data-view", "2d");
  for (const item of await page.locator(`${HOST} .anim-legend__item[data-for="3d"]`).all()) await expect(item).toBeHidden();
  for (const item of await page.locator(`${HOST} .anim-legend__item[data-for="2d"]`).all()) await expect(item).toBeVisible();
});

test("JS off and print: the fallback caption names no player", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PAGE);
  await expect(page.locator(`${HOST} .anim-fallback figcaption`)).not.toContainText("player");
  await expect(page.locator(`${HOST} .anim-steps`)).not.toContainText("press Next");
  await context.close();
});
