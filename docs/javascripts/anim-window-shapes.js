// @ts-check
/* ===========================================================================
 * anim-window-shapes.js: three windows over one block of a tone (ch03).
 * ---------------------------------------------------------------------------
 * SLUG          window-shapes    <div data-anim="window-shapes"></div>
 *
 * DATA READ     none. One cosine at 6.5 cycles in a 160-sample block (phase
 *               0) and the windows come from lib/window-shapes.js. Nothing
 *               here is measured and nothing here is specific to AMBE.
 *
 * CONTROLS      the window, Rectangular, Hann or Hamming; the 3D control
 *               and, in 3D, the Camera presets and the Zoom group.
 *
 * WHAT IT DRAWS The frame, 2D: the block before windowing (dashed), the
 *               window over it (dashed, and mirrored below), and the
 *               windowed block w(n) x(n) (thick), with a short stretch past
 *               the end where the next copy starts and the step at that
 *               joint, the step the leakage figure below is about.
 *               The frame, 3D (anim-window-shapes-3d.js, loaded only when 3D
 *               is wanted): the same block windowed by every member of one
 *               family, w(n) = a - (1 - a) cos(2 pi n / N), laid out in
 *               depth by the window's value at the block's ends, e = 2a - 1:
 *               1.00 at the front is the rectangular window, 0.08 is
 *               Hamming and 0.00 at the back is Hann, spaced by the
 *               square root of e so that Hamming and Hann sit apart.
 *               Seen from the front with the family hidden, it is the 2D
 *               plot.
 *
 * WHY THAT DEPTH The end value is the one number the three named windows
 *               differ by in this family, and it is the number the joint
 *               depends on: the step there is 2e. Going back, the block's
 *               ends shrink to nothing while its middle keeps its size.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  $,
  clearCanvas,
  createPlot,
  drawAxes,
  drawGrid,
  drawLabel,
  getTheme,
  markEnhanced,
  NO_WEBGL_HINT,
  onThemeChange,
  setupCanvas,
} from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import {
  N,
  WINDOWS,
  WINDOW_NAMES,
  curve,
  energyKept,
  jointStep,
  named,
  toneAt,
  windowAt,
  windowedAt,
} from "./lib/window-shapes.js";
import { createViewSwitch } from "./lib/view-switch.js";

/** @typedef {import("./lib/window-shapes.js").WindowName} WindowName */

/** The plot's sample range: the block, and the first samples of the next copy. */
export const X_RANGE = /** @type {[number, number]} */ ([0, 178]);
/** The plot's value range. */
export const Y_RANGE = /** @type {[number, number]} */ ([-1.3, 1.3]);

const STEP_KEYS = /** @type {const} */ (["window", "view", "preset"]);

/** The Camera presets of the 3D view, in button order. */
export const PRESET_NAMES = /** @type {const} */ (["front", "corner"]);
/** @typedef {typeof PRESET_NAMES[number]} PresetName */

/**
 * @typedef {Object} WindowState
 * @property {WindowName} window
 * @property {number} end  the window's value at the block's ends
 * @property {PresetName} preset  the 3D view's camera preset
 */

/**
 * The frame's one plot, for a frame of W x H CSS px. The 3D view's Front
 * preset puts the block on `plot.area`.
 * @param {number} W
 * @param {number} H
 */
export function layout(W, H) {
  const narrow = W < 560;
  const plot = createPlot(
    { width: W, height: H },
    {
      xDomain: X_RANGE,
      yDomain: Y_RANGE,
      // The bottom clears the 56 px the 3D view's labels keep free
      // (lib/labels.js), so Front shows the same axis as the 2D plot.
      padding: narrow
        ? { top: 14, right: 10, bottom: 84, left: 34 }
        : { top: 16, right: 18, bottom: 88, left: 44 },
    }
  );
  return { W, H, narrow, plot };
}

/** @param {number} v @param {number} [places=2] */
export const fmt = (v, places = 2) => {
  const s = v.toFixed(places);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace("-", "−");
};

/**
 * The chip's fact, and the 2D plot's line under the axis: the window's
 * value at the ends and in the middle.
 * @param {number} end
 */
