// @ts-check
/* ===========================================================================
 * anim-core.js: shared runtime for the interactive figures on this site.
 * ---------------------------------------------------------------------------
 * SCOPE (deliberate, and enforced by review): this module draws pictures.
 * It sets up canvases, runs a frame loop, reads theme tokens, loads
 * precomputed JSON, and provides generic plotting primitives (axes, grids,
 * labels, polylines).
 *
 * Figure modules contain no AMBE codec logic: no AMBE pitch estimator, no
 * voicing decision rule, no quantiser tables or bit allocation, no frame
 * decoder, and nothing that turns a sequence of frames into audio. Generic,
 * display-only DSP on synthetic data or on one frame's precomputed values
 * is allowed: summing cosines for a picture, comparing a precomputed value
 * with a slider, training a codebook on synthetic dots. Everything
 * AMBE-specific arrives as data, precomputed from the input audio and from
 * real hardware, in docs/assets/data/*.json. hexBits() hands out single bits
 * for drawing and joins none. tools/check-scope.py enforces part of this.
 *
 * This is an ES module. zensical.toml loads one script, javascripts/anim.js,
 * which imports this file and then every figure module; register a new
 * figure there, not in zensical.toml.
 *
 * Animation modules import from it by relative path:
 *
 *     import { mount, setupCanvas, createPlot, loadJSON } from "./anim-core.js";
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/* ---------------------------------------------------------------------------
 * Site paths
 * ------------------------------------------------------------------------ */

/**
 * Absolute URL of the site root, derived from this module's own location
 * (`<root>/javascripts/anim-core.js`). Safe under `navigation.instant`, where
 * the document URL changes without a page load, and safe on GitHub Pages
 * project sites served from a subdirectory.
 * @type {string}
 */
export const SITE_ROOT = new URL("../", import.meta.url).href;

/**
 * Resolve a site-root-relative path to an absolute URL.
 * @param {string} path e.g. "assets/data/pitch-track.json"
 * @returns {string} absolute URL
 */
export function assetURL(path) {
  return new URL(String(path).replace(/^\/+/, ""), SITE_ROOT).href;
}

/* ---------------------------------------------------------------------------
 * DOM helpers
 * ------------------------------------------------------------------------ */

/**
 * Find one element under `root` and prove its type, so checked figure code
 * gets an HTMLInputElement (say) rather than a bare Element.
 *
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {{ new (): T }} type e.g. HTMLInputElement
 * @returns {T}
 * @throws {Error} if nothing matches or the match is another element type
 */
export function $(root, selector, type) {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`anim-core: "${selector}" matched nothing`);
  if (!(found instanceof type)) {
    throw new Error(`anim-core: "${selector}" has the wrong element type`);
  }
  return found;
}

/**
 * Under the figure, one short caption from the host's data-caption. The
 * figure's own caption (its live readouts, badges and sources) moves into a
 * closed "More about this figure" section right below, so every source
 * stays on the page. It moves as the same element, because several figures
 * hold a reference to it from before this runs and keep writing to it.
 * Safe to call twice.
 * @param {HTMLElement} cap
 * @param {string} text
 */
function shortCaption(cap, text) {
  const figure = cap.closest(".anim-figure");
  if (!(figure instanceof HTMLElement)) return;
  let summary = figure.querySelector(":scope > .anim-figure__summary");
  if (!summary) {
    const more = document.createElement("details");
    more.className = "anim-figure__more";
    const label = document.createElement("summary");
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    label.append("More about this figure", arrow);
    cap.before(more);
    more.append(label, cap);
    summary = document.createElement("p");
    summary.className = "anim-figure__summary";
    more.before(summary);
  }
  summary.textContent = text;
}

// Print the sources: open every "More about this figure" for the printout,
// then close the ones that were closed.
if (typeof window !== "undefined") {
  /** @type {HTMLDetailsElement[]} */
  let opened = [];
  window.addEventListener("beforeprint", () => {
    opened = Array.from(document.querySelectorAll("details.anim-figure__more:not([open])"))
      .filter((d) => d instanceof HTMLDetailsElement);
    for (const d of opened) d.open = true;
  });
  window.addEventListener("afterprint", () => {
    for (const d of opened) d.open = false;
    opened = [];
  });
}

/**
 * Mark a figure host as enhanced: its live figure is in place, so styles
 * may hide the no-JS fallback it carries.
 * @param {Element} host the `[data-anim]` element
 * @returns {void}
 */
export function markEnhanced(host) {
  host.classList.add("is-enhanced");
  if (typeof document !== "undefined") {
    const hosts = Array.from(document.querySelectorAll("[data-anim]"));
    const idx = hosts.indexOf(host) + 1;
    if (idx > 0) {
      const path = typeof location !== "undefined" ? location.pathname : "";
      const match = /\/(\d{2})-[^/]+\/?$/.exec(path);
      const chapter = match ? Number.parseInt(match[1], 10) : 0;
      const num = chapter > 0 ? `${chapter}.${idx}` : `${idx}`;
      const label = `Figure ${num}`;
      const customTitle = host instanceof HTMLElement ? host.dataset.title : undefined;
      const customCaption = host instanceof HTMLElement ? host.dataset.caption : undefined;
      if (host instanceof HTMLElement) {
        host.dataset.figNum = label;
        if (!host.id) host.id = `fig-${num.replace(".", "-")}`;
      }
      const applyMeta = () => {
        const title = host.querySelector(".anim-figure__title");
        if (title instanceof HTMLElement) {
          title.dataset.figNum = label;
          if (customTitle) title.textContent = customTitle;
        }
        const cap = host.querySelector(".anim-figure__caption");
        if (customCaption && cap instanceof HTMLElement) {
          if (customCaption === "none") {
            // No caption under this copy of the figure. Hidden, not removed,
            // so the figure's init still finds its badge and source slots.
            cap.hidden = true;
          } else {
            shortCaption(cap, customCaption);
          }
        }
      };
      applyMeta();
      queueMicrotask(applyMeta);
    }
  }
  const signal = mounted.get(host)?.controller.signal ?? new AbortController().signal;
  for (const enhance of enhancers) {
    try {
      enhance(host, signal);
    } catch (error) {
      console.error("anim-core: a figure enhancer failed", error);
    }
  }
}

/** @type {Set<(host: Element, signal: AbortSignal) => void>} */
const enhancers = new Set();

/**
 * Run `enhance` on every host markEnhanced() marks from now on, at once,
 * with the host's mount signal: the live figure is in the page and has not
 * painted yet. lib/view-switch.js gives each figure its view row here, so
 * the row is there from the first paint.
 * @param {(host: Element, signal: AbortSignal) => void} enhance
 * @returns {void}
 */
export function onEnhance(enhance) {
  enhancers.add(enhance);
}

/**
 * A frame's captured hex, the 18 characters exactly as recorded, for a
 * figure to print as text. Figures that draw the bits pass it to hexBits();
 * no other module reads frames[].hex (tools/check-scope.py).
 * @param {FrameRecord} frame
 * @returns {string}
 */
export function frameHex(frame) {
  return frame.hex;
}

/**
 * The 72 channel bits of one frame, one per entry, in wire order: bit 0 is
 * the most significant bit of byte 0 (docs/assets/data/SCHEMA.md). Each
 * entry is a single bit. Nothing here groups bits into values: the site
 * never reads the frame as parameters (tools/check-scope.py).
 * @param {string} hex 18 lowercase hex characters, frames[].hex
 * @returns {Uint8Array} 72 entries, each 0 or 1
 */
