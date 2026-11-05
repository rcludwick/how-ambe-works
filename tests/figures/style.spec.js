// The visual language's runtime (three-visual-language design §3, §4; plan
// P5 and P7): lib/style.js and lib/highlight.js, in a page, on the
// fixture's 3D view, which wears the look (anim-fixture-3d.js).
import { test, expect } from "@playwright/test";
import { hook, useFixture } from "./helpers.js";

const CANVAS_3D = '[data-anim="fixture"] canvas.anim-figure__canvas--3d';

/**
 * The fixture page with its 3D part open (data-view="auto", motion allowed).
 * @param {import("@playwright/test").Page} page
 */
async function open(page) {
  await useFixture(page, { chapters: ["14-how-to-measure/"], view: "auto" });
  await page.goto("14-how-to-measure/");
  await page.locator(CANVAS_3D).waitFor();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.addScriptTag({ content: `
    window.__lib = (name) => {
      const script = document.querySelector('script[src*="javascripts/anim.js"]');
      return import(new URL(name, script.src).href);
    };` });
}

test("rampColor: its ends are ramp-0 and ramp-4 in dark, light and print", async ({ page }) => {
  await open(page);
  /** @param {string} scheme */
  const ends = (scheme) => page.evaluate(async (s) => {
    if (s) document.body.setAttribute("data-md-color-scheme", s);
    await new Promise((r) => setTimeout(r));
    // @ts-ignore test-only global
    const S = await window.__lib("lib/style.js");
    const css = getComputedStyle(document.body);
    const hex = (/** @type {number} */ n) => `#${n.toString(16).padStart(6, "0")}`;
    return {
      got: [hex(S.rampColor(0)), hex(S.rampColor(1)), hex(S.rampColor(-1)), hex(S.rampColor(2))],
      want: [css.getPropertyValue("--ambe-ramp-0").trim(), css.getPropertyValue("--ambe-ramp-4").trim()],
      mid: hex(S.rampColor(0.5)),
    };
  }, scheme);
  const dark = await ends("slate");
  expect(dark.got).toEqual([...dark.want, ...dark.want]);
  expect(dark.mid).toBe("#10caca"); // ramp-2 sits at t = 0.5
  const light = await ends("default");
  expect(light.want).toEqual(["#57288f", "#6a9708"]);
  expect(light.got).toEqual([...light.want, ...light.want]);
  await page.evaluate(() => document.body.setAttribute("data-md-color-scheme", "slate"));
  await page.emulateMedia({ media: "print" });
  const print = await ends("");
  expect(print.got).toEqual(["#57288f", "#6a9708", "#57288f", "#6a9708"]);
});

test("fade: 0 within 1, then 0.12 plus 0.06 a step past 1, capped at 0.6 dark, 0.45 light, 0 in print", async ({ page }) => {
  await open(page);
  /** @param {string} scheme */
  const amounts = (scheme) => page.evaluate(async (s) => {
    if (s) document.body.setAttribute("data-md-color-scheme", s);
    // @ts-ignore test-only global
    const S = await window.__lib("lib/style.js");
    return [0, 1, -1, 2, 3, 10, -10].map((d) => Math.round(S.fadeAmount(d) * 1000) / 1000);
  }, scheme);
  expect(await amounts("slate")).toEqual([0, 0, 0, 0.18, 0.24, 0.6, 0.6]);
  expect(await amounts("default")).toEqual([0, 0, 0, 0.18, 0.24, 0.45, 0.45]);
  await page.emulateMedia({ media: "print" });
  expect(await amounts("slate")).toEqual([0, 0, 0, 0, 0, 0, 0]);
  await page.emulateMedia({ media: "screen" });
  const faded = await page.evaluate(async () => {
    document.body.setAttribute("data-md-color-scheme", "slate");
    // @ts-ignore test-only global
    const S = await window.__lib("lib/style.js");
    return [S.fade(0xffffff, 0), S.fade(0xffffff, 100), S.mix(0xffffff, 0x000000, 0.5)];
  });
  // White faded 0.6 toward #0f1015, and white mixed half way to black.
  expect(faded).toEqual([0xffffff, 0x6f7073, 0x808080]);
});

