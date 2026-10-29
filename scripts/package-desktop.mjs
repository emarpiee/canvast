// Packages the desktop app (ADR 0177) for Linux: the shell of dist-desktop/ (built from dist/canvast.html first) with the pinned
// Electron of node_modules (the one the tests run) and the brand icon, for this machine's architecture (x86_64, or aarch64 on an ARM
// machine), into dist-package/: canvast-<version>-<arch>.AppImage, .deb, .rpm and .tar.gz, each with its .sha256. The AppImage has its
// update address written in and its .zsync beside it (an AppImage updater such as Gear Lever or AppImageUpdate reads the address,
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
import { Arch, build, Platform } from "electron-builder";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const run = (script, args = []) => execFileSync("node", [join(root, script), ...args], { cwd: root, stdio: "inherit" });

if (!existsSync(join(root, "dist/canvast.html"))) run("scripts/build.mjs");
run("scripts/build-desktop.mjs");
const icons = mkdtempSync(join(tmpdir(), "canvast-icons-"));
run("scripts/brand/icons.mjs", [icons]);

/** This machine's architecture: electron-builder's name for it, and the one in the file names. */
const ARCH = { x64: { builder: Arch.x64, label: "x86_64" }, arm64: { builder: Arch.arm64, label: "aarch64" } }[process.arch];
if (!ARCH) {
  console.error(`package-desktop: no package is made for ${process.arch}; only x86_64 and aarch64`);
  process.exit(1);
}
/** The formats, each a file named canvast-<version>-<arch>.<ext>. */
const FORMATS = [
  { target: "AppImage", ext: "AppImage" },
  { target: "deb", ext: "deb" },
  { target: "rpm", ext: "rpm" },
  { target: "tar.gz", ext: "tar.gz" },
];
// The tools the formats need: checked first, so a long build never ends in a missing package.
for (const [tool, args, what] of [["zsyncmake", ["-V"], "the zsync package (dnf install zsync, apt install zsync or brew install zsync)"], ["rpmbuild", ["--version"], "rpm-build (dnf install rpm-build, or apt install rpm)"]]) {
  try {
    execFileSync(tool, args, { stdio: "ignore" });
  } catch {
    console.error(`package-desktop: ${tool} is missing; install ${what}`);
    process.exit(1);
  }
}
const repo = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).trim().replace(/^.*[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/, "$1|$2");
/** Where updaters look: the latest GitHub release of this repository, its AppImage's .zsync (the AppImage update information format). */
const UPDATE_INFO = `gh-releases-zsync|${repo}|latest|canvast-*-${ARCH.label}.AppImage.zsync`;

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
const base = `canvast-${pkg.version}-${ARCH.label}`;
const name = `${base}.AppImage`;
await build({
  targets: Platform.LINUX.createTarget(FORMATS.map((f) => f.target), ARCH.builder),
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
    // (the .deb and .rpm name the project's home and say what it is)
    extraMetadata: { homepage: `https://github.com/${repo.replace("|", "/")}`, description: "An offline-first endless canvas for drawing and references", license: pkg.license },
    npmRebuild: false,
    nodeGypRebuild: false,
    artifactName: `${base}.\${ext}`,
    linux: {
      maintainer: "emarpiee",
      vendor: "emarpiee",
      category: "Graphics",
      icon: join(icons, "canvast-icon-512.png"),
      synopsis: "An endless canvas for drawing and references, offline",
      // (the line under the name in the system's app list)
      desktop: { entry: { Comment: "Endless canvas for drawing and references", GenericName: "Reference canvas", Keywords: "canvas;drawing;reference;moodboard;" } },
      executableName: "canvast",
    },
    deb: { packageCategory: "graphics" },
    rpm: { packageCategory: "Graphics" },
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
/** A package that fails the check is deleted, so a broken AppImage is never left where it could be run or handed out. */
const refuse = (why) => {
  rmSync(out, { recursive: true, force: true });
  console.error(`package-desktop: ${why}; the package was deleted`);
  process.exit(1);
};
/** Start a package's app on a fresh workspace folder; it must write the folder (with the bridge, from inside its archive). */
async function starts(label, executablePath) {
  const dir = mkdtempSync(join(tmpdir(), "canvast-package-check-"));
  try {
    // (a CI machine's kernel may not allow Chromium's sandbox; there the check runs without it)
    const app = await electron.launch({ executablePath, args: [`--workspace=${dir}`, `--user-data-dir=${dir}-data`, ...(process.env.CI ? ["--no-sandbox"] : [])], env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1", CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug" } });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined" && typeof window.canvastDesktop === "object", null, { timeout: 60_000 });
      await page.evaluate(() => window.__canvastDebug.flushStorage());
    } finally {
      await app.close();
    }
  } catch (e) {
    refuse(`the ${label} did not start (${(e).message.split("\n")[0]})`);
  }
  if (!existsSync(join(dir, ".canvast/workspace.json")) || !existsSync(join(dir, ".canvast/boards/board_1/canvas_1.cvst"))) refuse(`the ${label} started but did not write its workspace folder`);
  rmSync(dir, { recursive: true, force: true });
  rmSync(`${dir}-data`, { recursive: true, force: true });
}
await starts("AppImage", file);
// The tarball: unpacked as a person would, its canvast started.
{
  const dir = mkdtempSync(join(tmpdir(), "canvast-package-tar-"));
  execFileSync("tar", ["-xzf", join(out, `${base}.tar.gz`), "-C", dir]);
  const top = readdirSync(dir);
  if (top.length !== 1 || !existsSync(join(dir, top[0], "canvast"))) refuse("the tarball does not unpack to one folder with canvast in it");
  await starts("tarball", join(dir, top[0], "canvast"));
  rmSync(dir, { recursive: true, force: true });
}
// The .deb and .rpm: their files and their menu entry are in place (installing them needs root, so that is done by hand).
{
  const listed = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
  const rpm = listed("rpm", ["-qlp", join(out, `${base}.rpm`)]);
  const debFile = join(out, `${base}.deb`);
  const member = listed("ar", ["t", debFile]).split("\n").find((m) => m.startsWith("data.tar"));
  const data = join(mkdtempSync(join(tmpdir(), "canvast-package-deb-")), member ?? "data.tar");
  writeFileSync(data, member ? execFileSync("ar", ["p", debFile, member], { maxBuffer: 1 << 30 }) : "");
  const deb = member ? listed("tar", ["-tf", data]).replace(/^\.\//gm, "/") : "";
  rmSync(dirname(data), { recursive: true, force: true });
  for (const [label, list] of [["rpm", rpm], ["deb", deb]]) {
    if (!/\/opt\/canvast\/canvast\n/.test(list) || !/\/usr\/share\/applications\/canvast\.desktop\n/.test(list)) refuse(`the .${label} lacks /opt/canvast/canvast or its menu entry`);
  }
}
// (the update address is read back as an updater reads it)
{
  const fd = openSync(file, "r");
  const bytes = Buffer.alloc(upd.size);
  readSync(fd, bytes, 0, bytes.length, upd.offset);
  closeSync(fd);
  if (bytes.toString("latin1").replace(/\0+$/, "") !== UPDATE_INFO) refuse("the AppImage's update information did not read back");
}

// Only the packages, their checksums and the .zsync are kept: electron-builder's unpacked copy and debug files are not needed by anyone.
const made = FORMATS.map((f) => `${base}.${f.ext}`);
for (const n of readdirSync(out)) if (!made.includes(n)) rmSync(join(out, n), { recursive: true, force: true });
for (const n of made) writeFileSync(join(out, `${n}.sha256`), `${createHash("sha256").update(readFileSync(join(out, n))).digest("hex")}  ${n}\n`);
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
for (const n of made) console.log(`dist-package/${n}  ${(readFileSync(join(out, n)).length / 1048576).toFixed(1)} MB  sha256 ${readFileSync(join(out, `${n}.sha256`), "utf8").slice(0, 64)}`);
console.log(`(the AppImage and the tarball started and wrote a workspace folder; the .deb and .rpm hold the app and its menu entry; the AppImage updates from ${UPDATE_INFO})`);
