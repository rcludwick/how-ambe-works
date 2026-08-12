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
    The default is en_US-norman-medium: LibriVox, public domain, and its
    MODEL_CARD records "Trained from scratch on medium quality settings for
    1200 epochs" rather than fine-tuned from anything. Both the corpus and the
    weights are therefore clean, which is what this site's CC BY 4.0 grant
    needs, since that grant hands every reader commercial rights.

    It is deliberately NOT en_US-libritts_r-medium, the voice used for the male
    speech samples. That corpus is CC BY 4.0, but its MODEL_CARD also says
    "fine-tuned from English lessac medium", and the Blizzard 2013 Lessac terms
    are research-only and name "licencing" among the commercial purposes they
    exclude. Whether corpus terms reach a synthesised waveform three models
    downstream is unsettled, and narration is not worth resting on an unsettled
    reading when a clean voice costs nothing.

    Swapping in a voice trained on your own recordings needs no code change:
    export it to <name>.onnx alongside its .onnx.json in VOICES_DIR and set
    VOICE. Everything downstream is voice-agnostic.

    Do NOT substitute a voice without reading its MODEL_CARD, and read the
    Training line as well as the Dataset line. The Dataset line alone will not
    tell you what the weights started from.

REPRODUCIBILITY
    Piper is not sample-deterministic between runs, so regenerating replaces
    the audio and re-times every scene that plays it. That is why the output is
    committed rather than rebuilt per render.

