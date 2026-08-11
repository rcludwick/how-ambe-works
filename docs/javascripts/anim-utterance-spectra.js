/* ===========================================================================
 * anim-utterance-spectra.js — the same measurement, on different sounds.
 * ---------------------------------------------------------------------------
 * SLUG          utterance-spectra   <div data-anim="utterance-spectra"></div>
 *
 * DATA READ     assets/data/<clip>/spectra.json
 *                 .original[frame][bin]   dBFS, 128 bins, 31.25 Hz apart
 *                 .bin_centre_hz          the frequency of each bin
 *
 *               DERIVED, not codec state: an ordinary FFT of the recording,
 *               computed by tools/make-data.py. The AMBE-3000 does not report
 *               its internal spectrum and nothing here claims to be it.
 *
 * CONTROLS      • four sentences, and a male / female voice toggle
 *               • a slider that moves through the sentence, 20 ms at a time
 *
 * WHAT IT DRAWS Top: energy against time, so the reader can find a vowel.
 *               Bottom: the spectrum of the selected 32 ms window.
 *
 * WHAT IT IS FOR
 *               Chapter 01 closes by claiming that measuring energy per
 *               frequency is one kind of measurement that does not have to be
 *               reinvented per sound: "the numbers differ; the description
 *               does not have to be reinvented." That is a claim the reader
 *               should be able to check, so the figure runs the identical
 *               measurement across eight recordings and lets them look. The
 *               shapes are wildly different. The axes never change.
 *
 *               It is also the first place on the site a real spectrum
 *               appears, so it is deliberately plain: no harmonic comb, no
 *               band edges, no codec overlay. Those arrive in chapter 07,
 *               once they have been earned.
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

const SLUG = "utterance-spectra";

/**
 * Tick values that will not collide, given how much room the axis has.
 * The default tick count is fixed, which is fine on a laptop and runs the
 * labels into each other on a phone.
 */
function fittedTicks(domain, pixels, perLabel = 62) {
  return ticks(domain, Math.max(2, Math.floor(pixels / perLabel)));
}

const SENTENCES = [
  { id: "c", label: "She sells sea shells" },
  { id: "a", label: "The quick brown fox" },
  { id: "b", label: "CQ CQ CQ" },
  { id: "d", label: "We were away" },
];

const VOICES = [
  { id: "lj", label: "Female" },
  { id: "lr", label: "Male" },
];

/** Floor of the dB axis. Below this is the noise of the recording. */
const FLOOR_DB = -85;

/* --- markup -------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">Energy at each frequency, across eight recordings</p>
</div>

<div class="anim-figure__frame" data-state="loading">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="Top: energy against time for a spoken sentence. Bottom: the frequency spectrum of the selected thirty-two millisecond window, from zero to four kilohertz."></canvas>
</div>

<div class="anim-controls">
  <div class="anim-controls__group" role="group" aria-label="Sentence">
    ${SENTENCES.map(
      (s, i) =>
        `<button class="anim-btn" type="button" data-sentence="${s.id}"
                 aria-pressed="${i === 0 ? "true" : "false"}">${s.label}</button>`
    ).join("\n    ")}
  </div>
  <div class="anim-controls__group" role="group" aria-label="Voice">
    ${VOICES.map(
      (v, i) =>
        `<button class="anim-btn" type="button" data-voice="${v.id}"
                 aria-pressed="${i === 0 ? "true" : "false"}">${v.label}</button>`
    ).join("\n    ")}
  </div>
  <label class="anim-field">
    <span class="anim-field__label">Through the sentence</span>
    <input class="anim-range" type="range" min="0" max="100" step="1" value="40"
           data-role="frame" aria-label="Position in the sentence">
  </label>
</div>

<div class="anim-forms" data-role="readout" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">this window</span>
    <code data-role="r-window"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">loudest at</span>
    <code data-role="r-peak"></code></p>
</div>

<p class="anim-figure__caption">
  Drag through a sentence and watch the bottom panel change shape. A vowel puts
  its energy in a few low humps. A fricative like the "sh" in "she sells" puts
  it high and spreads it out. Silence drops the whole curve to the floor.
  Then change the sentence, or the speaker, and notice what does not change:
  the measurement, and the axes it is reported on. Every one of these is the
  same question asked of a different 32&nbsp;ms of audio, which is what makes it
  something a coder can send.
  <span class="anim-figure__source">An ordinary FFT of the recordings, computed
  before the audio reached the codec. The AMBE-3000 does not report its own
  spectrum and this is not it.</span>
</p>
`;

/* --- module -------------------------------------------------------------- */

/**
 * Mount the spectra figure.
 * @param {Element} root a `[data-anim="utterance-spectra"]` element
 * @returns {() => void | Promise<() => void>} cleanup
 */
