"""tools/posters/window_shapes.py: deterministic, the right size, light tokens, the model's numbers."""

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
shapes = _load("poster_window_shapes", ROOT / "tools" / "posters" / "window_shapes.py")


class PosterWindowShapes(unittest.TestCase):
    def test_the_three_windows_at_the_ends_and_in_the_middle(self):
        # tests/figures/window-shapes-lib.spec.js pins the same numbers from the JS model.
        for _, _, end in shapes.WINDOWS:
            self.assertAlmostEqual(shapes.window_at(end, 0), end, places=12)
            self.assertAlmostEqual(shapes.window_at(end, shapes.N / 2), 1, places=12)
            self.assertAlmostEqual(shapes.window_at(end, shapes.N), end, places=12)
        self.assertAlmostEqual(shapes.window_at(0.08, 37), 0.54 - 0.46 * math.cos(2 * math.pi * 37 / 160))

    def test_the_step_at_the_joint_is_twice_the_end_value(self):
        self.assertAlmostEqual(shapes.joint_step(1), 2, places=9)
        self.assertAlmostEqual(shapes.joint_step(0.08), 0.16, places=9)
        self.assertAlmostEqual(shapes.joint_step(0), 0, places=9)

    def test_energy_kept(self):
        self.assertAlmostEqual(shapes.energy_kept(1), 1, places=9)
        self.assertEqual(round(shapes.energy_kept(0) * 100, 1), 37.5)
        self.assertEqual(round(shapes.energy_kept(0.08) * 100, 1), 39.7)

    def test_chip_text(self):
        self.assertEqual(shapes.chip_text("Hann", 0), "Hann: ends 0.00, middle 1.00; no step at the joint")
        self.assertEqual(shapes.chip_text("Hamming", 0.08), "Hamming: ends 0.08, middle 1.00; a step of 0.16 at the joint")

    def test_two_renders_are_identical_small_and_on_white(self):
        first = posters.png_bytes(posters.render(shapes.draw))
        second = posters.png_bytes(posters.render(shapes.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        image = Image.open(io.BytesIO(first))
        self.assertEqual(image.size, (1280, 720))
        self.assertEqual(image.convert("RGB").getpixel((4, 4)), (255, 255, 255))

    def test_the_committed_poster_is_this_render(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "window-shapes.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(shapes.draw)))

    def test_registered_by_discovery(self):
        self.assertIn("window-shapes", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
