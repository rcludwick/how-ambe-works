// voicing (ch07), its Whole clip view and its walk-through (three-everywhere
// plan F14): the first-view animation and its end state, the Side preset
// against the One frame view, the ridges and floor against the JSON, the
// threshold, the highlight, the legend, the walk-through, and the 3D
// lifecycle. Expected numbers come from the JSON through lib/picks.js.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PICKS } from "../../docs/javascripts/lib/picks.js";
import { countAnimObservers, hook, settle } from "./helpers.js";

const PAGE = "07-multi-band-excitation/";
const HOST = '[data-anim="voicing"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;
const STYLE_PATH = fileURLToPath(new URL("./screens.css", import.meta.url));
const THRESHOLD = 0.55;

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
 * @param {import("@playwright/test").Page} page
 * @param {{motion?: "reduce" | "no-preference", query?: string, scroll?: boolean}} [opts]
 */
async function open(page, { motion = "no-preference", query = "", scroll = true } = {}) {
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto(`${PAGE}${query}`);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/is-enhanced/);
  if (scroll) await host.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
  return host;
}

/**
 * Leave the steps for free play, where the figure shows every control
 * (anim.css hides the secondary rows and the walk-through while a step is
 * on show). The last step, where free play starts, is the Whole clip in 3D.
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
 * Open the page and press Whole clip (3D) at step 1, on the vowel frame:
 * step 1 is One frame, so the figure no longer opens in 3D by itself.
 * @param {import("@playwright/test").Page} page
 * @param {{motion?: "reduce" | "no-preference"}} [opts]
 */
async function open3D(page, opts = {}) {
  const host = await open(page, opts);
  await settle(page, host);
  await host.getByRole("button", { name: "Whole clip (3D)" }).click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  return host;
}

/**
 * Free play in the Whole clip on the vowel frame, with every control shown.
 * @param {import("@playwright/test").Page} page
 */
async function openFree3D(page) {
  const host = await open(page);
  await settle(page, host);
  await free(host);
  // The last step's 3D entry, animation and all, ends before the pick.
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await three(page))?.reveal).toBe(1);
  await settle(page, host);
  await host.locator('.anim-controls [data-pick="vowel"]').click();
  await settle(page, host);
  // The 3D view takes the new frame on its next draw.
  // (A phone shortens it to "N of 8 above".)
  await expect.poll(async () => (await three(page))?.chip)
    .toMatch(new RegExp(`^threshold 0\\.55: ${above("lr-b", "vowel", THRESHOLD)} of 8 `));
  return host;
}

/** @param {import("@playwright/test").Page} page */
const three = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures["voicing-3d"];
  return f ? {
    builds: f.builds, played: f.played, reveal: f.reveal, shown: f.shown, pose: f.pose(), zoom: f.zoom(),
    frontPx: f.frontPx, ridges: f.ridges, segments: f.segments, planeY: f.planeY, chip: f.chip,
    labels: f.labels, objects: f.objects, chipBox: f.chipBox, dotsBox: f.dotsBox, planePx: f.planePx,
    frustum: f.frustum, dotHexes: f.dotHexes, leader: f.leader,
  } : null;
});
/** @param {import("@playwright/test").Page} page */
const flat = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures.voicing;
  return { state: f.state, readout: f.readout(), side: f.side(), playing: f.playing, caption: f.caption, step: f.step };
});
/** @param {import("@playwright/test").Locator} host @param {number} n 1-based */
async function toStep(host, n) {
  for (let i = 1; i < n; i += 1) await host.locator('[data-step="next"]').click();
  await expect(host.locator(".anim-steps__nav output")).toHaveText(`Step ${n} of 5`);
}
/** @param {import("@playwright/test").Locator} input @param {number | string} value */
const setRange = (input, value) =>
  input.evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
/** @param {import("@playwright/test").Locator} host @param {string} name */
const preset = (host, name) => host.locator(`.anim-view button[data-preset="${name}"]`).click();

