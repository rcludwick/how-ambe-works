/* ===========================================================================
 * anim-harmonics.js — the fundamental and its harmonic series.
 * ---------------------------------------------------------------------------
 * SLUG          harmonics        <div data-anim="harmonics"></div>
 *
 * DATA READ     assets/data/lr-b/frames.json   (male recording, on demand)
 *               assets/data/lj-b/frames.json    (female recording, on demand)
 *               — only `frames[].derived.orig_f0_hz` / `orig_f0_confidence`
 *                 are used, to snap the pitch slider to a pitch measured in
 *                 the real ThumbDV captures.
 *
 *               Each voice is reduced to ONE number: the median f0 over its
 *               confidently-voiced frames. Stepping frame by frame was tried
 *               and removed. The autocorrelation pitch track has octave
 *               errors at both ends (male reaches 381 Hz, female drops to
 *               79 Hz), so a per-frame walk regularly showed the female voice
 *               with MORE harmonics than the male — the exact opposite of the
 *               point the figure exists to make. The median is stable, is
 *               honest about being a summary, and always orders the two
 *               voices correctly.
 *
 * CONTROLS      • pitch slider, 60–400 Hz (arrow keys step 1 Hz)
 *               • "Male recording" / "Female recording" — snap the slider to
 *                 that voice's median measured pitch and ghost the other one
 *                 behind it for comparison. Dragging the slider leaves this
 *                 mode and clears the ghost.
 *
 * WHAT IT DRAWS Two linked panels for one fundamental frequency f0:
 *               a 0–4 kHz harmonic comb (stems at f0, 2f0, 3f0 …) and the
 *               time-domain sum of those harmonics over 30 ms. The live
 *               readout is L, the number of harmonics inside the coded
 *               bandwidth — L = ⌊α·π/ω₀⌋ with α = 0.925, i.e. ⌊3700 Hz / f0⌋
 *               (US 5,701,390; US 5,754,974, as summarised in
 *               docs/08-analysis.md). The pitch-search bracket 22 ≤ P < 115
 *               samples at 8 kHz is from US 5,216,747.
 *
 * NOT A CODEC   There is no AMBE analysis or synthesis here, and no codec
 *               state is drawn. The spectral envelope that shapes the comb is
 *               a FIXED ILLUSTRATIVE SHAPE defined in this file (a sum of
 *               Lorentzian resonances) — it is a picture of "a speech-like
 *               envelope", not a measurement and not an estimator. The
 *               time-domain trace is an ordinary sum of sinusoids, i.e.
 *               generic display maths. The only numbers that come from
 *               outside are measured pitches from the precomputed JSON.
 *
 *               The ghost comb is the same illustrative envelope sampled at
 *               the other voice's median pitch. It is a second drawing of
 *               this file's own display maths, not a second measurement.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  mount as mountAnim,
  setupCanvas,
  createPlot,
  createLoop,
  clearCanvas,
  crisp,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  onThemeChange,
  loadJSON,
  prefersReducedMotion,
} from "./anim-core.js";

const SLUG = "harmonics";

/* --- constants that carry a citation ------------------------------------ */

/** Sampling is 8 kHz, so the analysis band runs to 4 kHz. */
const NYQUIST_HZ = 4000;

/** α = 0.925 of Nyquist — the coded bandwidth of the 3.6 kbit/s 8 kHz system
 *  (US 5,701,390; US 5,754,974). L = ⌊3700 / f0⌋ harmonics are transmitted. */
const CODED_BANDWIDTH_HZ = 3700;

/** Pitch-period search bracket, 22 ≤ P < 115 samples at 8 kHz (US 5,216,747). */
const SEARCH_MIN_HZ = 8000 / 115; // ≈ 69.6 Hz
const SEARCH_MAX_HZ = 8000 / 22; //  ≈ 363.6 Hz

/* --- purely illustrative display shapes --------------------------------- */

const PITCH_MIN_HZ = 60;
const PITCH_MAX_HZ = 400;
const DEFAULT_PITCH_HZ = 120;

/** Window shown in the time panel. The first 20 ms is shaded as "one frame". */
const WINDOW_MS = 30;
const FRAME_MS = 20;
const TIME_POINTS = 720;

/**
 * A fixed, made-up spectral envelope: three resonances plus a floor, drawn so
 * the comb has a speech-like shape. Display decoration only — nothing reads
 * this back, and it encodes nothing about AMBE.
 */
