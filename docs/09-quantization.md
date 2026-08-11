# Turning measurements into bits

<!-- Owner: quantization-agent -->

The analysis stage hands us a description of 20 milliseconds of speech:
a fundamental frequency, a voiced/unvoiced verdict for each region of the
spectrum, and a set of harmonic amplitudes. All of it is continuous. Real
numbers, as many decimal places as you care to compute.

The radio has 72 bits.

Everything in this chapter is about that collision. Quantization is the
part of a codec where an honest measurement of a voice becomes an integer
index that fits in a fixed-width field, and where the designer decides,
irrevocably, which kinds of error the listener will hear.

## The budget is fixed; the voice is not

US 5,754,974 describes the AMBE coder that D-STAR uses at the level of the
budget: *"In the 3.6 kbps system 72 bits are used to quantize the model
parameters for each 20 ms frame. Seven (7) bits are used to quantize the
fundamental frequency, and 8 bits are used to code the V/UV decisions in 8
different frequency bands... The remaining 57 bits per frame are used to
quantize the spectral magnitudes for each frame."*[^974]

Hold on to that shape — 7 + 8 + 57 = 72 — but not to those exact numbers.
That allocation is the patent's example for a system in which all 72 bits
carry parameters; the D-STAR variant spends part of the same 3600 bps on
forward error correction ([the D-STAR frame on the air](10-the-dstar-frame.md)),
leaving a parameter budget roughly
two-thirds this size. What survives is the structure: **a small field for
pitch, a smaller one for voicing, and everything left over for the spectral
envelope.** The envelope is where the bits go, because the envelope is what
makes a voice sound like a voice. Those same three families are the MBE
model itself — US 5,649,050 describes it in passing as representing speech
by its *"fundamental frequency, spectral envelope, and voiced
character"*[^050].

## Scalar quantization: one number, one index

The simplest way to spend bits is one parameter at a time. Choose a set of
reproduction levels, find the nearest one to your measurement, transmit its
index. With *n* bits you get 2^n levels, and the error you inject is
roughly half the spacing between them.

The interesting decision is *where* to put the levels. Uniform spacing
minimises absolute error, and it is the wrong choice for almost every
quantity in a vocoder, because hearing is not linear in anything. Three
examples from the patent record:

**Pitch is coded uniformly in *period*, which is non-uniform in
frequency.** US 5,630,011 describes the IMBE approach as *"The parameter P
is uniformly quantized using 8 bits and a step size of 0.5. This
corresponds to a pitch period accuracy of one half sample."*[^011] Even
steps in period mean the step in hertz grows as the pitch falls — which is
what you want, because pitch discrimination is roughly proportional rather
than absolute. A half-semitone error at 100 Hz and at 300 Hz sound about
equally wrong; a 2 Hz error at those two pitches does not.

**Amplitudes are coded in the log domain.** US 5,754,974 puts it plainly:
*"A differential block Discrete Cosine Transform (DCT) method is applied to
the log spectral magnitudes."*[^974] A fixed number of quantizer steps then
buys a fixed number of decibels, everywhere in the spectrum and at every
input level — and since loudness perception is approximately logarithmic,
that makes the error approximately uniform *perceptually*, which is the
only kind of uniformity worth having.

**Gain gets its own non-uniform quantizer.** US 5,870,405 allocates the
overall level term *"6 bit non-uniform quantizer"* and codes the remaining
block-level terms with *"uniform scalar quantizers ... step sizes dependent
upon L, the number of harmonics."*[^405] Note that last clause. We will
come back to it.

## Vector quantization: many numbers, one index

Scalar quantization treats each number as if the others did not exist. In
a speech spectrum that is a poor assumption — adjacent harmonics are
strongly correlated, formants move as units, and the *shape* of a vowel
lives in the relationship between amplitudes rather than in any one of
them.

Vector quantization exploits that directly. Instead of 2^n levels on a
line, you build a **codebook**: a stored list of 2^n candidate *vectors*,
each one a complete little chunk of spectrum shape. The encoder searches
the codebook for the entry closest to the measured vector and sends only
that entry's index. The decoder looks the index up.