export function chipText(end) {
  const key = named(end);
  return `${key ? `${WINDOWS[key].title}: ` : ""}ends ${fmt(windowAt(end, 0))}, middle ${fmt(windowAt(end, N / 2))}`;
}

/** The joint's words, for the plot and the strip of readouts. @param {number} end */
export function jointText(end) {
  const step = jointStep(end);
  return step < 0.005 ? "no step at the joint" : `a step of ${fmt(step)} at the joint`;
}

/* --- markup ------------------------------------------------------------- */

const CAPTION = `
  One cosine at 6.5 cycles in a 160-sample block (20 ms at 8 kHz), the
  tone the leakage figure below cuts half a bin off, multiplied by three
  windows. The rectangular window weights every sample 1. Hann rises from
  0 at the ends to 1 in the middle; Hamming is the same raised cosine,
  shallower, from 0.08 at the ends to 1 in the middle. In 3D, depth is
  the window's value at the ends on a square root scale, which keeps
  Hamming and Hann apart. The window shapes are the textbook ones
  (Harris, "On the use of windows for harmonic analysis with the discrete
  Fourier transform", Proc. IEEE, 1978).
  <span class="anim-figure__source">Computed in your browser from a
  synthetic tone. Nothing here is measured.</span>`;

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">The rectangular, Hann and Hamming windows</p>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 16 / 9">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="One 160-sample block of a tone, a window over it, and the block multiplied by the window."></canvas>
</div>

<div class="anim-figure__step"></div>

<ul class="anim-legend" data-ref="legend-2d">
  <li class="anim-legend__item"><i class="anim-ws__key anim-ws__key--this"></i>the windowed block, w(n) x(n) (thick)</li>
  <li class="anim-legend__item"><i class="anim-ws__key anim-ws__key--window"></i>the window w(n), and its mirror (dashed)</li>
  <li class="anim-legend__item"><i class="anim-ws__key anim-ws__key--tone"></i>the block before windowing (dashed)</li>
  <li class="anim-legend__item"><i class="anim-ws__key anim-ws__key--joint"></i>the step where the next copy starts (thick)</li>
</ul>
<ul class="anim-legend" data-ref="legend-3d" hidden>
  <li class="anim-legend__item"><i class="anim-ws__key anim-ws__key--this"></i>this window's block (thick, outlined)</li>
  <li class="anim-legend__item"><i class="anim-ws__key anim-ws__key--ramp"></i>the block under every window between, by end value, 0 (dark) to 1 (bright)</li>
  <li class="anim-legend__item"><i class="anim-ws__key anim-ws__key--window"></i>this window, and its mirror (dashed)</li>
  <li class="anim-legend__item"><i class="anim-ws__key anim-ws__key--rail"></i>the blocks' two ends, across the windows (thin)</li>
</ul>

<div class="anim-controls">
  <div class="anim-toggle-group" role="group" aria-label="Window" data-ref="window">
    <button class="anim-btn" type="button" data-window="rect" aria-pressed="true">Rectangular</button>
    <button class="anim-btn" type="button" data-window="hann" aria-pressed="false">Hann</button>
    <button class="anim-btn" type="button" data-window="hamming" aria-pressed="false">Hamming</button>
  </div>
  <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
  <div class="anim-toggle-group" role="group" aria-label="Camera" data-ref="camera" hidden>
    <button class="anim-btn" type="button" data-preset="front" aria-pressed="false">Front</button>
    <button class="anim-btn" type="button" data-preset="corner" aria-pressed="true">Corner</button>
  </div>
</div>
<p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>

<div class="anim-forms" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">window at the ends</span>
    <code data-role="r-ends"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">window in the middle</span>
    <code data-role="r-middle"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">step at the joint</span>
    <code data-role="r-step"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">energy kept</span>
    <code data-role="r-energy"></code></p>
</div>

