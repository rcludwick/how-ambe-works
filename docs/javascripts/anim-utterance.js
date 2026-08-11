/* ===========================================================================
 * anim-utterance.js — a sentence, and what it looks like close up.
 * ---------------------------------------------------------------------------
 * SLUG          utterance        <div data-anim="utterance"></div>
 *
 * DATA READ     assets/data/<clip>/waveform.json
 *                 .original.min / .max   2.5 ms envelope of the whole sentence
 *                 .closeups.voiced       60 ms of RAW samples, a vowel
 *                 .closeups.unvoiced     60 ms of RAW samples, a fricative
 *
 *               DERIVED, not codec state. These are the 8 kHz samples of the
 *               recording before it ever reached the AMBE-3000. Nothing on
 *               this figure came out of the chip.
 *
 * CONTROLS      • vowel / fricative, which moves the closeup window
 *
 * WHAT IT DRAWS Top: the whole sentence, as an envelope. Bottom: 60 ms of it
 *               at full sample resolution, with one pitch period marked when
 *               the window is periodic.
 *
 * WHY BOTH      Chapter 01 opens by proposing the obvious compression: record
 *               the shape of one pulse and how often it repeats. The figure
 *               has to make that proposal look reasonable before the chapter
 *               knocks it down, so the vowel closeup really does repeat, and
 *               the readout really does give a period. Consecutive periods in
 *               the window this clip selects correlate at about 0.93, which is
 *               "clearly the same motif again" rather than "identical", and
 *               the prose is worded to match. Then the fricative button shows
 *               that the same sentence has stretches with no period at all,
 *               which is the first crack in the plan and the reason chapter 07
 *               needs voicing decisions.
 *
 * WHY 60 ms     waveform.json's min/max buckets are 2.5 ms, about a third of a
 *               pitch period. They can draw a sentence and cannot show that it
 *               is periodic. The closeups exist for exactly this figure; see
 *               `closeups()` in tools/make-data.py.
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
  loadJSON,
  ticks,
} from "./anim-core.js";

const SLUG = "utterance";

/**
 * Tick values that will not collide, given how much room the axis has.
 * The default tick count is fixed, which is fine on a laptop and runs the
 * labels into each other on a phone.
 */
function fittedTicks(domain, pixels, perLabel = 62) {
  return ticks(domain, Math.max(2, Math.floor(pixels / perLabel)));
}

/**
 * "She sells sea shells by the sea shore", female voice. Chosen because it is
 * the one clip in the set whose loudest vowel and loudest fricative are within
 * a decibel of each other, so the contrast the figure draws is a contrast in
 * shape and not in level.
 */
const CLIP = "lj-c";

const FULL_SCALE = 32768;
const SR = 8000;

const WINDOWS = [
  { id: "voiced", label: "A vowel" },
  { id: "unvoiced", label: "A fricative" },
];

/* --- markup -------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">A sentence, and sixty milliseconds of it</p>
</div>

<div class="anim-figure__frame" data-state="loading">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="Top: the waveform envelope of a whole spoken sentence. Bottom: sixty milliseconds of it at full sample resolution, showing either a repeating pulse train from a vowel or aperiodic noise from a fricative."></canvas>
</div>

<div class="anim-controls">
  <div class="anim-controls__group" role="group" aria-label="Which part of the sentence to magnify">
    ${WINDOWS.map(
      (w, i) =>
        `<button class="anim-btn" type="button" data-window="${w.id}"
                 aria-pressed="${i === 0 ? "true" : "false"}">${w.label}</button>`
    ).join("\n    ")}
  </div>
</div>

<div class="anim-forms" data-role="readout" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">this window</span>
    <code data-role="r-window"></code></p>
</div>

<p class="anim-figure__caption" data-role="caption"></p>
`;

const CAPTIONS = {
  voiced:
    "Magnified, a vowel is a train of pulses. Each one is the vocal folds " +
    "closing, and they arrive at a steady rate. This is what makes the " +
    "compression at the top of the page look easy: describe one pulse, say " +
    "how often it repeats, and you appear to have described the vowel.",
  unvoiced:
    "The same sentence, a fraction of a second later. There is no pulse and " +
    "no rate to send. A fricative is air forced through a narrow gap, and it " +
    "is noise. Any description built on a repeating shape has nothing to hold " +
    "on to here, which is why a coder ends up having to decide, band by band, " +
    "which of the two it is looking at.",
};

const SOURCE_NOTE =
  '<span class="anim-figure__source">Samples measured from the recording ' +
  "before it reached the codec. Nothing on this figure came out of the " +
  "AMBE-3000.</span>";

/* --- module -------------------------------------------------------------- */

