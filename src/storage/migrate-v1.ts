import type { SerializedCamera } from "../core/camera";
import { deserializeCamera } from "../core/camera";
import type { SerializedObject } from "../doc/model";
import { deserializeObject, newObjectId, serializeObject } from "../doc/model";
import { done, idbGet } from "./idb";
import type { BoardRecord, CanvasRecord, CurrentMeta, ObjectRecord, WorkspaceRecord } from "./workspace-repo";
import { SCHEMA_VERSION, WorkspaceRepo } from "./workspace-repo";

/**
 * One-time conversion of the Phase 0B snapshot (schema 1) into the
 * Workspace → Board → Canvas schema (schema 2).
 *
 * Field mapping:
 *   snapshots["main"].objects[i]  → objects[[canvasId, id]].data   (validated; same id, same fields)
 *   snapshots["camera"]           → canvasViews[canvasId]
 *   assets[hash]                  → unchanged (already the content-addressed blob store)
 *   (new)                         → workspace "My workspace" › "Board 1" › "Canvas 1"
 *
 * Safety:
 * - Legacy records are only read. They are never modified or deleted here.
 * - The conversion is a single readwrite transaction: all of it or none of it.
 * - Afterwards every converted object is read back and compared with its
 *   source. meta["migration-v1"].verified is set only if all match.
 * - Objects that fail validation are not copied; they are listed in the
 *   migration record and remain recoverable from the untouched legacy store.
 */
interface LegacySnapshot {
  schema: number;
  objects: SerializedObject[];
}

export interface MigrationRecord {
  from: 1;
  to: number;
  at: number;
  canvasId: string;
  sourceObjects: number;
  copied: number;
  skipped: string[];
  verified: boolean;
  verifyError?: string;
}

export type StartupOutcome =
  | { kind: "existing"; current: CurrentMeta }
  | { kind: "created"; current: CurrentMeta }
  | { kind: "migrated"; current: CurrentMeta; migration: MigrationRecord };

/** Ensure a current workspace exists, migrating legacy data on first run. */
export async function ensureWorkspace(repo: WorkspaceRepo): Promise<StartupOutcome> {
  const existing = await repo.current();
  if (existing && (await repo.canvas(existing.canvasId))) return { kind: "existing", current: existing };
  if (existing && (await repo.workspace(existing.workspaceId))) {
    // The current canvas is gone (deleted elsewhere): reopen the first one rather than starting over.
    const tree = await repo.tree(existing.workspaceId);
    const first = tree.boards.find((b) => b.canvases.length > 0);
    if (first) {
      const current = { workspaceId: existing.workspaceId, boardId: first.board.id, canvasId: first.canvases[0]!.id };
      await repo.setCurrent(current);
      return { kind: "existing", current };
    }
  }
  const legacy = await idbGet<LegacySnapshot>(repo.db, "snapshots", "main");
  if (legacy && Array.isArray(legacy.objects) && legacy.objects.length > 0) {
    const migration = await migrateV1(repo, legacy);
    const current = (await repo.current())!;
    return { kind: "migrated", current, migration };
  }
  return { kind: "created", current: await repo.createWorkspace("My workspace") };
}

async function migrateV1(repo: WorkspaceRepo, legacy: LegacySnapshot): Promise<MigrationRecord> {
  const db = repo.db;
  const now = Date.now();
  const valid: SerializedObject[] = [];
  const skipped: string[] = [];
  for (const s of legacy.objects) {
    try {
      // Re-serialize the validated object so stored data is canonical.
      valid.push(serializeObject(deserializeObject(s)));
    } catch (e) {
      skipped.push(`${String(s?.id)}: ${(e as Error).message}`);
    }
  }
  let camera: SerializedCamera | undefined;
  const legacyCamera = await idbGet<SerializedCamera>(db, "snapshots", "camera");
  if (legacyCamera) {
    try {
      deserializeCamera(legacyCamera);
      camera = legacyCamera;
    } catch {
      skipped.push("camera: invalid, not migrated");
    }
  }

  const ws: WorkspaceRecord = { id: newObjectId(), displayName: "My workspace", boardIds: [], createdAt: now, schemaVersion: SCHEMA_VERSION };
  const board: BoardRecord = { id: newObjectId(), workspaceId: ws.id, name: "Board 1", canvasIds: [], createdAt: now };
  const canvas: CanvasRecord = { id: newObjectId(), boardId: board.id, name: "Canvas 1", revision: 1, objectCount: valid.length, updatedAt: now };
  ws.boardIds.push(board.id);
  board.canvasIds.push(canvas.id);
  const record: MigrationRecord = {
    from: 1,
    to: SCHEMA_VERSION,
    at: now,
    canvasId: canvas.id,
    sourceObjects: legacy.objects.length,
    copied: valid.length,
    skipped,
    verified: false,
  };

  const tx = db.transaction(["workspaces", "boards", "canvases", "objects", "canvasViews", "meta"], "readwrite", { durability: "strict" });
  tx.objectStore("workspaces").put(ws);
  tx.objectStore("boards").put(board);
  tx.objectStore("canvases").put(canvas);
  for (const data of valid) tx.objectStore("objects").put({ canvasId: canvas.id, id: data.id, data } satisfies ObjectRecord);
  if (camera) tx.objectStore("canvasViews").put(camera, canvas.id);
  tx.objectStore("meta").put(record, "migration-v1");
  tx.objectStore("meta").put({ workspaceId: ws.id, boardId: board.id, canvasId: canvas.id } satisfies CurrentMeta, "current");
  await done(tx);

  // Verify by reading everything back and comparing with the source.
  try {
    const loaded = await repo.loadCanvas(canvas.id);
    if (loaded.skipped.length) throw new Error(`${loaded.skipped.length} migrated objects failed to load`);
    if (loaded.objects.length !== valid.length) throw new Error(`expected ${valid.length} objects, found ${loaded.objects.length}`);
    const byId = new Map(loaded.objects.map((o) => [o.id, JSON.stringify(serializeObject(o))]));
    for (const data of valid) {
      if (byId.get(data.id) !== JSON.stringify(data)) throw new Error(`object ${data.id} differs after migration`);
    }
    record.verified = true;
  } catch (e) {
    record.verifyError = (e as Error).message;
  }
  const vtx = db.transaction("meta", "readwrite", { durability: "strict" });
  vtx.objectStore("meta").put(record, "migration-v1");
  await done(vtx);
  return record;
}
