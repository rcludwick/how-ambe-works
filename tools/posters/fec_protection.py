"""Fallback image of the fec-protection figure (ch10): step 2's end state.

The patent's assignment (US 5,870,405): Golay (23,12) on u0 to u3, Hamming
(15,11) on u4 to u6, u7 bare. Top left, the chance that a vector arrives
wrong against the bit error rate on a log axis, the Hamming curve in the
highlight; top right, the eight vectors at 5% bit errors; bottom, one
144-bit frame taking a burst of 7 errors from bit 57 through the
illustrative interleaver of docs/javascripts/lib/fec.js, which leaves two
errors in u4, a Hamming word, so it fails. Drawn in the light tokens
(:root in extra.css), since print shows this image. Pure arithmetic: no
data file, no bits, no decoding.
"""

from __future__ import annotations

import re
from math import comb, log10
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"

# The same constant as INTERLEAVER in docs/javascripts/lib/fec.js.
INTERLEAVER = (
    "032154672105342601352406153240153240615237014263015263015423016423016523071423051623401623401623571023451023671043261073542103562103562103742103"
)
N = [23, 23, 23, 23, 15, 15, 15, 7]
K = [12, 12, 12, 12, 11, 11, 11, 7]
T = [3, 3, 3, 3, 1, 1, 1, 0]
NAMES = [f"u{c}" for c in "₀₁₂₃₄₅₆₇"]
GROUP = [0, 0, 0, 0, 1, 1, 1, 2]
GROUP_TOKEN = ["--ambe-cat-1", "--ambe-cat-2", "--ambe-cat-3"]
CODE_NAME = ["Golay", "Golay", "Golay", "Golay", "Hamming", "Hamming", "Hamming", "bare"]
BER = 0.05
START, LENGTH = 57, 7
BER_MAX = 0.1


def fail_prob(n: int, t: int, p: float) -> float:
    """More than t of n bits wrong, each with probability p."""
    return sum(comb(n, e) * p ** e * (1 - p) ** (n - e) for e in range(t + 1, n + 1))


def air_order() -> list[tuple[int, int]]:
    seen = [0] * 8
    out = []
    for c in INTERLEAVER:
        v = int(c)
        out.append((v, seen[v]))
        seen[v] += 1
    return out


def burst() -> list[tuple[int, int, int]]:
    """(position, vector, bit) of each error."""
    order = air_order()
    return [(p, *order[p]) for p in range(START, START + LENGTH)]


def errors_per_vector() -> list[int]:
    counts = [0] * 8
    for _, v, _ in burst():
        counts[v] += 1
    return counts


def light_tokens() -> dict:
    css = EXTRA_CSS.read_text(encoding="utf-8")
    block = re.search(r":root\s*\{(.*?)\n\}", css, re.S).group(1)
    tokens = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
        colour = _colour(re.sub(r"/\*.*?\*/", "", value).strip())
        if colour:
            tokens[name] = colour
    return tokens


def _colour(value: str):
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
    if m:
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
    if m:
        alpha = 1.0 if m.group(4) is None else float(m.group(4))
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)), round(alpha * 255))
    return None


def mix(a, b, t: float):
    return tuple(round(x + (y - x) * t) for x, y in zip(a[:3], b[:3])) + (255,)


