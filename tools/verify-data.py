#!/usr/bin/env python3
"""Check the precomputed data the figures depend on.

    python3 tools/verify-data.py [--docs docs]

Checks, with one line per problem and exit 1 on any:

  - SCHEMA.md marks exactly one field **MEASURED**, and it is `hex`;
  - every clip in clips.json has frames.json, spectra.json and waveform.json
    with matching frame counts, its two WAVs exist, and every hex is 18
    lowercase hex characters;
  - for every figure host in docs/*.md that lists clips in data-clips, each
    clip has frames for every criterion the figure uses, and for `steady`
    and `steady-pitched` the 4th-best steadyScore is at least 0.70 (design
    §2, frame selection).

A figure declares its criteria in FIGURE_CRITERIA; the picks mirror
docs/javascripts/lib/picks.js. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent

STEADY_MIN = 0.70
STEADY_RANK = 4
VOWEL_MIN = 0.50
SILENCE_MAX_DBFS = -60.0

# figure slug -> criteria its pickers use. The picks mirror
# docs/javascripts/lib/picks.js.
FIGURE_CRITERIA: dict[str, list[str]] = {
    "harmonic-sum": ["steady-pitched"],
    "voicing": ["vowel", "fricative", "mixed"],
    "frame-path": ["vowel", "fricative", "silence"],
}

HEX = re.compile(r"[0-9a-f]{18}")


def steady_score(frame: dict) -> float:
    """decoded_f0_confidence x the weakest of the six lowest band strengths.

    Both factors come from the chip's decoded audio, so the score mixes no
    provenances (design §2).
    """
    derived = frame["derived"]
    return derived["decoded_f0_confidence"] * min(derived["band_voicing"][:6])


def _steady(frames: list[dict]) -> list[dict]:
    return sorted(frames, key=steady_score, reverse=True)


def _steady_pitched(frames: list[dict]) -> list[dict]:
    """_steady over the frames with an input f0 (topSteadyPitched in picks.js)."""
    return _steady([f for f in frames if f["derived"]["orig_f0_hz"] > 0])


def _mixed(frames: list[dict]) -> list[dict]:
    def voiced(frame: dict) -> int:
        return sum(1 for flag in frame["derived"]["band_voiced"] if flag)

    picked = [f for f in frames if voiced(f) >= 3 and len(f["derived"]["band_voiced"]) - voiced(f) >= 2]
    return sorted(picked, key=lambda f: f["derived"]["decoded_f0_confidence"], reverse=True)


def _fricative(frames: list[dict]) -> list[dict]:
    return [f for f in frames
            if not any(f["derived"]["band_voiced"]) and f["derived"]["orig_rms_dbfs"] > -40]


def _vowel(frames: list[dict]) -> list[dict]:
    return [f for f in _steady(frames) if steady_score(f) >= VOWEL_MIN]


def _silence(frames: list[dict]) -> list[dict]:
    quiet = [f for f in frames if f["derived"]["orig_rms_dbfs"] <= SILENCE_MAX_DBFS]
    return sorted(quiet, key=lambda f: (f["derived"]["orig_rms_dbfs"], f["i"]))


CRITERIA: dict[str, Callable[[list[dict]], list[dict]]] = {
    "steady": _steady,
    "steady-pitched": _steady_pitched,
    "mixed": _mixed,
    "fricative": _fricative,
    "vowel": _vowel,
    "silence": _silence,
}


# Checks a figure adds for its own data files: each takes docs/ and returns
# problems, one line each.
EXTRA_CHECKS: list[Callable[[Path], list[str]]] = []

# One block per figure that adds criteria or a data check (three-everywhere
# plan). A block registers its additions: FIGURE_CRITERIA["<slug>"] = [...],
# CRITERIA["<name>"] = function, EXTRA_CHECKS.append(function).

# slot: utterance-spectra
import math  # noqa: E402  (this block's own import, kept inside its slot)

# utterance-spectra picks windows from spectra.json, not frames.json, so its
# criteria run here as a check of their own rather than through
# FIGURE_CRITERIA. They mirror SPECTRA_PICKS in docs/javascripts/lib/picks.js:
# the loudest window above -60 dBFS in total with more than half its power
# below 1 kHz (low-heavy) or at or above 2 kHz (high-heavy). The steps in
# docs/01-why-sinusoids.md use low-heavy on every clip the figure offers and
# high-heavy on lj-c; lj-d and lr-d have no high-heavy window, which is why
# no step asks for one there.
SPECTRA_GATE_DBFS = -60.0
SPECTRA_CLIPS = [f"{voice}-{sentence}" for voice in ("lj", "lr") for sentence in ("c", "a", "d")]
SPECTRA_NEEDS = {clip: ["low-heavy"] for clip in SPECTRA_CLIPS} | {"lj-c": ["low-heavy", "high-heavy"]}


def total_db(bins: list[float]) -> float:
    """A window's total power in dBFS (totalDb in picks.js)."""
    power = sum(10 ** (db / 10) for db in bins)
    return 10 * math.log10(power or 1e-12)


