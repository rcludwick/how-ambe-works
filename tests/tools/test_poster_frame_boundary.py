"""tools/posters/frame_boundary.py: deterministic, the right size, the numbers lib/boundary.js pins."""

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
poster_fb = _load("poster_frame_boundary", ROOT / "tools" / "posters" / "frame_boundary.py")


class PosterFrameBoundary(unittest.TestCase):
    def test_midpoints_match_lib_boundary(self):
        self.assertEqual([round(poster_fb.midpoint(l), 2) for l in (1, 4, 8)], [0.98, 0.73, 0.06])
        for l in (1, 4, 8):
            self.assertAlmostEqual(poster_fb.envelope(l, 10), poster_fb.midpoint(l), places=9)

    def test_dips(self):
        self.assertEqual(round(1 - poster_fb.lowest(1), 2), 0.03)
        self.assertEqual(round(1 - poster_fb.lowest(4), 2), 0.40)
        self.assertGreater(1 - poster_fb.lowest(8), 0.94)

    def test_waveform_stays_inside_its_envelope(self):
        for l in (1, 2, 3, 4):
            for i in range(0, 321, 7):
                t = i * 20 / 320
                self.assertLessEqual(abs(poster_fb.carrier(l, t)), poster_fb.envelope(l, t) + 1e-9)
        self.assertTrue(math.isclose(poster_fb.carrier(1, 0), 1.0))

    def test_two_renders_are_identical_and_small(self):
        first = posters.png_bytes(posters.render(poster_fb.draw))
        second = posters.png_bytes(posters.render(poster_fb.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 120 * 1024)
        from PIL import Image
        self.assertEqual(Image.open(io.BytesIO(first)).size, (1280, 720))

    def test_registered_by_discovery(self):
        self.assertIn("frame-boundary", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
