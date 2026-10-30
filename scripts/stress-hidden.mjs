#!/usr/bin/env node
// Hidden items under load and under crashes, in the desktop app of a test snapshot (GitHub's machine: `Stress hidden` workflow).
//   node scripts/stress-hidden.mjs [--items N] [--rounds R] [--kill-items M] [--seed S] [--build <test-builds/…>] [--dir <folder>] [--keep]
// 1. Scale: a workspace of N library files (default 10,000) in nested folders; every folder hidden (each file sealed into .hidden/),
//    locked, opened, the app restarted and opened again, hidden mode begun and ended, 1,000 items shown one at a time and hidden
//    again, then the outside tool
//    (scripts/hidden-items.mjs) decrypts them all. Each step's time, the app's CPU time and its peak memory (every process); every file
//    checked by SHA-256.
// 2. Crashes: a workspace of M files (default 300), R rounds (default 30): an action (hide a folder, hide or show some items, file some
//    into a folder, lock and open) started, the app killed (SIGKILL, every process) at a random moment, started again and opened. After
//    each round, on disk: no item lost (each is a readable file in library/ or a sealed file the password opens, with its bytes), no
//    sealed file that does not open, nothing unknown, no temporary file of a cut-off write left. Exits 1 when any round failed.
// Never point --dir inside a synced folder.
import { _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { decryptHidden } from "./hidden-items.mjs";
import { makeWorkspace } from "./lib/bench-workspace.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const N = Number(opt("--items", 10_000));
const ROUNDS = Number(opt("--rounds", 30));
const M = Number(opt("--kill-items", 300));
const SEED = Number(opt("--seed", Date.now() % 1e9));
const root = resolve(opt("--dir", join(tmpdir(), "canvast-stress-hidden")));
const build = resolve(opt("--build", join("test-builds", readdirSync("test-builds").filter((d) => existsSync(join("test-builds", d, "desktop"))).sort().pop() ?? "")));
if (!existsSync(join(build, "desktop"))) throw new Error(`no desktop build in ${build}: run a test:snap first`);
const PW = "stress password";
const SHOWN = Math.min(1000, N);

/** A seeded random number in [0, 1) (mulberry32), so a failing run can be run again. */
let seed = SEED;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list, n) => [...list].sort(() => rand() - 0.5).slice(0, n);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

