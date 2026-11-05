// frame-path (ch10): one frame from the input samples to the 72 bits the
// chip sent, back to its decoded audio and onto the air (three-figures
// plan, Figure D; three-everywhere plan F12). Expected values are computed
// here from the committed JSON and WAVs; only the literal cross-checks
// named in the plans are written out. The 3D view's own cases are in
// frame-path-3d.spec.js.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { hexBits } from "../../docs/javascripts/anim-core.js";
import { superframe } from "../../docs/javascripts/anim-frame-path.js";
import { CUTOFF_BADGE, CUTOFF_HZ, CUTOFF_LABEL } from "../../docs/javascripts/lib/cutoff.js";
import { PICKS } from "../../docs/javascripts/lib/picks.js";
import { countAnimObservers, hook } from "./helpers.js";

const PAGE = "10-the-dstar-frame/";
const HOST = '[data-anim="frame-path"]';
const FIGURE = `${HOST} .anim-figure`;
const CANVAS_2D = `${HOST} .anim-figure__frame > canvas:not(.anim-figure__canvas--3d)`;
const CANVAS_3D = `${HOST} canvas.anim-figure__canvas--3d`;

/** @param {string} path */
const json = (path) => JSON.parse(readFileSync(new URL(`../../docs/assets/${path}`, import.meta.url), "utf8"));
/** @param {string} clip @returns {FramesFile} */
const framesFile = (clip) => json(`data/${clip}/frames.json`);
/** @param {string} clip @returns {SpectraFile} */
const spectraFile = (clip) => json(`data/${clip}/spectra.json`);

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

/** @param {number} f0 */
const harmonics = (f0) => (f0 > 0 ? Math.floor(CUTOFF_HZ / f0) : 0);

/**
 * The readout each stage should show, from the JSON.
 * @param {string} clip
 * @param {number} i
 * @returns {Record<number, string>}
 */
function expectedReadouts(clip, i) {
  const file = framesFile(clip);
  const d = file.frames[i].derived;
  const L = harmonics(d.orig_f0_hz);
  return {
    1: "160 samples × 16 bits = 2,560 bits per 20 ms, 128 kbit/s",
    2: L
      ? `f0 ${d.orig_f0_hz.toFixed(1)} Hz (input), L = ${L}, ${CUTOFF_LABEL}`
      : "no pitch found in the input: L is not defined for this frame",
    3: `${d.band_voicing.filter((v) => v >= 0.55).length} of 8 bands periodic at 0.55 (decoded audio)`,
    4: "AMBE-3000: internals not observable",
    6: `decoded audio lags the input by ${file.clip.decoded_delay_ms.toFixed(1)} ms ` +
      `(correlation ${file.clip.decoded_delay_correlation.toFixed(3)})`,
    7: airReadout(i, file.frames.length),
  };
}

/**
 * Stage 7's readout, from the superframe rule (every 21st frame, from 0).
 * @param {number} k
 * @param {number} total
 */
function airReadout(k, total) {
  const next = Math.ceil(k / 21) * 21;
  if (next >= total) return `Tune in at frame ${k}: the recording ends before the next sync slot.`;
  const wait = next - k + 1;
  const on = next - k;
  return `Tune in at frame ${k}: the next sync slot is frame ${next}, ${on === 0 ? "this one" : on === 1 ? "1 frame on" : `${on} frames on`}, ` +
    `so a receiver waits ${20 * wait} ms.`;
}

/** @param {import("@playwright/test").Page} page */
const probe = (page) => page.evaluate(() => {
  // @ts-ignore test-only global
  const f = window.__ambeAnim.figures["frame-path"];
  return {
    state: f.state, readout: f.readout, cells: f.cells, samples: f.samples, spans: f.spans, cellRects: f.cellRects,
    air: f.air,
  };
});

/**
 * Open ch10 and wait for the figure to settle.
 * @param {import("@playwright/test").Page} page
 * @param {string} [query]
 */
async function open(page, query = "") {
  await page.goto(PAGE + query);
  const host = page.locator(HOST);
  await host.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    // @ts-ignore test-only global
    return Boolean(window.__ambeAnim?.figures?.["frame-path"]);
  });
  await page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures["frame-path"].settled;
  });
}

