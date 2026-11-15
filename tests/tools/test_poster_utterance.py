"""tools/posters/utterance.py: the utterance figure's fallback image."""

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
utterance = _load("poster_utterance", ROOT / "tools" / "posters" / "utterance.py")
DATA = ROOT / "docs" / "assets" / "data"


class UtterancePoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("utterance", posters.FIGURES)

    def test_same_bytes_twice_size_and_weight(self):
        first = posters.png_bytes(posters.render(utterance.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(utterance.draw)))
        self.assertEqual(posters.render(utterance.draw).size, (1280, 720))
        self.assertLessEqual(len(first), 80 * 1024)

    def test_committed_png_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "utterance.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(utterance.draw)))

    def test_cuts_match_lib_periods(self):
        # The same cuts lib/periods.js makes (tests/figures/utterance-lib.spec.js):
        # ten whole periods a vowel period apart, the largest sample a quarter
        # period into the slice that holds it, which is the second.
        win = utterance.waveform(DATA)["closeups"]["voiced"]
        period = utterance.SR / win["f0_hz"]
        cuts = utterance.cuts(win["samples"], period)
        self.assertEqual(len(cuts), 11)
        for a, b in zip(cuts, cuts[1:]):
            self.assertAlmostEqual(b - a, period, places=9)
        k = utterance.peak_period(win["samples"], period)
        self.assertEqual(k, 1)
        self.assertAlmostEqual(utterance.largest(win["samples"]) - cuts[k], period / 4, places=9)
        slices = utterance.periods(win["samples"], period)
        self.assertEqual(len(slices), 10)
        for left, right in zip(slices, slices[1:]):
            self.assertEqual(left[-1][1], right[0][1])


if __name__ == "__main__":
    unittest.main()
