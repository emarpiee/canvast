/**
 * The library folder (ADR 0159): originals kept as plain files in a folder the user picked, so a library can grow past
 * the browser's storage quota. Chromium only (File System Access API); elsewhere nothing here is offered.
 *
 * A file is named by its SHA-256 and written, read back and compared before the browser's copy is replaced by a stub
 * record (`ext: 1`, empty blob, same key in the `assets` store). So every key-based rule (present, usage, garbage
 * collection) works unchanged, and an original is never in neither place.
 */
import { sha256Hex } from "../assets/sha256";
import { extOf } from "../assets/file-kind";
import { done, idbGet, idbPut, req } from "./idb";

export type FolderState = "none" | "ready" | "needs-permission" | "unavailable";

/** The part of FileSystemDirectoryHandle used here (and what the tests stand in for). */
export interface Dir {
  readonly name: string;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
}
interface FileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
}

export class FolderError extends Error {}

const META_KEY = "externalFolder";
const HASH_RE = /^[0-9a-f]{64}$/;
/** A file of the folder: the hash, and an extension so other programs can open it. */
const FILE_RE = /^[0-9a-f]{64}(\.[a-z0-9]{1,8})?$/;

const TYPE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg", "image/vnd.microsoft.icon": "ico", "audio/mpeg": "mp3", "audio/x-wav": "wav", "video/quicktime": "mov", "application/x-zip-compressed": "zip", "text/plain": "txt" };

/** The name of an original's file in the folder: its hash and its own extension (from its name, else its type; "bin" when neither says). */
export function folderFileName(hash: string, name: string, type: string): string {
  const fromType = TYPE_EXT[type] ?? (/^(?:image|video|audio|font)\/([a-z0-9]{1,8})$/.exec(type)?.[1] ?? "");
  const ext = (extOf(name).toLowerCase() || fromType || "bin").replace(/[^a-z0-9]/g, "");
  return `${hash}.${ext || "bin"}`;
}

export function folderSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

class ExternalFolder {
  private dir: Dir | null = null;
  private status: FolderState = "none";
  private readonly listeners = new Set<() => void>();

  get state(): FolderState {
    return this.status;
  }
  get name(): string {
    return this.dir?.name ?? "";
  }
  /** True when new originals go to the folder. */
  get ready(): boolean {
    return this.status === "ready";
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(state: FolderState): void {
    this.status = state;
    for (const fn of this.listeners) fn();
  }

  /** Read the saved folder at start-up. It is "needs-permission" until the browser says it may write again. */
  async load(db: IDBDatabase): Promise<void> {
    try {
      const saved = await idbGet<{ handle: Dir } | undefined>(db, "meta", META_KEY);
      if (!saved?.handle) return this.set("none");
      this.dir = saved.handle;
      await this.checkPermission();
    } catch {
      this.set("unavailable");
    }
  }

  private async checkPermission(): Promise<void> {
    if (!this.dir) return this.set("none");
    try {
      const p = (await this.dir.queryPermission?.({ mode: "readwrite" })) ?? "granted";
      this.set(p === "granted" ? "ready" : "needs-permission");
    } catch {
      this.set("unavailable");
    }
  }

  /** Ask the user for a folder (needs a click) and remember it. */
  async choose(db: IDBDatabase): Promise<void> {
    const pick = (window as unknown as { showDirectoryPicker: (o: { mode: "readwrite" }) => Promise<Dir> }).showDirectoryPicker;
    const dir = await pick.call(window, { mode: "readwrite" });
    await this.attach(db, dir);
  }

  /** Use this directory as the library folder (what `choose` does after the picker; tests pass a private directory). */
  async attach(db: IDBDatabase, dir: Dir): Promise<void> {
    await idbPut(db, "meta", META_KEY, { handle: dir, name: dir.name });
    await this.use(dir);
  }

  /** Use the directory without saving it (a session only; the tests use this). */
  async use(dir: Dir | null): Promise<void> {
    this.dir = dir;
    await this.checkPermission();
  }

  /** After a restart the browser asks again once per session: needs a click. */
  async reconnect(): Promise<void> {
    if (!this.dir) return;
    try {
      await this.dir.requestPermission?.({ mode: "readwrite" });
    } finally {
      await this.checkPermission();
    }
  }

  /** Stop using the folder. The caller makes sure no original is left only in it. */
  async forget(db: IDBDatabase): Promise<void> {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").delete(META_KEY);
    await done(tx);
    this.dir = null;
    this.set("none");
  }

  /** Write the file, read it back and compare it with the hash. Throws when it cannot be proven stored. */
  async write(hash: string, blob: Blob, file = hash): Promise<void> {
    if (!this.dir || !HASH_RE.test(hash) || !FILE_RE.test(file) || !file.startsWith(hash)) throw new FolderError("the library folder is not available");
    try {
      const fh = await this.dir.getFileHandle(file, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      const back = await fh.getFile();
      if (back.size !== blob.size || (await sha256Hex(await back.arrayBuffer())) !== hash) {
        await this.dir.removeEntry(file).catch(() => undefined); // never leave a file that is not what its name says
        throw new FolderError("the file written to the library folder did not read back the same");
      }
    } catch (e) {
      if (e instanceof FolderError) throw e;
      throw new FolderError(`the library folder could not be written (${(e as Error).message || (e as Error).name}). Open the storage panel to reconnect it`);
    }
  }

  /**
   * The file when it is there with the stored size, else null (missing, moved, no permission). A file of the folder has
   * no extension, so the browser gives it no type: `type` (the original's) is put back, or an SVG would not show.
   */
  async read(hash: string, size: number, type = "", file = hash): Promise<Blob | null> {
    if (!this.dir || this.status !== "ready" || !FILE_RE.test(file) || !file.startsWith(hash)) return null;
    try {
      const f = await (await this.dir.getFileHandle(file)).getFile();
      return f.size === size ? (type ? new Blob([f], { type }) : f) : null;
    } catch {
      return null;
    }
  }

  /** Does the file exist with this size (no bytes read). */
  async has(hash: string, size: number, file = hash): Promise<boolean> {
    return (await this.read(hash, size, "", file)) !== null;
  }

  /** Remove the file of an erased original. Nothing to do when it is not there. */
  async remove(hash: string, file = hash): Promise<void> {
    if (!this.dir || this.status !== "ready" || !FILE_RE.test(file) || !file.startsWith(hash)) return;
    try {
      await this.dir.removeEntry(file);
    } catch {
      // already gone, or no permission: the file is only left over, never needed
    }
  }
}

export const externalFolder = new ExternalFolder();

/** Hashes whose original is a stub (kept in the folder), from the `ext` index. */
export async function externalHashes(db: IDBDatabase): Promise<string[]> {
  const tx = db.transaction("assets", "readonly");
  return (await req(tx.objectStore("assets").index("ext").getAllKeys())) as string[];
}

/** How many originals are kept in the folder (and how many of those still have a bare hash for a name) and how many in the browser's storage. */
export async function libraryCounts(db: IDBDatabase): Promise<{ inFolder: number; inBrowser: number; bareNames: number }> {
  const tx = db.transaction("assets", "readonly");
  const [all, stubs] = await Promise.all([req(tx.objectStore("assets").count()), req(tx.objectStore("assets").index("ext").getAll()) as Promise<Array<{ file?: string }>>]);
  return { inFolder: stubs.length, inBrowser: all - stubs.length, bareNames: stubs.filter((s) => !s.file).length };
}
