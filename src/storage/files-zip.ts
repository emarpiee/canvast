import type { AssetRecord } from "../assets/asset-library";
import { MAX_IMPORT_BYTES } from "../assets/asset-library";
import { extOf } from "../assets/file-kind";
import type { AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import { folderPath, meta } from "../assets/asset-catalog";
import { storedAssetOf } from "../doc/model";
import { req } from "./idb";
import { externalFolder } from "./external-folder";
import type { BoardRecord, CanvasRecord, ObjectRecord } from "./workspace-repo";
import { hiddenSet, libraryIn, snapOf } from "./archive";
import type { ExportScope, LibraryStore, ProgressFn } from "./archive";
import type { ZipInput } from "./zip";
import { writeZip } from "./zip";

/**
 * A plain ZIP of the original files (not a `.canvast` archive): ordinary files under their own names, grouped in folders, that any
 * tool can open. Grouped by file type (a folder for each extension: png, mp4, obj, ...), by the folder each asset is filed in inside the
 * app (an asset with no folder goes in the folder of its kind; for a folder's export, `under`, the paths start at that folder), or not
 * at all (`flat`: every file at the top, numbered when two share a name).
 */
export type FilesLayout = "type" | "folder" | "flat";

/** The files an export writes: each one's path in it, and its bytes, read when asked for (one at a time: a folder of many GB is never held whole). */
export interface FilesPlan {
  files: Array<{ hash: string; path: string; read(): Promise<Blob | null> }>;
  /** Assets referenced but whose original is missing (not included). */
  missing: number;
}

export interface FilesZipResult {
  blob: Blob;
  files: number;
  /** Assets referenced but whose original is missing (not included). */
  missing: number;
  /** The ZIP's paths, in order. */
  paths: string[];
}

/** The folder name for a file: its extension in lower case ("obj" for item.obj), or "other" when the name has none. */
export function kindFolder(_type: string, name: string): string {
  const ext = extOf(name).toLowerCase();
  return ext || "other";
}

/** A name safe on every file system, keeping the original wording. */
export function safeName(raw: string, fallback: string): string {
  const cleaned = raw
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "-")
    .replace(/^[.\s]+|[\s.]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

/** `name.ext` becomes `name (2).ext` when `taken` already holds it (compared without regard to case). */
export function uniquePath(taken: Set<string>, dir: string, file: string): string {
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  for (let n = 1; ; n++) {
    const candidate = `${dir ? `${dir}/` : ""}${n === 1 ? file : `${stem} (${n})${ext}`}`;
    const key = candidate.toLowerCase();
    if (!taken.has(key)) {
      taken.add(key);
      return candidate;
    }
  }
}

const range = (canvasId: string): IDBKeyRange => IDBKeyRange.bound([canvasId, ""], [canvasId, "￿"]);

export async function buildFilesZip(db: IDBDatabase, workspaceId: string, scope: ExportScope, layout: FilesLayout, progress?: ProgressFn, lib?: LibraryStore): Promise<FilesZipResult> {
  const plan = await planFiles(db, workspaceId, scope, layout, progress, lib);
  const inputs: ZipInput[] = [];
  let missing = plan.missing;
  for (const [i, f] of plan.files.entries()) {
    progress?.("Reading the files of the library folder", i, plan.files.length);
    const blob = await f.read();
    if (blob) inputs.push({ name: f.path, data: blob });
    else missing++;
  }
  // shortcut: the ZIP is made in memory (its files are read one at a time, then written together); stream it to disk for exports of many GB.
  return { blob: await writeZip(inputs, new Date(), false, (d, n) => progress?.("Writing the ZIP", d, n)), files: inputs.length, missing, paths: inputs.map((i) => i.name) };
}

/** What an export of `scope` writes, named and grouped as asked (see `FilesLayout`), without reading the files yet. */
export async function planFiles(db: IDBDatabase, workspaceId: string, scope: ExportScope, layout: FilesLayout, progress?: ProgressFn, lib?: LibraryStore): Promise<FilesPlan> {
  const snap = await snapOf(lib);
  const tx = db.transaction(["workspaces", "boards", "canvases", "objects", "assets", "assetCatalog", "meta"], "readonly");
  const hashes = new Set<string>(scope.kind === "assets" ? scope.hashes : []);
  if (scope.kind === "workspace") {
    // A whole workspace: every asset in the library, used or not.
    for (const e of await libraryIn(tx, snap).entries()) if (e.state === "active") hashes.add(e.hash);
  } else if (scope.kind !== "assets") {
    const canvasIds: string[] = [];
    if (scope.kind === "canvas") canvasIds.push(scope.canvasId);
    else {
      const b = await req(tx.objectStore("boards").get(scope.boardId) as IDBRequest<BoardRecord | undefined>);
      canvasIds.push(...(b?.canvasIds ?? []));
    }
    for (const cid of canvasIds) {
      const c = await req(tx.objectStore("canvases").get(cid) as IDBRequest<CanvasRecord | undefined>);
      if (!c) continue;
      for (const r of await req(tx.objectStore("objects").getAll(range(cid)) as IDBRequest<ObjectRecord[]>)) {
        const a = storedAssetOf(r.data);
        if (a) hashes.add(a);
      }
    }
  }
  if (scope.skipHidden) for (const h of await hiddenSet(tx, snap)) hashes.delete(h);
  void workspaceId; // one workspace per profile today; kept so the scopes read the same as the archive's
  const folders = await libraryIn(tx, snap).folders();
  const taken = new Set<string>();
  let missing = 0;
  // Sorted by name so that duplicates are numbered the same way every time.
  const rows: Array<{ hash: string; rec: AssetRecord; entry: CatalogEntry | undefined }> = [];
  let looked = 0;
  for (const hash of hashes) {
    progress?.("Reading the library", looked++, hashes.size);
    const rec = await libraryIn(tx, snap).rec(hash);
    if (!rec) {
      missing++;
      continue;
    }
    rows.push({ hash, rec, entry: await libraryIn(tx, snap).entry(hash) });
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.rec.ext && rows[i]!.rec.size > MAX_IMPORT_BYTES) {
      rows.splice(i, 1); // (too big to read into the page: left out, and counted as not included)
      missing++;
    }
  }
  for (const r of rows) if (r.entry && r.entry.name !== r.rec.name) r.rec = { ...r.rec, name: r.entry.name }; // the catalog holds the current name
  rows.sort((a, b) => a.rec.name.localeCompare(b.rec.name) || a.hash.localeCompare(b.hash));
  // A folder's export: its own path is cut down to its name, so the files start at it.
  const cut = scope.kind === "assets" && scope.under ? Math.max(0, folderPath(folders, scope.under).length - 1) : 0;
  const files: FilesPlan["files"] = [];
  for (const { hash, rec, entry } of rows) {
    const kind = kindFolder(rec.type, rec.name);
    const own = layout === "folder" && entry ? meta(entry).folderIds[0] : undefined;
    const parts = own ? folderPath(folders, own).slice(cut).map((n) => safeName(n, "Folder")) : [];
    const dir = layout === "flat" ? "" : parts.length ? parts.join("/") : kind;
    // Originals kept in the library folder are read when written, after the last read of the database (ADR 0159).
    const read = (): Promise<Blob | null> => (rec.ext ? externalFolder.read(hash, rec.size, rec.type, rec.file) : Promise.resolve(rec.blob));
    files.push({ hash, path: uniquePath(taken, dir, safeName(rec.name, `file-${hash.slice(0, 8)}`)), read });
  }
  return { files, missing };
}

