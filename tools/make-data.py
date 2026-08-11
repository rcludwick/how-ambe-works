#!/usr/bin/env python3
"""make-data.py — build the precomputed JSON the site's animations draw.

Reads the hardware capture produced by tools/capture-hardware.sh and emits
docs/assets/data/{clips,frames,waveform,spectra}.json.

Two kinds of number live in those files and they are never mixed:

  MEASURED  — bytes that came off the DVSI AMBE-3000 chip. That is the
              72-bit channel frame, and nothing else. The AMBE-3000 packet
              interface carries speech in and channel bits out; it has no
              packet that reports the codec's internal parameters, so this
              script cannot and does not report them.

  DERIVED   — ordinary DSP measurements this script computes from the two
              audio files (frame RMS, tracked autocorrelation pitch, FFT
              magnitude, band-limited voicing strength). These are properties
              of the *audio*, not fields read out of the codec.

Nothing here implements AMBE. The pitch estimator and FFT below are
generic, textbook DSP applied to ordinary PCM; they would work identically
on a recording of a bird.

Every clip gets its own <clip-id>/ subdirectory; the featured clip is also
written at the top level, which is what the animations load by default.

Usage: tools/make-data.py [featured-clip-id]      (default: norman-b)
"""

import json
import math
import os
import sys
import wave
from datetime import datetime, timezone

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(REPO, "docs", "assets", "audio")
DATA = os.path.join(REPO, "docs", "assets", "data")
FRAMES = os.path.join(DATA, "frames")

SR = 8000  # Hz — AMBE's native sample rate
FRAME_SAMPLES = 160  # 20 ms
FRAME_BYTES = 9  # 72 bits per D-STAR voice frame
BUCKETS_PER_FRAME = 8  # waveform.json min/max resolution: 2.5 ms
FFT_N = 256  # 32 ms analysis window -> 128 usable bins, 31.25 Hz each
SPEC_BINS = 128
SPEC_FLOOR_DB = -100.0
PITCH_WIN = 512  # 64 ms — long enough for a 50 Hz fundamental
F0_MIN, F0_MAX = 50.0, 400.0
VOICED_CONF = 0.35  # normalised-autocorrelation threshold (chosen by eye)
BANDS = 8  # voicing-analysis bands across 0-4 kHz, 500 Hz each
BAND_VOICED_THRESH = 0.55  # band-limited autocorrelation above this reads as voiced

# Hardware identification, as reported by `thumbdv-rig probe` on the device
# that produced these captures. Update if you recapture on another stick.
HARDWARE = {
    "device": "NW Digital Radio ThumbDV",
    "chip": "DVSI AMBE-3000",
    "product_id": "AMBE3000F",
    "version_string": "V121.E100.XXXX.C110.G514.R014.A0030608.C0020208",
    "interface": "USB serial, 460800 baud, DVSI AMBE-3000 packet protocol",
    "mode": "D-STAR full rate: 2400 bit/s voice + 1200 bit/s FEC = 72 bits per 20 ms frame",
}

CLIP_META = {
    "norman-a": ("norman", "The quick brown fox jumps over the lazy dog."),
    "norman-b": ("norman", "CQ CQ CQ this is a test of the AMBE voice codec."),
    "norman-c": ("norman", "She sells sea shells by the sea shore."),
    "norman-d": ("norman", "We were away a year ago."),
    "lj-a": ("lj", "The quick brown fox jumps over the lazy dog."),
    "lj-b": ("lj", "CQ CQ CQ this is a test of the AMBE voice codec."),
    "lj-c": ("lj", "She sells sea shells by the sea shore."),
    "lj-d": ("lj", "We were away a year ago."),
}

