/* ===========================================================================
   anim.js — the site's single animation entry point.
   ---------------------------------------------------------------------------
   zensical.toml loads exactly one script:

       extra_javascript = [
         { path = "javascripts/anim.js", type = "module" },
       ]

   and this file pulls in the runtime and every figure module. Static imports
   are evaluated in order, and each figure module imports anim-core.js itself,
   so the runtime is always initialised before anything tries to mount. Adding
   a figure means adding one line here rather than editing the site config.

   Each module below self-registers against a slug and mounts on every
   `<div data-anim="<slug>">` in the page, including pages reached by instant
   navigation. A page that carries no such div costs nothing beyond the
   module's own parse.

   These modules draw precomputed data captured from hardware. None of them
   implements any part of AMBE. See the header of anim-core.js.

   MIT licensed (see LICENSE-MIT).
   ======================================================================== */

import "./anim-core.js";

import "./anim-harmonics.js"; // data-anim="harmonics"  — 01, index
import "./anim-voicing.js"; //   data-anim="voicing"    — 01
import "./anim-frames.js"; //    data-anim="frames"     — 02
import "./anim-envelope.js"; //  data-anim="envelope"   — 03
import "./anim-bits.js"; //      data-anim="bits"       — 04
import "./anim-synth.js"; //     data-anim="synth"      — 05
import "./anim-complex.js"; //   data-anim="complex"     — 02
