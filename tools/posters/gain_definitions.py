"""Fallback image for the gain-definitions figure (docs/13-what-is-not-established.md).

Steps 4 and 5 in the light tokens, as print shows the page. Left, the two
frames the equal-spread pick finds (lr-a and lj-c, both at spread 18.4 dB),
each shifted so its log of mean energy G_E sits at 0 dB: the lr-a frame in
the highlight with its chip, the lj-c frame dotted, each with its mean of
logs G_L dashed. Right, the G_L of all 661 counted frames against their
spread, on the ramp by recording. The numbers come from tools/gain-stats.py
on the decoded spectra in docs/assets/data/; no hex, no audio.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"
K_MAX = 42
DB = (-72.0, 16.0)
SIGMA_MAX = 28.0


def _gain_stats():
    spec = importlib.util.spec_from_file_location("gain_stats_poster", ROOT / "tools" / "gain-stats.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GAIN = _gain_stats()


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


def ramp(poster, t: float) -> tuple[int, int, int, int]:
    """The ramp tokens at t (0 to 1), mixed in sRGB between neighbouring stops."""
    stops = [poster.colour(f"--ambe-ramp-{i}") for i in range(5)]
    x = min(1.0, max(0.0, t)) * 4
    i = min(3, int(x))
    f = x - i
    return tuple(round(a + (b - a) * f) for a, b in zip(stops[i], stops[i + 1]))


def the_pair(data_dir: Path):
    """(frames, selected, partner) as the figure's step 4 shows them."""
    frames = GAIN.gain_frames(data_dir)
    frame, partner = GAIN.equal_spread_pair(frames)
    return frames, frame, partner


def dashed(poster, a, b, name: str, width: int, on: float, off: float) -> None:
    (x0, y0), (x1, y1) = a, b
    length = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    s = 0.0
    while s < length:
        e = min(length, s + on)
        poster.line([(x0 + (x1 - x0) * s / length, y0 + (y1 - y0) * s / length),
                     (x0 + (x1 - x0) * e / length, y0 + (y1 - y0) * e / length)], name, width)
        s += on + off


def axes(poster, left, top, width, height, xs, xmax, xlabel, ylabel):
    def py(v: float) -> float:
        return top + (DB[1] - v) / (DB[1] - DB[0]) * height

    for v in (-60, -40, -20, 0):
        poster.line([(left, py(v)), (left + width, py(v))], "--ambe-plot-grid", 1)
        poster.text((left - 40, py(v) - 10), str(v), 15, "--ambe-text-3")
    for v in xs:
        x = left + v / xmax * width
        poster.text((x - 8, top + height + 6), str(v), 15, "--ambe-text-3")
    poster.line([(left, top), (left, top + height), (left + width, top + height)], "--ambe-plot-axis", 1)
    poster.text((left + width / 2 - 60, top + height + 28), xlabel, 15, "--ambe-text-3")
    if ylabel:
        poster.text((left - 40, top - 28), ylabel, 15, "--ambe-text-3")
    return py


