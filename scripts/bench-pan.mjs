// Panning a drawing with many long strokes, measured with real input (runs on GitHub: the `Bench pan` workflow). A scene of hatching
// (`hatch` in src/app/bench.ts) is panned by mouse drags with the Hand tool, at 60 moves a second and at 4 moves a frame (a fast mouse),
// while the page records each frame and Chrome records a CPU profile. Prints frames per second, frame times, the app's own draw times,
// tiles built, and where the time went (the functions with the most time of their own).
// Run from the repo root after `npm run build`: node scripts/bench-pan.mjs [strokes] [outDir]   (CANVAST_BUILD_DIR: the build, default dist)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const n = Number(process.argv[2] ?? 900);
const out = resolve(process.argv[3] ?? "bench-pan");
mkdirSync(out, { recursive: true });
const url = pathToFileURL(resolve(process.env.CANVAST_BUILD_DIR ?? "dist", "canvast.html")).href + "#debug";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url);
await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
const H = (fn, arg) => page.evaluate(fn, arg);
const loaded = await H((k) => window.__canvastDebug.benchLoad({ kind: "hatch", n: k }), n);
await H(() => window.__canvastDebug.setSetting("ui.info", "technical"));
await H(() => window.__canvastDebug.setTool("hand"));
await H(() => window.__canvastDebug.nextFrame());
await page.waitForTimeout(800);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });

/** One pan: the pointer dragged across and back for `seconds`, `perFrame` moves each ~16 ms. */
async function pan(label, perFrame, seconds = 4) {
  await H(() => {
    window.__panFrames = [];
    const tick = (t) => {
      window.__panFrames.push(t);
      if (window.__panFrames.length < 100000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__canvastDebug.resetFrameTimes();
  });
  const rendered0 = (await H(() => window.__canvastDebug.tileStats())).renderedTotal;
  await cdp.send("Profiler.start");
  await page.mouse.move(720, 450);
  await page.mouse.down();
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    const phase = Math.sin((i / steps) * Math.PI * 2);
    for (let k = 0; k < perFrame; k++) await page.mouse.move(720 + phase * 500 + k, 450 + Math.cos((i / steps) * Math.PI * 4) * 200);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const { profile } = await cdp.send("Profiler.stop");
  const frames = await H(() => window.__panFrames.slice());
  const draws = await H(() => window.__canvastDebug.frameTimes());
  const rendered = (await H(() => window.__canvastDebug.tileStats())).renderedTotal - rendered0;
  writeFileSync(resolve(out, `${label}.cpuprofile`), JSON.stringify(profile));
  // frame intervals
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
  // self time by function
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  const self = new Map();
  const dt = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
  for (const id of profile.samples) {
    const nd = byId.get(id);
    const f = nd.callFrame;
    const key = `${f.functionName || "(anonymous)"} ${f.url ? f.url.split("/").pop() : ""}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, ms]) => ({ fn: k, ms: Math.round(ms), share: `${((ms / total) * 100).toFixed(1)}%` }));
  const r = {
    label, moves_per_frame: perFrame, frames: frames.length, fps: Math.round((frames.length / seconds) * 10) / 10,
    frame_ms: { p50: Math.round(pct(gaps, 50)), p95: Math.round(pct(gaps, 95)), worst: Math.round(Math.max(0, ...gaps)) },
    draw_ms: { p50: Math.round(pct(draws, 50) * 10) / 10, p95: Math.round(pct(draws, 95) * 10) / 10, worst: Math.round(Math.max(0, ...draws)) },
    tiles_built: rendered, profile_ms: Math.round(total), top,
  };
  console.log(`\n== ${label}: ${r.fps} FPS, frame p50 ${r.frame_ms.p50} ms p95 ${r.frame_ms.p95} ms worst ${r.frame_ms.worst} ms; draw p50 ${r.draw_ms.p50} p95 ${r.draw_ms.p95} worst ${r.draw_ms.worst} ms; tiles built ${rendered}`);
  for (const x of top) console.log(`  ${x.share.padStart(6)}  ${String(x.ms).padStart(5)} ms  ${x.fn}`);
  return r;
}

const results = { strokes: loaded.objects, generateMs: loaded.generateMs, runs: [await pan("pan-60hz", 1), await pan("pan-fast-mouse", 4)] };
writeFileSync(resolve(out, "results.json"), JSON.stringify(results, null, 2));
await browser.close();
