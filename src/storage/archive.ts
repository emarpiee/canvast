import { contentOf } from "../assets/library-match";
import { externalFolder } from "./external-folder";
import { storedStub } from "../assets/asset-library";
import type { SerializedCamera } from "../core/camera";
import { plural, were } from "../doc/plural";
import { deserializeCamera } from "../core/camera";
import type { FrameRecord, StoredFrameView } from "../core/frames";
import { FrameSpace, deserializeFrameCamera } from "../core/frames";
import type { CanvasObject, SerializedObject } from "../doc/model";
import { assetOf, deserializeObject, newObjectId, serializeObject, storedAssetOf } from "../doc/model";
import type { AssetRecord } from "../assets/asset-library";
import { MAX_IMPORT_BYTES } from "../assets/asset-library";
import type { CatalogEntry } from "../assets/asset-catalog";
import type { AssetField, AssetFolder } from "../assets/asset-catalog";
import { MAX_FIELDS, entryFromRecord, fieldParts, folderPath, meta, normalizeFields, normalizeNote, normalizeTags, visibleFolders } from "../assets/asset-catalog";
import { sha256Hex } from "../assets/sha256";
import type { StyleItem } from "../assets/styles";
import { cleanStyles } from "../assets/styles";
import { done, req } from "./idb";
import type { LibraryOp } from "./desktop-bridge";
import { itemOf } from "./library-mirror";
import { numberedName } from "../doc/file-names";
import { SEALED_NAME_RE, createVault, isFileV2, isHiddenFile, keyCheck, nameKeys, readVault, sealFile, sealName, sealText } from "./hidden-vault";
import type { Bookmark } from "./bookmarks";
import { readBookmarks } from "./bookmarks";
import type { BoardRecord, CanvasRecord, FrameStoreRecord, ObjectRecord, StoredView, WorkspaceRecord } from "./workspace-repo";
import type { ZipEntry, ZipInput } from "./zip";
import { hashOf } from "./disk-file";
import { ZipError, readZip, verifyEntry, writeZip } from "./zip";

/**
 * Portable archives (ADR 0008): a ZIP-compatible `.canvast` file.
 *
 *   manifest.json             format, version, scope, hierarchy, asset list
 *   canvases/<id>.json        { objects: SerializedObject[], frames: FrameRecord[], view: StoredView | null }
 *                             (version 1 had no frames: absolute objects, which import unchanged;
 *                             version 3: objects may carry `rot`, a rotation (ADR 0018), and `groups` (ADR 0020))
 *   assets/<sha256>           original bytes, exactly once per hash
 *
 * Export reads one consistent snapshot (a single read-only transaction),
 * closes over the assets the scope references, and verifies the finished
 * archive (directory, every checksum, the manifest) before handing it over.
 *
 * Import treats the file as untrusted. It is fully read and validated first,
 * without writing anything (`readArchive`). The user then confirms a summary,
 * and `applyImport` writes the originals a batch at a time, then everything
 * else in one transaction, so the import shows all or nothing (ADR 0176).
 * Boards and canvases get new ids, so importing the same archive twice never
 * overwrites anything. Object ids are kept (they are namespaced per canvas).
 * Originals are deduplicated by hash.
 */
/** The most a backup's key file of hidden items may hold: its key and their sealed index (about 1 KiB an item). */
const MAX_KEY_FILE_BYTES = 256 * 2 ** 20;

export const ARCHIVE_FORMAT = "canvast-archive";
export const ARCHIVE_VERSION = 7;

/** A video's or GIF's length and a GIF's frame count from an archive's item (a GIF without its frame count would be placed as a still). */
const playing = (a: Record<string, unknown>): { duration?: number; frames?: number } => ({
  ...(typeof a["duration"] === "number" && Number.isFinite(a["duration"]) && a["duration"] >= 0 ? { duration: a["duration"] } : {}),
  ...(Number.isInteger(a["frames"]) && (a["frames"] as number) > 1 ? { frames: a["frames"] as number } : {}),
});

/**
 * The desktop build's hidden items in a backup (version 7): each hidden file as it is sealed in `.hidden/` (it holds its own item), and
 * the key file; nothing readable of them is in the backup. Set by the desktop build; null in the browser, which cannot open them.
 */
export const sealedHooks: {
  /** The vault's key, as its spare is written (no index), or null when there is none. */
  key: (() => Promise<string | null>) | null;
  /** Put sealed files and their key into the workspace folder; how many were new. */
  write: ((files: ReadonlyArray<{ hash: string; data: Blob; at?: string }>, key: string | null, names?: ReadonlyArray<{ at: string; data: Blob }>) => Promise<number>) | null;
} = { key: null, write: null };
/** Where a backup reads custom thumbnails and an import keeps them (set by the storage that is open; normal ones only, see `CustomThumbStore`). */
export const thumbHooks: {
  get: ((hash: string) => Promise<Blob | null>) | null;
  put: ((blob: Blob) => Promise<string>) | null;
  /** A hidden custom thumbnail's sealed file as it is (desktop build): its name in `.hidden/thumbnails/` (which says nothing of the picture) and bytes. */
  getSealed?: ((hash: string) => Promise<{ name: string; data: Blob } | null>) | null;
  /** Put a sealed thumbnail file back in `.hidden/thumbnails/` under its name (desktop build). */
  putSealed?: ((name: string, data: Blob) => Promise<void>) | null;
} = { get: null, put: null };
export const ARCHIVE_EXTENSION = ".canvast";

/** Where a long job is: the stage in words and how far (done of total). The caller turns it into a progress notice. */
export type ProgressFn = (stage: string, done: number, total: number) => void;

export type ExportScope = (
  /** `since`: an incremental backup, with only what changed after that time (the `at` of the backup it goes on from). */
  | { kind: "workspace"; since?: number; /** The library index kept in the library folder (ADR 0159): everything but the bytes of the originals. Not a backup. */ noBytes?: boolean }
  | { kind: "board"; boardId: string }
  | { kind: "canvas"; canvasId: string }
  | { kind: "assets"; hashes: string[]; /** A library folder's export: the paths start at this folder. */ under?: string }
) & {
  /** Leave out the originals hidden in the library, and their names and tags (what the person chose when asked, or always for the library index). */
  skipHidden?: boolean;
  /**
   * The browser's Hidden password, when its hidden items go in: they are encrypted with it as the desktop app keeps them (sealed files, their
   * encrypted names and folders, a key file with their sealed index), so a backup carries nothing readable of them, and either app opens them.
   */
  sealWith?: string;
  /** A workspace backup that also carries the passwords (of the Hidden items and of the workspace) and the privacy settings (set by the app from Settings > Privacy). */
  withPrivacy?: boolean;
};

/**
 * The desktop build's library (ADR 0177): its entries and records are in the main process's SQLite file, not in this database. Read
 * whole before a transaction here starts (a call to the main process in the middle of one would end it), changed after it ends.
 */
export interface LibraryStore {
  entries(): Promise<CatalogEntry[]>;
  recs(): Promise<AssetRecord[]>;
  folders(): Promise<AssetFolder[]>;
  apply(ops: readonly LibraryOp[]): Promise<void>;
}
/** The library as read before a transaction: from the library store (desktop), else read in the transaction itself. */
export type LibrarySnap = { entries: Map<string, CatalogEntry>; recs: Map<string, AssetRecord>; folders: AssetFolder[] } | null;
export async function snapOf(lib: LibraryStore | undefined): Promise<LibrarySnap> {
  if (!lib) return null;
  const [entries, recs, folders] = await Promise.all([lib.entries(), lib.recs(), lib.folders()]);
  return { entries: new Map(entries.map((e) => [e.hash, e])), recs: new Map(recs.map((r) => [r.hash, r])), folders };
}
/** Library reads in `tx`, or from `snap` (a record not there may still be bytes this database holds). */
export function libraryIn(tx: IDBTransaction, snap: LibrarySnap) {
  return {
    entries: async (): Promise<CatalogEntry[]> => (snap ? [...snap.entries.values()] : req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>)),
    entry: async (hash: string): Promise<CatalogEntry | undefined> => (snap ? snap.entries.get(hash) : req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>)),
    rec: async (hash: string): Promise<AssetRecord | undefined> => snap?.recs.get(hash) ?? req(tx.objectStore("assets").get(hash) as IDBRequest<AssetRecord | undefined>),
    has: async (hash: string): Promise<boolean> => !!snap?.recs.has(hash) || (await req(tx.objectStore("assets").count(hash))) > 0,
    folders: async (): Promise<AssetFolder[]> => snap?.folders ?? ((await req(tx.objectStore("meta").get("assetFolders") as IDBRequest<AssetFolder[] | undefined>)) ?? []),
  };
}

/** The hashes of the hidden library items. */
export async function hiddenSet(tx: IDBTransaction, snap: LibrarySnap = null): Promise<Set<string>> {
  const all = await libraryIn(tx, snap).entries();
  return new Set(all.filter((e) => e.state === "active" && e.hidden).map((e) => e.hash));
}

/** How many hidden library items a scope would carry (asked before exporting). */
export async function hiddenInScope(db: IDBDatabase, scope: ExportScope, lib?: LibraryStore): Promise<number> {
  const snap = await snapOf(lib);
  const tx = db.transaction(["boards", "canvases", "objects", "assetCatalog"], "readonly");
  const hidden = await hiddenSet(tx, snap);
  if (!hidden.size || scope.kind === "workspace") return hidden.size;
  const used = new Set<string>(scope.kind === "assets" ? scope.hashes : []);
  if (scope.kind !== "assets") {
    const canvasIds: string[] = [];
    if (scope.kind === "canvas") canvasIds.push(scope.canvasId);
    else canvasIds.push(...((await req(tx.objectStore("boards").get(scope.boardId) as IDBRequest<BoardRecord | undefined>))?.canvasIds ?? []));
    for (const cid of canvasIds) {
      await eachObjects(tx, cid, (records) => {
        for (const r of records) {
          const a = storedAssetOf(r.data);
          if (a) used.add(a);
        }
      });
    }
  }
  return [...used].filter((h) => hidden.has(h)).length;
}

interface ManifestCanvas {
  id: string;
  name: string;
  objectCount: number;
  /** Absent in an incremental archive for a canvas that did not change: its content is in an earlier file of the chain. */
  file?: string;
}

interface ManifestBoard {
  id: string;
  name: string;
  canvases: ManifestCanvas[];
}

