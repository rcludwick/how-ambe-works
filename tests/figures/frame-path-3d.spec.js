// frame-path's 3D view (ch10, three-everywhere plan F12): the opening rule,
// the explanatory animation's end state, the highlight that has to stand
// out, the front preset against the 2D plot, the cutaway, stage 7's rows,
// and the walk-through.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { hexBits } from "../../docs/javascripts/anim-core.js";
import { hook } from "./helpers.js";

const PAGE = "10-the-dstar-frame/";
const HOST = '[data-anim="frame-path"]';
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {string} clip @returns {FramesFile} */
const framesFile = (clip) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/frames.json`, import.meta.url), "utf8"));
/** @param {string} clip @returns {SpectraFile} */
const spectraFile = (clip) =>
  JSON.parse(readFileSync(new URL(`../../docs/assets/data/${clip}/spectra.json`, import.meta.url), "utf8"));

/**
 * The 16-bit samples of a mono WAV, as integers.
 * @param {string} clip
 */
function wavSamples(clip) {
  const bytes = readFileSync(new URL(`../../docs/assets/audio/${clip}-original.wav`, import.meta.url));
  let at = 12;
  while (at < bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === "data") {
      const out = new Int16Array(size / 2);
      for (let n = 0; n < out.length; n += 1) out[n] = bytes.readInt16LE(at + 8 + n * 2);
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

/**
 * Open ch10 and wait for the 3D view.
 * @param {import("@playwright/test").Page} page
 * @param {string} [query]
 */
async function open3d(page, query = "") {
  await page.goto(PAGE + query);
  await page.locator(HOST).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    // @ts-ignore test-only global
    return Boolean(window.__ambeAnim?.figures?.["frame-path-3d"]);
  });
  await page.locator(CANVAS_3D).waitFor();
  await land(page);
}

/**
 * Step to Free play, where the walk-through's bar shows.
 * @param {import("@playwright/test").Page} page
 */
async function freePlay(page) {
  const next = page.locator(`${HOST} .anim-steps__nav [data-step="next"]`);
  while ((await next.textContent()) !== "Free play") await next.click();
  await next.click();
  await expect(page.locator(`${HOST} [data-ref="play"]`)).toBeVisible();
}

/** How many walk-through camera moves the 3D view has begun (0 while it is closed). @param {import("@playwright/test").Page} page */
const tourMoves = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  return window.__ambeAnim.figures["frame-path-3d"]?.tour.started ?? 0;
});

/** @param {import("@playwright/test").Page} page */
const land = (page) => page.evaluate(async () => {
  // @ts-ignore test-only global
  await window.__ambeAnim.figures["frame-path"].settled;
  // @ts-ignore test-only global
  window.__ambeAnim.finishAll();
});

/** @param {import("@playwright/test").Page} page */
const view = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures["frame-path-3d"];
  return { pose: f.pose, zoom: f.zoom, played: f.played, part: f.part, labels: f.labels, tour: f.tour, builds: f.builds };
});

/** @param {import("@playwright/test").Page} page */
const figure = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures["frame-path"];
  return { state: f.state, tour: f.tour, readout: f.readout, plotRect: f.plotRect };
});

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} n
 */
async function stage(page, n) {
  await page.locator(`${HOST} button[data-stage="${n}"]`).click();
  await land(page);
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

test("opens in 3D and plays its animation once; a park and unpark does not replay it", async ({ page }) => {
  await page.goto(`${PAGE}?three-cap=1`);
  const host = page.locator(HOST);
  await host.scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  await land(page);
  expect((await hook(page)).played["frame-path"]).toBe(1);
  expect((await view(page)).played).toBe(1);
  // Away and back: the bits figure further down takes the one slot.
  await page.locator('[data-anim="bits"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await host.scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  await land(page);
  expect((await hook(page)).played["frame-path"]).toBe(1);
  expect((await view(page)).played).toBe(1);
});

test("nothing 3D is requested before the figure comes near", async ({ page }) => {
  /** @type {string[]} */
  const requested = [];
  page.on("request", (r) => requested.push(r.url()));
  await page.goto(PAGE);
  await page.waitForLoadState("networkidle");
  // The host sits below the first screen? Then nothing 3D has loaded yet.
  const below = await page.locator(HOST).evaluate((h) => h.getBoundingClientRect().top > 2 * innerHeight);
  if (below) expect(requested.filter((u) => /anim-frame-path-3d|three\.module/.test(u))).toEqual([]);
  await page.locator(HOST).scrollIntoViewIfNeeded();
  await page.locator(CANVAS_3D).waitFor();
  expect(requested.some((u) => u.includes("anim-frame-path-3d.js"))).toBe(true);
});

test("the animation's end state: the slice in place, the stack spread, the camera at Corner", async ({ page }) => {
  await open3d(page);
  const v = await view(page);
  expect(v.pose).toEqual({ yaw: -32, pitch: 24 });
  expect(v.part.subject).toBe("slice");
  expect(v.part.chip).toBe("this frame: 160 samples, 20 ms");
  // Every neighbour sits in its 20 ms slot: 0.22 apart, later frames behind.
  const zs = await page.evaluate(() => {
    // @ts-ignore test-only global
    const f = window.__ambeAnim.figures["frame-path-3d"];
    /** @type {Set<string>} */
    const z = new Set();
    f.three.scene.traverse((/** @type {any} */ node) => {
      if (!node.isLineSegments2 || !node.material.fog) return;
      const a = node.geometry.attributes.instanceStart.data.array;
      for (let i = 2; i < a.length; i += 6) z.add((a[i] / 0.22).toFixed(2));
    });
    return [...z].map(Number).sort((a, b) => a - b);
  });
  expect(zs).toEqual([-8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("the highlight stands out: its kit is drawn, and its colour holds 3:1 on the plot and the stage in both themes", async ({ page }) => {
  await open3d(page);
  for (const scheme of ["slate", "default"]) {
    const kit = await page.evaluate((s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      // @ts-ignore test-only global
      const f = window.__ambeAnim.figures["frame-path-3d"];
      const frame = document.querySelector('[data-anim="frame-path"] .anim-figure__frame');
      const style = getComputedStyle(/** @type {Element} */ (frame));
      /** @type {number[]} */
      const widths = [];
      f.three.scene.traverse((/** @type {any} */ node) => {
        if (node.isLineSegments2 && !node.material.vertexColors && node.material.linewidth > 3) widths.push(node.material.linewidth);
      });
      const chip = document.querySelector('[data-anim="frame-path"] .anim-chip');
      return {
        highlight: style.getPropertyValue("--ambe-highlight").trim(),
        grounds: ["--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim()),
        widths,
        chip: chip?.textContent ?? "",
      };
    }, scheme);
    for (const ground of kit.grounds) expect(contrast(kit.highlight, ground), `${scheme} on ${ground}`).toBeGreaterThanOrEqual(3);
    // The 3.25 px line and the 9 px glow, against the context's 1.25 px.
    expect(kit.widths).toEqual(expect.arrayContaining([3.25, 9]));
    expect(kit.chip).toContain("this frame: 160 samples, 20 ms");
  }
});

test("front at stages 1, 2, 3 and 6 lies on the 2D plot within 0.5 px", async ({ page }) => {
  test.setTimeout(120_000);
  await open3d(page);
  await page.locator(`${HOST} button[data-preset="front"]`).click();
  await land(page);
  const spectra = spectraFile("lr-b");
  const k = (await figure(page)).state.frame;
  for (const n of [1, 2, 3, 6]) {
    await stage(page, n);
    const { points, rect } = await page.evaluate(() => {
      // @ts-ignore test-only global
      const w = window.__ambeAnim;
      return { points: w.figures["frame-path-3d"].frontPoints, rect: w.figures["frame-path"].plotRect };
    });
    expect(rect).not.toBeNull();
    if (n === 1) {
      // Sample i at x = rect.x + rect.width i / 159, and its value on the
      // 2D plot's scale: the rectangle spans ±v of the clip's peak.
      const pcm = wavSamples("lr-b");
      let peak = 0;
      for (const x of pcm) peak = Math.max(peak, Math.abs(x));
      const v = 0.5 / 0.47;
      for (const i of [0, 40, 80, 120, 159]) {
        const y = rect.y + rect.height * (1 - (pcm[k * 160 + i] / peak / v + 1) / 2);
        expect(Math.abs(points[i].x - (rect.x + (rect.width * i) / 159)), `stage 1 sample ${i} x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(points[i].y - y), `stage 1 sample ${i} y`).toBeLessThanOrEqual(0.5);
      }
    } else if (n === 3) {
      // The step curve over the eight bands: band b from b/8 to (b + 1)/8.
      const strengths = framesFile("lr-b").frames[k].derived.band_voicing;
      for (let b = 0; b < 8; b += 1) {
        const x = rect.x + (rect.width * b) / 8;
        const y = rect.y + rect.height * (1 - Math.min(1, Math.max(0, strengths[b])));
        expect(Math.abs(points[2 * b].x - x), `stage 3 band ${b} x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(points[2 * b].y - y), `stage 3 band ${b} y`).toBeLessThanOrEqual(0.5);
      }
    } else {
      const row = (n === 2 ? spectra.original : spectra.decoded)[k];
      for (const b of [0, 32, 64, 127]) {
        const hz = spectra.bin_centre_hz[b];
        const db = Math.min(-10, Math.max(-90, row[b]));
        const x = rect.x + (rect.width * hz) / 4000;
        const y = rect.y + rect.height * (1 - (db + 90) / 80);
        expect(Math.abs(points[b].x - x), `stage ${n} bin ${b} x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(points[b].y - y), `stage ${n} bin ${b} y`).toBeLessThanOrEqual(0.5);
      }
    }
  }
});

