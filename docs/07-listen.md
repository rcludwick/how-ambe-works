# Listen: real hardware examples

<!-- Owner: audio-agent -->

Eight sentences, two voices, each one played twice: once as it went in, once as
it came back from a real AMBE codec chip.
{: .lede }

Every "through the AMBE-3000" file on this page was produced by a **DVSI
AMBE-3000 vocoder chip** — the silicon inside a NW Digital Radio ThumbDV —
encoding the audio to 72-bit D-STAR frames and then decoding those frames back
to sound. **No software AMBE implementation was involved in producing the files
on this page: the chip did the encoding and the decoding, and this site only
measured it.** No AMBE encoder or decoder appears anywhere in this repository.
{: .source-note }

## How these were made

The chain is deliberately short and each stage is a file you can inspect:

1. **Synthesis.** Piper text-to-speech, one male voice (`en_US-norman-medium`)
   and one female voice (`en_US-ljspeech-high`), the same four sentences in
   both. Both voices were trained from scratch on public-domain speech
   corpora, which is why the clips can be redistributed under this site's
   licence; the datasets and their licences are in the
   [provenance table](#provenance-summary) below. Synthetic speech also means
   the material is identical between voices and free of room and microphone
   differences.
2. **Format.** Resampled to 8 kHz, 16-bit, mono — AMBE's native rate.
3. **Encode.** Pushed frame by frame into the ThumbDV, 160 samples in, 9 bytes
   out, per 20 ms. 4. **Decode.** Those same 9-byte frames pushed back into the same chip, 9 bytes
   in, 160 samples out.
5. **Level.** Each file scaled by one constant gain to −20 dBFS RMS (backed off
   if the peak would exceed −1 dBFS). No compression, no EQ, no noise
   reduction. The decoded files needed between −0.40 and +0.13 dB, so the
   codec had already preserved level well; the step exists so that an A/B
   comparison is about timbre and not about loudness.

Across the eight clips the hardware emitted 1110 frames — 9990 bytes — for
22.14 seconds of speech. At one 9-byte frame
per 20 ms that is exactly 3600 bit/s, which is the full D-STAR voice frame:
2400 bit/s of vocoder data plus 1200 bit/s of error correction.
<span class="cite">— JARL D-STAR system specification; DVSI product
documentation</span>

The raw channel bytes are in the repository next to the audio, as
`docs/assets/data/frames/<clip>.ambe`, together with the JSON that the
animations on this site draw. Their exact contents and provenance are
documented in `docs/assets/data/SCHEMA.md`.

## What to listen for, in general

Three things are worth attending to on every pair, and each one is visible in
the measurements as well as audible:

**The pitch survives almost exactly.** Tracking the fundamental through both
files, the decoded pitch follows the original to within a median of 0.72–1.55 %
across all eight clips, and a 90th percentile of 2.5–4.7 %.
A codec spending 3600 bit/s cannot afford to
be wrong about pitch, and this one is not.

**The envelope survives.** Cross-correlating the loudness envelopes of the two
files gives 0.962–0.985 at the matching offset on every clip.
Syllables land in the same places with the
same relative weight.

**The texture does not survive intact.** What changes is everything the
harmonic model has to approximate: the exact shape of noise, the fine detail
between harmonics, the attack of a consonant. The Multi-Band Excitation model
represents a frame as harmonics of one fundamental, with each frequency band
declared either voiced or unvoiced <span class="cite">— Griffin & Lim
1988</span>, and the places where that description is a poor fit are exactly the
places where the pair sounds different.

Note what is *not* on that list: overall band level. Summed as energy over the
energetic frames of a clip, the decoded audio comes back within about 2 dB of
the original in every 1 kHz band from 0 to 4 kHz, on all eight clips, and as
often above it as below. The codec is not
simply losing the top end. It is rebuilding it out of a different kind of
signal, and the measurement that shows this is periodicity rather than level —
which is the thread the clips below follow.

There is also a delay: the decoded audio arrives 31.6–35.3 ms — between one and
two frames — after the original. The players
below are independent, so you will not notice it, but it matters if you ever
line the two files up.

!!! note "How to check any number on this page"

    Every figure here is computed from the
    committed JSON in `docs/assets/data/` by `tools/listen-stats.py`. Run
    `python3 tools/listen-stats.py` and the same numbers come back. That
    script's docstring defines the two terms that would otherwise be vague — an
    **energetic frame** is one whose *original*-audio RMS is at least −40 dBFS
    (every clip is normalised to −20 dBFS RMS overall), and a band's level over
    a set of frames is an **energy sum** across bins and frames, not an average
    of per-frame dB values. The per-frame data those statistics reduce is
    documented in `docs/assets/data/SCHEMA.md`.

---

## Male voice — `en_US-norman-medium`

Median fundamental across these four clips: 104–123 Hz.

### a) "The quick brown fox jumps over the lazy dog."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/norman-a-original.wav"
           aria-label="Sentence a, male voice, quick brown fox — original"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/norman-a-ambe.wav"
           aria-label="Sentence a, male voice, quick brown fox — through the AMBE-3000"></audio>
  </div>
</div>

The stock pangram, here mostly as a baseline: 84 % of its energetic frames
carry a detectable fundamental, so the harmonic model is on home ground and the
two files track each other closely. Listen
instead to the joins — the *ck* in "quick", the *x* in "fox", the *j* in
"jumps". Those are the moments where the frame has to change its
voiced/unvoiced description abruptly, and where the reconstruction has the
least to work with.

### b) "CQ CQ CQ this is a test of the AMBE voice codec."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/norman-b-original.wav"
           aria-label="Sentence b, male voice, CQ test — original"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/norman-b-ambe.wav"
           aria-label="Sentence b, male voice, CQ test — through the AMBE-3000"></audio>
  </div>
</div>

The on-air case: a CQ call is the first thing anyone hears through this codec.
4.03 seconds of speech became 202 frames — 1818 bytes total.
This is the clip the animations elsewhere on
the site are built from, so if a waveform or spectrum figure looks familiar,
this is what it is showing. Listen to the hard *K* of each "CQ": the burst is
present but blunted, because a click is the least harmonic thing a voice does.

### c) "She sells sea shells by the sea shore."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/norman-c-original.wav"
           aria-label="Sentence c, male voice, she sells sea shells — original"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/norman-c-ambe.wav"
           aria-label="Sentence c, male voice, she sells sea shells — through the AMBE-3000"></audio>
  </div>
</div>

This one is a stress test, and it is the hardest clip on the page for the
model: only 66 % of its energetic frames carry a detectable fundamental, the
lowest figure of the eight. *sh* and *s* are
pure noise, and the model's answer is to declare those bands unvoiced and fill
them with noise rather than harmonics.

The interesting part is what that does and does not cost. Over the 31 energetic
frames of this clip with no detectable fundamental, the decoded audio comes
back within 1.5 dB of the original in every 1 kHz band — the *level* survives.
What does not is the structure inside it: a band-by-band periodicity
measurement of the decoded audio on those same frames averages 0.10 or below in
all eight bands from 0 to 4 kHz on a 0–1 scale, against 0.63 in the lowest band
on this clip's pitched frames. The sibilants
are not being attenuated; they are being *re-manufactured* from a noise source
at roughly the right level. Listen for the difference between "sells" and
"shells": the distinction is reconstructed rather than reproduced.

### d) "We were away a year ago."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/norman-d-original.wav"
           aria-label="Sentence d, male voice, we were away a year ago — original"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/norman-d-ambe.wav"
           aria-label="Sentence d, male voice, we were away a year ago — through the AMBE-3000"></audio>
  </div>
</div>

The opposite test: a sentence with no stops and no fricatives, where every one
of the 54 energetic frames — 100 % of them — carries a detectable fundamental.
This is the harmonic model at its best — a
single fundamental with a smoothly moving set of harmonics is exactly what the
codec is built to carry — and it is the pair on this page where original and
decoded sit closest together.

---

## Female voice — `en_US-ljspeech-high`

Median fundamental across these four clips: 174–213 Hz — around 70 Hz above the
male voice. That matters to a harmonic codec:
at 113 Hz there are thirty-five harmonics below 4 kHz to describe, at 190 Hz
there are twenty-one. The same bits are spread across fewer, more widely
spaced components. <span class="cite">— Griffin & Lim 1988</span>

### a) "The quick brown fox jumps over the lazy dog."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/lj-a-original.wav"
           aria-label="Sentence a, female voice, quick brown fox — original"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/lj-a-ambe.wav"
           aria-label="Sentence a, female voice, quick brown fox — through the AMBE-3000"></audio>
  </div>
</div>

The same sentence as the male pangram above, which makes the two directly
comparable: play `norman-a` and this one back to back and the codec's
character — what it keeps, what it smooths — shows up as the thing they have in
common, rather than as a property of one voice.

### b) "CQ CQ CQ this is a test of the AMBE voice codec."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/lj-b-original.wav"
           aria-label="Sentence b, female voice, CQ test — original"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/lj-b-ambe.wav"
           aria-label="Sentence b, female voice, CQ test — through the AMBE-3000"></audio>
  </div>
</div>

4.02 seconds, 201 frames, 1809 bytes. Summed
over this clip's energetic frames, the decoded spectrum sits within 1.2 dB of
the original in the three lowest 1 kHz bands and 2.1 dB *above* it in the
3–4 kHz band. The round trip is close to
level-neutral across the whole band; what it does not preserve is what that
energy is made of. Listen to the word "codec" itself, where a hard *k* is
followed immediately by a voiced vowel.

### c) "She sells sea shells by the sea shore."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/lj-c-original.wav"
           aria-label="Sentence c, female voice, she sells sea shells — original"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/lj-c-ambe.wav"
           aria-label="Sentence c, female voice, she sells sea shells — through the AMBE-3000"></audio>
  </div>
</div>

The clearest demonstration on the page of the voiced/unvoiced split. On this
clip's sibilant frames — the energetic ones with no detectable fundamental — a
band-by-band periodicity measurement of the decoded audio averages 0.13 or
lower in all eight bands from 0 to 4 kHz on a 0–1 scale. The output there is
noise, with next to no periodic structure. The same measurement averages 0.85
in the lowest band across this clip's pitched frames.
That is the same story as the male "shells"
clip, in a voice whose sibilants are stronger to begin with.

### d) "We were away a year ago."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/lj-d-original.wav"
           aria-label="Sentence d, female voice, we were away a year ago — original"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/lj-d-ambe.wav"
           aria-label="Sentence d, female voice, we were away a year ago — through the AMBE-3000"></audio>
  </div>
</div>

94 % of this clip's energetic frames carry a detectable fundamental — only four
do not. At 1.58 seconds it cost 720 bytes.
Take the sentence as the answer to "what does 3600 bit/s actually buy you",
because on material this cooperative the answer is: very nearly everything
except the timbre.

---

## Provenance summary

| Item | Source |
| --- | --- |
| Source speech, male | Piper TTS `en_US-norman-medium`. Training corpus: LibriVox recordings, <https://librivox.org> — **public domain**. Trained from scratch, not fine-tuned from another voice, per the voice's upstream model card. |
| Source speech, female | Piper TTS `en_US-ljspeech-high`. Training corpus: the LJ Speech Dataset, <https://keithito.com/LJ-Speech-Dataset/> — **public domain**. Trained from scratch, per the voice's upstream model card. |
| Encoder and decoder | DVSI AMBE-3000 chip in a NW Digital Radio ThumbDV, `PRODID` `AMBE3000F` |
| Firmware | `V121.E100.XXXX.C110.G514.R014.A0030608.C0020208` |
| Mode | D-STAR full rate, 72 bits per 20 ms frame |
| Numbers marked | computed from the committed JSON in `docs/assets/data/` by `tools/listen-stats.py`; its docstring states every threshold and averaging rule, and `docs/assets/data/SCHEMA.md` documents the per-frame data it reduces |

Both voices were chosen for their licence as much as for their sound. A Piper
voice inherits the terms of the corpus it was trained on, and several of the
popular English voices are trained on datasets carrying a non-commercial or
share-alike condition that cannot be redistributed under this site's CC BY 4.0
grant. The two used here are trained from scratch on public-domain speech, so
the WAV files on this page carry no upstream restriction. `tools/make-audio.sh`
records that requirement at the top of the file, so that a future substitution
does not quietly reintroduce the problem.
{: .source-note }

Nothing on this page was produced by, or compared against, a software AMBE
implementation. This project is independent of Digital Voice Systems, Inc.;
AMBE is a DVSI trademark, used here only to name the technology under
discussion.
{: .source-note }

<style>
/* Original / decoded A/B pairs. Colours come from the site tokens only —
   see docs/stylesheets/extra.css section 1. */
.md-typeset .ab-pair {
  display: grid;
  gap: var(--ambe-space-4);
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  margin: 1.4em 0;
  max-width: var(--ambe-measure-wide);
}

.md-typeset .ab-side {
  background-color: var(--ambe-surface-1);
  border: 1px solid var(--ambe-hairline);
  border-radius: var(--ambe-radius-lg);
  padding: var(--ambe-space-4);
}

.md-typeset .ab-side--codec {
  border-color: var(--ambe-border);
}

.md-typeset .ab-label {
  color: var(--ambe-text-3);
  display: block;
  font-size: 0.7em;
  font-weight: 650;
  letter-spacing: 0.08em;
  margin-bottom: var(--ambe-space-3);
  text-transform: uppercase;
}

.md-typeset .ab-side--codec .ab-label {
  color: var(--ambe-accent-warm);
}

.md-typeset .ab-side audio {
  display: block;
  max-width: 100%;
  width: 100%;
}
</style>

---

**Next: [The patent landscape](08-patents.md).** Which patents cover what,
which two are still in force, and what that constrains for someone building
an open implementation.
Previously: [What is not in the public record](06-what-isnt-published.md).
{: .chapter-nav }
