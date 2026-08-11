# Analysis: pitch, voicing, amplitudes

<!-- Owner: analysis-agent -->

The [model](01-the-mbe-model.md) says a frame of speech is a fundamental
frequency, a set of per-band voiced/unvoiced flags, and a set of harmonic
amplitudes. Analysis is the job of looking at 20 ms of microphone audio and
producing those numbers.

It is the hard half. Griffin and Lim are blunt about it: inaccurate pitch or
voiced/unvoiced estimates "often introduce very noticeable degradations in
the synthesized speech", and in noisy speech the frequency of those
degradations "increases dramatically"
<span class="cite">Griffin &amp; Lim 1988, §I</span>.
A perfect model estimated badly sounds worse than a mediocre model estimated
well.

## Framing and windowing

Speech is quasi-stationary, so a window is applied to focus on a short
interval — the paper puts the usable range at approximately 10–40 ms
<span class="cite">Griffin &amp; Lim 1988, §II</span>.
The constraint is two-sided: the window must span several pitch periods for
the harmonic structure to be resolvable at all, but stay short enough that
the fundamental is roughly constant across it.

The 1988 coder used a 25.6 ms Hamming window on 10 kHz speech at a 50 Hz
frame rate
<span class="cite">Griffin &amp; Lim 1988, §V-A</span>.
The AMBE-era systems moved to 8 kHz sampling with a frame interval of 20 ms
— 160 samples — a 256-point FFT, and a 255-point symmetric Hamming analysis
window
<span class="cite">US 5,701,390 (Griffin &amp; Hardwick, DVSI, filed 1995, issued 1997)</span>.

Note the mismatch: a 255-sample window advanced 160 samples at a time.
Frames are not independent snapshots but overlapping views of a
continuously moving signal, which is what makes the frame-to-frame
continuity constraints below meaningful rather than arbitrary.

<!-- ANIM: frames -->
<div data-anim="frames"></div>

## Analysis by synthesis

Most vocoders estimate excitation and envelope parameters with separate,
independent algorithms, each using "some reasonable but heuristic criterion
without explicit consideration of how close the synthesized speech will be
to the original speech"
<span class="cite">Griffin &amp; Lim 1988, §III</span>.
MBE does not. It defines one error — the squared difference between the
original short-time spectrum and the spectrum the model *would* produce —
and estimates every parameter by minimising it:

```text
ε = (1/2π) ∫ ( |S_w(ω)| − |Ŝ_w(ω)| )² dω        over −π to π
```

<span class="cite">Griffin &amp; Lim 1988, eq. 3; a variant using the complex difference, eq. 5, estimates phase as well</span>

A frequency-dependent weighting can be applied first, to emphasise high-SNR
regions
<span class="cite">Griffin &amp; Lim 1988, §III</span>.
This is the "analysis by synthesis" idea: you do not measure the pitch, you
find the pitch that makes the *synthesizer's* output match best.

Minimising over all parameters at once would be computationally prohibitive.
The saving observation is that **for a given pitch period, the best envelope
samples have a closed form.** Divide the spectrum into intervals one
fundamental wide, centred on each harmonic; model the envelope as constant
`A_m` within the interval `[a_m, b_m]`; the error contributed by that
interval is then minimised at

```text
              ∫ |S_w(ω)| · |E_w(ω)| dω        (over a_m … b_m)
   |A_m|  =  ─────────────────────────────
                  ∫ |E_w(ω)|² dω
```

<span class="cite">Griffin &amp; Lim 1988, eq. 7; the complex form, eq. 8, is the same ratio with S_w · E_w* in the numerator</span>

Sum those per-interval minima and you have the total error for an entirely
periodic fit at that candidate pitch
<span class="cite">Griffin &amp; Lim 1988, eq. 9</span>.
The multidimensional problem collapses to a **one-dimensional search over
the pitch period**. Everything else in the analyser is downstream of that
one move.

## Pitch: a search, not a measurement

This is where MBE most visibly parts company with textbook pitch detection.
A classical autocorrelation detector finds the lag at which the signal most
resembles a shifted copy of itself. MBE instead evaluates, for each
candidate fundamental, *how well the whole spectrum can be explained as
harmonics of it*, and takes the winner.

### Coarse search

The error varies slowly with the pitch period, so the initial estimate comes
from a coarse grid — in practice, every integer pitch period
<span class="cite">Griffin &amp; Lim 1988, §III-A</span>.
The 1988 coder swept all integers from 20 to 120 samples at 10 kHz sampling
<span class="cite">Griffin &amp; Lim 1988, §III-D, step 2</span>;
the later 8 kHz systems use `22 ≤ P < 115`
<span class="cite">US 5,216,747 (Hardwick &amp; Lim, DVSI, filed 1991, issued 1993)</span>.
During this coarse stage the high harmonics cannot be matched well at
integer resolution, so the frequency weighting is chosen to de-emphasise
high frequencies
<span class="cite">Griffin &amp; Lim 1988, §III-A</span>.

