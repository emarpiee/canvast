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
// 3. Big files (`--big K`, off at 0): K × about 15 GB of files from 50 KB to 2 GB (many of hundreds of MB, a few of GBs) beside
//    `--items` small ones: taken in, hidden one size at a time, locked, the app restarted and opened, each size read back through the
//    folder for file managers (the first megabyte, a part in the middle, the whole file: what a viewer or a file manager does), the big
//    ones shown again, the rest decrypted by the outside tool. Per size: time, MB/s, the app's peak memory and the disk used beyond the
//    files; every byte checked by SHA-256.
// Never point --dir inside a synced folder.
import { _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { randomFillSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { decryptHidden } from "./hidden-items.mjs";
import { makeWorkspace } from "./lib/bench-workspace.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const N = Number(opt("--items", 10_000));
const ROUNDS = Number(opt("--rounds", 30));
const M = Number(opt("--kill-items", 300));
const BIG = Number(opt("--big", 0));
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
/** A file's SHA-256, read a part at a time (files of GBs). */
const shaFile = (p) => new Promise((ok, fail) => {
  const h = createHash("sha256");
  createReadStream(p).on("data", (b) => h.update(b)).on("end", () => ok(h.digest("hex"))).on("error", fail);
});
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
  /** The peak of each kind of process (main, page, GPU...), in MB: which one holds the memory. */
  const byType = {};
  const sample = async () => {
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => [m.cpu.percentCPUUsage, m.memory.workingSetSize, m.type])).catch(() => []);
    const now = performance.now();
    cpu += (metrics.reduce((a, [p]) => a + p, 0) / 100) * ((now - last) / 1000);
    peak = Math.max(peak, metrics.reduce((a, [, kb]) => a + kb, 0) / 1024);
    for (const [, kb, type] of metrics) byType[type] = Math.max(byType[type] ?? 0, Math.round(kb / 1024));
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
  return { time: performance.now() - t, cpu, peak, byType };
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
  console.log(`${what}: ${secs(m.time)}, CPU ${m.cpu.toFixed(1)} s, peak ${Math.round(m.peak)} MB (${Object.entries(m.byType).map(([k, v]) => `${k} ${v}`).join(", ")})`);
};
let failed = false;
console.log(`seed ${SEED}`);

// ---- 1. scale ----
if (N > 0 && !BIG) {
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
  const bins = filesUnder(join(ws, ".hidden")).filter((f) => !/\.name$|\.json$|[\\/]thumbnails[\\/]/.test(f)).length; // (in their encrypted folders, under encrypted names)
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
  // Held or only not collected yet: the page's live heap a while after that (what the next major collection keeps).
  const live = async () => {
    await new Promise((r) => setTimeout(r, 10_000));
    const before = await s.page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 2 ** 20));
    const cdp = await s.page.context().newCDPSession(s.page);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.detach();
    return `${before} MB, ${await s.page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 2 ** 20))} MB after a full collection`;
  };
  console.log(`  page heap in use 10 s after showing them: ${await live()}`);
  note(`hide them again one at a time`, await measured(s.app, async () => {
    for (const h of some) await s.lib("hide", h, "1");
    await s.flush();
  }));
  console.log(`  page heap in use 10 s after hiding them again: ${await live()}`);
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
let traced = false;
if (ROUNDS > 0) {
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
    const lostHashes = [...expected].filter((h) => !d.readable.has(h) && !d.sealed.has(h));
    const lost = lostHashes.length;
    // The first time: where they are, if anywhere, and the folder as it stands, for a person to read (only made-up files).
    if (lost && !traced) {
      traced = true;
      const everywhere = filesUnder(ws).filter((f) => !f.includes(`${ws}${sep}.hidden${sep}`));
      const found = everywhere.filter((f) => lostHashes.includes(sha(readFileSync(f))));
      console.log(`  TRACE round ${r}: ${lost} lost; readable ${d.readable.size}, sealed opened ${d.sealed.size}, sealed files on disk ${filesUnder(join(ws, ".hidden")).filter((f) => !/\.name$|\.json$|[\\/]thumbnails[\\/]/.test(f)).length}, in .trash ${filesUnder(join(ws, ".trash")).length}`);
      console.log(`  TRACE found readable elsewhere: ${found.length}: ${found.slice(0, 8).map((f) => relative(ws, f)).join(", ")}`);
      console.log(`  TRACE the tool said: missing ${d.missing.length} (${d.missing.slice(0, 5).join(" | ")}), damaged ${d.damaged.length}`);
      if (process.env.STRESS_KEEP) {
        cpSync(ws, join(process.env.STRESS_KEEP, "workspace"), { recursive: true });
        cpSync(`${ws}-data`, join(process.env.STRESS_KEEP, "data"), { recursive: true, filter: (f) => !/Cache|GPUCache|Crashpad|blob_storage/.test(f) });
      }
    }
    const unknown = [...d.readable, ...d.sealed].filter((h) => !expected.has(h)).length;
    const both = [...d.readable].filter((h) => d.sealed.has(h)).length;
    crashes.push([r, action, `${after} ms`, cut ? "yes" : "no", lost, d.damaged.length, unknown, both, d.temps.length]);
    console.log(`round ${r}: ${action}, killed after ${after} ms${cut ? " (cut off)" : " (had finished)"}: lost ${lost}, damaged ${d.damaged.length}, unknown ${unknown}, readable and sealed ${both}, temporary files ${d.temps.length}`);
    if (d.temps.length) console.log(`  left behind: ${d.temps.join(", ")}`);
    if (lost || d.damaged.length || unknown) failed = true; // (a temporary file a kill left is no loss: the next start sweeps it once it is old)
  }
  // The library itself, once the app has had time to take back sealed files whose entries a kill lost: every item there.
  s = await launch(ws);
  await s.hid("check", PW);
  const count = () => s.page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length));
  await until(count, M, 90_000).catch((e) => ((failed = true), console.error(`FAILED: the library after the crashes: ${e.message}`)));
  await s.app.close();
  if (!args.includes("--keep")) for (const d of [ws, `${ws}-data`]) rmSync(d, { recursive: true, force: true });
}

