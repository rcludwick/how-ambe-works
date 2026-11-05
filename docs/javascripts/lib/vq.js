// @ts-check
/* ===========================================================================
 * lib/vq.js: generic vector quantisation on synthetic dots, for vq-space.
 * ---------------------------------------------------------------------------
 * A seeded cloud, a scalar grid, and a codebook trained by Lloyd steps.
 * Nothing here comes from AMBE: no table, no dimension, no bit allocation
 * (design §2.2, Q0). The codebook starts on the grid, so the reader watches
 * the grid turn into a codebook.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { gaussian, mulberry32 } from "./prng.js";

export const CLOUD_SEED = 0x20260810;
export const CLOUD_SIZE = 1200;
const CENTRES = [[-0.42, -0.18], [0.08, 0.32], [0.4, -0.28]];
const SPREAD = 0.13;

/**
 * @typedef {Object} Codebook
 * @property {Float32Array} codebook K × dims
 * @property {Uint16Array} assign    entry index per point
 */

/** @param {number} v */
const clamp = (v) => Math.max(-1, Math.min(1, v));

/**
 * Three seeded Gaussian blobs, squeezed across an axis at angleDeg by
 * (1 - rho). Points are [x, y, z]: the 2-number view uses x and y, and z
 * is a third number that follows them more closely as rho rises. Every
 * coordinate is clamped to [-1, 1].
 * @param {{rho: number, angleDeg: number}} shape rho 0..0.95, angle 0..90
 * @returns {Float32Array} CLOUD_SIZE × 3
 */
