// Runs only the end-to-end groups a change needs (scripts/lib/test-groups.mjs), through test-snap (its own snapshot, never dist/).
//   npm run test:affected                     the groups for what changed since origin/main (commits not on it, and uncommitted edits)
//   npm run test:affected -- --since HEAD     the groups for uncommitted edits only (any git ref works)
//   npm run test:group -- storage library     the named groups (`all` for every group)
//   … -- --dry                                only say what would run, and about how long
//   … -- --check                              only check that every spec is in exactly one group
// Other arguments go to Playwright (e.g. --project=chromium). The estimate is from the newest recorded time of each spec in test-builds/.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, affected, checkGroups } from "./lib/test-groups.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const option = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};

const specsOnDisk = readdirSync(resolve(root, "tests/e2e")).filter((f) => f.endsWith(".spec.ts")).map((f) => f.slice(0, -".spec.ts".length));
const problems = checkGroups(specsOnDisk);
if (problems.length) {
  console.error(`FAIL test groups:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
if (flag("--check")) {
  console.log(`PASS test groups: ${specsOnDisk.length} specs, each in one of ${Object.keys(GROUPS).length} groups`);
  process.exit(0);
}
const dry = flag("--dry");
const named = flag("--groups");
let groups;
if (named) {
  // every argument up to the first Playwright option is a group name
  const names = [];
  while (argv.length && !argv[0].startsWith("-")) names.push(argv.shift());
  const unknown = names.filter((g) => g !== "all" && !GROUPS[g]);
  if (unknown.length || !names.length) {
    console.error(`unknown group ${unknown.join(", ") || "(none given)"}; groups: ${Object.keys(GROUPS).join(", ")}, all`);
    process.exit(1);
  }
  const chosen = names.includes("all") ? Object.keys(GROUPS) : names;
  groups = new Map(chosen.map((g) => [g, ["(named)"]]));
} else {
  const since = option("--since") ?? (() => {
    try {
      return git("merge-base", "HEAD", "origin/main");
    } catch {
      return "HEAD";
    }
  })();
  const changed = [...new Set([...git("diff", "--name-only", since).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean))];
  console.log(`${changed.length} files changed since ${since.length === 40 ? since.slice(0, 7) : since}`);
  groups = affected(changed, (path) => git("diff", since, "--", path));
}

// About how long: each test's last passed time (test-builds/times.json, kept by test-snap across snapshots).
const timesFile = resolve(root, "test-builds/times.json");
const times = new Map(Object.entries(existsSync(timesFile) ? JSON.parse(readFileSync(timesFile, "utf8")) : {}));
const specTime = (spec) => [...times].filter(([k]) => k.startsWith(`${spec}|`)).reduce((n, [, ms]) => n + ms, 0);
let total = 0;
let unknown = 0;
console.log("Groups to run:");
for (const [g, why] of groups) {
  const ms = GROUPS[g].reduce((n, s) => n + specTime(s), 0);
  unknown += GROUPS[g].filter((s) => !specTime(s)).length;
  total += ms;
  console.log(`  ${g.padEnd(11)} ${GROUPS[g].join(", ")}  ~${Math.round(ms / 60000)} min  (${why.slice(0, 3).join(", ")}${why.length > 3 ? `, +${why.length - 3}` : ""})`);
}
const skipped = Object.keys(GROUPS).filter((g) => !groups.has(g));
if (skipped.length) console.log(`Not needed: ${skipped.join(", ")}`);
const finish = new Date(Date.now() + total + 60_000);
console.log(`Estimate: ~${Math.round(total / 60000) + 1} min with the build, done about ${finish.toTimeString().slice(0, 5)}${unknown ? ` (${unknown} specs have no recorded time yet)` : ""}`);
if (dry) process.exit(0);
const specs = [...groups.keys()].flatMap((g) => GROUPS[g]).map((s) => `tests/e2e/${s}.spec.ts`);
const r = spawnSync("node", [resolve(root, "scripts/test-snap.mjs"), ...specs, ...argv], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
