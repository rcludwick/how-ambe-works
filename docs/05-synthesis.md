# Synthesis: rebuilding the voice

<!-- Owner: synthesis-agent -->

The decoder never receives speech. It receives a description of speech —
a pitch, a handful of voiced/unvoiced flags, and a list of harmonic
amplitudes — and it has to manufacture a waveform that sounds like the
one the encoder was looking at. This page is about how that manufacture
works, and about the one thing the decoder is *not* given and must invent
from scratch: phase.
{: .lede }

## What the decoder is handed

Once the channel bits have been corrected and unpacked, a frame of
full-rate MBE reduces to three things:

- a **fundamental frequency** ω₀, from which the harmonic count follows —
  the harmonics are the multiples of ω₀ that fit below 4 kHz;
- a **voiced/unvoiced decision per frequency band**, expanded to one flag
  per harmonic;
- a **spectral amplitude** for each harmonic.

That arrives once per 20 ms frame — 160 samples at 8 kHz, fifty frames a
second. <span class="cite">US 5,701,390</span>

There is no waveform in there, and no phase. Everything below follows
from those two absences.

## Two synthesizers, summed

MBE splits the spectrum by voicing, so the decoder runs two independent
synthesizers over the same frame and adds their outputs:

```text
    s(n)  =  s_voiced(n)  +  s_unvoiced(n)
```

The voiced half is built in the time domain from a bank of sinusoidal
oscillators. The unvoiced half is built in the frequency domain by
shaping noise. Each half is responsible for exactly the frequency regions
its voicing decision claims, and each is deliberately silent where the
other one is speaking.
<span class="cite">Griffin &amp; Lim 1988; US 5,754,974</span>

That division is the whole point of the multi-band model. A frame of a
voiced fricative — say the *z* in "zone" — has a periodic low end and a
noisy high end at the same instant, and MBE can synthesize both without
choosing.

### The oscillator bank

For the voiced part the decoder assigns "one oscillator to each harmonic
labeled voiced" <span class="cite">US 5,701,390</span> and sums them:

```text
    s_voiced(n)  =  SUM over voiced harmonics l of
                        A_l(n) * cos( theta_l(n) )
```

`A_l(n)` is that harmonic's amplitude, and `theta_l(n)` is its running
phase — both functions of the sample index `n`, not constants, for
reasons the frame-boundary section below gets to. Griffin and Lim write
the phase as the integral of an instantaneous frequency track, so a
harmonic that is drifting in pitch traces a smoothly curving phase rather
than a straight line. <span class="cite">Griffin &amp; Lim 1988</span>

A vowel at 120 Hz has roughly thirty harmonics under 4 kHz, so this is
thirty oscillators running concurrently, each with its own amplitude
envelope. Their sum is periodic-ish, and their *relative* phases are what
decide whether that sum looks like a sharp glottal pulse or a smeared
mush of the same spectrum.

<figure class="anim-figure anim-figure--wide">
  <div class="anim-figure__head">
    <p class="anim-figure__title">Building a voice out of cosines</p>
  </div>

  <!-- The render is build output: .github/workflows/animations.yml renders
       animations/manim/scene_harmonic_sum.py and writes
       docs/assets/video/harmonic-sum.{webm,mp4}. Those files are not
       committed (see .gitignore), so this element shows its poster until the
       workflow has run. The builder rewrites relative `src` but not
       `poster`, hence the page-relative poster path. -->
  <video class="anim-video" controls playsinline preload="none"
         poster="../assets/posters/harmonic-sum.png">
    <source src="assets/video/harmonic-sum.webm" type="video/webm">
    <source src="assets/video/harmonic-sum.mp4" type="video/mp4">
    <p>This clip adds harmonics one at a time at their measured amplitudes
    until the sum takes on the shape of a glottal pulse.</p>
  </video>

  <figcaption class="anim-figure__caption">
    Twenty-three harmonics of one frame, added in one at a time at the
    amplitudes measured off the recording. The waveform sharpens from a bare
    sine into a pulse as the count rises, and the pulse is a consequence of
    the phases, not of the amplitudes. Change the phases and the picture
    changes completely while the spectrum, and very nearly the sound, does
    not. That is the freedom the decoder is left with.
    <span class="anim-figure__source">Frame 74 of
    <code>assets/data/lj-b/</code> (all eight bands measured periodic),
    captured from a DVSI AMBE-3000. Amplitudes are read off the measured
    spectrum at multiples of the measured pitch; the sum is drawn at zero
    phase, which is why the pulse is symmetric. The frame carries no phase at
    all: US 5,701,390.</span>
  </figcaption>
</figure>

