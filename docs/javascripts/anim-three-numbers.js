/* ===========================================================================
 * anim-three-numbers.js — amplitude, frequency, phase, one at a time.
 * ---------------------------------------------------------------------------
 * SLUG          three-numbers    <div data-anim="three-numbers"></div>
 *
 * DATA READ     none. Three sliders and a sine.
 *
 * CONTROLS      • amplitude, frequency and phase sliders
 *               • "Reset", which puts the wave back on the reference
 *
 * WHAT IT DRAWS One sinusoid, and behind it a fixed reference sinusoid at
 *               amplitude 1, frequency 1 and phase 0. Every slider moves the
 *               live wave off the reference in one specific way, and the
 *               reference stays put so the reader can see which way.
 *
 * WHY A REFERENCE
 *               Amplitude and frequency are legible from a single wave: taller
 *               is louder, more cycles is higher. Phase is not. A sinusoid
 *               shifted in time looks exactly like a sinusoid, because it is
 *               one. Phase only becomes visible as a relationship between two
 *               waves, so the figure draws two. That is also the honest
 *               preparation for chapter 04, where phase turns out to matter
 *               far less to the ear than the other two: the reader should
 *               already have noticed that the phase slider is the one whose
 *               effect is hardest to see.
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

const SLUG = "three-numbers";

/** Cycles of the reference wave across the panel. */
const SPAN = 3;
const POINTS = 720;
const TAU = Math.PI * 2;

const DEFAULTS = { amp: 1, freq: 1, phase: 0 };

/* --- markup -------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">The three numbers, one wave</p>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 16 / 7">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="A sinusoid controlled by amplitude, frequency and phase sliders, drawn over a fixed reference sinusoid so that a phase shift is visible as a displacement between the two."></canvas>
</div>

<ul class="anim-legend">
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-1"></i>the wave you are changing</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--ghost"></i>the reference it started as</li>
</ul>

<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Amplitude</span>
    <input class="anim-range" type="range" min="10" max="150" step="1" value="100"
           data-role="amp" aria-label="Amplitude, hundredths">
  </label>
  <label class="anim-field">
    <span class="anim-field__label">Frequency</span>
    <input class="anim-range" type="range" min="50" max="400" step="5" value="100"
           data-role="freq" aria-label="Frequency, as a percentage of the reference">
  </label>
  <label class="anim-field">
    <span class="anim-field__label">Phase</span>
    <input class="anim-range" type="range" min="0" max="360" step="1" value="0"
           data-role="phase" aria-label="Phase, in degrees">
  </label>
  <button class="anim-btn" type="button" data-role="reset">Reset</button>
</div>

<div class="anim-forms" data-role="readout" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">this wave is</span>
    <code data-role="r-eq"></code></p>
</div>

<p class="anim-figure__caption">
  Move each slider on its own and watch what the ghost behind it does not do.
  Amplitude changes the height. Frequency changes how many cycles fit across
  the panel. Phase slides the wave sideways without changing its height or its
  rate, which is why it is the only one of the three you cannot read off a
  single wave in isolation: you need something to compare it against.
  Hold that thought until <a href="04-phase.md">chapter 4</a>.
  <span class="anim-figure__source">Definitions only. Nothing measured, nothing
  specific to AMBE.</span>
</p>
`;

/* --- module -------------------------------------------------------------- */

/**
 * Mount the three-numbers figure.
 * @param {Element} root a `[data-anim="three-numbers"]` element
 * @returns {() => void} cleanup
 */
