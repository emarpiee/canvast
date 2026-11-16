import { ZipError, crc32Blob, extraField, recordStart, zipDirectory } from "../storage/zip";
import type { ZipRecord } from "../storage/zip";
import { typeOfName } from "../storage/workspace-names";
import { extOf, isArchiveFile, isComicFile } from "./file-kind";
import { WrongPassword, aesInfo, winZipAesDecrypt, zipCryptoDecrypt } from "./zip-crypto";

/**
 * A ZIP (or a comic book, CBZ: a ZIP of its pages) read for viewing: its list from the directory alone, each file unpacked only when it is
 * asked for (stored or deflated, with or without a password). The backup format's own strict reader is `readZip` (storage/zip.ts); both read
 * the directory with `zipDirectory`.
 */

export { WrongPassword };

/** A password is needed to read this file. */
export class NeedsPassword extends Error {
  constructor() {
    super("This file has a password.");
  }
}

export { isArchiveFile, isComicFile };

/** The most one file inside may unpack to, to be shown or imported (all of it is in memory). */
export const MAX_UNPACKED = 1024 * 2 ** 20;
/** Pictures a browser shows by itself: the pages of a comic, and of any ZIP of pictures. */
const PAGE_EXTS = new Set(["PNG", "JPG", "JPEG", "GIF", "WEBP", "AVIF", "BMP"]);

export interface ArchiveEntry {
  /** Its whole path in the archive, folders apart by "/". */
  path: string;
  /** Its name, the last part of the path. */
  name: string;
  /** A folder (listed by itself or only by what is in it). */
  dir: boolean;
  size: number;
  /** When it was last changed, as the archive says (no time zone). */
  date: Date | null;
  type: string;
  locked: boolean;
  /** How it is packed, in words, when this view cannot unpack it ("" when it can). */
  unsupported: string;
  record: ZipRecord | null;
}

export interface Archive {
  /** Every file and folder, folders first, then by name as people count (page 2 before page 10). */
  entries: ArchiveEntry[];
  /** Its pictures in order: a comic's pages. */
  pages: ArchiveEntry[];
  /** Whether any file in it has a password. */
  locked: boolean;
  /** One file's bytes, unpacked (checked against its checksum). A password is asked for by `NeedsPassword` and refused by `WrongPassword`. */
  read(e: ArchiveEntry, password?: string): Promise<Blob>;
}

const METHODS: Record<number, string> = { 1: "Shrink", 6: "Implode", 9: "Deflate64", 12: "BZIP2", 14: "LZMA", 19: "LZ77", 93: "Zstandard", 95: "XZ", 96: "JPEG (WinZip)", 97: "WavPack", 98: "PPMd" };
const methodWords = (m: number): string => (m === 0 || m === 8 ? "" : `${METHODS[m] ?? `method ${m}`} (only stored and Deflate files open here)`);

/** Natural order: numbers by their value, letters without case. */
export const naturalOrder = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** What the operating system or a tool adds that is no file of the archive's own. */
const isClutter = (path: string): boolean => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i.test(path) || /(^|\/)\._/.test(path);

