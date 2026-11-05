// @ts-check
/* ===========================================================================
 * anim-probe-3d.js: the probe figure's 3D view (three-everywhere §5.1).
 * ---------------------------------------------------------------------------
 * The 160 samples run left to right along x. At each sample a stem goes out
 * from the time axis to that sample's two products: the cosine test's up
 * (+y), the sine test's toward the back (-z). The running sum, divided by 80,
 * is the thick path through the same space, so it ends on the plane of the
 * two sums at the block's end, where the ring marks a length of 80. On the
 * recording's own frequency the stem tips circle, at the sum frequency,
 * round a centre half a unit out in the direction of the phase; the path
 * walks steadily out to the ring. Off it, the path curls back.
 *
 * Presets: Top (pitch 90) shows the sine row, Front (yaw 0) the cosine
 * row, End on (yaw 90) the plane of the sums, and Corner shows it whole
 * (looking more along the time axis on a tall frame). Resting on a preset,
 * its subject is framed centred; only the opening's first frame lies on the
 * 2D panels' own rectangles (lib/orbit.js frontFrustum), so the hand-off
 * from the 2D canvas does not jump. Each preset hides what it sees edge on.
 * Where the stems are context for the path (End on, and Corner with both
 * tests) they fade toward the background (VL3).
 *
 * Its one animation (VL6): "Multiplying by the test wave and adding up
 * gives a large sum only at the matching frequency." From Top, a playhead
 * walks the samples left to right: each stem appears as it is reached, the
 * running sum follows and the chip counts up. Unless the step rests on
 * Top, the camera then turns to End on, where the path's end lands on the
 * plane point, and settles on the step's preset. A step that changes the
 * numbers morphs the stems and the path to them.
 *
 * It computes no model data: the products and sums come from the 2D
 * module's state (lib/probe.js); only scene coordinates are worked out here.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { PLANE, ROW, SCALE, chipText, degrees, fmt, layout } from "./anim-probe.js";
import { addHighlight } from "./lib/highlight.js";
import { createLabels } from "./lib/labels.js";
import { createOrbit, frontFrustum } from "./lib/orbit.js";
import { N } from "./lib/probe.js";
import { contactShadow, darkGround, fade, fatLines, floor, fog, mix, printing, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./anim-probe.js").ProbeState} ProbeState */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {[number, number, number]} Vec */

/** Half the time axis, scene units: sample 0 at -HALF, sample 160 at HALF. */
const HALF = 3;
/** @param {number} n sample */
const X = (n) => -HALF + (2 * HALF * n) / N;
const X0 = X(0);
const X1 = X(N);
/** The box's half size across: products are at most 1, the ring is at 1. */
const E = ROW;
/** The plane's half size, scene units (PLANE sum units). */
const EP = PLANE / SCALE;
/** @type {import("./lib/orbit.js").SceneBox} */
const BOX = { min: [X0, -E, -E], max: [X1, E, E] };
const DISTANCE = 14;

/** @type {Record<string, Pose>} */
const PRESETS = {
  end: { yaw: 90, pitch: 0 },
  top: { yaw: 0, pitch: 90 },
  front: { yaw: 0, pitch: 0 },
  corner: { yaw: 38, pitch: 24 },
};

/**
 * On a tall frame (a phone) the corner looks more along the time axis and
 * from higher, so the box stands taller and fills more of the frame.
 */
const TALL_CORNER = { yaw: 70, pitch: 40 };

/**
 * What each preset is about, framed centred when the camera rests on it:
 * the sine row (Top), the cosine row (Front), the plane of the sums with
 * its ring (End on), or the whole box.
 * @type {Record<string, import("./lib/orbit.js").SceneBox>}
 */
const SUBJECTS = {
  end: { min: [X1, -EP, -EP], max: [X1, EP, EP] },
  top: { min: [X0, 0, -E], max: [X1, 0, E] },
  front: { min: [X0, -E, 0], max: [X1, E, 0] },
  corner: BOX,
};