export function hexBits(hex) {
  const bits = new Uint8Array(72);
  for (let n = 0; n < 72; n += 1) {
    const nibble = Number.parseInt(hex[n >> 2], 16);
    bits[n] = (nibble >> (3 - (n & 3))) & 1;
  }
  return bits;
}

/* ---------------------------------------------------------------------------
 * Data loading
 * ------------------------------------------------------------------------ */

/** @type {Map<string, Promise<unknown>>} */
const dataCache = new Map();

/**
 * Hand one caller a cached load, cut short by that caller's signal. The
 * shared fetch never sees the signal: aborting it would fail every other
 * figure waiting on the same URL, and could hand the doomed promise to a
 * figure mounted in the same sweep before the cache entry was dropped.
 *
 * @template T
 * @param {Promise<T>} shared
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
function untilAborted(shared, signal) {
  if (!signal) return shared;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Fetch a precomputed JSON dataset, memoised per URL for the lifetime of the
 * page. Concurrent callers share one request; repeat visits under
 * `navigation.instant` reuse the resolved value.
 *
 * Paths are resolved with {@link assetURL}, so pass them site-root-relative
 * ("assets/data/foo.json") rather than page-relative.
 *
 * The result is `unknown` unless the caller names its shape with a JSDoc
 * cast, using a type from types/data.d.ts.
 *
 * @template [T=unknown]
 * @param {string} path site-root-relative path or absolute URL
 * @param {{signal?: AbortSignal, reload?: boolean}} [options]
 *        `reload: true` bypasses and refreshes the cache entry. Aborting
 *        `signal` rejects this call only; the request itself runs on for
 *        the cache and any other caller.
 * @returns {Promise<T>} parsed JSON
 * @throws {Error} if the response is not ok or the body is not JSON
 */
export function loadJSON(path, options = {}) {
  const url = assetURL(path);
  if (options.reload) dataCache.delete(url);

  let pending = dataCache.get(url);
  if (!pending) {
    pending = fetch(url, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`anim-core: ${response.status} loading ${url}`);
        }
        return response.json();
      })
      .catch((error) => {
        dataCache.delete(url); // never cache a failure
        throw error;
      });
    dataCache.set(url, pending);
  }
  return /** @type {Promise<T>} */ (untilAborted(pending, options.signal));
}

/**
 * Drop cached datasets.
 * @param {string} [path] one dataset; omit to clear the whole cache
 * @returns {void}
 */
export function clearDataCache(path) {
  if (path === undefined) dataCache.clear();
  else dataCache.delete(assetURL(path));
}

/** @type {Map<string, Promise<Float32Array>>} */
const pcmCache = new Map();

/**
 * Fetch a WAV and decode it to samples at 8 kHz, memoised per URL like
 * {@link loadJSON}, signal included. The site's clips are 8 kHz already, so decoding at that
 * rate resamples nothing: the samples are the file's own, scaled to -1..1.
 *
 * @param {string} path site-root-relative path or absolute URL
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<Float32Array>} the first channel
 * @throws {Error} if the response is not ok or the audio cannot be decoded
 */
export function loadPCM(path, options = {}) {
  const url = assetURL(path);
  let pending = pcmCache.get(url);
  if (!pending) {
    pending = fetch(url, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`anim-core: ${response.status} loading ${url}`);
        }
        return response.arrayBuffer();
      })
      .then((bytes) => {
        const context = new OfflineAudioContext({
          numberOfChannels: 1,
          length: 1,
          sampleRate: 8000,
        });
        return context.decodeAudioData(bytes);
      })
      .then((buffer) => buffer.getChannelData(0))
      .catch((error) => {
        pcmCache.delete(url); // never cache a failure
        throw error;
      });
    pcmCache.set(url, pending);
  }
  return untilAborted(pending, options.signal);
}

/* ---------------------------------------------------------------------------
 * Theme
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} Theme
 * @property {string} scheme       "slate" (dark) or "default" (light)
 * @property {boolean} dark        true when the dark scheme is active
 * @property {string} bg           page ground
 * @property {string} surface1     figure/card surface
 * @property {string} surface2     raised surface (controls, code)
 * @property {string} surface3     highest surface (hover, popovers)
 * @property {string} sunken       recessed surface
 * @property {string} plotBg       plot interior fill
 * @property {string} grid         grid lines
 * @property {string} axis         axis lines and ticks
 * @property {string} ink          primary drawing/text colour on a plot
 * @property {string} muted        secondary drawing/text colour on a plot
 * @property {string} text         primary UI text
 * @property {string} text2        body text
 * @property {string} text3        captions, metadata
 * @property {string} text4        hints, faint rules
 * @property {string} hairline     1px separators
 * @property {string} border       interactive-chrome borders
 * @property {string} accent       indigo accent
 * @property {string} accentWarm   amber accent
 * @property {string} accentCool   teal accent
 * @property {string[]} series     categorical data colours, in order
 * @property {string} font         sans font stack (for ctx.font)
 * @property {string} mono         monospace font stack (for ctx.font)
 * @property {(name: string, fallback?: string) => string} css
 *           read any other CSS custom property, e.g. css("--ambe-radius-md")
 */

/** Custom properties zensical applies to <body>, not <html>. */
function tokenSource() {
  return document.body || document.documentElement;
}

/** Memo for the default (<body>) theme; invalidated on any theme change. */
/** @type {Theme | null} */
let themeCache = null;

function invalidateTheme() {
  themeCache = null;
}

if (typeof document !== "undefined") {
  const watchBody = () => {
    new MutationObserver(invalidateTheme).observe(tokenSource(), {
      attributes: true,
      attributeFilter: ["data-md-color-scheme", "data-md-color-primary"],
    });
  };
  if (document.body) watchBody();
  else document.addEventListener("DOMContentLoaded", watchBody, { once: true });
  window.addEventListener("load", invalidateTheme);
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", invalidateTheme);
}

/**
 * Read the current design tokens out of CSS custom properties.
 *
 * Call this at the top of every repaint rather than caching colours in module
 * scope, so figures follow the theme when the reader switches schemes; the
 * result is memoised internally and invalidated whenever the scheme changes,
 * so calling it per frame is cheap. Pair it with {@link onThemeChange} to
 * trigger the repaint.
 *
 * @param {Element} [element] element to resolve tokens against; defaults to
 *        <body>, which is where zensical sets `data-md-color-scheme`.
 * @returns {Theme}
 */
