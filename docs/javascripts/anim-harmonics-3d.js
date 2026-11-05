// @ts-check
/* ===========================================================================
 * anim-harmonics-3d.js: the harmonics figure in 3D (three-everywhere design
 * §4.9). Every number comes from anim-harmonics.js.
 * ---------------------------------------------------------------------------
 * x is frequency (0 to 4 kHz), height the illustrative envelope at each
 * harmonic, depth the fundamental: 60 Hz at the back, 400 Hz at the
 * front. Front is the flat comb panel. The other fundamentals' combs are
 * dimmed, so the reader's f0 is the one bright comb. On the floor, ray k is x = k f0, the track of
 * harmonic k; the wall at the cutoff carries L for every fundamental.
 * Its animation: the comb sweeps from 400 Hz back to 60 Hz while the rays
 * draw and the staircase climbs, so a lower pitch packs more harmonics
 * under the same cutoff.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { CUTOFF_HZ, CUTOFF_LABEL } from "./lib/cutoff.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { FRONT, TOP, createOrbit, matchPlot } from "./lib/orbit.js";
import { toScene } from "./lib/scene.js";
import { contactShadow, darkGround, fatLines, floor, fog, mix, rampColor, setSegments, tokenHex } from "./lib/style.js";
import {
  NYQUIST_HZ as NQ, PITCH_MAX_HZ as HI, PITCH_MIN_HZ as LO, SEARCH_MAX_HZ, SEARCH_MIN_HZ, Y_MAX,
  envelopeAt, harmonicsFor, plotPad,
} from "./anim-harmonics.js";

/** @typedef {import("./anim-harmonics.js").HarmonicsState} State */
/** @typedef {import("./anim-three.js").ThreeContext} Ctx */
/** @typedef {import("three").Object3D} Obj */

const EX = 4;
const EY = 2.4;
const EZ = 2.6;
const map = toScene({ x: [0, NQ], y: [0, Y_MAX], z: [LO, HI] }, { x: EX, y: EY, z: EZ });
const { box } = map;
const Y0 = box.min[1];
const TOPY = box.max[1];
const XW = map.x(CUTOFF_HZ);
const KMAX = harmonicsFor(LO);
/** L on the wall: 0 to 66 over its height. @param {number} L */
const ly = (L) => Y0 + (L * EY) / 66;
const DIST = 10;
/** @type {Record<string, import("./lib/orbit.js").Pose>} */
const PRESETS = { front: FRONT, corner: { yaw: -36, pitch: 24 }, top: TOP, side: { yaw: -90, pitch: 0 } };
const VOICE = { lr: "male", lj: "female" };

/** Weight 0 within 3 degrees of a pose, 1 past 15. @param {number} d */
const away = (d) => Math.min(1, Math.max(0, (d - 3) / 12));

/** Context stems, every 10 Hz from 400 down to 60: [f0, k] pairs. */
const STEMS = (() => {
  const out = [];
  for (let f = HI; f >= LO; f -= 10) for (let k = 1; k * f < NQ; k += 1) out.push([f, k]);
  return out;
})();

/** The staircase, from 400 Hz back: segments, and the f0 each starts at. */
const STAIR = (() => {
  const xs = XW - 0.012;
  /** @type {number[]} */
  const seg = [];
  /** @type {number[]} */
  const at = [];
  for (let f = HI, L = harmonicsFor(HI); f > LO; L += 1) {
    const next = Math.max(LO, CUTOFF_HZ / (L + 1));
    seg.push(xs, ly(L), map.z(f), xs, ly(L), map.z(next));
    at.push(f);
    if (next > LO) {
      seg.push(xs, ly(L), map.z(next), xs, ly(L + 1), map.z(next));
      at.push(next);
    }
    f = next;
  }
  return { seg, at };
})();

/** @param {number} f @param {number} y @param {number} z @returns {number[]} */
const P = (f, y, z) => [map.x(f), y, z];

/**
 * The subject at Side, where the comb is edge-on: L at f0, from the floor
 * up the wall to the staircase.
 * @param {number} f0
 */
const stepPath = (f0) => [XW - 0.02, Y0, map.z(f0), XW - 0.02, ly(harmonicsFor(f0)), map.z(f0)];

/**
 * The comb at f0 as one path for the highlight: along the floor, up and
 * down each harmonic under the cutoff.
 * @param {number} f0
 */
