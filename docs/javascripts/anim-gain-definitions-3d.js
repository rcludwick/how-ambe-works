// @ts-check
/* ===========================================================================
 * anim-gain-definitions-3d.js: the gain-definitions figure's 3D view
 * (three-everywhere design §5.9).
 * ---------------------------------------------------------------------------
 * Harmonic number runs left to right, level (dB relative to the frame's
 * G_E) up, and spread into depth: a real axis in dB, from 0 at the front
 * to 28 at the back. The selected frame is a comb at its own spread (a
 * line through its tips, thin stems and a frosted fill) in the highlight,
 * with its G_E line (solid, at 0), its G_L line (dashed) and a chip
 * stating its spread and gap, anchored on a bracket that spans the gap.
 * About 24 other frames of the step's recordings, picked by spread
 * quantile, stand at their spreads as thin lines through their tips, on
 * the ramp by spread. On the left wall, every frame of the eight
 * recordings is a pair of markers at its spread: G_E (square, at 0) and
 * G_L (dot, on the ramp by recording) below it; frames the step has not
 * loaded are faded. An equal-spread partner is drawn in ink: its comb
 * dotted with open tips, its G_L dotted, its own bracket and chip.
 *
 * Presets: Front is the 2D comb panel, on its rectangle (lib/orbit.js
 * frontFrustum), with the other combs and the wall hidden. Side looks
 * along k: every frame's G_L against its spread, the 2D scatter, filling
 * the frame. Past a yaw of about 70 degrees the combs are edge on and
 * carry nothing, so they hide: the highlight becomes a ring on the
 * frame's G_L marker, the partner a dotted ink ring, each with a bracket
 * from 0 to its gap. Corner shows it whole.
 *
 * Its one animation (VL6): "At equal spread the two gain definitions
 * differ by different amounts, so no constant converts one to the other."
 * From Front, the combs and the markers slide back to their spread in
 * order, while the camera turns to the corner; it then turns to Side,
 * where every G_L marker drops from 0 to its gap, so the gap-against-spread
 * scatter appears. It holds there while the equal-spread pair is ringed
 * and bracketed, with the chip "same spread, gap 17.7 to 36.9 dB", then
 * settles on the step's preset. Entering the equal-spread step plays the
 * drop and the brackets again. New data grows its combs; a new frame
 * pulses the highlight.
 *
 * It computes no model data: every level, gain and spread comes from the 2D
 * module's records; only scene coordinates are worked out here.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import {
  CLIPS, DB, DB_TICKS, K_MAX, K_TICKS, SIGMA_MAX, SIGMA_TICKS, chipText, fmt1, frameName, layout, rampT,
} from "./anim-gain-definitions.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createChip, createLabels } from "./lib/labels.js";
import { createOrbit, frontFrustum } from "./lib/orbit.js";
import { toScene } from "./lib/scene.js";
import {
  contactShadow, fade, fatLines, floor, fog, frostedFill, mix, rampColor, setFill, setSegments, tokenHex,
} from "./lib/style.js";

/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./anim-gain-definitions.js").GainState} GainState */
/** @typedef {import("./anim-gain-definitions.js").GainRecord} GainRecord */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {import("three/addons/lines/LineSegments2.js").LineSegments2} Fat */
/** @typedef {[number, number, number]} Vec */

const MAP = toScene({ x: [0, K_MAX], y: DB, z: [SIGMA_MAX, 0] }, { x: 6, y: 3.2, z: 4 });
const BOX = MAP.box;
const [X0, Y0, Z0] = BOX.min;
const [X1, Y1, Z1] = BOX.max;
const DISTANCE = 14;
/** The kit keeps the point count it is made with: room for every stem. */
const MAX_STEMS = K_MAX - 1;
/** Other combs drawn, picked by spread quantile. */
const CONTEXT = 24;

/** @type {Record<string, Pose>} */
const PRESETS = { front: { yaw: 0, pitch: 0 }, side: { yaw: 90, pitch: 0 }, corner: { yaw: 44, pitch: 20 } };
/**
 * What each view sees edge on or does not need, and hides. "side" holds
 * from a yaw of about 70 degrees (SIDEWAYS), where every comb is edge on.
 * @type {Record<string, string[]>}
 */
const HIDDEN = {
  front: ["context", "wall", "marks", "rings"],
  side: ["context", "fill", "teeth", "kit", "ge", "gl", "partner", "partnerGl", "tips"],
  corner: ["rings"],
};
/** The camera's x direction past which the view counts as Side: sin 70 degrees. */
const SIDEWAYS = Math.sin((70 * Math.PI) / 180);
/** How far, in dB of spread, a Side bracket stands off its frame's column. */
const SIDE_OFF = 1.1;
/** How far the wall marks of frames the step has not loaded fade. */
const DIM = 0.62;

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} t */
const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
/** Item i of n, staggered across 60% of a track at t. @param {number} t @param {number} i @param {number} n */
const staggered = (t, i, n) => smooth((t * 1.6 - (0.6 * i) / Math.max(1, n - 1)));

/** @param {GainRecord} r @param {number} k 1..L */
const rel = (r, k) => r.levels[k - 1] - r.ge;

/**
 * The other combs: CONTEXT frames at evenly spaced spread quantiles, never
 * the selected one or its partner.
 * @param {GainState} s
 * @returns {GainRecord[]}
 */
