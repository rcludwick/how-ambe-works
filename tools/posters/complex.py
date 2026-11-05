"""Fallback image for the complex figure (docs/02-fourier-and-the-dft.md).

The flat view at the figure's default point (radius 1, 35 degrees) with two
full turns traced: the plane on the left, with the point and its radius as
the highlight and x and y as the sides of the right triangle; on the right,
x over the two turns (a cosine) and, in a small panel below it, y over the
same turns (a sine, a quarter turn later). Drawn in the light tokens, as
print shows the page. Mirrors helix() in docs/javascripts/anim-complex.js:
the angle at turn t is phi(t) = theta - 2 pi (head - t), with head = 2.
Definitions only; it reads no data.
"""

from __future__ import annotations

import math
import re
from pathlib import Path

from PIL import Image, ImageDraw

R = 1.0
THETA = math.radians(35)
HEAD = 2.0
EXTENT = 1.35
POINTS = 480
EXTRA_CSS = Path(__file__).resolve().parents[2] / "docs" / "stylesheets" / "extra.css"


def light_tokens(css: str) -> dict[str, tuple[int, int, int, int]]:
    """Colour tokens of the light scheme: the :root block before the slate one."""
    block = css[: css.index('[data-md-color-scheme="slate"]')]
    tokens: dict[str, tuple[int, int, int, int]] = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
        value = re.sub(r"/\*.*?\*/", "", value).strip()
        hex_match = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
        rgba = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
        if hex_match:
            d = hex_match.group(1)
            tokens[name] = (int(d[0:2], 16), int(d[2:4], 16), int(d[4:6], 16), 255)
        elif rgba:
            alpha = 1.0 if rgba.group(4) is None else float(rgba.group(4))
            tokens[name] = (int(rgba.group(1)), int(rgba.group(2)), int(rgba.group(3)), round(alpha * 255))
    return tokens


def path(head: float = HEAD) -> list[tuple[float, float, float]]:
    """(t, re, im) over 0 to 2 turns, ending at the point now."""
    out = []
    for i in range(POINTS + 1):
        t = i / POINTS * 2
        phi = THETA - 2 * math.pi * (head - t)
        out.append((t, R * math.cos(phi), R * math.sin(phi)))
    return out


def dashed(poster, points, name: str, width: int = 1, on: int = 6, off: int = 5) -> None:
    """A polyline drawn as dashes of `on` px with gaps of `off` px."""
    run = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if (run % (on + off)) < on:
            poster.line([(x0, y0), (x1, y1)], name, width)
        run += math.hypot(x1 - x0, y1 - y0)


