// The frame-boundary figure's flat view (ch11; three-everywhere plan N7,
// design §5.7): its readouts, the steps in 2D, the canvas label, and a page
// that reads no data file for it.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "11-synthesis/";
const HOST = '[data-anim="frame-boundary"]';

/** @param {import("@playwright/test").Page} page */
async function open(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator(HOST);
  await host.locator(".anim-figure").waitFor();
  await settle(page, host);
  return host;
}

/** @param {import("@playwright/test").Locator} host @param {string} role */
const out = (host, role) => host.locator(`output[data-role="r-${role}"]`);

test("step 1, the crossfade: midpoints 0.98, 0.73 and 0.06 at harmonics 1, 4 and 8, and the weights sum to 1", async ({ page }) => {
  const host = await open(page);
  await expect(out(host, "mid")).toHaveText("1: 0.98 · 4: 0.73 · 8: 0.06 · 12: 0.64 · 16: 0.99");
  await expect(out(host, "dip")).toContainText("harmonic 8, down to 0.03");
  // Above harmonic 8 the envelope beats: harmonic 16 dips twice.
  await expect(out(host, "dip")).toContainText("harmonic 16 dips twice, to 0.45 and 0.53");
  await expect(out(host, "weights")).toHaveText("old 0.50, new 0.50, sum 1.00");
  await expect(out(host, "pitch")).toContainText("120 Hz to 126.0 Hz: 6.0 Hz, 4.8% of the new fundamental (under 10%, the gate is open)");
  await expect(host.locator("canvas.anim-figure__canvas")).toHaveAttribute("aria-label", /Level at 10 ms, by harmonic, 1: 0\.98/);
});

test("the steps in 2D: switch, the patent's rule, the gate closing at 15%, the handover's power of 0.5", async ({ page }) => {
  const host = await open(page);
  const next = host.getByRole("button", { name: "Next" });
  /** @returns {Promise<number>} the highlighted harmonic */
  const top = () => page.evaluate(() => window.__ambeAnim.figures["frame-boundary"].model().top);
  const legendTop = host.locator('[data-role="legend-top"]');
  expect(await top()).toBe(8);
  // The waveforms are drawn, and named in the legend, for the switch alone.
  await expect(host.locator('[data-for="switch"]')).toBeHidden();
  await next.click();
  await expect(out(host, "dip")).toContainText("the phase jumps 22° on harmonic 1 and 173° on harmonic 8");
  await expect(host.locator('[data-for="switch"]')).toBeVisible();
  await next.click();
  await expect(out(host, "rule")).toHaveText("Harmonics 1 to 7 swept by one oscillator each, 8 to 16 crossfaded");
  await expect(out(host, "mid")).toHaveText("1: 1.00 · 4: 1.00 · 8: 0.06 · 12: 0.64 · 16: 0.99");
  await next.click();
  await expect(out(host, "rule")).toHaveText("The pitch gate is closed, so every harmonic is crossfaded");
  await expect(host.locator('input[data-role="change"]')).toHaveValue("15");
  // The step's subject: harmonic 4, which dips now the gate is closed.
  expect(await top()).toBe(4);
  await expect(legendTop).toHaveText("harmonic 4 (thick)");
  await next.click();
  await expect(out(host, "weights")).toContainText("power 0.25 + 0.25 = 0.50 of either frame's");
  await expect(host.locator('[data-for="handover"]')).toBeVisible();
  expect(await top()).toBe(10);
  await expect(legendTop).toHaveText("harmonic 10, one of 9 to 12 (thick)");
});

test("the pitch slider: the patent's gate, measured against the new fundamental, closes at 12%", async ({ page }) => {
  const host = await open(page);
  await host.locator('button[data-scheme="rule"]').click();
  const slider = host.locator('input[data-role="change"]');
  for (const [value, open] of [["11", true], ["12", false]]) {
    await slider.fill(value);
    await expect(out(host, "pitch")).toContainText(open ? "the gate is open" : "the gate is closed");
  }
});

test("the step after a slider move: the switch quotes 173° at 5% whatever the slider says", async ({ page }) => {
  const host = await open(page);
  await host.locator('input[data-role="change"]').fill("15");
  await host.getByRole("button", { name: "Next" }).click();
  await expect(out(host, "dip")).toContainText("173° on harmonic 8");
});

test("scope: nothing the figure does asks for a data file or a recording", async ({ page }) => {
  // Every data file and recording on the page fails; the figure still draws.
  await page.route(/assets\/(data|audio)\//, (route) => route.abort());
  const host = await open(page);
  await expect(host).toHaveClass(/is-enhanced/);
  await expect(out(host, "mid")).toHaveText(/^1: 0\.98/);
});
