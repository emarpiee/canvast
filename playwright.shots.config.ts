import { defineConfig } from "@playwright/test";

// The README's pictures (tests/shots, CLAUDE.md "Screenshots"): each picture is a test on the end-to-end harness, run on GitHub by the
// Screenshots workflow. A fresh page per picture, in the dark theme at 1440 × 900; a picture that fails leaves a trace to read.
export default defineConfig({
  testDir: "tests/shots",
  testMatch: "**/*.shot.ts",
  timeout: 180_000,
  fullyParallel: true,
  workers: process.env.CI ? 4 : 1,
  retries: 0,
  outputDir: "shots-results",
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
