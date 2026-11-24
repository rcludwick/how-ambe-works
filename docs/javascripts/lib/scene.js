// @ts-check
/* ===========================================================================
 * lib/scene.js: building blocks for a figure's 3D part (design §3.4).
 * ---------------------------------------------------------------------------
 * Every helper here takes the ThreeContext and is called from build(), so
 * a restored or unparked view runs it again; nothing holds GPU objects
 * between builds. Colours come from theme tokens: a material through
 * ctx.paint(), vertex colours through userData.recolour, which anim-three.js
 * runs on every theme change. A 3D part never computes model data: these
 * helpers take the 2D module's arrays and only place them in the scene.
 *
 * Data lines are thick (lib/style.js fatLines): curveFamily is the
 * visual language's context family, 1.25 px with the distance fade. Grid,
 * axes, stems and wire grids stay LineSegments with LineBasicMaterial.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { fade, fatLines, tokenHex } from "./style.js";

/** @typedef {import("../anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./orbit.js").SceneBox} SceneBox */
/** @typedef {[number, number]} Range */

/**
 * @typedef {Object} SceneMap  data units to scene units and back, per axis
 * @property {(v: number) => number} x
 * @property {(v: number) => number} y
 * @property {(v: number) => number} z
 * @property {(x: number, y: number, z: number) => [number, number, number]} point
 * @property {{x: (s: number) => number, y: (s: number) => number, z: (s: number) => number}} invert
 * @property {SceneBox} box  the data box in scene units, centred on 0
 */

/**
 * Map a data box onto a scene box centred on the origin, `extent` scene
 * units across on each axis. A reversed range (b < a) flips that axis.
 * @param {{x: Range, y: Range, z: Range}} box data ranges
 * @param {{x: number, y: number, z: number}} extent scene size per axis
 * @returns {SceneMap}
 */
export function toScene(box, extent) {
  /**
   * @param {Range} range
   * @param {number} size
   */
  const axis = (range, size) => {
    const [a, b] = range;
    const k = size / (b - a);
    return {
      of: (/** @type {number} */ v) => (v - a) * k - size / 2,
      inv: (/** @type {number} */ s) => (s + size / 2) / k + a,
    };
  };
  const ax = axis(box.x, extent.x);
  const ay = axis(box.y, extent.y);
  const az = axis(box.z, extent.z);
  return {
    x: ax.of,
    y: ay.of,
    z: az.of,
    point: (x, y, z) => [ax.of(x), ay.of(y), az.of(z)],
    invert: { x: ax.inv, y: ay.inv, z: az.inv },
    box: {
      min: [-extent.x / 2, -extent.y / 2, -extent.z / 2],
      max: [extent.x / 2, extent.y / 2, extent.z / 2],
    },
  };
}

/**
 * A segment buffer for data that changes in place: `capacity` segments,
 * dynamic, drawing none until writePoints() fills it.
 * @param {ThreeContext} ctx
 * @param {number} capacity segments
 * @param {string} token colour token
 * @returns {import("three").LineSegments}
 */
export function lineBuffer(ctx, capacity, token) {
  const T = ctx.three;
  const geometry = new T.BufferGeometry();
  const position = new T.BufferAttribute(new Float32Array(capacity * 6), 3);
  position.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setDrawRange(0, 0);
  const lines = new T.LineSegments(geometry, ctx.paint(new T.LineBasicMaterial(), token));
  lines.frustumCulled = false;
  return lines;
}

/**
 * Write points (x, y, z triples, flat) into an object's position buffer
 * from vertex `offset` on, and draw up to the last one written.
 * @param {import("three").Object3D & {geometry: import("three").BufferGeometry}} object
 * @param {ArrayLike<number>} points
 * @param {number} [offset=0] first vertex to write
 * @returns {void}
 */
export function writePoints(object, points, offset = 0) {
  const position = /** @type {import("three").BufferAttribute} */ (object.geometry.getAttribute("position"));
  const room = position.count - offset;
  const count = Math.min(room, Math.floor(points.length / 3));
  const array = /** @type {Float32Array} */ (position.array);
  for (let i = 0; i < count * 3; i += 1) array[offset * 3 + i] = points[i];
  position.needsUpdate = true;
  object.geometry.setDrawRange(0, offset + count);
  object.geometry.computeBoundingSphere();
}

/**
 * Many polylines in one draw call, the context of a figure: each curve
 * (flat x, y, z points) becomes segments of one LineSegments2, 1.25 px
 * unless `px` says otherwise, with the fog. Each curve's colour is a token
 * or a 0xRRGGBB, or comes from a function of the curve's index (pass
 * `(c) => rampColor(c / n)` so a theme change reads the new ramp), faded
 * toward the plot background by its
 * distance `delta` from the highlight (lib/style.js fade), and worked out
 * again on a theme change.
 * @param {ThreeContext} ctx
 * @param {ArrayLike<number>[]} curves
 * @param {{colours: string | (string | number)[] | ((c: number) => number), delta?: number[], px?: number}} opts
 *        one colour for all, one per curve, or a function of the curve
 * @returns {import("three/addons/lines/LineSegments2.js").LineSegments2}
 */