VOICES = {
    "norman": {
        "id": "norman",
        "sex": "male",
        "model": "Piper en_US-norman-medium",
        "dataset": "LibriVox recordings (https://librivox.org)",
        "dataset_license": "public domain",
    },
    "lj": {
        "id": "lj",
        "sex": "female",
        "model": "Piper en_US-ljspeech-high",
        "dataset": "LJ Speech (https://keithito.com/LJ-Speech-Dataset/)",
        "dataset_license": "public domain",
    },
}


def die(msg):
    sys.stderr.write("make-data.py: FATAL: %s\n" % msg)
    sys.exit(1)


def read_wav(path):
    if not os.path.exists(path):
        die("missing %s — run tools/make-audio.sh and tools/capture-hardware.sh first" % path)
    w = wave.open(path, "rb")
    if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (SR, 1, 2):
        die("%s is not 8 kHz mono 16-bit" % path)
    n = w.getnframes()
    raw = w.readframes(n)
    w.close()
    x = np.frombuffer(raw, dtype="<i2").astype(np.float64)
    if n == 0 or not np.any(x):
        die("%s is empty or silent" % path)
    return x


def read_ambe(path):
    if not os.path.exists(path):
        die("missing %s — run tools/capture-hardware.sh" % path)
    with open(path, "rb") as f:
        b = f.read()
    if len(b) == 0 or len(b) % FRAME_BYTES:
        die("%s is %d bytes, not a whole number of %d-byte frames" % (path, len(b), FRAME_BYTES))
    return [b[i:i + FRAME_BYTES] for i in range(0, len(b), FRAME_BYTES)]


def db(x, floor=SPEC_FLOOR_DB):
    """Linear amplitude (full scale = 32768) to dBFS."""
    if x <= 0:
        return floor
    v = 20.0 * math.log10(x / 32768.0)
    return floor if v < floor else v


def frame_slice(x, centre, length):
    """Length samples centred on `centre`, zero-padded at the edges."""
    out = np.zeros(length)
    start = centre - length // 2
    lo = max(0, start)
    hi = min(len(x), start + length)
    if hi > lo:
        out[lo - start:hi - start] = x[lo:hi]
    return out


LAG_MIN = int(SR / F0_MAX)   # 20 samples -> 400 Hz
LAG_MAX = int(SR / F0_MIN)   # 160 samples -> 50 Hz
TRANS_W = 0.55               # cost per octave of frame-to-frame pitch jump
UV_SWITCH = 0.20             # cost of entering or leaving the unvoiced state


def nc_curve(seg):
    """Normalised short-time autocorrelation over the plausible pitch lags.

    Centre-clipped, which is the standard trick for stopping a strong first
    formant from producing a half-period peak. Returns an array indexed by
    (lag - LAG_MIN).
    """
    seg = seg - seg.mean()
    if math.sqrt(float((seg * seg).mean())) < 1.0:
        return None
    clip = 0.30 * float(np.abs(seg).max())
    y = np.where(np.abs(seg) > clip, seg - np.sign(seg) * clip, 0.0)
    if not np.any(y):
        return None
    lag_max = min(LAG_MAX, len(y) - 1)
    nc = np.zeros(LAG_MAX - LAG_MIN + 1)
    for L in range(LAG_MIN, lag_max + 1):
        a, b = y[:len(y) - L], y[L:]
        den = math.sqrt(float((a * a).sum()) * float((b * b).sum()))
        nc[L - LAG_MIN] = float((a * b).sum()) / den if den > 0 else 0.0
    return nc


def _candidates(nc, limit=8):
    """Local maxima of the autocorrelation, strongest first."""
    if nc is None:
        return []
    peaks = [i for i in range(1, len(nc) - 1)
             if nc[i] >= nc[i - 1] and nc[i] >= nc[i + 1] and nc[i] > 0.25]
    peaks.sort(key=lambda i: -nc[i])
    return peaks[:limit]


