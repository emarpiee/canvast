// SPIKE build (docs/plans/nested-frames.md): dist-spike/frames.html. Never writes dist/.
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const r = await build({ entryPoints: [resolve(root, "src/spike/main.ts")], bundle: true, format: "iife", target: ["es2020"], write: false, logLevel: "warning" });
const script = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<title>canvast spike: nested frames</title>
<style>html,body{margin:0;height:100%;overflow:hidden;font:13px system-ui,sans-serif}#canvas{display:block;width:100vw;height:100vh;touch-action:none}
#hud{position:fixed;left:8px;bottom:8px;padding:4px 8px;background:#fffd;border:1px solid #ccc;border-radius:6px;pointer-events:none}
#help{position:fixed;left:8px;top:8px;padding:4px 8px;background:#fffd;border:1px solid #ccc;border-radius:6px;pointer-events:none}</style>
</head><body><canvas id="canvas"></canvas><div id="hud"></div>
<div id="help">Spike: nested frames · wheel zoom · drag or arrows pan · P pen, H hand · +/− zoom · J jump by N levels</div>
<script>${script}</script></body></html>`;
const out = resolve(root, "dist-spike/frames.html");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`dist-spike/frames.html  ${(html.length / 1024).toFixed(1)} KiB`);
