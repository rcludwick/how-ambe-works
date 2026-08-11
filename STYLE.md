# Writing style for How AMBE Works

This file is binding on every page in `docs/`. It applies to human
contributors and to any AI assistance used on this repository.

## 1. The method: let the reader discover it

The model is Grant Sanderson's 3Blue1Brown videos. The reader should
arrive at each idea a beat before you state it, so that the explanation
confirms something they already suspected rather than announcing
something new.

In practice:

1. **Open with a concrete problem, not a definition.** Do not begin a
   section with "Multi-band excitation is a technique in which...".
   Begin with the situation that forces it: you have 2400 bits per
   second and a human voice, and the voice contains both a buzz and a
   hiss at the same time.
2. **Ask the question the reader is already forming.** Write it out.
   "So why not just send the spectrum?" Then answer it.
3. **Show the naive approach and let it fail.** An idea feels inevitable
   only after the reader has watched the obvious alternative break. Give
   the simple approach a fair hearing, then show the specific case where
   it produces bad audio.
4. **Give the reader the pieces before the conclusion.** If you have
   explained harmonic spacing and you have explained a fixed bit budget,
   the reader can work out for themselves that the number of transmitted
   amplitudes has to depend on pitch. Let them. Then confirm it.
5. **Use the figure as the argument.** An interactive figure is not
   decoration next to the explanation. It is where the explanation
   happens. Write the surrounding prose to send the reader to the figure
   with a specific thing to try, and to meet them on the other side.

A good test: could an attentive reader, stopped mid-section, predict the
next paragraph? If yes, you are doing it right.

## 2. Language

Write technical English. Dry is acceptable. Precise and slightly flat
beats energetic and vague.

**Punctuation**

- Do not use em dashes. This is the most common tell and it is banned
  outright. Use a period, a comma, a colon, or parentheses. If a
  sentence seems to need an em dash, it is usually two sentences.
- Prefer short sentences. Break long ones.
- Use ordinary lists rather than sentences that contain three parallel
  clauses.

**Banned constructions**

These read as machine-generated. Do not use them:

- "It's worth noting that", "It's important to understand", "Note that"
  as a paragraph opener
- "delve", "leverage", "seamless", "robust", "crucial", "profound",
  "elegant", "powerful", "remarkable"
- "landscape", "tapestry", "realm", "journey", "world of" used as
  metaphor
- "not just X, but Y" and "isn't merely X, it's Y"
- "In today's...", "At its core", "Simply put", "In essence"
- Rhetorical triples used for rhythm rather than content
- Sentences that summarise what the previous paragraph just said
- Closing paragraphs that restate the section with no new information

**Metaphor**

Metaphors are allowed and encouraged when they carry real explanatory
weight. A metaphor that lets the reader transfer a known intuition to an
unknown mechanism is doing work. A metaphor chosen because it sounds
good is not. If you cannot say which specific property transfers, cut
it.

Good: a comb over the spectrum, because the teeth really are evenly
spaced and really do get further apart as pitch rises.

Bad: "a symphony of frequencies".

**Voice**

- Second person ("you") when guiding the reader through a figure.
- Plain third person for mechanism.
- Do not use "we" to mean the project unless the sentence is genuinely
  about something this project did.

## 3. Tone about what is and is not known

State what is known plainly, without hedging, and state what is unknown
as an open question with a path to answering it.

Do not apologise for the state of the research. Delete phrasing of this
shape wherever it appears:

- "necessarily incomplete"
- "we cannot establish"
- "the limits of black-box measurement"
- "this may not be accurate"
- "unfortunately, the public record does not..."

Replace it with a direct statement and a status. Not "unfortunately we
cannot determine the exact codebook contents", but "The codebook
contents are not public. See the gap register for what it would take to
characterise them."

An open question is a piece of work someone has not done yet. Present it
that way.

**This does not apply to the legal notices.** Keep, verbatim and
prominent:

- that the patent chapter is engineering research and not legal advice
- that this project is independent of and not endorsed by Digital Voice
  Systems, Inc.
- that this repository contains no codec implementation

Those are not hedges about research quality. They are statements of
fact that protect the project. Do not soften or remove them.

## 4. Sourcing

Every substantive technical claim names its source inline, in the
sentence or the one after it. Three kinds are permitted:

- an expired patent, cited by number
- a published paper or public specification, cited by name
- an original measurement made by this project against AMBE hardware,
  identified as such

If a claim has none of those, it does not go on the site.

Sourcing is what makes the document contributable. A reader who can see
where a claim came from can check it, challenge it, or improve it.

## 5. This is a living document

The site is expected to change as people establish things that are
currently open.

- Every gap in `docs/06-what-is-not-established.md` carries a status of
  `Open`, `Partially characterised`, or `Established`, plus an estimate
  of the work required to close it.
- When a gap is closed, the finding moves into the relevant chapter with
  its provenance, and the register entry is updated rather than deleted,
  so the history of what was learned stays visible.
- Pages carry a "last reviewed" date.
- Corrections are as welcome as additions. A page that is wrong and
  cited is more useful than a page that is vague and safe, because the
  citation is what lets someone catch the error.

See `CONTRIBUTING.md` for how to submit a measurement or a correction.

## 6. Checklist before committing a page

- [ ] No em dashes anywhere in the file
- [ ] No banned constructions from section 2
- [ ] Opens with a problem, not a definition
- [ ] At least one place where the naive approach is shown failing
- [ ] Every technical claim carries a source
- [ ] No apologetic hedging about the research
- [ ] Legal notices intact where they belong
- [ ] Figures introduced with something specific to try
- [ ] "Last reviewed" date current
