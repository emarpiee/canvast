/**
 * The library in the workspace folder (ADR 0177, "library.json"): every original is a file under `library/`, in the folder of
 * its library folder (`library/refs/hands/…`) or, in none, of its kind (`library/images/…`), named after its library name.
 * Filing an item in another folder or renaming it moves its file; the library's undo puts the name or folder back, so the
 * file moves back. Originals that came in with their bytes in the app's storage (a backup's import) are written out as files.
 * `.canvast/library.json` holds the entries (names, tags, folders, notes, fields, hash ↔ file) and the library folders.
 *
 * As with the canvases, IndexedDB stays the one place the app's logic works on; this only follows it, a moment later.
 */
import type { AssetField, AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import { FOLDERS_KEY, folderPath, meta, normalizeFields, normalizeNote, normalizeTags } from "../assets/asset-catalog";
import type { AssetRecord } from "../assets/asset-library";
import { storedStub } from "../assets/asset-library";
import type { DesktopBridge } from "./desktop-bridge";
import { externalFolder } from "./external-folder";
import type { HiddenVault } from "./hidden-store";
import { hiddenFileName, isHiddenFile } from "./hidden-vault";
import { sha256Hex } from "../assets/sha256";
import { done, idbGet, idbPut, req } from "./idb";
import { KIND_FOLDERS, fileExt, fitsPlace, freePath, isSafeRelativePath, libraryDir, nameBase, safeBase } from "./workspace-names";
import type { FolderFile } from "./store";

export const LIBRARY_JSON = ".canvast/library.json";
export const LIBRARY_JSON_FORMAT = "canvast-library";
/**
 * The library in parts (ADR 0179): `index.json` holds the library folders and names the parts; each part `items-<x>.json` holds the
 * items whose hash starts with `x` (16 parts), so a change rewrites one part, not the whole library, and a sync tool copies only it.
 */
export const LIBRARY_DIR = ".canvast/library";
export const LIBRARY_INDEX = `${LIBRARY_DIR}/index.json`;
export const LIBRARY_PART_FORMAT = "canvast-library-items";
const partPath = (key: string): string => `${LIBRARY_DIR}/items-${key}.json`;
const PART_KEYS = "0123456789abcdef".split("");
/** Up to this many items, `library.json` (the single file of earlier versions) is still written, so an older app keeps working on the workspace. */
export const COMPAT_MAX_ITEMS = 10_000;

/** One library item as `library.json` keeps it. */
export interface LibraryItem {
  hash: string;
  /** Its file in the workspace folder; null while the original is not stored as one. */
  file: string | null;
  name: string;
  type: string;
  size: number;
  pixelW: number;
  pixelH: number;
  importedAt: number;
  card?: true;
  duration?: number;
  frames?: number;
  tags: string[];
  favorite: boolean;
  hidden?: true;
  folderId: string | null;
  note: string;
  fields: AssetField[];
  state: "active" | "deleted";
}

export interface LibraryJson {
  format: typeof LIBRARY_JSON_FORMAT;
  version: 1;
  folders: AssetFolder[];
  items: LibraryItem[];
}

/** `.canvast/library/index.json`. */
export interface LibraryIndex {
  format: typeof LIBRARY_JSON_FORMAT;
  version: 2;
  folders: AssetFolder[];
  /** The parts there are (`0` … `f`): a part not named has no items. */
  parts: string[];
}

/** What this device last wrote or read of `library.json`: the folders and each item, as JSON (meta "libraryMirror"). */
interface LibraryState {
  folders: string;
  items: Record<string, string>;
}
const STATE_KEY = "libraryMirror";
/** The library file being moved (meta "libraryMoving"), so a move cut short is finished at start-up. */
interface Moving {
  hash: string;
  from: string;
  to: string;
}
const MOVING_KEY = "libraryMoving";
const HASH_RE = /^[0-9a-f]{64}$/;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
/** A file worth looking at: not hidden, not a file being written (the app's own temporary files, a sync tool's or a browser's partial ones). */
const usable = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return !name.startsWith(".") && !/\.tmp-|\.(tmp|part|partial|crdownload|download|!sync|sync-conflict)$/i.test(name) && !/^(thumbs\.db|desktop\.ini)$/i.test(name);
};
const parentOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));
/** A file's own extension (`library/images/x.png` → `png`), or "" when it has none. */
const extOfPath = (path: string): string => /\.([a-z0-9]{1,8})$/.exec(path.slice(path.lastIndexOf("/") + 1))?.[1] ?? "";

