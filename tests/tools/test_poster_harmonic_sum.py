"""tools/posters/harmonic_sum.py: deterministic, the right size, the same generator as lib/prng.js."""

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
harmonic_sum = _load("poster_harmonic_sum", ROOT / "tools" / "posters" / "harmonic_sum.py")


class PosterHarmonicSum(unittest.TestCase):
    def test_mulberry32_matches_lib_prng(self):
        self.assertEqual(harmonic_sum.mulberry32(0x20260810)(), 0.784643278690055)
        r = harmonic_sum.mulberry32(1)
        self.assertEqual([r(), r(), r()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522])

    def test_default_frame_is_the_top_steady_one(self):
        import json
        frames = json.loads((ROOT / "docs/assets/data/lj-b/frames.json").read_text(encoding="utf-8"))["frames"]
        self.assertEqual(harmonic_sum.top_frame(frames)["i"], 11)

    def test_two_renders_are_identical_and_small(self):
        first = posters.png_bytes(posters.render(harmonic_sum.draw))
        second = posters.png_bytes(posters.render(harmonic_sum.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        self.assertEqual(Image.open(io.BytesIO(first)).size, (1280, 720))

    def test_the_newest_harmonic_carries_the_highlight(self):
        image = posters.render(harmonic_sum.draw)
        highlight = posters.Poster.new().colour("--ambe-highlight")[:3]
        stems = image.crop((0, 140, 1280, 310)).convert("RGB").tobytes()
        hits = sum(1 for i in range(0, len(stems), 3) if tuple(stems[i:i + 3]) == highlight)
        self.assertGreater(hits, 150)

    def test_registered_by_discovery(self):
        self.assertIn("harmonic-sum", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
