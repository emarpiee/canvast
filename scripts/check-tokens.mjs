// Design-token check (ADR 0068): rules in src/styles.css must use the tokens defined in its :root block, not literal values.
//   node scripts/check-tokens.mjs            fails when a category has more literals than scripts/token-baseline.json
//   node scripts/check-tokens.mjs --update   rewrites the baseline (only ever lower it: fix literals, then update)
//   node scripts/check-tokens.mjs --list     prints every literal found
// Checked: colours (oklch, hex, rgb), text sizes (font-size and font), radii, spacing (padding, margin, gap) and, in the UI's
// TypeScript, inline style="" values. Custom-property definitions (--x: …) are where values live and are not checked.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = resolve(root, "scripts/token-baseline.json");
const css = (await readFile(resolve(root, "src/styles.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const found = { colour: [], text: [], radius: [], space: [], inline: [] };

const lineOf = (text, i) => text.slice(0, i).split("\n").length;
const decl = /(?<![\w-])([a-z-]+)\s*:\s*([^;{}]*)(?=;|})/g;
for (const m of css.matchAll(decl)) {
  const [, prop, value] = m;
  if (prop.startsWith("--")) continue;
  const at = lineOf(css, m.index);
  if (/oklch\((?!var\()|#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(value)) found.colour.push(`${at}: ${prop}: ${value.trim()}`);
  if ((prop === "font-size" || prop === "font") && /(?<![\w-])\d+(\.\d+)?px/.test(value.replace(/var\([^)]*\)/g, ""))) found.text.push(`${at}: ${prop}: ${value.trim()}`);
  if (prop === "border-radius" && /(?<![\w-])[1-9]\d*px/.test(value.replace(/var\([^)]*\)/g, ""))) found.radius.push(`${at}: ${prop}: ${value.trim()}`);
  if (/^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block))?$/.test(prop) && /(?<![\w-])([2-9]|[1-9]\d+)px/.test(value.replace(/var\([^)]*\)/g, ""))) found.space.push(`${at}: ${prop}: ${value.trim()}`);
}
// Inline styles written by the UI code: colours and text sizes belong in the stylesheet.
const dir = resolve(root, "src/ui");
for (const f of await readdir(dir)) {
  if (!f.endsWith(".ts")) continue;
  const src = await readFile(resolve(dir, f), "utf8");
  for (const m of src.matchAll(/style="([^"]*)"/g)) {
    if (/#[0-9a-fA-F]{3,8}\b|oklch\(|rgba?\(|font-size|\d+px/.test(m[1].replace(/\$\{[^}]*\}/g, ""))) found.inline.push(`${f}:${lineOf(src, m.index)}: ${m[1].slice(0, 80)}`);
  }
}
const counts = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]));
if (process.argv.includes("--list")) for (const [k, v] of Object.entries(found)) for (const l of v) console.log(`${k.padEnd(7)} ${l}`);
if (process.argv.includes("--update")) {
  await writeFile(baselinePath, JSON.stringify(counts, null, 2) + "\n");
  console.log("baseline written", counts);
  process.exit(0);
}
const base = JSON.parse(await readFile(baselinePath, "utf8").catch(() => "{}"));
let bad = false;
for (const k of Object.keys(counts)) {
  const allowed = base[k] ?? 0;
  if (counts[k] > allowed) {
    bad = true;
    console.error(`FAIL tokens: ${counts[k]} literal ${k} value(s), the baseline allows ${allowed}. Use a token from :root in src/styles.css (add one there if none fits). Run with --list to see them.`);
  } else if (counts[k] < allowed) console.log(`note: ${k} literals went down to ${counts[k]} (baseline ${allowed}); run with --update to lock it in`);
}
if (!bad) console.log(`PASS tokens: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
process.exit(bad ? 1 : 0);
