import { percentOf } from "../text/markdown";
// Notes: the library files the notes editor opens (markdown and plain text) and how a note links to other library items. Pure: the
// editor itself is `ui/note-editor.ts` (on `markdown-editor/`).

export type NoteKind = "md" | "txt";

/** The kind of note a file is, by its name, or null when the notes editor does not open it. */
export function noteKindOf(name: string): NoteKind | null {
  const n = name.toLowerCase();
  if (n.endsWith(".md") || n.endsWith(".markdown")) return "md";
  if (n.endsWith(".txt") || isDataText(n)) return "txt";
  return null;
}

/** Text that is not a note but opens in the notes editor as plain text. A page (`.html`) stays out: it is shown as a file. */
const DATA_TEXT = /\.(json|csv|tsv|xml|yaml|yml|toml|ini|log|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|hpp|cs|php|sh|sql|tex)$/i;
export const isDataText = (name: string): boolean => DATA_TEXT.test(name);
/** Past this, such a file is a file: an editor, a preview and the search would each read all of it. */
export const DATA_TEXT_MAX = 5 * 1024 * 1024;
export const tooBigForNote = (name: string, size: number): boolean => isDataText(name) && size > DATA_TEXT_MAX;

/** Whether the notes editor opens this file. A data file only when small and in UTF-8: another encoding read as UTF-8 and saved would be damaged. */
export async function opensAsNote(name: string, blob: Blob): Promise<boolean> {
  if (!noteKindOf(name)) return false;
  if (!isDataText(name)) return true;
  if (blob.size > DATA_TEXT_MAX) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer());
    return true;
  } catch {
    return false;
  }
}

/** A new markdown note named `name` (Settings > Notes > New note name), its title the same. */
export const newNoteFile = (name: string): File => new File([`# ${name}\n\n`], `${name}.md`, { type: "text/markdown" });

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
export const encodeLinkPart = (part: string): string => encodeURIComponent(part).replace(/[()'!*]/g, percentOf);

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

// Links between notes as notes apps write them: `[[Plan]]`, `[[Plan|shown text]]`, `[[Projects/Plan]]` when two notes share a name.
// Where the app needs one as an address (opening it, a card's picture), it is `canvast-wiki:<target>`; the file keeps the `[[…]]`.
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

/** `text` with `fn` run on the parts outside code (fenced blocks and inline code are left as they are). */
export const outsideCode = (text: string, fn: (part: string) => string): string =>
  outsideFences(text, (block) => block.split(/(`+[^`\n]*?`+)/).map((s, j) => (j % 2 ? s : fn(s))).join(""));

/** The address of a markdown link as it may be written: `<with space.png>`, or with brackets that pair (`cat%20(2).png`). */
const LINK = /(\]\()(<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+"[^"\n]*")?\))/g;
/** A link's address with its spaces and brackets encoded, so that any reader finds its end. */
const plainAddress = (dest: string): string => (dest.startsWith("<") ? dest.slice(1, -1) : dest).replace(/[ ()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** What a `[[link]]` names an item by: a note without its extension, any other file by its whole name, in lower case. */
export const wikiKeyOf = (name: string): string => name.toLowerCase().replace(/\.(md|markdown|txt)$/, "");

export function wikiTarget(target: string): { name: string; dirs: string[] } {
  const parts = target.split("#")[0]!.split("/").filter(Boolean).map((p) => p.toLowerCase());
  return { name: wikiKeyOf(parts.pop() ?? ""), dirs: parts };
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
  }
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