const RESONANCES = [
  { f: 480, bw: 190, gain: 1.0 },
  { f: 1480, bw: 260, gain: 0.62 },
  { f: 2520, bw: 340, gain: 0.34 },
  { f: 3420, bw: 400, gain: 0.17 },
];

function envelopeAt(hz) {
  let v = 0.035;
  for (const r of RESONANCES) {
    const d = (hz - r.f) / r.bw;
    v += r.gain / (1 + d * d);
  }
  return v / 1.09; // keeps the peak just under 1.0
}

/** Stable pseudo-random per-harmonic phases, so the summed waveform looks like
 *  speech rather than a single impulse, and does not jitter as the pitch
 *  changes. Decoration: real speech phases are not this, and AMBE does not
 *  transmit phase at all. */
const PHASES = (() => {
  const out = new Float64Array(96);
  for (let k = 0; k < out.length; k += 1) {
    const h = Math.sin((k + 1) * 12.9898) * 43758.5453;
    out[k] = 2 * Math.PI * (h - Math.floor(h));
  }
  return out;
})();

function phaseFor(k) {
  return PHASES[k % PHASES.length];
}

/* --- markup ------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">One fundamental, and everything that follows from it</p>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 16 / 10">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="A harmonic comb from 0 to 4 kHz for the selected fundamental frequency, above the time-domain waveform of those harmonics summed. The readout below gives the fundamental and L, the number of harmonics inside the coded bandwidth."></canvas>
</div>

<ul class="anim-legend">
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-1"></i>harmonic amplitudes — the L numbers that get transmitted</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--dashed" style="color: var(--ambe-data-3)"></i>spectral envelope (illustrative shape)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line is-data-2"></i>the harmonics added together</li>
  <li class="anim-legend__item anim-legend__item--ghost" data-role="ghost-key" hidden><i class="anim-legend__swatch anim-legend__swatch--ghost"></i><span data-role="ghost-key-text">the other voice, for comparison</span></li>
</ul>

<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Fundamental f₀</span>
    <input class="anim-range" type="range" min="${PITCH_MIN_HZ}" max="${PITCH_MAX_HZ}"
           step="1" value="${DEFAULT_PITCH_HZ}"
           aria-label="Fundamental frequency in hertz">
  </label>
  <output class="anim-readout anim-readout--wide" data-role="readout">120 Hz · L = 30</output>
  <div class="anim-controls__group" role="group" aria-label="Snap to a real measured frame"
       style="flex-wrap: wrap; max-width: 100%">
    <div class="anim-toggle-group" style="flex-wrap: wrap; max-width: 100%">
      <button class="anim-btn" type="button" data-voice="lr" aria-pressed="false">Male recording</button>
      <button class="anim-btn" type="button" data-voice="lj" aria-pressed="false">Female recording</button>
    </div>
  </div>
</div>

<div class="anim-compare" data-role="compare" hidden aria-live="polite">
  <div class="anim-compare__row" data-compare-row="lr">
    <span class="anim-compare__name">Male</span>
    <span class="anim-compare__f0" data-role="lr-f0"></span>
    <span class="anim-compare__l" data-role="lr-l"></span>
    <span class="anim-compare__bar"><i data-role="lr-bar"></i></span>
  </div>
  <div class="anim-compare__row" data-compare-row="lj">
    <span class="anim-compare__name">Female</span>
    <span class="anim-compare__f0" data-role="lj-f0"></span>
    <span class="anim-compare__l" data-role="lj-l"></span>
    <span class="anim-compare__bar"><i data-role="lj-bar"></i></span>
  </div>
  <p class="anim-compare__delta" data-role="delta"></p>
</div>

<p class="anim-figure__caption">
  Drag the fundamental. Watch the comb thin out as the pitch rises — and watch
  <strong>L</strong>, the count of harmonics inside the coded 3700 Hz band, fall with it.
  That count is how many spectral amplitudes the encoder has to squeeze into the
  same fixed budget of bits, so a deep voice and a high voice are not the same
  problem. Then press <em>Male recording</em> or <em>Female recording</em>: the
  slider snaps to that voice's typical measured pitch, and the other voice stays
  on the plot as a faint ghost comb so you can see the gap directly. The two real
  voices differ by six amplitudes for the same nine bytes.
  <span class="anim-figure__source">L = ⌊α·π/ω₀⌋ with α = 0.925 (coded bandwidth 3700 Hz):
  US 5,701,390 and US 5,754,974. Pitch search range 22 ≤ P &lt; 115 samples at 8 kHz:
  US 5,216,747. Snapped pitches: the <em>median</em> autocorrelation pitch over the
  confidently-voiced frames (confidence ≥ 0.5) of each recording, from
  assets/data/&lt;clip&gt;/frames.json — derived DSP on the recordings, not codec
  state. A median, not a single frame: the pitch track has octave errors at both
  ends, so no one frame is representative. The envelope shape is drawn for
  illustration and is not a measurement.</span>
</p>
`;

/* --- module ------------------------------------------------------------- */