/**
 * Leave 3D (the 3D control is a toggle), or stay in 2D.
 * @param {import("@playwright/test").Page} page
 */
async function flat(page) {
  const toggle = page.locator(`${HOST} button[data-view="3d"]`);
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
}

/**
 * Open 3D if it is not open, and land its animation.
 * @param {import("@playwright/test").Page} page
 */
async function deep(page) {
  const toggle = page.locator(`${HOST} button[data-view="3d"]`);
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  await page.waitForFunction(() => {
    // @ts-ignore test-only global
    return Boolean(window.__ambeAnim?.figures?.["frame-path-3d"]);
  });
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__ambeAnim.finishAll();
  });
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} i
 */
async function setFrame(page, i) {
  await page.locator(`${HOST} [data-ref="frame"]`).evaluate((input, value) => {
    const range = /** @type {HTMLInputElement} */ (input);
    range.value = String(value);
    range.dispatchEvent(new Event("input", { bubbles: true }));
  }, i);
  await expect.poll(async () => (await probe(page)).state.frame).toBe(i);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} n
 */
const stage = (page, n) => page.locator(`${HOST} button[data-stage="${n}"]`).click();

/** @param {import("@playwright/test").Page} page */
const readout = (page) => page.locator(`${HOST} [data-ref="readout"]`);

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
const hookValue = (page, name) => page.evaluate((key) => {
  // @ts-ignore test-only global
  return window.__ambeAnim.figures["frame-path"][key];
}, name);

/**
 * Every visible 3D label inside the frame, above the band lib/labels.js
 * keeps clear, and clear of the others.
 * @param {import("@playwright/test").Page} page
 * @param {string} where
 */
async function checkLabels(page, where) {
  const frame = await page.locator(`${HOST} .anim-figure__frame`).boundingBox();
  if (!frame) throw new Error("no frame");
  /** @type {{x: number, y: number, width: number, height: number}[]} */
  const boxes = [];
  for (const label of await page.locator(`${HOST} .anim-figure__overlay > .anim-figure__label`).all()) {
    expect(await label.isVisible(), `${where}: "${await label.textContent()}" shown`).toBe(true);
    const b = await label.boundingBox();
    if (!b) continue;
    expect(b.x, where).toBeGreaterThanOrEqual(frame.x - 0.5);
    expect(b.y, where).toBeGreaterThanOrEqual(frame.y - 0.5);
    expect(b.x + b.width, where).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(b.y + b.height / 2, where).toBeLessThanOrEqual(frame.y + frame.height - 56);
    for (const o of boxes) {
      const apart = b.x >= o.x + o.width || o.x >= b.x + b.width || b.y >= o.y + o.height || o.y >= b.y + b.height;
      expect(apart, `${where}: labels overlap`).toBe(true);
    }
    boxes.push(b);
  }
}


test("JS off: fallback image, caption and every step are visible", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  expect(await host.locator(".anim-fallback img").evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth))
    .toBe(1280);
  // zensical serve also answers /assets/ at the host root, which the
  // deployed site does not: the src has to resolve under the base path.
  expect(new URL(await host.locator(".anim-fallback img").evaluate((img) => /** @type {HTMLImageElement} */ (img).src))
    .pathname).toBe("/how-ambe-works/assets/posters/frame-path.png");
  await expect(host.locator(".anim-fallback figcaption"))
    .toContainText("One 20 ms frame from a real AMBE-3000 round trip.");
  const steps = host.locator(".anim-steps > li");
  await expect(steps).toHaveCount(8);
  for (const step of await steps.all()) await expect(step).toBeVisible();
  await context.close();
});

test("print: fallback image, numbered steps, no live chrome", async ({ page }) => {
  await open(page);
  await page.emulateMedia({ media: "print" });
  const host = page.locator(HOST);
  await expect(host.locator(".anim-fallback img")).toBeVisible();
  const steps = host.locator(".anim-steps > li");
  for (const step of await steps.all()) await expect(step).toBeVisible();
  expect(await host.locator(".anim-steps").evaluate((ol) => getComputedStyle(ol).listStyleType)).toBe("decimal");
  for (const chrome of [".anim-figure__frame", ".anim-controls", ".frame-path__stages", ".frame-path__readout",
    ".anim-steps__nav", ".anim-figure__caption", ".frame-path__tour"]) {
    await expect(host.locator(chrome)).toBeHidden();
  }
});

