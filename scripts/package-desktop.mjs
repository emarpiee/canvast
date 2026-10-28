// Packages the desktop app (ADR 0177) as a Linux AppImage: the shell of dist-desktop/ (built from dist/canvast.html first) with the
// pinned Electron of node_modules (the one the tests run), the brand icon, into dist-package/canvast-<version>-x86_64.AppImage and its .sha256.
//   node scripts/package-desktop.mjs        (npm run package:desktop; the release runs it)
// The app it makes needs no network; making it does (electron-builder fetches its AppImage tools once, into its cache).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      executableName: "canvast",
    },
  },
});
rmSync(icons, { recursive: true, force: true });
const file = join(out, name);
chmodSync(file, 0o755);

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
if (!existsSync(join(ws, ".canvast/workspace.json")) || !existsSync(join(ws, ".canvast/boards/board_1/canvas_1.cvst"))) refuse("the AppImage started but did not write its workspace folder");
rmSync(ws, { recursive: true, force: true });
rmSync(`${ws}-data`, { recursive: true, force: true });

// Only the AppImage and its checksum are kept: electron-builder's unpacked copy and debug files are not needed by anyone.
for (const name of readdirSync(out)) if (!name.endsWith(".AppImage")) rmSync(join(out, name), { recursive: true, force: true });
const sum = createHash("sha256").update(readFileSync(file)).digest("hex");
writeFileSync(`${file}.sha256`, `${sum}  ${name}\n`);
console.log(`dist-package/${name}  ${(readFileSync(file).length / 1048576).toFixed(1)} MB  sha256 ${sum}  (started and wrote a workspace folder)`);
