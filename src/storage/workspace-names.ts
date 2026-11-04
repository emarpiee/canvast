/**
 * Names on disk in a workspace folder (ADR 0177): readable, safe on every system, and in the naming convention:
 * lowercase, `_` joins the words of one part, `-` separates parts (`Hand Study (Loomis).JPG` → `hand_study-loomis.jpg`).
 * The name shown in the app stays what was typed; only the file's name is made safe.
 */
import { extOf } from "../assets/file-kind";
import { MAX_BASE as BASE_BYTES, cleanName, fitsWritten, isClashOf, numberedName } from "../doc/file-names";
import type { FolderNaming } from "./external-folder";
import { isHiddenFile } from "./hidden-vault";

/** Longest file base kept, in UTF-8 bytes (with room for `-99` and an extension of up to eight: the whole name under 255 bytes). */
export const MAX_BASE = BASE_BYTES;

/** A display name as a safe file base, without extension. Never empty, never a reserved name, never starts with a dot. */
export const safeBase = (name: string): string => cleanName(name, "clean");

/**
 * A file's name kept as written (Settings: Keep file names): only what a system forbids or a file cannot hold is changed: `<>:"/\\|?*` and control
 * characters become `-`, dots and spaces at the ends go (a leading dot would hide the file), and a name reserved on some systems gets `_file`.
 */
export const keptBase = (name: string): string => keptPart(name.replace(/\.[A-Za-z0-9]{1,8}$/, ""));

/** A folder's or file's name kept as written: see `keptBase`. */
export const keptPart = (name: string): string => cleanName(name, "kept");

