// @ts-check
/* ===========================================================================
 * anim-complex-3d.js: the complex figure's 3D view (three-everywhere §4.5).
 * ---------------------------------------------------------------------------
 * The rotating point drawn through time. The turns of the point run along
 * +x, its imaginary part along +y and its real part along -z, so the point's
 * path is a helix. Its shadow on the floor is the real part against turns,
 * a cosine; its shadow on the back wall is the imaginary part, the same
 * wave a quarter turn later. A now-plane at the point's turn holds the
 * point, its radius and the unit circle.
 *
 * Presets: End on (yaw 90) is the 2D circle panel, Real part (pitch 90) the
 * 2D wave panel, Imaginary part (yaw 0) the wave of y, and Corner shows the
 * helix whole. End on, Real part and Imaginary part put the scene on the 2D
 * plots' own rectangles (lib/orbit.js frontFrustum); between them the fit
 * eases to a view of the whole box. Each preset hides what it sees edge on.
 *
 * The companions: at those three presets the other 2D panel is drawn flat
 * in its own 2D place, turned to face the camera, so the circle and its
 * wave are on screen together, as in 2D. Real part and Imaginary part show
 * the circle panel (the point, its radius, x and y); End on shows the wave
 * panel. They fade in over the last 8 degrees of a camera move, while the
 * frustum eases to the 2D rectangle over the last 25.
 *
 * Its one animation (VL6): "A sine wave is the shadow of a point going
 * round a circle." End on, the point makes one full turn while the first
 * turn of the wave draws in the wave panel beside it; then the camera turns
 * to the corner while the second turn draws out, so the circle opens into a
 * helix with the cosine on its floor and the sine on its wall; it holds
 * there, the highlight pulsing, and only then moves to the step's preset if
 * that differs (step 1's Real part, where the helix lies down onto its
 * floor shadow). A step that traces two turns draws the helix out again.
 *
 * It computes no model data: every curve comes from helix() and curves() in
 * anim-complex.js, and only its scene coordinates are worked out here.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { TEST_HOOK } from "./anim-core.js";
import { duration, mountThree } from "./anim-three.js";
import { EXTENT, TAU, WAVE_TURNS, curves, degrees, layout } from "./anim-complex.js";
import { addHighlight } from "./lib/highlight.js";
import { axisLabels, createLabels } from "./lib/labels.js";
import { createOrbit, frontFrustum } from "./lib/orbit.js";
import { contactShadow, fade, fatLines, floor, fog, setSegments, tokenGradient, tokenHex } from "./lib/style.js";

/** @typedef {import("./anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./anim-complex.js").ComplexState} ComplexState */
/** @typedef {import("./lib/orbit.js").Pose} Pose */
/** @typedef {import("./lib/labels.js").Label} Label */
/** @typedef {[number, number, number]} Vec */
/** @typedef {{u0: number, su: number, v0: number, sv: number}} PanelMap */

const E = EXTENT;
/** Scene units per turn: two turns span x from -2 to 2. */
const PER_TURN = 2;
/** @param {number} t turns */
const X = (t) => t * PER_TURN - (WAVE_TURNS * PER_TURN) / 2;
const X0 = X(0);
const X1 = X(WAVE_TURNS);
/** @type {import("./lib/orbit.js").SceneBox} */
const BOX = { min: [X0, -E, -E], max: [X1, E, E] };
/** A shadow sits this far off its surface, so it never fights it. */
const LIFT = 0.004;
const DISTANCE = 12;
/**
 * The helix's colour by turn: violet at the first turn to indigo at the
 * point, hues apart from x (teal, --ambe-cat-2) and y (amber, --ambe-cat-3)
 * for protan and deutan viewers too (pink is not: deutan, it is the teal),
 * and indigo where it meets the point, as the 2D circle panel draws it.
 */
const HELIX = ["--ambe-cat-5", "--ambe-cat-1"];
/** x, the real part, and y, the imaginary part, as the 2D panels draw them. */
const X_TOKEN = "--ambe-cat-2";
const Y_TOKEN = "--ambe-cat-3";
/** The shadows at the ramp-mark width; the one a step names, wider. */
const SHADOW_PX = 1.75;
const helixColor = tokenGradient(HELIX);
const NAMED_PX = 2.25;
/** The companions' points, radius in CSS px, as the 2D figure draws them. */
const DOT_PX = 5.5;
/** Labels are hidden in the frame's bottom 56 px (lib/labels.js). */
const KEEP_CLEAR = 57;

/** @type {Record<string, Pose>} */
const PRESETS = {
  end: { yaw: 90, pitch: 0 },
  real: { yaw: 0, pitch: 90 },
  imag: { yaw: 0, pitch: 0 },
  corner: { yaw: 32, pitch: 28 },
};

/**
 * What each matched preset sees edge on, and hides (harmonic-sum's
 * labelMode idiom).
 * @type {Record<string, string[]>}
 */
const HIDDEN = {
  end: ["floorShadows", "wallShadows", "drops", "shadowDots"],
  real: ["wallShadows", "drops", "shadowDots", "unit"],
  imag: ["floorShadows", "drops", "shadowDots", "unit"],
  corner: [],
};

/**
 * @param {number} v
 * @param {number} [places=2]
 */
const fmt = (v, places = 2) => {
  const s = v.toFixed(places);
  return s === "-0.00" ? "0.00" : s;
};