const dosDate = (date: number, time: number): Date | null => {
  if (!date) return null;
  const d = new Date((date >> 9) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Unpacks deflated bytes with the browser's own decompressor. */
async function inflate(bytes: Uint8Array | Blob): Promise<Blob> {
  const from = bytes instanceof Blob ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>]);
  return new Response(from.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
}

/** Opens a ZIP for viewing: reads its directory (throws a `ZipError` when it is none, or damaged). */
export async function openArchive(file: Blob): Promise<Archive> {
  const { records } = await zipDirectory(file, "any");
  const files: ArchiveEntry[] = [];
  const dirs = new Map<string, ArchiveEntry>();
  const addDir = (path: string, r: ZipRecord | null): void => {
    if (!path || dirs.has(path)) return;
    const name = path.split("/").pop()!;
    dirs.set(path, { path, name, dir: true, size: 0, date: r ? dosDate(r.date, r.time) : null, type: "", locked: false, unsupported: "", record: null });
    addDir(path.split("/").slice(0, -1).join("/"), null);
  };
  for (const r of records) {
    // A path cleaned of what could lead outside it: no leading slash, no "." or ".." parts, backslashes read as folders.
    const path = r.name.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").join("/");
    if (!path || isClutter(path)) continue;
    if (r.name.endsWith("/") || r.name.endsWith("\\")) {
      addDir(path, r);
      continue;
    }
    addDir(path.split("/").slice(0, -1).join("/"), null);
    const aes = r.method === 99 ? aesInfo(extraField(r.extra, 0x9901)) : null;
    const method = aes ? aes.method : r.method;
    const name = path.split("/").pop()!;
    files.push({ path, name, dir: false, size: r.usize, date: dosDate(r.date, r.time), type: typeOfName(name), locked: (r.flags & 1) === 1, unsupported: r.method === 99 && !aes ? "an unknown encryption" : (r.flags & 0x40) ? "strong encryption (PKWARE)" : methodWords(method), record: r });
  }
  const byName = (a: ArchiveEntry, b: ArchiveEntry): number => naturalOrder(a.path, b.path);
  const entries = [...[...dirs.values()].sort(byName), ...files.sort(byName)];
  const pages = files.filter((e) => PAGE_EXTS.has(extOf(e.name)) && !e.unsupported);

  const read = async (e: ArchiveEntry, password?: string): Promise<Blob> => {
    const r = e.record;
    if (!r) throw new ZipError(`"${e.path}" is a folder`);
    if (e.unsupported) throw new ZipError(`"${e.name}" is packed with ${e.unsupported}`);
    if (r.usize > MAX_UNPACKED) throw new ZipError(`"${e.name}" is too large to unpack here`);
    if (e.locked && password === undefined) throw new NeedsPassword();
    const start = await recordStart(file, r);
    if (start + r.csize > file.size) throw new ZipError(`"${e.name}" runs past the end of the archive`);
    const packed = file.slice(start, start + r.csize);
    const aes = r.method === 99 ? aesInfo(extraField(r.extra, 0x9901)) : null;
    let body: Uint8Array | Blob = packed;
    if (e.locked) {
      const bytes = new Uint8Array(await packed.arrayBuffer());
      body = aes ? await winZipAesDecrypt(bytes, password!, aes.keyBytes) : zipCryptoDecrypt(bytes, password!, r.flags & 8 ? (r.time >> 8) & 0xff : r.crc >>> 24);
    }
    const method = aes ? aes.method : r.method;
    const out = method === 8 ? await inflate(body) : body instanceof Blob ? body : new Blob([body as Uint8Array<ArrayBuffer>]);
    // The checksum: WinZip's AE-2 leaves it out (its authentication code, checked above, stands for it).
    if (!(aes?.version === 2) && (await crc32Blob(out)) !== r.crc) {
      if (e.locked && !aes) throw new WrongPassword(); // (the old encryption's check is one byte: a wrong password passes it once in 256)
      throw new ZipError(`"${e.name}" is damaged (its checksum does not match)`);
    }
    return new Blob([out], { type: e.type });
  };
  return { entries, pages, locked: files.some((e) => e.locked), read };
}

/** The names of the files in an archive, one a line: what the library's search finds it by. */
export async function archiveWords(file: Blob): Promise<string> {
  const a = await openArchive(file);
  return a.entries.map((e) => e.path).join("\n");
}

/** The picture a card of an archive shows: page `n` (from 1; a comic's cover by default), null when there is none, or it has a password. */
export async function archivePage(file: Blob, n = 1): Promise<Blob | null> {
  const a = await openArchive(file);
  const page = a.pages[Math.max(0, Math.min(a.pages.length - 1, n - 1))];
  return page && !page.locked ? a.read(page) : null;
}
