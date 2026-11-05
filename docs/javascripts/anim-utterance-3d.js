// @ts-check
/* ===========================================================================
 * anim-utterance-3d.js: the utterance closeup cut into pitch periods and
 * stacked in depth (three-everywhere design §2.1, §4.4).
 * ---------------------------------------------------------------------------
 * Loaded by anim-utterance.js through lib/view-switch.js, only when a 3D
 * view is wanted. It takes the 2D module's arrays (the plotted samples,
 * the cuts from lib/periods.js, the 2D period marks) and only places them:
 *
 *   x  time in ms: 0 to 60 laid end to end, 0 to one period stacked
 *   y  amplitude, the closeup's own scale (peak 0.92)
 *   z  period number, 1 at the front to 10 at the back
 *
 * Laid end to end, every piece sits in the front plane at its own time,
 * so the Front preset is the 2D closeup (the 12 pieces tile it, and the
 * marker planes fall on the 2D marks). Stacked, each piece slides back to
 * its period's row and left by its cut, so every period starts at x = 0,
 * and the time axis narrows to one period, never so far that a piece not
 * yet moved would leave the box. The head and tail, which are not whole
 * periods, fade out past halfway and are gone once stacked; the marker
 * planes sink to the floor as their pieces fold, so stacked there are none.
 *
 * Explanatory animation (design: "A vowel is one pitch period repeated; a
 * fricative has no period to stack"): from laid end to end, each period
 * slides into depth one by one and folds to start at x = 0, staggered by
 * period number, while the camera turns from Front to Corner. Highlight:
 * the period that holds the window's largest sample.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { createLabels } from "./lib/labels.js";
import { FRONT, createOrbit, frontFrustum } from "./lib/orbit.js";
import { sampleAt } from "./lib/periods.js";
import { contactShadow, fadeAmount, fatLines, floor, fog, frostedFill, mix, rampColor, setFill, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-utterance.js").UtteranceState} UtteranceState */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./lib/orbit.js").Pose} Pose */

/** @type {Record<string, Pose>} */
const PRESETS = {
  front: FRONT,
  corner: { yaw: -24, pitch: 30 },
  along: { yaw: -9, pitch: 7 },
};

/** Rows of depth: one per whole period. */
const ROWS = 10;
/** Camera distance from the box centre (orthographic: only the order matters). */
const DISTANCE = 12;
/** Width of the ramp-coloured period lines (visual language §3). */
const LINE_PX = 1.75;

