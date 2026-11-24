// @ts-check
/* ===========================================================================
 * lib/highlight.js: the highlight kit (three-visual-language design §4).
 * ---------------------------------------------------------------------------
 * The one subject of a step, in every figure, is drawn with addHighlight()
 * and nothing else uses --ambe-highlight. Hue is never its only cue: it is
 * thicker than the context, glows, hides what is behind it, has a dashed
 * outline of its plane and a chip that states a fact, and pulses when the
 * selection changes. The legend says it in words too ("this frame
 * (thick)").
 *
 * Draw calls: the line, its core (dark only), the glow, the fill and the
 * outline, five at most. The line and the glow never take the fog and are
 * never covered (depthTest false). The glow goes through the stencil, so
 * each pixel blends once and joins do not bead; it is added in dark and
 * blended normally in light, and gone in print, where the line, fill,
 * outline and chip carry the selection by width and outline.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { duration } from "../anim-three.js";
import { createChip } from "./labels.js";
import { darkGround, fatLines, frostedFill, mix, printing, setFill, setSegments, tokenHex } from "./style.js";

/** @typedef {import("../anim-three.js").ThreeContext} ThreeContext */

/** Widths in CSS px (design §3): the line, its core, the glow, the outline. */
const LINE_PX = 3.25;
const CORE_PX = 1.25;
const GLOW_PX = 9;
/**
 * How far the outline's colour goes from --ambe-highlight toward the plot
 * background. It carries the selection in print, so it keeps 3:1 against
 * the plot and the stage in both themes (light 3.3:1 on white, 3.0:1 on
 * the stage bottom; dark 4.0:1); a11y.spec.js checks it.
 */
export const OUTLINE_MIX = 0.3;
const OUTLINE_PX = 1.25;

/**
 * @typedef {Object} HighlightOptions
 * @property {number} [baseline]  y of the fill's foot and the outline's
 *           bottom; the curve's lowest point if absent
 * @property {number} [top]  y of the outline's top; the curve's highest
 *           point if absent
 * @property {string} [chip]  the fact the chip states ("this frame: 160
 *           samples, 20 ms"); no chip if absent
 * @property {boolean} [fill=true]
 * @property {boolean} [quiet=false]  dimmer, no core, so a mark on it shows
 */

/**
 * @typedef {Object} HighlightKit
 * @property {(points: ArrayLike<number>) => void} set  a new curve, same plane
 * @property {() => Promise<void>} pulse  the glow at twice its opacity and
 *           back over --ambe-dur-slow; the width never changes; nothing
 *           under reduced motion
 * @property {import("./labels.js").Chip | null} chip
 */

/**
 * The highlight of a curve that lies in one plane z (points: flat x, y, z,
 * left to right). Add the group to the scene from build().
 * @param {ThreeContext} ctx
 * @param {ArrayLike<number>} points
 * @param {HighlightOptions} [opts]
 * @returns {import("three").Group & HighlightKit}
 */
export function addHighlight(ctx, points, opts = {}) {
  const T = ctx.three;
  const group = new T.Group();
  const shape = (/** @type {ArrayLike<number>} */ p) => {
    const n = Math.floor(p.length / 3);
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    /** @type {number[]} */
    const segments = [];
    let high = 0;
    for (let i = 0; i < n; i += 1) {
      xs[i] = p[i * 3];
      ys[i] = p[i * 3 + 1];
      if (ys[i] > ys[high]) high = i;
      if (i + 1 < n) for (let j = 0; j < 6; j += 1) segments.push(p[i * 3 + j]);
    }
    const z = p[2];
    const low = Math.min(...ys);
    const y0 = opts.baseline ?? low;
    const y1 = opts.top ?? ys[high];
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const outline = [x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z];
    /** @type {[number, number, number]} */
    const peak = [xs[high], ys[high], z];
    return { xs, ys, z, y0, segments, outline, peak };
  };
  let now = shape(points);

  const glow = fatLines(ctx, now.segments, "--ambe-highlight-glow", GLOW_PX, { depthTest: false });
  const line = fatLines(ctx, now.segments, "--ambe-highlight", LINE_PX, { depthTest: false });
  const core = fatLines(ctx, now.segments, "--ambe-highlight-core", CORE_PX, { depthTest: false });
  const outline = fatLines(ctx, now.outline, () => {
    const colour = mix(tokenHex("--ambe-highlight"), tokenHex("--ambe-plot-bg"), OUTLINE_MIX);
    return new Array(now.outline.length / 3).fill(colour);
  }, OUTLINE_PX, { dashed: true });
  // Glow, line and core draw after everything opaque, in that order.
  [glow, line, core].forEach((object, i) => {
    object.renderOrder = 10 + i;
    object.material.transparent = true;
  });
  const g = glow.material;
  g.depthWrite = false;
  g.stencilWrite = true;
  g.stencilRef = 1;
  g.stencilFunc = T.NotEqualStencilFunc;
  g.stencilZPass = T.ReplaceStencilOp;
  const fill = opts.fill === false ? null
    : frostedFill(ctx, now.xs, now.ys, now.z, now.y0, "--ambe-highlight-fill-top", "--ambe-highlight-fill-bottom", { fog: false });
  group.add(...(fill ? [fill] : []), outline, glow, line, core);

  /** The glow's resting opacity, from its token. */
  let rest = 0;
  // Runs after ctx.paint has set each material from its token, on a theme
  // change or print (anim-three.js recolours painted materials first).
  group.userData.recolour = () => {
    const dark = darkGround();
    // Just painted from its token, so this never compounds.
    if (opts.quiet) {
      g.opacity *= 0.4;
      line.material.opacity *= 0.7;
    }
    rest = g.opacity;
    g.blending = dark ? T.AdditiveBlending : T.NormalBlending;
    glow.visible = !printing();
    core.visible = dark && !opts.quiet;
    line.material.transparent = true;
    core.material.transparent = true;
  };
  group.userData.recolour();

  const chip = opts.chip === undefined ? null : createChip(ctx.frame, ctx, { text: opts.chip, at: now.peak });
  if (chip) {
    // Placed on every draw, so it follows the camera and the zoom.
    line.frustumCulled = false;
    line.onBeforeRender = () => chip.update();
    // Gone with the scene: on a rebuild, a park or the view's end.
    ctx.track({ dispose: chip.dispose });
  }

  // lib/orbit.js zooms its buttons toward a visible highlight's centre.
  group.userData.highlight = () => now.segments;

  const timeline = ctx.timeline();
  return Object.assign(group, {
    chip,
    set: (/** @type {ArrayLike<number>} */ next) => {
      now = shape(next);
      for (const object of [glow, line, core]) setSegments(object, now.segments);
      setSegments(outline, now.outline);
      outline.userData.recolour?.();
      if (fill) setFill(ctx, fill, now.xs, now.ys, now.z, now.y0);
      chip?.set({ at: now.peak });
      ctx.requestRender();
    },
    pulse: () => timeline.play("pulse", {
      ms: duration("slow"),
      step: (/** @type {number} */ t) => {
        g.opacity = rest * (1 + Math.sin(Math.PI * t));
      },
    }),
  });
}
