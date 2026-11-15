"""harmonic_triples.py: the Speech dots of the vq-space figure (ch09).

Writes docs/assets/data/harmonic-triples.json: for every voiced frame of the
eight input clips, the levels of harmonics 4, 5 and 6, each against the
frame's mean over all its harmonics. A precomputed scatter of per-frame
measurements from the input audio, plotted and never sequenced or sounded
(owner decision O3). No codebook is trained on these points, here or in the
browser. Provenance: derived-input (from the Piper TTS input clips, not from
the chip and not from the decoded audio).

Recipe (three-everywhere design §5.10):

  - frames whose input pitch is above 0 Hz with confidence at least 0.35
    (orig_f0_hz, orig_f0_confidence in frames.json);
  - harmonic k's level is the largest bin of the input spectrum
    (spectra.json `original`) whose nearest harmonic is k, as
    harmonicAmplitudes() in docs/javascripts/lib/harmonics.js assigns bins,
    for k from 1 to floor(3968.75 / f0), the harmonics a bin reaches;
  - a frame whose harmonic 4, 5 or 6 sits on the -100 dBFS floor is dropped;
  - each of the three is taken against the mean of all the frame's harmonic
    levels, the three columns are centred on their means, clamped to
    +-30 dB, and stored as integers in 0.1 dB.

It checks the numbers the chapter states: 702 frames; a 4-bit grid (2 bits
a number, harmonics 4 and 5) leaves 4 of 16 squares empty and a 6-bit grid
36 of 64 cubes; the spreads along the principal axes are 21.3, 5.8 and 3.6
dB. It prints how many values the clamp moved.

Run by tools/make-data.py after the clips, or alone:
    uv run --group data python tools/data/harmonic_triples.py
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np

CLIPS = ["lj-a", "lj-b", "lj-c", "lj-d", "lr-a", "lr-b", "lr-c", "lr-d"]
HARMONICS = (4, 5, 6)
CONFIDENCE = 0.35
BIN_HZ = 31.25
TOP_BIN_HZ = 127 * BIN_HZ  # 3968.75, the highest bin
FLOOR_DB = -100
RANGE_DB = 30
FRAMES = 702
EMPTY = {(2, 4): 4, (3, 6): 36}
SPREAD_DB = (21.3, 5.8, 3.6)
OUT = "harmonic-triples.json"


def harmonic_levels(row, f0):
    """dBFS of harmonics 1..L: the largest bin whose nearest harmonic is k."""
    top = int(TOP_BIN_HZ // f0)
    levels = {}
    for b in range(1, len(row)):
        k = round(b * BIN_HZ / f0)
        if 1 <= k <= top:
            levels[k] = max(levels.get(k, FLOOR_DB), row[b])
    return levels


def triples(data_dir):
    """The raw triples (dB against the frame mean), in clip and frame order, and their clip ids."""
    rows = []
    owners = []
    for clip in CLIPS:
        with open(os.path.join(data_dir, clip, "frames.json")) as f:
            frames = json.load(f)["frames"]
        with open(os.path.join(data_dir, clip, "spectra.json")) as f:
            spectra = json.load(f)["original"]
        for frame, row in zip(frames, spectra):
            derived = frame["derived"]
            f0 = derived["orig_f0_hz"]
            if not (f0 > 0 and derived["orig_f0_confidence"] >= CONFIDENCE):
                continue
            levels = harmonic_levels(row, f0)
            if not all(levels.get(k, FLOOR_DB) > FLOOR_DB for k in HARMONICS):
                continue
            mean = sum(levels.values()) / len(levels)
            rows.append([levels[k] - mean for k in HARMONICS])
            owners.append(clip)
    return np.array(rows, dtype=float), owners


def empty_cells(points, dims, bits):
    """Cells of a grid with bits / dims bits a number over +-RANGE_DB that hold no point."""
    m = 2 ** (bits // dims)
    q = np.minimum(m - 1, np.floor((points[:, :dims] / RANGE_DB + 1) / 2 * m)).astype(int)
    return m ** dims - len({tuple(r) for r in q})


def build(data_dir):
    raw, owners = triples(data_dir)
    centred = raw - raw.mean(axis=0)
    clamped = np.clip(centred, -RANGE_DB, RANGE_DB)
    moved = int((np.abs(centred) > RANGE_DB).sum())
    tenths = np.round(clamped * 10).astype(int)
    stored = tenths / 10.0
    if len(stored) != FRAMES:
        raise SystemExit(f"harmonic_triples: {len(stored)} frames, expected {FRAMES}")
    for (dims, bits), want in EMPTY.items():
        got = empty_cells(stored, dims, bits)
        if got != want:
            raise SystemExit(f"harmonic_triples: {got} of {2 ** bits} cells empty at {bits} bits, expected {want}")
    values, vectors = np.linalg.eigh(np.cov(centred.T))
    order = np.argsort(values)[::-1]
    spread = [round(float(np.sqrt(values[i])), 1) for i in order]
    if tuple(spread) != SPREAD_DB:
        raise SystemExit(f"harmonic_triples: spreads {spread} dB, expected {list(SPREAD_DB)}")
    axis = vectors[:, order[0]]
    if axis[0] < 0:
        axis = -axis
    print(f"  harmonic_triples: {len(stored)} frames, {moved} values clamped to +-{RANGE_DB} dB")
    return {
        "schema": "how-ambe-works/harmonic-triples/1",
        "provenance": "derived-input: levels of harmonics 4, 5 and 6 measured on the Piper TTS input "
                      "clips' spectra (spectra.json original), not read from the chip or its decoded "
                      "audio. Plotted only: never sequenced, sounded, or used to train a codebook.",
        "clips": CLIPS,
        "harmonics": list(HARMONICS),
        "units": "0.1 dB, each harmonic against the frame's mean over all its harmonics, centred",
        "range_db": RANGE_DB,
        "frames": len(stored),
        "clamped": moved,
        "spread_db": spread,
        "axis": [round(float(v), 4) for v in axis],
        "frames_per_clip": {c: owners.count(c) for c in CLIPS},
        # Sorted, so the file holds a scatter and not a sequence of frames.
        "points": [v for row in sorted(tenths.tolist()) for v in row],
    }


def main(out_dir):
    doc = build(out_dir)
    path = os.path.join(out_dir, OUT)
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")
    print("  wrote %-28s %7.1f kB" % (OUT, os.path.getsize(path) / 1024.0))


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "..", "docs", "assets", "data"))
