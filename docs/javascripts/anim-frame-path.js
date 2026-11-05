// @ts-check
/* ===========================================================================
 * anim-frame-path.js: one 20 ms frame followed from the input samples to the
 * 72 bits the chip sent, back to its decoded audio, and onto the air
 * (ch10, design §2.4 and three-everywhere §5.10).
 * ---------------------------------------------------------------------------
 * Seven stages, each drawn for the selected frame:
 *
 *   1 Input       the frame's 160 input samples           input
 *   2 Pitch       input spectrum, comb at k x f0, L        derived (input)
 *   3 Voicing     eight band strengths against 0.55        derived (decoded)
 *   4 Encoder     a closed box: the chip reports nothing   none
 *   5 The frame   72 cells, one per bit, from hexBits()    measured
 *   6 Decoded     decoded spectrum over the input's        derived (decoded)
 *   7 On the air  21 rows of 96 cells: 72 voice, 24 data   measured voice
 *                 bits; data and sync slots by class only  bits, illustrative
 *                                                          slot alignment
 *
 * This module is the 2D view, the controls, the steps and the walk-through.
 * The 3D view (anim-frame-path-3d.js, loaded through lib/view-switch.js)
 * puts time in depth: the selected frame is the outlined slice and its
 * neighbours sit 20 ms apart. Opening rule (owner decision O1): with
 * WebGL 2 and motion allowed the figure opens in 3D and plays its
 * animation once; otherwise it opens here, in 2D, at the end state.
 *
 * Play runs the steps in order as one walk-through, each step's text as a
 * caption under the frame and, in 3D, a slow camera move per step. The
 * reader can pause it, jump to any step, or take over (any press on the
 * figure pauses it). Under reduced motion it steps through end states.
 *
 * Bits come only from hexBits() in anim-core.js, one bit per entry. This
 * module never groups bits into values, never reads frames[].hex as
 * parameters, never computes the scrambler or a sync pattern, and never
 * turns frames into audio (tools/check-scope.py). Frames are picked by
 * criterion through lib/picks.js, never by index.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  NO_WEBGL_HINT,
  TEST_HOOK,
  createAudioPlayer,
  createPlot,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  frameHex,
  getTheme,
  hexBits,
  loadJSON,
  loadPCM,
  markEnhanced,
  onThemeChange,
  prefersReducedMotion,
  setupCanvas,
  supportsWebGL2,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { CUTOFF_BADGE, CUTOFF_HZ, CUTOFF_LABEL } from "./lib/cutoff.js";
import { harmonicCount as countHarmonics } from "./lib/harmonics.js";
import { PICKS } from "./lib/picks.js";
import { createViewSwitch } from "./lib/view-switch.js";

const SLUG = "frame-path";
const STEP_KEYS = /** @type {const} */ (["stage", "pick", "clip", "view"]);

/** @typedef {"lr-b" | "lj-b"} ClipId */
/** @typedef {1 | 2 | 3 | 4 | 5 | 6 | 7} Stage */
/** @typedef {"corner" | "front" | "top"} Preset */
/** @typedef {"vowel" | "fricative" | "silence" | "default"} PickName */

/** @type {Readonly<Record<ClipId, string>>} */
const CLIP_NAMES = Object.freeze({ "lr-b": "CQ, male", "lj-b": "CQ, female" });

const STAGES = /** @type {const} */ ([
  { n: 1, name: "Input", axis: "sample" },
  { n: 2, name: "Pitch", axis: "frequency" },
  { n: 3, name: "Voicing", axis: "band" },
  { n: 4, name: "Encoder", axis: "" },
  { n: 5, name: "The frame", axis: "bit" },
  { n: 6, name: "Decoded", axis: "frequency" },
  { n: 7, name: "On the air", axis: "72 voice bits, then 24 data bits" },
]);

const THRESHOLD = 0.55;
const SAMPLES = 160;
const CONTEXT = 40; // samples of context drawn either side in 2D
const SPAN_BEFORE = 0.2; // seconds of audio before the frame starts
const SPAN_AFTER = 0.22; // and after it (the frame's own 20 ms plus 200 ms)
const DB_FLOOR = -90;
const DB_TOP = -10;
/** The superframe: every 21st data slot is a sync slot (JARL spec). */
const SUPERFRAME = 21;
const ENCODER_LABEL = "AMBE-3000: internals not observable";
const ENCODER_SENTENCE = "The AMBE-3000 has no packet that reports its internal parameters.";
const ENCODER_LINES = ["The AMBE-3000 has no packet that", "reports its internal parameters."];
/** The cutoff line's label on the stage 2 panel, from lib/cutoff.js. */
export const CUTOFF_TEXT = `${CUTOFF_HZ / 1000} kHz`;

/**
 * The camera pose the walk-through drifts to during each step, by step
 * index: toward Front where a comb or a comparison lines up, toward Top
 * where the stack reads as a raster.
 * @type {readonly import("./lib/orbit.js").Pose[]}
 */
const TOUR_POSES = Object.freeze([
  { yaw: -46, pitch: 20 },
  { yaw: -12, pitch: 10 },
  { yaw: -52, pitch: 30 },
  { yaw: -18, pitch: 16 },
  { yaw: -22, pitch: 64 },
  { yaw: -12, pitch: 12 },
  { yaw: -12, pitch: 10 },
  { yaw: -24, pitch: 68 },
]);

/**
 * The 21 rows stage 7 draws around frame k, clamped to the clip, and the
 * next sync slot at or after k (frame index mod 21 = 0, the spec's rule
 * with the recording's first frame taken as a sync slot, an assumption).
 * `wait` is how many frames a receiver that tunes in at k sees before it
 * can lock, the sync frame included: 1 to 21, so 20 to 420 ms; the sync
 * frame itself is `next - k` frames on (0 to 20). `next` is
 * null when the recording ends first.
 * @param {number} k
 * @param {number} total frames in the clip
 * @returns {{start: number, end: number, next: number | null, wait: number | null}}
 */
export function superframe(k, total) {
  const start = Math.max(0, Math.min(k, total - SUPERFRAME));
  const end = Math.min(total - 1, start + SUPERFRAME - 1);
  const j = Math.ceil(k / SUPERFRAME) * SUPERFRAME;
  return j < total ? { start, end, next: j, wait: j - k + 1 } : { start, end, next: null, wait: null };
}

/**
 * How long the walk-through holds a step: long enough to read its text.
 * @param {string} text
 * @returns {number} ms
 */
export function holdFor(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(Math.min(22000, Math.max(6500, 2600 + 240 * words)));
}

/**
 * A step's text for the caption: the rendered step without its footnote
 * markers and in-page links.
 * @param {Element} item
 * @returns {string}
 */
export function captionText(item) {
  const copy = /** @type {Element} */ (item.cloneNode(true));
  const here = item.ownerDocument.location?.pathname;
  for (const node of copy.querySelectorAll("sup[id^='fnref'], a[href]")) {
    const href = node.getAttribute("href") ?? "";
    // A link within this page points at the page itself; one to another
    // chapter keeps its words.
    if (node.tagName === "SUP" || href.startsWith("#") || new URL(href, item.ownerDocument.baseURI).pathname === here) node.remove();
  }
  // A removed link can leave its sentence's stop after the one before it
  // ("public. ." becomes "public."), so a run of stops collapses too.
  return (copy.textContent ?? "").replace(/\s+/g, " ").replace(/\s+([.,:;])/g, "$1")
    .replace(/([.!?])\.+(?=\s|$)/g, "$1").trim();
}

