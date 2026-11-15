// The utterance figure's 2D path (anim-utterance.js): steps, readouts and
// captions read correctly without WebGL, and the layout and camera
// controls only show with the 3D view.
import { test, expect } from "@playwright/test";
import { settle } from "./helpers.js";

const PAGE = "01-why-sinusoids/";

test("without WebGL the steps move the closeup and the readouts follow, and the 3D-only controls stay hidden", async ({ page }) => {
  await page.goto(`${PAGE}?nowebgl`);
  const host = page.locator('[data-anim="utterance"]');
  await settle(page, host);
  await expect(host).toHaveClass(/is-enhanced/);
  await expect(host.locator(".anim-fallback")).toBeHidden();
  await expect(host.locator('.anim-controls [data-ref="view3d"]')).toBeDisabled();
  for (const role of ["layout", "camera"]) await expect(host.locator(`[data-role="${role}"]`)).toBeHidden();
  await expect(host.locator("canvas")).toHaveCount(1);
  await expect(host.locator("canvas")).not.toHaveClass(/anim-utterance__over/);

  const windowOut = host.locator('[data-role="r-window"]');
  const periods = host.locator('[data-role="r-periods"]');
  await expect(windowOut).toHaveText("1.72s, repeating 186 times a second");
  await expect(periods).toHaveText("10 of 5.38 ms; each like the next (correlation 0.95 on average)");
  await expect(host.locator('[data-role="caption"]')).toContainText("the vocal cords produce a repeating pulse every 5.38 ms");

  const next = host.getByRole("button", { name: "Next" });
  await next.click();
  await expect(host.locator('[data-window="voiced"]').last()).toHaveAttribute("aria-pressed", "true");
  await next.click();
  await expect(host.locator('button[data-window="unvoiced"]')).toHaveAttribute("aria-pressed", "true");
  await expect(windowOut).toHaveText("1.20s, no repeat rate the tracker will commit to");
  await expect(periods).toHaveText("cut at the vowel's 5.38 ms: no two alike (correlation 0.06 on average)");
  await expect(host.locator('[data-role="caption"]')).toContainText("the “sh” in “shells”");
  await expect(host.locator(".anim-badge")).toHaveText(["input (Piper TTS, 8 kHz)", "derived (from the input audio)"]);
});

test("the readouts are polite live outputs, and the 2D canvas keeps its label", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const host = page.locator('[data-anim="utterance"]');
  await settle(page, host);
  await expect(host.locator('[data-role="readout"]')).toHaveAttribute("aria-live", "polite");
  await expect(host.locator("output[data-role]")).toHaveCount(2);
  await expect(host.locator(".anim-figure__canvas").first()).toHaveAttribute("aria-label", /sixty milliseconds of it at full sample resolution/);
});
