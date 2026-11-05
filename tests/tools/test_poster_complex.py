"""tools/posters/complex.py: deterministic, the right size, light tokens, the figure's phase."""

import importlib.util
import io
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


posters = _load("make_posters", ROOT / "tools" / "make-posters.py")
complex_poster = _load("poster_complex", ROOT / "tools" / "posters" / "complex.py")


class PosterComplex(unittest.TestCase):
    def test_the_path_ends_at_the_point_and_starts_two_turns_back(self):
        p = complex_poster.path()
        self.assertEqual(p[-1][0], 2)
        self.assertAlmostEqual(p[-1][1], math.cos(math.radians(35)), places=12)
        self.assertAlmostEqual(p[0][1], p[-1][1], places=12)
        self.assertAlmostEqual(p[0][2], math.sin(math.radians(35)), places=12)

    def test_y_is_x_a_quarter_turn_later(self):
        p = complex_poster.path()
        quarter = complex_poster.POINTS // 8
        for i in range(0, len(p) - quarter, 37):
            self.assertAlmostEqual(p[i + quarter][2], p[i][1], places=9)

    def test_light_tokens(self):
        tokens = complex_poster.light_tokens(complex_poster.EXTRA_CSS.read_text(encoding="utf-8"))
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        self.assertEqual(tokens["--ambe-highlight"][:3], (0xCE, 0x2E, 0x09))

    def test_two_renders_are_identical_small_and_on_white(self):
        first = posters.png_bytes(posters.render(complex_poster.draw))
        second = posters.png_bytes(posters.render(complex_poster.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        image = Image.open(io.BytesIO(first))
        self.assertEqual(image.size, (1280, 720))
        self.assertEqual(image.convert("RGB").getpixel((4, 4)), (255, 255, 255))

    def test_registered_by_discovery(self):
        self.assertIn("complex", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
