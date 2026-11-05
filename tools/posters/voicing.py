"""Fallback image for the voicing figure (docs/07): the last step's end state.

lr-b, threshold 0.55, the mixed frame, the Corner preset of the 3D view,
drawn as an orthographic (axonometric) projection with the same geometry as
docs/javascripts/anim-voicing-3d.js: x is frame index, depth is the band
(band 1 in front), y is band strength. A ridge segment that crosses the
threshold is cut where it crosses; the part above is teal, the part below
amber. A segment between two silent frames is grey. The floor cells are the
2D map, the unvoiced ones hatched; the frame on screen is the thick ink line,
and where the threshold cuts it is the highlight, with its chip. Drawn in
the light tokens (:root in extra.css), since print shows this image. It
draws stored numbers; it analyses nothing.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"
CLIP = "lr-b"
THRESHOLD = 0.55
SILENT_DBFS = -60.0
X_HALF = 1.6
Y_SCALE = 1.5
YAW, PITCH = 35.0, 30.0  # the Corner preset: band 1 on the left, time to the right
BOX = (190, 100, 1080, 600)  # left, top, right, bottom of the drawing area
CURTAIN_MIX = 0.8  # the curtains' top: the ridge's colour this far toward the ground, as in light


def band_z(b: int) -> float:
    return 0.3 * (8 - b)


def frames(data: Path) -> list[dict]:
    return json.loads((data / CLIP / "frames.json").read_text(encoding="utf-8"))["frames"]


def mixed_frame(fr: list[dict]) -> int:
    """lib/picks.js "mixed": three or more bands voiced and two or more not,
    the most confident decoded f0 first, then the earliest."""
    def voiced(f: dict) -> int:
        return sum(1 for flag in f["derived"]["band_voiced"] if flag)

    picked = [i for i, f in enumerate(fr) if voiced(f) >= 3 and len(f["derived"]["band_voiced"]) - voiced(f) >= 2]
    return sorted(picked, key=lambda i: (-fr[i]["derived"]["decoded_f0_confidence"], i))[0]


Piece = tuple[int, float, float, float, float]  # band, i0, v0, i1, v1


def split(fr: list[dict], threshold: float = THRESHOLD) -> dict[str, list[Piece]]:
    """Ridge pieces by colour, as (band, i0, v0, i1, v1): from fractional frame
    i0 at strength v0 to i1 at v1. A segment that crosses the threshold
    becomes two pieces that meet on it."""
    out: dict[str, list[Piece]] = {"voiced": [], "unvoiced": [], "silent": []}
    for b in range(8):
        for i in range(len(fr) - 1):
            a, c = fr[i]["derived"], fr[i + 1]["derived"]
            v0, v1 = a["band_voicing"][b], c["band_voicing"][b]
            if a["decoded_rms_dbfs"] < SILENT_DBFS and c["decoded_rms_dbfs"] < SILENT_DBFS:
                out["silent"].append((b, i, v0, i + 1, v1))
                continue
            up0, up1 = v0 >= threshold - 1e-9, v1 >= threshold - 1e-9
            if up0 == up1:
                out["voiced" if up0 else "unvoiced"].append((b, i, v0, i + 1, v1))
                continue
            im = i + (threshold - v0) / (v1 - v0)
            out["voiced" if up0 else "unvoiced"].append((b, i, v0, im, threshold))
            out["voiced" if up1 else "unvoiced"].append((b, im, threshold, i + 1, v1))
    return out


def voiced_cells(fr: list[dict], threshold: float = THRESHOLD) -> int:
    return sum(1 for f in fr for v in f["derived"]["band_voicing"] if v >= threshold)


def light_tokens() -> dict:
    """The light theme's colour tokens: the first :root block of extra.css."""
    css = EXTRA_CSS.read_text(encoding="utf-8")
    block = re.search(r":root\s*\{(.*?)\n\}", css, re.S).group(1)
    tokens = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block):
        value = re.sub(r"/\*.*?\*/", "", value).strip()
        m = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
        if m:
            h = m.group(1)
            tokens[name] = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
            continue
        m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
        if m:
            alpha = 1.0 if m.group(4) is None else float(m.group(4))
            tokens[name] = (int(m.group(1)), int(m.group(2)), int(m.group(3)), round(alpha * 255))
    return tokens


def mix(a, b, t: float):
    """`a` moved toward `b` by `t`, per sRGB channel, as lib/style.js mix()."""
    return tuple(round(x + (y - x) * t) for x, y in zip(a[:3], b[:3])) + (255,)


def _basis():
    yaw, pitch = math.radians(YAW), math.radians(PITCH)
    forward = (-math.cos(pitch) * math.sin(yaw), -math.sin(pitch), -math.cos(pitch) * math.cos(yaw))
    right = (math.cos(yaw), 0.0, -math.sin(yaw))
    up = (
        right[1] * forward[2] - right[2] * forward[1],
        right[2] * forward[0] - right[0] * forward[2],
        right[0] * forward[1] - right[1] * forward[0],
    )
    return right, up


