/* ===========================================================================
   anim-synth.js — slug "synth"
   ---------------------------------------------------------------------------
   The synthesis figure. Two generators side by side — a bank of harmonic
   oscillators for the bands measured voiced, and shaped noise for the bands
   measured unvoiced — and their sum, with a mix control that fades between
   voiced-only, the measured mix, and unvoiced-only.

   Mount point:  <div data-anim="synth"></div>

   Data read (precomputed; nothing here decodes AMBE):
     assets/data/frames.json    derived.decoded_f0_hz, derived.band_voicing[8],
                                derived.band_voiced[8], derived.decoded_rms_dbfs
                                — generic DSP measured on the hardware-decoded
                                WAV, per SCHEMA.md. Bands are the eight 500 Hz
                                bands in derived_notes.band_edges_hz.
     assets/data/spectra.json   decoded[frame][128] — FFT magnitude in dBFS of
                                the same audio, used to read a level for each
                                harmonic and each noise band.

   Controls:
     Play / Pause      steps frames at 10 fps (half real time)
     Frame slider      scrub, arrow-key steppable
     Mix slider        unvoiced only  <->  measured mix  <->  voiced only
     Measured mix      snap the mix slider back to what was measured
     Spectrum overlay  show/hide the measured decoded spectrum behind the
                       drawn one

   WHAT THIS IS NOT.
   The curves are an illustration drawn from precomputed measurements: display
   sinusoids at multiples of the measured fundamental, with levels read off the
   measured spectrum and phases chosen arbitrarily, plus noise components in
   the unvoiced bands. There is no MBE synthesizer here — no phase model, no
   window, no overlap-add, no audio output, and no reconstruction of the
   decoded speech. The real decoded audio is a pre-rendered WAV on the Listen
   page. Do not turn this into a codec.

   MIT licensed (see LICENSE-MIT).
   ======================================================================== */

import {
  mount,
  setupCanvas,
  clearCanvas,
  crisp,
  createLoop,
  createTransport,
  createPlot,
  drawAxes,
  drawGrid,
  drawPolyline,
  loadJSON,
  getTheme,
  onThemeChange,
  prefersReducedMotion,
} from "./anim-core.js";

const SLUG = "synth";
const FRAMES = "assets/data/frames.json";
const SPECTRA = "assets/data/spectra.json";

const BANDS = 8;
const BAND_HZ = 500; // derived_notes.band_edges_hz: eight 500 Hz bands
const NYQUIST = 4000;
const TRACE_N = 512; // display resolution of one 20 ms window
const WINDOW_S = 0.02; // one frame
const NOISE_PER_BAND = 22; // display components used to draw band noise
const DB_FLOOR = -95;
const DB_TOP = -8;
const PLAY_FPS = 10;

/* ---------------------------------------------------------------------------
 * Scoped CSS
 * ------------------------------------------------------------------------ */

const CSS = `
/* --anim-aspect is set from JS in fitFrame(): the stacked layout has a fixed
   natural height that a media query on the viewport cannot work out. */
[data-anim="${SLUG}"] .anim-figure__frame { --anim-aspect: 16 / 10; }
[data-anim="${SLUG}"] .synth-readouts {
  color: var(--ambe-text-3);
  display: flex;
  flex-wrap: wrap;
  font-family: var(--ambe-font-mono);
  font-size: 0.6rem;
  font-variant-numeric: tabular-nums;
  gap: 0.25rem 1.1rem;
  margin-top: 0.6rem;
}
[data-anim="${SLUG}"] .synth-readouts b {
  color: var(--ambe-text);
  font-weight: 550;
}
`;

