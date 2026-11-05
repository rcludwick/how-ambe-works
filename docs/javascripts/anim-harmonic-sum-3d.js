// @ts-check
/* ===========================================================================
 * anim-harmonic-sum-3d.js: the harmonic-sum figure in 3D (ch11). Every
 * amplitude and phase comes from anim-harmonic-sum.js; this part draws them.
 * ---------------------------------------------------------------------------
 * x is time over two pitch periods, height the value, depth the harmonic
 * number: harmonic 1 at the front, the last harmonic under the cutoff at
 * the back, and the sum in front of them all. Each harmonic is a frosted
 * curtain with a 1.75 px edge on the ramp by harmonic number; the newest
 * harmonic carries the highlight kit (chip "newest: harmonic k"); the sum is
 * a 3 px ink line with a light frosted fill; a dashed ink line, on a halo
 * of the ground, joins each harmonic's crest nearest t = 0 and lands on
 * the sum at t = 0. From the side each curtain is a bar whose
 * height, crest to trough, is its amplitude: the stem plot, mirrored. Front
 * puts the sum exactly on the flat view's lower panel.
 *
 * The animation, "the sum accumulates": adding harmonic k, its curtain
 * grows at its slot in the highlight, slides forward to the sum's plane,
 * shrinking to the sum's scale, the sum morphs from S(k-1) to S(k) as it
 * lands, and it settles back to its slot. A step to every harmonic adds
 * them one after another (the first few through the sum, the rest in
 * place, about 4 s in all, one track that any input lands), with the chip
 * and the readout following; the slider jumping several grows them in
 * place at once. A phase change (zero, a re-roll, Random, alpha in Scaled)
 * slides every curtain along time, so the crests near t = 0 drift out of
 * line over 600 ms, and the zero-phase sum stays behind the sum, dashed.
 * The first view turns from Front, where the flat view is, to the corner
 * at once while every harmonic is added in turn, so the pulse forms as
 * the crests line up; it holds the pulse, then the harmonics above the
 * step's count leave the sum together, and it ends by pulsing Next. Near Front the curtains fade, the highlight drops
 * its glow and the sum draws over it.
 *
 * No cutaway: the newest harmonic is always the deepest curtain drawn, so
 * every other curtain is in front of it, and its line is never covered
 * (lib/highlight.js draws it without the depth test). Curtains are ramp
 * marks, not context, so they are not faded by distance.
 *
 * Generic display DSP on one frame's values (anim-core.js header). Nothing
 * here reads hex, makes sound, or walks frames.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { createLabels } from "./lib/labels.js";
import { FRONT, createOrbit, frontFrustum } from "./lib/orbit.js";
import { contactShadow, fatLines, floor, fog, frostedFill, mix, rampColor, setSegments, tokenHex } from "./lib/style.js";
import { PERIOD_SAMPLES, crestOffset, samplePeriod } from "./lib/harmonics.js";
import { SUM_RANGE, sumArea } from "./anim-harmonic-sum.js";

/** @typedef {import("./anim-harmonic-sum.js").HsumScene} Scene */
/** @typedef {import("./anim-harmonic-sum.js").HsumView} HsumView */
/** @typedef {import("./anim-three.js").ThreeContext} Ctx */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {"corner" | "front" | "side"} Preset */

/* World layout, in scene units. */
const X_HALF = 1.5; //    t in [-T0, T0] maps to x in [-X_HALF, X_HALF]
const RIBBON_Y = 0.55; // the tallest curtain's half-height
const SUM_Y = 0.9; //     the zero-phase pulse of every harmonic reaches this
const Z_SUM = 0.8; //    the sum, nearest the reader
const Z_FIRST = -0.1; //  harmonic 1
const DEPTH = 2.1; //     harmonic 1 to the last
const Z_BACK = Z_FIRST - DEPTH;
/** Under the sum's lowest point on any offered frame (-0.884 of SUM_Y, n = 1). */
const FLOOR_Y = -0.84;
const CENTRE = /** @type {[number, number, number]} */ ([0, 0, (Z_SUM + Z_BACK) / 2]);
const DIST = 6;
/** Points of the sum over two periods (the old view drew one a sample, faceted). */
const SUM_POINTS = 400;
const SAMPLES_PER_CYCLE = 16;
/** The crest line's dashes and gaps, in scene units. */
const DASH = 0.05;
const GAP = 0.04;

/** @type {Readonly<Record<Preset, Pose>>} */
export const PRESETS = Object.freeze({
  corner: { yaw: -20, pitch: 30 },
  front: FRONT,
  side: { yaw: 90, pitch: 0 },
});

/** Weight 0 within 2 degrees of Front, 1 past 14. @param {Pose} p */
const awayFromFront = (p) => {
  const d = Math.hypot(((((p.yaw % 360) + 540) % 360) - 180), p.pitch);
  return Math.min(1, Math.max(0, (d - 2) / 12));
};
/** @param {number} t */
const smooth = (t) => t * t * (3 - 2 * t);
/** t rescaled to [a, b], clamped and smoothed. @param {number} t @param {number} a @param {number} b */
const part = (t, a, b) => smooth(Math.min(1, Math.max(0, (t - a) / (b - a))));

/**
 * The u values (u = t / T0, -1 to 1) of curtain k: an even grid of
 * SAMPLES_PER_CYCLE per cycle, plus every crest and trough, so the
 * curtain's extremes are exactly ±a and the side view is exact.
 * @param {number} k
 * @param {number} phi
 * @param {number} perCycle
 * @returns {Float64Array} sorted
 */
function curtainTimes(k, phi, perCycle) {
  const steps = 2 * k * perCycle;
  /** @type {number[]} */
  const us = [];
  for (let j = 0; j <= steps; j += 1) us.push(-1 + (2 * j) / steps);
  const c = phi / (2 * Math.PI);
  for (let m = Math.floor(-k + c) - 1; m <= Math.ceil(k + c) + 1; m += 1) {
    for (const half of [0, 0.5]) {
      const u = (m + half - c) / k;
      if (u > -1 && u < 1) us.push(u);
    }
  }
  return Float64Array.from(us).sort();
}

/**
 * three keeps a fat line's first segment count and never grows it, so a
 * line given more segments must forget it.
 * @param {import("three").Object3D} obj
 */
