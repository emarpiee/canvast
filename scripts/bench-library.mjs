#!/usr/bin/env node
// How the desktop app copes with a big library: a workspace folder of N library files, as another device would have made it (the files
// in library/<folder>/, a thousand to a folder, and the library index in parts), opened by the desktop build of a test snapshot.
//   node scripts/bench-library.mjs <N> [--dir <folder>] [--build <test-builds/…>] [--keep] [--scroll]
// Times: making the folder; the first open on a new device (the whole library taken from the folder), until the Library view shows
// every item; a second open (from the app's own storage), the same; a file put into library/ from outside, until the Library view shows
// it; one rename, until it is written. The folder is made again only when it does not hold N items; it is removed at the end unless
// --keep. Never point --dir inside a synced folder.
// --scroll: the window is shown (a hidden one draws a frame a second); the files are real small pictures, and the Library view is scrolled with the mouse wheel in Thumbnails and List, the
// thumbnail size at its smallest and its largest, each twice (the first time its thumbnails are made, the second they are ready):
// frames per second, the slowest frames, and how long the cards in view wait for their pictures once the wheel stops.
import { _electron as electron } from "@playwright/test";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeWorkspace } from "./lib/bench-workspace.mjs";

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
const SCROLL = args.includes("--scroll");
const ms = (t) => `${((performance.now() - t) / 1000).toFixed(1)} s`;
const results = [];
const note = (what, value) => (results.push([what, value]), console.log(`${what}: ${value}`));

// ---- the folder ----
const marker = join(dir, ".bench-items");
const kind = SCROLL ? "p" : "x";
if (!existsSync(marker) || Number(String(statSync(marker).size)) !== N || readFileSync(marker, "utf8")[0] !== kind) {
  const t = performance.now();
  makeWorkspace(dir, N, { perFolder: PER_FOLDER, pictures: SCROLL });
  writeFileSync(marker, kind.repeat(N));
  note(`made ${N.toLocaleString()} files`, ms(t));
}

// ---- the app ----
async function open(device) {
  const t = performance.now();
  const app = await electron.launch({ args: [join(build, "desktop"), `--workspace=${dir}`, `--user-data-dir=${dir}-${device}`], env: { ...process.env, ...(SCROLL ? {} : { CANVAST_HIDDEN: "1" }), CANVAST_HASH: "#debug" }, timeout: 600_000 });
  const page = await app.firstWindow({ timeout: 600_000 });
  // (one window size for every run: 1400 x 900)
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { w.setContentSize(1400, 900); } });
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

