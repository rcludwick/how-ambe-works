// @ts-check
/* ===========================================================================
 * anim-voicing-3d.js: the voicing figure's "Whole clip (3D)" view (ch07),
 * loaded by lib/view-switch.js only when a 3D view is wanted and the frame
 * is near.
 * ---------------------------------------------------------------------------
 * It draws the 2D module's arrays (VoicingScene in anim-voicing.js) and
 * computes nothing about the audio: each frame's eight band strengths and
 * its level, the frame on screen and the threshold. x is the frame across
 * the clip, y the band strength, z the band (band 1 in front). The Top
 * preset looks down on the floor, which is the 2D map; the Side preset
 * looks along time, and puts the bands where the One frame view puts them.
 *
 * The look (three-visual-language design §4, voicing): the stage, a floor
 * with a contact shadow, fog. Ridges in --ambe-voiced above the threshold
 * and --ambe-unvoiced below it, faded by their distance in time from the
 * frame on screen, over frosted curtains; floor cells in the same two
 * colours, the unvoiced ones hatched, so the pair never rests on hue; the
 * threshold as a frosted --ambe-accent plane at 18% with a 2.25 px edge.
 * The frame on screen is a 3.25 px --ambe-plot-ink line with the highlight
 * glow and a dot per band. The subject, in the highlight kit, is where the
 * threshold cuts that frame: a segment across its eight bands at the
 * threshold, a dashed ink stem from each band's dot to it, and a chip that
 * states the count above it, in free stage with its leader to the segment.
 * From above (Top) the ridges and curtains go, the fog recedes, and in
 * light the floor keeps its tokens' colour: the map.
 *
 * The explanatory animation, enter() ("one frame is one row of the whole
 * clip"): the view starts at Side, showing the frame on screen alone, then
 * turns to Corner while the ridges, curtains and floor grow out along time
 * from that frame. A threshold change slides the plane and recolours the
 * ridges and floor as it passes them, a 300 ms wave. It runs on
 * ctx.timeline(), lands on its end state under reduced motion, on any
 * input and in print.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK, prefersReducedMotion } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { createChip, createLabels } from "./lib/labels.js";
import { createOrbit } from "./lib/orbit.js";
import { contactShadow, darkGround, fadeAmount, fatLines, floor, fog, mix, printing, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-voicing.js").VoicingScene} VoicingScene */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./lib/orbit.js").Pose} Pose */

const X_HALF = 1.6;
const Y_SCALE = 1.5;
/** @param {number} b band index, 0 to 7 */
const bandZ = (b) => 0.3 * (8 - b);
/** @type {[number, number, number]} */
const TARGET = [0, 0.75, 1.35];
const DISTANCE = 6;
/** @type {Record<string, Pose>} */
// Corner keeps band 1 on the left, as Side and the One frame view have it,
// with time running to the right: the turn from Side is 55 degrees.
const PRESETS = {
  corner: { yaw: 35, pitch: 30 },
  top: { yaw: 0, pitch: 90 },
  side: { yaw: 90, pitch: 0 },
};
/** Frames whose decoded level is below this are drawn as silence. */
const SILENT_DBFS = -60;
/** Frames per step of the distance fade (lib/style.js fade), past the first 40. */
const FADE_FRAMES = 40;
/** The view holds on the one frame this long before it turns, ms. */
const HOLD_MS = 300;
const WAVE_MS = 300;
/** How far the other frames' ridges recede toward the plot ground, at rest. */
const ASIDE = 0.62;
/** The curtains' top: the ridge's colour this far toward the plot ground. */
const CURTAIN_MIX = { dark: 0.72, light: 0.8 };
/** Hatch stripes per scene unit on the unvoiced floor cells. */
const HATCH_PER_UNIT = 14;
const DOT_PX = 8;
const RING_PX = 11.5;
/** CSS px: the chip's gap from its anchor and from the frame's edge (lib/labels.js). */
const CHIP_GAP = 14;
const CHIP_EDGE = 4;
/** lib/labels.js keeps labels out of the frame's bottom strip, this tall. */
const BOTTOM_STRIP = 56;
/** From above (Top), the highlight sits this far beside the frame line, px. */
const TOP_OFFSET_PX = 9;
/** Pitch past which the view is "from above": the floor is the map. */
const OVERHEAD = 75;
/** The scene's extent along the view, for the fog (lib/style.js fog). */
const FOG_DEPTH = 3.6;

/**
 * The convex hull of points, counter-clockwise (monotone chain).
 * @param {number[][]} points
 * @returns {number[][]}
 */
function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (/** @type {number[]} */ o, /** @type {number[]} */ a, /** @type {number[]} */ b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  /** @type {number[][]} */
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  /** @type {number[][]} */
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** @param {number[][]} hull counter-clockwise @param {number} x @param {number} y */
function insideHull(hull, x, y) {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}

/**
 * The view the 2D module drives: the walk-through and the steps.
 * @typedef {Object} VoicingView
 * @property {(o?: {build?: boolean}) => Promise<void>} enter  the
 *           explanatory animation, from Side to Corner
 * @property {(name: string) => Promise<void>} preset
 * @property {() => void} pulse
 * @property {() => void} finish
 */

/**
 * A white disc as an alpha mask for round points.
 * @param {typeof import("three")} T
 */
function discMask(T) {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      data.set([255, 255, 255, Math.round(Math.max(0, Math.min(1, (1 - r) * n * 0.5)) * 255)], (y * n + x) * 4);
    }
  }
  const texture = new T.DataTexture(data, n, n);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Diagonal stripes as an alpha mask, repeating; the colour comes from the
 * material.
 * @param {typeof import("three")} T
 */
