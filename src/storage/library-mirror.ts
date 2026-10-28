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

/** `library.json`'s text: one item per line, so a sync tool or a diff shows what changed. */
export function libraryJsonText(folders: readonly AssetFolder[], items: readonly LibraryItem[]): string {
  return `{"format":"${LIBRARY_JSON_FORMAT}","version":1,\n"folders":${JSON.stringify(folders)},\n"items":[${items.length ? "\n" : ""}${items.map((i) => JSON.stringify(i)).join(",\n")}${items.length ? "\n" : ""}]}\n`;
}

export class LibraryMirror {
  private state: LibraryState = { folders: "", items: {} };
  /** The library folders' places on disk as last written (to remove the ones a rename or delete emptied). */
  private dirs = new Set<string>();
  private lastText = "";
  private lastIndex = "";
  private failing = false;
  /** Imports files found in `library/` that no item has (set by the app through `Storage.folderImports`). */
  importFiles: ((files: FolderFile[]) => Promise<void>) | null = null;
  /** Told when an item could not be moved or written, in plain words. */
  onNotice: ((text: string) => void) | null = null;

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
  async reread(): Promise<void> {
    const bytes = await this.bridge.read(LIBRARY_JSON);
    if (!bytes) return;
    let raw: Partial<LibraryJson>;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LibraryJson>;
    } catch {
      return; // damaged: written again from the app's storage
    }
    if (raw.format !== LIBRARY_JSON_FORMAT || !Array.isArray(raw.items)) return;
    const items = raw.items.map(readItem).filter((i): i is LibraryItem => i !== null);
    const vault = await this.vault.state();
    if (vault === "open") {
      try {
        const hidden = JSON.parse((await this.vault.readIndex()) ?? "[]") as unknown[];
        if (Array.isArray(hidden)) items.push(...hidden.map(readItem).filter((i): i is LibraryItem => i !== null));
      } catch {
        // a damaged index: the hidden items here stay as they are
      }
    }
    // (While the hidden items are locked, an item missing from library.json may have been hidden elsewhere, not erased.)
    await this.adopt(readFolders(raw.folders), items, vault !== "locked");
  }

  /**
   * Take what changed in the file since this device last wrote or read it, where this device did not change the same thing
   * since (then its own version stays and is written back). An item the file no longer has was erased on another device: it is
   * deleted here too (the app's garbage collection erases it once nothing needs it, or brings it back if a canvas uses it).
   */
  private async adopt(folders: AssetFolder[], items: LibraryItem[], complete: boolean): Promise<void> {
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
    }

    const inFile = new Set<string>();
    for (const it of items) {
      inFile.add(it.hash);
      const text = JSON.stringify(it);
      if (text === known[it.hash]) continue; // nothing new from the folder
      const e = await req(catalog.get(it.hash) as IDBRequest<CatalogEntry | undefined>);
      const rec = await req(assets.get(it.hash) as IDBRequest<AssetRecord | undefined>);
      if (e && JSON.stringify(itemOf(e, rec)) !== (known[it.hash] ?? "")) continue; // changed here too: this device's stays
      catalog.put(entryOf(it, e));
      if (it.file && (!rec || rec.ext)) {
        const stub: AssetRecord = { hash: it.hash, type: it.type, size: it.size, name: rec?.name ?? it.name, pixelW: it.pixelW, pixelH: it.pixelH, blob: new Blob([]), importedAt: it.importedAt, ...(it.card ? { card: true } : {}), ...(it.duration !== undefined ? { duration: it.duration } : {}), ...(it.frames !== undefined ? { frames: it.frames } : {}), ext: 1, file: it.file };
        assets.put(stub, it.hash);
      }
      known[it.hash] = text;
    }
    for (const hash of complete ? Object.keys(known) : []) {
      if (inFile.has(hash)) continue;
      const e = await req(catalog.get(hash) as IDBRequest<CatalogEntry | undefined>);
      const rec = await req(assets.get(hash) as IDBRequest<AssetRecord | undefined>);
      if (e && JSON.stringify(itemOf(e, rec)) !== known[hash]) continue; // changed here: kept
      if (e?.state === "active") catalog.put({ ...e, state: "deleted", deletedAt: Date.now() } satisfies CatalogEntry);
      delete known[hash];
    }
    tx.objectStore("meta").put(this.state, STATE_KEY);
    await committed;
  }

  /**
   * Put each original where its folder and name say, write the ones only the app's storage holds, then `library.json`.
   * False when a file could not be moved or written (it is tried again with the next change).
   */
  async write(): Promise<boolean> {
    await this.finishMove();
    const { entries, recs, folders } = await this.read();
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
      for (const m of ready) await this.place(m, taken, emptied, failed);
      pending = wait;
    }
    for (const hash of toSeal) if (this.vault.dataKey) await this.seal(hash, failed);
    // Library folders are real folders, even empty; the places a move or a rename emptied are removed.
    const wanted = new Set<string>();
    for (const f of folders) for (let d = libraryDir(folderPath(folders, f.id), "", ""); d.includes("/"); d = parentOf(d)) wanted.add(d);
    for (const d of wanted) await this.bridge.makeFolder(d);
    for (const d of [...emptied, ...this.dirs]) {
      for (let p = d; p.startsWith("library/") && !wanted.has(p); p = parentOf(p)) if (!(await this.bridge.removeEmptyFolder(p))) break;
    }
    this.dirs = wanted;
    await this.writeJson();
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

  /** Move an item's file to the first free place for its name (or write it, when only the app's storage holds the original). */
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
      } else {
        const rec = await idbGet<AssetRecord>(this.db, "assets", m.hash);
        if (!rec || rec.ext) return;
        await externalFolder.write(m.hash, rec.blob, target); // (read back and compared with the hash)
        await this.setFile(m.hash, (r) => !r.ext && r.blob.size === rec.blob.size, target);
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

  /** Point the stored original at its new file, when it is still what `still` says (else nothing changes). */
  private async setFile(hash: string, still: (r: AssetRecord) => boolean, file: string): Promise<void> {
    const tx = this.db.transaction("assets", "readwrite", { durability: "strict" });
    const committed = done(tx);
    const cur = await req(tx.objectStore("assets").get(hash) as IDBRequest<AssetRecord | undefined>);
    if (cur && still(cur)) tx.objectStore("assets").put({ ...cur, size: cur.ext ? cur.size : cur.blob.size, blob: new Blob([]), ext: 1, file } satisfies AssetRecord, hash);
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

  private async writeJson(): Promise<void> {
    const { entries, recs, folders } = await this.read();
    const items = entries.map((e) => itemOf(e, recs.get(e.hash)));
    // Sealed items are only in the sealed index (written while the key is open: sealing and opening need it). One hidden while
    // the key is locked stays in library.json, as its file stays readable, until it is sealed.
    const text = libraryJsonText(folders, items.filter((i) => !isHiddenFile(i.file)));
    if (text !== this.lastText) await this.bridge.write(LIBRARY_JSON, encode(text));
    this.lastText = text;
    const index = JSON.stringify(items.filter((i) => isHiddenFile(i.file)));
    if (this.vault.dataKey && index !== this.lastIndex && (index !== "[]" || (await this.vault.state()) !== "none")) await this.vault.writeIndex(index);
    if (this.vault.dataKey) this.lastIndex = index;
    this.state = { folders: JSON.stringify(folders), items: Object.fromEntries(items.map((i) => [i.hash, JSON.stringify(i)])) };
    await idbPut(this.db, "meta", STATE_KEY, this.state);
  }
}
