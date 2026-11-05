"""Fallback image of the envelope figure (ch09): the voiced stretch as a waterfall.

The 3D view's end state at its Corner preset, in the light tokens (print
takes the light theme): one row per 20 ms frame of the stretch that
docs/javascripts/lib/picks.js voicedStretch picks (lr-b frames 95 to 124),
earlier frames at the back, each row a line through one dot per harmonic,
coloured on the ramp by time and faded by distance from frame 112, which
wears the highlight with its chip. Frame 98 is drawn as data like any other
row and carries no label. The levels are read as the figure reads them
(lib/harmonics.js envelopeAmplitudes, up to the cutoff in lib/cutoff.js).
It draws pictures; it holds no codec logic and reads no hex.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXTRA_CSS = ROOT / "docs" / "stylesheets" / "extra.css"
CUTOFF_JS = ROOT / "docs" / "javascripts" / "lib" / "cutoff.js"

WIDTH, HEIGHT = 1280, 720
# Scene size (anim-envelope-3d.js EXTENT) and the Corner preset, degrees.
EXTENT = (2.4, 0.6, 2.4)
YAW, PITCH = 30.0, 30.0
BOX = (150, 120, 1090, 640)  # where the stretch is fitted: left, top, right, bottom
FADE_CAP_LIGHT = 0.45


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
            continue
        rgba = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
        if rgba:
            alpha = 1.0 if rgba.group(4) is None else float(rgba.group(4))
            tokens[name] = (int(rgba.group(1)), int(rgba.group(2)), int(rgba.group(3)), round(alpha * 255))
    return tokens


def cutoff() -> tuple[float, str]:
    text = CUTOFF_JS.read_text(encoding="utf-8")
    hz = float(re.search(r"CUTOFF_HZ\s*=\s*(\d+)", text).group(1))
    label = re.search(r'CUTOFF_LABEL\s*=\s*"([^"]+)"', text).group(1)
    return hz, label


def strong_voiced(frame: dict) -> bool:
    d = frame["derived"]
    return d["voiced"] and d["orig_f0_hz"] > 0 and d["orig_f0_confidence"] >= 0.6 and d["orig_rms_dbfs"] > -32


def voiced_stretch(frames: list[dict]) -> tuple[tuple[int, int], int]:
    """lib/picks.js voicedStretch: the longest strong voiced run and its surest frame."""
    best, start = None, -1
    for k in range(len(frames) + 1):
        if k < len(frames) and strong_voiced(frames[k]):
            if start < 0:
                start = k
            continue
        if start >= 0 and (best is None or k - 1 - start > best[1] - best[0]):
            best = (start, k - 1)
        start = -1
    pick = best[0]
    for k in range(best[0], best[1] + 1):
        if frames[k]["derived"]["orig_f0_confidence"] > frames[pick]["derived"]["orig_f0_confidence"]:
            pick = k
    return (frames[best[0]]["i"], frames[best[1]]["i"]), frames[pick]["i"]


def levels(row: list[float], f0: float, bin_hz: float, top_hz: float) -> list[tuple[float, float]]:
    """lib/harmonics.js envelopeAmplitudes: the largest of the three bins nearest m * f0."""
    out, m = [], 1
    while m * f0 <= top_hz:
        centre = round(m * f0 / bin_hz)
        out.append((m * f0, max(row[k] for k in (centre - 1, centre, centre + 1) if 0 <= k < len(row))))
        m += 1
    return out


def y_domain(dbs: list[float]) -> tuple[float, float]:
    """anim-envelope.js yDomain."""
    top = math.ceil((max(dbs) + 9) / 5) * 5
    return min(math.floor((min(dbs) - 9) / 5) * 5, top - 40), top


def smooth(points: list[tuple[float, float]], per: int = 6) -> list[tuple[float, float]]:
    """anim-envelope.js smoothCurve (uniform Catmull-Rom)."""
    if len(points) < 3:
        return points[:]
    p = [points[0], *points, points[-1]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for s in range(per):
            t = s / per
            out.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in (0, 1)))
    out.append(p[-2])
    return out


# Colour, as lib/style.js does it: ramps in OKLab, fades in sRGB.

def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gam(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _lab(rgb) -> list[float]:
    r, g, b = (_lin(c / 255) for c in rgb[:3])
    lms = [math.copysign(abs(v) ** (1 / 3), v) for v in (
        0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
        0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
        0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)]
    l, m, s = lms
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]


def _rgb(lab) -> tuple[int, int, int, int]:
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    return (*(round(min(1, max(0, _gam(c))) * 255) for c in rgb), 255)


def ramp(tokens, t: float):
    stops = [_lab(tokens[f"--ambe-ramp-{i}"]) for i in range(5)]
    x = min(1.0, max(0.0, t)) * 4
    i = min(3, int(x))
    f = x - i
    return _rgb([a + (b - a) * f for a, b in zip(stops[i], stops[i + 1])])


def mix(a, b, amount: float):
    return (*(round(x + (y - x) * amount) for x, y in zip(a[:3], b[:3])), 255)


def fade_amount(delta: int) -> float:
    d = abs(delta)
    return 0.0 if d <= 1 else min(FADE_CAP_LIGHT, 0.12 + 0.06 * (d - 1))


def draw(poster, data_dir: Path) -> None:
    tokens = light_tokens()
    poster.tokens = {**poster.tokens, **tokens}
    poster.draw.rectangle((0, 0, WIDTH, HEIGHT), fill=poster.colour("--ambe-plot-bg"))
    frames = json.loads((data_dir / "frames.json").read_text(encoding="utf-8"))["frames"]
    spectra = json.loads((data_dir / "spectra.json").read_text(encoding="utf-8"))
    cutoff_hz, cutoff_label = cutoff()
    (first, last), chosen = voiced_stretch(frames)
    rows = []
    for i in range(first, last + 1):
        f0 = frames[i]["derived"]["orig_f0_hz"]
        dots = levels(spectra["original"][i], f0, spectra["bin_hz"], cutoff_hz)
        rows.append({"i": i, "t": frames[i]["t"], "dots": dots, "curve": smooth(dots),
                     "y": y_domain([d for _, d in dots])})
    lo = min(r["y"][0] for r in rows)
    hi = max(r["y"][1] for r in rows)
    t0, t1 = rows[0]["t"], rows[-1]["t"]
    sel = chosen - first

    # Scene units (anim-envelope-3d.js toScene), then the Corner camera.
    def scene(hz: float, db: float, t: float):
        return ((hz / 4000 - 0.5) * EXTENT[0], ((max(db, lo) - lo) / (hi - lo) - 0.5) * EXTENT[1],
                ((t - t0) / (t1 - t0) - 0.5) * EXTENT[2])

    yaw, pitch = math.radians(YAW), math.radians(PITCH)
    right = (math.cos(yaw), 0.0, -math.sin(yaw))
    up = (-math.sin(pitch) * math.sin(yaw), math.cos(pitch), -math.sin(pitch) * math.cos(yaw))

    def view(p):
        return (sum(a * b for a, b in zip(p, right)), sum(a * b for a, b in zip(p, up)))

    corners = [view((x * EXTENT[0] / 2, y * EXTENT[1] / 2, z * EXTENT[2] / 2))
               for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    x0, x1 = min(c[0] for c in corners), max(c[0] for c in corners)
    y0, y1 = min(c[1] for c in corners), max(c[1] for c in corners)
    left, top, rgt, bottom = BOX
    s = min((rgt - left) / (x1 - x0), (bottom - top) / (y1 - y0))
    ox = (left + rgt) / 2 - s * (x0 + x1) / 2
    oy = (top + bottom) / 2 + s * (y0 + y1) / 2

    def px(p):
        vx, vy = view(p)
        return (ox + s * vx, oy - s * vy)

    def at(hz, db, t):
        return px(scene(hz, db, t))

    bg = poster.colour("--ambe-plot-bg")
    floor_y = -EXTENT[1] / 2
    ex, ez = EXTENT[0] / 2, EXTENT[2] / 2
    poster.draw.polygon([px((-ex, floor_y, -ez)), px((ex, floor_y, -ez)), px((ex, floor_y, ez)), px((-ex, floor_y, ez))],
                        fill=poster.colour("--ambe-3d-floor"))
    for k in range(5):
        x = -ex + k * EXTENT[0] / 4
        poster.line([px((x, floor_y, -ez)), px((x, floor_y, ez))], "--ambe-3d-grid", 1)
        poster.line([px((x, floor_y, -ez)), px((x, EXTENT[1] / 2, -ez))], "--ambe-plot-grid", 1)
    for t in (2.0, 2.2):
        z = scene(0, lo, t)[2]
        poster.line([px((-ex, floor_y, z)), px((ex, floor_y, z))], "--ambe-3d-grid", 1)
        x, y = px((ex, floor_y, z))
        poster.text((x + 12, y - 9), f"{t:.1f}", 16, "--ambe-text-3")
    for db in range(int(math.ceil(lo / 20) * 20), int(hi) + 1, 20):
        a, b = px(scene(0, db, t0)), px(scene(4000, db, t0))
        poster.line([a, b], "--ambe-plot-grid", 1)
    poster.line([px((-ex, floor_y, ez)), px((ex, floor_y, ez))], "--ambe-plot-axis", 1)
    poster.line([px((-ex, floor_y, -ez)), px((-ex, floor_y, ez))], "--ambe-plot-axis", 1)
    poster.line([px((-ex, floor_y, -ez)), px((-ex, EXTENT[1] / 2, -ez))], "--ambe-plot-axis", 1)
    for k in range(5):
        x, y = px((-ex + k * EXTENT[0] / 4, floor_y, ez))
        poster.text((x - 4, y + 8), str(k), 16, "--ambe-text-3")
    cx = scene(cutoff_hz, lo, t0)[0]
    a, b = px((cx, floor_y, -ez)), px((cx, floor_y, ez))
    for n in range(24):
        f0_, f1_ = n / 24, (n + 0.55) / 24
        poster.line([(a[0] + (b[0] - a[0]) * f0_, a[1] + (b[1] - a[1]) * f0_),
                     (a[0] + (b[0] - a[0]) * f1_, a[1] + (b[1] - a[1]) * f1_)], "--ambe-plot-axis", 1)

    def row_colour(r: int):
        cut = 0.15 if r > sel else 0.0
        return mix(ramp(tokens, r / (len(rows) - 1)), bg, min(1.0, fade_amount(r - sel) + cut))

    def draw_row(r: int) -> None:
        row = rows[r]
        colour = row_colour(r)
        # Straight between the dots, as the 3D view draws the other rows.
        line = [at(hz, db, row["t"]) for hz, db in row["dots"]]
        if r < sel:
            # A frosted curtain under the rows behind the highlight; the
            # cutaway rule leaves the rows in front as lines only.
            curtain = line + [at(row["dots"][-1][0], lo, row["t"]), at(row["dots"][0][0], lo, row["t"])]
            poster.draw.polygon(curtain, fill=mix(colour, bg, 0.84))
        poster.draw.line(line, fill=colour, width=2, joint="curve")
        for hz, db in row["dots"]:
            x, y = at(hz, db, row["t"])
            poster.draw.ellipse((x - 2.6, y - 2.6, x + 2.6, y + 2.6), fill=colour)

    for r in range(sel):
        draw_row(r)
    chosen_row = rows[sel]
    tz = chosen_row["t"]
    fill = [at(hz, db, tz) for hz, db in chosen_row["curve"]]
    fill += [at(chosen_row["curve"][-1][0], lo, tz), at(chosen_row["curve"][0][0], lo, tz)]
    poster.draw.polygon(fill, fill=poster.colour("--ambe-highlight-fill-top"))
    for r in range(sel + 1, len(rows)):
        draw_row(r)
    outline = mix(poster.colour("--ambe-highlight"), bg, 0.3)
    peak = max(chosen_row["curve"], key=lambda p: p[1])
    box_pts = [at(0, lo, tz), at(4000, lo, tz), at(4000, peak[1], tz), at(0, peak[1], tz), at(0, lo, tz)]
    for (ax, ay), (bx, by) in zip(box_pts, box_pts[1:]):
        steps = max(1, int(math.hypot(bx - ax, by - ay) / 12))
        for n in range(steps):
            f0_, f1_ = n / steps, (n + 0.55) / steps
            poster.draw.line([(ax + (bx - ax) * f0_, ay + (by - ay) * f0_), (ax + (bx - ax) * f1_, ay + (by - ay) * f1_)],
                             fill=outline, width=2)
    for hz, db in chosen_row["dots"]:
        x, y = at(hz, db, tz)
        poster.draw.line([(x, y), at(hz, lo, tz)], fill=poster.colour("--ambe-plot-axis"), width=1)
    poster.draw.line(fill[:-2], fill=poster.colour("--ambe-highlight"), width=5, joint="curve")
    for hz, db in chosen_row["dots"]:
        x, y = at(hz, db, tz)
        poster.draw.ellipse((x - 4.5, y - 4.5, x + 4.5, y + 4.5), fill=poster.colour("--ambe-plot-ink"))

    # The chip, with its leader to the line's highest point.
    ax, ay = at(*peak, tz)
    chip = f"frame {chosen_row['i']}: L = {len(chosen_row['dots'])}"
    font = poster.font(20, "semibold")
    tw = poster.draw.textlength(chip, font=font)
    cx0, cy0 = ax + 70, ay - 62
    poster.draw.line([(ax, ay), (cx0, cy0 + 34)], fill=poster.colour("--ambe-highlight"), width=2)
    poster.draw.ellipse((ax - 4, ay - 4, ax + 4, ay + 4), fill=poster.colour("--ambe-highlight"))
    poster.draw.rounded_rectangle((cx0, cy0, cx0 + tw + 48, cy0 + 36), radius=5, fill=poster.colour("--ambe-highlight-chip"),
                                  outline=poster.colour("--ambe-highlight"), width=2)
    poster.draw.line([(cx0 + 12, cy0 + 18), (cx0 + 30, cy0 + 18)], fill=poster.colour("--ambe-highlight"), width=4)
    poster.text((cx0 + 38, cy0 + 6), chip, 20, "--ambe-plot-ink", weight="semibold")

    for r in (0, len(rows) - 1):
        row = rows[r]
        x, y = px((ex, floor_y, scene(0, lo, row["t"])[2]))
        poster.text((x + 12, y - 11), f"{row['t']:.2f} s: L = {len(row['dots'])}", 18, "--ambe-text-2", weight="semibold")

    poster.line([px((-ex, floor_y, ez)), px((-ex, EXTENT[1] / 2, ez))], "--ambe-plot-axis", 1)
    for db in range(int(math.floor(hi / 20) * 20), int(lo) - 1, -40):
        x, y = px(scene(0, db, t1))
        poster.text((x - 44, y - 9), str(db), 16, "--ambe-text-3")
    x, y = px((0, floor_y, ez))
    poster.text((x - 70, y + 34), "frequency (kHz)", 18, "--ambe-text-2")
    x, y = px((-ex, EXTENT[1] / 2, ez))
    poster.text((x - 60, y - 34), "level (dBFS)", 18, "--ambe-text-2")
    x, y = px((ex, floor_y, 0))
    poster.text((x + 60, y + 2), "time (s)", 18, "--ambe-text-2")
    poster.text((40, 24), "Harmonic levels over one voiced stretch, one row per 20 ms frame", 26, "--ambe-text",
                weight="semibold")
    poster.text((40, 60), f"frames {first} to {last}, earlier frames at the back; derived (from the input audio); "
                f"{cutoff_label} (illustrative)", 18, "--ambe-text-3")