/** What each matched preset sees edge on, and hides. */
/** @type {Record<string, string[]>} */
const HIDDEN = {
  end: ["axis"],
  top: ["plane"],
  front: ["plane"],
  corner: [],
};

/**
 * A polyline as segment pairs, from scene points.
 * @param {ArrayLike<number>} p flat x, y, z
 * @returns {number[]}
 */
function pairs(p) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i + 5 < p.length; i += 3) out.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
  return out;
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
const lerp = (a, b, t) => a + (b - a) * t;

/** @param {number} t */
const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * What the view draws, in scene units: each stem's tip (y, z) and the
 * running sum's (y, z), per sample. Taken from the state's arrays.
 * @param {ProbeState} s
 */
function target(s) {
  const d = s.data;
  const tipY = new Float64Array(N);
  const tipZ = new Float64Array(N);
  const runY = new Float64Array(N);
  const runZ = new Float64Array(N);
  for (let n = 0; n < N; n += 1) {
    tipY[n] = s.cosine ? d.cosineProducts[n] : 0;
    tipZ[n] = -d.sineProducts[n];
    runY[n] = s.cosine ? d.cosineRun[n] / SCALE : 0;
    runZ[n] = -d.sineRun[n] / SCALE;
  }
  return { tipY, tipZ, runY, runZ };
}

