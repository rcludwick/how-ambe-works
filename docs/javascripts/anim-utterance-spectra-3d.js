// @ts-check
/* ===========================================================================
 * anim-utterance-spectra-3d.js: the whole sentence as a waterfall
 * (three-everywhere design §2.1, §4.3; visual language design).
 * ---------------------------------------------------------------------------
 * Loaded by anim-utterance-spectra.js through lib/view-switch.js only when
 * 3D is wanted. It takes the 2D module's arrays and computes no model data:
 * it only places the spectra it is given.
 *
 *   x  frequency, 0 to the top bin (3969 Hz)
 *   y  level, -85 to 0 dBFS
 *   z  time, 0 s at the front to 3.7 s at the back, one slice per 20 ms.
 *      The box is fixed for every sentence, so a short one leaves the back
 *      empty and sentences compare at a glance.
 *
 * The selected window wears the highlight kit (chip "this frame: 20 ms at
 * <t> s"). The other windows are one merged LineSegments2, coloured per
 * vertex on the ramp by level and faded toward the plot background by their
 * distance from the selection (5 windows to a fade step), and one merged
 * mesh of frosted curtains. Cutaway rule: below 60 degrees of pitch the
 * curtains in front of the selection are not drawn and the lines there
 * fade a further 0.15. Each window's total energy stands on a wall at the
 * 0 Hz side, the far side from the Corner camera, which looks in from the
 * 4 kHz side so the tall low shelves hide nothing. Energy is a sum of
 * non-negative powers, so the wall is never below a slice's highest bin.
 *
 * Front is the 2D bottom panel: matchPlot's frustum on its plot rectangle,
 * at the panel's scale but lifted LIFT px so the axis labels under it clear
 * the frame's bottom 56 px, with every slice but the selected one hidden. Away from Front the
 * frustum eases to one that fits the whole box in the frame.
 *
 * The explanatory animation, "a sentence is a run of different spectra, one
 * every 20 ms": the camera eases from Front to Corner and, once it is 60%
 * of the way round, a narrow wavefront grows the slices from their
 * baselines front to back in time order, the energy wall rising behind it.
 * The highlight appears and pulses as the wavefront reaches its slice. Its
 * end state is the figure itself.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK, prefersReducedMotion } from "./anim-core.js";
import { BOX_S, FLOOR_DB, HOP_S } from "./anim-utterance-spectra.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { FRONT, TOP, createOrbit, frontFrustum } from "./lib/orbit.js";
import { axisFrame, toScene } from "./lib/scene.js";
import { contactShadow, darkGround, fadeAmount, fatLines, floor, fog, frostedFill, rampColor, setFill, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./anim-utterance-spectra.js").SpectraState} SpectraState */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {import("three/addons/lines/LineSegments2.js").LineSegments2} Fat */

const KEY = "utterance-spectra-3d";
const EXTENT = { x: 2, y: 0.9, z: 2.4 };
const DISTANCE = 8;
/** @type {Record<string, Pose>} */
const PRESETS = { front: FRONT, corner: { yaw: 42, pitch: 24 }, top: TOP };
/** Windows per fade step (lib/style.js fadeAmount counts steps). */
const FADE_STEP = 5;
/** Below this pitch, the cutaway rule. */
const CUTAWAY_PITCH = 60;
/** How far a curtain's top goes from its line colour to the plot background. */
const CURTAIN_MIX = { dark: 0.62, light: 0.8 };
/** The intro's wavefront: starts spread over SPREAD of the track, each slice rising over RAMP. */
const SPREAD = 0.85;
const RAMP = 0.13;
/** CSS px Front lifts the 2D panel's rectangle, so the frequency ticks and name clear the bottom 56 px. */
const LIFT = 56;

