"""tools/posters/envelope.py: the envelope fallback image, and its pick against verify-data's."""

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
envelope = _load("poster_envelope", ROOT / "tools" / "posters" / "envelope.py")
verify_data = _load("verify_data", ROOT / "tools" / "verify-data.py")
FRAMES = json.loads((ROOT / "docs" / "assets" / "data" / "frames.json").read_text(encoding="utf-8"))["frames"]


class EnvelopePoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("envelope", posters.FIGURES)

    def test_same_bytes_twice_and_small(self):
        first = posters.png_bytes(posters.render(envelope.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(envelope.draw)))
        self.assertLessEqual(len(first), 120 * 1024)
        self.assertEqual(posters.render(envelope.draw).size, (1280, 720))

    def test_committed_image_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "envelope.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(envelope.draw)))

    def test_light_background(self):
        image = posters.render(envelope.draw)
        self.assertEqual(image.getpixel((4, 4)), envelope.light_tokens()["--ambe-plot-bg"][:3])

    def test_pick_matches_verify_data(self):
        self.assertEqual(envelope.voiced_stretch(FRAMES), ((95, 124), 112))
        self.assertEqual(verify_data.voiced_stretch(FRAMES), ((95, 124), 112))
        self.assertNotIn("envelope", verify_data.FIGURE_CRITERIA)  # no data-clips on its host
        self.assertIn(verify_data._check_envelope, verify_data.EXTRA_CHECKS)
        self.assertEqual(len(verify_data.CRITERIA["voiced-stretch"](FRAMES)), 30)

    def test_verify_data_flags_a_short_stretch(self):
        quiet = [{**f, "derived": {**f["derived"], "voiced": False}} for f in FRAMES]
        self.assertEqual(verify_data.voiced_stretch(quiet), None)
        self.assertEqual(verify_data.CRITERIA["voiced-stretch"](quiet), [])

    def test_levels_match_the_figure(self):
        spectra = json.loads((ROOT / "docs" / "assets" / "data" / "spectra.json").read_text(encoding="utf-8"))
        hz, label = envelope.cutoff()
        self.assertEqual((hz, label), (3700, "cutoff at 3.7 kHz"))
        dots = envelope.levels(spectra["original"][112], FRAMES[112]["derived"]["orig_f0_hz"], spectra["bin_hz"], hz)
        self.assertEqual(len(dots), 28)
        self.assertEqual([d for _, d in dots[:4]], [-18, -22, -29, -40])


if __name__ == "__main__":
    unittest.main()
