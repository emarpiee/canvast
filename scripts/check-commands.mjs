#!/usr/bin/env node
// Every action is a command (ADR 0205). This check reads the app's source and fails when an action is not one:
//
//   handler   a click, double-click, context-menu, change, input or submit listener (or `.onclick =`) whose code does not run a command
//             (`runCommand(`, `commands.run(`, `commands.execute(`, `registry.run(`, `registry.execute(`, `pressCommand(`) and is not
//             marked as view state (`// view-state: <why>` on its line or the line above: it only changes what is shown, as folding a
//             section, typing in a search box, a tab, a hover)
//   menu      a menu row (an object with `label:` and `run:`) without `command:` (the id of the command it runs)
//   command   a command (an object with `title:` and `group:` that runs: `run:`, `exec:` or `takes:`) without a fixed `id:`, a `hint:`, a
//             `risk:` and `exec:` or `takes:` (not the old `run:`)
//   import    a command file (src/commands/) that imports the interface (src/ui/): commands work without the page drawn
//
// Actions that were there before the rule are counted per file in scripts/lib/commands-todo.json. That list only shrinks: a file with
// more than its count fails (a new action that skips the rule), a file with fewer fails until its count is lowered (`--shrink` lowers
// them), and a file not on the list may have none. When the list is empty the rule holds everywhere.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TODO = join(ROOT, "scripts/lib/commands-todo.json");
const SCAN = ["src"];
const SKIP = [/^src\/commands\//, /\.d\.ts$/, /^src\/gen\//, /^src\/render\//, /^src\/core\//, /^src\/scene\//, /^src\/storage\//];

const RUNS = /\b(runCommand|pressCommand|commands\.(run|execute|batch)|registry\.(run|execute|batch))\s*\(/;
const MARK = /\/\/\s*(view-state|typing):\s*\S/;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** The text with comments and strings blanked (same length, so offsets and lines stay), for finding brackets. */
function blank(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const keep = (s) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const e = src.indexOf("\n", i);
      const end = e < 0 ? n : e;
      out += keep(src.slice(i, end));
      i = end;
    } else if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      out += keep(src.slice(i, end));
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += c + keep(src.slice(i + 1, j)) + (src[j] ?? "");
      i = j + 1;
    } else if (c === "`") {
      // (a template: its text is blanked, its ${…} kept, with nesting)
      let j = i + 1;
      out += "`";
      while (j < n && src[j] !== "`") {
        if (src[j] === "\\") {
          out += "  ";
          j += 2;
        } else if (src[j] === "$" && src[j + 1] === "{") {
          let depth = 1;
          let k = j + 2;
          while (k < n && depth) {
            if (src[k] === "{") depth++;
            else if (src[k] === "}") depth--;
            k++;
          }
          out += src.slice(j, k);
          j = k;
        } else {
          out += src[j] === "\n" ? "\n" : " ";
          j++;
        }
      }
      out += "`";
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The end of the bracket that opens at `at` (in the blanked text). */
function close(text, at) {
  const open = text[at];
  const shut = { "(": ")", "{": "}", "[": "]" }[open];
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === shut && --depth === 0) return i;
  }
  return text.length - 1;
}

