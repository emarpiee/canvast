// A note's properties: the YAML block at the top of a markdown note (`---` … `---`), as Obsidian writes it. Only the part of YAML
// Obsidian's properties use is read (a text, a number, true or false, a date, a list); anything else (a nested map, a `|` block) is
// kept exactly as written and never shown. Pure.

export interface Prop {
  key: string;
  /** A text, or a list of texts. */
  value: string | string[];
  /** Lines the reader did not understand, kept as they are (the key's own line first). */
  raw?: string[];
}

const OPEN = /^---\r?\n/;
const KEY = /^([^\s#:'"\-][^:]*?|"[^"]*"|'[^']*'):(?:[ \t]+(.*))?$/;

/** The note's properties block and the rest of it. `props` is null when it has none. */
export function splitFrontmatter(text: string): { props: Prop[] | null; body: string } {
  if (!OPEN.test(text)) return { props: null, body: text };
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (end < 0) return { props: null, body: text };
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

export function parseProps(lines: readonly string[]): Prop[] {
  const props: Prop[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = KEY.exec(line);
    // Lines that belong to this key: a list's `- item`s, or anything indented (which makes it a key kept as written).
    const more: string[] = [];
    while (i + 1 < lines.length && /^\s+\S|^-\s/.test(lines[i + 1]!)) more.push(lines[++i]!);
    if (!m) {
      const last = props[props.length - 1];
      if (last?.raw) last.raw.push(line, ...more);
      else props.push({ key: "", value: "", raw: [line, ...more] });
      continue;
    }
    const key = unquote(m[1]!);
    const v = (m[2] ?? "").trim();
    if (!v && more.length && more.every((l) => /^\s*-\s+/.test(l) || /^\s*-$/.test(l))) {
      props.push({ key, value: more.map((l) => unquote(l.replace(/^\s*-\s*/, ""))).filter((x) => x !== "") });
    } else if (more.length || /^[|>&*!{]/.test(v)) {
      props.push({ key, value: "", raw: [line, ...more] });
    } else if (v.startsWith("[") && v.endsWith("]")) {
      props.push({ key, value: flowList(v) });
    } else {
      props.push({ key, value: unquote(/^["']/.test(v) ? v : v.replace(/\s+#.*$/, "")) }); // (a comment ends an unquoted text only)
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
    else if (Array.isArray(p.value)) out.push(`${keyText(p.key)}:`, ...p.value.map((v) => `  - ${scalar(v)}`));
    else out.push(p.value === "" ? `${keyText(p.key)}:` : `${keyText(p.key)}: ${scalar(p.value)}`);
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
  fields: Array<{ key: string; value: string }>;
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
    else meta.fields.push({ key: p.key, value: Array.isArray(p.value) ? p.value.join(", ") : p.value });
  }
  return meta;
}

/**
 * The note's properties after its item's tags, note and fields changed: the keys it had keep their place (and a list stays a list),
 * keys gone from the item go, new ones come last; what was kept as written stays.
 */
export function propsOfMeta(prev: readonly Prop[], meta: NoteMeta): Prop[] {
  const fields = new Map(meta.fields.map((f) => [f.key, f.value]));
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
      if (!tagsDone && meta.tags.length) out.push({ key: p.key, value: [...meta.tags] });
      tagsDone = true;
    } else if (k === NOTE_KEY) {
      if (meta.note) out.push({ key: p.key, value: meta.note });
      noteDone = true;
    } else if (fields.has(p.key)) {
      const v = fields.get(p.key)!;
      out.push({ key: p.key, value: Array.isArray(p.value) ? v.split(/,\s*/).filter(Boolean) : v });
      fields.delete(p.key);
    }
  }
  if (!tagsDone && meta.tags.length) out.push({ key: "tags", value: [...meta.tags] });
  if (!noteDone && meta.note) out.push({ key: NOTE_KEY, value: meta.note });
  for (const [key, value] of fields) out.push({ key, value });
  return out;
}

/** Whether two items' tags, notes and fields are the same. */
export const sameMeta = (a: NoteMeta, b: NoteMeta): boolean => {
  const tags = (m: NoteMeta): string => [...new Set(m.tags.map((t) => t.toLowerCase()))].sort().join("\n");
  return a.note === b.note && tags(a) === tags(b) && JSON.stringify(a.fields) === JSON.stringify(b.fields);
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
  return file.replace(m[0], `${m[1]}${kept.replace(/\n?$/, "\n")}${richMetaLines(meta)}${m[3]}`);
}

/** No tags, no note, no fields. */
export const NO_META: NoteMeta = { tags: [], note: "", fields: [] };

/** A note file's properties (markdown: its YAML; rich text: its head's `<meta>`), or null when it has none (and for plain text). */
export function fileMeta(kind: "md" | "txt" | "rich", text: string): NoteMeta | null {
  if (kind === "rich") return richMeta(text);
  if (kind !== "md") return null;
  const { props } = splitFrontmatter(text);
  return props ? metaOfProps(props) : null;
}

/** A markdown note's new text (from the editor, without properties) under the properties its file has now. */
export function underProps(file: string, body: string): string {
  return withFrontmatter(body, splitFrontmatter(file).props ?? []);
}

/** A note file with these properties written in (a plain text note is left as it is). */
export function withFileMeta(kind: "md" | "txt" | "rich", text: string, meta: NoteMeta): string {
  if (kind === "rich") return withRichMeta(text, meta);
  if (kind !== "md") return text;
  const { props, body } = splitFrontmatter(text);
  return withFrontmatter(body, propsOfMeta(props ?? [], meta));
}
