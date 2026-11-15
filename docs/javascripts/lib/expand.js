// @ts-check
/* ===========================================================================
 * lib/expand.js: a figure's Expand button (lib/view-switch.js makes it).
 * ---------------------------------------------------------------------------
 * Expand puts the whole figure (title, frame, controls, step text and
 * caption) in full screen with the Fullscreen API, so the controls and the
 * steps stay with the picture. Where an element cannot go full screen (iOS
 * Safari on a phone), the figure is laid over the page instead: fixed to
 * the viewport, with the page under it held still.
 *
 * Expanded, an "Exit full screen" button stays in the screen's top right
 * corner while the figure scrolls under it, and takes the focus; Escape
 * and that button leave, the focus returns to Expand and the page is where
 * the reader left it. The page under the figure is inert, so the keyboard
 * and a screen reader stay in the figure, and Tab wraps at its ends.
 *
 * The picture comes first: the view frame (`.anim-figure__frame--view`,
 * else the first frame, or the frame a 3D view is laid over part of),
 * marked `.anim-figure__frame--full` while expanded, takes the screen's
 * height less what stands above it in the figure (the title, a strip or a
 * second frame) and a peek of what follows (PEEK), so the reader sees
 * there is more below. It is never taller than its own aspect in the page
 * allows at the new width, and never shorter than it was in the page
 * unless the screen is. The step text, the
 * controls and the readouts follow below it; the figure scrolls. The 2D
 * canvas and the 3D renderer follow the frame through their own
 * ResizeObservers (anim-core.js setupCanvas, anim-three.js). The 3D view
 * stays one view: no context is made or given up.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** The page lock while a figure is laid over it (anim.css). */
const LOCKED = "anim-locked";
/**
 * On <html> while a figure is expanded: no scroll anchoring (anim.css).
 * The browser keeps the page's place by a node it picks, often one inside
 * the figure; when the figure leaves the flow that node moves, and the
 * page scrolled after it, 1800 px on chapter 1, bringing other figures
 * into view under the expanded one.
 */
const STILL = "anim-still";
/** Frames the page is held in place after the figure comes back. */
const KEEP_FRAMES = 30;
/** What shows of the figure below the frame, in rem: about a row. */
const PEEK = 2.75;
/** What the keyboard can reach, before the checks in reachable(). */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * @typedef {Document & {
 *   webkitFullscreenElement?: Element | null,
 *   webkitFullscreenEnabled?: boolean,
 *   webkitExitFullscreen?: () => void,
 * }} FullDocument
 */

/**
 * The elements Tab reaches in `root`, in order.
 * @param {HTMLElement} root
 * @returns {HTMLElement[]}
 */
function reachable(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    /** @returns {el is HTMLElement} */
    (el) =>
      el instanceof HTMLElement &&
      el.tabIndex >= 0 &&
      !(/** @type {HTMLButtonElement} */ (el).disabled) &&
      !el.closest("[inert]") &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden"
  );
}

/**
 * @param {{figure: HTMLElement, button: HTMLButtonElement, signal: AbortSignal}} opts
 * @returns {void}
 */
