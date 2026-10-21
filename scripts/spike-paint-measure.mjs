// SPIKE measurements (P0 of the Painting view) on dist-spike/paint.html, in Chromium and Firefox.
//   node scripts/build-engine.mjs && node scripts/build-spike-paint.mjs && node scripts/spike-paint-measure.mjs [chromium|firefox ...]
import { chromium, firefox } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const URL = pathToFileURL(resolve("dist-spike/paint.html")).href;
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["chromium", "firefox"];
const all = {};
for (const name of names) {
  const browser = await (name === "firefox" ? firefox : chromium).launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL);
  await page.waitForFunction(() => document.body.dataset.ready === "1");
  const run = (fn, ...a) => page.evaluate(([f, args]) => window.__spikePaint[f](...args), [fn, a]);
  const r = { browser: browser.version() };
  r.check = await run("check");
  r.load = await run("load");
  r.throughput = await run("throughput", "release");
  r.throughputSmall = await run("throughput", "small");
  r.throughputSimd = await run("throughput", "simd");
  r.latencyMain = [await run("latencyMain", 50), await run("latencyMain", 500)];
  r.latencyMainSimd = [await run("latencyMain", 50, 240, "simd"), await run("latencyMain", 500, 240, "simd")];
  r.latencyWorker = [await run("latencyWorker", 50), await run("latencyWorker", 500)];
  r.memory = await run("memory");
  r.display = await run("display");
  r.abr = await run("abr");
  r.errors = errors;
  all[name] = r;
  console.log(`\n## ${name} ${r.browser}\n${JSON.stringify(r)}`);
  await browser.close();
}
if (process.env.SPIKE_OUT) (await import("node:fs")).writeFileSync(process.env.SPIKE_OUT, JSON.stringify(all, null, 1));
