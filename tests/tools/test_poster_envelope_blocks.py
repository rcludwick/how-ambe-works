"""tools/posters/envelope_blocks.py: deterministic, the right size, the same numbers as lib/dct.js."""

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
blocks = _load("poster_envelope_blocks", ROOT / "tools" / "posters" / "envelope_blocks.py")


class PosterEnvelopeBlocks(unittest.TestCase):
    def test_default_frame_and_energies(self):
        m = blocks.model(ROOT / "docs" / "assets" / "data")
        self.assertEqual(m["frame"], 112)
        self.assertEqual(len(m["exact"]), 28)
        self.assertEqual(m["sizes"], [5, 5, 5, 5, 4, 4])
        self.assertEqual([round(e) for e in m["energies"]], [6266, 1301, 204, 77, 13])
        self.assertAlmostEqual(m["level"], -58.607, places=3)

    def test_dct_round_trip_and_means(self):
        values = [3.0, -1.0, 4.0, 1.0, -5.0, 9.0, 2.0]
        sizes = blocks.block_sizes(7, 2)
        self.assertEqual(sizes, [4, 3])
        for a, b in zip(blocks.keep(values, sizes, 4), values):
            self.assertAlmostEqual(a, b, places=12)
        means = blocks.keep(values, sizes, 1)
        self.assertAlmostEqual(means[0], 7 / 4, places=12)
        self.assertAlmostEqual(means[6], 2.0, places=12)

    def test_two_renders_are_identical_and_small(self):
        first = posters.png_bytes(posters.render(blocks.draw))
        second = posters.png_bytes(posters.render(blocks.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        self.assertEqual(Image.open(io.BytesIO(first)).size, (1280, 720))

    def test_registered_by_discovery(self):
        self.assertIn("envelope-blocks", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
