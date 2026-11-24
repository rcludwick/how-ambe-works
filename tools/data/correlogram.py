"""correlogram.py: the pitch-search figure's data (ch08).

Writes docs/assets/data/lr-b/correlogram.json:

  - `window`: 255 samples of the input clip, centred on one frame, which
    the figure windows and autocorrelates in the browser (display DSP on
    one frame's values, owner decision O3, design question 2);
  - `rows`: for every frame of the clip, the autocorrelation of the same
    window there, at lags 22 to 114, for the whole-clip view;
  - `tracker_period`: the site's own pitch track (frames.json
    `orig_f0_hz`), turned into a period in samples, so the figure draws it
    over the rows without a second file.

Provenance: derived-input. Everything here is computed from the Piper TTS
input clip (docs/assets/audio/lr-b-original.wav), not from the chip and
not from its decoded audio. The site's tracker is a generic
autocorrelation tracker (SCHEMA.md, "Pitch"), not the codec's.

Recipe (three-everywhere design §5.4):

  - the window is 255 samples, Hamming (a display choice), centred on the
    frame's middle sample (frame i covers samples 160 i to 160 i + 159, so
    the centre is 160 i + 80 and the window runs from 160 i - 47);
    samples before the start or after the end of the clip are zero;
  - phi(m) is the autocorrelation of w^2(n) s(n) (Griffin and Lim 1988,
    eq. 13), divided by phi(0), so every row starts at 1;
  - a row stores phi at lags 22 to 114 (the range US 5,216,747 searches,
    22 <= P < 115), as integer percent, negative values as 0;
  - the stored window is the loudest frame of the clip's first voiced run
    (orig_f0_hz above 0), frame 8 of lr-b, in "CQ".

It checks the numbers the figure states, on the stored window, with the
figure's score Psi(P) = P x the sum of phi(kP) over k = 1, 2, ... (lags
up to 254): the score on 22 to 114 is largest at P = 46, 44.45; at P = 23
it is 34.92, 79% of that. It also checks that the stored track leaves the
20% corridor of US 5,216,747's look-back rule between frames 66 and 67
(41.8 to 57.3 samples).

Run by tools/make-data.py after the clips, or alone:
    uv run --group data python tools/data/correlogram.py
"""

from __future__ import annotations

import json
import os
import sys
import wave

import numpy as np

CLIP = "lr-b"
SR = 8000
FRAME = 160
N = 255
LAG_MIN, LAG_MAX = 22, 114
ALPHA = 0.2
OUT = "correlogram.json"
EXPECT = {"frame": 8, "best": 46, "psi_best": 44.45, "psi_half": 34.92, "share": 79,
          "exit": 67, "exit_from": 41.8, "exit_to": 57.3}


def samples(audio_dir: str) -> np.ndarray:
    with wave.open(os.path.join(audio_dir, f"{CLIP}-original.wav")) as w:
        if w.getframerate() != SR or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit(f"correlogram: {CLIP}-original.wav is not 8 kHz mono 16-bit")
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.int64)


def window_at(x: np.ndarray, frame: int) -> np.ndarray:
    """255 samples centred on the frame's middle sample, zero outside the clip."""
    lo = frame * FRAME + FRAME // 2 - N // 2
    out = np.zeros(N, dtype=np.int64)
    a, b = max(0, lo), min(len(x), lo + N)
    if b > a:
        out[a - lo:b - lo] = x[a:b]
    return out


def phi(segment: np.ndarray) -> np.ndarray:
    """Autocorrelation of w^2 s at lags 0 to N - 1, over phi(0)."""
    v = np.hamming(N) ** 2 * segment.astype(float)
    full = np.correlate(v, v, mode="full")[N - 1:]
    return full / full[0] if full[0] > 0 else np.zeros(N)


def psi(p: np.ndarray, period: int) -> float:
    """The figure's score: period x the sum of phi(k period), k = 1, 2, ..."""
    return period * float(sum(p[k * period] for k in range(1, (N - 1) // period + 1)))


def build(data_dir: str, audio_dir: str) -> dict:
    with open(os.path.join(data_dir, CLIP, "frames.json")) as f:
        frames = json.load(f)["frames"]
    x = samples(audio_dir)
    f0 = [fr["derived"]["orig_f0_hz"] for fr in frames]
    period = [round(SR / v, 2) if v > 0 else 0 for v in f0]

    # The loudest frame of the first voiced run.
    first = next(i for i, v in enumerate(f0) if v > 0)
    run = []
    for i in range(first, len(frames)):
        if f0[i] <= 0:
            break
        run.append(i)
    pick = max(run, key=lambda i: frames[i]["derived"]["orig_rms_dbfs"])

    rows = []
    for i in range(len(frames)):
        p = phi(window_at(x, i))
        rows.extend(int(v) for v in np.clip(np.round(p[LAG_MIN:LAG_MAX + 1] * 100), 0, 100))

    # Where the stored track leaves the look-back corridor first.
    exit_frame = next(i for i in range(1, len(frames))
                      if period[i] and period[i - 1] and abs(period[i] / period[i - 1] - 1) > ALPHA)

    p = phi(window_at(x, pick))
    scores = {P: psi(p, P) for P in range(LAG_MIN, LAG_MAX + 1)}
    best = max(scores, key=scores.get)
    found = {"frame": pick, "best": best, "psi_best": round(scores[best], 2),
             "psi_half": round(scores[best // 2], 2), "share": round(100 * scores[best // 2] / scores[best]),
             "exit": exit_frame, "exit_from": round(period[exit_frame - 1], 1), "exit_to": round(period[exit_frame], 1)}
    if found != EXPECT:
        raise SystemExit(f"correlogram: the numbers moved: {found}, the figure states {EXPECT}")

    return {
        "schema": "how-ambe-works/correlogram/1",
        "provenance": ("derived-input: computed from the Piper TTS input clip, not from the AMBE-3000 "
                       "and not from its decoded audio. tracker_period is the site's own generic "
                       "pitch tracker (frames.json orig_f0_hz), not the codec's."),
        "clip": CLIP,
        "sample_rate_hz": SR,
        "window": {
            "frame": pick,
            "start": pick * FRAME + FRAME // 2 - N // 2,
            "length": N,
            "taper": "Hamming, applied in the browser (a display choice)",
            "samples": [int(v) for v in window_at(x, pick)],
        },
        "lag_min": LAG_MIN,
        "lag_max": LAG_MAX,
        "frames": len(frames),
        "units": "percent of phi(0), negative values stored as 0",
        "rows": rows,
        "tracker_period": period,
        "corridor": ALPHA,
        "corridor_exit": exit_frame,
    }


def main(out_dir: str) -> None:
    # out_dir is docs/assets/data; the WAVs are in docs/assets/audio.
    doc = build(out_dir, os.path.join(os.path.dirname(os.path.normpath(out_dir)), "audio"))
    path = os.path.join(out_dir, CLIP, OUT)
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")
    print(f"  wrote {CLIP}/{OUT} ({os.path.getsize(path) / 1024:.1f} kB)")


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    main(os.path.join(root, "docs", "assets", "data"))
    sys.exit(0)
