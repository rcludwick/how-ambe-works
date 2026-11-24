"""Fallback image for the filter figure (docs/01-why-sinusoids.md).

A square wave at 150 Hz through the figure's two-pole low-pass at a 330 Hz
cutoff, with Rescale and realign on: the input dashed, the output scaled by
the one best gain and moved back by the one best whole-sample shift, and the
signal filtered out. The figure is 2D only, and so is its poster. Mirrors
docs/javascripts/lib/filter.js (the RBJ biquad at Q 4, the settled output in
closed form, the same alignment search), so the poster shows the numbers the
figure does. Synthetic tones; nothing measured.
"""

from __future__ import annotations

import math
from pathlib import Path

SR = 48000
F0 = 150
Q = 4
CUTOFF = 330
SHAPE = "square"
PER_CYCLE = SR // F0
MAX_HARMONIC = SR // 2 // F0


def harmonic(shape: str, k: int) -> float:
    """lib/filter.js harmonic(): the coefficient of sin(2 pi k p)."""
    if shape == "sine":
        return 1.0 if k == 1 else 0.0
    if shape == "sawtooth":
        return 2 / (math.pi * k)
    if k % 2 == 0:
        return 0.0
    if shape == "square":
        return 4 / (math.pi * k)
    return (1 if ((k - 1) // 2) % 2 == 0 else -1) * 8 / (math.pi ** 2 * k * k)


def response(hz: float, cutoff: float) -> tuple[float, float]:
    """lib/filter.js response(): |H| and arg H, continuous from 0 Hz."""
    w0 = 2 * math.pi * cutoff / SR
    alpha = math.sin(w0) / (2 * Q)
    a0 = 1 + alpha
    b0 = (1 - math.cos(w0)) / 2 / a0
    a1 = -2 * math.cos(w0) / a0
    a2 = (1 - alpha) / a0
    w = 2 * math.pi * hz / SR
    num = 4 * b0 * math.cos(w / 2) ** 2
    re = 1 + a1 * math.cos(w) + a2 * math.cos(2 * w)
    im = -(a1 * math.sin(w) + a2 * math.sin(2 * w))
    den = math.atan2(im, re)
    if den < 0:
        den += 2 * math.pi
    return num / math.hypot(re, im), -w - den


def signals(shape: str, cutoff: float) -> tuple[list[float], list[float]]:
    """Four settled cycles going in and coming out, in closed form."""
    terms = []
    for k in range(1, MAX_HARMONIC + 1):
        b = harmonic(shape, k)
        if b:
            gain, phase = response(k * F0, cutoff)
            terms.append((k, b, gain, phase))
    n = PER_CYCLE * 4
    inp = [sum(b * math.sin(2 * math.pi * k * i / PER_CYCLE) for k, b, _, _ in terms) for i in range(n)]
    out = [sum(b * g * math.sin(2 * math.pi * k * i / PER_CYCLE + p) for k, b, g, p in terms) for i in range(n)]
    return inp, out


def align(inp: list[float], out: list[float]) -> tuple[int, float, float]:
    """lib/filter.js align(): shift, gain, residual percent."""
    n = len(inp) - PER_CYCLE
    best = (0, 1.0, math.inf)
    for s in range(PER_CYCLE):
        dot = sum(out[i + s] * inp[i] for i in range(n))
        energy = sum(out[i + s] ** 2 for i in range(n))
        gain = dot / energy
        err = sum((inp[i] - gain * out[i + s]) ** 2 for i in range(n))
        tie = math.isfinite(best[2]) and abs(err - best[2]) <= 1e-9 * best[2]
        if (gain > 0 and best[1] < 0) if tie else err < best[2]:
            best = (s, gain, err)
    total = sum(inp[i] ** 2 for i in range(n))
    return best[0], best[1], math.sqrt(best[2] / total) * 100


def draw(poster, data_dir: Path) -> None:  # noqa: ARG001 (no data: synthetic)
    inp, out = signals(SHAPE, CUTOFF)
    shift, gain, pct = align(inp, out)
    n = PER_CYCLE * 3
    peak = max(max(abs(v) for v in inp), max(abs(v) for v in out)) * 1.12

    poster.text((56, 30), "Four shapes, one filter", 30, "--ambe-text", weight="semibold")
    poster.text((56, 74), f"A square at {F0} Hz through a two-pole low-pass at {CUTOFF} Hz", 18, "--ambe-text-3")

    left, right, top, bottom = 70, 1220, 170, 560
    mid = (top + bottom) / 2
    poster.text((left, 130), "Rescaled and realigned: one gain, one delay", 17, "--ambe-text-2")
    poster.line([(left, mid), (right, mid)], "--ambe-plot-grid", width=1)
    for c in range(4):
        x = left + (right - left) * c / 3
        poster.line([(x, top), (x, bottom)], "--ambe-plot-grid", width=1)
        poster.text((x - 4, bottom + 8), str(c), 15, "--ambe-plot-muted")
    poster.text(((left + right) / 2 - 22, bottom + 30), "cycles", 15, "--ambe-plot-muted")
    poster.line([(left, bottom), (right, bottom)], "--ambe-plot-axis", width=1)

    def xy(i: int, v: float) -> tuple[float, float]:
        return left + (right - left) * i / n, mid - (bottom - top) / 2 * v / peak

    dashed = [xy(i, inp[i]) for i in range(n)]
    for j in range(0, n - 1, 24):
        poster.line(dashed[j:j + 15], "--ambe-plot-muted", width=2)
    poster.polyline([xy(i, inp[i] - gain * out[i + shift]) for i in range(n)], "--ambe-accent-warm", width=2)
    poster.polyline([xy(i, gain * out[i + shift]) for i in range(n)], "--ambe-plot-ink", width=3)
    poster.text((left, 636), f"Going in, dashed. Coming out, thick. Signal filtered out, amber: {pct:.1f}% of the input.",
                16, "--ambe-text-3")

    poster.text((56, 684), "Synthetic: synthesised and filtered, nothing measured. The RBJ biquad low-pass, Q 4.",
                15, "--ambe-text-4")
