#!/usr/bin/env python3
"""Hold the figure modules to the Q0 ruling (design §3.10, §3.13).

    python3 tools/check-scope.py [docs/javascripts]

The figures may draw generic DSP on synthetic data or on one frame's
precomputed values, or a precomputed scatter of per-frame measurements from
the input audio, plotted and never sequenced or sounded (owner decision O3,
2026-10-09). They may not turn a sequence of frames into audio, and they may
not read the 72 channel bits as parameters. This checks the part of that a
script can see, in docs/javascripts/*.js and lib/*.js (not vendor/):

  - no WebAudio synthesis or buffer playback outside SYNTH_ALLOWED. Q1 is
    approved for one figure only (owner, 2026-10-20): anim-harmonics.js
    sounds its illustrative comb as one steady tone, never frame data;
  - `.hex` is read only in HEX_READERS. Figures that need colour values
    destructure them (`const { hex } = ctx.token(name)`), which this allows;
  - outside HEX_READERS, frameHex() (anim-core.js) is called only to hand
    the string straight to hexBits() or to print it whole: as
    `hexBits(frameHex(...))`, `.textContent = frameHex(...)` or
    `${frameHex(...)}` in a template. Its result is never stored, sliced,
    indexed or parsed;
  - hexBits() in anim-core.js shifts right and masks single bits only: no
    `<<`, no `|` joining bits, no parseInt(..., 2);
  - the 3D code (every anim-*-3d.js, anim-three.js, the libs in THREE_D,
    and every other lib/*.js that names anim-three.js in a module
    specifier, as verify-site counts the runtime; so lib/labels.js,
    lib/orbit.js and a lib a figure task adds join on their own) takes the
    2D module's arrays and reads nothing itself: no
    AudioContext, no decodeAudioData, no fetch, loadJSON or loadPCM, and no
    frameHex() or hexBits().

Comments are stripped before checking. Exit 1 with one line per problem.
Standard library only.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SYNTH = re.compile(r"\b(createPeriodicWave|createBuffer|createBufferSource|createOscillator|"
                   r"OscillatorNode|AudioBufferSourceNode|new\s+AudioBuffer)\b")
# anim-harmonics.js: Play sounds the illustrative comb (Q1, 2026-10-20).
SYNTH_ALLOWED: set[str] = {"anim-harmonics.js"}
HEX_READ = re.compile(r"\.hex\b")
# anim-core.js: hexBits(). anim-bits.js and anim-frames.js: legacy displays of
# the hex frame (design §3.10), which predate this check.
HEX_READERS = {"anim-core.js", "anim-bits.js", "anim-frames.js"}
COMMENTS = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)
# The 3D side: a figure's 3D part, the runtime and the libs built for it;
# three_d_files() adds every lib that names anim-three.js.
THREE_D = ["anim-*-3d.js", "anim-three.js", "lib/scene.js", "lib/style.js", "lib/highlight.js",
           "lib/view-switch.js"]
# A module specifier naming anim-three.js (an import, or a JSDoc import()
# type), as tools/verify-site.py reads it; a bare mention does not count.
REFERENCES_THREE = re.compile(r"""["'](?:\./|\.\./)anim-three\.js["']""")
THREE_D_READS = re.compile(r"\b(AudioContext|webkitAudioContext|decodeAudioData|fetch|loadJSON|loadPCM|"
                           r"frameHex|hexBits)\s*\(|\bnew\s+(?:webkit)?AudioContext\b")
FRAME_HEX_CALL = re.compile(r"\bframeHex\s*\(")
# What may come just before a frameHex( call, and just after its closing
# parenthesis: the string goes whole to hexBits() or onto the page.
FRAME_HEX_BEFORE = re.compile(r"(hexBits\(|\.textContent\s*=|\$\{)\s*$")
FRAME_HEX_AFTER = {"hexBits(": ")", "textContent": ";", "${": "}"}


def _strip(text: str) -> str:
    return COMMENTS.sub("", text)


def _hexbits_body(text: str) -> str:
    start = text.find("function hexBits(")
    if start < 0:
        return ""
    depth, i = 0, text.index("{", start)
    for j in range(i, len(text)):
        depth += {"{": 1, "}": -1}.get(text[j], 0)
        if depth == 0:
            return text[i:j + 1]
    return text[i:]


def _frame_hex_uses(code: str) -> list[str]:
    """Each frameHex( call that does not pass its string on whole."""
    bad = []
    for match in FRAME_HEX_CALL.finditer(code):
        if re.search(r"function\s*$", code[:match.start()]):
            continue
        before = FRAME_HEX_BEFORE.search(code[:match.start()])
        depth, end = 0, len(code)
        for j in range(match.end() - 1, len(code)):
            depth += {"(": 1, ")": -1}.get(code[j], 0)
            if depth == 0:
                end = j + 1
                break
        after = code[end:].lstrip()[:1]
        want = None
        if before:
            key = before.group(1)
            want = FRAME_HEX_AFTER["textContent" if key.startswith(".") else key]
        if want is None or after != want:
            line = code.count("\n", 0, match.start()) + 1
            bad.append(f"line {line}")
    return bad


def three_d_files(js_dir: Path) -> set[Path]:
    """THREE_D, and every lib/*.js that names anim-three.js."""
    found = {p for pattern in THREE_D for p in js_dir.glob(pattern)}
    found |= {p for p in (js_dir / "lib").glob("*.js") if REFERENCES_THREE.search(p.read_text(encoding="utf-8"))}
    return found


def check(js_dir: Path) -> list[str]:
    problems = []
    files = sorted(js_dir.glob("*.js")) + sorted((js_dir / "lib").glob("*.js"))
    three_d = three_d_files(js_dir)
    for path in files:
        name = path.relative_to(js_dir).as_posix()
        code = _strip(path.read_text(encoding="utf-8"))
        for match in SYNTH.finditer(code):
            if name not in SYNTH_ALLOWED:
                problems.append(f"{name}: {match.group(1)} (no audio synthesis in figures; Q1)")
        if HEX_READ.search(code) and name not in HEX_READERS:
            problems.append(f"{name}: reads .hex; use hexBits() from anim-core.js")
        if name not in HEX_READERS:
            for where in _frame_hex_uses(code):
                problems.append(f"{name}: frameHex() at {where} must go whole to hexBits() or the page")
        if path in three_d:
            for match in THREE_D_READS.finditer(code):
                what = match.group(1) or "AudioContext"
                problems.append(f"{name}: {what} (3D code takes the 2D module's arrays and reads nothing)")
        if name == "anim-core.js":
            body = _hexbits_body(code)
            if re.search(r"<<|\|(?!\|)|parseInt\([^)]*,\s*2\)", body):
                problems.append("anim-core.js: hexBits() must return single bits and join none")
    return problems


def main(argv: list[str]) -> int:
    js_dir = Path(argv[0]) if argv else ROOT / "docs" / "javascripts"
    problems = check(js_dir)
    for problem in problems:
        print(f"check-scope: {problem}")
    if problems:
        return 1
    print(f"check-scope: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
