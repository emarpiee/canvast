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
