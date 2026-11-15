"""tools/posters/leakage.py: deterministic, the right size, light tokens, the model's numbers."""

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
leakage = _load("poster_leakage", ROOT / "tools" / "posters" / "leakage.py")


class PosterLeakage(unittest.TestCase):
    def test_rectangular_lights_every_bin_and_buries_the_weak_tone(self):
        db = leakage.spectrum_db("rect")
        self.assertEqual(sum(1 for v in db if v > -40), 81)
        self.assertEqual([round(v, 1) for v in db[28:33]], [-28.4, -28.7, -28.4, -29.3, -29.6])
        self.assertAlmostEqual(leakage.joint_step("rect"), 2, places=9)

    def test_hann_shows_the_weak_tone_and_has_no_step(self):
        db = leakage.spectrum_db("hann")
        self.assertEqual([round(v, 1) for v in db[28:33]], [-86.6, -55.1, -49.0, -55.1, -90.8])
        self.assertEqual(sum(1 for v in db if v > -40), 6)
        self.assertEqual(leakage.joint_step("hann"), 0)

    def test_light_tokens(self):
        tokens = leakage.light_tokens(leakage.EXTRA_CSS.read_text(encoding="utf-8"))
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        self.assertEqual(tokens["--ambe-highlight"][:3], (0xCE, 0x2E, 0x09))
        self.assertEqual(leakage.ramp(tokens, 0)[:3], tokens["--ambe-ramp-0"][:3])
        self.assertEqual(leakage.ramp(tokens, 1)[:3], tokens["--ambe-ramp-4"][:3])

    def test_two_renders_are_identical_small_and_on_white(self):
        first = posters.png_bytes(posters.render(leakage.draw))
        second = posters.png_bytes(posters.render(leakage.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        image = Image.open(io.BytesIO(first))
        self.assertEqual(image.size, (1280, 720))
        self.assertEqual(image.convert("RGB").getpixel((4, 4)), (255, 255, 255))

    def test_registered_by_discovery(self):
        self.assertIn("leakage", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
