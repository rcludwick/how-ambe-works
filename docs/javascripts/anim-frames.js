/* ===========================================================================
 * anim-frames.js — "frames": what a 20 ms frame actually is
 * ---------------------------------------------------------------------------
 * SLUG      frames          place it with  <div data-anim="frames"></div>
 *
 * DATA READ (precomputed, site-root-relative; see docs/assets/data/SCHEMA.md)
 *   assets/data/waveform.json   min/max envelope of the captured clip, both
 *                               tracks, decoded already delay-compensated
 *   assets/data/frames.json     the 72 measured channel bits per frame, plus
 *                               derived level, pitch and band voicing
 *   assets/audio/<clip>-original.wav, -ambe.wav   the same audio, for the
 *                               zoomed inset's samples and for playback
 *
 * CONTROLS
 *   Play / Pause     plays the clip; the 20 ms window tracks the playhead.
 *   "Frame"          slider over all frames. Keyboard: Tab, then arrow keys.
 *   Original / Through AMBE   which of the two tracks is drawn and played.
 *   Pointer          drag anywhere on the waveform or the inset to scrub.
 *
 * WHAT THIS FILE IS NOT
 *   It is a drawing program. It decodes two WAV files so it can plot their
 *   samples and play them, and it draws numbers that were computed offline.
 *   It contains no AMBE analysis, no synthesis, no quantiser and no bit
 *   unpacking: the 72-bit channel frame is displayed as opaque hex, exactly
 *   as the hardware emitted it, and is never taken apart — the mapping from
 *   those bits to codec parameters is not public (SCHEMA.md).
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  mount as autoMount,
  setupCanvas,
  clearCanvas,
  createLoop,
  drawLabel,
  loadJSON,
  assetURL,
  getTheme,
  onThemeChange,
  crisp,
  prefersReducedMotion,
} from "./anim-core.js";

const SLUG = "frames";
const STYLE_ID = "anim-frames-style";

/* ---------------------------------------------------------------------------
 * Markup and its scoped styling (tokens only — no new colours)
 * ------------------------------------------------------------------------ */

const STYLE = `
[data-anim="frames"] .anim-figure__frame {
  --anim-aspect: 2 / 1;
  --anim-min-width: 300px;
}
@media screen and (max-width: 46em) {
  [data-anim="frames"] .anim-figure__frame { --anim-aspect: 1 / 1; }
}
.fp {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.35rem;
  margin-top: 0.6rem;
}
.fp__cell {
  background-color: var(--ambe-surface-2);
  border: 1px solid var(--ambe-hairline);
  border-radius: var(--ambe-radius-sm);
  padding: 0.4rem 0.55rem;
}
.fp__cell--wide { grid-column: 1 / -1; }
.fp__key {
  align-items: baseline;
  color: var(--ambe-text-4);
  display: flex;
  font-size: 0.55rem;
  gap: 0.35rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.fp__key em {
  color: var(--ambe-accent-cool);
  font-size: 0.9em;
  font-style: normal;
  letter-spacing: 0.02em;
}
.fp__key em.is-measured { color: var(--ambe-accent-warm); }
.fp__val {
  color: var(--ambe-text);
  display: block;
  font-family: var(--ambe-font-mono);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  margin-top: 0.15rem;
  word-break: break-all;
}
.fp__val--dim { color: var(--ambe-text-3); }
.fp__bands {
  align-items: flex-end;
  display: flex;
  gap: 3px;
  margin-top: 0.28rem;
}
.fp__band {
  background-color: var(--ambe-surface-3);
  border-radius: 2px;
  display: block;
  flex: 1 1 auto;
  height: 1.15rem;
  max-width: 1.6rem;
  position: relative;
}
.fp__band::after {
  background-color: var(--ambe-text-4);
  border-radius: 2px;
  bottom: 0;
  content: "";
  height: calc(var(--v, 0) * 100%);
  left: 0;
  position: absolute;
  right: 0;
}
.fp__band[data-on="1"]::after { background-color: var(--ambe-accent-cool); }
.fp__scale {
  color: var(--ambe-text-4);
  display: flex;
  font-size: 0.5rem;
  justify-content: space-between;
  margin-top: 0.2rem;
}
`;

