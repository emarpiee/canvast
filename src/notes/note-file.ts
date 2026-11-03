// Notes: the library files the notes editor opens (markdown, plain text and the app's rich text notes) and how a note links to other
// library items. Pure: the editor itself is `ui/note-editor.ts`.

export type NoteKind = "md" | "txt" | "rich";

/** How the notes editor looks (Settings > Notes): SunEditor's own presets. */
export type NoteStyle = "document" | "classic" | "bottom" | "balloon" | "notion";
export const NOTE_STYLES: Array<[NoteStyle, string]> = [
  ["document", "Document"],
  ["classic", "Classic"],
  ["bottom", "Bottom"],
  ["balloon", "Balloon"],
  ["notion", "Notion-like"],
];

/** A rich text note: an HTML file the app writes for a note whose formatting markdown cannot hold (other apps open it as a page). */
export const RICH_NOTE_SUFFIX = ".note.html";

/** The kind of note a file is, by its name, or null when the notes editor does not open it. */
export function noteKindOf(name: string): NoteKind | null {
  const n = name.toLowerCase();
  if (n.endsWith(RICH_NOTE_SUFFIX)) return "rich";
  if (n.endsWith(".md") || n.endsWith(".markdown")) return "md";
  if (n.endsWith(".txt")) return "txt";
  return null;
}

/** The name of the rich text note made from a note (`plan.md` → `plan.note.html`). */
/** A new markdown note named `name` (Settings > Notes > New note name), its title the same. */
export const newNoteFile = (name: string): File => new File([`# ${name}\n\n`], `${name}.md`, { type: "text/markdown" });

export const richNameOf = (name: string): string => `${name.replace(/\.(md|markdown|txt)$/i, "")}${RICH_NOTE_SUFFIX}`;

/** The app's own link to a library item, whatever its name or folder: `canvast:<sha-256>`. */
export const APP_LINK = "canvast:";
const HASH = /^[0-9a-f]{64}$/;

/** A path inside the library (`folder/sub/name.png`), as its parts. */
export const splitPath = (path: string): string[] => path.split("/").filter((p) => p && p !== ".");

/** The parts of `rel` (a link written in a note) taken from the folder `dir`, with `..` gone up; null when it leaves the library. */
export function resolvePath(dir: readonly string[], rel: string): string[] | null {
  const out = [...dir];
  for (const p of rel.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(p);
  }
  return out.length ? out : null;
}

/** A part of a link, URL-encoded, brackets too: a `)` in an address would end a markdown link. */
export const encodeLinkPart = (part: string): string => encodeURIComponent(part).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The link from a note in folder `from` to the file at `to` (both inside the library), each part URL-encoded (`../Pictures/my%20cat.png`). */
export function relativeLink(from: readonly string[], to: readonly string[]): string {
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
  return [...Array<string>(from.length - same).fill(".."), ...to.slice(same).map(encodeLinkPart)].join("/");
}

/** The link a note writes to the file at `to`: its path from the root of the library, whichever folder the note is in (`Pictures/my%20cat.png`). */
export const libraryLink = (to: readonly string[]): string => to.map(encodeLinkPart).join("/");

/** Where a link may point inside the library: `path` read from the note's folder, `root` read from the root of the library (null when it leaves it). */
export type PathTarget = { path: string[]; root: string[] | null };

/**
 * What a link in a note points at: `{ hash }` for the app's own link, `{ path, root }` (the parts of a library path, both ways of reading
 * it) for a path, or null for anything else (a web address, an anchor in the page, a path from the root of the disk).
 */
