// anim-core.js exports, exercised in a real page through the module
// instance the page itself runs.
import { test, expect } from "@playwright/test";
import { gate, installCoreLoader } from "./helpers.js";

/**
 * Instant navigation to ch01, waiting until the new content is in and the
 * mount sweeps have run. The URL changes before the content is swapped, so
 * waiting for the URL alone races the sweep.
 * @param {import("@playwright/test").Page} page
 */
async function goToChapter01(page) {
  await page.locator('a.md-nav__link[href$="01-why-sinusoids/"]').first().click();
  await page.waitForURL(/01-why-sinusoids\/$/);
  await page.waitForFunction(() => !document.querySelector("[data-test-mount]"));
  await page.locator('[data-anim="utterance"] canvas').waitFor();
}

test.describe("mount", () => {
  test.beforeEach(async ({ page }) => {
    await installCoreLoader(page);
    await page.goto("02-fourier-and-the-dft/");
  });

  test("aborts the signal and runs the cleanup when the host leaves", async ({ page }) => {
    await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const host = document.createElement("div");
      host.dataset.testMount = "now";
      document.querySelector("article")?.append(host);
      core.mount('[data-test-mount="now"]', (/** @type {Element} */ _el, /** @type {{signal: AbortSignal}} */ ctx) => {
        // @ts-ignore test-only global
        window.__signal = ctx.signal;
        // @ts-ignore test-only global
        return () => { window.__cleaned = true; };
      });
    });
    // @ts-ignore test-only global
    await page.waitForFunction(() => window.__signal !== undefined);
    // @ts-ignore test-only global
    expect(await page.evaluate(() => window.__signal.aborted)).toBe(false);

    await goToChapter01(page);
    // @ts-ignore test-only global
    await page.waitForFunction(() => window.__cleaned === true);
    // @ts-ignore test-only global
    expect(await page.evaluate(() => window.__signal.aborted)).toBe(true);
  });

  test("a cleanup that arrives after the host left runs at once", async ({ page }) => {
    await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const host = document.createElement("div");
      host.dataset.testMount = "late";
      document.querySelector("article")?.append(host);
      core.mount('[data-test-mount="late"]', () =>
        new Promise((resolve) => {
          // @ts-ignore test-only global
          window.__finish = () => resolve(() => { window.__lateCleaned = true; });
        })
      );
    });
    // @ts-ignore test-only global
    await page.waitForFunction(() => typeof window.__finish === "function");
    await goToChapter01(page);
    // @ts-ignore test-only global
    await page.evaluate(() => window.__finish());
    // @ts-ignore test-only global
    await page.waitForFunction(() => window.__lateCleaned === true);
  });

  test("an init that fails because its signal aborted is not reported", async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const host = document.createElement("div");
      host.dataset.testMount = "aborted";
      host.innerHTML = '<div class="anim-figure__frame" data-state="loading"></div>';
      // @ts-ignore test-only global
      window.__frame = host.firstElementChild;
      document.querySelector("article")?.append(host);
      core.mount('[data-test-mount="aborted"]', (/** @type {Element} */ _el, /** @type {{signal: AbortSignal}} */ ctx) =>
        new Promise((_resolve, reject) => {
          // @ts-ignore test-only global
          window.__mountSignal = ctx.signal;
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
        })
      );
    });
    // @ts-ignore test-only global
    await page.waitForFunction(() => window.__mountSignal !== undefined);
    await goToChapter01(page);
    // @ts-ignore test-only global
    await page.waitForFunction(() => window.__mountSignal.aborted);
    await page.waitForTimeout(100);
    // @ts-ignore test-only global
    expect(await page.evaluate(() => window.__frame.dataset.state)).toBe("loading");
    expect(errors.filter((text) => text.includes("failed to mount"))).toEqual([]);
  });
});