def draw(poster, data_dir: Path) -> None:
    poster.tokens = {**poster.tokens, **light_tokens(EXTRA_CSS.read_text(encoding="utf-8"))}
    poster.image = Image.new("RGB", poster.image.size, poster.colour("--ambe-plot-bg")[:3])
    poster.draw = ImageDraw.Draw(poster.image, "RGBA")
    frames, sel, partner = the_pair(data_dir)

    poster.text((48, 26), "Two definitions of a frame's level, and the gap between them", 30, "--ambe-text", weight="semibold")
    poster.text((48, 70), "Voiced frames of the chip's decoded audio, each shifted so its log of mean energy G_E sits at 0 dB.",
                18, "--ambe-text-3")

    # Left: the two combs at the same spread.
    left, top, width, height = 100, 170, 640, 400
    py = axes(poster, left, top, width, height, (1, 10, 20, 30, 40), K_MAX, "harmonic number k", "dB relative to G_E")

    def px(k: float) -> float:
        return left + k / K_MAX * width

    floor = py(DB[0])
    tips = [(px(k + 1), py(db - sel["ge"])) for k, db in enumerate(sel["levels"])]
    poster.draw.polygon([(tips[0][0], floor), *tips, (tips[-1][0], floor)], fill=poster.colour("--ambe-highlight-fill-top"))
    ptips = [(px(k + 1), py(db - partner["ge"])) for k, db in enumerate(partner["levels"])]
    for a, b in zip(ptips, ptips[1:]):
        dashed(poster, a, b, "--ambe-plot-ink", 2, 3, 4)
    for x, y in ptips:
        poster.draw.ellipse((x - 4, y - 4, x + 4, y + 4), outline=poster.colour("--ambe-plot-ink"), width=2)
    for x, y in tips:
        poster.line([(x, floor), (x, y)], "--ambe-highlight", 2)
    poster.polyline(tips, "--ambe-highlight", 5)
    end = px(max(sel["L"], partner["L"]) + 0.5)
    poster.line([(px(0.5), py(0)), (end, py(0))], "--ambe-plot-ink", 3)
    dashed(poster, (px(0.5), py(-sel["gap"])), (px(sel["L"] + 0.5), py(-sel["gap"])), "--ambe-plot-ink", 3, 12, 7)
    dashed(poster, (px(0.5), py(-partner["gap"])), (px(partner["L"] + 0.5), py(-partner["gap"])), "--ambe-plot-muted", 2, 5, 5)
    bx = end + 22
    poster.line([(bx - 7, py(0)), (bx, py(0)), (bx, py(-sel["gap"])), (bx - 7, py(-sel["gap"]))], "--ambe-plot-ink", 2)
    poster.text((bx + 8, py(0) - 22), "G_E", 17, "--ambe-plot-ink", weight="semibold")
    poster.text((bx + 8, py(-sel["gap"]) + 2), "G_L", 17, "--ambe-plot-ink", weight="semibold")
    poster.text((bx + 8, py(-sel["gap"] / 2) - 10), f"{sel['gap']:.1f} dB", 15, "--ambe-text-2")
    poster.text((px(partner["L"] + 0.5) + 6, py(-partner["gap"]) - 10), f"{partner['gap']:.1f} dB", 15, "--ambe-text-3")
    hx, hy = max(tips, key=lambda p: -p[1])
    box = (hx + 24, hy - 8, hx + 322, hy + 26)
    poster.line([(hx, hy), (box[0], box[1] + 17)], "--ambe-highlight", 2)
    poster.rect(box, "--ambe-highlight-chip")
    poster.rect(box, "--ambe-highlight", fill=False, width=2)
    poster.line([(box[0] + 10, box[1] + 17), (box[0] + 26, box[1] + 17)], "--ambe-highlight", 4)
    poster.text((box[0] + 34, box[1] + 6), f"{sel['clip']}: spread {sel['sigma']:.1f} dB, gap {sel['gap']:.1f} dB", 17, "--ambe-plot-ink")
    poster.text((left, top + height + 52),
                f"{sel['clip']} (thick) and {partner['clip']} (dotted): spread {sel['sigma']:.1f} and {partner['sigma']:.1f} dB",
                16, "--ambe-text-2")

    # Right: every frame's G_L against its spread.
    sl, st, sw, sh = 860, 170, 370, 400
    sy = axes(poster, sl, st, sw, sh, (0, 10, 20), SIGMA_MAX, "spread, dB", "")
    poster.text((sl, st - 28), f"every frame ({len(frames)}): G_L below G_E", 15, "--ambe-text-3")

    def sx(v: float) -> float:
        return sl + v / SIGMA_MAX * sw

    for f in frames:
        poster.draw.rectangle((sx(f["sigma"]) - 1.5, sy(0) - 1.5, sx(f["sigma"]) + 1.5, sy(0) + 1.5), fill=poster.colour("--ambe-plot-muted"))
    for f in frames:
        x, y = sx(f["sigma"]), sy(-f["gap"])
        poster.draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=ramp(poster, f["order"] / 7))
    x, y = sx(partner["sigma"]), sy(-partner["gap"])
    poster.draw.ellipse((x - 7, y - 7, x + 7, y + 7), outline=poster.colour("--ambe-plot-ink"), width=3)
    x, y = sx(sel["sigma"]), sy(-sel["gap"])
    poster.line([(x, sy(0)), (x, y)], "--ambe-highlight", 3)
    poster.dot((x, y), 7, "--ambe-highlight")
    poster.text((sl, st + sh + 52), "colour: recording, lj-a to lr-d", 16, "--ambe-text-2")
    poster.text((48, 672), f"At the same spread the gap differs by {sel['gap'] - partner['gap']:.1f} dB, "
                "so no constant converts one definition to the other.", 18, "--ambe-text-2")