const VOICES = {
  lr: { clip: "lr-b", label: "male" },
  lj: { clip: "lj-b", label: "female" },
};

const VOICE_KEYS = Object.keys(VOICES);

/** A frame's pitch counts only if the tracker was reasonably sure of it. */
const MIN_CONFIDENCE = 0.5;

function otherVoice(voice) {
  return voice === "lr" ? "lj" : "lr";
}

function harmonicsFor(f0) {
  return Math.floor(CODED_BANDWIDTH_HZ / f0);
}

/**
 * Reduce a clip to its median confidently-voiced pitch.
 *
 * The median rather than the mean: the tracker's octave errors are wild
 * outliers (a doubled or halved estimate), and a mean would drag toward them.
 *
 * @param {object} data parsed frames.json
 * @returns {{clip: string, f0: number, n: number} | null}
 */
function summarise(data) {
  const f0s = [];
  for (const fr of data.frames) {
    const d = fr.derived;
    if (!(d.orig_f0_hz > 0)) continue;
    if (!(d.orig_f0_confidence >= MIN_CONFIDENCE)) continue;
    f0s.push(d.orig_f0_hz);
  }
  if (f0s.length === 0) return null;
  f0s.sort((a, b) => a - b);
  const mid = f0s.length >> 1;
  const f0 =
    f0s.length % 2 === 0 ? (f0s[mid - 1] + f0s[mid]) / 2 : f0s[mid];
  return { clip: data.clip.id, f0, n: f0s.length };
}

/**
 * Mount the harmonics figure into a container.
 * @param {Element} root a `[data-anim="harmonics"]` element
 * @returns {() => void} cleanup
 */
