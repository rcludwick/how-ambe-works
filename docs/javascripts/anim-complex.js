/* ===========================================================================
 * anim-complex.js — one point, written three ways, and the wave it traces.
 * ---------------------------------------------------------------------------
 * SLUG          complex          <div data-anim="complex"></div>
 *
 * DATA READ     none. Every number here is computed from the reader's own
 *               dragging. There is nothing measured to load.
 *
 * CONTROLS      • drag anywhere in the left panel to move the point
 *               • radius and angle sliders, which are the same point
 *               • "Spin" runs the angle forward so the right panel draws
 *
 * WHAT IT DRAWS Left: a plane with one point on it, labelled simultaneously as
 *               a pair (x, y), as a length and a turn (r, θ), and as a complex
 *               number r·e^(iθ) = x + iy. Those are three names for one thing,
 *               which is the whole content of the figure: the reader should
 *               leave believing the complex plane is not a new place, it is the
 *               plane they already had with a second name for its points.
 *
 *               Right: the horizontal projection of that point as the angle
 *               advances. A point going round at a steady rate projects to a
 *               cosine. That is why the DFT probes with e^(-iωn) rather than
 *               with a sine and a cosine separately: one rotating point
 *               carries both, and its angle is the phase.
 *
 * NOT A CODEC   No AMBE anywhere near this. It is the definition of polar form
 *               and Euler's identity, drawn. Chapter 02 uses it to introduce
 *               the complex exponential before the DFT sum needs it.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import {
  mount as mountAnim,
  setupCanvas,
  createPlot,
  createLoop,
  clearCanvas,
  crisp,
  drawAxes,
  drawGrid,
  drawLabel,
  drawPolyline,
  getTheme,
  onThemeChange,
  prefersReducedMotion,
} from "./anim-core.js";

const SLUG = "complex";

/** The plane is drawn on [-1.35, 1.35] so a unit circle sits comfortably in it. */
const EXTENT = 1.35;

/** How many turns of history the wave panel keeps. */
const WAVE_TURNS = 2;
const WAVE_POINTS = 480;

/** Radians per second while spinning. Slow enough to follow by eye. */
const SPIN_RATE = Math.PI / 2.4;

const TAU = Math.PI * 2;

function fmt(v, places = 2) {
  const s = v.toFixed(places);
  return s === "-0.00" ? "0.00" : s;
}

