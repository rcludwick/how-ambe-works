# The source-filter model of speech

<!-- Owner: part-ii-voice agent -->

Every sound that leaves your mouth begins as raw acoustic energy and finishes
as shaped speech. In 1960, speech scientist Gunnar Fant formalized this division
as the source-filter model: an acoustic source generates raw sound, and the vocal
tract acts as a filter that sculpts that sound into recognizable vowels and consonants.
{: .lede }

The distinction matters for speech compression. If an encoder tries to record the
entire vibrating waveform sample by sample, it needs tens of thousands of bits per
second. If it separates the pitch of the vocal folds from the shape of the mouth,
it can transmit the voice using just a few dozen numbers every 20 milliseconds.

## How vocal folds create periodic sound pulses

When you speak a voiced sound like the vowel in "smooth", your lungs push air upward
through the larynx. Two muscular folds of tissue pull together across the airway.
These are the [vocal folds](18-glossary.md#vocal-folds-and-vocal-tract), commonly
called vocal cords.

As air pressure builds beneath the closed folds, it forces them apart. A brief burst
of air escapes into the throat. The sudden drop in air pressure and the elasticity
of the tissue snap the folds shut again. This cycle repeats between 80 and 300 times
a second, depending on the speaker's anatomy and vocal pitch.

The rate of these openings sets the [fundamental frequency](18-glossary.md#fundamental-frequency-and-pitch-period)
f₀. In discrete-time audio at 8,000 samples per second, an adult male speaking at
100 Hz produces one pulse every 80 samples. An adult female speaking at 200 Hz
produces one pulse every 40 samples.

This glottal pulse train repeats periodically in time. Its spectrum therefore forms
a dense comb of [harmonics](18-glossary.md#harmonic) at integer multiples of f₀. The
comb runs from 2f₀ to 3f₀ to 4f₀, all the way up to the radio channel's 3.7 kHz
cutoff. By itself, this glottal buzz
sounds like the monotone drone of an electronic buzzer.

## How the vocal tract shapes resonant formants

Before the glottal pulse train reaches the open air, it must travel through roughly
17 centimeters of acoustic tube. The tube starts at the pharynx behind the tongue.
It runs through the oral cavity inside the mouth and ends at the opening of the lips.

This air passage acts as a resonant acoustic filter. Certain frequencies pass through
freely and ring with high energy, while other frequencies cancel out and fade.
Acousticians call these broad resonant peaks **formants**.

When you change the vowel you are speaking, your vocal folds continue pulsing at the
exact same pitch. What changes is the position of your tongue, jaw, and lips:

- Dropping your jaw lowers the constriction in your throat, shifting the first formant
  upward toward 800 Hz to produce an "ah" sound.
- Raising your tongue toward the roof of your mouth widens the pharynx, dropping the
  first formant to 300 Hz while pushing the second formant up toward 2,200 Hz to
  produce an "ee" sound.
- Rounding your lips lengthens the acoustic tube, lowering all resonant frequencies
  to produce an "oo" sound.

The filter does not create new frequencies. It merely scales the amplitude of the
harmonics that the source provides. In [**Figure 1.3**](01-why-sinusoids.md#fig-1-3),
you can see this filter at work. Passing different wave shapes through a resonant
filter changes their amplitudes and delays without adding new fundamental tones.

## Why linear predictive coding separates source from filter

In classical speech coding from the 1970s, encoders used **Linear Predictive Coding (LPC)**
to model the vocal tract filter as an all-pole digital filter <span class="cite">Flanagan 1972</span>.

The encoder computes 10 to 14 reflection coefficients that capture the shape of the
formant envelope. It then subtracts this filter response from the input speech to
produce an excitation residual:

1. If the frame is voiced, the encoder models the excitation as a single periodic pulse train.
2. If the frame is unvoiced (like an "s" or "sh"), the encoder models the excitation as random white noise.

The decoder reverses the process. It feeds the synthetic pulse train or white noise
into the all-pole filter, reconstructing the vowel or consonant.

This strict separation achieved low bitrates, down to 2,400 bits per second in military
standards like LPC-10 (FS-1015). But it came with a severe acoustic cost.

## Where the classical source-filter model fails on radio speech

The classical source-filter model makes a rigid assumption. It treats every 20-millisecond
frame as either completely voiced or completely unvoiced.

Natural speech refuses to fit this binary switch:

- Voiced fricatives like "z" or "v" mix periodic glottal buzzing at low frequencies with
  turbulent hiss at high frequencies at the exact same instant.
- Plosives like "b" or "d" release turbulent bursts while the vocal cords continue to hum.
- Background acoustic noise from a vehicle engine or radio room contaminates the upper
  harmonics of a clean vowel.

When an LPC vocoder misclassifies a mixed frame as voiced, consonants sound robotic and
buzzy. When it misclassifies a frame as unvoiced, vowels sound harsh and whispery.

In 1988, Daniel Griffin and Jae Lim solved this limitation by introducing the
[Multi-Band Excitation](18-glossary.md#multi-band-excitation-mbe-imbe-ambe-ambe2) model
<span class="cite">Griffin &amp; Lim 1988</span>. Instead of assigning one binary
switch to the entire frame, MBE divides the spectrum into multiple frequency bands.
Lower bands can synthesize periodic harmonics while upper bands synthesize shaped noise.

In [**Figure 7.2**](07-multi-band-excitation.md#fig-7-2), you can compare one
voicing switch for the whole frame against eight bands that each get their own
switch. Step through a vowel, a hiss and a mixed frame of real speech.

---

**[← Why vocoders discard phase](04-phase.md)** · **[Next: Reading a spectrogram →](06-reading-a-spectrogram.md)**
{: .chapter-nav }

Last reviewed: 2026-10-15.
{: .source-note }
