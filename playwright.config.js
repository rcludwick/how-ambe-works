// Figure tests. They run locally before a merge (README, "Before merging");
// no CI workflow runs them.
//
// reuseExistingServer is false, unlike the design's sketch: a server left on
// 8031 by another checkout would otherwise be tested in place of this tree.
// A busy port fails loudly instead.
import { defineConfig, devices } from "@playwright/test";

// AMBE_TEST_PORT lets several worktrees run their suites side by side.
const PORT = Number(process.env.AMBE_TEST_PORT) || 8031;
// zensical serves the site under the path of site_url; the root answers 302.
const BASE_URL = `http://127.0.0.1:${PORT}/how-ambe-works/`;

export default defineConfig({
  testDir: "tests/figures",
  // The baselines are rendered on macOS and compared pixel for pixel. Text
  // antialiasing differs on other systems, so each platform gets its own
  // files, and a platform without them reports them missing, not changed.
  snapshotPathTemplate: "tests/figures/__screenshots__/{testFilePath}/{arg}-{platform}{ext}",
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL: BASE_URL,
    colorScheme: "dark",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: "dark",
      },
    },
    {
      // The P0 spike (whether WebKit frees a context's slot on a synthetic
      // loss), and the runtime's cap cases tagged @webkit: the pool exists
      // for WebKit, so its victim choice, unpark, queue, real loss and round
      // trips are held there as well. pageerrors.spec.js reads every page
      // in WebKit, which reports a ResizeObserver loop where Chromium does not.
      name: "webkit",
      testMatch: /(three-cap|pageerrors)\.spec\.js/,
      grep: /spike|@webkit/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: "dark",
      },
    },
  ],
  webServer: {
    command: `uv run --locked --group docs zensical serve -a 127.0.0.1:${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
