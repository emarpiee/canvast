import { defineConfig } from "@playwright/test";

// Footage for the motion piece: the app driven like the README shots (tests/shots/scene.ts), every clip recorded frame by frame.
// Run from the repo root after `npm run build`:
//   CANVAST_BUILD_DIR=dist npx playwright test -c scripts/showcase/motion/footage.config.ts [-g <clip>]
// Then: node scripts/showcase/motion/render.mjs   (writes docs/media/canvast-60s.mp4)
export default defineConfig({
  testDir: ".",
  testMatch: "footage.spec.ts",
  timeout: 600_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  outputDir: "../../../test-results/motion",
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    colorScheme: "dark",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
});
