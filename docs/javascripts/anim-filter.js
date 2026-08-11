/* ===========================================================================
 * anim-filter.js — push four shapes through a filter, and see which survives.
 * ---------------------------------------------------------------------------
 * SLUG          filter           <div data-anim="filter"></div>
 *
 * DATA READ     none. Every sample here is synthesised and filtered in the
 *               browser. There is nothing measured to load, and nothing about
 *               this figure is specific to speech or to AMBE.
 *
 * CONTROLS      • four shapes: sine, square, triangle, sawtooth
 *               • a cutoff slider, which moves the filter's resonance
 *               • "Rescale and realign", which is the whole point (below)
 *
 * WHAT IT DRAWS Top panel: the shape going in. Bottom panel: the same shape
 *               after a two-pole resonant low-pass filter, run as an actual
 *               difference equation over the samples rather than drawn by
 *               hand.
 *
 * THE CLAIM     Chapter 01 argues that sinusoids are the only inputs a linear
 *               time-invariant filter cannot reshape: it may scale them and
 *               delay them, nothing else. The three non-sine shapes are there
 *               to be contrasted, and a reader is entitled to suspect the
 *               difference is just "the output got quieter and moved".
 *
 *               "Rescale and realign" removes that objection. It scales the
 *               output back to the input's amplitude and shifts it by the
 *               measured delay, which are exactly the two liberties the claim
 *               allows a filter. The sine then lies on top of its input with
 *               nothing left over. The other three do not, and cannot, because
 *               the filter has treated their harmonics differently from their
 *               fundamentals. The residual drawn underneath is what is left
 *               after the two allowed liberties are undone, and for the sine
 *               it is a flat line.
 *
 * HONESTY       The residual for the sine is not exactly zero: it is limited
 *               by the settling of the filter and by floating point, and it
 *               reads as a fraction of a percent. The readout says the number
 *               rather than claiming a clean zero.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  mount as mountAnim,
  setupCanvas,
  createPlot,
  clearCanvas,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  onThemeChange,
} from "./anim-core.js";

const SLUG = "filter";

/** Internal sample rate. High enough that a square edge draws as an edge. */
const SR = 48000;

/** The input's fundamental. Fixed: the slider moves the filter, not the tone. */
const F0 = 150;

/** How many cycles are drawn. */
const CYCLES = 3;

/** Cycles run before capture, so what is drawn is the settled response. */
const SETTLE_CYCLES = 120;

/**
 * Filter sharpness. High enough that the resonance visibly rings a square
 * wave, low enough that the sine case still settles inside SETTLE_CYCLES.
 */
const Q = 4;

const SHAPES = [
  { id: "sine", label: "Sine" },
  { id: "square", label: "Square" },
  { id: "triangle", label: "Triangle" },
  { id: "sawtooth", label: "Sawtooth" },
];

/* --- signal generation --------------------------------------------------- */

/**
 * One cycle of a shape, at phase `p` in [0, 1).
 *
 * The three non-sine shapes are built from their Fourier series rather than
 * from their defining piecewise formula, truncated below the Nyquist rate.
 * A literal square wave sampled at 48 kHz aliases, and the aliases would show
 * up in the output as artefacts of the sampling rather than of the filter,
 * which is precisely the confusion this figure exists to avoid.
 */
function shapeValue(id, p) {
  const TAU = Math.PI * 2;
  if (id === "sine") return Math.sin(TAU * p);

  const maxHarmonic = Math.floor(SR / 2 / F0);
  let sum = 0;
  if (id === "square") {
    for (let k = 1; k <= maxHarmonic; k += 2) sum += Math.sin(TAU * k * p) / k;
    return sum * (4 / Math.PI);
  }
  if (id === "triangle") {
    for (let k = 1; k <= maxHarmonic; k += 2) {
      const sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1;
      sum += (sign * Math.sin(TAU * k * p)) / (k * k);
    }
    return sum * (8 / (Math.PI * Math.PI));
  }
  // sawtooth
  for (let k = 1; k <= maxHarmonic; k += 1) sum += Math.sin(TAU * k * p) / k;
  return sum * (2 / Math.PI);
}

