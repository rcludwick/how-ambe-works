"""The glossary's diagrams match tools/glossary-diagrams.py."""

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class GlossaryDiagrams(unittest.TestCase):
    def test_page_is_up_to_date(self):
        result = subprocess.run([sys.executable, str(ROOT / "tools" / "glossary-diagrams.py"), "--check"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)


if __name__ == "__main__":
    unittest.main()
