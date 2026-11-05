// @ts-check
/* ===========================================================================
 * anim-three.js: the 3D view of a figure, on three.js. The only module that
 * imports three.
 * ---------------------------------------------------------------------------
 * Every figure that has a 3D view keeps a 2D or static view as well, and
 * mountThree() returns null whenever 3D is not available, so the figure
 * stays usable without it. Lifecycle (design §3.4, three-everywhere §3.3):
 *
 *   1. Nothing touches the GPU until the figure asks for 3D and its frame is
 *      within KEEP_MARGIN (one viewport height) of the viewport. Figures
 *      open in 3D when opensIn3D() is true; a figure asks for its context
 *      only when it comes within KEEP_MARGIN.
 *   2. WebGL 2 is probed once per session (instant navigation keeps this
 *      module), with failIfMajorPerformanceCaveat. ?nowebgl forces a failure
 *      for tests. The probe lives in anim-core.js.
 *   3. three is imported on first use, from docs/javascripts/vendor/three/,
 *      with its line addons (vendor/three/addons/), which ctx.lines holds.
 *   4. One WebGLRenderer per figure, never shared. At most MAX_LIVE hold a
 *      context at once, page-wide. Past that, the live view that has been
 *      out of KEEP_MARGIN longest is parked (its context lost on purpose)
 *      and restored, with build() run again, when it comes back within
 *      KEEP_MARGIN. A visible view is never parked. Unlit materials only
 *      (lib/style.js has the look: thick lines, fills, floor, fog).
 *      WebKit counts a lost context until it is collected (P0 spike,
 *      three-cap.spec.js), so lost canvases are pooled and restored before
 *      a new context is made.
 *   5. Frames are drawn on request, one per animation frame at most, only
 *      while the frame is on screen and the tab is visible. Nothing loops:
 *      animation runs on ctx.timeline() (design §6), whose one loop per
 *      view runs only while a track runs. Any reader input on the frame,
 *      the frame falling below 25% visible, a hidden tab, a park and
 *      TEST_HOOK.finishAll() jump every running track to its end; a build
 *      track waits until the frame is half visible; under reduced motion
 *      every track lands on its end in one render.
 *   6. Size and pixel ratio follow the frame; the ratio is capped at 2, and
 *      the context is antialiased at every ratio. Thick lines (LineMaterial)
 *      take the frame's size as their resolution on every resize.
 *   7. Colours come from theme tokens through paint(), and follow a scheme
 *      change, and print starting or ending (print takes the light tokens).
 *      `stage: true` puts the stage gradient behind the canvas while the
 *      view is live. Every 3D canvas is a tab stop with the focus ring;
 *      lib/orbit.js adds zoom.
 *   8. A lost context pauses the view behind a resume button and frees its
 *      slot; resuming takes a slot again, and a restored context runs
 *      build() again, so build() must hold all scene construction.
 *   9. The cleanup (on the mount signal, or dispose()) frees everything and
 *      loses the context, so instant navigation never piles up contexts
 *      against the browser's cap.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  KEEP_MARGIN,
  TEST_HOOK,
  onFinishAll,
  onThemeChange,
  prefersReducedMotion,
  supportsWebGL2,
  tokenColor,
  watchPixelRatio,
} from "./anim-core.js";

// Re-exported for the figures that import them from here (design §3.2 R4).
export { KEEP_MARGIN, NO_WEBGL_HINT, supportsWebGL2 } from "./anim-core.js";

// Types come from @types/three, pinned to the vendored release; tsc only.
/** @typedef {typeof import("three")} THREE */
/** @typedef {import("three").Material & {color: import("three").Color}} ColourMaterial */
/**
 * The vendored line addons (three-visual-language design §3).
 * @typedef {Object} LineKit
 * @property {typeof import("three/addons/lines/LineMaterial.js").LineMaterial} LineMaterial
 * @property {typeof import("three/addons/lines/LineSegments2.js").LineSegments2} LineSegments2
 * @property {typeof import("three/addons/lines/LineSegmentsGeometry.js").LineSegmentsGeometry} LineSegmentsGeometry
 */

