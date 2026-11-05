"""tools/check-baselines.py on a small git repository (design §3.6, plan decision 8)."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_baselines", ROOT / "tools" / "check-baselines.py")
check_baselines = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_baselines)

SHOTS = "tests/figures/__screenshots__/"
FILES = [
    "screens.spec.js/desktop-filter-figure-darwin.png",
    "screens.spec.js/desktop-filter-frame-reduced-darwin.png",
    "screens.spec.js/desktop-utterance-figure-darwin.png",
    "screens.spec.js/desktop-utterance-spectra-figure-darwin.png",
    "voicing.spec.js/desktop-voicing-3d-darwin.png",
]


class Baselines(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.registry = self.repo / "registry"
        self.registry.mkdir()
        self.git("init", "-q", "-b", "base")
        self.git("config", "user.email", "t@example.org")
        self.git("config", "user.name", "Test")
        for name in FILES:
            self.shot(name, b"old")
        self.record("filter", {})
        self.record("utterance", {})
        self.record("voicing", {})
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.git("checkout", "-q", "-b", "work/x")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def shot(self, name, data=b"new"):
        target = self.repo / SHOTS / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def record(self, slug, fields):
        (self.registry / f"{slug}.json").write_text(json.dumps({"slug": slug, **fields}), encoding="utf-8")

    def problems(self, slug):
        return check_baselines.check(slug, "base", self.repo, self.registry)

    def test_own_figure_shot_and_own_spec_folder_pass(self):
        self.shot("screens.spec.js/desktop-filter-figure-darwin.png")
        self.shot("filter-3d.spec.js/desktop-filter-corner-darwin.png")
        self.assertEqual(self.problems("filter"), [])

    def test_a_shipped_figure_keeps_its_own_spec_folder(self):
        self.shot("voicing.spec.js/desktop-voicing-3d-darwin.png")
        self.assertEqual(self.problems("voicing"), [])

    def test_frame_reduced_needs_a_declared_rebaseline(self):
        self.shot("screens.spec.js/desktop-filter-frame-reduced-darwin.png")
        self.assertEqual(len(self.problems("filter")), 1)
        self.assertIn("a 2D default-state baseline", self.problems("filter")[0])
        self.record("filter", {"rebaseline": ["frame-reduced"]})
        self.assertEqual(len(self.problems("filter")), 1)  # a reason is required too
        self.record("filter", {"rebaseline": ["frame-reduced"], "rebaselineReason": "steps panel"})
        self.assertEqual(self.problems("filter"), [])

    def test_another_slugs_shot_fails(self):
        self.shot("screens.spec.js/desktop-utterance-spectra-figure-darwin.png")
        self.assertEqual(self.problems("utterance"), [
            f"{SHOTS}screens.spec.js/desktop-utterance-spectra-figure-darwin.png: not utterance's baseline"])

    def test_no_slug_lists_every_change(self):
        self.assertEqual(check_baselines.changed_baselines("base", self.repo), [])
        self.shot("screens.spec.js/desktop-filter-figure-darwin.png")
        self.shot("new.spec.js/a-darwin.png")
        self.assertEqual(check_baselines.changed_baselines("base", self.repo), [
            f"{SHOTS}new.spec.js/a-darwin.png", f"{SHOTS}screens.spec.js/desktop-filter-figure-darwin.png"])

    def test_the_default_base_is_main(self):
        # work/three-everywhere, the old default, merged and was deleted.
        self.assertEqual(check_baselines.BASE, "main")


if __name__ == "__main__":
    unittest.main()
