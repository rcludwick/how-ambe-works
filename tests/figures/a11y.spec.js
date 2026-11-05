// Accessibility: axe finds nothing serious or critical in the content of
// any page with a figure, and every figure canvas is an image with a label.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FIGURE_PAGES, REGISTRY, settle, useFixture, hostOf, stepOn } from "./helpers.js";

const PAGES = FIGURE_PAGES;

for (const path of PAGES) {
  test(`${path || "index"}: axe, serious and critical`, async ({ page }) => {
    await page.goto(path);
    for (const host of await page.locator("[data-anim]").all()) await settle(page, host);
    // anchor_linenums in zensical.toml (on since chapter 1, before these
    // tests) gives every code line an empty <a id="__codelineno-..."> that
    // axe reports as link-name. That is the theme's markup, not a figure's;
    // whether to keep the line anchors is the owner's call, so only those
    // anchors are left out here.
    const result = await new AxeBuilder({ page })
      .include(".md-content")
      .exclude('[id^="__codelineno"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const bad = result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(bad).toEqual([]);
  });

  test(`${path || "index"}: every figure canvas has role img and a label`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const canvases = page.locator(".anim-figure canvas");
    expect(await canvases.count()).toBeGreaterThan(0);
    for (const canvas of await canvases.all()) {
      await expect(canvas).toHaveAttribute("role", "img");
      await expect(canvas).toHaveAttribute("aria-label", /\S/);
    }
  });
}

test("fixture page: axe, serious and critical", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  await page.goto("14-how-to-measure/");
  await page.locator('[data-anim="fixture"].is-enhanced').waitFor();
  const result = await new AxeBuilder({ page }).include('[data-anim="fixture"]').analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("fixture in 3D with zoom: axe, the Zoom group, its readout and the canvas focus ring", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"], view: "auto" });
  await page.goto("14-how-to-measure/");
  const canvas = page.locator('[data-anim="fixture"] canvas.anim-figure__canvas--3d');
  await canvas.waitFor();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const result = await new AxeBuilder({ page }).include('[data-anim="fixture"]').analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  const group = page.getByRole("group", { name: "Zoom" });
  for (const name of ["Zoom out", "Zoom in", "Reset view"]) await expect(group.getByRole("button", { name })).toBeAttached();
  await expect(group.locator("output")).toHaveAttribute("aria-live", "polite");
  // Tab reaches the canvas, and its frame shows the focus ring.
  const frame = page.locator('[data-anim="fixture"] .anim-figure__frame');
  expect(await frame.evaluate((f) => getComputedStyle(f).boxShadow)).toBe("none");
  await page.locator('[data-anim="fixture"] [data-ref="view3d"]').focus();
  for (let i = 0; i < 10 && !(await canvas.evaluate((c) => c === document.activeElement)); i += 1) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(canvas).toBeFocused();
  expect(await frame.evaluate((f) => getComputedStyle(f).boxShadow)).not.toBe("none");
});

test("fixture in 3D with zoom: a Zoom button that disables itself at its limit hands the focus to one in the group", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"], view: "auto" });
  await page.goto("14-how-to-measure/");
  await page.locator('[data-anim="fixture"] canvas.anim-figure__canvas--3d').waitFor();
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const group = page.getByRole("group", { name: "Zoom" });
  const into = group.getByRole("button", { name: "Zoom in" });
  const inGroup = () => page.evaluate(() => Boolean(document.activeElement?.closest(".anim-zoom")));
  await into.focus();
  for (let i = 0; i < 12 && (await into.isEnabled()); i += 1) {
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.__ambeAnim?.finishAll());
  }
  await expect(into).toBeDisabled();
  await expect(group.getByRole("button", { name: "Zoom out" })).toBeFocused();
  const reset = group.getByRole("button", { name: "Reset view" });
  await reset.focus();
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await expect(reset).toBeDisabled();
  expect(await inGroup()).toBe(true);
  // Zoom out at 1x is disabled; focus it through Zoom in instead.
  await into.focus();
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  const out = group.getByRole("button", { name: "Zoom out" });
  await out.focus();
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await expect(out).toBeDisabled();
  await expect(into).toBeFocused();
});

/* ---------------------------------------------------------------------------
 * Every live 3D figure, from the registry (plan P11, VL7). A figure task
 * sets `zoom` and `highlight` in its own registry file; the cases below
 * then hold it to them, with no edit to this file.
 * ------------------------------------------------------------------------ */

