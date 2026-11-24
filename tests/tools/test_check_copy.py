"""tools/check-copy.py: the rules, the Markdown quoting exemption, the file list."""

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_copy", ROOT / "tools" / "check-copy.py")
check_copy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_copy)

DASH = chr(0x2014)
CRUCIAL = "cru" + "cial"


def rules(text: str, markdown: bool) -> list[str]:
    return [rule for _line, _col, rule, _match in check_copy.check_text(text, markdown)]


class CopyTest(unittest.TestCase):
    def test_em_dash_flagged(self):
        self.assertEqual(rules(f"one {DASH} two\n", False), ["em dash"])

    def test_we_flagged_case_insensitive(self):
        self.assertEqual(rules("So we try it.\nWe try it.\n", False), ["we", "we"])

    def test_we_inside_a_word_not_flagged(self):
        self.assertEqual(rules("weight, owe, were\n", False), [])

    def test_banned_word_and_inflection_flagged(self):
        self.assertEqual(rules(f"{CRUCIAL}ly\n", False), [f"banned: {CRUCIAL}"])

    def test_curly_apostrophe_phrase_flagged(self):
        self.assertEqual(rules("It\u2019s worth noting that\n", False), ["banned: it's worth noting"])

    def test_markdown_quotes_and_backticks_exempt(self):
        text = f'Do not write "{CRUCIAL}" or `we`.\n'
        self.assertEqual(rules(text, True), [])

    def test_markdown_quote_spanning_two_lines_exempt(self):
        text = 'Not "unfortunately we\ncannot determine it", but this.\n'
        self.assertEqual(rules(text, True), [])

    def test_code_quotes_not_exempt(self):
        self.assertEqual(rules(f'label = "{CRUCIAL}"\n', False), [f"banned: {CRUCIAL}"])

    def test_line_and_column_reported(self):
        found = check_copy.check_text(f"ok\nab {DASH}\n", False)
        self.assertEqual(found[0][:2], (2, 4))

    def test_landscape_left_to_review(self):
        self.assertEqual(rules("the patent landscape\n", False), [])

    def test_file_outside_the_repo_is_reported_not_a_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            draft = Path(tmp).resolve() / "draft.md"
            draft.write_text(f"one {DASH} two\n", encoding="utf-8")
            result = subprocess.run([sys.executable, str(ROOT / "tools" / "check-copy.py"), str(draft)],
                                    cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(f"{draft}:1:5: em dash", result.stdout)

    def test_checked_modules_join_on_their_own(self):
        names = {p.name for p in check_copy.checked_modules()}
        self.assertIn("anim-probe.js", names)  # a stub, checked JS from its first commit
        self.assertIn("view-switch.js", names)
        # A module marked /* ts-legacy */ is left out until its task converts
        # it; read from disk, so a figure task that converts one passes.
        legacy = {p.name for p in (ROOT / "docs" / "javascripts").glob("anim*.js")
                  if p.read_text(encoding="utf-8").startswith("/* ts-legacy */")}
        self.assertTrue(legacy.isdisjoint(names), legacy & names)

    def test_slot_text_keeps_only_the_slot_blocks(self):
        text = f"one {DASH}\n<!-- slot: x -->\ntwo {DASH}\n<!-- end slot: x -->\nthree {DASH}\n"
        found = check_copy.check_text(check_copy.slot_text(text), True)
        self.assertEqual([line for line, *_ in found], [3])

    def test_a_pending_block_is_skipped_until_it_changes(self):
        inner = f"\nsome {DASH} text\n"
        text = f"<!-- slot: x -->{inner}<!-- end slot: x -->\n"
        digest = check_copy.hashlib.sha256(inner.encode("utf-8")).hexdigest()
        saved = dict(check_copy.PENDING)
        check_copy.PENDING[digest] = "test"
        try:
            self.assertEqual(check_copy.check_text(check_copy.slot_text(text), True), [])
            edited = text.replace("some", "edited")
            self.assertEqual(rules(check_copy.slot_text(edited), True), ["em dash"])
        finally:
            check_copy.PENDING.clear()
            check_copy.PENDING.update(saved)

    def test_chapter_13_slots_and_chapter_8_are_listed(self):
        listed = {p.relative_to(ROOT).as_posix() for p in check_copy.listed_files()}
        self.assertIn("docs/08-analysis.md", listed)
        self.assertIn("docs/13-what-is-not-established.md", listed)

    def test_listed_files_pass(self):
        result = subprocess.run([sys.executable, str(ROOT / "tools" / "check-copy.py")],
                                cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)


if __name__ == "__main__":
    unittest.main()
