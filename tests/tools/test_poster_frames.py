"""tools/posters/frames.py: the frames fallback image."""

import importlib.util
import json
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
frames = _load("poster_frames", ROOT / "tools" / "posters" / "frames.py")
DATA = ROOT / "docs" / "assets" / "data"


class FramesPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("frames", posters.FIGURES)

    def test_same_bytes_twice_and_small(self):
        first = posters.png_bytes(posters.render(frames.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(frames.draw)))
        self.assertLessEqual(len(first), 80 * 1024)
        self.assertEqual(posters.render(frames.draw).size, (1280, 720))

    def test_committed_image_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "frames.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(frames.draw)))

    def test_default_frame_is_the_mixed_pick(self):
        data = json.loads((DATA / "frames.json").read_text(encoding="utf-8"))["frames"]
        self.assertEqual(frames.default_frame(data)["i"], 112)

    def test_light_tokens_with_the_highlight(self):
        tokens = frames.light_tokens()
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        image = posters.render(frames.draw)
        self.assertIn(tokens["--ambe-highlight"][:3], {c for _, c in image.getcolors(1 << 20)})

    def test_window_arithmetic(self):
        self.assertEqual(frames.WINDOW - frames.FRAME, 95)
        self.assertAlmostEqual(frames.WEIGHTS[0], 0.08)
        self.assertAlmostEqual(frames.WEIGHTS[127], 1.0)

    def test_alt_text_states_the_overlap(self):
        chapter = (ROOT / "docs" / "08-analysis.md").read_text(encoding="utf-8")
        alt = re.search(r'src="assets/posters/frames.png"[^>]*alt="([^"]*)"', chapter, re.S).group(1)
        # The alt says each 20 ms frame gets a 255-sample window, so the
        # windows overlap (by 95 of every 160 samples).
        self.assertIn("20 ms frames", alt)
        self.assertIn("overlapping 255-sample", alt)

    def test_reads_no_bit_out_of_hex(self):
        source = (ROOT / "tools" / "posters" / "frames.py").read_text(encoding="utf-8")
        self.assertNotIn(">>", source)
        self.assertNotIn("bin(", source)
        self.assertNotIn('"hex"', source)
        self.assertIsNone(re.search(r"bytes\.fromhex|fromhex\(", source))


if __name__ == "__main__":
    unittest.main()
