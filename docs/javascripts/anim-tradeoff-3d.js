// @ts-check
/* ===========================================================================
 * anim-tradeoff-3d.js: the tradeoff figure's 3D view (ch03; design §5.3;
 * three-visual-language design §3, §4, §6).
 * ---------------------------------------------------------------------------
 * A waterfall of the made-up sound's blocks: x frequency (0 to 2 kHz), y
 * level (dB, floor -60), depth time, earliest at the back. Each block is
 * a strip, its cells coloured by level as the 2D spectrogram's, with a
 * frosted face to the floor. The outlined block's spectrum wears the
 * highlight kit, with the harmonics of f0 as ticks and the 4/T main lobe
 * as a bar. Below 60 degrees of pitch the strips in front of it are thin
 * lines (the cutaway rule). Top and Front each match a 2D plot to the
 * pixel and draw the other plot flat beside it, as the 2D view does.
 *
 * The animation: "A short block sharpens time and blurs frequency; a long
 * block does the opposite." The first view starts at Top on 5 ms blocks,
 * lengthens them to 20 ms, then turns to the corner; each release of
 * Block or Pitch morphs the old picture into the new. The end state
 * carries the point under reduced motion and in print.
 *
 * Steps 1 and 6 fly to Corner, 2 to 5 to "high" (STEP_POSES), where every
 * strip is surface. A bracket by the time axis spans the strips holding
 * the click when that is 40 ms or more and not the whole sound. The chip
 * hangs from the curve's highest point on screen, never over the curve.
 *
 * It takes the 2D module's arrays (TradeoffState) and computes no model
 * data: no transform, no levels, no valleys.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK, tokenColor } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { BIN_HZ, CLICK_MS, COLUMNS, FINE, FLOOR_DB, MAX_HZ, SOUND_MS, STEP_POSES } from "./anim-tradeoff.js";
import { OUTLINE_MIX, addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { FRONT, TOP, createOrbit, frontFrustum } from "./lib/orbit.js";
import { axisFrame, toScene } from "./lib/scene.js";
import { contactShadow, darkGround, fatLines, floor, fog, mix, printing, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-tradeoff.js").TradeoffState} TradeoffState */
/** @typedef {import("./anim-tradeoff.js").Picture} Picture */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {[number, number, number]} Vec */