/**
 * How far the next sync slot is from the selected frame, in words.
 * @param {number} n frames, 0 for the selected frame itself
 * @returns {string}
 */
export function framesOn(n) {
  return n === 0 ? "this one" : n === 1 ? "1 frame on" : `${n} frames on`;
}

/**
 * What the 3D part draws from (lib/view-switch.js passes it on). The 3D
 * part reads nothing itself: the bits come from bits(), which calls
 * hexBits() here.
 * @typedef {Object} PathState
 * @property {ClipId} clip
 * @property {number} frame
 * @property {Stage} stage
 * @property {Preset} preset
 * @property {FramesFile} frames
 * @property {SpectraFile} spectra
 * @property {Float32Array} pcm
 * @property {number} peak
 * @property {(j: number) => ArrayLike<number>} bits  one 0 or 1 per bit, 72
 * @property {(j: number) => number} level  the frame's input level, 0 to 1
 * @property {number} harmonics  L for the selected frame
 * @property {number} cutoffHz
 * @property {string} axis
 * @property {string} chip  the fact the highlight's chip states
 * @property {string} describe  the canvas's sentence
 * @property {{start: number, end: number, next: number | null, wait: number | null}} air
 * @property {() => import("./lib/orbit.js").PlotRect | null} plotRect  the
 *           2D plot's rectangle for the slice, in the frame (stages 1, 2,
 *           3 and 6)
 * @property {{id: number, to: import("./lib/orbit.js").Pose | null, ms: number, paused: boolean} | null} tour
 */

/**
 * Harmonics at or below the illustrative cutoff (lib/harmonics.js).
 * @param {number} f0 Hz; 0 means no pitch
 * @returns {number}
 */
const harmonicCount = (f0) => countHarmonics(f0, CUTOFF_HZ);

/**
 * @typedef {Object} ClipData
 * @property {FramesFile} frames
 * @property {SpectraFile} spectra
 * @property {Float32Array} pcm  the input WAV at 8 kHz
 * @property {number} peak       largest |sample| in the clip
 */

/** @param {number} n */
const thousands = (n) => n.toLocaleString("en-US");