for (const { page: path, slug, control, zoom, highlight } of REGISTRY.filter((r) => r.control)) {
  test(`${slug} in 3D: axe on the figure, the canvas focus ring${zoom ? ", the Zoom group and its readout" : ""}${highlight ? ", the highlight at 3:1" : ""}`, async ({ page }) => {
    await page.goto(path);
    const host = page.locator(hostOf(slug));
    await expect(host).toHaveClass(/is-enhanced/);
    await host.scrollIntoViewIfNeeded();
    const button = host.locator(`.anim-controls ${control}`);
    // A step about a flat graph can hide the 3D control: step on until it shows.
    await stepOn(page, host, () => button.isVisible());
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    const canvas = host.locator("canvas.anim-figure__canvas--3d");
    await canvas.waitFor();
    await settle(page, host);
    const result = await new AxeBuilder({ page }).include(hostOf(slug)).analyze();
    const bad = result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(bad).toEqual([]);
    await expect(canvas).toHaveAttribute("tabindex", "0");
    // Shift+Tab from the 3D control reaches the canvas (the frame comes
    // before the controls), and its frame shows the focus ring.
    await button.focus();
    for (let i = 0; i < 40 && !(await canvas.evaluate((c) => c === document.activeElement)); i += 1) {
      await page.keyboard.press("Shift+Tab");
    }
    await expect(canvas).toBeFocused();
    const ring = await canvas.evaluate((c) => getComputedStyle(/** @type {Element} */ (c.parentElement)).boxShadow);
    expect(ring).not.toBe("none");
    if (zoom) {
      const group = host.getByRole("group", { name: "Zoom" });
      await expect(group).toHaveCount(1);
      for (const name of ["Zoom out", "Zoom in", "Reset view"]) await expect(group.getByRole("button", { name })).toBeAttached();
      await expect(group.locator("output")).toHaveAttribute("aria-live", "polite");
      await expect(canvas).toHaveAttribute("aria-label", /Zoom with the buttons, or with plus and minus when focused\.$/);
    }
    if (highlight) {
      // The highlight as this figure's frame resolves it, in both themes.
      for (const scheme of ["slate", "default"]) {
        const values = await host.locator(".anim-figure__frame").first().evaluate((frame, s) => {
          document.body.setAttribute("data-md-color-scheme", s);
          const style = getComputedStyle(frame);
          return ["--ambe-highlight", "--ambe-plot-bg", "--ambe-stage-bottom"].map((n) => style.getPropertyValue(n).trim());
        }, scheme);
        for (const ground of values.slice(1)) {
          expect(contrast(values[0], ground), `${slug} highlight on ${ground}, ${scheme}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
}

/* ---------------------------------------------------------------------------
 * The visual language's tokens (three-visual-language design §2, plan P3)
 * ------------------------------------------------------------------------ */

/** WCAG contrast of two #rrggbb colours. @param {string} a @param {string} b */
function contrast(a, b) {
  const lum = (/** @type {string} */ hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** #rrggbb from three 0 to 1 sRGB channels. @param {number[]} c */
const hex = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
/** @param {string} h @returns {number[]} */
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
/** lib/style.js mix(): `a` moved toward `b` by `t`, per sRGB channel. @param {string} a @param {string} b @param {number} t */
const mixHex = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

/** sRGB channel to linear. @param {number} c */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Machado, Oliveira and Fernandes 2009, severity 1, on linear RGB. */
const CVD = {
  normal: null,
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
/**
 * OKLab distance x 100 between two linear RGB colours, as a viewer with
 * `vision` sees them (design §2's method).
 * @param {number[]} a @param {number[]} b @param {keyof typeof CVD} vision
 */
function deltaE(a, b, vision) {
  const m = CVD[vision];
  const see = (/** @type {number[]} */ c) => (m ? m.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))) : c);
  const lab = (/** @type {number[]} */ c) => {
    const [r, g, bl] = see(c);
    const [l, mm, s] = [
      0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl,
      0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl,
      0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl,
    ].map(Math.cbrt);
    return [0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s];
  };
  const [p, q] = [lab(a), lab(b)];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// diverge-mid is meant to sit near the background, so it is not a mark.
const MARKS = ["--ambe-highlight", "--ambe-plot-ink", ...[0, 1, 2, 3, 4].map((i) => `--ambe-ramp-${i}`),
  "--ambe-sync-slot", "--ambe-data-slot", "--ambe-diverge-neg", "--ambe-diverge-pos"];
const GROUNDS = ["--ambe-plot-bg", "--ambe-stage-bottom"];

for (const mode of /** @type {const} */ (["slate", "default", "print"])) {
  test(`tokens, ${mode}: highlight, its outline, ink, every ramp stop and the figure colours at 3:1 on the plot and the stage`, async ({ page }) => {
    await page.goto("15-exact-reproduction/");
    if (mode === "print") await page.emulateMedia({ media: "print" });
    const values = await page.evaluate(({ names, scheme }) => {
      if (scheme !== "print") document.body.setAttribute("data-md-color-scheme", scheme);
      const style = getComputedStyle(document.body);
      return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(n).trim()]));
    }, { names: [...MARKS, ...GROUNDS, "--ambe-highlight-chip", "--ambe-diverge-mid"], scheme: mode });
    const outlineMix = await page.evaluate(async () => {
      const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
      return (await import(new URL("lib/highlight.js", script.src).href)).OUTLINE_MIX;
    });
    // Print keeps the light values (extra.css: the dark block is screen only).
    expect(values["--ambe-plot-bg"]).toBe(mode === "slate" ? "#0f1015" : "#ffffff");
    for (const mark of MARKS) {
      for (const ground of GROUNDS) {
        // Light ramp-4 on the stage bottom is the tightest pair, at 3.22 (design §2).
        expect(contrast(values[mark], values[ground]), `${mark} on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(contrast(values["--ambe-plot-ink"], values["--ambe-highlight-chip"])).toBeGreaterThanOrEqual(4.5);
    // The highlight's dashed outline carries the selection in print (design §7).
    const outline = mixHex(values["--ambe-highlight"], values["--ambe-plot-bg"], outlineMix);
    for (const ground of GROUNDS) {
      expect(contrast(outline, values[ground]), `highlight outline on ${ground}`).toBeGreaterThanOrEqual(3);
    }
    // The diverging ends stay apart for protan and deutan viewers too, at
    // full strength and halfway to the middle.
    const [neg, mid, pos] = ["neg", "mid", "pos"].map((n) => rgb(values[`--ambe-diverge-${n}`]).map(toLinear));
    for (const vision of /** @type {(keyof typeof CVD)[]} */ (Object.keys(CVD))) {
      for (const [t, least] of [[0, 15], [0.5, 8]]) {
        const toward = (/** @type {number[]} */ c) => c.map((v, i) => v + (mid[i] - v) * t);
        expect(deltaE(toward(neg), toward(pos), vision), `diverging ends at ${1 - t} strength, ${vision}`).toBeGreaterThanOrEqual(least);
      }
    }
  });
}

// The complex figure's helix, x + iy, runs violet to indigo by turn
// (anim-complex-3d.js HELIX, through lib/style.js tokenGradient): every
// colour along it is a mark at 3:1 on the plot and the stage, and none is
// near x (teal, --ambe-cat-2) or y (amber, --ambe-cat-3): an OKLab distance
// of 20 or more, and 10 or more for protan and deutan viewers (pink to
// indigo failed here: deutan, pink is 1.2 from the dark teal).
for (const mode of /** @type {const} */ (["slate", "default", "print"])) {
  test(`tokens, ${mode}: the complex helix's gradient at 3:1 on the plot and the stage, and apart from x and y`, async ({ page }) => {
    await page.goto("15-exact-reproduction/");
    if (mode === "print") await page.emulateMedia({ media: "print" });
    const values = await page.evaluate(async ({ grounds, scheme }) => {
      if (scheme !== "print") document.body.setAttribute("data-md-color-scheme", scheme);
      await new Promise((r) => setTimeout(r));
      const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
      const S = await import(new URL("lib/style.js", script.src).href);
      const helix = S.tokenGradient(["--ambe-cat-5", "--ambe-cat-1"]);
      const style = getComputedStyle(document.body);
      const hex = (/** @type {number} */ n) => `#${n.toString(16).padStart(6, "0")}`;
      return {
        helix: Array.from({ length: 11 }, (_, i) => hex(helix(i / 10))),
        ends: ["--ambe-cat-5", "--ambe-cat-1"].map((n) => style.getPropertyValue(n).trim()),
        x: style.getPropertyValue("--ambe-cat-2").trim(),
        y: style.getPropertyValue("--ambe-cat-3").trim(),
        grounds: grounds.map((n) => style.getPropertyValue(n).trim()),
      };
    }, { grounds: GROUNDS, scheme: mode });
    expect([values.helix[0], values.helix[10]]).toEqual(values.ends);
    for (const [i, colour] of values.helix.entries()) {
      for (const ground of values.grounds) {
        expect(contrast(colour, ground), `helix at ${i / 10} on ${ground}`).toBeGreaterThanOrEqual(3);
      }
      for (const vision of /** @type {(keyof typeof CVD)[]} */ (Object.keys(CVD))) {
        for (const [name, other] of [["x", values.x], ["y", values.y]]) {
          const d = deltaE(rgb(colour).map(toLinear), rgb(other).map(toLinear), vision);
          expect(d, `helix at ${i / 10} against ${name}, ${vision}`).toBeGreaterThanOrEqual(vision === "normal" ? 20 : 10);
        }
      }
    }
  });
}