test("a fat line is px CSS px wide at any pixel ratio and lies where a basic line projects", async ({ browser }) => {
  for (const ratio of [1, 2]) {
    const context = await browser.newContext({ deviceScaleFactor: ratio, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await open(page);
    const result = await page.evaluate(async () => {
      // @ts-ignore test-only global
      const S = await window.__lib("lib/style.js");
      // @ts-ignore test-only global
      const ctx = window.__fixture.three;
      const T = ctx.three;
      const scene = new T.Scene();
      const line = S.fatLines(ctx, [-0.5, 0.2, 0, 0.5, 0.2, 0], "--ambe-highlight", 3.25);
      scene.add(line);
      const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);
      const renderer = ctx.renderer;
      const gl = renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const css = ctx.frame.clientWidth;
      line.material.resolution.set(ctx.frame.clientWidth, ctx.frame.clientHeight);
      renderer.setClearColor(0x000000, 1);
      renderer.render(scene, camera);
      const column = new Uint8Array(height * 4);
      gl.readPixels(Math.floor(width / 2), 0, 1, height, gl.RGBA, gl.UNSIGNED_BYTE, column);
      renderer.setClearColor(0x000000, 0);
      let lit = 0;
      let sum = 0;
      for (let y = 0; y < height; y += 1) {
        const v = column[y * 4] / 255; // the red channel: coverage of the coral line
        lit += v;
        sum += v * y;
      }
      const v = new T.Vector3(0, 0.2, 0).project(camera);
      return { ratio: width / css, thick: lit / (column[Math.round(sum / lit) * 4] / 255), centre: sum / lit,
        want: ((v.y + 1) / 2) * height };
    });
    expect(Math.abs(result.centre - result.want)).toBeLessThan(1);
    expect(result.thick / result.ratio).toBeGreaterThan(2.75);
    expect(result.thick / result.ratio).toBeLessThan(3.75);
    await context.close();
  }
});

test("setSegments: a fat line given more segments than it first drew draws them all", async ({ page }) => {
  await open(page);
  const lit = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const S = await window.__lib("lib/style.js");
    // @ts-ignore test-only global
    const ctx = window.__fixture.three;
    const T = ctx.three;
    const scene = new T.Scene();
    const row = (/** @type {number} */ y) => [-0.5, y, 0, 0.5, y, 0];
    const line = S.fatLines(ctx, row(-0.5), "--ambe-highlight", 3.25);
    scene.add(line);
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    const renderer = ctx.renderer;
    const gl = renderer.getContext();
    line.material.resolution.set(ctx.frame.clientWidth, ctx.frame.clientHeight);
    renderer.setClearColor(0x000000, 1);
    renderer.render(scene, camera); // the first draw: one segment
    S.setSegments(line, [...row(-0.5), ...row(0), ...row(0.5)]);
    renderer.render(scene, camera);
    const height = gl.drawingBufferHeight;
    const column = new Uint8Array(height * 4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), 0, 1, height, gl.RGBA, gl.UNSIGNED_BYTE, column);
    renderer.setClearColor(0x000000, 0);
    return [-0.5, 0, 0.5].map((y) => {
      const at = Math.round(((new T.Vector3(0, y, 0).project(camera).y + 1) / 2) * height);
      return column[at * 4] > 64;
    });
  });
  expect(lit).toEqual([true, true, true]);
});

test("the fixture in the full look stays within 30 draw calls; the stage sits behind the canvas", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(200);
  const draws = (await hook(page)).draws.fixture;
  expect(draws.calls).toBeGreaterThan(4);
  expect(draws.calls).toBeLessThanOrEqual(30);
  const frame = page.locator('[data-anim="fixture"] .anim-figure__frame');
  await expect(frame).toHaveClass(/anim-figure__frame--stage/);
  expect(await frame.evaluate((f) => getComputedStyle(f).backgroundImage)).toContain("linear-gradient");
  // Leaving 3D takes the stage away with the view.
  await page.locator('[data-anim="fixture"] [data-ref="view3d"]').click();
  await expect(frame).not.toHaveClass(/anim-figure__frame--stage/);
});

