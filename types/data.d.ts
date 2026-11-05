// Shapes of the precomputed JSON in docs/assets/data/, per
// docs/assets/data/SCHEMA.md. Declared globally so a JSDoc cast can name
// them without an import:  /** @type {FramesFile} */ (await loadJSON(path))
//
// Provenance: FrameRecord.hex is the only MEASURED field. Everything under
// `derived`, and every spectrum and envelope, is DSP on audio by
// tools/make-data.py.

interface ClipVoice {
  id: string;
  sex: string;
  model: string;
  speaker: string;
  dataset: string;
  dataset_license: string;
  attribution: string;
}

/** The `clip` block of frames.json, spectra.json and waveform.json. */
interface ClipInfo {
  id: string;
  voice: ClipVoice;
  text: string;
  original_audio: string;
  decoded_audio: string;
  channel_frames: string;
  sample_rate_hz: number;
  duration_s: number;
  frame_count: number;
  frame_ms: number;
  frame_samples: number;
  decoded_delay_samples: number;
  decoded_delay_ms: number;
  decoded_delay_correlation: number;
}

interface FrameDerived {
  orig_rms_dbfs: number;
  decoded_rms_dbfs: number;
  orig_f0_hz: number;
  orig_f0_confidence: number;
  decoded_f0_hz: number;
  decoded_f0_confidence: number;
  voiced: boolean;
  /** eight band strengths of the decoded audio, low band first, 0 to 1 */
  band_voicing: number[];
  band_voiced: boolean[];
}

interface FrameRecord {
  i: number;
  t: number;
  /** MEASURED: 72 bits from the AMBE-3000, 18 lowercase hex characters */
  hex: string;
  derived: FrameDerived;
}

interface FramesFile {
  schema: string;
  generated_utc: string;
  clip: ClipInfo;
  hardware: Record<string, unknown>;
  measured: Record<string, string>;
  unavailable: string;
  derived_notes: { method: string; bands: number; band_edges_hz: [number, number][] };
  frames: FrameRecord[];
}

interface SpectraFile {
  schema: string;
  generated_utc: string;
  clip: ClipInfo;
  bins: number;
  fft_size: number;
  window: string;
  bin_hz: number;
  bin_centre_hz: number[];
  units: string;
  floor_db: number;
  provenance: string;
  /** [frame][bin] in dB */
  original: number[][];
  decoded: number[][];
}

interface WaveformEnvelope {
  min: number[];
  max: number[];
}

interface WaveformCloseup {
  frame: number;
  start_s: number;
  f0_hz: number;
  f0_confidence: number;
  rms_dbfs: number;
  samples: number[];
}

interface WaveformFile {
  schema: string;
  generated_utc: string;
  clip: ClipInfo;
  bucket_samples: number;
  bucket_ms: number;
  buckets_per_frame: number;
  bucket_count: number;
  sample_full_scale: number;
  decoded_alignment: string;
  original: WaveformEnvelope;
  decoded: WaveformEnvelope;
  closeup_samples: number;
  closeup_note: string;
  closeups: Record<string, WaveformCloseup>;
}

interface ClipsEntry {
  id: string;
  voice: ClipVoice;
  sentence: string;
  text: string;
  original_audio: string;
  decoded_audio: string;
  channel_frames: string;
  duration_s: number;
  frame_count: number;
  channel_bytes: number;
  decoded_delay_samples: number;
  decoded_delay_ms: number;
  decoded_delay_correlation: number;
}

interface ClipsFile {
  schema: string;
  generated_utc: string;
  hardware: Record<string, unknown>;
  sample_rate_hz: number;
  normalisation: string;
  featured_clip: string;
  clips: ClipsEntry[];
}
