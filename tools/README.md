# tools/ — how the audio and the animation data are made

Three scripts build the site's assets, run in order. Each one refuses to write
anything it cannot verify, so a broken stage stops the chain instead of
poisoning the assets.

```
tools/make-audio.sh        # Piper TTS  -> docs/assets/audio/*-original.wav
tools/capture-hardware.sh  # originals  -> real AMBE-3000 -> *.ambe + *-ambe.wav
tools/make-data.py         # audio+bits -> docs/assets/data/*.json
```

Two more serve the animations, and are not part of that chain:

```
tools/make-narration.py    # scripts    -> animations/narration/audio/*.wav
tools/render-local.sh      # scenes     -> out/*.mp4 + out/*.vtt
```

None of this is a codec. `make-audio.sh` is text-to-speech and resampling,
`capture-hardware.sh` drives a physical DVSI AMBE-3000 chip over a serial port,
and `make-data.py` is generic DSP (RMS, autocorrelation, FFT) over WAV files.
There is no AMBE encoder or decoder in this repository.

## 1. `make-audio.sh`

Synthesises four sentences in two Piper voices, resamples to 8 kHz / 16-bit /
mono, trims silence, and normalises each clip to −20 dBFS RMS with a −1 dBFS
peak ceiling.

Needs `piper` (default `~/.local/bin/piper`, override with `PIPER`), `sox`, and
the voice models `en_US-lr-high` and `en_US-hfc_female-medium` (override the
directory with `VOICES_DIR`).

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

Writes `<clip-id>/{frames,waveform,spectra}.json` for all eight clips, copies
the featured clip's three files to the top level, and writes `clips.json`. It
fails if any file would exceed the 1 MB budget.

Every field it emits, its units, and whether it was measured off the chip or
derived by DSP, is documented in `docs/assets/data/SCHEMA.md`. That document is
the contract the animation code is written against — change the script and you
must change it too.

## 4. `make-narration.py`

Turns `animations/narration/<slug>.txt` into the per-cue WAVs the manim scenes
play, using the same Piper install and the same level discipline as
`make-audio.sh` (RMS to −20 dBFS, single constant gain, −1 dBFS peak ceiling).

```
tools/make-narration.py             # every script
tools/make-narration.py pipeline    # one scene
tools/make-narration.py --check     # what exists, what is missing, how long
```

The output is committed. The render never runs Piper: it reads finished WAVs,
so CI needs no voice models and a render is reproducible from the repository.
Regenerating re-times every scene that plays the audio, because each stage is
held open until its line has finished.

Read the VOICE section in the script's header before changing voices. The
current voice's MODEL_CARD clears its *corpus* but shows a fine-tune lineage
back to a research-only model, which is unresolved.

## 5. `render-local.sh`

Renders the scenes without waiting on CI, which takes about half an hour for
the pipeline scene. Defaults to 480p15, which turns a scene around in about a
minute.

```
tools/render-local.sh               # every scene
tools/render-local.sh pipeline      # one scene
tools/render-local.sh -q h -o vq    # 1080p60, then open it
tools/render-local.sh -l            # list the scenes
```

Writes `out/<slug>.mp4` and `out/<slug>.vtt`, the same names CI publishes, and
reports each clip's duration and whether audio and captions came out. Needs
`uv`, which pins Python 3.12 from `.python-version`; PyAV has no wheel above
3.12 and a newer interpreter fails in a way that reads as a manim problem.
