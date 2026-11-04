/**
 * The rules for the names of files and folders, in one place: whatever makes, checks or numbers such a name calls these (`npm run check:name-rules`
 * fails on a rule written anywhere else). Pure. A name already on a disk is never judged by a newer rule: see `fitsWritten`.
 */

/** Longest name an item can have (only its file's name on disk is shorter: `cutBytes`). */
export const MAX_NAME = 1000;
/** Longest file name kept on disk, in UTF-8 bytes: under every system's 255-byte limit, with room for a `-99`. */
export const MAX_FILE_BYTES = 240;
/** Longest file base kept, in UTF-8 bytes (with room for `-99` and an extension of up to eight: the whole name under 255 bytes). */
export const MAX_BASE = MAX_FILE_BYTES - 10;

/** `s` cut to at most `max` UTF-8 bytes, never inside a character. */
export function cutBytes(s: string, max: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let out = "";
  let n = 0;
  for (const ch of s) {
    n += enc.encode(ch).length;
    if (n > max) break;
    out += ch;
  }
  return out;
}

/** A name and its extension (with the dot). An extension is up to eight letters or digits after the last dot of a name that has something before it. */
export function splitName(name: string): { stem: string; ext: string } {
  // (a rich text note's `.note.html` is one extension: the library knows a note by it, so a rename keeps it whole)
  const m = /^(.+?)(\.note\.html|\.[A-Za-z0-9]{1,8})$/i.exec(name);
  return m ? { stem: m[1]!, ext: m[2]! } : { stem: name, ext: "" };
}

// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;
/** Characters no one sees, that can disguise a name (`gnp.exe` shown backwards) or make two look alike. The joiners inside emoji and some scripts stay. */
const INVISIBLE = /[­​‎‏‪-‮⁠⁦-⁩﻿]/g;
/** Names Windows reserves for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
/** What a link in a note cannot hold (`[[a#b]]` is a heading of `a`): a note named so could not be linked to. */
const LINK_MARKS = /[#^[\]]+/g;
/** Endings of files on their way somewhere: never taken into the library from its folder. */
export const UNFINISHED_FILE = /\.tmp-|\.(tmp|part|partial|crdownload|download|!sync|sync-conflict)$/i;

/** What a system refuses, as `-`, and what no one sees, gone. */
export const replaceInvalid = (s: string): string => s.normalize("NFC").replace(INVISIBLE, "").replace(INVALID, "-");

/**
 * Words as a file's or folder's name, without an extension. `kept`: as written, only what a system forbids or a file cannot hold is changed. `clean`: lowercase, `_` joins
 * the words of one part, `-` separates parts. Never empty, never a reserved name, never starts with a dot.
 */
export function cleanName(words: string, style: "kept" | "clean", fallback = "file"): string {
  let s =
    style === "kept"
      ? replaceInvalid(words).replace(/^[\s.]+|[\s.]+$/g, "")
      : words
          .normalize("NFC")
          .replace(INVISIBLE, "")
          .toLowerCase()
          .replace(/[()[\]{},;:+&|]+/g, " - ") // brackets and lists separate parts
          .replace(/\s+-\s+|\s*[–—]\s*/g, "-") // a spaced dash separates parts
          .replace(/\s+/g, "_") // words of one part
          .replace(/[^\p{L}\p{N}_.-]+/gu, "") // nothing a system forbids or that reads badly
          .replace(/_*-[-_]*/g, "-")
          .replace(/_+/g, "_")
          .replace(/\.{2,}/g, ".")
          .replace(/^[-_.]+|[-_.]+$/g, "");
  const cut = cutBytes(s, MAX_BASE);
  if (cut !== s) s = cut.replace(style === "kept" ? /[\s.]+$/ : /[-_.]+$/, "");
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = `${s}_file`;
  return s;
}

/** A note's words as its file's name: `cleanName`, and nothing a link to it could not hold. */
export const cleanNoteName = (words: string, style: "kept" | "clean"): string => cleanName(style === "kept" ? words.replace(LINK_MARKS, "-") : words, style);

const isNoteName = (name: string): boolean => /\.(md|markdown|txt|note\.html)$/i.test(name);

/** A name typed for an item, extension and all: what it shows in the library, and so what its file is called. */
export function cleanItemName(name: string): string {
  const s = replaceInvalid(name).replace(/^[.\s]+|[.\s]+$/g, "");
  const { stem, ext } = splitName(isNoteName(s) ? s.replace(LINK_MARKS, "-") : s);
  return `${RESERVED.test(stem) ? `${stem}_file` : stem}${ext}`.slice(0, MAX_NAME);
}

/** A whole name with its extension for a file written elsewhere (an export, a file in a ZIP): cut to fit, the extension kept. */
export function cleanWholeName(raw: string, fallback: string): string {
  const cleaned = replaceInvalid(raw).replace(/^[.\s]+|[\s.]+$/g, "");
  const { stem, ext } = splitName(cleaned);
  const cut = cutBytes(cleaned, MAX_FILE_BYTES) === cleaned ? cleaned : `${cutBytes(stem, MAX_FILE_BYTES - new TextEncoder().encode(ext).length).trimEnd()}${ext}`;
  return cut || fallback;
}

/** The nth of a name when others have it: `a.png`, `a-2.png`, `a-3.png`. */
export const numberedName = (stem: string, n: number, ext = ""): string => (n <= 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`);

/** Whether `stem` is `base` numbered after a clash (`base-2`). `most`: a higher number is a word of the name (`Chapter-2024`), where that matters. */
export function isClashOf(stem: string, base: string, most = Number.POSITIVE_INFINITY): boolean {
  if (!stem.startsWith(`${base}-`)) return false;
  const n = stem.slice(base.length + 1);
  return /^(?:[2-9]|[1-9]\d+)$/.test(n) && Number(n) <= most;
}

/** `name` numbered free of `taken` (lower case keys, as some systems see them; a new one is added). */
export function freeNameIn(taken: Set<string>, name: string, prefix = ""): string {
  const { stem, ext } = splitName(name);
  for (let n = 1; ; n++) {
    const c = `${prefix}${numberedName(stem, n, ext)}`;
    if (!taken.has(c.toLowerCase())) {
      taken.add(c.toLowerCase());
      return c;
    }
  }
}

/** Whether two folders in one place would be one folder on a disk, under either rule and on any system. */
export const sameOnDisk = (a: string, b: string): boolean => cleanName(a, "clean") === cleanName(b, "clean") || cleanName(a, "kept").toLowerCase() === cleanName(b, "kept").toLowerCase();

/**
 * What a name written by someone earlier still counts as, so that no rule added later renames a file that was right when it was written: its letters as another system
 * composes them, an unseen character, a run of forbidden ones each made a `-`.
 */
export function fitsWritten(stem: string, name: string, base: string): boolean {
  const shown = stem.normalize("NFC").replace(INVISIBLE, "");
  if (shown === base || isClashOf(shown, base)) return true;
  // eslint-disable-next-line no-control-regex
  const older = name.normalize("NFC").replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-").replace(/^[\s.]+|[\s.]+$/g, "");
  return stem === older || isClashOf(stem, older);
}

/** Words of a name that work here but can bite elsewhere: said, not refused. Empty when there are none. */
export function nameWarnings(name: string): string[] {
  const out: string[] = [];
  if (UNFINISHED_FILE.test(name)) out.push("a file with this ending is taken for one still being written, and does not come back when the library is read again from its folder");
  if (/^[-~]/.test(name)) out.push("a name starting with - or ~ can be misread by other programs");
  if (/[%&;$`!']/.test(name)) out.push("% & ; $ ` ! and ' can need care in web addresses and scripts");
  if (!isNoteName(name) && /[#^[\]]/.test(name)) out.push("a link in a note cannot hold # ^ [ or ]");
  return out;
}
