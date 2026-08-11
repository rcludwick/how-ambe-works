"""
narration.py — voice-over for the scenes, and the pacing that follows from it.

A scene names a cue. This module finds the matching WAV, starts it at the
current point in the timeline, and then holds the scene open until the line has
finished speaking. The narration therefore SETS THE PACE: a stage cannot run
ahead of the sentence describing it, and rewriting a line automatically
re-times the scene around it.

    nar = Narrator(self, "pipeline")

    with nar.beat("pitch"):
        self.play(Create(curve), run_time=1.6)
        self.reveal(f0, law, run_time=1.4)
    # <- holds here until the "pitch" line has finished, plus a short beat

The audio is PRE-RENDERED and committed under animations/narration/audio/.
Nothing here runs a text-to-speech engine: `tools/make-narration.py` does that
on a workstation, and the render (locally and in CI) only ever reads finished
WAV files. That keeps the CI render free of Piper, its voice models and their
licensing, and keeps a render reproducible from what is in the repository.

MISSING AUDIO IS NOT AN ERROR. A scene with no narration WAVs still renders,
silently, using each cue's `floor` as its dwell time. That matters because the
WAVs are large-ish binaries: someone should be able to clone, render, and get a
correct if silent video. Pass strict=True to turn a missing cue into a failure,
which is what CI should eventually do once the audio is committed.

MIT licensed (see LICENSE-MIT).
"""

from __future__ import annotations

import contextlib
import wave
from pathlib import Path

# animations/manim/narration.py -> animations/narration/audio
AUDIO_DIR = Path(__file__).resolve().parent.parent / "narration" / "audio"

#: Silence left after a line finishes before the next stage begins. Long enough
#: to stop the video feeling like it is talking over itself, short enough that
#: it does not read as a mistake.
DEFAULT_TAIL = 0.55


def clip_duration(path: Path) -> float:
    """Length of a PCM WAV in seconds, using only the standard library."""
    with contextlib.closing(wave.open(str(path), "rb")) as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
    return frames / float(rate) if rate else 0.0


class Narrator:
    """Ties a scene's timeline to a set of pre-rendered narration clips."""

    def __init__(self, scene, slug: str, *, strict: bool = False,
                 audio_dir: Path | None = None) -> None:
        self.scene = scene
        self.slug = slug
        self.strict = strict
        self.dir = Path(audio_dir) if audio_dir else AUDIO_DIR
        self.missing: list[str] = []
        self.spoken: list[tuple[str, float]] = []
        #: (start, end, text) for every line actually played, which is what the
        #: caption track is written from.
        self.timeline: list[tuple[float, float, str]] = []

    # -- the spoken text, for captions -------------------------------------

    def text_for(self, cue: str) -> str:
        """
        The words of a cue, read back out of the narration script.

        The script is the single source of truth for what is said. Re-deriving
        the caption from it means the captions cannot drift from the audio the
        way a hand-maintained second copy would.
        """
        script = self.dir.parent / f"{self.slug}.txt"
        if not script.is_file():
            return ""
        want, buf, collecting = f"[{cue}]", [], False
        for raw in script.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line.startswith("[") and line.endswith("]"):
                if collecting:
                    break
                collecting = line == want
                continue
            if collecting and not line.startswith("#"):
                buf.append(line)
        return " ".join(" ".join(buf).split())

    # -- lookup ------------------------------------------------------------

    def path_for(self, cue: str) -> Path:
        return self.dir / f"{self.slug}-{cue}.wav"

    def duration(self, cue: str) -> float:
        """Length of a cue's clip, or 0.0 if it has not been rendered."""
        path = self.path_for(cue)
        if not path.is_file():
            return 0.0
        try:
            return clip_duration(path)
        except (wave.Error, OSError):
            return 0.0

    # -- playback ----------------------------------------------------------

    def say(self, cue: str) -> float:
        """
        Start `cue` at the current point in the timeline.

        Returns the clip's duration, or 0.0 when there is no clip. Does not
        wait: the caller decides how much of the line to animate under.
        """
        path = self.path_for(cue)
        if not path.is_file():
            if self.strict:
                raise FileNotFoundError(f"narration cue not rendered: {path}")
            if cue not in self.missing:
                self.missing.append(cue)
            return 0.0

        seconds = self.duration(cue)
        start = self.scene.renderer.time
        self.scene.add_sound(str(path))
        self.spoken.append((cue, seconds))
        text = self.text_for(cue)
        if text:
            self.timeline.append((start, start + seconds, text))
        return seconds

    @contextlib.contextmanager
    def beat(self, cue: str, *, tail: float = DEFAULT_TAIL, floor: float = 0.0):
        """
        Run a stage under its narration line, then wait for the line to finish.

        `floor` is dwell held AFTER the animations, not a minimum length for
        the stage as a whole. That distinction matters: the animations in these
        scenes already run longer than any sensible floor, so treating it as a
        total would silently do nothing and leave the scene exactly as
        breathless as before.

        With narration, the stage instead lasts as long as its line, and never
        cuts less than `tail` after the last animation even if the line ran
        short.
        """
        seconds = self.say(cue)
        start = self.scene.renderer.time
        yield seconds
        elapsed = self.scene.renderer.time - start

        if seconds:
            remaining = max(seconds + tail - elapsed, tail)
        else:
            remaining = floor
        if remaining > 0:
            self.scene.wait(remaining)

    # -- reporting ---------------------------------------------------------

    def write_captions(self, out_dir: Path | None = None) -> Path | None:
        """
        Write a WebVTT track for what was actually spoken, and when.

        The video carries speech, so it needs a text alternative. Deriving it
        here rather than by hand means the timings come from the same clock
        that scheduled the audio, and the words come from the same script that
        was fed to the synthesiser, so the two cannot drift apart.

        Written next to the rendered video, as <slug>.vtt.
        """
        if not self.timeline:
            return None
        target = Path(out_dir) if out_dir else Path("out")
        target.mkdir(parents=True, exist_ok=True)
        path = target / f"{self.slug}.vtt"

        def stamp(seconds: float) -> str:
            ms = int(round(seconds * 1000))
            h, ms = divmod(ms, 3_600_000)
            m, ms = divmod(ms, 60_000)
            s, ms = divmod(ms, 1000)
            return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"

        lines = ["WEBVTT", ""]
        for index, (start, end, text) in enumerate(self.timeline, start=1):
            lines += [str(index), f"{stamp(start)} --> {stamp(end)}"]
            # Wrap so a long line does not cover the picture it describes.
            words, row = text.split(), ""
            for word in words:
                if len(row) + len(word) + 1 > 62:
                    lines.append(row)
                    row = word
                else:
                    row = f"{row} {word}".strip()
            if row:
                lines.append(row)
            lines.append("")
        path.write_text("\n".join(lines), encoding="utf-8")
        return path

    def report(self) -> str:
        """One line per cue, for the render log."""
        total = sum(d for _, d in self.spoken)
        parts = [f"{self.slug}: {len(self.spoken)} cues, {total:.1f}s of speech"]
        if self.missing:
            parts.append(f"MISSING: {', '.join(self.missing)}")
        return "  |  ".join(parts)
