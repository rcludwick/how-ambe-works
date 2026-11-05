"""Fallback image for the frames figure (docs/08): the first step's end state.

lr-b, Windows on, frame 112 (the "mixed" pick of docs/javascripts/lib/picks.js),
rows 108 to 116, the Corner preset of the 3D view drawn as an orthographic
projection with the geometry of docs/javascripts/anim-frames-3d.js: x is
time (100 samples to a unit, frame 112's middle at 0), y is each window's
samples times the 255-point Hamming weight, depth is the frame, later frames
further back. The floor carries each window's footprint and shades the 95
samples each window shares with the next. In the light tokens, for print.

It plots the input WAV's samples; it analyses nothing and reads no hex.
"""

from __future__ import annotations

import json
import math
import re
import wave
from array import array
from pathlib import Path

CLIP = "lr-b"
FRAME, WINDOW, REACH = 160, 255, 4
HALF = (WINDOW - 1) // 2
DZ = 0.8
Y0 = -1.12
# The inset's full scale as a fraction of its half height (anim-frames.js SCALE).
SCALE = 0.74


def squeeze(y: float) -> float:
    """As anim-frames-3d.js: the inset's scale up to SCALE, then a smooth squeeze below 1."""
    m = abs(y)
    if m <= SCALE:
        return y
    return math.copysign(SCALE + (1 - SCALE) * math.tanh((m - SCALE) / (1 - SCALE)), y)
YAW, PITCH = 28.0, 22.0  # the Corner preset
BOX = (40, 70, 1240, 690)  # left, top, right, bottom of the drawing area
WEIGHTS = [0.54 - 0.46 * math.cos(2 * math.pi * j / (WINDOW - 1)) for j in range(WINDOW)]
EXTRA_CSS = Path(__file__).resolve().parents[2] / "docs" / "stylesheets" / "extra.css"


def light_tokens() -> dict[str, tuple[int, int, int, int]]:
    """Colour tokens of the first :root block (the light scheme, which print uses)."""
    css = EXTRA_CSS.read_text(encoding="utf-8")
    block = re.search(r"^:root\s*\{(.*?)^\}", css, re.S | re.M).group(1)
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
            alpha = 1.0 if m.group(4) is None else float(m.group(4))
            out[name] = (int(m.group(1)), int(m.group(2)), int(m.group(3)), round(alpha * 255))
    return out


def default_frame(frames: list[dict]) -> dict:
    """PICKS.mixed: three or more voiced bands and two or more unvoiced, the
    most confident decoded pitch first, ties in frame order."""
    def voiced(f):
        return sum(1 for v in f["derived"]["band_voiced"] if v)
    pool = [f for f in frames if voiced(f) >= 3 and len(f["derived"]["band_voiced"]) - voiced(f) >= 2]
    return sorted(pool, key=lambda f: (-f["derived"]["decoded_f0_confidence"], f["i"]))[0]


def samples(data: Path) -> list[float]:
    with wave.open(str(data.parent / "audio" / f"{CLIP}-original.wav"), "rb") as w:
        raw = array("h", w.readframes(w.getnframes()))
    return [s / 32768 for s in raw]


def mix(a, b, t: float):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


def ramp(tokens, t: float):
    x = min(1.0, max(0.0, t)) * 4
    i = min(3, int(x))
    return mix(tokens[f"--ambe-ramp-{i}"], tokens[f"--ambe-ramp-{i + 1}"], x - i)


def tone(k: int) -> float:
    return (k + REACH - (1 if k > 0 else 0)) / (2 * REACH - 1)


def fade(tokens, colour, k: int):
    d = abs(k)
    amount = 0 if d <= 1 else min(0.45, 0.12 + 0.06 * (d - 1))
    return mix(colour, tokens["--ambe-plot-bg"], amount)


def camera():
    y, p = math.radians(YAW), math.radians(PITCH)
    d = (math.cos(p) * math.sin(y), math.sin(p), math.cos(p) * math.cos(y))
    right = (d[2], 0.0, -d[0])
    n = math.hypot(*right)
    right = tuple(c / n for c in right)
    up = (d[1] * right[2] - d[2] * right[1], d[2] * right[0] - d[0] * right[2], d[0] * right[1] - d[1] * right[0])
    return right, up


