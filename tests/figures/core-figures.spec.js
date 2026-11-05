// Core helpers the new figures share: hexBits() and the segment player.
// They run on 14-how-to-measure, a page with no figure: on a chapter page a
// 3D figure's opening animation shares the main thread with the player and
// can start it late.
import { test, expect } from "@playwright/test";
import { installCoreLoader } from "./helpers.js";

const PAGE = "14-how-to-measure/";

// play() without a click is refused under Chromium's default policy.
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

test("hexBits: 72 single bits, MSB first", async ({ page }) => {
  await installCoreLoader(page);
  await page.goto(PAGE);
  const bits = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const core = await window.__loadCore();
    return Array.from(core.hexBits("995fd547ec5db6e5fa"));
  });
  expect(bits.length).toBe(72);
  expect(bits.slice(0, 8)).toEqual([1, 0, 0, 1, 1, 0, 0, 1]); // 0x99
  expect(bits.slice(64, 72)).toEqual([1, 1, 1, 1, 1, 0, 1, 0]); // 0xfa
  expect(bits.every((b) => b === 0 || b === 1)).toBe(true);
});

test("segment player starts at from and stops at until", async ({ page }) => {
  await installCoreLoader(page);
  await page.goto(PAGE);
  const { start, last, stoppedBy } = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const core = await window.__loadCore();
    const button = document.createElement("button");
    document.body.append(button);
    /** @type {(number | null)[]} */
    const seen = [];
    const player = core.createAudioPlayer({
      src: "assets/audio/lr-b-ambe.wav", button, from: 1.0, until: 1.3,
      onFrame: (/** @type {number | null} */ t) => seen.push(t),
    });
    player.toggle();
    // 0.3 s of audio after the fetch and decode; on a busy machine the start
    // can come late, so wait up to 3 s for the player to report the stop.
    const begin = performance.now();
    while (performance.now() - begin < 3000) {
      await new Promise((r) => setTimeout(r, 50));
      if (seen.some((t) => t !== null) && seen[seen.length - 1] === null) break;
    }
    const times = /** @type {number[]} */ (seen.filter((t) => t !== null));
    return { start: times[0] ?? -1, last: Math.max(...times), stoppedBy: seen[seen.length - 1] };
  });
  expect(start).toBeGreaterThanOrEqual(1.0);
  expect(start).toBeLessThan(1.1);
  expect(last).toBeLessThan(1.4);
  expect(stoppedBy).toBeNull();
});

test("TEST_HOOK carries a figures table", async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => typeof window.__ambeAnim?.figures)).toBe("object");
});

test("segment player destroyed while its fetch runs makes no object URL", async ({ page }) => {
  await installCoreLoader(page);
  await page.goto(PAGE);
  const made = await page.evaluate(async () => {
    // @ts-ignore test-only global
    const core = await window.__loadCore();
    let count = 0;
    const native = URL.createObjectURL;
    URL.createObjectURL = (/** @type {Blob} */ blob) => {
      count += 1;
      return native.call(URL, blob);
    };
    const button = document.createElement("button");
    document.body.append(button);
    const player = core.createAudioPlayer({
      src: "assets/audio/lr-b-ambe.wav", button, from: 1.0, until: 1.3, onFrame: () => {},
    });
    player.toggle();
    player.destroy();
    await new Promise((r) => setTimeout(r, 1500));
    URL.createObjectURL = native;
    return count;
  });
  expect(made).toBe(0);
});
