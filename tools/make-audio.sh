#!/usr/bin/env bash
#
# make-audio.sh — generate the site's source speech clips.
#
# Synthesises four sentences in two Piper voices (one male, one female),
# resamples to the AMBE-native format (8 kHz, 16-bit, mono), and level-
# normalises them so that the original/decoded A/B pairs on the "Listen"
# page can be compared fairly.
#
# VOICE LICENSING: both voices are deliberately chosen for a public-domain
# training corpus and a from-scratch (not fine-tuned) training run, so the
# synthesised clips can be redistributed under this repository's CC BY 4.0
# grant without inheriting a non-commercial or share-alike condition.
#   en_US-norman-medium  LibriVox recordings, public domain, trained from
#                        scratch  (rhasspy/piper-voices .../norman/medium)
#   en_US-ljspeech-high  LJ Speech corpus, public domain, trained from
#                        scratch  (rhasspy/piper-voices .../ljspeech/high)
# Do NOT substitute a voice whose MODEL_CARD names a CC BY-NC-SA or
# research-only dataset; that would make docs/assets/audio/ unredistributable
# under the licence stated in README.md.
#
# Output: docs/assets/audio/<voice>-<sentence>-original.wav
#
# These are the *inputs* to the hardware capture. tools/capture-hardware.sh
# pushes them through a real DVSI AMBE-3000 (ThumbDV) to produce the
# "-ambe.wav" counterparts. Nothing in this repo implements AMBE.
#
# Requirements:
#   piper   (default: ~/.local/bin/piper; override with PIPER)
#   sox     (brew install sox)
#   Piper voice models en_US-norman-medium and en_US-ljspeech-high
#           (override the directory with VOICES_DIR)
#
# The script is deliberately loud on failure: every stage is checked, and
# a clip that is silent, clipped, mis-rated or implausibly short aborts the
# run rather than being written out.
#
# NOTE: Piper is not sample-deterministic across invocations. Re-running
# this script produces new masters, and every derived asset (hardware
# capture, JSON animation data) must be regenerated with it.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$repo_root/docs/assets/audio"

PIPER="${PIPER:-$HOME/.local/bin/piper}"
VOICES_DIR="${VOICES_DIR:-$HOME/.local/share/piper/voices}"

# --- level normalisation targets (see docs/assets/data/SCHEMA.md) ----------
# Every clip is scaled by a single constant gain so its RMS lands on
# TARGET_RMS_DB, unless that would push its peak above PEAK_CEIL_DB, in
# which case the peak ceiling wins. No compression, no limiting, no EQ.
TARGET_RMS_DB=-20.0
PEAK_CEIL_DB=-1.0

# --- sanity floors --------------------------------------------------------
MIN_SECONDS=1.0
MAX_SECONDS=12.0
MIN_RMS_DB=-45.0   # anything quieter than this is a failed synthesis

die() { echo "make-audio.sh: FATAL: $*" >&2; exit 1; }
note() { echo "  $*"; }

# --- preflight ------------------------------------------------------------
[ -x "$PIPER" ] || die "piper not executable at $PIPER (set PIPER=...)"
command -v sox >/dev/null || die "sox not on PATH (brew install sox)"
command -v soxi >/dev/null || die "soxi not on PATH (brew install sox)"
[ -d "$VOICES_DIR" ] || die "voice directory not found: $VOICES_DIR (set VOICES_DIR=...)"

# voice id -> model file
VOICE_IDS=(norman lj)
VOICE_MODELS=(en_US-norman-medium.onnx en_US-ljspeech-high.onnx)
VOICE_LABELS=("male (en_US-norman-medium)" "female (en_US-ljspeech-high)")

for m in "${VOICE_MODELS[@]}"; do
  [ -f "$VOICES_DIR/$m" ] || die "missing voice model $VOICES_DIR/$m"
done

# sentence id -> text
SENT_IDS=(a b c d)
SENT_TEXT=(
  "The quick brown fox jumps over the lazy dog."
  "CQ CQ CQ this is a test of the AMBE voice codec."
  "She sells sea shells by the sea shore."
  "We were away a year ago."
)

mkdir -p "$out_dir"

# --- helpers --------------------------------------------------------------

# stat_field <wav> <sox-stat-label>  -> linear amplitude value
stat_field() {
  sox "$1" -n stat 2>&1 | awk -F: -v k="$2" '$1 ~ k { gsub(/ /,"",$2); print $2; exit }'
}

# db_of <linear amplitude> -> dBFS (floor -120)
db_of() {
  awk -v a="$1" 'BEGIN { a = (a < 0 ? -a : a); if (a < 1e-6) print -120.0; else printf "%.3f", 20*log(a)/log(10) }'
}

