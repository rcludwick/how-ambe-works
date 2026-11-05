// The page layout (extra.css "Layout"; zensical.toml toc.integrate):
//   - one sidebar: the page's headings sit nested under its entry in the
//     left navigation, open for the page being read and for no other, the
//     section in view marked as the reader scrolls; there is no table of
//     contents on the right, on any page;
//   - every figure takes the whole content column, which stops at the
//     76rem grid: about 935 px at 1280, 1095 px at 1440 and 1310 px at
//     1920; the running text fills it up to 90ch (about 910 px, 1000 px at
//     1920); a figure's 16:9 frame is 16:10 from 45em;
//   - a phone keeps its column, its 16:9 frames and no sideways scroll, and
//     its drawer shows the same nested list;
//   - print has no navigation and keeps the figures inside the page.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const CH01 = "01-why-sinusoids/";
const CH08 = "08-analysis/";

/**
 * The geometry that matters: the content column, a paragraph of running
 * text, the utterance figure and its frame, and the page's sideways scroll.
 * The utterance figure keeps the house 16:10 frame; Figure 1.1 above it is
 * 2:1 by design.
 * @param {import("@playwright/test").Page} page
 */
const geometry = (page) => page.evaluate(() => {
  const box = (/** @type {Element | null | undefined} */ el) => {
    const b = el?.getBoundingClientRect();
    return b ? { left: b.left, right: b.right, width: b.width, height: b.height } : null;
  };
  const article = document.querySelector("article.md-typeset");
  const style = article ? getComputedStyle(article) : null;
  const column = article && style
    ? article.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    : 0;
  // A paragraph of ordinary running text: the second, past the lede.
  const text = document.querySelectorAll("article.md-typeset > p")[1];
  const figure = document.querySelector('[data-anim="utterance"] > .anim-figure');
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:100ch";
  text?.append(probe);
  const ch100 = probe.getBoundingClientRect().width;
  probe.remove();
  return {
    column,
    text: box(text),
    textFont: text ? parseFloat(getComputedStyle(text).fontSize) : 0,
    ch100,
    figure: box(figure),
    frame: box(figure?.querySelector(".anim-figure__frame--view") ?? figure?.querySelector(".anim-figure__frame")),
    inner: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  };
});

