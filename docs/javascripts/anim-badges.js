// @ts-check
/* ===========================================================================
 * anim-badges.js: provenance badges, one wording everywhere (design §2).
 * ---------------------------------------------------------------------------
 * docs/assets/data/SCHEMA.md marks one field MEASURED: frames[].hex, the 72
 * bits the AMBE-3000 produced. Playback of the chip's decoded WAV is the
 * chip's output too. Those are the only places a "measured" badge may sit,
 * inside an element marked data-measured="hex" or "decoded-audio";
 * tests/figures/badges.spec.js enforces it. Everything computed from audio
 * is derived, and the badge says from which audio.
 *
 * MIT licensed (see LICENSE-MIT).
 * ======================================================================== */

/**
 * @typedef {"measured" | "derived-decoded" | "input" | "derived-input" | "synthetic" | "illustrative"} BadgeKind
 */

/** @type {Readonly<Record<BadgeKind, {className: string, from?: "decoded" | "input", text: string}>>} */
export const BADGES = Object.freeze({
  measured: { className: "anim-badge--measured", text: "measured (AMBE-3000)" },
  "derived-decoded": { className: "anim-badge--derived", from: "decoded", text: "derived (from the chip's decoded audio)" },
  input: { className: "anim-badge--input", text: "input (Piper TTS, 8 kHz)" },
  "derived-input": { className: "anim-badge--derived", from: "input", text: "derived (from the input audio)" },
  synthetic: { className: "anim-badge--synthetic", text: "synthetic" },
  illustrative: { className: "anim-badge--illustrative", text: "illustrative" },
});

/**
 * @param {BadgeKind} kind
 * @returns {HTMLSpanElement}
 */
export function badge(kind) {
  const spec = BADGES[kind];
  const node = document.createElement("span");
  node.className = `anim-badge ${spec.className}`;
  if (spec.from) node.dataset.from = spec.from;
  node.textContent = spec.text;
  return node;
}
