import { externalFolder } from "./external-folder";
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
import { MAX_FIELDS, entryFromRecord, folderPath, meta, normalizeFields, normalizeNote, normalizeTags } from "../assets/asset-catalog";
import { sha256Hex } from "../assets/sha256";
import type { StyleItem } from "../assets/styles";
import { cleanStyles } from "../assets/styles";
import { done, req } from "./idb";
import type { Bookmark } from "./bookmarks";
import { readBookmarks } from "./bookmarks";
import type { BoardRecord, CanvasRecord, FrameStoreRecord, ObjectRecord, StoredView, WorkspaceRecord } from "./workspace-repo";
import type { ZipEntry, ZipInput } from "./zip";
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
export const ARCHIVE_FORMAT = "canvast-archive";
export const ARCHIVE_VERSION = 6;
export const ARCHIVE_EXTENSION = ".canvast";

/** Where a long job is: the stage in words and how far (done of total). The caller turns it into a progress notice. */
export type ProgressFn = (stage: string, done: number, total: number) => void;

export type ExportScope = (
  /** `since`: an incremental backup, with only what changed after that time (the `at` of the backup it goes on from). */
  | { kind: "workspace"; since?: number; /** The library index kept in the library folder (ADR 0159): everything but the bytes of the originals. Not a backup. */ noBytes?: boolean }
  | { kind: "board"; boardId: string }
  | { kind: "canvas"; canvasId: string }
  | { kind: "assets"; hashes: string[] }
) & {
  /** Leave out the originals hidden in the library, and their names and tags (what the person chose when asked, or always for the library index). */
  skipHidden?: boolean;
  /** A workspace backup that also carries the passwords (of the Hidden items and of the workspace) and the privacy settings (set by the app from Settings > Privacy). */
  withPrivacy?: boolean;
};

/** The hashes of the hidden library items. */
export async function hiddenSet(tx: IDBTransaction): Promise<Set<string>> {
  const all = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
  return new Set(all.filter((e) => e.state === "active" && e.hidden).map((e) => e.hash));
}

/** How many hidden library items a scope would carry (asked before exporting). */
export async function hiddenInScope(db: IDBDatabase, scope: ExportScope): Promise<number> {
  const tx = db.transaction(["boards", "canvases", "objects", "assetCatalog"], "readonly");
  const hidden = await hiddenSet(tx);
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
}

/** An asset's organization as carried in an archive. */
export interface AssetOrganization {
  tags: string[];
  favorite: boolean;
  hidden: boolean;
  folders: string[][];
  note: string;
  fields: AssetField[];
}

