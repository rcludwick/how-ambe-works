"""tools/posters/bits.py: the bits figure's fallback image."""

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
bits = _load("poster_bits", ROOT / "tools" / "posters" / "bits.py")
DATA = ROOT / "docs" / "assets" / "data"


class BitsPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("bits", posters.FIGURES)

    def test_same_bytes_twice_size_and_weight(self):
        first = posters.png_bytes(posters.render(bits.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(bits.draw)))
        self.assertEqual(posters.render(bits.draw).size, (1280, 720))
        self.assertLessEqual(len(first), 100 * 1024)

    def test_committed_png_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "bits.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(bits.draw)))

    def test_frame_98_and_its_changes(self):
        frames = bits.frames(DATA)
        self.assertEqual(frames[bits.FRAME]["i"], 98)
        row = bits.bits(frames[98]["hex"])
        self.assertEqual(len(row), 72)
        self.assertTrue(all(b in (0, 1) for b in row))
        # Byte 0 of frame 98 is 0xf0: four ones, then four zeros, MSB first.
        self.assertEqual(frames[98]["hex"][:2], "f0")
        self.assertEqual(row[:8], [1, 1, 1, 1, 0, 0, 0, 0])
        # The count the chip, the alt text and the caption state.
        self.assertEqual(sum(bits.changed(frames)), 35)

    def test_light_tokens(self):
        tokens = bits.light_tokens()
        self.assertEqual(tokens["--ambe-plot-bg"], (255, 255, 255, 255))
        self.assertEqual(tokens["--ambe-highlight"][:3], (0xCE, 0x2E, 0x09))
        image = posters.render(bits.draw)
        self.assertEqual(image.getpixel((4, 4)), (255, 255, 255))


if __name__ == "__main__":
    unittest.main()
