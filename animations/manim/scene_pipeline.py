"""How AMBE Works — scene "pipeline".

Slug
    pipeline   (for the pages carrying `<!-- VIDEO: pipeline -->`:
                docs/07-multi-band-excitation.md and docs/10-the-dstar-frame.md)

What it is
    One continuous ~109 s camera move along a single horizontal strip, from
    speech going in to speech coming out: waveform -> 20 ms framing ->
    analysis into model parameters -> quantization into a 72-bit frame ->
    the frame on the air -> decode -> synthesis -> waveform. Ten stages laid
    out left to right in world coordinates, with the camera gliding through
    them so the whole codec reads as one unbroken visual sentence.

Data it reads (precomputed and committed; see docs/assets/data/SCHEMA.md)
    docs/assets/data/waveform.json   min/max envelope, 2.5 ms buckets, of the
                                     featured clip's original and decoded audio
    docs/assets/data/frames.json     the 72 channel bits per 20 ms, MEASURED
                                     off a DVSI AMBE-3000 (ThumbDV), plus
                                     DERIVED per-frame DSP (pitch, band voicing)
    docs/assets/data/spectra.json    per-frame FFT magnitude of the same audio

    This module DRAWS those numbers. It contains no AMBE analysis, no AMBE
    synthesis, no quantizer and no bit-packer. The only signal maths present is
    generic display maths: reading a stored spectrum at a harmonic frequency,
    and drawing plain sinusoids to illustrate what "a sum of harmonics" means.

Provenance discipline kept on screen
    Anything that came off the chip is badged "measured"; anything computed by
    tools/make-data.py from the WAV files is badged "derived". The 72 bits are
    shown whole and never decomposed, because the mapping from those bits to
    codec parameters is not public — and the scene says so.

Sources cited on screen
    JARL D-STAR system specification (72-bit voice frame, 24-bit data frame,
    4800 bps); US 5,754,974 (the 7 + 8 + 57 budget example, and the harmonic
    count following from the pitch); Griffin & Lim 1988 and US 5,701,390
    (synthesis). All expired; see docs/16-patents.md.

Narration
    Every stage is narrated, and the narration sets the pace: a stage is held
    open until its line has finished. See animations/narration/pipeline.txt
    and animations/manim/narration.py.

Controls
    None — this is a linear video. The interactive, draggable versions of the
    same ideas are the canvas figures built on docs/javascripts/anim-core.js.

Rendering
    uvx --from manim manim -qm animations/manim/scene_pipeline.py Pipeline

    Pango Text() throughout, deliberately: no LaTeX toolchain is required.
    The output format is pinned below to 1920x1080 at 30 fps whatever quality
    flag the CLI passes; set AMBE_ANIM_PREVIEW=1 to opt out for a fast look.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
from manim import (
    DOWN,
    LEFT,
    ORIGIN,
    RIGHT,
    UL,
    UP,
    Create,
    DashedLine,
    Dot,
    LaggedStart,
    Line,
    MovingCameraScene,
    Rectangle,
    Restore,
    RoundedRectangle,
    Text,
    VGroup,
    VMobject,
    config,
    logger,
    rate_functions,
)

# manim imports a scene file by path, and which directory ends up on sys.path
# depends on how it was invoked. Put this file's own directory there so the
# shared narration helper resolves whether the render was started from the
# repository root, from tools/render-local.sh, or from CI.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from narration import Narrator  # noqa: E402  (needs the sys.path line above)

# --------------------------------------------------------------------------
# Output format. Fixed deliverable: 1920x1080, 30 fps.
# --------------------------------------------------------------------------
if not os.environ.get("AMBE_ANIM_PREVIEW"):
    config.pixel_width = 1920
    config.pixel_height = 1080
    config.frame_rate = 30

# --------------------------------------------------------------------------
# Palette — taken from docs/stylesheets/extra.css, dark scheme ("slate").
# That file is the single source of truth; keep these in step with it.
# --------------------------------------------------------------------------
BG = "#0c0d10"  # --ambe-bg
SURF1 = "#131419"  # --ambe-surface-1
SURF2 = "#1a1c22"  # --ambe-surface-2
SUNKEN = "#08090c"  # --ambe-sunken
INK = "#f2f2f7"  # --ambe-text
INK2 = "#c3c4cd"  # --ambe-text-2
INK3 = "#8d8f9b"  # --ambe-text-3
INK4 = "#5c5e6a"  # --ambe-text-4
ACCENT = "#7d8cff"  # --ambe-accent       (indigo)
WARM = "#ffb454"  # --ambe-accent-warm    (amber)
COOL = "#3ddbc0"  # --ambe-accent-cool    (teal)
AXIS = "#4a4c56"  # --ambe-plot-axis, flattened to an opaque hex
GRID = "#212329"  # --ambe-plot-grid, flattened to an opaque hex

config.background_color = BG

# Pango generic families resolve on every platform, so no fonts are shipped.
SANS = "sans-serif"
MONO = "monospace"

# --------------------------------------------------------------------------
# Precomputed data
# --------------------------------------------------------------------------
DATA_DIR = Path(__file__).resolve().parents[2] / "docs" / "assets" / "data"


def _load(name: str) -> dict:
    path = DATA_DIR / name
    if not path.exists():
        raise SystemExit(
            f"missing precomputed data: {path}\n"
            "Run tools/make-audio.sh, tools/capture-hardware.sh and "
            "tools/make-data.py first (see docs/assets/data/SCHEMA.md)."
        )
    return json.loads(path.read_text())


FRAMES = _load("frames.json")
WAVEFORM = _load("waveform.json")
SPECTRA = _load("spectra.json")

# The frame the scene follows the whole way through. Chosen as the most
# confidently voiced frame of the featured clip that also has most of its bands
# reading periodic (derived confidence 0.953, five of eight bands), so the pitch
# and harmonic pictures are legible.
HERO = 48
HERO_FRAME = FRAMES["frames"][HERO]
HERO_HEX = HERO_FRAME["hex"]  # MEASURED: the 9 bytes the AMBE-3000 emitted
HERO_F0 = HERO_FRAME["derived"]["decoded_f0_hz"]  # DERIVED from the audio
HERO_BANDS = HERO_FRAME["derived"]["band_voicing"]  # DERIVED
HERO_T = HERO_FRAME["t"]
BAND_EDGES = FRAMES["derived_notes"]["band_edges_hz"]
FULL_SCALE = WAVEFORM["sample_full_scale"]
BIN_HZ = SPECTRA["bin_hz"]
CLIP_TEXT = FRAMES["clip"]["text"]

# US 5,754,974 gives the harmonic count as L = floor(alpha*pi/w0) with
# alpha = 0.925 at an 8 kHz sample rate, i.e. every harmonic below 3700 Hz.
# Evaluated here only to put an honest number on the screen.
HARMONIC_BAND_HZ = 3700.0
HERO_L = int(HARMONIC_BAND_HZ // HERO_F0)

DB_LO, DB_HI = -88.0, -4.0


def bits_of(hexstr: str) -> list[int]:
    """Unpack the stored channel frame into 72 bits — first byte first, MSB
    first within a byte, exactly as SCHEMA.md specifies. This is a display
    unpack of an opaque number; the scene never interprets an individual bit."""
    raw = bytes.fromhex(hexstr)
    return [(raw[n >> 3] >> (7 - (n & 7))) & 1 for n in range(8 * len(raw))]


HERO_BITS = bits_of(HERO_HEX)

# --------------------------------------------------------------------------
# Layout: one stage every STAGE_DX units along +x.
# --------------------------------------------------------------------------
STAGE_DX = 18.0
RAIL_Y = -3.60
STAGE_NAMES = [
    "speech in",
    "20 ms frames",
    "pitch",
    "voicing",
    "spectrum",
    "quantize",
    "on the air",
    "decode",
    "synthesize",
    "speech out",
]
STAGE_X = [i * STAGE_DX for i in range(len(STAGE_NAMES))]


# --------------------------------------------------------------------------
# Typographic helpers
# --------------------------------------------------------------------------
def head(title: str, sub: str | None = None) -> VGroup:
    t = Text(title, font=SANS, font_size=40, color=INK, weight="SEMIBOLD")
    g = VGroup(t)
    if sub:
        s = Text(sub, font=SANS, font_size=24, color=INK3)
        s.next_to(t, DOWN, buff=0.20)
        g.add(s)
    return fit(g)


def fit(mob, max_width: float = 12.4):
    """Never let a caption run past the stage it belongs to. Font metrics vary
    between platforms, so measure and scale rather than trusting a guess."""
    if mob.width > max_width:
        mob.scale(max_width / mob.width)
    return mob


def cite(text: str, color: str = INK4) -> Text:
    return fit(Text(text, font=SANS, font_size=19, color=color, line_spacing=0.9))


def badge(label: str, color: str) -> VGroup:
    t = Text(label.upper(), font=SANS, font_size=15, color=color, weight="BOLD")
    box = RoundedRectangle(
        width=t.width + 0.34,
        height=t.height + 0.24,
        corner_radius=0.09,
        stroke_color=color,
        stroke_width=1.2,
        fill_color=color,
        fill_opacity=0.12,
    )
    return VGroup(box, t.move_to(box))


def panel(width: float, height: float, fill: str = SUNKEN) -> RoundedRectangle:
    return RoundedRectangle(
        width=width,
        height=height,
        corner_radius=0.16,
        stroke_color=GRID,
        stroke_width=1.4,
        fill_color=fill,
        fill_opacity=1.0,
    )


def place(x: float, pieces: list, drawn: tuple = ()) -> VGroup:
    """Move a stage into its slot on the strip, then arm every fading piece.

    Order matters: the x shift has to happen BEFORE save_state(), or Restore()
    would later snap the piece back to the origin instead of to its stage.
    Pieces that are *drawn* with Create() are shifted but not armed — Create
    puts them on screen itself, at their natural opacity.
    """
    group = VGroup(*pieces)
    group.shift(RIGHT * x)
    for m in drawn:
        m.shift(RIGHT * x)
    for m in pieces:
        m.save_state()
        m.set_opacity(0.0)
        m.shift(DOWN * 0.22)
    return group


# --------------------------------------------------------------------------
# Data-drawing helpers. Plotting, not signal processing.
# --------------------------------------------------------------------------
def envelope_shape(
    mins: list[int],
    maxs: list[int],
    width: float,
    half_height: float,
    color: str,
    fill_opacity: float = 0.55,
    stroke_width: float = 1.0,
    max_points: int = 520,
) -> VMobject:
    """Min/max envelope of a stored waveform, as one closed outline."""
    n = len(mins)
    step = max(1, n // max_points)
    idx = list(range(0, n, step))
    if idx[-1] != n - 1:
        idx.append(n - 1)

    def px(i: int) -> float:
        return -width / 2 + width * i / (n - 1)

    top = [np.array([px(i), half_height * maxs[i] / FULL_SCALE, 0.0]) for i in idx]
    bot = [np.array([px(i), half_height * mins[i] / FULL_SCALE, 0.0]) for i in reversed(idx)]
    shape = VMobject(
        stroke_color=color,
        stroke_width=stroke_width,
        fill_color=color,
        fill_opacity=fill_opacity,
    )
    shape.set_points_as_corners(top + bot + [top[0]])
    return shape


def db_to_y(db: float, height: float) -> float:
    return -height / 2 + height * (float(np.clip(db, DB_LO, DB_HI)) - DB_LO) / (DB_HI - DB_LO)


def spectrum_curve(
    row: list[int],
    width: float,
    height: float,
    color: str,
    fill_opacity: float = 0.18,
    stroke_width: float = 2.0,
) -> VMobject:
    """A stored per-frame FFT magnitude, drawn as a filled curve. Bin k sits at
    k * bin_hz, which is what the file's own bin_centre_hz says."""
    n = len(row)
    pts = [
        np.array([-width / 2 + width * k / (n - 1), db_to_y(db, height), 0.0])
        for k, db in enumerate(row)
    ]
    curve = VMobject(
        stroke_color=color,
        stroke_width=stroke_width,
        fill_color=color,
        fill_opacity=fill_opacity,
    )
    curve.set_points_as_corners(
        [np.array([pts[0][0], -height / 2, 0.0])]
        + pts
        + [np.array([pts[-1][0], -height / 2, 0.0])]
    )
    return curve


