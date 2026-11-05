#!/usr/bin/env python3
"""Copy lint: the STYLE.md rules a grep can catch, on a list of files.

    python3 tools/check-copy.py            # the FILES list below
    python3 tools/check-copy.py a.md b.js  # just these

Flags the em dash (U+2014), "we" as a word, and the banned words below
(STYLE.md section 2, plus the register words the 2026-10-08 review found).
Words STYLE.md bans only as metaphor ("landscape", "journey", "realm",
"world of") are left to review, because "patent landscape" is literal.

In Markdown, text inside double quotes or backticks is skipped, so STYLE.md
can quote what it bans. In code, nothing is skipped: there the quoted text
is the copy a reader sees.

The list starts small. Each chapter joins it in the PR that cleans it; once
every chapter is clean the list becomes docs/*.md.

Every figure module that starts with `// @ts-check` is checked as well,
found on disk, so a module joins when its task converts it (and every
anim-<slug>-3d.js from its first commit). OPTIONAL lists the globs of files
the three-everywhere tasks will write, which may match nothing yet.

A chapter listed in SLOTS_ONLY is checked only inside its figure slot blocks:
the prose a figure task adds there is held to STYLE.md like any other. None
is listed now; docs/13-what-is-not-established.md was the one, until its em
dashes and "we" were cleaned at Task Z and it moved to FILES. A block whose text
is still the one PENDING names by hash is skipped, since its own task
rewrites it (gain-definitions, N9, the paragraph at 13:106-114); any edit to
it changes the hash, and the block is checked from then on. A file named on
the command line is checked whole.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FILES = [
    "STYLE.md",
    "justfile",
    "package.json",
    "jsconfig.json",
    "playwright.config.js",
    "types/*.d.ts",
    "docs/javascripts/anim-steps.js",
    "docs/javascripts/anim-badges.js",
    "docs/javascripts/anim-three.js",
    "docs/07-multi-band-excitation.md",
    "docs/javascripts/lib/*.js",
    "docs/javascripts/anim-voicing.js",
    "tools/posters/*.py",
    "tests/tools/test_poster_voicing.py",
    "tests/figures/*.js",
    "tests/figures/fixtures/javascripts/*.js",
    "tools/check-ts-pragma.sh",
    "tools/vendor-three.sh",
    "tools/verify-data.py",
    "tools/verify-site.py",
    "tools/make-posters.py",
    "tests/tools/test_check_ts_pragma.py",
    "tests/tools/test_verify_data.py",
    "tests/tools/test_verify_site.py",
    "tests/tools/test_markup.py",
    "tests/tools/test_make_posters.py",
    "docs/11-synthesis.md",
    "docs/index.md",
    "docs/javascripts/anim-harmonic-sum.js",
    "docs/javascripts/lib/*.js",
    "tools/check-scope.py",
    "tools/posters/*.py",
    "tests/tools/test_poster_harmonic_sum.py",
    "docs/10-the-dstar-frame.md",
    "docs/javascripts/anim-frame-path.js",
    "tests/tools/test_check_scope.py",
    "docs/09-quantization.md",
    "docs/javascripts/anim-vq-space.js",
    "tests/tools/test_poster_vq_space.py",
    # three-everywhere prelude (2026-10-09)
    "docs/javascripts/anim.js",
    "docs/index.md",
    "docs/01-why-sinusoids.md",
    "docs/02-fourier-and-the-dft.md",
    "docs/03-windows-and-frames.md",
    "docs/12-listen.md",
    "tests/figures/registry/*.json",
    "tools/check-slots.py",
    "tools/check-baselines.py",
    "tools/slots.json",
    "tests/tools/test_check_slots.py",
    "tests/tools/test_check_baselines.py",
    "tests/tools/test_make_data.py",
    "docs/08-analysis.md",
    "docs/13-what-is-not-established.md",
]

# Chapters checked only inside their figure slot blocks (see the docstring).
SLOTS_ONLY: list[str] = []
SLOT_BLOCK = re.compile(r"<!-- slot: ([\w-]+) -->(.*?)<!-- end slot: \1 -->", re.DOTALL)
# sha256 of a slot block's text (between its markers) that its own task
# will rewrite: skipped while unchanged.
PENDING = {
    "204ad5d619f3af770056fa38ca6718238c46254e59b2426ff7e406710814d4bd":
        "gain-definitions (N9) rewrites 13:106-114 without its em dashes",
}

# Files the three-everywhere tasks will write: checked once they exist.
OPTIONAL = [
    "docs/javascripts/anim-*-3d.js",
    "tools/data/*.py",
    "tools/posters/*.py",
    "tests/tools/test_poster_*.py",
]

EM_DASH = "\u2014"
BANNED = [
    "delve", "leverage", "seamless", "robust", "crucial", "profound",
    "elegant", "powerful", "remarkable", "tapestry", "brilliant", "brutal",
    "legendary", "incredibly", "magic trick", "holy grail",
    "it's worth noting", "it's important to understand", "at its core",
    "simply put", "in essence", "in today's",
]
WORD_WE = re.compile(r"\bwe\b", re.IGNORECASE)
BANNED_RES = [(word, re.compile(r"\b" + re.escape(word) + r"\w*", re.IGNORECASE)) for word in BANNED]
QUOTED = [re.compile(r'"[^"]*"'), re.compile("\u201c[^\u201d]*\u201d"), re.compile(r"`[^`]*`")]


def _blank(match: re.Match) -> str:
    # Keep newlines so line and column numbers survive.
    return re.sub(r"[^\n]", " ", match.group(0))


def check_text(text: str, is_markdown: bool) -> list[tuple[int, int, str, str]]:
    """Return (line, column, rule, matched text) for every problem, 1-based."""
    if is_markdown:
        for pattern in QUOTED:
            text = pattern.sub(_blank, text)
    problems = []
    for number, line in enumerate(text.splitlines(), 1):
        plain = line.replace("\u2019", "'")
        for col, char in enumerate(plain, 1):
            if char == EM_DASH:
                problems.append((number, col, "em dash", char))
        for match in WORD_WE.finditer(plain):
            problems.append((number, match.start() + 1, "we", match.group(0)))
        for word, pattern in BANNED_RES:
            for match in pattern.finditer(plain):
                problems.append((number, match.start() + 1, f"banned: {word}", match.group(0)))
    return sorted(problems)


def slot_text(text: str) -> str:
    """`text` with everything outside its slot blocks blanked, and every
    PENDING block too, keeping newlines so line numbers survive."""
    keep = [" " if c != "\n" else c for c in text]
    for match in SLOT_BLOCK.finditer(text):
        inner = match.group(2)
        if hashlib.sha256(inner.encode("utf-8")).hexdigest() in PENDING:
            continue
        keep[match.start(2):match.end(2)] = inner
    return "".join(keep)


def checked_modules() -> list[Path]:
    """Every figure module that starts with `// @ts-check`."""
    js = ROOT / "docs" / "javascripts"
    found = sorted(js.glob("anim*.js")) + sorted((js / "lib").glob("*.js"))
    return [p for p in found if p.read_text(encoding="utf-8").startswith("// @ts-check")]


def listed_files() -> list[Path]:
    paths: list[Path] = []
    for entry in FILES:
        matches = sorted(ROOT.glob(entry))
        if not matches:
            sys.exit(f"check-copy: {entry} matches no file; fix FILES in tools/check-copy.py")
        paths.extend(matches)
    for entry in OPTIONAL:
        paths.extend(sorted(ROOT.glob(entry)))
    paths.extend(ROOT / entry for entry in SLOTS_ONLY)
    paths.extend(checked_modules())
    # Each file once, in the order first listed.
    return list(dict.fromkeys(p.resolve() for p in paths))


def main(argv: list[str]) -> int:
    paths = [Path(arg) for arg in argv] if argv else listed_files()
    slots_only = set() if argv else {(ROOT / entry).resolve() for entry in SLOTS_ONLY}
    count = 0
    for path in paths:
        text = path.read_text(encoding="utf-8")
        if path in slots_only:
            text = slot_text(text)
        for line, col, rule, match in check_text(text, path.suffix == ".md"):
            shown = path.relative_to(ROOT) if path.is_absolute() and path.is_relative_to(ROOT) else path
            print(f"{shown}:{line}:{col}: {rule}: {match}")
            count += 1
    if count:
        print(f"check-copy: {count} problem(s)")
        return 1
    print(f"check-copy: ok ({len(paths)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
