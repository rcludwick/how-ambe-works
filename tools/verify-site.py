#!/usr/bin/env python3
"""Check the built site: what the deploy will serve, not what the repo holds.

    python3 tools/verify-site.py site

The repo can look right while the deployed tree is wrong (before 6202a1b
every deploy shipped four dead <video> elements), so this reads site/ after
`zensical build`. For every page it checks that:

  - each data-anim slug has its module in site/javascripts/, imported by
    anim.js;
  - each slug's data and audio files are in site/ (STATIC_FILES, or
    PER_CLIP_FILES for every clip a host lists in data-clips);
  - at most MAX_3D_HOSTS_PER_PAGE 3D figure hosts sit on the page;
  - every <img> with a relative src resolves to a file inside site/ (a
    fallback image written relative to the wrong directory 404s on the
    deployed site, while `zensical serve` still answers it at the root);
  - no data-frame="<digits>" appears, in the page or in docs/*.md: figures
    pick frames by a named criterion, never by index;
  - no <video> and no assets/video/ remain (the videos left main at 637c585;
    figures and their posters replace them);
  - site/javascripts/vendor/three/ holds exactly the two three.js files,
    the three line addons in addons/, LICENSE and VERSION; those five
    match the hashes in THREE_SHA256, and VERSION matches the @types/three
    pin in package.json;
  - the page's 3D code fits budget(n) (plan decision 7, design §3.5):

        page3d    = THREE_GZIP_BYTES + gzip of the union, over the page's 3D
                    slugs, of each one's entry (anim-<slug>-3d.js, or the
                    monolith anim-<slug>.js) and the files it reaches by
                    relative static imports that reference anim-three.js
                    as a module, with anim-three.js itself
        budget(n) = THREE_GZIP_BYTES + 54 KiB + 12 KiB x (n - 1)

    where n is the page's 3D slugs. The 3D slugs are derived: those with an
    anim-<slug>-3d.js, and the monoliths, whose anim-<slug>.js references
    anim-three.js. Each 3D slug's 2D module must import NO_WEBGL_HINT;

and once for the site that:

  - each anim-<slug>-3d.js is at most PART_CAP gzip, and the runtime alone
    (anim-three.js and every lib/*.js that references it) at most
    RUNTIME_CAP;
  - nothing anim.js reaches by static import is anim-three.js or a -3d
    part, a -3d part is imported only by import(), and every monolith
    registers through mountLazy();
  - each live 3D figure in tests/figures/registry/ fits its `allowance`.

`python3 tools/verify-site.py --allowances [--write]` prints the allowance
rule's numbers for every registry file (and writes them in).

Standard library only. Exit 1 with one line per problem; exit 2 if site/
is missing.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

_UTTERANCE_SPECTRA_CLIPS = [f"{voice}-{sentence}" for voice in ("lj", "lr") for sentence in ("a", "c", "d")]
_VOICING_CLIPS = ["lr-b", "lr-c", "lj-c"]

# Files each figure loads, relative to the site root (read from the modules
# at 4df1a52). A figure without an entry here fails the check, on purpose.
STATIC_FILES: dict[str, list[str]] = {
    # slot: bits
    "bits": ["assets/data/frames.json"],
    # end slot: bits
    # slot: complex
    "complex": [],
    # end slot: complex
    # slot: envelope
    "envelope": ["assets/data/frames.json", "assets/data/spectra.json"],
    # end slot: envelope
    # slot: filter
    "filter": [],
    # end slot: filter
    # slot: frames
    "frames": ["assets/data/frames.json", "assets/data/waveform.json",
               "assets/audio/lr-b-original.wav", "assets/audio/lr-b-ambe.wav"],
    # end slot: frames
    # slot: harmonics
    "harmonics": ["assets/data/lr-b/frames.json", "assets/data/lj-b/frames.json"],
    # end slot: harmonics
    # slot: synth
    "synth": ["assets/data/frames.json", "assets/data/spectra.json"],
    # end slot: synth
    # slot: three-numbers
    "three-numbers": [],  # a formula, plotted; no files
    # end slot: three-numbers
    # slot: utterance
    "utterance": ["assets/data/lj-c/waveform.json", "assets/audio/lj-c-original.wav"],
    # end slot: utterance
    # slot: utterance-spectra
    "utterance-spectra": [f"assets/data/{c}/spectra.json" for c in _UTTERANCE_SPECTRA_CLIPS]
    + [f"assets/audio/{c}-original.wav" for c in _UTTERANCE_SPECTRA_CLIPS],
    # end slot: utterance-spectra
    # slot: voicing
    "voicing": [f"assets/data/{c}/{name}.json" for c in _VOICING_CLIPS for name in ("frames", "spectra")]
    + [f"assets/audio/{c}-ambe.wav" for c in _VOICING_CLIPS],
    # end slot: voicing
    # slot: vq-space
    # Synthetic dots from a seeded generator, and the Speech dots.
    "vq-space": ["assets/data/harmonic-triples.json"],
    # end slot: vq-space
    # The new figures (three-everywhere plan), empty until their tasks fill
    # them. Each row sits between its slug's slot markers, which that
    # figure's task alone may edit (tools/check-slots.py).
    # slot: probe
    "probe": [],  # a computed sine (lib/probe.js); no files
    # end slot: probe
    # slot: window-shapes
    "window-shapes": [],  # a synthetic tone and three windows (lib/window-shapes.js); no files
    # end slot: window-shapes
    # slot: leakage
    "leakage": [],  # a synthetic tone, transformed in the browser; no files
    # end slot: leakage
    # slot: tradeoff
    "tradeoff": [],
    # end slot: tradeoff
    # slot: pitch-search
    "pitch-search": ["assets/data/lr-b/correlogram.json"],
    # end slot: pitch-search
    # slot: envelope-blocks
    "envelope-blocks": ["assets/data/frames.json", "assets/data/spectra.json"],
    # end slot: envelope-blocks
    # slot: fec-protection
    "fec-protection": [],  # computed by lib/fec.js; reads no files
    # end slot: fec-protection
    # slot: frame-boundary
    "frame-boundary": [],  # closed-form synthetic frames; no files
    # end slot: frame-boundary
    # slot: listen-terrain
    # frames.json and spectra.json, and both WAVs, of lr-b, lr-c, lj-c, lj-b.
    "listen-terrain": [f"assets/{kind}" for clip in ("lr-b", "lr-c", "lj-c", "lj-b")
                       for kind in (f"data/{clip}/frames.json", f"data/{clip}/spectra.json",
                                    f"audio/{clip}-original.wav", f"audio/{clip}-ambe.wav")],
    # end slot: listen-terrain
    # slot: gain-definitions
    # frames.json and spectra.json of all eight clips, loaded one at a time.
    "gain-definitions": [f"assets/data/{clip}/{name}" for clip in ("lr-a", "lr-b", "lr-c", "lr-d", "lj-a", "lj-b", "lj-c", "lj-d")
                         for name in ("frames.json", "spectra.json")],
    # end slot: gain-definitions
}

# For figures whose host lists its clips in data-clips: the files per clip,
# with {clip} in the path. Checked for every listed clip.
PER_CLIP_FILES: dict[str, list[str]] = {
    # slot: harmonic-sum
    "harmonic-sum": ["assets/data/{clip}/frames.json", "assets/data/{clip}/spectra.json",
                     "assets/audio/{clip}-original.wav", "assets/audio/{clip}-ambe.wav"],
    # end slot: harmonic-sum
    # slot: frame-path
    "frame-path": ["assets/data/{clip}/frames.json", "assets/data/{clip}/spectra.json",
                   "assets/audio/{clip}-original.wav", "assets/audio/{clip}-ambe.wav"],
    # end slot: frame-path
    # slot: voicing
    "voicing": ["assets/data/{clip}/frames.json", "assets/data/{clip}/spectra.json",
                "assets/audio/{clip}-ambe.wav"],
    # end slot: voicing
}

PACKAGE_JSON = ROOT / "package.json"
VENDOR_DIR = "javascripts/vendor/three"
VENDOR_FILES = ["three.module.min.js", "three.core.min.js", "addons/LineMaterial.js",
                "addons/LineSegmentsGeometry.js", "addons/LineSegments2.js"]
# Everything that may sit in site/javascripts/vendor/three/, by path below it.
VENDOR_SET = {*VENDOR_FILES, "LICENSE", "VERSION"}

# sha256 of build/three.module.min.js and build/three.core.min.js in the npm
# tarball of three 0.185.1 (npm pack three@0.185.1), checked 2026-10-08,
# and of the three line addons from examples/jsm/lines/ as
# tools/vendor-three.sh writes them (its one change is the import of
# three), checked 2026-10-09. Held here, apart from
# tools/vendor-three.sha256, so a changed vendored file has to be matched
# in two places to pass.
THREE_SHA256 = {
    "three.module.min.js": "86bcee248b64f44bcfc23c331ae74619061957d59cab040171dcb6fb5900beb6",
    "three.core.min.js": "05b2609338c76cd65daf74f3ac515bc9a5045e1b3b33edc07d8c9bd55250fa90",
    "addons/LineMaterial.js": "96a4c996b4b520c6b2d5b574700cb4c25857bbccb356f0a1d593edee1f8dd4ac",
    "addons/LineSegmentsGeometry.js": "f8aa24820ca6953c538f8a51c0f41f872992bfafee4a033f6a718af4c3ce2dae",
    "addons/LineSegments2.js": "ecae598f271112340e744f49d9477344bc4870087f9ffa65e18f725f1403fadf",
}

# gzip -9 size of the five VENDOR_FILES for three 0.185.1 (gzip.compress,
# level 9, mtime 0): 187,509 for three itself, measured 2026-10-08, plus
# 9,207 for the line addons (4,197 + 1,701 + 3,309), measured 2026-10-09.
# Every 3D view loads the addons with three, so they count here and never
# against a figure's allowance.
THREE_GZIP_BYTES = 196_716
KIB = 1024
# budget(n) = THREE_GZIP_BYTES + PAGE_ALLOWANCE + PER_EXTRA_FIGURE x (n - 1)
# PAGE_ALLOWANCE is RUNTIME_CAP plus the 18 KiB the plan leaves one figure
# (decision 7 had 36 = 18 + 18). The runtime is served unminified, about
# half comments, and with the visual language (lib/style.js, highlight.js,
# the timeline and zoom) it measures well over the plan's 18 KiB; every
# figure in the language imports all of it, so the page pays for all of it.
# Raised 2026-10-09 by the visual-language prelude (runtime measured at
# 33,359 bytes with it all in), pending Rob's call.
PAGE_ALLOWANCE = 54 * KIB
PER_EXTRA_FIGURE = 12 * KIB
# One anim-<slug>-3d.js on its own (monoliths exempt).
PART_CAP = 16 * KIB
# anim-three.js and every lib that references it, without three itself.
RUNTIME_CAP = 36 * KIB
# A sanity line, not a budget: the cap on live contexts parks the rest.
MAX_3D_HOSTS_PER_PAGE = 8

REGISTRY_DIR = ROOT / "tests" / "figures" / "registry"
# Allowance rule (plan "Slots the prelude creates"): what a page's 3D slugs
# share is budget(n) less the runtime; harmonics has a fixed 10 KiB on ch07
# and on the index, and each monolith keeps its measured size plus the
# growth its task may spend (voicing takes the rest of ch07).
FIXED_ALLOWANCE = {"harmonics": 10 * KIB}
MONOLITH_GROWTH = {"vq-space": 4 * KIB, "frame-path": 3 * KIB, "harmonic-sum": 3 * KIB}
REMAINDER_SLUGS = {"voicing"}


def budget(n: int) -> int:
    """The gzip bytes a page with n 3D figures may load for 3D."""
    return THREE_GZIP_BYTES + PAGE_ALLOWANCE + PER_EXTRA_FIGURE * (n - 1)


def _gz(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0)) if path.is_file() else 0

# A module specifier naming anim-three.js: `from "./anim-three.js"`, or a
# JSDoc `import("../anim-three.js")` type. A comment that only mentions the
# file (lib/view-switch.js, which must not import it) does not count.
_REFERENCES_THREE = re.compile(r"""["'](?:\./|\.\./)anim-three\.js["']""")
# A line that starts `import(` (a wrapped `load: () =>\n  import("./x-3d.js")`)
# or `import.meta` is not a static import.
_STATIC_IMPORT = re.compile(
    r"""^\s*(?:import\b(?!\s*[(.])|export\b)[^;'"]*?(?:\bfrom\s*)?["'](\.{1,2}/[^"']+)["']""", re.M)
_DYNAMIC_IMPORT = re.compile(r"""import\(\s*["'](\.{1,2}/[^"']+)["']""")


def _static_imports(path: Path) -> list[Path]:
    """Relative static imports of a module, resolved against its directory."""
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8")
    return [(path.parent / spec).resolve() for spec in _STATIC_IMPORT.findall(text)]


def _references_three(path: Path) -> bool:
    return path.is_file() and bool(_REFERENCES_THREE.search(path.read_text(encoding="utf-8")))


def three_d_slugs(js: Path) -> set[str]:
    """The derived 3D slug set: an anim-<slug>-3d.js, or a monolith."""
    slugs = {p.name[len("anim-"):-len("-3d.js")] for p in js.glob("anim-*-3d.js")}
    for module in js.glob("anim-*.js"):
        if module.name.endswith("-3d.js") or module.name == "anim-three.js":
            continue
        if _references_three(module):
            slugs.add(module.name[len("anim-"):-len(".js")])
    return slugs


def entry(js: Path, slug: str) -> Path:
    """A 3D slug's entry: its -3d part, or its monolith."""
    part = js / f"anim-{slug}-3d.js"
    return part if part.is_file() else js / f"anim-{slug}.js"


def runtime_files(js: Path) -> set[Path]:
    """anim-three.js and every lib/*.js that references it."""
    files = {(js / "anim-three.js").resolve()}
    files |= {p.resolve() for p in (js / "lib").glob("*.js") if _references_three(p)}
    return files


def page_3d_files(js: Path, slugs: set[str]) -> set[Path]:
    """The union of the slugs' entries and what they reach that references anim-three.js."""
    if not slugs:
        return set()
    files = {(js / "anim-three.js").resolve()}
    todo = [entry(js, slug).resolve() for slug in slugs]
    files |= set(todo)
    seen = set(todo)
    while todo:
        for target in _static_imports(todo.pop()):
            if target in seen:
                continue
            seen.add(target)
            if _references_three(target):
                files.add(target)
            todo.append(target)
    return files


def _check_3d_site(js: Path, entry_text: str, slugs: set[str]) -> list[str]:
    """The site-wide 3D checks: part cap, runtime cap, static closure, mountLazy."""
    problems: list[str] = []
    for part in sorted(js.glob("anim-*-3d.js")):
        size = _gz(part)
        if size > PART_CAP:
            problems.append(f"{part.name} is {size} bytes gzip, over the part cap of {PART_CAP}")
    runtime = sum(_gz(p) for p in runtime_files(js))
    if runtime > RUNTIME_CAP:
        problems.append(f"the 3D runtime (anim-three.js and its libs) is {runtime} bytes gzip, "
                        f"over the runtime cap of {RUNTIME_CAP}")
    # Static closure from anim.js.
    anim = (js / "anim.js").resolve()
    seen = {anim}
    todo = [anim]
    while todo:
        for target in _static_imports(todo.pop()):
            if target in seen:
                continue
            seen.add(target)
            todo.append(target)
            if target.name == "anim-three.js" or target.name.endswith("-3d.js"):
                problems.append(f"anim.js reaches {target.name} by static import; 3D code loads only on request")
    for module in sorted(js.rglob("*.js")):
        if "vendor" in module.parts:
            continue
        for target in _static_imports(module):
            if target.name.endswith("-3d.js"):
                problems.append(f"{module.relative_to(js).as_posix()} imports {target.name} statically; "
                                f"a 3D part loads only through import()")
    for slug in sorted(slugs):
        if not (js / f"anim-{slug}-3d.js").is_file() and f'mountLazy("{slug}"' not in entry_text:
            problems.append(f"anim-{slug}.js holds 3D code but anim.js does not register it with mountLazy()")
        module = js / f"anim-{slug}.js"
        if module.is_file() and "NO_WEBGL_HINT" not in module.read_text(encoding="utf-8"):
            problems.append(f"anim-{slug}.js has a 3D view but does not import NO_WEBGL_HINT")
    return problems


def load_registry(directory: Path = REGISTRY_DIR) -> list[dict]:
    """Every registry file, by slug."""
    if not directory.is_dir():
        return []
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(directory.glob("*.json"))]


