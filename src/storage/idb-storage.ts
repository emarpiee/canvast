/** The browser build's storage: the workspace, its backups and the library in IndexedDB (ADR 0006–0008, 0176, 0177). */
import type { ExportScope, ImportPlan, ProgressFn } from "./archive";
import { applyImport, buildArchive, hiddenInScope, sweepImportStaging } from "./archive";
import type { FilesLayout } from "./files-zip";
import { buildFilesZip } from "./files-zip";
import { done, idbGet, req } from "./idb";
import type { BackupRecord, BackupStore, OriginalStore, Storage } from "./store";
import { WorkspaceRepo } from "./workspace-repo";
import type { CatalogEntry, ThumbRecord } from "../assets/asset-catalog";
import { AssetCatalog, entryFromRecord } from "../assets/asset-catalog";
import type { AssetRecord } from "../assets/asset-library";
import { ImportError } from "../assets/asset-library";
import { FULL_MESSAGE, isQuotaError, nearFullNotice, requestPersistence } from "./quota";
import { externalFolder, folderFileName } from "./external-folder";

export function idbStorage(db: IDBDatabase): Storage {
  const catalog = new AssetCatalog(db);
  return { workspace: new WorkspaceRepo(db), backups: new IdbBackups(db), catalog, originals: new IdbOriginals(db, catalog), db };
}

/** Archives and ZIPs read from and written to IndexedDB. */
export class IdbBackups implements BackupStore {
  constructor(private readonly db: IDBDatabase) {}

  buildArchive(workspaceId: string, scope: ExportScope, appVersion: string, settings: Record<string, unknown> | undefined, progress?: ProgressFn) {
    return buildArchive(this.db, workspaceId, scope, appVersion, settings, progress);
  }

  buildFilesZip(workspaceId: string, scope: ExportScope, layout: FilesLayout, progress?: ProgressFn) {
    return buildFilesZip(this.db, workspaceId, scope, layout, progress);
  }

  hiddenInScope(scope: ExportScope): Promise<number> {
    return hiddenInScope(this.db, scope);
  }

  applyImport(workspaceId: string, boardId: string, plan: ImportPlan, progress?: ProgressFn) {
    return applyImport(this.db, workspaceId, boardId, plan, progress);
  }

  sweepImportStaging(): Promise<number> {
    return sweepImportStaging(this.db);
  }

  async lastBackup(): Promise<BackupRecord | null> {
    return (await idbGet<BackupRecord>(this.db, "meta", "backup")) ?? null;
  }

  async recordBackup(rec: BackupRecord): Promise<void> {
    const tx = this.db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(rec, "backup");
    await done(tx);
  }
}

/** Originals in the "assets" store, or kept as files in the library folder with a stub here (ADR 0159). */
export class IdbOriginals implements OriginalStore {
  onNotice: ((text: string) => void) | null = null;

  constructor(
    private readonly db: IDBDatabase,
    private readonly catalog: AssetCatalog,
  ) {}

  async get(hash: string): Promise<AssetRecord | undefined> {
    let rec = await idbGet<AssetRecord>(this.db, "assets", hash);
    if (!rec) return rec;
    if (rec.ext) {
      // Kept in the library folder: missing (as for a cleared store) when the file or the permission is gone.
      const blob = await externalFolder.read(hash, rec.size, rec.type, rec.file);
      if (!blob) return undefined;
      rec = { ...rec, blob };
    }
    // The name is the catalog entry's: renaming an asset (ADR 0085) changes that entry and never rewrites the stored bytes.
    const entry = await idbGet<CatalogEntry>(this.db, "assetCatalog", hash).catch(() => undefined);
    return entry && entry.name !== rec.name ? { ...rec, name: entry.name } : rec;
  }

  async entryState(hash: string): Promise<CatalogEntry["state"] | undefined> {
    return (await idbGet<CatalogEntry>(this.db, "assetCatalog", hash))?.state;
  }

  /**
   * Write the original (when new) and its catalog entry in one transaction.
   * Importing bytes that are already stored adds no copy; it only returns a
   * deleted or absent catalog entry to the library.
   */
  async put(record: AssetRecord, writeBytes: boolean): Promise<void> {
    // With a library folder the file is written and proven first; only then does the browser keep a stub of it.
    const toFolder = writeBytes && externalFolder.ready;
    const file = folderFileName(record.hash, record.name, record.type);
    if (toFolder) {
      try {
        await externalFolder.write(record.hash, record.blob, file);
      } catch (err) {
        throw new ImportError((err as Error).message);
      }
    }
    try {
      const tx = this.db.transaction(["assets", "assetCatalog"], "readwrite", { durability: "strict" });
      const committed = done(tx);
      if (writeBytes) tx.objectStore("assets").put(toFolder ? ({ ...record, blob: new Blob([]), ext: 1, file } satisfies AssetRecord) : record, record.hash);
      const e = await req(tx.objectStore("assetCatalog").get(record.hash) as IDBRequest<CatalogEntry | undefined>);
      if (!e) tx.objectStore("assetCatalog").put(entryFromRecord(record));
      else if (e.state !== "active") tx.objectStore("assetCatalog").put({ ...e, state: "active", deletedAt: null } satisfies CatalogEntry);
      await committed;
    } catch (err) {
      if (isQuotaError(err)) throw new ImportError(FULL_MESSAGE);
      throw err;
    }
    if (writeBytes) {
      void requestPersistence();
      void nearFullNotice().then((t) => t && this.onNotice?.(t));
    }
  }

  putThumb(rec: ThumbRecord): Promise<void> {
    return this.catalog.putThumb(rec);
  }
}
