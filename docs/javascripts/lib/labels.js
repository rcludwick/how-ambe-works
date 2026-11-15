// @ts-check
/* ===========================================================================
 * lib/labels.js: HTML labels pinned to points of a 3D scene (design §3.8).
 * ---------------------------------------------------------------------------
 * HTML text is crisper than text in WebGL and follows the page's font. A
 * label is hidden when its point is behind the camera, when it would sit
 * in the bottom 56 px of the frame, when any of its text would come within
 * 4 px of the frame's edge, when the axis it names (`along`) points at the
 * viewer, or when it would overlap a label already placed, or come within
 * 3 px of one beside it on its line: names are placed
 * first, so an end value yields to a name, and a later name to an earlier
 * one (on a phone an axis title and its last tick would otherwise run
 * together, "lag, samples200").
 * update() runs on every camera change its caller reports and on every
 * resize of the frame, so each of those tests holds after either. The
 * layer is aria-hidden: the canvas aria-label carries the same facts.
 *
 * A chip (createChip) is the label that matters: it states a fact about
 * the highlight, and pins at the frame's edge rather than hide.
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

const BOTTOM_KEEP_CLEAR = 56;
/** CSS px kept clear beside a label (on its line), and between a label and the frame's edge. */
const LABEL_GAP = 3;
const EDGE = 4;

/**
 * @typedef {Object} Label
 * @property {string} text
 * @property {[number, number, number]} at
 * @property {"start" | "middle" | "end"} [align]
 * @property {[number, number, number]} [along] a unit axis; hidden when
 *           it lies within about 25 degrees of the view direction
 * @property {boolean} [tick] a small end value rather than a name
 * @property {number} [dy] moves the label down by that many CSS px from
 *           its point (up if negative), so a row of labels can sit a fixed
 *           distance off the geometry at any zoom
 *
 * A "\n" in text breaks the label onto two lines.
 */

/** |cos| above this: the axis points at the viewer, and its label hides. */
const END_ON = 0.9;

/**
 * @param {HTMLElement} frame
 * @param {import("../anim-three.js").ThreeContext} ctx
 * @returns {{set: (list: Label[]) => void, update: () => void, dispose: () => void}}
 */
export function createLabels(frame, ctx) {
  const layer = document.createElement("div");
  layer.className = "anim-figure__overlay";
  layer.setAttribute("aria-hidden", "true");
  frame.append(layer);
  /** @type {{label: Label, node: HTMLSpanElement}[]} */
  let items = [];
  const v = new ctx.three.Vector3();
  const look = new ctx.three.Vector3();

  const update = () => {
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    ctx.camera.updateMatrixWorld();
    ctx.camera.getWorldDirection(look);
    /** @type {{left: number, top: number, right: number, bottom: number}[]} */
    const placed = [];
    // Names first, so an end value that would overprint one yields to it.
    const order = [...items].sort((a, b) => Number(Boolean(a.label.tick)) - Number(Boolean(b.label.tick)));
    for (const { label, node } of order) {
      v.set(...label.at).project(ctx.camera);
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h + (label.dy ?? 0);
      const endOn = label.along
        ? Math.abs(label.along[0] * look.x + label.along[1] * look.y + label.along[2] * look.z) > END_ON
        : false;
      if (v.z < -1 || v.z > 1 || endOn || y > h - BOTTOM_KEEP_CLEAR || x < 0 || x > w) {
        node.hidden = true;
        continue;
      }
      // Measure the text. A label that would cross the left or right edge
      // slides inside it, by at most half its width; past that, or past
      // the top edge, it is hidden whole.
      node.hidden = false;
      const tw = node.offsetWidth;
      const th = node.offsetHeight;
      const frac = label.align === "end" ? 1 : label.align === "middle" ? 0.5 : 0;
      const want = x - frac * tw;
      const left = Math.max(EDGE, Math.min(w - EDGE - tw, want));
      const top = y - th / 2;
      const box = { left, top, right: left + tw, bottom: top + th };
      const g = LABEL_GAP;
      const overprints = placed.some((n) =>
        box.left < n.right + g && box.right > n.left - g && box.top < n.bottom && box.bottom > n.top);
      node.hidden = Math.abs(left - want) > tw / 2 || top < 0 || tw > w - 2 * EDGE || overprints;
      node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      if (!node.hidden) placed.push(box);
    }
  };
  const resized = new ResizeObserver(update);
  resized.observe(frame);

  return {
    set: (list) => {
      layer.replaceChildren();
      items = list.map((label) => {
        const node = document.createElement("span");
        node.className = label.tick ? "anim-figure__label anim-figure__label--tick" : "anim-figure__label";
        node.textContent = label.text;
        if (label.text.includes("\n")) {
          // A label on two lines keeps its breaks and lines up on its anchor.
          node.style.whiteSpace = "pre";
          node.style.textAlign = label.align === "end" ? "right" : label.align === "middle" ? "center" : "left";
        }
        layer.append(node);
        return { label, node };
      });
      update();
    },
    update,
    dispose: () => {
      resized.disconnect();
      layer.remove();
      items = [];
    },
  };
}

