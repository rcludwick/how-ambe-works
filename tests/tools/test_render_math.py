"""The site's math blocks match tools/render-math.mjs, and it refuses bad blocks."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "render-math.mjs"


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(SCRIPT), *args], capture_output=True, text=True, cwd=ROOT)


class RenderMath(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write(self, text: str) -> Path:
        page = self.tmp / "page.md"
        page.write_text(text, encoding="utf-8")
        return page

    def test_pages_are_up_to_date(self):
        result = run("--check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_a_new_block_is_stale_until_rendered(self):
        page = self.write("Text.\n\n<!-- math: x_l > 0 -->\n<!-- end math -->\n\nMore.\n")
        stale = run("--check", str(page))
        self.assertEqual(stale.returncode, 1)
        self.assertIn("page.md out of date", stale.stdout)
        self.assertEqual(run(str(page)).returncode, 0)
        lines = page.read_text(encoding="utf-8").split("\n")
        self.assertEqual(lines[2], "<!-- math: x_l > 0 -->")
        self.assertTrue(lines[3].startswith('<div class="math-block" markdown="0"><span class="katex-display">'))
        self.assertIn("<math", lines[3])
        self.assertEqual(lines[4], "<!-- end math -->")
        self.assertEqual(run("--check", str(page)).returncode, 0)

    def test_hand_edited_html_is_stale(self):
        page = self.write("<!-- math: x_l > 0 -->\n<!-- end math -->\n")
        self.assertEqual(run(str(page)).returncode, 0)
        text = page.read_text(encoding="utf-8")
        page.write_text(text.replace("</span></span></div>", "</span></span> edited</div>", 1), encoding="utf-8")
        self.assertNotEqual(page.read_text(encoding="utf-8"), text)
        stale = run("--check", str(page))
        self.assertEqual(stale.returncode, 1)
        self.assertIn("page.md out of date", stale.stdout)

    def test_a_katex_version_mismatch_is_refused(self):
        version = self.tmp / "VERSION"
        version.write_text("0.0.1\n", encoding="utf-8")
        page = self.write("Text.\n")
        env = {**os.environ, "RENDER_MATH_VERSION_FILE": str(version)}
        for args in (["--check", str(page)], [str(page)]):
            result = subprocess.run(["node", str(SCRIPT), *args], capture_output=True, text=True, cwd=ROOT, env=env)
            self.assertEqual(result.returncode, 1)
            self.assertIn("differs from the vendored 0.0.1", result.stdout)

    def test_tex_with_a_double_hyphen_is_refused(self):
        result = run("--check", str(self.write("Text.\n\n<!-- math: a--b -->\n<!-- end math -->\n")))
        self.assertEqual(result.returncode, 1)
        self.assertIn('page.md:3: the TeX holds "--"', result.stdout)

    def test_bad_tex_names_the_line(self):
        result = run("--check", str(self.write("<!-- math: \\frac{1 -->\n<!-- end math -->\n")))
        self.assertEqual(result.returncode, 1)
        self.assertIn("page.md:1: KaTeX cannot render", result.stdout)

    def test_a_marker_without_its_end_is_refused(self):
        result = run("--check", str(self.write("<!-- math: x -->\nText.\n")))
        self.assertEqual(result.returncode, 1)
        self.assertIn('page.md:1: no "<!-- end math -->"', result.stdout)

    def test_a_marker_split_over_lines_is_refused(self):
        result = run("--check", str(self.write("<!-- math: x\n= y -->\n<!-- end math -->\n")))
        self.assertEqual(result.returncode, 1)
        self.assertIn("page.md:1: a math marker must be one whole line", result.stdout)


if __name__ == "__main__":
    unittest.main()