### Shaped noise for everything else

The unvoiced half is not built oscillator by oscillator. It is built by
filtering noise:

> "The unvoiced speech component is normally synthesized by filtering a
> white noise signal with a filter response of zero in voiced frequency
> bands and with a filter response determined by the spectral magnitudes
> in frequency bands declared unvoiced."
> <span class="cite">US 5,754,974</span>

In practice the filtering is done as a transform: take a windowed block
of white noise, transform it, scale each unvoiced harmonic's band of bins
so that band carries the transmitted amplitude, zero every bin belonging
to a voiced band, transform back, and overlap-add the result with the
previous frame's block. The patent is explicit that this is "performed
via a weighted overlap-add procedure which uses a forward and inverse FFT
to perform the filtering." <span class="cite">US 5,754,974</span>

The overlap-add is only seamless if the synthesis window is built for it.
The constraint the patent states is that successive shifted copies of the
window must sum to unity across the overlap —
`ws(n) + ws(n + S) = 1` for `-S < n ≤ 0`, where `S` is the frame advance.
<span class="cite">US 5,754,974</span> A window that fails this puts a
50 Hz amplitude ripple on every unvoiced sound, which is audible as a
buzz sitting underneath the noise.

### One step before synthesis

Most MBE decoders sharpen the amplitude envelope before they synthesize
anything. The idea, from the error-handling patent, is to build a
smoothed model of the spectral envelope and then use it to "increase the
amplitude of perceptually important frequency regions" while pulling down
the ones between them, before restoring the original frame energy.
<span class="cite">US 5,247,579</span>

This exists because quantization smears formants: a coarsely coded
envelope has shallower peaks and shallower valleys than the real one, and
the ear hears that as muffled. Re-deepening the peaks costs no bits, and
it is one of the larger perceptual differences between two decoders fed
identical frames.

## The phase problem

Here is the thing the decoder is not told.

A sinusoid needs an amplitude, a frequency, and a phase. The frame
carries the first two. It carries no phase at all, for the blunt reason
the patent gives:

> "At low to medium data rates there are not sufficient bits to transmit
> any phase information between the encoder and the decoder."
> <span class="cite">US 5,701,390</span>

Thirty harmonics at even four bits of phase each would be 120 bits per
frame — more than the entire D-STAR voice frame. Phase is simply not
affordable, so the encoder measures it, uses it internally, and throws it
away.

The decoder therefore has to invent a phase for every voiced harmonic of
every frame, fifty times a second, and the two obvious ways of doing that
both sound wrong:

- **All harmonics phase-locked**, advancing coherently from a common
  fundamental. Perfectly periodic, and it sounds it — mechanical, buzzy,
  a synthesizer imitating a person.
- **All phases random**. The spectrum is right and the periodicity is
  gone, but so is the pulse structure: energy that should have been
  concentrated into one glottal instant is spread across the whole
  period. It sounds breathy, distant, and reverberant.

Every MBE phase scheme is a way of sitting between those two.

### Generation one: coherent phase plus controlled jitter

The first published answer builds the phase in two pieces
<span class="cite">US 5,081,681</span>:

```text
    theta_k(t)  =  phi_k(t)  +  r_k(t)
```

`phi_k(t)` is the coherent part: the harmonic's phase carried forward by
integrating the fundamental frequency over time, so a harmonic that was
in step at the last frame is still in step at this one. `r_k(t)` is
deliberate disorder — `r_k(t) = alpha(t) * u_k(t)`, where `u_k` is white
noise uniform on `[−π, π]` and `alpha(t)` is "the approximate percentage
of total harmonics represented by the unvoiced harmonics."
<span class="cite">US 5,081,681</span>

The scaling is the clever part. A fully voiced frame has `alpha = 0` and
stays perfectly coherent. A frame that is mostly unvoiced has `alpha`
near one and gets phases that are nearly random. Voicing therefore
controls the *phase* character as well as which synthesizer runs, and the
transition between the two is continuous. The stated motivation is that
real "speech deviates from a perfect voicing model"
<span class="cite">US 5,081,681</span> — a real larynx is not a metronome,
and a decoder that is one sounds like a machine.

### Generation two: regenerate the phase from the amplitudes

The later approach stops treating the missing phase as something to fake
and starts treating it as something to *derive*. The observation is that
phase and magnitude are not independent in a physical resonant system: a
vocal tract is close enough to a minimum-phase system that the phase
response is recoverable, up to a linear term, from the shape of the
magnitude response. The patent links "phase to spectral smoothness via
linear system theory." <span class="cite">US 5,701,390</span>

