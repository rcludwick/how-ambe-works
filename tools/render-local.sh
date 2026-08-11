#!/usr/bin/env bash
# Render the manim scenes locally, for iterating on them without waiting on CI.
#
# CI renders every scene at --quality m and takes about half an hour for the
# pipeline scene alone. That is not a loop you can think in. This script
# defaults to LOW quality (480p15), which turns the same scene around in well
# under a minute, and only asks for higher quality when you say so.
#
#   tools/render-local.sh                    # every scene, low quality
#   tools/render-local.sh pipeline           # one scene
#   tools/render-local.sh -q h pipeline      # 1080p60, when you are checking type
#   tools/render-local.sh -o pipeline        # render, then open it
#   tools/render-local.sh -s Quantize pipeline   # jump to one section (see below)
#   tools/render-local.sh -l                 # list the scenes and exit
#
# Output goes to out/<slug>.mp4, the same names the site and CI use, so a
# locally rendered file can be dropped straight into docs/assets/video/ to
# preview the page with it.
#
# The scene table below is the SAME data as the matrix in
# .github/workflows/animations.yml. A new scene needs a row in both.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

# Prefer uv: it pins the interpreter from .python-version and builds the
# environment on demand, so a fresh clone renders without anyone first working
# out that Python 3.13+ cannot build PyAV. A hand-made venv still works.
VENV="${VENV:-$ROOT/.venv}"
if command -v uv >/dev/null 2>&1; then
  RUNNER=(uv run --group animations manim)
else
  RUNNER=("$VENV/bin/manim")
fi
QUALITY="l"
OPEN=0
SECTION=""
LIST=0

# slug : file : class
SCENES=(
  "decomposition:scene_decomposition.py:Decomposition"
  "harmonic-sum:scene_harmonic_sum.py:HarmonicSum"
  "pipeline:scene_pipeline.py:Pipeline"
  "vq:scene_vq.py:VectorQuantization"
)

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while getopts "q:os:lh" opt; do
  case "$opt" in
    q) QUALITY="$OPTARG" ;;
    o) OPEN=1 ;;
    s) SECTION="$OPTARG" ;;
    l) LIST=1 ;;
    h) usage ;;
    *) usage ;;
  esac
done
shift $((OPTIND - 1))

if [ "$LIST" = 1 ]; then
  printf '%-16s %-26s %s\n' "SLUG" "FILE" "CLASS"
  for row in "${SCENES[@]}"; do
    IFS=: read -r slug file cls <<<"$row"
    printf '%-16s %-26s %s\n' "$slug" "$file" "$cls"
  done
  exit 0
fi

case "$QUALITY" in
  l|m|h|p|k) ;;
  *) die "quality must be one of l m h p k (got '$QUALITY')" ;;
esac

if ! command -v uv >/dev/null 2>&1 && [ ! -x "$VENV/bin/manim" ]; then
  die "no uv, and no manim in $VENV.
Easiest fix, which also pins the right Python:
  brew install uv && uv sync --group animations
Or by hand, where 3.12 is not optional because PyAV has no wheel above it:
  python3.12 -m venv .venv && .venv/bin/pip install manim==0.19.1 numpy"
fi

# Resolve the scenes to render: everything, or just the slugs named.
targets=()
if [ "$#" -eq 0 ]; then
  targets=("${SCENES[@]}")
else
  for want in "$@"; do
    found=""
    for row in "${SCENES[@]}"; do
      IFS=: read -r slug _ _ <<<"$row"
      [ "$slug" = "$want" ] && found="$row"
    done
    [ -n "$found" ] || die "unknown scene '$want' (try -l)"
    targets+=("$found")
  done
fi

mkdir -p out
started=$(date +%s)

for row in "${targets[@]}"; do
  IFS=: read -r slug file cls <<<"$row"
  src="animations/manim/$file"
  [ -f "$src" ] || die "missing scene source $src"

  info "rendering $cls  ($slug, quality $QUALITY)"
  args=(render --quality "$QUALITY" --format mp4 --media_dir media)
  # Manim's own section support: only re-render the part you are working on.
  [ -n "$SECTION" ] && args+=(--save_sections)

  t0=$(date +%s)
  "${RUNNER[@]}" "${args[@]}" "$src" "$cls"
  t1=$(date +%s)

  # manim names the output after the Scene class; we want the site's slug.
  found=$(find media/videos -type f -name "$cls.mp4" -print0 2>/dev/null \
            | xargs -0 ls -t 2>/dev/null | head -1 || true)
  [ -n "$found" ] || die "$cls.mp4 was not produced"
  cp -f "$found" "out/$slug.mp4"

  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "out/$slug.mp4" 2>/dev/null || echo "?")
  has_audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_name \
                -of csv=p=0 "out/$slug.mp4" 2>/dev/null | head -1)
  if [ -n "$has_audio" ]; then label="audio: $has_audio"; else label="NO AUDIO TRACK"; fi
  vtt=""; [ -f "out/$slug.vtt" ] && vtt="  captions: out/$slug.vtt"
  printf '    \033[32mok\033[0m  out/%s.mp4  %ss video  %s%s  (%ds to render)\n' \
    "$slug" "${dur%.*}" "$label" "$vtt" "$((t1 - t0))"

  [ "$OPEN" = 1 ] && open "out/$slug.mp4"
done

info "done in $(( $(date +%s) - started ))s"
