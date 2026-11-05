// @ts-check
/* ===========================================================================
 * anim-vq-space-3d.js: the vq-space figure's 3D view (ch09), loaded by
 * lib/view-switch.js only when a 3D view is wanted and the frame is near.
 * ---------------------------------------------------------------------------
 * It draws the 2D module's arrays (VqScene in anim-vq-space.js) and
 * computes no model data: the dots, the entries and which dot each is sent
 * as, the grid's cells and which hold a dot, and the 2-number cell layer
 * (painted by the 2D module onto a texture). Two numbers lie flat on the
 * cube's front face; three fill it. The Front preset is the 2D plot.
 *
 * The look (three-visual-language design §4, vq-space): the stage, a floor
 * with a contact shadow, fog; the cells as faint cubes in their entry's
 * colour, the empty ones bare dim edges (the 2D plot and the front face
 * hatch them); entries as small category discs with an ink outline; the
 * probe's entry as the subject, a large highlight disc with a ring, its
 * spokes 1.75 px highlight and its grid cube filled in the highlight
 * fill, with a chip "entry 23 of 64". With the probe off the cloud the
 * subject is its error, the line to its entry, through the highlight kit;
 * with the Speech dots, the cloud's long axis.
 *
 * The explanatory animation, reveal({full: true}) ("a stretched cloud
 * leaves most cubes empty"), one beat at a time: from the Front view the
 * 2D plot shows, the camera turns to a raised three-quarter view; the
 * dots lift from the front face to their depth; the cells fade in, the
 * empty ones dim to bare edges and a chip counts them; the camera sweeps
 * round the cube to the corner. A step change runs the short form, all
 * three together within 1.2 s. It runs on ctx.timeline(), three tracks at
 * most, and lands on its end state under reduced motion, on any input
 * and in print.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { createChip, createLabels } from "./lib/labels.js";
import { createOrbit } from "./lib/orbit.js";
import { contactShadow, fatLines, floor, fog, mix, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-vq-space.js").VqScene} VqScene */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */

/** @type {Record<string, import("./lib/orbit.js").Pose>} */
const PRESETS = {
  front: { yaw: 0, pitch: 0 },
  top: { yaw: 0, pitch: 90 },
  corner: { yaw: -35, pitch: 22 },
};
/** The reveal's raised three-quarter view, where the dots lift. */
const OBLIQUE = { yaw: 70, pitch: 16 };
/** The sweep from there round the cube to the corner, and a step change's whole length. */
const SWEEP_MS = 1200;
const LIFT_MS = 400;
const CELLS_MS = 700;
const ENTRY_MS = 250;
/** Where the cells' fade-in ends and the empty ones' dimming begins, in the cells track. */
const HATCH_AT = 0.5;
/** The front face's texture, px a side; the cells are painted at half that. */
const FACE_PX = 1024;
/** The chosen entry's spokes, CSS px (visual language §4). */
const SPOKE_PX = 1.75;
/** Below this frame width (CSS px) the axis names break onto two lines. */
const NARROW = 480;
/** Point sizes in CSS px at 1x: dots, entries (0.7 of the 2D mark, outlined), the chosen entry. */
const DOT_PX = 3.5;
const ENTRY_PX = 6;
const ENTRY_RING_PX = 8.5;
const CHOSEN_PX = 13;
const CHOSEN_RING_PX = 17;
const PROBE_PX = 15;
/** The most spokes the highlight draws. */
const STAR = 24;

/**
 * A white disc or ring as an alpha mask for round points; the colour comes
 * from the material or the vertex colours.
 * @param {typeof import("three")} T
 * @param {number} inner 0 for a disc, else the ring's inner radius (0 to 1)
 */
