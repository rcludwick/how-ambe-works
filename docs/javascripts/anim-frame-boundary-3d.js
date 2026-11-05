// @ts-check
/* ===========================================================================
 * anim-frame-boundary-3d.js: the frame-boundary figure's 3D view
 * (three-everywhere §5.7, plan N7).
 * ---------------------------------------------------------------------------
 * x is time across the 20 ms between the frames, y the level (the 2D plot's
 * -1.1 to 1.1), depth the harmonic number: harmonic 1 at the front, 16 at
 * the back, one lane each, on the ramp by l. Each lane is its envelope as a
 * line over a frosted ribbon from zero, with the waveform inside it for
 * harmonics 1 to 4 under a switch; harmonics 9 to 12 going unvoiced are dashed. The
 * patent's gate is a plane between lanes 7 and 8: in front of it the
 * harmonics a sweep may take, behind it the ones it always crossfades. It
 * is drawn solid while the pitch gate holds and as a dashed outline when the
 * pitch has moved too far. Per-lane labels give each harmonic's
 * l x delta_f, how far its old and new frequencies sit apart.
 *
 * Presets: Front (ribbons, plane and bars hidden, leaving the 2D plot:
 * matchPlot puts the box on its rectangle, and the plot's axes and labels
 * are drawn over it), Oblique, and Side, where each lane is seen edge on
 * and a bar hangs from level 1 down to its lowest envelope: the depth of
 * its dip, by harmonic, with each lane's number and l x delta_f above it.
 * The highlight is each rule's subject (topOf in anim-frame-boundary.js):
 * harmonic 8, harmonic 4 once the pitch gate closes, harmonic 10 in the
 * voicing change. Lane labels wait while the camera turns between presets.
 *
 * Animation (once, on first view): from Front, the rule runs across the
 * 20 ms on every lane at once, so the envelopes dip together; then the
 * camera turns to Side while the dips drop as bars. A change of rule or
 * pitch morphs the lanes to their new shapes.
 * The model comes from anim-frame-boundary.js; nothing here computes it.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { EXTENT, WAVE_DIM, chipText, layout, showsWaves } from "./anim-frame-boundary.js";
import { CARRIERS, F_OLD, GATE_L, HANDOVER, LANES, T_MS } from "./lib/boundary.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { FRONT, SIDE, createOrbit, matchPlot } from "./lib/orbit.js";
import { contactShadow, fade, fatLines, floor, fog, mix, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-frame-boundary.js").Model} Model */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */

/** Scene size: time across, level up, harmonic number deep. */
const EX = 3.2;
const EY = 1.6;
const EZ = 3.2;
/** Lanes take every other sample (161 points over the 20 ms). */
const STRIDE = 2;
/** A bar's half width, as a share of the lane spacing. */
const BAR = 0.34;

/** @type {Record<string, import("./lib/orbit.js").Pose>} */
const PRESETS = { front: FRONT, oblique: { yaw: 30, pitch: 26 }, side: SIDE };

const DZ = EZ / LANES;
/** @param {number} l harmonic @returns {number} scene z: harmonic 1 at the front */
const zOf = (l) => EZ / 2 - (l - 0.5) * DZ;
/** @param {number} t ms */
const xOf = (t) => (t / T_MS) * EX - EX / 2;
/** @param {number} v level */
const yOf = (v) => (v / EXTENT) * (EY / 2);
const FLOOR = -EY / 2;
/** Where a hidden segment waits: far below the frame, clipped. */
const OFF = -100;
/** Between lanes 7 and 8. */
const GATE_Z = zOf(GATE_L - 0.5);
const BOX = {
  min: /** @type {[number, number, number]} */ ([-EX / 2, -EY / 2, -EZ / 2]),
  max: /** @type {[number, number, number]} */ ([EX / 2, EY / 2, EZ / 2]),
};
/** The stage's floor sits at level 0 under the envelopes; a switch lowers it to -1.1 for the waveforms. */
const STAGE = {
  min: /** @type {[number, number, number]} */ ([-EX / 2, 0, -EZ / 2]),
  max: /** @type {[number, number, number]} */ ([EX / 2, EY / 2, EZ / 2]),
};
/** The front face, where the Front axes are drawn. */
const FACE_Z = EZ / 2;