/**
 * @typedef {Object} AxisSpec
 * @property {"x" | "y" | "z"} axis  the scene axis it runs along
 * @property {string} name  what it measures, with its unit
 * @property {number[]} [ticks]  data values to label
 * @property {(value: number) => string} [format]  tick text; String() if absent
 */

/**
 * Labels for the axes of a box (design §3.4): a name and its ticks along
 * the front bottom edge for x, the front left edge for y and the right
 * bottom edge for z, each hidden when its axis points at the viewer. Pass
 * the result to createLabels().set().
 * @param {import("./orbit.js").SceneBox} box  in scene units
 * @param {{x: (v: number) => number, y: (v: number) => number, z: (v: number) => number}} map
 *        data value to scene coordinate, per axis (lib/scene.js toScene)
 * @param {AxisSpec[]} axes
 * @returns {Label[]}
 */
export function axisLabels(box, map, axes) {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  /** @type {Label[]} */
  const out = [];
  for (const { axis, name, ticks = [], format = String } of axes) {
    /** @type {(s: number) => [number, number, number]} */
    const at =
      axis === "x" ? (s) => [s, y0, z1] : axis === "y" ? (s) => [x0, s, z1] : (s) => [x1, y0, s];
    /** @type {[number, number, number]} */
    const along = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
    /** @type {"start" | "middle" | "end"} */
    const align = axis === "y" ? "end" : axis === "z" ? "start" : "middle";
    const dy = axis === "y" ? 0 : 14;
    for (const value of ticks) {
      out.push({ text: format(value), at: at(map[axis](value)), align, along, tick: true, dy });
    }
    const middle = axis === "x" ? (x0 + x1) / 2 : axis === "y" ? (y0 + y1) / 2 : (z0 + z1) / 2;
    out.push({ text: name, at: at(middle), align, along, dy: axis === "y" ? 0 : 30 });
  }
  return out;
}

/**
 * @typedef {Object} Chip
 * @property {HTMLElement} node  the chip box
 * @property {(next: {text?: string, at?: [number, number, number]}) => void} set
 * @property {() => void} update  place it again (lib/highlight.js calls it on
 *           every draw; a caller of its own calls it on every camera change)
 * @property {() => void} dispose
 */

/** CSS px between the anchor and the chip, and kept clear of the frame edge. */
const CHIP_GAP = 14;
const CHIP_EDGE = 4;