function injectCSS() {
  const id = `anim-${SLUG}-css`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* ---------------------------------------------------------------------------
 * Markup
 * ------------------------------------------------------------------------ */

function buildMarkup(root) {
  root.classList.add("anim-figure");
  root.innerHTML = `
    <div class="anim-figure__head">
      <p class="anim-figure__title">Two generators, one voice</p>
      <p class="anim-figure__subtitle">Oscillator bank + shaped noise, mixed by band</p>
    </div>

    <div class="anim-figure__frame">
      <canvas class="anim-figure__canvas"
              aria-label="Three stacked waveform panels — voiced oscillators, shaped noise, and their sum — beside a spectrum and a per-band voicing chart."></canvas>
    </div>

    <div class="synth-readouts" role="status" aria-live="polite" data-ref="readouts"></div>

    <ul class="anim-legend">
      <li class="anim-legend__item"><i class="anim-legend__swatch is-data-2"></i>voiced: harmonic oscillators</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch is-data-3"></i>unvoiced: shaped noise</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch is-data-1"></i>sum</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch is-data-4"></i>measured spectrum of the decoded audio</li>
    </ul>

    <div class="anim-controls">
      <button class="anim-btn anim-btn--play" type="button" aria-pressed="false">Play</button>
      <label class="anim-field">
        <span class="anim-field__label">Frame</span>
        <input class="anim-range" type="range" min="0" max="0" step="1" value="0"
               aria-label="Frame index">
      </label>
      <output class="anim-readout anim-readout--wide">frame 0</output>
    </div>

    <div class="anim-controls" style="border-top: 0; margin-top: 0; padding-top: 0">
      <label class="anim-field">
        <span class="anim-field__label">Mix</span>
        <input class="anim-range" type="range" min="0" max="100" step="1" value="50"
               data-ref="mix"
               aria-label="Mix between unvoiced only, the measured mix, and voiced only">
      </label>
      <output class="anim-readout anim-readout--wide" data-ref="mixout">measured mix</output>
      <button class="anim-btn" type="button" data-ref="snap">Measured mix</button>
      <label class="anim-field" style="flex: none">
        <input class="anim-check" type="checkbox" data-ref="overlay" checked>
        <span class="anim-field__label">Spectrum overlay</span>
      </label>
    </div>

    <p class="anim-figure__hint">Held on one representative frame because your
      system asks for reduced motion. Both sliders still work.</p>

    <figcaption class="anim-figure__caption">
      Drag <em>Mix</em> all the way left and the frame is nothing but band-shaped
      noise; all the way right and it is a pure harmonic buzz. The centre
      position is the mix that was actually measured on this frame — for a vowel
      the low bands are periodic and the high bands are not, which is the whole
      point of a multi-band model. Scrub <em>Frame</em> through a fricative and
      watch every band go unvoiced at once. Each frame is drawn at its own
      vertical scale, so a quiet frame still fills its panel — the real level is
      the one in the readout.
      <span class="anim-figure__source">Source: per-band voicing strength,
        fundamental and levels measured on audio decoded by a real DVSI
        AMBE-3000 (<code>assets/data/frames.json</code>,
        <code>assets/data/spectra.json</code>; see
        <code>assets/data/SCHEMA.md</code> for windows and thresholds). The two
        generators and the zero response of the noise filter inside voiced bands
        are described in US 5,754,974 and Griffin &amp; Lim 1988. The curves are
        an illustration drawn from those measurements with arbitrary phase —
        they are not the decoder's output, which you can hear on the Listen
        page.</span>
    </figcaption>
  `;
  return {
    frame: root.querySelector(".anim-figure__frame"),
    canvas: root.querySelector(".anim-figure__canvas"),
    readouts: root.querySelector('[data-ref="readouts"]'),
    mix: root.querySelector('[data-ref="mix"]'),
    mixout: root.querySelector('[data-ref="mixout"]'),
    snap: root.querySelector('[data-ref="snap"]'),
    overlay: root.querySelector('[data-ref="overlay"]'),
  };
}

/* ---------------------------------------------------------------------------
 * Display maths. Deterministic PRNG so a frame always draws the same way.
 * ------------------------------------------------------------------------ */

function rng(seed) {
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

const dbToLin = (db) => Math.pow(10, db / 20);
const linToDb = (a) => (a > 1e-9 ? 20 * Math.log10(a) : DB_FLOOR - 20);

/**
 * Turn one frame's measurements into the ingredients of the drawing:
 * a list of harmonics for the bands measured voiced, and a per-band noise
 * level for the bands measured unvoiced.
 */
function buildFrameModel(frames, spectra, index) {
  const d = frames[index].derived;
  const row = spectra.decoded[index];
  const binHz = 4000 / row.length;
  const amp = row.map(dbToLin);

  const f0 = d.decoded_f0_hz;
  const voicedBand = d.band_voiced;

  const harmonics = [];
  if (f0 > 20) {
    for (let k = 1; k * f0 < NYQUIST; k += 1) {
      const f = k * f0;
      const band = Math.min(BANDS - 1, Math.floor(f / BAND_HZ));
      const bin = Math.max(0, Math.min(row.length - 1, Math.round(f / binHz)));
      harmonics.push({ k, f, band, amp: amp[bin], voiced: !!voicedBand[band] });
    }
  }

  const noiseBands = [];
  for (let b = 0; b < BANDS; b += 1) {
    if (voicedBand[b]) continue;
    const lo = b * BAND_HZ;
    const hi = lo + BAND_HZ;
    let peak = 0;
    for (let i = Math.ceil(lo / binHz); i < hi / binHz && i < amp.length; i += 1) {
      if (amp[i] > peak) peak = amp[i];
    }
    noiseBands.push({ band: b, lo, hi, amp: peak * 0.8 });
  }

  // Display traces over one 20 ms window.
  const phase = rng(1237);
  const phases = harmonics.map(() => phase() * Math.PI * 2);
  const noiseRand = rng(9871 + index * 7919);
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
    for (let g = 0; g < grains.length; g += 1) {
      u += grains[g].a * Math.cos(2 * Math.PI * grains[g].f * t + grains[g].p);
    }
    voicedTrace[n] = v;
    noiseTrace[n] = u;
  }

  let peak = 1e-9;
  for (let n = 0; n < TRACE_N; n += 1) {
    peak = Math.max(peak, Math.abs(voicedTrace[n] + noiseTrace[n]));
  }

  return {
    f0,
    voicedBand,
    bandVoicing: d.band_voicing,
    rms: d.decoded_rms_dbfs,
    confidence: d.decoded_f0_confidence,
    harmonics,
    noiseBands,
    voicedTrace,
    noiseTrace,
    scale: 0.92 / peak,
    harmonicCount: harmonics.length,
    voicedHarmonics: harmonics.filter((h) => h.voiced).length,
  };
}

function weights(mix) {
  const u = mix / 100;
  return {
    v: u <= 0.5 ? u * 2 : 1,
    u: u <= 0.5 ? 1 : (1 - u) * 2,
  };
}

/* ---------------------------------------------------------------------------
 * Layout
 * ------------------------------------------------------------------------ */

const TWO_COL = 720; // canvas width at which the panels sit in two columns
const WAVE_H = 74; // stacked-layout heights
const WAVE_GAP = 10;
const SPEC_H = 182;
const BAND_H = 126;

/** Height this figure needs at a given width, so the frame's aspect can be
 *  set from JS rather than guessed by a media query. */
function naturalHeight(W) {
  if (W >= TWO_COL) return Math.round((W * 9) / 16);
  const pad = W < 420 ? 8 : 12;
  return pad * 2 + 3 * (WAVE_H + WAVE_GAP) + 6 + SPEC_H + 18 + BAND_H;
}

function computeLayout(size) {
  const W = size.width;
  const H = size.height;
  const pad = W < 420 ? 8 : 12;
  const twoCol = W >= TWO_COL;

  if (twoCol) {
    const colW = Math.round((W - pad * 3) * 0.5);
    const rightX = pad * 2 + colW;
    const rightW = W - rightX - pad;
    const waveH = Math.floor((H - pad * 2 - 24) / 3);
    return {
      W,
      H,
      pad,
      twoCol,
      wave: [0, 1, 2].map((i) => ({
        x: pad,
        y: pad + i * (waveH + 12),
        w: colW,
        h: waveH,
      })),
      spectrum: {
        x: rightX,
        y: pad,
        w: rightW,
        h: Math.round((H - pad * 2 - 16) * 0.62),
      },
      bands: {
        x: rightX,
        y: pad + Math.round((H - pad * 2 - 16) * 0.62) + 16,
        w: rightW,
        h: H - pad - (pad + Math.round((H - pad * 2 - 16) * 0.62) + 16),
      },
    };
  }

  // Stacked layout. Heights are fixed; the frame's aspect is set from
  // naturalHeight() so the box is exactly this tall, but scale down if some
  // other stylesheet gives us less room than we asked for.
  const colW = W - pad * 2;
  const want = naturalHeight(W) - pad * 2;
  const k = Math.min(1, (H - pad * 2) / want);
  const waveH = Math.floor(WAVE_H * k);
  const specH = Math.floor(SPEC_H * k);
  const bandH = Math.floor(BAND_H * k);
  const gap = Math.floor(WAVE_GAP * k);
  const specY = pad + 3 * (waveH + gap) + Math.floor(6 * k);
  const bandY = specY + specH + Math.floor(18 * k);
  return {
    W,
    H,
    pad,
    twoCol,
    wave: [0, 1, 2].map((i) => ({
      x: pad,
      y: pad + i * (waveH + gap),
      w: colW,
      h: waveH,
    })),
    spectrum: { x: pad, y: specY, w: colW, h: specH },
    bands: { x: pad, y: bandY, w: colW, h: bandH },
  };
}

function subPlot(size, rect, xDomain, yDomain, pad) {
  return createPlot(size, {
    xDomain,
    yDomain,
    padding: {
      left: rect.x + pad.left,
      top: rect.y + pad.top,
      right: size.width - (rect.x + rect.w) + pad.right,
      bottom: size.height - (rect.y + rect.h) + pad.bottom,
    },
  });
}

/* ---------------------------------------------------------------------------
 * Painting
 * ------------------------------------------------------------------------ */

function panelTitle(ctx, th, text, x, y, colour) {
  ctx.save();
  ctx.font = `600 10px ${th.font}`;
  ctx.fillStyle = colour || th.text3;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawWave(ctx, th, rect, trace, gain, scale, colour, label, note) {
  ctx.save();
  ctx.fillStyle = th.sunken;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = th.hairline;
  ctx.lineWidth = 1;
  ctx.strokeRect(crisp(rect.x), crisp(rect.y), rect.w - 1, rect.h - 1);

  const mid = rect.y + rect.h / 2;
  ctx.strokeStyle = th.grid;
  ctx.beginPath();
  ctx.moveTo(rect.x, crisp(mid));
  ctx.lineTo(rect.x + rect.w, crisp(mid));
  ctx.stroke();

  const points = new Array(TRACE_N);
  const half = rect.h / 2 - 4;
  for (let n = 0; n < TRACE_N; n += 1) {
    points[n] = [
      rect.x + (n / (TRACE_N - 1)) * rect.w,
      mid - trace(n) * gain * scale * half,
    ];
  }
  drawPolyline(ctx, points, { color: colour, width: 1.5 });

  ctx.font = `600 10px ${th.font}`;
  ctx.fillStyle = colour;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const text = rect.w < 420 && label.short ? label.short : label.long;
  ctx.fillText(text, rect.x + 7, rect.y + 5);
  if (note) {
    ctx.font = `10px ${th.mono}`;
    ctx.fillStyle = th.text4;
    ctx.textAlign = "right";
    const room = rect.w - 14 - ctx.measureText(text).width - 12;
    if (ctx.measureText(note).width <= room) {
      ctx.fillText(note, rect.x + rect.w - 7, rect.y + 5);
    }
  }
  ctx.restore();
}

function drawSpectrum(ctx, size, th, rect, model, spectraRow, state, w) {
  const plot = subPlot(
    size,
    rect,
    [0, NYQUIST],
    [DB_FLOOR, DB_TOP],
    { left: 34, right: 6, top: 18, bottom: 26 }
  );
  ctx.save();
  ctx.fillStyle = th.sunken;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  drawGrid(ctx, plot, { xTicks: [1000, 2000, 3000], yTicks: [-80, -60, -40, -20] });

  ctx.save();
  plot.clip(ctx);

  // A ribbon along the top says which generator owns each 500 Hz band.
  const ribbonH = 4;
  for (let b = 0; b < BANDS; b += 1) {
    ctx.fillStyle = model.voicedBand[b] ? th.series[1] : th.series[2];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(
      plot.x(b * BAND_HZ) + 1,
      plot.area.top,
      plot.x(BAND_HZ) - plot.x(0) - 2,
      ribbonH
    );
  }
  ctx.globalAlpha = 1;

  // Shaped-noise levels, one block per unvoiced band.
  for (const nb of model.noiseBands) {
    const db = linToDb(nb.amp * w.u);
    if (db <= DB_FLOOR) continue;
    const x0 = plot.x(nb.lo) + 1;
    const x1 = plot.x(nb.hi) - 1;
    const y = plot.y(Math.min(DB_TOP, db));
    ctx.fillStyle = th.series[2];
    ctx.globalAlpha = 0.22;
    ctx.fillRect(x0, y, x1 - x0, Math.min(16, plot.area.bottom - y));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = th.series[2];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, crisp(y, 2));
    ctx.lineTo(x1, crisp(y, 2));
    ctx.stroke();
  }

  // Measured spectrum of the decoded audio, on top of the blocks.
  if (state.overlay) {
    const pts = spectraRow.map((db, i) => [
      plot.x(i * (NYQUIST / spectraRow.length)),
      plot.y(Math.max(DB_FLOOR, db)),
    ]);
    drawPolyline(ctx, pts, { color: th.series[3], width: 1, dash: [3, 3] });
  }

  // One stick per harmonic in a voiced band.
  ctx.strokeStyle = th.series[1];
  ctx.lineWidth = 1.5;
  for (const h of model.harmonics) {
    if (!h.voiced) continue;
    const db = linToDb(h.amp * w.v);
    if (db <= DB_FLOOR) continue;
    const x = crisp(plot.x(h.f), 1.5);
    const y = plot.y(Math.min(DB_TOP, db));
    ctx.beginPath();
    ctx.moveTo(x, plot.area.bottom);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = th.series[1];
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  drawAxes(ctx, plot, {
    xTicks: [0, 1000, 2000, 3000, 4000],
    yTicks: [-80, -60, -40, -20],
    formatX: (v) => `${v / 1000}k`,
    formatY: (v) => String(v),
    fontSize: 10,
  });
  panelTitle(ctx, th, "Spectrum — sticks are harmonics, blocks are noise bands", rect.x, rect.y + 11);
}

function drawBands(ctx, size, th, rect, model) {
  const plot = subPlot(size, rect, [0, BANDS], [0, 1], {
    left: 30,
    right: 6,
    top: 18,
    bottom: 26,
  });
  ctx.save();
  ctx.fillStyle = th.sunken;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  const bw = (plot.area.width / BANDS) * 0.78;
  for (let b = 0; b < BANDS; b += 1) {
    const x = plot.x(b + 0.5) - bw / 2;
    const v = model.bandVoicing[b];
    const y = plot.y(Math.max(0.012, v));
    ctx.fillStyle = model.voicedBand[b] ? th.series[1] : th.series[2];
    ctx.globalAlpha = model.voicedBand[b] ? 0.95 : 0.75;
    ctx.fillRect(x, y, bw, plot.area.bottom - y);
    ctx.globalAlpha = 1;
  }

  // The 0.55 threshold that splits voiced from unvoiced in the derived data.
  ctx.save();
  ctx.strokeStyle = th.axis;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.area.left, crisp(plot.y(0.55)));
  ctx.lineTo(plot.area.right, crisp(plot.y(0.55)));
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = `9px ${th.mono}`;
  ctx.fillStyle = th.text4;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("0.55", plot.area.left - 4, plot.y(0.55));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let b = 0; b < BANDS; b += 1) {
    if (b % 2 && plot.area.width < 260) continue;
    ctx.fillText(`${(b * BAND_HZ) / 1000}k`, plot.x(b), plot.area.bottom + 6);
  }
  ctx.fillText("4k", plot.x(BANDS), plot.area.bottom + 6);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = th.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.area.left, crisp(plot.area.bottom));
  ctx.lineTo(plot.area.right, crisp(plot.area.bottom));
  ctx.stroke();
  ctx.restore();

  panelTitle(
    ctx,
    th,
    "Measured voicing strength per 500 Hz band",
    rect.x,
    rect.y + 11
  );
}

