// @ts-check
/* ===========================================================================
 * lib/orbit.js: camera presets, a drag that turns and tilts, and the fit
 * that makes a 3D view's front preset equal its 2D plot.
 * ---------------------------------------------------------------------------
 * No OrbitControls (design §3.9). A drag across turns the view; a drag up
 * or down tilts it between straight on (0) and straight down (90). The 3D
 * canvas is touch-action: pan-y, so on a phone a vertical swipe still
 * scrolls the page and only the presets tilt. A preset tweens through
 * ctx.animate(), which jumps to the end under reduced motion.
 *
 * Zoom (three-visual-language design §5), with createOrbit({zoom: true}):
 * the reader's zoom (1x, the fitted view, to 6x) and pan are applied after
 * the figure's fit, so a resize or a turn keeps them. It goes toward the
 * pointer, and the frame never leaves the content. Inputs: the wheel with
 * Ctrl or Cmd held (a trackpad pinch arrives that way) or while the figure
 * is engaged (its canvas focused from the keyboard, or pressed until blur,
 * Escape or the pointer leaving), else the page scrolls and a hint says
 * how; an engaged wheel at a zoom limit scrolls the page too; Safari's
 * gesture events; a two-finger pinch; a double-click (2x, then back);
 * + = - 0 on the focused canvas; and the Zoom group's buttons and readout
 * beside the Camera group. The buttons and keys have no pointer to go
 * toward: they go toward the visible highlight kit, bringing it part of the
 * way to the middle, so an off-centre highlight is not cut off. A preset flies the camera over
 * --ambe-dur-3d-camera and brings zoom and pan back to 1x and 0 on the
 * same track; Reset view flies back to the last preset at 1x. The readout
 * is written once a change settles, so the live region speaks the level
 * and not the path to it. Zoom renders on request and never loops.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** @typedef {{yaw: number, pitch: number}} Pose  degrees */

/**
 * @typedef {Object} SceneBox  a box in scene units
 * @property {[number, number, number]} min
 * @property {[number, number, number]} max
 */

/** @typedef {{x: number, y: number, width: number, height: number}} PlotRect  CSS px in the frame */

/** Looking down -z: scene x to the right, scene y up. The pose matchPlot fits. */
export const FRONT = Object.freeze({ yaw: 0, pitch: 0 });
/** Looking down -y from above: scene x to the right, scene -z up. */
export const TOP = Object.freeze({ yaw: 0, pitch: 90 });
/** Looking down -x: scene -z to the right, scene y up. */
export const SIDE = Object.freeze({ yaw: 90, pitch: 0 });

import { duration } from "../anim-three.js";

/** Sideways travel, in CSS px, before a press turns the camera. */
const DRAG_PX = 4;
/** How far a drag tilts: straight on to straight down, in degrees. */
const PITCH_MIN = 0;
const PITCH_MAX = 90;

/** The sentence a zoomable canvas's aria-label ends with. */
export const ZOOM_SENTENCE = "Zoom with the buttons, or with plus and minus when focused.";
/** Shown for 1.5 s when a plain wheel scrolls the page over the canvas. */
export const ZOOM_HINT = "Hold Ctrl (⌘ on a Mac) and scroll to zoom";
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.25;

/**
 * The orthographic frustum that puts a box's front face exactly on a 2D
 * plot's rectangle, with the camera looking at the box's centre from the
 * FRONT pose, in a frame of the given size. Horizontal and vertical scale
 * differ when the box and the plot differ in shape; every pose keeps that
 * scale, so a turn shows the same box the front view does.
 * @param {{width: number, height: number}} size the frame, CSS px
 * @param {PlotRect} rect
 * @param {SceneBox} box
 * @returns {{left: number, right: number, top: number, bottom: number}}
 */
export function frontFrustum(size, rect, box) {
  const ex = box.max[0] - box.min[0];
  const ey = box.max[1] - box.min[1];
  const sx = rect.width / ex; // CSS px per scene unit, across
  const sy = rect.height / ey; // and up
  return {
    left: -rect.x / sx - ex / 2,
    right: (size.width - rect.x) / sx - ex / 2,
    top: ey / 2 + rect.y / sy,
    bottom: ey / 2 - (size.height - rect.y) / sy,
  };
}

