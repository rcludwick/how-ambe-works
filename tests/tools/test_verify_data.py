"""tools/verify-data.py against the real data and against small fixtures."""

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("verify_data", ROOT / "tools" / "verify-data.py")
verify_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_data)

DOCS = ROOT / "docs"


def frames(clip: str) -> list[dict]:
    path = DOCS / "assets" / "data" / clip / "frames.json"
    return json.loads(path.read_text(encoding="utf-8"))["frames"]


def fourth_best(clip: str) -> float:
    ranked = verify_data.CRITERIA["steady"](frames(clip))
    return verify_data.steady_score(ranked[verify_data.STEADY_RANK - 1])


class RealDataTest(unittest.TestCase):
    def test_real_tree_passes(self):
        self.assertEqual(verify_data.check(DOCS, verify_data.FIGURE_CRITERIA), [])

    def test_fourth_best_scores_match_the_design_table(self):
        # Design §2, "Offered clips", data on disk on 2026-10-08.
        expected = {"lr-d": 0.807, "lj-b": 0.814, "lj-c": 0.749, "lj-d": 0.728,
                    "lr-a": 0.726, "lj-a": 0.710, "lr-c": 0.685, "lr-b": 0.523}
        for clip, score in expected.items():
            self.assertAlmostEqual(fourth_best(clip), score, places=3, msg=clip)

    def test_fricative_is_empty_for_lr_d(self):
        self.assertEqual(verify_data.CRITERIA["fricative"](frames("lr-d")), [])

    def test_vowel_and_silence_on_lr_b(self):
        # lib/picks.js gives vowel 101 and silence 3 for lr-b.
        self.assertEqual(verify_data.CRITERIA["vowel"](frames("lr-b"))[0]["i"], 101)
        self.assertEqual(verify_data.CRITERIA["silence"](frames("lr-b"))[0]["i"], 3)

    def test_figure_criteria_for_new_hosts(self):
        self.assertEqual(verify_data.FIGURE_CRITERIA, {
            "harmonic-sum": ["steady-pitched"],
            "voicing": ["vowel", "fricative", "mixed"],
            "frame-path": ["vowel", "fricative", "silence"],
        })

    def test_mixed_counts(self):
        self.assertEqual(len(verify_data.CRITERIA["mixed"](frames("lr-d"))), 21)
        self.assertEqual(len(verify_data.CRITERIA["mixed"](frames("lj-b"))), 64)


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(DOCS / "assets", self.tmp / "assets")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write_chapter(self, name: str, text: str):
        (self.tmp / name).write_text(text, encoding="utf-8")

    def test_frame_path_with_lr_d_names_the_clip(self):
        self.write_chapter("10-the-dstar-frame.md", '<div data-anim="frame-path" data-clips="lr-d"></div>\n')
        problems = verify_data.check(self.tmp, verify_data.FIGURE_CRITERIA)
        self.assertIn("frame-path: clip lr-d has no frames for criterion fricative", "\n".join(problems))

    def test_named_clip_below_the_cut(self):
        self.write_chapter("11-synthesis.md", '<div data-anim="probe" data-clips="lj-b,lr-c"></div>\n')
        problems = verify_data.check(self.tmp, {"probe": ["steady"]})
        self.assertEqual(problems, [
            "probe: clip lr-c 4th-best steadyScore 0.69 < 0.70; "
            "drop it from data-clips in docs/11-synthesis.md or regenerate",
        ])

    def test_steady_pitched_ranks_only_frames_with_an_input_f0(self):
        # Only three frames keep an input f0: "steady" still passes on the
        # unfiltered ranking, "steady-pitched" (the figure's picks) does not.
        path = self.tmp / "assets" / "data" / "lj-b" / "frames.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        ranked = verify_data.CRITERIA["steady"](doc["frames"])
        keep = {f["i"] for f in ranked[:3]}
        for frame in doc["frames"]:
            if frame["i"] not in keep:
                frame["derived"]["orig_f0_hz"] = 0
        path.write_text(json.dumps(doc), encoding="utf-8")
        self.write_chapter("11-synthesis.md", '<div data-anim="probe" data-clips="lj-b"></div>\n')
        self.assertEqual(verify_data.check(self.tmp, {"probe": ["steady"]}), [])
        self.assertEqual(verify_data.check(self.tmp, {"probe": ["steady-pitched"]}), [
            "probe: clip lj-b 4th-best steadyScore 0.00 < 0.70; "
            "drop it from data-clips in docs/11-synthesis.md or regenerate",
        ])

    def test_steady_pitched_matches_the_figure_picks_on_real_data(self):
        expected = {"lj-b": [11, 10, 50, 49], "lr-a": [86, 84, 83, 27], "lr-d": [23, 16, 22, 34]}
        for clip, picks in expected.items():
            got = [f["i"] for f in verify_data.CRITERIA["steady-pitched"](frames(clip))[:4]]
            self.assertEqual(got, picks, msg=clip)

    def test_named_clip_with_an_empty_criterion(self):
        self.write_chapter("07-multi-band-excitation.md", '<div data-anim="probe" data-clips="lr-d"></div>\n')
        problems = verify_data.check(self.tmp, {"probe": ["fricative"]})
        self.assertEqual(problems, [
            "probe: clip lr-d has no frames for criterion fricative; "
            "drop it from data-clips in docs/07-multi-band-excitation.md or regenerate",
        ])

    def test_voicing_with_lr_d_names_the_clip(self):
        self.write_chapter("07-multi-band-excitation.md", '<div data-anim="voicing" data-clips="lr-d"></div>\n')
        problems = verify_data.check(self.tmp, verify_data.FIGURE_CRITERIA)
        self.assertIn("voicing: clip lr-d has no frames for criterion fricative", "\n".join(problems))

    def test_host_with_clips_but_no_criteria_entry(self):
        self.write_chapter("09-quantization.md", '<div data-anim="mystery" data-clips="lj-b"></div>\n')
        problems = verify_data.check(self.tmp, {})
        self.assertEqual(problems, [
            "mystery (docs/09-quantization.md): has data-clips but no FIGURE_CRITERIA entry in tools/verify-data.py",
        ])

    def test_unknown_clip(self):
        self.write_chapter("11-synthesis.md", '<div data-anim="probe" data-clips="zz-q"></div>\n')
        problems = verify_data.check(self.tmp, {"probe": ["steady"]})
        self.assertEqual(problems, ["probe: clip zz-q is not in assets/data/clips.json (docs/11-synthesis.md)"])

    def test_schema_with_two_measured_fields(self):
        schema = self.tmp / "assets" / "data" / "SCHEMA.md"
        text = schema.read_text(encoding="utf-8")
        schema.write_text(text + "\n| `rms` | number | dB | **MEASURED** | wrong |\n", encoding="utf-8")
        problems = verify_data.check(self.tmp, {})
        self.assertEqual(problems, [
            "SCHEMA.md marks ['hex', 'rms'] as **MEASURED**; exactly one field, `hex`, may be. "
            "If the schema changed on purpose, revisit badges.spec.js and this check.",
        ])

    def test_bad_hex(self):
        path = self.tmp / "assets" / "data" / "lr-d" / "frames.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["frames"][3]["hex"] = "XYZ"
        path.write_text(json.dumps(doc), encoding="utf-8")
        problems = verify_data.check(self.tmp, {})
        self.assertEqual(problems, ["lr-d/frames.json: frame 3 hex 'XYZ' is not 18 lowercase hex characters"])

    def test_frame_count_mismatch(self):
        path = self.tmp / "assets" / "data" / "lr-d" / "spectra.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["decoded"].pop()
        path.write_text(json.dumps(doc), encoding="utf-8")
        problems = verify_data.check(self.tmp, {})
        self.assertEqual(problems, ["lr-d/spectra.json: decoded has 59 frames, frames.json has 60"])


if __name__ == "__main__":
    unittest.main()
