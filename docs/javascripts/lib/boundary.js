// @ts-check
/* ===========================================================================
 * lib/boundary.js: the frame-boundary figure's arithmetic (ch11), pure.
 * ---------------------------------------------------------------------------
 * Two synthetic frames 20 ms apart: the old one at 120 Hz, the new one at
 * 120 Hz plus the pitch change (5% by default, so 126 Hz), harmonics 1 to
 * 16, every one voiced and of equal amplitude 1. Across the 20 ms between
 * them each harmonic l is drawn by one of three rules, each in closed form
 * in (l, t, the rule):
 *
 *   switch     the old oscillator up to 10 ms, the new one after it
 *   crossfade  the old oscillator at the old frequency weighted 1 - w, the
 *              new one at the new frequency weighted w, w = t / 20 ms
 *              (linear, complementary weights; US 5,701,390 calls its
 *              synthesis window "essentially equivalent to using linear
 *              interpolation")
 *   sweep      one oscillator whose frequency moves linearly from the old
 *              to the new, its phase continuous from the old oscillator
 *
 * and, for the last step, a voiced to unvoiced handover: the old oscillator
 * weighted 1 - w and noise weighted w. Its level is the expected one,
 * sqrt((1 - w)^2 + w^2), because the powers of uncorrelated sources add;
 * no noise is generated.
 *
 * Both oscillators of a crossfade start in phase at t = 0, an illustrative
 * choice. Their phase difference then grows as 2 pi l (f1 - f0) t, so the
 * envelope of the crossfade at the midpoint is |cos(pi l (f1 - f0) T / 2)|:
 * 0.98 at l = 1, 0.73 at l = 4 and 0.06 at l = 8 for 120 to 126 Hz. The
 * sweep makes no claim about the phase at the far end, and nothing here
 * regenerates phase. Nothing is read from a file: no frames, no audio.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/** The old frame's fundamental, Hz. */
export const F_OLD = 120;
/** The interval between the two frames, ms. */
export const T_MS = 20;
/** Harmonics drawn, 1 to LANES. */
export const LANES = 16;
/** The patent's harmonic gate: one swept oscillator only below it. */
export const GATE_L = 8;
/** The patent's pitch gate: a change under 10% of the new fundamental. */
export const GATE_CHANGE = 0.1;
/** The default pitch change: 120 to 126 Hz. */
export const CHANGE = 0.05;
/** Lanes drawn with their carrier as well as their envelope. */
export const CARRIERS = 4;
/** The lanes that go from voiced to unvoiced in the last step. */
export const HANDOVER = Object.freeze([9, 10, 11, 12]);
/** Samples across the 20 ms (every 1/16 ms). */
export const SAMPLES = 321;

/** @typedef {"switch" | "crossfade" | "sweep" | "handover"} LaneMode */
/**
 * What the figure applies to every lane: one rule everywhere, the
 * patent's gated rule, or the gated rule with lanes 9 to 12 turning
 * unvoiced.
 * @typedef {"switch" | "crossfade" | "rule" | "handover"} Scheme
 */

/** @type {readonly Scheme[]} */
export const SCHEMES = Object.freeze(["switch", "crossfade", "rule", "handover"]);

/** @param {number} change the pitch change, a fraction @returns {number} Hz */
export const newF0 = (change) => F_OLD * (1 + change);

/**
 * The patent's gate: the change measured against the new frame's
 * fundamental, |w0(0) - w0(-S)| < .1 w0(0) (US 5,701,390).
 * @param {number} change
 * @returns {boolean}
 */
export const gateOpen = (change) => Math.abs(newF0(change) - F_OLD) < GATE_CHANGE * newF0(change);

/**
 * The rule harmonic l follows under a scheme.
 * @param {number} l
 * @param {Scheme} scheme
 * @param {number} change
 * @returns {LaneMode}
 */
export function laneMode(l, scheme, change) {
  if (scheme === "switch" || scheme === "crossfade") return scheme;
  if (scheme === "handover" && HANDOVER.includes(l)) return "handover";
  return l < GATE_L && gateOpen(change) ? "sweep" : "crossfade";
}

/**
 * The two weights at t: the old frame's falls from 1 to 0 as the new one's
 * rises, and they always sum to 1.
 * @param {number} tMs
 * @returns {{old: number, new: number}}
 */
