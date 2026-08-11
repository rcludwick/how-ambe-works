#!/usr/bin/env python3
"""
make-narration.py — turn the narration scripts into the WAVs the scenes play.

    animations/narration/<slug>.txt  ->  animations/narration/audio/<slug>-<cue>.wav

Run this on a workstation. The render never runs it: the WAVs are committed, so
CI and a fresh clone only ever read finished audio. That keeps Piper, its voice
models and their licensing out of the render path, and keeps a render
reproducible from what is in the repository.

    tools/make-narration.py                 # every script
    tools/make-narration.py pipeline        # one scene
    tools/make-narration.py --check         # verify without regenerating
    VOICE=en_US-aj7hr-medium tools/make-narration.py    # a different voice

VOICE, AND WHY IT IS THIS ONE
    The default is en_US-libritts_r-medium, the same voice tools/make-audio.sh
    uses for the male speech samples. Its corpus is LibriTTS-R (OpenSLR 141),
    CC BY 4.0, which this site can redistribute. Do NOT substitute a voice
    without reading its MODEL_CARD: several popular Piper voices carry
    non-commercial or share-alike terms that are incompatible with the CC BY
    4.0 grant on this material.

    Swapping in a voice trained on your own recordings needs no code change:
    export it to <name>.onnx alongside its .onnx.json in VOICES_DIR and set
    VOICE. Everything downstream is voice-agnostic.

REPRODUCIBILITY
    Piper is not sample-deterministic between runs, so regenerating replaces
    the audio and re-times every scene that plays it. That is why the output is
    committed rather than rebuilt per render.

MIT licensed (see LICENSE-MIT).
"""

from __future__ import annotations

import argparse
import contextlib
import os
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = ROOT / "animations" / "narration"
AUDIO_DIR = SCRIPT_DIR / "audio"

PIPER = Path(os.environ.get("PIPER", Path.home() / ".local/bin/piper"))
VOICES_DIR = Path(os.environ.get("VOICES_DIR", Path.home() / ".local/share/piper/voices"))
VOICE = os.environ.get("VOICE", "en_US-libritts_r-medium")

#: LibriTTS-R is multi-speaker. 690 is the speaker make-audio.sh settled on for
#: the male samples, so the narration matches the voice already on the site.
SPEAKER = os.environ.get("SPEAKER", "690")

#: manim mixes at 44.1 kHz. Handing it anything else means a resample inside
#: the render, which is both slower and lossier than doing it once here.
RATE = "44100"

#: Narration sits under nothing, so it can be quieter than the speech samples
#: without fighting anything. Matches the -20 dBFS the rest of the audio uses.
TARGET_DBFS = "-20"

CUE_RE = re.compile(r"^\[([a-z0-9-]+)\]\s*$")


def die(msg: str) -> None:
    print(f"\033[31merror:\033[0m {msg}", file=sys.stderr)
    raise SystemExit(1)


def parse_script(path: Path) -> list[tuple[str, str]]:
    """Read a narration script into [(cue, text), ...], preserving order."""
    cues: list[tuple[str, list[str]]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if line.lstrip().startswith("#"):
            continue
        match = CUE_RE.match(line)
        if match:
            cues.append((match.group(1), []))
            continue
        if not cues:
            if line.strip():
                die(f"{path.name}: text before the first [cue] marker: {line!r}")
            continue
        cues[-1][1].append(line)

    out = []
    for cue, lines in cues:
        # Join wrapped lines into sentences; a blank line becomes a pause,
        # which Piper renders as a longer gap than a plain space.
        text = "\n".join(lines).strip()
        text = re.sub(r"\n{2,}", "\n\n", text)
        text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)
        text = re.sub(r"[ \t]{2,}", " ", text).strip()
        if not text:
            die(f"{path.name}: cue [{cue}] has no text")
        out.append((cue, text))

    if not out:
        die(f"{path.name}: no cues found")
    dupes = {c for c, _ in out if [x for x, _ in out].count(c) > 1}
    if dupes:
        die(f"{path.name}: duplicate cue ids: {', '.join(sorted(dupes))}")
    return out


def duration(path: Path) -> float:
    with contextlib.closing(wave.open(str(path), "rb")) as handle:
        return handle.getnframes() / float(handle.getframerate())


