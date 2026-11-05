"""Fallback image for the synth figure (docs/11-synthesis.md).

The 3D view's end state from its Corner preset: the spectra of frames 86 to
110 of lr-b stacked in depth, earlier frames behind, each split by
generator (sticks for the harmonics of the bands measured voiced, blocks of
shaped noise for the rest) over a strip of floor tiles that says which
generator owns each 500 Hz band. Frame 98 carries the highlight, and an
inset shows it flat. Mirrors docs/javascripts/lib/synth-model.js on the
precomputed frames.json and spectra.json (derived from the chip's decoded
audio); it reads no hex and makes no sound.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

SELECTED = 98
SIDE = 12
BANDS = 8
BAND_HZ = 500
NYQUIST = 4000
DB_FLOOR = -95
DB_TOP = -8


def lin_to_db(a: float) -> float:
    return 20 * math.log10(a) if a > 1e-9 else DB_FLOOR - 20


def frame_model(frames: list[dict], decoded: list[list[float]], i: int) -> dict:
    """buildFrameModel() without the display traces."""
    d = frames[i]["derived"]
    row = decoded[i]
    bin_hz = NYQUIST / len(row)
    amp = [10 ** (db / 20) for db in row]
    f0 = d["decoded_f0_hz"]
    voiced = d["band_voiced"]
    harmonics = []
    if f0 > 20:
        k = 1
        while k * f0 < NYQUIST:
            f = k * f0
            band = min(BANDS - 1, int(f // BAND_HZ))
            b = max(0, min(len(row) - 1, round(f / bin_hz)))
            harmonics.append({"k": k, "f": f, "band": band, "amp": amp[b], "voiced": bool(voiced[band])})
            k += 1
    noise = []
    for band in range(BANDS):
        lo, hi = band * BAND_HZ, (band + 1) * BAND_HZ
        peak = max([amp[j] for j in range(math.ceil(lo / bin_hz), len(amp)) if j < hi / bin_hz] or [0.0])
        noise.append({"band": band, "lo": lo, "hi": hi, "amp": peak * 0.8})
    return {"f0": f0, "voiced": voiced, "harmonics": harmonics, "noise": noise, "row": row}


def draw(poster, data_dir: Path) -> None:
    frames = json.loads((data_dir / "frames.json").read_text(encoding="utf-8"))["frames"]
    decoded = json.loads((data_dir / "spectra.json").read_text(encoding="utf-8"))["decoded"]
    sel = frame_model(frames, decoded, SELECTED)
    voiced_n = sum(1 for v in sel["voiced"] if v)

    poster.text((64, 32), "Two generators, one voice", 30, "--ambe-text", weight="semibold")
    poster.text((64, 76), "Each 20 ms frame's spectrum, split by generator and chosen band by band; earlier frames behind",
                18, "--ambe-text-3")

    # An oblique corner view: x right, level up, depth up and to the right.
    ox, oy = 230, 470
    width, height = 560, 290
    dx, dy = 12.0, -7.0  # per frame back in time

    def at(hz: float, db: float, d: int) -> tuple[float, float]:
        level = (max(DB_FLOOR, min(DB_TOP, db)) - DB_FLOOR) / (DB_TOP - DB_FLOOR)
        return (ox + width * hz / NYQUIST - dx * d, oy - height * level - dy * d)

    # Floor tiles, back to front.
    for d in range(-SIDE, SIDE + 1):  # back (earlier) to front (later)
        m = frame_model(frames, decoded, SELECTED + d)
        for band in range(BANDS):
            x0, y0 = at(band * BAND_HZ + 20, DB_FLOOR, d)
            x1, _ = at((band + 1) * BAND_HZ - 20, DB_FLOOR, d)
            owner = "--ambe-voiced" if m["voiced"][band] else "--ambe-unvoiced"
            c = poster.colour(owner)
            # A map read from above: near the token colour, lighter with distance.
            fill = (c[0], c[1], c[2], round(255 * (0.7 if d == 0 else 0.55 - 0.25 * abs(d) / SIDE)))
            poster.draw.polygon([(x0, y0 - 3), (x1, y0 - 3), (x1 + 6, y0 - 7), (x0 + 6, y0 - 7)], fill=fill)

    def neighbour(d: int) -> None:
        m = frame_model(frames, decoded, SELECTED + d)
        alpha = max(50, 200 - 11 * abs(d))
        pts = [at(j * NYQUIST / len(m["row"]), db, d) for j, db in enumerate(m["row"])]
        c = poster.colour("--ambe-plot-muted")
        poster.draw.line(pts, fill=(c[0], c[1], c[2], alpha // 2), width=1)
        for nb in m["noise"]:
            if m["voiced"][nb["band"]]:
                continue
            x0, y = at(nb["lo"] + 20, lin_to_db(nb["amp"]), d)
            x1, _ = at(nb["hi"] - 20, lin_to_db(nb["amp"]), d)
            u = poster.colour("--ambe-unvoiced")
            poster.draw.line([(x0, y), (x1, y)], fill=(u[0], u[1], u[2], alpha), width=2)
        for h in m["harmonics"]:
            if not h["voiced"]:
                continue
            x, y = at(h["f"], lin_to_db(h["amp"]), d)
            _, yb = at(h["f"], DB_FLOOR, d)
            v = poster.colour("--ambe-voiced")
            poster.draw.line([(x, yb), (x, y)], fill=(v[0], v[1], v[2], alpha), width=1)
            poster.draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(v[0], v[1], v[2], alpha))

    for d in range(-SIDE, 0):
        neighbour(d)

    # The selected frame: fill, sticks, blocks, then its spectrum as the highlight.
    row = sel["row"]
    pts = [at(j * NYQUIST / len(row), db, 0) for j, db in enumerate(row)]
    base = at(0, DB_FLOOR, 0)[1]
    poster.draw.polygon(pts + [(pts[-1][0], base), (pts[0][0], base)], fill=poster.colour("--ambe-highlight-fill-top"))
    for nb in sel["noise"]:
        if sel["voiced"][nb["band"]]:
            continue
        db = lin_to_db(nb["amp"])
        x0, y = at(nb["lo"] + 20, db, 0)
        x1, _ = at(nb["hi"] - 20, db, 0)
        u = poster.colour("--ambe-unvoiced")
        poster.draw.rectangle((x0, y, x1, min(base, y + 16)), fill=(u[0], u[1], u[2], 110))
        poster.line([(x0, y), (x1, y)], "--ambe-unvoiced", width=3)
    for h in sel["harmonics"]:
        if h["voiced"]:
            x, y = at(h["f"], lin_to_db(h["amp"]), 0)
            poster.line([(x, base), (x, y)], "--ambe-voiced", width=3)
    glow = poster.colour("--ambe-highlight-glow")
    poster.draw.line(pts, fill=glow, width=11, joint="curve")
    poster.line(pts, "--ambe-highlight", width=4)
    peak = min(pts, key=lambda p: p[1])
    poster.dot(peak, 5, "--ambe-highlight")
    chip = f"this frame: {sel['f0']:.1f} Hz, {voiced_n} of {BANDS} bands voiced"
    poster.draw.rounded_rectangle((peak[0] + 20, peak[1] - 52, peak[0] + 360, peak[1] - 20), 5,
                                  fill=poster.colour("--ambe-highlight-chip"), outline=poster.colour("--ambe-highlight"), width=2)
    poster.line([peak, (peak[0] + 20, peak[1] - 36)], "--ambe-highlight", width=2)
    poster.text((peak[0] + 32, peak[1] - 48), chip, 17, "--ambe-plot-ink")

    # Later frames, in front, keep only their floor tiles (the live view's
    # cutaway below 60 degrees of pitch).

    for khz in range(5):
        x, y = at(khz * 1000, DB_FLOOR, 0)
        poster.text((x - 8, y + 10), f"{khz} kHz" if khz == 0 else str(khz), 15, "--ambe-plot-muted")
    for db in (-80, -60, -40, -20):
        x, y = at(0, db, 0)
        label = "-20 dBFS" if db == -20 else str(db)
        poster.text((x - 12 - 9 * len(label), y - 9), label, 15, "--ambe-plot-muted")
    bx, by = at(NYQUIST, DB_FLOOR, -SIDE // 3)
    poster.text((bx + 14, by - 8), "earlier frames, 20 ms apart", 15, "--ambe-plot-muted")

    # Inset: frame 98 flat, as the flat view's spectrum panel draws it.
    il, it, ir, ib = 970, 150, 1216, 330
    poster.rect((il - 12, it - 34, ir + 12, ib + 30), "--ambe-sunken")
    poster.text((il - 4, it - 30), f"Frame {SELECTED}, flat", 16, "--ambe-text-3", weight="semibold")

    def fi(hz: float, db: float) -> tuple[float, float]:
        level = (max(DB_FLOOR, min(DB_TOP, db)) - DB_FLOOR) / (DB_TOP - DB_FLOOR)
        return (il + (ir - il) * hz / NYQUIST, ib - (ib - it) * level)

    for band in range(BANDS):
        x0, _ = fi(band * BAND_HZ + 15, 0)
        x1, _ = fi((band + 1) * BAND_HZ - 15, 0)
        poster.rect((x0, it, x1, it + 4), "--ambe-voiced" if sel["voiced"][band] else "--ambe-unvoiced")
    for nb in sel["noise"]:
        if not sel["voiced"][nb["band"]]:
            x0, y = fi(nb["lo"] + 15, lin_to_db(nb["amp"]))
            x1, _ = fi(nb["hi"] - 15, lin_to_db(nb["amp"]))
            poster.line([(x0, y), (x1, y)], "--ambe-unvoiced", width=2)
    for h in sel["harmonics"]:
        if h["voiced"]:
            x, y = fi(h["f"], lin_to_db(h["amp"]))
            poster.line([(x, ib), (x, y)], "--ambe-voiced", width=2)
    poster.line([fi(j * NYQUIST / len(row), db) for j, db in enumerate(row)], "--ambe-highlight", width=2)
    poster.line([(il, ib), (ir, ib)], "--ambe-plot-axis", width=1)
    for khz in range(5):
        x, _ = fi(khz * 1000, 0)
        poster.text((x - 5, ib + 6), str(khz), 13, "--ambe-plot-muted")

    poster.text((960, 486), "sticks: harmonics, voiced bands", 16, "--ambe-text-2")
    poster.text((960, 512), "blocks: noise, unvoiced bands", 16, "--ambe-text-2")
    poster.text((960, 538), "thick line: this frame's spectrum", 16, "--ambe-text-2")
    poster.text((64, 684), "Levels, f0 and band voicing derived from the audio a DVSI AMBE-3000 decoded; the drawing is "
                "illustrative, not the decoder's output (US 5,754,974).", 15, "--ambe-text-4")
