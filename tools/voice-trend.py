#!/usr/bin/env python3
"""voice-trend: the site's voice score at each commit, oldest first.

Scores every docs/*.md page at each commit with the current rules in
tools/check-voice.py (weighted flags per 1,000 words; lower is better),
so a change of rules never makes old text look better or worse than new.

    uv run python tools/voice-trend.py               # commits since the revoice
    uv run python tools/voice-trend.py --since REV   # from another commit
    uv run python tools/voice-trend.py --worktree    # add uncommitted edits
"""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("check_voice", ROOT / "tools" / "check-voice.py")
cv = importlib.util.module_from_spec(spec)
sys.modules["check_voice"] = cv
spec.loader.exec_module(cv)

# The last commit before Rob's revoice landed, for comparison.
BEFORE_REVOICE = "306e92e"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def site_score(read) -> tuple[float, int]:
    cost = words = 0.0
    for name in read.names():
        r = cv.score(read.text(name))
        cost += r["score"] * r["words"] / 1000
        words += r["words"]
    return (round(1000 * cost / words, 1) if words else 0.0), int(words)


class AtRev:
    def __init__(self, rev: str):
        self.rev = rev

    def names(self):
        return [n for n in git("ls-tree", "--name-only", self.rev, "docs/").split() if n.endswith(".md")]

    def text(self, name):
        return git("show", f"{self.rev}:{name}")


class OnDisk:
    def names(self):
        return [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "docs").glob("*.md"))]

    def text(self, name):
        return (ROOT / name).read_text(encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", default=BEFORE_REVOICE)
    ap.add_argument("--worktree", action="store_true")
    args = ap.parse_args()

    revs = [args.since] + git("rev-list", "--reverse", f"{args.since}..HEAD", "--", "docs/").split()
    prev = None
    print(f"{'commit':9} {'score':>6} {'change':>7} {'words':>7}  subject")
    for rev in revs:
        value, words = site_score(AtRev(rev))
        change = "" if prev is None else f"{value - prev:+.1f}"
        subject = git("log", "-1", "--format=%s", rev).strip()[:60]
        print(f"{rev[:8]:9} {value:6} {change:>7} {words:7}  {subject}")
        prev = value
    if args.worktree:
        value, words = site_score(OnDisk())
        print(f"{'(edits)':9} {value:6} {value - prev:+7.1f} {words:7}  uncommitted")
    print("lower is better; a page grades good at 25 or less")
    return 0


if __name__ == "__main__":
    sys.exit(main())
