// The brush engine (SPIKE, P0 of the Painting view): fetch its pinned source into .engine-src/ (once), build engine/ to
// WebAssembly and write dist-spike/brush.wasm (and brush-small.wasm, built for size). Never writes dist/.
//   node scripts/build-engine.mjs
// The source is PhotoCraft (MIT or Apache-2.0, see THIRD_PARTY_NOTICES.md), at one commit, checked after fetching.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/storytold/photocraft.git";
const COMMIT = "04d0212c7a1006b00f6ec9dd144affc98f8e7d83";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, ".engine-src");
const git = (...args) => execFileSync("git", ["-C", src, ...args], { encoding: "utf8" }).trim();

if (!existsSync(resolve(src, ".git"))) {
  mkdirSync(src, { recursive: true });
  git("init", "-q");
  git("remote", "add", "origin", REPO);
}
if (!existsSync(resolve(src, "Cargo.toml")) || git("rev-parse", "HEAD") !== COMMIT) {
  git("fetch", "-q", "--depth", "1", "origin", COMMIT);
  git("checkout", "-q", "--detach", COMMIT);
}
if (git("rev-parse", "HEAD") !== COMMIT) throw new Error(`engine source is not at ${COMMIT}`);

const out = resolve(root, "dist-spike");
mkdirSync(out, { recursive: true });
// [profile, file, output dir, extra flags]: the SIMD build has a target dir of its own (other flags rebuild everything)
for (const [profile, name, dir, flags] of [["release", "brush.wasm", "target", ""], ["small", "brush-small.wasm", "target", ""], ["release", "brush-simd.wasm", "target-simd", "-C target-feature=+simd128"]]) {
  // (built from engine/, never from inside the fetched source)
  execFileSync("cargo", ["build", "--quiet", "--locked", "--profile", profile, "--target", "wasm32-unknown-unknown"], { cwd: resolve(root, "engine"), stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: resolve(root, "engine", dir), RUSTFLAGS: flags } });
  copyFileSync(resolve(root, `engine/${dir}/wasm32-unknown-unknown/${profile}/canvast_brush.wasm`), resolve(out, name));
  const bytes = readFileSync(resolve(out, name));
  console.log(`dist-spike/${name}  ${(statSync(resolve(out, name)).size / 1024).toFixed(1)} KiB  (gzip ${(gzipSync(bytes).length / 1024).toFixed(1)} KiB)`);
}
