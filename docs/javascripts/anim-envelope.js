/* ===========================================================================
 * anim-envelope.js — "envelope": harmonic amplitudes and the shape they draw
 * ---------------------------------------------------------------------------
 * SLUG      envelope        place it with  <div data-anim="envelope"></div>
 *
 * DATA READ (precomputed, site-root-relative; see docs/assets/data/SCHEMA.md)
 *   assets/data/spectra.json   FFT magnitude of the captured audio, per frame
 *   assets/data/frames.json    per-frame derived pitch, level and voicing
 *
 * CONTROLS
 *   "Amplitude step"   slider, 0 … 12 dB — rounds the displayed amplitudes to
 *                      a coarser grid so the reader watches the envelope lose
 *                      detail. Keyboard: Tab to it, arrow keys to step.
 *   "Frame"            slider over the strongly voiced frames of the clip.
 *   "Measured spectrum" checkbox — show/hide the underlying FFT trace.
 *   Pointer            hover or drag across the plot to inspect one harmonic.
 *
 * WHAT THIS FILE IS NOT
 *   It is a drawing program. It contains no AMBE analysis, no quantiser, no
 *   codebook, no bit packing and no synthesis. The amplitudes it plots are
 *   read off a precomputed FFT of a WAV file at multiples of a precomputed
 *   pitch estimate; the "amplitude step" control is `Math.round(dB / step) *
 *   step` — plain arithmetic rounding, done for illustration. The real
 *   codec's spectral-amplitude representation is not observable from outside
 *   the chip (SCHEMA.md, "What is deliberately absent") and is not modelled
 *   here.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  mount as autoMount,
  setupCanvas,
  clearCanvas,
  createPlot,
  drawGrid,
  drawAxes,
  drawLabel,
  drawPolyline,
  loadJSON,
  getTheme,
  onThemeChange,
  crisp,
} from "./anim-core.js";

const SLUG = "envelope";
const STYLE_ID = "anim-envelope-style";

/* Sizing only. Every colour comes from the shared tokens via getTheme(). */
const STYLE = `
[data-anim="envelope"] .anim-figure__frame {
  --anim-aspect: 16 / 9;
  --anim-min-width: 300px;
}
@media screen and (max-width: 46em) {
  [data-anim="envelope"] .anim-figure__frame { --anim-aspect: 4 / 3; }
}
`;

/** Rounding grids offered by the slider, in dB. 0 means "no rounding". */
const STEPS_DB = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 9, 12];

/** Harmonics are drawn up to here; the FFT itself stops at 3968.75 Hz. */
const TOP_HZ = 3900;

/* ---------------------------------------------------------------------------
 * Markup
 * ------------------------------------------------------------------------ */

const TEMPLATE = `
  <div class="anim-figure__head">
    <p class="anim-figure__title">Harmonic amplitudes, and what precision costs</p>
  </div>

  <div class="anim-figure__scroll">
    <div class="anim-figure__frame" data-state="loading">
      <canvas class="anim-figure__canvas"
              aria-label="Amplitude of each harmonic of one 20 millisecond frame, and the smooth envelope through them, redrawn as the amplitudes are rounded to a coarser grid"></canvas>
    </div>
  </div>

  <ul class="anim-legend">
    <li class="anim-legend__item"><i class="anim-legend__swatch is-data-1"></i>harmonic amplitude (displayed precision)</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line is-data-1"></i>envelope through them</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line is-data-4"></i>envelope at full precision</li>
    <li class="anim-legend__item"><i class="anim-legend__swatch is-data-3"></i>amount each amplitude moved</li>
  </ul>

  <div class="anim-controls">
    <label class="anim-field">
      <span class="anim-field__label">Amplitude step</span>
      <input class="anim-range" data-role="step" type="range" min="0" max="${STEPS_DB.length - 1}"
             step="1" value="0" aria-label="Amplitude rounding step, in decibels">
    </label>
    <output class="anim-readout anim-readout--wide" data-role="step-out">exact</output>

    <label class="anim-field">
      <span class="anim-field__label">Frame</span>
      <input class="anim-range" data-role="frame" type="range" min="0" max="0" step="1" value="0"
             aria-label="Which 20 millisecond frame of the clip to show">
    </label>
    <output class="anim-readout anim-readout--wide" data-role="frame-out">—</output>

    <label class="anim-controls__group" style="cursor: pointer">
      <input class="anim-check" data-role="spectrum" type="checkbox" checked>
      <span class="anim-field__label">Measured spectrum</span>
    </label>
  </div>
`;

