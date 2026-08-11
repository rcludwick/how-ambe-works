/* ===========================================================================
 * anim-voicing.js — multi-band excitation, made visible.
 * ---------------------------------------------------------------------------
 * SLUG          voicing          <div data-anim="voicing"></div>
 *
 * DATA READ     assets/data/<clip>/frames.json    (band voicing, pitch, level)
 *               assets/data/<clip>/spectra.json   (128-bin dBFS spectra)
 *               assets/audio/<clip>-ambe.wav      (optional sound, via <audio>)
 *               clips are norman-b, norman-c, lj-c — real ThumbDV round trips.
 *
 * CONTROLS      • Play / Pause — steps frames at the real 50 frames/s
 *               • Frame slider — scrub (arrow keys step one 20 ms frame)
 *               • drag directly on the voicing map to scrub
 *               • clip toggle — three recordings
 *               • "Sound" — play the decoded audio, delay-compensated, and
 *                 drive the playhead from audio.currentTime
 *               • "Original" — overlay the pre-codec spectrum
 *
 * WHAT IT DRAWS Everything comes out of the precomputed JSON. The spectrum is
 *               `spectra.json` row i, the eight 500 Hz bands are
 *               `frames.json` derived_notes.band_edges_hz, and the voiced /
 *               unvoiced shading is `frames[i].derived.band_voiced` with the
 *               strength `band_voicing`. The map underneath is those same
 *               eight flags for every frame of the clip, dimmed by the frame's
 *               measured level so silence does not read as fricative.
 *
 * PROVENANCE    IMPORTANT, and stated in the caption: the AMBE-3000 has no
 *               packet that reports its internal voicing bits, so these flags
 *               are NOT the codec's transmitted V/UV decisions. They are a
 *               band-limited autocorrelation measurement made on the chip's
 *               own decoded output by tools/make-data.py — see
 *               docs/assets/data/SCHEMA.md. Nothing here analyses or
 *               synthesises anything: this module only draws stored numbers.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  mount as mountAnim,
  assetURL,
  setupCanvas,
  createPlot,
  createLoop,
  clearCanvas,
  crisp,
  linearScale,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  onThemeChange,
  loadJSON,
  prefersReducedMotion,
} from "./anim-core.js";

const SLUG = "voicing";

const FRAME_S = 0.02; // 20 ms per frame — 50 frames a second
const NYQUIST_HZ = 4000;
const DB_DOMAIN = [-95, -5];
const DB_TICKS = [-90, -70, -50, -30, -10];

const CLIPS = [
  { id: "norman-b", label: "CQ", voice: "male" },
  { id: "norman-c", label: "Shells", voice: "male" },
  { id: "lj-c", label: "Shells", voice: "female" },
];

const FIGURE_HTML = `
<div class="anim-figure__head">
  <h4 class="anim-figure__title">Eight bands, eight decisions, every 20 ms</h4>
  <span class="badge measured">hardware capture</span>
</div>
<p class="anim-figure__subtitle" data-role="subtitle">&nbsp;</p>

<div class="anim-figure__frame" data-state="loading" style="--anim-aspect: 16 / 10">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="The spectrum of one 20 ms frame of a real recording, divided into eight 500 Hz bands, each labelled voiced or unvoiced with its measured voicing strength; underneath, a map of those eight flags for every frame of the clip. The readout below gives the frame time and index."></canvas>
</div>

<ul class="anim-legend">
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-2"></i>band measured voiced</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-3"></i>band measured unvoiced</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--line is-data-1"></i>spectrum of the decoded audio</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch anim-legend__swatch--dashed" style="color: var(--ambe-plot-muted)"></i>spectrum before the codec (optional)</li>
</ul>

<div class="anim-controls">
  <button class="anim-btn anim-btn--play" type="button" aria-pressed="false">Play</button>
  <label class="anim-field">
    <span class="anim-field__label">Frame</span>
    <input class="anim-range" type="range" min="0" max="0" step="1" value="0"
           aria-label="Frame index, 20 milliseconds per frame">
  </label>
  <output class="anim-readout anim-readout--wide" data-role="readout">0.00 s</output>
</div>
<div class="anim-controls" style="border-top: 0; margin-top: 0; padding-top: 0">
  <div class="anim-toggle-group" role="group" aria-label="Recording"
       style="flex-wrap: wrap; max-width: 100%">
    ${CLIPS.map(
      (c, i) =>
        `<button class="anim-btn" type="button" data-clip="${c.id}" aria-pressed="${
          i === 0 ? "true" : "false"
        }">${c.label} · ${c.voice}</button>`
    ).join("\n    ")}
  </div>
  <label class="anim-controls__group">
    <input class="anim-check" type="checkbox" data-role="sound">
    <span class="anim-field__label">Sound</span>
  </label>
  <label class="anim-controls__group">
    <input class="anim-check" type="checkbox" data-role="original">
    <span class="anim-field__label">Show original</span>
  </label>
</div>

<p class="anim-figure__hint">Held on a static frame because your system asks for
  reduced motion. Use the slider — or drag on the map — to step through it.</p>

<p class="anim-figure__caption">
  Press play, then watch the eight band chips along the top. On a vowel the
  whole column goes voiced; on the /s/ of “sells” the top bands flip to
  unvoiced while the bottom ones keep their harmonics. That simultaneity —
  voiced down here, noise up there, in the same 20 ms — is the whole of
  “multi-band excitation”. Scrub the map underneath to hunt for the flips, and
  tick <em>Sound</em> to hear the frame you are looking at.
  <span class="anim-figure__source">Spectra and band flags: precomputed from
  real DVSI AMBE-3000 round trips, assets/data/&lt;clip&gt;/{frames,spectra}.json.
  The eight 500 Hz bands match the eight V/UV decisions of the AMBE-rate system
  (Griffin &amp; Lim 1988 §II; US 5,826,222). <strong>These flags are not the
  codec’s transmitted voicing bits</strong> — the chip has no packet that reports
  them. They are a band-limited autocorrelation measurement made on the chip’s
  decoded output, threshold 0.55; method and limits in
  docs/assets/data/SCHEMA.md.</span>
</p>
`;

/**
 * Mount the band-voicing figure into a container.
 * @param {Element} root a `[data-anim="voicing"]` element
 * @returns {() => void} cleanup
 */
