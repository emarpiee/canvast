import { defineConfig } from "@playwright/test";

// Scale benchmarks (Phase 0C). Not part of `npm test`: run with `npm run bench`.
export default defineConfig({
  testDir: "tests/bench",
  testMatch: "**/*.bench.ts",
  timeout: 1_800_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", launchOptions: { args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] } } },
    {
      name: "chromium-cpu",
      use: {
        browserName: "chromium",
        launchOptions: {
          args: ["--enable-precise-memory-info", "--js-flags=--expose-gc", "--disable-gpu", "--disable-gpu-compositing", "--disable-accelerated-2d-canvas"],
        },
      },
    },
  ],
});
