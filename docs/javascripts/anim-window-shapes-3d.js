// @ts-check
/* ===========================================================================
 * anim-window-shapes-3d.js: the window-shapes figure's 3D view (ch03).
 * ---------------------------------------------------------------------------
 * The same block of a tone under every window of one family, w(n) =
 * a - (1 - a) cos(2 pi n / N), side by side in depth:
 *
 *   x  sample, 0 to 160 (and the next copy's first samples to 178)
 *   y  value, the 2D plot's range
 *   z  the window's value at the block's ends, e = 2a - 1, on a square
 *      root scale (lib/window-shapes.js depthOf): 1.00 at the front (the
 *      rectangular window), 0.08 (Hamming) 0.28 of the way forward, 0.00
 *      at the back (Hann), the family every tenth of the depth. On a
 *      straight scale Hamming and Hann would share the last twelfth.
 *
 * Depth carries the one number these windows differ by, and the step at
 * the joint is 2e, so the step shrinks to nothing going back. Each block
 * is thin, coloured on the ramp by its end value and faded by its
 * distance from the reader's window, which is the highlight, with the
 * window itself dashed over it, the plain block dashed under it, and the
 * joint. Two thin rails join the blocks' first and last samples across
 * depth: the ends pressed down to 0 while the middle keeps its size.
 *
 * Presets: Front puts the reader's window on the 2D plot's own rectangle,
 * with the family and the rails hidden and the next copy's band shown, so
 * it is the 2D picture; Corner shows the family.
 *
 * Its one animation: "The window settles onto the block, pressing its
 * ends down to zero (Hann) or nearly zero (Hamming) while the middle
 * keeps its size, so the joint disappears." From the front, as the 2D
 * plot under the rectangular window, the camera turns to the corner while
 * the highlight moves back through the family from 1.00 to 0.00, laying
 * each block down as it passes, pausing on Hamming and holding on Hann,
 * its chip reading the window's value at the ends as it falls; then it
 * returns to the reader's window. A window pressed later moves the
 * highlight through the family to its slice (a morph), with a pulse.
 *
 * It computes no model data: the curves come from lib/window-shapes.js
 * through the 2D module's state, and only scene coordinates and colours
 * are worked out here.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { X_RANGE, Y_RANGE, chipText, fmt, jointText, layout } from "./anim-window-shapes.js";
import { ENDS, N, WINDOWS, depthOf, endAt, named, toneAt, windowAt, windowedAt } from "./lib/window-shapes.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { createOrbit, frontFrustum } from "./lib/orbit.js";
import { axisFrame, toScene } from "./lib/scene.js";
import { contactShadow, fade, fatLines, floor, fog, mix, printing, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./anim-window-shapes.js").WindowState} WindowState */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {[number, number, number]} Vec */

/** z runs over depth, depthOf(end), 0 (Hann) to 1 (rectangular). */
const MAP = toScene({ x: X_RANGE, y: Y_RANGE, z: [0, 1] }, { x: 6.2, y: 2.4, z: 4.6 });
/** The scene z of the window with end value `end`. @param {number} end */
const zOf = (end) => MAP.z(depthOf(end));
const BOX = MAP.box;
const BASE = MAP.y(Y_RANGE[0]);
const DISTANCE = 14;
/** @type {Vec} */
const TARGET = [0, 0, 0];

/** @type {Record<string, Pose>} */
const PRESETS = {
  front: { yaw: 0, pitch: 0 },
  corner: { yaw: 28, pitch: 30 },
};
/** On a phone the frame is square: Corner looks down more steeply and turns less, so depth runs up the frame. */
const NARROW_CORNER = { yaw: 16, pitch: 42 };

/** The first view, ms: from 1.00 back to Hamming, */
const TO_HAMMING_MS = 1700;
/** the pause on Hamming, long enough to read its chip, */
const HAMMING_MS = 1100;
/** on to Hann, */
const TO_HANN_MS = 1000;
/** the hold on Hann, the taper at its fullest, */
const HANN_MS = 1800;
/** and the return to the reader's window. */
const SETTLE_MS = 900;
/** Points per block in the family: every second sample. */
const EVERY = 2;
/** Blocks in front of the highlight fade this much more below 60 degrees of pitch (the cutaway rule). */
const CUTAWAY = 0.15;

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} t */
const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * A curve in the plane of end value `end`, flat x, y, z, every `step` samples.
 * @param {(n: number) => number} f
 * @param {number} end
 * @param {number} from
 * @param {number} to
 * @param {number} [step=0.5]
 */