function slicePath(f0) {
  const z = map.z(f0);
  const out = P(0, Y0, z);
  for (let k = 1; k * f0 < CUTOFF_HZ; k += 1) out.push(...P(k * f0, Y0, z), ...P(k * f0, map.y(envelopeAt(k * f0)), z), ...P(k * f0, Y0, z));
  return out.concat(P(CUTOFF_HZ, Y0, z));
}

/** Consecutive points to segment pairs. @param {number[]} p */
const pairs = (p) => {
  const out = [];
  for (let i = 3; i < p.length; i += 3) out.push(...p.slice(i - 3, i + 3));
  return out;
};

/**
 * three keeps the first draw's segment count (_maxInstanceCount) and never
 * grows it, so a line given more segments must forget it.
 * @param {Obj} obj
 */
const regrow = (obj) => obj.traverse((/** @type {any} */ n) => { if (n.geometry) delete n.geometry._maxInstanceCount; });
/** @param {any} line @param {number[]} segments */
const seg = (line, segments) => {
  setSegments(line, segments);
  regrow(line);
};

/**
 * A pitch as the readout prints it: a snapped median keeps its tenth, so
 * that L = floor(3700 / f0) checks against the printed number.
 * @param {number} f0
 */
const hz = (f0) => (Math.abs(f0 - Math.round(f0)) < 0.05 ? String(Math.round(f0)) : f0.toFixed(1));
/**
 * The chip's fact. While the sweep runs it counts in whole hertz.
 * @param {number} f0 @param {boolean} [sweeping]
 */
