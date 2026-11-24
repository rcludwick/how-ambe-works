"""tools/check-ts-pragma.sh against small fixture trees."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "check-ts-pragma.sh"


FIXTURE_OK = {"anim-fixture.js": "// @ts-check\nexport {};\n"}


def run(files: dict[str, str], fixtures: dict[str, str] = FIXTURE_OK) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as fixture_dir:
        for root, tree in ((tmp, files), (fixture_dir, fixtures)):
            for name, text in tree.items():
                path = Path(root) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
        env = dict(os.environ, JS_DIR=tmp, FIXTURE_DIR=fixture_dir)
        return subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)


class PragmaTest(unittest.TestCase):
    def test_new_module_with_pragma_passes(self):
        result = run({"anim-new.js": "// @ts-check\nexport {};\n"})
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_new_module_without_pragma_fails(self):
        result = run({"anim-new.js": "export {};\n"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("anim-new.js must start with // @ts-check (or /* ts-legacy */", result.stdout)

    def test_lib_module_is_checked_too(self):
        result = run({"lib/prng.js": "export {};\n"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("lib/prng.js must start with // @ts-check", result.stdout)

    def test_legacy_marker_passes_and_is_counted(self):
        result = run({"anim-bits.js": "/* ts-legacy */\nexport {};\n", "anim-new.js": "// @ts-check\n"})
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("(3 files, 1 legacy)", result.stdout)

    def test_new_module_with_the_legacy_marker_fails(self):
        for name in ("anim-probe-3d.js", "anim-filter-3d.js", "lib/newlib.js", "anim-novel.js"):
            result = run({name: "/* ts-legacy */\nexport {};\n"})
            self.assertEqual(result.returncode, 1, name)
            self.assertIn(f"check-ts-pragma: {name} carries /* ts-legacy */, which only the ten modules", result.stdout)

    def test_legacy_marker_must_be_on_line_one(self):
        result = run({"anim-bits.js": "export {};\n/* ts-legacy */\n"})
        self.assertEqual(result.returncode, 1)

    def test_converted_module_must_drop_the_marker(self):
        result = run({"anim-bits.js": "/* ts-legacy */\n// @ts-check\nexport {};\n"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("anim-bits.js has // @ts-check; remove its /* ts-legacy */ line", result.stdout)

    def test_empty_directory_fails(self):
        result = run({"other.js": "export {};\n"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("check-ts-pragma: no anim-*.js or lib/*.js under", result.stdout)

    def test_fixture_without_pragma_fails(self):
        result = run({"anim-new.js": "// @ts-check\nexport {};\n"}, {"anim-fixture.js": "export {};\n"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("anim-fixture.js must start with // @ts-check", result.stdout)

    def test_no_fixtures_fails(self):
        result = run({"anim-new.js": "// @ts-check\nexport {};\n"}, {})
        self.assertEqual(result.returncode, 1)
        self.assertIn("check-ts-pragma: no *.js under", result.stdout)

    def test_real_tree_passes(self):
        result = subprocess.run(["bash", str(SCRIPT)], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("check-ts-pragma: ok", result.stdout)


if __name__ == "__main__":
    unittest.main()