def _spectra_heavy(in_band: Callable[[float], bool]) -> Callable[[list[list[float]], list[float]], int | None]:
    def pick(frames: list[list[float]], hz: list[float]) -> int | None:
        best, loudest = None, -math.inf
        for i, bins in enumerate(frames):
            total = total_db(bins)
            if total <= SPECTRA_GATE_DBFS or total <= loudest:
                continue
            powers = [10 ** (db / 10) for db in bins]
            if sum(p for p, f in zip(powers, hz) if in_band(f)) > sum(powers) / 2:
                best, loudest = i, total
        return best
    return pick


SPECTRA_PICKS: dict[str, Callable[[list[list[float]], list[float]], int | None]] = {
    "low-heavy": _spectra_heavy(lambda f: f < 1000),
    "high-heavy": _spectra_heavy(lambda f: f >= 2000),
}


def _check_spectra_picks(docs: Path) -> list[str]:
    problems = []
    for clip, names in SPECTRA_NEEDS.items():
        path = docs / "assets" / "data" / clip / "spectra.json"
        if not path.is_file():
            problems.append(f"utterance-spectra: {clip}/spectra.json is missing")
            continue
        spectra = _load(path)
        for name in names:
            if SPECTRA_PICKS[name](spectra["original"], spectra["bin_centre_hz"]) is None:
                problems.append(f"utterance-spectra: clip {clip} has no {name} window; "
                                "change the step in docs/01-why-sinusoids.md or regenerate")
    return problems


EXTRA_CHECKS.append(_check_spectra_picks)
# end slot: utterance-spectra

# slot: envelope
VOICED_STRETCH_MIN = 10


def _strong_voiced(frame: dict) -> bool:
    """strongVoiced in picks.js: voiced, input f0 at 60% confidence, above -32 dBFS."""
    d = frame["derived"]
    return d["voiced"] and d["orig_f0_hz"] > 0 and d["orig_f0_confidence"] >= 0.6 and d["orig_rms_dbfs"] > -32


def voiced_stretch(frames: list[dict]) -> tuple[tuple[int, int], int] | None:
    """voicedStretch in picks.js: the longest run of strong voiced frames
    (the first on a tie) and its most confidently pitched frame (the first
    on a tie), as frame indices."""
    best: tuple[int, int] | None = None
    start = -1
    for k in range(len(frames) + 1):
        if k < len(frames) and _strong_voiced(frames[k]):
            if start < 0:
                start = k
            continue
        if start >= 0 and (best is None or k - 1 - start > best[1] - best[0]):
            best = (start, k - 1)
        start = -1
    if best is None:
        return None
    pick = best[0]
    for k in range(best[0], best[1] + 1):
        if frames[k]["derived"]["orig_f0_confidence"] > frames[pick]["derived"]["orig_f0_confidence"]:
            pick = k
    return (frames[best[0]]["i"], frames[best[1]]["i"]), frames[pick]["i"]


def _voiced_stretch(frames: list[dict]) -> list[dict]:
    """The run's frames, for the per-clip check; empty when there is none."""
    found = voiced_stretch(frames)
    if found is None:
        return []
    (first, last), _ = found
    return [f for f in frames if first <= f["i"] <= last]


def _check_envelope(docs: Path) -> list[str]:
    """The envelope host reads the featured clip (assets/data/frames.json),
    with no data-clips, so its run is checked here."""
    frames = _load(docs / "assets" / "data" / "frames.json")["frames"]
    run = _voiced_stretch(frames)
    if len(run) < VOICED_STRETCH_MIN:
        return [f"envelope: assets/data/frames.json has a voiced stretch of {len(run)} frames, "
                f"fewer than {VOICED_STRETCH_MIN}"]
    return []


# The envelope host carries no data-clips (it reads the featured clip), so
# it takes no FIGURE_CRITERIA entry; _check_envelope checks its run.
CRITERIA["voiced-stretch"] = _voiced_stretch
EXTRA_CHECKS.append(_check_envelope)
# end slot: envelope