/** sRGB 0 to 1 of 0xRRGGBB. @param {number} hex */
const srgb = (hex) => [Math.floor(hex / 65536) % 256, Math.floor(hex / 256) % 256, hex % 256].map((c) => c / 255);
/** sRGB to linear, as the shaders want vertex colours. @param {number} c */
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** @param {number} t @returns {number} */
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let state = /** @type {SpectraState} */ (opts.state);
  const probe = { builds: 0, played: 0, pose: /** @type {Pose} */ (FRONT), zoom: 1, frontPoints: () => /** @type {number[][]} */ ([]),
    frontRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    contextShown: () => false, curtainsFrom: () => 0, wallAboveSlices: () => false, slices: () => 0, chip: () => "" };
  if (TEST_HOOK) TEST_HOOK.figures[KEY] = probe;

  const nyquist = () => state.data?.doc.bin_centre_hz.at(-1) ?? 3968.75;
  let map = toScene({ x: [0, nyquist()], y: [FLOOR_DB, 0], z: [BOX_S, 0] }, EXTENT);
  const [x0, y0] = map.box.min;
  const [x1, y1] = map.box.max;

  /** @type {ThreeContext} */
  let ctx;
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** The parts of the scene the data makes, replaced when the clip changes. */
  /** @type {{group: import("three").Group, lines: Fat, curtains: import("three").Mesh, perSlice: number,
   *          wallFill: import("three").Mesh, wallLine: Fat, ys: Float32Array, wallYs: Float32Array,
   *          levels: Float32Array, n: number, nb: number} | null} */
  let parts = null;
  /** @type {(import("three").Group & import("./lib/highlight.js").HighlightKit) | null} */
  let highlight = null;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  /** @type {import("./anim-three.js").Timeline | null} */
  let timeline = null;
  /** Each slice's growth, 0 (flat) to 1; and the wall's. */
  let grown = new Float32Array(0);
  let wallGrown = 1;
  let growing = false;
  let shownClip = "";
  /** The window the highlight, fade and cutaway show. The 2D module hands
   *  over its own state object and changes it before update() runs, so the
   *  last frame drawn is kept here rather than read back from that object. */
  let shownFrame = -1;
  let shownPulses = state.pulses;

  /** The selected slice, flat x, y, z in scene units. */
  const selected = () => {
    if (!state.data) return [x0, y0, map.z(0), x1, y0, map.z(0)];
    const { doc } = state.data;
    const z = map.z(state.frame * HOP_S);
    return state.spectrumPoints(doc.original[state.frame], doc.bin_centre_hz)
      .flatMap((p) => [map.x(p.x), map.y(p.y), z]);
  };
  /** The selection's points, grown as its slice is. */
  const shownSelected = () => {
    const g = grown[state.frame] ?? 1;
    return selected().map((v, i) => (i % 3 === 1 ? y0 + (v - y0) * g : v));
  };
  const chipText = () => `this frame: 20 ms at ${(state.frame * HOP_S).toFixed(2)} s`;

  /** The camera's pose, read from where it is (orbit places it before the fit runs). */
  const poseNow = () => {
    const p = ctx.camera.position;
    const d = p.length() || 1;
    return { yaw: (Math.atan2(p.x, p.z) * 180) / Math.PI, pitch: (Math.asin(p.y / d) * 180) / Math.PI };
  };
  /** How far the pose is from Front, 0 there to 1 from 25 degrees on. */
  const away = () => {
    const pose = poseNow();
    return smooth(Math.hypot(pose.yaw, pose.pitch) / 25);
  };
  const cutaway = () => poseNow().pitch < CUTAWAY_PITCH;
  /** How far the camera looks down, 0 below 50 degrees to 1 at Top. */
  const looking = () => smooth((poseNow().pitch - 50) / 35);
  /**
   * An interleaved attribute's buffer (LineSegments2 keeps its ends there).
   * @param {Fat} line
   * @param {string} name
   */
  const ends = (line, name) => /** @type {import("three").InterleavedBufferAttribute} */ (line.geometry.attributes[name]).data;

  /* -- colour ------------------------------------------------------------- */

  /** The ramp in 256 steps, sRGB, and sRGB to linear in 1024. */
  let ramp = new Float32Array(256 * 3);
  const toLinear = new Float32Array(1024).map((_, i) => linear(i / 1023));
  let ground = [0, 0, 0];
  const readColours = () => {
    for (let i = 0; i < 256; i += 1) ramp.set(srgb(rampColor(i / 255)), i * 3);
    ground = srgb(tokenHex("--ambe-plot-bg"));
  };

  /**
   * Write one vertex colour: the ramp at `level` (0 to 1), mixed toward the
   * plot background by `amount`, as linear RGB.
   * @param {Float32Array} out
   * @param {number} at
   * @param {number} level
   * @param {number} amount
   */
  const put = (out, at, level, amount) => {
    const r = Math.max(0, Math.min(255, Math.round(level * 255))) * 3;
    for (let k = 0; k < 3; k += 1) {
      const c = ramp[r + k] + (ground[k] - ramp[r + k]) * amount;
      out[at + k] = toLinear[Math.round(Math.max(0, Math.min(1, c)) * 1023)];
    }
  };

  /** Every context colour, from the selection, the pose and the theme. */
  const paint = () => {
    if (!parts) return;
    const { lines, curtains, levels, n, nb, perSlice } = parts;
    const front = cutaway();
    const sel = state.frame;
    // The cutaway's lines fade further as the reader zooms in, so a closer
    // look shows the selected spectrum rather than the slices in front of it.
    const cutFade = 0.15 + 0.3 * Math.log2(orbit?.zoom() ?? 1);
    /** @param {number} c */
    const amount = (c) => Math.min(1, fadeAmount((c - sel) / FADE_STEP) * (1 - looking()) + (front && c < sel ? cutFade : 0));
    const colour = /** @type {Float32Array} */ (ends(lines, "instanceColorStart").array);
    const curtain = /** @type {Float32Array} */ (curtains.geometry.getAttribute("color").array);
    const veil = darkGround() ? CURTAIN_MIX.dark : CURTAIN_MIX.light;
    for (let c = 0; c < n; c += 1) {
      const a = amount(c);
      for (let k = 0; k < nb; k += 1) {
        const level = levels[c * nb + k];
        if (k + 1 < nb) {
          const s = (c * (nb - 1) + k) * 6;
          put(colour, s, level, a);
          put(colour, s + 3, levels[c * nb + k + 1], a);
        }
        const v = (c * nb + k) * 6;
        put(curtain, v, level, 1 - (1 - veil) * (1 - a));
        put(curtain, v + 3, 0, 1);
      }
    }
    ends(lines, "instanceColorStart").needsUpdate = true;
    curtains.geometry.getAttribute("color").needsUpdate = true;
    // Cutaway: only the curtains behind the selection; at Top, all of them.
    curtains.geometry.setDrawRange(front ? (sel + 1) * perSlice : 0, Infinity);
    ctx.requestRender();
  };

  /* -- geometry ----------------------------------------------------------- */

  /** The slices, curtains and wall for the clip in state. */
  const makeParts = () => {
    if (parts) {
      ctx.scene.remove(parts.group);
      parts.group.traverse((node) => {
        const mesh = /** @type {{geometry?: {dispose(): void}, material?: {dispose(): void}}} */ (node);
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
      parts = null;
    }
    if (!state.data) return;
    const T = ctx.three;
    const { doc, energy } = state.data;
    const hz = doc.bin_centre_hz;
    const n = doc.original.length;
    // The context draws every other bin, keeping the higher of each pair
    // (and both ends), so its peaks and the wall property survive at half
    // the segments; a software renderer draws it in half the time. The
    // highlight keeps every bin.
    /** @type {number[]} */
    const keep = [0];
    for (let k = 1; k + 1 < hz.length - 1; k += 2) keep.push(k);
    keep.push(hz.length - 1);
    const nb = keep.length;
    /** @param {{x: number, y: number}[]} points @param {number} j */
    const pickBin = (points, j) =>
      j === 0 || j === nb - 1 || points[keep[j]].y >= points[keep[j] + 1].y ? points[keep[j]] : points[keep[j] + 1];
    const xs = new Float32Array(n * nb);
    const ys = new Float32Array(n * nb);
    const levels = new Float32Array(n * nb);
    const segments = new Float32Array(n * (nb - 1) * 6);
    const top = new Float32Array(n * nb * 6);
    /** @type {number[]} */
    const index = [];
    for (let c = 0; c < n; c += 1) {
      const z = map.z(c * HOP_S);
      const points = state.spectrumPoints(doc.original[c], hz);
      keep.forEach((_, k) => {
        const p = pickBin(points, k);
        const y = map.y(p.y);
        xs[c * nb + k] = map.x(p.x);
        ys[c * nb + k] = y;
        levels[c * nb + k] = (y - y0) / (y1 - y0);
        top.set([map.x(p.x), y, z, map.x(p.x), y0, z], (c * nb + k) * 6);
        if (k + 1 < nb) {
          const a = 2 * (c * nb + k);
          index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
      });
      for (let k = 0; k + 1 < nb; k += 1) {
        const i = c * nb + k;
        segments.set([xs[i], ys[i], z, xs[i + 1], ys[i + 1], z], (c * (nb - 1) + k) * 6);
      }
    }
    const group = new T.Group();
    const lines = fatLines(ctx, segments, () => new Array(n * (nb - 1) * 2).fill(0), 1.25, { fog: true });
    lines.frustumCulled = false;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(top, 3));
    geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(top.length), 3));
    geometry.setIndex(index);
    const curtains = new T.Mesh(geometry, new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    curtains.frustumCulled = false;

    // The wall: energy against time in the plane x = 0 Hz. A fill built in
    // x, y and turned a quarter about y: local (u, y, w) is world (w, y, -u).
    const wallYs = Float32Array.from(energy, (e) => map.y(Math.max(FLOOR_DB, Math.min(0, e))));
    const wallZs = Array.from({ length: n }, (_, c) => map.z(c * HOP_S));
    const wallFill = frostedFill(ctx, wallZs.map((z) => -z), wallYs, x0 - 0.004, y0, "--ambe-plot-muted", "--ambe-3d-floor");
    const turned = new T.Group();
    turned.rotation.y = Math.PI / 2;
    turned.add(wallFill);
    /** @type {number[]} */
    const wallSegments = [];
    for (let c = 0; c + 1 < n; c += 1) wallSegments.push(x0, wallYs[c], wallZs[c], x0, wallYs[c + 1], wallZs[c + 1]);
    // Muted, so the highlight stays the one bright line in the frame.
    const wallLine = fatLines(ctx, wallSegments, "--ambe-plot-muted", 1.75);
    group.add(curtains, lines, turned, wallLine);
    ctx.scene.add(group);
    parts = { group, lines, curtains, perSlice: (nb - 1) * 6, wallFill, wallLine, ys, wallYs, levels, n, nb };
    const recolour = () => {
      readColours();
      paint();
    };
    lines.userData.recolour = recolour;
    grown = new Float32Array(n).fill(1);
    wallGrown = 1;
    shownClip = state.clip;
    shownFrame = state.frame;
    recolour();
  };

  /** Write each slice's and the wall's heights at their growth. */
  const applyGrowth = () => {
    if (!parts) return;
    const { lines, curtains, wallFill, wallLine, ys, wallYs, n, nb } = parts;
    const position = /** @type {Float32Array} */ (ends(lines, "instanceStart").array);
    const top = /** @type {Float32Array} */ (curtains.geometry.getAttribute("position").array);
    for (let c = 0; c < n; c += 1) {
      const g = grown[c];
      for (let k = 0; k < nb; k += 1) {
        const y = y0 + (ys[c * nb + k] - y0) * g;
        top[(c * nb + k) * 6 + 1] = y;
        if (k + 1 < nb) position[(c * (nb - 1) + k) * 6 + 1] = y;
        if (k > 0) position[(c * (nb - 1) + k - 1) * 6 + 4] = y;
      }
    }
    ends(lines, "instanceStart").needsUpdate = true;
    curtains.geometry.getAttribute("position").needsUpdate = true;
    const wy = wallYs.map((y) => y0 + (y - y0) * wallGrown);
    /** @type {number[]} */
    const segments = [];
    const zs = Array.from({ length: n }, (_, c) => map.z(c * HOP_S));
    for (let c = 0; c + 1 < n; c += 1) segments.push(x0, wy[c], zs[c], x0, wy[c + 1], zs[c + 1]);
    setSegments(wallLine, segments);
    setFill(ctx, wallFill, zs.map((z) => -z), wy, x0 - 0.004, y0);
    highlight?.set(shownSelected());
    ctx.requestRender();
  };

  /** Front hides every slice but the selected one (it is the 2D panel). */
  const showContext = () => {
    if (!parts) return;
    parts.group.visible = growing || away() > 0;
  };

  /* -- the view ----------------------------------------------------------- */

  /** Which label set is up: "top" looking down, else "side". */
  /** @type {"top" | "side" | null} */
  let labelled = null;
  /**
   * The axis labels. Front and Corner: every axis on its edge, frequency to
   * 4 kHz. Top: time runs up the right edge, so its ticks sit just past the
   * 4 kHz edge at their own height, without a 0 that would read as the next
   * frequency tick, and its name sits above the box's back corner.
   */
  const setLabels = () => {
    const mode = looking() > 0.5 ? "top" : "side";
    if (!labels || mode === labelled) return;
    labelled = mode;
    const box = map.box;
    const freq = { axis: /** @type {const} */ ("x"), name: "frequency, Hz", ticks: [0, 1000, 2000, 3000, 4000],
      format: (/** @type {number} */ v) => (v ? `${v / 1000}k` : "0") };
    if (mode === "side") {
      labels.set(axisLabels(box, map, [
        freq,
        { axis: "y", name: "dBFS", ticks: [-80, -40, 0] },
        // No 0 s tick: it would sit on the 4 kHz tick at the front corner.
        { axis: "z", name: "time, s", ticks: [1, 2, 3] },
      ]));
      return;
    }
    /** @type {import("./lib/labels.js").Label[]} */
    const time = [1, 2, 3].map((v) => ({ text: String(v), at: [x1 + 0.05, y0, map.z(v)], align: "start", tick: true }));
    time.push({ text: "time, s", at: [x1, y0, map.z(BOX_S)], align: "end", dy: -14 });
    labels.set([...axisLabels(box, map, [freq]), ...time]);
  };

  /**
   * The 2D bottom panel's plot rectangle, lifted LIFT px so the axis labels
   * below it clear the frame's bottom 56 px (lib/labels.js keeps it for the
   * zoom hint); the empty top strip of the 3D frame gives the room. Front
   * keeps the panel's scale exactly.
   * @param {number} W
   * @param {number} H
   */
  const frontRect = (W, H) => {
    const rect = state.plotRect(W, H);
    return { ...rect, y: rect.y - LIFT };
  };

  /** @param {ThreeContext} c */
  const build = (c) => {
    ctx = c;
    probe.builds += 1;
    timeline = c.timeline();
    const box = map.box;
    c.scene.add(floor(c, { extent: box, step: [map.x(1000) - map.x(0), Math.abs(map.z(0.5) - map.z(0))] }));
    c.scene.add(contactShadow(c, { x: [x0, x1], z: [box.min[2], box.max[2]], y: y0 }));
    c.scene.add(axisFrame(c, box, { floor: false, back: false }));
    fog(c, DISTANCE, EXTENT.z);
    readColours();
    parts = null;
    makeParts();
    highlight = addHighlight(c, shownSelected(), { baseline: y0, top: y1, chip: chipText() });
    c.scene.add(highlight);
    labels = createLabels(frame, c);
    c.track({ dispose: () => labels?.dispose() });
    labelled = null;
    setLabels();
    applyGrowth();
    showContext();
  };

  const mounted = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!mounted) return null;
  ctx = mounted;

  /** The fitted frustum: Front is the 2D panel; away from it, the whole box. */
  const fit = () => {
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    const front = frontFrustum({ width: W, height: H }, frontRect(W, H), map.box);
    const w = away();
    if (w === 0) {
      Object.assign(camera, front);
      return;
    }
    const right = new ctx.three.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new ctx.three.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [map.box.min[2], map.box.max[2]]) {
      const u = x * right.x + y * right.y + z * right.z;
      const v = x * up.x + y * up.y + z * up.z;
      [u0, u1, v0, v1] = [Math.min(u0, u), Math.max(u1, u), Math.min(v0, v), Math.max(v1, v)];
    }
    // Room for the axis labels, which hide in the frame's bottom 56 px:
    // the frequency name sits 30 px under the box's front edge. Looking
    // down, room above for the time axis's name.
    const look = looking();
    const margin = { left: Math.max(36, W * 0.07), right: Math.max(28, W * 0.07), top: 14 + 18 * look, bottom: 72 + 24 * look };
    const aw = W - margin.left - margin.right;
    const ah = H - margin.top - margin.bottom;
    // One scale for both screen axes at the Corner, so the box keeps its
    // shape; looking down, the spectrogram may stretch to the frame's width.
    const stretch = 1 + 2 * look;
    let su = aw / (u1 - u0);
    let sv = ah / (v1 - v0);
    if (su > sv * stretch) su = sv * stretch;
    if (sv > su * stretch) sv = su * stretch;
    const left = u0 - (margin.left + (aw - (u1 - u0) * su) / 2) / su;
    const top = v1 + (margin.top + (ah - (v1 - v0) * sv) / 2) / sv;
    const wide = { left, right: left + W / su, top, bottom: top - H / sv };
    for (const side of /** @type {const} */ (["left", "right", "top", "bottom"])) {
      camera[side] = front[side] + (wide[side] - front[side]) * w;
    }
  };

  let cut = cutaway();
  let lookedAt = looking();
  let zoomedAt = 0;
  orbit = createOrbit(ctx, {
    target: [0, 0, 0], distance: DISTANCE, zoom: opts.look.zoom || 1, presets: PRESETS,
    start: state.preset in PRESETS ? state.preset : "corner", fit, onDrag: opts.onDrag,
    onChange: () => {
      setLabels();
      labels?.update();
      showContext();
      const look = looking();
      const zoomed = Math.log2(orbit?.zoom() ?? 1);
      if (cutaway() !== cut || Math.abs(look - lookedAt) > 0.04 || (look !== lookedAt && (look === 0 || look === 1)) ||
          Math.abs(zoomed - zoomedAt) > 0.1 || (zoomed !== zoomedAt && zoomed === 0)) {
        cut = cutaway();
        lookedAt = look;
        zoomedAt = zoomed;
        paint();
      }
      if (parts) {
        // Looking down, each row widens to its spacing on screen, so the
        // stack reads as a solid spectrogram.
        const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
        const rowPx = (Math.abs(map.z(HOP_S) - map.z(0)) * frame.clientHeight * camera.zoom) / (camera.top - camera.bottom);
        parts.lines.material.linewidth = 1.25 + Math.max(0, rowPx - 1.25) * look;
      }
      probe.pose = orbit?.pose() ?? FRONT;
      probe.zoom = orbit?.zoom() ?? 1;
    },
  });
  probe.pose = orbit.pose();

  /**
   * The highlight shows once its slice has begun to grow, so the intro's
   * first frame is not an empty dashed box; its chip goes with it.
   */
  const showHighlight = () => {
    if (!highlight) return;
    const on = (grown[state.frame] ?? 1) > 0;
    highlight.visible = on;
    const chip = highlight.chip?.node.parentElement;
    if (chip) chip.style.visibility = on ? "" : "hidden";
  };

  /**
   * Grow the slices front to back and the wall with them; on the first view
   * the camera eases from Front to Corner first. The wavefront starts once
   * the camera is 60% of the way round, so the time order is seen from an
   * angle, and the highlight pulses as the wavefront reaches its slice.
   * @param {boolean} withCamera
   */
  const play = (withCamera) => {
    if (!timeline || !parts || prefersReducedMotion()) return;
    const n = parts.n;
    growing = true;
    grown.fill(0);
    wallGrown = 0;
    applyGrowth();
    showHighlight();
    showContext();
    const end = PRESETS[state.preset] ?? PRESETS.corner;
    let delay = 0;
    if (withCamera && orbit) {
      const o = orbit;
      o.set(FRONT);
      const dyaw = ((((end.yaw - FRONT.yaw) % 360) + 540) % 360) - 180;
      const camera = duration("3d-camera");
      delay = 0.6 * camera;
      void timeline.play("camera", {
        ms: camera, ease: "inout", build: true,
        step: (t) => o.set({ yaw: dyaw * t, pitch: end.pitch * t }),
      });
    }
    // The first view gets a longer build, so the wavefront can be followed.
    const ms = duration("3d-build") * (withCamera ? 1.45 : 1);
    let pulsed = false;
    const grow = timeline.play("grow", {
      ms, delay, ease: "linear", build: true,
      step: (t) => {
        // Front to back in time order: slice c starts at 0.85 c / n and
        // rises over 0.13 of the track, a narrow wavefront.
        for (let c = 0; c < n; c += 1) grown[c] = smooth((t - (SPREAD * c) / n) / RAMP);
        // The wall rises behind the wavefront, on the same track.
        wallGrown = smooth((t - 0.15) / 0.85);
        applyGrowth();
        showHighlight();
        if (!pulsed && (grown[state.frame] ?? 0) > 0) {
          pulsed = true;
          if (t < 1) void highlight?.pulse();
        }
      },
    });
    void grow.then(() => {
      growing = false;
      showHighlight();
      showContext();
    });
  };

  let described = 0;
  const label = () => {
    clearTimeout(described);
    described = window.setTimeout(() => ctx.renderer?.domElement?.setAttribute("aria-label", describe()), 250);
  };

  /** @param {unknown} next */
  const update = (next) => {
    state = /** @type {SpectraState} */ (next);
    if (state.clip !== shownClip) {
      ctx.finish();
      map = toScene({ x: [0, nyquist()], y: [FLOOR_DB, 0], z: [BOX_S, 0] }, EXTENT);
      makeParts();
      applyGrowth();
      showContext();
      play(false);
    } else if (state.frame !== shownFrame) {
      shownFrame = state.frame;
      highlight?.set(shownSelected());
      showHighlight();
      paint();
    }
    highlight?.chip?.set({ text: chipText() });
    if (state.pulses !== shownPulses) {
      shownPulses = state.pulses;
      if (!growing) void highlight?.pulse();
    }
    label();
    ctx.requestRender();
  };

  if (opts.intro) {
    probe.played += 1;
    play(true);
  }

  /** What the highlight's line draws: the start of each segment and the last end, flat x, y, z. */
  const drawnPoints = () => {
    const line = /** @type {Fat | undefined} */ (highlight?.children.find((o) => o.renderOrder === 11));
    if (!line) return [];
    const a = /** @type {Float32Array} */ (ends(line, "instanceStart").array);
    const out = [];
    for (let i = 0; i < a.length; i += 6) out.push(a[i], a[i + 1], a[i + 2]);
    if (a.length) out.push(a[a.length - 3], a[a.length - 2], a[a.length - 1]);
    return out;
  };
  // Projects the highlight's own geometry, so a highlight left on another
  // window fails the Front test.
  probe.frontPoints = () => {
    const v = new ctx.three.Vector3();
    const p = drawnPoints();
    /** @type {number[][]} */
    const out = [];
    for (let i = 0; i < p.length; i += 3) {
      v.set(p[i], p[i + 1], p[i + 2]).project(ctx.camera);
      out.push([((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight]);
    }
    return out;
  };
  probe.frontRect = () => frontRect(frame.clientWidth, frame.clientHeight);
  probe.contextShown = () => Boolean(parts?.group.visible);
  probe.curtainsFrom = () => (parts ? parts.curtains.geometry.drawRange.start / parts.perSlice : 0);
  probe.slices = () => parts?.n ?? 0;
  probe.chip = () => highlight?.chip?.node.textContent ?? "";
  probe.wallAboveSlices = () => {
    if (!parts) return false;
    const { ys, wallYs, n, nb } = parts;
    for (let c = 0; c < n; c += 1) {
      let high = -Infinity;
      for (let k = 0; k < nb; k += 1) high = Math.max(high, ys[c * nb + k]);
      if (wallYs[c] < high - 1e-6) return false;
    }
    return true;
  };

  await ctx.drawn();
  return {
    update,
    preset: (name) => {
      if (!(name in PRESETS) || !orbit) return;
      ctx.finish();
      void orbit.go(name);
    },
    describe,
    close: () => {
      clearTimeout(described);
      if (TEST_HOOK && TEST_HOOK.figures[KEY] === probe) delete TEST_HOOK.figures[KEY];
      ctx.dispose();
    },
  };

  /** The 3D canvas's sentence. */
  function describe() {
    const text = state.data?.doc.clip.text ?? "a sentence";
    return `A waterfall of “${text}”, ${state.voice} voice: one spectrum every 20 milliseconds, ` +
      "frequency across from 0 to 4 kilohertz, level up from -85 to 0 dBFS, and time into the page " +
      `from 0 to 3.7 seconds. The outlined spectrum is the window at ${(state.frame * HOP_S).toFixed(2)} s. ` +
      "A wall on the 0 hertz side shows each window's total energy, which is never below that window's highest bin.";
  }
}
