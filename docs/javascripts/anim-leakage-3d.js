// @ts-check
/* ===========================================================================
 * anim-leakage-3d.js: the leakage figure's 3D view (three-everywhere §5.2).
 * ---------------------------------------------------------------------------
 * One row of stems for every setting of the tone from 6.00 to 7.00 cycles
 * in the block, in steps of 0.05: bins run across (x), the level in dB
 * below each spectrum's own peak runs up (y), and the cycles run back to
 * front (z, 6.00 at the back). Each stem is coloured on the ramp by level,
 * so the field is dark where a spectrum is clean and bright where it has
 * leaked. The reader's setting is the highlight, with a chip that counts
 * its bins above -40 dB, where a faint sheet and a dashed line sit.
 *
 * Presets: Front puts the stems on the 2D plot's own rectangle, with the
 * field hidden, so it is the 2D picture; Corner shows the field.
 *
 * Its one animation (VL6): "Off a bin, one tone spreads into every bin; a
 * window trades that spread for a wider peak." Seen from the front, as the
 * 2D stems, the camera turns to the corner while the rows grow in by
 * depth from 6.00 to 7.00 cycles, so the spread opens and closes across
 * the field. Switching the window (or the weak tone) morphs every row from
 * its old levels to its new ones; a new setting moves the highlight and
 * pulses it.
 *
 * It computes no model data: every level comes from the 2D module's state
 * (state.rows, from lib/leakage.js), and only scene coordinates and colours
 * are worked out here.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { BIN_RANGE, DB_RANGE, countText, layout, level } from "./anim-leakage.js";
import { BINS, COUNT_DB, CYCLES_MAX, CYCLES_MIN, FLOOR_DB, ROWS, WEAK_BIN, rowCycles } from "./lib/leakage.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { createOrbit, frontFrustum } from "./lib/orbit.js";
import { axisFrame, toScene } from "./lib/scene.js";
import { contactShadow, fade, fatLines, floor, fog, mix, printing, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./anim-leakage.js").LeakageState} LeakageState */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {[number, number, number]} Vec */

const MAP = toScene({ x: BIN_RANGE, y: DB_RANGE, z: [CYCLES_MIN, CYCLES_MAX] }, { x: 6.2, y: 3.2, z: 3 });
const BOX = MAP.box;
const BASE = MAP.y(FLOOR_DB);
const DISTANCE = 14;
/** @type {Vec} */
const TARGET = [0, 0, 0];

/** @type {Record<string, Pose>} */
const PRESETS = {
  front: { yaw: 0, pitch: 0 },
  corner: { yaw: 26, pitch: 38 },
};

/** The last step's close-up: Front, zoomed this far on bins 0 to 16. */
const PEAK_ZOOM = 4.5;
/** The reader's row's stems away from Front: see-through, so the field behind them reads. */
const STEM_OPACITY = 0.3;
/** The first view's grow, ms: the rows rise front to back as the highlight sweeps through them. */
const GROW_MS = 2800;

/** Context stems in front of the highlight fade this much more below 60 degrees of pitch (the cutaway rule). */
const CUTAWAY = 0.15;

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
const lerp = (a, b, t) => a + (b - a) * t;

