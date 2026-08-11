# What is not in the public record

<!-- Owner: gaps-agent -->

Everything on the previous pages came from documents anyone can read: the
Multi-Band Excitation papers, a set of expired US patents, and the JARL
D-STAR system specification. Read together, they describe the MBE model
completely enough that you could build *an* MBE vocoder from them.

They do not describe *the* vocoder in your radio.

This page is about that difference: a map of the boundary between what is
documented and what is not, and of what independent measurement of real
hardware can and cannot tell you about the far side of it.

!!! note "How the measurements on this page were made"

    Every measurement described here comes from operating a commercially
    purchased DVSI AMBE-3000 device — a ThumbDV-class USB vocoder stick —
    as a black box: feed it audio or frames on one side, record what
    comes out the other, and characterise the transfer. Nothing was
    disassembled, decompiled, or read out of the chip, and no third-party
    codec source code was consulted. This is measurement of a product's
    externally observable behaviour, which is the same thing a reviewer
    does with a radio on a bench.

## What the public record actually gives you

More than most people assume. The expired patents are unusually specific,
because a patent must enable the invention.

- **The model itself.** Speech as a spectral envelope multiplied by an
  excitation spectrum, with an independent voiced/unvoiced decision per
  frequency band rather than one per frame.
  <span class="cite">Griffin &amp; Lim 1988</span>
- **Pitch and voicing estimation**, including the nonlinear
  band-preprocessing trick that regenerates energy at a missing
  fundamental, and the hybrid frequency-domain/time-domain estimator with
  pitch-multiple search and voicing smoothing.
  <span class="cite">US 5,715,365; US 5,826,222; US 5,216,747</span>
- **Spectral amplitude estimation**, computed identically for voiced and
  unvoiced harmonics — and, in one case, an actual tabulated analysis
  window printed coefficient by coefficient.
  <span class="cite">US 5,754,974, Table 1</span>
- **Predictive quantization**: predict this frame's log-amplitudes from
  the last frame's reconstructed ones, interpolate across a changing
  harmonic count, quantize the residual through a block DCT, subtract the
  mean so a gain error cannot propagate, and apply a decay factor below
  unity so channel errors die out.
  <span class="cite">US 5,630,011</span>
- **The channel side**: bits ranked by error sensitivity, Golay and
  Hamming codes assigned accordingly, interleaving against burst errors,
  a pseudo-random scrambling sequence keyed from the strongest-protected
  bits so the decoder can *detect* uncorrectable errors, and frame-repeat
  or mute on failure. This patent even prints a non-uniform gain
  quantizer codebook and a table of DCT step sizes.
  <span class="cite">US 5,870,405</span>
- **Regenerated-phase synthesis**, the thing that separates a natural MBE
  decoder from a buzzy one: voiced phases derived from the log spectral
  magnitudes through an antisymmetric kernel, with the kernel and its
  scaling constant given explicitly.
  <span class="cite">US 5,701,390</span>
- **The D-STAR channel layer**: 4800 bps GMSK, 96 bits per 20 ms frame,
  split as 72 bits of voice frame plus 24 bits of data, with the voice
  budget described as 2400 bps of voice and 1200 bps of FEC.
  <span class="cite">JARL D-STAR system specification</span>

That is a lot. It is genuinely enough to build a working MBE codec.

## The gaps

The problem is that the public record describes a *family* of systems,
and a shipping product is one specific member of it, chosen and tuned.
The documents stop exactly where the choices begin.

**The bit budget does not line up.** The expired patents do give bit
allocations — one of them allocates a 3.6 kbps system as a fundamental
frequency, a set of band voicing bits, and the remainder to magnitudes
<span class="cite">US 5,701,390</span>. But in that system the entire
3.6 kbps is spent on *parameters*, with forward error correction layered
on top at a higher rate — 3.6 kbps of parameters carried in a 4.8 kbps
channel. D-STAR inverts that: its 3600 bps voice frame already includes
1200 bps of FEC <span class="cite">JARL</span>, leaving 2400 bps of
parameters — two thirds of the bits, not all of them. So whatever
allocation the deployed D-STAR codec uses, it is
not any of the allocations printed in the expired patents. No public
document states what it is.

**The band splitting is unfixed.** The public sources variously describe
sixteen analysis channels mapped to eleven voicing bands
<span class="cite">US 5,715,365</span>, eight voicing bands
<span class="cite">US 5,701,390</span>, and a range of three to fifteen
bands quoted as context <span class="cite">US 5,649,050</span>. All are
consistent with the model. Only one of them is in your radio, and the
papers do not say which.

**Free parameters are given as shapes, not values.** The predictor decay
is specified as "a factor below one, chosen as a function of the harmonic
count" <span class="cite">US 5,630,011</span>, and elsewhere as adaptive
<span class="cite">US 5,870,405</span>. That is a design constraint, not
a number. The same is true of voicing thresholds, pitch-tracking
penalties, and the error-rate thresholds that trigger frame repeat or
mute.

