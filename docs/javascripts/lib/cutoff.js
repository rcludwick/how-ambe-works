// @ts-check
/* lib/cutoff.js: the harmonic cutoff used by harmonic-sum and frame-path.
   L = floor(3700 / f0) follows the 3700 Hz bandwidth US 5,754,974 gives
   for alpha = 0.925 at 8 kHz. Its column and line are not yet checked
   against the page images (three-figures plan, Task P6), so the label
   names no patent and carries the illustrative badge. D-STAR's own rule is
   not public. MIT licensed (see LICENSE-MIT). */
export const CUTOFF_HZ = 3700;
/** Shown beside every L the figures print, always with CUTOFF_BADGE after
    it; the badge carries the word "illustrative", so the label does not. */
export const CUTOFF_LABEL = "cutoff at 3.7 kHz";
/** @type {import("../anim-badges.js").BadgeKind | null} */
export const CUTOFF_BADGE = "illustrative";
