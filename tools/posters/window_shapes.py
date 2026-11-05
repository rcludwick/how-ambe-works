"""Fallback image for the window-shapes figure (docs/03-windows-and-frames.md).

One cosine (phase 0) at 6.5 cycles in a 160-sample block, the tone the
leakage figure cuts half a bin off, under three windows of one family,
w(n) = a - (1 - a) cos(2 pi n / N) with a = (1 + e) / 2, e the window's
value at the block's ends: rectangular (e = 1), Hann (e = 0) and Hamming
(e = 0.08). One row each: the plain block (dashed), the window and its
mirror (dashed), the windowed block in the highlight with a chip, the next
copy's first samples and the step at the joint (2e). Drawn in the light
tokens, as print shows the page. Mirrors docs/javascripts/lib/window-shapes.js;
synthetic, it reads no data.
"""

from __future__ import annotations

import math
from pathlib import Path

N = 160
CYCLES = 6.5
X_END = 178
WINDOWS = [("rect", "Rectangular", 1.0), ("hann", "Hann", 0.0), ("hamming", "Hamming", 0.08)]


def window_at(end: float, n: float) -> float:
    a = (1 + end) / 2
    return a - (1 - a) * math.cos(2 * math.pi * n / N)


def tone_at(n: float) -> float:
    return math.cos(2 * math.pi * CYCLES * n / N)


def windowed_at(end: float, n: float) -> float:
    return window_at(end, n) * tone_at(n)


def joint_step(end: float) -> float:
    return abs(windowed_at(end, N) - windowed_at(end, 0))


def energy_kept(end: float) -> float:
    kept = sum((window_at(end, n) * tone_at(n)) ** 2 for n in range(N))
    return kept / sum(tone_at(n) ** 2 for n in range(N))


def chip_text(title: str, end: float) -> str:
    step = joint_step(end)
    joint = "no step at the joint" if step < 0.005 else f"a step of {step:.2f} at the joint"
    return f"{title}: ends {window_at(end, 0):.2f}, middle {window_at(end, N / 2):.2f}; {joint}"


def dashed(poster, points, name: str, width: int, dash: float = 7, gap: float = 5) -> None:
    """A polyline drawn as dashes `dash` px long with `gap` px between."""
    on, left = True, dash
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        length = math.hypot(x1 - x0, y1 - y0)
        t = 0.0
        while t < length:
            run = min(left, length - t)
            if on:
                a = t / length
                b = (t + run) / length
                poster.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)],
                            name, width)
            t += run
            left -= run
            if left <= 1e-9:
                on = not on
                left = dash if on else gap


def draw(poster, data_dir: Path) -> None:
    poster.text((48, 26), "Three windows, one block", 30, "--ambe-text", weight="semibold")
    poster.text((48, 68), "A cosine at 6.5 cycles in a 160-sample block, under three windows", 18, "--ambe-text-3")

    left, right = 210, 1232
    for row, (_, title, end) in enumerate(WINDOWS):
        top = 124 + row * 184
        bottom = top + 142
        mid = (top + bottom) / 2
        half = (bottom - top) / 2 / 1.3

        def px(n: float) -> float:
            return left + n / X_END * (right - left)

        def py(v: float) -> float:
            return mid - v * half

        poster.text((48, top + 8), title, 22, "--ambe-text", weight="semibold")
        poster.text((48, top + 40), f"ends {window_at(end, 0):.2f}", 16, "--ambe-text-2")
        poster.text((48, top + 62), f"middle {window_at(end, N / 2):.2f}", 16, "--ambe-text-2")
        poster.text((48, top + 84), f"energy kept {energy_kept(end) * 100:.1f}%", 16, "--ambe-text-2")
        poster.rect((px(N), top, right, bottom), "--ambe-surface-2")
        for v in (-1, 0, 1):
            poster.line([(left, py(v)), (right, py(v))], "--ambe-plot-grid", 1)
        poster.rect((left, top, right, bottom), "--ambe-plot-axis", fill=False)
        for v, s in ((1, "1"), (0, "0"), (-1, "−1")):
            poster.text((left - 26, py(v) - 9), s, 14, "--ambe-text-3")
        samples = [i / 2 for i in range(2 * N + 1)]
        dashed(poster, [(px(n), py(tone_at(n))) for n in samples], "--ambe-plot-muted", 1)
        dashed(poster, [(px(n), py(window_at(end, n))) for n in samples], "--ambe-accent", 2, 9, 5)
        dashed(poster, [(px(n), py(-window_at(end, n))) for n in samples], "--ambe-accent", 1, 9, 5)
        poster.polyline([(px(N + i / 2), py(windowed_at(end, i / 2))) for i in range(2 * (X_END - N) + 1)],
                        "--ambe-plot-muted", 2)
        poster.polyline([(px(n), py(windowed_at(end, n))) for n in samples], "--ambe-highlight", 4)
        past, start = windowed_at(end, N), windowed_at(end, 0)
        if abs(past - start) > 0.02:
            poster.line([(px(N), py(past)), (px(N), py(start))], "--ambe-accent-warm", 5)
        else:
            poster.dot((px(N), py(start)), 5, "--ambe-accent-warm")
        # The chip, in the band above the block, right-aligned to its end.
        text = chip_text(title, end)
        width = poster.draw.textlength(text, font=poster.font(15))
        chip = (px(N) - width - 20, top - 34, px(N), top - 6)
        poster.rect(chip, "--ambe-highlight-chip")
        poster.rect(chip, "--ambe-highlight", fill=False, width=2)
        poster.text((chip[0] + 10, chip[1] + 5), text, 15, "--ambe-plot-ink")
        poster.text((px(N) + 10, bottom - 22), "next copy", 13, "--ambe-text-3")
        if row == len(WINDOWS) - 1:
            for n in (0, 40, 80, 120, 160):
                poster.text((px(n) - 10, bottom + 6), str(n), 14, "--ambe-text-3")
            poster.text((left - 70, bottom + 6), "sample", 14, "--ambe-text-3")
    poster.text((48, 692), "Thick: the windowed block. Dashed: the window and the block before windowing. "
                "Synthetic. Windows after Harris (1978).", 14, "--ambe-text-3")