/** The item for an entry and its stored original (a stub names its file). Always the same key order, so two compare as text. */
export function itemOf(e: CatalogEntry, rec: AssetRecord | undefined): LibraryItem {
  const m = meta(e);
  return {
    hash: e.hash,
    file: rec?.ext && rec.file ? rec.file : null,
    name: e.name,
    type: e.type,
    size: e.size,
    pixelW: e.pixelW,
    pixelH: e.pixelH,
    importedAt: e.importedAt,
    ...(e.card ? { card: true as const } : {}),
    ...(rec?.duration !== undefined ? { duration: rec.duration } : {}),
    ...(rec?.frames !== undefined ? { frames: rec.frames } : {}),
    tags: m.tags,
    favorite: m.favorite,
    ...(m.hidden ? { hidden: true as const } : {}),
    folderId: m.folderIds[0] ?? null,
    note: m.note,
    fields: m.fields,
    state: e.state,
  };
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** An item read from the file, checked and in the stored form (the same as `itemOf` would give), or null when it is damaged. */
export function readItem(a: unknown): LibraryItem | null {
  if (!a || typeof a !== "object") return null;
  const r = a as Record<string, unknown>;
  if (typeof r.hash !== "string" || !HASH_RE.test(r.hash) || typeof r.name !== "string" || !r.name || typeof r.type !== "string" || !num(r.size) || !num(r.pixelW) || !num(r.pixelH)) return null;
  const file = typeof r.file === "string" && ((isSafeRelativePath(r.file) && r.file.startsWith("library/")) || isHiddenFile(r.file)) ? r.file : null;
  const fields = Array.isArray(r.fields) ? (r.fields as unknown[]).filter((f): f is AssetField => !!f && typeof (f as AssetField).key === "string" && typeof (f as AssetField).value === "string").map((f) => ({ key: f.key, value: f.value })) : [];
  try {
    return {
      hash: r.hash,
      file,
      name: r.name,
      type: r.type,
      size: r.size,
      pixelW: r.pixelW,
      pixelH: r.pixelH,
      importedAt: num(r.importedAt) ? r.importedAt : 0,
      ...(r.card === true ? { card: true as const } : {}),
      ...(num(r.duration) ? { duration: r.duration } : {}),
      ...(num(r.frames) ? { frames: r.frames } : {}),
      tags: normalizeTags(Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string") : []),
      favorite: r.favorite === true,
      ...(r.hidden === true ? { hidden: true as const } : {}),
      folderId: typeof r.folderId === "string" ? r.folderId : null,
      note: normalizeNote(typeof r.note === "string" ? r.note : ""),
      fields: normalizeFields(fields),
      state: r.state === "deleted" ? "deleted" : "active",
    };
  } catch {
    return null; // (too many tags, a note too long…)
  }
}

/** The library folders read from the file: well-formed ones only, a parent that is not there made none. */
function readFolders(a: unknown): AssetFolder[] {
  if (!Array.isArray(a)) return [];
  const out = (a as unknown[]).filter((f): f is AssetFolder => !!f && typeof (f as AssetFolder).id === "string" && typeof (f as AssetFolder).name === "string" && !!(f as AssetFolder).name.trim());
  const ids = new Set(out.map((f) => f.id));
  return out.map((f) => ({ id: f.id, name: f.name, parentId: typeof f.parentId === "string" && ids.has(f.parentId) && f.parentId !== f.id ? f.parentId : null }));
}

/** The entry an item from the file makes (what this device had of it, `prev`, gives only its deletion time). */
function entryOf(it: LibraryItem, prev: CatalogEntry | undefined): CatalogEntry {
  return {
    hash: it.hash,
    name: it.name,
    type: it.type,
    size: it.size,
    pixelW: it.pixelW,
    pixelH: it.pixelH,
    importedAt: it.importedAt,
    ...(it.card ? { card: true } : {}),
    state: it.state,
    deletedAt: it.state === "deleted" ? (prev?.deletedAt ?? Date.now()) : null,
    tags: it.tags,
    favorite: it.favorite,
    ...(it.hidden ? { hidden: true } : {}),
    folderIds: it.folderId ? [it.folderId] : [],
    ...(it.note ? { note: it.note } : {}),
    ...(it.fields.length ? { fields: it.fields } : {}),
  };
}

/** A part's text: one item per line, as in `library.json`. */
export function libraryPartText(items: readonly LibraryItem[]): string {
  return `{"format":"${LIBRARY_PART_FORMAT}","version":2,\n"items":[${items.length ? "\n" : ""}${items.map((i) => JSON.stringify(i)).join(",\n")}${items.length ? "\n" : ""}]}\n`;
}

/** `library.json`'s text: one item per line, so a sync tool or a diff shows what changed. */
export function libraryJsonText(folders: readonly AssetFolder[], items: readonly LibraryItem[], copy = false): string {
  return `{"format":"${LIBRARY_JSON_FORMAT}","version":1,${copy ? `"copyOf":"${LIBRARY_DIR}",` : ""}\n"folders":${JSON.stringify(folders)},\n"items":[${items.length ? "\n" : ""}${items.map((i) => JSON.stringify(i)).join(",\n")}${items.length ? "\n" : ""}]}\n`;
}

/**
 * What this device last knew of an item of `library.json`: a short fingerprint of its line (FNV-1a), not the line itself, so the record
 * kept of a big library stays small (it is written with each change).
 */
function seen(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** How many files only the app's storage holds are written into the folder at once. */
const PARALLEL_WRITES = 6;
/** How many of those files are written before the disk is asked, once, to store them (and the app's copies are let go). */
const SYNC_BATCH = 100;
/** A file written for an item only the app's storage held, before the app lets go of its copy. */
interface Written {
  hash: string;
  file: string;
  size: number;
}

export class LibraryMirror {
  private state: LibraryState = { folders: "", items: {} };
  /** The library folders' places on disk as last written (to remove the ones a rename or delete emptied). */
  private dirs = new Set<string>();
  /** `library.json` as last written or read (another text there was written by an older app). */
  private lastText = "";
  /** The parts as last written or read: their text, and the hashes each holds (an unchanged part is not read again). */
  private parts = new Map<string, { text: string; hashes: string[] }>();
  private lastPartsIndex = "";
  private lastIndex = "";
  private failing = false;
  /** Imports files found in `library/` that no item has (set by the app through `Storage.folderImports`). */
  importFiles: ((files: FolderFile[]) => Promise<void>) | null = null;
  /** Told when an item could not be moved or written, in plain words. */
  onNotice: ((text: string) => void) | null = null;
  /** Told how far a write of files is (files written or moved of all it has to), after each one; `total` 0 when it ended. */
  onProgress: ((done: number, total: number) => void) | null = null;

  constructor(
    private readonly db: IDBDatabase,
    private readonly bridge: DesktopBridge,
    private readonly vault: HiddenVault,
  ) {}

  /** At start-up: what another device changed in `library.json` is taken (new items, names, tags, folders, where each file is). */
  async start(): Promise<void> {
    this.state = (await idbGet<LibraryState>(this.db, "meta", STATE_KEY).catch(() => undefined)) ?? { folders: "", items: {} };
    await this.finishMove();
    await this.reread();
  }

  /**
   * Read `library.json`, and the hidden items' index when the hidden items are open, and take what changed. Also when the
   * hidden items are opened: what another device hid or changed among them is known only then.
   */
  async reread(): Promise<boolean> {
    const vault = await this.vault.state();
    const hiddenItems = async (): Promise<LibraryItem[]> => {
      if (vault !== "open") return [];
      try {
        const hidden = JSON.parse((await this.vault.readIndex()) ?? "[]") as unknown[];
        return Array.isArray(hidden) ? hidden.map(readItem).filter((i): i is LibraryItem => i !== null) : [];
      } catch {
        return []; // a damaged index: the hidden items here stay as they are
      }
    };
    let took = false;
    // The library in parts: only the parts whose text changed are read; the others' items are known to be there still.
    const indexBytes = await this.bridge.read(LIBRARY_INDEX);
    let index: Partial<LibraryIndex> | null = null;
    try {
      index = indexBytes ? (JSON.parse(new TextDecoder().decode(indexBytes)) as Partial<LibraryIndex>) : null;
    } catch {
      index = null; // damaged: written again from the app's storage
    }
    const hasParts = !!index && index.format === LIBRARY_JSON_FORMAT && index.version === 2 && Array.isArray(index.parts);
    if (index && hasParts) {
      const keys = index.parts!.filter((k): k is string => typeof k === "string" && PART_KEYS.includes(k));
      const items: LibraryItem[] = [];
      const present = new Set<string>();
      let whole = true;
      const parts = new Map<string, { text: string; hashes: string[] }>();
      for (const key of keys) {
        const bytes = await this.bridge.read(partPath(key));
        const text = bytes ? new TextDecoder().decode(bytes) : null;
        const was = this.parts.get(key);
        if (text !== null && was?.text === text) {
          parts.set(key, was);
          for (const h of was.hashes) present.add(h);
          continue;
        }
        let raw: { format?: unknown; items?: unknown } | null = null;
        try {
          raw = text === null ? null : (JSON.parse(text) as { format?: unknown; items?: unknown });
        } catch {
          raw = null;
        }
        if (!raw || raw.format !== LIBRARY_PART_FORMAT || !Array.isArray(raw.items)) {
          whole = false; // missing (a sync tool still bringing it) or damaged: nothing in it counts as erased
          continue;
        }
        const read = raw.items.map(readItem).filter((i): i is LibraryItem => i !== null);
        items.push(...read);
        for (const i of read) present.add(i.hash);
        parts.set(key, { text: text!, hashes: read.map((i) => i.hash) });
      }
      const hidden = await hiddenItems();
      items.push(...hidden);
      for (const i of hidden) present.add(i.hash);
      // (While the hidden items are locked, an item missing from the library may have been hidden elsewhere, not erased.)
      took = await this.adopt(readFolders(index.folders), items, whole && vault !== "locked" ? present : null);
      this.parts = parts;
    }
    // `library.json`: read when it is the only form (a workspace of an earlier version), or when an older app changed it since.
    const bytes = await this.bridge.read(LIBRARY_JSON);
    const text = bytes ? new TextDecoder().decode(bytes) : null;
    if (text === null || text === this.lastText) return took;
    let raw: Partial<LibraryJson>;
    try {
      raw = JSON.parse(text) as Partial<LibraryJson>;
    } catch {
      return took; // damaged: written again from the app's storage
    }
    this.lastText = text;
    if (raw.format !== LIBRARY_JSON_FORMAT || !Array.isArray(raw.items)) return took;
    // The copy this version keeps for older apps says so: with the parts there it is never read (a copy a sync tool brings after the
    // parts would be older than them). One without the mark was written by an older app: what it changed is taken.
    if (hasParts && (raw as { copyOf?: unknown }).copyOf === LIBRARY_DIR) return took;
    const items = raw.items.map(readItem).filter((i): i is LibraryItem => i !== null);
    items.push(...(await hiddenItems()));
    return (await this.adopt(readFolders(raw.folders), items, vault !== "locked" ? new Set(items.map((i) => i.hash)) : null)) || took;
  }

  /**
   * Take what changed in the file since this device last wrote or read it, where this device did not change the same thing
   * since (then its own version stays and is written back). An item the file no longer has was erased on another device: it is
   * deleted here too (the app's garbage collection erases it once nothing needs it, or brings it back if a canvas uses it).
   */
  /** Whether anything was taken. */
  /** `present`: every hash the library has (the items given and those of the parts not read again); null when it is not whole. */
  private async adopt(folders: AssetFolder[], items: LibraryItem[], present: ReadonlySet<string> | null): Promise<boolean> {
    let took = false;
    const tx = this.db.transaction(["assetCatalog", "assets", "meta"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const catalog = tx.objectStore("assetCatalog");
    const assets = tx.objectStore("assets");
    const known = this.state.items;

    const localFolders = (await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? [];
    const fileFolders = JSON.stringify(folders);
    if (fileFolders !== (this.state.folders || "[]")) {
      const localChanged = JSON.stringify(localFolders) !== (this.state.folders || "[]");
      // Both changed: this device's folders, and the ones the other device added.
      const knownIds = new Set((JSON.parse(this.state.folders || "[]") as AssetFolder[]).map((f) => f.id));
      const localIds = new Set(localFolders.map((f) => f.id));
      tx.objectStore("meta").put(localChanged ? [...localFolders, ...folders.filter((f) => !localIds.has(f.id) && !knownIds.has(f.id))] : folders, FOLDERS_KEY);
      this.state.folders = fileFolders;
      took = true;
    }

    for (const it of items) {
      const text = JSON.stringify(it);
      if (seen(text) === known[it.hash]) continue; // nothing new from the folder
      const e = await req(catalog.get(it.hash) as IDBRequest<CatalogEntry | undefined>);
      const rec = await req(assets.get(it.hash) as IDBRequest<AssetRecord | undefined>);
      if (e && seen(JSON.stringify(itemOf(e, rec))) !== (known[it.hash] ?? "")) continue; // changed here too: this device's stays
      catalog.put(entryOf(it, e));
      if (it.file && (!rec || rec.ext)) {
        const stub: AssetRecord = { hash: it.hash, type: it.type, size: it.size, name: rec?.name ?? it.name, pixelW: it.pixelW, pixelH: it.pixelH, blob: new Blob([]), importedAt: it.importedAt, ...(it.card ? { card: true } : {}), ...(it.duration !== undefined ? { duration: it.duration } : {}), ...(it.frames !== undefined ? { frames: it.frames } : {}), ext: 1, file: it.file };
        assets.put(storedStub(stub), it.hash);
      }
      known[it.hash] = seen(text);
      took = true;
    }
    for (const hash of present ? Object.keys(known) : []) {
      if (present!.has(hash)) continue;
      const e = await req(catalog.get(hash) as IDBRequest<CatalogEntry | undefined>);
      const rec = await req(assets.get(hash) as IDBRequest<AssetRecord | undefined>);
      if (e && seen(JSON.stringify(itemOf(e, rec))) !== known[hash]) continue; // changed here: kept
      if (e?.state === "active") catalog.put({ ...e, state: "deleted", deletedAt: Date.now() } satisfies CatalogEntry);
      delete known[hash];
      took = true;
    }
    tx.objectStore("meta").put(this.state, STATE_KEY);
    await committed;
    return took;
  }

  /**
   * Put each original where its folder and name say, write the ones only the app's storage holds, then `library.json`.
   * False when a file could not be moved or written (it is tried again with the next change).
   */
  async write(): Promise<boolean> {
    await this.finishMove();
    const read = await this.read();
    const { entries, recs, folders } = read;
    const folderOk = new Set(folders.map((f) => f.id));
    // Places kept: every file of an item that is not moved (deleted items stay where they are until they are erased).
    const taken = new Set<string>();
    const moves: Array<{ hash: string; from: string | null; dir: string; base: string; ext: string }> = [];
    const active = entries.filter((e) => e.state === "active").sort((a, b) => a.importedAt - b.importedAt || (a.hash < b.hash ? -1 : 1));
    const activeHashes = new Set(active.map((e) => e.hash));
    for (const r of recs.values()) if (r.ext && r.file && !activeHashes.has(r.hash)) taken.add(r.file.toLowerCase());
    const toSeal: string[] = [];
    for (const e of active) {
      const rec = recs.get(e.hash);
      if (!rec || (rec.ext && !rec.file)) continue; // no original stored (or a file named by its hash, from the browser's library folder)
      // Hidden: sealed into `.hidden/` (when the key is open); shown again: opened back into its place (the same).
      const sealed = rec.ext === 1 && isHiddenFile(rec.file);
      if (meta(e).hidden) {
        if (!sealed) toSeal.push(e.hash);
        continue;
      }
      if (sealed && !this.vault.dataKey) continue;
      const id = meta(e).folderIds[0];
      const dir = libraryDir(id && folderOk.has(id) ? folderPath(folders, id) : [], e.type, e.name);
      const ext = (rec.file && !sealed && extOfPath(rec.file)) || fileExt(rec.name, e.type); // (a sealed file's own is .bin)
      const base = nameBase(e.name);
      if (rec.file && fitsPlace(rec.file, dir, base, ext) && !taken.has(rec.file.toLowerCase())) taken.add(rec.file.toLowerCase());
      else moves.push({ hash: e.hash, from: rec.ext ? rec.file! : null, dir, base, ext });
    }
    // A file that moves keeps its old place until it has moved, so no two items ever pass through one name.
    for (const m of moves) if (m.from) taken.add(m.from.toLowerCase());
    const emptied = new Set<string>();
    const failed: string[] = [];
    const total = moves.length + toSeal.length;
    let done = 0;
    const step = (): void => this.onProgress?.(++done, total);
    // A move whose name another move still holds waits for it (undo puts two swapped files back exactly); a cycle takes the next free names.
    for (let pending = moves; pending.length; ) {
      const held = new Set(pending.flatMap((m) => (m.from ? [m.from.toLowerCase()] : [])));
      let ready: typeof moves = [];
      const wait: typeof moves = [];
      for (const m of pending) {
        const ideal = await freePath(m.dir, m.base, m.ext, async (p) => !held.has(p.toLowerCase()) && (taken.has(p.toLowerCase()) || externalFolder.claimed(p) || (await this.bridge.exists(p))));
        (held.has(ideal.toLowerCase()) ? wait : ready).push(m);
      }
      if (!ready.length) ready = wait.splice(0);
      // Files only the app's storage holds (a backup's import) are written several at a time: on a spinning disk each one waits for
      // the disk to confirm it, and the waits overlap. Moves stay one after another (one may need a name another frees).
      const writes = ready.filter((m) => !m.from);
      for (const m of ready) {
        if (!m.from) continue;
        await this.place(m, taken, emptied, failed);
        step();
      }
      // In batches: the files are written without waiting for the disk each time, then the disk is asked once to store them all,
      // and only then does the app's storage let go of its copies (one transaction), so stopping half-way loses nothing.
      for (let at = 0; at < writes.length; at += SYNC_BATCH) {
        const batch = writes.slice(at, at + SYNC_BATCH);
        const written: Written[] = [];
        let next = 0;
        const worker = async (): Promise<void> => {
          while (next < batch.length) {
            const m = batch[next++]!;
            if (await this.adoptWritten(m, taken)) step();
            else {
              const w = await this.writeNew(m, taken, failed);
              if (w) written.push(w);
              step();
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL_WRITES, batch.length) }, worker));
        await this.keepWritten(written);
      }
      pending = wait;
    }
    for (const hash of toSeal) {
      if (this.vault.dataKey) await this.seal(hash, failed);
      step();
    }
    if (total) this.onProgress?.(total, 0);
    // Library folders are real folders, even empty; the places a move or a rename emptied are removed.
    const wanted = new Set<string>();
    for (const f of folders) for (let d = libraryDir(folderPath(folders, f.id), "", ""); d.includes("/"); d = parentOf(d)) wanted.add(d);
    for (const d of wanted) await this.bridge.makeFolder(d);
    for (const d of [...emptied, ...this.dirs]) {
      for (let p = d; p.startsWith("library/") && !wanted.has(p); p = parentOf(p)) if (!(await this.bridge.removeEmptyFolder(p))) break;
    }
    this.dirs = wanted;
    const placedAll = total === 0; // (no file moved, sealed or written: the records are as they were read)
    await this.writeJson(placedAll ? read : undefined);
    if (failed.length && !this.failing) this.onNotice?.(`${failed.length === 1 ? "A library file" : `${failed.length} library files`} could not be moved to ${failed.length === 1 ? "its" : "their"} place in the workspace folder (${failed[0]}). ${failed.length === 1 ? "It is" : "They are"} tried again with the next change.`);
    this.failing = failed.length > 0;
    return !this.failing;
  }

  /**
   * Look through `library/` for files the app did not put there (ADR 0177, "Changes from outside the app"). A file with the
   * content of an item whose file is gone is that file, renamed or moved: the item follows it (its library folder is the one of
   * the folder it is in, and a new file name becomes its name). Any other new file is imported where it lies, into the library
   * folder of its folder. A copy of a file the library has is left alone. Whether anything changed.
   */
  async scan(): Promise<boolean> {
    const found = (await this.bridge.tree("library")).filter((f) => usable(f.path));
    const { entries, recs } = await this.read();
    const known = new Set([...recs.values()].flatMap((r) => (r.ext && r.file ? [r.file.toLowerCase()] : [])));
    const fresh = found.filter((f) => !known.has(f.path.toLowerCase()) && !externalFolder.claimed(f.path));
    if (!fresh.length) return false;
    const onDisk = new Set(found.map((f) => f.path.toLowerCase()));
    const byHash = new Map(entries.map((e) => [e.hash, e]));
    const found2: FolderFile[] = [];
    let changed = false;
    for (const f of fresh) {
      const hash = await this.bridge.hash(f.path);
      if (!hash) continue;
      const rec = recs.get(hash);
      if (rec) {
        if (rec.ext && rec.file && !isHiddenFile(rec.file) && !onDisk.has(rec.file.toLowerCase())) {
          await this.relink(hash, byHash.get(hash), rec.file, f.path);
          onDisk.add(rec.file.toLowerCase()); // (a second copy of it is not relinked too)
          changed = true;
        }
        continue; // a copy of a file the library has, or bytes it keeps otherwise: left alone
      }
      const name = f.path.slice(f.path.lastIndexOf("/") + 1);
      found2.push({ path: f.path, name, folderId: await this.folderFor(parentOf(f.path)), read: async () => {
        const bytes = await this.bridge.read(f.path);
        return bytes && new Blob([bytes as Uint8Array<ArrayBuffer>]);
      } });
    }
    if (found2.length && this.importFiles) {
      await this.importFiles(found2);
      changed = true;
    }
    return changed;
  }

  /**
   * Readable files someone put in `.hidden/` (a sealed one is `<32 hex>.bin`): while the hidden items are open they become hidden items,
   * taken where they lie, and the next write seals them and erases the readable file (a copy of an item the library has is erased at
   * once: its bytes are in that item, which is hidden too). While they are locked, the person is told once, to open them. Whether anything
   * was taken.
   */
  async scanHidden(tellAgain = false): Promise<boolean> {
    const plain = (await this.bridge.list(".hidden")).map((n) => `.hidden/${n}`).filter((p) => !isHiddenFile(p) && !p.includes(".tmp-"));
    if (!plain.length) return false;
    if (!this.vault.dataKey) {
      if (tellAgain) this.toldPlain.clear(); // (a file was just put there: said again, even about one said before)
      const fresh = plain.filter((p) => !this.toldPlain.has(p));
      for (const p of fresh) this.toldPlain.add(p);
      if (fresh.length && this.askKey) this.askKey(fresh.map((p) => p.slice(8)));
      else if (fresh.length) this.onNotice?.(`${fresh.length === 1 ? `A readable file (${fresh[0]!.slice(8)}) is` : `${fresh.length} readable files are`} in .hidden/ of the workspace folder. Open the Hidden items to encrypt ${fresh.length === 1 ? "it" : "them"}.`);
      return false;
    }
    if (!this.importFiles) return false;
    await this.importFiles(plain.map((path) => ({ path, name: path.slice(8), folderId: null, hidden: true, read: async () => {
      const bytes = await this.bridge.read(path);
      return bytes && new Blob([bytes as Uint8Array<ArrayBuffer>]);
    } })));
    for (const path of plain) {
      const hash = await this.bridge.hash(path);
      const rec = hash ? await idbGet<AssetRecord>(this.db, "assets", hash) : undefined;
      if (rec && rec.file !== path) await this.bridge.erase(path); // (a copy: the item has the bytes, and is hidden now)
    }
    return true;
  }
  private readonly toldPlain = new Set<string>();
  /** Asks for the hidden items' password when readable files wait in `.hidden/` (set by the app). */
  askKey: ((names: string[]) => void) | null = null;

  /** An item's file was renamed or moved outside the app: the item points at it, and takes its folder and (when renamed) its name. */
  private async relink(hash: string, e: CatalogEntry | undefined, from: string, to: string): Promise<void> {
    const folderId = await this.folderFor(parentOf(to));
    const tx = this.db.transaction(["assets", "assetCatalog"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const cur = await req(tx.objectStore("assets").get(hash) as IDBRequest<AssetRecord | undefined>);
    if (cur?.ext && cur.file === from) tx.objectStore("assets").put({ ...cur, file: to } satisfies AssetRecord, hash);
    const entry = e && (await req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>));
    if (entry) {
      const base = to.slice(to.lastIndexOf("/") + 1);
      const renamed = nameBase(base) !== nameBase(entry.name);
      tx.objectStore("assetCatalog").put({ ...entry, ...(renamed ? { name: base } : {}), folderIds: folderId ? [folderId] : [] } satisfies CatalogEntry);
    }
    await committed;
  }

  /**
   * The library folder a folder of `library/` stands for: the one whose path of safe names it is, made (with its parents) when
   * there is none, named as the folder on disk. A kind folder (`library/images`) or `library/` itself stands for none.
   */
  private async folderFor(dir: string): Promise<string | null> {
    const parts = dir.split("/").slice(1);
    const tx = this.db.transaction("meta", "readwrite", { durability: "strict" });
    const committed = done(tx);
    const folders = (await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? [];
    const match = (parent: string | null, part: string): AssetFolder | undefined => folders.find((f) => f.parentId === parent && safeBase(f.name) === part);
    if (!parts.length || (parts.length === 1 && KIND_FOLDERS.has(parts[0]!) && !match(null, parts[0]!))) {
      tx.abort();
      await committed.catch(() => undefined);
      return null;
    }
    let parent: string | null = null;
    let made = false;
    for (const part of parts) {
      let f = match(parent, part);
      if (!f) {
        f = { id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join(""), name: part, parentId: parent };
        folders.push(f);
        made = true;
      }
      parent = f.id;
    }
    if (made) tx.objectStore("meta").put(folders, FOLDERS_KEY);
    await committed;
    return parent;
  }

  /** A move the app stopped in the middle of: the stored original follows the file to wherever it is now. */
  private async finishMove(): Promise<void> {
    const m = await idbGet<Moving | null>(this.db, "meta", MOVING_KEY).catch(() => null);
    if (!m) return;
    if (await this.bridge.exists(m.to)) {
      await this.setFile(m.hash, (r) => r.ext === 1 && r.file === m.from, m.to);
      // Sealed or opened: the file it came from (readable, or sealed) is erased once the new one is there.
      if ((isHiddenFile(m.from) || isHiddenFile(m.to)) && (await idbGet<AssetRecord>(this.db, "assets", m.hash))?.file === m.to) await this.bridge.erase(m.from);
    }
    await idbPut(this.db, "meta", MOVING_KEY, null);
  }

  /** Move an item's file to the first free place for its name (a sealed one is opened back into it). */
  private async place(m: { hash: string; from: string | null; dir: string; base: string; ext: string }, taken: Set<string>, emptied: Set<string>, failed: string[]): Promise<void> {
    const target = await this.freeTarget(m.dir, m.base, m.ext, taken);
    try {
      if (isHiddenFile(m.from)) {
        // Shown again: opened, proven, written to its place, and only then the sealed file erased.
        const from = m.from!;
        await idbPut(this.db, "meta", MOVING_KEY, { hash: m.hash, from, to: target } satisfies Moving);
        const sealed = await this.bridge.read(from);
        const bytes = sealed && (await this.vault.open(sealed as Uint8Array<ArrayBuffer>));
        if (!bytes || (await sha256Hex(bytes.buffer)) !== m.hash) throw new Error("a hidden file did not open with the key");
        await externalFolder.write(m.hash, new Blob([bytes]), target);
        await this.setFile(m.hash, (r) => r.ext === 1 && r.file === from, target);
        await this.bridge.erase(from);
        await idbPut(this.db, "meta", MOVING_KEY, null);
      } else if (m.from) {
        // The move is noted first: if the app stops between the rename and the stored original's new place, start-up finishes it.
        await idbPut(this.db, "meta", MOVING_KEY, { hash: m.hash, from: m.from, to: target } satisfies Moving);
        await this.bridge.rename(m.from, target);
        await this.setFile(m.hash, (r) => r.ext === 1 && r.file === m.from, target);
        await idbPut(this.db, "meta", MOVING_KEY, null);
        taken.delete(m.from.toLowerCase());
        emptied.add(parentOf(m.from));
      }
    } catch (e) {
      taken.delete(target.toLowerCase());
      if (/ENOENT|no such file/i.test((e as Error).message)) return; // its file is gone (moved outside the app): left as it is
      failed.push((e as Error).message);
    } finally {
      externalFolder.release(target);
    }
  }

  /**
   * Write a file only the app's storage holds (a backup's import) to its place without waiting for the disk, and check it there by
   * its content. What `keepWritten` needs once the disk has it, or null (nothing to write, or it failed: tried again later).
   */
  private async writeNew(m: { hash: string; dir: string; base: string; ext: string }, taken: Set<string>, failed: string[]): Promise<Written | null> {
    const target = await this.freeTarget(m.dir, m.base, m.ext, taken);
    try {
      const rec = await idbGet<AssetRecord>(this.db, "assets", m.hash);
      if (!rec || rec.ext) {
        externalFolder.release(target);
        taken.delete(target.toLowerCase());
        return null;
      }
      await this.bridge.write(target, new Uint8Array(await rec.blob.arrayBuffer()), { durable: false });
      if ((await this.bridge.hash(target)) !== m.hash) throw new Error(`${target} was not written whole`);
      return { hash: m.hash, file: target, size: rec.blob.size };
    } catch (e) {
      externalFolder.release(target);
      taken.delete(target.toLowerCase());
      failed.push((e as Error).message);
      return null;
    }
  }

  /**
   * An import's originals, written into `library/` by kind and name (the next write of the library moves each one to its library
   * folder) without waiting for the disk each time, checked by their content, then made sure on the disk at once. The file of each one
   * written; one that failed is left out (the import keeps it in the app's storage, and it is written later as any).
   */
  async writeOriginals(batch: readonly AssetRecord[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const taken = new Set<string>();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < batch.length) {
        const a = batch[next++]!;
        const target = await this.freeTarget(libraryDir([], a.type, a.name), nameBase(a.name), fileExt(a.name, a.type), taken);
        try {
          await this.bridge.write(target, new Uint8Array(await a.blob.arrayBuffer()), { durable: false });
          if ((await this.bridge.hash(target)) !== a.hash) throw new Error(`${target} was not written whole`);
          out.set(a.hash, target);
        } catch {
          taken.delete(target.toLowerCase());
        } finally {
          externalFolder.release(target);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_WRITES, batch.length) }, worker));
    if (out.size) await this.bridge.syncFiles([...out.values()]);
    return out;
  }

  /** The files `writeNew` wrote are made sure on the disk, then the app's storage keeps only where each one is (one transaction). */
  private async keepWritten(written: Written[]): Promise<void> {
    if (!written.length) return;
    try {
      await this.bridge.syncFiles(written.map((w) => w.file));
      const tx = this.db.transaction("assets", "readwrite", { durability: "strict" });
      const committed = done(tx);
      const store = tx.objectStore("assets");
      for (const w of written) {
        const cur = await req(store.get(w.hash) as IDBRequest<AssetRecord | undefined>);
        if (cur && !cur.ext && cur.blob.size === w.size) store.put(storedStub({ ...cur, size: cur.blob.size, blob: new Blob([]), ext: 1, file: w.file }), w.hash);
      }
      await committed;
    } finally {
      for (const w of written) externalFolder.release(w.file);
    }
  }

  /**
   * A file only the app's storage holds that is already in its place, with its content (written before the app stopped, its record
   * not kept): it is taken as it is, never written a second time beside itself. Whether it was.
   */
  private async adoptWritten(m: { hash: string; dir: string; base: string; ext: string }, taken: Set<string>): Promise<boolean> {
    let found: string | null = null;
    await freePath(m.dir, m.base, m.ext, async (p) => {
      if (taken.has(p.toLowerCase()) || externalFolder.claimed(p)) return true; // (another item's)
      if (!(await this.bridge.exists(p))) return false; // the first free name: nothing was written for it
      if ((await this.bridge.hash(p)) !== m.hash) return true;
      found = p;
      return false;
    });
    if (!found || !externalFolder.claim(found)) return false;
    try {
      taken.add((found as string).toLowerCase());
      await this.setFile(m.hash, (r) => !r.ext, found, "relaxed");
      return true;
    } finally {
      externalFolder.release(found);
    }
  }

  /**
   * Hide an original: sealed with the key into `.hidden/<random>.bin`, read back and opened to prove it, then the readable copy
   * erased (never put in `.trash/`) and its thumbnail dropped. A failure leaves it as it was.
   */
  private async seal(hash: string, failed: string[]): Promise<void> {
    const rec = await idbGet<AssetRecord>(this.db, "assets", hash);
    if (!rec || isHiddenFile(rec.file)) return;
    const name = hiddenFileName();
    try {
      const bytes = rec.ext ? await this.bridge.read(rec.file ?? "") : new Uint8Array(await rec.blob.arrayBuffer());
      if (!bytes || (await sha256Hex((bytes as Uint8Array<ArrayBuffer>).slice().buffer)) !== hash) throw new Error("the file is not what the library says");
      await idbPut(this.db, "meta", MOVING_KEY, { hash, from: rec.ext ? rec.file! : "", to: name } satisfies Moving);
      await this.bridge.write(name, await this.vault.seal(bytes as Uint8Array<ArrayBuffer>));
      const back = await this.bridge.read(name);
      const opened = back && (await this.vault.open(back as Uint8Array<ArrayBuffer>));
      if (!opened || (await sha256Hex(opened.buffer)) !== hash) {
        await this.bridge.erase(name);
        throw new Error("the sealed file did not open back the same");
      }
      await this.setFile(hash, (r) => (rec.ext ? r.ext === 1 && r.file === rec.file : !r.ext), name);
      if (rec.ext && rec.file) await this.bridge.erase(rec.file);
      const tx = this.db.transaction("thumbs", "readwrite");
      tx.objectStore("thumbs").delete(hash);
      await done(tx);
      await idbPut(this.db, "meta", MOVING_KEY, null);
    } catch (e) {
      failed.push((e as Error).message);
    }
  }

  /** The first free `<dir>/<base>[-n].<ext>`, claimed (a new original being imported at the same time never takes it). */
  private async freeTarget(dir: string, base: string, ext: string, taken: Set<string>): Promise<string> {
    for (;;) {
      const target = await freePath(dir, base, ext, async (p) => taken.has(p.toLowerCase()) || externalFolder.claimed(p) || (await this.bridge.exists(p)));
      if (!externalFolder.claim(target)) continue;
      taken.add(target.toLowerCase());
      return target;
    }
  }

  /**
   * Point the stored original at its new file, when it is still what `still` says (else nothing changes). `durability` "relaxed"
   * only where losing it is harmless: a file written from the app's storage is found again by its content (see `place`).
   */
  private async setFile(hash: string, still: (r: AssetRecord) => boolean, file: string, durability: IDBTransactionDurability = "strict"): Promise<void> {
    const tx = this.db.transaction("assets", "readwrite", { durability });
    const committed = done(tx);
    const cur = await req(tx.objectStore("assets").get(hash) as IDBRequest<AssetRecord | undefined>);
    if (cur && still(cur)) tx.objectStore("assets").put(storedStub({ ...cur, size: cur.ext ? cur.size : cur.blob.size, blob: new Blob([]), ext: 1, file }), hash);
    await committed;
  }

  private async read(): Promise<{ entries: CatalogEntry[]; recs: Map<string, AssetRecord>; folders: AssetFolder[] }> {
    const tx = this.db.transaction(["assetCatalog", "assets", "meta"], "readonly");
    const entries = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
    const folders = (await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? [];
    const stubs = (await req(tx.objectStore("assets").index("ext").getAll())) as AssetRecord[];
    const recs = new Map(stubs.map((s) => [s.hash, s]));
    // Originals with their bytes in the app's storage (a backup's import): their records (a Blob is not read here).
    for (const k of (await req(tx.objectStore("assets").getAllKeys())) as string[]) {
      if (recs.has(k)) continue;
      const r = await req(tx.objectStore("assets").get(k) as IDBRequest<AssetRecord | undefined>);
      if (r) recs.set(k, { ...r, hash: k });
    }
    return { entries, recs, folders };
  }

  /** Write `library.json` (and the sealed index), from `known` when nothing was moved since it was read (no second read of the library). */
  private async writeJson(known?: Awaited<ReturnType<LibraryMirror["read"]>>): Promise<void> {
    const { entries, recs, folders } = known ?? (await this.read());
    const items = entries.map((e) => itemOf(e, recs.get(e.hash)));
    // Sealed items are only in the sealed index (written while the key is open: sealing and opening need it). One hidden while
    // the key is locked stays in library.json, as its file stays readable, until it is sealed.
    const open = items.filter((i) => !isHiddenFile(i.file));
    // The parts first, then the index that names them, so a reader never finds the index naming a part not written yet.
    const byKey = new Map<string, LibraryItem[]>();
    for (const i of open) (byKey.get(i.hash[0]!) ?? byKey.set(i.hash[0]!, []).get(i.hash[0]!)!).push(i);
    const parts = new Map<string, { text: string; hashes: string[] }>();
    for (const [key, list] of [...byKey].sort()) {
      const text = libraryPartText(list);
      if (this.parts.get(key)?.text !== text) await this.bridge.write(partPath(key), encode(text));
      parts.set(key, { text, hashes: list.map((i) => i.hash) });
    }
    const indexText = `${JSON.stringify({ format: LIBRARY_JSON_FORMAT, version: 2, folders, parts: [...parts.keys()] } satisfies LibraryIndex)}\n`;
    if (indexText !== this.lastPartsIndex) await this.bridge.write(LIBRARY_INDEX, encode(indexText));
    for (const key of this.parts.keys()) if (!parts.has(key)) await this.bridge.remove(partPath(key), "erase"); // (after the index stopped naming it)
    this.parts = parts;
    this.lastPartsIndex = indexText;
    // The single file of earlier versions, for an older app on another device; past COMPAT_MAX_ITEMS it is no longer kept.
    if (open.length <= COMPAT_MAX_ITEMS) {
      const text = libraryJsonText(folders, open, true);
      if (text !== this.lastText) await this.bridge.write(LIBRARY_JSON, encode(text));
      this.lastText = text;
    } else if (this.lastText !== "-") {
      await this.bridge.remove(LIBRARY_JSON, "erase");
      this.lastText = "-";
    }
    const index = JSON.stringify(items.filter((i) => isHiddenFile(i.file)));
    if (this.vault.dataKey && index !== this.lastIndex && (index !== "[]" || (await this.vault.state()) !== "none")) await this.vault.writeIndex(index);
    if (this.vault.dataKey) this.lastIndex = index;
    this.state = { folders: JSON.stringify(folders), items: Object.fromEntries(items.map((i) => [i.hash, seen(JSON.stringify(i))])) };
    await idbPut(this.db, "meta", STATE_KEY, this.state);
  }
}