export function mount(root) {
  root.classList.add("anim-figure");
  if (!root.querySelector(".anim-figure__frame")) root.innerHTML = FIGURE_HTML;

  const frame = root.querySelector(".anim-figure__frame");
  const canvas = root.querySelector("canvas");
  const range = root.querySelector(".anim-range");
  const readout = root.querySelector('[data-role="readout"]');
  const voiceButtons = Array.from(root.querySelectorAll("[data-voice]"));
  const compare = root.querySelector('[data-role="compare"]');
  const ghostKey = root.querySelector('[data-role="ghost-key"]');
  const ghostKeyText = root.querySelector('[data-role="ghost-key-text"]');
  const deltaEl = root.querySelector('[data-role="delta"]');
  const reduced = prefersReducedMotion();

  const state = {
    pitch: DEFAULT_PITCH_HZ, // what is drawn (eases toward target)
    target: DEFAULT_PITCH_HZ, // what the reader asked for
    voice: null, // "lr" | "lj" | null (free mode)
    stats: { lr: null, lj: null }, // {clip, f0, n} once loaded
    loading: false,
  };

  /** The voice being compared against, if its data is in hand. */
  function ghostStats() {
    if (!state.voice) return null;
    return state.stats[otherVoice(state.voice)];
  }

  const handle = setupCanvas(canvas, { onResize: () => render() });

  /* -- geometry ---------------------------------------------------------- */

  function layout() {
    const W = handle.width;
    const H = handle.height;
    const compact = W < 560;
    const padL = compact ? 30 : 44;
    const padR = compact ? 12 : 16;
    const splitY = Math.round(H * 0.6);

    const spec = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, NYQUIST_HZ],
        yDomain: [0, 1.08],
        padding: {
          top: compact ? 14 : 18,
          right: padR,
          bottom: H - splitY + 20,
          left: padL,
        },
      }
    );

    const wave = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, WINDOW_MS],
        yDomain: [-1.12, 1.12],
        padding: {
          top: splitY + (compact ? 16 : 22),
          right: padR,
          bottom: compact ? 30 : 34,
          left: padL,
        },
      }
    );

    return { W, H, compact, spec, wave };
  }

  /* -- drawing ----------------------------------------------------------- */

  function drawSpectrum(ctx, th, geo) {
    const { spec, compact } = geo;
    const f0 = state.pitch;
    const coded = Math.floor(CODED_BANDWIDTH_HZ / f0);

    // Region above the coded bandwidth: present in the audio, never transmitted.
    ctx.save();
    ctx.fillStyle = th.hairline;
    const cutX = spec.x(CODED_BANDWIDTH_HZ);
    ctx.fillRect(cutX, spec.area.top, spec.area.right - cutX, spec.area.height);
    ctx.restore();

    drawGrid(ctx, spec, { xTicks: [1000, 2000, 3000], yTicks: [] });
    drawAxes(ctx, spec, {
      xTicks: [0, 1000, 2000, 3000, 4000],
      yTicks: [],
      formatX: (v) => (v === 0 ? "0" : `${v / 1000}k`),
      xLabel: compact ? "kHz" : "frequency (kHz)",
    });

    // Envelope: the illustrative shape the harmonics sample.
    const envPoints = [];
    for (let px = 0; px <= 160; px += 1) {
      const hz = (px / 160) * NYQUIST_HZ;
      envPoints.push({ x: hz, y: envelopeAt(hz) });
    }
    drawPolyline(ctx, envPoints, {
      plot: spec,
      color: th.series[2],
      width: 1.5,
      dash: [4, 4],
    });

    // The other voice, ghosted underneath: same envelope, their pitch. Drawn
    // first so the live comb sits on top of it, and kept deliberately faint —
    // it is a reference, not a second dataset competing for attention.
    const ghost = ghostStats();
    if (ghost) {
      ctx.save();
      spec.clip(ctx);
      const gBase = spec.y(0);
      ctx.strokeStyle = th.muted;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (let k = 1; k * ghost.f0 < NYQUIST_HZ; k += 1) {
        const hz = k * ghost.f0;
        const x = crisp(spec.x(hz), 1);
        ctx.beginPath();
        ctx.moveTo(x, gBase);
        ctx.lineTo(x, spec.y(envelopeAt(hz)));
        ctx.stroke();
      }
      ctx.restore();
    }

    // The comb.
    ctx.save();
    spec.clip(ctx);
    const baseY = spec.y(0);
    for (let k = 1; k * f0 < NYQUIST_HZ; k += 1) {
      const hz = k * f0;
      const inBand = hz < CODED_BANDWIDTH_HZ;
      const amp = envelopeAt(hz);
      const x = crisp(spec.x(hz), 2);
      const y = spec.y(amp);
      ctx.strokeStyle = inBand ? th.series[0] : th.series[3];
      ctx.globalAlpha = inBand ? 1 : 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (f0 > 95 || k % 2 === 0 || !compact) {
        ctx.fillStyle = inBand ? th.series[0] : th.series[3];
        ctx.beginPath();
        ctx.arc(x, y, f0 > 140 ? 2.6 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // The cut at the coded bandwidth.
    ctx.save();
    ctx.strokeStyle = th.border;
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crisp(cutX), spec.area.top);
    ctx.lineTo(crisp(cutX), spec.area.bottom);
    ctx.stroke();
    ctx.restore();
    if (!compact) {
      drawLabel(ctx, "3700 Hz — coded bandwidth", cutX - 6, spec.area.bottom - 6, {
        align: "right",
        baseline: "bottom",
        size: 10,
        color: th.text3,
        background: th.plotBg,
        padding: 3,
      });
    }

    // Spacing bracket between the first two harmonics.
    if (f0 * 2 < NYQUIST_HZ) {
      const x1 = spec.x(f0);
      const x2 = spec.x(f0 * 2);
      const by = spec.area.bottom - 8;
      ctx.save();
      ctx.strokeStyle = th.series[0];
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(crisp(x1), by - 4);
      ctx.lineTo(crisp(x1), by);
      ctx.lineTo(crisp(x2), by);
      ctx.lineTo(crisp(x2), by - 4);
      ctx.stroke();
      ctx.restore();
      if (x2 - x1 > 34) {
        drawLabel(ctx, "f₀", (x1 + x2) / 2, by - 3, {
          align: "center",
          baseline: "bottom",
          size: 10,
          color: th.series[0],
          background: th.plotBg,
          padding: 2,
        });
      }
    }

    // The headline number, on a panel so it stays readable over a dense comb.
    const outOfRange = f0 < SEARCH_MIN_HZ || f0 > SEARCH_MAX_HZ;
    const ghostL = ghost ? harmonicsFor(ghost.f0) : null;
    const ghostDelta = ghostL === null ? 0 : coded - ghostL;
    const subLineY = compact ? 22 : 30;
    const ghostLineY = subLineY + (compact ? 14 : 16);
    const warnLineY = (ghostL === null ? subLineY : ghostLineY) + (compact ? 16 : 18);

    const hx = spec.area.left + 10;
    const hy = spec.area.top + (compact ? 6 : 10);
    const panelW = compact ? 168 : 236;
    const panelH =
      (compact ? 46 : 58) +
      (ghostL === null ? 0 : compact ? 14 : 16) +
      (outOfRange ? 16 : 0);
    ctx.save();
    ctx.globalAlpha = 0.86;
    ctx.fillStyle = th.plotBg;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(hx - 8, hy - 6, panelW, panelH, 6);
      ctx.fill();
    } else {
      ctx.fillRect(hx - 8, hy - 6, panelW, panelH);
    }
    ctx.restore();
    drawLabel(ctx, `L = ${coded}`, hx, hy, {
      align: "left",
      baseline: "top",
      size: compact ? 20 : 26,
      weight: 600,
      color: th.ink,
      mono: true,
    });
    drawLabel(
      ctx,
      compact ? "amplitudes to send" : "spectral amplitudes to transmit",
      hx,
      hy + subLineY,
      { align: "left", baseline: "top", size: 11, color: th.muted }
    );

    // The whole point of the comparison, stated as a number rather than left
    // for the reader to count off two combs.
    if (ghostL !== null) {
      const other = VOICES[otherVoice(state.voice)].label;
      const text =
        ghostDelta === 0
          ? `same as the ${other} voice`
          : `${Math.abs(ghostDelta)} ${ghostDelta > 0 ? "more" : "fewer"} than the ${other} voice`;
      drawLabel(ctx, text, hx, hy + ghostLineY, {
        align: "left",
        baseline: "top",
        size: 11,
        weight: 600,
        color: th.series[0],
      });
    }

    // Out-of-range warning: the coder's pitch search does not go here.
    if (outOfRange) {
      drawLabel(
        ctx,
        compact
          ? "outside the coder's pitch range"
          : "outside the coder's pitch search range (P = 22…115 samples)",
        hx,
        hy + warnLineY,
        {
          align: "left",
          baseline: "top",
          size: 10,
          color: th.accentWarm,
        }
      );
    }
  }

  function drawWaveform(ctx, th, geo) {
    const { wave, compact } = geo;
    const f0 = state.pitch;

    // One 20 ms frame, shaded.
    ctx.save();
    ctx.fillStyle = th.hairline;
    const fx = wave.x(FRAME_MS);
    ctx.fillRect(wave.area.left, wave.area.top, fx - wave.area.left, wave.area.height);
    ctx.restore();

    drawGrid(ctx, wave, { xTicks: [5, 10, 15, 20, 25], yTicks: [0] });
    drawAxes(ctx, wave, {
      xTicks: [0, 5, 10, 15, 20, 25, 30],
      yTicks: [],
      formatX: (v) => String(v),
      xLabel: compact ? "ms" : "milliseconds",
    });

    // Sum of the harmonics: ordinary display maths, sin() and addition.
    const kMax = Math.floor((NYQUIST_HZ - 1) / f0);
    const amps = new Float64Array(kMax + 1);
    for (let k = 1; k <= kMax; k += 1) amps[k] = envelopeAt(k * f0);

    const points = new Array(TIME_POINTS + 1);
    let peak = 1e-9;
    for (let i = 0; i <= TIME_POINTS; i += 1) {
      const ms = (i / TIME_POINTS) * WINDOW_MS;
      const t = ms / 1000;
      let sum = 0;
      for (let k = 1; k <= kMax; k += 1) {
        sum += amps[k] * Math.sin(2 * Math.PI * k * f0 * t + phaseFor(k));
      }
      points[i] = { x: ms, y: sum };
      const a = Math.abs(sum);
      if (a > peak) peak = a;
    }
    const scale = 0.94 / peak;
    for (const p of points) p.y *= scale;

    ctx.save();
    wave.clip(ctx);
    drawPolyline(ctx, points, {
      plot: wave,
      color: th.series[1],
      width: 1.6,
    });
    ctx.restore();

    // One pitch period, bracketed.
    const periodMs = 1000 / f0;
    const startMs = 4;
    if (startMs + periodMs <= WINDOW_MS) {
      const x1 = wave.x(startMs);
      const x2 = wave.x(startMs + periodMs);
      const y = wave.area.top + 10;
      ctx.save();
      ctx.strokeStyle = th.series[1];
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(crisp(x1), wave.area.top);
      ctx.lineTo(crisp(x1), wave.area.bottom);
      ctx.moveTo(crisp(x2), wave.area.top);
      ctx.lineTo(crisp(x2), wave.area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, crisp(y));
      ctx.lineTo(x2, crisp(y));
      ctx.stroke();
      ctx.restore();
      if (x2 - x1 > 34) {
        const text =
          x2 - x1 > 78
            ? `1 / f₀ = ${periodMs.toFixed(1)} ms`
            : `${periodMs.toFixed(1)} ms`;
        drawLabel(ctx, text, (x1 + x2) / 2, y, {
          align: "center",
          baseline: "middle",
          size: 10,
          color: th.series[1],
          background: th.plotBg,
          padding: 3,
        });
      }
    }

    if (!compact) {
      drawLabel(ctx, "one 20 ms frame", wave.area.left + 6, wave.area.bottom - 6, {
        align: "left",
        baseline: "bottom",
        size: 10,
        color: th.text4,
      });
    }
  }

  function drawSourceChip(ctx, th, geo) {
    if (!state.voice) return;
    const s = state.stats[state.voice];
    if (!s) return;
    const { spec, compact } = geo;
    const x = spec.area.right - 8;
    const y = spec.area.top + 6;
    const line1 = compact
      ? `${s.clip} · median`
      : `${s.clip} · median of ${s.n} voiced frames`;
    const line2 = `f₀ ${s.f0.toFixed(1)} Hz measured from the recording`;
    drawLabel(ctx, line1, x, y, {
      align: "right",
      baseline: "top",
      size: 11,
      mono: true,
      color: th.text2,
      background: th.surface2,
      padding: 4,
    });
    if (!compact) {
      drawLabel(ctx, line2, x, y + 22, {
        align: "right",
        baseline: "top",
        size: 10,
        color: th.text4,
      });
    }
  }

  function render() {
    const th = getTheme();
    const ctx = handle.ctx;
    const geo = layout();

    // Taller on a phone so both panels stay legible without page-level scroll.
    const aspect = geo.W < 480 ? "1 / 1.05" : geo.W < 620 ? "16 / 12" : "16 / 10";
    if (frame && frame.style.getPropertyValue("--anim-aspect") !== aspect) {
      frame.style.setProperty("--anim-aspect", aspect);
    }

    clearCanvas(ctx, handle, th.plotBg);
    drawSpectrum(ctx, th, geo);
    drawWaveform(ctx, th, geo);
    drawSourceChip(ctx, th, geo);
    updateReadout();
  }

  function updateReadout() {
    if (!readout) return;
    const f0 = state.pitch;
    const L = Math.floor(CODED_BANDWIDTH_HZ / f0);
    readout.textContent = `${f0.toFixed(f0 < 100 ? 1 : 0)} Hz · L = ${L}`;
  }

  /* -- pitch easing ------------------------------------------------------ */

  const loop = createLoop(
    ({ dt }) => {
      const diff = state.target - state.pitch;
      if (Math.abs(diff) < 0.05) {
        state.pitch = state.target;
        render();
        loop.stop();
        return;
      }
      const k = 1 - Math.exp(-Math.min(dt, 0.05) * 16);
      state.pitch += diff * k;
      render();
    },
    { element: root, autoplay: false }
  );

  function setPitch(hz, { immediate = false } = {}) {
    state.target = Math.min(Math.max(hz, PITCH_MIN_HZ), PITCH_MAX_HZ);
    if (range) {
      const v = String(Math.round(state.target));
      if (range.value !== v) range.value = v;
    }
    if (immediate || reduced) {
      state.pitch = state.target;
      render();
    } else {
      loop.start();
    }
  }

  /* -- real measured frames ---------------------------------------------- */

  function syncButtons() {
    for (const b of voiceButtons) {
      b.setAttribute(
        "aria-pressed",
        b.dataset.voice === state.voice ? "true" : "false"
      );
    }
  }

  /** The comparison, restated as text for readers who are not reading pixels. */
  function syncCompare() {
    if (!compare) return;
    const both = state.stats.lr && state.stats.lj;
    const show = Boolean(state.voice && both);
    compare.hidden = !show;
    if (ghostKey) ghostKey.hidden = !show;
    if (!show) return;

    for (const key of VOICE_KEYS) {
      const s = state.stats[key];
      const L = harmonicsFor(s.f0);
      const row = compare.querySelector(`[data-compare-row="${key}"]`);
      if (row) row.classList.toggle("is-current", key === state.voice);
      const f0El = compare.querySelector(`[data-role="${key}-f0"]`);
      if (f0El) f0El.textContent = `${s.f0.toFixed(0)} Hz`;
      const lEl = compare.querySelector(`[data-role="${key}-l"]`);
      if (lEl) lEl.textContent = `L = ${L}`;
      // Bar length is relative to the larger of the two, so the gap reads as
      // a proportion rather than an absolute count of pixels.
      const bar = compare.querySelector(`[data-role="${key}-bar"]`);
      if (bar) {
        const maxL = Math.max(
          harmonicsFor(state.stats.lr.f0),
          harmonicsFor(state.stats.lj.f0)
        );
        bar.style.width = `${(L / maxL) * 100}%`;
      }
    }

    if (ghostKeyText) {
      ghostKeyText.textContent = `${VOICES[otherVoice(state.voice)].label} voice, ghosted for comparison`;
    }

    if (deltaEl) {
      const lrL = harmonicsFor(state.stats.lr.f0);
      const ljL = harmonicsFor(state.stats.lj.f0);
      const gap = Math.abs(lrL - ljL);
      const fewer = lrL < ljL ? "male" : "female";
      deltaEl.textContent =
        gap === 0
          ? "Both voices land on the same number of amplitudes."
          : `Same nine bytes either way — but the ${fewer} voice needs ${gap} fewer amplitudes to describe.`;
    }
  }

  function applyVoice() {
    const s = state.stats[state.voice];
    if (!s) return;
    setPitch(s.f0);
    syncCompare();
  }

  /**
   * Both clips are loaded the first time either button is pressed, because the
   * ghost comb needs the voice the reader did NOT pick. Two fetches of a file
   * already on the CDN, once per page.
   */
  async function loadAll() {
    if (state.loading) return;
    state.loading = true;
    try {
      await Promise.all(
        VOICE_KEYS.map(async (key) => {
          if (state.stats[key]) return;
          const data = await loadJSON(`assets/data/${VOICES[key].clip}/frames.json`);
          state.stats[key] = summarise(data);
        })
      );
    } finally {
      state.loading = false;
    }
  }

  async function chooseVoice(voice) {
    if (state.voice === voice) return; // already there; nothing to step to
    state.voice = voice;
    syncButtons();
    await loadAll();
    if (state.voice !== voice) return; // reader moved on while loading
    applyVoice();
  }

  function goFree() {
    if (!state.voice) return;
    state.voice = null;
    syncButtons();
    syncCompare();
    render();
  }

  /* -- events ------------------------------------------------------------ */

  const onRange = () => {
    goFree();
    setPitch(Number(range.value), { immediate: true });
  };
  const onVoice = (event) => {
    const voice = event.currentTarget.dataset.voice;
    chooseVoice(voice).catch((error) => {
      console.error(`anim-${SLUG}: could not load measured pitches`, error);
      state.voice = null;
      syncButtons();
    });
  };
  if (range) range.addEventListener("input", onRange);
  for (const b of voiceButtons) b.addEventListener("click", onVoice);
  const unsubscribeTheme = onThemeChange(() => render());

  syncButtons();
  syncCompare();
  render();

  return () => {
    if (range) range.removeEventListener("input", onRange);
    for (const b of voiceButtons) b.removeEventListener("click", onVoice);
    unsubscribeTheme();
    loop.destroy();
    handle.destroy();
  };
}

export default mount;

/* Self-register: every [data-anim="harmonics"] on the page, now and after each
 * navigation.instant swap. */
mountAnim(`[data-anim="${SLUG}"]`, mount);
