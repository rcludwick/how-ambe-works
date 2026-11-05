// @ts-check
/* ===========================================================================
 * lib/fec.js: the arithmetic of the fec-protection figure (ch10, plan N6).
 * ---------------------------------------------------------------------------
 * US 5,870,405 protects the eight priority vectors of a 7.2 kbps IMBE frame
 * unequally: u0 to u3 (12 bits each) with Golay (23,12) codes, u4 to u6
 * (11 bits each) with Hamming (15,11) codes, and u7 (7 bits) with nothing,
 * 144 bits in all. This module counts what happens to those vectors:
 *
 *   - failProb(): the chance that a vector arrives wrong when every bit is
 *     wrong with probability p, independently (the binomial tail past the
 *     code's correction radius t);
 *   - burstResult(): where a burst of adjacent errors on the air lands,
 *     through the identity order or the illustrative interleaver, and
 *     which vectors it overruns;
 *   - cosetMean(): how many corrections a perfect code's decoder counts on
 *     a random word (the u0 key chain: a wrong key leaves u1 to u6 random).
 *
 * It counts errors and positions only. It holds no generator matrix, no
 * code table, no quantizer and no frame data, and it decodes nothing.
 *
 * The interleaver is invented for the figure. D-STAR's is not published;
 * this one only shares the patent's stated property, that any two bits of
 * one codeword are at least 6 positions apart (fec-protection-lib.spec.js
 * checks it by brute force). A second one does the same for the 88 bits
 * that go out when no code is used.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** @typedef {"patent" | "none"} CodeMode */

/**
 * @typedef {Object} Code
 * @property {string} name  "Golay (23,12)"
 * @property {string} short  "Golay", or "Bare" with no code
 * @property {number} n  bits sent
 * @property {number} k  payload bits
 * @property {number} t  errors it corrects
 */

/** @type {Readonly<Record<"golay" | "hamming", Code>>} */
export const CODES = Object.freeze({
  golay: { name: "Golay (23,12)", short: "Golay", n: 23, k: 12, t: 3 },
  hamming: { name: "Hamming (15,11)", short: "Hamming", n: 15, k: 11, t: 1 },
});

/**
 * The eight priority vectors (US 5,870,405): their payload and the code the
 * patent gives each. `group` is the curve they share: 0 for u0 to u3, 1 for
 * u4 to u6, 2 for u7.
 * @type {readonly {name: string, payload: number, code: "golay" | "hamming" | null, group: number}[]}
 */
export const VECTORS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
  name: `u${"₀₁₂₃₄₅₆₇"[i]}`,
  payload: i < 4 ? 12 : i < 7 ? 11 : 7,
  code: /** @type {"golay" | "hamming" | null} */ (i < 4 ? "golay" : i < 7 ? "hamming" : null),
  group: i < 4 ? 0 : i < 7 ? 1 : 2,
})));

/** Bits on the air per frame: 144 with the patent's codes, 88 without. */
export const FRAME_BITS = Object.freeze({ patent: 144, none: 88 });

/**
 * What vector `v` is sent as under `mode`.
 * @param {number} v
 * @param {CodeMode} mode
 * @returns {Code}
 */
export function vectorCode(v, mode) {
  const vector = VECTORS[v];
  if (mode === "patent" && vector.code) return CODES[vector.code];
  return { name: "no code", short: "Bare", n: vector.payload, k: vector.payload, t: 0 };
}

/**
 * The code of curve `group` (0, 1, 2) under `mode`: the one its vectors share.
 * @param {number} group
 * @param {CodeMode} mode
 */
export function groupCode(group, mode) {
  return vectorCode([0, 4, 7][group], mode);
}

/** @param {number} n @param {number} k */
function choose(n, k) {
  let c = 1;
  for (let i = 1; i <= k; i += 1) c = (c * (n - k + i)) / i;
  return c;
}

