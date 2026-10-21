import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Audit of the icons (docs/reference/icons.md): things that do the same thing share one common, recognizable icon, and that icon means only that.
 * Every button, menu row and bar button in `src/` that has a name and an icon is read from the source; the first word of its name says what it does:
 *
 *   Save → save · Import → arrow-down-to-line · Download → download · Upload → upload · Delete → trash-2 · Remove → x · Update → refresh-cw · Play → play
 *
 * A name with one of these words must carry that icon, and the icons that belong to exactly one of them (save, arrow-down-to-line, refresh-cw) are
 * carried by nothing else. A button that is only the word (a plain "Save") has no icon at all, which is also reported. Names are judged by their first
 * word, so "Export and copy out: save as a picture" is an export, not a save. Not a browser test: it reads the source, so it is fast.
 */
const ROOT = process.cwd();
const VERBS: Record<string, string> = { save: "save", import: "arrow-down-to-line", download: "download", upload: "upload", delete: "trash-2", remove: "x", update: "refresh-cw", play: "play" };
/** Icons that mean one thing only: nothing but the verb they stand for may carry them (the others, like download or x, also close, export, clear...). */
const EXCLUSIVE: Record<string, string> = { save: "save", "arrow-down-to-line": "import", "refresh-cw": "update" };
/** A name that starts with a verb word but is not that action (a state or a place); kept short on purpose, each with its reason. */
const NOT_THE_ACTION = new Set(["Saved adjustments" /* opens the Styles panel */]);

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));

/** Which lucide icon each `ICONS.name` is (two names for one file are one icon). */
function iconFiles(): Map<string, string> {
  const src = fs.readFileSync(path.join(ROOT, "src/ui/icons.ts"), "utf8");
  const file = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+"lucide-static\/icons\/([\w-]+)\.svg"/g)) file.set(m[1]!, m[2]!);
  const out = new Map<string, string>();
  for (const m of src.matchAll(/^\s+(\w+):\s*clean\((\w+)\)/gm)) out.set(m[1]!, file.get(m[2]!) ?? m[2]!);
  return out;
}

interface Use { file: string; line: number; name: string; icon: string }

/** Every named icon use in the source. */
function uses(files: Map<string, string>): Use[] {
  const out: Use[] = [];
  const seen = new Set<string>();
  for (const f of walk(path.join(ROOT, "src"))) {
    const text = fs.readFileSync(f, "utf8");
    const lineOf = (i: number): number => text.slice(0, i).split("\n").length;
    const add = (i: number, name: string | undefined, icon: string | undefined): void => {
      if (!name || !icon) return;
      const key = `${f}:${lineOf(i)}:${name}:${icon}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ file: path.relative(ROOT, f), line: lineOf(i), name: name.trim(), icon: files.get(icon) ?? icon });
    };
    for (const m of text.matchAll(/label:\s*(?:`([^`]*)`|"([^"]*)")[^{}]{0,300}?icon:\s*ICONS\.(\w+)/g)) add(m.index!, m[1] ?? m[2], m[3]); // { label, icon }
    for (const m of text.matchAll(/icon:\s*ICONS\.(\w+)[^{}]{0,300}?label:\s*(?:`([^`]*)`|"([^"]*)")/g)) add(m.index!, m[2] ?? m[3], m[1]); // { icon, label }
    for (const m of text.matchAll(/btn\("[^"]*",\s*ICONS\.(\w+),\s*(?:`([^`]*)`|"([^"]*)")/g)) add(m.index!, m[2] ?? m[3], m[1]); // btn(id, icon, name)
    // a button that is only an icon: its name is its aria-label, else its title (a title next to an aria-label only explains it)
    for (const m of text.matchAll(/<button([^>]*)>\s*\$\{ICONS\.(\w+)\}(?!\s*<span>)/g)) add(m.index!, /aria-label="([^"]*)"/.exec(m[1]!)?.[1] ?? /title="([^"]*)"/.exec(m[1]!)?.[1], m[2]);
    for (const m of text.matchAll(/(?:"([^"]+)"|\b([A-Z][A-Za-z]+)):\s*ICONS\.(\w+)/g)) add(m.index!, m[1] ?? m[2], m[3]); // { "name": icon } (the context menu)
    for (const m of text.matchAll(/\$\{ICONS\.(\w+)\}\s*<span>([^<]*)<\/span>/g)) add(m.index!, m[2], m[1]); // icon + word
  }
  return out;
}

/** The action a name stands for, by its first word ("" when it is none of them). */
const verbOf = (name: string): string => {
  if (NOT_THE_ACTION.has(name)) return "";
  const first = name.replace(/^[^A-Za-z]+/, "").split(/[^A-Za-z]/)[0]!.toLowerCase();
  return VERBS[first] ? first : "";
};

test("icons audit: Save, Import, Download, Upload, Delete, Remove, Update and Play each carry their one common icon, and nothing else carries Save, Import or Update", () => {
  const files = iconFiles();
  const all = uses(files);
  expect(all.length, "the scan found the named icons").toBeGreaterThan(200);
  const wrong: string[] = [];
  for (const u of all) {
    const verb = verbOf(u.name);
    if (verb && u.icon !== VERBS[verb]) wrong.push(`${u.file}:${u.line}  "${u.name}" is a ${verb}: it has ${u.icon}, it needs ${VERBS[verb]}`);
    const owner = EXCLUSIVE[u.icon];
    if (owner && verbOf(u.name) !== owner) wrong.push(`${u.file}:${u.line}  "${u.name}" has ${u.icon}, which is only for ${owner}`);
  }
  // a button that is only the word, with no icon
  const bare: string[] = [];
  for (const f of walk(path.join(ROOT, "src"))) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/<button[^>]*>\s*(Save|Import|Download|Upload|Delete|Update)\s*<\/button>/g)) bare.push(`${path.relative(ROOT, f)}:${text.slice(0, m.index).split("\n").length}  a button that says only "${m[1]}" has no icon`);
  }
  expect([...wrong, ...bare].sort(), "Buttons whose name and icon disagree (docs/reference/icons.md)").toEqual([]);
});
