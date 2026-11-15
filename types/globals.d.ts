// Globals the figure runtime reads or publishes. Not shipped: types/ sits
// outside docs/, so zensical never copies it into site/.

interface Window {
  /** RxJS subject zensical emits on every instant-navigation page swap. */
  document$?: { subscribe(fn: () => void): unknown };
  /**
   * Test hook. anim-core.js publishes it only when served from localhost or
   * 127.0.0.1, for the figure tests in tests/figures/.
   */
  __ambeAnim?: {
    liveContexts: number;
    peakContexts: number;
    mounted: number;
    webglProbes: number;
    renders: number;
    parks: number;
    unparks: number;
    waits: number;
    cap: number;
    played: Record<string, number>;
    finishAll: () => void;
    draws: Record<string, { calls: number; triangles: number }>;
    tracks: Record<string, number>;
    figures: Record<string, unknown>;
  };
}

/**
 * One record of frames[] in docs/assets/data/<clip>/frames.json
 * (docs/assets/data/SCHEMA.md). Only the fields the figures read.
 */
interface FrameRecord {
  i: number;
  t: number;
  hex: string;
  derived: {
    orig_rms_dbfs: number;
    decoded_rms_dbfs: number;
    orig_f0_hz: number;
    orig_f0_confidence: number;
    decoded_f0_hz: number;
    decoded_f0_confidence: number;
    voiced: boolean;
    band_voicing: number[];
    band_voiced: boolean[];
  };
}
