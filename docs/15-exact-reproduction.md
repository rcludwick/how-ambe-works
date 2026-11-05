# Reverse engineering to an exact reproduction

<!-- Owner: part-v-open-problem agent -->

A natural goal for an independent implementation is an encoder that
emits the same bits as the chip for the same audio. Bit-identical output
looks like the strongest possible proof of a match. It is the wrong test.
{: .lede }

This repository contains no codec implementation. Whether anyone may
build or distribute one is a separate question; see
[The patent landscape](16-patents.md), which is engineering research and
not legal advice.
{: .source-note }

## Why many different waveforms encode to the same frame

Every 20 milliseconds, you feed the encoder 160 linear audio samples
at an 8 kHz sample rate. Those 160 16-bit samples contain 2,560 bits of
raw data. The encoder compresses those samples into one 72-bit channel
frame <span class="cite">JARL D-STAR system specification</span>.
The [Listen](12-listen.md) page demonstrates this same 36-to-1 ratio
on physical hardware.

To achieve that compression, the encoder discards most of the raw
waveform. The analysis stage drops the original acoustic phase entirely
(see [Why vocoders discard phase](04-phase.md)). It approximates
turbulent noise with coarse spectral bands and quantizes harmonic
amplitudes into discrete codebook levels. Thousands of distinct
waveforms share the same pitch, voicing, and envelope levels. As a result,
many different sound recordings compress to the exact same 72-bit frame.

The converse fails as well. The same audio recording, fed to two
different encoders that both follow the published patents, will rarely
produce the exact same bits.

## Why two faithful encoders produce different bits

The expired patents describe an algorithmic framework rather than a
single frozen reference program. They leave specific numerical choices
open, and every choice alters the bit pattern:

- **Pitch estimation.** Two pitch estimators can pick fundamental
  frequencies that differ by less than 0.5 Hz. The number of harmonics
  L equals ⌊4000 / f₀⌋ (see [Turning measurements into bits](09-quantization.md)).
  A tiny shift in pitch can add or remove a harmonic. That change shifts
  the boundary of every frequency band and reorders the quantization
  bits across the rest of the frame.
- **Arithmetic precision.** Digital signal processors use fixed-point
  registers or specific rounding modes. A 16-bit accumulator rounds
  intermediate calculations differently from a 32-bit floating-point
  unit. When a spectral measurement sits near a codebook decision
  boundary, a single round-off error flips a bit.
- **Leaky prediction across time.** To compress harmonic amplitudes,
  the encoder subtracts a predicted level based on the previous frame
  (see [US 5,630,011](16-patents.md)). A prediction decay factor γ
  below 1 links consecutive frames together. Any bit difference on
  one frame alters the predicted baseline for every frame that follows.
- **Free algorithmic thresholds.** The patents leave key parameters as
  general curves rather than fixed lookup tables. The predictor decay
  factor, the band voicing error thresholds, and the pitch-tracking
  penalties all vary as functions of harmonic count L (see
  [What is not established](13-what-is-not-established.md)).

Both encoders can produce valid frames that synthesize clear, natural
speech, yet their raw bitstreams will never match bit for bit.

## Clean-room implementations and functional interoperability

In software engineering, a clean-room design recreates functionality
from public specifications and external observations without copying
proprietary code.

A voice codec requires functional interoperability rather than
bit-exact cloning. An implementation must satisfy three requirements.

Intelligibility matters first. The decoded voice must preserve speech formants,
consonants, and pitch dynamics so listeners understand every word.

Spectral fidelity comes next. The reconstructed power spectrum must track
the original voice envelope within human auditory tolerances.

Syntax compliance seals the link. Every transmitted packet must obey the frame
structure, error-correction layout, and bit scrambling rules expected
by standard hardware receivers.

A bit error rate of 5% between two encoders does not imply poor speech.
If two encoders pick slightly different quantization vectors that both lie
near the true spectral envelope, the decoded waveforms will sound
identical to a human listener even though dozens of bits differ.

## The two-way cross-connect test

Because encoders can disagree on bits while agreeing on speech, you
cannot verify an encoder by comparing its binary output against the chip.
You must test interoperability at the decoder in both directions:

1. **Independent encoder to hardware decoder:** You feed frames from
   your independent software encoder into the hardware AMBE-3000 chip.
   If the chip synthesizes clean, intelligible speech, your encoder
   produces valid frames that comply with the standard.
2. **Hardware encoder to independent decoder:** You feed frames from
   the hardware AMBE-3000 encoder into your independent software decoder.
   If your decoder synthesizes clean, intelligible speech, your decoder
   interprets the framing and quantization parameters correctly.

This cross-connect test, documented in
[How to measure a hardware vocoder](14-how-to-measure.md), proves
interoperability directly. It measures what the listener hears rather
than whether two independent programs made the same tie-breaking
decision on a marginal bit.

## The hardware decoder as the reference standard

In any communication system, the receiver defines what a transmission
means. A transmitter can send any bits it wants; the transmission only
succeeds if the receiver decodes it correctly.

For digital amateur radio, commercial DVSI chips in handheld transceivers
and repeaters act as the physical reference. If a software encoder
produces frames that a physical transceiver decodes without distortion or
frame drops, that encoder is functionally compatible with the network.

Several decoder subtleties remain open topics for experimentation:

- **Spectral post-filtering.** Hardware decoders apply mild formant
  sharpening to boost intelligibility in noise (see
  [Synthesis: rebuilding the voice](11-synthesis.md)). Determining
  whether hardware enables this filter by default requires direct
  audio output comparisons.
- **Error concealment.** When channel noise corrupts a frame, the
  decoder mutes or repeats previous spectral parameters. Measuring
  how the chip responds to bit errors helps an independent decoder
  match hardware behavior during weak-signal reception.
- **Silicon revisions.** Commercial chips evolved from AMBE-1000 through
  AMBE-2000 to the AMBE-3000. Hardware measurements confirm whether
  DVSI preserved identical quantization tables across generations.

Treating the hardware as an empirical reference lets you verify a codec
through listening tests and spectral measurements, turning reverse
engineering from an impossible quest for identical bits into a solvable
problem of signal reproduction.

---

**[← How to measure a hardware vocoder](14-how-to-measure.md)** · **[Next: The patent landscape →](16-patents.md)**
{: .chapter-nav }

Last reviewed: 2026-10-15.
{: .source-note }
