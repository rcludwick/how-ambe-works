# Local commands. CI runs the same commands directly and does not need just.
# See README, "Before merging".

# --strict passes on 4df1a52 with the orphan pages (04-06, 14, 15) out of
# the nav: zensical 0.0.53 reports no warnings for them.
STRICT := "--strict"

check: typecheck pragma vendor-check copy unit scope data slots build verify-site

typecheck:
    npm run typecheck

pragma:
    bash tools/check-ts-pragma.sh

# The vendored three.js must match the hashes recorded when it was copied,
# with no other file beside it.
vendor-check:
    bash tools/check-vendor-three.sh

# Copy a three.js release into docs/javascripts/vendor/three/.
vendor-three version:
    bash tools/vendor-three.sh {{version}}

copy:
    uv run python tools/check-copy.py

unit:
    uv run --locked --group data python -m unittest discover -s tests/tools

# Flags the writing habits in tools/VOICE.md (advisory; not part of check).
voice *files:
    uv run python tools/check-voice.py {{files}}

# The site's voice score at each commit since the revoice; lower is better.
voice-trend *args:
    uv run python tools/voice-trend.py {{args}}

# The figures draw generic DSP and never synthesise or read bits as values.
scope:
    uv run python tools/check-scope.py

data:
    uv run python tools/verify-data.py

build:
    uv run --locked --group docs zensical build --clean {{STRICT}}

verify-site:
    uv run python tools/verify-site.py site

test:
    npm run test:figures

# Every slot block the three-everywhere prelude made, each as often as
# tools/slots.json lists it, and every marker paired.
slots:
    uv run python tools/check-slots.py --inventory

# A figure branch changes only its own files and the lines inside its own
# slot blocks (tools/slots.json), against main.
check-slots slug:
    uv run python tools/check-slots.py {{slug}}

# A figure branch changes only its own pixel baselines. With no slug, list
# every baseline changed against main.
check-baselines slug="":
    uv run python tools/check-baselines.py {{slug}}

# Fallback images for the figure hosts (docs/assets/posters/).
posters:
    uv run --locked --group data python tools/make-posters.py

serve:
    uv run --locked --group docs zensical serve