function paint(ctx, size, data, state) {
  const th = getTheme();
  const L = computeLayout(size);
  clearCanvas(ctx, size, th.plotBg);

  const model = data.frameModel(state.frame);
  const w = weights(state.mix);

  drawWave(
    ctx,
    th,
    L.wave[0],
    (n) => model.voicedTrace[n],
    w.v,
    model.scale,
    th.series[1],
    { long: "Voiced — harmonic oscillator bank", short: "Voiced — oscillators" },
    model.voicedHarmonics
      ? `${model.voicedHarmonics} osc x${w.v.toFixed(2)}`
      : "silent"
  );
  drawWave(
    ctx,
    th,
    L.wave[1],
    (n) => model.noiseTrace[n],
    w.u,
    model.scale,
    th.series[2],
    {
      long: "Unvoiced — noise shaped to the unvoiced bands",
      short: "Unvoiced — shaped noise",
    },
    model.noiseBands.length
      ? `${model.noiseBands.length} band${
          model.noiseBands.length === 1 ? "" : "s"
        } x${w.u.toFixed(2)}`
      : "silent"
  );
  drawWave(
    ctx,
    th,
    L.wave[2],
    (n) => model.voicedTrace[n] * w.v + model.noiseTrace[n] * w.u,
    1,
    model.scale,
    th.series[0],
    { long: "Sum — what the two generators add up to", short: "Sum" },
    state.mix === 50 ? "measured mix" : "your mix"
  );

  drawSpectrum(ctx, size, th, L.spectrum, model, data.spectra.decoded[state.frame], state, w);
  drawBands(ctx, size, th, L.bands, model);
}

