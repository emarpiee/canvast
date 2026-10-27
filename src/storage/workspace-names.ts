/**
 * Names on disk in a workspace folder (ADR 0177): readable, safe on every system, and in the naming convention:
 * lowercase, `_` joins the words of one part, `-` separates parts (`Hand Study (Loomis).JPG` → `hand_study-loomis.jpg`).
 * The name shown in the app stays what was typed; only the file's name is made safe.
 */
import { extOf } from "../assets/file-kind";
import type { FolderNaming } from "./external-folder";

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
  const dir = `library/${kindFolder(type, name)}`;
  const base = safeBase(name.replace(/\.[A-Za-z0-9]{1,8}$/, ""));
  const ext = fileExt(name, type);
  for (let n = 1; n < 10_000; n++) {
    const path = `${dir}/${n === 1 ? base : `${base}-${n}`}.${ext}`;
    if (!(await taken(path))) return path;
  }
  throw new Error("no free file name");
}

/** A relative path inside a workspace: `/`-separated, no empty, `.` or `..` part, no backslash or NUL, not absolute. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 1024 || path.startsWith("/") || /[\\\0]/.test(path)) return false;
  return path.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

/** Originals as `library/<kind>/<name>.<ext>`; the library index in the app's own `.canvast/` folder. */
export const WORKSPACE_NAMING: FolderNaming = {
  fileFor: (_hash, name, type, taken) => libraryPath(name, type, taken),
  valid: (_hash, file) => isSafeRelativePath(file) && file.startsWith("library/"),
  indexFile: ".canvast/library-index.canvast",
};