// ---- 3. big files ----
const bigRows = [];
if (BIG > 0) {
  const MB = 2 ** 20;
  /** The sizes, and how many of each (times K). */
  const SIZES = [[0.05, 200], [1, 40], [10, 20], [50, 10], [100, 10], [200, 8], [300, 6], [500, 4], [1024, 4], [2048, 2]].map(([mb, n]) => ({ mb, n: Math.max(1, Math.round(n * BIG)), name: mb < 1 ? "50 KB" : mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB` }));
  const ws = join(root, "big");
  rmSync(`${ws}-data`, { recursive: true, force: true });
  const { items } = makeWorkspace(ws, N, { perFolder: 500, nest: 2 });
  const used = () => {
    const f = statfsSync(root);
    return (f.blocks - f.bfree) * f.bsize;
  };
  // Each file different (its number in every block), written a block at a time and hashed as written.
  const block = Buffer.alloc(8 * MB);
  randomFillSync(block);
  const t0 = performance.now();
  for (const [k, size] of SIZES.entries()) {
    size.files = [];
    const dir = join(ws, "library", "big", `s${k}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < size.n; i++) {
      const bytes = Math.round(size.mb * MB);
      const name = `s${k}-${String(i).padStart(3, "0")}.dat`;
      const h = createHash("sha256");
      const fd = openSync(join(dir, name), "w");
      for (let at = 0; at < bytes; ) {
        const n = Math.min(block.length, bytes - at);
        block.writeUInt32LE(k * 1000 + i, 0);
        block.writeUInt32LE(at / block.length, 4);
        writeSync(fd, block, 0, n);
        h.update(block.subarray(0, n));
        at += n;
      }
      closeSync(fd);
      size.files.push({ name, file: join(dir, name), bytes, hash: h.digest("hex") });
    }
  }
  const total = SIZES.reduce((a, s) => a + s.files.reduce((b, f) => b + f.bytes, 0), 0);
  const count = N + SIZES.reduce((a, s) => a + s.n, 0);
  const gb = (b) => `${(b / 2 ** 30).toFixed(1)} GB`;
  console.log(`big files: ${count.toLocaleString()} items, ${gb(total)} written in ${secs(performance.now() - t0)}; disk free ${gb(statfsSync(root).bavail * statfsSync(root).bsize)}`);
  const rate = (bytes, ms) => `${((bytes / MB) / (ms / 1000)).toFixed(0)} MB/s`;
  /** `measured`, and the disk used beyond what it was before: the copies held while files are sealed or shown. */
  const withDisk = async (app, fn) => {
    const base = used();
    let peak = 0;
    const timer = setInterval(() => (peak = Math.max(peak, used() - base)), 200);
    try {
      return { ...(await measured(app, fn)), disk: peak };
    } finally {
      clearInterval(timer);
    }
  };
  const row = (what, size, bytes, m) => {
    bigRows.push([what, size, secs(m.time), rate(bytes, m.time), `${Math.round(m.peak)} MB`, m.disk === undefined ? "" : gb(Math.max(0, m.disk))]);
    console.log(`${what} ${size}: ${secs(m.time)}, ${rate(bytes, m.time)}, peak memory ${Math.round(m.peak)} MB${m.disk === undefined ? "" : `, disk beyond the files ${gb(Math.max(0, m.disk))}`}`);
  };
  const readable = () => filesUnder(join(ws, "library", "big")).length;
  let s = await launch(ws);
  const listed = () => s.page.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.length));
  row("take in (start, every file read once)", "all", total, await withDisk(s.app, () => until(listed, count)));
  if (!(await s.hid("set", PW)).ok) throw new Error("the Hidden password was not set");
  // Hidden one size at a time, the small ones by their folders.
  const small = await withDisk(s.app, async () => {
    for (const f of items.length ? [...new Set(items.map((i) => i.folderId))] : []) await s.lib("hideFolder", f);
    await s.flush();
  });
  row(`hide ${N.toLocaleString()} small items`, "tiny", items.reduce((a, i) => a + i.size, 0), small);
  for (const size of SIZES) {
    const before = readable();
    const m = await withDisk(s.app, async () => {
      for (const f of size.files) await s.lib("hide", f.hash, "1");
      await s.flush();
      await until(() => Promise.resolve(readable()), before - size.n);
    });
    row(`hide ${size.n} ×`, size.name, size.n * size.files[0].bytes, m);
  }
  if (readable()) (failed = true), console.error(`FAILED: ${readable()} big files still readable after hiding`);
  await s.hid("lock");
  await s.app.close();
  s = await launch(ws);
  const hiddenCount = () => s.hiddenCount();
  const opened = await measured(s.app, async () => {
    await s.hid("check", PW);
    await until(hiddenCount, count);
  });
  bigRows.push([`restart, open, until the ${count.toLocaleString()} hidden items are listed`, "all", secs(opened.time), "", `${Math.round(opened.peak)} MB`, ""]);
  // Read back through the folder (decrypted as read): the first megabyte (what starts a viewer), a part in the middle (a jump), then
  // the whole file, compared with what was written.
  await s.page.evaluate(() => window.canvastDesktop.share.call("dav", true));
  const st = await s.page.evaluate(() => window.canvastDesktop.share.call("status"));
  const get = (path, range) =>
    new Promise((ok, fail) => {
      const t = performance.now();
      let first = 0, bytes = 0;
      const h = createHash("sha256");
      const req = httpsRequest({ host: "127.0.0.1", port: st.port, path: encodeURI(path), rejectUnauthorized: false, headers: { authorization: `Basic ${Buffer.from(`me:${st.dav.password}`).toString("base64")}`, ...(range ? { range } : {}) } }, (res) => {
        res.on("data", (b) => ((first ||= performance.now() - t), (bytes += b.length), h.update(b)));
        res.on("end", () => ok({ status: res.statusCode, first, ms: performance.now() - t, bytes, hash: h.digest("hex") }));
      });
      req.on("error", fail);
      req.end();
    });
  // (each file's place in Hidden, as the folder lists it: found by its name, folder by folder)
  const listing = (path) =>
    new Promise((ok, fail) => {
      const req = httpsRequest({ host: "127.0.0.1", port: st.port, path, method: "PROPFIND", rejectUnauthorized: false, headers: { depth: "1", authorization: `Basic ${Buffer.from(`me:${st.dav.password}`).toString("base64")}` } }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => ok([...b.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1]).filter((h) => h !== path)));
      });
      req.on("error", fail);
      req.end();
    });
  const places = new Map();
  for (let dirs = ["/dav/Hidden/"]; dirs.length; ) {
    const next = [];
    for (const d of dirs) for (const h of await listing(d)) h.endsWith("/") ? next.push(h) : places.set(decodeURIComponent(h.slice(h.lastIndexOf("/") + 1)), decodeURI(h));
    dirs = next;
  }
  console.log(`  the folder lists ${places.size} hidden files`);
  for (const [k, size] of SIZES.entries()) {
    const f = size.files[0];
    const path = places.get(f.name) ?? `/dav/Hidden/${f.name}`;
    const head = await get(path, "bytes=0-1048575");
    const mid = await get(path, `bytes=${Math.floor(f.bytes / 2)}-${Math.floor(f.bytes / 2) + MB - 1}`);
    let whole = { ms: 0, hash: "", bytes: 0 };
    const m = await measured(s.app, async () => void (whole = await get(path)));
    if (whole.hash !== f.hash) (failed = true), console.error(`FAILED: ${path} read back ${whole.bytes} bytes that are not the file's (status ${head.status})`);
    bigRows.push([`read through the folder: first MB ${Math.round(head.first)} ms, a MB in the middle ${Math.round(mid.ms)} ms, whole`, size.name, secs(whole.ms), rate(f.bytes, whole.ms), `${Math.round(m.peak)} MB`, ""]);
    console.log(`read ${size.name}: first MB ${Math.round(head.first)} ms, middle MB ${Math.round(mid.ms)} ms, whole ${secs(whole.ms)} (${rate(f.bytes, whole.ms)}), peak ${Math.round(m.peak)} MB`);
  }
  // The big ones shown again (decrypted into library/), one size at a time, each file checked.
  for (const [k, size] of SIZES.entries()) {
    if (size.mb < 100) continue;
    const m = await withDisk(s.app, async () => {
      for (const f of size.files) await s.lib("hide", f.hash, "");
      await s.flush();
      await until(() => Promise.resolve(filesUnder(join(ws, "library", "big", `s${k}`)).filter((p) => !p.includes(".tmp-")).length), size.n);
    });
    row(`show ${size.n} ×`, size.name, size.n * size.files[0].bytes, m);
    const back = new Set(await Promise.all(filesUnder(join(ws, "library", "big", `s${k}`)).map(shaFile)));
    if (!size.files.every((f) => back.has(f.hash))) (failed = true), console.error(`FAILED: ${size.name}: a file shown again is not its bytes`);
    rmSync(join(ws, "library", "big", `s${k}`), { recursive: true, force: true }); // (checked: room for the next size)
  }
  await s.app.close();
  // The rest by the outside tool.
  const rest = SIZES.filter((x) => x.mb < 100);
  const restBytes = rest.reduce((a, x) => a + x.n * x.files[0].bytes, 0) + items.reduce((a, i) => a + i.size, 0);
  const t = performance.now();
  const disk = await onDisk(ws);
  bigRows.push([`outside tool: decrypt what is still hidden (${N.toLocaleString()} small items and the files under 100 MB)`, "", secs(performance.now() - t), rate(restBytes, performance.now() - t), "", ""]);
  const want = [...items.map((i) => i.hash), ...rest.flatMap((x) => x.files.map((f) => f.hash))];
  const lost = want.filter((h) => !disk.sealed.has(h));
  if (lost.length || disk.damaged.length) (failed = true), console.error(`FAILED: the outside tool: ${lost.length} lost, ${disk.damaged.length} damaged`);
  if (!args.includes("--keep")) for (const d of [ws, `${ws}-data`]) rmSync(d, { recursive: true, force: true });
}
if (bigRows.length) console.log(`\n| big files | size | time | speed | peak memory | disk beyond the files |\n| --- | --- | --- | --- | --- | --- |\n${bigRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`);

console.log(`\nseed ${SEED}\n\n| ${N.toLocaleString()} hidden items | time | CPU | peak memory |\n| --- | --- | --- | --- |\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`);
console.log(`\n| round | action | killed after | cut off | lost | damaged | unknown | readable and sealed | temporary files |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${crashes.map((r) => `| ${r.join(" | ")} |`).join("\n")}`);
console.log(`\n${crashes.filter((r) => r[3] === "yes").length} of ${crashes.length} kills cut an action off`);
console.log(failed ? "\n❌ items were lost or damaged (see above)" : "\n✅ nothing lost or damaged");
process.exit(failed ? 1 : 0);
