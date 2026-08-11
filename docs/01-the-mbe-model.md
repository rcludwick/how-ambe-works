# What AMBE actually is

<!-- Owner: mbe-model-agent -->

AMBE is not a compression algorithm in the sense that ZIP or MP3 are
compression algorithms. It does not try to store your voice more compactly.
It throws your voice away, measures a handful of numbers about it fifty
times a second, and sends those numbers. At the far end, a synthesizer that
has never heard you builds a new voice from the numbers.

Understanding AMBE means understanding which numbers, why those, and how
they are measured. This page covers the model — what the numbers *mean*.
The [next page](02-analysis.md) covers how they are measured.

## The problem: the bit budget is absurd

Telephone-bandwidth speech is sampled at 8 kHz with 16-bit samples, which is
128 000 bits per second. A D-STAR digital voice channel gives the vocoder
2400 bit/s, with a further 1200 bit/s of forward error correction on top, for
3600 bit/s of voice payload on the air
<span class="cite">JARL D-STAR system specification §1.1(3): "AMBE (2020) converting at 2.4 Kbps / FEC at 3.6 Kbps"</span>.
The voice frames are 72 bits long and each one represents 20 ms of speech
<span class="cite">JARL D-STAR spec §2.1.2(2)</span>.

That is a factor of 53 below the PCM rate. There is no waveform coder that
survives that. At 2400 bit/s you have roughly 48 bits per 20 ms of speech —
about six bytes to describe a syllable's worth of a human being. You cannot
describe a waveform in six bytes. You can only describe a *model* of the
thing that produced it, and hope the model is good enough that a
reconstruction from its parameters is still recognisably a person saying a
word.

So every low-rate speech coder is a bet on a model. The interesting question
is which bet.

<!-- VIDEO: decomposition -->

## Two ways to model a voice

The classical bet is the **source–filter model**. Speech is treated as the
response of a system to an excitation: you estimate the excitation
parameters and the system parameters separately, then, to synthesize,
generate an excitation signal — "a periodic impulse train in voiced regions
or random noise in unvoiced regions" — and filter it with the estimated
system
<span class="cite">Griffin &amp; Lim 1988, §I</span>.
This is the LPC vocoder family, and its defining feature is a **single
voiced/unvoiced decision per frame**. Each 20 ms of speech is declared
either buzz or hiss, wholesale.

The competing bet is the **sinusoidal model**: describe the short-time
spectrum as a sum of sine waves at the harmonics of a fundamental, and code
their amplitudes (and, in some systems, their phases). This handles voiced
speech beautifully and noise badly — noise has no harmonics to code, so
harmonic coders end up spending four or five bits per harmonic on phase just
to make noisy regions sound like noise
<span class="cite">Griffin &amp; Lim 1988, §II</span>.

Both bets fail in the same place, and the failure has a name: **buzziness**.
Griffin and Lim state the diagnosis precisely. Speech synthesized entirely
from a periodic source sounds buzzy; speech synthesized entirely from a
noise source sounds hoarse; and real speech regions — mixed voicing, or
voiced speech recorded in noise — have parts of the spectrum dominated by
harmonics and other parts, *at the same instant*, dominated by noise-like
energy. A single voiced/unvoiced switch has to pick one, so it replaces the
noise-like energy with periodic energy, and that substitution is what the
ear hears as buzz
<span class="cite">Griffin &amp; Lim 1988, §I</span>.

It gets worse in noise. Gold and Tierney's measurements, quoted in the
paper, showed a contemporary vocoder losing 18.7 DRT intelligibility points
in aircraft noise where the uncoded noisy speech lost only 10.3 — an extra
8.4 points that they named the vocoder's "aggravation factor"
<span class="cite">Griffin &amp; Lim 1988, §I, citing Gold &amp; Tierney</span>.
The paper's hypothesis for where those points go is worth sitting with:
listeners *use* the distinction between "this frequency region is periodic"
and "this frequency region is noise" to pull a voice out of a noisy
background, and a single-decision vocoder destroys that cue before the
listener ever gets it
<span class="cite">Griffin &amp; Lim 1988, §I</span>.

## The multi-band idea

Here is the whole trick.

Take the windowed speech segment `s_w(n) = w(n) · s(n)`
<span class="cite">Griffin &amp; Lim 1988, eq. 1</span>
and model its Fourier transform as a product of two things — a **spectral
envelope** and an **excitation spectrum magnitude**:

```text
S_w(ω) = H_w(ω) · |E_w(ω)|
```

<span class="cite">Griffin &amp; Lim 1988, eq. 2</span>

