// @ts-check
/* ===========================================================================
 * anim-three-numbers-3d.js: the three-numbers figure's 3D view.
 * ---------------------------------------------------------------------------
 * Loaded by lib/view-switch.js from anim-three-numbers.js, which holds the
 * model; this part only places its arrays in a scene (design §2.1, §4.2):
 *
 *   x  time, 0 to 3 cycles of the reference
 *   y  wave value, ±1.6, the 2D panel's range
 *   z  phase, 0 degrees at the front to 360 at the back
 *
 * The sheet is the live wave at every phase, a slice every 15 degrees,
 * thin and coloured by phase on the ramp, faded by its distance from the
 * live wave. The live wave, at the slider's phase, is the highlight. One
 * straight line per crest runs across the sheet: crest k sits at
 * t = (1/4 + k - phi/2pi)/f, so the lines are parallel, 1/f apart, and each
 * ends at 360 degrees where its neighbour started at 0. That is how the
 * wrap shows. There is no 360-degree ghost: the 360 slice is dashed, like
 * the reference, which is dashed at 0 and at 360.
 *
 * Front is the 2D panel (lib/orbit.js matchPlot on the 2D plot's
 * rectangle): the sheet and the crest lines fade out with the turn, and the
 * reference, the live wave, the amplitude bar and the phase bracket remain,
 * with their labels on plates as in 2D. Away from Front the box is drawn
 * at one scale on both axes, as large as the label margins allow, and the
 * plane's labels give way to a note on the crest lines; at Front it is
 * exactly the 2D fit. The chip sits in a free corner of the frame, its
 * leader to the live wave.
 *
 * The explanatory animation (visual language §6), played once on first
 * view: "Phase slides the same wave along time; one full turn of phase
 * moves it by one period." The camera turns from Front to Corner, then the
 * live wave sweeps through depth from 0 to 360 degrees, laying down the
 * sheet behind it while each crest line draws, until it lands on the
 * dashed 360 slice one period along, holds, and slides back along the
 * crest lines to the slider's phase, with a pulse. The end state carries
 * the point on its own: the note at a crest line's 360-degree end reads
 * "one turn: one period earlier".
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import {
  BAR_T,
  DEFAULTS,
  PHASE_STEP,
  POINTS,
  SLICES,
  SPAN,
  Y_DOMAIN,
  bracket,
  crestLines,
  period,
  plotRect,
  shiftCycles,
  slices,
  wave,
} from "./anim-three-numbers.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { FRONT, TOP, createOrbit, matchPlot } from "./lib/orbit.js";
import { axisFrame, curveFamily, toScene } from "./lib/scene.js";
import { contactShadow, fatLines, floor, fog, rampColor, setSegments } from "./lib/style.js";

/** @typedef {import("./anim-three-numbers.js").WaveState} WaveState */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("three/addons/lines/LineSegments2.js").LineSegments2} FatLine */

const TAU = Math.PI * 2;
/** Data to scene: phase 0 at the front (z max), 360 at the back. */
const MAP = toScene({ x: [0, SPAN], y: Y_DOMAIN, z: [360, 0] }, { x: 3, y: 0.95, z: 1.5 });
const CORNER = Object.freeze({ yaw: -22, pitch: 30 });
/** The sheet is drawn from every second sample (361 of 721), inside the triangle cap. */
const SHEET_EVERY = 2;
/** @type {Record<string, import("./lib/orbit.js").Pose>} */
const PRESETS = { corner: CORNER, front: FRONT, top: TOP };
const DISTANCE = 8;
/** The sweep from 0 to 360 degrees; phase follows time, so it is linear. */
const SWEEP_MS = 2400;
/** Then it holds on the dashed 360 slice, one period along, */
const HOLD_MS = 700;
/** and slides back along the crest lines to the slider's phase. */
const SETTLE_MS = 800;
/** Dashes of the reference, CSS px, as the 2D canvas draws them. */
const DASH_PX = 4;

/**
 * @typedef {Object} Probe  TEST_HOOK.figures["three-numbers-3d"]
 * @property {number} builds
 * @property {import("./lib/orbit.js").Pose | null} pose
 * @property {number} zoom
 * @property {boolean} played  the first-view animation has started
 * @property {{phase: number, reveal: number}} shown  what the scene shows now
 * @property {() => FrontPoints} frontPoints  the plane's geometry as the scene
 *           holds it, projected with the camera as it is now, in CSS px of the frame
 * @property {() => boolean[]} context  whether the sheet, the 360 slice, the
 *           crest lines and the highlight's outline show
 * @property {() => {left: number, right: number, top: number, bottom: number}} boxOnScreen
 *           the box's extent in CSS px of the frame
 * @property {() => {segments: number, draws: number}} counts
 * @property {(pose: import("./lib/orbit.js").Pose) => void} set  jump to a pose
 */