function hatchTexture(T) {
  const n = 16;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      // Distance from the nearest diagonal x + y = n (mod n), in pixels.
      const d = Math.abs((((x + y + 1 - n) % n) + n) % n - n / 2) - n / 2 + 2.4;
      data.set([255, 255, 255, Math.round(Math.max(0, Math.min(1, -d + 0.5)) * 255)], (y * n + x) * 4);
    }
  }
  const texture = new T.DataTexture(data, n, n);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let scene = /** @type {VoicingScene} */ (opts.state);
  /** How far the ridges and floor have grown out from the frame on screen, 0 to 1. */
  let reveal = 1;
  /** How far the other frames have receded, 0 to 1 (0 while the opening grows them). */
  let context = 1;
  /** The threshold as drawn: the scene's, except during the wave. */
  let shown = scene.threshold;
  let builds = 0;
  let played = 0;
  /** The reveal and the yaw at each step of the last entry, for the tests. @type {number[][]} */
  let trace = [];
  let ready = false;
  /** The view looks down on the floor (Top): the map, without the ridges. */
  let overhead = false;
  /** Places the chip clear of the scene; set once the camera is known. */
  let placeChip = () => {};
  /** Moves the fog past the floor from above; set once the orbit is known. */
  let recede = () => {};

  /**
   * @typedef {Object} Parts
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} ridges
   * @property {import("three").Mesh} curtains
   * @property {import("three").Mesh} cells
   * @property {import("three").Mesh} hatch
   * @property {import("three").Group} plane
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} glow
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} current
   * @property {import("three").Points} dots
   * @property {import("three").Points} ring
   * @property {import("three").Group & import("./lib/highlight.js").HighlightKit} kit
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} stems
   * @property {import("./lib/labels.js").Chip} chip
   */
  /** @type {Parts | null} */
  let parts = null;
  /** The growth's clip planes: x at least the first, at most the second. */
  /** @type {import("three").Plane[]} */
  const planes = [];
  /** Vertex colours of the ridges, written with their positions. @type {number[]} */
  let ridgeColours = [];
  /** What each ridge segment is, and its heights in strength units, for the tests. */
  /** @type {{kind: string, v0: number, v1: number}[]} */
  let ridgeKinds = [];
  /** The eight dots' colours as last written, 0xRRGGBB, for the tests. @type {number[]} */
  let dotHexes = [];

  /** @param {ThreeContext} ctx */
  const build = (ctx) => {
    const T = ctx.three;
    if (!planes.length) planes.push(new T.Plane(new T.Vector3(1, 0, 0), 100), new T.Plane(new T.Vector3(-1, 0, 0), 100));
    ctx.renderer.localClippingEnabled = true;
    const disc = ctx.track(discMask(T));
    const stripes = ctx.track(hatchTexture(T));
    /** @param {number} count @param {number} [colours] */
    const geometry = (count = 0, colours = 0) => {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(count * 3), 3));
      if (colours) g.setAttribute("color", new T.BufferAttribute(new Float32Array(count * colours), colours));
      return g;
    };
    const z0 = bandZ(0) + 0.14;
    const z1 = bandZ(7) - 0.14;
    ctx.scene.add(floor(ctx, { extent: { min: [-X_HALF - 0.25, -0.006, z1 - 0.25], max: [X_HALF + 0.25, -0.006, z0 + 0.25] }, step: [X_HALF / 4, 0.3] }));
    ctx.scene.add(contactShadow(ctx, { x: [-X_HALF, X_HALF], z: [z1, z0], y: -0.005 }));

    // The floor: one opaque cell per band and frame, the 2D map.
    const cells = new T.Mesh(geometry(0, 3), new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    // Diagonal hatch over the unvoiced cells, in the plot ground's colour
    // (in ink from above in light, where the map must hold its colour);
    // write() sets it.
    const hatch = new T.Mesh(geometry(0), new T.MeshBasicMaterial({
      map: stripes, transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide,
    }));
    hatch.renderOrder = 1;
    // Frosted curtains: opaque walls from the floor to each ridge, so each
    // band hides the ridges behind it.
    const curtains = new T.Mesh(geometry(0, 3), new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    const ridges = fatLines(ctx, [], () => ridgeColours, 1.75, { fog: true });

    // The threshold: a frosted plane at 18% with a 2.25 px edge.
    const plane = new T.Group();
    const sheet = new T.PlaneGeometry(2 * X_HALF + 0.2, z0 - z1 + 0.06);
    sheet.rotateX(-Math.PI / 2);
    sheet.translate(0, 0, (z0 + z1) / 2);
    const sheetMesh = new T.Mesh(sheet, new T.MeshBasicMaterial({
      transparent: true, opacity: 0.18, depthWrite: false, side: T.DoubleSide,
    }));
    // Colour set here, not through ctx.paint, which takes the token's
    // opacity too: the plane keeps its 18%.
    sheetMesh.userData.recolour = () => {
      /** @type {import("three").MeshBasicMaterial} */ (sheetMesh.material).color.setHex(tokenHex("--ambe-accent"));
    };
    sheetMesh.userData.recolour();
    sheetMesh.renderOrder = 2;
    const ex = X_HALF + 0.1;
    const ez0 = z0 + 0.03;
    const ez1 = z1 - 0.03;
    const edge = fatLines(ctx, [-ex, 0, ez0, ex, 0, ez0, ex, 0, ez0, ex, 0, ez1, ex, 0, ez1, -ex, 0, ez1, -ex, 0, ez1, -ex, 0, ez0],
      "--ambe-accent", 2.25);
    edge.renderOrder = 3;
    plane.add(sheetMesh, edge);

    // The frame on screen: ink, 3.25 px, over the highlight glow.
    const glow = fatLines(ctx, [], "--ambe-highlight-glow", 9, { depthTest: false });
    const current = fatLines(ctx, [], "--ambe-plot-ink", 3.25, { depthTest: false });
    const g = glow.material;
    g.transparent = true;
    g.depthWrite = false;
    g.stencilWrite = true;
    g.stencilRef = 1;
    g.stencilFunc = T.NotEqualStencilFunc;
    g.stencilZPass = T.ReplaceStencilOp;
    glow.userData.recolour = () => {
      g.blending = darkGround() ? T.AdditiveBlending : T.NormalBlending;
      glow.visible = !printing();
    };
    glow.userData.recolour();
    glow.renderOrder = 13;
    current.renderOrder = 14;
    // Transparent, so they draw in the same pass as the highlight and after
    // it: the frame line and its dots are never under the coral.
    current.material.transparent = true;
    const points = (/** @type {number} */ size, /** @type {boolean} */ colours) => new T.PointsMaterial({
      size, sizeAttenuation: false, map: disc, alphaTest: 0.4, vertexColors: colours, depthTest: false, fog: false,
    });
    const ring = new T.Points(geometry(8), ctx.paint(points(RING_PX, false), "--ambe-plot-ink"));
    const dots = new T.Points(geometry(8, 3), points(DOT_PX, true));
    ring.renderOrder = 20;
    dots.renderOrder = 21;
    for (const object of [ring, dots]) object.material.transparent = true;

    // The subject: the threshold across the frame on screen. The kit draws
    // a curve in a plane of constant z; turned a quarter round y, its plane
    // is the frame's slice (local x is -z, local z is x). Its outline is
    // the segment itself (no baseline): the stems below tie it to the frame.
    const kit = addHighlight(ctx, [-bandZ(0), 0, 0, -bandZ(7), 0, 0], { fill: false });
    kit.rotation.y = Math.PI / 2;
    // A dashed stem from each band's dot straight to the threshold, so the
    // gap between the frame line and the highlight reads as height.
    const stems = fatLines(ctx, [], "--ambe-plot-ink", 1.25, { dashed: true, dash: 0.035, gap: 0.03, depthTest: false });
    stems.material.transparent = true;
    stems.renderOrder = 12;
    const chip = createChip(frame, ctx, { text: "", at: [0, 0, 0] });
    ctx.track({ dispose: chip.dispose });
    // Placed on every draw, so the chip follows the camera and the zoom.
    current.frustumCulled = false;
    current.onBeforeRender = () => placeChip();

    for (const object of [cells, hatch, curtains, ridges]) {
      /** @type {import("three").Material} */ (object.material).clippingPlanes = planes;
    }
    ctx.scene.add(cells, hatch, curtains, ridges, plane, kit, stems, glow, current, ring, dots);
    for (const object of [cells, curtains]) object.userData.recolour = () => write();
    fog(ctx, DISTANCE, FOG_DEPTH);
    const misted = ctx.scene.userData.recolour;
    ctx.scene.userData.recolour = () => {
      misted();
      recede();
    };
    parts = { ridges, curtains, cells, hatch, plane, glow, current, dots, ring, kit, stems, chip };
    builds += 1;
    if (ready) {
      write();
      look();
    }
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: scene.label,
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) return null;
  const T = ctx.three;

  /* -------------------------------------------------------------------------
   * Writing the buffers from the scene, the reveal and the threshold drawn
   * ---------------------------------------------------------------------- */

  const colour = new T.Color();
  /** Linear RGB of 0xRRGGBB. @param {number} hex */
  const rgb = (hex) => colour.setHex(hex).toArray();
  /** @param {import("three").BufferGeometry} g @param {Float32Array} positions @param {Float32Array | null} colours @param {number} size */
  const fill = (g, positions, colours, size = 3) => {
    g.setAttribute("position", new T.BufferAttribute(positions, 3));
    if (colours) g.setAttribute("color", new T.BufferAttribute(colours, size));
    g.computeBoundingSphere();
  };
  /** @param {number} i @param {number} n */
  const frameX = (i, n) => -X_HALF + (2 * X_HALF * i) / Math.max(1, n - 1);

  /** Where the reveal has reached: two clip planes either side of the
   *  frame on screen, which grow apart along time. Moving them is all the
   *  growth costs. */
  const clip = () => {
    const n = scene.frames.length;
    const x = frameX(scene.index, n);
    const far = reveal >= 1 ? 100 : reveal * (2 * X_HALF + 0.2) + 1e-3;
    planes[0].constant = -(x - far);
    planes[1].constant = x + far;
    ctx.requestRender();
  };

  const write = () => {
    if (!parts || !ready) return;
    const p = parts;
    const { frames, index } = scene;
    const n = frames.length;
    const t = shown;
    const dark = darkGround();
    const bg = tokenHex("--ambe-plot-bg");
    const ground = tokenHex("--ambe-3d-floor");
    const voiced = tokenHex("--ambe-voiced");
    const unvoiced = tokenHex("--ambe-unvoiced");
    const silent = tokenHex("--ambe-plot-muted");
    const curtainMix = dark ? CURTAIN_MIX.dark : CURTAIN_MIX.light;
    // From above in light, the floor is the map at its tokens' full colour:
    // no fade by distance, and dimmed by level to 60% at most.
    const map = overhead && !dark;
    const isSilent = (/** @type {number} */ i) => frames[i].decoded_rms_dbfs < SILENT_DBFS;
    // lib/style.js fade(), by distance from the frame on screen: none
    // within FADE_FRAMES, then one fade step per FADE_FRAMES. The amounts
    // are read once per whole frame of distance, and the colours mixed here,
    // since fade() reads the tokens on every call.
    /** @type {Map<number, number>} */
    const amounts = new Map();
    /** @param {number} hex @param {number} x frame position */
    const fade = (hex, x) => {
      const d = Math.round(Math.abs(x - index));
      let a = amounts.get(d);
      if (a === undefined) {
        a = fadeAmount(1 + Math.max(0, d - FADE_FRAMES) / FADE_FRAMES);
        amounts.set(d, a);
      }
      return a && !map ? mix(hex, bg, a) : hex;
    };
    // Every frame but the one on screen recedes once the opening has grown
    // the clip out (to about a third of its strength), so the frame's row
    // and the threshold across it read against the field, not inside it.
    /** @param {number} hex @param {number} x0 @param {number} x1 */
    const aside = (hex, x0, x1) =>
      context > 0 && (Math.max(x0, x1) <= index - 1 + 1e-9 || Math.min(x0, x1) >= index + 1 - 1e-9)
        ? mix(hex, bg, ASIDE * context) : hex;

    // Ridges, cut where they cross the threshold, and the curtains under them.
    /** @type {number[]} */
    const seg = [];
    /** @type {number[]} */
    const segColour = [];
    /** @type {number[]} */
    const wall = [];
    /** @type {number[]} */
    const wallColour = [];
    /** @type {{kind: string, v0: number, v1: number}[]} */
    const kinds = [];
    /**
     * @param {number} x0 frame position @param {number} v0 @param {number} x1 @param {number} v1
     * @param {number} z @param {number} hex
     */
    const piece = (x0, v0, x1, v1, z, hex) => {
      kinds.push({ kind: hex === voiced ? "voiced" : hex === unvoiced ? "unvoiced" : "silent", v0, v1 });
      const c = aside(fade(hex, (x0 + x1) / 2), x0, x1);
      const wx0 = frameX(x0, n);
      const wx1 = frameX(x1, n);
      const y0 = v0 * Y_SCALE;
      const y1 = v1 * Y_SCALE;
      seg.push(wx0, y0, z, wx1, y1, z);
      segColour.push(c, c);
      const top = rgb(mix(c, bg, curtainMix));
      const foot = rgb(mix(ground, bg, 0.3));
      wall.push(wx0, 0, z, wx1, 0, z, wx1, y1, z, wx0, 0, z, wx1, y1, z, wx0, y0, z);
      wallColour.push(...foot, ...foot, ...top, ...foot, ...top, ...top);
    };
    for (let b = 0; b < 8; b += 1) {
      const z = bandZ(b);
      for (let i = 0; i + 1 < n; i += 1) {
        const v0 = frames[i].band_voicing[b];
        const v1 = frames[i + 1].band_voicing[b];
        if (isSilent(i) && isSilent(i + 1)) {
          piece(i, v0, i + 1, v1, z, silent);
          continue;
        }
        const up0 = v0 >= t - 1e-9;
        const up1 = v1 >= t - 1e-9;
        if (up0 === up1) {
          piece(i, v0, i + 1, v1, z, up0 ? voiced : unvoiced);
          continue;
        }
        const s = i + (t - v0) / (v1 - v0);
        piece(i, v0, s, t, z, up0 ? voiced : unvoiced);
        piece(s, t, i + 1, v1, z, up1 ? voiced : unvoiced);
      }
    }
    ridgeColours = segColour;
    ridgeKinds = kinds;
    setSegments(p.ridges, seg.length ? seg : [0, 0, 0, 0, 0, 0]);
    if (!seg.length) ridgeColours = [bg, bg];
    p.ridges.userData.recolour?.();
    // From above the ridges are streaks across the map: they go.
    p.ridges.visible = seg.length > 0 && !overhead;
    fill(p.curtains.geometry, Float32Array.from(wall), Float32Array.from(wallColour));

    // The floor: each cell in its colour, toward the floor by level, so
    // silence reads as silence; the unvoiced ones also hatched.
    /** @type {number[]} */
    const cell = [];
    /** @type {number[]} */
    const cellColour = [];
    /** @type {number[]} */
    const stripe = [];
    /** @type {number[]} */
    const stripeUV = [];
    const half = X_HALF / Math.max(1, n - 1);
    for (let i = 0; i < n; i += 1) {
      const level = Math.min(1, Math.max(0.04, (frames[i].decoded_rms_dbfs + 65) / 40));
      const x0 = Math.max(-X_HALF, frameX(i, n) - half);
      const x1 = Math.min(X_HALF, frameX(i, n) + half);
      for (let b = 0; b < 8; b += 1) {
        const on = frames[i].band_voicing[b] >= t - 1e-9;
        const dim = map ? Math.min(0.4, 1 - level) : 1 - level * 0.9;
        const c = rgb(mix(fade(on ? voiced : unvoiced, i), ground, dim));
        const za = bandZ(b) - 0.15;
        const zb = bandZ(b) + 0.15;
        const quad = [x0, 0, za, x1, 0, za, x1, 0, zb, x0, 0, za, x1, 0, zb, x0, 0, zb];
        cell.push(...quad);
        for (let v = 0; v < 6; v += 1) cellColour.push(...c);
        if (!on && !isSilent(i)) {
          stripe.push(...quad.map((value, k) => (k % 3 === 1 ? 0.001 : value)));
          for (let v = 0; v < 6; v += 1) stripeUV.push(quad[v * 3] * HATCH_PER_UNIT, quad[v * 3 + 2] * HATCH_PER_UNIT);
        }
      }
    }
    fill(p.cells.geometry, Float32Array.from(cell), Float32Array.from(cellColour));
    fill(p.hatch.geometry, Float32Array.from(stripe), null);
    const hatchMaterial = /** @type {import("three").MeshBasicMaterial} */ (p.hatch.material);
    hatchMaterial.color.setHex(tokenHex(map ? "--ambe-plot-ink" : "--ambe-plot-bg"));
    hatchMaterial.opacity = map ? 0.2 : 0.6;
    p.hatch.geometry.setAttribute("uv", new T.BufferAttribute(Float32Array.from(stripeUV), 2));

    // The frame on screen: its line, its dots, and the threshold across it.
    const x = frameX(index, n);
    const v = frames[index].band_voicing;
    /** @type {number[]} */
    const line = [];
    for (let b = 0; b + 1 < 8; b += 1) line.push(x, v[b] * Y_SCALE, bandZ(b), x, v[b + 1] * Y_SCALE, bandZ(b + 1));
    for (const object of [p.glow, p.current]) setSegments(object, line);
    const dot = new Float32Array(24);
    const dotColour = new Float32Array(24);
    let above = 0;
    dotHexes = [];
    for (let b = 0; b < 8; b += 1) {
      dot.set([x, v[b] * Y_SCALE, bandZ(b)], b * 3);
      const on = v[b] >= t - 1e-9;
      if (on) above += 1;
      dotHexes.push(on ? voiced : unvoiced);
      dotColour.set(rgb(on ? voiced : unvoiced), b * 3);
    }
    fill(p.dots.geometry, dot, dotColour);
    fill(p.ring.geometry, Float32Array.from(dot), null);
    const y = t * Y_SCALE;
    p.plane.position.y = y;
    p.kit.set([-bandZ(0) - 0.08, y, x, -bandZ(7) + 0.08, y, x]);
    /** @type {number[]} */
    const stem = [];
    for (let b = 0; b < 8; b += 1) {
      if (Math.abs(v[b] - t) * Y_SCALE > 0.02) stem.push(x, v[b] * Y_SCALE, bandZ(b), x, y, bandZ(b));
    }
    setSegments(p.stems, stem.length ? stem : [x, y, bandZ(0), x, y, bandZ(0)]);
    // Anchored at the far (band 8) end of the highlight; placeChip() moves
    // the box into free stage and the leader comes back to this point.
    p.chip.set({
      text: `threshold ${t.toFixed(2)}: ${above} of 8 ${scene.compact ? "above" : "bands above"}`,
      at: [x, y, bandZ(7) - 0.08],
    });
    // chip.set placed it beside its anchor; into free stage now, not only
    // on the next draw (a frame off screen draws nothing).
    placeChip();
    clip();
  };

  /* -------------------------------------------------------------------------
   * Labels, and the fit
   * ---------------------------------------------------------------------- */

  const labels = createLabels(frame, ctx);
  /** @type {import("./lib/labels.js").Label[]} */
  let labelList = [];
  let labelKey = "";

  /** Each label's width in px, plus a gap. */
  const labelWidths = () => {
    const nodes = Array.from(frame.querySelectorAll(".anim-figure__label"));
    return labelList.map((_, k) => {
      const node = nodes[k];
      // Measured even while hidden: a label the last fit pushed out would
      // otherwise ask for no room, and stay out.
      let width = 0;
      if (node instanceof HTMLElement) {
        const was = node.hidden;
        node.hidden = false;
        width = node.offsetWidth + 14;
        node.hidden = was;
      }
      return width;
    });
  };

  const relabel = () => {
    const compact = scene.compact;
    const low = compact ? "band 1\n0-0.5k" : "band 1\n0-500 Hz";
    const high = compact ? "band 8\n3.5-4k" : "band 8\n3.5-4 kHz";
    const pose = orbit?.pose() ?? PRESETS[scene.preset] ?? PRESETS.corner;
    /** @type {import("./lib/labels.js").Label[]} */
    const list = Math.abs(pose.yaw - 90) < 20 && pose.pitch < 20
      ? [
          { text: low, at: [X_HALF, -0.12, bandZ(0)], align: "middle" },
          { text: high, at: [X_HALF, -0.12, bandZ(7)], align: "middle" },
        ]
      : pose.pitch > 70
        ? [
            { text: low, at: [-X_HALF - 0.14, 0, bandZ(0)], align: "end" },
            { text: high, at: [-X_HALF - 0.14, 0, bandZ(7)], align: "end" },
            ...(compact ? [] : [{ text: "time →", at: /** @type {[number, number, number]} */ ([0, 0, bandZ(0) + 0.32]), align: /** @type {const} */ ("middle") }]),
          ]
        : pose.yaw >= 0
          ? [
              // Corner: band 1's row starts at the floor's left corner and
              // band 8's ends at its right one. On a phone the labels hang
              // under those corners, so the scene can take the width.
              compact
                ? { text: low, at: [-X_HALF, 0, bandZ(0)], align: "middle", dy: 24 }
                : { text: low, at: [-X_HALF - 0.14, 0, bandZ(0)], align: "end" },
              compact
                ? { text: high, at: [X_HALF, 0, bandZ(7)], align: "middle", dy: 28 }
                : { text: high, at: [X_HALF + 0.14, 0, bandZ(7)], align: "start" },
              ...(compact ? [] : [{ text: "time →", at: /** @type {[number, number, number]} */ ([-0.1 * X_HALF, 0, bandZ(0) + 0.36]), align: /** @type {const} */ ("middle") }]),
            ]
          : [
              // Turned the other way by hand: band 1 at the right end of its row.
              { text: low, at: [X_HALF + 0.14, 0, bandZ(0)], align: "start" },
              { text: high, at: [-X_HALF - 0.14, 0, bandZ(7)], align: "end" },
            ];
    const key = JSON.stringify(list);
    if (key === labelKey) return false;
    labelKey = key;
    labelList = list;
    labels.set(list);
    return true;
  };

  const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
  const v3 = new T.Vector3();
  /** Camera-space x, y of a scene point. @param {number} x @param {number} y @param {number} z */
  const view = (x, y, z) => {
    v3.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    return { u: v3.x, v: v3.y };
  };

  /**
   * The frustum that fills the frame with the scene and keeps the labels
   * clear of the bottom strip and the sides.
   * @param {number} W @param {number} H
   */
  const autoFit = (W, H) => {
    /** Offsets from the frame's centre at H/2 px per unit: x right, y down. */
    const off = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
      const { u, v } = view(x, y, z);
      return { x: (u * H) / 2, y: (-v * H) / 2 };
    };
    /** @type {{x: number, y: number}[]} */
    const corners = [];
    for (const x of [-X_HALF - 0.1, X_HALF + 0.1]) {
      for (const y of [0, Y_SCALE]) {
        for (const z of [bandZ(0) + 0.14, bandZ(7) - 0.14]) corners.push(off(x, y, z));
      }
    }
    const anchors = labelList.map(({ at: [x, y, z] }) => off(x, y, z));
    const widths = labelWidths();
    const minX = Math.min(...corners.map((q) => q.x));
    const maxX = Math.max(...corners.map((q) => q.x));
    const minY = Math.min(...corners.map((q) => q.y));
    const maxY = Math.max(...corners.map((q) => q.y));
    const margin = Math.round(Math.min(W, H) * 0.05);
    // Each bound is "screen = shift + zoom * at" against an edge: the scene
    // inside the margins, a label's far end inside the frame, the label
    // anchors above the bottom strip. A lower and an upper bound together
    // limit the zoom; the shift then sits midway in what is left.
    /** @param {{edge: number, at: number}[]} lows @param {{edge: number, at: number}[]} highs @param {number} zoom */
    const solve = (lows, highs, zoom) => {
      for (const lo of lows) {
        for (const hi of highs) {
          if (hi.at > lo.at) zoom = Math.min(zoom, (hi.edge - lo.edge) / (hi.at - lo.at));
        }
      }
      return zoom;
    };
    const xLows = [{ edge: margin, at: minX }];
    const xHighs = [{ edge: W - margin, at: maxX }];
    labelList.forEach((label, k) => {
      const w = widths[k] ?? 0;
      const at = anchors[k].x;
      const frac = label.align === "end" ? 1 : label.align === "middle" ? 0.5 : 0;
      xLows.push({ edge: margin + frac * w, at });
      xHighs.push({ edge: W - margin - (1 - frac) * w, at });
    });
    // Room above the plane and the frame for the chip, which placeChip()
    // puts in free stage there.
    const chipH = (parts?.chip.node.offsetHeight || 24) + CHIP_GAP;
    const ty = shown * Y_SCALE;
    const fx = frameX(scene.index, scene.frames.length);
    const tops = scene.frames[scene.index].band_voicing.map((s, b) => off(fx, s * Y_SCALE, bandZ(b)).y);
    for (const x of [-X_HALF - 0.1, X_HALF + 0.1]) {
      for (const z of [bandZ(0) + 0.14, bandZ(7) - 0.14]) tops.push(off(x, ty, z).y);
    }
    const yLows = [{ edge: margin, at: minY }, { edge: margin + chipH, at: Math.min(...tops) }];
    const yHighs = [{ edge: H - margin, at: maxY }];
    // A label's anchor, moved by its dy in px, far enough above the bottom
    // strip and below the top that a two-line label clears both.
    labelList.forEach((label, k) => {
      const dy = label.dy ?? 0;
      yLows.push({ edge: 16 - dy, at: anchors[k].y });
      yHighs.push({ edge: H - BOTTOM_STRIP - 18 - dy, at: anchors[k].y });
    });
    const zoom = Math.max(0.05, solve(yLows, yHighs, solve(xLows, xHighs, Infinity)));
    /** @param {{edge: number, at: number}[]} lows @param {{edge: number, at: number}[]} highs @param {number} size */
    const shift = (lows, highs, size) =>
      (Math.max(...lows.map((lo) => lo.edge - zoom * lo.at)) + Math.min(...highs.map((hi) => hi.edge - zoom * hi.at))) / 2 - size / 2;
    const sx = shift(xLows, xHighs, W);
    const sy = shift(yLows, yHighs, H);
    const k = (zoom * H) / 2;
    const L = -(W / 2 + sx) / k;
    const Tp = (H / 2 + sy) / k;
    return { left: L, right: L + W / k, top: Tp, bottom: Tp - H / k };
  };

  /**
   * At Side, the frustum that puts the bands where the One frame view puts
   * them (the 2D band centres), so the view the animation starts from lines
   * up with the 2D one. That match is in band position only: strength 0 to
   * 1 is laid on the 2D spectrum's height as a teaching choice (the One
   * frame view draws strength as bars in its chips, not as height).
   * matchPlot handles only the Front pose, so this is its own fit.
   */
  const sideFit = () => {
    const { xs, top, bottom } = scene.side;
    const x = frameX(scene.index, scene.frames.length);
    const a = view(x, 0, bandZ(0));
    const b = view(x, Y_SCALE, bandZ(7));
    const sx = (xs[7] - xs[0]) / (b.u - a.u || 1e-6);
    const sy = (bottom - top) / (b.v - a.v || 1e-6);
    const L = a.u - xs[0] / sx;
    const Tp = b.v + top / sy;
    return { left: L, right: L + frame.clientWidth / sx, top: Tp, bottom: Tp - frame.clientHeight / sy };
  };

  const pv = new T.Vector3();
  /** CSS px in a W by H frame of a scene point. @param {number} x @param {number} y @param {number} z @param {number} W @param {number} H */
  const toPx = (x, y, z, W, H) => {
    pv.set(x, y, z).project(camera);
    return [((pv.x + 1) / 2) * W, ((1 - pv.y) / 2) * H];
  };

  /**
   * The chip in free stage: lib/labels.js places it beside its anchor (or
   * pins it at an edge when the anchor is out of view); this moves the box
   * to the spot that covers least of the floor, the plane and the frame's
   * dots, and no label, with a short leader. The leader still runs to the
   * anchor dot.
   */
  placeChip = () => {
    if (!parts) return;
    const { chip } = parts;
    chip.update();
    const layer = chip.node.parentElement;
    const line = layer?.querySelector("line");
    if (!layer || !line || layer.classList.contains("anim-chip-layer--pinned")) return;
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    const bw = chip.node.offsetWidth;
    const bh = chip.node.offsetHeight;
    if (!W || !H || !bw) return;
    camera.updateMatrixWorld();
    const ax = Number(line.getAttribute("x1"));
    const ay = Number(line.getAttribute("y1"));
    const x = frameX(scene.index, scene.frames.length);
    const ty = shown * Y_SCALE;
    const dots = scene.frames[scene.index].band_voicing.map((v, b) => toPx(x, v * Y_SCALE, bandZ(b), W, H));
    const points = [...dots];
    for (const px of [-X_HALF - 0.1, X_HALF + 0.1]) {
      for (const pz of [bandZ(0) + 0.14, bandZ(7) - 0.14]) points.push(toPx(px, 0, pz, W, H), toPx(px, ty, pz, W, H));
    }
    const hull = convexHull(points);
    const r = DOT_PX;
    const near = {
      left: Math.min(...dots.map((d) => d[0])) - r, right: Math.max(...dots.map((d) => d[0])) + r,
      top: Math.min(...dots.map((d) => d[1])) - r, bottom: Math.max(...dots.map((d) => d[1])) + r,
    };
    const origin = frame.getBoundingClientRect();
    const boxes = Array.from(frame.querySelectorAll(".anim-figure__label"))
      .filter((n) => n instanceof HTMLElement && !n.hidden)
      .map((n) => {
        const b = n.getBoundingClientRect();
        return { left: b.left - origin.left, right: b.right - origin.left, top: b.top - origin.top, bottom: b.bottom - origin.top };
      });
    boxes.push(near);
    /** @param {number} v @param {number} lo @param {number} hi */
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const G = CHIP_GAP;
    const E = CHIP_EDGE;
    const lowest = H - BOTTOM_STRIP - bh;
    /** @type {number[][]} */
    const spots = [[G, -G - bh], [-G - bw, -G - bh], [-bw / 2, -G - bh], [G, G], [-G - bw, G], [-bw / 2, G], [G, -bh / 2], [-G - bw, -bh / 2]]
      .map(([dx, dy]) => [ax + dx, ay + dy]);
    for (let k = 0; k <= 8; k += 1) {
      const left = E + ((W - 2 * E - bw) * k) / 8;
      spots.push([left, E], [left, ay - G - bh], [left, ay + G]);
    }
    let best = [ax + G, ay - G - bh];
    let bestScore = Infinity;
    for (const [l, t] of spots) {
      const left = clamp(l, E, W - E - bw);
      const top = clamp(t, E, Math.max(E, lowest));
      let score = 0;
      for (let i = 0; i <= 6; i += 1) {
        // Over the dimmed field a chip costs little; a long leader costs more.
        for (let j = 0; j <= 2; j += 1) if (insideHull(hull, left + (bw * i) / 6, top + (bh * j) / 2)) score += 12;
      }
      for (const b of boxes) {
        if (b.left < left + bw && b.right > left && b.top < top + bh && b.bottom > top) score += b === near ? 50000 : 20000;
      }
      score += 4 * Math.hypot(clamp(ax, left, left + bw) - ax, clamp(ay, top, top + bh) - ay);
      if (score < bestScore) {
        bestScore = score;
        best = [left, top];
      }
    }
    const [left, top] = best;
    chip.node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    line.setAttribute("x2", clamp(ax, left, left + bw).toFixed(1));
    line.setAttribute("y2", clamp(ay, top, top + bh).toFixed(1));
  };

  /** @type {import("./lib/orbit.js").Orbit | null} */
  let orbit = null;
  const fit = () => {
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    camera.updateMatrixWorld();
    const pose = orbit?.pose() ?? PRESETS[scene.preset] ?? PRESETS.corner;
    const auto = autoFit(W, H);
    // Near Side the two fits blend, so a turn away from it never jumps.
    const w = Math.min(1, Math.hypot(pose.yaw - 90, pose.pitch) / 30);
    const side = w < 1 ? sideFit() : auto;
    camera.left = side.left + (auto.left - side.left) * w;
    camera.right = side.right + (auto.right - side.right) * w;
    camera.top = side.top + (auto.top - side.top) * w;
    camera.bottom = side.bottom + (auto.bottom - side.bottom) * w;
  };

  /**
   * Fog tells depth; from above the whole floor is one depth, and the fog
   * would only wash the map out. It recedes past the floor as the view
   * tips over (lib/style.js fog sets it again on a theme change).
   */
  recede = () => {
    const f = ctx.scene.fog;
    if (!f || !("near" in f)) return;
    const k = Math.max(0, Math.min(1, ((orbit?.pose().pitch ?? 0) - 60) / (OVERHEAD - 60)));
    f.near = DISTANCE - 0.4 * FOG_DEPTH + k * 20;
    f.far = DISTANCE + 0.9 * FOG_DEPTH + k * 20;
  };

  /** From above the floor is the map: the curtains, edge on, go, and the
   *  plane thins so the map reads through it. */
  const look = () => {
    if (!parts) return;
    const pitch = orbit?.pose().pitch ?? 0;
    parts.curtains.visible = pitch < OVERHEAD;
    const sheet = /** @type {import("three").Mesh} */ (parts.plane.children[0]);
    /** @type {import("three").MeshBasicMaterial} */ (sheet.material).opacity = 0.18 * (1 - 0.7 * Math.max(0, (pitch - 45) / 45));
    // From above, the highlight would lie on the frame line: it moves
    // beside it, a few px later in time.
    const k = Math.max(0, Math.min(1, (pitch - 60) / (OVERHEAD - 60)));
    const perPx = (camera.right - camera.left) / ((camera.zoom || 1) * (frame.clientWidth || 1));
    parts.kit.position.x = k * TOP_OFFSET_PX * perPx;
    recede();
    if (overhead !== pitch > OVERHEAD) {
      overhead = pitch > OVERHEAD;
      write();
    }
  };

  const start = PRESETS[scene.preset] ? scene.preset : "corner";
  orbit = createOrbit(ctx, {
    target: TARGET, distance: DISTANCE, zoom: opts.look.zoom || 1, presets: PRESETS, start, fit,
    onDrag: opts.onDrag,
    onChange: () => {
      if (relabel()) {
        // The new labels ask for their own room: fit again, and apply it
        // (orbit has already applied the fit it made with the old ones).
        fit();
        camera.updateProjectionMatrix();
      }
      labels.update();
      look();
    },
  });
  const turn = orbit;
  const timeline = ctx.timeline();
  ready = true;
  relabel();
  write();
  look();
  // The labels are measured once they are in the page.
  requestAnimationFrame(() => {
    fit();
    turn.set(turn.pose());
  });

  /* -------------------------------------------------------------------------
   * Animations
   * ---------------------------------------------------------------------- */

  /**
   * One frame is one row of the whole clip: Side, the frame alone; then the
   * turn to Corner while everything grows out along time from it.
   * @param {{build?: boolean}} [o] build: wait until the frame is half visible
   * @returns {Promise<void>}
   */
  const enter = ({ build: waits = false } = {}) => {
    ctx.finish();
    played += 1;
    const from = PRESETS.side;
    const to = PRESETS.corner;
    turn.set(from);
    reveal = 0;
    trace = [];
    clip();
    const runs = [
      timeline.play("turn", {
        ms: duration("3d-camera") || 700, delay: HOLD_MS, ease: "inout", build: waits,
        step: (t) => turn.set({ yaw: from.yaw + (to.yaw - from.yaw) * t, pitch: from.pitch + (to.pitch - from.pitch) * t }),
      }),
      // Linear: the rows spread along time at a steady pace.
      timeline.play("grow", {
        ms: duration("3d-build") || 900, delay: HOLD_MS, build: waits, ease: "linear",
        step: (t) => {
          reveal = t;
          if (TEST_HOOK) trace.push([reveal, turn.pose().yaw]);
          clip();
        },
      }),
    ];
    context = 0;
    return Promise.all(runs).then(() => {
      // Reset view returns to Corner from here.
      if (!prefersReducedMotion()) void turn.go("corner");
      // Then the other frames step back, leaving the frame and its cut.
      return timeline.play("aside", {
        ms: duration("slow") || 420, ease: "inout",
        step: (t) => {
          context = t;
          write();
        },
      });
    }).then(() => undefined);
  };

  /** The threshold slides to the scene's, recolouring as it passes. */
  const wave = () => {
    const from = shown;
    const to = scene.threshold;
    return timeline.play("wave", {
      ms: WAVE_MS, ease: "linear",
      step: (t) => {
        shown = t === 1 ? to : from + (to - from) * t;
        write();
      },
    });
  };

  /** @type {VoicingView} */
  const link = {
    enter,
    preset: (name) => turn.go(name),
    // The highlight and the frame line's glow pulse together.
    pulse: () => {
      if (!parts || prefersReducedMotion()) return;
      void parts.kit.pulse();
      const g = parts.glow.material;
      const rest = g.opacity;
      void timeline.play("frame-pulse", {
        ms: duration("slow") || 400,
        step: (t) => {
          g.opacity = t === 1 ? rest : rest * (1 + Math.sin(Math.PI * t));
        },
      });
    },
    finish: () => ctx.finish(),
  };
  scene.link.view = link;

  let describeTimer = 0;
  const describe = () => {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      ctx.renderer?.domElement.setAttribute("aria-label", scene.label);
    }, 250);
  };

  if (opts.intro) {
    // The first frame (shaders compiled, buffers sent) is drawn at the
    // start pose; the animation starts after it, so a slow first draw does
    // not eat its first half.
    turn.set(PRESETS.side);
    reveal = 0;
    context = 0;
    clip();
  }

  if (TEST_HOOK) {
    TEST_HOOK.figures["voicing-3d"] = {
      get builds() {
        return builds;
      },
      pose: () => turn.pose(),
      zoom: () => turn.zoom(),
      get played() {
        return played;
      },
      get reveal() {
        return reveal;
      },
      get trace() {
        return trace;
      },
      get shown() {
        return shown;
      },
      /** The frame on screen's eight band points, scene units. */
      get frontPoints() {
        const x = frameX(scene.index, scene.frames.length);
        return scene.frames[scene.index].band_voicing.map((v, b) => [x, v * Y_SCALE, bandZ(b)]);
      },
      /** The same points projected to CSS px of the frame by the camera now. */
      get frontPx() {
        camera.updateMatrixWorld();
        const x = frameX(scene.index, scene.frames.length);
        return scene.frames[scene.index].band_voicing.map((v, b) => {
          const p = new T.Vector3(x, v * Y_SCALE, bandZ(b)).project(camera);
          return [((p.x + 1) / 2) * frame.clientWidth, ((1 - p.y) / 2) * frame.clientHeight];
        });
      },
      /** Ridge segments by kind, and the extreme heights of each kind, in strength units. */
      get ridges() {
        const out = { voiced: 0, unvoiced: 0, silent: 0, minVoicedY: Infinity, maxUnvoicedY: -Infinity };
        for (const { kind, v0, v1 } of ridgeKinds) {
          if (kind === "voiced") out.minVoicedY = Math.min(out.minVoicedY, v0, v1);
          if (kind === "unvoiced") out.maxUnvoicedY = Math.max(out.maxUnvoicedY, v0, v1);
          out[/** @type {"voiced" | "unvoiced" | "silent"} */ (kind)] += 1;
        }
        return out;
      },
      get segments() {
        return ridgeKinds.length;
      },
      get planeY() {
        return parts ? parts.plane.position.y / Y_SCALE : null;
      },
      get chip() {
        return parts ? parts.chip.node.textContent : "";
      },
      /** The chip's box and the box round the frame's dots, px of the frame. */
      get chipBox() {
        if (!parts) return null;
        const o = frame.getBoundingClientRect();
        const b = parts.chip.node.getBoundingClientRect();
        return { left: b.left - o.left, right: b.right - o.left, top: b.top - o.top, bottom: b.bottom - o.top };
      },
      /** The chip's leader, CSS px from its anchor to the box. */
      get leader() {
        const line = parts?.chip.node.parentElement?.querySelector("line");
        if (!line) return null;
        const n = (/** @type {string} */ k) => Number(line.getAttribute(k));
        return Math.hypot(n("x2") - n("x1"), n("y2") - n("y1"));
      },
      get dotsBox() {
        camera.updateMatrixWorld();
        const W = frame.clientWidth;
        const H = frame.clientHeight;
        const x = frameX(scene.index, scene.frames.length);
        const d = scene.frames[scene.index].band_voicing.map((v, b) => toPx(x, v * Y_SCALE, bandZ(b), W, H));
        const r = DOT_PX / 2;
        return {
          left: Math.min(...d.map((p) => p[0])) - r, right: Math.max(...d.map((p) => p[0])) + r,
          top: Math.min(...d.map((p) => p[1])) - r, bottom: Math.max(...d.map((p) => p[1])) + r,
        };
      },
      /** The plane's four corners, px of the frame. */
      get planePx() {
        camera.updateMatrixWorld();
        const W = frame.clientWidth;
        const H = frame.clientHeight;
        /** @type {number[][]} */
        const out = [];
        for (const x of [-X_HALF - 0.1, X_HALF + 0.1]) {
          for (const z of [bandZ(0) + 0.14, bandZ(7) - 0.14]) out.push(toPx(x, shown * Y_SCALE, z, W, H));
        }
        return out;
      },
      /** The frustum at zoom 1, for the fit tests. */
      get frustum() {
        return [camera.left, camera.right, camera.top, camera.bottom];
      },
      get dotHexes() {
        return dotHexes;
      },
      get labels() {
        return Array.from(frame.querySelectorAll(".anim-figure__label")).map((n) => n.textContent);
      },
      get objects() {
        return ctx.scene.children.length;
      },
      get three() {
        return ctx;
      },
    };
  }

  const close = () => {
    clearTimeout(describeTimer);
    if (scene.link.view === link) scene.link.view = null;
    labels.dispose();
    if (TEST_HOOK) delete TEST_HOOK.figures["voicing-3d"];
    ctx.dispose();
  };

  // The first draw waits for the frame to be on screen; a reader who has
  // left 3D by then gets the context back at once: the 2D module calls
  // link.leave when it leaves, the figure's signal aborts when it unmounts,
  // and a slow check covers any other way out.
  let drawn = false;
  const first = ctx.drawn().then(() => {
    drawn = true;
  });
  /** @type {() => void} */
  let wake = () => {};
  const leave = () => wake();
  opts.signal.addEventListener("abort", leave, { once: true });
  scene.link.leave = leave;
  while (!drawn) {
    const woken = new Promise((resolve) => {
      wake = () => resolve(undefined);
    });
    await Promise.race([first, woken, new Promise((resolve) => setTimeout(resolve, 100))]);
    if (!drawn && (!opts.wanted() || opts.signal.aborted)) {
      if (scene.link.leave === leave) scene.link.leave = null;
      close();
      return null;
    }
  }
  if (scene.link.leave === leave) scene.link.leave = null;
  opts.signal.removeEventListener("abort", leave);
  describe();
  if (opts.intro) void enter({ build: true });
  return {
    update: (next) => {
      const s = /** @type {VoicingScene} */ (next);
      const rebuilt = s.key !== scene.key;
      const moved = s.threshold !== scene.threshold;
      scene = s;
      scene.link.view = link;
      if (rebuilt || !moved || prefersReducedMotion()) {
        if (rebuilt || moved) shown = s.threshold;
        if (relabel()) fit();
        write();
      } else {
        void wave();
      }
      describe();
    },
    preset: (name) => void turn.go(name),
    describe: () => scene.label,
    close,
  };
}
