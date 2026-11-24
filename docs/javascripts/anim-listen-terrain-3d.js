// @ts-check
/* ===========================================================================
 * anim-listen-terrain-3d.js: the original and the decoded audio as terrain
 * (three-everywhere design §5.8; visual language design).
 * ---------------------------------------------------------------------------
 * Loaded by anim-listen-terrain.js through lib/view-switch.js only when 3D
 * is wanted. It takes the 2D module's arrays and computes no model data.
 *
 *   x  time, the clip's length across
 *   y  level, -80 to 0 dBFS; the difference is a nearly flat carpet on the
 *      floor (at most 0.15 of the sheets' height), its colour carrying it
 *   z  three strips of 0 to 3969 Hz each, high frequencies at the back:
 *      the original at the back, decoded minus original in the middle, the
 *      decoded audio at the front, with a gap between, so the sheets never
 *      touch. Top is the 2D layout, drawn with the 2D strips' own pictures.
 *
 * Each sheet is a vertex-coloured mesh (the ramp by level, faded into the
 * floor when quiet; the difference in --ambe-diverge-*, quiet frames flat
 * and grey) under one LineSegments2 of thin slices along frequency, faded
 * by their distance from the selected frame. A clip over 110 frames keeps
 * every other slice in the context; the selection keeps every frame.
 * Cutaway: below 60 degrees of pitch, the surfaces on the camera's side of
 * the selected frame are not drawn and their lines fade a further 0.15.
 * The selected frame's slice through the original and decoded sheets wears
 * the highlight kit, with its chip, broken at the strips' gaps; through the
 * difference it is a context line about a dashed 0 dB baseline.
 *
 * In front of the sheets, hanging from the floor's front edge, a result
 * panel: the clip's mean peak-normalised spectrum against f / f0 (the 2D
 * panel's two curves), the original dashed and the decoded in ink, the
 * gap where the decoded curve is lower in the diverge blue. It folds away
 * when the camera does not face it (Top, Side).
 *
 * The explanatory animation, "the decoded speech keeps the harmonic peaks
 * and deepens the valleys between them": the original and decoded sheets
 * rise from one plane in the middle strip and slide apart along depth to
 * their own strips, the difference carpet grows between them, and then
 * the panel's curve, in the highlight, morphs from the original's profile
 * to the decoded one while the valleys' gap fills blue, ending on a chip
 * with the clip's valley depths. Its end state is the figure itself. A
 * step with play="valleys" replays the last beat; a clip change alone
 * lands on the end state.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK, prefersReducedMotion } from "./anim-core.js";
import {
  DIFF_DB, HOP_S, PROFILE_HARMONICS, PROFILE_U, STRIP, colourT, diffIndex, diffTable, levelColour, levelT, maskColour, stripImage,
} from "./anim-listen-terrain.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { createChip, createLabels } from "./lib/labels.js";
import { TOP, createOrbit, frontFrustum } from "./lib/orbit.js";
import { contactShadow, darkGround, fadeAmount, fatLines, floor, fog, frostedFill, mix, printing, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./anim-listen-terrain.js").ListenState} ListenState */
/** @typedef {import("./anim-listen-terrain.js").ListenData} ListenData */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {import("three/addons/lines/LineSegments2.js").LineSegments2} Fat */

const KEY = "listen-terrain-3d";
const EX = 2.6;
const EY = 0.75;
const DEPTH = 3 * STRIP.depth + 2 * STRIP.gap;
const DISTANCE = 8;
/** @type {Record<string, Pose>} */
const PRESETS = { corner: { yaw: -34, pitch: 30 }, top: TOP, side: { yaw: 90, pitch: 10 } };
/** Where the first view's camera starts, low and to the side, so the slide reads. */
const INTRO_POSE = { yaw: -64, pitch: 14 };
/** Surface columns at most, and thin slices (ribs) at most, per sheet. */
const MAX_COLUMNS = 64;
const MAX_RIBS = 10;
const FADE_STEP = 5;
const CUTAWAY_PITCH = 60;
/** How far a surface goes from its level colour toward the floor. */
const VEIL = { dark: 0.15, light: 0.25 };
const [y0, y1] = [-EY / 2, EY / 2];
/** The difference carpet: its 0 dB level, and how far 20 dB moves it. */
const DIFF_H = 0.075 * EY;
const yc = y0 + DIFF_H;
/**
 * The result panel, a card standing under the sheets in front, square on
 * to the Corner preset (its yaw): its top's drop below the floor, its
 * height and width, where its centre sits across and toward the camera at
 * Corner, and its dB range.
 */
const PANEL = { gap: 0.3, height: 0.9, width: 2.4, yaw: -34, across: -0.25, out: 2.0, db: 50 };
const pTop = y0 - PANEL.gap;
const pBottom = pTop - PANEL.height;
const CARD_YAW = (PANEL.yaw * Math.PI) / 180;
/** The card's own x axis in the scene, and its centre. */
const CARD_X = /** @type {[number, number, number]} */ ([Math.cos(CARD_YAW), 0, -Math.sin(CARD_YAW)]);
const CARD_C = [CARD_X[0] * PANEL.across + Math.sin(CARD_YAW) * PANEL.out, 0, CARD_X[2] * PANEL.across + Math.cos(CARD_YAW) * PANEL.out];
/** A point of the card (its x, y) in the scene. @param {number} x @param {number} y */
const cardAt = (x, y) => /** @type {[number, number, number]} */ ([CARD_C[0] + CARD_X[0] * x, y, CARD_C[2] + CARD_X[2] * x]);
/** The valleys beat: the morph takes one --ambe-dur-3d-build, the chip holds this many more. */
const HOLD = 1.7;

