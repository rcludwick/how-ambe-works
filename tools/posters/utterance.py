"""Fallback image for the utterance figure (docs/01-why-sinusoids.md).

lj-c, the vowel window: the sentence's envelope with the window marked,
the 60 ms closeup with its period marks, and beside them a small Corner
view of the closeup cut into pitch periods and stacked in depth (period 1
in front), each period on the ramp and the one that holds the largest
sample in the highlight. Mirrors docs/javascripts/lib/periods.js and
anim-utterance.js: the cuts sit a quarter period before the largest
sample, one vowel period (8000 / 185.9 samples) apart. It draws stored
samples of the input recording; nothing here comes from the codec.

It is drawn in the light tokens (the :root block of extra.css), since the
poster is what print shows and print is white paper (visual language
design; plan checklist). tools/make-posters.py now hands every poster the
light tokens; draw() still swaps in its own copy and repaints the ground.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

EXTRA_CSS = Path(__file__).resolve().parents[2] / "docs" / "stylesheets" / "extra.css"

CLIP = "lj-c"
FULL_SCALE = 32768
SR = 8000
ROWS = 10
YAW, PITCH = -24.0, 30.0  # the Corner preset


def _rgba(value: str):
    value = re.sub(r"/\*.*?\*/", "", value).strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
    if m:
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
    if m:
        alpha = 1.0 if m.group(4) is None else float(m.group(4))
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)), round(alpha * 255))
    return None


def light_tokens(css: str) -> dict:
    """Colour tokens of the first :root block of extra.css, the light theme."""
    block = re.search(r"^:root\s*\{(.*?)^\}", css, re.S | re.M)
    tokens = {}
    for name, value in re.findall(r"(--ambe-[\w-]+)\s*:\s*([^;]+);", block.group(1) if block else ""):
        colour = _rgba(value)
        if colour:
            tokens[name] = colour
    return tokens


def waveform(data: Path) -> dict:
    return json.loads((data / CLIP / "waveform.json").read_text(encoding="utf-8"))


def sample_at(samples: list[float], t: float) -> float:
    last = len(samples) - 1
    if t <= 0:
        return samples[0]
    if t >= last:
        return samples[last]
    i = math.floor(t)
    f = t - i
    return samples[i] * (1 - f) + samples[i + 1] * f


def largest(samples: list[float]) -> int:
    at = 0
    for i, v in enumerate(samples):
        if abs(v) > abs(samples[at]):
            at = i
    return at


def cuts(samples: list[float], period: float) -> list[float]:
    """Every cut inside the window, as lib/periods.js slicePeriods makes them."""
    c = largest(samples) - period / 4
    while c - period >= 0:
        c -= period
    out = []
    while c <= len(samples) - 1:
        if c >= 0:
            out.append(c)
        c += period
    return out


def periods(samples: list[float], period: float) -> list[list[tuple[float, float]]]:
    """Each whole period as (time from its cut, value) pairs, cut points
    interpolated, so neighbouring periods share their ends."""
    cs = cuts(samples, period)
    out = []
    for a, b in zip(cs, cs[1:]):
        ts = [a] + [float(i) for i in range(math.floor(a) + 1, math.ceil(b)) if a < i < b] + [b]
        out.append([(t - a, sample_at(samples, t)) for t in ts])
    return out


def peak_period(samples: list[float], period: float) -> int:
    t0 = largest(samples)
    cs = cuts(samples, period)
    for k, (a, b) in enumerate(zip(cs, cs[1:])):
        if a <= t0 < b:
            return k
    return 0


def _mix(a, b, f: float):
    return tuple(round(a[i] + (b[i] - a[i]) * f) for i in range(3)) + (255,)


def ramp(poster, t: float):
    stops = [poster.colour(f"--ambe-ramp-{i}") for i in range(5)]
    x = min(1.0, max(0.0, t)) * 4
    i = min(3, int(x))
    return _mix(stops[i], stops[i + 1], x - i)


def draw(poster, data: Path) -> None:
    poster.tokens = light_tokens(EXTRA_CSS.read_text(encoding="utf-8"))
    poster.draw.rectangle((0, 0, poster.image.width, poster.image.height), fill=poster.colour("--ambe-plot-bg"))
    d = waveform(data)
    win = d["closeups"]["voiced"]
    samples = win["samples"]
    period = SR / win["f0_hz"]
    peak = max(1, max(abs(v) for v in samples))
    scale = 0.92 / (peak / FULL_SCALE)
    ys = [(v / FULL_SCALE) * scale for v in samples]
    ms = len(samples) / SR * 1000
    period_ms = 1000 * period / SR
    hi = peak_period(samples, period)

    poster.text((40, 28), "A sentence, and sixty milliseconds of it", 34, "--ambe-text", weight="semibold")

    # -- the sentence's envelope, the window marked -------------------------
    L, R = 60, 720
    top, bottom = 104, 214
    mid = (top + bottom) / 2
    dur = d["clip"]["duration_s"]
    bucket = d["bucket_ms"] / 1000
    mins, maxs = d["original"]["min"], d["original"]["max"]

    def tx(s: float) -> float:
        return L + (R - L) * s / dur

    half = (bottom - top) / 2
    band = [(tx(i * bucket), mid - half * maxs[i] / FULL_SCALE) for i in range(len(maxs))]
    band += [(tx(i * bucket), mid - half * mins[i] / FULL_SCALE) for i in range(len(mins) - 1, -1, -1)]
    poster.draw.polygon(band, fill=poster.colour("--ambe-data-1"))
    w0, w1 = tx(win["start_s"]), tx(win["start_s"] + len(samples) / SR)
    poster.draw.rectangle((w0 - 2, top - 6, max(w1, w0 + 4) + 2, bottom + 6), outline=poster.colour("--ambe-accent-warm"), width=3)
    poster.text((L, 72), f"“{d['clip']['text']}”", 22, "--ambe-text-3")

    # -- the closeup, each period on the ramp, the highlight thick ---------
    top2, bottom2 = 270, 590
    mid2 = (top2 + bottom2) / 2
    half2 = (bottom2 - top2) / 2

    def cx(t_ms: float) -> float:
        return L + (R - L) * t_ms / ms

    def cy(v: float) -> float:
        return mid2 - half2 * v

    poster.line([(L, bottom2), (R, bottom2)], "--ambe-plot-axis", width=2)
    poster.line([(L, mid2), (R, mid2)], "--ambe-plot-grid", width=1)
    for t in range(0, 61, 10):
        poster.line([(cx(t), bottom2), (cx(t), bottom2 + 8)], "--ambe-plot-axis", width=2)
        poster.text((cx(t) - 18, bottom2 + 12), f"{t} ms", 20, "--ambe-text-3")
    cs = cuts(samples, period)
    poster.line([(cx(i / SR * 1000), cy(ys[i])) for i in range(len(ys))], "--ambe-plot-muted", width=2)
    for k, (a, b) in enumerate(zip(cs, cs[1:])):
        pts = [(a, sample_at(ys, a))] + [(i, ys[i]) for i in range(math.floor(a) + 1, math.ceil(b)) if a < i < b] + [(b, sample_at(ys, b))]
        xy = [(cx(t / SR * 1000), cy(v)) for t, v in pts]
        if k == hi:
            continue
        poster.draw.line(xy, fill=ramp(poster, k / (ROWS - 1)), width=3, joint="curve")
    a, b = cs[hi], cs[hi + 1]
    pts = [(a, sample_at(ys, a))] + [(i, ys[i]) for i in range(math.floor(a) + 1, math.ceil(b)) if a < i < b] + [(b, sample_at(ys, b))]
    poster.line([(cx(t / SR * 1000), cy(v)) for t, v in pts], "--ambe-highlight", width=6)
    t0 = largest(samples) / SR * 1000
    t = t0
    while t <= ms:
        x = cx(t)
        for y in range(top2, bottom2, 14):
            poster.line([(x, y), (x, min(bottom2, y + 7))], "--ambe-accent-warm", width=2)
        t += period_ms
    poster.text((cx(t0) + 10, top2 - 32), f"one period: {period_ms:.2f} ms", 22, "--ambe-highlight")

    # -- the stack, Corner view ---------------------------------------------
    yaw, pitch = math.radians(YAW), math.radians(PITCH)
    ex = 6.4
    ez = ex * 0.42

    def raw(x: float, y: float, z: float) -> tuple[float, float]:
        u = x * math.cos(yaw) - z * math.sin(yaw)
        v = -x * math.sin(pitch) * math.sin(yaw) + y * math.cos(pitch) - z * math.sin(pitch) * math.cos(yaw)
        return u, v

    def z_of(k: int) -> float:
        return ez / 2 - k * ez / (ROWS - 1)

    corners = [raw(x, y, z) for x in (-ex / 2, ex / 2) for y in (-1, 1) for z in (-ez / 2, ez / 2)]
    u0, u1 = min(c[0] for c in corners), max(c[0] for c in corners)
    v0, v1 = min(c[1] for c in corners), max(c[1] for c in corners)
    box = (780, 150, 1240, 600)
    k_s = min((box[2] - box[0]) / (u1 - u0), (box[3] - box[1]) / (v1 - v0))
    ox = (box[0] + box[2]) / 2 - k_s * (u0 + u1) / 2
    oy = (box[1] + box[3]) / 2 + k_s * (v0 + v1) / 2

    def P(x: float, y: float, z: float) -> tuple[float, float]:
        u, v = raw(x, y, z)
        return round(ox + k_s * u, 2), round(oy - k_s * v, 2)

    floor = [P(-ex / 2, -1, ez / 2), P(ex / 2, -1, ez / 2), P(ex / 2, -1, -ez / 2), P(-ex / 2, -1, -ez / 2)]
    poster.draw.polygon(floor, fill=poster.colour("--ambe-3d-floor"))
    for k in range(ROWS):
        poster.line([P(-ex / 2, -1, z_of(k)), P(ex / 2, -1, z_of(k))], "--ambe-3d-grid", width=1)
    slices = periods(ys, period)
    for k in range(len(slices) - 1, -1, -1):
        z = z_of(k)
        pts = [P(-ex / 2 + ex * t / period, v, z) for t, v in slices[k]]
        curtain = [P(-ex / 2, -1, z)] + pts + [P(ex / 2, -1, z)]
        poster.draw.polygon(curtain, fill=poster.colour("--ambe-3d-floor"))
        if k == hi:
            poster.line(pts, "--ambe-highlight", width=6)
        else:
            poster.draw.line(pts, fill=ramp(poster, k / (ROWS - 1)), width=3, joint="curve")
    x, y = P(-ex / 2, -1, z_of(0))
    poster.text((x + 10, y + 16), f"period 1 at the front, {ROWS} at the back", 20, "--ambe-text-3")
    poster.text((box[0], 74), "Cut at each period and stacked", 22, "--ambe-text-2")

    poster.text((40, 664), "Samples of the input recording (Piper TTS, LJ Speech voice) before it reached the codec; "
                "periods cut 5.38 ms apart.", 20, "--ambe-text-3")