def draw(poster, data: Path) -> None:
    poster.tokens = light_tokens()
    d = poster.draw
    col = poster.colour
    bg = col("--ambe-plot-bg")
    d.rectangle((0, 0, *poster.image.size), fill=bg)
    small = poster.font(18)

    # The curves.
    x0, y0, w, h = 120, 70, 560, 300
    poster.text((40, 22), "Chance a vector arrives wrong", 24, "--ambe-text-2", "semibold")

    def y_of(P: float) -> float:
        return y0 + h * -log10(max(P, 1e-5)) / 5

    for k in range(6):
        y = y0 + h * k / 5
        d.line((x0, y, x0 + w, y), fill=col("--ambe-3d-grid"), width=1)
        d.text((x0 - 10, y), ["100%", "10%", "1%", "0.1%", "0.01%", "0.001%"][k], font=small,
               fill=col("--ambe-text-3"), anchor="rm")
    for k in range(6):
        x = x0 + w * k / 5
        d.text((x, y0 + h + 10), f"{2 * k}%", font=small, fill=col("--ambe-text-3"), anchor="mt")
    d.text((x0 + w / 2, y0 + h + 38), "bit error rate", font=small, fill=col("--ambe-text-3"), anchor="mt")
    d.line((x0, y0, x0, y0 + h, x0 + w, y0 + h), fill=col("--ambe-text-3"), width=2)

    def curve(n: int, t: int):
        pts = []
        for i in range(401):
            p = BER_MAX * i / 400
            P = fail_prob(n, t, p)
            if P >= 1e-5:
                pts.append((x0 + w * p / BER_MAX, y_of(P)))
        return pts

    for g, (n, t), dash in ((0, (23, 3), None), (2, (7, 0), (4, 6))):
        pts = curve(n, t)
        if dash is None:
            d.line(pts, fill=col(GROUP_TOKEN[g]), width=3, joint="curve")
        else:
            for i in range(0, len(pts) - 1, 3):
                if (i // 3) % 2 == 0:
                    d.line(pts[i:i + 3], fill=col(GROUP_TOKEN[g]), width=3)
    ham = curve(15, 1)
    d.line(ham, fill=mix(col("--ambe-highlight"), bg, 0.75), width=14, joint="curve")
    d.line(ham, fill=col("--ambe-highlight"), width=6, joint="curve")
    mx = x0 + w * BER / BER_MAX
    d.line((mx, y0, mx, y0 + h), fill=col("--ambe-plot-ink"), width=2)
    d.text((mx + 6, y0 + h - 6), "5.0%", font=poster.font(18, "semibold"), fill=col("--ambe-plot-ink"), anchor="lb")

    # The bars.
    bx, bw = 760, 480
    poster.text((bx, 22), "Each vector at 5.0%", 24, "--ambe-text-2", "semibold")
    d.line((bx, y0, bx, y0 + h, bx + bw, y0 + h), fill=col("--ambe-text-3"), width=2)
    colw = bw / 8
    for v in range(8):
        P = fail_prob(N[v], T[v], BER)
        cx = bx + colw * (v + 0.5)
        top = y_of(P)
        hue = col(GROUP_TOKEN[GROUP[v]])
        d.rectangle((cx - 18, top, cx + 18, y0 + h), fill=mix(hue, bg, 0.55))
        d.line((cx - 18, top, cx + 18, top), fill=hue, width=4)
        d.text((cx, y0 + h + 10), NAMES[v], font=small, fill=col("--ambe-text-3"), anchor="mt")
        if v == 4:
            d.rectangle((cx - 24, top - 6, cx + 24, y0 + h + 4), outline=col("--ambe-highlight"), width=4)

    # The frame and its rows.
    poster.text((40, 448), "One frame: 144 bits, interleaved; a burst of 7 errors", 22,
                "--ambe-text-2", "semibold")
    ax, ay, aw = 40, 486, 1200
    pitch = aw / 144
    hits = {p for p, _, _ in burst()}
    for i, (v, j) in enumerate(air_order()):
        fill = col("--ambe-plot-ink") if i in hits else mix(col(GROUP_TOKEN[GROUP[v]]), bg, 0.78 if j >= K[v] else 0.5)
        d.rectangle((ax + i * pitch, ay, ax + (i + 1) * pitch - 1.5, ay + 20), fill=fill)
    errs = errors_per_vector()
    hit_bits = {(v, j) for _, v, j in burst()}
    cell = 11
    for v in range(8):
        col_x = 40 if v < 4 else 670
        y = 540 + (v % 4) * 40
        fails = errs[v] > T[v]
        if fails:
            d.rounded_rectangle((col_x - 8, y - 8, col_x + 570, y + cell + 8), radius=6, fill=col("--ambe-mismatch"))
        poster.text((col_x, y - 4), f"{NAMES[v]} {CODE_NAME[v]}", 20, "--ambe-text-2", "semibold")
        cx0 = col_x + 120
        for j in range(N[v]):
            hit = (v, j) in hit_bits
            fill = col("--ambe-plot-ink") if hit else mix(col(GROUP_TOKEN[GROUP[v]]), bg, 0.78 if j >= K[v] else 0.45)
            d.rectangle((cx0 + j * (cell + 3), y, cx0 + j * (cell + 3) + cell, y + cell), fill=fill)
        e = errs[v]
        status = "no errors" if e == 0 else f"{e} error{'s' if e > 1 else ''}: {'fails' if fails else 'corrected'}"
        poster.text((cx0 + N[v] * (cell + 3) + 10, y - 4), status, 20,
                    "--ambe-plot-ink" if fails else "--ambe-text-3", "semibold" if fails else "regular")
        if v == 4:
            d.rectangle((col_x - 10, y - 10, cx0 + N[v] * (cell + 3) + 2, y + cell + 10),
                        outline=col("--ambe-highlight"), width=4)
    # The chip.
    chip = "Hamming u₄: 2 errors, corrects 1"
    cw = d.textlength(chip, font=poster.font(22, "semibold"))
    cy, cx = 446, 1240 - cw - 60
    d.rounded_rectangle((cx, cy - 8, cx + cw + 60, cy + 30), radius=6, fill=col("--ambe-highlight-chip"),
                        outline=col("--ambe-highlight"), width=2)
    d.rectangle((cx + 14, cy + 9, cx + 36, cy + 13), fill=col("--ambe-highlight"))
    poster.text((cx + 46, cy - 3), chip, 22, "--ambe-plot-ink", "semibold")
    poster.text((40, 690), "Interleaver invented for the figure (minimum separation 6). Source: US 5,870,405.", 18,
                "--ambe-text-3")