<figcaption class="anim-figure__caption"></figcaption>
`;

/* --- drawing (2D) --------------------------------------------------------- */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof layout>["plot"]} plot
 * @param {[number, number][]} points
 */
function trace(ctx, plot, points) {
  ctx.beginPath();
  points.forEach(([n, v], i) => (i ? ctx.lineTo(plot.x(n), plot.y(v)) : ctx.moveTo(plot.x(n), plot.y(v))));
  ctx.stroke();
}

/**
 * The block, the window and the windowed block, the next copy's start and
 * the step at the joint.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof layout>} geo
 * @param {WindowState} state
 */
function drawBlock(ctx, geo, state) {
  const th = getTheme();
  const { plot, narrow } = geo;
  const { area } = plot;
  const end = state.end;
  // The next copy, on a faint band.
  ctx.fillStyle = th.surface2;
  ctx.fillRect(plot.x(N), area.top, area.right - plot.x(N), area.height);
  drawGrid(ctx, plot, { xTicks: [40, 80, 120, N], yTicks: [-1, 0, 1] });
  drawAxes(ctx, plot, {
    xTicks: narrow ? [0, 80, N] : [0, 40, 80, 120, N],
    yTicks: [-1, 0, 1],
    formatX: (v) => String(v),
    formatY: (v) => fmt(v, 0),
    xLabel: narrow ? "sample (160 = 20 ms)" : "sample n (160 samples = 20 ms)",
  });

  ctx.save();
  plot.clip(ctx);
  // The block before windowing.
  ctx.strokeStyle = th.muted;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  trace(ctx, plot, curve(toneAt));
  // The window and its mirror.
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 1.75;
  ctx.setLineDash([6, 4]);
  trace(ctx, plot, curve((n) => windowAt(end, n)));
  ctx.lineWidth = 1.2;
  trace(ctx, plot, curve((n) => -windowAt(end, n)));
  ctx.setLineDash([]);
  // The next copy's first samples.
  ctx.strokeStyle = th.muted;
  ctx.lineWidth = 1.6;
  trace(ctx, plot, curve((n) => windowedAt(end, n - N), N, X_RANGE[1]));
  // The windowed block.
  ctx.strokeStyle = th.css("--ambe-highlight");
  ctx.lineWidth = 3.25;
  ctx.lineJoin = "round";
  trace(ctx, plot, curve((n) => windowedAt(end, n)));
  // The joint: from where the block was heading to where the next copy starts.
  const past = windowedAt(end, N);
  const start = windowedAt(end, 0);
  ctx.strokeStyle = th.accentWarm;
  ctx.fillStyle = th.accentWarm;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  if (Math.abs(past - start) < 0.02) {
    ctx.beginPath();
    ctx.arc(plot.x(N), plot.y(start), 4, 0, 2 * Math.PI);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(plot.x(N), plot.y(past));
    ctx.lineTo(plot.x(N), plot.y(start));
    ctx.stroke();
  }
  ctx.restore();

  drawLabel(ctx, narrow ? "next" : "next copy", area.right - 3, area.top + 4, {
    align: "right", baseline: "top", size: 11, color: th.text3,
  });
  // The fact the 3D chip states, in the band the 3D labels keep clear.
  drawLabel(ctx, narrow ? chipText(end) : `${chipText(end)}; ${jointText(end)}`, area.left, geo.H - 12, {
    align: "left", baseline: "bottom", size: 12, weight: 600, color: th.text2,
  });
}

/**
 * The sentence for the 2D canvas's label.
 * @param {WindowState} s
 */
function describe2D(s) {
  return `One 160-sample block of a cosine at 6.5 cycles, multiplied by the ${WINDOWS[s.window].name} window. ` +
    `The window is ${fmt(windowAt(s.end, 0))} at the block's ends and ${fmt(windowAt(s.end, N / 2))} in the middle, ` +
    `so the windowed block keeps its size in the middle and ${s.end > 0.5 ? "keeps" : "loses"} it at the ends; ` +
    `there is ${jointText(s.end)}, where the next copy starts.`;
}

/* --- module ------------------------------------------------------------- */

