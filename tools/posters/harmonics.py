"""Fallback image for the harmonics figure (index and docs/07-multi-band-excitation.md).

The flat comb at the male recording's median pitch, in the highlight, over
the faint comb of the female recording's median pitch, under the
illustrative envelope, with the cutoff at 3.7 kHz. Drawn in the light
tokens (it is what print and a page without JS show). Mirrors
docs/javascripts/anim-harmonics.js: the envelope is its illustrative
shape, and each voice is the median orig_f0_hz over frames with
confidence at least 0.5. Display maths only; it reads no hex.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

CUTOFF_HZ = 3700
NYQUIST_HZ = 4000
MIN_CONFIDENCE = 0.5
RESONANCES = [(480, 190, 1.0), (1480, 260, 0.62), (2520, 340, 0.34), (3420, 400, 0.17)]
EXTRA_CSS = Path(__file__).resolve().parents[2] / "docs" / "stylesheets" / "extra.css"


def envelope_at(hz: float) -> float:
    v = 0.035
    for f, bw, gain in RESONANCES:
        d = (hz - f) / bw
        v += gain / (1 + d * d)
    return v / 1.09


def median_f0(data_dir: Path, clip: str) -> float:
    frames = json.loads((data_dir / clip / "frames.json").read_text(encoding="utf-8"))["frames"]
    f0s = sorted(f["derived"]["orig_f0_hz"] for f in frames
                 if f["derived"]["orig_f0_hz"] > 0 and f["derived"]["orig_f0_confidence"] >= MIN_CONFIDENCE)
    mid = len(f0s) // 2
    return (f0s[mid - 1] + f0s[mid]) / 2 if len(f0s) % 2 == 0 else f0s[mid]


def light_tokens() -> dict:
    """The colour tokens of the light :root block, which print uses."""
    block = re.search(r":root\s*\{(.*?)\n\}", EXTRA_CSS.read_text(encoding="utf-8"), re.S).group(1)
    out = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
        value = re.sub(r"/\*.*?\*/", "", value).strip()
        m = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
        if m:
            d = m.group(1)
            out[name] = (int(d[0:2], 16), int(d[2:4], 16), int(d[4:6], 16), 255)
            continue
        m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
        if m:
            a = 1.0 if m.group(4) is None else float(m.group(4))
            out[name] = (int(m.group(1)), int(m.group(2)), int(m.group(3)), round(a * 255))
    return out


def draw(poster, data_dir: Path) -> None:
    poster.tokens = light_tokens()
    poster.draw.rectangle((0, 0, 1280, 720), fill=poster.colour("--ambe-plot-bg"))
    male = median_f0(data_dir, "lr-b")
    female = median_f0(data_dir, "lj-b")
    lm = math.floor(CUTOFF_HZ / male)
    lf = math.floor(CUTOFF_HZ / female)

    poster.text((64, 36), "A lower pitch packs more harmonics under the same cutoff", 30, "--ambe-text", weight="semibold")
    poster.text((64, 80), f"Male recording, median f0 {male:.1f} Hz: L = {lm}.   "
                f"Female recording, median f0 {female:.1f} Hz: L = {lf} (faint).", 19, "--ambe-text-3")

    left, right, top, bottom = 90, 1216, 150, 600

    def fx(hz: float) -> float:
        return left + (right - left) * hz / NYQUIST_HZ

    def fy(v: float) -> float:
        return bottom - (bottom - top) * v / 1.08

    cx = fx(CUTOFF_HZ)
    poster.rect((cx, top, right, bottom), "--ambe-surface-2")
    poster.line([(left, bottom), (right, bottom)], "--ambe-plot-axis", width=1)
    for khz in range(5):
        x = fx(khz * 1000)
        poster.line([(x, bottom), (x, bottom + 6)], "--ambe-plot-axis", width=1)
        poster.text((x - 6, bottom + 10), str(khz), 16, "--ambe-text-3")
    poster.text((fx(2000) - 60, bottom + 34), "frequency (kHz)", 16, "--ambe-text-3")

    # The female comb, faint and dashed, behind.
    k = 1
    while k * female < NYQUIST_HZ:
        x = fx(k * female)
        y = fy(envelope_at(k * female))
        for y0 in range(bottom, int(y), -8):
            poster.line([(x, y0), (x, max(y, y0 - 4))], "--ambe-plot-muted", width=1)
        k += 1

    # The envelope, dashed.
    pts = [(fx(i * NYQUIST_HZ / 320), fy(envelope_at(i * NYQUIST_HZ / 320))) for i in range(321)]
    for i in range(0, 320, 4):
        poster.line(pts[i:i + 3], "--ambe-data-3", width=2)

    # The male comb, in the highlight; above the cutoff, muted.
    k = 1
    while k * male < NYQUIST_HZ:
        hz = k * male
        x = fx(hz)
        y = fy(envelope_at(hz))
        name = "--ambe-highlight" if hz < CUTOFF_HZ else "--ambe-plot-muted"
        poster.line([(x, bottom), (x, y)], name, width=4 if hz < CUTOFF_HZ else 2)
        k += 1

    for y in range(top, bottom, 12):
        poster.line([(cx, y), (cx, y + 6)], "--ambe-text-3", width=1)
    poster.text((cx - 150, top - 26), "cutoff at 3.7 kHz", 17, "--ambe-text-3")

    poster.text((64, 668), "Envelope and cutoff illustrative; median pitches derived from the input recordings. "
                "L = floor(3700 / f0): US 5,701,390, US 5,754,974.", 15, "--ambe-text-4")
