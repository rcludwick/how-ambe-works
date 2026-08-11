#!/usr/bin/env python3
"""
make-transcripts.py — put each video's narration on the page as text.

    animations/narration/<slug>.txt  ->  a <details> block in the chapter

WHY THIS EXISTS
    The videos carry information as speech, so the speech has to be available
    to a reader who cannot hear it. The obvious answer is the caption track,
    and there is one, written by animations/manim/narration.py.

    Captions alone are not enough here. These scenes use the whole frame: a
    title at the top, a plot through the middle, an explanatory line low down
    and a stage indicator at the bottom edge. Browser captions render over the
    bottom of the video, which is exactly where the last two live, so turning
    them on hides part of the thing being explained.

    So the caption track is no longer marked `default`. A reader who wants
    captions still gets them from the player's own control, and everyone gets
    the transcript below, which covers the same speech, obscures nothing, and
    can be read at whatever pace suits. That is also a better fit for dense
    technical narration than four words at a time over a moving picture.

    Regenerate after editing any narration script:

        tools/make-transcripts.py
        tools/make-transcripts.py --check    # fail if a page is out of date

The block is delimited by HTML comments and rewritten in place, so editing a
narration script and re-running this is the whole update path. Text between
the markers is generated: do not hand-edit it.

MIT licensed (see LICENSE-MIT).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = ROOT / "animations" / "narration"
DOCS = ROOT / "docs"

#: slug -> the chapter carrying that video. Same four scenes as the CI matrix
#: in .github/workflows/animations.yml and the table in tools/render-local.sh.
PAGES = {
    "decomposition": "07-multi-band-excitation.md",
    "vq": "09-quantization.md",
    "pipeline": "10-the-dstar-frame.md",
    "harmonic-sum": "11-synthesis.md",
}

BEGIN = "<!-- BEGIN generated transcript: tools/make-transcripts.py -->"
END = "<!-- END generated transcript -->"

CUE_RE = re.compile(r"^\[([a-z0-9-]+)\]\s*$")


def die(msg: str) -> None:
    print(f"\033[31merror:\033[0m {msg}", file=sys.stderr)
    raise SystemExit(1)


def parse_script(path: Path) -> list[str]:
    """The spoken text of each cue, in order. Cue ids are not reader-facing."""
    cues: list[list[str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if line.lstrip().startswith("#"):
            continue
        if CUE_RE.match(line):
            cues.append([])
            continue
        if cues:
            cues[-1].append(line)

    out = []
    for lines in cues:
        text = "\n".join(lines).strip()
        text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)
        text = re.sub(r"[ \t]{2,}", " ", text).strip()
        if text:
            out.append(text)
    if not out:
        die(f"{path.name}: no cues found")
    return out


def render_block(cues: list[str]) -> str:
    """The <details> block, as raw HTML so it survives inside the figure."""
    paragraphs = "\n".join(f"    <p>{c}</p>" for c in cues)
    return (
        f"{BEGIN}\n"
        f'<details class="anim-transcript">\n'
        f"  <summary>Transcript of the narration</summary>\n"
        f'  <div class="anim-transcript__body">\n'
        f"{paragraphs}\n"
        f"  </div>\n"
        f"</details>\n"
        f"{END}"
    )


def update(page: Path, block: str) -> bool:
    """Replace the generated block, or insert one before </figure>."""
    text = page.read_text(encoding="utf-8")

    if BEGIN in text:
        start = text.index(BEGIN)
        stop = text.index(END) + len(END)
        updated = text[:start] + block + text[stop:]
    else:
        marker = "</figure>"
        if marker not in text:
            die(f"{page.name}: no </figure> to insert the transcript before")
        # Before the closing tag of the FIRST figure, which is the video one.
        at = text.index(marker)
        updated = text[:at] + block + "\n" + text[at:]

    if updated == text:
        return False
    page.write_text(updated, encoding="utf-8")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Put each video's narration on its page as text."
    )
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if any page is out of date")
    args = ap.parse_args()

    stale = []
    for slug, filename in sorted(PAGES.items()):
        script = SCRIPT_DIR / f"{slug}.txt"
        page = DOCS / filename
        if not script.is_file():
            die(f"no narration script for {slug}: {script}")
        if not page.is_file():
            die(f"no page for {slug}: {page}")

        cues = parse_script(script)
        block = render_block(cues)

        if args.check:
            current = page.read_text(encoding="utf-8")
            if block not in current:
                stale.append(filename)
                print(f"    \033[31mstale\033[0m {filename}")
            else:
                print(f"    ok    {filename} ({len(cues)} cues)")
            continue

        changed = update(page, block)
        print(f"    {'updated' if changed else 'ok     '} {filename} "
              f"({len(cues)} cues)")

    if args.check and stale:
        die(f"{len(stale)} page(s) out of date; run tools/make-transcripts.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
