// How fast the colour picker's maths is: node scripts/bench-picker.mjs   (npm run bench:picker)
// Compares painting a plane of colours pixel by pixel with toRgb against paintPlane (the picker's painter), per model.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = await mkdtemp(join(tmpdir(), "cp-bench-"));
const file = join(dir, "colour.mjs");
await build({ entryPoints: [resolve(root, "src/colour-picker/colour.ts")], bundle: true, format: "esm", outfile: file, logLevel: "warning" });
const { toRgb, fromRgb, paintPlane, MODELS } = await import(pathToFileURL(file).href);
const time = (fn, reps) => {
  fn();
  const t = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return (performance.now() - t) / reps;
};
const N = 96;
const out = new Uint8ClampedArray(N * N * 4);
console.log(`plane ${N} x ${N} (${N * N} pixels), ms per plane`);
console.log("model   toRgb per pixel   paintPlane   faster");
for (const m of MODELS) {
  const slow = time(() => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = toRgb(m, 200, x / (N - 1), 1 - y / (N - 1));
      const i = (y * N + x) * 4;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
  }, 10);
  const fast = time(() => paintPlane(m, 200, N, N, out), 50);
  console.log(`${m.padEnd(7)} ${slow.toFixed(2).padStart(14)}  ${fast.toFixed(2).padStart(10)}  ${(slow / fast).toFixed(1)}x`);
}
const one = time(() => { for (let i = 0; i < 1000; i++) toRgb("okhsv", i % 360, 0.7, 0.8); }, 20) / 1000;
const back = time(() => { for (let i = 0; i < 1000; i++) fromRgb("okhsl", i % 256, 90, 200); }, 20) / 1000;
console.log(`one toRgb ${(one * 1000).toFixed(2)} us, one fromRgb ${(back * 1000).toFixed(2)} us`);
await rm(dir, { recursive: true, force: true });
