// @ts-check
/* ===========================================================================
 * anim-frame-path-3d.js: the 3D part of the frame-path figure (ch10).
 * ---------------------------------------------------------------------------
 * Time runs in depth: the selected frame is the slice at z = 0, drawn with
 * the highlight kit; its neighbours sit 20 ms apart, earlier in front, thin,
 * on the ramp and faded by distance (cut away below 60 degrees of pitch).
 * Stages 5 and 7 are rows of cells. The animation (visual language §6): the
 * slice draws alone, then the neighbours slide out of its plane and fade in
 * while the camera eases to Corner; 4 to 5 collapses the curve onto the
 * bits; at 7 the superframe stacks in behind the row. A frame change slides
 * and pulses. Reads nothing itself (tools/check-scope.py). MIT (LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK, prefersReducedMotion } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { createLabels } from "./lib/labels.js";
import { FRONT, TOP, createOrbit, frontFrustum } from "./lib/orbit.js";
import { contactShadow, darkGround, fadeAmount, fatLines, floor, fog, mix, printing, rampColor, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-frame-path.js").PathState} PathState */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {import("three/addons/lines/LineSegments2.js").LineSegments2} FatLine */

const SLUG = "frame-path-3d";
// Scene units: x spans one slice, y its value, z time.
const X0 = -1.6;
const X1 = 1.6;
const W = X1 - X0;
/** The value axis: tall enough that the slice reads at Corner. */
const YH = 1.45;
/** Slices 20 ms apart (stages 1 to 6). */
const DZ = 0.22;
/** Rows 20 ms apart at stage 7, 21 of them. */
const DZ7 = 0.16;
const NEIGHBOURS = 8;
const SAMPLES = 160;
const DB_FLOOR = -90;
const DB_TOP = -10;
const THRESHOLD = 0.55;
/** Cell heights: a 1, a 0, the selected row's 1 (1.4x), a data slot. */
const ONE = 0.3;
const ZERO = 0.035;
const DATA = 0.12;
/** The encoder's box: x0, x1, height, half depth. */
const ENCODER = /** @type {const} */ ([-1.05, 1.05, 0.86 * YH, 0.16]);
/** The orbit's target: the middle of the selected slice. */
const TARGET = /** @type {[number, number, number]} */ ([0, YH / 2, 0]);
/** @type {Record<string, Pose>} */
const PRESETS = { corner: { yaw: -32, pitch: 24 }, front: FRONT, top: TOP };
/** Corner for the rows of cells (stages 5 and 7): higher, so the rows stand apart. */
const CORNER_CELLS = Object.freeze({ yaw: -28, pitch: 42 });
/** Labels stay this far above the frame's bottom edge (lib/labels.js hides them below it). */
const LABEL_FLOOR = 56 + 4;
const CUT_PITCH = 60;
/** The camera's distance from the target. */
const DISTANCE = 9;

/**
 * Where each frame's slice sits in depth: earlier frames in front, later ones behind.
 * @param {number} j @param {number} k @param {number} [dz]
 */
const zOf = (j, k, dz = DZ) => -(j - k) * dz;

/** @param {number} v */
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * @typedef {Object} Palette  colours for one recolour pass
 * @property {(name: string) => number} token
 * @property {(t: number) => number} ramp
 * @property {(colour: number, delta: number, extra?: number) => number} fade
 *           toward the plot background by the distance from the selected
 *           frame (lib/style.js fadeAmount), then by `extra` (none in print)
 * @property {boolean} dark
 */

/**
 * A palette that reads each token once and caches the ramp and the fade, so a recolour of thousands
 * of vertices reads the styles a few times.
 * @returns {Palette}
 */
function palette() {
  /** @type {Map<string, number>} */
  const tokens = new Map();
  /** @type {Map<number, number>} */
  const ramps = new Map();
  /** @type {Map<number, number>} */
  const fades = new Map();
  const print = printing();
  /** @param {string} name */
  const token = (name) => {
    let v = tokens.get(name);
    if (v === undefined) tokens.set(name, (v = tokenHex(name)));
    return v;
  };
  const bg = token("--ambe-plot-bg");
  return {
    token,
    ramp: (t) => {
      const key = Math.round(clamp01(t) * 512);
      let v = ramps.get(key);
      if (v === undefined) ramps.set(key, (v = rampColor(key / 512)));
      return v;
    },
    fade: (colour, delta, extra = 0) => {
      let a = fades.get(delta);
      if (a === undefined) fades.set(delta, (a = fadeAmount(delta)));
      return mix(colour, bg, 1 - (1 - a) * (1 - (print ? 0 : extra)));
    },
    dark: darkGround(),
  };
}

/**
 * The frames a stage draws around frame k: ±8 (stages 1 to 6), or the 2D module's 21-row window
 * (stage 7).
 * @param {PathState} s
 * @returns {{lo: number, hi: number}}
 */
function windowOf(s) {
  if (s.stage === 7) return { lo: s.air.start, hi: s.air.end };
  const total = s.frames.frames.length;
  return { lo: Math.max(0, s.frame - NEIGHBOURS), hi: Math.min(total - 1, s.frame + NEIGHBOURS) };
}

/**
 * One frame's slice at stages 1, 2, 4 and 6, as flat x, y, z points at z = 0, with each point's
 * level on the ramp (0 to 1).
 * @param {PathState} s
 * @param {number} j
 * @returns {{points: number[], levels: number[]}}
 */
function sliceOf(s, j) {
  /** @type {number[]} */
  const points = [];
  /** @type {number[]} */
  const levels = [];
  if (s.stage === 2 || s.stage === 6) {
    const row = (s.stage === 2 ? s.spectra.original : s.spectra.decoded)[j];
    s.spectra.bin_centre_hz.forEach((hz, b) => {
      const t = clamp01((Math.max(DB_FLOOR, row[b]) - DB_FLOOR) / (DB_TOP - DB_FLOOR));
      points.push(X0 + (W * hz) / 4000, YH * t, 0);
      levels.push(t);
    });
  } else {
    const level = s.level(j);
    for (let n = 0; n < SAMPLES; n += 1) {
      const at = j * SAMPLES + n;
      points.push(X0 + (W * n) / (SAMPLES - 1), YH / 2 + (YH * 0.47 * (at < s.pcm.length ? s.pcm[at] : 0)) / s.peak, 0);
      levels.push(level);
    }
  }
  return { points, levels };
}

/**
 * The band strengths as a step curve across the slice (stage 3): each band's strength over its 500
 * Hz.
 * @param {ArrayLike<number>} strengths
 * @returns {number[]}
 */
function skyline(strengths) {
  /** @type {number[]} */
  const points = [];
  for (let b = 0; b < strengths.length; b += 1) {
    const y = YH * clamp01(strengths[b]);
    points.push(X0 + (W * b) / 8, y, 0, X0 + (W * (b + 1)) / 8, y, 0);
  }
  return points;
}

/**
 * A cell of stages 5 and 7: a block standing on the floor.
 * @typedef {Object} Cell
 * @property {number} x0
 * @property {number} x1
 * @property {number} h
 * @property {number} z  the row's centre, where the row ends up
 * @property {number} d  half the block's depth
 * @property {number} row  the row's index in the part (for the stack-in)
 * @property {(pal: Palette) => number} colour  0xRRGGBB, read again on a theme change
 */