/**
 * Voiced ridge pieces at threshold t, from the JSON: a segment between two
 * silent frames is silent; one with an end at or above t gives one voiced
 * piece (a crossing is cut where it crosses).
 * @param {string} clip @param {number} t
 */
const voicedPieces = (clip, t) => {
  const f = framesFile(clip).frames;
  let n = 0;
  for (let b = 0; b < 8; b += 1) {
    for (let i = 0; i + 1 < f.length; i += 1) {
      const a = f[i].derived;
      const c = f[i + 1].derived;
      if (a.decoded_rms_dbfs < -60 && c.decoded_rms_dbfs < -60) continue;
      if (a.band_voicing[b] >= t || c.band_voicing[b] >= t) n += 1;
    }
  }
  return n;
};
/** @param {string} clip @param {"vowel" | "fricative" | "mixed"} name @param {number} t */
const above = (clip, name, t) => pick(clip, name).derived.band_voicing.filter((v) => v >= t - 1e-9).length;

/* -- opening (owner decision O1) ------------------------------------------ */

test("first view: step 1 is One frame and loads nothing 3D; Whole clip then plays the animation once, landing at Corner", async ({ page }) => {
  await open(page, { scroll: false });
  await page.waitForLoadState("networkidle");
  const loaded = () => page.evaluate(() => performance.getEntriesByType("resource")
    .map((e) => e.name).filter((n) => /anim-voicing-3d\.js|anim-three\.js|three\.module/.test(n)));
  expect(await loaded()).toEqual([]);
  const host = page.locator(HOST);
  await host.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
  await settle(page, host);
  // Step 1 asks for One frame: near is not enough to open 3D.
  expect(await loaded()).toEqual([]);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await host.getByRole("button", { name: "Whole clip (3D)" }).click();
  await page.locator(CANVAS_3D).waitFor();
  await settle(page, host);
  expect((await loaded()).length).toBeGreaterThan(0);
  const t = await three(page);
  expect(t?.played).toBe(1);
  expect(t?.reveal).toBe(1);
  expect(t?.pose).toEqual({ yaw: 35, pitch: 30 });
  expect((await hook(page)).played.voicing).toBe(1);
  await expect(host.getByRole("button", { name: "Whole clip (3D)" })).toHaveAttribute("aria-pressed", "true");
  await expect(host.getByRole("button", { name: "One frame" })).toHaveAttribute("aria-pressed", "false");
  // A park and unpark (scrolled far away and back) never replays it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await host.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
  await settle(page, host);
  expect((await three(page))?.played).toBe(1);
});

test("the animation starts at Side on the frame alone, waits to be half seen, then grows out along time while it turns", async ({ page }) => {
  const host = await open(page, { scroll: false });
  await page.waitForLoadState("networkidle");
  // A third of the frame on screen: near, so the view opens and draws, but
  // not half seen, so the animation waits on its start.
  await host.locator(".anim-figure__frame").evaluate((frame) => {
    const box = frame.getBoundingClientRect();
    window.scrollBy(0, box.top - window.innerHeight + box.height / 3);
  });
  // Pressed without scrolling it into view, as a reader might from the keyboard.
  await host.getByRole("button", { name: "Whole clip (3D)" }).evaluate((b) => /** @type {HTMLElement} */ (b).click());
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(1500);
  let t = await three(page);
  expect(t?.reveal).toBe(0);
  expect(t?.pose).toEqual({ yaw: 90, pitch: 0 });
  await host.locator(".anim-figure__frame").evaluate((f) => f.scrollIntoView({ block: "center" }));
  await expect.poll(async () => (await three(page))?.reveal).toBe(1);
  await settle(page, host);
  t = await three(page);
  expect(t?.pose).toEqual({ yaw: 35, pitch: 30 });
  // On the way: grown part way while the camera was between Side and Corner.
  const trace = await page.evaluate(() => /** @type {any} */ (window).__ambeAnim.figures["voicing-3d"].trace);
  expect(trace.some(([r, yaw]) => r > 0 && r < 1 && yaw < 90 && yaw > 35)).toBe(true);
});