const TEMPLATE = `
  <div class="anim-figure__head">
    <h4 class="anim-figure__title">Fifty frames a second, one at a time</h4>
    <span class="badge measured">measured</span>
  </div>

  <div class="anim-figure__scroll">
    <div class="anim-figure__frame" data-state="loading">
      <canvas class="anim-figure__canvas"
              aria-label="The whole clip as a waveform with one 20 millisecond frame highlighted, and a zoomed view of that frame and its neighbours"></canvas>
    </div>
  </div>

  <div class="fp">
    <div class="fp__cell">
      <span class="fp__key">Frame</span>
      <span class="fp__val" data-role="p-frame">—</span>
    </div>
    <div class="fp__cell">
      <span class="fp__key">Time</span>
      <span class="fp__val" data-role="p-time">—</span>
    </div>
    <div class="fp__cell">
      <span class="fp__key">Level <em>derived</em></span>
      <span class="fp__val" data-role="p-level">—</span>
    </div>
    <div class="fp__cell">
      <span class="fp__key">Pitch <em>derived</em></span>
      <span class="fp__val" data-role="p-pitch">—</span>
    </div>
    <div class="fp__cell fp__cell--wide">
      <span class="fp__key">Channel frame <em class="is-measured">measured</em></span>
      <span class="fp__val" data-role="p-hex">—</span>
    </div>
    <div class="fp__cell fp__cell--wide">
      <span class="fp__key">Band voicing <em>derived · decoded audio</em></span>
      <span class="fp__bands" data-role="p-bands"></span>
      <span class="fp__scale"><span>0 Hz</span><span>4 kHz</span></span>
    </div>
  </div>

  <div class="anim-controls">
    <button class="anim-btn anim-btn--play" type="button" aria-pressed="false">Play</button>
    <label class="anim-field">
      <span class="anim-field__label">Frame</span>
      <input class="anim-range" data-role="frame" type="range" min="0" max="0" step="1" value="0"
             aria-label="Which 20 millisecond frame is selected">
    </label>
    <output class="anim-readout anim-readout--wide" data-role="time-out">0.00 s</output>
    <div class="anim-toggle-group" role="group" aria-label="Which audio track to show">
      <button class="anim-btn" type="button" data-track="original" aria-pressed="true">Original</button>
      <button class="anim-btn" type="button" data-track="decoded" aria-pressed="false">Through AMBE</button>
    </div>
  </div>

  <p class="anim-figure__hint">Playback is off because your system asks for
     reduced motion. Drag the waveform, or use the Frame slider, to step
     through the clip by hand.</p>
`;

const CAPTION = `
  The whole utterance is on top; the bright sliver is one frame. Drag it —
  or press Play and watch it walk — and the panel underneath changes fifty
  times a second. That sliver is all the coder ever sees at once: 160 samples
  of speech, in and out, replaced by the 72 bits shown as
  <span class="badge measured">measured</span> hex. 72 bits × 50 frames per
  second = 3600 bit/s, which is the whole D-STAR voice channel including its
  FEC <span class="cite">JARL D-STAR system specification</span>. Try dragging
  slowly across a vowel and watching the pitch hold steady, then across a
  <em>ssss</em> and watching it drop out; switch to
  <strong>Through AMBE</strong> to compare the same frame after a real round
  trip.
  <span class="anim-figure__source">
    Source: a ThumbDV (DVSI AMBE-3000) capture — <code>assets/data/waveform.json</code>,
    <code>assets/data/frames.json</code> and the two WAVs in
    <code>assets/audio/</code>. The hex is exactly what the chip emitted and is
    never decomposed here: the chip has no packet that reports its internal
    parameters, so the level, pitch and band-voicing figures are ordinary DSP
    measured on the audio, not codec state.
  </span>
`;

