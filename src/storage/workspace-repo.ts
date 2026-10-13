import type { SerializedCamera } from "../core/camera";
import type { CanvasObject, ObjectId, SerializedObject } from "../doc/model";
import { deserializeObject, newObjectId, serializeObject } from "../doc/model";
import { done, idbGet, req } from "./idb";

/**
 * Persistent hierarchy: Workspace → Boards → Canvas (ADR 0006).
 *
 * Identity is always a stable random id, never a display name or position.
 * Objects are stored one record per object under their canvas, so a save
 * writes only what changed. Each canvas carries a `revision` that every commit
 * checks and increments inside the same transaction: a commit prepared
 * against an older revision (a stale tab, or a lost writer lease) is rejected
 * as a conflict instead of overwriting newer data.
 */
export const SCHEMA_VERSION = 2;

export interface WorkspaceRecord {
  id: string;
  displayName: string;
  boardIds: string[];
  createdAt: number;
  schemaVersion: number;
}

export interface BoardRecord {
  id: string;
  workspaceId: string;
  name: string;
  canvasIds: string[];
  createdAt: number;
}

export interface CanvasRecord {
  id: string;
  boardId: string;
  name: string;
  /** Incremented by every committed change to this canvas's objects. */
  revision: number;
  objectCount: number;
  updatedAt: number;
}

export interface ObjectRecord {
  canvasId: string;
  id: ObjectId;
  data: SerializedObject;
}

export interface CurrentMeta {
  workspaceId: string;
  boardId: string;
  canvasId: string;
}

export class RevisionConflictError extends Error {
  constructor(
    readonly canvasId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`canvas ${canvasId} is at revision ${actual}, expected ${expected}: it was changed elsewhere`);
  }
}

export interface LoadedCanvas {
  canvas: CanvasRecord;
  objects: CanvasObject[];
  /** Records that failed validation, with reasons; never silently repaired. */
  skipped: string[];
  camera: SerializedCamera | null;
}

export interface CommitResult {
  revision: number;
  puts: number;
  deletes: number;
}

export class WorkspaceRepo {
  constructor(readonly db: IDBDatabase) {}

  async current(): Promise<CurrentMeta | undefined> {
    return idbGet<CurrentMeta>(this.db, "meta", "current");
  }

  async setCurrent(cur: CurrentMeta): Promise<void> {
    const tx = this.db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(cur, "current");
    await done(tx);
  }

  workspace(id: string): Promise<WorkspaceRecord | undefined> {
    return idbGet<WorkspaceRecord>(this.db, "workspaces", id);
  }

  board(id: string): Promise<BoardRecord | undefined> {
    return idbGet<BoardRecord>(this.db, "boards", id);
  }

  canvas(id: string): Promise<CanvasRecord | undefined> {
    return idbGet<CanvasRecord>(this.db, "canvases", id);
  }

  /** The workspace tree for navigation: boards in order, each with its canvases in order. */
  async tree(workspaceId: string): Promise<{ workspace: WorkspaceRecord; boards: Array<{ board: BoardRecord; canvases: CanvasRecord[] }> }> {
    const tx = this.db.transaction(["workspaces", "boards", "canvases"], "readonly");
    const ws = await req(tx.objectStore("workspaces").get(workspaceId) as IDBRequest<WorkspaceRecord | undefined>);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    const boards = [];
    for (const bid of ws.boardIds) {
      const board = await req(tx.objectStore("boards").get(bid) as IDBRequest<BoardRecord | undefined>);
      if (!board) continue;
      const canvases: CanvasRecord[] = [];
      for (const cid of board.canvasIds) {
        const c = await req(tx.objectStore("canvases").get(cid) as IDBRequest<CanvasRecord | undefined>);
        if (c) canvases.push(c);
      }
      boards.push({ board, canvases });
    }
    return { workspace: ws, boards };
  }

  /** Create a workspace with one board holding one empty canvas, and make it current. */
  async createWorkspace(displayName: string): Promise<CurrentMeta> {
    const now = Date.now();
    const ws: WorkspaceRecord = { id: newObjectId(), displayName, boardIds: [], createdAt: now, schemaVersion: SCHEMA_VERSION };
    const board: BoardRecord = { id: newObjectId(), workspaceId: ws.id, name: "Board 1", canvasIds: [], createdAt: now };
    const canvas: CanvasRecord = { id: newObjectId(), boardId: board.id, name: "Canvas 1", revision: 0, objectCount: 0, updatedAt: now };
    ws.boardIds.push(board.id);
    board.canvasIds.push(canvas.id);
    const cur = { workspaceId: ws.id, boardId: board.id, canvasId: canvas.id };
    const tx = this.db.transaction(["workspaces", "boards", "canvases", "meta"], "readwrite", { durability: "strict" });
    tx.objectStore("workspaces").put(ws);
    tx.objectStore("boards").put(board);
    tx.objectStore("canvases").put(canvas);
    tx.objectStore("meta").put(cur, "current");
    await done(tx);
    return cur;
  }