/** @typedef {ReturnType<typeof target>} Shape */

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  const state = /** @type {ProbeState} */ (opts.state);
  let morphs = state.morphs;
  /** What is drawn now; a morph moves it toward target(state). */
  let shown = target(state);
  /** How far each stem has grown (the first-view animation). */
  const grown = new Float64Array(N).fill(opts.intro ? 0 : 1);
  let builds = 0;
  let played = 0;
  let morphing = false;
  /** @type {ReturnType<typeof parts> | null} */
  let scene = null;
  /** @type {ThreeContext | null} */
  let view = null;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  let labelled = "";
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** @type {{at: Vec, n: number, kind: "tip" | "run", sine: number, cosine: number}[]} */
  let frontPoints = [];

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
      fog(c, DISTANCE, 2 * HALF);
      draw();
      visibility();
      relabelScene();
    },
  });
  if (!ctx) return null;

  /** Everything the scene holds, built from tokens; draw() fills it in. */
  function parts(/** @type {ThreeContext} */ c) {
    const T = c.three;
    const add = (/** @type {import("three").Object3D} */ o) => {
      c.scene.add(o);
      return o;
    };
    add(floor(c, { extent: BOX, step: [(2 * HALF) / 4, E / 2] }));
    add(contactShadow(c, { x: [X0, X1], z: [-E, E], y: -E }));

    // The time axis the stems stand on.
    const axisGeometry = new T.BufferGeometry();
    axisGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array([X0, 0, 0, X1, 0, 0, X0, -1, 0, X0, 1, 0, X0, 0, -1, X0, 0, 1]), 3));
    const axis = new T.LineSegments(axisGeometry, c.paint(new T.LineBasicMaterial(), "--ambe-plot-axis"));
    add(axis);

    // The plane of the two sums, at the block's end: a faint square, its
    // two axes and the ring at 80.
    const plane = new T.Group();
    const square = new T.Mesh(new T.PlaneGeometry(2 * EP, 2 * EP), c.paint(new T.MeshBasicMaterial({
      side: T.DoubleSide, depthWrite: false,
    }), "--ambe-accent-soft"));
    square.rotation.y = Math.PI / 2;
    const frameGeometry = new T.BufferGeometry();
    frameGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
      0, -EP, -EP, 0, EP, -EP, 0, EP, -EP, 0, EP, EP, 0, EP, EP, 0, -EP, EP, 0, -EP, EP, 0, -EP, -EP,
      0, 0, -EP, 0, 0, EP, 0, -EP, 0, 0, EP, 0,
    ]), 3));
    const planeAxes = new T.LineSegments(frameGeometry, c.paint(new T.LineBasicMaterial(), "--ambe-plot-axis"));
    /** @type {number[]} */
    const ring = [];
    for (let i = 0; i <= 120; i += 1) ring.push(0, Math.sin((i / 120) * 2 * Math.PI), Math.cos((i / 120) * 2 * Math.PI));
    const ringLine = fatLines(c, pairs(ring), "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.06, gap: 0.05 });
    plane.add(square, planeAxes, ringLine);
    plane.position.x = X1;
    add(plane);

    // The stems, one per sample, on the ramp by sample index; and the
    // curve through their tips, thinner and faded.
    /** @type {number[]} */
    let stemColours = [];
    /** @type {number[]} */
    let tipColours = [];
    const stems = fatLines(c, [0, 0, 0, 0, 0, 0], () => stemColours, 1.75);
    const tips = fatLines(c, [0, 0, 0, 0, 0, 0], () => tipColours, 1.25, { fog: true });
    add(stems);
    add(tips);

    // The subject: the running sum, and its end on the plane.
    /** @type {number[]} */
    const flat = [];
    for (let n = 0; n <= N; n += 1) flat.push(X(n), 0, 0);
    const kit = addHighlight(c, flat, { fill: false, chip: chipText(state) });
    // The kit's dashed outline frames a curve in one plane; this path is
    // not in one, so the outline would frame nothing.
    for (const child of kit.children) {
      const material = /** @type {any} */ (child).material;
      if (material?.dashed) child.visible = false;
    }
    add(kit);
    const end = new T.Mesh(new T.SphereGeometry(0.07, 20, 14), c.paint(new T.MeshBasicMaterial({ depthTest: false }), "--ambe-highlight"));
    end.renderOrder = 14;
    add(end);

    return {
      axis, plane, stems, tips, kit, end,
      /**
       * Per-vertex colours for the stems and the tip curve, for `count`
       * stems; `context` fades the stems toward the background (VL3), where
       * they are context for the path rather than the 2D row itself: most
       * end on, where they lie under the path, and less from a corner.
       */
      colour: (/** @type {number} */ count, /** @type {"" | "end" | "corner"} */ context) => {
        stemColours = [];
        tipColours = [];
        const ground = tokenHex("--ambe-plot-bg");
        const dark = darkGround();
        const amount = !context || printing() ? 0 : context === "end" ? (dark ? 0.62 : 0.5) : dark ? 0.45 : 0.35;
        for (let n = 0; n < count; n += 1) {
          const colour = mix(rampColor(n / (N - 1)), ground, amount);
          stemColours.push(colour, colour);
          if (n + 1 < count) {
            const faded = fade(colour, 4);
            tipColours.push(faded, faded);
          }
        }
      },
    };
  }

  /**
   * Set a fat line's segments; it hides when there are none.
   * @param {import("three/addons/lines/LineSegments2.js").LineSegments2} line
   * @param {number[]} segments
   */
  function put(line, segments) {
    line.userData.empty = segments.length === 0;
    line.visible = !line.userData.empty && !line.userData.off;
    if (!segments.length) return;
    // A new geometry whenever the count changes: three caches an instanced
    // geometry's draw count from its first draw.
    const count = line.geometry.attributes.instanceStart?.count ?? 0;
    if (count !== segments.length / 6 && view) {
      line.geometry.dispose();
      line.geometry = new view.lines.LineSegmentsGeometry();
    }
    setSegments(line, segments);
    line.userData.recolour?.();
  }

  /** Place the stems and the path from `shown`, grown as far as `grown`. */
  function draw() {
    if (!scene || !view) return;
    const s = scene;
    let count = 0;
    while (count < N && grown[count] > 0) count += 1;
    /** @type {number[]} */
    const stems = [];
    /** @type {number[]} */
    const tipPath = [];
    /** The running sum: 0 before the first sample, and the sum after n + 1 samples at n + 1. */
    const path = count ? [X0, 0, 0] : [];
    for (let n = 0; n < count; n += 1) {
      const g = grown[n];
      const x = X(n);
      stems.push(x, 0, 0, x, shown.tipY[n] * g, shown.tipZ[n] * g);
      tipPath.push(x, shown.tipY[n] * g, shown.tipZ[n] * g);
      // It reaches the next sample's place as this sample's stem grows.
      const y = lerp(n ? shown.runY[n - 1] : 0, shown.runY[n], g);
      const z = lerp(n ? shown.runZ[n - 1] : 0, shown.runZ[n], g);
      path.push(lerp(x, X(n + 1), g), y, z);
    }
    // The stems are the 2D rows on Top and Front; elsewhere, once they stand
    // out of one plane (the cosine test) or are seen end on, they are
    // context for the path.
    const mode = looking();
    s.colour(count, mode === "end" ? "end" : mode === "corner" && state.cosine ? "corner" : "");
    put(s.stems, stems);
    put(s.tips, pairs(tipPath));
    const ends = path.length >= 6;
    s.kit.visible = ends;
    // The chip, its leader and its dot wait for the path.
    const layer = s.kit.chip?.node.parentElement;
    if (layer) layer.style.visibility = ends ? "" : "hidden";
    s.end.visible = count > 0;
    // Always N points (the last repeated while the path grows): the kit's
    // lines keep the draw count of their first geometry.
    while (path.length && path.length < 3 * (N + 1)) path.push(path[path.length - 3], path[path.length - 2], path[path.length - 1]);
    if (ends) s.kit.set(path);
    if (count > 0) {
      /** @type {Vec} */
      const last = [path[path.length - 3], path[path.length - 2], path[path.length - 1]];
      s.end.position.set(...last);
      // The sum so far: it counts up as the stems grow, and follows a morph.
      const sum = state.cosine ? Math.hypot(last[1], last[2]) * SCALE : -last[2] * SCALE;
      s.kit.chip?.set({ text: count === N && grown[N - 1] >= 1 && shownIsTarget() ? chipText(state) : `sum: ${fmt(sum)}`, at: last });
    }

    // Probes: the path's end and eight samples of stem tips and running sum.
    frontPoints = [];
    if (count === N) {
      frontPoints.push({ at: [X1, shown.runY[N - 1], shown.runZ[N - 1]], n: N, kind: "run", sine: -shown.runZ[N - 1] * SCALE, cosine: shown.runY[N - 1] * SCALE });
      for (let k = 0; k < 8; k += 1) {
        const n = Math.round(((k + 0.5) / 8) * (N - 1));
        frontPoints.push({ at: [X(n), shown.tipY[n], shown.tipZ[n]], n, kind: "tip", sine: -shown.tipZ[n], cosine: shown.tipY[n] });
        frontPoints.push({ at: [X(n + 1), shown.runY[n], shown.runZ[n]], n: n + 1, kind: "run", sine: -shown.runZ[n] * SCALE, cosine: shown.runY[n] * SCALE });
      }
    }
    view.requestRender();
  }

  /** True when nothing is morphing: `shown` is the state's own numbers. */
  function shownIsTarget() {
    return !morphing;
  }

  /** Set the labels again, and the stems' strength, when the view changes between presets. */
  function relabelScene() {
    const mode = looking();
    // The cosine test's sum is labelled only while that test runs.
    const key = `${mode} ${state.cosine}`;
    if (!labels || key === labelled) return;
    const was = labelled;
    labelled = key;
    labels.set(labelList(mode));
    if (was) draw();
  }

  /**
   * The labels for a view: the time axis, the two products, and the sums.
   * @param {string} mode
   * @returns {import("./lib/labels.js").Label[]}
   */
  function labelList(mode) {
    const narrow = frame.clientWidth < 450;
    /** @type {import("./lib/labels.js").Label[]} */
    const out = [];
    /** @type {Vec} */
    const along = [1, 0, 0];
    if (mode !== "end") {
      const y = -E;
      const z = E;
      for (const n of [0, 80, 160]) out.push({ text: String(n), at: [X(n), y, z], align: "middle", along, tick: true, dy: 14 });
      out.push({ text: "sample n", at: [0, y, z], align: "middle", along, dy: 30 });
    }
    if (mode === "front") {
      out.push({ text: narrow ? "cosine × recording" : "cosine test × recording", at: [X0, E * 0.85, 0], align: "start", dy: -10 });
    } else if (mode === "top") {
      out.push({ text: narrow ? "sine × recording" : "sine test × recording", at: [X0, 0, -E * 0.85], align: "start", dy: -10 });
    } else if (mode === "end") {
      // Inside the plane, along its two axes, so it can fill the frame.
      for (const v of [-80, 80]) {
        out.push({ text: String(v), at: [X1, 0, -v / SCALE], align: "middle", tick: true, dy: 12 });
        out.push({ text: String(v), at: [X1, v / SCALE, EP], align: "end", tick: true });
      }
      out.push({ text: "sine test sum", at: [X1, 0, -EP], align: "end", dy: -10 });
      if (state.cosine) out.push({ text: "cosine test sum", at: [X1, EP, 0], align: "start", dy: 10 });
    } else {
      out.push({ text: "cosine", at: [X0, 1.08, 0], align: "middle", dy: -8 });
      // Beyond the box, clear of the stems.
      out.push({ text: "sine", at: [X0 - 0.3, 0, -1.3 * E], align: "end" });
      if (!narrow) out.push({ text: "sums, ring at 80", at: [X1, EP, -EP], align: "start", dy: -10 });
    }
    return out;
  }

  /** The preset the camera looks along now, if any. */
  function looking() {
    if (!view) return "corner";
    const d = view.camera.position.clone().normalize();
    if (d.x > 0.995) return "end";
    if (d.y > 0.995) return "top";
    if (d.z > 0.995) return "front";
    return "corner";
  }

  /** Hide what the current view sees edge on. */
  function visibility() {
    if (!scene) return;
    const hidden = HIDDEN[looking()];
    for (const name of /** @type {const} */ (["axis", "plane"])) {
      scene[name].visible = !hidden.includes(name);
    }
  }

  /**
   * How far the matched presets lie on the 2D panels' own rectangles (1)
   * rather than framing their subject centred (0). 1 only for the frame
   * that takes over from the 2D canvas at the opening; it eases to 0 before
   * the walk starts.
   */
  let match = 0;

  /**
   * The fit. Resting on a preset, its subject (SUBJECTS) is centred and
   * fills the frame, with room for its labels; between presets the fit
   * eases from one to the next over 25 degrees. With `match`, Top, Front
   * and End on lie on the 2D sine row, cosine row and plane instead.
   */
  const fit = () => {
    const cam = /** @type {any} */ (/** @type {ThreeContext} */ (ctx).camera);
    if (!cam.isOrthographicCamera) return;
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    const size = { width: W, height: H };
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    const right = [m[0], m[1], m[2]];
    const up = [m[4], m[5], m[6]];
    const narrow = W < 480;
    // End on keeps its axis names and ticks inside the plane, so the plane
    // can fill the frame's height; the rows and the box keep room below
    // for the sample axis (labels.js keeps the bottom 56 px clear).
    const pads = {
      rest: narrow ? { l: 22, r: 22, t: 30, b: 50 } : { l: 56, r: 56, t: 28, b: 46 },
      end: narrow ? { l: 30, r: 14, t: 26, b: 18 } : { l: 56, r: 56, t: 26, b: 18 },
    };
    /**
     * @param {import("./lib/orbit.js").SceneBox} box
     * @param {{l: number, r: number, t: number, b: number}} [pad]
     */
    const centred = (box, pad = pads.rest) => {
      const room = { w: W - pad.l - pad.r, h: H - pad.t - pad.b };
      let r0 = Infinity;
      let r1 = -Infinity;
      let u0 = Infinity;
      let u1 = -Infinity;
      for (const x of [box.min[0], box.max[0]]) {
        for (const y of [box.min[1], box.max[1]]) {
          for (const z of [box.min[2], box.max[2]]) {
            const r = x * right[0] + y * right[1] + z * right[2];
            const u = x * up[0] + y * up[1] + z * up[2];
            r0 = Math.min(r0, r);
            r1 = Math.max(r1, r);
            u0 = Math.min(u0, u);
            u1 = Math.max(u1, u);
          }
        }
      }
      const k = Math.min(room.w / Math.max(1e-6, r1 - r0), room.h / Math.max(1e-6, u1 - u0));
      const cx = pad.l + room.w / 2;
      const cy = pad.t + room.h / 2;
      const cr = (r0 + r1) / 2;
      const cu = (u0 + u1) / 2;
      return { left: cr - cx / k, right: cr + (W - cx) / k, top: cu + cy / k, bottom: cu - (H - cy) / k };
    };
    /** @param {typeof f} a @param {typeof f} b @param {number} t */
    const blend = (a, b, t) => ({
      left: lerp(a.left, b.left, t),
      right: lerp(a.right, b.right, t),
      top: lerp(a.top, b.top, t),
      bottom: lerp(a.bottom, b.bottom, t),
    });
    let f = centred(SUBJECTS.corner);
    const d = cam.position.clone().normalize();
    const near = Math.cos((25 * Math.PI) / 180);
    for (const [w, name] of /** @type {const} */ ([[d.x, "end"], [d.y, "top"], [d.z, "front"]])) {
      const t = smooth((w - near) / (1 - near));
      if (t <= 0) continue;
      let g = centred(SUBJECTS[name], name === "end" ? pads.end : pads.rest);
      if (match > 0) {
        const geo = layout(W, H);
        const area = name === "end" ? geo.plane.area : name === "top" ? geo.rows[1].area : geo.rows[2].area;
        const rect = { x: area.x, y: area.y, width: area.width, height: area.height };
        const box = name === "end"
          ? { min: [-EP, -EP, 0], max: [EP, EP, 0] }
          : { min: [X0, -E, 0], max: [X1, E, 0] };
        g = blend(g, frontFrustum(size, rect, /** @type {import("./lib/orbit.js").SceneBox} */ (box)), match);
      }
      f = blend(f, g, t);
    }
    Object.assign(cam, f);
  };

  // A tall frame (a phone) takes the taller corner.
  const presets = frame.clientHeight > 1.25 * frame.clientWidth ? { ...PRESETS, corner: TALL_CORNER } : PRESETS;

  orbit = createOrbit(ctx, {
    target: [0, 0, 0],
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
    },
  });

  let labelTimer = 0;
  /** The sentence for the 3D canvas's label (the orbit adds the zoom sentence). */
  function describe() {
    const d = state.data;
    const seen = {
      end: "end on, the plane of the two sums",
      top: "from above, the sine test's products",
      front: "from the front, the cosine test's products",
      corner: "from a corner",
    }[state.preset];
    const sums = state.cosine
      ? `The path ends on the plane of the two sums at sine sum ${fmt(d.sine)} and cosine sum ${fmt(d.cosine)}, ` +
        (d.length < 1e-6 ? "at the centre, length 0." : `${fmt(d.length)} from the centre at ${degrees(d.angle)} degrees.`)
      : `The cosine test is off, so every stem lies flat and the path ends at sine sum ${fmt(d.sine)}.`;
    return `In 3D, seen ${seen}: the 160 samples run left to right, the recording at 200 Hz with phase ${state.phase} degrees ` +
      `tested at ${state.f} Hz. Each stem is one sample's products, and the thick path is their running sum. ${sums}`;
  }
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
  };
  ctx.viewSignal.addEventListener("abort", () => clearTimeout(labelTimer), { once: true });

  const timeline = ctx.timeline();

  /** Morph what is drawn to the state's numbers. */
  function morph() {
    const from = shown;
    const to = target(state);
    morphing = true;
    return timeline.play("morph", {
      ms: duration("3d-build"),
      step: (t) => {
        morphing = t < 1;
        shown = {
          tipY: from.tipY.map((v, i) => lerp(v, to.tipY[i], t)),
          tipZ: from.tipZ.map((v, i) => lerp(v, to.tipZ[i], t)),
          runY: from.runY.map((v, i) => lerp(v, to.runY[i], t)),
          runZ: from.runZ.map((v, i) => lerp(v, to.runZ[i], t)),
        };
        draw();
      },
    });
  }

  if (opts.intro) {
    // The first view. It takes over from the 2D canvas on Top, lying on the
    // 2D sine row, and eases to the row centred. Then a playhead walks the
    // samples left to right: each stem appears as the playhead reaches it,
    // the running sum follows it and the chip counts up (linear, since it
    // follows time). Unless the step rests on Top, the camera then turns to
    // End on, where the path's end lands on the plane point, holds a beat
    // and settles on the step's preset.
    played += 1;
    grown.fill(0);
    const reframe = 300;
    const walk = 2200;
    const from = presets.top;
    const via = presets.end;
    const to = presets[state.preset] ?? presets.corner;
    const turns = state.preset !== "top";
    const lead = reframe + walk + 300;
    const turn = turns ? 1.4 * duration("3d-camera") : 0;
    const hold = turns ? duration("slow") : 0;
    const settle = turns ? duration("3d-camera") : 0;
    const total = lead + turn + hold + settle;
    match = 1;
    orbit.set(from);
    void timeline.play("walk", {
      ms: total,
      ease: "linear",
      build: true,
      step: (t) => {
        const ms = t * total;
        const head = Math.max(0, Math.min(1, (ms - reframe) / walk)) * N;
        let moved = false;
        for (let i = 0; i < N; i += 1) {
          const g = Math.max(0, Math.min(1, head - i));
          if (g !== grown[i]) {
            grown[i] = g;
            moved = true;
          }
        }
        match = 1 - smooth(ms / reframe);
        /** @param {Pose} a @param {Pose} b @param {number} u */
        const go = (a, b, u) => {
          const e = smooth(u);
          orbit?.set({ yaw: lerp(a.yaw, b.yaw, e), pitch: lerp(a.pitch, b.pitch, e) });
        };
        if (ms <= lead) go(from, from, 1);
        else if (ms <= lead + turn) go(from, via, (ms - lead) / turn);
        else if (ms <= lead + turn + hold) go(via, via, 1);
        else go(via, to, (ms - lead - turn - hold) / Math.max(1, settle));
        if (moved || t >= 1) draw();
      },
    });
  }

  if (TEST_HOOK) {
    TEST_HOOK.figures["probe-3d"] = {
      get builds() { return builds; },
      get played() { return played; },
      pose: () => orbit?.pose() ?? null,
      zoom: () => orbit?.zoom() ?? 1,
      get frontPoints() { return frontPoints; },
      get looking() { return looking(); },
      /** Lay Top, Front and End on on the 2D panels (the opening's first frame). */
      matchPlot: (/** @type {boolean} */ on) => {
        match = on ? 1 : 0;
        orbit?.set(orbit.pose());
      },
      /** Stems drawn, and whether the path and the plane show. */
      get parts() {
        if (!scene) return {};
        return {
          stems: [scene.stems.visible, scene.stems.geometry.attributes.instanceStart?.count ?? 0],
          path: scene.kit.visible,
          plane: scene.plane.visible,
          end: scene.end.position.toArray(),
        };
      },
      /** CSS px in the frame of a scene point, through the live camera. */
      project: (/** @type {Vec} */ at) => {
        const v = new ctx.three.Vector3(...at).project(ctx.camera);
        return [((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight];
      },
    };
    ctx.viewSignal.addEventListener("abort", () => {
      if (TEST_HOOK) delete TEST_HOOK.figures["probe-3d"];
    }, { once: true });
  }

  await ctx.drawn();
  return {
    update: (next) => {
      Object.assign(state, /** @type {ProbeState} */ (next));
      if (state.morphs !== morphs) {
        morphs = state.morphs;
        void morph();
      } else {
        timeline.finish();
        shown = target(state);
        draw();
      }
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
