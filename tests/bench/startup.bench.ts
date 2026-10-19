import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Phase 8 startup benchmarks (docs/testing/phase-8.md). A first visit with nothing stored (cold), then a canvas of N stored objects loaded
 * again (warm: the page is reloaded, the stored canvas is read from IndexedDB). Marks come from the app (`startupMarks`): when the canvas
 * was loaded, when the index was complete, when the first frame was drawn, all in ms since the page began to load.
 * Results go to metrics/startup-<label>-<project>.json. BENCH_LABEL tags a run.
 */
const LABEL = process.env["BENCH_LABEL"] ?? "current";
const SIZES = [1_000, 10_000, 50_000];
const RELOADS = 3;

const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

test("startup: cold with nothing stored, warm with stored canvases of 1k, 10k and 50k objects", async ({ page }, info) => {
  const url = pathToFileURL(resolve(process.env["CANVAST_BUILD_DIR"] ?? "dist", "canvast.html")).href + "#debug";
  const marks = () => page.evaluate(() => window.__canvastDebug.startupMarks());
  const ready = async () => {
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
    await page.waitForFunction(() => ["loaded", "indexed", "first-frame"].every((k) => k in window.__canvastDebug.startupMarks()), undefined, { timeout: 300_000 });
  };
  const results: Record<string, unknown> = {};
  await page.goto(url);
  await ready();
  results["cold-empty"] = await marks();
  let stored = 0;
  for (const n of SIZES) {
    const seed = await page.evaluate((k) => window.__canvastDebug.benchStore({ kind: "dense", n: k }), n - stored);
    stored = n;
    const runs: Array<Record<string, number>> = [];
    let heap: number | null = null;
    for (let i = 0; i < RELOADS; i++) {
      await page.reload();
      await ready();
      runs.push(await marks());
      heap = await page.evaluate(() => window.__canvastDebug.heapMB());
    }
    const pick = (k: string): number => median(runs.map((r) => r[k]!));
    results[`warm-${n}`] = { seedMs: seed.ms, loaded: pick("loaded"), indexed: pick("indexed"), firstFrame: pick("first-frame"), heapMB: heap, runs };
    console.log(`warm ${n}: loaded ${pick("loaded").toFixed(0)} ms, indexed ${pick("indexed").toFixed(0)} ms, first frame ${pick("first-frame").toFixed(0)} ms, heap ${heap ?? "n/a"} MB`);
  }
  mkdirSync(resolve("metrics"), { recursive: true });
  writeFileSync(resolve("metrics", `startup-${LABEL}-${info.project.name}.json`), JSON.stringify({ label: LABEL, project: info.project.name, results }, null, 2));
});