/**
 * A polyline as segment pairs, from scene points.
 * @param {number[]} p flat x, y, z
 * @returns {number[]}
 */
function pairs(p) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i + 5 < p.length; i += 3) out.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
  return out;
}

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

/** The chip's fact, from the point as drawn: its radius and angle. */
const chipText = (/** @type {number} */ re, /** @type {number} */ im) =>
  `r ${fmt(Math.hypot(re, im))}, θ ${degrees(Math.atan2(im, re))}°`;

/** @type {import("./lib/view-switch.js").Open3D} */
export async function open3D(frame, opts) {
  const state = /** @type {ComplexState} */ (opts.state);
  let sweeps = state.sweeps;
  /** How far along the turns the curves are drawn out (the animation). */
  let sweep = opts.intro ? 0 : WAVE_TURNS;
  let builds = 0;
  let played = 0;
  /** @type {ReturnType<typeof parts> | null} */
  let scene = null;
  /** The view's context, from its first build on. @type {ThreeContext | null} */
  let view = null;
  /** @type {ReturnType<typeof createLabels> | null} */
  let labels = null;
  /** The labels shown, and what they say (a new set when that changes). */
  /** @type {Label[]} */
  let shown = [];
  let shownKey = "";
  /** The preset the colours and widths were last drawn for. */
  let drawnMode = "";
  /** @type {ReturnType<typeof createOrbit> | null} */
  let orbit = null;
  /** The point as drawn, and where the shadow labels sit. */
  let drawn = { x: X1, re: 0, im: 0, at: 0, floorAt: /** @type {Vec} */ ([0, 0, 0]), wallAt: /** @type {Vec} */ ([0, 0, 0]) };
  /**
   * The fitted view: camera right and up, how each 2D panel maps to them,
   * px per data unit, and how far each companion shows (0 to 1).
   * @type {{right: Vec, up: Vec, plane: PanelMap, wave: PanelMap, ppu: {plane: number, t: number, v: number, x: number}, wPlane: number, wWave: number, H: number, waveBottom: number} | null}
   */
  let fitted = null;
  /** The shadows as pushed into their lines, in scene units. */
  /** @type {{wall: number[], floor: number[]}} */
  let shadowPoints = { wall: [], floor: [] };
  /** @type {{at: Vec, t: number, re: number, im: number}[]} */
  let frontPoints = [];

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
      shownKey = "";
      fog(c, DISTANCE, 5);
      placeInsets();
      draw();
      visibility();
      // Compile every material now, the companions' too, so that the first
      // view's camera move does not stall on a shader when one fades in.
      const hidden = [scene.circle, scene.wave].filter((g) => !g.visible);
      for (const g of hidden) g.visible = true;
      c.renderer.compile(c.scene, c.camera);
      for (const g of hidden) g.visible = false;
    },
  });
  if (!ctx) return null;

  /** Everything the scene holds, built from tokens; draw() fills it in. */
  function parts(/** @type {ThreeContext} */ c) {
    const T = c.three;
    const add = (/** @type {import("three").Object3D} */ o) => {
      c.scene.add(o);
      return o;
    };
    /** @param {number[]} p */
    const geometry = (p) => {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(p), 3));
      return g;
    };
    /** Thin lines on top of everything, outside the fog. @param {number[]} p @param {string} token */
    const flatLines = (p, token) => {
      const m = c.paint(new T.LineBasicMaterial({ depthTest: false }), token);
      m.fog = false;
      return new T.LineSegments(geometry(p), m);
    };
    const zeros = [0, 0, 0, 0, 0, 0];

    add(floor(c, { extent: BOX, step: [PER_TURN / 2, E / 2] }));
    // The back wall: the floor, stood up at z = -E.
    const wall = floor(c, { extent: { min: [X0, -E, -E], max: [X1, E, E] }, step: [PER_TURN / 2, E / 2] });
    wall.rotation.x = Math.PI / 2;
    add(wall);
    add(contactShadow(c, { x: [X0, X1], z: [-E, E], y: -E }));

    // The now-plane: a faint square, its two axes, and the unit circle.
    const now = new T.Group();
    const square = new T.Mesh(new T.PlaneGeometry(2 * E, 2 * E), c.paint(new T.MeshBasicMaterial({
      side: T.DoubleSide, depthWrite: false,
    }), "--ambe-accent-soft"));
    square.rotation.y = Math.PI / 2;
    const axes = new T.LineSegments(geometry([
      0, -E, -E, 0, E, -E, 0, E, -E, 0, E, E, 0, E, E, 0, -E, E, 0, -E, E, 0, -E, -E,
      0, 0, -E, 0, 0, E, 0, -E, 0, 0, E, 0,
    ]), c.paint(new T.LineBasicMaterial(), "--ambe-plot-axis"));
    /** @type {number[]} */
    const ring = [];
    /** @type {number[]} */
    const flatRing = [];
    for (let i = 0; i <= 120; i += 1) {
      const a = (i / 120) * TAU;
      ring.push(0, Math.sin(a), -Math.cos(a));
      flatRing.push(Math.cos(a), Math.sin(a), 0);
    }
    const unit = fatLines(c, pairs(ring), "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.05, gap: 0.05 });
    now.add(square, axes, unit);
    add(now);

    const paths = fatLines(c, zeros, "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.07, gap: 0.06, fog: true });
    // The traced helix coloured by turn (HELIX), x's shadow in teal and y's
    // in amber, each faded toward the ground with age, unfaded within half
    // a turn; the named shadow's helix one tier more. Worked out from the
    // tokens on every recolour, so a theme change takes them up too.
    /** Each vertex's turn and its distance from the point, in half turns. */
    /** @type {{t: number[], delta: number[], named: boolean}} */
    let ages = { t: [], delta: [], named: false };
    const helixColours = () => ages.t.map((t, i) => fade(helixColor(t / WAVE_TURNS), ages.named ? ages.delta[i] + 1.5 : ages.delta[i]));
    /** @param {string} token */
    const shadowColours = (token) => () => {
      const colour = tokenHex(token);
      return ages.delta.map((delta) => fade(colour, delta));
    };
    const floorColours = shadowColours(X_TOKEN);
    const wallColours = shadowColours(Y_TOKEN);
    const trace = fatLines(c, zeros, helixColours, 2.5);
    const floorShadows = fatLines(c, zeros, floorColours, SHADOW_PX);
    const wallShadows = fatLines(c, zeros, wallColours, SHADOW_PX);
    const drops = fatLines(c, zeros, "--ambe-plot-ink", 1.25, { dashed: true, dash: 0.05, gap: 0.05 });
    add(paths);
    add(trace);
    add(floorShadows);
    add(wallShadows);
    add(drops);

    // The point's two shadows, as small discs on the floor (x) and the wall (y).
    const disc = new T.CircleGeometry(0.055, 20);
    const floorDot = new T.Mesh(disc, c.paint(new T.MeshBasicMaterial({ side: T.DoubleSide }), X_TOKEN));
    floorDot.rotation.x = -Math.PI / 2;
    const wallDot = new T.Mesh(disc, c.paint(new T.MeshBasicMaterial({ side: T.DoubleSide }), Y_TOKEN));
    const shadowDots = new T.Group();
    shadowDots.add(floorDot, wallDot);
    add(shadowDots);

    // The subject: the point and its radius, in the now-plane. The kit draws
    // in a plane of constant z, so it sits in a group turned a quarter turn
    // about y: local (re, im, x) is world (x, im, -re).
    const kit = addHighlight(c, [0, 0, 0, state.r, 0, 0], { chip: chipText(state.r, 0) });
    const subject = new T.Group();
    subject.rotation.y = Math.PI / 2;
    subject.add(kit);
    add(subject);
    const point = new T.Mesh(new T.SphereGeometry(0.075, 20, 14), c.paint(new T.MeshBasicMaterial({ depthTest: false }), "--ambe-highlight"));
    point.renderOrder = 14;
    add(point);

    // The companions, in data units (placeInsets turns and scales them).
    // The circle panel: local (re, im).
    const unitDisc = new T.CircleGeometry(1, 24);
    const circle = new T.Group();
    const circleAxes = flatLines([
      -E, -E, 0, E, -E, 0, E, -E, 0, E, E, 0, E, E, 0, -E, E, 0, -E, E, 0, -E, -E, 0,
      -E, 0, 0, E, 0, 0, 0, -E, 0, 0, E, 0,
    ], "--ambe-plot-axis");
    const circleRing = fatLines(c, pairs(flatRing), "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.05, gap: 0.05, depthTest: false });
    // x along the real axis and y along the imaginary axis, as the 2D panel
    // draws them, with the dashed sides of the triangle.
    const sides = fatLines(c, [...zeros, ...zeros], () => [tokenHex(X_TOKEN), tokenHex(X_TOKEN), tokenHex(Y_TOKEN), tokenHex(Y_TOKEN)], 3, { depthTest: false });
    const guides = fatLines(c, [...zeros, ...zeros], () => [tokenHex(Y_TOKEN), tokenHex(Y_TOKEN), tokenHex(X_TOKEN), tokenHex(X_TOKEN)], 1.25, { dashed: true, dash: 0.04, gap: 0.04, depthTest: false });
    const circleKit = addHighlight(c, [0, 0, 0, state.r, 0, 0], { fill: false });
    const circleDot = new T.Mesh(unitDisc, c.paint(new T.MeshBasicMaterial({ depthTest: false }), "--ambe-highlight"));
    circleDot.renderOrder = 14;
    [circleAxes, circleRing, guides, sides].forEach((o, i) => { o.renderOrder = 5 + i; });
    circle.add(circleAxes, circleRing, guides, sides, circleKit, circleDot);
    add(circle);

    // The wave panel: local (turns, re).
    const wave = new T.Group();
    const waveGrid = flatLines([
      0.5, -E, 0, 0.5, E, 0, 1, -E, 0, 1, E, 0, 1.5, -E, 0, 1.5, E, 0, 0, 0, 0, WAVE_TURNS, 0, 0,
    ], "--ambe-plot-grid");
    const waveAxes = flatLines([0, -E, 0, WAVE_TURNS, -E, 0, 0, -E, 0, 0, E, 0], "--ambe-plot-axis");
    const waveIdeal = fatLines(c, zeros, "--ambe-plot-muted", 1.25, { dashed: true, dash: 0.03, gap: 0.03, depthTest: false });
    const waveTrace = fatLines(c, zeros, floorColours, 2.5, { depthTest: false });
    const waveDot = new T.Mesh(unitDisc, c.paint(new T.MeshBasicMaterial({ depthTest: false }), X_TOKEN));
    [waveGrid, waveAxes, waveIdeal, waveTrace, waveDot].forEach((o, i) => { o.renderOrder = 5 + i; });
    wave.add(waveGrid, waveAxes, waveIdeal, waveTrace, waveDot);
    add(wave);
    for (const group of [circle, wave]) {
      group.visible = false;
      for (const o of group.children) {
        const m = /** @type {any} */ (o).material;
        if (m) m.transparent = true;
      }
      // A theme change sets each painted colour, and its opacity, again.
      group.userData.recolour = () => fadeGroup(group, group.userData.w ?? 0);
    }

    return {
      now, unit, paths, trace, floorShadows, wallShadows, drops, shadowDots, floorDot, wallDot, kit, point,
      circle, sides, guides, circleKit, circleDot, wave, waveIdeal, waveTrace, waveDot,
      /** @param {typeof ages} next */
      colours: (next) => {
        ages = next;
      },
    };
  }

  /**
   * A companion at `w` of its full strength: its lines and marks by
   * opacity, the highlight kit shown whole or not at all.
   * @param {import("three").Object3D} group
   * @param {number} w
   */
  function fadeGroup(group, w) {
    group.visible = w > 0.01;
    group.userData.w = w;
    for (const o of group.children) {
      const m = /** @type {any} */ (o).material;
      if (!m) {
        o.visible = w > 0.6;
        continue;
      }
      // A colour set again from its token comes back at the token's opacity.
      if (m.userData.faded !== m.opacity) m.userData.base = m.opacity;
      m.opacity = m.userData.base * w;
      m.userData.faded = m.opacity;
      // Always transparent: toggling it would build a new shader (OPAQUE)
      // in the middle of the camera move.
      m.transparent = true;
    }
  }

  /**
   * Set a fat line's segments; it hides when there are none, and while the
   * view sees it edge on (visibility()).
   * @param {import("three/addons/lines/LineSegments2.js").LineSegments2} line
   * @param {number[]} segments
   */
  function put(line, segments) {
    line.userData.empty = segments.length === 0;
    line.visible = !line.userData.empty && !line.userData.off;
    if (!segments.length) return;
    // A new geometry whenever the count changes: three caches an instanced
    // geometry's draw count from its first draw (_maxInstanceCount), so
    // setSegments() alone would keep drawing the first count.
    const count = line.geometry.attributes.instanceStart?.count ?? 0;
    if (count !== segments.length / 6 && view) {
      line.geometry.dispose();
      line.geometry = new view.lines.LineSegmentsGeometry();
    }
    setSegments(line, segments);
    line.userData.recolour?.();
  }

  /** Place every curve from the state, drawn out to `sweep` turns. */
  function draw() {
    if (!scene || !view) return;
    const s = scene;
    const mode = looking();
    drawnMode = mode;
    const { ideal, trace } = curves(state);
    const upto = sweep + 1e-9;
    /** @type {number[]} */
    const path = [];
    /** @type {number[]} */
    const floorPath = [];
    /** @type {number[]} */
    const wallPath = [];
    /** @type {number[]} */
    const flatIdeal = [];
    for (let i = 0; i < ideal.t.length; i += 1) {
      flatIdeal.push(ideal.t[i], ideal.re[i], 0);
      if (ideal.t[i] > upto) continue;
      const x = X(ideal.t[i]);
      path.push(x, ideal.im[i], -ideal.re[i]);
      floorPath.push(x, -E + LIFT, -ideal.re[i]);
      wallPath.push(x, ideal.im[i], -E + LIFT);
    }
    // A path the view sees edge on is left out: it would only draw a
    // dashed line along the panel's edge.
    put(s.paths, [
      ...pairs(path),
      ...(mode === "corner" || mode === "real" ? pairs(floorPath) : []),
      ...(mode === "corner" || mode === "imag" ? pairs(wallPath) : []),
    ]);
    put(s.waveIdeal, pairs(flatIdeal));

    // The shadow labels sit on their own curves: the floor's under its turn
    // nearest the viewer in the first turn (clear of the turns axis name),
    // the wall's over a crest in the second.
    let near = 0;
    let crest = 0;
    for (let i = 0; i < ideal.t.length; i += 1) {
      const t = ideal.t[i];
      if (t >= 0.15 && t <= 0.85 && (!near || ideal.re[i] < ideal.re[near])) near = i;
      if (t >= 0.75 && t <= 1.75 && (!crest || ideal.im[i] > ideal.im[crest])) crest = i;
    }
    drawn.floorAt = [X(ideal.t[near]), -E, -ideal.re[near]];
    drawn.wallAt = [X(ideal.t[crest]), ideal.im[crest], -E];

    /** @type {number[]} */
    const helixPoints = [];
    /** @type {number[]} */
    const floorPoints = [];
    /** @type {number[]} */
    const wallPoints = [];
    /** @type {number[]} */
    const flatTrace = [];
    /** @type {number[]} */
    const turns = [];
    /** @type {number[]} */
    const deltas = [];
    // Real part names the floor's shadow and Imaginary part the wall's: that
    // one is drawn wider and over the helix, and the helix fades one tier.
    const named = mode === "real" ? s.floorShadows : mode === "imag" ? s.wallShadows : null;
    if (trace) {
      for (let i = 0; i < trace.t.length && trace.t[i] <= upto; i += 1) {
        const x = X(trace.t[i]);
        helixPoints.push(x, trace.im[i], -trace.re[i]);
        floorPoints.push(x, -E + LIFT, -trace.re[i]);
        wallPoints.push(x, trace.im[i], -E + LIFT);
        flatTrace.push(trace.t[i], trace.re[i], 0);
      }
      // Each segment's two ends, by turn (parts() colours them).
      const n = helixPoints.length / 3;
      for (let i = 0; i + 1 < n; i += 1) {
        for (const j of [i, i + 1]) {
          turns.push(trace.t[j]);
          deltas.push((state.head - trace.t[j]) * 2);
        }
      }
    }
    for (const line of [s.floorShadows, s.wallShadows]) {
      const on = line === named;
      line.material.linewidth = on ? NAMED_PX : SHADOW_PX;
      line.material.depthTest = !on;
      line.renderOrder = on ? 6 : 0;
    }
    shadowPoints = { wall: wallPoints, floor: floorPoints };
    s.colours({ t: turns, delta: deltas, named: Boolean(named) });
    put(s.trace, pairs(helixPoints));
    put(s.floorShadows, pairs(floorPoints));
    put(s.wallShadows, pairs(wallPoints));
    put(s.waveTrace, pairs(flatTrace));

    // The point: at the end of what is drawn out, or at the point now.
    const at = Math.min(sweep, state.head);
    let re = state.r * Math.cos(state.theta);
    let im = state.r * Math.sin(state.theta);
    if (at < state.head - 1e-9) {
      const i = Math.round((at / WAVE_TURNS) * (ideal.t.length - 1));
      re = ideal.re[i];
      im = ideal.im[i];
    }
    const x = X(at);
    drawn = { ...drawn, x, re, im, at };
    s.now.position.x = x;
    s.point.position.set(x, im, -re);
    s.floorDot.position.set(x, -E + 2 * LIFT, -re);
    s.wallDot.position.set(x, im, -E + 2 * LIFT);
    put(s.drops, [x, im, -re, x, -E, -re, x, im, -re, x, im, -E]);
    s.kit.set([0, 0, x, re, im, x]);
    put(s.sides, [0, 0, 0, re, 0, 0, 0, 0, 0, 0, im, 0]);
    put(s.guides, [re, 0, 0, re, im, 0, 0, im, 0, re, im, 0]);
    s.circleKit.set([0, 0, 0, re, im, 0]);
    s.circleDot.position.set(re, im, 0);
    s.waveDot.position.set(at, re, 0);

    // Probes: the point and eight samples of the path, in scene and data units.
    frontPoints = [{ at: [x, im, -re], t: at, re, im }];
    for (let k = 0; k < 8; k += 1) {
      const i = Math.round(((k + 0.5) / 8) * (ideal.t.length - 1));
      frontPoints.push({ at: [X(ideal.t[i]), ideal.im[i], -ideal.re[i]], t: ideal.t[i], re: ideal.re[i], im: ideal.im[i] });
    }
    placeLabels();
    view.requestRender();
  }

  /**
   * A point of a companion panel, in scene units.
   * @param {"plane" | "wave"} panel
   * @param {number} a data across (re, or turns)
   * @param {number} b data up (im, or the part)
   * @returns {Vec}
   */
  function panelAt(panel, a, b) {
    if (!fitted) return [0, 0, 0];
    const { u0, su, v0, sv } = fitted[panel];
    const u = u0 + su * a;
    const v = v0 + sv * b;
    const { right: r, up } = fitted;
    return [r[0] * u + up[0] * v, r[1] * u + up[1] * v, r[2] * u + up[2] * v];
  }

  /** Turn, place and fade the companions for the fitted view. */
  function placeInsets() {
    if (!scene || !fitted || !view) return;
    const f = fitted;
    for (const [group, map, w] of /** @type {const} */ ([[scene.circle, f.plane, f.wPlane], [scene.wave, f.wave, f.wWave]])) {
      group.quaternion.copy(view.camera.quaternion);
      group.position.set(...panelAt(group === scene.circle ? "plane" : "wave", 0, 0));
      group.scale.set(map.su, map.sv, 1);
      fadeGroup(group, w);
    }
    scene.circleDot.scale.setScalar(DOT_PX / f.ppu.plane);
    scene.waveDot.scale.set(DOT_PX / f.ppu.t, DOT_PX / f.ppu.v, 1);
  }

  /** Set the labels for the view, again only when what they say changes. */
  function placeLabels() {
    if (!labels || !scene) return;
    const list = labelList(looking());
    const key = list.map((l) => l.text).join("|");
    if (key !== shownKey) {
      shownKey = key;
      shown = list;
      labels.set(list);
    } else {
      list.forEach((l, i) => {
        shown[i].at = l.at;
        shown[i].dy = l.dy;
      });
      labels.update();
    }
    // The chip states the point's fact beside the point the reader sees:
    // in the circle panel when the companion shows it.
    const { x, re, im } = drawn;
    const chip = scene.kit.chip;
    const flat = fitted && fitted.wPlane > 0.6;
    chip?.set({ text: chipText(re, im), at: flat ? panelAt("plane", re, im) : [x, im, -re] });
    clearChip();
  }

  /** Hide any label the chip covers: the chip states the fact that matters. */
  function clearChip() {
    const box = scene?.kit.chip?.node.getBoundingClientRect();
    if (!box) return;
    for (const node of frame.querySelectorAll(".anim-figure__overlay:not(.anim-chip-layer) .anim-figure__label")) {
      const el = /** @type {HTMLElement} */ (node);
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.left < box.right + 2 && r.right > box.left - 2 && r.top < box.bottom + 2 && r.bottom > box.top - 2) el.hidden = true;
    }
  }

  /**
   * The labels for one view: each preset's own axes, the companion's, and
   * at the corner what each shadow is, next to its curve.
   * @param {string} mode
   * @returns {Label[]}
   */
  function labelList(mode) {
    const phone = frame.clientWidth < 450;
    /** @type {Label[]} */
    const out = [];
    /**
     * @param {string} text @param {Vec} at @param {"start" | "middle" | "end"} align
     * @param {number} [dy] @param {boolean} [tick]
     */
    const label = (text, at, align, dy = 0, tick = false) => out.push({ text, at, align, dy, tick });
    const { x, re, im } = drawn;
    const ppu = fitted?.ppu ?? { plane: 100, t: 100, v: 100, x: 50 };
    /** Scene units for `px` CSS px across the turns axis. */
    const gapX = (/** @type {number} */ px) => px / ppu.x;
    // Ticks below a panel sit inside it when its bottom edge is in the band
    // labels keep clear of.
    const lift = fitted ? Math.min(14, fitted.H - KEEP_CLEAR - fitted.waveBottom) : 14;
    const turnTicks = (/** @type {(t: number) => Vec} */ at) => {
      // On a phone the half turns would sit on the curve's troughs.
      for (const t of phone ? [0, 1, 2] : [0, 0.5, 1, 1.5, 2]) label(String(t), at(t), "middle", lift, true);
    };
    /** The point's x and y beside their sides of the triangle (as in 2D). */
    // y goes on the side of its axis away from the triangle.
    const parts = (/** @type {(a: number, b: number) => Vec} */ at, /** @type {Vec} */ side) => {
      if (Math.abs(re) > 0.12) label(`x = ${fmt(re)}`, at(re / 2, 0), "middle", 12);
      if (Math.abs(im) > 0.12) label(`y = ${fmt(im)}`, side, re < 0 ? "start" : "end");
    };

    if (mode === "corner") {
      out.push(...axisLabels(BOX, { x: (t) => X(t), y: (v) => v, z: (v) => -v }, [
        { axis: "x", name: "turns of the point", ticks: [0, 1, 2] },
        { axis: "z", name: "real", ticks: [-1, 1] },
      ]));
      // The imaginary axis is the back wall's edge at turn 0.
      const edge = X0 - 0.08;
      label("i", [edge, 1, -E], "end", 0, true);
      label("-i", [edge, -1, -E], "end", 0, true);
      label("imaginary", [edge, 0, -E], "end");
      if (!phone) {
        label("on the floor: x, a cosine", drawn.floorAt, "middle", 16);
        label("on the wall: y, a sine", drawn.wallAt, "middle", -16);
      }
      return out;
    }
    if (mode === "end") {
      // The scene is the circle panel; the wave panel is the companion.
      const sx = X1;
      label("-1", [sx, -E, 1], "middle", 14, true);
      label("1", [sx, -E, -1], "middle", 14, true);
      label(phone ? "real" : "real axis", [sx, -E, 0], "middle", 30);
      label("i", [sx, 1, E + 6 / ppu.plane], "end", 0, true);
      label("-i", [sx, -1, E + 6 / ppu.plane], "end", 0, true);
      parts((a, b) => [x, b, -a], [x, im / 2, (re < 0 ? -6 : 6) / ppu.plane]);
      label(phone ? "x, as the point turns" : "x, plotted as the point turns",
        panelAt("wave", 6 / ppu.t, E), "start", 12);
      turnTicks((t) => panelAt("wave", t, -E));
      return out;
    }
    // Real part and Imaginary part: the scene is the wave panel; the circle
    // panel is the companion.
    const real = mode === "real";
    /** A point of the wave rectangle: turns across, the part up. @type {(t: number, v: number) => Vec} */
    const waveAt = (t, v) => (real ? [X(t), 0, -v] : [X(t), v, 0]);
    label(real ? "x, the real part, as the point turns" : "y, the imaginary part, as the point turns",
      waveAt(gapX(6) / PER_TURN, E), "start", 12);
    turnTicks((t) => waveAt(t, -E));
    const left = -gapX(6) / PER_TURN;
    label("1", waveAt(left, 1), "end", 0, true);
    label("-1", waveAt(left, -1), "end", 0, true);
    const g = 6 / ppu.plane;
    label("i", panelAt("plane", -E - g, 1), "end", 0, true);
    label("-i", panelAt("plane", -E - g, -1), "end", 0, true);
    label("-1", panelAt("plane", -1, -E), "middle", 12, true);
    label("1", panelAt("plane", 1, -E), "middle", 12, true);
    parts((a, b) => panelAt("plane", a, b), panelAt("plane", re < 0 ? g : -g, im / 2));
    return out;
  }

  /** The preset the camera looks along now, if any. */
  function looking() {
    if (!view) return "corner";
    const d = view.camera.position.clone().normalize();
    if (d.x > 0.995) return "end";
    if (d.y > 0.995) return "real";
    if (d.z > 0.995) return "imag";
    return "corner";
  }

  /** Hide what the current view sees edge on. */
  function visibility() {
    if (!scene) return;
    const hidden = HIDDEN[looking()];
    for (const name of /** @type {const} */ (["floorShadows", "wallShadows", "drops", "shadowDots", "unit"])) {
      const part = scene[name];
      part.userData.off = hidden.includes(name);
      part.visible = !part.userData.off && !part.userData.empty;
    }
  }

  /**
   * The fit: on End on, Real part and Imaginary part the scene lies on the
   * 2D plots' rectangles; elsewhere the whole box fills the frame. Between
   * them the frustum eases from one to the other over 25 degrees, and the
   * companions fade in over the last 8.
   */
  const fit = () => {
    const cam = /** @type {any} */ (/** @type {ThreeContext} */ (ctx).camera);
    if (!cam.isOrthographicCamera) return;
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (!W || !H) return;
    const size = { width: W, height: H };
    const geo = layout(W, H);
    /** @param {{x: number, y: number, width: number, height: number}} a */
    const rect = (a) => ({ x: a.x, y: a.y, width: a.width, height: a.height });
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    /** @type {Vec} */
    const right = [m[0], m[1], m[2]];
    /** @type {Vec} */
    const up = [m[4], m[5], m[6]];
    let hw = 0;
    let hh = 0;
    for (const x of [X0, X1]) {
      for (const y of [-E, E]) {
        for (const z of [-E, E]) {
          hw = Math.max(hw, Math.abs(x * right[0] + y * right[1] + z * right[2]));
          hh = Math.max(hh, Math.abs(x * up[0] + y * up[1] + z * up[2]));
        }
      }
    }
    const pad = W < 620 ? { l: 30, r: 30, t: 14, b: 50 } : { l: 70, r: 70, t: 20, b: 58 };
    const room = { w: W - pad.l - pad.r, h: H - pad.t - pad.b };
    const k = Math.min(room.w / (2 * hw), room.h / (2 * hh));
    const cx = pad.l + room.w / 2;
    const cy = pad.t + room.h / 2;
    let f = { left: -cx / k, right: (W - cx) / k, top: cy / k, bottom: -(H - cy) / k };
    const d = cam.position.clone().normalize();
    const near = Math.cos((25 * Math.PI) / 180);
    const weight = (/** @type {number} */ w) => smooth((w - near) / (1 - near));
    // The companions come and go over the last 8 degrees only, so a flat
    // panel is never drawn over the turned helix while the camera moves.
    const close = Math.cos((8 * Math.PI) / 180);
    const shown = (/** @type {number} */ w) => smooth((w - close) / (1 - close));
    const matched = [
      { w: weight(d.x), f: frontFrustum(size, rect(geo.plane.area), { min: [-E, -E, 0], max: [E, E, 0] }) },
      { w: weight(d.y), f: frontFrustum(size, rect(geo.wave.area), { min: [X0, -E, 0], max: [X1, E, 0] }) },
      { w: weight(d.z), f: frontFrustum(size, rect(geo.wave.area), { min: [X0, -E, 0], max: [X1, E, 0] }) },
    ];
    for (const { w: t, f: g } of matched) {
      if (t <= 0) continue;
      f = {
        left: lerp(f.left, g.left, t),
        right: lerp(f.right, g.right, t),
        top: lerp(f.top, g.top, t),
        bottom: lerp(f.bottom, g.bottom, t),
      };
    }
    Object.assign(cam, f);

    // Each 2D panel's mapping, as scene units along camera right and up.
    const U = (/** @type {number} */ px) => f.left + (px / W) * (f.right - f.left);
    const V = (/** @type {number} */ py) => f.top - (py / H) * (f.top - f.bottom);
    /** @param {(v: number) => number} xOf @param {(v: number) => number} yOf @returns {PanelMap} */
    const map = (xOf, yOf) => {
      const u0 = U(xOf(0));
      const v0 = V(yOf(0));
      return { u0, su: U(xOf(1)) - u0, v0, sv: V(yOf(1)) - v0 };
    };
    fitted = {
      right,
      up,
      plane: map(geo.plane.x, geo.plane.y),
      wave: map(geo.wave.x, geo.wave.y),
      ppu: {
        plane: geo.plane.area.width / (2 * E),
        t: geo.wave.area.width / WAVE_TURNS,
        v: geo.wave.area.height / (2 * E),
        x: W / (f.right - f.left),
      },
      wPlane: Math.max(shown(d.y), shown(d.z)),
      wWave: shown(d.x),
      H,
      waveBottom: geo.wave.area.bottom,
    };
    placeInsets();
  };

  orbit = createOrbit(ctx, {
    target: [0, 0, 0],
    fit,
    distance: DISTANCE,
    zoom: opts.look.zoom || 1,
    presets: PRESETS,
    start: PRESETS[state.preset] ? state.preset : "corner",
    yaw: !opts.headOn,
    onDrag: opts.onDrag,
    onChange: () => {
      visibility();
      if (looking() !== drawnMode) draw();
      else placeLabels();
    },
  });

  let labelTimer = 0;
  /** The sentence for the 3D canvas's label (the orbit adds the zoom sentence). */
  function describe() {
    const traced = state.head - state.tail;
    const view = {
      end: "end on, as the circle panel, with the wave panel drawn flat alongside",
      real: "from above, as the wave panel, with the circle panel drawn flat alongside",
      imag: "from the front, the imaginary part, with the circle panel drawn flat alongside",
      corner: "from a corner",
    }[state.preset];
    return `A helix in 3D, seen ${view}: the point at radius ${fmt(state.r)} and angle ${degrees(state.theta)} degrees ` +
      `carried through ${fmt(traced)} turns of time along the depth axis. Its shadow on the floor is x, the real part, ` +
      "a cosine; its shadow on the back wall is y, the imaginary part, the same wave a quarter turn later.";
  }
  const relabel = () => {
    clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => ctx.renderer?.domElement.setAttribute("aria-label", describe()), 250);
  };
  ctx.viewSignal.addEventListener("abort", () => clearTimeout(labelTimer), { once: true });

  const timeline = ctx.timeline();
  /**
   * Draw the curves out from turn 0 to the end, the point turning with them.
   * @param {number} ms
   */
  const drawOut = (ms) => timeline.play("sweep", {
    ms,
    ease: "linear",
    build: true,
    step: (t) => {
      sweep = t * WAVE_TURNS;
      draw();
    },
  });

  if (opts.intro) {
    // The first view, on one track: end on, the point makes one full turn
    // while the wave panel beside it draws that turn; the camera turns to
    // the corner while the second turn draws out, so the circle opens into
    // a helix with its cosine on the floor and its sine on the wall; a hold
    // there of at least 1.8 s with the highlight pulsing, so the helix is
    // seen whole; then the step's preset (Real part for step 1), where the
    // helix lies down onto its floor shadow.
    played += 1;
    const from = PRESETS.end;
    const via = PRESETS.corner;
    const to = PRESETS[state.preset] ?? PRESETS.real;
    const first = duration("3d-build");
    const turn = duration("3d-camera");
    const hold = Math.max(1800, duration("3d-build") + duration("slow"));
    const settle = to === via ? 0 : duration("3d-camera");
    const total = first + turn + hold + settle;
    let pulsed = false;
    sweep = 0;
    orbit.set(from);
    /** @param {Pose} a @param {Pose} b @param {number} u */
    const go = (a, b, u) => {
      const e = smooth(u);
      orbit?.set({ yaw: lerp(a.yaw, b.yaw, e), pitch: lerp(a.pitch, b.pitch, e) });
    };
    // The intro keeps its own clock from its first frame, so a slow first
    // frame (the 3D canvas taking over from the 2D one) does not skip the
    // end-on turn; the track runs a little longer to leave room for it.
    const SLACK = duration("3d-build");
    let start = -1;
    void timeline.play("intro", {
      ms: total + SLACK,
      ease: "linear",
      build: true,
      step: (t) => {
        const wall = performance.now();
        if (start < 0) start = wall;
        const ms = t >= 1 ? total : Math.min(total, wall - start);
        sweep = Math.min(WAVE_TURNS, ms < first ? ms / first : 1 + (ms - first) / turn);
        if (ms < first) go(from, from, 1);
        else if (ms < first + turn) go(from, via, (ms - first) / turn);
        else if (ms < first + turn + hold || !settle) {
          go(via, via, 1);
          if (!pulsed && ms < total && scene) {
            pulsed = true;
            void scene.kit.pulse();
            void scene.circleKit.pulse();
          }
        } else go(via, to, (ms - first - turn - hold) / settle);
        draw();
      },
    });
  }

  if (TEST_HOOK) {
    TEST_HOOK.figures["complex-3d"] = {
      get builds() { return builds; },
      get played() { return played; },
      pose: () => orbit?.pose() ?? null,
      zoom: () => orbit?.zoom() ?? 1,
      get frontPoints() { return frontPoints; },
      /**
       * The shadows: the scene points pushed into each line, and the points
       * its geometry holds, read back from the instanced segments.
       */
      get shadows() {
        /** @param {any} line */
        const read = (line) => {
          const start = line?.geometry?.attributes?.instanceStart;
          const end = line?.geometry?.attributes?.instanceEnd;
          /** @type {number[]} */
          const out = [];
          if (!start) return out;
          for (let i = 0; i < start.count; i += 1) out.push(start.getX(i), start.getY(i), start.getZ(i));
          const last = start.count - 1;
          out.push(end.getX(last), end.getY(last), end.getZ(last));
          return out;
        };
        return {
          pushed: shadowPoints,
          drawn: { wall: read(scene?.wallShadows), floor: read(scene?.floorShadows) },
          perTurn: PER_TURN,
        };
      },
      get looking() { return looking(); },
      /** What each part draws: visible, and its segment count. */
      get parts() {
        if (!scene) return {};
        /** @type {Record<string, [boolean, number]>} */
        const out = {};
        for (const [name, part] of Object.entries(scene)) {
          if (typeof part === "function") continue;
          const g = /** @type {any} */ (part).geometry;
          out[name] = [part.visible, g?.attributes?.instanceStart?.count ?? 0];
        }
        return out;
      },
      /** CSS px in the frame of a scene point, through the live camera. */
      project: (/** @type {Vec} */ at) => {
        const v = new ctx.three.Vector3(...at).project(ctx.camera);
        return [((v.x + 1) / 2) * frame.clientWidth, ((1 - v.y) / 2) * frame.clientHeight];
      },
      /** A companion panel's point, in scene units. */
      panelAt,
    };
    ctx.viewSignal.addEventListener("abort", () => {
      if (TEST_HOOK) delete TEST_HOOK.figures["complex-3d"];
    }, { once: true });
  }

  await ctx.drawn();
  return {
    update: (next) => {
      Object.assign(state, /** @type {ComplexState} */ (next));
      if (state.sweeps !== sweeps) {
        sweeps = state.sweeps;
        void drawOut(duration("3d-build"));
      } else {
        draw();
      }
      relabel();
    },
    preset: (name) => {
      void orbit?.go(name);
      relabel();
    },
    describe,
    close: () => ctx.dispose(),
  };
}
