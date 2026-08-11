# How AMBE Works

An illustrated, source-cited explanation of the AMBE voice codec — the vocoder
behind D-STAR and other digital amateur radio modes. The site walks through the
Multi-Band Excitation model, the analysis stage (pitch, voicing, spectral
amplitudes), how those measurements become bits, what a D-STAR frame looks like
on the air, and how a decoder rebuilds a voice from it.

Read it at <https://rcludwick.github.io/how-ambe-works/>.

Written by Rob Ludwick, AJ7HR. Prose is CC BY 4.0; tooling is MIT.

## This repository contains no working codec

**There is no AMBE encoder or decoder here, in any language.** This is
explanatory material only.

- Code shown in the pages is **pseudocode**, clearly labelled as such, and is
  not executable. There are no complete quantizer tables and no bit-packing
  routines.
- The animation code draws precomputed data. It performs no AMBE analysis or
  synthesis. The data it draws was captured from real hardware and stored as
  JSON.
- The manim scenes under `animations/` render figures. They are illustration,
  not implementation.

If you want a working codec, this is not that repository, and no part of it can
be compiled into one.

## Sources

Every technical claim on the site names its source inline. Content is drawn
from expired US patents, the published MBE literature (Griffin & Lim 1988;
Hardwick & Lim 1988), the JARL D-STAR system specification, public DVSI product
documentation, and the author's own measurements of AMBE hardware. The full
list, and the method used, is on the *Sources and method* page.

Later AMBE variants (AMBE+2 / half-rate) remain covered by live patents. The
site discusses that landscape but deliberately does not teach how to practise
those claims; implementation-level detail is confined to full-rate AMBE / IMBE
covered by patents that have expired.

## Licensing

This repository is dual-licensed, split by what the file is:

| Part | License |
| --- | --- |
| Prose, documentation, images, diagrams, and site content (everything under `docs/`, except the code listed below) | [CC BY 4.0](LICENSE-CC-BY-4.0) |
| Tooling and build scripts (`tools/`, `animations/`, `docs/javascripts/`, `docs/stylesheets/`, CI workflows, `zensical.toml`) | [MIT](LICENSE-MIT) |

Reuse the writing with attribution; reuse the tooling under MIT.

## Independence

This project is independent of, and not endorsed by, Digital Voice Systems,
Inc. AMBE, AMBE+, and AMBE+2 are trademarks of Digital Voice Systems, Inc.,
used here only to identify the technology under discussion. Nothing here is
affiliated with, sponsored by, or approved by DVSI.

## Building the site locally

```
pip install zensical
zensical serve
```

The animation videos under `docs/assets/video/` are build output and are not
committed; render them with the `animations` workflow, or locally with manim
against the scenes in `animations/manim/`. That workflow renames each render
to the slug the pages ask for (`decomposition`, `harmonic-sum`, `pipeline`,
`vq`). Until it has run, every `<video>` shows its poster instead. The posters
are committed, live in `docs/assets/posters/`, and are regenerated with
`python3 tools/make-posters.py`.

The interactive figures are ES modules under `docs/javascripts/`. A single
entry point, `javascripts/anim.js`, imports the shared runtime and every
figure module, and it is the only script `zensical.toml` loads. A new figure
is registered by adding one import there and one
`<div data-anim="slug"></div>` to the page that needs it.