export async function mount(root) {
  root.classList.add("anim-figure");
  if (!root.querySelector(".anim-figure__frame")) root.innerHTML = FIGURE_HTML;

  const frame = root.querySelector(".anim-figure__frame");
  const canvas = root.querySelector("canvas");
  const frameEl = root.querySelector('[data-role="frame"]');
  const windowEl = root.querySelector('[data-role="r-window"]');
  const peakEl = root.querySelector('[data-role="r-peak"]');
  const sentenceEls = Array.from(root.querySelectorAll("[data-sentence]"));
  const voiceEls = Array.from(root.querySelectorAll("[data-voice]"));

  const state = { sentence: "c", voice: "lj", position: 0.4, data: null };
  const cache = new Map();

  const handle = setupCanvas(canvas, { onResize: () => render() });

  /** Per-frame energy, for the time strip. Summing dB is meaningless, so this
   *  converts back to power first and reports the total. */
  function energyCurve(frames) {
    return frames.map((bins) => {
      let power = 0;
      for (const db of bins) power += Math.pow(10, db / 10);
      return 10 * Math.log10(power || 1e-12);
    });
  }

  async function load() {
    const clip = `${state.voice}-${state.sentence}`;
    if (cache.has(clip)) {
      state.data = cache.get(clip);
      return true;
    }
    frame.dataset.state = "loading";
    try {
      const doc = await loadJSON(`assets/data/${clip}/spectra.json`);
      const entry = { doc, energy: energyCurve(doc.original) };
      cache.set(clip, entry);
      state.data = entry;
      frame.dataset.state = "ready";
      return true;
    } catch (err) {
      frame.dataset.state = "error";
      windowEl.textContent = `could not load ${clip}`;
      return false;
    }
  }

  function render() {
    if (!state.data) return;
    const { doc, energy } = state.data;
    const frames = doc.original;
    const idx = Math.min(
      frames.length - 1,
      Math.max(0, Math.round(state.position * (frames.length - 1)))
    );
    const bins = frames[idx];
    const th = getTheme();
    const ctx = handle.ctx;
    const W = handle.width;
    const H = handle.height;
    clearCanvas(ctx, handle);

    const stacked = W < 560;
    const padL = stacked ? 34 : 46;
    const gap = 30;
    const topH = Math.round((H - gap) * 0.3);
    const duration = doc.clip.duration_s;

    /* -- top: energy against time --------------------------------------- */

    const top = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, duration],
        yDomain: [Math.min(...energy) - 2, Math.max(...energy) + 2],
        padding: { top: 12, right: 14, bottom: H - 12 - topH, left: padL },
      }
    );

    const timeTicks = fittedTicks([0, duration], top.area.width);
    drawGrid(ctx, top, { xTicks: timeTicks, yTicks: [] });
    drawAxes(ctx, top, {
      xTicks: timeTicks,
      yTicks: [],
      formatX: (v) => `${v.toFixed(1)}s`,
    });

    ctx.save();
    top.clip(ctx);
    drawPolyline(
      ctx,
      energy.map((v, i) => ({ x: i * 0.02, y: v })),
      { plot: top, color: th.series[0], width: 1.6, fill: th.series[0] + "33" }
    );
    const cursorX = top.x(idx * 0.02);
    ctx.strokeStyle = th.accentWarm;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, top.area.top);
    ctx.lineTo(cursorX, top.area.bottom);
    ctx.stroke();
    ctx.restore();

    drawLabel(ctx, `“${doc.clip.text}”`, top.area.left + 6, top.area.top + 2, {
      align: "left", baseline: "top", size: 11, color: th.text3,
      background: th.plotBg, padding: 3,
    });

    /* -- bottom: the spectrum ------------------------------------------- */

    const nyquist = doc.bin_centre_hz[doc.bin_centre_hz.length - 1];
    const bottom = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, nyquist],
        yDomain: [FLOOR_DB, 0],
        padding: { top: 12 + topH + gap, right: 14, bottom: 34, left: padL },
      }
    );

    const xTicks = [0, 1000, 2000, 3000, 4000].filter((v) => v <= nyquist);
    drawGrid(ctx, bottom, { xTicks, yTicks: [-80, -60, -40, -20, 0] });
    drawAxes(ctx, bottom, {
      xTicks,
      yTicks: [-80, -60, -40, -20, 0],
      formatX: (v) => (v === 0 ? "0" : `${v / 1000}k`),
      formatY: (v) => `${v}`,
      xLabel: "frequency, hertz",
      yLabel: "dBFS",
    });

    ctx.save();
    bottom.clip(ctx);
    const pts = bins.map((db, i) => ({
      x: doc.bin_centre_hz[i],
      y: Math.max(FLOOR_DB, db),
    }));
    drawPolyline(ctx, pts, {
      plot: bottom,
      color: th.series[1],
      width: 1.8,
      fill: th.series[1] + "2e",
      fillBaseline: FLOOR_DB,
    });
    ctx.restore();

    /* -- readouts -------------------------------------------------------- */

    let peakBin = 0;
    for (let i = 1; i < bins.length; i += 1) {
      if (bins[i] > bins[peakBin]) peakBin = i;
    }
    const total = energy[idx];
    windowEl.textContent = `${(idx * 0.02).toFixed(2)}s into “${doc.clip.text}”`;
    peakEl.textContent =
      total < -60
        ? "nothing above the noise floor here"
        : `${Math.round(doc.bin_centre_hz[peakBin])} Hz, at ${bins[peakBin]} dBFS`;
  }

  async function reload() {
    if (await load()) render();
  }

  for (const el of sentenceEls) {
    el.addEventListener("click", async () => {
      state.sentence = el.dataset.sentence;
      for (const o of sentenceEls) {
        o.setAttribute("aria-pressed", o === el ? "true" : "false");
      }
      await reload();
    });
  }
  for (const el of voiceEls) {
    el.addEventListener("click", async () => {
      state.voice = el.dataset.voice;
      for (const o of voiceEls) {
        o.setAttribute("aria-pressed", o === el ? "true" : "false");
      }
      await reload();
    });
  }
  frameEl.addEventListener("input", () => {
    state.position = Number(frameEl.value) / 100;
    render();
  });

  const offTheme = onThemeChange(() => render());
  await reload();

  return () => {
    offTheme();
    handle.destroy();
  };
}

mountAnim(`[data-anim="${SLUG}"]`, mount);