function pointMask(T, inner) {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const inside = inner ? Math.min(1 - r, r - inner) : 1 - r;
      const a = Math.max(0, Math.min(1, inside * n * 0.5));
      data.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
    }
  }
  const texture = new T.DataTexture(data, n, n);
  texture.needsUpdate = true;
  return texture;
}

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let scene = /** @type {VqScene} */ (opts.state);

  /* -------------------------------------------------------------------------
   * What the animations move, kept across a rebuild
   * ---------------------------------------------------------------------- */

  /** 0: every dot on the front face; 1: at its depth. */
  let lift = scene.dims === 3 ? 1 : 0;
  /** The cells fading in (0 to 1), then the empty ones' hatch and dimming. */
  let cellsIn = 1;
  let hatchIn = 1;
  /** The entries as drawn: the scene's, except during an entry tween. */
  let drawn = Float32Array.from(scene.entries);
  let builds = 0;
  let played = 0;
  let paintedKey = "";
  let labelKey = "";
  /** Set once the view is up: build() runs first inside mountThree(). */
  let ready = false;
  let tweening = false;

  /**
   * @typedef {Object} Parts
   * @property {import("three").LineSegments} box
   * @property {import("three").Points} dots
   * @property {import("three").LineSegments} spokes
   * @property {import("three").Points} entryRing
   * @property {import("three").Points} entryFill
   * @property {import("three").LineSegments} cubes
   * @property {import("three").Mesh} fills
   * @property {import("three").Mesh} face
   * @property {HTMLCanvasElement} faceCanvas
   * @property {import("three").CanvasTexture} faceTexture
   * @property {import("three").Points} chosen
   * @property {import("three").Points} chosenRing
   * @property {import("three").Points} probe
   * @property {import("three").Line} probeLine
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} star
   * @property {import("three").Group & import("./lib/highlight.js").HighlightKit} kit
   * @property {import("./lib/labels.js").Chip} subjectChip
   * @property {import("./lib/labels.js").Chip} countChip
   * @property {import("three/addons/lines/LineSegments2.js").LineSegments2} emptyRing  the empty cube the count points at
   */
  /** @type {Parts | null} */
  let parts = null;

  /** @param {ThreeContext} ctx */
  const build = (ctx) => {
    const T = ctx.three;
    const disc = ctx.track(pointMask(T, 0));
    const ring = ctx.track(pointMask(T, 0.6));
    /** @param {number} count @param {boolean} [colours] */
    const geometry = (count, colours = false) => {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(count * 3), 3));
      if (colours) g.setAttribute("color", new T.BufferAttribute(new Float32Array(count * 3), 3));
      return g;
    };
    /**
     * Opaque with an alpha cut-out, so renderOrder decides what lies on top.
     * @param {number} size
     * @param {import("three").Texture} map
     * @param {{vertexColors?: boolean, onTop?: boolean}} [o] onTop: over the dots, never fogged
     */
    const points = (size, map, { vertexColors = false, onTop = false } = {}) => new T.PointsMaterial({
      size, sizeAttenuation: false, map, alphaTest: 0.4, transparent: false, vertexColors,
      depthTest: !onTop, depthWrite: !onTop, fog: !onTop,
    });

    ctx.scene.add(floor(ctx, { extent: { min: [-1, -1.04, -1], max: [1, -1.04, 1] }, step: 0.5 }));
    ctx.scene.add(contactShadow(ctx, { x: [-0.9, 0.9], z: [-0.9, 0.9], y: -1.04 }));

    // The cube's outline and a short tick at each end value an axis label names.
    const box = new T.LineSegments(geometry(24 + 12), ctx.paint(new T.LineBasicMaterial(), "--ambe-plot-axis"));
    // The cells: every cube's edges in one draw, the used ones' faces in one
    // translucent mesh, the 2-number cells on the front face.
    const cubes = new T.LineSegments(geometry(64 * 24, true), new T.LineBasicMaterial({ vertexColors: true }));
    const fills = new T.Mesh(geometry(64 * 36, true), new T.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.14, depthWrite: false, side: T.DoubleSide,
    }));
    // A new canvas on every build (a context restore, an unpark): paint it again.
    const faceCanvas = document.createElement("canvas");
    paintedKey = "";
    const faceTexture = ctx.track(new T.CanvasTexture(faceCanvas));
    faceTexture.colorSpace = T.SRGBColorSpace;
    const face = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({
      map: faceTexture, transparent: true, depthWrite: false, fog: false,
    }));
    face.position.z = -0.004;
    const spokes = new T.LineSegments(geometry(4800 * 2, true), new T.LineBasicMaterial({ vertexColors: true }));
    const dots = new T.Points(geometry(2000, true), points(DOT_PX, disc, { vertexColors: true }));
    // Placed on every draw, so the chips follow the camera and the zoom.
    dots.frustumCulled = false;
    const entryRing = new T.Points(geometry(64), ctx.paint(points(ENTRY_RING_PX, disc, { onTop: true }), "--ambe-plot-ink"));
    const entryFill = new T.Points(geometry(64, true), points(ENTRY_PX, disc, { vertexColors: true, onTop: true }));
    const chosenRing = new T.Points(geometry(1), ctx.paint(points(CHOSEN_RING_PX, disc, { onTop: true }), "--ambe-plot-ink"));
    const chosen = new T.Points(geometry(1), ctx.paint(points(CHOSEN_PX, disc, { onTop: true }), "--ambe-highlight"));
    const probeLine = new T.Line(geometry(2), ctx.paint(new T.LineBasicMaterial({ depthTest: false, fog: false }), "--ambe-accent-warm"));
    const probe = new T.Points(geometry(1), ctx.paint(points(PROBE_PX, ring, { onTop: true }), "--ambe-accent-warm"));
    const kit = addHighlight(ctx, [0, 0, 0, 0, 0, 0], { fill: false });
    // The kit's dashed outline frames a flat curve; its subjects here are a
    // line in depth and a single segment.
    kit.children[0].visible = false;
    const star = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-highlight", SPOKE_PX, { depthTest: false });
    star.renderOrder = 19;
    // The empty cube (or cell) the count chip points at, ringed.
    const emptyRing = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-highlight", 1.5, {});
    emptyRing.visible = false;
    const subjectChip = createChip(frame, ctx, { text: "", at: [0, 0, 0] });
    const countChip = createChip(frame, ctx, { text: "", at: [-1, 1, 1] });
    ctx.track({ dispose: subjectChip.dispose });
    ctx.track({ dispose: countChip.dispose });
    dots.onBeforeRender = () => {
      subjectChip.update();
      countChip.update();
    };
    ctx.scene.add(face, fills, box, cubes, spokes, dots, kit, star, emptyRing);
    [entryRing, entryFill, chosenRing, chosen, probeLine, probe].forEach((object, i) => {
      object.renderOrder = 20 + i;
      ctx.scene.add(object);
    });
    dots.userData.recolour = () => {
      paintedKey = "";
      write();
    };
    parts = { box, dots, spokes, entryRing, entryFill, cubes, fills, face, faceCanvas, faceTexture,
      chosen, chosenRing, probe, probeLine, star, kit, subjectChip, countChip, emptyRing };
    fog(ctx, 6, 2.6);
    builds += 1;
    if (ready) write();
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: scene.label,
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) return null;
  const T = ctx.three;

  /* -------------------------------------------------------------------------
   * Writing the buffers from the scene and the animation state
   * ---------------------------------------------------------------------- */

  const colour = new T.Color();
  /** Linear RGB of 0xRRGGBB. @param {number} hex */
  const rgb = (hex) => colour.setHex(hex).toArray();
  /** @param {import("three").BufferGeometry} g */
  const pos = (g) => /** @type {Float32Array} */ (g.getAttribute("position").array);
  /** @param {import("three").BufferGeometry} g */
  const col = (g) => /** @type {Float32Array} */ (g.getAttribute("color").array);
  /** @param {import("three").BufferGeometry} g @param {number} count */
  const touched = (g, count) => {
    g.setDrawRange(0, count);
    g.getAttribute("position").needsUpdate = true;
    if (g.getAttribute("color")) g.getAttribute("color").needsUpdate = true;
    g.computeBoundingSphere();
  };
  /** A cube's 12 edges, as 24 points. @param {number[]} lo @param {number[]} hi */
  const edges = (lo, hi) => {
    /** @type {number[]} */
    const out = [];
    const v = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
    for (const [a, b] of [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]]) {
      out.push(...v(a & 1, (a >> 1) & 1, (a >> 2) & 1), ...v(b & 1, (b >> 1) & 1, (b >> 2) & 1));
    }
    return out;
  };

  /** Grid cell k's bounds, in gridQuantize's cell order. */
  const cellBounds = (/** @type {number} */ k) => {
    const { m } = scene.cells;
    const q = [Math.floor(k / (m * m)), Math.floor(k / m) % m, k % m];
    const lo = q.map((v) => -1 + (2 * v) / m);
    const hi = q.map((v) => -1 + (2 * (v + 1)) / m);
    return { lo, hi };
  };

  /** The camera's direction from the target, a unit vector, from the pose. */
  const toCamera = () => {
    const { yaw, pitch } = turn?.pose() ?? PRESETS.front;
    const r = Math.PI / 180;
    return [Math.cos(pitch * r) * Math.sin(yaw * r), Math.sin(pitch * r), Math.cos(pitch * r) * Math.cos(yaw * r)];
  };

  /**
   * Where the count chip points: the centre of an empty cell. In the cube,
   * the empty cube nearest the camera with no used cube between it and the
   * camera, so the leader ends on an empty cube from any pose; on the
   * front face, the empty cell nearest the top left.
   * @param {number} depth
   * @returns {[number, number, number]}
   */
  const emptyAnchor = (depth) => {
    const { m, used } = scene.cells;
    const three = scene.dims === 3;
    const look = three ? toCamera() : [0, 0, 1];
    /** The cell holding scene point p, or -1 outside the cube. @param {number[]} p */
    const cellAt = (p) => {
      const q = [p[0], p[1], depth > 0.05 ? p[2] / depth : 0].map((v) => Math.floor(((v + 1) / 2) * m));
      if (q.some((v) => v < 0 || v >= m)) return -1;
      return (q[0] * m + q[1]) * m + q[2];
    };
    let best = -Infinity;
    /** @type {[number, number, number]} */
    let at = [-1, 1, 0];
    for (let k = 0; k < used.length; k += 1) {
      if (used[k]) continue;
      const q = three ? [Math.floor(k / (m * m)), Math.floor(k / m) % m, k % m] : [Math.floor(k / m), k % m, 0];
      const c = q.map((v) => -1 + (2 * v + 1) / m);
      const p = [c[0], c[1], three ? c[2] * depth : 0];
      let score = three ? p[0] * look[0] + p[1] * look[1] + p[2] * look[2] : -c[0] + c[1];
      if (three) {
        // A used cube in front hides it; one behind makes the dot read as
        // that cube's. Best is a line of sight through empty cubes only.
        for (const [dir, cost] of [[1, 10], [-1, 5]]) {
          for (let t = 0.5 / m; t < 3.5; t += 0.5 / m) {
            const j = cellAt(p.map((v, i) => v + dir * look[i] * t));
            if (j < 0) break;
            if (j !== k && used[j]) {
              score -= cost;
              break;
            }
          }
        }
      }
      if (score > best) {
        best = score;
        at = /** @type {[number, number, number]} */ (p);
      }
    }
    return at;
  };

  /**
   * Where the codebook's count chip points: the used entry farthest from
   * the chosen one, so the two chips stay apart.
   * @param {(k: number) => number[]} at
   * @returns {[number, number, number]}
   */
  const usedAnchor = (at) => {
    const s = scene;
    const K = s.entries.length / s.dims;
    const c = s.chosen >= 0 ? at(s.chosen) : [0, 0, 0];
    let best = -1;
    /** @type {[number, number, number]} */
    let out = [0, 0, 0];
    for (let k = 0; k < K; k += 1) {
      if (!s.count[k]) continue;
      const q = at(k);
      const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2;
      if (d > best) {
        best = d;
        out = /** @type {[number, number, number]} */ (q);
      }
    }
    return out;
  };

  /** The count chip's text and anchor now, or null when it is not shown. */
  let countAt = () => /** @type {[number, number, number] | null} */ (null);
  /** Rings the empty cube the count chip points at; set by write(). */
  let ringEmpty = () => {};

  /** Rewrite every buffer from the scene; the entries from `drawn`. */
  const write = () => {
    if (!parts || !ready) return;
    const s = scene;
    const p = parts;
    const bg = tokenHex("--ambe-plot-bg");
    const ink = tokenHex("--ambe-plot-ink");
    const cats = Array.from({ length: 8 }, (_, c) => tokenHex(`--ambe-cat-${c + 1}`));
    const depth = Math.max(lift, 0);
    const three = s.dims === 3;
    const on = s.method !== "none";
    const speech = s.data === "speech";
    const level = s.dims === 2 || (turn?.pose().pitch ?? 0) < 12;

    // The cube's outline: its depth follows the lift, flat with two numbers.
    // Then the ticks at the end values the labels name, on the same edges.
    const box = edges([-1, -1, -depth], [1, 1, depth]);
    const tick = 0.06;
    const xy = level ? -1 : 1;
    for (const v of [-0.75, 0.75]) box.push(v, xy, -depth, v, xy + tick, -depth, 1, v, depth, 1 + tick, v, depth);
    for (const v of [-0.75, 0.75]) box.push(1, 1, v * depth, 1 + tick, 1 + tick, v * depth);
    pos(p.box.geometry).set(box);
    touched(p.box.geometry, three ? 36 : 32);

    // The dots, coloured by the entry they are sent as.
    const d = pos(p.dots.geometry);
    const dc = col(p.dots.geometry);
    for (let i = 0; i < s.n; i += 1) {
      d[i * 3] = s.pts[i * 3];
      d[i * 3 + 1] = s.pts[i * 3 + 1];
      d[i * 3 + 2] = s.pts[i * 3 + 2] * lift;
      const c = rgb(on ? cats[s.cats[s.assign[i]]] : ink);
      dc.set(c, i * 3);
    }
    touched(p.dots.geometry, s.n);

    // The entries as drawn, in three numbers at the lift.
    const K = s.entries.length / s.dims;
    const at = (/** @type {number} */ k) => [
      drawn[k * s.dims] ?? 0, drawn[k * s.dims + 1] ?? 0, three ? (drawn[k * s.dims + 2] ?? 0) * lift : 0,
    ];
    const showEntries = on && !speech;
    const e = pos(p.entryRing.geometry);
    const ef = pos(p.entryFill.geometry);
    const ec = col(p.entryFill.geometry);
    // In the cube a grid level no dot uses is not drawn: its cube's bare edges say it.
    let shownK = 0;
    for (let k = 0; k < K; k += 1) {
      if (three && s.method === "grid" && !s.count[k]) continue;
      const q = at(k);
      e.set(q, shownK * 3);
      ef.set(q, shownK * 3);
      ec.set(rgb(s.count[k] ? cats[s.cats[k]] : bg), shownK * 3);
      shownK += 1;
    }
    touched(p.entryRing.geometry, showEntries ? shownK : 0);
    touched(p.entryFill.geometry, showEntries ? shownK : 0);

    // Spokes from each dot to its entry, in the entry's colour faded 40%.
    const sp = pos(p.spokes.geometry);
    const sc = col(p.spokes.geometry);
    if (showEntries) {
      for (let i = 0; i < s.n; i += 1) {
        const k = s.assign[i];
        const q = at(k);
        sp.set([d[i * 3], d[i * 3 + 1], d[i * 3 + 2], q[0], q[1], q[2]], i * 6);
        const c = rgb(mix(cats[s.cats[k]], bg, 0.4));
        sc.set(c, i * 6);
        sc.set(c, i * 6 + 3);
      }
    }
    touched(p.spokes.geometry, showEntries ? s.n * 2 : 0);

    // The cells: the grid the bits buy. Used ones in their colour, faint,
    // with a tinted fill; empty ones as bare dim edges, so they read as
    // nothing there. A codebook keeps the grid's lattice, all of it dim,
    // behind its entries. Three numbers draw cubes; two paint the face.
    const lattice = s.method === "codebook";
    const cb = pos(p.cubes.geometry);
    const cc = col(p.cubes.geometry);
    const fb = pos(p.fills.geometry);
    const fc = col(p.fills.geometry);
    let lines = 0;
    let tris = 0;
    if (three) {
      const muted = tokenHex("--ambe-plot-muted");
      const fillTop = tokenHex("--ambe-highlight-fill-top");
      const chosenCell = s.method === "grid" ? s.chosen : -1;
      const cellCount = s.cells.m ** 3;
      const empty = rgb(mix(muted, bg, 1 - cellsIn * (0.5 - 0.26 * hatchIn)));
      for (let k = 0; k < cellCount; k += 1) {
        const { lo, hi } = cellBounds(k);
        lo[2] *= depth;
        hi[2] *= depth;
        const used = !lattice && s.cells.used[k] > 0;
        const c = used ? rgb(mix(cats[s.cells.cats[k]], bg, 1 - 0.55 * cellsIn)) : empty;
        const segs = edges(lo, hi);
        for (let v = 0; v < 24; v += 1) {
          cb.set(segs.slice(v * 3, v * 3 + 3), lines * 3);
          cc.set(c, lines * 3);
          lines += 1;
        }
        if (used || k === chosenCell) {
          const box3 = new T.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], Math.max(1e-4, hi[2] - lo[2]));
          box3.translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
          const flatBox = box3.toNonIndexed();
          const bp = /** @type {Float32Array} */ (flatBox.getAttribute("position").array);
          const f = rgb(k === chosenCell ? fillTop : mix(cats[s.cells.cats[k]], bg, 1 - cellsIn));
          for (let v = 0; v < bp.length / 3 && tris < 64 * 36; v += 1) {
            fb.set(bp.subarray(v * 3, v * 3 + 3), tris * 3);
            fc.set(f, tris * 3);
            tris += 1;
          }
          box3.dispose();
          flatBox.dispose();
        }
      }
    }
    touched(p.cubes.geometry, lines);
    touched(p.fills.geometry, tris);
    p.cubes.visible = cellsIn > 0;
    p.fills.visible = tris > 0 && cellsIn > 0;

    // Two numbers: the front face carries the 2D plot's cells.
    const faceOn = !three && on;
    p.face.visible = faceOn;
    if (faceOn) {
      const key = `${s.method}|${s.bits}|${s.entries.join(",")}`;
      if (key !== paintedKey) {
        paintedKey = key;
        s.paintCells(p.faceCanvas, FACE_PX);
        p.faceTexture.needsUpdate = true;
      }
      /** @type {import("three").MeshBasicMaterial} */ (p.face.material).opacity = cellsIn;
    }

    // The subject: the probe's entry and its spokes; with the probe off the
    // cloud, its error; with the Speech dots, the cloud's long axis.
    const pq = [s.probe[0], s.probe[1], three ? s.probe[2] * lift : 0];
    const chosenOn = showEntries && s.chosen >= 0;
    const errorOn = chosenOn && s.focus === "error" && s.showProbe;
    const axis = speech && s.axis
      ? [...s.axis.from.slice(0, 2), s.axis.from[2] * lift, ...s.axis.to.slice(0, 2), s.axis.to[2] * lift]
      : null;
    /** @type {number[]} */
    let anchor = [0, 0, 0];
    let chipText = "";
    if (chosenOn) {
      const q = at(s.chosen);
      anchor = q;
      chipText = `entry ${s.chosen + 1} of ${K}`;
      // Its spokes, at most STAR of them evenly through its dots, so the
      // star stays a star and the dots stay visible.
      /** @type {number[]} */
      const members = [];
      for (let i = 0; i < s.n; i += 1) if (s.assign[i] === s.chosen) members.push(i);
      const every = Math.max(1, members.length / STAR);
      /** @type {number[]} */
      const star = [];
      for (let j = 0; j < members.length; j += every) {
        const i = members[Math.floor(j)];
        star.push(...q, d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);
      }
      if (star.length < 6) star.push(...q, ...q);
      setSegments(p.star, star);
      pos(p.chosen.geometry).set(q);
      pos(p.chosenRing.geometry).set(q);
      if (errorOn) {
        p.kit.set([...pq, ...q]);
        anchor = pq.map((v, j) => (v + q[j]) / 2);
        chipText = `probe error ${s.probeErr.code.toPrecision(2)}, grid ${s.probeErr.grid.toPrecision(2)}`;
      }
    } else if (axis) {
      p.kit.set(axis);
      // The rod's lower end has open space round it; its top meets the labels.
      anchor = axis.slice(0, 3);
      chipText = s.axis ? `most of the spread lies along this line: ${s.axis.spread.toFixed(1)} dB` : "";
    }
    touched(p.chosen.geometry, chosenOn ? 1 : 0);
    touched(p.chosenRing.geometry, chosenOn ? 1 : 0);
    p.star.visible = chosenOn && !errorOn;
    p.kit.visible = errorOn || Boolean(axis);
    p.subjectChip.set({ text: chipText, at: /** @type {[number, number, number]} */ (anchor) });
    p.subjectChip.node.parentElement?.toggleAttribute("hidden", !chipText);

    // The count: empty cells for a grid (and before a quantizer), used
    // entries for a codebook; once the cells are in.
    // With the probe's error as the subject, its chip alone.
    const counting = (three || on) && hatchIn >= 1 && !errorOn;
    const unit = three ? "cubes" : "cells";
    if (lattice) {
      let used = 0;
      for (const c of s.count) if (c) used += 1;
      p.countChip.set({ text: `${used} of ${K} entries used` });
      countAt = () => usedAnchor(at);
    } else {
      p.countChip.set({ text: `${s.cells.empty} of ${s.cells.m ** s.dims} ${unit} empty` });
      countAt = () => emptyAnchor(depth);
    }
    p.countChip.set({ at: countAt() ?? [0, 0, 0] });
    p.countChip.node.parentElement?.toggleAttribute("hidden", !counting);
    ringEmpty = () => {
      const anchor = countAt();
      const show = counting && !lattice && anchor !== null;
      p.emptyRing.visible = show;
      if (!show || !anchor) return;
      const h = 1 / s.cells.m;
      const hz = three ? (depth * h) : 0;
      const [x, y, z] = anchor;
      /** @type {number[]} */
      const seg = [];
      const zs = hz ? [z - hz, z + hz] : [z + 0.002];
      for (const zz of zs) {
        seg.push(x - h, y - h, zz, x + h, y - h, zz, x + h, y - h, zz, x + h, y + h, zz,
          x + h, y + h, zz, x - h, y + h, zz, x - h, y + h, zz, x - h, y - h, zz);
      }
      if (hz) for (const [a, b] of [[-h, -h], [h, -h], [h, h], [-h, h]]) seg.push(x + a, y + b, z - hz, x + a, y + b, z + hz);
      setSegments(p.emptyRing, seg);
    };
    ringEmpty();

    // The probe, joined to its nearest entry by a thin line (the kit draws
    // it when the error is the subject).
    const probeOn = s.showProbe;
    pos(p.probe.geometry).set(pq);
    touched(p.probe.geometry, probeOn ? 1 : 0);
    const near = s.chosen >= 0 ? at(s.chosen) : pq;
    pos(p.probeLine.geometry).set([...pq, ...near]);
    touched(p.probeLine.geometry, probeOn && !errorOn ? 2 : 0);

    relabel();
    ctx.requestRender();
  };

  /* -------------------------------------------------------------------------
   * Camera, labels and the fit
   * ---------------------------------------------------------------------- */

  /**
   * The axis names, with the end values near each end, each on a cube edge
   * that runs along its own axis and lies on the cube's outline at Corner.
   * @returns {import("./lib/labels.js").Label[]}
   */
  const axisLabels = () => {
    const z = Math.max(lift, 0.001) * 1.14;
    // On a phone each name takes two short lines, so the side names fit
    // beside the cube and none is cut at the frame's edge.
    const narrow = frame.clientWidth < NARROW;
    const [a, b, c] = scene.names.map((t) => (narrow ? t.replace(" ", "\n") : t));
    const [lo, hi] = scene.ends;
    // Seen from the front (and with two numbers, always) the first axis's
    // names sit inside the face's foot: the frame keeps no room above the
    // plot, and its bottom strip clear. From above they ride the top edge.
    const level = scene.dims === 2 || (turn?.pose().pitch ?? 0) < 12;
    const y = level ? -0.9 : 1.14;
    /** @type {import("./lib/labels.js").Label[]} */
    const list = [
      { text: a, at: [0, y, -z], align: "middle", along: [1, 0, 0] },
      { text: lo, at: [-0.75, y, -z], align: "middle", along: [1, 0, 0], tick: true },
      { text: hi, at: [0.75, y, -z], align: "middle", along: [1, 0, 0], tick: true },
      // A phone has little room right of the cube: the name sits closer.
      { text: b, at: [narrow ? 1.02 : 1.12, 0, z], align: "start", along: [0, 1, 0] },
      { text: lo, at: [1.12, -0.75, z], align: "start", along: [0, 1, 0], tick: true },
      { text: hi, at: [1.12, 0.75, z], align: "start", along: [0, 1, 0], tick: true },
    ];
    if (scene.dims === 3) {
      list.push(
        { text: c, at: [1.12, 1.12, 0], align: "start", along: [0, 0, 1] },
        { text: lo, at: [1.12, 1.12, -0.75 * lift], align: "start", along: [0, 0, 1], tick: true },
        { text: hi, at: [1.12, 1.12, 0.75 * lift], align: "start", along: [0, 0, 1], tick: true },
      );
    }
    return list;
  };

  const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
  const corner = new T.Vector3();
  /**
   * The frustum that puts the cube's front face on the 2D plot's square at
   * Front, and keeps the whole cube inside that square at any other pose.
   */
  const fit = () => {
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (!w || !h) return;
    camera.updateMatrixWorld();
    let mx = 0;
    let my = 0;
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      mx = Math.max(mx, Math.abs(corner.x));
      my = Math.max(my, Math.abs(corner.y));
    }
    const r = scene.plotRect();
    const k = r.width / 2 / Math.max(mx, my);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    camera.left = -cx / k;
    camera.right = (w - cx) / k;
    camera.top = cy / k;
    camera.bottom = -(h - cy) / k;
  };

  const labels = createLabels(frame, ctx);
  /** @type {import("./lib/orbit.js").Orbit | null} */
  let turn = null;
  /** The axis labels, set again only when they change. */
  const relabel = () => {
    const list = axisLabels();
    const key = JSON.stringify(list);
    if (key === labelKey) return;
    labelKey = key;
    labels.set(list);
  };

  const start = scene.dims === 3 ? "corner" : "front";
  /** Whether the first axis's labels and ticks sit at the foot, as last written. */
  let wasLevel = true;
  const orbit = createOrbit(ctx, {
    target: [0, 0, 0], distance: 6, zoom: opts.look.zoom || 1, presets: PRESETS, start, fit,
    onDrag: opts.onDrag,
    onChange: () => {
      const level = scene.dims === 2 || (turn?.pose().pitch ?? 0) < 12;
      if (level !== wasLevel && ready) {
        wasLevel = level;
        write();
      }
      relabel();
      labels.update();
      const grow = Math.sqrt(turn?.zoom() ?? 1);
      if (parts) {
        /** @type {import("three").PointsMaterial} */ (parts.dots.material).size = DOT_PX * grow;
        // The empty cube the count points at is the one in view from here.
        const anchor = countAt();
        if (anchor) parts.countChip.set({ at: anchor });
        ringEmpty();
      }
    },
  });
  turn = orbit;
  const timeline = ctx.timeline();
  ready = true;
  write();

  /* -------------------------------------------------------------------------
   * Animations
   * ---------------------------------------------------------------------- */

  /** @param {import("./lib/orbit.js").Pose} a @param {import("./lib/orbit.js").Pose} b @param {number} t */
  const between = (a, b, t) => {
    const dyaw = ((((b.yaw - a.yaw) % 360) + 540) % 360) - 180;
    return { yaw: a.yaw + dyaw * t, pitch: a.pitch + (b.pitch - a.pitch) * t };
  };
  /** The cells track: they fade in, then the empty ones dim. @param {number} t */
  const cellsStep = (t) => {
    cellsIn = Math.min(1, t / HATCH_AT);
    hatchIn = Math.max(0, (t - HATCH_AT) / (1 - HATCH_AT));
    write();
  };
  /**
   * One beat of the full reveal. Resolves true when it ran its whole
   * length; false when it landed early (an input, a step change, reduced
   * motion, a park), and the rest of the reveal then lands too.
   * @param {string} name
   * @param {number} ms
   * @param {(t: number) => void} step
   * @param {"ease" | "inout"} [ease]
   */
  const beat = async (name, ms, step, ease = "ease") => {
    const begin = performance.now();
    await timeline.play(name, { ms, ease, build: true, step });
    return performance.now() - begin >= ms - 20;
  };
  /** Bumped by every reveal and flatten, so an older one never lands over a newer one. */
  let revealRun = 0;
  /** Bumped by every preset, so a reveal landed by one leaves the camera to it. */
  let cameraRun = 0;

  /**
   * The explanatory animation. Full (the first view, the walk-through):
   * Front, the turn to a raised three-quarter view, the lift, the cells
   * and the count, the sweep to the corner, one beat after another. Short
   * (a step change): the turn to the corner, the lift and the cells
   * together within SWEEP_MS. Two numbers: the cells fade in at Front.
   * @param {{full?: boolean}} [o]
   * @returns {Promise<void>}
   */
  const reveal = async ({ full = false } = {}) => {
    const run = (revealRun += 1);
    const camera0 = cameraRun;
    const three = scene.dims === 3;
    const from = orbit.pose();
    // The preset Reset view returns to; landing that flight lands
    // everything else running too.
    void orbit.go(three ? "corner" : "front");
    ctx.finish();
    cellsIn = 0;
    hatchIn = 0;
    if (!three) {
      write();
      await timeline.play("cells", { ms: CELLS_MS, step: cellsStep });
      return;
    }
    const corner = PRESETS.corner;
    lift = 0;
    if (full) {
      orbit.set(PRESETS.front);
      write();
      const ok = await beat("turn", duration("3d-camera"), (t) => orbit.set(between(PRESETS.front, OBLIQUE, t)), "inout")
        && run === revealRun && await beat("lift", duration("3d-build"), (t) => { lift = t; write(); })
        && run === revealRun && await beat("cells", duration("3d-build"), cellsStep)
        && run === revealRun && await beat("sweep", SWEEP_MS, (t) => orbit.set(between(OBLIQUE, corner, t)), "inout");
      if (!ok && run === revealRun) {
        lift = scene.dims === 3 ? 1 : 0;
        cellsIn = 1;
        hatchIn = 1;
        if (camera0 === cameraRun) orbit.set(corner);
        write();
      }
      return;
    }
    orbit.set(from);
    write();
    await Promise.all([
      timeline.play("sweep", { ms: SWEEP_MS, ease: "inout", step: (t) => orbit.set(between(from, corner, t)) }),
      timeline.play("lift", { ms: duration("3d-build"), step: (t) => { lift = t; write(); } }),
      timeline.play("cells", { ms: SWEEP_MS - 300, delay: 300, step: cellsStep }),
    ]);
  };

  /** Three numbers down to two: the dots settle onto the front face. */
  const flatten = () => {
    revealRun += 1;
    const runs = [orbit.go("front")];
    const from = lift;
    cellsIn = 0;
    hatchIn = 0;
    runs.push(timeline.play("lift", { ms: LIFT_MS + 100, step: (t) => { lift = from * (1 - t); write(); } }));
    runs.push(timeline.play("cells", { ms: CELLS_MS, delay: LIFT_MS, step: cellsStep }));
    return Promise.all(runs).then(() => {});
  };

  /**
   * The camera turned by `dyaw` degrees from where it is, over `ms`; the
   * walk-through's slow look round the cube.
   * @param {number} dyaw
   * @param {number} ms
   */
  const turnBy = (dyaw, ms) => {
    const from = orbit.pose();
    return timeline.play("sweep", {
      ms, ease: "inout", step: (t) => orbit.set({ yaw: from.yaw + dyaw * t, pitch: from.pitch }),
    });
  };

  /**
   * The drawn entries from `from` to the scene's; the spokes stay attached.
   * @param {Float32Array} from
   * @param {number} [ms]
   */
  const entries = (from, ms = ENTRY_MS) => {
    const to = Float32Array.from(scene.entries);
    if (from.length !== to.length) {
      drawn = to;
      write();
      return Promise.resolve();
    }
    tweening = true;
    return timeline.play("entries", {
      ms,
      step: (t) => {
        drawn = t === 1 ? to : to.map((v, i) => from[i] + (v - from[i]) * t);
        if (t === 1) tweening = false;
        write();
      },
    });
  };

  /** The subject's pulse: the chosen entry swells and settles; the kit glows. */
  const pulse = () => {
    if (!parts) return Promise.resolve();
    const p = parts;
    if (p.kit.visible) return p.kit.pulse();
    const disc = /** @type {import("three").PointsMaterial} */ (p.chosen.material);
    const ring = /** @type {import("three").PointsMaterial} */ (p.chosenRing.material);
    return timeline.play("pulse", {
      ms: duration("slow"),
      step: (t) => {
        const k = 1 + 0.45 * Math.sin(Math.PI * t);
        disc.size = CHOSEN_PX * k;
        ring.size = CHOSEN_RING_PX * k;
        ctx.requestRender();
      },
    });
  };

  /**
   * Zoom so that every point (scene units) sits inside the frame with a
   * margin, about their middle, `most` times at the most.
   * @param {number[][]} points
   * @param {number} most
   */
  const closeUp = (points, most) => {
    camera.updateMatrixWorld();
    const ndc = points.map((q) => new T.Vector3(q[0], q[1], scene.dims === 3 ? (q[2] ?? 0) * lift : 0).project(camera));
    const mx = ndc.reduce((a, v) => a + v.x, 0) / ndc.length;
    const my = ndc.reduce((a, v) => a + v.y, 0) / ndc.length;
    let factor = most;
    // Each point moves away from the middle by the factor; keep it within
    // 0.7 of the edge (the chips sit above and beside their anchors).
    for (const v of ndc) {
      for (const [p, m] of [[v.x, mx], [v.y, my]]) {
        const room = 0.7 - Math.sign(p - m) * m;
        if (Math.abs(p - m) > 1e-6) factor = Math.min(factor, room / Math.abs(p - m));
      }
    }
    return orbit.zoomBy(Math.max(1, factor) / orbit.zoom(), mx, my);
  };

  /** @type {import("./anim-vq-space.js").VqView} */
  const view = {
    reveal,
    flatten,
    entries,
    turnBy,
    preset: (name) => {
      cameraRun += 1;
      return orbit.go(name);
    },
    closeUp,
    resetView: () => orbit.resetView(),
    pulse,
    finish: () => ctx.finish(),
    shows: () => `${scene.dims}|${scene.data}`,
  };
  scene.link.view = view;

  let describeTimer = 0;
  const describe = () => {
    clearTimeout(describeTimer);
    describeTimer = window.setTimeout(() => {
      ctx.renderer?.domElement.setAttribute("aria-label", scene.label);
    }, 250);
  };

  if (opts.intro) {
    played += 1;
    void reveal({ full: true });
  }

  if (TEST_HOOK) {
    TEST_HOOK.figures["vq-space-3d"] = {
      get builds() {
        return builds;
      },
      pose: () => orbit.pose(),
      zoom: () => orbit.zoom(),
      get played() {
        return played;
      },
      get lift() {
        return lift;
      },
      get cells() {
        return { cellsIn, hatchIn };
      },
      get shown() {
        return Array.from(drawn);
      },
      /** The front face's texture width, px: FACE_PX once painted. */
      get faceWidth() {
        return parts ? parts.faceCanvas.width : 0;
      },
      get dotZ() {
        const z = parts ? pos(parts.dots.geometry) : new Float32Array(0);
        return Array.from({ length: scene.n }, (_, i) => z[i * 3 + 2]);
      },
      /** The first 8 dots, scene units. */
      get frontPoints() {
        return Array.from({ length: 8 }, (_, i) => [scene.pts[i * 3], scene.pts[i * 3 + 1], scene.pts[i * 3 + 2] * lift]);
      },
      /** The first 8 dots, projected to CSS px of the frame by the camera now. */
      get frontPx() {
        camera.updateMatrixWorld();
        return Array.from({ length: 8 }, (_, i) => {
          const v = new T.Vector3(scene.pts[i * 3], scene.pts[i * 3 + 1], scene.pts[i * 3 + 2] * lift).project(camera);
          return [((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight];
        });
      },
      get chips() {
        return parts ? [parts.subjectChip, parts.countChip]
          .filter((c) => !c.node.parentElement?.hidden).map((c) => c.node.textContent) : [];
      },
      get objects() {
        return ctx.scene.children.length;
      },
      get three() {
        return ctx;
      },
      timeRender: () => {
        const t0 = performance.now();
        ctx.renderer.render(ctx.scene, ctx.camera);
        ctx.renderer.getContext().finish();
        return performance.now() - t0;
      },
    };
  }

  await ctx.drawn();
  describe();
  return {
    update: (next) => {
      const s = /** @type {VqScene} */ (next);
      const dimsChanged = s.dims !== scene.dims;
      scene = s;
      if (dimsChanged) {
        // A reveal or flatten for the old count lands no more.
        revealRun += 1;
        lift = s.dims === 3 ? 1 : 0;
      }
      if (!tweening || drawn.length !== s.entries.length) drawn = Float32Array.from(s.entries);
      write();
      describe();
    },
    preset: (name) => {
      cameraRun += 1;
      void orbit.go(name);
    },
    describe: () => scene.label,
    close: () => {
      clearTimeout(describeTimer);
      if (scene.link.view === view) scene.link.view = null;
      labels.dispose();
      if (TEST_HOOK) delete TEST_HOOK.figures["vq-space-3d"];
      ctx.dispose();
    },
  };
}