<figure class="anim-figure anim-figure--wide">
  <div class="anim-figure__head">
    <p class="anim-figure__title">One index for a whole shape</p>
  </div>

  <!-- The render is build output: .github/workflows/animations.yml renders
       animations/manim/scene_vq.py and writes
       docs/assets/video/vq.mp4 and .vtt. Those are not committed (see
       .gitignore), so this element shows its poster until the workflow has
       run. The builder rewrites relative `src` but not `poster`, hence the
       page-relative poster path. -->
  <video class="anim-video" controls playsinline preload="none"
         poster="../assets/posters/vq.png">
    <source src="assets/video/vq.mp4" type="video/mp4">
    <track kind="captions" srclang="en" label="English"
           src="assets/video/vq.vtt">
    <p>This clip shows a cloud of two-dimensional points being clustered, and
    each cluster centre standing in for every point near it.</p>
  </video>

  <figcaption class="anim-figure__caption">
    Scalar quantization puts a grid over the whole plane and pays for
    positions no real vector ever visits. A codebook puts its entries where
    the data actually is, and the transmitted number is the index of the
    nearest one. Watch what happens to the error when the cloud is elongated:
    that elongation is correlation, and it is free to the codebook.
    <span class="anim-figure__source">Synthetic data from a seeded generator
    in <code>animations/manim/scene_vq.py</code>, clustered by ordinary Lloyd
    iteration. It is a picture of the idea. AMBE's own codebooks appear in
    neither the JARL specification nor the patents.</span>
  </figcaption>
<!-- BEGIN generated transcript: tools/make-transcripts.py -->
<details class="anim-transcript">
  <summary>Transcript of the narration</summary>
  <div class="anim-transcript__body">
    <p>Every frame of speech produces a handful of measurements. Plot enough of them and they do not fill the space evenly. They clump.</p>
    <p>So do not describe a point. Pick a set of representative points, agree on them in advance, and put the same set at both ends of the link.</p>
    <p>Now a measurement does not travel. What travels is the position of the closest entry in that table. A number small enough to spend a few bits on.</p>
    <p>The cost is the gap between the measurement and the entry that stood in for it. That error never goes away. It is the price of the whole scheme, and the only way to shrink it is a bigger table.</p>
    <p>Quantize several parameters together and the clumping works harder for you, because real speech parameters move together rather than independently. That is how a fifth of a second of voice becomes nine bytes.</p>
  </div>
</details>
<!-- END generated transcript -->
</figure>

Three things follow, and they explain why every serious low-rate vocoder
does this:

1. **Correlation becomes free.** If harmonics 3 and 4 usually rise
   together, the codebook simply contains no entry where one rises and the
   other falls. Impossible shapes cost nothing, because they are never
   addressable.
2. **Bit cost decouples from dimensionality.** A 9-bit index selects one of
   512 vectors whether each holds three numbers or thirty — fractional bits
   per parameter, which scalar quantization cannot do.
3. **The design work moves into the table.** The codebook *is* the model of
   what speech spectra look like, trained offline and encoding the
   designer's priorities permanently.

That last point is why this chapter will not show you a codebook. The
tables used by D-STAR's AMBE variant have never been published — not in the
JARL specification, and not in the DVSI patents, which give the
*mechanism* and the vector *sizes* without listing entries. They exist,
they are searched by nearest-neighbour distance, they are the reason the
codec sounds the way it does, and their contents are not public.
[What is not in the public record](13-what-is-not-established.md) has more.

## The envelope, coded as a residual

The largest field in the budget is the spectral envelope, so it gets the
most structure. Three ideas stack on top of each other.

Start with the raw material. The dots below are the harmonic amplitudes of
one frame of a real capture, and the slider rounds them to a coarser and
coarser step. Push it to 6 dB and then to 12 dB, and listen to the number in
the header rather than the picture: that is the error you are choosing to
inject, in decibels, before a single bit has been allocated.

<div data-anim="envelope"></div>

### 1. Predict this frame from the last one

Speech is slow. Twenty milliseconds is short enough that a vowel's
spectrum barely moves, so transmitting the amplitudes afresh each frame
wastes bits describing something the decoder could have guessed.
US 5,630,011 predicts the current frame's log amplitudes from the previous
frame's and codes only the difference — the *prediction residual*.

The prediction is scaled by a decay factor. The patent gives it as γ, and
says it *"is typically equal to 0.7, however any value in the range
0≦γ≦1 can be used."*[^011] That scaling is error containment, not tuning.
With γ = 1 the predictor is a pure integrator and one corrupted frame
biases every frame after it forever; with γ < 1 the influence of any single
frame decays geometrically, so a hit from the channel fades out over a few
frames. You pay in efficiency — the smaller γ is, the less of the previous
frame you get to reuse, and the bigger the residual you must code.

The patent goes further and makes the factor adaptive, tying it to how many
harmonics the frame has: *"For a relatively low number of spectral
harmonics ... the decay factor α will be a relatively small number ... so
that any errors decay away quickly, at the expense of a less purely
differential coding method,"* while for higher counts *"the decay factor is
high ... which may result in a more persistent error, but which requires
fewer bits to encode the differential values."*[^011] Few harmonics means
few bits and more riding on each one, so the design leans toward
robustness; many harmonics means more redundancy to exploit, so it leans
toward efficiency.

