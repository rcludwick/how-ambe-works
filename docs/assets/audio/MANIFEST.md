# Audio corpus manifest

Sixteen WAV files live in this directory: eight synthesised sentences and
the eight that came back from a DVSI AMBE-3000 chip. This file records
everything needed to rebuild them, and the licence of every input.

Read it before adding, replacing or reusing any clip here. Everything in
`docs/assets/` is redistributed under the site's CC BY 4.0 grant, so an
input carrying a non-commercial or share-alike condition cannot be used,
however good it sounds.

Built 2026-08-11. Chain: `tools/make-audio.sh`, then
`tools/capture-hardware.sh`, then `tools/make-data.py`.

## 1. Voices, and why these two

| | Male | Female |
| --- | --- | --- |
| Clip prefix | `lr` | `lj` |
| Piper voice | `en_US-libritts_r-medium` | `en_US-ljspeech-high` |
| Corpus | LibriTTS-R, <http://www.openslr.org/141/> | LJ Speech, <https://keithito.com/LJ-Speech-Dataset/> |
| Corpus licence | **CC BY 4.0** (attribution required) | **public domain** |
| Speakers in model | 904 | 1 |
| Speaker used | piper index **690**, corpus speaker **240** | the only one |
| Median fundamental measured over the four clips | 132 to 153 Hz | 174 to 219 Hz |

Both licences come from the voice's `MODEL_CARD` in the
[rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)
repository, tag `v1.0.0`, fetched alongside the models.

**Required attribution.** The male clips must carry: *speech synthesised
with a Piper voice trained on LibriTTS-R (OpenSLR 141), used under CC BY
4.0*. It appears on the Listen page and in the sources chapter. Anyone
reusing `lr-*.wav` inherits that obligation.

**Model lineage, stated because a manifest is the place for it.** The
`libritts_r` medium `MODEL_CARD` says the voice was "fine-tuned from
English lessac medium on train-clean-360". The *speech corpus* behind
these clips is LibriTTS-R under CC BY 4.0, but the weights started from a
checkpoint trained on the Blizzard Challenge 2013 Lessac data, whose terms
are research-only. No claim is made here about how far that reaches into
a synthesised waveform. The single-speaker LJ Speech voice has no such
lineage: its model card records training from scratch on public-domain
audio.

**Voices that were considered and rejected on licence grounds**, so that
nobody spends the download again: `ryan` (RyanSpeech, CC BY-NC-SA 4.0),
`hfc_female` (NICT Hi-Fi Captain, CC BY-NC-SA 4.0), `lessac` (Blizzard
Challenge 2013, research-only), `alan` (terms stated only as a URL).

### How speaker 690 was chosen

The model carries 904 speakers and the LibriTTS-R speaker table, which is
where the recorded sex of each speaker lives, was not reachable when this
corpus was built. The choice was therefore made acoustically, and it is
reproducible:

1. Synthesise sentence (b) for every 15th speaker index, 61 in total.
2. Track the fundamental of each with a centre-clipped autocorrelation
   over 60 to 350 Hz and keep those with a median below 145 Hz.
3. Re-synthesise all four sentences for the twelve strongest of those and
   rank on pitch stability (90th percentile of fundamental divided by the
   10th), mean autocorrelation peak, and voiced fraction.
4. Prefer a candidate with energy concentrated in 300 to 3400 Hz, since
   everything below 300 Hz is largely spent by the time a clip has been
   through an 8 kHz codec.

Index 690 (corpus speaker 240) won: median fundamental 135 Hz, pitch
spread 1.42, mean autocorrelation peak 0.669, voiced fraction 0.72, and
64 % of its energy in the 300 to 3400 Hz band on the sibilant sentence.
Index 375 (speaker 5319) was the runner-up, lower in pitch at 117 Hz but
with more of its energy below 300 Hz.

The sex recorded in `clips.json` for this voice is therefore a measurement
of pitch, not a corpus fact.

## 2. Exact inputs