test("reduced motion: opens One frame and loads nothing 3D; Whole clip lands on the end state with no motion", async ({ page }) => {
  // Tall enough that the frame stays on screen beside the controls.
  await page.setViewportSize({ width: 1280, height: 2000 });
  const host = await open(page, { motion: "reduce" });
  await settle(page, host);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  expect((await flat(page)).state.view).toBe("2d");
  await host.getByRole("button", { name: "Whole clip (3D)" }).click();
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(300);
  const t = await three(page);
  expect(t?.played).toBe(0);
  expect(t?.reveal).toBe(1);
  expect(t?.pose).toEqual({ yaw: 35, pitch: 30 });
  for (const name of ["top", "side", "corner"]) {
    const before = (await hook(page)).renders;
    await preset(host, name);
    await page.waitForTimeout(300);
    expect((await hook(page)).renders - before, name).toBe(1);
  }
});

/* -- the Side preset against the One frame view ---------------------------- */

for (const { name, width } of [{ name: "desktop", width: 1280 }, { name: "phone", width: 375 }]) {
  test(`Side at 1x puts each band where the One frame view does, and 0 to 1 on its spectrum, within 0.5 px (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await open(page, { motion: "reduce" });
    await settle(page, host);
    await host.getByRole("button", { name: "Whole clip (3D)" }).click();
    await page.locator(CANVAS_3D).waitFor();
    await preset(host, "side");
    await settle(page, host);
    const t = await three(page);
    expect(t?.zoom).toBe(1);
    const { side, state } = await flat(page);
    const v = framesFile("lr-b").frames[state.index].derived.band_voicing;
    for (let b = 0; b < 8; b += 1) {
      expect(Math.abs((t?.frontPx[b][0] ?? 0) - side.xs[b]), `band ${b + 1} x`).toBeLessThanOrEqual(0.5);
      const y = side.bottom - v[b] * (side.bottom - side.top);
      expect(Math.abs((t?.frontPx[b][1] ?? 0) - y), `band ${b + 1} y`).toBeLessThanOrEqual(0.5);
    }
  });
}

/* -- what it draws ---------------------------------------------------------- */

test("ridges are cut at the threshold, the plane and the chip follow it, and a clip change redraws", async ({ page }) => {
  const host = await openFree3D(page);
  let t = await three(page);
  expect(t?.ridges.voiced).toBe(voicedPieces("lr-b", THRESHOLD));
  expect(t?.ridges.minVoicedY).toBeGreaterThanOrEqual(THRESHOLD - 1e-5);
  expect(t?.ridges.maxUnvoicedY).toBeLessThanOrEqual(THRESHOLD + 1e-5);
  expect(t?.planeY).toBeCloseTo(THRESHOLD, 6);
  expect(t?.chip).toBe(`threshold 0.55: ${above("lr-b", "vowel", THRESHOLD)} of 8 bands above`);
  await setRange(host.locator('.anim-controls [data-role="threshold"]'), "0.8");
  await expect.poll(async () => (await three(page))?.planeY).toBeCloseTo(0.8, 6);
  t = await three(page);
  expect(t?.ridges.voiced).toBe(voicedPieces("lr-b", 0.8));
  expect(t?.ridges.minVoicedY).toBeGreaterThanOrEqual(0.8 - 1e-5);
  expect(t?.ridges.maxUnvoicedY).toBeLessThanOrEqual(0.8 + 1e-5);
  expect(t?.chip).toBe(`threshold 0.80: ${above("lr-b", "vowel", 0.8)} of 8 bands above`);
  await host.locator('.anim-controls [data-clip="lj-c"]').click();
  await expect.poll(async () => (await three(page))?.ridges.voiced).toBe(voicedPieces("lj-c", 0.8));
});

test("a threshold change is a wave: the plane slides through the values between", async ({ page }) => {
  const host = await openFree3D(page);
  await setRange(host.locator('.anim-controls [data-role="threshold"]'), "0.3");
  await expect.poll(async () => (await three(page))?.shown ?? 0, { intervals: [5] }).toBeLessThan(0.55);
  const mid = (await three(page))?.shown ?? 0;
  expect(mid).toBeGreaterThan(0.3 - 1e-9);
  await expect.poll(async () => (await three(page))?.shown).toBeCloseTo(0.3, 6);
});

test("the legend lists the 3D items in 3D and the One frame items in One frame", async ({ page }) => {
  const host = await openFree3D(page);
  const three3 = host.locator('.anim-legend [data-legend="three"]');
  await expect(three3).toHaveCount(5);
  for (const item of await three3.all()) await expect(item).toBeVisible();
  await expect(host.locator('.anim-legend [data-legend="spectrum"]')).toBeHidden();
  await expect(host.locator(".anim-legend")).toContainText("this frame (thick line), one row of the clip");
  await expect(host.locator(".anim-legend")).toContainText("where the threshold cuts this frame (thick), a dashed stem from each band");
  // The 3D view is the band strengths: the switch is held on.
  await expect(host.locator('.anim-controls [data-role="measure"]')).toBeDisabled();
  await expect(host.locator('.anim-controls [data-role="measure"]')).toHaveAttribute("aria-pressed", "true");
  await host.getByRole("button", { name: "One frame" }).click();
  for (const item of await three3.all()) await expect(item).toBeHidden();
  await expect(host.locator('.anim-legend [data-legend="spectrum"]')).toBeVisible();
  await expect(host.locator('.anim-controls [data-role="measure"]')).toBeEnabled();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
});

test("highlight: 3:1 on the plot and the stage in both themes; the chip and the zoom sentence", async ({ page }) => {
  const host = await open3D(page);
  /** WCAG contrast of two #rrggbb colours. @param {string} a @param {string} b */
  const contrast = (a, b) => {
    const lum = (/** @type {string} */ hex) => {
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  for (const scheme of ["slate", "default"]) {
    const values = await host.locator(".anim-figure__frame").evaluate((frame, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(frame);
      return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
    }, scheme);
    for (const ground of values.slice(1)) expect(contrast(values[0], ground), `${scheme} ${ground}`).toBeGreaterThanOrEqual(3);
  }
  await expect(host.locator(".anim-chip")).toHaveCount(1);
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /Zoom with the buttons, or with plus and minus when focused\.$/);
  await expect(page.locator(CANVAS_3D)).toHaveAttribute("aria-label", /band frames lie above it/);
});

/** @param {{left: number, right: number, top: number, bottom: number}} a @param {{left: number, right: number, top: number, bottom: number}} b */
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

for (const { name, width } of [{ name: "desktop", width: 1280 }, { name: "phone", width: 390 }]) {
  test(`the chip sits at Corner beside the cut's band-8 end, clear of the frame's dots, for the vowel and the mixed frame (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await openFree3D(page);
    for (const which of ["vowel", "mixed"]) {
      await host.locator(`.anim-controls [data-pick="${which}"]`).click();
      await settle(page, host);
      await host.locator(".anim-figure__frame").scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const t = await three(page);
      if (!t?.chipBox) throw new Error("no chip");
      expect(t.pose).toEqual({ yaw: 35, pitch: 30 });
      expect(t.chip).toContain(`${above("lr-b", which, THRESHOLD)} of 8`);
      expect(overlaps(t.chipBox, t.dotsBox), `${which}: chip ${JSON.stringify(t.chipBox)} dots ${JSON.stringify(t.dotsBox)}`).toBe(false);
      // Close to its anchor, the band-8 end of the cut: a short leader.
      expect(t.leader, which).toBeLessThanOrEqual(60);
    }
  });
}