/**
 * @typedef {Object} ThreeContext
 * @property {THREE} three
 * @property {LineKit} lines  thick lines (lib/style.js fatLines)
 * @property {import("three").WebGLRenderer} renderer  the current renderer;
 *           a parked view gets a new one (and a new canvas) when it unparks
 * @property {import("three").Scene} scene
 * @property {import("three").PerspectiveCamera | import("three").OrthographicCamera} camera
 * @property {HTMLElement} frame  the `.anim-figure__frame` the view sits in
 * @property {boolean} parked  true while the view has given up its context
 * @property {() => void} requestRender  coalesced to one rAF, visibility-gated
 * @property {(fit: () => void) => () => void} onResize  runs `fit` after
 *           each resize has set the camera's default frustum, before the
 *           frame is drawn (lib/orbit.js matchPlot uses it); returns the
 *           function that stops it
 * @property {() => Promise<void>} drawn  resolves once the scene as built now
 *           has been drawn (at once if it has been)
 * @property {<T extends {dispose(): void}>(o: T) => T} track  disposed on cleanup
 * @property {(name: string) => import("./anim-core.js").TokenColor} token
 * @property {<M extends ColourMaterial>(material: M, name: string) => M} paint
 *           colour a material from a token, now and on every theme change.
 *           An object whose colours are not one material's (vertex colours)
 *           sets `userData.recolour`, which runs on every theme change
 * @property {(ms: number, step: (t: number) => void) => Promise<void>} animate
 *           a tween from t = 0 to 1 (linear; the caller eases); one call with
 *           t = 1 under reduced motion or while parked. One track ("animate")
 *           of the view's own timeline, so a second call settles the first
 * @property {() => Timeline} timeline  named tracks in parallel (design §6)
 * @property {() => void} finish  every track of every timeline of the view
 *           to its end (a step change or preset calls it first)
 * @property {() => void} dispose  release the context now (leaving 3D)
 * @property {AbortSignal} signal  the figure's mount signal
 * @property {AbortSignal} viewSignal  aborted when this view ends (leaving
 *           3D, a failed build, or the figure unmounting): listeners and
 *           controls that belong to the view go with it
 */

/**
 * @typedef {Object} TrackOptions
 * @property {number} ms  how long one item runs
 * @property {(t: number, i: number) => void} step  eased t from 0 to 1, and
 *           the item (0 without `count`); always ends with t = 1
 * @property {"ease" | "inout" | "linear"} [ease="ease"]  --ambe-ease (builds,
 *           pulses), --ambe-ease-inout (the camera), or linear (values
 *           that follow time)
 * @property {number} [delay=0]  ms before the first item starts
 * @property {number} [count=1]  items, each `stagger` ms after the last
 * @property {number} [stagger=0]  capped so all items start within 600 ms
 * @property {boolean} [build=false]  wait until the frame is half visible
 */

/**
 * @typedef {Object} Timeline
 * @property {(name: string, opts: TrackOptions) => Promise<void>} play
 *           start a track; a track of the same name still running lands on
 *           its end first. Resolves when the track ends, however it ends
 * @property {() => void} finish  this timeline's tracks to their ends
 * @property {() => Promise<void>} done  resolves once no track of this
 *           timeline is running
 */

/**
 * @typedef {Object} ThreeOptions
 * @property {AbortSignal} signal  the figure's mount signal
 * @property {string} label        aria-label for the 3D canvas
 * @property {(ctx: ThreeContext) => void} build  adds everything to the scene;
 *           runs again after a context restore and after an unpark
 * @property {"perspective" | "orthographic"} [camera="perspective"]
 * @property {boolean} [stage=false]  the stage gradient and glow behind the
 *           canvas (anim.css), while the view is live
 * @property {() => boolean} [wanted]  asked after each wait while the view
 *           starts; false (the reader has left 3D) drops the request and
 *           resolves null, so a view turned off while loading never opens
 * @property {() => void} [onPark]  the view has given up its context; show
 *           the 2D view, drawn from the current state
 * @property {() => void} [onUnpark]  the view has its context back and has
 *           drawn once, at the pose and zoom it had; hide the 2D view
 */

const MAX_PIXEL_RATIO = 2;

/**
 * A duration token in ms: duration("3d-camera") reads --ambe-dur-3d-camera.
 * @param {string} name
 * @returns {number}
 */
export function duration(name) {
  const value = getComputedStyle(document.body).getPropertyValue(`--ambe-dur-${name}`).trim();
  const n = parseFloat(value);
  return Number.isFinite(n) ? (value.endsWith("ms") ? n : n * 1000) : 0;
}

/** Easing functions by token value. @type {Map<string, (t: number) => number>} */
const easings = new Map();

/**
 * The easing a track names, from its token's cubic-bezier(): x(u) is
 * solved for u by Newton's method, with bisection when the slope is flat.
 * @param {"ease" | "inout" | "linear"} name
 * @returns {(t: number) => number}
 */
function easing(name) {
  if (name === "linear") return (t) => t;
  const value = getComputedStyle(document.body).getPropertyValue(name === "inout" ? "--ambe-ease-inout" : "--ambe-ease").trim();
  let ease = easings.get(value);
  if (ease) return ease;
  const [x1, y1, x2, y2] = (value.match(/-?[\d.]+/g) ?? ["0", "0", "1", "1"]).map(Number);
  /** @param {number} a @param {number} b @param {number} u one coordinate of the curve */
  const at = (a, b, u) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  ease = (t) => {
    if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1;
    let u = t;
    for (let i = 0; i < 8; i += 1) {
      const slope = 3 * x1 * (1 - u) ** 2 + 6 * (x2 - x1) * u * (1 - u) + 3 * (1 - x2) * u * u;
      if (Math.abs(slope) < 1e-6) break;
      u -= (at(x1, x2, u) - t) / slope;
    }
    if (!(u >= 0 && u <= 1) || Math.abs(at(x1, x2, u) - t) > 1e-4) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i += 1) {
        u = (lo + hi) / 2;
        if (at(x1, x2, u) < t) lo = u;
        else hi = u;
      }
    }
    return at(y1, y2, u);
  };
  easings.set(value, ease);
  return ease;
}

