// @ts-check
/* ===========================================================================
 * anim-fec-protection-3d.js: the fec-protection figure's 3D view (owner
 * decision O2).
 * ---------------------------------------------------------------------------
 * Head-on, Front only, no yaw, zoom on: no depth axis. The three failure
 * curves are fat lines in --ambe-cat-n with a dash per code, the bars are
 * frosted columns, and the frame's 144 positions and the eight codeword
 * rows are thin tiles on an upright board with the contact shadow behind
 * it. Everything the 2D view draws besides those marks (axes, labels, the
 * row statuses, the tints, the meter) comes from anim-fec-protection.js,
 * painted on one plane behind them, so Front at 1x is the 2D view, mark
 * for mark.
 *
 * The animation ("Interleaving spreads a burst of errors so each codeword
 * sees few enough to correct"): the burst's errors arrive on the air one
 * after another in transmitted order, then each lifts off and slides to
 * its codeword's row through the interleaver, landing on its bit. Once all
 * have landed the rows take their statuses, a row with more errors than
 * its code corrects is tinted, and the codeword with the most errors
 * takes the highlight with its chip ("Hamming u4: 2 errors, corrects 1")
 * and one pulse. Depth is used only while a tile is in flight.
 *
 * It computes nothing from the model: the result, the geometry and the
 * backing all come from anim-fec-protection.js (FecView).
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { createLabels } from "./lib/labels.js";
import { FRONT, createOrbit, matchPlot } from "./lib/orbit.js";
import { contactShadow, fatLines, floor, mix, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-fec-protection.js").FecView} FecView */
/** @typedef {import("./anim-fec-protection.js").Geometry} Geometry */
/** @typedef {import("./anim-fec-protection.js").Rect} Rect */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */

/** Scene z of the parts, front to back (orthographic camera). */
const Z_HATCH = 0.03;
const Z_CELL = 0.012;
const Z_CURVE = 0.006;
const Z_FILL = 0.002;
const Z_BAR = 0;
const Z_BACKING = -0.06;
const Z_BOARD = -0.07;
const Z_SHADOW = -0.08;
/** A tile's thickness, CSS px; how far a tile in flight comes forward. */
const THICK_PX = 4;
const LIFT = 0.12;
/** The chip's gap from its box anchor and from the frame edge (lib/labels.js). */
const CHIP_GAP = 14;
const CHIP_EDGE = 4;
/** CSS px a press travels before it is a drag (a double-click zooms). */
const DRAG_PX = 3;
/** ms of quiet after a zoom or pan before the backing is painted sharp. */
const SETTLE_MS = 200;
/** The most errors a burst has (the slider's top). */
const MAX_ERRORS = 24;
/** Air positions and row cells: 144 of each at most. */
const MAX_TILES = 288;

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  /** @type {FecView} */
  let view = /** @type {FecView} */ (opts.state);
  /** Each error's flight, 0 (not arrived) to 1 (landed); 1 once a burst is done. */
  const flight = new Float32Array(MAX_ERRORS).fill(1);
  const probe = {
    builds: 0, played: 0, bursts: 0, pose: FRONT, zoom: 1, chip: "", landed: false, flight,
    /** The part of the frame the backing covers, once a zoom settles. @type {Rect | null} */
    region: null,
    frontPoints: () => /** @type {number[][]} */ ([]),
    tilePoints: () => /** @type {number[][]} */ ([]),
  };
  if (TEST_HOOK) TEST_HOOK.figures["fec-protection-3d"] = probe;

  /** @type {any} */
  let parts = null;
  /** @type {ThreeContext | null} */
  let ctxRef = null;
  /** The marks for the frame's size now. @type {Geometry | null} */
  let geo = null;
  /** The burst has landed: statuses, tints and the highlight show. */
  let landed = true;

  const size = () => {
    const r = frame.getBoundingClientRect();
    return { width: Math.max(1, Math.round(r.width - frame.clientLeft * 2)), height: Math.max(1, Math.round(r.height - frame.clientTop * 2)) };
  };
  /** CSS px of the frame to scene units: x and y each over -1 to 1. */
  const sx = (/** @type {number} */ px) => (px / size().width) * 2 - 1;
  const sy = (/** @type {number} */ py) => 1 - (py / size().height) * 2;
  const ux = (/** @type {number} */ px) => (px / size().width) * 2;
  const uy = (/** @type {number} */ py) => (py / size().height) * 2;

  /** A rectangle's outline as segments, z. @param {Rect} r @param {number} z */
  const rectSegments = (r, z) => {
    const x0 = sx(r.x);
    const x1 = sx(r.x + r.w);
    const y0 = sy(r.y);
    const y1 = sy(r.y + r.h);
    return [x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z];
  };
  /** A polyline (px) as segment pairs at z. @param {number[][]} points @param {number} z */
  const polySegments = (points, z) => {
    /** @type {number[]} */
    const out = [];
    for (let i = 0; i + 1 < points.length; i += 1) {
      out.push(sx(points[i][0]), sy(points[i][1]), z, sx(points[i + 1][0]), sy(points[i + 1][1]), z);
    }
    return out.length ? out : [0, 0, z, 0, 0, z];
  };

  const groupHex = (/** @type {number} */ g) => tokenHex(view.look.groups[g]);
  const ground = () => tokenHex("--ambe-plot-bg");
  const groupOf = (/** @type {number} */ v) => (v < 4 ? 0 : v < 7 ? 1 : 2);

  /* -- the backing: everything but the marks, from the 2D module ---------- */
  /**
   * The part of the frame (px) the backing covers: the whole frame, or,
   * once a zoom settles, the part in view, painted at the zoom's density
   * so its text stays sharp. @type {Rect | null}
   */
  let region = null;
  /** The zoom the backing was last painted for. */
  let paintedZoom = 1;
  const paintBacking = () => {
    if (!parts || !ctxRef) return;
    const T = ctxRef.three;
    const { width, height } = size();
    const r = region ?? { x: 0, y: 0, w: width, h: height };
    const density = Math.max(1, Math.min(window.devicePixelRatio || 1, 2)) * 1.5;
    const scale = Math.min(density * (region ? paintedZoom : 1), region ? 8 : 3, 4096 / Math.max(r.w, r.h));
    const w = Math.max(1, Math.round(r.w * scale));
    const h = Math.max(1, Math.round(r.h * scale));
    let texture = parts.backing.material.map;
    if (!texture || texture.image.width !== w || texture.image.height !== h) {
      texture?.dispose();
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      texture = new T.CanvasTexture(canvas);
      // Straight alpha: a premultiplied pixel decoded from sRGB would
      // crush a faint tint (and every text edge) toward black.
      texture.colorSpace = T.SRGBColorSpace;
      texture.premultiplyAlpha = false;
      texture.generateMipmaps = false;
      texture.minFilter = T.LinearFilter;
      parts.backing.material.map = texture;
      parts.backing.material.needsUpdate = true;
    }
    const canvas = /** @type {HTMLCanvasElement} */ (texture.image);
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(w / r.w, 0, 0, h / r.h, (-r.x * w) / r.w, (-r.y * h) / r.h);
    view.backing(g, { width, height }, landed);
    parts.backing.position.set(sx(r.x + r.w / 2), sy(r.y + r.h / 2), Z_BACKING);
    parts.backing.scale.set(r.w / width, r.h / height, 1);
    texture.needsUpdate = true;
    ctxRef.requestRender();
  };

  /* -- the curves, the marker and the bars -------------------------------- */
  const writeCurves = () => {
    if (!parts || !geo || !ctxRef) return;
    const subjectGroup = groupOf(view.result.subject);
    geo.curves.forEach(({ group, points }) => {
      const line = parts.curves[group];
      setSegments(line, polySegments(points, Z_CURVE));
      line.visible = group !== subjectGroup && points.length > 1;
    });
    const own = geo.curves[subjectGroup].points;
    const bottom = geo.layout.curves.y + geo.layout.curves.h;
    // The frosted fill reaches down to the plot's floor.
    parts.curveOpts.baseline = sy(bottom);
    /** @type {number[]} */
    const pts = [];
    for (const [x, y] of own.length > 1 ? own : [[0, bottom], [1, bottom]]) pts.push(sx(x), sy(y), Z_FILL);
    parts.curveKit.set(pts);
    setSegments(parts.marker, [sx(geo.marker.x), sy(geo.marker.top), Z_CURVE, sx(geo.marker.x), sy(geo.marker.bottom), Z_CURVE]);
    writeCursor();
    writeBars();
  };

  const writeBars = () => {
    if (!parts || !geo || !ctxRef) return;
    const T = ctxRef.three;
    const position = parts.bars.geometry.getAttribute("position");
    const colour = parts.bars.geometry.getAttribute("color");
    const c = new T.Color();
    /** @type {number[]} */
    const caps = [];
    geo.bars.forEach((bar, v) => {
      const x0 = sx(bar.x);
      const x1 = sx(bar.x + bar.w);
      const top = sy(Math.min(bar.top, bar.bottom));
      const bottom = sy(bar.bottom);
      // Two triangles, top left, top right, bottom left, bottom right.
      position.setXYZ(v * 4, x0, top, Z_BAR);
      position.setXYZ(v * 4 + 1, x1, top, Z_BAR);
      position.setXYZ(v * 4 + 2, x0, bottom, Z_BAR);
      position.setXYZ(v * 4 + 3, x1, bottom, Z_BAR);
      const hue = groupHex(groupOf(v));
      const [hi, lo] = [mix(hue, ground(), 0.35), mix(hue, ground(), 0.9)];
      for (const [i, hex] of /** @type {[number, number][]} */ ([[0, hi], [1, hi], [2, lo], [3, lo]])) {
        c.setHex(hex);
        colour.setXYZ(v * 4 + i, c.r, c.g, c.b);
      }
      caps.push(x0, top, Z_CURVE, x1, top, Z_CURVE);
    });
    position.needsUpdate = true;
    colour.needsUpdate = true;
    parts.bars.geometry.computeBoundingSphere();
    setSegments(parts.caps, caps);
    parts.caps.userData.recolour();
    ctxRef.requestRender();
  };

  /* -- the tiles: the air, the rows, the errors in flight ----------------- */

  /** Write one tile at a rectangle (px), z, colour. */
  const tileAt = (/** @type {any} */ mesh, /** @type {number} */ i, /** @type {Rect} */ r, /** @type {number} */ z, /** @type {number} */ hex, /** @type {number} */ grow = 1) => {
    const { m, colour } = parts;
    m.out.makeScale(ux(r.w) * grow, uy(r.h) * grow, uy(THICK_PX)).setPosition(sx(r.x + r.w / 2), sy(r.y + r.h / 2), z);
    mesh.setMatrixAt(i, m.out);
    mesh.setColorAt(i, colour.setHex(hex));
  };

  /** Where error k is at flight f: on the air, rising, sliding, landed. */
  const errorPlace = (/** @type {number} */ k, /** @type {number} */ f) => {
    if (!geo) return null;
    const e = geo.errors[k];
    // 0 to 0.3: it arrives on the air (grows in place); 0.3 to 1: it
    // slides to its row, lifted toward the eye on the way.
    const arrive = Math.min(1, f / 0.3);
    const u = f <= 0.3 ? 0 : (f - 0.3) / 0.7;
    const ease = u * u * (3 - 2 * u);
    const lerp = (/** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * ease;
    return {
      rect: { x: lerp(e.from.x, e.to.x), y: lerp(e.from.y, e.to.y), w: lerp(e.from.w, e.to.w), h: lerp(e.from.h, e.to.h) },
      z: Z_CELL + uy(THICK_PX) + LIFT * Math.sin(Math.PI * u),
      grow: f <= 0 ? 0 : arrive,
    };
  };

  const writeTiles = () => {
    if (!parts || !geo) return;
    const { cells, errors, m } = parts;
    const ink = tokenHex("--ambe-plot-ink");
    let i = 0;
    // The air: a hit position turns dark once its error has arrived.
    const arrived = new Set();
    geo.errors.forEach((_, k) => {
      if (flight[k] > 0) arrived.add(k);
    });
    const hitAt = new Map(view.result.errors.map((e, k) => [e.pos, k]));
    geo.air.forEach((a, pos) => {
      const k = hitAt.get(pos);
      const hex = k !== undefined && arrived.has(k) ? ink
        : mix(groupHex(groupOf(a.v)), ground(), a.check ? view.look.mix.check : view.look.mix.air);
      tileAt(cells, i, a.rect, Z_CELL, hex);
      i += 1;
    });
    for (const c of geo.cells) {
      tileAt(cells, i, c.rect, Z_CELL, mix(groupHex(groupOf(c.v)), ground(), c.check ? view.look.mix.check : view.look.mix.payload));
      i += 1;
    }
    for (; i < MAX_TILES; i += 1) cells.setMatrixAt(i, m.zero);
    // The errors: in flight or landed on their bits.
    for (let k = 0; k < MAX_ERRORS; k += 1) {
      const at = k < geo.errors.length ? errorPlace(k, flight[k]) : null;
      if (!at || at.grow <= 0) {
        errors.setMatrixAt(k, m.zero);
        continue;
      }
      tileAt(errors, k, at.rect, at.z, ink, at.grow);
    }
    for (const mesh of [cells, errors]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    ctxRef?.requestRender();
  };

  /** The statuses, tints, hatching, highlight and chip of a landed burst. */
  const writeVerdict = () => {
    if (!parts || !geo) return;
    const { rowKit, hatch } = parts;
    /** @type {number[]} */
    const lines = [];
    if (landed) {
      for (const [x0, y0, x1, y1] of geo.hatch) lines.push(sx(x0), sy(y0), Z_HATCH, sx(x1), sy(y1), Z_HATCH);
    }
    hatch.visible = lines.length > 0;
    if (lines.length) setSegments(hatch, lines);
    const segments = [...rectSegments(geo.subjectBar, Z_HATCH), ...rectSegments(geo.subjectRow, Z_HATCH)];
    for (const line of parts.rowLines) setSegments(line, segments);
    rowKit.visible = landed;
    const text = view.chip;
    probe.chip = landed ? text : "";
    probe.landed = landed;
    if (rowKit.chip) {
      // The dot sits on the outline's top right corner; placeChip() puts
      // the box above the rows.
      const r = geo.subjectRow;
      rowKit.chip.set({ text, at: [sx(r.x + r.w), sy(r.y), Z_HATCH] });
      const layer = /** @type {HTMLElement} */ (rowKit.chip.node.parentElement);
      layer.style.display = landed ? "" : "none";
    }
    ctxRef?.requestRender();
  };

  /** A scene point to frame px. */
  const project = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    if (!ctxRef) return [0, 0];
    ctxRef.camera.updateMatrixWorld();
    const v = new ctxRef.three.Vector3(x, y, z).project(ctxRef.camera);
    const { width, height } = size();
    return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
  };

  /**
   * The chip's box goes in the gap above the rows, over the subject row's
   * end, clear of every row's status; its leader runs down to the dot on
   * the outline. lib/labels.js places it first (and pins it at an edge
   * when the outline is out of view); this moves the box.
   * @param {() => void} place  the chip's own update
   */
  const placeChip = (place) => {
    place();
    const chip = parts?.rowKit.chip;
    if (!chip || !geo) return;
    const layer = /** @type {HTMLElement} */ (chip.node.parentElement);
    if (layer.classList.contains("anim-chip-layer--pinned")) return;
    const L = geo.layout;
    const row = L.rows[view.result.subject];
    const n = view.result.vectors[view.result.subject].code.n;
    const [x, y] = project(sx(row.cellsX + n * L.rowPitch - L.cell / 2), sy(L.rows[0].y - 5), Z_HATCH);
    const { width, height } = size();
    const bw = chip.node.offsetWidth;
    const bh = chip.node.offsetHeight;
    const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.max(lo, Math.min(hi, v));
    const left = clamp(x + CHIP_GAP + bw > width - CHIP_EDGE ? x - CHIP_GAP - bw : x + CHIP_GAP, CHIP_EDGE, width - CHIP_EDGE - bw);
    const top = clamp(y - CHIP_GAP - bh, CHIP_EDGE, height - CHIP_EDGE - bh);
    chip.node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    const line = /** @type {SVGLineElement} */ (layer.querySelector("line"));
    const x1 = Number(line.getAttribute("x1"));
    const y1 = Number(line.getAttribute("y1"));
    line.setAttribute("x2", clamp(x1, left, left + bw).toFixed(1));
    line.setAttribute("y2", clamp(y1, top, top + bh).toFixed(1));
  };

  /** The bit error rate beside its marker, over the frosted fill. */
  const writeCursor = () => {
    if (!parts || !geo || !ctxRef) return;
    const { marker } = geo;
    const A = geo.layout.curves;
    const right = marker.x > A.x + A.w - 40;
    // At the marker's foot, or as low as the view shows it when zoomed.
    const { height } = size();
    const [, top] = project(0, sy(marker.top), Z_CURVE);
    const [, foot] = project(0, sy(marker.bottom), Z_CURVE);
    const py = Math.max(top + 14, Math.min(foot, height - 60)) - 9;
    const v = new ctxRef.three.Vector3(0, 1 - (py / height) * 2, 0).unproject(ctxRef.camera);
    parts.cursor.set([{ text: marker.text, at: [sx(marker.x + (right ? -4 : 4)), v.y, Z_CURVE], align: right ? "end" : "start" }]);
  };

  /** Lay everything out for the frame's size and the state now. */
  const relayout = () => {
    if (!parts || !ctxRef) return;
    geo = view.geometry(size());
    const L = geo.layout;
    // The board behind the burst: the air down to the meter.
    const top = L.air.y - 16;
    const bottom = L.meter.y - 18;
    parts.board.position.set(sx(L.pad - 6), sy(top), 0);
    parts.board.scale.set(ux(L.W - 2 * L.pad + 12), uy(bottom - top), 1);
    writeCurves();
    writeTiles();
    writeVerdict();
    paintBacking();
  };

  /** @param {ThreeContext} ctx */
  const build = (ctx) => {
    const T = ctx.three;
    probe.builds += 1;
    const backing = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({
      transparent: true, depthWrite: false, premultipliedAlpha: false,
    }));
    backing.position.z = Z_BACKING;
    backing.userData.recolour = () => paintBacking();
    ctx.track({ dispose: () => backing.material.map?.dispose() });

    // The shared floor, stood upright behind the burst: (x, y, z) to
    // (x, -z, y), in a unit square relayout() scales to the board.
    const board = new T.Group();
    const upright = new T.Group();
    upright.rotation.x = Math.PI / 2;
    upright.add(
      floor(ctx, { extent: { min: [0, Z_BOARD, 0], max: [1, Z_BOARD, 1] }, step: [1 / 18, 1 / 6] }),
      contactShadow(ctx, { x: [0, 1], z: [0, 1], y: Z_SHADOW - 1e-3 }),
    );
    board.add(upright);

    const dashPx = (/** @type {number} */ px) => ux(px);
    const curves = [0, 1, 2].map((g) => {
      const [dash, gap] = view.look.dash[g];
      return fatLines(ctx, [0, 0, 0, 0, 0, 0], view.look.groups[g], 1.75,
        dash ? { dashed: true, dash: dashPx(dash), gap: dashPx(gap) } : {});
    });
    const marker = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 1.25);
    // The other curves and the marker draw over the highlight, so a curve
    // that runs along the subject's (no code: u0 to u3 and u4 to u6 are
    // a bit apart) still shows its dashes.
    for (const line of [...curves, marker]) {
      line.material.depthTest = false;
      line.material.transparent = true;
      line.renderOrder = 13;
    }

    // Eight frosted columns in one mesh, coloured per vertex.
    const barGeometry = new T.BufferGeometry();
    barGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array(8 * 4 * 3), 3));
    barGeometry.setAttribute("color", new T.BufferAttribute(new Float32Array(8 * 4 * 3), 3));
    /** @type {number[]} */
    const index = [];
    for (let v = 0; v < 8; v += 1) index.push(v * 4, v * 4 + 2, v * 4 + 1, v * 4 + 1, v * 4 + 2, v * 4 + 3);
    barGeometry.setIndex(index);
    const bars = new T.Mesh(barGeometry, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
    bars.userData.recolour = () => writeBars();
    const caps = fatLines(ctx, new Array(8 * 6).fill(0), () => {
      /** @type {number[]} */
      const out = [];
      for (let v = 0; v < 8; v += 1) out.push(groupHex(groupOf(v)), groupHex(groupOf(v)));
      return out;
    }, 1.75);

    const box = new T.BoxGeometry(1, 1, 1);
    const cells = new T.InstancedMesh(box, new T.MeshBasicMaterial(), MAX_TILES);
    const errors = new T.InstancedMesh(box, ctx.paint(new T.MeshBasicMaterial(), "--ambe-plot-ink"), MAX_ERRORS);
    for (const mesh of [cells, errors]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
    cells.userData.recolour = () => writeTiles();
    const hatch = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-text-3", 1, { depthTest: false });
    hatch.renderOrder = 5;

    // The subject: its curve (with the frosted fill under it) and, once
    // the burst lands, its bar and its row outlined, with the chip.
    /** @type {import("./lib/highlight.js").HighlightOptions} */
    const curveOpts = {};
    const curveKit = addHighlight(ctx, [0, 0, Z_FILL, 0.1, 0, Z_FILL], curveOpts);
    // Its dashed plane outline would box the whole plot: left out.
    for (const c of curveKit.children) if (/** @type {any} */ (c).material?.dashed) c.visible = false;
    const rowKit = addHighlight(ctx, [0, 0, Z_HATCH, 0.1, 0, Z_HATCH], { fill: false, chip: view.chip });
    if (rowKit.chip) {
      // The kit calls chip.update() on every draw; the box moves after it.
      const place = rowKit.chip.update;
      rowKit.chip.update = () => placeChip(place);
    }
    const cursor = createLabels(frame, ctx);
    ctx.track({ dispose: cursor.dispose });
    const rowLines = rowKit.children.filter((c) => c.renderOrder >= 10);
    // The kit's dashed plane outline has nothing to outline here.
    for (const c of rowKit.children) if (c.renderOrder < 10) c.visible = false;

    ctx.scene.add(backing, board, bars, caps, ...curves, marker, cells, errors, hatch, curveKit, rowKit);
    parts = {
      backing, board, curves, marker, bars, caps, cells, errors, hatch, curveKit, curveOpts, rowKit, rowLines, cursor,
      colour: new T.Color(), m: { out: new T.Matrix4(), zero: new T.Matrix4().makeScale(0, 0, 0) },
    };
    relayout();
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: view.label,
    build: (c) => {
      ctxRef = c;
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
  ctx.onResize(() => {
    region = null;
    probe.region = null;
    relayout();
  });

  const sceneBox = { min: /** @type {[number, number, number]} */ ([-1, -1, -1]), max: /** @type {[number, number, number]} */ ([1, 1, 1]) };
  const fitted = matchPlot(ctx, () => ({ x: 0, y: 0, ...size() }), sceneBox);
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbitRef = null;
  let settle = 0;
  const sharpen = () => {
    const zoom = orbitRef?.zoom() ?? 1;
    if (zoom < 1.05 || ctx.viewSignal.aborted) return;
    const { width, height } = size();
    ctx.camera.updateMatrixWorld();
    // The frame's corners, back in scene units, then frame px.
    const a = new ctx.three.Vector3(-1, 1, 0).unproject(ctx.camera);
    const b = new ctx.three.Vector3(1, -1, 0).unproject(ctx.camera);
    const pad = 12;
    const left = Math.max(0, ((a.x + 1) / 2) * width - pad);
    const top = Math.max(0, ((1 - a.y) / 2) * height - pad);
    const right = Math.min(width, ((b.x + 1) / 2) * width + pad);
    const bottom = Math.min(height, ((1 - b.y) / 2) * height + pad);
    if (right <= left || bottom <= top) return;
    region = { x: left, y: top, w: right - left, h: bottom - top };
    probe.region = region;
    paintedZoom = zoom;
    paintBacking();
  };
  ctx.viewSignal.addEventListener("abort", () => window.clearTimeout(settle));
  const orbit = createOrbit(ctx, {
    target: fitted.target, fit: fitted.fit, distance: 6, zoom: opts.look.zoom || 1,
    presets: { front: FRONT }, start: "front", yaw: false, onDrag: opts.onDrag,
    onChange: () => {
      probe.zoom = orbitRef?.zoom() ?? 1;
      writeCursor();
      // While the view moves the backing covers the whole frame; once it
      // settles, a zoomed view repaints just the part in view, sharp.
      if (region) {
        region = null;
        probe.region = null;
        paintBacking();
      }
      window.clearTimeout(settle);
      settle = window.setTimeout(sharpen, SETTLE_MS);
    },
  });
  orbitRef = orbit;

  // The curves' vertices, then the bars' top centres, as Front shows them.
  probe.frontPoints = () => {
    ctx.camera.updateMatrixWorld();
    if (!geo) return [];
    const out = [];
    for (const { points } of geo.curves) for (const [x, y] of points) out.push(project(sx(x), sy(y), Z_CURVE));
    for (const bar of geo.bars) out.push(project(sx(bar.x + bar.w / 2), sy(Math.min(bar.top, bar.bottom)), Z_BAR));
    return out;
  };
  // Where each error tile is now (its centre), as Front shows it.
  probe.tilePoints = () => {
    ctx.camera.updateMatrixWorld();
    if (!geo) return [];
    return geo.errors.map((_, k) => {
      const at = errorPlace(k, flight[k]);
      if (!at) return [NaN, NaN];
      return project(sx(at.rect.x + at.rect.w / 2), sy(at.rect.y + at.rect.h / 2), at.z);
    });
  };

  // Presses and drags on the frame go to the 2D module, in frame px. A
  // double-click zooms, so a press moves nothing until it travels DRAG_PX,
  // and a tap acts only once no second click follows it.
  /** @type {{x: number, y: number, cx: number, cy: number} | null} */
  let press = null;
  let dragging = false;
  let tap = 0;
  /** @param {number} clientX @param {number} clientY */
  const toFrame = (clientX, clientY) => {
    const rect = /** @type {HTMLCanvasElement} */ (ctx.renderer?.domElement).getBoundingClientRect();
    const v = new ctx.three.Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((clientY - rect.top) / rect.height) * 2,
      0,
    ).unproject(ctx.camera);
    const { width, height } = size();
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  };
  /** @param {PointerEvent} event */
  const onPointer = (event) => {
    const canvas = ctx.renderer?.domElement;
    if (event.type === "pointerdown") {
      // A press while a tap waits is a double-click's second: no tap.
      const second = tap !== 0;
      window.clearTimeout(tap);
      tap = 0;
      press = null;
      dragging = false;
      if (event.target !== canvas || second) return;
      press = { ...toFrame(event.clientX, event.clientY), cx: event.clientX, cy: event.clientY };
      return;
    }
    if (!press) return;
    if (event.type === "pointermove") {
      if (!dragging) {
        if (Math.hypot(event.clientX - press.cx, event.clientY - press.cy) < DRAG_PX) return;
        dragging = true;
        view.pointer("down", press.x, press.y);
      }
      const at = toFrame(event.clientX, event.clientY);
      view.pointer("move", at.x, at.y);
      return;
    }
    const was = press;
    press = null;
    if (dragging) {
      dragging = false;
      view.pointer("up", 0, 0);
    } else if (event.type === "pointerup") {
      tap = window.setTimeout(() => {
        tap = 0;
        view.pointer("down", was.x, was.y);
        view.pointer("up", 0, 0);
      }, 300);
    }
  };
  ctx.viewSignal.addEventListener("abort", () => window.clearTimeout(tap));
  const listen = { signal: ctx.viewSignal };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    frame.addEventListener(type, /** @type {EventListener} */ (onPointer), listen);
  }

  const timeline = ctx.timeline();
  /** Counts bursts, so a cut-short burst's end cannot land the next one. */
  let burstRun = 0;

  /**
   * Play the burst: the errors arrive in transmitted order, then slide to
   * their rows. Every step is idempotent (the timeline repeats t = 0 and 1).
   * @param {"intro" | "step" | "input"} pace
   */
  const playBurst = (pace) => {
    const count = view.result.errors.length;
    timeline.finish();
    const run = ++burstRun;
    if (!count) {
      landed = true;
      flight.fill(1);
      writeTiles();
      writeVerdict();
      paintBacking();
      return Promise.resolve();
    }
    probe.bursts += 1;
    landed = false;
    flight.fill(0);
    writeTiles();
    writeVerdict();
    paintBacking();
    const quick = pace === "input";
    const ms = quick ? 420 : 760;
    const stagger = Math.min(duration("stagger") || 35, (quick ? 160 : 380) / count);
    return timeline.play("burst", {
      ms,
      count,
      stagger: pace === "intro" ? Math.max(stagger, 45) : stagger,
      ease: "linear",
      build: pace === "intro",
      step: (t, k) => {
        flight[k] = t;
        writeTiles();
      },
    }).then(() => {
      if (run !== burstRun || landed) return;
      landed = true;
      flight.fill(1);
      writeTiles();
      writeVerdict();
      paintBacking();
      void parts?.rowKit.pulse();
    });
  };

  let burstKey = view.burstKey;
  if (opts.intro) {
    probe.played += 1;
    void playBurst("intro");
  }

  await ctx.drawn();
  return {
    update: (next) => {
      const was = { key: burstKey, mode: view.state.mode, subject: view.result.subject };
      view = /** @type {FecView} */ (next);
      geo = view.geometry(size());
      writeCurves();
      if (view.burstKey !== was.key) {
        burstKey = view.burstKey;
        void playBurst(view.pace);
      } else {
        writeTiles();
        writeVerdict();
        paintBacking();
        if (view.result.subject !== was.subject && landed) void parts?.rowKit.pulse();
      }
    },
    preset: (name) => void orbit.go(name),
    describe: () => view.label,
    close: () => ctx.dispose(),
  };
}