interface ManifestAsset {
  hash: string;
  name: string;
  type: string;
  size: number;
  pixelW: number;
  pixelH: number;
  importedAt: number;
  /** Absent in an incremental archive for an original that was already in the earlier files of the chain. */
  file?: string;
  card?: boolean;
  /** Organization (optional; archives from v0.3–v0.5 have none). Folders travel as name paths. */
  tags?: string[];
  favorite?: boolean;
  hidden?: boolean;
  folders?: string[][];
  note?: string;
  fields?: AssetField[];
  /** Its custom thumbnail's SHA-256: an item of the archive, or one of its `thumbnails`. */
  thumb?: string;
  viewer?: string;
}

/** An asset's organization as carried in an archive. */
export interface AssetOrganization {
  tags: string[];
  favorite: boolean;
  hidden: boolean;
  folders: string[][];
  note: string;
  fields: AssetField[];
  thumb: string | null;
  viewer: string;
}

export interface Manifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  /** The workspace it was made from (0.54.61): an import updates the one whose boards and canvases it holds, by their ids. */
  workspaceId?: string;
  /** Every library folder (0.54.61), empty ones too, by path; a hidden one marked (not the desktop app's: they are in the key file, sealed). */
  folders?: Array<{ path: string[]; hidden?: true }>;
  app: string;
  exportedAt: number;
  scope: ExportScope["kind"];
  workspaceName: string;
  boards: ManifestBoard[];
  assets: ManifestAsset[];
  /** Hashes referenced by exported instances whose originals were not stored. */
  missingAssets: string[];
  /** The saved styles of the workspace (version 4; a workspace archive only). */
  styles?: unknown[];
  /** Present for an incremental backup: what it goes on from. A chain is read oldest first, each file starting where the one before ended. */
  incremental?: { since: number };
  /** The library index of a library folder: no original has bytes in it; they are the files of the folder. */
  libraryFile?: true;
  /** The device settings that differ from the defaults (a workspace archive): theme, shortcuts, panel layout. Restored only where the importing device has not set them. */
  settings?: Record<string, unknown>;
  /** The kept form of the Hidden items' password (only when the person chose to include their privacy settings). Used on import only where the device has none. */
  hiddenLock?: string;
  /** The same for the password of the whole workspace. */
  workspaceLock?: string;
  /** Hidden items sealed as they are in the desktop build (version 7): only their content hash and file; their item is inside the file. */
  sealed?: Array<{ hash: string; file: string; at?: string }>;
  /** The sealed files' place in `.hidden/` says their names and folders; a long name's `.name` beside it, as it is (`at`: its place). */
  sealedNames?: Array<{ at: string; file: string }>;
  /** The key file of the sealed items (version 7). */
  hiddenKey?: string;
  /** Custom thumbnails the items use (their SHA-256), each as `thumbnails/<hash>.webp`. Older versions of the app pass them by. */
  thumbnails?: string[];
  /** Hidden custom thumbnails of the sealed items, as they are sealed (desktop build): each `sealed-thumbnails/<name>.bin` by its file's name. */
  sealedThumbnails?: string[];
  /** Brush presets (version 6), written by builds that had the Painting view: no longer read. */
  brushes?: unknown[];
  /** Paintings (versions 5 and 6), written by builds that had the Painting view: no longer read. */
  paintings?: { file: string; count: number; tiles: number };
}

export interface ExportResult {
  blob: Blob;
  manifest: Manifest;
  canvases: number;
  objects: number;
}

export class ArchiveError extends Error {}

const HASH_RE = /^[0-9a-f]{64}$/;
const range = (canvasId: string): IDBKeyRange => IDBKeyRange.bound([canvasId, ""], [canvasId, "￿"]);
const SLICE = 2000;
/**
 * A canvas's objects in slices: each slice arrives in a task of its own, so the browser draws between them and a big
 * canvas never blocks a frame for its whole read (the library index is written in the background while one works).
 */
async function eachObjects(tx: IDBTransaction, canvasId: string, fn: (records: ObjectRecord[]) => void): Promise<number> {
  let n = 0;
  let after: string | null = null;
  for (;;) {
    const keys: IDBKeyRange = after === null ? range(canvasId) : IDBKeyRange.bound([canvasId, after], [canvasId, "￿"], true);
    const records = await req(tx.objectStore("objects").getAll(keys, SLICE) as IDBRequest<ObjectRecord[]>);
    if (records.length) fn(records);
    n += records.length;
    if (records.length < SLICE) return n;
    after = records[records.length - 1]!.id;
  }
}

/**
 * One canvas as JSON (`{...head, "objects": [...], "frames": [...], "view"?: ..., "bookmarks"?: [...]}`), shared by backups
 * (`canvases/<id>.json`) and the desktop build's canvas files (`.cvst`, ADR 0177). It is made of parts, one per slice, never
 * as one string: each slice is encoded into a Blob as it comes (joining Blobs copies nothing), so no single step encodes the
 * whole canvas. `withView`: the camera goes in too (a backup; a canvas file leaves it to the device). `tx` reads "objects",
 * "frames", "bookmarks" and, with the view, "canvasViews".
 */
export async function canvasJson(tx: IDBTransaction, cid: string, head: Record<string, unknown>, withView: boolean, onRecords?: (records: ObjectRecord[]) => void): Promise<{ json: BlobPart[]; count: number }> {
  const start = JSON.stringify(head);
  const json: BlobPart[] = [`${start.slice(0, -1)}${start.length > 2 ? "," : ""}"objects":[`];
  const count = await eachObjects(tx, cid, (records) => {
    onRecords?.(records);
    const part = JSON.stringify(records.map((r) => r.data));
    json.push(new Blob([json.length > 1 ? "," : "", part.slice(1, -1)]));
  });
  const view = withView ? ((await req(tx.objectStore("canvasViews").get(cid) as IDBRequest<StoredView | undefined>)) ?? null) : undefined;
  const frames = (await req(tx.objectStore("frames").getAll(range(cid)) as IDBRequest<FrameStoreRecord[]>)).map(({ canvasId: _c, ...f }): FrameRecord => f);
  const marks = readBookmarks(((await req(tx.objectStore("bookmarks").get(cid) as IDBRequest<{ items?: unknown } | undefined>)) ?? {}).items);
  json.push("],", JSON.stringify({ frames, ...(withView ? { view } : {}), ...(marks.length ? { bookmarks: marks } : {}) }).slice(1));
  return { json, count };
}