test("phone: at Corner the plane spans at least 80% of the frame's width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const host = await open3D(page);
  const t = await three(page);
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  if (!t || !frame) throw new Error("no view");
  const xs = t.planePx.map((p) => p[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(0.8 * frame.width);
});

test("Corner pressed after Top and Side frames the scene as the opening Corner, its labels inside the frame's margin", async ({ page }) => {
  const host = await open3D(page);
  const opening = (await three(page))?.frustum ?? [];
  for (const name of ["top", "side", "corner"]) {
    await preset(host, name);
    await settle(page, host);
    await page.waitForTimeout(200);
  }
  const t = await three(page);
  t?.frustum.forEach((v, k) => expect(v, `frustum ${k}`).toBeCloseTo(opening[k], 4));
  const frame = await host.locator(".anim-figure__frame").boundingBox();
  if (!frame) throw new Error("no frame");
  const margin = Math.round(Math.min(frame.width, frame.height) * 0.05);
  await expect(host.locator(".anim-figure__label:visible")).toHaveCount(3);
  for (const label of await host.locator(".anim-figure__label:visible").all()) {
    const b = await label.boundingBox();
    if (!b) throw new Error("no label box");
    expect(b.x).toBeGreaterThanOrEqual(frame.x + margin - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width - margin + 1);
  }
});

test("3D: a scheme change recolours from the new tokens and draws again", async ({ page }) => {
  const host = await open3D(page);
  const tokens = () => host.locator(".anim-figure__frame").evaluate((f) => {
    const style = getComputedStyle(f);
    return ["--ambe-voiced", "--ambe-unvoiced"].map((n) => parseInt(style.getPropertyValue(n).trim().slice(1), 16));
  });
  const expected = (/** @type {number[]} */ [voiced, unvoiced]) =>
    pick("lr-b", "vowel").derived.band_voicing.map((v) => (v >= THRESHOLD - 1e-9 ? voiced : unvoiced));
  const before = await tokens();
  expect((await three(page))?.dotHexes).toEqual(expected(before));
  const renders = (await hook(page)).renders;
  await page.evaluate(() => {
    const body = document.body;
    body.setAttribute("data-md-color-scheme", body.getAttribute("data-md-color-scheme") === "default" ? "slate" : "default");
  });
  const after = await tokens();
  expect(after).not.toEqual(before);
  await expect.poll(async () => (await three(page))?.dotHexes).toEqual(expected(after));
  await expect.poll(async () => (await hook(page)).renders).toBeGreaterThan(renders);
});

/* -- the steps in 3D --------------------------------------------------------- */

test("steps 1 to 4 show One frame; step 5 enters 3D with its animation; Previous leaves it", async ({ page }) => {
  const host = await open(page);
  await settle(page, host);
  for (let n = 1; n <= 4; n += 1) {
    if (n > 1) await host.locator('[data-step="next"]').click();
    await expect(host.locator(".anim-steps__nav output")).toHaveText(`Step ${n} of 5`);
    expect((await flat(page)).state.view, `step ${n}`).toBe("2d");
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
    // In One frame each step's own Band strengths setting holds.
    expect((await flat(page)).state.measure, `step ${n}`).toBe(false);
  }
  await host.locator('[data-step="next"]').click();
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await three(page))?.played ?? 0).toBe(1);
  await settle(page, host);
  const t = await three(page);
  expect(t?.reveal).toBe(1);
  expect(t?.chip).toBe(`threshold 0.55: ${above("lr-b", "mixed", THRESHOLD)} of 8 bands above`);
  expect((await flat(page)).readout).toContain(`${above("lr-b", "mixed", THRESHOLD)} of 8 bands periodic at 0.55`);
  await host.locator('[data-step="prev"]').click();
  await expect.poll(async () => (await flat(page)).state.view).toBe("2d");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
});