/**
 * RBJ biquad low-pass coefficients. Textbook, and the same filter every audio
 * tool ships; nothing here is particular to speech.
 */
function lowpass(cutoffHz) {
  const w0 = (2 * Math.PI * cutoffHz) / SR;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = (1 - cos) / 2;
  const b1 = 1 - cos;
  const b2 = (1 - cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return {
    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
    a1: a1 / a0, a2: a2 / a0,
  };
}

/**
 * Generate the input, run the filter, and return one settled window of each.
 *
 * The filter runs for SETTLE_CYCLES before anything is kept, so the drawn
 * window is the steady-state response and not the switch-on transient. That
 * matters: the transient is a real thing a filter does, but it is not what
 * "sinusoids come out as sinusoids" is about, and drawing it would look like
 * the claim failing.
 */
function run(shapeId, cutoffHz) {
  const perCycle = Math.round(SR / F0);
  // One cycle more than is drawn. align() may shift the output by up to a
  // whole cycle to find the best match, and that shift has to come out of
  // spare samples rather than out of the visible window: taking it from the
  // window would leave the last third of the panel empty.
  const keep = perCycle * (CYCLES + 1);
  const total = perCycle * SETTLE_CYCLES + keep;
  const c = lowpass(cutoffHz);

  const input = new Float64Array(keep);
  const output = new Float64Array(keep);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let n = 0; n < total; n += 1) {
    const x = shapeValue(shapeId, (n % perCycle) / perCycle);
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    const k = n - (total - keep);
    if (k >= 0) {
      input[k] = x;
      output[k] = y;
    }
  }
  return { input, output, perCycle };
}

/**
 * The two liberties a filter is allowed: a gain and a delay.
 *
 * Found by searching integer sample shifts for the one that best matches the
 * output to the input, then taking the least-squares gain at that shift. This
 * is a measurement of the output, not an assumption about it: if the filter
 * had reshaped the signal, the best available gain and shift would still be
 * found, and the residual would simply stay large.
 */
function align(input, output, perCycle) {
  let best = { shift: 0, gain: 1, residual: Infinity };
  const n = input.length - perCycle;
  for (let s = 0; s < perCycle; s += 1) {
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < n; i += 1) {
      const o = output[i + s];
      dot += o * input[i];
      energy += o * o;
    }
    if (energy <= 0) continue;
    const gain = dot / energy;
    let err = 0;
    for (let i = 0; i < n; i += 1) {
      const d = input[i] - gain * output[i + s];
      err += d * d;
    }
    if (err < best.residual) best = { shift: s, gain, residual: err };
  }

  let inputEnergy = 0;
  for (let i = 0; i < n; i += 1) inputEnergy += input[i] * input[i];
  // Residual as a percentage of the input, in RMS terms. Zero means the two
  // allowed liberties account for everything the filter did.
  const pct = inputEnergy > 0
    ? Math.sqrt(best.residual / inputEnergy) * 100
    : 0;
  return { ...best, pct };
}

