#!/usr/bin/env bash
# The vendored three.js (docs/javascripts/vendor/three/) must be exactly the
# files tools/vendor-three.sh copied: each one matches its hash in
# tools/vendor-three.sha256, and nothing else is in the directory, since
# every file there ships to site/.
#
#   bash tools/check-vendor-three.sh    # from the repo root; just vendor-check
set -euo pipefail

MANIFEST="${MANIFEST:-tools/vendor-three.sha256}"
VENDOR_DIR="${VENDOR_DIR:-docs/javascripts/vendor/three}"

status=0
if ! shasum -a 256 -c --quiet "$MANIFEST"; then
  echo "check-vendor-three: a vendored file does not match $MANIFEST"
  status=1
fi

# Paths below VENDOR_DIR (the line addons sit in addons/), files only.
expected="$(awk '{ print $2 }' "$MANIFEST" | sed "s|^$VENDOR_DIR/||" | LC_ALL=C sort)"
actual="$(cd "$VENDOR_DIR" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)"
if [ "$expected" != "$actual" ]; then
  echo "check-vendor-three: $VENDOR_DIR holds other files than $MANIFEST lists:"
  diff <(echo "$expected") <(echo "$actual") | grep '^[<>]' || true
  status=1
fi

if [ "$status" = 0 ]; then
  echo "check-vendor-three: ok ($(echo "$expected" | wc -l | tr -d ' ') files)"
fi
exit "$status"
