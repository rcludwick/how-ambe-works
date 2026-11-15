// Shared pieces for the figure tests.

import { expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * One file per figure in tests/figures/registry/ (plan decision 2), so a
 * figure's task edits only its own file.
 * @typedef {Object} RegistryEntry
 * @property {string} slug
 * @property {string} page  the chapter its tests use ("" is the index)
 * @property {string} [host]  selector of the host the shared specs test, where
 *           a page carries more than one (probe: only #fig-2-2 has 3D);
 *           default [data-anim="<slug>"], first match
 * @property {"2d"} [opens]  its first step is a flat graph, so it opens in
 *           2D and the shared specs press its 3D control to reach 3D
 * @property {string[]} alsoOn  other pages that carry its host
 * @property {"live" | "stub"} status  stubs are skipped by every shared spec
 * @property {boolean} screens  screens.spec.js takes its pixel baselines
 * @property {string | null} control  selector of its 3D control, under .anim-controls
 * @property {string | null} poster  site path of its JS-off poster
 * @property {boolean} monolith  its 3D code sits in anim-<slug>.js
 * @property {boolean} headOn  Front only (bits, fec-protection)
 * @property {string[]} presets
 * @property {string | null} animation  the sentence its first-view animation shows
 * @property {"2d" | "3d"} [opens]  the view step 1 asks for (default "3d"):
 *           "2d" when step 1 is a flat plot, so the figure opens flat and
 *           plays its first-view animation when the reader presses 3D
 * @property {string | null} highlight  the subject its highlight marks
 * @property {boolean} zoom  its 3D view has the Zoom group
 *           (createOrbit({zoom: true})); its own task sets it, and the
 *           registry cases in three.spec.js and a11y.spec.js then require it
 * @property {number} allowance  gzip bytes its 3D part may take (tools/verify-site.py)
 * @property {string[]} rebaseline  its own baselines it may change ("frame-reduced")
 * @property {string | null} rebaselineReason
 */

const REGISTRY_DIR = new URL("./registry/", import.meta.url);

/** @type {RegistryEntry[]} every registry file, stubs included, by slug */
export const REGISTRY_ALL = readdirSync(REGISTRY_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(new URL(name, REGISTRY_DIR), "utf8")));

/** @type {RegistryEntry[]} the live figures, in page order */
export const REGISTRY = REGISTRY_ALL.filter((r) => r.status === "live")
  .sort((a, b) => a.page.localeCompare(b.page) || a.slug.localeCompare(b.slug));

/**
 * The figures screens.spec.js takes pixel baselines of. harmonics also sits
 * on the index page; ch07 is the one tested here.
 * @type {{page: string, slug: string}[]}
 */
export const FIGURES = REGISTRY.filter((r) => r.screens).map(({ page, slug }) => ({ page, slug }));

/** Every page with a live figure, and the index. */
export const FIGURE_PAGES = [...new Set(["", ...REGISTRY.flatMap((r) => [r.page, ...r.alsoOn])])];

/**
 * The selector of the host the shared specs test for a figure: its
 * registry's `host`, or its first [data-anim] host.
 * @param {string} slug
 */
export const hostOf = (slug) => REGISTRY_ALL.find((r) => r.slug === slug)?.host ?? `[data-anim="${slug}"]`;

/**
 * Bring a figure to 3D as a reader does. A figure already in 3D is left
 * alone; one whose 3D control shows gets it pressed; one that hides the
 * control on a flat step (utterance) is stepped on to its first 3D step.
 * @param {import("@playwright/test").Page} page
 * @param {string} slug
 * @param {import("@playwright/test").Locator} host
 */
export async function to3D(page, slug, host) {
  if (await host.locator("canvas.anim-figure__canvas--3d").first().isVisible()) return;
  const r = REGISTRY_ALL.find((x) => x.slug === slug);
  const toggle = host.locator(`.anim-controls ${r?.control ?? 'button[data-view="3d"]'}`).first();
  if (await toggle.isVisible()) {
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await host.locator(".anim-figure__frame").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    return;
  }
  await stepTo3D(page, host);
}

/**
 * Scroll a figure into view and wait until it has its data and has painted.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 */
export async function settle(page, host) {
  await host.scrollIntoViewIfNeeded();
  // A host taller than the screen can come to rest with its frame just out
  // of sight (the view row under a figure's controls made several do so on
  // a phone), and a 3D view draws only while its frame shows.
  await host.locator(".anim-figure__frame").first().evaluate((frame) => {
    const box = frame.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= innerHeight) frame.scrollIntoView({ block: "nearest" });
  });
  await page.waitForLoadState("networkidle");
  // Data loaded, and no 3D view still loading (lib/view-switch.js marks
  // the frame while it does). A view queued behind the context cap can
  // wait for as long as the others stay near, so that wait ends after 5 s.
  await host
    .locator(".anim-figure__frame")
    .first()
    .evaluate(
      (frame) =>
        new Promise((resolve) => {
          const begin = performance.now();
          const check = () => {
            const three = frame instanceof HTMLElement && frame.dataset.three === "loading" &&
              performance.now() - begin < 5000;
            if (frame instanceof HTMLElement && (frame.dataset.state === "loading" || three)) {
              requestAnimationFrame(check);
            } else {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
            }
          };
          check();
        })
    );
  await page.waitForLoadState("networkidle");
  // Every animation on its end state, so a shot never catches one midway.
  await page.evaluate(() => window.__ambeAnim?.finishAll());
  await page.waitForTimeout(300);
}

