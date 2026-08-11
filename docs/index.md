# How AMBE Works

A D-STAR radio takes a fifth of a second of your voice, throws the waveform
away, and transmits nine bytes. This site is about what is in those nine
bytes, how they get chosen, and how a decoder that has never heard you turns
them back into a person talking.
{: .lede }

Every claim here names its source in the sentence that makes it. The sources
are US patents, the published Multi-Band Excitation literature, the
JARL D-STAR system specification, public DVSI product documentation, and
measurements this project made against a vocoder chip bought at retail.
Nothing comes from anybody's codec source code.

## Start with the picture

The whole codec follows from one observation: a voiced sound is a stack of
harmonics of a single fundamental, and how many of those harmonics fit inside
the coded band depends on how deep the voice is. Drag the slider. Watch the
count in the readout fall from sixty-odd to nine.

<div data-anim="harmonics"></div>

That count is the number of amplitudes the coder has to describe, and the bit
budget does not grow to meet it. Almost every design decision in AMBE is a
consequence of that one squeeze. [What AMBE actually is](01-the-mbe-model.md)
picks the argument up from there.

## What this site is

An explanation, written for someone who wants to know what is actually
happening inside a digital voice link rather than to be reassured that it
works.

It assumes you are comfortable with a spectrum plot and the idea of a Fourier
transform. It does not assume you have read a speech coding textbook. Where a
patent states something in its own words, the patent is quoted and cited, so
you can go and disagree with the reading.

Three kinds of thing appear on these pages, and they are labelled so you can
tell them apart:

- **Public teaching.** The model, the analysis, the quantization structure and
  the synthesis rules, taken from the patents and from the 1988
  papers. Cited by number.
- **Specification.** The over-the-air format, taken from the JARL D-STAR
  system specification. Cited by section.
- **Measurement.** Waveforms, spectra, pitch tracks, band voicing and captured
  channel frames from a DVSI AMBE-3000 operated as a black box, including the
  data behind the figures.

## What this site is not

**There is no working AMBE encoder or decoder in this repository, in any
language.** That is a constraint the project holds itself to, not an accident
of scope.

Code in these pages is pseudocode, printed as plain text, with the constants,
window definitions and band-edge arithmetic deliberately absent. It will not
run. There are no quantizer codebooks and no bit-packing routines. The
interactive figures draw precomputed JSON captured from hardware; they perform
no pitch estimation, no voicing decision, no quantization and no synthesis.

The subject here is full-rate AMBE and IMBE, the codec D-STAR uses. AMBE+2
and the half-rate codec are covered at the level of history and patent status
rather than mechanism, because they are a different codec. See
[the patent landscape](08-patents.md).

This project is independent of Digital Voice Systems, Inc. AMBE, AMBE+ and
AMBE+2 are trademarks of DVSI, used here only to identify the technology under
discussion. Nothing on this site is affiliated with, sponsored by, endorsed by
or approved by them, and nothing on the patent page is legal advice.
{: .source-note }

## The reading path

The nine chapters are written to be read in order. Each one ends by handing
the next one a problem it has to solve.

1. **[What AMBE actually is](01-the-mbe-model.md)** sets up the bit budget,
   shows why a single voiced/unvoiced decision per frame produces buzz, and
   introduces the multi-band model that fixes it. Start here.
2. **[Analysis: pitch, voicing, amplitudes](02-analysis.md)** is how a
   20 ms window becomes one pitch, eight flags and a list of amplitudes.
   Analysis by synthesis, and why pitch is a search rather than a
   measurement.
3. **[Turning measurements into bits](03-quantization.md)** spends the
   budget: log-domain amplitudes, prediction from the previous frame,
   codebooks, and a bit allocation that has to change with the pitch.
4. **[The D-STAR frame on the air](04-the-dstar-frame.md)** wraps the result
   in error correction and clocks it onto a carrier. Unequal protection, a
   descrambling key chained to the most important field, and the data channel
   riding alongside your voice.
5. **[Synthesis: rebuilding the voice](05-synthesis.md)** is the far end:
   an oscillator bank, shaped noise, and the phase that was never transmitted
   and has to be invented fifty times a second.
6. **[What is not in the public record](06-what-isnt-published.md)** draws
   the boundary. What the documents give you, what a black box on a bench can
   settle, and the five questions that are still open.
7. **[Listen: real hardware examples](07-listen.md)** is eight sentences in
   two voices, before and after a real AMBE-3000, with something specific to
   listen for in each pair.
8. **[The patent landscape](08-patents.md)** is the dates: which patents
   taught what, which expired when, and which two are still live.
9. **[Sources and method](09-sources.md)** lists every source, states what
   was deliberately excluded and why, and tells you how to check any of it.

In a hurry? Read chapter 1, then [listen](07-listen.md) to a clip pair, then
come back for the rest. If you arrived for the legal question, chapters
[8](08-patents.md) and [9](09-sources.md) stand on their own.

## Corrections

A page that is wrong and cited is more useful than a page that is vague and
safe, because the citation is what lets someone catch the error. If a claim
here is not supported by the source attached to it, please
[open an issue](https://github.com/rcludwick/how-ambe-works/issues) naming the
page and the primary document that contradicts it.

Prose and figures are licensed CC BY 4.0; the tooling is MIT. Reuse either,
with attribution.

Last reviewed 2026-08-10.
{: .source-note }