const chipText = (f0, sweeping = false) => `f₀ ${sweeping ? Math.round(f0) : hz(f0)} Hz: L = ${harmonicsFor(f0)} harmonics`;
/** The wall's L ticks and labels stand just past its front edge. */
const ZT = box.max[2] + 0.06;

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let s = /** @type {State} */ (opts.state);
  const hook = { builds: 0, pose: PRESETS.corner, zoom: 1, frontPoints: /** @type {number[][]} */ ([]), played: opts.intro, fades: { front: 1, side: 1 } };
  if (TEST_HOOK) TEST_HOOK.figures["harmonics-3d"] = hook;
  /** The sweep's front: context is revealed down to it. */
  let front = opts.intro ? HI : LO;
  /** The highlight's f0 while the intro runs; the reader's pitch otherwise. @type {number | null} */
  let hf = null;
  const f0of = () => hf ?? s.pitch;
  /** @type {any} */
  let o = {};
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;

  /** @param {Ctx} ctx */
  const build = (ctx) => {
    const T = ctx.three;
    hook.builds += 1;
    const root = new T.Group();
    ctx.scene.add(root);
    /** @param {Obj[]} list */
    const add = (...list) => root.add(...list);
    add(floor(ctx, { extent: box, step: [1, (EZ * 100) / (HI - LO)] }));
    add(contactShadow(ctx, { x: [box.min[0], XW], z: [box.min[2], box.max[2]], y: Y0 }));
    fog(ctx, DIST, EZ);

    // The other fundamentals' combs, on the ramp by harmonic number, dimmed
    // well toward the background so the reader's f0 is the one bright comb.
    const sheet = fatLines(ctx, STEMS.flatMap(([f, k]) => [...P(k * f, Y0, map.z(f)), ...P(k * f, map.y(envelopeAt(k * f)), map.z(f))]), () => {
      const bg = tokenHex("--ambe-plot-bg");
      const muted = tokenHex("--ambe-plot-muted");
      const ramp = Array.from({ length: KMAX }, (_, k) => rampColor(k / (KMAX - 1)));
      const ref = f0of();
      const cut = (orbit?.pose().pitch ?? 0) < 60;
      const dim = darkGround() ? 0.7 : 0.6;
      return STEMS.flatMap(([f, k]) => {
        let c = mix(k * f < CUTOFF_HZ ? ramp[k - 1] : muted, bg, dim);
        if (cut && f > ref) c = mix(c, bg, 0.15);
        return [c, c];
      });
    }, 1.25, { fog: true });

    // The rays: harmonic k's track, x = k f0, on the floor up to the cutoff.
    const fan = fatLines(ctx, new Array(KMAX * 6).fill(0), () => Array.from({ length: KMAX * 2 }, (_, i) => rampColor(Math.floor(i / 2) / (KMAX - 1))), 1.75);

    // The wall at the cutoff, its L grid and outline, the bracket shaded.
    const wall = new T.Mesh(new T.PlaneGeometry(EZ, EY), ctx.paint(new T.MeshBasicMaterial({ side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), "--ambe-3d-floor"));
    wall.rotation.y = Math.PI / 2;
    wall.position.x = XW;
    const shade = new T.Mesh(new T.PlaneGeometry(map.z(SEARCH_MAX_HZ) - map.z(SEARCH_MIN_HZ), EY), ctx.paint(new T.MeshBasicMaterial({ side: T.DoubleSide, depthWrite: false }), "--ambe-accent-soft"));
    shade.rotation.y = Math.PI / 2;
    shade.position.set(XW - 0.004, 0, map.z((SEARCH_MAX_HZ + SEARCH_MIN_HZ) / 2));
    const [z0, z1] = [box.min[2], box.max[2]];
    const grid = new T.LineSegments(new T.BufferGeometry(), ctx.paint(new T.LineBasicMaterial(), "--ambe-3d-grid"));
    grid.geometry.setAttribute("position", new T.Float32BufferAttribute([20, 40, 60].flatMap((L) => [XW - 0.006, ly(L), z0, XW - 0.006, ly(L), z1]), 3));
    const edge = fatLines(ctx, [XW, Y0, z1, XW, TOPY, z1, XW, TOPY, z1, XW, TOPY, z0, XW, TOPY, z0, XW, Y0, z0], "--ambe-border", 1.25, { dashed: true });
    const bracket = fatLines(ctx, [SEARCH_MIN_HZ, SEARCH_MAX_HZ].flatMap((f) => [...P(0, Y0, map.z(f)), XW, Y0, map.z(f), XW - 0.01, Y0, map.z(f), XW - 0.01, TOPY, map.z(f)]), "--ambe-plot-muted", 1.25, { dashed: true });
    const stair = fatLines(ctx, STAIR.seg, "--ambe-plot-ink", 2.5);
    const marker = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 1.25, { dashed: true });
    const medians = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 1.25, { dashed: true, dash: 0.03, gap: 0.04 });
    const envelope = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-data-3", 1.5, { dashed: true });
    const above = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-data-4", 1.25);
    // The harmonic the reader picked: its stem on the reader's comb, in ink
    // over the comb's highlight (amber is too close to it), and its ray on
    // the floor across every f0, in the amber the flat view uses.
    const picked = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 5, { depthTest: false });
    picked.renderOrder = 20;
    const ray = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-accent-warm", 3.5);
    ray.renderOrder = 5;
    add(sheet, fan, wall, shade, grid, edge, bracket, stair, marker, medians, envelope, above, picked, ray);

    const labels = createLabels(frame, ctx);
    ctx.track({ dispose: labels.dispose });
    o = { ctx, root, sheet, fan, stair, marker, medians, envelope, above, picked, ray, labels, kit: null, step: null, key: "" };
    /** Pose fades: [object, hidden near Front, hidden near Side]. */
    o.fades = [[sheet, 1, 1], [fan, 1, 1], [ray, 1, 1], [stair, 1, 0], [marker, 1, 1], [medians, 1, 0], [bracket, 1, 0], [shade, 1, 0], [grid, 1, 0], [envelope, 0, 1], [above, 0, 1]];
    root.userData.recolour = () => {
      for (const [obj] of o.fades) obj.traverse((/** @type {any} */ n) => { if (n.material && !n.material.vertexColors) n.material.userData.o = n.material.opacity; });
      pose();
    };
    refresh();
  };

  /** Everything that follows the state and the sweep's front. */
  const refresh = () => {
    if (!o.ctx) return;
    const f0 = f0of();
    const z = map.z(f0);
    const L = harmonicsFor(f0);
    if (!o.kit) {
      // Quiet, so the picked harmonic's stem stands out on it.
      o.kit = addHighlight(o.ctx, slicePath(f0), { baseline: Y0, chip: chipText(f0, hf !== null), fill: false, quiet: true });
      o.root.add(o.kit);
    } else {
      o.kit.set(slicePath(f0));
      regrow(o.kit);
      o.kit.chip?.set({ text: chipText(f0, hf !== null) });
    }
    if (!o.step) {
      o.step = addHighlight(o.ctx, stepPath(f0), { baseline: Y0, chip: chipText(f0, hf !== null), fill: false });
      o.root.add(o.step);
    } else {
      o.step.set(stepPath(f0));
      o.step.chip?.set({ text: chipText(f0, hf !== null) });
    }
    o.sheet.userData.recolour();
    o.sheet.geometry.instanceCount = STEMS.filter(([f]) => f >= front - 1e-6).length;
    o.stair.geometry.instanceCount = STAIR.at.filter((f) => f > front + 1e-6).length;
    seg(o.fan, Array.from({ length: KMAX }, (_, i) => {
      const k = i + 1;
      const top = Math.min(HI, CUTOFF_HZ / k);
      const end = Math.min(top, Math.max(front, LO));
      return [...P(k * top, Y0 + 0.004, map.z(top)), ...P(k * end, Y0 + 0.004, map.z(end))];
    }).flat());
    seg(o.marker, [XW - 0.012, Y0, z, XW - 0.012, ly(L), z]);
    const kp = Math.min(s.harmonic, L);
    seg(o.picked, [...P(kp * f0, Y0, z), ...P(kp * f0, map.y(envelopeAt(kp * f0)), z)]);
    // Ray k, x = k f0, as far as the fan has drawn: from where harmonic k
    // reaches the cutoff (or 400 Hz) back to the sweep's front.
    const rTop = Math.min(HI, CUTOFF_HZ / kp);
    const rEnd = Math.min(rTop, Math.max(front, LO));
    seg(o.ray, [...P(kp * rTop, Y0 + 0.008, map.z(rTop)), ...P(kp * rEnd, Y0 + 0.008, map.z(rEnd))]);
    seg(o.envelope, pairs(Array.from({ length: 161 }, (_, i) => P((i / 160) * NQ, map.y(envelopeAt((i / 160) * NQ)), z)).flat()));
    const high = [];
    for (let k = Math.ceil(CUTOFF_HZ / f0); k * f0 < NQ; k += 1) if (k * f0 >= CUTOFF_HZ) high.push(...P(k * f0, Y0, z), ...P(k * f0, map.y(envelopeAt(k * f0)), z));
    o.high = high.length > 0;
    if (high.length) seg(o.above, high);
    const stats = Object.entries(s.stats).filter(([, v]) => v);
    o.many = stats.length > 0;
    if (stats.length) {
      seg(o.medians, stats.flatMap(([, v]) => {
        const zm = map.z(v?.f0 ?? LO);
        const yl = ly(harmonicsFor(v?.f0 ?? LO));
        // Along the floor, up the wall to L, then along the wall at L to
        // its label past the front edge.
        return [...P(0, Y0 + 0.004, zm), XW, Y0 + 0.004, zm, XW - 0.012, Y0, zm, XW - 0.012, yl, zm, XW - 0.012, yl, zm, XW - 0.012, yl, ZT];
      }));
    }
    pose();
    o.ctx.requestRender();
  };

  /** Pose-driven fades, the labels that suit the pose, and the probe. */
  const pose = () => {
    if (!o.ctx || !orbit) return;
    const p = orbit.pose();
    const wF = away(Math.hypot(p.yaw, p.pitch));
    const wS = away(Math.hypot(p.yaw + 90, p.pitch));
    hook.fades = { front: wF, side: wS };
    for (const [obj, f, sd] of o.fades) {
      const w = (f ? wF : 1) * (sd ? wS : 1);
      obj.traverse((/** @type {any} */ n) => {
        const m = n.material;
        if (!m) return;
        m.userData.o ??= m.opacity;
        m.opacity = m.userData.o * w;
        m.transparent = m.opacity < 1;
      });
      obj.visible = w > 0.02 && (obj === o.above ? o.high : obj === o.medians ? o.many : true);
    }
    // The comb is the subject, except at Side, where it is edge-on: there
    // the subject is L at f0 on the staircase.
    const atSide = wS <= 0.5;
    o.kit.visible = !atSide;
    o.picked.visible = !atSide;
    o.kit.chip?.node.parentElement?.toggleAttribute("hidden", atSide);
    o.step.visible = atSide;
    o.step.chip?.node.parentElement?.toggleAttribute("hidden", !atSide);
    const f0 = f0of();
    const wallSeen = wF > 0.5 && p.pitch < 60;
    const top = p.pitch >= 60;
    const narrow = frame.clientWidth < 480;
    const key = `${wallSeen}${atSide}${top}${narrow}${Math.round(f0)}${Object.values(s.stats).map((v) => v?.f0).join()}`;
    if (key !== o.key) {
      o.key = key;
      const [z0, z1] = [box.min[2], box.max[2]];
      const kHz = { axis: /** @type {"x"} */ ("x"), name: "frequency (kHz)", ticks: [0, 1000, 2000, 3000], format: (/** @type {number} */ v) => String(v / 1000) };
      const list = axisLabels(box, map, [
        kHz,
        { axis: "z", name: top || narrow ? "fundamental\nf₀ (Hz)" : "fundamental f₀ (Hz)", ticks: [100, 200, 300, 400] },
      ]);
      if (top) {
        // In the row of the axis name, clear of the 400 Hz tick.
        list.push({ text: CUTOFF_LABEL, at: [XW, Y0, z1], align: "start", dy: 30 });
      } else if (!wallSeen) {
        // Front: the wall is a line; it is named where the flat view names it.
        list.push({ text: CUTOFF_LABEL, at: [XW, Y0, z1], align: "end", dy: -12 });
      }
      if (wallSeen) {
        // L reads off ticks just past the wall's front edge, clear of the
        // staircase, which is low there.
        for (const L of [20, 40, 60]) list.push({ text: String(L), at: [XW, ly(L), ZT], align: "start", tick: true });
        list.push({ text: `L, harmonics under the\n${CUTOFF_LABEL}`, at: [XW, TOPY, z0], align: "start", dy: -22 });
        if (atSide) {
          list.push({ text: "pitch search range", at: [XW, Y0, map.z((SEARCH_MAX_HZ + SEARCH_MIN_HZ) / 2)], align: "middle", dy: -12 });
        }
        if (atSide && !narrow) {
          list.push({ text: `${Math.round(8000 / SEARCH_MIN_HZ)} samples, ${Math.round(SEARCH_MIN_HZ)} Hz`, at: [XW, TOPY, map.z(SEARCH_MIN_HZ)], align: "start", dy: 12 });
          list.push({ text: `${Math.round(8000 / SEARCH_MAX_HZ)} samples, ${Math.round(SEARCH_MAX_HZ)} Hz`, at: [XW, TOPY, map.z(SEARCH_MAX_HZ)], align: "end", dy: 12 });
        }
        // The medians, each at its L past the front edge, joined to the
        // staircase along the wall. A phone leaves them to the line under
        // the controls.
        if (!narrow) {
          for (const [voice, v] of Object.entries(s.stats)) {
            if (v) list.push({ text: `${VOICE[/** @type {"lr" | "lj"} */ (voice)]} median, L = ${harmonicsFor(v.f0)}`, at: [XW, ly(harmonicsFor(v.f0)), ZT], align: "start" });
          }
        }
      }
      o.labels.set(list);
    }
    o.labels.update();
    if (TEST_HOOK) {
      const v = new o.ctx.three.Vector3();
      const w = frame.clientWidth;
      hook.pose = p;
      hook.zoom = orbit.zoom();
      hook.frontPoints = [];
      for (let k = 1; k * f0 < CUTOFF_HZ; k += 1) {
        v.set(map.x(k * f0), Y0, map.z(f0)).project(o.ctx.camera);
        hook.frontPoints.push([k * f0, ((v.x + 1) / 2) * w]);
      }
    }
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) return null;

  // Front fits the 2D comb panel's left and right, with room under the
  // floor for the kHz ticks. A turned pose centres the box in the frame,
  // with room at the right and the foot for the labels (the frame's bottom
  // 56 px take none); between the two the frustum blends.
  const fitted = matchPlot(ctx, () => {
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    const pad = plotPad(W);
    return { x: pad.left, y: pad.top, width: W - pad.left - pad.right, height: H - pad.top - 74 };
  }, box);
  const fit = () => {
    fitted.fit();
    const c = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const d = c.position.clone().sub(new ctx.three.Vector3(...fitted.target));
    const yaw = Math.atan2(d.x, d.z);
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    const [hx, hy, hz] = [EX / 2, EY / 2, EZ / 2];
    const sy = Math.abs(Math.sin(yaw));
    const cy = Math.abs(Math.cos(yaw));
    // Half the box's extent on screen, across and up, in scene units.
    const hw = hx * cy + hz * sy;
    const hh = hy * Math.cos(pitch) + (hx * sy + hz * cy) * Math.abs(Math.sin(pitch));
    const k = Math.max(1, hw / hx, hh / hy);
    const deg = 180 / Math.PI;
    const w = away(Math.hypot(yaw, pitch) * deg);
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    const side = 1 - away(Math.hypot(yaw * deg + 90, pitch * deg));
    const above = pitch * deg >= 60 ? 1 : 0;
    // The foot holds the f0 ticks and name at Side, and the kHz ones from the top.
    const m = { l: 12, r: W < 480 ? 64 : 116, t: 46, b: 66 + 26 * Math.max(side, above) };
    const u = Math.max((2 * hw) / (W - m.l - m.r), (2 * hh) / (H - m.t - m.b));
    const cx = m.l + (W - m.l - m.r) / 2;
    const cyp = m.t + (H - m.t - m.b) / 2;
    const centred = { left: -cx * u, right: (W - cx) * u, top: cyp * u, bottom: -(H - cyp) * u };
    for (const edge of /** @type {const} */ (["left", "right", "top", "bottom"])) c[edge] = c[edge] * k * (1 - w) + centred[edge] * w;
  };
  let lastPitch = 0;
  orbit = createOrbit(ctx, {
    target: fitted.target, fit, distance: DIST, zoom: opts.look.zoom, presets: PRESETS, start: "corner",
    onDrag: opts.onDrag,
    onChange: () => {
      if (!o.ctx) return;
      const p = orbit?.pose().pitch ?? 0;
      // The cutaway rule changes side at 60 degrees of pitch.
      if ((p < 60) !== (lastPitch < 60)) {
        o.sheet.userData.recolour();
      }
      lastPitch = p;
      pose();
    },
  });
  refresh();

  if (opts.intro) {
    orbit.set(FRONT);
    hf = HI;
    refresh();
  }
  await ctx.drawn();
  if (opts.intro) {
    // In turn, so each reads: the camera turns from Front to the corner;
    // the comb sweeps from 400 Hz back to 60 Hz (the rays draw and the
    // staircase climbs, the chip counting L); it holds there; then it
    // returns to the reader's pitch. About 5 s, once. It starts after the
    // first draw, so a slow first frame does not eat into it.
    const cam = duration("3d-camera");
    const sweep = (duration("3d-build") * 10) / 3;
    const hold = cam;
    const total = cam + sweep + hold + cam;
    const to = PRESETS.corner;
    /** @param {number} u */
    const inout = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
    /** @param {number} v */
    const unit = (v) => Math.min(1, Math.max(0, v));
    void ctx.timeline().play("sweep", {
      ms: total,
      ease: "linear",
      build: true,
      step: (t) => {
        const ms = t * total;
        const e = inout(unit(ms / cam));
        orbit?.set({ yaw: to.yaw * e, pitch: to.pitch * e });
        front = HI * (LO / HI) ** inout(unit((ms - cam) / sweep));
        const r = unit((ms - cam - sweep - hold) / cam);
        hf = t >= 1 ? null : r > 0 ? LO * (s.pitch / LO) ** (r * r * (3 - 2 * r)) : front;
        refresh();
      },
    });
  }

  /** The canvas label, 250 ms after the last change. */
  let timer = 0;
  function describe() {
    const f0 = s.pitch;
    return `Harmonic combs for every fundamental from 60 to 400 Hz, laid out in depth, on an illustrative envelope. ` +
      `The thick, outlined comb is the fundamental ${hz(f0)} Hz: L = ${harmonicsFor(f0)} harmonics under the ${CUTOFF_LABEL}. ` +
      `On it, harmonic ${Math.min(s.harmonic, harmonicsFor(f0))} is drawn thicker still. ` +
      "Rays on the floor follow each harmonic, and the staircase on the wall at the cutoff gives L for every fundamental.";
  }

  return {
    update: (next) => {
      const was = s;
      s = /** @type {State} */ (next);
      if (was.pitch === s.pitch && was.harmonic === s.harmonic && was.voice === s.voice && was.stats.lr === s.stats.lr && was.stats.lj === s.stats.lj) return;
      refresh();
      if (s.voice !== was.voice && s.voice) void (o.step?.visible ? o.step : o.kit)?.pulse();
      clearTimeout(timer);
      // Parked, the view has no renderer: the runtime carries the label
      // across the park, and build() on unpark labels it afresh.
      timer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
    },
    preset: (name) => void orbit?.go(name),
    describe,
    close: () => {
      clearTimeout(timer);
      ctx.dispose();
    },
  };
}