/**
 * Live contexts allowed at once, page-wide (design §3.2 R2). ?three-cap=N
 * overrides it, on localhost only, for the tests.
 */
export const MAX_LIVE = (() => {
  const asked = TEST_HOOK ? Number(new URLSearchParams(location.search).get("three-cap")) : 0;
  return Number.isInteger(asked) && asked > 0 ? asked : 3;
})();
if (TEST_HOOK) TEST_HOOK.cap = MAX_LIVE;

/* ---------------------------------------------------------------------------
 * Slots: who holds a context (design §3.3)
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} Slot
 * @property {boolean} near      within KEEP_MARGIN now
 * @property {number} lastNear   when it was last within KEEP_MARGIN
 * @property {boolean} busy      starting or unparking; never a victim
 * @property {() => void} park   give up the context (the slot is taken from
 *           it by the caller)
 * @property {((granted: boolean) => void) | null} grant  set while queued
 */

/** @type {Set<Slot>} */
const live = new Set();
/** @type {Slot[]} */
const queue = [];

/** The live view out of KEEP_MARGIN longest, or null. @returns {Slot | null} */
function victim() {
  /** @type {Slot | null} */
  let best = null;
  for (const slot of live) {
    if (slot.near || slot.busy) continue;
    if (!best || slot.lastNear < best.lastNear) best = slot;
  }
  return best;
}

/**
 * Take a slot: at once if one is free, by parking a victim if there is
 * one, or else after the requests ahead of it in the queue. Resolves false
 * if the request is withdrawn (release()) before a slot comes free.
 * @param {Slot} slot
 * @returns {Promise<boolean>}
 */
function acquire(slot) {
  if (live.has(slot)) return Promise.resolve(true);
  if (live.size >= MAX_LIVE) {
    const parked = victim();
    if (parked) {
      live.delete(parked);
      parked.park();
    }
  }
  if (live.size < MAX_LIVE) {
    live.add(slot);
    return Promise.resolve(true);
  }
  if (TEST_HOOK) TEST_HOOK.waits += 1;
  return new Promise((resolve) => {
    slot.grant = (granted) => {
      slot.grant = null;
      if (granted) live.add(slot);
      resolve(granted);
    };
    queue.push(slot);
  });
}

/**
 * Take a slot only if one is free now or a victim can be parked for it;
 * never queue. For a context the browser restored by itself.
 * @param {Slot} slot
 * @returns {boolean}
 */
function acquireNow(slot) {
  if (live.has(slot)) return true;
  if (live.size >= MAX_LIVE) {
    const parked = victim();
    if (!parked) return false;
    live.delete(parked);
    parked.park();
  }
  live.add(slot);
  return true;
}

/** Give a slot back, or leave the queue; the queue's head takes it. @param {Slot} slot */
function release(slot) {
  const waiting = queue.indexOf(slot);
  if (waiting >= 0) {
    queue.splice(waiting, 1);
    slot.grant?.(false);
  }
  if (!live.delete(slot)) return;
  queue.shift()?.grant?.(true);
}

/** A live view has left KEEP_MARGIN: park for whoever waits. */
function serveQueue() {
  while (queue.length && live.size >= MAX_LIVE) {
    const parked = victim();
    if (!parked) return;
    live.delete(parked);
    parked.park();
    queue.shift()?.grant?.(true);
  }
}

/* ---------------------------------------------------------------------------
 * Surfaces: canvases with a context, reused (header item 4)
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} Surface
 * @property {HTMLCanvasElement} canvas
 * @property {WebGL2RenderingContext} gl
 * @property {WEBGL_lose_context | null} ext  held from the start: a lost
 *           context answers getExtension() with null
 * @property {boolean} lostSeen  the last loss's event has been dispatched;
 *           a restore asked for before that is ignored
 */

/** Canvases whose context is lost, ready to be restored. @type {Surface[]} */
const pool = [];

/** How long a pooled context may take to come back before a new one is made. */
const RESTORE_MS = 1000;