test("default frame is the 2nd steady pick", async ({ page }) => {
  await open(page);
  const want = PICKS.default(framesFile("lr-b").frames)?.i;
  expect((await probe(page)).state.frame).toBe(want);
  await expect(page.locator(`${HOST} [data-ref="frame-readout"]`)).toHaveText(new RegExp(`^frame ${want} · `));
});

test("seven stages, the last On the air", async ({ page }) => {
  await open(page);
  await expect(page.locator(`${HOST} button[data-stage]`)).toHaveText(
    ["1 Input", "2 Pitch", "3 Voicing", "4 Encoder", "5 The frame", "6 Decoded", "7 On the air"]);
});

test("steps: each step applies its state", async ({ page }) => {
  await open(page);
  const next = page.locator(`${HOST} [data-step="next"]`);
  const want = [[1, "lr-b"], [2, "lr-b"], [3, "lr-b"], [4, "lr-b"], [5, "lr-b"], [6, "lr-b"], [2, "lj-b"], [7, "lr-b"]];
  for (const [k, [n, clip]] of want.entries()) {
    if (k) await next.click();
    await page.evaluate(() => {
      // @ts-ignore test-only global
      return window.__ambeAnim.figures["frame-path"].settled;
    });
    const { state } = await probe(page);
    const frame = /** @type {number} */ (PICKS.default(framesFile(String(clip)).frames)?.i);
    expect(state, `step ${k + 1}`).toMatchObject({ stage: n, clip, frame });
    if (n !== 5) await expect(readout(page)).toHaveText(expectedReadouts(String(clip), frame)[Number(n)]);
    await expect(page.locator(`${HOST} button[data-stage="${n}"]`)).toHaveAttribute("aria-pressed", "true");
  }
});

test("steps: Previous after free play restores the step", async ({ page }) => {
  await open(page);
  const next = page.locator(`${HOST} [data-step="next"]`);
  await next.click();
  await next.click(); // step 3, voicing
  await setFrame(page, 0);
  await stage(page, 5);
  await page.locator(`${HOST} button[data-clip="lj-b"]`).click();
  await expect.poll(async () => (await probe(page)).state.clip).toBe("lj-b");
  await page.locator(`${HOST} [data-step="prev"]`).click();
  await page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures["frame-path"].settled;
  });
  const frame = PICKS.default(framesFile("lr-b").frames)?.i;
  expect((await probe(page)).state).toMatchObject({ stage: 2, clip: "lr-b", frame });
  await expect(readout(page)).toHaveText(expectedReadouts("lr-b", /** @type {number} */ (frame))[2]);
});

test("reveal: L changes, 72 stays", async ({ page }) => {
  await open(page);
  const next = page.locator(`${HOST} [data-step="next"]`);
  await next.click();
  await expect(readout(page)).toContainText("L = 30");
  for (let k = 0; k < 5; k += 1) await next.click();
  await page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures["frame-path"].settled;
  });
  expect((await probe(page)).state).toMatchObject({ stage: 2, clip: "lj-b" });
  await expect(readout(page)).toContainText("L = 14");
  await flat(page);
  for (const clip of ["lr-b", "lj-b"]) {
    await page.locator(`${HOST} button[data-clip="${clip}"]`).click();
    await expect.poll(async () => (await probe(page)).state.clip).toBe(clip);
    await stage(page, 5);
    await expect.poll(async () => (await probe(page)).cells.length, clip).toBe(72);
    const { state, cells } = await probe(page);
    expect(cells, clip).toEqual(Array.from(hexBits(framesFile(clip).frames[state.frame].hex)));
  }
});