MIT licensed (see LICENSE-MIT).
"""

from __future__ import annotations

import argparse
import contextlib
import math
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
VOICE = os.environ.get("VOICE", "en_US-norman-medium")

#: norman is single-speaker, so no speaker index is passed. Set SPEAKER for a
#: multi-speaker model.
SPEAKER = os.environ.get("SPEAKER", "")

#: manim mixes at 44.1 kHz. Handing it anything else means a resample inside
#: the render, which is both slower and lossier than doing it once here.
RATE = "44100"

#: Level normalisation, matching tools/make-audio.sh and SCHEMA.md exactly:
#: a single constant gain that puts RMS on TARGET_RMS_DB, unless that would
#: push the peak above PEAK_CEIL_DB, in which case the ceiling wins. No
#: compression, no limiting, no EQ.
#:
#: Note this is RMS, not peak. `sox norm -20` sets the PEAK to -20 dBFS, which
#: is about 19 dB quieter than intended and was the first thing this script
#: got wrong.
TARGET_RMS_DB = -20.0
PEAK_CEIL_DB = -1.0

#: Silence inserted between sentences, and between paragraphs.
#:
#: Piper synthesises a whole cue in one pass and puts its own short pause at a
#: full stop, which is tighter than a person reading aloud to camera. Each
#: sentence is therefore synthesised on its own, trimmed, and rejoined with a
#: measured gap. That also makes the pacing a number in this file rather than a
#: property of the voice model.
#:
#: Raising these makes the videos longer. Every scene holds a stage open until
#: its line has finished, so the gaps are real screen time and not just air.
#:
#: Measured for calibration rather than picked: Piper's own pause at a full
#: stop runs 0.23 to 0.29 s. A gap set near that is indistinguishable from
#: doing nothing, which is what the first attempt at this was. These are about
#: double it, which is audibly more room to follow a sentence before the next
#: one starts, without the delivery going slack.
SENTENCE_GAP_S = 0.50
PARAGRAPH_GAP_S = 0.85

#: Splits on a full stop, question mark or exclamation followed by a space and
#: something that starts a sentence. It deliberately will not split "8 kHz." in
#: mid-line or a decimal, because those are not followed by a capital.
SENTENCE_RE = re.compile(r'(?<=[.!?])\s+(?=[A-Z"“])')

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


def gain_for(path: Path, label: str) -> float:
    """
    The single constant gain that lands RMS on target without clipping.

    `sox -n stat` reports linear amplitudes on stderr. Whichever of the two
    constraints binds first wins, which for speech is almost always the RMS
    target: narration has a high crest factor, so its peak reaches the ceiling
    well before its RMS gets loud.
    """
    proc = subprocess.run(
        ["sox", str(path), "-n", "stat"], capture_output=True, check=False
    )
    stats = {}
    for line in proc.stderr.decode().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            try:
                stats[key.strip()] = float(value.strip())
            except ValueError:
                pass

    rms = stats.get("RMS     amplitude") or stats.get("RMS amplitude") or 0.0
    peak = stats.get("Maximum amplitude") or 0.0
    if rms <= 0 or peak <= 0:
        die(f"could not measure levels for {label}: {proc.stderr.decode()[:300]}")

    rms_db = 20 * math.log10(rms)
    peak_db = 20 * math.log10(peak)
    return min(TARGET_RMS_DB - rms_db, PEAK_CEIL_DB - peak_db)


def segments(text: str) -> list[tuple[str, float]]:
    """
    Split a cue into (sentence, gap_after_seconds).

    Paragraphs are separated by a blank line in the script and get the longer
    gap. The last segment gets no gap: trailing silence is the scene's business,
    not this file's, and narration.py already holds a tail after each line.
    """
    out: list[tuple[str, float]] = []
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    for pi, paragraph in enumerate(paragraphs):
        sentences = [s.strip() for s in SENTENCE_RE.split(paragraph) if s.strip()]
        for si, sentence in enumerate(sentences):
            last_in_paragraph = si == len(sentences) - 1
            last_overall = last_in_paragraph and pi == len(paragraphs) - 1
            if last_overall:
                gap = 0.0
            elif last_in_paragraph:
                gap = PARAGRAPH_GAP_S
            else:
                gap = SENTENCE_GAP_S
            out.append((sentence, gap))
    return out


def speak(text: str, model: Path, dest: Path, label: str) -> None:
    """One sentence: Piper -> 44.1 kHz mono, trimmed of silence at both ends."""
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
        die(f"piper failed for {label}: {proc.stderr.decode()[:400]}")
    if not proc.stdout.startswith(b"RIFF"):
        # A wrapper that prints diagnostics instead of audio would otherwise
        # sail straight into sox and produce nonsense.
        die(f"piper output for {label} is not a RIFF/WAV stream: "
            f"{proc.stdout[:80]!r} {proc.stderr.decode()[:200]}")
    raw = dest.with_suffix(".raw.wav")
    raw.write_bytes(proc.stdout)

    # Trim each sentence's own silence, so the gap between sentences is the one
    # set above rather than that plus whatever Piper left on the ends.
    sox = subprocess.run(
        [
            "sox", str(raw), "-r", RATE, "-c", "1", "-b", "16", str(dest),
            "silence", "1", "0.05", "0.5%", "reverse",
            "silence", "1", "0.05", "0.5%", "reverse",
        ],
        capture_output=True, check=False,
    )
    raw.unlink(missing_ok=True)
    if sox.returncode != 0 or not dest.is_file():
        die(f"sox trim failed for {label}: {sox.stderr.decode()[:400]}")


def synthesise(text: str, out_path: Path, model: Path, tmp: Path) -> None:
    """Sentence at a time, rejoined with measured gaps, then levelled once."""
    parts = segments(text)
    if not parts:
        die(f"no sentences in the text for {out_path.name}")

    pieces: list[Path] = []
    for i, (sentence, gap) in enumerate(parts):
        piece = tmp / f"s{i:02d}.wav"
        speak(sentence, model, piece, f"{out_path.name} sentence {i + 1}")
        pieces.append(piece)
        if gap > 0:
            silence = tmp / f"g{i:02d}.wav"
            sox = subprocess.run(
                ["sox", "-n", "-r", RATE, "-c", "1", "-b", "16", str(silence),
                 "trim", "0.0", f"{gap:.3f}"],
                capture_output=True, check=False,
            )
            if sox.returncode != 0 or not silence.is_file():
                die(f"sox could not make a {gap}s gap: {sox.stderr.decode()[:300]}")
            pieces.append(silence)

    joined = tmp / "joined.wav"
    sox = subprocess.run(
        ["sox", *[str(p) for p in pieces], str(joined)],
        capture_output=True, check=False,
    )
    if sox.returncode != 0 or not joined.is_file():
        die(f"sox concat failed for {out_path.name}: {sox.stderr.decode()[:400]}")

    # One gain for the whole cue, not one per sentence. Levelling each sentence
    # on its own would flatten the delivery, making a quiet clause as loud as
    # an emphatic one.
    gain_db = gain_for(joined, out_path.name)
    sox = subprocess.run(
        ["sox", str(joined), str(out_path), "gain", f"{gain_db:.3f}"],
        capture_output=True, check=False,
    )
    if sox.returncode != 0 or not out_path.is_file():
        die(f"sox gain failed for {out_path.name}: {sox.stderr.decode()[:400]}")


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