def _refine(nc, idx):
    """Parabolic interpolation around a peak, in lag samples."""
    lag = float(LAG_MIN + idx)
    if 0 < idx < len(nc) - 1:
        y0, y1, y2 = nc[idx - 1], nc[idx], nc[idx + 1]
        den = y0 - 2 * y1 + y2
        if den != 0:
            lag += max(-0.5, min(0.5, 0.5 * (y0 - y2) / den))
    return lag


def track_pitch(curves):
    """Viterbi pitch track over a whole clip. Returns [(f0_hz, confidence)].

    Per-frame autocorrelation alone flips octaves at random on a voice whose
    first formant is strong; a tracker that charges for frame-to-frame jumps
    picks the continuous path instead. Standard DP pitch tracking, applied
    to ordinary PCM.
    """
    n = len(curves)
    states = []      # per frame: list of candidate lag-indices; -1 = unvoiced
    costs = []
    for nc in curves:
        cands = _candidates(nc)
        st = cands + [-1]
        cost = [1.0 - float(nc[i]) for i in cands] + [1.0 - VOICED_CONF]
        states.append(st)
        costs.append(cost)

    best = [list(costs[0])]
    back = [[-1] * len(states[0])]
    for t in range(1, n):
        row, brow = [], []
        for j, sj in enumerate(states[t]):
            bi, bc = 0, float("inf")
            for i, si in enumerate(states[t - 1]):
                if si == -1 and sj == -1:
                    trans = 0.0
                elif si == -1 or sj == -1:
                    trans = UV_SWITCH
                else:
                    trans = TRANS_W * abs(math.log2((LAG_MIN + sj) / (LAG_MIN + si)))
                c = best[t - 1][i] + trans
                if c < bc:
                    bi, bc = i, c
            row.append(bc + costs[t][j])
            brow.append(bi)
        best.append(row)
        back.append(brow)

    path = [0] * n
    path[n - 1] = int(np.argmin(best[n - 1]))
    for t in range(n - 1, 0, -1):
        path[t - 1] = back[t][path[t]]

    out = []
    for t in range(n):
        s = states[t][path[t]]
        if s == -1 or curves[t] is None:
            out.append((0.0, 0.0))
        else:
            lag = _refine(curves[t], s)
            conf = float(max(0.0, min(1.0, curves[t][s])))
            out.append((SR / lag if lag > 0 else 0.0, conf))
    return out


def band_voicing(seg, f0_hz):
    """Per-band voicing strength 0..1 by band-limited autocorrelation.

    Split the window into BANDS equal bands with an FFT band-pass, then in
    each band measure the normalised autocorrelation at the pitch period.
    A band carrying harmonics of the fundamental repeats strongly at that
    lag (-> near 1); a band carrying noise does not (-> near 0). This is the
    classic band-pass voicing-strength measure and is applied here to
    ordinary PCM; it is NOT the codec's voicing decision, which is not
    observable from outside the chip.
    """
    if f0_hz <= 0:
        return [0.0] * BANDS
    lag = int(round(SR / f0_hz))
    n = len(seg)
    if lag <= 0 or lag >= n // 2:
        return [0.0] * BANDS
    spec = np.fft.rfft(seg * np.hanning(n))
    per_band = (len(spec) - 1) / BANDS
    out = []
    for b in range(BANDS):
        masked = np.zeros_like(spec)
        lo = int(round(b * per_band))
        hi = int(round((b + 1) * per_band))
        masked[lo:hi] = spec[lo:hi]
        y = np.fft.irfft(masked, n)
        x1, x2 = y[:n - lag], y[lag:]
        den = math.sqrt(float((x1 * x1).sum()) * float((x2 * x2).sum()))
        if den <= 0:
            out.append(0.0)
            continue
        out.append(round(max(0.0, min(1.0, float((x1 * x2).sum()) / den)), 4))
    return out