const regrow = (obj) => obj.traverse((/** @type {any} */ n) => {
  if (n.geometry) delete n.geometry._maxInstanceCount;
});

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let s = /** @type {Scene} */ (opts.state);
  const hook = {
    builds: 0,
    /** @type {Pose} */
    pose: { ...PRESETS.corner },
    zoom: 1,
    /** [u, value, x px, y px] of sum points, from the camera now */
    frontPoints: /** @type {number[][]} */ ([]),
    played: opts.intro,
    newest: { k: 0, z: 0 },
    /** the newest harmonic's furthest z forward since the last one was added */
    trip: 0,
    chip: "",
    /** @type {() => number[]} max |y| of each drawn curtain, index k */
    ribbonMaxAbs: () => [],
    /** @type {(at: [number, number, number]) => {x: number, y: number} | null} */
    screenOf: () => null,
    /** @type {{zoom: number, left: number, right: number, top: number, bottom: number} | null} */
    camera: null,
    objects: 0,
    /** the zero-phase sum is drawn behind the sum */
    ghost: false,
    /** the crest line's end on the sum, at t = 0, or null */
    /** @type {number[] | null} */
    crestOnSum: null,
    /** @type {string[]} */
    labels: [],
  };
  if (TEST_HOOK) TEST_HOOK.figures["harmonic-sum-3d"] = hook;

  /* ---- what is drawn now ------------------------------------------------ */

  /** The model the buffers are laid out for. */
  let model = s.model;
  /** Phases as drawn; they slide toward s.phi. */
  let phi = Float64Array.from(s.phi);
  /** Each curtain's height as a share of its amplitude (0 to 1), by k. */
  let rib = new Float64Array(model.L + 1);
  /** Each harmonic's share in the sum (0 to 1), by k. */
  let inSum = new Float64Array(model.L + 1);
  /** The newest curtain's trip to the sum plane: 0 at its slot, 1 there. */
  let slide = 0;
  /** Curtains drawn: 1 to shown. */
  let shown = 0;
  /** The harmonic in the highlight: the step's count, or the one a build is adding. */
  let newest = Math.max(1, s.n);
  /** How near Front the camera is: 1 at Front, 0 from about 14 degrees away. */
  let atFront = 0;
  const all = (/** @type {number} */ n) => {
    rib = new Float64Array(model.L + 1);
    inSum = new Float64Array(model.L + 1);
    for (let k = 1; k <= n; k += 1) rib[k] = inSum[k] = 1;
    shown = n;
    slide = 0;
    newest = Math.max(1, n);
  };
  // The first view starts empty and accumulates to the step's count.
  all(opts.intro ? 0 : s.n);

  /** @param {number} k */
  const zOf = (k) => Z_FIRST - (DEPTH * (k - 1)) / Math.max(model.L - 1, 1);
  const ribScale = () => RIBBON_Y / model.maxA;
  const sumScale = () => SUM_Y / model.sumA;
  /** Samples per cycle: fewer for a low voice, so the segment count stays near 14,000. */
  const perCycle = () => Math.max(6, Math.min(SAMPLES_PER_CYCLE, Math.floor(7000 / (model.L * (model.L + 1)))));
  /** @param {number} k */
  const rampOf = (k) => rampColor((k - 1) / Math.max(model.L - 1, 1));

  /**
   * Points of curtain k at height a and depth z, flat x, y, z.
   * @param {number} k
   * @param {number} a
   * @param {number} z
   * @returns {number[]}
   */
  const curtain = (k, a, z) => {
    const us = curtainTimes(k, phi[k], perCycle());
    /** @type {number[]} */
    const out = [];
    for (const u of us) out.push(u * X_HALF, a * Math.cos(2 * Math.PI * k * u + phi[k]), z);
    return out;
  };

  /** The newest curtain, where it is now (the highlight). */
  const newestPoints = () => {
    const k = newest;
    const a = model.A[k] * rib[k] * (ribScale() + (sumScale() - ribScale()) * slide);
    return curtain(k, a, zOf(k) + (Z_SUM - zOf(k)) * slide);
  };

  /**
   * The sum over two periods, with each harmonic weighted by inSum; with
   * `zero`, the same harmonics at phase zero (the ghost behind it).
   * @param {boolean} [zero]
   */
  const sumPoints = (zero = false) => {
    const A = model.A.map((v, k) => v * inSum[k]);
    const period = samplePeriod(A, zero ? new Float64Array(phi.length) : phi, Math.min(shown, model.L));
    /** @type {number[]} */
    const xs = [];
    /** @type {number[]} */
    const ys = [];
    for (let j = 0; j <= SUM_POINTS; j += 1) {
      const p = (2 * PERIOD_SAMPLES * j) / SUM_POINTS;
      const i = Math.floor(p);
      const f = p - i;
      const v = period[i % PERIOD_SAMPLES] * (1 - f) + period[(i + 1) % PERIOD_SAMPLES] * f;
      xs.push((-1 + (2 * j) / SUM_POINTS) * X_HALF);
      ys.push(sumScale() * v);
    }
    return { xs, ys };
  };

  /* ---- the scene --------------------------------------------------------- */

  /**
   * @typedef {Object} Parts
   * @property {Ctx} ctx
   * @property {import("three").Mesh} curtains
   * @property {any} edges
   * @property {any} sum
   * @property {import("three").Mesh} sumFill
   * @property {any} ghost  the zero-phase sum, dashed
   * @property {any} crestHalo
   * @property {any} crestLine
   * @property {import("three").Points} crests
   * @property {import("three").LineSegments} slots
   * @property {any} kit
   * @property {ReturnType<typeof createLabels>} labels
   * @property {string} edgeKey
   * @property {string} kitKey  the harmonic and phase the highlight was drawn for
   * @property {number[]} kitPeak  its highest point, flat and full height
   * @property {number} kitFront  atFront the kit was last shown for (glow or not)
   */
  /** @type {Parts | null} */
  let o = null;
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** @type {Preset} */
  let mode = /** @type {Preset} */ (s.preset in PRESETS ? s.preset : "corner");
  atFront = 1 - smooth(awayFromFront(opts.intro ? FRONT : PRESETS[mode]));

  /** @param {Ctx} ctx */
  const build = (ctx) => {
    const T = ctx.three;
    hook.builds += 1;
    const box = { min: /** @type {[number, number, number]} */ ([-X_HALF - 0.1, FLOOR_Y, Z_BACK - 0.15]),
      max: /** @type {[number, number, number]} */ ([X_HALF + 0.1, SUM_Y, Z_SUM + 0.2]) };
    const ground = floor(ctx, { extent: box, step: [X_HALF / 2, box.max[2] - box.min[2]] });
    const shadow = contactShadow(ctx, { x: [-X_HALF, X_HALF], z: [Z_BACK, Z_SUM], y: FLOOR_Y });
    fog(ctx, DIST, Z_SUM - Z_BACK + 1);

    // The curtains, one mesh: two vertices per point, at the curve and at
    // zero, frosted from a tint of the curtain's ramp colour to the ground.
    // Its buffers are written in place (refresh), grown only when a frame
    // with more harmonics needs it.
    const curtains = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    curtains.userData.recolour = () => {
      if (o) o.edgeKey = "";
      refresh();
    };
    // Per-vertex ramp colours, written in place by refresh().
    const edges = fatLines(ctx, [0, 0, 0, 0, 0, 0], () => [0, 0], 1.75, { fog: true });
    edges.userData.recolour = () => {
      if (o) o.edgeKey = "";
      refresh();
    };
    const sum = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 3);
    // Drawn after the highlight kit (renderOrder 10 to 12, transparent), so
    // the newest harmonic never runs over the sum, the step's subject.
    // A token's paint resets `transparent` on every theme change; this runs after it.
    sum.userData.recolour = () => { sum.material.transparent = true; };
    sum.userData.recolour();
    sum.renderOrder = 14;
    // The sum with every phase zero, dashed, behind the sum while the phases are not zero.
    // Over the curtains and the sum's fill, under the sum, as in the flat view.
    const ghost = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 2, { depthTest: false });
    // Ink part way to the ground: clear over the curtains, quieter than the sum.
    ghost.userData.recolour = () => {
      ghost.material.color.setHex(mix(tokenHex("--ambe-plot-ink"), tokenHex("--ambe-plot-bg"), 0.45));
      ghost.material.transparent = true;
    };
    ghost.userData.recolour();
    ghost.renderOrder = 13;
    const { xs, ys } = sumPoints();
    const sumFill = frostedFill(ctx, xs, ys, Z_SUM, 0, "--ambe-plot-ink", "--ambe-plot-bg", { fog: false });
    const colour = new T.Color();
    // A light ink tint at the curve, the ground at zero.
    sumFill.userData.recolour = () => {
      const attribute = sumFill.geometry.getAttribute("color");
      const bg = tokenHex("--ambe-plot-bg");
      const ends = [mix(tokenHex("--ambe-plot-ink"), bg, 0.8), bg].map((hex) => colour.setHex(hex).toArray());
      for (let i = 0; i < attribute.count; i += 1) {
        const [r, g, b] = ends[i % 2];
        attribute.setXYZ(i, r, g, b);
      }
      attribute.needsUpdate = true;
    };
    sumFill.userData.recolour();
    // Dashed by its own segments, so its buffer is written in place too,
    // over a halo of the plot background, so it reads across the curtains.
    // Never covered: the low curtains in front would hide it where it runs
    // down to the sum. The sum still draws over it (renderOrder 14).
    const crestHalo = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-bg", 6, { depthTest: false });
    crestHalo.renderOrder = 6;
    const crestLine = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 2.25, { depthTest: false });
    crestLine.renderOrder = 7;
    const crests = new T.Points(new T.BufferGeometry(),
      ctx.paint(new T.PointsMaterial({ size: 6, sizeAttenuation: false, depthTest: false }), "--ambe-plot-ink"));
    crests.renderOrder = 7;
    const slots = new T.LineSegments(new T.BufferGeometry(), ctx.paint(new T.LineBasicMaterial(), "--ambe-plot-axis"));
    // The highlight is drawn once per harmonic and phase, flat at z = 0 and
    // full height; its trip to the sum moves and scales the group.
    const kit = addHighlight(ctx, curtain(newest, model.A[newest] * ribScale(), 0), { chip: chipText() });
    // Near Front the kit is its line alone, no glow or fill, so the sum
    // reads through it; its own recolour shows the glow again, so this runs after it.
    const kitRecolour = kit.userData.recolour;
    kit.userData.recolour = () => {
      kitRecolour();
      for (const child of kit.children) {
        if (child.renderOrder === 10 || child.type === "Mesh") child.visible = child.visible && atFront < 0.5;
      }
    };
    const labels = createLabels(frame, ctx);
    ctx.track({ dispose: labels.dispose });
    for (const obj of [ground, shadow, curtains, edges, sumFill, ghost, sum, crestHalo, crestLine, crests, slots, kit]) {
      obj.frustumCulled = false;
      ctx.scene.add(obj);
    }
    o = { ctx, curtains, edges, sum, sumFill, ghost, crestHalo, crestLine, crests, slots, kit, labels, edgeKey: "", kitKey: "", kitPeak: [0, 0, 0], kitFront: -1 };
    hook.objects = ctx.scene.children.length;
    refresh();
    setLabels();
  };

  const chipText = () => `newest: harmonic ${newest}`;

  /**
   * Write `count` segments into a fat line's own buffer. A new buffer is
   * made (and the old one freed) only when it is too small: three keeps an
   * attribute's GPU buffer until its geometry is disposed, so a new buffer
   * on every frame of an animation would pile up.
   * @param {any} line
   * @param {Float32Array} seg
   * @param {number} count
   * @param {Float32Array} [rgb] per vertex, written in place the same way
   */
  const writeLine = (line, seg, count, rgb) => {
    const g = line.geometry;
    const start = g.attributes.instanceStart;
    if (!start || start.data.array.length < count * 6) {
      const cap = new Float32Array(Math.max(6, count * 6 * 2));
      cap.set(seg.subarray(0, count * 6));
      g.dispose();
      setSegments(line, cap);
      if (rgb) {
        const colours = new Float32Array(cap.length);
        colours.set(rgb.subarray(0, count * 6));
        g.setColors(colours);
      }
      regrow(line);
    } else {
      start.data.array.set(seg.subarray(0, count * 6));
      start.data.needsUpdate = true;
      const colours = g.attributes.instanceColorStart;
      if (rgb && colours) {
        colours.data.array.set(rgb.subarray(0, count * 6));
        colours.data.needsUpdate = true;
      }
    }
    g.instanceCount = count;
    line.visible = count > 0;
  };

  /**
   * A buffer attribute of at least `size` floats on a plain geometry,
   * reused while it is big enough.
   * @param {import("three").BufferGeometry} g
   * @param {string} name
   * @param {number} size
   * @param {number} [item=3]
   * @returns {Float32Array}
   */
  const room = (g, name, size, item = 3) => {
    const T = /** @type {Parts} */ (o).ctx.three;
    const have = /** @type {import("three").BufferAttribute | undefined} */ (g.getAttribute(name));
    if (have && have.array.length >= size) {
      have.needsUpdate = true;
      return /** @type {Float32Array} */ (have.array);
    }
    const attribute = new T.BufferAttribute(new Float32Array(Math.max(item, size * 2)), item);
    attribute.setUsage(T.DynamicDrawUsage);
    g.setAttribute(name, attribute);
    return /** @type {Float32Array} */ (attribute.array);
  };

  /** Rewrite every buffer from what is drawn now. */
  function refresh() {
    if (!o) return;
    const { ctx } = o;
    const T = ctx.three;
    const n = newest;
    const side = mode === "side";
    const top = Math.min(shown, model.L);
    // Near Front the curtains fade toward the ground, so the sum stands out.
    const away = 0.75 * atFront;
    /** @type {number[]} */
    const ramp = [0];
    for (let k = 1; k <= model.L; k += 1) ramp.push(rampOf(k));

    // Curtains below the newest: edges as segments, fills as strips.
    /** @type {number[][]} */
    const curves = [];
    let points = 0;
    for (let k = 1; k <= top; k += 1) {
      if (k === n || !(rib[k] > 0)) continue;
      const p = curtain(k, model.A[k] * rib[k] * ribScale(), zOf(k));
      curves.push([k, ...p]);
      points += p.length / 3;
    }
    const segCount = points - curves.length;
    const seg = new Float32Array(segCount * 6);
    const rgb = new Float32Array(segCount * 6);
    const cg = o.curtains.geometry;
    const pos = room(cg, "position", points * 6);
    const col = room(cg, "color", points * 6);
    const have = cg.getIndex();
    /** @type {Uint32Array} */
    let index;
    if (have && have.array.length >= segCount * 6) {
      index = /** @type {Uint32Array} */ (have.array);
      have.needsUpdate = true;
    } else {
      const attribute = new T.BufferAttribute(new Uint32Array(Math.max(6, segCount * 12)), 1);
      attribute.setUsage(T.DynamicDrawUsage);
      cg.setIndex(attribute);
      index = /** @type {Uint32Array} */ (attribute.array);
    }
    const bg = tokenHex("--ambe-plot-bg");
    const c = new T.Color();
    let v = 0;
    let e = 0;
    let t = 0;
    for (const [k, ...p] of curves) {
      const edge = c.setHex(mix(ramp[k], bg, away)).toArray();
      const tint = [mix(ramp[k], bg, 0.76 + 0.24 * away), mix(ramp[k], bg, 0.94 + 0.06 * away)].map((hex) => c.setHex(hex).toArray());
      for (let i = 0; i < p.length; i += 3) {
        pos.set([p[i], p[i + 1], p[i + 2], p[i], 0, p[i + 2]], v * 3);
        col.set([...tint[0], ...tint[1]], v * 3);
        if (i + 3 < p.length) {
          seg.set([p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]], e * 6);
          rgb.set([...edge, ...edge], e * 6);
          index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], t);
          e += 1;
          t += 6;
        }
        v += 2;
      }
    }
    cg.setDrawRange(0, t);
    o.curtains.visible = t > 0;
    writeLine(o.edges, seg, segCount, rgb);

    // The newest, in the highlight: drawn again only for another harmonic
    // or other phases; its trip to the sum moves and scales the group.
    const full = model.A[n] * ribScale() || 1e-6;
    const kitKey = `${n} ${phi[n]} ${full}`;
    if (kitKey !== o.kitKey) {
      o.kitKey = kitKey;
      const p = curtain(n, full, 0);
      o.kit.set(p);
      regrow(o.kit);
      let high = 1;
      for (let i = 4; i < p.length; i += 3) if (p[i] > p[high]) high = i;
      o.kitPeak = [p[high - 1], p[high], 0];
    }
    const zNow = zOf(n) + (Z_SUM - zOf(n)) * slide;
    const scale = Math.max(1e-4, (rib[n] * (ribScale() + (sumScale() - ribScale()) * slide)) / ribScale());
    o.kit.position.z = zNow;
    o.kit.scale.y = scale;
    o.kit.chip?.set({ text: chipText(), at: [o.kitPeak[0], o.kitPeak[1] * scale, zNow] });
    const kitFront = atFront < 0.5 ? 0 : 1;
    if (kitFront !== o.kitFront) {
      o.kitFront = kitFront;
      o.kit.userData.recolour();
    }
    if (hook.newest.k !== n) hook.trip = zNow;
    hook.trip = Math.max(hook.trip, zNow);
    hook.newest = { k: n, z: zNow };
    hook.chip = chipText();

    // The sum. From the side it would be a bar that changes with the
    // phases: there only the curtains show.
    const { xs, ys } = sumPoints();
    const sumSeg = new Float32Array(SUM_POINTS * 6);
    for (let j = 0; j < SUM_POINTS; j += 1) sumSeg.set([xs[j], ys[j], Z_SUM, xs[j + 1], ys[j + 1], Z_SUM], j * 6);
    writeLine(o.sum, sumSeg, SUM_POINTS);
    const fill = /** @type {import("three").BufferAttribute} */ (o.sumFill.geometry.getAttribute("position"));
    for (let j = 0; j <= SUM_POINTS; j += 1) {
      fill.setXYZ(2 * j, xs[j], ys[j], Z_SUM);
      fill.setXYZ(2 * j + 1, xs[j], 0, Z_SUM);
    }
    fill.needsUpdate = true;
    o.sum.visible = o.sumFill.visible = !side;

    // The zero-phase sum, dashed, while any drawn phase is not zero: the
    // solid sum peels away from it as the phases drift.
    let turned = false;
    for (let k = 1; k <= top; k += 1) if (Math.abs(phi[k]) > 1e-9) turned = true;
    if (turned && !side) {
      const zero = sumPoints(true);
      /** @type {number[]} */
      const ghost = [];
      for (let j = 0; j < SUM_POINTS; j += 1) {
        if (j % 6 < 4) ghost.push(zero.xs[j], zero.ys[j], Z_SUM, zero.xs[j + 1], zero.ys[j + 1], Z_SUM);
      }
      writeLine(o.ghost, Float32Array.from(ghost), ghost.length / 6);
    } else {
      o.ghost.visible = false;
    }

    // Each drawn curtain's crest nearest t = 0, and the dashed line through
    // them, down to the sum at t = 0, where the crests land. The newest
    // has none while it travels: its crest is left out until it is back.
    /** @type {number[]} */
    const crest = side ? [] : [0, ys[SUM_POINTS / 2], Z_SUM];
    for (let k = 1; k <= top; k += 1) {
      if (!(rib[k] > 0) || (k === n && slide > 0)) continue;
      const a = model.A[k] * rib[k] * ribScale();
      crest.push((crestOffset(phi[k]) / k) * X_HALF, a, zOf(k));
    }
    if (crest.length === 3) crest.length = 0;
    const cp = room(o.crests.geometry, "position", crest.length);
    cp.set(crest);
    o.crests.geometry.setDrawRange(0, crest.length / 3);
    /** @type {number[]} */
    const dashes = [];
    for (let i = 3; i < crest.length; i += 3) {
      const [x0, y0, z0, x1, y1, z1] = crest.slice(i - 3, i + 3);
      const length = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      for (let d = 0; d < length; d += DASH + GAP) {
        const a = d / length;
        const b = Math.min(1, (d + DASH) / length);
        dashes.push(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, z0 + (z1 - z0) * a,
          x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, z0 + (z1 - z0) * b);
      }
    }
    writeLine(o.crestHalo, Float32Array.from(dashes), dashes.length / 6);
    writeLine(o.crestLine, Float32Array.from(dashes), dashes.length / 6);
    // Head on, the crest line runs along the line of sight: only clutter.
    if (atFront > 0.5) o.crestHalo.visible = o.crestLine.visible = o.crests.visible = false;
    else o.crests.visible = true;
    hook.ghost = o.ghost.visible;
    hook.crestOnSum = !side && crest.length ? crest.slice(0, 3) : null;

    // On the floor: a slot line under every harmonic, the t = 0 line, the
    // time axis under the sum, and the depth axis along the left edge.
    /** @type {number[]} */
    const floorLines = [];
    for (let k = 1; k <= model.L; k += 1) floorLines.push(-X_HALF, FLOOR_Y, zOf(k), X_HALF, FLOOR_Y, zOf(k));
    floorLines.push(0, FLOOR_Y, Z_SUM, 0, FLOOR_Y, zOf(model.L));
    floorLines.push(-X_HALF, FLOOR_Y, Z_SUM, X_HALF, FLOOR_Y, Z_SUM);
    for (const x of [-X_HALF, 0, X_HALF]) floorLines.push(x, FLOOR_Y, Z_SUM, x, FLOOR_Y, Z_SUM + 0.06);
    floorLines.push(-X_HALF, FLOOR_Y, zOf(1), -X_HALF, FLOOR_Y, zOf(model.L));
    // From the side, where the bars are mirrored about it: amplitude zero.
    if (side) floorLines.push(0, 0, zOf(1) + 0.12, 0, 0, zOf(model.L) - 0.12);
    room(o.slots.geometry, "position", floorLines.length).set(floorLines);
    o.slots.geometry.setDrawRange(0, floorLines.length / 3);

    publish();
    ctx.requestRender();
  }

  /* ---- labels and the fit ------------------------------------------------ */

  /** A frame too narrow for word labels beside the curtains. */
  const narrow = () => frame.clientWidth < 480;
  let labelKey = "";
  /** @type {import("./lib/labels.js").Label[]} */
  let labelList = [];
  function setLabels() {
    if (!o) return;
    const L = model.L;
    const T0 = (1000 / model.f0).toFixed(1);
    // Turned to Front (the first view starts there), the corner's labels
    // would stack at the left edge: Front's time labels stand in.
    const front = mode === "front" || (mode === "corner" && atFront > 0.5);
    const key = `${mode}${L}${T0}${narrow()}${front}`;
    if (key === labelKey) return;
    labelKey = key;
    const left = -X_HALF - 0.1;
    if (mode === "side") {
      // Just under the bars, which are mirrored about the zero line.
      const under = -RIBBON_Y - 0.04;
      labelList = [
        { text: "1", at: [0, under, zOf(1)], align: "middle", dy: 12 },
        { text: String(L), at: [0, under, zOf(L)], align: "middle", dy: 12 },
        { text: "harmonic number", at: [0, under, (zOf(1) + zOf(L)) / 2], align: "middle", dy: 12 },
        { text: "amplitude 0", at: [0, 0, zOf(1) + 0.16], align: "end" },
      ];
    } else if (front) {
      labelList = [
        { text: `−${T0} ms`, at: [-X_HALF, SUM_Y * SUM_RANGE, Z_SUM], align: "middle", dy: -12 },
        { text: "0", at: [0, SUM_Y * SUM_RANGE, Z_SUM], align: "middle", dy: -12 },
        { text: `${T0} ms`, at: [X_HALF, SUM_Y * SUM_RANGE, Z_SUM], align: "middle", dy: -12 },
      ];
    } else {
      labelList = [
        { text: "time", at: [X_HALF + 0.1, 0, Z_SUM], align: "start" },
        { text: "sum", at: [left, 0, Z_SUM], align: "end" },
        { text: narrow() ? "h1" : "harmonic 1", at: [left, 0, zOf(1)], align: "end" },
        { text: narrow() ? `h${L}` : `harmonic ${L}`, at: [left, 0, zOf(L)], align: "end" },
      ];
      // A phone has no room for the axis name beside the curtains: "h" and
      // the chip ("newest: harmonic k") name it, and Side spells it out.
      if (!narrow()) labelList.push({ text: "harmonic number", at: [left, 0, (zOf(1) + zOf(L)) / 2], align: "end" });
    }
    o.labels.set(labelList);
    hook.labels = labelList.map((l) => l.text);
    fit();
  }

  /** Width in CSS px of each label, in labelList's order, hidden or not. */
  const labelWidths = () => [...frame.querySelectorAll(".anim-figure__overlay:not(.anim-chip-layer) .anim-figure__label")]
    .map((node) => {
      if (!(node instanceof HTMLElement)) return 0;
      const hidden = node.hidden;
      node.hidden = false;
      const width = node.offsetWidth;
      node.hidden = hidden;
      return width;
    });

  /**
   * The frustum for the pose now. At Front the sum lies exactly on the flat
   * view's lower panel (frontFrustum, the figure contract's "front equals
   * 2D"); turned away, the scene and its labels fill the frame with a
   * margin. Between, the two blend by the angle from Front, so a turn never
   * jumps. The reader's zoom and pan multiply this (lib/orbit.js).
   */
  function fit() {
    if (!o) return;
    const ctx = o.ctx;
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    camera.updateMatrixWorld();
    const front = frontFrustum({ width: W, height: H }, sumArea(W, H), {
      min: [-X_HALF, -SUM_Y * SUM_RANGE, CENTRE[2] - 1], max: [X_HALF, SUM_Y * SUM_RANGE, CENTRE[2] + 1],
    });
    const v = new ctx.three.Vector3();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const target = new ctx.three.Vector3(...CENTRE).applyMatrix4(camera.matrixWorldInverse);
    /** @param {number} x @param {number} y @param {number} z */
    const add = (x, y, z) => {
      v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse).sub(target);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    };
    const side = mode === "side";
    for (const x of [-X_HALF, X_HALF]) {
      for (const z of [Z_FIRST, Z_BACK]) {
        // From the side, framed on the bars, not the floor below them.
        add(x, side ? -RIBBON_Y : FLOOR_Y, z);
        add(x, RIBBON_Y, z);
      }
      if (!side) {
        add(x, SUM_Y, Z_SUM);
        add(x, FLOOR_Y, Z_SUM);
      }
    }
    const widths = labelWidths();
    const margin = Math.max(10, W * 0.04);
    let padL = margin;
    let padR = margin;
    let padT = Math.max(10, H * 0.06);
    let padB = Math.max(12, H * 0.08);
    if (mode === "corner") {
      padL += Math.max(0, ...widths.slice(1)) + 8;
      padR += (widths[0] ?? 0) + 8;
      // Every label sits at the curtains' zero line, well above the
      // frame's bottom 56 px, where lib/labels.js hides labels.
      padB = Math.max(padB, 20);
    } else if (side) {
      padL += Math.max((widths[0] ?? 0) / 2, (widths[3] ?? 0) + 8);
      padR += (widths[1] ?? 0) / 2;
      // The labels under the bars clear the frame's bottom 56 px, where
      // lib/labels.js hides labels.
      padB = Math.max(padB, 56 + 30);
    }
    const scale = Math.max(1e-3, Math.min((W - padL - padR) / (x1 - x0), (H - padT - padB) / (y1 - y0)));
    const cx = (x0 + x1) / 2 - ((padL - padR) / 2) / scale;
    const cy = (y0 + y1) / 2 + ((padT - padB) / 2) / scale;
    const turned = { left: cx - W / 2 / scale, right: cx + W / 2 / scale, top: cy + H / 2 / scale, bottom: cy - H / 2 / scale };
    const w = smooth(awayFromFront(orbit?.pose() ?? PRESETS[mode]));
    camera.left = front.left + (turned.left - front.left) * w;
    camera.right = front.right + (turned.right - front.right) * w;
    camera.top = front.top + (turned.top - front.top) * w;
    camera.bottom = front.bottom + (turned.bottom - front.bottom) * w;
    // setLabels() fits again outside orbit's place(), which would otherwise
    // be the only one to apply the frustum: a finish that lands a turn from
    // Front swaps the labels after place() has fitted to Front's, and the
    // corner kept that fit, 41 px off, until the next camera move.
    camera.updateProjectionMatrix();
  }

  /* ---- the test hook ----------------------------------------------------- */

  function publish() {
    if (!TEST_HOOK || !o || !orbit) return;
    const ctx = o.ctx;
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    hook.pose = orbit.pose();
    hook.zoom = orbit.zoom();
    hook.camera = { zoom: camera.zoom, left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom };
    const { xs, ys } = sumPoints();
    const v = new ctx.three.Vector3();
    hook.frontPoints = [];
    for (let j = 0; j <= SUM_POINTS; j += 50) {
      v.set(xs[j], ys[j], Z_SUM).project(camera);
      hook.frontPoints.push([xs[j] / X_HALF, ys[j] / SUM_Y, ((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]);
    }
  }
  hook.screenOf = (at) => {
    if (!o) return null;
    const v = new o.ctx.three.Vector3(...at).project(o.ctx.camera);
    return { x: ((v.x + 1) / 2) * frame.clientWidth, y: ((1 - v.y) / 2) * frame.clientHeight };
  };
  hook.ribbonMaxAbs = () => {
    /** @type {number[]} */
    const out = [0];
    for (let k = 1; k <= Math.min(shown, model.L); k += 1) {
      const a = model.A[k] * rib[k] * ribScale();
      const ys = k === newest ? newestPoints() : curtain(k, a, zOf(k));
      let m = 0;
      for (let i = 1; i < ys.length; i += 3) m = Math.max(m, Math.abs(ys[i]));
      out.push(m);
    }
    return out;
  };

  /* ---- open --------------------------------------------------------------- */

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) return null;

  orbit = createOrbit(ctx, {
    target: CENTRE, distance: DIST, zoom: opts.look.zoom, presets: PRESETS, start: mode,
    fit,
    onDrag: () => {
      if (mode !== "corner") {
        mode = "corner";
        setLabels();
        refresh();
      }
      opts.onDrag?.();
    },
    onChange: () => {
      const near = 1 - smooth(awayFromFront(orbit?.pose() ?? PRESETS[mode]));
      if (Math.abs(near - atFront) > 0.02 || (near !== atFront && (near === 0 || near === 1))) {
        atFront = near;
        setLabels();
        refresh();
      }
      o?.labels.update();
      publish();
    },
  });
  // The fit leaves room for the labels by their measured widths: once the
  // page's fonts have loaded, measure and fit again, or a view built before
  // them keeps the fallback font's margins (the scene sat 41 px off).
  void document.fonts?.ready.then(() => {
    if (!ctx.viewSignal?.aborted) orbit?.set(orbit.pose());
  });
  const tl = ctx.timeline();
  let wasNarrow = narrow();
  const resized = new ResizeObserver(() => {
    if (narrow() !== wasNarrow) {
      wasNarrow = narrow();
      setLabels();
    }
  });
  resized.observe(frame);
  ctx.track({ dispose: () => resized.disconnect() });
  refresh();

  /* ---- animation ----------------------------------------------------------- */

  /**
   * The parts of one harmonic's trip, as shares of its time: it grows at
   * its slot, slides out to the sum's plane, the sum takes it in, and it
   * slides back.
   * @typedef {{grow: number, out: [number, number], merge: [number, number], back: [number, number]}} Trip
   */
  /** @type {Trip} */
  const TRIP = { grow: 0.22, out: [0.18, 0.5], merge: [0.45, 0.72], back: [0.72, 1] };
  /** The first view holds the whole pulse this long before it returns to the step's count, ms. */
  const HOLD_ALL_MS = 1500;
  /** The walk-through's first beat: a slower grow, so harmonic 1 is seen at its slot as the camera turns. */
  /** @type {Trip} */
  const FIRST_TRIP = { grow: 0.36, out: [0.36, 0.58], merge: [0.52, 0.76], back: [0.8, 1] };

  /**
   * Harmonic k, the newest, at t (0 to 1) of its trip.
   * @param {number} k
   * @param {number} t
   * @param {number} fromSum its share in the sum when the trip began
   * @param {Trip} trip
   */
  const tripAt = (k, t, fromSum, trip) => {
    rib[k] = Math.max(rib[k], part(t, 0, trip.grow));
    slide = part(t, ...trip.out) * (1 - part(t, ...trip.back));
    inSum[k] = fromSum + (1 - fromSum) * part(t, ...trip.merge);
    if (t === 1) {
      rib[k] = inSum[k] = 1;
      slide = 0;
    }
  };

  /**
   * Add harmonic k, the newest: it grows at its slot, slides forward to the
   * sum plane at the sum's scale, the sum takes it in, and it slides back.
   * @param {number} k
   * @param {number} ms
   * @param {{wait?: boolean, delay?: number, trip?: Trip}} [how] wait: until
   *        the frame is half visible (first view)
   */
  const accumulate = (k, ms, how = {}) => {
    shown = Math.max(shown, k);
    newest = k;
    const fromSum = inSum[k];
    const m = model;
    return tl.play("build", {
      ms, ease: "linear", build: how.wait ?? false, delay: how.delay ?? 0,
      step: (t) => {
        if (model !== m) return;
        tripAt(k, t, fromSum, how.trip ?? TRIP);
        refresh();
      },
    });
  };

  /**
   * Add harmonics from + 1 to `to` one after another, as one track, so a
   * finish lands it whole: the first few each make the whole trip to the
   * sum, the rest grow in place while the sum takes them in. The chip, and
   * the readout through link.onCount, follow the one being added.
   * @param {number} from
   * @param {number} to
   * @param {{slow?: boolean, wait?: boolean, delay?: number}} [how]
   */
  const sequence = (from, to, how = {}) => {
    shown = Math.max(shown, to);
    slide = 0;
    /** @type {{k: number, at: number, ms: number}[]} */
    const plan = [];
    let total = 0;
    for (let k = from + 1; k <= to; k += 1) {
      const ms = k <= 5 ? (how.slow ? 1100 : 620) : how.slow ? 260 : 180;
      plan.push({ k, at: total, ms });
      total += ms;
    }
    const m = model;
    let told = -1;
    return tl.play("build", {
      ms: Math.max(1, total), ease: "linear", build: how.wait ?? false, delay: how.delay ?? 0,
      step: (t) => {
        if (model !== m) return;
        const now = t * total;
        let current = Math.max(1, from);
        for (const { k, at, ms } of plan) {
          const local = t === 1 ? 1 : Math.min(1, Math.max(0, (now - at) / ms));
          if (local <= 0) break;
          current = k;
          if (ms >= 500) tripAt(k, local, 0, TRIP);
          else {
            slide = 0;
            rib[k] = part(local, 0, 0.6);
            inSum[k] = part(local, 0.25, 1);
          }
        }
        if (t === 1) slide = 0;
        newest = current;
        if (current !== told) {
          told = current;
          s.link.onCount?.(current);
        }
        refresh();
      },
    });
  };

  /**
   * The first view's build, on one track so any input or finish lands it
   * whole: every harmonic added in turn (the first three each make the
   * whole trip to the sum, the rest grow in place), a hold on the pulse,
   * then every harmonic above n leaves the sum together, back to the
   * step's count.
   * @param {number} n
   * @param {{wait?: boolean, delay?: number}} [how]
   */
  const opening = (n, how = {}) => {
    const L = model.L;
    shown = L;
    slide = 0;
    /** @type {{k: number, at: number, ms: number}[]} */
    const plan = [];
    let built = 0;
    for (let k = 1; k <= L; k += 1) {
      const ms = k <= 3 ? 560 : 110;
      plan.push({ k, at: built, ms });
      built += ms;
    }
    const back = n < L ? duration("3d-camera") || 700 : 0;
    const hold = back ? HOLD_ALL_MS : 0;
    const total = built + hold + back;
    const m = model;
    let told = -1;
    return tl.play("build", {
      ms: total, ease: "linear", build: how.wait ?? false, delay: how.delay ?? 0,
      step: (t) => {
        if (model !== m) return;
        if (t === 1) {
          all(n);
          s.link.onCount?.(n);
          refresh();
          return;
        }
        const now = t * total;
        let current = 1;
        for (const { k, at, ms } of plan) {
          const local = Math.min(1, Math.max(0, (now - at) / ms));
          if (local <= 0) break;
          current = k;
          if (ms >= 500) tripAt(k, local, 0, TRIP);
          else {
            slide = 0;
            rib[k] = part(local, 0, 0.6);
            inSum[k] = part(local, 0.25, 1);
          }
        }
        if (back && now > built + hold) {
          const u = smooth((now - built - hold) / back);
          for (let k = n + 1; k <= L; k += 1) rib[k] = inSum[k] = 1 - u;
          current = n;
        }
        newest = Math.max(1, current);
        if (current !== told) {
          told = current;
          s.link.onCount?.(current);
        }
        refresh();
      },
    });
  };

  /**
   * Add harmonics from + 1 to to at once: each grows in place, staggered,
   * while the sum takes it in (the slider jumping several at once).
   * @param {number} from
   * @param {number} to
   */
  const cascade = (from, to) => {
    shown = Math.max(shown, to);
    newest = Math.max(1, to);
    slide = 0;
    const m = model;
    return tl.play("build", {
      ms: Math.max(300, duration("3d-build") - 300), ease: "ease",
      count: to - from, stagger: duration("stagger"),
      step: (t, i) => {
        const k = from + 1 + i;
        if (model !== m || k > model.L) return;
        rib[k] = inSum[k] = t;
        refresh();
      },
    });
  };

  /**
   * Slide every curtain along time to the phases asked for, by the shorter
   * way round, so the crests near t = 0 drift.
   * @param {Float64Array} to
   * @param {number} ms
   */
  const drift = (to, ms) => {
    const from = Float64Array.from(phi);
    const delta = to.map((v, k) => {
      const d = (v - (from[k] ?? 0)) % (2 * Math.PI);
      return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
    });
    const m = model;
    return tl.play("phase", {
      ms, ease: "inout",
      step: (t) => {
        // A new frame has other phases (and another L): this drift is over.
        if (model !== m) return;
        phi = t === 1 ? Float64Array.from(to) : from.map((v, k) => v + delta[k] * t);
        refresh();
      },
    });
  };

  /**
   * Turn the camera from one pose to another on the view's own track (not a
   * preset flight, which lands every running track first).
   * @param {Pose} from
   * @param {Pose} to
   * @param {number} ms
   * @param {{wait?: boolean, delay?: number}} [how]
   */
  const turn = (from, to, ms, how = {}) => tl.play("camera", {
    ms, ease: "inout", build: how.wait ?? false, delay: how.delay ?? 0,
    step: (t) => orbit?.set({ yaw: from.yaw + (to.yaw - from.yaw) * t, pitch: from.pitch + (to.pitch - from.pitch) * t }),
  });

  /** @param {Preset} name */
  const toMode = (name) => {
    if (mode === name) return;
    mode = name;
    setLabels();
    refresh();
  };

  /** Same phases? @param {Float64Array} a @param {Float64Array} b */
  const samePhases = (a, b) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) < 1e-12);

  /** @type {HsumView} */
  const view = {
    finish: () => ctx.finish(),
    idle: () => tl.done(),
    pulse: () => o?.kit.pulse() ?? Promise.resolve(),
    go: async (name) => {
      toMode(/** @type {Preset} */ (name));
      await orbit?.go(name);
    },
    /**
     * The first view's animation: from Front, where the flat view is, the
     * camera turns to the corner at once while every harmonic is added in
     * turn, the first three each seen at its slot before it slides onto the
     * sum, so the pulse forms as the crests line up; a hold on it; then the
     * harmonics above the step's count leave together and the sum returns
     * to the step's. The walk-through's first beat (slow) adds only the
     * step's harmonics, after a moment at Front.
     */
    introduce: async (slow) => {
      const to = PRESETS[mode];
      orbit?.set(FRONT);
      const n = Math.max(1, s.n);
      all(0);
      newest = n;
      refresh();
      if (!slow) {
        const how = { wait: true, delay: 0 };
        await Promise.all([turn(FRONT, to, 2000, { ...how, delay: 400 }), opening(n, how)]);
        s.link.introduced?.();
        return;
      }
      const how = { wait: false, delay: 600 };
      const camera = turn(FRONT, to, 2800, how);
      const build = n === 1 ? accumulate(1, 3200, { ...how, trip: FIRST_TRIP }) : sequence(0, n, { ...how, slow });
      await Promise.all([camera, build]);
    },
    accumulate: (k, slow) => accumulate(k, slow ? 2200 : 700),
    drift: (to, ms) => drift(to, ms),
    turn: async (name, ms) => {
      const to = PRESETS[/** @type {Preset} */ (name)];
      await turn(orbit?.pose() ?? to, to, ms);
    },
  };
  s.link.view = view;

  // Not waiting for a first draw, as the other 3D parts: view-switch closes
  // this view at once if the reader has left 3D meanwhile, so two views of
  // the figure never hold a context together.
  if (opts.intro && opts.wanted()) void view.introduce(false);

  /** The canvas label, 250 ms after the last change. */
  let timer = 0;
  function describe() {
    const where = s.mode === "zero"
      ? "Phases all zero: the crests line up at t = 0."
      : s.mode === "random" ? "Phases random: the crests are scattered."
        : `Phases scaled by alpha ${s.alpha.toFixed(2)}: the crests spread from t = 0.`;
    return `Curtains for ${Math.max(1, s.n)} of ${s.model.L} harmonics of one frame at f0 ${s.model.f0.toFixed(1)} Hz, ` +
      `over two periods, the deepest the newest, harmonic ${Math.max(1, s.n)}, outlined; their sum is the thick line in front. ` +
      `${where} Peak-to-RMS ${s.peakToRms.toFixed(2)}.`;
  }

  return {
    update: (next) => {
      const was = s;
      // Another frame: land what runs while the old frame is still drawn,
      // then everything at once, no tween.
      const other = /** @type {Scene} */ (next).model !== model;
      if (other) tl.finish();
      s = /** @type {Scene} */ (next);
      s.link.view = view;
      const motion = s.motion;
      if (other) {
        model = s.model;
        phi = Float64Array.from(s.phi);
        all(s.n);
        labelKey = "";
        setLabels();
        refresh();
      } else {
        if (!samePhases(s.phi, phi)) {
          if (motion === "none") {
            tl.finish();
            phi = Float64Array.from(s.phi);
          } else {
            void drift(s.phi, motion === "slow" ? 1600 : 600);
          }
        }
        if (s.n !== was.n || s.n !== shown) {
          if (s.n > shown && motion !== "none") {
            if (s.n - shown === 1) void accumulate(s.n, motion === "slow" ? 2200 : 1100);
            // A step to every harmonic adds them one at a time, as Play does.
            else if (s.build) void sequence(shown, s.n, { slow: motion === "slow" });
            else void cascade(shown, s.n);
          } else {
            tl.finish();
            for (let k = 1; k <= model.L; k += 1) rib[k] = inSum[k] = k <= s.n ? 1 : 0;
            shown = s.n;
            slide = 0;
            newest = Math.max(1, s.n);
          }
        }
        refresh();
      }
      clearTimeout(timer);
      timer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
    },
    preset: (name) => { void view.go(name); },
    describe,
    close: () => {
      clearTimeout(timer);
      if (s.link.view === view) s.link.view = null;
      ctx.dispose();
    },
  };
}