/** A pooled surface restored, or a new one. @returns {Promise<Surface | null>} */
async function takeSurface() {
  for (let surface = pool.pop(); surface; surface = pool.pop()) {
    const restored = await restore(surface);
    if (restored) return surface;
  }
  const canvas = document.createElement("canvas");
  /** @type {WebGL2RenderingContext | null} */
  let gl = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      // The highlight kit's glow (lib/highlight.js) draws through the
      // stencil, and a context's attributes are fixed when it is made.
      stencil: true,
      powerPreference: "low-power",
    });
  } catch (error) {
    gl = null;
  }
  if (!gl) return null;
  /** @type {Surface} */
  const surface = { canvas, gl, ext: gl.getExtension("WEBGL_lose_context"), lostSeen: false };
  // Only a loss that was prevented can be restored, so every loss is, for
  // the life of the canvas, whichever view holds it.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    surface.lostSeen = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    surface.lostSeen = false;
  });
  return surface;
}

/** @param {Surface} surface @returns {Promise<boolean>} */
function restore(surface) {
  const { canvas, gl, ext } = surface;
  if (!ext) return Promise.resolve(false);
  if (!gl.isContextLost()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), RESTORE_MS);
    /** @param {boolean} ok */
    const done = (ok) => {
      clearTimeout(timer);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      resolve(ok);
    };
    const onRestored = () => done(true);
    canvas.addEventListener("webglcontextrestored", onRestored);
    // The loss event comes in a task of its own after loseContext(); a
    // restore asked for before it is dropped.
    const ask = () => {
      try {
        ext.restoreContext();
      } catch (error) {
        done(false);
      }
    };
    if (surface.lostSeen) ask();
    else canvas.addEventListener("webglcontextlost", () => setTimeout(ask), { once: true });
  });
}

/** Lose a surface's context, shrink its canvas and pool it. @param {Surface} surface */
function poolSurface(surface) {
  const { canvas, gl, ext } = surface;
  if (!gl.isContextLost()) ext?.loseContext();
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
  canvas.removeAttribute("aria-label");
  canvas.removeAttribute("tabindex");
  if (ext) pool.push(surface);
}

/* ---------------------------------------------------------------------------
 * Loading
 * ------------------------------------------------------------------------ */

/** @type {Promise<[THREE, LineKit]> | null} */
let threeModule = null;

/** three and its line addons, which import three by the same URL. */
/** @returns {Promise<[THREE, LineKit]>} */
function loadThree() {
  /** @param {string} path */
  const load = (path) => import(new URL(`./vendor/three/${path}`, import.meta.url).href);
  threeModule ??= Promise.all([
    load("three.module.min.js"),
    load("addons/LineMaterial.js"),
    load("addons/LineSegments2.js"),
    load("addons/LineSegmentsGeometry.js"),
  ]).then(([three, a, b, c]) => [three, { ...a, ...b, ...c }]);
  threeModule.catch(() => {
    threeModule = null; // let a later request try again
  });
  return threeModule;
}

/**
 * Dispose every geometry, material and texture under `scene`, and empty it.
 * @param {import("three").Object3D} scene
 * @returns {void}
 */
export function disposeScene(scene) {
  scene.traverse((node) => {
    const mesh = /** @type {{geometry?: {dispose(): void}, material?: unknown}} */ (node);
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const m = /** @type {{dispose(): void, map?: {dispose(): void} | null}} */ (material);
      m.map?.dispose();
      m.dispose();
    }
  });
  scene.clear();
}

/**
 * One 3D view per frame, with the `wanted` it was started with.
 * @typedef {{view: Promise<ThreeContext | null>, wanted: () => boolean}} Mounted
 */
/** @type {WeakMap<HTMLElement, Mounted>} */
const views = new WeakMap();

/**
 * Give a figure's frame a 3D view. Calling it again for the same frame
 * returns the same view, unless that view is still starting for a request
 * that is no longer wanted: it will resolve null, so a new one starts.
 * @param {HTMLElement} frame the `.anim-figure__frame`
 * @param {ThreeOptions} opts
 * @returns {Promise<ThreeContext | null>} null: 3D unavailable, or the
 *          request no longer wanted; keep the 2D view
 */
export function mountThree(frame, opts) {
  const existing = views.get(frame);
  if (existing && existing.wanted()) return existing.view;
  const wanted = opts.wanted ?? (() => true);
  /** @type {Mounted | null} */
  let mounted = null;
  // Only this request's entry goes: a newer one may have replaced it.
  const forget = () => {
    if (mounted && views.get(frame) === mounted) views.delete(frame);
  };
  const view = start(frame, { ...opts, wanted }, forget);
  mounted = { view, wanted };
  views.set(frame, mounted);
  view.then((ctx) => {
    if (!ctx) forget();
  }, forget);
  return view;
}

/**
 * @param {HTMLElement} frame
 * @param {ThreeOptions} opts
 * @param {() => void} forget  drops this view from `views` (dispose)
 * @returns {Promise<ThreeContext | null>}
 */