test("readouts equal the data for frames 0, 48 and 158 of lr-b", async ({ page }) => {
  await open(page);
  await flat(page);
  for (const i of [0, 48, 158]) {
    await setFrame(page, i);
    const want = expectedReadouts("lr-b", i);
    for (const n of [1, 2, 3, 4, 6, 7]) {
      await stage(page, n);
      await expect(readout(page), `frame ${i} stage ${n}`).toHaveText(want[n]);
    }
    await stage(page, 5);
    await expect(page.locator(`${HOST} [data-ref="hex"]`)).toHaveText(`hex ${framesFile("lr-b").frames[i].hex}`);
  }
  // Literal cross-checks from the plan.
  await setFrame(page, 48);
  await stage(page, 2);
  await expect(readout(page)).toContainText("f0 120.7 Hz (input), L = 30");
  await stage(page, 3);
  await expect(readout(page)).toContainText("0 of 8 bands");
  await stage(page, 5);
  await expect(page.locator(`${HOST} [data-ref="hex"]`)).toHaveText("hex 995fd547ec5db6e5fa");
  await stage(page, 6);
  await expect(readout(page)).toContainText("34.0 ms (correlation 0.978)");
  for (const i of [0, 158]) {
    await setFrame(page, i);
    await stage(page, 2);
    await expect(readout(page)).toHaveText("no pitch found in the input: L is not defined for this frame");
  }
});

test("stage 7: the superframe rule, the wait from 20 to 420 ms, and the clip's end", async ({ page }) => {
  // The rule on its own: every 21st frame from frame 0 is a sync slot.
  expect(superframe(102, 159)).toEqual({ start: 102, end: 122, next: 105, wait: 4 });
  expect(superframe(105, 159)).toEqual({ start: 105, end: 125, next: 105, wait: 1 });
  expect(superframe(106, 159)).toEqual({ start: 106, end: 126, next: 126, wait: 21 });
  expect(superframe(147, 159)).toEqual({ start: 138, end: 158, next: 147, wait: 1 });
  expect(superframe(148, 159).next).toBeNull();
  expect(superframe(189, 208).next).toBe(189);
  expect(superframe(190, 208).next).toBeNull();
  await open(page);
  await flat(page);
  await stage(page, 7);
  for (const [i, text] of /** @type {[number, string][]} */ ([
    [105, "the next sync slot is frame 105, this one, so a receiver waits 20 ms."],
    [106, "the next sync slot is frame 126, 20 frames on, so a receiver waits 420 ms."],
    [125, "the next sync slot is frame 126, 1 frame on, so a receiver waits 40 ms."],
    [147, "the next sync slot is frame 147, this one, so a receiver waits 20 ms."],
    [148, "the recording ends before the next sync slot."],
  ])) {
    await setFrame(page, i);
    await expect(readout(page), `frame ${i}`).toHaveText(`Tune in at frame ${i}: ${text}`);
  }
  // lj-b runs to frame 207: past 189 there is no sync slot left.
  await page.locator(`${HOST} button[data-clip="lj-b"]`).click();
  await expect.poll(async () => (await probe(page)).state.clip).toBe("lj-b");
  await setFrame(page, 189);
  await expect(readout(page)).toContainText("the next sync slot is frame 189, this one");
  await setFrame(page, 190);
  await expect(readout(page)).toHaveText("Tune in at frame 190: the recording ends before the next sync slot.");
  // Measured voice bits; the slot alignment is an assumption.
  await expect(page.locator(`${HOST} [data-ref="stage-badge"] .anim-badge--measured`)).toHaveCount(1);
  await expect(page.locator(`${HOST} [data-ref="stage-badge"] .anim-badge--illustrative`)).toHaveCount(1);
});

test("stage 7 in 2D: 21 rows from the window, the selected one outlined", async ({ page }) => {
  await open(page);
  await flat(page);
  await stage(page, 7);
  await setFrame(page, 102);
  await expect.poll(async () => (await probe(page)).air.rows.length).toBe(21);
  const { air } = await probe(page);
  expect(air.rows[0]).toBe(102);
  expect(air.rows[20]).toBe(122);
  expect(air.selected).not.toBeNull();
  // The outline is the highlight, and so are the selected row's ones.
  const highlight = await page.locator(HOST).evaluate((host) => {
    const probe = document.createElement("i");
    probe.style.color = "var(--ambe-highlight)";
    host.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
  });
  const box = /** @type {{x: number, y: number, w: number, h: number}} */ (air.selected);
  const edge = await page.locator(CANVAS_2D).evaluate((node, b) => {
    const canvas = /** @type {HTMLCanvasElement} */ (node);
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    return Array.from(ctx.getImageData(Math.round((b.x + b.w / 2) * dpr), Math.round(b.y * dpr), 1, 1).data.slice(0, 3));
  }, box);
  for (let c = 0; c < 3; c += 1) expect(Math.abs(edge[c] - highlight[c]), `channel ${c}`).toBeLessThanOrEqual(24);
  await setFrame(page, 150);
  await expect.poll(async () => (await probe(page)).air.rows[0]).toBe(138);
});

