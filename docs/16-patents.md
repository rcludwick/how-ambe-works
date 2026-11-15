# The patent landscape

<!-- Owner: patents-agent -->

AMBE's reputation in amateur radio is inseparable from its patents. This
page tries to replace the folklore with the record. It shows which patents
cover what and when each one expired or expires. It names the two still in
force today and says what that actually constrains for someone building an
open implementation.
{: .lede }

!!! warning "This is not authoritative"

    **This page is a summary and not to be construed as legal advice.** 
    It collects the public record and the various readings people 
    have offered of it. The author is not an attorney. YMMV.

    Expiration dates shown by Google Patents are computed and can be
    wrong, and maintenance-fee status can change at any renewal window.
    Dates and statuses here reflect patents.google.com as of 2026-08-10
    and will drift. Verify anything you intend to rely on at
    [USPTO Patent Center](https://patentcenter.uspto.gov/).

## Still in force

Two patents are live today. Both are assigned to Digital Voice Systems,
Inc. 

### US 8,359,197: "Half-rate vocoder" · expires 2028-05-20

[patents.google.com/patent/US8359197B2](https://patents.google.com/patent/US8359197B2/en)
· inventor John C. Hardwick · filed 2003-04-01 · granted 2013-01-22 ·
status shown: **"Active, expires 2028-05-20"**

The application was filed on 1 April 2003, so a plain twenty-year term
would have ended on 1 April 2023. It did not issue until 22 January
2013, after nearly ten years in prosecution. The expiry Google Patents
displays, 2028-05-20, sits about five years past the plain term. That gap
is patent term adjustment for USPTO delay.

**The independent claims cover both encoding and decoding.** 
On the encoding side, the claims include dividing speech into frames and
computing MBE model parameters. They include quantizing pitch, voicing and
gain. They also include combining selected bits into a 12-bit parameter
codeword and applying error control codes. Separate claims cover decoding.
They include extracting FEC codewords from a received frame and
error-control decoding them. They also include reconstructing pitch,
voicing and gain, then synthesizing speech samples.
A decoder-only implementation is not outside this patent the way it would
be outside an analysis-only patent.

The claims describe a 3600 bps frame of 72 bits per 20 ms. The frame
carries 49 voice or tone bits and 23 FEC bits. The 49 bits split into 7 for
pitch, 5 for voicing, and 37 for spectral magnitude. One [24,12] extended Golay code and one [23,12] Golay code
protect the 24 most error-sensitive bits. The remaining 25 bits go
unprotected. The field widths are set out in
[the patent itself](https://patents.google.com/patent/US8359197B2/en).

That is structurally the half-rate frame used by DMR, dPMR, NXDN and
YSF's narrow mode. **The equivalence is community consensus, not a legal
finding.** DVSI has never publicly equated its "AMBE+2" branding to the
P25 half-rate specification, and no claim-by-claim mapping of the
deployed formats onto these claims has been published.

### US 8,036,886: "Estimation of pulsed speech model parameters" · expires 2029-10-02

[patents.google.com/patent/US8036886B2](https://patents.google.com/patent/US8036886B2/en)
· inventor Daniel W. Griffin · filed 2006-12-22 · granted 2011-10-11 ·
status shown: **"Active, expires 2029-10-02"**

This one runs longer but reaches far less far.

Claim 1 is a method of *analysis*.  It divides a digitized signal into
frequency bands by bandpass filtering, performs "an operation to emphasize
pulse positions on at least two frequency band signals to produce
modified frequency band signals," and determines pulsed parameters from
those. That is an encoder-side measurement technique for the pulsed
excitation class introduced by US 6,912,495. It says nothing about
reconstructing speech.

Two practical consequences. A **decoder** does not perform this analysis
and is unaffected by these claims. An **encoder** that needs to detect
pulsed frames either has to wait, or has to arrive at that decision by a
route the claims do not describe. The plain twenty-year term from the
2006 filing would have ended in December 2026; the 2029 date again
reflects term adjustment for examination delay.

## The expired core: full-rate MBE and AMBE

These are the patents that teach the codec described on the rest of this
site. All of them are assigned to Digital Voice Systems, Inc. All of them
have expired at the end of their natural term.

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

Read together, they cover an entire full-rate MBE codec:

- **pitch and voicing:** nonlinear band pre-processing recovers a weak or
  missing fundamental. The patents also describe a hybrid
  frequency- and time-domain estimator and a pitch-multiple search against
  octave errors. Voicing smoothing
  runs across time and frequency
  <span class="cite">US 5,715,365; US 5,826,222; US 5,216,747</span>.
- **spectral amplitudes:** computed identically for voiced and unvoiced
  harmonics so a band flipping voicing does not step in level, complete
  with a tabulated analysis window
  <span class="cite">US 5,754,974</span>.
- **quantization:** the quantizer predicts this frame's log-amplitudes
  from the last frame's and interpolates across a changing harmonic count.
  It codes the residual through a block DCT. It also decays the predictor
  so channel errors die out <span class="cite">US 5,630,011</span>.
- **the channel:** the encoder ranks bits by error sensitivity and
  allocates Golay and Hamming codes accordingly. It interleaves the bits
  against error bursts. Pseudo-random modulation lets the decoder detect
  uncorrectable errors without spending extra bits. When it detects one,
  the decoder repeats or mutes the frame
  <span class="cite">US 5,870,405</span>.
- **synthesis:** an oscillator bank for voiced harmonics, shaped noise
  for unvoiced ones, and voiced phases regenerated from the magnitude
  envelope rather than transmitted
  <span class="cite">US 5,701,390; US 5,081,681</span>.

The oldest of these lapsed in 2010 and the last in May 2015. Everything
this site teaches comes from this group.

## The middle generation: all expired

The next wave covers the techniques that separate AMBE and AMBE+2 from
1990s IMBE:

- multi-subframe quantization
- the three-state excitation model
- transcoding
- the enhanced full-rate vocoder

Every one of them is now expired, three of them for unpaid maintenance fees rather than by
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

**US 6,161,089** and **US 6,199,037** are the architectural core of
multi-subframe parameter coding. They jointly quantize spectral magnitudes
across two consecutive subframes, and they jointly quantize the pitch and
voicing of those subframes into a single codeword. That pairing is what
makes a half-rate frame possible at all. Both expired in 2017.

**US 6,912,495** introduced a three-state excitation model covering
voiced, unvoiced, and *pulsed* speech. Each state has its own strength parameter
varying over time and frequency, extending MBE past the two-state voicing
decision described elsewhere on this site. It expired on 2023-11-28. The
model is public. One particular way of *estimating* its pulsed parameters is
the subject of US 8,036,886, still in force and described above.

**US 8,595,002** is a continuation out of the same 2003 application
family as the half-rate patent above. It inherited the 2003 priority
date, so its term could not have run past 2023-04-01; Google Patents
shows it as expired for an unpaid fee. It does not extend the family's
reach.

## Trademarks and independence

AMBE, AMBE+, and AMBE+2 are trademarks of Digital Voice Systems, Inc.,
used on this site only to identify the technology under discussion. This
project is independent of DVSI and is not affiliated with, sponsored by,
endorsed by, or approved by them.

---

**Next: [Sources and method](17-sources.md).** Every source behind this site,
and how to check any of it.
Previously: [Listen: real hardware examples](12-listen.md).
{: .chapter-nav }

Last reviewed: 2026-08-10.
{: .source-note }
