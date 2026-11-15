// @ts-check
/* ===========================================================================
 * lib/style.js: the visual language's look for a 3D view
 * (three-visual-language design §3).
 * ---------------------------------------------------------------------------
 * No scene lights: materials stay unlit, so the colour on screen is the
 * token's colour, which the contrast tests check. Depth comes from cheap
 * cues instead: thick lines, frosted fills, fog, a floor with a contact
 * shadow, and a context that fades toward the plot background by vertex
 * colour (never by alpha, so nothing needs sorting).
 *
 * Every helper takes the ThreeContext and is called from build(), so a
 * restored or unparked view runs it again. Colours come from tokens: a
 * material through ctx.paint(), vertex colours, fog and textures through
 * userData.recolour, which anim-three.js runs on a theme change and when
 * print starts or ends. Print turns the effects off: no fog, no fade, no
 * contact shadow (and lib/highlight.js drops its glow).
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { getTheme, tokenColor } from "../anim-core.js";

/** @typedef {import("../anim-three.js").ThreeContext} ThreeContext */
/** @typedef {import("./orbit.js").SceneBox} SceneBox */

/** @type {MediaQueryList | null} */
let printQuery = null;
/**
 * True while the page is printed (or emulates print). One MediaQueryList
 * serves every call: its `matches` follows the medium, and making a new one
 * per call cost WebKit about 10 µs each, thousands of times a frame when a
 * figure colours its vertices through rampColor() and fade().
 * @returns {boolean}
 */
export const printing = () => (printQuery ??= matchMedia("print")).matches;

/* ---------------------------------------------------------------------------
 * Colour: 0xRRGGBB numbers, mixed in sRGB, ramps interpolated in OKLab
 * ------------------------------------------------------------------------ */

/** @param {number} hex @returns {number[]} r, g, b, 0 to 1 each */
const channels = (hex) => [Math.floor(hex / 65536) % 256, Math.floor(hex / 256) % 256, hex % 256]
  .map((c) => c / 255);
/** @param {number[]} rgb 0 to 1 each @returns {number} */
const pack = (rgb) => rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255))
  .reduce((n, c) => n * 256 + c, 0);
