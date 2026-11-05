"""Fallback image of the utterance-spectra figure (ch01): one sentence as a waterfall.

lj-c ("She sells sea shells"), seen from the Corner pose of the 3D view: one
spectrum every 20 ms, front to back in time, drawn back to front as a
hidden-line waterfall (each slice's curtain hides the slices behind it). Lines
take the sequential ramp by level; the low-heavy window (the first step's
pick, the rule in docs/javascripts/lib/picks.js and tools/verify-data.py) is
in the highlight with its outline and chip; total energy stands on the wall
at the 0 Hz side. Light tokens (the :root block of extra.css), since the
poster is what print shows. Drawn at twice the size and scaled down, so lines
are smooth. It draws pictures from spectra.json; no codec logic, no hex.
"""

from __future__ import annotations

import importlib.util
import json
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"
FONTS = ROOT / "tools" / "fonts"
CLIP = "lj-c"
FLOOR_DB, BOX_S, HOP_S = -85.0, 3.7, 0.02
EXTENT = (2.0, 0.9, 2.4)
YAW, PITCH = 42.0, 24.0
SCALE = 2
W, H = 1280 * SCALE, 720 * SCALE


def _verify_data():
    spec = importlib.util.spec_from_file_location("verify_data", ROOT / "tools" / "verify-data.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def light_tokens() -> dict[str, tuple[int, int, int, int]]:
    """Colour tokens of the :root block (light, and print)."""
    css = EXTRA_CSS.read_text(encoding="utf-8")
    block = re.search(r":root\s*\{(.*?)\n\}", css, re.S).group(1)
    tokens = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
        value = re.sub(r"/\*.*?\*/", "", value).strip()
        if m := re.fullmatch(r"#([0-9a-fA-F]{6})", value):
            d = m.group(1)
            tokens[name] = (int(d[0:2], 16), int(d[2:4], 16), int(d[4:6], 16), 255)
        elif m := re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value):
            alpha = 1.0 if m.group(4) is None else float(m.group(4))
            tokens[name] = (int(m.group(1)), int(m.group(2)), int(m.group(3)), round(alpha * 255))
    return tokens


def _mix(a, b, t: float):
    return tuple(round(x + (y - x) * t) for x, y in zip(a[:3], b[:3])) + (255,)


def ramp(tokens, t: float):
    """The ramp at t, between its five stops (sRGB here; the figure mixes in OKLab)."""
    stops = [tokens[f"--ambe-ramp-{i}"] for i in range(5)]
    x = max(0.0, min(1.0, t)) * 4
    i = min(3, int(x))
    return _mix(stops[i], stops[i + 1], x - i)


def low_heavy(spectra: dict) -> int:
    return _verify_data().SPECTRA_PICKS["low-heavy"](spectra["original"], spectra["bin_centre_hz"])


class Camera:
    """The 3D view's orthographic Corner camera, fitted to the frame."""

    def __init__(self, box) -> None:
        y, p = math.radians(YAW), math.radians(PITCH)
        back = (math.cos(p) * math.sin(y), math.sin(p), math.cos(p) * math.cos(y))
        right = (back[2], 0.0, -back[0])
        n = math.hypot(right[0], right[2])
        self.right = (right[0] / n, 0.0, right[2] / n)
        r, b = self.right, back
        self.up = (b[1] * r[2] - b[2] * r[1], b[2] * r[0] - b[0] * r[2], b[0] * r[1] - b[1] * r[0])
        corners = [(x, yy, z) for x in box[0] for yy in box[1] for z in box[2]]
        us = [self._u(c) for c in corners]
        vs = [self._v(c) for c in corners]
        left, right_, top, bottom = 150 * SCALE, 90 * SCALE, 90 * SCALE, 90 * SCALE
        self.s = min((W - left - right_) / (max(us) - min(us)), (H - top - bottom) / (max(vs) - min(vs)))
        self.ox = left + ((W - left - right_) - (max(us) - min(us)) * self.s) / 2 - min(us) * self.s
        self.oy = top + ((H - top - bottom) - (max(vs) - min(vs)) * self.s) / 2 + max(vs) * self.s

    def _u(self, p) -> float:
        return sum(a * b for a, b in zip(p, self.right))

    def _v(self, p) -> float:
        return sum(a * b for a, b in zip(p, self.up))

    def __call__(self, p) -> tuple[float, float]:
        return self.ox + self._u(p) * self.s, self.oy - self._v(p) * self.s