export function curveFamily(ctx, curves, opts) {
  let segments = 0;
  for (const curve of curves) segments += Math.max(0, curve.length / 3 - 1);
  const positions = new Float32Array(segments * 6);
  let v = 0;
  for (const curve of curves) {
    const n = curve.length / 3;
    for (let i = 0; i + 1 < n; i += 1) {
      for (let j = 0; j < 6; j += 1) positions[v * 3 + j] = curve[i * 3 + j];
      v += 2;
    }
  }
  const colours = () => {
    const out = new Array(segments * 2);
    let at = 0;
    curves.forEach((curve, c) => {
      const { colours: from } = opts;
      const pick = typeof from === "string" ? from : typeof from === "function" ? from(c) : from[c];
      const hex = fade(typeof pick === "string" ? tokenHex(pick) : pick, opts.delta?.[c] ?? 0);
      for (let i = Math.max(0, curve.length / 3 - 1) * 2; i > 0; i -= 1) out[at++] = hex;
    });
    return out;
  };
  return fatLines(ctx, positions, colours, opts.px ?? 1.25, { fog: true });
}

/**
 * A height field over a grid: heights[row][col] at x = xs[col], z = zs[row],
 * drawn as a wire grid (lines along x and along z), with an opaque fill
 * under it when `fill` names a token. The fill sits a little behind the
 * wires (polygonOffset), so the wires stay on top.
 * @param {ThreeContext} ctx
 * @param {ArrayLike<number>} xs scene x per column
 * @param {ArrayLike<number>} zs scene z per row
 * @param {ArrayLike<number>[]} heights scene y, one row per z
 * @param {{token: string, fill?: string}} opts
 * @returns {import("three").Group}
 */
export function heightField(ctx, xs, zs, heights, opts) {
  const T = ctx.three;
  const nx = xs.length;
  const nz = zs.length;
  const group = new T.Group();
  const wires = new Float32Array(((nx - 1) * nz + (nz - 1) * nx) * 6);
  let w = 0;
  /** @param {number} r @param {number} c */
  const put = (r, c) => {
    wires[w++] = xs[c];
    wires[w++] = heights[r][c];
    wires[w++] = zs[r];
  };
  for (let r = 0; r < nz; r += 1) {
    for (let c = 0; c + 1 < nx; c += 1) {
      put(r, c);
      put(r, c + 1);
    }
  }
  for (let c = 0; c < nx; c += 1) {
    for (let r = 0; r + 1 < nz; r += 1) {
      put(r, c);
      put(r + 1, c);
    }
  }
  const wireGeometry = new T.BufferGeometry();
  wireGeometry.setAttribute("position", new T.BufferAttribute(wires, 3));
  group.add(new T.LineSegments(wireGeometry, ctx.paint(new T.LineBasicMaterial(), opts.token)));
  if (opts.fill) {
    const positions = new Float32Array(nx * nz * 3);
    for (let r = 0; r < nz; r += 1) {
      for (let c = 0; c < nx; c += 1) {
        const i = (r * nx + c) * 3;
        positions[i] = xs[c];
        positions[i + 1] = heights[r][c];
        positions[i + 2] = zs[r];
      }
    }
    /** @type {number[]} */
    const index = [];
    for (let r = 0; r + 1 < nz; r += 1) {
      for (let c = 0; c + 1 < nx; c += 1) {
        const a = r * nx + c;
        index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    }
    const fillGeometry = new T.BufferGeometry();
    fillGeometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    fillGeometry.setIndex(index);
    const material = ctx.paint(new T.MeshBasicMaterial({
      side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }), opts.fill);
    group.add(new T.Mesh(fillGeometry, material));
  }
  return group;
}

/**
 * Stems from a base to a tip, one segment each, in one draw call.
 * @param {ThreeContext} ctx
 * @param {{x: number, y0: number, y1: number, z: number}[]} items scene units
 * @param {{token: string}} opts
 * @returns {import("three").LineSegments}
 */
export function stems(ctx, items, opts) {
  const T = ctx.three;
  const positions = new Float32Array(items.length * 6);
  items.forEach(({ x, y0, y1, z }, i) => {
    positions.set([x, y0, z, x, y1, z], i * 6);
  });
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  return new T.LineSegments(geometry, ctx.paint(new T.LineBasicMaterial(), opts.token));
}

/**
 * The frame a box sits in: a grid on the floor (y = min) and on the back
 * wall (z = min), each optional, and the three axes along the box's front
 * bottom left edges. Grid lines fall on the given scene coordinates.
 * @param {ThreeContext} ctx
 * @param {SceneBox} box
 * @param {{xs?: number[], ys?: number[], zs?: number[], floor?: boolean, back?: boolean,
 *          grid?: string, axis?: string}} [opts] grid lines in scene units;
 *        tokens default to --ambe-plot-grid and --ambe-plot-axis
 * @returns {import("three").Group}
 */
export function axisFrame(ctx, box, opts = {}) {
  const T = ctx.three;
  const { xs = [], ys = [], zs = [], floor = true, back = true } = opts;
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  /** @type {number[]} */
  const grid = [];
  if (floor) {
    for (const x of xs) grid.push(x, y0, z0, x, y0, z1);
    for (const z of zs) grid.push(x0, y0, z, x1, y0, z);
  }
  if (back) {
    for (const x of xs) grid.push(x, y0, z0, x, y1, z0);
    for (const y of ys) grid.push(x0, y, z0, x1, y, z0);
  }
  const group = new T.Group();
  if (grid.length) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(grid), 3));
    group.add(new T.LineSegments(geometry, ctx.paint(new T.LineBasicMaterial(), opts.grid ?? "--ambe-plot-grid")));
  }
  const axes = new T.BufferGeometry();
  axes.setAttribute("position", new T.BufferAttribute(new Float32Array([
    x0, y0, z1, x1, y0, z1, // x, front bottom
    x0, y0, z1, x0, y1, z1, // y, front left
    x0, y0, z0, x0, y0, z1, // z, bottom left
  ]), 3));
  group.add(new T.LineSegments(axes, ctx.paint(new T.LineBasicMaterial(), opts.axis ?? "--ambe-plot-axis")));
  return group;
}
