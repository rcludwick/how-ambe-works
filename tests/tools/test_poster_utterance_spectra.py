"""tools/posters/utterance_spectra.py: the utterance-spectra figure's fallback image,
and the Python mirror of its picks (tools/verify-data.py), pinned."""

import importlib.util
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
poster = _load("poster_utterance_spectra", ROOT / "tools" / "posters" / "utterance_spectra.py")
verify = _load("verify_data", ROOT / "tools" / "verify-data.py")
DATA = ROOT / "docs" / "assets" / "data"

# design §4.3: low-heavy / high-heavy window per clip (None: there is none).
EXPECTED = {
    "lj-c": (24, 62), "lr-c": (16, 36), "lj-a": (110, 108),
    "lr-a": (67, 54), "lj-d": (16, None), "lr-d": (19, None),
}


class UtteranceSpectraPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("utterance-spectra", posters.FIGURES)

    def test_same_bytes_twice_and_size(self):
        first = posters.png_bytes(posters.render(poster.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(poster.draw)))
        self.assertEqual(posters.render(poster.draw).size, (1280, 720))
        self.assertLessEqual(len(first), 512 * 1024)

    def test_committed_png_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "utterance-spectra.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(poster.draw)))

    def test_light_tokens(self):
        tokens = poster.light_tokens()
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        self.assertIn("--ambe-highlight", tokens)

    def test_picks_pinned(self):
        for clip, (low, high) in EXPECTED.items():
            spectra = json.loads((DATA / clip / "spectra.json").read_text(encoding="utf-8"))
            args = (spectra["original"], spectra["bin_centre_hz"])
            self.assertEqual(verify.SPECTRA_PICKS["low-heavy"](*args), low, clip)
            self.assertEqual(verify.SPECTRA_PICKS["high-heavy"](*args), high, clip)

    def test_poster_draws_the_first_steps_pick(self):
        spectra = json.loads((DATA / "lj-c" / "spectra.json").read_text(encoding="utf-8"))
        self.assertEqual(poster.low_heavy(spectra), 24)

    def test_energy_never_below_the_highest_bin(self):
        for clip in EXPECTED:
            spectra = json.loads((DATA / clip / "spectra.json").read_text(encoding="utf-8"))
            for bins in spectra["original"]:
                self.assertGreaterEqual(verify.total_db(bins), max(bins) - 1e-9)


if __name__ == "__main__":
    unittest.main()
