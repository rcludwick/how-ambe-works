"""tools/posters/listen_terrain.py: the listen-terrain figure's fallback image,
and the numbers chapter 12 and the figure's steps quote from
tools/listen-stats.py, pinned."""

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
poster = _load("poster_listen_terrain", ROOT / "tools" / "posters" / "listen_terrain.py")
stats = _load("listen_stats", ROOT / "tools" / "listen-stats.py")
DATA = ROOT / "docs" / "assets" / "data"
CHAPTER = (ROOT / "docs" / "12-listen.md").read_text(encoding="utf-8")
# The chapter with its line breaks folded, so a test can quote a sentence.
FLAT = " ".join(CHAPTER.split())

# The figure's four clips: decoded valleys deeper by (least, most) dB over
# harmonics 1 to 7, and the loudest frame with a pitch in both files.
FIGURE_CLIPS = {
    "lr-b": ((1.7, 5.2), 8),
    "lr-c": ((2.3, 5.0), None),
    "lj-c": ((3.2, 10.4), None),
    "lj-b": ((6.3, 10.1), 123),
}


def _clip(clip_id):
    return stats.clip_stats(clip_id)


class ListenTerrainPoster(unittest.TestCase):
    def test_registered(self):
        self.assertIn("listen-terrain", posters.FIGURES)

    def test_same_bytes_twice_and_size(self):
        first = posters.png_bytes(posters.render(poster.draw))
        self.assertEqual(first, posters.png_bytes(posters.render(poster.draw)))
        self.assertEqual(posters.render(poster.draw).size, (1280, 720))
        self.assertLessEqual(len(first), 768 * 1024)

    def test_committed_png_is_current(self):
        committed = (ROOT / "docs" / "assets" / "posters" / "listen-terrain.png").read_bytes()
        self.assertEqual(committed, posters.png_bytes(posters.render(poster.draw)))

    def test_light_tokens(self):
        tokens = poster.light_tokens()
        self.assertEqual(tokens["--ambe-plot-bg"][:3], (255, 255, 255))
        for name in ("--ambe-highlight", "--ambe-diverge-neg", "--ambe-diverge-pos", "--ambe-ramp-4"):
            self.assertIn(name, tokens)

    def test_poster_draws_the_first_steps_pick(self):
        frames = json.loads((DATA / "lr-b" / "frames.json").read_text(encoding="utf-8"))["frames"]
        self.assertEqual(poster.loudest_pitched(frames), 8)


class ListenStatsPeakAboveValley(unittest.TestCase):
    def test_per_voice(self):
        ids = [c["id"] for c in json.loads((DATA / "clips.json").read_text(encoding="utf-8"))["clips"]]
        male = stats.voice_profile([i for i in ids if i.startswith("lr-")])
        female = stats.voice_profile([i for i in ids if i.startswith("lj-")])
        self.assertEqual(male["frames"], 305)
        self.assertEqual(female["frames"], 334)
        self.assertEqual([round(v, 1) for v in male["deeper_db"]], [1.3, 4.2])
        self.assertEqual([round(v, 1) for v in female["deeper_db"]], [5.6, 9.7])

    def test_figure_clips(self):
        for clip, (deeper, _) in FIGURE_CLIPS.items():
            got = _clip(clip)["peak_above_valley"]
            self.assertEqual(tuple(round(v, 1) for v in got["deeper_db"]), deeper, clip)
            # Step 7: deeper at every one of the first seven harmonics.
            self.assertTrue(all(h["deeper_db"] > 0 for h in got["harmonics"]), clip)

    def test_every_frame_reaches_the_last_valley_below_the_coded_bandwidth(self):
        for clip in ("lr-a", "lr-b", "lr-c", "lr-d", "lj-a", "lj-b", "lj-c", "lj-d"):
            frames = json.loads((DATA / clip / "frames.json").read_text(encoding="utf-8"))["frames"]
            for f in frames:
                d = f["derived"]
                for f0 in (d["orig_f0_hz"], d["decoded_f0_hz"]):
                    self.assertLess(stats.PROFILE_U[1] * f0, 3700, clip)


class ChapterTwelveNumbers(unittest.TestCase):
    """The sentences fixed from tools/listen-stats.py (design §8)."""

    def test_lr_c(self):
        s = _clip("lr-c")
        self.assertEqual(round(s["pct_energetic_pitched"]), 83)
        self.assertEqual(s["energetic_unpitched"], 14)
        self.assertIn("the 14 energetic sibilant frames with no pitch", FLAT)
        bands = s["bands_unpitched"]
        self.assertTrue(all(abs(b["energy_db"]) < 2 for b in bands[1:]))
        self.assertEqual(round(bands[0]["energy_db"], 1), -11.5)
        self.assertEqual(round(s["band_voicing_pitched"][0], 2), 0.78)
        self.assertLessEqual(round(max(s["band_voicing_unpitched"]), 2), 0.10)
        # Step 5: within 2 dB in every band over all the energetic frames.
        self.assertTrue(all(abs(b["energy_db"]) < 2 for b in s["bands_all"]))

    def test_lr_d_lj_c_lj_d(self):
        self.assertEqual(_clip("lr-d")["energetic_frames"], 47)
        self.assertIn("100% of the 47 energetic frames", FLAT)
        lj_c = _clip("lj-c")
        self.assertEqual(round(max(lj_c["band_voicing_unpitched"]), 2), 0.17)
        self.assertEqual(round(lj_c["band_voicing_pitched"][0], 2), 0.81)
        lj_d = _clip("lj-d")
        self.assertEqual(round(lj_d["pct_energetic_pitched"]), 87)
        self.assertEqual((lj_d["energetic_unpitched"], lj_d["energetic_frames"]), (9, 71))
        self.assertEqual(lj_d["channel_bytes"], 756)
        self.assertEqual(round(lj_d["duration_s"], 2), 1.67)
        self.assertIn("This 1.67-second clip takes 756 bytes in total on the air. Of its energetic frames, 87%", FLAT)

    def test_harmonic_counts_below_the_coded_bandwidth(self):
        self.assertEqual((3700 // 135, 3700 // 180), (27, 20))
        self.assertIn("only about 20 harmonics fit below 3,700 Hz instead of 27", FLAT)


if __name__ == "__main__":
    unittest.main()
