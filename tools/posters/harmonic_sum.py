"""Fallback image for the harmonic-sum figure (docs/11-synthesis.md).

The flat view for the figure's default frame (lj-b, the top frame by
steadyScore), every harmonic, random phases with re-roll 0: the amplitude
stems above, two periods of the sum below, drawn over the zero-phase pulse.
The newest harmonic, the last under the cutoff, carries the highlight and
its chip, as in the live figure ("newest: harmonic k").
Mirrors docs/javascripts/lib/harmonics.js, lib/picks.js and lib/prng.js, so
the image shows the same numbers the live figure does. Generic display DSP
on one frame's precomputed values; it reads no hex.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

CLIP = "lj-b"
CUTOFF_HZ = 3700
CUTOFF_TEXT = "Cutoff at 3.7 kHz"
BIN_HZ = 31.25
PERIOD_SAMPLES = 512
PHASE_SEED = 0x20260810


def mulberry32(seed: int):
    """The generator in lib/prng.js, in 32-bit integer arithmetic."""
    state = seed & 0xFFFFFFFF

    def imul(a: int, b: int) -> int:
        return (a * b) & 0xFFFFFFFF

    def draw() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(state ^ (state >> 15), 1 | state)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return draw


def steady_score(frame: dict) -> float:
    d = frame["derived"]
    return d["decoded_f0_confidence"] * min(d["band_voicing"][:6])


def top_frame(frames: list[dict]) -> dict:
    pitched = [f for f in frames if f["derived"]["orig_f0_hz"] > 0]
    return sorted(pitched, key=lambda f: (-steady_score(f), f["i"]))[0]


def amplitudes(row: list[float], f0: float, count: int) -> list[float]:
    a = [0.0] * (count + 1)
    for b in range(1, len(row)):
        k = round(b * BIN_HZ / f0)
        if 1 <= k <= count:
            a[k] = max(a[k], 10 ** (row[b] / 20))
    return a


def phases(count: int, random: bool) -> list[float]:
    out = [0.0] * (count + 1)
    if random:
        draw = mulberry32(PHASE_SEED)
        for k in range(1, count + 1):
            out[k] = 2 * math.pi * draw()
    return out


def period(a: list[float], phi: list[float]) -> list[float]:
    m_count = PERIOD_SAMPLES
    return [sum(a[k] * math.cos(2 * math.pi * k * m / m_count + phi[k]) for k in range(1, len(a)) if a[k])
            for m in range(m_count)]


def draw(poster, data_dir: Path) -> None:
    frames = json.loads((data_dir / CLIP / "frames.json").read_text(encoding="utf-8"))["frames"]
    spectra = json.loads((data_dir / CLIP / "spectra.json").read_text(encoding="utf-8"))["original"]
    frame = top_frame(frames)
    f0 = frame["derived"]["orig_f0_hz"]
    count = math.floor(CUTOFF_HZ / f0)
    a = amplitudes(spectra[frame["i"]], f0, count)
    zero = period(a, phases(count, False))
    rand = period(a, phases(count, True))
    total = sum(a) or 1.0
    top = max(a) or 1.0

    poster.text((64, 36), "One frame, rebuilt from its harmonics", 30, "--ambe-text", weight="semibold")
    poster.text((64, 80), f"{count} harmonics at f0 {f0:.1f} Hz, random phases, over the pulse every phase at zero makes",
                18, "--ambe-text-3")

    # Stems: amplitude of each harmonic, 0 to 4 kHz.
    left, right = 110, 1216
    s_top, s_bottom = 150, 300
    poster.text((64, 120), "Amplitude of each harmonic", 17, "--ambe-text-3")
    poster.line([(left, s_bottom), (right, s_bottom)], "--ambe-plot-axis", width=1)

    def fx(hz: float) -> float:
        return left + (right - left) * hz / 4000

    for khz in range(5):
        x = fx(khz * 1000)
        poster.line([(x, s_bottom), (x, s_bottom + 6)], "--ambe-plot-axis", width=1)
        poster.text((x - 6, s_bottom + 10), f"{khz} kHz" if khz == 4 else str(khz), 15, "--ambe-plot-muted")
    poster.text((fx(2000) - 50, s_bottom + 30), "frequency (kHz)", 15, "--ambe-plot-muted")
    cx = fx(CUTOFF_HZ)
    for y in range(s_top, s_bottom, 10):
        poster.line([(cx, y), (cx, y + 5)], "--ambe-plot-muted", width=1)
    poster.text((cx - 62, s_top - 4), "3.7 kHz", 15, "--ambe-plot-muted")
    for k in range(1, count + 1):
        x = fx(k * f0)
        y = s_bottom - (s_bottom - s_top) * a[k] / (top * 1.12)
        if k == count:
            # The newest harmonic: thicker, in the highlight, with its chip.
            poster.line([(x, s_bottom), (x, y)], "--ambe-highlight", width=4)
            poster.dot((x, y), 6, "--ambe-highlight")
            chip = f"newest: harmonic {count}"
            width = poster.font(15).getlength(chip) + 20
            box = (x - width - 14, y - 72, x - 14, y - 46)
            poster.line([(x - 14, box[3] - 4), (x - 3, y - 7)], "--ambe-highlight", width=2)
            poster.rect(box, "--ambe-highlight-chip")
            poster.rect(box, "--ambe-highlight", fill=False, width=2)
            poster.text((box[0] + 10, box[1] + 5), chip, 15, "--ambe-text")
        else:
            poster.line([(x, s_bottom), (x, y)], "--ambe-data-1", width=2)
            poster.dot((x, y), 4, "--ambe-data-1")

    # The sum over two periods, on the figure's fixed scale.
    w_top, w_bottom = 400, 640
    mid = (w_top + w_bottom) / 2
    half = (w_bottom - w_top) / 2 / 1.05
    poster.text((64, 370), "Their sum, two periods", 17, "--ambe-text-3")
    poster.line([(left, mid), (right, mid)], "--ambe-plot-grid", width=1)
    poster.line([((left + right) / 2, w_top), ((left + right) / 2, w_bottom)], "--ambe-plot-grid", width=1)
    poster.line([(left, w_bottom), (right, w_bottom)], "--ambe-plot-axis", width=1)

    def curve(values: list[float]) -> list[tuple[float, float]]:
        n = 2 * PERIOD_SAMPLES
        return [(left + (right - left) * j / n, mid - half * values[j % PERIOD_SAMPLES] / total) for j in range(n + 1)]

    ghost = curve(zero)
    for j in range(0, len(ghost) - 1, 8):
        poster.line(ghost[j:j + 5], "--ambe-plot-muted", width=2)
    poster.polyline(curve(rand), "--ambe-plot-ink", width=2)
    poster.text(((left + right) / 2 - 90, w_bottom + 10), "time, two periods (t = 0 at centre)", 15, "--ambe-plot-muted")

    poster.text((64, 684), f"{CUTOFF_TEXT} and phases are illustrative; an MBE frame carries no phases (US 5,701,390). "
                "Amplitudes derived from the input audio.", 15, "--ambe-text-4")