/** Angle in turns, normalised to [0, 1), for the readouts. */
function wrap(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

/* --- markup ------------------------------------------------------------- */

const FIGURE_HTML = `
<div class="anim-figure__head">
  <p class="anim-figure__title">A point, a length and a turn, a complex number</p>
</div>

<div class="anim-figure__frame" data-state="ready" style="--anim-aspect: 16 / 8">
  <canvas class="anim-figure__canvas" role="img"
          aria-label="Left: a plane carrying one point, shown as x and y coordinates, as a radius and angle, and as a complex number. Right: the horizontal projection of that point plotted against angle, which traces a cosine."></canvas>
</div>

<ul class="anim-legend">
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-1"></i>the point, and the radius drawn to it</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-2"></i>x, the horizontal part (the real axis)</li>
  <li class="anim-legend__item"><i class="anim-legend__swatch is-data-3"></i>y, the vertical part (the imaginary axis)</li>
</ul>

<div class="anim-controls">
  <label class="anim-field">
    <span class="anim-field__label">Radius r</span>
    <input class="anim-range" type="range" min="0" max="130" step="1" value="100"
           data-role="radius" aria-label="Radius, hundredths">
  </label>
  <label class="anim-field">
    <span class="anim-field__label">Angle θ</span>
    <input class="anim-range" type="range" min="0" max="360" step="1" value="35"
           data-role="angle" aria-label="Angle in degrees">
  </label>
  <button class="anim-btn anim-btn--play" type="button" data-role="spin" aria-pressed="false">Spin</button>
</div>

<div class="anim-forms" data-role="forms" aria-live="polite">
  <p class="anim-forms__row"><span class="anim-forms__tag">as a pair</span>
    <code data-role="f-rect"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">as length and turn</span>
    <code data-role="f-polar"></code></p>
  <p class="anim-forms__row"><span class="anim-forms__tag">as one complex number</span>
    <code data-role="f-euler"></code></p>
</div>

<p class="anim-figure__caption">
  Drag the point. The three lines underneath never disagree, because they are
  three ways of writing the same thing. The pair is what you measure off the
  axes. The length and turn is the same point in polar form, with
  <em>r</em> = √(x² + y²) and <em>θ</em> = atan2(y, x). The third line is
  Euler's identity, which says a turn of θ at radius r <em>is</em> the pair
  (r·cos θ, r·sin θ).
  Press <em>Spin</em> and watch the right panel: a point going round at a steady
  rate projects to a cosine, and where it starts is the phase. One rotating
  point carries an amplitude and a phase at once, which is the reason the next
  chapter's transform probes with e<sup>−iωn</sup> instead of with a sine and a
  cosine separately.
  <span class="anim-figure__source">Definitions only. Nothing here is measured
  and nothing here is specific to AMBE.</span>
</p>
`;

/* --- module ------------------------------------------------------------- */

/**
 * Mount the complex-plane figure.
 * @param {Element} root a `[data-anim="complex"]` element
 * @returns {() => void} cleanup
 */
export function mount(root) {
  root.classList.add("anim-figure");
  if (!root.querySelector(".anim-figure__frame")) root.innerHTML = FIGURE_HTML;

  const frame = root.querySelector(".anim-figure__frame");
  const canvas = root.querySelector("canvas");
  const radiusEl = root.querySelector('[data-role="radius"]');
  const angleEl = root.querySelector('[data-role="angle"]');
  const spinEl = root.querySelector('[data-role="spin"]');
  const reduced = prefersReducedMotion();

  const state = {
    r: 1.0,
    theta: (35 * Math.PI) / 180,
    spinning: false,
    /** Angle history for the wave panel, newest last. */
    trail: [],
  };

  const handle = setupCanvas(canvas, { onResize: () => render() });

  /* -- geometry ---------------------------------------------------------- */

  function layout() {
    const W = handle.width;
    const H = handle.height;
    const stacked = W < 620;
    const pad = stacked ? 10 : 16;

    // THE PLANE MUST BE SQUARE. Both axes carry the same units, so a plot area
    // that is wider than it is tall draws the unit circle as an ellipse and
    // makes r look like something other than a length. That is fatal here:
    // the figure's whole claim is that (x, y) and (r, θ) describe one point.
    // So fit the largest square that fits the space and centre it, rather than
    // letting the padding decide the shape.
    const axisL = stacked ? 30 : 40;
    const capT = stacked ? 8 : 14;
    const capB = stacked ? 26 : 28;
    const boxW = (stacked ? W : Math.min(H * 1.02, W * 0.46)) - axisL - pad;
    const boxH = (stacked ? H * 0.5 : H) - capT - capB;
    const size = Math.max(40, Math.min(boxW, boxH));

    const left = axisL + Math.max(0, (boxW - size) / 2);
    const top = capT + Math.max(0, (boxH - size) / 2);
    const plane = createPlot(
      { width: W, height: H },
      {
        xDomain: [-EXTENT, EXTENT],
        yDomain: [-EXTENT, EXTENT],
        padding: { top, right: W - left - size, bottom: H - top - size, left },
      }
    );

    // The wave panel has no such constraint: its axes are turns against
    // amplitude, which are not comparable, so it takes whatever is left.
    const wave = createPlot(
      { width: W, height: H },
      {
        xDomain: [0, WAVE_TURNS],
        yDomain: [-EXTENT, EXTENT],
        padding: stacked
          ? { top: H * 0.56, right: pad + 6, bottom: 26, left: 34 }
          : { top: capT, right: pad + 6, bottom: capB, left: left + size + 34 },
      }
    );

    return { W, H, stacked, plane, wave };
  }

  /* -- drawing ----------------------------------------------------------- */

  function drawPlane(ctx, th, geo) {
    const { plane, stacked } = geo;
    const { r, theta } = state;
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);

    drawGrid(ctx, plane, { xTicks: [-1, 0, 1], yTicks: [-1, 0, 1] });
    drawAxes(ctx, plane, {
      xTicks: [-1, 0, 1],
      yTicks: [-1, 1],
      formatX: (v) => String(v),
      formatY: (v) => (v === 1 ? "i" : v === -1 ? "-i" : String(v)),
      xLabel: stacked ? "real" : "real axis",
    });

    ctx.save();
    plane.clip(ctx);

    // Unit circle: the reference the angle is read against.
    const circle = [];
    for (let i = 0; i <= 180; i += 1) {
      const a = (i / 180) * TAU;
      circle.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    drawPolyline(ctx, circle, { plot: plane, color: th.border, width: 1, dash: [3, 4] });

    const ox = plane.x(0);
    const oy = plane.y(0);
    const px = plane.x(x);
    const py = plane.y(y);

    // The two components, drawn as the sides of the right triangle they are.
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = th.series[1];
    ctx.beginPath();
    ctx.moveTo(ox, py);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.strokeStyle = th.series[2];
    ctx.beginPath();
    ctx.moveTo(px, oy);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.setLineDash([]);

    // x along the real axis, y along the imaginary axis.
    ctx.lineWidth = 3;
    ctx.strokeStyle = th.series[1];
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(px, oy);
    ctx.stroke();
    ctx.strokeStyle = th.series[2];
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox, py);
    ctx.stroke();

    // The angle, as an arc from the real axis round to the radius.
    const arcR = Math.min(38, Math.max(20, Math.abs(px - ox) * 0.42 + 20));
    ctx.strokeStyle = th.accentWarm;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(ox, oy, arcR, 0, -wrap(theta), true);
    ctx.stroke();

    // The radius itself, and the point.
    ctx.strokeStyle = th.series[0];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(px, py);
    ctx.stroke();

    ctx.fillStyle = th.series[0];
    ctx.beginPath();
    ctx.arc(px, py, 5.5, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Labels sit outside the clip so they are never half-eaten at the edge.
    drawLabel(ctx, `θ = ${fmt(wrap(theta) / TAU, 3)} turn`, ox + arcR + 6, oy - 6, {
      align: "left",
      baseline: "bottom",
      size: 11,
      color: th.accentWarm,
      background: th.plotBg,
      padding: 2,
    });
    drawLabel(ctx, `r = ${fmt(r)}`, (ox + px) / 2, (oy + py) / 2 - 8, {
      align: "center",
      baseline: "bottom",
      size: 11,
      weight: 600,
      color: th.series[0],
      background: th.plotBg,
      padding: 2,
    });
    if (Math.abs(x) > 0.12) {
      drawLabel(ctx, `x = ${fmt(x)}`, (ox + px) / 2, oy + 6, {
        align: "center",
        baseline: "top",
        size: 10,
        color: th.series[1],
        background: th.plotBg,
        padding: 2,
      });
    }
    if (Math.abs(y) > 0.12) {
      drawLabel(ctx, `y = ${fmt(y)}`, ox - 6, (oy + py) / 2, {
        align: "right",
        baseline: "middle",
        size: 10,
        color: th.series[2],
        background: th.plotBg,
        padding: 2,
      });
    }
  }

  function drawWave(ctx, th, geo) {
    const { wave, stacked } = geo;

    drawGrid(ctx, wave, { xTicks: [0.5, 1, 1.5], yTicks: [0] });
    drawAxes(ctx, wave, {
      xTicks: [0, 0.5, 1, 1.5, 2],
      yTicks: [],
      formatX: (v) => (v === 0 ? "0" : `${v}`),
      xLabel: stacked ? "turns" : "turns of the point",
    });

    ctx.save();
    wave.clip(ctx);

    // The cosine the current radius would trace over two full turns. Drawn
    // faint, as the shape the reader is heading towards.
    const ideal = [];
    for (let i = 0; i <= WAVE_POINTS; i += 1) {
      const t = (i / WAVE_POINTS) * WAVE_TURNS;
      ideal.push({ x: t, y: state.r * Math.cos(t * TAU + state.theta) });
    }
    drawPolyline(ctx, ideal, { plot: wave, color: th.muted, width: 1, dash: [3, 4] });

    // What the point has actually traced so far.
    if (state.trail.length > 1) {
      drawPolyline(ctx, state.trail, { plot: wave, color: th.series[1], width: 2 });
      const last = state.trail[state.trail.length - 1];
      ctx.fillStyle = th.series[1];
      ctx.beginPath();
      ctx.arc(wave.x(last.x), wave.y(last.y), 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    drawLabel(
      ctx,
      stacked ? "x, as the point turns" : "x, plotted as the point turns",
      wave.area.left + 6,
      wave.area.top + 6,
      { align: "left", baseline: "top", size: 11, color: th.text3 }
    );
  }

  function render() {
    const th = getTheme();
    const ctx = handle.ctx;
    const geo = layout();

    const aspect = geo.W < 620 ? "1 / 1.15" : "16 / 8";
    if (frame && frame.style.getPropertyValue("--anim-aspect") !== aspect) {
      frame.style.setProperty("--anim-aspect", aspect);
    }

    clearCanvas(ctx, handle, th.plotBg);
    drawPlane(ctx, th, geo);
    drawWave(ctx, th, geo);
    updateForms();
  }

  function updateForms() {
    const { r, theta } = state;
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    const t = wrap(theta);
    const set = (role, text) => {
      const el = root.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };
    set("f-rect", `(x, y)  =  (${fmt(x)}, ${fmt(y)})`);
    set("f-polar", `r = ${fmt(r)},  θ = ${fmt((t * 180) / Math.PI, 1)}°`);
    set(
      "f-euler",
      `${fmt(r)}·e^(i${fmt(t, 2)})  =  ${fmt(x)} ${y < 0 ? "−" : "+"} ${fmt(Math.abs(y))}i`
    );
  }

  /* -- interaction ------------------------------------------------------- */

  function syncSliders() {
    if (radiusEl) {
      const v = String(Math.round(state.r * 100));
      if (radiusEl.value !== v) radiusEl.value = v;
    }
    if (angleEl) {
      const v = String(Math.round((wrap(state.theta) * 180) / Math.PI) % 360);
      if (angleEl.value !== v) angleEl.value = v;
    }
  }

  /** Push the current x onto the wave trail, keeping WAVE_TURNS of history. */
  function pushTrail(turnsAdvanced) {
    const x = state.r * Math.cos(state.theta);
    const head = state.trail.length ? state.trail[state.trail.length - 1].x : 0;
    const at = head + turnsAdvanced;
    state.trail.push({ x: at, y: x });
    // Slide the window rather than growing without bound.
    if (at > WAVE_TURNS) {
      const shift = at - WAVE_TURNS;
      for (const p of state.trail) p.x -= shift;
      while (state.trail.length && state.trail[0].x < 0) state.trail.shift();
    }
    if (state.trail.length > WAVE_POINTS * 2) state.trail.shift();
  }

  const loop = createLoop(
    ({ dt }) => {
      if (!state.spinning) {
        loop.stop();
        return;
      }
      const step = Math.min(dt, 0.05);
      state.theta += SPIN_RATE * step;
      pushTrail((SPIN_RATE * step) / TAU);
      syncSliders();
      render();
    },
    { element: root, autoplay: false }
  );

  function setSpinning(on) {
    state.spinning = on && !reduced;
    if (spinEl) {
      spinEl.setAttribute("aria-pressed", state.spinning ? "true" : "false");
      spinEl.textContent = state.spinning ? "Pause" : "Spin";
    }
    if (state.spinning) loop.start();
    else loop.stop();
  }

  /** Move the point from a pointer position, in CSS pixels within the canvas. */
  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const { plane } = layout();
    if (cx > plane.area.right + 8) return false;
    // Invert the plot's own mapping rather than re-deriving the scale.
    const ux =
      ((cx - plane.area.left) / plane.area.width) * (EXTENT * 2) - EXTENT;
    const uy =
      EXTENT - ((cy - plane.area.top) / plane.area.height) * (EXTENT * 2);
    state.r = Math.min(Math.hypot(ux, uy), EXTENT);
    state.theta = Math.atan2(uy, ux);
    state.trail = [];
    syncSliders();
    render();
    return true;
  }

  let dragging = false;
  const onDown = (e) => {
    if (!pointFromEvent(e)) return;
    dragging = true;
    setSpinning(false);
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e) => {
    if (dragging) pointFromEvent(e);
  };
  const onUp = (e) => {
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  const onRadius = () => {
    state.r = Number(radiusEl.value) / 100;
    state.trail = [];
    render();
  };
  const onAngle = () => {
    state.theta = (Number(angleEl.value) * Math.PI) / 180;
    state.trail = [];
    render();
  };
  const onSpin = () => setSpinning(!state.spinning);

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  if (radiusEl) radiusEl.addEventListener("input", onRadius);
  if (angleEl) angleEl.addEventListener("input", onAngle);
  if (spinEl) spinEl.addEventListener("click", onSpin);
  const unsubscribeTheme = onThemeChange(() => render());

  if (reduced && spinEl) {
    spinEl.disabled = true;
    spinEl.title = "Disabled because your system asks for reduced motion";
  }

  syncSliders();
  render();

  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    if (radiusEl) radiusEl.removeEventListener("input", onRadius);
    if (angleEl) angleEl.removeEventListener("input", onAngle);
    if (spinEl) spinEl.removeEventListener("click", onSpin);
    unsubscribeTheme();
    loop.destroy();
    handle.destroy();
  };
}

export default mount;

/* Self-register: every [data-anim="complex"] on the page, now and after each
 * navigation.instant swap. */
mountAnim(`[data-anim="${SLUG}"]`, mount);