def spectrum_at(row: list[int], hz: float) -> float:
    """Read the stored spectrum at an arbitrary frequency, linearly between
    bins. Display interpolation of a curve already on screen."""
    k = hz / BIN_HZ
    lo = int(np.floor(k))
    if lo >= len(row) - 1:
        return float(row[-1])
    frac = k - lo
    return float(row[lo] * (1 - frac) + row[lo + 1] * frac)


def freq_axis(
    width: float, height: float, hz_max: float = 4000.0, labels: bool = True
) -> VGroup:
    """Baseline plus 1 kHz ticks for a 0..hz_max frequency plot.

    Built around the origin with the baseline at -height/2, exactly like
    spectrum_curve, so callers position both with .shift(anchor) — never
    .move_to(), which would centre the group's bounding box and float the
    baseline into the middle of the plot.
    """
    base = Line(
        np.array([-width / 2, -height / 2, 0.0]),
        np.array([width / 2, -height / 2, 0.0]),
        stroke_color=AXIS,
        stroke_width=1.4,
    )
    g = VGroup(base)
    for hz in (1000, 2000, 3000, 4000):
        x = -width / 2 + width * hz / hz_max
        tick = Line(
            np.array([x, -height / 2, 0.0]),
            np.array([x, -height / 2 - 0.12, 0.0]),
            stroke_color=AXIS,
            stroke_width=1.2,
        )
        g.add(tick)
        if labels:
            lab = Text(f"{hz // 1000} kHz", font=SANS, font_size=17, color=INK4)
            lab.next_to(tick, DOWN, buff=0.08)
            g.add(lab)
    return g