def draw(poster, data: Path) -> None:
    poster.tokens = light_tokens()
    d = poster.draw
    W, H = poster.image.size
    d.rectangle((0, 0, W, H), fill=poster.colour("--ambe-plot-bg"))
    fr = frames(data)
    n = len(fr)
    cur = mixed_frame(fr)
    right, up = _basis()
    C = poster.colour

    def raw(x: float, y: float, z: float) -> tuple[float, float]:
        return (x * right[0] + y * right[1] + z * right[2], x * up[0] + y * up[1] + z * up[2])

    corners = [raw(x, y, z) for x in (-X_HALF - 0.1, X_HALF + 0.1) for y in (0, Y_SCALE)
               for z in (band_z(0) + 0.14, band_z(7) - 0.14)]
    min_x, max_x = min(p[0] for p in corners), max(p[0] for p in corners)
    min_y, max_y = min(p[1] for p in corners), max(p[1] for p in corners)
    left, top, rgt, bottom = BOX
    scale = min((rgt - left) / (max_x - min_x), (bottom - top) / (max_y - min_y))
    off_x = (left + rgt) / 2 - scale * (min_x + max_x) / 2
    off_y = (top + bottom) / 2 + scale * (min_y + max_y) / 2

    def P(x: float, y: float, z: float) -> tuple[float, float]:
        sx, sy = raw(x, y, z)
        return (round(off_x + scale * sx, 2), round(off_y - scale * sy, 2))

    def fx(i: float) -> float:
        return -X_HALF + 2 * X_HALF * i / (n - 1)

    ground = C("--ambe-3d-floor")
    bg = C("--ambe-plot-bg")
    voiced, unvoiced, silent = C("--ambe-voiced"), C("--ambe-unvoiced"), C("--ambe-plot-muted")

    # The floor under everything, with its grid, as lib/style.js floor().
    z0, z1 = band_z(0) + 0.15, band_z(7) - 0.15
    d.polygon([P(-X_HALF - 0.25, 0, z0 + 0.25), P(X_HALF + 0.25, 0, z0 + 0.25),
               P(X_HALF + 0.25, 0, z1 - 0.25), P(-X_HALF - 0.25, 0, z1 - 0.25)], fill=ground)
    for k in range(9):
        x = -X_HALF - 0.25 + k * (2 * X_HALF + 0.5) / 8
        d.line([P(x, 0, z0 + 0.25), P(x, 0, z1 - 0.25)], fill=C("--ambe-3d-grid"), width=1)

    # Floor cells, coloured as the 2D map and dimmed by level; the unvoiced
    # ones hatched in the plot ground's colour, through a mask.
    hatch = Image.new("L", (W, H), 0)
    hd = ImageDraw.Draw(hatch)
    half = X_HALF / (n - 1)
    for b in range(8):
        za, zb = band_z(b) - 0.15, band_z(b) + 0.15
        for i in range(n):
            dd = fr[i]["derived"]
            level = min(1.0, max(0.04, (dd["decoded_rms_dbfs"] + 65) / 40))
            on = dd["band_voicing"][b] >= THRESHOLD
            x0, x1 = max(-X_HALF, fx(i) - half), min(X_HALF, fx(i) + half)
            quad = [P(x0, 0, za), P(x1, 0, za), P(x1, 0, zb), P(x0, 0, zb)]
            d.polygon(quad, fill=mix(voiced if on else unvoiced, ground, 1 - level * 0.9))
            if not on and dd["decoded_rms_dbfs"] >= SILENT_DBFS:
                hd.polygon(quad, fill=150)
    stripes = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(stripes)
    for k in range(-H, W, 9):
        sd.line([(k, H), (k + H, 0)], fill=255, width=3)
    mask = Image.composite(stripes, Image.new("L", (W, H), 0), hatch)
    mask = Image.eval(mask, lambda v: v * 150 // 255)
    poster.image.paste(Image.new("RGB", (W, H), bg[:3]), (0, 0), mask)
    d = ImageDraw.Draw(poster.image, "RGBA")

    segments = split(fr)
    by_band: dict[int, dict[str, list[Piece]]] = {b: {"voiced": [], "unvoiced": [], "silent": []} for b in range(8)}
    for kind, items in segments.items():
        for piece in items:
            by_band[piece[0]][kind].append(piece)
    colour = {"voiced": voiced, "unvoiced": unvoiced, "silent": silent}

    def ridge(piece: Piece, kind: str, width: int = 2) -> None:
        b, i0, v0, i1, v1 = piece
        z = band_z(b)
        d.line([P(fx(i0), v0 * Y_SCALE, z), P(fx(i1), v1 * Y_SCALE, z)], fill=colour[kind], width=width)

    # Back to front: each band's frosted curtain hides the ridges behind it.
    for b in range(7, -1, -1):
        z = band_z(b)
        for kind in ("silent", "unvoiced", "voiced"):
            for piece in by_band[b][kind]:
                _, i0, v0, i1, v1 = piece
                d.polygon([P(fx(i0), 0, z), P(fx(i1), 0, z), P(fx(i1), v1 * Y_SCALE, z), P(fx(i0), v0 * Y_SCALE, z)],
                          fill=mix(colour[kind], bg, CURTAIN_MIX))
        for kind in ("silent", "unvoiced", "voiced"):
            for piece in by_band[b][kind]:
                ridge(piece, kind)

    # The threshold: a frosted --ambe-accent plane at 18% with its edge.
    y = THRESHOLD * Y_SCALE
    ex, ez0, ez1 = X_HALF + 0.1, z0 + 0.03, z1 - 0.03
    quad = [P(-ex, y, ez0), P(ex, y, ez0), P(ex, y, ez1), P(-ex, y, ez1)]
    accent = C("--ambe-accent")
    d.polygon(quad, fill=accent[:3] + (round(0.18 * 255),))
    d.line(quad + [quad[0]], fill=accent, width=3)

    # The frame on screen: the threshold across it in the highlight, a
    # dashed ink stem from each band's dot to it, the frame's line in ink
    # with a dot per band.
    x = fx(cur)
    v = fr[cur]["derived"]["band_voicing"]
    hl = C("--ambe-highlight")
    d.line([P(x, y, band_z(0) + 0.08), P(x, y, band_z(7) - 0.08)], fill=hl, width=5)
    for b in range(8):
        a, b2 = P(x, v[b] * Y_SCALE, band_z(b)), P(x, y, band_z(b))
        length = math.dist(a, b2)
        steps = max(2, round(length / 5))
        for s in range(0, steps, 2):
            p0 = (a[0] + (b2[0] - a[0]) * s / steps, a[1] + (b2[1] - a[1]) * s / steps)
            p1 = (a[0] + (b2[0] - a[0]) * (s + 1) / steps, a[1] + (b2[1] - a[1]) * (s + 1) / steps)
            d.line([p0, p1], fill=C("--ambe-plot-ink"), width=2)
    pts = [P(x, v[b] * Y_SCALE, band_z(b)) for b in range(8)]
    d.line(pts, fill=C("--ambe-plot-ink"), width=5, joint="curve")
    above = 0
    for b, p in enumerate(pts):
        on = v[b] >= THRESHOLD
        above += on
        r = 8
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=C("--ambe-plot-ink"))
        r = 5.5
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=voiced if on else unvoiced)

    # The chip, from the highlight's far (band 8) end.
    anchor = P(x, y, band_z(7) - 0.08)
    chip = f"threshold {THRESHOLD:.2f}: {above} of 8 bands above"
    font = poster.font(22, "semibold")
    w = d.textlength(chip, font=font)
    # Above and to the right, clear of the scene and the band labels.
    cx, cy = W - w - 60 - 36, 170
    d.line([anchor, (cx + 30, cy + 40)], fill=hl, width=2)
    d.ellipse((anchor[0] - 5, anchor[1] - 5, anchor[0] + 5, anchor[1] + 5), fill=hl)
    d.rounded_rectangle((cx, cy, cx + w + 60, cy + 40), radius=6, fill=C("--ambe-highlight-chip"), outline=hl, width=2)
    d.rectangle((cx + 14, cy + 18, cx + 38, cy + 22), fill=hl)
    d.text((cx + 48, cy + 7), chip, font=font, fill=C("--ambe-plot-ink"))

    def label(xyz, text: str, align: str) -> None:
        px, py = P(*xyz)
        lines = text.split("\n")
        widths = [d.textlength(t, font=poster.font(22)) for t in lines]
        for k, t in enumerate(lines):
            tx = px - widths[k] - 12 if align == "end" else px - widths[k] / 2 if align == "middle" else px + 12
            d.text((tx, py - 14 * len(lines) + 26 * k), t, font=poster.font(22), fill=C("--ambe-text-3"))

    label((-X_HALF - 0.14, 0, band_z(0)), "band 1\n0-500 Hz", "end")
    label((X_HALF + 0.14, 0, band_z(7)), "band 8\n3.5-4 kHz", "start")
    label((-0.1 * X_HALF, 0, band_z(0) + 0.42), "time →", "middle")

    poster.text((40, 28), "Eight bands over one sentence, one frame as a row of it", 34, "--ambe-text", weight="semibold")
    poster.text((40, 664), "Derived from the decoded audio of a real AMBE-3000 round trip; "
                "not the codec's voicing bits.", 22, "--ambe-text-3")