async function start(frame, opts, forget) {
  const { signal, label, build, onPark, onUnpark } = opts;
  const { camera: kind = "perspective", wanted: stillWanted = () => true } = opts;
  if (signal.aborted) return null;

  // Teardown of the waits below; the view's own cleanup takes over once it opens.
  const local = new AbortController();
  const stopWaiting = () => local.abort();
  signal.addEventListener("abort", stopWaiting, { once: true });
  const giveUp = () => {
    signal.removeEventListener("abort", stopWaiting);
    local.abort();
    release(slot);
    return null;
  };

  /** Called by the near observer; set once the view is open. */
  let onNearChange = () => {};
  /** @type {(() => void) | null} */
  let firstNear = null;
  /** @type {Slot} */
  const slot = { near: false, lastNear: 0, busy: true, park: () => park(), grant: null };
  const keep = new IntersectionObserver(
    (entries) => {
      const near = entries.some((entry) => entry.isIntersecting);
      if (near === slot.near) return;
      slot.near = near;
      slot.lastNear = performance.now();
      if (near) firstNear?.();
      onNearChange();
    },
    { rootMargin: KEEP_MARGIN }
  );
  keep.observe(frame);
  local.signal.addEventListener("abort", () => keep.disconnect(), { once: true });

  const near = await new Promise((resolve) => {
    if (local.signal.aborted) return resolve(false);
    firstNear = () => resolve(true);
    local.signal.addEventListener("abort", () => resolve(false), { once: true });
  });
  firstNear = null;
  if (!near || !stillWanted()) return giveUp();
  if (!supportsWebGL2()) return giveUp();
  /** @type {THREE} */
  let THREE;
  /** @type {LineKit} */
  let lines;
  try {
    [THREE, lines] = await loadThree();
  } catch (error) {
    console.error("anim-three: three.js failed to load", error);
    return giveUp();
  }
  if (local.signal.aborted || !stillWanted()) return giveUp();
  local.signal.addEventListener("abort", () => release(slot), { once: true });
  if (!(await acquire(slot)) || local.signal.aborted || !stillWanted()) return giveUp();
  const first = await takeSurface();
  if (!first || local.signal.aborted || !stillWanted()) {
    if (first) poolSurface(first);
    return giveUp();
  }
  // Nothing below waits, so a view that gets past here opens.
  signal.removeEventListener("abort", stopWaiting);

  /** @type {Surface} */
  let surface = first;
  /** @type {import("three").WebGLRenderer | null} */
  let renderer = null;
  let canvas = surface.canvas;
  let ariaLabel = label;
  // Every 3D canvas takes the focus (the zoom keys, the focus ring).
  let tabIndex = 0;

  const scene = new THREE.Scene();
  const camera =
    kind === "orthographic"
      ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
      : new THREE.PerspectiveCamera(40, 1, 0.1, 100);

  const resume = document.createElement("button");
  resume.type = "button";
  resume.className = "anim-btn anim-figure__resume";
  resume.textContent = "Graphics paused. Select to resume.";
  resume.hidden = true;
  frame.append(resume);

  /** @type {Set<{dispose(): void}>} */
  const tracked = new Set();
  /** @type {Map<ColourMaterial, string>} */
  const painted = new Map();
  let visible = false;
  let paused = false;
  let parked = false;
  let disposed = false;
  let wanted = false;
  let frameId = 0;
  /** How much of the frame (or of the viewport, if the frame is taller) shows. */
  let seen = 0;
  /** @type {(() => void)[]} */
  let drawWaiters = [];
  let drawnSinceBuild = false;
  /** The frame's data-state just before a context loss set it to paused. */
  /** @type {string | undefined} */
  let stateBeforeLoss;
  /** Listeners on the current canvas; aborted when the view leaves it. */
  let tenure = new AbortController();

  const draw = () => {
    if (!renderer || parked || paused) return;
    renderer.render(scene, camera);
    if (TEST_HOOK) {
      TEST_HOOK.renders += 1;
      const { calls, triangles } = renderer.info.render;
      const slug = frame.closest("[data-anim]")?.getAttribute("data-anim") ?? "";
      const most = (TEST_HOOK.draws[slug] ??= { calls: 0, triangles: 0 });
      most.calls = Math.max(most.calls, calls);
      most.triangles = Math.max(most.triangles, triangles);
    }
    drawnSinceBuild = true;
    const waiters = drawWaiters;
    drawWaiters = [];
    for (const resolve of waiters) resolve();
  };
  const requestRender = () => {
    wanted = true;
    if (frameId || disposed || paused || parked || !visible || document.hidden) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      wanted = false;
      draw();
    });
  };

  /** @type {Set<() => void>} */
  const fits = new Set();
  const resize = () => {
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (!width || !height || !renderer) return;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect;
    } else {
      camera.left = -aspect;
      camera.right = aspect;
    }
    camera.updateProjectionMatrix();
    for (const fit of fits) fit();
    scene.traverse((node) => {
      const material = /** @type {{material?: {isLineMaterial?: boolean, resolution?: import("three").Vector2}}} */ (node).material;
      if (material?.isLineMaterial) material.resolution?.set(width, height);
    });
    requestRender();
  };
  const ratio = () => Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

  /**
   * @param {ColourMaterial} material
   * @param {string} name
   */
  const applyToken = (material, name) => {
    const { hex, opacity } = tokenColor(name);
    material.color.setHex(hex);
    material.opacity = opacity;
    material.transparent = opacity < 1;
  };

  const shown = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    visible = entry.isIntersecting;
    const tall = Math.min(entry.boundingClientRect.height, entry.rootBounds?.height ?? Infinity);
    seen = tall > 0 ? entry.intersectionRect.height / tall : 0;
    if (visible && wanted) requestRender();
    if (seen < 0.25) finishTracks(true);
    else if (seen >= 0.5) startWaiting();
  }, { threshold: [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
  shown.observe(frame);
  const resized = new ResizeObserver(resize);
  resized.observe(frame);
  const stopRatio = watchPixelRatio(() => {
    renderer?.setPixelRatio(ratio());
    resize();
  });
  const recolourAll = () => {
    for (const [material, name] of painted) applyToken(material, name);
    scene.traverse((node) => {
      const recolour = node.userData.recolour;
      if (typeof recolour === "function") recolour();
    });
    requestRender();
  };
  const stopTheme = onThemeChange(recolourAll);
  // Print takes the light tokens and drops the effects (lib/style.js).
  matchMedia("print").addEventListener("change", recolourAll, { signal: local.signal });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishTracks(true);
    else if (wanted) requestRender();
  }, { signal: local.signal });

  /* -------------------------------------------------------------------------
   * Timelines (design §6): named tracks, one loop for the whole view
   * ---------------------------------------------------------------------- */

  /**
   * @typedef {Object} Track
   * @property {number} begin
   * @property {number} ms
   * @property {number} delay
   * @property {number} stagger
   * @property {number} count
   * @property {(t: number) => number} ease
   * @property {(t: number, i: number) => void} step
   * @property {() => void} resolve
   * @property {boolean} waiting  a build waiting for the frame to be half visible
   */

  /** Every timeline of the view: its tracks by name. @type {Set<Map<string, Track>>} */
  const timelines = new Set();
  /**
   * The timelines made while build() ran: they belong to the scene, and go
   * with it (clearScene), so a rebuild does not pile them up.
   * @type {Set<Map<string, Track>>}
   */
  const sceneTimelines = new Set();
  let building = false;
  let loopId = 0;
  const slug = frame.closest("[data-anim]")?.getAttribute("data-anim") ?? "";

  /** Land one track on its end and resolve it. @param {Map<string, Track>} tracks @param {string} name */
  const settle = (tracks, name) => {
    const track = tracks.get(name);
    if (!track) return;
    tracks.delete(name);
    for (let i = 0; i < track.count; i += 1) track.step(1, i);
    track.resolve();
  };
  const runningCount = () => {
    let n = 0;
    for (const tracks of timelines) for (const track of tracks.values()) if (!track.waiting) n += 1;
    return n;
  };
  /**
   * Every track to its end; with `runningOnly`, builds still waiting to be
   * seen keep waiting.
   * @param {boolean} [runningOnly=false]
   */
  function finishTracks(runningOnly = false) {
    let any = false;
    for (const tracks of timelines) {
      for (const [name, track] of [...tracks]) {
        if (runningOnly && track.waiting) continue;
        settle(tracks, name);
        any = true;
      }
    }
    if (!any) return;
    cancelAnimationFrame(loopId);
    loopId = 0;
    requestRender();
  }
  const tick = () => {
    loopId = 0;
    const now = performance.now();
    for (const tracks of timelines) {
      for (const [name, track] of [...tracks]) {
        if (track.waiting) continue;
        const elapsed = now - track.begin - track.delay;
        let ended = true;
        for (let i = 0; i < track.count; i += 1) {
          const t = Math.min(1, Math.max(0, (elapsed - i * track.stagger) / track.ms));
          if (t < 1) ended = false;
          track.step(track.ease(t), i);
        }
        if (ended) {
          tracks.delete(name);
          track.resolve();
        }
      }
    }
    draw();
    if (runningCount()) loopId = requestAnimationFrame(tick);
  };
  const run = () => {
    if (!loopId && runningCount()) loopId = requestAnimationFrame(tick);
  };
  /** The frame is half visible: start the builds that waited for it. */
  function startWaiting() {
    const now = performance.now();
    for (const tracks of timelines) {
      for (const track of tracks.values()) {
        if (!track.waiting) continue;
        track.waiting = false;
        track.begin = now;
      }
    }
    run();
  }

  /** @returns {Timeline} */
  const timeline = () => {
    /** @type {Map<string, Track>} */
    const tracks = new Map();
    timelines.add(tracks);
    if (building) sceneTimelines.add(tracks);
    return {
      play: (name, opts) => new Promise((resolve) => {
        settle(tracks, name);
        const count = Math.max(1, opts.count ?? 1);
        if (disposed || parked || paused || prefersReducedMotion() || opts.ms <= 0) {
          for (let i = 0; i < count; i += 1) opts.step(1, i);
          requestRender();
          return resolve();
        }
        tracks.set(name, {
          begin: performance.now(),
          ms: opts.ms,
          delay: opts.delay ?? 0,
          stagger: count > 1 ? Math.min(opts.stagger ?? 0, 600 / (count - 1)) : 0,
          count,
          ease: easing(opts.ease ?? "ease"),
          step: opts.step,
          resolve: () => resolve(),
          waiting: Boolean(opts.build) && seen < 0.5,
        });
        if (TEST_HOOK) TEST_HOOK.tracks[slug] = Math.max(TEST_HOOK.tracks[slug] ?? 0, runningCount());
        run();
      }),
      finish: () => {
        for (const name of [...tracks.keys()]) settle(tracks, name);
        requestRender();
      },
      done: async () => {
        while (tracks.size) await Promise.all([...tracks.values()].map((track) => new Promise((resolve) => {
          const before = track.resolve;
          track.resolve = () => {
            before();
            resolve(undefined);
          };
        })));
      },
    };
  };
  /** ctx.animate's own timeline. */
  const tweens = timeline();
  const stopFinish = onFinishAll(() => finishTracks());
  // Any reader input on the figure lands every animation first.
  for (const type of ["pointerdown", "keydown"]) {
    frame.addEventListener(type, () => finishTracks(), { signal: local.signal, capture: true });
  }

  /** Undo the paused state, unless something else has set the frame since. */
  const unpause = () => {
    if (!paused) return;
    paused = false;
    resume.hidden = true;
    if (frame.dataset.state !== "paused") return;
    if (stateBeforeLoss === undefined) delete frame.dataset.state;
    else frame.dataset.state = stateBeforeLoss;
  };

  const clearScene = () => {
    // The scene's timelines land on their ends while their objects exist.
    for (const tracks of sceneTimelines) {
      for (const name of [...tracks.keys()]) settle(tracks, name);
      timelines.delete(tracks);
    }
    sceneTimelines.clear();
    disposeScene(scene);
    for (const object of tracked) object.dispose();
    tracked.clear();
    painted.clear();
  };

  /** Put the view on `surface`: a renderer, the canvas in the frame, listeners. */
  const attach = () => {
    canvas = surface.canvas;
    canvas.className = "anim-figure__canvas anim-figure__canvas--3d";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", ariaLabel);
    if (tabIndex >= 0) canvas.tabIndex = tabIndex;
    renderer = new THREE.WebGLRenderer({ canvas, context: surface.gl });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0); // transparent over --ambe-plot-bg
    renderer.setPixelRatio(ratio());
    frame.insertBefore(canvas, resume);
    if (opts.stage) frame.classList.add("anim-figure__frame--stage");
    tenure = new AbortController();
    canvas.addEventListener("webglcontextlost", onLost, { signal: tenure.signal });
    canvas.addEventListener("webglcontextrestored", onRestored, { signal: tenure.signal });
    drawnSinceBuild = false;
    if (TEST_HOOK) {
      TEST_HOOK.liveContexts += 1;
      TEST_HOOK.peakContexts = Math.max(TEST_HOOK.peakContexts, TEST_HOOK.liveContexts);
    }
  };

  /** Take the view off its surface, and pool the surface. */
  const detach = () => {
    // Figures set the label and the tab stop on the canvas itself; the next
    // canvas carries them on.
    ariaLabel = canvas.getAttribute("aria-label") ?? ariaLabel;
    tabIndex = canvas.hasAttribute("tabindex") ? canvas.tabIndex : -1;
    tenure.abort();
    renderer?.dispose();
    renderer = null;
    frame.classList.remove("anim-figure__frame--stage");
    poolSurface(surface);
  };

  /** @param {Event} event */
  function onLost(event) {
    event.preventDefault();
    // Parked, or paused already (onRestored lost it again for want of a slot).
    if (parked || paused) return;
    // A loss the runtime did not start: pause, and free the slot.
    paused = true;
    cancelAnimationFrame(frameId);
    frameId = 0;
    finishTracks();
    stateBeforeLoss = frame.dataset.state;
    frame.dataset.state = "paused";
    resume.hidden = false;
    if (TEST_HOOK) TEST_HOOK.liveContexts -= 1;
    release(slot);
  }
  function onRestored() {
    if (parked || !paused) return;
    // A real loss's context comes back by itself (the loss was prevented),
    // with no slot: the resume button's path took one first. Without a
    // free slot it is lost again and stays paused behind the button.
    if (!acquireNow(slot)) {
      surface.ext?.loseContext();
      return;
    }
    unpause();
    if (TEST_HOOK) {
      TEST_HOOK.liveContexts += 1;
      TEST_HOOK.peakContexts = Math.max(TEST_HOOK.peakContexts, TEST_HOOK.liveContexts);
    }
    rebuild();
  }
  resume.addEventListener("click", async () => {
    if (!paused || slot.busy) return;
    slot.busy = true;
    const granted = await acquire(slot);
    slot.busy = false;
    if (!granted || disposed || !paused) return;
    surface.ext?.restoreContext();
  }, { signal: local.signal });

  /** The camera as the reader left it, kept across a park. */
  /** @type {typeof camera | null} */
  let savedCamera = null;

  /** Give up the context to another view (called by acquire or serveQueue). */
  function park() {
    if (parked || disposed || paused) return;
    savedCamera = camera.clone();
    finishTracks();
    cancelAnimationFrame(frameId);
    frameId = 0;
    parked = true;
    clearScene();
    detach();
    frame.dataset.three = "parked";
    if (TEST_HOOK) {
      TEST_HOOK.liveContexts -= 1;
      TEST_HOOK.parks += 1;
    }
    try {
      onPark?.();
    } catch (error) {
      console.error("anim-three: onPark failed", error);
    }
  }

  /** Back within KEEP_MARGIN while parked: take a slot and a surface again. */
  async function unpark() {
    slot.busy = true;
    const granted = await acquire(slot);
    const next = granted && !disposed && parked && slot.near ? await takeSurface() : null;
    slot.busy = false;
    if (!next || disposed || !parked || !slot.near) {
      if (next) poolSurface(next);
      if (granted && parked) release(slot);
      // It may have come back within reach while this request settled.
      if (parked && !disposed && slot.near) void unpark();
      return;
    }
    surface = next;
    parked = false;
    attach();
    resize();
    try {
      clearScene();
      runBuild();
    } catch (error) {
      console.error("anim-three: build() failed on unpark", error);
      dispose();
      return;
    }
    if (savedCamera) {
      camera.copy(/** @type {any} */ (savedCamera), false);
      savedCamera = null;
      resize();
    }
    delete frame.dataset.three;
    if (TEST_HOOK) TEST_HOOK.unparks += 1;
    requestRender();
    await ctx.drawn();
    if (parked || disposed) return;
    try {
      onUnpark?.();
    } catch (error) {
      console.error("anim-three: onUnpark failed", error);
    }
  }

  onNearChange = () => {
    if (disposed) return;
    if (slot.near && parked && !slot.busy) void unpark();
    else if (!slot.near) {
      // A queued unpark that scrolled away again leaves the queue.
      if (parked && queue.includes(slot)) release(slot);
      serveQueue();
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const held = !parked && !paused && renderer !== null;
    unpause();
    local.abort();
    shown.disconnect();
    resized.disconnect();
    stopRatio();
    stopTheme();
    stopFinish();
    fits.clear();
    cancelAnimationFrame(frameId);
    finishTracks();
    timelines.clear();
    for (const resolve of drawWaiters) resolve();
    drawWaiters = [];
    clearScene();
    if (!parked) detach();
    if (frame.dataset.three === "parked") delete frame.dataset.three;
    resume.remove();
    forget();
    if (TEST_HOOK && held) TEST_HOOK.liveContexts -= 1;
    release(slot);
  };
  signal.addEventListener("abort", dispose, { once: true, signal: local.signal });

  /** @type {ThreeContext} */
  const ctx = {
    three: THREE,
    lines,
    get renderer() {
      return /** @type {import("three").WebGLRenderer} */ (renderer);
    },
    scene,
    camera,
    frame,
    get parked() {
      return parked;
    },
    requestRender,
    onResize: (fit) => {
      fits.add(fit);
      return () => fits.delete(fit);
    },
    drawn: () =>
      drawnSinceBuild || disposed ? Promise.resolve() : new Promise((resolve) => drawWaiters.push(() => resolve())),
    track: (object) => {
      tracked.add(object);
      return object;
    },
    token: (name) => tokenColor(name),
    paint: (material, name) => {
      painted.set(material, name);
      applyToken(material, name);
      return material;
    },
    // A tween cut short, by the next animate(), by input or by dispose(),
    // still resolves (on its end state), so a step that awaits it never hangs.
    animate: (ms, step) => tweens.play("animate", { ms, ease: "linear", step: (t) => step(t) }),
    timeline,
    finish: () => finishTracks(),
    dispose,
    signal,
    viewSignal: local.signal,
  };

  /** build(), with the timelines it makes marked as the scene's. */
  function runBuild() {
    building = true;
    try {
      build(ctx);
    } finally {
      building = false;
    }
  }

  function rebuild() {
    clearScene();
    drawnSinceBuild = false;
    runBuild();
    requestRender();
  }

  attach();
  slot.busy = false;
  resize();
  try {
    runBuild();
  } catch (error) {
    console.error("anim-three: build() failed", error);
    dispose();
    return null;
  }
  requestRender();
  return ctx;
}