export function getTheme(element) {
  if (!element && themeCache) return themeCache;
  const el = element || tokenSource();
  const styles = getComputedStyle(el);
  /**
   * @param {string} name
   * @param {string} [fallback]
   */
  const css = (name, fallback = "") => {
    const value = styles.getPropertyValue(name);
    return value ? value.trim() || fallback : fallback;
  };
  const scheme =
    (document.body && document.body.getAttribute("data-md-color-scheme")) ||
    "default";

  const theme = {
    scheme,
    dark: scheme === "slate",
    bg: css("--ambe-bg", "#0c0d10"),
    surface1: css("--ambe-surface-1", "#131419"),
    surface2: css("--ambe-surface-2", "#1a1c22"),
    surface3: css("--ambe-surface-3", "#23262e"),
    sunken: css("--ambe-sunken", "#08090c"),
    plotBg: css("--ambe-plot-bg", "#0f1015"),
    grid: css("--ambe-plot-grid", "rgba(255,255,255,0.07)"),
    axis: css("--ambe-plot-axis", "rgba(255,255,255,0.28)"),
    ink: css("--ambe-plot-ink", "#e9e9f0"),
    muted: css("--ambe-plot-muted", "#7c7e8a"),
    text: css("--ambe-text", "#f2f2f7"),
    text2: css("--ambe-text-2", "#c3c4cd"),
    text3: css("--ambe-text-3", "#8d8f9b"),
    text4: css("--ambe-text-4", "#5c5e6a"),
    hairline: css("--ambe-hairline", "rgba(255,255,255,0.08)"),
    border: css("--ambe-border", "rgba(255,255,255,0.14)"),
    accent: css("--ambe-accent", "#7d8cff"),
    accentWarm: css("--ambe-accent-warm", "#ffb454"),
    accentCool: css("--ambe-accent-cool", "#3ddbc0"),
    series: [
      css("--ambe-data-1", "#7d8cff"),
      css("--ambe-data-2", "#3ddbc0"),
      css("--ambe-data-3", "#ffb454"),
      css("--ambe-data-4", "#7c7e8a"),
    ],
    font: css("--ambe-font-sans", "-apple-system, system-ui, sans-serif"),
    mono: css("--ambe-font-mono", "ui-monospace, monospace"),
    css,
  };

  if (!element) themeCache = theme;
  return theme;
}

/**
 * Run a callback whenever the active theme changes, either because the
 * reader flipped zensical's palette toggle (which rewrites
 * `data-md-color-scheme` on <body>) or because the OS colour preference
 * changed.
 *
 * @param {(theme: Theme) => void} handler called with the new theme
 * @returns {() => void} unsubscribe
 */
export function onThemeChange(handler) {
  let body = tokenSource();
  const fire = () => {
    invalidateTheme();
    handler(getTheme());
  };

  const observer = new MutationObserver(fire);
  const observe = () => {
    body = tokenSource();
    observer.observe(body, {
      attributes: true,
      attributeFilter: ["data-md-color-scheme", "data-md-color-primary"],
    });
  };
  observe();

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => fire();
  media.addEventListener("change", onMedia);

  return () => {
    observer.disconnect();
    media.removeEventListener("change", onMedia);
  };
}

/**
 * @typedef {Object} TokenColor
 * @property {number} hex      0xRRGGBB, the form three.js materials take
 * @property {number} opacity  0 to 1
 */

/**
 * Read a colour token (e.g. "--ambe-accent-cool") as a number and an
 * opacity, for renderers that cannot take a CSS colour string. Accepts the
 * forms extra.css uses: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba().
 *
 * @param {string} name custom property, including the leading "--"
 * @param {Element} [element] element to resolve against; defaults to <body>
 * @returns {TokenColor}
 * @throws {Error} if the token is unset or in any other form
 */
export function tokenColor(name, element) {
  const value = getComputedStyle(element || tokenSource())
    .getPropertyValue(name)
    .trim();
  const color = parseColor(value);
  if (!color) {
    throw new Error(`anim-core: cannot read ${name} as a colour ("${value}")`);
  }
  return color;
}

/**
 * @param {string} value a CSS colour in one of the forms tokenColor accepts
 * @returns {TokenColor | null}
 */
function parseColor(value) {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = digits.replace(/./g, (d) => d + d);
    return {
      hex: parseInt(digits.slice(0, 6), 16),
      opacity: digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1,
    };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(
      value
    );
  if (rgb) {
    /** @param {string} s */
    const channel = (s) => Math.max(0, Math.min(255, Math.round(Number(s))));
    const alpha = rgb[4];
    const opacity =
      alpha === undefined
        ? 1
        : alpha.endsWith("%")
        ? Number(alpha.slice(0, -1)) / 100
        : Number(alpha);
    return {
      // Arithmetic, not shifts: the scope check (design §3.10) reads shifts
      // as bit packing.
      hex: channel(rgb[1]) * 65536 + channel(rgb[2]) * 256 + channel(rgb[3]),
      opacity: Math.max(0, Math.min(1, opacity)),
    };
  }
  return null;
}

/** @type {MediaQueryList | null} */
let reducedQuery = null;

/**
 * True when the reader has asked for reduced motion. Figures must then hold
 * on a static representative frame instead of animating; {@link createLoop}
 * and {@link createTransport} already do this for you.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  // One MediaQueryList for every call; its `matches` follows the setting.
  reducedQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return reducedQuery.matches;
}

/* ---------------------------------------------------------------------------
 * WebGL 2 and the opening view
 * ------------------------------------------------------------------------ */

/**
 * The hint a figure shows beside a disabled 3D control. Here rather than in
 * anim-three.js, so a 2D module can disable its control from the start
 * without loading the 3D runtime.
 */
export const NO_WEBGL_HINT = "3D needs WebGL 2";

/**
 * How near the viewport a figure must come before its 3D view loads and
 * asks for a context, and within which a live view is never parked: one
 * viewport height above and below. Here so a 2D module can wait for it
 * without loading anim-three.js.
 */
export const KEEP_MARGIN = "100% 0px";

/** @type {boolean | null} */
let webgl2 = null;

/**
 * Whether this browser can give a figure a WebGL 2 context without a major
 * performance caveat. Probed once per session (instant navigation keeps
 * this module); the probe's context is released at once. ?nowebgl forces
 * a failure for tests.
 * @returns {boolean}
 */