/**
 * Step a figure on until `done()` holds or its steps run out. A step about
 * a flat graph keeps its figure in 2D (and can hide the 3D control), so a
 * case that wants 3D steps on to the first step that asks for it.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 * @param {() => Promise<boolean>} done
 */
export async function stepOn(page, host, done) {
  const next = host.locator('[data-step="next"]').first();
  for (let i = 0; i < 10 && !(await done()); i += 1) {
    if (!(await next.isVisible()) || (await next.textContent())?.trim() !== "Next") return;
    await next.click();
    await settle(page, host);
  }
}

/**
 * Step a figure on to its first step whose view is 3D, if it is not in 3D.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 */
export const stepTo3D = (page, host) =>
  stepOn(page, host, () => host.locator("canvas.anim-figure__canvas--3d").first().isVisible());

/**
 * A figure whose first step asks for 2D (data-view="2d") opens in 2D; the
 * reader opens 3D with its control. Press it there, then settle. A figure
 * without such a step opens 3D by itself and is left alone.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} host
 */
export async function open3DPast2DStep(page, host) {
  const first = host.locator(".anim-steps > li").first();
  if (!(await first.count()) || (await first.getAttribute("data-view")) !== "2d") return;
  if (await host.locator("canvas.anim-figure__canvas--3d").count()) return;
  const toggle = host.locator('.anim-controls button[data-view="3d"]').first();
  await expect(toggle).toBeEnabled({ timeout: 15_000 });
  await toggle.click();
  await host.locator("canvas.anim-figure__canvas--3d").first().waitFor({ timeout: 15_000 });
  await settle(page, host);
}

/**
 * Put every stepped figure on the page into free play, where a figure shows
 * all its controls (anim.css hides some rows while steps are on).
 * @param {import("@playwright/test").Page} page
 */
export async function freePlayAll(page) {
  for (const figure of await page.locator(".anim-figure:has(.anim-steps)").all()) {
    const next = figure.locator('[data-step="next"]').first();
    await next.press("End");
    await expect(next).toHaveText("Free play");
    await next.click();
    await expect(figure).toHaveAttribute("data-steps", "free");
  }
}

/** The fixture's pages: built, out of the nav, with no figure (plan decision 1). */
export const ORPHANS = ["14-how-to-measure/", "15-exact-reproduction/"];

/**
 * Let instant navigation reach 14 and 15. The theme navigates in place only
 * to the URLs in sitemap.xml, which leaves out pages that are not in the
 * nav, so the test's copy of the sitemap lists them. Call before goto().
 * @param {import("@playwright/test").Page} page
 */
export async function routeOrphans(page) {
  await page.route("**/sitemap.xml", async (route) => {
    const response = await route.fetch();
    const xml = await response.text();
    const root = /<loc>([^<]*)<\/loc>/.exec(xml)?.[1] ?? "";
    const extra = ORPHANS.map((path) => `<url><loc>${root}${path}</loc></url>`).join("");
    await route.fulfill({ response, body: xml.replace("</urlset>", `${extra}</urlset>`) });
  });
}

/**
 * Instant navigation to `path` (relative to the site root), through a link
 * added to the page: 14 and 15, the fixture's pages, are out of the nav
 * (and need routeOrphans()). Waits until the new page's h1 has replaced
 * the old one.
 * @param {import("@playwright/test").Page} page
 * @param {string} path e.g. "15-exact-reproduction/"
 */
