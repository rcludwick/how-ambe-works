"""tools/posters/fec_protection.py: the fec-protection figure's fallback image."""

import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


posters = _load("make_posters", ROOT / "tools" / "make-posters.py")
fec = _load("poster_fec_protection", ROOT / "tools" / "posters" / "fec_protection.py")


class FecPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("fec-protection", posters.FIGURES)

    def test_same_bytes_twice_size_and_weight(self):
        first = posters.png_bytes(posters.render(fec.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(fec.draw)))
        self.assertEqual(posters.render(fec.draw).size, (1280, 720))
        self.assertLessEqual(len(first), 100 * 1024)

    def test_committed_png_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "fec-protection.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(fec.draw)))

    def test_interleaver_matches_lib_fec(self):
        js = (ROOT / "docs" / "javascripts" / "lib" / "fec.js").read_text(encoding="utf-8")
        constant = re.search(r'export const INTERLEAVER =\s*"(\d+)"', js).group(1)
        self.assertEqual(constant, fec.INTERLEAVER)
        order = fec.air_order()
        worst = min(b - a for a in range(144) for b in range(a + 1, 144) if order[a][0] == order[b][0])
        self.assertGreaterEqual(worst, 6)

    def test_the_numbers_the_caption_states(self):
        self.assertEqual(round(fec.fail_prob(23, 3, 0.05) * 100, 1), 2.6)
        self.assertEqual(round(fec.fail_prob(15, 1, 0.05) * 100), 17)
        self.assertEqual(round(fec.fail_prob(7, 0, 0.05) * 100), 30)
        self.assertEqual(fec.errors_per_vector(), [1, 1, 1, 1, 2, 0, 1, 0])

    def test_light_tokens(self):
        image = posters.render(fec.draw)
        self.assertEqual(image.getpixel((4, 4)), (255, 255, 255))
        self.assertEqual(fec.light_tokens()["--ambe-highlight"][:3], (0xCE, 0x2E, 0x09))


if __name__ == "__main__":
    unittest.main()
