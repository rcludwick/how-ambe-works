# Sources and method

<!-- Owner: sources-agent -->

This is the page that makes the rest of the site checkable. It states
exactly where the technical content came from, exactly what was excluded
and why, and gives a link to every source so you can go and disagree with
us.
{: .lede }

## Method

The technical material here comes from four kinds of source:

1. **US patents.** Ten of them, all assigned to Digital Voice Systems,
   Inc., granted between 1992 and 1999. A patent must enable the
   invention it claims, which makes it an unusually complete public
   teaching document. These are the backbone of the site.
2. **Published academic literature.** The Griffin and Lim 1988 paper that
   introduced the Multi-Band Excitation model, and the Hardwick and Lim
   1988 paper that turned it into a 4.8 kbps coder. Both are in the
   normal scholarly record.
3. **Public system specifications.** Principally the JARL D-STAR system
   specification, which defines the over-the-air frame structure, plus
   publicly available DVSI product documentation for device-level
   behaviour.
4. **Our own measurements of commercial hardware.** A DVSI AMBE-3000
   device operated as a black box: audio and frames in one side, recorded
   output from the other.

Claims name their source inline, in the form
<span class="cite">US 5,701,390</span> or
<span class="cite">Griffin &amp; Lim 1988</span>, so you can go and read
the original. Inferences and engineering judgement are marked as such.

### How the hardware measurements were made

The one class of source here that isn't a document is our own bench work,
so it deserves its own method statement.

The device is a ThumbDV-class USB vocoder stick containing a DVSI
AMBE-3000 chip, bought at retail. It is driven over its documented serial
protocol, using the packet format described in DVSI's own publicly
available product documentation. Audio or encoded frames go in; encoded
frames or audio come out; both sides are recorded.

That is black-box characterisation of a product's externally observable
behaviour — the same thing a reviewer does with a radio on a bench, and
the same thing any user of the device does every time they key up. No
firmware was extracted, no packages were opened, no debug interface was
probed, and no attempt was made to recover internal constants or tables.
Where a page reports a measurement, it says what was fed in and what came
out, so that anyone with the same $120 dongle can repeat it and contradict
us.

---

## Bibliography

Notes flag the links that need a browser rather than a command-line
fetch.

### US patents, the primary technical sources

All assigned to Digital Voice Systems, Inc. Expiry dates and legal-status
detail are on [The patent landscape](08-patents.md).

