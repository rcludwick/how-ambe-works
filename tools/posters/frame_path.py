"""Fallback image of the frame-path figure (ch10): all six stages for one frame.

Drawn for lr-b's default pick, the second-ranked steady frame (the rule in
docs/javascripts/lib/picks.js). Print readers get the whole path, not only
the last step. Stage 5 prints the frame's hex as text; this module never
splits it into bits. The cutoff label is read from lib/cutoff.js so the
image and the figure say the same thing.
"""

from __future__ import annotations

import json
import re
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CUTOFF_JS = ROOT / "docs" / "javascripts" / "lib" / "cutoff.js"
CLIP = "lr-b"
THRESHOLD = 0.55
DB_FLOOR, DB_TOP = -90.0, -10.0

WIDTH, HEIGHT = 1280, 720
MARGIN, GAP = 28, 18
COLS, ROWS = 3, 2
PANEL_W = (WIDTH - 2 * MARGIN - (COLS - 1) * GAP) // COLS
PANEL_H = (HEIGHT - 2 * MARGIN - (ROWS - 1) * GAP) // ROWS


def steady_score(frame: dict) -> float:
    d = frame["derived"]
    return d["decoded_f0_confidence"] * min(d["band_voicing"][:6])


def default_frame(frames: list[dict]) -> dict:
    """PICKS.default: the second frame by steadyScore, ties in frame order."""
    return sorted(frames, key=lambda f: (-steady_score(f), f["i"]))[1]


def cutoff() -> tuple[float, str]:
    text = CUTOFF_JS.read_text(encoding="utf-8")
    hz = float(re.search(r"CUTOFF_HZ\s*=\s*(\d+)", text).group(1))
    label = re.search(r'CUTOFF_LABEL\s*=\s*"([^"]+)"', text).group(1)
    return hz, label


def samples(path: Path, start: int, count: int) -> list[int]:
    with wave.open(str(path), "rb") as wav:
        wav.setpos(start)
        raw = wav.readframes(count)
    return list(struct.unpack(f"<{len(raw) // 2}h", raw))


def panel(poster, n: int, title: str, provenance: str) -> tuple[int, int, int, int]:
    """Draw panel n's chrome; return its plot box (left, top, right, bottom)."""
    col, row = (n - 1) % COLS, (n - 1) // COLS
    x0 = MARGIN + col * (PANEL_W + GAP)
    y0 = MARGIN + row * (PANEL_H + GAP)
    poster.rect((x0, y0, x0 + PANEL_W, y0 + PANEL_H), "--ambe-surface-1")
    poster.rect((x0, y0, x0 + PANEL_W, y0 + PANEL_H), "--ambe-hairline", fill=False)
    poster.text((x0 + 16, y0 + 12), f"{n}  {title}", 22, "--ambe-text", weight="semibold")
    poster.text((x0 + 16, y0 + 42), provenance, 15, "--ambe-text-3")
    return x0 + 22, y0 + 76, x0 + PANEL_W - 18, y0 + PANEL_H - 40


def dashed(poster, x: float, top: float, bottom: float, name: str) -> None:
    y = top
    while y < bottom:
        poster.line([(x, y), (x, min(bottom, y + 5))], name, width=1)
        y += 9


def spectrum_points(row: list[float], centres: list[float], box) -> list[tuple[float, float]]:
    left, top, right, bottom = box
    points = []
    for hz, db in zip(centres, row):
        v = (max(DB_FLOOR, min(DB_TOP, db)) - DB_FLOOR) / (DB_TOP - DB_FLOOR)
        points.append((left + (right - left) * hz / 4000, bottom - (bottom - top) * v))
    return points


