# tools/: how the audio and the animation data are made

Three scripts build the site's assets, run in order. Each one refuses to write
anything it cannot verify, so a broken stage stops the chain instead of
poisoning the assets.

```
tools/make-audio.sh        # Piper TTS  -> docs/assets/audio/*-original.wav
tools/capture-hardware.sh  # originals  -> real AMBE-3000 -> *.ambe + *-ambe.wav
tools/make-data.py         # audio+bits -> docs/assets/data/*.json
```

None of this is a codec. `make-audio.sh` is text-to-speech and resampling.
`capture-hardware.sh` drives a physical DVSI AMBE-3000 chip over a serial port.
`make-data.py` is generic DSP (RMS, autocorrelation, FFT) over WAV files.
There is no AMBE encoder or decoder in this repository.

## 1. `make-audio.sh`

Synthesises four sentences in two Piper voices and resamples them to 8 kHz /
16-bit / mono. Then it trims silence and normalises each clip to −20 dBFS RMS
with a −1 dBFS peak ceiling. It needs the following.

- `piper` (default `~/.local/bin/piper`, override with `PIPER`)
- `sox`
- the voice models `en_US-lr-high` and `en_US-hfc_female-medium` (override the
  directory with `VOICES_DIR`)

Piper is not sample-deterministic between runs, so re-running this replaces the
masters and every downstream asset must be rebuilt.

## 2. `capture-hardware.sh`

Encodes each clip on the hardware and decodes the resulting frames back on the
same hardware, then applies the same normalisation to the decoded audio.

Needs a ThumbDV-class AMBE-3000 device (`PORT`, default
`/dev/cu.usbserial-DK0EOQVS`) and a driver binary called `thumbdv-rig` (`RIG`,
default: whatever is on `PATH`) that speaks the DVSI AMBE-3000 packet protocol
with `probe` / `enc` / `dec` subcommands.

**`thumbdv-rig` is not part of this repository and is not distributed with it.**
It comes from the author's separate codec project. Any tool that can drive an
AMBE-3000 over serial will do; the script only needs those three subcommands.
Without the hardware this stage cannot be faked, and the rest of the chain will
correctly refuse to run.

## 3. `make-data.py`

Turns the captured audio and channel frames into the JSON the site's animations
draw. Needs Python 3 and numpy.

```
python3 tools/make-data.py [featured-clip-id]     # default: lr-b
```

Writes `<clip-id>/{frames,waveform,spectra}.json` for all eight clips. Then it
copies the featured clip's three files to the top level and writes
`clips.json`. It fails if any file would exceed the 1 MB budget.

A figure that needs a data file of its own adds `tools/data/<name>.py` with a
`main(out_dir)` function. `make-data.py` finds these files itself. It runs
each one in name order after the clips, with `out_dir` set to
`docs/assets/data`.

`docs/assets/data/SCHEMA.md` documents every field it emits and its units. It
also says whether each field was measured off the chip or derived by DSP. That
document is the contract the animation code is written against. If you
change the script, you must change it too.

## Fallback images: `make-posters.py`

Draws the static image each interactive figure shows without JS and in print,
to `docs/assets/posters/<slug>.png`. Run it with `just posters`. Each figure
has one file in `tools/posters/`, named after its slug with underscores
(`vq_space.py` draws `vq-space.png`). That file holds a
`draw(poster, data_dir)` function. `make-posters.py` finds these files
itself, so adding a figure does not touch it. The images use the slate theme tokens from `extra.css` and the
Source Sans 3 font vendored in `tools/fonts/`.

A chapter links its image as `assets/posters/<slug>.png`, relative to its
Markdown file in `docs/`, and the build rewrites the link to sit under the
site's base path. `verify-site.py` fails on an image that does not load from
the built site.

## Scope check: `check-scope.py`

Holds the figure modules in `docs/javascripts/` to the project's scope. It
fails if any module synthesises audio with WebAudio, or reads the 72 channel
bits as parameters. Only `anim-core.js` and the two older bit displays read a
frame's hex string. Other figures get single bits from `hexBits()` and never
assemble them into numbers. The 3D code reads nothing at all. It takes the 2D
module's arrays. Here the 3D code means these files.

- every `anim-<slug>-3d.js`
- `anim-three.js`
- `lib/view-switch.js`
- every `lib/*.js` that imports `anim-three.js` or names it in a type

`just scope` runs the check, and so does `just check`.

## Parallel figure work: `slots.json`, `check-slots.py`, `check-baselines.py`

The three-everywhere figures are built in parallel branches, so each one
changes only what it owns. For each figure, `tools/slots.json` lists its own
files and the marked blocks it may edit in shared files. The markers look like
this.

- `/* slot: <slug> */` ... `/* end slot: <slug> */`
- `<!-- slot: <slug> -->` in Markdown
- `# slot: <slug>` in Python

```
just check-slots <slug>       # the branch's diff stays inside <slug>'s files and blocks
just check-baselines <slug>   # and inside <slug>'s pixel baselines
just slots                    # every block exists as often as slots.json says
```

Both branch checks diff from the merge base with `main` to the working
tree, uncommitted changes included (`--base <branch>` names another;
`check-slots.py` reads its default from `base` in `slots.json`). A
figure's `*-frame-reduced` baselines change only when its registry file, `tests/figures/registry/<slug>.json`, lists
`"frame-reduced"` in `rebaseline` with a `rebaselineReason`.

`verify-site.py --allowances` prints each figure's share of its page's 3D
budget by the plan's rule, from the measured runtime; `--write` stores the
numbers in the registry files.
