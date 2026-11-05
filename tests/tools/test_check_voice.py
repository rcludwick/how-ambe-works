"""The voice check: does text read like Rob's revoice, or like the old text?

tools/check-voice.py scores text as weighted flags per 1,000 words (lower
is better) and grades it good, fair or poor. These tests do three things:

1. Pin each rule with a small example that must, or must not, be flagged.
2. Calibrate the score on real passages from before and after the revoice
   (tests/tools/voice/). Every revoiced passage must beat the old one and
   grade good. If a rule change breaks that, the score no longer measures
   what Rob asked for.
3. Hold the site to the line: every page grades good, the site as a whole
   stays under 8, and no heading or figure title is two-part.

To grade a draft: `uv run python tools/check-voice.py --score FILE`.

What it can't see: a flourish that uses none of its listed words, an
abstraction that isn't passive, a sentence that is clever but short. The
score is a floor, not a judge; tools/VOICE.md has the read-aloud test.
"""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_voice", ROOT / "tools" / "check-voice.py")
check_voice = importlib.util.module_from_spec(spec)
sys.modules["check_voice"] = check_voice
spec.loader.exec_module(check_voice)

FIXTURES = ROOT / "tests" / "tools" / "voice"
PAIRS = ["index", "ch02", "ch08", "ch09", "ch11"]
# The site passes under 8 points per 1,000 words (Rob, 2026-10-15: "set
# the prose metric to 8"). It scored 7.3 that day, with chapters 04-06, 14
# and 15 drafted. The line was 9 earlier the same day and 12 on 2026-10-14.
# On 2026-10-16 the comma and colon rules arrived and every page was split
# to meet them; the site scored 6.3 afterwards.
# On 2026-10-18 asides in parentheses became footnotes, footnotes were
# checked too, and the site scored 5.1.
PASS = 8.0


def rules(text):
    return {f.rule for f in check_voice.check_text(text)}


class Titles(unittest.TestCase):
    def test_plain_titles_pass(self):
        for title in [
            "Spectral leakage across DFT frequency bins",
            "How a hard cut leaks energy across the spectrum",
            "Why the test needs a cosine as well as a sine",
            "Unequal error protection: Golay, Hamming, and unprotected bits",
            "Fricative",
            "The rectangular, Hann and Hamming windows",
        ]:
            self.assertIsNone(check_voice.title_flags(title), title)

    def test_two_part_titles_fail(self):
        for title in [
            "The blind spot of a single test wave, and how a cosine fixes it",
            "The obvious cut, and why it leaks across the spectrum",
            "A change of coordinates, not a lossy summary",
            "Many inputs, one frame",
            "Three windows, one block",
            "One tone, one cut, and where its energy lands",
            "The budget is fixed; the voice is not",
            "Did it work?",
            "A point, a length and a turn, a complex number",
        ]:
            self.assertIsNotNone(check_voice.title_flags(title), title)