/**
 * @typedef {Object} FrontPoints
 * @property {import("./lib/orbit.js").PlotRect} rect  the 2D plot's rectangle
 * @property {Point[]} reference
 * @property {Point[]} live
 * @property {Point[]} bracket
 * @property {Point[]} bar
 */

/** @typedef {{t: number, v: number, degrees: number, x: number, y: number}} Point  data units and CSS px */

/**
 * A wave's points at a phase, flat x, y, z in scene units.
 * @param {{x: number, y: number}[]} points
 * @param {number} degrees
 * @param {number} [every=1] keep every n-th point
 * @returns {Float32Array}
 */
function inScene(points, degrees, every = 1) {
  const kept = points.filter((_, i) => i % every === 0);
  const out = new Float32Array(kept.length * 3);
  const z = MAP.z(degrees);
  kept.forEach((p, i) => out.set([MAP.x(p.x), MAP.y(p.y), z], i * 3));
  return out;
}

/**
 * Curves (flat x, y, z) as consecutive segment pairs, curve after curve,
 * the layout lib/scene.js curveFamily builds.
 * @param {ArrayLike<number>[]} curves
 * @returns {Float32Array}
 */
function segmentsOf(curves) {
  let count = 0;
  for (const c of curves) count += Math.max(0, c.length / 3 - 1);
  const out = new Float32Array(count * 6);
  let o = 0;
  for (const c of curves) {
    for (let i = 0; i + 1 < c.length / 3; i += 1) {
      for (let j = 0; j < 6; j += 1) out[o++] = c[i * 3 + j];
    }
  }
  return out;
}

/** The box's eight corners, scene units. */
const CORNERS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => /** @type {[number, number, number]} */ (
  [0, 1, 2].map((a) => ((i >> a) & 1 ? MAP.box.max[a] : MAP.box.min[a]))));

/**
 * The convex hull of points on screen, counter-clockwise in y-down px.
 * @param {[number, number][]} points
 * @returns {[number, number][]}
 */
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @param {[number, number]} o @param {[number, number]} a @param {[number, number]} b */
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  /** @type {[number, number][]} */
  const lower = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  /** @type {[number, number][]} */
  const upper = [];
  for (const q of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Whether a point lies inside a convex hull from convexHull().
 * @param {[number, number][]} hull @param {number} x @param {number} y
 */
function insideHull(hull, x, y) {
  for (let i = 0; i < hull.length; i += 1) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false;
  }
  return hull.length > 2;
}

/**
 * Whether the segment from (x0, y0) to (x1, y1) passes through a box.
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {{left: number, top: number, right: number, bottom: number}} r
 */
function crosses(x0, y0, x1, y1, r) {
  for (let i = 0; i <= 16; i += 1) {
    const x = x0 + ((x1 - x0) * i) / 16;
    const y = y0 + ((y1 - y0) * i) / 16;
    if (x > r.left && x < r.right && y > r.top && y < r.bottom) return true;
  }
  return false;
}

/** @param {number} radians @returns {number} */
const toDegrees = (radians) => (radians / TAU) * 360;

/**
 * The chip's fact: how far this phase moves the wave along time.
 * @param {number} freq
 * @param {number} degrees
 */