export function linkTarget(link: string, noteDir: readonly string[]): { hash: string } | PathTarget | null {
  if (link.startsWith(APP_LINK)) {
    const hash = link.slice(APP_LINK.length).toLowerCase();
    return HASH.test(hash) ? { hash } : null;
  }
  if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("#") || link.startsWith("/") || link.startsWith("\\")) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(link.split(/[?#]/)[0]!);
  } catch {
    return null;
  }
  const path = resolvePath(noteDir, rel);
  if (!path) return null;
  // (a vault opened one folder up writes the library's own folder in front: `library/images/cat.png`)
  const root = resolvePath([], rel.replace(/^(?:\.\/)*library\//i, ""));
  return { path, root };
}

/** A plain text file as the editor's HTML: a paragraph a line. */
export const textHtml = (text: string): string => text.split(/\r?\n/).map((l) => `<p>${l.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`) || "<br>"}</p>`).join("");

/** A whole HTML file for a rich text note: its title and the editor's HTML as its body. */
export function richNoteFile(title: string, body: string): string {
  const t = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="generator" content="canvast">\n<title>${t}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/** The body of a rich text note's file (the whole text when it is not a whole page). */
export function richNoteBody(file: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(file);
  return (m ? m[1]! : file).trim();
}

// Links between notes as Obsidian writes them: `[[Plan]]`, `[[Plan|shown text]]`, `[[Projects/Plan]]` when two notes share a name.
// In the editor they are ordinary links to `canvast-wiki:<target>`, an embed `![[…]]` a picture from there; the markdown file keeps the `[[…]]`.
export const WIKI = "canvast-wiki:";

/** `text` with `fn` run on the parts outside fenced code blocks (`inFence`, on the blocks). A block ends with a fence at least as long as its own. */
const outsideFences = (text: string, fn: (part: string) => string, inFence: (block: string) => string = (b) => b): string => {
  const re = /^(`{3,}|~{3,})[^\n]*\n(?:[\s\S]*?\n)??\1[`~]*[ \t]*$/gm;
  let out = "";
  let at = 0;
  for (const m of text.matchAll(re)) {
    out += fn(text.slice(at, m.index)) + inFence(m[0]);
    at = m.index + m[0].length;
  }
  return out + fn(text.slice(at));
};

/** Stands for a backtick inside a code block while the editor writes it (a code block that holds a code fence). */
export const FENCE_TICK = "\uE101";
/** A fence's words after the language (` ```qrcode complex`, ` ```c++`) as letters the editor's reader keeps, and back. */
const packInfo = (block: string): string => block.replace(/^(`{3,}|~{3,})([^\n]*)/, (_m, fence: string, info: string) => `${fence}${info.trim().replace(/\W/g, (c) => `_x${c.charCodeAt(0).toString(16)}x_`)}`);
const unpackInfo = (block: string): string => block.replace(/^(`{3,})([^\n]*)/, (_m, fence: string, info: string) => `${fence}${info.replace(/_x([0-9a-f]+)x_/g, (_x, h: string) => String.fromCodePoint(parseInt(h, 16)))}`);

/** `text` with `fn` run on the parts outside code (fenced blocks and inline code are left as they are). */
export const outsideCode = (text: string, fn: (part: string) => string): string =>
  outsideFences(text, (block) => block.split(/(`+[^`\n]*?`+)/).map((s, j) => (j % 2 ? s : fn(s))).join(""));