/** @param {number} t */
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** @param {number} b strip, 0 original, 1 difference, 2 decoded @param {number} f 0 to 1 of the top bin */
const zOf = (b, f) => -DEPTH / 2 + b * (STRIP.depth + STRIP.gap) + STRIP.depth * (1 - f);
/** @param {number} db */
const yLevel = (db) => y0 + levelT(db) * EY;
/** @param {number} db */
const yDiff = (db) => yc + Math.max(-1, Math.min(1, db / DIFF_DB)) * DIFF_H;
/** The panel's x for u = f / f0. @param {number} u */
const pX = (u) => ((u - PROFILE_U[0]) / (PROFILE_U[1] - PROFILE_U[0]) - 0.5) * PANEL.width;
/** The panel's y for dB re peak. @param {number} db */
const pY = (db) => pBottom + ((Math.max(-PANEL.db, Math.min(0, db)) + PANEL.db) / PANEL.db) * PANEL.height;
/** A polyline (flat x, y, z) as segment pairs, leaving out the segments listed. */
const pairs = (/** @type {ArrayLike<number>} */ p, /** @type {number[]} */ skip = []) => {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i + 1 < p.length / 3; i += 1) {
    if (!skip.includes(i)) for (let j = 0; j < 6; j += 1) out.push(p[i * 3 + j]);
  }
  return out;
};

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let state = /** @type {ListenState} */ (opts.state);
  const probe = { builds: 0, played: 0, pose: /** @type {Pose} */ (PRESETS.corner), zoom: 1,
    frontPoints: () => /** @type {number[][]} */ ([]), chip: () => "", columns: () => 0, drawnFrom: () => [0, 0],
    grown: () => [1, 1, 1, 1], diffShown: () => false, segments: () => 0, labels: () => /** @type {string[]} */ ([]),
    panel: () => 0, flat: () => false, beat: () => "" };
  if (TEST_HOOK) TEST_HOOK.figures[KEY] = probe;

  /** @type {ThreeContext} */
  let ctx;
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /**
   * One per strip: the moving group, its mesh, its lines, and the flat
   * picture the Top preset shows.
   * @type {{group: import("three").Group, mesh: import("three").Mesh, lines: Fat,
   *         flat: import("three").Mesh, texture: import("three").CanvasTexture}[]}
   */
  let sheets = [];
  /** The frames the surfaces have a column at, and the ones with a rib. */
  let columns = /** @type {number[]} */ ([]);
  let ribs = /** @type {number[]} */ ([]);
  /** @type {(import("three").Group & import("./lib/highlight.js").HighlightKit) | null} */
  let highlight = null;
  /** The difference's part of the slice, and its 0 dB baseline. */
  /** @type {{group: import("three").Group, line: Fat, zero: Fat} | null} */
  let diffSlice = null;
  /** @type {import("./lib/labels.js").Chip | null} */
  let chip = null;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  /** The result panel, its moving parts, the beat's highlight and chip. */
  /** @type {{group: import("three").Group, gap: import("three").Mesh, decoded: Fat, original: Fat} | null} */
  let panel = null;
  /** @type {(import("three").Group & import("./lib/highlight.js").HighlightKit) | null} */
  let beatKit = null;
  /** @type {import("./lib/labels.js").Chip | null} */
  let beatChip = null;
  /** @type {import("./anim-three.js").Timeline | null} */
  let timeline = null;
  /** Rise of the two sheets, their slide apart, the difference's growth, the valleys' morph; 0 to 1. */
  let rise = 1;
  let slide = 1;
  let grow = 1;
  let valley = 1;
  /** The valleys beat: "" off, "morph" while the curve moves, "chip" while the chip holds. */
  let beat = "";
  /** Bumped by every valleys beat, so a beat cut short does not end the next. */
  let beatSeq = 0;
  /** No beat running or due: the figure at rest. */
  const resting = () => beat === "" && valley === 1;
  // What the scene shows now: the 2D module hands over the same state
  // object each time, changed in place, so the last values are kept here.
  let shownClip = "";
  let shown = { frame: state.frame, show: state.show };
  let shownPulses = state.pulses;
  let shownReplays = state.replays;

  const data = () => /** @type {ListenData} */ (state.data);
  /** @param {number} i */
  const xOf = (i) => ((i + 0.5) * HOP_S / data().duration) * EX - EX / 2;
  const chipText = () => `this frame: ${((state.frame + 0.5) * HOP_S).toFixed(2)} s`;
  const valleyText = () => {
    const [lo, hi] = data().profile.deeper_db;
    return `valleys ${lo.toFixed(1)} to ${hi.toFixed(1)} dB deeper`;
  };
  const phone = () => frame.clientWidth < 560;

  const poseNow = () => {
    const p = ctx.camera.position;
    const d = p.length() || 1;
    return { yaw: (Math.atan2(p.x, p.z) * 180) / Math.PI, pitch: (Math.asin(p.y / d) * 180) / Math.PI };
  };
  /** 0 below 50 degrees of pitch to 1 at Top. */
  const looking = () => smooth((poseNow().pitch - 50) / 35);
  const cutaway = () => poseNow().pitch < CUTAWAY_PITCH;
  /** The camera's side of the selection: later frames when it looks from +x. */
  const laterInFront = () => poseNow().yaw >= 0;
  /** Looking along time, near the Side preset. */
  const sideOn = () => {
    const p = poseNow();
    return Math.abs(Math.abs(p.yaw) - 90) < 25 && p.pitch < 35;
  };
  /**
   * How far the panel has folded away for good, 0 to 1. The 2D panel under
   * the frame draws the same two curves, larger, so the scene's own panel
   * shows only while its beat plays (the opening, or a step that replays
   * it) and then folds away, leaving the sheets the whole frame.
   */
  let away = opts.intro ? 0 : 1;
  /** How far the panel is unfolded: 1 when the camera faces it, 0 edge on. */
  const panelShow = () => {
    const p = poseNow();
    const facing = Math.cos(((p.yaw - PANEL.yaw) * Math.PI) / 180) * Math.cos((p.pitch * Math.PI) / 180);
    return smooth((facing - 0.3) / 0.3) * (1 - away);
  };

  /* -- the highlight's curve ----------------------------------------------- */

  /** The selected slice through the decoded (front) and original (back)
   *  sheets, in the highlight's own plane (local u = -z, y; the group turns
   *  it onto x), and the segment that jumps between them. */
  const slice = () => {
    const d = data();
    const i = state.frame;
    /** @type {number[]} */
    const out = [];
    let jump = 0;
    /** @param {number} z @param {number} y */
    const put = (z, y) => out.push(-z, y, xOf(i));
    for (const b of [2, 0]) {
      if (b === 0) jump = out.length / 3 - 1;
      const levels = b === 0 ? d.original : d.decoded;
      put(zOf(b, 0), y0);
      for (let k = 0; k < d.bins; k += 1) put(zOf(b, k / (d.bins - 1)), yLevel(levels[i * d.bins + k]));
      put(zOf(b, 1), y0);
    }
    return { points: out, jump };
  };
  /** The kit's glow, line and core, which carry the break. */
  const kitLines = () => /** @type {Fat[]} */ (highlight?.children.filter((o) => o.renderOrder >= 10) ?? []);
  /** The chip's anchor: the original slice's highest point, in the scene. */
  const peak = () => {
    const d = data();
    let best = 0;
    for (let k = 1; k < d.bins; k += 1) if (d.original[state.frame * d.bins + k] > d.original[state.frame * d.bins + best]) best = k;
    return /** @type {[number, number, number]} */ ([xOf(state.frame), yLevel(d.original[state.frame * d.bins + best]), zOf(0, best / (d.bins - 1))]);
  };
  const placeHighlight = () => {
    if (!highlight) return;
    const { points, jump } = slice();
    highlight.set(points);
    const broken = pairs(points, [jump]);
    for (const line of kitLines()) setSegments(line, broken);
    chip?.set({ text: chipText(), at: peak() });
    if (diffSlice) {
      const d = data();
      const i = state.frame;
      /** @type {number[]} */
      const curve = [];
      for (let k = 0; k < d.bins; k += 1) curve.push(xOf(i), d.energetic[i] ? yDiff(d.diff[i * d.bins + k]) : yc, zOf(1, k / (d.bins - 1)));
      setSegments(diffSlice.line, pairs(curve));
      setSegments(diffSlice.zero, [xOf(i), yc, zOf(1, 0), xOf(i), yc, zOf(1, 1)]);
    }
  };
  /** At Side the slice is the subject of a close reading: 2 px, no glow. */
  let sideStyled = false;
  const styleSide = () => {
    const [glow, line] = kitLines();
    if (!glow || !line) return;
    glow.visible = !sideStyled && !printing();
    line.material.linewidth = sideStyled ? 2 : 3.25;
    ctx.requestRender();
  };

  /* -- colour ---------------------------------------------------------------- */

  /**
   * sRGB 0xRRGGBB to linear r, g, b, as the shaders want vertex colours.
   * @param {number} hex @param {Float32Array} out @param {number} at
   */
  const put = (hex, out, at) => {
    for (let c = 0; c < 3; c += 1) {
      const v = (Math.floor(hex / 256 ** (2 - c)) % 256) / 255;
      out[at + c] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }
  };
  /** Level colours in 256 steps per ground, and the difference's in 256. */
  let lut = { line: /** @type {number[]} */ ([]), surface: /** @type {number[]} */ ([]), diff: /** @type {number[]} */ ([]), mask: 0, ground: 0 };
  const readColours = () => {
    const ground = tokenHex("--ambe-plot-bg");
    const floorHex = tokenHex("--ambe-3d-floor");
    const veil = darkGround() ? VEIL.dark : VEIL.light;
    const line = Array.from({ length: 256 }, (_, j) => levelColour(j / 255, ground));
    lut = {
      line,
      surface: Array.from({ length: 256 }, (_, j) => mix(levelColour(j / 255, floorHex), floorHex, veil)),
      diff: diffTable(floorHex),
      mask: maskColour(),
      ground,
    };
    // The Top preset's pictures are the 2D strips', in this theme.
    if (state.data) {
      sheets.forEach(({ texture }, b) => {
        texture.image = stripImage(data(), b);
        texture.needsUpdate = true;
      });
    }
  };
  /** @param {number} b @param {number} i @param {number} k */
  const entry = (b, i, k) => {
    const d = data();
    if (b === 1) return diffIndex(d, i, k);
    return Math.round(colourT(d, (b === 0 ? d.original : d.decoded)[i * d.bins + k]) * 255);
  };

  /** Every vertex colour, from the selection, the pose and the theme. */
  const paint = () => {
    if (!sheets.length || !state.data) return;
    const d = data();
    const sel = state.frame;
    const look = looking();
    const cut = cutaway();
    const later = laterInFront();
    const veilAway = 1 - look;
    sheets.forEach(({ mesh, lines }, b) => {
      const lineColours = /** @type {Float32Array} */ (/** @type {import("three").InterleavedBufferAttribute} */ (lines.geometry.attributes.instanceColorStart).data.array);
      const surface = /** @type {Float32Array} */ (mesh.geometry.getAttribute("color").array);
      /** @param {number} e */
      const hexOf = (e) => (b === 1 ? (e < 0 ? lut.mask : lut.diff[e]) : lut.line[e]);
      columns.forEach((i, c) => {
        for (let k = 0; k < d.bins; k += 1) {
          const e = entry(b, i, k);
          put(b === 1 ? hexOf(e) : mix(lut.surface[e], lut.line[e], look), surface, (c * d.bins + k) * 3);
        }
      });
      ribs.forEach((i, c) => {
        const front = cut && (later ? i > sel : i < sel);
        const amount = Math.min(1, fadeAmount((i - sel) / FADE_STEP) * veilAway + (front ? 0.15 : 0));
        for (let k = 0; k < d.bins; k += 1) {
          const faded = mix(hexOf(entry(b, i, k)), lut.ground, amount);
          if (k + 1 < d.bins) put(faded, lineColours, (c * (d.bins - 1) + k) * 6);
          if (k > 0) put(faded, lineColours, (c * (d.bins - 1) + k - 1) * 6 + 3);
        }
      });
      /** @type {import("three").InterleavedBufferAttribute} */ (lines.geometry.attributes.instanceColorStart).data.needsUpdate = true;
      mesh.geometry.getAttribute("color").needsUpdate = true;
      // Cutaway: only the surfaces on the far side of the selection.
      const per = 6 * (d.bins - 1);
      let at = 0;
      while (at < columns.length && columns[at] <= sel) at += 1;
      const quads = columns.length - 1;
      if (!cut) mesh.geometry.setDrawRange(0, Infinity);
      else if (later) mesh.geometry.setDrawRange(0, Math.max(0, at - 1) * per);
      else mesh.geometry.setDrawRange(Math.max(0, at - 1) * per, Math.max(0, quads - at + 1) * per);
      lines.visible = look < 0.98;
    });
    applyMotion();
  };

  /* -- geometry -------------------------------------------------------------- */

  /** @param {import("three").Object3D} root */
  const dispose = (root) => {
    ctx.scene.remove(root);
    root.traverse((node) => {
      const o = /** @type {{geometry?: {dispose(): void}, material?: {dispose(): void, map?: {dispose(): void}}}} */ (node);
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    });
  };

  /** The three sheets, their flat pictures, and the panel, for the clip in state. */
  const makeSheets = () => {
    for (const { group, flat } of sheets) {
      dispose(group);
      dispose(flat);
    }
    sheets = [];
    if (!state.data) return;
    const T = ctx.three;
    const d = data();
    /** @param {number} most */
    const every = (most) => {
      const step = Math.ceil(d.n / most);
      const out = [];
      for (let i = 0; i < d.n; i += step) out.push(i);
      if (out[out.length - 1] !== d.n - 1) out.push(d.n - 1);
      return out;
    };
    columns = every(MAX_COLUMNS);
    ribs = every(MAX_RIBS);
    const C = columns.length;
    const R = ribs.length;
    const nb = d.bins;
    /** @type {number[]} */
    const index = [];
    for (let c = 0; c + 1 < C; c += 1) {
      for (let k = 0; k + 1 < nb; k += 1) {
        const a = c * nb + k;
        index.push(a, a + nb, a + 1, a + 1, a + nb, a + nb + 1);
      }
    }
    for (const b of [0, 1, 2]) {
      const levels = b === 0 ? d.original : b === 2 ? d.decoded : d.diff;
      /** @param {number} i @param {number} k */
      const yAt = (i, k) => (b === 1 ? (d.energetic[i] ? yDiff(levels[i * nb + k]) : yc) : yLevel(levels[i * nb + k]));
      const positions = new Float32Array(C * nb * 3);
      columns.forEach((i, c) => {
        for (let k = 0; k < nb; k += 1) positions.set([xOf(i), yAt(i, k), zOf(b, k / (nb - 1))], (c * nb + k) * 3);
      });
      const segments = new Float32Array(R * (nb - 1) * 6);
      ribs.forEach((i, c) => {
        for (let k = 1; k < nb; k += 1) {
          segments.set([xOf(i), yAt(i, k - 1), zOf(b, (k - 1) / (nb - 1)), xOf(i), yAt(i, k), zOf(b, k / (nb - 1))],
            (c * (nb - 1) + k - 1) * 6);
        }
      });
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(positions.length), 3));
      geometry.setIndex(index);
      const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({
        vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      mesh.frustumCulled = false;
      const lines = fatLines(ctx, segments, () => new Array(R * (nb - 1) * 2).fill(0), 1.25, { fog: true });
      lines.frustumCulled = false;
      const group = new T.Group();
      group.add(mesh, lines);
      if (b === 1) {
        // The carpet's 0 dB rim.
        const [za, zb] = [zOf(1, 0), zOf(1, 1)];
        group.add(fatLines(ctx, [-EX / 2, yc, za, EX / 2, yc, za, EX / 2, yc, za, EX / 2, yc, zb,
          EX / 2, yc, zb, -EX / 2, yc, zb, -EX / 2, yc, zb, -EX / 2, yc, za], "--ambe-plot-axis", 1));
      }
      ctx.scene.add(group);
      // Top: the 2D strip's own picture, flat on the floor.
      // readColours() draws its picture, below.
      const texture = new T.CanvasTexture(document.createElement("canvas"));
      texture.colorSpace = T.SRGBColorSpace;
      const flat = new T.Mesh(new T.PlaneGeometry(EX, STRIP.depth), new T.MeshBasicMaterial({ map: texture, fog: false }));
      flat.rotation.x = -Math.PI / 2;
      flat.position.set(0, y0 + 0.004, zOf(b, 0.5));
      flat.visible = false;
      ctx.scene.add(flat);
      sheets.push({ group, mesh, lines, flat, texture });
    }
    sheets[0].lines.userData.recolour = () => {
      readColours();
      paint();
    };
    makePanel();
    shownClip = d.clip;
    readColours();
    paint();
  };

  /** The result panel for the clip in state. */
  const makePanel = () => {
    if (panel) dispose(panel.group);
    panel = null;
    if (!state.data) return;
    const T = ctx.three;
    const { profile } = data();
    const z = 0;
    const [x0, x1] = [pX(PROFILE_U[0]), pX(PROFILE_U[1])];
    const group = new T.Group();
    group.position.set(CARD_C[0], 0, CARD_C[2]);
    group.rotation.y = CARD_YAW;
    const back = frostedFill(ctx, [x0, x1], [pTop, pTop], z - 0.004, pBottom, "--ambe-3d-floor", "--ambe-plot-bg", { fog: false });
    /** @type {number[]} */
    const grid = [];
    for (let h = 1; h <= PROFILE_HARMONICS; h += 1) grid.push(pX(h), pBottom, z - 0.002, pX(h), pTop, z - 0.002);
    for (const db of [-20, -40]) grid.push(x0, pY(db), z - 0.002, x1, pY(db), z - 0.002);
    const gridGeometry = new T.BufferGeometry();
    gridGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array(grid), 3));
    const gridLines = new T.LineSegments(gridGeometry, ctx.paint(new T.LineBasicMaterial({ fog: false }), "--ambe-plot-grid"));
    const edge = fatLines(ctx, [x0, pTop, z, x1, pTop, z, x0, pBottom, z, x1, pBottom, z, x0, pBottom, z, x0, pTop, z,
      x1, pBottom, z, x1, pTop, z], "--ambe-plot-axis", 1);
    // The valleys' gap, two vertices per u: the original's and the lower of the two.
    const n = profile.u.length;
    const gapGeometry = new T.BufferGeometry();
    gapGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array(n * 6), 3));
    /** @type {number[]} */
    const index = [];
    for (let k = 0; k + 1 < n; k += 1) index.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 2, 2 * k + 1, 2 * k + 3);
    gapGeometry.setIndex(index);
    const gapMaterial = new T.MeshBasicMaterial({ side: T.DoubleSide, fog: false });
    const gap = new T.Mesh(gapGeometry, gapMaterial);
    gap.userData.recolour = () => gapMaterial.color.setHex(mix(tokenHex("--ambe-diverge-neg"), tokenHex("--ambe-3d-floor"), 0.3));
    gap.userData.recolour();
    gap.frustumCulled = false;
    const curve = (/** @type {number[]} */ ys, /** @type {number} */ dz) => pairs(profile.u.flatMap((u, k) => [pX(u), pY(ys[k]), z + dz]));
    const original = fatLines(ctx, curve(profile.original, 0.002), "--ambe-plot-muted", 1.75, { dashed: true, dash: 0.035, gap: 0.03 });
    const decoded = fatLines(ctx, curve(profile.decoded, 0.004), "--ambe-plot-ink", 2.5);
    // Back to front, each over the last; nothing else lies in front of the panel.
    [back, gridLines, gap, edge, original, decoded].forEach((o, j) => {
      o.renderOrder = 4 + j / 10;
      const material = /** @type {import("three").Material} */ (o.material);
      material.depthTest = false;
      material.depthWrite = false;
    });
    group.add(back, gridLines, gap, edge, original, decoded);
    ctx.scene.add(group);
    panel = { group, gap, decoded, original };
    if (beatKit) beatKit.set(profile.u.flatMap((u, k) => [pX(u), pY(profile.decoded[k]), 0.006]));
    setValley(valley);
  };

  /** The panel's curve at morph m: the original's profile at 0, the decoded one at 1. */
  const setValley = (/** @type {number} */ m) => {
    valley = m;
    if (!panel || !state.data) return;
    const { profile } = data();
    const z = 0;
    const now = profile.u.map((_, k) => profile.original[k] + m * (profile.decoded[k] - profile.original[k]));
    const points = profile.u.flatMap((u, k) => [pX(u), pY(now[k]), z + 0.004]);
    setSegments(panel.decoded, pairs(points));
    const position = /** @type {import("three").BufferAttribute} */ (panel.gap.geometry.getAttribute("position"));
    profile.u.forEach((u, k) => {
      position.setXYZ(2 * k, pX(u), pY(profile.original[k]), z);
      position.setXYZ(2 * k + 1, pX(u), pY(Math.min(profile.original[k], now[k])), z);
    });
    position.needsUpdate = true;
    if (beat) beatKit?.set(points.map((v, j) => (j % 3 === 2 ? v + 0.002 : v)));
    ctx.requestRender();
  };
  /** The valleys' chip anchor: the decoded curve halfway after the harmonic whose valley deepened most. */
  const deepest = () => {
    const { profile } = data();
    const h = profile.harmonics.reduce((a, b) => (b.deeper_db > a.deeper_db ? b : a)).h;
    const k = Math.round((h + 0.5 - PROFILE_U[0]) / (profile.u[1] - profile.u[0]));
    return cardAt(pX(profile.u[k]), pY(profile.decoded[k]));
  };

  /** Show or hide a chip; one coming back is measured and placed again. */
  const reveal = (/** @type {import("./lib/labels.js").Chip | null} */ c, /** @type {boolean} */ on) => {
    const layer = c?.node.parentElement;
    if (!c || !layer || layer.hidden === !on) return;
    layer.hidden = !on;
    if (on) c.update();
  };

  /** Place the sheets at their rise, slide and growth, and show what goes with them. */
  const applyMotion = () => {
    if (!sheets.length) return;
    const offset = (1 - slide) * (STRIP.depth + STRIP.gap);
    const built = rise === 1 && slide === 1 && grow === 1;
    const flat = looking() > 0.98 && built;
    sheets.forEach(({ group, flat: picture }, b) => {
      const s = b === 1 ? grow : rise;
      group.scale.y = Math.max(1e-4, s);
      // The two sheets scale up from the floor; the carpet from its 0 dB level.
      group.position.y = b === 1 ? yc * (1 - s) : y0 * (1 - s);
      group.position.z = b === 0 ? offset : b === 2 ? -offset : 0;
      const wanted = b !== 1 || state.show === "difference";
      group.visible = wanted && !flat && (b !== 1 || grow > 0);
      picture.visible = wanted && flat;
    });
    const unfold = panelShow();
    if (panel) {
      panel.group.visible = unfold > 0.01;
      panel.group.scale.y = Math.max(1e-4, unfold);
      panel.group.position.y = pTop * (1 - unfold);
    }
    if (beatKit) beatKit.visible = beat !== "" && unfold > 0.99;
    reveal(beatChip, beat === "chip" && unfold > 0.99);
    if (highlight) highlight.visible = built && resting();
    if (diffSlice) diffSlice.group.visible = built && resting() && state.show === "difference" && !flat;
    reveal(chip, highlight?.visible ?? false);
    ctx.requestRender();
  };

  /* -- the view -------------------------------------------------------------- */

  /** @param {ThreeContext} c */
  const build = (c) => {
    ctx = c;
    probe.builds += 1;
    // The labels and chips wait for this scene's first frame.
    frame.dataset.ltLabels = "wait";
    // A rebuild (a context restore, an unpark) starts from nothing.
    highlight = null;
    beatKit = null;
    diffSlice = null;
    void c.drawn().then(() => requestAnimationFrame(() => delete frame.dataset.ltLabels));
    timeline = c.timeline();
    const T = c.three;
    /** @type {import("./lib/orbit.js").SceneBox} */
    const box = { min: [-EX / 2, y0, -DEPTH / 2], max: [EX / 2, y1, DEPTH / 2] };
    c.scene.add(floor(c, { extent: box, step: [EX / 4, STRIP.depth + STRIP.gap] }));
    c.scene.add(contactShadow(c, { x: [-EX / 2, EX / 2], z: [-DEPTH / 2, DEPTH / 2], y: y0 }));
    // Time along the front, frequency down the left, and the dB axis up
    // the back left corner, the far end of the original strip, with ticks
    // at 0 and -40 dBFS.
    const [xa, za, zb] = [-EX / 2, -DEPTH / 2, DEPTH / 2];
    const axes = new T.BufferGeometry();
    axes.setAttribute("position", new T.BufferAttribute(new Float32Array([
      xa, y0, zb, EX / 2, y0, zb,
      xa, y0, za, xa, y0, zb,
      xa, y0, za, xa, y1, za,
      xa, y1, za, xa - 0.05, y1, za,
      xa, yLevel(-40), za, xa - 0.05, yLevel(-40), za,
    ]), 3));
    c.scene.add(new T.LineSegments(axes, c.paint(new T.LineBasicMaterial(), "--ambe-plot-axis")));
    fog(c, DISTANCE, DEPTH);
    sheets = [];
    panel = null;
    makeSheets();
    highlight = addHighlight(c, slice().points, { baseline: y0, top: y1 });
    highlight.rotation.y = Math.PI / 2;
    const recolour = highlight.userData.recolour;
    highlight.userData.recolour = () => {
      recolour();
      styleSide();
    };
    c.scene.add(highlight);
    const ink = fatLines(c, [0, yc, 0, 0, yc, 0], "--ambe-plot-ink", 1.5);
    const zero = fatLines(c, [0, yc, 0, 0, yc, 1], "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.03, gap: 0.025 });
    const group = new T.Group();
    group.add(ink, zero);
    c.scene.add(group);
    diffSlice = { group, line: ink, zero };
    chip = createChip(frame, c, { text: chipText(), at: peak() });
    c.track({ dispose: () => chip?.dispose() });
    const { profile } = data();
    beatKit = addHighlight(c, profile.u.flatMap((u, k) => [pX(u), pY(profile.decoded[k]), 0.006]),
      { baseline: pBottom, top: pTop, fill: false });
    beatKit.position.set(CARD_C[0], 0, CARD_C[2]);
    beatKit.rotation.y = CARD_YAW;
    // Its dashed outline goes over the panel, which ignores depth.
    const outline = beatKit.children[0];
    outline.renderOrder = 9;
    /** @type {import("three").Material} */ (/** @type {Fat} */ (outline).material).depthTest = false;
    c.scene.add(beatKit);
    beatChip = createChip(frame, c, { text: valleyText(), at: deepest() });
    c.track({ dispose: () => beatChip?.dispose() });
    labels = createLabels(frame, c);
    c.track({ dispose: () => labels?.dispose() });
    placeHighlight();
    if (orbit) {
      sideStyled = sideOn();
      styleSide();
    }
    setValley(valley);
    setLabels();
    applyMotion();
  };

  /** What the labels depend on besides the camera. */
  let labelKey = "";
  const setLabels = (force = true) => {
    if (!labels || !state.data) return;
    const d = data();
    const side = orbit ? sideOn() : false;
    const unfolded = orbit ? panelShow() > 0.5 : false;
    const top = orbit ? looking() > 0.5 : false;
    const built = rise === 1 && slide === 1 && grow === 1;
    const key = [d.clip, state.frame, state.show, side, unfolded, top, resting(), built, phone()].join("|");
    if (!force && key === labelKey) return;
    labelKey = key;
    /** @type {import("./lib/labels.js").Label[]} */
    const list = [];
    const names = ["original", "difference", "decoded"];
    names.forEach((name, b) => {
      if (b === 1 && state.show !== "difference") return;
      list.push({ text: name, at: [EX / 2 + 0.06, y0, zOf(b, 0.5)], align: "start" });
    });
    // One strip's frequency ends say it for all three.
    if (!phone()) {
      list.push({ text: "0 Hz", at: [EX / 2 + 0.06, y0, zOf(2, 0)], align: "start", tick: true, dy: 8 });
      list.push({ text: "4 kHz", at: [EX / 2 + 0.06, y0, zOf(2, 1)], align: "start", tick: true, dy: 8 });
    }
    const step = d.duration > 3 || phone() ? 1 : 0.5;
    for (let t = 0; t <= d.duration + 1e-9; t += step) {
      list.push({ text: `${t} s`, at: [(t / d.duration) * EX - EX / 2, y0, DEPTH / 2], align: "middle", tick: true, dy: 12, along: [1, 0, 0] });
    }
    list.push({ text: "dBFS", at: [-EX / 2, y1, -DEPTH / 2], align: "middle", dy: -14, along: [0, 1, 0] });
    if (!phone()) {
      list.push({ text: "0", at: [-EX / 2 - 0.06, y1, -DEPTH / 2], align: "end", tick: true, along: [0, 1, 0] });
      list.push({ text: "-40", at: [-EX / 2 - 0.06, yLevel(-40), -DEPTH / 2], align: "end", tick: true, along: [0, 1, 0] });
    }
    if (side && state.show === "difference" && !phone()) {
      list.push({ text: "0 dB (difference)", at: [xOf(state.frame), yc, zOf(1, 0.5)], align: "middle", dy: -24 });
    }
    // The panel's name, under its first peaks, and its result, over its
    // last ones once the beat's chip has gone. On a phone the 2D panel
    // under the frame says both.
    if (unfolded && !phone()) {
      list.push({ text: `harmonics 1 to ${PROFILE_HARMONICS} lined up, ${d.profile.frames} pitched frames`,
        at: cardAt(pX(PROFILE_U[0]), pTop), align: "start", dy: -9, along: CARD_X });
      if (resting()) {
        const [lo, hi] = d.profile.deeper_db;
        list.push({ text: `decoded valleys\n${lo.toFixed(1)} to ${hi.toFixed(1)} dB deeper`,
          at: cardAt(pX(7.45), pY(-14)), align: "end", along: CARD_X });
      }
    }
    labels.set(list);
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

  /** Top is the 2D layout; away from it, the box and the unfolded panel fit the frame. */
  const fit = () => {
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    const top = frontFrustum({ width: W, height: H }, state.plotRect(W, H),
      { min: [-EX / 2, -DEPTH / 2, 0], max: [EX / 2, DEPTH / 2, 0] });
    const w = looking();
    if (w === 1) {
      Object.assign(camera, top);
      return;
    }
    const right = new ctx.three.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new ctx.three.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    /** @param {number} x @param {number} y @param {number} z */
    const take = (x, y, z) => {
      const u = x * right.x + y * right.y + z * right.z;
      const v = x * up.x + y * up.y + z * up.z;
      [u0, u1, v0, v1] = [Math.min(u0, u), Math.max(u1, u), Math.min(v0, v), Math.max(v1, v)];
    };
    for (const x of [-EX / 2, EX / 2]) for (const y of [y0, y1]) for (const z of [-DEPTH / 2, DEPTH / 2]) take(x, y, z);
    const unfold = panelShow();
    if (unfold > 0) {
      for (const x of [pX(PROFILE_U[0]), pX(PROFILE_U[1])]) {
        take(...cardAt(x, pTop));
        take(...cardAt(x, pTop - PANEL.height * unfold));
      }
    }
    // A phone fits tighter: the labels at the right shrink to the names.
    const margin = phone()
      ? { left: 14, right: Math.max(64, W * 0.2), top: 22, bottom: 10 }
      : { left: Math.max(30, W * 0.05), right: Math.max(50, W * 0.1), top: 24, bottom: 22 };
    const aw = W - margin.left - margin.right;
    const ah = H - margin.top - margin.bottom;
    const s = Math.min(aw / (u1 - u0), ah / (v1 - v0));
    const left = u0 - (margin.left + (aw - (u1 - u0) * s) / 2) / s;
    const topV = v1 + (margin.top + (ah - (v1 - v0) * s) / 2) / s;
    const wide = { left, right: left + W / s, top: topV, bottom: topV - H / s };
    for (const side of /** @type {const} */ (["left", "right", "top", "bottom"])) {
      camera[side] = wide[side] + (top[side] - wide[side]) * w;
    }
  };

  let seen = { cut: cutaway(), later: laterInFront(), look: looking() };
  orbit = createOrbit(ctx, {
    target: [0, 0, 0], distance: DISTANCE, zoom: opts.look.zoom || 1, presets: PRESETS,
    start: state.preset in PRESETS ? state.preset : "corner", fit, onDrag: opts.onDrag,
    onChange: () => {
      labels?.update();
      chip?.update();
      beatChip?.update();
      const now = { cut: cutaway(), later: laterInFront(), look: looking() };
      if (now.cut !== seen.cut || now.later !== seen.later || Math.abs(now.look - seen.look) > 0.04 ||
          (now.look !== seen.look && (now.look === 0 || now.look === 1))) {
        seen = now;
        paint();
      } else {
        applyMotion();
      }
      if (sideOn() !== sideStyled) {
        sideStyled = !sideStyled;
        styleSide();
      }
      setLabels(false);
      probe.pose = orbit?.pose() ?? PRESETS.corner;
      probe.zoom = orbit?.zoom() ?? 1;
    },
  });
  probe.pose = orbit.pose();
  sideStyled = sideOn();
  styleSide();
  setLabels();
  applyMotion();

  /** The valleys beat: the panel's curve, in the highlight, moves from the
   *  original's profile to the decoded one, then the chip holds. */
  const playValleys = (/** @type {number} */ delay) => {
    if (!timeline || !panel || prefersReducedMotion()) return Promise.resolve();
    // The panel comes back for its beat (at once: a replay starts from a step).
    if (away > 0) {
      away = 0;
      orbit?.set(orbit.pose());
    }
    setValley(0);
    beatChip?.set({ text: valleyText(), at: deepest() });
    const morph = duration("3d-build");
    const total = morph * (1 + HOLD);
    const seq = ++beatSeq;
    return timeline.play("valleys", {
      ms: total, delay, ease: "linear", build: true,
      step: (t) => {
        const was = beat;
        // A delayed track is stepped at 0 while it waits.
        beat = t >= 1 || t <= 0 ? "" : t * total >= morph ? "chip" : "morph";
        setValley(smooth(Math.min(1, (t * total) / morph)));
        if (beat !== was) {
          applyMotion();
          setLabels(false);
          if (beat === "morph") void beatKit?.pulse();
        }
      },
    }).then(() => {
      if (seq !== beatSeq) return;
      beat = "";
      setValley(1);
      applyMotion();
      setLabels(false);
      if (highlight?.visible) void highlight.pulse();
      return foldAway(seq);
    });
  };

  /** The panel folds away and the sheets refit to the whole frame. */
  const foldAway = (/** @type {number} */ seq) => {
    if (!timeline) {
      away = 1;
      return Promise.resolve();
    }
    return timeline.play("fold", {
      ms: duration("3d-camera"), ease: "inout",
      step: (t) => {
        if (seq !== beatSeq) return;
        away = t;
        orbit?.set(orbit.pose());
        applyMotion();
        setLabels(false);
      },
    }).then(() => undefined);
  };

  /** The sheets rise in the middle strip, slide apart, the difference
   *  grows, then the valleys beat. */
  const play = (/** @type {boolean} */ withCamera) => {
    if (!timeline || !sheets.length || prefersReducedMotion()) return;
    rise = 0;
    slide = 0;
    grow = 0;
    setValley(0);
    applyMotion();
    const ms = duration("3d-build");
    if (withCamera && orbit) {
      const o = orbit;
      const end = PRESETS[state.preset] ?? PRESETS.corner;
      o.set(INTRO_POSE);
      void timeline.play("camera", {
        ms: duration("3d-camera"), ease: "inout", build: true,
        step: (t) => o.set({ yaw: INTRO_POSE.yaw + (end.yaw - INTRO_POSE.yaw) * t, pitch: INTRO_POSE.pitch + (end.pitch - INTRO_POSE.pitch) * t }),
      });
    }
    void timeline.play("rise", { ms: ms * 0.5, build: true, step: (t) => { rise = t; applyMotion(); } });
    void timeline.play("slide", { ms: ms * 0.5, delay: ms * 0.3, build: true, step: (t) => { slide = t; applyMotion(); } });
    void timeline.play("grow", { ms: ms * 0.5, delay: ms * 0.82, build: true, step: (t) => { grow = t; applyMotion(); } });
    void playValleys(ms * 1.4);
  };

  let described = 0;
  const label = () => {
    clearTimeout(described);
    described = window.setTimeout(() => ctx.renderer?.domElement?.setAttribute("aria-label", describe()), 250);
  };

  /** @param {unknown} next */
  const update = (next) => {
    state = /** @type {ListenState} */ (next);
    if (!state.data) return;
    const was = shown;
    shown = { frame: state.frame, show: state.show };
    if (state.data.clip !== shownClip) {
      // A new clip lands on the end state; only a step replays the beat.
      ctx.finish();
      makeSheets();
      placeHighlight();
      applyMotion();
      setLabels();
    } else if (state.frame !== was.frame || state.show !== was.show) {
      placeHighlight();
      paint();
      setLabels();
    }
    if (state.replays !== shownReplays) {
      shownReplays = state.replays;
      if (!prefersReducedMotion()) {
        probe.played += 1;
        void playValleys(0);
      }
    }
    if (state.pulses !== shownPulses) {
      shownPulses = state.pulses;
      if (highlight?.visible) void highlight.pulse();
    }
    label();
    ctx.requestRender();
  };

  if (opts.intro) {
    probe.played += 1;
    play(true);
  }

  probe.frontPoints = () => {
    const d = data();
    const v = new ctx.three.Vector3();
    /** @type {number[][]} */
    const out = [];
    for (const b of [0, 2]) {
      for (let k = 0; k < d.bins; k += 1) {
        v.set(xOf(state.frame), y0, zOf(b, k / (d.bins - 1))).project(ctx.camera);
        out.push([((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight]);
      }
    }
    return out;
  };
  probe.chip = () => chip?.node.textContent ?? "";
  probe.columns = () => columns.length;
  probe.drawnFrom = () => {
    const r = sheets[0]?.mesh.geometry.drawRange;
    return r ? [r.start, r.count] : [0, 0];
  };
  probe.grown = () => [rise, slide, grow, valley];
  probe.diffShown = () => Boolean(sheets[1]?.group.visible || sheets[1]?.flat.visible);
  probe.labels = () => [...frame.querySelectorAll(".anim-figure__label")].map((n) => n.textContent ?? "");
  probe.panel = () => (panel?.group.visible ? panel.group.scale.y : 0);
  probe.flat = () => Boolean(sheets[0]?.flat.visible);
  probe.beat = () => beat;
  probe.segments = () => {
    let count = 0;
    ctx.scene.traverse((node) => {
      const g = /** @type {{isLineSegmentsGeometry?: boolean, instanceCount?: number}} */ (/** @type {any} */ (node).geometry ?? {});
      if (g.isLineSegmentsGeometry) count += g.instanceCount ?? 0;
    });
    return count;
  };

  // The first frame waits on the slot; a reader who leaves 3D before it
  // comes gets the context back at once rather than a view nobody holds.
  const drawn = ctx.drawn().then(() => true);
  while (!(await Promise.race([drawn, new Promise((resolve) => setTimeout(() => resolve(false), 100))]))) {
    if (!opts.wanted() || opts.signal.aborted) {
      clearTimeout(described);
      delete frame.dataset.ltLabels;
      if (TEST_HOOK && TEST_HOOK.figures[KEY] === probe) delete TEST_HOOK.figures[KEY];
      ctx.dispose();
      return null;
    }
  }
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
      delete frame.dataset.ltLabels;
      if (TEST_HOOK && TEST_HOOK.figures[KEY] === probe) delete TEST_HOOK.figures[KEY];
      ctx.dispose();
    },
  };

  /** The 3D canvas's sentence. */
  function describe() {
    const d = state.data;
    if (!d) return "Terrain of a clip and its decoded audio, loading.";
    const [lo, hi] = d.profile.deeper_db;
    return `Terrain of “${d.text}”, ${d.voice} voice: time across, level up, and three strips in depth, ` +
      `each 0 to 4 kilohertz: the original at the back, ${state.show === "difference" ? "decoded minus original as a flat carpet of colour" : "an empty strip"} ` +
      `in the middle, the decoded audio at the front. The outlined slice is the frame at ${((state.frame + 0.5) * HOP_S).toFixed(2)} s. ` +
      `In front, the harmonics of ${d.profile.frames} pitched frames lined up: the decoded valleys are ${lo.toFixed(1)} to ${hi.toFixed(1)} dB deeper.`;
  }
}