/* -- the walk-through ------------------------------------------------------- */

test("walk-through: Play runs the steps with captions and no citations; the step slider jumps; a press hands it back", async ({ page }) => {
  test.setTimeout(120_000);
  const host = await open(page);
  await settle(page, host);
  // The walk-through is a free-play control: the steps hide it.
  await expect(host.getByRole("button", { name: "Play the walk-through" })).toBeHidden();
  await free(host);
  const play = host.getByRole("button", { name: "Play the walk-through" });
  await play.click();
  await expect(host.getByRole("button", { name: "Pause the walk-through" })).toHaveAttribute("aria-pressed", "true");
  let f = await flat(page);
  expect(f.playing).toBe(true);
  // From the last step it starts again at step 1, in One frame.
  expect(f.step).toBe(0);
  // Step 1's text, a sentence at a time (a slow machine may be on the second).
  expect(["This frame comes from a vowel.", "With one switch set to Voiced, the model's harmonic comb fits the spectrum."])
    .toContain(f.caption);
  await expect(host.locator('[data-role="tour-caption"]')).toBeVisible();
  await expect.poll(async () => (await flat(page)).state.view, { timeout: 30_000 }).toBe("2d");
  // Next on the step row moves it on, twice to step 3, and it goes on
  // playing from there.
  await host.locator('[data-step="next"]').click();
  await host.locator('[data-step="next"]').click();
  f = await flat(page);
  expect(f.step).toBe(2);
  expect(f.playing).toBe(true);
  expect(f.caption).toMatch(/^This frame repeats at the bottom/);
  // No citation text in a caption.
  await expect.poll(async () => (await flat(page)).caption, { timeout: 60_000 }).toMatch(/^Griffin and Lim call/);
  expect((await flat(page)).caption).toBe("Griffin and Lim call what you hear in this case buzz.");
  // Any other control hands the figure back.
  await host.locator('.anim-controls [data-pick="vowel"]').click();
  f = await flat(page);
  expect(f.playing).toBe(false);
  await expect(host.locator('[data-role="tour-caption"]')).toBeHidden();
  await expect(play).toHaveAttribute("aria-pressed", "false");
});