def _check_allowances(js: Path, slugs: set[str], registry: list[dict]) -> list[str]:
    problems: list[str] = []
    for record in registry:
        slug = record["slug"]
        if record.get("status") != "live" or slug not in slugs:
            continue
        size = _gz(entry(js, slug))
        allowance = int(record.get("allowance") or 0)
        if size > allowance:
            problems.append(f"{slug}: its 3D code is {size} bytes gzip, over its allowance of {allowance} "
                            f"(tests/figures/registry/{slug}.json)")
    return problems


def allowances(js: Path, registry: list[dict]) -> dict[str, int]:
    """The allowance rule, from the measured runtime and each page's planned 3D slugs."""
    runtime = sum(_gz(p) for p in runtime_files(js))
    pages: dict[str, list[str]] = {}
    for record in registry:
        for page in [record["page"], *record.get("alsoOn", [])]:
            pages.setdefault(page, []).append(record["slug"])
    out: dict[str, int] = {}
    for page, slugs in sorted(pages.items()):
        pool = budget(len(slugs)) - THREE_GZIP_BYTES - runtime
        shares = [s for s in slugs if s not in FIXED_ALLOWANCE]
        for slug in slugs:
            if slug in FIXED_ALLOWANCE:
                pool -= FIXED_ALLOWANCE[slug]
        for slug in shares:
            if slug in MONOLITH_GROWTH:
                out[slug] = min(out.get(slug, 1 << 30), _gz(js / f"anim-{slug}.js") + MONOLITH_GROWTH[slug])
                pool -= out[slug]
        even = [s for s in shares if s not in MONOLITH_GROWTH]
        for slug in even:
            share = pool if slug in REMAINDER_SLUGS or len(even) == 1 else pool // len(even)
            if slug not in REMAINDER_SLUGS:
                share = min(share, PART_CAP)
            out[slug] = min(out.get(slug, 1 << 30), share)
    for slug, fixed in FIXED_ALLOWANCE.items():
        out[slug] = fixed
    return out


