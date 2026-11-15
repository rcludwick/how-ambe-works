#!/usr/bin/env bash
# Every figure module (docs/javascripts/anim-*.js, lib/*.js) must start with
# `// @ts-check`, so tsc checks it under the strict jsconfig.json. A module
# that predates the check starts with `/* ts-legacy */` instead (plan
# decision 3): the marker sits in the module, so the task that converts it
# removes the marker in that module alone. Only the ten modules that
# predated the check at 5a01d29 (MAY_BE_LEGACY, frozen) may carry it; a new
# module, an anim-<slug>-3d.js among them, starts with // @ts-check.
# Converting a module needs no edit here.
# The test-only figures (tests/figures/fixtures/javascripts/*.js) are in
# jsconfig.json too, with checkJs off, so they need the pragma as well.
#
#   bash tools/check-ts-pragma.sh   # JS_DIR=docs/javascripts and
#                                   # FIXTURE_DIR=tests/figures/fixtures/javascripts
set -euo pipefail

JS_DIR="${JS_DIR:-docs/javascripts}"
FIXTURE_DIR="${FIXTURE_DIR:-tests/figures/fixtures/javascripts}"

MAY_BE_LEGACY=" anim-bits.js anim-complex.js anim-envelope.js anim-filter.js anim-frames.js
  anim-harmonics.js anim-synth.js anim-three-numbers.js anim-utterance-spectra.js anim-utterance.js "

status=0
checked=0
shopt -s nullglob
legacy=0
for file in "$JS_DIR"/anim-*.js "$JS_DIR"/lib/*.js; do
  name="${file#"$JS_DIR"/}"
  first="$(head -n 1 "$file")"
  if [ "$first" = '/* ts-legacy */' ]; then
    legacy=$((legacy + 1))
    if [[ "$MAY_BE_LEGACY" != *[[:space:]]"$name"[[:space:]]* ]]; then
      echo "check-ts-pragma: $name carries /* ts-legacy */, which only the ten modules that predate the check may; start it with // @ts-check"
      status=1
    elif grep -qx '// @ts-check' "$file"; then
      echo "check-ts-pragma: $name has // @ts-check; remove its /* ts-legacy */ line"
      status=1
    fi
  elif [ "$first" != '// @ts-check' ]; then
    echo "check-ts-pragma: $name must start with // @ts-check (or /* ts-legacy */ until it is converted)"
    status=1
  fi
  checked=$((checked + 1))
done

# nullglob turns a wrong JS_DIR or working directory into an empty loop.
if [ "$checked" = 0 ]; then
  echo "check-ts-pragma: no anim-*.js or lib/*.js under $JS_DIR"
  status=1
fi

fixtures=0
for file in "$FIXTURE_DIR"/*.js; do
  if ! head -n 1 "$file" | grep -qx '// @ts-check'; then
    echo "check-ts-pragma: $file must start with // @ts-check"
    status=1
  fi
  fixtures=$((fixtures + 1))
done
if [ "$fixtures" = 0 ]; then
  echo "check-ts-pragma: no *.js under $FIXTURE_DIR"
  status=1
fi
checked=$((checked + fixtures))

if [ "$status" = 0 ]; then
  echo "check-ts-pragma: ok ($checked files, $legacy legacy)"
fi
exit "$status"
