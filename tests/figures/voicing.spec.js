// The voicing figure in ch07 (three-figures plan, Figure C): one switch per
// frame against one per band, and the band strengths against a threshold,
// in the One frame view. These cases run under reduced motion, which opens
// that view (owner decision O1); the whole clip in 3D and the walk-through
// are in voicing-3d.spec.js. Expected frames come from the JSON through
// lib/picks.js, never from literal indices.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PICKS } from "../../docs/javascripts/lib/picks.js";
import { settle } from "./helpers.js";

const PAGE = "07-multi-band-excitation/";
const HOST = '[data-anim="voicing"]';
const STYLE_PATH = fileURLToPath(new URL("./screens.css", import.meta.url));
const CLIPS = ["lr-b", "lr-c", "lj-c"];

/** @param {string} clip @returns {FramesFile} */
const framesFile = (clip) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/frames.json`, import.meta.url), "utf8"));
/** @param {string} clip @param {"vowel" | "fricative" | "mixed"} name */
const pick = (clip, name) => {
  const found = PICKS[name](framesFile(clip).frames);
  if (!found) throw new Error(`no ${name} frame in ${clip}`);
  return found;
};

/**
 * The figure's test hook.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<any>}
 */
const probe = (page) =>
  page.evaluate(() => {
    const f = /** @type {any} */ (window.__ambeAnim?.figures.voicing);
    if (!f) return null;
    return {
      state: f.state,
      readout: f.readout(),
      representativeFrame: f.representativeFrame(),
      spectrumSource: f.spectrumSource,
      stemFrequencies: f.stemFrequencies(),
      decodedF0: f.decodedF0(),
    };
  });

/** @param {import("@playwright/test").Page} page */
async function open(page, query = "") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  await expect.poll(async () => (await probe(page))?.state.index ?? -1).toBeGreaterThanOrEqual(0);
  return host;
}

/** @param {import("@playwright/test").Locator} host */
const next = (host) => host.locator('[data-step="next"]').click();
/** @param {import("@playwright/test").Locator} host */
const readout = (host) => host.locator('[data-role="readout"]');

/**
 * Press Next until the stepper reads "Step n of 5".
 * @param {import("@playwright/test").Locator} host
 * @param {number} n
 */
async function toStep(host, n) {
  for (let k = 1; k < n; k += 1) await next(host);
  await expect(host.locator(".anim-steps__nav output")).toHaveText(`Step ${n} of 5`);
}

/**
 * Leave the steps for free play, where the figure shows every control
 * (anim.css hides the secondary rows while a step is on show).
 * @param {import("@playwright/test").Locator} host
 */
async function free(host) {
  const button = host.locator('[data-step="next"]');
  // End jumps to the last step at once (anim-steps.js), whose Next is Free play.
  await button.press("End");
  await expect(button).toHaveText("Free play");
  await expect(async () => {
    await button.click();
    await expect(host.locator(".anim-figure")).toHaveAttribute("data-steps", "free", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Free play in the One frame view, on one switch set to Voiced with the band
 * strengths off: the state these cases start from.
 * @param {import("@playwright/test").Locator} host
 */
async function freeFlat(host) {
  await free(host);
  await host.locator('.anim-controls [data-view="2d"]').click();
  await expect.poll(async () => (await probe(host.page())).state.view).toBe("2d");
  await host.locator('.anim-controls [data-mode="one"]').click();
  await host.locator('.anim-controls [data-one="voiced"]').click();
  const measure = host.locator('.anim-controls [data-role="measure"]');
  if ((await measure.getAttribute("aria-pressed")) === "true") await measure.click();
}

/**
 * Set a range input and fire its input event.
 * @param {import("@playwright/test").Locator} input
 * @param {number | string} value
 */
const setRange = (input, value) =>
  input.evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

test.describe("JS off", () => {
  test.use({ javaScriptEnabled: false });
  test("JS off: fallback image, caption and every step are visible", async ({ page }) => {
    await page.goto(PAGE);
    const host = page.locator(HOST);
    await expect(host.locator(".anim-fallback img")).toBeVisible();
    await expect(host.locator(".anim-fallback figcaption")).toContainText("not the codec's transmitted voicing bits");
    await expect(host.locator(".anim-steps > li")).toHaveCount(5);
    for (const step of await host.locator(".anim-steps > li").all()) await expect(step).toBeVisible();
  });
});

test("print: fallback image, numbered steps, no live chrome", async ({ page }) => {
  const host = await open(page);
  await page.emulateMedia({ media: "print" });
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  await expect(host.locator(".anim-figure__frame")).toBeHidden();
  await expect(host.locator(".anim-figure .anim-controls").first()).toBeHidden();
  await expect(host.locator("figcaption:visible")).toHaveCount(1);
  for (const step of await host.locator(".anim-steps > li").all()) await expect(step).toBeVisible();
});

test("the live caption equals the fallback caption, plus badges", async ({ page }) => {
  const host = await open(page);
  const norm = (/** @type {string | null} */ s) => (s ?? "").replace(/\s+/g, " ").trim();
  const fallback = norm(await host.locator(".anim-fallback figcaption").textContent());
  const live = norm(await host.locator('.anim-figure [data-role="caption-text"]').textContent());
  expect(live).toBe(fallback);
  await expect(host.locator(".anim-figure .anim-badge--derived[data-from=decoded]")).toHaveCount(1);
  await expect(host.locator('.anim-figure [data-measured="decoded-audio"] .anim-badge--measured')).toHaveCount(1);
});

test("steps: each step applies its state", async ({ page }) => {
  const host = await open(page);
  const mixed = pick("lr-b", "mixed").i;
  await expect(readout(host)).toContainText(`frame ${pick("lr-b", "vowel").i} `);
  // The vowel frame's top band is below 0.55, so Voiced misses one band.
  await expect(readout(host)).toContainText("disagree in 1 band");
  await expect(readout(host)).not.toContainText("periodic");
  await next(host);
  await expect(readout(host)).toContainText(`frame ${pick("lr-b", "fricative").i} `);
  await expect(readout(host)).toContainText("agree in every band");
  expect((await probe(page)).state.one).toBe("unvoiced");
  await next(host);
  await expect(readout(host)).toContainText(`frame ${mixed} `);
  await expect(readout(host)).toContainText("disagree in 5 bands");
  await next(host);
  // Step 4 sets the eight switches to fit the frame: no band disagrees.
  const fit = pick("lr-b", "mixed").derived.band_voicing.map((v) => v >= 0.55);
  expect((await probe(page)).state.mode).toBe("bands");
  expect((await probe(page)).state.choice).toEqual(fit);
  await expect(host.locator('.anim-controls [data-role="bands"]')).not.toHaveAttribute("hidden", "");
  await expect(host.locator('.anim-controls [data-role="one"]')).toHaveAttribute("hidden", "");
  await expect(readout(host)).toContainText("Model and band strengths agree in every band");
  await next(host);
  await expect(readout(host)).toContainText("of 8 bands periodic at 0.55");
  expect((await probe(page)).state.measure).toBe(true);
  expect((await probe(page)).state.view).toBe("3d");
  expect((await probe(page)).state.choice).toEqual(fit);
  await expect(readout(host)).toContainText("Model and band strengths agree in every band");
});

test("steps: step 4 fits the eight switches, and fits them again after free play changes them", async ({ page }) => {
  const host = await open(page);
  const fit = pick("lr-b", "mixed").derived.band_voicing.map((v) => v >= 0.55);
  await toStep(host, 4);
  expect((await probe(page)).state.choice).toEqual(fit);
  await free(host);
  await host.locator('.anim-controls [data-view="2d"]').click();
  await host.locator('.anim-controls [data-band="0"]').click();
  await host.locator('.anim-controls [data-band="5"]').click();
  expect((await probe(page)).state.choice).not.toEqual(fit);
  await host.locator('[data-step="prev"]').click();
  await expect(host.locator(".anim-steps__nav output")).toHaveText("Step 4 of 5");
  expect((await probe(page)).state.choice).toEqual(fit);
  await expect(readout(host)).toContainText("Model and band strengths agree in every band");
});

test("steps: Previous after free play restores the step", async ({ page }) => {
  const host = await open(page);
  await free(host);
  await host.locator('.anim-controls [data-role="model"]').click();
  await host.locator('.anim-controls [data-pick="vowel"]').click();
  await host.locator('[data-step="prev"]').click();
  await expect(host.locator(".anim-steps__nav output")).toHaveText("Step 4 of 5");
  await expect(readout(host)).toContainText(`frame ${pick("lr-b", "mixed").i} `);
  await expect(readout(host)).toContainText("Model and band strengths");
  await expect(readout(host)).not.toContainText("periodic");
  const s = (await probe(page)).state;
  expect(s).toMatchObject({ mode: "bands", model: true, measure: false, view: "2d", threshold: 0.55 });
  expect(s.choice).toEqual(pick("lr-b", "mixed").derived.band_voicing.map((v) => v >= 0.55));
  // Moving a slider in a step does not move the step.
  await setRange(host.locator('.anim-controls [data-role="frame"]'), 3);
  await expect(host.locator(".anim-steps__nav output")).toHaveText("Step 4 of 5");
});

test("quick picks are found by criterion", async ({ page }) => {
  const host = await open(page);
  await freeFlat(host);
  for (const clip of CLIPS) {
    await host.locator(`.anim-controls [data-clip="${clip}"]`).click();
    await expect.poll(async () => (await probe(page)).state.clip).toBe(clip);
    for (const name of /** @type {const} */ (["vowel", "fricative", "mixed"])) {
      await host.locator(`.anim-controls [data-pick="${name}"]`).click();
      await expect.poll(async () => (await probe(page)).state.index, `${clip} ${name}`).toBe(pick(clip, name).i);
    }
  }
});

test("mixed: a mismatch under both settings, none after a fit", async ({ page }) => {
  const host = await open(page);
  await freeFlat(host);
  await host.locator('.anim-controls [data-pick="mixed"]').click();
  await host.locator('.anim-controls [data-one="voiced"]').click();
  await expect(readout(host)).toContainText("disagree in 5 bands");
  await host.locator('.anim-controls [data-one="unvoiced"]').click();
  await expect(readout(host)).toContainText("disagree in 3 bands");
  await host.locator('.anim-controls [data-mode="bands"]').click();
  const strengths = pick("lr-b", "mixed").derived.band_voicing;
  for (let b = 0; b < 8; b += 1) {
    const button = host.locator(`.anim-controls [data-band="${b}"]`);
    const want = strengths[b] >= 0.55;
    if ((await button.getAttribute("aria-pressed")) !== String(want)) await button.click();
    await expect(button).toHaveAttribute("aria-label", new RegExp(`^Band ${b + 1}, .* ${want ? "voiced" : "unvoiced"}$`));
  }
  await expect(readout(host)).toContainText("Model and band strengths agree in every band");
});

test("threshold moves the count", async ({ page }) => {
  const host = await open(page);
  await freeFlat(host);
  await host.locator('.anim-controls [data-pick="mixed"]').click();
  await host.locator('.anim-controls [data-role="measure"]').click();
  const threshold = host.locator('.anim-controls [data-role="threshold"]');
  await expect(threshold).toBeVisible();
  for (const [value, count] of /** @type {const} */ ([["0.3", 4], ["0.55", 3], ["0.8", 2]])) {
    await setRange(threshold, value);
    await expect(readout(host)).toContainText(`${count} of 8 bands periodic at ${Number(value).toFixed(2)}`);
    await expect(threshold).toHaveAttribute("aria-valuetext", Number(value).toFixed(2));
  }
});

test("the spectrum is decoded, the stems use decoded f0", async ({ page }) => {
  const host = await open(page);
  await freeFlat(host);
  await host.locator('.anim-controls [data-pick="mixed"]').click();
  const p = await probe(page);
  expect(p.spectrumSource).toBe("decoded");
  const f0 = pick("lr-b", "mixed").derived.decoded_f0_hz;
  expect(p.decodedF0).toBe(f0);
  expect(p.stemFrequencies.length).toBeGreaterThan(0);
  p.stemFrequencies.forEach((/** @type {number} */ f) => {
    expect(Math.abs(f / f0 - Math.round(f / f0))).toBeLessThan(1e-9);
  });
  // Voiced on the mixed frame: every harmonic below 4 kHz gets a stem.
  expect(p.stemFrequencies.length).toBe(Math.ceil(4000 / f0) - 1);
});

test("the caveat is on the page", async ({ page }) => {
  const host = await open(page);
  await expect(host.locator(".anim-figure__caption")).toContainText("not the codec's transmitted voicing bits");
  const steps = host.locator(".anim-steps > li");
  await expect(steps.nth(4)).toContainText("not the codec's transmitted voicing bits");
});

test("reduced motion: Sound visible in free play, Play hidden", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const host = await open(page);
  await free(host);
  await expect(host.locator('[data-kind="audio"]')).toBeVisible();
  await expect(host.locator('[data-kind="motion"]')).toBeHidden();
});

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  { name: "phone", viewport: { width: 375, height: 800 }, deviceScaleFactor: 3 },
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor });

    test(`0.55 is today's picture (${vp.name})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const host = await open(page);
      await free(host);
      await host.locator('.anim-controls [data-clip="lr-b"]').click();
      if ((await host.locator('.anim-controls [data-role="measure"]').getAttribute("aria-pressed")) !== "true") {
        await host.locator('.anim-controls [data-role="measure"]').click();
      }
      if ((await host.locator('.anim-controls [data-role="model"]').getAttribute("aria-pressed")) === "true") {
        await host.locator('.anim-controls [data-role="model"]').click();
      }
      await setRange(host.locator('.anim-controls [data-role="threshold"]'), "0.55");
      await host.locator('.anim-controls [data-view="2d"]').click();
      const rep = (await probe(page)).representativeFrame;
      await setRange(host.locator('.anim-controls [data-role="frame"]'), rep);
      await settle(page, host);
      await expect(host.locator(".anim-figure__frame")).toHaveScreenshot(`${vp.name}-threshold-055.png`, {
        maxDiffPixels: 0,
        stylePath: STYLE_PATH,
      });
    });
  });
}


