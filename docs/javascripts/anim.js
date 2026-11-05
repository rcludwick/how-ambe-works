/* ===========================================================================
   anim.js: the site's single animation entry point.
   ---------------------------------------------------------------------------
   zensical.toml loads exactly one script:

       extra_javascript = [
         { path = "javascripts/anim.js", type = "module" },
       ]

   and this file registers every figure. Adding a figure means adding one
   registration here rather than editing the site config.

   Every figure registers with mountLazy(), so its code loads only on a
   page that carries its host, and mounts on every `<div data-anim="<slug>">`
   in the page, including pages reached by instant navigation:

       mountLazy("vq-space", () => import("./anim-vq-space.js"));

   A page that carries no such div loads nothing but this file and
   anim-core.js. No 3D code is reachable from here by a static import
   (tools/verify-site.py).

   These modules draw precomputed data captured from hardware. None of them
   implements AMBE. Some draw generic signal processing on synthetic data or
   on one frame's precomputed values; see the header of anim-core.js.

   Some modules export mount() rather than init(); a second line adapts
   each until its figure's task converts it.
   Each registration sits between its slug's slot markers, which that
   figure's task alone may edit (tools/check-slots.py).

   3D views go through anim-three.js, which imports three.js from
   vendor/three/ only when a view is asked for.

   MIT licensed (see LICENSE-MIT).
   ======================================================================== */

import { mountLazy } from "./anim-core.js";

/* slot: utterance */
mountLazy("utterance", () => import("./anim-utterance.js")); // 01
/* end slot: utterance */

/* slot: filter */
mountLazy("filter", () => import("./anim-filter.js")); // 01
/* end slot: filter */

/* slot: three-numbers */
mountLazy("three-numbers", () => import("./anim-three-numbers.js")); // 01
/* end slot: three-numbers */

/* slot: utterance-spectra */
mountLazy("utterance-spectra", () => import("./anim-utterance-spectra.js")); // 01
/* end slot: utterance-spectra */

/* slot: complex */
mountLazy("complex", () => import("./anim-complex.js")); // 02
/* end slot: complex */

/* slot: probe */
mountLazy("probe", () => import("./anim-probe.js")); // 02
/* end slot: probe */

/* slot: window-shapes */
mountLazy("window-shapes", () => import("./anim-window-shapes.js")); // 03
/* end slot: window-shapes */

/* slot: leakage */
mountLazy("leakage", () => import("./anim-leakage.js")); // 03
/* end slot: leakage */

/* slot: tradeoff */
mountLazy("tradeoff", () => import("./anim-tradeoff.js")); // 03
/* end slot: tradeoff */

/* slot: frames */
mountLazy("frames", () => import("./anim-frames.js")); // 08
/* end slot: frames */

/* slot: pitch-search */
mountLazy("pitch-search", () => import("./anim-pitch-search.js")); // 08
/* end slot: pitch-search */

/* slot: harmonics */
mountLazy("harmonics", () => import("./anim-harmonics.js")); // index, 07
/* end slot: harmonics */

/* slot: voicing */
mountLazy("voicing", () => import("./anim-voicing.js")); // 07
/* end slot: voicing */

/* slot: vq-space */
mountLazy("vq-space", () => import("./anim-vq-space.js")); // 09
/* end slot: vq-space */

/* slot: envelope */
mountLazy("envelope", () => import("./anim-envelope.js")); // 09
/* end slot: envelope */

/* slot: envelope-blocks */
mountLazy("envelope-blocks", () => import("./anim-envelope-blocks.js")); // 09
/* end slot: envelope-blocks */

/* slot: frame-path */
mountLazy("frame-path", () => import("./anim-frame-path.js")); // 10
/* end slot: frame-path */

/* slot: bits */
mountLazy("bits", () => import("./anim-bits.js")); // 10
/* end slot: bits */

/* slot: fec-protection */
mountLazy("fec-protection", () => import("./anim-fec-protection.js")); // 10
/* end slot: fec-protection */

/* slot: harmonic-sum */
mountLazy("harmonic-sum", () => import("./anim-harmonic-sum.js")); // 11
/* end slot: harmonic-sum */

/* slot: synth */
mountLazy("synth", () => import("./anim-synth.js")); // 11
/* end slot: synth */

/* slot: frame-boundary */
mountLazy("frame-boundary", () => import("./anim-frame-boundary.js")); // 11
/* end slot: frame-boundary */

/* slot: listen-terrain */
mountLazy("listen-terrain", () => import("./anim-listen-terrain.js")); // 12
/* end slot: listen-terrain */

/* slot: gain-definitions */
mountLazy("gain-definitions", () => import("./anim-gain-definitions.js")); // 13
/* end slot: gain-definitions */
