"""Step lists in figure hosts render Markdown (design §2, host markup).

Builds a one-page site with the project's own zensical.toml, so the test
follows any change to markdown_extensions. Needs the docs group; it calls
uv itself, so `just unit` runs it without extra flags.
"""

import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PAGE = """# Fixture

<div data-anim="fixture" markdown="1">
<figure class="anim-fallback" markdown="0">
  <img src="x.png" width="1280" height="720" alt="A fixture.">
  <figcaption>Caption with *stars* left alone.</figcaption>
</figure>
<ol class="anim-steps" markdown="{ol}">
<li data-n="1" markdown="block">A step with a source.[^gl] A [link](https://example.org) and $x^2$.</li>
</ol>
</div>

[^gl]: Griffin and Lim, 1988.
"""


def build(ol: str) -> str:
    tmp = Path(tempfile.mkdtemp())
    try:
        config = (ROOT / "zensical.toml").read_text(encoding="utf-8")
        config = re.sub(r"(?ms)^nav = \[.*?^\]\n", 'nav = [ { "Fixture" = "index.md" } ]\n', config, count=1)
        (tmp / "zensical.toml").write_text(config, encoding="utf-8")
        (tmp / "docs").mkdir()
        (tmp / "docs" / "index.md").write_text(PAGE.format(ol=ol), encoding="utf-8")
        subprocess.run(
            ["uv", "run", "--project", str(ROOT), "--locked", "--group", "docs",
             "zensical", "build", "-f", "zensical.toml"],
            cwd=tmp, check=True, capture_output=True,
        )
        html = (tmp / "site" / "index.html").read_text(encoding="utf-8")
        start = html.index('<div data-anim="fixture"')
        return html[start:html.index("</ol>", start)]
    finally:
        shutil.rmtree(tmp)


class StepMarkup(unittest.TestCase):
    def test_steps_render_markdown_when_the_list_opts_in(self):
        host = build("1")
        self.assertRegex(host, r'<sup id="fnref:gl"><a class="footnote-ref" href="#fn:gl">1</a></sup>')
        self.assertIn('<a href="https://example.org">link</a>', host)
        self.assertIn('<span class="arithmatex">', host)
        self.assertIn('<li data-n="1">', host)

    def test_fallback_figure_is_left_as_written(self):
        host = build("1")
        self.assertIn("<figcaption>Caption with *stars* left alone.</figcaption>", host)
        self.assertIn('<img src="x.png" width="1280" height="720" alt="A fixture.">', host)

    def test_without_markdown_on_the_list_the_steps_stay_raw(self):
        # The design's first draft of the markup. Kept as a test so nobody
        # drops markdown="1" from the <ol> again.
        host = build("0")
        self.assertIn("[^gl]", host)


if __name__ == "__main__":
    unittest.main()
