// @ts-check
/* ===========================================================================
 * anim-pitch-search-3d.js: the pitch-search figure's 3D view.
 * ---------------------------------------------------------------------------
 * Loaded by lib/view-switch.js from anim-pitch-search.js, which holds the
 * model; this part places its arrays in a scene.
 *
 * One frame:  x lag 0 to 254, y phi / phi(0), z candidate P (20 at the
 *             front, 114 at the back). phi runs along depth as a curtain,
 *             coloured by height; every whole candidate's comb stands on it,
 *             a stem at each kP, coloured by k and faded by its distance
 *             from the highlighted candidate, a dot on the tips of every
 *             second candidate; the score Psi(P) runs along the end wall on
 *             its own scale, over its zero line and grid. The highlight is
 *             the comb's teeth; its spine is a thin context line. Front is
 *             the phi panel of the 2D view and Side the score across the
 *             whole frame (lib/orbit.js frontFrustum on each rectangle);
 *             the context fades out toward them.
 * Whole clip: x lag 22 to 114, y phi, z time (frame 0 at the front): one
 *             surface of every frame's phi on the ramp, the site tracker's
 *             period riding it, the 20% corridor dashed beside it. The
 *             selected frame is a thin row with the corridor bracketed on
 *             it; the highlight is the tracker's step into that frame, an
 *             arrow, with the chip at its head. Top is the heat map.
 *
 * The explanatory animation, once on first view: "The score adds the
 * correlation at every multiple of a candidate period, so half the true
 * period also scores high." The highlighted comb sweeps from P = 22 back
 * to 114; as it passes each candidate, that candidate's stems drop onto
 * the curtain, the tips that land on a tall part of phi flash, and Psi(P)
 * grows point by point on the wall; then the comb glides back to the
 * step's candidate and pulses. The end state shows every comb and the
 * whole score, with its humps at 46 and 23.
 *
 * Every number comes from the 2D module's PitchView (scoreAt, teeth,
 * corridorAt, the arrays): this part computes no model data.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { HEAT_X, LAG_DOMAIN, PHI_DOMAIN, P_DOMAIN, chipText, heatY, layout } from "./anim-pitch-search.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createChip, createLabels } from "./lib/labels.js";
import { FRONT, SIDE, TOP, createOrbit, frontFrustum } from "./lib/orbit.js";
import { P_MAX, P_MIN } from "./lib/pitch.js";
import { axisFrame, lineBuffer, toScene, writePoints } from "./lib/scene.js";
import { contactShadow, fade, fatLines, floor, fog, mix, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-pitch-search.js").PitchView} PitchView */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {[number, number, number]} V3 */

/**
 * The corner: low enough that the wall's far end (P = 114) does not climb
 * above its true maximum at 46; a phone looks down a little more, so the
 * box fills its taller frame.
 */
const CORNER = Object.freeze({ yaw: 42, pitch: 24 });
const CORNER_NARROW = Object.freeze({ yaw: 32, pitch: 40 });
const DISTANCE = 8;
/** One frame: lag, phi, candidate (from 20, as the 2D score panel). */
const MAP = toScene({ x: LAG_DOMAIN, y: PHI_DOMAIN, z: [P_MAX, P_DOMAIN[0]] }, { x: 2.6, y: 1.2, z: 2.8 });
/** The end wall, a little past the last lag. */
const WALL_X = MAP.box.max[0] + 0.12;
/** Every whole candidate. */
const CANDS = Array.from({ length: P_MAX - P_MIN + 1 }, (_, i) => P_MIN + i);
/** Candidates whose tips carry a dot: every second one. */
const DOTTED = CANDS.filter((p) => (p - P_MIN) % 2 === 0);
/** A tip this high (phi / phi(0)) lands on a tall part of phi, and flashes in the sweep. */
const TALL = 0.2;
/** P ticks: 46, its half and its multiples. */
const P_TICKS = [23, 46, 69, 92, 114];
/** The sweep runs past the last candidate by this much, so its stems land. */
const DROP = 7;
const INTRO_MS = 3800;
const SWEEP_SHARE = 0.78;

/** A polyline's points (flat x, y, z) as segment pairs. @param {number[]} points */
const segmentsOf = (points) => {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i + 5 < points.length; i += 3) out.push(...points.slice(i, i + 6));
  return out;
};

