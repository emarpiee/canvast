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
import { FOLDERS_KEY, folderPath, meta, normalizeFields, normalizeNote, normalizeTags, visibleFolders } from "../assets/asset-catalog";
import type { AssetRecord } from "../assets/asset-library";
import { MAX_IMPORT_BYTES, storedStub } from "../assets/asset-library";
import type { DeleteMode, DesktopBridge } from "./desktop-bridge";
import { externalFolder } from "./external-folder";
import type { HiddenVault } from "./hidden-store";
import { RECOVERED_PREFIX } from "./hidden-store";
import { FILE_MAGIC, SEALED_COPY_RE, hiddenFileName, isHiddenFile } from "./hidden-vault";
import { sha256Hex } from "../assets/sha256";
import { done, idbGet, idbPut, req } from "./idb";
import { KIND_FOLDERS, extOfBytes, fileExt, fitsPlace, freePath, isSafeRelativePath, libraryDir, nameBase, safeBase } from "./workspace-names";
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
/** The part an item is in: the first two hex digits of its hash (256 parts; version 2 of the index had 16, by one digit, still read). */
const partKey = (hash: string): string => hash.slice(0, 2);
const PART_KEY_RE = /^[0-9a-f]{1,2}$/;
/** This device's record of what it last wrote or read of each part, kept per part (meta `libraryPart:<key>`): one save writes only its parts'. */
const PART_STATE = "libraryPart:";
/** Up to this many items, `library.json` (the single file of earlier versions) is still written, so an older app keeps working on the workspace. */
export const COMPAT_MAX_ITEMS = 10_000;
/** The limit in use (tests lower it, so a small library takes the path of a big one: only what changed is written). */
export const libraryTesting = { compatMax: COMPAT_MAX_ITEMS };
/** How long a sealed file with no entry waits before it is taken back as a hidden item (its entry may still be on its way); tests shorten it. */
export const HIDDEN_ORPHAN_WAIT = { ms: 30_000 };
/** Hidden items (hashes) and folders (`folder:<id>`) blanked in this device's cache while locked (app storage `meta`). */
const BLANK_KEY = "hiddenBlanked";
/** Sealed files a backup put into `.hidden/`, taken in without that wait (app storage `meta`). */
const NO_WAIT_KEY = "hiddenNoWait";

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
  /** 3: 256 parts by two hex digits (0.50.56); 2: 16 by one (still read). An older app reads neither of 3's, and never erases for it. */
  version: 2 | 3;
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
  return out.map((f) => ({ id: f.id, name: f.name, parentId: typeof f.parentId === "string" && ids.has(f.parentId) && f.parentId !== f.id ? f.parentId : null, ...(f.hidden === true ? { hidden: true as const } : {}) }));
}