/**
 * Cells as one mesh of shaded blocks: front, top and both sides, coloured per face from the cell's
 * colour (no lights: the top is mixed toward the light end of the theme, the sides toward the dark
 * end).
 * @param {ThreeContext} ctx
 * @param {Cell[]} cells
 * @param {(row: number) => number} [reveal]
 */
function blocks(ctx, cells, reveal = () => 1) {
  const T = ctx.three;
  const perCell = 4 * 6;
  const positions = new Float32Array(cells.length * perCell * 3);
  const finals = new Float32Array(cells.length * perCell);
  const rows = new Uint16Array(cells.length * perCell);
  let v = 0;
  /** @param {number} x @param {number} y @param {number} z @param {Cell} c */
  const put = (x, y, z, c) => {
    positions.set([x, y, z], v * 3);
    finals[v] = c.z;
    rows[v] = c.row;
    v += 1;
  };
  /** @param {number[][]} quad @param {Cell} c */
  const face = (quad, c) => {
    for (const i of [0, 1, 2, 0, 2, 3]) put(quad[i][0], quad[i][1], quad[i][2], c);
  };
  for (const c of cells) {
    const { x0, x1, h } = c;
    const z0 = c.z - c.d;
    const z1 = c.z + c.d;
    face([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], c);
    face([[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]], c);
    face([[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], c);
    face([[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1]], c);
  }
  const geometry = new T.BufferGeometry();
  const position = new T.BufferAttribute(positions, 3);
  geometry.setAttribute("position", position);
  const colour = new T.BufferAttribute(new Float32Array(positions.length), 3);
  geometry.setAttribute("color", colour);
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ vertexColors: true, fog: true }));
  mesh.frustumCulled = false;
  const rgb = new T.Color();
  mesh.userData.recolour = () => {
    const pal = palette();
    const light = pal.token(pal.dark ? "--ambe-plot-ink" : "--ambe-plot-bg");
    const dark = pal.token(pal.dark ? "--ambe-plot-bg" : "--ambe-plot-ink");
    const bg = pal.token("--ambe-plot-bg");
    cells.forEach((c, i) => {
      const shown = c.row ? reveal(c.row) : 1;
      const base = shown < 1 ? mix(c.colour(pal), bg, 1 - shown) : c.colour(pal);
      const shades = [base, mix(base, light, 0.28), mix(base, dark, 0.3), mix(base, dark, 0.3)];
      shades.forEach((hex, f) => {
        rgb.setHex(hex);
        for (let k = 0; k < 6; k += 1) colour.setXYZ(i * perCell + f * 6 + k, rgb.r, rgb.g, rgb.b);
      });
    });
    colour.needsUpdate = true;
  };
  mesh.userData.recolour();
  /** @type {Float32Array} */
  const offsets = positions.slice();
  for (let i = 0; i < finals.length; i += 1) offsets[i * 3 + 2] = positions[i * 3 + 2] - finals[i];
  return Object.assign(mesh, {
    /** @param {(row: number) => number} p 0 in the selected plane, 1 in place */
    spread: (p) => {
      const array = /** @type {Float32Array} */ (position.array);
      for (let i = 0; i < finals.length; i += 1) array[i * 3 + 2] = offsets[i * 3 + 2] + finals[i] * p(rows[i]);
      position.needsUpdate = true;
    },
  });
}

/**
 * A fat line whose colour is one token, read again on a theme change.
 * @param {ThreeContext} ctx
 * @param {number[]} segments
 * @param {string} token
 * @param {number} px
 * @param {{dashed?: boolean, dash?: number, gap?: number, fog?: boolean, depthTest?: boolean}} [opts]
 */
function line(ctx, segments, token, px, opts = {}) {
  return fatLines(ctx, segments, () => new Array(segments.length / 3).fill(tokenHex(token)), px, opts);
}

/**
 * A polyline (flat points) as segment pairs.
 * @param {ArrayLike<number>} p
 * @param {number} [z] replaces each point's z when given
 */
function segmentsOf(p, z) {
  /** @type {number[]} */
  const out = [];
  for (let i = 3; i < p.length; i += 3) {
    out.push(p[i - 3], p[i - 2], z ?? p[i - 1], p[i], p[i + 1], z ?? p[i + 2]);
  }
  return out;
}

/**
 * The cells of one row at stage 5 (72 bits) or 7 (72 voice bits, a gap, 24 data bits): each cell's
 * slot across the slice, and the block's depth.
 * @param {number} stage
 */
function rowLayout(stage) {
  const air = stage === 7;
  const count = air ? 96 : 72;
  const gap = air ? 0.08 : 0;
  const pitch = (W - gap) / count;
  const dz = air ? DZ7 : DZ;
  return {
    air,
    count,
    pitch,
    dz,
    d: dz * (air ? 0.36 : 0.3),
    /** The left edge of cell n's slot. @param {number} n */
    slot: (n) => X0 + n * pitch + (n >= 72 ? gap : 0),
  };
}

/**
 * A cell's height: a 1 stands, a 0 lies flat, the selected row's 1 is 1.4 times as tall, data and
 * sync slots have one height each.
 * @param {boolean} air @param {number} n @param {number} bit @param {boolean} me @param {boolean} sync
 */
