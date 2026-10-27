/** The browser build's storage: the workspace, its backups and the library in IndexedDB (ADR 0006–0008, 0176, 0177). */
import type { ExportScope, ImportPlan, ProgressFn } from "./archive";
import { applyImport, buildArchive, hiddenInScope, sweepImportStaging } from "./archive";
import type { FilesLayout } from "./files-zip";
import { buildFilesZip } from "./files-zip";
import { done, idbGet } from "./idb";
import type { BackupRecord, BackupStore, Storage } from "./store";
import { WorkspaceRepo } from "./workspace-repo";
import { AssetCatalog } from "../assets/asset-catalog";

export function idbStorage(db: IDBDatabase): Storage {
  return { workspace: new WorkspaceRepo(db), backups: new IdbBackups(db), catalog: new AssetCatalog(db), db };
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
