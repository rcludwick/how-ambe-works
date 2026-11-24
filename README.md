# How AMBE Works

An illustrated, source-cited explanation of the AMBE voice codec, the vocoder
behind D-STAR and other digital amateur radio modes. The site walks through the
Multi-Band Excitation model and the analysis stage, which measures pitch,
voicing and spectral amplitudes. Then it shows how those measurements become
bits and what a D-STAR frame looks like on the air. Last, it shows how a
decoder rebuilds a voice from that frame.

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

If you want a working codec, this is not that repository, and no part of it can
be compiled into one.

## Sources

Every technical claim on the site names its source inline. The content comes
from five kinds of source.

- expired US patents
- the published MBE literature (Griffin & Lim 1988; Hardwick & Lim 1988)
- the JARL D-STAR system specification
- public DVSI product documentation
- the author's own measurements of AMBE hardware

The full
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
| Tooling and build scripts (`tools/`, `docs/javascripts/`, `docs/stylesheets/`, CI workflows, `zensical.toml`) | [MIT](LICENSE-MIT) |

Reuse the writing with attribution; reuse the tooling under MIT.

The 3D views use [three.js](https://threejs.org/) release 0.185.1 (MIT
license), copied unmodified into `docs/javascripts/vendor/three/` with its
license file. Its three line addons (`LineMaterial`, `LineSegmentsGeometry`,
`LineSegments2`) sit in `addons/` there. The only change to them is in the
line that imports three.

## Independence

This project is independent of, and not endorsed by, Digital Voice Systems,
Inc. AMBE, AMBE+, and AMBE+2 are trademarks of Digital Voice Systems, Inc.,
used here only to identify the technology under discussion. Nothing here is
affiliated with, sponsored by, or approved by DVSI.

## Building the site locally

```
uv run --group docs zensical serve     # or: just serve
```

The zensical version comes from `uv.lock`, the same one the deploy uses.

The interactive figures are ES modules under `docs/javascripts/`. A single
entry point, `javascripts/anim.js`, registers every figure. It is the only
script `zensical.toml` loads. A new figure is registered by adding one
`mountLazy()` line there and one `<div data-anim="slug"></div>` to the page
that needs it. Its module then loads only on a page that carries its host.

## What is on the site

Every interactive figure has a 3D view built on three.js. All the 3D views
share one visual language, made of these parts.

- colour by data
- one highlighted subject with a chip that states a fact
- zoom
- one explanatory animation

Depth carries a quantity the flat
picture has to squeeze out, and one camera preset reproduces the flat
picture. bits and fec-protection are drawn head-on, with no depth axis.