export function weights(tMs) {
  const w = Math.min(1, Math.max(0, tMs / T_MS));
  return { old: 1 - w, new: w };
}

/** @param {number} l @param {number} f Hz @param {number} tMs @returns {number} radians */
const phase = (l, f, tMs) => 2 * Math.PI * l * f * (tMs / 1000);

/**
 * Harmonic l's envelope at t, the level its waveform swings between.
 * @param {LaneMode} mode
 * @param {number} l
 * @param {number} tMs
 * @param {number} change
 * @returns {number}
 */
export function envelope(mode, l, tMs, change) {
  const { old: a, new: b } = weights(tMs);
  if (mode === "handover") return Math.sqrt(a * a + b * b);
  if (mode !== "crossfade") return 1;
  const d = phase(l, newF0(change) - F_OLD, tMs);
  return Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(d)));
}

/**
 * Harmonic l's waveform at t. For a handover only the oscillator's part is
 * returned: the noise is not drawn.
 * @param {LaneMode} mode
 * @param {number} l
 * @param {number} tMs
 * @param {number} change
 * @returns {number}
 */
export function carrier(mode, l, tMs, change) {
  const f1 = newF0(change);
  const { old: a, new: b } = weights(tMs);
  if (mode === "switch") return Math.cos(phase(l, tMs < T_MS / 2 ? F_OLD : f1, tMs));
  if (mode === "crossfade") return a * Math.cos(phase(l, F_OLD, tMs)) + b * Math.cos(phase(l, f1, tMs));
  if (mode === "handover") return a * Math.cos(phase(l, F_OLD, tMs));
  // sweep: instantaneous frequency l (f0 + (f1 - f0) t / T), phase from 0
  const t = tMs / 1000;
  const T = T_MS / 1000;
  return Math.cos(2 * Math.PI * l * (F_OLD * t + ((f1 - F_OLD) * t * t) / (2 * T)));
}

/**
 * The crossfade's envelope at the midpoint, |cos(pi l (f1 - f0) T / 2)|.
 * @param {number} l
 * @param {number} change
 * @returns {number}
 */
export function midpoint(l, change) {
  return Math.abs(Math.cos((Math.PI * l * (newF0(change) - F_OLD) * (T_MS / 1000)) / 2));
}

/** Sample times across the interval, ms. @returns {Float32Array} */
export function times() {
  const ts = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) ts[i] = (i * T_MS) / (SAMPLES - 1);
  return ts;
}

/**
 * Where a lane's envelope is lowest across the interval (sampled every
 * 1/16 ms), and how far below 1 that is: the depth of its dip.
 * @param {LaneMode} mode
 * @param {number} l
 * @param {number} change
 * @returns {{level: number, tMs: number, depth: number}}
 */
export function deepest(mode, l, change) {
  let level = Infinity;
  let at = 0;
  for (let i = 0; i < SAMPLES; i += 1) {
    const t = (i * T_MS) / (SAMPLES - 1);
    const e = envelope(mode, l, t, change);
    if (e < level - 1e-12) {
      level = e;
      at = t;
    }
  }
  return { level, tMs: at, depth: 1 - level };
}

/**
 * How far a switch at 10 ms jumps harmonic l's phase, in degrees, 0 to 180:
 * the phase difference pi l (f1 - f0) T, wrapped.
 * @param {number} l
 * @param {number} change
 * @returns {number}
 */
export function phaseJump(l, change) {
  const d = (Math.PI * l * (newF0(change) - F_OLD) * (T_MS / 1000)) % (2 * Math.PI);
  const wrapped = Math.abs(d > Math.PI ? d - 2 * Math.PI : d);
  return (wrapped * 180) / Math.PI;
}

/**
 * The expected power of a voiced to unvoiced handover at t, as a share of
 * either frame's: (1 - w)^2 + w^2, half at the midpoint. Complementary
 * amplitude weights hold the sum of the weights at 1, not the power of two
 * uncorrelated sources.
 * @param {number} tMs
 * @returns {number}
 */
export function handoverPower(tMs) {
  const { old: a, new: b } = weights(tMs);
  return a * a + b * b;
}