export function makeCloud({ rho, angleDeg }) {
  const g = gaussian(mulberry32(CLOUD_SEED));
  const out = new Float32Array(CLOUD_SIZE * 3);
  const th = (angleDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const squeeze = 1 - rho;
  for (let i = 0; i < CLOUD_SIZE; i += 1) {
    const [cx, cy] = CENTRES[i % 3];
    const x = cx + SPREAD * g();
    const y = cy + SPREAD * g();
    const n = g();
    const along = x * c + y * s;
    const across = (-x * s + y * c) * squeeze;
    const qx = along * c - across * s;
    const qy = along * s + across * c;
    out[i * 3] = clamp(qx);
    out[i * 3 + 1] = clamp(qy);
    out[i * 3 + 2] = clamp(0.6 * (qx + qy) * 0.5 + 0.35 * squeeze * n);
  }
  return out;
}

/**
 * @param {Float32Array} pts
 * @param {number} dims
 * @param {number} i
 * @param {Float32Array} cb
 * @param {number} k
 */
function dist2(pts, dims, i, cb, k) {
  let d = 0;
  for (let j = 0; j < dims; j += 1) {
    const e = pts[i * 3 + j] - cb[k * dims + j];
    d += e * e;
  }
  return d;
}

/**
 * The scalar grid: bits / dims bits per number, levels at the cell
 * midpoints of [-1, 1].
 * @param {Float32Array} pts
 * @param {number} dims 2 or 3
 * @param {number} bits a multiple of dims
 * @returns {{mse: number, cells: number, empty: number, used: Uint32Array}}
 */
export function gridQuantize(pts, dims, bits) {
  const m = 2 ** (bits / dims);
  const used = new Uint32Array(m ** dims);
  let err = 0;
  for (let i = 0; i < CLOUD_SIZE; i += 1) {
    let cell = 0;
    for (let j = 0; j < dims; j += 1) {
      const v = pts[i * 3 + j];
      const q = Math.min(m - 1, Math.floor(((v + 1) / 2) * m));
      err += (v - (-1 + (2 * q + 1) / m)) ** 2;
      cell = cell * m + q;
    }
    used[cell] += 1;
  }
  let empty = 0;
  for (const u of used) if (!u) empty += 1;
  return { mse: err / (CLOUD_SIZE * dims), cells: m ** dims, empty, used };
}

/**
 * @param {Float32Array} pts
 * @param {number} dims
 * @param {Float32Array} cb
 * @param {Uint16Array} assign
 * @returns {boolean} whether any assignment changed
 */
function assignAll(pts, dims, cb, assign) {
  const K = cb.length / dims;
  let changed = false;
  for (let i = 0; i < CLOUD_SIZE; i += 1) {
    let bk = 0;
    let bd = Infinity;
    for (let k = 0; k < K; k += 1) {
      const d = dist2(pts, dims, i, cb, k);
      if (d < bd) {
        bd = d;
        bk = k;
      }
    }
    if (assign[i] !== bk) {
      assign[i] = bk;
      changed = true;
    }
  }
  return changed;
}

/**
 * A codebook that starts as the grid: one entry on each cell's
 * reconstruction point, in cell order.
 * @param {Float32Array} pts
 * @param {number} dims
 * @param {number} bits
 * @returns {Codebook}
 */
export function gridCodebook(pts, dims, bits) {
  const m = 2 ** (bits / dims);
  const K = m ** dims;
  const cb = new Float32Array(K * dims);
  for (let k = 0; k < K; k += 1) {
    let rest = k;
    for (let j = dims - 1; j >= 0; j -= 1) {
      const q = rest % m;
      rest = Math.floor(rest / m);
      cb[k * dims + j] = -1 + (2 * q + 1) / m;
    }
  }
  const assign = new Uint16Array(CLOUD_SIZE);
  assignAll(pts, dims, cb, assign);
  return { codebook: cb, assign };
}

/**
 * One Lloyd step: each entry moves to the mean of its points; an entry no
 * point chose moves onto the point served worst (lowest index on a tie), so
 * every entry ends up used; then every point is reassigned.
 * @param {Float32Array} pts
 * @param {number} dims
 * @param {Codebook} state changed in place
 * @returns {boolean} whether any assignment changed
 */
export function lloydStep(pts, dims, state) {
  const { codebook: cb, assign } = state;
  const K = cb.length / dims;
  const sum = new Float64Array(K * dims);
  const count = new Uint32Array(K);
  for (let i = 0; i < CLOUD_SIZE; i += 1) {
    const k = assign[i];
    count[k] += 1;
    for (let j = 0; j < dims; j += 1) sum[k * dims + j] += pts[i * 3 + j];
  }
  for (let k = 0; k < K; k += 1) {
    if (count[k]) for (let j = 0; j < dims; j += 1) cb[k * dims + j] = sum[k * dims + j] / count[k];
  }
  const taken = new Uint8Array(CLOUD_SIZE);
  for (let k = 0; k < K; k += 1) {
    if (count[k]) continue;
    let worst = -1;
    let wd = -1;
    for (let i = 0; i < CLOUD_SIZE; i += 1) {
      if (taken[i]) continue;
      const d = dist2(pts, dims, i, cb, assign[i]);
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    taken[worst] = 1;
    for (let j = 0; j < dims; j += 1) cb[k * dims + j] = pts[worst * 3 + j];
  }
  return assignAll(pts, dims, cb, assign);
}

/**
 * Lloyd steps until no assignment changes, at most maxSteps.
 * @param {Float32Array} pts
 * @param {number} dims
 * @param {Codebook} state
 * @param {number} [maxSteps=20]
 * @returns {number} steps taken
 */
export function train(pts, dims, state, maxSteps = 20) {
  let steps = 0;
  while (steps < maxSteps) {
    steps += 1;
    if (!lloydStep(pts, dims, state)) break;
  }
  return steps;
}

/**
 * @param {Float32Array} pts
 * @param {number} dims
 * @param {Codebook} state
 * @returns {{mse: number, cells: number, used: number}}
 */
export function codebookStats(pts, dims, state) {
  const K = state.codebook.length / dims;
  const count = new Uint32Array(K);
  let err = 0;
  for (let i = 0; i < CLOUD_SIZE; i += 1) {
    count[state.assign[i]] += 1;
    err += dist2(pts, dims, i, state.codebook, state.assign[i]);
  }
  let used = 0;
  for (const c of count) if (c) used += 1;
  return { mse: err / (CLOUD_SIZE * dims), cells: K, used };
}

/**
 * The nearest entry to a probe point and its squared error per number.
 * @param {number[]} probe length dims
 * @param {Float32Array} cb
 * @param {number} dims
 * @returns {{k: number, mse: number}}
 */
export function nearest(probe, cb, dims) {
  const K = cb.length / dims;
  let bk = 0;
  let bd = Infinity;
  for (let k = 0; k < K; k += 1) {
    let d = 0;
    for (let j = 0; j < dims; j += 1) d += (probe[j] - cb[k * dims + j]) ** 2;
    if (d < bd) {
      bd = d;
      bk = k;
    }
  }
  return { k: bk, mse: bd / dims };
}

/** The number of colours the cells and entries cycle through. */
export const CATS = 8;

/**
 * A colour category, 0 to CATS - 1, for grid cell (or starting codebook
 * entry) k: a mix of its coordinates in which no two cells that touch,
 * along an edge or at a corner, share a colour. k mod CATS would make
 * neighbours alike once a side has CATS cells.
 * @param {number} k 0-based, in gridQuantize's cell order
 * @param {number} dims 2 or 3
 * @param {number} bits a multiple of dims
 * @returns {number}
 */
export function cellCategory(k, dims, bits) {
  const m = 2 ** (bits / dims);
  /** @type {number[]} */
  const q = [];
  let rest = k;
  for (let j = 0; j < dims; j += 1) {
    q.unshift(rest % m);
    rest = Math.floor(rest / m);
  }
  const [qx, qy, qz = 0] = q;
  return (2 * qx + 5 * qy + 4 * qz) % CATS;
}