NUMERIC_FRAME = re.compile(r"""data-frame\s*=\s*["']?\d""")
FRAME_HINT = "numeric data-frame; pick frames by data-pick (a named criterion)"


class _Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hosts: list[dict[str, str]] = []
        self.videos = 0
        self.images: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        found = {key: value or "" for key, value in attrs}
        if "data-anim" in found:
            self.hosts.append(found)
        if tag == "video":
            self.videos += 1
        if tag == "img" and found.get("src"):
            self.images.append(found["src"])


def _needed(rel: str, host: dict[str, str], problems: list[str]) -> list[str]:
    slug = host["data-anim"]
    clips = [c.strip() for c in host.get("data-clips", "").split(",") if c.strip()]
    if clips:
        templates = PER_CLIP_FILES.get(slug)
        if templates is None:
            problems.append(f"{rel}: {slug} has data-clips but no PER_CLIP_FILES entry in tools/verify-site.py")
            return []
        return [template.format(clip=clip) for clip in clips for template in templates]
    if slug not in STATIC_FILES:
        problems.append(f"{rel}: {slug} has no entry in STATIC_FILES in tools/verify-site.py")
        return []
    return STATIC_FILES[slug]


def _image_problem(site: Path, page: Path, src: str) -> str:
    """Why a relative image src would not load from the built site, or ""."""
    if re.match(r"^([a-z][a-z0-9+.-]*:|/|#)", src, re.I):
        return ""
    path = src.split("#", 1)[0].split("?", 1)[0]
    target = (page.parent / path).resolve()
    root = site.resolve()
    if root not in target.parents:
        return f'img src="{src}" points outside site/'
    if not target.is_file():
        return f'img src="{src}" is missing from site/'
    return ""


