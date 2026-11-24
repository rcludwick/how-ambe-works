"""tools/posters/harmonics.py: the harmonics figure's fallback image."""

import importlib.util
import json
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


posters = _load("make_posters", ROOT / "tools" / "make-posters.py")
harmonics = _load("poster_harmonics", ROOT / "tools" / "posters" / "harmonics.py")
DATA = ROOT / "docs" / "assets" / "data"


class HarmonicsPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("harmonics", posters.FIGURES)

    def test_same_bytes_twice_size_and_weight(self):
        first = posters.png_bytes(posters.render(harmonics.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(harmonics.draw)))
        self.assertEqual(posters.render(harmonics.draw).size, (1280, 720))
        self.assertLessEqual(len(first), 80 * 1024)

    def test_committed_png_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "harmonics.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(harmonics.draw)))

    def test_light_tokens_and_highlight(self):
        tokens = harmonics.light_tokens()
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        image = posters.render(harmonics.draw)
        self.assertEqual(image.getpixel((5, 5)), (255, 255, 255))
        colours = {c for _, c in image.getcolors(1 << 20)}
        self.assertIn(tokens["--ambe-highlight"][:3], colours)

    def test_medians_from_the_json(self):
        """Each voice's median orig_f0_hz over frames at confidence 0.5 or more; the male voice has more."""
        for clip in ("lr-b", "lj-b"):
            frames = json.loads((DATA / clip / "frames.json").read_text(encoding="utf-8"))["frames"]
            f0s = sorted(f["derived"]["orig_f0_hz"] for f in frames
                         if f["derived"]["orig_f0_hz"] > 0 and f["derived"]["orig_f0_confidence"] >= 0.5)
            self.assertAlmostEqual(harmonics.median_f0(DATA, clip), sorted(f0s)[len(f0s) // 2] if len(f0s) % 2
                                   else (f0s[len(f0s) // 2 - 1] + f0s[len(f0s) // 2]) / 2)
        male = math.floor(3700 / harmonics.median_f0(DATA, "lr-b"))
        female = math.floor(3700 / harmonics.median_f0(DATA, "lj-b"))
        self.assertGreater(male, female)

    def test_host_text_matches_the_json(self):
        """The alt on both hosts, and any caption that gives numbers, prints each median to a tenth, and L = floor(3700 / f0) of it."""
        import re
        male = harmonics.median_f0(DATA, "lr-b")
        female = harmonics.median_f0(DATA, "lj-b")
        for page in ("index.md", "07-multi-band-excitation.md"):
            text = (ROOT / "docs" / page).read_text(encoding="utf-8")
            block = text[text.index("<!-- slot: harmonics -->"):text.index("<!-- end slot: harmonics -->")]
            alt = re.search(r'alt="([^"]*)"', block).group(1)
            caption = " ".join(re.search(r"<figcaption>(.*?)</figcaption>", block, re.S).group(1).split())
            # The alt always gives both medians; a short caption may not.
            for words in (alt, caption):
                pairs = re.findall(r"(\d+\.\d) Hz,? (?:with|leaves) (\d+)", words)
                if words is caption and not pairs:
                    continue
                self.assertEqual(len(pairs), 2, (page, words))
                for (f0, count), want in zip(pairs, (male, female)):
                    self.assertEqual(f0, f"{want:.1f}", page)
                    self.assertEqual(int(count), math.floor(3700 / float(f0)), page)
                    self.assertEqual(int(count), math.floor(3700 / want), page)


if __name__ == "__main__":
    unittest.main()
