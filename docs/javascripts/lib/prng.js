// @ts-check
/* ===========================================================================
 * lib/prng.js: a small seeded generator, so a figure that draws random
 * numbers draws the same ones on every visit and in every screenshot.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/**
 * mulberry32: uniform on [0, 1), from a 32-bit seed.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal draws by Box-Muller, two uniforms per draw.
 * @param {() => number} random
 * @returns {() => number}
 */
export function gaussian(random) {
  return () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}
