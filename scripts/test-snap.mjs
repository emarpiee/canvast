// Every test run goes through here (`npm test`, `test:e2e`, `test:full`, `bench`, `qualify`): Playwright runs against a build of its own, never `dist/`
// (the owner's build, in development), so `dist/` can be rebuilt and worked on while the tests run. The build is also checked here: offline and names.
//   npm run test:snap -- [playwright arguments]      e.g.  npm run test:snap -- --project=chromium tests/e2e/vectors.spec.ts
// A snapshot is test-builds/<time>-<source hash>/ : canvast.html + build.json (what it was made from) + run.json (the run and its result)
// + report.json + results/. `npm run test:status` compares every snapshot with the source and with `dist/`.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceHash } from "./lib/source-hash.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = 6;
const { srcHash } = await sourceHash(root);
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
const dir = resolve(root, "test-builds", `${stamp}-${srcHash.slice(0, 8)}`);
await mkdir(dir, { recursive: true });
const built = spawnSync("node", ["scripts/build.mjs", "--out", dir], { cwd: root, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);
// the colour picker's own demo page is part of what the tests open: a copy built from the same source goes in the snapshot (never a stale dist-picker/)
const pickerDir = resolve(dir, "picker");
const builtPicker = spawnSync("node", ["scripts/build-picker.mjs", "--out", pickerDir], { cwd: root, stdio: "inherit" });
if (builtPicker.status !== 0) process.exit(builtPicker.status ?? 1);
// the same for the pattern generators' demo page
const patternsDir = resolve(dir, "patterns");
const builtPatterns = spawnSync("node", ["scripts/build-patterns.mjs", "--out", patternsDir], { cwd: root, stdio: "inherit" });
if (builtPatterns.status !== 0) process.exit(builtPatterns.status ?? 1);

for (const script of ["check-offline", "check-names"]) {
  const checked = spawnSync("node", [`scripts/${script}.mjs`, resolve(dir, "canvast.html")], { cwd: root, stdio: "inherit" });
  if (checked.status !== 0) process.exit(checked.status ?? 1);
}

const args = process.argv.slice(2);
const run = { args, startedAt: new Date().toISOString(), status: "running" };
const save = () => writeFile(resolve(dir, "run.json"), JSON.stringify(run, null, 1));
await save();
console.log(`snapshot ${dir.slice(root.length + 1)}  (dist/ is free to rebuild)`);
const child = spawn("npx", ["playwright", "test", "--output", resolve(dir, "results"), "--reporter=line,json", ...args], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CANVAST_BUILD_DIR: dir, CANVAST_PICKER_DIR: pickerDir, CANVAST_PATTERNS_DIR: patternsDir, PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(dir, "report.json") },
});
child.on("exit", async (code) => {
  run.finishedAt = new Date().toISOString();
  run.status = code === 0 ? "passed" : "failed";
  try {
    const st = JSON.parse(await readFile(resolve(dir, "report.json"), "utf8")).stats;
    run.counts = { passed: st.expected, failed: st.unexpected, flaky: st.flaky, skipped: st.skipped };
  } catch { /* no report: the run was cut short */ }
  await save();
  // keep the newest few snapshots
  const all = (await readdir(resolve(root, "test-builds"))).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    // (never one that is still running: its tests are reading that build)
    const state = await readFile(resolve(root, "test-builds", old, "run.json"), "utf8").then((t) => JSON.parse(t).status, () => "none");
    if (state !== "running") await rm(resolve(root, "test-builds", old), { recursive: true, force: true });
  }
  console.log(`${run.status}  ${JSON.stringify(run.counts ?? {})}  ${dir.slice(root.length + 1)}`);
  process.exit(code ?? 1);
});