/**
 * Mount the utterance figure.
 * @param {Element} root a `[data-anim="utterance"]` element
 * @returns {() => void | Promise<() => void>} cleanup
 */
export async function mount(root) {
  root.classList.add("anim-figure");
  if (!root.querySelector(".anim-figure__frame")) root.innerHTML = FIGURE_HTML;

  const frame = root.querySelector(".anim-figure__frame");
  const canvas = root.querySelector("canvas");
  const readoutEl = root.querySelector('[data-role="r-window"]');
  const captionEl = root.querySelector('[data-role="caption"]');
  const buttons = Array.from(root.querySelectorAll("[data-window]"));

  const state = { which: "voiced", data: null };

  const handle = setupCanvas(canvas, { onResize: () => render() });

  let data;
  try {
    data = await loadJSON(`assets/data/${CLIP}/waveform.json`);
  } catch (err) {
    frame.dataset.state = "error";
    readoutEl.textContent = "could not load the waveform data";
    return () => handle.destroy();
  }
  state.data = data;
  frame.dataset.state = "ready";

  function render() {
    if (!state.data) return;
    const d = state.data;
    const win = d.closeups[state.which] || d.closeups.voiced;
    const th = getTheme();
    const ctx = handle.ctx;
    const W = handle.width;
    const H = handle.height;
    clearCanvas(ctx, handle);

    const stacked = W < 560;
    const padL = stacked ? 32 : 46;
    const gap = 30;
    const topH = Math.round((H - gap) * 0.38);

    const duration = d.clip.duration_s;
    const bucketS = d.bucket_ms / 1000;

    /* -- top: the whole sentence ---------------------------------------- */

    const top = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, duration],
        yDomain: [-1, 1],
        padding: { top: 12, right: 14, bottom: H - 12 - topH, left: padL },
      }
    );

    const timeTicks = fittedTicks([0, duration], top.area.width);
    drawGrid(ctx, top, { xTicks: timeTicks, yTicks: [0] });
    drawAxes(ctx, top, {
      xTicks: timeTicks,
      yTicks: [],
      formatX: (v) => `${v.toFixed(1)}s`,
    });

    ctx.save();
    top.clip(ctx);
    // The envelope is drawn as a filled band between the per-bucket minimum
    // and maximum, which is what those arrays are.
    ctx.fillStyle = th.series[0];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    const mins = d.original.min;
    const maxs = d.original.max;
    for (let i = 0; i < maxs.length; i += 1) {
      const x = top.x(i * bucketS);
      const y = top.y(maxs[i] / FULL_SCALE);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = mins.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(top.x(i * bucketS), top.y(mins[i] / FULL_SCALE));
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Mark where the closeup is taken from, so the bottom panel is anchored
    // in the top one rather than floating free.
    const winStart = win.start_s;
    const winEnd = winStart + d.closeup_samples / SR;
    ctx.fillStyle = th.accentWarm;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(
      top.x(winStart),
      top.area.top,
      Math.max(2, top.x(winEnd) - top.x(winStart)),
      top.area.height
    );
    ctx.globalAlpha = 1;
    ctx.strokeStyle = th.accentWarm;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(top.x(winStart), top.area.top);
    ctx.lineTo(top.x(winStart), top.area.bottom);
    ctx.moveTo(top.x(winEnd), top.area.top);
    ctx.lineTo(top.x(winEnd), top.area.bottom);
    ctx.stroke();
    ctx.restore();

    drawLabel(ctx, `“${d.clip.text}”`, top.area.left + 6, top.area.top + 2, {
      align: "left", baseline: "top", size: 11, color: th.text3,
      background: th.plotBg, padding: 3,
    });

    /* -- bottom: the closeup -------------------------------------------- */

    const ms = (d.closeup_samples / SR) * 1000;
    const bottom = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, ms],
        yDomain: [-1, 1],
        padding: { top: 12 + topH + gap, right: 14, bottom: 30, left: padL },
      }
    );

    const peak = Math.max(
      1,
      win.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    );
    const scale = 0.92 / (peak / FULL_SCALE);

    drawGrid(ctx, bottom, { yTicks: [0] });
    drawAxes(ctx, bottom, {
      yTicks: [],
      formatX: (v) => `${v.toFixed(0)}ms`,
      xLabel: "milliseconds",
    });

    ctx.save();
    bottom.clip(ctx);
    const pts = win.samples.map((v, i) => ({
      x: (i / SR) * 1000,
      y: (v / FULL_SCALE) * scale,
    }));
    drawPolyline(ctx, pts, { plot: bottom, color: th.series[1], width: 1.6 });

    // One pitch period, marked, when there is one. The point of the vowel
    // panel is that the pulses repeat at a rate you can measure, so measure
    // it on screen rather than only asserting it in the caption.
    if (win.f0_hz) {
      const periodMs = 1000 / win.f0_hz;
      // Start the marker at the largest peak, which is a pulse.
      let peakIdx = 0;
      for (let i = 0; i < win.samples.length; i += 1) {
        if (Math.abs(win.samples[i]) > Math.abs(win.samples[peakIdx])) peakIdx = i;
      }
      const t0 = (peakIdx / SR) * 1000;
      const y = bottom.y(-0.99);
      ctx.strokeStyle = th.accentWarm;
      ctx.lineWidth = 1.6;
      for (let t = t0; t <= ms; t += periodMs) {
        ctx.beginPath();
        ctx.moveTo(bottom.x(t), bottom.area.top);
        ctx.lineTo(bottom.x(t), bottom.area.bottom);
        ctx.globalAlpha = 0.28;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (t0 + periodMs <= ms) {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(bottom.x(t0), y);
        ctx.lineTo(bottom.x(t0 + periodMs), y);
        ctx.stroke();
      }
    }
    ctx.restore();

    if (win.f0_hz) {
      drawLabel(
        ctx,
        `one period, ${(1000 / win.f0_hz).toFixed(1)} ms`,
        bottom.x((win.samples.length / SR) * 1000 * 0.5),
        bottom.y(-0.99) - 6,
        {
          align: "center", baseline: "bottom", size: 11, color: th.accentWarm,
          background: th.plotBg, padding: 3,
        }
      );
    }

    readoutEl.textContent = win.f0_hz
      ? `${win.start_s.toFixed(2)}s, repeating ${Math.round(win.f0_hz)} times a second`
      : `${win.start_s.toFixed(2)}s, no repeat rate the tracker will commit to`;
    captionEl.innerHTML = `${CAPTIONS[state.which]} ${SOURCE_NOTE}`;
  }

  for (const el of buttons) {
    el.addEventListener("click", () => {
      state.which = el.dataset.window;
      for (const other of buttons) {
        other.setAttribute("aria-pressed", other === el ? "true" : "false");
      }
      render();
    });
  }

  const offTheme = onThemeChange(() => render());
  render();

  return () => {
    offTheme();
    handle.destroy();
  };
}

mountAnim(`[data-anim="${SLUG}"]`, mount);
