/* ===========================================================================
 * anim-core.js — shared runtime for the interactive figures on this site.
 * ---------------------------------------------------------------------------
 * SCOPE (deliberate, and enforced by review): this module draws pictures.
 * It sets up canvases, runs a frame loop, reads theme tokens, loads
 * precomputed JSON, and provides generic plotting primitives (axes, grids,
 * labels, polylines).
 *
 * It contains NO codec logic of any kind: no pitch estimation, no voicing
 * decision, no spectral-amplitude estimation, no quantiser, no bit packing,
 * no synthesis, no AMBE tables. Everything AMBE-specific arrives as data,
 * precomputed and captured from real hardware, from docs/assets/data/*.json.
 * Animation modules that import this file are held to the same rule.
 *
 * This is an ES module. It must be loaded with type="module", i.e. in
 * zensical.toml:
 *
 *     extra_javascript = [
 *       { path = "javascripts/anim-core.js", type = "module" },
 *       { path = "javascripts/<your-figure>.js", type = "module" },
 *     ]
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
 * Data loading
 * ------------------------------------------------------------------------ */

/** @type {Map<string, Promise<any>>} */
const dataCache = new Map();

/**
 * Fetch a precomputed JSON dataset, memoised per URL for the lifetime of the
 * page. Concurrent callers share one request; repeat visits under
 * `navigation.instant` reuse the resolved value.
 *
 * Paths are resolved with {@link assetURL}, so pass them site-root-relative
 * ("assets/data/foo.json") rather than page-relative.
 *
 * @param {string} path site-root-relative path or absolute URL
 * @param {{signal?: AbortSignal, reload?: boolean}} [options]
 *        `reload: true` bypasses and refreshes the cache entry.
 * @returns {Promise<any>} parsed JSON
 * @throws {Error} if the response is not ok or the body is not JSON
 */
