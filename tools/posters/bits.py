"""Fallback image of the bits figure (ch10): frame 98's 72 bits.

The 72 channel bits of frame 98 of docs/assets/data/frames.json, nine bytes
by eight bits as the figure draws them (bit 0 is the most significant bit of
byte 0), each cell a 1 or a 0, with the bits that differ from frame 97
outlined in the highlight. Drawn in the light tokens (:root in extra.css),
since print shows this image. It splits the captured hex into single bits,
as hexBits() in anim-core.js does, and joins none: no bit is read as part
of a value, and no field is drawn, because the field layout is not
publicly documented.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"
FRAME = 98

CELL, GAP = 56, 8
GRID_X, GRID_Y = 196, 112  # top left of bit 0's cell
HEX_X = GRID_X + 8 * CELL + 7 * GAP + 18
PANEL_X = 800


def frames(data: Path) -> list[dict]:
    return json.loads((data / "frames.json").read_text(encoding="utf-8"))["frames"]


def bits(hex_frame: str) -> list[int]:
    """72 single bits in wire order, as hexBits() in anim-core.js."""
    return [(int(hex_frame[n // 4], 16) >> (3 - n % 4)) & 1 for n in range(72)]


def changed(fr: list[dict], i: int = FRAME) -> list[int]:
    """1 where frame i's bit differs from frame i - 1's."""
    a, b = bits(fr[i - 1]["hex"]), bits(fr[i]["hex"])
    return [int(x != y) for x, y in zip(a, b)]


def light_tokens() -> dict:
    """The light theme's colour tokens: the first :root block of extra.css."""
    css = EXTRA_CSS.read_text(encoding="utf-8")
    block = re.search(r":root\s*\{(.*?)\n\}", css, re.S).group(1)
    tokens = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
        colour = _colour(re.sub(r"/\*.*?\*/", "", value).strip())
        if colour:
            tokens[name] = colour
    return tokens


def _colour(value: str):
    """#rrggbb or rgb()/rgba() as RGBA, as make-posters.py reads them."""
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
    if m:
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
    if m:
        alpha = 1.0 if m.group(4) is None else float(m.group(4))
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)), round(alpha * 255))
    return None


def _lum(rgb) -> float:
    def f(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4
    r, g, b = (f(c) for c in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ink_on(poster, fill: str) -> str:
    """Whichever of plot ink and plot background reads better on `fill`."""
    l = _lum(poster.colour(fill))

    def ratio(name: str) -> float:
        m = _lum(poster.colour(name))
        return (max(l, m) + 0.05) / (min(l, m) + 0.05)

    return "--ambe-plot-ink" if ratio("--ambe-plot-ink") >= ratio("--ambe-plot-bg") else "--ambe-plot-bg"


def draw(poster, data: Path) -> None:
    poster.tokens = light_tokens()
    d = poster.draw
    d.rectangle((0, 0, *poster.image.size), fill=poster.colour("--ambe-plot-bg"))
    fr = frames(data)
    row = bits(fr[FRAME]["hex"])
    flips = changed(fr)

    poster.text((GRID_X - 120, 40), f"One 20 ms voice frame, frame {FRAME} of the clip: 72 bits as transmitted",
                26, "--ambe-text-2", "semibold")

    # The board behind the grid, its lines in the gaps, as the 3D view's.
    x0, y0 = GRID_X - GAP // 2, GRID_Y - GAP // 2
    x1, y1 = x0 + 8 * (CELL + GAP), y0 + 9 * (CELL + GAP)
    d.rectangle((x0, y0, x1, y1), fill=poster.colour("--ambe-3d-floor"))
    for c in range(9):
        d.line((x0 + c * (CELL + GAP), y0, x0 + c * (CELL + GAP), y1), fill=poster.colour("--ambe-3d-grid"), width=1)
    for r in range(10):
        d.line((x0, y0 + r * (CELL + GAP), x1, y0 + r * (CELL + GAP)), fill=poster.colour("--ambe-3d-grid"), width=1)

    for c in range(8):
        poster.text((GRID_X + c * (CELL + GAP) + CELL // 2 - 5, GRID_Y - 34), str(c), 20, "--ambe-text-4")
    digit = poster.font(30, "semibold")
    label = poster.font(20)
    for n, v in enumerate(row):
        r, c = divmod(n, 8)
        x, y = GRID_X + c * (CELL + GAP), GRID_Y + r * (CELL + GAP)
        fill = "--ambe-data-1" if v else "--ambe-surface-2"
        d.rounded_rectangle((x, y, x + CELL, y + CELL), radius=4, fill=poster.colour(fill),
                            outline=poster.colour("--ambe-3d-grid"), width=2)
        ink = ink_on(poster, fill) if v else "--ambe-text-4"
        d.text((x + CELL / 2, y + CELL / 2), str(v), font=digit, fill=poster.colour(ink), anchor="mm")
        if flips[n]:
            d.rounded_rectangle((x + 2, y + 2, x + CELL - 2, y + CELL - 2), radius=4,
                                outline=poster.colour("--ambe-highlight"), width=4)
    for b in range(9):
        y = GRID_Y + b * (CELL + GAP) + CELL / 2
        d.text((GRID_X - 14, y), f"byte {b}", font=label, fill=poster.colour("--ambe-text-3"), anchor="rm")
        d.text((HEX_X, y), f"0x{fr[FRAME]['hex'][2 * b:2 * b + 2]}", font=label,
               fill=poster.colour("--ambe-text-3"), anchor="lm")

    # The legend and the honesty note, beside the grid.
    y = GRID_Y
    count = sum(flips)
    chip = f"{count} of 72 bits changed since the last frame"
    w = d.textlength(chip, font=poster.font(22, "semibold"))
    d.rounded_rectangle((PANEL_X, y, PANEL_X + w + 64, y + 44), radius=6, fill=poster.colour("--ambe-highlight-chip"),
                        outline=poster.colour("--ambe-highlight"), width=2)
    d.rectangle((PANEL_X + 16, y + 20, PANEL_X + 40, y + 24), fill=poster.colour("--ambe-highlight"))
    poster.text((PANEL_X + 52, y + 8), chip, 22, "--ambe-plot-ink", "semibold")
    y += 84
    for fill, text, line in (("--ambe-data-1", "bit = 1", False), ("--ambe-surface-2", "bit = 0", False),
                             ("--ambe-surface-2", "changed since frame 97 (outlined)", True)):
        d.rounded_rectangle((PANEL_X, y, PANEL_X + 28, y + 28), radius=4, fill=poster.colour(fill),
                            outline=poster.colour("--ambe-highlight" if line else "--ambe-3d-grid"), width=3 if line else 2)
        poster.text((PANEL_X + 44, y), text, 22, "--ambe-text-2")
        y += 44
    y += 30
    for text, name, weight in (
        ("The colours are measurements,", "--ambe-plot-ink", "semibold"),
        ("not a field map.", "--ambe-plot-ink", "semibold"),
        ("Which of these positions carries the", "--ambe-text-2", "regular"),
        ("fundamental, the voicing bits, the gain or", "--ambe-text-2", "regular"),
        ("the error-correction parity is not publicly", "--ambe-text-2", "regular"),
        ("documented.", "--ambe-text-2", "regular"),
    ):
        poster.text((PANEL_X, y), text, 22, name, weight)
        y += 32
    y += 24
    for text in ("Source: frames[].hex, 72-bit channel frames", "captured from a DVSI AMBE-3000 (ThumbDV)."):
        poster.text((PANEL_X, y), text, 18, "--ambe-text-3")
        y += 26