export function supportsWebGL2() {
  if (webgl2 !== null) return webgl2;
  if (TEST_HOOK) TEST_HOOK.webglProbes += 1;
  webgl2 = false;
  if (new URLSearchParams(location.search).has("nowebgl")) return webgl2;
  try {
    const gl = document
      .createElement("canvas")
      .getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (gl) {
      webgl2 = true;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch (error) {
    webgl2 = false;
  }
  return webgl2;
}

/**
 * The opening rule (owner decision O1): a figure with a 3D view opens in it,
 * and plays its explanatory animation once, only when WebGL 2 works, the
 * reader does not prefer reduced motion, and the URL has no ?nowebgl.
 * Otherwise it opens in 2D, which shows the animation's end state. The
 * media query is read on every call, so a change made before the figure is
 * first seen is honoured. Asked in this order, so a page under reduced
 * motion or ?nowebgl never probes for WebGL.
 * @returns {boolean}
 */
export function opensIn3D() {
  if (prefersReducedMotion()) return false;
  if (new URLSearchParams(location.search).has("nowebgl")) return false;
  return supportsWebGL2();
}

/* ---------------------------------------------------------------------------
 * Canvas
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} CanvasHandle
 * @property {HTMLCanvasElement} canvas
 * @property {CanvasRenderingContext2D} ctx  transformed so that 1 unit =
 *           1 CSS pixel; do not apply your own DPR scaling
 * @property {number} width   drawing width in CSS pixels
 * @property {number} height  drawing height in CSS pixels
 * @property {number} dpr     device pixel ratio currently in use
 * @property {() => boolean} sync  re-measure now; true if the size changed
 * @property {() => void} destroy  stop observing and release listeners
 */

/**
 * Call `onChange` whenever the device pixel ratio changes (window dragged to
 * another display, browser zoom). ResizeObserver does not fire for these,
 * and a `resolution` media query matches one ratio only, so it is re-armed
 * for the new ratio after every change.
 *
 * @param {() => void} onChange
 * @returns {() => void} stop watching
 */
export function watchPixelRatio(onChange) {
  /** @type {MediaQueryList | null} */
  let media = null;
  let stopped = false;
  const arm = () => {
    if (media) media.removeEventListener("change", fire);
    try {
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media.addEventListener("change", fire);
    } catch (error) {
      media = null; // engine without `resolution` media queries; harmless
    }
  };
  function fire() {
    // onChange may stop the watch (a figure torn down by its own resize) or
    // throw; neither may leave the listener armed or the watch dead.
    try {
      onChange();
    } finally {
      if (!stopped) arm();
    }
  }
  arm();
  return () => {
    stopped = true;
    if (media) media.removeEventListener("change", fire);
    media = null;
  };
}

/**
 * Prepare a canvas for hi-DPI drawing and keep it that way.
 *
 * The canvas is sized entirely by CSS (see `.anim-figure__frame` in
 * anim.css). This helper matches the backing store to the CSS box times
 * `devicePixelRatio`, sets the 2D transform so all your drawing code works in
 * CSS pixels, and re-does both whenever the element resizes or the reader
 * moves the window to a display with a different pixel ratio.
 *
 * @param {HTMLCanvasElement|string} canvas element or CSS selector
 * @param {Object} [options]
 * @param {(handle: CanvasHandle) => void} [options.onResize] called after
 *        every size or DPR change; repaint here (the canvas is cleared by
 *        the resize, so a repaint is required)
 * @param {number} [options.maxDpr=3] cap on the pixel ratio, to keep very
 *        large canvases on 4x displays affordable
 * @param {boolean} [options.alpha=true] pass false for an opaque canvas
 * @returns {CanvasHandle}
 */
export function setupCanvas(canvas, options = {}) {
  const node =
    typeof canvas === "string" ? document.querySelector(canvas) : canvas;
  if (!(node instanceof HTMLCanvasElement)) {
    throw new Error("anim-core: setupCanvas needs a <canvas>");
  }
  const el = node;

  const maxDpr = options.maxDpr || 3;
  const context = el.getContext("2d", {
    alpha: options.alpha !== false,
  });
  if (!context) throw new Error("anim-core: no 2D context for this canvas");
  const ctx = context;

  /** @type {CanvasHandle} */
  const handle = {
    canvas: el,
    ctx,
    width: 0,
    height: 0,
    dpr: 1,
    sync,
    destroy,
  };

  function sync() {
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const cssWidth = Math.max(1, Math.round(rect.width));
    const cssHeight = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);

    const changed =
      el.width !== pixelWidth || el.height !== pixelHeight || handle.dpr !== dpr;
    if (changed) {
      el.width = pixelWidth;
      el.height = pixelHeight;
    }

    handle.width = cssWidth;
    handle.height = cssHeight;
    handle.dpr = dpr;
    // Setting width/height resets the transform, so (re)apply it every time.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return changed;
  }

  sync();

  const notify = () => {
    if (sync() && options.onResize) options.onResize(handle);
  };

  const observer = new ResizeObserver(notify);
  observer.observe(el);

  const stopWatchingDpr = watchPixelRatio(notify);

  function destroy() {
    observer.disconnect();
    stopWatchingDpr();
  }

  return handle;
}

/**
 * Fill the whole canvas with a flat colour (and reset any leftover path
 * state). Call this at the top of a repaint.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{width: number, height: number}} size a CanvasHandle works here
 * @param {string} [fill] colour; omit to erase to transparent
 * @returns {void}
 */
export function clearCanvas(ctx, size, fill) {
  ctx.clearRect(0, 0, size.width, size.height);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size.width, size.height);
  }
}

/**
 * Snap a coordinate to the nearest crisp position for a stroke of the given
 * width, so 1px rules do not come out blurry.
 * @param {number} value
 * @param {number} [lineWidth=1]
 * @returns {number}
 */
export function crisp(value, lineWidth = 1) {
  return lineWidth % 2 === 0 ? Math.round(value) : Math.round(value) + 0.5;
}

/* ---------------------------------------------------------------------------
 * Frame loop
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} FrameInfo
 * @property {number} time     seconds since the loop first started running
 * @property {number} dt       seconds since the previous rendered frame
 * @property {number} frame    monotonically increasing frame counter
 * @property {boolean} static  true when this is a one-off static repaint
 *           (reduced motion, or a manual render) rather than a live frame
 */

/**
 * @typedef {Object} Loop
 * @property {() => void} start   begin animating (no-op under reduced motion,
 *           which renders one static frame instead)
 * @property {() => void} stop    pause
 * @property {() => void} toggle
 * @property {() => boolean} isRunning
 * @property {(time?: number) => void} render  paint one frame right now
 * @property {() => void} destroy  stop and release observers
 */

/**
 * Create a requestAnimationFrame loop that only burns cycles when the figure
 * is actually visible.
 *
 * The loop is suspended when the observed element scrolls off screen
 * (IntersectionObserver) and when the tab is hidden, and resumes on its own
 * when the figure comes back. Under `prefers-reduced-motion: reduce` it never
 * animates: `start()` paints a single static frame instead, which is the
 * behaviour the site requires.
 *
 * @param {(info: FrameInfo) => void} render called once per frame
 * @param {Object} [options]
 * @param {Element} [options.element] element whose visibility gates the loop;
 *        strongly recommended: pass the `.anim-figure`
 * @param {number} [options.fps] cap the frame rate (default: display rate)
 * @param {boolean} [options.autoplay=true] start as soon as the element
 *        becomes visible
 * @param {number} [options.threshold=0.2] visible fraction that counts as
 *        on screen
 * @param {number} [options.staticTime=0] `time` handed to the single frame
 *        rendered under reduced motion; use it to pick a representative
 *        frame rather than a blank one
 * @param {(running: boolean) => void} [options.onStateChange] notified on
 *        every play/pause transition, for keeping a button label in sync
 * @returns {Loop}
 */