  /** Append a new board (with one empty canvas) to a workspace. */
  async createBoard(workspaceId: string, name: string): Promise<{ board: BoardRecord; canvas: CanvasRecord }> {
    const now = Date.now();
    const tx = this.db.transaction(["workspaces", "boards", "canvases"], "readwrite", { durability: "strict" });
    const ws = await req(tx.objectStore("workspaces").get(workspaceId) as IDBRequest<WorkspaceRecord | undefined>);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    const board: BoardRecord = { id: newObjectId(), workspaceId, name, canvasIds: [], createdAt: now };
    const canvas: CanvasRecord = { id: newObjectId(), boardId: board.id, name: "Canvas 1", revision: 0, objectCount: 0, updatedAt: now };
    board.canvasIds.push(canvas.id);
    ws.boardIds.push(board.id);
    tx.objectStore("workspaces").put(ws);
    tx.objectStore("boards").put(board);
    tx.objectStore("canvases").put(canvas);
    await done(tx);
    return { board, canvas };
  }

  /** Append a new empty canvas to a board. */
  async createCanvas(boardId: string, name: string): Promise<CanvasRecord> {
    const tx = this.db.transaction(["boards", "canvases"], "readwrite", { durability: "strict" });
    const board = await req(tx.objectStore("boards").get(boardId) as IDBRequest<BoardRecord | undefined>);
    if (!board) throw new Error(`board ${boardId} not found`);
    const canvas: CanvasRecord = { id: newObjectId(), boardId, name, revision: 0, objectCount: 0, updatedAt: Date.now() };
    board.canvasIds.push(canvas.id);
    tx.objectStore("boards").put(board);
    tx.objectStore("canvases").put(canvas);
    await done(tx);
    return canvas;
  }

  async renameBoard(id: string, name: string): Promise<void> {
    const tx = this.db.transaction("boards", "readwrite");
    const b = await req(tx.objectStore("boards").get(id) as IDBRequest<BoardRecord | undefined>);
    if (!b) throw new Error(`board ${id} not found`);
    tx.objectStore("boards").put({ ...b, name });
    await done(tx);
  }

  async renameCanvas(id: string, name: string): Promise<void> {
    const tx = this.db.transaction("canvases", "readwrite");
    const c = await req(tx.objectStore("canvases").get(id) as IDBRequest<CanvasRecord | undefined>);
    if (!c) throw new Error(`canvas ${id} not found`);
    // Renaming does not change the object revision (it is not an object edit).
    tx.objectStore("canvases").put({ ...c, name });
    await done(tx);
  }

  /** Load one canvas's objects (lazily, per canvas) and its saved camera. */
  async loadCanvas(canvasId: string): Promise<LoadedCanvas> {
    const tx = this.db.transaction(["canvases", "objects", "canvasViews"], "readonly");
    const canvas = await req(tx.objectStore("canvases").get(canvasId) as IDBRequest<CanvasRecord | undefined>);
    if (!canvas) throw new Error(`canvas ${canvasId} not found`);
    const range = IDBKeyRange.bound([canvasId, ""], [canvasId, "￿"]);
    const records = await req(tx.objectStore("objects").getAll(range) as IDBRequest<ObjectRecord[]>);
    const camera = (await req(tx.objectStore("canvasViews").get(canvasId) as IDBRequest<SerializedCamera | undefined>)) ?? null;
    const objects: CanvasObject[] = [];
    const skipped: string[] = [];
    for (const r of records) {
      try {
        objects.push(deserializeObject(r.data));
      } catch (e) {
        skipped.push(`${r.id}: ${(e as Error).message}`);
      }
    }
    return { canvas, objects, skipped, camera };
  }

  /**
   * Atomically apply object puts/deletes to a canvas, provided its stored
   * revision is still `expectedRevision`. Resolves with the new revision once
   * the transaction has committed (durability "strict").
   */
  async commit(canvasId: string, expectedRevision: number, puts: readonly CanvasObject[], deletes: readonly ObjectId[]): Promise<CommitResult> {
    const tx = this.db.transaction(["canvases", "objects"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    try {
      const canvas = await req(tx.objectStore("canvases").get(canvasId) as IDBRequest<CanvasRecord | undefined>);
      if (!canvas) throw new Error(`canvas ${canvasId} not found`);
      if (canvas.revision !== expectedRevision) throw new RevisionConflictError(canvasId, expectedRevision, canvas.revision);
      const objects = tx.objectStore("objects");
      for (const o of puts) objects.put({ canvasId, id: o.id, data: serializeObject(o) } satisfies ObjectRecord);
      for (const id of deletes) objects.delete([canvasId, id]);
      const count = await req(objects.count(IDBKeyRange.bound([canvasId, ""], [canvasId, "￿"])));
      const next: CanvasRecord = { ...canvas, revision: canvas.revision + 1, objectCount: count, updatedAt: Date.now() };
      tx.objectStore("canvases").put(next);
      await committed;
      return { revision: next.revision, puts: puts.length, deletes: deletes.length };
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

  /** Read back a canvas revision (used to report "verified"). */
  async revision(canvasId: string): Promise<number | undefined> {
    return (await this.canvas(canvasId))?.revision;
  }

  async saveCamera(canvasId: string, camera: SerializedCamera): Promise<void> {
    const tx = this.db.transaction("canvasViews", "readwrite");
    tx.objectStore("canvasViews").put(camera, canvasId);
    await done(tx);
  }
}