### The bias nobody expects

Raw spectral error is systematically biased toward long pitch periods, for a
structural reason: a longer period means more closely spaced harmonics,
which means the envelope is sampled more densely, which means a better fit —
*even for pure noise*. Uncorrected, the search reliably picks the longest
period in range for noisy input.

The fix is an **unbiased error criterion**: multiply the error by a
period-dependent correction factor whose denominator carries a
`(1 − P · Σ w⁴(n))` term, with the window normalised to unit energy. The
result sits near zero for a purely periodic signal and near one for noise,
independent of `P`, and the paper records that this "significantly improves
the performance for noisy speech"
<span class="cite">Griffin &amp; Lim 1988, eq. 10</span>.

### Why it is not just autocorrelation

Evaluating a full spectral error for every candidate period would be
expensive, so the criterion is rearranged into an autocorrelation-domain
form. Let `φ(m)` be the autocorrelation of `w²(n)·s(n)`; then the quantity
to maximise is

```text
   Ψ(P) = P · Σ φ(k·P)        summed over integer k
```

<span class="cite">Griffin &amp; Lim 1988, eqs. 11–13</span>

and minimising the unbiased error is equivalent to maximising `Ψ(P)`
<span class="cite">Griffin &amp; Lim 1988, §III-A</span>.
`φ` comes from one FFT. The paper's own description of the difference is the
sentence to remember: this "is similar to the autocorrelation method, but
considers the peaks at multiples of the pitch period instead of only the
peak at the pitch period"
<span class="cite">Griffin &amp; Lim 1988, §III-A</span>.

That summation over *all* multiples of the lag is what buys robustness. A
plain autocorrelation detector that finds a strong peak at lag `2P` has no
way to know it is wrong. Summing the peaks at `P`, `2P`, `3P`, … rewards the
candidate that explains the entire periodic structure, not just one
coincidence.

### Sub-multiples

It does not fully solve the octave problem, because integer *multiples* of
the correct period have harmonics at correct frequencies too, so their error
is comparable. The standard defence: once the minimising period is found,
evaluate its sub-multiples and choose the **smallest** period whose error is
comparable to the minimum
<span class="cite">Griffin &amp; Lim 1988, §III-A</span>.
The patent formalises this into an explicit check of `P′`, `P′/2`, `P′/3`
and `P′/4` where those fall in range, with threshold rules comparing their
cumulative errors
<span class="cite">US 5,216,747</span>.
An octave error is the most audible failure an MBE encoder can produce —
halve someone's pitch and they become a different person mid-syllable —
which is why this check reappears in every generation of the patents.

<!-- PSEUDOCODE — illustrative only. Not executable, not a specification. -->

```text
PSEUDOCODE — coarse pitch search (NOT EXECUTABLE)

  φ ← autocorrelation of w²(n)·s(n), computed from one FFT

  best ← none
  for each candidate period P over the allowed integer range:
      Ψ(P) ← P × Σ_k φ(k·P)              # all multiples of the lag,
                                          # not just the first
      ε(P) ← unbiased spectral error implied by Ψ(P), normalised so
             that noise scores near one and periodicity near zero
      if ε(P) < ε(best):  best ← P

  # reject the octave: prefer the shortest period that fits as well
  for each sub-multiple Q of best that lies in range, shortest first:
      if ε(Q) is comparable to ε(best):
          best ← Q
          stop

  return best
```

### Refinement

Integer resolution is not enough — accurate voiced/unvoiced decisions in the
high-frequency bands *require* better than integer pitch — so the
frequency-domain error is minimised locally around the coarse estimate using
successively finer evaluation grids. The paper's worked example is
persuasive: for a segment of female speech the final estimate is 42.48
samples, and the figure overlaying synthetic and original spectra at 42.48
against the best integer estimate of 42 shows the high harmonics visibly
drifting out of alignment in the integer case
<span class="cite">Griffin &amp; Lim 1988, §III-A, Fig. 2(d)–(e)</span>.
Later systems refine to 1/4 or 1/8 sample, interpolating autocorrelation
values at non-integer lag as `r(n+d) = (1−d)·r(n) + d·r(n+1)`
<span class="cite">US 5,216,747</span>.

### Tracking

Pitch does not jump. Exploiting that is worth more than any single-frame
improvement — but doing it naively, by smoothing the estimates, costs
accuracy even on clean speech
<span class="cite">Griffin &amp; Lim 1988, §III-B</span>.