test("cells render hex exactly", async ({ page }) => {
  await open(page);
  await flat(page);
  await stage(page, 5);
  const file = framesFile("lr-b");
  for (const i of [0, 48, 102, 158]) {
    await setFrame(page, i);
    await page.waitForTimeout(50);
    const want = Array.from(hexBits(file.frames[i].hex));
    const got = await probe(page);
    expect(got.cells, `frame ${i}`).toEqual(want);
    // Sample the canvas at each cell centre: a 1 is filled, a 0 is not.
    const lit = await page.locator(CANVAS_2D).evaluate((node, rects) => {
      const canvas = /** @type {HTMLCanvasElement} */ (node);
      const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      return rects.map((r) => {
        const [red, green, blue, alpha] = ctx.getImageData(Math.round((r.x + r.w / 2) * dpr),
          Math.round((r.y + r.h / 2) * dpr), 1, 1).data;
        return alpha > 0 && (red + green + blue) / 3 > 128 ? 1 : 0;
      });
    }, got.cellRects);
    expect(lit, `frame ${i} pixels`).toEqual(want);
  }
});

test("no 7, 8 or 57 budget anywhere in the figure", async ({ page }) => {
  await open(page);
  /** @param {string} text */
  const check = (text) => {
    expect(text).not.toMatch(/\b57\b/);
    expect(text).not.toMatch(/7\s*\+\s*8/);
  };
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    await stage(page, n);
    await page.waitForTimeout(300); // the aria-label is debounced
    const { text, labels } = await page.locator(HOST).evaluate((host) => ({
      text: host.textContent || "",
      labels: [...host.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") || "").join(" | "),
    }));
    check(text);
    check(labels);
  }
});

test("measured badges sit on the cells and the chip player only", async ({ page }) => {
  await open(page);
  await stage(page, 5);
  const measured = page.locator(`${FIGURE} .anim-badge--measured`);
  await expect(measured).toHaveCount(2);
  await expect(page.locator(`${FIGURE} [data-measured="hex"] .anim-badge--measured`)).toHaveCount(1);
  await expect(page.locator(`${FIGURE} [data-measured="decoded-audio"] .anim-badge--measured`)).toHaveCount(1);
  await stage(page, 7);
  await expect(measured).toHaveCount(2);
  await expect(page.locator(`${FIGURE} [data-measured="hex"] .anim-badge--measured`)).toHaveCount(1);
  await stage(page, 6);
  await expect(measured).toHaveCount(1);
  await expect(page.locator(`${HOST} [data-ref="stage-badge"] .anim-badge`)).toHaveAttribute("data-from", "decoded");
  await stage(page, 1);
  await expect(page.locator(`${HOST} [data-ref="stage-badge"] .anim-badge`)).toHaveClass(/anim-badge--input/);
  await stage(page, 2);
  await expect(page.locator(`${HOST} [data-ref="stage-badge"] .anim-badge--derived`)).toHaveAttribute("data-from", "input");
});

test("stage 1 shows the real samples for any frame", async ({ page }) => {
  await open(page);
  await flat(page);
  await stage(page, 1);
  const pcm = wavSamples("lr-b");
  for (const i of [0, 48, 102, 158]) {
    await setFrame(page, i);
    await page.waitForTimeout(50);
    const { samples } = await probe(page);
    // The WAV ends 104 samples into frame 158, the last.
    const want = Array.from(pcm.subarray(i * 160, Math.min(pcm.length, i * 160 + 160)));
    expect(samples.length).toBe(want.length);
    // Chromium's decoder scales 16-bit samples by 1/32767.
    expect(samples.map((s) => Math.round(s * 32767)), `frame ${i}`).toEqual(want);
  }
});