/** Build and verify an archive for `scope`. Nothing is written to storage. */
export async function buildArchive(db: IDBDatabase, workspaceId: string, scope: ExportScope, app: string, settings?: Record<string, unknown>, progress?: ProgressFn, lib?: LibraryStore): Promise<ExportResult> {
  const snap = await snapOf(lib);
  const tx = db.transaction(["workspaces", "boards", "canvases", "objects", "frames", "canvasViews", "bookmarks", "assets", "assetCatalog", "meta"], "readonly");
  const ws = await req(tx.objectStore("workspaces").get(workspaceId) as IDBRequest<WorkspaceRecord | undefined>);
  if (!ws) throw new ArchiveError("workspace not found");
  const boards: ManifestBoard[] = [];
  const canvasFiles: Array<{ file: string; json: BlobPart[] }> = [];
  // (a copy of a file elsewhere in the library goes as its content, once: a backup keeps each content one time)
  const hashes = new Set<string>(scope.kind === "assets" ? scope.hashes.map(contentOf) : []);
  const since = scope.kind === "workspace" ? scope.since : undefined;
  const noBytes = scope.kind === "workspace" && scope.noBytes === true;
  let objects = 0;

  const boardIds = scope.kind === "workspace" ? ws.boardIds : scope.kind === "board" ? [scope.boardId] : [];
  let canvasFilter: string | null = null;
  if (scope.kind === "canvas") {
    const c = await req(tx.objectStore("canvases").get(scope.canvasId) as IDBRequest<CanvasRecord | undefined>);
    if (!c) throw new ArchiveError("canvas not found");
    boardIds.push(c.boardId);
    canvasFilter = c.id;
  }
  for (const bid of boardIds) {
    const b = await req(tx.objectStore("boards").get(bid) as IDBRequest<BoardRecord | undefined>);
    if (!b) throw new ArchiveError("board not found");
    const mb: ManifestBoard = { id: b.id, name: b.name, canvases: [] };
    for (const cid of b.canvasIds) {
      if (canvasFilter && cid !== canvasFilter) continue;
      const c = await req(tx.objectStore("canvases").get(cid) as IDBRequest<CanvasRecord | undefined>);
      if (!c) continue;
      if (since !== undefined && c.updatedAt <= since) {
        // an incremental backup does not repeat a canvas that has not changed since the backup it goes on from
        mb.canvases.push({ id: c.id, name: c.name, objectCount: c.objectCount });
        await eachObjects(tx, cid, (records) => {
          for (const r of records) {
            const a = storedAssetOf(r.data);
            if (a) hashes.add(a);
          }
        });
        continue;
      }
      const { json, count } = await canvasJson(tx, cid, {}, true, (records) => {
        for (const r of records) {
          const a = storedAssetOf(r.data);
          if (a) hashes.add(a);
        }
      });
      const file = `canvases/${c.id}.json`;
      canvasFiles.push({ file, json });
      mb.canvases.push({ id: c.id, name: c.name, objectCount: count, file });
      objects += count;
    }
    boards.push(mb);
  }
  if (scope.kind === "workspace") {
    // A full backup also keeps library assets that nothing uses yet.
    for (const e of await libraryIn(tx, snap).entries()) if (e.state === "active") hashes.add(contentOf(e.hash));
  }
  if (scope.skipHidden) for (const h of await hiddenSet(tx, snap)) hashes.delete(h);
  const hiddenLock = scope.kind === "workspace" && scope.withPrivacy && !noBytes ? await req(tx.objectStore("meta").get("hiddenLock") as IDBRequest<unknown>) : undefined;
  const workspaceLock = scope.kind === "workspace" && scope.withPrivacy && !noBytes ? await req(tx.objectStore("meta").get("workspaceLock") as IDBRequest<unknown>) : undefined;
  const assets: ManifestAsset[] = [];
  const assetBlobs: ZipInput[] = [];
  const sealed: Array<{ hash: string; file: string; at?: string }> = [];
  /** The custom thumbnails of the sealed items (their item is inside their file, so the list does not name them). */
  const sealedThumbs = new Set<string>();
  const sealedReads: Array<{ input: ZipInput; file: string }> = [];
  const missingAssets: string[] = [];
  const kept: Array<{ input: ZipInput; hash: string; size: number; type: string; file: string | undefined }> = [];
  let folders: AssetFolder[] | undefined;
  const sortedHashes = [...hashes].sort();
  const sealHere: Array<{ r: AssetRecord; entry: CatalogEntry | null; folders: string[]; folderIds: string[] }> = [];
  for (const [i, hash] of sortedHashes.entries()) {
    progress?.("Reading the library", i, sortedHashes.length);
    const r = await libraryIn(tx, snap).rec(hash);
    if (!r) {
      missingAssets.push(hash);
      continue;
    }
    // A hidden item sealed in the workspace folder goes as it is: its file holds its name and the rest, so the list says nothing of it.
    if (r.ext && isHiddenFile(r.file) && sealedHooks.key) {
      if (noBytes || (since !== undefined && r.importedAt <= since)) continue;
      const t = (await libraryIn(tx, snap).entry(hash))?.thumb;
      if (t) sealedThumbs.add(t);
      const input: ZipInput = { name: `sealed/${hash}.bin`, data: new Blob([]) };
      sealed.push({ hash, file: input.name, at: r.file! }); // (its place: encrypted folder and file names, nothing readable)
      assetBlobs.push(input);
      sealedReads.push({ input, file: r.file! });
      continue;
    }
    // Too big to read into the page, in a build that cannot write it a part at a time: not in the backup, counted with the missing.
    if (r.ext && r.size > MAX_IMPORT_BYTES && !noBytes && !externalFolder.takesBig) {
      missingAssets.push(hash);
      continue;
    }
    const file = `assets/${hash}`;
    const known = noBytes || (since !== undefined && r.importedAt <= since); // already in an earlier file of the chain: its list entry, not its bytes
    const entry = await libraryIn(tx, snap).entry(hash);
    const m = entry ? meta(entry) : { tags: [], favorite: false, hidden: false, folderIds: [], note: "", fields: [], thumb: null };
    folders ??= await libraryIn(tx, snap).folders();
    const allFolders = folders;
    // (the browser's hidden items, with its Hidden password: encrypted after the last read of the database, below, as the desktop app's)
    if (scope.sealWith && !sealedHooks.key && m.hidden && !noBytes) {
      sealHere.push({ r, entry: entry ?? null, folders: m.folderIds.length ? folderPath(allFolders, m.folderIds[0]!) : [], folderIds: m.folderIds.slice(0, 1) });
      continue;
    }
    assets.push({
      hash,
      name: entry?.name ?? r.name,
      type: r.type,
      size: r.ext ? r.size : r.blob.size,
      pixelW: r.pixelW,
      pixelH: r.pixelH,
      // (when it came into the library is its item's, what Newest sorts by: the stored record's can differ, and gave another order there)
      importedAt: entry?.importedAt ?? r.importedAt,
      ...(r.card ? { card: true } : {}),
      ...(r.duration !== undefined ? { duration: r.duration } : {}),
      ...(r.frames !== undefined ? { frames: r.frames } : {}),
      ...(known ? {} : { file }),
      tags: m.tags,
      favorite: m.favorite,
      ...(m.hidden ? { hidden: true } : {}),
      folders: m.folderIds.map((id) => folderPath(allFolders, id)).filter((p) => p.length > 0),
      ...(m.note ? { note: m.note } : {}),
      ...(m.fields.length ? { fields: m.fields } : {}),
      ...(m.thumb ? { thumb: m.thumb } : {}),
      ...(entry?.viewer ? { viewer: entry.viewer } : {}),
    });
    if (!known) {
      const input: ZipInput = { name: file, data: r.blob };
      assetBlobs.push(input);
      if (r.ext) kept.push({ input, hash, size: r.size, type: r.type, file: r.file });
    }
  }
  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    app,
    exportedAt: Date.now(),
    scope: scope.kind,
    workspaceName: ws.displayName,
    boards,
    assets,
    missingAssets,
    ...(scope.kind === "workspace" ? { workspaceId: ws.id, folders: await foldersOut(await libraryIn(tx, snap).folders(), !scope.skipHidden && !sealedHooks.key) } : {}),
    ...(scope.kind === "workspace" ? { styles: (((await req(tx.objectStore("meta").get("styles") as IDBRequest<unknown>)) as unknown[] | undefined) ?? []).slice(0, 5000) } : {}),
    ...(since !== undefined ? { incremental: { since } } : {}),
    ...(noBytes ? { libraryFile: true as const } : {}),
    ...(scope.kind === "workspace" && settings && Object.keys(settings).length ? { settings } : {}),
    ...(typeof hiddenLock === "string" ? { hiddenLock } : {}),
    ...(typeof workspaceLock === "string" ? { workspaceLock } : {}),
    ...(sealed.length ? { sealed, hiddenKey: "hidden-key.json" } : {}),
  };
  // The custom thumbnails its items use that are not items of it (uploaded ones), as files of their own (read after the database).
  const thumbnails: string[] = [];
  for (const t of new Set(assets.flatMap((a) => (a.thumb && !assets.some((x) => x.hash === a.thumb) ? [a.thumb] : [])))) {
    const blob = await thumbHooks.get?.(t).catch(() => null);
    if (!blob) continue;
    assetBlobs.push({ name: `thumbnails/${t}.webp`, data: blob });
    thumbnails.push(t);
  }
  // The sealed items' custom thumbnails: a normal one as above; a hidden one as its sealed file (nothing readable of it goes).
  const sealedThumbnails: string[] = [];
  for (const t of sealedThumbs) {
    if (thumbnails.includes(t) || assets.some((x) => x.hash === t)) continue;
    const normal = await thumbHooks.get?.(t).catch(() => null);
    if (normal) {
      assetBlobs.push({ name: `thumbnails/${t}.webp`, data: normal });
      thumbnails.push(t);
      continue;
    }
    const sealedThumb = await thumbHooks.getSealed?.(t).catch(() => null);
    if (!sealedThumb || sealedThumbnails.includes(sealedThumb.name)) continue;
    assetBlobs.push({ name: `sealed-thumbnails/${sealedThumb.name}.bin`, data: sealedThumb.data });
    sealedThumbnails.push(sealedThumb.name);
  }
  if (thumbnails.length) manifest.thumbnails = thumbnails;
  if (sealedThumbnails.length) manifest.sealedThumbnails = sealedThumbnails;
  const keyText = sealed.length ? await sealedHooks.key!() : null;
  if (sealed.length && !keyText) throw new ArchiveError("the hidden items' key file could not be read, so their sealed files would not open from the backup");
  const sealedNames: Array<{ at: string; file: string }> = [];
  for (const s of sealedReads) {
    const blob = await externalFolder.readRaw(s.file);
    if (!blob) throw new ArchiveError("a hidden item's sealed file is missing from the workspace folder");
    s.input.data = blob;
    // A long name, of the file or of a folder of it, is kept beside it in `.name`: it goes too.
    const parts = s.file.split("/");
    for (const at of [`${s.file}.name`, ...parts.slice(2, -1).map((_, i) => `${parts.slice(0, i + 2).join("/")}/.name`)]) {
      if (sealedNames.some((n) => n.at === at)) continue;
      const name = await externalFolder.readRaw(at).catch(() => null);
      if (!name) continue;
      const file = `sealed-names/${sealedNames.length}.bin`;
      assetBlobs.push({ name: file, data: name });
      sealedNames.push({ at, file });
    }
  }
  if (sealedNames.length) manifest.sealedNames = sealedNames;
  if (keyText) assetBlobs.push({ name: "hidden-key.json", data: new Blob([keyText], { type: "application/json" }) });
  if (sealHere.length) await sealForBackup(sealHere, scope.sealWith!, folders ?? [], sealed, sealedNames, assetBlobs, manifest, progress);
  // Originals kept in the library folder are read now, after the last read of the database (the manifest's styles) (ADR 0159). A backup that
  // cannot hold one says so and stops: it never leaves an original out.
  for (const [i, k] of kept.entries()) {
    progress?.("Reading the files of the library folder", i, kept.length);
    const blob = await externalFolder.read(k.hash, k.size, k.type, k.file);
    if (!blob) throw new ArchiveError("a file of the library folder is missing or not reachable: reconnect the folder in the storage panel, then export again");
    k.input.data = blob;
  }

  const json = (s: string | BlobPart[]): Blob => new Blob(typeof s === "string" ? [s] : s, { type: "application/json" });
  const blob = await writeZip(
    [
      { name: "manifest.json", data: json(JSON.stringify(manifest, null, 1)) },
      ...canvasFiles.map((c) => ({ name: c.file, data: json(c.json) })),
      ...assetBlobs,
    ],
    new Date(),
    false,
    (d, n) => progress?.("Writing the archive", d, n),
  );
  // Verify what will be handed over: directory, every checksum, and the manifest.
  const entries = await readZip(blob);
  let checked = 0;
  for (const e of entries.values()) {
    await verifyEntry(e);
    progress?.("Checking the archive", ++checked, entries.size);
  }
  const back = JSON.parse(await entries.get("manifest.json")!.data.text()) as Manifest;
  if (JSON.stringify(back) !== JSON.stringify(manifest) || entries.size !== 1 + canvasFiles.length + assetBlobs.length) {
    throw new ArchiveError("the archive failed verification after writing");
  }
  return { blob, manifest, canvases: canvasFiles.length, objects };
}

// ---- import -----------------------------------------------------------

export interface PlannedCanvas {
  /** Its id where it was made: an update replaces the canvas of that id. */
  id?: string;
  name: string;
  objects: CanvasObject[];
  view: StoredView | null;
  /** The frames the objects, the view and the bookmarks need (version 2 archives; empty for version 1). */
  frames: FrameRecord[];
  bookmarks: Bookmark[];
}

