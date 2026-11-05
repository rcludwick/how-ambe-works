"""Fallback image for the three-numbers figure (docs/01-why-sinusoids.md).

The 2D default state: the live wave (amplitude 1, frequency 1, phase 0)
over the dashed reference it started as, three cycles across, with the
amplitude bar. In the light tokens, as the figure prints. Mirrors SPAN,
POINTS, the y range and the bar position of
docs/javascripts/anim-three-numbers.js. A formula, plotted; nothing
measured.
"""

from __future__ import annotations

import math
import re
from pathlib import Path

SPAN = 3
POINTS = 720
Y_DOMAIN = (-1.6, 1.6)
BAR_T = SPAN * 0.045
EXTRA_CSS = Path(__file__).resolve().parents[2] / "docs" / "stylesheets" / "extra.css"


def _colour(value: str):
    value = value.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
    if m:
        d = m.group(1)
        return (int(d[0:2], 16), int(d[2:4], 16), int(d[4:6], 16), 255)
    m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
    if m:
        alpha = 1.0 if m.group(4) is None else float(m.group(4))
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)), round(alpha * 255))
    return None


def light_tokens(css: str) -> dict:
    """Colour tokens of the :root block, the light and print values."""
    block = re.search(r":root\s*\{(.*?)\n\}", css, re.S).group(1)
    tokens = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
        colour = _colour(re.sub(r"/\*.*?\*/", "", value))
        if colour:
            tokens[name] = colour
    return tokens


def wave(amp: float, freq: float, phase: float) -> list[tuple[float, float]]:
    return [((i / POINTS) * SPAN, amp * math.sin(2 * math.pi * freq * (i / POINTS) * SPAN + phase))
            for i in range(POINTS + 1)]


def draw(poster, data_dir: Path) -> None:
    poster.tokens = {**poster.tokens, **light_tokens(EXTRA_CSS.read_text(encoding="utf-8"))}
    width, height = poster.image.size
    poster.rect((0, 0, width, height), "--ambe-plot-bg")

    poster.text((64, 36), "The three numbers, one wave", 30, "--ambe-text", weight="semibold")
    poster.text((64, 80), "Amplitude 1, frequency 1, phase 0: the live wave sits on the reference it started as.",
                18, "--ambe-text-3")

    left, right, top, bottom = 110, 1216, 150, 600

    def fx(t: float) -> float:
        return left + (right - left) * t / SPAN

    def fy(v: float) -> float:
        return bottom - (bottom - top) * (v - Y_DOMAIN[0]) / (Y_DOMAIN[1] - Y_DOMAIN[0])

    for t in range(SPAN + 1):
        poster.line([(fx(t), top), (fx(t), bottom)], "--ambe-plot-grid", width=1)
        poster.text((fx(t) - 5, bottom + 10), str(t), 17, "--ambe-text-3")
    for v in (-1, 0, 1):
        poster.line([(left, fy(v)), (right, fy(v))], "--ambe-plot-grid", width=1)
        poster.text((left - 34, fy(v) - 11), str(v), 17, "--ambe-text-3")
    poster.line([(left, bottom), (right, bottom)], "--ambe-plot-axis", width=1)
    poster.line([(left, top), (left, bottom)], "--ambe-plot-axis", width=1)
    poster.text(((left + right) / 2 - 130, bottom + 38), "time, in cycles of the reference", 17, "--ambe-text-3")

    ref = [(fx(t), fy(v)) for t, v in wave(1, 1, 0)]
    for j in range(0, len(ref) - 1, 10):
        poster.line(ref[j:j + 6], "--ambe-plot-muted", width=3)
    poster.polyline([(fx(t), fy(v)) for t, v in wave(1, 1, 0)], "--ambe-data-1", width=5)

    poster.line([(fx(BAR_T), fy(0)), (fx(BAR_T), fy(1))], "--ambe-accent-cool", width=3)
    poster.text((fx(BAR_T) + 10, fy(0.5) - 11), "amplitude", 17, "--ambe-accent-cool")

    poster.text((64, 684), "Definitions only. Nothing measured, nothing specific to AMBE.", 15, "--ambe-text-3")
