// @ts-check
/* ===========================================================================
 * anim-fixture.js: a test-only figure. Never in docs/, never in site/.
 * ---------------------------------------------------------------------------
 * tests/figures/helpers.js serves it at javascripts/anim-fixture.js through a
 * Playwright route, appends a mountLazy() line for it to anim.js, and injects
 * its host into real chapter pages. It exercises the stepper, the badges and
 * the 3D runtime end to end, so they can land before the figures that use
 * them. Its 3D view is a curve of 300 points and three axes, coloured by
 * theme tokens.
 * ======================================================================== */

import { $, markEnhanced } from "./anim-core.js";
import { badge } from "./anim-badges.js";
import { createStepper, readSteps } from "./anim-steps.js";
import { NO_WEBGL_HINT, mountThree } from "./anim-three.js";
import { createViewSwitch } from "./lib/view-switch.js";

const STEP_KEYS = /** @type {const} */ (["n", "view"]);

/**
 * @typedef {Object} FixtureProbe
 * @property {number} inits
 * @property {number} builds
 * @property {number} parks    onPark calls
 * @property {number} unparks  onUnpark calls
 * @property {Record<string, string>[]} applied
 * @property {boolean[]} animate
 * @property {import("./anim-three.js").ThreeContext | null} three
 * @property {unknown} pointsMaterial
 * @property {boolean} failBuild  make the next build() throw
 * @property {() => Promise<import("./anim-three.js").ThreeContext | null>} mountAgain
 * @property {import("./lib/view-switch.js").ViewSwitch | null} switch  data-view="auto" only
 * @property {string[]} views  what the switch reported, in order
 * @property {boolean[]} intros  the intro flag of each open3D call
 * @property {boolean[]} headOn  the headOn flag of each open3D call
 * @property {import("./lib/orbit.js").Pose | null} pose  the 3D part's pose
 * @property {unknown} highlight  the 3D part's highlight kit (lib/highlight.js)
 * @property {import("./lib/orbit.js").Orbit | null} orbit  the 3D part's orbit
 */

/** @returns {FixtureProbe} */
const newProbe = () => ({
  inits: 0, builds: 0, parks: 0, unparks: 0, applied: [], animate: [], three: null, pointsMaterial: null,
  failBuild: false, mountAgain: async () => null, switch: null, views: [], intros: [], headOn: [], pose: null, highlight: null, orbit: null,
});

// One probe per host, by its data-fixture-index; window.__fixture is the
// first host's, for the tests that use one host.
/** @type {FixtureProbe[]} */
const probes = [];
// @ts-ignore test-only global
window.__fixtures = probes;
// @ts-ignore test-only global
window.__fixture = probes[0] = newProbe();

/**
 * @param {FixtureProbe} probe
 * @param {import("./anim-three.js").ThreeContext} ctx
 */
export function build(probe, ctx) {
  if (probe.failBuild) throw new Error("fixture: build failed on request");
  const T = ctx.three;
  const positions = new Float32Array(300 * 3);
  for (let i = 0; i < 300; i += 1) {
    positions[i * 3] = (i / 299) * 2 - 1;
    positions[i * 3 + 1] = 0.5 * Math.sin(i * 0.07);
    positions[i * 3 + 2] = 0.5 * Math.cos(i * 0.03);
  }
  const points = new T.BufferGeometry();
  points.setAttribute("position", new T.BufferAttribute(positions, 3));
  const pointsMaterial = ctx.paint(new T.PointsMaterial({ size: 3, sizeAttenuation: false }), "--ambe-accent-cool");
  ctx.scene.add(new T.Points(points, pointsMaterial));
  const axes = new T.BufferGeometry();
  axes.setAttribute("position", new T.BufferAttribute(new Float32Array([
    -1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1,
  ]), 3));
  ctx.scene.add(new T.LineSegments(axes, ctx.paint(new T.LineBasicMaterial(), "--ambe-plot-axis")));
  ctx.camera.position.set(2.2, 1.6, 2.6);
  ctx.camera.lookAt(0, 0, 0);
  probe.pointsMaterial = pointsMaterial;
  probe.builds += 1;
}

