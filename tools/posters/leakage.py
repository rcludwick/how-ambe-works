"""Fallback image for the leakage figure (docs/03-windows-and-frames.md).

One cosine (phase 0) at 6.5 cycles in a 160-sample block, with the weak
second tone at 1500 Hz (bin 30, amplitude 0.003), cut two ways side by side.
Each column has the strip (three copies of the block end to end, the step
at each joint marked) over the spectrum (81 stems in dB below the peak, on
the ramp by level, the highlight along their tips and a chip counting the
bins above -40 dB). Left: rectangular, a step of 2 at each joint, all 81
bins above -40 dB and the weak tone buried. Right: periodic Hann, no step,
skirts some 50 dB lower (past -80 dB by bin 23) and the weak tone clear at -49.0 dB. Drawn in the light
tokens, as print shows the page. Mirrors docs/javascripts/lib/leakage.js;
synthetic, it reads no data.
"""

from __future__ import annotations

import math
import re
from pathlib import Path

from PIL import Image, ImageDraw

N = 160
BINS = N // 2 + 1
FLOOR_DB = -100.0
COUNT_DB = -40.0
CYCLES = 6.5
WEAK_HZ = 1500
WEAK_AMPLITUDE = 0.003
SAMPLE_RATE = 8000
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


def window_at(name: str, n: float) -> float:
    return 0.5 - 0.5 * math.cos(2 * math.pi * n / N) if name == "hann" else 1.0


def tone_at(n: float, weak: bool = True) -> float:
    main = math.cos(2 * math.pi * CYCLES * n / N)
    return main + WEAK_AMPLITUDE * math.cos(2 * math.pi * WEAK_HZ * n / SAMPLE_RATE) if weak else main


def spectrum_db(name: str, weak: bool = True) -> list[float]:
    """Bins 0 to 80 in dB below the peak, at least FLOOR_DB (lib/leakage.js spectrumDb)."""
    x = [tone_at(n, weak) * window_at(name, n) for n in range(N)]
    mags = []
    for k in range(BINS):
        re_ = sum(x[n] * math.cos(2 * math.pi * k * n / N) for n in range(N))
        im = sum(x[n] * math.sin(2 * math.pi * k * n / N) for n in range(N))
        mags.append(math.hypot(re_, im))
    peak = max(mags)
    return [max(FLOOR_DB, 20 * math.log10(m / peak)) if m > 0 else FLOOR_DB for m in mags]


def joint_step(name: str) -> float:
    return abs(tone_at(N) * window_at(name, N) - tone_at(0) * window_at(name, 0))


def ramp(tokens, t: float) -> tuple[int, int, int, int]:
    """The ramp at t, linear in sRGB between the five stops (the poster's
    stand-in for the OKLab ramp of lib/style.js)."""
    stops = [tokens[f"--ambe-ramp-{i}"] for i in range(5)]
    x = min(1.0, max(0.0, t)) * 4
    i = min(3, int(x))
    f = x - i
    a, b = stops[i], stops[i + 1]
    return tuple(round(a[j] + (b[j] - a[j]) * f) for j in range(3)) + (255,)


def label(poster, xy, text: str, size: int, name: str) -> None:
    """Text on a plot-background box, so it reads over the data."""
    x, y = xy
    box = poster.draw.textbbox((x, y), text, font=poster.font(size))
    poster.rect((box[0] - 3, box[1] - 2, box[2] + 3, box[3] + 2), "--ambe-plot-bg")
    poster.text((x, y), text, size, name)