/** The address of a markdown link as it may be written: `<with space.png>`, or with brackets that pair (`cat%20(2).png`). */
const LINK = /(\]\()(<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+"[^"\n]*")?\))/g;
/** A link's address with its spaces and brackets encoded, so that any reader finds its end. */
const plainAddress = (dest: string): string => (dest.startsWith("<") ? dest.slice(1, -1) : dest).replace(/[ ()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * A markdown note made ready for the editor's reader, which knows less than Obsidian: link addresses with spaces or brackets, a table's short
 * separator (`|:--|--:|`), an underlined heading, ``` ``inline code`` ``` and a `*` standing alone would otherwise be read as something else.
 */
export function readableMarkdown(md: string): string {
  return outsideFences(md, (part) => readablePart(part), packInfo);
}
/** Table rows with more cells than the heading: the reader would drop those cells, so the heading gets empty cells to hold them. */
const wholeTables = (part: string): string =>
  part.replace(/^\|[^\n]*\n\|[ \t]*:?-+[^\n]*(?:\n\|[^\n]*)*/gm, (table) => {
    const rows = table.split("\n");
    const cells = (r: string): number => r.replace(/\\\|/g, "").replace(/^\||\|[ \t]*$/g, "").split("|").length;
    const most = Math.max(...rows.map(cells));
    const more = most - cells(rows[0]!);
    if (more <= 0) return table;
    rows[0] = `${rows[0]!.replace(/[ \t]*$/, "")}${"  |".repeat(more)}`;
    rows[1] = `${rows[1]!.replace(/[ \t]*$/, "")}${" --- |".repeat(Math.max(0, most - cells(rows[1]!)))}`;
    return rows.join("\n");
  });

/** A paragraph indented under a list item stays in that item (the reader would end the list there). */
const listParagraphs = (part: string): string => {
  const re = /^([ \t]*(?:[-*+]|\d+\.)[ \t][^\n]*)\n[ \t]*\n[ \t]{2,}(?![-*+][ \t]|\d+\.[ \t]|`{3}|~{3})(\S[^\n]*)$/gm;
  for (let was = ""; was !== part; ) {
    was = part;
    part = part.replace(re, "$1<br><br>$2");
  }
  return part;
};

function readablePart(part: string): string {
  return wholeTables(listParagraphs(part))
      .replace(/^([^\s|>#\-*+\d`~][^\n]*)\n(=+|-{2,})[ \t]*$/gm, (_m, title: string, line: string) => `${line[0] === "=" ? "#" : "##"} ${title.trim()}`)
      .replace(/^(\|?[^\n|]*\|[^\n]*\n)(\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?)[ \t]*$/gm, (_m, head: string, row: string) => head + row.replace(/-+/g, "---"))
      .split(/(`+[^`\n]*?`+)/)
      .map((s, j) => {
        if (j % 2) return /^`{2,}/.test(s) && /^(`+)[^`]+\1$/.test(s) ? s.replace(/^`+|`+$/g, "`") : s;
        return s.replace(LINK, (m, open: string, dest: string, close: string) => (dest.startsWith(WIKI) ? m : `${open}${plainAddress(dest)}${close}`)).replace(/(?<=\S[ \t]+)\*(?=[ \t])/g, "\\*");
      })
      .join("");
}

/** A markdown note's `[[…]]` links as markdown links the editor shows (`[shown](canvast-wiki:target)`). */
export const wikiToLinks = (md: string): string =>
  outsideCode(md, (s) =>
    s.replace(/(!?)\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g, (_m, bang: string, target: string, alias?: string) => {
      const t = target.trim();
      return `${bang}[${(alias ?? t.split("/").pop()!).replace(/[[\]]/g, "")}](${WIKI}${encodeLinkPart(t)})`;
    }),
  );