// ---- scrolling the Library view (--scroll) ----
const scrollRows = [];
const timeRows = [];
async function scrollPass(page, mode, size, pass) {
  await page.locator(`.assets-view [data-layout="${mode}"], [data-layout="${mode}"]`).first().click();
  await page.locator(".assets-size input").evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, size);
  await page.evaluate(() => { document.querySelector(".assets-scroll").scrollTop = 0; });
  await page.waitForTimeout(2000);
  const box = (await page.locator(".assets-scroll").boundingBox());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    const w = window; w.__frames = []; w.__on = true; let last = performance.now();
    const tick = (t) => { w.__frames.push(t - last); last = t; if (w.__on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  // Where the time goes: the page's own counters (script, style, layout, and the rest of each task: paint and decoding), and for the
  // smallest thumbnails a profile of the script, its busiest functions with the code around them.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const profiling = mode === "grid" && size === 96;
  if (profiling) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
  }
  const t0 = performance.now();
  const STEPS = 250, DELTA = 200; // (a wheel notch every 16 ms: a fast, steady scroll of about 50,000 px)
  for (let i = 0; i < STEPS; i++) { await page.mouse.wheel(0, DELTA); await page.waitForTimeout(16); }
  const secs = (performance.now() - t0) / 1000;
  const r = await page.evaluate(() => {
    const w = window; w.__on = false;
    const f = w.__frames.slice(1).sort((a, b) => a - b), sum = f.reduce((a, b) => a + b, 0);
    const sc = document.querySelector(".assets-scroll");
    return { fps: f.length / (sum / 1000), p95: f[Math.floor(f.length * 0.95)] ?? 0, worst: f[f.length - 1] ?? 0, long: f.filter((x) => x > 50).length, top: sc.scrollTop, height: sc.scrollHeight };
  });
  const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const d = (k) => ((after[k] ?? 0) - (before[k] ?? 0)) * 1000;
  const task = d("TaskDuration"), script = d("ScriptDuration"), style = d("RecalcStyleDuration"), lay = d("LayoutDuration");
  console.log(`  time in ${secs.toFixed(1)} s of scrolling: tasks ${task.toFixed(0)} ms = script ${script.toFixed(0)}, style ${style.toFixed(0)} (${after.RecalcStyleCount - before.RecalcStyleCount}x), layout ${lay.toFixed(0)} (${after.LayoutCount - before.LayoutCount}x), the rest (paint, decoding, other) ${(task - script - style - lay).toFixed(0)}; nodes ${after.Nodes}`);
  timeRows.push([`${mode === "grid" ? "Thumbnails" : "List"}, size ${size}`, pass, task.toFixed(0), script.toFixed(0), style.toFixed(0), lay.toFixed(0), (task - script - style - lay).toFixed(0)]);
  if (profiling) {
    const { profile } = await cdp.send("Profiler.stop");
    const dt = new Map();
    const deltas = profile.timeDeltas ?? [];
    for (let i = 0; i < (profile.samples ?? []).length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (deltas[i] ?? 0) / 1000);
    const self = new Map();
    for (const n of profile.nodes) {
      const f = n.callFrame;
      const key = `${f.functionName || "(anonymous)"} @${f.lineNumber}:${f.columnNumber}|${f.url}`;
      self.set(key, (self.get(key) ?? 0) + (dt.get(n.id) ?? 0));
    }
    const sources = new Map();
    const near = (url, line, col) => {
      if (!url.startsWith("file://")) return "";
      if (!sources.has(url)) { try { sources.set(url, readFileSync(decodeURIComponent(new URL(url).pathname), "utf8").split("\n")); } catch { sources.set(url, []); } }
      const text = sources.get(url)[line] ?? "";
      return text.slice(Math.max(0, col - 60), col + 100).replace(/\s+/g, " ");
    };
    console.log(`  profile, ${pass} (self time, ms):`);
    for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
      const [name, url] = key.split("|");
      const [, line, col] = name.match(/@(\d+):(\d+)$/) ?? [];
      console.log(`    ${ms.toFixed(0).padStart(6)}  ${name.padEnd(36)} ${url ? near(url, Number(line), Number(col)) : ""}`);
    }
  }
  await cdp.detach();
  // the cards in view once the wheel stops: how long until each shows its picture
  const t1 = performance.now();
  const waiting = () => page.evaluate(() => {
    const sc = document.querySelector(".assets-scroll").getBoundingClientRect();
    let n = 0;
    for (const c of document.querySelectorAll('[data-testid="asset-card"]')) {
      const b = c.getBoundingClientRect();
      if (b.bottom < sc.top || b.top > sc.bottom) continue;
      const img = c.querySelector(".asset-thumb img");
      if (!img || !img.getAttribute("src") || !img.complete || !img.naturalWidth) n++;
    }
    return n;
  });
  const atStop = await waiting();
  let left = atStop;
  while (left > 0 && performance.now() - t1 < 30_000) { await page.waitForTimeout(100); left = await waiting(); }
  const filled = left > 0 ? "over 30 s" : `${((performance.now() - t1) / 1000).toFixed(2)} s`;
  scrollRows.push([`${mode === "grid" ? "Thumbnails" : "List"}, size ${size}`, pass, `${r.fps.toFixed(0)}`, `${r.p95.toFixed(0)} ms`, `${r.worst.toFixed(0)} ms`, String(r.long), `${Math.round(r.top / secs).toLocaleString()} px/s`, `${atStop}`, filled]);
  console.log(`scroll ${mode} ${size} ${pass}: ${JSON.stringify(r)} cards waiting ${atStop}, all shown ${filled}`);
}
if (SCROLL) {
  for (const pass of ["first time", "again"])
    for (const mode of ["grid", "list"])
      for (const size of [96, 240]) await scrollPass(s.page, mode, size, pass);
  note("after scrolling: page heap", await heap(s.page));
}
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
if (timeRows.length) console.log(`\n| Where the time went (ms) | Pass | Tasks | Script | Style | Layout | Paint, decoding, other |\n| --- | --- | --- | --- | --- | --- | --- |\n${timeRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`);
if (scrollRows.length) console.log(`\n| Scrolling ${N.toLocaleString()} items | Pass | FPS | Slowest 5 % | Slowest | Frames over 50 ms | Speed | Cards waiting at stop | Until all shown |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${scrollRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`);
if (!args.includes("--keep")) for (const d of [dir, `${dir}-device-a`]) rmSync(d, { recursive: true, force: true });
