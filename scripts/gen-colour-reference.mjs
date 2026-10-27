// Writes tests/unit/colour-reference.json: what Bjorn Ottosson's own JavaScript (https://bottosson.github.io/posts/colorpicker/, the files in
// https://github.com/bottosson/bottosson.github.io/tree/master/misc/colorpicker, MIT) answers for a fixed set of colours, so that
// tests/unit/colour-reference.test.ts can keep src/colour-picker/colour.ts following it without the reference being part of the repository.
// Run by hand when the reference changes (it fetches the file): node scripts/gen-colour-reference.mjs
import { writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://raw.githubusercontent.com/bottosson/bottosson.github.io/master/misc/colorpicker/colorconversion.js";
const code = await (await fetch(URL)).text();
const ref = { Math };
runInNewContext(code, ref);
let seed = 2026;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const r9 = (v) => Math.round(v * 1e9) / 1e9;
const cases = { toRgb: [], fromRgb: [] };
for (const [model, to, from] of [["okhsl", "okhsl_to_srgb", "srgb_to_okhsl"], ["okhsv", "okhsv_to_srgb", "srgb_to_okhsv"]]) {
  for (let i = 0; i < 150; i++) {
    const h = r9(rnd()), s = r9(rnd()), x = r9(rnd()); // (hue in turns, as the reference takes it)
    cases.toRgb.push({ model, h, s, x, rgb: ref[to](h, s, x).map((v) => Math.max(0, Math.min(255, Math.round(v)))) });
  }
  for (let i = 0; i < 150; i++) {
    const rgb = [0, 0, 0].map(() => Math.floor(rnd() * 256));
    const [h, s, x] = ref[from](...rgb);
    cases.fromRgb.push({ model, rgb, h: r9(h), s: r9(s), x: r9(x) });
  }
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../tests/unit/colour-reference.json");
writeFileSync(out, JSON.stringify({ source: URL, made: new Date().toISOString().slice(0, 10), note: "hue in turns (0 to 1); s and x may exceed 1 slightly in the reference for some saturated blues", cases }, null, 0) + "\n");
console.log("wrote", out, cases.toRgb.length, "+", cases.fromRgb.length, "cases");