# normalise <in.wav> <out.wav>
# Single constant gain: RMS to TARGET_RMS_DB, but never peak above PEAK_CEIL_DB.
normalise() {
  local src="$1" dst="$2"
  local rms peak rms_db peak_db gain
  rms="$(stat_field "$src" 'RMS +amplitude')"
  peak="$(stat_field "$src" 'Maximum amplitude')"
  [ -n "$rms" ] && [ -n "$peak" ] || die "sox stat gave no levels for $src"
  rms_db="$(db_of "$rms")"
  peak_db="$(db_of "$peak")"

  awk -v r="$rms_db" -v f="$MIN_RMS_DB" 'BEGIN { exit !(r < f) }' \
    && die "$(basename "$src") is effectively silent (RMS ${rms_db} dBFS)"

  gain="$(awk -v r="$rms_db" -v p="$peak_db" -v tr="$TARGET_RMS_DB" -v pc="$PEAK_CEIL_DB" \
    'BEGIN { g1 = tr - r; g2 = pc - p; printf "%.3f", (g1 < g2 ? g1 : g2) }')"

  sox "$src" "$dst" gain "$gain" \
    || die "sox gain failed for $src"
  note "levels: RMS ${rms_db} dBFS, peak ${peak_db} dBFS -> applied ${gain} dB"
}

# verify <wav>
verify() {
  local f="$1" rate chans bits secs rms peak
  rate="$(soxi -r "$f")"; chans="$(soxi -c "$f")"; bits="$(soxi -b "$f")"; secs="$(soxi -D "$f")"
  [ "$rate" = "8000" ] || die "$f: sample rate $rate, expected 8000"
  [ "$chans" = "1" ]   || die "$f: $chans channels, expected 1"
  [ "$bits" = "16" ]   || die "$f: $bits bits, expected 16"
  awk -v s="$secs" -v lo="$MIN_SECONDS" -v hi="$MAX_SECONDS" \
    'BEGIN { exit !(s < lo || s > hi) }' \
    && die "$f: duration ${secs}s outside [$MIN_SECONDS, $MAX_SECONDS]"
  rms="$(db_of "$(stat_field "$f" 'RMS +amplitude')")"
  peak="$(db_of "$(stat_field "$f" 'Maximum amplitude')")"
  awk -v p="$peak" 'BEGIN { exit !(p > -0.05) }' \
    && die "$f: peak ${peak} dBFS — clipped"
  note "verified: ${secs}s, RMS ${rms} dBFS, peak ${peak} dBFS"
}

# --- synthesis ------------------------------------------------------------
tmpdir="$(mktemp -d -t make-audio)"
trap 'rm -rf "$tmpdir"' EXIT

for vi in "${!VOICE_IDS[@]}"; do
  vid="${VOICE_IDS[$vi]}"
  model="$VOICES_DIR/${VOICE_MODELS[$vi]}"
  for si in "${!SENT_IDS[@]}"; do
    sid="${SENT_IDS[$si]}"
    text="${SENT_TEXT[$si]}"
    out="$out_dir/${vid}-${sid}-original.wav"
    echo "[$vid-$sid] ${VOICE_LABELS[$vi]}: \"$text\""

    raw="$tmpdir/${vid}-${sid}-raw.wav"
    res="$tmpdir/${vid}-${sid}-8k.wav"

    # Piper renders at the model's native rate (22.05 kHz for these voices)
    # and writes WAV on stdout via the ~/.local/bin/piper wrapper.
    printf '%s\n' "$text" | "$PIPER" --model "$model" --output_file - >"$raw" 2>"$tmpdir/piper.err" \
      || { sed 's/^/    piper: /' "$tmpdir/piper.err" >&2; die "piper failed for $vid-$sid"; }
    [ -s "$raw" ] || die "piper produced an empty file for $vid-$sid"

    # Down to the codec-native format. `gain -1` gives the resampler
    # headroom so its ringing cannot clip before normalisation.
    sox "$raw" -r 8000 -c 1 -b 16 "$res" gain -1 \
      || die "sox resample failed for $vid-$sid"

    # Trim leading/trailing silence so the clips start promptly, but keep
    # 80 ms of lead-in: the AMBE encoder needs a frame or two to settle.
    sox "$res" "$tmpdir/${vid}-${sid}-trim.wav" \
      silence 1 0.1 0.3% reverse silence 1 0.1 0.3% reverse pad 0.08 0.12 \
      || die "sox trim failed for $vid-$sid"

    normalise "$tmpdir/${vid}-${sid}-trim.wav" "$out"
    verify "$out"
  done
done

echo
echo "Wrote ${#VOICE_IDS[@]} x ${#SENT_IDS[@]} original clips to $out_dir"
echo "Next: tools/capture-hardware.sh (pushes these through the ThumbDV)"
