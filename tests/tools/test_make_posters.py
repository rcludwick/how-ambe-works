"""tools/make-posters.py: theme tokens, the vendored font, determinism."""

import hashlib
import importlib.util
import math
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("make_posters", ROOT / "tools" / "make-posters.py")
posters = importlib.util.module_from_spec(spec)
spec.loader.exec_module(posters)

# sha256 of the fixture image's raw RGB pixels, recorded on macOS with the
# locked Pillow (plan T7 Step 4), in the light tokens since three-everywhere
# Task Z. The Linux check (Step 6) has not run yet,
# so this is known to hold on macOS only.
GOLDEN_PIXELS = "949b2294d913db27a10f8f7b6c628c489ebecfb6dd984c6590c29fbf72efa41d"


def draw_fixture(poster, data: Path) -> None:
    for x in range(80, 1201, 112):
        poster.line([(x, 80), (x, 640)], "--ambe-plot-grid", width=1)
    poster.line([(80, 640), (1200, 640)], "--ambe-plot-axis", width=2)
    points = [(80 + i * 2, 360 - 200 * math.sin(i / 40)) for i in range(561)]
    poster.line(points, "--ambe-accent-cool", width=3)
    poster.rect((80, 24, 330, 60), "--ambe-accent-warm-soft")
    poster.text((92, 28), "synthetic", 24, "--ambe-accent-warm", weight="semibold")
    poster.text((80, 660), "Fixture: mean squared error 0.031", 28, "--ambe-text-2")


class Tokens(unittest.TestCase):
    def test_reads_slate_values_from_extra_css(self):
        tokens = posters.slate_tokens((ROOT / "docs/stylesheets/extra.css").read_text(encoding="utf-8"))
        self.assertEqual(tokens["--ambe-plot-bg"], (15, 16, 21, 255))
        self.assertEqual(tokens["--ambe-accent-cool"], (61, 219, 192, 255))
        self.assertEqual(tokens["--ambe-plot-grid"], (255, 255, 255, 18))


    def test_posters_draw_in_the_light_tokens(self):
        css = (ROOT / "docs/stylesheets/extra.css").read_text(encoding="utf-8")
        light = posters.light_tokens(css)
        self.assertEqual(light["--ambe-plot-bg"], (255, 255, 255, 255))
        self.assertEqual(set(light), set(posters.slate_tokens(css)))
        self.assertEqual(posters.Poster.new().tokens, light)


class Fonts(unittest.TestCase):
    def test_uses_only_the_vendored_font(self):
        poster = posters.Poster.new()
        for weight in ("regular", "semibold"):
            self.assertTrue(Path(poster.font(20, weight).path).is_relative_to(ROOT / "tools" / "fonts"))


class Determinism(unittest.TestCase):
    def test_same_bytes_twice(self):
        self.assertEqual(posters.png_bytes(posters.render(draw_fixture)),
                         posters.png_bytes(posters.render(draw_fixture)))

    def test_size_and_golden_pixels(self):
        image = posters.render(draw_fixture)
        self.assertEqual(image.size, (1280, 720))
        self.assertEqual(hashlib.sha256(image.convert("RGB").tobytes()).hexdigest(), GOLDEN_PIXELS)


class Discover(unittest.TestCase):
    def test_finds_one_module_per_figure(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "demo_fig.py").write_text("def draw(poster, data):\n    pass\n", encoding="utf-8")
            saved = posters.POSTERS_DIR
            posters.POSTERS_DIR = Path(tmp)
            try:
                found = posters._discover()
            finally:
                posters.POSTERS_DIR = saved
        self.assertEqual(list(found), ["demo-fig"])
        self.assertTrue(callable(found["demo-fig"]))


class Main(unittest.TestCase):
    def test_no_figures_yet_is_not_an_error(self):
        saved = posters.FIGURES
        posters.FIGURES = {}
        try:
            with tempfile.TemporaryDirectory() as out:
                self.assertEqual(posters.main(["--out", out]), 0)
                self.assertEqual(list(Path(out).iterdir()), [])
        finally:
            posters.FIGURES = saved

    def test_discovers_one_drawer_per_file(self):
        saved = posters.POSTERS_DIR
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "demo_figure.py").write_text("def draw(poster, data):\n    poster.dot((10, 10), 4, '--ambe-plot-ink')\n")
            posters.POSTERS_DIR = Path(tmp)
            try:
                found = posters._discover()
            finally:
                posters.POSTERS_DIR = saved
        self.assertEqual(list(found), ["demo-figure"])
        self.assertEqual(found["demo-figure"].__name__, "draw")

    def test_unknown_slug(self):
        self.assertEqual(posters.main(["--only", "nope"]), 2)


class Discover(unittest.TestCase):
    def test_finds_one_drawer_per_file(self):
        saved = posters.POSTERS_DIR
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "demo_figure.py").write_text("def draw(poster, data):\n    pass\n", encoding="utf-8")
            posters.POSTERS_DIR = Path(tmp)
            try:
                found = posters._discover()
            finally:
                posters.POSTERS_DIR = saved
        self.assertEqual(list(found), ["demo-figure"])
        self.assertTrue(callable(found["demo-figure"]))


if __name__ == "__main__":
    unittest.main()