test.describe("helpers", () => {
  test.beforeEach(async ({ page }) => {
    await installCoreLoader(page);
    await page.goto("02-fourier-and-the-dft/");
  });

  test("$ returns a typed element and throws on a miss or a wrong type", async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const root = document.createElement("div");
      root.innerHTML = '<input class="a"><span class="b"></span>';
      /** @param {() => unknown} fn */
      const message = (fn) => { try { fn(); return "no error"; } catch (e) { return String(e); } };
      return {
        found: core.$(root, ".a", HTMLInputElement).tagName,
        miss: message(() => core.$(root, ".c", HTMLInputElement)),
        wrong: message(() => core.$(root, ".b", HTMLInputElement)),
      };
    });
    expect(result.found).toBe("INPUT");
    expect(result.miss).toContain('".c" matched nothing');
    expect(result.wrong).toContain('".b" has the wrong element type');
  });

  test("tokenColor reads slate tokens and the colour forms extra.css uses", async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const el = document.createElement("div");
      document.body.append(el);
      /** @param {string} value */
      const read = (value) => {
        el.style.setProperty("--t", value);
        try { return core.tokenColor("--t", el); } catch (e) { return String(e); }
      };
      return {
        teal: core.tokenColor("--ambe-accent-cool"),
        grid: core.tokenColor("--ambe-plot-grid"),
        short: read("#abc"),
        shortAlpha: read("#abc8"),
        long: read("#11223380"),
        spaced: read("rgb(1 2 3 / 50%)"),
        named: read("red"),
        mixed: read("color-mix(in srgb, red, blue)"),
      };
    });
    expect(result.teal).toEqual({ hex: 0x3ddbc0, opacity: 1 });
    expect(result.grid).toEqual({ hex: 0xffffff, opacity: 0.07 });
    expect(result.short).toEqual({ hex: 0xaabbcc, opacity: 1 });
    expect(result.shortAlpha.hex).toBe(0xaabbcc);
    expect(result.shortAlpha.opacity).toBeCloseTo(0x88 / 255, 6);
    expect(result.long.hex).toBe(0x112233);
    expect(result.long.opacity).toBeCloseTo(0x80 / 255, 6);
    expect(result.spaced).toEqual({ hex: 0x010203, opacity: 0.5 });
    // Review Focus 4: an unknown form fails loudly and names the token.
    expect(result.named).toContain("cannot read --t as a colour");
    expect(result.mixed).toContain("cannot read --t as a colour");
  });

  test("markEnhanced adds is-enhanced", async ({ page }) => {
    const classes = await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const host = document.createElement("div");
      core.markEnhanced(host);
      return host.className;
    });
    expect(classes).toBe("is-enhanced");
  });

  // fixme: under Emulation.setDeviceMetricsOverride Chromium 153 (headless
  // shell and new headless) flips the resolution query's `matches` but never
  // dispatches its change event. Checked by hand before merge instead: open
  // ch01, move the window to a display with another pixel ratio, and the
  // figures redraw sharp.
  test.fixme("watchPixelRatio fires on each ratio change and stops when asked", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    /** @param {number} ratio */
    const setRatio = (ratio) =>
      cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1280, height: 900, deviceScaleFactor: ratio, mobile: false,
      });
    await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      // @ts-ignore test-only global
      window.__hits = 0;
      // @ts-ignore test-only global
      window.__stop = core.watchPixelRatio(() => { window.__hits += 1; });
    });
    await setRatio(2);
    // @ts-ignore test-only global
    await expect.poll(() => page.evaluate(() => window.__hits)).toBe(1);
    await setRatio(3); // re-armed for the new ratio
    // @ts-ignore test-only global
    await expect.poll(() => page.evaluate(() => window.__hits)).toBe(2);
    // @ts-ignore test-only global
    await page.evaluate(() => window.__stop());
    await setRatio(1);
    await page.waitForTimeout(300);
    // @ts-ignore test-only global
    expect(await page.evaluate(() => window.__hits)).toBe(2);
  });

  test("loadPCM decodes the input WAV at 8 kHz, sample for sample", async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const pcm = await core.loadPCM("assets/audio/lr-b-original.wav");
      return { length: pcm.length, at4000: pcm[4000] };
    });
    // lr-b-original.wav: 8000 Hz, 16-bit mono, 25384 frames; sample 4000 is -7783.
    expect(result.length).toBe(25384);
    expect(result.at4000).toBeCloseTo(-7783 / 32768, 6);
  });

  test("loadPCM does not cache a failure", async ({ page }) => {
    // Review Focus 5.
    let first = true;
    await page.route("**/assets/audio/lr-c-original.wav", async (route) => {
      if (first) {
        first = false;
        await route.fulfill({ status: 404, body: "" });
      } else {
        await route.continue();
      }
    });
    const result = await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      let firstError = "";
      try { await core.loadPCM("assets/audio/lr-c-original.wav"); } catch (e) { firstError = String(e); }
      const pcm = await core.loadPCM("assets/audio/lr-c-original.wav");
      return { firstError, length: pcm.length };
    });
    expect(result.firstError).toContain("404");
    expect(result.length).toBeGreaterThan(0);
  });

  test("aborting one caller's loadJSON leaves the shared request to the others", async ({ page }) => {
    // Review finding: the first caller's signal used to abort the cached fetch.
    const held = gate();
    await page.route("**/assets/data/lr-b/frames.json", async (route) => {
      await held.wait;
      await route.continue();
    });
    await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      core.clearDataCache("assets/data/lr-b/frames.json");
      const controller = new AbortController();
      // @ts-ignore test-only global
      window.__first = core.loadJSON("assets/data/lr-b/frames.json", { signal: controller.signal })
        .then(() => "resolved", (/** @type {Error} */ e) => e.name);
      controller.abort();
      // @ts-ignore test-only global
      window.__second = core.loadJSON("assets/data/lr-b/frames.json")
        .then((/** @type {unknown} */ doc) => typeof doc, (/** @type {Error} */ e) => String(e));
    });
    // @ts-ignore test-only global
    expect(await page.evaluate(() => window.__first)).toBe("AbortError");
    held.release();
    // @ts-ignore test-only global
    expect(await page.evaluate(() => window.__second)).toBe("object");
  });

  test("watchPixelRatio stays stopped when stopped from its own callback, and re-arms after a throw", async ({ page }) => {
    // Review finding. The real change event does not fire under emulation
    // (see the fixme above), so this drives a stand-in MediaQueryList.
    const result = await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const native = window.matchMedia;
      /** @type {Set<EventListener>} */
      const listeners = new Set();
      // @ts-ignore stand-in for the test
      window.matchMedia = () => ({
        addEventListener: (/** @type {string} */ _t, /** @type {EventListener} */ fn) => listeners.add(fn),
        removeEventListener: (/** @type {string} */ _t, /** @type {EventListener} */ fn) => listeners.delete(fn),
      });
      const change = () => {
        for (const fn of [...listeners]) {
          try { fn(new Event("change")); } catch (error) { /* reported, not fatal */ }
        }
      };
      try {
        /** @type {() => void} */
        let stop = () => {};
        stop = core.watchPixelRatio(() => stop());
        change();
        const afterStop = listeners.size;

        let hits = 0;
        const stopThrowing = core.watchPixelRatio(() => {
          hits += 1;
          throw new Error("callback failed");
        });
        change();
        change();
        const afterThrow = listeners.size;
        stopThrowing();
        return { afterStop, hits, afterThrow, end: listeners.size };
      } finally {
        window.matchMedia = native;
      }
    });
    expect(result).toEqual({ afterStop: 0, hits: 2, afterThrow: 1, end: 0 });
  });
});

