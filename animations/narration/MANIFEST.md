# Narration manifest

Twenty-six WAV files live in `audio/`: one per cue, across the four scenes.
They are the voice-over for the rendered videos, and they set those videos'
pacing, because each stage is held open until its line has finished.

Read this before regenerating or changing voices. The videos ship under the
site's CC BY 4.0 grant, which hands every reader commercial rights, so an input
carrying a non-commercial, share-alike or research-only condition cannot be
used here however good it sounds.

Built 2026-08-11 by `tools/make-narration.py` from `*.txt` in this directory.

## The voice

| | |
| --- | --- |
| Piper voice | `en_US-norman-medium` |
| Corpus | LibriVox, <https://librivox.org> |
| Corpus licence | **public domain** |
| Model lineage | **trained from scratch**, per the upstream `MODEL_CARD`: "Trained from scratch on medium quality settings for 1200 epochs", on a custom ~15.5 hour LibriVox set |
| Speakers in model | 1, so no speaker index is passed |
| Attribution required | none |

Both the corpus and the weights are clean. That is the whole reason this voice
was chosen, and it is the property to re-check if it is ever swapped.

## Why not the voice used for the speech samples

The male clips on the Listen page use `en_US-libritts_r-medium`. Its corpus is
CC BY 4.0, but its `MODEL_CARD` also says the weights were "fine-tuned from
English lessac medium", and the Blizzard Challenge 2013 Lessac terms restrict
use to Research Purposes, naming "the development, marketing, commercialisation,
sale or **licencing** of voice synthesis or speech recognition products or
services" among the commercial purposes they exclude.

Whether those terms reach a synthesised waveform three models downstream is
unsettled, and `docs/assets/audio/MANIFEST.md` deliberately makes no claim
either way about the existing clips. Narration is a different case: it is new,
it carries no measurement, and a clean voice cost nothing. So it uses one.

That leaves the Listen page clips as the remaining open question. Re-making
them is not a re-synthesis, it is a re-capture through the AMBE-3000, since
every number on that page is measured from audio that went through the chip.

## Rebuilding

```
tools/make-narration.py            # every scene
tools/make-narration.py pipeline   # one scene
tools/make-narration.py --check    # what exists, and how long each line runs
tools/render-local.sh              # then re-render, since timings change
```

Piper is not sample-deterministic between runs. Regenerating replaces every
clip and re-times every scene that plays it, which is why the audio is
committed rather than rebuilt per render, and why CI never runs Piper.

## Levels

Each clip is trimmed of leading and trailing silence, then scaled by a single
constant gain so its RMS lands on −20 dBFS, unless that would push its peak
above −1 dBFS, in which case the ceiling wins. No compression, no limiting, no
EQ. This is the same rule `tools/make-audio.sh` applies to the speech samples,
and is documented in `docs/assets/data/SCHEMA.md`.

## Captions

`animations/manim/narration.py` writes a WebVTT track next to each rendered
video, timed from the same clock that scheduled the audio and worded from the
`.txt` scripts here. The videos carry information as speech, so the caption
track is not optional; both workflows fail a render that does not produce one.
