// The gain-definitions figure in 2D (plan N9, design §5.9): the readouts,
// every step under ?nowebgl, data loaded one recording at a time, the
// slider, and the phone.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "13-what-is-not-established/";
const HOST = '[data-anim="gain-definitions"]';

test("gain-definitions, ?nowebgl: the 3D control is disabled with the hint, and every step reads in 2D", async ({ page }) => {
  /** @type {string[]} */
  const data = [];
  page.on("request", (r) => {
    const m = /assets\/data\/([\w-]+)\/(frames|spectra)\.json/.exec(r.url());
    if (m) data.push(m[1]);
  });
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator(HOST);
  await settle(page, host);
  await expect(host.locator('[data-ref="view3d"]')).toBeDisabled();
  await expect(host.locator(".anim-figure__hint--webgl")).toBeVisible();
  // Step 1 loads lr-a alone.
  expect([...new Set(data)]).toEqual(["lr-a"]);
  const forms = host.locator('[data-ref="forms"]');
  await expect(forms).toHaveJSProperty("tagName", "OUTPUT");
  await expect(forms).toHaveAttribute("aria-live", "polite");
  const canvas = host.locator(".anim-figure__frame canvas.anim-figure__canvas");
  await expect(host.locator('[data-role="frame"]')).toContainText("lr-a frame 36");
  await expect(host.locator('[data-role="gap"]')).toHaveText("gap 1.1 dB at spread 3.1 dB");
  await expect(host.locator('[data-role="harmonics"]')).toContainText("26, cutoff at 3.7 kHz");
  await expect(host.locator('[data-role="harmonics"] .anim-badge')).toHaveText("illustrative");
  await expect(canvas).toHaveAttribute("aria-label", /G_L, is 1\.1 dB lower/);

  const next = host.locator('[data-step="next"]');
  await next.click();
  await expect(host.locator('[data-role="frame"]')).toContainText("lj-a frame 28");
  await expect(host.locator('[data-role="gap"]')).toHaveText("gap 31.5 dB at spread 26.8 dB");
  await next.click();
  await expect(host.locator('[data-role="loaded"]')).toHaveText("661 from all eight recordings; spread against gap, r = 0.87");
  await next.click();
  await expect(host.locator('[data-role="frame"]')).toContainText("lr-a frame 96");
  await expect(host.locator('[data-role="partner"]')).toHaveText("lj-c frame 52: spread 18.5 dB, gap 17.7 dB");
  await expect(host.locator('[data-ref="key-partner"]')).toBeVisible();
  await expect(host.locator('[data-role="gap"]')).toHaveText("gap 36.9 dB at spread 18.4 dB");
  await expect(canvas).toHaveAttribute("aria-label", /lj-c frame 52 has the same spread/);
  await expect(host.locator('[data-ref="camera"]')).toBeHidden();
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
});

test("gain-definitions: the recording and the slider drive the readouts", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const slider = host.locator('[data-ref="frame"]');
  await expect(slider).toHaveAttribute("max", "87");
  await slider.fill("87");
  await expect(host.locator('[data-ref="frame-out"]')).toHaveText("spread 20.8 dB");
  await expect(host.locator('[data-role="frame"]')).toContainText("lr-a frame 80");
  await host.locator('[data-ref="clip"]').selectOption("lj-b");
  await expect(host.locator('[data-role="frame"]')).toContainText("lj-b frame 121");
  await expect(slider).toHaveAttribute("max", "121");
  await expect(slider).toHaveValue("0");
});

test("gain-definitions on a phone: no horizontal scroll, the comb above the scatter", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const geo = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const mod = await import(new URL("anim-gain-definitions.js", script.src).href);
    const frame = /** @type {HTMLElement} */ (document.querySelector('[data-anim="gain-definitions"] .anim-figure__frame'));
    const g = mod.layout(frame.clientWidth, frame.clientHeight);
    return { stacked: g.stacked, below: g.scatter.area.top > g.comb.area.bottom, inside: g.scatter.area.bottom <= frame.clientHeight };
  });
  expect(geo).toEqual({ stacked: true, below: true, inside: true });
});

for (const width of [375, 390, 1280]) {
  test(`gain-definitions at ${width} px: the 3D control never covers the spread readout, at any step`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(PAGE);
    const host = page.locator(HOST);
    await settle(page, host);
    for (let step = 0; step < 4; step += 1) {
      if (step) await host.locator('[data-step="next"]').click();
      await expect(host.locator(".anim-figure__frame")).toHaveAttribute("data-state", "ready");
      const button = await host.locator('[data-ref="view3d"]').boundingBox();
      const readout = await host.locator('[data-ref="frame-out"]').boundingBox();
      const figure = await host.locator(".anim-figure").boundingBox();
      if (!button || !readout || !figure) throw new Error("no box");
      const apart = button.x >= readout.x + readout.width || readout.x >= button.x + button.width ||
        button.y >= readout.y + readout.height || readout.y >= button.y + button.height;
      expect(apart, `step ${step + 1}`).toBe(true);
      expect(readout.x + readout.width).toBeLessThanOrEqual(figure.x + figure.width);
    }
  });
}

test("gain-definitions: every step asks for 2D, so a step leaves 3D for the flat plots", async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const button = host.locator('[data-ref="view3d"]');
  const flat = host.locator(".anim-figure__frame canvas.anim-figure__canvas:not(.anim-figure__canvas--3d)");
  // Step 1 is a flat comb: the figure opens in 2D, with nothing 3D on the page.
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
  await expect(host.locator(".anim-steps > li")).toHaveCount(4);
  for (let step = 1; step < 4; step += 1) {
    await button.click();
    await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(1);
    await host.locator('[data-step="next"]').click();
    await expect(button, `step ${step + 1}`).toHaveAttribute("aria-pressed", "false");
    await expect(host.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
    await expect(flat).toBeVisible();
  }
});

test("gain-definitions: stepping on and back before a clip loads leaves no loading overlay over the drawn figure", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/assets\/data\/lj-a\/(frames|spectra)\.json/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue().catch(() => {});
  });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  const frame = host.locator(".anim-figure__frame");
  await host.locator('[data-step="next"]').click();
  await expect(frame).toHaveAttribute("data-state", "loading");
  await host.locator('[data-step="prev"]').click();
  await expect(frame).toHaveAttribute("data-state", "ready");
  await expect(host.locator('[data-role="frame"]')).toContainText("lr-a frame 36");
  // The slow clip arriving later does not take the figure back.
  await page.waitForTimeout(3000);
  await expect(frame).toHaveAttribute("data-state", "ready");
  await expect(host.locator('[data-role="frame"]')).toContainText("lr-a frame 36");
});

test("gain-definitions: a clip that fails to load shows the error state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/assets\/data\/lj-b\/spectra\.json/, (route) => route.fulfill({ status: 500, body: "" }));
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await settle(page, host);
  await host.locator('[data-ref="clip"]').selectOption("lj-b");
  await expect(host.locator(".anim-figure__frame")).toHaveAttribute("data-state", "error");
});
