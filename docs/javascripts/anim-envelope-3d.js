// @ts-check
/* ===========================================================================
 * anim-envelope-3d.js: the envelope figure's 3D view (ch09; design §2.1,
 * §4.7; three-visual-language design §4, §6).
 * ---------------------------------------------------------------------------
 * A waterfall of one voiced stretch: x is frequency, y is level in dBFS,
 * depth is time, 20 ms per row, earlier frames at the back. Each row is a
 * frame's envelope with one dot per harmonic. The selected frame wears the
 * highlight kit (chip "frame 112: L = 28"); the other rows take the ramp
 * by time, thin, faded by their distance from it. Front shows the
 * selected row alone, fitted to the 2D plot (anim-envelope.js plotFor and
 * the frame's own y range), so a harmonic sits where the 2D view puts it;
 * Corner and Top fit the whole stretch.
 *
 * The explanatory animation (opening rule O1): "Over a voiced stretch, each
 * 20 ms frame gives a similar envelope with a different number of
 * harmonics under it." The view opens at Front on the selected row alone;
 * once half of it is visible the rows of the stretch move out of its plane
 * to their 20 ms slots, nearest first, each with its dots, while the camera
 * eases from Front to Corner. As each row lands its harmonic count shows at
 * its end for a moment and gives way to an end tick, so the stretch ends in
 * a ragged edge at the cutoff. The end state (Corner, every row, the end
 * ticks) carries the point.
 *
 * Front is the 2D plot: the other rows go, the scene is clipped to the
 * plot's rectangle and the plot's axes are drawn in its margins (HTML), the
 * rounding guides, the exact envelope (dashed) and the moved-by stems show
 * as in 2D. Top spreads frequency across the frame and adds the end ticks'
 * edge and a track joining harmonic 20 from row to row, whose slant is the
 * change in spacing.
 *
 * It takes the 2D module's arrays (EnvelopeState) and computes no model
 * data: no levels, no rounding, no curve.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { CUTOFF_HZ } from "./lib/cutoff.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { FRONT, TOP, createOrbit, frontFrustum } from "./lib/orbit.js";
import { axisFrame, toScene } from "./lib/scene.js";
import { contactShadow, darkGround, fatLines, floor, fog, mix, printing, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-envelope.js").EnvelopeState} EnvelopeState */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./lib/orbit.js").Pose} Pose */

const SLUG = "envelope-3d";
/** Scene size of the stretch: frequency, level, time. */
const EXTENT = { x: 2.4, y: 0.6, z: 2.4 };
const DISTANCE = 6;
/** @type {Record<string, Pose>} */
const PRESETS = { corner: { yaw: 30, pitch: 30 }, front: FRONT, top: TOP };
/** Within this many degrees of Front, the other rows fade out and the fit
 *  turns into the 2D plot's. */
const FRONT_BAND = 24;
/** Extra fade for rows in front of the highlight below 60 degrees of pitch
 *  (the cutaway rule). */
const CUTAWAY = 0.15;
/** Room around the stretch at Corner, CSS px: left, right, top, bottom (the
 *  top leaves the chip room above the back rows). */
const MARGIN = [46, 74, 48, 66];
/** At Top: the bottom keeps the frequency ticks clear of the labels' keep-
 *  clear strip (lib/labels.js, 56 px). */
const MARGIN_TOP = [28, 74, 34, 74];
const DESCRIBE_MS = 250;
/** The harmonic whose track joins the rows at Top. */
const TRACK_M = 20;
/** How long a row's count stays at its end once it lands, in reveal units
 *  (one unit is one row's move). */
const COUNT_HOLD = 2.5;

/**
 * Three keeps a fat line's segment count from its first draw
 * (InstancedBufferGeometry._maxInstanceCount, cleared only on dispose), so
 * a line given more segments later draws only the old number. Clear it
 * after every setPositions; the next draw counts again.
 * @param {import("three").Object3D} object
 */
const regrow = (object) => object.traverse((o) => {
  const g = /** @type {{geometry?: {isInstancedBufferGeometry?: boolean, _maxInstanceCount?: number}}} */ (
    /** @type {unknown} */ (o)).geometry;
  if (g?.isInstancedBufferGeometry) delete g._maxInstanceCount;
});
/** @param {number} hex @returns {string} */
const cssHex = (hex) => `#${hex.toString(16).padStart(6, "0")}`;

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 1 at Front, 0 once the camera is FRONT_BAND degrees away from it.
 * @param {Pose} pose
 */
const frontness = (pose) => {
  const yaw = ((((pose.yaw % 360) + 540) % 360) - 180);
  return 1 - clamp(Math.max(Math.abs(yaw), Math.abs(pose.pitch)) / FRONT_BAND, 0, 1);
};
/** 1 at Top, 0 at 60 degrees of pitch and below. @param {Pose} pose */
const topness = (pose) => clamp((pose.pitch - 60) / 30, 0, 1);
/** The pose's mode, for what is drawn and labelled. @param {Pose} pose */
const modeOf = (pose) => (frontness(pose) > 0.6 ? "front" : topness(pose) > 0.5 ? "top" : "corner");