export async function visit(page, path) {
  const before = await page.locator("article h1").first().getAttribute("id");
  await page.evaluate((target) => {
    const script = document.querySelector('script[src*="javascripts/anim.js"]');
    if (!(script instanceof HTMLScriptElement)) throw new Error("no anim.js script tag");
    const link = document.createElement("a");
    link.href = new URL(`../${target}`, script.src).href;
    link.textContent = "test link";
    document.querySelector("article")?.append(link);
    link.click();
  }, path);
  await page.waitForURL(new RegExp(`${path.replace(/[/.]/g, "\\$&")}$`));
  await page.waitForFunction((id) => {
    const h1 = document.querySelector("article h1");
    return h1 !== null && h1.id !== id;
  }, before);
}

/**
 * Give the page `window.__loadCore()`, which imports the same anim-core.js
 * module instance the page runs (resolved from the anim.js script tag), so a
 * test can call its exports.
 * @param {import("@playwright/test").Page} page
 */
export async function installCoreLoader(page) {
  await page.addInitScript(() => {
    // @ts-ignore test-only global
    window.__loadCore = () => {
      const script = document.querySelector('script[src*="javascripts/anim.js"]');
      if (!(script instanceof HTMLScriptElement)) throw new Error("no anim.js script tag");
      return import(new URL("anim-core.js", script.src).href);
    };
  });
}

/**
 * Count observers and visibilitychange listeners created by the figure
 * scripts (anything whose creating stack mentions /javascripts/anim), live
 * until disconnected, removed, or (a listener added with a signal) aborted. Exposed as window.__obs = {live, visibility}.
 * @param {import("@playwright/test").Page} page
 */
export async function countAnimObservers(page) {
  await page.addInitScript(() => {
    const counter = { live: 0, visibility: 0 };
    // @ts-ignore test-only global
    window.__obs = counter;
    const ours = () => /\/javascripts\/anim/.test(new Error().stack || "");
    for (const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"]) {
      // @ts-ignore indexing window by name
      const Native = window[name];
      // @ts-ignore replacing a DOM constructor for the test
      window[name] = class extends Native {
        /** @param {any[]} args */
        constructor(...args) {
          super(...args);
          this.__ours = ours();
          this.__live = false;
        }
        /** @param {any[]} args */
        observe(...args) {
          if (this.__ours && !this.__live) {
            this.__live = true;
            counter.live += 1;
          }
          return super.observe(...args);
        }
        disconnect() {
          if (this.__live) {
            this.__live = false;
            counter.live -= 1;
          }
          return super.disconnect();
        }
      };
    }
    const add = Document.prototype.addEventListener;
    const remove = Document.prototype.removeEventListener;
    Document.prototype.addEventListener = function (type, ...rest) {
      // A listener added with a signal is removed when the signal aborts
      // (anim-three.js removes its own that way), not by removeEventListener.
      const signal = rest[1] && typeof rest[1] === "object" ? rest[1].signal : undefined;
      if (type === "visibilitychange" && ours() && !signal?.aborted) {
        counter.visibility += 1;
        signal?.addEventListener("abort", () => (counter.visibility -= 1), { once: true });
      }
      // @ts-ignore forwarding the original arguments
      return add.call(this, type, ...rest);
    };
    Document.prototype.removeEventListener = function (type, ...rest) {
      if (type === "visibilitychange" && ours()) counter.visibility -= 1;
      // @ts-ignore forwarding the original arguments
      return remove.call(this, type, ...rest);
    };
  });
}

/**
 * A promise and the function that resolves it, for holding a route.
 * @returns {{wait: Promise<void>, release: () => void}}
 */
export function gate() {
  /** @type {() => void} */
  let release = () => {};
  const wait = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { wait, release };
}

/**
 * The frame index printed in a transport readout ("frame 98 · 1.96 s").
 * @param {import("@playwright/test").Locator} readout
 * @returns {Promise<number>}
 */
export async function frameOf(readout) {
  const text = (await readout.textContent()) || "";
  const match = /frame (\d+)/.exec(text);
  if (!match) throw new Error(`no frame number in "${text}"`);
  return Number(match[1]);
}

/** The fixture module on disk; served at javascripts/anim-fixture.js. */
export const FIXTURE_JS = fileURLToPath(
  new URL("./fixtures/javascripts/anim-fixture.js", import.meta.url)
);

/** The fixture's 3D part (data-view="auto"); served at javascripts/anim-fixture-3d.js. */
export const FIXTURE_3D_JS = fileURLToPath(
  new URL("./fixtures/javascripts/anim-fixture-3d.js", import.meta.url)
);