function inPlane(f, end, from, to, step = 0.5) {
  const z = zOf(end);
  /** @type {number[]} */
  const p = [];
  for (let n = from; n <= to + 1e-9; n += step) p.push(MAP.x(n), MAP.y(f(n)), z);
  return p;
}

/**
 * A polyline (flat x, y, z) as consecutive segment pairs.
 * @param {number[]} p
 * @param {number[]} [out=[]]
 */
function pairs(p, out = []) {
  for (let i = 0; i + 5 < p.length; i += 3) out.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
  return out;
}

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  const state = /** @type {WindowState} */ (opts.state);
  /** The highlight's end value on show: it moves toward state.end. */
  let shown = opts.intro ? 1 : state.end;
  /** Blocks with an end value at or above this are laid down (the sweep). */
  let laid = opts.intro ? 1 : 0;
  let builds = 0;
  let played = 0;
  /** @type {ReturnType<typeof parts> | null} */
  let scene = null;
  /** @type {ThreeContext | null} */
  let view = null;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  let labelled = "";
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** @type {{at: Vec, n: number, v: number, kind: string}[]} */
  let frontPoints = [];
  let firstDrawn = false;

  /** @type {Record<string, Pose>} */
  const presets = { ...PRESETS, corner: frame.clientWidth < 560 ? NARROW_CORNER : PRESETS.corner };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
    build: (c) => {
      builds += 1;
      view = c;
      scene = parts(c);
      labels = createLabels(c.frame, c);
      c.track(labels);
      labelled = "";
      fog(c, DISTANCE, BOX.max[2] - BOX.min[2]);
      draw();
      visibility();
      if (firstDrawn) relabelScene();
    },
  });
  if (!ctx) return null;

  /** The scene's parts, from tokens; draw() places the data. */
  function parts(/** @type {ThreeContext} */ c) {
    const [x0, , z0] = BOX.min;
    const [x1, , z1] = BOX.max;
    const add = (/** @type {import("three").Object3D} */ o) => {
      c.scene.add(o);
      return o;
    };
    add(floor(c, {
      extent: { min: [x0, BASE, z0], max: [x1, BOX.max[1], z1] },
      step: [MAP.x(40) - MAP.x(0), MAP.z(0.25) - MAP.z(0)],
    }));
    add(contactShadow(c, { x: [x0, MAP.x(N)], z: [z0, z1], y: BASE }));
    add(axisFrame(c, BOX, { xs: [40, 80, 120, N].map(MAP.x), ys: [-1, 0, 1].map(MAP.y), floor: false }));

    // The family: every block but the highlight's, thin, by end value.
    /** @type {number[]} */
    let familyColours = [];
    const family = fatLines(c, [0, 0, 0, 0, 0, 0], () => familyColours, 1.25, { fog: true });
    family.frustumCulled = false;
    add(family);
    // The rails: the blocks' first sample (n = 0, value e) and, where the
    // next copy would join, the point one past the last (n = N, value -e),
    // across depth. On the square root scale each is a curve.
    /** @type {number[]} */
    const railPoints = [];
    for (const [x, sign] of /** @type {const} */ ([[0, 1], [N, -1]])) {
      /** @type {number[]} */
      const line = [];
      for (let d = 0; d <= 1 + 1e-9; d += 0.025) line.push(MAP.x(x), MAP.y(sign * endAt(d)), MAP.z(d));
      pairs(line, railPoints);
    }
    const rails = fatLines(c, railPoints,
      () => new Array(railPoints.length / 3).fill(mix(tokenHex("--ambe-plot-ink"), tokenHex("--ambe-plot-bg"), 0.3)), 1.25);
    add(rails);

    // The next copy's band, as the 2D plot shades it: shown on Front only.
    const T = c.three;
    const band = new T.Mesh(new T.PlaneGeometry(MAP.x(X_RANGE[1]) - MAP.x(N), BOX.max[1] - BOX.min[1]),
      c.paint(new T.MeshBasicMaterial({
        side: T.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
      }), "--ambe-surface-2"));
    band.renderOrder = -1;
    add(band);

    // In the highlight's plane: the plain block, the window and its mirror,
    // the next copy's start, and the step at the joint.
    const tone = fatLines(c, [0, 0, 0, 0, 0, 0], "--ambe-plot-muted", 1.25, { dashed: true });
    const win = fatLines(c, [0, 0, 0, 0, 0, 0], "--ambe-accent", 1.75, { dashed: true });
    const mirror = fatLines(c, [0, 0, 0, 0, 0, 0], "--ambe-accent", 1.25, { dashed: true });
    const next = fatLines(c, [0, 0, 0, 0, 0, 0], "--ambe-plot-muted", 1.6);
    const joint = fatLines(c, [0, 0, 0, 0, 0, 0], "--ambe-accent-warm", 3.5, { depthTest: false });
    joint.renderOrder = 14;
    for (const line of [tone, win, mirror, next]) add(line);
    add(joint);
    const kit = addHighlight(c, highlightPoints(), { baseline: BASE, fill: false, chip: chipText(shown) });
    add(kit);
    if (kit.chip) topChip(kit.chip);
    return {
      family, rails, band, tone, window: win, mirror, next, joint, kit,
      /** @param {number[]} colours */
      colour: (colours) => {
        familyColours = colours;
      },
    };
  }

  /**
   * On a phone the frame is square and the family rises behind the
   * highlight, so a chip beside its peak would cover the blocks: there it
   * sits in the band above the box instead, centred over the anchor, its
   * leader still running to the dot on the highlight.
   * @param {import("./lib/labels.js").Chip} chip
   */
  function topChip(chip) {
    const placed = chip.update;
    const layer = chip.node.parentElement;
    const line = layer?.querySelector("line");
    chip.update = () => {
      placed();
      if (frame.clientWidth >= 560 || !line || layer?.classList.contains("anim-chip-layer--pinned")) return;
      const x = Number(line.getAttribute("x1"));
      const bw = chip.node.offsetWidth;
      const bh = chip.node.offsetHeight;
      const left = Math.max(4, Math.min(frame.clientWidth - 4 - bw, x - bw / 2));
      const top = 4;
      chip.node.style.transform = `translate(${left.toFixed(1)}px, ${top}px)`;
      line.setAttribute("x2", Math.max(left, Math.min(x, left + bw)).toFixed(1));
      line.setAttribute("y2", String(top + bh));
    };
  }

  /** The windowed block at the end value on show, flat x, y, z. */
  function highlightPoints() {
    return inPlane((n) => windowedAt(shown, n), shown, 0, N);
  }

  /** The camera looks along the front preset. */
  function looking() {
    const p = orbit?.pose();
    if (!view || !p) return "corner";
    const yaw = ((((p.yaw % 360) + 540) % 360) - 180) * (Math.PI / 180);
    return Math.cos(p.pitch * (Math.PI / 180)) * Math.cos(yaw) > 0.995 ? "front" : "corner";
  }

  /** Pitch of the camera now, degrees. */
  function pitch() {
    return orbit?.pose().pitch ?? presets.corner.pitch;
  }

  /** Place the family and the highlight from the end value on show. */
  function draw() {
    if (!scene || !view) return;
    const s = scene;
    const cut = pitch() < 60;
    const bg = tokenHex("--ambe-plot-bg");
    // The highlight's place in the family, as a fractional slice index.
    const deep = depthOf(shown);
    let at = 0;
    for (let i = 0; i + 1 < ENDS.length; i += 1) {
      const [d0, d1] = [depthOf(ENDS[i]), depthOf(ENDS[i + 1])];
      if (deep <= d0 && deep >= d1) at = i + (d0 - deep) / (d0 - d1 || 1);
    }
    /** @type {number[]} */
    const family = [];
    /** @type {number[]} */
    const colours = [];
    ENDS.forEach((end, i) => {
      if (end < laid - 1e-9 || Math.abs(end - shown) < 1e-6) return;
      const extra = cut && end > shown && !printing() ? CUTAWAY : 0;
      // The three named windows fade no further than two slices away, so
      // the tapered blocks at the back stay legible behind the rectangular.
      const away = named(end) ? Math.min(Math.abs(i - at), 2) : i - at;
      const colour = mix(fade(rampColor(depthOf(end)), away), bg, extra);
      const before = family.length;
      pairs(inPlane((n) => windowedAt(end, n), end, 0, N, EVERY), family);
      for (let k = before; k < family.length; k += 3) colours.push(colour);
    });
    if (!family.length) family.push(0, 0, 0, 0, 0, 0), colours.push(bg, bg);
    s.colour(colours);
    setSegments(s.family, family);
    s.family.userData.recolour?.();

    setSegments(s.tone, pairs(inPlane(toneAt, shown, 0, N)));
    setSegments(s.window, pairs(inPlane((n) => windowAt(shown, n), shown, 0, N)));
    setSegments(s.mirror, pairs(inPlane((n) => -windowAt(shown, n), shown, 0, N)));
    setSegments(s.next, pairs(inPlane((n) => windowedAt(shown, n - N), shown, N, X_RANGE[1])));
    const z = zOf(shown);
    s.band.position.set((MAP.x(N) + MAP.x(X_RANGE[1])) / 2, (BOX.min[1] + BOX.max[1]) / 2, z);
    const past = windowedAt(shown, N);
    const start = windowedAt(shown, 0);
    /** @type {number[]} */
    const joint = [];
    if (Math.abs(past - start) < 0.02) {
      // No step: a small ring where the copies meet.
      const r = 0.05;
      for (let i = 0; i < 16; i += 1) {
        const a0 = (i / 16) * 2 * Math.PI;
        const a1 = ((i + 1) / 16) * 2 * Math.PI;
        joint.push(MAP.x(N) + r * Math.cos(a0), MAP.y(start) + r * Math.sin(a0), z,
          MAP.x(N) + r * Math.cos(a1), MAP.y(start) + r * Math.sin(a1), z);
      }
    } else {
      joint.push(MAP.x(N), MAP.y(past), z, MAP.x(N), MAP.y(start), z);
    }
    setSegments(s.joint, joint);

    const top = highlightPoints();
    s.kit.set(top);
    s.kit.chip?.set({ text: chipText(shown) });

    frontPoints = [];
    for (let n = 0; n <= N; n += 4) {
      frontPoints.push({ at: [MAP.x(n), MAP.y(windowedAt(shown, n)), z], n, v: windowedAt(shown, n), kind: "block" });
      frontPoints.push({ at: [MAP.x(n), MAP.y(windowAt(shown, n)), z], n, v: windowAt(shown, n), kind: "window" });
    }
    // The next copy's start, the joint's two ends, and the band's corners.
    for (let n = N; n <= X_RANGE[1]; n += 2) {
      frontPoints.push({ at: [MAP.x(n), MAP.y(windowedAt(shown, n - N)), z], n, v: windowedAt(shown, n - N), kind: "next" });
    }
    frontPoints.push({ at: [MAP.x(N), MAP.y(past), z], n: N, v: past, kind: "joint" });
    const band = s.band.position;
    const [bw, bh] = [(MAP.x(X_RANGE[1]) - MAP.x(N)) / 2, (BOX.max[1] - BOX.min[1]) / 2];
    frontPoints.push({ at: [band.x - bw, band.y + bh, band.z], n: N, v: Y_RANGE[1], kind: "band" });
    frontPoints.push({ at: [band.x + bw, band.y - bh, band.z], n: X_RANGE[1], v: Y_RANGE[0], kind: "band" });
    view.requestRender();
  }

  /** The family and the rails hide when seen from the front: then it is the 2D plot. */
  function visibility() {
    if (!scene) return;
    const front = looking() === "front";
    scene.family.visible = !front;
    scene.rails.visible = !front;
    scene.band.visible = front;
    // The highlight's dashed outline of its plane too: the 2D plot has none.
    const outline = scene.kit.children.find((c) => /** @type {any} */ (c).material?.dashed);
    if (outline) outline.visible = !front;
    view?.requestRender();
  }

  function relabelScene() {
    if (!firstDrawn || !labels) return;
    const narrow = frame.clientWidth < 560;
    const front = looking() === "front";
    const mode = `${front}:${narrow}:${laid <= 0}`;
    if (mode === labelled) return;
    labelled = mode;
    const named3 = /** @type {const} */ (["rect", "hamming", "hann"]);
    /** @type {import("./lib/labels.js").Label[]} */
    const list = axisLabels(BOX, MAP, [
      {
        axis: "x",
        // On Front, the 2D plot's own axis title.
        name: front ? (narrow ? "sample (160 = 20 ms)" : "sample n (160 samples = 20 ms)") : narrow ? "sample" : "sample n",
        ticks: narrow ? [0, 80, N] : [0, 40, 80, 120, N],
      },
      { axis: "y", name: "", ticks: [-1, 0, 1], format: (v) => fmt(v, 0) },
      // Depth is named on the three windows' own blocks, below.
      ...(front || narrow ? [] : [{ axis: /** @type {const} */ ("z"), name: "window's value at the ends" }]),
    ]).filter((label) => label.text);
    if (!front && narrow) {
      // A phone has no room beside the blocks' left ends: the three named
      // windows are marked short, at their depths past the right end of
      // the box, level with the blocks' middle line.
      for (const key of named3) {
        const end = WINDOWS[key].end;
        list.push({ text: `${key === "rect" ? "rect" : WINDOWS[key].title} ${fmt(end)}`, at: [BOX.max[0] + 0.05, MAP.y(0), zOf(end)], align: "start" });
      }
    }
    if (front) {
      list.push({ text: narrow ? "next" : "next copy", at: [MAP.x(X_RANGE[1]), BOX.max[1], zOf(shown)], align: "end", dy: 12 });
    } else if (laid <= 0 && !narrow) {
      // The three named windows, on their blocks with their end values:
      // rectangular at the front's left end, Hamming and Hann at the right
      // end of theirs.
      list.push(
        { text: "rectangular, 1.00", at: [MAP.x(0) - 0.08, MAP.y(1), zOf(1)], align: "end" },
        { text: "Hamming, 0.08", at: [MAP.x(N) + 0.1, MAP.y(-WINDOWS.hamming.end), zOf(WINDOWS.hamming.end)], align: "start" },
        { text: "Hann, 0.00", at: [MAP.x(N) + 0.1, MAP.y(0), zOf(0)], align: "start" },
      );
    }
    labels.set(list);
  }

  /**
   * The fit: on Front the scene lies on the 2D plot's rectangle; elsewhere
   * the whole box fills the frame. Between them the frustum eases from one
   * to the other over 25 degrees.
   */
  const fit = () => {
    const cam = /** @type {any} */ (/** @type {ThreeContext} */ (ctx).camera);
    if (!cam.isOrthographicCamera) return;
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    const right = [m[0], m[1], m[2]];
    const up = [m[4], m[5], m[6]];
    let hw = 0;
    let hh = 0;
    for (const x of [BOX.min[0], BOX.max[0]]) {
      for (const y of [BOX.min[1], BOX.max[1]]) {
        for (const z of [BOX.min[2], BOX.max[2]]) {
          hw = Math.max(hw, Math.abs(x * right[0] + y * right[1] + z * right[2]));
          hh = Math.max(hh, Math.abs(x * up[0] + y * up[1] + z * up[2]));
        }
      }
    }
    const pad = W < 560 ? { l: 16, r: 56, t: 44, b: 60 } : { l: 80, r: 110, t: 30, b: 66 };
    const room = { w: W - pad.l - pad.r, h: H - pad.t - pad.b };
    const k = Math.min(room.w / (2 * hw), room.h / (2 * hh));
    const cx = pad.l + room.w / 2;
    const cy = pad.t + room.h / 2;
    let f = { left: -cx / k, right: (W - cx) / k, top: cy / k, bottom: -(H - cy) / k };
    const { plot } = layout(W, H);
    const g = frontFrustum({ width: W, height: H }, plot.area, BOX);
    const d = cam.position.clone().normalize();
    const near = Math.cos((25 * Math.PI) / 180);
    const t = smooth((d.z - near) / (1 - near));
    if (t > 0) {
      f = {
        left: lerp(f.left, g.left, t),
        right: lerp(f.right, g.right, t),
        top: lerp(f.top, g.top, t),
        bottom: lerp(f.bottom, g.bottom, t),
      };
    }
    Object.assign(cam, f);
  };

  let cutWas = pitch() < 60;
  orbit = createOrbit(ctx, {
    target: TARGET,
    fit,
    distance: DISTANCE,
    zoom: opts.look.zoom || 1,
    presets,
    start: presets[state.preset] ? state.preset : "corner",
    yaw: !opts.headOn,
    onDrag: opts.onDrag,
    onChange: () => {
      visibility();
      relabelScene();
      labels?.update();
      scene?.kit.chip?.update();
      const cut = pitch() < 60;
      if (cut !== cutWas) {
        cutWas = cut;
        draw();
      }
    },
  });

  let labelTimer = 0;
  /** The sentence for the 3D canvas's label (the orbit adds the zoom sentence). */
  function describe() {
    const seen = state.preset === "front" ? "from the front, as the 2D plot" : "from a corner";
    return `One block of a tone under every window from rectangular to Hann, in 3D, seen ${seen}. ` +
      "Depth is the window's value at the block's ends, spaced by its square root: 1.00 at the front is the " +
      "rectangular window, 0.08, a little over a quarter of the way forward, is Hamming and 0.00 at the back is Hann. Going back, the block's ends shrink to zero and its " +
      `middle keeps its size. The highlighted block is under the ${WINDOWS[state.window].name} window: ` +
      `${chipText(state.end)}, and ${jointText(state.end)}.`;
  }
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
  };
  ctx.viewSignal.addEventListener("abort", () => clearTimeout(labelTimer), { once: true });

  const timeline = ctx.timeline();

  /** Move the highlight from the end value on show to the state's. */
  const glide = () => {
    const from = shown;
    const to = state.end;
    if (Math.abs(from - to) < 1e-9) {
      draw();
      return;
    }
    void timeline.play("glide", {
      ms: duration("3d-build"),
      step: (t) => {
        shown = t >= 1 ? to : endAt(lerp(depthOf(from), depthOf(to), t));
        draw();
        if (t >= 1) void scene?.kit.pulse();
      },
    });
  };

  if (opts.intro) {
    // The first view: from the front, as the 2D plot under the rectangular
    // window, the camera turns to the corner while the highlight moves back
    // from 1.00 to 0.00, laying each block down as it passes and pausing on
    // Hamming and on Hann, then returns to the reader's window.
    played += 1;
    const to = presets[state.preset] ?? presets.corner;
    const turn = 2 * duration("3d-camera");
    orbit.set(presets.front);
    draw();
    void timeline.play("camera", {
      ms: turn,
      ease: "linear",
      delay: duration("slow"),
      build: true,
      step: (t) => {
        const e = smooth(t);
        orbit?.set({ yaw: lerp(0, to.yaw, e), pitch: lerp(0, to.pitch, e) });
      },
    });
    // In depth: from 1.00 to Hamming, pause, to Hann, hold, back to the
    // reader's. Each leg moves at an even pace in depth, not in end value.
    const hamming = depthOf(WINDOWS.hamming.end);
    const legs = [
      { ms: TO_HAMMING_MS, from: 1, to: hamming },
      { ms: HAMMING_MS, from: hamming, to: hamming },
      { ms: TO_HANN_MS, from: hamming, to: 0 },
      { ms: HANN_MS, from: 0, to: 0 },
    ];
    const sweep = legs.reduce((sum, leg) => sum + leg.ms, 0);
    const total = sweep + SETTLE_MS;
    void timeline.play("sweep", {
      ms: total,
      ease: "linear",
      delay: duration("slow") + 0.4 * turn,
      build: true,
      step: (t) => {
        let ms = t * total;
        if (t >= 1) {
          shown = state.end;
          laid = 0;
        } else if (ms < sweep) {
          for (const leg of legs) {
            if (ms <= leg.ms) {
              shown = endAt(lerp(leg.from, leg.to, smooth(leg.ms ? ms / leg.ms : 1)));
              break;
            }
            ms -= leg.ms;
          }
          laid = shown;
        } else {
          shown = endAt(lerp(0, depthOf(state.end), smooth((ms - sweep) / SETTLE_MS)));
          laid = 0;
        }
        draw();
        relabelScene();
        if (t >= 1) void scene?.kit.pulse();
      },
    });
  }

  if (TEST_HOOK) {
    TEST_HOOK.figures["window-shapes-3d"] = {
      get builds() { return builds; },
      get played() { return played; },
      pose: () => orbit?.pose() ?? null,
      zoom: () => orbit?.zoom() ?? 1,
      get frontPoints() { return frontPoints; },
      get looking() { return looking(); },
      get shown() { return shown; },
      get laid() { return laid; },
      get parts() {
        if (!scene) return {};
        return {
          family: scene.family.visible,
          rails: scene.rails.visible,
          band: scene.band.visible,
          blocks: scene.family.geometry.instanceCount / (N / EVERY),
          chip: scene.kit.chip?.node.textContent ?? "",
        };
      },
      /** CSS px in the frame of a scene point, through the live camera. */
      project: (/** @type {Vec} */ at) => {
        const v = new ctx.three.Vector3(...at).project(ctx.camera);
        return [((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight];
      },
    };
    ctx.viewSignal.addEventListener("abort", () => {
      if (TEST_HOOK) delete TEST_HOOK.figures["window-shapes-3d"];
    }, { once: true });
  }

  await ctx.drawn();
  firstDrawn = true;
  relabelScene();
  return {
    update: (next) => {
      Object.assign(state, /** @type {WindowState} */ (next));
      timeline.finish();
      laid = 0;
      glide();
      relabelScene();
      relabel();
    },
    preset: (name) => {
      void orbit?.go(name);
      relabel();
    },
    describe,
    close: () => ctx.dispose(),
  };
}

