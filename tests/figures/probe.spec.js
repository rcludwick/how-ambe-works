// The probe figure in 2D (plan N1, design §5.1): the readouts, the rows and
// plane under ?nowebgl, the steps reading correctly in 2D, the sweep strip,
// and the phone. Chapter 2 runs the probe three times, one experiment each:
// the sine test alone (#fig-2-1), both tests (#fig-2-2) and the sweep
// (#fig-2-4), each with its own steps.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "02-fourier-and-the-dft/";
const SINE = "#fig-2-1";
const BOTH = "#fig-2-2";
const SWEEP = "#fig-2-4";

/** @param {import("@playwright/test").Locator} host */
const read = async (host) => ({
  f: await host.locator('[data-role="freq-out"]').textContent(),
  phase: await host.locator('[data-role="phase-out"]').textContent(),
  sine: await host.locator('[data-role="f-sine"]').textContent(),
  cosine: await host.locator('[data-role="f-cosine"]').textContent(),
  polar: await host.locator('[data-role="f-polar"]').textContent(),
  strip: await host.locator('[data-ref="strip"]').isVisible(),
});

/** Each host's steps, as its readouts give them. */
const STEPS = {
  [SINE]: [
    { f: "200 Hz", phase: "0°", sine: "80.00", cosine: "off", polar: "needs both tests", strip: false },
    { f: "200 Hz", phase: "90°", sine: "0.00", cosine: "off", polar: "needs both tests", strip: false },
  ],
  [BOTH]: [
    { f: "200 Hz", phase: "90°", sine: "0.00", cosine: "80.00", polar: "80.00 at 90°", strip: false },
    { f: "200 Hz", phase: "45°", sine: "56.57", cosine: "56.57", polar: "80.00 at 45°", strip: false },
    { f: "250 Hz", phase: "0°", sine: "0.00", cosine: "0.00", polar: "0.00, no angle", strip: false },
  ],
  [SWEEP]: [
    { f: "225 Hz", phase: "0°", sine: "0.00", cosine: "-47.96", polar: "47.96 at 270°", strip: true },
  ],
};

test("probe, ?nowebgl: the 3D control is disabled with the hint, and every step reads in 2D", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const both = page.locator(BOTH);
  await settle(page, both);
  await expect(both.locator('[data-ref="view3d"]')).toBeDisabled();
  await expect(both.locator(".anim-figure__hint--webgl")).toBeVisible();
  const forms = both.locator('[data-role="forms"]');
  await expect(forms).toHaveJSProperty("tagName", "OUTPUT");
  await expect(forms).toHaveAttribute("aria-live", "polite");

  const sine = page.locator(SINE);
  await settle(page, sine);
  await expect(sine.locator('[data-role="f-sine"]')).toHaveText("80.00");
  await expect(sine.locator('[data-role="f-cosine"]')).toHaveText("off");
  await expect(sine.locator(".anim-figure__frame canvas.anim-figure__canvas")).toHaveAttribute("aria-label", /add up to 80\.00\.$/);
  // Figure 2.1 has no cosine test, so neither its label nor its plane names one.
  await sine.locator('[data-step="next"]').click();
  await expect(sine.locator('[data-role="f-sine"]')).toHaveText("0.00");

  await settle(page, both);
  await expect(both.locator('[data-role="f-cosine"]')).toHaveText("80.00");
  await expect(both.locator('[data-role="f-polar"]')).toHaveText("80.00 at 90°");
  const next = both.locator('[data-step="next"]');
  await next.click();
  await expect(both.locator('[data-role="f-polar"]')).toHaveText("80.00 at 45°");
  await expect(both.locator('[data-ref="camera"]')).toBeHidden();
  await next.click();
  await expect(both.locator('[data-role="f-polar"]')).toHaveText("0.00, no angle");
  await expect(both.locator('[data-ref="strip"]')).toBeHidden();

  const sweep = page.locator(SWEEP);
  await settle(page, sweep);
  await expect(sweep.locator('[data-ref="strip"]')).toBeVisible();
  await expect(sweep.locator('[data-role="f-polar"]')).toHaveText("47.96 at 270°");
  await expect(sweep.locator('[data-ref="strip-canvas"]')).toHaveAttribute("aria-label", /At 225 Hz it is 47\.96\./);
  await expect(page.locator("canvas.anim-figure__canvas--3d")).toHaveCount(0);
});

