// @ts-check
/* ===========================================================================
 * lib/synth-model.js: one frame's drawing ingredients for the synth figure
 * (ch11), shared by its flat view and its 3D view.
 * ---------------------------------------------------------------------------
 * Generic display DSP on one frame's precomputed values (design §3.13):
 * display sinusoids at multiples of the f0 measured on the chip's decoded
 * audio, levels read off that audio's spectrum, arbitrary phases, and a few
 * noise components in the bands measured unvoiced. There is no MBE
 * synthesizer here: no phase model, no window, no overlap-add, no audio,
 * and nothing that walks a sequence of frames into sound. Nothing reads hex.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

export const BANDS = 8;
/** derived_notes.band_edges_hz: eight 500 Hz bands. */
export const BAND_HZ = 500;
export const NYQUIST = 4000;
/** Display resolution of one 20 ms window. */
export const TRACE_N = 512;
const WINDOW_S = 0.02;
/** Display components that draw one band's noise. */
const NOISE_PER_BAND = 22;
export const DB_FLOOR = -95;
export const DB_TOP = -8;

/**
 * @typedef {Object} SynthFrame  what the figure reads from frames.json
 * @property {{decoded_f0_hz: number, decoded_f0_confidence: number, decoded_rms_dbfs: number,
 *            band_voicing: number[], band_voiced: boolean[]}} derived
 */

/**
 * @typedef {Object} Harmonic
 * @property {number} k  harmonic number
 * @property {number} f  Hz
 * @property {number} band  0 to 7
 * @property {number} amp  linear level read off the spectrum at f
 * @property {boolean} voiced  its band was measured voiced
 */

/**
 * @typedef {Object} NoiseBand
 * @property {number} band
 * @property {number} lo  Hz
 * @property {number} hi  Hz
 * @property {number} amp  linear: 0.8 x the band's highest bin
 */

/**
 * @typedef {Object} FrameModel
 * @property {number} f0  Hz, 0 when no pitch was found
 * @property {boolean[]} voicedBand
 * @property {number[]} bandVoicing
 * @property {number} rms  dBFS
 * @property {number} confidence
 * @property {Harmonic[]} harmonics  every k f0 below 4 kHz, voiced or not
 * @property {NoiseBand[]} noiseBands  the unvoiced bands only
 * @property {NoiseBand[]} bandNoise  all eight bands: the noise each band
 *           would get if it were unvoiced (the 3D view's opening shows both
 *           generators in every band before the choice)
 * @property {Float64Array} voicedTrace
 * @property {Float64Array} noiseTrace
 * @property {number} scale  fills a wave panel with the measured mix
 * @property {number} harmonicCount
 * @property {number} voicedHarmonics
 */

/**
 * xorshift32, so a frame always draws the same way.
 * @param {number} seed
 * @returns {() => number} uniform on [0, 1)
 */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** @param {number} db @returns {number} */
export const dbToLin = (db) => Math.pow(10, db / 20);
/** @param {number} a @returns {number} 20 dB under the floor for silence */
export const linToDb = (a) => (a > 1e-9 ? 20 * Math.log10(a) : DB_FLOOR - 20);

/**
 * Turn one frame's measurements into the ingredients of the drawing: the
 * harmonics, a noise level per unvoiced band, and one 20 ms display trace
 * of each generator.
 * @param {SynthFrame[]} frames
 * @param {{decoded: number[][]}} spectra
 * @param {number} index
 * @returns {FrameModel}
 */
export function buildFrameModel(frames, spectra, index) {
  const d = frames[index].derived;
  const row = spectra.decoded[index];
  const binHz = NYQUIST / row.length;
  const amp = row.map(dbToLin);
  const f0 = d.decoded_f0_hz;
  const voicedBand = d.band_voiced;

  /** @type {Harmonic[]} */
  const harmonics = [];
  if (f0 > 20) {
    for (let k = 1; k * f0 < NYQUIST; k += 1) {
      const f = k * f0;
      const band = Math.min(BANDS - 1, Math.floor(f / BAND_HZ));
      const bin = Math.max(0, Math.min(row.length - 1, Math.round(f / binHz)));
      harmonics.push({ k, f, band, amp: amp[bin], voiced: !!voicedBand[band] });
    }
  }

  /** @type {NoiseBand[]} */
  const bandNoise = [];
  for (let b = 0; b < BANDS; b += 1) {
    const lo = b * BAND_HZ;
    const hi = lo + BAND_HZ;
    let peak = 0;
    for (let i = Math.ceil(lo / binHz); i < hi / binHz && i < amp.length; i += 1) {
      if (amp[i] > peak) peak = amp[i];
    }
    bandNoise.push({ band: b, lo, hi, amp: peak * 0.8 });
  }
  const noiseBands = bandNoise.filter((nb) => !voicedBand[nb.band]);

  /** @type {{voicedTrace: Float64Array, noiseTrace: Float64Array, scale: number} | null} */
  let drawn = null;
  // The traces only when the flat view asks: the 3D view reads 25 frames
  // at a time and draws none of them.
  const traces = () => (drawn ??= frameTraces(harmonics, noiseBands, index));
  return {
    f0,
    voicedBand,
    bandVoicing: d.band_voicing,
    rms: d.decoded_rms_dbfs,
    confidence: d.decoded_f0_confidence,
    harmonics,
    noiseBands,
    bandNoise,
    get voicedTrace() { return traces().voicedTrace; },
    get noiseTrace() { return traces().noiseTrace; },
    get scale() { return traces().scale; },
    harmonicCount: harmonics.length,
    voicedHarmonics: harmonics.filter((h) => h.voiced).length,
  };
}

