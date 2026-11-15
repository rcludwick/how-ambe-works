// @ts-check
/* ===========================================================================
 * lib/picks.js: frames chosen by a named criterion, never by index
 * (design §2, frame-selection rule). tools/verify-data.py holds the same
 * rules in Python and checks every clip a chapter offers.
 *
 * steadyScore uses only fields measured on the chip's decoded audio, so it
 * mixes no provenances. Ties keep frame order.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/**
 * @param {FrameRecord} f
 * @returns {number}
 */
export function steadyScore(f) {
  return f.derived.decoded_f0_confidence * Math.min(...f.derived.band_voicing.slice(0, 6));
}

/**
 * @param {FrameRecord[]} frames
 * @returns {FrameRecord[]} best first
 */
export function rankSteady(frames) {
  return [...frames].sort((a, b) => steadyScore(b) - steadyScore(a) || a.i - b.i);
}

/**
 * @param {FrameRecord[]} frames
 * @param {number} n
 * @returns {FrameRecord[]}
 */
export function topSteady(frames, n) {
  return rankSteady(frames).slice(0, n);
}

/**
 * The best n by steadyScore among frames the input pitch tracker gave an
 * f0 (orig_f0_hz > 0): the frames a figure that draws harmonics of the
 * input's f0 can offer. tools/verify-data.py checks the same set
 * ("steady-pitched").
 * @param {FrameRecord[]} frames
 * @param {number} n
 * @returns {FrameRecord[]}
 */
export function topSteadyPitched(frames, n) {
  return topSteady(frames.filter((f) => f.derived.orig_f0_hz > 0), n);
}

/** @param {FrameRecord} f */
const voicedBands = (f) => f.derived.band_voiced.filter(Boolean).length;

/** @type {Readonly<Record<"vowel" | "default" | "mixed" | "fricative" | "silence", (frames: FrameRecord[]) => FrameRecord | null>>} */
export const PICKS = Object.freeze({
  vowel: (frames) => rankSteady(frames)[0] ?? null,
  default: (frames) => rankSteady(frames)[1] ?? null,
  mixed: (frames) =>
    frames
      .filter((f) => voicedBands(f) >= 3 && f.derived.band_voiced.length - voicedBands(f) >= 2)
      .sort((a, b) => b.derived.decoded_f0_confidence - a.derived.decoded_f0_confidence || a.i - b.i)[0] ?? null,
  fricative: (frames) =>
    frames
      .filter((f) => voicedBands(f) === 0 && f.derived.orig_rms_dbfs > -40)
      .sort((a, b) => b.derived.orig_rms_dbfs - a.derived.orig_rms_dbfs || a.i - b.i)[0] ?? null,
  silence: (frames) =>
    [...frames].sort((a, b) => a.derived.orig_rms_dbfs - b.derived.orig_rms_dbfs || a.i - b.i)[0] ?? null,
});

/* One block per figure that adds its own criteria (three-everywhere plan).
 * PICKS is frozen and typed for the frame pickers above, so a criterion
 * with another shape (a run of frames, say) is an export of its own inside
 * its figure's block. tools/verify-data.py mirrors each in its block. */

/* slot: utterance-spectra */
/* Windows of one clip's spectra.json chosen by where their power sits
 * (three-everywhere design §4.3), for the utterance-spectra figure. A
 * criterion takes the clip's `original` spectra ([window][bin], dB) and the
 * bin centres in Hz, and returns a window index or null. Only windows above
 * SPECTRA_GATE_DBFS in total count: a silent window's flat floor puts its
 * power right at the split, so without the gate silence would be picked.
 * Of the windows that qualify, the loudest wins; ties keep window order.
 * tools/verify-data.py holds the same rules. */

/** Total power under which a window counts as silence, dBFS. */
export const SPECTRA_GATE_DBFS = -60;

/**
 * A window's total power in dBFS: its bins summed as power, not as dB.
 * @param {ArrayLike<number>} bins dB
 * @returns {number}
 */
export function totalDb(bins) {
  let power = 0;
  for (let i = 0; i < bins.length; i += 1) power += 10 ** (bins[i] / 10);
  return 10 * Math.log10(power || 1e-12);
}

/**
 * The loudest gated window whose share of power in `inBand` bins is over half.
 * @param {(hz: number) => boolean} inBand
 * @returns {(frames: number[][], hz: number[]) => number | null}
 */
const heavy = (inBand) => (frames, hz) => {
  let best = null;
  let loudest = -Infinity;
  frames.forEach((bins, i) => {
    const total = totalDb(bins);
    if (total <= SPECTRA_GATE_DBFS || total <= loudest) return;
    let all = 0;
    let part = 0;
    bins.forEach((db, k) => {
      const p = 10 ** (db / 10);
      all += p;
      if (inBand(hz[k])) part += p;
    });
    if (part > all / 2) {
      best = i;
      loudest = total;
    }
  });
  return best;
};