test("walk-through: from step 4 it shows the eight switches fitted, no band tinted; Pause stops it", async ({ page }) => {
  test.setTimeout(90_000);
  const host = await open(page);
  await settle(page, host);
  await free(host);
  await host.getByRole("button", { name: "Play the walk-through" }).click();
  // Next moves the walk-through on: three presses to step 4.
  for (let i = 0; i < 3; i += 1) await host.locator('[data-step="next"]').click();
  expect((await flat(page)).step).toBe(3);
  const fit = pick("lr-b", "mixed").derived.band_voicing.map((v) => v >= THRESHOLD);
  await expect.poll(async () => (await flat(page)).state.choice, { timeout: 20_000 }).toEqual(fit);
  await expect(host.locator('[data-role="readout"]')).toContainText("Model and band strengths agree in every band");
  await host.getByRole("button", { name: "Pause the walk-through" }).click();
  expect((await flat(page)).playing).toBe(false);
});

test("walk-through under reduced motion: the steps' end states, no 3D motion", async ({ page }) => {
  test.setTimeout(90_000);
  const host = await open(page, { motion: "reduce" });
  await settle(page, host);
  await free(host);
  await host.getByRole("button", { name: "Play the walk-through" }).click();
  for (let i = 0; i < 3; i += 1) await host.locator('[data-step="next"]').click();
  const fit = pick("lr-b", "mixed").derived.band_voicing.map((v) => v >= THRESHOLD);
  await expect.poll(async () => (await flat(page)).state.choice, { timeout: 20_000 }).toEqual(fit);
  // Step 5 opens 3D on its end state.
  await expect.poll(async () => (await flat(page)).step, { timeout: 60_000 }).toBe(4);
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(async () => (await three(page))?.reveal).toBe(1);
  expect((await three(page))?.pose).toEqual({ yaw: 35, pitch: 30 });
  expect((await hook(page)).tracks.voicing ?? 0).toBeLessThanOrEqual(3);
});