test("the cutoff label follows lib/cutoff.js, on the pitch stage only", async ({ page }) => {
  await open(page);
  await flat(page);
  await stage(page, 2);
  await expect(readout(page)).toContainText(CUTOFF_LABEL);
  const illustrative = page.locator(`${HOST} [data-ref="stage-badge"] .anim-badge--illustrative`);
  await expect(illustrative).toHaveCount(CUTOFF_BADGE === "illustrative" ? 1 : 0);
  expect(await hookValue(page, "cutoff")).toBe(`${CUTOFF_HZ / 1000} kHz`);
  for (const n of [1, 3, 4, 5, 6, 7]) {
    await stage(page, n);
    expect(await hookValue(page, "cutoff"), `stage ${n}`).toBe("");
  }
});

test("legend: what each stage draws; this frame and neighbours in 3D", async ({ page }) => {
  await open(page);
  await deep(page);
  const legend = page.locator(`${HOST} .anim-legend`);
  /** @type {Record<number, string[]>} */
  const flatItems = {
    1: ["input samples"],
    2: ["input spectrum", "comb at k × f0, k up to L"],
    3: ["periodic, at or above 0.55", "not periodic", "threshold 0.55"],
    4: [],
    5: ["bit = 1", "bit = 0"],
    6: ["decoded spectrum", "input spectrum"],
    7: ["this frame (outlined)", "voice bit = 1", "data slot: scrambled on the air, not captured", "sync slot, every 21st"],
  };
  await stage(page, 6);
  await expect(legend.locator("li")).toHaveText(["decoded spectrum, this frame (thick, outlined)", "input spectrum",
    "neighbours, 20 ms apart, coloured by level"]);
  await stage(page, 3);
  await expect(legend.locator("li")).toHaveText(["this frame (outlined)", ...flatItems[3], "neighbours, 20 ms apart"]);
  await stage(page, 5);
  await expect(legend.locator("li")).toHaveText(["bit = 1, this frame (tall)", "bit = 0",
    "neighbours, 20 ms apart, coloured by level"]);
  await flat(page);
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    await stage(page, n);
    await expect(legend.locator("li"), `stage ${n}`).toHaveText(flatItems[n]);
  }
});

test("players: input and chip spans", async ({ page }) => {
  await open(page);
  const { spans, state } = await probe(page);
  expect(state.frame).toBe(102);
  expect(spans.input.from).toBeCloseTo(1.84, 9);
  expect(spans.input.until).toBeCloseTo(2.26, 9);
  expect(spans.chip.from).toBeCloseTo(1.874, 9);
  expect(spans.chip.until).toBeCloseTo(2.294, 9);
  await expect(page.locator(`${HOST} [data-ref="hear-input"]`)).toHaveAttribute("data-kind", "audio");
  await expect(page.locator(`${HOST} [data-ref="hear-chip"]`)).toHaveText("Hear the chip's output");
});

test("ch10 never says a fifth of a second, and step 1 names the slice by shape", async ({ page }) => {
  await page.goto(PAGE);
  const text = (await page.locator("article").textContent()) || "";
  expect(text).not.toContain("a fifth of a second");
  expect(text).toContain("this frame is the thick, outlined slice");
  expect(text).not.toContain("bright slice");
});

test("no WebGL: 2D works, 3D control disabled with the hint", async ({ page }) => {
  await open(page);
  await stage(page, 2);
  const withGL = await readout(page).textContent();
  await open(page, "?nowebgl");
  await expect(page.locator(`${HOST} button[data-view="3d"]`)).toBeDisabled();
  await expect(page.locator(`${HOST} .anim-figure__hint--webgl`)).toHaveText("3D needs WebGL 2");
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator(CANVAS_2D)).toBeVisible();
  await expect(page.locator(`${HOST} [data-ref="presets"]`)).toBeHidden();
  await expect(page.locator(`${HOST} .anim-legend`)).not.toContainText("neighbours");
  await stage(page, 2);
  await expect(readout(page)).toHaveText(/** @type {string} */ (withGL));
  // A step that asks for 3D reads in 2D.
  await page.locator(`${HOST} [data-step="next"]`).click();
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await expect(page.locator(CANVAS_2D)).toBeVisible();
});

