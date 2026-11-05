#!/usr/bin/env python3
"""Two gain definitions on every voiced frame of the chip's decoded audio.

    python3 tools/gain-stats.py           # print the figure's numbers
    python3 tools/gain-stats.py --check   # exit 1 if they differ from PINNED
    python3 tools/gain-stats.py --json    # one record per eligible frame

The numbers behind the gain-definitions figure on
docs/13-what-is-not-established.md. For each frame of each clip:

  - A_k, k = 1..L, from the decoded track of spectra.json the way
    lib/harmonics.js harmonicAmplitudes() reads it: each bin goes to its
    nearest harmonic, round(bin x 31.25 / f0), and A_k is the largest bin
    given to k. L = floor(3700 / f0), lib/cutoff.js;
  - G_E = 10 log10(mean of 10^(A_k / 10)), the log of the mean energy;
  - G_L = mean of A_k, the mean of the log magnitudes;
  - sigma = the standard deviation of A_k (over L, not L - 1), dB;
  - gap = G_E - G_L, never below 0 (the arithmetic mean of the energies is
    at least their geometric mean).

A frame counts when the decoded audio's tracker calls it voiced with an
f0, the input is at least -40 dBFS, and no A_k is at or below -99 dBFS:
the spectra stop at -100, and a clamped level would weigh in G_L as much
as the loudest harmonic. Percentiles interpolate linearly, as numpy's
default does. The picks mirror lib/picks.js (GAIN_PICKS, equalSpreadPair).

Generic DSP on precomputed spectra of the decoded audio: no codec state,
no hex, no audio. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "assets" / "data"

BIN_HZ = 31.25
CUTOFF_HZ = 3700
MIN_RMS_DBFS = -40.0
FLOOR_DB = -99.0
SPREAD_TOLERANCE = 0.25

# What the figure and the chapter say, to one decimal (r to two).
PINNED = {
    "frames": 661,
    "gap_min": 1.1,
    "gap_max": 36.9,
    "gap_p10": 8.3,
    "gap_p50": 19.1,
    "gap_p90": 27.6,
    "sigma_p10": 9.5,
    "sigma_p50": 14.1,
    "sigma_p90": 19.5,
    "r": 0.87,
    "flattest": "lr-a 36",
    "steepest": "lj-a 28",
    "equal_spread": "lr-a 96 / lj-c 52",
    # The numbers ch13's steps and alt text state.
    "flattest_reach": 8.1,
    "pair_sigma": "18.4 / 18.5",
    "pair_gap": "36.9 / 17.7",
    "pair_gap_apart": 19.2,
    "band_15_20_gap": "12.2 to 36.9",
}


def clip_ids(data: Path = DATA) -> list[str]:
    return [clip["id"] for clip in json.loads((data / "clips.json").read_text(encoding="utf-8"))["clips"]]


def levels(row: list[float], f0: float) -> list[float]:
    """A_k in dB, k = 1..L; -inf where no bin went to k."""
    count = math.floor(CUTOFF_HZ / f0)
    amplitude = [0.0] * (count + 1)
    for b in range(1, len(row)):
        k = round(b * BIN_HZ / f0)
        if 1 <= k <= count:
            amplitude[k] = max(amplitude[k], 10 ** (row[b] / 20))
    return [20 * math.log10(a) if a > 0 else -math.inf for a in amplitude[1:]]


def gain_frame(frame: dict, row: list[float]) -> dict | None:
    """The frame's two gains and its spread, or None if it does not count."""
    derived = frame["derived"]
    f0 = derived["decoded_f0_hz"]
    if not (derived["voiced"] and f0 > 0 and derived["orig_rms_dbfs"] >= MIN_RMS_DBFS):
        return None
    db = levels(row, f0)
    if not db or any(x <= FLOOR_DB for x in db):
        return None
    n = len(db)
    ge = 10 * math.log10(sum(10 ** (x / 10) for x in db) / n)
    gl = sum(db) / n
    sigma = math.sqrt(sum((x - gl) ** 2 for x in db) / n)
    return {"i": frame["i"], "t": frame["t"], "f0": f0, "L": n, "levels": db,
            "ge": ge, "gl": gl, "sigma": sigma, "gap": ge - gl}