test("print: no fog, no fade, no contact shadow; the stage is flat", async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => {
    // @ts-ignore test-only global
    const ctx = window.__fixture.three;
    /** @type {any[]} */
    const shadows = [];
    ctx.scene.traverse((/** @type {any} */ n) => { if (n.material?.map) shadows.push(n); });
    return { fog: Boolean(ctx.scene.fog), shadow: shadows.map((n) => n.visible) };
  });
  expect(before).toEqual({ fog: true, shadow: [true] });
  await page.emulateMedia({ media: "print" });
  await expect.poll(() => page.evaluate(() => {
    // @ts-ignore test-only global
    const ctx = window.__fixture.three;
    /** @type {boolean[]} */
    const shadow = [];
    ctx.scene.traverse((/** @type {any} */ n) => { if (n.material?.map) shadow.push(n.visible); });
    return { fog: Boolean(ctx.scene.fog), shadow };
  })).toEqual({ fog: false, shadow: [false] });
  const frame = page.locator('[data-anim="fixture"] .anim-figure__frame');
  expect(await frame.evaluate((f) => getComputedStyle(f).backgroundImage)).toBe("none");
});

/* ---------------------------------------------------------------------------
 * The highlight kit and its chip (design §4, plan P7)
 * ------------------------------------------------------------------------ */

test("highlight: five draw calls at most, four in light, with the chip on the curve's highest point", async ({ page }) => {
  await open(page);
  /** @param {string} scheme */
  const calls = (scheme) => page.evaluate(async (s) => {
    document.body.setAttribute("data-md-color-scheme", s);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // @ts-ignore test-only global
    const ctx = window.__fixture.three;
    // @ts-ignore test-only global
    const kit = window.__fixture.highlight;
    const scene = new ctx.three.Scene();
    const parent = kit.parent;
    scene.add(kit);
    ctx.renderer.render(scene, ctx.camera);
    const n = ctx.renderer.info.render.calls;
    parent.add(kit);
    ctx.requestRender();
    return n;
  }, scheme);
  expect(await calls("slate")).toBe(5);
  expect(await calls("default")).toBe(4);
  const chip = page.locator('[data-anim="fixture"] .anim-chip');
  await expect(chip).toHaveText("middle curve: 61 points");
  await expect(chip).toBeVisible();
  await expect(page.locator('[data-anim="fixture"] .anim-chip__dot')).toBeVisible();
});

test("highlight: the chip pins inside the frame's edge with an arrow when zoom pushes its anchor out", async ({ page }) => {
  await open(page);
  const chip = page.locator('[data-anim="fixture"] .anim-chip');
  await expect(chip).not.toHaveAttribute("data-edge", /./);
  // Zoom 6, the view slid right, so the anchor leaves by the left edge.
  await page.evaluate(() => {
    // @ts-ignore test-only global
    const ctx = window.__fixture.three;
    const camera = ctx.camera;
    camera.zoom = 6;
    camera.updateMatrixWorld();
    const right = new ctx.three.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    camera.position.addScaledVector(right, 1.2);
    camera.updateProjectionMatrix();
    ctx.requestRender();
  });
  await expect(chip).toHaveAttribute("data-edge", "left");
  const [box, frame] = await Promise.all([chip.boundingBox(), page.locator('[data-anim="fixture"] .anim-figure__frame').boundingBox()]);
  if (!box || !frame) throw new Error("no boxes");
  expect(box.x).toBeGreaterThanOrEqual(frame.x);
  expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(box.y).toBeGreaterThanOrEqual(frame.y);
  expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
  await expect(page.locator('[data-anim="fixture"] .anim-chip__dot')).toBeHidden();
  const arrow = await chip.evaluate((c) => getComputedStyle(c, "::after").borderRightColor);
  const ring = await chip.evaluate((c) => getComputedStyle(c).borderLeftColor);
  expect(arrow).toBe(ring); // the arrow is in --ambe-highlight
});

