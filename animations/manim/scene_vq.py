"""How AMBE Works — scene "vq".

Slug
    vq   (for docs/03-quantization.md, at `<!-- VIDEO: vq -->`)

What it is
    A ~41 s geometric explanation of vector quantization. A cloud of parameter
    vectors in a plane; a codebook of centroids laid over it; the act of
    replacing a measured vector with the index of its nearest centroid; then
    the generalisation to higher dimensions, and why shipping an index is so
    much cheaper than shipping the vector.

    It is deliberately CONCEPTUAL AND GENERIC. Nothing on screen is an AMBE
    codebook, an AMBE parameter, or a number from any codec. The point cloud
    and the centroids are synthetic — drawn from a seeded random generator in
    this file, and the closing card says so. AMBE's real tables appear in no
    patent and in no published specification, which is the whole reason this
    scene has to be abstract; docs/06-what-isnt-published.md covers that.

Data it reads
    None. There is no AMBE data in this scene by design. (The sibling scene,
    scene_pipeline.py, is the one that draws the real captured frames.)

    The clustering here is ordinary Lloyd iteration over synthetic 2-D points —
    generic illustration maths, run once at build time so the picture is
    deterministic. It is not a codec and it trains nothing that is used.

Sources reflected on screen
    US 5,754,974 and US 5,870,405 describe AMBE-family quantization as vector
    quantization with codebook search; neither lists table contents. The
    "log2 N bits regardless of dimension" point is the ordinary information
    theory of an index and is not claimed by anyone.

Controls
    None — this is a linear video. The draggable canvas figures live in
    docs/javascripts/.

Rendering
    uvx --from manim manim -qm animations/manim/scene_vq.py VectorQuantization

    Pango Text() throughout, so no LaTeX toolchain is needed. Output is pinned
    to 1920x1080 at 30 fps whatever quality flag the CLI passes; set
    AMBE_ANIM_PREVIEW=1 to opt out for a fast local look.
"""

from __future__ import annotations

import os

import numpy as np
from manim import (
    DOWN,
    LEFT,
    ORIGIN,
    RIGHT,
    UP,
    Create,
    Dot,
    LaggedStart,
    Line,
    MovingCameraScene,
    Rectangle,
    Restore,
    RoundedRectangle,
    ManimColor,
    Text,
    VGroup,
    config,
    interpolate_color,
    rate_functions,
)

# --------------------------------------------------------------------------
# Output format. Fixed deliverable: 1920x1080, 30 fps.
# --------------------------------------------------------------------------
if not os.environ.get("AMBE_ANIM_PREVIEW"):
    config.pixel_width = 1920
    config.pixel_height = 1080
    config.frame_rate = 30

# --------------------------------------------------------------------------
# Palette — from docs/stylesheets/extra.css, dark scheme ("slate").
# --------------------------------------------------------------------------
BG = "#0c0d10"  # --ambe-bg
SURF1 = "#131419"  # --ambe-surface-1
SUNKEN = "#08090c"  # --ambe-sunken
INK = "#f2f2f7"  # --ambe-text
INK2 = "#c3c4cd"  # --ambe-text-2
INK3 = "#8d8f9b"  # --ambe-text-3
INK4 = "#5c5e6a"  # --ambe-text-4
ACCENT = "#7d8cff"  # --ambe-accent      (indigo)
WARM = "#ffb454"  # --ambe-accent-warm   (amber)
COOL = "#3ddbc0"  # --ambe-accent-cool   (teal)
AXIS = "#4a4c56"  # --ambe-plot-axis, flattened
GRID = "#212329"  # --ambe-plot-grid, flattened

config.background_color = BG

SANS = "sans-serif"
MONO = "monospace"

# --------------------------------------------------------------------------
# Synthetic illustration data. Seeded, so every render is identical.
# THESE ARE NOT CODEC NUMBERS. Three elongated Gaussian blobs, chosen only
# because real parameter clouds are correlated and lumpy rather than uniform.
# --------------------------------------------------------------------------
SEED = 20260810
K = 16  # codebook entries in the 2-D picture: 16 entries = 4 bits
N_POINTS = 260


