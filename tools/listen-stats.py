#!/usr/bin/env python3
"""listen-stats.py — recompute every `[measured]` number quoted in the prose.

`tools/make-data.py` writes the per-frame JSON the animations draw. It does
*not* compute the clip-level summary statistics that the chapters quote in
sentences ("97 % of its energetic frames...", "3.0 to 5.4 dB below the
original..."). This script does, and it reads only files that are committed to
the repository, so any reader can rerun it and check the prose:

    python3 tools/listen-stats.py            # human-readable report
    python3 tools/listen-stats.py --json     # same numbers as JSON

Nothing here implements AMBE. It is arithmetic over the JSON in
docs/assets/data/, which was itself derived from the two WAV files per clip.

--------------------------------------------------------------------------
DEFINITIONS — these are the whole point of the script, because a summary
statistic is only checkable if the reader knows which frames went into it.
--------------------------------------------------------------------------

energetic frame
    A frame whose *original*-audio RMS is at least ENERGETIC_DBFS
    (-40 dBFS). Every WAV in this set is normalised to -20 dBFS RMS overall,
    so this admits frames down to 20 dB below the clip's average level and
    excludes the silence, the lead-in and the trailing pad. The threshold is
    a chosen convention, not a property of the codec.

detectable fundamental
    `derived.orig_f0_hz > 0` — the pitch tracker in make-data.py returned a
    pitch for that frame of the *original* audio. Its method (and its
    confidence threshold, 0.35) is documented in docs/assets/data/SCHEMA.md.

band level, and the delta between the two tracks
    A band's level over a set of frames is the sum of linear power across
    every FFT bin whose centre frequency falls in [lo, hi) and across every
    frame in the set, expressed in dB. The delta is
    10*log10(decoded_power / original_power).

    This is an ENERGY SUM, deliberately. Averaging per-frame dB values
    instead weights a -95 dBFS silent frame as heavily as a -25 dBFS vowel
    and can report a large "loss" in a band that in fact carries more total
    energy after the round trip. Both figures are printed below so the
    difference is visible, but the prose quotes the energy sum.

pitch error
    Over frames where BOTH tracks returned a pitch,
    100 * |decoded_f0 - orig_f0| / orig_f0. Median and 90th percentile.

envelope correlation, delay
    Not recomputed here: make-data.py measures them by cross-correlating the
    20 ms RMS envelopes of the two WAVs, and stores the result per clip in
    clips.json. This script only reports the range across the eight clips.
"""

import json
import math
import os
import sys

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "docs",
    "assets",
    "data",
)

ENERGETIC_DBFS = -40.0
KHZ_BANDS = [(0, 1000), (1000, 2000), (2000, 3000), (3000, 4000)]


def load(*parts):
    with open(os.path.join(DATA, *parts), "r") as f:
        return json.load(f)


def median(xs):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    n = len(xs)
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


def percentile(xs, p):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    k = (len(xs) - 1) * p / 100.0
    lo, hi = math.floor(k), math.ceil(k)
    return xs[int(k)] if lo == hi else xs[lo] * (hi - k) + xs[hi] * (k - lo)


def db_to_power(db):
    return 10.0 ** (db / 10.0)


def band_deltas(spectra, rows, bands=KHZ_BANDS):
    """Energy-summed and mean-of-dB deltas (decoded - original) per band."""
    centres = spectra["bin_centre_hz"]
    orig, dec = spectra["original"], spectra["decoded"]
    out = []
    for lo, hi in bands:
        idx = [k for k, c in enumerate(centres) if lo <= c < hi]
        po = sum(db_to_power(orig[r][k]) for r in rows for k in idx)
        pd = sum(db_to_power(dec[r][k]) for r in rows for k in idx)
        energy = 10.0 * math.log10(pd / po) if po > 0 and pd > 0 else float("nan")

        per_frame = []
        for r in rows:
            a = sum(db_to_power(orig[r][k]) for k in idx)
            b = sum(db_to_power(dec[r][k]) for k in idx)
            if a > 0 and b > 0:
                per_frame.append(10.0 * math.log10(b / a))
        mean_db = sum(per_frame) / len(per_frame) if per_frame else float("nan")
        out.append({"lo": lo, "hi": hi, "energy_db": energy, "mean_of_db": mean_db})
    return out