export function loadJSON(path, options = {}) {
  const url = assetURL(path);
  if (options.reload) dataCache.delete(url);

  if (!dataCache.has(url)) {
    const pending = fetch(url, { signal: options.signal, credentials: "same-origin" })
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
  return dataCache.get(url);
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
 * Run a callback whenever the active theme changes — either because the
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
 * True when the reader has asked for reduced motion. Figures must then hold
 * on a static representative frame instead of animating; {@link createLoop}
 * and {@link createTransport} already do this for you.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  const el =
    typeof canvas === "string" ? document.querySelector(canvas) : canvas;
  if (!el || !(el instanceof HTMLCanvasElement)) {
    throw new Error("anim-core: setupCanvas needs a <canvas>");
  }

  const maxDpr = options.maxDpr || 3;
  const ctx = el.getContext("2d", {
    alpha: options.alpha !== false,
  });

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

  // devicePixelRatio changes (window dragged to another display, browser
  // zoom) do not fire ResizeObserver, so watch the ratio itself.
  let dprMedia = null;
  const watchDpr = () => {
    if (dprMedia) dprMedia.removeEventListener("change", onDpr);
    try {
      dprMedia = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`
      );
      dprMedia.addEventListener("change", onDpr);
    } catch (error) {
      dprMedia = null; // engine without `resolution` media queries; harmless
    }
  };
  function onDpr() {
    notify();
    watchDpr();
  }
  watchDpr();

  function destroy() {
    observer.disconnect();
    if (dprMedia) dprMedia.removeEventListener("change", onDpr);
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
 *        strongly recommended — pass the `.anim-figure`
 * @param {number} [options.fps] cap the frame rate (default: display rate)
 * @param {boolean} [options.autoplay=true] start as soon as the element
 *        becomes visible
 * @param {number} [options.threshold=0.2] visible fraction that counts as
 *        on screen
 * @param {number} [options.staticTime=0] `time` handed to the single frame
 *        rendered under reduced motion — use it to pick a representative
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

  function paint(time, isStatic) {
    render({ time, dt: 0, frame, static: !!isStatic });
  }

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
 * Transport — wires the controls defined in anim.css to a frame index
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
 * `.anim-readout` — see anim.css) to a frame index, for figures that step
 * through a precomputed sequence.
 *
 * Purely mechanical: it advances an integer and calls you back. Under reduced
 * motion it does not autoplay; the figure holds on `startFrame` and the reader
 * can still scrub.
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
  const range = root.querySelector(".anim-range");
  const readout = root.querySelector(".anim-readout");
  const reduced = prefersReducedMotion();

  let index = Math.min(Math.max(startFrame | 0, 0), total - 1);

  if (range) {
    range.min = "0";
    range.max = String(total - 1);
    range.step = "1";
    range.value = String(index);
  }
  if (reduced) root.classList.add("is-static");

  const label = (i) =>
    format ? format(i) : `${(i / fps).toFixed(2)} s`;

  function paint(i) {
    index = i;
    onFrame(index);
    if (range && range.value !== String(index)) range.value = String(index);
    if (readout) readout.textContent = label(index);
  }

  const frameLoop = createLoop(
    ({ time }) => {
      const step = Math.floor(time * fps);
      const next = loop ? step % total : Math.min(step, total - 1);
      if (next !== index) paint(next);
      if (!loop && next >= total - 1) frameLoop.stop();
    },
    {
      element: root,
      fps,
      autoplay: autoplay && !reduced,
      staticTime: index / fps,
      onStateChange(running) {
        if (!button) return;
        button.setAttribute("aria-pressed", running ? "true" : "false");
        button.textContent = running ? "Pause" : "Play";
      },
    }
  );

  const onClick = () => frameLoop.toggle();
  const onInput = () => {
    frameLoop.stop();
    paint(Math.min(Math.max(Number(range.value) | 0, 0), total - 1));
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
      paint(Math.min(Math.max(i | 0, 0), total - 1));
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
 * Audio playback — a clip, a button, and a playhead the figure can draw
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
 * @param {HTMLElement} options.button the `.anim-btn--play` to wire up
 * @param {(seconds: number|null) => void} options.onFrame called each animation
 *        frame while playing, and once with `null` when playback ends
 * @param {string} [options.playLabel="Play"]
 * @param {string} [options.stopLabel="Stop"]
 * @returns {AudioPlayer}
 */
export function createAudioPlayer(options) {
  const { src, button, onFrame } = options;
  const playLabel = options.playLabel || "Play";
  const stopLabel = options.stopLabel || "Stop";

  const audio = new Audio();
  audio.preload = "none";
  audio.src = assetURL(src);

  let raf = 0;
  let playing = false;

  function tick() {
    if (!playing) return;
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
    audio.currentTime = 0;
    cancelAnimationFrame(raf);
    setLabel();
    onFrame(null);
  }

  function toggle() {
    if (playing) {
      stop();
      return;
    }
    // A rejected play() is the ordinary autoplay-policy path, not a bug, so it
    // resets the control rather than throwing into the console.
    const started = audio.play();
    playing = true;
    setLabel();
    raf = requestAnimationFrame(tick);
    if (started && typeof started.catch === "function") {
      started.catch(() => {
        button.disabled = true;
        stop();
      });
    }
  }

  const onEnded = () => stop();
  const onError = () => {
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
      cancelAnimationFrame(raf);
      audio.pause();
      button.removeEventListener("click", toggle);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.src = "";
    },
  };
}

/* ---------------------------------------------------------------------------
 * Mounting
 * ------------------------------------------------------------------------ */

/** @type {Map<Element, {selector: string, cleanup: (() => void)|null}>} */
const mounted = new Map();

/**
 * Initialise every element matching `selector`, once each, now and after any
 * `navigation.instant` page swap. When a mounted element leaves the document,
 * its cleanup runs, so observers and loops do not leak across pages.
 *
 * @param {string} selector e.g. '[data-anim="pitch-track"]'
 * @param {(element: Element) => (void | (() => void) | Promise<void | (() => void)>)} init
 *        may return a cleanup function (or a promise of one)
 * @returns {void}
 */
export function mount(selector, init) {
  const sweep = () => {
    // Tear down anything that vanished with the previous page.
    for (const [element, entry] of mounted) {
      if (!element.isConnected) {
        if (entry.cleanup) entry.cleanup();
        mounted.delete(element);
      }
    }
    for (const element of document.querySelectorAll(selector)) {
      if (mounted.has(element)) continue;
      const entry = { selector, cleanup: null };
      mounted.set(element, entry);
      Promise.resolve()
        .then(() => init(element))
        .then((cleanup) => {
          if (typeof cleanup === "function") entry.cleanup = cleanup;
        })
        .catch((error) => {
          console.error(`anim-core: ${selector} failed to mount`, error);
          const frame = element.querySelector(".anim-figure__frame");
          if (frame) frame.dataset.state = "error";
        });
    }
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
  const px = (p) => {
    const vx = Array.isArray(p) ? p[0] : p.x;
    return plot ? plot.x(vx) : vx;
  };
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
