"""tools/posters/frame_path.py: the frame-path fallback image."""

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
frame_path = _load("poster_frame_path", ROOT / "tools" / "posters" / "frame_path.py")
DATA = ROOT / "docs" / "assets" / "data"


class FramePathPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("frame-path", posters.FIGURES)

    def test_same_bytes_twice_and_small(self):
        first = posters.png_bytes(posters.render(frame_path.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(frame_path.draw)))
        self.assertLessEqual(len(first), 80 * 1024)
        self.assertEqual(posters.render(frame_path.draw).size, (1280, 720))

    def test_committed_image_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "frame-path.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(frame_path.draw)))

    def test_default_frame_is_the_second_steady_pick(self):
        frames = json.loads((DATA / "lr-b" / "frames.json").read_text(encoding="utf-8"))["frames"]
        self.assertEqual(frame_path.default_frame(frames)["i"], 102)

    def test_cutoff_label_comes_from_lib(self):
        hz, label = frame_path.cutoff()
        self.assertEqual(hz, 3700)
        self.assertIn(label, (ROOT / "docs" / "javascripts" / "lib" / "cutoff.js").read_text(encoding="utf-8"))

    def test_reads_no_bit_out_of_hex(self):
        source = (ROOT / "tools" / "posters" / "frame_path.py").read_text(encoding="utf-8")
        self.assertNotIn(">>", source)
        self.assertNotIn("bin(", source)
        self.assertIsNone(re.search(r"int\([^)]*hex", source))
        self.assertIsNone(re.search(r"bytes\.fromhex|fromhex\(", source))


if __name__ == "__main__":
    unittest.main()