test("context loss: paused, resume rebuilds, readouts unchanged", async ({ page }) => {
  await open(page);
  await deep(page);
  const builds = () => page.evaluate(() => {
    // @ts-ignore test-only global
    return window.__ambeAnim.figures["frame-path-3d"].builds;
  });
  const before = { builds: await builds(), readout: (await probe(page)).readout };
  await page.locator(CANVAS_3D).evaluate((canvas) => {
    const gl = /** @type {HTMLCanvasElement} */ (canvas).getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.locator(`${HOST} .anim-figure__frame[data-state="paused"]`)).toHaveCount(1);
  await page.locator(`${HOST} .anim-figure__resume`).click();
  await expect.poll(builds).toBe(before.builds + 1);
  expect((await probe(page)).readout).toBe(before.readout);
});

test("ten navigations: one context at most, observers back to baseline", async ({ page }) => {
  test.setTimeout(240_000);
  /** @type {string[]} */
  const messages = [];
  page.on("console", (m) => messages.push(m.text()));
  await countAnimObservers(page);
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__sameDocument = true;
  });
  // @ts-ignore test-only global
  const observers = await page.evaluate(() => window.__obs.live);
  for (let i = 0; i < 10; i += 1) {
    await page.locator('a.md-nav__link[href$="09-quantization/"]').first().click();
    await page.waitForURL(/09-quantization\/$/);
    await page.locator('[data-anim="envelope"] canvas').first().waitFor();
    await expect.poll(async () => (await hook(page)).liveContexts).toBe(0);
    await page.locator('a.md-nav__link[href$="10-the-dstar-frame/"]').first().click();
    await page.waitForURL(/10-the-dstar-frame\/$/);
    await page.locator(HOST).scrollIntoViewIfNeeded();
    await page.locator(CANVAS_3D).waitFor();
  }
  const h = await hook(page);
  expect(h.liveContexts).toBe(1);
  expect(h.peakContexts).toBe(1);
  expect(h.webglProbes).toBe(1);
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBe(observers);
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  expect(messages.filter((m) => /too many active webgl contexts/i.test(m))).toEqual([]);
});

test("toggle 3D five times quickly: no stray context or labels", async ({ page }) => {
  await open(page);
  await page.locator(CANVAS_3D).waitFor();
  const toggle = page.locator(`${HOST} button[data-view="3d"]`);
  for (let k = 0; k < 10; k += 1) await toggle.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(500);
  // The bits figure below can be near enough to open its own 3D view.
  const others = await page.locator(`[data-anim]:not(${HOST}) canvas.anim-figure__canvas--3d`).count();
  const h = await hook(page);
  expect(h.liveContexts).toBe(others);
  expect(h.peakContexts).toBeLessThanOrEqual(1 + others);
  await expect(page.locator(`${HOST} .anim-figure__overlay`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .anim-chip-layer`)).toHaveCount(0);
  await expect(page.locator(CANVAS_3D)).toHaveCount(0);
  await toggle.click();
  await page.locator(CANVAS_3D).waitFor();
  expect((await hook(page)).liveContexts).toBe(1 + others);
  await expect(page.locator(`${HOST} .anim-figure__overlay:not(.anim-chip-layer)`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .anim-chip-layer`)).toHaveCount(1);
});

test("desktop: every label shown inside the frame at every preset", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await deep(page);
  for (const preset of ["corner", "front", "top"]) {
    await page.locator(`${HOST} button[data-preset="${preset}"]`).click();
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await stage(page, n);
      await page.evaluate(() => {
        // @ts-ignore test-only global
        window.__ambeAnim.finishAll();
      });
      await page.waitForTimeout(300);
      await checkLabels(page, `${preset} stage ${n}`);
    }
  }
});

test("leaving while the data loads releases every observer", async ({ page }) => {
  await countAnimObservers(page);
  await page.goto("09-quantization/");
  await page.locator('[data-anim="envelope"] canvas').first().waitFor();
  // @ts-ignore test-only global
  const baseline = await page.evaluate(() => window.__obs.live);
  /** @type {(() => void)[]} */
  const held = [];
  await page.route("**/assets/data/lr-b/spectra.json", (route) => {
    held.push(() => void route.continue().catch(() => {}));
  });
  await page.locator('a.md-nav__link[href$="10-the-dstar-frame/"]').first().click();
  await page.waitForURL(/10-the-dstar-frame\/$/);
  await page.locator(`${FIGURE}`).waitFor({ state: "attached" });
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBeGreaterThan(0);
  await page.locator('a.md-nav__link[href$="09-quantization/"]').first().click();
  await page.waitForURL(/09-quantization\/$/);
  await page.locator('[data-anim="envelope"] canvas').first().waitFor();
  for (const release of held) release();
  await page.unroute("**/assets/data/lr-b/spectra.json");
  // @ts-ignore test-only global
  await expect.poll(() => page.evaluate(() => window.__obs.live)).toBe(baseline);
});

