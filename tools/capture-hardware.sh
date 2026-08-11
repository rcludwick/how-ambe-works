#!/usr/bin/env bash
#
# capture-hardware.sh — push the source clips through a real DVSI AMBE-3000.
#
# For each docs/assets/audio/<id>-original.wav this:
#   1. encodes it on the hardware  -> <id>.ambe   (72-bit D-STAR frames,
#      concatenated 9-byte frames, exactly as the chip emits them)
#   2. decodes those frames on the same hardware -> <id>-ambe.wav
#   3. level-normalises the decoded audio the same way the originals were
#      normalised, so the A/B pair on the Listen page is a fair comparison
#      of *timbre*, not of loudness.
#
# Everything here is a hardware measurement. This repository contains no
# AMBE encoder or decoder; the codec runs entirely on the DVSI chip.
#
# The driver is `thumbdv-rig`, a tool from the author's separate private
# codec project. It is NOT part of this repository and is not redistributed
# here; point RIG at your own build, or at any tool that speaks the DVSI
# AMBE-3000 packet protocol. Encoding is lock-step and real-time-ish
# (~16 ms per 20 ms frame), so a 3 s clip takes a few seconds each way.
#
# Env:
#   RIG   path to the thumbdv-rig binary (default: whatever is on PATH)
#   PORT  serial device of the ThumbDV. Default: the first /dev/cu.usbserial-*
#         on macOS, else /dev/ttyUSB0. Set PORT explicitly if more than one
#         USB serial adapter is attached.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
audio_dir="$repo_root/docs/assets/audio"
frames_dir="$repo_root/docs/assets/data/frames"

RIG="${RIG:-$(command -v thumbdv-rig || true)}"
# Resolve a default port rather than hard-coding one device's serial number.
default_port() {
  local p
  for p in /dev/cu.usbserial-* /dev/ttyUSB*; do
    [ -e "$p" ] && { echo "$p"; return; }
  done
  echo /dev/ttyUSB0
}
PORT="${PORT:-$(default_port)}"

TARGET_RMS_DB=-20.0
PEAK_CEIL_DB=-1.0
MIN_RMS_DB=-45.0

die() { echo "capture-hardware.sh: FATAL: $*" >&2; exit 1; }

[ -n "$RIG" ] && [ -x "$RIG" ] \
  || die "no thumbdv-rig binary (set RIG=/path/to/thumbdv-rig, or put it on PATH)"
[ -e "$PORT" ] || die "no ThumbDV at $PORT (set PORT=...)"
command -v sox >/dev/null || die "sox not on PATH"
command -v soxi >/dev/null || die "soxi not on PATH"

stat_field() {
  sox "$1" -n stat 2>&1 | awk -F: -v k="$2" '$1 ~ k { gsub(/ /,"",$2); print $2; exit }'
}
db_of() {
  awk -v a="$1" 'BEGIN { a = (a < 0 ? -a : a); if (a < 1e-6) print -120.0; else printf "%.3f", 20*log(a)/log(10) }'
}
normalise() {
  local src="$1" dst="$2" rms peak rms_db peak_db gain
  rms="$(stat_field "$src" 'RMS +amplitude')"
  peak="$(stat_field "$src" 'Maximum amplitude')"
  [ -n "$rms" ] && [ -n "$peak" ] || die "sox stat gave no levels for $src"
  rms_db="$(db_of "$rms")"; peak_db="$(db_of "$peak")"
  awk -v r="$rms_db" -v f="$MIN_RMS_DB" 'BEGIN { exit !(r < f) }' \
    && die "$(basename "$src"): decoded audio is silent (RMS ${rms_db} dBFS) — capture failed"
  gain="$(awk -v r="$rms_db" -v p="$peak_db" -v tr="$TARGET_RMS_DB" -v pc="$PEAK_CEIL_DB" \
    'BEGIN { g1 = tr - r; g2 = pc - p; printf "%.3f", (g1 < g2 ? g1 : g2) }')"
  sox "$src" "$dst" gain "$gain" || die "sox gain failed for $src"
  echo "    raw decode: RMS ${rms_db} dBFS, peak ${peak_db} dBFS -> applied ${gain} dB"
}

mkdir -p "$frames_dir"

echo "Device probe:"
"$RIG" probe --port "$PORT" 2>&1 | sed 's/^/    /' || die "probe failed — is the ThumbDV plugged in and free?"
echo

shopt -s nullglob
originals=("$audio_dir"/*-original.wav)
[ "${#originals[@]}" -gt 0 ] || die "no *-original.wav in $audio_dir — run tools/make-audio.sh first"

for orig in "${originals[@]}"; do
  base="$(basename "$orig" -original.wav)"
  ambe="$frames_dir/$base.ambe"
  raw_dec="$frames_dir/$base-decoded-raw.wav"
  out="$audio_dir/$base-ambe.wav"

  in_secs="$(soxi -D "$orig")"
  echo "[$base] encoding ${in_secs}s on hardware..."
  "$RIG" enc "$orig" "$ambe" --port "$PORT" >/dev/null 2>&1 || die "hardware encode failed for $base"
  bytes="$(wc -c <"$ambe" | tr -d ' ')"
  [ "$bytes" -gt 0 ] || die "$base: encoder produced no frames"
  [ $((bytes % 9)) -eq 0 ] || die "$base: $bytes bytes is not a whole number of 9-byte frames"
  echo "    $((bytes / 9)) frames ($bytes bytes)"

  echo "[$base] decoding on hardware..."
  "$RIG" dec "$ambe" "$raw_dec" --port "$PORT" >/dev/null 2>&1 || die "hardware decode failed for $base"

  # The decode must line up sample-for-sample with the (frame-padded) input.
  dec_secs="$(soxi -D "$raw_dec")"
  awk -v a="$in_secs" -v b="$dec_secs" 'BEGIN { d = a - b; if (d < 0) d = -d; exit !(d > 0.03) }' \
    && die "$base: decoded length ${dec_secs}s does not match input ${in_secs}s"

  normalise "$raw_dec" "$out"
  rm -f "$raw_dec"
  echo "    -> $(basename "$out")"
done

echo
echo "Hardware capture complete. Frames in $frames_dir, audio in $audio_dir"