def harmonic_stems(
    row: list[int],
    origin: np.ndarray,
    width: float,
    height: float,
    color: str,
    stroke_width: float = 2.4,
    cap: bool = False,
) -> list[VGroup]:
    """One vertical stem per harmonic of the frame's fundamental, each reaching
    the height the displayed spectrum already has at that frequency."""
    stems = []
    for n in range(1, HERO_L + 1):
        hz = n * HERO_F0
        x = -width / 2 + width * hz / 4000.0
        y = db_to_y(spectrum_at(row, hz), height)
        stem = Line(
            origin + np.array([x, -height / 2, 0.0]),
            origin + np.array([x, y, 0.0]),
            stroke_color=color,
            stroke_width=stroke_width,
        )
        piece = VGroup(stem)
        if cap:
            piece.add(Dot(origin + np.array([x, y, 0.0]), radius=0.055, color=COOL))
        stems.append(piece)
    return stems


def bit_row(bits: list[int], pitch: float = 0.158) -> VGroup:
    """The 72 bits as one row of cells. Deliberately drawn as an opaque block:
    no field is labelled, because D-STAR's bit assignment is not published."""
    cells = VGroup()
    size = pitch * 0.84
    for i, b in enumerate(bits):
        cell = Rectangle(
            width=size,
            height=size * 1.6,
            stroke_width=0.9,
            stroke_color=ACCENT if b else GRID,
            fill_color=ACCENT if b else SURF2,
            fill_opacity=0.95 if b else 1.0,
        )
        cell.move_to(np.array([(i - (len(bits) - 1) / 2) * pitch, 0.0, 0.0]))
        cells.add(cell)
    return cells


def param_card(title: str, value: str, color: str, width: float = 4.0) -> VGroup:
    box = panel(width, 1.15, fill=SURF1)
    t = Text(title, font=SANS, font_size=20, color=INK2)
    v = Text(value, font=MONO, font_size=23, color=color)
    stack = VGroup(t, v).arrange(DOWN, buff=0.13)
    fit(stack, width - 0.5)
    return VGroup(box, stack.move_to(box))