function cellHeight(air, n, bit, me, sync) {
  if (n >= 72) return sync ? ONE * 0.8 : DATA;
  if (bit !== 1) return ZERO;
  return me ? ONE * 1.4 : ONE;
}

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  /** @type {PathState} */
  let s = /** @type {PathState} */ (opts.state);
  const reduced = prefersReducedMotion();
  /** @param {number} stage */
  const cornerFor = (stage) => ({ ...(stage === 5 || stage === 7 ? CORNER_CELLS : PRESETS.corner) });
  /** This view's presets: Corner follows the stage. @type {Record<string, Pose>} */
  const presets = { ...PRESETS, corner: cornerFor(s.stage) };
  const probe = {
    builds: 0,
    played: 0,
    /** @type {string[]} */ labels: [],
    /** @type {{subject: string, chip: string, rows: number, cells: number[], hidden: number}} */
    part: { subject: "", chip: "", rows: 0, cells: [], hidden: 0 },
    tour: { started: 0, frozen: 0 },
  };

  /** Everything the current stage draws, rebuilt on a stage or clip change. */
  /** @type {import("three").Group | null} */
  let root = null;
  /** The frame-dependent parts of `root`, rebuilt on a frame change. */
  /** @type {import("three").Group | null} */
  let data = null;
  /** @type {(import("three").Group & import("./lib/highlight.js").HighlightKit) | null} */
  let kit = null;
  /** Neighbour lines and cells, for the cutaway and the fan-out. */
  /**
   * A family of neighbour lines: its segments' resting depths and their distances from the selected
   * frame, for the fan-out.
   * @typedef {{fat: FatLine, z: Float32Array, deltas: Int16Array, ahead: boolean}} Family
   */
  /** @type {{lines: Family[], carpet: import("three").Mesh | null, near: ReturnType<typeof blocks> | null,
   *          front: ReturnType<typeof blocks> | null, mine: ReturnType<typeof blocks> | null}} */
  let parts = { lines: [], carpet: null, near: null, front: null, mine: null };
  /** The content box, scene units, for the fit. */
  let box = { min: [X0, 0, -NEIGHBOURS * DZ], max: [X1, YH, NEIGHBOURS * DZ] };
  /** The camera is below CUT_PITCH (the cutaway applies). */
  let cut = true;
  /** The camera looks along time, head on: what is in front is not drawn. */
  let facing = false;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /**
   * How far each neighbour has faded in, by its distance in frames: 0 at the background, 1 at its
   * colour.
   * @type {(delta: number) => number}
   */
  let reveal = () => 1;
  /** The neighbours are not drawn yet: the slice draws alone. */
  let veiled = false;

  /** The selected slice of the current stage, flat x, y, z. */
  const subject = () => {
    if (s.stage === 3) return skyline(s.frames.frames[s.frame].derived.band_voicing);
    if (s.stage === 4) {
      const [x0, x1, h, d] = ENCODER;
      const z = d + 0.004;
      return [x0, 0, z, x0, h, z, x1, h, z, x1, 0, z];
    }
    if (s.stage === 5 || s.stage === 7) {
      const row = rowLayout(s.stage);
      const bits = s.bits(s.frame);
      const z = -row.d - 0.004;
      /** @type {number[]} */
      const points = [];
      for (let n = 0; n < row.count; n += 1) {
        const h = cellHeight(row.air, n, bits[n], true, s.frame % 21 === 0) + 0.012;
        const x0 = row.slot(n);
        points.push(x0, h, z, x0 + row.pitch, h, z);
      }
      return points;
    }
    return sliceOf(s, s.frame).points;
  };

  /**
   * Where the chip's dot sits: at stages 5 and 7 the row's far end, so the
   * chip, above it, stays off the row.
   * @returns {[number, number, number]}
   */
  const chipAt = () => {
    const p = subject();
    let high = 1;
    for (let i = 1; i < p.length; i += 3) if (p[i] > p[high]) high = i;
    if (s.stage === 5 || s.stage === 7) return [p[p.length - 3], p[high], p[p.length - 1]];
    return [p[high - 1], p[high], p[high + 1]];
  };
  /** Moves the chip to chipAt() (after each kit.set, which puts it at the peak). */
  const pinChip = () => {
    if (kit?.chip && (s.stage === 5 || s.stage === 7)) kit.chip.set({ at: chipAt() });
  };

  /** Shows each neighbour part by the veil, the cutaway and the head-on rule. */
  const showParts = () => {
    for (const f of parts.lines) f.fat.visible = !veiled && !(f.ahead && facing);
    if (parts.carpet) parts.carpet.visible = !veiled;
    if (parts.near) parts.near.visible = !veiled;
    if (parts.front) parts.front.visible = !veiled && !cut;
  };

  /**
   * Neighbour lines as two fat lines, the frames behind the selected one and the frames in front,
   * 1.25 px with the fog, each segment's colour faded by its distance and, in front at a pitch
   * below 60 degrees, a little more (the cutaway).
   * @param {ThreeContext} ctx
   * @param {import("three").Group} into
   * @param {number[]} segments
   * @param {number[]} deltas one per segment: j minus the selected frame
   * @param {(segment: number, end: 0 | 1, pal: Palette) => number} colourOf 0xRRGGBB before the fade
   */
  const family = (ctx, into, segments, deltas, colourOf) => {
    for (const ahead of [false, true]) {
      /** @type {number[]} */
      const segs = [];
      /** @type {number[]} */
      const keep = [];
      deltas.forEach((delta, i) => {
        if (delta < 0 !== ahead) return;
        for (let k = 0; k < 6; k += 1) segs.push(segments[i * 6 + k]);
        keep.push(i);
      });
      if (!segs.length) continue;
      const fat = fatLines(ctx, segs, () => {
        const pal = palette();
        const cutaway = cut && ahead ? 0.15 : 0;
        return keep.flatMap((i) => {
          const extra = 1 - (1 - cutaway) * reveal(Math.abs(deltas[i]));
          return [pal.fade(colourOf(i, 0, pal), deltas[i], extra), pal.fade(colourOf(i, 1, pal), deltas[i], extra)];
        });
      }, 1.25, { fog: true });
      fat.frustumCulled = false;
      fat.visible = !veiled && !(ahead && facing);
      into.add(fat);
      parts.lines.push({
        fat,
        z: Float32Array.from({ length: keep.length }, (_, n) => segs[n * 6 + 2]),
        deltas: Int16Array.from(keep.map((i) => deltas[i])),
        ahead,
      });
    }
  };

  /**
   * The neighbours of stages 1, 2, 4 and 6, on the ramp by level: each frame's input level at 1 and
   * 4, each point's dB at 2 and 6.
   * @param {ThreeContext} ctx
   * @param {import("three").Group} into
   */
  const neighbourLines = (ctx, into) => {
    const { lo, hi } = windowOf(s);
    /** @type {number[]} */
    const segments = [];
    /** @type {number[]} */
    const levels = [];
    /** @type {number[]} */
    const deltas = [];
    /** @type {{z: number, delta: number, slice: {points: number[], levels: number[]}}[]} */
    const rows = [];
    for (let j = lo; j <= hi; j += 1) {
      const slice = sliceOf(s, j);
      const z = zOf(j, s.frame);
      rows.push({ z, delta: j - s.frame, slice });
      if (j === s.frame) continue;
      for (let i = 3; i < slice.points.length; i += 3) {
        const p = slice.points;
        segments.push(p[i - 3], p[i - 2], z, p[i], p[i + 1], z);
        levels.push(slice.levels[i / 3 - 1], slice.levels[i / 3]);
        deltas.push(j - s.frame);
      }
    }
    if (segments.length) family(ctx, into, segments, deltas, (i, end, pal) => pal.ramp(levels[i * 2 + end]));
    if (s.stage !== 2 && s.stage !== 6) return;
    const T = ctx.three;
    const n = rows[0].slice.points.length / 3;
    const positions = new Float32Array(rows.length * (n - 1) * 18);
    const tones = new Float32Array(rows.length * (n - 1) * 6);
    const ofRow = new Int16Array(rows.length * (n - 1) * 6);
    let v = 0;
    rows.forEach((row, r) => {
      const p = row.slice.points;
      const z0 = row.z - DZ / 2;
      const z1 = row.z + DZ / 2;
      for (let i = 0; i + 1 < n; i += 1) {
        const x0 = p[i * 3];
        const x1 = p[(i + 1) * 3];
        const t = row.slice.levels[i];
        for (const [x, z] of [[x0, z1], [x1, z1], [x1, z0], [x0, z1], [x1, z0], [x0, z0]]) {
          positions.set([x, 0.002, z], v * 3);
          tones[v] = t;
          ofRow[v] = r;
          v += 1;
        }
      }
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    const colour = new T.BufferAttribute(new Float32Array(positions.length), 3);
    geometry.setAttribute("color", colour);
    const carpet = new T.Mesh(geometry, new T.MeshBasicMaterial({
      vertexColors: true, fog: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    const rgb = new T.Color();
    carpet.userData.recolour = () => {
      const pal = palette();
      for (let i = 0; i < tones.length; i += 1) {
        const delta = rows[ofRow[i]].delta;
        rgb.setHex(pal.fade(pal.ramp(tones[i]), delta, 1 - 0.55 * (delta ? reveal(Math.abs(delta)) : 1)));
        colour.setXYZ(i, rgb.r, rgb.g, rgb.b);
      }
      colour.needsUpdate = true;
    };
    carpet.userData.recolour();
    carpet.frustumCulled = false;
    carpet.visible = !veiled;
    into.add(carpet);
    parts.carpet = carpet;
  };

  /**
   * Rows of cells: stage 5 (72 bits, ±8 frames) or stage 7 (96 cells, the 21-row window).
   * @param {ThreeContext} ctx
   * @param {import("three").Group} into
   */
  const cellRows = (ctx, into) => {
    const row = rowLayout(s.stage);
    const { lo, hi } = windowOf(s);
    /** @type {Cell[]} */
    const behind = [];
    /** @type {Cell[]} */
    const ahead = [];
    /** @type {Cell[]} */
    const mine = [];
    probe.part.rows = hi - lo + 1;
    for (let j = lo; j <= hi; j += 1) {
      const bits = s.bits(j);
      const me = j === s.frame;
      const delta = j - s.frame;
      // The superframe's 21 rows fade at half the rate, so its far end reads.
      const far = row.air ? Math.round(delta / 2) : delta;
      const z = zOf(j, s.frame, row.dz);
      const sync = row.air && j % 21 === 0;
      if (me) probe.part.cells = Array.from(bits);
      const level = s.level(j);
      for (let n = 0; n < row.count; n += 1) {
        const voice = n < 72;
        const x0 = row.slot(n) + row.pitch * 0.12;
        const x1 = x0 + row.pitch * 0.76;
        const one = voice && bits[n] === 1;
        const h = cellHeight(row.air, n, bits[n], me, sync);
        /** @type {(pal: Palette) => number} */
        const colour = !voice
          ? (pal) => pal.fade(pal.token(sync ? "--ambe-sync-slot" : "--ambe-data-slot"), far)
          : !one
            ? (pal) => pal.token("--ambe-3d-grid")
            : me
              ? (pal) => pal.token("--ambe-plot-ink")
              : (pal) => pal.fade(pal.ramp(level), far);
        (me ? mine : z > 1e-6 ? ahead : behind).push({ x0, x1, h, z, d: row.d, row: Math.abs(delta), colour });
      }
    }
    const shown = (/** @type {number} */ r) => reveal(r);
    parts.near = blocks(ctx, behind, shown);
    parts.near.visible = !veiled;
    into.add(parts.near);
    if (ahead.length) {
      parts.front = blocks(ctx, ahead, shown);
      parts.front.visible = !veiled && !cut;
      into.add(parts.front);
    }
    const selected = blocks(ctx, mine);
    /** @type {import("three").MeshBasicMaterial} */ (selected.material).fog = false;
    into.add(selected);
    parts.mine = selected;
  };

  /**
   * The frame-dependent parts of the current stage.
   * @param {ThreeContext} ctx
   */
  const fillData = (ctx) => {
    if (!root) return;
    if (data) {
      root.remove(data);
      data.traverse((node) => {
        const n = /** @type {{geometry?: {dispose(): void}, material?: {dispose(): void}}} */ (node);
        n.geometry?.dispose();
        n.material?.dispose();
      });
    }
    data = new ctx.three.Group();
    root.add(data);
    parts = { lines: [], carpet: null, near: null, front: null, mine: null };
    const record = s.frames.frames[s.frame];
    const stage = s.stage;
    if (stage === 5 || stage === 7) {
      cellRows(ctx, data);
      if (stage === 7 && s.air.next !== null && s.air.next !== s.frame) {
        // The wait to lock: a floor band and a bracket to the next sync slot.
        const T = ctx.three;
        const zN = zOf(s.air.next, s.frame, DZ7);
        const xb = X1 + 0.16;
        data.add(line(ctx, [xb, 0.01, DZ7 * 0.4, xb, 0.01, zN - DZ7 * 0.4,
          xb - 0.07, 0.01, DZ7 * 0.4, xb, 0.01, DZ7 * 0.4, xb - 0.07, 0.01, zN - DZ7 * 0.4, xb, 0.01, zN - DZ7 * 0.4],
        "--ambe-sync-slot", 2.25));
        const depth = Math.abs(zN) + DZ7 * 0.8;
        const band = new T.Mesh(new T.PlaneGeometry(W + 0.3, depth),
          new T.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, fog: false }));
        band.rotation.x = -Math.PI / 2;
        band.position.set((X0 + X1) / 2, 0.003, zN / 2);
        band.userData.recolour = () => /** @type {import("three").MeshBasicMaterial} */ (band.material).color.setHex(tokenHex("--ambe-sync-slot"));
        band.userData.recolour();
        data.add(band);
      }
    } else if (stage === 3) {
      const { lo, hi } = windowOf(s);
      /** @type {number[]} */
      const segments = [];
      /** @type {number[]} */
      const deltas = [];
      /** @type {boolean[]} */
      const periodic = [];
      for (let j = lo; j <= hi; j += 1) {
        if (j === s.frame) continue;
        const z = zOf(j, s.frame);
        s.frames.frames[j].derived.band_voicing.forEach((v, b) => {
          const xc = X0 + (W * (b + 0.5)) / 8;
          const hw = (W / 8) * 0.3;
          const y = YH * clamp01(v);
          segments.push(xc - hw, 0, z, xc - hw, y, z, xc - hw, y, z, xc + hw, y, z, xc + hw, y, z, xc + hw, 0, z);
          for (let k = 0; k < 3; k += 1) {
            deltas.push(j - s.frame);
            periodic.push(v >= THRESHOLD);
          }
        });
      }
      family(ctx, data, segments, deltas, (i, _end, pal) => pal.token(periodic[i] ? "--ambe-voiced" : "--ambe-unvoiced"));
      const T = ctx.three;
      record.derived.band_voicing.forEach((v, b) => {
        const xc = X0 + (W * (b + 0.5)) / 8;
        const hw = (W / 8) * 0.3;
        const y = Math.max(0.004, YH * clamp01(v));
        const bar = new T.Mesh(new T.PlaneGeometry(2 * hw, y), new T.MeshBasicMaterial({ fog: false }));
        bar.position.set(xc, y / 2, 0.004);
        bar.renderOrder = 9;
        const token = v >= THRESHOLD ? "--ambe-voiced" : "--ambe-unvoiced";
        bar.userData.recolour = () => /** @type {import("three").MeshBasicMaterial} */ (bar.material).color.setHex(tokenHex(token));
        bar.userData.recolour();
        data?.add(bar);
      });
      data.add(line(ctx, [X0, THRESHOLD * YH, 0.006, X1, THRESHOLD * YH, 0.006], "--ambe-accent", 1.5, { dashed: true }));
    } else {
      neighbourLines(ctx, data);
      if (stage === 2) {
        const f0 = record.derived.orig_f0_hz;
        /** @type {number[]} */
        const comb = [];
        for (let k = 1; k <= s.harmonics; k += 1) {
          const x = X0 + (W * k * f0) / 4000;
          comb.push(x, 0, 0.006, x, YH, 0.006);
        }
        if (comb.length) data.add(line(ctx, comb, "--ambe-accent-cool", 1.5, { dashed: true, dash: 0.04, gap: 0.04 }));
        const cx = X0 + (W * s.cutoffHz) / 4000;
        data.add(line(ctx, [cx, 0, 0.006, cx, YH, 0.006], "--ambe-text-3", 1));
      }
      if (stage === 6) {
        // The input's spectrum, dashed, over the fill and under the highlight.
        const ghost = line(ctx, segmentsOf(sliceOf({ ...s, stage: 2 }, s.frame).points, 0.01), "--ambe-plot-ink", 1.75,
          { dashed: true, dash: 0.035, gap: 0.03, depthTest: false });
        ghost.renderOrder = 9;
        ghost.material.transparent = true;
        data.add(ghost);
      }
      if (stage === 4) {
        const shell = blocks(ctx, [{
          x0: ENCODER[0], x1: ENCODER[1], h: ENCODER[2], z: 0, d: ENCODER[3], row: 0,
          colour: (pal) => pal.token("--ambe-surface-3"),
        }]);
        /** @type {import("three").MeshBasicMaterial} */ (shell.material).fog = false;
        data.add(shell);
      }
    }
    probe.part.subject = stage === 4 ? "encoder" : stage === 5 || stage === 7 ? "row" : "slice";
    probe.part.hidden = parts.front && cut ? 1 : 0;
  };

  /**
   * The part for the current stage: floor, contact shadow, fog, the highlight kit and the
   * frame-dependent parts.
   * @param {ThreeContext} ctx
   */
  const buildPart = (ctx) => {
    const T = ctx.three;
    if (root) {
      ctx.scene.remove(root);
      kit?.chip?.dispose();
      root.traverse((node) => {
        const n = /** @type {{geometry?: {dispose(): void}, material?: {dispose(): void}}} */ (node);
        n.geometry?.dispose();
        n.material?.dispose();
      });
    }
    root = new T.Group();
    data = null;
    ctx.scene.add(root);
    const { lo, hi } = windowOf(s);
    const dz = s.stage === 7 ? DZ7 : DZ;
    const zFront = zOf(lo, s.frame, dz) + dz * 0.6;
    const zBack = zOf(hi, s.frame, dz) - dz * 0.6;
    const yTop = s.stage === 5 || s.stage === 7 ? ONE * 1.6 : YH;
    box = { min: [X0 - 0.05, 0, Math.min(zBack, -0.2)], max: [X1 + 0.05, yTop, Math.max(zFront, 0.2)] };
    root.add(floor(ctx, {
      extent: { min: [X0 - 0.2, -0.002, box.min[2] - 0.1], max: [X1 + 0.2, 0, box.max[2] + 0.1] },
      step: [W / 4, dz * 5],
    }));
    root.add(contactShadow(ctx, { x: [X0, X1], z: [-0.25, 0.25], y: 0 }));
    if (s.stage !== 4 && s.stage !== 5 && s.stage !== 7) {
      root.add(line(ctx, [X0, 0, 0, X1, 0, 0, X0, 0, 0, X0, YH, 0], "--ambe-text-3", 1));
    }
    fillData(ctx);
    const strip = s.stage === 5 || s.stage === 7;
    kit = addHighlight(ctx, subject(), {
      baseline: 0,
      chip: s.chip,
      fill: s.stage !== 4,
    });
    if (strip) kit.position.z = 0;
    root.add(kit);
    pinChip();
    probe.part.chip = s.chip;
    // Stage 7 is deep: lighter fog keeps its far rows at 3:1 in light.
    if (s.stage === 7) fog(ctx, DISTANCE + 1.75, 3.6);
    else fog(ctx, DISTANCE, box.max[2] - box.min[2]);
    placeLabels();
  };

  /**
   * HTML labels for the 3D view: the stack labels (earlier frames in front, later ones behind), the
   * axis's name, the encoder's caption, and at stage 7 the next sync slot.
   */
  const placeLabels = () => {
    if (!labels) return;
    const { lo, hi } = windowOf(s);
    const dz = s.stage === 7 ? DZ7 : DZ;
    const kind = poseKind(orbit?.pose() ?? presets[s.preset] ?? presets.corner);
    labelPose = kind;
    const zFront = zOf(lo, s.frame, dz);
    const zBack = zOf(hi, s.frame, dz);
    /** @type {Spot[]} */
    const list = [];
    const cells = s.stage === 5 || s.stage === 7;
    const yTop = cells ? ONE * 1.4 : YH;
    if (kind === "corner") {
      if (lo < s.frame && !(cells && cut)) list.push({ text: "earlier frames, 20 ms apart", anchor: [0, 0, zFront], align: "middle", dx: 0, dy: 18, keep: 2 });
      if (hi > s.frame) {
        list.push({ text: lo < s.frame ? "later frames" : "later frames, 20 ms apart", anchor: [X0, yTop, zBack], align: "end", dx: -6, dy: -4, keep: 2 });
      }
      if (s.axis) list.push({ text: s.axis, anchor: [X0, 0, 0], align: "end", dx: -8, dy: 2, keep: 1 });
    } else if (kind === "top") {
      if (lo < s.frame) list.push({ text: "earlier", anchor: [X1, 0, zFront], align: "start", dx: 10, dy: 0 });
      if (hi > s.frame) list.push({ text: "later", anchor: [X1, 0, zBack], align: "start", dx: 10, dy: 0 });
      if (s.axis) list.push({ text: s.axis, anchor: [0, 0, zFront], align: "middle", dx: 0, dy: 16, keep: 1 });
    }
    if (s.stage === 6 && kind !== "front") {
      // Named past its end at 4 kHz, clear of the chip.
      const p = sliceOf({ ...s, stage: 2 }, s.frame).points;
      const at = p.length - 3;
      list.push({ text: "input (dashed)", anchor: [p[at], p[at + 1], 0.01], align: "start", dx: 8, dy: 0, keep: 3 });
    }
    if (s.stage === 7 && s.air.next !== null && s.air.wait !== null && s.air.next !== s.frame && kind !== "front") {
      const z = zOf(s.air.next, s.frame, DZ7);
      const text = `next sync slot\n${20 * s.air.wait} ms to lock`;
      list.push(kind === "top"
        ? { text, anchor: [X1 + 0.16, 0, z], align: "start", dx: 8, dy: 0, keep: 3 }
        : { text, anchor: [X1 + 0.16, ONE * 0.8, z], align: "start", dx: 8, dy: -4, keep: 3 });
    }
    spots = list;
    shownKey = null;
    pinned = list.map((spot) => ({ text: spot.text, at: [...spot.anchor], align: spot.align }));
    labels.set(pinned);
    probe.labels = list.map((l) => l.text);
  };

  /**
   * A label: a point of the scene, and where the text sits from it on screen, in CSS px (dy down).
   * @typedef {{text: string, anchor: [number, number, number], align: "start" | "middle" | "end", dx: number, dy: number,
   *            keep?: number}} Spot  keep: the higher, the later a crowded fit leaves it out
   */
  /** @type {Spot[]} */
  let spots = [];
  /** @type {import("./lib/labels.js").Label[]} */
  let pinned = [];
  /** @type {Map<string, {w: number, h: number}>} */
  const labelSizes = new Map();
  /** The labels the last fit kept, joined. @type {string | null} */
  let shownKey = null;
  let labelPose = "";

  /** @param {Pose} pose */
  const poseKind = (pose) =>
    Math.abs(pose.pitch) < 8 && Math.abs(((pose.yaw % 360) + 540) % 360 - 180) < 8 ? "front" : pose.pitch > 75 ? "top" : "corner";

  /** @param {string} text */
  const labelSize = (text) => {
    const known = labelSizes.get(text);
    if (known) return known;
    const node = [...frame.querySelectorAll(".anim-figure__overlay > .anim-figure__label")].find((n) => n.textContent === text);
    if (!(node instanceof HTMLElement)) return { w: text.length * 6.5, h: 14 };
    const hidden = node.hidden;
    node.hidden = false;
    const size = { w: node.offsetWidth, h: node.offsetHeight };
    node.hidden = hidden;
    if (size.w && size.h) labelSizes.set(text, size);
    return size.w ? size : { w: text.length * 6.5, h: 14 };
  };

  /**
   * The zoom-1 frustum at the current pose.
   * @param {ThreeContext} ctx
   */
  const fit = (ctx) => {
    const cam = ctx.camera;
    if (!("isOrthographicCamera" in cam)) return;
    const T = ctx.three;
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (!width || !height) return;
    cam.updateMatrixWorld();
    const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const target = new T.Vector3(...TARGET);
    /** @param {number} x @param {number} y @param {number} z */
    const screen = (x, y, z) => {
      const v = new T.Vector3(x, y, z).sub(target);
      return { r: v.dot(right), u: v.dot(up) };
    };
    /** @type {{r: number, u: number, box: [number, number, number, number], floor: number, mx: number, my: number}[]} */
    const items = [];
    const mx = Math.round(width * 0.05);
    const my = Math.round(height * 0.06);
    const zMax = cut && (s.stage === 5 || s.stage === 7) ? Math.min(box.max[2], rowLayout(s.stage).d + 0.05) : box.max[2];
    for (const x of [box.min[0], box.max[0]]) {
      for (const y of [box.min[1], box.max[1]]) {
        for (const z of [box.min[2], zMax]) items.push({ ...screen(x, y, z), box: [0, 0, 0, 0], floor: 0, mx, my });
      }
    }
    /** @param {Spot} spot */
    const itemOf = (spot) => {
      const { w, h } = labelSize(spot.text);
      const x0 = spot.dx + (spot.align === "end" ? -w : spot.align === "middle" ? -w / 2 : 0);
      return { ...screen(...spot.anchor), box: /** @type {[number, number, number, number]} */ ([x0, x0 + w, spot.dy - h / 2, spot.dy + h / 2]),
        floor: LABEL_FLOOR, mx: 6, my: 6 };
    };
    const geometry = items.slice();
    // Room for the chip above its dot, so it never drops onto its subject.
    const chip = kit?.chip ?? null;
    chip?.update();
    const chipW = chip?.node.offsetWidth || s.chip.length * 6.5 + 30;
    const chipH = chip?.node.offsetHeight || 24;
    const dot = screen(...chipAt());
    if (chip) items.push({ ...dot, box: [0, 0, -14 - chipH, 0], floor: 0, mx: 4, my: 4 });
    const corners = items.slice();
    /** @param {number} sc @param {typeof items} list */
    const room = (sc, list) => {
      let tLo = -Infinity;
      let tHi = Infinity;
      let vLo = -Infinity;
      let vHi = Infinity;
      for (const it of list) {
        const x = width / 2 + it.r * sc;
        tLo = Math.max(tLo, x + it.box[1] - (width - it.mx));
        tHi = Math.min(tHi, x + it.box[0] - it.mx);
        const y = height / 2 - it.u * sc;
        vLo = Math.max(vLo, it.my - (y + it.box[2]));
        vHi = Math.min(vHi, height - Math.max(it.my, it.floor) - (y + it.box[3]));
      }
      return { tLo, tHi, vLo, vHi, ok: tLo <= tHi && vLo <= vHi };
    };
    /** The largest scale at which every item fits. @param {typeof items} list */
    const largest = (list) => {
      let lo = 1;
      let hi = 4 * Math.max(width, height);
      for (let k = 0; k < 30; k += 1) {
        const mid = (lo + hi) / 2;
        if (room(mid, list).ok) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    // Labels that would shrink the part below 70% are left out, least needed first.
    const free = largest(corners);
    let shown = spots.slice();
    let sLo = largest([...corners, ...shown.map(itemOf)]);
    while (sLo < 0.7 * free && shown.length) {
      const least = shown.reduce((a, b) => ((b.keep ?? 0) < (a.keep ?? 0) ? b : a));
      shown = shown.filter((spot) => spot !== least);
      sLo = largest([...corners, ...shown.map(itemOf)]);
    }
    /**
     * The shift of the frame at scale sc: the geometry centred, as far as the labels and the chip
     * allow.
     * @param {number} sc @param {typeof items} list
     */
    const offsets = (sc, list) => {
      const r = room(sc, list);
      let xMin = Infinity;
      let xMax = -Infinity;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const g of geometry) {
        xMin = Math.min(xMin, g.r * sc);
        xMax = Math.max(xMax, g.r * sc);
        yMin = Math.min(yMin, -g.u * sc);
        yMax = Math.max(yMax, -g.u * sc);
      }
      /** @param {number} want @param {number} lo @param {number} hi */
      const within = (want, lo, hi) => {
        if (!Number.isFinite(lo + hi)) return Number.isFinite(lo) ? Math.max(lo, want) : Number.isFinite(hi) ? Math.min(hi, want) : want;
        return lo <= hi ? Math.min(hi, Math.max(lo, want)) : (lo + hi) / 2;
      };
      return { t: within((xMin + xMax) / 2, r.tLo, r.tHi), v: within(-(yMin + yMax) / 2, r.vLo, r.vHi) };
    };
    /** @param {number} sc @param {typeof items} list */
    const place = (sc, list) => {
      const { t, v } = offsets(sc, list);
      return { x: (/** @type {number} */ rr) => width / 2 + rr * sc - t, y: (/** @type {number} */ uu) => height / 2 - uu * sc + v };
    };
    for (let pass = 0; pass <= spots.length && chip && shown.length; pass += 1) {
      const at = place(sLo, [...corners, ...shown.map(itemOf)]);
      const bw = chipW;
      const bh = chipH;
      const cx = at.x(dot.r);
      const cy = at.y(dot.u);
      const left = Math.max(4, Math.min(width - 4 - bw, cx + 14 + bw > width - 4 ? cx - 14 - bw : cx + 14));
      const top = Math.max(4, Math.min(height - 4 - bh, cy - 14 - bh < 4 ? cy + 14 : cy - 14 - bh));
      const clear = shown.filter((spot) => {
        const it = itemOf(spot);
        const x = at.x(it.r);
        const y = at.y(it.u);
        return x + it.box[1] < left - 2 || x + it.box[0] > left + bw + 2 || y + it.box[3] < top - 2 || y + it.box[2] > top + bh + 2;
      });
      if (clear.length === shown.length) break;
      shown = clear;
      sLo = largest([...corners, ...shown.map(itemOf)]);
    }
    const key = shown.map((spot) => spot.text).join("|");
    if (key !== shownKey) {
      shownKey = key;
      pinned = shown.map((spot) => ({ text: spot.text, at: [...spot.anchor], align: spot.align }));
      labels?.set(pinned);
      probe.labels = shown.map((spot) => spot.text);
    }
    items.push(...shown.map(itemOf));
    const sc = sLo;
    const { t, v } = offsets(sc, items);
    let f = { left: (t - width / 2) / sc, right: (t + width / 2) / sc, top: (height / 2 + v) / sc, bottom: (v - height / 2) / sc };
    const rect = s.stage === 1 || s.stage === 2 || s.stage === 3 || s.stage === 6 ? s.plotRect() : null;
    const pose = orbit?.pose() ?? presets[s.preset];
    const off = Math.max(Math.abs(((pose.yaw % 360) + 540) % 360 - 180), Math.abs(pose.pitch));
    if (rect && off < 12) {
      const front = frontFrustum({ width, height }, rect, { min: [X0, 0, 0], max: [X1, YH, 0] });
      const w = off / 12;
      f = {
        left: front.left + (f.left - front.left) * w,
        right: front.right + (f.right - front.right) * w,
        top: front.top + (f.top - front.top) * w,
        bottom: front.bottom + (f.bottom - front.bottom) * w,
      };
    }
    Object.assign(cam, f);
    cam.updateProjectionMatrix();
    const scale = width / (f.right - f.left);
    shown.forEach((spot, k) => {
      const at = new T.Vector3(...spot.anchor).addScaledVector(right, spot.dx / scale).addScaledVector(up, -spot.dy / scale);
      if (pinned[k]) pinned[k].at = [at.x, at.y, at.z];
    });
  };

  /** The cutaway follows the camera's pitch. @param {ThreeContext} ctx */
  const applyCut = (ctx) => {
    const pose = orbit?.pose() ?? presets.corner;
    const head = Math.max(Math.abs(((pose.yaw % 360) + 540) % 360 - 180), Math.abs(pose.pitch)) < 12;
    if (head !== facing) {
      facing = head;
      showParts();
      ctx.requestRender();
    }
    const next = pose.pitch < CUT_PITCH;
    if (next === cut) return;
    cut = next;
    showParts();
    probe.part.hidden = parts.front && cut ? 1 : 0;
    placeLabels();
    fit(ctx);
    data?.traverse((node) => {
      if (node !== parts.near && node !== parts.front) node.userData.recolour?.();
    });
    ctx.requestRender();
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: s.describe,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
    build: (c) => {
      root = null;
      data = null;
      kit = null;
      buildPart(c);
      probe.builds += 1;
    },
  });
  if (!ctx) return null;
  labels = createLabels(frame, ctx);
  placeLabels();
  orbit = createOrbit(ctx, {
    target: TARGET,
    distance: DISTANCE,
    zoom: opts.look.zoom || 1,
    presets: presets,
    start: s.preset in presets ? s.preset : "corner",
    onDrag: opts.onDrag,
    fit: () => fit(ctx),
    onChange: () => {
      const pose = orbit?.pose();
      if (pose && poseKind(pose) !== labelPose) {
        placeLabels();
        fit(ctx);
      }
      applyCut(ctx);
      labels?.update();
    },
  });
  ctx.viewSignal.addEventListener("abort", () => labels?.dispose(), { once: true });
  applyCut(ctx);

  /* ------------------------------------------------------- animation --- */

  const tl = ctx.timeline();
  /** The walk-through's camera moves, on a timeline of their own. */
  const tourTl = ctx.timeline();

  /**
   * The stage's explanatory animation.
   * @param {number} from the stage before, for the 4 to 5 collapse
   * @param {boolean} camera
   */
  const play = (from, camera, moved = false) => {
    if (!kit) return Promise.resolve();
    const k = kit;
    const points = subject();
    const n = points.length / 3;
    const slow = duration("slow") || 420;
    /** @type {Promise<void>[]} */
    const jobs = [];
    const chipLayer = k.chip?.node.parentElement ?? null;
    /** @param {boolean} on */
    const showChip = (on) => {
      if (chipLayer) chipLayer.style.visibility = on ? "" : "hidden";
    };
    if (orbit && s.preset === "corner") {
      if (camera && !s.tour) {
        // First view: Front, then Corner once the slice is drawn. A track of
        // tl, so landing lands it (orbit.go would land the build first).
        const o = orbit;
        const to = presets.corner;
        o.set(FRONT);
        jobs.push(tl.play("camera", {
          ms: duration("3d-camera") || 700,
          delay: slow,
          ease: "inout",
          build: true,
          step: (t) => o.set({ yaw: FRONT.yaw + (to.yaw - FRONT.yaw) * t, pitch: FRONT.pitch + (to.pitch - FRONT.pitch) * t }),
        }));
      } else if (camera || moved || (s.tour && s.tour.to)) {
        jobs.push(orbit.go("corner"));
      }
    }
    if (s.stage === 5 && from === 4 && data && ctx) {
      const curve = sliceOf({ ...s, stage: 1 }, s.frame).points;
      /** @type {number[]} */
      const ends = [];
      const row = rowLayout(5);
      for (let i = 0; i < curve.length; i += 3) {
        const b = Math.round(((curve[i] - X0) / W) * 71);
        ends.push(row.slot(b) + row.pitch / 2, cellHeight(false, b, probe.part.cells[b], true, false), 0);
      }
      const fat = fatLines(ctx, segmentsOf(curve), () => new Array((curve.length / 3 - 1) * 2).fill(tokenHex("--ambe-highlight")), 2, { depthTest: false });
      fat.renderOrder = 12;
      data.add(fat);
      const near = parts.mine;
      showChip(false);
      jobs.push(tl.play("build", {
        ms: duration("3d-build") || 900,
        build: true,
        step: (t) => {
          const mixd = curve.map((v, i) => v + (ends[i] - v) * t);
          fat.geometry.setPositions(Float32Array.from(segmentsOf(mixd)));
          if (near) near.scale.y = Math.max(0.001, t);
          if (t >= 1) {
            fat.visible = false;
            if (near) near.scale.y = 1;
            showChip(true);
          }
        },
      }));
    } else if (n > 1) {
      // The slice draws left to right from a stub set now (no flash); points
      // not drawn yet wait on the last drawn, as three.js keeps a fat line's
      // first instance count.
      const y0 = Math.min(...points.filter((_, i) => i % 3 === 1));
      const draw = (/** @type {number} */ t) => {
        const upto = Math.max(2, Math.ceil(n * t));
        const shown = points.map((_, i) => {
          const v = points[Math.min(i, upto * 3 - 3 + (i % 3))];
          return i % 3 === 1 ? y0 + (v - y0) * (0.35 + 0.65 * t) : v;
        });
        k.set(shown);
        pinChip();
        if (t >= 1) showChip(true);
      };
      showChip(false);
      draw(0);
      jobs.push(tl.play("build", { ms: slow, build: true, step: draw }));
    }
    const spreadOut = (/** @type {number[]} */ p) => {
      /** @param {number} delta */
      const at = (delta) => (delta === 0 ? 1 : p[Math.min(p.length - 1, Math.abs(delta) - 1)]);
      const wasVeiled = veiled;
      veiled = !p.some((v) => v > 0);
      reveal = at;
      // Pushed back while sliding, so the slice's fill hides those close behind.
      const sliding = p.some((v) => v < 1);
      for (const line2 of parts.lines) {
        line2.fat.material.polygonOffset = sliding;
        line2.fat.material.polygonOffsetFactor = 4;
        line2.fat.material.polygonOffsetUnits = 16;
        const attr = /** @type {any} */ (line2.fat.geometry.attributes.instanceStart).data;
        const array = /** @type {Float32Array} */ (attr.array);
        for (let i = 0; i < line2.z.length; i += 1) {
          const z = line2.z[i] * at(line2.deltas[i]);
          array[i * 6 + 2] = z;
          array[i * 6 + 5] = z;
        }
        attr.needsUpdate = true;
        if (!veiled) line2.fat.userData.recolour?.();
      }
      if (parts.carpet) {
        parts.carpet.scale.z = Math.max(0.001, p[0]);
        if (!veiled) parts.carpet.userData.recolour?.();
      }
      for (const cells of [parts.near, parts.front]) {
        cells?.spread((row) => at(row));
        if (!veiled) cells?.userData.recolour?.();
      }
      if (veiled !== wasVeiled || veiled) showParts();
    };
    const air = s.stage === 7;
    const rows = air ? 20 : NEIGHBOURS;
    const progress = new Array(rows).fill(0);
    spreadOut(progress);
    // Stage 7: 120 + 19 x 20 + 600 = 1100 ms; stages 1 to 6: about 1.1 s.
    jobs.push(tl.play("fan", {
      ms: Math.min(600, (duration("3d-build") || 900) - 300),
      delay: air ? 120 : slow * 0.6,
      count: rows,
      stagger: air ? 20 : 35,
      build: true,
      step: (t, i) => {
        progress[i] = t;
        if (i === rows - 1) spreadOut(progress);
      },
    }));
    return Promise.all(jobs).then(() => {
      if (k !== kit) return;
      spreadOut(new Array(rows).fill(1));
      reveal = () => 1;
      k.set(points);
      pinChip();
      showChip(true);
    });
  };

  /** The camera drifts toward the walk-through's pose for this step. */
  let tourId = -1;
  /** @type {{from: Pose, to: Pose, ms: number, at: number, frozen: boolean, begin: number} | null} */
  let drift = null;
  const runDrift = () => {
    const d = drift;
    if (!d || !orbit || reduced) return;
    const o = orbit;
    const from = { ...o.pose() };
    const left = 1 - d.at;
    if (left <= 0) return;
    const ms = d.ms * left;
    const begin = performance.now();
    d.begin = begin;
    d.from = from;
    probe.tour.started += 1;
    const dyaw = ((((d.to.yaw - from.yaw) % 360) + 540) % 360) - 180;
    void tourTl.play("drift", {
      ms,
      ease: "linear",
      step: (t) => {
        if (d.frozen || drift !== d) return;
        // An early end is the reader taking over: stay where the camera is.
        if (t >= 1 && performance.now() - begin < ms * 0.95) {
          d.frozen = true;
          d.at += left * clamp01((performance.now() - begin) / ms);
          probe.tour.frozen += 1;
          return;
        }
        const e = t * t * (3 - 2 * t);
        o.set({ yaw: from.yaw + dyaw * e, pitch: from.pitch + (d.to.pitch - from.pitch) * e });
        if (t >= 1) d.at = 1;
      },
    });
  };
  /** @param {PathState["tour"]} tour */
  const followTour = (tour) => {
    if (!tour || !tour.to) {
      if (!drift) return;
      drift.frozen = true;
      drift = null;
      tourTl.finish();
      return;
    }
    if (tour.id !== tourId) {
      tourId = tour.id;
      if (drift) drift.frozen = true;
      drift = { from: orbit?.pose() ?? presets.corner, to: tour.to, ms: tour.ms, at: 0, frozen: false, begin: 0 };
      if (!tour.paused) void busy.then(() => runDrift());
      return;
    }
    if (!drift) return;
    if (tour.paused && !drift.frozen) {
      const elapsed = performance.now() - drift.begin;
      drift.at = Math.min(1, drift.at + (1 - drift.at) * clamp01(elapsed / (drift.ms * (1 - drift.at) || 1)));
      drift.frozen = true;
      tourTl.finish();
    } else if (!tour.paused && drift.frozen && drift.at < 1) {
      drift.frozen = false;
      runDrift();
    }
  };

  /** Resolves when the stage's build has run. */
  let busy = Promise.resolve();

  if (opts.intro) {
    probe.played += 1;
    busy = play(0, true);
  }
  followTour(s.tour);
  await ctx.drawn();

  /**
   * The frame changed at the same stage: slide the stack and pulse the
   * slice. Stage 7 rebuilds (its window moves) but plays no stack-in.
   * @param {number} from
   */
  const toFrame = (from) => {
    const step = s.frame - from;
    if (s.stage === 7) {
      buildPart(ctx);
    } else {
      fillData(ctx);
      placeLabels();
      kit?.set(subject());
      kit?.chip?.set({ text: s.chip });
      pinChip();
    }
    probe.part.chip = s.chip;
    fit(ctx);
    labels?.update();
    const group = data;
    if (group && Math.abs(step) <= NEIGHBOURS && !reduced) {
      const dz = s.stage === 7 ? DZ7 : DZ;
      group.position.z = -step * dz;
      void tl.play("slide", {
        ms: 200,
        step: (t) => {
          group.position.z = -step * dz * (1 - t);
        },
      });
    }
    void kit?.pulse();
    ctx.requestRender();
  };

  if (TEST_HOOK) {
    TEST_HOOK.figures[SLUG] = {
      get builds() {
        return probe.builds;
      },
      get pose() {
        return orbit?.pose();
      },
      get zoom() {
        return orbit?.zoom();
      },
      get played() {
        return probe.played;
      },
      get labels() {
        return probe.labels;
      },
      get part() {
        return { ...probe.part, cut };
      },
      get tour() {
        return { ...probe.tour };
      },
      get three() {
        return ctx;
      },
      get orbit() {
        return orbit;
      },
      /** The selected slice's points on screen, CSS px in the frame. */
      get frontPoints() {
        const T = ctx.three;
        ctx.camera.updateMatrixWorld();
        const p = s.stage === 3 ? subject() : sliceOf(s, s.frame).points;
        /** @type {{x: number, y: number}[]} */
        const out = [];
        for (let i = 0; i < p.length; i += 3) {
          const v = new T.Vector3(p[i], p[i + 1], p[i + 2]).project(ctx.camera);
          out.push({ x: ((v.x + 1) / 2) * frame.clientWidth, y: ((1 - v.y) / 2) * frame.clientHeight });
        }
        return out;
      },
    };
  }

  return {
    update: (next) => {
      const before = s;
      s = /** @type {PathState} */ (next);
      if (s.clip !== before.clip || s.stage !== before.stage) {
        tl.finish();
        const corner = cornerFor(s.stage);
        const moved = corner.pitch !== presets.corner.pitch || corner.yaw !== presets.corner.yaw;
        presets.corner = corner;
        buildPart(ctx);
        fit(ctx);
        labels?.update();
        busy = play(before.stage, false, moved);
      } else if (s.frame !== before.frame) {
        tl.finish();
        toFrame(before.frame);
      }
      followTour(s.tour);
      ctx.requestRender();
    },
    preset: (name) => {
      s = { ...s, preset: /** @type {PathState["preset"]} */ (name) };
      void orbit?.go(name);
    },
    describe: () => s.describe,
    close: () => {
      if (TEST_HOOK && /** @type {{three?: unknown} | undefined} */ (TEST_HOOK.figures[SLUG])?.three === ctx) delete TEST_HOOK.figures[SLUG];
      ctx.dispose();
    },
  };
}
