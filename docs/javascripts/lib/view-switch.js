// @ts-check
/* ===========================================================================
 * lib/view-switch.js: the 2D side of a figure's 3D view (design §3.4).
 * ---------------------------------------------------------------------------
 * A figure's 2D module holds its view switch here and never imports
 * anim-three.js; its 3D part, anim-<slug>-3d.js, loads through `load` only
 * when a 3D view is wanted and the frame is near. The switch holds what
 * each shipped figure wrote for itself:
 *
 *   - the opening rule (owner decision O1): it opens 3D, with the figure's
 *     explanatory animation once per page load, when opensIn3D() is true
 *     and the frame comes within KEEP_MARGIN; otherwise it stays in 2D
 *     and loads nothing 3D until the reader presses the 3D control;
 *   - without WebGL 2 the control is disabled, with the hint, from the
 *     start (no3d());
 *   - the 2D canvas stays up until the 3D view has drawn once, and comes
 *     back while the view is parked (anim-three.js header item 4);
 *   - pressing the control while the view loads cancels it, and leaving 3D
 *     closes the view and releases its context;
 *   - headOn (bits, fec-protection) locks the view to its Front preset.
 *
 * The visual-language options (stage, zoom, fog) are passed on to every
 * 3D part as `look`.
 *
 * The switch also gives the figure its view row (viewRow() below): the
 * Camera group and a slot the Zoom group fills (lib/orbit.js). The row
 * shows only in 3D (anim.css), so a figure read in 2D has no empty row
 * under its controls; opening 3D adds the row and moves what follows down
 * by its height. The Expand button (lib/expand.js) goes at the end of the
 * figure's controls row, on the same line as its other buttons, and stays
 * in the view row only when the figure has no controls row.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  KEEP_MARGIN,
  NO_WEBGL_HINT,
  notePlayed,
  onEnhance,
  opensIn3D,
  prefersReducedMotion,
  supportsWebGL2,
} from "../anim-core.js";
import { createExpand } from "./expand.js";

/**
 * Stand-ins for the Zoom group's buttons and readout, as lib/orbit.js
 * builds them, for the slot that holds its room until a 3D view brings the
 * real one. Spans, not buttons: never read, never reached, never found by
 * a query for the real controls.
 */
const ZOOM_SLOT_HTML =
  `<span class="anim-btn">Zoom out</span>` +
  `<span class="anim-zoom__readout">1.0×</span>` +
  `<span class="anim-btn">Zoom in</span>` +
  `<span class="anim-btn">Reset view</span>`;

/** A figure's 3D control, by either of the two names the figures use. */
const CONTROL = 'button[data-view="3d"], button[data-ref="view3d"]';

/**
 * Gather the figure's 3D controls into one row under its controls: any
 * group marked data-view-row, the Camera group (with its label, when it
 * has one) and the Zoom slot. The Camera group keeps its own `hidden`
 * toggling. Expand goes at the end of the controls row the 3D controls
 * came from, or in the view row when there is none. Made once per figure:
 * a second call returns the row the first one made.
 * @param {HTMLElement} figure
 * @param {Element | null} toggle  the 3D control
 * @returns {{row: HTMLElement, expand: HTMLButtonElement, made: boolean}}
 */
function viewRow(figure, toggle) {
  const made = figure.querySelector(":scope .anim-view");
  const button = figure.querySelector(".anim-view__expand");
  if (made instanceof HTMLElement && button instanceof HTMLButtonElement) return { row: made, expand: button, made: false };
  const camera = figure.querySelector('[role="group"][aria-label="Camera"]');
  const wrap = camera?.parentElement;
  const unit = wrap?.classList.contains("anim-controls__group") ? wrap : camera;
  const frame = figure.querySelector(".anim-figure__frame");
  const anchor = (unit ?? toggle)?.closest(".anim-controls") ?? frame ?? figure.lastElementChild;
  const row = document.createElement("div");
  row.className = "anim-view";
  const slot = document.createElement("div");
  slot.className = "anim-toggle-group anim-view__slot";
  slot.setAttribute("aria-hidden", "true");
  slot.inert = true;
  slot.innerHTML = ZOOM_SLOT_HTML;
  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "anim-btn anim-view__expand";
  expand.textContent = "Expand";
  if (anchor) anchor.after(row);
  else figure.append(row);
  // Other controls that show only in 3D, marked data-view-row, go first.
  for (const extra of figure.querySelectorAll("[data-view-row]")) row.append(extra);
  if (unit) row.append(unit);
  row.append(slot);
  // A controls row that held only the Camera group goes.
  if (anchor?.classList.contains("anim-controls") && !anchor.children.length) anchor.remove();
  // Expand ends the controls row, else the last controls row above the
  // view row, else it stays in the view row.
  const rows = Array.from(figure.querySelectorAll(".anim-controls")).filter((r) => r.isConnected && !row.contains(r) &&
    (r.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING));
  const home = anchor?.isConnected && anchor.classList.contains("anim-controls") ? anchor : rows.at(-1);
  (home ?? row).append(expand);
  return { row, expand, made: true };
}