const chipText = (freq, degrees, narrow = false) =>
  `${narrow ? "" : "phase "}${Math.round(degrees)}°: shifted ${shiftCycles(freq, (degrees / 360) * TAU).toFixed(3)} cycles`;

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let state = /** @type {WaveState} */ (opts.state);
  /** What the scene shows: the live wave's phase (degrees) and how much of the sweep is laid down (0 to 1). */
  const shown = { phase: toDegrees(state.phase), reveal: opts.intro ? 0 : 1 };

  /** @type {Probe} */
  const probe = {
    builds: 0, pose: null, zoom: 1, played: false, shown,
    frontPoints: () => ({ rect: plotRect(0, 0), reference: [], live: [], bracket: [], bar: [] }),
    context: () => [],
    boxOnScreen: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    counts: () => ({ segments: 0, draws: 0 }),
    set: () => {},
  };
  if (TEST_HOOK) TEST_HOOK.figures["three-numbers-3d"] = probe;

  /**
   * Everything one build made, rebuilt after a restore or an unpark.
   * @typedef {Object} Parts
   * @property {FatLine} family  slices 0 to 345 degrees, on the ramp
   * @property {number[]} delta  each slice's distance from the live wave, in slices
   * @property {FatLine} last  the 360-degree slice, dashed
   * @property {FatLine} reference  dashed, at 0 and at 360
   * @property {FatLine} crests
   * @property {FatLine} bar
   * @property {FatLine} gap  the phase bracket's dashed line
   * @property {FatLine} ticks  the bracket's end ticks
   * @property {ReturnType<typeof addHighlight>} highlight
   * @property {ReturnType<typeof createLabels>} axes
   * @property {ReturnType<typeof createLabels>} marks  "amplitude" and "phase"
   * @property {HTMLElement} marksLayer
   * @property {ReturnType<typeof createLabels>} notes  what the crest lines show
   * @property {HTMLElement} notesLayer
   * @property {import("three").Group} root
   * @property {number} nearest  the slice the fades were worked out for
   * @property {boolean | null} front  which label set is up: Front's or a turned view's
   */
  /** @type {Parts | null} */
  let parts = null;

  /** How much of the context shows: 0 at Front, 1 once turned 20 degrees. */
  let presence = 1;
  /** The view's context and a spare vector, once the first build has run. */
  /** @type {ThreeContext | null} */
  let ctxRef = null;
  /** @type {import("three").Vector3 | null} */
  let vec = null;

  /**
   * @param {ThreeContext} ctx
   * @returns {Parts}
   */
  const build = (ctx) => {
    probe.builds += 1;
    const T = ctx.three;
    ctxRef = ctx;
    vec = new T.Vector3();
    const root = new T.Group();
    const box = MAP.box;
    root.add(floor(ctx, { extent: box, step: [1, MAP.box.max[2] - MAP.z(90)] }));
    root.add(contactShadow(ctx, { x: [box.min[0], box.max[0]], z: [box.min[2], box.max[2]], y: box.min[1] }));
    root.add(axisFrame(ctx, box, {
      xs: [0, 1, 2, 3].map(MAP.x), ys: [-1, 0, 1].map(MAP.y), floor: false, grid: "--ambe-3d-grid",
    }));

    const sheet = slices(state.amp, state.freq);
    const delta = sheet.slice(0, -1).map(() => 0);
    const family = curveFamily(ctx, sheet.slice(0, -1).map((s) => inScene(s.points, s.degrees, SHEET_EVERY)), {
      colours: (c) => rampColor(c / (SLICES - 1)), delta,
    });
    const lastSlice = sheet[SLICES - 1];
    const last = fatLines(ctx, segmentsOf([inScene(lastSlice.points, lastSlice.degrees, SHEET_EVERY)]),
      () => new Array((POINTS / SHEET_EVERY) * 2).fill(rampColor(1)), 1.25, { dashed: true, fog: true });
    const ref = wave(DEFAULTS.amp, DEFAULTS.freq, DEFAULTS.phase);
    const reference = fatLines(ctx, segmentsOf([inScene(ref, 0), inScene(ref, 360)]), "--ambe-plot-muted", 1.4,
      { dashed: true });
    const crests = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 1.75, { depthTest: false });
    crests.renderOrder = 5;
    const bar = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-accent-cool", 1.6, { depthTest: false });
    const gap = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-accent-warm", 1.8, { dashed: true, depthTest: false });
    const ticks = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-accent-warm", 1.8, { depthTest: false });
    for (const line of [bar, gap, ticks]) line.renderOrder = 20;
    const highlight = addHighlight(ctx, inScene(wave(state.amp, state.freq, state.phase), shown.phase), {
      baseline: MAP.y(Y_DOMAIN[0]), fill: false, chip: chipText(state.freq, shown.phase, frame.clientWidth < 560),
    });
    root.add(family, last, reference, crests, highlight, bar, gap, ticks);
    ctx.scene.add(root);
    fog(ctx, DISTANCE, box.max[2] - box.min[2]);

    const axes = createLabels(ctx.frame, ctx);
    // The amplitude and phase marks belong to the plane of the live wave:
    // they show at Front, as in 2D, and fade out with the turn, where the
    // legend and the readout name them. The note says what the crest lines
    // show, and shows once turned.
    const marks = createLabels(ctx.frame, ctx);
    const marksLayer = /** @type {HTMLElement} */ (ctx.frame.lastElementChild);
    marksLayer.classList.add("anim-tn__marks");
    const notes = createLabels(ctx.frame, ctx);
    const notesLayer = /** @type {HTMLElement} */ (ctx.frame.lastElementChild);
    notesLayer.classList.add("anim-tn__notes");
    ctx.track({ dispose: axes.dispose });
    ctx.track({ dispose: marks.dispose });
    ctx.track({ dispose: notes.dispose });

    const chip = highlight.chip;
    if (chip) {
      // lib/highlight.js places the chip on every draw; it then moves to a
      // free corner of the frame (placeChip), off the sheet it explains.
      const placeDefault = chip.update;
      chip.update = () => {
        placeDefault();
        placeChip();
      };
    }

    const made = {
      family, delta, last, reference, crests, bar, gap, ticks, highlight, axes, marks, marksLayer, notes,
      notesLayer, root, nearest: -1, front: /** @type {boolean | null} */ (null),
    };
    // A theme change resets painted materials' opacity; the turn's fade
    // goes back on after it (anim-three.js recolours painted ones first).
    root.userData.recolour = () => applyPresence(made);
    parts = made;
    // A restore or an unpark builds at the pose the reader left: the fade
    // and the label set follow it before the first frame (draw applies it).
    draw();
    return made;
  };

  /**
   * The axis labels, for Front (the 2D panel's) or for a turned view. A
   * phone's frame is short: only the ends of each axis.
   * @param {boolean} front
   * @returns {import("./lib/labels.js").Label[]}
   */
  const axisSet = (front) => {
    const [x0, y0, z0] = MAP.box.min;
    const [x1, y1, z1] = MAP.box.max;
    const narrow = frame.clientWidth < 560;
    /** @type {[number, number, number]} */
    const ALONG_Z = [0, 0, 1];
    if (front) {
      // lib/labels.js keeps the frame's bottom 56 px clear, which is where
      // the 2D canvas puts its time axis; here time runs along the top of
      // the panel, inside it, clear of the wave at any amplitude up to 1.
      return [
        ...axisLabels(MAP.box, MAP, [{ axis: "y", name: "", ticks: [-1, 0, 1] }]).filter((label) => label.text),
        ...(narrow ? [0, 3] : [0, 1, 2, 3]).map((t) => (
          { text: String(t), at: /** @type {[number, number, number]} */ ([MAP.x(t), y1, z1]), align: /** @type {const} */ ("middle"), tick: true, dy: 9 })),
        { text: "time, in cycles\nof the reference", at: [MAP.x(1.5), y1, z1], align: "middle", dy: 15 },
      ];
    }
    return [
      // Time along the top of the back wall, the 2D panel's plane.
      ...(narrow ? [3] : [1, 2, 3]).map((t) => (
        { text: String(t), at: /** @type {[number, number, number]} */ ([MAP.x(t), y1, z0]), align: /** @type {const} */ ("middle"), tick: true, dy: -9 })),
      ...(narrow ? [] : [{ text: "time, in cycles\nof the reference", at: /** @type {[number, number, number]} */ ([x1 + 0.08, y1, z0]), align: /** @type {const} */ ("start"), dy: 16 }]),
      // Value on the right front edge, away from the phase ticks.
      ...(narrow ? [-1, 1] : [-1, 0, 1]).map((value) => (
        { text: String(value), at: /** @type {[number, number, number]} */ ([x1 + 0.05, MAP.y(value), z1]), align: /** @type {const} */ ("start"), tick: true })),
      // Phase along the top left edge, the side Corner looks from, named
      // once at its 360-degree end.
      ...(narrow ? [0, 360] : [0, 90, 180, 270, 360]).map((degrees) => (
        { text: `${degrees}°`, at: /** @type {[number, number, number]} */ ([x0 - 0.05, y1, MAP.z(degrees)]), align: /** @type {const} */ ("end"), along: ALONG_Z, tick: true, dy: -2 })),
      { text: "phase", at: [x0 - 0.05, y1, z0], align: "end", along: ALONG_Z, dy: -18 },
    ];
  };

  /**
   * The context fades out toward Front, so Front is the 2D panel: the
   * sheet, the 360 slice, the crest lines and the highlight's outline. The
   * plane's marks fade in as they go. Applied on every draw, every turn,
   * every theme change and after every build.
   * @param {Parts} p
   */
  const applyPresence = (p) => {
    const outline = p.highlight.children.find((c) => /** @type {any} */ (c).material?.dashed);
    for (const line of [p.family, p.last, p.crests, outline]) {
      if (!line) continue;
      const m = /** @type {import("three").Material} */ (/** @type {any} */ (line).material);
      m.opacity = presence;
      m.transparent = presence < 1;
      line.visible = presence > 0.02;
    }
    p.last.visible &&= shown.reveal >= 1 || shown.phase >= 360;
    p.crests.visible &&= p.crests.userData.count > 0;
    const front = presence < 0.5;
    if (front !== p.front) {
      p.front = front;
      p.axes.set(axisSet(front));
    }
    p.marksLayer.style.setProperty("--tn-fade", String(Math.max(0, 1 - presence * 1.5)));
    p.notesLayer.style.setProperty("--tn-fade", String(Math.max(0, presence * 1.5 - 0.5)));
  };

  /** Write the shown phase and sweep into the scene. */
  const draw = () => {
    if (!parts) return;
    const p = parts;
    const { amp, freq } = state;
    const degrees = shown.phase;
    const radians = (degrees / 360) * TAU;
    const all = shown.reveal >= 1;

    // The sheet: every slice up to the live wave, or all of it.
    const laid = all ? SLICES - 1 : Math.min(SLICES - 1, Math.floor(degrees / PHASE_STEP + 1e-9) + 1);
    p.family.geometry.instanceCount = (laid * POINTS) / SHEET_EVERY;
    const nearest = Math.round(degrees / PHASE_STEP);
    if (nearest !== p.nearest) {
      p.nearest = nearest;
      p.delta.forEach((_, c) => { p.delta[c] = c - degrees / PHASE_STEP; });
      p.family.userData.recolour?.();
    }

    // One straight line per crest, drawn up to the live wave.
    const reach = all ? 360 : degrees;
    /** @type {number[]} */
    const crest = [];
    for (const c of crestLines(freq)) {
      if (c.p0 >= reach) continue;
      const p1 = Math.min(c.p1, reach);
      const t1 = c.t0 + ((c.t1 - c.t0) * (p1 - c.p0)) / (c.p1 - c.p0);
      crest.push(MAP.x(c.t0), MAP.y(amp), MAP.z(c.p0), MAP.x(t1), MAP.y(amp), MAP.z(p1));
    }
    p.crests.userData.count = crest.length / 6;
    setSegments(p.crests, crest.length ? crest : [0, 0, 0, 0, 0, 0]);

    // The live wave, the amplitude bar and the phase bracket, in its plane.
    const z = MAP.z(degrees);
    p.highlight.set(inScene(wave(amp, freq, radians), degrees));
    p.highlight.chip?.set({ text: chipText(freq, degrees, frame.clientWidth < 560) });
    setSegments(p.bar, [MAP.x(BAR_T), MAP.y(0), z, MAP.x(BAR_T), MAP.y(amp), z]);
    const b = bracket(freq, radians);
    p.gap.visible = p.ticks.visible = Boolean(b);
    /** @type {import("./lib/labels.js").Label[]} */
    const marks = [{ text: "amplitude", at: [MAP.x(BAR_T) + 0.016, MAP.y(amp / 2), z], align: "start", dy: 0 }];
    if (b) {
      const h = 0.045;
      setSegments(p.gap, [MAP.x(b.refT), MAP.y(0), z, MAP.x(b.liveT), MAP.y(0), z]);
      setSegments(p.ticks, [b.refT, b.liveT].flatMap((t) => [MAP.x(t), MAP.y(0) - h, z, MAP.x(t), MAP.y(0) + h, z]));
      marks.push({ text: "phase", at: [MAP.x((b.refT + b.liveT) / 2), MAP.y(0), z], align: "middle", dy: 16 });
    }
    p.marks.set(marks);
    // The note, at the back end of the whole crest line nearest the middle,
    // once the sheet is laid: one turn moved this crest one period earlier.
    const whole = crestLines(freq).filter((c) => c.p0 === 0 && c.p1 === 360)
      .sort((a, c) => Math.abs(a.t1 - SPAN / 2) - Math.abs(c.t1 - SPAN / 2));
    p.notes.set(all && whole.length ? [{
      text: "one turn: one period earlier", at: [MAP.x(whole[0].t1) + 0.03, MAP.y(amp), MAP.z(360)], align: "start", dy: -12,
    }] : []);
    applyPresence(p);
    placeChip();
    probe.shown = { ...shown };
  };

  /**
   * The chip in the free corner of the frame: of its four corners, the one
   * whose chip box covers least of the box on screen and of the labels,
   * then the nearest to the live wave; its leader runs to the wave's crest.
   * When every corner covers the box (Front, or zoomed in) it goes beside
   * the crest, on whichever side keeps it off the labels.
   */
  const placeChip = () => {
    const chip = parts?.highlight.chip;
    const layer = chip?.node.parentElement;
    const line = layer?.querySelector("line");
    const v = vec;
    const cam = ctxRef?.camera;
    if (!chip || !layer || !line || !cam || !v || layer.classList.contains("anim-chip-layer--pinned")) return;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const bw = chip.node.offsetWidth;
    const bh = chip.node.offsetHeight;
    if (!w || !h || !bw) return;
    const ax = Number(line.getAttribute("x1"));
    const ay = Number(line.getAttribute("y1"));
    const hull = convexHull(CORNERS.map((c) => {
      v.set(...c).project(cam);
      return /** @type {[number, number]} */ ([((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h]);
    }));
    const at = frame.getBoundingClientRect();
    // Labels that show: a layer faded out with the turn does not count.
    const labels = [...frame.querySelectorAll(".anim-figure__label:not([hidden])")].filter((n) => {
      const layer = n.closest(".anim-figure__overlay");
      return !layer || Number(getComputedStyle(layer).getPropertyValue("--tn-fade") || 1) > 0.05;
    }).map((n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left - at.left, top: r.top - at.top, right: r.right - at.left, bottom: r.bottom - at.top };
    });
    const E = 8;
    /** @param {number} value @param {number} lo @param {number} hi */
    const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
    let best = null;
    let bestScore = Infinity;
    const G = 14;
    const spots = [[E, E], [w - E - bw, E], [E, h - E - bh], [w - E - bw, h - E - bh],
      [ax + G, ay - G - bh], [ax - G - bw, ay - G - bh], [ax + G, ay + G], [ax - G - bw, ay + G],
      [ax + G, ay - bh / 2], [ax - G - bw, ay - bh / 2]]
      .map(([left, top]) => [clamp(left, E, w - E - bw), clamp(top, E, h - E - bh)]);
    for (const [left, top] of spots) {
      let covered = top > h / 2 ? 2 : 0;
      // At Front the box is the whole plot: only the labels and the leader count.
      for (let i = 0; i <= 6 && presence >= 0.5; i += 1) {
        for (let j = 0; j <= 2; j += 1) if (insideHull(hull, left + (bw * i) / 6, top + (bh * j) / 2)) covered += 1;
      }
      // A label under the chip, or crossed by its leader.
      const lx = clamp(ax, left, left + bw);
      const ly = clamp(ay, top, top + bh);
      for (const r of labels) {
        if (r.left < left + bw && r.right > left && r.top < top + bh && r.bottom > top) covered += 8;
        if (crosses(ax, ay, lx, ly, r)) covered += 4;
      }
      // A long leader costs too: 100 px of it weighs as much as one point covered.
      const score = covered * 1_000 + 10 * Math.hypot(clamp(ax, left, left + bw) - ax, clamp(ay, top, top + bh) - ay);
      if (score < bestScore) {
        bestScore = score;
        best = [left, top];
      }
    }
    if (!best) return;
    const [left, top] = best;
    chip.node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    line.setAttribute("x2", clamp(ax, left, left + bw).toFixed(1));
    line.setAttribute("y2", clamp(ay, top, top + bh).toFixed(1));
  };

  /** @type {ReturnType<typeof setTimeout> | 0} */
  let labelTimer = 0;
  const describe = () => {
    const degrees = Math.round(toDegrees(state.phase));
    return "Every phase of the wave at once, laid out in depth. Depth is phase, 0 to 360 degrees. " +
      `The thick wave is the one you are changing, at phase ${degrees} degrees, shifted ` +
      `${shiftCycles(state.freq, state.phase).toFixed(3)} cycles of the reference earlier than at phase 0. ` +
      "Behind it, thin waves show every other phase 15 degrees apart, and a straight line joins each crest " +
      `across them: one turn of phase is one period of this wave, ${period(state.freq).toFixed(3)} cycles ` +
      "of the reference, so each crest line ends where the next crest started.";
  };

  // Labels and the chip stay hidden while the 2D canvas still shows (the
  // view switch hides it once this view has drawn), then fade in: the two
  // views' labels never show at once.
  const flat = frame.querySelector("canvas.anim-figure__canvas:not(.anim-figure__canvas--3d)");
  const waitForSwap = () => frame.toggleAttribute("data-tn-wait", flat instanceof HTMLElement && !flat.hidden);
  waitForSwap();
  const swapped = new MutationObserver(waitForSwap);
  if (flat) swapped.observe(flat, { attributes: true, attributeFilter: ["hidden"] });
  const unwatch = () => {
    swapped.disconnect();
    frame.removeAttribute("data-tn-wait");
  };
  opts.signal.addEventListener("abort", unwatch, { once: true });

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    build: (c) => void build(c),
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) {
    unwatch();
    return null;
  }
  const T = ctx.three;

  // Front is the 2D plot; any other pose widens the frustum to keep the
  // box and its labels inside the frame.
  const fitted = matchPlot(ctx, () => plotRect(frame.clientWidth, frame.clientHeight), MAP.box);
  const v = new T.Vector3();
  /** CSS px kept clear around the box once turned: room for the axis labels and the chip. */
  const WIDE = { left: 44, right: 22, top: 26, bottom: 6 };
  const NARROW = { left: 30, right: 14, top: 16, bottom: 4 };
  const fit = () => {
    fitted.fit();
    const cam = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    if (!cam.isOrthographicCamera) return;
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    const MARGIN = W < 560 ? NARROW : WIDE;
    cam.updateMatrixWorld();
    const front = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom };
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const c of CORNERS) {
      v.set(...c).applyMatrix4(cam.matrixWorldInverse);
      [x0, x1, y0, y1] = [Math.min(x0, v.x), Math.max(x1, v.x), Math.min(y0, v.y), Math.max(y1, v.y)];
    }
    // Turned, the box is drawn at one scale on both axes (Front's is the 2D
    // plot's, which need not be), as large as the margins allow, centred
    // in what is left.
    const px = Math.min((W - MARGIN.left - MARGIN.right) / (x1 - x0), (H - MARGIN.top - MARGIN.bottom) / (y1 - y0));
    const cx = (x0 + x1) / 2 + (MARGIN.right - MARGIN.left) / 2 / px;
    const cy = (y0 + y1) / 2 + (MARGIN.top - MARGIN.bottom) / 2 / px;
    const left = cx - W / 2 / px;
    const bottom = cy - H / 2 / px;
    const spanX = W / px;
    const spanY = H / px;
    // Eased in over the first 12 degrees of a turn, so Front stays exact.
    cam.getWorldDirection(v);
    const turned = Math.acos(Math.min(1, Math.max(-1, -v.z))) * (180 / Math.PI);
    const k = Math.min(1, turned / 12);
    const w = k * k * (3 - 2 * k);
    const mixTo = (/** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * w;
    cam.left = mixTo(front.left, left);
    cam.right = mixTo(front.right, left + spanX);
    cam.bottom = mixTo(front.bottom, bottom);
    cam.top = mixTo(front.top, bottom + spanY);
    // Dashes as long as the 2D canvas draws them, at zoom 1.
    const unit = (DASH_PX * (cam.right - cam.left)) / W;
    for (const line of parts ? [parts.reference, parts.last] : []) {
      line.material.dashSize = unit;
      line.material.gapSize = unit;
    }
  };

  /** @type {ReturnType<typeof createOrbit> | null} */
  let turn = null;
  const orbit = createOrbit(ctx, {
    target: fitted.target, fit, distance: DISTANCE, zoom: opts.look.zoom || 1, presets: PRESETS, start: "corner",
    onDrag: opts.onDrag,
    onChange: () => {
      const pose = turn?.pose() ?? CORNER;
      presence = Math.min(1, Math.max(Math.abs(pose.pitch), Math.abs(((pose.yaw + 540) % 360) - 180)) / 20);
      if (parts) {
        applyPresence(parts);
        parts.axes.update();
        parts.marks.update();
        parts.notes.update();
        placeChip();
      }
      probe.pose = turn?.pose() ?? null;
      probe.zoom = turn?.zoom() ?? 1;
    },
  });
  turn = orbit;
  probe.pose = orbit.pose();
  probe.set = (pose) => orbit.set(pose);

  /** Scene to data, per axis: the inverse of MAP. */
  const unmap = (/** @type {"x" | "y" | "z"} */ axis, /** @type {number} */ value) => {
    const [a0, a1] = axis === "x" ? [0, SPAN] : axis === "y" ? Y_DOMAIN : [360, 0];
    return a0 + ((value - MAP[axis](a0)) / (MAP[axis](a1) - MAP[axis](a0))) * (a1 - a0);
  };
  probe.frontPoints = () => {
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (!parts) return { rect: plotRect(w, h), reference: [], live: [], bracket: [], bar: [] };
    /**
     * Segment ends of a fat line as the scene holds them, every n-th, in
     * data units and projected with the camera as it is now.
     * @param {FatLine} line @param {number} [every=1]
     */
    const read = (line, every = 1) => {
      const g = /** @type {any} */ (line.geometry);
      const out = [];
      for (let i = 0; i < g.instanceCount; i += every) {
        for (const end of [g.attributes.instanceStart, g.attributes.instanceEnd]) {
          v.set(end.getX(i), end.getY(i), end.getZ(i));
          const point = { t: unmap("x", v.x), v: unmap("y", v.y), degrees: unmap("z", v.z) };
          v.project(ctx.camera);
          out.push({ ...point, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h });
        }
      }
      return out;
    };
    const line = /** @type {FatLine} */ (parts.highlight.children.find((c) => c.renderOrder === 11));
    return {
      rect: plotRect(w, h),
      reference: read(parts.reference, 24),
      live: read(line, 24),
      bracket: parts.gap.visible ? read(parts.gap) : [],
      bar: read(parts.bar),
    };
  };
  probe.context = () => {
    if (!parts) return [];
    const outline = parts.highlight.children.find((c) => /** @type {any} */ (c).material?.dashed);
    return [parts.family, parts.last, parts.crests, outline].map((o) => Boolean(o?.visible) &&
      /** @type {any} */ (o).material.opacity > 0.02);
  };
  probe.boxOnScreen = () => {
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const xs = [];
    const ys = [];
    for (const c of CORNERS) {
      v.set(...c).project(ctx.camera);
      xs.push(((v.x + 1) / 2) * w);
      ys.push(((1 - v.y) / 2) * h);
    }
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  };
  probe.counts = () => {
    let segments = 0;
    ctx.scene.traverse((o) => {
      const g = /** @type {any} */ (o).geometry;
      if (o.visible && g?.attributes?.instanceStart) segments += g.instanceCount ?? 0;
    });
    return { segments, draws: ctx.renderer.info.render.calls };
  };

  // The explanatory animation, once, when the figure is half in view.
  const intro = ctx.timeline();
  if (opts.intro) {
    probe.played = true;
    orbit.set(FRONT);
    const camera = duration("3d-camera");
    void intro.play("turn", {
      ms: camera, ease: "inout", build: true,
      step: (t) => orbit.set({ yaw: CORNER.yaw * t, pitch: CORNER.pitch * t }),
    });
    // One track: the sweep, the hold on the 360 slice, then the slide back
    // along the crest lines to the slider's phase, so a finish lands on the
    // end state in one step.
    const total = SWEEP_MS + HOLD_MS + SETTLE_MS;
    void intro.play("sweep", {
      ms: total, ease: "linear", build: true, delay: camera * 0.6,
      step: (t) => {
        const ms = t * total;
        const target = toDegrees(state.phase);
        if (t >= 1) {
          shown.phase = target;
          shown.reveal = 1;
        } else if (ms < SWEEP_MS) {
          shown.phase = (360 * ms) / SWEEP_MS;
          shown.reveal = Math.min(ms / SWEEP_MS, 0.999);
        } else {
          const k = Math.max(0, ms - SWEEP_MS - HOLD_MS) / SETTLE_MS;
          const eased = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
          shown.phase = 360 + (target - 360) * eased;
          shown.reveal = 1;
        }
        draw();
      },
    }).then(() => void parts?.highlight.pulse());
  }

  await ctx.drawn();

  return {
    update: (next) => {
      intro.finish();
      state = /** @type {WaveState} */ (next);
      shown.phase = toDegrees(state.phase);
      shown.reveal = 1;
      if (parts) {
        const sheet = slices(state.amp, state.freq);
        setSegments(parts.family, segmentsOf(sheet.slice(0, -1).map((s) => inScene(s.points, s.degrees, SHEET_EVERY))));
        parts.nearest = -1;
        const lastSlice = sheet[SLICES - 1];
        setSegments(parts.last, segmentsOf([inScene(lastSlice.points, lastSlice.degrees, SHEET_EVERY)]));
        parts.last.userData.recolour?.();
      }
      draw();
      ctx.requestRender();
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => {
        if (!ctx.parked) ctx.renderer?.domElement.setAttribute("aria-label", describe());
      }, 250);
    },
    preset: (name) => void orbit.go(name),
    describe,
    close: () => {
      clearTimeout(labelTimer);
      unwatch();
      ctx.dispose();
    },
  };
}