export function createLoop(render, options = {}) {
  const {
    element = null,
    fps = 0,
    autoplay = true,
    threshold = 0.2,
    staticTime = 0,
    onStateChange = null,
  } = options;

  const reduced = prefersReducedMotion();
  const minDelta = fps > 0 ? 1 / fps : 0;

  let wanted = false; // the caller wants to be running
  let userPaused = false; // an explicit stop() suppresses autoplay from then on
  let visible = !element; // element is on screen
  let rafId = 0;
  let originMs = 0;
  let lastMs = 0;
  let elapsed = 0;
  let frame = 0;
  let running = false;

  /**
   * @param {number} time
   * @param {boolean} isStatic
   */
  function paint(time, isStatic) {
    render({ time, dt: 0, frame, static: !!isStatic });
  }

  /** @param {number} nowMs */
  function tick(nowMs) {
    rafId = requestAnimationFrame(tick);
    if (!originMs) originMs = nowMs;
    const dt = (nowMs - lastMs) / 1000;
    if (minDelta && dt < minDelta) return;
    lastMs = nowMs;
    elapsed = (nowMs - originMs) / 1000;
    frame += 1;
    render({ time: elapsed, dt: dt || 0, frame, static: false });
  }

  function evaluate() {
    const shouldRun =
      wanted && visible && !reduced && document.visibilityState !== "hidden";
    if (shouldRun === running) return;
    running = shouldRun;
    if (running) {
      // Restart the clock so a long pause is not replayed as one huge dt.
      originMs = 0;
      lastMs = performance.now();
      originMs = lastMs - elapsed * 1000;
      rafId = requestAnimationFrame(tick);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (onStateChange) onStateChange(running);
  }

  function start() {
    wanted = true;
    userPaused = false;
    if (reduced) {
      paint(staticTime, true);
      if (onStateChange) onStateChange(false);
      return;
    }
    evaluate();
  }

  function stop() {
    wanted = false;
    userPaused = true;
    evaluate();
  }

  let observer = null;
  if (element && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible = entry.isIntersecting;
        evaluate();
        if (visible && autoplay && !wanted && !userPaused) start();
      },
      { threshold }
    );
    observer.observe(element);
  } else {
    visible = true;
  }

  const onVisibility = () => evaluate();
  document.addEventListener("visibilitychange", onVisibility);

  if (!observer && autoplay) start();

  return {
    start,
    stop,
    toggle() {
      if (running) stop();
      else start();
    },
    isRunning() {
      return running;
    },
    render(time) {
      paint(time === undefined ? elapsed : time, true);
    },
    destroy() {
      wanted = false;
      evaluate();
      if (observer) observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/* ---------------------------------------------------------------------------
 * Transport: wires the controls defined in anim.css to a frame index
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} Transport
 * @property {() => void} play
 * @property {() => void} pause
 * @property {() => void} toggle
 * @property {(index: number) => void} seek  clamp and paint a frame
 * @property {() => number} frame  current frame index
 * @property {() => void} destroy
 */

/**
 * Wire the standard figure controls (`.anim-btn--play`, `.anim-range`,
 * `.anim-readout`, see anim.css) to a frame index, for figures that step
 * through a precomputed sequence.
 *
 * Purely mechanical: it advances an integer and calls you back. Under reduced
 * motion it does not autoplay; the figure holds on `startFrame` and the reader
 * can still scrub. Play, after a scrub or a `seek()`, continues from that
 * frame.
 *
 * @param {Element} root the `.anim-figure`
 * @param {Object} options
 * @param {number} options.frames total number of frames (>= 1)
 * @param {(index: number) => void} options.onFrame paint frame `index`
 * @param {number} [options.fps=25] playback rate
 * @param {boolean} [options.loop=true] wrap at the end instead of stopping
 * @param {boolean} [options.autoplay=true] play when scrolled into view
 * @param {number} [options.startFrame=0] initial and reduced-motion frame
 * @param {(index: number) => string} [options.format] readout text; the
 *        default prints seconds at `fps`
 * @returns {Transport}
 */
export function createTransport(root, options) {
  const {
    frames,
    onFrame,
    fps = 25,
    loop = true,
    autoplay = true,
    startFrame = 0,
    format = null,
  } = options;

  const total = Math.max(1, frames | 0);
  const button = root.querySelector(".anim-btn--play");
  const rangeEl = root.querySelector(".anim-range");
  const range = rangeEl instanceof HTMLInputElement ? rangeEl : null;
  const readout = root.querySelector(".anim-readout");
  const reduced = prefersReducedMotion();

  /** @param {number} i */
  const clamp = (i) => Math.min(Math.max(i | 0, 0), total - 1);

  let index = clamp(startFrame);

  // Playback counts frames from where the reader last put the figure, not
  // from when the loop first started. startFrame, seek() and the slider all
  // move this origin; the loop time at the origin is taken on the next tick.
  let originFrame = index;
  /** @type {number | null} */
  let originTime = null;

  function rebase() {
    originFrame = index;
    originTime = null;
  }

  if (range) {
    range.min = "0";
    range.max = String(total - 1);
    range.step = "1";
    range.value = String(index);
  }
  if (reduced) root.classList.add("is-static");

  /** @param {number} i */
  const label = (i) =>
    format ? format(i) : `${(i / fps).toFixed(2)} s`;

  /** @param {number} i */
  function paint(i) {
    index = i;
    onFrame(index);
    if (range && range.value !== String(index)) range.value = String(index);
    if (readout) readout.textContent = label(index);
  }

  const frameLoop = createLoop(
    ({ time, static: isStatic }) => {
      // A static repaint (reduced motion) holds the current frame.
      if (isStatic) return;
      if (originTime === null) originTime = time;
      const step = originFrame + Math.floor((time - originTime) * fps);
      const next = loop ? step % total : Math.min(step, total - 1);
      if (next !== index) paint(next);
      if (!loop && next >= total - 1) frameLoop.stop();
    },
    {
      element: root,
      fps,
      autoplay: autoplay && !reduced,
      onStateChange(running) {
        if (!button) return;
        button.setAttribute("aria-pressed", running ? "true" : "false");
        button.textContent = running ? "Pause" : "Play";
      },
    }
  );

  const onClick = () => frameLoop.toggle();
  const onInput = () => {
    if (!range) return;
    frameLoop.stop();
    paint(clamp(Number(range.value)));
    rebase();
  };

  if (button) button.addEventListener("click", onClick);
  if (range) range.addEventListener("input", onInput);

  paint(index);

  return {
    play: () => frameLoop.start(),
    pause: () => frameLoop.stop(),
    toggle: () => frameLoop.toggle(),
    seek(i) {
      frameLoop.stop();
      paint(clamp(i));
      rebase();
    },
    frame: () => index,
    destroy() {
      frameLoop.destroy();
      if (button) button.removeEventListener("click", onClick);
      if (range) range.removeEventListener("input", onInput);
    },
  };
}

/* ---------------------------------------------------------------------------
 * Audio playback: a clip, a button, and a playhead the figure can draw
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} AudioPlayer
 * @property {() => void} toggle
 * @property {() => void} stop
 * @property {() => number|null} time  playhead in seconds, or null when idle
 * @property {() => boolean} playing
 * @property {() => void} destroy
 */

/**
 * Wire a button to a sound file and report the playhead while it runs.
 *
 * For figures drawn against time, where hearing the audio and watching a
 * cursor cross the picture says more than either alone. The figure supplies
 * the drawing: this only owns the element, the button state and the frame
 * callback.
 *
 * The clip is fetched on first press (`preload="none"`), so a page carrying
 * several of these costs nothing until a reader asks for one.
 *
 * Reduced motion is deliberately NOT honoured here. Playback is explicitly
 * requested by a press rather than started on scroll, and a reader who asked
 * to hear a recording still needs to see where in it they are.
 *
 * @param {Object} options
 * @param {string} options.src site-root-relative path, or an absolute URL
 * @param {HTMLButtonElement} options.button the `.anim-btn--play` to wire up
 * @param {(seconds: number|null) => void} options.onFrame called each animation
 *        frame while playing, and once with `null` when playback ends
 * @param {string} [options.playLabel="Play"]
 * @param {string} [options.stopLabel="Stop"]
 * @param {number} [options.from] seconds into the file; play only that span
 * @param {number} [options.until] seconds into the file; play only that span
 * @returns {AudioPlayer}
 */
export function createAudioPlayer(options) {
  const { src, button, onFrame, from, until } = options;
  const playLabel = options.playLabel || "Play";
  const stopLabel = options.stopLabel || "Stop";

  const audio = new Audio();
  audio.preload = "none";
  // A span (from, until) needs seeking, and a server that ignores Range
  // requests (zensical serve) leaves a streamed file unseekable. A span
  // player fetches the file whole on first press and plays it from a blob
  // URL, which seeks anywhere. The file is still played as it is; nothing
  // is decoded here.
  const span = from !== undefined || until !== undefined;
  if (!span) audio.src = assetURL(src);
  /** @type {Promise<void> | null} */
  let source = null;
  let objectURL = "";
  let destroyed = false;

  /** Resolves once the blob is loaded and its metadata known, so a seek lands.
      @returns {Promise<void>} */
  function ready() {
    source ??= fetch(assetURL(src), { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`anim-core: ${response.status} loading ${src}`);
        return response.blob();
      })
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            // Destroyed while the fetch ran: make no URL, so nothing leaks.
            if (destroyed) return resolve(undefined);
            objectURL = URL.createObjectURL(blob);
            audio.addEventListener("loadedmetadata", () => resolve(undefined), { once: true });
            audio.addEventListener("error", reject, { once: true });
            audio.preload = "auto";
            audio.src = objectURL;
          })
      );
    source.catch(() => {
      source = null; // let a later press try again
    });
    return source;
  }

  let raf = 0;
  let playing = false;

  function tick() {
    if (!playing) return;
    if (until !== undefined && audio.currentTime >= until) {
      stop();
      return;
    }
    // Until the seek to `from` lands, the element still reports 0.
    if (from !== undefined && audio.currentTime < from) {
      raf = requestAnimationFrame(tick);
      return;
    }
    onFrame(audio.currentTime);
    raf = requestAnimationFrame(tick);
  }

  function setLabel() {
    button.textContent = playing ? stopLabel : playLabel;
    button.setAttribute("aria-pressed", String(playing));
  }

  function stop() {
    playing = false;
    audio.pause();
    if (!span || audio.readyState > 0) audio.currentTime = from ?? 0;
    cancelAnimationFrame(raf);
    setLabel();
    onFrame(null);
  }

  // A rejected play() resets the control rather than throwing into the
  // console. Only a refusal (autoplay policy) or an unplayable file
  // disables the button. An AbortError (a pause() or destroy() while play()
  // was pending) and a failed fetch leave it for a later press, and a player
  // that has been destroyed touches nothing: its button may already belong
  // to the player that replaced it.
  /** @param {unknown} error */
  function fail(error) {
    if (destroyed) return;
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "NotSupportedError") button.disabled = true;
    stop();
  }

  function toggle() {
    if (playing) {
      stop();
      return;
    }
    playing = true;
    setLabel();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    if (!span) {
      const started = audio.play();
      if (started && typeof started.catch === "function") started.catch(fail);
      return;
    }
    ready()
      .then(() => {
        if (!playing || destroyed) return;
        audio.currentTime = from ?? 0;
        return audio.play();
      })
      .catch(fail);
  }

  const onEnded = () => stop();
  const onError = () => {
    if (destroyed || audio.getAttribute("src") === "") return; // destroy() emptied it
    button.disabled = true;
    stop();
  };

  button.addEventListener("click", toggle);
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);
  setLabel();

  return {
    toggle,
    stop,
    time: () => (playing ? audio.currentTime : null),
    playing: () => playing,
    destroy() {
      destroyed = true;
      playing = false;
      cancelAnimationFrame(raf);
      audio.pause();
      button.removeEventListener("click", toggle);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.src = "";
      if (objectURL) URL.revokeObjectURL(objectURL);
    },
  };
}