/** The editor's links to notes back as `[[target]]` (or `[[target|shown]]` when the text shown is not the note's name). */
export const linksToWiki = (md: string): string =>
  md.replace(/\[([^\]\n]*)\]\(canvast-wiki:([^)\s]+)\)/g, (_m, shown: string, enc: string) => {
    let t = enc;
    try {
      t = decodeURIComponent(enc);
    } catch {
      /* (written as it is) */
    }
    const text = shown.replace(/\\([[\]\\*_`])/g, "$1");
    return text && text !== t.split("/").pop() ? `[[${t}|${text}]]` : `[[${t}]]`;
  });

/** A link target's name and folders: `Projects/Plan` → name `plan` (no `.md`), folders `projects`, lower case. */
export function wikiTarget(target: string): { name: string; dirs: string[] } {
  const parts = target.split("#")[0]!.split("/").filter(Boolean).map((p) => p.toLowerCase());
  return { name: (parts.pop() ?? "").replace(/\.(md|markdown|txt|note\.html)$/, ""), dirs: parts };
}

/** The links a note's words hold: `[[targets]]` (embeds too) and paths or `canvast:` links as written (pictures, files, other notes). */
export function noteLinks(kind: NoteKind, text: string): { wiki: string[]; paths: string[] } {
  const wiki: string[] = [];
  const paths: string[] = [];
  if (kind === "md") {
    outsideCode(text, (s) => {
      for (const m of s.matchAll(/!?\[\[([^\[\]|\n#]+?)(?:#[^\[\]|\n]*)?(?:\|[^\[\]\n]*)?\]\]/g)) wiki.push(m[1]!.trim());
      for (const m of s.matchAll(LINK)) if (!m[2]!.startsWith(WIKI)) paths.push(plainAddress(m[2]!));
      for (const m of s.matchAll(/\s(?:src|href)="([^"]+)"/g)) paths.push(m[1]!);
      return s;
    });
  } else if (kind === "rich") for (const m of text.matchAll(/\s(?:src|href)="([^"]+)"/g)) paths.push(m[1]!.replace(/&amp;/g, "&"));
  return { wiki, paths };
}

/**
 * A note's words with its links to an item that was renamed or moved written again: `[[old name]]` (when that name was the item's
 * alone) becomes `[[new name]]` (a shown text kept), and a path written to its old place becomes the path to the new one.
 */
export function relinkNote(kind: NoteKind, text: string, change: { oldWiki: string | null; newWiki: string; oldPath: string; newPath: string }): string {
  let out = text;
  if (kind === "md" && change.oldWiki) {
    const old = change.oldWiki.toLowerCase();
    out = outsideCode(out, (s) =>
      s.replace(/(!?)\[\[([^\[\]|\n#]+?)((?:#[^\[\]|\n]*)?(?:\|[^\[\]\n]*)?)\]\]/g, (m, bang: string, t: string, rest: string) => (wikiTarget(t).name === old || t.trim().toLowerCase() === old ? `${bang}[[${change.newWiki}${rest}]]` : m)),
    );
  }
  if (change.oldPath && change.oldPath !== change.newPath) {
    // (written by hand or before brackets were encoded: `cat%20(2).png`, `<my cat.png>`)
    const esc = change.oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%28/g, "(?:%28|\\()").replace(/%29/g, "(?:%29|\\))").replace(/%20/g, "(?:%20| )");
    out = out.replace(new RegExp(`(\\]\\(<?|\\s(?:src|href)=")${esc}(?=[)>"\\s#?])`, "g"), (_m, open: string) => `${open}${change.newPath}`);
  }
  return out;
}

/** The alignment of each column of a table, as its markdown separator row writes it. */
export type ColumnAligns = ReadonlyArray<"left" | "center" | "right" | null>;

/**
 * SunEditor's markdown, made as Obsidian writes it: a `]` (and a `^` when a line has two) is not escaped, so footnotes (`[^1]`, `[^1]:`)
 * and embeds or links kept as written (`![[cat.png]]`) stay what they were; a `]` before `(` stays escaped (it would make a link of the
 * words). Code (fenced blocks, `spans`) is left as it is. `aligns`: each table's column alignment, in order (the writer drops it).
 */
export function obsidianMarkdown(md: string, aligns: readonly ColumnAligns[] = []): string {
  let table = 0;
  // (a fenced code block: its words as they were, its fence longer than a fence inside it)
  const block = (b: string): string => {
    const code = unpackInfo(b);
    if (!code.includes(FENCE_TICK)) return code;
    const longest = Math.max(...[...code.matchAll(new RegExp(`^${FENCE_TICK}{3,}`, "gm"))].map((m) => m[0].length), 3);
    return code.replace(new RegExp(FENCE_TICK, "g"), "`").replace(/^```/, "`".repeat(longest + 1)).replace(/```[ \t]*$/, "`".repeat(longest + 1));
  };
  return outsideFences(md, (part) => part
        .split(/(`[^`\n]*`)/)
        .map((bit, j) =>
          j % 2
            ? bit
            : bit
                .replace(/\\\](?!\()/g, "]")
                .replace(/\\\^/g, "^")
                .replace(/(?<=\S[ \t]+)\\\*(?=[ \t])/g, "*") // (a `*` standing alone needs no escape)
                .replace(/(?<!\\)\\\n/g, "\n") // (a line break is a new line, as Obsidian shows and writes it)
                .replace(/\[((?:https?:\/\/|mailto:)[^\]\s]+)\]\(\1\)/g, "$1") // (an address written as it is stays so)
                .replace(/<em>([^<\n]*)<\/em>/g, "*$1*") // (the writer's inside a table)
                .replace(/<strong>([^<\n]*)<\/strong>/g, "**$1**"),
        )
        .join("")
        .replace(/(?:^(?:> ?)+[ \t]*\n)+(?=\n)/gm, "") // (a quote's empty last lines)
        .replace(/(?:\n(?:> ?)+[ \t]*)+(?=\n*$)/, "")
        .replace(/^\|.*\|[ \t]*$/gm, (row) => row.replace(/\u00a0/g, " ")) // (the space kept between marked words in a cell)
        .replace(/^(?=[^\n]*\|)(\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?)[ \t]*$/gm, (row) => {
          const a = aligns[table++];
          if (!a?.some(Boolean)) return row;
          const cells = row.replace(/^\|/, "").replace(/\|$/, "").split("|");
          const sep = cells.map((_c, k) => (a[k] === "center" ? ":---:" : a[k] === "right" ? "---:" : a[k] === "left" ? ":---" : "---"));
          return `| ${sep.join(" | ")} |`;
        }), block);
}

/** A markdown text's blocks (parted by empty lines, a code block whole), each with the empty lines after it. */
function blocksOf(text: string): Array<{ text: string; after: string }> {
  const out: Array<{ text: string; after: string }> = [];
  let cur: string[] = [];
  let fence = "";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1];
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? "" : f;
    if (fence || line.trim()) {
      cur.push(line);
      continue;
    }
    let after = "\n";
    while (i + 1 < lines.length && !lines[i + 1]!.trim()) after += `${lines[++i]}\n`;
    if (cur.length) out.push({ text: cur.join("\n"), after: `\n${after}` });
    cur = [];
  }
  if (cur.length) out.push({ text: cur.join("\n"), after: "" });
  return out;
}

