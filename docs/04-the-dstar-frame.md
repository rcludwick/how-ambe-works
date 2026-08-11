# The D-STAR frame on the air

<!-- Owner: frame-agent -->

[Turning measurements into bits](03-quantization.md) ended with a pile of
quantizer indices and a strict sense of
which ones matter most. This chapter is about what happens to them next:
how they are wrapped in error correction, interleaved with a data channel,
and clocked onto a 4800 bps GMSK carrier that has to survive a mobile radio
path.

The primary source here is the JARL D-STAR system specification — the
document that actually defines the on-air format — with US 5,870,405 for
the error-protection scheme it refers to but does not spell out.

If you want the whole chain in one piece before the details, this is it:
one frame of a real capture followed from the microphone to nine bytes and
back to sound.

<figure class="anim-figure anim-figure--wide">
  <div class="anim-figure__head">
    <h4 class="anim-figure__title">One frame, end to end</h4>
    <span class="badge measured">measured</span>
  </div>

  <!-- The render is build output: .github/workflows/animations.yml renders
       animations/manim/scene_pipeline.py and writes
       docs/assets/video/pipeline.{webm,mp4}. Those files are not committed
       (see .gitignore), so this element shows its poster until the workflow
       has run. The builder rewrites relative `src` but not `poster`, hence
       the page-relative poster path. -->
  <video class="anim-video" controls playsinline preload="none"
         poster="../assets/posters/pipeline.png">
    <source src="assets/video/pipeline.webm" type="video/webm">
    <source src="assets/video/pipeline.mp4" type="video/mp4">
    <p>This clip follows one 20 ms frame of speech from the waveform through
    analysis, quantization and the channel to resynthesis.</p>
  </video>

  <figcaption class="anim-figure__caption">
    Sixty-eight seconds for a fifth of a second of speech. Frame 45 of the
    male CQ capture: the window, its spectrum, the pitch, eight band
    decisions, twenty harmonic amplitudes, the nine bytes the chip actually
    emitted (<code>637ff954cfb6a93a9b</code>), and the decoded audio at the
    far end. The 7 + 8 + 57 bar it draws is the patent's example allocation,
    not D-STAR's, which is unpublished.
    <span class="anim-figure__source">Measured values from
    <code>assets/data/norman-b/</code>, captured from a DVSI AMBE-3000; pitch
    and band voicing are DSP over the recordings, not device state.
    L = ⌊α·π/ω₀⌋: US 5,754,974. Rates: JARL D-STAR spec §1.1(3),
    §2.1.2(2).</span>
  </figcaption>
</figure>

## The rates, from the top

The JARL specification's technical requirements for digital voice are
short enough to quote almost in full:

> **(1) Modulation methods** — GMSK, QPSK, 4FSK
> **(2) Data rate** — Maximum of 4.8 Kbps
> **(3) Voice encoding method** — AMBE (2020) converting at 2.4 Kbps, FEC
> at 3.6 Kbps
> **(4) Occupied bandwidth** — Maximum of 6 KHz[^jarl]

Three of those four numbers do most of the work. The channel runs at
4800 bps. The vocoder itself produces 2400 bps. After forward error
correction the voice stream occupies 3600 bps. The 1200 bps difference
between 4800 and 3600 is the data channel, and the 1200 bps difference
between 3600 and 2400 is the error correction — a pleasing coincidence of
arithmetic that has confused a great many people into thinking they are the
same 1200 bps. They are not.

In practice only GMSK is used on the amateur bands, though the
specification permits all three modulations.

## The 96-bit frame

Rates become structure at the frame level. The specification's description
of the voice packet:

> *"Data part includes 72-bit voice signal frames with a length of 20ms in
> order of their output from the CODEC according to the AMBE (w/FEC)
> specification. Data frames contain 24-bits of data."*[^jarl]

So the stream after the header is a strict alternation, forever:

```text
... [ 72 bits voice ][ 24 bits data ][ 72 bits voice ][ 24 bits data ] ...
     \___________________ 96 bits, 20 ms ___________________/
```

Check the arithmetic against the rates and it closes exactly:

| Slot | Bits per 20 ms | Rate |
| --- | --- | --- |
| Voice frame (AMBE with FEC) | 72 | 3600 bps |
| Data frame | 24 | 1200 bps |
| **Total** | **96** | **4800 bps** |

And within those 72 voice bits, the specification's own 2.4 kbps / 3.6 kbps
split implies the nominal division: 48 bits of vocoder parameters, 24 bits
of error correction, every 20 milliseconds. One frame of voice is 72 bits.
That is nine bytes. It is worth pausing on how little that is — nine bytes
per fifth of a second of a human being.

