"""Scene slug: "harmonic-sum"  ->  rendered as HarmonicSum.mp4 / .webm

Builds a voiced speech frame one harmonic at a time. Each sinusoid is drawn
on its own, added to a running sum, and its line appears in the spectrum
alongside — so the reader watches a recognisable glottal pulse assemble out
of a couple of dozen numbers.

DATA READ (all precomputed / measured — this file performs no AMBE analysis
or synthesis, it only draws numbers that already exist on disk):

  docs/assets/data/norman-b/spectra.json   per-frame magnitude spectrum, dBFS
  docs/assets/data/norman-b/frames.json    per-frame derived pitch estimate
  docs/assets/audio/norman-b-original.wav  PCM samples, plotted as a waveform

Frame 121 (t = 2.42 s) of the featured hardware capture was chosen because
it is strongly voiced across the whole 0-4 kHz band: all eight measured
bands score above 0.7, and all 22 harmonics below 4 kHz sit within 25 dB of
the strongest one, so every one of them is visible on a linear plot.

WHAT IS DRAWN, AND HOW HONEST IT IS:

  * The harmonic amplitudes are read straight off the measured spectrum —
    the largest bin within +/-2 bins of k*f0. Harmonics are ~5.7 bins apart
    here, so those windows never overlap.
  * The running sum is a plain sum of cosines at those amplitudes. That is
    display arithmetic, the same kind of thing as drawing a sine wave; it is
    not an MBE synthesizer, and no MBE synthesizer is implemented here.
  * PHASE IS NOT IN THE DATA and is not in the transmitted frame either:
    "any phase information between the encoder and the decoder" is not sent
    (US 5,701,390), so a real decoder regenerates it. The sum here uses zero
    phase for every harmonic, which is why it draws the classic symmetric
    pulse. The scene says so on screen rather than implying the recording
    looked like this.

CONTROLS: none — this is a linear video. The interactive versions of these
figures are the canvas animations in docs/javascripts/.

TEXT RENDERING: Pango only (Text / MarkupText). Nothing here needs a LaTeX
install, and nothing here may grow one: the render workflow greps the scene
sources and fails the build if a LaTeX-backed mobject class shows up.

RENDER: uvx --from manim manim -qm animations/manim/scene_harmonic_sum.py HarmonicSum
"""

from __future__ import annotations

import json
import os
import wave
from pathlib import Path

import numpy as np
from manim import (
    BOLD,
    DOWN,
    LEFT,
    RIGHT,
    UP,
    Axes,
    Create,
    FadeIn,
    FadeOut,
    Line,
    Rectangle,
    Scene,
    Text,
    Transform,
    VGroup,
    VMobject,
    config,
)

# --------------------------------------------------------------------------
# Output format. 1920x1080 at 30 fps, set here rather than left to the CLI so
# every render of this scene is identical. Set AMBE_ANIM_PREVIEW=1 to let the
# -q flag win while iterating.
# --------------------------------------------------------------------------
if not os.environ.get("AMBE_ANIM_PREVIEW"):
    config.pixel_width = 1920
    config.pixel_height = 1080
    config.frame_rate = 30

# --------------------------------------------------------------------------
# Palette — the dark scheme from docs/stylesheets/extra.css, verbatim.
# --------------------------------------------------------------------------
BG = "#0c0d10"          # --ambe-bg
PLOT_BG = "#0f1015"     # --ambe-plot-bg
AXIS = "#4a4b55"        # --ambe-plot-axis, flattened onto the plot ground
MUTED = "#7c7e8a"       # --ambe-plot-muted / --ambe-data-4
TEXT = "#f2f2f7"        # --ambe-text
TEXT_2 = "#c3c4cd"      # --ambe-text-2
TEXT_3 = "#8d8f9b"      # --ambe-text-3
ACCENT = "#7d8cff"      # --ambe-accent   (indigo) — the measured signal
WARM = "#ffb454"        # --ambe-accent-warm (amber) — the harmonic being added
COOL = "#3ddbc0"        # --ambe-accent-cool (teal) — the running sum

config.background_color = BG


def _pick_font(candidates: list[str], fallback: str) -> str:
    """First installed family from `candidates`.

    macOS and the Linux render runner ship different fonts; resolving at
    runtime keeps the render quiet on both instead of warning per Text().
    """
    try:
        import manimpango

        installed = set(manimpango.list_fonts())
    except Exception:  # pragma: no cover - font listing is best-effort
        return fallback
    for name in candidates:
        if name in installed:
            return name
    return fallback