So the decoder computes each voiced harmonic's phase by running an
edge-detection kernel across the *log-compressed* spectral amplitudes of
the frame it already has:

```text
    B_l    =  log2( M_l )                      compressed magnitudes
    phi_l  =  SUM over m of  h(m) * B_(l+m)    regenerated phase
```

The kernel `h(m)` is antisymmetric, has only odd-indexed taps (so its
centre tap is zero by construction and the kernel is exactly zero-mean),
decays as `1/m`, and spans roughly nineteen harmonics either side of the
one being computed. It is, in effect, a differentiator: where the
amplitude envelope is climbing steeply into a formant, the regenerated
phase advances; where the envelope is flat, it does not. Amplitudes
outside the transmitted range are extrapolated with a downward slope so
the kernel has something smooth to chew on at the edges.
<span class="cite">US 5,701,390, Eqs. 7–9</span>

!!! note "Reading these equations yourself"

    US 5,701,390's full text is public, but the Google
    Patents rendering of this section substitutes image placeholders for
    the equations. The kernel definition, its span, and its scaling
    constant have to be read off the USPTO page images of columns 9–10
    rather than the OCR'd text. If you are checking this page against the
    patent, use the page images.

The stated payoff is that speech synthesized this way "more closely
approximates actual speech in peak-to-RMS value"
<span class="cite">US 5,701,390</span> — the waveform gets its pulse
structure back, giving "improved dynamic range" and fewer "phase related
distortions." That is the difference between a decoder that sounds thin
and one that sounds present, and it costs zero transmitted bits, because
it is computed from data the decoder already has.

### What regenerated phase costs

It is worth being clear-eyed about what has been given up.

**The waveform is not reproduced, and was never going to be.** Feed a
sine into an MBE codec and the output is a sine of the right frequency and
amplitude at an arbitrary phase. Any waveform-domain quality metric —
SNR, correlation with the input, a difference plot — measures the phase
choice and nothing else. This is why MBE codecs are assessed by listening
tests and not by SNR, and why "the decoded file doesn't match the
original" is not a bug report.

**Sharp transients suffer most.** The regeneration derives phase from a
spectral envelope averaged over a 20 ms window. A plosive burst, a glottal
stop, or a hard consonant onset has its energy concentrated in a couple of
milliseconds, and the phase relationship that produced that concentration
is not recoverable from the frame's magnitudes. Attacks come out softened.

**Non-speech signals come out mangled.** The model assumes a harmonic
excitation and a resonant tract. Music, DTMF pairs, and modem tones
violate that, and phase regeneration cannot rescue what the model
misrepresents in the first place.

**It does not accumulate gracefully.** Decode to audio and re-encode —
through a gateway, a repeater link, a transcoder — and the second encoder
analyses phases that the first decoder invented. Errors compound in a way
they would not if the phase had been transmitted.

Against all that, it works, because human hearing is largely insensitive
to the absolute phase of a steady sound and quite sensitive to its
spectrum. MBE spends its bits where the ear is looking.

## Crossing the frame boundary

Fifty frames a second means the decoder is handed a completely new set of
parameters every 20 ms. If it simply switched — old oscillator bank off,
new one on — the output would contain fifty amplitude steps and fifty
phase discontinuities per second, and a 50 Hz buzz on top of the speech.
Preventing that is most of the work in a synthesizer.

The decoder pairs each harmonic in the current frame with the same-index
harmonic in the previous frame and picks a rule based on how the two
frames disagree. <span class="cite">US 5,701,390</span>

| Previous → current | What the synthesizer does |
| --- | --- |
| unvoiced → unvoiced | Nothing. The noise synthesizer owns this harmonic in both frames. |
| voiced → unvoiced | Window the old oscillator down to zero across the frame, while the noise synthesizer fades this band in. |
| unvoiced → voiced | Window the new oscillator up from zero, while the noise synthesizer fades this band out. |
| voiced → voiced, low harmonic, small pitch change | One continuous oscillator, swept. |
| voiced → voiced, otherwise | Overlap-add: run the old oscillator at the old frequency, the new one at the new frequency, and crossfade. |

The transitional cases are handled as an energy handover: "the energy in
this region of the spectrum transitions from the voiced synthesis method
to the unvoiced synthesis method over the duration of the synthesis
interval." <span class="cite">US 5,701,390</span> Because both
synthesizers use complementary windows, the total energy in that band
stays put while its character changes.

The interesting case is the fourth one. The patent gates it precisely:

> "A final synthesis rule is used if the *l*'th spectral amplitude is
> voiced for both the current and the previous frame, and if both `l < 8`
> and `|ω₀(0) − ω₀(−S)| < .1 ω₀(0)`."
> <span class="cite">US 5,701,390</span>