export function createExpand({ figure, button, signal }) {
  const doc = /** @type {FullDocument} */ (document);
  const el = /** @type {HTMLElement & {webkitRequestFullscreen?: () => void}} */ (figure);
  const native = () =>
    Boolean(doc.fullscreenEnabled && typeof el.requestFullscreen === "function") ||
    Boolean(doc.webkitFullscreenEnabled && typeof el.webkitRequestFullscreen === "function");
  const fullElement = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  /**
   * The frame that takes the height: the view frame, or, where the 3D view
   * is laid over part of a larger frame (frames, ch08), that frame.
   * @returns {HTMLElement | null}
   */
  const frame = () => {
    const view = figure.querySelector(".anim-figure__frame--view") ?? figure.querySelector(".anim-figure__frame");
    if (!(view instanceof HTMLElement)) return null;
    if (getComputedStyle(view).position !== "absolute") return view;
    const under = view.parentElement?.closest(".anim-figure__frame");
    return under instanceof HTMLElement ? under : view;
  };
  /** The frame fit() sizes, marked for anim.css. @type {HTMLElement | null} */
  let sized = null;

  // The one way out while expanded, first in the figure's tab order.
  const close = document.createElement("button");
  close.type = "button";
  close.className = "anim-btn anim-figure__close";
  close.textContent = "Exit full screen";
  close.hidden = true;
  figure.prepend(close);

  let overlay = false;
  let full = false;
  /**
   * Holds the figure's place in the page while it is expanded. A figure in
   * full screen or laid over the page leaves the flow; without this the
   * page below would close up, and a figure further down would come into
   * view under it and open a 3D view of its own.
   * @type {HTMLElement | null}
   */
  let placeholder = null;
  /** Where the page was when the reader expanded. */
  let place = { x: 0, y: 0 };
  /** The elements this figure made inert, to give back. @type {HTMLElement[]} */
  let shut = [];

  const hold = () => {
    document.documentElement.classList.add(STILL);
    if (placeholder) return;
    place = { x: window.scrollX, y: window.scrollY };
    placeholder = document.createElement("div");
    placeholder.className = "anim-figure__placeholder";
    placeholder.style.height = `${figure.offsetHeight}px`;
    placeholder.style.margin = getComputedStyle(figure).margin;
    figure.before(placeholder);
  };
  /** Back where the reader was. */
  const restore = () => {
    if (window.scrollX !== place.x || window.scrollY !== place.y) {
      window.scrollTo({ left: place.x, top: place.y, behavior: "instant" });
    }
  };
  /**
   * Leaving full screen can move the page some frames later, by itself:
   * Chromium took ch02's page to the top (no script scroll, not scroll
   * anchoring). The page is held where the reader left it for KEEP_FRAMES
   * frames, unless the reader moves it.
   */
  const keep = () => {
    const stop = new AbortController();
    const quit = () => stop.abort();
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      window.addEventListener(type, quit, { capture: true, once: true, signal: stop.signal });
    }
    // Scroll events run before the frame is painted: the move never shows.
    window.addEventListener("scroll", restore, { signal: stop.signal });
    let left = KEEP_FRAMES;
    const tick = () => {
      if (stop.signal.aborted || placeholder) return stop.abort();
      if (left === KEEP_FRAMES) document.documentElement.classList.remove(STILL);
      restore();
      left -= 1;
      if (left > 0) requestAnimationFrame(tick);
      else stop.abort();
    };
    requestAnimationFrame(tick);
  };
  const release = () => {
    if (!placeholder) return;
    placeholder.remove();
    placeholder = null;
    restore();
    keep();
  };

  /** Everything outside the figure goes inert: siblings up to <body>. */
  const shutPage = () => {
    for (let node = /** @type {Element} */ (figure); node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
        sibling.inert = true;
        shut.push(sibling);
      }
    }
  };
  const openPage = () => {
    for (const sibling of shut) sibling.inert = false;
    shut = [];
  };

  let fitId = 0;
  /** The view frame's size in the page, taken as the reader expands. */
  let inPage = { w: 0, h: 0 };

  const expanded = () => overlay || fullElement() === figure;

  /** The frame's height: the picture first, a peek of the rest. */
  const fit = () => {
    fitId = 0;
    const view = sized;
    if (!full || !view) return;
    const box = figure.getBoundingClientRect();
    const style = getComputedStyle(figure);
    const inner = figure.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const contentTop = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) - figure.scrollTop;
    const at = view.getBoundingClientRect();
    // What stands above the frame, and below it in the same child of the
    // figure (a frame inside a scroll wrapper, a strip under it).
    const above = at.top - contentTop;
    let stage = /** @type {Element} */ (view);
    while (stage.parentElement && stage.parentElement !== figure) stage = stage.parentElement;
    const under = Math.max(0, stage.getBoundingClientRect().bottom - at.bottom);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const room = inner - above - under;
    const shaped = inPage.h > 0 ? at.width * (inPage.h / inPage.w) : room;
    const height = Math.floor(Math.max(Math.min(room - PEEK * rem, shaped), Math.min(inPage.h, room)));
    const value = `${height}px`;
    if (figure.style.getPropertyValue("--anim-full-h") !== value) figure.style.setProperty("--anim-full-h", value);
  };
  const refit = () => {
    if (!fitId) fitId = requestAnimationFrame(fit);
  };
  // The parts above the frame change height as the reader steps.
  // Measured in the next frame, never inside the observer's own callback.
  const parts = new ResizeObserver(refit);

  /** @param {KeyboardEvent} event */
  const wrap = (event) => {
    if (event.key !== "Tab") return;
    const stops = reachable(figure);
    if (!stops.length) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !figure.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !figure.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  /** Show the state: classes, the exit control, the frame's height. */
  const show = () => {
    const now = expanded();
    if (now === full) return;
    full = now;
    figure.classList.toggle("is-full", full);
    figure.classList.toggle("is-overlay", overlay);
    close.hidden = !full;
    if (full) {
      for (const child of figure.children) parts.observe(child);
      window.addEventListener("resize", refit);
      figure.addEventListener("keydown", wrap);
      shutPage();
      sized = frame();
      sized?.classList.add("anim-figure__frame--full");
      fit();
      close.focus({ preventScroll: true });
    } else {
      parts.disconnect();
      window.removeEventListener("resize", refit);
      figure.removeEventListener("keydown", wrap);
      cancelAnimationFrame(fitId);
      fitId = 0;
      figure.style.removeProperty("--anim-full-h");
      sized?.classList.remove("anim-figure__frame--full");
      sized = null;
      openPage();
      release();
      button.focus({ preventScroll: true });
    }
  };

  const openOverlay = () => {
    hold();
    overlay = true;
    document.documentElement.classList.add(LOCKED);
    show();
  };
  const closeOverlay = () => {
    overlay = false;
    document.documentElement.classList.remove(LOCKED);
    figure.classList.remove("is-overlay");
    show();
  };

  const enter = async () => {
    const at = frame()?.getBoundingClientRect();
    inPage = { w: at?.width ?? 0, h: at?.height ?? 0 };
    hold();
    if (native()) {
      try {
        if (typeof el.requestFullscreen === "function") await el.requestFullscreen({ navigationUI: "hide" });
        else el.webkitRequestFullscreen?.();
        // WebKit's prefixed call returns nothing and may refuse quietly.
        if (!expanded()) setTimeout(() => { if (!expanded()) release(); }, 1000);
        return;
      } catch (error) {
        // Refused (no user activation, a frame without the permission):
        // lay the figure over the page instead.
      }
    }
    openOverlay();
  };
  const leave = () => {
    if (overlay) {
      closeOverlay();
      return;
    }
    if (fullElement() !== figure) return;
    if (typeof doc.exitFullscreen === "function") doc.exitFullscreen().catch(() => {});
    else doc.webkitExitFullscreen?.();
  };

  button.addEventListener("click", () => {
    if (expanded()) leave();
    else void enter();
  }, { signal });
  close.addEventListener("click", leave, { signal });
  for (const type of ["fullscreenchange", "webkitfullscreenchange"]) {
    document.addEventListener(type, show, { signal });
  }
  // The browser leaves full screen on Escape by itself; the overlay, and a
  // page given the key first, need it said.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !full) return;
    leave();
  }, { signal });

  signal.addEventListener("abort", () => {
    if (overlay) closeOverlay();
    else if (fullElement() === figure) leave();
    openPage();
    release();
    parts.disconnect();
    window.removeEventListener("resize", refit);
    figure.removeEventListener("keydown", wrap);
    cancelAnimationFrame(fitId);
    close.remove();
  }, { once: true });
}