test.describe("opensIn3D", () => {
  for (const motion of /** @type {const} */ (["no-preference", "reduce"])) {
    for (const query of ["", "?nowebgl"]) {
      test(`motion ${motion}, ${query || "no query"}: ${motion === "no-preference" && !query ? "3D" : "2D"}`, async ({ page }) => {
        await installCoreLoader(page);
        await page.emulateMedia({ reducedMotion: motion });
        await page.goto(`14-how-to-measure/${query}`);
        const result = await page.evaluate(async () => {
          // @ts-ignore test-only global
          const core = await window.__loadCore();
          return { opens: core.opensIn3D(), probes: window.__ambeAnim?.webglProbes, hint: core.NO_WEBGL_HINT };
        });
        expect(result.opens).toBe(motion === "no-preference" && !query);
        expect(result.hint).toBe("3D needs WebGL 2");
        // Reduced motion or ?nowebgl answers without probing for WebGL.
        expect(result.probes).toBe(motion === "no-preference" && !query ? 1 : 0);
      });
    }
  }

  test("reads the motion preference live", async ({ page }) => {
    await installCoreLoader(page);
    await page.goto("14-how-to-measure/");
    // @ts-ignore test-only global
    const ask = () => page.evaluate(async () => (await window.__loadCore()).opensIn3D());
    expect(await ask()).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await ask()).toBe(false);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await ask()).toBe(true);
  });

  test("anim-three.js re-exports the probe and the hint from anim-core.js", async ({ page }) => {
    await installCoreLoader(page);
    await page.goto("14-how-to-measure/");
    const same = await page.evaluate(async () => {
      // @ts-ignore test-only global
      const core = await window.__loadCore();
      const script = /** @type {HTMLScriptElement} */ (document.querySelector('script[src*="javascripts/anim.js"]'));
      const three = await import(new URL("anim-three.js", script.src).href);
      return three.supportsWebGL2 === core.supportsWebGL2 && three.NO_WEBGL_HINT === core.NO_WEBGL_HINT;
    });
    expect(same).toBe(true);
  });
});

test("the test hook starts with the cap fields and finishAll", async ({ page }) => {
  await page.goto("14-how-to-measure/");
  const fields = await page.evaluate(() => {
    const h = window.__ambeAnim;
    return h && { parks: h.parks, unparks: h.unparks, waits: h.waits, played: h.played, finishAll: typeof h.finishAll };
  });
  expect(fields).toEqual({ parks: 0, unparks: 0, waits: 0, played: {}, finishAll: "function" });
});