| Page | Figure | 3D view | Depth | Animation |
|---|---|---|---|---|
| index, 07 What AMBE actually is | `harmonics` | the periodic spectrum for every pitch, with the harmonic fan and the L staircase | fundamental f0, 60 to 400 Hz | A lower pitch packs more harmonics under the same 3.7 kHz cutoff. |
| 01 Why sinusoids | `utterance` | the vowel closeup cut into pitch periods and stacked | period number | A vowel is one pitch period repeated; a fricative has no period to stack. |
| 01 Why sinusoids | `filter` | the output split into one lane per harmonic, a gain wall and a delay line | frequency, lane k at k x 150 Hz | The filter changes each harmonic by its own gain and delay, so the output is not the input made bigger. |
| 01 Why sinusoids | `three-numbers` | every phase of the sine at once, one crest line per crest | phase, 0 to 360 degrees | Phase slides the same wave along time; one full turn of phase moves it by one period. |
| 01 Why sinusoids | `utterance-spectra` | a waterfall of the whole sentence | time, one slice per 20 ms | A sentence is a run of different spectra, one every 20 ms. |
| 02 The Fourier transform and the DFT | `probe` | the sine-test and cosine-test products as stems, with the running sum | sample index | Multiplying by the test wave and adding up gives a large sum only at the matching frequency. |
| 02 The Fourier transform and the DFT | `complex` | the rotating point drawn through time: a helix with two shadow walls | real part | A sine wave is the shadow of a point going round a circle. |
| 03 Windows and frames | `leakage` | one row of bins per tone frequency | cycles in the block, 6.00 to 7.00 | Off a bin, one tone spreads into every bin; a window trades that spread for a wider peak. |
| 03 Windows and frames | `tradeoff` | a waterfall of block spectra | time | A short block sharpens time and blurs frequency; a long block does the opposite. |
| 07 What AMBE actually is | `voicing` | eight band ridges over a whole clip, cut by a threshold plane | band, 1 to 8 | One frame is one row of the whole clip. |
| 08 Analysis | `frames` | one row per analysis window, stacked by frame | frame index, i-4 to i+4 | Each analysis window overlaps its neighbours, so the coder sees more than 160 samples. |
| 08 Analysis | `pitch-search` | the frame's autocorrelation as a curtain, a comb per candidate period, the score on the back wall | candidate period P, 22 to 114 samples | The score adds the correlation at every multiple of a candidate period, so half the true period also scores high. |
| 09 Turning measurements into bits | `envelope` | a waterfall of measured envelopes over one voiced stretch | frame time, 20 ms per row | Over a voiced stretch, each 20 ms frame gives a similar envelope with a different number of harmonics under it. |
| 09 Turning measurements into bits | `envelope-blocks` | one frame's envelope rebuilt from fewer and fewer DCT coefficients | coefficients kept per block | Keeping fewer coefficients loses detail first, tilt next, level never. |
| 09 Turning measurements into bits | `vq-space` | synthetic dots, a scalar grid and a trained codebook in a cube; Speech mode plots harmonics 4, 5 and 6 of the input | the third number | A stretched cloud leaves most cubes empty. |
| 10 The D-STAR frame on the air | `frame-path` | one frame from input to 72 bits and back in six stages, and on the air in a seventh | time, 20 ms per frame | A frame is one slice of a repeating stack. |
| 10 The D-STAR frame on the air | `bits` | the 72 measured bits of a frame as tiles | head-on | Every 20 ms the chip sends a new set of 72 measured bits, and many positions change from one frame to the next. |
| 10 The D-STAR frame on the air | `fec-protection` | a burst of errors through an illustrative interleaver into the codewords | head-on | Interleaving spreads a burst of errors so each codeword sees few enough to correct. |
| 11 Synthesis: rebuilding the voice | `harmonic-sum` | one ribbon per harmonic, their sum in front | harmonic number | The sum accumulates. |
| 11 Synthesis: rebuilding the voice | `frame-boundary` | each harmonic's envelope across a crossfade between two frames | harmonic number, 1 to 16 | Crossfading at the boundary barely touches the low harmonics and takes every harmonic from 5 up below half; the highest harmonics dip twice. |
| 11 Synthesis: rebuilding the voice | `synth` | the spectrum panel through time, split by generator | frame index, 12 each side | Each frame's spectrum is built from two generators, chosen band by band. |
| 12 Listen | `listen-terrain` | the original and decoded spectrograms as sheets, with their difference | frequency, 0 to 3969 Hz | The decoded speech keeps the harmonic peaks and deepens the valleys between them. |
| 13 What is not in the public record | `gain-definitions` | each frame's harmonic comb, set back by its spread | spread in dB | At equal spread the two gain definitions differ by different amounts, so no constant converts one to the other. |

With WebGL 2 and no reduced-motion preference, a figure opens in 3D when it
first comes near the viewport and plays its animation once; a page keeps at
most three 3D views live and parks the rest to their 2D canvas. Under
reduced motion a figure opens in 2D, which is the animation's end state, and
the 3D control lands on that end state with no motion; without WebGL the 3D
control is disabled. Without JavaScript, and in print, each shows a static
image from `docs/assets/posters/`.

## Before merging

Nothing in CI runs on a pull request (see the comment at the top of
`.github/workflows/pages.yml`), so the merge gate is local. In the branch's
worktree:

```
npm ci
npx playwright install chromium webkit
just check
just test
```

`just check` does the following.

- type-checks the figure scripts
- checks the `// @ts-check` pragma
- checks the vendored three.js against its recorded hashes and file list
- lints copy in the files `tools/check-copy.py` lists
- runs the tool tests
- checks the data
- builds the site with `--strict` and checks the built tree

`just test` starts `zensical serve` on port 8031 and runs the figure
tests in `tests/figures/` in Chromium, and the context-cap spike in
`tests/figures/three-cap.spec.js` in WebKit as well. Both must pass before a
branch is merged.

`just check` also runs `tools/check-scope.py`, which holds the figure
modules to the project's scope. Under that scope a figure synthesises no
audio and never reads the channel bits as parameters. A figure draws generic DSP on synthetic data or
on one frame's precomputed values, or a precomputed scatter of per-frame
measurements from the input audio, plotted and never sequenced or sounded.

A figure built on `work/three-everywhere` also passes
`just check-slots <slug>` and `just check-baselines <slug>` before it
merges. Those checks confirm that its branch changes only its own files, its
own slot blocks in shared files, and its own pixel baselines
(`tools/README.md`).

Each 3D figure has its own spec, `tests/figures/<slug>.spec.js`. Every one
covers the same ground:

- JS off, print, and no WebGL
- each step, and Previous after free play
- context loss and recovery
- ten navigations with one WebGL context at most
- reduced motion
- a phone at 375 px with no horizontal scroll
- screenshots of both views at desktop and phone width

`tests/figures/lifecycle-three.spec.js` walks 07, 09, 10 and 11 ten times
with each 3D view open and checks that the page never holds more than one
WebGL context.

The pixel baselines in `tests/figures/__screenshots__/` exist for macOS
only. Text renders differently on other systems, so on Linux or Windows the
screenshot tests report the baselines as missing.

On every push to main, the `check` job in `pages.yml` repeats the type,
pragma and three.js hash checks. The deploy waits for it.