/**
 * A chip (three-visual-language design §4): a fact about the highlight,
 * in --ambe-plot-ink on --ambe-highlight-chip with a highlight border and
 * a short line swatch, joined by a leader to a dot on its anchor. It sits
 * above and to the right of the anchor, or wherever it fits. When the
 * anchor leaves the frame (a zoom, a turn), the chip pins inside the
 * nearest edge with a small arrow toward the anchor instead of hiding,
 * and the dot and leader go. aria-hidden like every label: the canvas
 * aria-label carries the same fact.
 * @param {HTMLElement} frame
 * @param {import("../anim-three.js").ThreeContext} ctx
 * @param {{text: string, at: [number, number, number]}} opts
 * @returns {Chip}
 */
export function createChip(frame, ctx, opts) {
  let { text, at } = opts;
  const layer = document.createElement("div");
  layer.className = "anim-figure__overlay anim-chip-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = `<svg class="anim-chip__leader"><line></line></svg><span class="anim-chip__dot"></span>` +
    `<span class="anim-chip"><span class="anim-chip__swatch"></span><span class="anim-chip__text"></span></span>`;
  frame.append(layer);
  const leader = /** @type {SVGSVGElement} */ (layer.firstElementChild);
  const line = /** @type {SVGLineElement} */ (leader.firstElementChild);
  const dot = /** @type {HTMLElement} */ (layer.children[1]);
  const node = /** @type {HTMLElement} */ (layer.children[2]);
  const label = /** @type {HTMLElement} */ (node.lastElementChild);
  const v = new ctx.three.Vector3();

  const update = () => {
    label.textContent = text;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    ctx.camera.updateMatrixWorld();
    v.set(...at).project(ctx.camera);
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * h;
    const bw = node.offsetWidth;
    const bh = node.offsetHeight;
    /** @param {number} value @param {number} lo @param {number} hi */
    const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
    const inside = v.z >= -1 && v.z <= 1 && x >= CHIP_EDGE && x <= w - CHIP_EDGE && y >= CHIP_EDGE && y <= h - CHIP_EDGE;
    let left;
    let top;
    if (inside) {
      left = x + CHIP_GAP + bw > w - CHIP_EDGE ? x - CHIP_GAP - bw : x + CHIP_GAP;
      top = y - CHIP_GAP - bh < CHIP_EDGE ? y + CHIP_GAP : y - CHIP_GAP - bh;
      left = clamp(left, CHIP_EDGE, w - CHIP_EDGE - bw);
      top = clamp(top, CHIP_EDGE, h - CHIP_EDGE - bh);
      delete node.dataset.edge;
      dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      // The leader runs from the dot to the nearest point of the chip.
      line.setAttribute("x1", x.toFixed(1));
      line.setAttribute("y1", y.toFixed(1));
      line.setAttribute("x2", clamp(x, left, left + bw).toFixed(1));
      line.setAttribute("y2", clamp(y, top, top + bh).toFixed(1));
    } else {
      // Room for the 5 px arrow between the chip and the edge.
      const pin = CHIP_EDGE + 5;
      left = clamp(x - bw / 2, pin, w - pin - bw);
      top = clamp(y - bh / 2, pin, h - pin - bh);
      // The edge the anchor lies beyond, by the larger overshoot.
      const dx = x < CHIP_EDGE ? CHIP_EDGE - x : x > w - CHIP_EDGE ? x - w + CHIP_EDGE : 0;
      const dy = y < CHIP_EDGE ? CHIP_EDGE - y : y > h - CHIP_EDGE ? y - h + CHIP_EDGE : 0;
      node.dataset.edge = dx >= dy ? (x < CHIP_EDGE ? "left" : "right") : y < CHIP_EDGE ? "top" : "bottom";
    }
    layer.classList.toggle("anim-chip-layer--pinned", !inside);
    node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  };
  const resized = new ResizeObserver(update);
  resized.observe(frame);

  return {
    node,
    set: (next) => {
      text = next.text ?? text;
      at = next.at ?? at;
      update();
    },
    update,
    dispose: () => {
      resized.disconnect();
      layer.remove();
    },
  };
}