for (const vp of VIEWPORTS) {
  test.describe(`screens ${vp.name}`, () => {
    test.use({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor });
    test(`screens: the One frame view at step 1 (${vp.name})`, async ({ page }) => {
      const host = await open(page);
      await settle(page, host);
      await expect(host.locator(".anim-figure__frame")).toHaveScreenshot(`${vp.name}-2d-step1.png`, {
        maxDiffPixels: 0, stylePath: STYLE_PATH,
      });
    });
  });
}

const SCREENS_CSS = readFileSync(new URL("./screens.css", import.meta.url), "utf8");

// The frame sits on whole CSS pixels: its height and its top in the page.
// Text above the figure that grows by a fraction of a pixel then leaves the
// frame's screenshot as it was (baselines re-recorded in 9a28edb).
for (const width of [375, 390, 768, 1280, 1440, 1920]) {
  test(`the frame sits on whole pixels at ${width} px, wherever the text above ends`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, deviceScaleFactor: width < 480 ? 3 : 1, colorScheme: "dark" });
    const page = await context.newPage();
    const host = await open(page);
    await settle(page, host);
    const frame = host.locator(".anim-figure__frame");
    const box = () => frame.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - document.documentElement.getBoundingClientRect().top, height: r.height };
    });
    /** @type {Buffer | undefined} */
    let first;
    for (const extra of [0.4, 1, 2.7]) {
      await page.evaluate(({ sel, extra }) => {
        let spacer = document.getElementById("whole-pixel-spacer");
        if (!spacer) {
          spacer = document.createElement("div");
          spacer.id = "whole-pixel-spacer";
          const figure = document.querySelector(sel);
          figure?.parentNode?.insertBefore(spacer, figure);
        }
        spacer.style.height = `${extra}px`;
      }, { sel: HOST, extra });
      await expect.poll(async () => Number.isInteger((await box()).top)).toBe(true);
      expect(Number.isInteger((await box()).height)).toBe(true);
      // The whole frame on screen, so the picture needs no scroll.
      await frame.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const shot = await frame.screenshot({ animations: "disabled", caret: "hide", style: SCREENS_CSS });
      if (first) expect(shot.equals(first)).toBe(true);
      else first = shot;
    }
    await context.close();
  });
}
