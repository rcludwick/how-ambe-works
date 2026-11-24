// The gain-definitions figure's arithmetic (plan N9, design §5.9): the JS
// reproduces tools/gain-stats.py's pinned numbers on all eight recordings,
// and lib/picks.js finds the same frames.
import { test, expect } from "@playwright/test";

const PAGE = "13-what-is-not-established/";

test("gain-definitions: 661 frames; gap 1.1 to 36.9, p10/50/90 8.3, 19.1, 27.6; spread 9.5, 14.1, 19.5; r 0.87; the picks", async ({ page }) => {
  await page.goto(PAGE);
  const got = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const mod = await import(new URL("anim-gain-definitions.js", script.src).href);
    const picks = await import(new URL("lib/picks.js", script.src).href);
    const clips = await (await fetch(new URL("../assets/data/clips.json", script.src))).json();
    const all = await mod.loadRecords("all", new AbortController().signal);
    const lrA = await mod.loadRecords("lr-a", new AbortController().signal);
    const ljA = await mod.loadRecords("lj-a", new AbortController().signal);
    const st = mod.gainStats(all);
    /** @param {number} v */
    const r1 = (v) => Math.round(v * 10) / 10;
    /** @param {any} f */
    const name = (f) => `${f.clip} ${f.i}`;
    const pair = picks.equalSpreadPair(all);
    return {
      clips: clips.clips.map((/** @type {any} */ c) => c.id),
      order: mod.CLIPS,
      frames: st.frames,
      gap: [r1(st.gapMin), r1(st.gapMax), ...st.gap.map(r1)],
      sigma: st.sigma.map(r1),
      r: Math.round(st.r * 100) / 100,
      flattest: [name(picks.GAIN_PICKS.flattest(all)), name(picks.GAIN_PICKS.flattest(lrA))],
      steepest: [name(picks.GAIN_PICKS.steepest(all)), name(picks.GAIN_PICKS.steepest(ljA))],
      pair: [name(pair.frame), name(pair.partner), r1(pair.frame.sigma), r1(pair.partner.sigma), r1(pair.frame.gap), r1(pair.partner.gap)],
      neverNegative: all.every((/** @type {any} */ f) => f.gap >= 0),
      ordered: all.every((/** @type {any} */ f, /** @type {number} */ i) => i === 0 || all[i - 1].sigma <= f.sigma),
      chip: mod.chipText(pair.frame),
    };
  });
  expect(got.order).toEqual(got.clips);
  expect(got.frames).toBe(661);
  expect(got.gap).toEqual([1.1, 36.9, 8.3, 19.1, 27.6]);
  expect(got.sigma).toEqual([9.5, 14.1, 19.5]);
  expect(got.r).toBe(0.87);
  expect(got.flattest).toEqual(["lr-a 36", "lr-a 36"]);
  expect(got.steepest).toEqual(["lj-a 28", "lj-a 28"]);
  expect(got.pair).toEqual(["lr-a 96", "lj-c 52", 18.4, 18.5, 36.9, 17.7]);
  expect(got.neverNegative).toBe(true);
  expect(got.ordered).toBe(true);
  expect(got.chip).toBe("spread 18.4 dB, gap 36.9 dB");
});

test("gain-definitions: a flat comb has no gap, and a level on the -100 dBFS floor drops the frame", async ({ page }) => {
  await page.goto(PAGE);
  const got = await page.evaluate(async () => {
    const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
    const mod = await import(new URL("anim-gain-definitions.js", script.src).href);
    const frame = { i: 0, t: 0, hex: "", derived: { decoded_f0_hz: 125, voiced: true, orig_rms_dbfs: -20 } };
    const flat = mod.gainFrame(frame, new Array(128).fill(-30), "lr-a");
    const floored = mod.gainFrame(frame, [...new Array(40).fill(-30), ...new Array(88).fill(-100)], "lr-a");
    const quiet = mod.gainFrame({ ...frame, derived: { ...frame.derived, orig_rms_dbfs: -41 } }, new Array(128).fill(-30), "lr-a");
    return { L: flat.L, gap: flat.gap, sigma: flat.sigma, floored, quiet };
  });
  expect(got.L).toBe(29);
  expect(Math.abs(got.gap)).toBeLessThan(1e-9);
  expect(got.sigma).toBeLessThan(1e-9);
  expect(got.floored).toBeNull();
  expect(got.quiet).toBeNull();
});