export interface Manifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
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
export async function buildArchive(db: IDBDatabase, workspaceId: string, scope: ExportScope, app: string, settings?: Record<string, unknown>, progress?: ProgressFn): Promise<ExportResult> {
  const tx = db.transaction(["workspaces", "boards", "canvases", "objects", "frames", "canvasViews", "bookmarks", "assets", "assetCatalog", "meta"], "readonly");
  const ws = await req(tx.objectStore("workspaces").get(workspaceId) as IDBRequest<WorkspaceRecord | undefined>);
  if (!ws) throw new ArchiveError("workspace not found");
  const boards: ManifestBoard[] = [];
  const canvasFiles: Array<{ file: string; json: BlobPart[] }> = [];
  const hashes = new Set<string>(scope.kind === "assets" ? scope.hashes : []);
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
    for (const e of await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>)) if (e.state === "active") hashes.add(e.hash);
  }
  if (scope.skipHidden) for (const h of await hiddenSet(tx)) hashes.delete(h);
  const hiddenLock = scope.kind === "workspace" && scope.withPrivacy && !noBytes ? await req(tx.objectStore("meta").get("hiddenLock") as IDBRequest<unknown>) : undefined;
  const workspaceLock = scope.kind === "workspace" && scope.withPrivacy && !noBytes ? await req(tx.objectStore("meta").get("workspaceLock") as IDBRequest<unknown>) : undefined;
  const assets: ManifestAsset[] = [];
  const assetBlobs: ZipInput[] = [];
  const missingAssets: string[] = [];
  const kept: Array<{ input: ZipInput; hash: string; size: number; type: string; file: string | undefined }> = [];
  let folders: AssetFolder[] | undefined;
  const sortedHashes = [...hashes].sort();
  for (const [i, hash] of sortedHashes.entries()) {
    progress?.("Reading the library", i, sortedHashes.length);
    const r = await req(tx.objectStore("assets").get(hash) as IDBRequest<AssetRecord | undefined>);
    if (!r) {
      missingAssets.push(hash);
      continue;
    }
    const file = `assets/${hash}`;
    const known = noBytes || (since !== undefined && r.importedAt <= since); // already in an earlier file of the chain: its list entry, not its bytes
    const entry = await req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>);
    const m = entry ? meta(entry) : { tags: [], favorite: false, hidden: false, folderIds: [], note: "", fields: [] };
    folders ??= (await req(tx.objectStore("meta").get("assetFolders") as IDBRequest<AssetFolder[] | undefined>)) ?? [];
    const allFolders = folders;
    assets.push({
      hash,
      name: entry?.name ?? r.name,
      type: r.type,
      size: r.ext ? r.size : r.blob.size,
      pixelW: r.pixelW,
      pixelH: r.pixelH,
      importedAt: r.importedAt,
      ...(r.card ? { card: true } : {}),
      ...(known ? {} : { file }),
      tags: m.tags,
      favorite: m.favorite,
      ...(m.hidden ? { hidden: true } : {}),
      folders: m.folderIds.map((id) => folderPath(allFolders, id)).filter((p) => p.length > 0),
      ...(m.note ? { note: m.note } : {}),
      ...(m.fields.length ? { fields: m.fields } : {}),
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
    ...(scope.kind === "workspace" ? { styles: (((await req(tx.objectStore("meta").get("styles") as IDBRequest<unknown>)) as unknown[] | undefined) ?? []).slice(0, 5000) } : {}),
    ...(since !== undefined ? { incremental: { since } } : {}),
    ...(noBytes ? { libraryFile: true as const } : {}),
    ...(scope.kind === "workspace" && settings && Object.keys(settings).length ? { settings } : {}),
    ...(typeof hiddenLock === "string" ? { hiddenLock } : {}),
    ...(typeof workspaceLock === "string" ? { workspaceLock } : {}),
  };
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
  name: string;
  objects: CanvasObject[];
  view: StoredView | null;
  /** The frames the objects, the view and the bookmarks need (version 2 archives; empty for version 1). */
  frames: FrameRecord[];
  bookmarks: Bookmark[];
}