def synthesise(text: str, out_path: Path, model: Path, tmp: Path) -> None:
    """Piper -> raw wav -> sox -> normalised, trimmed, 44.1 kHz mono."""
    raw = tmp / "raw.wav"
    # The ~/.local/bin/piper wrapper drops --output_file and writes the WAV to
    # stdout, which is also how tools/make-audio.sh drives it. Pass the flag
    # anyway for a plain piper build, and take the audio from stdout.
    cmd = [str(PIPER), "--model", str(model)]
    if SPEAKER:
        cmd += ["--speaker", SPEAKER]
    cmd += ["--output_file", "-"]
    proc = subprocess.run(
        cmd, input=text.encode("utf-8"), capture_output=True, check=False
    )
    if proc.returncode != 0:
        die(f"piper failed for {out_path.name}: {proc.stderr.decode()[:400]}")
    if not proc.stdout.startswith(b"RIFF"):
        # A wrapper that prints diagnostics instead of audio would otherwise
        # sail straight into sox and produce nonsense.
        die(f"piper output for {out_path.name} is not a RIFF/WAV stream: "
            f"{proc.stdout[:80]!r} {proc.stderr.decode()[:200]}")
    raw.write_bytes(proc.stdout)

    # Trim leading/trailing silence, then normalise. `norm` before `silence`
    # would set the level from whatever noise floor Piper emitted.
    sox = subprocess.run(
        [
            "sox", str(raw), "-r", RATE, "-c", "1", "-b", "16", str(out_path),
            "silence", "1", "0.05", "0.5%", "reverse",
            "silence", "1", "0.05", "0.5%", "reverse",
            "norm", TARGET_DBFS,
        ],
        capture_output=True, check=False,
    )
    if sox.returncode != 0 or not out_path.is_file():
        die(f"sox failed for {out_path.name}: {sox.stderr.decode()[:400]}")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Turn the narration scripts into the WAVs the scenes play."
    )
    ap.add_argument("slugs", nargs="*", help="scene slugs; default is all")
    ap.add_argument("--check", action="store_true",
                    help="report what exists and what is stale, generate nothing")
    args = ap.parse_args()

    scripts = sorted(SCRIPT_DIR.glob("*.txt"))
    if args.slugs:
        wanted = set(args.slugs)
        scripts = [p for p in scripts if p.stem in wanted]
        missing = wanted - {p.stem for p in scripts}
        if missing:
            die(f"no narration script for: {', '.join(sorted(missing))}")
    if not scripts:
        die(f"no narration scripts in {SCRIPT_DIR}")

    if not args.check:
        if not PIPER.is_file() or not os.access(PIPER, os.X_OK):
            die(f"piper not executable at {PIPER} (set PIPER=...)")
        if not shutil.which("sox"):
            die("sox not found on PATH")
        model = VOICES_DIR / f"{VOICE}.onnx"
        if not model.is_file():
            die(f"voice model not found: {model} (set VOICE=... or VOICES_DIR=...)")
        if not (VOICES_DIR / f"{VOICE}.onnx.json").is_file():
            die(f"voice config not found beside the model: {model}.json")
        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    else:
        model = VOICES_DIR / f"{VOICE}.onnx"

    tmp = AUDIO_DIR / ".tmp"
    total = 0.0
    generated = 0
    for script in scripts:
        slug = script.stem
        cues = parse_script(script)
        print(f"\033[36m==>\033[0m {slug}: {len(cues)} cues")
        for cue, text in cues:
            out_path = AUDIO_DIR / f"{slug}-{cue}.wav"
            if args.check:
                state = "ok " if out_path.is_file() else "MISSING"
                secs = duration(out_path) if out_path.is_file() else 0.0
                total += secs
                words = len(text.split())
                print(f"    {state} {cue:<14} {secs:5.1f}s  {words:>3} words")
                continue

            tmp.mkdir(parents=True, exist_ok=True)
            try:
                synthesise(text, out_path, model, tmp)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            secs = duration(out_path)
            total += secs
            generated += 1
            print(f"    \033[32mok\033[0m  {cue:<14} {secs:5.1f}s  {out_path.name}")

    print(f"\n{'checked' if args.check else 'wrote'} {generated or len(scripts)} "
          f"item(s), {total:.1f}s of narration total")
    if not args.check:
        print(f"voice: {VOICE}" + (f" (speaker {SPEAKER})" if SPEAKER else ""))
        print("Re-render the scenes: tools/render-local.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
