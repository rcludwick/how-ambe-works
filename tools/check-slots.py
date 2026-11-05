#!/usr/bin/env python3
"""Check that a figure branch changes only what its figure owns.

    python3 tools/check-slots.py <slug> [--base main]
    python3 tools/check-slots.py --inventory

Plan decision 15 (three-everywhere): figure tasks run in parallel and merge
in any order, so each one changes only

  - its own files, the globs listed for its slug in tools/slots.json, and
  - lines strictly between its own slot markers in a shared file
    (`/* slot: <slug> */` ... `/* end slot: <slug> */` in JS and CSS,
    `<!-- slot: <slug> -->` in Markdown, `# slot: <slug>` in Python).

The diff is taken from the merge base with the base branch (`base` in
tools/slots.json, main, unless --base names another) to the working tree,
so uncommitted changes count. An added line must sit inside one of the
slug's blocks in the new file, a removed line inside one in the old file,
and no marker line may change. Hunks in different blocks are kept
apart by unchanged marker lines, which is what lets git merge them cleanly.

--inventory checks the tree instead: every block listed in slots.json
exists exactly as many times as listed, and every marker is paired.

Standard library only. Exit 1 with one line per problem.
"""

from __future__ import annotations

import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "tools" / "slots.json"
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def load(manifest: Path = MANIFEST) -> dict:
    return json.loads(manifest.read_text(encoding="utf-8"))


def _markers(manifest: dict, path: str) -> tuple[str, str] | None:
    pair = manifest["markers"].get(Path(path).suffix)
    return (pair[0], pair[1]) if pair else None


def _marker_re(manifest: dict, path: str) -> re.Pattern[str] | None:
    pair = _markers(manifest, path)
    if not pair:
        return None
    start, end = (re.escape(p).replace(re.escape("{slug}"), r"([a-z0-9-]+)") for p in pair)
    return re.compile(rf"^\s*(?:{start}|{end})\s*$")


def blocks(manifest: dict, path: str, text: str, slug: str) -> list[tuple[int, int]]:
    """The slug's blocks in a file, as (start marker line, end marker line), 1-based."""
    pair = _markers(manifest, path)
    if not pair:
        return []
    start, end = (p.format(slug=slug) for p in pair)
    found: list[tuple[int, int]] = []
    opened: int | None = None
    for number, line in enumerate(text.split("\n"), 1):
        if line.strip() == start:
            opened = number
        elif line.strip() == end and opened is not None:
            found.append((opened, number))
            opened = None
    return found


def owns(manifest: dict, slug: str, path: str) -> bool:
    return any(fnmatch.fnmatch(path, glob) for glob in manifest["slugs"][slug]["files"])


def _git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout


def _hunks(diff: str) -> list[tuple[int, int, int, int]]:
    out = []
    for line in diff.splitlines():
        match = HUNK.match(line)
        if match:
            a, b, c, d = match.groups()
            out.append((int(a), int(b) if b is not None else 1, int(c), int(d) if d is not None else 1))
    return out


def _inside(number: int, spans: list[tuple[int, int]]) -> bool:
    return any(start < number < end for start, end in spans)


def check(slug: str, base: str, manifest: dict, repo: Path = ROOT) -> list[str]:
    if slug not in manifest["slugs"]:
        return [f"{slug} is not in tools/slots.json"]
    merge_base = _git("merge-base", base, "HEAD", cwd=repo).strip()
    changed = [line.split("\t") for line in _git("diff", "--name-status", "--no-renames", merge_base, cwd=repo)
               .splitlines() if line]
    untracked = _git("ls-files", "--others", "--exclude-standard", cwd=repo).splitlines()
    problems: list[str] = []
    for status, path in [(row[0], row[-1]) for row in changed] + [("A", p) for p in untracked]:
        if owns(manifest, slug, path):
            continue
        marker = _marker_re(manifest, path)
        if status != "M" or marker is None:
            problems.append(f"{path}: not {slug}'s (tools/slots.json)")
            continue
        old = _git("show", f"{merge_base}:{path}", cwd=repo)
        new = (repo / path).read_text(encoding="utf-8")
        old_spans, new_spans = blocks(manifest, path, old, slug), blocks(manifest, path, new, slug)
        old_lines, new_lines = old.split("\n"), new.split("\n")
        diff = _git("diff", "-U0", merge_base, "--", path, cwd=repo)
        for a, b, c, d in _hunks(diff):
            for number in range(a, a + b):
                if marker.match(old_lines[number - 1]):
                    problems.append(f"{path}:{number}: a slot marker changed")
                elif not _inside(number, old_spans):
                    problems.append(f"{path}:{number}: removed outside {slug}'s slots")
            for number in range(c, c + d):
                if marker.match(new_lines[number - 1]):
                    problems.append(f"{path}:{number}: a slot marker changed")
                elif not _inside(number, new_spans):
                    problems.append(f"{path}:{number}: added outside {slug}'s slots")
    return problems


def inventory(manifest: dict, repo: Path = ROOT) -> list[str]:
    problems: list[str] = []
    files = {path for entry in manifest["slugs"].values() for path in entry["blocks"]}
    for path in sorted(files):
        target = repo / path
        if not target.is_file():
            problems.append(f"{path}: missing")
            continue
        text = target.read_text(encoding="utf-8")
        marker = _marker_re(manifest, path)
        open_slug: str | None = None
        for number, line in enumerate(text.split("\n"), 1):
            match = marker.match(line) if marker else None
            if not match:
                continue
            start_slug, end_slug = match.group(1), match.group(2)
            if start_slug:
                if open_slug:
                    problems.append(f"{path}:{number}: slot {start_slug} opens inside slot {open_slug}")
                open_slug = start_slug
            elif end_slug != open_slug:
                problems.append(f"{path}:{number}: end slot {end_slug} closes {open_slug or 'nothing'}")
                open_slug = None
            else:
                open_slug = None
        if open_slug:
            problems.append(f"{path}: slot {open_slug} never closes")
        for slug, entry in manifest["slugs"].items():
            want = entry["blocks"].get(path, 0)
            have = len(blocks(manifest, path, text, slug))
            if have != want:
                problems.append(f"{path}: {have} blocks for {slug}, slots.json lists {want}")
    return problems


def main(argv: list[str]) -> int:
    manifest = load()
    if argv[:1] == ["--inventory"]:
        problems = inventory(manifest)
        label = "inventory"
    elif argv and not argv[0].startswith("-"):
        slug = argv[0]
        base = argv[argv.index("--base") + 1] if "--base" in argv else manifest["base"]
        problems = check(slug, base, manifest)
        label = slug
    else:
        print(__doc__.split("\n\n")[1])
        return 2
    for problem in problems:
        print(f"check-slots: {problem}")
    if problems:
        return 1
    print(f"check-slots: ok ({label})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
