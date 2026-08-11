# tools/ — how the audio and the animation data are made

Three scripts, run in order. Each one refuses to write anything it cannot
verify, so a broken stage stops the chain instead of poisoning the assets.

```
tools/make-audio.sh        # Piper TTS  -> docs/assets/audio/*-original.wav
tools/capture-hardware.sh  # originals  -> real AMBE-3000 -> *.ambe + *-ambe.wav
tools/make-data.py         # audio+bits -> docs/assets/data/*.json
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
the voice models `en_US-norman-high` and `en_US-hfc_female-medium` (override the
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
python3 tools/make-data.py [featured-clip-id]     # default: norman-b
```

Writes `<clip-id>/{frames,waveform,spectra}.json` for all eight clips, copies
the featured clip's three files to the top level, and writes `clips.json`. It
fails if any file would exceed the 1 MB budget.

Every field it emits, its units, and whether it was measured off the chip or
derived by DSP, is documented in `docs/assets/data/SCHEMA.md`. That document is
the contract the animation code is written against — change the script and you
must change it too.