def synthetic_cloud() -> np.ndarray:
    rng = np.random.default_rng(SEED)
    blobs = [
        ((-0.48, 0.34), ((0.052, 0.030), (0.030, 0.026)), 100),
        ((0.42, 0.46), ((0.030, -0.020), (-0.020, 0.030)), 80),
        ((0.10, -0.48), ((0.070, 0.008), (0.008, 0.018)), 80),
    ]
    parts = [
        rng.multivariate_normal(np.array(mu), np.array(cov), size=n) for mu, cov, n in blobs
    ]
    pts = np.clip(np.vstack(parts), -1.0, 1.0)
    rng.shuffle(pts)
    return pts


def lloyd(points: np.ndarray, k: int, iterations: int = 40) -> np.ndarray:
    """Plain Lloyd iteration — the textbook way to place k centroids in a
    cloud. Generic clustering on synthetic 2-D data; it touches no codec."""
    rng = np.random.default_rng(SEED + 1)
    centroids = points[rng.choice(len(points), size=k, replace=False)].copy()
    for _ in range(iterations):
        d = ((points[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
        owner = d.argmin(axis=1)
        for j in range(k):
            members = points[owner == j]
            if len(members):
                centroids[j] = members.mean(axis=0)
    return centroids


POINTS = synthetic_cloud()
CENTROIDS = lloyd(POINTS, K)
OWNER = ((POINTS[:, None, :] - CENTROIDS[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)

# The one vector the scene follows into close-up: well inside the cloud (so the
# zoom lands on something, not on empty margin) and far enough from its centroid
# that the substitution — and the error it costs — is visible.
_ERR = np.linalg.norm(POINTS - CENTROIDS[OWNER], axis=1)
_INNER = (np.abs(POINTS[:, 0]) < 0.55) & (np.abs(POINTS[:, 1]) < 0.45)
HERO_I = int(np.argmax(np.where(_INNER, _ERR, -1.0)))
HERO_P = POINTS[HERO_I]
HERO_C = int(OWNER[HERO_I])

# Plot geometry
PLOT_W, PLOT_H = 6.2, 5.5
PLOT_CENTRE = np.array([-3.45, -0.45, 0.0])
LIM = 1.12


def entry_colour(j: int) -> ManimColor:
    """A 16-step indigo-to-teal ramp, so a cell's identity reads at a glance
    without introducing a fourth accent colour."""
    return interpolate_color(ManimColor(ACCENT), ManimColor(COOL), j / (K - 1))


def to_scene(v) -> np.ndarray:
    return PLOT_CENTRE + np.array(
        [v[0] / LIM * PLOT_W / 2, v[1] / LIM * PLOT_H / 2, 0.0]
    )


# --------------------------------------------------------------------------
# Typographic helpers
# --------------------------------------------------------------------------
def title_text(s: str, size: int = 34, color: str = INK) -> Text:
    return Text(s, font=SANS, font_size=size, color=color, weight="SEMIBOLD")


def body(s: str, size: int = 23, color: str = INK2) -> Text:
    return Text(s, font=SANS, font_size=size, color=color, line_spacing=0.85)


def small(s: str, color: str = INK4) -> Text:
    return Text(s, font=SANS, font_size=19, color=color, line_spacing=0.9)


def fit(mob, max_width: float):
    """Font metrics differ between platforms; measure and scale rather than
    trusting a guess about how wide a string will come out."""
    if mob.width > max_width:
        mob.scale(max_width / mob.width)
    return mob


def card(*lines, width: float = 6.3, fill: str = SURF1) -> VGroup:
    stack = VGroup(*lines).arrange(DOWN, buff=0.20, aligned_edge=LEFT)
    fit(stack, width - 0.7)
    box = RoundedRectangle(
        width=width,
        height=stack.height + 0.7,
        corner_radius=0.16,
        stroke_color=GRID,
        stroke_width=1.4,
        fill_color=fill,
        fill_opacity=1.0,
    )
    stack.move_to(box)
    return VGroup(box, stack)


def arm(*mobs, rise: float = 0.20) -> list:
    """Hide until its moment; reveal later with Restore()."""
    for m in mobs:
        m.save_state()
        m.set_opacity(0.0)
        if rise:
            m.shift(DOWN * rise)
    return list(mobs)


def bit_block(
    n: int, colour: str, pitch: float = 0.115, max_width: float = 8.4, height: float = 0.24
) -> VGroup:
    """n little cells in a row, standing for n bits. Purely a size picture: the
    two blocks are meant to be compared by length, not counted."""
    p = min(pitch, max_width / max(n, 1))
    g = VGroup()
    for i in range(n):
        cell = Rectangle(
            width=p * 0.80,
            height=height,
            stroke_width=0.7,
            stroke_color=colour,
            fill_color=colour,
            fill_opacity=0.55,
        )
        cell.move_to(np.array([(i - (n - 1) / 2) * p, 0.0, 0.0]))
        g.add(cell)
    return g


# --------------------------------------------------------------------------
# The scene
# --------------------------------------------------------------------------
class VectorQuantization(MovingCameraScene):
    """Replace a vector with the name of the nearest stored vector."""

    def construct(self) -> None:
        cam = self.camera.frame
        cam.save_state()

        heading = VGroup(
            title_text("Vector quantization", 40),
            Text(
                "send the name of a thing, not the thing",
                font=SANS,
                font_size=24,
                color=INK3,
            ),
        ).arrange(DOWN, buff=0.16)
        heading.move_to(np.array([0.0, 3.05, 0.0]))

        plot = self.build_plot()
        dots = self.build_dots()
        centroid_marks = self.build_centroids()
        spokes = self.build_spokes()

        # Right-hand column: one card per beat.
        c_cloud = card(
            body("Every dot is one measurement."),
            small("Two numbers here, so it lives in a plane. Real vocoder\nparameters live in far more dimensions than two."),
        )
        c_book = card(
            body(f"A codebook is {K} stored vectors."),
            small("Chosen in advance, once, from a lot of recorded speech.\nBoth ends of the link hold the same table."),
        )
        c_assign = card(
            body("Quantizing is nearest-neighbour search."),
            small("Every measurement is replaced by whichever stored entry\nis closest to it. The cell it lands in is its answer."),
        )
        for c, y in ((c_cloud, 1.55), (c_book, 1.55), (c_assign, 1.55)):
            c.move_to(np.array([3.85, y, 0.0]))

        arm(heading, *dots, *centroid_marks, c_cloud, c_book, c_assign)
        arm(plot, rise=0.0)
        self.add(plot, heading, *dots, *centroid_marks, c_cloud, c_book, c_assign)

        # ---- 1. the cloud ------------------------------------------- ~8 s
        self.play(Restore(heading), Restore(plot), run_time=2.2)
        self.play(
            LaggedStart(*[Restore(d) for d in dots], lag_ratio=0.004),
            run_time=2.8,
        )
        self.play(Restore(c_cloud), run_time=1.6)

        # ---- 2. the codebook ---------------------------------------- ~13 s
        self.play(
            LaggedStart(*[Restore(m) for m in centroid_marks], lag_ratio=0.05),
            c_cloud.animate.set_opacity(0.0),
            run_time=2.6,
        )
        self.play(Restore(c_book), run_time=1.5)

        # ---- 3. assignment ------------------------------------------ ~19 s
        self.play(
            LaggedStart(*[Create(s) for s in spokes], lag_ratio=0.0025),
            *[d.animate.set_color(entry_colour(int(OWNER[i]))) for i, d in enumerate(dots)],
            c_book.animate.set_opacity(0.0),
            run_time=3.2,
        )
        self.play(Restore(c_assign), run_time=1.4)

        # ---- 4. one vector, close up -------------------------------- ~30 s
        hero_dot = dots[HERO_I]
        hero_mark = centroid_marks[HERO_C]
        halo = Dot(to_scene(HERO_P), radius=0.20, color=WARM, fill_opacity=0.0)
        halo.set_stroke(WARM, width=2.4, opacity=1.0)
        arm(halo, rise=0.0)
        self.add(halo)

        # Sized small on purpose: the close-up magnifies everything ~2.2x, so
        # these read at roughly 30 pt on screen while the camera is in tight.
        coords = Text(
            f"( {HERO_P[0]:+.4f} ,  {HERO_P[1]:+.4f} )",
            font=MONO,
            font_size=13,
            color=WARM,
        )
        coords.next_to(halo, UP, buff=0.16)
        index_chip = self.chip(f"entry {HERO_C:02d}", WARM, size=13)
        index_chip.next_to(to_scene(CENTROIDS[HERO_C]), RIGHT, buff=0.16)
        arm(coords, index_chip, rise=0.12)
        self.add(coords, index_chip)

        self.play(
            cam.animate.scale(0.46).move_to(to_scene((HERO_P + CENTROIDS[HERO_C]) / 2)),
            c_assign.animate.set_opacity(0.0),
            run_time=2.4,
            rate_func=rate_functions.ease_in_out_sine,
        )
        self.play(
            Restore(coords), Restore(halo), hero_dot.animate.set_color(WARM), run_time=1.8
        )
        self.play(
            hero_mark.animate.set_stroke(WARM, width=3.0).scale(1.35),
            Restore(index_chip),
            run_time=1.8,
        )
        self.play(cam.animate.restore(), run_time=2.2, rate_func=rate_functions.ease_in_out_sine)

        c_cost = card(
            body("Two floats in. Four bits out."),
            small(
                f"{K} entries need log₂ {K} = 4 bits. The decoder looks entry\n"
                f"{HERO_C:02d} up and gets the centroid back — never your exact vector."
            ),
        )
        c_cost.move_to(np.array([3.85, 1.55, 0.0]))
        arm(c_cost)
        self.add(c_cost)
        self.play(Restore(c_cost), run_time=1.6)

        # ---- 5. more dimensions ------------------------------------- ~41 s
        panel_bits = self.build_cost_panel()
        arm(*panel_bits["pieces"])
        self.add(*panel_bits["pieces"])

        fade_plane = [plot, *dots, *centroid_marks, *spokes, halo, coords, index_chip]
        self.play(
            *[m.animate.set_opacity(0.0) for m in fade_plane],
            c_cost.animate.set_opacity(0.0),
            heading.animate.set_opacity(0.0),
            run_time=1.6,
        )
        self.play(
            Restore(panel_bits["lead"]),
            LaggedStart(*[Restore(b) for b in panel_bits["entry"]], lag_ratio=0.05),
            run_time=2.6,
        )
        self.play(
            Restore(panel_bits["row_a"]),
            Restore(panel_bits["row_b"]),
            run_time=2.4,
        )
        self.play(Restore(panel_bits["ratio"]), run_time=1.5)
        self.play(Restore(panel_bits["closing"]), run_time=2.2)
        self.wait(1.8)

    # -- pieces ------------------------------------------------------------
    def chip(self, label: str, colour: str, size: int = 20) -> VGroup:
        t = Text(label, font=MONO, font_size=size, color=colour, weight="BOLD")
        box = RoundedRectangle(
            width=t.width + 0.22,
            height=t.height + 0.16,
            corner_radius=0.07,
            stroke_color=colour,
            stroke_width=1.4,
            fill_color=colour,
            fill_opacity=0.14,
        )
        return VGroup(box, t.move_to(box))

    def build_plot(self) -> VGroup:
        frame = RoundedRectangle(
            width=PLOT_W + 0.7,
            height=PLOT_H + 0.7,
            corner_radius=0.16,
            stroke_color=GRID,
            stroke_width=1.4,
            fill_color=SUNKEN,
            fill_opacity=1.0,
        ).move_to(PLOT_CENTRE)
        g = VGroup(frame)
        for f in (-0.5, 0.0, 0.5):
            g.add(
                Line(
                    to_scene((f, -LIM)),
                    to_scene((f, LIM)),
                    stroke_color=GRID,
                    stroke_width=1.0,
                ),
                Line(
                    to_scene((-LIM, f)),
                    to_scene((LIM, f)),
                    stroke_color=GRID,
                    stroke_width=1.0,
                ),
            )
        # Axis labels sit inside the plot so the figure never reaches past the
        # left edge of a 16:9 frame.
        xl = Text("parameter 1  →", font=SANS, font_size=17, color=INK4)
        xl.move_to(frame.get_corner(RIGHT + DOWN) + LEFT * (xl.width / 2 + 0.28) + UP * 0.30)
        yl = Text("↑  parameter 2", font=SANS, font_size=17, color=INK4)
        yl.move_to(frame.get_corner(LEFT + UP) + RIGHT * (yl.width / 2 + 0.28) + DOWN * 0.30)
        g.add(xl, yl)
        return g

    def build_dots(self) -> list:
        return [Dot(to_scene(p), radius=0.045, color=INK3) for p in POINTS]

    def build_centroids(self) -> list:
        marks = []
        for j, c in enumerate(CENTROIDS):
            m = Dot(to_scene(c), radius=0.085, color=entry_colour(j))
            m.set_stroke(INK, width=1.4, opacity=0.9)
            marks.append(m)
        return marks

    def build_spokes(self) -> list:
        spokes = []
        for i, p in enumerate(POINTS):
            j = int(OWNER[i])
            line = Line(
                to_scene(p),
                to_scene(CENTROIDS[j]),
                stroke_color=entry_colour(j),
                stroke_width=1.0,
            )
            line.set_stroke(opacity=0.45)
            spokes.append(line)
        return spokes

    def build_cost_panel(self) -> dict:
        lead = VGroup(
            title_text("Now make each entry twenty numbers instead of two.", 30),
            small(
                "Nothing about the index changes. That is the whole trick: an index costs log₂ N bits\n"
                "no matter how wide the vector it names.",
                INK3,
            ),
        ).arrange(DOWN, buff=0.22)
        fit(lead, 12.6)
        lead.move_to(np.array([0.0, 2.85, 0.0]))

        # One synthetic codebook entry, unfolded into twenty bars. Shape drawn
        # from the seeded generator in this file — it is a picture of "a vector
        # has many components", not anybody's table.
        rng = np.random.default_rng(SEED + 2)
        heights = 0.35 + 1.05 * np.abs(rng.normal(0.0, 0.55, 20)) ** 0.7
        entry = []
        for i, h in enumerate(heights):
            bh = float(min(h, 0.85))
            bar = Rectangle(
                width=0.24,
                height=bh,
                stroke_color=entry_colour(i % K),
                stroke_width=1.2,
                fill_color=entry_colour(i % K),
                fill_opacity=0.30,
            )
            bar.move_to(np.array([-2.85 + i * 0.30, 1.12 + bh / 2, 0.0]))
            entry.append(bar)
        caption = small("one codebook entry, twenty components", INK4)
        caption.move_to(np.array([0.0, 0.86, 0.0]))
        entry.append(caption)

        row_a = VGroup(
            Text(
                "send the vector    20 numbers × 16 bits  =  320 bits",
                font=MONO,
                font_size=22,
                color=INK2,
            ),
            bit_block(320, INK4, pitch=0.028),
        ).arrange(DOWN, buff=0.18)
        row_a.move_to(np.array([0.0, 0.05, 0.0]))

        row_b = VGroup(
            Text(
                "send the index     1 entry of 512      =    9 bits",
                font=MONO,
                font_size=22,
                color=COOL,
            ),
            bit_block(9, COOL, pitch=0.115),
        ).arrange(DOWN, buff=0.18)
        row_b.next_to(row_a, DOWN, buff=0.36)

        ratio = Text(
            "36× fewer bits — and the codebook is what makes the shortcut honest: it holds only\n"
            "shapes that speech actually makes, so the ones it cannot address were never worth having.",
            font=SANS,
            font_size=21,
            color=WARM,
            line_spacing=0.9,
        )
        fit(ratio, 12.6)
        ratio.next_to(row_b, DOWN, buff=0.42)

        closing = small(
            "Every vector on screen is synthetic, generated inside this file. AMBE's real codebooks are published nowhere —\n"
            "not in the JARL D-STAR specification, and not in the expired DVSI patents, which give the mechanism and the\n"
            "vector sizes without ever listing an entry.",
            INK4,
        )
        fit(closing, 12.8)
        closing.next_to(ratio, DOWN, buff=0.30)

        return {
            "lead": lead,
            "entry": entry,
            "row_a": row_a,
            "row_b": row_b,
            "ratio": ratio,
            "closing": closing,
            "pieces": [lead, *entry, row_a, row_b, ratio, closing],
        }