/** @param {number} a @param {number} b @param {number} t */
const span = (a, b, t) => Math.min(1, Math.max(0, (t - a) / (b - a)));
/** @param {number} u */
const inout = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let m = /** @type {Model} */ (opts.state);
  /** The lanes as drawn: the model's arrays, or a morph toward them. */
  let env = m.lanes.map((l) => Float32Array.from(l.env));
  let wave = m.lanes.map((l) => (l.wave ? Float32Array.from(l.wave) : null));
  /** How far across the 20 ms the lanes are drawn (the intro), 0 to 1. */
  let drawn = 1;
  /** How far the bars have dropped (the intro), 0 to 1. */
  let dropped = 1;
  /** The playhead's time, ms, or -1 when hidden. */
  let head = -1;
  let builds = 0;
  let played = 0;
  /** 1 at Front, 0 away from it; 1 at Side. */
  let front = 0;
  let side = 1;
  let pitch = 0;
  let shownAs = "";
  /** Camera turns under way (a preset flight or the intro's turn): the lane labels wait for them. */
  let turning = 0;
  let introTurn = false;

  /** @type {{ribbons: any, lanes: any, dashed: any, waves: any, plane: any, edge: any, bars: any, barEdge: any, rule: any,
   *          playhead: any, highlight: any, hiFill: any, hiOutline: any, labels: any, stage: any, axes: any, cut: any,
   *          front: {layer: HTMLElement, items: {node: HTMLElement, at: [number, number, number], ax: number, ay: number, dx: number, dy: number}[]}} | null} */
  let s = null;

  const n = Math.ceil(m.ts.length / STRIDE);
  /** Points of a lane drawn so far (the intro draws them left to right). */
  const count = () => Math.max(2, Math.round(drawn * (n - 1)) + 1);
  /** @param {number} j */
  const sample = (j) => Math.min(m.ts.length - 1, j * STRIDE);

  /** @param {number} l @returns {Float32Array} flat x, y, z of a lane's envelope */
  const lanePoints = (l) => {
    // Always n points, so the line keeps its segment count (three sizes an
    // instanced draw once): the ones not drawn yet sit on the last one drawn.
    const k = count();
    const out = new Float32Array(n * 3);
    const e = env[l - 1];
    for (let j = 0; j < n; j += 1) {
      const i = sample(Math.min(j, k - 1));
      out.set([xOf(m.ts[i]), yOf(e[i]), zOf(l)], j * 3);
    }
    return out;
  };
  /**
   * Segment pairs for a family of lanes.
   * @param {(l: number) => boolean} members  the lanes the family holds
   * @param {(lane: import("./anim-frame-boundary.js").Lane) => boolean} which  the ones drawn now
   * @param {(i: number) => Float32Array | null} ys
   */
  const family = (members, which, ys) => {
    // A fixed segment count per family (three sizes an instanced draw
    // once): a lane outside the family, or a stretch not drawn yet, is
    // parked far below the frame, where it is clipped.
    /** @type {number[]} */
    const out = [];
    const k = count();
    for (const lane of m.lanes) {
      if (!members(lane.l)) continue;
      const y = ys(lane.l - 1);
      const on = which(lane) && y;
      const z = zOf(lane.l);
      for (let j = 0; j + 1 < n; j += 1) {
        if (on && y && j + 1 < k) {
          out.push(xOf(m.ts[sample(j)]), yOf(y[sample(j)]), z, xOf(m.ts[sample(j + 1)]), yOf(y[sample(j + 1)]), z);
        } else {
          out.push(0, OFF, z, 0.01, OFF, z);
        }
      }
    }
    return out;
  };
  // Every family holds every lane it can ever draw, so its segment count is
  // fixed; the highlighted lane (which moves with the rule) is parked.
  const solid = (/** @type {import("./anim-frame-boundary.js").Lane} */ l) => l.mode !== "handover" && l.l !== m.top;
  const dashedLanes = (/** @type {import("./anim-frame-boundary.js").Lane} */ l) => l.mode === "handover" && l.l !== m.top;
  const allLanes = () => true;
  const handLanes = (/** @type {number} */ l) => HANDOVER.includes(l);
  const waveLanes = (/** @type {number} */ l) => l <= CARRIERS;
  const envSegments = () => family(allLanes, solid, (i) => env[i]);
  const dashSegments = () => family(handLanes, dashedLanes, (i) => env[i]);
  const waveSegments = () => family(waveLanes, () => true, (i) => wave[i]);
  /**
   * One colour per vertex of a family, in lane order.
   * @param {(l: number) => boolean} members
   * @param {number} [dim] a further mix toward the plot background (the waveforms sit under the envelopes)
   */
  const familyColours = (members, dim = 0) => () => {
    /** @type {number[]} */
    const out = [];
    const bg = tokenHex("--ambe-plot-bg");
    for (const lane of m.lanes) if (members(lane.l)) out.push(...new Array((n - 1) * 2).fill(mix(laneColour(lane.l), bg, dim)));
    return out;
  };
  /** Ramp by l, faded by distance from the highlight, more in front of it (the cutaway rule). */
  const laneColour = (/** @type {number} */ l) => {
    const bg = tokenHex("--ambe-plot-bg");
    let c = fade(rampColor((l - 1) / (LANES - 1)), l - m.top);
    if (pitch < 60 && l < m.top) c = mix(c, bg, 0.15);
    return c;
  };

  /** The ribbons: one mesh, a strip from level 0 to the envelope per lane. */
  const ribbonGeometry = (/** @type {ThreeContext} */ ctx) => {
    const T = ctx.three;
    const k = count();
    // The cutaway rule: no surface in front of the highlight.
    const lanes = m.lanes.filter((l) => l.l > m.top);
    const pos = new Float32Array(lanes.length * k * 6);
    /** @type {number[]} */
    const index = [];
    lanes.forEach((lane, a) => {
      const e = env[lane.l - 1];
      for (let j = 0; j < k; j += 1) {
        const base = (a * k + j) * 2;
        const x = xOf(m.ts[sample(j)]);
        pos.set([x, yOf(e[sample(j)]), zOf(lane.l), x, yOf(0), zOf(lane.l)], base * 3);
        if (j + 1 < k) index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    });
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    g.setAttribute("color", new T.BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(index);
    g.userData.lanes = lanes.map((l) => l.l);
    g.userData.k = k;
    return g;
  };
  /** @param {ThreeContext} ctx @param {any} mesh */
  const recolourRibbons = (ctx, mesh) => {
    const a = mesh.geometry.getAttribute("color");
    const colour = new ctx.three.Color();
    const bg = tokenHex("--ambe-plot-bg");
    const { lanes, k } = mesh.geometry.userData;
    lanes.forEach((/** @type {number} */ l, /** @type {number} */ i) => {
      const top = colour.setHex(mix(laneColour(l), bg, 0.62)).toArray();
      const bottom = colour.setHex(mix(laneColour(l), bg, 0.92)).toArray();
      for (let j = 0; j < k; j += 1) {
        const v = (i * k + j) * 2;
        a.setXYZ(v, top[0], top[1], top[2]);
        a.setXYZ(v + 1, bottom[0], bottom[1], bottom[2]);
      }
    });
    a.needsUpdate = true;
  };

  /** Side bars: from level 1 down to each lane's lowest envelope, in the plane x = EX / 2. */
  const barGeometry = (/** @type {ThreeContext} */ ctx) => {
    const T = ctx.three;
    /** @type {number[]} */
    const pos = [];
    const x = EX / 2 + 0.02;
    for (const lane of m.lanes) {
      const y1 = yOf(1);
      const y0 = yOf(1 - lane.low.depth * dropped);
      const [za, zb] = [zOf(lane.l) + BAR * DZ, zOf(lane.l) - BAR * DZ];
      pos.push(x, y1, za, x, y0, za, x, y0, zb, x, y1, za, x, y0, zb, x, y1, zb);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new T.BufferAttribute(new Float32Array(pos.length), 3));
    return g;
  };
  /**
   * The bars on the ramp, faded by distance from the highlight; the
   * highlighted bar in the highlight's frosted fill, from its top at
   * level 1 toward the plot background at its foot.
   * @param {ThreeContext} ctx @param {any} mesh
   */
  const recolourBars = (ctx, mesh) => {
    const a = mesh.geometry.getAttribute("color");
    const colour = new ctx.three.Color();
    const bg = tokenHex("--ambe-plot-bg");
    const fillTop = tokenHex("--ambe-highlight-fill-top");
    const fillFoot = mix(fillTop, tokenHex("--ambe-highlight-fill-bottom"), 0.35);
    m.lanes.forEach((lane, i) => {
      const flat = mix(fade(rampColor((lane.l - 1) / (LANES - 1)), lane.l - m.top), bg, 0.12);
      // Vertices 0, 3, 5 are at level 1; 1, 2, 4 at the foot (barGeometry).
      for (let v = 0; v < 6; v += 1) {
        const atTop = v === 0 || v === 3 || v === 5;
        const [r, g, b] = colour.setHex(lane.l === m.top ? (atTop ? fillTop : fillFoot) : flat).toArray();
        a.setXYZ(i * 6 + v, r, g, b);
      }
    });
    a.needsUpdate = true;
  };
  /** The highlighted bar's outline, in the plane just in front of the bars. */
  const barEdgeSegments = () => {
    const lane = m.lanes[m.top - 1];
    const x = EX / 2 + 0.04;
    const [y1, y0] = [yOf(1), yOf(1 - lane.low.depth * dropped)];
    const [za, zb] = [zOf(lane.l) + BAR * DZ, zOf(lane.l) - BAR * DZ];
    return [x, y1, za, x, y0, za, x, y0, za, x, y0, zb, x, y0, zb, x, y1, zb, x, y1, zb, x, y1, za];
  };

  const playheadSegments = () => {
    const x = xOf(Math.max(0, head));
    return [x, yOf(0), zOf(1) + DZ / 2, x, yOf(0), zOf(LANES) - DZ / 2, x, yOf(-1.05), zOf(1) + DZ / 2, x, yOf(1.05), zOf(1) + DZ / 2];
  };
  /** The gate's outline, from the floor at level 0 to level 1, the range the lanes use. */
  const edgeSegments = () => {
    const [x0, x1, y0, y1] = [-EX / 2, EX / 2, yOf(0), yOf(1)];
    return [x0, y0, GATE_Z, x1, y0, GATE_Z, x1, y0, GATE_Z, x1, y1, GATE_Z, x1, y1, GATE_Z, x0, y1, GATE_Z, x0, y1, GATE_Z, x0, y0, GATE_Z];
  };
  /** The 2D plot's axes on the front face: the bottom and left edges and their ticks. */
  const axisSegments = () => {
    const [x0, x1, y0] = [xOf(0), xOf(T_MS), yOf(-EXTENT)];
    const out = [x0, y0, FACE_Z, x1, y0, FACE_Z, x0, y0, FACE_Z, x0, yOf(EXTENT), FACE_Z];
    const tick = 0.04;
    for (const t of [0, 5, 10, 15, 20]) out.push(xOf(t), y0, FACE_Z, xOf(t), y0 - tick, FACE_Z);
    for (const v of [-1, 0, 1]) out.push(x0, yOf(v), FACE_Z, x0 - tick, yOf(v), FACE_Z);
    return out;
  };
  /** The switch's moment, 10 ms, as the 2D plot dashes it: down the front face and across the floor. */
  const cutSegments = () => [xOf(T_MS / 2), yOf(-EXTENT), FACE_Z, xOf(T_MS / 2), yOf(EXTENT), FACE_Z,
    xOf(T_MS / 2), FLOOR, FACE_Z, xOf(T_MS / 2), FLOOR, -EZ / 2];
  const gated = () => m.scheme === "rule" || m.scheme === "handover";

  /** @param {ThreeContext} ctx */
  const build = (ctx) => {
    const T = ctx.three;
    builds += 1;
    const group = new T.Group();
    ctx.scene.add(group);
    const stage = new T.Group();
    stage.add(floor(ctx, { extent: STAGE, step: [EX / 4, DZ * 4] }));
    stage.add(contactShadow(ctx, { x: [-EX / 2, EX / 2], z: [-EZ / 2, EZ / 2], y: 0 }));
    group.add(stage);
    const ribbons = new T.Mesh(ribbonGeometry(ctx), new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    ribbons.userData.recolour = () => recolourRibbons(ctx, ribbons);
    ribbons.userData.recolour();
    const lanes = fatLines(ctx, envSegments(), familyColours(allLanes), 1.75, { fog: true });
    const dashed = fatLines(ctx, dashSegments(), familyColours(handLanes), 1.75, { fog: true, dashed: true, dash: 0.07, gap: 0.05 });
    const waves = fatLines(ctx, waveSegments(), familyColours(waveLanes, WAVE_DIM), 1.25, { fog: true });
    const plane = new T.Mesh(new T.PlaneGeometry(EX, yOf(1)), ctx.paint(new T.MeshBasicMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide,
    }), "--ambe-accent-soft"));
    plane.position.set(0, yOf(0.5), GATE_Z);
    plane.renderOrder = 4;
    const edge = fatLines(ctx, edgeSegments(), "--ambe-accent", 1.75, { dashed: !m.open, dash: 0.08, gap: 0.06 });
    const bars = new T.Mesh(barGeometry(ctx), new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
    bars.userData.recolour = () => recolourBars(ctx, bars);
    bars.userData.recolour();
    const barEdge = fatLines(ctx, barEdgeSegments(), "--ambe-highlight", 2.5);
    barEdge.renderOrder = 5;
    const axes = fatLines(ctx, axisSegments(), "--ambe-plot-axis", 1);
    const cut = fatLines(ctx, cutSegments(), "--ambe-plot-muted", 1, { dashed: true, dash: 0.03, gap: 0.04 });
    const rule = fatLines(ctx, [EX / 2 + 0.03, yOf(1), zOf(1) + DZ / 2, EX / 2 + 0.03, yOf(1), zOf(LANES) - DZ / 2],
      "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.05, gap: 0.04 });
    const playhead = fatLines(ctx, playheadSegments(), "--ambe-plot-ink", 1.5, { depthTest: false });
    playhead.renderOrder = 9;
    const highlight = addHighlight(ctx, lanePoints(m.top), { baseline: yOf(0), chip: chipText(m, side > 0.5) });
    const hiFill = highlight.children.find((o) => /** @type {any} */ (o).isMesh) ?? null;
    // The kit's dashed outline of its plane: seen edge on from the side it is a stray line under the bar.
    const hiOutline = highlight.children.find((o) => /** @type {any} */ (o).material?.dashed) ?? null;
    group.add(ribbons, waves, lanes, dashed, plane, edge, bars, barEdge, rule, axes, cut, playhead, highlight);
    fog(ctx, 10, EZ);
    const labels = createLabels(frame, ctx);
    ctx.track(labels);
    const front = frontLayer();
    ctx.track({ dispose: () => front.layer.remove() });
    s = { ribbons, lanes, dashed, waves, plane, edge, bars, barEdge, rule, axes, cut, playhead, highlight, hiFill, hiOutline, labels, stage, front };
    shownAs = "";
    look();
    rechip();
  };

  /**
   * The 2D plot's own labels, for Front: its time and level ticks, the
   * time axis's name, the two frames, and the switch. lib/labels.js keeps
   * the bottom of the frame clear (the plot's time axis is there), so
   * these are a layer of their own, placed by the same projection, and
   * they fade out as the camera leaves Front.
   */
  const frontLayer = () => {
    const layer = document.createElement("div");
    layer.className = "anim-figure__overlay fb-front";
    layer.setAttribute("aria-hidden", "true");
    frame.append(layer);
    return { layer, items: [] };
  };
  const frontItems = () => {
    if (!s) return;
    /** @type {{text: string, at: [number, number, number], ax: number, ay: number, dx: number, dy: number, tick?: boolean}[]} */
    const list = [];
    const y0 = yOf(-EXTENT);
    for (const t of [0, 5, 10, 15, 20]) list.push({ text: `${t}`, at: [xOf(t), y0, FACE_Z], ax: 0.5, ay: 0, dx: 0, dy: 4, tick: true });
    list.push({ text: "time between the two frames (ms)", at: [xOf(T_MS / 2), y0, FACE_Z], ax: 0.5, ay: 1, dx: 0, dy: 33 });
    for (const v of [-1, 0, 1]) list.push({ text: `${v}`, at: [xOf(0), yOf(v), FACE_Z], ax: 1, ay: 0.5, dx: -7, dy: 0, tick: true });
    const y1 = yOf(EXTENT);
    list.push({ text: `${F_OLD} Hz frame`, at: [xOf(0), y1, FACE_Z], ax: 0, ay: 1, dx: 6, dy: -6 });
    list.push({ text: `${m.f1.toFixed(1)} Hz frame`, at: [xOf(T_MS), y1, FACE_Z], ax: 1, ay: 1, dx: -6, dy: -6 });
    // The chip takes the right of the switch's top, so the name goes on its left.
    if (m.scheme === "switch") list.push({ text: "switch", at: [xOf(T_MS / 2), y1, FACE_Z], ax: 1, ay: 1, dx: -6, dy: -6 });
    s.front.layer.replaceChildren();
    s.front.items = list.map((item) => {
      const node = document.createElement("span");
      node.className = item.tick ? "anim-figure__label anim-figure__label--tick" : "anim-figure__label";
      node.textContent = item.text;
      s?.front.layer.append(node);
      return { node, at: item.at, ax: item.ax, ay: item.ay, dx: item.dx, dy: item.dy };
    });
    placeFront();
  };
  const placeFront = () => {
    if (!s || !live) return;
    const show = Math.min(1, Math.max(0, (front - 0.6) / 0.3));
    s.front.layer.style.opacity = show.toFixed(2);
    s.front.layer.hidden = show === 0;
    if (show === 0) return;
    const camera = live.camera;
    camera.updateMatrixWorld();
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const v = new live.three.Vector3();
    // The chip matters more: a label it would cover gives way.
    const box = frame.getBoundingClientRect();
    const chip = s.highlight.chip?.node.getBoundingClientRect();
    for (const item of s.front.items) {
      // Measured shown: a hidden node has no size.
      item.node.hidden = false;
      v.set(...item.at).project(camera);
      const left = ((v.x + 1) / 2) * w + item.dx - item.ax * item.node.offsetWidth;
      const top = ((1 - v.y) / 2) * h + item.dy - item.ay * item.node.offsetHeight;
      const [right, bottom] = [left + item.node.offsetWidth, top + item.node.offsetHeight];
      const covered = Boolean(chip && chip.width) && chip !== undefined && left < chip.right - box.left && right > chip.left - box.left &&
        top < chip.bottom - box.top && bottom > chip.top - box.top;
      item.node.hidden = left < 0 || top < 0 || right > w || bottom > h || covered;
      item.node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    }
  };

  /** The chip's text for the view, and its anchor: the switch at 10 ms, the bar's foot from the side, else the level at 10 ms. */
  const rechip = () => {
    const chip = s?.highlight.chip;
    if (!chip) return;
    const lane = m.lanes[m.top - 1];
    const atSide = side > 0.5;
    /** @type {[number, number, number]} */
    const at = lane.mode === "switch" ? [xOf(T_MS / 2), yOf(1), zOf(lane.l)]
      : atSide ? [EX / 2 + 0.04, yOf(1 - lane.low.depth * dropped), zOf(lane.l)]
        : [xOf(T_MS / 2), yOf(lane.mid), zOf(lane.l)];
    chip.set({ text: chipText(m, atSide, frame.clientWidth < 560), at });
    // While the intro draws the lanes, the chip waits for the playhead to reach 10 ms.
    const ready = drawn * T_MS >= T_MS / 2 || atSide;
    const layer = chip.node.parentElement;
    if (layer) layer.style.visibility = ready ? "" : "hidden";
    placeFront();
  };

  /**
   * The labels for the parts on show. At Front the plot's own (frontItems);
   * none while the camera turns between presets; from the side a number
   * and l x delta_f over each bar; at Oblique the time axis and a lane
   * label every few lanes.
   */
  const relabel = () => {
    if (!s) return;
    if (front > 0.6 || turning > 0 || introTurn) return s.labels.set([]);
    const along = /** @type {[number, number, number]} */ ([0, 0, 1]);
    const df = m.f1 - F_OLD;
    const narrow = frame.clientWidth < 560;
    /** @type {import("./lib/labels.js").Label[]} */
    const list = [];
    if (side > 0.5) {
      const x = EX / 2;
      const y = yOf(1);
      // Two rows over the bars: the harmonic, and how far apart its old and new oscillators run.
      // A phone keeps one row: every other harmonic's number, titled above.
      for (const lane of m.lanes) {
        const l = lane.l;
        if (!narrow || l % 2 === 0) list.push({ text: `${l}`, at: [x, y, zOf(l)], align: "middle", dy: -12 });
        if (!narrow) list.push({ text: `${(l * df).toFixed(0)}`, at: [x, y, zOf(l)], align: "middle", dy: -27, tick: true });
      }
      const left = zOf(0.5) + 0.04;
      list.push({ text: "harmonic", at: [x, y, left], align: narrow ? "start" : "end", dy: narrow ? -30 : -12 });
      if (!narrow) list.push({ text: "Hz apart", at: [x, y, left], align: "end", dy: -27 });
      list.push({ text: "level 1", at: [x, y, left], align: "end", dy: 3, tick: true });
      list.push({ text: "0.5", at: [x, yOf(0.5), left], align: "end", tick: true });
      const last = m.lanes[LANES - 1];
      if (last.mode === "crossfade" && last.dips.length > 1 && dropped > 0.95) {
        const times = last.dips.length === 2 ? "twice" : `${last.dips.length} times`;
        list.push({ text: `dips\n${times}`, at: [x, yOf(last.low.level), zOf(LANES)], align: "middle", dy: 20 });
      }
      // Under the short bars at the left, when they leave room: what a bar is.
      if (!narrow && m.lanes.slice(0, 4).every((l) => l.low.level > 0.45)) {
        list.push({ text: "each bar: harmonic l's dip,\nfrom level 1 to its lowest", at: [x, yOf(0.3), zOf(0.5)], align: "start" });
      }
    } else {
      // A phone keeps the frame's foot for the scene: Front has the time axis.
      if (!narrow) list.push(...axisLabels(showsWaves(m.scheme) ? BOX : STAGE, { x: xOf, y: yOf, z: zOf }, [{ axis: "x", name: "time (ms)", ticks: [0, 10, 20] }]));
      const x = EX / 2 + 0.06;
      // Every few lanes, clear of the gate (between 7 and 8) and its corner.
      const every = narrow ? [4, 11, 16] : [1, 4, 11, 16];
      for (const l of every) {
        list.push({ text: `${l}: ${(l * df).toFixed(0)} Hz${narrow ? "" : " apart"}`, at: [x, yOf(0), zOf(l)], align: "start", along, tick: true, dy: 4 });
      }
      if (gated() && s.edge.visible) {
        // In the lanes' column, at the gate's own depth, between lanes 7 and 8.
        list.push({ text: m.open ? (narrow ? "plane: gate" : `plane: the gate, 1 to ${GATE_L - 1} swept`) : "gate closed",
          at: [x, yOf(0), GATE_Z], align: "start", along, dy: 4 });
      }
    }
    s.labels.set(list);
  };

  /** Show or hide each part for the pose. */
  const look = () => {
    if (!s) return;
    const away = front < 0.5;
    s.ribbons.visible = away && side < 0.5;
    if (s.hiFill) s.hiFill.visible = away && side < 0.5;
    if (s.hiOutline) s.hiOutline.visible = side < 0.5;
    const waves = showsWaves(m.scheme);
    s.waves.visible = waves && side < 0.5;
    s.stage.position.y = waves ? FLOOR : 0;
    s.lanes.visible = true;
    s.dashed.visible = m.scheme === "handover";
    s.plane.visible = gated() && m.open && away && side < 0.5;
    s.edge.visible = gated() && away && side < 0.5;
    s.bars.visible = s.rule.visible = side > 0.02 && dropped > 0;
    s.barEdge.visible = side > 0.5 && dropped > 0;
    s.axes.visible = front > 0.5;
    s.cut.visible = m.scheme === "switch" && side < 0.5;
    s.playhead.visible = head >= 0;
    placeFront();
    const sig = `${front > 0.6}${side > 0.5}${turning > 0 || introTurn}${s.plane.visible}${s.edge.visible}${m.scheme}${m.open}${m.f1}${m.top}${dropped > 0.95}`;
    if (sig === shownAs) return;
    shownAs = sig;
    relabel();
    rechip();
    frontItems();
    s.bars.userData.recolour();
  };

  /** Put the drawn arrays into the scene, in place. */
  const fill = () => {
    const ctx3 = live;
    if (!s || !ctx3) return;
    setSegments(s.lanes, envSegments());
    s.lanes.userData.recolour();
    setSegments(s.dashed, dashSegments());
    s.dashed.userData.recolour();
    setSegments(s.waves, waveSegments());
    s.waves.userData.recolour();
    s.ribbons.geometry.dispose();
    s.ribbons.geometry = ribbonGeometry(ctx3);
    s.ribbons.userData.recolour();
    s.bars.geometry.dispose();
    s.bars.geometry = barGeometry(ctx3);
    s.bars.userData.recolour();
    setSegments(s.barEdge, barEdgeSegments());
    setSegments(s.playhead, playheadSegments());
    if (s.edge.material.dashed !== !m.open) {
      s.edge.material.dashed = !m.open;
      s.edge.material.needsUpdate = true;
    }
    setSegments(s.edge, edgeSegments());
    s.highlight.set(lanePoints(m.top));
    look();
    rechip();
    ctx3.requestRender();
  };

  /** @type {ThreeContext | null} */
  let live = null;
  const ctx3 = await mountThree(frame, {
    signal: opts.signal,
    label: "",
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx3) return null;
  const ctx = (live = ctx3);

  const describe = () => {
    const lane = m.lanes[m.top - 1];
    const rule = m.scheme === "switch" ? "switched at 10 ms" : m.scheme === "crossfade" ? "crossfaded"
      : m.open ? `swept below harmonic ${GATE_L} and crossfaded from ${GATE_L} up` : "crossfaded, the pitch gate closed";
    const fact = lane.mode === "switch" ? `its phase jumps ${lane.jump.toFixed(0)} degrees`
      : `its envelope is ${lane.mid.toFixed(2)} at the midpoint and falls to ${lane.low.level.toFixed(2)}`;
    return `Sixteen harmonics, one lane each from front to back, crossing from a frame at ${F_OLD} Hz to one at ` +
      `${m.f1.toFixed(1)} Hz over 20 ms, ${rule}. Harmonic 1 dips to ${m.lanes[0].low.level.toFixed(2)}; harmonic ` +
      `${lane.l}, highlighted, ${fact}.`;
  };

  const fitted = matchPlot(ctx, () => layout({ width: frame.clientWidth, height: frame.clientHeight }).area, BOX);
  const corner = new ctx.three.Vector3();
  /** @type {import("./lib/orbit.js").Orbit | null} */
  let turn = null;
  /** @param {import("./lib/orbit.js").Pose} p */
  const yawOf = (p) => ((((p.yaw % 360) + 540) % 360) - 180);
  /**
   * Front and Side are the 2D plot's rectangle (the box is as deep as it
   * is wide); away from both, the frustum blends toward one that holds the
   * whole box at one scale, inside the frame's margins.
   */
  const fit = () => {
    fitted.fit();
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const narrow = w < 560;
    /**
     * The frustum that puts `points` inside the frame's margins, at one
     * scale on both axes or (`free`) at its own scale on each.
     * @param {number[][]} points
     * @param {number[]} margins left, right, top, bottom, CSS px
     * @param {boolean} free
     */
    const holding = (points, [left, right, top, bottom], free) => {
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const [a, b, c] of points) {
        corner.set(a, b, c).applyMatrix4(camera.matrixWorldInverse);
        [x0, x1, y0, y1] = [Math.min(x0, corner.x), Math.max(x1, corner.x), Math.min(y0, corner.y), Math.max(y1, corner.y)];
      }
      const sx = (x1 - x0) / (w - left - right);
      const sy = (y1 - y0) / (h - top - bottom);
      const [kx, ky] = free ? [sx, sy] : [Math.max(sx, sy), Math.max(sx, sy)];
      const cx = (x0 + x1) / 2 + ((right - left) / 2) * kx;
      const cy = (y0 + y1) / 2 + ((top - bottom) / 2) * ky;
      return { left: cx - (w / 2) * kx, right: cx + (w / 2) * kx, top: cy + (h / 2) * ky, bottom: cy - (h / 2) * ky };
    };
    /** @param {{left: number, right: number, top: number, bottom: number}} want @param {number} by */
    const blend = (want, by) => {
      for (const key of /** @type {const} */ (["left", "right", "top", "bottom"])) camera[key] += (want[key] - camera[key]) * by;
    };
    camera.updateMatrixWorld();
    const away = 1 - Math.max(front, side);
    if (away > 0) {
      // The lanes' own box: level 0 (the floor) to 1 under every rule but a
      // switch, whose waveforms reach down to -1.
      const low = showsWaves(m.scheme) ? -EY / 2 : yOf(-0.04);
      const box = [-1, 1].flatMap((a) => [low, yOf(1.04)].flatMap((b) => [-1, 1].map((c) => [(a * EX) / 2, b, (c * EZ) / 2])));
      blend(holding(box, narrow ? [8, 58, 30, 22] : [20, 120, 24, 74], false), away);
    }
    if (side > 0) {
      // From the side only the bars hold anything: level 1 down to the
      // deepest dip fills the frame, with the lane rows above it. The
      // chip sits by the highlighted bar's foot.
      const deepest = Math.min(0.5, ...m.lanes.map((l) => l.low.level)) - 0.02;
      const band = [[EX / 2, yOf(deepest), EZ / 2], [EX / 2, yOf(deepest), -EZ / 2], [EX / 2, yOf(1), EZ / 2], [EX / 2, yOf(1), -EZ / 2]];
      blend(holding(band, narrow ? [44, 12, 46, 30] : [70, 18, 48, 16], true), side);
    }
  };
  const measure = () => {
    const p = turn?.pose() ?? PRESETS[m.preset] ?? PRESETS.side;
    const yaw = yawOf(p);
    pitch = p.pitch;
    front = Math.max(0, 1 - Math.max(Math.abs(yaw), Math.abs(p.pitch)) / 24);
    side = Math.max(0, 1 - Math.max(Math.abs(yaw - 90), Math.abs(p.pitch)) / 24);
  };
  measure();
  const orbit = createOrbit(ctx, {
    target: fitted.target,
    fit: () => {
      measure();
      fit();
    },
    distance: 10, zoom: opts.look.zoom || 1, presets: PRESETS,
    start: PRESETS[m.preset] ? m.preset : "side", onDrag: opts.onDrag,
    onChange: () => {
      measure();
      look();
      s?.labels.update();
      placeFront();
    },
  });
  turn = orbit;
  ctx.renderer?.domElement.setAttribute("aria-label", describe());

  const timeline = ctx.timeline();
  const goal = () => PRESETS[m.preset] ?? PRESETS.side;
  /**
   * The explanatory animation at t (0 to 1): at Front, a playhead runs the
   * rule across the 20 ms on every lane at once, so the envelopes dip
   * together; then the camera turns to the step's pose while the dips drop
   * as bars, harmonic 1 first.
   * @param {number} t
   */
  const intro = (t) => {
    drawn = span(0.02, 0.5, t);
    head = t > 0 && t < 0.52 ? drawn * T_MS : -1;
    const c = inout(span(0.52, 0.84, t));
    const to = goal();
    introTurn = t > 0.5 && t < 0.84;
    orbit.set(t === 1 ? to : { yaw: to.yaw * c, pitch: to.pitch * c });
    dropped = inout(span(0.7, 1, t));
    fill();
  };
  if (opts.intro) {
    played += 1;
    intro(0);
    void timeline.play("cross", {
      ms: duration("3d-build") + duration("3d-camera") + 900,
      ease: "linear",
      build: true,
      step: intro,
    });
  }
  await ctx.drawn();

  /**
   * A new rule or pitch: the lanes morph from what is drawn to the model's
   * arrays (the grammar's "same structure, new values").
   * @param {Model} next
   */
  const morph = (next) => {
    const from = env.map((e) => Float32Array.from(e));
    const fromWave = wave.map((w) => (w ? Float32Array.from(w) : null));
    m = next;
    const lerp = (/** @type {Float32Array} */ a, /** @type {Float32Array} */ b, /** @type {number} */ u) => {
      const outArr = new Float32Array(b.length);
      for (let i = 0; i < b.length; i += 1) outArr[i] = a[i] + (b[i] - a[i]) * u;
      return outArr;
    };
    void timeline.play("morph", {
      ms: duration("slow"),
      step: (u) => {
        env = m.lanes.map((l, i) => lerp(from[i], l.env, u));
        wave = m.lanes.map((l, i) => (l.wave ? lerp(fromWave[i] ?? l.wave, l.wave, u) : null));
        fill();
      },
    });
  };

  if (TEST_HOOK) {
    TEST_HOOK.figures["frame-boundary-3d"] = {
      get builds() { return builds; },
      get played() { return played; },
      pose: () => orbit.pose(),
      zoom: () => orbit.zoom(),
      seek: intro,
      parts: () => ({
        ribbons: s?.ribbons.visible, plane: s?.plane.visible, edge: s?.edge.visible, bars: s?.bars.visible,
        dashed: s?.dashed.visible, waves: s?.waves.visible, playhead: s?.playhead.visible, drawn, dropped,
        cut: s?.cut.visible, top: m.top,
      }),
      /** Lane 8 and lane 1's envelopes and harmonic 1's waveform, projected to CSS px, with the data they stand for. */
      frontPoints: () => {
        const v = new ctx.three.Vector3();
        const w = frame.clientWidth;
        const h = frame.clientHeight;
        ctx.camera.updateMatrixWorld();
        /** @type {{t: number, v: number, x: number, y: number}[]} */
        const pts = [];
        for (const [l, ys] of /** @type {[number, Float32Array | null][]} */ ([[m.top, env[m.top - 1]], [1, env[0]], [1, wave[0]], [16, env[15]]])) {
          if (!ys) continue;
          for (let i = 0; i < ys.length; i += 23) {
            v.set(xOf(m.ts[i]), yOf(ys[i]), zOf(l)).project(ctx.camera);
            pts.push({ t: m.ts[i], v: ys[i], x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h });
          }
        }
        return pts;
      },
      /** Each lane's bar as drawn: its depth now. */
      bars: () => m.lanes.map((l) => Number((l.low.depth * dropped).toFixed(4))),
    };
  }

  let last = `${m.scheme}${m.change}`;
  return {
    update: (next) => {
      ctx.finish();
      const nm = /** @type {Model} */ (next);
      const key = `${nm.scheme}${nm.change}`;
      if (key !== last) {
        const moved = nm.lanes[nm.top - 1].mid !== m.lanes[m.top - 1].mid;
        morph(nm);
        if (moved) void s?.highlight.pulse();
      } else {
        m = nm;
        fill();
      }
      last = key;
      orbit.set(orbit.pose());
      ctx.renderer?.domElement.setAttribute("aria-label", describe());
    },
    preset: (name) => {
      turning += 1;
      look();
      void orbit.go(name).finally(() => {
        turning -= 1;
        look();
        s?.labels.update();
      });
    },
    describe,
    close: () => {
      if (TEST_HOOK) delete TEST_HOOK.figures["frame-boundary-3d"];
      ctx.dispose();
    },
  };
}