/* ---------------------------------------------------------------------------
 * Mounting
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} MountContext
 * @property {AbortSignal} signal aborted when the element leaves the
 *           document. Pass it to addEventListener and fetch, and check
 *           `signal.aborted` after every await.
 */

/** @typedef {void | (() => void)} Cleanup */

/**
 * @typedef {Object} MountEntry
 * @property {string} selector
 * @property {(() => void) | null} cleanup set once init has resolved
 * @property {AbortController} controller
 */

/** @type {Map<Element, MountEntry>} */
const mounted = new Map();

/**
 * @typedef {Object} AnimTestHook
 * @property {number} liveContexts WebGL contexts held by figures right now
 * @property {number} peakContexts most held at once since the page loaded
 * @property {number} mounted      mount records alive
 * @property {number} webglProbes  times anim-three.js probed for WebGL 2
 * @property {number} renders      frames anim-three.js has drawn
 * @property {number} parks        views parked to free a context for another
 * @property {number} unparks      parked views given a context again
 * @property {number} waits        context requests that had to queue
 * @property {number} cap          live contexts allowed at once (MAX_LIVE)
 * @property {Record<string, number>} played  first-view animations started,
 *           by figure id; 1 at most per figure and page load
 * @property {() => void} finishAll  jump every running animation to its end
 * @property {Record<string, number>} tracks  the most timeline tracks one
 *           figure's 3D view has run at once, by slug (at most 3, design §8)
 * @property {Record<string, {calls: number, triangles: number}>} draws  the
 *           most draw calls and triangles one frame of a figure's 3D view
 *           has taken, by slug
 * @property {Record<string, unknown>} figures  per-figure probes, by slug
 */

/**
 * Test hook, published only when the site is served from this machine
 * (`zensical serve`), never on the deployed site. The figure tests read it
 * to prove that mounts and WebGL contexts are torn down across instant
 * navigation.
 * @type {AnimTestHook | null}
 */
export const TEST_HOOK =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? (window.__ambeAnim ??= {
        liveContexts: 0, peakContexts: 0, mounted: 0, webglProbes: 0, renders: 0,
        parks: 0, unparks: 0, waits: 0, cap: 0, played: {}, finishAll: () => finishAll(), draws: {}, tracks: {},
        figures: {},
      })
    : null;

/** @type {Set<() => void>} */
const finishers = new Set();

/**
 * Register a function that jumps an animation to its end state, for
 * TEST_HOOK.finishAll() (tests settle every figure on its end state before
 * a screenshot). Returns the function that unregisters it.
 * @param {() => void} finish
 * @returns {() => void}
 */
export function onFinishAll(finish) {
  finishers.add(finish);
  return () => finishers.delete(finish);
}

function finishAll() {
  for (const finish of [...finishers]) finish();
}

/**
 * Count a first-view animation for the test hook.
 * @param {string} id the figure's id: its slug, or slug and host index
 * @returns {void}
 */
export function notePlayed(id) {
  if (TEST_HOOK) TEST_HOOK.played[id] = (TEST_HOOK.played[id] ?? 0) + 1;
}

/**
 * Initialise every element matching `selector`, once each, now and after any
 * `navigation.instant` page swap. When a mounted element leaves the document,
 * its signal is aborted and its cleanup runs, so observers and loops do not
 * leak across pages. That holds even when the element leaves while `init` is
 * still awaiting data: the cleanup it returns later runs at once.
 *
 * @param {string} selector e.g. '[data-anim="pitch-track"]'
 * @param {(element: Element, context: MountContext) => Cleanup | Promise<Cleanup>} init
 *        may return a cleanup function (or a promise of one)
 * @returns {void}
 */
