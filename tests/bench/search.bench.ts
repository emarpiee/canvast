import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BenchScene } from "../../src/app/bench";

/**
 * Phase 8: canvas search at scale (docs/testing/phase-8.md). One key typed in the search (the whole of it: the matching and the list drawn),
 * in a canvas of N objects: a word every object has (the search stops after the first results), a word none has (every object is read), and a
 * tag none has. Results go to metrics/search-<label>-<project>.json.
 */
const LABEL = process.env["BENCH_LABEL"] ?? "current";
const CASES: Array<{ name: string; scene: BenchScene }> = [
  { name: "100k", scene: { kind: "clusters", n: 100_000, clusters: 1_000 } },
  { name: "1m", scene: { kind: "clusters", n: 1_000_000, clusters: 1_000 } },
];

test("search: one key in a canvas of 100k and of 1M objects", async ({ page }, info) => {
  await page.goto(pathToFileURL(resolve(process.env["CANVAST_BUILD_DIR"] ?? "dist", "canvast.html")).href + "#debug");
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const out: Record<string, Record<string, number>> = {};
  for (const c of CASES) {
    await page.evaluate((s) => window.__canvastDebug.benchLoad(s), c.scene);
    await page.keyboard.press("Control+f");
    await page.getByRole("combobox", { name: "Search the canvas" }).waitFor();
    const time = (text: string) =>
      page.evaluate((t) => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Search the canvas"]')!;
        input.value = t;
        const t0 = performance.now();
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return performance.now() - t0;
      }, text);
    const row: Record<string, number> = {};
    for (const [k, q] of [["everyWord", "stroke"], ["noWord", "zzzzqq"], ["noTag", "#zzzzqq"]] as const) {
      await time(q); // (warm up)
      const runs = [await time(q), await time(q), await time(q)];
      row[k] = runs.sort((a, b) => a - b)[1]!;
    }
    out[c.name] = row;
    console.log(`search ${c.name}: ${JSON.stringify(row)}`);
    await page.keyboard.press("Escape");
  }
  mkdirSync(resolve("metrics"), { recursive: true });
  writeFileSync(resolve("metrics", `search-${LABEL}-${info.project.name}.json`), JSON.stringify({ label: LABEL, project: info.project.name, results: out }, null, 2));
});
