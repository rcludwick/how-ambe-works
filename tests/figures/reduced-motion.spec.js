// Under reduced motion, controls that start motion hide and controls that
// start sound stay (design §0 item 10, §3.6). Every play button must say
// which it is, or it would show up under reduced motion by accident.
import { test, expect } from "@playwright/test";
import { freePlayAll } from "./helpers.js";

/** @type {{page: string, audio: number, motion: number}[]} */
const PAGES = [
  { page: "01-why-sinusoids/", audio: 2, motion: 0 }, // utterance, utterance-spectra
  { page: "02-fourier-and-the-dft/", audio: 0, motion: 1 }, // complex "Spin"
  { page: "07-multi-band-excitation/", audio: 2, motion: 1 }, // harmonics Play, voicing Sound, voicing Play
  { page: "08-analysis/", audio: 0, motion: 1 }, // frames
  { page: "10-the-dstar-frame/", audio: 2, motion: 1 }, // frame-path's two players, bits
  { page: "11-synthesis/", audio: 1, motion: 1 }, // harmonic-sum player, synth
];

for (const { page: path, audio, motion } of PAGES) {
  test(`${path}: reduced motion shows audio, hides motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // While steps are on, a figure hides its secondary rows (anim.css).
    await freePlayAll(page);

    await expect(page.locator(".anim-btn--play:not([data-kind])")).toHaveCount(0);
    const audioControls = page.locator('[data-kind="audio"]');
    const motionControls = page.locator('[data-kind="motion"]');
    await expect(audioControls).toHaveCount(audio);
    await expect(motionControls).toHaveCount(motion);
    for (const control of await audioControls.all()) await expect(control).toBeVisible();
    for (const control of await motionControls.all()) await expect(control).toBeHidden();
  });

  test(`${path}: normal motion shows every control`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await freePlayAll(page);
    for (const control of await page.locator("[data-kind]").all()) {
      await expect(control).toBeVisible();
    }
  });
}
