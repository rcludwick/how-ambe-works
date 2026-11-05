"""tools/check-slots.py on a small git repository (plan decision 15)."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_slots", ROOT / "tools" / "check-slots.py")
check_slots = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_slots)

MANIFEST = {
    "base": "base",
    "markers": {".css": ["/* slot: {slug} */", "/* end slot: {slug} */"],
                ".md": ["<!-- slot: {slug} -->", "<!-- end slot: {slug} -->"]},
    "slugs": {
        "filter": {"files": ["docs/javascripts/anim-filter.js", "tests/figures/registry/filter.json"],
                   "blocks": {"anim.css": 1, "ch01.md": 1}},
        "utterance": {"files": ["docs/javascripts/anim-utterance.js"], "blocks": {"anim.css": 1, "ch01.md": 1}},
    },
}

CSS = """.shared { color: red; }

/* slot: utterance */
/* end slot: utterance */

/* slot: filter */
/* end slot: filter */
"""

CH01 = """# One

<!-- slot: utterance -->

<div data-anim="utterance"></div>

<!-- end slot: utterance -->

Shared prose.

<!-- slot: filter -->

<div data-anim="filter"></div>

The residual paragraph.

<!-- end slot: filter -->
"""


class Slots(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.git("init", "-q", "-b", "base")
        self.git("config", "user.email", "t@example.org")
        self.git("config", "user.name", "Test")
        self.write("anim.css", CSS)
        self.write("ch01.md", CH01)
        self.write("docs/javascripts/anim-filter.js", "export {};\n")
        self.write("docs/javascripts/anim-utterance.js", "export {};\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.git("checkout", "-q", "-b", "work/filter")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def problems(self):
        return check_slots.check("filter", "base", MANIFEST, self.repo)

    def test_empty_diff_passes(self):
        self.assertEqual(self.problems(), [])

    def test_edits_inside_own_blocks_and_own_files_pass(self):
        self.write("anim.css", CSS.replace("/* slot: filter */\n", "/* slot: filter */\n.filter { gap: 1rem; }\n"))
        self.write("ch01.md", CH01.replace("The residual paragraph.", "The residual paragraph,\nrewritten."))
        self.write("docs/javascripts/anim-filter.js", "// @ts-check\nexport {};\n")
        self.write("tests/figures/registry/filter.json", "{}\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "filter")
        self.assertEqual(self.problems(), [])

    def test_uncommitted_edits_count(self):
        self.write("ch01.md", CH01.replace("Shared prose.", "Shared prose, edited."))
        self.assertEqual(self.problems(), ["ch01.md:9: removed outside filter's slots",
                                           "ch01.md:9: added outside filter's slots"])

    def test_edit_in_another_slugs_block_fails(self):
        self.write("anim.css", CSS.replace("/* slot: utterance */\n", "/* slot: utterance */\n.u { gap: 0; }\n"))
        self.assertEqual(self.problems(), ["anim.css:4: added outside filter's slots"])

    def test_marker_line_change_fails(self):
        self.write("anim.css", CSS.replace("/* end slot: filter */\n", ""))
        self.assertIn("anim.css:7: a slot marker changed", self.problems())

    def test_unowned_file_fails(self):
        self.write("docs/javascripts/anim-utterance.js", "// edited\n")
        self.write("docs/javascripts/lib/new.js", "export {};\n")
        self.assertEqual(sorted(self.problems()), [
            "docs/javascripts/anim-utterance.js: not filter's (tools/slots.json)",
            "docs/javascripts/lib/new.js: not filter's (tools/slots.json)",
        ])

    def test_inventory_counts_blocks_and_pairs_markers(self):
        self.assertEqual(check_slots.inventory(MANIFEST, self.repo), [])
        self.write("ch01.md", CH01.replace("<!-- end slot: utterance -->\n", ""))
        problems = check_slots.inventory(MANIFEST, self.repo)
        self.assertIn("ch01.md:10: slot filter opens inside slot utterance", problems)
        self.assertIn("ch01.md: 0 blocks for utterance, slots.json lists 1", problems)

    def test_the_repo_manifest_lists_every_slug_and_its_blocks_exist(self):
        manifest = check_slots.load()
        self.assertEqual(len(manifest["slugs"]), 24)
        self.assertEqual(check_slots.inventory(manifest), [])
        for slug, entry in manifest["slugs"].items():
            self.assertIn("docs/javascripts/anim.js", entry["blocks"], slug)
            self.assertIn("docs/stylesheets/anim.css", entry["blocks"], slug)
            self.assertIn(f"tests/figures/registry/{slug}.json", entry["files"], slug)

    def test_the_default_base_is_main(self):
        # work/three-everywhere, the old default, merged and was deleted.
        self.assertEqual(check_slots.load()["base"], "main")


if __name__ == "__main__":
    unittest.main()