/**
 * The chance that an n-bit word with t correctable errors arrives wrong when
 * each bit is wrong with probability p, independently: more than t errors.
 * Summed as the tail, so tiny values keep their precision.
 * @param {number} n
 * @param {number} t
 * @param {number} p
 * @returns {number}
 */
export function failProb(n, t, p) {
  if (p <= 0) return 0;
  if (p >= 1) return t < n ? 1 : 0;
  let sum = 0;
  for (let e = t + 1; e <= n; e += 1) sum += choose(n, e) * p ** e * (1 - p) ** (n - e);
  return Math.min(1, sum);
}

/**
 * The corrections a decoder for a perfect code counts, on average, on a
 * word that is random (a wrong descrambling key leaves u1 to u6 so): the
 * mean weight of the coset leaders, sum over w of w C(n, w), divided by the
 * 2^(n-k) cosets. Golay (23,12): (23 + 2 x 253 + 3 x 1771) / 2048 = 2.85.
 * Hamming (15,11): 15 / 16 = 0.94.
 * @param {Code} code
 * @returns {number}
 */
export function cosetMean(code) {
  let sum = 0;
  for (let w = 1; w <= code.t; w += 1) sum += w * choose(code.n, w);
  return sum / 2 ** (code.n - code.k);
}

/**
 * The illustrative interleaver of the 144-bit frame: the vector each
 * position on the air carries, in transmitted order. A vector's bits go out
 * in their own order, so its j-th appearance here is its bit j. Invented
 * for the figure (D-STAR's is not published); any two bits of one vector
 * are at least 6 positions apart, as US 5,870,405 states of its own.
 */
export const INTERLEAVER =
  "032154672105342601352406153240153240615237014263015263015423016423016523071423051623401623401623571023451023671043261073542103562103562103742103";

/** The same for the 88 bits sent with no code, at the same separation. */
export const INTERLEAVER_BARE =
  "1032457630214537621045637024135076215346012345601325407132645102734561023546172056134206";

/** The patent's stated minimum separation of two bits of one codeword. */
export const MIN_SEPARATION = 6;

/** @typedef {{v: number, j: number}} Slot  vector v's bit j */

/**
 * Which vector bit each position on the air carries. Without interleaving
 * the vectors go out one after another, u0 first.
 * @param {CodeMode} mode
 * @param {boolean} interleave
 * @returns {Slot[]}
 */
export function airOrder(mode, interleave) {
  /** @type {Slot[]} */
  const out = [];
  if (interleave) {
    const seen = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const c of mode === "patent" ? INTERLEAVER : INTERLEAVER_BARE) {
      const v = Number(c);
      out.push({ v, j: seen[v] });
      seen[v] += 1;
    }
    return out;
  }
  for (let v = 0; v < 8; v += 1) {
    const { n } = vectorCode(v, mode);
    for (let j = 0; j < n; j += 1) out.push({ v, j });
  }
  return out;
}

/**
 * The smallest distance between two positions of one vector, over the
 * whole frame (brute force).
 * @param {Slot[]} order
 * @returns {number}
 */
export function minSeparation(order) {
  let best = Infinity;
  for (let a = 0; a < order.length; a += 1) {
    for (let b = a + 1; b < order.length; b += 1) {
      if (order[a].v === order[b].v) best = Math.min(best, b - a);
    }
  }
  return best;
}

/**
 * @typedef {Object} VectorResult
 * @property {number} e  errors the burst put in it
 * @property {number[]} bits  which of its bits (j)
 * @property {Code} code
 * @property {boolean} fails  more errors than the code corrects
 * @property {number} counted  corrections its decoder counts: e when it
 *           can fix them; t when it cannot (a perfect code moves the word
 *           to the nearest wrong codeword, at most t away); with a wrong
 *           key, the coset mean of a random word (u1 to u6); 0 for u7
 * @property {boolean} random  a wrong key left it a random word
 */