/** @param {number} c */
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** @param {number} c */
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB to OKLab (Ottosson). @param {number} hex @returns {number[]} */
function toLab(hex) {
  const [r, g, b] = channels(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to sRGB. @param {number[]} lab @returns {number} */
function fromLab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return pack([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(gamma));
}

/**
 * `colour` mixed toward `to` by `amount` (0 keeps it, 1 is `to`), in sRGB,
 * as CSS color-mix() would.
 * @param {number} colour 0xRRGGBB
 * @param {number} to 0xRRGGBB
 * @param {number} amount
 * @returns {number}
 */
export function mix(colour, to, amount) {
  const a = channels(colour);
  const b = channels(to);
  return pack(a.map((c, i) => c + (b[i] - c) * amount));
}

/** A token's colour as 0xRRGGBB. @param {string} name @returns {number} */
export function tokenHex(name) {
  // Destructured: tools/check-scope.py reads a ".hex" member as frame data.
  const { hex } = tokenColor(name);
  return hex;
}

/** The plot background is dark (the slate scheme on screen). @returns {boolean} */
export const darkGround = () => channels(tokenHex("--ambe-plot-bg")).reduce((s, c) => s + c, 0) < 1.5;

/**
 * A gradient through `names` (two tokens or more, evenly spaced), sampled at
 * t (0 to 1, clamped) and interpolated in OKLab. Its stops are read again
 * when the theme or print changes.
 * @param {string[]} names
 * @returns {(t: number) => number} 0xRRGGBB at t
 */
export function tokenGradient(names) {
  if (names.length < 2) throw new Error("tokenGradient: two tokens or more");
  /** The stops for the current theme, and what they were read for. */
  /** @type {{key: unknown, print: boolean, labs: number[][]}} */
  let stops = { key: null, print: false, labs: [] };
  const last = names.length - 1;
  return (t) => {
    const key = getTheme();
    if (stops.key !== key || stops.print !== printing()) {
      stops = { key, print: printing(), labs: names.map((name) => toLab(tokenHex(name))) };
    }
    const x = Math.min(1, Math.max(0, t)) * last;
    const i = Math.min(last - 1, Math.floor(x));
    const f = x - i;
    return fromLab(stops.labs[i].map((v, k) => v + (stops.labs[i + 1][k] - v) * f));
  };
}

/**
 * The sequential ramp at t (0 to 1, clamped): ramp-0 to ramp-4,
 * interpolated in OKLab. For data magnitudes (dB, harmonic number, time,
 * depth), never for categories.
 */
export const rampColor = tokenGradient([0, 1, 2, 3, 4].map((i) => `--ambe-ramp-${i}`));

/**
 * How far a context mark at distance `delta` (frames, harmonics, entries)
 * from the highlight fades toward the plot background: 0 within 1, then
 * 0.12 plus 0.06 per step, at most 0.6 in dark and 0.45 in light, so light
 * keeps its saturation. 0 in print.
 * @param {number} delta
 * @returns {number}
 */
export function fadeAmount(delta) {
  const d = Math.abs(delta);
  if (d <= 1 || printing()) return 0;
  return Math.min(darkGround() ? 0.6 : 0.45, 0.12 + 0.06 * (d - 1));
}

/**
 * A context colour faded by its distance from the highlight (fadeAmount).
 * @param {number} colour 0xRRGGBB
 * @param {number} delta
 * @returns {number}
 */
export function fade(colour, delta) {
  return mix(colour, tokenHex("--ambe-plot-bg"), fadeAmount(delta));
}

/* ---------------------------------------------------------------------------
 * Thick lines
 * ------------------------------------------------------------------------ */

/**
 * @typedef {Object} LineOptions
 * @property {boolean} [dashed]  dashes of `dash` and gaps of `gap`, scene units
 * @property {number} [dash=0.06]
 * @property {number} [gap=0.05]
 * @property {boolean} [depthTest=true]  false: nothing covers it
 * @property {boolean} [fog=false]  context lines take the fog; the highlight
 *           and results never do
 */

/**
 * Line segments `px` CSS px wide at any zoom (LineSegments2, worldUnits
 * false), one draw call. A polyline goes in as consecutive segment pairs.
 * `colours` is a token, or a function returning one 0xRRGGBB per vertex
 * (segments.length / 3 of them), called again on every theme change.
 * anim-three.js keeps the material's resolution equal to the frame.
 * @param {ThreeContext} ctx
 * @param {ArrayLike<number>} segments x, y, z of each segment's two ends
 * @param {string | (() => ArrayLike<number>)} colours
 * @param {number} px
 * @param {LineOptions} [opts]
 * @returns {import("three/addons/lines/LineSegments2.js").LineSegments2}
 */
export function fatLines(ctx, segments, colours, px, opts = {}) {
  const { LineMaterial, LineSegments2, LineSegmentsGeometry } = ctx.lines;
  const material = new LineMaterial({
    linewidth: px,
    worldUnits: false,
    dashed: Boolean(opts.dashed),
    dashSize: opts.dash ?? 0.06,
    gapSize: opts.gap ?? 0.05,
    depthTest: opts.depthTest ?? true,
  });
  material.fog = opts.fog ?? false;
  material.resolution.set(ctx.frame.clientWidth || 1, ctx.frame.clientHeight || 1);
  const line = new LineSegments2(new LineSegmentsGeometry(), material);
  setSegments(line, segments);
  if (typeof colours === "string") {
    ctx.paint(material, colours);
  } else {
    material.vertexColors = true;
    const colour = new ctx.three.Color();
    const recolour = () => {
      const hexes = colours();
      const rgb = new Float32Array(hexes.length * 3);
      for (let i = 0; i < hexes.length; i += 1) {
        colour.setHex(hexes[i]); // sRGB in, linear out, as the shader wants
        rgb.set([colour.r, colour.g, colour.b], i * 3);
      }
      line.geometry.setColors(rgb);
    };
    recolour();
    line.userData.recolour = recolour;
  }
  return line;
}

/**
 * Replace a fat line's segments (same layout as fatLines takes). Its
 * colours, if per vertex, must be set again for a new count. three keeps an
 * instanced geometry's draw count from its first draw (_maxInstanceCount,
 * cleared only on dispose), so a line given more segments than it first
 * drew would keep drawing the old count; clearing it lets the next draw
 * count again.
 * @param {import("three/addons/lines/LineSegments2.js").LineSegments2} line
 * @param {ArrayLike<number>} segments
 * @returns {void}
 */
export function setSegments(line, segments) {
  line.geometry.setPositions(Float32Array.from(segments));
  delete (/** @type {{_maxInstanceCount?: number}} */ (/** @type {unknown} */ (line.geometry)))._maxInstanceCount;
  if (line.material.dashed) line.computeLineDistances();
}

/* ---------------------------------------------------------------------------
 * Surfaces
 * ------------------------------------------------------------------------ */

/**
 * A frosted fill under a curve y(x) in the plane z: opaque and depth-written,
 * so it hides what is behind it, running from the `top` token at the curve
 * to the `bottom` token at the baseline y0. It sits a little behind lines
 * drawn on it (polygonOffset 1, 1).
 * @param {ThreeContext} ctx
 * @param {ArrayLike<number>} xs
 * @param {ArrayLike<number>} ys
 * @param {number} z
 * @param {number} y0 the baseline
 * @param {string} top token
 * @param {string} bottom token
 * @param {{fog?: boolean}} [opts] fog: false for the highlight's fill
 * @returns {import("three").Mesh}
 */
export function frostedFill(ctx, xs, ys, z, y0, top, bottom, opts = {}) {
  const T = ctx.three;
  const mesh = new T.Mesh(fillGeometry(ctx, xs, ys, z, y0), new T.MeshBasicMaterial({
    vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    fog: opts.fog ?? true,
  }));
  const colour = new T.Color();
  const recolour = () => {
    const attribute = mesh.geometry.getAttribute("color");
    const ends = [top, bottom].map((name) => colour.setHex(tokenHex(name)).toArray());
    for (let i = 0; i < attribute.count; i += 1) {
      const [r, g, b] = ends[i % 2];
      attribute.setXYZ(i, r, g, b);
    }
    attribute.needsUpdate = true;
  };
  recolour();
  mesh.userData.recolour = recolour;
  return mesh;
}

/**
 * Give a frosted fill a new curve, in place.
 * @param {ThreeContext} ctx
 * @param {import("three").Mesh} mesh from frostedFill
 * @param {ArrayLike<number>} xs
 * @param {ArrayLike<number>} ys
 * @param {number} z
 * @param {number} y0
 * @returns {void}
 */
export function setFill(ctx, mesh, xs, ys, z, y0) {
  mesh.geometry.dispose();
  mesh.geometry = fillGeometry(ctx, xs, ys, z, y0);
  mesh.userData.recolour?.();
}

/**
 * Two vertices per x, the curve's (even) and the baseline's (odd).
 * @param {ThreeContext} ctx
 * @param {ArrayLike<number>} xs
 * @param {ArrayLike<number>} ys
 * @param {number} z
 * @param {number} y0
 */
function fillGeometry(ctx, xs, ys, z, y0) {
  const T = ctx.three;
  const n = xs.length;
  const positions = new Float32Array(n * 6);
  /** @type {number[]} */
  const index = [];
  for (let i = 0; i < n; i += 1) {
    positions.set([xs[i], ys[i], z, xs[i], y0, z], i * 6);
    if (i + 1 < n) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 2, 2 * i + 1, 2 * i + 3);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(n * 6), 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * The floor under the data: a plane in --ambe-3d-floor at the box's bottom
 * and a grid in --ambe-3d-grid every `step` scene units from the box's
 * corner (one natural unit: 1 kHz, 5 frames, one harmonic). The fog, when
 * the view has one, fades the grid with distance. Two draw calls.
 * @param {ThreeContext} ctx
 * @param {{extent: SceneBox, step: number | [number, number]}} opts
 *        step: one for both axes, or [x, z]
 * @returns {import("three").Group}
 */
export function floor(ctx, { extent, step }) {
  const T = ctx.three;
  const [x0, y0, z0] = extent.min;
  const [x1, , z1] = extent.max;
  const [sx, sz] = typeof step === "number" ? [step, step] : step;
  const group = new T.Group();
  const plane = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), ctx.paint(new T.MeshBasicMaterial({
    side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  }), "--ambe-3d-floor"));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((x0 + x1) / 2, y0, (z0 + z1) / 2);
  /** @type {number[]} */
  const grid = [];
  for (let x = x0; x <= x1 + 1e-9; x += sx) grid.push(x, y0, z0, x, y0, z1);
  for (let z = z0; z <= z1 + 1e-9; z += sz) grid.push(x0, y0, z, x1, y0, z);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(grid), 3));
  group.add(plane, new T.LineSegments(geometry, ctx.paint(new T.LineBasicMaterial(), "--ambe-3d-grid")));
  return group;
}