def draw(poster, data_dir: Path) -> None:
    # The light scheme, as print and the JS-off page show the figure.
    poster.tokens = {**poster.tokens, **light_tokens(EXTRA_CSS.read_text(encoding="utf-8"))}
    poster.image = Image.new("RGB", poster.image.size, poster.colour("--ambe-plot-bg")[:3])
    poster.draw = ImageDraw.Draw(poster.image, "RGBA")

    poster.text((56, 30), "A point, a length and a turn, a complex number", 30, "--ambe-text", weight="semibold")
    poster.text((56, 74), "r = 1.00, θ = 35°: two full turns traced, x a cosine and y the same wave a quarter turn later",
                18, "--ambe-text-3")

    # The plane, square, -1.35 to 1.35 on both axes.
    left, top, size = 70, 140, 500

    def px(v: float) -> float:
        return left + (v + EXTENT) / (2 * EXTENT) * size

    def py(v: float) -> float:
        return top + (EXTENT - v) / (2 * EXTENT) * size

    for v in (-1, 0, 1):
        poster.line([(px(v), top), (px(v), top + size)], "--ambe-plot-grid", 1)
        poster.line([(left, py(v)), (left + size, py(v))], "--ambe-plot-grid", 1)
    poster.rect((left, top, left + size, top + size), "--ambe-plot-axis", fill=False)
    circle = [(px(math.cos(a / 90 * math.pi)), py(math.sin(a / 90 * math.pi))) for a in range(181)]
    dashed(poster, circle, "--ambe-plot-muted")
    x, y = R * math.cos(THETA), R * math.sin(THETA)
    poster.line([(px(0), py(0)), (px(x), py(0))], "--ambe-data-2", 4)
    poster.line([(px(0), py(0)), (px(0), py(y))], "--ambe-data-3", 4)
    dashed(poster, [(px(x), py(0)), (px(x), py(y))], "--ambe-data-3", 2, 5, 4)
    dashed(poster, [(px(0), py(y)), (px(x), py(y))], "--ambe-data-2", 2, 5, 4)
    poster.line([(px(0), py(0)), (px(x), py(y))], "--ambe-highlight", 5)
    poster.dot((px(x), py(y)), 9, "--ambe-highlight")
    # The chip inside the plane, above the circle, with a leader to the point.
    chip = (px(x) - 150, top + 16, px(x) + 10, top + 50)
    poster.line([(px(x), py(y)), (px(x) - 20, chip[3])], "--ambe-highlight", 2)
    poster.rect(chip, "--ambe-highlight-chip")
    poster.rect(chip, "--ambe-highlight", fill=False, width=2)
    poster.text((chip[0] + 12, chip[1] + 6), "r 1.00, θ 35°", 18, "--ambe-plot-ink")
    poster.text((px(x / 2) - 30, py(0) + 8), "x = 0.82", 17, "--ambe-data-2")
    poster.text((px(0) - 82, py(y / 2) - 10), "y = 0.57", 17, "--ambe-data-3")
    for v in (-1, 0, 1):
        poster.text((px(v) - (10 if v < 0 else 5), top + size + 8), f"{v}", 15, "--ambe-text-3")
    poster.text((left + size / 2 - 30, top + size + 30), "real axis", 16, "--ambe-text-3")
    poster.text((left - 22, py(1) - 10), "i", 16, "--ambe-text-3")
    poster.text((left - 28, py(-1) - 10), "-i", 16, "--ambe-text-3")

    # The waves: x over two turns, large; y below it, small.
    w_left, w_right = 660, 1230
    turns = path()

    def wx(t: float) -> float:
        return w_left + t / 2 * (w_right - w_left)

    def panel(top_: float, bottom: float, index: int, name: str, label: str, small: bool = False) -> None:
        mid = (top_ + bottom) / 2
        half = (bottom - top_) / 2 / EXTENT
        for t in (0.5, 1, 1.5):
            poster.line([(wx(t), top_), (wx(t), bottom)], "--ambe-plot-grid", 1)
        poster.line([(w_left, mid), (w_right, mid)], "--ambe-plot-grid", 1)
        poster.rect((w_left, top_, w_right, bottom), "--ambe-plot-axis", fill=False)
        poster.polyline([(wx(p[0]), mid - p[index] * half) for p in turns], name, 3)
        end = turns[-1]
        poster.dot((wx(end[0]), mid - end[index] * half), 6, name)
        poster.text((w_left, top_ - 24) if small else (w_left + 10, top_ + 8), label, 17, name)
        for v in (-1, 1):
            poster.text((w_left - (26 if v < 0 else 18), mid - v * half - 10), f"{v}", 15, "--ambe-text-3")

    panel(140, 470, 1, "--ambe-data-2", "x, plotted as the point turns: a cosine")
    panel(526, 640, 2, "--ambe-data-3", "y over the same turns: a sine, a quarter turn later", small=True)
    for t in (0, 0.5, 1, 1.5, 2):
        poster.text((wx(t) - 8, 646), f"{t:g}", 15, "--ambe-text-3")
    poster.text((wx(1) - 60, 670), "turns of the point", 16, "--ambe-text-3")