# --------------------------------------------------------------------------
# The scene
# --------------------------------------------------------------------------
class Pipeline(MovingCameraScene):
    """Speech in, 72 bits, speech out — in one unbroken camera move."""

    def construct(self) -> None:
        cam = self.camera.frame
        cam.move_to(ORIGIN)

        self.add(self.build_rail(), self.build_hud())

        stages = [
            self.stage_speech_in(),
            self.stage_framing(),
            self.stage_pitch(),
            self.stage_voicing(),
            self.stage_spectrum(),
            self.stage_quantize(),
            self.stage_air(),
            self.stage_decode(),
            self.stage_synthesize(),
            self.stage_speech_out(),
        ]
        # Everything that fades in is on stage from the start at zero opacity.
        # Everything that is *drawn* (Create) stays out until its own moment.
        for st in stages:
            self.add(st["group"])

        s0, s1, s2, s3, s4, s5, s6, s7, s8, s9 = stages

        # The narration sets the pace. Each `beat` starts its line, runs the
        # animations underneath it, and then holds the stage until the line has
        # finished. The run_times below are therefore the speed of each MOVE,
        # not the length of each stage: a stage lasts as long as its sentence.
        #
        # This is also the fix for the scene reading too fast. It used to total
        # about 68 s with no dwell anywhere, so every stage cut to the next the
        # instant its last object had faded in and nothing was ever left on
        # screen long enough to read. `floor` keeps that dwell even when the
        # audio is missing, so a silent render is still paced.
        nar = Narrator(self, "pipeline")

        # ---- 1. speech in ----------------------------------------------------
        with nar.beat("speech-in", floor=3.0):
            self.reveal(s0["title"], s0["quote"], run_time=2.0)
            self.play(Create(s0["wave"]), run_time=2.2, rate_func=rate_functions.ease_out_sine)
            self.reveal(s0["note"], s0["badge"], run_time=1.3)

        # ---- 2. framing ------------------------------------------------------
        with nar.beat("framing", floor=3.0):
            self.pan(cam, 1, s0, [s1["title"], s1["wave"]], run_time=2.5)
            self.reveal(*s1["dividers"], run_time=1.4, lag=0.05)
            self.reveal(s1["window"], s1["maths"], s1["note"], run_time=1.8)

        # ---- 3. pitch --------------------------------------------------------
        with nar.beat("pitch", floor=3.0):
            self.pan(cam, 2, s1, [s2["title"], s2["axis"]], run_time=2.5)
            self.play(Create(s2["curve"]), run_time=1.6)
            self.reveal(*s2["combs"], run_time=1.5, lag=0.035)
            self.reveal(s2["f0"], s2["law"], s2["badge"], s2["source"], run_time=1.4)

        # ---- 4. voicing ------------------------------------------------------
        with nar.beat("voicing", floor=3.0):
            self.pan(cam, 3, s2, [s3["title"], s3["axis"]], run_time=2.5)
            self.reveal(*s3["bars"], run_time=1.8, lag=0.09)
            self.reveal(s3["note"], s3["badge"], run_time=1.3)

        # ---- 5. spectrum -----------------------------------------------------
        with nar.beat("spectrum", floor=3.0):
            self.pan(cam, 4, s3, [s4["title"], s4["axis"], s4["ghost"]], run_time=2.5)
            self.play(
                LaggedStart(*[Create(m) for m in s4["sticks"]], lag_ratio=0.03),
                run_time=1.8,
            )
            self.reveal(s4["note"], run_time=1.2)

        # ---- 6. quantize -----------------------------------------------------
        with nar.beat("quantize", floor=3.5):
            self.pan(cam, 5, s4, [s5["title"], s5["cards"]], run_time=2.5)
            self.reveal(*s5["arrows"], *s5["indices"], run_time=1.8, lag=0.10)
            self.reveal(s5["budget"], run_time=1.4)
            self.reveal(s5["quote"], run_time=1.6)

        # ---- 7. on the air ---------------------------------------------------
        with nar.beat("air", floor=3.0):
            self.pan(cam, 6, s5, [s6["title"]], run_time=2.5)
            self.reveal(*s6["bits"], run_time=1.6, lag=0.006)
            self.reveal(s6["hex"], s6["badge"], run_time=1.2)
            self.play(Create(s6["carrier"]), run_time=1.4)
            self.reveal(s6["split"], s6["note"], run_time=1.6)

        # ---- 8. decode -------------------------------------------------------
        with nar.beat("decode", floor=3.0):
            self.pan(cam, 7, s6, [s7["title"], s7["bits"]], run_time=2.5)
            self.reveal(*s7["arrows"], *s7["cards"], run_time=2.0, lag=0.10)
            self.reveal(s7["note"], run_time=1.2)

        # ---- 9. synthesize ---------------------------------------------------
        with nar.beat("synthesize", floor=3.0):
            self.pan(cam, 8, s7, [s8["title"], s8["equation"]], run_time=2.5)
            self.play(
                LaggedStart(*[Create(h) for h in s8["harmonics"]], lag_ratio=0.15),
                run_time=1.8,
            )
            self.play(Create(s8["sum"]), run_time=1.3)
            self.reveal(s8["sum_label"], run_time=0.7)
            self.play(Create(s8["noise"]), run_time=1.0)
            self.reveal(s8["note"], run_time=1.1)

        # ---- 10. speech out --------------------------------------------------
        with nar.beat("speech-out", floor=3.0):
            self.pan(cam, 9, s8, [s9["title"]], run_time=2.5)
            self.play(Create(s9["wave"]), run_time=2.2, rate_func=rate_functions.ease_out_sine)
            self.reveal(s9["note"], s9["badge"], run_time=1.2)
            self.reveal(s9["closing"], run_time=1.8)

        # A last hold so the closing line is not cut off by the file ending.
        self.wait(1.8)
        nar.write_captions()
        logger.info(nar.report())

    # -- playback helpers --------------------------------------------------
    def reveal(self, *pieces, run_time: float, lag: float = 0.0) -> None:
        anims = [Restore(p) for p in pieces]
        if lag:
            self.play(LaggedStart(*anims, lag_ratio=lag), run_time=run_time)
        else:
            self.play(*anims, run_time=run_time)

    def pan(self, cam, index: int, leaving: dict, arriving: list, run_time: float) -> None:
        """One leg of the continuous move: dim the stage we are leaving, glide
        the camera to the next one, and bring its first elements up en route."""
        anims = [cam.animate.move_to(np.array([STAGE_X[index], 0.0, 0.0]))]
        anims.append(leaving["group"].animate.set_opacity(0.20))
        anims += [m.animate.set_opacity(0.20) for m in leaving.get("drawn", [])]
        anims += [Restore(m) for m in arriving]
        self.play(*anims, run_time=run_time, rate_func=rate_functions.ease_in_out_sine)

    # -- persistent chrome -------------------------------------------------
    def build_rail(self) -> VGroup:
        line = Line(
            np.array([STAGE_X[0] - 9.0, RAIL_Y, 0.0]),
            np.array([STAGE_X[-1] + 9.0, RAIL_Y, 0.0]),
            stroke_color=GRID,
            stroke_width=1.6,
        )
        g = VGroup(line)
        for x, name in zip(STAGE_X, STAGE_NAMES):
            dot = Dot(np.array([x, RAIL_Y, 0.0]), radius=0.045, color=INK4)
            lab = Text(name, font=SANS, font_size=17, color=INK4)
            lab.next_to(dot, DOWN, buff=0.16)
            g.add(dot, lab)

        marker = Dot(np.array([0.0, RAIL_Y, 0.0]), radius=0.085, color=ACCENT)
        marker.add_updater(
            lambda m: m.move_to(np.array([self.camera.frame.get_center()[0], RAIL_Y, 0.0]))
        )
        g.add(marker)
        return g

    def build_hud(self) -> VGroup:
        g = VGroup(
            Text("How AMBE Works", font=SANS, font_size=22, color=INK2, weight="SEMIBOLD"),
            Text("the whole path, end to end", font=SANS, font_size=18, color=INK4),
        ).arrange(DOWN, buff=0.10, aligned_edge=LEFT)

        def pin(m: VGroup) -> None:
            corner = self.camera.frame.get_corner(UL)
            m.move_to(corner + RIGHT * (m.width / 2 + 0.55) + DOWN * (m.height / 2 + 0.45))

        pin(g)
        g.add_updater(pin)
        return g

    # -- stages ------------------------------------------------------------
    def stage_speech_in(self) -> dict:
        title = head("Speech goes in", "8 kHz, 16-bit — 128 000 bits per second")
        title.move_to(np.array([0.0, 2.50, 0.0]))
        quote = Text(f"“{CLIP_TEXT}”", font=SANS, font_size=24, color=INK3)
        quote.move_to(np.array([0.0, 1.62, 0.0]))

        board = panel(12.4, 3.0).move_to(np.array([0.0, -0.30, 0.0]))
        wave = envelope_shape(
            WAVEFORM["original"]["min"], WAVEFORM["original"]["max"], 12.0, 1.28, ACCENT
        ).move_to(board)

        note = cite("original audio, before it reaches the vocoder", INK3)
        note.move_to(np.array([0.0, -2.20, 0.0]))
        bg = badge("measured", WARM).next_to(note, DOWN, buff=0.20)

        title_g = VGroup(title, board)
        group = place(STAGE_X[0], [title_g, quote, note, bg], drawn=(wave,))
        return {
            "group": group,
            "drawn": [wave],
            "title": title_g,
            "quote": quote,
            "wave": wave,
            "note": note,
            "badge": bg,
        }

    def stage_framing(self) -> dict:
        title = head("Cut into 20 ms frames", "160 samples each, fifty times a second")
        title.move_to(np.array([0.0, 2.50, 0.0]))

        per = WAVEFORM["buckets_per_frame"]
        first, count = 38, 16
        board = panel(12.4, 3.0).move_to(np.array([0.0, -0.10, 0.0]))
        wave = envelope_shape(
            WAVEFORM["original"]["min"][first * per : (first + count) * per],
            WAVEFORM["original"]["max"][first * per : (first + count) * per],
            11.9,
            1.20,
            ACCENT,
            fill_opacity=0.45,
        ).move_to(board)

        seg = 11.9 / count
        dividers = [
            DashedLine(
                board.get_center() + np.array([-11.9 / 2 + seg * k, -1.35, 0.0]),
                board.get_center() + np.array([-11.9 / 2 + seg * k, 1.35, 0.0]),
                dash_length=0.09,
                stroke_color=AXIS,
                stroke_width=1.0,
            )
            for k in range(count + 1)
        ]

        window = Rectangle(
            width=seg,
            height=2.74,
            stroke_color=WARM,
            stroke_width=2.2,
            fill_color=WARM,
            fill_opacity=0.09,
        )
        window.move_to(
            board.get_center() + np.array([-11.9 / 2 + seg * (HERO - first + 0.5), 0.0, 0.0])
        )

        maths = Text(
            "8000 samples/s  ×  0.020 s  =  160 samples per frame",
            font=MONO,
            font_size=24,
            color=INK2,
        )
        maths.move_to(np.array([0.0, -2.05, 0.0]))
        note = cite(
            f"the amber frame is the one this film follows, at t = {HERO_T:.2f} s"
            "     ·     JARL D-STAR system specification §2.1.2(2)"
        )
        note.move_to(np.array([0.0, -2.58, 0.0]))

        title_g = VGroup(title, board)
        group = place(STAGE_X[1], [title_g, wave, *dividers, window, maths, note])
        return {
            "group": group,
            "title": title_g,
            "wave": wave,
            "dividers": dividers,
            "window": window,
            "maths": maths,
            "note": note,
        }

    def stage_pitch(self) -> dict:
        title = head("Measure the fundamental", "one frequency — and every harmonic of it")
        title.move_to(np.array([0.0, 2.50, 0.0]))

        w, h = 11.6, 3.0
        board = panel(12.4, h + 0.8).move_to(np.array([0.0, 0.00, 0.0]))
        anchor = board.get_center() + UP * 0.14
        row = SPECTRA["original"][HERO]
        curve = spectrum_curve(row, w, h, ACCENT).shift(anchor)
        axis = freq_axis(w, h).shift(anchor)
        combs = harmonic_stems(row, anchor, w, h, WARM)

        f0 = Text(f"F₀ = {HERO_F0:.1f} Hz", font=MONO, font_size=26, color=WARM)
        f0.move_to(np.array([-4.2, -2.16, 0.0]))
        # US 5,754,974: the number of harmonics falls out of the pitch,
        # L = floor(alpha*pi/w0); alpha = 0.925 at 8 kHz is a 3700 Hz band.
        law = Text(
            f"L = floor(3700 / F₀) = {HERO_L} harmonics",
            font=MONO,
            font_size=20,
            color=INK2,
        )
        law.move_to(np.array([2.0, -2.16, 0.0]))
        bg = badge("derived", COOL).move_to(np.array([6.2, -2.16, 0.0]))
        src = cite(
            "US 5,754,974 — the number of harmonics is not fixed: it falls out of the pitch, "
            "so every frame codes a different count"
        )
        src.move_to(np.array([0.0, -2.80, 0.0]))

        title_g = VGroup(title, board)
        group = place(STAGE_X[2], [title_g, axis, *combs, f0, law, bg, src], drawn=(curve,))
        return {
            "group": group,
            "drawn": [curve],
            "title": title_g,
            "axis": axis,
            "curve": curve,
            "combs": combs,
            "f0": f0,
            "law": law,
            "badge": bg,
            "source": src,
        }

    def stage_voicing(self) -> dict:
        title = head(
            "Voiced or unvoiced — band by band",
            "the MBE bet: eight verdicts a frame, not one",
        )
        title.move_to(np.array([0.0, 2.50, 0.0]))

        w, h = 11.6, 3.0
        board = panel(12.4, h + 0.8).move_to(np.array([0.0, 0.00, 0.0]))
        anchor = board.get_center() + UP * 0.35
        # No kHz labels here: the bands carry their own edges, and two rows of
        # frequency text under one baseline would collide.
        axis = freq_axis(w, h, labels=False).shift(anchor)

        bars = []
        slot = w / len(HERO_BANDS)
        for i, strength in enumerate(HERO_BANDS):
            colour = COOL if strength >= 0.55 else INK4
            height = 0.30 + (h - 0.9) * float(np.clip(strength, 0.0, 1.0))
            bar = Rectangle(
                width=slot * 0.70,
                height=height,
                stroke_color=colour,
                stroke_width=1.6,
                fill_color=colour,
                fill_opacity=0.30,
            )
            bx = -w / 2 + slot * (i + 0.5)
            bar.move_to(anchor + np.array([bx, -h / 2 + height / 2, 0.0]))
            val = Text(f"{strength:.2f}", font=MONO, font_size=19, color=colour)
            val.next_to(bar, UP, buff=0.12)
            edge = BAND_EDGES[i]
            lab = Text(
                f"{edge[0] / 1000:g}–{edge[1] / 1000:g} kHz",
                font=SANS,
                font_size=16,
                color=INK4,
            )
            lab.move_to(anchor + np.array([bx, -h / 2 - 0.30, 0.0]))
            bars.append(VGroup(bar, val, lab))

        note = cite(
            "band-limited voicing strength, measured on the chip's own output, in eight 500 Hz bands\n"
            "— not the codec's voicing bits, which the device will not report",
            INK3,
        )
        note.move_to(np.array([0.0, -2.34, 0.0]))
        bg = badge("derived", COOL).next_to(note, DOWN, buff=0.18)

        title_g = VGroup(title, board)
        group = place(STAGE_X[3], [title_g, axis, *bars, note, bg])
        return {
            "group": group,
            "title": title_g,
            "axis": axis,
            "bars": bars,
            "note": note,
            "badge": bg,
        }

    def stage_spectrum(self) -> dict:
        title = head(
            "Take the height of every harmonic",
            "the spectral envelope — where almost all the bits go",
        )
        title.move_to(np.array([0.0, 2.50, 0.0]))

        w, h = 11.6, 3.0
        board = panel(12.4, h + 0.8).move_to(np.array([0.0, 0.00, 0.0]))
        anchor = board.get_center() + UP * 0.14
        row = SPECTRA["original"][HERO]
        ghost = spectrum_curve(row, w, h, INK4, fill_opacity=0.05, stroke_width=1.2)
        ghost.shift(anchor)
        axis = freq_axis(w, h).shift(anchor)
        sticks = harmonic_stems(row, anchor, w, h, ACCENT, stroke_width=3.0, cap=True)

        note = cite(
            f"{HERO_L} amplitudes this frame. The count changes frame to frame, because it follows the pitch.",
            INK3,
        )
        note.move_to(np.array([0.0, -2.38, 0.0]))

        title_g = VGroup(title, board)
        group = place(STAGE_X[4], [title_g, axis, ghost, note], drawn=tuple(sticks))
        return {
            "group": group,
            "drawn": sticks,
            "title": title_g,
            "axis": axis,
            "ghost": ghost,
            "sticks": sticks,
            "note": note,
        }

    def stage_quantize(self) -> dict:
        title = head("Turn measurements into indices", "real numbers in, table entries out")
        title.move_to(np.array([0.0, 2.50, 0.0]))

        cards = VGroup(
            param_card("fundamental", f"{HERO_F0:.1f} Hz", WARM),
            param_card("voicing, 8 bands", "V V V V V V V V", COOL),
            param_card("spectral magnitudes", f"{HERO_L} amplitudes", ACCENT),
        ).arrange(DOWN, buff=0.34)
        cards.move_to(np.array([-4.3, -0.15, 0.0]))

        arrows, indices = [], []
        for i, card in enumerate(cards):
            shaft = Line(
                card.get_right() + RIGHT * 0.14,
                card.get_right() + RIGHT * 0.90,
                stroke_color=INK4,
                stroke_width=2.0,
            )
            arrows.append(VGroup(shaft, Dot(shaft.get_end(), radius=0.05, color=INK4)))
            chip = badge(("index", "8 bits", "index")[i], INK3)
            chip.move_to(shaft.get_end() + RIGHT * (chip.width / 2 + 0.20))
            indices.append(chip)

        # US 5,754,974's own worked example of a 72-bit budget, as three bars
        # in proportion. This is the SHAPE of an allocation; D-STAR's own layout
        # differs and is not public, which the caption underneath says out loud.
        budget = VGroup()
        bar_max, bar_left = 2.6, -3.4
        for row, (label, nbits, colour) in enumerate(
            (
                ("7 bits — fundamental", 7, WARM),
                ("8 bits — voicing, 8 bands", 8, COOL),
                ("57 bits — spectral magnitudes", 57, ACCENT),
            )
        ):
            y = 0.55 - row * 0.55
            seg_w = bar_max * nbits / 57
            seg = Rectangle(
                width=seg_w,
                height=0.30,
                stroke_color=colour,
                stroke_width=1.5,
                fill_color=colour,
                fill_opacity=0.24,
            ).move_to(np.array([bar_left + seg_w / 2, y, 0.0]))
            cap = Text(label, font=SANS, font_size=18, color=colour)
            cap.move_to(np.array([-0.60 + cap.width / 2, y, 0.0]))
            budget.add(seg, cap)
        budget.add(
            Text("7 + 8 + 57  =  72 bits  ·  20 ms", font=MONO, font_size=22, color=INK).move_to(
                np.array([-0.9, -1.15, 0.0])
            )
        )
        # Built around the origin, then fitted and shifted — move_to() would
        # centre on the bounding box, which the long labels dominate.
        fit(budget, 6.8)
        budget.shift(np.array([3.5, 0.30, 0.0]))

        quote = cite(
            "“Seven (7) bits are used to quantize the fundamental frequency, and 8 bits are used\n"
            "to code the V/UV decisions in 8 different frequency bands”   ·   US 5,754,974",
            INK3,
        )
        # Hang the quote off whatever is actually above it, rather than at a
        # hardcoded y. The fixed -2.22 put its first line straight through the
        # third card, over "30 amplitudes": the cards are 1.15 tall with 0.34
        # between them, so their stack reaches -2.21 and the quote's top edge
        # sat above that. Any change to a card's height or the buff would have
        # reintroduced it. Measuring means it cannot come back.
        above = min(cards.get_bottom()[1], budget.get_bottom()[1])
        quote.move_to(np.array([0.2, above - quote.height / 2 - 0.30, 0.0]))
        # The caveat that used to sit under the quote (that this is the
        # patent's example allocation, not D-STAR's, whose field layout is
        # unpublished) has been removed: at this camera position it landed on
        # top of the budget bars. It is not lost. The figcaption in
        # docs/10-the-dstar-frame.md carries the same qualification in prose,
        # where it can be read at leisure rather than in a passing frame.

        group = place(STAGE_X[5], [title, cards, *arrows, *indices, budget, quote])
        return {
            "group": group,
            "title": title,
            "cards": cards,
            "arrows": arrows,
            "indices": indices,
            "budget": budget,
            "quote": quote,
        }

    def stage_air(self) -> dict:
        title = head("One frame, on the air", "72 bits every 20 ms — and these are the real ones")
        title.move_to(np.array([0.0, 2.50, 0.0]))

        bits = bit_row(HERO_BITS).move_to(np.array([0.0, 1.15, 0.0]))
        hexs = Text(HERO_HEX, font=MONO, font_size=30, color=INK, weight="SEMIBOLD")
        hexs.move_to(np.array([0.0, 0.42, 0.0]))
        bg = badge("measured", WARM).next_to(hexs, DOWN, buff=0.20)

        # A plain sinusoid standing in for the 4800 bps GMSK carrier. Nothing
        # here modulates anything; it is a picture of "this goes on a radio".
        carrier = VMobject(stroke_color=COOL, stroke_width=2.0)
        ts = np.linspace(0.0, 1.0, 420)
        carrier.set_points_as_corners(
            [
                np.array([-6.0 + 12.0 * t, -1.20 + 0.36 * np.sin(2 * np.pi * 9 * t), 0.0])
                for t in ts
            ]
        )

        split = Text(
            "72 voice bits  +  24 data bits  =  96 bits / 20 ms  =  4800 bps",
            font=MONO,
            font_size=24,
            color=INK2,
        )
        split.move_to(np.array([0.0, -2.00, 0.0]))
        note = cite(
            "JARL D-STAR system specification §1.1(3), §2.1.2(2)\n"
            "Of the 72, about 48 carry vocoder parameters and 24 carry error correction — "
            "which bit is which is not published.",
            INK4,
        )
        note.move_to(np.array([0.0, -2.52, 0.0]))

        cells = list(bits)
        group = place(STAGE_X[6], [title, *cells, hexs, bg, split, note], drawn=(carrier,))
        return {
            "group": group,
            "drawn": [carrier],
            "title": title,
            "bits": cells,
            "hex": hexs,
            "badge": bg,
            "carrier": carrier,
            "split": split,
            "note": note,
        }

    def stage_decode(self) -> dict:
        title = head("The far end looks the indices up", "a table lookup, not a reconstruction")
        title.move_to(np.array([0.0, 2.50, 0.0]))

        bits = bit_row(HERO_BITS, pitch=0.082)
        frame_box = panel(6.6, 1.05, fill=SURF1)
        bits_g = VGroup(frame_box, bits.move_to(frame_box)).move_to(np.array([-2.9, 1.05, 0.0]))

        cards = VGroup(
            param_card("fundamental", f"{HERO_F0:.1f} Hz", WARM, width=4.6),
            param_card("voicing, 8 bands", "V V V V V V V V", COOL, width=4.6),
            param_card("spectral magnitudes", f"{HERO_L} amplitudes", ACCENT, width=4.6),
        ).arrange(DOWN, buff=0.26)
        cards.move_to(np.array([3.4, -0.30, 0.0]))

        arrows = [
            Line(
                bits_g.get_bottom() + DOWN * 0.08,
                card.get_left() + LEFT * 0.16,
                stroke_color=INK4,
                stroke_width=1.6,
            )
            for card in cards
        ]

        note = cite(
            "The decoder has never heard you. It holds the same tables the encoder searched,\n"
            "and 72 bits' worth of instruction about which entries to use.",
            INK3,
        )
        note.move_to(np.array([0.0, -2.70, 0.0]))

        card_list = list(cards)
        group = place(STAGE_X[7], [title, bits_g, *arrows, *card_list, note])
        return {
            "group": group,
            "title": title,
            "bits": bits_g,
            "arrows": arrows,
            "cards": card_list,
            "note": note,
        }

    def stage_synthesize(self) -> dict:
        title = head("Rebuild the sound", "one oscillator per voiced harmonic, noise for the rest")
        title.move_to(np.array([0.0, 2.50, 0.0]))

        # The one genuine equation in this scene, set as Pango text so that no
        # LaTeX install is needed: MBE voiced synthesis is a sum of oscillators
        # at harmonics of the fundamental, plus shaped noise in the bands
        # declared unvoiced.  Griffin & Lim 1988; US 5,701,390.
        #
        # Written with A(n) and phi(n) rather than subscript-n: U+2099 is
        # missing from the default sans face on both macOS and the Linux
        # runner, and renders as a tofu box. Subscript zero (as in omega-0)
        # is present everywhere, so that one is safe to keep.
        equation = Text(
            "ŝ(t)  =  Σ  A(n) · cos( n·ω₀·t + φ(n) )   +   noise in the unvoiced bands",
            font=SANS,
            font_size=27,
            color=INK,
        )
        equation.move_to(np.array([0.0, 1.62, 0.0]))

        board = panel(12.4, 3.2).move_to(np.array([0.0, -0.30, 0.0]))
        cy = board.get_center()[1]

        span, samples = 11.4, 460
        ts = np.linspace(0.0, 1.0, samples)
        xs = -span / 2 + span * ts

        # Four plain sinusoids at 1x..4x a display frequency, then their sum.
        # Pure illustration of "a sum of harmonics": the amplitudes are chosen
        # for legibility and are not read out of any codec.
        amps = [0.62, 0.34, 0.22, 0.14]
        harmonics = []
        for i, amp in enumerate(amps):
            ys = amp * np.sin(2 * np.pi * 4 * (i + 1) * ts)
            curve = VMobject(stroke_color=INK4, stroke_width=1.4)
            curve.set_points_as_corners(
                [np.array([x, cy + 0.55 + y * 0.50, 0.0]) for x, y in zip(xs, ys)]
            )
            harmonics.append(curve)

        total = sum(a * np.sin(2 * np.pi * 4 * (i + 1) * ts) for i, a in enumerate(amps))
        summed = VMobject(stroke_color=ACCENT, stroke_width=2.6)
        summed.set_points_as_corners(
            [np.array([x, cy - 0.85 + y * 0.42, 0.0]) for x, y in zip(xs, total)]
        )
        sum_label = Text(
            "their sum — a periodic, voiced waveform", font=SANS, font_size=20, color=ACCENT
        )
        sum_label.move_to(np.array([0.0, cy - 0.08, 0.0]))

        rng = np.random.default_rng(20260810)
        jitter = rng.normal(0.0, 0.20, samples)
        noise = VMobject(stroke_color=COOL, stroke_width=1.6)
        noise.set_points_as_corners(
            [np.array([x, cy + 1.32 + y * 0.24, 0.0]) for x, y in zip(xs, jitter)]
        )

        note = cite(
            "Voiced bands get oscillators; unvoiced bands get white noise shaped to the same envelope.\n"
            "Griffin & Lim 1988   ·   US 5,701,390",
            INK3,
        )
        note.move_to(np.array([0.0, -2.60, 0.0]))

        title_g = VGroup(title, board)
        drawn = [*harmonics, summed, noise]
        group = place(STAGE_X[8], [title_g, equation, sum_label, note], drawn=tuple(drawn))
        return {
            "group": group,
            "drawn": drawn,
            "title": title_g,
            "equation": equation,
            "harmonics": harmonics,
            "sum": summed,
            "sum_label": sum_label,
            "noise": noise,
            "note": note,
        }

    def stage_speech_out(self) -> dict:
        title = head("Speech comes out", "the same sentence, rebuilt from 3600 bits a second")
        title.move_to(np.array([0.0, 2.50, 0.0]))

        board = panel(12.4, 3.0).move_to(np.array([0.0, 0.30, 0.0]))
        wave = envelope_shape(
            WAVEFORM["decoded"]["min"], WAVEFORM["decoded"]["max"], 12.0, 1.28, COOL
        ).move_to(board)

        clip = FRAMES["clip"]
        note = cite(
            "the same clip after a round trip through a real DVSI AMBE-3000 — envelope correlation "
            f"{clip['decoded_delay_correlation']:.2f}, end-to-end delay {clip['decoded_delay_ms']:.0f} ms",
            INK3,
        )
        note.move_to(np.array([0.0, -1.55, 0.0]))
        bg = badge("measured", WARM).next_to(note, DOWN, buff=0.18)

        closing = VGroup(
            Text("72 bits.  20 milliseconds.  One voice.", font=SANS, font_size=34, color=INK),
            Text(
                "how-ambe-works   ·   every claim on the site names its source",
                font=SANS,
                font_size=19,
                color=INK4,
            ),
        ).arrange(DOWN, buff=0.22)
        closing.move_to(np.array([0.0, -2.70, 0.0]))

        title_g = VGroup(title, board)
        group = place(STAGE_X[9], [title_g, note, bg, closing], drawn=(wave,))
        return {
            "group": group,
            "drawn": [wave],
            "title": title_g,
            "wave": wave,
            "note": note,
            "badge": bg,
            "closing": closing,
        }