/* ---------------------------------------------------------------------------
 * Mount
 * ------------------------------------------------------------------------ */

function readouts(refs, data, state) {
  const model = data.frameModel(state.frame);
  const w = weights(state.mix);
  const voicedBands = model.voicedBand.filter(Boolean).length;
  const f0 = model.f0 > 0 ? `${model.f0.toFixed(1)} Hz` : "none — unvoiced frame";
  refs.readouts.innerHTML = [
    `f<sub>0</sub> <b>${f0}</b>`,
    `harmonics below 4 kHz <b>${model.harmonicCount}</b>, in voiced bands <b>${model.voicedHarmonics}</b>`,
    `voiced bands <b>${voicedBands} of 8</b>`,
    `level <b>${model.rms.toFixed(1)} dBFS</b>`,
    `mix <b>voiced &times;${w.v.toFixed(2)} · noise &times;${w.u.toFixed(2)}</b>`,
  ]
    .map((s) => `<span>${s}</span>`)
    .join("");
  refs.mixout.textContent =
    state.mix === 50
      ? "measured mix"
      : state.mix > 50
      ? `voiced ${Math.round((state.mix - 50) * 2)}%`
      : `noise ${Math.round((50 - state.mix) * 2)}%`;
}

function init(root) {
  injectCSS();
  const refs = buildMarkup(root);
  refs.frame.dataset.state = "loading";

  return Promise.all([loadJSON(FRAMES), loadJSON(SPECTRA)]).then(
    ([framesFile, spectra]) => {
      delete refs.frame.dataset.state;
      const frames = framesFile.frames;
      const cache = new Map();
      const data = {
        spectra,
        frameModel(i) {
          if (!cache.has(i)) cache.set(i, buildFrameModel(frames, spectra, i));
          return cache.get(i);
        },
      };

      const startFrame = Math.min(98, frames.length - 1);
      const state = {
        frame: startFrame,
        mix: 50,
        overlay: true,
        reduced: prefersReducedMotion(),
      };

      let loop = null;

      // Width does not depend on height here, so setting the aspect from the
      // measured width converges after one extra resize.
      const fitFrame = (width) => {
        if (!width) return;
        const aspect =
          width >= TWO_COL ? "16 / 9" : `${width} / ${naturalHeight(width)}`;
        if (refs.frame.style.getPropertyValue("--anim-aspect") !== aspect) {
          refs.frame.style.setProperty("--anim-aspect", aspect);
        }
      };

      const handle = setupCanvas(refs.canvas, {
        onResize: (h) => {
          fitFrame(h.width);
          if (loop) loop.render();
        },
      });
      fitFrame(handle.width);

      loop = createLoop(
        () => paint(handle.ctx, handle, data, state),
        { element: root, autoplay: false }
      );

      const repaint = () => {
        readouts(refs, data, state);
        loop.render();
      };

      const transport = createTransport(root, {
        frames: frames.length,
        fps: PLAY_FPS,
        startFrame,
        format: (i) => `frame ${i} · ${(i * 0.02).toFixed(2)} s`,
        onFrame: (i) => {
          state.frame = i;
          repaint();
        },
      });

      const onMix = () => {
        state.mix = Number(refs.mix.value);
        repaint();
      };
      const onSnap = () => {
        refs.mix.value = "50";
        onMix();
      };
      const onOverlay = () => {
        state.overlay = refs.overlay.checked;
        repaint();
      };
      refs.mix.addEventListener("input", onMix);
      refs.snap.addEventListener("click", onSnap);
      refs.overlay.addEventListener("change", onOverlay);

      const offTheme = onThemeChange(repaint);

      repaint();

      return () => {
        offTheme();
        transport.destroy();
        loop.destroy();
        handle.destroy();
        refs.mix.removeEventListener("input", onMix);
        refs.snap.removeEventListener("click", onSnap);
        refs.overlay.removeEventListener("change", onOverlay);
      };
    }
  );
}

mount(`[data-anim="${SLUG}"]`, init);

export { init };
