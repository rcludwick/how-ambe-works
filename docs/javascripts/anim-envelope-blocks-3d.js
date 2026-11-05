// @ts-check
/* ===========================================================================
 * anim-envelope-blocks-3d.js: the envelope-blocks figure's 3D view.
 * ---------------------------------------------------------------------------
 * Loaded by anim-envelope-blocks.js through lib/view-switch.js, only when a
 * 3D view is wanted. Depth is k, the number of DCT coefficients kept per
 * block: every coefficient at the front (the frame's own amplitudes),
 * one per block at the back (the block means, the tilt). Each slice is in
 * the flat view's units, so the Front preset with the selected slice is the
 * flat view. The level is a bar at the right, past a divider, that runs
 * the whole depth at one height: no k changes it.
 *
 * The explanatory animation (O1, once on first view): "Keeping fewer
 * coefficients loses detail first, tilt next, level never." From the front,
 * the slices peel back one k at a time, each morphing from the one in front
 * of it, while the camera turns to Oblique and the level bar runs back with
 * them at one height. The end state, every slice in place, carries the
 * same point without the motion.
 *
 * It computes no model data: every array comes from the 2D module's state.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { disposeScene, duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { FRONT, createOrbit, matchPlot } from "./lib/orbit.js";
import { axisFrame, toScene } from "./lib/scene.js";
import { contactShadow, fade, fatLines, floor, fog, mix, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-envelope-blocks.js").BlocksState} BlocksState */
/** @typedef {import("./anim-envelope-blocks.js").BlocksModel} BlocksModel */

const SLUG = "envelope-blocks";
/** Scene size of the data box: harmonics across, dB up, k in depth. */
const EXTENT = { x: 4.2, y: 2, z: 1.6 };
const DISTANCE = 9;
/** @type {Record<string, import("./lib/orbit.js").Pose>} */
const PRESETS = { front: FRONT, oblique: { yaw: 28, pitch: 22 } };
/** Context in front of the highlight takes this much more fade (cutaway rule). */
const IN_FRONT = 0.15;
/** The block names show within this many degrees of Front. */
const NAMES_WITHIN = 8;
/** Below this camera pitch the cutaway rule holds (degrees). */
const CUTAWAY_PITCH = 60;

/**
 * A round point mask, 32 px: a disc, or a ring of the given inner radius.
 * The points' colour is their material or vertex colour, untouched.
 * @param {number} inner  0 for a solid disc
 */
function pointMask(inner) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const pixels = g.createImageData(32, 32);
  for (let i = 0; i < 32 * 32; i += 1) {
    const r = Math.hypot((i % 32) - 15.5, Math.floor(i / 32) - 15.5);
    pixels.data.set(r <= 15 && r >= inner ? [255, 255, 255, 255] : [0, 0, 0, 0], i * 4);
  }
  g.putImageData(pixels, 0, 0);
  return canvas;
}