**Nothing fixes absolute level.** The patents describe the gain term
structurally — a frame-mean of the log magnitudes, quantized non-uniformly,
transmitted differentially. They do not tie that term to a physical
reference. Two implementations can both be internally consistent, both
faithful to the patents, and still disagree by a large constant on what a
given input amplitude should encode to. Worse, the gain term admits more
than one reasonable definition — the log of the mean energy and the mean
of the log magnitudes are not the same quantity, and they diverge as the
spectrum spreads out.

**Codebooks, if any, are absent.** If a deployed codec replaces the
patents' scalar DCT-residual quantizers with trained vector-quantizer
codebooks, those tables exist in no publication. A codebook is not an
algorithm; there is nothing to enable and nothing to disclose.

Those gaps are visible in one picture. The frame-bit figure on
[the D-STAR frame on the air](04-the-dstar-frame.md#the-96-bit-frame) shows
72 real captured bits per frame and colours them by how often each position
changes, because that is a measurement. It does not colour them by field,
because the field map is the thing that is missing. The part of that figure
worth looking at is the part that stays deliberately unlabelled.

## What black-box measurement can establish

Quite a lot, if you are careful about what you claim.

Driving a purchased AMBE-3000 with known signals establishes
**end-to-end transfer properties**: the level relationship between input
and decoded output, the spectral tilt a signal acquires crossing the
codec, the latency, and the behaviour at the extremes of its dynamic
range.

It establishes **dynamic behaviour** that no document mentions. Our
measurements found that the device's gain tracking ramps up over roughly
twenty to forty milliseconds at word and phoneme onsets, a systematic
level shortfall at attacks that the ear reads as natural articulation
rather than as a fault. That is a repeatable property of the product, and
it is nowhere in the literature.

It establishes **the shape of convention mismatches**. Cross-connect an
independent implementation and the hardware in both directions: if each
side's own loop is spectrally flat while the two cross paths show equal
and opposite tilt, that is the signature of a single scalar convention
each loop silently cancels. The measurement localises the disagreement to
one recursive parameter and constrains its value; it does not tell you
what that parameter is called inside the device, or whether the device
even has one.

And it establishes **negative results**, which is where most of the value
is. A hypothesis that fits one probe and fails the cross-path test is
refuted, cheaply. Several of ours were.

!!! note "Where the other side of that cross-connect lives"

    The "independent implementation" in this section is a separate,
    unpublished project of the author's. It is not this repository. **No
    part of it — no code, no table, no tuning constant, no offset derived
    from it — appears anywhere on this site**, and nothing on the
    [Listen](07-listen.md) page was produced by or compared against it;
    those files are a hardware round trip and nothing else. This section
    describes the *shape* of an experiment so that someone else can design
    their own. It does not report that project's results.

## What it cannot establish

Measurement observes behaviour and therefore can never distinguish
between implementations that behave identically. It cannot recover a
codebook: probing a table tells you what a given index reconstructs to
under one condition, not how the table was designed or what it contains
elsewhere. It cannot see the encoder's internal decisions except as they
survive into the emitted frame. It cannot separate "the AMBE full-rate
definition" from "this chip, this firmware revision" — a second device
from a different production era might not agree, and we have not tested
that. And a model that fits every measurement you have taken is still
only the simplest explanation for the measurements you took.

## What remains unknown

Stated plainly, as open questions rather than as secrets:

1. **The exact gain convention.** We can measure the offset between an
   independent implementation and the hardware, and we can compensate for
   it empirically. We cannot yet derive it from first principles, and the
   shape of the residual error suggests the definition itself differs,
   not just a constant.
2. **The parameter bit allocation of the deployed D-STAR full-rate
   frame.** Not published, and not the same as any patent allocation.
3. **The band-splitting actually used**, and the thresholds governing the
   voicing decision.
4. **Whether the decoder's spectral post-processing is on by default**,
   and with what strength.
5. **Whether "AMBE full-rate" is one stable definition** across DVSI
   product generations, or a family that drifted.

## What this page will never contain

There is a version of this chapter that lists numbers. This is not it.

This project only publishes claims traceable to an expired patent, a
published paper or public specification, or its own measurement of
purchased hardware. A number whose only provenance is somebody else's
reverse-engineered implementation fails that test, so it is not here —
several candidate claims were dropped from this page on exactly that
ground.

That constraint turns out to cost little, because the shape of a gap is
the interesting part. Knowing that the gain convention is ambiguous, and
*why* two defensible definitions diverge, is worth more to someone
building an interoperable codec than a constant that happens to work on
one device. The constants are findable by anyone with a hundred-dollar
stick and patience. The map is what takes time.

---

**Next: [Listen: real hardware examples](07-listen.md).** Eight sentences
through a real AMBE-3000, with something specific to listen for in each.
Previously: [Synthesis: rebuilding the voice](05-synthesis.md).
{: .chapter-nav }
