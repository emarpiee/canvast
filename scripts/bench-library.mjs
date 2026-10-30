#!/usr/bin/env node
// How the desktop app copes with a big library: a workspace folder of N library files, as another device would have made it (the files
// in library/<folder>/, a thousand to a folder, and the library index in parts), opened by the desktop build of a test snapshot.
//   node scripts/bench-library.mjs <N> [--dir <folder>] [--build <test-builds/…>] [--keep]
// Times: making the folder; the first open on a new device (the whole library taken from the folder), until the Library view shows
// every item; a second open (from the app's own storage), the same; a file put into library/ from outside, until the Library view shows
// it; one rename, until it is written. The folder is made again only when it does not hold N items; it is removed at the end unless
// --keep. Never point --dir inside a synced folder.
import { _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const N = Number(args[0]);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
if (!Number.isInteger(N) || N < 1) {
  console.error("usage: node scripts/bench-library.mjs <N> [--dir <folder>] [--build <test-builds/…>] [--keep]");
  process.exit(2);
}
const dir = resolve(opt("--dir", join(tmpdir(), `canvast-bench-${N}`)));
const build = resolve(opt("--build", join("test-builds", readdirSync("test-builds").filter((d) => existsSync(join("test-builds", d, "desktop"))).sort().pop() ?? "")));
if (!existsSync(join(build, "desktop"))) throw new Error(`no desktop build in ${build}: run a test:snap first`);
const PER_FOLDER = 1000;
const ms = (t) => `${((performance.now() - t) / 1000).toFixed(1)} s`;
const results = [];
const note = (what, value) => (results.push([what, value]), console.log(`${what}: ${value}`));

// ---- the folder ----
const marker = join(dir, ".bench-items");
if (!existsSync(marker) || Number(String(statSync(marker).size)) !== N) {
  const t = performance.now();
  rmSync(dir, { recursive: true, force: true });
  const folders = [];
  const parts = new Map();
  for (let i = 0; i < N; i++) {
    const f = Math.floor(i / PER_FOLDER);
    const folderId = `f${String(f).padStart(5, "0")}`;
    const folderDir = `bench_${String(f).padStart(5, "0")}`;
    if (i % PER_FOLDER === 0) {
      folders.push({ id: folderId, name: folderDir, parentId: null });
      mkdirSync(join(dir, "library", folderDir), { recursive: true });
    }
    const name = `b${String(i).padStart(7, "0")}.png`;
    const bytes = Buffer.from(`canvast bench item ${i}\n`);
    writeFileSync(join(dir, "library", folderDir, name), bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const item = { hash, file: `library/${folderDir}/${name}`, name, type: "image/png", size: bytes.length, pixelW: 1, pixelH: 1, importedAt: 1_700_000_000_000 + i, tags: [], favorite: false, folderId, note: "", fields: [], state: "active" };
    (parts.get(hash[0]) ?? parts.set(hash[0], []).get(hash[0])).push(item);
  }
  mkdirSync(join(dir, ".canvast/library"), { recursive: true });
  for (const [k, list] of parts) writeFileSync(join(dir, `.canvast/library/items-${k}.json`), `{"format":"canvast-library-items","version":2,\n"items":[\n${list.map((i) => JSON.stringify(i)).join(",\n")}\n]}\n`);
  writeFileSync(join(dir, ".canvast/library/index.json"), `${JSON.stringify({ format: "canvast-library", version: 2, folders, parts: [...parts.keys()].sort() })}\n`);
  writeFileSync(marker, "x".repeat(N));
  note(`made ${N.toLocaleString()} files`, ms(t));
}

// ---- the app ----
async function open(device) {
  const t = performance.now();
  const app = await electron.launch({ args: [join(build, "desktop"), `--workspace=${dir}`, `--user-data-dir=${dir}-${device}`], env: { ...process.env, CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug" }, timeout: 600_000 });
  const page = await app.firstWindow({ timeout: 600_000 });
  if (args.includes("--trace")) page.on("console", (m) => m.text().startsWith("⏱") && console.log(`  ${((performance.now() - t) / 1000).toFixed(1)}s ${m.text()}`));
  page.setDefaultTimeout(1_800_000);
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 1_800_000, polling: 500 });
  const ready = ms(t);
  // What a person sees: the Library view open, its count saying every item is there (asked of the view, never of the whole library
  // again and again, which at a million items would be the benchmark loading the app).
  await page.evaluate(() => window.__canvastDebug.setView("assets"));
  const listed = (n) => page.locator('[data-testid="assets-count"]').filter({ hasText: new RegExp(`^${n} items?$`) }).waitFor({ timeout: 1_800_000 });
  await listed(N);
  return { app, page, ready, listed: ms(t), until: listed };
}
const heap = (page) => page.evaluate(() => (performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 2 ** 20)} MB` : "?"));

rmSync(`${dir}-device-a`, { recursive: true, force: true });
let s = await open("device-a");
note("first open, new device: page ready", s.ready);
note("first open, new device: the Library view shows every item", s.listed);
note("first open: page heap", await heap(s.page));
await s.page.evaluate(() => window.__canvastDebug.flushStorage());
await s.app.close();

s = await open("device-a");
note("second open: page ready", s.ready);
note("second open: the Library view shows every item", s.listed);
note("second open: page heap", await heap(s.page));
let t = performance.now();
// (an outside file is imported: it is decoded, so it must be a picture; a tiny PNG)
writeFileSync(join(dir, "library", "bench_00000", "outside.png"), Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005fe02fe0d1d71e40000000049454e44ae426082", "hex"));
await s.until(N + 1);
note("a file put into library/ from outside, until the Library view shows it", ms(t));
const hash = await s.page.locator('[data-testid="asset-card"]').first().getAttribute("data-hash");
t = performance.now();
await s.page.evaluate((h) => window.__canvastDebug.libraryOp("rename", h, "renamed in the bench.png"), hash);
await s.page.evaluate(() => window.__canvastDebug.flushStorage());
note("one rename, until written to the folder", ms(t));
await s.app.close();

console.log(`\n| ${N.toLocaleString()} items | time |\n| --- | --- |\n${results.map(([a, b]) => `| ${a} | ${b} |`).join("\n")}`);
if (!args.includes("--keep")) for (const d of [dir, `${dir}-device-a`]) rmSync(d, { recursive: true, force: true });
