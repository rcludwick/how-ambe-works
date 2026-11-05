// @ts-check
/* ===========================================================================
 * anim-bits-3d.js: the bits figure's 3D view (owner decision O2).
 * ---------------------------------------------------------------------------
 * Head-on, Front only, no yaw, zoom on. Each of the 72 cells is a thin tile
 * with the bit's colour on both faces and a rim, standing on a board (the
 * shared floor, turned upright) with the contact shadow behind it. Every
 * thing the 2D view draws besides the cells (labels, hex, the budget panel)
 * comes from anim-bits.js, painted on one plane behind the board, so the
 * Front view at 1x is the 2D view, tile for cell.
 *
 * The animation: on a frame change, each tile whose bit changed flips over
 * in place like a card, a half turn about its row's axis, staggered by bit
 * position; unchanged tiles stay still. A turning tile is foreshortened as
 * if seen in perspective (its near edge widens, its far edge narrows) and
 * its edge takes the highlight, since the camera is orthographic and a turn
 * seen head-on would otherwise read as a squash. Depth is used only while a
 * tile turns; there is no depth axis, no grouping and no field colour. The
 * highlight outlines each bit that changed since the previous frame as its
 * tile lands, and the chip counts them once the turn is over. The flip
 * always shows the bits that changed into the frame now shown: a step back
 * or a scrub first sets the tiles to the frame before it. The first view is
 * a step from frame 97 into 98 (the 2D module holds the clip on 97 until
 * this view is up), played once and slowly; while the clip plays, tiles
 * change at once.
 *
 * It computes nothing from the data: the bits, the changes, the rates, the
 * layout and the backing all come from anim-bits.js (BitsView).
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { addHighlight } from "./lib/highlight.js";
import { FRONT, createOrbit, matchPlot } from "./lib/orbit.js";
import { contactShadow, fatLines, floor, mix, rampColor, setSegments, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-bits.js").BitsView} BitsView */
/** @typedef {import("./anim-bits.js").Rect} Rect */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */

/** Scene z of the parts, front to back (scene units; the camera is
 *  orthographic). The shadow shows through the backing's clear parts. */
const Z_BOARD = -0.05;
const Z_BACKING = -0.06;
const Z_SHADOW = -0.07;
/** Tile thickness and rim, CSS px. */
const THICK_PX = 5;
const RIM_PX = 1.25;
/** The highlight's outline runs this far inside a tile's edge, CSS px, so
 *  the outlines of neighbouring tiles never merge across the gap. */
const RING_PX = -1.5;
/** An outline that is not drawn: four zero-length segments far outside the view. */
const PARKED = Array.from({ length: 24 }, (_, i) => (i % 3 === 2 ? 0 : 1e4));
/** How much a turning face darkens toward the plot background at edge-on. */
const TURN_SHADE = 0.45;
/** How much wider a tile looks at edge-on, while it turns. */
const LIFT = 0.03;
/** The eye distance of a turning tile's perspective, in tile heights: at
 *  edge-on its near edge is about 1.3 times as wide as its far edge. */
const EYE = 2;
/** The first view's flip: each tile's turn, and the whole wave, ms. */
const INTRO_MS = 760;
const INTRO_WAVE_MS = 900;

/**
 * Relative luminance of 0xRRGGBB, for choosing the digit's ink.
 * @param {number} hex
 */