/**
 * Mount the window-shapes figure.
 * @param {Element} host a `[data-anim="window-shapes"]` element
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const figure = document.createElement("figure");
  figure.className = "anim-figure anim-ws";
  figure.innerHTML = FIGURE_HTML;
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  caption.innerHTML = CAPTION;
  caption.append(" ", badge("synthetic"));
  host.append(figure);
  markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const canvas = $(frame, "canvas", HTMLCanvasElement);
  const windowGroup = $(figure, '[data-ref="window"]', HTMLElement);
  const toggle = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const camera = $(figure, '[data-ref="camera"]', HTMLElement);
  const legend2D = $(figure, '[data-ref="legend-2d"]', HTMLElement);
  const legend3D = $(figure, '[data-ref="legend-3d"]', HTMLElement);

  /** @type {WindowState} */
  const state = { window: "rect", end: WINDOWS.rect.end, preset: "corner" };

  const handle = setupCanvas(canvas, { onResize: () => render() });

  let labelTimer = 0;
  const describe = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => canvas.setAttribute("aria-label", describe2D(state)), 250);
  };

  /** @param {string} role @param {string} text */
  const set = (role, text) => {
    const el = figure.querySelector(`[data-role="${role}"]`);
    if (el && el.textContent !== text) el.textContent = text;
  };

  function render() {
    const th = getTheme();
    const geo = layout(handle.width, handle.height);
    // From the frame, not the canvas: in 3D the 2D canvas is hidden, and
    // the frame must keep its shape across the switch.
    const aspect = (frame.clientWidth || geo.W) < 560 ? "1 / 1" : "16 / 9";
    if (frame.style.getPropertyValue("--anim-aspect") !== aspect) frame.style.setProperty("--anim-aspect", aspect);
    clearCanvas(handle.ctx, handle, th.plotBg);
    drawBlock(handle.ctx, geo, state);

    set("r-ends", fmt(windowAt(state.end, 0)));
    set("r-middle", fmt(windowAt(state.end, N / 2)));
    set("r-step", `${fmt(jointStep(state.end))} out of a possible 2.00`);
    set("r-energy", `${(energyKept(state.end) * 100).toFixed(1)}% of the block's`);
    describe();
  }

  /** Redraw both views from the state. */
  const changed = () => {
    state.end = WINDOWS[state.window].end;
    render();
    views.update(state);
  };

  /* -- interaction ------------------------------------------------------- */

  const sync = () => {
    for (const button of windowGroup.querySelectorAll("[data-window]")) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-window") === state.window));
    }
  };

  /** @param {string | null | undefined} name @returns {name is WindowName} */
  const isWindow = (name) => /** @type {readonly (string | null | undefined)[]} */ (WINDOW_NAMES).includes(name);

  for (const button of windowGroup.querySelectorAll("[data-window]")) {
    button.addEventListener("click", () => {
      const name = button.getAttribute("data-window");
      if (isWindow(name)) state.window = name;
      sync();
      changed();
    }, { signal });
  }
  const unsubscribeTheme = onThemeChange(() => render());

  /* -- the 3D view ------------------------------------------------------- */

  /** @param {PresetName} name */
  const pressPreset = (name) => {
    for (const button of camera.querySelectorAll("[data-preset]")) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-preset") === name));
    }
  };

  /** @param {"2d" | "3d" | "parked"} view */
  const onView = (view) => {
    const live = view === "3d";
    camera.hidden = !live;
    legend3D.hidden = !live;
    legend2D.hidden = live;
    if (!live) render();
  };

  const views = createViewSwitch({
    frame,
    flat: canvas,
    toggle,
    hint,
    signal,
    state: () => state,
    load: () => import("./anim-window-shapes-3d.js"),
    onView,
    id: "window-shapes",
  });
  if (!views.available()) toggle.title = NO_WEBGL_HINT;

  /** @param {PresetName} name */
  function setPreset(name) {
    state.preset = name;
    pressPreset(name);
    views.preset(name);
  }
  for (const button of camera.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => {
      setPreset(/** @type {PresetName} */ (button.getAttribute("data-preset")));
    }, { signal });
  }

  /**
   * One step's state.
   * @param {Record<string, string>} s
   */
  function apply(s) {
    if (isWindow(s.window)) state.window = s.window;
    sync();
    if (s.preset && /** @type {readonly string[]} */ (PRESET_NAMES).includes(s.preset)) {
      setPreset(/** @type {PresetName} */ (s.preset));
    }
    if (s.view === "3d") void views.show3D();
    else if (s.view === "2d") views.show2D();
    changed();
  }

  sync();
  pressPreset(state.preset);
  if (steps.length) createStepper(figure, steps, apply, { signal });
  else changed();

  return () => {
    clearTimeout(labelTimer);
    unsubscribeTheme();
    handle.destroy();
  };
}