/** A round dot for PointsMaterial, drawn once. @type {HTMLCanvasElement | null} */
let dotImage = null;
const dotCanvas = () => {
  if (dotImage) return dotImage;
  dotImage = document.createElement("canvas");
  dotImage.width = dotImage.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (dotImage.getContext("2d"));
  g.fillStyle = "#ffffff"; // a mask: the material's colour or the vertex colour tints it
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  return dotImage;
};

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  /** @type {EnvelopeState} */
  let state = /** @type {EnvelopeState} */ (opts.state);
  const rows = state.rows;
  const last = rows.length - 1;
  const map = toScene({
    x: [0, 4000],
    y: state.runY,
    z: [rows[0].t, rows[last].t],
  }, EXTENT);
  const box = map.box;
  const floorY = box.min[1];
  /** Scene distance between two rows. */
  const gap = Math.abs(map.z(rows[1]?.t ?? rows[0].t + 0.02) - map.z(rows[0].t));
  /** How far the rows have moved out of the selected row's plane: a row
   *  |delta| frames away is out once reveal reaches |delta|. */
  let reveal = opts.intro ? 0 : last;
  /** The first-view animation is running (counts show as rows land). */
  let landing = false;
  let builds = 0;
  /** The mounted view, once mountThree returns. @type {ThreeContext | null} */
  let ctx3 = null;
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** The pose as last placed (orbit.pose() is not ready during the first fit). */
  /** @type {Pose} */
  let pose = { ...(opts.intro ? FRONT : PRESETS[state.preset ?? "corner"] ?? PRESETS.corner) };

  /** @param {number} r */
  const rowZ = (r) => map.z(rows[r].t);
  /** How far out row r is, 0 to 1. @param {number} r */
  const progress = (r) => clamp(reveal - Math.abs(r - state.selected) + 1, 0, 1);
  /** Row r's z as drawn now. @param {number} r */
  const drawnZ = (r) => {
    const z0 = rowZ(state.selected);
    return z0 + (rowZ(r) - z0) * progress(r);
  };
  /** @param {number} db */
  const sy = (db) => map.y(Math.max(db, state.runY[0]));

  /* -- the parts of the scene, made by build() --------------------------- */

  /**
   * @typedef {import("three/addons/lines/LineSegments2.js").LineSegments2} Fat
   * @typedef {Object} Parts
   * @property {Fat} context
   * @property {import("three").Mesh} curtains
   * @property {import("three").Points} dots
   * @property {import("three").Points} chosen
   * @property {import("three").LineSegments} stems
   * @property {Fat} ghost  the selected frame's exact envelope, dashed
   * @property {Fat} moved  how far each rounded level moved
   * @property {Fat} guides  the rounding grid, at Front
   * @property {Fat} trace
   * @property {Fat} ends  a tick at each row's last harmonic
   * @property {Fat} track  harmonic TRACK_M from row to row, at Top
   * @property {ReturnType<typeof addHighlight>} highlight
   * @property {ReturnType<typeof createLabels>} labels
   * @property {import("three").PointsMaterial} dotMaterial
   * @property {import("three").PointsMaterial} chosenMaterial
   * @property {import("three").Plane} clip  the 2D plot's floor, at Front
   * @property {typeof import("three")} three
   */
  /** @type {Parts | null} */
  let parts = null;

  /** Row r sits between the camera and the highlight. @param {number} r */
  const inFront = (r) => (rowZ(r) - rowZ(state.selected)) * Math.cos((pose.yaw * Math.PI) / 180) > 0;
  /** The cutaway rule is on: below 60 degrees of pitch. */
  const cutaway = () => pose.pitch < 60;
  /**
   * The theme's colours, read once per theme (reading a token asks the
   * page for its style, too slow to do per row and per frame).
   * @type {{bg: number, ink: number, muted: number, ramp: number[], cap: number, print: boolean} | null}
   */
  let palette = null;
  const colours = () => (palette ??= {
    bg: tokenHex("--ambe-plot-bg"),
    ink: tokenHex("--ambe-plot-ink"),
    muted: tokenHex("--ambe-plot-muted"),
    ramp: rows.map((_, r) => rampColor(r / last)),
    cap: darkGround() ? 0.6 : 0.45,
    print: printing(),
  });
  /** lib/style.js fadeAmount, on the cached palette. @param {number} delta */
  const fadeBy = (delta) => {
    const d = Math.abs(delta);
    const p = colours();
    return d <= 1 || p.print ? 0 : Math.min(p.cap, 0.12 + 0.06 * (d - 1));
  };
  /**
   * The other rows' colour: the ramp by time, faded by their distance from
   * the highlight (and the cutaway), never by the fog, which would take
   * every row to one colour at Front. They are gone at Front.
   * @param {number} r
   */
  const rowFade = (r) => {
    const delta = r - state.selected;
    const cut = cutaway() && inFront(r) ? CUTAWAY : 0;
    const amount = Math.max(Math.min(1, fadeBy(delta) + cut), 1 - progress(r));
    return mix(colours().ramp[r], colours().bg, amount);
  };
  /** The other rows are drawn: away from Front. */
  const contextShown = () => frontness(pose) < 0.85;
  /**
   * A context row's line: straight between its dots. The smooth curve is
   * kept for the highlight; thin lines at 30 rows do not need it, and six
   * times fewer segments keep a frame cheap to draw.
   * @param {number} r
   */
  const polyline = (r) => rows[r].harmonics.map((h, k) => ({ x: h.hz, y: rows[r].shown[k] }));
  /** The rows drawn as context: every row out of the selected one's plane. */
  const contextRows = () => rows.map((_, r) => r).filter((r) => r !== state.selected && progress(r) > 0);
  /** The rows that have landed in their slots, the selected one included. */
  const landedRows = () => rows.map((_, r) => r).filter((r) => progress(r) >= 1);

  /** Context curve segments, and one colour per vertex. */
  const contextSegments = () => {
    /** @type {number[]} */
    const out = [];
    for (const r of contextRows()) {
      const z = drawnZ(r);
      const curve = polyline(r);
      for (let k = 0; k + 1 < curve.length; k += 1) {
        out.push(map.x(curve[k].x), sy(curve[k].y), z, map.x(curve[k + 1].x), sy(curve[k + 1].y), z);
      }
    }
    return out;
  };
  const contextColours = () => {
    /** @type {number[]} */
    const out = [];
    for (const r of contextRows()) {
      const colour = rowFade(r);
      for (let k = 0; k + 1 < rows[r].harmonics.length; k += 1) out.push(colour, colour);
    }
    return out;
  };

  /**
   * The end ticks: a short bar just past each landed row's last harmonic,
   * upright at Corner and across the row at Top, in the row's ramp colour.
   * Together they draw the stretch's ragged edge against the cutoff.
   */
  const endSegments = () => {
    const across = topness(pose) > 0.5;
    /** @type {number[]} */
    const out = [];
    for (const r of landedRows()) {
      const row = rows[r];
      const k = row.harmonics.length - 1;
      if (k < 0) continue;
      const x = map.x(row.harmonics[k].hz + 0.3 * row.f0);
      const y = sy(row.shown[k]);
      const z = drawnZ(r);
      if (across) out.push(x, y, z - 0.42 * gap, x, y, z + 0.42 * gap);
      else out.push(x, y - 0.035, z, x, y + 0.035, z);
    }
    return out;
  };
  const endColours = () => landedRows().flatMap((r) => {
    const c = mix(colours().ramp[r], colours().bg, fadeBy(r - state.selected) * 0.5);
    return [c, c];
  });
  /** Harmonic TRACK_M of every landed row, joined. */
  const trackSegments = () => {
    /** @type {number[]} */
    const out = [];
    const list = landedRows().filter((r) => rows[r].harmonics.length >= TRACK_M);
    for (let i = 0; i + 1 < list.length; i += 1) {
      const [a, b] = [list[i], list[i + 1]];
      const k = TRACK_M - 1;
      out.push(map.x(rows[a].harmonics[k].hz), sy(rows[a].shown[k]), drawnZ(a),
        map.x(rows[b].harmonics[k].hz), sy(rows[b].shown[k]), drawnZ(b));
    }
    return out;
  };

  /** Selected row: scene points of its curve, flat. */
  const selectedCurve = () => {
    const row = rows[state.selected];
    const z = rowZ(state.selected);
    return row.curve.flatMap((p) => [map.x(p.x), sy(p.y), z]);
  };
  /** @param {{x: number, y: number}[]} curve @param {number} z */
  const segmentsOf = (curve, z) => {
    /** @type {number[]} */
    const out = [];
    for (let k = 0; k + 1 < curve.length; k += 1) {
      out.push(map.x(curve[k].x), sy(curve[k].y), z, map.x(curve[k + 1].x), sy(curve[k + 1].y), z);
    }
    return out;
  };
  /** Selected row's dots, scene units. */
  const chosenPoints = () => {
    const row = rows[state.selected];
    const z = rowZ(state.selected);
    return row.harmonics.flatMap((h, k) => [map.x(h.hz), sy(row.shown[k]), z]);
  };
  const chipText = () => `frame ${rows[state.selected].i}: L = ${rows[state.selected].harmonics.length}`;

  /** Vertex counts of the one-colour lines whose colour is not a token, kept by lay(). */
  /** @type {Record<string, number>} */
  const solidN = {};
  /** A colours function for fatLines: one colour for every vertex. @param {string} key @param {() => number} hex */
  const solid = (key, hex) => () => new Array(solidN[key] ?? 2).fill(hex());

  /**
   * Write a fat line's segments, or hide it when there are none.
   * @param {Fat} line @param {number[]} segments @param {boolean} [shown=true]
   */
  const lay = (line, segments, shown = true) => {
    line.visible = shown && segments.length > 0;
    if (!segments.length) return;
    if (line.userData.key) solidN[line.userData.key] = segments.length / 3;
    setSegments(line, segments);
    line.userData.recolour?.();
    regrow(line);
  };

  /** Write the context rows, their dots, curtains and end marks, as they stand now. */
  const layContext = () => {
    if (!parts) return;
    lay(parts.context, contextSegments(), contextShown());
    lay(parts.ends, endSegments(), contextShown());
    lay(parts.track, trackSegments(), topness(pose) > 0.5);
    layDots();
    layCurtains();
    placeCounts();
  };
  /** Frosted curtains under the rows behind the highlight (all of them at
   *  Top); the cutaway rule draws the rows in front as lines only. */
  const layCurtains = () => {
    if (!parts) return;
    const T = parts.three;
    // The curtains rise from the floor as the camera leaves Front.
    const rise = 1 - frontness(pose);
    const list = rise > 0.001 ? contextRows().filter((r) => !(cutaway() && inFront(r))) : [];
    parts.curtains.visible = list.length > 0;
    if (!list.length) return;
    const bg = colours().bg;
    const c = new T.Color();
    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const tints = [];
    /** @type {number[]} */
    const index = [];
    for (const r of list) {
      const z = drawnZ(r);
      const top = c.setHex(mix(rowFade(r), bg, 0.8)).toArray();
      const foot = c.setHex(bg).toArray();
      const curve = polyline(r);
      const base = positions.length / 3;
      curve.forEach((p, k) => {
        positions.push(map.x(p.x), floorY + (sy(p.y) - floorY) * rise, z, map.x(p.x), floorY, z);
        tints.push(...top, ...foot);
        if (k + 1 < curve.length) {
          const a = base + 2 * k;
          index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
      });
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(tints), 3));
    geometry.setIndex(index);
    parts.curtains.geometry.dispose();
    parts.curtains.geometry = geometry;
  };
  const layDots = () => {
    if (!parts) return;
    const T = parts.three;
    const position = /** @type {import("three").BufferAttribute} */ (parts.dots.geometry.getAttribute("position"));
    const colour = /** @type {import("three").BufferAttribute} */ (parts.dots.geometry.getAttribute("color"));
    const c = new T.Color();
    let n = 0;
    for (const r of contextRows()) {
      const z = drawnZ(r);
      c.setHex(rowFade(r));
      rows[r].harmonics.forEach((h, k) => {
        position.setXYZ(n, map.x(h.hz), sy(rows[r].shown[k]), z);
        colour.setXYZ(n, c.r, c.g, c.b);
        n += 1;
      });
    }
    position.needsUpdate = true;
    colour.needsUpdate = true;
    parts.dots.geometry.setDrawRange(0, contextShown() ? n : 0);
    parts.dots.geometry.computeBoundingSphere();
  };
  /** The selected frame's input spectrum: in its plane at Front, as in 2D;
   *  elsewhere just behind it, so the opaque fill hides what lies under the
   *  envelope, and only up to the cutoff. */
  const layTrace = () => {
    if (!parts) return;
    const front = modeOf(pose) === "front";
    const z = rowZ(state.selected) - (front ? 0 : 0.006);
    const curve = front ? state.trace : state.trace.filter((p) => p.x <= CUTOFF_HZ);
    lay(parts.trace, segmentsOf(curve, z), state.spectrum);
  };
  /** The selected row: highlight, dots, stems, the exact curve, the moves, the grid, the spectrum. */
  const laySelected = () => {
    if (!parts) return;
    const T = parts.three;
    const row = rows[state.selected];
    const z = rowZ(state.selected);
    parts.highlight.set(selectedCurve());
    regrow(parts.highlight);
    parts.highlight.chip?.set({ text: chipText() });
    const points = chosenPoints();
    parts.chosen.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(points), 3));
    parts.chosen.geometry.computeBoundingSphere();
    /** @type {number[]} */
    const stems = [];
    for (let k = 0; k < points.length; k += 3) stems.push(points[k], floorY, z, points[k], points[k + 1], z);
    parts.stems.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(stems), 3));
    parts.stems.geometry.computeBoundingSphere();
    const rounded = state.step > 0;
    lay(parts.ghost, segmentsOf(row.exact, z), rounded);
    /** @type {number[]} */
    const moved = [];
    row.harmonics.forEach((h, k) => {
      if (Math.abs(row.shown[k] - h.db) > 0.05) moved.push(map.x(h.hz), sy(h.db), z, map.x(h.hz), sy(row.shown[k]), z);
    });
    lay(parts.moved, moved, rounded);
    layGuides();
    layTrace();
  };
  /** The rounding grid on the selected frame's plane, at Front. */
  const layGuides = () => {
    if (!parts) return;
    const z = rowZ(state.selected);
    /** @type {number[]} */
    const lines = [];
    const [lo, hi] = rows[state.selected].y;
    if (state.step > 0) {
      for (let v = Math.ceil(lo / state.step) * state.step; v <= hi; v += state.step) {
        lines.push(map.x(0), map.y(v), z, map.x(4000), map.y(v), z);
      }
    }
    lay(parts.guides, lines, modeOf(pose) === "front");
  };

  /* -- labels -------------------------------------------------------------- */

  /** Labels for the pose's mode: the axes, the cutoff, both ends of the
   *  stretch, harmonic 20's track. Front has none: its axes are the 2D
   *  plot's, drawn in the margins by layAxes. */
  const labelList = () => {
    const mode = modeOf(pose);
    if (mode === "front") return [];
    const [lo, hi] = state.runY;
    /** @type {number[]} */
    const times = [];
    for (let t = Math.ceil(rows[0].t * 5 + 0.25) / 5; t < rows[last].t - 0.05; t += 0.2) times.push(Math.round(t * 10) / 10);
    const list = axisLabels(box, map, [
      { axis: "x", name: "frequency (kHz)", ticks: [0, 1000, 2000, 3000], format: (v) => String(v / 1000) },
      { axis: "z", name: "time (s)", ticks: times, format: (v) => v.toFixed(1) },
    ]);
    // The time axis's name sits a fifth of the way from the back, clear of
    // the end label at the front.
    const narrow = frame.clientWidth < 520;
    const timeName = list.find((l) => l.text === "time (s)");
    // On a phone the end labels' "s" names the axis; its name would collide.
    if (timeName && narrow && mode === "corner") list.splice(list.indexOf(timeName), 1);
    else if (timeName) timeName.at = [timeName.at[0], timeName.at[1], box.min[2] + (box.max[2] - box.min[2]) * 0.2];
    if (mode === "corner") {
      /** @type {number[]} */
      const levels = [];
      const every = frame.clientWidth < 520 ? 80 : 40;
      for (let v = Math.floor(hi / 20) * 20; v >= lo; v -= every) levels.push(v);
      const [x0, z1] = [box.min[0], box.max[2]];
      for (const value of levels) list.push({ text: String(value), at: [x0, map.y(value), z1], align: "end", along: [0, 1, 0], tick: true });
      list.push({ text: "level (dBFS)", at: [x0, box.max[1], z1], align: "end", along: [0, 1, 0], dy: -16 });
    } else {
      const k = TRACK_M - 1;
      const r = rows.findIndex((row) => row.harmonics.length > k);
      if (r >= 0) list.push({ text: `harmonic ${TRACK_M}`, at: [map.x(rows[r].harmonics[k].hz), floorY, rowZ(r)], align: "middle", dy: -12 });
    }
    for (const r of [0, last]) {
      const row = rows[r];
      list.push({
        text: `${row.t.toFixed(2)} s:${narrow ? "\n" : " "}L = ${row.harmonics.length}`,
        at: [box.max[0] + 0.1, sy(row.shown[row.shown.length - 1] ?? state.runY[0]), rowZ(r)],
        align: "start",
        dy: mode === "top" ? 0 : -4,
      });
    }
    list.push({ text: "cutoff", at: [map.x(CUTOFF_HZ), floorY, mode === "top" ? box.min[2] : box.max[2]], align: "middle", dy: mode === "top" ? -10 : 14 });
    return list;
  };

  /** The counts shown as rows land (the first-view animation only). */
  const counts = document.createElement("div");
  counts.className = "anim-figure__overlay anim-env__counts";
  counts.setAttribute("aria-hidden", "true");
  /** @type {HTMLSpanElement[]} */
  const countNodes = rows.map((row) => {
    const node = document.createElement("span");
    node.className = "anim-figure__label anim-env__count";
    node.textContent = String(row.harmonics.length);
    node.hidden = true;
    counts.append(node);
    return node;
  });
  function placeCounts() {
    if (!ctx3 || !parts) return;
    const camera = ctx3.camera;
    camera.updateMatrixWorld();
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    rows.forEach((row, r) => {
      const node = countNodes[r];
      const age = reveal - Math.abs(r - state.selected) + 1;
      const k = row.harmonics.length - 1;
      if (!landing || frontness(pose) > 0.5 || r === state.selected || age < 0.6 || age > COUNT_HOLD + 1 || k < 0) {
        node.hidden = true;
        return;
      }
      v.set(map.x(row.harmonics[k].hz + 0.3 * row.f0), sy(row.shown[k]), drawnZ(r)).project(camera);
      node.hidden = false;
      node.style.color = cssHex(colours().ramp[r]);
      node.style.opacity = String(age < 1 ? (age - 0.6) / 0.4 : clamp((COUNT_HOLD + 1 - age) / 0.6, 0, 1));
      node.style.transform = `translate(${(((v.x + 1) / 2) * w + 5).toFixed(1)}px, ${(((1 - v.y) / 2) * h - 16).toFixed(1)}px)`;
    });
  }

  /** The 2D plot's axes, drawn in its margins at Front (HTML, like 2D's text). */
  const axes = document.createElement("div");
  axes.className = "anim-figure__overlay anim-env__axes";
  axes.setAttribute("aria-hidden", "true");
  let axesKey = "";
  const layAxes = () => {
    const k = frontness(pose);
    const shown = k > 0.6;
    axes.hidden = !shown;
    if (!shown) return;
    axes.style.opacity = String(clamp((k - 0.6) / 0.3, 0, 1));
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const [lo, hi] = rows[state.selected].y;
    const key = `${w}x${h}:${lo}:${hi}`;
    if (key === axesKey) return;
    axesKey = key;
    const rect = state.plotRect(w, h);
    const compact = w < 520;
    /** @param {string} text @param {number} x @param {number} y @param {string} cls */
    const put = (text, x, y, cls) => {
      const node = document.createElement("span");
      node.className = `anim-figure__label anim-env__axis ${cls}`;
      node.textContent = text;
      node.style.left = `${x.toFixed(1)}px`;
      node.style.top = `${y.toFixed(1)}px`;
      return node;
    };
    /** @type {HTMLElement[]} */
    const out = [];
    for (let hz = 0; hz <= 4000; hz += 500) {
      out.push(put(hz === 0 ? "0" : `${(hz / 1000).toFixed(1)}k`, rect.x + (hz / 4000) * rect.width, rect.y + rect.height + 7, "anim-env__axis--x"));
    }
    for (let db = lo; db <= hi; db += 10) {
      out.push(put(String(db), rect.x - 7, rect.y + rect.height - ((db - lo) / (hi - lo)) * rect.height, "anim-env__axis--y"));
    }
    if (!compact) {
      out.push(put("frequency (Hz)", rect.x + rect.width / 2, rect.y + rect.height + 25, "anim-env__axis--x"));
      out.push(put("level (dBFS)", 11, rect.y + rect.height / 2, "anim-env__axis--name"));
    }
    axes.replaceChildren(...out);
  };

  /** @param {ThreeContext} c */
  const build = (c) => {
    const T = c.three;
    builds += 1;
    // First in the scene, so a theme change or print reads the palette
    // again before the parts below recolour from it.
    const reset = new T.Object3D();
    reset.userData.recolour = () => {
      palette = null;
    };
    c.scene.add(reset);
    c.scene.add(floor(c, { extent: box, step: [map.x(1000) - map.x(0), Math.abs(map.z(rows[0].t + 0.1) - map.z(rows[0].t))] }));
    c.scene.add(contactShadow(c, { x: [box.min[0], box.max[0]], z: [box.min[2], box.max[2]], y: floorY }));
    /** @type {number[]} */
    const ys = [];
    for (let v = Math.ceil(state.runY[0] / 10) * 10; v <= state.runY[1]; v += 10) ys.push(map.y(v));
    c.scene.add(axisFrame(c, box, { xs: [1000, 2000, 3000].map(map.x), ys, floor: false, back: true }));
    const cutX = map.x(CUTOFF_HZ);
    c.scene.add(fatLines(c, [cutX, floorY, box.min[2], cutX, floorY, box.max[2]], "--ambe-plot-axis", 1.25, { dashed: true }));

    palette = null;
    const blank = [0, 0, 0, 0, 0, 0];
    /** @param {() => number[]} list */
    const orBlank = (list) => () => {
      const out = list();
      return out.length ? out : [0, 0];
    };
    const context = fatLines(c, blank, orBlank(contextColours), 1.25);
    const ends = fatLines(c, blank, orBlank(endColours), 1.75);
    const track = fatLines(c, blank, "--ambe-plot-ink", 1.25, { dashed: true, dash: 0.025, gap: 0.02 });

    const map64 = new T.CanvasTexture(dotCanvas());
    c.track(map64);
    const dotMaterial = new T.PointsMaterial({ size: 3.5, sizeAttenuation: false, map: map64, alphaTest: 0.5, vertexColors: true });
    let capacity = 0;
    for (const row of rows) capacity += row.harmonics.length;
    const dotGeometry = new T.BufferGeometry();
    dotGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array(capacity * 3), 3));
    dotGeometry.setAttribute("color", new T.BufferAttribute(new Float32Array(capacity * 3), 3));
    const curtains = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    curtains.userData.recolour = () => layCurtains();
    curtains.frustumCulled = false;
    const dots = new T.Points(dotGeometry, dotMaterial);
    dots.frustumCulled = false;
    dots.userData.recolour = () => layDots();

    const highlight = addHighlight(c, selectedCurve(), { baseline: floorY, chip: chipText() });
    // The exact envelope, dashed, over the fill and under the highlight's line.
    const ghost = fatLines(c, blank, solid("ghost", () => mix(colours().ink, colours().bg, 0.4)), 1.75,
      { dashed: true, depthTest: false, dash: 0.03, gap: 0.022 });
    ghost.userData.key = "ghost";
    ghost.renderOrder = 9;
    ghost.material.transparent = true;
    const moved = fatLines(c, blank, "--ambe-data-3", 1.75, { depthTest: false });
    moved.renderOrder = 13;
    moved.material.transparent = true;
    const guides = fatLines(c, blank, solid("guides", () => mix(colours().ink, colours().bg, 0.8)), 1, {});
    guides.userData.key = "guides";
    const trace = fatLines(c, blank, solid("trace", () => mix(colours().muted, colours().bg, 0.35)), 1, {});
    trace.userData.key = "trace";
    const stemsObject = new T.LineSegments(new T.BufferGeometry(), c.paint(new T.LineBasicMaterial(), "--ambe-plot-axis"));
    const chosenMaterial = c.paint(new T.PointsMaterial({ size: 7, sizeAttenuation: false, map: map64, alphaTest: 0.5, depthTest: false }), "--ambe-plot-ink");
    const chosen = new T.Points(new T.BufferGeometry(), chosenMaterial);
    chosen.renderOrder = 20;
    chosen.frustumCulled = false;

    c.scene.add(curtains, context, ends, track, dots, guides, trace, stemsObject, highlight, ghost, moved, chosen);
    // Front is the 2D plot, clipped to its rectangle: nothing below the
    // frame's own floor. The plane moves out of the way elsewhere (fit).
    const clip = new T.Plane(new T.Vector3(0, 1, 0), 1e6);
    c.renderer.localClippingEnabled = true;
    c.scene.traverse((o) => {
      const m = /** @type {{material?: import("three").Material | import("three").Material[]}} */ (/** @type {unknown} */ (o)).material;
      for (const material of Array.isArray(m) ? m : m ? [m] : []) material.clippingPlanes = [clip];
    });
    const labels = createLabels(c.frame, c);
    c.track({ dispose: labels.dispose });
    parts = {
      context, curtains, dots, chosen, stems: stemsObject, ghost, moved, guides, trace, ends, track,
      highlight, labels, dotMaterial, chosenMaterial, clip, three: T,
    };
    fog(c, DISTANCE + 1, 3);
    layContext();
    laySelected();
    labels.set(labelList());
    pointSizes();
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: "Harmonic levels over one voiced stretch, frame by frame",
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) return null;
  // The reader may have left 3D while the view started: give it back now.
  if (!opts.wanted()) {
    ctx.dispose();
    return null;
  }
  ctx3 = ctx;
  frame.append(counts, axes);
  ctx.viewSignal.addEventListener("abort", () => {
    counts.remove();
    axes.remove();
    ctx3 = null;
  }, { once: true });

  /* -- camera: Front fits the 2D plot, the others fit the stretch -------- */

  const v = new ctx.three.Vector3();
  const fit = () => {
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (!w || !h) return;
    const d = camera.position.clone().sub(v.set(0, 0, 0));
    pose = {
      yaw: (Math.atan2(d.x, d.z) * 180) / Math.PI,
      pitch: (Math.asin(clamp(d.y / (d.length() || 1), -1, 1)) * 180) / Math.PI,
    };
    // Front: the selected frame's own y range on the 2D plot's rectangle.
    const row = rows[state.selected];
    /** @type {import("./lib/orbit.js").SceneBox} */
    const frameBox = { min: [box.min[0], map.y(row.y[0]), box.min[2]], max: [box.max[0], map.y(row.y[1]), box.max[2]] };
    const front = frontFrustum({ width: w, height: h }, state.plotRect(w, h), frameBox);
    const cy = (frameBox.min[1] + frameBox.max[1]) / 2;
    // Corner and Top: the whole stretch. Corner keeps one scale both ways;
    // Top spreads frequency across the frame's width.
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
    const up = topness(pose);
    const corner = w < 520 ? [30, 44, 30, 68] : MARGIN;
    const top = w < 520 ? [20, 66, 30, 72] : MARGIN_TOP;
    const [ml, mr, mt, mb] = corner.map((m, i) => m + (top[i] - m) * up);
    const sx0 = (w - ml - mr) / (x1 - x0);
    const sy0 = (h - mt - mb) / (y1 - y0);
    const s = Math.min(sx0, sy0);
    const sx = s + (sx0 - s) * up;
    const sy1 = s + (sy0 - s) * up;
    const px = ml + (w - ml - mr) / 2;
    const py = mt + (h - mt - mb) / 2;
    const left = (x0 + x1) / 2 - px / sx;
    const topY = (y0 + y1) / 2 + py / sy1;
    const whole = { left, right: left + w / sx, top: topY, bottom: topY - h / sy1 };
    const k = frontness(pose);
    camera.left = whole.left + (front.left - whole.left) * k;
    camera.right = whole.right + (front.right - whole.right) * k;
    camera.top = whole.top + (front.top + cy - whole.top) * k;
    camera.bottom = whole.bottom + (front.bottom + cy - whole.bottom) * k;
    if (parts) parts.clip.constant = k > 0.6 ? -frameBox.min[1] + 1e-4 : 1e6;
  };

  let describeTimer = 0;
  function describeSoon() {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      ctx?.renderer?.domElement.setAttribute("aria-label", describe());
    }, DESCRIBE_MS);
  }
  /** Point sizes follow the reader's zoom by its square root, and shrink on
   *  a narrow frame so the rows stay apart. */
  function pointSizes() {
    if (!parts) return;
    const z = Math.sqrt(orbit?.zoom() ?? 1) * clamp(frame.clientWidth / 600, 0.6, 1);
    parts.dotMaterial.size = 3.5 * z;
    parts.chosenMaterial.size = 7 * z;
  }

  let lastFront = -1;
  let lastMode = "";
  orbit = createOrbit(ctx, {
    target: [0, 0, 0],
    distance: DISTANCE,
    zoom: opts.look.zoom || 1,
    presets: PRESETS,
    start: state.preset && PRESETS[state.preset] ? state.preset : "corner",
    fit,
    onDrag: opts.onDrag,
    onChange: () => {
      if (!parts) return;
      // The fade by pose (Front, the cutaway) changes with the camera.
      const f = Math.round(frontness(pose) * 50) / 50 + (cutaway() ? 0 : 2) + (Math.cos((pose.yaw * Math.PI) / 180) > 0 ? 0 : 4) +
        (topness(pose) > 0.5 ? 8 : 0);
      if (f !== lastFront) {
        lastFront = f;
        layContext();
        layGuides();
      }
      const mode = modeOf(pose);
      if (mode !== lastMode) {
        lastMode = mode;
        layTrace();
        parts.labels.set(labelList());
      }
      parts.labels.update();
      placeCounts();
      layAxes();
      pointSizes();
      describeSoon();
    },
  });
  const resized = new ResizeObserver(() => {
    layAxes();
    placeCounts();
    pointSizes();
  });
  resized.observe(frame);
  ctx.viewSignal.addEventListener("abort", () => resized.disconnect(), { once: true });
  if (opts.intro) orbit.set(FRONT);
  layContext();
  layAxes();

  /* -- the explanatory animation ------------------------------------------ */

  const timeline = ctx.timeline();
  let played = false;
  if (opts.intro) {
    played = true;
    landing = true;
    const from = { ...FRONT };
    const to = PRESETS.corner;
    const turn = duration("3d-camera") + 500;
    // Slow enough that each row's count can be read as it lands.
    const rowsMs = Math.max(turn, duration("3d-build")) * 1.5;
    // The camera's ease ends a little after the last row lands, so the
    // ragged edge holds still for a moment before the motion stops.
    void timeline.play("camera", {
      ms: Math.max(turn, turn * 0.3 + rowsMs) + 300,
      ease: "inout",
      build: true,
      step: (t) => {
        orbit?.set({ yaw: from.yaw + (to.yaw - from.yaw) * t, pitch: from.pitch + (to.pitch - from.pitch) * t });
      },
    });
    // Rows land from 0 to `reach`; the extra COUNT_HOLD lets the last
    // counts fade into their end ticks.
    const reach = Math.max(state.selected, last - state.selected);
    void timeline.play("rows", {
      ms: rowsMs,
      delay: turn * 0.3,
      ease: "ease",
      build: true,
      step: (t) => {
        reveal = t >= 1 ? last : t * (reach + COUNT_HOLD);
        if (t >= 1) landing = false;
        layContext();
        ctx.requestRender();
      },
    });
  }

  /* -- the view's sentence, and the test hook ------------------------------ */

  const describe = () => {
    const row = rows[state.selected];
    const name = Object.keys(PRESETS).find((p) => {
      const q = PRESETS[p];
      return Math.abs(q.pitch - pose.pitch) < 1 && Math.abs(((((q.yaw - pose.yaw) % 360) + 540) % 360) - 180) < 1;
    });
    const L = rows.map((r) => r.harmonics.length);
    const rounding = state.step > 0 ? ` Levels rounded to ${state.step} dB steps.` : "";
    return `Harmonic levels of frames ${rows[0].i} to ${rows[last].i} (${rows[0].t.toFixed(2)} s to ` +
      `${rows[last].t.toFixed(2)} s), one row per 20 ms frame, earlier frames at the back. ` +
      `Frame ${row.i}, outlined, has ${row.harmonics.length} harmonics under the cutoff; across the stretch ` +
      `the count ranges from ${Math.min(...L)} to ${Math.max(...L)}, with ${L[0]} in the first frame and ${L[last]} in the last.` +
      `${rounding} Camera: ${name ?? "turned"}.`;
  };
  ctx.viewSignal.addEventListener("abort", () => clearTimeout(describeTimer), { once: true });
  ctx.renderer?.domElement.setAttribute("aria-label", describe());

  /** @param {number} x @param {number} y @param {number} z @returns {[number, number]} */
  const onScreen = (x, y, z) => {
    v.set(x, y, z).project(ctx.camera);
    return [((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight];
  };
  const hook = {
    get builds() { return builds; },
    get pose() { return orbit?.pose() ?? null; },
    get zoom() { return orbit?.zoom() ?? 1; },
    get played() { return played; },
    get reveal() { return reveal; },
    /** The selected frame's dots on screen, CSS px in the frame. */
    frontPoints: () => {
      ctx.camera.updateMatrixWorld();
      const pts = chosenPoints();
      /** @type {[number, number][]} */
      const out = [];
      for (let k = 0; k < pts.length; k += 3) out.push(onScreen(pts[k], pts[k + 1], pts[k + 2]));
      return out;
    },
    /**
     * Each highlight line as drawn: its segments, the count three last drew
     * (undefined before a draw that counted again), and its last segment's
     * end on screen.
     */
    highlightLines: () => {
      ctx.camera.updateMatrixWorld();
      /** @type {{segments: number, drawn: number | undefined, end: [number, number]}[]} */
      const out = [];
      parts?.highlight.traverse((o) => {
        const g = /** @type {{geometry?: import("three").InstancedBufferGeometry & {_maxInstanceCount?: number}}} */ (
          /** @type {unknown} */ (o)).geometry;
        if (!g?.isInstancedBufferGeometry || !o.visible) return;
        const end = /** @type {import("three").InterleavedBufferAttribute} */ (g.getAttribute("instanceEnd"));
        const n = end.count;
        out.push({ segments: n, drawn: g._maxInstanceCount, end: onScreen(end.getX(n - 1), end.getY(n - 1), end.getZ(n - 1)) });
      });
      return out;
    },
    /** The highlight's on-screen colour pulse, for tests. */
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
  if (left) {
    if (TEST_HOOK && TEST_HOOK.figures[SLUG] === hook) delete TEST_HOOK.figures[SLUG];
    clearTimeout(describeTimer);
    ctx.dispose();
    return null;
  }

  return {
    update: (next) => {
      ctx.finish();
      const before = state.selected;
      state = /** @type {EnvelopeState} */ (next);
      layContext();
      laySelected();
      parts?.labels.set(labelList());
      axesKey = "";
      orbit?.set(orbit.pose());
      if (before !== state.selected) void parts?.highlight.pulse();
      describeSoon();
      ctx.requestRender();
    },
    preset: (name) => {
      if (PRESETS[name]) void orbit?.go(name);
    },
    describe,
    close: () => {
      if (TEST_HOOK && TEST_HOOK.figures[SLUG] === hook) delete TEST_HOOK.figures[SLUG];
      clearTimeout(describeTimer);
      ctx.dispose();
    },
  };
}