/**
 * @param {Element} host
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const clipIds = /** @type {ClipId[]} */ (
    (host.getAttribute("data-clips") || "lr-b,lj-b").split(",").map((c) => c.trim()).filter((c) => c in CLIP_NAMES)
  );
  const fallbackCaption = host.querySelector(":scope > .anim-fallback figcaption");
  // The live caption is the fallback's, so the two cannot drift apart.
  const captionNodes = fallbackCaption ? [...fallbackCaption.cloneNode(true).childNodes] : [];
  const reduced = prefersReducedMotion();

  /** @type {Map<ClipId, Promise<ClipData>>} */
  const clips = new Map();
  /** @param {ClipId} id */
  const loadClip = (id) => {
    let pending = clips.get(id);
    if (!pending) {
      pending = Promise.all([
        loadJSON(`assets/data/${id}/frames.json`, { signal }),
        loadJSON(`assets/data/${id}/spectra.json`, { signal }),
        loadPCM(`assets/audio/${id}-original.wav`, { signal }),
      ]).then(([frames, spectra, pcm]) => {
        let peak = 0;
        for (const s of pcm) peak = Math.max(peak, Math.abs(s));
        return {
          frames: /** @type {FramesFile} */ (frames),
          spectra: /** @type {SpectraFile} */ (spectra),
          pcm,
          peak: peak || 1,
        };
      });
      pending.catch(() => clips.delete(id));
      clips.set(id, pending);
    }
    return pending;
  };

  const figure = buildFigure(clipIds, captionNodes, steps.length);
  host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const flat = $(frame, "canvas", HTMLCanvasElement);
  const readout = $(figure, '[data-ref="readout"]', HTMLOutputElement);
  const stageBadge = $(figure, '[data-ref="stage-badge"]', HTMLElement);
  const hexLine = $(figure, '[data-ref="hex"]', HTMLElement);
  const slider = $(figure, '[data-ref="frame"]', HTMLInputElement);
  const frameReadout = $(figure, '[data-ref="frame-readout"]', HTMLOutputElement);
  const legend = $(figure, ".anim-legend", HTMLUListElement);
  const view3d = $(figure, 'button[data-view="3d"]', HTMLButtonElement);
  const presetGroup = $(figure, '[data-ref="presets"]', HTMLElement);
  const webglHint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const motionHint = $(figure, '[data-ref="motion-hint"]', HTMLElement);
  const inputButton = $(figure, '[data-ref="hear-input"]', HTMLButtonElement);
  const chipButton = $(figure, '[data-ref="hear-chip"]', HTMLButtonElement);

  frame.dataset.state = "loading";

  /** Current state. */
  const state = {
    /** @type {ClipId} */ clip: clipIds[0] ?? "lr-b",
    frame: 0,
    /** @type {Stage} */ stage: 1,
    /** @type {Preset} */ preset: "corner",
  };

  // The reduced-motion hint must not promise a 3D view the browser cannot draw.
  if (!supportsWebGL2()) motionHint.textContent = "Opens flat because your system asks for reduced motion.";
  /** @type {ClipData | null} */
  let data = null;

  const probe = {
    /** @type {number[]} */ cells: [],
    /** @type {{x: number, y: number, w: number, h: number}[]} */ cellRects: [],
    /** @type {number[]} */ samples: [],
    spans: { input: { from: 0, until: 0 }, chip: { from: 0, until: 0 } },
    /** The cutoff label drawn on the 2D canvas, or "". */
    cutoff: "",
    /** Stage 7 in 2D: the rows drawn, and the selected row's box. */
    /** @type {{rows: number[], selected: {x: number, y: number, w: number, h: number} | null}} */
    air: { rows: [], selected: null },
  };

  /* ---------------------------------------------------------------- 2D -- */

  const canvas = setupCanvas(flat, { onResize: () => draw2d() });

  /** @param {number} width */
  const paddingFor = (width) => {
    const narrow = width < 520;
    return { top: 18, right: narrow ? 22 : 24, bottom: 46, left: narrow ? 44 : 52 };
  };

  const draw2d = () => {
    if (!data || flat.hidden) return;
    const theme = getTheme();
    const ctx = canvas.ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const record = data.frames.frames[state.frame];
    const padding = paddingFor(canvas.width);
    probe.cellRects = [];
    probe.cells = [];
    probe.cutoff = "";
    probe.air = { rows: [], selected: null };
    if (state.stage === 1) drawInput(ctx, theme, padding);
    else if (state.stage === 2) drawSpectrum(ctx, theme, padding, record, false);
    else if (state.stage === 3) drawVoicing(ctx, theme, padding, record);
    else if (state.stage === 4) drawEncoder(ctx, theme);
    else if (state.stage === 5) drawBits(ctx, theme, record);
    else if (state.stage === 6) drawSpectrum(ctx, theme, padding, record, true);
    else drawAir(ctx, theme);
  };

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} theme
   * @param {{top: number, right: number, bottom: number, left: number}} padding
   */
  const drawInput = (ctx, theme, padding) => {
    if (!data) return;
    const { pcm, peak } = data;
    const start = state.frame * SAMPLES;
    const plot = createPlot(canvas, {
      xDomain: [-CONTEXT, SAMPLES - 1 + CONTEXT],
      yDomain: [-1.05, 1.05],
      padding,
    });
    // The frame's own 20 ms, set off from the context either side.
    ctx.fillStyle = theme.css("--ambe-surface-1", theme.surface1);
    ctx.fillRect(plot.x(0), plot.area.top, plot.x(SAMPLES - 1) - plot.x(0), plot.area.height);
    drawGrid(ctx, plot, { xTicks: [0, 40, 80, 120, 159], yTicks: [-1, 0, 1] });
    drawAxes(ctx, plot, {
      xTicks: [0, 40, 80, 120, 159],
      yTicks: [-1, 0, 1],
      formatY: (v) => (v === 0 ? "0" : v > 0 ? "peak" : "-peak"),
      xLabel: "sample within the frame (8 kHz, 125 µs apart)",
    });
    /** @type {[number, number][]} */
    const before = [];
    /** @type {[number, number][]} */
    const inside = [];
    /** @type {[number, number][]} */
    const after = [];
    probe.samples = [];
    for (let n = -CONTEXT; n < SAMPLES + CONTEXT; n += 1) {
      const at = start + n;
      if (at < 0 || at >= pcm.length) continue;
      const point = /** @type {[number, number]} */ ([n, pcm[at] / peak]);
      if (n < 0) before.push(point);
      else if (n >= SAMPLES) after.push(point);
      else {
        inside.push(point);
        probe.samples.push(pcm[at]);
      }
    }
    if (before.length) before.push(inside[0]);
    if (after.length) after.unshift(inside[inside.length - 1]);
    ctx.save();
    plot.clip(ctx);
    drawPolyline(ctx, before, { plot, color: theme.muted, width: 1.25 });
    drawPolyline(ctx, after, { plot, color: theme.muted, width: 1.25 });
    drawPolyline(ctx, inside, { plot, color: theme.ink, width: 1.6 });
    ctx.restore();
    drawLabel(ctx, "this frame", plot.x(0) + 6, plot.area.top + 14, { color: theme.text3, size: 11 });
  };

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} theme
   * @param {{top: number, right: number, bottom: number, left: number}} padding
   * @param {FrameRecord} record
   * @param {boolean} decoded
   */
  const drawSpectrum = (ctx, theme, padding, record, decoded) => {
    if (!data) return;
    const { spectra } = data;
    const plot = createPlot(canvas, { xDomain: [0, 4000], yDomain: [DB_FLOOR, DB_TOP], padding });
    const xTicks = [0, 1000, 2000, 3000, 4000];
    const yTicks = [-90, -70, -50, -30, -10];
    drawGrid(ctx, plot, { xTicks, yTicks });
    drawAxes(ctx, plot, {
      xTicks,
      yTicks,
      formatX: (v) => (v === 0 ? "0" : `${v / 1000} kHz`),
      formatY: (v) => `${v}`,
      xLabel: "frequency",
      yLabel: canvas.width < 520 ? undefined : "dB",
    });
    /** @param {number[]} row */
    const line = (row) =>
      row.map((db, b) => /** @type {[number, number]} */ ([spectra.bin_centre_hz[b], Math.max(DB_FLOOR, db)]));
    ctx.save();
    plot.clip(ctx);
    if (decoded) {
      drawPolyline(ctx, line(spectra.original[state.frame]), { plot, color: theme.muted, width: 1.25, dash: [3, 3] });
      drawPolyline(ctx, line(spectra.decoded[state.frame]), { plot, color: theme.ink, width: 1.6 });
    } else {
      const f0 = record.derived.orig_f0_hz;
      const L = harmonicCount(f0);
      ctx.strokeStyle = theme.accentCool;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      for (let k = 1; k <= L; k += 1) {
        const x = Math.round(plot.x(k * f0)) + 0.5;
        ctx.moveTo(x, plot.area.top);
        ctx.lineTo(x, plot.area.bottom);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      drawPolyline(ctx, line(spectra.original[state.frame]), { plot, color: theme.ink, width: 1.6 });
      if (!L) {
        drawLabel(ctx, "no pitch found in the input", plot.area.left + plot.area.width / 2, plot.area.top + 22, {
          align: "center", color: theme.text3, size: 12, background: theme.plotBg,
        });
      }
    }
    ctx.restore();
    // The illustrative cutoff belongs to the pitch stage only, where its
    // badge is shown; on the decoded spectrum it would read as measured.
    if (decoded) return;
    const cx = Math.round(plot.x(CUTOFF_HZ)) + 0.5;
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, plot.area.top);
    ctx.lineTo(cx, plot.area.bottom);
    ctx.stroke();
    drawLabel(ctx, CUTOFF_TEXT, cx - 4, plot.area.top + 12, { align: "right", color: theme.text3, size: 11 });
    probe.cutoff = CUTOFF_TEXT;
  };

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} theme
   * @param {{top: number, right: number, bottom: number, left: number}} padding
   * @param {FrameRecord} record
   */
  const drawVoicing = (ctx, theme, padding, record) => {
    const plot = createPlot(canvas, { xDomain: [0, 8], yDomain: [0, 1], padding });
    const yTicks = [0, 0.25, THRESHOLD, 0.75, 1];
    drawGrid(ctx, plot, { xTicks: [], yTicks: [0, 0.25, 0.75, 1] });
    drawAxes(ctx, plot, {
      xTicks: [0, 2, 4, 6, 8],
      yTicks,
      formatX: (v) => (v === 0 ? "0" : `${v / 2} kHz`),
      formatY: (v) => v.toFixed(2).replace(/0$/, ""),
      xLabel: "band, 500 Hz each",
      yLabel: canvas.width < 520 ? undefined : "periodicity",
    });
    const strengths = record.derived.band_voicing;
    const voiced = theme.css("--ambe-voiced", theme.accentCool);
    const unvoiced = theme.css("--ambe-unvoiced", theme.accentWarm);
    strengths.forEach((v, b) => {
      const x0 = plot.x(b + 0.18);
      const x1 = plot.x(b + 0.82);
      const y = plot.y(Math.max(0, Math.min(1, v)));
      ctx.fillStyle = v >= THRESHOLD ? voiced : unvoiced;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x0, y, x1 - x0, plot.area.bottom - y);
      ctx.globalAlpha = 1;
    });
    const ty = Math.round(plot.y(THRESHOLD)) + 0.5;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.area.left, ty);
    ctx.lineTo(plot.area.right, ty);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} theme
   */
  const drawEncoder = (ctx, theme) => {
    const w = canvas.width;
    const h = canvas.height;
    const narrow = w < 520;
    const bw = Math.min(w * 0.5, 360);
    const bh = Math.min(h * 0.42, 150);
    const bx = (w - bw) / 2;
    const by = (h - bh) / 2 - h * 0.06;
    ctx.fillStyle = theme.surface2;
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(bx + 0.5, by + 0.5, bw, bh, 8);
    else ctx.rect(bx + 0.5, by + 0.5, bw, bh);
    ctx.fill();
    ctx.stroke();
    drawLabel(ctx, "AMBE-3000", w / 2, by + bh / 2 - 6, {
      align: "center", baseline: "middle", size: narrow ? 15 : 18, weight: 600, color: theme.ink,
    });
    drawLabel(ctx, "internals not observable", w / 2, by + bh / 2 + (narrow ? 14 : 18), {
      align: "center", baseline: "middle", size: narrow ? 11 : 13, color: theme.text3,
    });
    // In and out, with what crosses the boundary.
    const ay = by + bh / 2;
    const arrow = (/** @type {number} */ x0, /** @type {number} */ x1) => {
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x0, ay);
      ctx.lineTo(x1, ay);
      ctx.moveTo(x1 - 6, ay - 4);
      ctx.lineTo(x1, ay);
      ctx.lineTo(x1 - 6, ay + 4);
      ctx.stroke();
    };
    const gap = narrow ? 6 : 14;
    arrow(Math.max(8, bx - (narrow ? 34 : 90)), bx - gap);
    arrow(bx + bw + gap, Math.min(w - 8, bx + bw + (narrow ? 34 : 90)));
    if (!narrow) {
      drawLabel(ctx, "160 samples", bx - 52, ay - 12, { align: "center", color: theme.text3, size: 11 });
      drawLabel(ctx, "72 bits", bx + bw + 52, ay - 12, { align: "center", color: theme.text3, size: 11 });
    }
    const sentence = narrow ? ENCODER_LINES : [ENCODER_SENTENCE];
    sentence.forEach((line, k) => {
      drawLabel(ctx, line, w / 2, by + bh + (narrow ? 24 : 34) + k * 14, {
        align: "center", color: theme.text3, size: narrow ? 11 : 12,
      });
    });
  };

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} theme
   * @param {FrameRecord} record
   */
  const drawBits = (ctx, theme, record) => {
    const bits = hexBits(frameHex(record));
    const w = canvas.width;
    const h = canvas.height;
    const cols = 8;
    const rows = 9;
    const gap = w < 520 ? 3 : 4;
    const size = Math.floor(Math.min((w * 0.62 - gap * (cols - 1)) / cols, (h - 52 - gap * (rows - 1)) / rows));
    const gridW = cols * size + (cols - 1) * gap;
    const gridH = rows * size + (rows - 1) * gap;
    const left = Math.round((w - gridW) / 2);
    const top = Math.round((h - gridH) / 2) - 6;
    for (let n = 0; n < 72; n += 1) {
      const x = left + (n % cols) * (size + gap);
      const y = top + Math.floor(n / cols) * (size + gap);
      probe.cellRects.push({ x, y, w: size, h: size });
      probe.cells.push(bits[n]);
      if (bits[n]) {
        ctx.fillStyle = theme.ink;
        ctx.fillRect(x, y, size, size);
      } else {
        ctx.strokeStyle = theme.axis;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      }
    }
    drawLabel(ctx, "bit 0", left - 8, top + size / 2, { align: "right", baseline: "middle", color: theme.text3, size: 11 });
    drawLabel(ctx, "bit 71", left + gridW + 8, top + gridH - size / 2, {
      baseline: "middle", color: theme.text3, size: 11,
    });
    drawLabel(ctx, "filled = 1, outline = 0, in the order the chip sent them", w / 2, top + gridH + 22, {
      align: "center", color: theme.text3, size: 11,
    });
  };

  /**
   * Stage 7: the 21 rows around the selected frame, 96 cells each. Voice
   * cells are the chip's bits (filled = 1); data and sync slots are drawn
   * by class only, since their contents were not captured. The selected
   * row is outlined in the highlight with its ones in it, and the next
   * sync slot is marked.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("./anim-core.js").Theme} theme
   */
  const drawAir = (ctx, theme) => {
    if (!data) return;
    const total = data.frames.frames.length;
    const air = superframe(state.frame, total);
    const w = canvas.width;
    const h = canvas.height;
    const narrow = w < 520;
    const left = narrow ? 52 : 74;
    const right = narrow ? 14 : 96;
    const top = 26;
    const bottom = 30;
    const divider = narrow ? 4 : 8;
    const cell = (w - left - right - divider) / 96;
    const rowGap = 2;
    const rows = air.end - air.start + 1;
    const rowH = Math.max(3, Math.min(cell * 2.4, (h - top - bottom - rowGap * (rows - 1)) / rows));
    const highlight = theme.css("--ambe-highlight", theme.accentWarm);
    const sync = theme.css("--ambe-sync-slot", theme.accent);
    const slot = theme.css("--ambe-data-slot", theme.muted);
    const blockH = rows * rowH + (rows - 1) * rowGap;
    const y0 = top + Math.max(0, (h - top - bottom - blockH) / 2);
    const xOf = (/** @type {number} */ n) => left + n * cell + (n >= 72 ? divider : 0);
    drawLabel(ctx, "72 voice bits", xOf(36), y0 - 9, { align: "center", color: theme.text3, size: 11 });
    drawLabel(ctx, narrow ? "24 data" : "24 data bits", xOf(84), y0 - 9, { align: "center", color: theme.text3, size: 11 });
    for (let j = air.start; j <= air.end; j += 1) {
      const y = y0 + (j - air.start) * (rowH + rowGap);
      const me = j === state.frame;
      const bits = hexBits(frameHex(data.frames.frames[j]));
      probe.air.rows.push(j);
      for (let n = 0; n < 96; n += 1) {
        const x = xOf(n);
        const cw = Math.max(1, cell - (narrow ? 0.5 : 1));
        if (n < 72) {
          if (bits[n]) {
            ctx.fillStyle = me ? highlight : theme.ink;
            ctx.globalAlpha = me ? 1 : 0.78;
            ctx.fillRect(x, y, cw, rowH);
            ctx.globalAlpha = 1;
          } else if (me) {
            ctx.fillStyle = theme.css("--ambe-highlight-chip", theme.surface2);
            ctx.fillRect(x, y, cw, rowH);
          }
        } else {
          ctx.fillStyle = j % SUPERFRAME === 0 ? sync : slot;
          ctx.globalAlpha = j % SUPERFRAME === 0 ? 1 : 0.55;
          ctx.fillRect(x, y, cw, rowH);
          ctx.globalAlpha = 1;
        }
      }
      if (me) {
        const box = { x: left - 3, y: y - 3, w: xOf(95) + cell - left + 6, h: rowH + 6 };
        probe.air.selected = box;
        ctx.strokeStyle = highlight;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        drawLabel(ctx, narrow ? `${j}` : `frame ${j}`, left - 8, y + rowH / 2, {
          align: "right", baseline: "middle", color: highlight, size: 11, weight: 600,
        });
      }
      if (j === air.next && !me && !narrow) {
        drawLabel(ctx, "next sync", xOf(95) + cell + 8, y + rowH / 2, { baseline: "middle", color: sync, size: 11, weight: 600 });
      } else if (j % SUPERFRAME === 0 && !me && !narrow) {
        drawLabel(ctx, "sync slot", xOf(95) + cell + 8, y + rowH / 2, { baseline: "middle", color: sync, size: 11 });
      }
    }
    const foot = air.next === null ? "the recording ends before the next sync slot"
      : `rows 20 ms apart; tune in at frame ${state.frame}, lock at frame ${air.next}`;
    drawLabel(ctx, foot, w / 2, y0 + blockH + 20, { align: "center", color: theme.text3, size: 11 });
  };

  /* --------------------------------------------------------- 3D state --- */

  /** The 2D plot's rectangle for the selected slice, in the frame (front preset). */
  const plotRect = () => {
    const size = { width: frame.clientWidth, height: frame.clientHeight };
    if (!size.width || !size.height) return null;
    const padding = paddingFor(size.width);
    if (state.stage === 1) {
      const plot = createPlot(size, { xDomain: [-CONTEXT, SAMPLES - 1 + CONTEXT], yDomain: [-1.05, 1.05], padding });
      const v = 0.5 / 0.47; // the 3D slice's top, in units of the peak
      return { x: plot.x(0), y: plot.y(v), width: plot.x(SAMPLES - 1) - plot.x(0), height: plot.y(-v) - plot.y(v) };
    }
    if (state.stage === 2 || state.stage === 6 || state.stage === 3) {
      const plot = createPlot(size, { xDomain: [0, 1], yDomain: [0, 1], padding });
      return { x: plot.area.left, y: plot.area.top, width: plot.area.width, height: plot.area.height };
    }
    return null;
  };

  /** The fact the highlight's chip states, for the current stage. */
  const chipText = () => {
    if (!data) return "";
    const d = data.frames.frames[state.frame].derived;
    switch (state.stage) {
      case 1: return "this frame: 160 samples, 20 ms";
      case 2: {
        const L = harmonicCount(d.orig_f0_hz);
        return L ? `this frame: L = ${L} harmonics` : "this frame: no pitch found";
      }
      case 3: return `this frame: ${d.band_voicing.filter((v) => v >= THRESHOLD).length} of 8 bands periodic`;
      case 4: return "the encoder: 160 samples in, 72 bits out";
      case 5: return "this frame: 72 bits, 20 ms";
      case 6: return `this frame, decoded: ${Math.round(data.frames.clip.decoded_delay_ms)} ms behind the input`;
      default: return "this frame: 72 voice bits, 24 data bits";
    }
  };

  /** @type {PathState["tour"]} */
  let tourState = null;

  /** @returns {PathState | null} */
  const snapshot = () => {
    if (!data) return null;
    const { frames, spectra, pcm, peak } = data;
    const records = frames.frames;
    return {
      ...state,
      frames,
      spectra,
      pcm,
      peak,
      bits: (j) => hexBits(frameHex(records[j])),
      level: (j) => Math.min(1, Math.max(0, (records[j].derived.orig_rms_dbfs + 70) / 55)),
      harmonics: harmonicCount(records[state.frame].derived.orig_f0_hz),
      cutoffHz: CUTOFF_HZ,
      axis: STAGES[state.stage - 1].axis,
      chip: chipText(),
      describe: describe(),
      air: superframe(state.frame, records.length),
      plotRect,
      tour: tourState,
    };
  };

  const views = createViewSwitch({
    frame,
    flat,
    toggle: view3d,
    hint: webglHint,
    signal,
    state: () => snapshot(),
    load: () => import("./anim-frame-path-3d.js"),
    // The first view waits for the data: until then the switch holds off.
    start: "2d",
    id: SLUG,
    onView: (view) => {
      presetGroup.hidden = view !== "3d";
      syncPresets();
      legendItems();
      describeSoon();
      if (view !== "3d") draw2d();
    },
  });
  const push3d = () => {
    const snap = snapshot();
    if (snap) views.update(snap);
  };

  /* ------------------------------------------------------------ state --- */

  const syncPresets = () => {
    for (const button of presetGroup.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.preset === state.preset));
    }
  };

  const syncControls = () => {
    if (!data) return;
    const total = data.frames.frames.length;
    slider.max = String(total - 1);
    slider.value = String(state.frame);
    const record = data.frames.frames[state.frame];
    frameReadout.value = `frame ${state.frame} · ${record.t.toFixed(2)} s`;
    for (const button of figure.querySelectorAll("button[data-stage]")) {
      button.setAttribute("aria-pressed", String(Number(/** @type {HTMLElement} */ (button).dataset.stage) === state.stage));
    }
    for (const button of figure.querySelectorAll("button[data-clip]")) {
      button.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (button).dataset.clip === state.clip));
    }
  };

  /** The stage readout and its provenance badge. */
  const syncReadout = () => {
    if (!data) return;
    const record = data.frames.frames[state.frame];
    const d = record.derived;
    stageBadge.replaceChildren();
    delete stageBadge.dataset.measured;
    hexLine.hidden = true;
    hexLine.replaceChildren();
    let text = "";
    if (state.stage === 1) {
      text = `${SAMPLES} samples × 16 bits = ${thousands(SAMPLES * 16)} bits per 20 ms, 128 kbit/s`;
      stageBadge.append(badge("input"));
    } else if (state.stage === 2) {
      const L = harmonicCount(d.orig_f0_hz);
      text = L
        ? `f0 ${d.orig_f0_hz.toFixed(1)} Hz (input), L = ${L}, ${CUTOFF_LABEL}`
        : "no pitch found in the input: L is not defined for this frame";
      stageBadge.append(badge("derived-input"));
      if (L && CUTOFF_BADGE) stageBadge.append(" ", badge(CUTOFF_BADGE));
    } else if (state.stage === 3) {
      const count = d.band_voicing.filter((v) => v >= THRESHOLD).length;
      text = `${count} of 8 bands periodic at ${THRESHOLD} (decoded audio)`;
      stageBadge.append(badge("derived-decoded"));
    } else if (state.stage === 4) {
      text = ENCODER_LABEL;
    } else if (state.stage === 5) {
      text = "72 bits: 2400 bit/s voice + 1200 bit/s FEC = 3600 bit/s. On the air, 72 + 24 data bits = " +
        "96 bits per 20 ms = 4800 bit/s. How the voice bits divide between pitch, voicing and amplitudes " +
        "in D-STAR is not public.";
      stageBadge.dataset.measured = "hex";
      stageBadge.append(badge("measured"));
      const code = document.createElement("code");
      code.textContent = frameHex(record);
      hexLine.append("hex ", code);
      hexLine.hidden = false;
    } else if (state.stage === 6) {
      const clip = data.frames.clip;
      text = `decoded audio lags the input by ${clip.decoded_delay_ms.toFixed(1)} ms ` +
        `(correlation ${clip.decoded_delay_correlation.toFixed(3)})`;
      stageBadge.append(badge("derived-decoded"));
    } else {
      const air = superframe(state.frame, data.frames.frames.length);
      text = air.next === null || air.wait === null
        ? `Tune in at frame ${state.frame}: the recording ends before the next sync slot.`
        : `Tune in at frame ${state.frame}: the next sync slot is frame ${air.next}, ` +
          `${framesOn(air.next - state.frame)}, so a receiver waits ${20 * air.wait} ms.`;
      stageBadge.dataset.measured = "hex";
      stageBadge.append(badge("measured"), " ", badge("illustrative"));
    }
    readout.value = text;
    stageBadge.hidden = !stageBadge.childNodes.length;
  };

  /** What each stage draws, in the legend; 3D adds the depth. */
  const legendItems = () => {
    const deep = views.view() === "3d";
    /** @param {string} what */
    const ink = (what) => /** @type {[string, string]} */ ([deep ? "is-highlight" : "is-ink", deep ? `${what}, this frame (thick, outlined)` : what]);
    /** @type {[string, string][]} */
    const items = [];
    if (state.stage === 1) items.push(ink("input samples"));
    if (state.stage === 2) items.push(ink("input spectrum"), ["is-comb", "comb at k × f0, k up to L"]);
    if (state.stage === 3) {
      if (deep) items.push(["is-highlight", "this frame (outlined)"]);
      items.push(["is-voiced", "periodic, at or above 0.55"], ["is-unvoiced", "not periodic"],
        ["is-threshold", "threshold 0.55"]);
    }
    if (state.stage === 4 && deep) items.push(["is-highlight", "the encoder (outlined)"]);
    if (state.stage === 5) {
      items.push(deep ? ["is-highlight", "bit = 1, this frame (tall)"] : ["is-one", "bit = 1"], ["is-zero", "bit = 0"]);
    }
    if (state.stage === 6) items.push(ink("decoded spectrum"), ["is-ghost", "input spectrum"]);
    if (state.stage === 7) {
      items.push(["is-highlight", "this frame (outlined)"], ["is-one", "voice bit = 1"],
        ["is-data", "data slot: scrambled on the air, not captured"], ["is-sync", "sync slot, every 21st"]);
    }
    if (deep && state.stage !== 7) {
      items.push([state.stage === 3 ? "is-neighbour-bars" : "is-neighbour",
        state.stage === 3 ? "neighbours, 20 ms apart" : "neighbours, 20 ms apart, coloured by level"]);
    }
    legend.replaceChildren(...items.map(([kind, text]) => {
      const li = document.createElement("li");
      li.className = "anim-legend__item";
      const swatch = document.createElement("i");
      swatch.className = `anim-legend__swatch frame-path__swatch frame-path__swatch--${kind.slice(3)}`;
      li.append(swatch, text);
      return li;
    }));
  };

  /** Players around the selected frame: ±200 ms of input, and the chip's
   * output over the same span shifted by the decoded delay. */
  /** @type {import("./anim-core.js").AudioPlayer[]} */
  let players = [];
  let playerKey = "";
  const syncPlayers = () => {
    if (!data) return;
    const key = `${state.clip}:${state.frame}`;
    if (key === playerKey) return;
    playerKey = key;
    for (const player of players) player.destroy();
    const t = (state.frame * data.frames.clip.frame_ms) / 1000;
    const from = Math.max(0, t - SPAN_BEFORE);
    const until = t + SPAN_AFTER;
    const delay = data.frames.clip.decoded_delay_ms / 1000;
    probe.spans = { input: { from, until }, chip: { from: from + delay, until: until + delay } };
    players = [
      createAudioPlayer({
        src: `assets/audio/${state.clip}-original.wav`, button: inputButton, from, until,
        playLabel: "Hear the input", stopLabel: "Stop", onFrame: () => {},
      }),
      createAudioPlayer({
        src: `assets/audio/${state.clip}-ambe.wav`, button: chipButton, from: from + delay, until: until + delay,
        playLabel: "Hear the chip's output", stopLabel: "Stop", onFrame: () => {},
      }),
    ];
  };

  /** One sentence for the canvas, from state. */
  const describe = () => {
    if (!data) return "Frame path figure, loading.";
    const record = data.frames.frames[state.frame];
    const d = record.derived;
    const total = data.frames.frames.length;
    const where = `frame ${state.frame} of ${total} at ${record.t.toFixed(2)} s`;
    const deep = views.view() !== "2d";
    const depth = deep ? ", the outlined slice, with the 8 frames either side behind and in front" : "";
    const L = harmonicCount(d.orig_f0_hz);
    const head = `Stage ${state.stage} of 7, ${STAGES[state.stage - 1].name.toLowerCase()}: `;
    switch (state.stage) {
      case 1:
        return `${head}the 160 input samples of ${where}${depth}.`;
      case 2:
        return L
          ? `${head}the input spectrum of ${where}${depth}, with a comb at ${L} harmonics of ${d.orig_f0_hz.toFixed(1)} Hz.`
          : `${head}the input spectrum of ${where}${depth}. No pitch was found in the input.`;
      case 3:
        return `${head}${d.band_voicing.filter((v) => v >= THRESHOLD).length} of 8 bands at or above 0.55 ` +
          `in the decoded audio for ${where}${depth}.`;
      case 4:
        return `${head}${ENCODER_LABEL}, for ${where}${depth}.`;
      case 5:
        return `${head}72 measured bits for ${where}${depth}. hex ${frameHex(record)}.`;
      case 6:
        return `${head}the decoded spectrum over the input spectrum for ${where}${depth}.`;
      default: {
        const air = superframe(state.frame, total);
        const lock = air.next === null ? "The recording ends before the next sync slot."
          : `The next sync slot is frame ${air.next}, ${air.next === state.frame ? "this one" : `${20 * (air.next - state.frame)} ms on`}.`;
        return `${head}${where} as one 96-bit row, 72 voice bits and a 24-bit data slot, ` +
          `in the ${air.end - air.start + 1} rows from frame ${air.start}. ${lock}`;
      }
    }
  };
  let describeTimer = 0;
  const describeSoon = () => {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      const text = describe();
      flat.setAttribute("aria-label", text);
      frame.querySelector("canvas.anim-figure__canvas--3d")?.setAttribute("aria-label", text);
    }, 250);
  };

  /** Redraw everything that shows state. */
  const render = () => {
    syncControls();
    syncReadout();
    legendItems();
    syncPlayers();
    describeSoon();
    draw2d();
    push3d();
  };

  /**
   * Move to another frame.
   * @param {number} next
   */
  const goToFrame = (next) => {
    if (!data) return;
    const total = data.frames.frames.length;
    state.frame = Math.max(0, Math.min(total - 1, next));
    render();
  };

  /** @param {ClipId} id */
  const setClip = async (id) => {
    const loaded = await loadClip(id);
    if (signal.aborted) return false;
    state.clip = id;
    data = loaded;
    return true;
  };

  /** @param {PickName} name */
  const pickFrame = (name) => (data ? PICKS[name](data.frames.frames)?.i ?? 0 : 0);

  /* --------------------------------------------------------- controls --- */

  for (const button of figure.querySelectorAll("button[data-stage]")) {
    button.addEventListener("click", () => {
      state.stage = /** @type {Stage} */ (Number(/** @type {HTMLElement} */ (button).dataset.stage));
      render();
    }, { signal });
  }
  slider.addEventListener("input", () => goToFrame(Number(slider.value)), { signal });
  for (const button of figure.querySelectorAll("button[data-pick]")) {
    button.addEventListener("click", () => {
      const name = /** @type {PickName} */ (/** @type {HTMLElement} */ (button).dataset.pick);
      goToFrame(pickFrame(name));
    }, { signal });
  }
  for (const button of figure.querySelectorAll("button[data-clip]")) {
    button.addEventListener("click", async () => {
      const id = /** @type {ClipId} */ (/** @type {HTMLElement} */ (button).dataset.clip);
      if (id === state.clip) return;
      const previous = data?.frames.frames[state.frame].t ?? 0;
      if (!(await setClip(id)) || !data) return;
      // Keep the same moment in the sentence, as near as the new clip allows.
      state.frame = Math.min(data.frames.frames.length - 1, Math.round(previous / 0.02));
      render();
    }, { signal });
  }
  for (const button of presetGroup.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.preset = /** @type {Preset} */ (button.dataset.preset);
      syncPresets();
      views.preset(state.preset);
    }, { signal });
  }
  const stopTheme = onThemeChange(() => draw2d());

  /* ----------------------------------------------------- walk-through --- */

  const tourBar = figure.querySelector('[data-ref="tour"]');
  const playButton = tourBar ? $(tourBar, '[data-ref="play"]', HTMLButtonElement) : null;
  const caption = figure.querySelector('[data-ref="caption"]');
  const pips = tourBar ? [...tourBar.querySelectorAll("button[data-tour-step]")] : [];
  /** @type {ReturnType<typeof createStepper> | null} */
  let stepper = null;
  const tour = {
    playing: false,
    /** The walk-through has started and not been closed. */
    active: false,
    index: 0,
    id: 0,
    timer: 0,
    began: 0,
    hold: 0,
    left: 0,
    ended: false,
  };
  /** @param {string} label */
  const playLabel = (label) => {
    if (playButton) playButton.textContent = label;
  };
  const syncPips = () => {
    pips.forEach((pip, i) => {
      if (i === tour.index && tour.active) pip.setAttribute("aria-current", "step");
      else pip.removeAttribute("aria-current");
      pip.classList.toggle("is-done", tour.active && i < tour.index);
      const fill = /** @type {HTMLElement | null} */ (pip.querySelector("i"));
      if (!fill) return;
      fill.style.transition = "none";
      fill.style.transform = `scaleX(${tour.active && i < tour.index ? 1 : 0})`;
    });
  };
  /** The current pip fills over what is left of its hold. */
  const fillPip = () => {
    const fill = /** @type {HTMLElement | null} */ (pips[tour.index]?.querySelector("i") ?? null);
    if (!fill) return;
    const done = tour.hold ? 1 - tour.left / tour.hold : 0;
    fill.style.transition = "none";
    fill.style.transform = `scaleX(${done})`;
    if (!tour.playing || reduced) return;
    void fill.offsetWidth;
    fill.style.transition = `transform ${tour.left}ms linear`;
    fill.style.transform = "scaleX(1)";
  };
  /** @param {boolean} paused */
  const tellTour = (paused) => {
    tourState = tourState ? { ...tourState, paused } : null;
    push3d();
  };

  /** @param {number} index */
  const startStep = async (index) => {
    if (!stepper) return;
    clearTimeout(tour.timer);
    tour.index = index;
    tour.active = true;
    tour.ended = false;
    figure.dataset.tour = tour.playing ? "playing" : "paused";
    stepper.go(index);
    await applying;
    if (signal.aborted || tour.index !== index) return;
    const text = captionText(steps[index].item);
    if (caption) {
      caption.textContent = text;
      /** @type {HTMLElement} */ (caption).hidden = false;
    }
    tour.hold = holdFor(text);
    tour.left = tour.hold;
    tour.id += 1;
    tourState = { id: tour.id, to: reduced ? null : TOUR_POSES[index] ?? null, ms: tour.hold, paused: !tour.playing };
    push3d();
    syncPips();
    if (tour.playing) {
      tour.began = performance.now();
      tour.timer = window.setTimeout(advance, tour.hold);
    }
    fillPip();
  };
  const advance = () => {
    if (!tour.playing) return;
    if (tour.index < steps.length - 1) {
      void startStep(tour.index + 1);
      return;
    }
    tour.playing = false;
    tour.ended = true;
    tour.left = 0;
    figure.dataset.tour = "ended";
    playLabel("Play again");
    tellTour(true);
    syncPips();
    pips.forEach((pip) => pip.classList.add("is-done"));
  };
  const pause = () => {
    if (!tour.playing) return;
    tour.playing = false;
    clearTimeout(tour.timer);
    tour.left = Math.max(0, tour.left - (performance.now() - tour.began));
    figure.dataset.tour = "paused";
    playLabel("Resume");
    tellTour(true);
    fillPip();
  };
  const play = () => {
    if (!stepper) return;
    tour.playing = true;
    playLabel("Pause");
    // A new walk-through starts at step 1: its bar shows only in Free play,
    // where the stepper sits on the last step.
    if (tour.ended || !tour.active) {
      void startStep(0);
      return;
    }
    if (stepper.index !== tour.index) {
      void startStep(stepper.index);
      return;
    }
    figure.dataset.tour = "playing";
    tour.began = performance.now();
    tour.timer = window.setTimeout(advance, tour.left);
    tellTour(false);
    fillPip();
  };
  playButton?.addEventListener("click", () => (tour.playing ? pause() : play()), { signal });
  pips.forEach((pip, i) => pip.addEventListener("click", () => void startStep(i), { signal }));
  // Any press on the figure outside the walk-through's own bar is the
  // reader taking over: the walk-through pauses where it is.
  for (const type of ["pointerdown", "keydown"]) {
    figure.addEventListener(type, (event) => {
      if (!tour.playing || (tourBar && tourBar.contains(/** @type {Node} */ (event.target)))) return;
      if (type === "keydown" && !(event.target instanceof Element && event.target.closest(".anim-figure__frame"))) return;
      pause();
    }, { signal, capture: true });
  }
  // Out of view, it waits.
  const away = new IntersectionObserver((entries) => {
    if (entries.some((e) => !e.isIntersecting)) pause();
  }, { threshold: 0.25 });
  away.observe(frame);

  // Everything above holds observers or listeners, and the players come with
  // the first render. One cleanup releases all of it, and every exit below
  // returns it or runs it, the aborted ones included: mount() runs a cleanup
  // that arrives after its signal aborted.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(describeTimer);
    clearTimeout(tour.timer);
    away.disconnect();
    views.show2D();
    stopTheme();
    for (const player of players) player.destroy();
    players = [];
    canvas.destroy();
    if (TEST_HOOK && TEST_HOOK.figures[SLUG] === hookEntry) delete TEST_HOOK.figures[SLUG];
  };
  /** @type {object | null} */
  let hookEntry = null;

  /** @type {Promise<unknown>} */
  let applying = Promise.resolve();
  let started = false;
  /**
   * Apply one step's state. Steps may switch clips, which loads data, so
   * applications queue rather than race.
   * @param {Record<string, string>} step
   */
  const apply = (step) => {
    applying = applying.then(async () => {
      if (signal.aborted) return;
      const clip = /** @type {ClipId | undefined} */ (step.clip);
      if (clip && clip in CLIP_NAMES && clip !== state.clip && !(await setClip(clip))) return;
      if (step.stage) state.stage = /** @type {Stage} */ (Math.max(1, Math.min(7, Number(step.stage))));
      if (step.pick && step.pick in PICKS) state.frame = pickFrame(/** @type {PickName} */ (step.pick));
      render();
      // Once the walk-through has run, its caption follows the step on show.
      if (tour.active && stepper && caption) caption.textContent = captionText(steps[stepper.index].item);
      // A step that asks for 3D brings it back once the figure has opened;
      // under reduced motion or without WebGL 2 the step reads in 2D.
      if (started && step.view === "3d" && !reduced && views.available() && views.view() === "2d") void views.show3D();
      // A step on a flat graph shows it flat.
      if (step.view === "2d") views.show2D();
    });
  };

  /* ------------------------------------------------------------ start --- */

  try {
    if (!(await setClip(state.clip))) return cleanup;
    delete frame.dataset.state;
    state.frame = pickFrame("default");
    if (steps.length) {
      stepper = createStepper(figure, steps, (step) => apply(step), { signal });
      await applying;
    } else {
      render();
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  if (signal.aborted) return cleanup;
  started = true;
  // The opening rule (O1), now the data is in: 3D with its animation when
  // WebGL 2 and motion allow, once the frame is near; else 2D.
  // A first step that asks for 2D keeps the figure flat.
  const opening = steps[stepper?.index ?? 0]?.state.view;
  if (views.available() && !reduced && opening !== "2d") void views.show3D();

  if (TEST_HOOK) {
    hookEntry = {
      get state() {
        return { ...state, view: views.view() };
      },
      get readout() {
        return readout.value;
      },
      get cells() {
        return probe.cells;
      },
      get cellRects() {
        return probe.cellRects;
      },
      get samples() {
        return probe.samples;
      },
      get spans() {
        return probe.spans;
      },
      get cutoff() {
        return probe.cutoff;
      },
      get air() {
        return probe.air;
      },
      get tour() {
        return { playing: tour.playing, active: tour.active, index: tour.index, hold: tour.hold, ended: tour.ended,
          caption: caption?.textContent ?? "" };
      },
      get settled() {
        return applying;
      },
      get plotRect() {
        return plotRect();
      },
    };
    TEST_HOOK.figures[SLUG] = hookEntry;
  }

  return cleanup;
}

/**
 * The live figure, appended after the fallback.
 * @param {ClipId[]} clipIds
 * @param {Node[]} captionNodes
 * @param {number} walk  the host's steps: with any, the walk-through has a bar
 * @returns {HTMLElement}
 */
function buildFigure(clipIds, captionNodes, walk) {
  const figure = document.createElement("figure");
  figure.className = "anim-figure frame-path";
  const stages = STAGES.map((s) =>
    `<button class="anim-btn" type="button" data-stage="${s.n}" aria-pressed="false">${s.n} ${s.name}</button>`
  ).join("");
  const clips = clipIds.map((id) =>
    `<button class="anim-btn" type="button" data-clip="${id}" aria-pressed="false">${CLIP_NAMES[id]}</button>`
  ).join("");
  const pips = walk ? Array.from({ length: walk }, (_, i) =>
    `<button class="frame-path__pip" type="button" data-tour-step="${i}" aria-label="Walk-through step ${i + 1}"><i></i></button>`
  ).join("") : "";
  figure.innerHTML = `
    <div class="anim-figure__head">
      <p class="anim-figure__title">Life of a 20 ms D-STAR voice frame from audio to RF</p>
      <p class="anim-figure__subtitle">Text-to-speech input through a DVSI AMBE-3000</p>
    </div>
    <div class="anim-toggle-group frame-path__stages" role="group" aria-label="Stage">${stages}</div>
    <div class="anim-figure__frame frame-path__frame">
      <canvas class="anim-figure__canvas" role="img" aria-label="Frame path figure, loading."></canvas>
    </div>
    ${walk ? `<div class="frame-path__tour" data-ref="tour">
      <button class="anim-btn frame-path__play" type="button" data-ref="play">Play the walk-through</button>
      <div class="frame-path__pips" role="group" aria-label="Walk-through steps">${pips}</div>
    </div>
    <p class="frame-path__caption" data-ref="caption" aria-hidden="true" hidden></p>` : ""}
    <div class="frame-path__readout">
      <span class="frame-path__badge" data-ref="stage-badge"></span>
      <output class="frame-path__text" aria-live="polite" data-ref="readout"></output>
      <span class="frame-path__hex" data-ref="hex" hidden></span>
    </div>
    <div class="anim-figure__step"></div>
    <ul class="anim-legend"></ul>
    <div class="anim-controls">
      <label class="anim-field">
        <span class="anim-field__label">Frame</span>
        <input class="anim-range" type="range" min="0" max="0" step="1" value="0" data-ref="frame"
               aria-label="Frame">
      </label>
      <output class="anim-readout anim-readout--wide" data-ref="frame-readout">frame 0</output>
      <div class="anim-toggle-group" role="group" aria-label="Pick a frame">
        <button class="anim-btn" type="button" data-pick="vowel">Vowel</button>
        <button class="anim-btn" type="button" data-pick="fricative">Fricative</button>
        <button class="anim-btn" type="button" data-pick="silence">Silence</button>
      </div>
      <div class="anim-toggle-group" role="group" aria-label="Recording">${clips}</div>
      <div class="anim-toggle-group" role="group" aria-label="View">
        <button class="anim-btn" type="button" data-view="3d" aria-pressed="false">3D</button>
      </div>
      <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="presets" hidden>
        <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
        <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
        <button class="anim-btn" type="button" data-preset="top" aria-pressed="false">Top</button>
      </div>
      <div class="anim-controls__group frame-path__players">
        <span class="frame-path__player">
          <button class="anim-btn anim-btn--play" type="button" data-kind="audio" data-ref="hear-input"
                  aria-pressed="false">Hear the input</button>
          <span data-ref="input-badge"></span>
        </span>
        <span class="frame-path__player" data-measured="decoded-audio">
          <button class="anim-btn anim-btn--play" type="button" data-kind="audio" data-ref="hear-chip"
                  aria-pressed="false">Hear the chip's output</button>
          <span data-ref="chip-badge"></span>
        </span>
      </div>
    </div>
    <p class="anim-figure__hint" data-ref="motion-hint">Opens flat because your system asks for reduced
      motion. The 3D view still works, without camera moves.</p>
    <p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
    <figcaption class="anim-figure__caption"></figcaption>`;
  $(figure, '[data-ref="input-badge"]', HTMLElement).replaceWith(badge("input"));
  $(figure, '[data-ref="chip-badge"]', HTMLElement).replaceWith(badge("measured"));
  $(figure, ".anim-figure__caption", HTMLElement).append(...captionNodes);
  return figure;
}