const CAPTION = `
  One 20 ms frame of real speech. Each dot is the amplitude of one harmonic of
  the measured pitch; the line is the smooth envelope those dots define — the
  shape a vocoder has to transmit. Drag <strong>Amplitude step</strong> up and
  watch the dots snap to a coarser grid and the envelope flatten: the dashed
  line is where it was, and the amber stems show how far each amplitude moved.
  Try 1 dB (barely visible), then 6 dB (formants blunted), then 12 dB (the
  vowel's identity is going). Then change <strong>Frame</strong> to see how
  much the shape moves between one 20 ms slice and the next.
  <span class="anim-figure__source">
    Source: FFT of a ThumbDV (DVSI AMBE-3000) capture — <code>assets/data/spectra.json</code>,
    amplitudes sampled at multiples of the pitch in <code>assets/data/frames.json</code>.
    The rounding is <code>round(dB / step) × step</code>, arithmetic for
    illustration only: it is <em>not</em> AMBE's quantiser, which uses
    prediction and trained vector codebooks whose contents have never been
    published (US 5,630,011; see the chapter above). The chip does not report
    its own amplitude parameters, so no figure on this site claims to show
    them.
  </span>
`;

/* ---------------------------------------------------------------------------
 * Small generic helpers (display maths only)
 * ------------------------------------------------------------------------ */

/** Uniform Catmull-Rom through evenly spaced points — a smooth curve for the
 *  eye, nothing more. Points must be sorted and equally spaced in x. */
function smoothCurve(points, perSegment = 14) {
  if (points.length < 3) return points.slice();
  const p = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < p.length - 2; i += 1) {
    const p0 = p[i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2];
    for (let s = 0; s < perSegment; s += 1) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(p[p.length - 2]);
  return out;
}

/** Pick the first pair of header strings that fits the width without the two
 *  colliding. Purely a layout convenience. */
function fitPair(ctx, font, lefts, rights, width, gap = 18) {
  ctx.save();
  ctx.font = font;
  let choice = [lefts[lefts.length - 1], rights[rights.length - 1]];
  outer: for (let r = 0; r < rights.length; r += 1) {
    for (let l = 0; l < lefts.length; l += 1) {
      const total =
        ctx.measureText(lefts[l]).width + ctx.measureText(rights[r]).width + gap;
      if (total <= width) {
        choice = [lefts[l], rights[r]];
        break outer;
      }
    }
  }
  ctx.restore();
  return choice;
}

