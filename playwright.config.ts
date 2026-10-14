import { defineConfig } from "@playwright/test";

// E2E runs against the production single-file build opened from file://,
// with the inspection hook enabled through the URL hash (#debug).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      // Hardware acceleration disabled: Canvas 2D is rasterized on the CPU.
      name: "chromium-cpu",
      use: { browserName: "chromium", launchOptions: { args: ["--disable-gpu", "--disable-gpu-compositing", "--disable-accelerated-2d-canvas"] } },
    },
    { name: "chromium-dpr2", use: { browserName: "chromium", deviceScaleFactor: 2, hasTouch: true } },
  ],
});