export function mount(selector, init) {
  const sweep = () => {
    // Tear down anything that vanished with the previous page.
    for (const [element, entry] of mounted) {
      if (element.isConnected) continue;
      entry.controller.abort();
      mounted.delete(element);
      try {
        if (entry.cleanup) entry.cleanup();
      } catch (error) {
        console.error(`anim-core: ${entry.selector} cleanup failed`, error);
      }
    }
    for (const element of document.querySelectorAll(selector)) {
      if (mounted.has(element)) continue;
      /** @type {MountEntry} */
      const entry = { selector, cleanup: null, controller: new AbortController() };
      mounted.set(element, entry);
      const { signal } = entry.controller;
      const settled = holdAnchor(element);
      Promise.resolve()
        .then(() => init(element, { signal }))
        .finally(settled)
        .then((cleanup) => {
          if (typeof cleanup !== "function") return;
          // The page may have been swapped out while init awaited its data.
          // Then nothing will ever call this cleanup later, so call it now.
          if (signal.aborted || !element.isConnected || mounted.get(element) !== entry) {
            cleanup();
          } else {
            entry.cleanup = cleanup;
          }
        })
        .catch((error) => {
          // A load cut short by the reader leaving is not a failure.
          if (signal.aborted) return;
          console.error(`anim-core: ${selector} failed to mount`, error);
          const frame = element.querySelector(".anim-figure__frame");
          if (frame instanceof HTMLElement) frame.dataset.state = "error";
        });
    }
    if (TEST_HOOK) TEST_HOOK.mounted = mounted.size;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sweep, { once: true });
  } else {
    sweep();
  }

  // zensical/Material publish an RxJS subject that emits on instant navigation.
  const document$ = window.document$;
  if (document$ && typeof document$.subscribe === "function") {
    document$.subscribe(sweep);
  }
}

/**
 * Keep the browser's scroll anchor out of a host while its figure is built.
 * The anchor is the node the browser keeps still when the page above it
 * changes height, and it picks the first one at the top of the window. A
 * host just above a heading the reader jumped to leaves its last step under
 * the fixed header, so the browser picked that step. Building the figure
 * moves the step list up into the figure, and the browser followed it, which
 * scrolled ch08 about 1,500 px. With the host left out, the browser keeps the
 * heading still instead. Returns the call that lets the host be picked again,
 * two frames after its figure is built.
 * @param {Element} host
 * @returns {() => void}
 */
function holdAnchor(host) {
  if (!(host instanceof HTMLElement)) return () => {};
  const before = host.style.overflowAnchor;
  host.style.overflowAnchor = "none";
  return () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      host.style.overflowAnchor = before;
    }));
  };
}

/**
 * Register a figure whose module is fetched only when a page carries its
 * host, so its code is not even parsed elsewhere. anim.js uses this for
 * every figure added after 2026-10-08:
 *
 *     mountLazy("vq-space", () => import("./anim-vq-space.js"));
 *
 * The module exports `init(element, context)` with the same contract as a
 * {@link mount} callback. If the host leaves while the module is loading,
 * init is never called.
 *
 * @param {string} slug the `data-anim` value
 * @param {() => Promise<{ init: (element: Element, context: MountContext) => Cleanup | Promise<Cleanup> }>} load
 * @returns {void}
 */
export function mountLazy(slug, load) {
  mount(`[data-anim="${slug}"]`, async (element, context) => {
    const module = await load();
    if (context.signal.aborted) return;
    return module.init(element, context);
  });
}

/* ---------------------------------------------------------------------------
 * Plotting primitives
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} Scale
 * @property {(value: number) => number} of        map domain -> range
 * @property {(position: number) => number} invert map range -> domain
 * @property {[number, number]} domain
 * @property {[number, number]} range
 */

/**
 * Build a linear scale between a data domain and a pixel range.
 * @param {[number, number]} domain [min, max] in data units
 * @param {[number, number]} range  [start, end] in pixels (may be inverted)
 * @returns {Scale}
 */
export function linearScale(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return {
    domain: [d0, d1],
    range: [r0, r1],
    of: (value) => r0 + ((value - d0) / span) * (r1 - r0),
    invert: (position) => d0 + ((position - r0) / (r1 - r0 || 1)) * span,
  };
}

/**
 * Human-friendly tick values covering a domain (1/2/5 x 10^n steps).
 * @param {[number, number]} domain
 * @param {number} [count=5] approximate number of ticks wanted
 * @returns {number[]} ascending tick values inside the domain
 */