export function mount(root) {
  root.classList.add("anim-figure");
  if (!root.querySelector(".anim-figure__frame")) root.innerHTML = FIGURE_HTML;

  const frame = root.querySelector(".anim-figure__frame");
  const canvas = root.querySelector("canvas");
  const range = root.querySelector(".anim-range");
  const playButton = root.querySelector(".anim-btn--play");
  const readout = root.querySelector('[data-role="readout"]');
  const subtitle = root.querySelector('[data-role="subtitle"]');
  const soundToggle = root.querySelector('[data-role="sound"]');
  const originalToggle = root.querySelector('[data-role="original"]');
  const clipButtons = Array.from(root.querySelectorAll("[data-clip]"));
  const reduced = prefersReducedMotion();
  if (reduced) root.classList.add("is-static");

  const audio = document.createElement("audio");
  audio.preload = "none";
  audio.setAttribute("aria-hidden", "true");
  audio.hidden = true;
  root.appendChild(audio);

  const state = {
    clipId: CLIPS[0].id,
    frames: null,
    spectra: null,
    bands: [],
    count: 0,
    delay: 0, // seconds the decoded WAV lags the original
    index: 0,
    playhead: 0, // seconds, virtual clock when sound is off
    sound: false,
    original: false,
    raster: null,
    rasterScheme: null,
  };

  canvas.style.touchAction = "pan-y";
  const handle = setupCanvas(canvas, { onResize: () => render() });

  /* -- layout ------------------------------------------------------------ */

  function layout() {
    const W = handle.width;
    const H = handle.height;
    const compact = W < 560;
    const padL = compact ? 30 : 44;
    const padR = compact ? 10 : 16;
    const chipH = compact ? 24 : 30;
    const stripH = compact ? 66 : 92;
    const stripBottom = H - (compact ? 24 : 28);
    const stripTop = Math.max(chipH + 60, stripBottom - stripH);
    const specTop = (compact ? 8 : 12) + chipH;
    const specBottom = stripTop - (compact ? 30 : 40);

    const spec = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, NYQUIST_HZ],
        yDomain: DB_DOMAIN,
        padding: {
          top: specTop,
          right: padR,
          bottom: H - specBottom,
          left: padL,
        },
      }
    );

    const strip = {
      left: padL,
      right: W - padR,
      top: stripTop,
      bottom: stripBottom,
      width: W - padR - padL,
      height: stripBottom - stripTop,
    };

    return { W, H, compact, chipH, spec, strip };
  }

  /* -- the voicing map (prerendered once per clip and theme) -------------- */

  function buildRaster(th) {
    if (!state.frames) return;
    const n = state.count;
    const bands = state.bands.length || 8;
    const off = document.createElement("canvas");
    off.width = n;
    off.height = bands;
    const c = off.getContext("2d");
    c.clearRect(0, 0, n, bands);

    for (let i = 0; i < n; i += 1) {
      const d = state.frames.frames[i].derived;
      // Dim by measured level so silent frames do not masquerade as fricatives.
      const level = Math.min(
        1,
        Math.max(0.04, (d.decoded_rms_dbfs + 65) / 40)
      );
      for (let b = 0; b < bands; b += 1) {
        const voiced = d.band_voiced[b];
        c.globalAlpha = level * (voiced ? 1 : 0.86);
        c.fillStyle = voiced ? th.series[1] : th.series[2];
        c.fillRect(i, bands - 1 - b, 1, 1);
      }
    }
    c.globalAlpha = 1;
    state.raster = off;
    state.rasterScheme = th.scheme;
  }

  /* -- drawing ----------------------------------------------------------- */

  function drawBandChips(ctx, th, geo) {
    const { spec, chipH, compact } = geo;
    const d = state.frames.frames[state.index].derived;
    const top = compact ? 4 : 6;
    const h = chipH - (compact ? 6 : 8);

    for (let b = 0; b < state.bands.length; b += 1) {
      const [lo, hi] = state.bands[b];
      const x0 = spec.x(lo);
      const x1 = spec.x(hi);
      const w = x1 - x0 - 2;
      const voiced = d.band_voiced[b];
      const strength = d.band_voicing[b];
      const color = voiced ? th.series[1] : th.series[2];

      ctx.save();
      ctx.globalAlpha = voiced ? 0.2 : 0.15;
      ctx.fillStyle = color;
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(x0 + 1, top, w, h, 4);
        ctx.fill();
      } else {
        ctx.fillRect(x0 + 1, top, w, h);
      }
      ctx.restore();

      const label =
        w > 56 ? `${voiced ? "V" : "UV"}  ${strength.toFixed(2)}` : voiced ? "V" : "UV";
      drawLabel(ctx, label, x0 + 1 + w / 2, top + h / 2 - 2, {
        align: "center",
        baseline: "middle",
        size: compact ? 9 : 10,
        weight: 600,
        mono: true,
        color,
      });

      // Voicing strength, with the 0.55 threshold marked.
      const barY = top + h - 4;
      const barW = w - 8;
      ctx.save();
      ctx.fillStyle = th.hairline;
      ctx.fillRect(x0 + 5, barY, barW, 2);
      ctx.fillStyle = color;
      ctx.fillRect(x0 + 5, barY, barW * Math.min(1, strength), 2);
      ctx.fillStyle = th.text3;
      ctx.fillRect(crisp(x0 + 5 + barW * 0.55), barY - 1, 1, 4);
      ctx.restore();
    }
  }

  function drawSpectrum(ctx, th, geo) {
    const { spec, compact } = geo;
    const i = state.index;
    const d = state.frames.frames[i].derived;
    const row = state.spectra.decoded[i];
    const binHz = state.spectra.bin_hz;

    // Band backgrounds, under everything.
    for (let b = 0; b < state.bands.length; b += 1) {
      const [lo, hi] = state.bands[b];
      const voiced = d.band_voiced[b];
      ctx.save();
      ctx.globalAlpha = voiced ? 0.16 : 0.11;
      ctx.fillStyle = voiced ? th.series[1] : th.series[2];
      ctx.fillRect(spec.x(lo), spec.area.top, spec.x(hi) - spec.x(lo), spec.area.height);
      ctx.restore();
    }

    drawGrid(ctx, spec, { xTicks: [], yTicks: DB_TICKS });

    // Band edges.
    ctx.save();
    ctx.strokeStyle = th.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let b = 1; b < state.bands.length; b += 1) {
      const x = crisp(spec.x(state.bands[b][0]));
      ctx.moveTo(x, spec.area.top);
      ctx.lineTo(x, spec.area.bottom);
    }
    ctx.stroke();
    ctx.restore();

    drawAxes(ctx, spec, {
      xTicks: [0, 1000, 2000, 3000, 4000],
      yTicks: DB_TICKS,
      formatX: (v) => (v === 0 ? "0" : `${v / 1000}k`),
      formatY: (v) => String(v),
      xLabel: compact ? "kHz" : "frequency (kHz)",
    });

    // Harmonic ticks, where the frame has a measured fundamental.
    const f0 = d.decoded_f0_hz;
    if (f0 > 0) {
      ctx.save();
      ctx.strokeStyle = th.muted;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k * f0 < NYQUIST_HZ; k += 1) {
        const x = crisp(spec.x(k * f0));
        ctx.moveTo(x, spec.area.top);
        ctx.lineTo(x, spec.area.top + 6);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Spectra. Original first, so the decoded trace sits on top.
    ctx.save();
    spec.clip(ctx);
    if (state.original) {
      const orig = state.spectra.original[i];
      const pts = new Array(orig.length);
      for (let k = 0; k < orig.length; k += 1) {
        pts[k] = { x: k * binHz, y: Math.max(orig[k], DB_DOMAIN[0]) };
      }
      drawPolyline(ctx, pts, {
        plot: spec,
        color: th.muted,
        width: 1.2,
        dash: [3, 3],
      });
    }
    const pts = new Array(row.length);
    for (let k = 0; k < row.length; k += 1) {
      pts[k] = { x: k * binHz, y: Math.max(row[k], DB_DOMAIN[0]) };
    }
    drawPolyline(ctx, pts, {
      plot: spec,
      color: th.series[0],
      width: 1.6,
      fill: th.dark ? "rgba(125,140,255,0.16)" : "rgba(79,86,214,0.13)",
      fillBaseline: DB_DOMAIN[0],
    });
    ctx.restore();

    // Frame summary chip.
    const voicedCount = d.band_voiced.filter(Boolean).length;
    const text =
      f0 > 0
        ? `f₀ ${f0.toFixed(0)} Hz · ${voicedCount} of 8 bands voiced`
        : "no fundamental measured in this frame";
    drawLabel(ctx, text, spec.area.right - 8, spec.area.top + 6, {
      align: "right",
      baseline: "top",
      size: compact ? 10 : 11,
      mono: true,
      color: f0 > 0 ? th.text2 : th.text4,
      background: th.surface2,
      padding: 4,
    });
  }

  function drawStrip(ctx, th, geo) {
    const { strip, compact } = geo;
    const n = state.count;

    ctx.save();
    ctx.fillStyle = th.sunken;
    ctx.fillRect(strip.left, strip.top, strip.width, strip.height);
    if (state.raster) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        state.raster,
        0,
        0,
        state.raster.width,
        state.raster.height,
        strip.left,
        strip.top,
        strip.width,
        strip.height
      );
      ctx.imageSmoothingEnabled = true;
    }
    ctx.strokeStyle = th.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      crisp(strip.left),
      crisp(strip.top),
      Math.round(strip.width),
      Math.round(strip.height)
    );
    ctx.restore();

    // Frequency labels on the map's left edge.
    drawLabel(ctx, "4k", strip.left - 6, strip.top + 4, {
      align: "right",
      baseline: "top",
      size: 9,
      color: th.text4,
    });
    drawLabel(ctx, "0", strip.left - 6, strip.bottom - 4, {
      align: "right",
      baseline: "bottom",
      size: 9,
      color: th.text4,
    });

    // Time axis.
    const t = linearScale([0, n * FRAME_S], [strip.left, strip.right]);
    const step = n * FRAME_S > 3 ? 1 : 0.5;
    ctx.save();
    ctx.strokeStyle = th.axis;
    ctx.beginPath();
    for (let s = 0; s <= n * FRAME_S + 1e-6; s += step) {
      const x = crisp(t.of(s));
      ctx.moveTo(x, strip.bottom);
      ctx.lineTo(x, strip.bottom + 4);
    }
    ctx.stroke();
    ctx.restore();
    for (let s = 0; s <= n * FRAME_S + 1e-6; s += step) {
      drawLabel(ctx, `${s.toFixed(step < 1 ? 1 : 0)}s`, t.of(s), strip.bottom + 6, {
        align: "center",
        baseline: "top",
        size: 9,
        color: th.text4,
      });
    }

    // Playhead.
    const x = strip.left + ((state.index + 0.5) / n) * strip.width;
    ctx.save();
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crisp(x), strip.top - 4);
    ctx.lineTo(crisp(x), strip.bottom + 1);
    ctx.stroke();
    ctx.fillStyle = th.ink;
    ctx.beginPath();
    ctx.moveTo(x, strip.top - 4);
    ctx.lineTo(x - 4, strip.top - 9);
    ctx.lineTo(x + 4, strip.top - 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (!compact) {
      drawLabel(ctx, "drag to scrub ↔", strip.right, strip.top - 5, {
        align: "right",
        baseline: "bottom",
        size: 9,
        color: th.text4,
      });
    }
  }

  function render() {
    const th = getTheme();
    const ctx = handle.ctx;
    const geo = layout();

    const aspect = geo.W < 480 ? "1 / 1.05" : geo.W < 620 ? "16 / 12" : "16 / 10";
    if (frame && frame.style.getPropertyValue("--anim-aspect") !== aspect) {
      frame.style.setProperty("--anim-aspect", aspect);
    }

    clearCanvas(ctx, handle, th.plotBg);
    if (!state.frames || !state.spectra) return;
    if (!state.raster || state.rasterScheme !== th.scheme) buildRaster(th);

    drawSpectrum(ctx, th, geo);
    drawBandChips(ctx, th, geo);
    drawStrip(ctx, th, geo);
  }

  /* -- playback ---------------------------------------------------------- */

  function clamp(i) {
    return Math.min(Math.max(i | 0, 0), Math.max(0, state.count - 1));
  }

  function setIndex(i, { syncRange = true } = {}) {
    const next = clamp(i);
    if (next === state.index && syncRange) return;
    state.index = next;
    if (range && syncRange && range.value !== String(next)) {
      range.value = String(next);
    }
    if (readout) {
      readout.textContent = `${(next * FRAME_S).toFixed(2)} s · frame ${next}`;
    }
  }

  function audioTimeFor(i) {
    return i * FRAME_S + state.delay;
  }

  /** Seek the decoded WAV to the frame on screen. The decoded audio lags the
   *  original by clip.decoded_delay_samples (SCHEMA.md), so the offset matters. */
  function seekAudio(i) {
    try {
      audio.currentTime = Math.max(0, audioTimeFor(i));
    } catch (error) {
      /* not seekable yet; playback starts from the beginning */
    }
  }

  let lastPlayAttempt = 0;

  function startAudio() {
    if (!state.sound || !state.frames) return;
    lastPlayAttempt = performance.now();
    seekAudio(state.index);
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        /* autoplay refused — the picture keeps running silently */
      });
    }
  }

  const loop = createLoop(
    ({ dt, static: isStatic }) => {
      if (!state.frames) return;
      if (isStatic) {
        // Reduced motion, or a manual repaint: hold whatever frame is selected.
        render();
        return;
      }
      const endTime = state.count * FRAME_S + state.delay;
      const audible =
        state.sound && !audio.paused && !audio.ended && audio.readyState >= 2;

      if (state.sound && (audio.ended || audio.currentTime >= endTime)) {
        // Wrap: the clip is short, so it loops rather than stopping.
        state.playhead = 0;
        setIndex(0);
        startAudio();
      } else if (audible) {
        // The picture follows the sound, not a separate clock.
        state.playhead = Math.max(0, audio.currentTime - state.delay);
        setIndex(Math.round(state.playhead / FRAME_S));
      } else {
        // No usable audio clock (sound off, still loading, or playback was
        // refused): run a virtual one, and keep trying to get the sound back.
        state.playhead += Math.min(dt, 0.1);
        let i = Math.floor(state.playhead / FRAME_S);
        if (i >= state.count) {
          state.playhead = 0;
          i = 0;
        }
        setIndex(i);
        if (
          state.sound &&
          audio.paused &&
          performance.now() - lastPlayAttempt > 900
        ) {
          startAudio();
        }
      }
      render();
    },
    {
      element: root,
      fps: 50,
      autoplay: true,
      onStateChange(running) {
        if (playButton) {
          playButton.setAttribute("aria-pressed", running ? "true" : "false");
          playButton.textContent = running ? "Pause" : "Play";
        }
        if (!running) audio.pause();
        else if (state.sound && audio.paused) startAudio();
      },
    }
  );

  /* -- data -------------------------------------------------------------- */

  /**
   * Load a clip and show it.
   * @param {string} id clip id
   * @param {{resume?: boolean}} [options] `resume: true` means playback is
   *        about to continue, so start at the top of the clip; otherwise land
   *        on a frame that is actually worth looking at rather than on silence.
   */
  async function selectClip(id, options = {}) {
    const resume = options.resume !== false;
    state.clipId = id;
    for (const b of clipButtons) {
      b.setAttribute("aria-pressed", b.dataset.clip === id ? "true" : "false");
    }
    if (frame) frame.dataset.state = "loading";

    const [frames, spectra] = await Promise.all([
      loadJSON(`assets/data/${id}/frames.json`),
      loadJSON(`assets/data/${id}/spectra.json`),
    ]);
    if (state.clipId !== id) return; // reader switched again while loading

    state.frames = frames;
    state.spectra = spectra;
    state.bands = frames.derived_notes.band_edges_hz;
    state.count = frames.frames.length;
    state.delay =
      frames.clip.decoded_delay_samples / frames.clip.sample_rate_hz;
    state.raster = null;
    state.playhead = 0;

    if (range) {
      range.max = String(state.count - 1);
      range.value = "0";
    }
    if (subtitle) {
      subtitle.textContent = `“${frames.clip.text}” — ${frames.clip.voice.model}, round-tripped through a DVSI AMBE-3000`;
    }
    audio.src = assetURL(frames.clip.decoded_audio);
    audio.load();

    if (frame) frame.dataset.state = "ready";
    setIndex(reduced || !resume ? representativeFrame() : 0, {
      syncRange: false,
    });
    if (range) range.value = String(state.index);
    state.playhead = state.index * FRAME_S;
    render();
    if (state.sound) startAudio();
  }

  /** Under reduced motion the figure never animates, so the one frame it holds
   *  has to earn its place: the loudest frame whose eight bands are genuinely
   *  mixed, which is the case the whole figure exists to show. */
  function representativeFrame() {
    let best = Math.floor(state.count * 0.42);
    let bestScore = -Infinity;
    for (let i = 0; i < state.count; i += 1) {
      const d = state.frames.frames[i].derived;
      const voiced = d.band_voiced.filter(Boolean).length;
      if (voiced < 2 || voiced > 6) continue;
      if (d.decoded_rms_dbfs > bestScore) {
        bestScore = d.decoded_rms_dbfs;
        best = i;
      }
    }
    return best;
  }

  /* -- events ------------------------------------------------------------ */

  const onPlay = () => {
    if (loop.isRunning()) {
      loop.stop();
    } else {
      state.playhead = state.index * FRAME_S;
      loop.start();
    }
  };

  const onScrub = () => {
    loop.stop();
    setIndex(Number(range.value), { syncRange: false });
    state.playhead = state.index * FRAME_S;
    if (state.sound) seekAudio(state.index);
    render();
  };

  const onClipClick = (event) => {
    const id = event.currentTarget.dataset.clip;
    if (id === state.clipId) return;
    const wasRunning = loop.isRunning();
    loop.stop();
    selectClip(id, { resume: wasRunning })
      .then(() => {
        if (wasRunning) loop.start();
      })
      .catch((error) => {
        console.error(`anim-${SLUG}: could not load ${id}`, error);
        if (frame) frame.dataset.state = "error";
      });
  };

  const onSound = () => {
    state.sound = !!soundToggle.checked;
    if (!state.sound) audio.pause();
    else if (loop.isRunning()) startAudio();
  };

  const onOriginal = () => {
    state.original = !!originalToggle.checked;
    render();
  };

  // Dragging on the voicing map scrubs.
  let dragging = false;
  function seekFromPointer(event) {
    if (!state.count) return;
    const rect = canvas.getBoundingClientRect();
    const geo = layout();
    const x = event.clientX - rect.left;
    const f = (x - geo.strip.left) / Math.max(1, geo.strip.width);
    setIndex(Math.round(f * (state.count - 1)));
    state.playhead = state.index * FRAME_S;
    if (state.sound) seekAudio(state.index);
    render();
  }
  const onPointerDown = (event) => {
    if (!state.count) return;
    const rect = canvas.getBoundingClientRect();
    const geo = layout();
    const y = event.clientY - rect.top;
    if (y < geo.strip.top - 12 || y > geo.strip.bottom + 8) return;
    dragging = true;
    loop.stop();
    canvas.setPointerCapture(event.pointerId);
    seekFromPointer(event);
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    seekFromPointer(event);
  };
  const onPointerUp = (event) => {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* pointer already released */
    }
  };
  const onPointerHover = (event) => {
    if (!state.count) return;
    const rect = canvas.getBoundingClientRect();
    const geo = layout();
    const y = event.clientY - rect.top;
    const over = y >= geo.strip.top - 12 && y <= geo.strip.bottom + 8;
    canvas.style.cursor = over ? "ew-resize" : "";
  };

  if (playButton) playButton.addEventListener("click", onPlay);
  if (range) range.addEventListener("input", onScrub);
  for (const b of clipButtons) b.addEventListener("click", onClipClick);
  if (soundToggle) soundToggle.addEventListener("change", onSound);
  if (originalToggle) originalToggle.addEventListener("change", onOriginal);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointermove", onPointerHover);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  const unsubscribeTheme = onThemeChange(() => {
    state.raster = null;
    render();
  });

  selectClip(state.clipId).catch((error) => {
    console.error(`anim-${SLUG}: could not load data`, error);
    if (frame) frame.dataset.state = "error";
  });

  return () => {
    if (playButton) playButton.removeEventListener("click", onPlay);
    if (range) range.removeEventListener("input", onScrub);
    for (const b of clipButtons) b.removeEventListener("click", onClipClick);
    if (soundToggle) soundToggle.removeEventListener("change", onSound);
    if (originalToggle) originalToggle.removeEventListener("change", onOriginal);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointermove", onPointerHover);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    unsubscribeTheme();
    loop.destroy();
    handle.destroy();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };
}

export default mount;

/* Self-register: every [data-anim="voicing"] on the page, now and after each
 * navigation.instant swap. */
mountAnim(`[data-anim="${SLUG}"]`, mount);
