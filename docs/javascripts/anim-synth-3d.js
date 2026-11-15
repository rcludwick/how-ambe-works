// @ts-check
/* ===========================================================================
 * anim-synth-3d.js: the synth figure's 3D view (ch11), loaded on request by
 * anim-synth.js through lib/view-switch.js.
 * ---------------------------------------------------------------------------
 * The spectrum panel through time: x frequency (0 to 4 kHz), y level (dBFS),
 * depth one slice per 20 ms frame, twelve on each side of the selected one,
 * earlier frames behind. Each slice is split by generator: a stick per
 * harmonic in --ambe-voiced where the band was measured voiced, a block of
 * shaped noise in --ambe-unvoiced where it was not, a dot at each stick's
 * tip, and the measured spectrum of the decoded audio as a line. The
 * band-owner ribbon is drawn twice, along the top of the selected slice
 * (seen from Front) and as floor tiles under every slice (seen from Top).
 * No ramp: voiced and unvoiced are the categories here (VL1).
 *
 * Opening (once, on first view): "Each frame's spectrum is built from two
 * generators, chosen band by band." The selected slice starts with both
 * generators in every band, each named by a label; band by band, low to
 * high, the one not chosen sinks to the floor. Then the ribbon draws (and
 * is named), the highlight's fill comes up under the measured spectrum,
 * and the neighbours slide back out of the slice to their 20 ms places
 * while the camera turns from Front to Corner. The frame is held a moment
 * longer before playback may start. The end state carries the same
 * picture with no motion.
 *
 * The selected slice's sticks and blocks draw over the highlight's fill
 * (depthTest off, between the fill and the line), so the split is what the
 * eye follows. Below 60 degrees of pitch the slices in front of it keep
 * only their floor tiles (the cutaway rule): their sticks, blocks and
 * spectra would cross the selected one and the level axis.
 *
 * Front at zoom 1 is the flat spectrum panel anim-synth.js draws: the fit
 * puts the selected slice on its plot rectangle, and other poses shrink
 * that rectangle just enough for the depth to fit. This part takes the 2D
 * module's arrays and computes no model data. MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK, onFinishAll } from "./anim-core.js";
import { mountThree } from "./anim-three.js";
import { FRONT, TOP, createOrbit, frontFrustum } from "./lib/orbit.js";
import { addHighlight } from "./lib/highlight.js";
import { createLabels } from "./lib/labels.js";
import { toScene } from "./lib/scene.js";
import { contactShadow, darkGround, fadeAmount, fatLines, floor, fog, mix, setSegments, tokenHex } from "./lib/style.js";
import { BANDS, BAND_HZ, DB_FLOOR, DB_TOP, NYQUIST, linToDb, weights } from "./lib/synth-model.js";

/** @typedef {import("./anim-synth.js").SynthState} SynthState */
/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */

const SIDE = 12; // neighbours on each side
const DZ = 0.1; // scene units between slices
const EXT = { x: 2, y: 1, z: 2 * SIDE * DZ };
const MAP = toScene({ x: [0, NYQUIST], y: [DB_FLOOR, DB_TOP], z: [-SIDE, SIDE] }, EXT);
const Y0 = MAP.box.min[1];
const Y1 = MAP.box.max[1];
/** The flat panel's plot height the px sizes below are taken at. */
const REF_PX = 320;
const px = (/** @type {number} */ n) => (n / REF_PX) * EXT.y;
const BLOCK = px(16); // a noise block's fill, 16 px deep as in the flat view
const RIBBON = px(4);
const DISTANCE = 6;
const CUT_PITCH = 60;
/** Tokens a vertex colour is mixed from, by index. */
const TOKENS = ["--ambe-voiced", "--ambe-unvoiced", "--ambe-plot-muted", "--ambe-plot-ink"];
const [VOICED, UNVOICED, MUTED] = [0, 1, 2];

