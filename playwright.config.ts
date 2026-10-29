import { defineConfig } from "@playwright/test";

// E2E runs against the production single-file build opened from file://,
// with the inspection hook enabled through the URL hash (#debug).
// Logic and storage specs behave the same in every Chromium configuration: they run in `chromium` only.
// The other two keep the specs that depend on the rasterizer or the pixel ratio (docs/testing/README.md).
// The desktop shell (ADR 0177) runs in Electron, in its own project only.
const DESKTOP = ["**/desktop.spec.ts"];
const LOGIC_ONLY = [...DESKTOP, "**/settings.spec.ts", "**/a11y.spec.ts", "**/storage.spec.ts", "**/archive.spec.ts", "**/assets.spec.ts", "**/organize.spec.ts", "**/colour-picker.spec.ts", "**/colour-picker-package.spec.ts", "**/vectors.spec.ts", "**/scenarios.spec.ts", "**/upgrade.spec.ts", "**/lowmem.spec.ts", "**/release.spec.ts", "**/library-folder.spec.ts", "**/pattern.spec.ts", "**/patterns-package.spec.ts", "**/scrub-audit.spec.ts", "**/icon-audit.spec.ts"];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  // On GitHub, failures are also annotations (readable through the API without the log).
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "chromium", testIgnore: DESKTOP, use: { browserName: "chromium" } },
    {
      testIgnore: LOGIC_ONLY,
      // Hardware acceleration disabled: Canvas 2D is rasterized on the CPU.
      name: "chromium-cpu",
      use: { browserName: "chromium", launchOptions: { args: ["--disable-gpu", "--disable-gpu-compositing", "--disable-accelerated-2d-canvas"] } },
    },
    { name: "chromium-dpr2", testIgnore: LOGIC_ONLY, use: { browserName: "chromium", deviceScaleFactor: 2, hasTouch: true } },
    // The project owner's main browser. file:// storage and input differ from Chromium.
    { name: "firefox", testIgnore: DESKTOP, use: { browserName: "firefox" } },
    // The desktop build: Electron launched by the spec itself (no browser of the other projects).
    { name: "desktop", testMatch: DESKTOP },
  ],
});
