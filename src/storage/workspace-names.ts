/**
 * Names on disk in a workspace folder (ADR 0177): readable, safe on every system, and in the naming convention:
 * lowercase, `_` joins the words of one part, `-` separates parts (`Hand Study (Loomis).JPG` → `hand_study-loomis.jpg`).
 * The name shown in the app stays what was typed; only the file's name is made safe.
 */
import { extOf } from "../assets/file-kind";
import type { FolderNaming } from "./external-folder";
import { isHiddenFile } from "./hidden-vault";

/** Longest file base kept (well under every system's 255-byte limit, with room for `-99` and an extension). */
export const MAX_BASE = 100;

/** Names Windows reserves for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** A display name as a safe file base, without extension. Never empty, never a reserved name, never starts with a dot. */
export function safeBase(name: string): string {
  let s = name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[()[\]{},;:+&|]+/g, " - ") // brackets and lists separate parts
    .replace(/\s+-\s+|\s*[–—]\s*/g, "-") // a spaced dash separates parts
    .replace(/\s+/g, "_") // words of one part
    .replace(/[^\p{L}\p{N}_.-]+/gu, "") // nothing a system forbids (<>:"/\|?* and control characters) or that reads badly
    .replace(/_*-[-_]*/g, "-")
    .replace(/_+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  if (s.length > MAX_BASE) s = s.slice(0, MAX_BASE).replace(/[-_.]+$/, "");
  if (!s) s = "file";
  if (RESERVED.test(s)) s = `${s}_file`;
  return s;
}