# slot: gain-definitions
def _check_gain_definitions(docs: Path) -> list[str]:
    """When a chapter carries the gain-definitions host: its picks
    (lib/picks.js GAIN_PICKS, equalSpreadPair) find a frame in every clip,
    and the numbers it states hold (tools/gain-stats.py PINNED). Its host
    lists no data-clips: the figure offers all eight clips."""
    if not any('data-anim="gain-definitions"' in p.read_text(encoding="utf-8") for p in docs.glob("*.md")):
        return []
    import importlib.util

    spec = importlib.util.spec_from_file_location("gain_stats", ROOT / "tools" / "gain-stats.py")
    gain = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gain)
    data = docs / "assets" / "data"
    problems = []
    for cid in gain.clip_ids(data):
        frames = gain.gain_frames(data, [cid])
        for name, pick in (("flattest", gain.flattest), ("steepest", gain.steepest)):
            if pick(frames) is None:
                problems.append(f"gain-definitions: clip {cid} has no frame for criterion {name}")
    if gain.equal_spread_pair(gain.gain_frames(data)) is None:
        problems.append("gain-definitions: no two frames share a spread (criterion equal-spread)")
    return problems + gain.check(data)


EXTRA_CHECKS.append(_check_gain_definitions)
# end slot: gain-definitions

