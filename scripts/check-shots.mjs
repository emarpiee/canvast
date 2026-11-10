// The README's pictures and tests/shots/manifest.ts agree (CLAUDE.md "Screenshots"): every picture the README links under
// docs/screenshots/ is a declared shot (or one of the few made another way), and every declared shot is linked from the README.
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const manifest = readFileSync("tests/shots/manifest.ts", "utf8");
const declared = new Set([...manifest.matchAll(/^\s*"([a-z0-9-]+)": \{ section:/gm)].map((m) => m[1]));
const linked = new Set([...readme.matchAll(/docs\/screenshots\/([a-z0-9-]+)\.webp/g)].map((m) => m[1]));
// (made by other scripts: the animation, the showcase dive, the desktop app in Electron)
const OTHER = new Set(readFileSync("tests/shots/other-pictures.txt", "utf8").split("\n").filter((l) => l && !l.startsWith("#")));
const problems = [];
for (const n of linked) if (!declared.has(n) && !OTHER.has(n)) problems.push(`README links docs/screenshots/${n}.webp, which no shot declares (tests/shots/manifest.ts)`);
for (const n of declared) if (!linked.has(n)) problems.push(`the shot "${n}" is declared but the README does not show it`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`check:shots: ${linked.size} pictures in the README, ${declared.size} declared shots, all matched.`);
