#!/usr/bin/env bash
#
# make-audio.sh — generate the site's source speech clips.
#
# Synthesises four sentences in two Piper voices (one male, one female),
# resamples to the AMBE-native format (8 kHz, 16-bit, mono), and level-
# normalises them so that the original/decoded A/B pairs on the "Listen"
# page can be compared fairly.
#
# VOICE LICENSING. Everything in docs/assets/ ships under this repository's
# CC BY 4.0 grant, so a voice whose training corpus carries a non-commercial
# or share-alike condition cannot be used here. Two voices are cleared, and
# both were checked against their MODEL_CARD in rhasspy/piper-voices:
#
#   en_US-ljspeech-high      LJ Speech, public domain            female
#   en_US-libritts_r-medium  LibriTTS-R / OpenSLR 141, CC BY 4.0 male
#                            (speaker index 690 = LibriTTS speaker 240)
#
# LibriTTS-R requires attribution; see docs/assets/audio/MANIFEST.md, which
# also records the model checksums, the speaker choice and the exact
# synthesis parameters. Do NOT substitute a voice without reading its
# MODEL_CARD first: several popular Piper voices (ryan, hfc_female, lessac)
# are trained on CC BY-NC-SA or research-only corpora.
#
# Output: docs/assets/audio/<voice>-<sentence>-original.wav
#
# These are the *inputs* to the hardware capture. tools/capture-hardware.sh
# pushes them through a real DVSI AMBE-3000 (ThumbDV) to produce the
# "-ambe.wav" counterparts. Nothing in this repo implements AMBE.
#
# Requirements:
#   piper   (default: ~/.local/bin/piper; override with PIPER). It must
#           accept `--model M [-s N] --output_file -` and write a WAV to
#           stdout.
#   sox     (brew install sox)
#   python3 (only to read the voice's .onnx.json speaker table)
#   The two voice models above, alongside their .onnx.json, in VOICES_DIR.
#
# The script is deliberately loud on failure. It verifies the SHA-256 of
# every model file before synthesising, checks that the requested speaker
# index exists in the voice config, checks that piper actually returned a
# RIFF, and rejects any clip that is silent, clipped, mis-rated or
# implausibly short. Set ALLOW_MODEL_HASH_MISMATCH=1 only if you are
# deliberately moving to a new model revision, and update MANIFEST.md in
# the same commit.
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
command -v python3 >/dev/null || die "python3 not on PATH"
command -v shasum >/dev/null || die "shasum not on PATH"
[ -d "$VOICES_DIR" ] || die "voice directory not found: $VOICES_DIR (set VOICES_DIR=...)"

# voice id -> model, speaker index, label
VOICE_IDS=(lr lj)
VOICE_MODELS=(en_US-libritts_r-medium.onnx en_US-ljspeech-high.onnx)
VOICE_SPEAKERS=(690 "")   # empty = single-speaker model, no -s flag
VOICE_LABELS=("male (en_US-libritts_r-medium, speaker 690)" "female (en_US-ljspeech-high)")

# Expected SHA-256 of the rhasspy/piper-voices v1.0.0 files. Mirrored in
# docs/assets/audio/MANIFEST.md; change both together or not at all.
EXPECTED_SHA=(
  "en_US-libritts_r-medium.onnx      10bb85e071d616fcf4071f369f1799d0491492ab3c5d552ec19fb548fac13195"
  "en_US-libritts_r-medium.onnx.json b471dc60d2d8335e819c393d196d6fbf792817f40051257b269878505bc9afb3"
  "en_US-ljspeech-high.onnx          5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a"
  "en_US-ljspeech-high.onnx.json     7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14"
)

for row in "${EXPECTED_SHA[@]}"; do
  # shellcheck disable=SC2086
  set -- $row
  f="$VOICES_DIR/$1"; want="$2"
  [ -f "$f" ] || die "missing voice file $f
  fetch it with:
    curl -fLO --output-dir '$VOICES_DIR' \\
      https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/<voice>/<quality>/$1"
  got="$(shasum -a 256 "$f" | awk '{print $1}')"
  if [ "$got" != "$want" ]; then
    if [ "${ALLOW_MODEL_HASH_MISMATCH:-0}" = "1" ]; then
      echo "make-audio.sh: WARNING: $1 hash $got != $want (override in effect)" >&2
    else
      die "$1 SHA-256 mismatch
  expected $want
  got      $got
  This is not the model the manifest describes. Refusing to synthesise."
    fi
  fi
