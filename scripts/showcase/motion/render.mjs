// Renders comp.html frame by frame (3600 frames, 60 fps) into H.264, makes its soundtrack (audio.mjs, from the comp's cues) and joins them.
// Needs the footage first:   CANVAST_BUILD_DIR=dist npx playwright test -c scripts/showcase/motion/footage.config.ts
// Run from the repo root:    node scripts/showcase/motion/render.mjs [out.mp4]   (default docs/media/canvast-60s.mp4)
//   stills to check:         node scripts/showcase/motion/render.mjs --stills <dir> 1.5,9,27
//   sound only (cues kept):  node scripts/showcase/motion/render.mjs --audio [out.mp4]
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = 60, DUR = 60;
const args = process.argv.slice(2);
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => { console.log("PAGEERROR", String(e)); process.exit(1); });
await p.goto(`${pathToFileURL(resolve(HERE, "comp.html")).href}?render`);
await p.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
if (args[0] === "--stills") {
  const [, dir, times] = args;
  mkdirSync(dir, { recursive: true });
  for (const t of times.split(",").map(Number)) { await p.evaluate((t) => window.seek(t), t); await p.screenshot({ path: `${dir}/${t}.png` }); }
  await b.close();
  process.exit(0);
}
const audioOnly = args[0] === "--audio";
const out = resolve(args[audioOnly ? 1 : 0] ?? "docs/media/canvast-60s.mp4");
const work = resolve(dirname(out), "build");
mkdirSync(work, { recursive: true });
const cues = [...(await p.evaluate(() => window.CUES)), ...(await p.evaluate(() => window.footCues()))].sort((a, b) => a.t - b.t);
writeFileSync(`${work}/cues.json`, JSON.stringify(cues));
const silent = `${work}/video.mp4`;
if (!audioOnly || !existsSync(silent)) {
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", silent], { stdio: ["pipe", "inherit", "inherit"] });
  for (let f = 0; f < FPS * DUR; f++) {
    await p.evaluate((t) => window.seek(t), f / FPS);
    if (!ff.stdin.write(await p.screenshot({ type: "jpeg", quality: 94 }))) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 600 === 0) console.log(`frame ${f}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
await b.close();
execFileSync("node", [resolve(HERE, "audio.mjs"), `${work}/cues.json`, `${work}/sound.wav`, String(DUR)], { stdio: "inherit" });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", `${work}/sound.wav`, "-c:v", "copy",
  "-af", "loudnorm=I=-15:TP=-1.2:LRA=9", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], { stdio: "inherit" });
console.log("wrote", out);
