#!/usr/bin/env bash
# Copy KaTeX's stylesheet and fonts into docs/stylesheets/vendor/katex/,
# verbatim from its npm tarball, and record its version there and the file
# hashes in tools/vendor-katex.sha256. Only files the site serves go in that
# directory: every file there ships to site/.
# Run from the repo root.
#
#   just vendor-katex 0.19.1
#
# The stylesheet's url(fonts/...) paths are relative, so the fonts sit in
# fonts/ beside it. All three font formats ship, since the stylesheet lists
# all three and editing it would make it no longer KaTeX's own file.
# The page loads no KaTeX script: tools/render-math.mjs typesets ahead of
# time. After running it, pin the katex dev dependency in package.json to the
# same version (npm install --save-dev --save-exact katex@<version>).
set -euo pipefail

version="${1:?usage: vendor-katex.sh <version>}"
dest="docs/stylesheets/vendor/katex"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

(cd "$work" && npm pack "katex@$version" --silent >/dev/null && tar xzf "katex-$version.tgz")
dist="$work/package/dist"
for file in katex.min.css fonts; do
  if [ ! -e "$dist/$file" ]; then
    echo "vendor-katex: katex@$version has no dist/$file"
    exit 1
  fi
done
if [ ! -s "$work/package/LICENSE" ]; then
  echo "vendor-katex: katex@$version has no LICENSE"
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest/fonts"
cp "$dist/katex.min.css" "$dest/"
cp "$dist"/fonts/*.woff2 "$dist"/fonts/*.woff "$dist"/fonts/*.ttf "$dest/fonts/"
cp "$work/package/LICENSE" "$dest/LICENSE"
echo "$version" > "$dest/VERSION"

# Every font the stylesheet names must have arrived.
for font in $(grep -o 'url(fonts/[^)]*)' "$dest/katex.min.css" | sed 's/^url(//; s/)$//' | sort -u); do
  if [ ! -s "$dest/$font" ]; then
    echo "vendor-katex: katex.min.css names $font, which is missing"
    exit 1
  fi
done

(cd "$dest" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) | while read -r file; do
  shasum -a 256 "$dest/$file"
done > tools/vendor-katex.sha256
echo "vendor-katex: katex@$version in $dest"