/** The folder of `library/` for an original that is in no library folder, by its kind. */
export function kindFolder(type: string, name: string): string {
  if (/^image\//.test(type)) return "images";
  if (/^video\//.test(type)) return "video";
  if (/^audio\//.test(type)) return "audio";
  if (/^font\//.test(type) || /^(ttf|otf|woff2?)$/i.test(extOf(name))) return "fonts";
  if (/^(application\/pdf|text\/)/.test(type) || /^(pdf|txt|md|docx?|odt|rtf|csv)$/i.test(extOf(name))) return "documents";
  return "other";
}

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/vnd.microsoft.icon",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
};
/** The type of a file by its extension (a file found in the workspace folder has no other), else "application/octet-stream". */
export const typeOfName = (name: string): string => TYPES[extOf(name).toLowerCase()] ?? "application/octet-stream";

/** The kind folders of `library/` (an item in no library folder is in one of these). */
export const KIND_FOLDERS: ReadonlySet<string> = new Set(["images", "video", "audio", "fonts", "documents", "other"]);

/** A file's extension for its name and type: its own, else one from the type, else "bin". */
export function fileExt(name: string, type: string): string {
  const own = extOf(name).toLowerCase();
  if (own) return own;
  const sub = /^[a-z]+\/([a-z0-9.+-]+)$/.exec(type)?.[1] ?? "";
  const known: Record<string, string> = { jpeg: "jpg", "svg+xml": "svg", plain: "txt", quicktime: "mov", mpeg: "mp3", "x-wav": "wav" };
  const ext = (known[sub] ?? sub).replace(/[^a-z0-9]/g, "").slice(0, 8);
  return ext || "bin";
}

/**
 * A free path for a new original under `library/`: `library/<kind>/<safe base>.<ext>`, numbered `-2`, `-3`… when taken.
 * Every part is lower case, so two of these never differ only in case (which clashes on some systems).
 */
export async function libraryPath(name: string, type: string, taken: (path: string) => Promise<boolean>): Promise<string> {
  return freePath(`library/${kindFolder(type, name)}`, nameBase(name), fileExt(name, type), taken);
}

/** A library name's safe base, without its extension. */
export const nameBase = (name: string): string => safeBase(name.replace(/\.[A-Za-z0-9]{1,8}$/, ""));

/** The first of `<dir>/<base>.<ext>`, `<dir>/<base>-2.<ext>`… that is not taken. */
export async function freePath(dir: string, base: string, ext: string, taken: (path: string) => Promise<boolean>): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const path = `${dir}/${n === 1 ? base : `${base}-${n}`}.${ext}`;
    if (!(await taken(path))) return path;
  }
  throw new Error("no free file name");
}

/** Whether `path` is `<dir>/<base>.<ext>` or one of its numbered forms (`-2`…): the place is still right for that name. */
export function fitsPlace(path: string, dir: string, base: string, ext: string): boolean {
  if (!path.startsWith(`${dir}/`) || !path.endsWith(`.${ext}`)) return false;
  const stem = path.slice(dir.length + 1, path.length - ext.length - 1);
  return stem === base || (stem.startsWith(`${base}-`) && /^(?:[2-9]|[1-9]\d+)$/.test(stem.slice(base.length + 1)));
}

/** Longest library folder path kept on disk; a deeper one files its items under their kind folder (paths stay well inside every system's limit). */
const MAX_LIBRARY_DIR = 800;

/**
 * The folder of `library/` an item belongs in (ADR 0177, "library.json"): the path of its library folder, each part a safe
 * name (`["Refs", "Hands?"]` → `library/refs/hands`), or its kind folder when it is in none. A library folder named like a
 * kind folder shares it on disk.
 */
export function libraryDir(folderNames: readonly string[], type: string, name: string): string {
  const dir = ["library", ...folderNames.map(safeBase)].join("/");
  return folderNames.length && dir.length <= MAX_LIBRARY_DIR ? dir : `library/${kindFolder(type, name)}`;
}

/** A relative path inside a workspace: `/`-separated, no empty, `.` or `..` part, no backslash or NUL, not absolute. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 1024 || path.startsWith("/") || /[\\\0]/.test(path)) return false;
  return path.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

/** Originals as `library/<kind>/<name>.<ext>`; the library index in the app's own `.canvast/` folder. */
export const WORKSPACE_NAMING: FolderNaming = {
  fileFor: (_hash, name, type, taken) => libraryPath(name, type, taken),
  // (a readable file someone put in `.hidden/` is taken where it lies, then sealed: never copied readable anywhere else)
  valid: (_hash, file) => (isSafeRelativePath(file) && (file.startsWith("library/") || /^\.hidden\/[^/]+$/.test(file))) || isHiddenFile(file),
  indexFile: ".canvast/library-index.canvast",
};

/** A board's folder and its canvases' files in the workspace (ADR 0177): `workspace.json`'s `boards`. */
export interface PlacedBoard {
  id: string;
  name: string;
  folder: string;
  canvases: Array<{ id: string; name: string; file: string }>;
}

/**
 * Where the boards are: in the app's own folder, so canvas files (not meant to be edited by hand) are out of the way; the top of
 * the workspace shows `library/`, the files that are yours to browse and drop in (owner, 2026-10-28).
 */
export const BOARDS_DIR = ".canvast/boards";

/** A safe name that no earlier one (compared without case) took: `base`, `base-2`, `base-3`… */
function unique(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * Where each board and canvas is on disk: a board is a folder of `.canvast/boards/`, a canvas a `.cvst` file in it, both by their
 * safe names, in the workspace's order (the first of two equal names keeps it, the next gets `-2`). The same tree always gives the
 * same paths. (A workspace written before boards moved there has them at the top: the next write moves them in.)
 */
export function placeTree(boards: ReadonlyArray<{ id: string; name: string; canvases: ReadonlyArray<{ id: string; name: string }> }>): PlacedBoard[] {
  const folders = new Set<string>();
  return boards.map((b) => {
    const folder = `${BOARDS_DIR}/${unique(safeBase(b.name), folders)}`;
    const files = new Set<string>();
    return { id: b.id, name: b.name, folder, canvases: b.canvases.map((c) => ({ id: c.id, name: c.name, file: `${folder}/${unique(safeBase(c.name), files)}.cvst` })) };
  });
}