/* --- markup -------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Four shapes, one filter</p>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 16 / 9">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="Top: a chosen waveform going into a filter. Bottom: the same waveform coming out. With rescaling and realignment switched on, the sine wave's output lies exactly on its input and the other shapes do not."></canvas>
</div>

<div class="anim-controls">
  <div class="anim-controls__group" role="group" aria-label="Input shape">
    ${SHAPES.map(
      (s, i) =>
        `<button class="anim-btn" type="button" data-shape="${s.id}"
                 aria-pressed="${i === 0 ? "true" : "false"}">${s.label}</button>`
    ).join("\n    ")}
  </div>
  <label class="anim-field">
    <span class="anim-field__label">Cutoff</span>
    <input class="anim-range" type="range" min="120" max="1600" step="10" value="330"
           data-role="cutoff" aria-label="Filter cutoff frequency in hertz">
  </label>
  <button class="anim-btn" type="button" data-role="align" aria-pressed="false">Rescale and realign</button>
</div>

<div class="anim-forms" data-role="readout" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">filter did</span>
    <code data-role="r-what"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">left over</span>
    <code data-role="r-residual"></code></p>
</div>

<p class="anim-figure__caption">
  The input is fixed at ${F0}&nbsp;Hz. The slider moves the filter, not the tone.
  Every shape that is not a sine comes out as a different shape: the square's
  corners round off and its flat tops ring, the sawtooth's ramp bends, the
  triangle's point is blunted. The sine comes out a sine.
  Press <em>Rescale and realign</em> to undo the only two things a filter is
  allowed to do, scale and delay, and watch what is left. For the sine,
  nothing is. That is what "survives a filter" means, and it is the reason the
  rest of this site is written in sinusoids.
  <span class="anim-figure__source">Synthesised and filtered in your browser
  with a two-pole low-pass. Nothing here is measured, and nothing here is
  specific to AMBE.</span>
</p>
`;

/* --- module -------------------------------------------------------------- */

/**
 * Mount the filter figure.
 * @param {Element} root a `[data-anim="filter"]` element
 * @returns {() => void} cleanup
 */
