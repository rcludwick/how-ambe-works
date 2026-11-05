// The fixture figure: a test-only module, registered lazily through a
// routed anim.js and mounted on a host injected into a real chapter page.
// Nothing here is in docs/ or site/.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { FIXTURE_JS, hook, useFixture, visit } from "./helpers.js";

test("the fixture module is type-checked", () => {
  expect(readFileSync(FIXTURE_JS, "utf-8").split("\n")[0]).toBe("// @ts-check");
});

test("mounts on an injected host and marks it enhanced", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  await page.goto("14-how-to-measure/");
  const host = page.locator('[data-anim="fixture"]');
  await expect(host).toHaveClass(/is-enhanced/);
  await expect(host.locator(".anim-figure canvas")).toHaveAttribute("role", "img");
  expect((await hook(page)).mounted).toBe(1); // the fixture alone: 14 has no figure
});

test("mountLazy loads a module only on a page with its host", async ({ page }) => {
  /** @type {string[]} */
  const fetched = [];
  page.on("request", (request) => fetched.push(request.url()));
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  await page.goto("15-exact-reproduction/");
  await page.waitForLoadState("networkidle");
  expect(fetched.filter((url) => url.includes("anim-fixture.js"))).toEqual([]);

  await visit(page, "14-how-to-measure/");
  await page.locator('[data-anim="fixture"].is-enhanced').waitFor();
  expect(fetched.filter((url) => url.includes("anim-fixture.js"))).toHaveLength(1);
});

test("an aborted lazy load never calls init", async ({ page }) => {
  await useFixture(page, { chapters: ["14-how-to-measure/"] });
  let release = () => {};
  const held = new Promise((resolve) => (release = () => resolve(undefined)));
  await page.route("**/javascripts/anim-fixture.js", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("14-how-to-measure/");
  await visit(page, "15-exact-reproduction/");
  release();
  await page.waitForLoadState("networkidle");
  // @ts-ignore test-only global
  expect(await page.evaluate(() => window.__fixture?.inits ?? 0)).toBe(0);
});
