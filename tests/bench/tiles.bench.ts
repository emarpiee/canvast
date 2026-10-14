import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BenchScene } from "../../src/app/bench";
import type { BenchMode } from "../../src/app/debug-hook";

/**
 * Raster tile cache benchmarks (ADR 0009): each scene and trajectory is
 * rendered with the tile cache off (direct, the Phase 0C renderer) and on.
 * Results: metrics/tiles-<project>-<case>.json. Not a pass/fail gate.
 */
const CASES: Array<{ name: string; scene: BenchScene; frames: number }> = [
  { name: "dense-1k", scene: { kind: "dense", n: 1_000 }, frames: 120 },
  { name: "dense-10k", scene: { kind: "dense", n: 10_000 }, frames: 60 },
  { name: "clusters-100k", scene: { kind: "clusters", n: 100_000, clusters: 1_000 }, frames: 60 },
];
const MODES: BenchMode[] = ["pan", "static", "panzoom"];

for (const c of CASES) {
  test(`tiles ${c.name}`, async ({ page }, info) => {
    await page.goto(pathToFileURL(resolve("dist/canvast.html")).href + "#debug");
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
    const out: Record<string, unknown> = {};
    for (const mode of MODES) {
      for (const tiles of [false, true]) {
        const r = await page.evaluate(
          async ([scene, frames, m, on]) => {
            const h = window.__canvastDebug;
            await h.benchLoad(scene);
            h.setTileCache(on);
            h.benchRun(5, m); // warm-up (and tile build for "on")
            return h.benchRun(frames, m);
          },
          [c.scene, c.frames, mode, tiles] as const,
        );
        out[`${mode}-${tiles ? "tiles" : "direct"}`] = { frameMs: r.frameMs, visibleCount: r.visibleCount };
        console.log(
          `${info.project.name} ${c.name} ${mode.padEnd(7)} ${tiles ? "tiles " : "direct"}: frame p50=${r.frameMs.p50.toFixed(1)} p95=${r.frameMs.p95.toFixed(1)} p99=${r.frameMs.p99.toFixed(1)} ms`,
        );
      }
    }
    mkdirSync(resolve("metrics"), { recursive: true });
    writeFileSync(resolve("metrics", `tiles-${info.project.name}-${c.name}.json`), JSON.stringify({ project: info.project.name, case: c.name, scene: c.scene, ...out }, null, 2));
  });
}