| Patent | Title | Used for |
| --- | --- | --- |
| [US 5,081,681](https://patents.google.com/patent/US5081681A/en) | Method and apparatus for phase synthesis for speech processing | Coherent-plus-jittered phase synthesis |
| [US 5,216,747](https://patents.google.com/patent/US5216747A/en) | Voiced/unvoiced estimation of an acoustic signal | Pitch tracking, energy-adaptive voicing thresholds |
| [US 5,247,579](https://patents.google.com/patent/US5247579A/en) | Methods for speech transmission | Adaptive spectral enhancement, frame repeat, error-rate smoothing |
| [US 5,630,011](https://patents.google.com/patent/US5630011A/en) | Quantization of harmonic amplitudes representing speech | Predictive residual-DCT amplitude quantization |
| [US 5,649,050](https://patents.google.com/patent/US5649050A/en) | Maintaining data rate integrity despite mismatch of readiness between components | Buffering and rate adaptation around a vocoder |
| [US 5,701,390](https://patents.google.com/patent/US5701390A/en) | Synthesis of MBE-based coded speech using regenerated phase information | Regenerated-phase synthesis, frame-boundary rules |
| [US 5,715,365](https://patents.google.com/patent/US5715365A/en) | Estimation of excitation parameters | Nonlinear pre-processing for pitch and voicing |
| [US 5,754,974](https://patents.google.com/patent/US5754974A/en) | Spectral magnitude representation for multi-band excitation speech coders | Voicing-independent magnitudes, unvoiced synthesis, analysis window |
| [US 5,826,222](https://patents.google.com/patent/US5826222A/en) | Estimation of excitation parameters (continuation) | Hybrid pitch estimator, voicing smoothing |
| [US 5,870,405](https://patents.google.com/patent/US5870405A/en) | Digital transmission of acoustic signals over a noisy communication channel | FEC, bit prioritization, scrambling, frame repeat and mute |

Later DVSI patents referenced for landscape purposes only, none of them
a source of technical content here:
[US 6,161,089](https://patents.google.com/patent/US6161089A/en) ·
[US 6,199,037](https://patents.google.com/patent/US6199037B1/en) ·
[US 6,912,495](https://patents.google.com/patent/US6912495B2/en) ·
[US 7,634,399](https://patents.google.com/patent/US7634399B2/en) ·
[US 7,957,963](https://patents.google.com/patent/US7957963B2/en) ·
[US 7,970,606](https://patents.google.com/patent/US7970606B2/en) ·
[US 8,036,886](https://patents.google.com/patent/US8036886B2/en) ·
[US 8,200,497](https://patents.google.com/patent/US8200497B2/en) ·
[US 8,315,860](https://patents.google.com/patent/US8315860B2/en) ·
[US 8,359,197](https://patents.google.com/patent/US8359197B2/en) ·
[US 8,595,002](https://patents.google.com/patent/US8595002B2/en).

!!! tip "Reading the numbers in a patent"

    Google Patents renders many of these patents' equations and tables as
    image placeholders, and its OCR of numeric tables is lossy. Where this
    site quotes a constant, a kernel, or a table, it was read from the
    USPTO page images of the patent rather than from the OCR text. If you
    are checking our arithmetic, do the same.

### Papers

**D. W. Griffin and J. S. Lim, "Multiband Excitation Vocoder,"** *IEEE
Transactions on Acoustics, Speech, and Signal Processing*, vol. 36, no. 8,
pp. 1223–1235, August 1988.
[doi:10.1109/29.1651](https://doi.org/10.1109/29.1651)
· [scanned PDF, qsl.net](https://www.qsl.net/kb9mwr/projects/dv/codec/Multiband%20Excitation%20Vocoder.pdf)

: The paper that defines the model: speech as a spectral envelope times an
  excitation spectrum, with an independent voiced/unvoiced decision per
  frequency band. Source for the model itself, the analysis-by-synthesis
  error criterion, and the shape of both synthesizers. The DOI link goes
  to IEEE Xplore, which returns a bot challenge to command-line clients
  but opens normally in a browser; the qsl.net scan is a full copy of the
  same paper.

**J. C. Hardwick and J. S. Lim, "A 4.8 kbps multi-band excitation speech
coder,"** *ICASSP-88*, pp. 374–377, 1988.
[doi:10.1109/ICASSP.1988.196595](https://doi.org/10.1109/icassp.1988.196595)
· [full text, archive.org](https://archive.org/details/A4.8KbpsMulti-bandExcitationSpeechCoder)
· [MIT thesis of the same title, DSpace@MIT](https://dspace.mit.edu/entities/publication/44320278-b810-429b-8956-4b4848df37f9)

: The step from model to codec — quantization and bit allocation for a
  real 4.8 kbps system. Hardwick is the named inventor on most of the
  DVSI patents above, and this is the direct ancestor of IMBE. Same IEEE
  bot-challenge caveat on the DOI link.

**D. W. Griffin and J. S. Lim, "Multi-Band Excitation Vocoder,"** Rome Air
Development Center technical report, DTIC
[ADA181146](https://apps.dtic.mil/sti/tr/pdf/ADA181146.pdf).

: The MBE work was funded in part by the US Air Force (RADC, Griffiss AFB,
  contract F19628-85-K-0028), which makes the contract deliverables public
  technical reports rather than proprietary documents. Contains DRT
  intelligibility scores for clean and noisy speech.

### Specifications

**JARL D-STAR system specification.**
<https://www.jarl.com/d-star/shogen.pdf>

: The Japan Amateur Radio League's published specification for D-STAR.
  Source for everything on this site about the over-the-air layer: the
  4800 bps GMSK channel, the 20 ms frame, and the split of that frame into
  voice and data. The URL serves an English-language PDF.

**TIA-102.BABA-1, "APCO Project 25 Half-Rate Vocoder Addendum."** In the
[TIA-102 series document collection on archive.org](https://archive.org/details/TIA-102_Series_Documents).

: A public specification of the 3600 bps half-rate vocoder, and the
  document the amateur community generally equates with AMBE+2 half-rate.
  Freely readable, and a legitimate source for anyone working on that
  codec. This site draws little from it for the simple reason that its
  subject is full-rate AMBE as used by D-STAR. See
  [The patent landscape](08-patents.md) for the half-rate patent
  position.

### Vendor documentation

Digital Voice Systems, Inc. publishes product-level documentation for its
vocoder chips and software. It is used here only for device-level and
protocol-level facts — packet formats, rate options, product capability
claims — never for codec internals.

- [AMBE-3000 vocoder chip product page](https://www.dvsinc.com/products/a300x.shtml)
- [Product documentation index](https://www.dvsinc.com/products/docs.shtml)
- [AMBE+2 product page](https://www.dvsinc.com/soft_products/ambe_p2.shtml)
- [Technical papers index](https://www.dvsinc.com/papers/tech_papers.shtml)

!!! note

    dvsinc.com returns HTTP 403 to command-line clients that do not send a
    browser user-agent. All four links above resolve normally in a
    browser; they were verified with a browser user-agent on 2026-08-10.

### Hardware

**DVSI AMBE-3000 vocoder chip**, in a ThumbDV-class USB dongle from NW
Digital Radio, purchased at retail. See the chip's
[product page](https://www.dvsinc.com/products/a300x.shtml) for its
published capabilities. Used as described under
*How the hardware measurements were made* above. NW Digital Radio's
product URL has moved since the device was bought, so no link is given
for the dongle itself.

### Background and context

These informed the site's framing and its sense of what readers already
believe. **None of them is a technical source**; where any of them
disagrees with a patent or a specification, the primary document governs.

- [Multi-Band Excitation — Wikipedia](https://en.wikipedia.org/wiki/Multi-Band_Excitation)
  — the IMBE/AMBE family tree, useful for orientation.
- [Improving Open-AMBE for D-Star (KB9MWR)](https://www.qsl.net/kb9mwr/projects/dv/codec/ambe.html)
  — community notes on the long history of open AMBE efforts.
- [Bruce Perens K6BP, "AMBE Exposed," ARRL/TAPR DCC 2014](https://www.qsl.net/kb9mwr/projects/dv/codec/AMBE_Exposed.pdf)
  — the talk through which most amateurs first encounter this subject, and
  the origin of the invalidity theory recorded and set aside on
  [The patent landscape](08-patents.md). Background and provenance only;
  its patent analysis is superseded there by the USPTO record.

### Verification tools

- [Google Patents](https://patents.google.com/) — full text, claims and
  legal-status timelines. Convenient; its computed dates and its OCR of
  equations both need checking.
- [USPTO Patent Center](https://patentcenter.uspto.gov/) — the
  authoritative file wrapper: term adjustment, maintenance fees, terminal
  disclaimers. Governs where the two disagree.

---

## Corrections

The value of this page is that it can be checked, so being wrong in
public is the intended failure mode.

If a citation does not support the claim it is attached to, if a date has
moved, if a link has rotted, or if something here is simply incorrect,
please [open an issue](https://github.com/rcludwick/how-ambe-works/issues)
with the specific page and the primary source that contradicts us.
Corrections against a primary document will be made and noted.

One request in the other direction: please do not send patches containing
codec implementation code, or excerpts from any of the implementations
listed as not consulted above. They cannot be accepted, and their arrival
would compromise the provenance of the whole site.

## Licensing

The prose, diagrams and page content are licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The tooling —
build scripts, stylesheets, animation runtime, CI workflows — is MIT.
Reuse the writing with attribution; reuse the tooling under MIT.

AMBE, AMBE+, and AMBE+2 are trademarks of Digital Voice Systems, Inc.,
used here only to identify the technology under discussion. This project
is independent of DVSI and is not affiliated with, sponsored by, endorsed
by, or approved by them.

---

That is the end of the site. Back to [the start](index.md), or to
[what AMBE actually is](01-the-mbe-model.md) if you arrived here first and
want the argument in order.
Previously: [The patent landscape](08-patents.md).
{: .chapter-nav }