/** @type {{builds: number, played: number}} */
const counts = { builds: 0, played: 0 };

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let state = /** @type {BlocksState} */ (opts.state);
  let model = state.model;
  let k = state.k;
  /** progress[k - 1]: how far slice k has peeled back from the one in front (1: in place). */
  let progress = new Float64Array(model.kMax).fill(1);
  /** Whether the cutaway rule holds at the current pitch (see look()). */
  let cutaway = Math.abs(PRESETS[state.preset].pitch) < CUTAWAY_PITCH;
  /** Scene mapping for the current model (the box stays the same size). */
  let m = toScene({ x: model.xDomain, y: model.yDomain, z: [1, Math.max(2, model.kMax)] }, EXTENT);

  /** @type {ReturnType<typeof parts> | null} */
  let built = null;
  /** @type {import("./lib/orbit.js").Orbit | null} */
  let orbit = null;
  /** The parts of the current build (a park or a restore makes new ones). */
  const scene = () => built;

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
    build: (c) => {
      built = parts(c);
      counts.builds += 1;
    },
  });
  if (!ctx) return null;

  /**
   * Everything in the scene. The highlight and the labels live as long as
   * the build; the rest sits in `root` and is made again for a new frame.
   * @param {import("./anim-three.js").ThreeContext} c
   */
  function parts(c) {
    const T = c.three;
    const root = new T.Group();
    c.scene.add(root);
    const labels = createLabels(c.frame, c);
    c.track({ dispose: labels.dispose });
    const highlight = addHighlight(c, slicePoints(k), { baseline: m.box.min[1], chip: state.chip });
    c.scene.add(highlight);
    fog(c, DISTANCE, 5);
    /** @type {{family: import("three/addons/lines/LineSegments2.js").LineSegments2,
     *          dots: import("three").Points, rings: import("three").Points, bar: import("three").Mesh,
     *          barEdge: import("three/addons/lines/LineSegments2.js").LineSegments2} | null} */
    let data = null;
    /** @type {import("./lib/labels.js").Label[]} */
    let axes = [];
    /** @type {import("./lib/labels.js").Label[]} */
    let named = [];
    /** Whether the block names are in the label layer now (null: not set yet). */
    /** @type {boolean | null} */
    let showNames = null;

    /** The parts that depend on the frame: made again when it changes. */
    const fill = () => {
      disposeScene(root);
      const box = m.box;
      const [x0, y0, z0] = box.min;
      const [, , z1] = box.max;
      const unit = EXTENT.x / (model.xDomain[1] - model.xDomain[0]);
      /** The divider between harmonic L and the level bar's gutter. */
      const edge = m.x(model.L + 0.5);
      root.add(floor(c, { extent: box, step: [unit * 5, EXTENT.z / Math.max(1, model.kMax - 1)] }));
      root.add(contactShadow(c, { x: [x0, edge], z: [z0, z1], y: y0 }));
      // Block edges on the back wall and the floor, every other block tinted.
      /** @type {number[]} */
      const edges = [];
      /** @type {number[]} */
      const tints = [];
      let at = 1;
      model.sizes.forEach((size, b) => {
        const a = m.x(at - 0.5);
        const e = m.x(at + size - 0.5);
        edges.push(a);
        if (b % 2 === 0) tints.push(a, e);
        at += size;
      });
      edges.push(edge);
      root.add(axisFrame(c, box, { xs: edges, ys: ticksY().map(m.y), floor: true, back: true }));
      // Each tinted block on the floor and on the back wall (the flat view's bands).
      const tintPositions = new Float32Array((tints.length / 2) * 36);
      const y1 = box.max[1];
      for (let i = 0; i < tints.length; i += 2) {
        const [a, e] = [tints[i], tints[i + 1]];
        const y = y0 + 1e-3;
        const z = z0 - 0.02;
        tintPositions.set([a, y, z0, e, y, z0, e, y, z1, a, y, z0, e, y, z1, a, y, z1,
          a, y0, z, e, y0, z, e, y1, z, a, y0, z, e, y1, z, a, y1, z], i * 18);
      }
      const narrow = c.frame.clientWidth < 520;
      // Block names along the front of the floor, as the flat view puts
      // them at the foot of each band: the top is the chip's. Only near
      // Front (look()); turned, the floor's front edge carries the ticks
      // and the alternate bands alone mark the blocks.
      /** @type {import("./lib/labels.js").Label[]} */
      const blockNames = [];
      at = 1;
      model.sizes.forEach((size, b) => {
        blockNames.push({ text: narrow ? String(b + 1) : `block ${b + 1}`, at: [m.x(at + (size - 1) / 2), y0, z1], align: "middle", dy: -11, tick: true });
        at += size;
      });
      const tintGeometry = new T.BufferGeometry();
      tintGeometry.setAttribute("position", new T.BufferAttribute(tintPositions, 3));
      root.add(new T.Mesh(tintGeometry, c.paint(new T.MeshBasicMaterial({
        side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }), "--ambe-surface-2")));

      // The slices: one thin line per k on the ramp, and a small dot per
      // harmonic, context to the rings and the highlight.
      const family = fatLines(c, sliceSegments(), () => sliceColours(2 * (model.L - 1)), 1.25, { fog: true });
      const dots = new T.Points(new T.BufferGeometry(), new T.PointsMaterial({
        size: 4, sizeAttenuation: false, vertexColors: true, map: new T.CanvasTexture(pointMask(0)), alphaTest: 0.5,
      }));
      dots.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(model.kMax * model.L * 3), 3));
      dots.geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(model.kMax * model.L * 3), 3));
      const colour = new T.Color();
      dots.userData.recolour = () => {
        const rgb = /** @type {import("three").BufferAttribute} */ (dots.geometry.getAttribute("color"));
        const hexes = sliceColours(model.L);
        hexes.forEach((hex, i) => {
          colour.setHex(hex);
          rgb.setXYZ(i, colour.r, colour.g, colour.b);
        });
        rgb.needsUpdate = true;
      };
      dots.userData.recolour();
      dots.frustumCulled = false;
      family.frustumCulled = false;
      // The frame's own amplitudes, mean removed: ink rings on the front
      // plane, as the flat view draws them, at every pose.
      const rings = new T.Points(new T.BufferGeometry(), c.paint(new T.PointsMaterial({
        size: 8, sizeAttenuation: false, map: new T.CanvasTexture(pointMask(10.5)), alphaTest: 0.5,
      }), "--ambe-plot-ink"));
      rings.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(
        model.exact.flatMap((v, i) => [m.x(i + 1), m.y(v), m.z(model.kMax)])), 3));
      rings.renderOrder = 5;

      // The level: a bar at the right, past the divider, as deep as the
      // slices, at one height.
      // See-through, so the slices' right ends behind it still show when turned.
      const barFace = c.paint(new T.MeshBasicMaterial({ depthWrite: false }), "--ambe-plot-muted");
      const bar = new T.Mesh(new T.BoxGeometry(1, 1, 1), barFace);
      // After paint() sets the token's colour and opacity, on every theme change.
      bar.userData.recolour = () => {
        barFace.transparent = true;
        barFace.opacity = 0.6;
      };
      bar.userData.recolour();
      const barEdge = fatLines(c, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 2, {});
      // The bar's track, the whole of its own scale, on the front face.
      const [ta, tb] = [m.x(model.bar[0]), m.x(model.bar[1])];
      const [, ty1] = [y0, box.max[1]];
      const track = new T.BufferGeometry();
      track.setAttribute("position", new T.BufferAttribute(new Float32Array([
        ta, y0, z1, ta, ty1, z1, ta, ty1, z1, tb, ty1, z1, tb, ty1, z1, tb, y0, z1,
      ]), 3));
      root.add(family, dots, rings, bar, barEdge, new T.LineSegments(track, c.paint(new T.LineBasicMaterial(), "--ambe-plot-axis")));
      data = { family, dots, rings, bar, barEdge };

      const barMid = m.x((model.bar[0] + model.bar[1]) / 2);
      const fives = Array.from({ length: Math.floor(model.L / 5) }, (_, i) => (i + 1) * 5);
      // At phone width every other inner tick goes, the last one stays.
      const xTicks = narrow ? [1, ...fives.filter((v, i) => i % 2 === 1 || i === fives.length - 1)] : [1, ...fives];
      axes = [
        ...axisLabels(box, m, [
          { axis: "x", name: narrow ? "harmonic\nnumber" : "harmonic number", ticks: xTicks },
          { axis: "y", name: "dB", ticks: ticksY(), format: (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0") },
          { axis: "z", name: narrow ? "coefficients\nkept" : "coefficients kept\nper block", ticks: Array.from({ length: model.kMax }, (_, i) => i + 1) },
        ]).filter((l) => l.text !== "dB"),
        // The dB axis's name above its top tick, so no tick yields to it.
        { text: "dB", at: [x0, y1, z1], align: "end", dy: -16 },
        // The level as the flat view has it, its name and value over the
        // bar; at the bar's back, so when turned it is clear of the slices'
        // right ends and of the depth axis's ticks under the bar.
        { text: `level\n${signed(model.level)}`, at: [barMid, m.y(model.levelTop), z0], align: "middle", dy: -20 },
      ];
      named = blockNames;
      showNames = null;
    };

    /** Write every moving part from `progress` and `k`. */
    const place = () => {
      if (!data) return;
      setSegments(data.family, sliceSegments());
      const position = /** @type {import("three").BufferAttribute} */ (data.dots.geometry.getAttribute("position"));
      for (let s = 0; s < model.kMax; s += 1) {
        const p = shown(s + 1);
        for (let i = 0; i < model.L; i += 1) position.setXYZ(s * model.L + i, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      }
      position.needsUpdate = true;
      data.dots.geometry.computeBoundingSphere();
      // The bar runs from the front slice back to the deepest one shown.
      const zFront = m.z(model.kMax);
      const zBack = shown(1)[2];
      const xa = m.x(model.bar[0]);
      const xb = m.x(model.bar[1]);
      const yb = m.box.min[1];
      const yt = m.y(model.levelTop);
      const depth = Math.max(1e-3, zFront - zBack);
      data.bar.scale.set(xb - xa, Math.max(1e-3, yt - yb), depth);
      data.bar.position.set((xa + xb) / 2, (yb + yt) / 2, zFront - depth / 2);
      setSegments(data.barEdge, [
        xa, yt, zFront, xb, yt, zFront, xb, yt, zFront, xb, yt, zBack,
        xb, yt, zBack, xa, yt, zBack, xa, yt, zBack, xa, yt, zFront,
        xb, yb, zFront, xb, yt, zFront,
      ]);
      highlight.set(shown(k));
      look();
    };

    /**
     * At Front only the selected slice and the rings show, as in the flat
     * view. Below CUTAWAY_PITCH the slices in front of the highlight take
     * the extra fade and drop their dots (the cutaway rule).
     */
    const look = () => {
      if (!data) return;
      const pose = orbit?.pose() ?? PRESETS[state.preset];
      const front = Math.abs(pose.yaw) < 0.5 && Math.abs(pose.pitch) < 0.5;
      const cut = Math.abs(pose.pitch) < CUTAWAY_PITCH;
      const near = Math.abs(pose.yaw) < NAMES_WITHIN && Math.abs(pose.pitch) < NAMES_WITHIN;
      if (near !== showNames) {
        showNames = near;
        labels.set(near ? [...axes, ...named] : axes);
      }
      data.family.visible = !front;
      data.dots.visible = !front;
      data.dots.geometry.setDrawRange(0, (cut ? k : model.kMax) * model.L);
      if (cut !== cutaway) {
        cutaway = cut;
        recolour();
      }
      c.requestRender();
    };

    const recolour = () => {
      data?.family.userData.recolour?.();
      data?.dots.userData.recolour?.();
    };

    fill();
    place();
    return { fill, place, recolour, highlight, labels, look };
  }

  /** dB ticks every 10 within the y domain. */
  function ticksY() {
    const out = [];
    const every = frame.clientWidth < 520 ? 20 : 10;
    for (let v = Math.ceil(model.yDomain[0] / every) * every; v <= model.yDomain[1]; v += every) out.push(v);
    return out;
  }

  /** @param {number} v */
  function signed(v) {
    return v < 0 ? `−${Math.abs(v).toFixed(1)}` : v.toFixed(1);
  }

  /**
   * Slice kk where it sits now: in place at progress 1, on the slice in
   * front of it at 0, so the stack opens like a fan from the front.
   * @param {number} kk
   * @returns {number[]} flat x, y, z per harmonic
   */
  function shown(kk) {
    const own = slicePoints(kk);
    if (kk >= model.kMax) return own;
    const t = progress[kk - 1];
    if (t >= 1) return own;
    const ahead = shown(kk + 1);
    return own.map((v, i) => ahead[i] + (v - ahead[i]) * t);
  }

  /**
   * Slice kk in place, in scene units.
   * @param {number} kk
   * @returns {number[]}
   */
  function slicePoints(kk) {
    const values = model.slices[kk - 1];
    /** @type {number[]} */
    const out = [];
    values.forEach((v, i) => out.push(m.x(i + 1), m.y(v), m.z(kk)));
    return out;
  }

  /** Every slice as consecutive segment pairs, slice 1 first. */
  function sliceSegments() {
    /** @type {number[]} */
    const out = [];
    for (let kk = 1; kk <= model.kMax; kk += 1) {
      const p = shown(kk);
      for (let i = 0; i + 1 < model.L; i += 1) out.push(...p.slice(i * 3, i * 3 + 6));
    }
    return out;
  }

  /**
   * One colour per vertex, `per` vertices a slice: the ramp by k, faded by
   * distance from the selected k, and further in front of it while the
   * cutaway rule holds.
   * @param {number} per
   * @returns {number[]}
   */
  function sliceColours(per) {
    const ground = tokenHex("--ambe-plot-bg");
    /** @type {number[]} */
    const out = [];
    for (let kk = 1; kk <= model.kMax; kk += 1) {
      const base = fade(rampColor((kk - 1) / Math.max(1, model.kMax - 1)), kk - k);
      const hex = kk > k && cutaway ? mix(base, ground, IN_FRONT) : base;
      for (let i = 0; i < per; i += 1) out.push(hex);
    }
    return out;
  }

  // The camera: Front is the flat view (matchPlot). Away from Front the
  // frustum is fitted to the turned box instead, with room below for the
  // axis labels, blended in over the first 10 degrees so a turn is smooth.
  const fitted = matchPlot(ctx, () => state.rect(frame.clientWidth, frame.clientHeight), m.box);
  const corner = new ctx.three.Vector3();
  const fit = () => {
    fitted.fit();
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const pose = orbit?.pose() ?? PRESETS[state.preset];
    const away = Math.min(1, Math.hypot(pose.yaw, pose.pitch) / 10);
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (!away || !w || !h) return;
    camera.updateMatrixWorld();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 8; i += 1) {
      corner.set(m.box[i & 1 ? "max" : "min"][0], m.box[i & 2 ? "max" : "min"][1], m.box[i & 4 ? "max" : "min"][2]);
      corner.applyMatrix4(camera.matrixWorldInverse);
      x0 = Math.min(x0, corner.x);
      x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
    }
    const narrow = w < 520;
    // The bottom keeps the tick row and the axis names above the 56 px
    // that lib/labels.js keeps clear.
    const pad = { left: narrow ? 30 : 48, right: narrow ? 56 : 100, top: 30, bottom: 76 };
    const u = Math.max((x1 - x0) / (w - pad.left - pad.right), (y1 - y0) / (h - pad.top - pad.bottom));
    const cx = (x0 + x1) / 2 + ((pad.right - pad.left) * u) / 2;
    const cy = (y0 + y1) / 2 + ((pad.top - pad.bottom) * u) / 2;
    const turned = { left: cx - (w * u) / 2, right: cx + (w * u) / 2, top: cy + (h * u) / 2, bottom: cy - (h * u) / 2 };
    for (const key of /** @type {const} */ (["left", "right", "top", "bottom"])) {
      camera[key] += (turned[key] - camera[key]) * away;
    }
  };
  orbit = createOrbit(ctx, {
    target: fitted.target, fit, distance: DISTANCE, zoom: opts.look.zoom || 1, presets: PRESETS,
    start: state.preset, onDrag: opts.onDrag, onChange: () => {
      scene()?.labels.update();
      scene()?.look();
    },
  });
  const turn = orbit;

  const timeline = ctx.timeline();
  if (opts.intro) {
    counts.played += 1;
    // Every slice behind the front one starts on it; the front one is in place.
    progress.fill(0);
    progress[model.kMax - 1] = 1;
    scene()?.place();
    const to = PRESETS[state.preset];
    turn.set(FRONT);
    const peel = Math.max(1, model.kMax - 1);
    void timeline.play("camera", {
      ms: duration("3d-camera"), ease: "inout", build: true, delay: 150,
      step: (t) => turn.set({ yaw: FRONT.yaw + (to.yaw - FRONT.yaw) * t, pitch: FRONT.pitch + (to.pitch - FRONT.pitch) * t }),
    });
    void timeline.play("peel", {
      ms: duration("3d-build") / 2, ease: "ease", build: true, delay: 350, count: peel, stagger: 600 / peel,
      step: (t, i) => {
        progress[model.kMax - 2 - i] = t;
        if (i === peel - 1) scene()?.place();
      },
    }).then(() => scene()?.highlight.pulse());
  }

  const probe = {
    get builds() { return counts.builds; },
    get played() { return counts.played; },
    get pose() { return turn.pose(); },
    get zoom() { return turn.zoom(); },
    /** How far each slice has peeled back, slice 1 first (1: in place). */
    get progress() { return Array.from(progress); },
    /** The selected slice in place, projected now, CSS px in the frame. */
    get frontPoints() {
      const v = new ctx.three.Vector3();
      ctx.camera.updateMatrixWorld();
      const p = slicePoints(k);
      /** @type {[number, number][]} */
      const out = [];
      for (let i = 0; i < p.length; i += 3) {
        v.set(p[i], p[i + 1], p[i + 2]).project(ctx.camera);
        out.push([((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight]);
      }
      return out;
    },
  };
  if (TEST_HOOK) TEST_HOOK.figures[`${SLUG}-3d`] = probe;

  let labelTimer = 0;
  ctx.viewSignal.addEventListener("abort", () => clearTimeout(labelTimer), { once: true });
  await ctx.drawn();

  /** The sentence for the 3D canvas's label. */
  function describe() {
    return `3D view of frame ${model.frame}: one slice for each number of DCT coefficients kept per block, ` +
      `from all ${model.kMax} at the front to 1 at the back. The slice with ${state.chip} is highlighted. ` +
      `The level bar, ${signed(model.level)} dBFS, has the same height at every depth.`;
  }

  return {
    update: (next) => {
      const s = /** @type {BlocksState} */ (next);
      timeline.finish();
      const frameChanged = s.model !== model;
      const kChanged = s.k !== k;
      state = s;
      model = s.model;
      k = s.k;
      if (frameChanged) {
        progress = new Float64Array(model.kMax).fill(1);
        m = toScene({ x: model.xDomain, y: model.yDomain, z: [1, Math.max(2, model.kMax)] }, EXTENT);
        scene()?.fill();
      } else {
        scene()?.recolour();
      }
      scene()?.highlight.chip?.set({ text: s.chip });
      scene()?.place();
      clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => {
        ctx.frame.querySelector("canvas.anim-figure__canvas--3d")?.setAttribute("aria-label", describe());
      }, 250);
      if (kChanged || frameChanged) void scene()?.highlight.pulse();
    },
    preset: (name) => void turn.go(name),
    describe,
    close: () => {
      if (TEST_HOOK && TEST_HOOK.figures[`${SLUG}-3d`] === probe) delete TEST_HOOK.figures[`${SLUG}-3d`];
      ctx.dispose();
    },
  };
}
