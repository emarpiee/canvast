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
import { SEAL_OVERHEAD, isHiddenFile } from "./hidden-vault";

export type FolderState = "none" | "ready" | "needs-permission" | "unavailable";

/** The part of FileSystemDirectoryHandle used here (and what the tests stand in for). */
export interface Dir {
  readonly name: string;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  /** The names in the folder (a real directory handle has it; the tests' stand-in too). */
  keys?(): AsyncIterable<string>;
  queryPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
}
interface FileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
}

export class FolderError extends Error {}

const META_KEY = "externalFolder";
/** The library index kept beside the files, hidden: the workspace without the bytes of the originals (ADR 0159). */
export const LIBRARY_FILE = ".canvast-index";
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

/** How the folder names its files: by hash in the browser's library folder, readable in a workspace folder (ADR 0177). */
export interface FolderNaming {
  /** The file for a new original; `taken` says whether a file already has that name. */
  fileFor(hash: string, name: string, type: string, taken: (file: string) => Promise<boolean>): Promise<string>;
  /** Whether a stored file name is one this folder may read, write or remove for that hash. */
  valid(hash: string, file: string): boolean;
  /** Where the library index is kept. */
  indexFile: string;
}

/** The browser's library folder (ADR 0159): `<sha256>.<ext>` beside the hidden library index. */
export const HASH_NAMING: FolderNaming = {
  fileFor: async (hash, name, type) => folderFileName(hash, name, type),
  valid: (hash, file) => FILE_RE.test(file) && file.startsWith(hash),
  indexFile: LIBRARY_FILE,
};

export function folderSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

class ExternalFolder {
  private dir: Dir | null = null;
  private status: FolderState = "none";
  /** How files are named (set once at start-up: the desktop build names them readably). */
  naming: FolderNaming = HASH_NAMING;

  /**
   * The file for a new original, free in the folder, and claimed until `release` (after its stub is stored): a new original
   * and a file the workspace folder moves (ADR 0177) never take the same free name at once.
   */
  async fileFor(hash: string, name: string, type: string): Promise<string> {
    for (;;) {
      const file = await this.naming.fileFor(hash, name, type, async (file) => this.claimed(file) || (await this.exists(file)));
      // (Readable names: claimed by another while this one was looking. Hash names are the same file for the same bytes.)
      if (this.naming !== HASH_NAMING && this.claimed(file)) continue;
      this.claims.add(file.toLowerCase());
      return file;
    }
  }
  private readonly claims = new Set<string>();
  claimed(file: string): boolean {
    return this.claims.has(file.toLowerCase());
  }
  /** Claim a free file name for a move; false when it is claimed already. */
  claim(file: string): boolean {
    if (this.claimed(file)) return false;
    this.claims.add(file.toLowerCase());
    return true;
  }
  release(file: string): void {
    this.claims.delete(file.toLowerCase());
  }
  /** Whether the folder has a file of that name. */
  async exists(file: string): Promise<boolean> {
    try {
      await this.dir?.getFileHandle(file);
      return !!this.dir;
    } catch {
      return false;
    }
  }
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
  /** The folder changed in a way a card should redraw for (the library index was written). */
  touch(): void {
    for (const fn of this.savedListeners) fn();
  }
  private readonly savedListeners = new Set<() => void>();
  subscribeSaved(fn: () => void): () => void {
    this.savedListeners.add(fn);
    return () => this.savedListeners.delete(fn);
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

  /**
   * The desktop build's hidden items (ADR 0177): a file under `.hidden/` is sealed, and is read through this (null while the
   * key is locked). Unset elsewhere.
   */
  unseal: { open(blob: Blob): Promise<Blob | null>; ready(): boolean } | null = null;

  /** Tests only: a stand-in directory cannot be saved in the database (it has functions), so it is used for the session. */
  saveHandle = true;

  /** Ask the user for a folder (needs a click) and remember it. */
  async choose(db: IDBDatabase): Promise<void> {
    const pick = (window as unknown as { showDirectoryPicker: (o: { mode: "readwrite" }) => Promise<Dir> }).showDirectoryPicker;
    const dir = await pick.call(window, { mode: "readwrite" });
    if (this.saveHandle) await this.attach(db, dir);
    else await this.use(dir);
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
    if (!this.dir || !HASH_RE.test(hash) || !this.naming.valid(hash, file)) throw new FolderError("the library folder is not available");
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
    if (!this.dir || this.status !== "ready" || !this.naming.valid(hash, file)) return null;
    try {
      let f: Blob = await (await this.dir.getFileHandle(file)).getFile();
      if (isHiddenFile(file)) {
        const opened = this.unseal && f.size === size + SEAL_OVERHEAD ? await this.unseal.open(f) : null;
        if (!opened) return null;
        f = opened;
      }
      return f.size === size ? (type ? new Blob([f], { type }) : f) : null;
    } catch {
      return null;
    }
  }

  /** Does the file exist with this size (no bytes read; a sealed hidden file is checked by its sealed size, not opened). */
  async has(hash: string, size: number, file = hash): Promise<boolean> {
    if (!isHiddenFile(file)) return (await this.read(hash, size, "", file)) !== null;
    if (!this.dir || this.status !== "ready" || !this.naming.valid(hash, file)) return false;
    try {
      return (await (await this.dir.getFileHandle(file)).getFile()).size === size + SEAL_OVERHEAD;
    } catch {
      return false;
    }
  }

  /** Every file of the folder that is an original (named by hash, with or without an extension), with its size. */
  async list(): Promise<Map<string, { file: string; size: number }>> {
    const out = new Map<string, { file: string; size: number }>();
    if (!this.dir?.keys || this.status !== "ready") return out;
    const names: string[] = [];
    for await (const n of this.dir.keys()) if (FILE_RE.test(n)) names.push(n);
    for (let i = 0; i < names.length; i += 50) {
      await Promise.all(names.slice(i, i + 50).map(async (n) => {
        try {
          out.set(n.slice(0, 64), { file: n, size: (await (await this.dir!.getFileHandle(n)).getFile()).size });
        } catch {
          // gone while listing
        }
      }));
    }
    return out;
  }

  /** The library index, or null when the folder has none. */
  async readLibraryFile(): Promise<File | null> {
    if (!this.dir || this.status !== "ready") return null;
    try {
      return await (await this.dir.getFileHandle(this.naming.indexFile)).getFile();
    } catch {
      return null;
    }
  }

  /** Write the library index and read it back by size. */
  async writeLibraryFile(blob: Blob): Promise<void> {
    if (!this.dir || this.status !== "ready") throw new FolderError("the library folder is not available");
    try {
      const w = await (await this.dir.getFileHandle(this.naming.indexFile, { create: true })).createWritable();
      await w.write(blob);
      await w.close();
    } catch (e) {
      throw new FolderError(`the library index could not be written (${(e as Error).message || (e as Error).name})`);
    }
    if ((await this.readLibraryFile())?.size !== blob.size) throw new FolderError("the library index written to the folder did not read back the same");
  }

  /** Remove the file of an erased original. Nothing to do when it is not there. */
  async remove(hash: string, file = hash): Promise<void> {
    if (!this.dir || this.status !== "ready" || !this.naming.valid(hash, file)) return;
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
