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
/** The one address the page may connect to: the canvast tools on this computer, for AI agents (ADR 0205; off until the person turns it on). */
const LOOPBACK = /^ws:\/\/127\.0\.0\.1:(47380|\$\{[\w$]+\})\/canvast\?/; // (a minifier may name the port $x)
// Module or script loading by URL from inside code.
for (const m of html.matchAll(/\b(?:import\s*\(|importScripts\s*\(|fetch\s*\(|new\s+(?:Worker|WebSocket|EventSource)\s*\()\s*["'`](https?:|wss?:|\/\/)[^"'`]*/gi)) {
  if (LOOPBACK.test(m[0].replace(/^[^"'`]*["'`]/, ""))) continue; // (the link to AI agents: this computer only, while it is on, ADR 0205)
  problems.push(`external code fetch: ${m[0].slice(0, 120)}`);
}
// Every absolute URL left in the file must be a known one: an XML namespace, or text a person reads (a licence, a credit in a comment). A new one fails
// until it is looked at and added here: it could be something fetched.
const KNOWN = [
  /^https:\/\/opensource\.org\/licenses\/MIT/, // (the same licence comment)
  // pdf.js: its licence, the XML namespaces of a PDF's forms and metadata, and addresses in its link maker (only text: connect-src is closed)
  /^https?:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0/,
  /^http:\/\/www\.xfa\.org\/schema\//,
  /^http:\/\/ns\.adobe\.com\/(xdp|xfdf|xmpmeta)\//,
  /^https?:\/\/(example\.com|foo\.bar)$/,
  /^http:\/\/\$\{[a-zA-Z]\}$/,
  // Mermaid (diagrams in notes) and the libraries it bundles: their error messages' help pages, licence comments and XML namespaces, only
  // text (the page's policy, default-src 'none', loads nothing from them).
  /^https:\/\/chevrotain\.io\/docs\/[\w./#-]*$/, /^https:\/\/github\.com\/(chevrotain\/chevrotain|mermaid-js\/mermaid|babel\/babel|jquery\/jquery|gre\/bezier-easing|markedjs\/marked)[\w./#-]*$/,
  /^https:\/\/langium\.org\/docs\/[\w./#-]*$/, /^https?:\/\/(en\.wikipedia\.org\/wiki\/[\w#.()_-]+|lodash\.com\/(license)?|openjsf\.org\/|jquery\.org\/license\/|tldrlegal\.com\/license\/mit-license|opensource\.org\/licenses\/MIT|underscorejs\.org\/LICENSE|engelschall\.com)$/,
  /^http:\/\/www\.eclipse\.org\/(elk\/ElkGraph|emf\/2002\/Ecore|emf\/2003\/XMLType)$/, /^http:\/\/\/org\/eclipse\/emf\/ecore\/util\/ExtendedMetaData$/,
  /^https:\/\/\$\{[a-zA-Z]\}$/, // a note's bare `www.` address made a link (an href on the page, followed only by the host; nothing is fetched)
  /^https:\/\/lea\.verou\.me/, // (the author in the licence comment of the code colouring)
  /^https?:\/\/www\.w3\.org\//, // XML namespaces (SVG, XLink)
  /^https:\/\/github\.com\/rsms\/inter$/, // the Inter licence text
  /^https:\/\/scripts\.sil\.org\/OFL$/, // the Inter licence text
  /^https:\/\/bottosson\.github\.io\/posts\/colorpicker\/$/, // a credit in the colour picker's code
  /^https:\/\/\$\{\w+\}:\$\{\w+\.port\}$/, // Settings > Sharing shows the host's own address (only text; the page connects nowhere)
  /^https:\/\/\\u2026$/, // the placeholder "https://…" in the link dialog's text
  /^https:\/\/github\.com\/emarpiee\/canvast$/, // canvast's own licence notice: where its source is
  LOOPBACK, // the link to AI agents (above)
  /^ws:\/\/127\.0\.0\.1:47380;?$/, // the page's policy: the one address it may connect to
  /^https:\/\/fsf\.org\/$/, // the GNU GPL text
  /^https:\/\/www\.gnu\.org\/licenses\/(why-not-lgpl\.html)?$/, // the GNU GPL text
  // PhotoCraft's NOTICE and licence texts in the notices comment (where its parts come from: text a person reads). Its own code carries
  // no address (scripts/artcraft/photocraft/package.mjs), and its frame keeps this page's policy: connect-src 'none'.
  /^https:\/\/github\.com\/(storytold|PolyMeilex|jslegers|LaurenzV)\/[\w./#-]*,?$/,
  /^http:\/\/www\.apache\.org\/licenses\/$/,
  /^https:\/\/(katex\.org\/docs\/supported\.html|www\.mathjax\.org\/|lucide\.dev|tabler\.io\/icons|player\.vimeo\.com\/video\/)$/,
];
for (const m of html.matchAll(/(?:https?|wss?):\/\/[^\s"'`)<>]+/gi)) {
  if (!KNOWN.some((re) => re.test(m[0]))) problems.push(`unknown URL string (look at it, then add it to KNOWN if it is only text): ${m[0]}`);
}

// The page's own Content-Security-Policy is the second wall (the browser refuses what it forbids): it must stay closed.
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
const directive = (name) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
// (connect-src: the canvast tools on this computer and nothing else, for AI agents, ADR 0205: the page opens it only while the person has it on)
for (const [name, want] of [["default-src", "'none'"], ["connect-src", "ws://127.0.0.1:47380"], ["base-uri", "'none'"], ["form-action", "'none'"], ["object-src", "'none'"]]) {
  if (directive(name) !== `${name} ${want}` && !(name === "object-src" && directive("default-src") === "default-src 'none'")) problems.push(`CSP: ${name} must be ${want} (is: ${directive(name) ?? "missing"})`);
}
// ('wasm-unsafe-eval' only compiles WebAssembly, for the decoders of scanned PDFs inside this file: it runs no text as code, and nothing can be fetched to compile.)
if (/unsafe-eval|https?:|\*/.test(csp.replace(/'unsafe-inline'|'wasm-unsafe-eval'/g, ""))) problems.push(`CSP allows more than it should: ${csp}`);

if (problems.length) {
  console.error(`FAIL ${file}\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`PASS ${file}: no external resource references, every URL string known, CSP closed`);