Piper: `piper-tts` **1.4.2** (the `piper1-gpl` package,
<https://github.com/OHF-voice/piper1-gpl>), CPU, running under Python
3.13. Resampling: **SoX 14.4.2**.

Models, from
`https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/<voice>/<quality>/`:

| File | SHA-256 |
| --- | --- |
| `en_US-libritts_r-medium.onnx` | `10bb85e071d616fcf4071f369f1799d0491492ab3c5d552ec19fb548fac13195` |
| `en_US-libritts_r-medium.onnx.json` | `b471dc60d2d8335e819c393d196d6fbf792817f40051257b269878505bc9afb3` |
| `en_US-ljspeech-high.onnx` | `5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a` |
| `en_US-ljspeech-high.onnx.json` | `7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14` |

`tools/make-audio.sh` verifies all four hashes before it synthesises
anything and refuses to run on a mismatch. The models themselves are not
committed: they are 75 MB and 109 MB, and they are reproducibly
downloadable from the URL above.

Text, verbatim, one sentence per clip letter, identical in both voices:

| Letter | Text |
| --- | --- |
| a | `The quick brown fox jumps over the lazy dog.` |
| b | `CQ CQ CQ this is a test of the AMBE voice codec.` |
| c | `She sells sea shells by the sea shore.` |
| d | `We were away a year ago.` |

## 3. Synthesis parameters

No inference parameter was overridden. Each model's own defaults, as
stored in its `.onnx.json`, were used:

| | `libritts_r` medium | `ljspeech` high |
| --- | --- | --- |
| `noise_scale` | 0.333 | 0.667 |
| `noise_w` | 0.333 | 0.333 |
| `length_scale` | 1 | 1 |
| Phonemiser | espeak-ng, voice `en-us` | espeak-ng, voice `en` |
| Native rate | 22050 Hz | 22050 Hz |

Piper is not sample-deterministic between runs: it samples from the
model's noise distribution and takes no seed argument. Re-running the
chain produces different waveforms of the same sentences, which is why the
hardware capture and the JSON in `docs/assets/data/` must be rebuilt in
the same pass. Reproducibility here means the *procedure* is fixed and the
inputs are pinned, not that the bytes repeat.

## 4. Exact commands

Synthesis, per clip. `$SPK` is `-s 690` for the male voice and empty for
the female one:

```
printf '%s\n' "$TEXT" \
  | piper --model "$VOICES_DIR/$MODEL.onnx" $SPK --output_file - > raw.wav
```

Resample to the codec's native format, with 1 dB of headroom so that
resampler ringing cannot clip before the level stage:

```
sox raw.wav -r 8000 -c 1 -b 16 res.wav gain -1
```

Trim silence, then restore a fixed lead-in and tail so the encoder has a
frame or two to settle:

```
sox res.wav trim.wav silence 1 0.1 0.3% reverse silence 1 0.1 0.3% reverse pad 0.08 0.12
```

Level, one constant gain per file, computed from `sox stat`: RMS to
−20 dBFS, backed off if that would put the peak above −1 dBFS. No
compression, no limiting, no EQ, no noise reduction:

```
sox trim.wav out.wav gain "$G"
```

Hardware round trip, using a driver that speaks the DVSI AMBE-3000 packet
protocol. `thumbdv-rig` comes from the author's separate codec project and
is not part of this repository; any equivalent tool will do:

```
thumbdv-rig enc "$clip-original.wav" "$clip.ambe" --port "$PORT"
thumbdv-rig dec "$clip.ambe" raw-decode.wav      --port "$PORT"
```

The decoded audio is then levelled by the same rule as the originals. The
gains that step applied this time ranged from −0.66 to +0.03 dB, so the
chip had already preserved level closely.

## 5. Hardware

| Field | Value |
| --- | --- |
| Device | NW Digital Radio ThumbDV |
| Chip | DVSI AMBE-3000 |
| `PRODID` | `AMBE3000F` |
| `VERSTRING` (firmware) | `V121.E100.XXXX.C110.G514.R014.A0030608.C0020208` |
| Link | USB serial, 460800 baud |
| Mode | D-STAR full rate, 72 bits per 20 ms frame |
| Encode latency reported by probe | min 14945 µs, mean 16016 µs, max 17144 µs |

Sustained throughput over this link is measured separately, in
`docs/assets/data/probe-rate.md`.

## 6. What was produced

All sixteen files are 8 kHz, 16-bit, mono PCM.

| Clip | Text | Original | Frames | Channel bytes | Decoded |
| --- | --- | --- | --- | --- | --- |
| `lr-a` | a | 2.450 s | 123 | 1107 | 2.460 s |
| `lr-b` | b | 3.173 s | 159 | 1431 | 3.180 s |
| `lr-c` | c | 2.015 s | 101 | 909 | 2.020 s |
| `lr-d` | d | 1.193 s | 60 | 540 | 1.200 s |
| `lj-a` | a | 3.651 s | 183 | 1647 | 3.660 s |
| `lj-b` | b | 4.157 s | 208 | 1872 | 4.160 s |
| `lj-c` | c | 2.747 s | 138 | 1242 | 2.760 s |
| `lj-d` | d | 1.668 s | 84 | 756 | 1.680 s |

Total: 1056 frames, 9504 channel bytes, 21.05 s of speech.

The decoded file is always a whole number of frames long, so it runs up to
one frame past its original. The two are not sample-aligned either: the
chip's own pipeline delay is 253 to 275 samples across this set, measured
by envelope cross-correlation and recorded per clip in
`docs/assets/data/clips.json`.

The channel bytes themselves are committed as
`docs/assets/data/frames/<clip>.ambe`, nine bytes per frame, exactly as
the chip emitted them.

## 7. Verification

Every file was checked with Python's `wave` module and with `soxi`, never
by ear. The checks, all of which passed:

- sample rate 8000, one channel, 16-bit, on all sixteen files
- no file silent (RMS above −45 dBFS) and none clipped (peak below
  −0.05 dBFS); every file sits at −20.00 dBFS RMS by construction
- each `.ambe` file a whole number of nine-byte frames
- each decoded file exactly `frames × 160` samples, and within one frame
  of its original's length
- envelope cross-correlation between each original and its decoded
  counterpart between 0.967 and 0.991, which is the check that the file
  coming back is the same speech that went in

`tools/make-audio.sh` and `tools/capture-hardware.sh` perform these checks
themselves and abort rather than write a file that fails one.

## 8. If you replace a voice

1. Read the new voice's `MODEL_CARD` and confirm the corpus licence
   permits redistribution under CC BY 4.0. Check for a fine-tuning
   lineage, as recorded in section 1.
2. Update the model list and hashes in `tools/make-audio.sh` and in
   section 2 above.
3. Re-run all three tools. The JSON under `docs/assets/data/` is derived
   from these exact waveforms and goes stale the moment they change.
4. Update the attribution on the Listen page and in the sources chapter,
   and the clip ids in `tools/make-data.py`, `docs/javascripts/anim-*.js`
   and `animations/manim/*.py`.

## Licences and credits

- LJ Speech Dataset, Keith Ito, public domain.
- LibriTTS-R (OpenSLR 141), CC BY 4.0. Koizumi et al., *LibriTTS-R: A
  Restored Multi-Speaker Text-to-Speech Corpus*, 2023.
- Piper voice models, rhasspy/piper-voices v1.0.0.
- The WAV files in this directory are published under the site's
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) licence,
  subject to the LibriTTS-R attribution above.