/** Folders in one order (by id), so two lists compare as text whatever order each was written in. */
function canonFolders(folders: readonly AssetFolder[]): string {
  return JSON.stringify([...folders].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
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
  /** The parts as last written or read: their text's SHA-256, and the hashes each holds (an unchanged part is not read again). */
  private parts = new Map<string, { fp: string; hashes: string[] }>();
  /** Parts of `state.items` changed since it was last kept. */
  private stateDirty = new Set<string>();
  private lastPartsIndex = "";
  private lastIndex = "";
  private lastFolders = "[]";
  private failing = false;
  /** Imports files found in `library/` that no item has (set by the app through `Storage.folderImports`). */
  importFiles: ((files: FolderFile[]) => Promise<void>) | null = null;
  /** Told when an item could not be moved or written, in plain words. */
  onNotice: ((text: string) => void) | null = null;
  /** Told how far a write of files is (files written or moved of all it has to), after each one; `total` 0 when it ended. */
  onProgress: ((done: number, total: number, encrypting?: boolean) => void) | null = null;

  constructor(
    private readonly db: IDBDatabase,
    private readonly bridge: DesktopBridge,
    private readonly vault: HiddenVault,
    private readonly deleteTo: () => DeleteMode = () => "trash",
  ) {}

  /** At start-up: what another device changed in `library.json` is taken (new items, names, tags, folders, where each file is). */
  async start(): Promise<void> {
    this.state = (await idbGet<LibraryState>(this.db, "meta", STATE_KEY).catch(() => undefined)) ?? { folders: "", items: {} };
    // (kept per part since 0.50.56; a record of an earlier version, whole, is split at the next save)
    if (Object.keys(this.state.items ?? {}).length) for (const h of Object.keys(this.state.items)) this.stateDirty.add(partKey(h));
    else {
      const tx = this.db.transaction("meta", "readonly");
      const range = IDBKeyRange.bound(PART_STATE, `${PART_STATE}\uffff`);
      const parts = (await req(tx.objectStore("meta").getAll(range) as IDBRequest<Array<Record<string, string>>>).catch(() => [])) as Array<Record<string, string>>;
      this.state.items = Object.assign({}, ...parts);
    }
    await this.finishMove();
    await this.reread();
  }

  /**
   * Read `library.json`, and the hidden items' index when the hidden items are open, and take what changed. Also when the
   * hidden items are opened: what another device hid or changed among them is known only then.
   */
  async reread(): Promise<boolean> {
    const took = await this.rereadMain();
    return (await this.mergeCopies()) || took;
  }

  /**
   * Copies a sync tool made of the library's files (`items-3 (1).json`, `index (1).json`, `library (1).json`: two devices wrote one at
   * once and the tool kept both): the items and library folders in them this device has never known are taken (added on the other
   * device); what it knew and the kept file no longer has was deleted there, and is not brought back. The copy then goes where deleted
   * files go: what it added is in the library, written with the next save. One that does not read (still arriving) waits. Whether
   * anything was taken.
   */
  private async mergeCopies(): Promise<boolean> {
    const copies = [
      // (a part's own name is `items-<1 or 2 hex digits>.json`; a copy has more before `.json`: `items-3a (1).json`)
      ...(await this.bridge.list(LIBRARY_DIR)).filter((n) => /^(items-[0-9a-f]{1,2}|index)[^/]+\.json$/i.test(n) && !/^items-[0-9a-f]{1,2}\.json$/.test(n)).map((n) => `${LIBRARY_DIR}/${n}`),
      ...(await this.bridge.list(".canvast")).filter((n) => /^library[^/]+\.json$/i.test(n) && n !== "library.json").map((n) => `.canvast/${n}`),
    ].filter((p) => !p.includes(".tmp-"));
    if (!copies.length) return false;
    const knownFolders = new Set((JSON.parse(this.state.folders || "[]") as AssetFolder[]).map((f) => f.id));
    const items = new Map<string, LibraryItem>();
    const folders = new Map<string, AssetFolder>();
    const read: string[] = [];
    for (const path of copies) {
      const bytes = await this.bridge.read(path);
      let raw: { items?: unknown; folders?: unknown } | null;
      try {
        raw = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as { items?: unknown; folders?: unknown }) : null;
      } catch {
        raw = null;
      }
      if (!raw || typeof raw !== "object") continue;
      for (const i of Array.isArray(raw.items) ? raw.items.map(readItem) : []) if (i && !(i.hash in this.state.items) && !isHiddenFile(i.file)) items.set(i.hash, i);
      for (const f of readFolders(raw.folders)) if (!knownFolders.has(f.id)) folders.set(f.id, f);
      read.push(path);
    }
    let took = false;
    if (folders.size) {
      const local = (await idbGet<AssetFolder[]>(this.db, "meta", FOLDERS_KEY)) ?? [];
      const ids = new Set(local.map((f) => f.id));
      const add = [...folders.values()].filter((f) => !ids.has(f.id));
      if (add.length) {
        await idbPut(this.db, "meta", FOLDERS_KEY, [...local, ...add]);
        took = true;
      }
    }
    // (The folders as last read stay the folders of the file, so only the items are taken here.)
    if (items.size && (await this.adopt(JSON.parse(this.state.folders || "[]") as AssetFolder[], [...items.values()], null))) took = true;
    for (const path of read) await this.bridge.remove(path, this.deleteTo());
    return took;
  }

  private async rereadMain(): Promise<boolean> {
    const vault = await this.vault.state();
    // (An index this key does not open, damaged or of another key, is not whole: the hidden items here stay as they are.)
    let hiddenWhole = true;
    // The hidden folders: from the sealed list while the key is open; while locked, this device's own (as they were).
    let hiddenFolders: unknown[] = vault === "open" ? [] : ((await idbGet<AssetFolder[]>(this.db, "meta", FOLDERS_KEY).catch(() => undefined)) ?? []).filter((f) => f.hidden);
    const hiddenItems = async (): Promise<LibraryItem[]> => {
      if (vault !== "open") return [];
      const read = await this.vault.readIndex().catch(() => null);
      if (!read?.whole) hiddenWhole = false;
      hiddenFolders = read?.whole ? read.folders : ((await idbGet<AssetFolder[]>(this.db, "meta", FOLDERS_KEY).catch(() => undefined)) ?? []).filter((f) => f.hidden);
      const items = (read?.items ?? []).map(readItem).filter((i): i is LibraryItem => i !== null);
      if (read?.whole) await this.refill(items, readFolders(hiddenFolders));
      return items;
    };
    const withHidden = (raw: unknown): AssetFolder[] => readFolders([...(Array.isArray(raw) ? raw : []), ...hiddenFolders]);
    let took = false;
    // The library in parts: only the parts whose text changed are read; the others' items are known to be there still.
    const indexBytes = await this.bridge.read(LIBRARY_INDEX);
    let index: Partial<LibraryIndex> | null = null;
    try {
      index = indexBytes ? (JSON.parse(new TextDecoder().decode(indexBytes)) as Partial<LibraryIndex>) : null;
    } catch {
      index = null; // damaged: written again from the app's storage
    }
    const hasParts = !!index && index.format === LIBRARY_JSON_FORMAT && (index.version === 2 || index.version === 3) && Array.isArray(index.parts);
    if (index && hasParts) {
      const keys = index.parts!.filter((k): k is string => typeof k === "string" && PART_KEY_RE.test(k));
      const items: LibraryItem[] = [];
      const present = new Set<string>();
      let whole = true;
      const parts = new Map<string, { fp: string; hashes: string[] }>();
      for (const key of keys) {
        const bytes = await this.bridge.read(partPath(key));
        const fp = bytes ? await sha256Hex((bytes as Uint8Array<ArrayBuffer>).slice().buffer) : null;
        const was = this.parts.get(key);
        if (fp !== null && was?.fp === fp) {
          parts.set(key, was);
          for (const h of was.hashes) present.add(h);
          continue;
        }
        const text = bytes ? new TextDecoder().decode(bytes) : null;
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
        parts.set(key, { fp: fp!, hashes: read.map((i) => i.hash) });
      }
      const hidden = await hiddenItems();
      items.push(...hidden);
      for (const i of hidden) present.add(i.hash);
      // (While the hidden items are locked, an item missing from the library may have been hidden elsewhere, not erased.)
      took = await this.adopt(withHidden(index.folders), items, whole && hiddenWhole && vault !== "locked" ? present : null);
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
    return (await this.adopt(withHidden(raw.folders), items, hiddenWhole && vault !== "locked" ? new Set(items.map((i) => i.hash)) : null)) || took;
  }

  /**
   * Hidden items' names, tags, notes and fields (and hidden folders' names) out of this device's cache while the key is locked
   * (Settings > Privacy, ADR 0177): those of sealed items are blanked, as the sealed index holds them, and listed; opening the key fills
   * them in again from it (`refill`) before anything else. While any is blank the index is never written, so a blank never reaches it.
   */
  async blankHidden(): Promise<void> {
    const tx = this.db.transaction(["assetCatalog", "assets", "meta"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const blanked = new Set((await req(tx.objectStore("meta").get(BLANK_KEY) as IDBRequest<string[] | undefined>)) ?? []);
    for (const e of await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>)) {
      if (!e.hidden || blanked.has(e.hash)) continue;
      const rec = await req(tx.objectStore("assets").get(e.hash) as IDBRequest<AssetRecord | undefined>);
      if (!rec?.ext || !isHiddenFile(rec.file)) continue; // (not sealed yet: not in the sealed index either)
      const { note: _n, fields: _f, ...rest } = e;
      tx.objectStore("assetCatalog").put({ ...rest, name: `Hidden item${fileExt(e.name, e.type) ? `.${fileExt(e.name, e.type)}` : ""}`, tags: [] } satisfies CatalogEntry);
      blanked.add(e.hash);
    }
    const folders = (await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? [];
    const blankFolders = folders.map((f) => (f.hidden && !blanked.has(`folder:${f.id}`) ? (blanked.add(`folder:${f.id}`), { ...f, name: "Hidden folder" }) : f));
    tx.objectStore("meta").put(blankFolders, FOLDERS_KEY);
    tx.objectStore("meta").put([...blanked], BLANK_KEY);
    await committed;
  }

  /** Fill blanked hidden items and folders in again from the sealed index (`items`, `folders`): theirs, whatever this device holds. */
  private async refill(items: readonly LibraryItem[], folders: readonly AssetFolder[]): Promise<void> {
    const blanked = (await idbGet<string[]>(this.db, "meta", BLANK_KEY).catch(() => undefined)) ?? [];
    if (!blanked.length) return;
    const left = new Set(blanked);
    const tx = this.db.transaction(["assetCatalog", "meta"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    for (const it of items) {
      if (!left.has(it.hash)) continue;
      const e = await req(tx.objectStore("assetCatalog").get(it.hash) as IDBRequest<CatalogEntry | undefined>);
      if (e) tx.objectStore("assetCatalog").put({ ...entryOf(it, e), state: e.state, deletedAt: e.deletedAt });
      left.delete(it.hash);
    }
    const byId = new Map(folders.map((f) => [f.id, f]));
    const mine = (await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? [];
    tx.objectStore("meta").put(mine.map((f) => (left.has(`folder:${f.id}`) && byId.has(f.id) ? (left.delete(`folder:${f.id}`), { ...f, name: byId.get(f.id)!.name }) : f)), FOLDERS_KEY);
    // (one no longer in the index was shown or erased elsewhere meanwhile: it is not blank any more, it is taken from the files as any)
    tx.objectStore("meta").put([], BLANK_KEY);
    await committed;
  }

  /** Whether any hidden item or folder is blank here (its names only in the sealed index). */
  private async anyBlank(): Promise<boolean> {
    return ((await idbGet<string[]>(this.db, "meta", BLANK_KEY).catch(() => undefined)) ?? []).length > 0;
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
    const fileFolders = canonFolders(folders);
    if (fileFolders !== (this.state.folders || "[]")) {
      const localChanged = canonFolders(localFolders) !== (this.state.folders || "[]");
      // Both changed: this device's folders, and the ones the other device added.
      const knownIds = new Set((JSON.parse(this.state.folders || "[]") as AssetFolder[]).map((f) => f.id));
      const localIds = new Set(localFolders.map((f) => f.id));
      tx.objectStore("meta").put(localChanged ? [...localFolders, ...folders.filter((f) => !localIds.has(f.id) && !knownIds.has(f.id))] : folders, FOLDERS_KEY);
      this.state.folders = fileFolders;
      took = true;
    }

    const todo = items.flatMap((it) => {
      const text = JSON.stringify(it);
      return seen(text) === known[it.hash] ? [] : [{ it, text }]; // (nothing new from the folder for the rest)
    });
    // Many to look at (a new device, a big change elsewhere): what this device has is read in two reads, not two per item.
    let entryAt = async (h: string): Promise<CatalogEntry | undefined> => req(catalog.get(h) as IDBRequest<CatalogEntry | undefined>);
    let recAt = async (h: string): Promise<AssetRecord | undefined> => req(assets.get(h) as IDBRequest<AssetRecord | undefined>);
    if (todo.length > 200) {
      const entries = new Map((await req(catalog.getAll() as IDBRequest<CatalogEntry[]>)).map((e) => [e.hash, e]));
      const stubs = new Map(((await req(assets.index("ext").getAll())) as AssetRecord[]).map((r) => [r.hash, r]));
      const keys = new Set((await req(assets.getAllKeys())) as string[]);
      entryAt = async (h) => entries.get(h);
      recAt = async (h) => stubs.get(h) ?? (keys.has(h) ? req(assets.get(h) as IDBRequest<AssetRecord | undefined>) : undefined); // (bytes held here: rare)
    }
    for (const { it, text } of todo) {
      const e = await entryAt(it.hash);
      const rec = await recAt(it.hash);
      if (e && seen(JSON.stringify(itemOf(e, rec))) !== (known[it.hash] ?? "")) continue; // changed here too: this device's stays
      catalog.put(entryOf(it, e));
      if (it.file && (!rec || rec.ext)) {
        const stub: AssetRecord = { hash: it.hash, type: it.type, size: it.size, name: rec?.name ?? it.name, pixelW: it.pixelW, pixelH: it.pixelH, blob: new Blob([]), importedAt: it.importedAt, ...(it.card ? { card: true } : {}), ...(it.duration !== undefined ? { duration: it.duration } : {}), ...(it.frames !== undefined ? { frames: it.frames } : {}), ext: 1, file: it.file };
        assets.put(storedStub(stub), it.hash);
      }
      known[it.hash] = seen(text);
      this.stateDirty.add(partKey(it.hash));
      took = true;
    }
    for (const hash of present ? Object.keys(known) : []) {
      if (present!.has(hash)) continue;
      const e = await req(catalog.get(hash) as IDBRequest<CatalogEntry | undefined>);
      const rec = await req(assets.get(hash) as IDBRequest<AssetRecord | undefined>);
      if (e && seen(JSON.stringify(itemOf(e, rec))) !== known[hash]) continue; // changed here: kept
      if (e?.state === "active") catalog.put({ ...e, state: "deleted", deletedAt: Date.now() } satisfies CatalogEntry);
      delete known[hash];
      this.stateDirty.add(partKey(hash));
      took = true;
    }
    this.keepState(tx);
    await committed;
    return took;
  }

  /**
   * Put each original where its folder and name say, write the ones only the app's storage holds, then `library.json`.
   * False when a file could not be moved or written (it is tried again with the next change).
   */
  async write(only?: ReadonlySet<string>): Promise<boolean> {
    await this.finishMove();
    // Some items changed, in a library too big for `library.json`: only they are read, placed and written (with their parts).
    const some = only && this.lastText === "-" ? only : undefined;
    const read = some ? await this.readSome(some) : await this.read();
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
    const step = (encrypting = false): void => this.onProgress?.(++done, total, encrypting);
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
      step(true);
    }
    // A sealed item this device changed since the library was last written (its name, folder, tags…): its file is sealed again with it.
    // (Not while any is blank: a blank is not a change.)
    for (const e of (await this.anyBlank()) ? [] : active) {
      const rec = recs.get(e.hash);
      const was = this.state.items[e.hash];
      if (meta(e).hidden && rec?.ext && isHiddenFile(rec.file) && was !== undefined && seen(JSON.stringify(itemOf(e, rec))) !== was) this.resealed.add(e.hash);
    }
    if (this.resealed.size && this.vault.dataKey) await this.upgradeSealed([...this.resealed]);
    if (total) this.onProgress?.(total, 0);
    // Library folders are real folders, even empty; the places a move or a rename emptied are removed.
    const wanted = new Set<string>();
    for (const f of visibleFolders(folders)) for (let d = libraryDir(folderPath(folders, f.id), "", ""); d.includes("/"); d = parentOf(d)) wanted.add(d);
    for (const d of wanted) await this.bridge.makeFolder(d);
    for (const d of [...emptied, ...this.dirs]) {
      for (let p = d; p.startsWith("library/") && !wanted.has(p); p = parentOf(p)) if (!(await this.bridge.removeEmptyFolder(p))) break;
    }
    this.dirs = wanted;
    const placedAll = total === 0; // (no file moved, sealed or written: the records are as they were read)
    if (some) await this.writeSome(some);
    else await this.writeJson(placedAll ? read : undefined);
    if (failed.length && !this.failing) this.onNotice?.(`${failed.length === 1 ? "A library file" : `${failed.length} library files`} could not be moved to ${failed.length === 1 ? "its" : "their"} place in the workspace folder (${failed[0]}). ${failed.length === 1 ? "It is" : "They are"} tried again with the next change.`);
    this.failing = failed.length > 0;
    return !this.failing;
  }

  /** See FolderSync.checkFiles. */
  async checkFiles(onStep: (done: number, total: number) => void): Promise<{ checked: number; missing: string[]; damaged: string[] }> {
    const { entries, recs } = await this.read();
    const items = entries.filter((e) => e.state === "active" && recs.get(e.hash)?.ext && recs.get(e.hash)?.file && !isHiddenFile(recs.get(e.hash)!.file));
    const missing: string[] = [];
    const damaged: string[] = [];
    for (const [i, e] of items.entries()) {
      const got = await this.bridge.hash(recs.get(e.hash)!.file!);
      if (got === null) missing.push(e.name);
      else if (got !== e.hash) damaged.push(e.name);
      onStep(i + 1, items.length);
    }
    return { checked: items.length, missing, damaged };
  }

  /**
   * The files the folder says changed (the watcher's paths), looked at alone instead of all of `library/` (ADR 0177): a file no item
   * names is found by its content (an item's file renamed or moved: the item follows it) or imported where it lies; one that is gone
   * shows as missing (its size is looked at again). Null when a folder came or there are many: then `scan` looks through all. Which items
   * changed (imports report themselves).
   */
  async scanPaths(paths: readonly string[]): Promise<{ changed: string[]; imported: boolean } | null> {
    const lib = [...new Set(paths.filter((p) => p.startsWith("library/") && usable(p) && !externalFolder.claimed(p)))];
    if (paths.includes("library") || lib.length > 500) return null;
    if (!lib.length) return { changed: [], imported: false };
    const sizes = await this.bridge.sizes(lib);
    const changed: string[] = [];
    const found: FolderFile[] = [];
    for (const [k, path] of lib.entries()) {
      const tx = this.db.transaction("assets", "readonly");
      const named = await req(tx.objectStore("assets").index("file").getKey(path));
      if (named !== undefined) continue; // an item's own file (gone: its item shows as missing)
      // No file, and no item's: a folder came (what is in it was not said one by one) or went. All is looked through.
      if (sizes[k] === null) return null;
      const hash = await this.bridge.hash(path);
      if (!hash) continue;
      const rec = await idbGet<AssetRecord>(this.db, "assets", hash);
      if (rec) {
        if (rec.ext && rec.file && !isHiddenFile(rec.file) && rec.file !== path && !(await this.bridge.exists(rec.file))) {
          await this.relink(hash, await idbGet<CatalogEntry>(this.db, "assetCatalog", hash), rec.file, path);
          changed.push(hash);
        }
        continue; // (a copy of a file the library has: left alone)
      }
      found.push({ path, name: path.slice(path.lastIndexOf("/") + 1), folderId: await this.folderFor(parentOf(path)), size: sizes[k]!, hash: async () => hash, read: async () => {
        const bytes = await this.bridge.read(path);
        return bytes && new Blob([bytes as Uint8Array<ArrayBuffer>]);
      } });
    }
    if (found.length && this.importFiles) await this.importFiles(found);
    return { changed, imported: found.length > 0 };
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
      found2.push({ path: f.path, name, folderId: await this.folderFor(parentOf(f.path)), size: f.size, hash: async () => hash, read: async () => {
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
   * once: its bytes are in that item, which is hidden too). While they are locked, the person is told once, to open them. Sealed files
   * are never sealed again, whatever their name: those no item names are taken back (see `recoverSealed`). Whether anything was taken.
   */
  async scanHidden(tellAgain = false): Promise<boolean> {
    const all = (await this.bridge.list(".hidden")).map((n) => `.hidden/${n}`).filter((p) => !p.includes(".tmp-"));
    let plain = all.filter((p) => !SEALED_COPY_RE.test(p));
    const sealed = all.filter((p) => SEALED_COPY_RE.test(p));
    if (!this.vault.dataKey) {
      if (!plain.length) return false;
      if (tellAgain) this.toldPlain.clear(); // (a file was just put there: said again, even about one said before)
      const fresh = plain.filter((p) => !this.toldPlain.has(p));
      for (const p of fresh) this.toldPlain.add(p);
      if (fresh.length && this.askKey) this.askKey(fresh.map((p) => p.slice(8)));
      else if (fresh.length) this.onNotice?.(`${fresh.length === 1 ? `A readable file (${fresh[0]!.slice(8)}) is` : `${fresh.length} readable files are`} in .hidden/ of the workspace folder. Open the Hidden items to encrypt ${fresh.length === 1 ? "it" : "them"}.`);
      return false;
    }
    // A file the key opens is sealed, whatever its name (a sync tool's copy renamed further): it is not readable.
    const opens = await Promise.all(plain.map(async (p) => {
      const bytes = await this.bridge.read(p);
      return !!bytes && !!(await this.vault.open(bytes as Uint8Array<ArrayBuffer>));
    }));
    sealed.push(...plain.filter((_, i) => opens[i]));
    plain = plain.filter((_, i) => !opens[i]);
    let took = sealed.length ? await this.recoverSealed(sealed) : false;
    if (!plain.length || !this.importFiles) return took;
    await this.importFiles(plain.map((path) => ({ path, name: path.slice(8), folderId: null, hidden: true, read: async () => {
      const bytes = await this.bridge.read(path);
      return bytes && new Blob([bytes as Uint8Array<ArrayBuffer>]);
    } })));
    for (const path of plain) {
      const hash = await this.bridge.hash(path);
      const rec = hash ? await idbGet<AssetRecord>(this.db, "assets", hash) : undefined;
      if (rec && rec.file !== path) await this.bridge.erase(path); // (a copy: the item has the bytes, and is hidden now)
    }
    took = true;
    return took;
  }

  /**
   * Sealed files in `.hidden/` that no item names (ADR 0177, "Hidden items and sync tools"): its entry was lost (two devices wrote
   * `hidden.json` at once and the sync tool kept one), or the file is a sync tool's copy of another. One with the content of an item
   * whose file is there is a copy: erased (it is sealed: nothing readable goes). Any other is taken back as a hidden item, where it
   * lies (renamed to a hidden file's name first), named `recovered-<hash>.<ext>` as its name is not known. A file with a hidden file's
   * name is taken only once it has had no entry for `HIDDEN_ORPHAN_WAIT.ms`: its entry may still be on its way. Whether anything changed.
   */
  private async recoverSealed(paths: string[]): Promise<boolean> {
    const tx = this.db.transaction("assets", "readonly");
    const stubs = (await req(tx.objectStore("assets").index("ext").getAll())) as AssetRecord[];
    const named = new Set(stubs.flatMap((r) => (r.file && isHiddenFile(r.file) ? [r.file] : [])));
    const now = Date.now();
    for (const p of [...this.unnamedSince.keys()]) if (!paths.includes(p) || named.has(p)) this.unnamedSince.delete(p);
    const noWait = (await idbGet<string[]>(this.db, "meta", NO_WAIT_KEY)) ?? [];
    for (const p of noWait) if (paths.includes(p) && !named.has(p)) this.unnamedSince.set(p, 0); // (a backup's: no entry is on its way)
    if (noWait.length) await idbPut(this.db, "meta", NO_WAIT_KEY, noWait.filter((p) => paths.includes(p) && !named.has(p)));
    const due: string[] = [];
    for (const p of paths) {
      if (named.has(p)) continue;
      const since = this.unnamedSince.get(p) ?? (isHiddenFile(p) ? now : 0);
      this.unnamedSince.set(p, since);
      if (now - since >= HIDDEN_ORPHAN_WAIT.ms) due.push(p);
    }
    if (due.length < this.unnamedSince.size && !this.laterTimer) {
      this.laterTimer = setTimeout(() => {
        this.laterTimer = 0;
        this.scanLater?.();
      }, HIDDEN_ORPHAN_WAIT.ms + 1000) as unknown as number;
    }
    let changed = false;
    const found: FolderFile[] = [];
    const shut: string[] = [];
    for (const p of due) {
      const bytes = await this.bridge.read(p);
      const opened = bytes && (await this.vault.openItem(bytes as Uint8Array<ArrayBuffer>));
      if (!opened) {
        if (bytes) shut.push(p);
        continue;
      }
      const plain = opened.bytes;
      const hash = await sha256Hex(plain.buffer);
      const rec = await idbGet<AssetRecord>(this.db, "assets", hash);
      if (rec && (!rec.ext || (rec.file && rec.file !== p && (await this.bridge.exists(rec.file))))) {
        await this.bridge.erase(p); // a copy of what an item has
        this.unnamedSince.delete(p);
        changed = true;
        continue;
      }
      let at = p;
      if (!isHiddenFile(p)) {
        at = hiddenFileName();
        await this.bridge.rename(p, at);
      }
      this.unnamedSince.delete(p);
      if (rec) {
        await this.setFile(hash, (r) => r.ext === 1, at); // (its item's file was lost: this is it)
        changed = true;
        continue;
      }
      // A file that stands on its own (version 2) says what it was: its name, folder and the rest come back with it. One of version 1
      // does not: it is named by its content.
      const item = opened.item && opened.item["hash"] === hash ? readItem({ ...opened.item, file: null }) : null;
      const path = Array.isArray(opened.item?.["folderPath"]) ? (opened.item["folderPath"] as unknown[]).filter((n): n is string => typeof n === "string" && !!n.trim()) : [];
      const folderId = item && path.length ? await this.folderFor(`library/${path.map((n) => safeBase(n)).join("/")}`) : null;
      found.push({
        path: at,
        name: item?.name ?? `${RECOVERED_PREFIX}${hash.slice(0, 12)}.${extOfBytes(plain)}`,
        folderId,
        hidden: true,
        ...(item ? { meta: { tags: item.tags, favorite: item.favorite, note: item.note, fields: item.fields } } : {}),
        read: async () => new Blob([plain]),
      });
    }
    if (shut.some((p) => !this.toldShut.has(p))) {
      for (const p of shut) this.toldShut.add(p);
      this.onNotice?.(`${shut.length === 1 ? "A hidden file" : `${shut.length} hidden files`} in .hidden/ of the workspace folder ${shut.length === 1 ? "does" : "do"} not open with this Hidden password (encrypted with another one). ${shut.length === 1 ? "It is" : "They are"} left as ${shut.length === 1 ? "it is" : "they are"}: scripts/hidden-items.mjs opens ${shut.length === 1 ? "it" : "them"} with that password.`);
    }
    if (found.length && this.importFiles) {
      await this.importFiles(found);
      const nameless = found.filter((f) => f.name.startsWith(RECOVERED_PREFIX)).length;
      this.onNotice?.(`${found.length === 1 ? "A hidden file" : `${found.length} hidden files`} had lost ${found.length === 1 ? "its" : "their"} entry (a sync tool kept another device's copy of the hidden items' list). ${found.length === 1 ? "It is" : "They are"} back among the Hidden items${nameless ? ` (${nameless === found.length ? "" : `${nameless} of them `}named “${RECOVERED_PREFIX}…”: sealed before 0.50.53, without their names)` : ""}.`);
      changed = true;
    }
    return changed;
  }
  /**
   * Sealed hidden files a backup brought (and their key file): each put into `.hidden/` under a new name unless the library has its item,
   * to be taken in from what it holds once the Hidden items are opened (at once if they are open). How many were put.
   */
  async importSealed(files: ReadonlyArray<{ hash: string; data: Blob }>, key: string | null): Promise<number> {
    if (key) await this.vault.adoptKey(key);
    const written: string[] = [];
    for (const f of files) {
      const rec = await idbGet<AssetRecord>(this.db, "assets", f.hash);
      if (rec && (!rec.ext || (rec.file && (await this.bridge.exists(rec.file))))) continue; // (the library has it)
      const at = hiddenFileName();
      await this.bridge.write(at, new Uint8Array(await f.data.arrayBuffer()), { durable: false });
      written.push(at);
    }
    const put = written.length;
    if (put) await this.bridge.syncFiles(written);
    // No entry is on their way: they are taken without waiting, even after a restart (kept until taken).
    const was = (await idbGet<string[]>(this.db, "meta", NO_WAIT_KEY)) ?? [];
    if (put) await idbPut(this.db, "meta", NO_WAIT_KEY, [...was, ...written]);
    if (put) this.onNotice?.(`${put === 1 ? "A hidden item" : `${put} hidden items`} came in the backup, still encrypted. ${put === 1 ? "It shows" : "They show"} once the Hidden items are opened with the password ${put === 1 ? "it was" : "they were"} hidden with.`);
    if (put && this.vault.dataKey) this.scanLater?.();
    return put;
  }
  private readonly unnamedSince = new Map<string, number>();
  private readonly toldShut = new Set<string>();
  private laterTimer = 0;
  /** Look through `.hidden/` again (set by the app): a sealed file no item names waits before it is taken back. */
  scanLater: (() => void) | null = null;
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
    // A file being sealed when the app stopped, with its readable original still there, is proven first (read back and opened):
    // unproven, or while the key is locked, the sealed one goes and the readable one stays, to be sealed again with the next write.
    const source = m.from === "" || (await this.bridge.exists(m.from));
    if (isHiddenFile(m.to) && source && (await this.bridge.exists(m.to)) && !(await this.sealedHolds(m.to, m.hash))) await this.bridge.erase(m.to);
    else if (await this.bridge.exists(m.to)) {
      await this.setFile(m.hash, (r) => r.ext === 1 && r.file === m.from, m.to);
      // Sealed or opened: the file it came from (readable, or sealed) is erased once the new one is there.
      if ((isHiddenFile(m.from) || isHiddenFile(m.to)) && (await idbGet<AssetRecord>(this.db, "assets", m.hash))?.file === m.to) await this.bridge.erase(m.from);
    }
    await idbPut(this.db, "meta", MOVING_KEY, null);
  }

  /** Whether a sealed file opens, with the key in memory, into the bytes of `hash` (false while locked). */
  private async sealedHolds(file: string, hash: string): Promise<boolean> {
    const sealed = await this.bridge.read(file);
    const bytes = sealed && (await this.vault.open(sealed as Uint8Array<ArrayBuffer>));
    return !!bytes && (await sha256Hex(bytes.buffer)) === hash;
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
    // shortcut: a file too big to read into the page is not encrypted (it stays readable, and is said); seal it in a stream to lift this.
    if (rec.size > MAX_IMPORT_BYTES) {
      failed.push(`“${rec.name}” is larger than ${MAX_IMPORT_BYTES / 2 ** 20} MiB, too big to encrypt`);
      return;
    }
    const name = hiddenFileName();
    try {
      const bytes = rec.ext ? await this.bridge.read(rec.file ?? "") : new Uint8Array(await rec.blob.arrayBuffer());
      if (!bytes || (await sha256Hex((bytes as Uint8Array<ArrayBuffer>).slice().buffer)) !== hash) throw new Error("the file is not what the library says");
      await idbPut(this.db, "meta", MOVING_KEY, { hash, from: rec.ext ? rec.file! : "", to: name } satisfies Moving);
      await this.bridge.write(name, await this.vault.seal(bytes as Uint8Array<ArrayBuffer>, await this.sealedItem(hash)));
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

  /**
   * What a hidden file holds of its item, sealed in its header so the file stands on its own: the item as the library keeps it
   * (without its file), and its library folder as a path of names (folder ids are only this workspace's).
   */
  private async sealedItem(hash: string): Promise<Record<string, unknown>> {
    const e = await idbGet<CatalogEntry>(this.db, "assetCatalog", hash);
    const rec = await idbGet<AssetRecord>(this.db, "assets", hash);
    const folders = (await idbGet<AssetFolder[]>(this.db, "meta", FOLDERS_KEY)) ?? [];
    if (!e) return { hash };
    const { file: _file, ...item } = itemOf(e, rec);
    return { ...item, folderPath: item.folderId ? folderPath(folders, item.folderId) : [] };
  }

  /**
   * Hidden files sealed before 0.50.53 (version 1: the bytes only) sealed again as files that stand on their own (version 2, with
   * their item), each read back and opened to prove it; also one whose item this device changed since it was sealed (its name, folder,
   * tags…), so a file never says less than the library. While the key is open; shown as encrypting.
   */
  async upgradeSealed(only?: readonly string[]): Promise<void> {
    if (!this.vault.dataKey) return;
    const { entries, recs } = only ? { entries: [] as CatalogEntry[], recs: new Map<string, AssetRecord>() } : await this.read();
    for (const hash of only ?? []) {
      const e = await idbGet<CatalogEntry>(this.db, "assetCatalog", hash);
      const rec = await idbGet<AssetRecord>(this.db, "assets", hash);
      if (e && rec) (entries.push(e), recs.set(hash, rec));
    }
    const todo: string[] = [];
    for (const e of entries) {
      const rec = recs.get(e.hash);
      if (!meta(e).hidden || !rec?.ext || !isHiddenFile(rec.file)) continue;
      const head = await this.bridge.head(rec.file!);
      const changed = this.resealed.has(e.hash);
      if (head !== null && (!head.startsWith(FILE_MAGIC) || changed)) todo.push(e.hash);
    }
    let done = 0;
    for (const hash of todo) {
      const rec = recs.get(hash)!;
      try {
        const sealed = await this.bridge.read(rec.file!);
        const plain = sealed && (await this.vault.open(sealed as Uint8Array<ArrayBuffer>));
        if (!plain || (await sha256Hex(plain.buffer)) !== hash) continue;
        await this.bridge.write(rec.file!, await this.vault.seal(plain, await this.sealedItem(hash)));
        const back = await this.bridge.read(rec.file!);
        const again = back && (await this.vault.open(back as Uint8Array<ArrayBuffer>));
        if (!again || (await sha256Hex(again.buffer)) !== hash) throw new Error("a hidden file did not open back the same");
        this.resealed.delete(hash);
      } catch (e) {
        this.onNotice?.(`A hidden file could not be encrypted again in the new format (${(e as Error).message}). It is tried again later; it still opens as it is.`);
      } finally {
        this.onProgress?.(++done, todo.length, true);
      }
    }
    if (todo.length) this.onProgress?.(todo.length, 0, true);
  }
  /** Hidden items this device changed since their file was sealed: sealed again with what they are now. */
  private readonly resealed = new Set<string>();

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

  /** `read`, for some items only. */
  private async readSome(hashes: ReadonlySet<string>): Promise<{ entries: CatalogEntry[]; recs: Map<string, AssetRecord>; folders: AssetFolder[] }> {
    const tx = this.db.transaction(["assetCatalog", "assets", "meta"], "readonly");
    const folders = (await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? [];
    const entries: CatalogEntry[] = [];
    const recs = new Map<string, AssetRecord>();
    for (const h of hashes) {
      const e = await req(tx.objectStore("assetCatalog").get(h) as IDBRequest<CatalogEntry | undefined>);
      const r = await req(tx.objectStore("assets").get(h) as IDBRequest<AssetRecord | undefined>);
      if (e) entries.push(e);
      if (r) recs.set(h, { ...r, hash: h });
    }
    return { entries, recs, folders };
  }

  /**
   * `writeJson` for some items: only the parts they are in are made again (each read from the app's storage by its range of hashes),
   * the sealed index from the hidden items known (`hiddenItems`, kept by `writeJson`), and this device's record for them.
   */
  private async writeSome(hashes: ReadonlySet<string>): Promise<void> {
    const keys = new Set([...hashes].map(partKey));
    const tx = this.db.transaction(["assetCatalog", "assets", "meta"], "readonly");
    const folders = (await req(tx.objectStore("meta").get(FOLDERS_KEY) as IDBRequest<AssetFolder[] | undefined>)) ?? [];
    const lists = new Map<string, LibraryItem[]>();
    for (const k of keys) {
      const range = IDBKeyRange.bound(k, `${k}\uffff`);
      const entries = await req(tx.objectStore("assetCatalog").getAll(range) as IDBRequest<CatalogEntry[]>);
      // (the store's keys are the hashes; a record need not hold its own)
      const ks = (await req(tx.objectStore("assets").getAllKeys(range))) as string[];
      const vals = (await req(tx.objectStore("assets").getAll(range))) as AssetRecord[];
      const recs = new Map(ks.map((h, i) => [h, vals[i]!]));
      lists.set(k, entries.map((e) => itemOf(e, recs.get(e.hash))));
    }
    await done(tx);
    for (const [k, items] of lists) {
      const open = items.filter((i) => !isHiddenFile(i.file));
      for (const i of items) if (hashes.has(i.hash)) (isHiddenFile(i.file) ? this.hiddenItems.set(i.hash, i) : this.hiddenItems.delete(i.hash));
      if (open.length) {
        const bytes = encode(libraryPartText(open));
        const fp = await sha256Hex((bytes as Uint8Array<ArrayBuffer>).buffer);
        if (this.parts.get(k)?.fp !== fp) await this.bridge.write(partPath(k), bytes);
        this.parts.set(k, { fp, hashes: open.map((i) => i.hash) });
      } else if (this.parts.delete(k)) await this.bridge.remove(partPath(k), "erase");
      const now = new Set(items.map((i) => i.hash));
      for (const h of hashes) if (partKey(h) === k && !now.has(h)) (this.hiddenItems.delete(h), delete this.state.items[h]);
      for (const i of items) {
        const v = seen(JSON.stringify(i));
        if (this.state.items[i.hash] !== v) (this.state.items[i.hash] = v), this.stateDirty.add(k);
      }
      this.stateDirty.add(k);
    }
    const shown = visibleFolders(folders);
    const indexText = `${JSON.stringify({ format: LIBRARY_JSON_FORMAT, version: 3, folders: shown, parts: [...this.parts.keys()].sort() } satisfies LibraryIndex)}\n`;
    if (indexText !== this.lastPartsIndex) await this.bridge.write(LIBRARY_INDEX, encode(indexText));
    this.lastPartsIndex = indexText;
    const index = JSON.stringify([...this.hiddenItems.values()].sort((a, b) => (a.hash < b.hash ? -1 : 1)));
    const sealedFolders = JSON.stringify(folders.filter((f) => !shown.includes(f)));
    if (this.vault.dataKey && !(await this.anyBlank()) && (index !== this.lastIndex || sealedFolders !== this.lastFolders || this.vault.indexWaiting) && (index !== "[]" || sealedFolders !== "[]" || (await this.vault.state()) !== "none")) await this.vault.writeIndex(index, sealedFolders);
    if (this.vault.dataKey) (this.lastIndex = index), (this.lastFolders = sealedFolders);
    const wtx = this.db.transaction("meta", "readwrite", { durability: "strict" });
    const committed = done(wtx);
    this.keepState(wtx);
    await committed;
  }
  /** The hidden items sealed, as last written (for `writeSome`). */
  private hiddenItems = new Map<string, LibraryItem>();

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
    for (const i of open) (byKey.get(partKey(i.hash)) ?? byKey.set(partKey(i.hash), []).get(partKey(i.hash))!).push(i);
    const parts = new Map<string, { fp: string; hashes: string[] }>();
    for (const [key, list] of [...byKey].sort()) {
      const bytes = encode(libraryPartText(list));
      const fp = await sha256Hex((bytes as Uint8Array<ArrayBuffer>).buffer);
      if (this.parts.get(key)?.fp !== fp) await this.bridge.write(partPath(key), bytes);
      parts.set(key, { fp, hashes: list.map((i) => i.hash) });
    }
    // Hidden folders are only in the sealed index: their names are written nowhere readable.
    const shown = visibleFolders(folders);
    const indexText = `${JSON.stringify({ format: LIBRARY_JSON_FORMAT, version: 3, folders: shown, parts: [...parts.keys()] } satisfies LibraryIndex)}\n`;
    if (indexText !== this.lastPartsIndex) await this.bridge.write(LIBRARY_INDEX, encode(indexText));
    for (const key of this.parts.keys()) if (!parts.has(key)) await this.bridge.remove(partPath(key), "erase"); // (after the index stopped naming it)
    this.parts = parts;
    this.lastPartsIndex = indexText;
    // The single file of earlier versions, for an older app on another device; past COMPAT_MAX_ITEMS it is no longer kept.
    if (open.length <= libraryTesting.compatMax) {
      const text = libraryJsonText(shown, open, true);
      if (text !== this.lastText) await this.bridge.write(LIBRARY_JSON, encode(text));
      this.lastText = text;
    } else if (this.lastText !== "-") {
      await this.bridge.remove(LIBRARY_JSON, "erase");
      this.lastText = "-";
    }
    const sealedItems = items.filter((i) => isHiddenFile(i.file)).sort((a, b) => (a.hash < b.hash ? -1 : 1));
    this.hiddenItems = new Map(sealedItems.map((i) => [i.hash, i]));
    const index = JSON.stringify(sealedItems);
    const sealedFolders = JSON.stringify(folders.filter((f) => !shown.includes(f)));
    if (this.vault.dataKey && !(await this.anyBlank()) && (index !== this.lastIndex || sealedFolders !== this.lastFolders || this.vault.indexWaiting) && (index !== "[]" || sealedFolders !== "[]" || (await this.vault.state()) !== "none")) await this.vault.writeIndex(index, sealedFolders);
    if (this.vault.dataKey) (this.lastIndex = index), (this.lastFolders = sealedFolders);
    // What this device now knows of each item: only the parts where something changed are kept again.
    const next: Record<string, string> = {};
    for (const i of items) {
      const v = seen(JSON.stringify(i));
      next[i.hash] = v;
      if (this.state.items[i.hash] !== v) this.stateDirty.add(partKey(i.hash));
    }
    for (const h of Object.keys(this.state.items)) if (!(h in next)) this.stateDirty.add(partKey(h));
    this.state = { folders: canonFolders(folders), items: next };
    const tx = this.db.transaction("meta", "readwrite", { durability: "strict" });
    const committed = done(tx);
    this.keepState(tx);
    await committed;
  }

  /** Keep this device's record of the library in `tx`: the folders, and each part changed since it was last kept. */
  private keepState(tx: IDBTransaction): void {
    const meta = tx.objectStore("meta");
    meta.put({ folders: this.state.folders, items: {} } satisfies LibraryState, STATE_KEY);
    if (!this.stateDirty.size) return;
    const byPart = new Map<string, Record<string, string>>([...this.stateDirty].map((k) => [k, {}]));
    for (const [h, v] of Object.entries(this.state.items)) {
      const rec = byPart.get(partKey(h));
      if (rec) rec[h] = v;
    }
    for (const [k, rec] of byPart) Object.keys(rec).length ? meta.put(rec, `${PART_STATE}${k}`) : meta.delete(`${PART_STATE}${k}`);
    this.stateDirty.clear();
  }
}
