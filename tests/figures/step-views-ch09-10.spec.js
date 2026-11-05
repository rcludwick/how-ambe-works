// Steps pick the view (ch09 and ch10): each step of a figure shows the view
// its data-view asks for, 2D for a flat graph and 3D where depth is the
// point. The expected views are read from the chapter's Markdown, so the
// test follows the text.
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { REGISTRY, settle } from "./helpers.js";

const FIGURES = [
  { slug: "vq-space", file: "docs/09-quantization.md" },
  { slug: "envelope", file: "docs/09-quantization.md" },
  { slug: "envelope-blocks", file: "docs/09-quantization.md" },
  { slug: "frame-path", file: "docs/10-the-dstar-frame.md" },
  { slug: "bits", file: "docs/10-the-dstar-frame.md" },
  { slug: "fec-protection", file: "docs/10-the-dstar-frame.md" },
];

/**
 * Each step's data-view, in order, from the host's step list.
 * @param {string} file
 * @param {string} slug
 * @returns {string[]}
 */
function stepViews(file, slug) {
  const text = readFileSync(file, "utf8");
  const start = text.search(new RegExp(`<div[^>]*data-anim="${slug}"`));
  if (start < 0) throw new Error(`${slug}: no host in ${file}`);
  const list = text.slice(start).match(/<ol class="anim-steps"[\s\S]*?<\/ol>/);
  if (!list) throw new Error(`${slug}: no step list`);
  return [...list[0].matchAll(/<li\b([^>]*)>/g)].map((m) => /data-view="(2d|3d)"/.exec(m[1])?.[1] ?? "");
}

for (const { slug, file } of FIGURES) {
  test(`${slug}: every step names a view, and the figure shows it`, async ({ page }) => {
    const views = stepViews(file, slug);
    expect(views.length).toBeGreaterThan(0);
    for (const [i, v] of views.entries()) expect(v, `step ${i + 1} has no data-view`).toMatch(/^(2d|3d)$/);

    const entry = REGISTRY.find((r) => r.slug === slug);
    if (!entry) throw new Error(`${slug}: not in the registry`);
    await page.goto(entry.page);
    const host = page.locator(`[data-anim="${slug}"]`);
    await expect(host).toHaveCount(1);
    await settle(page, host);
    const toggle = host.locator(entry.control);
    const flat = host.locator(".anim-figure__frame canvas.anim-figure__canvas:not(.anim-figure__canvas--3d)").first();
    const deep = host.locator("canvas.anim-figure__canvas--3d");
    const next = host.locator('.anim-steps__nav [data-step="next"]');
    for (const [i, v] of views.entries()) {
      if (i > 0) await next.click();
      await expect(host.locator(".anim-steps__nav output")).toHaveText(`Step ${i + 1} of ${views.length}`);
      await expect(toggle, `step ${i + 1}`).toHaveAttribute("aria-pressed", String(v === "3d"));
      if (v === "3d") {
        await expect(deep, `step ${i + 1}: the 3D view`).toBeVisible({ timeout: 15_000 });
      } else {
        await expect(deep, `step ${i + 1}: no 3D view`).toHaveCount(0);
        await expect(flat, `step ${i + 1}: the 2D canvas`).toBeVisible();
      }
    }
  });
}
