// Checks a PhotoCraft release against canvast's helpers before it reaches the app (nothing is built: its released zip and its source,
// read as text). Run by hand or by the PhotoCraft release workflow:
//   node scripts/artcraft/photocraft/check.mjs                 the release in release.json
//   node scripts/artcraft/photocraft/check.mjs --latest        the newest release
//   node scripts/artcraft/photocraft/check.mjs --latest --write   and, when every check passes, release.json moves to it
// What it checks: the zip's SHA-256 against the release's SHA256SUMS.txt; that the packager still reads it (page ids, code shape, parts);
// that its web shell still does what the frame stands in for (preferences key, file picker card, downloads, drops, fonts manifest, the
// unsaved-work event); that every menu id and tool name in src/artcraft/photocraft/features.ts still exists, and that each `false` one
// can be hidden. It lists the menu items and tools new since the release in release.json, to decide on.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { RELEASE_FILE, download, payloadOf, releaseInfo, unzip, webFiles } from "./package.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const REPO = "storytold/photocraft";
const args = process.argv.slice(2);
const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

const headers = process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}` } : {};
async function latestVersion() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", ...headers } });
  if (!r.ok) throw new Error(`GitHub said ${r.status} for the latest release`);
  return String((await r.json()).tag_name).replace(/^v/, "");
}

/** The files of a .tar.gz whose path matches `want`, by path without its top folder. */
function untar(gz, want) {
  const buf = gunzipSync(gz);
  const out = new Map();
  let longName = null;
  for (let p = 0; p + 512 <= buf.length; ) {
    const h = buf.subarray(p, p + 512);
    if (h.every((b) => b === 0)) break;
    let name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = h.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    const type = String.fromCharCode(h[156]);
    const body = buf.subarray(p + 512, p + 512 + size);
    if (type === "L") longName = body.toString("utf8").replace(/\0.*$/s, "");
    else {
      if (longName) { name = longName; longName = null; }
      const path = name.slice(name.indexOf("/") + 1);
      if ((type === "0" || type === "\0") && want(path)) out.set(path, body.toString("utf8"));
    }
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const source = async (version) => untar(await download(`https://codeload.github.com/${REPO}/tar.gz/refs/tags/v${version}`), (p) => /^(crates\/(ui-egui|engine)\/src\/.*\.rs|apps\/photocraft-web\/src\/.*\.rs)$/.test(p) && !/_tests?\.rs$|\/tests?\//.test(p));

/** Every menu or command id the source names (quoted dotted ids), and the toolbar's tool names. */
function idsOf(src) {
  const menus = new Set();
  for (const [path, text] of src) if (path.startsWith("crates/")) for (const m of text.matchAll(/"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"/g)) menus.add(m[1]);
  const catalog = new Set([...(src.get("crates/ui-egui/src/menu_catalog.rs") ?? "").matchAll(/"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"\)/g)].map((m) => m[1]));
  const toolbar = /TOOL_SECTIONS[^=]*=([\s\S]*?)\n\];/.exec(src.get("crates/ui-egui/src/panels/toolbar.rs") ?? "")?.[1] ?? "";
  const tools = new Set([...toolbar.matchAll(/Tool::(\w+)/g)].map((m) => m[1]));
  const hideable = /fn hideable\(id: &str\) -> bool \{([\s\S]*?)\n    \}/.exec(src.get("crates/engine/src/prefs.rs") ?? "")?.[1] ?? "";
  return { menus, catalog, tools, hideable };
}

/** The ids and names the switches list, with their value (read as text: the file is TypeScript). */
async function switches() {
  const text = await readFile(resolve(root, "src/artcraft/photocraft/features.ts"), "utf8");
  const block = (name) => [...text.matchAll(/^  (\w+): \{([\s\S]*?)\n  \}/gm)].find((m) => m[1] === name)?.[2] ?? "";
  const pairs = (b) => [...b.matchAll(/^\s*"?([\w.]+)"?: (true|false),/gm)].map((m) => [m[1], m[2] === "true"]);
  return { menus: pairs(block("menus")), tools: pairs(block("tools")) };
}

const info = await releaseInfo(root);
const version = args.includes("--latest") ? await latestVersion() : info.version;
console.log(`PhotoCraft ${version} (canvast has ${info.version})`);

// 1. the zip, checked against the release's own sums
const zipUrl = `https://github.com/${REPO}/releases/download/v${version}/photocraft-web-${version}.zip`;
const zip = await download(zipUrl);
const sha = createHash("sha256").update(zip).digest("hex");
const sums = (await download(`https://github.com/${REPO}/releases/download/v${version}/SHA256SUMS.txt`)).toString("utf8");
const listed = sums.split("\n").find((l) => l.trim().endsWith(`photocraft-web-${version}.zip`))?.split(/\s+/)[0];
if (listed !== sha) fail(`the zip's SHA-256 ${sha} is not the one SHA256SUMS.txt lists (${listed ?? "none"})`);