Both conditions, not either. When they hold, the harmonic is synthesized
by a single oscillator whose amplitude ramps linearly from the old value
to the new one and whose phase follows a second-order polynomial —
"a linear phase term and which otherwise meets the desired regenerated
phase" <span class="cite">US 5,701,390</span> — chosen so that the phase
is correct at *both* ends of the frame and the instantaneous frequency
sweeps smoothly from `l·ω₀(old)` to `l·ω₀(new)` in between. A quadratic in
`n` is exactly the minimum you need to satisfy two phase endpoints and two
frequency endpoints.

Both gates earn their place:

- **`l < 8`.** The harmonic's frequency is `l · ω₀`, so any error in the
  pitch estimate is multiplied by `l`. At the twentieth harmonic a one
  percent pitch error is a twenty percent frequency error, and forcing a
  single oscillator to sweep across it produces audible warble. The low
  harmonics carry the pitch percept and deserve the continuous treatment;
  the high ones are better off crossfaded.
- **Less than ten percent pitch change.** A linear frequency sweep is a
  model of what the larynx did between the two frames. Across a large
  pitch jump — a pitch-tracking error, or a genuine octave leap — that
  model is simply false, and sweeping through the intervening frequencies
  synthesizes a glide that never happened. Crossfading two steady tones is
  the more honest failure.

The net effect: sustained vowels get genuinely continuous low harmonics,
transitions get smooth energy handovers, and nothing in the output
announces where one frame stopped and the next began.

The figure below holds the two halves apart so you can see the division of
labour. Slide the mix to either end: one end is the oscillator bank alone,
the other is the shaped noise alone, and the centre is the split the
measurement actually found for that frame. Pick a sibilant frame and the
noise generator is doing nearly all the work.

<!-- The two-generator figure (docs/javascripts/anim-synth.js). It builds its
     own chrome, controls and caption, draws precomputed measurements only,
     and synthesizes no speech. -->
<div data-anim="synth"></div>

## The synthesis loop, in outline

The following is **conceptual pseudocode**. It is a reading aid for the
rules above, not a specification and not a program: the interpolation
details, window definitions, band-edge arithmetic, gain staging, and
every constant that would make it run are deliberately absent. It will
not compile in any language and is not intended to.

```text
CONCEPTUAL PSEUDOCODE — not executable, not a specification.

for each received frame:

    prev, cur  <-  previous and current decoded parameter sets
                   (fundamental, per-harmonic voicing, per-harmonic
                   amplitude)

    # ---- error handling comes first -----------------------------------
    if the frame was flagged unrecoverable:
        if we have not repeated too many times already:
            cur <- prev                       # frame repeat
        else:
            output silence; reset state       # mute
            continue

    # ---- optional envelope sharpening ---------------------------------
    cur.amplitudes <- sharpen_formants(cur.amplitudes)   # US 5,247,579
                                                          # energy preserved

    # ---- phases the frame did not carry -------------------------------
    # Either scheme; both produce one phase per harmonic.
    #   gen 1: carry each harmonic's phase forward coherently, then add
    #          jitter scaled by the unvoiced fraction        US 5,081,681
    #   gen 2: convolve an antisymmetric odd-tap kernel across the
    #          log amplitudes                                US 5,701,390
    cur.phases <- regenerate_phases(cur)

    # ---- voiced half: an oscillator per voiced harmonic ---------------
    voiced_out <- zeros(frame_length)
    for each harmonic index l:
        case (prev.voiced[l], cur.voiced[l]):

            (unvoiced, unvoiced):
                nothing                       # the noise half owns it

            (voiced, unvoiced):
                add windowed fade-out of the OLD oscillator
                    at the old frequency, old amplitude, old phase

            (unvoiced, voiced):
                add windowed fade-in of the NEW oscillator
                    at the new frequency, new amplitude, new phase

            (voiced, voiced) and l < 8
                            and pitch changed by less than 10 percent:
                add ONE continuous oscillator whose
                    amplitude ramps old -> new, and whose
                    phase follows a second-order polynomial hitting
                    the old phase at the start of the frame and the
                    new phase at the end        # US 5,701,390

            (voiced, voiced) otherwise:
                add BOTH oscillators, windowed, and let them
                    overlap-add across the frame

    # ---- unvoiced half: noise, shaped, in the transform domain --------
    noise      <- windowed white noise
    spectrum   <- forward transform of noise
    for each harmonic index l:
        if cur.voiced[l]:
            zero the transform bins belonging to harmonic l
        else:
            scale those bins so the band carries cur.amplitude[l]
    unvoiced_out <- inverse transform, then weighted overlap-add
                    with the previous frame's block

    emit  voiced_out + unvoiced_out
```

