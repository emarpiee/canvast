// Packages the desktop app (ADR 0177) as a Linux AppImage: the shell of dist-desktop/ (built from dist/canvast.html first) with the
// pinned Electron of node_modules (the one the tests run), the brand icon, into dist-package/canvast-<version>-x86_64.AppImage and its .sha256,
// with its update address written in and its .zsync beside it (an AppImage updater such as Gear Lever or AppImageUpdate reads the address,
// finds the latest release and downloads only the parts that changed; the app itself never checks).
//   node scripts/package-desktop.mjs        (npm run package:desktop; the release runs it)
// The app it makes needs no network; making it does (electron-builder fetches its AppImage tools once, into its cache).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { _electron as electron } from "@playwright/test";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, Platform } from "electron-builder";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const run = (script, args = []) => execFileSync("node", [join(root, script), ...args], { cwd: root, stdio: "inherit" });

if (!existsSync(join(root, "dist/canvast.html"))) run("scripts/build.mjs");
run("scripts/build-desktop.mjs");
const icons = mkdtempSync(join(tmpdir(), "canvast-icons-"));
run("scripts/brand/icons.mjs", [icons]);

// The .zsync is made by zsyncmake (the zsync package): checked first, so a long build never ends in a package without it.
try {
  execFileSync("zsyncmake", ["-V"], { stdio: "ignore" });
} catch {
  console.error("package-desktop: zsyncmake is missing; install the zsync package (dnf install zsync, apt install zsync or brew install zsync)");
  process.exit(1);
}
const repo = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).trim().replace(/^.*[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/, "$1|$2");
/** Where updaters look: the latest GitHub release of this repository, its AppImage's .zsync (the AppImage update information format). */
const UPDATE_INFO = `gh-releases-zsync|${repo}|latest|canvast-*-x86_64.AppImage.zsync`;

/** The offset and size of an ELF section of `path` (64-bit, little-endian: the AppImage runtime), or null when it has none. */
function elfSection(path, wanted) {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(64);
    readSync(fd, head, 0, 64, 0);
    if (head.readUInt32BE(0) !== 0x7f454c46 || head[4] !== 2 || head[5] !== 1) return null;
    const shoff = Number(head.readBigUInt64LE(0x28)), shentsize = head.readUInt16LE(0x3a), shnum = head.readUInt16LE(0x3c), shstrndx = head.readUInt16LE(0x3e);
    const table = Buffer.alloc(shentsize * shnum);
    readSync(fd, table, 0, table.length, shoff);
    const at = (i) => ({ name: table.readUInt32LE(i * shentsize), offset: Number(table.readBigUInt64LE(i * shentsize + 0x18)), size: Number(table.readBigUInt64LE(i * shentsize + 0x20)) });
    const strs = at(shstrndx);
    const names = Buffer.alloc(strs.size);
    readSync(fd, names, 0, strs.size, strs.offset);
    for (let i = 0; i < shnum; i++) {
      const s = at(i);
      if (names.toString("latin1", s.name, names.indexOf(0, s.name)) === wanted) return { offset: s.offset, size: s.size };
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

const out = join(root, "dist-package");
rmSync(out, { recursive: true, force: true });
const name = `canvast-${pkg.version}-x86_64.AppImage`;
await build({
  targets: Platform.LINUX.createTarget("AppImage"),
  projectDir: join(root, "dist-desktop"),
  publish: "never",
  config: {
    appId: "app.canvast.desktop",
    productName: "canvast",
    copyright: pkg.author ? `© ${pkg.author}` : undefined,
    electronVersion: pkg.devDependencies.electron,
    electronDist: join(root, "node_modules/electron/dist"), // (the tested binary, not another download)
    directories: { output: out, buildResources: icons },
    files: ["main.cjs", "preload.cjs", "canvast.html", "package.json"],
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    artifactName: name,
    linux: {
      target: [{ target: "AppImage", arch: ["x64"] }],
      category: "Graphics",
      icon: join(icons, "canvast-icon-512.png"),
      synopsis: "An endless canvas for drawing and references, offline",
      // (the line under the name in the system's app list)
      desktop: { entry: { Comment: "Endless canvas for drawing and references", GenericName: "Reference canvas", Keywords: "canvas;drawing;reference;moodboard;" } },
      executableName: "canvast",
    },
  },
});
rmSync(icons, { recursive: true, force: true });
const file = join(out, name);
chmodSync(file, 0o755);
// The update address goes in the runtime's .upd_info section (empty, 1 KiB, NUL-padded), before the checks and the checksums.
const upd = elfSection(file, ".upd_info");
if (!upd || Buffer.byteLength(UPDATE_INFO) >= upd.size) {
  rmSync(out, { recursive: true, force: true });
  console.error("package-desktop: the AppImage has no room for its update information; the package was deleted");
  process.exit(1);
}
{
  const fd = openSync(file, "r+");
  const bytes = Buffer.alloc(upd.size);
  bytes.write(UPDATE_INFO, "latin1");
  writeSync(fd, bytes, 0, bytes.length, upd.offset);
  closeSync(fd);
}

// The package starts: the AppImage itself (unpacked to run, so no FUSE is needed) opens a fresh workspace folder, with the
// bridge, from inside its archive, and writes the folder. A package that does not start is never handed out.
const ws = mkdtempSync(join(tmpdir(), "canvast-package-check-"));
/** A package that fails the check is deleted, so a broken AppImage is never left where it could be run or handed out. */
const refuse = (why) => {
  rmSync(out, { recursive: true, force: true });
  console.error(`package-desktop: ${why}; the package was deleted`);
  process.exit(1);
};
try {
  const app = await electron.launch({ executablePath: file, args: [`--workspace=${ws}`, `--user-data-dir=${ws}-data`], env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1", CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug" } });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined" && typeof window.canvastDesktop === "object", null, { timeout: 60_000 });
    await page.evaluate(() => window.__canvastDebug.flushStorage());
  } finally {
    await app.close();
  }
} catch (e) {
  refuse(`the AppImage did not start (${(e).message.split("\n")[0]})`);
}
// (the update address is read back as an updater reads it)
{
  const fd = openSync(file, "r");
  const bytes = Buffer.alloc(upd.size);
  readSync(fd, bytes, 0, bytes.length, upd.offset);
  closeSync(fd);
  if (bytes.toString("latin1").replace(/\0+$/, "") !== UPDATE_INFO) refuse("the AppImage's update information did not read back");
}
if (!existsSync(join(ws, ".canvast/workspace.json")) || !existsSync(join(ws, ".canvast/boards/board_1/canvas_1.cvst"))) refuse("the AppImage started but did not write its workspace folder");
rmSync(ws, { recursive: true, force: true });
rmSync(`${ws}-data`, { recursive: true, force: true });

// Only the AppImage, its checksum and its .zsync are kept: electron-builder's unpacked copy and debug files are not needed by anyone.
for (const name of readdirSync(out)) if (!name.endsWith(".AppImage")) rmSync(join(out, name), { recursive: true, force: true });
const sum = createHash("sha256").update(readFileSync(file)).digest("hex");
writeFileSync(`${file}.sha256`, `${sum}  ${name}\n`);
// The .zsync: the block checksums an updater compares with the copy it has; its URL is the AppImage's name, next to it on the release.
execFileSync("zsyncmake", ["-u", name, "-o", `${file}.zsync`, file], { cwd: out, stdio: "ignore" });
// (newer zsyncmake versions write only a SHA-256 File-Hash; the classic SHA-1 line, which the AppImage updaters check the finished file
// against, is added at the end of the header when it is missing)
{
  const z = readFileSync(`${file}.zsync`);
  const end = z.indexOf("\n\n");
  const header = z.toString("latin1", 0, end);
  if (!/^SHA-1: /m.test(header)) {
    const sha1 = createHash("sha1").update(readFileSync(file)).digest("hex");
    writeFileSync(`${file}.zsync`, Buffer.concat([Buffer.from(`${header}\nSHA-1: ${sha1}`, "latin1"), z.subarray(end)]));
  }
}
console.log(`dist-package/${name}  ${(readFileSync(file).length / 1048576).toFixed(1)} MB  sha256 ${sum}  (started and wrote a workspace folder; updates from ${UPDATE_INFO})`);