/** The folder of `library/` for an original that is in no library folder, by its kind. */
export function kindFolder(type: string, name: string): string {
  if (/\.note\.html$/i.test(name)) return "notes";
  const byExt = KIND_OF_EXT[extOf(name).toLowerCase()];
  if (byExt) return byExt;
  if (/^image\//.test(type)) return "images";
  if (/^video\//.test(type)) return "video";
  if (/^audio\//.test(type)) return "audio";
  if (/^font\//.test(type)) return "fonts";
  if (/^(application\/pdf|text\/)/.test(type)) return "documents";
  return "other";
}

/** The kind folder of a file by its extension, first (a .psd or .ai is an art file, not a picture, whatever type a browser gives it). */
const KIND_EXTS: Record<string, readonly string[]> = {
  vectors: ["svg", "svgz", "eps"],
  icons: ["ico", "icns", "cur"],
  art_sources: ["psd", "psb", "kra", "xcf", "clip", "csp", "procreate", "sai", "sai2", "ai", "afphoto", "afdesign", "afpub", "pdn", "ora", "fig", "sketch", "xd", "mdp"],
  presets: ["abr", "kpp", "bundle", "brushset", "brush", "sut", "ase", "aco", "gpl", "ggr", "swatches", "pat"],
  "3d": ["obj", "fbx", "glb", "gltf", "stl", "blend", "usdz", "usd", "3mf", "ply", "dae", "3ds"],
  archives: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst"],
  fonts: ["ttf", "otf", "woff", "woff2", "ttc"],
  notes: ["md", "markdown", "txt"],
  documents: ["pdf", "doc", "docx", "odt", "rtf", "csv", "xls", "xlsx", "ods", "ppt", "pptx", "odp", "epub", "html", "htm", "json"],
};
const KIND_OF_EXT: Record<string, string> = Object.fromEntries(Object.entries(KIND_EXTS).flatMap(([k, exts]) => exts.map((e) => [e, k])));

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/vnd.microsoft.icon",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
};
/** The type of a file by its extension (a file found in the workspace folder has no other), else "application/octet-stream". */
export const typeOfName = (name: string): string => TYPES[extOf(name).toLowerCase()] ?? "application/octet-stream";

/** The extension a file's first bytes say it has (a hidden file found with no entry has no name to tell), else "bin". */
export function extOfBytes(b: Uint8Array): string {
  const at = (i: number, ...v: number[]): boolean => v.every((x, k) => b[i + k] === x);
  const text = (i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n));
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (text(0, 4) === "GIF8") return "gif";
  if (text(0, 4) === "RIFF") return text(8, 4) === "WEBP" ? "webp" : text(8, 4) === "WAVE" ? "wav" : "bin";
  if (text(4, 4) === "ftyp") return /^(avif|avis)/.test(text(8, 4)) ? "avif" : text(8, 2) === "qt" ? "mov" : /^M4A/.test(text(8, 4)) ? "m4a" : "mp4";
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "webm";
  if (text(0, 2) === "BM") return "bmp";
  if (text(0, 4) === "%PDF") return "pdf";
  if (text(0, 3) === "ID3" || at(0, 0xff, 0xfb)) return "mp3";
  if (text(0, 4) === "OggS") return "ogg";
  if (text(0, 4) === "fLaC") return "flac";
  if (text(0, 4) === "wOFF") return "woff";
  if (text(0, 4) === "wOF2") return "woff2";
  if (text(0, 4) === "OTTO") return "otf";
  if (at(0, 0, 1, 0, 0)) return "ttf";
  if (text(0, 4) === "PK\u0003\u0004") return "zip";
  if (/<svg[\s>]/.test(new TextDecoder().decode(b.subarray(0, 1024)))) return "svg";
  return "bin";
}

/** The kind folders of `library/` (an item in no library folder is in one of these). */
export const KIND_FOLDERS: ReadonlySet<string> = new Set(["images", "vectors", "icons", "art_sources", "presets", "3d", "video", "audio", "fonts", "notes", "documents", "archives", "other"]);

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
  const keep = nameRules.keep();
  const kept = keep ? keptFile(name, "", type) : null;
  return freePath(`library/${kindFolder(type, name)}`, kept ? kept.base : nameBase(name), kept ? kept.ext : fileExt(name, type), taken);
}

/** Settings > Keep file names as written: a new file takes its name as written, else its tidy name. */
export const nameRules: { keep: () => boolean } = { keep: () => false };

/** A library name's safe base, without its extension. */
export const nameBase = (name: string): string => safeBase(name.replace(/\.[A-Za-z0-9]{1,8}$/, ""));

/** The first of `<dir>/<base>.<ext>`, `<dir>/<base>-2.<ext>`… that is not taken. */
export async function freePath(dir: string, base: string, ext: string, taken: (path: string) => Promise<boolean>): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const path = `${dir}/${numberedName(base, n, ext ? `.${ext}` : "")}`;
    if (!(await taken(path))) return path;
  }
  throw new Error("no free file name");
}

/** Whether `path` is `<dir>/<base>.<ext>` or one of its numbered forms (`-2`…): the place is still right for that name. */
export function fitsPlace(path: string, dir: string, base: string, ext: string): boolean {
  if (!path.startsWith(`${dir}/`) || !path.endsWith(`.${ext}`)) return false;
  const stem = path.slice(dir.length + 1, path.length - ext.length - 1);
  return stem === base || isClashOf(stem, base) || stem.normalize("NFC") === base || isClashOf(stem.normalize("NFC"), base);
}

/**
 * Whether a folder on disk is the place of this library folder under another spelling: `library/A- B` and `library/a-b` are both read as one library folder,
 * and a file in either is where it belongs.
 */
export function isFolderOf(dir: string, names: readonly string[]): boolean {
  const parts = dir.split("/").slice(1);
  return names.length > 0 && parts.length === names.length && parts.every((p, i) => cleanName(p, "clean") === cleanName(names[i]!, "clean"));
}

/** Longest library folder path kept on disk; a deeper one files its items under their kind folder (paths stay well inside every system's limit). */
export const MAX_LIBRARY_DIR = 800;

/**
 * The folder of `library/` an item belongs in (ADR 0177, "library.json"): the path of its library folder, each part a safe
 * name (`["Refs", "Hands?"]` → `library/refs/hands`), or its kind folder when it is in none. A library folder named like a
 * kind folder shares it on disk.
 */