def draw(poster, data: Path) -> None:
    tokens = light_tokens()
    poster.tokens = {**poster.tokens, **tokens}
    poster.draw.rectangle((0, 0, 1280, 720), fill=tokens["--ambe-plot-bg"])
    frames = json.loads((data / "frames.json").read_text(encoding="utf-8"))["frames"]
    index = default_frame(frames)["i"]
    pcm = samples(data)
    base = index * FRAME

    def at(u: int) -> float:
        n = base + u
        return pcm[n] if 0 <= n < len(pcm) else 0.0

    peak = max(0.015, max(abs(at(u)) for u in range(-FRAME, 2 * FRAME)))
    right, up = camera()

    def proj3(x, y, z):
        return (x * right[0] + y * right[1] + z * right[2], x * up[0] + y * up[1] + z * up[2])

    # Fit rows -2 to 2 (and the floor under them) into the box, as the 3D view does.
    corners = [proj3((k * FRAME + FRAME / 2 - 80) / 100 + dx, yy, -k * DZ)
               for k in range(-2, 3) for dx in (-1.27, 1.27) for yy in (Y0, 1)]
    r0, r1 = min(c[0] for c in corners), max(c[0] for c in corners)
    u0, u1 = min(c[1] for c in corners), max(c[1] for c in corners)
    scale = min((BOX[2] - BOX[0]) / (r1 - r0), (BOX[3] - BOX[1]) / (u1 - u0))
    cx, cy = (BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2

    def P(x, y, z):
        a, b = proj3(x, y, z)
        return (cx + (a - (r0 + r1) / 2) * scale, cy - (b - (u0 + u1) / 2) * scale)

    def sx(u):
        return (u - 80) / 100

    draw_ = poster.draw
    floor = tokens["--ambe-3d-floor"]
    reach = sx(REACH * FRAME + 80 + HALF) + 0.2
    # As the 3D view's floor: wide and deep enough that no edge shows.
    wide, deep = reach + 8, 4.5 * DZ + 10
    draw_.polygon([P(-wide, Y0, -deep), P(wide, Y0, -deep), P(wide, Y0, deep), P(-wide, Y0, deep)], fill=floor)
    grid = tokens["--ambe-3d-grid"]
    x = -reach - 1.6 * 5
    while x <= wide:
        draw_.line([P(x, Y0, -deep), P(x, Y0, deep)], fill=grid, width=1)
        x += 1.6
    for k in range(-16, 17):
        draw_.line([P(-wide, Y0, -k * DZ), P(wide, Y0, -k * DZ)], fill=grid, width=1)

    rows = list(range(REACH, -REACH - 1, -1))  # back to front
    colour = {k: (tokens["--ambe-plot-ink"] if k == 0 else fade(tokens, ramp(tokens, tone(k)), k)) for k in rows}

    def window(k):
        start = k * FRAME + FRAME // 2 - HALF
        return start, [at(start + j) * WEIGHTS[j] for j in range(WINDOW)]

    # The samples each window shares with the next: a bridge between two
    # footprints, in the colour of the inset's shared bands (--ambe-cat-5).
    for k in range(-REACH, REACH):
        a = sx((k + 1) * FRAME + FRAME // 2 - HALF)
        b = sx(k * FRAME + FRAME // 2 + HALF)
        z0, z1 = -(k + 1) * DZ + 0.12, -k * DZ - 0.12
        near = min(abs(k), abs(k + 1))
        quad = [P(a, Y0, z0), P(b, Y0, z0), P(b, Y0, z1), P(a, Y0, z1)]
        draw_.polygon(quad, fill=mix(tokens["--ambe-cat-5"], floor, 1 - (0.55 - 0.08 * near)),
                      outline=mix(tokens["--ambe-cat-5"], floor, 1 - (0.95 - 0.12 * near)))

    # Footprints.
    for k in rows:
        start, _ = window(k)
        z = -k * DZ
        fill = tokens["--ambe-highlight-fill-top"] if k == 0 else mix(colour[k], floor, 0.4)
        draw_.polygon([P(sx(start), Y0, z - 0.12), P(sx(start + WINDOW - 1), Y0, z - 0.12),
                       P(sx(start + WINDOW - 1), Y0, z + 0.12), P(sx(start), Y0, z + 0.12)], fill=fill)
    def dashed(points, fill, width=2, on=9, off=7):
        # Edges cut into 2 px steps, so long straight edges dash too.
        fine = [points[0]]
        for p, q in zip(points, points[1:]):
            steps = max(1, int(math.dist(p, q) // 2))
            fine += [(p[0] + (q[0] - p[0]) * t / steps, p[1] + (q[1] - p[1]) * t / steps) for t in range(1, steps + 1)]
        run, drawing = 0.0, True
        for p, q in zip(fine, fine[1:]):
            seg = math.dist(p, q)
            if drawing:
                draw_.line([p, q], fill=fill, width=width)
            run += seg
            if run >= (on if drawing else off):
                run, drawing = 0.0, not drawing

    for k in rows:
        start, vals = window(k)
        z = -k * DZ
        pts = [P(sx(start + j), squeeze(vals[j] * SCALE / peak), z) for j in range(WINDOW)]
        if k == 0:
            # The highlight: frosted fill to the zero line, dashed plane outline, thick line.
            fill_top = tokens["--ambe-highlight-fill-top"]
            for j in range(WINDOW - 1):
                draw_.polygon([pts[j], pts[j + 1], P(sx(start + j + 1), 0, z), P(sx(start + j), 0, z)], fill=fill_top)
            outline = mix(tokens["--ambe-highlight"], tokens["--ambe-plot-bg"], 0.3)
            box = [P(sx(start), 0, z), P(sx(start + WINDOW - 1), 0, z), P(sx(start + WINDOW - 1), 1, z),
                   P(sx(start), 1, z), P(sx(start), 0, z)]
            for p, q in zip(box, box[1:]):
                dashed([p, q], outline, 2, 6, 5)
            draw_.line(pts, fill=tokens["--ambe-highlight"], width=6, joint="curve")
        else:
            draw_.line(pts, fill=colour[k], width=2, joint="curve")
        for sign in (1, -1):
            env = [P(sx(start + j), sign * SCALE * WEIGHTS[j], z) for j in range(WINDOW)]
            dashed(env, colour[k], 2)

    # The chip, its leader and its dot, at frame 112's highest point.
    start, vals = window(0)
    top = max(range(WINDOW), key=lambda j: vals[j])
    ax, ay = P(sx(start + top), squeeze(vals[top] * SCALE / peak), 0)
    text = "this frame's window: 255 samples"
    font = poster.font(24, "semibold")
    tw = draw_.textlength(text, font=font)
    bx, by = ax + 30, ay - 74
    draw_.line([(ax, ay), (bx, by + 22)], fill=tokens["--ambe-highlight"], width=2)
    draw_.ellipse((ax - 6, ay - 6, ax + 6, ay + 6), fill=tokens["--ambe-highlight"])
    draw_.rounded_rectangle((bx, by, bx + tw + 64, by + 44), radius=8, fill=tokens["--ambe-highlight-chip"],
                            outline=tokens["--ambe-highlight"], width=3)
    draw_.line([(bx + 14, by + 22), (bx + 38, by + 22)], fill=tokens["--ambe-highlight"], width=5)
    draw_.text((bx + 48, by + 7), text, font=font, fill=tokens["--ambe-plot-ink"])

    label = poster.font(24)
    ex, ey = P(sx(-2 * FRAME + 80), SCALE + 0.36, 2 * DZ)
    draw_.text((ex, ey), "earlier frames", font=label, fill=tokens["--ambe-text-3"], anchor="ms")
    lx, ly = P(sx(2 * FRAME + 80), SCALE + 0.36, -2 * DZ)
    draw_.text((lx, ly), "later frames, 20 ms apart", font=label, fill=tokens["--ambe-text-3"], anchor="ms")
    # One label on each strip that touches frame 112, on a pill so it reads over the floor.
    for centre, z in ((0, DZ / 2), (FRAME, -DZ / 2)):
        mx, my = P(sx(centre), Y0, z)
        tw = draw_.textlength("95 shared", font=label)
        draw_.rounded_rectangle((mx - tw / 2 - 8, my - 17, mx + tw / 2 + 8, my + 15), radius=6,
                                fill=mix(tokens["--ambe-plot-bg"], floor, 0.18))
        draw_.text((mx, my + 8), "95 shared", font=label, fill=tokens["--ambe-text-2"], anchor="ms")
    draw_.text((40, 22), f"Frames {index - REACH} to {index + REACH}, each a 255-sample window that moves on 160",
               font=poster.font(26, "semibold"), fill=tokens["--ambe-text-2"])