export interface ImportPlan {
  scope: ExportScope["kind"];
  workspaceName: string;
  exportedAt: number;
  boards: Array<{ name: string; canvases: PlannedCanvas[] }>;
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
  const plan: ImportPlan = {
    scope,
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
    const board = { name: str(b["name"], "Imported board"), canvases: [] as PlannedCanvas[] };
    for (const c of b["canvases"] as unknown[]) {
      if (!isObj(c)) throw new ArchiveError("the archive manifest is damaged");
      const name = str(c["name"], "Imported canvas");
      const where = typeof c["file"] === "string" ? { entries: latest.entries, file: c["file"] } : typeof c["id"] === "string" ? canvasAt(c["id"]) : null;
      if (!where) {
        if (c["file"] === undefined) {
          problems.push(`“${name}” did not change since the backup this one goes on from, and that file was not added: it is not imported.`);
          continue;
        }
        throw new ArchiveError("the archive manifest is damaged");
      }
      const data = await readJson(where.entries, where.file);
      const planned = readCanvasData(data, name, problems, referenced);
      board.canvases.push(planned);
      plan.objects += planned.objects.length;
    }
    if (board.canvases.length) plan.boards.push(board);
  }
  if (scope !== "assets" && plan.boards.length === 0) throw new ArchiveError("the archive contains no canvases");

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
        ext: 1,
        file: f.file,
      });
      const org = readOrganization(a, label, problems);
      if (org) plan.organization.set(hash, org);
      continue;
    }
    if (!e || e.size > MAX_IMPORT_BYTES || !posInt(a["pixelW"]) || !posInt(a["pixelH"])) {
      problems.push(`Library item “${label}” is missing or invalid in the archive and was skipped.`);
      continue;
    }
    // The bytes are read for the hash and let go: the plan keeps a slice of the file, read again when it is written (ADR 0176).
    if ((await sha256Hex(await e.data.arrayBuffer())) !== hash) {
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
    });
    const org = readOrganization(a, label, problems);
    if (org) plan.organization.set(hash, org);
  }
  plan.unresolved = [...referenced].filter((h) => !valid.has(h)).sort();
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
  if (["tags", "favorite", "hidden", "folders", "note", "fields"].every((k) => a[k] === undefined)) return null;
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
    fields = normalizeFields(Array.isArray(a["fields"]) ? a["fields"].filter((f): f is AssetField => isObj(f) && typeof f["key"] === "string" && typeof f["value"] === "string").map((f) => ({ key: f.key, value: f.value })) : []);
  } catch (e) {
    problems.push(`The fields of “${label}” were invalid (${(e as Error).message}) and were not imported.`);
  }
  return { tags, favorite: a["favorite"] === true, hidden: a["hidden"] === true, folders, note, fields };
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
 * Write the originals the store does not have, a batch at a time, each listed under `STAGED_KEY` in the same transaction. Only one batch
 * of bytes is in memory at once, so the size of an archive is not limited by memory. Returns the hashes written.
 */
