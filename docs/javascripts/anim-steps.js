// @ts-check
/* ===========================================================================
 * anim-steps.js: the step list of a figure host, turned into a stepper.
 * ---------------------------------------------------------------------------
 * The chapter writes a figure's steps as Markdown in <ol class="anim-steps">
 * (see the contract at the top of anim.css). Without JS that list is the
 * figure's text. With JS, readSteps() reads each step's state before the
 * module touches the DOM, and createStepper() moves the list into the live
 * figure and shows one step at a time. The list is moved, never copied, so
 * footnote references keep their ids and their links.
 *
 * Steps set state from a whitelist of keys (STEP_KEYS in each module), and
 * the module decides what each key does. After the last step every control
 * is free.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

import { $, prefersReducedMotion } from "./anim-core.js";

/**
 * @typedef {Object} Step
 * @property {HTMLLIElement} item  the rendered <li>; moved, never copied
 * @property {string} html         its rendered Markdown
 * @property {Record<string, string>} state  whitelisted data-* values
 */

/**
 * @typedef {Object} Stepper
 * @property {(index: number) => void} go  show a step and apply its state
 * @property {number} index                the step on show
 */

/** Gives each moved list an id for aria-controls. */
let listCount = 0;

/**
 * Read a host's steps. Call before the module changes the host.
 * @param {Element} host the `[data-anim]` element
 * @param {readonly string[]} keys data-* names a step may set, without "data-"
 * @returns {Step[]} in order; empty if the host has no step list
 */
export function readSteps(host, keys) {
  const list = host.querySelector(":scope > ol.anim-steps");
  /** @type {Step[]} */
  const steps = [];
  if (!list) return steps;
  for (const item of list.children) {
    if (!(item instanceof HTMLLIElement)) continue;
    /** @type {Record<string, string>} */
    const state = {};
    for (const key of keys) {
      const value = item.getAttribute(`data-${key}`);
      if (value !== null) state[key] = value;
    }
    steps.push({ item, html: item.innerHTML, state });
  }
  return steps;
}

/**
 * Show `steps` one at a time inside `root`'s `.anim-figure__step` panel.
 *
 * @param {HTMLElement} root the live `.anim-figure`
 * @param {Step[]} steps from {@link readSteps}; must not be empty
 * @param {(state: Record<string, string>, how: {animate: boolean}) => void} apply
 *        set the figure to a step's state; animate is false under reduced motion
 * @param {{signal: AbortSignal, onFree?: () => void}} options
 * @returns {Stepper}
 */
export function createStepper(root, steps, apply, options) {
  const { signal, onFree = () => {} } = options;
  const panel = $(root, ".anim-figure__step", HTMLElement);
  const frameEl = root.querySelector(".anim-figure__scroll, .anim-figure__frame");
  if (frameEl && frameEl.parentElement === root) {
    root.insertBefore(panel, frameEl);
  }
  const list = steps[0].item.parentElement;
  if (!(list instanceof HTMLOListElement)) throw new Error("anim-steps: steps have no list");
  list.id ||= `anim-steps-${(listCount += 1)}`;
  panel.append(list);

  const nav = document.createElement("div");
  nav.className = "anim-steps__nav";
  nav.innerHTML = `
    <button class="anim-btn" type="button" data-step="prev" aria-controls="${list.id}">Previous</button>
    <output class="anim-readout" aria-live="polite"></output>
    <button class="anim-btn" type="button" data-step="next" aria-controls="${list.id}">Next</button>`;
  panel.append(nav);
  const prev = $(nav, '[data-step="prev"]', HTMLButtonElement);
  const next = $(nav, '[data-step="next"]', HTMLButtonElement);
  const readout = $(nav, "output", HTMLOutputElement);

  let index = 0;
  const last = steps.length - 1;

  /**
   * @param {number} target
   * @param {boolean} animate
   */
  const show = (target, animate) => {
    index = Math.max(0, Math.min(last, target));
    steps.forEach((step, k) => {
      step.item.hidden = k !== index;
      if (k === index) step.item.setAttribute("aria-current", "step");
      else step.item.removeAttribute("aria-current");
    });
    readout.value = `Step ${index + 1} of ${steps.length}`;
    // A disabled button drops focus to <body>, and the keys below with it.
    if (index === 0 && document.activeElement === prev) next.focus();
    prev.disabled = index === 0;
    next.textContent = index === last ? "Free play" : "Next";
    delete root.dataset.steps;
    apply(steps[index].state, { animate: animate && !prefersReducedMotion() });
  };

  prev.addEventListener("click", () => show(index - 1, true), { signal });
  next.addEventListener(
    "click",
    () => {
      if (index < last) return show(index + 1, true);
      root.dataset.steps = "free";
      onFree();
    },
    { signal }
  );
  // A focused canvas (a keyboard probe) and the form fields keep their keys.
  root.addEventListener(
    "keydown",
    (event) => {
      const target = event.target;
      if (event.defaultPrevented || target instanceof HTMLCanvasElement ||
          target instanceof HTMLInputElement || target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement) return;
      /** @type {Record<string, number>} */
      const moves = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: last };
      if (!(event.key in moves)) return;
      event.preventDefault();
      show(moves[event.key], true);
    },
    { signal }
  );

  show(0, false);
  // Set after the first step shows, so loading the page announces nothing.
  // From here on a screen reader reads each step's text as it appears.
  list.setAttribute("aria-live", "polite");
  return {
    go: (target) => show(target, true),
    get index() {
      return index;
    },
  };
}
