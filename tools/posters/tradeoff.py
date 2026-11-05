"""Fallback image of the tradeoff figure (ch03): one sound at three block lengths.

The figure's made-up sound, made again here the way
docs/javascripts/anim-tradeoff.js makes it (the same seeded phases from
lib/prng.js mulberry32, the same vowels, fades and click), cut into 5, 20
and 80 ms Hann blocks: three spectrograms (frequency across, time down),
each above the spectrum of the block that holds 75 ms, in the highlight
with its strip outlined. In the light tokens, since print takes the light
theme. At 5 ms the click is a thin line and the harmonics are one ridge;
at 80 ms the harmonics are separate and the click is smeared. It draws
pictures; it holds no codec logic and reads no hex.
"""

from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"

WIDTH, HEIGHT = 1280, 720
FS, SAMPLES, NFFT = 8000, 3200, 4096
MAX_HZ, COLUMNS, FLOOR_DB = 2000, 128, -60.0
FINE = MAX_HZ * NFFT // FS + 1
SEED, F0, AT_MS = 1, 120, 75
SHAPE_A = [(700, 130), (1220, 70), (2600, 160)]
SHAPE_B = [(450, 80), (850, 90), (2600, 160)]
BLOCKS = (5, 20, 80)


def light_tokens() -> dict[str, tuple[int, int, int, int]]:
    """Colour tokens from extra.css's first :root block, the light theme."""
    css = EXTRA_CSS.read_text(encoding="utf-8")
    block = re.search(r":root\s*\{(.*?)\n\}", css, re.S).group(1)
    tokens = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
        value = re.sub(r"/\*.*?\*/", "", value).strip()
        hex_match = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
        if hex_match:
            d = hex_match.group(1)
            tokens[name] = (int(d[0:2], 16), int(d[2:4], 16), int(d[4:6], 16), 255)
    return tokens


def mulberry32(seed: int):
    """lib/prng.js mulberry32, in 32-bit arithmetic."""
    a = seed & 0xFFFFFFFF

    def imul(x: int, y: int) -> int:
        return (x * y) & 0xFFFFFFFF

    def draw() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return draw


def sound(f0: float) -> np.ndarray:
    """anim-tradeoff.js sound()."""
    random = mulberry32(SEED)
    phases = [2 * math.pi * random() for _ in range(64)]
    x = np.zeros(SAMPLES)
    fade = 80
    for (n0, n1), shape in (((0, 1600), SHAPE_A), ((1920, 3200), SHAPE_B)):
        n = np.arange(n0, n1)
        k = 1
        while k * f0 < 3800:
            f = k * f0
            gain = 1.0
            for big_f, bw in shape:
                gain *= big_f * big_f / math.hypot(big_f * big_f - f * f, bw * f)
            x[n0:n1] += gain * np.cos(2 * math.pi * f / FS * n + phases[k - 1])
            k += 1
        ramp = 0.5 - 0.5 * np.cos(math.pi * np.arange(fade) / fade)
        x[n0:n0 + fade] *= ramp
        x[n1 - fade:n1] *= ramp[::-1]
    x[1840] += 60
    return x


def picture(f0: float, block: int):
    """anim-tradeoff.js picture(): cells (rows x COLUMNS) and each row's spectrum, dB."""
    x = sound(f0)
    hop = block / 2
    rows = round(400 / hop)
    length = block * FS // 1000
    w = 0.5 - 0.5 * np.cos(2 * math.pi * (np.arange(length) + 0.5) / length)
    mags = []
    for r in range(rows):
        start = round(FS * (r + 0.5) * hop / 1000 - length / 2)
        seg = np.zeros(length)
        lo, hi = max(0, start), min(SAMPLES, start + length)
        seg[lo - start:hi - start] = x[lo:hi]
        mags.append(np.abs(np.fft.rfft(seg * w, NFFT))[:FINE])
    mags = np.array(mags)
    fine = np.maximum(FLOOR_DB, 20 * np.log10(np.maximum(mags, 1e-12) / mags.max()))
    per = (FINE - 1) // COLUMNS
    cells = np.array([[fine[r, c * per:(c + 1) * per].max() for c in range(COLUMNS)] for r in range(rows)])
    return hop, cells, fine


def valley_depth(spectrum: np.ndarray, f0: float) -> float:
    """anim-tradeoff.js valleyDepth()."""
    bin_hz = FS / NFFT
    depths = []
    k = 1
    while (k + 1) * f0 <= 1500:
        a, b = round(k * f0 / bin_hz), round((k + 1) * f0 / bin_hz)
        peak = min(spectrum[a - 2:a + 3].max(), spectrum[b - 2:b + 3].max())
        depths.append(peak - spectrum[a:b + 1].min())
        k += 1
    return float(np.median(depths))


# Colour, as lib/style.js does it: the ramp in OKLab, mixes in sRGB.

def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gam(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _lab(rgb) -> list[float]:
    r, g, b = (_lin(c / 255) for c in rgb[:3])
    l, m, s = (math.copysign(abs(v) ** (1 / 3), v) for v in (
        0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
        0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
        0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b))
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]


