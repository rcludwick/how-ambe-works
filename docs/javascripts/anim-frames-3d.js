// @ts-check
/* ===========================================================================
 * anim-frames-3d.js: the frames figure's 3D view (ch08), over the inset.
 * ---------------------------------------------------------------------------
 * Rows i-4 to i+4, one per frame, stacked in depth, later frames further
 * back. A row is the frame's 160 samples, or with Windows on its 255-sample
 * window (the samples times the Hamming weight, the window dashed), so
 * neighbouring rows overlap in time; the floor marks each row's footprint
 * and bridges the samples two windows share. Frame i's row wears the
 * highlight. Front folds the rows back onto the 2D inset: with Windows off,
 * rows i-1 to i+1 land on its samples, and there the two spans frame i's
 * window shares stand up as shaded bands, as on the inset, while the floor
 * strips lie edge-on. Every row has the inset's scale; a row louder than
 * the inset's three frames is squeezed smoothly to stay inside the box.
 *
 * The first view shows the point once: the rows slide back from the inset
 * into depth while the camera turns to the corner, then the windows grow
 * out of the frames and the shared strips light. A step can play the
 * slide again (state.replay), as the camera flies to its preset.
 *
 * Every array comes from anim-frames.js (rowsAround); this file only
 * places them. It reads no data and no audio.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { createLabels } from "./lib/labels.js";
import { FRONT, TOP, createOrbit, matchPlot } from "./lib/orbit.js";
import { contactShadow, darkGround, fade, fatLines, floor, fog, mix, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-frames.js").FramesState} FramesState */
/** @typedef {import("./anim-frames.js").Row} Row */
/** @typedef {import("./lib/orbit.js").Pose} Pose */

const N = 255; // points per row (WINDOW)
const ROWS = 9; // k = -4 to 4
const DZ = 0.8; // depth between rows
const Y0 = -1.12; // the floor, under the inset's lowest sample
const DIST = 14;
/** Half the depth of a row's footprint on the floor. */
const FOOT = 0.12;
/** The inset's 480 samples across, frame i's middle at x = 0. */
const BOX = /** @type {import("./lib/orbit.js").SceneBox} */ ({ min: [-2.4, -1, -DZ], max: [2.4, 1, DZ] });
/** @type {Record<string, Pose>} */
const PRESETS = { corner: { yaw: 28, pitch: 22 }, front: FRONT, top: TOP };
/** Rows the turned views keep in frame; the outer ones run off into the fog. */
const KEEP = 2;
/** Samples a window shares with the next, and the two spans frame i's window shares, from its start. */
const SHARED = N - 160;
const SPANS = [[-SHARED / 2, SHARED / 2], [160 - SHARED / 2, 160 + SHARED / 2]];
/** Turned this far (degrees) from Front, the standing bands are gone and the floor strips speak. */
const FRONT_FADE = 20;
/** Front's bands stand just in front of frame i's plane, over its fill. */
const BAND_Z = 0.01;
/** CSS px from the top of the frame: Front's first row of labels, and the second (the scale bar), as on the inset. */
const ROW_1 = 11;
const ROW_2 = 29;
/** Where the bar starts, samples from frame i's start: the inset's left edge, inside it. */
const BAR_U = -157;
/** Rows either side of frame i. */
const REACH = (ROWS - 1) / 2;
/** The shortest gap between two highlight pulses while playing, ms. */
const PULSE_EVERY = 900;