const SLUG = "tradeoff-3d";
/** Scene size: frequency, level, time. */
const EXTENT = { x: 2.4, y: 0.8, z: 2.4 };
const DISTANCE = 6;
/** @type {Record<string, Pose>} */
const PRESETS = {
  corner: { yaw: 30, pitch: 32 },
  front: FRONT,
  top: TOP,
};
/** What the view's sentence calls each pose. */
const POSE_NAMES = { corner: "corner", front: "front", top: "top", high: "high over the front" };
/** A phone's frame is taller than it is wide: Corner looks down more, so the waterfall fills it. */
const PHONE_CORNER = { yaw: 12, pitch: 46 };
const PHONE = 520;
/** Within this many degrees of Front or Top the fit turns into that 2D plot's. */
const BAND = 24;
/** From here on (1 is the pose itself) Top and Front show their flat companion plot and 2D labels. */
const FLAT = 0.97;
/** Most strips the waterfall ever shows (5 ms blocks); every grid divides it. */
const MAX_ROWS = 160;
/** Room around the waterfall at Corner, CSS px: left, right, top, bottom. */
const MARGIN = [52, 64, 14, 62];
const PHONE_MARGIN = [30, 30, 8, 40];
const DESCRIBE_MS = 250;
/** The Zoom group's step (lib/orbit.js ZOOM_STEP). */
const ZOOM_STEP = 1.25;
/** CSS px, as the 2D plot draws them: the harmonic ticks, the 4/T bar above its peak and its caps. */
const TICK_PX = 12;
const BAR_ABOVE_PX = 10;
const BAR_CAP_PX = 4;

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Yaw folded into -180 to 180. @param {number} yaw */
const fold = (yaw) => ((((yaw % 360) + 540) % 360) - 180);
/** 1 at Front, 0 once BAND degrees away. @param {Pose} p */
const frontness = (p) => 1 - clamp(Math.max(Math.abs(fold(p.yaw)), Math.abs(p.pitch)) / BAND, 0, 1);
/** 1 at Top, 0 once BAND degrees below it. @param {Pose} p */
const topness = (p) => 1 - clamp((90 - p.pitch) / BAND, 0, 1);
/** Cubic in and out. @param {number} t */
const smooth = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Frequency tick text, as the 2D axis has it: 0, 0.5k, 1k. @param {number} v */
const khz = (v) => (v === 0 ? "0" : `${v / 1000}k`);

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  /** @type {TradeoffState} */
  let state = /** @type {TradeoffState} */ (opts.state);
  // The labels and the chip stay hidden until the 3D view has drawn and
  // the 2D canvas is gone (anim.css), so the two never overprint.
  frame.classList.add("anim-tradeoff__frame--opening");
  const opened = () => frame.classList.remove("anim-tradeoff__frame--opening");
  const map = toScene({ x: [0, MAX_HZ], y: [FLOOR_DB, 0], z: [0, SOUND_MS] }, EXTENT);
  const box = map.box;
  const floorY = box.min[1];
  const phone = frame.clientWidth && frame.clientWidth < PHONE ? 1 : 0;
  /** @type {Record<string, Pose>} */
  const presets = { ...PRESETS, corner: phone ? PHONE_CORNER : PRESETS.corner };
  for (const [k, p] of Object.entries(STEP_POSES)) presets[k] = p[phone];
  const home = state.preset && presets[state.preset] ? state.preset : "corner";
  let builds = 0;
  let morphs = 0;
  let played = false;
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  // The first view starts at Top, the pose that is the 2D spectrogram.
  const intro = Boolean(opts.intro && state.intro);
  /** @type {Pose} */
  let pose = { ...(intro ? TOP : presets[home]) };

  /* -- what is shown: two pictures and how far between them -------------- */

  /** The morph runs from `from` to `state.picture`; at t = 1 only the latter shows. */
  /** @type {{from: Picture, fromRow: number, fromChip: string, t: number}} */
  let shown = { from: state.picture, fromRow: state.selected, fromChip: state.chip, t: 1 };
  if (intro && state.intro) {
    shown = { from: state.intro, fromRow: rowOf(state.intro, state.selected, state.picture), fromChip: state.introChip, t: 0 };
  }

  /**
   * The row of `p` that holds the middle of row r of `q`.
   * @param {Picture} p @param {number} r @param {Picture} q
   */
  function rowOf(p, r, q) {
    return clamp(Math.floor(((r + 0.5) * q.hop) / p.hop), 0, p.rows - 1);
  }
  /** Strips on the common grid now. */
  const gridRows = () => Math.max(shown.from.rows, state.picture.rows);
  /** Level of cell (d, c) on a grid of D strips, between the two pictures. */
  const level = (/** @type {number} */ d, /** @type {number} */ c, /** @type {number} */ D) => {
    const b = state.picture;
    const vb = b.cells[Math.floor((d * b.rows) / D) * COLUMNS + c];
    if (shown.t >= 1) return vb;
    const a = shown.from;
    const va = a.cells[Math.floor((d * a.rows) / D) * COLUMNS + c];
    return va + (vb - va) * shown.t;
  };
  /** The outlined block's strip, ms, between the two pictures. */
  const strip = () => {
    const b = state.picture;
    const lerp = (/** @type {number} */ u, /** @type {number} */ v) => u + (v - u) * Math.min(1, shown.t);
    const a = shown.from;
    return {
      start: lerp(shown.fromRow * a.hop, state.selected * b.hop),
      end: lerp((shown.fromRow + 1) * a.hop, (state.selected + 1) * b.hop),
    };
  };
  /** The outlined strip's front edge, where its frosted face stands: the spectrum is its top. */
  const stripZ = () => map.z(strip().end);
  /** The outlined block's spectrum now, FINE levels in dB. */
  const spectrum = () => {
    const fb = state.picture.fine[state.selected];
    if (shown.t >= 1) return fb;
    const fa = shown.from.fine[shown.fromRow];
    return Float32Array.from(fb, (v, k) => fa[k] + (v - fa[k]) * shown.t);
  };
  /** The outlined block's spectrum as scene points, flat. */
  const curve = () => {
    const s = spectrum();
    const z = stripZ();
    const out = new Float32Array(FINE * 3);
    for (let k = 0; k < FINE; k += 1) out.set([map.x(k * BIN_HZ), map.y(s[k]), z], k * 3);
    return out;
  };

  /** The camera, once build() has run. @type {import("three").Camera | null} */
  let cam = null;
  /** @type {import("three").Vector3 | null} */
  let pv = null;
  /**
   * The chip's anchor and the Zoom's target: at Top and Front the peak, as
   * the 2D plot has it; else the curve's highest point on screen.
   * @returns {Vec}
   */
  const anchor = () => {
    const pts = curve();
    const flat = mode() !== "corner" || !cam || !pv;
    cam?.updateMatrixWorld();
    let [best, at] = [-Infinity, 0];
    for (let k = 0; k < pts.length; k += 3) {
      const y = flat ? pts[k + 1] : /** @type {any} */ (pv).set(pts[k], pts[k + 1], pts[k + 2]).project(cam).y;
      if (y > best) [best, at] = [y, k];
    }
    return [pts[at], pts[at + 1], pts[at + 2]];
  };
  /** The click bracket shows when it spans 40 ms or more but not the whole sound. */
  const bracket = () => mode() === "corner" && state.click.end - state.click.start >= 40 && state.click.end - state.click.start < SOUND_MS;

  /* -- colours, read once per theme --------------------------------------- */

  /**
   * Linear RGB per quarter dB: the cell colour, its face's top and foot.
   * @type {{tints: number[], cell: Float32Array, face: Float32Array, foot: Float32Array, bg: number, cap: number, print: boolean} | null}
   */
  let palette = null;
  /** @param {typeof import("three")} T */
  const colours = (T) => {
    if (palette) return palette;
    const steps = -FLOOR_DB * 4 + 1;
    const bg = tokenHex("--ambe-plot-bg");
    const cell = new Float32Array(steps * 3);
    const face = new Float32Array(steps * 3);
    const foot = new Float32Array(steps * 3);
    const c = new T.Color();
    /** @type {number[]} */
    const hexes = [];
    for (let i = 0; i < steps; i += 1) {
      const hex = state.colour(FLOOR_DB + i / 4);
      hexes.push(hex);
      cell.set(c.setHex(hex).toArray(), i * 3);
      face.set(c.setHex(mix(hex, bg, 0.3)).toArray(), i * 3);
      foot.set(c.setHex(mix(hex, bg, 0.85)).toArray(), i * 3);
    }
    palette = { tints: hexes, cell, face, foot, bg, cap: darkGround() ? 0.6 : 0.45, print: printing() };
    return palette;
  };
  /** @param {number} db */
  const slot = (db) => Math.round((clamp(db, FLOOR_DB, 0) - FLOOR_DB) * 4) * 3;

  /* -- the 2D layout, and the flat plane each flat pose draws it on ------- */

  /** The 2D plots' areas in this frame, CSS px (set by fit()). */
  /** @type {{gram: import("./lib/orbit.js").PlotRect, spec: import("./lib/orbit.js").PlotRect} | null} */
  let plots = null;
  /** @returns {"top" | "front" | "corner"} */
  const mode = () => (topness(pose) >= FLAT ? "top" : frontness(pose) >= FLAT ? "front" : "corner");
  const compact = () => frame.clientWidth < PHONE;
  /** px across for a frequency. @param {number} hz */
  const pxX = (hz) => (plots ? plots.spec.x + (hz / MAX_HZ) * plots.spec.width : 0);
  /** px down for a time in the spectrogram. @param {number} ms */
  const gramY = (ms) => (plots ? plots.gram.y + (ms / SOUND_MS) * plots.gram.height : 0);
  /** px down for a level in the spectrum. @param {number} db */
  const specY = (db) => (plots ? plots.spec.y + (db / FLOOR_DB) * plots.spec.height : 0);
  /**
   * The scene point a flat pose puts at 2D px (hz across, py down): at Top
   * on the floor, at Front on the back plane, at the 2D plot's scale.
   * @param {"top" | "front"} m @param {number} hz @param {number} py
   * @returns {Vec}
   */
  const flatAt = (m, hz, py) => {
    if (!plots) return [0, 0, 0];
    if (m === "top") return [map.x(hz), floorY, box.min[2] + ((py - plots.gram.y) * EXTENT.z) / plots.gram.height];
    return [map.x(hz), box.max[1] - ((py - plots.spec.y) * EXTENT.y) / plots.spec.height, box.min[2] - 0.002];
  };

  /* -- the parts of the scene, made by build() ----------------------------- */

  /**
   * @typedef {Object} Parts
   * @property {import("three").Mesh} mesh
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} lines
   * @property {ReturnType<typeof addHighlight>} highlight
   * @property {ReturnType<typeof createLabels>} labels
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} marks
   *           the harmonic ticks and the 4/T bar on the outlined strip
   * @property {import("three").Group} topInset  the spectrum on the floor, at Top
   * @property {ReturnType<typeof addHighlight>} topCurve
   * @property {import("three").Mesh} gramPlane  the spectrogram above, at Front
   * @property {import("three").DataTexture} gramTexture
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} flatLines
   *           axes, grid, ticks and outline of whichever flat plot shows
   * @property {{layer: HTMLElement, update: () => void, later: () => void}} flatLabels
   * @property {typeof import("three")} three
   * @property {import("./anim-three.js").LineKit} kit
   */
  /** @type {Parts | null} */
  let parts = null;
  /** The front lines' colours, one per vertex, as fatLines wants them. */
  /** @type {number[]} */
  let lineHexes = [0, 0];
  let lineCount = 6;
  /** Token names, one per vertex, of the marks and the flat plot's lines. */
  /** @type {string[]} */
  let markTokens = ["--ambe-plot-ink", "--ambe-plot-ink"];
  /** @type {string[]} */
  let flatTokens = ["--ambe-plot-axis", "--ambe-plot-axis"];
  /**
   * One colour per vertex from token names, a translucent token laid over
   * the plot background as the 2D plot draws it; "outline" is the
   * highlight kit's outline colour.
   * @param {string[]} names
   */
  const hexesOf = (names) => {
    /** @type {Map<string, number>} */
    const seen = new Map();
    const bg = tokenHex("--ambe-plot-bg");
    const of = (/** @type {string} */ n) => {
      if (n === "outline") return mix(tokenHex("--ambe-highlight"), bg, OUTLINE_MIX);
      const { hex, opacity } = tokenColor(n);
      return mix(hex, bg, 1 - opacity);
    };
    return names.map((n) => {
      if (!seen.has(n)) seen.set(n, of(n));
      return /** @type {number} */ (seen.get(n));
    });
  };
  /**
   * Give a fat line new segments; three caches an instanced geometry's
   * count at its first draw, so a line whose count changes gets a new one.
   * @param {import("three/addons/lines/LineSegments2.js").LineSegments2} line
   * @param {number[]} segments
   */
  const relay = (line, segments) => {
    if (!parts) return;
    const count = line.userData.count ?? -1;
    if (segments.length !== count) {
      line.geometry.dispose();
      line.geometry = new parts.kit.LineSegmentsGeometry();
      line.userData.count = segments.length;
    }
    setSegments(line, segments.length ? segments : [0, 0, 0, 0, 0, 0]);
    line.userData.recolour?.();
  };

  /** Strips drawn as surface: all of them at Top, else up to the outlined one. */
  const cutaway = () => pose.pitch < 60;
  /** The last strip on the common grid drawn as surface. @param {number} D */
  const lastSurface = (D) => {
    if (!cutaway()) return D - 1;
    const { end } = strip();
    return clamp(Math.ceil((end * D) / SOUND_MS - 1e-6) - 1, 0, D - 1);
  };

  /** Write the surface: cell tops and their frosted faces, flat per cell. */
  const layMesh = () => {
    if (!parts) return;
    const T = parts.three;
    const p = colours(T);
    const D = gridRows();
    const squash = 1 - frontness(pose);
    const position = /** @type {import("three").BufferAttribute} */ (parts.mesh.geometry.getAttribute("position"));
    const colour = /** @type {import("three").BufferAttribute} */ (parts.mesh.geometry.getAttribute("color"));
    const pos = /** @type {Float32Array} */ (position.array);
    const col = /** @type {Float32Array} */ (colour.array);
    const last = lastSurface(D);
    const xs = Array.from({ length: COLUMNS + 1 }, (_, e) => map.x((e * MAX_HZ) / COLUMNS));
    /** Heights of one strip's cell edges, scene y. @param {number} d */
    const edgesOf = (d) => {
      const row = new Float32Array(COLUMNS);
      for (let c = 0; c < COLUMNS; c += 1) row[c] = level(d, c, D);
      const edges = new Float32Array(COLUMNS + 1);
      for (let e = 0; e <= COLUMNS; e += 1) {
        const a = row[Math.max(0, e - 1)];
        const b = row[Math.min(COLUMNS - 1, e)];
        edges[e] = floorY + (map.y((a + b) / 2) - floorY) * squash;
      }
      return { row, edges };
    };
    // From above 60 degrees faces are slivers: past 40 strips they go
    // (under the triangle cap at 5 ms, and no terraces at 10 ms).
    const faces = topness(pose) < 1 && (cutaway() || D <= 40);
    // Without faces strip tops meet halfway: one surface, not terraces.
    const joined = !faces;
    // Under the cutaway the strips behind fade with distance, as the lines in front do.
    const { start, end } = strip();
    const centre = ((start + end) / 2 / SOUND_MS) * D;
    const per = D / state.picture.rows;
    const bg = new parts.three.Color(p.bg).toArray();
    const fadeOf = (/** @type {number} */ d) => {
      if (!cutaway() || p.print) return 0;
      const away = Math.abs(d + 0.5 - centre) / per;
      return away <= 1 ? 0 : Math.min(0.5, 0.1 + 0.05 * (away - 1));
    };
    /** @param {Float32Array} from @param {number} s @param {number} f */
    const tint = (from, s, f) => (f ? [0, 1, 2].map((i) => from[s + i] + (bg[i] - from[s + i]) * f) : from.subarray(s, s + 3));
    let v = 0;
    let before = null;
    let now = edgesOf(0);
    for (let d = 0; d <= last; d += 1) {
      const z0 = map.z((d * SOUND_MS) / D);
      const z1 = map.z(((d + 1) * SOUND_MS) / D);
      const f = fadeOf(d);
      const after = joined && d + 1 <= last ? edgesOf(d + 1) : null;
      const { row, edges } = now;
      const back = joined && before ? before.edges : edges;
      const front = after ? after.edges : edges;
      for (let c = 0; c < COLUMNS; c += 1) {
        const s = slot(row[c]);
        const [xa, xb, ya, yb] = [xs[c], xs[c + 1], edges[c], edges[c + 1]];
        // The cell's top, then its face down to the floor at the strip's front.
        if (joined) {
          pos.set([
            xa, (ya + back[c]) / 2, z0, xb, (yb + back[c + 1]) / 2, z0,
            xa, (ya + front[c]) / 2, z1, xb, (yb + front[c + 1]) / 2, z1,
          ], v * 3);
        } else pos.set([xa, ya, z0, xb, yb, z0, xa, ya, z1, xb, yb, z1], v * 3);
        const top = tint(p.cell, s, f);
        for (let i = 0; i < 4; i += 1) col.set(top, (v + i) * 3);
        v += 4;
        if (!faces) continue;
        pos.set([xa, ya, z1, xb, yb, z1, xa, floorY, z1, xb, floorY, z1], v * 3);
        const face = tint(p.face, s, f);
        const foot = tint(p.foot, s, f);
        for (let i = 0; i < 2; i += 1) col.set(face, (v + i) * 3);
        for (let i = 2; i < 4; i += 1) col.set(foot, (v + i) * 3);
        v += 4;
      }
      before = now;
      now = after ?? (d + 1 <= last ? edgesOf(d + 1) : now);
    }
    position.needsUpdate = true;
    colour.needsUpdate = true;
    parts.mesh.geometry.setDrawRange(0, (v / 4) * 6);
    parts.mesh.visible = squash > 0.02 || topness(pose) > 0;
  };

  /** The strips in front of the outlined one, as thin lines (cutaway). */
  const layLines = () => {
    if (!parts) return;
    const p = colours(parts.three);
    const D = gridRows();
    const first = lastSurface(D) + 1;
    const squash = 1 - frontness(pose);
    /** @type {number[]} */
    const segments = [];
    /** @type {number[]} */
    const hexes = [];
    const { start, end } = strip();
    const centre = ((start + end) / 2 / SOUND_MS) * D;
    const per = D / state.picture.rows;
    for (let d = first; d < D; d += 1) {
      const z = map.z(((d + 0.5) * SOUND_MS) / D);
      const away = Math.abs(d + 0.5 - centre) / per;
      const amount = p.print || away <= 1 ? 0 : Math.min(p.cap, 0.12 + 0.06 * (away - 1)) + 0.15;
      // Every other column, every fourth past 40 strips (lobes 400 Hz or
      // wider): enough for context, and under the triangle cap.
      const n = D > 40 ? 4 : 2;
      for (let c = 0; c + n < COLUMNS; c += n) {
        let a = FLOOR_DB;
        let b = FLOOR_DB;
        for (let k = 0; k < n; k += 1) {
          a = Math.max(a, level(d, c + k, D));
          b = Math.max(b, level(d, Math.min(COLUMNS - 1, c + n + k), D));
        }
        segments.push(
          map.x(((c + n / 2) * MAX_HZ) / COLUMNS), floorY + (map.y(a) - floorY) * squash, z,
          map.x(((c + n * 1.5) * MAX_HZ) / COLUMNS), floorY + (map.y(b) - floorY) * squash, z
        );
        hexes.push(mix(p.tints[slot(a) / 3], p.bg, amount), mix(p.tints[slot(b) / 3], p.bg, amount));
      }
    }
    parts.lines.visible = segments.length > 0 && squash > 0.05;
    if (!segments.length) return;
    lineHexes = hexes;
    if (segments.length !== lineCount) {
      // three caches an instanced geometry's count at its first draw, so
      // a line that grows needs a geometry of its own.
      lineCount = segments.length;
      parts.lines.geometry.dispose();
      parts.lines.geometry = new parts.kit.LineSegmentsGeometry();
    }
    setSegments(parts.lines, segments);
    parts.lines.userData.recolour?.();
  };

  /** The chip states the picture shown: the old one's fact until the morph is half way; a phone breaks it at the colon (anim.css). */
  const chipText = () => (shown.t < 0.5 ? shown.fromChip : state.chip).replace(": ", ":\n");
  const layHighlight = () => {
    if (!parts) return;
    parts.highlight.set(curve());
    parts.highlight.chip?.set({ text: chipText(), at: anchor() });
  };

  /**
   * The harmonic ticks along the top of the plot and the 4/T bar above
   * the loudest peak, as the 2D plot draws them, through `at` (hz, px
   * down in the 2D spectrum) to the scene. The ticks only when the block
   * lies inside one vowel.
   * @param {(hz: number, py: number) => Vec} at
   * @param {number[]} segments  appended to
   * @param {string[]} tokens  appended to, one per vertex
   * @returns {{hz: number, py: number, right: boolean}} where "4/T" goes
   */
  const marks = (at, segments, tokens) => {
    if (!plots) return { hz: 0, py: 0, right: true };
    const s = spectrum();
    const push = (/** @type {Vec} */ a, /** @type {Vec} */ b, /** @type {string} */ token) => {
      segments.push(...a, ...b);
      tokens.push(token, token);
    };
    const top = plots.spec.y;
    const ink = "--ambe-plot-ink";
    if (state.inside) {
      for (let k = 1; k * state.f0 <= MAX_HZ; k += 1) {
        // Ink at the corner, where muted ticks are lost against the surface.
        push(at(k * state.f0, top), at(k * state.f0, top + TICK_PX), mode() === "corner" ? ink : "--ambe-plot-muted");
      }
    }
    let loud = 0;
    for (let k = 1; k < FINE; k += 1) if (s[k] > s[loud]) loud = k;
    const hz0 = loud * BIN_HZ - state.lobe / 2;
    const hz1 = loud * BIN_HZ + state.lobe / 2;
    const py = Math.max(top + 18, specY(s[loud]) - BAR_ABOVE_PX);
    const pxPerHz = plots.spec.width / MAX_HZ;
    push(at(hz0, py - BAR_CAP_PX), at(hz0, py + BAR_CAP_PX), ink);
    push(at(hz0, py), at(hz1, py), ink);
    push(at(hz1, py - BAR_CAP_PX), at(hz1, py + BAR_CAP_PX), ink);
    const right = pxX(hz1) + 40 <= plots.spec.x + plots.spec.width;
    return { hz: right ? hz1 + 4 / pxPerHz : hz0 - 4 / pxPerHz, py, right };
  };

  /** The pose's look depends on: Front squash, Top, the cutaway; the flat parts on the pose and the frame. */
  let lastLook = "";
  let lastFlat = "";
  /** Where "4/T" goes, on which side, and whether it stands on the bar (off the flat poses, clear of the peaks). */
  let lobeLabel = { at: /** @type {Vec} */ ([0, 0, 0]), right: true, up: false };

  /**
   * The marks on the outlined strip, and the flat companion plot of a flat
   * pose: the spectrum on the floor at Top, the spectrogram at Front.
   */
  const layFlat = () => {
    if (!parts || !plots) return;
    const m = mode();
    const z = stripZ();
    /** @type {number[]} */
    const segments = [];
    /** @type {string[]} */
    const tokens = [];
    // On the strip (Corner and Front); at Top the floor plot carries them.
    const onStrip = (/** @type {number} */ hz, /** @type {number} */ py) => {
      const [x, y] = flatAt("front", hz, py);
      return /** @type {Vec} */ ([x, y, z]);
    };
    const flat = m === "top" ? (/** @type {number} */ hz, /** @type {number} */ py) => flatAt("top", hz, py) : onStrip;
    const lobe = marks(flat, segments, tokens);
    lobeLabel = { at: flat(lobe.hz, lobe.py), right: lobe.right, up: m === "corner" };
    if (bracket()) {
      // The click's strips, beside the time axis.
      const x = box.max[0] + 0.05;
      const [z0, z1] = [map.z(state.click.start), map.z(state.click.end)];
      const ink = "--ambe-plot-ink";
      segments.push(x, floorY, z0, x, floorY, z1, x, floorY, z0, x - 0.05, floorY, z0, x, floorY, z1, x - 0.05, floorY, z1);
      tokens.push(ink, ink, ink, ink, ink, ink);
    }
    parts.marks.visible = m !== "top" && segments.length > 0;
    if (m !== "top") {
      markTokens = tokens;
      relay(parts.marks, segments);
    }

    parts.topInset.visible = m === "top";
    parts.gramPlane.visible = m === "front";
    parts.flatLines.visible = m !== "corner";
    if (m === "corner") return;
    const { gram, spec } = plots;
    /** @type {number[]} */
    const lines = m === "top" ? segments : [];
    /** @type {string[]} */
    const names = m === "top" ? tokens : [];
    const line = (/** @type {Vec} */ a, /** @type {Vec} */ b, /** @type {string} */ token) => {
      lines.push(...a, ...b);
      names.push(token, token);
    };
    if (m === "top") {
      // The spectrum below the spectrogram, as the 2D plot draws it.
      const at = (/** @type {number} */ hz, /** @type {number} */ py) => flatAt("top", hz, py);
      // The outlined strip, as the 2D spectrogram outlines it.
      const { start, end } = strip();
      const a = gramY(start);
      const b = Math.max(gramY(end), a + 2);
      const corners = [at(0, a), at(MAX_HZ, a), at(MAX_HZ, b), at(0, b)].map(([x, , cz]) => /** @type {Vec} */ ([x, map.y(0) + 0.01, cz]));
      for (let i = 0; i < 4; i += 1) line(corners[i], corners[(i + 1) % 4], "outline");
      // Local y runs up the frame from the -60 dB line, the kit's baseline.
      const foot = at(0, specY(FLOOR_DB))[2];
      parts.topInset.position.z = foot;
      const s = spectrum();
      const local = new Float32Array(FINE * 3);
      for (let k = 0; k < FINE; k += 1) {
        const [x, , wz] = at(k * BIN_HZ, specY(s[k]));
        local.set([x, foot - wz, 0], k * 3);
      }
      parts.topCurve.set(local);
      for (const hz of [500, 1000, 1500]) line(at(hz, spec.y), at(hz, spec.y + spec.height), "--ambe-plot-grid");
      for (const db of [-40, -20]) line(at(0, specY(db)), at(MAX_HZ, specY(db)), "--ambe-plot-grid");
      line(at(0, spec.y), at(0, spec.y + spec.height), "--ambe-plot-axis");
      line(at(0, spec.y + spec.height), at(MAX_HZ, spec.y + spec.height), "--ambe-plot-axis");
    } else {
      // The spectrogram above the spectrum, with the outlined strip.
      const at = (/** @type {number} */ hz, /** @type {number} */ py) => flatAt("front", hz, py);
      const [, yTop] = at(0, gram.y);
      const [, yBottom] = at(0, gram.y + gram.height);
      parts.gramPlane.scale.set(EXTENT.x, yTop - yBottom, 1);
      parts.gramPlane.position.set(0, (yTop + yBottom) / 2, box.min[2] - 0.004);
      fillGram();
      line(at(0, gram.y), at(0, gram.y + gram.height), "--ambe-plot-axis");
      const { start, end } = strip();
      const a = gramY(start);
      const b = Math.max(gramY(end), a + 2);
      const corners = [at(0, a), at(MAX_HZ, a), at(MAX_HZ, b), at(0, b)];
      for (let i = 0; i < 4; i += 1) line(corners[i], corners[(i + 1) % 4], "outline");
    }
    flatTokens = names;
    relay(parts.flatLines, lines);
  };

  /** The Front plane's spectrogram: one texel per cell, earliest strip at the top. */
  const fillGram = () => {
    if (!parts) return;
    const p = colours(parts.three);
    const D = gridRows();
    const data = /** @type {Uint8Array} */ (parts.gramTexture.image.data);
    for (let i = 0; i < MAX_ROWS; i += 1) {
      const d = Math.floor((i * D) / MAX_ROWS);
      const base = (MAX_ROWS - 1 - i) * COLUMNS * 4;
      for (let c = 0; c < COLUMNS; c += 1) {
        const hex = p.tints[slot(level(d, c, D)) / 3];
        data.set([hex >> 16, (hex >> 8) & 255, hex & 255, 255], base + c * 4);
      }
    }
    parts.gramTexture.needsUpdate = true;
  };

  const layAll = () => {
    layMesh();
    layLines();
    layHighlight();
    layFlat();
    parts?.flatLabels.update();
    ctx?.requestRender();
    parts?.flatLabels.later();
  };

  /** The axis labels of Corner (lib/labels.js); the flat poses have their own. */
  const labelList = () => {
    const list = axisLabels(box, map, [
      { axis: "x", name: "frequency (kHz)", ticks: [0, 500, 1000, 1500], format: (v) => String(v / 1000) },
      { axis: "z", name: "time (ms)", ticks: [0, 100, 200, 300, 400] },
    ]);
    // The time axis's name by its first 100 ms when the click bracket shows.
    if (bracket()) list[list.length - 1].at[2] = map.z(50);
    const [x0, , z1] = [box.min[0], 0, box.max[2]];
    for (const value of [-60, -40, -20, 0]) list.push({ text: String(value), at: [x0, map.y(value), z1], align: "end", along: [0, 1, 0], tick: true });
    // Seen from high up, left of its axis, clear of the surface behind it.
    list.push({ text: "level (dB)", at: [x0, box.max[1], z1], align: cutaway() ? "middle" : "end", along: [0, 1, 0], dy: -16 });
    list.push({ text: "click", at: [box.max[0] + 0.12, floorY, map.z(CLICK_MS)], align: "start", along: [0, 0, 1], dy: -12 });
    return list;
  };

  /**
   * @typedef {Object} FlatLabel
   * @property {string} text
   * @property {() => Vec | null} at  null: not shown in this pose
   * @property {number} ax  0 left, 0.5 centre, 1 right of the text on the point
   * @property {number} ay  0 top, 0.5 middle, 1 bottom
   * @property {number} [dx]  CSS px
   * @property {number} [dy]
   * @property {boolean} [tick]
   * @property {boolean} [turned]  reads bottom to top, as a 2D axis name
   * @property {string} [ref]  for the test hook
   */

  /**
   * The flat poses' labels, placed as the 2D figure places its own: time
   * down the left of the spectrogram, its parts to the right, level and
   * frequency on the spectrum, and "4/T" beside its bar in every pose.
   * @returns {FlatLabel[]}
   */
  const flatLabelList = () => {
    const m = () => mode();
    const flatOnly = (/** @type {(f: "top" | "front") => Vec} */ f) => () => {
      const now = m();
      return now === "corner" ? null : f(now);
    };
    const named = !compact();
    /** @type {FlatLabel[]} */
    const list = [];
    for (const t of [0, 100, 200, 300, 400]) {
      list.push({ text: String(t), at: flatOnly((f) => flatAt(f, 0, gramY(t))), ax: 1, ay: 0.5, dx: -6, tick: true, ref: `time-${t}` });
    }
    for (const [text, t] of /** @type {[string, number][]} */ ([["vowel", 100], ["click", CLICK_MS], ["vowel", 320]])) {
      list.push({ text, at: flatOnly((f) => flatAt(f, MAX_HZ, gramY(t))), ax: 0, ay: 0.5, dx: 6, ref: `part-${t}` });
    }
    for (const db of [-60, -40, -20, 0]) {
      list.push({ text: String(db), at: flatOnly((f) => flatAt(f, 0, specY(db))), ax: 1, ay: 0.5, dx: -6, tick: true });
    }
    for (const hz of [0, 500, 1000, 1500, 2000]) {
      list.push({ text: khz(hz), at: flatOnly((f) => flatAt(f, hz, specY(FLOOR_DB))), ax: 0.5, ay: 0, dy: 4, tick: true, ref: `hz-${hz}` });
    }
    if (named) {
      list.push({ text: "time (ms)", at: flatOnly((f) => flatAt(f, 0, gramY(SOUND_MS / 2))), ax: 0.5, ay: 0.5, dx: -44, turned: true });
      list.push({ text: "level (dB)", at: flatOnly((f) => flatAt(f, 0, specY(FLOOR_DB / 2))), ax: 0.5, ay: 0.5, dx: -44, turned: true });
      list.push({ text: "frequency (Hz)", at: flatOnly((f) => flatAt(f, MAX_HZ / 2, specY(FLOOR_DB))), ax: 0.5, ay: 0, dy: 18 });
    }
    list.push({ text: "4/T", at: () => lobeLabel.at, ax: 0, ay: 0.5, ref: "lobe" });
    return list;
  };

  /**
   * A layer of HTML labels for the flat poses, projected through the
   * camera so they follow the reader's zoom. aria-hidden, as every label:
   * the canvas label carries the same facts.
   * @param {ThreeContext} c
   */
  const createFlatLabels = (c) => {
    const layer = document.createElement("div");
    layer.className = "anim-figure__overlay";
    layer.setAttribute("aria-hidden", "true");
    frame.append(layer);
    const v = new c.three.Vector3();
    const items = flatLabelList().map((label) => {
      const node = document.createElement("span");
      node.className = label.tick ? "anim-figure__label anim-figure__label--tick" : "anim-figure__label";
      node.textContent = label.text;
      if (label.ref) node.dataset.ref = label.ref;
      layer.append(node);
      return { label, node, w: 0, h: 0 };
    });
    let pending = 0;
    const update = () => {
      cancelAnimationFrame(pending);
      const w = frame.clientWidth;
      const h = frame.clientHeight;
      c.camera.updateMatrixWorld();
      for (const item of items) {
        const { label, node } = item;
        const at = label.at();
        if (!at || (label.ref === "lobe" && !(parts?.marks.visible || mode() === "top"))) {
          node.hidden = true;
          continue;
        }
        v.set(...at).project(c.camera);
        const x = ((v.x + 1) / 2) * w + (label.dx ?? 0);
        const y = ((1 - v.y) / 2) * h + (label.dy ?? 0);
        node.hidden = false;
        // Measured once: the text never changes.
        if (!item.w) [item.w, item.h] = [node.offsetWidth, node.offsetHeight];
        const tw = item.w;
        const th = item.h;
        const lobe = label.ref === "lobe";
        const ax = lobe ? (lobeLabel.right ? 0 : 1) : label.ax;
        const left = x - ax * tw;
        const top = y - (lobe && lobeLabel.up ? th + 2 : label.ay * th);
        node.hidden = v.z < -1 || v.z > 1 || x < 0 || x > w || y < 0 || y > h || left < -tw / 2 || left + tw > w + tw / 2;
        node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)${label.turned ? " rotate(-90deg)" : ""}`;
      }
      // An end value under the chip yields to it, here and in lib/labels.js's layer.
      const chip = parts?.highlight.chip?.node.getBoundingClientRect() ?? new DOMRect();
      for (const n of chip.width ? frame.querySelectorAll(".anim-figure__label--tick") : []) {
        const r = n.getBoundingClientRect();
        if (r.left < chip.right && r.right > chip.left && r.top < chip.bottom + 2 && r.bottom > chip.top - 2) /** @type {HTMLElement} */ (n).hidden = true;
      }
    };
    c.track({ dispose: () => {
      cancelAnimationFrame(pending);
      layer.remove();
    } });
    /** Once the frame has drawn and the chip has moved with it. */
    const later = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(update);
    };
    return { layer, update, later };
  };

  /** @param {ThreeContext} c */
  const build = (c) => {
    const T = c.three;
    builds += 1;
    [cam, pv] = [c.camera, new T.Vector3()];
    // First in the scene, so a theme change or print reads the palette
    // again before the parts below recolour from it.
    const reset = new T.Object3D();
    reset.userData.recolour = () => {
      palette = null;
    };
    c.scene.add(reset);
    c.scene.add(floor(c, { extent: box, step: [map.x(500) - map.x(0), map.z(100) - map.z(0)] }));
    c.scene.add(contactShadow(c, { x: [box.min[0], box.max[0]], z: [box.min[2], box.max[2]], y: floorY }));
    c.scene.add(axisFrame(c, box, { xs: [500, 1000, 1500].map(map.x), ys: [-40, -20].map(map.y), floor: false, back: true }));

    palette = null;
    const quads = MAX_ROWS * COLUMNS * 2;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(quads * 12), 3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(quads * 12), 3).setUsage(T.DynamicDrawUsage));
    const index = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q += 1) index.set([4 * q, 4 * q + 2, 4 * q + 1, 4 * q + 1, 4 * q + 2, 4 * q + 3], q * 6);
    geometry.setIndex(new T.BufferAttribute(index, 1));
    geometry.boundingSphere = new T.Sphere(new T.Vector3(), 3);
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    mesh.frustumCulled = false;
    mesh.userData.recolour = () => { layMesh(); layLines(); };
    const lines = fatLines(c, [0, 0, 0, 0, 0, 0], () => lineHexes, 1.25, { fog: true });
    lines.frustumCulled = false;
    const highlight = addHighlight(c, curve(), { baseline: floorY, chip: chipText() });
    // Over the waterfall, as the highlight is: they belong to it.
    const marksLine = fatLines(c, [0, 0, 0, 0, 0, 0], () => hexesOf(markTokens), 1.5, { depthTest: false });
    marksLine.frustumCulled = false;
    marksLine.renderOrder = 14;

    // At Top: the spectrum on the floor below the spectrogram, in the
    // highlight kit, its plane turned flat (local y runs up the frame).
    const topInset = new T.Group();
    topInset.rotation.x = -Math.PI / 2;
    topInset.position.y = floorY + 0.002;
    const topCurve = addHighlight(c, curve(), { baseline: 0 });
    topInset.add(topCurve);
    topInset.visible = false;

    // At Front: the spectrogram on a plane above the spectrum.
    const gramTexture = new T.DataTexture(new Uint8Array(COLUMNS * MAX_ROWS * 4), COLUMNS, MAX_ROWS, T.RGBAFormat);
    gramTexture.colorSpace = T.SRGBColorSpace;
    gramTexture.magFilter = T.NearestFilter;
    gramTexture.minFilter = T.LinearFilter;
    const gramPlane = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: gramTexture, fog: false }));
    gramPlane.visible = false;
    gramPlane.userData.recolour = () => {
      if (gramPlane.visible) fillGram();
    };
    const flatLines = fatLines(c, [0, 0, 0, 0, 0, 0], () => hexesOf(flatTokens), 1.25);
    flatLines.frustumCulled = false;
    flatLines.visible = false;

    c.scene.add(mesh, lines, highlight, marksLine, topInset, gramPlane, flatLines);
    const labels = createLabels(c.frame, c);
    c.track({ dispose: labels.dispose });
    lineCount = 6;
    const flatLabels = createFlatLabels(c);
    parts = { mesh, lines, highlight, labels, marks: marksLine, topInset, topCurve, gramPlane, gramTexture, flatLines, flatLabels, three: T, kit: c.lines };
    fog(c, DISTANCE + 1.2, EXTENT.z * 1.6);
    lastLook = "";
    lastFlat = "";
    layMesh();
    layLines();
    layHighlight();
    layFlat();
    labels.set(mode() === "corner" ? labelList() : []);
    parts.flatLabels.update();
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: "Waterfall of the made-up sound's block spectra",
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) {
    opened();
    return null;
  }
  // The reader may have left 3D while the view started: give it back now.
  if (!opts.wanted()) {
    opened();
    ctx.dispose();
    return null;
  }

  /* -- camera: Front fits the block spectrum, Top the spectrogram -------- */

  const v = new ctx.three.Vector3();
  const fit = () => {
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (!w || !h) return;
    const d = camera.position.clone();
    pose = {
      yaw: (Math.atan2(d.x, d.z) * 180) / Math.PI,
      pitch: (Math.asin(clamp(d.y / (d.length() || 1), -1, 1)) * 180) / Math.PI,
    };
    const rects = state.rects(w, h);
    plots = rects;
    const size = { width: w, height: h };
    const front = frontFrustum(size, rects.spec, box);
    const top = frontFrustum(size, rects.gram, { min: [box.min[0], box.min[2], 0], max: [box.max[0], box.max[2], 0] });
    camera.updateMatrixWorld();
    const inverse = camera.matrixWorldInverse;
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const x of [box.min[0], box.max[0]]) {
      for (const y of [box.min[1], box.max[1]]) {
        for (const z of [box.min[2], box.max[2]]) {
          v.set(x, y, z).applyMatrix4(inverse);
          [x0, x1, y0, y1] = [Math.min(x0, v.x), Math.max(x1, v.x), Math.min(y0, v.y), Math.max(y1, v.y)];
        }
      }
    }
    let [ml, mr, mt, mb] = w < PHONE ? PHONE_MARGIN : MARGIN;
    // Room left of the level axis for its labels, on a phone looking down.
    if (w < PHONE) ml += 28 * clamp((pose.pitch - 50) / 10, 0, 1);
    const s = Math.min((w - ml - mr) / (x1 - x0), (h - mt - mb) / (y1 - y0));
    const left = (x0 + x1) / 2 - (ml + (w - ml - mr) / 2) / s;
    const upper = (y0 + y1) / 2 + (mt + (h - mt - mb) / 2) / s;
    const whole = { left, right: left + w / s, top: upper, bottom: upper - h / s };
    const f = frontness(pose);
    const t = topness(pose);
    for (const key of /** @type {const} */ (["left", "right", "top", "bottom"])) {
      camera[key] = whole[key] + (front[key] - whole[key]) * f + (top[key] - whole[key]) * t;
    }
  };

  let describeTimer = 0;
  function describeSoon() {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      ctx?.renderer?.domElement.setAttribute("aria-label", describe());
    }, DESCRIBE_MS);
  }

  orbit = createOrbit(ctx, {
    target: [0, 0, 0],
    distance: DISTANCE,
    zoom: opts.look.zoom || 1,
    presets,
    start: home,
    fit,
    onDrag: opts.onDrag,
    onChange: () => {
      if (!parts) return;
      const m = mode();
      const look = `${Math.round(frontness(pose) * 40)}:${topness(pose) > 0}:${topness(pose) >= 1}:${cutaway()}:${gridRows()}`;
      const flatLook = `${m}:${cutaway()}:${frame.clientWidth}x${frame.clientHeight}`;
      if (look !== lastLook) {
        lastLook = look;
        layMesh();
        layLines();
      }
      if (flatLook !== lastFlat) {
        const was = lastFlat.split(":")[0];
        lastFlat = flatLook;
        layFlat();
        if (was !== m || m === "corner") parts.labels.set(m === "corner" ? labelList() : []);
      }
      parts.highlight.chip?.set({ at: anchor() });
      parts.labels.update();
      parts.flatLabels.update();
      parts.flatLabels.later();
      describeSoon();
    },
  });
  if (intro) orbit.set(TOP);
  layAll();

  /* -- the explanatory animation: morph from one picture to another ------ */

  const timeline = ctx.timeline();
  /** The first view's: hold, lengthen the blocks at Top, then turn to the corner. */
  const opening = () => {
    morphs += 1;
    const to = presets[home];
    const from = { ...TOP };
    const turn = Math.abs(to.pitch - from.pitch) > 0.01 || Math.abs(fold(to.yaw - from.yaw)) > 0.01;
    const build = duration("3d-build");
    const camera = duration("3d-camera");
    // 300 ms on the 5 ms picture, the blocks lengthen, then the turn,
    // starting as the build ends (grammar: one motion runs into the next).
    const hold = 300;
    const ms = hold + build + camera + 200;
    const morphEnd = (hold + build) / ms;
    const turnStart = (hold + build - 150) / ms;
    return timeline.play("morph", {
      ms,
      ease: "linear",
      build: true,
      step: (t) => {
        if (t >= 1) {
          shown = { from: state.picture, fromRow: state.selected, fromChip: state.chip, t: 1 };
          if (turn) orbit?.set(to);
        } else {
          shown = { ...shown, t: smooth(clamp((t - hold / ms) / (morphEnd - hold / ms), 0, 1)) };
          if (turn) {
            const e = smooth(clamp((t - turnStart) / (1 - turnStart), 0, 1));
            orbit?.set({ yaw: from.yaw + fold(to.yaw - from.yaw) * e, pitch: from.pitch + (to.pitch - from.pitch) * e });
          }
        }
        layAll();
      },
    });
  };
  /** A release of Block or Pitch: the old picture morphs into the new. */
  const morph = () => {
    morphs += 1;
    return timeline.play("morph", {
      ms: duration("3d-build"),
      ease: "inout",
      step: (t) => {
        // At the end only the new picture is left, on its own grid.
        shown = t >= 1 ? { from: state.picture, fromRow: state.selected, fromChip: state.chip, t: 1 } : { ...shown, t };
        layAll();
      },
    });
  };
  if (shown.t < 1) {
    played = true;
    void opening();
  }

  /* -- zoom toward the subject ------------------------------------------- */

  /** The chip's anchor in NDC: the Zoom buttons and keys zoom toward it. */
  const focus = () => {
    v.set(...anchor()).project(ctx.camera);
    return [clamp(v.x, -1, 1), clamp(v.y, -1, 1)];
  };
  const figure = frame.closest(".anim-figure");
  /** @param {number} factor */
  const zoomToward = (factor) => {
    const [x, y] = focus();
    void orbit?.zoomBy(factor, x, y);
  };
  // Captured before lib/orbit.js's own listeners (which zoom toward the
  // frame's centre); wheel, pinch and double-click still zoom toward the
  // pointer.
  figure?.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.("[data-zoom]"));
    if (!button || button.dataset.zoom === "reset" || !figure.contains(button)) return;
    event.stopPropagation();
    zoomToward(button.dataset.zoom === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
  }, { capture: true, signal: ctx.viewSignal });
  frame.addEventListener("keydown", (event) => {
    if (event.target !== ctx.renderer?.domElement || event.ctrlKey || event.metaKey || event.altKey) return;
    const factor = { "+": ZOOM_STEP, "=": ZOOM_STEP, "-": 1 / ZOOM_STEP }[event.key];
    if (!factor) return;
    event.preventDefault();
    event.stopPropagation();
    zoomToward(factor);
  }, { capture: true, signal: ctx.viewSignal });

  /* -- the view's sentence, and the test hook ------------------------------ */

  const describe = () => {
    const p = state.picture;
    const name = Object.keys(presets).find((k) => {
      const q = presets[k];
      return Math.abs(q.pitch - pose.pitch) < 1 && Math.abs(fold(q.yaw - pose.yaw)) < 1;
    });
    const { start, end } = { start: state.selected * p.hop, end: (state.selected + 1) * p.hop };
    const blocks = p.rows === 1 ? "the whole sound as one block, one strip" : `${p.block} ms blocks, a strip every ${p.hop} ms, ${p.rows} strips`;
    const flat = name === "top" ? " Seen from above it is the spectrogram, time running down, with the spectrum of the outlined block below it."
      : name === "front" ? " Seen from the front it is the spectrum of the outlined block, with the spectrogram above it." : "";
    return `Waterfall of the made-up sound on a ${state.f0} Hz pitch, cut into ${blocks}: frequency 0 to 2 kHz across, ` +
      `level up, time from the back (0 ms) to the front (400 ms). The outlined strip, ${start} to ${end} ms, carries its ` +
      `block's spectrum (${state.chip}), with the harmonics of f0 as ticks and the 4/T main lobe as a bar` +
      `${bracket() ? `, and a bracket by the time axis spans the strips holding the click, ${state.click.start} to ${state.click.end} ms` : ""}.${flat} ` +
      `Camera: ${name ? POSE_NAMES[/** @type {keyof typeof POSE_NAMES} */ (name)] : "turned"}.`;
  };
  ctx.viewSignal.addEventListener("abort", () => clearTimeout(describeTimer), { once: true });
  ctx.renderer?.domElement.setAttribute("aria-label", describe());

  /** @param {ArrayLike<number>} pts flat x, y, z */
  const project = (pts) => {
    const camera = ctx.camera;
    camera.updateMatrixWorld();
    /** @type {[number, number][]} */
    const out = [];
    for (let k = 0; k < pts.length; k += 3) {
      v.set(pts[k], pts[k + 1], pts[k + 2]).project(camera);
      out.push([((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight]);
    }
    return out;
  };
  const hook = {
    get builds() { return builds; },
    get pose() { return orbit?.pose() ?? null; },
    get zoom() { return orbit?.zoom() ?? 1; },
    get played() { return played; },
    get morphs() { return morphs; },
    /** How far the morph has run (1 at rest), and the strips on its grid. */
    get t() { return shown.t; },
    get rows() { return gridRows(); },
    get mode() { return mode(); },
    /** Strips drawn as surface (the rest, in front of the outlined one, as lines). */
    get surfaceRows() { return lastSurface(gridRows()) + 1; },
    /** The click bracket's two ends beside the time axis, on screen; null when not drawn. */
    clickBracket: () => bracket() ? project([box.max[0] + 0.05, floorY, map.z(state.click.start), box.max[0] + 0.05, floorY, map.z(state.click.end)]) : null,
    /** The outlined block's spectrum at every 64th bin, on screen. */
    frontPoints: () => {
      const all = curve();
      /** @type {number[]} */
      const pts = [];
      for (let k = 0; k < FINE; k += 64) pts.push(all[k * 3], all[k * 3 + 1], all[k * 3 + 2]);
      return project(pts);
    },
    /** Cell corners (every 32nd column, every strip edge) on the floor, on screen. */
    topPoints: () => {
      const p = state.picture;
      /** @type {number[]} */
      const pts = [];
      for (let r = 0; r <= p.rows; r += Math.max(1, p.rows / 10)) {
        for (let c = 0; c <= COLUMNS; c += 32) pts.push(map.x((c * MAX_HZ) / COLUMNS), floorY, map.z(r * p.hop));
      }
      return project(pts);
    },
    /** The chip's anchor on screen. */
    focus: () => {
      const [x, y] = focus();
      return [((x + 1) / 2) * frame.clientWidth, ((1 - y) / 2) * frame.clientHeight];
    },
    pulse: () => parts?.highlight.pulse(),
  };
  if (TEST_HOOK) TEST_HOOK.figures[SLUG] = hook;

  // Wait for the first frame, unless the reader leaves 3D first (quick
  // toggles): then the view goes at once instead of after its first draw.
  const left = await new Promise((resolve) => {
    let polling = 0;
    const poll = () => {
      if (!opts.wanted() || opts.signal.aborted) return resolve(true);
      polling = requestAnimationFrame(poll);
    };
    ctx.drawn().then(() => {
      cancelAnimationFrame(polling);
      resolve(false);
    });
    poll();
  });
  // The view switch hides the 2D canvas in the same task, so the labels
  // show from the 3D view's first frame on.
  opened();
  if (left) {
    if (TEST_HOOK && TEST_HOOK.figures[SLUG] === hook) delete TEST_HOOK.figures[SLUG];
    clearTimeout(describeTimer);
    ctx.dispose();
    return null;
  }
  return {
    update: (next) => {
      ctx.finish();
      const before = state;
      state = /** @type {TradeoffState} */ (next);
      if (before.picture !== state.picture) {
        // Same structure, new values: the old picture morphs into the new.
        shown = { from: before.picture, fromRow: before.selected, fromChip: before.chip, t: 0 };
        void morph();
      } else {
        shown = { from: state.picture, fromRow: state.selected, fromChip: state.chip, t: 1 };
        if (before.selected !== state.selected) void parts?.highlight.pulse();
      }
      if (before.colour !== state.colour) palette = null;
      if (mode() === "corner") parts?.labels.set(labelList());
      layAll();
      describeSoon();
    },
    preset: (name) => {
      if (presets[name]) void orbit?.go(name);
    },
    describe,
    close: () => {
      if (TEST_HOOK && TEST_HOOK.figures[SLUG] === hook) delete TEST_HOOK.figures[SLUG];
      clearTimeout(describeTimer);
      opened();
      ctx.dispose();
    },
  };
}
