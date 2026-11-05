"""tools/posters/voicing.py: the voicing figure's fallback image."""

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
voicing = _load("poster_voicing", ROOT / "tools" / "posters" / "voicing.py")
DATA = ROOT / "docs" / "assets" / "data"


class VoicingPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("voicing", posters.FIGURES)

    def test_same_bytes_twice_size_and_weight(self):
        first = posters.png_bytes(posters.render(voicing.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(voicing.draw)))
        self.assertEqual(posters.render(voicing.draw).size, (1280, 720))
        self.assertLessEqual(len(first), 80 * 1024)

    def test_committed_png_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "voicing.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(voicing.draw)))

    def test_ridge_split_matches_the_data(self):
        frames = voicing.frames(DATA)
        self.assertEqual(voicing.voiced_cells(frames), 267)
        flags = sum(sum(f["derived"]["band_voiced"]) for f in frames)
        self.assertEqual(voicing.voiced_cells(frames), flags)
        pieces = voicing.split(frames)
        # Every piece lies on its own side of the threshold.
        for b, i0, v0, i1, v1 in pieces["voiced"]:
            self.assertGreaterEqual(min(v0, v1), 0.55 - 1e-9, (b, i0))
        for b, i0, v0, i1, v1 in pieces["unvoiced"]:
            self.assertLessEqual(max(v0, v1), 0.55 + 1e-9, (b, i0))
        # The pieces of each band cover its whole ridge, end to end, once.
        for b in range(8):
            spans = sorted((i0, i1) for kind in pieces.values() for (bb, i0, _, i1, _) in kind if bb == b)
            self.assertEqual(spans[0][0], 0)
            self.assertEqual(spans[-1][1], len(frames) - 1)
            for (_, end), (start, _) in zip(spans, spans[1:]):
                self.assertAlmostEqual(end, start, places=9)
        # An isolated frame above the threshold still gets teal on both sides.
        crossings = sum(1 for b in range(8) for i in range(len(frames) - 1)
                        if (frames[i]["derived"]["band_voicing"][b] >= 0.55)
                        != (frames[i + 1]["derived"]["band_voicing"][b] >= 0.55))
        self.assertGreater(crossings, 0)
        self.assertGreater(len(pieces["voiced"]), sum(
            1 for b in range(8) for i in range(len(frames) - 1)
            if all(frames[k]["derived"]["band_voicing"][b] >= 0.55 for k in (i, i + 1))))

    def test_the_frame_on_screen_is_the_mixed_pick(self):
        frames = voicing.frames(DATA)
        i = voicing.mixed_frame(frames)
        # lib/picks.js "mixed", as tools/verify-data.py mirrors it.
        verify = _load("verify_data", ROOT / "tools" / "verify-data.py")
        picked = verify._mixed([{**f, "i": k} for k, f in enumerate(frames)])
        self.assertEqual(i, picked[0]["i"])
        above = sum(1 for v in frames[i]["derived"]["band_voicing"] if v >= 0.55)
        self.assertEqual(above, 3)

    def test_light_tokens(self):
        tokens = voicing.light_tokens()
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        for name in ("--ambe-highlight", "--ambe-highlight-chip", "--ambe-voiced", "--ambe-unvoiced",
                     "--ambe-accent", "--ambe-3d-floor", "--ambe-3d-grid"):
            self.assertIn(name, tokens)


if __name__ == "__main__":
    unittest.main()