def draw(poster, data_dir: Path) -> None:
    # The light scheme, as print and the JS-off page show the figure.
    poster.tokens = {**poster.tokens, **light_tokens(EXTRA_CSS.read_text(encoding="utf-8"))}
    poster.image = Image.new("RGB", poster.image.size, poster.colour("--ambe-plot-bg")[:3])
    poster.draw = ImageDraw.Draw(poster.image, "RGBA")

    poster.text((48, 26), "One tone, one cut, and where its energy lands", 30, "--ambe-text", weight="semibold")
    poster.text((48, 68), "A cosine at 6.5 cycles in a 160-sample block, with a weak tone at 1500 Hz, cut two ways",
                18, "--ambe-text-3")

    for column, (name, title) in enumerate([("rect", "Rectangular cut"), ("hann", "Hann window")]):
        left = 76 + column * 612
        width = 540
        db = spectrum_db(name)
        step = joint_step(name)
        poster.text((left, 108), title, 22, "--ambe-text", weight="semibold")

        # The strip: three copies of the windowed block, the joints marked.
        s_top, s_bottom = 146, 238
        mid = (s_top + s_bottom) / 2
        half = (s_bottom - s_top) / 2 / 1.25

        def sx(n: float) -> float:
            return left + n / (3 * N) * width

        poster.rect((sx(N), s_top, sx(2 * N), s_bottom), "--ambe-surface-2")
        poster.rect((left, s_top, left + width, s_bottom), "--ambe-plot-axis", fill=False)
        for c in range(3):
            pts = [(sx(c * N + n / 2), mid - tone_at(n / 2) * window_at(name, n / 2) * half) for n in range(2 * N + 1)]
            poster.polyline(pts, "--ambe-data-1", 2)
        end = tone_at(N) * window_at(name, N)
        start = tone_at(0) * window_at(name, 0)
        for c in (1, 2):
            if step > 0.02:
                poster.line([(sx(c * N), mid - end * half), (sx(c * N), mid - start * half)], "--ambe-accent-warm", 5)
            else:
                poster.dot((sx(c * N), mid - start * half), 5, "--ambe-accent-warm")
        joint = f"a step of {step:.2f} at each joint" if step > 0.005 else "the copies meet: no step"
        label(poster, (sx(N) + 8, s_top + 4), joint, 15, "--ambe-accent-warm")

        # The spectrum: stems on the ramp by level, -40 dB dashed.
        p_top, p_bottom = 296, 640

        def px(k: float) -> float:
            return left + (k + 1.5) / 83 * width

        def py(v: float) -> float:
            return p_top + (6 - v) / 106 * (p_bottom - p_top)

        for v in (-80, -60, -40, -20, 0):
            poster.line([(left, py(v)), (left + width, py(v))], "--ambe-plot-grid", 1)
        poster.rect((left, p_top, left + width, p_bottom), "--ambe-plot-axis", fill=False)
        # -40 dB is named in the tick column, beside its dashed line, so no
        # label sits over a stem.
        for v in (-100, -60, -40, -20, 0):
            tone = "--ambe-text-2" if v == COUNT_DB else "--ambe-text-3"
            poster.text((left - 40, py(v) - 9), "−100" if v == -100 else ("0" if v == 0 else f"−{-v}"), 14, tone)
        x = left
        while x < left + width:
            poster.line([(x, py(COUNT_DB)), (min(x + 6, left + width), py(COUNT_DB))], "--ambe-plot-ink", 1)
            x += 11
        for k in range(BINS):
            if db[k] <= FLOOR_DB:
                continue
            colour = ramp(poster.tokens, (db[k] - FLOOR_DB) / -FLOOR_DB)
            poster.draw.line([(px(k), py(FLOOR_DB)), (px(k), py(db[k]))], fill=colour, width=3)
        # The highlight along the stem tips, and its chip.
        poster.polyline([(px(k), py(db[k])) for k in range(BINS)], "--ambe-highlight", 4)
        count = sum(1 for v in db if v > COUNT_DB)
        chip_text = f"6.50 cycles: {'all 81 bins' if count == BINS else f'{count} bins'} above −40 dB"
        peak = max(range(BINS), key=lambda k: db[k])
        chip = (px(peak) + 22, p_top + 8, px(peak) + 22 + 300, p_top + 40)
        poster.line([(px(peak), py(db[peak])), (chip[0], (chip[1] + chip[3]) / 2)], "--ambe-highlight", 2)
        poster.dot((px(peak), py(db[peak])), 5, "--ambe-highlight")
        poster.rect(chip, "--ambe-highlight-chip")
        poster.rect(chip, "--ambe-highlight", fill=False, width=2)
        poster.text((chip[0] + 10, chip[1] + 6), chip_text, 16, "--ambe-plot-ink")
        weak = f"bin 30, the weak tone: {db[30]:.1f} dB".replace("-", "−")
        label(poster, (px(30) - 30, py(-12) - 4), weak, 14, "--ambe-text-2")
        for k in (0, 20, 40, 60, 80):
            poster.text((px(k) - 8, p_bottom + 6), str(k), 14, "--ambe-text-3")
        poster.text((left + width / 2 - 100, p_bottom + 28), "bin, 50 Hz apart (bin 80 is 4 kHz)", 15, "--ambe-text-3")
    poster.text((48, 692), "dB below the peak. Synthetic: one cosine, phase 0, transformed. "
                "Windows after Harris (1978). AMBE's own window is not shown.", 14, "--ambe-text-3")
