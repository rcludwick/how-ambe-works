#!/usr/bin/env python3
"""Generate the poster frames shown before a manim clip plays.

The rendered videos under ``docs/assets/video/`` are build output (see
``.github/workflows/animations.yml``) and are not committed, so every
``<video>`` on the site needs a committed poster image to show before the
first play. This script draws those posters from the site's own design
tokens: near-black layered surfaces, one accent, tight type.

It draws pictures. It contains no codec logic and reads no codec data.

Usage
-----
    python3 tools/make-posters.py            # write docs/assets/posters/*.png

Re-run it after changing a scene's title or duration. Output is
deterministic, so an unchanged run produces byte-identical files.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "assets" / "posters"

WIDTH, HEIGHT = 1280, 720

# Design tokens, copied from docs/stylesheets/extra.css section 2 (dark).
BG_TOP = (16, 17, 22)
BG_BOTTOM = (8, 9, 12)
TEXT = (242, 242, 247)
TEXT_2 = (195, 196, 205)
TEXT_3 = (141, 143, 155)
HAIRLINE = (38, 40, 48)
ACCENT = (125, 140, 255)  # --ambe-accent, indigo

FONT_CANDIDATES_BOLD = [
    "/System/Library/Fonts/Supplemental/HelveticaNeue.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
FONT_CANDIDATES_REGULAR = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# slug -> (title, subtitle, meta)
POSTERS = {
    "decomposition": (
        "Taking one frame apart",
        "Waveform to spectrum to harmonics to eight voicing bands,\n"
        "on 20 ms of a real ThumbDV capture.",
        "manim  ·  54 s  ·  scene_decomposition.py",
    ),
    "harmonic-sum": (
        "Building a voice out of cosines",
        "Twenty-two harmonics at their measured amplitudes,\n"
        "added one at a time until the pulse appears.",
        "manim  ·  43 s  ·  scene_harmonic_sum.py",
    ),
    "pipeline": (
        "One frame, end to end",
        "Microphone to nine bytes to sound, following a single\n"
        "frame of a captured D-STAR stream.",
        "manim  ·  68 s  ·  scene_pipeline.py",
    ),
    "vq": (
        "One index for a whole shape",
        "Why a codebook beats coding each number on its own,\n"
        "drawn on a synthetic cloud.",
        "manim  ·  37 s  ·  scene_vq.py",
    ),
}


def load_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


def vertical_gradient(width: int, height: int) -> Image.Image:
    img = Image.new("RGB", (1, height))
    px = img.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        # ease so the top stays flat and the fall-off gathers toward the base
        t = t * t * (3 - 2 * t)
        px[0, y] = tuple(
            round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)
        )
    return img.resize((width, height))


def draw_play_badge(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float) -> None:
    draw.ellipse(
        [cx - r, cy - r, cx + r, cy + r],
        outline=ACCENT,
        width=max(2, round(r * 0.045)),
    )
    s = r * 0.62
    h = s * math.sqrt(3) / 2
    draw.polygon(
        [
            (cx - h * 0.62, cy - s / 2),
            (cx - h * 0.62, cy + s / 2),
            (cx + h * 0.68, cy),
        ],
        fill=ACCENT,
    )


def make_poster(slug: str, title: str, subtitle: str, meta: str) -> Path:
    img = vertical_gradient(WIDTH, HEIGHT)
    draw = ImageDraw.Draw(img)

    f_kicker = load_font(FONT_CANDIDATES_REGULAR, 22)
    f_title = load_font(FONT_CANDIDATES_BOLD, 62)
    f_sub = load_font(FONT_CANDIDATES_REGULAR, 30)
    f_meta = load_font(FONT_CANDIDATES_REGULAR, 22)

    pad = 88

    # hairline frame, inset
    draw.rectangle([24, 24, WIDTH - 25, HEIGHT - 25], outline=HAIRLINE, width=1)

    draw.text((pad, pad), "HOW AMBE WORKS", font=f_kicker, fill=TEXT_3)

    # accent rule under the kicker
    draw.line([(pad, pad + 46), (pad + 64, pad + 46)], fill=ACCENT, width=3)

    draw.text((pad, 236), title, font=f_title, fill=TEXT)
    draw.multiline_text((pad, 336), subtitle, font=f_sub, fill=TEXT_2, spacing=12)

    draw.text((pad, HEIGHT - pad - 22), meta, font=f_meta, fill=TEXT_3)

    draw_play_badge(draw, WIDTH - pad - 70, HEIGHT - pad - 70, 62)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{slug}.png"
    img.save(path, format="PNG", optimize=True)
    return path


def main() -> None:
    for slug, (title, subtitle, meta) in POSTERS.items():
        path = make_poster(slug, title, subtitle, meta)
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
