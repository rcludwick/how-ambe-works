---
title: Interactive diagrams
description: Every interactive figure in the guide, chapter by chapter, with a link and a one-line summary.
---

# Interactive diagrams

This page lists every figure in the guide, chapter by chapter. Each title links straight to the figure.

Most figures have numbered steps. Each step picks the view that makes its point more clearly. Some steps show the figure flat, in 2D. Others show it with depth, in 3D. After the last step, *Free play* lets you switch between 2D and 3D yourself. The Steps column says how many steps a figure has and how many of them are in 3D.

## The overview figure

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 1: Harmonic comb spacing and pitch](index.md#fig-1) | The harmonics of one pitch under the codec’s 3.7 kHz cutoff. A deeper voice fits more of them. | None: 2D or 3D, your choice |

---

## Part I · The Mathematics You Need

### [1. Why sinusoids](01-why-sinusoids.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 1.1: Amplitude, frequency and phase of a sine wave](01-why-sinusoids.md#fig-1-1) | One sine wave and the three numbers that describe it: how tall it is, how fast it repeats, and where it starts. | None: 2D or 3D, your choice |
| [Figure 1.2: Periodic vowel cycles and unvoiced consonant noise](01-why-sinusoids.md#fig-1-2) | A spoken sentence, magnified on the vowel in “sells”, where the same pulse repeats every 5.38 ms. | 3, 2 in 3D |
| [Figure 1.3: Wave shapes passing through a low-pass filter](01-why-sinusoids.md#fig-1-3) | A 150 Hz sine wave goes through a low-pass filter and comes out the same shape, only resized and a little later. | 3 |
| [Figure 1.4: Short-time spectra across a spoken sentence](01-why-sinusoids.md#fig-1-4) | The spectrum of each 20 ms window as a sentence plays, from 0 to 4 kHz. | 3, 1 in 3D |

### [2. The Fourier transform and the DFT](02-fourier-and-the-dft.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 2.1: Multiplying and summing a single test frequency](02-fourier-and-the-dft.md#fig-2-1) | A 200 Hz test wave multiplied against a 200 Hz recording. When the two line up, the running sum climbs. | 2, all in 2D |
| [Figure 2.2: Recovering magnitude and phase with sine and cosine tests](02-fourier-and-the-dft.md#fig-2-2) | A sine test and a cosine test run together. Their two sums always land on the same circle. | 3, 1 in 3D |
| [Figure 2.3: Three ways to write one point on the complex plane](02-fourier-and-the-dft.md#fig-2-3) | One point written as a pair of numbers, as a length and an angle, and with Euler’s formula. All three agree. | 4, 1 in 3D |
| [Figure 2.4: Frequency resolution across the 50 Hz DFT bins](02-fourier-and-the-dft.md#fig-2-4) | The combined test swept from 0 to 400 Hz on a 20 ms block. It peaks at 200 Hz and reads zero at every other 50 Hz step. | 1, all in 2D |

### [3. Windows and frames](03-windows-and-frames.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 3.1: Tapering the edges of a block](03-windows-and-frames.md#fig-3-1) | The same block cut three ways. Hann and Hamming fade the edges, so the cut has no sudden step. | 4, 1 in 3D |
| [Figure 3.2: Spectral leakage from a tone between bins](03-windows-and-frames.md#fig-3-2) | A tone between bins leaks across the spectrum. A window keeps that leak from hiding a weak tone nearby. | 6, 1 in 3D |
| [Figure 3.3: Time resolution versus frequency resolution](03-windows-and-frames.md#fig-3-3) | Short blocks show when a click happens. Long blocks separate the harmonics. No block length does both. | 5, all in 2D |

---

## Part III · The Model

### [7. Multi-band excitation](07-multi-band-excitation.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 7.1: Harmonic comb spacing and pitch](07-multi-band-excitation.md#fig-7-1) | How many harmonics fit under the 3.7 kHz cutoff at each pitch, for a deep voice and a high one. | 3, 1 in 3D |
| [Figure 7.2: Single-switch and 8-band voicing on real speech](07-multi-band-excitation.md#fig-7-2) | One 20 ms frame of a vowel, a hiss or a mix, coded with one voicing switch or with eight. | 5, 1 in 3D |

### [8. How the encoder measures pitch, voicing and amplitudes](08-analysis.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 8.1: 20 ms frames and their overlapping analysis windows](08-analysis.md#fig-8-1) | Each 20 ms frame moves on 160 samples, but its 255-sample window reaches into the frames on both sides. | 5, 1 in 3D |
| [Figure 8.2: Autocorrelation comb and pitch score](08-analysis.md#fig-8-2) | Each candidate pitch period, scored by adding up the autocorrelation at one, two and three periods. | 5, all in 2D |

### [9. Turning measurements into bits](09-quantization.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 9.1: Scalar grid versus vector codebook](09-quantization.md#fig-9-1) | Neighboring harmonics rise and fall together, so a trained codebook puts its codes where the points actually are. | 6, 2 in 3D |
| [Figure 9.2: Harmonic levels of a vowel frame and its neighbors](09-quantization.md#fig-9-2) | One vowel frame’s harmonic levels, the error that rounding them adds, and the frames around it. | 5, 3 in 3D |
| [Figure 9.3: Block DCT hierarchy from level and tilt to fine detail](09-quantization.md#fig-9-3) | The spectral envelope split into blocks. Dropping coefficients removes fine detail first and keeps each block’s level. | 4, 1 in 3D |

### [10. The D-STAR frame on the air](10-the-dstar-frame.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 10.1: Life of a 20 ms D-STAR voice frame from audio to RF](10-the-dstar-frame.md#fig-10-1) | One 20 ms frame of speech followed through a real AMBE-3000, from audio to bits and back. | 8, 2 in 3D |
| [Figure 10.2: The 72 captured channel bits of a 20 ms voice frame](10-the-dstar-frame.md#fig-10-2) | The 72 bits the chip sent for each frame. Even in a steady vowel, the changes spread across all 9 bytes. | 3, all in 3D |
| [Figure 10.3: Golay and Hamming error correction with bit interleaving](10-the-dstar-frame.md#fig-10-3) | Golay and Hamming codes, with interleaving, protecting the most important bits against errors. | 4, all in 3D |

### [11. Synthesis: rebuilding the voice](11-synthesis.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 11.1: Summing voiced harmonics](11-synthesis.md#fig-11-1) | A vowel frame rebuilt from its harmonics. Changing their starting phases changes the wave’s shape but not its spectrum. | 4, 3 in 3D |
| [Figure 11.2: Crossing the 20 ms frame boundary](11-synthesis.md#fig-11-2) | Three ways to carry each harmonic from one frame to the next across a 20 ms boundary. | 5, 1 in 3D |
| [Figure 11.3: Combining the voiced oscillator bank and shaped noise](11-synthesis.md#fig-11-3) | Each frame’s eight bands split between harmonics and shaped noise, the two parts the decoder adds together. | 3, 2 in 3D |

---

## Part IV · Hearing It

### [12. Listen: real hardware examples](12-listen.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 12.1: Original versus decoded spectrograms and harmonic valleys](12-listen.md#fig-12-1) | The original and decoded spectrum of each test sentence side by side, with the depth of the gaps between harmonics. | 6, 2 in 3D |

---

## Part V · The Open Problem

### [13. What is not established](13-what-is-not-established.md)

| Figure | What it shows | Steps |
| :--- | :--- | :--- |
| [Figure 13.1: Comparing log-of-mean-energy and mean-of-logs gain](13-what-is-not-established.md#fig-13-1) | Two ways to measure a frame’s level, and how far apart they land on flat and steep spectra. | 4, all in 2D |

---

**[← Glossary](18-glossary.md)** · **[Back to Overview →](index.md)**