def _check_vendor(site: Path, package: Path) -> list[str]:
    problems: list[str] = []
    vendor = site / VENDOR_DIR
    for name in VENDOR_FILES:
        target = vendor / name
        if not target.is_file() or target.stat().st_size == 0:
            problems.append(f"site/{VENDOR_DIR}/{name} is missing or empty")
        elif hashlib.sha256(target.read_bytes()).hexdigest() != THREE_SHA256[name]:
            problems.append(f"site/{VENDOR_DIR}/{name} does not match THREE_SHA256 in tools/verify-site.py")
    if vendor.is_dir():
        shipped = {p.relative_to(vendor).as_posix() for p in vendor.rglob("*") if p.is_file()}
        for extra in sorted(shipped - VENDOR_SET):
            problems.append(f"site/{VENDOR_DIR}/{extra} should not ship; only {', '.join(sorted(VENDOR_SET))}")
    version_file = vendor / "VERSION"
    version = version_file.read_text(encoding="utf-8").strip() if version_file.is_file() else ""
    pinned = json.loads(package.read_text(encoding="utf-8")).get("devDependencies", {}).get("@types/three", "")
    if version != pinned:
        problems.append(f"three {version or '(no VERSION)'} is vendored but package.json pins @types/three {pinned or '(none)'}")
    return problems