// ---- the app ----
async function launch(ws) {
  const app = await electron.launch({ args: [join(build, "desktop"), `--workspace=${ws}`, `--user-data-dir=${ws}-data`, ...(process.env.CI ? ["--no-sandbox"] : [])], env: { ...process.env, CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug", CANVAST_STALE_TMP_MS: "0" }, timeout: 600_000 });
  const page = await app.firstWindow({ timeout: 600_000 });
  page.setDefaultTimeout(1_800_000);
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 1_800_000, polling: 250 });
  const lib = (...a) => page.evaluate((a) => window.__canvastDebug.libraryOp(...a), a);
  const hid = (op, pw) => page.evaluate(([op, pw]) => window.__canvastDebug.hiddenOp(op, pw), [op, pw]);
  const flush = () => page.evaluate(() => window.__canvastDebug.flushStorage());
  const hiddenCount = () => page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hidden).length));
  return { app, page, lib, hid, flush, hiddenCount };
}
/** Wait until `fn()` gives `want` (polled). */
async function until(fn, want, timeout = 1_800_000) {
  const end = Date.now() + timeout;
  for (let got; (got = await fn()) !== want; await new Promise((r) => setTimeout(r, 250))) if (Date.now() > end) throw new Error(`waited for ${want}, still ${got}`);
}
/** Every process of the app (the main one and those under it), from /proc. */
function processTree(pid) {
  const children = new Map();
  for (const p of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const stat = readFileSync(`/proc/${p}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      (children.get(ppid) ?? children.set(ppid, []).get(ppid)).push(Number(p));
    } catch {
      // (gone meanwhile)
    }
  }
  const all = [pid];
  for (let i = 0; i < all.length; i++) all.push(...(children.get(all[i]) ?? []));
  return all;
}
/** Kill the app at once, as a power cut or a crash would (every process, SIGKILL). */
async function kill(app) {
  const main = app.process();
  const gone = new Promise((r) => (main.exitCode !== null ? r() : main.once("exit", r)));
  for (const pid of processTree(main.pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // (already gone)
    }
  }
  await gone;
}
/** Run `fn` while sampling the app's CPU and memory (every process): its time, CPU seconds and peak memory. */
async function measured(app, fn) {
  let cpu = 0, peak = 0, last = performance.now();
  const sample = async () => {
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => [m.cpu.percentCPUUsage, m.memory.workingSetSize])).catch(() => []);
    const now = performance.now();
    cpu += (metrics.reduce((a, [p]) => a + p, 0) / 100) * ((now - last) / 1000);
    peak = Math.max(peak, metrics.reduce((a, [, kb]) => a + kb, 0) / 1024);
    last = now;
  };
  await sample();
  let on = true;
  const loop = (async () => {
    while (on) {
      await new Promise((r) => setTimeout(r, 250));
      await sample();
    }
  })();
  const t = performance.now();
  try {
    await fn();
  } finally {
    on = false;
    await loop;
  }
  return { time: performance.now() - t, cpu, peak };
}

// ---- what is on disk ----
function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of existsSync(d) ? readdirSync(d) : []) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}
/**
 * Every item's bytes on disk: the readable files in library/ and what the password opens in .hidden/ (the outside tool, which also
 * takes back sealed files whose entry is lost). Hashes of each, the sealed files that did not open, and files being written left behind.
 */
async function onDisk(ws) {
  const readable = new Set(filesUnder(join(ws, "library")).filter((f) => !f.includes(".tmp-")).map((f) => sha(readFileSync(f))));
  const out = `${ws}-out`;
  rmSync(out, { recursive: true, force: true });
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  let opened = 0;
  try {
    opened = existsSync(join(ws, ".canvast/hidden.json")) ? await decryptHidden(ws, out, PW) : 0;
  } finally {
    console.warn = warn;
  }
  const sealed = new Set(filesUnder(out).filter((f) => !f.endsWith("hidden-items.json")).map((f) => sha(readFileSync(f))));
  rmSync(out, { recursive: true, force: true });
  const temps = filesUnder(ws).filter((f) => f.includes(".tmp-")).map((f) => relative(ws, f));
  return { readable, sealed, opened, damaged: warnings.filter((w) => /does not open/.test(w)), missing: warnings.filter((w) => /^missing/.test(w)), temps };
}

const rows = [];
const note = (what, m) => {
  rows.push([what, secs(m.time), `${m.cpu.toFixed(1)} s`, `${Math.round(m.peak)} MB`]);
  console.log(`${what}: ${secs(m.time)}, CPU ${m.cpu.toFixed(1)} s, peak ${Math.round(m.peak)} MB`);
};
let failed = false;
console.log(`seed ${SEED}`);

// ---- 1. scale ----
{
  const ws = join(root, `scale-${N}`);
  rmSync(`${ws}-data`, { recursive: true, force: true });
  const { items, folders } = makeWorkspace(ws, N, { perFolder: 100, nest: 4 });
  const expected = new Set(items.map((i) => i.hash));
  let s = await launch(ws);
  await s.page.evaluate(() => window.__canvastDebug.setView("assets"));
  await s.page.locator('[data-testid="assets-count"]').filter({ hasText: new RegExp(`^${N} items?$`) }).waitFor();
  if (!(await s.hid("set", PW)).ok) throw new Error("the Hidden password was not set");
  note(`hide every folder (${N.toLocaleString()} items sealed)`, await measured(s.app, async () => {
    for (const f of folders.filter((f) => !f.parentId)) await s.lib("hideFolder", f.id);
    await s.flush();
  }));
  const left = filesUnder(join(ws, "library")).length;
  const bins = readdirSync(join(ws, ".hidden")).filter((n) => /^[0-9a-f]{32}\.bin$/.test(n)).length;
  console.log(`  library/ files left: ${left}; sealed files: ${bins}`);
  if (left || bins !== N) (failed = true), console.error(`FAILED: expected 0 readable and ${N} sealed files`);
  note("lock", await measured(s.app, () => s.hid("lock")));
  note(`open (password), until the ${N.toLocaleString()} hidden items are listed`, await measured(s.app, async () => {
    await s.hid("check", PW);
    await until(s.hiddenCount, N);
  }));
  await s.flush();
  await s.app.close();
  s = await launch(ws);
  note("restart, open, until listed", await measured(s.app, async () => {
    await s.hid("check", PW);
    await until(s.hiddenCount, N);
  }));
  // Hidden mode: the Library view over every hidden item (the word, then the password if asked), and back.
  note(`hidden mode: the Library view lists the ${N.toLocaleString()} hidden items`, await measured(s.app, async () => {
    await s.page.evaluate(() => window.__canvastDebug.setView("assets"));
    await s.page.getByTestId("assets-search").fill("hidden:");
    const asked = s.page.getByTestId("prompt-input");
    if (await asked.isVisible({ timeout: 2000 }).catch(() => false)) (await asked.fill(PW), await s.page.getByTestId("prompt-ok").click());
    await s.page.locator('[data-testid="assets-count"]').filter({ hasText: new RegExp(`^${N} items?$`) }).waitFor();
  }));
  note("hidden mode ended (Exit), the Library view empty again", await measured(s.app, async () => {
    await s.page.getByTestId("hidden-mode-exit").click();
    await s.page.locator('[data-testid="assets-count"]').filter({ hasText: /^0 items?$/ }).waitFor();
  }));
  const some = items.slice(0, SHOWN).map((i) => i.hash);
  note(`show ${SHOWN.toLocaleString()} items one at a time`, await measured(s.app, async () => {
    for (const h of some) await s.lib("hide", h, "");
    await s.flush();
  }));
  const back = new Set(filesUnder(join(ws, "library")).map((f) => sha(readFileSync(f))));
  if (!some.every((h) => back.has(h))) (failed = true), console.error(`FAILED: not every shown item is readable in library/ (${back.size} of ${SHOWN})`);
  note(`hide them again one at a time`, await measured(s.app, async () => {
    for (const h of some) await s.lib("hide", h, "1");
    await s.flush();
  }));
  await s.app.close();
  const t = performance.now();
  const disk = await onDisk(ws);
  rows.push([`outside tool: decrypt ${N.toLocaleString()} files`, secs(performance.now() - t), "", ""]);
  const lost = [...expected].filter((h) => !disk.sealed.has(h));
  console.log(`  decrypted ${disk.opened}, lost ${lost.length}, damaged ${disk.damaged.length}, readable left ${disk.readable.size}`);
  if (lost.length || disk.damaged.length || disk.readable.size) (failed = true), console.error("FAILED: the outside tool did not give back every item, each with its bytes");
  if (!args.includes("--keep")) for (const d of [ws, `${ws}-data`]) rmSync(d, { recursive: true, force: true });
}

// ---- 2. crashes ----
const crashes = [];
{
  const ws = join(root, `crash-${M}`);
  rmSync(`${ws}-data`, { recursive: true, force: true });
  const { items, folders } = makeWorkspace(ws, M, { perFolder: 30, nest: 3 });
  const expected = new Set(items.map((i) => i.hash));
  const hashes = items.map((i) => i.hash);
  let s = await launch(ws);
  await s.hid("set", PW);
  for (const f of pick(folders.filter((f) => !f.parentId), 2)) await s.lib("hideFolder", f.id);
  await s.flush();
  await s.app.close();
  const ACTIONS = {
    "hide a folder": (s) => s.lib("hideFolder", pick(folders, 1)[0].id),
    "hide 60 items": async (s) => { for (const h of pick(hashes, 60)) await s.lib("hide", h, "1"); },
    "show 60 items": async (s) => { for (const h of pick(hashes, 60)) await s.lib("hide", h, ""); },
    "file 60 items into a folder": async (s) => { const f = pick(folders, 1)[0].id; for (const h of pick(hashes, 60)) await s.lib("file", h, f); },
    "lock and open": async (s) => { await s.hid("lock"); await s.hid("check", PW); },
  };
  for (let r = 1; r <= ROUNDS; r++) {
    const action = pick(Object.keys(ACTIONS), 1)[0];
    const after = Math.round(rand() * 1500);
    s = await launch(ws);
    await s.hid("check", PW);
    let done = false;
    void ACTIONS[action](s).then(() => s.flush()).then(() => (done = true), () => undefined); // (cut off by the kill)
    await new Promise((res) => setTimeout(res, after));
    const cut = !done;
    await kill(s.app);
    // Started again: opened, what waited is written, closed as a person would.
    s = await launch(ws);
    await s.hid("check", PW);
    await s.flush();
    await s.app.close();
    const d = await onDisk(ws);
    const lost = [...expected].filter((h) => !d.readable.has(h) && !d.sealed.has(h)).length;
    const unknown = [...d.readable, ...d.sealed].filter((h) => !expected.has(h)).length;
    const both = [...d.readable].filter((h) => d.sealed.has(h)).length;
    crashes.push([r, action, `${after} ms`, cut ? "yes" : "no", lost, d.damaged.length, unknown, both, d.temps.length]);
    console.log(`round ${r}: ${action}, killed after ${after} ms${cut ? " (cut off)" : " (had finished)"}: lost ${lost}, damaged ${d.damaged.length}, unknown ${unknown}, readable and sealed ${both}, temporary files ${d.temps.length}`);
    if (d.temps.length) console.log(`  left behind: ${d.temps.join(", ")}`);
    if (lost || d.damaged.length || unknown || d.temps.length) failed = true;
  }
  // The library itself, once the app has had time to take back sealed files whose entries a kill lost: every item there.
  s = await launch(ws);
  await s.hid("check", PW);
  const count = () => s.page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length));
  await until(count, M, 90_000).catch((e) => ((failed = true), console.error(`FAILED: the library after the crashes: ${e.message}`)));
  await s.app.close();
  if (!args.includes("--keep")) for (const d of [ws, `${ws}-data`]) rmSync(d, { recursive: true, force: true });
}

console.log(`\nseed ${SEED}\n\n| ${N.toLocaleString()} hidden items | time | CPU | peak memory |\n| --- | --- | --- | --- |\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`);
console.log(`\n| round | action | killed after | cut off | lost | damaged | unknown | readable and sealed | temporary files |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${crashes.map((r) => `| ${r.join(" | ")} |`).join("\n")}`);
console.log(`\n${crashes.filter((r) => r[3] === "yes").length} of ${crashes.length} kills cut an action off`);
console.log(failed ? "\n❌ items were lost or damaged (see above)" : "\n✅ nothing lost or damaged");
process.exit(failed ? 1 : 0);
