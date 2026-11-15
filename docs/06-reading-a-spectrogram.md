# How to read a speech spectrogram

<!-- Owner: part-ii-voice agent -->

An audio waveform shows air pressure over time. A Fourier spectrum shows
energy over frequency at one frozen instant. A spectrogram combines both:
it lays frequency on the vertical axis, time on the horizontal axis, and
uses brightness or color to show how loud each frequency is at every moment.
{: .lede }

To radio operators familiar with modern waterfall displays on software-defined
radios, a spectrogram looks immediately familiar. A receiver waterfall scrolls
signals across the RF spectrum over time. A speech spectrogram does the same thing
for acoustic audio, revealing the internal structure of words as they are spoken.

## Stacking frequency slices into a time-frequency picture

To build a spectrogram, the computer computes the Discrete Fourier Transform of
short, overlapping windows of sound. It cuts those windows exactly as
[Windows and frames](03-windows-and-frames.md) describes.

For an audio recording sampled at 8,000 samples per second:

1. The analyzer takes a window of samples, typically 20 to 30 milliseconds long.
2. It applies a smooth window function to suppress [spectral leakage](18-glossary.md#spectral-leakage).
3. It computes the Fourier transform, calculating magnitude levels in decibels from 0 to 4 kHz.
4. It paints that spectrum as a single vertical column of pixels, where higher decibels are brighter.
5. It advances the window forward in time by a small stride, often 5 to 20 milliseconds, and repeats.

Lining these vertical columns side by side creates a complete two-dimensional map.
In [**Figure 1.4**](01-why-sinusoids.md#fig-1-4), you can watch this process in action.
As a spoken sentence plays, each 20-millisecond window adds its own spectral slice
to the scrolling terrain.

## Recognizing vowels by their horizontal harmonic ridges

When you look at a spectrogram of voiced speech, two features jump out:

First, a dense ladder of thin horizontal stripes runs along the time axis. Each stripe
is one [harmonic](18-glossary.md#harmonic) of the vocal folds, spaced at exact multiples
of the fundamental frequency f₀. When the speaker's pitch rises, the stripes spread
further apart. When the pitch falls, the stripes draw closer together.

Second, broad horizontal bands of intense brightness span several adjacent harmonics.
These are the [formants](18-glossary.md#formant) shaped by the vocal tract:

- The vowel "ah" concentrates heavy brightness in a low band around 700 to 1,000 Hz.
- The vowel "ee" splits its energy. A dark band near 300 Hz sits below a bright band
  high up near 2,200 Hz.
- Diphthongs like "eye" or "ow" show formants gliding smoothly up and down like rolling hills
  as the tongue and jaw shift position mid-syllable.

The individual stripes tell you the speaker's pitch. The broad bright patches tell you
which vowel is being spoken.

## Recognizing consonants by their vertical bursts and hiss

Consonants look completely different from vowels on a spectrogram because they do not
rely on smooth glottal pulsing:

- **Fricatives ("s", "sh", "f"):** Turbulent air rushing past teeth or lips creates
  broadband noise. Instead of clean horizontal harmonic stripes, fricatives appear as
  grainy clouds of random speckles. An "s" sound concentrates its speckles high up
  between 3 kHz and 4 kHz, while an "sh" sound drops lower toward 2 kHz.
- **Stop consonants:** These are "p" and "b", "t" and "d", and "k" and "g". The
  speaker blocks the airway completely, which creates a brief gap of near-total
  silence. A sudden vertical line of energy follows when the pressure pops open. This sharp vertical slash is the burst.
- **Nasals ("m", "n"):** Sound resonates through the nasal cavity while the mouth is
  closed. This introduces sharp antiresonances, or notches, where energy drops to near zero
  between formants.

In [**Figure 1.2**](01-why-sinusoids.md#fig-1-2), you can inspect this contrast directly.
The repeating pulses of the vowel in "sells" stand out clearly against the turbulent
unvoiced hiss of surrounding consonants.

## Why vocoders read the spectrogram from left to right

A human reading a spectrogram looks at syllables, words, and transitions across hundreds
of milliseconds. A digital voice codec must operate under a strict constraint.
It has to keep its latency low.

In real-time amateur radio communication, a transmission cannot wait for the end of a
sentence before sending bits. The vocoder processes the spectrogram strictly from left
to right, one 20-millisecond column at a time:

1. It measures the fundamental pitch f₀ from the harmonic spacing.
2. It evaluates whether each frequency band contains harmonic stripes or turbulent noise.
3. It samples the height of the formant envelope at each harmonic peak.
4. It packages those numbers into 72 bits and transmits the frame over the RF link.

In [**Figure 12.1**](12-listen.md#fig-12-1), you can compare the original speech
spectrogram against the spectrogram reconstructed by a commercial DVSI AMBE-3000 chip.
The reconstructed spectrogram preserves the pitch trajectories, formant contours, and
voicing boundaries. The chip reproduces clear voice while using only a fraction of the
original data rate.

---

**[← Voice as source and filter](05-source-and-filter.md)** · **[Next: Multi-band excitation →](07-multi-band-excitation.md)**
{: .chapter-nav }

Last reviewed: 2026-10-15.
{: .source-note }
