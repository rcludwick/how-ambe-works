#!/usr/bin/env python3
"""Draw the static fallback image of each interactive figure.

    uv run --locked --group data python tools/make-posters.py            # all
    uv run --locked --group data python tools/make-posters.py --only vq-space

A figure host shows this image without JS and in print (see the contract at
the top of docs/stylesheets/anim.css). Each figure adds one
tools/posters/<slug>.py with draw(poster, data_dir), which draws the figure
from the same JSON the figure reads. Output:
docs/assets/posters/<slug>.png, 1280x720.

Colours come from the light tokens in docs/stylesheets/extra.css (the
:root blocks; the figure contract and print both read the poster on a light
page), and text
from the vendored Source Sans 3 in tools/fonts/, so the output does not
depend on the machine's fonts. It draws pictures; it contains no codec
logic and reads no hex.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import re
import sys
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "assets" / "posters"
DATA_DIR = ROOT / "docs" / "assets" / "data"
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"
FONTS = {
    "regular": ROOT / "tools" / "fonts" / "SourceSans3-Regular.ttf",
    "semibold": ROOT / "tools" / "fonts" / "SourceSans3-Semibold.ttf",
}
SIZE = (1280, 720)

RGBA = tuple[int, int, int, int]


def _colour(value: str) -> RGBA | None:
    value = value.strip()
    hex_match = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
    if hex_match:
        digits = hex_match.group(1)
        return (int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16), 255)
    rgba = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
    if rgba:
        alpha = 1.0 if rgba.group(4) is None else float(rgba.group(4))
        return (int(rgba.group(1)), int(rgba.group(2)), int(rgba.group(3)), round(alpha * 255))
    return None


def slate_tokens(css: str) -> dict[str, RGBA]:
    """Colour tokens from every [data-md-color-scheme="slate"] block, in order."""
    tokens: dict[str, RGBA] = {}
    for block in re.findall(r'\[data-md-color-scheme="slate"\]\s*\{(.*?)\}', css, re.S):
        for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
            colour = _colour(re.sub(r"/\*.*?\*/", "", value))
            if colour:
                tokens[name] = colour
    return tokens


def light_tokens(css: str) -> dict[str, RGBA]:
    """Colour tokens from every block whose selectors include :root, in order."""
    tokens: dict[str, RGBA] = {}
    for selectors, block in re.findall(r"([^{}]*)\{([^{}]*)\}", re.sub(r"/\*.*?\*/", "", css, flags=re.S)):
        if ":root" not in [part.strip() for part in selectors.split(",")]:
            continue
        for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
            colour = _colour(value)
            if colour:
                tokens[name] = colour
    return tokens


class Poster:
    """A 1280x720 image on --ambe-plot-bg, drawn with theme tokens only."""

    def __init__(self, tokens: dict[str, RGBA]) -> None:
        self.tokens = tokens
        self.image = Image.new("RGB", SIZE, self.colour("--ambe-plot-bg")[:3])
        self.draw = ImageDraw.Draw(self.image, "RGBA")

    @classmethod
    def new(cls, theme: str = "light") -> "Poster":
        css = EXTRA_CSS.read_text(encoding="utf-8")
        return cls(light_tokens(css) if theme == "light" else slate_tokens(css))

    def colour(self, name: str) -> RGBA:
        if name not in self.tokens:
            raise KeyError(f"make-posters: {name} is not a colour token in extra.css")
        return self.tokens[name]

    def font(self, size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
        return ImageFont.truetype(str(FONTS[weight]), size)

    def text(self, xy, s: str, size: int, name: str = "--ambe-text-2", weight: str = "regular") -> None:
        self.draw.text(xy, s, font=self.font(size, weight), fill=self.colour(name))

    def line(self, points, name: str, width: int = 2) -> None:
        self.draw.line(points, fill=self.colour(name), width=width, joint="curve")

    def polyline(self, points, name: str, width: int = 2) -> None:
        self.line(points, name, width)

    def dot(self, xy, r: float, name: str) -> None:
        x, y = xy
        self.draw.ellipse((x - r, y - r, x + r, y + r), fill=self.colour(name))

    def rect(self, box, name: str, fill: bool = True, width: int = 1) -> None:
        if fill:
            self.draw.rectangle(box, fill=self.colour(name))
        else:
            self.draw.rectangle(box, outline=self.colour(name), width=width)


def render(draw: Callable[[Poster, Path], None]) -> Image.Image:
    poster = Poster.new()
    draw(poster, DATA_DIR)
    return poster.image


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=9)
    return buffer.getvalue()


POSTERS_DIR = ROOT / "tools" / "posters"


def _discover() -> dict[str, Callable[[Poster, Path], None]]:
    """slug -> draw(poster, data_dir), one module per figure in tools/posters/.

    tools/posters/harmonic_sum.py draws docs/assets/posters/harmonic-sum.png.
    Each figure branch adds its own file, so no branch edits this one.
    """
    found = {}
    for path in sorted(POSTERS_DIR.glob("*.py")):
        spec = importlib.util.spec_from_file_location(f"posters.{path.stem}", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        found[path.stem.replace("_", "-")] = module.draw
    return found


FIGURES: dict[str, Callable[[Poster, Path], None]] = _discover()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--only")
    args = parser.parse_args(argv)
    if args.only and args.only not in FIGURES:
        print(f"make-posters: no figure named {args.only}")
        return 2
    slugs = [args.only] if args.only else sorted(FIGURES)
    if not slugs:
        print("make-posters: no figures registered yet")
        return 0
    args.out.mkdir(parents=True, exist_ok=True)
    for slug in slugs:
        data = png_bytes(render(FIGURES[slug]))
        (args.out / f"{slug}.png").write_bytes(data)
        print(f"make-posters: {slug}.png ({len(data) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