The framing figure in
[analysis](02-analysis.md#framing-and-windowing) shows those nine bytes
sitting against the 20 ms of waveform they were made from. Here they are on
their own, bit by bit, from the same capture. Step through the
clip and watch which positions change from frame to frame. Then look for a
region that stays still, or one that only changes during silence, and notice
that you cannot find one: nothing in the public record tells you which of
these 72 positions carries the pitch.

<!-- The frame-bit dissector (docs/javascripts/anim-bits.js). Its colours are
     measurements of the captured bits, never a guessed field map: the
     assignment of these 72 positions to codec fields is not published, and
     the figure says so on screen. -->
<div data-anim="bits"></div>

## Unequal error protection

Twenty-four bits of FEC cannot protect forty-eight bits of payload
equally. Attempting it would be a waste in any case, because the payload
bits are not equally important — chapter 3 showed that the fields form a
clean priority hierarchy, from the pitch index (whose corruption changes
the meaning of every other field) down to the finest spectral detail
(whose corruption is barely audible).

The scheme AMBE inherits for this is set out in US 5,870,405. Its worked
example is the 7.2 kbps IMBE coder rather than D-STAR's 3.6 kbps AMBE, so
the specific widths differ, but the architecture is the one D-STAR's
"AMBE (w/FEC)" refers to.

The quantizer bits are first sorted into **priority bit vectors**, u₀
through u₇, ordered by how much damage an error in each would do. The
patent is blunt about the ordering criterion: *"bit errors introduced into
u₀ cause large distortions in decoded speech,"* while *"errors in u₇ cause
small distortion."*[^405]

Then each vector is given protection proportional to its priority:

> *"the 56 bits per frame available for error control are used to protect
> the first four bit vectors with [23,12] Golay codes, while the next three
> bit vectors are protected with [15,11] Hamming codes. The last bit vector
> is left unprotected."*[^405]

That single sentence is the whole idea. Work through it:

| Vectors | Payload bits | Code | Transmitted bits | Corrects |
| --- | --- | --- | --- | --- |
| u₀–u₃ | 12 each (48) | Golay (23,12) | 23 each (92) | up to 3 errors each |
| u₄–u₆ | 11 each (33) | Hamming (15,11) | 15 each (45) | 1 error each |
| u₇ | 7 | none | 7 | none |
| **Total** | **88** | | **144** | |

144 bits per 20 ms is 7.2 kbps; 144 − 88 = 56 bits of redundancy, as
stated. The most valuable twelve bits in the frame get a code that
tolerates three errors; the least valuable seven get nothing at all.

Which bits land in u₀? US 5,630,011 names them:

> *"The six most significant bits from the fundamental frequency ω and the
> three most significant bits from the mean of the PRBA vector are first
> combined with three parity check bits and then encoded in a [23,12] Golay
> code. Thus, all of the six most significant bits are protected against
> bit errors."*[^011]

Exactly what chapter 3 predicted. The coarse pitch — the field the decoder
needs before it can compute L and therefore before it can find any other
field boundary — and the coarse overall level. Everything else in the
frame is conditioned on those.

```text
PSEUDOCODE — NOT EXECUTABLE, ILLUSTRATIVE ONLY.
Shape of the FEC layering. Field widths and code tables omitted.

  ENCODE:
      # 1. sort quantizer bits by perceptual damage-if-corrupted
      u[0] <- most significant pitch bits, most significant level bits
      u[1] ... u[n] <- remaining fields, decreasing importance
      u[last] <- finest spectral detail

      # 2. graded protection: strongest code on the most important vector
      c[0] <- strong_block_code( u[0] )     # corrects several errors
      c[k] <- weaker_block_code( u[k] )     # corrects one
      c[last] <- u[last]                    # sent bare

      # 3. modulate lower-priority codewords with a sequence derived
      #    from u[0], so that a broken u[0] is loudly obvious downstream
      key <- prng_seeded_from( u[0] )
      for k in 1 .. last:
          c[k] <- c[k] XOR key_slice(k)

      # 4. interleave the codewords across the frame so that a burst
      #    of channel errors is spread thinly over many codes
      airbits <- interleave( c[0..last] )

  DECODE: exactly the reverse, and note the ordering constraint —
      u[0] must be corrected FIRST, because it is the demodulation key
      for everything else.
```

## The self-checking trick

Step 3 above deserves its own heading, because it is doing something
cleverer than whitening.

The patent scrambles the lower-priority code vectors with a pseudo-random
sequence *"where the bit vector u₀ is interpreted as an unsigned 12 bit
number in the range [0, 4095]."*[^405] The generator is a linear
congruential recurrence, stated as an equation with its constants in
[US 5,870,405](https://patents.google.com/patent/US5870405A/en), which
expired in 2016. What matters here is the structure rather than the
arithmetic.

The point is this. The decoder must correct u₀'s codeword first, then use
the recovered u₀ to derive the descrambling sequence for everything else.
If u₀ came through clean, everything downstream descrambles correctly. If
u₀ was corrupted beyond the Golay code's three-error capability, the
decoder derives the *wrong* key, and the patent describes the result: an
incorrect demodulation vector causes *"a 50 percent bit error rate"* in
subsequent decoding.[^405]

That is a feature. The Golay code is *perfect* — it has no detection margin
beyond its correction radius, so a codeword with four or more errors
silently decodes to a plausible-looking wrong answer. Chaining the
descrambling key to u₀ converts that silent failure into an unmistakable
one: the lower-priority codewords suddenly report enormous numbers of
corrections. The decoder detects the undetectable error by watching the
damage it causes elsewhere.

The patent's recovery mechanism follows from that measurement. It counts
*"total errors corrected in code vectors"* across the frame, and if the
count exceeds a threshold the decoder performs **frame repeats** — reusing
the previous frame's parameters, on the theory that 20 ms ago is a better
estimate of the current voice than noise is — or, if the condition
persists, **frame mutes**.[^405] The audible signature of a marginal
D-STAR signal, that characteristic stutter-then-silence rather than the
harsh gargle you might expect, is this logic operating.

Two supporting details from the same patent:

**Interleaving.** The codewords are not transmitted one after another.
*"Intra-frame bit interleaving spreads short bursts of errors,"* with
*"the minimum separation between any two bits of the same error correction
code is 6 bits."*[^405] A fade that destroys six consecutive bits therefore
costs each individual codeword at most one bit — comfortably inside what
even the Hamming codes can fix. Interleaving does not add redundancy; it
redistributes damage from a form the codes cannot handle into a form they
can.

**A frame-boundary bit.** The patent reserves a bit that alternates every
frame — *"if previous frame was 0, current frame set to 1"* — giving the
receiver a way to verify frame alignment independently of the error control
coding.[^405]

The exact assignment of D-STAR's 72 voice bits to codewords, and the exact
interleaving pattern within the frame, are not published in the JARL
specification or in any expired patent. What is public is the architecture
above, which the specification invokes by name when it says "AMBE (w/FEC)".

## The data channel riding alongside

The 24-bit slot after each voice frame is the other half of D-STAR's
character. It is why a D-STAR radio can send your callsign, your position
and a short text message *while you are talking*, without stealing any
audio bandwidth — the voice and data streams are separately clocked and
never compete.

Most of those slots carry user data. Some carry synchronization:

> *"The first data frame and then every 21st data frame in a repeating
> cycle, are used only for synchronizing data for each modulation type ...
> This synchronized signal contains a 10-bit synchronized signals and two
> 7-bit Maximal-length sequences '1101000' patterns. (24 bits
> total)."*[^jarl]

So the stream has a 21-frame superframe: one sync slot, then twenty data
slots, then another sync slot, 420 ms apart. A receiver that tunes into a
transmission already in progress cannot find the header, but it can search
for that 24-bit pattern, and once it has found one it knows where every
frame boundary in the stream is — the 72 bits before the sync were a voice
frame, and everything after it is on a 96-bit grid. That is what makes
late entry work.

The data slots are scrambled, and the specification is precise about the
scope. The scrambler is a 7-stage LFSR:

> *"S(x) = x⁷ + x⁴ + 1. Initialization defines 1(1111111)."*[^jarl]

and *"Voice packet scrambling includes the radio header and data frames
except for synchronizing frames. Synchronized signals and the last frame
are not scrambled."*[^jarl] Note what is absent from that list: the voice
frames themselves. The scrambler exists *"to eliminate errors when the same
bit patterns are received continuously"* — a GMSK demodulator's clock
recovery needs transitions, and a long run of identical data bytes would
starve it. The voice frames need no such help, because they carry
high-entropy vocoder output that has already been through the
pseudo-random modulation of the FEC layer.

## The header, and how a transmission ends

Every transmission opens with a radio header carrying the routing
information — flags, destination and departure repeater callsigns,
companion callsign, own callsign — preceded by *"Repeated standard 64-bit
synchronization pattern (for GMSK 1010, for QPSK 1001)"* and a 15-bit frame
sync pattern `111011001010000`.[^jarl]

The header gets far heavier protection than the voice does, and for an
obvious reason: it is sent once, and getting it wrong misroutes the entire
transmission. The specification specifies a rate-1/2 convolutional code
with *"a constraint length of 3, and a depth of interleave of 24"*,
generator polynomials `G1(D) = 1 + D + D²` and `G2(D) = 1 + D²`, encoder
registers cleared to zero before encoding, header data fed in beginning
with the LSB, and two zero bits appended after the payload to flush the
encoder.[^jarl] The interleave matrix is printed in full in the
specification's Appendix 3 — 24 rows deep, which spreads consecutive coded
bits across roughly six milliseconds of airtime. The header also carries
its own CRC-CCITT checksum over `G(x) = x¹⁶ + x¹² + x⁵ + 1`.[^jarl]

Rate 1/2 convolutional coding plus deep interleaving costs the header 100%
redundancy. The voice stream, which is sent fifty times a second and can
afford to lose one, gets 50%.

The end of a transmission is marked in the data slot, not the voice slot:

> *"The last data frame, which requires a means of terminating the
> transmition, is a unique synchronizing signal (32 bit + 15bit
> '000100110101111' + '0', making 48 bits) as defined by the modulation
> type."*[^jarl]

Unscrambled, uncoded, and chosen to be unmistakable. When a receiver
matches it, the transmission is over.

## What the frame tells you about the codec

The frame format is a set of decisions about what to sacrifice, made
visible. Nine bytes of voice every 20 ms, a third of them spent on
redundancy that is distributed wildly unevenly — three-error correction on
the coarse pitch and level, nothing at all on the finest spectral detail.
A descrambling key chained to the most important field so that catastrophic
failure announces itself. Interleaving sized to the fades the channel
actually produces. A repeat-then-mute policy that chooses stutter over
noise.

None of it is about maximizing average fidelity. All of it is about how the
thing fails.

---

## Sources for this chapter

[^jarl]: **JARL D-STAR system specification** (English translation).
    Primary source for: the digital-voice modulation methods, 4.8 kbps
    maximum data rate, "AMBE (2020) converting at 2.4 Kbps, FEC at 3.6
    Kbps", 6 kHz maximum occupied bandwidth; the 72-bit / 20 ms voice frame
    and 24-bit data frame; the first-and-every-21st sync data frame with
    its 10-bit sync plus two 7-bit maximal-length `1101000` sequences; the
    48-bit termination sequence; the 64-bit bit-sync and 15-bit frame-sync
    patterns; the radio header field layout and its CRC-CCITT polynomial;
    the rate-1/2, constraint-length-3 convolutional code with generators
    G1(D) = 1 + D + D² and G2(D) = 1 + D², the depth-24 interleave matrix;
    and the S(x) = x⁷ + x⁴ + 1 scrambler with its all-ones initialization
    and its stated scope. <https://www.jarl.com/d-star/shogen.pdf>

    Note: the frame-structure diagrams in the specification label the voice
    and data slots "72byte" and "24byte", which contradicts the prose
    ("72-bit voice signal frames ... 24-bits of data") and the stated bit
    rates. The prose reading is the one used here, and it is the one the
    arithmetic supports.

[^405]: **US 5,870,405** — *Digital transmission of acoustic signals over a
    noisy communication channel* (expired). Source for: priority bit
    vectors u₀–u₇ and their ordering by perceptual damage; the assignment
    of (23,12) Golay codes to the first four vectors, (15,11) Hamming codes
    to the next three, and no protection to the last; the 56-of-144-bit
    error-control budget; the pseudo-random bit modulation seeded by
    interpreting u₀ as an unsigned 12-bit number in [0, 4095]; the
    50-percent bit error rate consequence of a mis-derived key; error
    counting, frame repeats and frame mutes; intra-frame bit interleaving
    with a minimum 6-bit separation; and the alternating frame-boundary
    bit. <https://patents.google.com/patent/US5870405A/en>

[^011]: **US 5,630,011** — *Quantization of harmonic amplitudes representing
    speech* (expired). Source for the contents of the highest-priority
    Golay-protected vector: the six most significant bits of the
    fundamental frequency and the three most significant bits of the PRBA
    vector mean, combined with three parity check bits.
    <https://patents.google.com/patent/US5630011A/en>

**Not publicly sourced, and therefore not stated above:** the assignment of
D-STAR's 72 voice bits to individual codewords; the widths of those
codewords; the within-frame interleaving pattern for the voice frame; the
exact constants of the pseudo-random generator; and the specific error
thresholds at which a D-STAR decoder repeats or mutes a frame. US 5,870,405
gives the architecture and the 7.2 kbps IMBE instance of it — the 3.6 kbps
AMBE instance that D-STAR uses is referred to by the JARL specification but
not defined by it. See
[what is not in the public record](06-what-isnt-published.md).

---

**Next: [Synthesis: rebuilding the voice](05-synthesis.md).** The far end of
the link, where a decoder that was never told a single phase has to
manufacture a waveform anyway.
Previously: [Turning measurements into bits](03-quantization.md).
{: .chapter-nav }