### 2. Handle the fact that the frames are different lengths

Here is the wrinkle that makes MBE prediction harder than it sounds. The
number of harmonics is not a constant. It falls out of the pitch:

> *"the total number of spectral magnitudes, L, is inversely related to the
> estimated fundamental frequency for the current frame and is typically
> computed as follows: L = floor(απ/ω₀) where 0≤α<1. A 3.6 kbps system
> which uses an 8 kHz sampling rate has been designed with α=0.925 giving a
> bandwidth of 3700 Hz."*[^974]

At an 8 kHz sampling rate that reduces to something you can do in your
head: **L = floor(3700 / F₀)**, with F₀ in hertz. A speaker at 100 Hz
produces 37 harmonics below 3700 Hz. The same speaker's spectrum, coded a
few frames later at 105 Hz, produces 35. Across the range of adult voices
the count swings by a factor of five or so — a low male voice near 70 Hz
yields around 52 magnitudes, a high voice near 400 Hz yields 9.

So the predictor is being asked to predict a 35-element vector from a
37-element one. US 5,630,011 resolves this by resampling: a relative index
maps each current-frame harmonic onto a fractional position in the previous
frame's spectrum — *"If the ratio of the current to the previous
fundamental frequencies is 1/3 ... k₁ is equal to 1/3·1, for each index
number 1"*[^011] — and linear interpolation between the two neighbouring
previous-frame amplitudes supplies the prediction. The two spectra are
treated as samples of the same underlying *envelope function*, and that
envelope is what is really being predicted. The codec is not tracking
harmonics; it is tracking the shape of the vocal tract, sampled wherever
the current pitch happens to put the harmonics.

One more subtlety. The patent subtracts the mean of the predicted spectrum
before coding — *"establishes ... the average of the interpolated spectral
log amplitudes ... and then subtracts this average from the vector of
predictions"*[^011] — so that a frame-average level error cannot leak
through the predictor into later frames. The overall level is then sent
separately, which is what the gain field is for. Level and shape travel on
different paths precisely so a mistake in one cannot contaminate the other.

### 3. Split the residual into blocks and transform each one

The residual vector — L numbers, however many that is this frame — is then
divided up. US 5,630,011: *"this vector is divided into blocks, for
instance six, and ... a transform, such as a DCT is performed."*[^011] The
DCT of each block concentrates that block's energy into a few coefficients,
so most of the block can be coded coarsely or not at all.

Then comes the move that gives the scheme its name. The DC coefficient of
each block — the block's average residual level — is pulled out, and those
DC values are collected into a vector of their own:

> *"The output of the DCT transform is organized in two groups: a set of
> D.C. values, associated into a vector referred to as the Prediction
> Residual Block Average (PRBA); and the remaining, higher order
> coefficients, both of which are quantized."*[^011]

The PRBA vector is the coarse tilt of the spectrum: is this frame
bass-heavy, bright, flat. US 5,870,405 transforms it once more — the gain
vector formed from each block's first DCT coefficient receives *"a six
point DCT"*[^405] — and it is this small, perceptually dominant vector that
gets vector-quantized against a codebook and given the best error
protection. The higher-order coefficients within each block are fine
detail, and are quantized more cheaply.

The structure is a hierarchy: **level, then tilt, then detail**, in
decreasing order of how much a listener would miss it.

## Why the bit allocation has to adapt

Everything above collides with the fact that L is not constant. A frame
with 9 magnitudes and a frame with 52 arrive at the quantizer with the same
bits available and wildly different amounts of information to carry.

So the allocation is a *function*, computed identically at both ends from a
value the decoder already has. That is the load-bearing trick: the decoder
derives L from the received pitch index before it unpacks anything else, so
both ends agree on the field widths without a single bit spent describing
them. Get the pitch index wrong and the frame does not merely sound wrong —
it unpacks wrong, because every subsequent field boundary moves.

```text
PSEUDOCODE — NOT EXECUTABLE, ILLUSTRATIVE ONLY.
Shape of the allocation. Codebook contents omitted.

  given pitch_index (received, or chosen by the encoder):

      F0 = dequantize_pitch(pitch_index)          # log-spaced levels
      L  = floor(3700 / F0)                       # US 5,754,974, alpha=0.925
                                                  # decoder derives this too:
                                                  # never transmitted

  # partition the L residuals into a fixed number of blocks whose
  # lengths depend on L, longer blocks toward the high end
  block_lengths = partition(L)                    # sums to L

  # fixed-size fields: the perceptually dominant path
  spend( gain_index )                             # scalar, non-uniform
  spend( prba_codebook_index )                    # vector quantized

  # variable-size fields: detail, scaled to what is left
  for each block:
      k = number_of_higher_order_coeffs(block)    # grows with block length
      spend( hoc_codebook_index[block] )          # coarser for small blocks

  # invariant that makes the scheme work at all:
  #   total bits spent is the same for every L
  #   both ends compute the same partition from the same L
```