/**
 * Fit a view's orthographic camera so that the FRONT pose puts `box` on
 * the 2D plot's rectangle, the geometric "front equals 2D" test of design
 * §2.4 item 4. Pass `fit` and `target` to createOrbit; it applies the fit
 * on every pose and every resize. The fit is the zoom-1 view that a
 * reader's zoom multiplies.
 * @param {import("../anim-three.js").ThreeContext} ctx
 * @param {PlotRect | (() => PlotRect)} plotRect the 2D plot's area, from
 *        createPlot(); a function when it follows the frame's size
 * @param {SceneBox} box the part of the scene the 2D plot shows
 * @returns {{target: [number, number, number], fit: () => void}}
 */
export function matchPlot(ctx, plotRect, box) {
  /** @type {[number, number, number]} */
  const target = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const fit = () => {
    const camera = ctx.camera;
    if (!("isOrthographicCamera" in camera)) return;
    const size = { width: ctx.frame.clientWidth, height: ctx.frame.clientHeight };
    if (!size.width || !size.height) return;
    const rect = typeof plotRect === "function" ? plotRect() : plotRect;
    Object.assign(camera, frontFrustum(size, rect, box));
  };
  return { target, fit };
}

/**
 * @typedef {Object} Orbit
 * @property {(name: string) => Promise<void>} go  fly to a preset
 * @property {(pose: Pose) => void} set  jump to a pose
 * @property {() => Pose} pose
 * @property {() => number} zoom  the reader's zoom, 1 to 6
 * @property {(factor: number, ndcX?: number, ndcY?: number) => Promise<void>} zoomBy
 *           zoom by `factor` toward a point of the frame (NDC, the centre
 *           if absent), tweened over --ambe-dur-med
 * @property {() => Promise<void>} resetView  the current preset (the last
 *           one flown to, else the start) at 1x with no pan
 */

/**
 * @param {import("../anim-three.js").ThreeContext} ctx
 * @param {{target: [number, number, number], distance: number, zoom: number | boolean,
 *          presets: Record<string, Pose>, start: string, onChange?: () => void,
 *          onDrag?: () => void, fit?: () => void, yaw?: boolean}} opts
 *        onDrag runs once per press, when the pointer first travels DRAG_PX
 *        sideways; a tap or a vertical swipe never calls it. fit (from
 *        matchPlot) sets the frustum on every pose and every resize. yaw:
 *        false turns the drag off (bits and fec-protection are head-on).
 *        zoom: a number is the camera's own zoom, as before the visual
 *        language; true turns on the reader's zoom (above) at a camera zoom
 *        of 1
 * @returns {Orbit}
 */