async function stageOriginals(db: IDBDatabase, assets: readonly AssetRecord[], progress?: ProgressFn): Promise<Set<string>> {
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
      return Promise.all(batch.map(async (a) => (await req(t.objectStore("assets").count(a.hash))) > 0));
    })();
    const fresh = batch.filter((_, k) => !have[k]);
    if (fresh.length) {
      const loaded = await Promise.all(fresh.map(async (a): Promise<AssetRecord> => ({ ...a, blob: new Blob([await a.blob.arrayBuffer()], { type: a.type }) })));
      const tx = db.transaction(["assets", "meta"], "readwrite", { durability: "strict" });
      const committed = done(tx);
      const staged = ((await req(tx.objectStore("meta").get(STAGED_KEY) as IDBRequest<string[] | undefined>)) ?? []);
      for (const a of loaded) if ((await req(tx.objectStore("assets").count(a.hash))) === 0) {
        tx.objectStore("assets").put(a, a.hash);
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
export async function applyImport(db: IDBDatabase, workspaceId: string, targetBoardId: string, plan: ImportPlan, progress?: ProgressFn): Promise<ImportResult> {
  await sweepImportStaging(db);
  let staged: Set<string>;
  try {
    staged = await stageOriginals(db, plan.assets, progress);
    if (importTesting.stopAfterFiles === "crash") return { boards: 0, canvases: 0, objects: 0, assetsAdded: 0, stillMissing: 0, firstCanvasId: null, stylesAdded: 0 };
    if (importTesting.stopAfterFiles === "fail") throw new ArchiveError("stopped after the files (test)");
    return await applyRest(db, workspaceId, targetBoardId, plan, staged);
  } catch (e) {
    await sweepImportStaging(db).catch(() => undefined);
    throw e;
  }
}

async function applyRest(db: IDBDatabase, workspaceId: string, targetBoardId: string, plan: ImportPlan, staged: ReadonlySet<string>): Promise<ImportResult> {
  const tx = db.transaction(["workspaces", "boards", "canvases", "objects", "frames", "canvasViews", "bookmarks", "assets", "assetCatalog", "meta"], "readwrite", { durability: "strict" });
  const committed = done(tx);
  const result: ImportResult = { boards: 0, canvases: 0, objects: 0, assetsAdded: 0, stillMissing: 0, firstCanvasId: null, stylesAdded: 0 };
  try {
    const now = Date.now();
    const ws = await req(tx.objectStore("workspaces").get(workspaceId) as IDBRequest<WorkspaceRecord | undefined>);
    if (!ws) throw new ArchiveError("workspace not found");
    let folders: AssetFolder[] | undefined;
    const addCanvas = (boardId: string, c: PlannedCanvas): string => {
      const canvas: CanvasRecord = { id: newObjectId(), boardId, name: c.name, revision: 0, objectCount: c.objects.length, updatedAt: now };
      tx.objectStore("canvases").put(canvas);
      for (const o of c.objects) tx.objectStore("objects").put({ canvasId: canvas.id, id: o.id, data: serializeObject(o) } satisfies ObjectRecord);
      for (const f of c.frames) tx.objectStore("frames").put({ ...f, canvasId: canvas.id } satisfies FrameStoreRecord);
      if (c.view) tx.objectStore("canvasViews").put(c.view, canvas.id);
      if (c.bookmarks.length) tx.objectStore("bookmarks").put({ canvasId: canvas.id, items: c.bookmarks });
      result.canvases++;
      result.objects += c.objects.length;
      result.firstCanvasId ??= canvas.id;
      return canvas.id;
    };
    if (plan.scope === "canvas") {
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
      else if ((await req(tx.objectStore("assets").count(a.hash))) === 0) {
        tx.objectStore("assets").put(a, a.hash);
        result.assetsAdded++;
      }
      const e = await req(tx.objectStore("assetCatalog").get(a.hash) as IDBRequest<CatalogEntry | undefined>);
      let entry: CatalogEntry = !e ? entryFromRecord(a) : e.state !== "active" ? { ...e, state: "active", deletedAt: null } : e;
      const org = plan.organization.get(a.hash);
      if (org) {
        // Merge, never replace: tags are unioned, a favourite stays a favourite, folders are matched by path, a note is kept (the archive's
        // only fills an empty one), and the archive's fields this asset does not have yet (same name and value) are added after its own.
        folders ??= (await req(tx.objectStore("meta").get("assetFolders") as IDBRequest<AssetFolder[] | undefined>)) ?? [];
        const m = meta(entry);
        // One folder per asset: an asset already filed keeps its folder; otherwise the archive's (first) folder is used.
        const ids = m.folderIds.length || !org.folders.length ? m.folderIds : [resolveFolder(folders, org.folders[0]!)];
        const fields = [...m.fields, ...org.fields.filter((f) => !m.fields.some((x) => x.key === f.key && x.value === f.value))].slice(0, MAX_FIELDS);
        entry = { ...entry, tags: normalizeTags([...m.tags, ...org.tags]), favorite: m.favorite || org.favorite, hidden: m.hidden || org.hidden, folderIds: ids };
        if (m.note || org.note) entry.note = m.note || org.note;
        if (fields.length) entry.fields = fields;
      }
      if (entry !== e) tx.objectStore("assetCatalog").put(entry);
    }
    if (folders) tx.objectStore("meta").put(folders, "assetFolders");
    // The password of the archive is taken only where this device has none: an import never replaces a password.
    if (plan.workspaceLock && !(await req(tx.objectStore("meta").get("workspaceLock") as IDBRequest<unknown>))) tx.objectStore("meta").put(plan.workspaceLock, "workspaceLock");
    if (plan.hiddenLock && !(await req(tx.objectStore("meta").get("hiddenLock") as IDBRequest<unknown>))) tx.objectStore("meta").put(plan.hiddenLock, "hiddenLock");
    if (plan.styles.length) {
      // the saved styles: the ones the library does not have yet are added (by id), none is replaced
      const have = cleanStyles(await req(tx.objectStore("meta").get("styles") as IDBRequest<unknown>));
      const ids = new Set(have.map((x) => x.id));
      const added = plan.styles.filter((x) => !ids.has(x.id));
      if (added.length) {
        tx.objectStore("meta").put([...have, ...added], "styles");
        result.stylesAdded = added.length;
      }
    }
    for (const h of plan.unresolved) if ((await req(tx.objectStore("assets").count(h))) === 0) result.stillMissing++;
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