/** The `{` of the object literal around `at`, or -1. */
function openerOf(text, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = text[i];
    if (c === "}" || c === ")" || c === "]") depth++;
    else if (c === "(" || c === "[") {
      if (depth === 0) return -1;
      depth--;
    } else if (c === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

const lineOf = (src, at) => src.slice(0, at).split("\n").length;

/** The keys at the top level of an object literal (its own, not those of objects inside it). */
function topKeys(text, from, to) {
  const keys = new Set();
  let depth = 0;
  for (let i = from + 1; i < to; i++) {
    const c = text[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (depth === 0) {
      const m = /^(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(:|\(|,|\s*})/.exec(text.slice(i, i + 64));
      const prev = text.slice(Math.max(from + 1, i - 1), i);
      if (m && (i === from + 1 || /[\s,{]/.test(prev))) {
        keys.add(m[1]);
        i += m[1].length - 1;
      }
    }
  }
  return keys;
}

function problems(path) {
  const src = readFileSync(path, "utf8");
  const text = blank(src);
  const lines = src.split("\n");
  const found = [];
  const marked = (at) => {
    const l = lineOf(src, at);
    return MARK.test(lines[l - 1] ?? "") || MARK.test(lines[l - 2] ?? "");
  };
  // handlers
  for (const m of src.matchAll(/addEventListener\(\s*"(click|dblclick|contextmenu|change|input|submit)"/g)) {
    if (!text.startsWith("addEventListener", m.index)) continue; // (in a comment or a string)
    const at = m.index + "addEventListener".length;
    const end = close(text, at);
    const body = src.slice(at, end + 1);
    if (RUNS.test(body) || marked(m.index)) continue;
    found.push({ kind: "handler", line: lineOf(src, m.index), what: `a "${m[1]}" listener that does not run a command` });
  }
  for (const m of text.matchAll(/\.on(click|dblclick|change|input|submit)\s*=(?!=)/g)) {
    const l = lineOf(src, m.index);
    const stmt = src.slice(m.index, src.indexOf(";", m.index) + 1 || m.index + 400);
    if (RUNS.test(stmt) || marked(m.index)) continue;
    found.push({ kind: "handler", line: l, what: `".on${m[1]}" that does not run a command` });
  }
  // menu rows and commands: objects with a run
  const seen = new Set();
  for (const m of text.matchAll(/(?<![\w$.])(run|exec|takes)\s*[:(]/g)) {
    const open = openerOf(text, m.index - 1);
    if (open < 0 || seen.has(open)) continue;
    seen.add(open);
    const end = close(text, open);
    const keys = topKeys(text, open, end);
    const line = lineOf(src, open);
    if (keys.has("label") && keys.has("run") && !keys.has("title")) {
      if (!keys.has("command")) found.push({ kind: "menu", line, what: "a menu row without the command it runs (command:)" });
    } else if (keys.has("title") && keys.has("group")) {
      const miss = ["id", "hint", "risk"].filter((k) => !keys.has(k));
      if (!keys.has("exec") && !keys.has("takes")) miss.push("exec");
      if (keys.has("run") && !keys.has("exec")) miss.push("(not the old run:)");
      if (miss.length) found.push({ kind: "command", line, what: `a command without ${miss.join(", ")}` });
    }
  }
  return found;
}

function importProblems() {
  const out = [];
  for (const p of files(join(ROOT, "src/commands"))) {
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)) {
      if (/(^|\/)ui\//.test(m[1])) out.push(`${relative(ROOT, p)}:${lineOf(src, m.index)}: a command file imports the interface (${m[1]}); commands work without the page drawn`);
    }
  }
  return out;
}

const shrink = process.argv.includes("--shrink");
const list = process.argv.includes("--list");
const todo = JSON.parse(readFileSync(TODO, "utf8"));
const listed = todo.files ?? {};
const errors = [...importProblems()];
const counts = {};
const all = SCAN.flatMap((d) => files(join(ROOT, d)))
  .map((p) => relative(ROOT, p))
  .filter((p) => !SKIP.some((r) => r.test(p)))
  .sort();
let total = 0;
for (const rel of all) {
  const found = problems(join(ROOT, rel));
  if (!found.length) continue;
  counts[rel] = found.length;
  total += found.length;
  const allowed = listed[rel] ?? 0;
  if (list) for (const f of found) console.log(`${rel}:${f.line}: ${f.kind}: ${f.what}`);
  if (found.length > allowed) {
    errors.push(`${rel}: ${found.length} actions that are not commands, ${allowed} allowed (a new action must be a command, ADR 0205):`);
    for (const f of found) errors.push(`  ${rel}:${f.line}: ${f.kind}: ${f.what}`);
  }
}
const stale = Object.entries(listed).filter(([f, n]) => (counts[f] ?? 0) < n);
if (shrink) {
  const next = { ...todo, files: Object.fromEntries(Object.entries(listed).map(([f, n]) => [f, Math.min(n, counts[f] ?? 0)]).filter(([, n]) => n > 0)) };
  writeFileSync(TODO, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`check:commands: commands-todo.json lowered (${stale.length} files).`);
} else for (const [f, n] of stale) errors.push(`${f}: ${counts[f] ?? 0} actions left, the list says ${n}: lower it (npm run check:commands -- --shrink), the list only shrinks`);

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\ncheck:commands: ${errors.filter((e) => !e.startsWith("  ")).length} problems. The rule: CLAUDE.md, "Commands".`);
  process.exit(1);
}
console.log(`check:commands: ok (${total} actions before the rule still to move, in ${Object.keys(counts).length} files).`);
