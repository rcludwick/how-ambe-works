"""tools/posters/three_numbers.py: deterministic, the right size, the light tokens, the figure's numbers."""

import importlib.util
import io
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


posters = _load("make_posters", ROOT / "tools" / "make-posters.py")
three_numbers = _load("poster_three_numbers", ROOT / "tools" / "posters" / "three_numbers.py")


class PosterThreeNumbers(unittest.TestCase):
    def test_mirrors_the_figure(self):
        source = (ROOT / "docs/javascripts/anim-three-numbers.js").read_text(encoding="utf-8")
        self.assertIn("export const SPAN = 3;", source)
        self.assertIn("export const POINTS = 720;", source)
        self.assertEqual((three_numbers.SPAN, three_numbers.POINTS), (3, 720))
        self.assertEqual(len(three_numbers.wave(1, 1, 0)), 721)

    def test_light_tokens(self):
        tokens = three_numbers.light_tokens((ROOT / "docs/stylesheets/extra.css").read_text(encoding="utf-8"))
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))

    def test_two_renders_are_identical_and_small(self):
        first = posters.png_bytes(posters.render(three_numbers.draw))
        second = posters.png_bytes(posters.render(three_numbers.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        image = Image.open(io.BytesIO(first))
        self.assertEqual(image.size, (1280, 720))
        self.assertEqual(image.getpixel((5, 5))[:3], (255, 255, 255))

    def test_committed_poster_is_current(self):
        committed = (ROOT / "docs/assets/posters/three-numbers.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(three_numbers.draw)))

    def test_registered_by_discovery(self):
        self.assertIn("three-numbers", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