function withAlpha(ctx, alpha, fn) {
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  fn();
  ctx.globalAlpha = previous;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/** Replace the host's contents with our figure, keeping an author caption. */
function buildFigure(host) {
  let figure = host;
  if (!host.classList.contains("anim-figure")) {
    figure = document.createElement("figure");
    figure.className = "anim-figure";
    host.textContent = "";
    host.appendChild(figure);
  }
  const authored = figure.querySelector("figcaption");
  figure.textContent = "";
  figure.insertAdjacentHTML("afterbegin", TEMPLATE);
  const caption = authored || document.createElement("figcaption");
  if (!authored) {
    caption.className = "anim-figure__caption";
    caption.innerHTML = CAPTION;
  }
  figure.appendChild(caption);
  return figure;
}

/* ---------------------------------------------------------------------------
 * Mount
 * ------------------------------------------------------------------------ */

/**
 * Build the "envelope" figure inside `host`.
 * @param {Element} host an element carrying data-anim="envelope"
 * @returns {Promise<() => void>} cleanup
 */
export async function mount(host) {
  ensureStyle();
  const figure = buildFigure(host);
  const frameBox = figure.querySelector(".anim-figure__frame");
  const canvas = figure.querySelector(".anim-figure__canvas");
  const stepInput = figure.querySelector('[data-role="step"]');
  const frameInput = figure.querySelector('[data-role="frame"]');
  const spectrumInput = figure.querySelector('[data-role="spectrum"]');
  const stepOut = figure.querySelector('[data-role="step-out"]');
  const frameOut = figure.querySelector('[data-role="frame-out"]');

  const [frameData, spectra] = await Promise.all([
    loadJSON("assets/data/frames.json"),
    loadJSON("assets/data/spectra.json"),
  ]);
  delete frameBox.dataset.state;

  const binHz = spectra.bin_hz;
  const bins = spectra.bins;
  const allFrames = frameData.frames;

  // Frames worth looking at: confidently voiced and not near-silent. Picking
  // which frame to display is an editorial choice, not an analysis step.
  let choices = allFrames
    .map((f, i) => ({ i, d: f.derived }))
    .filter(
      (f) =>
        f.d.voiced &&
        f.d.orig_f0_hz > 0 &&
        f.d.orig_f0_confidence >= 0.6 &&
        f.d.orig_rms_dbfs > -32
    );
  if (choices.length === 0) {
    choices = allFrames
      .map((f, i) => ({ i, d: f.derived }))
      .filter((f) => f.d.orig_f0_hz > 0);
  }

  // Default to the most confidently pitched frame in the clip.
  let best = 0;
  choices.forEach((c, k) => {
    if (c.d.orig_f0_confidence > choices[best].d.orig_f0_confidence) best = k;
  });

  frameInput.max = String(choices.length - 1);
  frameInput.value = String(best);

  let choiceIndex = best;
  let stepIndex = 0;
  let showSpectrum = true;
  let hoverHz = null;

  /* -- harmonic amplitudes, read off the precomputed spectrum ------------ */

  const harmonicCache = new Map();

  function harmonicsAt(frameIndex) {
    if (harmonicCache.has(frameIndex)) return harmonicCache.get(frameIndex);
    const f0 = allFrames[frameIndex].derived.orig_f0_hz;
    const row = spectra.original[frameIndex];
    const out = [];
    if (f0 > 0 && row) {
      for (let m = 1; m * f0 <= TOP_HZ; m += 1) {
        const hz = m * f0;
        const centre = Math.round(hz / binHz);
        // Peak of the nearest bins: a harmonic rarely lands on a bin centre,
        // and the analysis window's main lobe is a few bins wide.
        let db = -Infinity;
        for (let d = -1; d <= 1; d += 1) {
          const k = centre + d;
          if (k >= 0 && k < bins) db = Math.max(db, row[k]);
        }
        if (isFinite(db)) out.push({ m, hz, db });
      }
    }
    harmonicCache.set(frameIndex, out);
    return out;
  }

  const coarsen = (db, step) => (step > 0 ? Math.round(db / step) * step : db);

  /* -- readouts --------------------------------------------------------- */

  function syncReadouts(harmonics, step) {
    stepOut.textContent = step > 0 ? `${step} dB steps` : "exact";
    stepInput.setAttribute(
      "aria-valuetext",
      step > 0 ? `${step} decibel steps` : "full precision"
    );

    const frameIndex = choices[choiceIndex].i;
    const f = allFrames[frameIndex];
    frameOut.textContent = `#${f.i} · ${f.t.toFixed(2)} s`;
    frameInput.setAttribute(
      "aria-valuetext",
      `frame ${f.i}, ${f.t.toFixed(2)} seconds, ${harmonics.length} harmonics`
    );
  }

  /* -- drawing ---------------------------------------------------------- */

  const view = setupCanvas(canvas, { onResize: () => draw() });
  const ctx = view.ctx;

  /** The plot laid out by the last repaint, so pointer maths matches it. */
  let lastPlot = null;

  function draw() {
    const theme = getTheme();
    const step = STEPS_DB[stepIndex];
    const frameIndex = choices[choiceIndex].i;
    const frame = allFrames[frameIndex];
    const harmonics = harmonicsAt(frameIndex);
    const row = spectra.original[frameIndex];

    syncReadouts(harmonics, step);
    clearCanvas(ctx, view, theme.plotBg);
    if (harmonics.length === 0) return;

    const compact = view.width < 520;

    let hi = -Infinity;
    let lo = Infinity;
    for (const h of harmonics) {
      hi = Math.max(hi, h.db);
      lo = Math.min(lo, h.db);
    }
    const yTop = Math.ceil((hi + 9) / 5) * 5;
    const yBot = Math.min(Math.floor((lo - 9) / 5) * 5, yTop - 40);

    const plot = createPlot(view, {
      xDomain: [0, 4000],
      yDomain: [yBot, yTop],
      padding: {
        top: compact ? 38 : 44,
        right: 14,
        bottom: compact ? 34 : 42,
        left: 46,
      },
    });

    lastPlot = plot;

    const xTicks = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
    const yTicks = [];
    for (let v = yBot; v <= yTop; v += 10) yTicks.push(v);

    drawGrid(ctx, plot, { xTicks, yTicks });
    drawAxes(ctx, plot, {
      xTicks,
      yTicks,
      formatX: (v) => (v === 0 ? "0" : `${(v / 1000).toFixed(1)}k`),
      formatY: (v) => String(v),
      xLabel: compact ? "" : "frequency (Hz)",
      yLabel: compact ? "" : "amplitude (dBFS)",
    });

    const raw = harmonics.map((h) => ({ x: h.hz, y: h.db }));
    const coarse = harmonics.map((h) => ({ x: h.hz, y: coarsen(h.db, step) }));

    ctx.save();
    plot.clip(ctx);

    // The measured FFT the harmonic amplitudes were read off.
    if (showSpectrum && row) {
      const trace = [];
      for (let k = 0; k < bins; k += 1) {
        const hz = spectra.bin_centre_hz[k];
        if (hz > 4000) break;
        trace.push({ x: hz, y: Math.max(row[k], yBot) });
      }
      withAlpha(ctx, 0.45, () => {
        drawPolyline(ctx, trace, {
          plot,
          color: theme.series[3],
          width: 1,
        });
      });
    }

    // Envelope before rounding, kept as a ghost once rounding is on.
    if (step > 0) {
      drawPolyline(ctx, smoothCurve(raw), {
        plot,
        color: theme.muted,
        width: 1.5,
        dash: [5, 4],
      });
    }

    // Envelope at the displayed precision.
    drawPolyline(ctx, smoothCurve(coarse), {
      plot,
      color: theme.series[0],
      width: 2.4,
      fill: theme.css("--ambe-accent-soft", "rgba(125,140,255,0.14)"),
      fillBaseline: yBot,
    });

    // Which harmonic the pointer is nearest, if any.
    let hoverIndex = -1;
    if (hoverHz !== null) {
      let bestDelta = Infinity;
      for (let n = 0; n < harmonics.length; n += 1) {
        const delta = Math.abs(harmonics[n].hz - hoverHz);
        if (delta < bestDelta) {
          bestDelta = delta;
          hoverIndex = n;
        }
      }
    }

    // Stems, markers, and the move each amplitude made.
    for (let n = 0; n < harmonics.length; n += 1) {
      const h = harmonics[n];
      const px = plot.x(h.hz);
      const pyCoarse = plot.y(coarse[n].y);
      const pyRaw = plot.y(h.db);
      const hovered = n === hoverIndex;

      withAlpha(ctx, 0.35, () => {
        ctx.strokeStyle = theme.series[0];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crisp(px), plot.area.bottom);
        ctx.lineTo(crisp(px), pyCoarse);
        ctx.stroke();
      });

      if (Math.abs(coarse[n].y - h.db) > 0.05) {
        ctx.strokeStyle = theme.series[2];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, pyRaw);
        ctx.lineTo(px, pyCoarse);
        ctx.stroke();

        ctx.strokeStyle = theme.muted;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, pyRaw, 2.6, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = theme.series[0];
      ctx.beginPath();
      ctx.arc(px, pyCoarse, hovered ? 5 : 3.4, 0, Math.PI * 2);
      ctx.fill();
      if (hovered) {
        ctx.strokeStyle = theme.plotBg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    ctx.restore();

    // Hover inspection.
    if (hoverIndex >= 0) {
      const nearest = harmonics[hoverIndex];
      const nearestIndex = hoverIndex;
      const px = plot.x(nearest.hz);
      const py = plot.y(coarse[nearestIndex].y);

      withAlpha(ctx, 0.5, () => {
        ctx.strokeStyle = theme.series[0];
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(crisp(px), plot.area.top);
        ctx.lineTo(crisp(px), plot.area.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      const moved = coarse[nearestIndex].y - nearest.db;
      const text =
        `harmonic ${nearest.m} · ${Math.round(nearest.hz)} Hz · ` +
        (step > 0
          ? `${nearest.db.toFixed(1)} → ${coarse[nearestIndex].y.toFixed(1)} dB (${
              moved >= 0 ? "+" : ""
            }${moved.toFixed(1)})`
          : `${nearest.db.toFixed(1)} dB`);
      ctx.save();
      ctx.font = `400 11px ${theme.mono}`;
      const textWidth = ctx.measureText(text).width;
      ctx.restore();
      const align =
        px + 10 + textWidth > plot.area.right - 4 ? "right" : "left";
      drawLabel(ctx, text, align === "right" ? px - 10 : px + 10, py - 14, {
        align,
        baseline: "middle",
        size: 11,
        mono: true,
        color: theme.ink,
        background: theme.surface2,
        padding: 5,
      });
    }

    // Header line: what frame this is on the left, what the rounding cost on
    // the right, in whichever wording fits the canvas.
    const f0 = frame.derived.orig_f0_hz;
    let err = 0;
    for (let n = 0; n < harmonics.length; n += 1) {
      const d = coarse[n].y - harmonics[n].db;
      err += d * d;
    }
    err = Math.sqrt(err / harmonics.length);

    const size = compact ? 10.5 : 11.5;
    const [leftText, rightText] = fitPair(
      ctx,
      `550 ${size}px ${theme.font}`,
      [
        `frame ${frame.i} · t = ${frame.t.toFixed(2)} s · pitch ${f0.toFixed(
          0
        )} Hz · ${harmonics.length} harmonics below 3.9 kHz`,
        `frame ${frame.i} · ${frame.t.toFixed(2)} s · ${f0.toFixed(0)} Hz · ${
          harmonics.length
        } harmonics`,
        `frame ${frame.i} · ${f0.toFixed(0)} Hz · ${harmonics.length} harmonics`,
        `frame ${frame.i} · ${harmonics.length} harmonics`,
      ],
      step > 0
        ? [
            `rounded to ${step} dB · RMS error ${err.toFixed(2)} dB`,
            `${step} dB steps · err ${err.toFixed(2)} dB`,
            `${step} dB steps`,
          ]
        : ["displayed at full precision", "full precision", "exact"],
      plot.area.width
    );

    drawLabel(ctx, leftText, plot.area.left, compact ? 14 : 16, {
      align: "left",
      baseline: "top",
      size,
      weight: 550,
      color: theme.ink,
    });
    drawLabel(ctx, rightText, plot.area.right, compact ? 14 : 16, {
      align: "right",
      baseline: "top",
      size,
      weight: 550,
      color: step > 0 ? theme.series[2] : theme.muted,
    });
  }

  /* -- interaction ------------------------------------------------------ */

  const onStep = () => {
    stepIndex = Math.min(
      Math.max(Number(stepInput.value) | 0, 0),
      STEPS_DB.length - 1
    );
    draw();
  };
  const onFrame = () => {
    choiceIndex = Math.min(
      Math.max(Number(frameInput.value) | 0, 0),
      choices.length - 1
    );
    draw();
  };
  const onSpectrum = () => {
    showSpectrum = spectrumInput.checked;
    draw();
  };

  stepInput.addEventListener("input", onStep);
  frameInput.addEventListener("input", onFrame);
  spectrumInput.addEventListener("change", onSpectrum);

  const pointerHz = (event) => {
    if (!lastPlot) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * view.width;
    if (x < lastPlot.area.left - 14 || x > lastPlot.area.right + 14) return null;
    return Math.min(Math.max(lastPlot.invertX(x), 0), 4000);
  };

  const onPointerMove = (event) => {
    const hz = pointerHz(event);
    if (hz === hoverHz) return;
    hoverHz = hz;
    draw();
  };
  const onPointerLeave = () => {
    if (hoverHz === null) return;
    hoverHz = null;
    draw();
  };
  const onPointerDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    onPointerMove(event);
  };

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointercancel", onPointerLeave);

  const unsubscribe = onThemeChange(() => draw());

  draw();

  return () => {
    unsubscribe();
    view.destroy();
    stepInput.removeEventListener("input", onStep);
    frameInput.removeEventListener("input", onFrame);
    spectrumInput.removeEventListener("change", onSpectrum);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("pointercancel", onPointerLeave);
  };
}

export default mount;

// Self-register: anim-core's mount() handles DOMContentLoaded and the
// navigation.instant page swaps, and tears each instance down on the way out.
autoMount(`[data-anim="${SLUG}"]`, mount);