/**
 * Give a figure with a 3D control its view row and the Expand button,
 * once, before its first paint (markEnhanced()).
 * @param {HTMLElement} figure
 * @param {Element | null} toggle
 * @param {AbortSignal} signal
 * @returns {{row: HTMLElement, expand: HTMLButtonElement}}
 */
function furnish(figure, toggle, signal) {
  const room = viewRow(figure, toggle);
  if (room.made) createExpand({ figure, button: room.expand, signal });
  return room;
}

onEnhance((host, signal) => {
  const figure = host.querySelector(".anim-figure");
  const toggle = figure?.querySelector(CONTROL) ?? null;
  if (figure instanceof HTMLElement && (toggle || figure.querySelector('[aria-label="Camera"]'))) {
    furnish(figure, toggle, signal);
  }
});

/**
 * What a 3D part's open3D() resolves to.
 * @typedef {Object} View3D
 * @property {(state: unknown) => void} update  redraw from the 2D module's state
 * @property {(name: string) => void} preset  move to a named camera preset
 * @property {() => string} describe  the sentence for the 3D canvas's label
 * @property {() => void} close  dispose the view and release its context
 */

/**
 * @typedef {Object} Open3DOptions
 * @property {AbortSignal} signal  aborted when the figure unmounts
 * @property {unknown} state  the 2D module's state now
 * @property {() => boolean} wanted  false once the reader has left 3D
 * @property {boolean} intro  play the explanatory animation (first view
 *           only, never under reduced motion; an unpark never asks)
 * @property {boolean} headOn  Front only: no yaw drag, no other presets
 * @property {{stage: boolean, zoom: boolean, fog: boolean}} look
 * @property {() => void} onPark  pass to mountThree
 * @property {() => void} onUnpark  pass to mountThree
 * @property {() => void} [onDrag]
 */

/**
 * The export every anim-<slug>-3d.js provides. Resolves null when 3D is
 * not available, otherwise once the view has drawn (ctx.drawn()).
 * @typedef {(frame: HTMLElement, opts: Open3DOptions) => Promise<View3D | null>} Open3D
 */

/**
 * @typedef {Object} ViewSwitchOptions
 * @property {HTMLElement} frame  the `.anim-figure__frame`
 * @property {HTMLElement | null} flat  the 2D canvas; null when the poster
 *           image is the 2D path
 * @property {HTMLButtonElement} toggle  the 3D control (aria-pressed)
 * @property {HTMLElement} hint  the `.anim-figure__hint--webgl` element
 * @property {AbortSignal} signal  the figure's mount signal
 * @property {() => unknown} state  the 2D module's state now
 * @property {() => Promise<{open3D: Open3D}>} load  `() => import("./anim-<slug>-3d.js")`
 * @property {"auto" | "2d"} [start="auto"]  "auto" follows the opening rule
 * @property {(view: "2d" | "3d" | "parked") => void} [onView]  the view
 *           changed; on "2d" and "parked" redraw the 2D canvas
 * @property {boolean} [headOn=false]
 * @property {string} [id]  the figure's id for TEST_HOOK.played (its slug,
 *           or slug and host index when a page has several)
 * @property {() => void} [onDrag]
 */

/**
 * @typedef {Object} ViewSwitch
 * @property {() => "2d" | "3d" | "loading" | "parked"} view
 * @property {() => Promise<void>} show3D  ask for 3D (a step or the control)
 * @property {() => void} show2D  leave 3D
 * @property {(state: unknown) => void} update  pass the state to the 3D view
 * @property {(name: string) => boolean} preset  false when refused
 *           (headOn allows only "front") or when no 3D view is up
 * @property {() => string} describe  the 3D view's sentence, or ""
 * @property {() => boolean} available  false once 3D is known not to work
 */

/** Frames whose first-view animation has been asked for, this page load. */
/** @type {WeakSet<HTMLElement>} */
const played = new WeakSet();

/**
 * Resolve true once `frame` is within KEEP_MARGIN of the viewport, false
 * if `signal` aborts first.
 * @param {HTMLElement} frame
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>}
 */
function whenNear(frame, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        resolve(true);
      },
      { rootMargin: KEEP_MARGIN }
    );
    observer.observe(frame);
    signal.addEventListener("abort", () => {
      observer.disconnect();
      resolve(false);
    }, { once: true });
  });
}

/**
 * @param {ViewSwitchOptions} opts
 * @returns {ViewSwitch}
 */
