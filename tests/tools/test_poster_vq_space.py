"""tools/posters/vq_space.py: the Python port matches lib/vq.js, and the
poster is deterministic and small."""

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


vq = _load("poster_vq_space", ROOT / "tools" / "posters" / "vq_space.py")
posters = _load("make_posters", ROOT / "tools" / "make-posters.py")


class Port(unittest.TestCase):
    def test_reference_sequence(self):
        r = vq.mulberry32(1)
        self.assertEqual([r(), r(), r()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522])

    def test_grid_and_codebook_match_the_js(self):
        # The plan's measured facts for lib/vq.js, 3 numbers, 6 bits, stretch 0.9.
        pts = vq.make_cloud(0.9, 45)
        grid = vq.grid_quantize(pts, 3, 6)
        self.assertEqual(f"{grid['mse']:.4f}", "0.0183")
        self.assertEqual(grid["empty"], 55)
        book = vq.grid_codebook(pts, 3, 6)
        vq.train(pts, 3, book)
        stats = vq.codebook_stats(pts, 3, book)
        self.assertEqual(f"{stats['mse']:.4f}", "0.0004")
        self.assertEqual(stats["used"], 64)

    def test_two_numbers_match_the_js(self):
        pts = vq.make_cloud(0.5, 45)
        grid = vq.grid_quantize(pts, 2, 4)
        self.assertEqual((f"{grid['mse']:.4f}", grid["empty"]), ("0.0154", 7))


class Colours(unittest.TestCase):
    def test_cell_category_matches_the_js_mix(self):
        # lib/vq.js cellCategory: (2 qx + 5 qy + 4 qz) mod 8, x most significant.
        self.assertEqual(vq.cell_category(0, 3, 6), 0)
        self.assertEqual(vq.cell_category(1, 3, 6), 4)  # qz = 1
        self.assertEqual(vq.cell_category(4, 3, 6), 5)  # qy = 1
        self.assertEqual(vq.cell_category(16, 3, 6), 2)  # qx = 1
        self.assertEqual(vq.cell_category(63, 3, 6), (6 + 15 + 12) % 8)


class Poster(unittest.TestCase):
    def test_axis_labels_named(self):
        names = [text for text, _, _, tick in vq.AXIS_LABELS if not tick]
        self.assertEqual(names, ["first number", "second number", "third number"])

    def test_deterministic_size_and_weight(self):
        first = posters.png_bytes(posters.render(vq.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(vq.draw)))
        self.assertEqual(posters.render(vq.draw).size, (1280, 720))
        self.assertLessEqual(len(first), 80 * 1024)

    def test_registered_by_discovery(self):
        self.assertIn("vq-space", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