const REGISTER_FIXTURE = `
import { mountLazy as mountFixture } from "./anim-core.js";
mountFixture("fixture", () => import("./anim-fixture.js"));
`;

/**
 * The fixture host, in the markup a chapter renders to (Task 1): a static
 * fallback, then three steps whose first carries a footnote reference.
 * @param {{view?: "2d" | "3d" | "auto", index?: number, headOn?: boolean, enhanced?: boolean}} [options]
 *        enhanced: false leaves the host unmarked, as the figures written
 *        before the fallback markup were (fallback.spec.js)
 */
export function fixtureHost({ view = "2d", index = 0, headOn = false, enhanced = true } = {}) {
  return `
<div data-anim="fixture" data-view="${view}" data-fixture-index="${index}"${headOn ? " data-head-on" : ""}${enhanced ? "" : ' data-enhanced="false"'}>
<figure class="anim-fallback">
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="1280" height="720" alt="A static picture of the fixture figure.">
<figcaption>Fixture caption, the same text as the live one.</figcaption>
</figure>
<ol class="anim-steps">
<li data-n="1" data-view="2d" data-junk="dropped"><p>First step, with a source.<sup id="fnref:fx"><a class="footnote-ref" href="#fn:fx">1</a></sup></p></li>
<li data-n="2" data-view="2d"><p>Second step.</p></li>
<li data-n="3" data-view="3d"><p>Third step, in three dimensions.</p></li>
</ol>
</div>`;
}

const FIXTURE_FOOTNOTE = `<div class="footnote"><ol><li id="fn:fx"><p>Fixture source.</p></li></ol></div>`;

/**
 * Serve the fixture figure: register it in anim.js, serve its module, and
 * inject its host into each listed chapter (on a full load and on instant
 * navigation, which fetches the same URL). `count` hosts go in, `gap` CSS
 * px of empty space apart; window.__fixtures[i] is host i's probe.
 * `lead` CSS px of empty space go before the first. headOn marks every
 * host data-head-on.
 * @param {import("@playwright/test").Page} page
 * @param {{chapters: string[], view?: "2d" | "3d" | "auto", at?: "top" | "end", count?: number, gap?: number,
 *          lead?: number, headOn?: boolean, enhanced?: boolean}} options
 */
export async function useFixture(page, { chapters, view = "2d", at = "top", count = 1, gap = 0, lead = 0, headOn = false, enhanced = true }) {
  await routeOrphans(page);
  await page.route("**/javascripts/anim.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + REGISTER_FIXTURE });
  });
  await page.route("**/javascripts/anim-fixture.js", (route) =>
    route.fulfill({ path: FIXTURE_JS, contentType: "text/javascript" })
  );
  await page.route("**/javascripts/anim-fixture-3d.js", (route) =>
    route.fulfill({ path: FIXTURE_3D_JS, contentType: "text/javascript" })
  );
  for (const chapter of chapters) {
    await page.route(new RegExp(`/${chapter}(\\?[^/]*)?$`), async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      const spacer = gap ? `<div class="fixture-gap" style="height: ${gap}px"></div>` : "";
      const before = lead ? `<div class="fixture-gap" style="height: ${lead}px"></div>` : "";
      const host = before + Array.from({ length: count }, (_, index) => fixtureHost({ view, index, headOn, enhanced })).join(spacer);
      html = at === "top"
        ? html.replace("</h1>", `</h1>${host}`)
        : html.replace("</article>", `${host}</article>`);
      html = html.replace("</article>", `${FIXTURE_FOOTNOTE}</article>`);
      await route.fulfill({ response, body: html });
    });
  }
}

/**
 * The runtime's test hook.
 * @param {import("@playwright/test").Page} page
 */
export async function hook(page) {
  const value = await page.evaluate(() => window.__ambeAnim);
  if (!value) throw new Error("no window.__ambeAnim; is the page on localhost?");
  return value;
}

/**
 * Put a host on a whole CSS pixel (as screens.spec.js does), so a pixel
 * shot of it does not depend on the fractional offset the page above gives
 * it, which changes with the figures above opening their 3D views.
 * @param {import("@playwright/test").Locator} host
 */
export async function snapToPixel(host) {
  await host.evaluate((el) => {
    if (!(el instanceof HTMLElement)) return;
    el.style.position = "relative";
    el.style.top = "0px";
    el.style.left = "0px";
    const box = el.getBoundingClientRect();
    const y = box.top + window.scrollY;
    const x = box.left + window.scrollX;
    el.style.top = `${Math.floor(y) - y}px`;
    el.style.left = `${Math.floor(x) - x}px`;
  });
}