def clip_stats(clip_id):
    fr = load(clip_id, "frames.json")
    sp = load(clip_id, "spectra.json")
    frames = fr["frames"]
    d = [f["derived"] for f in frames]

    energetic = [i for i, x in enumerate(d) if x["orig_rms_dbfs"] >= ENERGETIC_DBFS]
    pitched = [i for i in energetic if d[i]["orig_f0_hz"] > 0]
    unpitched_energetic = [i for i in energetic if d[i]["orig_f0_hz"] <= 0]

    both = [
        i
        for i in range(len(d))
        if d[i]["orig_f0_hz"] > 0 and d[i]["decoded_f0_hz"] > 0
    ]
    err = [
        100.0 * abs(d[i]["decoded_f0_hz"] - d[i]["orig_f0_hz"]) / d[i]["orig_f0_hz"]
        for i in both
    ]

    f0s = [d[i]["orig_f0_hz"] for i in range(len(d)) if d[i]["orig_f0_hz"] > 0]

    # Band voicing of the DECODED audio, split by whether the ORIGINAL frame
    # had a fundamental. "Sibilant" frames are energetic frames with none.
    def band_mean(rows):
        if not rows:
            return None
        nb = len(d[rows[0]]["band_voicing"])
        return [sum(d[i]["band_voicing"][b] for i in rows) / len(rows) for b in range(nb)]

    return {
        "id": clip_id,
        "duration_s": fr["clip"]["duration_s"],
        "frame_count": fr["clip"]["frame_count"],
        "channel_bytes": fr["clip"]["frame_count"] * 9,
        "delay_ms": fr["clip"]["decoded_delay_ms"],
        "delay_correlation": fr["clip"]["decoded_delay_correlation"],
        "energetic_frames": len(energetic),
        "energetic_pitched": len(pitched),
        "pct_energetic_pitched": 100.0 * len(pitched) / len(energetic) if energetic else float("nan"),
        "energetic_unpitched": len(unpitched_energetic),
        "median_f0_hz": median(f0s),
        "pitch_err_median_pct": median(err),
        "pitch_err_p90_pct": percentile(err, 90),
        "bands_all": band_deltas(sp, energetic),
        "bands_unpitched": band_deltas(sp, unpitched_energetic),
        "band_voicing_pitched": band_mean(pitched),
        "band_voicing_unpitched": band_mean(unpitched_energetic),
    }


def main():
    clips = load("clips.json")
    ids = [c["id"] for c in clips["clips"]]
    stats = [clip_stats(i) for i in ids]

    total_bytes = sum(s["channel_bytes"] for s in stats)
    total_secs = sum(s["duration_s"] for s in stats)
    summary = {
        "definitions": {
            "energetic_frame_dbfs": ENERGETIC_DBFS,
            "detectable_fundamental": "derived.orig_f0_hz > 0",
            "band_delta": "energy sum over bins and frames, 10*log10(decoded/original)",
        },
        "totals": {
            "channel_bytes": total_bytes,
            "duration_s": round(total_secs, 2),
            "bitrate_bps": round(total_bytes * 8 / total_secs, 1),
        },
        "ranges": {
            "delay_ms": [min(s["delay_ms"] for s in stats), max(s["delay_ms"] for s in stats)],
            "delay_correlation": [
                min(s["delay_correlation"] for s in stats),
                max(s["delay_correlation"] for s in stats),
            ],
            "pitch_err_median_pct": [
                min(s["pitch_err_median_pct"] for s in stats),
                max(s["pitch_err_median_pct"] for s in stats),
            ],
            "pitch_err_p90_pct": [
                min(s["pitch_err_p90_pct"] for s in stats),
                max(s["pitch_err_p90_pct"] for s in stats),
            ],
        },
        "clips": stats,
    }

    if "--json" in sys.argv:
        json.dump(summary, sys.stdout, indent=1)
        print()
        return

    print("Definitions: energetic frame = original RMS >= %.0f dBFS; "
          "band delta = energy sum, dB." % ENERGETIC_DBFS)
    print()
    print("Totals: %d channel bytes over %.2f s = %.1f bit/s"
          % (total_bytes, total_secs, total_bytes * 8 / total_secs))
    r = summary["ranges"]
    print("Delay        %.2f - %.2f ms" % tuple(r["delay_ms"]))
    print("Env. corr.   %.4f - %.4f" % tuple(r["delay_correlation"]))
    print("Pitch err    median %.2f - %.2f %%, p90 %.2f - %.2f %%"
          % (r["pitch_err_median_pct"][0], r["pitch_err_median_pct"][1],
             r["pitch_err_p90_pct"][0], r["pitch_err_p90_pct"][1]))
    print()
    hdr = ("clip", "s", "frames", "bytes", "f0", "err%", "energ", "pitched", "%")
    print("%-10s %6s %7s %7s %7s %6s %6s %8s %6s" % hdr)
    for s in stats:
        print("%-10s %6.2f %7d %7d %7.1f %6.2f %6d %8d %6.1f"
              % (s["id"], s["duration_s"], s["frame_count"], s["channel_bytes"],
                 s["median_f0_hz"], s["pitch_err_median_pct"],
                 s["energetic_frames"], s["energetic_pitched"],
                 s["pct_energetic_pitched"]))
    print()
    for s in stats:
        print("%s  band deltas dB (energy sum | mean-of-dB), energetic frames:" % s["id"])
        print("   " + "  ".join(
            "%d-%dk %+.2f|%+.2f" % (b["lo"] // 1000, b["hi"] // 1000,
                                    b["energy_db"], b["mean_of_db"])
            for b in s["bands_all"]))
        if s["energetic_unpitched"]:
            print("   no-pitch frames (%d): " % s["energetic_unpitched"] + "  ".join(
                "%d-%dk %+.2f|%+.2f" % (b["lo"] // 1000, b["hi"] // 1000,
                                        b["energy_db"], b["mean_of_db"])
                for b in s["bands_unpitched"]))
        bp, bu = s["band_voicing_pitched"], s["band_voicing_unpitched"]
        if bp:
            print("   decoded band voicing, pitched frames:   "
                  + " ".join("%.2f" % v for v in bp))
        if bu:
            print("   decoded band voicing, no-pitch frames:  "
                  + " ".join("%.2f" % v for v in bu))
        print()


if __name__ == "__main__":
    main()
