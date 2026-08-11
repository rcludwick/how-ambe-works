# Listen: real hardware examples

<!-- Owner: audio-agent -->

Eight sentences, two voices, each one played twice: once as it went in, once as
it came back from a real AMBE codec chip.
{: .lede }

Every "through the AMBE-3000" file on this page was produced by a **DVSI
AMBE-3000 vocoder chip** — the silicon inside a NW Digital Radio ThumbDV —
encoding the audio to 72-bit D-STAR frames and then decoding those frames back
to sound. **No software implementation of AMBE was involved, here or anywhere
else in this project.** The chip did the work; this site only measured it.
{: .source-note }

## How these were made

The chain is deliberately short and each stage is a file you can inspect:

1. **Synthesis.** Piper text-to-speech, one male voice (`en_US-ryan-high`) and
   one female voice (`en_US-hfc_female-medium`), the same four sentences in
   both. Synthetic speech, so the material is identical between voices and free
   of room, mic and licensing questions.
2. **Format.** Resampled to 8 kHz, 16-bit, mono — AMBE's native rate.
3. **Encode.** Pushed frame by frame into the ThumbDV, 160 samples in, 9 bytes
   out, per 20 ms. `[measured]`{: .badge .measured }
4. **Decode.** Those same 9-byte frames pushed back into the same chip, 9 bytes
   in, 160 samples out.
5. **Level.** Each file scaled by one constant gain to −20 dBFS RMS (backed off
   if the peak would exceed −1 dBFS). No compression, no EQ, no noise
   reduction. The decoded files needed between −0.72 and +0.27 dB, so the
   codec had already preserved level well; the step exists so that an A/B
   comparison is about timbre and not about loudness.

Across the eight clips the hardware emitted 9009 bytes for 19.94 seconds of
speech — 9 bytes every 20 ms, which is 3600 bit/s.
`[measured]`{: .badge .measured } That figure is the full D-STAR voice frame:
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
files, the decoded pitch follows the original to within a median of 0.7–1.1 %
across all eight clips. `[measured]`{: .badge .measured } A codec spending
3600 bit/s cannot afford to be wrong about pitch, and this one is not.

**The envelope survives.** Cross-correlating the loudness envelopes of the two
files gives 0.972–0.986 at the matching offset on every clip.
`[measured]`{: .badge .measured } Syllables land in the same places with the
same relative weight.

**The texture does not survive intact.** What changes is everything the
harmonic model has to approximate: the exact shape of noise, the fine detail
between harmonics, the attack of a consonant. The Multi-Band Excitation model
represents a frame as harmonics of one fundamental, with each frequency band
declared either voiced or unvoiced <span class="cite">— Griffin & Lim
1988</span>, and the places where that description is a poor fit are exactly the
places where the pair sounds different.

There is also a delay: the decoded audio arrives 32–34 ms — between one and two
frames — after the original. `[measured]`{: .badge .measured } The players
below are independent, so you will not notice it, but it matters if you ever
line the two files up.

---

## Male voice — `en_US-ryan-high`

Median fundamental across these four clips: 124–202 Hz.
`[measured]`{: .badge .measured }

### a) "The quick brown fox jumps over the lazy dog."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/ryan-a-original.wav"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/ryan-a-ambe.wav"></audio>
  </div>
</div>

The stock pangram, here mostly as a baseline: 97 % of its energetic frames
carry a detectable fundamental, so the harmonic model is on home ground and the
two files track each other closely. Listen instead to the joins — the *ck* in "quick",
the *x* in "fox", the *j* in "jumps". Those are the moments where the frame has
to change its voiced/unvoiced description abruptly, and where the reconstruction
has the least to work with.

### b) "CQ CQ CQ this is a test of the AMBE voice codec."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/ryan-b-original.wav"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/ryan-b-ambe.wav"></audio>
  </div>
</div>

The on-air case: a CQ call is the first thing anyone hears through this codec.
3.35 seconds of speech became 168 frames — 1512 bytes total.
`[measured]`{: .badge .measured } This is the clip the animations elsewhere on
the site are built from, so if a waveform or spectrum figure looks familiar,
this is what it is showing. Listen to the hard *K* of each "CQ": the burst is
present but blunted, because a click is the least harmonic thing a voice does.

### c) "She sells sea shells by the sea shore."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/ryan-c-original.wav"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/ryan-c-ambe.wav"></audio>
  </div>
</div>