export function mount(root) {
  root.classList.add("anim-figure");
  if (!root.querySelector(".anim-figure__frame")) root.innerHTML = FIGURE_HTML;

  const canvas = root.querySelector("canvas");
  const cutoffEl = root.querySelector('[data-role="cutoff"]');
  const alignEl = root.querySelector('[data-role="align"]');
  const whatEl = root.querySelector('[data-role="r-what"]');
  const residEl = root.querySelector('[data-role="r-residual"]');
  const shapeEls = Array.from(root.querySelectorAll("[data-shape]"));

  const state = { shape: "sine", cutoff: 330, aligned: false, result: null };

  const handle = setupCanvas(canvas, { onResize: () => render() });

  function recompute() {
    const { input, output, perCycle } = run(state.shape, state.cutoff);
    state.result = { input, output, perCycle, fit: align(input, output, perCycle) };
  }

  function render() {
    if (!state.result) recompute();
    const { input, output, perCycle, fit } = state.result;
    const th = getTheme();
    const ctx = handle.ctx;
    const W = handle.width;
    const H = handle.height;
    clearCanvas(ctx, handle);

    const stacked = W < 560;
    const gap = stacked ? 18 : 24;
    const half = (H - gap) / 2;
    const padL = stacked ? 30 : 42;
    const padR = 14;

    // Both panels share a y domain so the two are honestly comparable: a
    // per-panel autoscale would hide the fact that the filter changed the
    // level, which is one of the two things it is allowed to do.
    let peak = 0;
    for (let i = 0; i < input.length; i += 1) {
      peak = Math.max(peak, Math.abs(input[i]), Math.abs(output[i]));
    }
    const extent = (peak || 1) * 1.12;

    const panel = (top, height) =>
      createPlot(
        { width: W, height: H },
        {
          xDomain: [0, CYCLES],
          yDomain: [-extent, extent],
          padding: { top, right: padR, bottom: H - top - height, left: padL },
        }
      );

    const inPlot = panel(10, half - 26);
    const outPlot = panel(half + gap - 4, half - 26);

    const series = (values, shift) => {
      const pts = [];
      const n = values.length - perCycle;
      const step = Math.max(1, Math.floor(n / 900));
      for (let i = 0; i < n; i += step) {
        pts.push({ x: (i / perCycle), y: values[i + (shift || 0)] });
      }
      return pts;
    };

    const xTicks = [0, 1, 2, 3];
    const fmtX = (v) => (v === 0 ? "0" : `${v}`);

    for (const [plot, title] of [[inPlot, "in"], [outPlot, "out"]]) {
      drawGrid(ctx, plot, { xTicks, yTicks: [0] });
      drawAxes(ctx, plot, {
        xTicks,
        yTicks: [],
        formatX: fmtX,
        xLabel: title === "out" ? "cycles" : undefined,
      });
    }

    // Input, drawn in both panels: on top as itself, underneath as the
    // reference the output is being compared against.
    drawPolyline(ctx, series(input, 0), {
      plot: inPlot,
      color: th.series[0],
      width: 2.2,
    });

    ctx.save();
    outPlot.clip(ctx);
    drawPolyline(ctx, series(input, 0), {
      plot: outPlot,
      color: th.muted,
      width: 1.4,
      dash: [4, 4],
    });

    if (state.aligned) {
      // Undo the gain and the delay, which are exactly the two liberties the
      // claim allows. Whatever is still visible is the reshaping.
      const scaled = new Float64Array(output.length);
      for (let i = 0; i < output.length; i += 1) scaled[i] = output[i] * fit.gain;
      drawPolyline(ctx, series(scaled, fit.shift), {
        plot: outPlot,
        color: th.series[1],
        width: 2.2,
      });

      const resid = [];
      const n = input.length - perCycle;
      const step = Math.max(1, Math.floor(n / 900));
      for (let i = 0; i < n; i += step) {
        resid.push({ x: i / perCycle, y: input[i] - scaled[i + fit.shift] });
      }
      drawPolyline(ctx, resid, {
        plot: outPlot,
        color: th.accentWarm,
        width: 1.6,
      });
    } else {
      drawPolyline(ctx, series(output, 0), {
        plot: outPlot,
        color: th.series[1],
        width: 2.2,
      });
    }
    ctx.restore();

    drawLabel(ctx, "going in", inPlot.area.left + 6, inPlot.area.top + 4, {
      align: "left", baseline: "top", size: 11, color: th.series[0],
      background: th.plotBg, padding: 3,
    });
    drawLabel(
      ctx,
      state.aligned ? "coming out, rescaled and realigned" : "coming out",
      outPlot.area.left + 6,
      outPlot.area.top + 4,
      {
        align: "left", baseline: "top", size: 11, color: th.series[1],
        background: th.plotBg, padding: 3,
      }
    );
    if (state.aligned) {
      drawLabel(ctx, "what is left over", outPlot.area.right - 6, outPlot.area.top + 4, {
        align: "right", baseline: "top", size: 11, color: th.accentWarm,
        background: th.plotBg, padding: 3,
      });
    }

    // Readouts. The delay is reported in cycles rather than samples, because
    // the sample rate here is an implementation detail of the drawing.
    // fit.gain maps the output back onto the input, so the filter's own gain
    // is its reciprocal. Report the filter's, which is what the reader is
    // watching.
    const delayCycles = fit.shift / perCycle;
    whatEl.textContent =
      `cutoff ${state.cutoff} Hz · scaled by ×${(1 / fit.gain).toFixed(3)}` +
      ` · delayed by ${delayCycles.toFixed(3)} cycle`;
    const pct = fit.pct;
    residEl.textContent =
      pct < 1
        ? `${pct.toFixed(2)}% of the input — the shape survived`
        : `${pct.toFixed(1)}% of the input — the shape did not survive`;
    residEl.dataset.verdict = pct < 1 ? "survived" : "reshaped";
  }

  function refresh() {
    recompute();
    render();
  }

  for (const el of shapeEls) {
    el.addEventListener("click", () => {
      state.shape = el.dataset.shape;
      for (const other of shapeEls) {
        other.setAttribute("aria-pressed", other === el ? "true" : "false");
      }
      refresh();
    });
  }
  cutoffEl.addEventListener("input", () => {
    state.cutoff = Number(cutoffEl.value);
    refresh();
  });
  alignEl.addEventListener("click", () => {
    state.aligned = !state.aligned;
    alignEl.setAttribute("aria-pressed", String(state.aligned));
    render();
  });

  const offTheme = onThemeChange(() => render());
  refresh();

  return () => {
    offTheme();
    handle.destroy();
  };
}

mountAnim(`[data-anim="${SLUG}"]`, mount);