export interface ImportPlan {
  scope: ExportScope["kind"];
  /** "add": new boards beside what is there (the default); "update": this workspace made as the backup is (its boards and canvases by id). */
  mode: "add" | "update";
  /** The workspace it was made from, when it says (0.54.61). */
  workspaceId: string | null;
  /** The library folders it lists (0.54.61), empty ones and hidden ones too. */
  folders: Array<{ path: string[]; hidden: boolean }>;
  /** Canvases it lists that did not change since the backup it goes on from (an incremental one): an update keeps them as they are. */
  unchangedIds: string[];
  workspaceName: string;
  exportedAt: number;
  boards: Array<{ id?: string; name: string; canvases: PlannedCanvas[] }>;
  /** Originals whose bytes matched their hash. */
  assets: AssetRecord[];
  /** Tags, favourite flag and folder paths per asset hash (merged into the library on import). */
  organization: Map<string, AssetOrganization>;
  /** Hashes referenced by instances in the archive with no valid original in it. */
  unresolved: string[];
  /** The file is a library index (no original has bytes in it), not a backup. */
  libraryFile: boolean;
  /** The device settings the archive carries (empty when none). */
  settings: Record<string, unknown>;
  /** The password of the Hidden items the archive carries, or null. */
  hiddenLock: string | null;
  workspaceLock: string | null;
  /** Everything skipped, with reasons. Nothing is silently repaired. */
  problems: string[];
  objects: number;
  /** The saved styles the archive carries (version 4), checked: they are added to the library on import (the ones it has already are kept). */
  styles: StyleItem[];
  /** How many archive files this was made from (more than one: a chain of incremental backups). */
  files: number;
  /** This one file is an incremental backup on its own: what did not change is in the files before it, which were not added. */
  incrementalOnly: boolean;
  /** Hidden items sealed by the desktop build (version 7), as they are, and their key file: put into the workspace folder there. */
  sealed: Array<{ hash: string; data: Blob; at?: string }>;
  sealedNames: Array<{ at: string; data: Blob }>;
  /** Custom thumbnails whose bytes matched their hash (kept by the import with `thumbHooks`). */
  thumbnails: Blob[];
  /** Hidden custom thumbnails as they are sealed, by their file's name (put back only with the sealed items). */
  sealedThumbnails: Array<{ name: string; data: Blob }>;
  hiddenKey: string | null;
}

export interface ImportResult {
  boards: number;
  canvases: number;
  objects: number;
  /** Originals newly stored (the rest were already in the library). */
  assetsAdded: number;
  /** Instance hashes still without an original after the import. */
  stillMissing: number;
  /** The first canvas created (null for an assets-only archive). */
  firstCanvasId: string | null;
  /** Saved styles added to the library. */
  stylesAdded: number;
  /** An update: canvases this workspace changed since its last backup, kept beside the backup's as conflict copies. */
  conflicts?: number;
  /** An update: canvases not in the backup (deleted where it was made), put on a board of their own; items not in it, deleted. */
  canvasesSetAside?: number;
  itemsDeleted?: number;
}

/** Largest JSON part accepted, to fail fast instead of exhausting memory. */
const MAX_JSON_BYTES = 1024 * 2 ** 20;