This one is a stress test. *sh* and *s* are pure noise with no fundamental at
all, and the model's answer is to declare those bands unvoiced and fill them
with noise rather than harmonics. On the frames of this clip with no detectable
fundamental, the 3–4 kHz region comes back 6.1 dB quieter than it went in.
`[measured]`{: .badge .measured } Listen for the difference between "sells" and
"shells": the *s*/*sh* distinction lives almost entirely in that band, and it is
being reconstructed rather than reproduced.

### d) "We were away a year ago."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/ryan-d-original.wav"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/ryan-d-ambe.wav"></audio>
  </div>
</div>

The opposite test: a sentence with no stops and no fricatives, where 95 % of the
energetic frames carry a detectable fundamental. `[measured]`{: .badge .measured } This is
the harmonic model at its best — a single fundamental with a smoothly moving
set of harmonics is exactly what the codec is built to carry — and it is the
pair on this page where original and decoded sit closest together.

---

## Female voice — `en_US-hfc_female-medium`

Median fundamental across these four clips: 222–230 Hz — around 70 Hz above the
male voice. `[measured]`{: .badge .measured } That matters to a harmonic codec:
at 155 Hz there are two dozen or so harmonics below 4 kHz to describe, at 230 Hz
there are around seventeen. The same bits are spread across fewer, more widely
spaced components. <span class="cite">— Griffin & Lim 1988</span>

### a) "The quick brown fox jumps over the lazy dog."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/hfc-a-original.wav"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/hfc-a-ambe.wav"></audio>
  </div>
</div>

The same sentence as the male pangram above, which makes the two directly
comparable: play `ryan-a` and this one back to back and the codec's character —
what it keeps, what it smooths — shows up as the thing they have in common,
rather than as a property of one voice.

### b) "CQ CQ CQ this is a test of the AMBE voice codec."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/hfc-b-original.wav"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/hfc-b-ambe.wav"></audio>
  </div>
</div>

3.49 seconds, 175 frames, 1575 bytes. `[measured]`{: .badge .measured }
Across the whole clip the decoded spectrum sits between 3.0 and 5.4 dB below
the original in every 1 kHz band — a small, broadly even loss rather than a
hole in one place.
`[measured]`{: .badge .measured } Listen to the word "codec" itself, where a
hard *k* is followed immediately by a voiced vowel.

### c) "She sells sea shells by the sea shore."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/hfc-c-original.wav"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/hfc-c-ambe.wav"></audio>
  </div>
</div>

The clearest demonstration on the page of the voiced/unvoiced split. On this
clip's sibilant frames, a band-by-band periodicity measurement of the decoded
audio averages 0.11 or lower in all eight bands from 0 to 4 kHz on a 0–1 scale —
the output there is noise, with next to no periodic structure — while the same
measurement averages 0.82 in the lowest band across the clip's voiced frames.
`[measured]`{: .badge .measured } The codec is not attenuating the sibilants so
much as *re-manufacturing* them from a noise source, which is why they can sound
plausible and yet not quite like the original *sh*.

### d) "We were away a year ago."

<div class="ab-pair">
  <div class="ab-side">
    <span class="ab-label">Original</span>
    <audio controls preload="none" src="assets/audio/hfc-d-original.wav"></audio>
  </div>
  <div class="ab-side ab-side--codec">
    <span class="ab-label">Through the AMBE-3000</span>
    <audio controls preload="none" src="assets/audio/hfc-d-ambe.wav"></audio>
  </div>
</div>

Every energetic frame of this clip — 100 % of them — carries a detectable
fundamental.
`[measured]`{: .badge .measured } At 1.40 seconds it cost 630 bytes. Take the
sentence as the answer to "what does 3600 bit/s actually buy you", because on
material this cooperative the answer is: very nearly everything except the
timbre.

---

## Provenance summary

| Item | Source |
| --- | --- |
| Source speech | Piper TTS, voices `en_US-ryan-high` and `en_US-hfc_female-medium` |
| Encoder and decoder | DVSI AMBE-3000 chip in a NW Digital Radio ThumbDV, `PRODID` `AMBE3000F` |
| Firmware | `V121.E100.XXXX.C110.G514.R014.A0030608.C0020208` |
| Mode | D-STAR full rate, 72 bits per 20 ms frame |
| Numbers marked `[measured]`{: .badge .measured } | computed from these exact files by `tools/make-data.py`; method in `docs/assets/data/SCHEMA.md` |

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
