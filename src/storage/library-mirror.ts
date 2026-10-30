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
import type { DeleteMode, DesktopBridge, LibraryOp } from "./desktop-bridge";
import type { DesktopLibrary } from "./desktop-library";
import { externalFolder } from "./external-folder";
import type { HiddenVault } from "./hidden-store";
import { RECOVERED_PREFIX } from "./hidden-store";
import { FILE_MAGIC, SEALED_COPY_RE, hiddenFileName, isHiddenFile } from "./hidden-vault";
import { sha256Hex } from "../assets/sha256";
import { done, idbGet, req } from "./idb";
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
export const partPath = (key: string): string => `${LIBRARY_DIR}/items-${key}.json`;
/** The part an item is in: the first two hex digits of its hash (256 parts; version 2 of the index had 16, by one digit, still read). */
export const partKey = (hash: string): string => hash.slice(0, 2);
export const PART_KEY_RE = /^[0-9a-f]{1,2}$/;
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
  thumb?: string;
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

/** What this device last wrote or read of the library's folders, as JSON (the library's meta "libraryMirror"; each item's is its seen mark). */
interface LibraryState {
  folders: string;
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

/** What a write of the library works from. */
interface LibraryRead {
  entries: CatalogEntry[];
  recs: Map<string, AssetRecord>;
  /** Seen marks (of the hidden items whose files are sealed: one changed here since is sealed again). */
  seen: Map<string, string>;
  folders: AssetFolder[];
}
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
    ...(m.thumb ? { thumb: m.thumb } : {}),
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
      ...(typeof r.thumb === "string" && HASH_RE.test(r.thumb) ? { thumb: r.thumb } : {}),
      state: r.state === "deleted" ? "deleted" : "active",
    };
  } catch {
    return null; // (too many tags, a note too long…)
  }
}

