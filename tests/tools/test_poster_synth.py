"""tools/posters/synth.py: deterministic, the right size, the figure's numbers for frame 98."""

import importlib.util
import io
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


posters = _load("make_posters", ROOT / "tools" / "make-posters.py")
synth = _load("poster_synth", ROOT / "tools" / "posters" / "synth.py")
DATA = ROOT / "docs" / "assets" / "data"


class PosterSynth(unittest.TestCase):
    def test_frame_98_matches_the_chip(self):
        frames = json.loads((DATA / "frames.json").read_text(encoding="utf-8"))["frames"]
        decoded = json.loads((DATA / "spectra.json").read_text(encoding="utf-8"))["decoded"]
        model = synth.frame_model(frames, decoded, 98)
        self.assertAlmostEqual(model["f0"], 110.1)
        self.assertEqual(sum(1 for v in model["voiced"] if v), 1)
        self.assertEqual(len(model["harmonics"]), 36)
        self.assertEqual(sum(1 for h in model["harmonics"] if h["voiced"]), 4)

    def test_frames_86_to_110_exist(self):
        frames = json.loads((DATA / "frames.json").read_text(encoding="utf-8"))["frames"]
        self.assertGreater(len(frames), synth.SELECTED + synth.SIDE)
        self.assertGreaterEqual(synth.SELECTED - synth.SIDE, 0)

    def test_two_renders_are_identical_and_small(self):
        first = posters.png_bytes(posters.render(synth.draw))
        second = posters.png_bytes(posters.render(synth.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 200 * 1024)
        from PIL import Image
        self.assertEqual(Image.open(io.BytesIO(first)).size, (1280, 720))

    def test_registered_by_discovery(self):
        self.assertIn("synth", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