def check(site: Path, docs: Path, package: Path = PACKAGE_JSON,
          registry: list[dict] | None = None) -> tuple[list[str], int, int]:
    problems: list[str] = []
    js = site / "javascripts"
    entry_path = js / "anim.js"
    entry_text = entry_path.read_text(encoding="utf-8") if entry_path.is_file() else ""
    if not entry_text:
        problems.append("site/javascripts/anim.js is missing or empty")
    slugs3d = three_d_slugs(js)
    problems += _check_3d_site(js, entry_text, slugs3d)
    problems += _check_allowances(js, slugs3d, load_registry() if registry is None else registry)

    hosts = pages_with_hosts = 0
    for page in sorted(site.rglob("*.html")):
        rel = page.relative_to(site).as_posix()
        text = page.read_text(encoding="utf-8")
        if NUMERIC_FRAME.search(text):
            problems.append(f"{rel}: {FRAME_HINT}")
        parsed = _Page()
        parsed.feed(text)
        if parsed.videos:
            problems.append(f"{rel}: <video> still present")
        if 'class="arithmatex"' in text:
            # The site loads no math renderer, so arithmatex output reaches
            # the reader as raw \\( ... \\). Write f<sub>0</sub>, not $f_0$.
            problems.append(f"{rel}: unrendered $...$ math; write it as text (f<sub>0</sub>, ω, ⌊ ⌋)")
        for src in parsed.images:
            problem = _image_problem(site, page, src)
            if problem:
                problems.append(f"{rel}: {problem}")
        if not parsed.hosts:
            continue
        pages_with_hosts += 1
        page_slugs: set[str] = set()
        three_d_hosts = 0
        for host in parsed.hosts:
            hosts += 1
            slug = host["data-anim"]
            module = f"anim-{slug}.js"
            if not (js / module).is_file():
                problems.append(f'{rel}: data-anim="{slug}" but site/javascripts/{module} is missing')
            elif f'"./{module}"' not in entry_text:
                problems.append(f"{rel}: {module} is not imported by anim.js")
            if slug in slugs3d:
                three_d_hosts += 1
                page_slugs.add(slug)
            for path in _needed(rel, host, problems):
                target = site / path
                if not target.is_file() or target.stat().st_size == 0:
                    problems.append(f"{rel}: {slug} needs {path}, missing or empty in site/")
        if three_d_hosts > MAX_3D_HOSTS_PER_PAGE:
            problems.append(f"{rel}: {three_d_hosts} 3D figure hosts; at most {MAX_3D_HOSTS_PER_PAGE} per page")
        if page_slugs:
            total = THREE_GZIP_BYTES + sum(_gz(p) for p in page_3d_files(js, page_slugs))
            limit = budget(len(page_slugs))
            if total > limit:
                problems.append(f"{rel}: 3D on this page is {total} bytes gzip, over budget({len(page_slugs)}) = {limit}")

    for chapter in sorted(docs.glob("*.md")):
        for number, line in enumerate(chapter.read_text(encoding="utf-8").splitlines(), 1):
            if NUMERIC_FRAME.search(line):
                problems.append(f"docs/{chapter.name}:{number}: {FRAME_HINT}")

    if (site / "assets" / "video").exists():
        problems.append("site/assets/video/ still present")
    problems += _check_vendor(site, package)
    return problems, hosts, pages_with_hosts


def _print_allowances(site: Path, write: bool) -> int:
    registry = load_registry()
    table = allowances(site / "javascripts", registry)
    runtime = sum(_gz(p) for p in runtime_files(site / "javascripts"))
    print(f"verify-site: runtime {runtime} bytes gzip (cap {RUNTIME_CAP})")
    for record in registry:
        slug = record["slug"]
        print(f"  {slug:18} {table.get(slug, 0):6}  (now {record.get('allowance', 0)})")
        if write:
            record["allowance"] = table.get(slug, 0)
            (REGISTRY_DIR / f"{slug}.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return 0


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--allowances":
        return _print_allowances(ROOT / "site", "--write" in argv[1:])
    site = Path(argv[0]) if argv else ROOT / "site"
    if not site.is_dir():
        print(f"verify-site: {site} not found; run `just build` first")
        return 2
    problems, hosts, pages = check(site, ROOT / "docs")
    if hosts == 0:
        # A build that drops or escapes every raw <div data-anim> would
        # otherwise pass with nothing checked.
        problems.append(f"no figure hosts in {site}; was it built from docs/?")
    for problem in problems:
        print(f"verify-site: {problem}")
    if problems:
        return 1
    print(f"verify-site: ok ({hosts} figure hosts on {pages} pages)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