/** @param {number} u samples from frame i's start @returns {number} */
const sx = (u) => (u - 80) / 100;
/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let s = /** @type {FramesState} */ (opts.state);
  const intro = opts.intro;
  /** Animated amounts: each row's slide into depth, the frame-to-window morph, the shared strips. */
  const anim = { slide: new Array(ROWS).fill(intro ? 0 : 1), morph: !intro && s.windows ? 1 : 0, strips: !intro && s.windows ? 1 : 0 };
  const probe = {
    builds: 0, pose: /** @type {Pose | null} */ (null), zoom: 1, played: intro, replays: 0,
    /** How much Front's shared bands show, 0 to 1. */
    get bands() { return parts && parts.bands.visible ? parts.bands.material.opacity / (darkGround() ? 0.2 : 0.13) : 0; },
    get frontPoints() { return frontPoints(); },
    /** The largest |y| of any present row's vertex: the box holds |y| <= 1. */
    get maxY() {
      let m = 0;
      s.rows.forEach((row, r) => {
        if (row.present) for (let j = 0; j < N; j += 1) m = Math.max(m, Math.abs(at(r, j)[1]));
      });
      return m;
    },
  };
  if (TEST_HOOK) TEST_HOOK.figures["frames-3d"] = probe;

  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** 1 at Front, 0 from FRONT_FADE degrees off it: how much Front's bands show. */
  let frontness = intro || s.preset === "front" ? 1 : 0;
  let labelKey = "";
  let lastPulse = 0;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  /** The view's context: set by build(), which runs inside mountThree(). */
  /** @type {import("./anim-three.js").ThreeContext | null} */
  let view = null;
  /** @type {{rows: import("three/addons/lines/LineSegments2.js").LineSegments2, envelopes: import("three/addons/lines/LineSegments2.js").LineSegments2,
   *  feet: import("three").Mesh, strips: import("three").Mesh, stripEdges: import("three/addons/lines/LineSegments2.js").LineSegments2,
   *  bands: import("three").Mesh<import("three").BufferGeometry, import("three").MeshBasicMaterial>, bandEdges: import("three/addons/lines/LineSegments2.js").LineSegments2,
   *  bar: import("three/addons/lines/LineSegments2.js").LineSegments2,
   *  highlight: ReturnType<typeof addHighlight>} | null} */
  let parts = null;

  /**
   * Row r's point j in the scene, at the current morph and slide.
   * @param {number} r @param {number} j @returns {[number, number, number]}
   */
  const at = (r, j) => {
    const row = s.rows[r];
    const m = anim.morph;
    return [sx(lerp(row.frameU[j], row.windowU[j], m)), squeeze((lerp(row.frameV[j], row.windowV[j], m) * s.scale) / s.peak), -row.k * DZ * anim.slide[r]];
  };
  /**
   * The inset's scale up to s.scale (rows i-1 to i+1 never pass it), then a
   * smooth squeeze that never reaches 1, so a louder row stays in the box.
   * @param {number} y @returns {number}
   */
  const squeeze = (y) => {
    const a = s.scale;
    const m = Math.abs(y);
    return m <= a ? y : Math.sign(y) * (a + (1 - a) * Math.tanh((m - a) / (1 - a)));
  };
  /** Polyline to segment pairs. @param {number[][]} pts @param {number[]} out */
  const pairs = (pts, out) => {
    for (let j = 0; j + 1 < pts.length; j += 1) out.push(...pts[j], ...pts[j + 1]);
  };

  /** A quad on the floor, two triangles. */
  const quad = (/** @type {number[]} */ pos, /** @type {number} */ x0, /** @type {number} */ x1,
    /** @type {number} */ z0, /** @type {number} */ z1, /** @type {number} */ y) => {
    pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
  };

  const geometry = () => {
    /** @type {number[]} */ const rows = [];
    /** @type {number[]} */ const envelopes = [];
    /** @type {number[]} */ const feetPos = [];
    /** @type {number[]} */ const stripPos = [];
    /** @type {number[]} */ const stripEdges = [];
    /** @type {number[]} */ let mine = [];
    const env = anim.morph;
    s.rows.forEach((row, r) => {
      const pts = Array.from({ length: N }, (_, j) => at(r, j));
      // An absent row (before the clip starts or after it ends) hides under the floor.
      const hidden = !row.present;
      if (hidden) pts.forEach((p) => p.splice(0, 3, 0, Y0 - 1, 0));
      if (row.k === 0) mine = pts.flat();
      else pairs(pts, rows);
      const z = pts[0][2];
      for (const sign of [1, -1]) {
        const curve = Array.from({ length: N }, (_, j) => hidden ? [0, Y0 - 1, 0]
          : [sx(lerp(row.frameU[j], row.windowU[j], anim.morph)), sign * s.scale * lerp(1, s.weights[j], env), z]);
        pairs(curve, envelopes);
      }
      const x0 = sx(lerp(row.frameU[0], row.windowU[0], anim.morph));
      const x1 = sx(lerp(row.frameU[N - 1], row.windowU[N - 1], anim.morph));
      quad(feetPos, x0, x1, z - FOOT, z + FOOT, hidden ? Y0 - 1 : Y0 + 0.003);
      const next = s.rows[r + 1];
      if (next) {
        // Where this row's window and the next one's overlap, 95 samples: a
        // bridge from one footprint to the next.
        const a = sx(next.windowU[0]);
        const b = sx(row.windowU[N - 1]);
        const zn = -next.k * DZ * anim.slide[r + 1];
        const on = row.present && next.present && anim.strips > 0;
        const z0 = Math.min(z, zn) + FOOT;
        const z1 = Math.max(z0, Math.max(z, zn) - FOOT);
        const y = on ? Y0 + 0.001 : Y0 - 1;
        quad(stripPos, a, b, z0, z1, y);
        stripEdges.push(a, y, z0, b, y, z0, b, y, z0, b, y, z1, b, y, z1, a, y, z1, a, y, z1, a, y, z0);
      }
    });
    return { rows, envelopes, mine, feetPos, stripPos, stripEdges };
  };

  /** Per-vertex colours, read again on a theme change. */
  /** Token colours, read once per theme: a getComputedStyle per frame of an animation stalls it. */
  const readPalette = () => ({
    bg: tokenHex("--ambe-plot-bg"), floor: tokenHex("--ambe-3d-floor"), ink: tokenHex("--ambe-plot-ink"),
    fillTop: tokenHex("--ambe-highlight-fill-top"),
    // The samples two windows share: the inset's bands and the legend's swatch.
    shared: tokenHex("--ambe-cat-5"),
    // Frame i's own row is the highlight; its window is ink.
    row: s.rows.map((row, r) => (row.k === 0 ? tokenHex("--ambe-plot-ink") : fade(rampColor(s.tones[r]), row.k))),
  });
  let palette = readPalette();
  const rowColours = () => s.rows.flatMap((row, r) => (row.k === 0 ? [] : new Array((N - 1) * 2).fill(palette.row[r])));
  const envelopeColours = () => s.rows.flatMap((_, r) => new Array((N - 1) * 4).fill(mix(palette.row[r], palette.bg, 1 - anim.morph)));

  /** @param {import("three").Mesh} mesh @param {number[]} pos @param {(q: number) => number} colour */
  const fillMesh = (mesh, pos, colour) => {
    const T = /** @type {import("./anim-three.js").ThreeContext} */ (view).three;
    const c = new T.Color();
    const col = new Float32Array(pos.length);
    for (let q = 0; q < pos.length / 18; q += 1) {
      c.setHex(colour(q));
      for (let v = 0; v < 6; v += 1) col.set([c.r, c.g, c.b], q * 18 + v * 3);
    }
    mesh.geometry.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    mesh.geometry.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    mesh.geometry.computeBoundingSphere();
  };
  const footColour = (/** @type {number} */ q) => (s.rows[q].k === 0 ? palette.fillTop : mix(palette.row[q], palette.floor, 0.4));
  /** Strip q lies between rows q and q + 1: nearer frame i, stronger. */
  const stripNear = (/** @type {number} */ q) => Math.min(Math.abs(s.rows[q].k), Math.abs(s.rows[q + 1].k));
  const stripColour = (/** @type {number} */ q) => mix(palette.shared, palette.floor, 1 - anim.strips * (0.55 - 0.08 * stripNear(q)));
  const stripEdgeColours = () => Array.from({ length: ROWS - 1 }, (_, q) => new Array(8)
    .fill(mix(palette.shared, palette.floor, 1 - anim.strips * (0.95 - 0.12 * stripNear(q))))).flat();

  /** The bar's height in the scene: ROW_2 px below the top at Front, where the box fills the frame. */
  const barY = () => 1 - (2 * ROW_2) / Math.max(1, frame.clientHeight);
  /** Front's scale bar, one pitch period on frame i's plane; under the floor without a pitch, turned, or on a phone. */
  const barSegments = () => {
    const on = s.period > 0 && frontness > 0.5;
    const [x0, x1] = [sx(BAR_U), sx(BAR_U + s.period)];
    const y = on ? barY() : Y0 - 1;
    const tick = 0.035;
    return [x0, y, BAND_Z, x1, y, BAND_Z, x0, y - tick, BAND_Z, x0, y + tick, BAND_Z, x1, y - tick, BAND_Z, x1, y + tick, BAND_Z];
  };
  /** Front's standing bands and the bar, at the current frontness. */
  function placeBands() {
    if (!parts) return;
    const shown = (s.windows ? anim.strips : 0) * frontness;
    parts.bands.material.opacity = shown * (darkGround() ? 0.2 : 0.13);
    parts.bands.visible = shown > 0.01;
    parts.bandEdges.visible = shown > 0.01;
    parts.bandEdges.userData.recolour?.();
    setSegments(parts.bar, barSegments());
    view?.requestRender();
  }

  /** Write the current state and amounts into the scene. */
  const apply = () => {
    if (!parts) return;
    const g = geometry();
    setSegments(parts.rows, g.rows);
    setSegments(parts.envelopes, g.envelopes);
    parts.envelopes.userData.recolour?.();
    // With Windows off the envelopes fade to the plot's colour, which the stage behind them is not.
    parts.envelopes.visible = anim.morph > 0.01;
    fillMesh(parts.feet, g.feetPos, footColour);
    fillMesh(parts.strips, g.stripPos, stripColour);
    setSegments(parts.stripEdges, g.stripEdges);
    parts.stripEdges.userData.recolour?.();
    placeBands();
    parts.highlight.set(g.mine);
    parts.highlight.chip?.set({ text: anim.morph > 0.5 ? s.chips.window : s.chips.frame });
    if (orbit) relabelScene();
    view?.requestRender();
  };

  /** @param {import("./anim-three.js").ThreeContext} ctx */
  const build = (ctx) => {
    probe.builds += 1;
    view = ctx;
    const T = ctx.three;
    const g = geometry();
    // Wide and deep enough that its edges fall outside the turned views or
    // into the fog, so the stage never reads as a floating card.
    const reach = sx(4 * 160 + 80 + 127) + 8;
    const deep = 4.5 * DZ + 10;
    ctx.scene.add(floor(ctx, { extent: { min: [-reach, Y0, -deep], max: [reach, 1, deep] }, step: [1.6, DZ] }));
    ctx.scene.add(contactShadow(ctx, { x: [-1.3, 1.3], z: [-0.3, 0.3], y: Y0 }));
    const surface = () => new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    const feet = surface();
    const strips = surface();
    // The first of this view's objects a theme change reaches: it reads the tokens again.
    feet.userData.recolour = () => {
      palette = readPalette();
      fillMesh(feet, geometry().feetPos, footColour);
    };
    strips.userData.recolour = () => fillMesh(strips, geometry().stripPos, stripColour);
    const stripEdges = fatLines(ctx, g.stripEdges, stripEdgeColours, 1, { fog: true });
    // Front's two standing bands on frame i's plane, just in front of its
    // fill, translucent as the inset's are; faded out as the camera turns.
    // Coloured from the palette, not paint(), which would reset the opacity.
    const bandMaterial = new T.MeshBasicMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, opacity: 0, color: palette.shared });
    /** @type {number[]} */
    const bandPos = [];
    /** @type {number[]} */
    const uprights = [];
    for (const [a, b] of SPANS) {
      const [x0, x1] = [sx(a), sx(b)];
      bandPos.push(x0, -1, BAND_Z, x1, -1, BAND_Z, x1, 1, BAND_Z, x0, -1, BAND_Z, x1, 1, BAND_Z, x0, 1, BAND_Z);
      for (const x of [x0, x1]) uprights.push(x, -1, BAND_Z, x, 1, BAND_Z);
    }
    const bands = new T.Mesh(new T.BufferGeometry(), bandMaterial);
    bands.userData.recolour = () => {
      bandMaterial.color.setHex(palette.shared);
      placeBands();
    };
    bands.geometry.setAttribute("position", new T.Float32BufferAttribute(bandPos, 3));
    bands.renderOrder = 5;
    const bandEdges = fatLines(ctx, uprights, () => new Array(uprights.length / 3).fill(mix(palette.shared, palette.bg, 1 - 0.6 * frontness * (s.windows ? anim.strips : 0))), 1);
    const bar = fatLines(ctx, barSegments(), "--ambe-text-3", 1.5);
    const rows = fatLines(ctx, g.rows, rowColours, 1.25, { fog: true });
    const envelopes = fatLines(ctx, g.envelopes, envelopeColours, 1.25, { dashed: true, dash: 0.09, gap: 0.07, fog: true });
    // The fill stands on the row's zero line, so it hides only what lies
    // between the curve and zero, and the shared spans at the window's
    // tapered ends stay in view.
    const highlight = addHighlight(ctx, g.mine, { baseline: 0, top: 1, chip: anim.morph > 0.5 ? s.chips.window : s.chips.frame });
    ctx.scene.add(feet, strips, stripEdges, bands, bandEdges, bar, rows, envelopes, highlight);
    parts = { rows, envelopes, feet, strips, stripEdges, bands, bandEdges, bar, highlight };
    fog(ctx, DIST + 2, ROWS * DZ);
    apply();
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: s.label,
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) return null;

  /* -- camera: Front matches the inset; the turned views pull back ------ */

  // The frame overhangs the inset by OVERHANG px right and below (anim-frames.js); the box fits the inset.
  const OVERHANG = 1;
  const fitted = matchPlot(ctx, () => ({ x: 0, y: 0, width: frame.clientWidth - OVERHANG, height: frame.clientHeight - OVERHANG }), BOX);
  const T = ctx.three;
  const dir = new T.Vector3();
  const right = new T.Vector3();
  const up = new T.Vector3();
  const corner = new T.Vector3();
  const fit = () => {
    fitted.fit();
    const cam = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    dir.copy(cam.position).sub(new T.Vector3(...fitted.target)).normalize();
    // 0 at Front, 1 from about 25 degrees off it: the turned views take
    // the rows near frame i into the frame, smoothly as the camera turns.
    const blend = Math.min(1, Math.max(0, (1 - dir.z) / (1 - Math.cos((25 * Math.PI) / 180))));
    if (blend === 0) return;
    up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.999) up.set(0, 0, -1);
    right.crossVectors(up, dir).normalize();
    up.crossVectors(dir, right).normalize();
    let [r0, r1, u0, u1] = [Infinity, -Infinity, Infinity, -Infinity];
    // The windows of rows -KEEP to KEEP, each in its own plane, from the
    // floor to just over the samples' full scale (room for the stack's labels).
    for (let k = -KEEP; k <= KEEP; k += 1) for (const cx of [-1.27, 1.27]) for (const cy of [Y0, s.scale + 0.42]) {
      corner.set(sx(k * 160 + 80) + cx, cy, -k * DZ);
      const a = corner.dot(right);
      const b = corner.dot(up);
      [r0, r1, u0, u1] = [Math.min(r0, a), Math.max(r1, a), Math.min(u0, b), Math.max(u1, b)];
    }
    const hw = (cam.right - cam.left) / 2;
    const hh = (cam.top - cam.bottom) / 2;
    const need = Math.max(1, Math.max((r1 - r0) / 2 / hw, (u1 - u0) / 2 / hh) * 1.04);
    const k = 1 + blend * (need - 1);
    const cx = lerp((cam.left + cam.right) / 2, (r0 + r1) / 2, blend);
    const cy = lerp((cam.top + cam.bottom) / 2, (u0 + u1) / 2, blend);
    Object.assign(cam, { left: cx - hw * k, right: cx + hw * k, top: cy + hh * k, bottom: cy - hh * k });
  };

  // The labels outlive a park (the stage hides them while the view is
  // parked) and go with the view.
  labels = createLabels(frame, ctx);
  ctx.viewSignal.addEventListener("abort", labels.dispose, { once: true });
  orbit = createOrbit(ctx, {
    target: fitted.target, fit, distance: DIST, zoom: opts.look.zoom || 1, presets: PRESETS,
    start: intro ? "front" : s.preset, onDrag: opts.onDrag,
    onChange: () => {
      const pose = orbit?.pose() ?? FRONT;
      const was = frontness;
      frontness = Math.min(1, Math.max(0, 1 - Math.max(Math.abs(pose.yaw), Math.abs(pose.pitch)) / FRONT_FADE));
      if (frontness !== was) placeBands();
      relabelScene();
      labels?.update();
      probe.pose = orbit?.pose() ?? null;
      probe.zoom = orbit?.zoom() ?? 1;
    },
  });
  frontness = (() => {
    const pose = orbit.pose();
    return Math.min(1, Math.max(0, 1 - Math.max(Math.abs(pose.yaw), Math.abs(pose.pitch)) / FRONT_FADE));
  })();
  placeBands();

  /**
   * The labels for the pose: at Front, the inset's own (the frames, the two
   * shared spans, one period); turned, the stack's two ends and the two
   * strips frame i shares; from above, none (the bars say it). Rebuilt only
   * when the set changes. On a phone the turned labels would cover the
   * chip, so only Front's short ones stay.
   */
  function relabelScene() {
    const pitch = orbit?.pose().pitch ?? 0;
    const phone = frame.clientWidth < 420;
    const settled = anim.slide.every((v) => v === 1);
    const shared = s.windows && anim.strips > 0.5;
    const mode = pitch > 60 ? "top" : frontness > 0.5 ? "front" : phone ? "none" : "turned";
    const key = [mode, shared, settled, phone, s.index, Math.round(s.period), frame.clientHeight].join();
    if (key === labelKey) return;
    labelKey = key;
    /** @type {import("./lib/labels.js").Label[]} */
    const list = [];
    const middle = /** @type {const} */ ("middle");
    if (mode === "front") {
      s.rows.forEach((row) => {
        if (Math.abs(row.k) > 1 || !row.present) return;
        if (!phone) list.push({ text: `frame ${s.index + row.k}`, at: [sx(row.k * 160 + 80), 1, 0], align: middle, dy: ROW_1 });
      });
      if (shared) for (const [a, b] of SPANS) list.push({ text: `${SHARED} shared`, at: [sx((a + b) / 2), 1, BAND_Z], align: middle, dy: ROW_1 });
      if (s.period > 0) {
        list.push({ text: `one period, ${Math.round(s.period)} samples`, at: [sx(BAR_U + s.period) + 0.05, barY(), BAND_Z], align: "start" });
      }
    } else if (mode === "turned") {
      list.push({ text: "earlier frames", at: [sx(-2 * 160 + 80), s.scale + 0.36, 2 * DZ], align: middle },
        { text: "later frames, 20 ms apart", at: [sx(2 * 160 + 80), s.scale + 0.36, -2 * DZ], align: middle });
      if (shared && settled) {
        // On each strip that touches frame i: the label names the bridge it sits on.
        SPANS.forEach(([a, b], n) => {
          const r = REACH + n - 1;
          const z = (-DZ * (s.rows[r].k + s.rows[r + 1].k)) / 2;
          list.push({ text: `${SHARED} shared`, at: [sx((a + b) / 2), Y0, z], align: middle });
        });
      }
    }
    labels?.set(list);
  }

  /* -- the explanatory animation, and step changes ---------------------- */

  const tl = ctx.timeline();
  const build3d = duration("3d-build");
  const stagger = parseFloat(getComputedStyle(document.body).getPropertyValue("--ambe-stagger")) || 35;
  /** Rows in order of distance from frame i, so the slide fans outward. */
  const order = s.rows.map((_, r) => r).sort((a, b) => Math.abs(s.rows[a].k) - Math.abs(s.rows[b].k));
  const slideEnd = build3d + stagger * (ROWS - 1);
  /** The rows slide back from frame i's plane into depth, the nearest first. @param {boolean} build */
  const playSlide = (build) => tl.play("slide", {
    ms: slideEnd, build, ease: "linear",
    // One track for the nine rows, staggered inside it, so a frame of the
    // animation rewrites the scene once.
    step: (t) => {
      order.forEach((r, i) => {
        const local = Math.min(1, Math.max(0, (t * slideEnd - i * stagger) / build3d));
        anim.slide[r] = 1 - (1 - local) ** 3;
      });
      apply();
    },
  });
  if (intro) {
    const to = PRESETS[s.preset];
    void tl.play("camera", {
      ms: duration("3d-camera"), ease: "inout", build: true,
      step: (t) => orbit?.set({ yaw: lerp(FRONT.yaw, to.yaw, t), pitch: lerp(FRONT.pitch, to.pitch, t) }),
    });
    void playSlide(true);
    if (s.windows) {
      void tl.play("windows", {
        ms: build3d, build: true, delay: slideEnd,
        step: (t) => {
          anim.morph = t;
          apply();
        },
      });
      void tl.play("strips", {
        ms: duration("slow"), build: true, delay: slideEnd + build3d * 0.6,
        step: (t) => {
          anim.strips = t;
          apply();
        },
      });
    }
  }

  /** The front view's samples of rows i-1 to i+1, in the 2D canvas's CSS px. */
  const frontPoints = () => {
    if (!parts || anim.morph !== 0) return [];
    const v = new T.Vector3();
    /** @type {Map<number, {u: number, x: number, y: number}>} */
    const out = new Map();
    s.rows.forEach((row, r) => {
      if (Math.abs(row.k) > 1) return;
      for (let j = 0; j < N; j += 1) {
        const u = row.frameU[j];
        if (u < -160 || u >= 320 || out.has(u)) continue;
        v.set(...at(r, j)).project(ctx.camera);
        out.set(u, { u, x: frame.offsetLeft + ((v.x + 1) / 2) * frame.clientWidth, y: frame.offsetTop + ((1 - v.y) / 2) * frame.clientHeight });
      }
    });
    return [...out.values()].sort((a, b) => a.u - b.u);
  };

  let labelTimer = 0;
  const describe = () => s.label;
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
  };

  // Resolve once drawn, or as soon as the reader has left 3D, so the switch
  // can close a view nobody wants (a draw can wait on a slot that never comes).
  await new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (opts.wanted()) return;
      window.clearInterval(timer);
      resolve(null);
    }, 100);
    void ctx.drawn().then(() => {
      window.clearInterval(timer);
      resolve(null);
    });
  });
  return {
    update: (state) => {
      const next = /** @type {FramesState} */ (state);
      const moved = next.index !== s.index || next.track !== s.track;
      const windows = next.windows !== s.windows;
      const replay = next.replay !== s.replay;
      // Land this view's own tracks; a camera flight the step just started
      // (orbit's own timeline) keeps flying.
      tl.finish();
      s = next;
      anim.slide.fill(1);
      if (replay) {
        anim.slide.fill(0);
        probe.replays += 1;
        void playSlide(false);
      }
      if (windows) {
        const from = { morph: anim.morph, strips: anim.strips };
        const goal = next.windows ? 1 : 0;
        void tl.play("windows", {
          ms: build3d,
          step: (t) => {
            anim.morph = lerp(from.morph, goal, t);
            anim.strips = lerp(from.strips, goal, Math.min(1, t * 1.5));
            apply();
          },
        });
      } else {
        apply();
      }
      // Play pulses too, at most once in PULSE_EVERY, so the glow breathes
      // with the frames rather than staying lit.
      const now = performance.now();
      if (moved && (!next.playing || now - lastPulse > PULSE_EVERY)) {
        lastPulse = now;
        void parts?.highlight.pulse();
      }
      relabel();
    },
    preset: (name) => void orbit?.go(name),
    describe,
    close: () => {
      clearTimeout(labelTimer);
      if (TEST_HOOK && TEST_HOOK.figures["frames-3d"] === probe) delete TEST_HOOK.figures["frames-3d"];
      ctx.dispose();
    },
  };
}