The paper's answer is dynamic programming. There are three cases for a pitch
track — it starts in this frame, terminates in this frame, or continues
through it — and the third turns out to be adequately modelled by one of the
first two. So the analyser looks `N` frames backward and `N` forward
(`N = 3`, about 60 ms, is typical), allows a frame-to-frame deviation of `D`
samples (`D = 2` typical), finds the minimum-error path in each direction by
summing the errors along it, and takes the current-frame period from
whichever path scored better. The benefit is exactly the asymmetric one you
want: it "improves tracking through very low signal-to-noise ratio segments
while not decreasing the accuracy in high SNR segments"
<span class="cite">Griffin &amp; Lim 1988, §III-B and §III-D, step 3</span>.

US 5,216,747 turns this into a shippable form. Look-back tracking constrains
the candidate to `(1−α)·P₋₁ ≤ P ≤ (1+α)·P₋₁`; failing that, look-ahead
tracking minimises `CE(P) = E(P) + E₁(P₁) + E₂(P₂)` over the next two frames
under the same fractional constraints, `α = β = 0.2` typical. To make that
affordable the ~200 candidate periods are grouped into "a small number of
non-uniform regions. A reasonable number is 20" — `22 ≤ P < 24`,
`24 ≤ P < 26`, … , `107 ≤ P < 115` — and continuity becomes a permitted
change of a fixed number of regions
<span class="cite">US 5,216,747</span>.

### A different front end entirely

The later excitation patents attack a specific weakness: when the
fundamental changes during the analysis window, the spectral peak at the
`m`-th harmonic broadens more than the peak at `ω₀`, an effect that
"increases with increasing frequency" and so "reduces the effectiveness of
higher harmonics in the estimation of the fundamental frequency"
<span class="cite">US 5,715,365 (Griffin &amp; Lim, DVSI, filed 1994, issued 1998)</span>.
The harmonics that pin down the pitch most precisely are exactly the ones
that smear.

The remedy is a **nonlinear operation** — absolute value, squared magnitude,
`log|x|`, a fractional power — applied to bandpass-filtered channels.
Squaring convolves the spectrum with itself, and the convolution "has
spectral peaks at frequencies equal to the differences between the
frequencies for which `X(ω)` has spectral peaks". A channel containing only
the 3rd, 4th and 5th harmonics therefore produces a peak at `ω₀` — a
fundamental that was never present in that channel at all. Sixteen such
channels are combined, and `ω₀` is chosen to maximise the combined output,
refined by parabolic interpolation and octave-checked against `0.5·ω₀`
<span class="cite">US 5,715,365</span>.
The continuation runs **two estimators**, converts each result into a
probability of being correct from its voiced-to-total energy ratio, and
keeps whichever is more probably right
<span class="cite">US 5,826,222 (Griffin, DVSI, filed 1997, issued 1998)</span>.

## Voicing: the decision you get for free

Here is the elegance of analysis by synthesis. You have already fitted the
spectrum with a purely periodic model and computed the error in every
harmonic interval. The voicing decision is just: **where did that fit fail?**

For each harmonic, form the normalised error — the error in that interval
divided by the energy in that interval:

```text
             ε_m
   ξ_m  =  ─────────────────────────────
           (1/2π) ∫ |S_w(ω)|² dω     (over a_m … b_m)
```

<span class="cite">Griffin &amp; Lim 1988, eq. 14</span>

When `ξ_m` is below threshold, "this region of the spectrum matches that of
a periodic spectrum well and the `m`-th harmonic is marked voiced". When it
is above, "this region of the spectrum is assumed to contain noise-like
energy". And then, disarmingly: "A threshold value of 0.2 works well in
practice"
<span class="cite">Griffin &amp; Lim 1988, §III-C</span>.

No separate voicing detector. No zero-crossing rate, no low-band energy
ratio, no trained classifier. The per-band voicing map is a by-product of
the residual of a fit you had to do anyway.

Because bits are finite, harmonics are grouped into coded bands: given `N`
bits, the spectrum is divided into `N` equal-width bands and each band's bit
comes from an amplitude-weighted sum of its harmonics' normalised errors —

```text
   E_k  =  Σ |A_m| · ξ_m   /   Σ |A_m|        (m in band k)
```

<span class="cite">Griffin &amp; Lim 1988, eq. 18</span>

— which lets loud harmonics dominate their band's decision rather than
letting one quiet, noisy harmonic drag a strong voiced band unvoiced. The
1988 coder used 12 bands; the AMBE-rate system uses "eight V/UV decisions
... over eight different frequency bands spaced between 0 and 4 kHz", about
500 Hz each, with every harmonic labelled according to the band its
frequency falls in
<span class="cite">Griffin &amp; Lim 1988, §V-A; US 5,754,974</span>.

<!-- PSEUDOCODE — illustrative only. Not executable, not a specification. -->

