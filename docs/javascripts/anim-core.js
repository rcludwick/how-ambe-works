/* anim-core.js — shared runtime for the figures on this site.
 *
 * SCOPE (deliberate and enforced): this file draws pictures. It loads
 * precomputed JSON captured from real hardware (docs/assets/data/) and
 * paints it onto a canvas with a play/pause/scrub transport. It contains
 * no codec: no pitch estimation, no voicing decision, no spectral-amplitude
 * estimation, no quantizer, no bit packing, no synthesis. Per-animation
 * modules registered here are held to the same rule.
 *
 * MIT licensed (see LICENSE-MIT). Site prose is CC BY 4.0 separately.
 */

(function (global) {
  "use strict";

  const registry = new Map();
  const dataCache = new Map();

  /** Fetch and memoize a precomputed dataset from docs/assets/data/. */
  async function loadData(url) {
    if (!dataCache.has(url)) {
      dataCache.set(
        url,
        fetch(url).then((r) => {
          if (!r.ok) throw new Error("anim-core: cannot load " + url);
          return r.json();
        })
      );
    }
    return dataCache.get(url);
  }

  /** Size a canvas to its CSS box at device pixel ratio; returns the 2D ctx. */
  function fitCanvas(canvas) {
    const dpr = global.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /** Read the site's accent tokens so figures match the page theme. */
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fallback) =>
      (cs.getPropertyValue(name) || "").trim() || fallback;
    return {
      bg: get("--ambe-surface-0", "#0b0b0d"),
      panel: get("--ambe-surface-1", "#141417"),
      hairline: get("--ambe-hairline", "#2b2b32"),
      fg: get("--md-default-fg-color", "#ececf1"),
      muted: get("--md-default-fg-color--lighter", "#75757f"),
      accent: get("--ambe-accent", "#6e8bff"),
      warm: get("--ambe-accent-warm", "#ffb454"),
      cool: get("--ambe-accent-cool", "#35d0ba"),
    };
  }

  /**
   * Register a figure renderer.
   * @param {string} name  matches data-anim="<name>" in the page markup
   * @param {(ctx, el, api) => ({draw: (frameIndex) => void, frames: number})} factory
   */
  function register(name, factory) {
    registry.set(name, factory);
  }

  const prefersReducedMotion =
    global.matchMedia &&
    global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function mount(el) {
    const name = el.dataset.anim;
    const factory = registry.get(name);
    if (!factory) return;

    const canvas = el.querySelector("canvas");
    if (!canvas) return;

    let ctx = fitCanvas(canvas);
    const api = { loadData, palette, fitCanvas };

    Promise.resolve(factory(ctx, el, api)).then((scene) => {
      if (!scene || typeof scene.draw !== "function") return;

      const frames = scene.frames || 1;
      const scrub = el.querySelector('input[type="range"]');
      const button = el.querySelector("button");
      const readout = el.querySelector(".anim-controls__readout");

      let frame = 0;
      let playing = false;
      let raf = null;
      let last = 0;
      const fps = scene.fps || 30;

      if (scrub) {
        scrub.min = "0";
        scrub.max = String(Math.max(0, frames - 1));
        scrub.step = "1";
      }

      function paint() {
        scene.draw(frame);
        if (scrub) scrub.value = String(frame);
        if (readout) readout.textContent = (frame / fps).toFixed(2) + "s";
      }

      function tick(now) {
        if (!playing) return;
        if (now - last >= 1000 / fps) {
          last = now;
          frame = (frame + 1) % frames;
          paint();
        }
        raf = global.requestAnimationFrame(tick);
      }

      function setPlaying(next) {
        playing = next;
        if (button) button.textContent = playing ? "Pause" : "Play";
        if (playing) {
          last = 0;
          raf = global.requestAnimationFrame(tick);
        } else if (raf) {
          global.cancelAnimationFrame(raf);
          raf = null;
        }
      }

      if (button) button.addEventListener("click", () => setPlaying(!playing));
      if (scrub) {
        scrub.addEventListener("input", () => {
          setPlaying(false);
          frame = Number(scrub.value);
          paint();
        });
      }

      global.addEventListener("resize", () => {
        ctx = fitCanvas(canvas);
        scene.resize && scene.resize(ctx);
        paint();
      });

      // Only animate while on screen, and never auto-play under
      // prefers-reduced-motion.
      if (!prefersReducedMotion && frames > 1 && global.IntersectionObserver) {
        new global.IntersectionObserver(
          (entries) => {
            for (const e of entries) setPlaying(e.isIntersecting);
          },
          { threshold: 0.35 }
        ).observe(el);
      }

      paint();
    });
  }

  function mountAll() {
    document.querySelectorAll("[data-anim]").forEach(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }

  // navigation.instant swaps content without a page load.
  if (global.document$ && typeof global.document$.subscribe === "function") {
    global.document$.subscribe(mountAll);
  }

  global.AnimCore = { register, loadData, palette, fitCanvas, mountAll };
})(window);