def gain_frames(data: Path = DATA, clips: list[str] | None = None) -> list[dict]:
    """Every counted frame of the clips (all eight by default), in clip order."""
    order = clip_ids(data)
    out = []
    for cid in clips or order:
        frames = json.loads((data / cid / "frames.json").read_text(encoding="utf-8"))["frames"]
        rows = json.loads((data / cid / "spectra.json").read_text(encoding="utf-8"))["decoded"]
        for frame in frames:
            record = gain_frame(frame, rows[frame["i"]])
            if record:
                out.append({"clip": cid, "order": order.index(cid), **record})
    return out


def percentile(values: list[float], p: float) -> float:
    """Linear interpolation between order statistics (numpy's default)."""
    s = sorted(values)
    pos = (len(s) - 1) * p / 100
    lo = math.floor(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def pearson(xs: list[float], ys: list[float]) -> float:
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy)


def _by_spread(f: dict) -> tuple:
    return (f["sigma"], f["order"], f["i"])


def flattest(frames: list[dict]) -> dict | None:
    return min(frames, key=_by_spread, default=None)


def steepest(frames: list[dict]) -> dict | None:
    return max(frames, key=_by_spread, default=None)


def equal_spread_pair(frames: list[dict]) -> tuple[dict, dict] | None:
    """(larger gap, smaller gap) of the two frames within SPREAD_TOLERANCE in
    spread whose gaps differ most; the first in spread order wins a tie."""
    s = sorted(frames, key=_by_spread)
    best = None
    most = -1.0
    for a in range(len(s)):
        b = a + 1
        while b < len(s) and s[b]["sigma"] - s[a]["sigma"] <= SPREAD_TOLERANCE:
            d = abs(s[a]["gap"] - s[b]["gap"])
            if d > most:
                most = d
                best = (s[a], s[b]) if s[a]["gap"] >= s[b]["gap"] else (s[b], s[a])
            b += 1
    return best


def _name(f: dict) -> str:
    return f"{f['clip']} {f['i']}"


def stats(frames: list[dict]) -> dict:
    gaps = [f["gap"] for f in frames]
    sigmas = [f["sigma"] for f in frames]
    pair = equal_spread_pair(frames)
    flat = flattest(frames)
    band = [f["gap"] for f in frames if 15 <= f["sigma"] <= 20]
    return {
        "frames": len(frames),
        "gap_min": round(min(gaps), 1),
        "gap_max": round(max(gaps), 1),
        **{f"gap_p{p}": round(percentile(gaps, p), 1) for p in (10, 50, 90)},
        **{f"sigma_p{p}": round(percentile(sigmas, p), 1) for p in (10, 50, 90)},
        "r": round(pearson(sigmas, gaps), 2),
        "flattest": _name(flattest(frames)),
        "steepest": _name(steepest(frames)),
        "equal_spread": f"{_name(pair[0])} / {_name(pair[1])}" if pair else "none",
        "flattest_reach": round(max(abs(x - flat["ge"]) for x in flat["levels"]), 1),
        "pair_sigma": f"{pair[0]['sigma']:.1f} / {pair[1]['sigma']:.1f}" if pair else "none",
        "pair_gap": f"{pair[0]['gap']:.1f} / {pair[1]['gap']:.1f}" if pair else "none",
        "pair_gap_apart": round(pair[0]["gap"] - pair[1]["gap"], 1) if pair else 0,
        "band_15_20_gap": f"{min(band):.1f} to {max(band):.1f}",
    }


def check(data: Path = DATA) -> list[str]:
    """One line per number that differs from PINNED."""
    got = stats(gain_frames(data))
    return [f"gain-stats: {key} is {got[key]}, the figure says {want}"
            for key, want in PINNED.items() if got[key] != want]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.check:
        problems = check()
        for problem in problems:
            print(problem)
        if not problems:
            print("gain-stats: ok")
        return 1 if problems else 0
    frames = gain_frames()
    if args.json:
        keep = ("clip", "i", "t", "f0", "L", "ge", "gl", "sigma", "gap")
        print(json.dumps([{k: f[k] for k in keep} for f in frames], indent=1))
        return 0
    for key, value in stats(frames).items():
        print(f"{key:13} {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