// 2. the packager still reads it
try {
  const p = payloadOf(webFiles(unzip(zip)), version);
  notes.push(`web build: ${(Buffer.from(p.wasm, "base64").length / 1048576).toFixed(1)} MiB of gzip WebAssembly`);
} catch (e) {
  fail(`the packager: ${e.message}`);
}

// 3. its web shell still does what the frame stands in for
const src = await source(version);
const web = [...src].filter(([p]) => p.startsWith("apps/photocraft-web/")).map(([, t]) => t).join("\n");
for (const [what, re] of [
  ["its preferences under \"photocraft.preferences\" in localStorage", /PREFS_KEY: &str = "photocraft\.preferences"/],
  ["its file picker through rfd (the card the frame answers)", /rfd::AsyncFileDialog/],
  ["Save and Export as downloads of a blob", /fn download\(path: &str, bytes: &\[u8\]\)[\s\S]*?create_object_url_with_blob[\s\S]*?set_download/],
  ["dropped files open (or are placed)", /dropped_files/],
  ["fonts from fonts/manifest.txt", /manifest\.txt/],
  ["the unsaved-work check on beforeunload", /"beforeunload"/],
]) if (!re.test(web)) fail(`its web shell no longer shows: ${what}`);
const prefs = src.get("crates/engine/src/prefs.rs") ?? "";
for (const field of ["pub menus: MenuCustomization", "pub toolbar: ToolbarCustomization", "pub recent_files: Vec<String>"]) if (!prefs.includes(field)) fail(`its preferences no longer have ${field}`);

// 4. the switches
const now = idsOf(src);
const sw = await switches();
for (const [id, on] of sw.menus) {
  if (!now.menus.has(id)) fail(`features.ts: menu id ${id} is not in PhotoCraft ${version}`);
  else if (!on && (now.hideable.includes(`"${id}"`) || (now.hideable.includes('starts_with("edit.preferences")') && id.startsWith("edit.preferences")))) fail(`features.ts: ${id} cannot be hidden in PhotoCraft (Edit > Menus keeps it)`);
}
if (!sw.menus.length) fail("features.ts: no menu switches read (has its shape changed?)");
notes.push(`switches: ${sw.menus.length} menu ids and ${sw.tools.length} tools checked against ${now.menus.size} ids and ${now.tools.size} tools`);
for (const [name] of sw.tools) if (!now.tools.has(name)) fail(`features.ts: tool ${name} is not on PhotoCraft ${version}'s toolbar`);

// 4b. the kinds it opens (features.ts PHOTOCRAFT_OPENS), against its web build's OPEN_EXTS (less preset and swatch files, not documents)
const NOT_DOCUMENTS = new Set(["gz", "abr", "grd", "asl", "aco", "act", "ase", "af"]);
const theirs = [...(/const OPEN_EXTS: &\[&str\] = &\[([\s\S]*?)\];/.exec(web)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((x) => !NOT_DOCUMENTS.has(x));
const ours = [...((await readFile(resolve(root, "src/artcraft/photocraft/features.ts"), "utf8")).match(/PHOTOCRAFT_OPENS[^=]*= \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
if (!theirs.length) fail("its web shell no longer lists OPEN_EXTS");
const lost = ours.filter((x) => !theirs.includes(x));
const gained = theirs.filter((x) => !ours.includes(x));
if (lost.length) fail(`features.ts PHOTOCRAFT_OPENS lists kinds it no longer opens: ${lost.join(", ")}`);
if (gained.length) notes.push(`it opens kinds PHOTOCRAFT_OPENS lacks (add them to offer Edit in PhotoCraft): ${gained.join(", ")}`);

// 5. what is new since the release canvast has
if (version !== info.version) {
  const before = idsOf(await source(info.version));
  const added = [...now.catalog].filter((id) => !before.catalog.has(id));
  const tools = [...now.tools].filter((t) => !before.tools.has(t));
  notes.push(added.length ? `new menu items (shown unless features.ts says false): ${added.join(", ")}` : "no new menu items");
  notes.push(tools.length ? `new tools: ${tools.join(", ")}` : "no new tools");
}

for (const n of notes) console.log(`  · ${n}`);
if (problems.length) {
  console.error(`FAIL PhotoCraft ${version}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`PASS PhotoCraft ${version}: the helpers read it`);
if (args.includes("--write") && version !== info.version) {
  await writeFile(resolve(root, RELEASE_FILE), `${JSON.stringify({ ...info, version, zip: zipUrl, sha256: sha }, null, 2)}\n`);
  console.log(`${RELEASE_FILE} now names ${version}: build, then run the photocraft tests on GitHub`);
}
