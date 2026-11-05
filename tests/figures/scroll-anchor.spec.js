// The browser's scroll anchoring while the figures are built.
//
// A reader who follows a link to a heading that comes right after a figure
// lands with that figure's last lines under the fixed header. Chrome picked
// its scroll anchor there, in the figure's step list. Building the figure
// moved the list up into the figure, and Chrome scrolled after it, so the
// heading left the screen: about 1,500 px on ch08 and 1,180 px on ch10.
// anim-core.js mount() keeps the anchor out of each host while its figure
// is built (holdAnchor).
import { test, expect } from "@playwright/test";
import { visit } from "./helpers.js";

/** A heading straight after a figure host on each page, as the site has them. */
const LANDINGS = [
  ["02-fourier-and-the-dft/", "why-the-test-needs-a-cosine-as-well-as-a-sine"],
  ["02-fourier-and-the-dft/", "the-dft-loses-nothing"],
  ["02-fourier-and-the-dft/", "what-goes-wrong-at-the-block-edges"],
  ["03-windows-and-frames/", "why-speech-coders-converge-on-20-milliseconds"],
  ["07-multi-band-excitation/", "the-parameters-each-frame-sends"],
  ["08-analysis/", "analysis-by-synthesis-testing-candidate-spectra"],
  ["08-analysis/", "sub-sample-pitch-refinement"],
  ["10-the-dstar-frame/", "the-three-bit-rates-of-a-d-star-signal"],
  ["11-synthesis/", "shaped-noise-for-unvoiced-bands"],
  ["11-synthesis/", "what-happens-when-a-radio-frame-is-lost"],
];

/**
 * Wait until every figure on the page is built and has its data, then
 * return where the heading is and where scrolling to it puts it now.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function landing(page, id) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => {
    const hosts = Array.from(document.querySelectorAll("[data-anim]"));
    return hosts.length > 0 && hosts.every((h) => h.classList.contains("is-enhanced")) &&
      !document.querySelector('.anim-figure__frame[data-state="loading"]');
  });
  return page.evaluate((id) => new Promise((done) => {
    // Two frames, so a jump the build set off has happened.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const heading = document.getElementById(id);
      if (!heading) throw new Error(`no #${id}`);
      const at = heading.getBoundingClientRect().top;
      heading.scrollIntoView({ behavior: "instant" });
      done({ at: Math.round(at), want: Math.round(heading.getBoundingClientRect().top) });
    }));
  }), id);
}

/** @param {{at: number, want: number}} spot */
const held = ({ at, want }) => Math.abs(at - want) <= 3;

test.describe("scroll anchoring while the figures are built", () => {
  for (const [path, id] of LANDINGS) {
    test(`a link to ${path}#${id} stays on its heading`, async ({ page }) => {
      await page.goto(`${path}#${id}`);
      const spot = await landing(page, id);
      expect(held(spot), `#${id} at ${spot.at} px, where its link puts it ${spot.want} px`).toBe(true);
    });
  }

  test("an instant-navigation link to a heading after a figure stays on it", async ({ page }) => {
    await page.goto("");
    const [path, id] = LANDINGS[2];
    await visit(page, `${path}#${id}`);
    const spot = await landing(page, id);
    expect(held(spot), `#${id} at ${spot.at} px, where its link puts it ${spot.want} px`).toBe(true);
  });

  test("the hold ends once the figure is built", async ({ page }) => {
    const [path, id] = LANDINGS[2];
    await page.goto(`${path}#${id}`);
    await landing(page, id);
    const held = await page.evaluate(() => Array.from(document.querySelectorAll("[data-anim]"))
      .filter((h) => getComputedStyle(h).overflowAnchor === "none").length);
    expect(held).toBe(0);
  });
});