async function readJson(entries: Map<string, ZipEntry>, name: string): Promise<unknown> {
  const e = entries.get(name);
  if (!e) throw new ArchiveError(`the archive is missing "${name}"`);
  if (e.size > MAX_JSON_BYTES) throw new ArchiveError(`"${name}" is too large`);
  await verifyEntry(e);
  try {
    return JSON.parse(await e.data.text());
  } catch {
    throw new ArchiveError(`"${name}" is not valid JSON`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v.slice(0, 500) : fallback);
const posInt = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) > 0;

interface Part {
  m: Record<string, unknown>;
  entries: Map<string, ZipEntry>;
}

/** Open one archive file and check its manifest (the canvases and originals are read, and checked, when a plan is made of it). */
async function readPart(file: Blob): Promise<Part> {
  let entries: Map<string, ZipEntry>;
  try {
    entries = await readZip(file);
  } catch (e) {
    throw new ArchiveError(e instanceof ZipError ? e.message : "the file could not be read as an archive");
  }
  const m = await readJson(entries, "manifest.json");
  if (!isObj(m) || m["format"] !== ARCHIVE_FORMAT) throw new ArchiveError("this is not a canvast archive");
  if (!Number.isSafeInteger(m["version"]) || (m["version"] as number) < 1) throw new ArchiveError("the archive has an invalid version");
  if ((m["version"] as number) > ARCHIVE_VERSION) throw new ArchiveError(`the archive was made by a newer canvast (format ${m["version"]}); update canvast to import it`);
  const scope = m["scope"];
  if (scope !== "workspace" && scope !== "board" && scope !== "canvas" && scope !== "assets") throw new ArchiveError("the archive has an unknown scope");
  if (!Array.isArray(m["boards"]) || !Array.isArray(m["assets"])) throw new ArchiveError("the archive manifest is damaged");
  return { m, entries };
}

const sinceOf = (p: Part): number | null => (isObj(p.m["incremental"]) && Number.isFinite(p.m["incremental"]["since"]) ? (p.m["incremental"]["since"] as number) : null);
const exportedAtOf = (p: Part): number => (typeof p.m["exportedAt"] === "number" ? p.m["exportedAt"] : 0);

/**
 * Validate one canvas's JSON (a backup's `canvases/<id>.json` or a `.cvst` canvas file): damaged objects, frames, a view
 * or bookmarks are skipped with a line in `problems`; the hashes its objects use are added to `referenced`. Throws
 * ArchiveError when it is not a canvas at all.
 */
export function readCanvasData(data: unknown, name: string, problems: string[], referenced: Set<string>): PlannedCanvas {
  if (!isObj(data) || !Array.isArray(data["objects"])) throw new ArchiveError(`canvas "${name}" is damaged`);
  const objects: CanvasObject[] = [];
  const seen = new Set<string>();
  let bad = 0;
  const space = new FrameSpace();
  if (Array.isArray(data["frames"]) && data["frames"].length) {
    try {
      space.restore(data["frames"] as FrameRecord[]);
    } catch (e) {
      problems.push(`The frames of “${name}” were damaged (${(e as Error).message}); objects that need them were skipped.`);
    }
  }
  for (const s of data["objects"] as unknown[]) {
    try {
      const o = deserializeObject(s as SerializedObject, space);
      if (seen.has(o.id)) throw new Error("duplicate id");
      seen.add(o.id);
      objects.push(o);
      const a = assetOf(o);
      if (a) referenced.add(a);
    } catch {
      bad++;
    }
  }
  if (bad) problems.push(`${plural(bad, "damaged object")} on “${name}” ${were(bad)} skipped.`);
  let view: StoredView | null = null;
  let viewFrame = space.world;
  if (data["view"] != null) {
    try {
      const v = data["view"] as StoredView;
      if (isObj(v) && "v" in v) viewFrame = deserializeFrameCamera(space, v as StoredFrameView).f;
      else deserializeCamera(v as SerializedCamera);
      view = v;
    } catch {
      problems.push(`The saved view of “${name}” was invalid; it will open at the origin.`);
    }
  }
  // Bookmarks (version 3): keep the ones whose frame and view are valid.
  const bookmarks: Bookmark[] = [];
  let lostMarks = 0;
  for (const b of readBookmarks(data["bookmarks"])) {
    try {
      deserializeFrameCamera(space, b.view);
      bookmarks.push(b);
    } catch {
      lostMarks++;
    }
  }
  if (lostMarks || (Array.isArray(data["bookmarks"]) && bookmarks.length + lostMarks < data["bookmarks"].length)) problems.push(`Some bookmarks of “${name}” were damaged and were skipped.`);
  const frames = space.records([viewFrame, ...bookmarks.flatMap((b) => space.frameByUid(b.view.frame) ?? []), ...objects.flatMap((o) => (o.frame ? [o.frame] : []))]);
  return { name, objects, view, frames, bookmarks };
}

/**
 * Write a validated canvas's objects, frames and bookmarks under `canvasId` (an import, or a workspace folder's canvas file
 * read into the app's storage). `tx` writes "objects", "frames" and "bookmarks"; what was there before is the caller's to clear.
 */
export function putCanvasContent(tx: IDBTransaction, canvasId: string, c: Pick<PlannedCanvas, "objects" | "frames" | "bookmarks">): void {
  for (const o of c.objects) tx.objectStore("objects").put({ canvasId, id: o.id, data: serializeObject(o) } satisfies ObjectRecord);
  for (const f of c.frames) tx.objectStore("frames").put({ ...f, canvasId } satisfies FrameStoreRecord);
  if (c.bookmarks.length) tx.objectStore("bookmarks").put({ canvasId, items: c.bookmarks });
}

/** Read and validate an archive completely. Writes nothing. Throws ArchiveError if it cannot be imported at all. */
/** The files of a library folder by hash: what an archive without bytes (the library index) is matched with. */
export type FolderFiles = ReadonlyMap<string, { file: string; size: number }>;

export async function readArchive(file: Blob, folder?: FolderFiles, progress?: ProgressFn): Promise<ImportPlan> {
  return planOf([await readPart(file)], folder, progress);
}

/**
 * Read a chain of archives as one: a full backup and the incremental backups that go on from it, in any order (they are sorted by the
 * time they were made, and each must start where the one before ended). A canvas or an original is taken from the newest file that has it.
 */
export async function readArchiveChain(files: readonly Blob[], progress?: ProgressFn): Promise<ImportPlan> {
  if (files.length === 1) return readArchive(files[0]!, undefined, progress);
  const parts = (await Promise.all(files.map(readPart))).sort((a, b) => exportedAtOf(a) - exportedAtOf(b));
  if (sinceOf(parts[0]!) !== null) throw new ArchiveError("the earliest of these files is an incremental backup: add the full backup it goes on from");
  for (let i = 1; i < parts.length; i++) {
    const since = sinceOf(parts[i]!);
    if (since === null) throw new ArchiveError("only the first file of a chain can be a full backup: these files are not one chain");
    if (since !== exportedAtOf(parts[i - 1]!)) throw new ArchiveError(`a file is missing from the chain: the backup of ${new Date(exportedAtOf(parts[i]!)).toLocaleString()} goes on from one made at ${new Date(since).toLocaleString()}`);
  }
  if (parts.some((p) => p.m["scope"] !== "workspace")) throw new ArchiveError("a chain is made of backups of the whole workspace");
  return planOf(parts, undefined, progress);
}

/** The plan to import from the parts of a chain (one part for an ordinary archive). The newest manifest says what there is; the files hold it. */
async function planOf(parts: Part[], folder?: FolderFiles, progress?: ProgressFn): Promise<ImportPlan> {
  const latest = parts[parts.length - 1]!;
  const m = latest.m;
  const scope = m["scope"] as ExportScope["kind"];
  const problems: string[] = [];
  const okId = (v: unknown): string | undefined => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined);
  const plan: ImportPlan = {
    scope,
    mode: "add",
    unchangedIds: [],
    workspaceId: okId(m["workspaceId"]) ?? null,
    folders: (Array.isArray(m["folders"]) ? (m["folders"] as unknown[]) : []).flatMap((f) => {
      const path = isObj(f) && Array.isArray(f["path"]) ? (f["path"] as unknown[]) : [];
      return path.length && path.length <= 32 && path.every((n) => typeof n === "string" && n.trim() && n.length <= 200) ? [{ path: path as string[], hidden: isObj(f) && f["hidden"] === true }] : [];
    }),
    workspaceName: str(m["workspaceName"], "workspace"),
    exportedAt: typeof m["exportedAt"] === "number" ? m["exportedAt"] : 0,
    boards: [],
    assets: [],
    organization: new Map(),
    unresolved: [],
    libraryFile: m["libraryFile"] === true,
    settings: isObj(m["settings"]) ? (m["settings"] as Record<string, unknown>) : {},
    workspaceLock: typeof m["workspaceLock"] === "string" && /^pbkdf2\$\d{1,8}\$[A-Za-z0-9+/=]{1,64}\$[A-Za-z0-9+/=]{1,128}$/.test(m["workspaceLock"]) ? m["workspaceLock"] : null,
    hiddenLock: typeof m["hiddenLock"] === "string" && /^pbkdf2\$\d{1,8}\$[A-Za-z0-9+/=]{1,64}\$[A-Za-z0-9+/=]{1,128}$/.test(m["hiddenLock"]) ? m["hiddenLock"] : null,
    problems,
    objects: 0,
    styles: [],
    files: parts.length,
    incrementalOnly: parts.length === 1 && sinceOf(latest) !== null,
    sealed: [],
    hiddenKey: null,
    thumbnails: [],
    sealedThumbnails: [],
    sealedNames: [],
  };
  // where a canvas is: in the newest file that has its content
  const canvasAt = (id: string): { entries: Map<string, ZipEntry>; file: string } | null => {
    for (let i = parts.length - 1; i >= 0; i--) {
      for (const b of parts[i]!.m["boards"] as unknown[]) {
        if (!isObj(b) || !Array.isArray(b["canvases"])) continue;
        for (const c of b["canvases"] as unknown[]) if (isObj(c) && c["id"] === id && typeof c["file"] === "string") return { entries: parts[i]!.entries, file: c["file"] };
      }
    }
    return null;
  };
  const referenced = new Set<string>();
  for (const b of m["boards"] as unknown[]) {
    if (!isObj(b) || !Array.isArray(b["canvases"])) throw new ArchiveError("the archive manifest is damaged");
    const board = { ...(okId(b["id"]) ? { id: okId(b["id"])! } : {}), name: str(b["name"], "Imported board"), canvases: [] as PlannedCanvas[] };
    for (const c of b["canvases"] as unknown[]) {
      if (!isObj(c)) throw new ArchiveError("the archive manifest is damaged");
      const name = str(c["name"], "Imported canvas");
      const where = typeof c["file"] === "string" ? { entries: latest.entries, file: c["file"] } : typeof c["id"] === "string" ? canvasAt(c["id"]) : null;
      if (!where) {
        if (c["file"] === undefined) {
          if (okId(c["id"])) plan.unchangedIds.push(okId(c["id"])!);
          problems.push(`“${name}” did not change since the backup this one goes on from, and that file was not added: it is not imported.`);
          continue;
        }
        throw new ArchiveError("the archive manifest is damaged");
      }
      const data = await readJson(where.entries, where.file);
      const planned = readCanvasData(data, name, problems, referenced);
      if (okId(c["id"])) planned.id = okId(c["id"])!;
      board.canvases.push(planned);
      plan.objects += planned.objects.length;
    }
    if (board.canvases.length) plan.boards.push(board);
  }
  // (an incremental one whose canvases did not change, only the library's items, lists them all the same: it is not empty)
  if (scope !== "assets" && plan.boards.length === 0 && !plan.unchangedIds.length) throw new ArchiveError("the archive contains no canvases");

  // the originals: each one's list entry from the newest file, its bytes from the newest file that holds them
  const listed = new Map<string, { a: Record<string, unknown>; at: { entries: Map<string, ZipEntry>; file: string } | null }>();
  for (const part of parts) {
    for (const a of part.m["assets"] as unknown[]) {
      if (!isObj(a)) throw new ArchiveError("the archive manifest is damaged");
      const hash = String(a["hash"]);
      const prev = listed.get(hash);
      listed.set(hash, { a, at: typeof a["file"] === "string" ? { entries: part.entries, file: a["file"] } : (prev?.at ?? null) });
    }
  }
  const valid = new Set<string>();
  const seenHash = new Set<string>();
  let seenItems = 0;
  for (const { a, at } of listed.values()) {
    progress?.("Checking the files", seenItems++, listed.size);
    const hash = String(a["hash"]);
    const label = str(a["name"], "") || hash.slice(0, 12);
    const e = at ? at.entries.get(at.file) : undefined;
    const type = str(a["type"], "") || "application/octet-stream";
    if (!HASH_RE.test(hash) || seenHash.has(hash)) {
      problems.push(`Library item “${label}” has an invalid or repeated content hash and was skipped.`);
      continue;
    }
    seenHash.add(hash);
    if (!at && folder) {
      // The library index: this original is the file of the folder with its hash, when it is there with the size the file says.
      const f = folder.get(hash);
      if (!f || f.size !== a["size"] || !posInt(a["pixelW"]) || !posInt(a["pixelH"])) {
        problems.push(`Library item “${label}”: ${f ? "its file in the folder has another size" : "its file is not in the folder"}, so it shows as missing.`);
        continue;
      }
      valid.add(hash);
      plan.assets.push({
        hash,
        type,
        size: f.size,
        name: str(a["name"], ""),
        pixelW: a["pixelW"] as number,
        pixelH: a["pixelH"] as number,
        blob: new Blob([]),
        importedAt: typeof a["importedAt"] === "number" ? a["importedAt"] : Date.now(),
        ...(a["card"] === true ? { card: true } : {}),
        ...playing(a),
        ext: 1,
        file: f.file,
      });
      const org = readOrganization(a, label, problems);
      if (org) plan.organization.set(hash, org);
      continue;
    }
    if (e && e.size > MAX_IMPORT_BYTES && !externalFolder.takesBig) {
      problems.push(`Library item “${label}” is larger than ${MAX_IMPORT_BYTES / 2 ** 20} MiB, too big for this build, and was skipped. The desktop app takes it.`);
      continue;
    }
    if (!e || !posInt(a["pixelW"]) || !posInt(a["pixelH"])) {
      problems.push(`Library item “${label}” is missing or invalid in the archive and was skipped.`);
      continue;
    }
    // The bytes are read for the hash and let go: the plan keeps a slice of the file, read again when it is written (ADR 0176).
    if ((e.size > MAX_IMPORT_BYTES ? await hashOf(e.data) : await sha256Hex(await e.data.arrayBuffer())) !== hash) {
      problems.push(`Library item “${label}” does not match its content hash (damaged) and was skipped.`);
      continue;
    }
    valid.add(hash);
    plan.assets.push({
      hash,
      type,
      size: e.size,
      name: str(a["name"], ""),
      pixelW: a["pixelW"] as number,
      pixelH: a["pixelH"] as number,
      blob: e.data.slice(0, e.size, type),
      importedAt: typeof a["importedAt"] === "number" ? a["importedAt"] : Date.now(),
      ...(a["card"] === true ? { card: true } : {}),
      ...playing(a),
    });
    const org = readOrganization(a, label, problems);
    if (org) plan.organization.set(hash, org);
  }
  // Hidden items sealed as they were in the desktop build (version 7): they stay sealed; the desktop build puts them into `.hidden/`, and
  // they show once the Hidden items are opened (each file holds its item). Their content hash cannot be checked without the password.
  const sealedSeen = new Set<string>();
  for (let i = parts.length - 1; i >= 0; i--) {
    const pm = parts[i]!.m;
    for (const s of Array.isArray(pm["sealed"]) ? (pm["sealed"] as unknown[]) : []) {
      if (!isObj(s) || typeof s["hash"] !== "string" || !HASH_RE.test(s["hash"]) || typeof s["file"] !== "string" || sealedSeen.has(s["hash"]) || valid.has(s["hash"])) continue;
      const e = parts[i]!.entries.get(s["file"]);
      const head = e ? new Uint8Array(await e.data.slice(0, 8).arrayBuffer()) : null;
      if (!e || !head || e.size < 28 || (!externalFolder.takesBig && e.size > MAX_IMPORT_BYTES + 2 ** 22) || (e.size > 64 && !isFileV2(head) && e.size > MAX_IMPORT_BYTES + 28)) {
        problems.push("A hidden item's sealed file is missing or damaged in the archive and was skipped.");
        continue;
      }
      sealedSeen.add(s["hash"]);
      plan.sealed.push({ hash: s["hash"], data: e.data.slice(0, e.size), ...(typeof s["at"] === "string" && isHiddenFile(s["at"]) ? { at: s["at"] } : {}) });
    }
    for (const n of Array.isArray(pm["sealedNames"]) ? (pm["sealedNames"] as unknown[]) : []) {
      if (!isObj(n) || typeof n["at"] !== "string" || !SEALED_NAME_RE.test(n["at"]) || typeof n["file"] !== "string" || plan.sealedNames.some((x) => x.at === n["at"])) continue;
      const e = parts[i]!.entries.get(n["file"]);
      if (e && e.size < 4096) plan.sealedNames.push({ at: n["at"], data: e.data.slice(0, e.size) });
    }
    if (plan.hiddenKey === null && typeof pm["hiddenKey"] === "string") {
      const ke = parts[i]!.entries.get(pm["hiddenKey"]);
      // (it holds the hidden items' sealed index since 0.54.57: their dates, tags and notes, so as big as they are; 4 KiB took only the key)
      const text = ke && ke.size <= MAX_KEY_FILE_BYTES ? await ke.data.text() : null;
      if (text && readVault(text)) plan.hiddenKey = text;
    }
  }
  const thumbsSeen = new Set<string>();
  for (const part of parts) {
    for (const t of Array.isArray(part.m["thumbnails"]) ? (part.m["thumbnails"] as unknown[]) : []) {
      if (typeof t !== "string" || !HASH_RE.test(t) || thumbsSeen.has(t)) continue;
      const e = part.entries.get(`thumbnails/${t}.webp`);
      const data = e && e.size <= 20 * 2 ** 20 ? e.data.slice(0, e.size, "image/webp") : null;
      if (!data || (await sha256Hex(await data.arrayBuffer())) !== t) {
        problems.push("A custom thumbnail is missing or damaged in the archive and was skipped: its items show their own pictures.");
        continue;
      }
      thumbsSeen.add(t);
      plan.thumbnails.push(data);
    }
  }
  for (const part of parts) {
    for (const n of Array.isArray(part.m["sealedThumbnails"]) ? (part.m["sealedThumbnails"] as unknown[]) : []) {
      if (typeof n !== "string" || !HASH_RE.test(n) || plan.sealedThumbnails.some((x) => x.name === n)) continue;
      const e = part.entries.get(`sealed-thumbnails/${n}.bin`);
      if (e && e.size <= 21 * 2 ** 20) plan.sealedThumbnails.push({ name: n, data: e.data.slice(0, e.size) });
    }
  }
  // (where the desktop app is not, they stay in the plan with their key file: the import asks their password and opens them, `sealed-open.ts`)
  if (plan.sealed.length && !plan.hiddenKey) {
    const n = plan.sealed.length;
    problems.push(`${plural(n, "hidden item")} came without ${n === 1 ? "its" : "their"} key file and ${were(n)} skipped.`);
    plan.sealed = [];
  }
  const sealedHashes = new Set(plan.sealed.map((s) => s.hash));
  plan.unresolved = [...referenced].filter((h) => !valid.has(h) && !sealedHashes.has(h)).sort();
  // paintings and brush presets (versions 5 and 6): the Painting view is gone, so they are left out, and said so
  const paintings = isObj(m["paintings"]) && typeof m["paintings"]["count"] === "number" ? m["paintings"]["count"] : 0;
  const brushes = Array.isArray(m["brushes"]) ? m["brushes"].length : 0;
  if (paintings || brushes) problems.push(`It carries ${[paintings ? plural(paintings, "painting") : "", brushes ? plural(brushes, "brush preset") : ""].filter(Boolean).join(" and ")} from the Painting view, which canvast no longer has; they are not imported.`);
  // the saved styles (version 4): the newest file's list is the list
  for (let i = parts.length - 1; i >= 0 && plan.styles.length === 0; i--) {
    const raw = parts[i]!.m["styles"];
    if (Array.isArray(raw)) plan.styles = cleanStyles(raw);
  }
  return plan;
}

