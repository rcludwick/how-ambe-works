# The patent landscape

<!-- Owner: patents-agent -->

AMBE's reputation in amateur radio is inseparable from its patents. This
page tries to replace the folklore with the record: which patents cover
what, when each one expired or expires, which two are still in force
today, and what that actually constrains for someone building an open
implementation.
{: .lede }

!!! warning "This is engineering research, not legal advice"

    Nothing on this page is a legal opinion, a freedom-to-operate
    analysis, or a substitute for a patent attorney. It is a reading of
    the public record — bibliographic data, legal-status timelines, and
    claim text from Google Patents — assembled by engineers so that other
    engineers know where to look.

    Patent scope is decided by claim construction, not by titles or
    abstracts, and it is decided in court. Expiration dates shown by
    Google Patents are computed and can be wrong; maintenance-fee status
    can change at any renewal window. Verify anything you intend to rely
    on at [USPTO Patent Center](https://patentcenter.uspto.gov/), and if
    the answer matters commercially, get advice from someone qualified to
    give it.

    **All dates and statuses on this page were checked against
    patents.google.com on 2026-08-10.** They will drift. Re-check them.

## Still in force

Two patents are live today. Both are assigned to Digital Voice Systems,
Inc. If you are wondering how a patent filed in 2003 is still in force
in 2026, that is patent term adjustment, explained under
[how to read a US patent expiry](#how-to-read-a-us-patent-expiry) below.

### US 8,359,197 — "Half-rate vocoder" · expires 2028-05-20

[patents.google.com/patent/US8359197B2](https://patents.google.com/patent/US8359197B2/en)
· inventor John C. Hardwick · filed 2003-04-01 · granted 2013-01-22 ·
status shown: **"Active, expires 2028-05-20"**

This is the one people mean when they say the AMBE patents "run to 2028."

The application was filed on 1 April 2003, so a plain twenty-year term
would have ended on 1 April 2023. It did not issue until 22 January
2013 — nearly ten years in prosecution — and the expiry Google Patents
displays, 2028-05-20, sits about five years past the plain term. That gap
is patent term adjustment for USPTO delay. Confirm the exact adjustment
at Patent Center rather than taking either figure on trust.

What matters most is the breadth. **The independent claims cover both
encoding and decoding.** There are encoding claims — dividing speech into
frames, computing MBE model parameters, quantizing pitch, voicing and
gain, combining selected bits into a 12-bit parameter codeword, applying error
control codes — and there are separate decoding claims: extracting
FEC codewords from a received frame, error-control decoding them,
reconstructing pitch, voicing and gain, and synthesizing speech samples.
A decoder-only implementation is not outside this patent the way it would
be outside an analysis-only patent.

The claims describe a 3600 bps frame: 72 bits per 20 ms, of which 49 are
voice or tone bits (7 pitch, 5 voicing, 37 spectral magnitude) and 23 are
FEC, using one [24,12] extended Golay code and one [23,12] Golay code to
protect the 24 most error-sensitive bits and leaving the remaining 25
unprotected. The field widths are set out in
[the patent itself](https://patents.google.com/patent/US8359197B2/en).
Publishing that disclosure is what a patent trades for the exclusive
right, so reading it and describing it is the intended use.

That is structurally the half-rate frame used by DMR, dPMR, NXDN and
YSF's narrow mode. **The equivalence is community consensus, not a legal
finding.** DVSI has never publicly equated its "AMBE+2" branding to the
P25 half-rate specification, and no claim-by-claim mapping of the
deployed formats onto these claims has been published — certainly not
here.

### US 8,036,886 — "Estimation of pulsed speech model parameters" · expires 2029-10-02

[patents.google.com/patent/US8036886B2](https://patents.google.com/patent/US8036886B2/en)
· inventor Daniel W. Griffin · filed 2006-12-22 · granted 2011-10-11 ·
status shown: **"Active, expires 2029-10-02"**

This one runs longer but reaches far less far.

Claim 1 is a method of *analysis*: divide a digitized signal into
frequency bands by bandpass filtering, perform "an operation to emphasize
pulse positions on at least two frequency band signals to produce
modified frequency band signals," and determine pulsed parameters from
those. That is an encoder-side measurement technique for the pulsed
excitation class introduced by US 6,912,495. It says nothing about
reconstructing speech.

Two practical consequences. A **decoder** does not perform this analysis
and is unaffected by these claims. An **encoder** that needs to detect
pulsed frames either has to wait, or has to arrive at that decision by a
route the claims do not describe. The plain twenty-year term from the
2006 filing would have ended in December 2026; the 2029 date again
reflects term adjustment for examination delay.

## How to read a US patent expiry

Three rules cover everything below.

**Applications filed before 8 June 1995** get the *longer* of seventeen
years from grant or twenty years from filing. This is why several 1990s
DVSI patents ran well past their twenty-year filing anniversary — a
patent granted in 1998 could run to 2015 on the seventeen-year rule.

**Applications filed after that date** get twenty years from the earliest
US non-provisional priority date. A continuation inherits its parent's
priority date, so continuations expire *with* the family, not twenty
years after their own filing. That is why several of the 2011–2013 grants
below were already close to death when they issued.

**Patent Term Adjustment (PTA)** extends the term when the USPTO itself
caused the delay. This is the mechanism that matters most here: it is why
one patent filed in 2003 is still in force in 2026.

Two other things end a patent early. **Maintenance fees** are due at
3½, 7½ and 11½ years; miss one and the patent lapses — Google Patents
shows this as *Expired - Fee Related*. A **terminal disclaimer** filed to
overcome a double-patenting rejection caps a patent's term at its
relative's. None of the core patents below carries one.

## The expired core: full-rate MBE and AMBE

These are the patents that teach the codec described on the rest of this
site. All of them are assigned to Digital Voice Systems, Inc. All of them
have expired at the end of their natural term — not for unpaid fees.

| Patent | Title | Filed | Granted | Expired | Status shown |
| --- | --- | --- | --- | --- | --- |
| [US 5,081,681](https://patents.google.com/patent/US5081681A/en) | Method and apparatus for phase synthesis for speech processing | 1989-11-30 | 1992-01-14 | 2012-08-15 | Expired – Lifetime |
| [US 5,216,747](https://patents.google.com/patent/US5216747A/en) | Voiced/unvoiced estimation of an acoustic signal | 1991-11-21 | 1993-06-01 | 2010-09-20 | Expired – Lifetime |
| [US 5,247,579](https://patents.google.com/patent/US5247579A/en) | Methods for speech transmission | 1991-12-03 | 1993-09-21 | 2010-12-05 | Expired – Lifetime |
| [US 5,630,011](https://patents.google.com/patent/US5630011A/en) | Quantization of harmonic amplitudes representing speech | 1994-12-16 | 1997-05-13 | 2014-05-13 | Expired – Lifetime |
| [US 5,649,050](https://patents.google.com/patent/US5649050A/en) | Maintaining data rate integrity despite mismatch of readiness between components | 1993-03-15 | 1997-07-15 | 2014-07-15 | Expired – Lifetime |
| [US 5,701,390](https://patents.google.com/patent/US5701390A/en) | Synthesis of MBE-based coded speech using regenerated phase information | 1995-02-22 | 1997-12-23 | 2015-02-22 | Expired – Lifetime |
| [US 5,715,365](https://patents.google.com/patent/US5715365A/en) | Estimation of excitation parameters | 1994-04-04 | 1998-02-03 | 2015-02-03 | Expired – Lifetime |
| [US 5,754,974](https://patents.google.com/patent/US5754974A/en) | Spectral magnitude representation for multi-band excitation speech coders | 1995-02-22 | 1998-05-19 | 2015-05-19 | Expired – Lifetime |
| [US 5,826,222](https://patents.google.com/patent/US5826222A/en) | Estimation of excitation parameters (continuation) | 1997-04-14 | 1998-10-20 | 2015-01-12 | Expired – Lifetime |
| [US 5,870,405](https://patents.google.com/patent/US5870405A/en) | Digital transmission of acoustic signals over a noisy communication channel | 1996-03-04 | 1999-02-09 | 2012-11-30 | Expired – Lifetime |

Read together they cover, in public, an entire full-rate MBE codec:

- **pitch and voicing** — nonlinear band pre-processing to recover a weak
  or missing fundamental, a hybrid frequency- and time-domain estimator,
  pitch-multiple search against octave errors, and voicing smoothing
  across time and frequency
  <span class="cite">US 5,715,365; US 5,826,222; US 5,216,747</span>;
- **spectral amplitudes** — computed identically for voiced and unvoiced
  harmonics so a band flipping voicing does not step in level, complete
  with a tabulated analysis window
  <span class="cite">US 5,754,974</span>;
- **quantization** — predict this frame's log-amplitudes from the last
  frame's, interpolate across a changing harmonic count, code the residual
  through a block DCT, and decay the predictor so channel errors die out
  <span class="cite">US 5,630,011</span>;
- **the channel** — bits ranked by error sensitivity, Golay and Hamming
  codes allocated accordingly, interleaving against bursts, pseudo-random
  modulation that lets the decoder detect uncorrectable errors for free,
  and frame repeat or mute when it does
  <span class="cite">US 5,870,405</span>;
- **synthesis** — an oscillator bank for voiced harmonics, shaped noise
  for unvoiced ones, and voiced phases regenerated from the magnitude
  envelope rather than transmitted
  <span class="cite">US 5,701,390; US 5,081,681</span>.

The oldest of these lapsed in 2010 and the last in May 2015. Everything
this site teaches comes from this group.

## The middle generation: all expired

The next wave covers the techniques that separate AMBE and AMBE+2 from
1990s IMBE — multi-subframe quantization, the three-state excitation
model, transcoding, and the enhanced full-rate vocoder. Every one of them
is now expired, two of them for unpaid maintenance fees rather than by
running their term.

| Patent | Title | Filed (priority) | Granted | Expiry shown | Status shown |
| --- | --- | --- | --- | --- | --- |
| [US 6,161,089](https://patents.google.com/patent/US6161089A/en) | Multi-subframe quantization of spectral parameters | 1997-03-14 | 2000-12-12 | 2017-03-14 | Expired – Lifetime |
| [US 6,199,037](https://patents.google.com/patent/US6199037B1/en) | Joint quantization of speech subframe voicing metrics and fundamental frequencies | 1997-12-04 | 2001-03-06 | 2017-12-04 | Expired – Lifetime |
| [US 6,912,495](https://patents.google.com/patent/US6912495B2/en) | Speech model and analysis, synthesis, and quantization methods | 2001-11-20 | 2005-06-28 | 2023-11-28 | Expired – Lifetime |
| [US 7,634,399](https://patents.google.com/patent/US7634399B2/en) | Voice transcoder | 2003-01-30 | 2009-12-15 | 2025-11-07 | Expired – Lifetime |
| [US 7,957,963](https://patents.google.com/patent/US7957963B2/en) | Voice transcoder (continuation) | 2009-12-14 (2003-01-30) | 2011-06-07 | 2023-01-30 | Expired – Lifetime |
| [US 7,970,606](https://patents.google.com/patent/US7970606B2/en) | Interoperable vocoder | 2002-11-13 | 2011-06-28 | 2025-09-08 | Expired – Lifetime |
| [US 8,200,497](https://patents.google.com/patent/US8200497B2/en) | Synthesizing/decoding speech samples corresponding to a voicing state | 2009-08-21 (2002-01-16) | 2012-06-12 | 2022-01-16 | Expired – Fee Related |
| [US 8,315,860](https://patents.google.com/patent/US8315860B2/en) | Interoperable vocoder (continuation) | 2011-06-27 (2002-11-13) | 2012-11-20 | 2022-11-13 | Expired – Fee Related |
| [US 8,595,002](https://patents.google.com/patent/US8595002B2/en) | Half-rate vocoder (continuation) | 2013-01-18 (2003-04-01) | 2013-11-26 | 2023-04-01 | Expired – Fee Related |

Three of these are worth naming individually.

**US 6,161,089** and **US 6,199,037** are the architectural core of
multi-subframe parameter coding: jointly quantizing spectral magnitudes
across two consecutive subframes, and jointly quantizing the pitch and
voicing of those subframes into a single codeword. That pairing is what
makes a half-rate frame possible at all. Both expired in 2017.

**US 6,912,495** introduced the three-state excitation model — voiced,
unvoiced, and *pulsed*, each with its own strength parameter varying over
time and frequency — extending MBE past the two-state voicing decision
described elsewhere on this site. It expired on 2023-11-28. The model is
public; note the caveat in the next section about one particular way of
*estimating* its pulsed parameters.

**US 8,595,002** is a continuation out of the same 2003 application
family as the half-rate patent below. It inherited the 2003 priority
date, so its twenty-year term ended 2023-04-01, and Google Patents shows
it as fee-related expired. It does not extend the family's reach.

## What this means if you want to build something

Reduced to practice, and again subject to the warning at the top:

**Full-rate AMBE and IMBE — the D-STAR case — are taught entirely by
expired patents.** Pitch estimation, voicing decisions,
voicing-independent magnitudes, predictive residual-DCT quantization,
Golay and Hamming FEC with bit prioritization, pseudo-random scrambling
for error detection, frame repeat and mute, adaptive spectral
enhancement, and regenerated-phase synthesis all appear in patents that
lapsed between 2010 and 2015.

**Half-rate AMBE+2 is a different question.** US 8,359,197 has claims
covering both directions until 2028-05-20, so the usual "a decoder is
safe" reasoning does not transfer. Anyone planning half-rate work in the
United States before that date needs a claim-by-claim analysis from
counsel, not a blog post — including this one.

**Pulsed-excitation encoder analysis needs its own check until
2029-10-02.** The three-state model itself is public (US 6,912,495, now
expired); the particular band-splitting, pulse-emphasis estimation method
of US 8,036,886 is not.

**Jurisdiction matters.** Everything above is the United States. Patent
term adjustment is a US mechanism with no counterpart in most other
offices, so foreign counterparts of the half-rate family lapsed at their
plain twenty-year dates. Where you develop, where you distribute, and
where your users are can all be different answers.

**Describing is not practising.** Patents restrict making, using, selling
and importing the claimed invention. They do not restrict explaining how
it works — which is, after all, the deal: the public gets a full
disclosure in exchange for a limited monopoly. This site exists on that
side of the line, and deliberately confines its implementation-level
detail to the expired group.

**Dates decay.** Statuses change with every maintenance-fee window.
Re-check before you write code, not after.

## A third-party invalidity theory, recorded and not relied on

For completeness, because it circulates in the amateur community and
readers will meet it.

Bruce Perens (K6BP), whose 2014 "AMBE Exposed" talk is the route by which
most hams first encountered this subject, published a post-talk
correction arguing that certain DVSI patents are invalid under the
pre-AIA public-use bar of 35 U.S.C. § 102(b) — the theory being that AMBE
was sold or used commercially more than a year before the corresponding
applications were filed. He cites MPEP 2133 together with *In re
Blaisdell*, *Hall v. Macneale*, and *Ex parte Kuklo*.

**This is an unlitigated third-party theory. It is not an expiry, not a
finding, and not a basis for anyone to act.** No court or PTAB proceeding
has tested it. The underlying commercial-use dates are not verified here.
And the prediction accompanying it in 2014 — that the patents would
"expire next year" — did not come to pass: US 8,359,197 has maintained
its fees and its status line still reads *Active* in 2026.

Recording it changes nothing about the section above. Treat live patents
as live.

## Checking this yourself

Everything on this page came from two places, both free:

1. **[Google Patents](https://patents.google.com/)** — `patents.google
   .com/patent/US<number>/en` gives bibliographic data, the full text,
   claims, the legal-status timeline, and computed anticipated and
   adjusted expiration dates. Convenient, and the fastest way to read
   claim text. Its dates are computed and its OCR of equations and tables
   is unreliable; for anything numeric, open the USPTO page images.
2. **[USPTO Patent Center](https://patentcenter.uspto.gov/)** — the
   authoritative file wrapper: actual PTA determination, actual
   maintenance-fee payments, actual terminal disclaimers. Slower, and
   correct. This is what governs when the two disagree.

If you find an error on this page, please
[open an issue](https://github.com/rcludwick/how-ambe-works/issues) —
a wrong date here is worse than no date.

## Trademarks and independence

AMBE, AMBE+, and AMBE+2 are trademarks of Digital Voice Systems, Inc.,
used on this site only to identify the technology under discussion. This
project is independent of DVSI and is not affiliated with, sponsored by,
endorsed by, or approved by them.

Nothing on this page is a criticism of DVSI. Filing patents, prosecuting
them, paying maintenance fees, and enforcing the results is what the
patent system is for, and the disclosures those patents required are the
reason a page like this can be written at all. The purpose here is
accuracy about dates and scope, so that people building open software
know what is actually available to them and when.

---

**Next: [Sources and method](09-sources.md).** Every source behind this site,
what was deliberately excluded, and how to check any of it.
Previously: [Listen: real hardware examples](07-listen.md).
{: .chapter-nav }