/* -- the 3D lifecycle -------------------------------------------------------- */

test("context loss: paused, resume rebuilds, readouts unchanged", async ({ page }) => {
  const host = await open3D(page);
  const before = await three(page);
  const readout = (await flat(page)).readout;
  await page.locator(CANVAS_3D).evaluate((c) => {
    if (!(c instanceof HTMLCanvasElement)) throw new Error("no canvas");
    c.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(host.locator('.anim-figure__frame[data-state="paused"]')).toBeVisible();
  await host.locator(".anim-figure__resume").click();
  await expect.poll(async () => (await three(page))?.builds).toBe((before?.builds ?? 0) + 1);
  const after = await three(page);
  expect(after?.objects).toBe(before?.objects);
  expect(after?.ridges).toEqual(before?.ridges);
  expect((await flat(page)).readout).toBe(readout);
});

for (const motion of /** @type {const} */ (["no-preference", "reduce"])) {
  test(`no WebGL (${motion}): One frame works, Whole clip disabled with the hint, step 5 stays in One frame`, async ({ page }) => {
    const host = await open(page, { motion, query: "?nowebgl" });
    await settle(page, host);
    await expect(host.getByRole("button", { name: "Whole clip (3D)" })).toBeDisabled();
    await expect(host.locator(".anim-figure__hint--webgl")).toHaveText("3D needs WebGL 2");
    await expect(host.locator(".anim-figure__hint--webgl")).toBeVisible();
    await expect(host.getByRole("button", { name: "One frame" })).toHaveAttribute("aria-pressed", "true");
    await expect(host.locator(".anim-figure__frame > canvas")).toBeVisible();
    await toStep(host, 5);
    await expect(host.locator('[data-role="readout"]')).toContainText(`${above("lr-b", "mixed", THRESHOLD)} of 8 bands periodic at 0.55`);
    expect((await flat(page)).state.view).toBe("2d");
    expect((await hook(page)).liveContexts).toBe(0);
  });
}

test("toggle 3D five times quickly: no stray context or labels", async ({ page }) => {
  const host = await open(page, { motion: "reduce" });
  await settle(page, host);
  const whole = host.getByRole("button", { name: "Whole clip (3D)" });
  const one = host.getByRole("button", { name: "One frame" });
  for (let k = 0; k < 5; k += 1) {
    await whole.click();
    await one.click();
  }
  await page.waitForTimeout(800);
  const h = await hook(page);
  expect(h.liveContexts).toBe(0);
  // A view still waiting for its first draw lets its context go as the
  // reader leaves (link.leave), so two never overlap.
  expect(h.peakContexts).toBeLessThanOrEqual(1);
  await expect(host.locator(".anim-figure__overlay")).toHaveCount(0);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await whole.click();
  await page.locator(CANVAS_3D).waitFor();
  expect((await hook(page)).liveContexts).toBe(1);
  // Pressing Whole clip again keeps it.
  await whole.click();
  await page.waitForTimeout(300);
  await expect(page.locator(CANVAS_3D)).toHaveCount(1);
});

test("ten navigations: one context at most, observers back to baseline", async ({ page }) => {
  /** @type {string[]} */
  const messages = [];
  page.on("console", (m) => messages.push(m.text()));
  await countAnimObservers(page);
  // Under reduced motion harmonics (above voicing on ch07) and the ch08
  // figures stay in 2D, so every live context is voicing's, opened by its
  // own control after each navigation.
  const host = await open(page, { motion: "reduce" });
  const whole = host.getByRole("button", { name: "Whole clip (3D)" });
  await whole.click();
  await page.locator(CANVAS_3D).waitFor();
  // @ts-ignore test-only global
  const observers = await page.evaluate(() => window.__obs.live);
  for (let k = 0; k < 10; k += 1) {
    await page.locator(`${HOST} .anim-figure__frame`).scrollIntoViewIfNeeded();
    if ((await page.locator(CANVAS_3D).count()) === 0) await whole.click();
    await page.locator(CANVAS_3D).waitFor();
    expect((await hook(page)).liveContexts).toBe(1);
    await page.locator('a.md-nav__link[href$="08-analysis/"]').first().click();
    await page.waitForURL(/08-analysis\/$/);
    await page.locator('[data-anim="frames"] canvas').first().waitFor();
    await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
    await page.locator('a.md-nav__link[href$="07-multi-band-excitation/"]').first().click();
    await page.waitForURL(/07-multi-band-excitation\/$/);
    await expect(page.locator(HOST)).toHaveClass(/is-enhanced/);
  }
  await page.locator(`${HOST} .anim-figure__frame`).scrollIntoViewIfNeeded();
  await whole.click();
  await page.locator(CANVAS_3D).waitFor();
  const h = await hook(page);
  expect(h.peakContexts).toBe(1);
  expect(h.webglProbes).toBe(1);
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBe(observers);
  expect(messages.filter((m) => /too many active webgl contexts/i.test(m))).toEqual([]);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 3 });
  test("phone: no horizontal scroll, labels and the chip inside the frame", async ({ page }) => {
    const host = await open3D(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    for (const name of ["corner", "top", "side"]) {
      await preset(host, name);
      await settle(page, host);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      const frame = await host.locator(".anim-figure__frame").boundingBox();
      if (!frame) throw new Error("no frame");
      // lib/labels.js hides a label pushed into the bottom 56 px or off the
      // frame, so a lost label shows up as a missing one: count them first.
      await expect(host.locator(".anim-figure__label"), name).toHaveCount(2);
      await expect(host.locator(".anim-figure__label:visible"), name).toHaveCount(2);
      for (const label of await host.locator(".anim-figure__label:visible").all()) {
        const b = await label.boundingBox();
        if (!b) throw new Error("no label box");
        expect(b.height, name).toBeGreaterThanOrEqual(11);
      }
      // Labels and the chip clear of the bottom strip, where the overlay
      // and the hint sit.
      for (const box of [...await host.locator(".anim-figure__label:visible").all(), host.locator(".anim-chip")]) {
        const b = await box.boundingBox();
        if (!b) throw new Error("no box");
        expect(b.x, name).toBeGreaterThanOrEqual(frame.x);
        expect(b.x + b.width, name).toBeLessThanOrEqual(frame.x + frame.width);
        expect(b.y, name).toBeGreaterThanOrEqual(frame.y);
        expect(b.y + b.height, name).toBeLessThanOrEqual(frame.y + frame.height - 56);
      }
    }
  });
});

/* -- pixels ------------------------------------------------------------------ */

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  { name: "phone", viewport: { width: 375, height: 800 }, deviceScaleFactor: 3 },
];

for (const vp of VIEWPORTS) {
  test.describe(`screens ${vp.name}`, () => {
    test.use({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor });
    test(`screens: Whole clip at Corner, Top and Side (${vp.name})`, async ({ page }) => {
      const host = await open(page, { motion: "reduce" });
      await settle(page, host);
      await host.getByRole("button", { name: "Whole clip (3D)" }).click();
      await page.locator(CANVAS_3D).waitFor();
      for (const name of ["corner", "top", "side"]) {
        await preset(host, name);
        await settle(page, host);
        await expect(host.locator(".anim-figure__frame")).toHaveScreenshot(`${vp.name}-3d-${name}.png`, {
          maxDiffPixelRatio: 0.01, stylePath: STYLE_PATH,
        });
      }
    });
  });
}