So far this is just source–filter written in the frequency domain. The
envelope `H_w(ω)` is a smoothed version of the speech spectrum, the same
role LPC coefficients or cepstral coefficients play
<span class="cite">Griffin &amp; Lim 1988, §II</span>.

The departure is in `|E_w(ω)|`. In the simple models, the excitation
spectrum is fully specified by the fundamental frequency `ω₀` *plus one
voiced/unvoiced bit for the entire spectrum*. In the MBE model it is
specified by `ω₀` plus a **frequency-dependent** voiced/unvoiced function.
A continuously varying mixture function would cost too many parameters to
transmit, so it is restricted to a binary decision, and then the spectrum is
divided into bands with one binary decision per band
<span class="cite">Griffin &amp; Lim 1988, §II</span>.

The number of bands is the point. Earlier mixed-excitation vocoders had used
"three frequency bands at most"; the MBE model divides the spectrum into
"a large number of frequency bands (typically 20 or more)", potentially one
per harmonic of the fundamental
<span class="cite">Griffin &amp; Lim 1988, §II</span>.
That is where the name comes from, and it is the entire difference between
MBE and everything that came before it.

<!-- ANIM: harmonics -->
<div data-anim="harmonics"></div>

The excitation spectrum is then assembled band by band: segments of a
**periodic spectrum** `|P_w(ω)|` in the bands declared voiced, segments of a
**random noise spectrum** `|U_w(ω)|` in the bands declared unvoiced
<span class="cite">Griffin &amp; Lim 1988, §II</span>.
The periodic spectrum is completely determined by `ω₀` alone — you can get
it as the Fourier transform magnitude of a windowed impulse train at the
pitch period, or equivalently by centering the transform of the analysis
window on every harmonic of `ω₀` and summing
<span class="cite">Griffin &amp; Lim 1988, §II</span>.
It costs no bits beyond the pitch.

<!-- PSEUDOCODE — illustrative only. Not executable, not a specification. -->

```text
PSEUDOCODE — the model, stated as a recipe (NOT EXECUTABLE)

given  ω₀            the fundamental frequency for this frame
       v[1..K]       one binary voiced/unvoiced flag per frequency band
       A[1..L]       one envelope sample per harmonic of ω₀

for each frequency ω in the analysis band:
    let b ← the band index containing ω
    if v[b] says voiced:
        excitation(ω) ← periodic spectrum at ω, which follows from ω₀ alone
    else:
        excitation(ω) ← noise spectrum at ω, normalised to unit average
                        magnitude across the band
    envelope(ω)  ← interpolate between the harmonic samples A[·]
                   that straddle ω
    spectrum(ω)  ← envelope(ω) × excitation(ω)
```

The consequence: one bit buys you the ability to say "this 500 Hz slice of
this 20 ms of speech is breath, and the slice below it, simultaneously, is
voice." A vowel with a breathy top end, a voiced fricative, a word spoken
over engine noise — all of these are representable rather than approximated.

<!-- ANIM: voicing -->
<div data-anim="voicing"></div>

## The parameters, and what they cost

The envelope is represented by **one sample per harmonic** of the
fundamental — in voiced *and* unvoiced regions alike — because that is the
cheapest representation that stays tied to the excitation structure. When
the synthesizer needs a densely sampled envelope, it linearly interpolates
between the harmonic samples
<span class="cite">Griffin &amp; Lim 1988, §II</span>.

So the per-frame parameter set is:

| Parameter | What it is | Roughly how many |
| --- | --- | --- |
| Fundamental frequency `ω₀` | pitch, as a frequency in radians/sample | 1 |
| Voiced/unvoiced decisions | one bit per frequency band | 8 in the AMBE-rate system |
| Spectral amplitudes `M_l` | envelope sampled at each harmonic | `L`, tens |

<span class="cite">US 5,754,974 (Griffin &amp; Hardwick, DVSI, filed 1995, issued 1998), Background: "a fundamental frequency ... a set of V/UV decisions which characterize the voicing state; and a set of spectral amplitudes which characterize the spectral envelope"</span>

The number of harmonics is not free — it falls out of the pitch, since
harmonics of a low fundamental are packed more densely into the same
bandwidth. The patents give it as `L = ⌊α·π/ω₀⌋`, where `α` sets the coded
bandwidth as a fraction of Nyquist; the 3.6 kbit/s system at 8 kHz sampling
uses `α = 0.925`, giving a coded bandwidth of 3700 Hz
<span class="cite">US 5,754,974; US 5,701,390</span>.
A low-pitched voice therefore has *more* parameters to transmit in the same
72 bits than a high-pitched one, which is a tension that runs through the
whole quantizer design.

