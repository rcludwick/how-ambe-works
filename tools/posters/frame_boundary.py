"""Fallback image for the frame-boundary figure (docs/11-synthesis.md).

Left: sixteen harmonics crossfaded across the 20 ms from a frame at 120 Hz
to one at 126 Hz, each drawn as its envelope and coloured by harmonic
number, harmonic 8 in the highlight (the figure draws the waveforms only
for a switch). Right: the 3D view's Side preset, one bar per harmonic
hanging from level 1 down to its lowest envelope under its number and
l x delta_f, harmonic 8 highlighted with its chip at the bar's foot. Mirrors docs/javascripts/lib/boundary.js (both oscillators in
step at t = 0, linear complementary weights), so the poster shows the
numbers the figure does. Synthetic: closed-form, nothing measured or read.
"""

from __future__ import annotations

import math
from pathlib import Path

F_OLD = 120.0
CHANGE = 0.05
T_MS = 20.0
LANES = 16
TOP = 8
SAMPLES = 321
RAMP = ["--ambe-ramp-0", "--ambe-ramp-1", "--ambe-ramp-2", "--ambe-ramp-3", "--ambe-ramp-4"]


def weights(t_ms: float) -> tuple[float, float]:
    w = min(1.0, max(0.0, t_ms / T_MS))
    return 1 - w, w


def envelope(l: int, t_ms: float, change: float = CHANGE) -> float:
    """lib/boundary.js envelope("crossfade", ...)."""
    a, b = weights(t_ms)
    d = 2 * math.pi * l * (F_OLD * change) * (t_ms / 1000)
    return math.sqrt(max(0.0, a * a + b * b + 2 * a * b * math.cos(d)))


def carrier(l: int, t_ms: float, change: float = CHANGE) -> float:
    """lib/boundary.js carrier("crossfade", ...)."""
    a, b = weights(t_ms)
    t = t_ms / 1000
    return a * math.cos(2 * math.pi * l * F_OLD * t) + b * math.cos(2 * math.pi * l * F_OLD * (1 + change) * t)


def midpoint(l: int, change: float = CHANGE) -> float:
    return abs(math.cos(math.pi * l * F_OLD * change * (T_MS / 1000) / 2))


def lowest(l: int, change: float = CHANGE) -> float:
    return min(envelope(l, i * T_MS / (SAMPLES - 1), change) for i in range(SAMPLES))


def lane_token(l: int) -> str:
    return RAMP[round((l - 1) / (LANES - 1) * 4)]


def draw(poster, data_dir: Path) -> None:  # noqa: ARG001 (no data: synthetic)
    poster.text((56, 30), "Sixteen harmonics across one frame boundary", 30, "--ambe-text", weight="semibold")
    poster.text((56, 74), "Crossfaded from a frame at 120 Hz to one at 126 Hz, harmonics 1 to 16 at equal strength",
                18, "--ambe-text-3")

    # Left: every envelope overlaid, the 2D view and the 3D Front.
    left, right, top, bottom = 80, 620, 160, 560
    mid = (top + bottom) / 2
    extent = 1.1

    def xy(t: float, v: float) -> tuple[float, float]:
        return left + (right - left) * t / T_MS, mid - (bottom - top) / 2 * v / extent

    poster.text((left, 122), "Each harmonic's envelope across the 20 ms", 17, "--ambe-text-2")
    for v in (-1, 0, 1):
        poster.line([xy(0, v), xy(T_MS, v)], "--ambe-plot-grid", width=1)
        poster.text((left - 28, xy(0, v)[1] - 10), str(v), 15, "--ambe-plot-muted")
    for t in (0, 5, 10, 15, 20):
        poster.line([xy(t, -extent), xy(t, extent)], "--ambe-plot-grid", width=1)
        poster.text((xy(t, 0)[0] - 6, bottom + 8), str(t), 15, "--ambe-plot-muted")
    poster.text(((left + right) / 2 - 120, bottom + 30), "time between the two frames (ms)", 15, "--ambe-plot-muted")
    ts = [i * T_MS / (SAMPLES - 1) for i in range(SAMPLES)]
    for l in range(LANES, 0, -1):
        if l != TOP:
            poster.polyline([xy(t, envelope(l, t)) for t in ts], lane_token(l), width=2)
    poster.polyline([xy(t, envelope(TOP, t)) for t in ts], "--ambe-highlight", width=5)
    low_x, low_y = xy(T_MS / 2, midpoint(TOP))
    poster.text((low_x + 12, low_y + 6), f"harmonic {TOP}: midpoint {midpoint(TOP):.2f}", 16, "--ambe-plot-ink")
    poster.text((left, 636), f"harmonic 1 stays at {midpoint(1):.2f} at 10 ms; harmonic 4 at {midpoint(4):.2f}",
                16, "--ambe-text-3")

    # Right: the Side view, one bar per harmonic hanging from level 1.
    left, right, ceil, floor = 700, 1220, 200, 520
    poster.text((left, 122), "From the side: how far each harmonic dips", 17, "--ambe-text-2")
    step = (right - left) / LANES

    def by(level: float) -> float:
        return floor - (floor - ceil) * level

    for x in range(left, right, 12):
        poster.line([(x, by(1)), (x + 6, by(1))], "--ambe-plot-muted", width=1)
    poster.text((left - 52, by(1) - 10), "level 1", 15, "--ambe-plot-muted")
    poster.text((left - 74, by(1) - 44), "Hz apart", 14, "--ambe-plot-muted")
    poster.text((left - 74, by(1) - 26), "harmonic", 14, "--ambe-plot-muted")
    for l in range(1, LANES + 1):
        x0 = left + (l - 1) * step + step * 0.16
        x1 = left + l * step - step * 0.16
        if l == TOP:
            poster.rect((x0, by(1), x1, by(lowest(l))), "--ambe-highlight-fill-top")
            poster.rect((x0, by(1), x1, by(lowest(l))), "--ambe-highlight", fill=False, width=3)
        else:
            poster.rect((x0, by(1), x1, by(lowest(l))), lane_token(l))
        label = str(l)
        poster.text(((x0 + x1) / 2 - poster.font(14).getlength(label) / 2, by(1) - 26), label, 14, "--ambe-plot-muted")
        hz = f"{l * F_OLD * CHANGE:.0f}"
        poster.text(((x0 + x1) / 2 - poster.font(14).getlength(hz) / 2, by(1) - 44), hz, 14, "--ambe-plot-muted")
    hx = left + (TOP - 0.5) * step
    foot = by(lowest(TOP))
    poster.dot((hx, foot), 5, "--ambe-highlight")
    chip = f"harmonic {TOP}: lowest {lowest(TOP):.2f}"
    cx, cy = hx + 24, foot - 52
    width = poster.font(16).getlength(chip) + 22
    poster.line([(hx, foot), (cx, cy + 15)], "--ambe-highlight", width=2)
    poster.draw.rounded_rectangle((cx, cy, cx + width, cy + 30), radius=6, fill=poster.colour("--ambe-highlight-chip"),
                                  outline=poster.colour("--ambe-highlight"), width=2)
    poster.text((cx + 11, cy + 5), chip, 16, "--ambe-plot-ink")
    poster.text((left, 636), "harmonic 1 barely dips; every harmonic from 5 up falls below half", 16, "--ambe-text-3")

    poster.text((56, 684), "Synthetic: closed-form, nothing measured or read. Rules and the l < 8 gate after US 5,701,390.",
                15, "--ambe-text-4")