function contextOf(s) {
  const sel = s.records[s.index];
  const pool = s.records.filter((r) => r !== sel && r !== s.partner);
  if (pool.length <= CONTEXT) return pool;
  return Array.from({ length: CONTEXT }, (_, j) => pool[Math.round(((j + 0.5) / CONTEXT) * (pool.length - 1))]);
}

/** A white disc, so the G_L markers are round and the G_E ones square. */
function discTexture(/** @type {ThreeContext} */ c) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  g.fillStyle = "white";
  g.beginPath();
  g.arc(32, 32, 30, 0, 2 * Math.PI);
  g.fill();
  return c.track(new c.three.CanvasTexture(canvas));
}

/**
 * A white ring, solid or dotted, for the rings on the G_L markers and the
 * partner's open tips.
 * @param {ThreeContext} c
 * @param {boolean} dotted
 */
function ringTexture(c, dotted) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  g.strokeStyle = "white";
  g.lineWidth = dotted ? 9 : 8;
  if (dotted) g.setLineDash([9, 7]);
  g.beginPath();
  g.arc(32, 32, 26, 0, 2 * Math.PI);
  g.stroke();
  return c.track(new c.three.CanvasTexture(canvas));
}

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  const state = /** @type {GainState} */ (opts.state);
  let loads = state.loads;
  let selected = state.records[state.index] ?? null;
  /** The step had an equal-spread pair at the last update. */
  let partnered = Boolean(state.partner);
  /** How far each item has slid back (intro) and grown (new data), 0 to 1. */
  let slid = opts.intro ? 0 : 1;
  let grown = 1;
  /** How far the G_L markers have dropped from 0 to their gap. */
  let dropped = opts.intro ? 0 : 1;
  /** How far the brackets have grown and the rings shown. */
  let marked = opts.intro ? 0 : 1;
  /** How far the wall marks of recordings the step has not loaded have faded. */
  let dim = opts.intro ? 0 : 1;
  /** The first view's hold on Side, where the equal-spread pair of all eight is marked. */
  let holding = false;
  let builds = 0;
  let played = 0;
  let replays = 0;
  /** The first view's animation is running: new data joins it, unfinished. */
  let introRunning = false;
  /** The view the scene was last drawn for: Side, or not. */
  let drawnSideways = false;
  /** The chips were last placed below a phone's Front comb. */
  let drawnLow = false;
  /** @type {ReturnType<typeof parts> | null} */
  let scene = null;
  /** @type {ThreeContext | null} */
  let view = null;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  let labelled = "";
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** @type {{at: Vec, k: number, level: number}[]} */
  let frontPoints = [];
  /** @type {{at: Vec, sigma: number, level: number}[]} */
  let sidePoints = [];
  /** Where the two chips point, for the tests. @type {{chip: Vec | null, partner: Vec | null}} */
  let anchors = { chip: null, partner: null };

  /** The wall's frames: all eight recordings once the 2D module has them. */
  const wallOf = () => (state.all?.length ? state.all : state.records);

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
      fog(c, DISTANCE, Z1 - Z0);
      draw();
      visibility();
      relabelScene();
    },
  });
  if (!ctx) return null;

  /** Everything the scene holds, built from tokens; draw() places it. */
  function parts(/** @type {ThreeContext} */ c) {
    const T = c.three;
    const add = (/** @type {import("three").Object3D} */ o) => {
      c.scene.add(o);
      return o;
    };
    add(floor(c, { extent: BOX, step: [MAP.x(10) - MAP.x(0), MAP.z(0) - MAP.z(5)] }));
    add(contactShadow(c, { x: [X0, X1], z: [Z0, Z1], y: Y0 }));

    // The left wall, k = 0: a grid at the level and spread ticks, and its frame.
    /** @type {number[]} */
    const grid = [];
    for (const v of DB_TICKS) grid.push(X0, MAP.y(v), Z0, X0, MAP.y(v), Z1);
    for (const v of [5, 10, 15, 20, 25]) grid.push(X0, Y0, MAP.z(v), X0, Y1, MAP.z(v));
    const wallGeometry = new T.BufferGeometry();
    wallGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array(grid), 3));
    const wall = new T.Group();
    wall.add(new T.LineSegments(wallGeometry, c.paint(new T.LineBasicMaterial(), "--ambe-3d-grid")));
    const edgeGeometry = new T.BufferGeometry();
    edgeGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
      X0, Y0, Z0, X0, Y1, Z0, X0, Y1, Z0, X0, Y1, Z1, X0, Y0, Z1, X0, Y1, Z1,
    ]), 3));
    wall.add(new T.LineSegments(edgeGeometry, c.paint(new T.LineBasicMaterial(), "--ambe-plot-axis")));
    add(wall);
    const axesGeometry = new T.BufferGeometry();
    axesGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
      X0, Y0, Z1, X1, Y0, Z1, X1, Y0, Z0, X1, Y0, Z1,
    ]), 3));
    add(new T.LineSegments(axesGeometry, c.paint(new T.LineBasicMaterial(), "--ambe-plot-axis")));

    // Every frame's two markers on the wall: G_E square, G_L round.
    const markGeometry = () => {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(3), 3));
      g.setAttribute("color", new T.BufferAttribute(new Float32Array(3), 3));
      return g;
    };
    const geMarks = new T.Points(markGeometry(), c.paint(new T.PointsMaterial({ size: 3.5, sizeAttenuation: false, fog: false }), "--ambe-plot-muted"));
    const glMarks = new T.Points(markGeometry(), new T.PointsMaterial({
      size: 7, sizeAttenuation: false, vertexColors: true, map: discTexture(c), alphaTest: 0.5, fog: false,
    }));
    glMarks.userData.recolour = () => colourMarks();
    const marks = new T.Group();
    marks.add(geMarks, glMarks);
    add(marks);

    // The other combs, a thin line through each one's tips, on the ramp by
    // their spread, faded with their spread's distance from the selected
    // frame's.
    /** @type {number[]} */
    let contextColours = [];
    const context = fatLines(c, [0, 0, 0, 0, 0, 0], () => contextColours, 1.25, { fog: true });
    add(context);

    // The subject: the selected comb, its frosted fill, its two levels and
    // the gap between them; the partner's comb, dotted with open tips, at
    // its own spread.
    const fill = frostedFill(c, [0, 1], [0, 0], 0, Y0, "--ambe-highlight-fill-top", "--ambe-highlight-fill-bottom", { fog: false });
    add(fill);
    const teeth = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-highlight", 1.5);
    add(teeth);
    const kit = addHighlight(c, new Array(3 * MAX_STEMS).fill(0), { fill: false, baseline: Y0, chip: selected ? chipText(selected) : "" });
    add(kit);
    const ge = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-plot-ink", 3, { depthTest: false });
    const gl = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-plot-ink", 3, { depthTest: false, dashed: true, dash: 0.09, gap: 0.06 });
    // The partner shares the selected frame's plane to within 0.25 dB of
    // spread, so its line draws over the frosted fill rather than behind it.
    const partner = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-plot-ink", 1.75, { dashed: true, dash: 0.05, gap: 0.04, depthTest: false });
    const partnerGl = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-plot-ink", 1.75, { dashed: true, dash: 0.03, gap: 0.04, depthTest: false });
    for (const [i, line] of [partner, partnerGl, ge, gl].entries()) line.renderOrder = 15 + i;
    add(ge);
    add(gl);
    add(partner);
    add(partnerGl);

    /**
     * Rings that stay a fixed size at any zoom, drawn over everything.
     * @param {string} token
     * @param {boolean} dotted
     * @param {number} size CSS px
     */
    const ring = (token, dotted, size) => {
      const points = new T.Points(markGeometry(), c.paint(new T.PointsMaterial({
        size, sizeAttenuation: false, map: ringTexture(c, dotted), alphaTest: 0.3, transparent: true, depthTest: false, fog: false,
      }), token));
      points.renderOrder = 20;
      points.userData.size = size;
      return points;
    };
    // The partner's open tips, as the 2D panel draws them.
    const tips = ring("--ambe-plot-ink", false, 7);
    add(tips);
    // From the Side: a ring on the highlighted frame's G_L marker, and a
    // dotted ink ring on the partner's.
    const focusRing = ring("--ambe-highlight", false, 19);
    const partnerRing = ring("--ambe-plot-ink", true, 19);
    const rings = new T.Group();
    rings.add(focusRing, partnerRing);
    add(rings);
    // A bracket from 0 to each frame's gap, the chips anchored on them.
    const bracket = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-plot-ink", 1.75, { depthTest: false });
    const partnerBracket = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-plot-ink", 1.75, { depthTest: false, dashed: true, dash: 0.05, gap: 0.04 });
    // From the Side, a leader from the highlight's ring down to its chip,
    // which sits in the empty band below the scatter.
    const drop = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-highlight", 1.5, { depthTest: false });
    const partnerDrop = fatLines(c, [0, 0, 0, 1, 0, 0], "--ambe-plot-ink", 1.25, { depthTest: false, dashed: true, dash: 0.03, gap: 0.04 });
    drop.renderOrder = 19;
    partnerDrop.renderOrder = 19;
    add(drop);
    add(partnerDrop);
    bracket.renderOrder = 19;
    partnerBracket.renderOrder = 19;
    add(bracket);
    add(partnerBracket);
    const partnerChip = createChip(c.frame, c, { text: "", at: [0, 0, 0] });
    partnerChip.node.parentElement?.classList.add("anim-gain__partner-chip");
    c.track({ dispose: partnerChip.dispose });

    /** Vertex colours of the G_L markers, one per frame of the wall. */
    const colourMarks = () => {
      const attribute = /** @type {import("three").BufferAttribute} */ (glMarks.geometry.getAttribute("color"));
      const colour = new T.Color();
      const loaded = new Set(state.records);
      const ground = tokenHex("--ambe-plot-bg");
      wallOf().forEach((r, i) => {
        if (i >= attribute.count) return;
        const hex = rampColor(rampT(r));
        colour.setHex(loaded.has(r) || dim <= 0 ? hex : mix(hex, ground, DIM * dim));
        attribute.setXYZ(i, colour.r, colour.g, colour.b);
      });
      attribute.needsUpdate = true;
    };

    return {
      wall, marks, geMarks, glMarks, context, fill, teeth, kit, ge, gl, partner, partnerGl, colourMarks,
      tips, rings, focusRing, partnerRing, bracket, partnerBracket, partnerChip, drop, partnerDrop,
      /** @param {number[]} hexes */
      setContextColours: (hexes) => {
        contextColours = hexes;
      },
    };
  }

  /**
   * Set a fat line's segments; it hides when there are none. A new geometry
   * whenever the count changes: three keeps an instanced geometry's draw
   * count from its first draw.
   * @param {Fat} line
   * @param {number[]} segments
   */
  function put(line, segments) {
    line.userData.empty = segments.length === 0;
    line.visible = !line.userData.empty && !line.userData.off;
    if (!segments.length || !view) return;
    const count = line.geometry.attributes.instanceStart?.count ?? 0;
    if (count !== segments.length / 6) {
      line.geometry.dispose();
      line.geometry = new view.lines.LineSegmentsGeometry();
    }
    setSegments(line, segments);
    line.userData.recolour?.();
  }

  /**
   * Fill a Points object with `n` positions from `at(i)`.
   * @param {import("three").Points} points
   * @param {number} n
   * @param {(i: number) => Vec} at
   */
  function placePoints(points, n, at) {
    const T = /** @type {ThreeContext} */ (view).three;
    let position = /** @type {import("three").BufferAttribute} */ (points.geometry.getAttribute("position"));
    if (position.count !== n) {
      points.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
      points.geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
      position = /** @type {import("three").BufferAttribute} */ (points.geometry.getAttribute("position"));
    }
    for (let i = 0; i < n; i += 1) position.setXYZ(i, ...at(i));
    position.needsUpdate = true;
    points.geometry.setDrawRange(0, n);
    points.geometry.computeBoundingSphere();
  }

  /**
   * The scene z of a frame, slid back by u from the front (spread 0).
   * @param {GainRecord} r
   * @param {number} u
   */
  function zAt(r, u) {
    return lerp(MAP.z(0), MAP.z(r.sigma), u);
  }

  /**
   * A bracket from 0 dB down to `level` at one place, its two ticks
   * pointing back toward the frame it measures.
   * @param {(level: number, toward: number) => Vec} at a point at a level,
   *        `toward` 0 on the bracket and 1 at the tick's end
   * @param {number} level
   */
  function bracketSegments(at, level) {
    return [...at(0, 0), ...at(level, 0), ...at(0, 0), ...at(0, 1), ...at(level, 0), ...at(level, 1)];
  }

  /** Place everything from the state and the animation's progress. */
  function draw() {
    if (!scene || !view) return;
    const s = scene;
    const records = state.records;
    const wall = wallOf();
    const m = wall.length;
    const sideways = isSideways();
    drawnSideways = sideways;
    drawnLow = lowChips();
    const rank = new Map(wall.map((r, i) => [r, i]));
    const slide = (/** @type {GainRecord} */ r) => (slid >= 1 ? 1 : staggered(slid, rank.get(r) ?? 0, m));

    // The markers on the wall.
    placePoints(s.geMarks, m, (i) => [X0 + 0.01, MAP.y(0), zAt(wall[i], slide(wall[i]))]);
    placePoints(s.glMarks, m, (i) => {
      const r = wall[i];
      const d = dropped >= 1 ? 1 : staggered(dropped, i, m);
      return [X0 + 0.02, MAP.y(-r.gap * d), zAt(r, slide(r))];
    });
    s.colourMarks();

    // The other combs.
    const others = contextOf(state);
    /** @type {number[]} */
    const stems = [];
    /** @type {number[]} */
    const colours = [];
    const sel = records[state.index];
    for (const r of others) {
      const u = slide(r);
      const z = zAt(r, u);
      const h = u * grown;
      const colour = fade(rampColor(r.sigma / SIGMA_MAX), sel ? Math.abs(r.sigma - sel.sigma) / 1.2 : 0);
      for (let k = 1; k < r.L; k += 1) {
        stems.push(MAP.x(k), lerp(Y0, MAP.y(rel(r, k)), h), z, MAP.x(k + 1), lerp(Y0, MAP.y(rel(r, k + 1)), h), z);
        colours.push(colour, colour);
      }
    }
    s.setContextColours(colours);
    put(s.context, stems);

    // The selected frame.
    selected = sel ?? null;
    const subject = Boolean(sel);
    for (const o of [s.kit, s.fill, s.teeth, s.ge, s.gl]) o.userData.wanted = subject;
    frontPoints = [];
    const p = state.partner;
    if (sel) {
      const z = zAt(sel, slide(sel));
      /** @type {number[]} */
      const tips = [];
      /** @type {number[]} */
      const teeth = [];
      const xs = [];
      const ys = [];
      for (let k = 1; k <= sel.L; k += 1) {
        const y = MAP.y(rel(sel, k));
        tips.push(MAP.x(k), y, z);
        teeth.push(MAP.x(k), Y0, z, MAP.x(k), y, z);
        xs.push(MAP.x(k));
        ys.push(y);
        frontPoints.push({ at: [MAP.x(k), y, z], k, level: rel(sel, k) });
      }
      // Always the same number of points (the kit's lines keep the draw
      // count of their first geometry): the last stem repeats.
      while (tips.length < 3 * MAX_STEMS) tips.push(...tips.slice(-3));
      s.kit.set(tips);
      put(s.teeth, teeth);
      setFill(view, s.fill, xs, ys, z, Y0);
      const end = MAP.x(sel.L + 0.5);
      const z0 = z + 0.22;
      const z1 = z - 0.22;
      const yGe = MAP.y(0);
      const yGl = MAP.y(-sel.gap * grown);
      // Each level line, with a short tick across depth at its ends.
      put(s.ge, [MAP.x(0.5), yGe, z, end, yGe, z, end, yGe, z0, end, yGe, z1]);
      put(s.gl, [MAP.x(0.5), yGl, z, end, yGl, z, end, yGl, z0, end, yGl, z1]);
    }
    if (p) {
      const z = zAt(p, slide(p));
      /** @type {number[]} */
      const path = [];
      for (let k = 1; k < p.L; k += 1) path.push(MAP.x(k), MAP.y(rel(p, k)), z, MAP.x(k + 1), MAP.y(rel(p, k + 1)), z);
      put(s.partner, path);
      const y = MAP.y(-p.gap * grown);
      put(s.partnerGl, [MAP.x(0.5), y, z, MAP.x(p.L + 0.5), y, z]);
      placePoints(s.tips, p.L, (i) => [MAP.x(i + 1), MAP.y(rel(p, i + 1)), z]);
      s.tips.userData.wanted = true;
    } else {
      put(s.partner, []);
      put(s.partnerGl, []);
      s.tips.userData.wanted = false;
    }

    // The brackets, the rings and the chips. In the first view's hold the
    // equal-spread pair of all eight takes the brackets, whatever the step.
    const pair = holding && state.pair ? state.pair : null;
    const focus = pair ? pair.frame : sel ?? null;
    const mate = pair ? pair.partner : p;
    anchors = { chip: null, partner: null };
    /** @type {number[]} */
    let main = [];
    /** @type {number[]} */
    let second = [];
    /** @type {number[]} */
    let leader = [];
    /** @type {number[]} */
    let partnerLeader = [];
    if (focus && sideways) {
      // On the wall, beside each frame's column: the focus to its right
      // (larger spread), the partner to its left.
      const x = X0 + 0.03;
      /** @param {GainRecord} r @param {number} side */
      const column = (r, side) => (/** @type {number} */ level, /** @type {number} */ toward) =>
        /** @type {Vec} */ ([x, MAP.y(level), MAP.z(r.sigma + side * SIDE_OFF * (1 - 0.6 * toward))]);
      main = bracketSegments(column(focus, 1), -focus.gap * marked);
      const ringAt = /** @type {Vec} */ ([x + 0.01, MAP.y(-focus.gap), MAP.z(focus.sigma)]);
      placePoints(s.focusRing, 1, () => ringAt);
      // A ring near 0 keeps its chip above it, in the empty band over the
      // 0 dB line; a deeper one hands it down a leader to the empty band
      // below the scatter, so the chip covers no marker.
      if (focus.gap < 12) {
        anchors.chip = ringAt;
      } else {
        const below = Math.max(DB[0] + 8, -focus.gap - 17);
        anchors.chip = [ringAt[0], MAP.y(below), ringAt[2]];
        if (marked > 0) leader = [ringAt[0], MAP.y(-focus.gap - 3.2), ringAt[2], ringAt[0], MAP.y(below), ringAt[2]];
      }
      if (mate) {
        second = bracketSegments(column(mate, -1), -mate.gap * marked);
        anchors.partner = column(mate, -1)(0, 0);
        placePoints(s.partnerRing, 1, () => [x + 0.01, MAP.y(-mate.gap), MAP.z(mate.sigma)]);
      }
    } else if (sel) {
      // Past the comb's end: the selected frame's bracket, then the
      // partner's, each ticked back toward its comb.
      const end = Math.max(sel.L, p ? p.L : 0) + 0.5;
      /** @param {GainRecord} r @param {number} k */
      const post = (r, k) => (/** @type {number} */ level, /** @type {number} */ toward) =>
        /** @type {Vec} */ ([MAP.x(k - 0.45 * toward), MAP.y(level), zAt(r, slide(r))]);
      main = bracketSegments(post(sel, end + 1), -sel.gap * marked);
      anchors.chip = post(sel, end + 1)(-sel.gap * marked, 0);
      if (p) {
        second = bracketSegments(post(p, end + 2.4), -p.gap * marked);
        anchors.partner = post(p, end + 2.4)(-p.gap * marked, 0);
      }
      // A phone's Front has no room for a chip beside the comb, but the
      // band below it (where the 2D scatter goes) is empty: each chip goes
      // there, down a leader from its bracket's foot.
      if (lowChips()) {
        const foot = /** @type {Vec} */ (anchors.chip);
        anchors.chip = [foot[0], MAP.y(DB[0] - 58), foot[2]];
        if (marked > 0) leader = [...foot, ...anchors.chip];
        if (anchors.partner) {
          const pfoot = anchors.partner;
          anchors.partner = [pfoot[0], MAP.y(DB[0] - 92), pfoot[2]];
          if (marked > 0) partnerLeader = [...pfoot, ...anchors.partner];
        }
      }
    }
    put(s.bracket, marked > 0 ? main : []);
    put(s.partnerBracket, marked > 0 ? second : []);
    put(s.drop, leader);
    put(s.partnerDrop, partnerLeader);
    s.focusRing.visible = Boolean(focus) && sideways && marked > 0;
    s.partnerRing.visible = Boolean(mate) && sideways && marked > 0;

    const chip = s.kit.chip;
    if (chip) {
      const text = pair
        ? `same spread, gap ${fmt1(pair.partner.gap)} to ${fmt1(pair.frame.gap)} dB`
        : sel ? chipText(sel, Boolean(p)) : "";
      chip.set({ text, ...(anchors.chip ? { at: anchors.chip } : {}) });
      const layer = chip.node.parentElement;
      if (layer) layer.style.visibility = focus && (!pair || marked >= 0.5) ? "" : "hidden";
    }
    const partnerLayer = s.partnerChip.node.parentElement;
    if (mate && !pair && anchors.partner) s.partnerChip.set({ text: chipText(mate, true), at: anchors.partner });
    if (partnerLayer) partnerLayer.style.visibility = mate && !pair && anchors.partner && marked >= 0.5 ? "" : "hidden";

    // Probe points for the Side test: twenty markers across the spreads.
    sidePoints = [];
    for (let j = 0; j < Math.min(20, m); j += 1) {
      const r = wall[Math.round((j / Math.max(1, Math.min(20, m) - 1)) * (m - 1))];
      sidePoints.push({ at: [X0 + 0.02, MAP.y(-r.gap), MAP.z(r.sigma)], sigma: r.sigma, level: -r.gap });
    }
    visibility();
    relabelScene(true);
    view.requestRender();
  }

  /** A phone's frame, looking from the front: the chips go below the comb. */
  function lowChips() {
    if (!view || frame.clientWidth >= 560) return false;
    return view.camera.position.clone().normalize().z > Math.cos((25 * Math.PI) / 180);
  }

  /** The camera looks from the side, far enough that the combs are edge on. */
  function isSideways() {
    if (!view) return false;
    return view.camera.position.clone().normalize().x > SIDEWAYS;
  }

  /** The preset the camera looks along now, if any. */
  function looking() {
    if (!view) return "corner";
    const d = view.camera.position.clone().normalize();
    if (d.x > 0.995) return "side";
    if (d.z > 0.995) return "front";
    return "corner";
  }

  /** Hide what the current view sees edge on or does not need. */
  function visibility() {
    if (!scene) return;
    const at = looking();
    const hidden = HIDDEN[at === "corner" && isSideways() ? "side" : at];
    /** @type {[string, import("three").Object3D][]} */
    const named = [
      ["context", scene.context], ["wall", scene.wall], ["marks", scene.marks], ["fill", scene.fill],
      ["teeth", scene.teeth], ["kit", scene.kit], ["ge", scene.ge], ["gl", scene.gl],
      ["partner", scene.partner], ["partnerGl", scene.partnerGl], ["tips", scene.tips], ["rings", scene.rings],
    ];
    for (const [name, object] of named) {
      object.userData.off = hidden.includes(name);
      object.visible = !object.userData.off && !object.userData.empty && object.userData.wanted !== false;
    }
    const size = Math.sqrt(orbit?.zoom() ?? 1);
    /** @type {import("three").PointsMaterial} */ (scene.geMarks.material).size = 3.5 * size;
    /** @type {import("three").PointsMaterial} */ (scene.glMarks.material).size = 7 * size;
    /** @type {import("three").PointsMaterial} */ (scene.tips.material).size = 7 * size;
  }

  /**
   * Set the labels again when the view or the selection changes.
   * @param {boolean} [force]
   */
  function relabelScene(force = false) {
    const mode = `${looking()} ${isSideways()} ${selected ? `${selected.clip}${selected.i}` : ""} ${Boolean(state.partner)} ${frame.clientWidth < 560}`;
    if (!labels || (mode === labelled && !force)) return;
    labelled = mode;
    labels.set(labelList());
  }

  /** @returns {import("./lib/labels.js").Label[]} */
  function labelList() {
    const narrow = frame.clientWidth < 560;
    const out = axisLabels(BOX, MAP, [
      { axis: "x", name: "harmonic number k", ticks: K_TICKS },
      { axis: "y", name: "", ticks: DB_TICKS },
      { axis: "z", name: "spread, dB", ticks: SIGMA_TICKS.filter((v) => v > 0) },
    ]).filter((label) => label.text);
    // The level axis is named above its top end, as the 2D panel's
    // heading is, so its title never sits on a tick, and high enough that
    // the row of G_E markers at 0 dB along the back passes under it.
    out.push({ text: narrow ? "dB re G_E" : "level, dB relative to G_E", at: [X0, Y1, Z1], align: "start", dy: -28 });
    const sel = selected;
    if (sel && !isSideways() && sel.gap > 8) {
      const z = MAP.z(sel.sigma);
      const p = state.partner;
      const end = Math.max(sel.L, p ? p.L : 0) + 0.5;
      const x = MAP.x(end + (p ? 2.4 : 1) + 0.5);
      out.push({ text: "G_E", at: [x, MAP.y(0), z], align: "start", dy: -10 });
      out.push({ text: "G_L", at: [x, MAP.y(-sel.gap), z], align: "start", dy: 10 });
    }
    return out;
  }

  /**
   * The fit: on Front the scene lies on the 2D comb panel; elsewhere the
   * whole box fills the frame. Between them the frustum eases from one to
   * the other over 25 degrees.
   */
  const fit = () => {
    const cam = /** @type {any} */ (/** @type {ThreeContext} */ (ctx).camera);
    if (!cam.isOrthographicCamera) return;
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    const size = { width: W, height: H };
    const geo = layout(W, H);
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    // The box's extent across and up the view, in camera units: the
    // content is centred on it, not on the target, so none of the frame
    // goes unused.
    const u = [Infinity, -Infinity];
    const v = [Infinity, -Infinity];
    for (const x of [X0, X1]) {
      for (const y of [Y0, Y1]) {
        for (const z of [Z0, Z1]) {
          const a = x * m[0] + y * m[1] + z * m[2];
          const b = x * m[4] + y * m[5] + z * m[6];
          u[0] = Math.min(u[0], a);
          u[1] = Math.max(u[1], a);
          v[0] = Math.min(v[0], b);
          v[1] = Math.max(v[1], b);
        }
      }
    }
    const narrow = W < 560;
    // Room below for the axis labels: a spread title under the Side's
    // bottom edge must clear the 56 px the labels keep free; the Corner's
    // lowest corner leaves its titles higher up.
    const side = smooth((cam.position.clone().normalize().x - 0.7) / 0.3);
    const pad = { l: narrow ? 40 : 70, r: narrow ? 22 : 70, t: narrow ? 34 : 44, b: lerp(narrow ? 70 : 64, 92, side) };
    const room = { w: W - pad.l - pad.r, h: H - pad.t - pad.b };
    const k = Math.min(room.w / (u[1] - u[0]), room.h / (v[1] - v[0]));
    // Up to 1.8 times as tall as the box's own shape where the frame has
    // the room (a phone's tall frame), so the content fills the height;
    // from the Side, a flat scatter, as wide as the frame as well.
    const ky = Math.min(room.h / (v[1] - v[0]), k * (narrow ? 1.8 : 1));
    const kx = lerp(k, Math.min(room.w / (u[1] - u[0]), ky * 1.8), side);
    const left = (u[0] + u[1]) / 2 - (pad.l + room.w / 2) / kx;
    const top = (v[0] + v[1]) / 2 + (pad.t + room.h / 2) / ky;
    let f = { left, right: left + W / kx, top, bottom: top - H / ky };
    const d = cam.position.clone().normalize();
    /** @param {{x: number, y: number, width: number, height: number}} a */
    const rect = (a) => ({ x: a.x, y: a.y, width: a.width, height: a.height });
    const matched = [
      { w: d.z, f: frontFrustum(size, rect(geo.comb.area), { min: [X0, Y0, 0], max: [X1, Y1, 0] }) },
    ];
    const near = Math.cos((25 * Math.PI) / 180);
    for (const { w, f: g } of matched) {
      const t = smooth((w - near) / (1 - near));
      if (t <= 0) continue;
      f = { left: lerp(f.left, g.left, t), right: lerp(f.right, g.right, t), top: lerp(f.top, g.top, t), bottom: lerp(f.bottom, g.bottom, t) };
    }
    Object.assign(cam, f);
  };

  orbit = createOrbit(ctx, {
    target: [0, 0, 0],
    fit,
    distance: DISTANCE,
    zoom: opts.look.zoom || 1,
    presets: PRESETS,
    start: PRESETS[state.preset] ? state.preset : "corner",
    yaw: !opts.headOn,
    onDrag: opts.onDrag,
    onChange: () => {
      if (isSideways() !== drawnSideways || lowChips() !== drawnLow) draw();
      visibility();
      relabelScene();
      labels?.update();
      scene?.kit.chip?.update();
      scene?.partnerChip.update();
    },
  });

  let labelTimer = 0;
  /** The sentence for the 3D canvas's label (the orbit adds the zoom sentence). */
  function describe() {
    const sel = state.records[state.index];
    const seen = { front: "from the front, one frame's comb", side: "from the side, every frame's G_L against its spread", corner: "from a corner" }[state.preset];
    const n = state.records.length;
    const from = state.clip === "all" ? `all ${CLIPS.length} recordings` : state.clip;
    if (!sel) return `In 3D, seen ${seen}: harmonic number left to right, level up, spread into depth. Loading.`;
    const partner = state.partner
      ? ` At the same spread, ${frameName(state.partner)} has a gap of ${fmt1(state.partner.gap)} dB.`
      : "";
    const wall = wallOf().length;
    return `In 3D, seen ${seen}: harmonic number runs left to right, level relative to each frame's G_E up, and spread into depth, ` +
      `${n} frames from ${from}. The thick comb is ${frameName(sel)} at spread ${fmt1(sel.sigma)} dB; its G_L is ` +
      `${fmt1(sel.gap)} dB below its G_E.${partner} On the left wall, the G_L of each of ${wall} frames sits below 0 by its gap, at its spread.`;
  }
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
  };
  ctx.viewSignal.addEventListener("abort", () => clearTimeout(labelTimer), { once: true });

  const timeline = ctx.timeline();
  /** How long the brackets take to grow. */
  const MARK_MS = 600;

  if (opts.intro) {
    // The first view, from Front (the 2D comb panel): the combs and the
    // markers slide back to their spread, flattest first, while the camera
    // turns to the corner; then it turns to Side and every G_L marker of
    // the eight recordings drops to its gap, so the scatter appears. It
    // holds there while the equal-spread pair is ringed and bracketed,
    // then settles on the step's preset.
    played += 1;
    const slideMs = 1.6 * duration("3d-build");
    const cam = duration("3d-camera");
    const lead = 200;
    const toSide = lead + cam + 300;
    const dropAt = toSide + 0.7 * cam;
    const dropMs = duration("3d-build");
    const markAt = dropAt + dropMs + 100;
    // The scatter is the figure's point: it holds at least 3 s.
    const settleAt = markAt + MARK_MS + 3000;
    const to = PRESETS[state.preset] ?? PRESETS.corner;
    const total = settleAt + cam;
    orbit.set(PRESETS.front);
    void timeline.play("slide", {
      ms: slideMs, delay: lead, ease: "linear", build: true,
      step: (t) => {
        slid = t;
        draw();
      },
    });
    void timeline.play("drop", {
      ms: dropMs, delay: dropAt, ease: "linear", build: true,
      step: (t) => {
        dropped = t;
        draw();
      },
    });
    void timeline.play("mark", {
      ms: MARK_MS, delay: markAt, build: true,
      step: (t) => {
        marked = t;
        draw();
      },
    });
    introRunning = true;
    void timeline.play("camera", {
      ms: total, ease: "linear", build: true,
      step: (t) => {
        const ms = t * total;
        /** @param {Pose} a @param {Pose} b @param {number} u */
        const go = (a, b, u) => {
          const e = smooth(u);
          orbit?.set({ yaw: lerp(a.yaw, b.yaw, e), pitch: lerp(a.pitch, b.pitch, e) });
        };
        const hold = ms >= markAt && ms < settleAt;
        const fading = ms > settleAt ? smooth((ms - settleAt) / cam) : 0;
        if (hold !== holding || fading !== dim) {
          holding = hold;
          dim = fading;
          draw();
        }
        if (ms <= lead) go(PRESETS.front, PRESETS.front, 1);
        else if (ms <= lead + cam) go(PRESETS.front, PRESETS.corner, (ms - lead) / cam);
        else if (ms <= toSide) go(PRESETS.corner, PRESETS.corner, 1);
        else if (ms <= toSide + cam) go(PRESETS.corner, PRESETS.side, (ms - toSide) / cam);
        else if (ms <= settleAt) go(PRESETS.side, PRESETS.side, 1);
        else go(PRESETS.side, to, (ms - settleAt) / cam);
      },
    }).then(() => {
      introRunning = false;
    });
  }

  /** New data: the combs grow from the floor. */
  function grow() {
    return timeline.play("grow", {
      ms: duration("3d-build"),
      step: (t) => {
        grown = t;
        draw();
      },
    });
  }

  /**
   * The equal-spread step: every G_L marker drops again from 0 while the
   * camera turns to Side, then the two frames' brackets grow.
   */
  function replay() {
    replays += 1;
    const dropMs = duration("3d-build");
    dropped = 0;
    marked = 0;
    void timeline.play("drop", {
      ms: dropMs, delay: 250, ease: "linear",
      step: (t) => {
        dropped = t;
        draw();
      },
    });
    void timeline.play("mark", {
      ms: MARK_MS, delay: 250 + dropMs + 100,
      step: (t) => {
        marked = t;
        draw();
      },
    });
  }

  if (TEST_HOOK) {
    TEST_HOOK.figures["gain-definitions-3d"] = {
      get builds() { return builds; },
      get played() { return played; },
      get replays() { return replays; },
      pose: () => orbit?.pose() ?? null,
      zoom: () => orbit?.zoom() ?? 1,
      get frontPoints() { return frontPoints; },
      get sidePoints() { return sidePoints; },
      get looking() { return looking(); },
      get anchors() { return anchors; },
      /** What shows, and where the selected comb stands. */
      get parts() {
        if (!scene) return {};
        return {
          context: [scene.context.visible, scene.context.geometry.attributes.instanceStart?.count ?? 0],
          marks: [scene.marks.visible, scene.glMarks.geometry.drawRange.count],
          wall: scene.wall.visible,
          partner: scene.partner.visible,
          kit: scene.kit.visible,
          teeth: scene.teeth.visible,
          fill: scene.fill.visible,
          rings: [scene.rings.visible && scene.focusRing.visible, scene.rings.visible && scene.partnerRing.visible],
          brackets: [scene.bracket.visible, scene.partnerBracket.visible],
          selected: selected ? frameName(selected) : null,
          z: frontPoints[0]?.at[2] ?? null,
          slid, dropped, grown, marked, dim, holding,
        };
      },
      /** CSS px in the frame of a scene point, through the live camera. */
      project: (/** @type {Vec} */ at) => {
        const v = new ctx.three.Vector3(...at).project(ctx.camera);
        return [((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight];
      },
      /** The scene z of a spread. */
      z: (/** @type {number} */ sigma) => MAP.z(sigma),
    };
    ctx.viewSignal.addEventListener("abort", () => {
      if (TEST_HOOK) delete TEST_HOOK.figures["gain-definitions-3d"];
    }, { once: true });
  }

  await ctx.drawn();
  return {
    update: (next) => {
      Object.assign(state, /** @type {GainState} */ (next));
      const was = selected;
      if (state.loads !== loads && introRunning) {
        loads = state.loads;
        draw();
      } else if (state.loads !== loads) {
        loads = state.loads;
        timeline.finish();
        slid = 1;
        dropped = 1;
        marked = 1;
        grown = 0;
        draw();
        void grow();
      } else {
        draw();
      }
      const now = Boolean(state.partner);
      if (now && !partnered && !introRunning) replay();
      partnered = now;
      if (selected && selected !== was && was) void scene?.kit.pulse();
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
