// Renders comp.html frame by frame (450 frames, 30 fps) and encodes the video with ffmpeg.
// Run from the repo root: node scripts/showcase/motion/render.mjs <footageDir> <framesDir> <out.mp4> [from] [to]
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [foot, frames, out, from = "0", to = "449"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
p.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
await p.goto(`${pathToFileURL(resolve("scripts/showcase/motion/comp.html")).href}?foot=${encodeURIComponent(pathToFileURL(resolve(foot)).href)}`);
for (let f = Number(from); f <= Number(to); f++) {
  await p.evaluate((f) => window.render(f), f);
  await p.locator("#c").screenshot({ path: `${frames}/m${String(f).padStart(4, "0")}.png` });
}
await b.close();
if (out) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", `${frames}/m%04d.png`, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "inherit" });
  console.log("wrote", out);
}