export function mount(root) {
  root.classList.add("anim-figure");
  if (!root.querySelector(".anim-figure__frame")) root.innerHTML = FIGURE_HTML;

  const canvas = root.querySelector("canvas");
  const ampEl = root.querySelector('[data-role="amp"]');
  const freqEl = root.querySelector('[data-role="freq"]');
  const phaseEl = root.querySelector('[data-role="phase"]');
  const resetEl = root.querySelector('[data-role="reset"]');
  const eqEl = root.querySelector('[data-role="r-eq"]');

  const state = { ...DEFAULTS };

  const handle = setupCanvas(canvas, { onResize: () => render() });

  function wave(amp, freq, phase) {
    const pts = [];
    for (let i = 0; i <= POINTS; i += 1) {
      const t = (i / POINTS) * SPAN;
      pts.push({ x: t, y: amp * Math.sin(TAU * freq * t + phase) });
    }
    return pts;
  }

  function render() {
    const th = getTheme();
    const ctx = handle.ctx;
    clearCanvas(ctx, handle);
    const stacked = handle.width < 560;

    const plot = createPlot(handle, {
      xDomain: [0, SPAN],
      yDomain: [-1.6, 1.6],
      padding: { top: 14, right: 16, bottom: 30, left: stacked ? 30 : 40 },
    });

    drawGrid(ctx, plot, { xTicks: [0, 1, 2, 3], yTicks: [-1, 0, 1] });
    drawAxes(ctx, plot, {
      xTicks: [0, 1, 2, 3],
      yTicks: [-1, 0, 1],
      formatX: (v) => String(v),
      formatY: (v) => String(v),
      xLabel: "time, in cycles of the reference",
    });

    ctx.save();
    plot.clip(ctx);
    drawPolyline(ctx, wave(DEFAULTS.amp, DEFAULTS.freq, DEFAULTS.phase), {
      plot,
      color: th.muted,
      width: 1.4,
      dash: [4, 4],
    });
    drawPolyline(ctx, wave(state.amp, state.freq, state.phase), {
      plot,
      color: th.series[0],
      width: 2.4,
    });

    // Amplitude, drawn as the thing it is: the height of the swing.
    const topY = plot.y(state.amp);
    const midY = plot.y(0);
    const ax = plot.x(SPAN * 0.045);
    ctx.strokeStyle = th.accentCool;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ax, midY);
    ctx.lineTo(ax, topY);
    ctx.stroke();

    // Phase, drawn as the gap between one upward zero crossing of the
    // reference and the nearest upward crossing of the live wave. This is the
    // only one of the three that needs two waves to be visible at all.
    //
    // The reference crosses upward at every whole t. The live wave crosses
    // upward wherever 2π·freq·t + phase is a multiple of 2π, so at
    // t = (k - turns) / freq. Take whichever k lands nearest the reference
    // crossing at t = 1, so the marker stays in the middle of the panel
    // instead of running off the left edge at large phase.
    const refT = 1;
    const turnsNow = state.phase / TAU;
    const k = Math.round(refT * state.freq + turnsNow);
    const liveT = (k - turnsNow) / state.freq;
    let markerX = null;
    if (Math.abs(liveT - refT) > 1e-4 && liveT >= 0 && liveT <= SPAN) {
      const y = plot.y(0);
      ctx.strokeStyle = th.accentWarm;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(plot.x(refT), y);
      ctx.lineTo(plot.x(liveT), y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const t of [refT, liveT]) {
        ctx.beginPath();
        ctx.moveTo(plot.x(t), y - 5);
        ctx.lineTo(plot.x(t), y + 5);
        ctx.stroke();
      }
      markerX = (plot.x(refT) + plot.x(liveT)) / 2;
    }
    ctx.restore();

    if (markerX !== null) {
      drawLabel(ctx, "phase", markerX, plot.y(0) + 9, {
        align: "center", baseline: "top", size: 11, color: th.accentWarm,
        background: th.plotBg, padding: 3,
      });
    }

    drawLabel(ctx, "amplitude", ax + 6, (topY + midY) / 2, {
      align: "left", baseline: "middle", size: 11, color: th.accentCool,
      background: th.plotBg, padding: 3,
    });

    const turns = state.phase / TAU;
    eqEl.textContent =
      `${state.amp.toFixed(2)} · sin(2π · ${state.freq.toFixed(2)}f · t` +
      `${turns > 0.0005 ? ` + ${turns.toFixed(3)} turn` : ""})`;
  }

  function sync() {
    state.amp = Number(ampEl.value) / 100;
    state.freq = Number(freqEl.value) / 100;
    state.phase = (Number(phaseEl.value) / 360) * TAU;
    render();
  }

  for (const el of [ampEl, freqEl, phaseEl]) {
    el.addEventListener("input", sync);
  }
  resetEl.addEventListener("click", () => {
    ampEl.value = "100";
    freqEl.value = "100";
    phaseEl.value = "0";
    sync();
  });

  const offTheme = onThemeChange(() => render());
  sync();

  return () => {
    offTheme();
    handle.destroy();
  };
}

mountAnim(`[data-anim="${SLUG}"]`, mount);