test("players: a late rejection never disables the button", async ({ page }) => {
  await open(page);
  const button = page.locator(`${HOST} [data-ref="hear-input"]`);
  // An AbortError (pause() during a pending play()) leaves the button live.
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException("interrupted", "AbortError"));
    };
  });
  await button.click();
  await expect(button).toHaveText("Hear the input");
  await expect(button).toBeEnabled();
  // A refusal that arrives after the slider replaced the player is ignored:
  // the button belongs to the new player by then.
  await page.evaluate(() => {
    // @ts-ignore test-only global
    window.__played = false;
    HTMLMediaElement.prototype.play = function () {
      // @ts-ignore test-only global
      window.__played = true;
      return new Promise((_, reject) => setTimeout(() => reject(new DOMException("no", "NotAllowedError")), 200));
    };
  });
  await button.click();
  // @ts-ignore test-only global
  await page.waitForFunction(() => window.__played);
  await setFrame(page, 48);
  await page.waitForTimeout(400);
  await expect(button).toBeEnabled();
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("reduced motion: opens 2D, 3D still available, no tween", async ({ page }) => {
    await open(page);
    await page.waitForTimeout(300);
    await expect(page.locator(CANVAS_3D)).toHaveCount(0);
    await expect(page.locator(CANVAS_2D)).toBeVisible();
    await page.locator(`${HOST} button[data-view="3d"]`).click();
    await page.locator(CANVAS_3D).waitFor();
    await page.waitForTimeout(300);
    for (const preset of ["front", "top", "corner"]) {
      const before = (await hook(page)).renders;
      await page.locator(`${HOST} button[data-preset="${preset}"]`).click();
      await page.waitForTimeout(300);
      expect((await hook(page)).renders - before, preset).toBe(1);
    }
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 3 });

  test("phone: no horizontal scroll, every label shown inside the frame at every preset", async ({ page }) => {
    test.setTimeout(300_000);
    await open(page);
    await deep(page);
    for (const preset of ["corner", "front", "top"]) {
      await page.locator(`${HOST} button[data-preset="${preset}"]`).click();
      for (const n of [1, 2, 3, 4, 5, 6, 7]) {
        await stage(page, n);
        await page.evaluate(() => {
          // @ts-ignore test-only global
          window.__ambeAnim.finishAll();
        });
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
        await checkLabels(page, `${preset} stage ${n}`);
      }
    }
  });
});

/** @type {{name: string, viewport: {width: number, height: number}}[]} */
const SIZES = [
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "phone", viewport: { width: 375, height: 800 } },
];
for (const { name, viewport } of SIZES) {
  test.describe(`screens ${name}`, () => {
    test.use({ viewport });

    test(`screens: 2D and 3D at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await open(page);
      const frame = page.locator(`${HOST} .anim-figure__frame`);
      await deep(page);
      await page.waitForTimeout(400);
      await expect(frame).toHaveScreenshot(`frame-path-3d-${name}.png`, { maxDiffPixelRatio: 0.01 });
      await flat(page);
      for (const n of [1, 2, 5]) {
        await stage(page, n);
        await page.waitForTimeout(150);
        await expect(frame).toHaveScreenshot(`frame-path-2d-stage${n}-${name}.png`, { maxDiffPixels: 0 });
      }
    });
  });
}

// Stage 7 in light: the fog stays light enough that the superframe's far
// rows and the data column still read on the stage.
test("screens: stage 7 in 3D, light", async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.body.setAttribute("data-md-color-scheme", "default"));
  await deep(page);
  await stage(page, 7);
  await page.evaluate(async () => {
    // @ts-ignore test-only global
    await window.__ambeAnim.figures["frame-path"].settled;
    // @ts-ignore test-only global
    window.__ambeAnim.finishAll();
  });
  await page.waitForTimeout(400);
  await expect(page.locator(`${HOST} .anim-figure__frame`)).toHaveScreenshot("frame-path-3d-stage7-light-desktop.png", { maxDiffPixelRatio: 0.01 });
});
