"""tools/posters/tradeoff.py: the tradeoff fallback image, and its sound against the figure's numbers."""

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


posters = _load("make_posters", ROOT / "tools" / "make-posters.py")
tradeoff = _load("poster_tradeoff", ROOT / "tools" / "posters" / "tradeoff.py")


class TradeoffPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("tradeoff", posters.FIGURES)

    def test_same_bytes_twice_and_small(self):
        first = posters.png_bytes(posters.render(tradeoff.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(tradeoff.draw)))
        self.assertLessEqual(len(first), 160 * 1024)
        self.assertEqual(posters.render(tradeoff.draw).size, (1280, 720))

    def test_committed_image_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "tradeoff.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(tradeoff.draw)))

    def test_light_background(self):
        image = posters.render(tradeoff.draw)
        self.assertEqual(image.getpixel((4, 4)), tradeoff.light_tokens()["--ambe-plot-bg"][:3])

    def test_prng_matches_lib_prng(self):
        # lib/prng.js mulberry32(1): its first three draws.
        draw = tradeoff.mulberry32(1)
        self.assertEqual([round(draw(), 12) for _ in range(3)], [0.627073940588, 0.00273572118, 0.52744703996])

    def test_sound_and_valleys_match_the_figure(self):
        # tests/figures/tradeoff-lib.spec.js pins the same depths from the JS model.
        for block, f0, want in ((20, 120, 7.04), (5, 120, 0.16), (20, 80, 1.62), (20, 150, 11.47)):
            hop, cells, fine = tradeoff.picture(f0, block)
            self.assertEqual(cells.shape, (round(400 / hop), 128))
            self.assertAlmostEqual(tradeoff.valley_depth(fine[int(75 // hop)], f0), want, places=2)


if __name__ == "__main__":
    unittest.main()