/** The library folders read from the file: well-formed ones only, a parent that is not there made none. */
export function readFolders(a: unknown): AssetFolder[] {
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
export function entryOf(it: LibraryItem, prev: CatalogEntry | undefined): CatalogEntry {
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
    ...(it.thumb ? { thumb: it.thumb } : {}),
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
export function seen(text: string): string {
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
  /** The library folders as this device last wrote or read them (kept in the library's meta, "libraryMirror"). */
  private state: LibraryState = { folders: "" };
  /** The library folders' places on disk as last written (to remove the ones a rename or delete emptied). */
  private dirs = new Set<string>();
  /** `library.json` as last written or read (another text there was written by an older app); "-" when the library is too big for it. */
  private lastText = "";
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
    private readonly lib: DesktopLibrary,
    private readonly bridge: DesktopBridge,
    private readonly vault: HiddenVault,
    private readonly deleteTo: () => DeleteMode = () => "trash",
  ) {}

  /** An original's record: in the library, or (bytes an import has not written out yet) in the page's storage. */
  private async recOf(hash: string): Promise<AssetRecord | undefined> {
    return (await this.lib.rec(hash)) ?? (await idbGet<AssetRecord>(this.db, "assets", hash).catch(() => undefined));
  }
  private async metaOf<T>(key: string): Promise<T | undefined> {
    return ((await this.lib.calls.meta(key)) as T | null) ?? undefined;
  }
  private setMeta(key: string, v: unknown): Promise<void> {
    return this.lib.apply([{ t: "meta", k: key, v }]);
  }

  /** At start-up: what another device changed in the library's files is taken (new items, names, tags, folders, where each file is). */
  async start(): Promise<void> {
    this.state = { folders: (await this.metaOf<LibraryState>(STATE_KEY))?.folders ?? "" };
    await this.finishMove();
    await this.reread();
  }

  /**
   * Read the library's files, and the hidden items' index when the hidden items are open, and take what changed. Also when the
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
      for (const i of Array.isArray(raw.items) ? raw.items.map(readItem) : []) if (i && !isHiddenFile(i.file)) items.set(i.hash, i);
      for (const f of readFolders(raw.folders)) if (!knownFolders.has(f.id)) folders.set(f.id, f);
      read.push(path);
    }
    // (only the items this device has never known: it last saw none of them)
    for (const h of (await this.lib.rows([...items.keys()])).seen.keys()) items.delete(h);
    let took = false;
    if (folders.size) {
      took = await this.lib.serial(async () => {
        const local = await this.lib.folders();
        const ids = new Set(local.map((f) => f.id));
        const add = [...folders.values()].filter((f) => !ids.has(f.id));
        if (add.length) await this.setMeta(FOLDERS_KEY, [...local, ...add]);
        return add.length > 0;
      });
    }
    if (items.size && (await this.lib.serial(() => this.lib.calls.sync([], [...items.values()], false))).took) took = true;
    for (const path of read) await this.bridge.remove(path, this.deleteTo());
    return took;
  }

  private async rereadMain(): Promise<boolean> {
    const vault = await this.vault.state();
    // (An index this key does not open, damaged or of another key, is not whole: the hidden items here stay as they are.)
    let hiddenWhole = true;
    // The hidden folders: from the sealed list while the key is open; while locked, this device's own (as they were).
    let hiddenFolders: unknown[] = vault === "open" ? [] : (await this.lib.folders().catch(() => [])).filter((f) => f.hidden);
    const hiddenItems = async (): Promise<LibraryItem[]> => {
      if (vault !== "open") return [];
      const read = await this.vault.readIndex().catch(() => null);
      if (!read?.whole) hiddenWhole = false;
      hiddenFolders = read?.whole ? read.folders : (await this.lib.folders().catch(() => [])).filter((f) => f.hidden);
      const items = (read?.items ?? []).map(readItem).filter((i): i is LibraryItem => i !== null);
      if (read?.whole) await this.refill(items, readFolders(hiddenFolders));
      return items;
    };
    const withHidden = (raw: unknown): AssetFolder[] => readFolders([...(Array.isArray(raw) ? raw : []), ...hiddenFolders]);
    let took = false;
    // The library in parts: read in the main process, only the parts whose text changed.
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
      const hidden = await hiddenItems();
      // (While the hidden items are locked, an item missing from the library may have been hidden elsewhere, not erased.)
      took = (await this.lib.serial(() => this.lib.calls.sync(keys, hidden, hiddenWhole && vault !== "locked"))).took;
      if (await this.adoptFolders(withHidden(index.folders))) took = true;
    }
    // `library.json`: read when it is the only form (a workspace of an earlier version), or when an older app changed it since.
    const bytes = await this.bridge.read(LIBRARY_JSON);
    const text = bytes ? new TextDecoder().decode(bytes) : null;
    if (text === null && hasParts) this.lastText = "-"; // (a library too big for it: written in parts only)
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
    const r = await this.lib.serial(() => this.lib.calls.sync([], items, hiddenWhole && vault !== "locked", true));
    return (await this.adoptFolders(withHidden(raw.folders))) || r.took || took;
  }

  /** The library folders of the files, taken when they changed there; when they changed here too, this device's and the ones added there. */
  private adoptFolders(folders: AssetFolder[]): Promise<boolean> {
    return this.lib.serial(async () => {
      const fileFolders = canonFolders(folders);
      if (fileFolders === (this.state.folders || "[]")) return false;
      const localFolders = await this.lib.folders();
      const localChanged = canonFolders(localFolders) !== (this.state.folders || "[]");
      const knownIds = new Set((JSON.parse(this.state.folders || "[]") as AssetFolder[]).map((f) => f.id));
      const localIds = new Set(localFolders.map((f) => f.id));
      this.state.folders = fileFolders;
      await this.lib.apply([
        { t: "meta", k: FOLDERS_KEY, v: localChanged ? [...localFolders, ...folders.filter((f) => !localIds.has(f.id) && !knownIds.has(f.id))] : folders },
        { t: "meta", k: STATE_KEY, v: this.state },
      ]);
      return true;
    });
  }

  /**
   * Hidden items' names, tags, notes and fields (and hidden folders' names) out of this device's cache while the key is locked
   * (Settings > Privacy, ADR 0177): those of sealed items are blanked, as the sealed index holds them, and listed; opening the key fills
   * them in again from it (`refill`) before anything else. While any is blank the index is never written, so a blank never reaches it.
   */
  blankHidden(): Promise<void> {
    return this.lib.serial(async () => {
      const blanked = new Set((await this.metaOf<string[]>(BLANK_KEY)) ?? []);
      const hidden = (await this.lib.entries("hidden")).filter((e) => !blanked.has(e.hash));
      const { recs } = await this.lib.rows(hidden.map((e) => e.hash));
      const ops: LibraryOp[] = [];
      for (const e of hidden) {
        const rec = recs.get(e.hash);
        if (!rec?.ext || !isHiddenFile(rec.file)) continue; // (not sealed yet: not in the sealed index either)
        const { note: _n, fields: _f, ...rest } = e;
        ops.push({ t: "entry", hash: e.hash, v: { ...rest, name: `Hidden item${fileExt(e.name, e.type) ? `.${fileExt(e.name, e.type)}` : ""}`, tags: [] } satisfies CatalogEntry });
        blanked.add(e.hash);
      }
      const folders = await this.lib.folders();
      const blankFolders = folders.map((f) => (f.hidden && !blanked.has(`folder:${f.id}`) ? (blanked.add(`folder:${f.id}`), { ...f, name: "Hidden folder" }) : f));
      ops.push({ t: "meta", k: FOLDERS_KEY, v: blankFolders }, { t: "meta", k: BLANK_KEY, v: [...blanked] });
      await this.lib.apply(ops);
    });
  }

  /** Fill blanked hidden items and folders in again from the sealed index (`items`, `folders`): theirs, whatever this device holds. */
  private refill(items: readonly LibraryItem[], folders: readonly AssetFolder[]): Promise<void> {
    return this.lib.serial(async () => {
      const blanked = (await this.metaOf<string[]>(BLANK_KEY)) ?? [];
      if (!blanked.length) return;
      const left = new Set(blanked);
      const { entries } = await this.lib.rows(items.filter((it) => left.has(it.hash)).map((it) => it.hash));
      const ops: LibraryOp[] = [];
      for (const it of items) {
        if (!left.has(it.hash)) continue;
        const e = entries.get(it.hash);
        if (e) ops.push({ t: "entry", hash: it.hash, v: { ...entryOf(it, e), state: e.state, deletedAt: e.deletedAt } });
        left.delete(it.hash);
      }
      const byId = new Map(folders.map((f) => [f.id, f]));
      const mine = await this.lib.folders();
      ops.push({ t: "meta", k: FOLDERS_KEY, v: mine.map((f) => (left.has(`folder:${f.id}`) && byId.has(f.id) ? (left.delete(`folder:${f.id}`), { ...f, name: byId.get(f.id)!.name }) : f)) });
      // (one no longer in the index was shown or erased elsewhere meanwhile: it is not blank any more, it is taken from the files as any)
      ops.push({ t: "meta", k: BLANK_KEY, v: [] });
      await this.lib.apply(ops);
    });
  }

  /**
   * What start-up has to write: a small library (with `library.json`) or one whose folders changed here, all of it; a big one, only the
   * items changed here since they were last written (a stop before the write), or nothing.
   */
  async pendingWrite(): Promise<true | Set<string> | false> {
    if (this.lastText !== "-" || canonFolders(await this.lib.folders()) !== (this.state.folders || "[]")) return true;
    const p = await this.lib.calls.pending();
    return p.length > 50_000 ? true : p.length ? new Set(p) : false;
  }

  /** Whether any hidden item or folder is blank here (its names only in the sealed index). */
  private async anyBlank(): Promise<boolean> {
    return ((await this.metaOf<string[]>(BLANK_KEY).catch(() => undefined)) ?? []).length > 0;
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
      const was = read.seen.get(e.hash);
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
    await this.writeJson(some);
    if (failed.length && !this.failing) this.onNotice?.(`${failed.length === 1 ? "A library file" : `${failed.length} library files`} could not be moved to ${failed.length === 1 ? "its" : "their"} place in the workspace folder (${failed[0]}). ${failed.length === 1 ? "It is" : "They are"} tried again with the next change.`);
    this.failing = failed.length > 0;
    return !this.failing;
  }

  /** See FolderSync.checkFiles. */
  async checkFiles(onStep: (done: number, total: number) => void, quick = false): Promise<{ checked: number; missing: string[]; damaged: string[] }> {
    const { entries, recs } = await this.read();
    const items = entries.filter((e) => e.state === "active" && recs.get(e.hash)?.ext && recs.get(e.hash)?.file && !isHiddenFile(recs.get(e.hash)!.file));
    const missing: string[] = [];
    const damaged: string[] = [];
    if (quick) {
      // Sizes only, no reading: a file gone or of another size than its item's (a same-size change is for the full check).
      for (let at = 0; at < items.length; at += 500) {
        const batch = items.slice(at, at + 500);
        const sizes = await this.bridge.sizes(batch.map((e) => recs.get(e.hash)!.file!));
        batch.forEach((e, k) => void (sizes[k] === null ? missing.push(e.name) : sizes[k] !== e.size && damaged.push(e.name)));
        onStep(at + batch.length, items.length);
      }
      return { checked: items.length, missing, damaged };
    }
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
      if ((await this.lib.calls.byFile(path)) !== null) continue; // an item's own file (gone: its item shows as missing)
      // No file, and no item's: a folder. One the library has files in changed (its files are said one by one); another came (what is
      // in it was not said one by one) or went: all is looked through.
      if (sizes[k] === null) {
        if (await this.lib.calls.holds(path)) continue;
        return null;
      }
      const hash = await this.bridge.hash(path);
      if (!hash) continue;
      const rec = await this.recOf(hash);
      if (rec) {
        if (rec.ext && rec.file && !isHiddenFile(rec.file) && rec.file !== path && !(await this.bridge.exists(rec.file))) {
          await this.relink(hash, await this.lib.entry(hash), rec.file, path);
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
    // (the main process walks library/ and leaves out every file an item names: only the others come here, not the whole library)
    const fresh = (await this.lib.calls.unnamed()).filter((f) => usable(f.path) && !externalFolder.claimed(f.path));
    if (!fresh.length) return false;
    const relinked = new Set<string>();
    const found2: FolderFile[] = [];
    let changed = false;
    for (const f of fresh) {
      const hash = await this.bridge.hash(f.path);
      if (!hash) continue;
      const rec = await this.recOf(hash);
      if (rec) {
        if (rec.ext && rec.file && !isHiddenFile(rec.file) && !relinked.has(hash) && !(await this.bridge.exists(rec.file))) {
          await this.relink(hash, await this.lib.entry(hash), rec.file, f.path);
          relinked.add(hash); // (a second copy of it is not relinked too)
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
      const rec = hash ? await this.recOf(hash) : undefined;
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
    const stubs = await this.lib.recs("sealed");
    const named = new Set(stubs.flatMap((r) => (r.file && isHiddenFile(r.file) ? [r.file] : [])));
    const now = Date.now();
    for (const p of [...this.unnamedSince.keys()]) if (!paths.includes(p) || named.has(p)) this.unnamedSince.delete(p);
    const noWait = (await this.metaOf<string[]>(NO_WAIT_KEY)) ?? [];
    for (const p of noWait) if (paths.includes(p) && !named.has(p)) this.unnamedSince.set(p, 0); // (a backup's: no entry is on its way)
    if (noWait.length) await this.setMeta(NO_WAIT_KEY, noWait.filter((p) => paths.includes(p) && !named.has(p)));
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
      const rec = await this.recOf(hash);
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
      const rec = await this.recOf(f.hash);
      if (rec && (!rec.ext || (rec.file && (await this.bridge.exists(rec.file))))) continue; // (the library has it)
      const at = hiddenFileName();
      await this.bridge.write(at, new Uint8Array(await f.data.arrayBuffer()), { durable: false });
      written.push(at);
    }
    const put = written.length;
    if (put) await this.bridge.syncFiles(written);
    // No entry is on their way: they are taken without waiting, even after a restart (kept until taken).
    const was = (await this.metaOf<string[]>(NO_WAIT_KEY)) ?? [];
    if (put) await this.setMeta(NO_WAIT_KEY, [...was, ...written]);
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
    await this.lib.serial(async () => {
      const ops: LibraryOp[] = [];
      const cur = await this.lib.rec(hash);
      if (cur?.ext && cur.file === from) ops.push({ t: "rec", hash, v: { ...cur, file: to } });
      const entry = e && (await this.lib.entry(hash));
      if (entry) {
        const base = to.slice(to.lastIndexOf("/") + 1);
        const renamed = nameBase(base) !== nameBase(entry.name);
        ops.push({ t: "entry", hash, v: { ...entry, ...(renamed ? { name: base } : {}), folderIds: folderId ? [folderId] : [] } satisfies CatalogEntry });
      }
      await this.lib.apply(ops);
    });
  }

  /**
   * The library folder a folder of `library/` stands for: the one whose path of safe names it is, made (with its parents) when
   * there is none, named as the folder on disk. A kind folder (`library/images`) or `library/` itself stands for none.
   */
  private async folderFor(dir: string): Promise<string | null> {
    const parts = dir.split("/").slice(1);
    return this.lib.serial(async () => {
      const folders = await this.lib.folders();
      const match = (parent: string | null, part: string): AssetFolder | undefined => folders.find((f) => f.parentId === parent && safeBase(f.name) === part);
      if (!parts.length || (parts.length === 1 && KIND_FOLDERS.has(parts[0]!) && !match(null, parts[0]!))) return null;
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
      if (made) await this.setMeta(FOLDERS_KEY, folders);
      return parent;
    });
  }

  /** A move the app stopped in the middle of: the stored original follows the file to wherever it is now. */
  private async finishMove(): Promise<void> {
    const m = (await this.metaOf<Moving>(MOVING_KEY).catch(() => undefined)) ?? null;
    if (!m) return;
    // A file being sealed when the app stopped, with its readable original still there, is proven first (read back and opened):
    // unproven, or while the key is locked, the sealed one goes and the readable one stays, to be sealed again with the next write.
    const source = m.from === "" || (await this.bridge.exists(m.from));
    if (isHiddenFile(m.to) && source && (await this.bridge.exists(m.to)) && !(await this.sealedHolds(m.to, m.hash))) await this.bridge.erase(m.to);
    else if (await this.bridge.exists(m.to)) {
      await this.setFile(m.hash, (r) => r.ext === 1 && r.file === m.from, m.to);
      // Sealed or opened: the file it came from (readable, or sealed) is erased once the new one is there.
      if ((isHiddenFile(m.from) || isHiddenFile(m.to)) && (await this.recOf(m.hash))?.file === m.to) await this.bridge.erase(m.from);
    }
    await this.setMeta(MOVING_KEY, null);
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
        await this.setMeta(MOVING_KEY, { hash: m.hash, from, to: target } satisfies Moving);
        const sealed = await this.bridge.read(from);
        const bytes = sealed && (await this.vault.open(sealed as Uint8Array<ArrayBuffer>));
        if (!bytes || (await sha256Hex(bytes.buffer)) !== m.hash) throw new Error("a hidden file did not open with the key");
        await externalFolder.write(m.hash, new Blob([bytes]), target);
        await this.setFile(m.hash, (r) => r.ext === 1 && r.file === from, target);
        await this.bridge.erase(from);
        await this.setMeta(MOVING_KEY, null);
      } else if (m.from) {
        // The move is noted first: if the app stops between the rename and the stored original's new place, start-up finishes it.
        await this.setMeta(MOVING_KEY, { hash: m.hash, from: m.from, to: target } satisfies Moving);
        await this.bridge.rename(m.from, target);
        await this.setFile(m.hash, (r) => r.ext === 1 && r.file === m.from, target);
        await this.setMeta(MOVING_KEY, null);
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
      const rec = await idbGet<AssetRecord>(this.db, "assets", m.hash); // (bytes only the page's storage holds)
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
      for (const w of written) await this.setFile(w.hash, (r) => !r.ext && r.blob.size === w.size, w.file);
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
      await this.setFile(m.hash, (r) => !r.ext, found);
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
    const rec = await this.recOf(hash);
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
      await this.setMeta(MOVING_KEY, { hash, from: rec.ext ? rec.file! : "", to: name } satisfies Moving);
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
      await this.setMeta(MOVING_KEY, null);
    } catch (e) {
      failed.push((e as Error).message);
    }
  }

  /**
   * What a hidden file holds of its item, sealed in its header so the file stands on its own: the item as the library keeps it
   * (without its file), and its library folder as a path of names (folder ids are only this workspace's).
   */
  private async sealedItem(hash: string): Promise<Record<string, unknown>> {
    const e = await this.lib.entry(hash);
    const rec = await this.recOf(hash);
    const folders = await this.lib.folders();
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
    if (only) {
      const rows = await this.lib.rows(only);
      for (const hash of only) {
        const e = rows.entries.get(hash);
        const rec = rows.recs.get(hash);
        if (e && rec) (entries.push(e), recs.set(hash, rec));
      }
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
   * Point the stored original at its new file, when it is still what `still` says (else nothing changes). Bytes the page's storage
   * held (an import's, now written out) are let go there once the library's record names the file.
   */
  private setFile(hash: string, still: (r: AssetRecord) => boolean, file: string): Promise<void> {
    return this.lib.serial(async () => {
      const cur = await this.lib.rec(hash);
      if (cur) return void (still(cur) && (await this.lib.apply([{ t: "rec", hash, v: storedStub({ ...cur, ext: 1, file }) }])));
      const held = await idbGet<AssetRecord>(this.db, "assets", hash).catch(() => undefined);
      if (!held || !still(held)) return;
      await this.lib.apply([{ t: "rec", hash, v: storedStub({ ...held, hash, size: held.blob.size, blob: new Blob([]), ext: 1, file }) }]);
      const tx = this.db.transaction("assets", "readwrite", { durability: "strict" });
      tx.objectStore("assets").delete(hash);
      await done(tx);
    });
  }

  /** `read`, for some items only. */
  private async readSome(hashes: ReadonlySet<string>): Promise<LibraryRead> {
    const [rows, folders] = await Promise.all([this.lib.rows([...hashes]), this.lib.folders()]);
    for (const h of hashes) {
      if (rows.recs.has(h)) continue;
      const held = await idbGet<AssetRecord>(this.db, "assets", h).catch(() => undefined);
      if (held) rows.recs.set(h, { ...held, hash: h });
    }
    return { entries: [...rows.entries.values()], recs: rows.recs, seen: rows.seen, folders };
  }

  /** Every entry and record (and the bytes' records an import has not written out yet: their `Blob` is not read here), the folders. */
  private async read(): Promise<LibraryRead> {
    const [entries, recs, folders] = await Promise.all([this.lib.entries(), this.lib.recs(), this.lib.folders()]);
    const byHash = new Map(recs.map((r) => [r.hash, r]));
    const tx = this.db.transaction("assets", "readonly");
    for (const k of (await req(tx.objectStore("assets").getAllKeys())) as string[]) {
      if (byHash.has(k)) continue;
      const r = await idbGet<AssetRecord>(this.db, "assets", k).catch(() => undefined);
      if (r) byHash.set(k, { ...r, hash: k });
    }
    // (seen marks only where a hidden item may need sealing again: read with its rows)
    const sealed = entries.filter((e) => e.hidden && isHiddenFile(byHash.get(e.hash)?.file)).map((e) => e.hash);
    return { entries, recs: byHash, seen: (await this.lib.rows(sealed)).seen, folders };
  }

  /**
   * Write the library's files (in the main process, from the library: `LibraryCalls.write`): the parts of `only`'s items, or all of
   * them, the index, `library.json` for a small library. Then the sealed index from the hidden items (with the key open).
   */
  private async writeJson(only?: ReadonlySet<string>): Promise<void> {
    const r = await this.lib.serial(() => this.lib.calls.write(only ? [...only] : null, libraryTesting.compatMax));
    this.lastText = r.compat;
    const sealed = (r.sealed as LibraryItem[]).sort((a, b) => (a.hash < b.hash ? -1 : 1));
    if (only) {
      const now = new Map(sealed.map((i) => [i.hash, i]));
      for (const h of only) (now.has(h) ? this.hiddenItems.set(h, now.get(h)!) : this.hiddenItems.delete(h));
    } else this.hiddenItems = new Map(sealed.map((i) => [i.hash, i]));
    const folders = await this.lib.folders();
    const shown = visibleFolders(folders);
    const index = JSON.stringify([...this.hiddenItems.values()].sort((a, b) => (a.hash < b.hash ? -1 : 1)));
    const sealedFolders = JSON.stringify(folders.filter((f) => !shown.includes(f)));
    const sealing = !!this.vault.dataKey && !(await this.anyBlank());
    if (sealing && (index !== this.lastIndex || sealedFolders !== this.lastFolders || this.vault.indexWaiting) && (index !== "[]" || sealedFolders !== "[]" || (await this.vault.state()) !== "none")) await this.vault.writeIndex(index, sealedFolders);
    if (this.vault.dataKey) (this.lastIndex = index), (this.lastFolders = sealedFolders);
    // (the folders are now what the files say: with the hidden ones only when the sealed index was written; a folder hidden while locked
    // is not in it yet, and stays this device's until it is, instead of being dropped when the key opens an older index)
    this.state = { folders: canonFolders(sealing ? folders : shown) };
    await this.setMeta(STATE_KEY, this.state);
  }
  /** The hidden items sealed, as last written. */
  private hiddenItems = new Map<string, LibraryItem>();
}
