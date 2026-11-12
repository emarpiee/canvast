// Panning a drawing with many long strokes, measured with real input (runs on GitHub: the `Bench pan` workflow). A scene of hatching
// (`hatch` in src/app/bench.ts) is panned by mouse drags with the Hand tool, at 60 moves a second and at 4 moves a frame (a fast mouse),
// while the page records each frame and Chrome records a CPU profile. Prints frames per second, frame times, the app's own draw times,
// tiles built, and where the time went, at a whole zoom level and at a fraction of one (the functions with the most time of their own).
// Run from the repo root after `npm run build`: node scripts/bench-pan.mjs [strokes | file.canvast] [outDir] [--check]   (CANVAST_BUILD_DIR:
// the build, default dist). --check: the pan and zoom standard (scripts/lib/pan-zoom-budget.mjs, on the showcase): fails when a run is over it.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PAN_ZOOM_BUDGET, overBudget } from "./lib/pan-zoom-budget.mjs";

const check = process.argv.includes("--check");
const args = process.argv.slice(2).filter((a) => a !== "--check");

// The scene: a number (that many generated hatching strokes), or a .canvast file (the showcase: its Powers of two canvas, at a bookmark).
const sceneArg = args[0] ?? "900";
const n = Number(sceneArg);
const BOOKMARK = process.env.BENCH_BOOKMARK ?? "1 · The Solar System";
const out = resolve(args[1] ?? "bench-pan");
mkdirSync(out, { recursive: true });
const url = pathToFileURL(resolve(process.env.CANVAST_BUILD_DIR ?? "dist", "canvast.html")).href + "#debug";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url);
await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
const H = (fn, arg) => page.evaluate(fn, arg);
let loaded;
if (Number.isFinite(n)) loaded = await H((k) => window.__canvastDebug.benchLoad({ kind: "hatch", n: k }), n);
else {
  // the showcase imported as a person would, its canvas opened at a bookmark
  await page.getByTestId("save-status").click();
  await page.getByTestId("set-import-input").setInputFiles(resolve(sceneArg));
  await page.getByTestId("choose-ok").click();
  await page.getByTestId("confirm-ok").click();
  await page.getByTestId("toast").filter({ hasText: /Imported/ }).waitFor({ timeout: 120_000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("workspace-nav").click();
  await page.getByTestId("workspace-menu").getByText("Powers of two", { exact: true }).click();
  if (await page.getByTestId("workspace-menu").isVisible()) await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await page.getByRole("button", { name: `Go to ${BOOKMARK}` }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
  await H(() => document.activeElement?.blur());
  loaded = { objects: (await H(() => window.__canvastDebug.objects())).length, generateMs: 0 };
  console.log(`showcase at "${BOOKMARK}": ${loaded.objects} objects in view's canvas`);
}
await H(() => window.__canvastDebug.setSetting("ui.info", "technical"));
await H(() => window.__canvastDebug.setTool("hand"));
await H(() => window.__canvastDebug.nextFrame());
await page.waitForTimeout(800);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });

/** One pan: the pointer dragged across and back for `seconds`, `perFrame` moves each ~16 ms. */
async function pan(label, perFrame, seconds = 4, fraction = 0, input = null) {
  await H(() => {
    // (one counter of frames at a time: the last run's stops)
    window.__panRun = (window.__panRun ?? 0) + 1;
    const run = window.__panRun;
    window.__panFrames = [];
    const tick = (t) => {
      if (window.__panRun !== run) return;
      window.__panFrames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__canvastDebug.resetFrameTimes();
  });
  const s0 = await H(() => window.__canvastDebug.tileStats());
  const rendered0 = s0.renderedTotal;
  await cdp.send("Profiler.start");
  await page.mouse.move(720, 450);
  const steps = Math.round(seconds * 60);
  if (input) await input(steps);
  else await page.mouse.down();
  for (let i = 0; !input && i < steps; i++) {
    const phase = Math.sin((i / steps) * Math.PI * 2);
    // (fraction: the pointer between whole pixels, as Wayland and scaled screens report it)
    for (let k = 0; k < perFrame; k++) await page.mouse.move(720 + phase * 500 + k + (fraction ? ((i * 7 + k) % 10) * fraction : 0), 450 + Math.cos((i / steps) * Math.PI * 4) * 200 + (fraction ? ((i * 3 + k) % 10) * fraction : 0));
    await page.waitForTimeout(16);
  }
  if (!input) await page.mouse.up();
  const { profile } = await cdp.send("Profiler.stop");
  const frames = await H(() => window.__panFrames.slice());
  const draws = await H(() => window.__canvastDebug.frameTimes());
  const s1 = await H(() => window.__canvastDebug.tileStats());
  const rendered = s1.renderedTotal - rendered0;
  const restarts = { offset: s1.restarts.offset - s0.restarts.offset, key: s1.restarts.key - s0.restarts.key, lastOffset: s1.restarts.lastOffset };
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
    tiles_built: rendered, restarts, profile_ms: Math.round(total), top,
  };
  console.log(`\n== ${label}: ${r.fps} FPS, frame p50 ${r.frame_ms.p50} ms p95 ${r.frame_ms.p95} ms worst ${r.frame_ms.worst} ms; draw p50 ${r.draw_ms.p50} p95 ${r.draw_ms.p95} worst ${r.draw_ms.worst} ms; tiles built ${rendered}; sets thrown away: ${restarts.offset} not whole px, ${restarts.key} zoom/frame; last offset ${JSON.stringify(restarts.lastOffset)}`);
  for (const [w, k] of Object.entries(s1.restarts.why)) if (k - (s0.restarts.why[w] ?? 0)) console.log(`  why: ${k - (s0.restarts.why[w] ?? 0)} × ${w}`);
  for (const x of top) console.log(`  ${x.share.padStart(6)}  ${String(x.ms).padStart(5)} ms  ${x.fn}`);
  return r;
}

// At a whole zoom level, then at a fraction of one (as after a wheel zoom: 2^-0.3), where a pan is not a whole number of device pixels.
const runs = [await pan("zoom-whole-60hz", 1), await pan("zoom-whole-fast-mouse", 4), await pan("zoom-whole-subpixel-pointer", 1, 4, 0.037)];
await H(() => window.__canvastDebug.jump(-0.3));
await H(() => window.__canvastDebug.nextFrame());
await page.waitForTimeout(800);
console.log(`\n(zoom now ${JSON.stringify(await H(() => window.__canvastDebug.camera()))})`);
runs.push(await pan("zoom-fraction-60hz", 1), await pan("zoom-fraction-fast-mouse", 4));
// Zooming with the wheel: in and out over two levels, a notch a frame (slow) and four a frame (a fast wheel or a touchpad).
const wheel = (perFrame) => async (steps) => {
  for (let i = 0; i < steps; i++) {
    const dir = Math.floor((i / steps) * 4) % 2 === 0 ? -1 : 1; // (in, out, in, out)
    for (let k = 0; k < perFrame; k++) await page.mouse.wheel(0, dir * 40);
    await page.waitForTimeout(16);
  }
};
runs.push(await pan("wheel-zoom-slow", 1, 4, 0, wheel(1)), await pan("wheel-zoom-fast", 4, 4, 0, wheel(4)));
const results = { strokes: loaded.objects, generateMs: loaded.generateMs, runs };
writeFileSync(resolve(out, "results.json"), JSON.stringify(results, null, 2));
await browser.close();
if (check) {
  const over = overBudget(runs);
  console.log(`\n== The pan and zoom standard (${Object.keys(PAN_ZOOM_BUDGET).length} runs): ${over.length ? "FAILED" : "passed"}`);
  for (const line of over) console.log(`  over: ${line}`);
  if (over.length) {
    console.log("A change made the canvas view slower to pan or zoom: fix it (the budget is never loosened; a time over it once is run again first).");
    process.exit(1);
  }
}
