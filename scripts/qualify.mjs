// The qualification matrix (Phase 8): one command that runs the checks and the E2E suite in every browser configuration, from a snapshot of
// its own, and writes what it found as a table that can be compared with another run: docs/testing/qualification-<date>-<commit>.md.
//   npm run qualify                          quick suite, the four projects of playwright.config.ts
//   npm run qualify -- --suite full          the full stress loops
//   npm run qualify -- --projects chromium,firefox
// A project whose browser is not installed is listed as "not run", not as passed.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const suite = opt("suite", "quick");
const projects = opt("projects", "chromium,chromium-cpu,chromium-dpr2,firefox").split(",");

const sh = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
const commit = sh("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
const dirty = sh("git", ["status", "--porcelain"]).stdout.trim() !== "";
const version = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;

// What each browser is, as the browser says it.
const pw = await import("@playwright/test");
const browserVersion = async (name) => {
  const type = { chromium: pw.chromium, "chromium-cpu": pw.chromium, "chromium-dpr2": pw.chromium, firefox: pw.firefox }[name];
  try {
    const b = await type.launch();
    const v = b.version();
    await b.close();
    return v;
  } catch {
    return null;
  }
};
const versions = Object.fromEntries(await Promise.all(projects.map(async (p) => [p, await browserVersion(p)])));
const runnable = projects.filter((p) => versions[p]);

// The checks that need no browser (offline and names run on the snapshot below, in test-snap.mjs).
const checks = [];
for (const [name, cmd] of [["typecheck", "typecheck"], ["unit", "test:unit"], ["tokens", "check:tokens"], ["picker", "check:picker"]]) {
  const t0 = Date.now();
  const r = sh("npm", ["run", cmd]);
  checks.push({ name, ok: r.status === 0, seconds: Math.round((Date.now() - t0) / 1000) });
}

// The E2E suite, from a snapshot (dist/ stays free).
const e2e = await new Promise((done) => {
  const args = ["scripts/test-snap.mjs", ...(suite === "full" ? ["-c", "playwright.full.config.ts"] : []), ...runnable.map((p) => `--project=${p}`)];
  let out = "";
  const child = spawn("node", args, { cwd: root, env: process.env });
  child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
  child.stderr.on("data", (d) => process.stderr.write(d));
  child.on("exit", () => done(out));
});
const dir = /snapshot (test-builds\/\S+)/.exec(e2e)?.[1];
const rows = Object.fromEntries(projects.map((p) => [p, { passed: 0, failed: 0, skipped: 0, flaky: 0, ms: 0, failures: [] }]));
if (dir) {
  const report = JSON.parse(await readFile(resolve(root, dir, "report.json"), "utf8"));
  const walk = (suites, file) => {
    for (const s of suites ?? []) {
      for (const spec of s.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const row = rows[t.projectName];
          if (!row) continue;
          const last = t.results?.[t.results.length - 1];
          row.ms += t.results?.reduce((a, r) => a + r.duration, 0) ?? 0;
          if (t.status === "skipped") row.skipped++;
          else if (t.status === "flaky") row.flaky++;
          else if (t.status === "expected") row.passed++;
          else {
            row.failed++;
            row.failures.push(`${spec.file}:${spec.line} ${spec.title}${last?.error?.message ? ` (${last.error.message.split("\n")[0].slice(0, 100)})` : ""}`);
          }
        }
      }
      walk(s.suites, file);
    }
  };
  walk(report.suites);
}

const mins = (ms) => `${(ms / 60000).toFixed(1)} min`;
const lines = [
  `# Qualification ${new Date().toISOString().slice(0, 10)}, v${version} at ${commit}${dirty ? " (uncommitted changes)" : ""}`,
  "",
  `Suite: **${suite}**. Made by \`npm run qualify\` from the snapshot \`${dir ?? "none"}\`.`,
  "",
  "## Machine",
  "",
  `${platform()} ${release()}; ${cpus().length} × ${cpus()[0]?.model ?? "cpu"}; ${(totalmem() / 2 ** 30).toFixed(1)} GB; node ${process.version}; Playwright ${pw.test ? JSON.parse(await readFile(resolve(root, "node_modules/@playwright/test/package.json"), "utf8")).version : "?"}.`,
  "",
  "## Checks",
  "",
  "| Check | Result | Seconds |",
  "| --- | --- | --- |",
  ...checks.map((c) => `| ${c.name} | ${c.ok ? "✅ pass" : "❌ fail"} | ${c.seconds} |`),
  "",
  "## E2E matrix",
  "",
  "| Project | Browser | Passed | Failed | Flaky | Skipped | Time |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...projects.map((p) => (versions[p] ? `| ${p} | ${versions[p]} | ${rows[p].passed} | ${rows[p].failed} | ${rows[p].flaky} | ${rows[p].skipped} | ${mins(rows[p].ms)} |` : `| ${p} | not installed | not run | | | | |`)),
  "",
  ...projects.flatMap((p) => (rows[p].failures.length ? [`### Failures in ${p}`, "", ...rows[p].failures.map((f) => `- ${f}`), ""] : [])),
];
const file = resolve(root, "docs/testing", `qualification-${new Date().toISOString().slice(0, 10)}-${commit}.md`);
await mkdir(dirname(file), { recursive: true });
await writeFile(file, lines.join("\n"));
console.log(`\nwritten: ${file.slice(root.length + 1)}`);
process.exit(checks.every((c) => c.ok) && projects.every((p) => !versions[p] || rows[p].failed === 0) ? 0 : 1);
