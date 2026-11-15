#!/usr/bin/env python3
"""Check that a figure branch changes only its own pixel baselines.

    python3 tools/check-baselines.py <slug> [--base main]
    python3 tools/check-baselines.py [--base ...]   # list every changed baseline

Design §3.6 and plan decision 8 (three-everywhere). Under
tests/figures/__screenshots__/, a figure's branch may add, change or remove:

  - anything in <slug>.spec.js/ and <slug>-3d.spec.js/ (its own specs; the
    four shipped 3D figures keep theirs in <slug>.spec.js/);
  - screens.spec.js/*-<slug>-figure-*.png (the normal-motion whole figure,
    which shows the figure's controls row);
  - screens.spec.js/*-<slug>-frame-reduced-*.png only when its registry
    file, tests/figures/registry/<slug>.json, lists "frame-reduced" in
    `rebaseline` and gives a `rebaselineReason`. These are the 2D default
    states, which Playwright takes under reduced motion, so they stay
    byte-for-byte unless the figure's own decision moves them.

Nothing else. The diff runs from the merge base with the base branch to the
working tree. With no slug, every changed baseline is listed and the exit
status is 1 if there is any. Standard library only.
"""

from __future__ import annotations

import fnmatch
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOTS = "tests/figures/__screenshots__/"
REGISTRY = ROOT / "tests" / "figures" / "registry"
BASE = "main"


def _git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout


def changed_baselines(base: str, repo: Path = ROOT) -> list[str]:
    merge_base = _git("merge-base", base, "HEAD", cwd=repo).strip()
    tracked = _git("diff", "--name-only", "--no-renames", merge_base, "--", SHOTS, cwd=repo).splitlines()
    untracked = _git("ls-files", "--others", "--exclude-standard", "--", SHOTS, cwd=repo).splitlines()
    return sorted(set(tracked) | set(untracked))


def allowed(slug: str, path: str, record: dict) -> str:
    """Why `path` is not the slug's to change, or ""."""
    rel = path[len(SHOTS):] if path.startswith(SHOTS) else path
    if rel.startswith((f"{slug}.spec.js/", f"{slug}-3d.spec.js/")):
        return ""
    name = rel[len("screens.spec.js/"):] if rel.startswith("screens.spec.js/") else None
    if name is not None and fnmatch.fnmatch(name, f"*-{slug}-figure-*.png"):
        return ""
    if name is not None and fnmatch.fnmatch(name, f"*-{slug}-frame-reduced-*.png"):
        if "frame-reduced" in record.get("rebaseline", []) and record.get("rebaselineReason"):
            return ""
        return (f"{path}: a 2D default-state baseline; list \"frame-reduced\" in rebaseline, with a "
                f"rebaselineReason, in tests/figures/registry/{slug}.json to change it")
    return f"{path}: not {slug}'s baseline"


def check(slug: str, base: str, repo: Path = ROOT, registry: Path = REGISTRY) -> list[str]:
    path = registry / f"{slug}.json"
    if not path.is_file():
        return [f"no registry file for {slug} ({path.relative_to(repo) if path.is_relative_to(repo) else path})"]
    record = json.loads(path.read_text(encoding="utf-8"))
    return [why for why in (allowed(slug, p, record) for p in changed_baselines(base, repo)) if why]


def main(argv: list[str]) -> int:
    base = argv[argv.index("--base") + 1] if "--base" in argv else BASE
    args = [a for i, a in enumerate(argv) if a != "--base" and (i == 0 or argv[i - 1] != "--base")]
    if not args:
        changed = changed_baselines(base)
        for path in changed:
            print(f"check-baselines: changed {path}")
        print(f"check-baselines: {len(changed)} baseline(s) changed against {base}")
        return 1 if changed else 0
    problems = check(args[0], base)
    for problem in problems:
        print(f"check-baselines: {problem}")
    if problems:
        return 1
    print(f"check-baselines: ok ({args[0]})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
