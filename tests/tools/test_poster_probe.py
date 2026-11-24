"""tools/posters/probe.py: deterministic, the right size, light tokens, the test's numbers."""

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
probe_poster = _load("poster_probe", ROOT / "tools" / "posters" / "probe.py")


class PosterProbe(unittest.TestCase):
    def test_the_three_panels_numbers(self):
        self.assertAlmostEqual(probe_poster.probe(200, 0)["sine_run"][-1], 80, places=9)
        self.assertAlmostEqual(probe_poster.probe(200, 90)["sine_run"][-1], 0, places=9)
        p = probe_poster.probe(200, 45)
        self.assertAlmostEqual(math.hypot(p["sine_run"][-1], p["cosine_run"][-1]), 80, places=9)
        self.assertAlmostEqual(math.atan2(p["cosine_run"][-1], p["sine_run"][-1]), math.radians(45), places=9)

    def test_matched_products_are_never_negative(self):
        self.assertGreaterEqual(min(probe_poster.probe(200, 0)["sine"]), -1e-12)

    def test_light_tokens(self):
        tokens = probe_poster.light_tokens(probe_poster.EXTRA_CSS.read_text(encoding="utf-8"))
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        self.assertEqual(tokens["--ambe-highlight"][:3], (0xCE, 0x2E, 0x09))
        self.assertIn("--ambe-ramp-4", tokens)

    def test_two_renders_are_identical_small_and_on_white(self):
        first = posters.png_bytes(posters.render(probe_poster.draw))
        second = posters.png_bytes(posters.render(probe_poster.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        image = Image.open(io.BytesIO(first))
        self.assertEqual(image.size, (1280, 720))
        self.assertEqual(image.convert("RGB").getpixel((4, 4)), (255, 255, 255))

    def test_registered_by_discovery(self):
        self.assertIn("probe", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
