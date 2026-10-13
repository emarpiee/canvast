// SPIKE gate (docs/plans/nested-frames.md §2, A1–A3) on dist-spike/frames.html.
//   node scripts/spike-measure.mjs [chromium|firefox ...]
import { chromium, firefox } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const URL = pathToFileURL(resolve("dist-spike/frames.html")).href;
const DEPTHS = [10, 1e3, 1e6, 1e9, 1e12];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["chromium", "firefox"];

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.__spike !== "undefined");
  await page.evaluate(() => window.__spike.render());
  return page;
}

for (const name of names) {
  const browser = await (name === "firefox" ? firefox : chromium).launch();
  console.log(`\n## ${name}`);
  console.log("depth | jump ms (A2) | pan+zoom frame p50/p95/max ms (A1) | zoom-in p50/p95/max (crossings) | zoom drift px (A3) | pan error px (A3) | stroke drawn | frames");
  for (const depth of DEPTHS) {
    const page = await open(browser);
    const r = await page.evaluate((depth) => {
      const s = window.__spike;
      s.pan(123.37, -56.71); // an ordinary, non-origin spot
      s.stroke([[300, 300], [500, 340], [700, 300]]); // home content
      const jumpMs = s.jump(depth);
      for (let i = 0; i < 3; i++) s.stroke([[400 + i * 30, 380], [600 + i * 30, 420], [800 + i * 30, 380]]);
      const n = 3; // index of the last deep stroke
      // A3 zoom: zoom in about a stroke vertex for 100 levels (3 frame crossings); it must stay put.
      s.render();
      const p0 = s.strokePoint(n, 1);
      let drift = 0;
      for (let i = 0; i < 200; i++) {
        s.zoomAt(p0.x, p0.y, 0.5);
        s.render();
        const p = s.strokePoint(n, 1);
        drift = Math.max(drift, p ? Math.hypot(p.x - p0.x, p.y - p0.y) : Infinity);
      }
      for (let i = 0; i < 200; i++) s.zoomAt(p0.x, p0.y, -0.5);
      s.render();
      // A3 pan: 37 px steps across sideways rebases move content by exactly 37 px.
      let panErr = 0;
      for (let i = 0; i < 100; i++) {
        const a = s.strokePoint(n, 1);
        s.pan(37, 0);
        s.render();
        const b = s.strokePoint(n, 1);
        if (a && b) panErr = Math.max(panErr, Math.abs(b.x - a.x - 37), Math.abs(b.y - a.y));
      }
      for (let i = 0; i < 100; i++) s.pan(-37, 0);
      s.render();
      const q = s.strokePoint(n, 1);
      const px = q ? s.pixelAt(q.x, q.y) : [255, 255, 255];
      const drawn = px[0] < 100 && px[1] < 100 && px[2] < 100;
      const b = s.bench(240);
      const zin = s.bench(400, "zoomin");
      return { jumpMs, b, zin, drift, panErr, drawn, frames: s.frames(), depth: s.depth() };
    }, depth);
    const f = (x) => (Math.round(x * 100) / 100).toString();
    console.log(`2^${depth} (${r.depth.split("+")[0]}) | ${f(r.jumpMs)} | ${f(r.b.p50)}/${f(r.b.p95)}/${f(r.b.max)} | ${f(r.zin.p50)}/${f(r.zin.p95)}/${f(r.zin.max)} (${r.zin.rebuilds}) | ${r.drift.toExponential(1)} | ${r.panErr.toExponential(1)} | ${r.drawn} | ${r.frames}`);
    await page.close();
  }
  // Risk: a stroke drawn at home seen from Δ levels below, the view inside its body.
  console.log("\nhome stroke seen from Δ below (view inside it) | frame p50/p95 ms | centre pixel is ink");
  for (const delta of (process.env.DELTAS ?? "100,1000,10000,100000").split(",").map(Number)) {
    const page = await open(browser);
    const r = await page.evaluate((delta) => {
      const s = window.__spike;
      s.pan(13.37, 5.71);
      s.stroke([[340, 400], [940, 400]]); // through the centre (640, 400)
      s.jump(delta);
      const b = s.bench(1); // warm
      const t = s.bench(40);
      s.render();
      const px = s.pixelAt(640, 400);
      return { t, ink: px[0] < 100 };
    }, delta).catch((e) => ({ error: String(e).slice(0, 80) }));
    console.log(`Δ ${delta} | ${r.error ?? `${r.t.p50.toFixed(1)}/${r.t.p95.toFixed(1)} | ${r.ink}`}`);
    await page.close();
  }
  // Random clicks, pans, zooms, strokes and Home (including zooming out): no step may take longer than 250 ms.
  console.log("\nfuzz seed | steps | worst step ms | frames | ok");
  for (const seed of [7, 11, 13]) {
    const page = await open(browser);
    const r = await Promise.race([page.evaluate((seed) => {
      const JUMPS = [-1e12, -1e9, -1e6, -1000, -32, 32, 1000, 1e6, 1e9, 1e12].map(String);
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const s = window.__spike;
      const btn = (t) => [...document.querySelectorAll("#jumps button")].find((b) => b.dataset.jump === t || b.textContent === t);
      s.stroke([[300, 300], [500, 340], [700, 300]]);
      let worst = 0;
      for (let i = 0; i < 2500; i++) {
        const k = rnd();
        const t = performance.now();
        if (k < 0.15) btn(JUMPS[Math.floor(rnd() * JUMPS.length)]).click();
        else if (k < 0.17) btn("Home").click();
        else if (k < 0.6) s.pan((rnd() - 0.5) * 2000, (rnd() - 0.5) * 2000);
        else if (k < 0.97) s.zoomAt(rnd() * 1280, rnd() * 800, (rnd() - 0.5) * 4);
        else s.stroke([[rnd() * 1280, rnd() * 800], [rnd() * 1280, rnd() * 800]]);
        s.render();
        worst = Math.max(worst, performance.now() - t);
        if (worst > 250) return { steps: i + 1, worst, frames: s.frames() };
      }
      return { steps: 2500, worst, frames: s.frames() };
    }, seed), new Promise((res) => setTimeout(() => res({ steps: "hung", worst: Infinity, frames: "?" }), 120000))]);
    console.log(`${seed} | ${r.steps} | ${r.worst.toFixed(1)} | ${r.frames} | ${r.worst <= 250}`);
    await page.close().catch(() => {});
  }
  await browser.close();
}
