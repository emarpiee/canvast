// Publishes the built single file as the latest GitHub release (ADR 0175). Run after the version is bumped, CHANGELOG.md has its section and everything is pushed:
//   npm run release              build, check, tag vX.Y.Z, upload dist/canvast.html, mark it Latest, verify
//   npm run release -- --dry-run do everything but publish, and print the notes
//   npm run release -- --force   publish even if a newer version is already the latest (the new one then becomes Latest)
// It never pushes, and never marks an older version Latest on its own.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { changelogSection, olderThan, releaseNotes } from "./lib/release-notes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry-run"), force = process.argv.includes("--force");
const run = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }) ?? "").trim();
const say = (m) => console.log(m);
const stop = (m) => { console.error(`release: ${m}`); process.exit(1); };
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version, tag = `v${version}`;
const repo = run("git", ["remote", "get-url", "origin"]).replace(/^.*[:/]([^/:]+\/[^/]+?)(?:\.git)?$/, "$1");

// 1. What is released is what is pushed, on main, with nothing else changed
if (run("git", ["branch", "--show-current"]) !== "main") stop("not on main.");
if (run("git", ["status", "--porcelain"])) stop("the working tree is not clean: commit or stash first.");
run("git", ["fetch", "origin", "main", "--quiet"]);
const head = run("git", ["rev-parse", "HEAD"]);
if (head !== run("git", ["rev-parse", "origin/main"])) stop("HEAD is not what origin/main has: push first (a release points at a pushed commit).");
const section = changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version);
if (!section) stop(`CHANGELOG.md has no section "## ${version} — Title (date)".`);

// 2. Build the file and check it
say(`Building canvast ${version} (${head.slice(0, 7)})…`);
for (const script of ["typecheck", "build", "check:offline", "check:names", "check:tokens"]) run("npm", ["run", script, "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
const file = join(root, "dist/canvast.html");
const built = JSON.parse(readFileSync(join(root, "dist/build.json"), "utf8"));
const sum = sha256(file);
if (built.version !== version || built.dirty || !head.startsWith(built.gitHead) || built.htmlSha256 !== sum) stop(`dist/ was not made from this commit and version (build.json: ${built.version} ${built.gitHead}${built.dirty ? " dirty" : ""}).`);
writeFileSync(join(root, "dist/canvast.html.sha256"), `${sum}  canvast.html\n`);
say(`dist/canvast.html  ${(statSync(file).size / 1048576).toFixed(2)} MB  sha256 ${sum}`);

// 3. The latest release now, and the one before this tag (for the changelog link)
const releases = JSON.parse(run("gh", ["release", "list", "--repo", repo, "--limit", "100", "--json", "tagName,isLatest"]) || "[]");
const latest = releases.find((r) => r.isLatest)?.tagName;
if (latest && olderThan(version, latest.slice(1)) && !force) stop(`${latest} is already the latest and is newer than ${tag}: use --force only if this is meant.`);
const previous = releases.map((r) => r.tagName).filter((t) => t !== tag && olderThan(t.slice(1), version)).sort((a, b) => (olderThan(a.slice(1), b.slice(1)) ? 1 : -1))[0] ?? null;
const notes = releaseNotes({ version, section, sha256: sum, size: statSync(file).size, previousTag: previous, repo });
const dir = mkdtempSync(join(tmpdir(), "canvast-release-"));
const notesFile = join(dir, "notes.md");
writeFileSync(notesFile, notes);
const title = `canvast ${version} — ${section.title}`;
if (dry) { say(`\n--dry-run: would publish ${tag} “${title}” as the latest release of ${repo}.\n\n${notes}`); rmSync(dir, { recursive: true }); process.exit(0); }

// 4. Create it (or, if the tag already has a release, replace its file and notes), always as the latest
const assets = [file, join(root, "dist/canvast.html.sha256")];
const exists = releases.some((r) => r.tagName === tag);
if (exists) {
  const at = run("git", ["rev-list", "-n", "1", tag]);
  if (at !== head) stop(`${tag} already points at ${at.slice(0, 7)}, not ${head.slice(0, 7)}: bump the version instead.`);
  run("gh", ["release", "upload", tag, ...assets, "--clobber", "--repo", repo]);
  run("gh", ["release", "edit", tag, "--title", title, "--notes-file", notesFile, "--latest", "--repo", repo]);
} else {
  run("gh", ["release", "create", tag, ...assets, "--repo", repo, "--target", head, "--title", title, "--notes-file", notesFile, "--latest"]);
}

// 5. Verify: it is the latest, and the file it serves is the one built here
const shown = JSON.parse(run("gh", ["release", "view", tag, "--repo", repo, "--json", "isLatest,url,assets,isDraft,isPrerelease"]));
if (!shown.isLatest || shown.isDraft || shown.isPrerelease) stop(`${tag} was created but is not the latest release (${shown.url}).`);
run("gh", ["release", "download", tag, "--repo", repo, "--pattern", "canvast.html", "--dir", dir, "--clobber"]);
const served = sha256(join(dir, "canvast.html"));
rmSync(dir, { recursive: true });
if (served !== sum) stop(`the file on the release (${served}) is not the one built here (${sum}).`);
say(`\n✅ ${tag} is the latest release and serves canvast.html (${sum.slice(0, 12)}…)\n   ${shown.url}\n   https://github.com/${repo}/releases/latest/download/canvast.html`);
