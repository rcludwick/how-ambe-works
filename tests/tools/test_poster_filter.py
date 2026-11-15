"""tools/posters/filter.py: deterministic, the right size, the numbers lib/filter.js pins."""

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
poster_filter = _load("poster_filter", ROOT / "tools" / "posters" / "filter.py")


class PosterFilter(unittest.TestCase):
    def test_the_square_at_330_hz_matches_the_figure(self):
        inp, out = poster_filter.signals("square", 330)
        shift, gain, pct = poster_filter.align(inp, out)
        self.assertAlmostEqual(pct, 53.61, places=2)
        self.assertAlmostEqual(1 / gain, 1.388, places=3)
        self.assertAlmostEqual(shift / poster_filter.PER_CYCLE / 150 * 1000, 0.479, places=3)

    def test_lane_gains_match_lib_filter(self):
        gains = [round(poster_filter.response(k * 150, 330)[0], 3) for k in range(1, 7)]
        self.assertEqual(gains, [1.248, 3.497, 1.081, 0.425, 0.237, 0.154])

    def test_two_renders_are_identical_and_small(self):
        first = posters.png_bytes(posters.render(poster_filter.draw))
        second = posters.png_bytes(posters.render(poster_filter.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        self.assertEqual(Image.open(io.BytesIO(first)).size, (1280, 720))

    def test_registered_by_discovery(self):
        self.assertIn("filter", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