Two consequences worth stating out loud.

**Low-pitched voices get less resolution per harmonic.** A 70 Hz speaker
has five times as many magnitudes to describe as a 400 Hz speaker, out of
the same budget. The codec compensates by coding shape rather than
individual harmonics — at 52 magnitudes the envelope is heavily
oversampled, so per-harmonic precision matters less than it does at 9. The
tradeoff is real, though, and audible if you listen for it.

**Step sizes move with L, not just bit counts.** US 5,870,405 describes the
block-level quantizers as having *"step sizes dependent upon L"*, and gives
the higher-order coefficient allocation in units of standard deviation —
for example *"4 bits allocated gives step size 0.40σ"*[^405]. The
quantizers are normalized to the expected statistics of each coefficient
rather than to a fixed absolute range, so a 4-bit field covers the same
*fraction of the likely spread* wherever in the spectrum it sits.

None of that structure is visible from outside. The nine bytes a real chip
emits for one frame are in the figure on
[the D-STAR frame on the air](10-the-dstar-frame.md#the-96-bit-frame), and
the honest thing to say about them is that no public document maps any of
those 72 positions onto any of the fields described above.

## What you should take away

The bits are not divided evenly, and were never meant to be. The scheme
spends them in strict priority order — pitch first, because every other
field's meaning depends on it; then overall level; then the coarse tilt of
the spectrum, vector-quantized against a trained codebook; then whatever
detail is left over. Prediction from the previous frame recovers what the
redundancy of speech allows, and a decay factor below one stops that
borrowing from turning one bad frame into a long bad noise.

[The D-STAR frame on the air](10-the-dstar-frame.md) picks the same ordering
up from the other side: the channel coding uses it too.

---

## Sources for this chapter

[^011]: **US 5,630,011** — *Quantization of harmonic amplitudes representing
    speech*. Source for the prediction-from-previous-frame
    structure, the decay factor γ ≈ 0.7 and its range 0 ≦ γ ≦ 1, the
    adaptive decay factor's dependence on L, the resampling of the previous
    spectrum when the harmonic count changes, mean removal from the
    prediction, block division and DCT, and the definition of the PRBA
    vector. Also the source for the 8-bit uniform pitch-period quantizer
    with step size 0.5 in the 7.2 kbps IMBE system.
    <https://patents.google.com/patent/US5630011A/en>

[^974]: **US 5,754,974** — *Spectral magnitude representation for
    multi-band excitation speech coders*. Source for the 20 ms /
    72-bit frame at 3.6 kbps, the 7 / 8 / 57 example allocation, the eight
    voicing bands spanning 0–4 kHz, the formula L = floor(απ/ω₀) with
    α = 0.925 giving a 3700 Hz bandwidth, and the differential block DCT of
    log spectral magnitudes.
    <https://patents.google.com/patent/US5754974A/en>

[^405]: **US 5,870,405** — *Digital transmission of acoustic signals over a
    noisy communication channel*. Source for the 6-bit
    non-uniform gain quantizer, the six-point DCT of the gain vector, the
    scalar quantizers whose step sizes depend on L, and the higher-order
    coefficient step sizes expressed in units of σ.
    <https://patents.google.com/patent/US5870405A/en>

[^050]: **US 5,649,050** — *Apparatus and method for maintaining data rate
    integrity of a signal despite mismatch of readiness between sequential
    transmission line components*. Cited only for its statement
    of the MBE parameter set — fundamental frequency, spectral envelope and
    voiced character. This patent concerns buffering and time-scale
    modification and contains no quantization detail.
    <https://patents.google.com/patent/US5649050A/en>

The derivation L = floor(3700 / F₀) is arithmetic on US 5,754,974's formula
at an 8 kHz sampling rate, not a separately sourced claim. The illustrative
harmonic counts for 70 Hz and 400 Hz voices follow from the same formula;
the exact range of fundamental frequencies the D-STAR variant actually
codes is **not** stated in any public source available to this project.
Neither are the codebook contents, the number of blocks used by the D-STAR
variant, or the exact widths of its parameter fields. See
[what is not in the public record](13-what-is-not-established.md).

---

**Next: [The D-STAR frame on the air](10-the-dstar-frame.md).** What happens
to those indices on the way out of the radio: unequal error protection, a
descrambling key chained to the most important field, and 24 bits of data
riding alongside every voice frame.
Previously: [Analysis: pitch, voicing, amplitudes](08-analysis.md).
{: .chapter-nav }

Last reviewed: 2026-08-10.
{: .source-note }