def draw(poster, data_dir: Path) -> None:
    frames_file = json.loads((data_dir / CLIP / "frames.json").read_text(encoding="utf-8"))
    spectra = json.loads((data_dir / CLIP / "spectra.json").read_text(encoding="utf-8"))
    clip = frames_file["clip"]
    frame = default_frame(frames_file["frames"])
    i, d = frame["i"], frame["derived"]
    cutoff_hz, cutoff_label = cutoff()

    # 1 Input: the frame's 160 samples, from the WAV.
    box = panel(poster, 1, "Input", "input (Piper TTS, 8 kHz)")
    left, top, right, bottom = box
    wav = data_dir.parent / "audio" / f"{CLIP}-original.wav"
    pcm = samples(wav, i * 160, 160)
    peak = max(1, max(abs(s) for s in pcm))
    mid = (top + bottom) / 2
    poster.line([(left, mid), (right, mid)], "--ambe-plot-grid", width=1)
    poster.line([(left + (right - left) * n / 159, mid - (bottom - top) * 0.46 * s / peak)
                 for n, s in enumerate(pcm)], "--ambe-plot-ink", width=2)
    poster.text((left, bottom + 10), "160 samples × 16 bits = 2,560 bits", 16, "--ambe-text-2")

    # 2 Pitch: input spectrum with the comb.
    box = panel(poster, 2, "Pitch", "derived (from the input audio)")
    left, top, right, bottom = box
    f0 = d["orig_f0_hz"]
    harmonics = int(cutoff_hz // f0) if f0 > 0 else 0
    for k in range(1, harmonics + 1):
        dashed(poster, left + (right - left) * k * f0 / 4000, top, bottom, "--ambe-accent-cool")
    cx = left + (right - left) * cutoff_hz / 4000
    poster.line([(cx, top), (cx, bottom)], "--ambe-plot-axis", width=1)
    poster.line(spectrum_points(spectra["original"][i], spectra["bin_centre_hz"], box), "--ambe-plot-ink", width=2)
    poster.text((left, bottom + 10), f"f0 {f0:.1f} Hz, L = {harmonics}; {cutoff_label} (illustrative)", 16, "--ambe-text-2")

    # 3 Voicing: eight band strengths against 0.55.
    box = panel(poster, 3, "Voicing", "derived (from the chip's decoded audio)")
    left, top, right, bottom = box
    band_w = (right - left) / 8
    for b, v in enumerate(d["band_voicing"]):
        y = bottom - (bottom - top) * max(0.0, min(1.0, v))
        name = "--ambe-accent-cool" if v >= THRESHOLD else "--ambe-plot-muted"
        poster.rect((left + b * band_w + band_w * 0.2, y, left + (b + 1) * band_w - band_w * 0.2, bottom), name)
    ty = bottom - (bottom - top) * THRESHOLD
    x = left
    while x < right:
        poster.line([(x, ty), (min(right, x + 8), ty)], "--ambe-accent", width=2)
        x += 13
    count = sum(1 for v in d["band_voicing"] if v >= THRESHOLD)
    poster.text((left, bottom + 10), f"{count} of 8 bands periodic at 0.55", 16, "--ambe-text-2")

    # 4 Encoder: a closed box.
    box = panel(poster, 4, "Encoder", "not observable from outside the chip")
    left, top, right, bottom = box
    bx0, by0, bx1, by1 = left + 50, top + 40, right - 50, bottom - 50
    poster.rect((bx0, by0, bx1, by1), "--ambe-surface-2")
    poster.rect((bx0, by0, bx1, by1), "--ambe-plot-axis", fill=False, width=2)
    poster.text((bx0 + 24, by0 + 34), "AMBE-3000", 30, "--ambe-plot-ink", weight="semibold")
    poster.text((bx0 + 24, by0 + 78), "internals not observable", 18, "--ambe-text-3")
    poster.text((left, bottom + 10), "The chip reports no internal parameters.", 16, "--ambe-text-2")

    # 5 The frame: the hex as the chip sent it, as text.
    box = panel(poster, 5, "The frame", "measured (AMBE-3000)")
    left, top, right, bottom = box
    poster.text((left, top + 44), frame["hex"], 34, "--ambe-plot-ink", weight="semibold")
    poster.text((left, top + 104), "72 bits, measured, in hex", 18, "--ambe-accent-cool")
    poster.text((left, top + 140), "2400 bit/s voice + 1200 bit/s FEC", 16, "--ambe-text-2")
    poster.text((left, top + 164), "= 3600 bit/s; 96 bits on the air per 20 ms", 16, "--ambe-text-2")
    poster.text((left, bottom + 10), "The voice bit split in D-STAR is not public.", 16, "--ambe-text-2")

    # 6 Decoded: decoded spectrum over the input's.
    box = panel(poster, 6, "Decoded", "derived (from the chip's decoded audio)")
    left, top, right, bottom = box
    ghost = spectrum_points(spectra["original"][i], spectra["bin_centre_hz"], box)
    poster.line(ghost, "--ambe-plot-muted", width=1)
    poster.line(spectrum_points(spectra["decoded"][i], spectra["bin_centre_hz"], box), "--ambe-plot-ink", width=2)
    poster.text((left, bottom + 10),
                f"delay {clip['decoded_delay_ms']:.1f} ms (correlation {clip['decoded_delay_correlation']:.3f})",
                16, "--ambe-text-2")
