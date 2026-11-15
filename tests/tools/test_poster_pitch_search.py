"""tools/posters/pitch_search.py: deterministic, the right size, the light tokens, the figure's numbers."""

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
pitch = _load("poster_pitch_search", ROOT / "tools" / "posters" / "pitch_search.py")


class PosterPitchSearch(unittest.TestCase):
    def test_mirrors_the_figure(self):
        source = (ROOT / "docs/javascripts/lib/pitch.js").read_text(encoding="utf-8")
        self.assertIn("export const P_MIN = 22;", source)
        self.assertIn("export const P_MAX = 114;", source)
        self.assertEqual((pitch.P_MIN, pitch.P_MAX, pitch.N), (22, 114, 255))
        figure = (ROOT / "docs/javascripts/anim-pitch-search.js").read_text(encoding="utf-8")
        self.assertIn("frame: [-25, 50]", figure)
        self.assertEqual(pitch.PSI_DOMAIN, (-25, 50))

    def test_scores(self):
        doc = json.loads((ROOT / "docs/assets/data/lr-b/correlogram.json").read_text(encoding="utf-8"))
        phi = pitch.phi_of(doc["window"]["samples"])
        self.assertAlmostEqual(phi[0], 1.0)
        self.assertEqual(round(pitch.psi(phi, 46), 2), 44.45)
        self.assertEqual(round(pitch.psi(phi, 23), 2), 34.92)

    def test_subtitle_names_the_peaks_each_comb_lands_on(self):
        # φ's second-tallest peak is at 23, not 92: the comb at 46 misses it.
        self.assertNotIn("every tall peak", pitch.SUBTITLE)
        self.assertIn("46, 92 and 138", pitch.SUBTITLE)
        self.assertIn("23 and 69", pitch.SUBTITLE)
        doc = json.loads((ROOT / "docs/assets/data/lr-b/correlogram.json").read_text(encoding="utf-8"))
        phi = pitch.phi_of(doc["window"]["samples"])
        self.assertGreater(phi[23], phi[92])

    def test_light_tokens(self):
        tokens = pitch.light_tokens((ROOT / "docs/stylesheets/extra.css").read_text(encoding="utf-8"))
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        self.assertIn("--ambe-highlight", tokens)

    def test_two_renders_are_identical_and_small(self):
        first = posters.png_bytes(posters.render(pitch.draw))
        second = posters.png_bytes(posters.render(pitch.draw))
        self.assertEqual(first, second)
        self.assertLessEqual(len(first), 80 * 1024)
        from PIL import Image
        image = Image.open(io.BytesIO(first))
        self.assertEqual(image.size, (1280, 720))
        self.assertEqual(image.getpixel((5, 5))[:3], (255, 255, 255))

    def test_committed_poster_is_current(self):
        committed = (ROOT / "docs/assets/posters/pitch-search.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(pitch.draw)))

    def test_registered_by_discovery(self):
        self.assertIn("pitch-search", posters.FIGURES)


if __name__ == "__main__":
    unittest.main()