test("highlight: chip text at 4.5:1 on the chip in both themes", async ({ page }) => {
  await open(page);
  const chip = page.locator('[data-anim="fixture"] .anim-chip');
  for (const scheme of ["slate", "default"]) {
    const [fg, bg] = await chip.evaluate((c, s) => {
      document.body.setAttribute("data-md-color-scheme", s);
      const style = getComputedStyle(c);
      return [style.color, style.backgroundColor];
    }, scheme);
    const lum = (/** @type {string} */ css) => {
      const [r, g, b] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Number(v) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    expect((hi + 0.05) / (lo + 0.05), scheme).toBeGreaterThanOrEqual(4.5);
  }
});

test("highlight: print keeps the line, fill, outline and chip, and drops the glow", async ({ page }) => {
  await open(page);
  /** @returns {Promise<boolean[]>} visible: fill, outline, glow, line */
  const parts = () => page.evaluate(() => {
    // @ts-ignore test-only global
    const kit = window.__fixture.highlight;
    return kit.children.slice(0, 4).map((/** @type {any} */ c) => c.visible);
  });
  expect(await parts()).toEqual([true, true, true, true]);
  await page.emulateMedia({ media: "print" });
  await expect.poll(parts).toEqual([true, true, false, true]);
  await expect(page.locator('[data-anim="fixture"] .anim-chip')).toHaveCount(1);
});

test("highlight: pulse doubles the glow and brings it back; set() moves the curve and the chip", async ({ page }) => {
  await open(page);
  // A fake clock, paused, so the pulse is stepped frame by frame whatever the
  // load: its peak passes in a few real frames, which a busy machine skips.
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  // @ts-ignore test-only global
  const glow = () => page.evaluate(() => window.__fixture.highlight.children[2].material.opacity);
  const rest = await glow();
  let most = rest;
  // @ts-ignore test-only global
  await page.evaluate(() => { window.__pulsed = window.__fixture.highlight.pulse(); });
  for (let ms = 0; ms < 600; ms += 17) {
    await page.clock.runFor(17);
    most = Math.max(most, await glow());
  }
  const result = await page.evaluate(async ({ rest, most }) => {
    // @ts-ignore test-only global
    const kit = window.__fixture.highlight;
    const glow = kit.children[2].material;
    // @ts-ignore test-only global
    await window.__pulsed;
    const points = [];
    for (let i = 0; i <= 10; i += 1) points.push(i / 10 - 0.5, i === 7 ? 0.8 : 0, 0);
    kit.set(points);
    return { rest, most, after: glow.opacity };
  }, { rest, most });
  expect(result.rest).toBeCloseTo(0.22, 2);
  expect(result.most).toBeGreaterThan(result.rest * 1.7);
  expect(result.after).toBeCloseTo(result.rest, 5);
});

test("tokenGradient: its ends are its first and last tokens, and it wants two tokens or more", async ({ page }) => {
  await open(page);
  const got = await page.evaluate(async () => {
    document.body.setAttribute("data-md-color-scheme", "slate");
    await new Promise((r) => setTimeout(r));
    // @ts-ignore test-only global
    const S = await window.__lib("lib/style.js");
    const g = S.tokenGradient(["--ambe-cat-5", "--ambe-cat-1"]);
    let threw = false;
    try { S.tokenGradient(["--ambe-cat-4"]); } catch { threw = true; }
    return { ends: [g(0), g(1), g(-1), g(2)], threw };
  });
  expect(got.ends).toEqual([0xc2a1ff, 0x7d8cff, 0xc2a1ff, 0x7d8cff]);
  expect(got.threw).toBe(true);
});