export function createOrbit(ctx, opts) {
  let pose = { ...opts.presets[opts.start] };
  /** The preset Reset view returns to: the last one flown to. */
  let current = opts.start;
  const rad = Math.PI / 180;
  const zoomable = opts.zoom === true;
  const base = typeof opts.zoom === "number" ? opts.zoom : 1;
  /** The reader's zoom, and pan in camera right and up units. */
  let user = 1;
  let pan = { x: 0, y: 0 };
  // The view's own signal where there is one: the listeners and the Zoom
  // group go with the view (the figure's signal outlives it).
  const signal = ctx.viewSignal ?? ctx.signal;
  /** Set once the Zoom group exists; refreshes its readout and buttons. */
  let showZoom = () => {};
  /** Half the fitted view's width and height, in scene units at zoom 1. */
  const half = () => {
    const c = /** @type {any} */ (ctx.camera);
    if (c.isOrthographicCamera) return { w: (c.right - c.left) / 2 / base, h: (c.top - c.bottom) / 2 / base };
    const h = opts.distance * Math.tan((c.fov * rad) / 2);
    return { w: h * c.aspect, h };
  };
  /** @param {Pose} p */
  const place = (p) => {
    const [tx, ty, tz] = opts.target;
    const d = opts.distance;
    ctx.camera.position.set(
      tx + d * Math.cos(p.pitch * rad) * Math.sin(p.yaw * rad),
      ty + d * Math.sin(p.pitch * rad),
      tz + d * Math.cos(p.pitch * rad) * Math.cos(p.yaw * rad)
    );
    ctx.camera.up.set(0, 1, 0);
    if (Math.abs(p.pitch) > 89.5) ctx.camera.up.set(0, 0, -1);
    ctx.camera.lookAt(tx, ty, tz);
    opts.fit?.();
    // The reader's zoom and pan multiply the fit, after it.
    ctx.camera.zoom = base * user;
    if (pan.x || pan.y) {
      ctx.camera.updateMatrixWorld();
      const m = ctx.camera.matrixWorld.elements;
      ctx.camera.position.x += m[0] * pan.x + m[4] * pan.y;
      ctx.camera.position.y += m[1] * pan.x + m[5] * pan.y;
      ctx.camera.position.z += m[2] * pan.x + m[6] * pan.y;
    }
    ctx.camera.updateProjectionMatrix();
    opts.onChange?.();
    showZoom();
    ctx.requestRender();
  };
  if (opts.fit || zoomable) ctx.onResize(() => place(pose));
  place(pose);

  /**
   * Zoom to `next` (clamped to 1 to 6) keeping the point at (ndcX, ndcY)
   * still: pan += ndc x half extent x (1 / old - 1 / new). The frame
   * stays inside the content, and 1x is the fitted view with no pan.
   * @param {number} next
   * @param {number} ndcX
   * @param {number} ndcY
   * @returns {{user: number, pan: {x: number, y: number}}}
   */
  const toward = (next, ndcX, ndcY) => {
    const z = Math.min(ZOOM_MAX, Math.max(1, next));
    const { w, h } = half();
    /** @param {number} p @param {number} ndc @param {number} e */
    const shift = (p, ndc, e) => {
      const moved = p + ndc * e * (1 / user - 1 / z);
      const room = e * (1 - 1 / z);
      return Math.max(-room, Math.min(room, moved));
    };
    return { user: z, pan: { x: shift(pan.x, ndcX, w), y: shift(pan.y, ndcY, h) } };
  };
  /** @param {{user: number, pan: {x: number, y: number}}} to */
  const jump = (to) => {
    user = to.user;
    pan = to.pan;
    place(pose);
  };
  const timeline = ctx.timeline?.();
  /**
   * Tween the zoom and pan (and, with `to.pose`, the pose) on one track,
   * after landing whatever runs, so a second press steps on from the end
   * of the first.
   * @param {() => {user: number, pan: {x: number, y: number}, pose?: Pose}} target
   * @param {number} ms
   * @param {"ease" | "inout"} ease
   */
  const fly = (target, ms, ease) => {
    ctx.finish?.();
    const to = target();
    const from = { user, pan: { ...pan }, pose: { ...pose } };
    const end = to.pose;
    const dyaw = end ? ((((end.yaw - from.pose.yaw) % 360) + 540) % 360) - 180 : 0;
    const step = (/** @type {number} */ t) => {
      user = from.user * (to.user / from.user) ** t;
      pan = { x: from.pan.x + (to.pan.x - from.pan.x) * t, y: from.pan.y + (to.pan.y - from.pan.y) * t };
      if (end) pose = { yaw: from.pose.yaw + dyaw * t, pitch: from.pose.pitch + (end.pitch - from.pose.pitch) * t };
      if (t === 1) {
        user = to.user;
        pan = { ...to.pan };
        if (end) pose = { ...end };
      }
      place(pose);
    };
    return timeline ? timeline.play("camera", { ms, ease, step }) : ctx.animate(ms, step);
  };

  // On the frame, not the canvas: a parked view comes back on a new canvas
  // (anim-three.js header item 4), and these listeners must follow it.
  const frame = ctx.frame;
  /** @param {Event} event */
  const onCanvas = (event) => !ctx.parked && Boolean(ctx.renderer) && event.target === ctx.renderer.domElement;
  /** @type {number | null} */
  let lastX = null;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let dragging = false;
  /** Touch points on the canvas, for the pinch. @type {Map<number, {x: number, y: number}>} */
  const touches = new Map();
  /** @type {{d: number, user: number} | null} */
  let pinch = null;
  frame.addEventListener("pointerdown", (event) => {
    if (!onCanvas(event)) return;
    lastX = downX = event.clientX;
    lastY = downY = event.clientY;
    dragging = false;
    try {
      ctx.renderer.domElement.setPointerCapture(event.pointerId);
    } catch (error) {
      // A pointer the browser no longer tracks: nothing to capture.
    }
    if (event.pointerType === "touch") touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (zoomable && touches.size === 2) {
      // Two fingers: a pinch, not a turn.
      lastX = null;
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, user };
    }
  }, { signal });
  frame.addEventListener("pointermove", (event) => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const [x, y] = ndc((a.x + b.x) / 2, (a.y + b.y) / 2);
      jump(toward(pinch.user * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), x, y));
      return;
    }
    if (lastX === null || !onCanvas(event) || opts.yaw === false) return;
    if (!dragging) {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) < DRAG_PX) return;
      dragging = true;
      opts.onDrag?.();
    }
    // Across turns the figure; up and down tilts it, from straight on (0)
    // to looking down from above (90). On a phone the page keeps vertical
    // swipes (touch-action: pan-y), so there only the presets tilt.
    const pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pose.pitch + (event.clientY - lastY) * 0.4));
    pose = { yaw: pose.yaw - (event.clientX - lastX) * 0.4, pitch };
    lastX = event.clientX;
    lastY = event.clientY;
    place(pose);
  }, { signal });
  /** @param {PointerEvent} event */
  const end = (event) => {
    lastX = null;
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
  };
  frame.addEventListener("pointerup", end, { signal });
  frame.addEventListener("pointercancel", end, { signal });

  /**
   * A point of the frame in NDC.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {[number, number]}
   */
  function ndc(clientX, clientY) {
    const box = frame.getBoundingClientRect();
    return [((clientX - box.left) / box.width) * 2 - 1, 1 - ((clientY - box.top) / box.height) * 2];
  }

  /**
   * Where the highlight is, as the pan that would centre it (scene units in
   * the camera's plane), or null: the centre of every visible highlight
   * kit's (lib/highlight.js) segments.
   * @returns {{x: number, y: number} | null}
   */
  const highlightAt = () => {
    const T = ctx.three;
    if (!T) return null;
    const box = new T.Box3();
    const v = new T.Vector3();
    ctx.scene.traverseVisible((o) => {
      const at = /** @type {(() => number[]) | undefined} */ (o.userData.highlight);
      if (!at) return;
      o.updateWorldMatrix(true, false);
      const s = at();
      for (let i = 0; i + 2 < s.length; i += 3) box.expandByPoint(v.set(s[i], s[i + 1], s[i + 2]).applyMatrix4(o.matrixWorld));
    });
    if (box.isEmpty()) return null;
    box.getCenter(v);
    ctx.camera.updateMatrixWorld();
    v.project(ctx.camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    const { w, h } = half();
    return { x: (v.x * w) / user + pan.x, y: (v.y * h) / user + pan.y };
  };
  /**
   * The buttons' and keys' zoom: toward the highlight, which comes part of
   * the way to the middle as the zoom goes up (half its distance from the
   * middle stays at 2x), so an off-centre highlight stays in the frame;
   * toward the middle when there is none.
   * @param {number} factor
   */
  const zoomStep = (factor) => fly(() => {
    const at = highlightAt();
    const z = Math.min(ZOOM_MAX, Math.max(1, user * factor));
    if (!at || z <= 1) return toward(z, 0, 0);
    const { w, h } = half();
    const k = 1 - z ** -2;
    /** @param {number} u @param {number} e */
    const clamp = (u, e) => Math.max(-e * (1 - 1 / z), Math.min(e * (1 - 1 / z), u * k));
    return { user: z, pan: { x: clamp(at.x, w), y: clamp(at.y, h) } };
  }, duration("med"), "ease");

  /** @param {number} factor @param {number} [x=0] @param {number} [y=0] */
  const zoomBy = (factor, x = 0, y = 0) => fly(() => toward(user * factor, x, y), duration("med"), "ease");
  /** Back to 1x with no pan, keeping the pose (the double-click's way back). */
  const unzoom = () => fly(() => ({ user: 1, pan: { x: 0, y: 0 } }), duration("med"), "ease");
  /** The pose differs from the current preset's. */
  const turned = () => {
    const home = opts.presets[current];
    const dyaw = ((((home.yaw - pose.yaw) % 360) + 540) % 360) - 180;
    return Math.abs(dyaw) > 1e-6 || Math.abs(home.pitch - pose.pitch) > 1e-6;
  };
  // A turned camera flies home like a preset; zoom and pan alone, like a step.
  const resetView = () => (turned()
    ? fly(() => ({ user: 1, pan: { x: 0, y: 0 }, pose: opts.presets[current] }), duration("3d-camera"), "inout")
    : unzoom());
  if (zoomable) zoomInputs();

  return {
    go: (name) => {
      const to = opts.presets[name];
      current = name;
      if (zoomable) return fly(() => ({ user: 1, pan: { x: 0, y: 0 }, pose: to }), duration("3d-camera"), "inout");
      const from = pose;
      const dyaw = ((((to.yaw - from.yaw) % 360) + 540) % 360) - 180;
      return ctx.animate(250, (t) => {
        const e = 1 - (1 - t) ** 3;
        pose = { yaw: from.yaw + dyaw * e, pitch: from.pitch + (to.pitch - from.pitch) * e };
        if (t === 1) pose = { ...to };
        place(pose);
      });
    },
    set: (p) => {
      pose = { ...p };
      place(pose);
    },
    pose: () => ({ ...pose }),
    zoom: () => user,
    zoomBy,
    resetView,
  };

  /** The wheel, gestures, double-click, keys, the Zoom group and the hint. */
  function zoomInputs() {
    const canvas = () => ctx.renderer?.domElement;
    // Engaged: pressed, until blur, Escape or the pointer leaving; or
    // focused from the keyboard (:focus-visible), until Escape. A click
    // focuses the canvas too, but that focus alone never holds the wheel.
    let engaged = false;
    let released = false;
    const focused = () => {
      const c = canvas();
      return !released && document.activeElement === c && Boolean(c?.matches(":focus-visible"));
    };
    frame.addEventListener("pointerdown", (event) => {
      if (!onCanvas(event)) return;
      engaged = true;
      released = false;
    }, { signal });
    frame.addEventListener("pointerleave", () => { engaged = false; }, { signal });
    frame.addEventListener("focusin", (event) => { if (onCanvas(event)) released = false; }, { signal });
    frame.addEventListener("focusout", () => { engaged = false; }, { signal });
    // touch-action: pan-y (anim.css) only where the pinch is the figure's.
    frame.classList.add("anim-figure__frame--zoom");

    const hint = document.createElement("p");
    hint.className = "anim-zoom-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = ZOOM_HINT;
    hint.hidden = true;
    frame.append(hint);
    let hintTimer = 0;
    frame.addEventListener("wheel", (event) => {
      if (!onCanvas(event)) return;
      if (!(event.ctrlKey || event.metaKey || engaged || focused())) {
        hint.hidden = false;
        clearTimeout(hintTimer);
        hintTimer = window.setTimeout(() => { hint.hidden = true; }, 1500);
        return; // the page scrolls
      }
      const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1);
      const to = toward(user * Math.exp(-dy * 0.0015), ...ndc(event.clientX, event.clientY));
      // Engaged at a limit (1x scrolling out, 6x scrolling in) the page
      // scrolls. Ctrl or Cmd is still taken, or the browser zooms the page.
      const still = Math.abs(to.user - user) < 1e-6 && to.pan.x === pan.x && to.pan.y === pan.y;
      if (still && !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      ctx.finish?.();
      jump(to);
    }, { passive: false, signal });

    // Safari's trackpad pinch.
    let gestureFrom = 1;
    frame.addEventListener("gesturestart", (event) => {
      if (!onCanvas(event)) return;
      event.preventDefault();
      gestureFrom = user;
    }, { signal });
    frame.addEventListener("gesturechange", (event) => {
      if (!onCanvas(event)) return;
      event.preventDefault();
      const g = /** @type {Event & {scale: number, clientX: number, clientY: number}} */ (event);
      jump(toward(gestureFrom * g.scale, ...ndc(g.clientX, g.clientY)));
    }, { signal });

    frame.addEventListener("dblclick", (event) => {
      if (!onCanvas(event)) return;
      if (user > 1) void unzoom();
      else void zoomBy(2, ...ndc(event.clientX, event.clientY));
    }, { signal });

    frame.addEventListener("keydown", (event) => {
      if (!onCanvas(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        engaged = false;
        released = true;
      }
      const act = { "+": () => zoomStep(ZOOM_STEP), "=": () => zoomStep(ZOOM_STEP), "-": () => zoomStep(1 / ZOOM_STEP),
        "0": resetView }[event.key];
      if (!act) return;
      event.preventDefault();
      void act();
    }, { signal });

    // The canvas label ends with ZOOM_SENTENCE however it is rewritten: a
    // figure's describe() sets the label on every step, and a parked view
    // comes back on a new canvas.
    const withSentence = () => {
      const c = canvas();
      const label = (c?.getAttribute("aria-label") ?? "").trim();
      if (!c || label.endsWith(ZOOM_SENTENCE)) return;
      const stop = label && !/[.!?]$/.test(label) ? "." : "";
      c.setAttribute("aria-label", `${label}${stop} ${ZOOM_SENTENCE}`.trim());
    };
    withSentence();
    const labels = new MutationObserver(withSentence);
    labels.observe(frame, { subtree: true, childList: true, attributeFilter: ["aria-label"] });

    // The Zoom group: in the slot the view row keeps for it
    // (lib/view-switch.js), else beside the Camera group, else in the
    // controls row.
    const figure = frame.closest(".anim-figure");
    const group = document.createElement("div");
    group.className = "anim-toggle-group anim-zoom";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Zoom");
    group.innerHTML = `<button class="anim-btn" type="button" data-zoom="out">Zoom out</button>` +
      `<output class="anim-zoom__readout" aria-live="polite">1.0×</output>` +
      `<button class="anim-btn" type="button" data-zoom="in">Zoom in</button>` +
      `<button class="anim-btn" type="button" data-zoom="reset">Reset view</button>`;
    const slot = figure?.querySelector(".anim-view__slot");
    const camera = figure?.querySelector('[role="group"][aria-label="Camera"]');
    const controls = figure?.querySelector(".anim-controls");
    if (slot instanceof HTMLElement) {
      slot.before(group);
      slot.dataset.taken = "";
    } else if (camera) camera.after(group);
    else if (controls) controls.append(group);
    else frame.after(group);
    const [out, readout, into, reset] = /** @type {HTMLElement[]} */ ([...group.children]);
    out.addEventListener("click", () => void zoomStep(1 / ZOOM_STEP));
    into.addEventListener("click", () => void zoomStep(ZOOM_STEP));
    reset.addEventListener("click", () => void resetView());
    let readoutTimer = 0;
    signal.addEventListener("abort", () => {
      if (slot instanceof HTMLElement) delete slot.dataset.taken;
      group.remove();
      hint.remove();
      labels.disconnect();
      frame.classList.remove("anim-figure__frame--zoom");
      clearTimeout(hintTimer);
      clearTimeout(readoutTimer);
    }, { once: true });
    let shown = readout.textContent ?? "";
    /** The readout, once the zoom has held still for 250 ms (a flight, a wheel or a pinch). */
    const announce = () => {
      const text = `${user.toFixed(1)}×`;
      if (text !== shown) readout.textContent = shown = text;
    };
    /**
     * Disable a button at its limit. A focused one hands the focus to a
     * button that stays enabled, so the keyboard keeps its place.
     * @param {HTMLElement} button
     * @param {boolean} off
     * @param {HTMLElement} heir
     */
    const limit = (button, off, heir) => {
      const b = /** @type {HTMLButtonElement} */ (button);
      if (off && !b.disabled && document.activeElement === b) heir.focus();
      b.disabled = off;
    };
    showZoom = () => {
      const low = user <= 1 + 1e-6;
      const high = user >= ZOOM_MAX - 1e-6;
      limit(out, low, into);
      limit(into, high, out);
      limit(reset, low && !pan.x && !pan.y && !turned(), low ? into : out);
      clearTimeout(readoutTimer);
      readoutTimer = window.setTimeout(announce, 250);
    };
    showZoom();
  }
}