function luminance(hex) {
  const [r, g, b] = [Math.floor(hex / 65536), Math.floor(hex / 256) % 256, hex % 256]
    .map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whichever of plot ink and plot background reads better on `fill`.
 * @param {number} fill
 */
function inkOn(fill) {
  const l = luminance(fill);
  const ink = tokenHex("--ambe-plot-ink");
  const ground = tokenHex("--ambe-plot-bg");
  /** @param {number} a @param {number} b */
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(l, luminance(ink)) >= ratio(l, luminance(ground)) ? ink : ground;
}

/**
 * A white digit on transparent, for the glyph tiles (coloured per instance).
 * @param {ThreeContext} ctx
 * @param {string} digit
 */
function glyph(ctx, digit) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const mono = getComputedStyle(document.body).getPropertyValue("--ambe-font-mono").trim() || "monospace";
  g.font = `600 ${Math.round(128 * 0.42)}px ${mono}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "white";
  g.fillText(digit, 64, 64.5);
  const texture = ctx.track(new ctx.three.CanvasTexture(canvas));
  texture.colorSpace = ctx.three.SRGBColorSpace;
  return texture;
}

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  /** @type {BitsView} */
  let view = /** @type {BitsView} */ (opts.state);
  const { model } = view;
  const rows = model.rows;
  let frameNow = view.frame;
  // The 3D view's own copies of what it last drew (each update hands it a
  // fresh view).
  let modeNow = view.mode;
  let selectedNow = view.selected;
  // The first view: the 2D module holds the cells one frame back until
  // this view is up and half seen, then lets go, and this view flips them
  // into the frame, slowly, once.
  let introArmed = opts.intro && view.holding;
  let holdingNow = introArmed;
  // What each tile's front face shows.
  const shown = Uint8Array.from(rows[introArmed ? Math.max(0, frameNow - 1) : frameNow].bits);
  /** Each tile's turn, 0 to pi; the back face holds the frame's bit. */
  const angle = new Float32Array(72);
  const probe = { builds: 0, played: 0, flips: 0, pose: FRONT, zoom: 1, frontPoints: () => /** @type {number[][]} */ ([]), shown, angle, ringed: 0, chip: "",
    /** Each tile's front face colour and what it should be, 0xRRGGBB. */
    faces: () => /** @type {{drawn: number, wanted: number}[]} */ ([]) };
  if (TEST_HOOK) TEST_HOOK.figures["bits-3d"] = probe;

  /** The scene's parts, set by build(). */
  /** @type {any} */
  let parts = null;
  /** @type {ThreeContext | null} */
  let ctxRef = null;

  // The frame's inner box, rounded as setupCanvas() rounds the 2D canvas,
  // so both views lay the cells out for the same size.
  const size = () => {
    const r = frame.getBoundingClientRect();
    return { width: Math.max(1, Math.round(r.width - frame.clientLeft * 2)), height: Math.max(1, Math.round(r.height - frame.clientTop * 2)) };
  };
  /** CSS px of the frame to scene units: x and y each over -1 to 1. */
  const sx = (/** @type {number} */ px) => (px / size().width) * 2 - 1;
  const sy = (/** @type {number} */ py) => 1 - (py / size().height) * 2;
  const ux = (/** @type {number} */ px) => (px / size().width) * 2;
  const uy = (/** @type {number} */ py) => (py / size().height) * 2;

  /** @param {Rect} r @param {number} grow @param {number} z */
  const rectSegments = (r, grow, z) => {
    const x0 = sx(r.x - grow);
    const x1 = sx(r.x + r.w + grow);
    const y0 = sy(r.y - grow);
    const y1 = sy(r.y + r.h + grow);
    return [x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z];
  };

  /** The tile face colour for bit `v` at position `n`, turned by `a`. */
  const faceColour = (/** @type {number} */ v, /** @type {number} */ n, /** @type {number} */ a) => {
    const base = modeNow === "rate" ? rampColor(model.rateNorm[n])
      : tokenHex(v ? "--ambe-data-1" : "--ambe-surface-2");
    return a > 0 && a < Math.PI ? mix(base, tokenHex("--ambe-plot-bg"), TURN_SHADE * Math.sin(a)) : base;
  };
  const digitColour = (/** @type {number} */ v, /** @type {number} */ n) =>
    modeNow === "value" && !v ? tokenHex("--ambe-text-4") : inkOn(faceColour(v, n, 0));

  /** Write one tile's matrices and colours. @param {number} n */
  const writeTile = (n) => {
    if (!parts) return;
    const { body, faces, digits, cells, m, local, colour } = parts;
    const r = cells[n];
    const a = angle[n];
    const next = rows[frameNow].bits[n];
    // While it turns, a tile comes forward and widens a little, and its
    // near edge grows as its far edge shrinks: a perspective of its own,
    // in the instance matrix (w = 1 - z sin(a) / eye), since the camera is
    // orthographic. At rest the matrix is affine and the tile lies flat.
    const lift = Math.sin(a);
    const eye = uy(r.h) * EYE;
    m.persp.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -lift / eye, 1);
    const turn = m.turn.makeRotationX(a).premultiply(m.lift.makeScale(1 + LIFT * lift, 1, 1))
      .premultiply(m.persp)
      .premultiply(m.at.makeTranslation(sx(r.x + r.w / 2), sy(r.y + r.h / 2), lift * 0.02));
    body.setMatrixAt(n, m.out.multiplyMatrices(turn, local.body));
    // The tile's edge takes the highlight while it turns.
    body.setColorAt(n, colour.setHex(mix(tokenHex("--ambe-3d-grid"), tokenHex("--ambe-highlight"), Math.min(1, lift * 1.5))));
    // Instance n is the front face, 72 + n the back face.
    for (const [i, face, v] of /** @type {[number, any, number][]} */ ([[n, local.front, shown[n]], [72 + n, local.back, next]])) {
      faces.setMatrixAt(i, m.out.multiplyMatrices(turn, face));
      faces.setColorAt(i, colour.setHex(faceColour(v, n, a)));
      const glyphLocal = i < 72 ? local.frontGlyph : local.backGlyph;
      for (const d of [0, 1]) {
        const mesh = digits[d];
        if (d === v && parts.digitsOn) {
          mesh.setMatrixAt(i, m.out.multiplyMatrices(turn, glyphLocal));
          mesh.setColorAt(i, colour.setHex(digitColour(v, n)));
        } else {
          mesh.setMatrixAt(i, m.zero);
        }
      }
    }
  };
  const flush = () => {
    if (!parts) return;
    for (const mesh of [parts.body, parts.faces, ...parts.digits]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    ctxRef?.requestRender();
  };
  const writeAll = () => {
    for (let n = 0; n < 72; n += 1) writeTile(n);
    flush();
  };

  /** The backing: everything but the cells, from the 2D module. */
  const paintBacking = () => {
    if (!parts || !ctxRef) return;
    const T = ctxRef.three;
    const { width, height } = size();
    const scale = Math.min(Math.max(1, Math.min(window.devicePixelRatio || 1, 2)) * 1.5, 3, 4096 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    let texture = parts.backing.material.map;
    if (!texture || texture.image.width !== w || texture.image.height !== h) {
      texture?.dispose();
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      texture.premultiplyAlpha = true;
      texture.generateMipmaps = false;
      texture.minFilter = T.LinearFilter;
      parts.backing.material.map = texture;
      parts.backing.material.needsUpdate = true;
    }
    const canvas = /** @type {HTMLCanvasElement} */ (texture.image);
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    g.setTransform(w / width, 0, 0, h / height, 0, 0);
    view.backing(g, { width, height });
    texture.needsUpdate = true;
    ctxRef.requestRender();
  };

  /** The 3D view has drawn once: the chip may show (not over the 2D canvas). */
  let drawn = false;

  /**
   * The changed bits' outlines, each once its tile has landed, and the chip
   * once every tile has; the selected bit's ring.
   */
  const marks = () => {
    if (!parts) return;
    const { kit, ring, cells, title } = parts;
    const changed = model.changed[frameNow];
    const bits = rows[frameNow].bits;
    // Always 72 outlines, those not drawn parked far outside the view: the
    // renderer keeps the first instance count it draws a fat line with, so
    // a line that grows as tiles land would show only its first few.
    /** @type {number[]} */
    const segments = [];
    let pending = 0;
    let ringed = 0;
    for (let n = 0; n < 72; n += 1) {
      const turning = shown[n] !== bits[n] || angle[n] !== 0;
      if (turning) pending += 1;
      const drawn = changed[n] && !turning;
      if (drawn) ringed += 1;
      segments.push(...(drawn ? rectSegments(cells[n], RING_PX, 0.02) : PARKED));
    }
    // Held for the first-view flip: nothing is outlined until it runs.
    const on = view.flash && !holdingNow && model.changedCount[frameNow] > 0;
    kit.visible = on && ringed > 0;
    for (const line of parts.kitLines) setSegments(line, segments);
    probe.ringed = kit.visible ? ringed : 0;
    const text = `${model.changedCount[frameNow]} of 72 bits changed since the last frame`;
    const chipOn = on && !pending;
    probe.chip = chipOn ? text : "";
    if (kit.chip) {
      // In the 2D view's title line, which the backing leaves out in 3D:
      // the chip states a fact of the whole board, so it has no leader
      // (anim.css). createChip sets a chip 14 px above and right of its
      // anchor.
      const layer = /** @type {HTMLElement} */ (kit.chip.node.parentElement);
      layer.style.display = chipOn && drawn ? "" : "none";
      // Kept 6 px in from the frame's edge, or the chip pins to the edge.
      const bh = kit.chip.node.offsetHeight || 22;
      kit.chip.set({ text, at: [sx(Math.max(6, title.x - 14)), sy(title.y + bh + 14), 0.02] });
    }
    const s = view.selected;
    ring.visible = s >= 0;
    if (s >= 0) setSegments(ring, rectSegments(cells[s], 3, 0.03));
    ctxRef?.requestRender();
  };

  /** Lay the tiles, the board and the shadow out for the frame's size. */
  const relayout = () => {
    if (!parts || !ctxRef) return;
    const { width, height } = size();
    const { cells, block, title } = view.cells({ width, height });
    parts.cells = cells;
    parts.block = block;
    parts.title = title;
    const T = ctxRef.three;
    const t = uy(THICK_PX);
    const e = t * 0.08;
    const cell = cells[0];
    const w = ux(cell.w);
    const h = uy(cell.h);
    const fw = w - ux(2 * RIM_PX);
    const fh = h - uy(2 * RIM_PX);
    const S = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => new T.Matrix4().makeScale(x, y, z);
    const at = (/** @type {number} */ z) => new T.Matrix4().makeTranslation(0, 0, z);
    const flip = new T.Matrix4().makeRotationX(Math.PI);
    parts.local = {
      body: S(w, h, t),
      front: at(t / 2 + e).multiply(S(fw, fh, 1)),
      back: at(-t / 2 - e).multiply(flip).multiply(S(fw, fh, 1)),
      frontGlyph: at(t / 2 + 2 * e).multiply(S(w, h, 1)),
      backGlyph: at(-t / 2 - 2 * e).multiply(flip.clone()).multiply(S(w, h, 1)),
    };
    // The digits show when the 2D view shows them (cells of 20 px and up).
    parts.digitsOn = cell.w >= 20;
    // The board: the grid block and half a gap around it, grid lines in the gaps.
    const gap = cells[1].x - cells[0].x - cell.w;
    parts.board.position.set(sx(block.x - gap / 2), sy(block.y - gap / 2), 0);
    parts.board.scale.set(ux(block.w + gap), uy(block.h + gap), 1);
    writeAll();
    marks();
    paintBacking();
  };

  /** @param {ThreeContext} ctx */
  const build = (ctx) => {
    const T = ctx.three;
    probe.builds += 1;
    const unit = new T.PlaneGeometry(1, 1);
    // White: the instance colour is the edge's (--ambe-3d-grid at rest).
    const body = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial(), 72);
    const faces = new T.InstancedMesh(unit, new T.MeshBasicMaterial(), 144);
    const digits = ["0", "1"].map((d) => new T.InstancedMesh(unit, new T.MeshBasicMaterial({
      map: glyph(ctx, d), transparent: true, depthWrite: false,
    }), 144));
    for (const mesh of [body, faces, ...digits]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
    const tiles = new T.Group();
    tiles.add(body, faces, ...digits);
    tiles.userData.recolour = () => writeAll();

    // The shared floor, stood upright behind the tiles: (x, y, z) to
    // (x, -z, y), in a unit square that relayout() scales to the board.
    const board = new T.Group();
    const upright = new T.Group();
    upright.rotation.x = Math.PI / 2;
    upright.add(
      floor(ctx, { extent: { min: [0, Z_BOARD, 0], max: [1, Z_BOARD, 1] }, step: [1 / 8, 1 / 9] }),
      contactShadow(ctx, { x: [0, 1], z: [0, 1], y: Z_SHADOW - 1e-3 }),
    );
    board.add(upright);

    const backing = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    }));
    backing.position.z = Z_BACKING;
    backing.userData.recolour = () => paintBacking();
    ctx.track({ dispose: () => backing.material.map?.dispose() });

    const kit = addHighlight(ctx, [0, 0, 0.02, 0.1, 0, 0.02], { fill: false, chip: "" });
    const kitLines = kit.children.filter((c) => c.renderOrder >= 10);
    // No dashed outline of the plane: the highlight colour means only the
    // bits that changed.
    for (const c of kit.children) if (c.renderOrder < 10) c.visible = false;
    const ring = fatLines(ctx, [0, 0, 0, 0, 0, 0], "--ambe-plot-ink", 1.5, { depthTest: false });
    ring.renderOrder = 20;

    ctx.scene.add(backing, board, tiles, kit, ring);
    parts = { body, faces, digits, board, backing, kit, kitLines, ring, cells: [], block: null, title: null,
      local: null, digitsOn: true, colour: new T.Color(),
      m: { turn: new T.Matrix4(), lift: new T.Matrix4(), persp: new T.Matrix4(), at: new T.Matrix4(), out: new T.Matrix4(), zero: new T.Matrix4().makeScale(0, 0, 0) } };
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
  if (!ctx) {
    view.introDone();
    return null;
  }
  if (!introArmed) view.introDone();
  ctxRef = ctx;
  ctx.onResize(relayout);

  const box = { min: /** @type {[number, number, number]} */ ([-1, -1, -1]), max: /** @type {[number, number, number]} */ ([1, 1, 1]) };
  const fitted = matchPlot(ctx, () => ({ x: 0, y: 0, ...size() }), box);
  /** @type {ReturnType<typeof createOrbit> | null} */
  let turn = null;
  const orbit = createOrbit(ctx, {
    target: fitted.target, fit: fitted.fit, distance: 6, zoom: opts.look.zoom || 1,
    presets: { front: FRONT }, start: "front", yaw: false, onDrag: opts.onDrag,
    onChange: () => {
      probe.zoom = turn?.zoom() ?? 1;
    },
  });
  turn = orbit;
  // Each tile's front face as drawn: the centre of its instance matrix,
  // projected through the camera, in CSS px of the frame.
  probe.faces = () => {
    const c = new ctx.three.Color();
    return Array.from({ length: 72 }, (_, n) => {
      parts?.faces.getColorAt(n, c);
      return { drawn: c.getHex(), wanted: faceColour(shown[n], n, 0) };
    });
  };
  probe.frontPoints = () => {
    const v = new ctx.three.Vector3();
    const mat = new ctx.three.Matrix4();
    const { width, height } = size();
    ctx.camera.updateMatrixWorld();
    if (!parts) return [];
    return Array.from({ length: 72 }, (_, n) => {
      parts.faces.getMatrixAt(n, mat);
      v.set(0, 0, 0).applyMatrix4(mat).applyMatrix4(parts.faces.matrixWorld).project(ctx.camera);
      return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
    });
  };

  // Hover and tap pick a bit, as on the 2D canvas.
  /** @param {PointerEvent} event */
  const onPointer = (event) => {
    const canvas = ctx.renderer?.domElement;
    if (event.target !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    const v = new ctx.three.Vector3(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
      0,
    ).unproject(ctx.camera);
    const { width, height } = size();
    view.pick(((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height);
  };
  const listen = { signal: ctx.viewSignal };
  frame.addEventListener("pointermove", onPointer, listen);
  frame.addEventListener("pointerdown", onPointer, listen);
  frame.addEventListener("pointerleave", () => view.pick(-1, -1), listen);

  const timeline = ctx.timeline();

  /**
   * Turn the tiles whose face differs from `frameNow` over, staggered by
   * position. Every step is idempotent (the timeline repeats t = 0 and 1).
   * @param {"intro" | "step" | "play"} pace
   */
  const flipTo = (pace) => {
    const next = rows[frameNow].bits;
    /** @type {number[]} */
    const list = [];
    for (let n = 0; n < 72; n += 1) if (shown[n] !== next[n]) list.push(n);
    // While the clip plays (10 frames a second) the tiles turn at once: a
    // half turn in under 100 ms would only blur them. A step, a scrub and
    // the first view show the turn.
    if (!list.length || pace === "play") {
      for (const n of list) shown[n] = next[n];
      writeAll();
      marks();
      return Promise.resolve();
    }
    marks();
    probe.flips += 1;
    const count = list.length;
    const ms = pace === "intro" ? INTRO_MS : duration("slow");
    return timeline.play("flip", {
      ms,
      count,
      stagger: pace === "intro" ? Math.max(0, INTRO_WAVE_MS - ms) / Math.max(1, count - 1) : duration("slow") / 12,
      ease: "inout",
      step: (t, i) => {
        const n = list[i];
        const landed = t >= 1;
        if (landed) shown[n] = next[n];
        angle[n] = landed ? 0 : Math.PI * t;
        writeTile(n);
        flush();
        if (landed) marks();
      },
    }).then(() => {
      marks();
      void parts?.kit.pulse();
    });
  };

  // However the view ends, the 2D module is never left holding the clip.
  ctx.viewSignal.addEventListener("abort", () => view.introDone(), { once: true });

  await ctx.drawn();
  drawn = true;
  marks();
  return {
    update: (next) => {
      const was = { frame: frameNow, mode: modeNow, selected: selectedNow, holding: holdingNow };
      view = /** @type {BitsView} */ (next);
      frameNow = view.frame;
      modeNow = view.mode;
      selectedNow = view.selected;
      holdingNow = view.holding;
      if (modeNow !== was.mode) writeAll();
      if (was.holding && !holdingNow && frameNow === was.frame) {
        // The hold lets go: the tiles show the frame before; flip them in.
        timeline.finish();
        const pace = introArmed ? "intro" : "step";
        if (introArmed) probe.played += 1;
        introArmed = false;
        void flipTo(pace).finally(() => view.introDone());
        paintBacking();
      } else if (frameNow !== was.frame) {
        timeline.finish();
        // The flip shows the bits that changed into this frame, the set the
        // outlines and the chip name: a step back or a scrub first sets the
        // tiles to the frame before it.
        if (frameNow !== was.frame + 1) {
          shown.set(rows[Math.max(0, frameNow - 1)].bits);
          angle.fill(0);
          writeAll();
        }
        introArmed = false;
        void flipTo(view.playing ? "play" : "step");
        paintBacking();
      } else {
        marks();
        // The backing changes with the frame and the inspected bit only.
        if (selectedNow !== was.selected) paintBacking();
      }
    },
    preset: (name) => void orbit.go(name),
    describe: () => view.label,
    close: () => ctx.dispose(),
  };
}