def spectrum_db(seg):
    """128-bin Hann-windowed magnitude spectrum in dBFS (bin 0 = DC)."""
    w = np.hanning(len(seg))
    mag = np.abs(np.fft.rfft(seg * w, FFT_N))
    # Compensate the Hann window's coherent gain so a full-scale sine reads 0 dBFS.
    scale = 2.0 / (np.sum(w) if np.sum(w) > 0 else 1.0)
    mag = mag * scale
    return [db(float(m)) for m in mag[:SPEC_BINS]]


def envelope_delay(a, b):
    """End-to-end delay of `b` relative to `a`, in samples, by 20 ms RMS
    envelope cross-correlation. Returns (delay_samples, correlation)."""
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    win = np.ones(FRAME_SAMPLES) / FRAME_SAMPLES
    ea = np.sqrt(np.convolve(a * a, win, "same"))
    eb = np.sqrt(np.convolve(b * b, win, "same"))
    ea = ea - ea.mean()
    eb = eb - eb.mean()
    best = (0, -1.0)
    for lag in range(0, 4 * FRAME_SAMPLES):
        x, y = ea[:n - lag], eb[lag:]
        d = math.sqrt(float((x * x).sum()) * float((y * y).sum())) + 1e-9
        c = float((x * y).sum()) / d
        if c > best[1]:
            best = (lag, c)
    return best[0], round(best[1], 4)


def minmax_buckets(x, n_buckets, samples_per_bucket):
    lo, hi = [], []
    for i in range(n_buckets):
        seg = x[i * samples_per_bucket:(i + 1) * samples_per_bucket]
        if len(seg) == 0:
            lo.append(0)
            hi.append(0)
        else:
            lo.append(int(seg.min()))
            hi.append(int(seg.max()))
    return lo, hi


def frame_rms_db(x, i, offset=0):
    """RMS of frame i (optionally shifted by `offset` samples), in dBFS."""
    start = i * FRAME_SAMPLES + offset
    seg = x[max(0, start):max(0, start) + FRAME_SAMPLES]
    if len(seg) == 0:
        return SPEC_FLOOR_DB
    return round(db(float(math.sqrt(float((seg * seg).mean())))), 2)


