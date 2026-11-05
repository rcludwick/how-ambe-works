"""Fallback image for the envelope-blocks figure (docs/09-quantization.md).

The flat view for the figure's default frame (lr-b frame 112, the most
confidently pitched voiced frame): the harmonic amplitudes with their mean
removed as rings, the six blocks shaded, the slice that keeps two DCT
coefficients per block as the highlight, the one that keeps one (the block
means) as a staircase, and the level bar at the right, past a divider. Mirrors
docs/javascripts/anim-envelope-blocks.js, lib/dct.js and lib/harmonics.js
(envelopeAmplitudes), so the image shows the numbers the live figure does.
Generic display DSP on one frame's precomputed values; it reads no hex.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

CUTOFF_HZ = 3700
BLOCKS = 6
LEVEL_RANGE = (-100.0, 0.0)
GUTTER = 3.0


def voiced_choices(frames: list[dict]) -> tuple[list[dict], int]:
    """The frames the figure offers, and the index of its default one."""
    choices = [f for f in frames if f["derived"]["voiced"] and f["derived"]["orig_f0_hz"] > 0
               and f["derived"]["orig_f0_confidence"] >= 0.6 and f["derived"]["orig_rms_dbfs"] > -32]
    best = 0
    for i, c in enumerate(choices):
        if c["derived"]["orig_f0_confidence"] > choices[best]["derived"]["orig_f0_confidence"]:
            best = i
    return choices, best


def envelope_amplitudes(row: list[float], f0: float, bin_hz: float, top_hz: float = CUTOFF_HZ) -> list[float]:
    """lib/harmonics.js envelopeAmplitudes: the largest of the three bins nearest m f0, dBFS."""
    out = []
    m = 1
    while m * f0 <= top_hz:
        centre = round(m * f0 / bin_hz)
        out.append(max(row[k] for k in (centre - 1, centre, centre + 1) if 0 <= k < len(row)))
        m += 1
    return out


def block_sizes(length: int, count: int = BLOCKS) -> list[int]:
    n = max(1, min(count, length))
    base, extra = divmod(length, n)
    return [base + (1 if i < extra else 0) for i in range(n)]


def dct(x: list[float]) -> list[float]:
    n = len(x)
    return [math.sqrt((1 if j == 0 else 2) / n) * sum(v * math.cos(math.pi * (2 * i + 1) * j / (2 * n))
                                                       for i, v in enumerate(x)) for j in range(n)]


def idct(c: list[float]) -> list[float]:
    n = len(c)
    return [sum(math.sqrt((1 if j == 0 else 2) / n) * v * math.cos(math.pi * (2 * i + 1) * j / (2 * n))
                for j, v in enumerate(c)) for i in range(n)]


def keep(values: list[float], sizes: list[int], k: int) -> list[float]:
    out, at = [], 0
    for size in sizes:
        c = dct(values[at:at + size])
        out += idct([v if j < k else 0.0 for j, v in enumerate(c)])
        at += size
    return out


def energy_by_order(values: list[float], sizes: list[int]) -> list[float]:
    out = [0.0] * max(sizes)
    at = 0
    for size in sizes:
        for j, v in enumerate(dct(values[at:at + size])):
            out[j] += v * v
        at += size
    return out


def model(data_dir: Path) -> dict:
    frames = json.loads((data_dir / "frames.json").read_text(encoding="utf-8"))["frames"]
    spectra = json.loads((data_dir / "spectra.json").read_text(encoding="utf-8"))
    choices, best = voiced_choices(frames)
    frame = choices[best]
    f0 = frame["derived"]["orig_f0_hz"]
    amps = envelope_amplitudes(spectra["original"][frame["i"]], f0, spectra["bin_hz"])
    level = sum(amps) / len(amps)
    exact = [a - level for a in amps]
    sizes = block_sizes(len(exact))
    return {"frame": frame["i"], "f0": f0, "level": level, "exact": exact, "sizes": sizes,
            "energies": energy_by_order(exact, sizes)}


def draw(poster, data_dir: Path) -> None:
    m = model(data_dir)
    exact, sizes = m["exact"], m["sizes"]
    L = len(exact)
    one, two = keep(exact, sizes, 1), keep(exact, sizes, 2)
    total = sum(m["energies"])
    kept1 = 100 * m["energies"][0] / total
    kept2 = 100 * sum(m["energies"][:2]) / total
    lo = min(min(s) for s in (exact, one, two))
    hi = max(max(s) for s in (exact, one, two))
    y0, y1 = math.floor(lo / 5) * 5 - 5, math.ceil(hi / 5) * 5 + 5

    poster.text((64, 36), "One frame, cut into blocks, each kept to its first few DCT coefficients", 30,
                "--ambe-text", weight="semibold")
    poster.text((64, 80), f"Frame {m['frame']}, {L} harmonics at f0 {m['f0']:.1f} Hz, mean removed, "
                f"in six blocks of {', '.join(map(str, sizes))}", 18, "--ambe-text-3")

    left, right, top, bottom = 120, 1216, 140, 600

    def fx(h: float) -> float:
        return left + (right - left) * (h - 0.5) / (L + GUTTER)

    def fy(v: float) -> float:
        return bottom - (bottom - top) * (v - y0) / (y1 - y0)

    at = 1
    for b, size in enumerate(sizes):
        a, e = fx(at - 0.5), fx(at + size - 0.5)
        if b % 2 == 0:
            poster.rect((a, top, e, bottom), "--ambe-surface-2")
        poster.text(((a + e) / 2 - 26, bottom - 24), f"block {b + 1}", 15, "--ambe-plot-muted")
        at += size
    edge = fx(L + 0.5)
    poster.line([(left, fy(0)), (edge, fy(0))], "--ambe-plot-grid", width=1)
    poster.line([(edge, top), (edge, bottom)], "--ambe-plot-grid", width=1)
    poster.line([(left, bottom), (right, bottom)], "--ambe-plot-axis", width=1)
    poster.line([(left, top), (left, bottom)], "--ambe-plot-axis", width=1)
    v = math.ceil(y0 / 10) * 10
    while v <= y1:
        poster.line([(left - 5, fy(v)), (left, fy(v))], "--ambe-plot-axis", width=1)
        label = f"+{v}" if v > 0 else ("0" if v == 0 else f"−{-v}")
        poster.text((left - 48, fy(v) - 9), label, 15, "--ambe-plot-muted")
        v += 10
    for h in [1] + list(range(5, L + 1, 5)):
        poster.line([(fx(h), bottom), (fx(h), bottom + 5)], "--ambe-plot-axis", width=1)
        poster.text((fx(h) - 5, bottom + 9), str(h), 15, "--ambe-plot-muted")
    poster.text(((left + right) / 2 - 60, bottom + 30), "harmonic number", 15, "--ambe-plot-muted")

    # The level bar on its own scale, with its track, past the divider.
    f = (m["level"] - LEVEL_RANGE[0]) / (LEVEL_RANGE[1] - LEVEL_RANGE[0])
    bt = fy(y0 + max(0.0, min(1.0, f)) * (y1 - y0))
    ba, bb = fx(L + 1.5), fx(L + 2.5)
    poster.rect((ba, top, bb, bottom), "--ambe-plot-axis", fill=False)
    poster.rect((ba, bt, bb, bottom), "--ambe-plot-muted")
    poster.line([(ba, bt), (bb, bt)], "--ambe-plot-ink", width=3)
    mid = (ba + bb) / 2
    poster.rect((mid - 26, bt - 46, mid + 26, bt - 4), "--ambe-plot-bg")
    poster.text((mid - 20, bt - 44), "level", 15, "--ambe-plot-muted")
    poster.text((mid - 21, bt - 24), f"−{abs(m['level']):.1f}", 15, "--ambe-plot-ink")

    # One coefficient per block (the staircase), then two (the highlight).
    stair = [(fx(i + 1), fy(v)) for i, v in enumerate(one)]
    poster.polyline(stair, "--ambe-ramp-0", width=2)
    for p in stair:
        poster.dot(p, 3, "--ambe-ramp-0")
    for i, v in enumerate(exact):
        x, y = fx(i + 1), fy(v)
        poster.draw.ellipse((x - 5, y - 5, x + 5, y + 5), outline=poster.colour("--ambe-plot-ink"), width=2)
    kept = [(fx(i + 1), fy(v)) for i, v in enumerate(two)]
    poster.polyline(kept, "--ambe-highlight", width=5)
    for p in kept:
        poster.dot(p, 4, "--ambe-highlight")

    # The chip, as the live figure's highlight states it.
    chip = f"2 coefficients: {kept2:.1f}% of the energy"
    cx, cy = fx(8), top + 40
    poster.rect((cx, cy, cx + 330, cy + 34), "--ambe-highlight-chip")
    poster.rect((cx, cy, cx + 330, cy + 34), "--ambe-highlight", fill=False, width=2)
    poster.line([(cx + 12, cy + 17), (cx + 34, cy + 17)], "--ambe-highlight", width=4)
    poster.text((cx + 44, cy + 6), chip, 17, "--ambe-plot-ink")
    poster.text((cx + 350, cy + 6), f"staircase: 1 coefficient, {kept1:.1f}%", 17, "--ambe-ramp-0")

    poster.text((64, 668), "Rings: the frame's own amplitudes, mean removed. Amplitudes derived from the input audio; "
                "the even split and the 3.7 kHz cutoff are illustrative.", 15, "--ambe-text-4")
    poster.text((64, 690), "Blocks and a DCT per block: US 5,630,011. The D-STAR block count and lengths are not public.",
                15, "--ambe-text-4")
