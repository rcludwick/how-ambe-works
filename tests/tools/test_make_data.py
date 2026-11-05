"""tools/make-data.py finds the data steps in tools/data/ (plan decision 4)."""

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("make_data", ROOT / "tools" / "make-data.py")
make_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_data)


class DataSteps(unittest.TestCase):
    def test_steps_with_main_run_in_name_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            steps = Path(tmp)
            (steps / "b_second.py").write_text("def main(out_dir):\n    return out_dir\n", encoding="utf-8")
            (steps / "a_first.py").write_text("def main(out_dir):\n    return out_dir\n", encoding="utf-8")
            (steps / "helper.py").write_text("VALUE = 1\n", encoding="utf-8")
            (steps / "_private.py").write_text("def main(out_dir):\n    raise SystemExit\n", encoding="utf-8")
            (steps / "notes.txt").write_text("not a step\n", encoding="utf-8")
            found = make_data.data_steps(str(steps))
            self.assertEqual([Path(m.__file__).name for m in found], ["a_first.py", "b_second.py"])
            self.assertEqual(found[0].main("out"), "out")

    def test_no_directory_no_steps(self):
        self.assertEqual(make_data.data_steps("/nonexistent/tools/data"), [])


if __name__ == "__main__":
    unittest.main()