def build(clip_id):
    if clip_id not in CLIP_META:
        die("unknown clip id %r (known: %s)" % (clip_id, ", ".join(sorted(CLIP_META))))
    voice_id, text = CLIP_META[clip_id]

    orig = read_wav(os.path.join(AUDIO, "%s-original.wav" % clip_id))
    dec = read_wav(os.path.join(AUDIO, "%s-ambe.wav" % clip_id))
    frames = read_ambe(os.path.join(FRAMES, "%s.ambe" % clip_id))

    n_frames = len(frames)
    expected = math.ceil(len(orig) / FRAME_SAMPLES)
    if n_frames != expected:
        die("%s: %d channel frames but %d frames of audio" % (clip_id, n_frames, expected))

    delay, delay_corr = envelope_delay(orig, dec)

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    clip_block = {
        "id": clip_id,
        "voice": VOICES[voice_id],
        "text": text,
        "original_audio": "assets/audio/%s-original.wav" % clip_id,
        "decoded_audio": "assets/audio/%s-ambe.wav" % clip_id,
        "channel_frames": "assets/data/frames/%s.ambe" % clip_id,
        "sample_rate_hz": SR,
        "duration_s": round(len(orig) / SR, 4),
        "frame_count": n_frames,
        "frame_ms": 20,
        "frame_samples": FRAME_SAMPLES,
        "decoded_delay_samples": delay,
        "decoded_delay_ms": round(delay / SR * 1000.0, 2),
        "decoded_delay_correlation": delay_corr,
    }

    # ---------------- frames.json ----------------
    centres = [i * FRAME_SAMPLES + FRAME_SAMPLES // 2 for i in range(n_frames)]
    o_segs = [frame_slice(orig, c, PITCH_WIN) for c in centres]
    d_segs = [frame_slice(dec, c + delay, PITCH_WIN) for c in centres]
    o_pitch = track_pitch([nc_curve(s) for s in o_segs])
    d_pitch = track_pitch([nc_curve(s) for s in d_segs])

    frame_rows = []
    for i, fb in enumerate(frames):
        d_seg = d_segs[i]
        f0o, co = o_pitch[i]
        f0d, cd = d_pitch[i]
        bv = band_voicing(d_seg, f0d if cd >= VOICED_CONF else 0.0)
        frame_rows.append({
            "i": i,
            "t": round(i * 0.02, 3),
            "hex": fb.hex(),
            "derived": {
                "orig_rms_dbfs": frame_rms_db(orig, i),
                "decoded_rms_dbfs": frame_rms_db(dec, i, delay),
                "orig_f0_hz": round(f0o, 1),
                "orig_f0_confidence": round(co, 3),
                "decoded_f0_hz": round(f0d, 1),
                "decoded_f0_confidence": round(cd, 3),
                "voiced": bool(cd >= VOICED_CONF),
                "band_voicing": bv,
                "band_voiced": [bool(v >= BAND_VOICED_THRESH) for v in bv],
            },
        })

    frames_doc = {
        "schema": "how-ambe-works/frames/1",
        "generated_utc": generated,
        "clip": clip_block,
        "hardware": HARDWARE,
        "measured": {
            "hex": "the 72 bits the AMBE-3000 emitted for this 20 ms of speech, "
                   "9 bytes, first byte first, MSB first within each byte",
        },
        "unavailable": (
            "The AMBE-3000 packet interface transports speech samples in one "
            "direction and channel bits in the other. It has no packet that "
            "reports the codec's internal parameters, so the fundamental-"
            "frequency index, the per-band voicing bits, the gain index and "
            "the spectral-amplitude indices cannot be observed from outside "
            "the chip and are deliberately absent from this file. The "
            "'derived' block below is DSP measured on the audio, not codec "
            "state read out of the device."
        ),
        "derived_notes": {
            "method": "generic short-time DSP on the two WAV files; see "
                      "SCHEMA.md for windows, thresholds and units",
            "bands": BANDS,
            "band_edges_hz": [[b * (SR // 2) // BANDS, (b + 1) * (SR // 2) // BANDS]
                              for b in range(BANDS)],
        },
        "frames": frame_rows,
    }

    # ---------------- waveform.json ----------------
    spb = FRAME_SAMPLES // BUCKETS_PER_FRAME  # 20 samples = 2.5 ms
    n_buckets = n_frames * BUCKETS_PER_FRAME
    o_lo, o_hi = minmax_buckets(orig, n_buckets, spb)
    # Align the decoded track to the original by the measured end-to-end delay
    # so a scrub cursor lands on the same phoneme in both.
    d_lo, d_hi = minmax_buckets(dec[delay:] if delay < len(dec) else dec, n_buckets, spb)

    waveform_doc = {
        "schema": "how-ambe-works/waveform/1",
        "generated_utc": generated,
        "clip": clip_block,
        "bucket_samples": spb,
        "bucket_ms": round(spb / SR * 1000.0, 4),
        "buckets_per_frame": BUCKETS_PER_FRAME,
        "bucket_count": n_buckets,
        "sample_full_scale": 32768,
        "decoded_alignment": (
            "decoded track shifted earlier by clip.decoded_delay_samples so "
            "bucket k of both tracks covers the same speech"
        ),
        "original": {"min": o_lo, "max": o_hi},
        "decoded": {"min": d_lo, "max": d_hi},
    }

    # ---------------- spectra.json ----------------
    o_spec, d_spec = [], []
    for i in range(n_frames):
        centre = i * FRAME_SAMPLES + FRAME_SAMPLES // 2
        o_spec.append([int(round(v)) for v in spectrum_db(frame_slice(orig, centre, FFT_N))])
        d_spec.append([int(round(v)) for v in spectrum_db(frame_slice(dec, centre + delay, FFT_N))])

    spectra_doc = {
        "schema": "how-ambe-works/spectra/1",
        "generated_utc": generated,
        "clip": clip_block,
        "bins": SPEC_BINS,
        "fft_size": FFT_N,
        "window": "Hann, %d samples (%.0f ms), centred on the frame" % (FFT_N, FFT_N / SR * 1000),
        "bin_hz": SR / FFT_N,
        "bin_centre_hz": [round(k * SR / FFT_N, 3) for k in range(SPEC_BINS)],
        "units": "dBFS, integer, floor %d" % int(SPEC_FLOOR_DB),
        "floor_db": int(SPEC_FLOOR_DB),
        "provenance": "computed by FFT of the audio files; not read from the codec",
        "original": o_spec,
        "decoded": d_spec,
    }

    return frames_doc, waveform_doc, spectra_doc, clip_block


def build_clips_index(featured):
    clips = []
    for cid in sorted(CLIP_META):
        voice_id, text = CLIP_META[cid]
        o = os.path.join(AUDIO, "%s-original.wav" % cid)
        d = os.path.join(AUDIO, "%s-ambe.wav" % cid)
        a = os.path.join(FRAMES, "%s.ambe" % cid)
        orig = read_wav(o)
        dec = read_wav(d)
        frames = read_ambe(a)
        delay, corr = envelope_delay(orig, dec)
        clips.append({
            "id": cid,
            "voice": VOICES[voice_id],
            "sentence": cid.split("-")[1],
            "text": text,
            "original_audio": "assets/audio/%s-original.wav" % cid,
            "decoded_audio": "assets/audio/%s-ambe.wav" % cid,
            "channel_frames": "assets/data/frames/%s.ambe" % cid,
            "duration_s": round(len(orig) / SR, 4),
            "frame_count": len(frames),
            "channel_bytes": len(frames) * FRAME_BYTES,
            "decoded_delay_samples": delay,
            "decoded_delay_ms": round(delay / SR * 1000.0, 2),
            "decoded_delay_correlation": corr,
        })
    return {
        "schema": "how-ambe-works/clips/1",
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hardware": HARDWARE,
        "sample_rate_hz": SR,
        "normalisation": (
            "every WAV scaled by a single constant gain to -20 dBFS RMS, "
            "backed off if needed to keep the peak at or below -1 dBFS; "
            "no compression, limiting or EQ"
        ),
        "featured_clip": featured,
        "clips": clips,
    }


def write_json(relpath, doc):
    path = os.path.join(DATA, relpath)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")
    size = os.path.getsize(path)
    if size > 1_100_000:
        die("%s is %.2f MB — over the 1 MB budget; decimate further" % (relpath, size / 1e6))
    print("  wrote %-28s %7.1f kB" % (relpath, size / 1024.0))


def main():
    featured = sys.argv[1] if len(sys.argv) > 1 else "norman-b"
    os.makedirs(DATA, exist_ok=True)
    print("Featured clip: %s" % featured)
    clip_block = None
    for cid in sorted(CLIP_META):
        frames_doc, waveform_doc, spectra_doc, block = build(cid)
        write_json(os.path.join(cid, "frames.json"), frames_doc)
        write_json(os.path.join(cid, "waveform.json"), waveform_doc)
        write_json(os.path.join(cid, "spectra.json"), spectra_doc)
        if cid == featured:
            clip_block = block
            # The featured clip is also published at the top level: that is
            # the path the animations load by default.
            write_json("frames.json", frames_doc)
            write_json("waveform.json", waveform_doc)
            write_json("spectra.json", spectra_doc)
    if clip_block is None:
        die("featured clip %r was not built" % featured)
    write_json("clips.json", build_clips_index(featured))
    print("Done: featured %s (%d frames, %.2f s, decoded delay %s samples)"
          % (featured, clip_block["frame_count"], clip_block["duration_s"],
             clip_block["decoded_delay_samples"]))


if __name__ == "__main__":
    main()