/**
 * One soft contact shadow under the subject: a 128 px radial gradient in
 * --ambe-3d-shadow, stretched over the rectangle (and a margin), just above
 * the floor. No shadow maps. Hidden in print.
 * @param {ThreeContext} ctx
 * @param {{x: [number, number], z: [number, number], y: number}} rect scene units
 * @returns {import("three").Mesh}
 */
export function contactShadow(ctx, rect) {
  const T = ctx.three;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const [x0, x1] = rect.x;
  const [z0, z1] = rect.z;
  const mesh = new T.Mesh(new T.PlaneGeometry((x1 - x0) * 1.3, (z1 - z0) * 1.3),
    new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, rect.y + 1e-3, (z0 + z1) / 2);
  const recolour = () => {
    mesh.visible = !printing();
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    const { hex, opacity } = tokenColor("--ambe-3d-shadow");
    const rgb = channels(hex).map((c) => Math.round(c * 255)).join(", ");
    const fill = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    fill.addColorStop(0, `rgba(${rgb}, ${opacity})`);
    fill.addColorStop(1, `rgba(${rgb}, 0)`);
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = fill;
    g.fillRect(0, 0, 128, 128);
    texture.needsUpdate = true;
  };
  recolour();
  mesh.userData.recolour = recolour;
  return mesh;
}

/**
 * Fog in --ambe-3d-fog from (distance - 0.4 depth) to (distance + 0.9
 * depth), where distance is the camera's from the subject and depth the
 * scene's extent along the view. Applies to meshes and to fat lines made
 * with fog: true. None in print.
 * @param {ThreeContext} ctx
 * @param {number} distance
 * @param {number} depth
 * @returns {void}
 */
export function fog(ctx, distance, depth) {
  const { scene, three: T } = ctx;
  scene.userData.recolour = () => {
    scene.fog = printing() ? null : new T.Fog(tokenHex("--ambe-3d-fog"), distance - 0.4 * depth, distance + 0.9 * depth);
  };
  scene.userData.recolour();
}
