# How to measure a hardware vocoder

<!-- Owner: part-v-open-problem agent -->

The vocoder chip inside a digital radio has no published source code and
no published field map. To understand what the hardware does, you drive it
with synthetic audio signals you created. Then you record what comes out and
compare the two streams.
{: .lede }

## The test bench and packet interface

The test bench uses a commercial DVSI AMBE-3000 device connected over a serial
link, as documented in [Sources and method](17-sources.md#how-the-hardware-measurements-were-made).

The chip treats encoding and decoding as two independent requests:

1. **To encode:** You send a packet containing 160 linear audio samples and
   receive one 9-byte, 72-bit channel frame. At an 8 kHz sample rate, 160
   samples last 20 milliseconds.
2. **To decode:** You send a 9-byte channel frame and receive 160 linear audio samples.

Because the two directions run independently, you can inspect each side on its own.
You can feed the decoder synthetic frames the encoder never produced, or feed the
encoder's frames into an independent software decoder. This two-way cross-connect
test forms the core verification method described in
[What is not established](13-what-is-not-established.md).

## Measuring total algorithmic delay

To measure delay, you feed the encoder a single short pulse in an otherwise silent
audio stream. You then pass the resulting frame to the decoder and record the output.
The offset between the input pulse and the output pulse marks the total round-trip
delay of the codec.

You must measure this offset in samples of the output audio stream rather than in
wall-clock time. Serial buffers and operating system USB drivers add latency that
drifts from run to run. Audio sample counts do not drift.

You can resolve this delay to frame resolution. Commercial AMBE processes audio in
20-millisecond frames <span class="cite">JARL D-STAR system specification</span>.
The reconstructed pulse will not have the same sharp shape as the input. The
decoder rebuilds audio from a fundamental pitch and a set of harmonic amplitudes
(see [Synthesis](11-synthesis.md)).

## Finding the voicing decision boundary

An obvious experiment to find the voicing threshold is to mix a steady sine wave
with white noise, gradually increase the noise level, and observe which bits in the
frame flip from voiced to unvoiced.

This experiment hits a wall immediately. Digital Voice Systems has never published
which bits in the 72-bit D-STAR frame carry the voicing decisions.

Instead, the test bench observes the decoded audio. When you feed in a sine wave mixed
with noise, you observe whether the frequency band around the tone emerges as a clean
harmonic oscillation or as shaped noise. By repeating this test across multiple
frequencies and noise ratios, you can map where the chip's internal classifier
switches from periodic to turbulent excitation.

## Mapping harmonic frequency response and gain conventions

To map how the encoder scales amplitudes, you feed pure single-frequency sine waves
into the encoder at calibrated decibel levels from 100 Hz to 3.8 kHz.

Because the encoder fits harmonic samples to the measured spectrum, testing tones
that align with exact multiples of fundamental frequencies allows you to compare the
decoded output against the three possible gain conventions:

- Peak harmonic magnitude
- Root-mean-square (RMS) band energy
- Integrated spectral power

In [Figure 13.1](13-what-is-not-established.md#fig-13-1), you can see how these three
conventions produce different amplitude trajectories from identical input spectra.

## What black-box tests cannot establish

A black-box test reveals what the hardware produces for a given input. It cannot
reveal the internal algorithm the chip used to produce it.

If two different computational methods generate identical outputs, no external test
can distinguish between them. For example, a precomputed lookup table and an on-the-fly
formula that evaluate to the same numbers look identical from outside the pins.
[What is not established](13-what-is-not-established.md) details the boundaries of what
hardware testing can and cannot prove.

---

**[← What is not established](13-what-is-not-established.md)** · **[Next: Reverse engineering to an exact reproduction →](15-exact-reproduction.md)**
{: .chapter-nav }

Last reviewed: 2026-10-15.
{: .source-note }