/** Validate an asset's optional organization fields; anything invalid is reported and dropped. */
function readOrganization(a: Record<string, unknown>, label: string, problems: string[]): AssetOrganization | null {
  if (["tags", "favorite", "hidden", "folders", "note", "fields", "thumb", "viewer"].every((k) => a[k] === undefined)) return null;
  let tags: string[] = [];
  try {
    tags = normalizeTags(Array.isArray(a["tags"]) ? a["tags"].filter((t): t is string => typeof t === "string") : []);
  } catch (e) {
    problems.push(`The tags of “${label}” were invalid (${(e as Error).message}) and were not imported.`);
  }
  const folders: string[][] = [];
  for (const p of Array.isArray(a["folders"]) ? a["folders"] : []) {
    const path = Array.isArray(p) ? p.map((n) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim() : "")) : [];
    if (path.length === 0 || path.length > 64 || path.some((n) => !n || n.length > 120)) {
      problems.push(`A folder of “${label}” was invalid and was not imported.`);
      continue;
    }
    folders.push(path);
  }
  let note = "";
  try {
    note = typeof a["note"] === "string" ? normalizeNote(a["note"]) : "";
  } catch (e) {
    problems.push(`The note of “${label}” was invalid (${(e as Error).message}) and was not imported.`);
  }
  let fields: AssetField[] = [];
  try {
    fields = normalizeFields(Array.isArray(a["fields"]) ? a["fields"].filter((f): f is AssetField => isObj(f) && typeof f["key"] === "string" && typeof f["value"] === "string").map(fieldParts) : []);
  } catch (e) {
    problems.push(`The fields of “${label}” were invalid (${(e as Error).message}) and were not imported.`);
  }
  return { tags, favorite: a["favorite"] === true, hidden: a["hidden"] === true, folders, note, fields, thumb: typeof a["thumb"] === "string" && HASH_RE.test(a["thumb"]) ? a["thumb"] : null, viewer: typeof a["viewer"] === "string" ? a["viewer"] : "" };
}

/** Originals are written at most this many bytes per transaction, before the canvases (ADR 0176). */
const STAGE_BYTES = 128 * 2 ** 20;
/** The `meta` key listing the originals an import has written ahead of its canvases. */
const STAGED_KEY = "importStaged";
/** For tests (the debug hook): a smaller batch, and an import that stops after its originals, as if it failed or the tab closed. */
export const importTesting = { stageBytes: STAGE_BYTES, stopAfterFiles: null as null | "fail" | "crash" };

/**
 * Erase the originals an unfinished import wrote ahead of its canvases: the ones that still have no library entry (an entry means the
 * import finished, or the same file was imported into the library since). Run before an import and when the app opens (ADR 0176).
 */
export async function sweepImportStaging(db: IDBDatabase): Promise<number> {
  const tx = db.transaction(["assets", "assetCatalog", "thumbs", "meta"], "readwrite", { durability: "strict" });
  const committed = done(tx);
  const staged = ((await req(tx.objectStore("meta").get(STAGED_KEY) as IDBRequest<string[] | undefined>)) ?? []);
  let swept = 0;
  for (const h of staged) {
    if ((await req(tx.objectStore("assetCatalog").count(h))) > 0) continue;
    tx.objectStore("assets").delete(h);
    tx.objectStore("thumbs").delete(h);
    swept++;
  }
  if (staged.length) tx.objectStore("meta").delete(STAGED_KEY);
  await committed;
  return swept;
}

/**
 * Where an import's originals are written instead of the database (the desktop build: files in the workspace folder, ADR 0177), a batch
 * at a time; each one written is then kept in the database only as where its file is, so nothing large passes through it (or has to be
 * cleared from it after). Resolves with the file of each original written; one it did not write stays in the database as before.
 */
export type OriginalWriter = (batch: readonly AssetRecord[]) => Promise<Map<string, string>>;

/**
 * Write the originals the store does not have, a batch at a time, each listed under `STAGED_KEY` in the same transaction. Only one batch
 * of bytes is in memory at once, so the size of an archive is not limited by memory. Returns the hashes written. With `writer`, the
 * originals that are not hidden go to it (hidden ones are never written readable: they stay in the database until they can be sealed).
 */
async function stageOriginals(db: IDBDatabase, assets: readonly AssetRecord[], progress?: ProgressFn, writer?: OriginalWriter, hidden?: (hash: string) => boolean, snap: LibrarySnap = null): Promise<Set<string>> {
  const written = new Set<string>();
  const total = assets.length;
  let i = 0;
  while (i < total) {
    // Read the next batch: whole files, up to the byte budget (always at least one file).
    const batch: AssetRecord[] = [];
    let bytes = 0;
    while (i < total && (batch.length === 0 || bytes + assets[i]!.size <= importTesting.stageBytes)) {
      const a = assets[i++]!;
      if (a.ext) continue; // a file of the library folder: no bytes to write
      batch.push(a);
      bytes += a.size;
    }
    if (!batch.length) break;
    const have = await (async () => {
      const t = db.transaction("assets", "readonly");
      return Promise.all(batch.map((a) => libraryIn(t, snap).has(a.hash)));
    })();
    const fresh = batch.filter((_, k) => !have[k]);
    if (fresh.length) {
      // (one too big to keep in the page's storage goes to the folder even when hidden: it is sealed there)
      const files = writer ? await writer(fresh.filter((a) => !hidden?.(a.hash) || a.size > MAX_IMPORT_BYTES)) : new Map<string, string>();
      const loaded = await Promise.all(
        fresh.map(async (a): Promise<AssetRecord> => {
          const file = files.get(a.hash);
          if (!file && a.size > MAX_IMPORT_BYTES) throw new ArchiveError(`“${a.name}” could not be written to the workspace folder`);
          return file ? { ...a, blob: new Blob([]), ext: 1, file } : { ...a, blob: new Blob([await a.blob.arrayBuffer()], { type: a.type }) };
        }),
      );
      const tx = db.transaction(["assets", "meta"], "readwrite", { durability: "strict" });
      const committed = done(tx);
      const staged = ((await req(tx.objectStore("meta").get(STAGED_KEY) as IDBRequest<string[] | undefined>)) ?? []);
      for (const a of loaded) if ((await req(tx.objectStore("assets").count(a.hash))) === 0) {
        tx.objectStore("assets").put(a.ext ? storedStub(a) : a, a.hash);
        staged.push(a.hash);
        written.add(a.hash);
      }
      tx.objectStore("meta").put(staged, STAGED_KEY);
      await committed;
    }
    progress?.("Writing the files", i, total);
  }
  return written;
}

/**
 * Apply a validated plan. Canvas archives are added to `targetBoardId`; board and workspace archives become new boards.
 *
 * The originals are written first, a batch at a time, and listed as staged: until the last step nothing points at them, so they cannot
 * be seen. The last step is one transaction for everything else (canvases, boards, library entries, passwords, styles) and clears the
 * list, so the import shows all at once or not at all. If it stops before that, the staged originals are erased at once, or when the
 * app next opens (ADR 0176).
 */
export async function applyImport(db: IDBDatabase, workspaceId: string, targetBoardId: string, plan: ImportPlan, progress?: ProgressFn, writer?: OriginalWriter, lib?: LibraryStore): Promise<ImportResult> {
  await sweepImportStaging(db);
  let staged: Set<string>;
  try {
    const snap = await snapOf(lib);
    staged = await stageOriginals(db, plan.assets, progress, writer, (h) => plan.organization.get(h)?.hidden === true, snap);
    if (importTesting.stopAfterFiles === "crash") return { boards: 0, canvases: 0, objects: 0, assetsAdded: 0, stillMissing: 0, firstCanvasId: null, stylesAdded: 0 };
    if (importTesting.stopAfterFiles === "fail") throw new ArchiveError("stopped after the files (test)");
    const libOps: LibraryOp[] = [];
    const result = await applyRest(db, workspaceId, targetBoardId, plan, staged, snap, libOps);
    if (lib) await moveToLibrary(db, lib, libOps);
    if (plan.sealed.length && sealedHooks.write) {
      await sealedHooks.write(plan.sealed, plan.hiddenKey, plan.sealedNames);
      for (const t of plan.sealedThumbnails) await thumbHooks.putSealed?.(t.name, t.data).catch(() => undefined);
    }
    for (const t of plan.thumbnails) await thumbHooks.put?.(t).catch(() => undefined);
    return result;
  } catch (e) {
    await sweepImportStaging(db).catch(() => undefined);
    throw e;
  }
}

