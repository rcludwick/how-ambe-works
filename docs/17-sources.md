# Sources and method

<!-- Owner: sources-agent -->

Every technical claim on this site traces to a source listed here, with
a link, so you can read the original and disagree with it. The hardware
measurements have their own method statement below.
{: .lede }

## Method

The technical material here comes from four kinds of source:

1. **US patents.** Ten of them, all assigned to Digital Voice Systems,
   Inc. The USPTO granted them between 1992 and 1999. A patent must enable the
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
4. **Original measurements of commercial hardware.** A DVSI AMBE-3000
   device operated as a black box. Audio and frames go in one side, and
   recorded output comes out the other.

Claims name their source inline, in the form
<span class="cite">US 5,701,390</span> or
<span class="cite">Griffin &amp; Lim 1988</span>, so you can go and read
the original. The text says so wherever a point is an inference or an
engineering judgement.

### How the hardware measurements were made

The device is a ThumbDV-class USB vocoder stick containing a DVSI
AMBE-3000 chip, bought at retail. It is driven over its documented serial
protocol, using the packet format described in DVSI's own publicly
available product documentation. Audio or encoded frames go in, and encoded
frames or audio come out. The capture records both sides.

---

## Bibliography

Notes flag the links that need a browser rather than a command-line
fetch.

### US patents

All assigned to Digital Voice Systems, Inc. Expiry dates and legal-status
detail are on [The patent landscape](16-patents.md).

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

: The step from model to codec: quantization and bit allocation for a
  real 4.8 kbps system. Hardwick is the named inventor on most of the
  DVSI patents above, and this is the direct ancestor of IMBE. Same IEEE
  bot-challenge caveat on the DOI link.

**D. W. Griffin and J. S. Lim, "Multi-Band Excitation Vocoder,"** Rome Air
Development Center technical report, DTIC
[ADA181146](https://apps.dtic.mil/sti/tr/pdf/ADA181146.pdf).

: The US Air Force funded the MBE work in part (RADC, Griffiss AFB,
  contract F19628-85-K-0028). That funding makes the contract deliverables
  public technical reports rather than proprietary documents. Contains DRT
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
  codec. This site draws little from it because its subject is full-rate
  AMBE as used by D-STAR. See
  [The patent landscape](16-patents.md) for the half-rate patent
  position.

### Vendor documentation

Digital Voice Systems, Inc. publishes product-level documentation for its
vocoder chips and software. This site uses it only for device-level and
protocol-level facts: packet formats, rate options, product capability
claims.

- [AMBE-3000 vocoder chip product page](https://www.dvsinc.com/products/a300x.shtml)
- [Product documentation index](https://www.dvsinc.com/products/docs.shtml)
- [AMBE+2 product page](https://www.dvsinc.com/soft_products/ambe_p2.shtml)
- [Technical papers index](https://www.dvsinc.com/papers/tech_papers.shtml)

### Textbooks

**P. Ladefoged and K. Johnson, *A Course in Phonetics*,** 7th ed., Cengage
Learning, 2015.

: Source for the glossary's speech-sound terms vowel and consonant. It is
  also the source for the terms fricative, sibilant and plosive.

**L. R. Rabiner and R. W. Schafer, *Digital Processing of Speech
Signals*,** Prentice-Hall, 1978.

: Source for how the vocal folds and vocal tract make speech (ch. 3,
  "Digital Models for the Speech Signal"), the sampling limit and the
  spectrogram.

### Background and context

These informed the site's framing and its sense of what readers already
believe. **None of them is a technical source**; where any of them
disagrees with a patent or a specification, the primary document governs.

- [Multi-Band Excitation on Wikipedia](https://en.wikipedia.org/wiki/Multi-Band_Excitation).
  The IMBE/AMBE family tree, useful for orientation.
- [Improving Open-AMBE for D-Star (KB9MWR)](https://www.qsl.net/kb9mwr/projects/dv/codec/ambe.html).
  Community notes on the long history of open AMBE efforts.
- [Bruce Perens K6BP, "AMBE Exposed," ARRL/TAPR DCC 2014](https://www.qsl.net/kb9mwr/projects/dv/codec/AMBE_Exposed.pdf).
  A talk through which many amateurs first encounter this subject.
  Background and provenance only. The USPTO record supersedes its patent analysis.

### Verification tools

- [Google Patents](https://patents.google.com/): full text, claims and
  legal-status timelines. Convenient; its computed dates and its OCR of
  equations both need checking.
- [USPTO Patent Center](https://patentcenter.uspto.gov/): the
  authoritative file wrapper, covering term adjustment, maintenance fees
  and terminal disclaimers. Governs where the two disagree.

---

## Licensing

Rob Ludwick, AJ7HR, wrote this site. Its prose, diagrams and page content
carry the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) licence. The tooling is
MIT. That covers the build scripts and stylesheets, plus the animation
runtime and the CI workflows.
Reuse the writing with attribution. Reuse the tooling under MIT.

The 3D views use [three.js](https://threejs.org/) release 0.185.1, which is
MIT licensed. The site copies it unmodified into
`docs/javascripts/vendor/three/` with its license file.

The speech on [Listen](12-listen.md) was synthesised with Piper, not
recorded. The male clips use a voice trained on LibriTTS-R (OpenSLR 141),
which is CC BY 4.0 and requires the credit *speech synthesised with a Piper
voice trained on LibriTTS-R (OpenSLR 141), used under CC BY 4.0*. The
corpus is Koizumi et al., *LibriTTS-R: A Restored Multi-Speaker
Text-to-Speech Corpus*, 2023. The female clips use a voice trained on the
LJ Speech Dataset, which is public domain. The file
`docs/assets/audio/MANIFEST.md` records both voices and the model
checksums. It also records a fine-tuning lineage on the male voice that it
states rather than resolves.

AMBE, AMBE+, and AMBE+2 are trademarks of Digital Voice Systems, Inc.,
used here only to identify the technology under discussion. This project
is independent of DVSI and is not affiliated with, sponsored by, endorsed
by, or approved by them.

---

**[← The patent landscape](16-patents.md)** · **[Next: Glossary →](18-glossary.md)**
