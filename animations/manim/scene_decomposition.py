"""Scene slug: "decomposition"  ->  rendered as Decomposition.mp4 / .webm

The site's opening statement of what "multi-band excitation" means: a real
speech waveform, its measured spectrum, that spectrum cut into frequency
bands, each band independently called voiced or unvoiced, and the model
reassembled as harmonics-plus-noise.

DATA READ (all precomputed / measured — this file performs no AMBE analysis
or synthesis, it only draws numbers that already exist on disk):

  docs/assets/data/lr-b/waveform.json  2.5 ms min/max envelope of the clip
  docs/assets/data/lr-b/spectra.json   per-frame magnitude spectrum, dBFS
  docs/assets/data/lr-b/frames.json    per-frame derived pitch + band voicing
  docs/assets/audio/lr-b-original.wav  PCM samples, plotted as a waveform

The clip is a real DVSI AMBE-3000 hardware capture (see
docs/assets/data/SCHEMA.md). Frame 35 (t = 0.70 s) was chosen because its
measured band-voicing strengths split cleanly: the lower six bands score
0.55 to 0.89 and read as periodic, the top two score 0.22 and 0.12 and do
not. Rebuilding the capture changes the waveform, so re-pick a frame meeting
that description whenever it is rebuilt.

PROVENANCE, stated on screen as well as here: the 72 channel bits are the
only thing the hardware reports. The spectrum, the fundamental and the
per-band voicing strengths drawn here are ordinary DSP measured off the
audio by tools/make-data.py — they are not codec fields, and the chip has no
packet that would report codec fields. The eight 500 Hz bands are the
measurement's bands; the MBE model proper uses "a large number of frequency
bands (typically 20 or more)" (Griffin & Lim 1988, sec. II).

CONTROLS: none — this is a linear video. The interactive, draggable versions
of these figures are the canvas animations in docs/javascripts/.

TEXT RENDERING: Pango only (Text / MarkupText). Nothing here needs a LaTeX
install, and nothing here may grow one: the render workflow greps the scene
sources and fails the build if a LaTeX-backed mobject class shows up.

RENDER: uvx --from manim manim -qm animations/manim/scene_decomposition.py Decomposition
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
    DashedLine,
    FadeIn,
    FadeOut,
    Line,
    Rectangle,
    Scene,
    Text,
    VGroup,
    VMobject,
    config,
    rate_functions,
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
SURFACE_2 = "#1a1c22"   # --ambe-surface-2
PLOT_BG = "#0f1015"     # --ambe-plot-bg
GRID = "#1e1f26"        # --ambe-plot-grid, flattened onto the plot ground
AXIS = "#4a4b55"        # --ambe-plot-axis, flattened
INK = "#e9e9f0"         # --ambe-plot-ink
MUTED = "#7c7e8a"       # --ambe-plot-muted / --ambe-data-4
TEXT = "#f2f2f7"        # --ambe-text
TEXT_2 = "#c3c4cd"      # --ambe-text-2
TEXT_3 = "#8d8f9b"      # --ambe-text-3
ACCENT = "#7d8cff"      # --ambe-accent   (indigo)  — the measured signal
WARM = "#ffb454"        # --ambe-accent-warm (amber) — noise / unvoiced
COOL = "#3ddbc0"        # --ambe-accent-cool (teal)  — harmonics / voiced

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


# Mirrors --ambe-font-sans / --ambe-font-mono as closely as the render host allows.
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

CLIP = "lr-b"
FRAME = 35           # t = 0.70 s; six voiced bands, top two unvoiced
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
WAVEFORM = load_json("waveform.json")
PCM = load_pcm(AUDIO / f"{CLIP}-original.wav")

CLIP_TEXT = FRAMES["clip"]["text"]
DURATION_S = FRAMES["clip"]["duration_s"]
FRAME_COUNT = FRAMES["clip"]["frame_count"]

DERIVED = FRAMES["frames"][FRAME]["derived"]
FRAME_T = FRAMES["frames"][FRAME]["t"]
FRAME_HEX = FRAMES["frames"][FRAME]["hex"]
F0 = DERIVED["orig_f0_hz"]
BAND_VOICING = DERIVED["band_voicing"]
BAND_VOICED = DERIVED["band_voiced"]
BAND_EDGES = FRAMES["derived_notes"]["band_edges_hz"]
VOICING_THRESHOLD = 0.55  # SCHEMA.md: band_voiced[b] is band_voicing[b] >= 0.55

BIN_HZ = SPECTRA["bin_hz"]
BIN_HZ_CENTRES = np.asarray(SPECTRA["bin_centre_hz"], dtype=np.float64)
SPECTRUM = np.asarray(SPECTRA["original"][FRAME], dtype=np.float64)

# Plot range for the spectrum, snapped to 5 dB and derived from the data.
DB_TOP = 5.0 * np.ceil(SPECTRUM.max() / 5.0) + 5.0
DB_BOTTOM = DB_TOP - 90.0
N_HARMONICS = int(3950 // F0)


def harmonic_level_db(k: int) -> float:
    """Peak level of the k-th harmonic, read off the measured spectrum.

    Generic display maths: find the largest bin within +/-2 bins of k*f0.
    Harmonics are ~5 bins apart here, so the windows never overlap. Nothing
    is estimated or reconstructed — the number is a value already in
    spectra.json.
    """
    centre = int(round(k * F0 / BIN_HZ))
    lo = max(0, centre - 2)
    hi = min(len(SPECTRUM), centre + 3)
    return float(SPECTRUM[lo:hi].max())


# --------------------------------------------------------------------------
# Small drawing helpers
# --------------------------------------------------------------------------
def curve(axes: Axes, xs, ys, color: str, width: float = 3.0) -> VMobject:
    """Polyline through data coordinates."""
    mob = VMobject(stroke_color=color, stroke_width=width)
    mob.set_points_as_corners([axes.c2p(x, y) for x, y in zip(xs, ys)])
    mob.set_fill(opacity=0)
    return mob


def band_fill(axes: Axes, xs, ys, baseline: float, color: str, opacity: float) -> VMobject:
    """Closed region between a polyline and a baseline, filled."""
    pts = [axes.c2p(x, y) for x, y in zip(xs, ys)]
    pts.append(axes.c2p(xs[-1], baseline))
    pts.append(axes.c2p(xs[0], baseline))
    mob = VMobject(stroke_width=0)
    mob.set_points_as_corners(pts + [pts[0]])
    mob.set_fill(color, opacity=opacity)
    return mob


def envelope(axes: Axes, xs, lo, hi, color: str, opacity: float) -> VMobject:
    """Filled min/max envelope — the shape waveform.json stores."""
    top = [axes.c2p(x, y) for x, y in zip(xs, hi)]
    bottom = [axes.c2p(x, y) for x, y in zip(reversed(xs), reversed(lo))]
    mob = VMobject(stroke_width=0)
    mob.set_points_as_corners(top + bottom + [top[0]])
    mob.set_fill(color, opacity=opacity)
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


def plot_panel(axes: Axes, pad: float = 0.35) -> Rectangle:
    """The sunken plot ground behind an Axes."""
    rect = Rectangle(
        width=axes.width + 2 * pad,
        height=axes.height + 2 * pad,
        stroke_width=0,
        fill_color=PLOT_BG,
        fill_opacity=1.0,
    )
    rect.move_to(axes)
    return rect


def x_tick_labels(axes: Axes, values, fmt, size: int = 18, color: str = TEXT_3) -> VGroup:
    group = VGroup()
    y0 = axes.y_range[0]
    for value in values:
        tick = label(fmt(value), size=size, color=color, mono=True)
        tick.next_to(axes.c2p(value, y0), DOWN, buff=0.16)
        group.add(tick)
    return group


def y_tick_labels(axes: Axes, values, fmt, size: int = 18, color: str = TEXT_3) -> VGroup:
    group = VGroup()
    x0 = axes.x_range[0]
    for value in values:
        tick = label(fmt(value), size=size, color=color, mono=True)
        tick.next_to(axes.c2p(x0, value), LEFT, buff=0.18)
        group.add(tick)
    return group


class Decomposition(Scene):
    """~52 s. Waveform -> spectrum -> bands -> per-band voicing -> the model."""

    def construct(self):
        self.footer = None
        self.title = None

        self.beat_title()
        self.beat_waveform()
        self.beat_spectrum()
        self.beat_bands()
        self.beat_model()
        self.beat_close()

    # -- chrome ------------------------------------------------------------
    def set_footer(self, left: str, right: str = "", run_time: float = 0.4):
        """Swap the persistent provenance line at the bottom of the frame."""
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
        """0:00 - 0:05"""
        kicker = label("MULTI-BAND EXCITATION", size=20, color=COOL, mono=True)
        head = label("One voiced/unvoiced decision", size=56, color=TEXT, weight=BOLD)
        head2 = label("is not enough.", size=56, color=TEXT, weight=BOLD)
        sub = VGroup(
            label("Real speech is periodic in some parts of the spectrum", size=24, color=TEXT_3),
            label("and noisy in others — at the same instant.", size=24, color=TEXT_3),
        ).arrange(DOWN, buff=0.16)
        head.next_to(kicker, DOWN, buff=0.45)
        head2.next_to(head, DOWN, buff=0.14)
        sub.next_to(head2, DOWN, buff=0.5)
        group = VGroup(kicker, head, head2, sub).move_to([0, 0.3, 0])

        self.play(FadeIn(kicker, run_time=0.5))
        self.play(FadeIn(head, shift=UP * 0.15, run_time=0.5))
        self.play(FadeIn(head2, shift=UP * 0.15, run_time=0.5))
        self.play(FadeIn(sub, run_time=0.6))
        self.wait(1.9)
        self.play(FadeOut(group, run_time=0.5))

    def beat_waveform(self):
        """0:05 - 0:19  the real recording, then one 20 ms frame of it."""
        self.set_title(
            "Start with a real recording.",
            f"{DURATION_S:.2f} s of speech, 8 kHz — “{CLIP_TEXT}”",
        )
        self.set_footer(
            "DVSI AMBE-3000 hardware capture · clip lr-b",
            "waveform.json · 2.5 ms min/max envelope",
        )

        axes = Axes(
            x_range=[0, DURATION_S, 0.5],
            y_range=[-1, 1, 0.5],
            x_length=12.0,
            y_length=3.6,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": True},
        ).move_to([0, -0.3, 0])
        panel = plot_panel(axes)
        ticks = x_tick_labels(axes, np.arange(0.0, DURATION_S, 0.5), lambda v: f"{v:.1f}s")
        x_axis_title = label("time", size=18, color=MUTED)
        x_axis_title.next_to(axes, DOWN, buff=0.62)

        scale = WAVEFORM["sample_full_scale"]
        lo = np.asarray(WAVEFORM["original"]["min"], dtype=np.float64) / scale
        hi = np.asarray(WAVEFORM["original"]["max"], dtype=np.float64) / scale
        bucket_ms = WAVEFORM["bucket_ms"]
        xs = np.arange(len(lo)) * bucket_ms / 1000.0

        wave_mob = envelope(axes, xs, lo, hi, ACCENT, 0.9)

        self.play(FadeIn(panel, run_time=0.4), Create(axes, run_time=0.6))
        self.play(FadeIn(ticks, run_time=0.3), FadeIn(x_axis_title, run_time=0.3))
        self.play(FadeIn(wave_mob, run_time=1.1))
        self.wait(0.6)

        # 20 ms cursor.
        frame_note = label(
            f"{FRAME_COUNT} frames · 20 ms each · 72 bits each",
            size=22,
            color=TEXT_2,
        )
        frame_note.next_to(axes, UP, buff=0.35)
        self.play(FadeIn(frame_note, run_time=0.4))

        marker_w = max(0.055, axes.c2p(0.02, 0)[0] - axes.c2p(0.0, 0)[0])
        marker = Rectangle(
            width=marker_w,
            height=axes.height,
            stroke_color=WARM,
            stroke_width=2,
            fill_color=WARM,
            fill_opacity=0.22,
        )
        marker.move_to(axes.c2p(0.02, 0))
        self.play(FadeIn(marker, run_time=0.3))
        self.play(
            marker.animate.move_to(axes.c2p(FRAME_T + 0.01, 0)),
            run_time=2.2,
            rate_func=rate_functions.ease_in_out_sine,
        )
        self.wait(0.4)

        # Zoom into ~60 ms of real samples around the chosen frame.
        self.set_title(
            "One frame. Twenty milliseconds.",
            f"frame {FRAME} of {FRAME_COUNT}, at t = {FRAME_T:.2f} s — 160 samples in, 72 bits out",
        )

        span = 3 * FRAME_SAMPLES
        start = FRAME * FRAME_SAMPLES - FRAME_SAMPLES
        seg = PCM[start : start + span]
        seg_t = (np.arange(span) + start) / SAMPLE_RATE
        peak = float(np.abs(seg).max()) or 1.0

        zoom_axes = Axes(
            x_range=[seg_t[0], seg_t[-1], 0.01],
            y_range=[-1.15, 1.15, 0.5],
            x_length=12.0,
            y_length=3.6,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": True},
        ).move_to(axes)
        zoom_panel = plot_panel(zoom_axes)
        zoom_curve = curve(zoom_axes, seg_t, seg / peak, ACCENT, width=2.6)
        zoom_ticks = x_tick_labels(
            zoom_axes,
            [seg_t[0] + 0.01 * i for i in range(1, 6)],
            lambda v: f"{v * 1000:.0f}ms",
        )

        frame_rect = Rectangle(
            width=zoom_axes.c2p(FRAME_T + 0.02, 0)[0] - zoom_axes.c2p(FRAME_T, 0)[0],
            height=zoom_axes.height,
            stroke_color=WARM,
            stroke_width=2,
            fill_color=WARM,
            fill_opacity=0.12,
        )
        frame_rect.move_to(zoom_axes.c2p(FRAME_T + 0.01, 0))
        frame_tag = label("20 ms", size=20, color=WARM, mono=True)
        frame_tag.move_to(frame_rect.get_top() + DOWN * 0.28)

        self.play(
            FadeOut(VGroup(wave_mob, marker, ticks, frame_note), run_time=0.45),
            FadeOut(VGroup(panel, axes), run_time=0.45),
            FadeIn(zoom_panel, run_time=0.45),
            FadeIn(zoom_axes, run_time=0.45),
        )
        self.play(Create(zoom_curve, run_time=1.4))
        self.play(FadeIn(zoom_ticks, run_time=0.3), FadeIn(frame_rect, run_time=0.5), FadeIn(frame_tag, run_time=0.4))

        bits = label(FRAME_HEX, size=24, color=COOL, mono=True)
        bits_cap = label("the 72 bits this frame became, measured", size=17, color=TEXT_3)
        bits.next_to(zoom_axes, UP, buff=0.35)
        bits_cap.next_to(bits, UP, buff=0.12)
        self.play(FadeIn(bits, run_time=0.5), FadeIn(bits_cap, run_time=0.5))
        self.wait(1.6)

        self.zoom_group = VGroup(
            zoom_panel, zoom_axes, zoom_curve, zoom_ticks, frame_rect, frame_tag, bits, bits_cap, x_axis_title
        )

    def beat_spectrum(self):
        """0:19 - 0:31  the same 20 ms, as a measured spectrum."""
        self.play(FadeOut(self.zoom_group, run_time=0.5))
        self.set_title(
            "Look at it as a spectrum.",
            "256-point FFT of that window — measured off the audio, not off the codec",
        )
        self.set_footer(
            "spectra.json · Hann window, 32 ms, centred on the frame",
            "derived from the audio, not from the codec",
        )

        axes = Axes(
            x_range=[0, 4000, 500],
            y_range=[DB_BOTTOM, DB_TOP, 15],
            x_length=11.4,
            y_length=4.0,
            tips=False,
            axis_config={"stroke_color": AXIS, "stroke_width": 2, "include_ticks": True},
        ).move_to([0.25, -0.2, 0])
        panel = plot_panel(axes)
        xticks = x_tick_labels(
            axes, range(0, 4001, 500), lambda v: "0" if v == 0 else f"{v / 1000:g}k"
        )
        yticks = y_tick_labels(
            axes, np.arange(DB_BOTTOM, DB_TOP + 1, 15), lambda v: f"{v:.0f}"
        )
        xlab = label("frequency (Hz)", size=19, color=MUTED)
        xlab.next_to(axes, DOWN, buff=0.62)
        ylab = label("dBFS", size=19, color=MUTED).rotate(np.pi / 2)
        ylab.next_to(axes, LEFT, buff=0.62)

        spec_curve = curve(axes, BIN_HZ_CENTRES, SPECTRUM, ACCENT, width=2.6)
        spec_fill = band_fill(axes, BIN_HZ_CENTRES, SPECTRUM, DB_BOTTOM, ACCENT, 0.16)

        self.play(FadeIn(panel, run_time=0.5), Create(axes, run_time=0.7))
        self.play(FadeIn(VGroup(xticks, yticks, xlab, ylab), run_time=0.4))
        self.play(Create(spec_curve, run_time=1.6), FadeIn(spec_fill, run_time=1.6))
        self.wait(0.6)

        # The harmonic comb.
        comb = VGroup()
        for k in range(1, N_HARMONICS + 1):
            freq = k * F0
            line = DashedLine(
                axes.c2p(freq, DB_BOTTOM),
                axes.c2p(freq, DB_TOP),
                dash_length=0.07,
                stroke_color=COOL,
                stroke_width=1.4,
                stroke_opacity=0.55,
            )
            comb.add(line)

        comb_note = label(
            f"every peak sits on a multiple of {F0:.0f} Hz  ·  {N_HARMONICS} harmonics below 4 kHz",
            size=22,
            color=COOL,
        )
        comb_note.next_to(axes, UP, buff=0.3)

        self.play(Create(comb, lag_ratio=0.06, run_time=1.6))
        self.play(FadeIn(comb_note, run_time=0.5))
        self.wait(1.6)
        self.play(FadeOut(comb_note), comb.animate.set_stroke(opacity=0.14), run_time=0.4)

        self.spec_axes = axes
        self.spec_panel = panel
        self.spec_curve = spec_curve
        self.spec_fill = spec_fill
        self.spec_comb = comb
        self.spec_xlab = xlab
        self.spec_chrome = VGroup(xticks, yticks, ylab)

    def beat_bands(self):
        """0:30 - 0:43  cut into bands; each band judged on its own."""
        axes = self.spec_axes
        self.set_title(
            "Cut the spectrum into bands.",
            "Then ask of each band separately: does this repeat at the pitch period?",
        )
        self.set_footer(
            "voicing strength: autocorrelation at the pitch lag — derived, not a codec field",
            "8 bands here; MBE allows 20 or more",
        )
        self.play(FadeOut(self.spec_xlab, run_time=0.3))

        plot_top = axes.c2p(0, DB_TOP)[1]
        plot_bottom = axes.c2p(0, DB_BOTTOM)[1]
        plot_height = plot_top - plot_bottom
        plot_mid_y = (plot_top + plot_bottom) / 2

        dividers = VGroup()
        for edge, _ in BAND_EDGES[1:]:
            dividers.add(
                Line(
                    axes.c2p(edge, DB_BOTTOM),
                    axes.c2p(edge, DB_TOP),
                    stroke_color=TEXT_3,
                    stroke_width=2.2,
                )
            )
        self.play(Create(dividers, lag_ratio=0.12, run_time=1.0))

        badges = VGroup()
        tints = VGroup()
        for (low, high), strength, voiced in zip(BAND_EDGES, BAND_VOICING, BAND_VOICED):
            colour = COOL if voiced else WARM
            left_x = axes.c2p(low, DB_BOTTOM)[0]
            right_x = axes.c2p(high, DB_TOP)[0]
            mid_x = (left_x + right_x) / 2
            tint = Rectangle(
                width=right_x - left_x,
                height=plot_height,
                stroke_width=0,
                fill_color=colour,
                fill_opacity=0.10,
            )
            tint.move_to([mid_x, plot_mid_y, 0])
            tints.add(tint)

            value = label(f"{strength:.2f}", size=21, color=colour, mono=True)
            verdict = label("VOICED" if voiced else "NOISE", size=15, color=colour, mono=True)
            verdict.next_to(value, DOWN, buff=0.1)
            badge = VGroup(value, verdict)
            badge.move_to([mid_x, -3.05, 0])
            badges.add(badge)

        rule = label(
            f"voicing strength ≥ {VOICING_THRESHOLD:.2f}  →  harmonics    ·    below  →  noise",
            size=21,
            color=TEXT_2,
        )
        rule.next_to(axes, UP, buff=0.3)
        self.play(FadeIn(rule, run_time=0.4))

        for tint, badge in zip(tints, badges):
            self.play(FadeIn(tint, run_time=0.16), FadeIn(badge, shift=UP * 0.08, run_time=0.3))

        self.wait(1.0)
        voiced_count = sum(BAND_VOICED)
        verdict_line = label(
            f"{voiced_count} bands periodic, {len(BAND_VOICED) - voiced_count} bands noise — "
            "in one 20 ms frame",
            size=24,
            color=TEXT,
        )
        verdict_line.move_to(rule)
        self.play(FadeOut(rule, run_time=0.3), FadeIn(verdict_line, run_time=0.4))
        self.wait(1.8)
        self.play(FadeOut(verdict_line, run_time=0.4))

        self.band_tints = tints
        self.band_badges = badges
        self.band_dividers = dividers

    def beat_model(self):
        """0:43 - 0:56  reassemble: harmonics in the voiced bands, noise above."""
        axes = self.spec_axes
        self.set_title(
            "Rebuild it as harmonics plus noise.",
            "Voiced bands get sine waves on the harmonic grid. Unvoiced bands get noise.",
        )
        self.set_footer(
            "stem heights and noise levels are the measured spectrum, band by band",
            "Griffin & Lim 1988, sec. II",
        )

        # Fade the measurement to a ghost so the model reads on top of it.
        self.play(
            self.spec_curve.animate.set_stroke(color=MUTED, opacity=0.45, width=2.0),
            self.spec_fill.animate.set_fill(MUTED, opacity=0.07),
            FadeOut(self.spec_comb, run_time=0.4),
            run_time=0.7,
        )

        stems = VGroup()
        for k in range(1, N_HARMONICS + 1):
            freq = k * F0
            band = min(int(freq // 500), len(BAND_VOICED) - 1)
            if not BAND_VOICED[band]:
                continue
            level = harmonic_level_db(k)
            stem = Line(
                axes.c2p(freq, DB_BOTTOM),
                axes.c2p(freq, level),
                stroke_color=COOL,
                stroke_width=4.0,
            )
            cap = Line(
                axes.c2p(freq - 22, level),
                axes.c2p(freq + 22, level),
                stroke_color=COOL,
                stroke_width=4.0,
            )
            stems.add(VGroup(stem, cap))

        noise_regions = VGroup()
        for (low, high), voiced in zip(BAND_EDGES, BAND_VOICED):
            if voiced:
                continue
            mask = (BIN_HZ_CENTRES >= low) & (BIN_HZ_CENTRES <= high)
            xs = BIN_HZ_CENTRES[mask]
            ys = SPECTRUM[mask]
            noise_regions.add(band_fill(axes, xs, ys, DB_BOTTOM, WARM, 0.5))
            noise_regions.add(curve(axes, xs, ys, WARM, width=2.4))

        measured_key = VGroup(
            Line(LEFT * 0.16, RIGHT * 0.16, stroke_color=MUTED, stroke_width=3),
            label("measured", size=20, color=TEXT_3),
        ).arrange(RIGHT, buff=0.2)
        harmonic_key = VGroup(
            Line(LEFT * 0.16, RIGHT * 0.16, stroke_color=COOL, stroke_width=4),
            label(f"harmonics of {F0:.0f} Hz", size=20, color=TEXT_2),
        ).arrange(RIGHT, buff=0.2)
        noise_key = VGroup(
            Rectangle(width=0.32, height=0.15, stroke_width=0, fill_color=WARM, fill_opacity=0.6),
            label("noise at the measured level", size=20, color=TEXT_2),
        ).arrange(RIGHT, buff=0.2)
        legend = VGroup(measured_key, harmonic_key, noise_key).arrange(RIGHT, buff=0.75)
        legend.next_to(axes, UP, buff=0.28)

        self.play(FadeIn(measured_key, run_time=0.3))
        self.play(Create(stems, lag_ratio=0.08, run_time=2.2))
        self.play(FadeIn(harmonic_key, run_time=0.4))
        self.wait(1.6)
        self.play(FadeIn(noise_regions, run_time=1.0))
        self.play(FadeIn(noise_key, run_time=0.4))
        self.wait(3.4)

        self.model_group = VGroup(stems, noise_regions, legend)

    def beat_close(self):
        """0:56 - end"""
        self.play(
            FadeOut(
                VGroup(
                    self.model_group,
                    self.band_tints,
                    self.band_badges,
                    self.band_dividers,
                    self.spec_curve,
                    self.spec_fill,
                    self.spec_chrome,
                    self.spec_axes,
                    self.spec_panel,
                ),
                run_time=0.8,
            ),
            FadeOut(self.title, run_time=0.6),
        )
        self.title = None

        line1 = label("Harmonics where the spectrum repeats.", size=42, color=COOL, weight=BOLD)
        line2 = label("Noise where it doesn’t.", size=42, color=WARM, weight=BOLD)
        line3 = label("Decided per band, fifty times a second.", size=30, color=TEXT_2)
        line2.next_to(line1, DOWN, buff=0.22)
        line3.next_to(line2, DOWN, buff=0.55)
        group = VGroup(line1, line2, line3).move_to([0, 0.35, 0])

        self.play(FadeIn(line1, shift=UP * 0.12, run_time=0.6))
        self.play(FadeIn(line2, shift=UP * 0.12, run_time=0.6))
        self.play(FadeIn(line3, run_time=0.6))
        self.set_footer(
            "Griffin & Lim, “Multiband Excitation Vocoder”, IEEE ASSP-36, 1988",
            "measured on a DVSI AMBE-3000",
        )
        self.wait(2.6)
        self.play(FadeOut(group, run_time=0.7), FadeOut(self.footer, run_time=0.7))
        self.wait(0.4)