test("probe: the sliders drive the readouts", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(BOTH);
  await settle(page, host);
  for (const [phase, polar] of [["0", "80.00 at 0°"], ["90", "80.00 at 90°"], ["210", "80.00 at 210°"]]) {
    await host.locator('[data-role="phase"]').fill(phase);
    await expect(host.locator('[data-role="f-polar"]')).toHaveText(polar);
  }
  await host.locator('[data-role="phase"]').fill("0");
  for (const [f, length] of [["175", "54.30"], ["250", "0.00"], ["225", "47.96"]]) {
    await host.locator('[data-role="freq"]').fill(f);
    await expect(host.locator('[data-role="freq-out"]')).toHaveText(`${f} Hz`);
    await expect(host.locator('[data-role="f-polar"]')).toContainText(length);
  }
  const sweep = page.locator(SWEEP);
  await settle(page, sweep);
  await sweep.locator('[data-role="freq"]').fill("175");
  await expect(sweep.locator('[data-ref="strip-canvas"]')).toHaveAttribute("aria-label", /At 175 Hz it is 54\.30\./);
});

test("probe on a phone: no horizontal scroll, rows above the plane", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(BOTH);
  await settle(page, host);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const stacked = await page.evaluate(async (sel) => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const mod = await import(new URL("anim-probe.js", script.src).href);
    const frame = /** @type {HTMLElement} */ (document.querySelector(`${sel} .anim-figure__frame`));
    const geo = mod.layout(frame.clientWidth, frame.clientHeight);
    return { stacked: geo.stacked, below: geo.plane.area.top > geo.rows[2].area.bottom, inside: geo.plane.area.bottom <= frame.clientHeight };
  }, BOTH);
  expect(stacked).toEqual({ stacked: true, below: true, inside: true });
});

test("probe: every step reads the same reached by Next or by Previous, and after a slider moved", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  for (const [sel, want] of Object.entries(STEPS)) {
    const host = page.locator(sel);
    await settle(page, host);
    expect(await read(host), `${sel} step 1`).toEqual(want[0]);
    if (want.length < 2) continue;
    // A slider moved on step 1 does not carry into step 2.
    await host.locator('[data-role="freq"]').fill("300");
    for (let i = 1; i < want.length; i += 1) {
      await host.locator('[data-step="next"]').click();
      expect(await read(host), `${sel} step ${i + 1} by Next`).toEqual(want[i]);
    }
    for (let i = want.length - 2; i >= 0; i -= 1) {
      await host.locator('[data-step="prev"]').click();
      expect(await read(host), `${sel} step ${i + 1} by Previous`).toEqual(want[i]);
    }
  }
});

test("probe: each experiment shows only its own controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const sine = page.locator(SINE);
  await settle(page, sine);
  await expect(sine.locator('[data-role="cosine"]')).toBeHidden();
  await expect(sine.locator('[data-role="sweep"]')).toBeHidden();
  await expect(sine.locator('[data-ref="view3d"]')).toBeHidden();
  const both = page.locator(BOTH);
  await settle(page, both);
  await expect(both.locator('[data-role="cosine"]')).toBeHidden();
  await expect(both.locator('[data-role="sweep"]')).toBeHidden();
  await expect(both.locator('[data-ref="view3d"]')).toBeVisible();
  const sweep = page.locator(SWEEP);
  await settle(page, sweep);
  await expect(sweep.locator(".anim-figure__frame")).toBeHidden();
  await expect(sweep.locator('[data-ref="strip"]')).toBeVisible();
  await expect(sweep.locator('[data-ref="view3d"]')).toBeHidden();
});