/**
 * The desktop build: the import's library entries and folders (`ops`), and the records of the files it wrote (staged in this database
 * as for the browser), go to the library store, then leave this database. Bytes it could not write out stay here, to be written later.
 */
async function moveToLibrary(db: IDBDatabase, lib: LibraryStore, ops: LibraryOp[]): Promise<void> {
  const tx = db.transaction("assets", "readonly");
  const keys = (await req(tx.objectStore("assets").index("ext").getAllKeys())) as string[];
  const stubs = (await req(tx.objectStore("assets").index("ext").getAll())) as AssetRecord[];
  await lib.apply([...stubs.map((r, i): LibraryOp => ({ t: "rec", hash: keys[i]!, v: { ...r, hash: keys[i]! } })), ...ops]);
  const wtx = db.transaction("assets", "readwrite", { durability: "strict" });
  for (const k of keys) wtx.objectStore("assets").delete(k);
  await done(wtx);
}

async function applyRest(db: IDBDatabase, workspaceId: string, targetBoardId: string, plan: ImportPlan, staged: ReadonlySet<string>, snap: LibrarySnap = null, libOps: LibraryOp[] = []): Promise<ImportResult> {
  const tx = db.transaction(["workspaces", "boards", "canvases", "objects", "frames", "canvasViews", "bookmarks", "assets", "assetCatalog", "meta"], "readwrite", { durability: "strict" });
  const committed = done(tx);
  const result: ImportResult = { boards: 0, canvases: 0, objects: 0, assetsAdded: 0, stillMissing: 0, firstCanvasId: null, stylesAdded: 0 };
  try {
    const now = Date.now();
    const ws = await req(tx.objectStore("workspaces").get(workspaceId) as IDBRequest<WorkspaceRecord | undefined>);
    if (!ws) throw new ArchiveError("workspace not found");
    let folders: AssetFolder[] | undefined;
    const addCanvas = (boardId: string, c: PlannedCanvas, id = newObjectId()): string => {
      const canvas: CanvasRecord = { id, boardId, name: c.name, revision: 0, objectCount: c.objects.length, updatedAt: now };
      tx.objectStore("canvases").put(canvas);
      putCanvasContent(tx, canvas.id, c);
      if (c.view) tx.objectStore("canvasViews").put(c.view, canvas.id);
      result.canvases++;
      result.objects += c.objects.length;
      result.firstCanvasId ??= canvas.id;
      return canvas.id;
    };
    // An update (the person's choice): this workspace made as the backup is, its boards and canvases matched by id; what this workspace
    // changed since its last backup is kept beside, and what the backup does not have, set aside, never erased (see updateBoards).
    const update = plan.mode === "update" && plan.scope === "workspace";
    const base = update ? ((await req(tx.objectStore("meta").get("backup") as IDBRequest<{ at?: number } | undefined>))?.at ?? 0) : 0;
    if (update) await updateBoards(tx, ws, plan, base, now, result, addCanvas);
    else if (plan.scope === "canvas") {
      const board = await req(tx.objectStore("boards").get(targetBoardId) as IDBRequest<BoardRecord | undefined>);
      if (!board) throw new ArchiveError("the target board was not found");
      for (const c of plan.boards.flatMap((b) => b.canvases)) board.canvasIds.push(addCanvas(board.id, c));
      tx.objectStore("boards").put(board);
    } else {
      for (const b of plan.boards) {
        const board: BoardRecord = { id: newObjectId(), workspaceId, name: b.name, canvasIds: [], createdAt: now };
        for (const c of b.canvases) board.canvasIds.push(addCanvas(board.id, c));
        tx.objectStore("boards").put(board);
        ws.boardIds.push(board.id);
        result.boards++;
      }
      tx.objectStore("workspaces").put(ws);
    }
    for (const a of plan.assets) {
      if (staged.has(a.hash)) result.assetsAdded++; // written ahead (stageOriginals)
      else if (!(await libraryIn(tx, snap).has(a.hash))) {
        tx.objectStore("assets").put(a.ext ? storedStub(a) : a, a.hash);
        result.assetsAdded++;
      }
      const e = await libraryIn(tx, snap).entry(a.hash);
      let entry: CatalogEntry = !e ? entryFromRecord(a) : e.state !== "active" ? { ...e, state: "active", deletedAt: null } : e;
      // (when it came into the library only ever goes earlier: one taken in a moment ago, by the folder's scan or as a recovered hidden file,
      // takes the backup's date; one here long before keeps its own)
      if (e && a.importedAt > 0 && a.importedAt < entry.importedAt) entry = { ...entry, importedAt: a.importedAt };
      const org = plan.organization.get(a.hash);
      if (update) {
        // As the backup says (it was made after the changes it carries): a tag taken off, a favourite turned off, a new name or folder.
        folders ??= [...(await libraryIn(tx, snap).folders())];
        const { note: _n, fields: _f, thumb: _t, ...rest } = entry;
        entry = { ...rest, name: a.name || entry.name, tags: normalizeTags(org?.tags ?? []), favorite: !!org?.favorite, hidden: !!org?.hidden, folderIds: org?.folders.length ? [resolveFolder(folders, org.folders[0]!)] : [] };
        if (org?.note) entry.note = org.note;
        if (org?.fields.length) entry.fields = org.fields;
        if (org?.thumb) entry.thumb = org.thumb;
        if (org?.viewer) entry.viewer = org.viewer;
      } else if (org) {
        // Merge, never replace: tags are unioned, a favourite stays a favourite, folders are matched by path, a note is kept (the archive's
        // only fills an empty one), and the archive's fields this asset does not have yet (same name and value) are added after its own.
        folders ??= [...(await libraryIn(tx, snap).folders())];
        const m = meta(entry);
        // One folder per asset: an asset already filed keeps its folder; otherwise the archive's (first) folder is used.
        const ids = m.folderIds.length || !org.folders.length ? m.folderIds : [resolveFolder(folders, org.folders[0]!)];
        const fields = [...m.fields, ...org.fields.filter((f) => !m.fields.some((x) => x.key === f.key && x.value === f.value))].slice(0, MAX_FIELDS);
        entry = { ...entry, tags: normalizeTags([...m.tags, ...org.tags]), favorite: m.favorite || org.favorite, hidden: m.hidden || org.hidden, folderIds: ids };
        if (m.note || org.note) entry.note = m.note || org.note;
        if (!m.thumb && org.thumb) entry.thumb = org.thumb; // (a custom thumbnail here is kept)
        if (!entry.viewer && org.viewer) entry.viewer = org.viewer;
        if (fields.length) entry.fields = fields;
      }
      if (entry !== e) (snap ? libOps.push({ t: "entry", hash: entry.hash, v: entry }) : tx.objectStore("assetCatalog").put(entry));
    }
    // The folders the backup lists, empty ones too; a hidden one hidden (the folder an item is in is made above from its path).
    if (plan.folders.length) {
      folders ??= [...(await libraryIn(tx, snap).folders())];
      for (const f of plan.folders) {
        const id = resolveFolder(folders, f.path);
        if (f.hidden) folders = folders.map((x) => (x.id === id ? { ...x, hidden: true } : x));
      }
    }
    if (update && result.canvases > 0 && !plan.incrementalOnly) { // (an incremental backup on its own does not list every item)
      // Items this workspace had at its last backup that the backup does not have: deleted where it was made. Deleted here too (a
      // desktop's file goes to .trash). A hidden one only when the backup carries hidden items; a copy of a file, as it is.
      const inBackup = new Set([...plan.assets.map((a) => a.hash), ...plan.sealed.map((s) => s.hash)]);
      const carriesHidden = plan.sealed.length > 0 || [...plan.organization.values()].some((o) => o.hidden);
      for (const e of await libraryIn(tx, snap).entries()) {
        if (e.state !== "active" || inBackup.has(e.hash) || e.hash.includes("~") || !(base > 0 && e.importedAt <= base) || (meta(e).hidden && !carriesHidden)) continue;
        const gone: CatalogEntry = { ...e, state: "deleted", deletedAt: now };
        snap ? libOps.push({ t: "entry", hash: e.hash, v: gone }) : tx.objectStore("assetCatalog").put(gone);
        result.itemsDeleted = (result.itemsDeleted ?? 0) + 1;
      }
    }
    if (folders) (snap ? libOps.push({ t: "meta", k: "assetFolders", v: folders }) : tx.objectStore("meta").put(folders, "assetFolders"));
    // The password of the archive is taken only where this device has none: an import never replaces a password.
    if (plan.workspaceLock && !(await req(tx.objectStore("meta").get("workspaceLock") as IDBRequest<unknown>))) tx.objectStore("meta").put(plan.workspaceLock, "workspaceLock");
    if (plan.hiddenLock && !(await req(tx.objectStore("meta").get("hiddenLock") as IDBRequest<unknown>))) tx.objectStore("meta").put(plan.hiddenLock, "hiddenLock");
    if (update) {
      // an update: the saved styles are the backup's
      tx.objectStore("meta").put(plan.styles, "styles");
      result.stylesAdded = plan.styles.length;
    } else if (plan.styles.length) {
      // the saved styles: the ones the library does not have yet are added (by id), none is replaced
      const have = cleanStyles(await req(tx.objectStore("meta").get("styles") as IDBRequest<unknown>));
      const ids = new Set(have.map((x) => x.id));
      const added = plan.styles.filter((x) => !ids.has(x.id));
      if (added.length) {
        tx.objectStore("meta").put([...have, ...added], "styles");
        result.stylesAdded = added.length;
      }
    }
    for (const h of plan.unresolved) if (!(await libraryIn(tx, snap).has(h))) result.stillMissing++;
    tx.objectStore("meta").delete(STAGED_KEY); // the staged originals now have their entries
    await committed;
    return result;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      // already finished
    }
    await committed.catch(() => undefined);
    throw e;
  }
}

/**
 * An update's boards and canvases: each of the backup's by its id (a new one keeps its id, so the next backup matches it again), its content
 * replaced; one this workspace changed since its last backup (`base`) is kept beside it first as a conflict copy. A canvas this workspace
 * had at its last backup that the backup does not have was deleted where it was made: put on a board of its own ("Not in the backup"),
 * never erased; an empty one goes. One made or changed here since is kept where it is.
 */
