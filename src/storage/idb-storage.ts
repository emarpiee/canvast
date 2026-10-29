/** The browser build's storage: the workspace, its backups and the library in IndexedDB (ADR 0006–0008, 0176, 0177). */
import type { ExportScope, ImportPlan, LibraryStore, OriginalWriter, ProgressFn } from "./archive";
import { applyImport, buildArchive, hiddenInScope, sweepImportStaging } from "./archive";
import type { FilesLayout } from "./files-zip";
import { buildFilesZip } from "./files-zip";
import { done, idbGet, openDb, req } from "./idb";
import type { OpenOptions } from "./idb";
import type { BackupRecord, BackupStore, LibraryFolderStore, OriginalStore, Storage } from "./store";
import { WorkspaceRepo } from "./workspace-repo";
import type { CatalogEntry, ThumbRecord } from "../assets/asset-catalog";
import { AssetCatalog, entryFromRecord } from "../assets/asset-catalog";
import type { AssetRecord } from "../assets/asset-library";
import { ImportError, MAX_IMPORT_BYTES, storedStub } from "../assets/asset-library";
import { FULL_MESSAGE, isQuotaError, nearFullNotice, requestPersistence } from "./quota";
import { externalFolder, externalHashes, libraryCounts } from "./external-folder";
import { isHiddenFile } from "./hidden-vault";
import { addExtensions, moveFromFolder, moveToFolder } from "./folder-move";
import { resetAllData } from "./reset";

/** The browser build's storage, with its database (which only the #debug test hook reads directly). */
export interface IdbStorage extends Storage {
  readonly db: IDBDatabase;
}

/** Open the database (upgrading it if needed) and the library folder's link, before anything is drawn. */
export async function openBrowserStorage(opts: OpenOptions): Promise<IdbStorage> {
  const db = await openDb(undefined, opts);
  await externalFolder.load(db);
  return idbStorage(db);
}

export function idbStorage(db: IDBDatabase): IdbStorage {
  const catalog = new AssetCatalog(db);
  return {
    db,
    workspace: new WorkspaceRepo(db),
    backups: new IdbBackups(db),
    catalog,
    originals: new IdbOriginals(db, catalog),
    libraryFolder: idbLibraryFolder(db),
    workspaceFolder: null,
    hidden: null,
    folderSync: null,
    resetAll: (onBlocked) => resetAllData({ db, ...(onBlocked ? { onBlocked } : {}) }),
    flush: async () => undefined,
    folderWriting: null,
  };
}

function idbLibraryFolder(db: IDBDatabase): LibraryFolderStore {
  return {
    keptHashes: () => externalHashes(db),
    counts: () => libraryCounts(db),
    choose: () => externalFolder.choose(db),
    forget: () => externalFolder.forget(db),
    moveIn: (progress) => moveToFolder(db, progress),
    moveOut: (progress) => moveFromFolder(db, progress),
    addExtensions: (progress) => addExtensions(db, progress),
  };
}

/** Archives and ZIPs read from and written to IndexedDB. */
export class IdbBackups implements BackupStore {
  constructor(private readonly db: IDBDatabase) {}

  /** Where an import's originals are written instead of the database (set by the desktop build: its workspace folder). */
  writeOriginals: OriginalWriter | null = null;
  /** The desktop build's library (SQLite), where the library's entries and records are instead of the database. */
  library: LibraryStore | undefined = undefined;

  buildArchive(workspaceId: string, scope: ExportScope, appVersion: string, settings: Record<string, unknown> | undefined, progress?: ProgressFn) {
    return buildArchive(this.db, workspaceId, scope, appVersion, settings, progress, this.library);
  }

  buildFilesZip(workspaceId: string, scope: ExportScope, layout: FilesLayout, progress?: ProgressFn) {
    return buildFilesZip(this.db, workspaceId, scope, layout, progress, this.library);
  }

  hiddenInScope(scope: ExportScope): Promise<number> {
    return hiddenInScope(this.db, scope, this.library);
  }

  applyImport(workspaceId: string, boardId: string, plan: ImportPlan, progress?: ProgressFn) {
    return applyImport(this.db, workspaceId, boardId, plan, progress, this.writeOriginals ?? undefined, this.library);
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
    if (rec.ext && rec.size > MAX_IMPORT_BYTES) {
      // Too big to read into the page (a card, opened in the system's app): only whether its file is there.
      if (!(await externalFolder.hasMany([{ hash, size: rec.size, file: rec.file }]))[0]) return undefined;
      rec = { ...rec, blob: new Blob([]) };
    } else if (rec.ext) {
      // Kept in the library folder: missing (as for a cleared store) when the file or the permission is gone.
      const blob = await externalFolder.read(hash, rec.size, rec.type, rec.file);
      if (!blob) return undefined;
      rec = { ...rec, blob };
    }
    // The name is the catalog entry's: renaming an asset (ADR 0085) changes that entry and never rewrites the stored bytes.
    const entry = await idbGet<CatalogEntry>(this.db, "assetCatalog", hash).catch(() => undefined);
    return entry && entry.name !== rec.name ? { ...rec, name: entry.name } : rec;
  }

  async locked(hash: string): Promise<boolean> {
    if (!externalFolder.unseal || externalFolder.unseal.ready()) return false;
    const rec = await idbGet<AssetRecord>(this.db, "assets", hash);
    return !!rec?.ext && isHiddenFile(rec.file);
  }

  async fileOf(hash: string): Promise<string | null> {
    const rec = await idbGet<AssetRecord>(this.db, "assets", hash);
    return rec?.ext && rec.file && !isHiddenFile(rec.file) ? rec.file : null;
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
    // With a library folder the file is written and proven first; only then does the browser keep a stub of it. A file found in the
    // workspace folder (`record.file` on a record that is not a stub) is kept where it is.
    const toFolder = writeBytes && externalFolder.ready;
    const kept = toFolder && !record.ext && record.file ? record.file : "";
    const file = kept || (toFolder ? await externalFolder.fileFor(record.hash, record.name, record.type) : "");
    if (toFolder && !kept) {
      try {
        await externalFolder.write(record.hash, record.blob, file);
      } catch (err) {
        externalFolder.release(file);
        throw new ImportError((err as Error).message);
      }
    }
    try {
      const tx = this.db.transaction(["assets", "assetCatalog"], "readwrite", { durability: "strict" });
      const committed = done(tx);
      if (writeBytes) tx.objectStore("assets").put(toFolder ? storedStub({ ...record, blob: new Blob([]), ext: 1, file }) : record, record.hash);
      const e = await req(tx.objectStore("assetCatalog").get(record.hash) as IDBRequest<CatalogEntry | undefined>);
      if (!e) tx.objectStore("assetCatalog").put(entryFromRecord(record));
      else if (e.state !== "active") tx.objectStore("assetCatalog").put({ ...e, state: "active", deletedAt: null } satisfies CatalogEntry);
      await committed;
    } catch (err) {
      if (isQuotaError(err)) throw new ImportError(FULL_MESSAGE);
      throw err;
    } finally {
      if (file && !kept) externalFolder.release(file);
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