def _rgb(lab) -> tuple[int, int, int]:
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    return tuple(round(min(1, max(0, _gam(c))) * 255) for c in rgb)


def level_colours(tokens) -> list[tuple[int, int, int]]:
    """anim-tradeoff.js levelColour() on a white ground, a quarter dB per entry."""
    stops = [_lab(tokens[f"--ambe-ramp-{i}"]) for i in range(5)]
    bg = tokens["--ambe-plot-bg"]
    out = []
    steps = int(-FLOOR_DB * 4)
    for i in range(steps + 1):
        t = i / steps
        x = t * 4
        j = min(3, int(x))
        f = x - j
        c = _rgb([p + (q - p) * f for p, q in zip(stops[j], stops[j + 1])])
        amount = 0.82 * (1 - t) ** 3
        out.append(tuple(round(c[k] + (bg[k] - c[k]) * amount) for k in range(3)))
    return out


def draw(poster, data_dir: Path) -> None:
    tokens = light_tokens()
    poster.tokens = {**poster.tokens, **tokens}
    bg = poster.colour("--ambe-plot-bg")
    poster.draw.rectangle((0, 0, WIDTH, HEIGHT), fill=bg)
    lut = level_colours(tokens)

    def colour(db: float):
        return lut[round((min(0.0, max(FLOOR_DB, db)) - FLOOR_DB) * 4)]

    poster.text((40, 22), "One made-up sound cut into blocks of 5, 20 and 80 ms", 26, "--ambe-text", weight="semibold")
    poster.text((40, 58), "spectrogram above (time down), spectrum of the block at 75 ms below; synthetic", 18,
                "--ambe-text-3")
    panel_w, gap, left0 = 360, 44, 92
    gram_top, gram_h = 132, 300
    spec_top, spec_h = 458, 196
    for p, block in enumerate(BLOCKS):
        hop, cells, fine = picture(F0, block)
        rows = len(cells)
        x0 = left0 + p * (panel_w + gap)
        x1 = x0 + panel_w
        cw = panel_w / COLUMNS
        rh = gram_h / rows
        for r in range(rows):
            for c in range(COLUMNS):
                poster.draw.rectangle((x0 + c * cw, gram_top + r * rh, x0 + (c + 1) * cw, gram_top + (r + 1) * rh),
                                      fill=colour(cells[r][c]))
        sel = int(AT_MS // hop)
        hl = poster.colour("--ambe-highlight")
        poster.draw.rectangle((x0 - 2, gram_top + sel * rh - 2, x1 + 2, gram_top + (sel + 1) * rh + 2), outline=hl, width=3)
        poster.text((x0, gram_top - 36), f"{block} ms blocks: 1/T = {1000 / block:g} Hz", 20, "--ambe-text",
                    weight="semibold")
        if p == 0:
            for t in (0, 100, 200, 300, 400):
                y = gram_top + gram_h * t / 400
                poster.line([(x0 - 6, y), (x0, y)], "--ambe-plot-axis", 1)
                poster.text((x0 - 50, y - 10), str(t), 16, "--ambe-text-3")
            poster.text((x0 - 84, gram_top - 30), "time (ms)", 14, "--ambe-text-3")
        if p < len(BLOCKS) - 1:
            poster.text((x1 + 6, gram_top + gram_h * 230 / 400 - 10), "click", 15, "--ambe-text-3")
        # The block's spectrum, frosted, in the highlight.
        def at(k: int, db: float):
            return (x0 + panel_w * k / (FINE - 1), spec_top + spec_h * (-db) / -FLOOR_DB)

        for db in (-20, -40):
            poster.line([at(0, db), at(FINE - 1, db)], "--ambe-plot-grid", 1)
        pts = [at(k, float(fine[sel][k])) for k in range(FINE)]
        poster.draw.polygon(pts + [at(FINE - 1, FLOOR_DB), at(0, FLOOR_DB)], fill=poster.colour("--ambe-highlight-fill-top"))
        poster.draw.line(pts, fill=hl, width=3, joint="curve")
        poster.line([at(0, FLOOR_DB), at(FINE - 1, FLOOR_DB)], "--ambe-plot-axis", 1)
        poster.line([at(0, 0), at(0, FLOOR_DB)], "--ambe-plot-axis", 1)
        for hz in (0, 1000, 2000):
            x, y = at(hz * (FINE - 1) // MAX_HZ, FLOOR_DB)
            poster.text((x - 8, y + 6), f"{hz // 1000}k" if hz else "0", 15, "--ambe-text-3")
        if (sel + 0.5) * hop - block / 2 >= 0 and (sel + 0.5) * hop + block / 2 <= 200:
            depth = valley_depth(fine[sel], F0)
            note = f"valleys {depth:.1f} dB deep"
        else:
            note = "not inside one vowel"
        poster.text((x0, spec_top + spec_h + 30), note, 16, "--ambe-text-2")
    poster.text((left0 - 84, spec_top - 6), "0 dB", 14, "--ambe-text-3")
    poster.text((left0 - 84, spec_top + spec_h - 10), "-60 dB", 14, "--ambe-text-3")