FONT = _pick_font(
    ["Inter", "SF Pro Text", "Helvetica Neue", "Helvetica", "DejaVu Sans", "Arial"],
    "sans-serif",
)
MONO = _pick_font(
    ["SF Mono", "Menlo", "DejaVu Sans Mono", "Liberation Mono", "Courier New"],
    "monospace",
)

# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "docs" / "assets" / "data"
AUDIO = ROOT / "docs" / "assets" / "audio"

CLIP = "lj-b"
FRAME = 74           # t = 1.48 s; every band voiced, 23 harmonics below 4 kHz
SAMPLE_RATE = 8000
FRAME_SAMPLES = 160  # 20 ms


def load_json(name: str):
    with open(DATA / CLIP / name, encoding="utf-8") as handle:
        return json.load(handle)


def load_pcm(path: Path) -> np.ndarray:
    """Read a mono 16-bit WAV as float samples in -1..+1. Plotting only."""
    with wave.open(str(path), "rb") as wav:
        raw = wav.readframes(wav.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0


FRAMES = load_json("frames.json")
SPECTRA = load_json("spectra.json")
PCM = load_pcm(AUDIO / f"{CLIP}-original.wav")

DERIVED = FRAMES["frames"][FRAME]["derived"]
FRAME_T = FRAMES["frames"][FRAME]["t"]
F0 = DERIVED["orig_f0_hz"]
PERIOD_MS = 1000.0 / F0

BIN_HZ = SPECTRA["bin_hz"]
BIN_CENTRES = np.asarray(SPECTRA["bin_centre_hz"], dtype=np.float64)
SPECTRUM = np.asarray(SPECTRA["original"][FRAME], dtype=np.float64)

N_HARMONICS = int(3950 // F0)
HIGHLIGHT_COUNT = 6      # harmonics added one slow step at a time
GLIMPSE_COUNT = 8        # "a handful" — the ghost comparison at the end


def harmonic_level_db(k: int) -> float:
    """Peak level of the k-th harmonic, read off the measured spectrum.

    Generic display maths: the largest bin within +/-2 bins of k*f0. Nothing
    is estimated or reconstructed — the number is already in spectra.json.
    """
    centre = int(round(k * F0 / BIN_HZ))
    lo = max(0, centre - 2)
    hi = min(len(SPECTRUM), centre + 3)
    return float(SPECTRUM[lo:hi].max())


HARMONIC_DB = np.array([harmonic_level_db(k) for k in range(1, N_HARMONICS + 1)])
# Linear amplitudes, normalised so the strongest harmonic is 1.0.
HARMONIC_AMP = 10.0 ** ((HARMONIC_DB - HARMONIC_DB.max()) / 20.0)

DB_TOP = 5.0 * np.ceil(SPECTRUM.max() / 5.0) + 5.0
DB_BOTTOM = DB_TOP - 90.0

# Two pitch periods of time, in milliseconds, at 600 drawing points.
SPAN_MS = 2.0 * PERIOD_MS
TIME_MS = np.linspace(0.0, SPAN_MS, 600)


def partial_sum(count: int) -> np.ndarray:
    """Sum of the first `count` harmonics at zero phase. Display arithmetic."""
    total = np.zeros_like(TIME_MS)
    for index in range(count):
        total += HARMONIC_AMP[index] * np.cos(
            2.0 * np.pi * (index + 1) * F0 * TIME_MS / 1000.0
        )
    return total


FULL_SUM = partial_sum(N_HARMONICS)
SUM_SCALE = float(np.abs(FULL_SUM).max()) or 1.0


# --------------------------------------------------------------------------
# Small drawing helpers
# --------------------------------------------------------------------------
def curve(axes: Axes, xs, ys, color: str, width: float = 3.0, opacity: float = 1.0) -> VMobject:
    mob = VMobject(stroke_color=color, stroke_width=width)
    mob.set_points_as_corners([axes.c2p(x, y) for x, y in zip(xs, ys)])
    mob.set_stroke(opacity=opacity)
    mob.set_fill(opacity=0)
    return mob


def label(text: str, size: int = 22, color: str = TEXT_2, mono: bool = False, weight=None) -> Text:
    """A Text mobject in the site's type palette.

    Small sizes are laid out at 2x and scaled down: Pango's hinting eats
    inter-word spacing below ~24 pt, and the scaled version keeps captions
    legible.
    """
    build_size, shrink = (size * 2, 0.5) if size < 24 else (size, 1.0)
    kwargs = {"font": MONO if mono else FONT, "font_size": build_size, "color": color}
    if weight is not None:
        kwargs["weight"] = weight
    mob = Text(text, **kwargs)
    if shrink != 1.0:
        mob.scale(shrink)
    return mob


def plot_panel(axes: Axes, pad: float = 0.3) -> Rectangle:
    rect = Rectangle(
        width=axes.width + 2 * pad,
        height=axes.height + 2 * pad,
        stroke_width=0,
        fill_color=PLOT_BG,
        fill_opacity=1.0,
    )
    rect.move_to(axes)
    return rect


def panel_tag(
    text: str,
    panel: Rectangle,
    color: str = TEXT_3,
    size: int = 19,
    right: bool = False,
    dy: float = 0.22,
) -> Text:
    """A caption tucked inside the top corner of a plot panel.

    Keeping captions inside their panel is what stops the stacked plots in
    this scene from crowding the title block. `dy` clears the top rule on
    panels whose x-axis is drawn along the top (any plot whose y range does
    not straddle zero, e.g. a dBFS plot).
    """
    tag = label(text, size=size, color=color)
    if right:
        tag.align_to(panel, RIGHT).shift(LEFT * 0.34)
    else:
        tag.align_to(panel, LEFT).shift(RIGHT * 0.34)
    tag.align_to(panel, UP).shift(DOWN * dy)
    return tag


def x_tick_labels(axes: Axes, values, fmt, size: int = 18, color: str = TEXT_3) -> VGroup:
    group = VGroup()
    y0 = axes.y_range[0]
    for value in values:
        tick = label(fmt(value), size=size, color=color, mono=True)
        tick.next_to(axes.c2p(value, y0), DOWN, buff=0.16)
        group.add(tick)
    return group


class HarmonicSum(Scene):
    """~42 s. One harmonic at a time until the glottal pulse comes back."""

    def construct(self):
        self.footer = None
        self.title = None

        self.beat_title()
        self.beat_measured()
        self.beat_build()
        self.beat_handful()
        self.beat_close()

    # -- chrome ------------------------------------------------------------
    def set_footer(self, left: str, right: str = "", run_time: float = 0.4):
        group = VGroup()
        left_text = label(left, size=17, color=TEXT_3)
        left_text.to_edge(LEFT, buff=0.75).to_edge(DOWN, buff=0.32)
        group.add(left_text)
        if right:
            right_text = label(right, size=17, color=MUTED)
            right_text.to_edge(RIGHT, buff=0.75).to_edge(DOWN, buff=0.32)
            group.add(right_text)
        if self.footer is not None:
            self.play(FadeOut(self.footer, run_time=run_time * 0.6))
        self.footer = group
        self.play(FadeIn(group, run_time=run_time))

    def set_title(self, heading: str, sub: str = "", run_time: float = 0.6):
        group = VGroup()
        head = label(heading, size=34, color=TEXT, weight=BOLD)
        group.add(head)
        if sub:
            sub_text = label(sub, size=22, color=TEXT_3)
            sub_text.next_to(head, DOWN, buff=0.18, aligned_edge=LEFT)
            group.add(sub_text)
        group.to_edge(LEFT, buff=0.75).to_edge(UP, buff=0.45)
        if self.title is not None:
            self.play(FadeOut(self.title, shift=UP * 0.12, run_time=run_time * 0.6))
        self.title = group
        self.play(FadeIn(group, shift=DOWN * 0.12, run_time=run_time))

    # -- beats -------------------------------------------------------------
    def beat_title(self):
        """0:00 - 0:04"""
        kicker = label("HARMONICS", size=20, color=WARM, mono=True)
        head = label("A voice is a stack", size=56, color=TEXT, weight=BOLD)
        head2 = label("of sine waves.", size=56, color=TEXT, weight=BOLD)
        sub = label(
            f"{N_HARMONICS} amplitudes, all on multiples of one {F0:.0f} Hz fundamental.",
            size=24,
            color=TEXT_3,
        )
        head.next_to(kicker, DOWN, buff=0.45)
        head2.next_to(head, DOWN, buff=0.14)
        sub.next_to(head2, DOWN, buff=0.5)
        group = VGroup(kicker, head, head2, sub).move_to([0, 0.3, 0])

        self.play(FadeIn(kicker, run_time=0.5))
        self.play(FadeIn(head, shift=UP * 0.15, run_time=0.5))
        self.play(FadeIn(head2, shift=UP * 0.15, run_time=0.5))
        self.play(FadeIn(sub, run_time=0.6))
        self.wait(1.3)
        self.play(FadeOut(group, run_time=0.5))

    def beat_measured(self):
        """0:04 - 0:12  what was recorded, and where its peaks sit."""
        self.set_title(
            "This is the frame we measured.",
            f"clip {CLIP}, frame {FRAME} at t = {FRAME_T:.2f} s — strongly voiced in every band",
        )
        self.set_footer(
            "spectra.json · 256-point FFT, Hann window, centred on the frame",
            "derived from the audio, not from the codec",
        )

        # Top: the recording itself, at sample resolution.
        span = FRAME_SAMPLES
        start = FRAME * FRAME_SAMPLES
        seg = PCM[start : start + span]
        seg_ms = np.arange(span) * 1000.0 / SAMPLE_RATE
        peak = float(np.abs(seg).max()) or 1.0

        wave_axes = Axes(
            x_range=[0, seg_ms[-1], 5],
            y_range=[-1.15, 1.15, 0.5],
            x_length=11.6,
            y_length=1.9,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": True},
        ).move_to([0.2, 1.25, 0])
        wave_panel = plot_panel(wave_axes)
        wave_curve = curve(wave_axes, seg_ms, seg / peak, ACCENT, width=2.4)
        wave_tag = panel_tag("20 ms of recorded speech", wave_panel)

        self.play(FadeIn(wave_panel, run_time=0.4), Create(wave_axes, run_time=0.5))
        self.play(Create(wave_curve, run_time=1.2), FadeIn(wave_tag, run_time=0.4))

        # Bottom: its spectrum, with the harmonic grid called out.
        spec_axes = Axes(
            x_range=[0, 4000, 500],
            y_range=[DB_BOTTOM, DB_TOP, 20],
            x_length=11.6,
            y_length=2.1,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": True},
        ).move_to([0.2, -1.75, 0])
        spec_panel = plot_panel(spec_axes)
        spec_curve = curve(spec_axes, BIN_CENTRES, SPECTRUM, MUTED, width=2.0, opacity=0.75)
        spec_ticks = x_tick_labels(
            spec_axes, range(0, 4001, 500), lambda v: "0" if v == 0 else f"{v / 1000:g}k"
        )
        spec_tag = label("dBFS", size=19, color=TEXT_3).rotate(np.pi / 2)
        spec_tag.next_to(spec_panel, LEFT, buff=0.1)

        self.play(FadeIn(spec_panel, run_time=0.4), Create(spec_axes, run_time=0.5))
        self.play(
            Create(spec_curve, run_time=1.1),
            FadeIn(spec_ticks, run_time=0.5),
            FadeIn(spec_tag, run_time=0.4),
        )

        note = panel_tag(
            f"every peak lands on a multiple of {F0:.0f} Hz",
            spec_panel,
            color=WARM,
            size=21,
            right=True,
            dy=0.52,
        )
        self.play(FadeIn(note, run_time=0.5))
        self.wait(1.6)

        self.measured_group = VGroup(
            wave_panel, wave_axes, wave_curve, wave_tag, spec_tag, note
        )
        self.spec_axes = spec_axes
        self.spec_panel = spec_panel
        self.spec_curve = spec_curve
        self.spec_ticks = spec_ticks

    def beat_build(self):
        """0:12 - 0:34  one harmonic at a time into a running sum."""
        self.play(FadeOut(self.measured_group, run_time=0.6))
        self.set_title(
            "Add them back, one at a time.",
            "left: the harmonic being added · right: everything so far",
        )
        self.set_footer(
            "amplitudes read off the measured spectrum · phase is not transmitted",
            "US 5,701,390",
        )

        # Re-lay the spectrum as a short wide strip along the bottom.
        target_axes = Axes(
            x_range=[0, 4000, 500],
            y_range=[DB_BOTTOM, DB_TOP, 20],
            x_length=11.6,
            y_length=1.6,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": True},
        ).move_to([0.2, -2.35, 0])
        target_panel = plot_panel(target_axes)
        target_curve = curve(target_axes, BIN_CENTRES, SPECTRUM, MUTED, width=2.0, opacity=0.45)
        # The strip is too short to carry tick labels without the stems
        # colliding with them; its caption states the range instead.
        self.play(
            Transform(self.spec_panel, target_panel),
            Transform(self.spec_axes, target_axes),
            Transform(self.spec_curve, target_curve),
            FadeOut(self.spec_ticks),
            run_time=0.9,
        )
        spec_axes = target_axes  # geometry to draw stems against

        strip_tag = label(
            "0 – 4 kHz · one line per harmonic, at the measured level", size=19, color=TEXT_3
        )
        strip_tag.next_to(target_panel, UP, buff=0.12).align_to(target_panel, LEFT)
        strip_tag.shift(RIGHT * 0.34)

        # Left: the harmonic on its own. Right: the running sum.
        one_axes = Axes(
            x_range=[0, SPAN_MS, PERIOD_MS],
            y_range=[-1.15, 1.15, 0.5],
            x_length=3.8,
            y_length=2.1,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": False},
        ).move_to([-4.4, 1.25, 0])
        sum_axes = Axes(
            x_range=[0, SPAN_MS, PERIOD_MS],
            y_range=[-1.15, 1.15, 0.5],
            x_length=6.6,
            y_length=2.1,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": False},
        ).move_to([2.2, 1.25, 0])
        one_panel = plot_panel(one_axes)
        sum_panel = plot_panel(sum_axes)

        one_tag = panel_tag("the harmonic on its own", one_panel, color=WARM)
        sum_tag = panel_tag("everything so far, added up", sum_panel, color=COOL)
        span_tag = label(f"two pitch periods · {SPAN_MS:.1f} ms", size=17, color=TEXT_3)
        span_tag.next_to(sum_panel, DOWN, buff=0.2)

        counter = label("harmonic 1", size=26, color=TEXT, mono=True)
        counter.next_to(one_panel, DOWN, buff=0.2)

        self.play(
            FadeIn(VGroup(one_panel, sum_panel), run_time=0.4),
            Create(VGroup(one_axes, sum_axes), run_time=0.5),
            FadeIn(VGroup(one_tag, sum_tag, span_tag, strip_tag), run_time=0.4),
        )

        stems = VGroup()
        one_curve = None
        sum_curve = None

        def stem_for(index: int) -> VGroup:
            freq = (index + 1) * F0
            level = HARMONIC_DB[index]
            line = Line(
                spec_axes.c2p(freq, DB_BOTTOM),
                spec_axes.c2p(freq, level),
                stroke_color=COOL,
                stroke_width=4.0,
            )
            cap = Line(
                spec_axes.c2p(freq - 22, level),
                spec_axes.c2p(freq + 22, level),
                stroke_color=COOL,
                stroke_width=4.0,
            )
            return VGroup(line, cap)

        def single(index: int) -> np.ndarray:
            return HARMONIC_AMP[index] * np.cos(
                2.0 * np.pi * (index + 1) * F0 * TIME_MS / 1000.0
            )

        amp_scale = float(HARMONIC_AMP.max())

        for index in range(N_HARMONICS):
            target_one = curve(one_axes, TIME_MS, single(index) / amp_scale, WARM, width=2.6)
            target_sum = curve(sum_axes, TIME_MS, partial_sum(index + 1) / SUM_SCALE, COOL, width=3.0)
            target_counter = label(f"harmonic {index + 1}", size=26, color=TEXT, mono=True)
            target_counter.move_to(counter)
            stem = stem_for(index)
            stems.add(stem)

            if index == 0:
                one_curve, sum_curve = target_one, target_sum
                self.play(Create(one_curve, run_time=0.7), FadeIn(counter, run_time=0.4))
                self.play(Create(sum_curve, run_time=0.7), Create(stem, run_time=0.7))
                self.wait(0.7)
            elif index < HIGHLIGHT_COUNT:
                # Transform mutates the on-screen mobject in place; the target
                # objects are only ever used as shapes to morph towards.
                self.play(
                    Transform(one_curve, target_one),
                    Transform(counter, target_counter),
                    run_time=0.4,
                )
                self.play(
                    Transform(sum_curve, target_sum),
                    Create(stem),
                    run_time=0.5,
                )
                self.wait(0.4)
            else:
                self.play(
                    Transform(one_curve, target_one),
                    Transform(sum_curve, target_sum),
                    Transform(counter, target_counter),
                    Create(stem),
                    run_time=0.26,
                )

        self.play(FadeOut(one_curve, run_time=0.4), FadeOut(one_tag, run_time=0.4))
        done = label(f"all {N_HARMONICS} harmonics", size=26, color=COOL, mono=True)
        done.move_to(counter)
        self.play(Transform(counter, done), run_time=0.4)
        self.wait(1.2)

        self.one_group = VGroup(one_panel, one_axes, counter)
        self.sum_axes = sum_axes
        self.sum_panel = sum_panel
        self.sum_curve = sum_curve
        self.sum_chrome = VGroup(sum_tag, span_tag)
        self.strip_tag = strip_tag
        self.stems = stems

    def beat_handful(self):
        """0:34 - 0:42  eight of them already have the shape."""
        self.set_title(
            "Most of the shape is in the first few.",
            f"the amber curve is only {GLIMPSE_COUNT} harmonics — out of {N_HARMONICS}",
        )
        self.play(FadeOut(self.one_group, run_time=0.5))

        wide_axes = Axes(
            x_range=[0, SPAN_MS, PERIOD_MS],
            y_range=[-1.15, 1.15, 0.5],
            x_length=10.6,
            y_length=2.4,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": False},
        ).move_to([0.2, 1.25, 0])
        wide_panel = plot_panel(wide_axes)
        wide_sum = curve(wide_axes, TIME_MS, FULL_SUM / SUM_SCALE, COOL, width=3.2)
        self.play(
            Transform(self.sum_panel, wide_panel),
            Transform(self.sum_axes, wide_axes),
            Transform(self.sum_curve, wide_sum),
            FadeOut(self.sum_chrome, run_time=0.5),
            run_time=0.8,
        )

        few = partial_sum(GLIMPSE_COUNT)
        few_curve = curve(wide_axes, TIME_MS, few / SUM_SCALE, WARM, width=2.6)
        few_curve.set_stroke(opacity=0.95)

        legend = VGroup(
            VGroup(
                Line(LEFT * 0.16, RIGHT * 0.16, stroke_color=COOL, stroke_width=4),
                label(f"{N_HARMONICS} harmonics", size=20, color=TEXT_2),
            ).arrange(RIGHT, buff=0.2),
            VGroup(
                Line(LEFT * 0.16, RIGHT * 0.16, stroke_color=WARM, stroke_width=4),
                label(f"first {GLIMPSE_COUNT} only", size=20, color=TEXT_2),
            ).arrange(RIGHT, buff=0.2),
        ).arrange(RIGHT, buff=0.8)
        legend.align_to(wide_panel, UP).shift(DOWN * 0.24)
        legend.set_x(wide_panel.get_center()[0])

        self.play(Create(few_curve, run_time=1.2), FadeIn(legend, run_time=0.5))

        pulse_note = label(
            "one pulse per pitch period — the glottal pulse, back from a list of amplitudes",
            size=21,
            color=TEXT_2,
        )
        pulse_note.next_to(wide_panel, DOWN, buff=0.24)
        self.play(FadeIn(pulse_note, run_time=0.5))
        self.wait(2.2)

        self.handful_group = VGroup(few_curve, legend, pulse_note)

    def beat_close(self):
        """0:42 - end"""
        self.set_footer(
            "the frame carries no phase at all — the decoder regenerates it",
            "US 5,701,390",
        )
        self.wait(1.4)
        self.play(
            FadeOut(
                VGroup(
                    self.handful_group,
                    self.strip_tag,
                    self.sum_curve,
                    self.sum_axes,
                    self.sum_panel,
                    self.stems,
                    self.spec_curve,
                    self.spec_axes,
                    self.spec_panel,
                ),
                run_time=0.8,
            ),
            FadeOut(self.title, run_time=0.6),
        )
        self.title = None

        line1 = label("A handful of amplitudes.", size=44, color=COOL, weight=BOLD)
        line2 = label("A recognisable voice.", size=44, color=TEXT, weight=BOLD)
        line3 = label(
            "That is the whole bet AMBE makes, fifty times a second.",
            size=28,
            color=TEXT_2,
        )
        line2.next_to(line1, DOWN, buff=0.22)
        line3.next_to(line2, DOWN, buff=0.55)
        group = VGroup(line1, line2, line3).move_to([0, 0.35, 0])

        self.play(FadeIn(line1, shift=UP * 0.12, run_time=0.6))
        self.play(FadeIn(line2, shift=UP * 0.12, run_time=0.6))
        self.play(FadeIn(line3, run_time=0.6))
        self.wait(2.2)
        self.play(FadeOut(group, run_time=0.7), FadeOut(self.footer, run_time=0.7))
        self.wait(0.4)