/** @param {number} t */
const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  const state = /** @type {LeakageState} */ (opts.state);
  /** The levels on show, row by row: they morph toward state.rows. */
  let shown = state.rows.map((row) => Float64Array.from(row));
  /** How far each row has grown from the floor (the first-view build). */
  const grow = new Float64Array(ROWS).fill(opts.intro ? 0 : 1);
  /** The field and window the levels on show belong to. */
  let source = state.rows;
  let selected = state.row;
  let builds = 0;
  let played = 0;
  /** @type {ReturnType<typeof parts> | null} */
  let scene = null;
  /** @type {ThreeContext | null} */
  let view = null;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  let labelled = "";
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** @type {{at: Vec, bin: number, db: number}[]} */
  let frontPoints = [];
  /** The scene has drawn once: labels may show. */
  let firstDrawn = false;

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: describe(),
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
    build: (c) => {
      builds += 1;
      view = c;
      scene = parts(c);
      labels = createLabels(c.frame, c);
      c.track(labels);
      labelled = "";
      fog(c, DISTANCE, BOX.max[2] - BOX.min[2]);
      draw();
      visibility();
      // The axis labels wait for the scene's first frame, so they never
      // stand alone on an empty stage.
      if (firstDrawn) relabelScene();
    },
  });
  if (!ctx) return null;

  /** The scene's parts, from tokens; draw() places the data. */
  function parts(/** @type {ThreeContext} */ c) {
    const T = c.three;
    const [x0, , z0] = BOX.min;
    const [x1, y1, z1] = BOX.max;
    const add = (/** @type {import("three").Object3D} */ o) => {
      c.scene.add(o);
      return o;
    };
    add(floor(c, {
      extent: { min: [MAP.x(0), BASE, z0], max: [MAP.x(80), y1, z1] },
      step: [MAP.x(10) - MAP.x(0), MAP.z(6.25) - MAP.z(6)],
    }));
    add(contactShadow(c, { x: [x0, x1], z: [z0, z1], y: BASE }));
    add(axisFrame(c, BOX, {
      xs: [0, 20, 40, 60, 80].map(MAP.x),
      ys: [-80, -60, -20, 0].map(MAP.y),
      floor: false,
    }));

    // -40 dB: a faint sheet over the field and its dashed edge.
    const yc = MAP.y(COUNT_DB);
    const sheet = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), c.paint(new T.MeshBasicMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide,
    }), "--ambe-accent-soft"));
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set((x0 + x1) / 2, yc, (z0 + z1) / 2);
    add(sheet);
    const edge = fatLines(c, [
      x0, yc, z0, x1, yc, z0, x1, yc, z0, x1, yc, z1, x1, yc, z1, x0, yc, z1, x0, yc, z1, x0, yc, z0,
    ], () => new Array(8).fill(mix(tokenHex("--ambe-plot-ink"), tokenHex("--ambe-plot-bg"), 0.35)), 1.25,
    { dashed: true, dash: 0.08, gap: 0.06 });
    add(edge);

    // The field: every row but the reader's, as the line through its stem
    // tips, coloured by level, in one call.
    /** @type {number[]} */
    let ridgeColours = [];
    const field = fatLines(c, new Float32Array((ROWS - 1) * (BINS - 1) * 6), () => ridgeColours, 1.25, { fog: true });
    field.frustumCulled = false;
    add(field);

    // The reader's row: its 81 stems, coloured by level up each stem, and
    // the highlight along their tips.
    /** @type {number[]} */
    let stemColours = [];
    const stems = fatLines(c, new Float32Array(BINS * 6), () => stemColours, 1.75);
    stems.frustumCulled = false;
    add(stems);
    const kit = addHighlight(c, tips(selected), { baseline: BASE, top: MAP.y(0), chip: chipText() });
    add(kit);

    // The weak tone's mark: a ring on bin 30's tip of the reader's row and
    // a leader up to its label, in a categorical colour, never covered.
    const weak = fatLines(c, new Float32Array(25 * 6), "--ambe-cat-3", 2, { depthTest: false });
    weak.renderOrder = 14;
    weak.frustumCulled = false;
    add(weak);
    return {
      sheet, edge, field, stems, kit, weak,
      /** @param {number[]} ridge @param {number[]} stem */
      colour: (ridge, stem) => {
        ridgeColours = ridge;
        stemColours = stem;
      },
    };
  }

  /** The chip's fact: the setting and how far it has spread. */
  function chipText() {
    return `${rowCycles(selected).toFixed(2)} cycles: ${countText(shown[selected])}`;
  }

  /**
   * A row's stem tips, as grown so far, bin 0 to 80.
   * @param {number} row
   * @returns {number[]} flat x, y, z
   */
  function tips(row) {
    const z = MAP.z(rowCycles(row));
    /** @type {number[]} */
    const p = [];
    for (let k = 0; k < BINS; k += 1) p.push(MAP.x(k), lerp(BASE, MAP.y(shown[row][k]), grow[row]), z);
    return p;
  }

  /**
   * A row's tips as a comb: up each stem from the floor and back down.
   * @param {number[]} top  flat x, y, z per bin
   * @returns {number[]}
   */
  function comb(top) {
    /** @type {number[]} */
    const p = [];
    for (let k = 0; k < top.length; k += 3) {
      const [x, y, z] = [top[k], top[k + 1], top[k + 2]];
      p.push(x, BASE, z, x, y, z, x, BASE, z);
    }
    return p;
  }

  /** The camera looks along the front preset (from the pose: a zoom's pan moves the camera, not the look). */
  function looking() {
    const p = orbit?.pose();
    if (!view || !p) return "corner";
    const yaw = ((((p.yaw % 360) + 540) % 360) - 180) * (Math.PI / 180);
    const d = Math.cos(p.pitch * (Math.PI / 180)) * Math.cos(yaw);
    return d > 0.995 ? "front" : "corner";
  }

  /** Pitch of the camera now, degrees. */
  function pitch() {
    return orbit?.pose().pitch ?? PRESETS.corner.pitch;
  }

  /**
   * The weak tone's mark: bin 30's tip on the reader's row, as grown, and
   * the top of the leader above it.
   * @returns {[Vec, Vec]}
   */
  function weakMark() {
    const z = MAP.z(rowCycles(selected));
    const db = lerp(FLOOR_DB, shown[selected][WEAK_BIN], grow[selected]);
    const x = MAP.x(WEAK_BIN);
    return [[x, MAP.y(db), z], [x, MAP.y(Math.min(-2, db + 24)), z]];
  }

  /** Place the field and the highlight from the levels on show. */
  function draw() {
    if (!scene || !view) return;
    const s = scene;
    const cut = pitch() < 60;
    const bg = tokenHex("--ambe-plot-bg");
    const ridge = new Float32Array((ROWS - 1) * (BINS - 1) * 6);
    /** @type {number[]} */
    const ridgeColours = [];
    let i = 0;
    for (let r = 0; r < ROWS; r += 1) {
      if (r === selected) continue;
      const p = tips(r);
      const delta = Math.abs(r - selected);
      // Rows nearer the camera than the highlight fade further (cutaway).
      const extra = cut && r > selected && !printing() ? CUTAWAY : 0;
      const tone = (/** @type {number} */ k) =>
        mix(fade(rampColor(level(lerp(FLOOR_DB, shown[r][k], grow[r]))), delta), bg, extra);
      for (let k = 0; k + 1 < BINS; k += 1) {
        for (let j = 0; j < 6; j += 1) ridge[i * 6 + j] = p[k * 3 + j];
        ridgeColours.push(tone(k), tone(k + 1));
        i += 1;
      }
    }
    const top = tips(selected);
    const stems = new Float32Array(BINS * 6);
    /** @type {number[]} */
    const stemColours = [];
    const low = rampColor(0);
    for (let k = 0; k < BINS; k += 1) {
      stems.set([top[k * 3], BASE, top[k * 3 + 2], top[k * 3], top[k * 3 + 1], top[k * 3 + 2]], k * 6);
      stemColours.push(low, rampColor(level(lerp(FLOOR_DB, shown[selected][k], grow[selected]))));
    }
    s.colour(ridgeColours, stemColours);
    setSegments(s.field, ridge);
    s.field.userData.recolour?.();
    setSegments(s.stems, stems);
    s.stems.userData.recolour?.();
    // In the close-up the highlight runs up and down each stem, so the
    // peak and the stems beside it read as stems, not one tent.
    s.kit.set(state.focus ? comb(top) : top);
    s.kit.chip?.set({ text: chipText() });
    s.weak.visible = state.weak;
    if (state.weak) {
      const [tip, head] = weakMark();
      /** @type {number[]} */
      const ring = [];
      const rx = 0.09;
      const ry = 0.09;
      for (let i = 0; i < 24; i += 1) {
        const a0 = (i / 24) * 2 * Math.PI;
        const a1 = ((i + 1) / 24) * 2 * Math.PI;
        ring.push(tip[0] + rx * Math.cos(a0), tip[1] + ry * Math.sin(a0), tip[2],
          tip[0] + rx * Math.cos(a1), tip[1] + ry * Math.sin(a1), tip[2]);
      }
      ring.push(tip[0], tip[1] + ry, tip[2], head[0], head[1], head[2]);
      setSegments(s.weak, ring);
    }

    const z = MAP.z(rowCycles(selected));
    frontPoints = [];
    for (let k = 0; k < BINS; k += 1) {
      const db = shown[selected][k];
      frontPoints.push({ at: [MAP.x(k), MAP.y(db), z], bin: k, db });
    }
    view.requestRender();
  }

  /** The field and the sheet hide when seen from the front: then it is the 2D plot. */
  function visibility() {
    if (!scene) return;
    const front = looking() === "front";
    for (const part of [scene.field, scene.sheet]) part.visible = !front;
    // Away from Front the reader's stems are see-through, so the rows
    // behind them read; the highlight along their tips carries the row.
    const m = scene.stems.material;
    const opacity = front || printing() ? 1 : STEM_OPACITY;
    if (m.opacity !== opacity) {
      m.transparent = opacity < 1;
      m.depthWrite = opacity === 1;
      m.opacity = opacity;
      m.needsUpdate = true;
      scene.stems.renderOrder = opacity < 1 ? 5 : 0;
      view?.requestRender();
    }
  }

  function relabelScene() {
    if (!firstDrawn) return;
    const mode = `${looking()}:${state.weak}:${state.window}:${selected}:${state.focus}:${frame.clientWidth < 560}`;
    if (!labels || mode === labelled) return;
    labelled = mode;
    const narrow = frame.clientWidth < 560;
    /** @type {import("./lib/labels.js").Label[]} */
    const list = axisLabels(BOX, MAP, [
      // No 80: its tick would sit on the depth axis's 7.00.
      { axis: "x", name: narrow ? "bin (50 Hz each)" : "bin, 50 Hz apart", ticks: [0, 20, 40, 60] },
      { axis: "y", name: "dB", ticks: [-100, -40, 0], format: (v) => (v < 0 ? `−${-v}` : String(v)) },
      { axis: "z", name: "cycles in the block", ticks: [6, 6.5, 7], format: (v) => v.toFixed(2) },
    ]);
    // The y axis's name sits between -40 and -100, so the -40 tick, the
    // figure's threshold, keeps its place.
    for (const label of list) {
      if (label.text === "dB" && !label.tick) label.at = [label.at[0], MAP.y(-72), label.at[2]];
    }
    if (state.weak) {
      // At the top of its leader, above bin 30 on the reader's row.
      list.push({ text: "weak tone, bin 30", at: weakMark()[1], align: "middle", dy: -9 });
    }
    if (state.focus && state.window === "hann") {
      // The close-up's two side stems, at -6.02 dB.
      const db = state.rows[selected];
      const z = MAP.z(rowCycles(selected));
      const peak = db.indexOf(Math.max(...db));
      for (const k of [peak - 1, peak + 1]) {
        if (k < 0 || k >= BINS || db[k] < COUNT_DB) continue;
        const text = `${db[k] < 0 ? "−" : ""}${Math.abs(db[k]).toFixed(2)} dB`;
        list.push({ text, at: [MAP.x(k + (k < peak ? -0.35 : 0.35)), MAP.y(db[k]), z], align: k < peak ? "end" : "start" });
      }
    }
    labels.set(list);
  }

  /**
   * The fit: on Front the scene lies on the 2D plot's rectangle; elsewhere
   * the whole box fills the frame. Between them the frustum eases from one
   * to the other over 25 degrees.
   */
  const fit = () => {
    const cam = /** @type {any} */ (/** @type {ThreeContext} */ (ctx).camera);
    if (!cam.isOrthographicCamera) return;
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    const right = [m[0], m[1], m[2]];
    const up = [m[4], m[5], m[6]];
    let hw = 0;
    let hh = 0;
    for (const x of [BOX.min[0], BOX.max[0]]) {
      for (const y of [BOX.min[1], BOX.max[1]]) {
        for (const z of [BOX.min[2], BOX.max[2]]) {
          hw = Math.max(hw, Math.abs(x * right[0] + y * right[1] + z * right[2]));
          hh = Math.max(hh, Math.abs(x * up[0] + y * up[1] + z * up[2]));
        }
      }
    }
    const pad = W < 560 ? { l: 30, r: 72, t: 56, b: 60 } : { l: 70, r: 96, t: 36, b: 84 };
    const room = { w: W - pad.l - pad.r, h: H - pad.t - pad.b };
    const k = Math.min(room.w / (2 * hw), room.h / (2 * hh));
    const cx = pad.l + room.w / 2;
    const cy = pad.t + room.h / 2;
    let f = { left: -cx / k, right: (W - cx) / k, top: cy / k, bottom: -(H - cy) / k };
    const { plot } = layout(W, H);
    const g = frontFrustum({ width: W, height: H }, plot.area, BOX);
    const d = cam.position.clone().normalize();
    const near = Math.cos((25 * Math.PI) / 180);
    const t = smooth((d.z - near) / (1 - near));
    if (t > 0) {
      f = {
        left: lerp(f.left, g.left, t),
        right: lerp(f.right, g.right, t),
        top: lerp(f.top, g.top, t),
        bottom: lerp(f.bottom, g.bottom, t),
      };
    }
    Object.assign(cam, f);
  };

  let cutWas = pitch() < 60;
  orbit = createOrbit(ctx, {
    target: TARGET,
    fit,
    distance: DISTANCE,
    zoom: opts.look.zoom || 1,
    presets: PRESETS,
    start: PRESETS[state.preset] ? state.preset : "corner",
    yaw: !opts.headOn,
    onDrag: opts.onDrag,
    onChange: () => {
      visibility();
      relabelScene();
      labels?.update();
      scene?.kit.chip?.update();
      const cut = pitch() < 60;
      if (cut !== cutWas) {
        cutWas = cut;
        draw();
      }
    },
  });

  let labelTimer = 0;
  /** The sentence for the 3D canvas's label (the orbit adds the zoom sentence). */
  function describe() {
    const seen = state.preset === "front" ? "from the front, as the 2D stems" : "from a corner";
    const win = state.window === "hann" ? "a Hann window" : "a rectangular cut";
    return `A field of spectra in 3D, seen ${seen}: one row of 81 stems for every setting of the tone ` +
      `from 6.00 to 7.00 cycles in the block, cut with ${win}, each stem coloured by its level. ` +
      `The highlighted row is ${state.cycles.toFixed(2)} cycles, with ${countText(state.rows[state.row])}.` +
      (state.weak ? " A weak second tone sits at bin 30." : "");
  }
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
  };
  ctx.viewSignal.addEventListener("abort", () => clearTimeout(labelTimer), { once: true });

  const timeline = ctx.timeline();
  /** One redraw per frame, however many tracks moved. */
  let pending = false;
  const redraw = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      draw();
    });
  };

  /** Morph every row from the levels on show to the state's. */
  const morph = () => {
    const from = shown.map((row) => Float64Array.from(row));
    const to = state.rows;
    source = to;
    return timeline.play("morph", {
      ms: duration("3d-build"),
      step: (t) => {
        for (let r = 0; r < ROWS; r += 1) {
          for (let k = 0; k < BINS; k += 1) shown[r][k] = lerp(from[r][k], to[r][k], t);
        }
        redraw();
      },
    });
  };

  /** The intro's sweep is running: the highlight walks the rows as they rise. */
  let sweeping = false;

  if (opts.intro) {
    // The first view: from the front, as the 2D stems; the camera turns to
    // the corner while the rows rise front to back, 6.00 to 7.00 cycles,
    // and the highlight walks with the newest row, its chip counting the
    // bins it lights, so the spread opens and closes again. It settles on
    // the reader's row. The -40 dB sheet fades in once the rows stand.
    played += 1;
    sweeping = true;
    grow[selected] = 1;
    const home = state.row;
    const to = PRESETS[state.preset] ?? PRESETS.corner;
    const turn = 2 * duration("3d-camera");
    // build() has run by now; the closure hides that from the checker.
    const sheet = /** @type {ReturnType<typeof parts> | null} */ (scene)?.sheet;
    const sheetOpacity = sheet ? /** @type {any} */ (sheet.material).opacity : 0;
    if (sheet) /** @type {any} */ (sheet.material).opacity = 0;
    orbit.set(PRESETS.front);
    draw();
    void timeline.play("camera", {
      ms: turn,
      ease: "linear",
      delay: duration("slow"),
      build: true,
      step: (t) => {
        const e = smooth(t);
        orbit?.set({ yaw: lerp(0, to.yaw, e), pitch: lerp(0, to.pitch, e) });
      },
    });
    // Each row rises over `rise` of the track, the next a fixed gap later.
    const rise = 0.14;
    const gap = (1 - rise) / (ROWS - 1);
    void timeline.play("rows", {
      ms: GROW_MS,
      ease: "linear",
      delay: duration("slow") + 0.5 * turn,
      build: true,
      step: (t) => {
        // The reader's row stands throughout, as does the highlighted one
        // once the reader has taken over.
        for (let r = 0; r < ROWS; r += 1) {
          grow[r] = r === home || (!sweeping && r === selected) ? 1 : smooth((t - r * gap) / rise);
        }
        if (sweeping && t >= 1) {
          sweeping = false;
          selected = state.row;
          void scene?.kit.pulse();
        } else if (sweeping) {
          // The newest row to have risen all the way, so the chip's count
          // is the row's as drawn.
          let risen = home;
          for (let r = 0; r < ROWS; r += 1) if (grow[r] >= 1) risen = Math.max(risen, r);
          selected = risen;
        }
        relabelScene();
        redraw();
      },
    });
    void timeline.play("sheet", {
      ms: duration("3d-build"),
      delay: duration("slow") + 0.5 * turn + GROW_MS,
      build: true,
      step: (t) => {
        if (sheet) /** @type {any} */ (sheet.material).opacity = sheetOpacity * t;
        view?.requestRender();
      },
    });
  }

  if (TEST_HOOK) {
    TEST_HOOK.figures["leakage-3d"] = {
      get builds() { return builds; },
      get played() { return played; },
      pose: () => orbit?.pose() ?? null,
      zoom: () => orbit?.zoom() ?? 1,
      get frontPoints() { return frontPoints; },
      get looking() { return looking(); },
      get selected() { return selected; },
      get grown() { return Array.from(grow); },
      /** The levels on show of one row. */
      shown: (/** @type {number} */ row) => Array.from(shown[row]),
      get parts() {
        if (!scene) return {};
        return { field: scene.field.visible, sheet: scene.sheet.visible, chip: scene.kit.chip?.node.textContent ?? "" };
      },
      /** CSS px in the frame of a scene point, through the live camera. */
      project: (/** @type {Vec} */ at) => {
        const v = new ctx.three.Vector3(...at).project(ctx.camera);
        return [((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight];
      },
    };
    ctx.viewSignal.addEventListener("abort", () => {
      if (TEST_HOOK) delete TEST_HOOK.figures["leakage-3d"];
    }, { once: true });
  }

  /**
   * The last step's close-up: Front, then zoomed on bins 0 to 16 so the
   * peak and the stems either side stand apart. The zoom keeps the plot's
   * top left corner still, so bins -1.5 to about 17 and 0 to about -20 dB
   * fill the frame.
   */
  async function peak() {
    if (!orbit) return;
    await orbit.go("front");
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H || !state.focus) return;
    const { plot } = layout(W, H);
    await orbit.zoomBy(PEAK_ZOOM, (plot.area.x / W) * 2 - 1, 1 - (plot.area.y / H) * 2);
  }

  await ctx.drawn();
  firstDrawn = true;
  relabelScene();
  if (state.focus && !opts.intro) void peak();
  return {
    update: (next) => {
      Object.assign(state, /** @type {LeakageState} */ (next));
      if (sweeping) {
        // The reader moved: the sweep ends here, every row stands.
        sweeping = false;
        selected = state.row;
        grow[selected] = 1;
      }
      if (state.rows !== source) {
        if (state.row !== selected) selected = state.row;
        void morph();
      } else if (state.row !== selected) {
        selected = state.row;
        grow[selected] = 1;
        draw();
        void scene?.kit.pulse();
      } else {
        draw();
      }
      relabelScene();
      relabel();
    },
    preset: (name) => {
      if (name === "peak") void peak();
      else void orbit?.go(name);
      relabel();
    },
    describe,
    close: () => ctx.dispose(),
  };
}