export function ticks(domain, count = 5) {
  const [min, max] = domain;
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const raw = (max - min) / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const normalised = raw / magnitude;
  const step =
    (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

/**
 * @typedef {Object} Plot
 * @property {{x: number, y: number, width: number, height: number,
 *             left: number, right: number, top: number, bottom: number}} area
 *           the drawing rectangle in CSS pixels, inside the padding
 * @property {(value: number) => number} x   data x -> pixel x
 * @property {(value: number) => number} y   data y -> pixel y (y up)
 * @property {(px: number) => number} invertX
 * @property {(py: number) => number} invertY
 * @property {Scale} xScale
 * @property {Scale} yScale
 * @property {(ctx: CanvasRenderingContext2D) => void} clip  clip to `area`
 */

/**
 * Lay out a plotting rectangle inside a canvas and give you data->pixel
 * mappings for it. Y is "up": larger data values are higher on screen.
 *
 * @param {{width: number, height: number}} size a CanvasHandle works here
 * @param {Object} options
 * @param {[number, number]} options.xDomain data range along x
 * @param {[number, number]} options.yDomain data range along y
 * @param {number|{top?: number, right?: number, bottom?: number, left?: number}} [options.padding=32]
 *        gutter reserved for axis labels, in CSS pixels
 * @returns {Plot}
 */
export function createPlot(size, options) {
  const p = options.padding === undefined ? 32 : options.padding;
  const pad =
    typeof p === "number"
      ? { top: p / 2, right: p / 2, bottom: p, left: p }
      : { top: 8, right: 8, bottom: 28, left: 36, ...p };

  const left = pad.left;
  const top = pad.top;
  const width = Math.max(1, size.width - pad.left - pad.right);
  const height = Math.max(1, size.height - pad.top - pad.bottom);
  const area = {
    x: left,
    y: top,
    width,
    height,
    left,
    right: left + width,
    top,
    bottom: top + height,
  };

  const xScale = linearScale(options.xDomain, [area.left, area.right]);
  const yScale = linearScale(options.yDomain, [area.bottom, area.top]);

  return {
    area,
    xScale,
    yScale,
    x: xScale.of,
    y: yScale.of,
    invertX: xScale.invert,
    invertY: yScale.invert,
    clip(ctx) {
      ctx.beginPath();
      ctx.rect(area.x, area.y, area.width, area.height);
      ctx.clip();
    },
  };
}

/**
 * Draw the background grid for a plot.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Plot} plot
 * @param {Object} [options]
 * @param {number[]} [options.xTicks] data values for vertical lines;
 *        defaults to `ticks(plot.xScale.domain)`
 * @param {number[]} [options.yTicks] data values for horizontal lines
 * @param {string} [options.color] defaults to the theme's grid colour
 * @param {number[]} [options.dash] line dash pattern, e.g. [2, 3]
 * @returns {void}
 */
export function drawGrid(ctx, plot, options = {}) {
  const theme = getTheme();
  const xs = options.xTicks || ticks(plot.xScale.domain, 6);
  const ys = options.yTicks || ticks(plot.yScale.domain, 4);

  ctx.save();
  ctx.strokeStyle = options.color || theme.grid;
  ctx.lineWidth = 1;
  if (options.dash) ctx.setLineDash(options.dash);
  ctx.beginPath();
  for (const v of xs) {
    const px = crisp(plot.x(v));
    if (px < plot.area.left - 0.5 || px > plot.area.right + 0.5) continue;
    ctx.moveTo(px, plot.area.top);
    ctx.lineTo(px, plot.area.bottom);
  }
  for (const v of ys) {
    const py = crisp(plot.y(v));
    if (py < plot.area.top - 0.5 || py > plot.area.bottom + 0.5) continue;
    ctx.moveTo(plot.area.left, py);
    ctx.lineTo(plot.area.right, py);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the x and y axis lines, their ticks and their tick labels, plus
 * optional axis titles.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Plot} plot
 * @param {Object} [options]
 * @param {number[]} [options.xTicks] data values (default: nice ticks)
 * @param {number[]} [options.yTicks]
 * @param {(value: number) => string} [options.formatX] tick text
 * @param {(value: number) => string} [options.formatY]
 * @param {string} [options.xLabel] axis title under the x axis
 * @param {string} [options.yLabel] axis title, rotated, left of the y axis
 * @param {string} [options.color] axis line colour (default: theme.axis)
 * @param {string} [options.textColor] label colour (default: theme.muted)
 * @param {number} [options.fontSize=11] label size in CSS pixels
 * @returns {void}
 */
export function drawAxes(ctx, plot, options = {}) {
  const theme = getTheme();
  const color = options.color || theme.axis;
  const textColor = options.textColor || theme.muted;
  const fontSize = options.fontSize || 11;
  /** @param {number} v */
  const fmt = (v) => (Math.abs(v) < 1e-9 ? "0" : String(Math.round(v * 1000) / 1000));
  const formatX = options.formatX || fmt;
  const formatY = options.formatY || fmt;
  const xs = options.xTicks || ticks(plot.xScale.domain, 6);
  const ys = options.yTicks || ticks(plot.yScale.domain, 4);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.area.left, crisp(plot.area.bottom));
  ctx.lineTo(plot.area.right, crisp(plot.area.bottom));
  ctx.moveTo(crisp(plot.area.left), plot.area.top);
  ctx.lineTo(crisp(plot.area.left), plot.area.bottom);
  for (const v of xs) {
    const px = crisp(plot.x(v));
    ctx.moveTo(px, plot.area.bottom);
    ctx.lineTo(px, plot.area.bottom + 4);
  }
  for (const v of ys) {
    const py = crisp(plot.y(v));
    ctx.moveTo(plot.area.left - 4, py);
    ctx.lineTo(plot.area.left, py);
  }
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px ${theme.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const v of xs) {
    ctx.fillText(formatX(v), plot.x(v), plot.area.bottom + 7);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of ys) {
    ctx.fillText(formatY(v), plot.area.left - 7, plot.y(v));
  }

  if (options.xLabel) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      options.xLabel,
      (plot.area.left + plot.area.right) / 2,
      plot.area.bottom + fontSize * 2.6
    );
  }
  if (options.yLabel) {
    ctx.save();
    ctx.translate(fontSize, (plot.area.top + plot.area.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(options.yLabel, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Draw a text label, optionally on a rounded chip so it stays readable on top
 * of busy data.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x pixel x
 * @param {number} y pixel y
 * @param {Object} [options]
 * @param {CanvasTextAlign} [options.align="left"]
 * @param {CanvasTextBaseline} [options.baseline="alphabetic"]
 * @param {string} [options.color] default: theme.ink
 * @param {number} [options.size=12] font size in CSS pixels
 * @param {number|string} [options.weight=400]
 * @param {boolean} [options.mono=false] use the monospace stack
 * @param {string} [options.background] chip fill; omit for plain text
 * @param {number} [options.padding=4] chip padding
 * @returns {{width: number, height: number}} measured text box
 */
export function drawLabel(ctx, text, x, y, options = {}) {
  const theme = getTheme();
  const size = options.size || 12;
  const family = options.mono ? theme.mono : theme.font;

  ctx.save();
  ctx.font = `${options.weight || 400} ${size}px ${family}`;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "alphabetic";

  const metrics = ctx.measureText(text);
  const width = metrics.width;
  const height = size * 1.2;

  if (options.background) {
    const pad = options.padding === undefined ? 4 : options.padding;
    const align = ctx.textAlign;
    const bx =
      align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    const baseline = ctx.textBaseline;
    const by =
      baseline === "middle"
        ? y - height / 2
        : baseline === "top"
        ? y
        : y - height * 0.8;
    ctx.fillStyle = options.background;
    ctx.beginPath();
    const bw = width + pad * 2;
    const bh = height + pad * 2;
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(bx - pad, by - pad, bw, bh, 4);
    } else {
      ctx.rect(bx - pad, by - pad, bw, bh);
    }
    ctx.fill();
  }

  ctx.fillStyle = options.color || theme.ink;
  ctx.fillText(text, x, y);
  ctx.restore();

  return { width, height };
}

/**
 * Stroke (and optionally fill) a polyline.
 *
 * Points are pixel coordinates by default. Pass `plot` to hand in data
 * coordinates instead and have them mapped for you.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}|[number, number]>} points
 * @param {Object} [options]
 * @param {Plot} [options.plot] treat `points` as data coordinates
 * @param {string} [options.color] stroke colour (default: theme.series[0])
 * @param {number} [options.width=2] stroke width in CSS pixels
 * @param {number[]} [options.dash] dash pattern
 * @param {string} [options.fill] fill colour for the closed area
 * @param {number} [options.fillBaseline] data/pixel y the fill drops to
 *        (default: the plot's bottom, or the canvas bottom)
 * @param {boolean} [options.close=false] close the path
 * @param {CanvasLineJoin} [options.join="round"]
 * @returns {void}
 */
export function drawPolyline(ctx, points, options = {}) {
  if (!points || points.length === 0) return;
  const theme = getTheme();
  const plot = options.plot;
  /** @param {{x: number, y: number} | [number, number]} p */
  const px = (p) => {
    const vx = Array.isArray(p) ? p[0] : p.x;
    return plot ? plot.x(vx) : vx;
  };
  /** @param {{x: number, y: number} | [number, number]} p */
  const py = (p) => {
    const vy = Array.isArray(p) ? p[1] : p.y;
    return plot ? plot.y(vy) : vy;
  };

  ctx.save();

  // The fill is a separate path: closing it into the baseline must not add
  // spurious segments to the stroked line.
  if (options.fill) {
    const baseline =
      options.fillBaseline !== undefined
        ? plot
          ? plot.y(options.fillBaseline)
          : options.fillBaseline
        : plot
        ? plot.area.bottom
        : ctx.canvas.height;
    ctx.beginPath();
    ctx.moveTo(px(points[0]), baseline);
    for (let i = 0; i < points.length; i += 1) {
      ctx.lineTo(px(points[i]), py(points[i]));
    }
    ctx.lineTo(px(points[points.length - 1]), baseline);
    ctx.closePath();
    ctx.fillStyle = options.fill;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(px(points[0]), py(points[0]));
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(px(points[i]), py(points[i]));
  }
  if (options.close) ctx.closePath();

  ctx.strokeStyle = options.color || theme.series[0];
  ctx.lineWidth = options.width === undefined ? 2 : options.width;
  ctx.lineJoin = options.join || "round";
  ctx.lineCap = "round";
  if (options.dash) ctx.setLineDash(options.dash);
  ctx.stroke();
  ctx.restore();
}
