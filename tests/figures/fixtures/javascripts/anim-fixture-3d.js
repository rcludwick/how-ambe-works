// @ts-check
/* ===========================================================================
 * anim-fixture-3d.js: the fixture figure's 3D part, for data-view="auto".
 * Test-only, like anim-fixture.js; served by tests/figures/helpers.js.
 * ---------------------------------------------------------------------------
 * The shape every anim-<slug>-3d.js takes (lib/view-switch.js Open3D): it
 * mounts the view, fits its front preset to a plot rectangle, plays a short
 * intro when asked, and resolves once the view has drawn. It wears the
 * visual language (lib/style.js): the stage, a floor with a contact
 * shadow, fog, a family of ramp-coloured context curves faded by their
 * distance from the middle one, and the highlight kit on the middle one.
 * ======================================================================== */

import { mountThree } from "./anim-three.js";
import { build } from "./anim-fixture.js";
import { FRONT, TOP, createOrbit, matchPlot } from "./lib/orbit.js";
import { addHighlight } from "./lib/highlight.js";
import { curveFamily } from "./lib/scene.js";
import { contactShadow, floor, fog, rampColor } from "./lib/style.js";

/** Context curves at z = (c - 4) / 5, the middle one the subject. */
const CURVES = Array.from({ length: 9 }, (_, c) => {
  const points = [];
  for (let i = 0; i <= 60; i += 1) {
    const x = (i / 60) * 2 - 1;
    points.push(x, 0.4 * Math.sin(3 * x + c * 0.5) - 0.3, (c - 4) / 5);
  }
  return points;
});

/**
 * The look on top of the fixture's own build.
 * @param {import("./anim-three.js").ThreeContext} ctx
 * @param {{highlight: unknown}} probe
 */
function dress(ctx, probe) {
  const box = { min: /** @type {[number, number, number]} */ ([-1, -1, -1]), max: /** @type {[number, number, number]} */ ([1, 1, 1]) };
  ctx.scene.add(floor(ctx, { extent: box, step: 0.5 }));
  ctx.scene.add(contactShadow(ctx, { x: [-1, 1], z: [-1, 1], y: -1 }));
  const context = CURVES.filter((_, c) => c !== 4);
  ctx.scene.add(curveFamily(ctx, context, {
    colours: (c) => rampColor((c < 4 ? c : c + 1) / 8), delta: context.map((_, c) => (c < 4 ? c - 4 : c - 3)),
  }));
  const highlight = addHighlight(ctx, CURVES[4], { baseline: -1, chip: "middle curve: 61 points" });
  ctx.scene.add(highlight);
  probe.highlight = highlight;
  fog(ctx, 6, 2);
}

/** @type {Record<string, import("./lib/orbit.js").Pose>} */
const PRESETS = { front: FRONT, corner: { yaw: 35, pitch: 20 }, top: TOP };

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  const host = /** @type {HTMLElement} */ (frame.closest("[data-anim]"));
  const index = Number(host.getAttribute("data-fixture-index") ?? 0);
  // @ts-ignore test-only global
  const probe = window.__fixtures[index];
  probe.intros.push(opts.intro);
  probe.headOn.push(opts.headOn);
  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: "Fixture curve of 300 points on three axes",
    build: (c) => {
      build(probe, c);
      dress(c, probe);
    },
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: () => {
      probe.parks += 1;
      opts.onPark();
    },
    onUnpark: () => {
      probe.unparks += 1;
      opts.onUnpark();
    },
  });
  if (!ctx) return null;
  probe.three = ctx;
  const fitted = matchPlot(ctx, () => ({ x: 36, y: 8, width: frame.clientWidth - 44, height: frame.clientHeight - 36 }), {
    min: [-1, -1, -1], max: [1, 1, 1],
  });
  /** @type {ReturnType<typeof createOrbit> | null} */
  let turn = null;
  const orbit = createOrbit(ctx, {
    target: fitted.target, fit: fitted.fit, distance: 6, zoom: opts.look.zoom || 1, presets: PRESETS,
    start: opts.headOn ? "front" : "corner", yaw: !opts.headOn, onDrag: opts.onDrag,
    onChange: () => { probe.pose = turn?.pose() ?? null; },
  });
  turn = orbit;
  probe.orbit = orbit;
  probe.pose = orbit.pose();
  if (opts.intro) {
    orbit.set(FRONT);
    void orbit.go(opts.headOn ? "front" : "corner");
  }
  await ctx.drawn();
  return {
    update: () => ctx.requestRender(),
    preset: (name) => void orbit.go(name),
    describe: () => "Fixture curve of 300 points on three axes",
    close: () => {
      if (probe.three === ctx) probe.three = null;
      ctx.dispose();
    },
  };
}
