import type { AssetRecord } from "../assets/asset-library";
import { extOf } from "../assets/file-kind";
import type { AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import { folderPath, meta } from "../assets/asset-catalog";
import { storedAssetOf } from "../doc/model";
import { req } from "./idb";
import { externalFolder } from "./external-folder";
import type { BoardRecord, CanvasRecord, ObjectRecord } from "./workspace-repo";
import { hiddenSet } from "./archive";
import type { ExportScope, ProgressFn } from "./archive";
import type { ZipInput } from "./zip";
import { writeZip } from "./zip";

/**
 * A plain ZIP of the original files (not a `.canvast` archive): ordinary files under their own names, grouped in folders, that any
 * tool can open. Two ways to group them: by file type (a folder for each extension: png, mp4, obj, ...) or by the folder each asset is filed in
 * inside the app (an asset with no folder goes in the folder of its kind).
 */
export type FilesLayout = "type" | "folder";

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
    const candidate = `${dir}/${n === 1 ? file : `${stem} (${n})${ext}`}`;
    const key = candidate.toLowerCase();
    if (!taken.has(key)) {
      taken.add(key);
      return candidate;
    }
  }
}

const range = (canvasId: string): IDBKeyRange => IDBKeyRange.bound([canvasId, ""], [canvasId, "￿"]);

export async function buildFilesZip(db: IDBDatabase, workspaceId: string, scope: ExportScope, layout: FilesLayout, progress?: ProgressFn): Promise<FilesZipResult> {
  const tx = db.transaction(["workspaces", "boards", "canvases", "objects", "assets", "assetCatalog", "meta"], "readonly");
  const hashes = new Set<string>(scope.kind === "assets" ? scope.hashes : []);
  if (scope.kind === "workspace") {
    // A whole workspace: every asset in the library, used or not.
    for (const e of await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>)) if (e.state === "active") hashes.add(e.hash);
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
  if (scope.skipHidden) for (const h of await hiddenSet(tx)) hashes.delete(h);
  void workspaceId; // one workspace per profile today; kept so the scopes read the same as the archive's
  const folders = (await req(tx.objectStore("meta").get("assetFolders") as IDBRequest<AssetFolder[] | undefined>)) ?? [];
  const taken = new Set<string>();
  const inputs: ZipInput[] = [];
  const paths: string[] = [];
  let missing = 0;
  // Sorted by name so that duplicates are numbered the same way every time.
  const rows: Array<{ hash: string; rec: AssetRecord; entry: CatalogEntry | undefined }> = [];
  let looked = 0;
  for (const hash of hashes) {
    progress?.("Reading the library", looked++, hashes.size);
    const rec = await req(tx.objectStore("assets").get(hash) as IDBRequest<AssetRecord | undefined>);
    if (!rec) {
      missing++;
      continue;
    }
    rows.push({ hash, rec, entry: await req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>) });
  }
  // Originals kept in the library folder are read now, after the last read of the database (ADR 0159).
  for (const [i, r] of [...rows.entries()].reverse()) {
    if (!r.rec.ext) continue;
    progress?.("Reading the files of the library folder", rows.length - i, rows.length);
    const blob = await externalFolder.read(r.hash, r.rec.size, r.rec.type, r.rec.file);
    if (blob) r.rec = { ...r.rec, blob };
    else {
      rows.splice(i, 1);
      missing++;
    }
  }
  for (const r of rows) if (r.entry && r.entry.name !== r.rec.name) r.rec = { ...r.rec, name: r.entry.name }; // the catalog holds the current name
  rows.sort((a, b) => a.rec.name.localeCompare(b.rec.name) || a.hash.localeCompare(b.hash));
  for (const { hash, rec, entry } of rows) {
    const kind = kindFolder(rec.type, rec.name);
    const own = layout === "folder" && entry ? meta(entry).folderIds[0] : undefined;
    const parts = own ? folderPath(folders, own).map((n) => safeName(n, "Folder")) : [];
    const dir = parts.length ? parts.join("/") : kind;
    const path = uniquePath(taken, dir, safeName(rec.name, `file-${hash.slice(0, 8)}`));
    inputs.push({ name: path, data: rec.blob });
    paths.push(path);
  }
  return { blob: await writeZip(inputs, new Date(), false, (d, n) => progress?.("Writing the ZIP", d, n)), files: inputs.length, missing, paths };
}