/**
 * @typedef {Object} BurstResult
 * @property {CodeMode} mode
 * @property {boolean} interleave
 * @property {number} start  first errored position, clamped to the frame
 * @property {number} length  the burst, clamped to the frame
 * @property {number} frameBits
 * @property {Slot[]} order  airOrder(mode, interleave)
 * @property {{pos: number, v: number, j: number}[]} errors  in transmitted order
 * @property {VectorResult[]} vectors
 * @property {boolean} wrongKey  u0 overrun with the patent's codes: the
 *           descrambling key for u1 to u6 is wrong
 * @property {number} counted  corrections counted in u1 to u6
 * @property {number} countedMax  the most u1 to u6 can count (12)
 * @property {number} subject  the vector with the most errors (ties: the
 *           one that fails, then the most important)
 */

/**
 * Where a burst of `length` adjacent errors from position `start` lands.
 * @param {{mode: CodeMode, interleave: boolean, start: number, length: number}} burst
 * @returns {BurstResult}
 */
export function burstResult({ mode, interleave, start, length }) {
  const order = airOrder(mode, interleave);
  const frameBits = order.length;
  const b = Math.max(0, Math.min(frameBits, Math.round(length)));
  const s = Math.max(0, Math.min(frameBits - b, Math.round(start)));
  const errors = order.slice(s, s + b).map((slot, i) => ({ pos: s + i, ...slot }));
  const vectors = VECTORS.map((_, v) => {
    const bits = errors.filter((x) => x.v === v).map((x) => x.j);
    const code = vectorCode(v, mode);
    const e = bits.length;
    return { e, bits, code, fails: e > code.t, counted: Math.min(e, code.t), random: false };
  });
  const wrongKey = mode === "patent" && vectors[0].fails;
  if (wrongKey) {
    for (let v = 1; v <= 6; v += 1) {
      vectors[v].counted = cosetMean(vectors[v].code);
      vectors[v].random = true;
    }
  }
  let counted = 0;
  let countedMax = 0;
  for (let v = 1; v <= 6; v += 1) {
    counted += vectors[v].counted;
    countedMax += vectors[v].code.t;
  }
  let subject = 0;
  vectors.forEach((r, v) => {
    const best = vectors[subject];
    if (r.e > best.e || (r.e === best.e && r.fails && !best.fails)) subject = v;
  });
  return { mode, interleave, start: s, length: b, frameBits, order, errors, vectors, wrongKey, counted, countedMax, subject };
}

/**
 * "1 error" or "2 errors".
 * @param {number} e
 */
export const errorsText = (e) => `${e} error${e === 1 ? "" : "s"}`;

/**
 * The subject's chip: "Hamming u4: 2 errors, corrects 1".
 * @param {BurstResult} r
 * @returns {string}
 */
export function chipText(r) {
  const v = r.vectors[r.subject];
  return `${v.code.short} ${VECTORS[r.subject].name}: ${errorsText(v.e)}, corrects ${v.code.t}`;
}

/**
 * The failure curve of a code over bit error rates 0 to pMax, as [p, P]
 * pairs, cut where P falls below `floor` (the log axis's bottom), with the
 * crossing found on the way so the curve starts on the axis.
 * @param {Code} code
 * @param {number} pMax
 * @param {number} floor
 * @param {number} [count=161]
 * @returns {[number, number][]}
 */
export function failCurve(code, pMax, floor, count = 161) {
  /** @type {[number, number][]} */
  const out = [];
  let prev = null;
  for (let i = 0; i < count; i += 1) {
    const p = (pMax * i) / (count - 1);
    const P = failProb(code.n, code.t, p);
    if (P >= floor) {
      if (!out.length && prev) {
        // Bisect for P = floor between the last point below and this one.
        let lo = prev;
        let hi = p;
        for (let k = 0; k < 40; k += 1) {
          const mid = (lo + hi) / 2;
          if (failProb(code.n, code.t, mid) < floor) lo = mid;
          else hi = mid;
        }
        out.push([hi, floor]);
      }
      out.push([p, P]);
    }
    prev = p;
  }
  return out;
}
