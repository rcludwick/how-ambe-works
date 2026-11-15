"""Fallback image for the probe figure (docs/02-fourier-and-the-dft.md).

Steps 1, 2 and 4 side by side, in the light tokens, as print shows the page:
the sine test's products on a 200 Hz sine of 160 samples at phase 0 (all
positive, the running sum climbs to 80) and at phase 90 (they cancel, the
sum ends at 0), then both tests at phase 45 on the plane of the two sums,
where the running sum walks out to the ring at 80. The running sum is the
highlight, with the figure's chip. Mirrors lib/probe.js. A computed sine;
it reads no data.
"""

from __future__ import annotations

import math
import re
from pathlib import Path

from PIL import Image, ImageDraw

N = 160
RATE = 8000
SIGNAL_HZ = 200
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


def probe(f: float, phase_deg: float) -> dict[str, list[float]]:
    """Both tests at f against the recording with phase phase_deg (lib/probe.js)."""
    phi = math.radians(phase_deg)
    out: dict[str, list[float]] = {"sine": [], "cosine": [], "sine_run": [], "cosine_run": []}
    s_sum = c_sum = 0.0
    for n in range(N):
        s = math.sin(2 * math.pi * SIGNAL_HZ * n / RATE + phi)
        ps = s * math.sin(2 * math.pi * f * n / RATE)
        pc = s * math.cos(2 * math.pi * f * n / RATE)
        s_sum += ps
        c_sum += pc
        out["sine"].append(ps)
        out["cosine"].append(pc)
        out["sine_run"].append(s_sum)
        out["cosine_run"].append(c_sum)
    return out


def ramp(poster, t: float) -> tuple[int, int, int, int]:
    """The ramp tokens at t (0 to 1), mixed in sRGB between neighbouring stops."""
    stops = [poster.colour(f"--ambe-ramp-{i}") for i in range(5)]
    x = min(1.0, max(0.0, t)) * 4
    i = min(3, int(x))
    f = x - i
    return tuple(round(a + (b - a) * f) for a, b in zip(stops[i], stops[i + 1]))


def chip(poster, x: float, y: float, text: str) -> None:
    box = (x, y, x + 150, y + 32)
    poster.rect(box, "--ambe-highlight-chip")
    poster.rect(box, "--ambe-highlight", fill=False, width=2)
    poster.line([(x + 10, y + 16), (x + 26, y + 16)], "--ambe-highlight", 4)
    poster.text((x + 34, y + 5), text, 17, "--ambe-plot-ink")


def products_panel(poster, left: float, top: float, width: float, height: float, phase: int, title: str) -> None:
    p = probe(SIGNAL_HZ, phase)
    mid = top + height / 2
    half = height / 2 / 1.2

    def px(n: float) -> float:
        return left + n / N * width

    poster.text((left, top - 58), title, 20, "--ambe-text", weight="semibold")
    poster.text((left, top - 30), "sine test × recording, and the running sum ÷ 80", 15, "--ambe-text-3")
    for n in (40, 80, 120):
        poster.line([(px(n), top), (px(n), top + height)], "--ambe-plot-grid", 1)
    poster.line([(left, mid), (left + width, mid)], "--ambe-plot-grid", 1)
    poster.rect((left, top, left + width, top + height), "--ambe-plot-axis", fill=False)
    for n, v in enumerate(p["sine"]):
        poster.draw.line([(px(n), mid), (px(n), mid - v * half)], fill=ramp(poster, n / (N - 1)), width=2)
    run = [(px(n), mid - v / 80 * half) for n, v in enumerate(p["sine_run"])]
    poster.polyline(run, "--ambe-highlight", 5)
    poster.dot(run[-1], 7, "--ambe-highlight")
    for n in (0, 80, 160):
        poster.text((px(n) - 10, top + height + 6), str(n), 15, "--ambe-text-3")
    poster.text((left + width / 2 - 34, top + height + 26), "sample n", 15, "--ambe-text-3")
    total = p["sine_run"][-1]
    chip(poster, left + width - 150, top + 8 if total < 40 else top + height - 40, f"sum: {abs(total):.2f}")


def plane_panel(poster, left: float, top: float, size: float, phase: int) -> None:
    p = probe(SIGNAL_HZ, phase)
    extent = 96

    def px(v: float) -> float:
        return left + (v + extent) / (2 * extent) * size

    def py(v: float) -> float:
        return top + (extent - v) / (2 * extent) * size

    poster.text((left - 30, top - 58), "Step 4: both tests, phase 45°", 20, "--ambe-text", weight="semibold")
    poster.text((left - 30, top - 30), "the plane of the two sums, ring at 80", 15, "--ambe-text-3")
    for v in (-80, 0, 80):
        poster.line([(px(v), top), (px(v), top + size)], "--ambe-plot-grid", 1)
        poster.line([(left, py(v)), (left + size, py(v))], "--ambe-plot-grid", 1)
    poster.rect((left, top, left + size, top + size), "--ambe-plot-axis", fill=False)
    ring = [(px(80 * math.cos(a / 90 * math.pi)), py(80 * math.sin(a / 90 * math.pi))) for a in range(181)]
    run = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if run % 11 < 6:
            poster.line([(x0, y0), (x1, y1)], "--ambe-plot-muted", 1)
        run += math.hypot(x1 - x0, y1 - y0)
    walk = [(px(0), py(0))] + [(px(s), py(c)) for s, c in zip(p["sine_run"], p["cosine_run"])]
    poster.polyline(walk, "--ambe-highlight", 5)
    poster.dot(walk[-1], 8, "--ambe-highlight")
    length = math.hypot(p["sine_run"][-1], p["cosine_run"][-1])
    chip(poster, walk[-1][0] - 150, walk[-1][1] - 52, f"sum: {length:.2f}")
    poster.text((left + size / 2 - 50, top + size + 8), "sine test sum", 15, "--ambe-text-3")
    poster.text((left + 6, top + 6), "cosine test sum", 15, "--ambe-text-3")


def draw(poster, data_dir: Path) -> None:
    poster.tokens = {**poster.tokens, **light_tokens(EXTRA_CSS.read_text(encoding="utf-8"))}
    poster.image = Image.new("RGB", poster.image.size, poster.colour("--ambe-plot-bg")[:3])
    poster.draw = ImageDraw.Draw(poster.image, "RGBA")

    poster.text((48, 28), "Testing for one frequency: multiply, then add up", 30, "--ambe-text", weight="semibold")
    poster.text((48, 72), "A 200 Hz sine of 160 samples, tested at 200 Hz. Synthetic: a computed sine.", 18, "--ambe-text-3")

    products_panel(poster, 48, 220, 360, 300, 0, "Step 1: matched, phase 0")
    products_panel(poster, 468, 220, 360, 300, 90, "Step 2: a quarter cycle off")
    plane_panel(poster, 910, 220, 330, 45)
    poster.text((48, 640), "Matched, every product is positive and the sum is 80. A quarter cycle off, the sine test",
                17, "--ambe-text-2")
    poster.text((48, 666), "alone sums to 0. With the cosine test too, the pair has length 80 at every phase.",
                17, "--ambe-text-2")
