import type { SerializedCamera } from "../core/camera";
import type { FrameRecord, StoredFrameView } from "../core/frames";
import type { Bookmark } from "./bookmarks";
import { readBookmarks } from "./bookmarks";
import { FrameSpace } from "../core/frames";
import type { CanvasObject, ObjectId, SerializedObject } from "../doc/model";
import { deserializeObject, newObjectId, serializeObject } from "../doc/model";
import { plainText } from "../text/markdown";
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

/** A frame of a canvas as stored (store "frames"). */
export type FrameStoreRecord = FrameRecord & { canvasId: string };

/** A saved view: frame form (schema 4) or the absolute camera of earlier versions. */
export type StoredView = SerializedCamera | StoredFrameView;

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

/** A structural rule would be broken (last canvas, last board, open canvas). Nothing was changed. */
export class HierarchyError extends Error {}

export interface LoadedCanvas {
  canvas: CanvasRecord;
  objects: CanvasObject[];
  /** The frames the objects (and the saved view) live in; give it to DocumentStore.load. */
  space: FrameSpace;
  /** Records that failed validation, with reasons; never silently repaired. */
  skipped: string[];
  camera: StoredView | null;
  bookmarks: Bookmark[];
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

  async renameWorkspace(id: string, name: string): Promise<void> {
    const tx = this.db.transaction("workspaces", "readwrite");
    const w = await req(tx.objectStore("workspaces").get(id) as IDBRequest<WorkspaceRecord | undefined>);
    if (!w) throw new Error(`workspace ${id} not found`);
    tx.objectStore("workspaces").put({ ...w, displayName: name });
    await done(tx);
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

  /**
   * Delete one canvas with its objects and saved view, in one transaction.
   * Refused if it is the board's only canvas (delete the board instead), if
   * it is the current canvas (switch away first), or if its revision is not
   * `expectedRevision` (it changed since the user confirmed). Originals of
   * images on it stay in the asset library.
   */
  async deleteCanvas(canvasId: string, expectedRevision: number): Promise<{ objects: number }> {
    return this.deleteTx(["boards"], async (tx) => {
      const canvas = await req(tx.objectStore("canvases").get(canvasId) as IDBRequest<CanvasRecord | undefined>);
      if (!canvas) throw new Error(`canvas ${canvasId} not found`);
      const board = await req(tx.objectStore("boards").get(canvas.boardId) as IDBRequest<BoardRecord | undefined>);
      if (!board) throw new Error(`board ${canvas.boardId} not found`);
      if (board.canvasIds.length <= 1) throw new HierarchyError("A board needs at least one canvas. Delete the board instead.");
      const objects = await this.removeCanvas(tx, canvas, expectedRevision);
      tx.objectStore("boards").put({ ...board, canvasIds: board.canvasIds.filter((id) => id !== canvasId) });
      return { objects };
    });
  }

  /**
   * Delete a board with all its canvases, objects and views, in one
   * transaction. Refused for the workspace's only board, for the current
   * board, and if any canvas revision differs from `expected`.
   */
  async deleteBoard(boardId: string, expected: ReadonlyMap<string, number>): Promise<{ canvases: number; objects: number }> {
    return this.deleteTx(["workspaces", "boards"], async (tx) => {
      const board = await req(tx.objectStore("boards").get(boardId) as IDBRequest<BoardRecord | undefined>);
      if (!board) throw new Error(`board ${boardId} not found`);
      const ws = await req(tx.objectStore("workspaces").get(board.workspaceId) as IDBRequest<WorkspaceRecord | undefined>);
      if (!ws) throw new Error(`workspace ${board.workspaceId} not found`);
      if (ws.boardIds.length <= 1) throw new HierarchyError("A workspace needs at least one board.");
      let objects = 0;
      for (const cid of board.canvasIds) {
        const canvas = await req(tx.objectStore("canvases").get(cid) as IDBRequest<CanvasRecord | undefined>);
        if (!canvas) continue;
        const rev = expected.get(cid);
        if (rev === undefined) throw new RevisionConflictError(cid, -1, canvas.revision);
        objects += await this.removeCanvas(tx, canvas, rev);
      }
      tx.objectStore("boards").delete(boardId);
      tx.objectStore("workspaces").put({ ...ws, boardIds: ws.boardIds.filter((id) => id !== boardId) });
      return { canvases: board.canvasIds.length, objects };
    });
  }

  private async removeCanvas(tx: IDBTransaction, canvas: CanvasRecord, expectedRevision: number): Promise<number> {
    if (canvas.revision !== expectedRevision) throw new RevisionConflictError(canvas.id, expectedRevision, canvas.revision);
    const cur = await req(tx.objectStore("meta").get("current") as IDBRequest<CurrentMeta | undefined>);
    if (cur?.canvasId === canvas.id) throw new HierarchyError("The open canvas cannot be deleted. Switch to another canvas first.");
    const range = IDBKeyRange.bound([canvas.id, ""], [canvas.id, "￿"]);
    const n = await req(tx.objectStore("objects").count(range));
    tx.objectStore("objects").delete(range);
    tx.objectStore("frames").delete(range);
    tx.objectStore("canvasViews").delete(canvas.id);
    tx.objectStore("bookmarks").delete(canvas.id);
    tx.objectStore("canvases").delete(canvas.id);
    return n;
  }

  private async deleteTx<T>(extra: string[], body: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = this.db.transaction([...extra, "canvases", "objects", "frames", "canvasViews", "bookmarks", "meta"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    try {
      const result = await body(tx);
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

  /** Load one canvas's objects (lazily, per canvas) and its saved camera. */
  async loadCanvas(canvasId: string): Promise<LoadedCanvas> {
    const tx = this.db.transaction(["canvases", "objects", "frames", "canvasViews", "bookmarks"], "readonly");
    const canvas = await req(tx.objectStore("canvases").get(canvasId) as IDBRequest<CanvasRecord | undefined>);
    if (!canvas) throw new Error(`canvas ${canvasId} not found`);
    const range = IDBKeyRange.bound([canvasId, ""], [canvasId, "￿"]);
    const records = await req(tx.objectStore("objects").getAll(range) as IDBRequest<ObjectRecord[]>);
    const frames = await req(tx.objectStore("frames").getAll(range) as IDBRequest<FrameStoreRecord[]>);
    const camera = (await req(tx.objectStore("canvasViews").get(canvasId) as IDBRequest<StoredView | undefined>)) ?? null;
    const saved = await req(tx.objectStore("bookmarks").get(canvasId) as IDBRequest<{ items?: unknown } | undefined>);
    const skipped: string[] = [];
    const space = new FrameSpace();
    try {
      space.restore(frames);
    } catch (e) {
      // Damaged frames: objects that need them are skipped below; the rest still open.
      skipped.push(`frames: ${(e as Error).message}`);
    }
    const objects: CanvasObject[] = [];
    for (const r of records) {
      try {
        objects.push(deserializeObject(r.data, space));
      } catch (e) {
        skipped.push(`${r.id}: ${(e as Error).message}`);
      }
    }
    return { canvas, objects, space, skipped, camera, bookmarks: readBookmarks(saved?.items) };
  }

  /**
   * Atomically apply object puts/deletes to a canvas, provided its stored
   * revision is still `expectedRevision`. Resolves with the new revision once
   * the transaction has committed (durability "strict").
   */
  async commit(canvasId: string, expectedRevision: number, puts: readonly CanvasObject[], deletes: readonly ObjectId[], frames: readonly FrameRecord[] = []): Promise<CommitResult> {
    const tx = this.db.transaction(["canvases", "objects", "frames"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    try {
      const canvas = await req(tx.objectStore("canvases").get(canvasId) as IDBRequest<CanvasRecord | undefined>);
      if (!canvas) throw new Error(`canvas ${canvasId} not found`);
      if (canvas.revision !== expectedRevision) throw new RevisionConflictError(canvasId, expectedRevision, canvas.revision);
      const objects = tx.objectStore("objects");
      for (const f of frames) tx.objectStore("frames").put({ ...f, canvasId } satisfies FrameStoreRecord);
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

  /**
   * Rename (`target` is a name) or remove (`target` is null) an in-canvas tag on the stored objects of every canvas except `skip`
   * (the open one is changed through its document, so it can be undone) (ADR 0070). `key` is the lower-cased tag. One transaction:
   * each touched canvas gets a new revision, so a tab that has it open sees the change as a commit from elsewhere.
   * Returns the canvases touched and how many objects changed.
   */
  async changeObjectTag(key: string, target: string | null, skip: string | null): Promise<{ canvases: string[]; objects: number }> {
    const tx = this.db.transaction(["objects", "canvases"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    try {
      const store = tx.objectStore("objects");
      const hits: ObjectRecord[] = [];
      await new Promise<void>((resolve, reject) => {
        const cur = store.index("tags").openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return resolve();
          const rec = c.value as ObjectRecord;
          if (String(c.key).toLowerCase() === key && rec.canvasId !== skip) hits.push(rec);
          c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
      const touched = new Set<string>();
      for (const rec of hits) {
        const tags = ((rec.data as { tags?: string[] }).tags ?? []).map((t) => (t.toLowerCase() === key && target ? target : t)).filter((t) => t.toLowerCase() !== key || target);
        const seen = new Set<string>();
        const next = tags.filter((t) => !seen.has(t.toLowerCase()) && !!seen.add(t.toLowerCase()));
        const { tags: _old, ...rest } = rec.data as SerializedObject & { tags?: string[] };
        store.put({ ...rec, data: (next.length ? { ...rest, tags: next } : rest) as SerializedObject } satisfies ObjectRecord);
        touched.add(rec.canvasId);
      }
      for (const id of touched) {
        const canvas = await req(tx.objectStore("canvases").get(id) as IDBRequest<CanvasRecord | undefined>);
        if (canvas) tx.objectStore("canvases").put({ ...canvas, revision: canvas.revision + 1, updatedAt: Date.now() } satisfies CanvasRecord);
      }
      await committed;
      return { canvases: [...touched], objects: hits.length };
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

  /** Texts that mention an object (stored index, ADR 0040). */
  async mentionedBy(targetId: ObjectId): Promise<ObjectRecord[]> {
    const tx = this.db.transaction("objects");
    const all = await new Promise<ObjectRecord[]>((res, rej) => {
      const r = tx.objectStore("objects").index("refs").getAll(targetId);
      r.onsuccess = () => res(r.result as ObjectRecord[]);
      r.onerror = () => rej(r.error);
    });
    return all;
  }

  /** Texts and images on the given canvases whose name contains `query` (case-insensitive), at most `limit`; read with cursors, never all at once. */
  async findMentionable(canvasIds: ReadonlySet<string>, query: string, limit: number): Promise<Array<{ canvasId: string; id: ObjectId; label: string; assetId?: string }>> {
    const q = query.trim().toLowerCase();
    const out: Array<{ canvasId: string; id: ObjectId; label: string; assetId?: string }> = [];
    for (const kind of ["text", "image"]) {
      const idx = this.db.transaction("objects").objectStore("objects").index("kind");
      await new Promise<void>((res, rej) => {
        const c = idx.openCursor(IDBKeyRange.only(kind));
        c.onerror = () => rej(c.error);
        c.onsuccess = () => {
          const cur = c.result;
          if (!cur || out.length >= limit) return res();
          const r = cur.value as ObjectRecord;
          if (canvasIds.has(r.canvasId)) {
            if (kind === "image") {
              // Images are named by their file, which only the catalog knows: the caller filters by name.
              out.push({ canvasId: r.canvasId, id: r.id, label: `Image ${String(r.data["pixelW"])}×${String(r.data["pixelH"])}`, assetId: String(r.data["assetId"]) });
            } else {
              const label = plainText(String(r.data["md"]), 28);
              if (label.toLowerCase().includes(q)) out.push({ canvasId: r.canvasId, id: r.id, label: label || "Text" });
            }
          }
          cur.continue();
        };
      });
    }
    return out;
  }

  /** The record of an object on one of the given canvases, if any. */
  async locate(canvasIds: readonly string[], id: ObjectId): Promise<ObjectRecord | undefined> {
    for (const canvasId of canvasIds) {
      const r = await idbGet<ObjectRecord>(this.db, "objects", [canvasId, id]);
      if (r) return r;
    }
    return undefined;
  }

  /** Read back a canvas revision (used to report "verified"). */
  async revision(canvasId: string): Promise<number | undefined> {
    return (await this.canvas(canvasId))?.revision;
  }

  /** Save a canvas's bookmarks with the frames they need that are not stored yet (same rules as the view). */
  async saveBookmarks(canvasId: string, items: readonly Bookmark[], frames: readonly FrameRecord[] = [], dropFrames: readonly string[] = []): Promise<void> {
    const tx = this.db.transaction(["bookmarks", "frames"], "readwrite");
    for (const f of frames) tx.objectStore("frames").put({ ...f, canvasId } satisfies FrameStoreRecord);
    for (const id of dropFrames) tx.objectStore("frames").delete([canvasId, id]);
    tx.objectStore("bookmarks").put({ canvasId, items });
    await done(tx);
  }

  /**
   * Save the view (with the frames it needs that are not stored yet) without touching the canvas revision.
   * `dropFrames`: frames nothing refers to any more, removed in the same transaction as the new view.
   */
  async saveCamera(canvasId: string, camera: StoredView, frames: readonly FrameRecord[] = [], dropFrames: readonly string[] = []): Promise<void> {
    const tx = this.db.transaction(["canvasViews", "frames"], "readwrite");
    for (const f of frames) tx.objectStore("frames").put({ ...f, canvasId } satisfies FrameStoreRecord);
    for (const id of dropFrames) tx.objectStore("frames").delete([canvasId, id]);
    tx.objectStore("canvasViews").put(camera, canvasId);
    await done(tx);
  }
}
