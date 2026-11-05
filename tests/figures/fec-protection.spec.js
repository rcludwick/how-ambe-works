// The fec-protection figure's 2D side (anim-fec-protection.js, plan N6):
// the steps set the coding, the burst and the rate, the status line states
// what the burst did, the controls move it, and the provenance badge and
// the honesty about the interleaver are on the figure. Reduced motion, so
// the 2D canvas is the view.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "10-the-dstar-frame/";
const HOST = '[data-anim="fec-protection"]';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  await settle(page, page.locator(HOST));
});

test("the four steps: no code, the patent's codes, the u0 key chain, bursts in order", async ({ page }) => {
  const host = page.locator(HOST);
  const status = host.locator(".fec-status");
  await expect(host.locator('[data-code="none"]')).toHaveAttribute("aria-pressed", "true");
  await expect(status).toContainText("A burst of 7 errors from bit 57 of 88, sent in order: Bare u₅: 5 errors, corrects 0, so it fails. 2 vectors in all arrive wrong.");
  await expect(status).toContainText("With no code there is nothing for the decoder to count");
  await host.locator('[data-step="next"]').click();
  await expect(host.locator('[data-code="patent"]')).toHaveAttribute("aria-pressed", "true");
  await expect(status).toContainText("from bit 57 of 144, interleaved: Hamming u₄: 2 errors, corrects 1, so it fails.");
  await expect(status).toContainText("5 of 12 corrections counted in u₁ to u₆: within the threshold of 6, so the frame is used");
  await host.locator('[data-step="next"]').click();
  await expect(status).toContainText("A burst of 4 errors from bit 0 of 144, sent in order: Golay u₀: 4 errors, corrects 3, so it fails.");
  await expect(status).toContainText("11.4 of 12 corrections counted in u₁ to u₆: over the threshold of 6, so the frame is repeated");
  await host.locator('[data-step="next"]').click();
  await expect(status).toContainText("A burst of 6 errors from bit 98 of 144, sent in order: Hamming u₄: 6 errors, corrects 1, so it fails.");
  // Interleaving spreads the same six over six codewords, one each.
  await host.locator('[data-ref="interleave"]').check();
  await expect(status).toContainText("interleaved: Golay u₀: 1 error, corrects 3.");
  await expect(status).not.toContainText("fails");
  // One more bit and a codeword takes two.
  await host.locator('[data-ref="burst"]').fill("7");
  await expect(status).toContainText("Golay u₁: 2 errors, corrects 3.");
});

test("the threshold and the bit error rate follow their controls, and the canvas label says so", async ({ page }) => {
  const host = page.locator(HOST);
  await host.locator('[data-step="next"]').click();
  await host.locator('[data-ref="threshold"]').fill("4");
  await expect(host.locator('[data-ref="thresholdOut"]')).toHaveText("4");
  await expect(host.locator(".fec-status")).toContainText("over the threshold of 4, so the frame is repeated");
  await host.locator('[data-ref="ber"]').fill("10");
  await expect(host.locator('[data-ref="berOut"]')).toHaveText("1.0%");
  await expect(host.locator("canvas.anim-figure__canvas")).toHaveAttribute("aria-label",
    /with the patent's codes\. At 1\.0% bit errors: u₀ to u₃ 0\.0076%, u₄ to u₆ 0\.96%, u₇ 6\.8%\./);
});

test("dragging on the 2D curves sets the bit error rate", async ({ page }) => {
  const host = page.locator(HOST);
  const at = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-fec-protection.js", script.src).href);
    const box = /** @type {HTMLElement} */ (document.querySelector('[data-anim="fec-protection"] .anim-figure__frame'));
    const L = m.computeLayout({ width: box.clientWidth, height: box.clientHeight });
    return { x: m.berX(L, 0.08), y: L.curves.y + 20 };
  });
  await host.locator("canvas.anim-figure__canvas").click({ position: at });
  await expect(host.locator('[data-ref="berOut"]')).toHaveText("8.0%");
});

test("the frame's height follows its width, and the figure carries the illustrative badge and the interleaver note", async ({ page }) => {
  const host = page.locator(HOST);
  const { width, height, natural } = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const m = await import(new URL("anim-fec-protection.js", script.src).href);
    const box = /** @type {HTMLElement} */ (document.querySelector('[data-anim="fec-protection"] .anim-figure__frame'));
    return { width: box.clientWidth, height: box.clientHeight, natural: m.naturalHeight(box.clientWidth) };
  });
  expect(Math.abs(height - natural)).toBeLessThanOrEqual(2);
  expect(width).toBeGreaterThan(300);
  await expect(host.locator(".anim-figure__caption .anim-badge")).toHaveText("illustrative");
  await expect(host.locator(".anim-figure__caption")).toContainText("D-STAR's own pattern is not published");
  await expect(host.locator(".anim-badge--measured")).toHaveCount(0);
});