test("the cutaway: rows of cells in front hide below 60 degrees and come back at Top", async ({ page }) => {
  await open3d(page);
  await stage(page, 5);
  let v = await view(page);
  expect(v.part.subject).toBe("row");
  expect(v.part.cut).toBe(true);
  expect(v.part.hidden).toBe(1);
  expect(v.labels).not.toContain("earlier frames, 20 ms apart");
  await page.locator(`${HOST} button[data-preset="top"]`).click();
  await land(page);
  v = await view(page);
  expect(v.part.cut).toBe(false);
  expect(v.part.hidden).toBe(0);
});

test("stage 5: the selected row is the frame's 72 bits, 17 rows in all", async ({ page }) => {
  await open3d(page);
  await stage(page, 5);
  const k = (await figure(page)).state.frame;
  const v = await view(page);
  expect(v.part.cells).toEqual(Array.from(hexBits(framesFile("lr-b").frames[k].hex)));
  expect(v.part.rows).toBe(17);
  expect(v.part.chip).toBe("this frame: 72 bits, 20 ms");
});

test("stage 7: 21 rows of 96 cells, the next sync slot labelled, and the chip", async ({ page }) => {
  await open3d(page);
  await stage(page, 7);
  const v = await view(page);
  expect(v.part.rows).toBe(21);
  expect(v.part.cells.length).toBe(72);
  expect(v.part.chip).toBe("this frame: 72 voice bits, 24 data bits");
  // On the sync row, with the wait to lock (frame 102: frame 105 is 3 on, a wait of 4 frames).
  expect(v.labels).toContain("next sync slot\n80 ms to lock");
  const counts = await page.evaluate(() => {
    // @ts-ignore test-only global
    const f = window.__ambeAnim.figures["frame-path-3d"];
    let vertices = 0;
    f.three.scene.traverse((/** @type {any} */ node) => {
      if (node.isMesh && node.material.vertexColors && node.geometry.getAttribute("color")) {
        vertices += node.geometry.getAttribute("position").count;
      }
    });
    return vertices;
  });
  // 21 rows x 96 cells x 4 faces x 6 vertices, plus the floor's none.
  expect(counts).toBeGreaterThanOrEqual(21 * 96 * 24);
});

