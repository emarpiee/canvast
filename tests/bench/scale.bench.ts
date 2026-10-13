import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BenchScene } from "../../src/app/bench";

/**
 * Phase 0C scale benchmarks. Each case loads a generated scene in a fresh
 * page and renders a fixed pan/zoom trajectory synchronously. Results go to
 * metrics/bench-<label>-<project>.json and are summarized in
 * docs/testing/phase-0c.md. Set BENCH_LABEL to tag a run (e.g. "baseline").
 */
const LABEL = process.env["BENCH_LABEL"] ?? "current";
const ONLY = process.env["BENCH_ONLY"]; // optional substring filter on case names

const CASES: Array<{ name: string; scene: BenchScene; frames: number }> = [
  { name: "dense-1k", scene: { kind: "dense", n: 1_000 }, frames: 120 },
  { name: "dense-10k", scene: { kind: "dense", n: 10_000 }, frames: 60 },
  { name: "dense-100k", scene: { kind: "dense", n: 100_000 }, frames: 20 },
  { name: "clusters-10k", scene: { kind: "clusters", n: 10_000, clusters: 1_000 }, frames: 120 },
  { name: "clusters-100k", scene: { kind: "clusters", n: 100_000, clusters: 1_000 }, frames: 60 },
  { name: "clusters-1m", scene: { kind: "clusters", n: 1_000_000, clusters: 1_000 }, frames: 20 },
  { name: "mixed-1m", scene: { kind: "mixed", n: 1_000_000, visible: 1_000 }, frames: 20 },
];

for (const c of CASES) {
  if (ONLY && !c.name.includes(ONLY)) continue;
  test(c.name, async ({ page }, info) => {
    const url = pathToFileURL(resolve("dist/canvast.html")).href + "#debug";
    await page.goto(url);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
    const baseHeap = await page.evaluate(() => window.__canvastDebug.heapMB());
    const load = await page.evaluate((s) => window.__canvastDebug.benchLoad(s), c.scene);
    // Warm-up frames (JIT), then the measured trajectory.
    await page.evaluate(() => window.__canvastDebug.benchRun(5));
    const run = await page.evaluate((n) => window.__canvastDebug.benchRun(n), c.frames);
    const heap = await page.evaluate(() => window.__canvastDebug.heapMB());
    const result = { label: LABEL, project: info.project.name, case: c.name, scene: c.scene, baseHeapMB: baseHeap, load, heapMB: heap, run };
    mkdirSync(resolve("metrics"), { recursive: true });
    writeFileSync(resolve("metrics", `bench-${LABEL}-${info.project.name}-${c.name}.json`), JSON.stringify(result, null, 2));
    const f = run.frameMs;
    console.log(
      `${LABEL} ${info.project.name} ${c.name}: n=${load.objects} gen=${load.generateMs.toFixed(0)}ms load=${load.loadMs.toFixed(0)}ms ` +
        `heap=${heap}MB visible=${run.visibleCount.min}-${run.visibleCount.max} ` +
        `frame p50=${f.p50.toFixed(1)} p95=${f.p95.toFixed(1)} p99=${f.p99.toFixed(1)}ms ` +
        `(visible p95=${run.visibleMs.p95.toFixed(1)} draw p95=${run.drawMs.p95.toFixed(1)})`,
    );
  });
}