One parameter is conspicuously missing from that table: **phase**. The
original 1988 coder did transmit the phase of each voiced harmonic, and
spent a large share of its 160 bits per frame doing so
<span class="cite">Griffin &amp; Lim 1988, §II and §V-A</span>.
Every production descendant dropped it, and the decoder regenerates phase
instead. That is a synthesis-side story, told on the
[synthesis page](05-synthesis.md).

## Did it work?

Yes, and the paper measured it against the fairest possible control: the
same coder with the multi-band decision removed. The Single Band Excitation
coder used "exactly the same parameters as the Multiband Excitation Speech
Coder, except that one V/UV bit per frame is used instead of 12"
<span class="cite">Griffin &amp; Lim 1988, §V</span>.

Diagnostic Rhyme Test scores, where 100 is perfect and guessing scores zero:

| Condition | Uncoded | 8 kbit/s MBE | 7.45 kbit/s SBE |
| --- | --- | --- | --- |
| Clean speech | 97.8 | 96.2 | 96.0 |
| Speech in wideband noise | 63.1 | 58.0 | 46.0 |

<span class="cite">Griffin &amp; Lim 1988, Abstract and Tables III–IV</span>

On clean speech the two are indistinguishable — 96.2 against 96.0. In noise
the multi-band model is twelve points better, landing about five points
below the uncoded noisy speech instead of seventeen. The paper's spectrogram
analysis of the /h/ in "has" shows why: several harmonics of the fundamental
in the low-frequency region with the upper region dominated by aperiodic
energy, reproduced faithfully with 12 V/UV bits, and flattened into
harmonics-everywhere by the single-decision coder
<span class="cite">Griffin &amp; Lim 1988, §V-B, Figs. 12–13</span>.

Twelve bits. That is the entire cost of the idea.

## Where AMBE sits in the family

<!-- VIDEO: pipeline -->

The lineage is one model, re-quantized downward three times, with the
analysis and synthesis machinery hardened at each step.

**MBE (1988)** — the research coder in the paper. 10 kHz sampling, 25.6 ms
Hamming analysis window, 50 Hz frame rate, 160 bits per frame for an 8 kbit/s
total, 12 V/UV bands, and coded harmonic phases
<span class="cite">Griffin &amp; Lim 1988, §V-A</span>.

**IMBE** — "Improved Multiband Excitation", 7.2 kbit/s at a 50 Hz frame rate,
144 bits per frame. Of those, 57 bits go to forward error correction and
synchronisation and 87 to the model parameters, split as 8 bits for the
fundamental frequency, `K` bits for the voiced/unvoiced decisions, and
`79 − K` bits for the spectral amplitudes; the patent also describes a
6.4 kbit/s variant for satellite use
<span class="cite">US 5,630,011 (Lim &amp; Hardwick, DVSI, filed 1994, issued 1997)</span>.
This is the generation used by APCO Project 25.

**AMBE** — the 3.6 kbit/s system, and the one this site is about. 72 bits
per 20 ms frame, allocated as 7 bits for the fundamental frequency, 8 bits
for the V/UV decisions over eight bands of approximately 500 Hz spanning
0–4 kHz, and the remaining 57 bits for the spectral magnitudes
<span class="cite">US 5,754,974, describing the 3.6 kbps system</span>.
D-STAR uses a lower-rate member of the same family: 2400 bit/s of speech
data — 48 bits per 20 ms frame — plus 1200 bit/s of FEC, packed into the
same 72-bit, 20 ms frame on the air
<span class="cite">JARL D-STAR spec §1.1(3), §2.1.2(2)</span>.

**AMBE+2** — the later half-rate generation, used by DMR, YSF and NXDN. It
is a real system and it exists, but it is not expired: US 8,359,197,
"Half-rate vocoder" (Hardwick, DVSI, issued 2013), is listed as active with
an anticipated expiry of 20 May 2028. This site describes that AMBE+2 exists
and discusses the landscape on the [patents page](08-patents.md); it does
not teach how to build one. Everything implementation-level here stays
inside full-rate AMBE and IMBE, covered by patents that have expired.

## What the model does not contain

There is no vocal tract in this model. No lips, no glottis, no formant
tracker, no articulatory anything. There is a fundamental frequency, a set
of yes/no answers to "is this band buzz or hiss", and a set of amplitudes.
The model is deliberately ignorant of *why* the spectrum looks the way it
does; it only cares that a synthesizer given these numbers produces a
spectrum close to the original one.

Which raises the question the whole design turns on: close by what measure,
and how do you find the parameters that get you there? That is
[analysis](02-analysis.md).