async function updateBoards(tx: IDBTransaction, ws: WorkspaceRecord, plan: ImportPlan, base: number, now: number, result: ImportResult, addCanvas: (boardId: string, c: PlannedCanvas, id?: string) => string): Promise<void> {
  const boards = tx.objectStore("boards"), canvases = tx.objectStore("canvases");
  const home = (await Promise.all(ws.boardIds.map((id) => req(boards.get(id) as IDBRequest<BoardRecord | undefined>)))).filter((b): b is BoardRecord => !!b);
  const homeCanvases = new Map<string, CanvasRecord>();
  for (const b of home) for (const id of b.canvasIds) {
    const c = await req(canvases.get(id) as IDBRequest<CanvasRecord | undefined>);
    if (c) homeCanvases.set(id, c);
  }
  const date = new Date(now).toISOString().slice(0, 10);
  const clear = (id: string): void => {
    tx.objectStore("objects").delete(range(id));
    tx.objectStore("frames").delete(range(id));
    tx.objectStore("bookmarks").delete(id);
    tx.objectStore("canvasViews").delete(id);
  };
  const keepBeside = async (old: CanvasRecord): Promise<string> => {
    const id = newObjectId();
    for (const o of await req(tx.objectStore("objects").getAll(range(old.id)) as IDBRequest<ObjectRecord[]>)) tx.objectStore("objects").put({ ...o, canvasId: id });
    for (const f of await req(tx.objectStore("frames").getAll(range(old.id)) as IDBRequest<FrameStoreRecord[]>)) tx.objectStore("frames").put({ ...f, canvasId: id });
    const marks = await req(tx.objectStore("bookmarks").get(old.id) as IDBRequest<{ canvasId: string } | undefined>);
    if (marks) tx.objectStore("bookmarks").put({ ...marks, canvasId: id });
    const view = await req(tx.objectStore("canvasViews").get(old.id) as IDBRequest<StoredView | undefined>);
    if (view) tx.objectStore("canvasViews").put(view, id);
    canvases.put({ ...old, id, name: `${old.name} (conflict ${date})` } satisfies CanvasRecord);
    result.conflicts = (result.conflicts ?? 0) + 1;
    return id;
  };
  const placed = new Set<string>();
  const out = new Map<string, BoardRecord>();
  for (const b of plan.boards) {
    const had = b.id && !placed.has(b.id) ? home.find((x) => x.id === b.id) : undefined;
    const board: BoardRecord = had ? { ...had, name: b.name, canvasIds: [] } : { id: b.id && !placed.has(b.id) && !(await req(boards.get(b.id) as IDBRequest<BoardRecord | undefined>)) ? b.id : newObjectId(), workspaceId: ws.id, name: b.name, canvasIds: [], createdAt: now };
    if (!had) result.boards++;
    placed.add(board.id);
    for (const c of b.canvases) {
      const old = c.id && !placed.has(c.id) ? homeCanvases.get(c.id) : undefined;
      if (old) {
        if (base > 0 && old.updatedAt > base) board.canvasIds.push(await keepBeside(old));
        clear(old.id);
        putCanvasContent(tx, old.id, c);
        if (c.view) tx.objectStore("canvasViews").put(c.view, old.id);
        canvases.put({ ...old, boardId: board.id, name: c.name, revision: old.revision + 1, objectCount: c.objects.length, updatedAt: now } satisfies CanvasRecord);
        result.canvases++;
        result.objects += c.objects.length;
        result.firstCanvasId ??= old.id;
        board.canvasIds.push(old.id);
        placed.add(old.id);
      } else {
        const free = c.id && !placed.has(c.id) && !(await req(canvases.get(c.id) as IDBRequest<CanvasRecord | undefined>));
        const id = addCanvas(board.id, c, free ? c.id : undefined);
        board.canvasIds.push(id);
        placed.add(id);
      }
    }
    out.set(board.id, board);
  }
  // What this workspace has that the backup does not.
  const aside: string[] = [];
  const order = [...out.keys()];
  for (const hb of home) {
    const keep: string[] = [];
    for (const id of hb.canvasIds) {
      if (placed.has(id)) continue;
      const c = homeCanvases.get(id);
      if (!c) continue;
      if (plan.unchangedIds.includes(id)) {
        keep.push(id); // (an incremental backup lists it unchanged: as it is here)
        continue;
      }
      if (c.objectCount === 0 && !(await req(tx.objectStore("bookmarks").get(id) as IDBRequest<unknown>))) {
        canvases.delete(id); // (an empty canvas: a new workspace's first one, say; nothing of it is lost)
        clear(id);
      } else if (base > 0 && c.updatedAt <= base) aside.push(id);
      else keep.push(id);
    }
    const mine = out.get(hb.id);
    if (mine) mine.canvasIds.push(...keep);
    else if (keep.length) {
      out.set(hb.id, { ...hb, canvasIds: keep });
      order.push(hb.id);
    } else boards.delete(hb.id);
  }
  if (aside.length) {
    const board: BoardRecord = { id: newObjectId(), workspaceId: ws.id, name: `Not in the backup (${date})`, canvasIds: aside, createdAt: now };
    for (const id of aside) canvases.put({ ...homeCanvases.get(id)!, boardId: board.id });
    out.set(board.id, board);
    order.push(board.id);
    result.canvasesSetAside = aside.length;
  }
  for (const b of out.values()) boards.put(b);
  tx.objectStore("workspaces").put({ ...ws, boardIds: order } satisfies WorkspaceRecord);
}

/**
 * The browser's hidden items, encrypted for a backup as the desktop app keeps them in `.hidden/`: a new key wrapped by the Hidden password
 * (scrypt), each file sealed with its content hash, its place an encrypted path of its folders and name (a long one's `.name` beside it),
 * and a key file holding their sealed index (dates, tags, notes and the rest) and folders. Nothing of them is readable in the backup.
 */
async function sealForBackup(items: ReadonlyArray<{ r: AssetRecord; entry: CatalogEntry | null; folders: string[]; folderIds: string[] }>, password: string, all: readonly AssetFolder[], sealed: Array<{ hash: string; file: string; at?: string }>, sealedNames: Array<{ at: string; file: string }>, blobs: ZipInput[], manifest: Manifest, progress?: ProgressFn): Promise<void> {
  progress?.("Encrypting the hidden items", 0, items.length);
  const { record, key } = await createVault(password);
  const keys = await nameKeys(key);
  const enc = new TextEncoder();
  // (a long name's `.name`, as the desktop app writes it: the name in NFC, sealed, marked a file's or a folder's)
  const sealedName = async (text: string, kind: "fileName" | "folderName"): Promise<Blob> => new Blob([await sealFile(key, enc.encode(text.normalize("NFC")) as Uint8Array<ArrayBuffer>, { kind })]);
  const segOf = async (name: string, kind: "fileName" | "folderName", longAt: (seg: string) => string): Promise<string> => {
    const s = await sealName(keys, name);
    if (s.long) {
      const at = longAt(s.seg);
      if (!sealedNames.some((n) => n.at === at)) {
        const file = `sealed-names/${sealedNames.length}.bin`;
        blobs.push({ name: file, data: await sealedName(name, kind) });
        sealedNames.push({ at, file });
      }
    }
    return s.seg;
  };
  const index: unknown[] = [];
  const folderIds = new Set<string>();
  const used = new Set<string>();
  for (const [k, it] of items.entries()) {
    progress?.("Encrypting the hidden items", k, items.length);
    let dir = ".hidden";
    for (const name of it.folders) dir = `${dir}/${await segOf(name, "folderName", (seg) => `${dir}/${seg}/.name`)}`;
    // (two of one name in one folder: the later one numbered, as the desktop app's `hiddenPath` does)
    const e = it.entry;
    const whole = e?.name || it.r.name || it.r.hash.slice(0, 12);
    const dot = whole.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [whole.slice(0, dot), whole.slice(dot)] : [whole, ""];
    let name = whole;
    for (let n = 2; used.has(`${dir}\n${name.toLowerCase()}`); n++) name = numberedName(stem, n, ext);
    used.add(`${dir}\n${name.toLowerCase()}`);
    const at = `${dir}/${await segOf(name, "fileName", (seg) => `${dir}/${seg}.name`)}`;
    const bytes = new Uint8Array(await it.r.blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    const file = `sealed/${it.r.hash}.bin`;
    blobs.push({ name: file, data: new Blob([await sealFile(key, bytes, { hash: it.r.hash })]) });
    sealed.push({ hash: it.r.hash, file, at });
    for (let id: string | null | undefined = it.folderIds[0]; id && !folderIds.has(id); id = all.find((f) => f.id === id)?.parentId) folderIds.add(id);
    // (its entry in the sealed index as the desktop app makes one, `itemOf`: its place and name are the sealed file's)
    index.push({ ...itemOf(e ?? entryFromRecord(it.r), it.r), file: at, name, hidden: true, state: "active" });
  }
  const folders = all.filter((f) => folderIds.has(f.id)).map((f) => ({ ...f, hidden: true as const }));
  const keyFile = { ...record, check: await keyCheck(key), index: await sealText(key, JSON.stringify(index)), ...(folders.length ? { folders: await sealText(key, JSON.stringify(folders)) } : {}) };
  blobs.push({ name: "hidden-key.json", data: new Blob([JSON.stringify(keyFile, null, 1)], { type: "application/json" }) });
  Object.assign(manifest, { sealed, hiddenKey: "hidden-key.json", ...(sealedNames.length ? { sealedNames } : {}) });
  progress?.("Encrypting the hidden items", items.length, items.length);
}

/** The library folders for a backup, by path: the hidden ones only where they are not sealed in its key file and hidden items go in it. */
async function foldersOut(all: readonly AssetFolder[], withHidden: boolean): Promise<Array<{ path: string[]; hidden?: true }>> {
  const shown = new Set(visibleFolders(all).map((f) => f.id));
  return all.filter((f) => withHidden || shown.has(f.id)).map((f) => ({ path: folderPath(all, f.id), ...(shown.has(f.id) ? {} : { hidden: true as const }) })).filter((f) => f.path.length > 0);
}

/** Id of the folder at `path` (names from the top), creating missing folders in `folders`. */
function resolveFolder(folders: AssetFolder[], path: readonly string[]): string {
  let parent: string | null = null;
  for (const name of path) {
    let f = folders.find((x) => x.parentId === parent && x.name.toLowerCase() === name.toLowerCase());
    if (!f) folders.push((f = { id: newObjectId(), name, parentId: parent }));
    parent = f.id;
  }
  return parent!;
}

/** A file name for an archive: `<name>-<yyyy-mm-dd>.canvast`. */
export function archiveFileName(name: string, at = new Date()): string {
  const slug = name.normalize("NFC").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "canvast";
  const d = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return `${slug}-${d}${ARCHIVE_EXTENSION}`;
}
