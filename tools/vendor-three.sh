#!/usr/bin/env bash
# Copy one three.js release into docs/javascripts/vendor/three/, verbatim
# from its npm tarball, and record its version there and the file hashes in
# tools/vendor-three.sha256. Only files the site serves go in that
# directory: every file there ships to site/.
# Run from the repo root.
#
#   just vendor-three 0.185.1
#
# three r186 stopped shipping build/*.min.js, so a release without them is
# refused rather than minified here: the site has no build step.
#
# The thick-line addons (LineMaterial, LineSegmentsGeometry, LineSegments2,
# three-visual-language design §3) go in addons/, copied from
# examples/jsm/lines/ with one change: `from 'three'` becomes
# `from '../three.module.min.js'`, since the site has no import map.
# After running it, pin @types/three to the same version in package.json,
# and update THREE_SHA256 and THREE_GZIP_BYTES in tools/verify-site.py.
set -euo pipefail

version="${1:?usage: vendor-three.sh <version>}"
dest="docs/javascripts/vendor/three"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

(cd "$work" && npm pack "three@$version" --silent >/dev/null && tar xzf "three-$version.tgz")
build="$work/package/build"
addons="LineMaterial.js LineSegmentsGeometry.js LineSegments2.js"
for file in three.module.min.js three.core.min.js; do
  if [ ! -s "$build/$file" ]; then
    echo "vendor-three: three@$version has no build/$file"
    exit 1
  fi
done
if ! grep -q 'from"./three.core.min.js"' "$build/three.module.min.js"; then
  echo "vendor-three: three.module.min.js does not import ./three.core.min.js"
  exit 1
fi

for file in $addons; do
  if [ ! -s "$work/package/examples/jsm/lines/$file" ]; then
    echo "vendor-three: three@$version has no examples/jsm/lines/$file"
    exit 1
  fi
done

rm -rf "$dest"
mkdir -p "$dest/addons"
cp "$build/three.module.min.js" "$build/three.core.min.js" "$dest/"
for file in $addons; do
  sed "s|} from 'three';|} from '../three.module.min.js';|" "$work/package/examples/jsm/lines/$file" > "$dest/addons/$file"
  if grep -q "from 'three'" "$dest/addons/$file"; then
    echo "vendor-three: addons/$file still imports 'three'"
    exit 1
  fi
done
cp "$work/package/LICENSE" "$dest/LICENSE"
echo "$version" > "$dest/VERSION"
shasum -a 256 "$dest/three.module.min.js" "$dest/three.core.min.js" \
  $(for file in $addons; do echo "$dest/addons/$file"; done) "$dest/LICENSE" "$dest/VERSION" \
  > tools/vendor-three.sha256
echo "vendor-three: three@$version in $dest"