export function createViewSwitch(opts) {
  const { frame, flat, toggle, hint, signal, state, load, onView, onDrag } = opts;
  const hostEl = frame.closest("[data-anim]");
  const hostMode = hostEl instanceof HTMLElement ? hostEl.dataset.mode : undefined;
  const {
    start: rawStart = "auto",
    headOn = false,
    id = hostEl?.getAttribute("data-anim") ?? "figure",
  } = opts;
  const start = hostMode === "2d" ? "2d" : hostMode === "3d" ? "auto" : rawStart;
  if (hostMode === "2d" || hostMode === "3d") {
    toggle.hidden = true;
  }
  /** @type {View3D | null} */
  let view = null;
  let wants = false;
  let parked = false;
  let usable = true;
  let generation = 0;
  /** Aborted when the reader leaves 3D, so a pending wait gives up. */
  let leaving = new AbortController();

  const figure = frame.closest(".anim-figure");
  const room = figure instanceof HTMLElement ? furnish(figure, toggle, signal) : null;
  // The frame Expand gives the height to (lib/expand.js).
  frame.classList.add("anim-figure__frame--view");

  /** @param {boolean} on */
  const press = (on) => toggle.setAttribute("aria-pressed", String(on));
  /** @param {"2d" | "3d" | "parked"} next */
  const tell = (next) => {
    try {
      onView?.(next);
    } catch (error) {
      console.error("view-switch: onView failed", error);
    }
  };

  /** Without WebGL 2 the 3D control is disabled, with the hint beside it. */
  const no3d = () => {
    usable = false;
    toggle.disabled = true;
    press(false);
    hint.textContent = NO_WEBGL_HINT;
    hint.hidden = false;
    // No 3D controls will come: the row gives their room back.
    room?.row.setAttribute("data-no3d", "");
  };

  const show2D = () => {
    const had = wants || view !== null;
    wants = false;
    generation += 1;
    leaving.abort();
    leaving = new AbortController();
    view?.close();
    view = null;
    parked = false;
    press(false);
    if (flat) flat.hidden = false;
    if (had) tell("2d");
  };

  const show3D = async () => {
    if (!usable || wants) return;
    wants = true;
    press(true);
    const mine = (generation += 1);
    const current = () => mine === generation && wants && !signal.aborted;
    // Either the figure unmounting or the reader leaving 3D ends the wait.
    const waits = new AbortController();
    const stop = () => waits.abort();
    for (const s of [signal, leaving.signal]) s.addEventListener("abort", stop, { once: true, signal: waits.signal });
    const near = await whenNear(frame, waits.signal);
    waits.abort(); // drops the two listeners above
    if (!near || !current()) return;
    // Marked while the part loads and opens (the tests' settle() waits on it).
    frame.dataset.three = "loading";
    const done = () => {
      if (frame.dataset.three === "loading") delete frame.dataset.three;
    };
    /** @type {{open3D: Open3D}} */
    let part;
    try {
      part = await load();
    } catch (error) {
      console.error("view-switch: the 3D part failed to load", error);
      done();
      if (current()) {
        wants = false;
        press(false);
      }
      return;
    }
    if (!current()) return done();
    const intro = !played.has(frame) && !prefersReducedMotion();
    const opened = await part.open3D(frame, {
      signal,
      state: state(),
      wanted: current,
      intro,
      headOn,
      look: { stage: true, zoom: true, fog: true },
      onPark: () => {
        parked = true;
        if (flat) flat.hidden = false;
        tell("parked");
      },
      onUnpark: () => {
        parked = false;
        if (flat) flat.hidden = true;
        tell("3d");
      },
      onDrag,
    });
    done();
    if (!current()) {
      opened?.close();
      return;
    }
    if (!opened) {
      wants = false;
      no3d();
      return;
    }
    view = opened;
    if (intro) {
      played.add(frame);
      notePlayed(id);
    }
    if (flat) flat.hidden = true;
    tell("3d");
  };

  toggle.addEventListener("click", () => {
    if (wants) show2D();
    else void show3D();
  }, { signal });
  signal.addEventListener("abort", () => {
    view?.close();
    view = null;
  }, { once: true });

  // Probed once per session: a browser without WebGL 2 sees the 3D control
  // disabled from the start, not after a step or a press asks for it.
  if (hostMode === "2d") {
    room?.row.setAttribute("data-no3d", "");
  } else if (!supportsWebGL2()) {
    no3d();
  } else if (start === "auto" && (hostMode === "3d" || opensIn3D())) {
    void show3D();
  }

  return {
    view: () => (view ? (parked ? "parked" : "3d") : wants ? "loading" : "2d"),
    show3D,
    show2D,
    update: (next) => view?.update(next),
    preset: (name) => {
      if (!view || (headOn && name !== "front")) return false;
      view.preset(name);
      return true;
    },
    describe: () => view?.describe() ?? "",
    available: () => usable,
  };
}
