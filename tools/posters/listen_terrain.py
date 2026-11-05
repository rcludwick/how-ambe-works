"""Fallback image of the listen-terrain figure (ch12): what the round trip keeps.

lr-b ("CQ CQ CQ", male voice), as the figure's flat view draws it: three
strips against time, the original's spectrogram on top, decoded minus
original in the middle, the decoded audio's spectrogram below, with the first
step's frame (the loudest with a pitch in both files) as a line in the
highlight with its chip. Beside them, "Line up the harmonics": the clip's
mean peak-normalised spectrum against f / f0 for both tracks, from
tools/listen-stats.py. Light tokens (the :root block of extra.css), since the
poster is what print shows. Drawn at twice the size and scaled down. It draws
pictures from spectra.json and frames.json (never .hex); no codec logic.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"
FONTS = ROOT / "tools" / "fonts"
CLIP = "lr-b"
FLOOR_DB, DIFF_DB, HOP_S = -80.0, 20.0, 0.02
STRIP = (0.7, 0.12)
SCALE = 2
W, H = 1280 * SCALE, 720 * SCALE


def listen_stats():
    spec = importlib.util.spec_from_file_location("listen_stats", ROOT / "tools" / "listen-stats.py")
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


def level_t(db: float) -> float:
    return min(1.0, max(0.0, (db - FLOOR_DB) / -FLOOR_DB))


def level_weight(t: float) -> float:
    """anim-listen-terrain.js levelWeight: the quiet floor fades into the ground."""
    x = min(1.0, max(0.0, (t - 0.12) / 0.4))
    return x * x * (3 - 2 * x)


def loudest_pitched(frames: list[dict]) -> int:
    """anim-listen-terrain.js PICKS["loudest-pitched"]."""
    best = None
    for i, f in enumerate(frames):
        d = f["derived"]
        if d["orig_rms_dbfs"] < -40 or d["orig_f0_hz"] <= 0 or d["decoded_f0_hz"] <= 0:
            continue
        if best is None or d["orig_rms_dbfs"] > frames[best]["derived"]["orig_rms_dbfs"]:
            best = i
    return best


def draw(poster, data_dir: Path) -> None:
    tokens = light_tokens()
    spectra = json.loads((data_dir / CLIP / "spectra.json").read_text(encoding="utf-8"))
    frames = json.loads((data_dir / CLIP / "frames.json").read_text(encoding="utf-8"))["frames"]
    orig, dec = spectra["original"], spectra["decoded"]
    n, bins = len(orig), spectra["bins"]
    pick = loudest_pitched(frames)
    bg = tokens["--ambe-plot-bg"]
    ink, text2, text3 = tokens["--ambe-plot-ink"], tokens["--ambe-text-2"], tokens["--ambe-text-3"]
    hl = tokens["--ambe-highlight"]

    def font(size: int, weight: str = "Regular"):
        return ImageFont.truetype(str(FONTS / f"SourceSans3-{weight}.ttf"), size * SCALE)

    image = Image.new("RGB", (W, H), bg[:3])
    g = ImageDraw.Draw(image, "RGBA")

    # The three strips, as the flat view lays them out.
    x0, x1, top, bottom = 90 * SCALE, 820 * SCALE, 110 * SCALE, 616 * SCALE
    whole = 3 * STRIP[0] + 2 * STRIP[1]
    sh = (bottom - top) * STRIP[0] / whole
    gap = (bottom - top) * STRIP[1] / whole
    mid, neg, pos = tokens["--ambe-diverge-mid"], tokens["--ambe-diverge-neg"], tokens["--ambe-diverge-pos"]
    mask = _mix(mid, bg, 0.55)

    def level(db):
        t = level_t(max(FLOOR_DB, db))
        return _mix(bg, ramp(tokens, t), level_weight(t))

    def diff(i, k):
        if frames[i]["derived"]["orig_rms_dbfs"] < -40:
            return mask
        o, d = max(FLOOR_DB, orig[i][k]), max(FLOOR_DB, dec[i][k])
        t = max(-1.0, min(1.0, (d - o) / DIFF_DB))
        hue = _mix(mid, neg if t < 0 else pos, abs(t))
        return _mix(bg, hue, round(level_weight(level_t(max(o, d))) * 15) / 15)

    names = ["original (into the ThumbDV)", "decoded minus original", "decoded (out of the ThumbDV)"]
    colours = [lambda i, k: level(orig[i][k]), diff, lambda i, k: level(dec[i][k])]
    for s in range(3):
        y = top + s * (sh + gap)
        strip = Image.new("RGB", (n, bins))
        px = strip.load()
        for i in range(n):
            for k in range(bins):
                px[i, bins - 1 - k] = colours[s](i, k)[:3]
        image.paste(strip.resize((x1 - x0, round(sh)), Image.BILINEAR), (x0, round(y)))
        g.line([(x0, y + sh), (x1, y + sh)], fill=tokens["--ambe-plot-axis"], width=SCALE)
        g.line([(x0, y), (x0, y + sh)], fill=tokens["--ambe-plot-axis"], width=SCALE)
        for f, label in ((0, "0"), (2000, "2k"), (4000, "4k")):
            yy = y + sh - min(1.0, f / spectra["bin_centre_hz"][-1]) * sh
            g.text((x0 - 8 * SCALE, yy), label, font=font(15), fill=text3, anchor="rm")

    # This frame, through all three strips; then the strips' names over it.
    cx = x0 + (pick + 0.5) / n * (x1 - x0)
    g.line([(cx, top), (cx, bottom)], fill=tokens["--ambe-highlight-chip"], width=7 * SCALE)
    g.line([(cx, top), (cx, bottom)], fill=hl, width=round(3.25 * SCALE))
    for s in range(3):
        y = top + s * (sh + gap)
        box = g.textbbox((x0 + 8 * SCALE, y + 6 * SCALE), names[s], font=font(15), anchor="lt")
        g.rectangle((box[0] - 4 * SCALE, box[1] - 3 * SCALE, box[2] + 4 * SCALE, box[3] + 3 * SCALE), fill=bg)
        g.text((x0 + 8 * SCALE, y + 6 * SCALE), names[s], font=font(15), fill=text2, anchor="lt")
    duration = n * HOP_S
    t = 0.0
    while t <= duration + 1e-9:
        xx = x0 + t / duration * (x1 - x0)
        g.text((xx, bottom + 10 * SCALE), f"{t:g} s", font=font(15), fill=text3, anchor="mt")
        t += 0.5
    g.text(((x0 + x1) / 2, bottom + 34 * SCALE), "time, s", font=font(16), fill=text3, anchor="mt")

    chip = f"this frame: {(pick + 0.5) * HOP_S:.2f} s"
    cf = font(18, "Semibold")
    bx, by = cx + 24 * SCALE, top + 40 * SCALE
    box = g.textbbox((bx + 30 * SCALE, by), chip, font=cf, anchor="lm")
    pad = 9 * SCALE
    g.rounded_rectangle((bx, box[1] - pad, box[2] + pad, box[3] + pad), radius=6 * SCALE,
                        fill=tokens["--ambe-highlight-chip"], outline=hl, width=round(1.5 * SCALE))
    g.line([(bx + 10 * SCALE, by), (bx + 24 * SCALE, by)], fill=hl, width=3 * SCALE)
    g.text((bx + 30 * SCALE, by), chip, font=cf, fill=ink, anchor="lm")

    # Line up the harmonics, from tools/listen-stats.py.
    stats = listen_stats()
    profile = stats.profile_summary(*stats.profile_rows(CLIP))
    px0, px1, py0, py1 = 900 * SCALE, 1240 * SCALE, 150 * SCALE, 470 * SCALE
    g.text((px0, py0 - 34 * SCALE), "Line up the harmonics", font=font(20, "Semibold"), fill=tokens["--ambe-text"])
    us = profile["u"]
    sx = lambda u: px0 + (u - us[0]) / (us[-1] - us[0]) * (px1 - px0)  # noqa: E731
    sy = lambda db: py0 + (-db) / 60 * (py1 - py0)  # noqa: E731
    for db in (0, -20, -40, -60):
        g.line([(px0, sy(db)), (px1, sy(db))], fill=tokens["--ambe-plot-grid"], width=SCALE)
        g.text((px0 - 8 * SCALE, sy(db)), f"{db}", font=font(14), fill=text3, anchor="rm")
    for h in range(1, 8):
        g.line([(sx(h), py0), (sx(h), py1)], fill=tokens["--ambe-plot-grid"], width=SCALE)
        g.text((sx(h), py1 + 8 * SCALE), f"{h}", font=font(14), fill=text3, anchor="mt")
    g.text(((px0 + px1) / 2, py1 + 30 * SCALE), "f / f0, each frame on its own pitch", font=font(15), fill=text3, anchor="mt")
    orig_pts = [(sx(u), sy(v)) for u, v in zip(us, profile["original"])]
    for a, b in zip(orig_pts[::2], orig_pts[1::2]):
        g.line([a, b], fill=tokens["--ambe-cat-1"], width=round(1.75 * SCALE))
    g.line([(sx(u), sy(v)) for u, v in zip(us, profile["decoded"])], fill=ink, width=3 * SCALE, joint="curve")
    lo, hi = profile["deeper_db"]
    g.text((px0, py1 + 60 * SCALE), "dashed: original    thick: decoded", font=font(15), fill=text2)
    g.text((px0, py1 + 84 * SCALE), f"{profile['frames']} pitched frames: the decoded valleys", font=font(15), fill=text2)
    g.text((px0, py1 + 104 * SCALE), f"are {lo:.1f} to {hi:.1f} dB deeper at harmonics 1 to 7", font=font(15), fill=text2)

    g.text((40 * SCALE, 30 * SCALE), f"“{spectra['clip']['text']}”, into the ThumbDV and back",
           font=font(28, "Semibold"), fill=tokens["--ambe-text"])
    g.text((40 * SCALE, 68 * SCALE), "Spectrograms, 0 to 4 kHz; middle strip blue where the decoded audio is lower, "
           "amber where higher.", font=font(17), fill=text3)
    g.text((40 * SCALE, H - 34 * SCALE), "derived (from the input audio and from the chip's decoded audio): "
           "FFTs and pitch tracks, not the codec's own spectrum", font=font(15), fill=text3)

    poster.image.paste(image.resize((1280, 720), Image.LANCZOS))