test("stage 4 to 5: the curve collapses onto the bits and lands on the end state", async ({ page }) => {
  await open3d(page);
  await stage(page, 4);
  expect((await view(page)).part.subject).toBe("encoder");
  await page.locator(`${HOST} button[data-stage="5"]`).click();
  await land(page);
  const v = await view(page);
  expect(v.part.subject).toBe("row");
  const hidden = await page.evaluate(() => {
    // @ts-ignore test-only global
    const f = window.__ambeAnim.figures["frame-path-3d"];
    let thin = 0;
    f.three.scene.traverse((/** @type {any} */ node) => {
      if (node.isLineSegments2 && node.material.linewidth === 2 && node.visible) thin += 1;
    });
    return thin;
  });
  expect(hidden).toBe(0);
});

test("a frame change pulses the slice and keeps the stack in place", async ({ page }) => {
  await open3d(page);
  await page.locator(`${HOST} [data-ref="frame"]`).evaluate((input) => {
    const range = /** @type {HTMLInputElement} */ (input);
    range.value = "48";
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await land(page);
  const v = await view(page);
  expect((await figure(page)).state.frame).toBe(48);
  expect(v.part.chip).toBe("this frame: 160 samples, 20 ms");
});

test("walk-through: from Free play, Play runs the steps in order with each step's text as the caption", async ({ page }) => {
  test.setTimeout(120_000);
  await open3d(page);
  const play = page.locator(`${HOST} [data-ref="play"]`);
  // While the reader steps, the bar waits for Free play.
  await expect(play).toBeHidden();
  await freePlay(page);
  await expect(play).toHaveText("Play the walk-through");
  const caption = page.locator(`${HOST} [data-ref="caption"]`);
  await expect(caption).toBeHidden();
  await play.click();
  await expect(play).toHaveText("Pause");
  // The walk-through steps the figure, and its bar stays up while it runs.
  await expect(play).toBeVisible();
  await expect(caption).toBeVisible();
  await expect(caption).toContainText("Here are 20 ms of microphone audio");
  let t = await figure(page);
  expect(t.tour).toMatchObject({ playing: true, index: 0 });
  // Step 1 asks for 3D: the view comes back and the camera moves with the step.
  await page.locator(CANVAS_3D).waitFor();
  await expect.poll(() => tourMoves(page)).toBeGreaterThan(0);
  // A pip jumps to its step and the walk-through goes on from there.
  await page.locator(`${HOST} [data-tour-step="1"]`).click();
  await expect.poll(async () => (await figure(page)).state.stage).toBe(2);
  await expect(caption).toContainText("The encoder finds the pitch");
  await expect(page.locator(`${HOST} [data-tour-step="1"]`)).toHaveAttribute("aria-current", "step");
  t = await figure(page);
  expect(t.tour.playing).toBe(true);
  // Step 2 is a flat graph: the walk-through shows it in 2D.
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  // Step 5's footnote marker stays out of the caption.
  await page.locator(`${HOST} [data-tour-step="4"]`).click();
  await expect.poll(async () => (await figure(page)).state.stage).toBe(5);
  await expect(caption).toContainText("3,600 bit/s in all.");
  expect(await caption.textContent()).not.toContain("all.1");
  expect(await caption.textContent()).not.toContain("..");
  // The last step is the air.
  await page.locator(`${HOST} [data-tour-step="7"]`).click();
  await expect.poll(async () => (await figure(page)).state.stage).toBe(7);
  await expect(caption).toContainText("On the air");
  await expect(caption).toContainText("Every 21st data slot");
});

test("walk-through: a press on the figure pauses it where it is, and Resume goes on", async ({ page }) => {
  test.setTimeout(120_000);
  await open3d(page);
  await freePlay(page);
  const play = page.locator(`${HOST} [data-ref="play"]`);
  await play.click();
  await expect(play).toHaveText("Pause");
  // Step 1 is in 3D.
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForTimeout(1500);
  await page.locator(CANVAS_3D).click({ position: { x: 20, y: 20 } });
  await expect(play).toHaveText("Resume");
  const t = await figure(page);
  expect(t.tour.playing).toBe(false);
  const pose = (await view(page)).pose;
  await page.waitForTimeout(800);
  expect((await view(page)).pose).toEqual(pose);
  await play.click();
  await expect(play).toHaveText("Pause");
  expect((await figure(page)).tour.playing).toBe(true);
  // The stage buttons are the reader taking over too.
  await page.locator(`${HOST} button[data-stage="6"]`).click();
  await expect(play).toHaveText("Resume");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("walk-through steps through end states in 2D, with no camera move", async ({ page }) => {
    await page.goto(PAGE);
    await page.locator(HOST).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      // @ts-ignore test-only global
      return Boolean(window.__ambeAnim?.figures?.["frame-path"]);
    });
    await freePlay(page);
    const play = page.locator(`${HOST} [data-ref="play"]`);
    await play.click();
    const caption = page.locator(`${HOST} [data-ref="caption"]`);
    await expect(caption).toContainText("Here are 20 ms of microphone audio");
    await page.locator(`${HOST} [data-tour-step="4"]`).click();
    await expect.poll(async () => (await figure(page)).state.stage).toBe(5);
    await expect(caption).toContainText("Out come 72 bits");
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
    // The pip does not fill by animation under reduced motion.
    const transition = await page.locator(`${HOST} [data-tour-step="4"] > i`).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(transition)).toBeLessThan(0.001);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });

  test("phone: the walk-through bar and caption fit, no horizontal scroll", async ({ page }) => {
    await open3d(page);
    await freePlay(page);
    await page.locator(`${HOST} [data-ref="play"]`).click();
    await expect(page.locator(`${HOST} [data-ref="caption"]`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    // The seven stage buttons stay inside their group.
    const stages = await page.locator(`${HOST} .frame-path__stages`).evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(stages.scroll).toBeLessThanOrEqual(stages.client);
    const bar = await page.locator(`${HOST} [data-ref="tour"]`).boundingBox();
    const frame = await page.locator(`${HOST} .anim-figure__frame`).boundingBox();
    expect(bar && frame && bar.x + bar.width <= frame.x + frame.width + 1).toBe(true);
  });
});
