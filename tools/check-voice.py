#!/usr/bin/env python3
"""check-voice: flag the habits that made the site's text hard to follow.

Rob's revoice (with Antigravity, October 2026) is the reference for how the
site should read: concise, explanatory, conversational. This checker looks
for the patterns that revoice removed from the earlier text. It is advisory
(not part of `just check`): a flag is a prompt to reread the sentence out
loud, not a rule to satisfy mechanically. The judgement half lives in
tools/VOICE.md.

    uv run python tools/check-voice.py                 # every chapter
    uv run python tools/check-voice.py docs/08-analysis.md
    uv run python tools/check-voice.py --rev main      # a commit's version
    uv run python tools/check-voice.py --summary       # counts only
    uv run python tools/check-voice.py --score FILE    # grade: good, fair or poor
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
JS = DOCS / "javascripts"

# Words and phrases that announce drama or significance instead of explaining.
FLOURISHES = [
    r"\bblunt(ly)?\b", r"\bcollision\b", r"\birrevocabl[ey]\b", r"\bhonest\b",
    r"\bthe hard half\b", r"\bit gets worse\b", r"\babsurd\b", r"\bbeautiful(ly)?\b",
    r"\bhold on to\b", r"\bthe whole trick\b", r"\bthe catch\b", r"\bthe point is\b",
    r"\bnotice that\b", r"\bcrucially\b", r"\bremarkabl[ey]\b", r"\bstriking(ly)?\b",
    r"\belegant(ly)?\b", r"\bmagic\b", r"\bbet\b", r"\bsecret\b", r"\bpunchline\b",
    r"\bfor free\b", r"\bnothing else\b", r"\bthat is the\b", r"\bthis is why\b",
    r"\bsimply\b", r"\bof course\b", r"\bin other words\b",
]
# Antithesis and aphorism shapes: "not X but Y", "X; the Y is not", "a perfect
# X ... worse than a mediocre Y".
ANTITHESIS = [
    r"\bnot (just |only |merely )?[\w\s'-]{1,40}, but\b",
    r"\b(is|are) not [\w\s'-]{1,30}; (it|they) (is|are)\b",
    r"\bworse than a\b", r"\bbetter than a\b.*\bworse\b",
]
PASSIVE = re.compile(
    r"\b(is|are|was|were|be|been|being|gets|get)\s+(\w+ly\s+)?(\w+ed|built|chosen|done|given|kept|known|made|sent|set|shown|taken|thrown|written)\b(?!\s+by\b)",
    re.I,
)
ACTION = re.compile(r"\b(drag|press|click|switch|toggle|scrub|step|move|turn|play|pick|choose|compare|watch|look|hover|open)\w*\b", re.I)


@dataclass
class Flag:
    path: str
    line: int
    rule: str
    text: str


def lines_of(path: Path, rev: str | None) -> list[str]:
    if rev:
        rel = path.relative_to(ROOT).as_posix()
        out = subprocess.run(["git", "show", f"{rev}:{rel}"], cwd=ROOT, capture_output=True, text=True)
        return out.stdout.splitlines()
    return path.read_text(encoding="utf-8").splitlines()


def title_flags(title: str) -> str | None:
    """A title or heading says what the section covers, as one plain phrase.

    Plain lists pass ("Golay, Hamming, and unprotected bits"). Two-part
    titles do not: a topic plus a vague tag ("The obvious cut, and why it
    leaks"), an antithesis ("A change of coordinates, not a lossy summary"),
    or a counting riddle ("Many inputs, one frame").
    """
    t = re.sub(r"<[^>]+>|\*|`|\{#[^}]*\}", "", title)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r'\([^)]*\)|"[^"]*"|“[^”]*”', "", t).strip()
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)  # 8,359,197 is one number
    if ";" in t:
        return "two-part title joined by a semicolon; say what the section covers"
    if re.search(r",\s+(and\s+)?(how|why|what|where|when|which)\b", t, re.I):
        return "topic plus a vague clause after a comma; name what the section explains"
    if re.search(r",\s+(not|but|recorded|and\s+not)\b", t, re.I):
        return "antithesis in a title; state what the section covers"
    if re.match(r"(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Many|Every)\b[^,]*,\s+(one|two|a|every|and)\b", t):
        return "counting riddle; name the thing shown instead"
    commas = t.count(",")
    if commas == 1 and not re.search(r"\band\b|\bor\b", t):
        return "two fragments joined by a comma; make it one plain phrase"
    if commas >= 2 and not re.search(r",\s+(and|or)\b[^,]*$", t):
        return "a list with a tag after its last comma; make it one plain phrase"
    if re.search(r"\?$", t):
        return "question as a heading; state what the section shows"
    return None


def prose_lines(lines: list[str]):
    """Yield (line number, text) for paragraph text, skipping code, HTML and front matter."""
    fence = False
    for i, raw in enumerate(lines, 1):
        s = raw.strip()
        if s.startswith("```"):
            fence = not fence
            continue
        # A blockquote is quoted word for word, so its wording isn't the site's.
        if fence or not s or s.startswith(("<", "|", "!!!", "{:", ">")) or s.startswith("#"):
            continue
        # A footnote is prose too: check it without its "[^name]:" label.
        yield i, re.sub(r"^\[\^[\w-]+\]:\s*", "", raw)


def check_markdown(path: Path, rev: str | None) -> list[Flag]:
    return check_text("\n".join(lines_of(path, rev)), path.relative_to(ROOT).as_posix())


def check_text(text: str, rel: str = "<text>") -> list[Flag]:
    """Every flag in one Markdown text."""
    lines = text.splitlines()
    flags: list[Flag] = []
    for i, raw in enumerate(lines, 1):
        h = re.match(r"#{2,4}\s+(.*)", raw)
        if h and (why := title_flags(h.group(1))):
            flags.append(Flag(rel, i, "heading", f"{why}: {h.group(1)!r}"))
        for m in re.finditer(r'data-title="([^"]+)"', raw):
            if why := title_flags(m.group(1)):
                flags.append(Flag(rel, i, "title", f"{why}: {m.group(1)!r}"))

    text = "\n".join(lines)
    # Each figure is introduced in the paragraph before it, by number, with
    # something for the reader to do or watch.
    for m in re.finditer(r'<div[^>]*data-anim="([\w-]+)"', text):
        line = text.count("\n", 0, m.start()) + 1
        before = text[: m.start()]
        before = re.sub(r"<!--.*?-->", "", before, flags=re.S).rstrip()
        para = before.split("\n\n")[-1] if before else ""
        if not re.search(r"Figure\s+\d", para):
            flags.append(Flag(rel, line, "figure-intro", f"{m.group(1)}: the paragraph before it does not name the figure by number"))
        elif not ACTION.search(para):
            flags.append(Flag(rel, line, "figure-intro", f"{m.group(1)}: the intro names the figure but gives the reader nothing to do or watch"))

    for i, raw in prose_lines(lines):
        low = raw.lower()
        for pat in FLOURISHES:
            if m := re.search(pat, low):
                flags.append(Flag(rel, i, "flourish", f"{m.group(0)!r}: say the fact plainly"))
        for pat in ANTITHESIS:
            if m := re.search(pat, low):
                flags.append(Flag(rel, i, "antithesis", f"{m.group(0)!r}: state the claim directly"))
        if re.search(r"`[A-Za-z]+_[A-Za-z]+(\([a-z]\))?`", raw):
            flags.append(Flag(rel, i, "code-math", "write math as $A_l(n)$, not as code"))
        for m in PASSIVE.finditer(raw):
            flags.append(Flag(rel, i, "passive", f"{m.group(0)!r}: who does it? name the encoder, the decoder or you"))

    # Short dramatic one-line paragraphs ("The radio has 72 bits.").
    paras = re.split(r"\n\s*\n", text)
    offset = 0
    for p in paras:
        start = text.index(p, offset) if p else offset
        offset = start + len(p)
        s = p.strip()
        if (
            s
            and not s.startswith(("<", "#", "!", "-", "|", "`", "{", "[^"))
            and "\n" not in s
            and len(s.split()) <= 8
            and s.endswith(".")
        ):
            flags.append(Flag(rel, text.count("\n", 0, start) + 1, "drama", f"one-line paragraph {s!r}: fold it into the explanation"))

    # Sentences that stack clauses: three commas cost a little, four or
    # more a lot. Every comma counts, the serial (Oxford) comma too.
    # A colon mid-sentence costs a little: it is often two sentences
    # joined. Labels ("**Amplitude:**"), times and ratios (12:30, 3:1)
    # don't count.
    for sent in sentences(text):
        snippet = sent[:90]
        line = next((k for k, l in enumerate(lines, 1) if snippet[:30] in re.sub(r"\s+", " ", l)), 0)
        n = commas(sent)
        if n >= 3 and not EXEMPT.search(sent) and not quoted_list(sent, n):
            rule = "commas" if n == 3 else "many-commas"
            flags.append(Flag(rel, line, rule, f"{n} commas: split it, one idea per sentence: {snippet!r}…"))
        if colons(sent) and not EXEMPT.search(sent):
            flags.append(Flag(rel, line, "colon", f"a colon: could it be two sentences? {snippet!r}…"))
        for aside in [] if EXEMPT.search(sent) else asides(sent):
            flags.append(Flag(rel, line, "aside", f"({aside[:40]}): make it a footnote, or (see term) for a glossary term"))
    return flags


def quoted_list(sentence: str, n: int) -> bool:
    """A list of quoted terms, such as STYLE.md's banned words: its commas
    separate the quotations, which stay word for word."""
    return len(re.findall(r'["“][^"”]{1,40}["”],', sentence)) >= n - 1


def colons(sentence: str) -> int:
    """Colons in a sentence's own text: not a bold label at its start
    (in a list item too), a time or ratio, a link target, or the chapter
    navigation and source notes ({: .chapter-nav}, "Last reviewed:")."""
    if "{: ." in sentence or sentence.startswith("Last reviewed:"):
        return 0
    t = re.sub(r"\]\([^)]*\)", "]", sentence)
    t = re.sub(r"^(?:[-*+]|\d+\.)?\s*\*\*[^*]*:\*\*", "", t)
    t = re.sub(r"^(?:[-*+]|\d+\.)?\s*\*\*[^*]*?:", "", t)
    t = re.sub(r"\*\*\[?Next:", "", t)
    t = re.sub(r"\d:\d|\bdoi:|https?:", "", t)
    return t.count(":")


# Parentheses that belong in the sentence: notation ("A_l(n)", "(x, y)"),
# an abbreviation ("(DFT)"), a cue to a figure's line ("(dashed)", "(the
# amber line)"), quoted examples ("(like "s" or "sh")") and a pointer to the
# glossary ("(see fricative)"). Rob, 2026-10-17: any other aside is a
# footnote, so a comma can't hide in parentheses.
NOTATION = re.compile(
    r"[=≤≥×÷/^θωπ⌊⌋Δγ∑√±−…+²³]|^\w{1,3}(?:[+−-]\d)?$|^[A-Za-z] [A-Za-z0-9]{1,2}$"
    r"|^[a-zA-Z0-9.]+, ?[a-zA-Z0-9.]+$"
)
ABBREVIATION = re.compile(r"^[A-Z0-9][\w+&.-]*[A-Z][\w+&.-]*(?:(?:, | vs\. | and )[A-Z0-9][\w+&.-]*)*$")
CUE = re.compile(r"\b(?:dashed|thick|thin|solid|dotted|amber|teal|lines?|curves?|dots?|bars?|sticks|blocks|front|back)\b")


def asides(sentence: str) -> list[str]:
    """The parenthetical asides in a sentence that should be footnotes."""
    t = re.sub(r"\]\([^)]*\)", "]", sentence)
    found = []
    for m in re.finditer(r"(?<=(.))?\(([^()]*)\)", t):
        inner = m.group(2).strip().strip("*_`")
        before = t[m.start() - 1] if m.start() else " "
        if (
            not inner
            or before.isalnum() or before in ")_}]"
            or inner.lower().startswith("see ")
            or NOTATION.search(inner)
            or ABBREVIATION.match(inner)
            or (len(inner.split()) <= 4 and CUE.search(inner))
            or re.search(r'["“*]', inner)
        ):
            continue
        found.append(inner)
    return found


# Sentences the comma rule leaves alone: the legal notices STYLE.md keeps
# word for word (not legal advice, independent of DVSI and its trademarks,
# no codec, a licence credit), and bibliography entries, whose commas are the citation format.
EXEMPT = re.compile(
    r"legal advice|trademarks? of|independent of|not (?:affiliated|endorsed)|no codec|used under CC BY"
    r"|\bvol\.\s*\d|\bpp?\.\s*\d|\bno\.\s*\d|\b\d+(?:st|nd|rd|th) ed\."
    r"|technical report|\bDTIC\b|,\s*(?:19|20)\d\d\.?$",
    re.I,
)


def sentences(text: str) -> list[str]:
    """The prose sentences of a Markdown text: one block at a time (a
    paragraph, a list item), so a sentence never runs into a heading, a list
    or a table. Code, HTML, comments and math are left out."""
    # Citations (<span class="cite">) go first: their commas are the
    # citation format, as in the bibliography.
    body = re.sub(r'<span class="cite">.*?</span>', " ", text, flags=re.S)
    # Front matter and <style> or <script> blocks are not prose.
    body = re.sub(r"\A---\n.*?\n---\n", " ", body, flags=re.S)
    body = re.sub(r"<(style|script)\b.*?</\1>", " ", body, flags=re.S)
    body = re.sub(r"```.*?```|<!--.*?-->|<[^>]+>|\$[^$]+\$", " ", body, flags=re.S)
    out: list[str] = []
    for block in re.split(r"\n\s*\n|\n(?=\s*(?:[-*+]|\d+\.)\s)|\n(?=#)|\n(?=\[\^[\w-]+\]:)", body):
        flat = re.sub(r"\s+", " ", block).strip()
        # Tables, headings, attribute lists, admonition heads, definition-list
        # notes (the bibliography) and blockquotes (quoted word for word) are
        # not the site's own sentences. A footnote is, unless it opens with a
        # bold title: then it is a source entry, like the bibliography.
        if not flat or flat.startswith(("|", "#", "{:", "!!!", ">", ": ")):
            continue
        if flat.startswith("[^"):
            flat = re.sub(r"^\[\^[\w-]+\]:\s*", "", flat)
            if flat.startswith("**"):
                continue
        # The chapter navigation and the source note are page furniture.
        if "{: .chapter-nav" in flat or "{: .source-note" in flat:
            continue
        # A stop inside bold or italics ("**Next.**") still ends the sentence.
        flat = re.sub(r"([.!?])([*_]+)(?=\s)", r"\2\1", flat)
        out += [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z“\"(\[*])", flat) if s]
    return out


def commas(sentence: str) -> int:
    """Commas in a sentence. A comma inside a number (1,800) is not one;
    link targets are dropped first."""
    return len(re.findall(r",(?!\d{3}\b)", re.sub(r"\]\([^)]*\)", "]", sentence)))


# How much each kind of flag costs, per 1,000 words. Titles, drama and a
# sentence with four or more commas cost most: they hide what a section is
# about or what a sentence says. A sentence with three commas costs a
# little; passives and colons least, as the revoice kept some of each.
WEIGHTS = {
    "heading": 8, "title": 8, "many-commas": 8, "drama": 5, "antithesis": 5,
    "flourish": 4, "code-math": 3, "figure-intro": 3, "commas": 2, "passive": 1,
    "colon": 1, "aside": 2,
}
# A passage that scores at or under GOOD reads like the revoice; one over
# POOR reads like the old text. Calibrated on tests/tools/voice/.
GOOD, POOR = 25.0, 50.0


def words_in(text: str) -> int:
    body = re.sub(r"```.*?```|<[^>]+>|<!--.*?-->", " ", text, flags=re.S)
    return len(re.findall(r"[A-Za-z][\w'-]*", body))


def score(text: str) -> dict:
    """Weighted flags per 1,000 words (lower is better), with a grade."""
    flags = check_text(text)
    words = max(1, words_in(text))
    cost = sum(WEIGHTS.get(f.rule, 1) for f in flags)
    value = round(1000 * cost / words, 1)
    grade = "good" if value <= GOOD else "poor" if value > POOR else "fair"
    counts: dict[str, int] = {}
    for f in flags:
        counts[f.rule] = counts.get(f.rule, 0) + 1
    return {"score": value, "grade": grade, "words": words, "counts": counts, "flags": flags}


def check_js(path: Path, rev: str | None) -> list[Flag]:
    rel = path.relative_to(ROOT).as_posix()
    flags: list[Flag] = []
    for i, raw in enumerate(lines_of(path, rev), 1):
        for m in re.finditer(r'anim-figure__title">([^<$]+)<', raw):
            if why := title_flags(m.group(1)):
                flags.append(Flag(rel, i, "title", f"{why}: {m.group(1)!r}"))
    return flags


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*", type=Path)
    ap.add_argument("--rev", help="check this commit's version of the files")
    ap.add_argument("--summary", action="store_true", help="print counts per rule only")
    ap.add_argument("--score", action="store_true", help="grade each file: weighted flags per 1,000 words")
    args = ap.parse_args()

    paths = [p.resolve() for p in args.paths] or sorted(DOCS.glob("*.md")) + sorted(JS.glob("anim-*.js"))
    if args.score:
        for p in paths:
            if p.suffix != ".md":
                continue
            r = score(p.read_text(encoding="utf-8") if not args.rev else "\n".join(lines_of(p, args.rev)))
            print(f"{p.name}: {r['score']} per 1,000 words ({r['grade']}; good is {GOOD} or less) {r['counts']}")
        return 0
    flags: list[Flag] = []
    for p in paths:
        flags += check_js(p, args.rev) if p.suffix == ".js" else check_markdown(p, args.rev)

    if not args.summary:
        for f in flags:
            print(f"{f.path}:{f.line}: [{f.rule}] {f.text}")
    counts: dict[str, int] = {}
    for f in flags:
        counts[f.rule] = counts.get(f.rule, 0) + 1
    print("check-voice: " + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "nothing flagged"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
