#!/usr/bin/env python3
"""Draw the spectrogram pictures behind the glossary's speech-sound diagrams.

The clips, time spans and marks live in SPECTROGRAMS in
tools/glossary-diagrams.py, which draws the axes and labels around each
picture. This script draws only the plot area: one PNG per entry in
docs/assets/glossary/. A 32 ms Hann window every 2 ms, levels from the
loudest point down 60 dB, dark for quiet and bright for loud.

    uv run --group data python tools/glossary-spectrograms.py
"""

from __future__ import annotations

import importlib.util
import wave
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets" / "glossary"
RATE = 8000
WINDOW, HOP = 256, 16
FLOOR_DB = 60.0
GAMMA = 1.6  # keeps quiet noise dark, so the loud structure stands out
SCALE = 1.5  # pixels per SVG unit: sharp enough on a phone, small enough to load
COLOURS = 64  # a palette PNG; the ramp needs no more

# Dark to bright: near black, the site's indigo, then a pale warm white.
RAMP = [(0.0, (12, 14, 28)), (0.45, (60, 70, 190)), (0.75, (150, 160, 255)), (1.0, (255, 248, 230))]


def diagrams():
    spec = importlib.util.spec_from_file_location("glossary_diagrams", ROOT / "tools" / "glossary-diagrams.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load(clip: str) -> np.ndarray:
    with wave.open(str(ROOT / "docs" / "assets" / "audio" / f"{clip}-original.wav")) as w:
        assert w.getframerate() == RATE and w.getsampwidth() == 2 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768


def colour(level: np.ndarray) -> np.ndarray:
    stops = np.array([s for s, _ in RAMP])
    rgb = np.array([c for _, c in RAMP], dtype=float)
    return np.stack([np.interp(level, stops, rgb[:, k]) for k in range(3)], axis=-1).astype(np.uint8)


def draw(spec: dict, width: int, height: int) -> Image.Image:
    x = load(spec["clip"])
    # Centre each window on its moment, so the picture lines up with t0 and t1.
    start = int(spec["t0"] * RATE) - WINDOW // 2
    stop = int(spec["t1"] * RATE) - WINDOW // 2
    pad = np.pad(x, WINDOW)
    window = np.hanning(WINDOW)
    frames = np.array([pad[i + WINDOW:i + 2 * WINDOW] * window for i in range(start, stop, HOP)])
    db = 20 * np.log10(np.abs(np.fft.rfft(frames, axis=1)) + 1e-9)
    level = np.clip((db - db.max() + FLOOR_DB) / FLOOR_DB, 0, 1) ** GAMMA
    picture = Image.fromarray(colour(level.T[::-1]))
    picture = picture.resize((round(width * SCALE), round(height * SCALE)), Image.Resampling.BILINEAR)
    return picture.quantize(COLOURS, dither=Image.Dither.NONE)


def main() -> int:
    d = diagrams()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, spec in d.SPECTROGRAMS.items():
        draw(spec, d.SPEC_X1 - d.SPEC_X0, d.SPEC_Y1 - d.SPEC_Y0).save(OUT / f"{name}.png", optimize=True)
    print(f"glossary-spectrograms: wrote {len(d.SPECTROGRAMS)} pictures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