The two halves are genuinely independent; the only thing they share is
the voicing decision that partitions the spectrum between them, and the
requirement that their windows are complementary so a band changing hands
does not change loudness.

## When the bits are wrong

Everything above assumes the parameters are correct. Over the air they
frequently are not, and the synthesizer is where that gets managed.

The decoder can tell the difference between a frame it repaired and a
frame it could not, because the channel layer is built to make that
distinction cheap: the mechanism is
[the self-checking trick](04-the-dstar-frame.md#the-self-checking-trick) in
the previous chapter. What matters here is the outcome it hands the
synthesizer. The decoder "can identify severely corrupted frames through
error pattern analysis and either repeat previous parameters or mute output
rather than synthesize degraded speech."
<span class="cite">US 5,870,405</span>

The escalation is three-stage:

1. **Correct.** The error-correcting codes fix what they can. The count
   of bits they had to change is itself an estimate of the channel error
   rate, which feeds the next two stages.
   <span class="cite">US 5,870,405; US 5,247,579</span>
2. **Smooth, then repeat.** As the estimated error rate climbs, the
   decoder leans on "adaptive smoothers which increase the perceived
   speech quality in the presence of uncorrectable bit errors"
   <span class="cite">US 5,247,579</span> — pulling suspicious parameters
   toward the recent past rather than trusting them. When a frame is
   judged unrecoverable outright, "the received bits for the current
   frame are ignored and the model parameters from the previous frame are
   repeated for the current frame." <span class="cite">US 5,247,579</span>
3. **Mute.** If corruption persists across frames, repeating stops and
   the decoder outputs silence. <span class="cite">US 5,870,405</span>

This is why a digital voice signal fading out does not sound like an
analogue one. The repeat holds the last good parameters, so the voice
freezes on a vowel — the characteristic smeared, held-open sound — and
then the mute cuts it dead. A parametric codec has no graceful way to get
quieter: it either has parameters or it does not, and the descent from
speech to silence happens over a handful of 20 ms frames.

The alternative is worse. Synthesizing from corrupted parameters means a
random fundamental and random amplitudes driving thirty oscillators at
full level, which is not degraded speech but a loud, unpredictable
squawk. Frame repeat and mute exist to keep that out of anyone's ears.

## Sources for this page

All of these are US patents or published literature; every one is
listed with a link on [Sources and method](09-sources.md).

| Claim on this page | Source |
| --- | --- |
| Oscillator bank for voiced harmonics; amplitude and phase interpolated to neighbouring frames; second-order phase polynomial; the `l < 8` and 10 % pitch-change gate; energy handover on voicing transitions; regenerated phase from an edge-detection kernel over log magnitudes; peak-to-RMS and dynamic-range motivation; "not sufficient bits to transmit any phase"; 8 kHz, 20 ms frames, 256-point transform | [US 5,701,390](https://patents.google.com/patent/US5701390A/en) |
| Unvoiced synthesis by filtering white noise with zero response in voiced bands; weighted overlap-add via forward and inverse FFT; the `ws(n) + ws(n+S) = 1` window constraint | [US 5,754,974](https://patents.google.com/patent/US5754974A/en) |
| Coherent phase plus jitter; jitter scaled by the fraction of unvoiced harmonics; noise uniform on [−π, π] | [US 5,081,681](https://patents.google.com/patent/US5081681A/en) |
| Adaptive spectral enhancement of the amplitude envelope; error-rate-driven adaptive smoothing; frame repeat on detected uncorrectable errors | [US 5,247,579](https://patents.google.com/patent/US5247579A/en) |
| Error detection by pseudo-random modulation; frame repeat or mute rather than synthesizing from corrupt parameters | [US 5,870,405](https://patents.google.com/patent/US5870405A/en) |
| The MBE model; voiced synthesis as a sum of sinusoids with interpolated amplitude and integrated frequency tracks; frequency-domain noise synthesis | Griffin &amp; Lim 1988 |

The characterisation of what regenerated phase costs perceptually —
transients, non-speech signals, tandem coding, and the uselessness of
waveform metrics — is this site's own reasoning from the model, not a
claim made by any of the sources above.
{: .source-note }

---

**Next: [What is not in the public record](06-what-isnt-published.md).** Where
the documents stop and the shipping product begins, and what a black box on a
bench can and cannot settle.
Previously: [The D-STAR frame on the air](04-the-dstar-frame.md). Or go and
[listen](07-listen.md) to what all of this sounds like.
{: .chapter-nav }
