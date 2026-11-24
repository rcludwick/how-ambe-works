"""Fallback image for the pitch-search figure (docs/08-analysis.md).

The 2D default state, Front plus Side: the autocorrelation phi of lr-b's
stored window (frame 8), with the comb of the candidate period 46
highlighted, and beside it the score Psi(P) = P x the sum of phi(kP),
k >= 1, at every candidate from 22 to 114, with the site tracker's 45.6
as a dotted marker. In the light tokens, as the figure prints. Mirrors
lib/pitch.js (the Hamming taper, phi over phi(0), the score) and the
ranges of anim-pitch-search.js. Derived from the input audio.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

N = 255
P_MIN, P_MAX = 22, 114
PHI_DOMAIN = (-0.75, 1.0)
PSI_DOMAIN = (-25, 50)
CAND = 46
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
    """Colour tokens of the :root blocks, the light and print values."""
    tokens = {}
    for block in re.findall(r"(?m)^:root\s*\{(.*?)\n\}", css, re.S):
        for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
            colour = _colour(re.sub(r"/\*.*?\*/", "", value))
            if colour:
                tokens[name] = colour
    return tokens


def phi_of(samples: list[int]) -> list[float]:
    """phi of w^2 s over phi(0), lags 0 to N - 1 (lib/pitch.js autocorrelation)."""
    n = len(samples)
    v = [(0.54 - 0.46 * math.cos(2 * math.pi * i / (n - 1))) ** 2 * samples[i] for i in range(n)]
    phi = [sum(v[i] * v[i + m] for i in range(n - m)) for m in range(n)]
    return [p / phi[0] for p in phi]


def psi(phi: list[float], period: int) -> float:
    return period * sum(phi[k * period] for k in range(1, (len(phi) - 1) // period + 1))


# φ's peaks on this window: 46 (0.70), 23 (0.35), 92 (0.23), 69 (0.16), 138.
# The comb at 46 lands on 46, 92 and 138; the one at 23 adds 23 and 69.
SUBTITLE = ("lr-b frame 8: the comb at P = 46 lands on φ's peaks at 46, 92 and 138 (Ψ 44.45); "
            "the comb at 23 adds the peaks at 23 and 69 (Ψ 34.92, 79%).")


def draw(poster, data_dir: Path) -> None:
    poster.tokens = {**poster.tokens, **light_tokens(EXTRA_CSS.read_text(encoding="utf-8"))}
    doc = json.loads((data_dir / "lr-b" / "correlogram.json").read_text(encoding="utf-8"))
    phi = phi_of(doc["window"]["samples"])
    tracker = doc["tracker_period"][doc["window"]["frame"]]
    width, height = poster.image.size
    poster.rect((0, 0, width, height), "--ambe-plot-bg")

    poster.text((64, 32), "The pitch search's score, one candidate period at a time", 30, "--ambe-text", weight="semibold")
    poster.text((64, 76), SUBTITLE, 18, "--ambe-text-3")

    def panel(left, right, top, bottom, xd, yd, xticks, yticks, xlabel, title):
        fx = lambda x: left + (right - left) * (x - xd[0]) / (xd[1] - xd[0])  # noqa: E731
        fy = lambda y: bottom - (bottom - top) * (y - yd[0]) / (yd[1] - yd[0])  # noqa: E731
        for t in xticks:
            poster.line([(fx(t), top), (fx(t), bottom)], "--ambe-plot-grid", width=1)
            poster.text((fx(t) - 10, bottom + 10), str(t), 16, "--ambe-text-3")
        for t in yticks:
            poster.line([(left, fy(t)), (right, fy(t))], "--ambe-plot-grid", width=1)
            poster.text((left - 44, fy(t) - 10), str(t), 16, "--ambe-text-3")
        poster.line([(left, bottom), (right, bottom)], "--ambe-plot-axis", width=1)
        poster.line([(left, top), (left, bottom)], "--ambe-plot-axis", width=1)
        poster.text(((left + right) / 2 - 60, bottom + 36), xlabel, 16, "--ambe-text-3")
        poster.text((left, top - 28), title, 17, "--ambe-text-3")
        return fx, fy

    fx, fy = panel(120, 860, 150, 600, (0, 254), PHI_DOMAIN, [0, 50, 100, 150, 200, 250], [-0.5, 0, 0.5, 1],
                   "lag, samples", "φ / φ(0)")
    poster.polyline([(fx(m), fy(y)) for m, y in enumerate(phi)], "--ambe-plot-ink", width=2)
    poster.line([(fx(0), fy(0)), (fx(254), fy(0))], "--ambe-highlight", width=4)
    for k in range(1, 254 // CAND + 1):
        lag = k * CAND
        poster.line([(fx(lag), fy(0)), (fx(lag), fy(phi[lag]))], "--ambe-highlight", width=4)
        poster.dot((fx(lag), fy(phi[lag])), 6, "--ambe-highlight")
    poster.text((fx(CAND) + 12, fy(phi[CAND]) - 12), "comb at P = 46", 17, "--ambe-highlight")

    gx, gy = panel(960, 1216, 150, 600, (P_MIN, P_MAX), PSI_DOMAIN, [25, 50, 75, 100], [-25, 0, 25, 50],
                   "candidate P", "score Ψ(P)")
    poster.polyline([(gx(p), gy(psi(phi, p))) for p in range(P_MIN, P_MAX + 1)], "--ambe-accent-cool", width=3)
    for y in range(150, 600, 8):
        poster.line([(gx(tracker), y), (gx(tracker), y + 4)], "--ambe-plot-muted", width=2)
    poster.line([(gx(CAND), gy(0)), (gx(CAND), gy(psi(phi, CAND)))], "--ambe-highlight", width=3)
    poster.dot((gx(CAND), gy(psi(phi, CAND))), 7, "--ambe-highlight")

    poster.text((64, 684), "Derived from the input audio (Piper TTS), not from the chip. Griffin and Lim 1988, "
                "eqs. 12 and 13 (k = 1, 2, 3, …); range from US 5,216,747. It never picks a pitch.", 15, "--ambe-text-3")
