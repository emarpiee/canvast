// The Painting view's brush engine (ADR 0164): fetch its pinned source into .engine-src/ (once), apply engine/patches/,
// and build engine/ to WebAssembly.
//   node scripts/build-engine.mjs           -> engine/out/brush.wasm (the speed build the app inlines; scripts/build.mjs runs this)
//   node scripts/build-engine.mjs --spike   -> dist-spike/brush.wasm, brush-small.wasm, brush-simd.wasm (the P0 comparison)
// The source is PhotoCraft (MIT or Apache-2.0, see THIRD_PARTY_NOTICES.md), at one commit, checked after fetching. Never writes dist/.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { homedir } from "node:os";
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
// Our patches to it (engine/patches/*.patch, in order), each applied once: one that applies backwards is already in.
for (const f of readdirSync(resolve(root, "engine/patches")).filter((n) => n.endsWith(".patch")).sort()) {
  const patch = resolve(root, "engine/patches", f);
  try {
    execFileSync("git", ["-C", src, "apply", "--reverse", "--check", patch], { stdio: "ignore" });
  } catch {
    git("apply", patch);
  }
}

// (paths in the output are made the same wherever the repository and Cargo's home are, so the build is reproducible)
const remap = `--remap-path-prefix=${root}=/canvast --remap-path-prefix=${process.env.CARGO_HOME ?? resolve(homedir(), ".cargo")}=/cargo`;
const cargo = (profile, dir, flags) =>
  execFileSync("cargo", ["build", "--quiet", "--locked", "--profile", profile, "--target", "wasm32-unknown-unknown"], {
    cwd: resolve(root, "engine"), // (built from engine/, never from inside the fetched source)
    stdio: "inherit",
    env: { ...process.env, CARGO_TARGET_DIR: resolve(root, "engine", dir), RUSTFLAGS: `${remap} ${flags}`.trim() },
  });
const built = (profile, dir) => resolve(root, `engine/${dir}/wasm32-unknown-unknown/${profile}/canvast_brush.wasm`);
const report = (file) => {
  const bytes = readFileSync(file);
  console.log(`${file.slice(root.length + 1)}  ${(bytes.length / 1024).toFixed(1)} KiB  (gzip ${(gzipSync(bytes).length / 1024).toFixed(1)} KiB)`);
};

if (process.argv.includes("--spike")) {
  mkdirSync(resolve(root, "dist-spike"), { recursive: true });
  // [profile, file, target dir, extra flags]: the SIMD build has a target dir of its own (other flags rebuild everything)
  for (const [profile, name, dir, flags] of [["release", "brush.wasm", "target", ""], ["small", "brush-small.wasm", "target", ""], ["release", "brush-simd.wasm", "target-simd", "-C target-feature=+simd128"]]) {
    cargo(profile, dir, flags);
    copyFileSync(built(profile, dir), resolve(root, "dist-spike", name));
    report(resolve(root, "dist-spike", name));
  }
} else {
  cargo("release", "target", "");
  mkdirSync(resolve(root, "engine/out"), { recursive: true });
  copyFileSync(built("release", "target"), resolve(root, "engine/out/brush.wasm"));
  report(resolve(root, "engine/out/brush.wasm"));
}