# slot: vq-space
def _check_harmonic_triples(docs: Path) -> list[str]:
    """vq-space's Speech dots (tools/data/harmonic_triples.py): 702 triples
    within +-30 dB, and the empty counts the chapter states."""
    path = docs / "assets" / "data" / "harmonic-triples.json"
    if not path.is_file():
        return [f"{path}: missing (tools/data/harmonic_triples.py writes it)"]
    doc = _load(path)
    points = doc.get("points", [])
    problems = []
    if doc.get("schema") != "how-ambe-works/harmonic-triples/1":
        problems.append(f"{path.name}: schema {doc.get('schema')!r}")
    if len(points) != 3 * 702 or doc.get("frames") != 702:
        problems.append(f"{path.name}: {len(points) // 3} triples, expected 702")
    if any(not isinstance(v, int) or abs(v) > 300 for v in points):
        problems.append(f"{path.name}: a value is not an integer within +-300 (0.1 dB)")
    rows = [points[i:i + 3] for i in range(0, len(points) - 2, 3)]
    for dims, bits, want in ((2, 4, 4), (3, 6, 36)):
        m = 2 ** (bits // dims)
        cells = {tuple(min(m - 1, int((v / 300 + 1) / 2 * m)) for v in row[:dims]) for row in rows}
        if m ** dims - len(cells) != want:
            problems.append(f"{path.name}: {m ** dims - len(cells)} of {m ** dims} cells empty at {bits} bits, "
                            f"the chapter says {want}")
    if doc.get("spread_db") != [21.3, 5.8, 3.6]:
        problems.append(f"{path.name}: spreads {doc.get('spread_db')}, the chapter says [21.3, 5.8, 3.6]")
    return problems


EXTRA_CHECKS.append(_check_harmonic_triples)
# end slot: vq-space

# slot: pitch-search
def _check_correlogram(docs: Path) -> list[str]:
    """pitch-search (tools/data/correlogram.py): the stored window gives the
    scores the chapter states, and the rows and the track have their shape."""
    import math  # here, inside this figure's slot

    path = docs / "assets" / "data" / "lr-b" / "correlogram.json"
    if not path.is_file():
        return [f"{path}: missing (tools/data/correlogram.py writes it)"]
    doc = _load(path)
    problems = []
    if doc.get("schema") != "how-ambe-works/correlogram/1":
        problems.append(f"{path.name}: schema {doc.get('schema')!r}")
    lags = doc.get("lag_max", 0) - doc.get("lag_min", 0) + 1
    rows = doc.get("rows", [])
    frames = doc.get("frames", 0)
    if (doc.get("lag_min"), doc.get("lag_max")) != (22, 114) or len(rows) != frames * lags:
        problems.append(f"{path.name}: {len(rows)} row values for {frames} frames of lags 22 to 114")
    if any(not isinstance(v, int) or not 0 <= v <= 100 for v in rows):
        problems.append(f"{path.name}: a row value is not an integer percent from 0 to 100")
    if len(doc.get("tracker_period", [])) != frames:
        problems.append(f"{path.name}: tracker_period has {len(doc.get('tracker_period', []))} values, not {frames}")
    window = doc.get("window", {})
    s = window.get("samples", [])
    n = len(s)
    if n != 255 or window.get("frame") != 8:
        return problems + [f"{path.name}: the window is {n} samples of frame {window.get('frame')}, not 255 of frame 8"]
    # The figure's score on the stored window (lib/pitch.js): Hamming w,
    # phi of w^2 s over phi(0), Psi(P) = P x sum of phi(kP), k >= 1.
    v = [(0.54 - 0.46 * math.cos(2 * math.pi * i / (n - 1))) ** 2 * s[i] for i in range(n)]
    phi = [sum(v[i] * v[i + m] for i in range(n - m)) for m in range(n)]
    phi = [p / phi[0] for p in phi]
    score = {P: P * sum(phi[k * P] for k in range(1, (n - 1) // P + 1)) for P in range(22, 115)}
    best = max(score, key=score.get)
    got = (best, round(score[best], 2), round(score[23], 2), round(100 * score[23] / score[best]))
    if got != (46, 44.45, 34.92, 79):
        problems.append(f"{path.name}: best P, Psi, Psi(23), share are {got}, the chapter says (46, 44.45, 34.92, 79)")
    period = doc.get("tracker_period", [])
    if doc.get("corridor_exit") != 67 or len(period) < 68 or (round(period[66], 1), round(period[67], 1)) != (41.8, 57.3):
        problems.append(f"{path.name}: the track leaves its 20% corridor at frame {doc.get('corridor_exit')}, "
                        "the figure says 67 (41.8 to 57.3 samples)")
    return problems


EXTRA_CHECKS.append(_check_correlogram)
# end slot: pitch-search


class _Hosts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hosts: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        found = {key: value or "" for key, value in attrs}
        if "data-anim" in found:
            self.hosts.append(found)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _check_schema(data: Path) -> list[str]:
    measured = []
    for line in (data / "SCHEMA.md").read_text(encoding="utf-8").splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if line.lstrip().startswith("|") and "**MEASURED**" in cells:
            measured.append(cells[0].strip("`"))
    if measured != ["hex"]:
        return [f"SCHEMA.md marks {measured} as **MEASURED**; exactly one field, `hex`, may be. "
                "If the schema changed on purpose, revisit badges.spec.js and this check."]
    return []


def _check_clip(docs: Path, clip: dict) -> list[str]:
    problems = []
    cid = clip["id"]
    folder = docs / "assets" / "data" / cid
    names = ("frames.json", "spectra.json", "waveform.json")
    missing = [name for name in names if not (folder / name).is_file()]
    if missing:
        return [f"{cid}: missing {', '.join(missing)}"]
    frames = _load(folder / "frames.json")["frames"]
    spectra = _load(folder / "spectra.json")
    for frame in frames:
        if not HEX.fullmatch(frame["hex"]):
            problems.append(f"{cid}/frames.json: frame {frame['i']} hex {frame['hex']!r} "
                            "is not 18 lowercase hex characters")
    for key in ("original", "decoded"):
        if len(spectra[key]) != len(frames):
            problems.append(f"{cid}/spectra.json: {key} has {len(spectra[key])} frames, "
                            f"frames.json has {len(frames)}")
    for key in ("original_audio", "decoded_audio"):
        if not (docs / clip[key]).is_file():
            problems.append(f"{cid}: {clip[key]} is missing")
    return problems


def check(docs: Path, figure_criteria: dict[str, list[str]]) -> list[str]:
    data = docs / "assets" / "data"
    problems = _check_schema(data)
    clips = {clip["id"]: clip for clip in _load(data / "clips.json")["clips"]}
    for clip in clips.values():
        problems += _check_clip(docs, clip)
    for extra in EXTRA_CHECKS:
        problems += extra(docs)

    for chapter in sorted(docs.glob("*.md")):
        parser = _Hosts()
        parser.feed(chapter.read_text(encoding="utf-8"))
        where = f"docs/{chapter.name}"
        for host in parser.hosts:
            listed = [c.strip() for c in host.get("data-clips", "").split(",") if c.strip()]
            if not listed:
                continue
            slug = host["data-anim"]
            criteria = figure_criteria.get(slug)
            if criteria is None:
                problems.append(f"{slug} ({where}): has data-clips but no FIGURE_CRITERIA entry "
                                "in tools/verify-data.py")
                continue
            for cid in listed:
                if cid not in clips:
                    problems.append(f"{slug}: clip {cid} is not in assets/data/clips.json ({where})")
                    continue
                frames = _load(data / cid / "frames.json")["frames"]
                for name in criteria:
                    picked = CRITERIA[name](frames)
                    fix = f"drop it from data-clips in {where} or regenerate"
                    if not picked:
                        problems.append(f"{slug}: clip {cid} has no frames for criterion {name}; {fix}")
                    elif name in ("steady", "steady-pitched"):
                        score = steady_score(picked[STEADY_RANK - 1]) if len(picked) >= STEADY_RANK else 0.0
                        if score < STEADY_MIN:
                            problems.append(f"{slug}: clip {cid} {STEADY_RANK}th-best steadyScore "
                                            f"{score:.2f} < {STEADY_MIN:.2f}; {fix}")
    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--docs", type=Path, default=ROOT / "docs")
    args = parser.parse_args(argv)
    problems = check(args.docs, FIGURE_CRITERIA)
    for problem in problems:
        print(f"verify-data: {problem}")
    if problems:
        return 1
    print("verify-data: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
