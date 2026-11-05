"""tools/verify-site.py against small built-site fixtures."""

import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("verify_site", ROOT / "tools" / "verify-site.py")
verify_site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_site)


class SiteFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.site = self.tmp / "site"
        self.docs = self.tmp / "docs"
        self.docs.mkdir()
        js = self.site / "javascripts"
        js.mkdir(parents=True)
        (js / "anim.js").write_text('import "./anim-filter.js";\nimport "./anim-bits.js";\n', encoding="utf-8")
        (js / "anim-filter.js").write_text("export {};\n", encoding="utf-8")
        (js / "anim-bits.js").write_text("export {};\n", encoding="utf-8")
        (js / "anim-three.js").write_text("export {};\n", encoding="utf-8")
        data = self.site / "assets" / "data"
        data.mkdir(parents=True)
        (data / "frames.json").write_text("{}", encoding="utf-8")
        vendor = self.site / "javascripts" / "vendor" / "three"
        vendor.mkdir(parents=True)
        (vendor / "addons").mkdir()
        for name in verify_site.VENDOR_FILES:
            (vendor / name).write_text(f"export {{}}; // {name}\n", encoding="utf-8")
        (vendor / "LICENSE").write_text("MIT\n", encoding="utf-8")
        (vendor / "VERSION").write_text("0.185.1\n", encoding="utf-8")
        self.real_sha256 = verify_site.THREE_SHA256
        verify_site.THREE_SHA256 = {
            name: hashlib.sha256((vendor / name).read_bytes()).hexdigest()
            for name in verify_site.VENDOR_FILES
        }
        self.package = self.tmp / "package.json"
        self.package.write_text('{"devDependencies": {"@types/three": "0.185.1"}}', encoding="utf-8")

    def tearDown(self):
        verify_site.THREE_SHA256 = self.real_sha256
        shutil.rmtree(self.tmp)

    def page(self, path: str, body: str):
        target = self.site / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"<html><body>{body}</body></html>", encoding="utf-8")

    def problems(self, registry: list[dict] | None = None) -> list[str]:
        return verify_site.check(self.site, self.docs, self.package, registry or [])[0]

    def module(self, name: str, text: str = "export {};\n", size: int = 0):
        """Write site/javascripts/<name>, padded with `size` random hex digits (about size / 2 gzip)."""
        target = self.site / "javascripts" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if size:
            target.write_bytes(text.encode() + b"/*" + os.urandom(size).hex().encode()[:size] + b"*/\n")
        else:
            target.write_text(text, encoding="utf-8")

    def register(self, line: str):
        with open(self.site / "javascripts" / "anim.js", "a", encoding="utf-8") as entry:
            entry.write(line + "\n")

    def test_relative_image_must_resolve_inside_site(self):
        posters = self.site / "assets" / "posters"
        posters.mkdir(parents=True)
        (posters / "p.png").write_bytes(b"png")
        self.page("10-ch/index.html", '<img src="../assets/posters/p.png">')
        self.assertEqual([p for p in self.problems() if "img" in p], [])
        self.page("10-ch/index.html", '<img src="../../assets/posters/p.png">')
        self.assertTrue(any("outside site/" in p for p in self.problems()))
        self.page("10-ch/index.html", '<img src="../assets/posters/q.png">')
        self.assertTrue(any("missing from site/" in p for p in self.problems()))
        self.page("10-ch/index.html", '<img src="https://example.org/x.png"><img src="data:image/png;base64,AA">')
        self.assertEqual([p for p in self.problems() if "img" in p], [])

    def test_clean_site_passes(self):
        self.page("index.html", '<div data-anim="filter"></div><div data-anim="bits"></div>')
        self.assertEqual(self.problems(), [])
        self.assertEqual(verify_site.check(self.site, self.docs, self.package, [])[1:], (2, 1))

    def test_missing_module(self):
        self.page("a/index.html", '<div data-anim="synth"></div>')
        self.assertIn('a/index.html: data-anim="synth" but site/javascripts/anim-synth.js is missing',
                      self.problems())

    def test_module_not_imported(self):
        (self.site / "javascripts" / "anim-complex.js").write_text("export {};\n", encoding="utf-8")
        self.page("a/index.html", '<div data-anim="complex"></div>')
        self.assertEqual(self.problems(), ["a/index.html: anim-complex.js is not imported by anim.js"])

    def test_missing_data_file(self):
        (self.site / "assets" / "data" / "frames.json").unlink()
        self.page("a/index.html", '<div data-anim="bits"></div>')
        self.assertEqual(self.problems(),
                         ["a/index.html: bits needs assets/data/frames.json, missing or empty in site/"])

    def test_unknown_slug(self):
        (self.site / "javascripts" / "anim-novel.js").write_text("export {};\n", encoding="utf-8")
        with open(self.site / "javascripts" / "anim.js", "a", encoding="utf-8") as entry:
            entry.write('import "./anim-novel.js";\n')
        self.page("a/index.html", '<div data-anim="novel"></div>')
        self.assertEqual(self.problems(),
                         ["a/index.html: novel has no entry in STATIC_FILES in tools/verify-site.py"])

    def test_data_clips_expand_per_clip(self):
        (self.site / "javascripts" / "anim-novel.js").write_text("export {};\n", encoding="utf-8")
        with open(self.site / "javascripts" / "anim.js", "a", encoding="utf-8") as entry:
            entry.write('import "./anim-novel.js";\n')
        verify_site.PER_CLIP_FILES["novel"] = ["assets/data/{clip}/frames.json"]
        try:
            self.page("a/index.html", '<div data-anim="novel" data-clips="lj-b"></div>')
            self.assertEqual(self.problems(),
                             ["a/index.html: novel needs assets/data/lj-b/frames.json, missing or empty in site/"])
        finally:
            del verify_site.PER_CLIP_FILES["novel"]

    def test_numeric_data_frame_in_page_and_markdown(self):
        self.page("a/index.html", '<li data-frame="48">x</li>')
        (self.docs / "10-the-dstar-frame.md").write_text('ok\n<li data-frame="48">x</li>\n', encoding="utf-8")
        self.assertEqual(self.problems(), [
            "a/index.html: numeric data-frame; pick frames by data-pick (a named criterion)",
            "docs/10-the-dstar-frame.md:2: numeric data-frame; pick frames by data-pick (a named criterion)",
        ])

    def test_no_video_and_no_video_folder(self):
        self.page("a/index.html", "<video></video>")
        (self.site / "assets" / "video").mkdir(parents=True)
        self.assertEqual(self.problems(), [
            "a/index.html: <video> still present",
            "site/assets/video/ still present",
        ])

    def test_unrendered_math(self):
        # No math renderer is loaded, so arithmatex output shows as raw \\( \\).
        self.page("a/index.html", '<p>the <span class="arithmatex">\\(f_0\\)</span> line</p>')
        self.assertEqual(self.problems(), [
            "a/index.html: unrendered $...$ math; write it as text (f<sub>0</sub>, ω, ⌊ ⌋)",
        ])

    def test_site_with_no_figure_hosts_fails(self):
        self.page("index.html", "<p>no figures</p>")
        result = subprocess.run([sys.executable, str(ROOT / "tools" / "verify-site.py"),
                                 str(self.site)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("verify-site: no figure hosts in", result.stdout)

    def test_vendor_file_missing(self):
        self.page("p/index.html", '<div data-anim="filter"></div>')
        (self.site / "javascripts/vendor/three/three.core.min.js").unlink()
        self.assertIn("site/javascripts/vendor/three/three.core.min.js is missing or empty", self.problems())

    def test_vendor_file_changed(self):
        self.page("p/index.html", '<div data-anim="filter"></div>')
        (self.site / "javascripts/vendor/three/three.core.min.js").write_text("export {}; // edited\n")
        self.assertEqual(self.problems(), [
            "site/javascripts/vendor/three/three.core.min.js does not match THREE_SHA256 in tools/verify-site.py"])

    def test_vendor_extra_file_fails(self):
        self.page("p/index.html", '<div data-anim="filter"></div>')
        (self.site / "javascripts/vendor/three/three.module.min.d.ts").write_text("export {};\n")
        self.assertEqual(self.problems(), [
            "site/javascripts/vendor/three/three.module.min.d.ts should not ship; "
            "only LICENSE, VERSION, addons/LineMaterial.js, addons/LineSegments2.js, "
            "addons/LineSegmentsGeometry.js, three.core.min.js, three.module.min.js"])

    def test_vendor_addon_changed_or_extra(self):
        self.page("p/index.html", '<div data-anim="filter"></div>')
        vendor = self.site / "javascripts/vendor/three"
        (vendor / "addons/LineMaterial.js").write_text("export {}; // edited\n")
        (vendor / "addons/Line2.js").write_text("export {};\n")
        problems = self.problems()
        self.assertIn("site/javascripts/vendor/three/addons/LineMaterial.js does not match THREE_SHA256 "
                      "in tools/verify-site.py", problems)
        self.assertTrue(any(p.startswith("site/javascripts/vendor/three/addons/Line2.js should not ship")
                            for p in problems), problems)

    def test_the_vendor_baseline_is_three_plus_the_addons(self):
        vendor = ROOT / "docs" / "javascripts" / "vendor" / "three"
        self.assertEqual(sorted(self.real_sha256), sorted(verify_site.VENDOR_FILES))
        self.assertEqual(verify_site.THREE_GZIP_BYTES, sum(verify_site._gz(vendor / n) for n in verify_site.VENDOR_FILES))

    def test_upstream_hashes_match_the_repo_copy(self):
        vendor = ROOT / "docs" / "javascripts" / "vendor" / "three"
        for name, digest in self.real_sha256.items():
            self.assertEqual(hashlib.sha256((vendor / name).read_bytes()).hexdigest(), digest, name)

    def test_types_pin_must_match_vendored_release(self):
        self.page("p/index.html", '<div data-anim="filter"></div>')
        self.package.write_text('{"devDependencies": {"@types/three": "0.185.4"}}', encoding="utf-8")
        self.assertIn("three 0.185.1 is vendored but package.json pins @types/three 0.185.4", self.problems())

    # -- 3D: derived slugs, budget(n), caps, closure, allowances ----------

    def two_part_page(self, part_bytes: int = 0):
        """Page p with two converted figures, each a 2D module and a -3d part."""
        for slug in ("filter", "complex"):
            self.module(f"anim-{slug}.js", 'import { NO_WEBGL_HINT } from "./anim-core.js";\n'
                        f'const load = () => import("./anim-{slug}-3d.js");\n')
            self.module(f"anim-{slug}-3d.js", 'import { mountThree } from "./anim-three.js";\n'
                        'import { createOrbit } from "./lib/orbit.js";\n', part_bytes)
        self.module("lib/orbit.js", '/** @param {import("../anim-three.js").ThreeContext} c */\nexport {};\n')
        self.register('mountLazy("complex", () => import("./anim-complex.js"));')
        self.page("p/index.html", '<div data-anim="filter"></div><div data-anim="complex"></div>')

    def test_the_3d_slug_set_is_derived(self):
        self.two_part_page()
        self.module("anim-vq-space.js", 'import { NO_WEBGL_HINT, mountThree } from "./anim-three.js";\n')
        self.module("anim-novel.js", "// mentions anim-three.js only in a comment\n")
        js = self.site / "javascripts"
        self.assertEqual(verify_site.three_d_slugs(js), {"filter", "complex", "vq-space"})

    def test_a_page_with_two_parts_counts_the_shared_lib_once(self):
        self.two_part_page()
        js = self.site / "javascripts"
        files = verify_site.page_3d_files(js, {"filter", "complex"})
        self.assertEqual(sorted(p.name for p in files),
                         ["anim-complex-3d.js", "anim-filter-3d.js", "anim-three.js", "orbit.js"])
        self.assertEqual([p for p in self.problems() if "budget" in p], [])

    def test_a_page_over_budget_n(self):
        # Hex digits gzip to about half their length: parts of about 15 KB
        # each, under the part cap, and a runtime of about 40 KB.
        self.two_part_page(part_bytes=30_000)
        self.module("anim-three.js", "export {};\n", 80_000)
        problems = [p for p in self.problems() if "budget" in p]
        self.assertEqual(len(problems), 1)
        self.assertRegex(problems[0], r"^p/index.html: 3D on this page is \d+ bytes gzip, over budget\(2\) = 264300$")
        self.assertEqual(verify_site.budget(2), verify_site.THREE_GZIP_BYTES + 66 * 1024)

    def test_a_part_over_the_part_cap(self):
        self.two_part_page()
        self.module("anim-filter-3d.js", 'import { mountThree } from "./anim-three.js";\n', 36_000)
        self.assertTrue(any(p.startswith("anim-filter-3d.js is ") and "over the part cap of 16384" in p
                            for p in self.problems()), self.problems())

    def test_the_runtime_cap(self):
        self.page("p/index.html", '<div data-anim="filter"></div>')
        self.module("lib/labels.js", '/** @typedef {import("../anim-three.js").ThreeContext} C */\n', 80_000)
        self.assertTrue(any("over the runtime cap of 36864" in p for p in self.problems()))

    def test_a_static_import_of_a_part_fails(self):
        self.two_part_page()
        self.module("anim-filter.js", 'import { NO_WEBGL_HINT } from "./anim-core.js";\nimport "./anim-filter-3d.js";\n')
        problems = self.problems()
        self.assertIn("anim-filter.js imports anim-filter-3d.js statically; a 3D part loads only through import()",
                      problems)

    def test_a_wrapped_dynamic_import_is_not_static(self):
        self.two_part_page()
        self.module("anim-filter.js", 'import { NO_WEBGL_HINT } from "./anim-core.js";\n'
                    'const load = () =>\n  import("./anim-filter-3d.js");\n')
        self.assertEqual([p for p in self.problems() if "statically" in p], [])
        js = self.site / "javascripts"
        self.assertEqual([p.name for p in verify_site._static_imports(js / "anim-filter.js")], ["anim-core.js"])

    def test_anim_js_must_not_reach_the_runtime_statically(self):
        self.page("p/index.html", '<div data-anim="filter"></div>')
        self.module("anim-filter.js", 'import "./anim-three.js";\n')
        self.assertIn("anim.js reaches anim-three.js by static import; 3D code loads only on request", self.problems())

    def test_a_monolith_without_mountlazy_fails(self):
        self.module("anim-vq-space.js", 'import { NO_WEBGL_HINT, mountThree } from "./anim-three.js";\n')
        self.register('import "./anim-vq-space.js";')
        verify_site.STATIC_FILES.setdefault("vq-space", [])
        self.page("p/index.html", '<div data-anim="vq-space"></div>')
        self.assertIn("anim-vq-space.js holds 3D code but anim.js does not register it with mountLazy()",
                      self.problems())

    def test_a_3d_figure_must_import_the_hint(self):
        self.two_part_page()
        self.module("anim-filter.js", 'const load = () => import("./anim-filter-3d.js");\n')
        self.assertIn("anim-filter.js has a 3D view but does not import NO_WEBGL_HINT", self.problems())

    def test_more_than_eight_3d_hosts(self):
        self.two_part_page()
        self.page("p/index.html", '<div data-anim="filter"></div>' * 9)
        self.assertIn("p/index.html: 9 3D figure hosts; at most 8 per page", self.problems())

    def test_a_part_over_its_allowance(self):
        self.two_part_page(part_bytes=3_000)
        registry = [{"slug": "filter", "page": "p/", "status": "live", "allowance": 1000},
                    {"slug": "complex", "page": "p/", "status": "stub", "allowance": 0}]
        problems = [p for p in self.problems(registry) if "allowance" in p]
        self.assertEqual(len(problems), 1)
        self.assertRegex(problems[0], r"^filter: its 3D code is \d+ bytes gzip, over its allowance of 1000 "
                                      r"\(tests/figures/registry/filter.json\)$")

    def test_the_allowance_rule(self):
        js = self.site / "javascripts"
        self.module("anim-voicing.js", "", 0)
        registry = [{"slug": s, "page": p, "alsoOn": a} for s, p, a in [
            ("harmonics", "07/", [""]), ("voicing", "07/", []), ("filter", "01/", []), ("complex", "01/", []),
            ("listen-terrain", "12/", [])]]
        table = verify_site.allowances(js, registry)
        runtime = sum(verify_site._gz(p) for p in verify_site.runtime_files(js))
        self.assertEqual(table["harmonics"], 10 * 1024)
        self.assertEqual(table["voicing"], 66 * 1024 - runtime - 10 * 1024)
        self.assertEqual(table["filter"], min((66 * 1024 - runtime) // 2, 16 * 1024))
        self.assertEqual(table["listen-terrain"], 16 * 1024)

    def test_every_new_slug_has_a_static_files_row(self):
        # The figures that compute their data read no files; the others list
        # what they read, and every listed file is in the repo.
        for slug in ("probe", "window-shapes", "leakage", "tradeoff", "fec-protection", "frame-boundary"):
            self.assertEqual(verify_site.STATIC_FILES[slug], [], slug)
        for slug in ("pitch-search", "envelope-blocks", "listen-terrain", "gain-definitions"):
            self.assertTrue(verify_site.STATIC_FILES[slug], slug)
            for path in verify_site.STATIC_FILES[slug]:
                self.assertTrue((ROOT / "docs" / path).is_file(), path)

    def test_the_repo_registry_has_a_file_per_slug(self):
        slugs = {r["slug"] for r in verify_site.load_registry()}
        self.assertEqual(len(slugs), 24)
        self.assertTrue(slugs <= set(verify_site.STATIC_FILES) | set(verify_site.PER_CLIP_FILES))

    def test_new_figure_file_tables(self):
        self.assertEqual(verify_site.PER_CLIP_FILES["harmonic-sum"], [
            "assets/data/{clip}/frames.json", "assets/data/{clip}/spectra.json",
            "assets/audio/{clip}-original.wav", "assets/audio/{clip}-ambe.wav"])
        self.assertEqual(verify_site.PER_CLIP_FILES["frame-path"], verify_site.PER_CLIP_FILES["harmonic-sum"])
        self.assertEqual(verify_site.PER_CLIP_FILES["voicing"], [
            "assets/data/{clip}/frames.json", "assets/data/{clip}/spectra.json", "assets/audio/{clip}-ambe.wav"])

    def test_missing_site_exits_2(self):
        result = subprocess.run([sys.executable, str(ROOT / "tools" / "verify-site.py"),
                                 str(self.tmp / "nothing")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("not found; run `just build` first", result.stdout)


if __name__ == "__main__":
    unittest.main()