/**
 * One 20 ms display trace of each generator, and the scale that fills a
 * wave panel with their sum.
 * @param {Harmonic[]} harmonics
 * @param {NoiseBand[]} noiseBands
 * @param {number} index
 */
function frameTraces(harmonics, noiseBands, index) {
  // Display traces over one 20 ms window.
  const phase = rng(1237);
  const phases = harmonics.map(() => phase() * Math.PI * 2);
  const noiseRand = rng(9871 + index * 7919);
  /** @type {{f: number, a: number, p: number}[]} */
  const grains = [];
  for (const nb of noiseBands) {
    for (let j = 0; j < NOISE_PER_BAND; j += 1) {
      grains.push({
        f: nb.lo + noiseRand() * (nb.hi - nb.lo),
        a: nb.amp / Math.sqrt(NOISE_PER_BAND),
        p: noiseRand() * Math.PI * 2,
      });
    }
  }

  const voicedTrace = new Float64Array(TRACE_N);
  const noiseTrace = new Float64Array(TRACE_N);
  for (let n = 0; n < TRACE_N; n += 1) {
    const t = (n / (TRACE_N - 1)) * WINDOW_S;
    let v = 0;
    for (let h = 0; h < harmonics.length; h += 1) {
      if (!harmonics[h].voiced) continue;
      v += harmonics[h].amp * Math.cos(2 * Math.PI * harmonics[h].f * t + phases[h]);
    }
    let u = 0;
    for (const g of grains) u += g.a * Math.cos(2 * Math.PI * g.f * t + g.p);
    voicedTrace[n] = v;
    noiseTrace[n] = u;
  }

  let peak = 1e-9;
  for (let n = 0; n < TRACE_N; n += 1) peak = Math.max(peak, Math.abs(voicedTrace[n] + noiseTrace[n]));

  return { voicedTrace, noiseTrace, scale: 0.92 / peak };
}

/**
 * The gain on each generator at a Mix position: 0 is the noise alone, 50
 * the measured mix (both at 1), 100 the oscillators alone.
 * @param {number} mix 0 to 100
 * @returns {{v: number, u: number}}
 */
export function weights(mix) {
  const u = mix / 100;
  return {
    v: u <= 0.5 ? u * 2 : 1,
    u: u <= 0.5 ? 1 : (1 - u) * 2,
  };
}

/**
 * The change in f0 from the previous frame, and that change as a share of
 * this frame's f0 (divided by the current frame's f0, as the patent's
 * comparison is). When there is no change to give, `missing` says why:
 * "first" (no previous frame), "this" (this frame has no pitch) or
 * "previous" (this frame has one, the frame before it does not).
 * @param {SynthFrame[]} frames
 * @param {number} index
 * @returns {{hz: number, share: number} | {missing: "first" | "this" | "previous"}}
 */
export function pitchChange(frames, index) {
  const now = frames[index].derived.decoded_f0_hz;
  if (!(now > 20)) return { missing: "this" };
  if (index < 1) return { missing: "first" };
  if (!(frames[index - 1].derived.decoded_f0_hz > 20)) return { missing: "previous" };
  const before = frames[index - 1].derived.decoded_f0_hz;
  const hz = now - before;
  return { hz, share: Math.abs(hz) / now };
}

/** Why there is no change to give, as the readout says it. */
const MISSING = {
  first: "none (the first frame)",
  this: "none (a frame without pitch)",
  previous: "none (the previous frame has no pitch)",
};

/**
 * The readout text for pitchChange(): "-11.6 Hz, 10.5% of this frame's".
 * @param {ReturnType<typeof pitchChange>} change
 * @returns {string}
 */
export function pitchChangeText(change) {
  if ("missing" in change) return MISSING[change.missing];
  const hz = Math.round(change.hz * 10) / 10;
  const sign = hz > 0 ? "+" : hz < 0 ? "-" : "";
  return `${sign}${Math.abs(hz).toFixed(1)} Hz, ${(change.share * 100).toFixed(1)}% of this frame's`;
}