export function libraryDir(folderNames: readonly string[], type: string, name: string): string {
  const dir = ["library", ...folderNames.map(safeBase)].join("/");
  return folderNames.length && dir.length <= MAX_LIBRARY_DIR ? dir : `library/${kindFolder(type, name)}`;
}

/**
 * Keep file names: whether a file already fits its item where it lies: in one of `dirs`, under the item's name as written (`-2` on a clash), with
 * the extension the name has, or none when it has none.
 */
export function keptFits(path: string, dirs: readonly string[], name: string, type = ""): boolean {
  const at = path.lastIndexOf("/");
  if (!dirs.includes(path.slice(0, at))) return false;
  const file = path.slice(at + 1);
  const whole = /\.([A-Za-z0-9]{1,8})$/.exec(file)?.[1] ?? "";
  const kept = keptFile(name, whole, type);
  // As it should be: what the name says, in the file's real type.
  const fileStem = !kept.ext ? file : file.toLowerCase().endsWith(`.${kept.ext.toLowerCase()}`) ? file.slice(0, -kept.ext.length - 1) : null;
  if (fileStem !== null && (fileStem === kept.base || isClashOf(fileStem, kept.base))) return true;
  // As it was written by an earlier version: still right, never renamed for it.
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? "";
  if (ext ? file.slice(-ext.length).toLowerCase() !== ext.toLowerCase() : false) return false;
  return fitsWritten(ext ? file.slice(0, -ext.length) : file, name, keptBase(name));
}

const COMMON_EXTS = ["png", "jpg", "jpeg", "jfif", "gif", "webp", "avif", "bmp", "tif", "tiff", "heic", "heif", "raw", "dng", "mp4", "m4v", "mov", "webm", "mkv", "avi", "mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus", "json", "xml", "js", "ts", "css", "yml", "yaml", "canvast", "bin"];
/** Whether words after a dot are an extension, not words of a name (`Scan v2.1`, `draft.final`): a kind of file this app knows. */
const isFileExt = (ext: string): boolean => !!KIND_OF_EXT[ext.toLowerCase()] || COMMON_EXTS.includes(ext.toLowerCase());

/**
 * Keep file names: the base and extension of an item's file. The extension is the file's real one, unless the name gives another kind of file: a dot in a name
 * is otherwise a part of the name, and `Scan v2.1` on a PNG is `Scan v2.1.png`.
 */
export function keptFile(name: string, current: string, type: string): { base: string; ext: string } {
  const named = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? "";
  if (named && !/^\d+$/.test(named) && (named.toLowerCase() === current.toLowerCase() || isFileExt(named))) return { base: keptBase(name), ext: named };
  // (the file's own, else what the library knows it is. Not known: no extension is made up, and what the name ends in stays: `x.7z.001`, `README`.)
  const known = /^(image|video|audio|font|text)\/|^application\/pdf$/.test(type) ? fileExt("", type) : "";
  const real = current && !/^\d+$/.test(current) ? current : known;
  return real ? { base: keptPart(name), ext: real } : { base: named ? keptBase(name) : keptPart(name), ext: named };
}

/** A relative path inside a workspace: `/`-separated, no empty, `.` or `..` part, no backslash or NUL, not absolute. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 1024 || path.startsWith("/") || /[\\\0]/.test(path)) return false;
  return path.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

/** Originals as `library/<kind>/<name>.<ext>`; the library index in the app's own `.canvast/` folder. */
export const WORKSPACE_NAMING: FolderNaming = {
  fileFor: (_hash, name, type, taken) => libraryPath(name, type, taken),
  // (a readable file someone put in `.hidden/`, or in a folder there, is taken where it lies, then sealed: never copied readable anywhere else)
  valid: (_hash, file) => (isSafeRelativePath(file) && (file.startsWith("library/") || (file.startsWith(".hidden/") && !file.startsWith(".hidden/thumbnails/")))) || isHiddenFile(file),
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