/**
 * @typedef {Object} Probe  TEST_HOOK.figures["utterance-3d"]
 * @property {number} builds
 * @property {Pose | null} pose
 * @property {number} zoom
 * @property {{px: number, py: number, ms: number, y: number}[]} frontPoints
 *           every piece's vertices projected at the current pose and zoom,
 *           with the data they came from
 * @property {{px: number, top: number, bottom: number}[]} markerPoints
 *           the marker planes' front edges, projected
 * @property {number} played  first-view animations started
 * @property {string} layout
 * @property {number[]} fold  each piece's fold, 0 laid to 1 stacked
 * @property {number} stretch  0 (60 ms across) to 1 (one period across)
 * @property {number} highlight  the piece the highlight draws
 * @property {{piece: number, visible: boolean}[]} fills  each context fill
 */

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  /** @type {UtteranceState} */
  let state = /** @type {UtteranceState} */ (opts.state);
  /** @type {Probe} */
  const probe = { builds: 0, pose: null, zoom: 1, frontPoints: [], markerPoints: [], played: 0, layout: state.layout, fold: [], stretch: 0, highlight: -1, fills: [] };
  if (TEST_HOOK) TEST_HOOK.figures["utterance-3d"] = probe;

  /* -- what is drawn, and how far along each piece is ------------------- */

  /** The y values the pieces read: the window now, or a morph between two. */
  let wave = state.wave;
  /** @type {number[] | null} */
  let morphFrom = null;
  let morph = 1;
  const stacked = () => state.layout === "stacked";
  // Opening with the animation starts laid end to end at the front (the
  // 2D view), and the animation folds it; otherwise the layout as asked.
  const start = opts.intro || !stacked() ? 0 : 1;
  /** Each piece's fold, 0 (laid) to 1 (stacked). */
  let fold = state.periods.pieces.map(() => /** @type {number} */ (start));
  /** 0: the time axis spans the window; 1: one period. */
  let stretch = /** @type {number} */ (start);

  /** Scene extents, set from the plot's shape on each build. */
  let ex = 6;
  const ey = 2;
  let ez = 3;

  /** @param {number} ms @returns {number} */
  const X = (ms) => {
    const span = state.ms + (state.periodMs - state.ms) * stretch;
    return (ms / span) * ex - ex / 2;
  };
  /** Row k (0 at the front) to scene z. @param {number} k */
  const Z = (k) => ez / 2 - (k * ez) / (ROWS - 1);

  /**
   * Where piece i lies now: its row, its shift in ms, and its fold.
   * @param {number} i
   */
  const pieceAt = (i) => {
    const { pieces, cuts } = state.periods;
    const piece = pieces[i];
    const first = pieces[0].kind === "head" ? 1 : 0;
    const row = i - first; // -1 for the head, ROWS for the tail
    const toMs = 1000 / state.sr;
    // The head is the end of the period before the first cut.
    const shift = (piece.kind === "head" ? cuts[0] - state.periods.period : piece.start) * toMs;
    const p = fold[i] ?? 1;
    return { piece, row, shift, p, z: Z(0) + p * (Z(row) - Z(0)) };
  };

  /** The plotted value at sample time t (morphing between windows). @param {number} t */
  const valueAt = (t) => {
    const now = sampleAt(wave, t);
    return morphFrom ? sampleAt(morphFrom, t) * (1 - morph) + now * morph : now;
  };

  /**
   * Piece i as flat x, y, z points, with the data each came from.
   * @param {number} i
   * @returns {{points: number[], data: {ms: number, y: number}[]}}
   */
  const piecePoints = (i) => {
    const { piece, shift, p, z } = pieceAt(i);
    const toMs = 1000 / state.sr;
    /** @type {number[]} */
    const points = [];
    /** @type {{ms: number, y: number}[]} */
    const data = [];
    for (const t of piece.ts) {
      const ms = t * toMs;
      const y = valueAt(t);
      points.push(X(ms - p * shift), y, z);
      data.push({ ms, y });
    }
    return { points, data };
  };

  /** The highlight: the period that holds the largest sample. */
  const highlightIndex = () => state.periods.pieces.findIndex((x) => x.kind === "period") + state.periods.peak;

  /* -- the scene --------------------------------------------------------- */

  /**
   * @typedef {Object} Built
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} lines
   * @property {import("three").Mesh[]} fills  one per period; the one under
 *           the highlight (which has its own fill) is hidden in place()
   * @property {number[]} fillPieces  the piece each fill belongs to
   * @property {ReturnType<typeof addHighlight>} highlight
   * @property {import("three").Mesh} quads
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} edges
   * @property {ReturnType<typeof createLabels>} labels
   */
  /** @type {Built | null} */
  let built = null;
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;

  /**
   * Whether piece i is drawn among the context lines: not the highlight,
   * and not the head or tail once they have faded out.
   * @param {number} i
   */
  const shown = (i) => i !== highlightIndex()
    && (state.periods.pieces[i].kind === "period" || (fold[i] ?? 1) < 0.95);

  /** Per-vertex colours of the context pieces: ramp by period, faded. */
  const lineColours = () => {
    // The context fades toward the stage it is drawn on, not the plot
    // background, which the 3D view does not show.
    const bg = mix(tokenHex("--ambe-stage-top"), tokenHex("--ambe-stage-bottom"), 0.5);
    const peak = highlightIndex();
    /** @type {number[]} */
    const out = [];
    const cutaway = (orbit?.pose().pitch ?? 0) < 60;
    state.periods.pieces.forEach((piece, i) => {
      if (!shown(i)) return;
      const { row, p } = pieceAt(i);
      let colour = piece.kind === "period" ? rampColor(row / (ROWS - 1)) : tokenHex("--ambe-plot-muted");
      // Stacked, the context fades with its distance from the highlight,
      // and a period in front of it takes the cutaway's extra fade.
      const delta = row - (peak - (state.periods.pieces[0].kind === "head" ? 1 : 0));
      let amount = fadeAmount(delta) * p;
      if (cutaway && delta < 0 && p > 0.5) amount = Math.min(1, amount + 0.15);
      // The head and tail are not whole periods: gone past halfway.
      if (piece.kind !== "period") amount = Math.max(amount, Math.min(1, Math.max(0, (p - 0.5) * 2)));
      colour = mix(colour, bg, amount);
      for (let n = (piece.ts.length - 1) * 2; n > 0; n -= 1) out.push(colour);
    });
    return out;
  };

  /** Segments of every piece drawn as context (shown()). */
  const lineSegments = () => {
    /** @type {number[]} */
    const segments = [];
    state.periods.pieces.forEach((_, i) => {
      if (!shown(i)) return;
      const { points } = piecePoints(i);
      for (let j = 0; j + 3 < points.length; j += 3) segments.push(...points.slice(j, j + 6));
    });
    return segments;
  };

  /**
   * Marker quads (one per 2D period mark, in its piece's row) and their
   * edges. Laid end to end they stand on the 2D marks; as a piece folds,
   * its marker sinks to the floor, so stacked (where every mark would fall
   * at the same x and fence the peaks) there are none.
   */
  const markerGeometry = () => {
    /** @type {number[]} */
    const quads = [];
    /** @type {number[]} */
    const edges = [];
    const half = (0.42 * ez) / (ROWS - 1);
    for (const m of state.marks) {
      const t = (m / 1000) * state.sr;
      const i = state.periods.pieces.findIndex((x) => t >= x.start && t <= x.end);
      if (i < 0) continue;
      const { shift, p, z } = pieceAt(i);
      if (p > 0.98) continue;
      const x = X(m - p * shift);
      const [z0, z1] = [z - half, z + half];
      const top = 1 - 2 * p;
      quads.push(x, -1, z1, x, top, z1, x, top, z0, x, -1, z1, x, top, z0, x, -1, z0);
      edges.push(x, -1, z1, x, top, z1);
    }
    return { quads, edges };
  };

  /** Fade for the whole of the pieces' fills: shown once stacked. */
  const fillShown = (/** @type {number} */ p) => p > 0.55;

  /** Everything that moves, placed from fold, stretch and the wave. */
  const place = () => {
    if (!built || !ctx) return;
    const b = built;
    setSegments(b.lines, lineSegments());
    b.lines.userData.recolour?.();
    const cutaway = (orbit?.pose().pitch ?? 0) < 60;
    const peak = highlightIndex();
    // The highlight is worked out now, not at build: a window change can
    // move it to another period, whose context fill must then go.
    b.fills.forEach((mesh, n) => {
      const i = b.fillPieces[n];
      const { points } = piecePoints(i);
      const xs = points.filter((_, j) => j % 3 === 0);
      const ys = points.filter((_, j) => j % 3 === 1);
      const { p, z, row } = pieceAt(i);
      setFill(/** @type {ThreeContext} */ (ctx), mesh, xs, ys, z, -1);
      // The cutaway: no surface in front of the highlight below 60 degrees.
      const front = row < peak - (state.periods.pieces[0].kind === "head" ? 1 : 0);
      mesh.visible = i !== peak && fillShown(p) && !(cutaway && front);
    });
    const { points } = piecePoints(peak);
    b.highlight.set(points);
    const face = faceNow();
    placeChip(points, face);
    const { quads, edges } = markerGeometry();
    const geometry = b.quads.geometry;
    geometry.setAttribute("position", new (/** @type {ThreeContext} */ (ctx)).three.BufferAttribute(new Float32Array(quads), 3));
    geometry.computeBoundingSphere();
    setSegments(b.edges, edges.length ? edges : [0, 0, 0, 0, 0, 0]);
    b.edges.visible = b.quads.visible = edges.length > 0;
    probe.fold = [...fold];
    probe.stretch = stretch;
    probe.layout = state.layout;
    probe.highlight = peak;
    probe.fills = b.fills.map((mesh, n) => ({ piece: b.fillPieces[n], visible: mesh.visible }));
    state.front(face);
    setLabels();
    ctx?.requestRender();
  };

  /**
   * The chip's anchor. Turned away it is the highlight's largest sample
   * (lib/highlight.js). Where the 2D overlay shows the sentence strip above
   * the closeup, that point is the closeup's top edge and the chip would
   * sit on the strip's time axis; there the anchor moves down the curve to
   * the highest point that leaves room for the chip below those labels.
   * @param {number[]} points the highlight's vertices, flat x, y, z
   * @param {import("./anim-utterance.js").Face} face
   */
  const placeChip = (points, face) => {
    const chip = built?.highlight.chip;
    if (!chip || !ctx || face === "none") return;
    const r = state.rect();
    // The strip's tick labels end about 12 px above the closeup, so the
    // chip may use the 8 px of the gap below them (a phone's closeup is
    // barely taller than the chip and its leader).
    const room = r.y - 8 + 14 + (chip.node.offsetHeight || 24);
    /** @type {[number, number, number] | null} */
    let best = null;
    let bestY = Infinity;
    /** @type {[number, number, number] | null} */
    let lowest = null;
    let lowestY = -Infinity;
    for (let j = 0; j + 2 < points.length; j += 3) {
      const at = /** @type {[number, number, number]} */ ([points[j], points[j + 1], points[j + 2]]);
      const [, py] = project(...at);
      if (py >= room && py < bestY) [best, bestY] = [at, py];
      if (py > lowestY) [lowest, lowestY] = [at, py];
    }
    const at = best ?? lowest;
    if (at) chip.set({ at });
  };

  /** @param {ThreeContext} c */
  const build = (c) => {
    const T = c.three;
    probe.builds += 1;
    const r = state.rect();
    // The same scale across and up, so a turned view is not squashed.
    ex = ey * (r.width / Math.max(1, r.height));
    ez = ex * 0.42;
    const box = { min: /** @type {[number, number, number]} */ ([-ex / 2, -1, -ez / 2]), max: /** @type {[number, number, number]} */ ([ex / 2, 1, ez / 2]) };
    c.scene.add(floor(c, { extent: box, step: [ex / 10, ez / (ROWS - 1)] }));
    c.scene.add(contactShadow(c, { x: [-ex / 2, ex / 2], z: [-ez / 2, ez / 2], y: -1 }));
    const lines = fatLines(c, lineSegments(), lineColours, LINE_PX, { fog: true });
    c.scene.add(lines);
    const peak = highlightIndex();
    /** @type {import("three").Mesh[]} */
    const fills = [];
    /** @type {number[]} */
    const fillPieces = [];
    state.periods.pieces.forEach((piece, i) => {
      if (piece.kind !== "period") return;
      const { points } = piecePoints(i);
      const mesh = frostedFill(c, points.filter((_, j) => j % 3 === 0), points.filter((_, j) => j % 3 === 1),
        pieceAt(i).z, -1, "--ambe-3d-floor", "--ambe-stage-bottom");
      c.scene.add(mesh);
      fills.push(mesh);
      fillPieces.push(i);
    });
    const highlight = addHighlight(c, piecePoints(peak).points, {
      baseline: -1,
      chip: chipText(),
    });
    c.scene.add(highlight);
    const quads = new T.Mesh(new T.BufferGeometry(), c.paint(new T.MeshBasicMaterial({
      side: T.DoubleSide, depthWrite: false,
    }), "--ambe-accent-warm-soft"));
    const edges = fatLines(c, [0, 0, 0, 0, 0, 0], "--ambe-accent-warm", 1.5, { dashed: true, dash: 0.08, gap: 0.06 });
    c.scene.add(quads, edges);
    fog(c, DISTANCE, ez + ex * 0.5);
    const labels = createLabels(c.frame, c);
    c.track({ dispose: labels.dispose });
    built = { lines, fills, fillPieces, highlight, quads, edges, labels };
    labelsShown = null;
    place();
  };

  const chipText = () => (state.which === "voiced"
    ? `one period: ${state.periodMs.toFixed(2)} ms`
    : `the vowel's period: ${state.periodMs.toFixed(2)} ms`);

  /** The label set last given to the layer, so place() sets it only on a change. */
  /** @type {string | null} */
  let labelsShown = null;

  /**
   * Words for the stack, once it is stacked; none laid end to end. The
   * time axis now spans one period, so the floor's front edge says so in
   * every pose ("0 ms" to "5.38 ms"). The rows are named at the right end,
   * clear of the highlight's outline; not on a phone, where they would
   * crowd the chip (the 3D caption says the earliest is at the front).
   */
  const setLabels = () => {
    if (!built || !ctx) return;
    const show = stretch > 0.99 && fold.every((p) => p > 0.99);
    const rows = ctx.frame.clientWidth >= 560;
    const key = `${show}:${rows}:${state.periodMs}`;
    if (key === labelsShown) return;
    labelsShown = key;
    const x1 = ex / 2;
    const off = ex * 0.03;
    /** @type {[number, number, number]} */
    const depth = [0, 0, 1];
    built.labels.set(show ? [
      ...(rows ? [
        { text: "period 1", at: /** @type {[number, number, number]} */ ([x1 + off, -1, Z(0)]), align: /** @type {const} */ ("start"), along: depth, dy: -8 },
        { text: `period ${ROWS}`, at: /** @type {[number, number, number]} */ ([x1 + off, -1, Z(ROWS - 1)]), align: /** @type {const} */ ("start"), along: depth, dy: -8 },
      ] : []),
      { text: "0 ms", at: [-ex / 2, -1, Z(0)], align: "middle", tick: true, dy: 12 },
      { text: `${state.periodMs.toFixed(2)} ms`, at: [x1, -1, Z(0)], align: "middle", tick: true, dy: 12 },
    ] : []);
  };

  /* -- the camera's fit -------------------------------------------------- */

  /**
   * Front: the box on the 2D closeup's plot area (matchPlot's fit, so the
   * front view equals 2D). Turned away from the front, the fit moves to
   * hold the whole box inside the frame, eased in over the first 12
   * degrees, so a turned stack is not cut off by the frame's top.
   */
  const fit = () => {
    if (!ctx) return;
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const W = ctx.frame.clientWidth;
    const H = ctx.frame.clientHeight;
    if (!W || !H) return;
    const box = { min: /** @type {[number, number, number]} */ ([-ex / 2, -1, -ez / 2]), max: /** @type {[number, number, number]} */ ([ex / 2, 1, ez / 2]) };
    const f = frontFrustum({ width: W, height: H }, state.rect(), box);
    const pose = orbit?.pose() ?? (opts.intro ? FRONT : PRESETS[state.preset] ?? FRONT);
    const away = Math.min(1, Math.hypot(((((pose.yaw % 360) + 540) % 360) - 180), pose.pitch) / 12);
    if (away > 0) {
      const rad = Math.PI / 180;
      const [sy, cy, sp, cp] = [Math.sin(pose.yaw * rad), Math.cos(pose.yaw * rad), Math.sin(pose.pitch * rad), Math.cos(pose.pitch * rad)];
      let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const x of [-ex / 2, ex / 2]) for (const y of [-1, 1]) for (const z of [-ez / 2, ez / 2]) {
        const u = x * cy - z * sy;
        const v = -x * sp * sy + y * cp - z * sp * cy;
        [u0, u1, v0, v1] = [Math.min(u0, u), Math.max(u1, u), Math.min(v0, v), Math.max(v1, v)];
      }
      // Stacked, room under the floor's front edge for its time labels
      // (lib/labels.js keeps the frame's bottom 56 px clear).
      const margin = { x: 16, top: 14, bottom: 34 + 36 * stretch };
      const k = Math.min((W - 2 * margin.x) / (u1 - u0), (H - margin.top - margin.bottom) / (v1 - v0));
      const cx = W / 2;
      const cyPx = margin.top + (H - margin.top - margin.bottom) / 2;
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      const c = { left: uc - cx / k, right: uc + (W - cx) / k, top: vc + cyPx / k, bottom: vc - (H - cyPx) / k };
      for (const key of /** @type {const} */ (["left", "right", "top", "bottom"])) f[key] += (c[key] - f[key]) * away;
    }
    Object.assign(camera, f);
  };

  /* -- mount --------------------------------------------------------------- */

  /** @type {ThreeContext | null} */
  let ctx = null;
  /** @type {import("three").Vector3 | undefined} */
  let projected;
  const view = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!view) return null;
  ctx = view;
  const c3 = view;

  const startPose = opts.intro ? "front" : state.preset in PRESETS ? state.preset : "corner";
  orbit = createOrbit(c3, {
    target: [0, 0, 0],
    distance: DISTANCE,
    zoom: opts.look.zoom || 1,
    presets: PRESETS,
    start: state.preset in PRESETS ? state.preset : "corner",
    fit,
    onDrag: opts.onDrag,
    onChange: () => {
      probe.pose = orbit?.pose() ?? null;
      probe.zoom = orbit?.zoom() ?? 1;
      built?.labels.update();
      // The cutaway follows the pitch.
      if (built) {
        built.lines.userData.recolour?.();
        place();
      }
    },
  });
  if (opts.intro) orbit.set(PRESETS[startPose]);
  place();
  /** The view's own tracks (fold, stretch, morph): a new step lands them,
   *  and leaves a camera flight the same step started to run. */
  const tl = c3.timeline();

  // The test probe projects on demand (project(), below): every piece's
  // vertices, and the marker planes' front edges, in CSS px of the frame.
  Object.defineProperties(probe, {
    frontPoints: {
      enumerable: true,
      get: () => state.periods.pieces.flatMap((_, i) => {
        const { points, data } = piecePoints(i);
        return data.map((d, j) => {
          const [px, py] = project(points[j * 3], points[j * 3 + 1], points[j * 3 + 2]);
          return { px, py, ms: d.ms, y: d.y };
        });
      }),
    },
    markerPoints: {
      enumerable: true,
      get: () => {
        const { edges } = markerGeometry();
        /** @type {{px: number, top: number, bottom: number}[]} */
        const out = [];
        for (let j = 0; j < edges.length; j += 6) {
          const [px, bottom] = project(edges[j], edges[j + 1], edges[j + 2]);
          const [, top] = project(edges[j + 3], edges[j + 4], edges[j + 5]);
          out.push({ px, top, bottom });
        }
        return out;
      },
    },
  });

  /** A scene point in CSS px of the frame. @param {number} x @param {number} y @param {number} z @returns {[number, number]} */
  function project(x, y, z) {
    if (!ctx) return [0, 0];
    projected ??= new ctx.three.Vector3();
    ctx.camera.updateMatrixWorld();
    projected.set(x, y, z).project(ctx.camera);
    return [((projected.x + 1) / 2) * frame.clientWidth, ((1 - projected.y) / 2) * frame.clientHeight];
  }

  /**
   * How much of the 2D overlay the view leaves room for (state.front):
   * at the front preset at 1x the strip, and laid end to end there the
   * closeup's frame too; turned away or zoomed, nothing.
   * @returns {import("./anim-utterance.js").Face}
   */
  function faceNow() {
    const pose = orbit?.pose();
    if (!pose) return "none";
    const yaw = ((((pose.yaw % 360) + 540) % 360) - 180);
    const front = Math.abs(yaw) < 0.5 && Math.abs(pose.pitch) < 0.5 && (orbit?.zoom() ?? 1) < 1 + 1e-6;
    const laid = fold.every((p) => p === 0) && stretch === 0;
    return front ? (laid && Math.abs(yaw) < 1e-6 && Math.abs(pose.pitch) < 1e-6 ? "all" : "strip") : "none";
  }

  /** Smoothstep of x over [a, b]. @param {number} x @param {number} a @param {number} b */
  const ramp01 = (x, a, b) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };

  /**
   * The most the time axis may narrow now: a piece not yet moved left
   * still reaches its laid time, and the axis must hold it, or a late
   * piece would leave the box (and the frame) on its way to the back.
   */
  const stretchCap = () => {
    const toMs = 1000 / state.sr;
    let end = state.periodMs;
    state.periods.pieces.forEach((piece, i) => {
      if (piece.kind !== "period" && (fold[i] ?? 1) >= 0.95) return;
      const { shift, p } = pieceAt(i);
      end = Math.max(end, piece.end * toMs - p * shift);
    });
    return Math.min(1, Math.max(0, (state.ms - end) / (state.ms - state.periodMs)));
  };

  /**
   * Fold every piece to `to` (1 stacked, 0 laid), staggered by period
   * number, on one track. The time axis narrows (or widens) behind the
   * pieces, from a quarter of the way through to the end and never past
   * stretchCap(), so the stack gathers at the left and then spreads to
   * one period across. With
   * `turn` (the first view), the camera turns from Front to Corner over
   * the same track.
   * @param {number} to
   * @param {{turn?: boolean, build?: boolean}} [how]
   */
  const refold = (to, how = {}) => {
    const from = [...fold];
    const s0 = stretch;
    const n = fold.length;
    const order = to > 0 ? [...fold.keys()] : [...fold.keys()].reverse();
    const progress = new Array(n).fill(0);
    const turnFrom = orbit?.pose() ?? FRONT;
    const turnTo = PRESETS.corner;
    const promise = tl.play("fold", {
      ms: how.turn ? duration("3d-build") : 640,
      stagger: how.turn ? 70 : 40,
      count: n,
      build: how.build,
      delay: how.turn ? 200 : 0,
      step: (t, j) => {
        const i = order[j];
        progress[j] = t;
        fold[i] = t === 1 ? to : from[i] + (to - from[i]) * t;
        // Every item steps once a frame, in order: place them all after
        // the last one.
        if (j !== n - 1) return;
        const all = progress.reduce((sum, p) => sum + p, 0) / n;
        const s = ramp01(all, 0.25, 1);
        stretch = all === 1 ? to : Math.min(s0 + (to - s0) * s, stretchCap());
        if (how.turn && orbit) {
          const c = ramp01(all, 0, 0.85);
          orbit.set({ yaw: turnFrom.yaw + (turnTo.yaw - turnFrom.yaw) * c, pitch: turnFrom.pitch + (turnTo.pitch - turnFrom.pitch) * c });
        }
        place();
      },
    });
    return promise;
  };

  if (opts.intro && stacked()) {
    probe.played += 1;
    void refold(1, { turn: true, build: true });
  }

  await c3.drawn();

  let labelTimer = 0;
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      c3.renderer?.domElement.setAttribute("aria-label", describe());
    }, 250);
  };

  /** @returns {string} */
  function describe() {
    const who = state.which === "voiced" ? "The vowel's 60 ms" : "The fricative's 60 ms";
    const how = state.layout === "stacked"
      ? `cut into ${ROWS} slices of ${state.periodMs.toFixed(2)} ms and stacked in depth, earliest at the front, each starting at zero`
      : `cut into ${ROWS} slices of ${state.periodMs.toFixed(2)} ms and laid end to end, as in the flat view`;
    const what = state.which === "voiced"
      ? "Each slice is nearly the same shape as the one before it, and the shape drifts slowly across the window."
      : "No two slices agree; the fricative has no period, so the cut uses the vowel's.";
    return `${who}, ${how}. ${what} The thick slice holds the window's largest sample.`;
  }

  return {
    update: (next) => {
      const prev = state;
      state = /** @type {UtteranceState} */ (next);
      tl.finish();
      if (prev.which !== state.which) {
        // Same structure, new values: the pieces morph to the new window,
        // and the highlight pulses for the new selection.
        morphFrom = prev.wave;
        wave = state.wave;
        morph = 0;
        fold = state.periods.pieces.map((_, i) => fold[i] ?? (stacked() ? 1 : 0));
        built?.highlight.chip?.set({ text: chipText() });
        void tl.play("morph", {
          ms: duration("med"),
          step: (t) => {
            morph = t;
            if (t === 1) morphFrom = null;
            place();
          },
        }).then(() => built?.highlight.pulse());
      }
      if (prev.layout !== state.layout) void refold(stacked() ? 1 : 0);
      place();
      relabel();
    },
    preset: (name) => {
      if (orbit && name in PRESETS) void orbit.go(name);
    },
    describe,
    close: () => {
      clearTimeout(labelTimer);
      state.front("none");
      c3.dispose();
    },
  };
}