def draw(poster, data_dir: Path) -> None:
    tokens = light_tokens()
    spectra = json.loads((data_dir / CLIP / "spectra.json").read_text(encoding="utf-8"))
    frames, hz = spectra["original"], spectra["bin_centre_hz"]
    nyquist = hz[-1]
    pick = low_heavy(spectra)
    ex, ey, ez = EXTENT
    sx = lambda f: f / nyquist * ex - ex / 2  # noqa: E731
    sy = lambda db: (max(FLOOR_DB, min(0.0, db)) - FLOOR_DB) / -FLOOR_DB * ey - ey / 2  # noqa: E731
    sz = lambda t: ez / 2 - t / BOX_S * ez  # noqa: E731
    x0, x1, y0, y1, z0, z1 = -ex / 2, ex / 2, -ey / 2, ey / 2, -ez / 2, ez / 2
    cam = Camera(((x0, x1), (y0, y1), (z0, z1)))

    image = Image.new("RGB", (W, H), tokens["--ambe-plot-bg"][:3])
    g = ImageDraw.Draw(image, "RGBA")
    bg = tokens["--ambe-plot-bg"]

    def font(size: int, weight: str = "Regular"):
        return ImageFont.truetype(str(FONTS / f"SourceSans3-{weight}.ttf"), size * SCALE)

    # Floor and its grid: 1 kHz across, 0.5 s deep.
    g.polygon([cam((x0, y0, z0)), cam((x1, y0, z0)), cam((x1, y0, z1)), cam((x0, y0, z1))],
              fill=tokens["--ambe-3d-floor"])
    for f in range(0, 4001, 1000):
        if f <= nyquist:
            g.line([cam((sx(f), y0, z0)), cam((sx(f), y0, z1))], fill=tokens["--ambe-3d-grid"], width=SCALE)
    t = 0.0
    while t <= BOX_S + 1e-9:
        g.line([cam((x0, y0, sz(t))), cam((x1, y0, sz(t)))], fill=tokens["--ambe-3d-grid"], width=SCALE)
        t += 0.5

    # The wall at 0 Hz: each window's total energy, never below its highest bin.
    wall = _verify_data()
    energy = [sy(wall.total_db(bins)) for bins in frames]
    pts = [cam((x0, energy[c], sz(c * HOP_S))) for c in range(len(frames))]
    g.polygon(pts + [cam((x0, y0, sz((len(frames) - 1) * HOP_S))), cam((x0, y0, sz(0)))],
              fill=_mix(tokens["--ambe-plot-muted"], tokens["--ambe-3d-floor"], 0.5))
    g.line(pts, fill=tokens["--ambe-plot-muted"], width=2 * SCALE, joint="curve")

    # Slices, back to front: each curtain hides what is behind it.
    chosen = []
    for c in range(len(frames) - 1, -1, -1):
        z = sz(c * HOP_S)
        ys = [sy(db) for db in frames[c]]
        line = [cam((sx(f), y, z)) for f, y in zip(hz, ys)]
        foot = [cam((sx(hz[-1]), y0, z)), cam((sx(hz[0]), y0, z))]
        if c == pick:
            g.polygon(line + foot, fill=tokens["--ambe-highlight-fill-top"])
            outline = _mix(tokens["--ambe-highlight"], bg, 0.3)
            corners = [cam((x0, y0, z)), cam((x1, y0, z)), cam((x1, y1, z)), cam((x0, y1, z)), cam((x0, y0, z))]
            for a, b in zip(corners, corners[1:]):
                _dashed(g, a, b, outline, 2 * SCALE)
            chosen = line
            continue
        # Cutaway: the windows in front of the highlight keep their lines only.
        if c > pick:
            g.polygon(line + foot, fill=_mix(ramp(tokens, (max(ys) - y0) / ey), bg, 0.86))
        for k in range(len(line) - 1):
            g.line([line[k], line[k + 1]], fill=ramp(tokens, ((ys[k] + ys[k + 1]) / 2 - y0) / ey), width=SCALE)

    # The highlight line last: nothing covers it.
    g.line(chosen, fill=tokens["--ambe-highlight"], width=round(3.25 * SCALE), joint="curve")

    # Axes, labels and the chip.
    ink, text3 = tokens["--ambe-plot-ink"], tokens["--ambe-text-3"]
    g.line([cam((x0, y0, z1)), cam((x1, y0, z1))], fill=tokens["--ambe-plot-axis"], width=SCALE)
    g.line([cam((x1, y0, z1)), cam((x1, y0, z0))], fill=tokens["--ambe-plot-axis"], width=SCALE)
    g.line([cam((x0, y0, z1)), cam((x0, y1, z1))], fill=tokens["--ambe-plot-axis"], width=SCALE)
    small = font(17)
    for f in (0, 1000, 2000, 3000):
        x, y = cam((sx(f), y0, z1))
        g.text((x, y + 10 * SCALE), "0" if f == 0 else f"{f // 1000}k", font=small, fill=text3, anchor="mt")
    x, y = cam((0.0, y0, z1))
    g.text((x, y + 34 * SCALE), "frequency, Hz", font=font(19), fill=text3, anchor="mt")
    for s in (0, 1, 2, 3):
        x, y = cam((x1, y0, sz(s)))
        g.text((x + 12 * SCALE, y), f"{s} s", font=small, fill=text3, anchor="lm")
    x, y = cam((x1, y0, sz(BOX_S / 2)))
    g.text((x + 60 * SCALE, y + 10 * SCALE), "time", font=font(19), fill=text3, anchor="lm")
    for db in (-80, -40, 0):
        x, y = cam((x0, sy(db), z1))
        g.text((x - 10 * SCALE, y), f"{db}", font=small, fill=text3, anchor="rm")
    x, y = cam((x0, y1, z1))
    g.text((x - 10 * SCALE, y - 28 * SCALE), "dBFS", font=font(19), fill=text3, anchor="rm")

    peak = max(range(len(hz)), key=lambda k: frames[pick][k])
    ax, ay = cam((sx(hz[peak]), sy(frames[pick][peak]), sz(pick * HOP_S)))
    chip = f"this frame: 20 ms at {pick * HOP_S:.2f} s"
    cf = font(20, "Semibold")
    bx, by = ax + 70 * SCALE, ay - 70 * SCALE
    box = g.textbbox((bx + 30 * SCALE, by), chip, font=cf, anchor="lm")
    pad = 10 * SCALE
    rect = (bx, box[1] - pad, box[2] + pad, box[3] + pad)
    g.line([(ax, ay), (bx, by)], fill=tokens["--ambe-highlight"], width=round(1.5 * SCALE))
    g.ellipse((ax - 5 * SCALE, ay - 5 * SCALE, ax + 5 * SCALE, ay + 5 * SCALE), fill=tokens["--ambe-highlight"])
    g.rounded_rectangle(rect, radius=6 * SCALE, fill=tokens["--ambe-highlight-chip"],
                        outline=tokens["--ambe-highlight"], width=round(1.5 * SCALE))
    g.line([(bx + 10 * SCALE, by), (bx + 24 * SCALE, by)], fill=tokens["--ambe-highlight"], width=3 * SCALE)
    g.text((bx + 30 * SCALE, by), chip, font=cf, fill=ink, anchor="lm")

    g.text((40 * SCALE, 30 * SCALE), f"Every 20 ms window of “{spectra['clip']['text']}”", font=font(28, "Semibold"),
           fill=tokens["--ambe-text"])
    g.text((40 * SCALE, 68 * SCALE), "Thin lines: the other windows, coloured by level. "
           "Wall at 0 Hz: each window's total energy.", font=font(19), fill=text3)
    g.text((40 * SCALE, H - 44 * SCALE), "derived (from the input audio): an ordinary FFT, not the codec's spectrum",
           font=font(17), fill=text3)

    poster.image.paste(image.resize((1280, 720), Image.LANCZOS))


def _dashed(g, a, b, colour, width: int) -> None:
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    step, dash = 14 * SCALE, 8 * SCALE
    d = 0.0
    while d < length:
        e = min(length, d + dash)
        g.line([(a[0] + (b[0] - a[0]) * d / length, a[1] + (b[1] - a[1]) * d / length),
                (a[0] + (b[0] - a[0]) * e / length, a[1] + (b[1] - a[1]) * e / length)], fill=colour, width=width)
        d += step