class Rules(unittest.TestCase):
    def test_flourish(self):
        self.assertIn("flourish", rules("Griffin and Lim are blunt about it, and the result is plain.\n"))
        self.assertNotIn("flourish", rules("Griffin and Lim measured it in noise and in quiet speech.\n"))

    def test_drama(self):
        self.assertIn("drama", rules("The analysis hands over a set of numbers.\n\nThe radio has 72 bits.\n\nThe next part explains it.\n"))

    def test_antithesis(self):
        self.assertIn("antithesis", rules("A perfect model estimated badly sounds worse than a mediocre one.\n"))

    def test_code_math(self):
        self.assertIn("code-math", rules("Each harmonic has an amplitude `A_l(n)` that changes over time.\n"))

    def test_passive_needs_an_actor(self):
        self.assertIn("passive", rules("Speech is quasi-stationary, so a window is applied to it.\n"))
        self.assertNotIn("passive", rules("The encoder applies a window to each frame.\n"))
        # A quotation keeps its source's wording.
        self.assertNotIn("passive", rules("> *\"Seven (7) bits are used to quantize the pitch.\"*\n"))

    def test_three_commas_cost_a_little_and_four_cost_a_lot(self):
        two = "The radio sends the pitch, the voicing, and the levels.\n"
        three = "On air, the radio sends the pitch, the voicing, and the levels.\n"
        four = "On air, every frame, the radio sends the pitch, the voicing, and the levels.\n"
        self.assertNotIn("commas", rules(two))
        self.assertIn("commas", rules(three))
        self.assertIn("many-commas", rules(four))
        self.assertNotIn("commas", rules(four))

    def test_the_oxford_comma_counts(self):
        # Rob, 2026-10-15: "don't game the commas by ignoring the oxford comma".
        self.assertEqual(check_voice.commas("You hear the pitch, the voicing, and the levels."), 2)
        self.assertEqual(check_voice.commas("You hear the pitch, the voicing and the levels."), 1)

    def test_commas_that_are_not_clauses_do_not_count(self):
        self.assertEqual(check_voice.commas("It takes 1,800 frames, or 36,000 ms."), 1)
        cite = 'The frame is 72 bits <span class="cite">US 5,754,974 (Griffin, Hardwick, DVSI, 1998)</span>.\n'
        self.assertNotIn("many-commas", rules(cite))
        self.assertNotIn("commas", rules(cite))
        notice = "AMBE, AMBE+, and AMBE+2 are trademarks of Digital Voice Systems, Inc., used here only to name them.\n"
        self.assertNotIn("many-commas", rules(notice))

    def test_a_sentence_ends_inside_bold(self):
        text = "**Next: the pitch, voicing and amplitudes.** How a frame becomes one pitch, eight flags, and a list.\n"
        self.assertNotIn("commas", rules(text))

    def test_colon(self):
        self.assertIn("colon", rules("The test has a blind spot: it misses half the signal.\n"))
        self.assertNotIn("colon", rules("The test has a blind spot. It misses half the signal.\n"))
        self.assertNotIn("colon", rules("- **Amplitude:** How tall the wave swings from zero.\n"))
        self.assertNotIn("colon", rules("The clip starts at 12:30 and the ratio is 3:1.\n"))

    def test_an_aside_in_parentheses_is_a_footnote(self):
        # Rob, 2026-10-17: parentheses become footnotes unless they point
        # to the glossary, which reads "(see fricative)".
        self.assertIn("aside", rules("Each slice lines up with the next (an average correlation of 0.95).\n"))
        self.assertIn("aside", rules("Its amplitude (loudness) may be scaled up or down.\n"))
        for kept in [
            "A fricative is noise (see [fricative](18-glossary.md#fricative)).\n",
            "Each harmonic has an amplitude A_l(n) at the point (x, y).\n",
            "The Discrete Fourier Transform (DFT) measures it.\n",
            "A sine wave goes in (dashed) and comes out (thick).\n",
            "A fricative (like \"s\" or \"sh\") is noise.\n",
            "The gain lies between 0 and 1 (0 ≤ γ ≤ 1).\n",
        ]:
            self.assertNotIn("aside", rules(kept), kept)

    def test_footnotes_are_checked_like_prose(self):
        # Rob, 2026-10-18: "run the score against the footnotes".
        text = "The tone fits.[^a] It ends.[^b]\n\n[^a]: It fits 6 cycles: one per bin.\n[^b]: A window is applied to it.\n"
        self.assertIn("colon", rules(text))
        self.assertIn("passive", rules(text))
        self.assertNotIn("colon", rules("It fits.[^a]\n\n[^a]: It fits 6 cycles.\n[^b]: It ends.\n"))
        # A source entry is like the bibliography: its commas and colons stay.
        source = "It fits.[^405]\n\n[^405]: **US 5,870,405.** *Digital transmission, over a channel, of voice, and tones*. Source: the patent.\n"
        self.assertNotIn("many-commas", rules(source))
        self.assertNotIn("colon", rules(source))

    def test_figure_needs_an_intro(self):
        bare = "Some text.\n\n<div id=\"fig-1\" data-anim=\"harmonics\" markdown=\"1\">\n</div>\n"
        good = "In **Figure 1**, drag the slider and watch the comb.\n\n<div id=\"fig-1\" data-anim=\"harmonics\" markdown=\"1\">\n</div>\n"
        self.assertIn("figure-intro", rules(bare))
        self.assertNotIn("figure-intro", rules(good))


class Calibration(unittest.TestCase):
    """The score must tell the revoice from the old text."""

    def scores(self, name):
        before = check_voice.score((FIXTURES / f"{name}.before.md").read_text(encoding="utf-8"))
        after = check_voice.score((FIXTURES / f"{name}.after.md").read_text(encoding="utf-8"))
        return before, after

    def test_every_revoiced_passage_beats_the_old_one(self):
        for name in PAIRS:
            before, after = self.scores(name)
            self.assertLess(after["score"], before["score"], name)

    def test_every_revoiced_passage_grades_good(self):
        for name in PAIRS:
            _, after = self.scores(name)
            self.assertEqual(after["grade"], "good", (name, after["score"], after["counts"]))

    def test_the_old_text_scores_far_worse_on_average(self):
        befores, afters = zip(*(self.scores(n) for n in PAIRS))
        mean_before = sum(b["score"] for b in befores) / len(PAIRS)
        mean_after = sum(a["score"] for a in afters) / len(PAIRS)
        self.assertGreater(mean_before, 3 * mean_after, (mean_before, mean_after))

    def test_the_worst_old_passages_grade_poor(self):
        for name in ("ch08", "ch09", "ch11"):
            before, _ = self.scores(name)
            self.assertEqual(before["grade"], "poor", (name, before["score"]))


class Site(unittest.TestCase):
    """The pages as they are now."""

    def test_every_page_grades_good(self):
        for page in sorted((ROOT / "docs").glob("*.md")):
            result = check_voice.score(page.read_text(encoding="utf-8"))
            self.assertEqual(result["grade"], "good", (page.name, result["score"], result["counts"]))

    def test_the_site_stays_under_its_ceiling(self):
        cost = words = 0
        for page in sorted((ROOT / "docs").glob("*.md")):
            result = check_voice.score(page.read_text(encoding="utf-8"))
            cost += result["score"] * result["words"] / 1000
            words += result["words"]
        self.assertLess(round(1000 * cost / words, 1), PASS)

    def test_no_two_part_headings_or_titles(self):
        flags = []
        for page in sorted((ROOT / "docs").glob("*.md")):
            flags += [f for f in check_voice.check_markdown(page, None) if f.rule in ("heading", "title")]
        for js in sorted((ROOT / "docs" / "javascripts").glob("anim-*.js")):
            flags += check_voice.check_js(js, None)
        self.assertEqual([f"{f.path}:{f.line}: {f.text}" for f in flags], [])


if __name__ == "__main__":
    unittest.main()
