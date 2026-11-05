# how-ambe-works

## Writing text

Read `tools/VOICE.md` and follow it before you write any reader-facing text.
That includes chapter prose, headings, and figure titles. It also covers
captions and step text, status lines, and alt text. Rob's rule is that text
must be concise, explanatory, and conversational. Clever, dense or abstract
text fails the site no matter how good the figures are.

- Titles and headings say what the section covers. Never write "X, and how
  Y" or "X, not Y". Never write a counting riddle either.
- Keep sentences to two commas or fewer, the Oxford comma included. Split a
  longer one into two sentences rather than dropping a comma or swapping in
  a semicolon or dash. A colon that joins two sentences is a split waiting
  to happen too.
- Put an aside in a footnote, not in parentheses. When it points to a
  glossary term, write "(see [fricative](18-glossary.md#fricative))". When a
  word has a glossary entry, link the word instead of glossing it in
  parentheses.
- Grade what you wrote before showing it. "Checking the voice" below says
  how.
- Rob revoices chapters himself. Don't rewrite his prose unless he asks.

`STYLE.md` still binds on sourcing, legal notices and scope.

## Checking the voice

`tools/check-voice.py` reads a page's visible text (it skips code, HTML
and figure markup) and flags the habits Rob's revoice removed:

| Flag | Catches | Cost |
|---|---|---|
| heading, title | two-part, riddle or question titles ("The obvious cut, and why it leaks") | 8 |
| many-commas | a sentence with 4 or more commas, the Oxford comma included | 8 |
| drama | a short one-line paragraph for effect ("The radio has 72 bits.") | 5 |
| antithesis | contrast for effect ("not X, but Y", "worse than a…") | 5 |
| flourish | words that announce ("blunt", "honest", "the catch", "simply") | 4 |
| code-math, figure-intro | `A_l(n)` as code; a figure with no lead-in that names it and says what to do | 3 |
| commas | a sentence with 3 commas | 2 |
| aside | an aside in parentheses that should be a footnote, or "(see term)" for the glossary | 2 |
| passive, colon | an action with no one doing it; a colon joining what could be two sentences | 1 |

The comma rules leave alone the text whose commas are fixed.

- Commas inside numbers, such as 1,800
- Citations and bibliography entries
- Legal notices
- Lists of quoted terms

The colon rule skips bold labels such as **Amplitude**, times and ratios,
and the chapter navigation. The aside rule keeps a few kinds of parentheses
inline.

- Math and notation, such as A_l(n) and (x, y)
- An abbreviation where it's defined, such as (DFT)
- A cue to a figure's line, such as (dashed) or (the amber line)
- Quoted sound examples, such as (like "s" or "sh")
- A pointer that starts with "see", such as (see fricative)

Footnotes are checked like the rest of the page. A footnote that opens with
a bold title is a source entry, so it is skipped like the bibliography.

The score is the cost per 1,000 words, so lower is better. A score of 25 or
less grades **good**, and one over 50 grades **poor**.

- `uv run python tools/check-voice.py --score FILE` grades a file.
- `just voice FILE` lists each flag with its line.
- `just voice-trend --worktree` scores the whole site at every commit
  since the revoice, plus uncommitted edits. Run it after every edit; the
  last line must not go up.
- `tests/tools/test_check_voice.py` (in `just unit`) calibrates the score
  on before and after passages in `tests/tools/voice/`, holds every page
  to good and the site under 8 (pass; 5.1 on 2026-10-18), and allows
  no two-part heading or figure title.

It only sees patterns, so a passing score is a floor, not a verdict.
Then read the text out loud as `tools/VOICE.md` says.

## References

Check every reference you add against the source itself (the paper's
pages, the patent's text, a catalogue record) before it lands. Cite a
chapter or section only where you've confirmed it.