/** @type {Readonly<Record<"low-heavy" | "high-heavy", (frames: number[][], hz: number[]) => number | null>>} */
export const SPECTRA_PICKS = Object.freeze({
  "low-heavy": heavy((hz) => hz < 1000),
  "high-heavy": heavy((hz) => hz >= 2000),
});
/* end slot: utterance-spectra */

/* slot: envelope */
/**
 * A frame the envelope figure draws harmonics on: voiced, with an input f0
 * the tracker is at least 60% sure of, and louder than -32 dBFS (all
 * measured on the input audio, so the test mixes no provenances).
 * @param {FrameRecord} f
 * @returns {boolean}
 */
export const strongVoiced = (f) =>
  f.derived.voiced && f.derived.orig_f0_hz > 0 && f.derived.orig_f0_confidence >= 0.6 && f.derived.orig_rms_dbfs > -32;

/**
 * "voiced-stretch" (ch09 envelope): the longest run of consecutive
 * strongVoiced frames (the first, on a tie), and in it the frame the input
 * pitch tracker is surest of (the first, on a tie). On lr-b: frames 95 to
 * 124, frame 112. tools/verify-data.py mirrors it.
 * @param {FrameRecord[]} frames
 * @returns {{run: [number, number], frame: number} | null} frame indices
 */
export function voicedStretch(frames) {
  /** @type {[number, number] | null} */
  let best = null;
  let start = -1;
  for (let k = 0; k <= frames.length; k += 1) {
    if (k < frames.length && strongVoiced(frames[k])) {
      if (start < 0) start = k;
      continue;
    }
    if (start >= 0 && (!best || k - 1 - start > best[1] - best[0])) best = [start, k - 1];
    start = -1;
  }
  if (!best) return null;
  let frame = best[0];
  for (let k = best[0]; k <= best[1]; k += 1) {
    if (frames[k].derived.orig_f0_confidence > frames[frame].derived.orig_f0_confidence) frame = k;
  }
  return { run: [frames[best[0]].i, frames[best[1]].i], frame: frames[frame].i };
}

/** The envelope figure's criteria, by the name a step's data-pick gives. */
export const ENVELOPE_PICKS = Object.freeze({ "voiced-stretch": voicedStretch });
/* end slot: envelope */

/* slot: gain-definitions */
/**
 * One voiced frame's two gain definitions, for the gain-definitions figure
 * (ch13). anim-gain-definitions.js computes them from the chip's decoded
 * audio; tools/gain-stats.py does the same in Python.
 * @typedef {Object} GainFrame
 * @property {string} clip
 * @property {number} order  the clip's place in clips.json, 0 to 7
 * @property {number} i  the frame's index in its clip
 * @property {number} sigma  spread of the harmonic levels, dB
 * @property {number} gap  log of mean energy minus mean of logs, dB
 */

/** Two frames whose spreads differ by at most this (dB) count as equal. */
export const GAIN_SPREAD_TOLERANCE = 0.25;

/**
 * @template {GainFrame} F
 * @param {F} a
 * @param {F} b
 */
const bySpread = (a, b) => a.sigma - b.sigma || a.order - b.order || a.i - b.i;

/**
 * "flattest" (lowest spread) and "steepest" (highest), among the frames
 * offered. Ties keep clip order, then frame order.
 */
export const GAIN_PICKS = Object.freeze({
  /** @template {GainFrame} F @param {F[]} frames @returns {F | null} */
  flattest: (frames) => [...frames].sort(bySpread)[0] ?? null,
  /** @template {GainFrame} F @param {F[]} frames @returns {F | null} */
  steepest: (frames) => [...frames].sort(bySpread).at(-1) ?? null,
});

/**
 * "equal-spread": of every two frames whose spreads differ by at most
 * GAIN_SPREAD_TOLERANCE, the two whose gaps differ most. `frame` is the
 * one with the larger gap. The first such pair in spread order wins a tie.
 * @template {GainFrame} F
 * @param {F[]} frames
 * @returns {{frame: F, partner: F} | null}
 */
export function equalSpreadPair(frames) {
  const sorted = [...frames].sort(bySpread);
  /** @type {{frame: F, partner: F} | null} */
  let best = null;
  let most = -1;
  for (let a = 0; a < sorted.length; a += 1) {
    for (let b = a + 1; b < sorted.length && sorted[b].sigma - sorted[a].sigma <= GAIN_SPREAD_TOLERANCE; b += 1) {
      const d = Math.abs(sorted[a].gap - sorted[b].gap);
      if (d > most) {
        most = d;
        const [hi, lo] = sorted[a].gap >= sorted[b].gap ? [sorted[a], sorted[b]] : [sorted[b], sorted[a]];
        best = { frame: hi, partner: lo };
      }
    }
  }
  return best;
}
/* end slot: gain-definitions */
