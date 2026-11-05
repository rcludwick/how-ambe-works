"""tools/posters/gain_definitions.py and tools/gain-stats.py: the figure's numbers, a deterministic poster."""

import importlib.util
import io
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "docs" / "assets" / "data"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


posters = _load("make_posters", ROOT / "tools" / "make-posters.py")
gain_poster = _load("poster_gain_definitions", ROOT / "tools" / "posters" / "gain_definitions.py")
gain = _load("gain_stats", ROOT / "tools" / "gain-stats.py")


class GainStats(unittest.TestCase):
    def test_the_pinned_numbers_hold(self):
        self.assertEqual(gain.check(DATA), [])
        self.assertEqual(gain.stats(gain.gain_frames(DATA)), gain.PINNED)

    def test_g_e_is_never_below_g_l(self):
        for f in gain.gain_frames(DATA):
            self.assertGreaterEqual(f["gap"], 0)

    def test_a_flat_comb_has_no_gap(self):
        frame = {"i": 0, "t": 0.0, "derived": {"decoded_f0_hz": 125.0, "voiced": True, "orig_rms_dbfs": -20}}
        row = [-30.0] * 128
        record = gain.gain_frame(frame, row)
        self.assertAlmostEqual(record["gap"], 0, places=9)
        self.assertAlmostEqual(record["sigma"], 0, places=9)
        self.assertEqual(record["L"], 29)

    def test_a_floor_level_drops_the_frame(self):
        frame = {"i": 0, "t": 0.0, "derived": {"decoded_f0_hz": 125.0, "voiced": True, "orig_rms_dbfs": -20}}
        row = [-30.0] * 128
        row[40:] = [-100.0] * 88
        self.assertIsNone(gain.gain_frame(frame, row))

    def test_percentile_is_linear(self):
        self.assertEqual(gain.percentile([1, 2, 3, 4], 50), 2.5)
        self.assertAlmostEqual(gain.percentile([0, 10], 10), 1.0)


class PosterGainDefinitions(unittest.TestCase):
    def test_the_pair(self):
        frames, sel, partner = gain_poster.the_pair(DATA)
        self.assertEqual(len(frames), 661)
        self.assertEqual((sel["clip"], sel["i"], partner["clip"], partner["i"]), ("lr-a", 96, "lj-c", 52))
        self.assertLessEqual(abs(sel["sigma"] - partner["sigma"]), 0.25)

    def test_light_tokens(self):
        tokens = gain_poster.light_tokens(gain_poster.EXTRA_CSS.read_text(encoding="utf-8"))
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        self.assertEqual(tokens["--ambe-highlight"][:3], (0xCE, 0x2E, 0x09))

    def test_two_renders_are_identical_small_and_on_white(self):
        first = posters.png_bytes(posters.render(gain_poster.draw))
        second = posters.png_bytes(posters.render(gain_poster.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 120 * 1024)
        from PIL import Image
        image = Image.open(io.BytesIO(first))
        self.assertEqual(image.size, (1280, 720))
        self.assertEqual(image.convert("RGB").getpixel((4, 4)), (255, 255, 255))

    def test_the_committed_poster_is_current(self):
        self.assertEqual((ROOT / "docs" / "assets" / "posters" / "gain-definitions.png").read_bytes(),
                         posters.png_bytes(posters.render(gain_poster.draw)))

    def test_registered_by_discovery(self):
        self.assertIn("gain-definitions", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