/* ---------------------------------------------------------------------------
 * Helpers (display maths only)
 * ------------------------------------------------------------------------ */

/** Trim a string with an ellipsis until it fits `width` in the current font. */
function ellipsize(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid).trim()}…`).width <= width) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low).trim()}…` : "";
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

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

/** Decode a WAV into an AudioBuffer at its own 8 kHz rate, for drawing.
 *  An OfflineAudioContext is used so nothing touches the audio hardware. */
async function decodeSamples(url, sampleRate) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) return null;
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`anim-frames: ${response.status} ${url}`);
  const bytes = await response.arrayBuffer();
  const context = new Offline(1, 1, sampleRate);
  const buffer = await new Promise((resolve, reject) => {
    const maybe = context.decodeAudioData(bytes, resolve, reject);
    if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
  });
  return { data: buffer.getChannelData(0), rate: buffer.sampleRate };
}

/* ---------------------------------------------------------------------------
 * Mount
 * ------------------------------------------------------------------------ */

/**
 * Build the "frames" figure inside `host`.
 * @param {Element} host an element carrying data-anim="frames"
 * @returns {Promise<() => void>} cleanup
 */
export async function mount(host) {
  ensureStyle();
  const figure = buildFigure(host);
  const frameBox = figure.querySelector(".anim-figure__frame");
  const canvas = figure.querySelector(".anim-figure__canvas");
  const playButton = figure.querySelector(".anim-btn--play");
  const frameInput = figure.querySelector('[data-role="frame"]');
  const timeOut = figure.querySelector('[data-role="time-out"]');
  const trackButtons = Array.from(figure.querySelectorAll("[data-track]"));
  const panel = {
    frame: figure.querySelector('[data-role="p-frame"]'),
    time: figure.querySelector('[data-role="p-time"]'),
    level: figure.querySelector('[data-role="p-level"]'),
    pitch: figure.querySelector('[data-role="p-pitch"]'),
    hex: figure.querySelector('[data-role="p-hex"]'),
    bands: figure.querySelector('[data-role="p-bands"]'),
  };

  const bandEls = [];
  for (let b = 0; b < 8; b += 1) {
    const el = document.createElement("i");
    el.className = "fp__band";
    el.style.setProperty("--v", "0");
    panel.bands.appendChild(el);
    bandEls.push(el);
  }

  const [wave, frameData] = await Promise.all([
    loadJSON("assets/data/waveform.json"),
    loadJSON("assets/data/frames.json"),
  ]);
  delete frameBox.dataset.state;

  const clip = wave.clip;
  const frames = frameData.frames;
  const frameCount = clip.frame_count;
  const frameS = clip.frame_ms / 1000;
  const duration = frameCount * frameS;
  const bucketS = wave.bucket_ms / 1000;
  const buckets = wave.bucket_count;
  const fullScale = wave.sample_full_scale;
  const delayS = clip.decoded_delay_samples / clip.sample_rate_hz;
  const bandEdges = frameData.derived_notes.band_edges_hz;

  const tracks = {
    original: { env: wave.original, audioPath: clip.original_audio, offset: 0 },
    decoded: { env: wave.decoded, audioPath: clip.decoded_audio, offset: delayS },
  };

  // Peak of each envelope, so the overview fills its box.
  for (const key of Object.keys(tracks)) {
    let peak = 1;
    const env = tracks[key].env;
    for (let b = 0; b < buckets; b += 1) {
      peak = Math.max(peak, Math.abs(env.min[b]), Math.abs(env.max[b]));
    }
    tracks[key].peak = peak / fullScale;
  }

  /* -- audio ------------------------------------------------------------ */

  const audio = {};
  for (const key of Object.keys(tracks)) {
    const el = new Audio();
    el.src = assetURL(tracks[key].audioPath);
    el.preload = "metadata";
    audio[key] = el;
  }

  // PCM for the zoomed inset. Failure is survivable: the inset falls back to
  // the 2.5 ms min/max buckets that waveform.json already provides.
  const pcm = { original: null, decoded: null };
  const pcmReady = Promise.all(
    Object.keys(tracks).map((key) =>
      decodeSamples(assetURL(tracks[key].audioPath), clip.sample_rate_hz)
        .then((result) => {
          pcm[key] = result;
        })
        .catch((error) => {
          console.warn("anim-frames: falling back to bucket envelope", error);
        })
    )
  ).then(() => draw());

  /* -- state ------------------------------------------------------------ */

  // Open on a confidently voiced frame: it is the representative still under
  // prefers-reduced-motion, and a better first impression than silence.
  let startFrame = 0;
  let bestConfidence = -1;
  frames.forEach((f, i) => {
    if (f.derived.orig_f0_confidence > bestConfidence) {
      bestConfidence = f.derived.orig_f0_confidence;
      startFrame = i;
    }
  });

  let trackKey = "original";
  let index = startFrame;
  let playing = false;
  let dragging = null; // "overview" | "inset"
  let geom = null;
  let painted = -1;

  frameInput.max = String(frameCount - 1);
  frameInput.value = String(index);

  const clampIndex = (i) => Math.min(Math.max(i | 0, 0), frameCount - 1);
  const activeAudio = () => audio[trackKey];
  const displayTime = () =>
    playing ? activeAudio().currentTime - tracks[trackKey].offset : index * frameS;

  /* -- panel ------------------------------------------------------------ */

  function paintPanel(force) {
    if (!force && painted === index) return;
    painted = index;
    const f = frames[index];
    const d = f.derived;

    panel.frame.textContent = `${f.i} of ${frameCount}`;
    panel.time.textContent = `${f.t.toFixed(3)} – ${(f.t + frameS).toFixed(3)} s`;
    const level =
      trackKey === "decoded" ? d.decoded_rms_dbfs : d.orig_rms_dbfs;
    panel.level.textContent = `${level.toFixed(1)} dBFS`;

    const f0 = trackKey === "decoded" ? d.decoded_f0_hz : d.orig_f0_hz;
    const conf =
      trackKey === "decoded" ? d.decoded_f0_confidence : d.orig_f0_confidence;
    if (f0 > 0) {
      panel.pitch.textContent = `${f0.toFixed(1)} Hz · conf ${conf.toFixed(2)}`;
      panel.pitch.classList.remove("fp__val--dim");
    } else {
      panel.pitch.textContent = "no periodicity";
      panel.pitch.classList.add("fp__val--dim");
    }

    panel.hex.textContent = f.hex.replace(/(.{2})/g, "$1 ").trim();

    for (let b = 0; b < 8; b += 1) {
      const v = d.band_voicing[b] || 0;
      bandEls[b].style.setProperty("--v", String(Math.min(1, Math.max(0, v))));
      bandEls[b].dataset.on = d.band_voiced[b] ? "1" : "0";
      bandEls[b].title = `${bandEdges[b][0]}–${bandEdges[b][1]} Hz: ${v.toFixed(
        2
      )}${d.band_voiced[b] ? " (voiced)" : ""}`;
    }

    timeOut.textContent = `#${f.i} · ${f.t.toFixed(2)} s`;
    if (frameInput.value !== String(index)) frameInput.value = String(index);
    frameInput.setAttribute(
      "aria-valuetext",
      `frame ${f.i} of ${frameCount}, ${f.t.toFixed(2)} seconds, ${
        f0 > 0 ? `${f0.toFixed(0)} hertz` : "no periodicity"
      }`
    );
  }

  /* -- drawing ---------------------------------------------------------- */

  const view = setupCanvas(canvas, { onResize: () => draw() });
  const ctx = view.ctx;

  function extremes(env, tA, tB) {
    const b0 = Math.max(0, Math.floor(tA / bucketS));
    const b1 = Math.min(buckets - 1, Math.ceil(tB / bucketS) - 1);
    let lo = 0;
    let hi = 0;
    for (let b = b0; b <= b1; b += 1) {
      if (env.min[b] < lo) lo = env.min[b];
      if (env.max[b] > hi) hi = env.max[b];
    }
    return [lo / fullScale, hi / fullScale];
  }

  function drawOverview(theme, box) {
    const track = tracks[trackKey];
    const mid = box.y + box.height / 2;
    const half = (box.height / 2) * (0.94 / track.peak);
    const t0 = index * frameS;
    const t1 = t0 + frameS;

    // Envelope, one vertical extent per pixel column.
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let px = 0; px < box.width; px += 1) {
      const tA = (px / box.width) * duration;
      const tB = ((px + 1) / box.width) * duration;
      const [lo, hi] = extremes(track.env, tA, tB);
      const x = crisp(box.x + px);
      ctx.moveTo(x, mid - hi * half);
      ctx.lineTo(x, mid - lo * half + 0.5);
    }
    ctx.stroke();

    // Frame tick ruler: 168 of these is the point of the figure.
    const perFrame = box.width / frameCount;
    if (perFrame >= 2.5) {
      ctx.strokeStyle = theme.hairline;
      ctx.beginPath();
      for (let i = 0; i <= frameCount; i += 1) {
        const x = crisp(box.x + i * perFrame);
        ctx.moveTo(x, box.y + box.height);
        ctx.lineTo(x, box.y + box.height - (i % 10 === 0 ? 7 : 4));
      }
      ctx.stroke();
    }

    // The selected 20 ms, redrawn bright inside a highlight.
    const xa = box.x + (t0 / duration) * box.width;
    const xb = box.x + (t1 / duration) * box.width;
    const wide = Math.max(xb - xa, 3);
    ctx.fillStyle = theme.css("--ambe-accent-soft", "rgba(125,140,255,0.14)");
    ctx.fillRect(xa, box.y, wide, box.height);

    ctx.strokeStyle = theme.series[0];
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let px = Math.floor(xa); px <= Math.ceil(xb); px += 1) {
      const tA = ((px - box.x) / box.width) * duration;
      const tB = ((px + 1 - box.x) / box.width) * duration;
      const [lo, hi] = extremes(track.env, tA, tB);
      const x = crisp(px);
      ctx.moveTo(x, mid - hi * half);
      ctx.lineTo(x, mid - lo * half + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = theme.series[0];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crisp(xa), box.y - 4);
    ctx.lineTo(crisp(xa), box.y + box.height + 2);
    ctx.moveTo(crisp(xa + wide), box.y - 4);
    ctx.lineTo(crisp(xa + wide), box.y + box.height + 2);
    ctx.stroke();

    // Playhead.
    if (playing) {
      const tp = Math.min(Math.max(displayTime(), 0), duration);
      const xp = crisp(box.x + (tp / duration) * box.width);
      ctx.strokeStyle = theme.series[2];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xp, box.y - 4);
      ctx.lineTo(xp, box.y + box.height + 2);
      ctx.stroke();
    }

    return { xa, xb: xa + wide };
  }

  function drawInset(theme, box, compact) {
    const track = tracks[trackKey];
    const samples = pcm[trackKey];
    const tStart = (index - 1) * frameS;
    const tEnd = (index + 2) * frameS;
    const span = tEnd - tStart;
    const mid = box.y + box.height / 2;
    const xOf = (t) => box.x + ((t - tStart) / span) * box.width;

    // Middle band: the selected frame.
    ctx.fillStyle = theme.css("--ambe-accent-soft", "rgba(125,140,255,0.14)");
    ctx.fillRect(xOf(index * frameS), box.y, box.width / 3, box.height);

    // Frame boundaries, and what is on each side.
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let k = 0; k <= 3; k += 1) {
      const x = crisp(xOf((index - 1 + k) * frameS));
      ctx.moveTo(x, box.y);
      ctx.lineTo(x, box.y + box.height);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Zero line.
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(box.x, crisp(mid));
    ctx.lineTo(box.x + box.width, crisp(mid));
    ctx.stroke();

    // Auto-scale to what is on screen, with a floor so silence stays flat.
    let peak = 0.015;
    const points = [];
    if (samples) {
      const rate = samples.rate;
      const i0 = Math.max(0, Math.floor((tStart + track.offset) * rate));
      const i1 = Math.min(
        samples.data.length,
        Math.ceil((tEnd + track.offset) * rate)
      );
      for (let n = i0; n < i1; n += 1) peak = Math.max(peak, Math.abs(samples.data[n]));
      const half = (box.height / 2) * (0.9 / peak);
      for (let n = i0; n < i1; n += 1) {
        points.push({
          x: xOf(n / rate - track.offset),
          y: mid - samples.data[n] * half,
        });
      }
    } else {
      // Fallback: 2.5 ms min/max buckets, drawn as a filled band.
      const b0 = Math.max(0, Math.floor(tStart / bucketS));
      const b1 = Math.min(buckets, Math.ceil(tEnd / bucketS));
      for (let b = b0; b < b1; b += 1) {
        peak = Math.max(
          peak,
          Math.abs(track.env.min[b]) / fullScale,
          Math.abs(track.env.max[b]) / fullScale
        );
      }
      const half = (box.height / 2) * (0.9 / peak);
      ctx.fillStyle = theme.muted;
      ctx.beginPath();
      for (let b = b0; b < b1; b += 1) {
        ctx.lineTo(xOf(b * bucketS), mid - (track.env.max[b] / fullScale) * half);
      }
      for (let b = b1 - 1; b >= b0; b -= 1) {
        ctx.lineTo(xOf(b * bucketS), mid - (track.env.min[b] / fullScale) * half);
      }
      ctx.closePath();
      ctx.fill();
    }

    if (points.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.width, box.height);
      ctx.clip();

      // Neighbours dimmed, the selected frame bright.
      const xLeft = xOf(index * frameS);
      const xRight = xOf((index + 1) * frameS);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let n = 1; n < points.length; n += 1) ctx.lineTo(points[n].x, points[n].y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = theme.series[trackKey === "decoded" ? 1 : 0];
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      let started = false;
      for (let n = 0; n < points.length; n += 1) {
        if (points[n].x < xLeft - 1 || points[n].x > xRight + 1) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(points[n].x, points[n].y);
          started = true;
        } else {
          ctx.lineTo(points[n].x, points[n].y);
        }
      }
      ctx.stroke();

      // Individual samples, once there is room for them.
      const perSample = box.width / (span * (samples ? samples.rate : 8000));
      if (perSample > 4) {
        ctx.fillStyle = theme.series[trackKey === "decoded" ? 1 : 0];
        for (let n = 0; n < points.length; n += 1) {
          if (points[n].x < xLeft - 1 || points[n].x > xRight + 1) continue;
          ctx.beginPath();
          ctx.arc(points[n].x, points[n].y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Playhead in the inset.
    if (playing) {
      const tp = displayTime();
      if (tp >= tStart && tp <= tEnd) {
        const xp = crisp(xOf(tp));
        ctx.strokeStyle = theme.series[2];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xp, box.y);
        ctx.lineTo(xp, box.y + box.height);
        ctx.stroke();
      }
    }

    // Labels for the three frames.
    const labelY = box.y + box.height - 5;
    const names = [`frame ${index - 1}`, `frame ${index}`, `frame ${index + 1}`];
    for (let k = 0; k < 3; k += 1) {
      const i = index - 1 + k;
      if (i < 0 || i >= frameCount) continue;
      drawLabel(ctx, names[k], xOf((i + 0.5) * frameS), labelY, {
        align: "center",
        baseline: "alphabetic",
        size: compact ? 9.5 : 10.5,
        weight: k === 1 ? 600 : 400,
        color: k === 1 ? theme.series[0] : theme.text4,
      });
    }

    const chipSize = compact ? 9.5 : 11;
    ctx.save();
    ctx.font = `550 ${chipSize}px ${theme.font}`;
    const room = box.width / 3 - 10;
    const chip =
      ctx.measureText("160 samples · 20 ms · 72 channel bits").width <= room
        ? "160 samples · 20 ms · 72 channel bits"
        : ctx.measureText("160 samples · 72 bits").width <= room
        ? "160 samples · 72 bits"
        : "20 ms · 72 bits";
    ctx.restore();

    drawLabel(
      ctx,
      chip,
      xOf((index + 0.5) * frameS),
      box.y + 12,
      {
        align: "center",
        baseline: "middle",
        size: chipSize,
        weight: 550,
        color: theme.ink,
        background: theme.surface2,
        padding: 4,
      }
    );

    return { xLeft: xOf(index * frameS), xRight: xOf((index + 1) * frameS), tStart, span };
  }

  function draw() {
    const theme = getTheme();
    clearCanvas(ctx, view, theme.plotBg);
    const compact = view.width < 520;
    const padX = 12;
    const headerH = compact ? 18 : 22;
    const width = Math.max(40, view.width - padX * 2);
    const bodyH = view.height - headerH - 8;
    const overviewH = Math.round(bodyH * 0.4);
    const linkH = compact ? 16 : 22;
    const insetH = bodyH - overviewH - linkH;

    const overview = { x: padX, y: headerH, width, height: overviewH };
    const inset = {
      x: padX,
      y: headerH + overviewH + linkH,
      width,
      height: Math.max(40, insetH),
    };

    const headSize = compact ? 10 : 11;
    const headRight = `${duration.toFixed(2)} s · ${frameCount} frames · ${
      trackKey === "decoded" ? "after AMBE" : "original"
    }`;
    ctx.save();
    ctx.font = `500 ${headSize}px ${theme.font}`;
    const rightWidth = ctx.measureText(headRight).width;
    const headLeft = ellipsize(ctx, clip.text, width - rightWidth - 16);
    ctx.restore();

    drawLabel(ctx, headLeft, padX, compact ? 4 : 5, {
      align: "left",
      baseline: "top",
      size: headSize,
      weight: 500,
      color: theme.text3,
    });
    drawLabel(ctx, headRight, padX + width, compact ? 4 : 5, {
      align: "right",
      baseline: "top",
      size: headSize,
      weight: 500,
      color: theme.text3,
    });

    const marks = drawOverview(theme, overview);
    const insetMarks = drawInset(theme, inset, compact);

    // Zoom connector between the sliver above and the wide view below.
    ctx.save();
    ctx.strokeStyle = theme.series[0];
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(marks.xa, overview.y + overview.height + 3);
    ctx.lineTo(insetMarks.xLeft, inset.y - 3);
    ctx.moveTo(marks.xb, overview.y + overview.height + 3);
    ctx.lineTo(insetMarks.xRight, inset.y - 3);
    ctx.stroke();
    ctx.restore();

    geom = { overview, inset, insetMarks };
    paintPanel(false);
  }

  /* -- playback --------------------------------------------------------- */

  const loop = createLoop(
    () => {
      const el = activeAudio();
      const t = el.currentTime - tracks[trackKey].offset;
      const next = clampIndex(Math.floor(t / frameS));
      if (next !== index) index = next;
      draw();
    },
    { element: figure, autoplay: false, onStateChange(running) {
        if (!running && playing) pause();
      } }
  );

  function setPlayButton(on) {
    playButton.setAttribute("aria-pressed", on ? "true" : "false");
    playButton.textContent = on ? "Pause" : "Play";
  }

  /** Seeking before metadata arrives throws in some engines; never fatal. */
  function setTime(el, t) {
    try {
      const limit = isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.min(Math.max(t, 0), limit);
    } catch (error) {
      /* the next seek will land once metadata is in */
    }
  }

  function play() {
    const el = activeAudio();
    const want = index * frameS + tracks[trackKey].offset;
    if (Math.abs(el.currentTime - want) > frameS * 1.5) setTime(el, want);
    const started = el.play();
    if (started && typeof started.catch === "function") {
      started.catch((error) => {
        console.warn("anim-frames: playback blocked", error);
        pause();
      });
    }
    playing = true;
    setPlayButton(true);
    loop.start();
  }

  function pause() {
    playing = false;
    for (const key of Object.keys(audio)) audio[key].pause();
    setPlayButton(false);
    loop.stop();
    draw();
  }

  const onPlayClick = () => (playing ? pause() : play());
  const onEnded = () => {
    pause();
    index = 0;
    for (const key of Object.keys(audio)) setTime(audio[key], 0);
    paintPanel(true);
    draw();
  };

  playButton.addEventListener("click", onPlayClick);
  for (const key of Object.keys(audio)) {
    audio[key].addEventListener("ended", onEnded);
  }

  /* -- scrubbing -------------------------------------------------------- */

  function seek(i, keepAudio) {
    index = clampIndex(i);
    if (!keepAudio) {
      setTime(activeAudio(), index * frameS + tracks[trackKey].offset);
    }
    paintPanel(false);
    draw();
  }

  const localX = (event) => {
    const rect = canvas.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * view.width;
  };
  const localY = (event) => {
    const rect = canvas.getBoundingClientRect();
    return ((event.clientY - rect.top) / rect.height) * view.height;
  };

  function scrubFrom(event) {
    if (!geom) return;
    const x = localX(event);
    if (dragging === "inset") {
      const t = geom.insetMarks.tStart + ((x - geom.inset.x) / geom.inset.width) * geom.insetMarks.span;
      seek(Math.floor(t / frameS));
    } else {
      const t = ((x - geom.overview.x) / geom.overview.width) * duration;
      seek(Math.floor(t / frameS));
    }
  }

  const onPointerDown = (event) => {
    if (!geom) return;
    const y = localY(event);
    dragging = y >= geom.inset.y - 6 ? "inset" : "overview";
    if (playing) pause();
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = "grabbing";
    scrubFrom(event);
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    scrubFrom(event);
  };
  const onPointerUp = (event) => {
    if (!dragging) return;
    dragging = null;
    canvas.style.cursor = "";
    canvas.releasePointerCapture?.(event.pointerId);
  };

  canvas.style.touchAction = "pan-y";
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  const onRange = () => {
    if (playing) pause();
    seek(Number(frameInput.value) | 0);
  };
  frameInput.addEventListener("input", onRange);

  const onTrack = (event) => {
    const key = event.currentTarget.dataset.track;
    if (key === trackKey) return;
    const wasPlaying = playing;
    if (playing) pause();
    trackKey = key;
    for (const button of trackButtons) {
      button.setAttribute(
        "aria-pressed",
        button.dataset.track === key ? "true" : "false"
      );
    }
    seek(index);
    paintPanel(true);
    if (wasPlaying) play();
  };
  for (const button of trackButtons) button.addEventListener("click", onTrack);

  const unsubscribe = onThemeChange(() => draw());

  if (prefersReducedMotion()) figure.classList.add("is-static");
  setPlayButton(false);
  paintPanel(true);
  draw();
  void pcmReady;

  return () => {
    unsubscribe();
    loop.destroy();
    view.destroy();
    for (const key of Object.keys(audio)) {
      audio[key].pause();
      audio[key].removeEventListener("ended", onEnded);
      audio[key].src = "";
    }
    playButton.removeEventListener("click", onPlayClick);
    frameInput.removeEventListener("input", onRange);
    for (const button of trackButtons) button.removeEventListener("click", onTrack);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
  };
}

export default mount;

// Self-register: anim-core's mount() handles DOMContentLoaded and the
// navigation.instant page swaps, and tears each instance down on the way out.
autoMount(`[data-anim="${SLUG}"]`, mount);