/** @param {number} t */
const smooth = (t) => t * t * (3 - 2 * t);

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let v = /** @type {PitchView} */ (opts.state);
  const clip = v.clip;
  const lags = clip.lag_max - clip.lag_min + 1;
  const CMAP = toScene({ x: HEAT_X, y: [0, 1], z: [heatY(clip.frames)[1], heatY(clip.frames)[0]] }, { x: 3, y: 0.6, z: 2.4 });
  /** @type {Record<string, Pose>} */
  const PRESETS = { corner: frame.clientWidth < 560 ? CORNER_NARROW : CORNER, front: FRONT, side: SIDE, top: TOP };
  /** The most teeth a comb has (the shortest candidate's). */
  const K_MAX = v.teeth(P_MIN).length;
  /** What the scene shows: the candidate the comb stands at, how far the sweep has gone. */
  const shown = { cand: v.cand, sweep: Infinity };
  const probe = {
    builds: 0, pose: /** @type {Pose | null} */ (null), zoom: 1, played: false, shown,
    /** Frames the first-view sweep drew between its ends. */
    swept: 0,
    frontPoints: () => /** @type {any} */ ({}),
    counts: () => ({ segments: 0, draws: 0 }),
    set: (/** @type {Pose} */ _pose) => {},
  };
  if (TEST_HOOK) TEST_HOOK.figures["pitch-search-3d"] = probe;

  /** Psi to scene y, on the wall's own scale. @param {number} s */
  const psiY = (s) => {
    const [lo, hi] = v.psiDomain;
    return MAP.y(PHI_DOMAIN[0] + ((s - lo) / (hi - lo)) * (PHI_DOMAIN[1] - PHI_DOMAIN[0]));
  };
  /** A frame's phi at a lag between whole lags, 0 to 1 (the stored rows, read between lags). @param {number} f @param {number} lag */
  const rowAt = (f, lag) => {
    const i = Math.max(0, Math.min(lags - 1, lag - clip.lag_min));
    const a = Math.floor(i);
    const b = Math.min(lags - 1, a + 1);
    const r = clip.rows;
    return (r[f * lags + a] + (r[f * lags + b] - r[f * lags + a]) * (i - a)) / 100;
  };
  const narrow = () => frame.clientWidth < 560;

  /** @type {any} */
  let parts = null;
  /** Fades, 0 at the preset the 2D panel matches, 1 once turned 20 degrees. */
  const presence = { front: 1, side: 1 };

  /** The highlighted comb's plane: the spine along y = 0 and the teeth. @param {number} cand */
  const combPoints = (cand) => {
    const z = MAP.z(cand);
    const y0 = MAP.y(0);
    /** @type {number[]} */
    const out = [MAP.x(0), y0, z];
    for (const [lag, phi] of v.teeth(cand)) out.push(MAP.x(lag), y0, z, MAP.x(lag), MAP.y(phi), z, MAP.x(lag), y0, z);
    out.push(MAP.x(LAG_DOMAIN[1]), y0, z);
    return out;
  };
  /**
   * The highlight's own segments: the teeth, each with a short cap on its
   * tip. A tooth shorter than two caps (a lag where the score is about 0)
   * has no stem to sit on: its cap alone, glowing, read as a stray pill, so
   * it is left out and the comb's spine marks its lag.
   * @param {number} cand
   */
  const teethSegments = (cand) => {
    const z = MAP.z(cand);
    const y0 = MAP.y(0);
    const cap = (MAP.x(2) - MAP.x(0)) / 2;
    /** @type {number[]} */
    const out = [];
    for (const [lag, phi] of v.teeth(cand)) {
      const x = MAP.x(lag);
      const y = MAP.y(phi);
      if (Math.abs(y - y0) < 2 * cap) continue;
      out.push(x, y0, z, x, y, z, x - cap, y, z, x + cap, y, z);
    }
    return out.length ? out : [0, 0, 0, 0, 0, 0];
  };

  /** Every candidate's stems, each tip dropping in as the sweep passes it. */
  const stemSegments = () => {
    /** @type {number[]} */
    const out = [];
    const y0 = MAP.y(0);
    const top = MAP.y(PHI_DOMAIN[1]);
    for (const p of CANDS) {
      const u = Math.min(1, Math.max(0, (shown.sweep - p) / DROP));
      for (const [lag, phi] of v.teeth(p)) {
        const tip = u <= 0 ? y0 : top + (MAP.y(phi) - top) * (1 - (1 - u) ** 3);
        out.push(MAP.x(lag), y0, MAP.z(p), MAP.x(lag), tip, MAP.z(p));
      }
    }
    return out;
  };
  /** A tooth's colour: the ramp by tooth number, faded from the comb. @param {number} p @param {number} k */
  const toothColour = (p, k) => fade(rampColor(0.3 + (0.7 * k) / (K_MAX - 1)), (p - shown.cand) / 3);
  /** Each stem's two ends. */
  const stemColours = () => {
    /** @type {number[]} */
    const out = [];
    for (const p of CANDS) v.teeth(p).forEach((_, k) => out.push(toothColour(p, k), toothColour(p, k)));
    return out;
  };
  /** The dotted candidates' tips, x y z each. */
  const tipPoints = () => {
    /** @type {number[]} */
    const out = [];
    const y0 = MAP.y(0);
    const top = MAP.y(PHI_DOMAIN[1]);
    for (const p of DOTTED) {
      const u = Math.min(1, Math.max(0, (shown.sweep - p) / DROP));
      for (const [lag, phi] of v.teeth(p)) out.push(MAP.x(lag), u <= 0 ? y0 : top + (MAP.y(phi) - top) * (1 - (1 - u) ** 3), MAP.z(p));
    }
    return out;
  };
  /**
   * The dotted tips' colours. In the sweep, a tip that lands on a tall part
   * of phi flashes toward the ink as it lands, then settles.
   */
  const tipColours = () => {
    const ink = tokenHex("--ambe-plot-ink");
    /** @type {number[]} */
    const out = [];
    for (const p of DOTTED) {
      const age = (shown.sweep - p) / DROP;
      const flash = Number.isFinite(shown.sweep) && age > 0 && age < 2.5 ? Math.sin((Math.PI * Math.min(age, 2.5)) / 2.5) : 0;
      v.teeth(p).forEach(([, phi], k) => {
        const c = toothColour(p, k);
        out.push(flash > 0 && phi >= TALL ? mix(c, ink, 0.85 * flash) : c);
      });
    }
    return out;
  };

  /** The curtain: phi along depth, coloured by height. @param {ThreeContext} ctx */
  const curtain = (ctx) => {
    const T = ctx.three;
    const n = v.phi.length;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(n * 6), 3));
    geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(n * 6), 3));
    /** @type {number[]} */
    const index = [];
    for (let m = 0; m + 1 < n; m += 1) index.push(2 * m, 2 * m + 1, 2 * m + 2, 2 * m + 2, 2 * m + 1, 2 * m + 3);
    geometry.setIndex(index);
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.25, depthWrite: false, side: T.DoubleSide,
    }));
    const colour = new T.Color();
    mesh.userData.recolour = () => {
      const pos = geometry.getAttribute("position");
      const col = geometry.getAttribute("color");
      for (let m = 0; m < n; m += 1) {
        const y = MAP.y(v.phi[m]);
        pos.setXYZ(2 * m, MAP.x(m), y, MAP.box.max[2]);
        pos.setXYZ(2 * m + 1, MAP.x(m), y, MAP.box.min[2]);
        colour.setHex(rampColor((v.phi[m] - PHI_DOMAIN[0]) / (PHI_DOMAIN[1] - PHI_DOMAIN[0])));
        col.setXYZ(2 * m, colour.r, colour.g, colour.b);
        col.setXYZ(2 * m + 1, colour.r, colour.g, colour.b);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      geometry.computeBoundingSphere();
    };
    mesh.userData.recolour();
    return mesh;
  };

  /** The clip's surface: every frame's phi, on the ramp. @param {ThreeContext} ctx */
  const surface = (ctx) => {
    const T = ctx.three;
    const nf = clip.frames;
    const geometry = new T.BufferGeometry();
    const pos = new Float32Array(nf * lags * 3);
    for (let f = 0; f < nf; f += 1) {
      for (let m = 0; m < lags; m += 1) {
        pos.set([CMAP.x(clip.lag_min + m), CMAP.y(clip.rows[f * lags + m] / 100), CMAP.z(f)], (f * lags + m) * 3);
      }
    }
    geometry.setAttribute("position", new T.BufferAttribute(pos, 3));
    geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(nf * lags * 3), 3));
    /** @type {number[]} */
    const index = [];
    for (let f = 0; f + 1 < nf; f += 1) {
      for (let m = 0; m + 1 < lags; m += 1) {
        const a = f * lags + m;
        index.push(a, a + 1, a + lags, a + 1, a + lags + 1, a + lags);
      }
    }
    geometry.setIndex(index);
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    const colour = new T.Color();
    mesh.userData.recolour = () => {
      const col = geometry.getAttribute("color");
      for (let i = 0; i < nf * lags; i += 1) {
        colour.setHex(rampColor(clip.rows[i] / 100));
        col.setXYZ(i, colour.r, colour.g, colour.b);
      }
      col.needsUpdate = true;
    };
    mesh.userData.recolour();
    return mesh;
  };

  const LIFT = 0.008;
  /** A point on the clip's surface, a little above it. @param {number} f @param {number} lag @returns {V3} */
  const on = (f, lag) => [CMAP.x(lag), CMAP.y(rowAt(f, lag)) + LIFT, CMAP.z(f)];
  const inside = (/** @type {number} */ lag) => lag >= clip.lag_min && lag <= clip.lag_max;

  /** The tracker's path and the corridor's two edges, on the surface; broken wherever a frame is unvoiced. */
  const clipLines = () => {
    const per = clip.tracker_period;
    /** @type {number[]} */
    const path = [];
    /** @type {number[]} */
    const band = [];
    for (let f = 1; f < clip.frames; f += 1) {
      if (per[f] && per[f - 1] && inside(per[f]) && inside(per[f - 1])) path.push(...on(f - 1, per[f - 1]), ...on(f, per[f]));
      const a = v.corridorAt(f - 1);
      const b = v.corridorAt(f);
      if (a && b) {
        for (const side of [0, 1]) if (inside(a[side]) && inside(b[side])) band.push(...on(f - 1, a[side]), ...on(f, b[side]));
      }
    }
    return { path, band };
  };

  /** The selected frame's row, the whole lag range. @param {number} f */
  const rowPoints = (f) => {
    /** @type {number[]} */
    const out = [];
    for (let m = 0; m < lags; m += 1) out.push(...on(f, clip.lag_min + m));
    return out;
  };
  /** Scene units per CSS px in the heat map's Top view, across (lag) and in depth (frames). */
  const perPx = () => {
    const L = layout(frame.clientWidth || 600, frame.clientHeight || 340);
    return { x: (CMAP.box.max[0] - CMAP.box.min[0]) / L.heat.width, z: (CMAP.box.max[2] - CMAP.box.min[2]) / L.heat.height };
  };
  /**
   * The clip's highlight: the tracker's step from the frame before into
   * this one, as an arrow ending on this frame's period; a short mark on
   * the period when the frame before is unvoiced; the whole row when this
   * frame is unvoiced. Returns the points and the chip's anchor.
   * @param {number} f
   * @returns {{points: number[], at: V3}}
   */
  const exitArrow = (f) => {
    const per = clip.tracker_period;
    const now = per[f];
    if (!now || !inside(now)) {
      const points = rowPoints(f);
      return { points, at: /** @type {V3} */ (points.slice(-3)) };
    }
    const before = per[f - 1] && inside(per[f - 1]) ? per[f - 1] : now - 3;
    const f0 = per[f - 1] ? f - 1 : f;
    const u = perPx();
    /** @type {number[]} */
    const points = [];
    // A ring, 3 px across, on the frame before's period; then the shaft.
    const start = [CMAP.x(before), CMAP.y(Math.max(rowAt(f0, before), rowAt(f, before))) + LIFT * 2, CMAP.z(f0)];
    for (let i = 0; i <= 10; i += 1) {
      const a = Math.PI + (2 * Math.PI * i) / 10;
      points.push(start[0] + 3 * Math.cos(a) * u.x, start[1], start[2] + 3 * Math.sin(a) * u.z);
    }
    const steps = 10;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const lag = before + (now - before) * t;
      const y = Math.max(rowAt(f0, lag), rowAt(f, lag));
      points.push(CMAP.x(lag), CMAP.y(y) + LIFT * 2, CMAP.z(f0) + (CMAP.z(f) - CMAP.z(f0)) * t);
    }
    // The head: two barbs, 8 px long on the heat map, back along the shaft.
    const tip = points.slice(-3);
    const dx = (now - before) * (CMAP.x(1) - CMAP.x(0)) / u.x;
    const dz = (CMAP.z(f) - CMAP.z(f0)) / u.z;
    const len = Math.hypot(dx, dz) || 1;
    const [ex, ez] = [dx / len, dz / len];
    for (const turn of [0.5, -0.5]) {
      const bx = -(ex * Math.cos(turn) - ez * Math.sin(turn)) * 8;
      const bz = -(ex * Math.sin(turn) + ez * Math.cos(turn)) * 8;
      points.push(tip[0] + bx * u.x, tip[1], tip[2] + bz * u.z, ...tip);
    }
    return { points, at: /** @type {V3} */ (tip) };
  };
  /** The corridor around the frame before, as a bracket on this frame's row. @param {number} f */
  const bracket = (f) => {
    const band = v.corridorAt(f);
    if (!band) return [0, 0, 0, 0, 0, 0];
    const [a, b] = band.map((lag) => Math.max(clip.lag_min, Math.min(clip.lag_max, lag)));
    // 5 px under the row (toward earlier frames), its ends turned up to it,
    // so the arrow on the row passes its end.
    const px = perPx().z;
    const pa = on(f, a);
    const pb = on(f, b);
    pa[2] += 5 * px;
    pb[2] += 5 * px;
    return [pa[0], pa[1], pa[2] - 5 * px, ...pa, ...pa, ...pb, ...pb, pb[0], pb[1], pb[2] - 5 * px];
  };

  /** @param {ThreeContext} ctx */
  const build = (ctx) => {
    probe.builds += 1;
    const T = ctx.three;

    // One frame.
    const F = new T.Group();
    const box = MAP.box;
    const yz = { min: /** @type {V3} */ ([box.min[0], box.min[1], box.min[2]]), max: /** @type {V3} */ ([WALL_X, box.max[1], box.max[2]]) };
    F.add(floor(ctx, { extent: yz, step: [MAP.x(50) - MAP.x(0), MAP.z(P_MIN) - MAP.z(P_MIN + 23)] }));
    F.add(contactShadow(ctx, { x: [box.min[0], WALL_X], z: [box.min[2], box.max[2]], y: box.min[1] }));
    F.add(axisFrame(ctx, box, { xs: [0, 50, 100, 150, 200, 250].map(MAP.x), ys: [-0.5, 0, 0.5, 1].map(MAP.y), floor: false, grid: "--ambe-3d-grid" }));
    const sheet = curtain(ctx);
    const stems = fatLines(ctx, stemSegments(), stemColours, 1.25, { fog: true });
    // A dot on every second candidate's tips: across the candidates, the
    // k-th tips line up on the ray lag = kP, one colour per k.
    const tipCount = tipPoints().length / 3;
    const tipGeometry = new T.BufferGeometry();
    tipGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array(tipCount * 3), 3));
    tipGeometry.setAttribute("color", new T.BufferAttribute(new Float32Array(tipCount * 3), 3));
    // A round dot: an alpha mask (full channels inside a circle), so the
    // tip takes its vertex colour unchanged.
    const mask = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i += 1) {
      const within = Math.hypot((i % 32) - 15.5, Math.floor(i / 32) - 15.5) < 15;
      mask.fill(within ? 255 : 0, i * 4, i * 4 + 4);
    }
    const dot = ctx.track(new T.DataTexture(mask, 32, 32));
    dot.needsUpdate = true;
    const tips = new T.Points(tipGeometry, new T.PointsMaterial({
      size: 5, sizeAttenuation: false, vertexColors: true, map: dot, alphaTest: 0.5,
    }));
    tips.frustumCulled = false;
    const tipColour = new T.Color();
    tips.userData.recolour = () => {
      const c = tipColours();
      const col = tipGeometry.getAttribute("color");
      for (let i = 0; i < tipCount; i += 1) {
        tipColour.setHex(c[i]);
        col.setXYZ(i, tipColour.r, tipColour.g, tipColour.b);
      }
      col.needsUpdate = true;
    };
    tips.userData.recolour();
    const phiLine = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 1.5);
    // The comb's spine: context, thin.
    const spine = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-muted", 1.25);
    const wall = new T.Mesh(new T.PlaneGeometry(box.max[2] - box.min[2], box.max[1] - box.min[1]),
      ctx.paint(new T.MeshBasicMaterial({ side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), "--ambe-3d-floor"));
    wall.rotation.y = Math.PI / 2;
    wall.position.set(WALL_X, (box.min[1] + box.max[1]) / 2, 0);
    const wallGrid = lineBuffer(ctx, 12, "--ambe-3d-grid");
    const wallZero = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-axis", 1.25);
    const score = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-accent-cool", 2.25);
    // 20 and 21, outside the searched range: dashed.
    const lead = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-accent-cool", 1.25, { dashed: true, dash: 0.03, gap: 0.025 });
    const marker = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 1.5);
    const markerDot = new T.Points(new T.BufferGeometry(), ctx.paint(new T.PointsMaterial({
      size: 8, sizeAttenuation: false, map: dot, alphaTest: 0.5,
    }), "--ambe-plot-ink"));
    markerDot.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(3), 3));
    markerDot.frustumCulled = false;
    // The comparison the chip states at 23: the score at 46 and the level at 23.
    const ref = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.025, gap: 0.02 });
    const tracker = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.03, gap: 0.03 });
    const W = new T.Group();
    W.add(wall, wallGrid, wallZero, score, lead, ref, tracker, marker, markerDot);
    const kit = addHighlight(ctx, combPoints(shown.cand), { baseline: MAP.y(PHI_DOMAIN[0]), top: MAP.y(PHI_DOMAIN[1]), fill: false, chip: "" });
    /** The kit's glow, line and core: drawn on the teeth only. */
    const kitLines = /** @type {any[]} */ (kit.children.filter((o) => o.renderOrder >= 10));
    F.add(sheet, stems, tips, phiLine, spine, W, kit);

    // Whole clip.
    const C = new T.Group();
    const cbox = CMAP.box;
    // The floor sits a little under the surface, whose zeros lie at y min.
    const under = { min: /** @type {V3} */ ([cbox.min[0], cbox.min[1] - 0.04, cbox.min[2]]), max: cbox.max };
    C.add(floor(ctx, { extent: under, step: [CMAP.x(46) - CMAP.x(23), CMAP.z(0) - CMAP.z(50)] }));
    C.add(contactShadow(ctx, { x: [cbox.min[0], cbox.max[0]], z: [cbox.min[2], cbox.max[2]], y: under.min[1] }));
    C.add(surface(ctx));
    const { path, band } = clipLines();
    C.add(fatLines(ctx, band, "--ambe-plot-ink", 1.25, { dashed: true, dash: 0.035, gap: 0.03 }));
    C.add(fatLines(ctx, path, "--ambe-plot-ink", 2.25));
    const rowLine = fatLines(ctx, segmentsOf(rowPoints(v.row)), "--ambe-plot-muted", 1.25);
    const rowBracket = fatLines(ctx, bracket(v.row), "--ambe-plot-ink", 1.75);
    const exit = exitArrow(v.row);
    const rowKit = addHighlight(ctx, exit.points, { baseline: CMAP.y(0), fill: false });
    C.add(rowLine, rowBracket, rowKit);

    ctx.scene.add(F, C);
    fog(ctx, DISTANCE, 2.6);

    const labels = createLabels(ctx.frame, ctx);
    const wallLabel = createLabels(ctx.frame, ctx);
    const wallLayer = /** @type {HTMLElement} */ (ctx.frame.lastElementChild);
    // The clip's chip, at the arrow's head (the kit's own would sit on the
    // highest point of the step).
    const rowChip = createChip(ctx.frame, ctx, { text: chipText(v), at: exit.at });
    ctx.track({ dispose: labels.dispose });
    ctx.track({ dispose: wallLabel.dispose });
    ctx.track({ dispose: rowChip.dispose });
    const made = {
      F, C, W, sheet, stems, tips, phiLine, spine, wallGrid, wallZero, score, lead, marker, markerDot, ref, tracker,
      kit, kitLines, rowLine, rowBracket, rowKit, rowChip, labels, wallLabel, wallLayer, nearest: NaN,
    };
    F.userData.recolour = () => fadeContext(made);
    parts = made;
    write();
  };

  /** Context fades toward the preset whose 2D panel it would cover. @param {any} p */
  const fadeContext = (p) => {
    /** @param {any} o @param {number} a @param {number} [base=1] */
    const set = (o, a, base = 1) => {
      o.visible = a > 0.02;
      o.material.opacity = base * a;
      o.material.transparent = true;
    };
    const both = Math.min(presence.front, presence.side);
    set(p.sheet, both, 0.25);
    set(p.stems, both);
    set(p.tips, both);
    set(p.spine, both);
    set(p.phiLine, presence.side);
    p.W.visible = presence.front > 0.02;
    p.wallLayer.style.opacity = String(presence.front);
  };

  /** Write the shown candidate, the sweep and the mode into the scene. */
  const write = () => {
    if (!parts) return;
    const p = parts;
    const clipMode = v.mode === "clip";
    p.F.visible = !clipMode;
    p.C.visible = clipMode;
    const kitLayer = /** @type {HTMLElement | null} */ (p.kit.chip?.node.parentElement ?? null);
    if (kitLayer) kitLayer.style.display = clipMode ? "none" : "";
    const rowLayer = /** @type {HTMLElement | null} */ (p.rowChip.node.parentElement ?? null);
    if (rowLayer) rowLayer.style.display = clipMode ? "" : "none";
    if (clipMode) {
      const exit = exitArrow(v.row);
      p.rowKit.set(exit.points);
      setSegments(p.rowLine, segmentsOf(rowPoints(v.row)));
      setSegments(p.rowBracket, bracket(v.row));
      p.rowChip.set({ text: chipText(v), at: exit.at });
    } else {
      const z = MAP.z(shown.cand);
      setSegments(p.phiLine, Array.from(v.phi, (y, m) => [MAP.x(m), MAP.y(y), z]).flatMap((a, m, all) =>
        m + 1 < all.length ? [...a, ...all[m + 1]] : []));
      setSegments(p.spine, [MAP.x(0), MAP.y(0), z, MAP.x(LAG_DOMAIN[1]), MAP.y(0), z]);
      p.kit.set(combPoints(shown.cand));
      const teeth = teethSegments(shown.cand);
      for (const o of p.kitLines) setSegments(o, teeth);
      p.kit.chip?.set({ text: chipText({ ...v, cand: Math.round(shown.cand * 10) / 10 }, { narrow: narrow() }) });
      setSegments(p.stems, stemSegments());
      const tipPos = p.tips.geometry.getAttribute("position");
      const tp = tipPoints();
      for (let i = 0; i < tipPos.count; i += 1) tipPos.setXYZ(i, tp[3 * i], tp[3 * i + 1], tp[3 * i + 2]);
      tipPos.needsUpdate = true;
      if (Math.round(shown.cand) !== p.nearest) {
        p.nearest = Math.round(shown.cand);
        p.stems.userData.recolour?.();
      }
      p.tips.userData.recolour();
      // The wall: Psi up to the sweep, the candidate's marker, the tracker.
      const W0 = WALL_X + 0.004;
      /** @type {number[]} */
      const s = [];
      for (let i = 0; i + 1 < v.curve.length && P_MIN + i + 1 <= shown.sweep; i += 1) {
        s.push(W0, psiY(v.curve[i]), MAP.z(P_MIN + i), W0, psiY(v.curve[i + 1]), MAP.z(P_MIN + i + 1));
      }
      p.score.visible = s.length > 0;
      setSegments(p.score, s.length ? s : [0, 0, 0, 0, 0, 0]);
      /** @type {number[]} */
      const l = [];
      for (let q = P_DOMAIN[0]; q < P_MIN; q += 1) l.push(W0, psiY(v.scoreAt(q)), MAP.z(q), W0, psiY(v.scoreAt(q + 1)), MAP.z(q + 1));
      setSegments(p.lead, l);
      const at = v.scoreAt(shown.cand);
      setSegments(p.marker, [WALL_X + 0.006, psiY(0), z, WALL_X + 0.006, psiY(at), z]);
      writePoints(p.markerDot, [WALL_X + 0.008, psiY(at), z]);
      p.ref.visible = v.ref !== null && Math.abs(shown.cand - v.cand) < 1e-6;
      if (v.ref !== null) {
        const r = v.ref;
        setSegments(p.ref, [
          W0, psiY(0), MAP.z(r), W0, psiY(v.scoreAt(r)), MAP.z(r),
          W0, psiY(v.scoreAt(v.cand)), MAP.z(v.cand), W0, psiY(v.scoreAt(v.cand)), MAP.z(r),
        ]);
      }
      p.tracker.visible = v.tracker !== null;
      if (v.tracker) setSegments(p.tracker, [WALL_X + 0.005, MAP.box.min[1], MAP.z(v.tracker), WALL_X + 0.005, MAP.box.max[1], MAP.z(v.tracker)]);
      const [lo, hi] = v.psiDomain;
      writePoints(p.wallGrid, [
        ...[lo, hi / 2, hi].flatMap((t) => [WALL_X + 0.001, psiY(t), MAP.box.min[2], WALL_X + 0.001, psiY(t), MAP.box.max[2]]),
        ...P_TICKS.slice(0, -1).flatMap((c) => [WALL_X + 0.001, MAP.box.min[1], MAP.z(c), WALL_X + 0.001, MAP.box.max[1], MAP.z(c)]),
      ]);
      setSegments(p.wallZero, [WALL_X + 0.002, psiY(0), MAP.box.min[2], WALL_X + 0.002, psiY(0), MAP.box.max[2]]);
    }
    // three caps an instanced geometry's count at its first draw
    // (_maxInstanceCount); a fat line that grows (the score, a comb with
    // more teeth) would stay cut short, so the cap goes after each write.
    for (const g of [p.F, p.C]) {
      g.traverse((/** @type {any} */ o) => {
        if (o.geometry?.isInstancedBufferGeometry) delete o.geometry._maxInstanceCount;
      });
    }
    setLabels();
    fadeContext(p);
    ctxRef?.requestRender();
  };

  let labelKey = "";
  const setLabels = () => {
    if (!parts || !ctxRef) return;
    const thin = narrow();
    const key = `${v.mode}${v.source}${thin}`;
    if (key === labelKey) return;
    labelKey = key;
    if (v.mode === "clip") {
      parts.wallLabel.set([]);
      const b = CMAP.box;
      parts.labels.set([
        ...axisLabels(b, CMAP, [
          { axis: "x", name: "lag, samples", ticks: [22, 46, 69, 92, 114] },
          { axis: "z", name: "", ticks: [50, 100, 150].filter((f) => f < clip.frames), format: (f) => `${(f * 0.02).toFixed(0)} s` },
        ]).filter((l) => l.text),
        // Time's name past the last frame, clear of the rows.
        { text: "time", at: [b.max[0], b.min[1], b.min[2]], align: "end", along: [0, 0, 1], dy: -12 },
      ]);
      return;
    }
    const [lo, hi] = v.psiDomain;
    // Over the wall's far end (the right end from the side), clear of the hump at 46.
    const wallTop = /** @type {V3} */ ([WALL_X, MAP.box.max[1], MAP.box.min[2]]);
    parts.labels.set([
      ...axisLabels(MAP.box, MAP, [
        { axis: "x", name: "lag, samples", ticks: thin ? [0, 100, 200] : [0, 50, 100, 150, 200] },
      ]),
      ...axisLabels({ min: MAP.box.min, max: [WALL_X, MAP.box.max[1], MAP.box.max[2]] }, MAP, [
        { axis: "z", name: "candidate P", ticks: P_TICKS },
      ]),
    ]);
    parts.wallLabel.set([{ text: `score Ψ(P), ${lo} to ${hi}`, at: wallTop, align: "end", dy: -16 }]);
  };

  /** @type {ThreeContext | null} */
  let ctxRef = null;
  const describe = () => (v.mode === "clip"
    ? "Every frame of the input clip lr-b, its autocorrelation at lags 22 to 114 as a surface, lag across, time " +
      "running from the first frame at the front to the last at the back, height and colour the correlation. The site " +
      "tracker's period rides the ridge, with dashed lines 20% either side of the frame before. The highlighted " +
      `arrow is the tracker's step into ${chipText(v)}.`
    : "The autocorrelation φ as a curtain along depth, and for every candidate period from 22 to 114 samples, " +
      "set back by the candidate, a comb of stems at each multiple of it, standing on the curtain. The end wall " +
      `shows the score Ψ against the candidate. The highlighted comb is at ${chipText({ ...v, cand: shown.cand })}.`);

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    build: (c) => {
      ctxRef = c;
      labelKey = "";
      build(c);
    },
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) return null;
  ctxRef = ctx;
  const T = ctx.three;
  const vec = new T.Vector3();
  const dir = new T.Vector3();

  /** Corners of what each mode shows, for the fit away from a matched preset. */
  const extents = () => {
    const b = v.mode === "clip" ? CMAP.box : { min: MAP.box.min, max: /** @type {V3} */ ([WALL_X, MAP.box.max[1], MAP.box.max[2]]) };
    return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => /** @type {V3} */ ([0, 1, 2].map((a) => ((i >> a) & 1 ? b.max[a] : b.min[a]))));
  };
  /** The matched presets of the mode: the rectangle each fills. */
  const matched = () => {
    const L = layout(frame.clientWidth, frame.clientHeight);
    const b = MAP.box;
    if (v.mode === "clip") {
      const c = CMAP.box;
      return [{ axis: [0, -1, 0], rect: L.heat, box: { min: /** @type {V3} */ ([c.min[0], c.min[2], 0]), max: /** @type {V3} */ ([c.max[0], c.max[2], 0]) } }];
    }
    return [
      { axis: [0, 0, -1], rect: L.phi, box: b },
      // Side: the score alone, across the frame.
      { axis: [-1, 0, 0], rect: L.side, box: { min: /** @type {V3} */ ([b.min[2], b.min[1], 0]), max: /** @type {V3} */ ([b.max[2], b.max[1], 0]) } },
    ];
  };

  const fit = () => {
    const cam = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!cam.isOrthographicCamera || !W || !H) return;
    cam.updateMatrixWorld();
    cam.getWorldDirection(dir);
    // The nearest matched preset, and how far the camera is turned from it.
    let best = null;
    let angle = 180;
    for (const m of matched()) {
      const a = Math.acos(Math.min(1, Math.max(-1, dir.x * m.axis[0] + dir.y * m.axis[1] + dir.z * m.axis[2]))) * (180 / Math.PI);
      if (a < angle) [best, angle] = [m, a];
    }
    const front = dir.z < 0 ? Math.acos(Math.min(1, -dir.z)) * (180 / Math.PI) : 90;
    const side = dir.x < 0 ? Math.acos(Math.min(1, -dir.x)) * (180 / Math.PI) : 90;
    presence.front = v.mode === "clip" ? 1 : Math.min(1, front / 20);
    presence.side = v.mode === "clip" ? 1 : Math.min(1, side / 20);
    // Contain the box, one scale both ways, with room under it for the
    // tick labels (14 px under the edge) and names (30 px), which
    // lib/labels.js hides in the bottom 56 px of the frame.
    const M = W < 560 ? { l: 22, r: 18, t: 30, b: 76 } : { l: 34, r: 34, t: 30, b: 72 };
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const c of extents()) {
      vec.set(...c).applyMatrix4(cam.matrixWorldInverse);
      [x0, x1, y0, y1] = [Math.min(x0, vec.x), Math.max(x1, vec.x), Math.min(y0, vec.y), Math.max(y1, vec.y)];
    }
    const s = Math.max((x1 - x0) / (W - M.l - M.r), (y1 - y0) / (H - M.t - M.b));
    const cx = (x0 + x1) / 2 + ((M.r - M.l) * s) / 2;
    const cy = (y0 + y1) / 2 + ((M.t - M.b) * s) / 2;
    const contain = { left: cx - (W * s) / 2, right: cx + (W * s) / 2, bottom: cy - (H * s) / 2, top: cy + (H * s) / 2 };
    const k = best ? smooth(Math.min(1, angle / 12)) : 1;
    const exact = best ? frontFrustum({ width: W, height: H }, best.rect, best.box) : contain;
    for (const key of /** @type {const} */ (["left", "right", "top", "bottom"])) cam[key] = exact[key] + (contain[key] - exact[key]) * k;
    if (parts) fadeContext(parts);
  };

  /** @type {ReturnType<typeof createOrbit> | null} */
  let turn = null;
  const orbit = createOrbit(ctx, {
    target: [0, 0, 0], fit, distance: DISTANCE, zoom: opts.look.zoom || 1, presets: PRESETS,
    start: opts.intro ? "corner" : v.preset in PRESETS ? v.preset : "corner",
    onDrag: opts.onDrag,
    onChange: () => {
      probe.pose = turn?.pose() ?? null;
      probe.zoom = turn?.zoom() ?? 1;
      parts?.labels.update();
      parts?.wallLabel.update();
      parts?.rowChip.update();
    },
  });
  turn = orbit;
  probe.pose = orbit.pose();
  probe.set = (pose) => orbit.set(pose);

  /** @param {V3} at */
  const project = (at) => {
    vec.set(...at).project(ctx.camera);
    return { x: ((vec.x + 1) / 2) * frame.clientWidth, y: ((1 - vec.y) / 2) * frame.clientHeight };
  };
  probe.frontPoints = () => {
    ctx.camera.updateMatrixWorld();
    const z = MAP.z(shown.cand);
    return {
      rects: layout(frame.clientWidth, frame.clientHeight),
      pDomain: P_DOMAIN,
      phi: v.mode === "clip" ? [] : Array.from(v.phi, (y, lag) => ({ lag, v: y, ...project([MAP.x(lag), MAP.y(y), z]) })).filter((_, i) => i % 6 === 0),
      psi: v.mode === "clip" ? [] : Array.from(v.curve, (s, i) => ({ p: P_MIN + i, v: s, ...project([WALL_X, psiY(s), MAP.z(P_MIN + i)]) })).filter((_, i) => i % 4 === 0),
      heat: v.mode !== "clip" ? [] : [0, 46, 92].flatMap((m) => [0, 79, clip.frames - 1].map((f) => ({
        lag: clip.lag_min + m, f, ...project([CMAP.x(clip.lag_min + m), CMAP.y(clip.rows[f * lags + m] / 100), CMAP.z(f)]),
      }))),
      psiDomain: v.psiDomain,
    };
  };
  probe.counts = () => {
    let segments = 0;
    ctx.scene.traverse((o) => {
      const g = /** @type {any} */ (o).geometry;
      if (o.visible && g?.attributes?.instanceStart) segments += g.instanceCount ?? 0;
    });
    return { segments, draws: ctx.renderer.info.render.calls };
  };

  const timeline = ctx.timeline();
  if (opts.intro && v.mode === "frame") {
    probe.played = true;
    const target = v.cand;
    shown.sweep = P_MIN - 1;
    shown.cand = P_MIN;
    write();
    void timeline.play("intro", {
      ms: INTRO_MS, ease: "linear", build: true,
      step: (t) => {
        if (t > 0 && t < SWEEP_SHARE) probe.swept += 1;
        if (t < SWEEP_SHARE) {
          shown.sweep = P_MIN + ((P_MAX + DROP - P_MIN) * t) / SWEEP_SHARE;
          shown.cand = Math.min(P_MAX, Math.round(shown.sweep));
        } else {
          shown.sweep = Infinity;
          const u = smooth(Math.min(1, (t - SWEEP_SHARE) / (1 - SWEEP_SHARE)));
          shown.cand = t >= 1 ? v.cand : Math.round((P_MAX + (target - P_MAX) * u) * 10) / 10;
        }
        write();
      },
    }).then(() => {
      shown.sweep = Infinity;
      shown.cand = v.cand;
      write();
      void parts?.kit.pulse();
    });
  }

  await ctx.drawn();

  let labelTimer = /** @type {ReturnType<typeof setTimeout> | 0} */ (0);
  return {
    update: (next) => {
      const was = v;
      v = /** @type {PitchView} */ (next);
      if (was.source !== v.source || was.mode !== v.mode) {
        timeline.finish();
        shown.cand = v.cand;
        parts?.sheet.userData.recolour();
      }
      if (v.mode === "frame" && was.cand !== v.cand && was.source === v.source && was.mode === v.mode) {
        const from = shown.cand;
        void timeline.play("move", {
          ms: duration("slow") || 400, ease: "inout",
          step: (t) => {
            shown.cand = t >= 1 ? v.cand : from + (v.cand - from) * t;
            write();
          },
        }).then(() => void parts?.kit.pulse());
      } else if (v.mode === "clip" && was.row !== v.row) {
        write();
        void parts?.rowKit.pulse();
      } else {
        write();
      }
      orbit.set(orbit.pose());
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => {
        if (!ctx.parked) ctx.renderer?.domElement.setAttribute("aria-label", describe());
      }, 250);
    },
    preset: (name) => void orbit.go(name),
    describe,
    close: () => {
      clearTimeout(labelTimer);
      ctx.dispose();
    },
  };
}