done
note "voice models verified against MANIFEST.md checksums"

# Speaker index must actually exist in the model config, and the config must
# agree that the model is multi-speaker.
speaker_name() { # <onnx.json> <index>  -> LibriTTS speaker name
  python3 - "$1" "$2" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
idx = int(sys.argv[2])
n = cfg.get("num_speakers", 1)
if idx >= n:
    sys.exit(f"speaker index {idx} out of range (model has {n} speakers)")
inv = {v: k for k, v in cfg.get("speaker_id_map", {}).items()}
print(inv.get(idx, ""))
PY
}

for vi in "${!VOICE_IDS[@]}"; do
  spk="${VOICE_SPEAKERS[$vi]}"
  [ -n "$spk" ] || continue
  cfg="$VOICES_DIR/${VOICE_MODELS[$vi]}.json"
  if ! name="$(speaker_name "$cfg" "$spk" 2>&1)"; then
    die "${VOICE_MODELS[$vi]}: $name"
  fi
  [ -n "$name" ] || die "${VOICE_MODELS[$vi]}: speaker index $spk has no name in speaker_id_map"
  note "${VOICE_IDS[$vi]}: piper speaker index $spk = corpus speaker $name"
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

written=0

for vi in "${!VOICE_IDS[@]}"; do
  vid="${VOICE_IDS[$vi]}"
  model="$VOICES_DIR/${VOICE_MODELS[$vi]}"
  spk="${VOICE_SPEAKERS[$vi]}"
  spk_args=()
  [ -n "$spk" ] && spk_args=(-s "$spk")

  for si in "${!SENT_IDS[@]}"; do
    sid="${SENT_IDS[$si]}"
    text="${SENT_TEXT[$si]}"
    out="$out_dir/${vid}-${sid}-original.wav"
    echo "[$vid-$sid] ${VOICE_LABELS[$vi]}: \"$text\""

    raw="$tmpdir/${vid}-${sid}-raw.wav"
    res="$tmpdir/${vid}-${sid}-8k.wav"

    # Piper renders at the model's native rate (22.05 kHz for both voices)
    # and writes WAV on stdout via the ~/.local/bin/piper wrapper.
    printf '%s\n' "$text" \
      | "$PIPER" --model "$model" "${spk_args[@]}" --output_file - \
        >"$raw" 2>"$tmpdir/piper.err" \
      || { sed 's/^/    piper: /' "$tmpdir/piper.err" >&2; die "piper failed for $vid-$sid"; }
    [ -s "$raw" ] || die "piper produced an empty file for $vid-$sid"
    # A wrapper that silently prints diagnostics instead of audio would
    # otherwise sail straight into sox and produce nonsense.
    [ "$(head -c 4 "$raw")" = "RIFF" ] \
      || die "piper output for $vid-$sid is not a RIFF/WAV stream"

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
    written=$((written + 1))
  done
done

expected=$(( ${#VOICE_IDS[@]} * ${#SENT_IDS[@]} ))
[ "$written" -eq "$expected" ] \
  || die "wrote $written clips, expected $expected"

# Nothing from a previous voice may survive in the output directory: a
# stale <voice>-<sentence>-original.wav would silently be captured and
# published under the wrong licence.
shopt -s nullglob
for f in "$out_dir"/*-original.wav; do
  base="$(basename "$f" -original.wav)"
  case "$base" in
    lr-[abcd]|lj-[abcd]) ;;
    *) die "unexpected clip $base in $out_dir — left over from an earlier voice set. Delete it (and its -ambe.wav) before publishing." ;;
  esac
done

echo
echo "Wrote $written original clips to $out_dir"
echo "Next: tools/capture-hardware.sh (pushes these through the ThumbDV)"