/** @type {Record<string, import("./lib/orbit.js").Pose>} */
const PRESETS = { corner: { yaw: 32, pitch: 24 }, front: FRONT, top: TOP };
/** The opening's tracks, in ms from the frame being half in view. */
const OPEN = {
  split: { delay: 100, ms: 480, stagger: 60 },
  ribbon: { delay: 950, ms: 220, stagger: 20 },
  stack: { delay: 1300, ms: 650, stagger: 18 },
  /** How long the split frame is held after the turn before playback may start. */
  hold: 400,
};
/** Behind the selected slice, how many earlier frames keep their measured spectrum (light, dark). */
const MEASURED_BACK = { light: 3, dark: SIDE };
/** How far the highlight's fill is mixed toward the plot background, so the generators show through it. */
const FILL_SOFTEN = 0.5;
/** Where the chip is pinned: the top edge of the selected slice's outline, 250 Hz in. */
const CHIP_AT = /** @type {[number, number, number]} */ ([MAP.x(250), Y1, 0]);

/** @param {number} t */
const easeOut = (t) => 1 - (1 - t) ** 3;
/** @param {number} t */
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Positions with one colour recipe per vertex: a token, the distance from
 * the selected slice, and an extra mix toward the plot background.
 */
class Batch {
  constructor() {
    /** @type {number[]} */ this.pos = [];
    /** @type {number[]} */ this.tok = [];
    /** @type {number[]} */ this.dl = [];
    /** @type {number[]} */ this.ex = [];
  }
  /** @param {number} x @param {number} y @param {number} z @param {number} tok @param {number} d @param {number} e */
  v(x, y, z, tok, d, e) {
    this.pos.push(x, y, z);
    this.tok.push(tok);
    this.dl.push(d);
    this.ex.push(e);
  }
  /**
   * Two triangles: upright in the plane z = za when za equals zb (ya to
   * yb), else flat at y = ya from za to zb.
   * @param {number} x0 @param {number} x1 @param {number} ya @param {number} yb
   * @param {number} za @param {number} zb @param {number} tok @param {number} d @param {number} e
   */
  quad(x0, x1, ya, yb, za, zb, tok, d, e) {
    const c = za === zb
      ? [[x0, ya, za], [x1, ya, za], [x1, yb, za], [x0, yb, za]]
      : [[x0, ya, za], [x1, ya, za], [x1, ya, zb], [x0, ya, zb]];
    for (const i of [0, 1, 2, 0, 2, 3]) this.v(c[i][0], c[i][1], c[i][2], tok, d, e);
  }
  /** 0xRRGGBB per vertex, from the tokens now (the fade looked up once per distance). */
  colours() {
    const bg = tokenHex("--ambe-plot-bg");
    const base = TOKENS.map(tokenHex);
    const keep = Array.from({ length: SIDE + 1 }, (_, d) => 1 - fadeAmount(d));
    /** @type {Map<number, number>} */
    const memo = new Map();
    return this.tok.map((t, i) => {
      const amount = 1 - keep[Math.min(SIDE, Math.abs(this.dl[i]))] * (1 - this.ex[i]);
      const key = t * 4096 + Math.round(amount * 4000);
      let hex = memo.get(key);
      if (hex === undefined) memo.set(key, (hex = mix(base[t], bg, amount)));
      return hex;
    });
  }
}

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  let s = /** @type {SynthState} */ (opts.state);
  /** Opening progress: the band choice per band, the ribbon per band, the stack by |Δ|. */
  // The opening starts from its first picture: both generators in every
  // band, no ribbon, the neighbours inside the slice.
  const split = new Float32Array(BANDS).fill(opts.intro ? 0 : 1);
  const ribbon = new Float32Array(BANDS).fill(opts.intro ? 0 : 1);
  const stack = new Float32Array(SIDE + 1).fill(opts.intro ? 0 : 1);
  stack[0] = 1;
  let pitch = PRESETS[s.preset]?.pitch ?? 0;
  /** 0 at Front, where the neighbours are hidden and the slice is the flat panel; 1 once turned. */
  let away = 1;
  const probe = { builds: 0, pose: { yaw: 0, pitch: 0 }, zoom: 1, frontPoints: /** @type {number[][]} */ ([]), played: 0,
    tips: /** @type {{f: number, db: number}[]} */ ([]), plotRect: s.plotRect, draws: 0 };

  /** @type {Record<string, any>} */
  let o = {};
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  /** The opening's own labels, while it runs. @type {ReturnType<typeof createLabels> | null} */
  let intro = null;
  /** @type {{running: boolean, layer: HTMLElement | null}} */
  const opening = { running: Boolean(opts.intro), layer: null };
  /** The highlight's fill coming up under the measured spectrum: 0 hidden, 1 at rest. */
  let fillIn = opts.intro ? 0 : 1;

  /** @param {ThreeContext} ctx */
  const build = (ctx) => {
    const T = ctx.three;
    probe.builds += 1;
    const box = MAP.box;
    ctx.scene.add(floor(ctx, { extent: box, step: [MAP.x(1000) - MAP.x(0), 5 * DZ] }));
    ctx.scene.add(contactShadow(ctx, { x: [-1, 1], z: [-0.35, 0.35], y: Y0 }));
    // The back wall's level grid, at the dB ticks.
    const wall = [];
    for (const db of [-80, -60, -40, -20]) wall.push(-1, MAP.y(db), box.min[2], 1, MAP.y(db), box.min[2]);
    const wallGeo = new T.BufferGeometry();
    wallGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(wall), 3));
    ctx.scene.add(new T.LineSegments(wallGeo, ctx.paint(new T.LineBasicMaterial(), "--ambe-3d-grid")));
    fog(ctx, DISTANCE, EXT.z);

    /** @param {Batch} b @param {number} w @param {boolean} [f] @param {boolean} [depthTest] */
    const line = (b, w, f = true, depthTest = true) => {
      const l = fatLines(ctx, [0, 0, 0, 0, 0, 0], () => [0, 0], w, { fog: f, depthTest });
      l.userData.batch = b;
      ctx.scene.add(l);
      return l;
    };
    /** @param {boolean} f @param {number} [order] drawn after the highlight's fill, over it */
    const mesh = (f, order) => {
      const m = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({
        vertexColors: true, side: T.DoubleSide, fog: f, polygonOffset: !order, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        depthTest: !order,
      }));
      m.frustumCulled = false;
      m.renderOrder = order ?? 0;
      ctx.scene.add(m);
      return m;
    };
    // The selected slice draws after the highlight's fill (order 0) and
    // before its line (10 and up), over the fill: fill 4, lines 5, dots 6.
    o = {
      tiles: mesh(true), fillsBack: mesh(true), fillsFront: mesh(true), selFill: mesh(false, 4),
      context: line(new Batch(), 1.25), measured: line(new Batch(), 1.25), selected: line(new Batch(), 1.75, false, false),
    };
    o.selected.renderOrder = 5;
    /** @param {boolean} depthTest */
    const dots = (depthTest) => {
      const d = new T.Points(new T.BufferGeometry(), new T.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, depthTest }));
      d.frustumCulled = false;
      ctx.scene.add(d);
      return d;
    };
    o.dots = dots(true);
    o.selDots = dots(false);
    o.selDots.renderOrder = 6;
    o.links = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ vertexColors: true }));
    o.links.frustumCulled = false;
    ctx.scene.add(o.links);
    // The selected frame's measured spectrum carries the highlight kit: its
    // fill hides the earlier frames behind it, its chip states the frame.
    o.highlight = addHighlight(ctx, curve(), { baseline: Y0, top: Y1, chip: chipText() });
    ctx.scene.add(o.highlight);
    soften(T, o.highlight);
    // A theme change recolours every vertex; the light theme also keeps
    // fewer earlier spectra, so a change of ground rebuilds.
    const watch = new T.Object3D();
    let dark = darkGround();
    watch.userData.recolour = () => {
      if (darkGround() !== dark) later();
      dark = darkGround();
    };
    ctx.scene.add(watch);
    labels?.dispose();
    labels = createLabels(frame, ctx);
    /** @type {import("./lib/labels.js").Label[]} */
    const list = [0, 1000, 2000, 3000, 4000].map((f) => ({
      text: f ? String(f / 1000) : "0 kHz", at: [MAP.x(f), Y0, 0], align: "middle", dy: 12, tick: true,
    }));
    // The unit rides on the top tick, so the row above the plot is the chip's.
    for (const db of [-80, -60, -40, -20]) {
      list.push({ text: db === -20 ? "-20 dBFS" : String(db), at: [-1, MAP.y(db), 0], align: "end", tick: true, along: [0, 1, 0] });
    }
    // The stack's name, right of the floor; a phone's frame has no room for it.
    if (frame.clientWidth >= 480) {
      list.push({ text: "earlier frames,\n20 ms apart", at: [1.04, Y0, box.min[2] * 0.3], align: "start", along: [0, 0, 1] });
    }
    labels.set(list);
    ctx.track({ dispose: () => labels?.dispose() });
    intro?.dispose();
    intro = null;
    if (opening.running) {
      intro = createLabels(frame, ctx);
      const layer = /** @type {HTMLElement} */ (frame.lastElementChild);
      layer.classList.add("synth-intro-labels");
      intro.set(introList());
      opening.layer = layer;
      ctx.track({ dispose: () => intro?.dispose() });
    }
    rebuild(ctx);
  };

  /** The opening's labels: the two generators, then the ribbon once it draws. */
  const introList = () => {
    // Both in the empty upper part of the plot: the sticks' name beside the
    // low bands, the blocks' name over the high bands, where the spectrum
    // of a frame is low.
    /** @type {import("./lib/labels.js").Label[]} */
    const list = [
      { text: "oscillator bank (sticks)", at: [MAP.x(560), MAP.y(-30), 0], align: "start" },
      { text: "shaped noise (blocks)", at: [MAP.x(3250), MAP.y(-56), 0], align: "middle" },
    ];
    if (ribbon[0] > 0) list.push({ text: "which generator owns each band", at: [MAP.x(NYQUIST), Y1 - RIBBON, 0], align: "end", dy: 14 });
    return list;
  };

  /**
   * The highlight's fill, mixed toward the plot background (FILL_SOFTEN, and
   * fully while the opening's split runs), so the generators show through.
   * @param {import("./anim-three.js").THREE} T
   * @param {import("three").Group} group
   */
  const soften = (T, group) => {
    const fill = /** @type {import("three").Mesh | undefined} */ (group.children.find((c) => c instanceof T.Mesh));
    if (!fill) return;
    o.fill = fill;
    const own = fill.userData.recolour;
    const bg = new T.Color();
    fill.userData.recolour = () => {
      own?.();
      const k = FILL_SOFTEN + (1 - FILL_SOFTEN) * (1 - fillIn);
      bg.setHex(tokenHex("--ambe-plot-bg"));
      const attribute = fill.geometry.getAttribute("color");
      for (let i = 0; i < attribute.count; i += 1) {
        attribute.setXYZ(i, attribute.getX(i) + (bg.r - attribute.getX(i)) * k,
          attribute.getY(i) + (bg.g - attribute.getY(i)) * k, attribute.getZ(i) + (bg.b - attribute.getZ(i)) * k);
      }
      attribute.needsUpdate = true;
    };
    fill.userData.recolour();
  };

  /** The selected frame's measured spectrum, flat x, y, z at z = 0. */
  const curve = () => {
    const row = s.measured(s.frame);
    return row.flatMap((db, j) => [MAP.x((j * NYQUIST) / row.length), MAP.y(Math.max(DB_FLOOR, db)), 0]);
  };

  const chipText = () => {
    const m = s.model(s.frame);
    const f0 = m.f0 > 0 ? `${m.f0.toFixed(1)} Hz` : "no pitch";
    return `this frame: ${f0}, ${m.voicedBand.filter(Boolean).length} of ${BANDS} bands voiced`;
  };

  /**
   * Every slice from the state and the opening's progress.
   * @param {ThreeContext} ctx
   */
  const rebuild = (ctx) => {
    const T = ctx.three;
    const w = weights(s.mix);
    const cut = pitch < CUT_PITCH;
    const dark = darkGround();
    const back = dark ? MEASURED_BACK.dark : MEASURED_BACK.light;
    const B = { context: new Batch(), measured: new Batch(), selected: new Batch(), tiles: new Batch(), fillsBack: new Batch(),
      fillsFront: new Batch(), selFill: new Batch(), dots: new Batch(), selDots: new Batch(), links: new Batch() };
    /** @type {{d: number, marks: Map<number, number[]>}[]} tips per slice, by harmonic number */
    const tips = [];
    probe.tips = [];
    const gap = px(1.5);
    for (let d = -SIDE; d <= SIDE; d += 1) {
      const i = s.frame + d;
      const ad = Math.abs(d);
      const grow = stack[ad];
      const show = d === 0 ? 1 : grow * away;
      if (i < 0 || i >= s.frames || show < 0.02) continue;
      const z = MAP.z(d) * easeOut(grow);
      const sel = d === 0;
      // Below 60 degrees of pitch a slice in front of the selected one keeps
      // only its floor tiles (the cutaway rule). A sliding neighbour fades
      // in, and all of them fade out near Front.
      const tilesOnly = cut && d > 0;
      const ex = 1 - show;
      const m = s.model(i);
      const lines = sel ? B.selected : B.context;
      const dots = sel ? B.selDots : B.dots;
      const lv = (/** @type {number} */ a) => MAP.y(Math.min(DB_TOP, linToDb(a)));
      // Before the choice (split 0) every band has both generators; the one
      // not chosen sinks to the floor and fades as its band's split runs.
      /** @param {number} band @param {boolean} chosen */
      const sink = (band, chosen) => (chosen ? 0 : easeOut(sel ? split[band] : 1));
      /** @type {Map<number, number[]>} */
      const marks = new Map();
      for (const h of tilesOnly ? [] : m.harmonics) {
        const down = sink(h.band, h.voiced);
        const a = h.voiced ? h.amp * w.v : h.amp;
        if (down >= 1 || linToDb(a) <= DB_FLOOR) continue;
        const y = Y0 + (lv(a) - Y0) * (1 - down);
        const x = MAP.x(h.f);
        const e = Math.max(ex, down);
        lines.v(x, Y0, z, VOICED, d, e);
        lines.v(x, y, z, VOICED, d, e);
        if (!h.voiced) continue;
        dots.v(x, y, z, VOICED, d, ex);
        marks.set(h.k, [x, y, z]);
        if (sel) probe.tips.push({ f: MAP.invert.x(x), db: MAP.invert.y(y) });
      }
      tips.push({ d, marks });
      for (const nb of tilesOnly ? [] : m.bandNoise) {
        const voiced = m.voicedBand[nb.band];
        const down = sink(nb.band, !voiced);
        const a = nb.amp * (voiced ? 1 : w.u);
        if (down >= 1 || linToDb(a) <= DB_FLOOR) continue;
        const y = Y0 + (lv(a) - Y0) * (1 - down);
        const x0 = MAP.x(nb.lo) + gap;
        const x1 = MAP.x(nb.hi) - gap;
        const e = Math.max(ex, down);
        lines.v(x0, y, z, UNVOICED, d, e);
        lines.v(x1, y, z, UNVOICED, d, e);
        const fills = sel ? B.selFill : d > 0 ? B.fillsFront : B.fillsBack;
        fills.quad(x0, x1, y, Math.max(Y0, y - BLOCK), z, z, UNVOICED, d, 1 - (1 - e) * (sel ? 0.45 : 0.2));
      }
      // The band-owner ribbon: floor tiles under every slice, and along the
      // top of the selected one, drawing in band by band in the opening.
      // The tiles are a map read from above: near their token colour from
      // Top, and toward the plot background with distance at other poses
      // (more in dark, where full teal and amber would outshine the slice).
      const tile = sel ? 0.05 : !cut ? (dark ? 0.15 : 0) : (dark ? 0.4 : 0.12) + 0.22 * (ad / SIDE);
      for (let b = 0; b < BANDS; b += 1) {
        const owner = m.voicedBand[b] ? VOICED : UNVOICED;
        const x0 = MAP.x(b * BAND_HZ) + gap;
        const span = (MAP.x((b + 1) * BAND_HZ) - gap - x0) * (sel ? ribbon[b] : 1);
        if (span <= 0) continue;
        B.tiles.quad(x0, x0 + span, Y0 + 1e-3, Y0 + 1e-3, z - DZ * 0.4, z + DZ * 0.4, owner, 0, 1 - (1 - tile) * show);
        if (sel) B.tiles.quad(x0, x0 + span, Y1, Y1 - RIBBON, z, z, owner, 0, 0.05);
      }
      if (s.overlay && !sel && !tilesOnly && d >= -back) {
        const row = s.measured(i);
        for (let k = 0; k + 1 < row.length; k += 1) {
          for (const j of [k, k + 1]) B.measured.v(MAP.x((j * NYQUIST) / row.length), MAP.y(Math.max(DB_FLOOR, row[j])), z, MUTED, d, ex);
        }
      }
    }
    // Thin muted links join the same harmonic number on neighbouring slices,
    // so a pitch change shows harmonic l moving l times as far.
    for (let j = 0; j + 1 < tips.length; j += 1) {
      const [a, b] = [tips[j], tips[j + 1]];
      if (b.d - a.d !== 1) continue;
      const far = Math.max(Math.abs(a.d), Math.abs(b.d));
      for (const [k, p] of a.marks) {
        const q = b.marks.get(k);
        if (!q) continue;
        B.links.v(p[0], p[1], p[2], MUTED, far, 0.35);
        B.links.v(q[0], q[1], q[2], MUTED, far, 0.35);
      }
    }
    const fat = /** @type {const} */ (["context", "measured", "selected"]);
    for (const name of fat) {
      const b = B[name];
      const l = o[name];
      l.visible = b.pos.length > 0;
      if (!l.visible) continue;
      l.userData.batch = b;
      setSegments(l, b.pos);
      l.userData.recolour = () => {
        const colour = new T.Color();
        const hexes = l.userData.batch.colours();
        const rgb = new Float32Array(hexes.length * 3);
        hexes.forEach((/** @type {number} */ h, /** @type {number} */ k) => rgb.set(colour.setHex(h).toArray(), k * 3));
        l.geometry.setColors(rgb);
      };
      l.userData.recolour();
    }
    for (const name of /** @type {const} */ (["tiles", "fillsBack", "fillsFront", "selFill", "dots", "selDots", "links"])) put(T, o[name], B[name]);
    // The slice's outline and chip mark the selected frame whatever the
    // overlay; the overlay shows or hides its measured spectrum (the line,
    // its glow and its fill).
    const hl = o.highlight;
    hl.set(curve());
    hl.chip?.set({ at: CHIP_AT });
    for (const child of hl.children) {
      const outline = Boolean(/** @type {any} */ (child).material?.dashed);
      child.visible = outline || (s.overlay && (child !== o.fill || fillIn > 0.02));
    }
    o.fill?.userData.recolour?.();
    probe.frontPoints = project(ctx);
    ctx.requestRender();
  };

  /**
   * Screen px, in the frame, of the selected slice's stick tips.
   * @param {ThreeContext} c
   * @returns {number[][]}
   */
  const project = (c) => probe.tips.map(({ f, db }) => {
    const v = new c.three.Vector3(MAP.x(f), MAP.y(db), 0).project(c.camera);
    return [((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight];
  });

  /**
   * Positions and vertex colours into a mesh or points.
   * @param {import("./anim-three.js").THREE} T
   * @param {any} object
   * @param {Batch} b
   */
  const put = (T, object, b) => {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(new Float32Array(b.pos), 3));
    const recolour = () => {
      const colour = new T.Color();
      const hexes = b.colours();
      const rgb = new Float32Array(hexes.length * 3);
      hexes.forEach((h, k) => rgb.set(colour.setHex(h).toArray(), k * 3));
      g.setAttribute("color", new T.BufferAttribute(rgb, 3));
    };
    recolour();
    object.geometry.dispose();
    object.geometry = g;
    object.userData.recolour = recolour;
  };

  const ctx = await mountThree(frame, {
    signal: opts.signal,
    label: "",
    build,
    camera: "orthographic",
    stage: opts.look.stage,
    wanted: opts.wanted,
    onPark: opts.onPark,
    onUnpark: opts.onUnpark,
  });
  if (!ctx) return null;

  /** The selected slice on the flat plot at Front, shrunk at other poses so the depth fits. */
  const fit = () => {
    const camera = /** @type {import("three").OrthographicCamera} */ (ctx.camera);
    const size = { width: frame.clientWidth, height: frame.clientHeight };
    if (!size.width || !size.height) return;
    const r = s.plotRect();
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const h = [EXT.x / 2, EXT.y / 2, EXT.z / 2];
    const across = h[0] * Math.abs(e[0]) + h[1] * Math.abs(e[1]) + h[2] * Math.abs(e[2]);
    const up = h[0] * Math.abs(e[4]) + h[1] * Math.abs(e[5]) + h[2] * Math.abs(e[6]);
    // A turned box's corners are emptier than its middle, so it may overrun
    // them a little; head-on (Front, Top) it fits exactly. On a wide frame
    // the plot rectangle runs nearly to the frame's edges, so the turned box
    // keeps a margin there instead (the floor's near corner and the back
    // wall's top ran out of the frame at 1280 px).
    const p = orbit?.pose() ?? PRESETS[start];
    const rad = Math.PI / 90;
    const turned = Math.abs(Math.sin(p.yaw * rad));
    const wide = size.width >= 480 ? 1 - 0.12 * turned : 1;
    const fx = wide * Math.min(1, ((1 + 0.2 * turned) * h[0]) / across);
    const fy = wide * Math.min(1, ((1 + 0.3 * Math.abs(Math.sin(p.pitch * rad))) * h[1]) / up);
    const rect = { x: r.x + (r.width * (1 - fx)) / 2, y: r.y + (r.height * (1 - fy)) / 2, width: r.width * fx, height: r.height * fy };
    Object.assign(camera, frontFrustum(size, rect, { min: [-1, Y0, 0], max: [1, Y1, 0] }));
  };

  // One rebuild per animation frame, however many items a track steps.
  let pending = false;
  const later = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      rebuild(ctx);
    });
  };

  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  const start = opts.intro ? "front" : s.preset in PRESETS ? s.preset : "corner";
  orbit = createOrbit(ctx, {
    target: [0, 0, 0], fit, distance: DISTANCE, zoom: opts.look.zoom || 1, presets: PRESETS, start,
    onDrag: opts.onDrag,
    onChange: () => {
      const pose = orbit?.pose() ?? PRESETS[start];
      probe.pose = pose;
      probe.zoom = orbit?.zoom() ?? 1;
      const next = Math.min(1, Math.max(Math.abs(pose.yaw) / 16, Math.abs(pose.pitch) / 12));
      if ((pose.pitch < CUT_PITCH) !== (pitch < CUT_PITCH) || Math.abs(next - away) > 0.004 || (next === 0) !== (away === 0)) later();
      away = next;
      pitch = pose.pitch;
      probe.frontPoints = project(ctx);
      labels?.update();
      intro?.update();
    },
  });

  // The canvas label, rebuilt 250 ms after the last change.
  let labelTimer = 0;
  const describe = () => {
    const m = s.model(s.frame);
    const voiced = m.voicedBand.filter(Boolean).length;
    const f0 = m.f0 > 0 ? `${m.f0.toFixed(1)} Hz` : "no pitch";
    return `3D spectra of frames ${Math.max(0, s.frame - SIDE)} to ${Math.min(s.frames - 1, s.frame + SIDE)}, ` +
      `one slice per 20 ms frame, earlier frames behind. The outlined slice is frame ${s.frame}: f0 ${f0}, ` +
      `${voiced} of ${BANDS} bands voiced, sticks for the harmonics of the voiced bands and noise blocks for the rest. ` +
      `Camera: ${s.preset}.`;
  };
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
  };
  ctx.renderer?.domElement.setAttribute("aria-label", describe());

  const hook = TEST_HOOK ? /** @type {Record<string, unknown>} */ (TEST_HOOK.figures) : null;
  if (hook) hook["synth-3d"] = Object.assign(probe, { sliceTips: () => probe.tips, orbit });

  if (opts.intro) probe.played += 1;
  // The first frame waits on the slot; a reader who leaves 3D before it
  // comes gets the context back at once rather than a view nobody holds.
  const drawn = ctx.drawn().then(() => true);
  while (!(await Promise.race([drawn, new Promise((resolve) => setTimeout(() => resolve(false), 100))]))) {
    if (!opts.wanted() || opts.signal.aborted) {
      clearTimeout(labelTimer);
      ctx.dispose();
      return null;
    }
  }
  // A finish (the tests' settle) lands the opening at once and skips the hold.
  let finished = false;
  let holding = 0;
  let over = false;
  /** The opening is over: its labels go, and playback may start. */
  const ended = () => {
    if (over) return;
    over = true;
    clearTimeout(holding);
    opening.running = false;
    intro?.dispose();
    intro = null;
    opening.layer = null;
    s.introDone();
  };
  const offFinish = onFinishAll(() => {
    finished = true;
    if (holding) ended();
  });
  // The opening starts once its first picture (both generators in every
  // band) is on screen: the first draw compiles the shaders, and a track
  // started before it would be half over when it is first seen.
  const play = () => {
    if (ctx.viewSignal.aborted) return ended();
    const tl = ctx.timeline();
    const to = PRESETS[s.preset] ?? PRESETS.corner;
    const ends = [
      tl.play("split", { ...OPEN.split, count: BANDS, build: true, step: (t, b) => { split[b] = t; later(); } }),
      tl.play("ribbon", {
        ...OPEN.ribbon, count: BANDS, build: true,
        step: (t, b) => {
          const named = ribbon[0] > 0;
          ribbon[b] = t;
          fillIn = ribbon.reduce((a, r) => a + r, 0) / BANDS;
          if (!named && ribbon[0] > 0) intro?.set(introList());
          later();
        },
      }),
      tl.play("stack", {
        ...OPEN.stack, count: SIDE + 1, ease: "linear", build: true,
        step: (t, k) => {
          if (k === 0) {
            if (t > 0 && opening.layer) opening.layer.dataset.gone = "";
            const u = easeInOut(t);
            orbit?.set({ yaw: to.yaw * u, pitch: to.pitch * u });
          } else stack[k] = t;
          later();
        },
      }),
    ];
    // Playback waits for the whole opening, then holds the split frame a
    // moment longer, so the turn is seen around the frame just split. A
    // finish (a test, a park) lands every track at once and skips the hold.
    void Promise.all(ends).then(() => {
      if (ctx.viewSignal.aborted || !orbit) return ended();
      if (finished) ended();
      else holding = window.setTimeout(ended, OPEN.hold);
    });
  };
  if (opts.intro) requestAnimationFrame(() => requestAnimationFrame(play));
  else ended();

  return {
    update: (next) => {
      const was = s.frame;
      s = /** @type {SynthState} */ (next);
      rebuild(ctx);
      o.highlight?.chip?.set({ text: chipText() });
      if (was !== s.frame && !s.playing()) void o.highlight?.pulse();
      relabel();
    },
    preset: (name) => {
      s = { ...s, preset: name };
      void orbit?.go(name);
      relabel();
    },
    describe,
    close: () => {
      offFinish();
      clearTimeout(labelTimer);
      ctx.dispose();
    },
  };
}
