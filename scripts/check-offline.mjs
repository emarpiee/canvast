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
// Every absolute URL left in the file must be a known one: an XML namespace, or text a person reads (a licence, a credit in a comment). A new one fails
// until it is looked at and added here: it could be something fetched.
const KNOWN = [
  /^https?:\/\/www\.w3\.org\//, // XML namespaces (SVG, XLink)
  /^https:\/\/github\.com\/rsms\/inter$/, // the Inter licence text
  /^https:\/\/scripts\.sil\.org\/OFL$/, // the Inter licence text
  /^https:\/\/bottosson\.github\.io\/posts\/colorpicker\/$/, // a credit in the colour picker's code
  /^https:\/\/\\u2026$/, // the placeholder "https://…" in the link dialog's text
  /^https:\/\/github\.com\/emarpiee\/canvast$/, // canvast's own licence notice: where its source is
  /^https:\/\/fsf\.org\/$/, // the GNU GPL text
  /^https:\/\/www\.gnu\.org\/licenses\/(why-not-lgpl\.html)?$/, // the GNU GPL text
];
for (const m of html.matchAll(/(?:https?|wss?):\/\/[^\s"'`)<>]+/gi)) {
  if (!KNOWN.some((re) => re.test(m[0]))) problems.push(`unknown URL string (look at it, then add it to KNOWN if it is only text): ${m[0]}`);
}

// The page's own Content-Security-Policy is the second wall (the browser refuses what it forbids): it must stay closed.
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
const directive = (name) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
for (const [name, want] of [["default-src", "'none'"], ["connect-src", "'none'"], ["base-uri", "'none'"], ["form-action", "'none'"], ["object-src", "'none'"]]) {
  if (directive(name) !== `${name} ${want}` && !(name === "object-src" && directive("default-src") === "default-src 'none'")) problems.push(`CSP: ${name} must be ${want} (is: ${directive(name) ?? "missing"})`);
}
if (/unsafe-eval|https?:|\*/.test(csp.replace(/'unsafe-inline'/g, ""))) problems.push(`CSP allows more than it should: ${csp}`);

if (problems.length) {
  console.error(`FAIL ${file}\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`PASS ${file}: no external resource references, every URL string known, CSP closed`);
