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

/** The link from a note in folder `from` to the file at `to` (both inside the library), each part URL-encoded (`../Pictures/my%20cat.png`). */
export function relativeLink(from: readonly string[], to: readonly string[]): string {
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
  return [...Array<string>(from.length - same).fill(".."), ...to.slice(same).map(encodeURIComponent)].join("/");
}

/**
 * What a link in a note points at: `{ hash }` for the app's own link, `{ path }` (the parts of a library path) for a link relative to the
 * note, or null for anything else (a web address, an anchor in the page, a path from the root of the disk).
 */
export function linkTarget(link: string, noteDir: readonly string[]): { hash: string } | { path: string[] } | null {
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
  return path && { path };
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
// In the editor they are ordinary links to `canvast-wiki:<target>`; the markdown file keeps the `[[…]]`. (`![[…]]`, an embed, is left alone.)
export const WIKI = "canvast-wiki:";

/** `text` with `fn` run on the parts outside code (fenced blocks and inline code are left as they are). */
function outsideCode(text: string, fn: (part: string) => string): string {
  return text
    .split(/(^```[\s\S]*?^```[^\n]*$|^~~~[\s\S]*?^~~~[^\n]*$)/m)
    .map((block, i) => (i % 2 ? block : block.split(/(`+[^`\n]*?`+)/).map((s, j) => (j % 2 ? s : fn(s))).join("")))
    .join("");
}

/** A markdown note's `[[…]]` links as markdown links the editor shows (`[shown](canvast-wiki:target)`). */
export const wikiToLinks = (md: string): string =>
  outsideCode(md, (s) =>
    s.replace(/(?<!!)\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g, (_m, target: string, alias?: string) => {
      const t = target.trim();
      return `[${(alias ?? t.split("/").pop()!).replace(/[[\]]/g, "")}](${WIKI}${encodeURIComponent(t)})`;
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
      for (const m of s.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) if (!m[1]!.startsWith(WIKI)) paths.push(m[1]!);
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
    const esc = change.oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(\\]\\(<?|\\s(?:src|href)=")${esc}(?=[)>"\\s#?])`, "g"), `$1${change.newPath}`);
  }
  return out;
}
