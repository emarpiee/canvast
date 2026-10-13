// Static offline-completeness check for a built single-file HTML artifact.
// Fails if the file references any external resource that a browser would fetch.
import { readFile } from "node:fs/promises";

const file = process.argv[2] ?? "dist/canvast.html";
const html = await readFile(file, "utf8");
const problems = [];

// Attribute-level external references (script/link/img/iframe/source...).
for (const m of html.matchAll(/\b(?:src|href|srcset|poster|data|action)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)/gi)) {
  problems.push(`external attribute reference: ${m[1]}`);
}
// CSS url()/@import pointing outside the file.
for (const m of html.matchAll(/(?:url\(\s*["']?|@import\s+["'])((?:https?:)?\/\/[^"')\s]+)/gi)) {
  problems.push(`external CSS reference: ${m[1]}`);
}
// Module or script loading by URL from inside code.
for (const m of html.matchAll(/\b(?:import\s*\(|importScripts\s*\(|fetch\s*\(|new\s+(?:Worker|WebSocket|EventSource)\s*\()\s*["'`](https?:|wss?:|\/\/)[^"'`]*/gi)) {
  problems.push(`external code fetch: ${m[0].slice(0, 120)}`);
}
// Any remaining absolute URL is reported for review unless it is an XML namespace identifier.
const NAMESPACES = /^https?:\/\/www\.w3\.org\//;
const others = new Set();
for (const m of html.matchAll(/(?:https?|wss?):\/\/[^\s"'`)<>]+/gi)) {
  if (!NAMESPACES.test(m[0])) others.add(m[0]);
}

if (others.size) console.log(`note: ${others.size} non-fetched URL string(s) present:\n  ${[...others].join("\n  ")}`);
if (problems.length) {
  console.error(`FAIL ${file}\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`PASS ${file}: no external resource references`);
