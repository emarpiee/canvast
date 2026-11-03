// A note's properties: the YAML block at the top of a markdown note (`---` … `---`), as Obsidian writes it. Only the part of YAML
// Obsidian's properties use is read (a text, a number, true or false, a date, a list), and `|` and `>` blocks as text; anything else (a nested map) is
// kept exactly as written and never shown. Pure.

import { propType } from "./prop-types";

export interface Prop {
  key: string;
  /** A text, or a list of texts. */
  value: string | string[];
  /** Lines the reader did not understand, kept as they are (the key's own line first). */
  raw?: string[];
  /** The lines as the file has them, written back while the value stays the same (quotes, `[a, b]`, a comment after the value). */
  written?: string[];
  /** Written without quotes: a checkbox's true or false, which quoted would be a text. */
  plain?: boolean;
}

const OPEN = /^---\r?\n/;
const KEY = /^([^\s#:'"\-][^:]*?|"[^"]*"|'[^']*'):(?:[ \t]+(.*))?$/;

/** The note's properties block and the rest of it. `props` is null when it has none. */
export function splitFrontmatter(text: string): { props: Prop[] | null; body: string } {
  if (!OPEN.test(text)) return { props: null, body: text };
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (end < 0) return { props: null, body: text };
  // (a note that starts with a rule, no YAML: its first words are not properties)
  const first = lines.slice(1, end).find((l) => l.trim() && !l.trimStart().startsWith("#"));
  if (first !== undefined && !KEY.test(first)) return { props: null, body: text };
  return { props: parseProps(lines.slice(1, end)), body: lines.slice(end + 1).join("\n").replace(/^\n/, "") };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length > 1) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length > 1) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** `[a, "b, c", d]` → its items. */
function flowList(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (const ch of s.slice(1, -1)) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(unquote).filter((x) => x !== "");
}

/** A block's header: `|` keeps its lines, `>` folds them; `-`, `+` and an indent number may follow. */
const BLOCK = /^([|>])(?:[+-]?\d?|\d[+-])\s*(?:#.*)?$/;

/** A `|` or `>` block's text: without the indent of its first line; `>` joins lines, an empty line makes a new one. */
function blockText(style: string, lines: readonly string[]): string {
  const indent = /^\s*/.exec(lines.find((l) => l.trim()) ?? "")![0].length;
  const plain = lines.map((l) => l.slice(indent).trimEnd());
  if (style === "|") return plain.join("\n").trim();
  return plain.join("\n").replace(/\n{2,}/g, (n) => "\u0000".repeat(n.length - 1)).replace(/\n/g, " ").replace(/\u0000/g, "\n").trim();
}

export function parseProps(lines: readonly string[]): Prop[] {
  const props: Prop[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) {
      props.push({ key: "", value: "", raw: [line] }); // (a comment or an empty line stays where it is)
      continue;
    }
    const m = KEY.exec(line);
    // Lines that belong to this key: a list's `- item`s, or anything indented (which makes it a key kept as written).
    const more: string[] = [];
    // (a `|` or `>` block: its indented lines, and the empty ones between them)
    const block = m ? BLOCK.exec((m[2] ?? "").trim()) : null;
    if (block) {
      for (let j = i + 1; j < lines.length && (!lines[j]!.trim() || /^\s+\S/.test(lines[j]!)); j++) {
        if (lines[j]!.trim()) {
          while (i + 1 <= j) more.push(lines[++i]!);
        }
      }
    } else while (i + 1 < lines.length && /^\s+\S|^-\s/.test(lines[i + 1]!)) more.push(lines[++i]!);
    if (!m) {
      const last = props[props.length - 1];
      if (last?.raw) last.raw.push(line, ...more);
      else props.push({ key: "", value: "", raw: [line, ...more] });
      continue;
    }
    const key = unquote(m[1]!);
    const v = (m[2] ?? "").trim();
    if (block) {
      props.push({ key, value: blockText(block[1]!, more), written: [line, ...more] });
    } else if (!v && more.length && more.every((l) => /^\s*-\s+/.test(l) || /^\s*-$/.test(l))) {
      props.push({ key, value: more.map((l) => unquote(l.replace(/^\s*-\s*/, ""))).filter((x) => x !== ""), written: [line, ...more] });
    } else if (more.length || /^[|>&*!{]/.test(v)) {
      props.push({ key, value: "", raw: [line, ...more] });
    } else if (v.startsWith("[") && v.endsWith("]")) {
      props.push({ key, value: flowList(v), written: [line] });
    } else {
      props.push({ key, value: unquote(/^["']/.test(v) ? v : v.replace(/\s+#.*$/, "")), written: [line] }); // (a comment ends an unquoted text only)
    }
  }
  return props;
}

/** A text as YAML writes it: quoted only where it has to be. */
function scalar(s: string): string {
  return s === "" || /^[\s'"[\]{}>|*&!%@`#,?:-]|: | #|\s$|^(true|false|null|yes|no|~)$/i.test(s) || /[\n\t]/.test(s) ? JSON.stringify(s) : s;
}
const keyText = (k: string): string => (/^[^\s#:'"\-[\]{},][^:]*$/.test(k) && !/\s$/.test(k) ? k : JSON.stringify(k));

/** The properties block's text (without the `---` lines). */
export function writeProps(props: readonly Prop[]): string[] {
  const out: string[] = [];
  for (const p of props) {
    if (p.raw) out.push(...p.raw);
    else if (p.written) out.push(...p.written);
    else if (Array.isArray(p.value)) out.push(`${keyText(p.key)}:`, ...p.value.map((v) => `  - ${scalar(v)}`));
    else out.push(p.value === "" ? `${keyText(p.key)}:` : `${keyText(p.key)}: ${p.plain ? p.value : scalar(p.value)}`);
  }
  return out;
}

/** The note with this properties block (none when `props` is empty and the note had none). */
export function withFrontmatter(body: string, props: readonly Prop[]): string {
  if (!props.length) return body;
  return `---\n${writeProps(props).join("\n")}\n---\n${body}`;
}

/** What a note's properties say of its item: its tags, its note (`description`) and its fields (every other key, a list as "a, b"). */
export interface NoteMeta {
  tags: string[];
  note: string;
  fields: Array<{ key: string; value: string; items?: string[] }>;
}
const TAG_KEYS = new Set(["tags", "tag"]);
const NOTE_KEY = "description";

export function metaOfProps(props: readonly Prop[]): NoteMeta {
  const meta: NoteMeta = { tags: [], note: "", fields: [] };
  for (const p of props) {
    if (p.raw || !p.key) continue;
    const k = p.key.toLowerCase();
    if (TAG_KEYS.has(k)) {
      const list = Array.isArray(p.value) ? p.value : p.value.split(/[,\s]+/);
      for (const t of list.map((x) => x.replace(/^#/, "").trim()).filter(Boolean)) if (!meta.tags.includes(t)) meta.tags.push(t);
    } else if (k === NOTE_KEY && !Array.isArray(p.value)) meta.note = p.value;
    else meta.fields.push(Array.isArray(p.value) ? { key: p.key, value: p.value.join(", "), items: p.value } : { key: p.key, value: p.value });
  }
  return meta;
}

/** A value from the item as its type writes it in the file: a list as a list, a checkbox as true or false. */
function typedProp(key: string, value: string, wasList: boolean, items?: string[]): Prop {
  const type = propType(key, value, items);
  if (items && type === "list") return { key, value: items };
  if (value && (wasList || type === "list")) return { key, value: value.split(/,\s*/).filter(Boolean) };
  return type === "checkbox" && /^(?:true|false)$/i.test(value) ? { key, value: value.toLowerCase(), plain: true } : { key, value };
}

/**
 * The note's properties after its item's tags, note and fields changed: the keys it had keep their place (and a list stays a list),
 * keys gone from the item go, new ones come last; what was kept as written stays.
 */
export function propsOfMeta(prev: readonly Prop[], meta: NoteMeta): Prop[] {
  const fields = new Map(meta.fields.map((f) => [f.key, f]));
  const out: Prop[] = [];
  let tagsDone = false;
  let noteDone = false;
  for (const p of prev) {
    if (p.raw || !p.key) {
      out.push(p);
      continue;
    }
    const k = p.key.toLowerCase();
    if (TAG_KEYS.has(k)) {
      const had = Array.isArray(p.value) ? p.value : p.value.split(/[,\s]+/).filter(Boolean);
      const same = had.map((t) => t.replace(/^#/, "").trim()).join("\n") === meta.tags.join("\n");
      if (!tagsDone && same) out.push(p); // (as the file writes them: nothing changed)
      else if (!tagsDone && meta.tags.length) out.push({ key: p.key, value: [...meta.tags] });
      tagsDone = true;
    } else if (k === NOTE_KEY) {
      if (p.value === meta.note) out.push(p);
      else if (meta.note) out.push({ key: p.key, value: meta.note });
      noteDone = true;
    } else if (fields.has(p.key)) {
      const f = fields.get(p.key)!;
      // (unchanged, it stays as written)
      const same = Array.isArray(p.value) ? (f.items ? JSON.stringify(f.items) === JSON.stringify(p.value) : p.value.join(", ") === f.value) : !f.items && p.value === f.value;
      if (same) out.push(p);
      else out.push(typedProp(p.key, f.value, Array.isArray(p.value), f.items));
      fields.delete(p.key);
    }
  }
  if (!tagsDone && meta.tags.length) out.push({ key: "tags", value: [...meta.tags] });
  if (!noteDone && meta.note) out.push({ key: NOTE_KEY, value: meta.note });
  for (const [key, f] of fields) out.push(typedProp(key, f.value, false, f.items));
  return out;
}

/**
 * Properties pasted into a note, added to its own: tags are added to its tags, a key it does not have (or has empty) is added, and what it
 * already says stays. Nested YAML pasted comes along as written.
 */
export function mergeProps(own: readonly Prop[], pasted: readonly Prop[]): Prop[] {
  const out = [...own];
  const asList = (p: Prop): string[] => (Array.isArray(p.value) ? p.value : p.value.split(/[,\s]+/).filter(Boolean)).map((t) => t.replace(/^#/, "").trim());
  for (const p of pasted) {
    if (!p.key) continue; // (a comment or an empty line of what was pasted)
    const k = p.key.toLowerCase();
    const at = out.findIndex((x) => x.key && (TAG_KEYS.has(k) ? TAG_KEYS.has(x.key.toLowerCase()) : x.key.toLowerCase() === k));
    const mine = out[at];
    if (!mine) out.push(p);
    else if (!mine.raw && TAG_KEYS.has(k) && !p.raw) {
      const had = asList(mine);
      const add = asList(p).filter((t) => !had.some((x) => x.toLowerCase() === t.toLowerCase()));
      if (add.length) out[at] = { key: mine.key, value: [...had, ...add] };
    } else if (!mine.raw && !mine.value.length) out[at] = { ...p, key: mine.key };
  }
  return out;
}

/** A note's file with properties pasted into it added to its own (`mergeProps`). */
export function withPastedProps(kind: "md" | "txt" | "rich", file: string, pasted: readonly Prop[]): string {
  if (!pasted.length || kind === "txt") return file;
  if (kind === "rich") return withRichMeta(file, metaOfProps(mergeProps(propsOfMeta([], richMeta(file) ?? NO_META), pasted)));
  const { props, body } = splitFrontmatter(file);
  return withFrontmatter(body, mergeProps(props ?? [], pasted));
}

/** Whether two items' tags, notes and fields are the same. */
export const sameMeta = (a: NoteMeta, b: NoteMeta): boolean => {
  const tags = (m: NoteMeta): string => [...new Set(m.tags.map((t) => t.toLowerCase()))].sort().join("\n");
  // (a rich text note's head has no lists: an item's list and its joined words are the same)
  const fields = (m: NoteMeta): string => JSON.stringify(m.fields.map((f) => [f.key, f.value]));
  return a.note === b.note && tags(a) === tags(b) && fields(a) === fields(b);
};

// A rich text note (`.note.html`) keeps the same properties as `<meta>` in its head: `keywords` its tags, `description` its note, any
// other name a field.
const META = /<meta\s+name="([^"]*)"\s+content="([^"]*)"\s*\/?>\n?/gi;
const NOT_PROPS = new Set(["generator", "viewport", "color-scheme"]);
const unescapeAttr = (s: string): string => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escapeAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A rich text note's properties, or null when its head has none. */
export function richMeta(file: string): NoteMeta | null {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(file)?.[1] ?? "";
  const meta: NoteMeta = { tags: [], note: "", fields: [] };
  let any = false;
  for (const [, name, content] of head.matchAll(META)) {
    const k = unescapeAttr(name!);
    if (NOT_PROPS.has(k.toLowerCase())) continue;
    any = true;
    const v = unescapeAttr(content!);
    if (k.toLowerCase() === "keywords") meta.tags = v.split(/,\s*/).filter(Boolean);
    else if (k.toLowerCase() === NOTE_KEY) meta.note = v;
    else meta.fields.push({ key: k, value: v });
  }
  return any ? meta : null;
}

/** The `<meta>` lines of a rich text note's head for these properties. */
export const richMetaLines = (meta: NoteMeta): string =>
  [
    ...(meta.tags.length ? [`<meta name="keywords" content="${escapeAttr(meta.tags.join(", "))}">`] : []),
    ...(meta.note ? [`<meta name="${NOTE_KEY}" content="${escapeAttr(meta.note)}">`] : []),
    ...meta.fields.filter((f) => !NOT_PROPS.has(f.key.toLowerCase())).map((f) => `<meta name="${escapeAttr(f.key)}" content="${escapeAttr(f.value)}">`),
  ].map((l) => `${l}\n`).join("");

/** A rich text note with these properties in its head (its other `<meta>`, its title and its body as they were). */
export function withRichMeta(file: string, meta: NoteMeta): string {
  const m = /(<head[^>]*>)([\s\S]*?)(<\/head>)/i.exec(file);
  if (!m) return file;
  const kept = m[2]!.replace(META, (line, name: string) => (NOT_PROPS.has(unescapeAttr(name).toLowerCase()) ? line : ""));
  return file.replace(m[0], () => `${m[1]}${kept.replace(/\n?$/, "\n")}${richMetaLines(meta)}${m[3]}`); // (a function: a `$&` in the words stays as it is)
}

/** No tags, no note, no fields. */
export const NO_META: NoteMeta = { tags: [], note: "", fields: [] };

/**
 * The `#tags` written in a markdown note's words, as Obsidian reads them: `#` then letters, digits, `_`, `-` or `/`, at least one
 * not a digit, not glued to a word or a `/` before it (a heading's `# `, `#123`, an address's `/#part` are none). Not in code.
 */
export function inlineTags(body: string): string[] {
  const out: string[] = [];
  // (a link's `#part` is no tag: `[[#Heading]]`, `[words](#part)`)
  const text = body.replace(/^```[\s\S]*?^```.*$|^~~~[\s\S]*?^~~~.*$/gm, "").replace(/`+[^`\n]*?`+/g, "").replace(/\[\[[^\]\n]*\]\]/g, "").replace(/\]\([^)\n]*\)/g, "]");
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_&/#\\])#([\p{L}\p{N}_\-/]+)/gu)) {
    const t = m[1]!.replace(/[/-]+$/, "");
    if (t && /[^\d]/.test(t) && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/**
 * A note file's properties (markdown: its YAML, and the `#tags` in its words; rich text: its head's `<meta>`), or null when it has no
 * YAML (and for plain text). `inline`: a markdown note's `#tags`, also without YAML.
 */
export function fileMeta(kind: "md" | "txt" | "rich", text: string): (NoteMeta & { inline: string[] }) | null {
  if (kind === "rich") {
    const m = richMeta(text);
    return m && { ...m, inline: [] };
  }
  if (kind !== "md") return null;
  const { props, body } = splitFrontmatter(text);
  const inline = inlineTags(body);
  if (!props) return null;
  const meta = metaOfProps(props);
  return { ...meta, tags: [...meta.tags, ...inline.filter((t) => !meta.tags.some((x) => x.toLowerCase() === t.toLowerCase()))], inline };
}

/** A markdown note's `#tags` (also when it has no YAML). */
export const fileInlineTags = (kind: "md" | "txt" | "rich", text: string): string[] => (kind === "md" ? inlineTags(splitFrontmatter(text).body) : []);

/** A markdown note's new text (from the editor, without properties) under the properties its file has now. */
export function underProps(file: string, body: string): string {
  return withFrontmatter(body, splitFrontmatter(file).props ?? []);
}

/** The whole note as a markdown file: its words under its properties, as they are in the details panel. What is copied to take the note elsewhere. */
export function wholeMarkdown(kind: "md" | "rich", file: string, words: string, meta: NoteMeta | null, pasted: readonly Prop[]): string {
  const text = kind === "md" ? underProps(file, words) : withFrontmatter(words, propsOfMeta([], meta ?? NO_META));
  return withPastedProps("md", kind === "md" && meta ? withFileMeta("md", text, meta) : text, pasted);
}

/** A note file with these properties written in (a plain text note is left as it is). */
export function withFileMeta(kind: "md" | "txt" | "rich", text: string, meta: NoteMeta): string {
  if (kind === "rich") return withRichMeta(text, meta);
  if (kind !== "md") return text;
  const { props, body } = splitFrontmatter(text);
  // (the tags written as #tags in its words stay there: the YAML lists the others)
  // (…unless the YAML lists it too: what the file has written stays)
  const inline = inlineTags(body).map((t) => t.toLowerCase());
  const listed = metaOfProps(props ?? []).tags.map((t) => t.toLowerCase());
  return withFrontmatter(body, propsOfMeta(props ?? [], { ...meta, tags: meta.tags.filter((t) => !inline.includes(t.toLowerCase()) || listed.includes(t.toLowerCase())) }));
}
