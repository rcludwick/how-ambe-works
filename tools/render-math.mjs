#!/usr/bin/env node
// Typeset the site's display equations with KaTeX, ahead of time.
//
// An equation is a block in a page of docs/, three lines long:
//
//   <!-- math: \Psi(P) = P \sum_{k} \phi(kP) -->
//   <div class="math-block" markdown="0">...KaTeX's HTML...</div>
//   <!-- end math -->
//
// The TeX lives in the opening marker, on that one line. This script rewrites
// what lies between the markers, so edit the TeX, not the HTML. Leave a blank
// line before and after the block so Markdown reads it as raw HTML.
//
// The TeX may hold any character except "--", which would end the HTML
// comment early; the script refuses it, naming the page and line. It stays on
// one line so tools/check-voice.py, which skips lines that start with "<",
// never reads TeX as prose.
//
// Pages load no maths script. The HTML here is styled by the vendored
// stylesheet (docs/stylesheets/vendor/katex/), and its MathML half is what a
// screen reader reads. `katex` is pinned in package.json at the vendored
// version (tools/check-vendor-katex.sh checks the two match).
//
//   node tools/render-math.mjs                # rewrite every docs/*.md
//   node tools/render-math.mjs --check        # exit 1 if any block is out of date
//   node tools/render-math.mjs [--check] FILE...  # just these pages
//
// Both modes exit 1 if the installed katex differs from the vendored VERSION.
// RENDER_MATH_VERSION_FILE names another VERSION file (the tests use it).

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import katex from "katex";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

const OPEN = /^<!-- math: (.*) -->$/;
const CLOSE = "<!-- end math -->";

/** KaTeX's display-mode HTML for one equation, in the wrapper Markdown leaves alone. */
function typeset(tex) {
  const html = katex.renderToString(tex, { displayMode: true, output: "htmlAndMathml", throwOnError: true });
  return `<div class="math-block" markdown="0">${html}</div>`;
}

/**
 * The page with every math block re-rendered, and how many blocks it holds.
 * Throws an Error naming the page and line for a malformed block or bad TeX.
 */
export function render(text, name) {
  const lines = text.split("\n");
  const out = [];
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const where = `${name}:${i + 1}`;
    if (line.includes(CLOSE) && line !== CLOSE) {
      throw new Error(`${where}: "${CLOSE}" must sit alone on its line`);
    }
    if (line === CLOSE) throw new Error(`${where}: "${CLOSE}" with no "<!-- math: ... -->" above it`);
    if (!line.includes("<!-- math:")) {
      out.push(line);
      continue;
    }
    const open = OPEN.exec(line);
    if (!open) {
      throw new Error(`${where}: a math marker must be one whole line, "<!-- math: TEX -->"`);
    }
    const tex = open[1].trim();
    if (tex.includes("--")) {
      throw new Error(`${where}: the TeX holds "--", which ends the HTML comment; write it another way (e.g. "-{}-")`);
    }
    if (!tex) throw new Error(`${where}: the math marker holds no TeX`);
    let end = i + 1;
    while (end < lines.length && lines[end] !== CLOSE) {
      if (lines[end].includes("<!-- math:")) break;
      end++;
    }
    if (end >= lines.length || lines[end] !== CLOSE) {
      throw new Error(`${where}: no "${CLOSE}" after this math marker`);
    }
    let html;
    try {
      html = typeset(tex);
    } catch (error) {
      throw new Error(`${where}: KaTeX cannot render ${JSON.stringify(tex)}: ${error.message}`);
    }
    out.push(line, html, CLOSE);
    count++;
    i = end;
  }
  return { text: out.join("\n"), count };
}

/** An error message if the installed katex is not the vendored version, else "". */
function versionProblem() {
  const file = process.env.RENDER_MATH_VERSION_FILE || join(DOCS, "stylesheets", "vendor", "katex", "VERSION");
  const vendored = readFileSync(file, "utf-8").trim();
  if (katex.version === vendored) return "";
  return `installed katex ${katex.version} differs from the vendored ${vendored} (${relative(ROOT, file)}); run npm ci or re-vendor`;
}

function main(argv) {
  const problem = versionProblem();
  if (problem) {
    console.log(`render-math: ${problem}`);
    return 1;
  }
  const check = argv.includes("--check");
  const named = argv.filter((arg) => arg !== "--check");
  const pages = named.length
    ? named.map((p) => resolve(p))
    : readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort().map((f) => join(DOCS, f));
  let count = 0;
  const stale = [];
  for (const path of pages) {
    const page = readFileSync(path, "utf-8");
    const name = relative(ROOT, path).startsWith("..") ? basename(path) : relative(ROOT, path);
    let result;
    try {
      result = render(page, name);
    } catch (error) {
      console.log(`render-math: ${error.message}`);
      return 1;
    }
    count += result.count;
    if (result.text === page) continue;
    if (check) stale.push(name);
    else writeFileSync(path, result.text, "utf-8");
  }
  if (stale.length) {
    console.log(`render-math: ${stale.join(", ")} out of date; run node tools/render-math.mjs`);
    return 1;
  }
  console.log(`render-math: ${check ? "ok" : "wrote"} (${count} math blocks)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
