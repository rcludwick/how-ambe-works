import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_scope", ROOT / "tools" / "check-scope.py")
check_scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_scope)


class CheckScope(unittest.TestCase):
    def run_on(self, name, text):
        with tempfile.TemporaryDirectory() as tmp:
            js = Path(tmp)
            (js / "lib").mkdir()
            (js / name).write_text(text, encoding="utf-8")
            return check_scope.check(js)

    def test_synthesis_api_refused(self):
        self.assertTrue(self.run_on("anim-x.js", "ctx.createPeriodicWave(a, b);"))
        self.assertTrue(self.run_on("anim-x.js", "new AudioBufferSourceNode(c);"))
        # Only the harmonics figure may synthesize, for its comb tone (Q1).
        self.assertEqual(self.run_on("anim-harmonics.js", "ctx.createPeriodicWave(a, b);"), [])

    def test_hex_read_refused_outside_allowlist(self):
        self.assertTrue(self.run_on("anim-x.js", "const h = frame.hex;"))
        self.assertEqual(self.run_on("anim-bits.js", "const h = frame.hex;"), [])

    def test_comments_and_token_destructuring_pass(self):
        self.assertEqual(self.run_on("anim-x.js", "// frames[].hex is measured\nconst { hex } = ctx.token(n);"), [])

    def test_hexbits_may_not_assemble_values(self):
        body = "export function hexBits(hex) { return (a << 3) | b; }"
        self.assertTrue(self.run_on("anim-core.js", body))

    def test_frame_hex_may_be_printed_or_split_into_bits(self):
        ok = ("const bits = hexBits(frameHex(record));\n"
              "code.textContent = frameHex(record);\n"
              "const s = `hex ${frameHex(record)}.`;\n"
              "import { frameHex } from './anim-core.js';\n")
        self.assertEqual(self.run_on("anim-x.js", ok), [])

    def test_frame_hex_may_not_be_read_as_values(self):
        for bad in ("const v = parseInt(frameHex(f).slice(0, 2), 16) >> 1;",
                    "const h = frameHex(f);",
                    "code.textContent = frameHex(f).slice(2);",
                    "const s = `${frameHex(f)[0]}`;",
                    "const b = hexBits(frameHex(f).slice(0, 4));"):
            with self.subTest(bad=bad):
                self.assertTrue(self.run_on("anim-x.js", bad))

    def test_3d_code_reads_nothing_itself(self):
        for name in ("anim-x-3d.js", "lib/scene.js", "lib/style.js", "lib/highlight.js", "lib/view-switch.js",
                     "anim-three.js"):
            for bad in ("const a = new AudioContext();", "ctx.decodeAudioData(buf);", "await fetch(url);",
                        "await loadJSON('assets/data/frames.json');", "await loadPCM(p);",
                        "const b = hexBits(frameHex(f));"):
                with self.subTest(name=name, bad=bad):
                    self.assertTrue(self.run_on(name, bad))
        # The 2D module may load its data; it hands the arrays on.
        self.assertEqual(self.run_on("anim-x.js", "await loadJSON('assets/data/frames.json');"), [])

    def test_a_lib_that_names_the_runtime_is_3d_code(self):
        for header in ('import { duration } from "../anim-three.js";\n',
                       '/** @typedef {import("../anim-three.js").ThreeContext} C */\n'):
            for name in ("lib/labels.js", "lib/orbit.js", "lib/newlib.js"):
                with self.subTest(name=name, header=header):
                    self.assertTrue(self.run_on(name, header + "await loadJSON('x');"))
        # A lib that never names the runtime is 2D code, and may load.
        self.assertEqual(self.run_on("lib/data.js", "// not anim-three.js\nawait loadJSON('x');"), [])

    def test_the_o3_clause_is_in_the_header(self):
        doc = check_scope.__doc__ or ""
        self.assertIn("or a precomputed scatter of per-frame measurements from\nthe input audio, plotted and "
                      "never sequenced or sounded", doc)

    def test_repo_passes(self):
        self.assertEqual(check_scope.check(ROOT / "docs" / "javascripts"), [])
