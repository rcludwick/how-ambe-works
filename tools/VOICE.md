# How the site should read

Rob's rule is that the text must be **concise, explanatory and
conversational**. If a reader can't follow it, the site fails, however good
the figures are.

The model to copy is Rob's revoice of the chapters (done with Antigravity,
October 2026). Before writing, read the nearest revoiced section and match
it. `tools/check-voice.py` flags the habits that revoice removed.

## What the revoice changed

Compared on the same chapters, before and after:

| | Before | After |
|---|---|---|
| Words | 21,447 | 12,506 |
| Figures introduced by number | 0 | 43 |
| Flourishes ("blunt", "collision", "honest") | 44 | 7 |
| Passives with no one doing the action | 213 | 78 |
| Two-part or riddle titles and headings | 33 | 9 |

Sentence length barely changed. Short sentences are not the fix. What
changed is what each sentence does.

## The rules

**Titles and headings say what the section covers.**
Write "How a hard cut leaks energy across the spectrum" instead of "The
obvious cut, and why it leaks across the spectrum". Write "Spectral leakage
across DFT frequency bins" instead of "One tone, one cut, and where its
energy lands". Avoid comma-joined fragments, counting riddles and questions.
Never write "X, and how Y" or "X, not Y".

**Start from something concrete.**
Open with what the reader hears, sees or does, or with a real number.
"At 8,000 samples per second, a 20-millisecond frame holds 160 samples."
Not "Speech is quasi-stationary, so a window is applied."

**Pose the problem before the fix.**
"If the encoder only looked at those 160 samples, an 80 Hz voice would fit
barely one and a half cycles, too few to separate harmonics. To get sharper
resolution, the encoder uses a 255-sample window."

**Name who does it.**
The encoder, the decoder, the radio or you. Not "a window is applied".

**Define a term the first time it appears.**
Bold it where it's defined, and link it to the glossary.

**Introduce every figure by number and say what to do with it.**
"In **Figure 8.1**, scrub through the sentence and toggle *Windows* to see
the window reach 47 samples into the previous frame."

**Keep each sentence to two commas or fewer.**
The Oxford comma counts. When a sentence needs a third comma, split it in
two. Don't drop the comma or swap in a semicolon. "The radio sends the
pitch, the voicing, and the levels." is fine. Add "On air," to the front
and it needs splitting. A colon that joins two sentences should become a
period. Keep colons that introduce a list, a figure or an equation.

**Put asides in footnotes, not parentheses.**
Parentheses are not a place to hide a comma. Move an extra number or source
into a footnote. When the aside points to a glossary term, write "(see
[fricative](18-glossary.md#fricative))". When the word itself has a
glossary entry, link the word: "Its [amplitude](18-glossary.md#amplitude)
may be scaled", not "Its amplitude (loudness) may be scaled". Math, an
abbreviation at its definition, a cue such as "(dashed)" and quoted sound
examples stay in parentheses.

**Say facts plainly.**
No drama ("The radio has 72 bits." as its own paragraph). No aphorisms
("A perfect model estimated badly sounds worse than a mediocre one
estimated well"). No significance words such as "blunt", "honest",
"irrevocably" or "the hard half".

**Do the arithmetic for the reader.**
"A 20-millisecond block can only tell apart frequencies at least 50 Hz
apart", not "(T = 0.02 s) separates frequencies 1/0.02 = 50 Hz apart".

**Write math as text.**
Use f<sub>0</sub>, ω and ⌊ ⌋ in the text, never `$f_0$`. The site loads
no math renderer, and `just check` fails on raw math.

**Cut what doesn't serve the point.**
History, side facts and caveats go in a footnote or the glossary, or go.

**Keep sourcing.**
Every claim still cites its source inline. That rule from STYLE.md stands.

## Checking a draft

1. Run `uv run python tools/check-voice.py --score <file>`. It grades the
   text good, fair or poor (weighted flags per 1,000 words; good is 25 or
   less). Then run it without `--score` to see each flag, and fix every
   one in the text you wrote. `just unit` holds every page to good.
2. Read it out loud as if to a ham radio operator who has never studied
   signal processing. Rewrite any sentence you'd have to explain.
3. Run `just voice-trend --worktree`. The last line must not be higher
   than the commit before it. Every edit should leave the site's text no
   worse.
4. Put it next to the nearest revoiced section. If yours reads denser, more
   abstract or more clever, rewrite it.