test.describe("the content column", () => {
  for (const [width, low, high] of [[1280, 925, 945], [1440, 1085, 1105], [1920, 1300, 1320]]) {
    test(`at ${width} px the figure fills the column, 16:10, the text up to 90ch, with no right sidebar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(CH01);
      await page.locator('[data-anim="utterance"] .anim-figure').waitFor();
      const g = await geometry(page);
      if (!g.text || !g.figure || !g.frame) throw new Error("no text or figure");
      expect(g.column).toBeGreaterThanOrEqual(low);
      expect(g.column).toBeLessThanOrEqual(high);
      // The text fills the column up to 90ch.
      expect(g.text.width).toBeCloseTo(Math.min(g.column, g.ch100 * 0.9), 0);
      expect(g.text.width).toBeGreaterThan(880);
      expect(g.textFont).toBeGreaterThanOrEqual(16);
      // The figure spans the column; its frame is 16:10.
      expect(g.figure.width).toBeCloseTo(g.column, 0);
      expect(Math.abs(g.figure.left - g.text.left)).toBeLessThanOrEqual(1);
      expect(g.frame.width / g.frame.height).toBeCloseTo(1.6, 1);
      expect(g.scroll).toBeLessThanOrEqual(g.inner);
      await expect(page.locator(".md-sidebar--secondary")).toHaveCount(0);
    });
  }

  test("between the phone and desktop layouts the text stops at 90ch and the figure takes the column", async ({ page }) => {
    await page.setViewportSize({ width: 1150, height: 900 });
    await page.goto(CH01);
    await page.locator('[data-anim="utterance"] .anim-figure').waitFor();
    const g = await geometry(page);
    if (!g.text || !g.figure) throw new Error("no text or figure");
    expect(g.text.width).toBeLessThanOrEqual(g.ch100 * 0.9 + 1);
    expect(g.figure.width).toBeCloseTo(g.column, 0);
    expect(g.scroll).toBeLessThanOrEqual(g.inner);
  });

  test("tables, code and admonitions follow the column", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CH08);
    const g = await geometry(page);
    const widths = await page.evaluate(() => [...document.querySelectorAll(
      "article.md-typeset > .highlight, article.md-typeset > .admonition, article.md-typeset > table, article.md-typeset > .md-typeset__scrollwrap",
    )].map((el) => el.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBeCloseTo(g.column, 0);
  });

  test("at 390 px the column, 16:9 frames and no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CH01);
    await page.locator('[data-anim="utterance"] .anim-figure').waitFor();
    const g = await geometry(page);
    if (!g.text || !g.figure || !g.frame) throw new Error("no text or figure");
    expect(g.figure.width).toBeCloseTo(g.text.width, 0);
    expect(g.text.width).toBeCloseTo(g.column, 0);
    expect(g.scroll).toBeLessThanOrEqual(390);
    const house = await page.locator("[data-anim] .anim-figure").first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--anim-aspect-house").trim());
    expect(house).toBe("16 / 9");
  });
});

test("every page in the nav: no right sidebar at 1440 px, no sideways scroll at 390 px", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("");
  const paths = await page.locator(".md-nav--primary a.md-nav__link[href]").evaluateAll((links) =>
    [...new Set(links.map((a) => new URL(/** @type {HTMLAnchorElement} */ (a).href).pathname))]);
  expect(paths.length).toBeGreaterThan(10);
  for (const path of paths) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await expect(page.locator(".md-sidebar--secondary"), path).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll, path).toBeLessThanOrEqual(inner);
  }
});

test.describe("the page's headings in the left navigation", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const toc = (/** @type {import("@playwright/test").Page} */ page) =>
    page.locator(".md-sidebar--primary .md-nav__item--active > .md-nav--secondary");

  test("nested under the page's entry, open, and only for the page being read", async ({ page }) => {
    await page.goto(CH08);
    await expect(toc(page)).toHaveCount(1);
    await expect(toc(page)).toBeVisible();
    // Every h2 and h3 of the article, in order, at its depth.
    const headings = await page.locator("article h2[id], article h3[id]").evaluateAll((hs) =>
      hs.map((h) => `${h.tagName}:${h.id}`));
    const links = await toc(page).locator("a.md-nav__link").evaluateAll((as) => as.map((a) => {
      const depth = a.closest(".md-nav")?.closest(".md-nav--secondary .md-nav__item") ? "H3" : "H2";
      return `${depth}:${new URL(/** @type {HTMLAnchorElement} */ (a).href).hash.slice(1)}`;
    }));
    expect(links).toEqual(headings);
    expect(headings.some((h) => h.startsWith("H3"))).toBe(true);
    // A subsection sits further right than its section.
    const [h2, h3] = await Promise.all([
      toc(page).locator(":scope > .md-nav__list > .md-nav__item > a").first().evaluate((a) => a.getBoundingClientRect().left + parseFloat(getComputedStyle(a).paddingLeft)),
      toc(page).locator(".md-nav .md-nav__link").first().evaluate((a) => a.getBoundingClientRect().left + parseFloat(getComputedStyle(a).paddingLeft)),
    ]);
    expect(h3).toBeGreaterThan(h2 + 8);
    // Another chapter's entry has no headings under it.
    await expect(page.locator(".md-sidebar--primary .md-nav--secondary")).toHaveCount(1);
  });

  test("the section in view is marked as the reader scrolls, and the list scrolls to keep it in sight", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto(CH08);
    const ids = await page.locator("article h2[id]").evaluateAll((hs) => hs.map((h) => h.id));
    const last = ids[ids.length - 1];
    for (const id of [ids[1], last]) {
      await page.locator(`article h2#${id}`).evaluate((h) => h.scrollIntoView({ block: "start" }));
      const link = toc(page).locator(`a.md-nav__link[href$="#${id}"]`);
      await expect(link).toHaveClass(/md-nav__link--active/);
      // One section marked at a time.
      await expect(toc(page).locator(".md-nav__link--active")).toHaveCount(1);
      // In the accent (once the colour's transition has run), with the bar.
      const accent = await link.evaluate((a) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--ambe-accent)";
        a.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      await expect.poll(() => link.evaluate((a) => getComputedStyle(a).color)).toBe(accent);
      expect(await link.evaluate((a) => getComputedStyle(a, "::before").width)).toBe("2px");
      // Inside the sidebar's scrolling box, which scrolls rather than the page.
      const visible = await link.evaluate((a) => {
        const wrap = a.closest(".md-sidebar__scrollwrap");
        if (!wrap) return false;
        const w = wrap.getBoundingClientRect();
        const b = a.getBoundingClientRect();
        return b.top >= w.top - 1 && b.bottom <= w.bottom + 1;
      });
      expect(visible, id).toBe(true);
    }
    const wrap = page.locator(".md-sidebar--primary .md-sidebar__scrollwrap");
    expect(await wrap.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });

  test("a hovered heading is not coloured like the section in view", async ({ page }) => {
    await page.goto(CH08);
    const link = toc(page).locator("a.md-nav__link:not(.md-nav__link--active)").nth(2);
    await link.hover();
    // The tokens, resolved where the link is.
    const [text, surface] = await link.evaluate((a) => {
      const probe = document.createElement("span");
      a.append(probe);
      probe.style.color = "var(--ambe-text)";
      const textColor = getComputedStyle(probe).color;
      probe.style.color = "var(--ambe-surface-2)";
      const surfaceColor = getComputedStyle(probe).color;
      probe.remove();
      return [textColor, surfaceColor];
    });
    // Once the colour's transition has run.
    await expect.poll(() => link.evaluate((a) => getComputedStyle(a).color)).toBe(text);
    await expect.poll(() => link.evaluate((a) => getComputedStyle(a).backgroundColor)).toBe(surface);
  });

  test("from the keyboard: Tab reaches a heading's link and Enter goes to it", async ({ page }) => {
    await page.goto(CH08);
    const link = toc(page).locator("a.md-nav__link").nth(2);
    const target = await link.evaluate((a) => new URL(/** @type {HTMLAnchorElement} */ (a).href).hash);
    await link.focus();
    await expect(link).toBeFocused();
    // A focus ring on the link.
    expect(await link.evaluate((a) => getComputedStyle(a).outlineStyle !== "none" || getComputedStyle(a).boxShadow !== "none" ||
      getComputedStyle(a).backgroundColor !== "rgba(0, 0, 0, 0)")).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    const top = await page.locator(`article ${target}`).evaluate((h) => h.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(200);
  });

  for (const scheme of ["slate", "default"]) {
    test(`axe finds nothing serious in the navigation (${scheme})`, async ({ page }) => {
      await page.goto(CH08);
      await page.evaluate((s) => document.body.setAttribute("data-md-color-scheme", s), scheme);
      await page.locator("article h2[id]").nth(2).evaluate((h) => h.scrollIntoView({ block: "start" }));
      await expect(toc(page).locator(".md-nav__link--active")).toHaveCount(1);
      const violations = (await new AxeBuilder({ page }).include(".md-sidebar--primary").analyze()).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      expect(violations).toEqual([]);
    });
  }

  test("a phone's drawer holds the same nested list", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CH08);
    await page.locator("label.md-header__button[for='__drawer']").click();
    await expect(toc(page)).toBeVisible();
    const count = await toc(page).locator("a.md-nav__link").count();
    expect(count).toBe(await page.locator("article h2[id], article h3[id]").count());
    // Once the drawer has slid in, the list sits inside the screen.
    await expect.poll(async () => (await toc(page).boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
    const box = await toc(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  });
});

test("print: no navigation, and the figures inside the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(CH01);
  await page.locator("[data-anim] .anim-figure").first().waitFor();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".md-sidebar--primary")).toBeHidden();
  await expect(page.locator(".md-sidebar--secondary")).toHaveCount(0);
  const [article, figures] = await Promise.all([
    page.locator("article.md-typeset").evaluate((el) => el.getBoundingClientRect().right),
    page.locator("[data-anim]").evaluateAll((hosts) => hosts.map((h) => h.getBoundingClientRect().right)),
  ]);
  for (const right of figures) expect(right).toBeLessThanOrEqual(article + 1);
  await expect(page.locator("[data-anim] .anim-view__expand").first()).toBeHidden();
});