/**
 * @param {Element} host
 * @param {import("./anim-core.js").MountContext} context
 * @returns {Promise<() => void>}
 */
export async function init(host, { signal }) {
  const steps = readSteps(host, STEP_KEYS);
  const index = Number(host.getAttribute("data-fixture-index") ?? 0);
  const probe = (probes[index] ??= newProbe());
  probe.inits += 1;
  const figure = document.createElement("figure");
  figure.className = "anim-figure";
  figure.innerHTML = `
    <div class="anim-figure__head"><p class="anim-figure__title">Fixture figure</p></div>
    <div class="anim-figure__frame">
      <canvas class="anim-figure__canvas" role="img" aria-label="Fixture plot, empty"></canvas>
    </div>
    <div class="anim-figure__step"></div>
    <div class="anim-controls">
      <button class="anim-btn" type="button" data-ref="view3d" aria-pressed="false">3D</button>
      <label class="anim-field"><span class="anim-field__label">Amount</span>
        <input class="anim-range" type="range" min="0" max="4" step="1" value="0"></label>
    </div>
    <p class="anim-figure__hint anim-figure__hint--webgl" hidden></p>
    <figcaption class="anim-figure__caption">Fixture caption, the same text as the static one.</figcaption>`;
  host.append(figure);
  if (host.getAttribute("data-enhanced") !== "false") markEnhanced(host);

  const frame = $(figure, ".anim-figure__frame", HTMLElement);
  const flat = $(frame, "canvas", HTMLCanvasElement);
  const toggle = $(figure, '[data-ref="view3d"]', HTMLButtonElement);
  const hint = $(figure, ".anim-figure__hint--webgl", HTMLElement);
  const caption = $(figure, ".anim-figure__caption", HTMLElement);
  const player = document.createElement("span");
  player.dataset.measured = "decoded-audio";
  player.append(badge("measured"));
  caption.append(" ", player);
  for (const kind of /** @type {const} */ (["derived-decoded", "input", "derived-input", "synthetic", "illustrative"])) {
    caption.append(" ", badge(kind));
  }

  const wanted = () => toggle.getAttribute("aria-pressed") === "true";
  /** @type {import("./anim-three.js").ThreeOptions} */
  const options = {
    signal,
    label: "Fixture curve of 300 points on three axes",
    build: (ctx) => build(probe, ctx),
    wanted,
    onPark: () => {
      probe.parks += 1;
      flat.hidden = false;
    },
    onUnpark: () => {
      probe.unparks += 1;
      flat.hidden = true;
    },
  };
  /** @param {boolean} on */
  const setView = async (on) => {
    toggle.setAttribute("aria-pressed", String(on));
    if (!on) {
      probe.three?.dispose();
      probe.three = null;
      flat.hidden = false;
      return;
    }
    const ctx = await mountThree(frame, options);
    if (!wanted()) return; // the reader left 3D while it was starting
    if (!ctx) {
      toggle.disabled = true;
      toggle.setAttribute("aria-pressed", "false");
      hint.textContent = NO_WEBGL_HINT;
      hint.hidden = false;
      return;
    }
    probe.three = ctx;
    flat.hidden = true;
  };
  probe.mountAgain = () => mountThree(frame, options);

  // data-view="auto": the view switch decides (the opening rule), and the
  // 3D part, anim-fixture-3d.js, loads only when it is wanted.
  if (host.getAttribute("data-view") === "auto") {
    probe.switch = createViewSwitch({
      frame, flat, toggle, hint, signal,
      state: () => ({ index }),
      load: () => import("./anim-fixture-3d.js"),
      onView: (view) => probe.views.push(view),
      headOn: host.hasAttribute("data-head-on"),
      id: `fixture-${index}`,
    });
  } else {
    toggle.addEventListener("click", () => setView(toggle.getAttribute("aria-pressed") !== "true"), { signal });
  }
  if (steps.length) {
    createStepper(figure, steps, (state, { animate }) => {
      probe.applied.push(state);
      probe.animate.push(animate);
    }, { signal });
  }
  if (host.getAttribute("data-view") === "3d") await setView(true);
  return () => {};
}