/**
 * The note as the editor writes it now, with every part not changed since `canon` (how the editor wrote `file` when it read it) in `file`'s own
 * spelling, so that a save changes only what was edited: `*` lists, `__bold__`, spacing and the like stay as they were.
 */
export function keepSpelling(now: string, canon: string, file: string): string {
  if (now.trim() === canon.trim()) return file;
  const key = (t: string): string => t.replace(/%[0-9A-Fa-f]{2}|<[^>\n]*>/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
  const was = blocksOf(file);
  const can = blocksOf(canon);
  // Which of the editor's blocks are which of the file's (one may be several of the other).
  const groups: Array<{ canon: string[]; file: string; after: string }> = [];
  for (let i = 0, j = 0; i < was.length && j < can.length; ) {
    const si = i;
    const sj = j;
    let a = key(was[i++]!.text);
    let b = key(can[j++]!.text);
    while (a !== b && (a.startsWith(b) || b.startsWith(a))) {
      if (a.length < b.length && i < was.length) a += key(was[i++]!.text);
      else if (b.length < a.length && j < can.length) b += key(can[j++]!.text);
      else break;
    }
    if (a !== b) {
      // (written differently, `[[a|a]]` for `[[a]]`: paired while as many are left on both sides, else the rest keeps the editor's spelling)
      if (was.length - si !== can.length - sj) break;
      i = si + 1;
      j = sj + 1;
    }
    groups.push({ canon: can.slice(sj, j).map((x) => x.text), file: was.slice(si, i).map((x, k, l) => x.text + (k < l.length - 1 ? x.after : "")).join(""), after: was[i - 1]!.after });
  }
  const parts = blocksOf(now);
  let out = "";
  for (let p = 0; p < parts.length; ) {
    const g = groups.find((x) => x.canon.every((c, k) => parts[p + k]?.text === c));
    const last = p + (g?.canon.length ?? 1) >= parts.length;
    out += (g ? g.file : parts[p]!.text) + (last ? "" : g?.after || "\n\n");
    p += g?.canon.length ?? 1;
  }
  return `${out}${/\n$/.test(file) || !file ? "\n" : ""}`;
}