```text
PSEUDOCODE — per-band voicing test (NOT EXECUTABLE)

  # ω₀ and the amplitudes A[·] are already known from the pitch fit
  for each harmonic m = 1 … L:
      interval ← one fundamental wide, centred on m·ω₀
      ε_m ← spectral error over interval, using the purely periodic model
      ξ_m ← ε_m / (energy of the original spectrum over interval)
      # ξ ≈ 0  → the band is explained by harmonics
      # ξ ≈ 1  → the band is not periodic at all

  for each coded band k:
      E_k ← Σ A[m]·ξ_m / Σ A[m]      over the harmonics m falling in band k
      voiced[k] ← ( E_k < threshold )

  return voiced[·]
```

### Making the threshold survive the real world

A fixed threshold works in a lab and fails on a handheld in a car park.
US 5,216,747 makes it adaptive: the threshold becomes a function of pitch
and frequency multiplied by a factor derived from running energy statistics.
The frame's weighted energy is tracked against a recursively updated
average, maximum and minimum — one-pole trackers with deliberately different
time constants, so the maximum reacts fast to onsets while the noise-floor
estimate crawls — and the decision is biased toward unvoiced in
low-relative-energy frames, strongly so in silence. The analyser knows
whether this frame is loud or quiet *relative to this talker in this
environment*
<span class="cite">US 5,216,747, printed constants γ₀ = 0.067, γ₁ = 0.5, γ₂ = 0.01</span>.

US 5,826,222 replaces the single measure with two and a merge. The
frequency-domain measure is `A_k = 1 − E_v(ω₀)/E_t` per band, where the
voiced energy sums the power within `±0.25·ω₀` of each harmonic — the width
of the spectral peak — and frequencies below `0.5·ω₀` are excluded from the
total because "including these frequencies reduces performance". The
time-domain measure is a sinusoid detector, `B_k = 1 − S_k(1)/S_k(0)`. They
merge as `V_k = min(A_k, B_k + α(k)·β(ω₀))` — the minimum, because "a
preliminary V/UV parameter having a value close to zero has a higher
probability of being correct" — and the result is smoothed across time and
frequency
<span class="cite">US 5,826,222</span>.
Note what that is: a *continuous* degree of voicing, thresholded only at the
end. The bit that goes on the air is binary. The analyser that produces it
is not.

<!-- ANIM: voicing -->

## Amplitudes: measuring the envelope

The amplitudes come from the same closed form that made the pitch search
tractable — equation 7 above — with the excitation transform substituted
according to the band's voicing:

- **Voiced intervals.** Substitute the periodic transform `P_w(ω)` for
  `E_w(ω)`. Efficiently: precompute samples of the Fourier transform of the
  analysis window and centre them on that interval's harmonic frequency —
  a correlation of the observed spectrum against the window's own lobe
  shape, normalised by the lobe's energy.
- **Unvoiced intervals.** Substitute idealised white noise, unity across the
  band, which collapses the ratio to averaging the original spectrum over
  the interval. Only the magnitude is estimated; the phase is not needed to
  synthesize noise.

<span class="cite">Both: Griffin &amp; Lim 1988, §III-A</span>

<!-- ANIM: envelope -->

Later systems changed this in a way that matters more than it looks. Using
different formulas for voiced and unvoiced amplitudes means that when a
band's voicing flips between frames, its amplitude estimate jumps for
reasons that have nothing to do with the speech. US 5,754,974 and
US 5,701,390 introduce a **compensated total energy** method: each magnitude
is a weighted sum of the spectral energy `|S_w(ω)|²`, with the weighting
function offset by the harmonic frequency to compensate for the gap between
`l·ω₀` and the FFT's sample grid at multiples of `2π/N` — and computed
"independently of whether the determined frequency is in a frequency band
that is voiced or unvoiced"
<span class="cite">US 5,754,974; US 5,701,390</span>.
One estimator, always, so the envelope stays continuous through voicing
transitions and does not fluctuate with where the harmonics happen to land
between FFT bins.

The count of amplitudes, again, follows from the pitch: `L = ⌊α·π/ω₀⌋`, with
`α = 0.925` in the 3.6 kbit/s 8 kHz system for a coded bandwidth of 3700 Hz
<span class="cite">US 5,701,390; US 5,754,974</span>.

<!-- VIDEO: harmonic-sum -->

## What comes out

At the end of analysis, for each 20 ms of speech, the encoder holds:

- a refined fundamental frequency `ω₀`, sub-integer in resolution, tracked
  for continuity and checked against its own octaves;
- a voiced/unvoiced flag for each of eight roughly 500 Hz bands;
- `L` spectral magnitudes, `L` determined by `ω₀`, measured the same way
  regardless of voicing;
- and no phases at all.

That is the complete description of a syllable. It is also, at this stage,
still a set of real numbers, and there are only 48 or 72 bits to put them
in. Getting from one to the other is
[quantization](03-quantization.md).
