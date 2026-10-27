/**
 * The workspace folder follows the app's storage (ADR 0177, "Saving and the cache"): every edit is committed to IndexedDB
 * as in the browser build, which is the journal and the cache; a moment after changes stop (`MIRROR_DELAY_MS`), and when
 * the window closes, what changed is written to the folder: each canvas as `<board>/<canvas>.cvst`, the boards and
 * canvases with their names and order in `.canvast/workspace.json`, and this device's state in `.canvast/devices/<id>.json`.
 * Boards and canvases renamed, moved or deleted in the app are renamed, moved or put in `.trash/` on disk.
 */
import { canvasJson, putCanvasContent } from "./archive";
import { canvasFileHead, readCanvasFile } from "./canvas-file";
import type { DesktopBridge } from "./desktop-bridge";
import { done, idbGet, idbPut, req } from "./idb";
import type { BackupRecord, WorkspaceStore } from "./store";
import type { BoardRecord, CanvasRecord, CurrentMeta, StoredView, WorkspaceRecord } from "./workspace-repo";
import type { PlacedBoard } from "./workspace-names";
import { placeTree } from "./workspace-names";

export const MIRROR_DELAY_MS = 2000;
export const WORKSPACE_FILE = ".canvast/workspace.json";
export const WORKSPACE_FILE_FORMAT = "canvast-workspace";
export const deviceFile = (id: string): string => `.canvast/devices/${id}.json`;

export interface WorkspaceFile {
  format: typeof WORKSPACE_FILE_FORMAT;
  version: 1;
  id: string;
  name: string;
  viewGround?: string;
  boards: PlacedBoard[];
  styles: unknown[];
  locks: { hidden?: string; workspace?: string };
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const ID_RE = /^[0-9a-f]{32}$/;

/**
 * What this device last knew of the folder (kept in IndexedDB, meta "workspaceMirror"): the boards of `workspace.json` as
 * last written or read, and per canvas the file's header then (`file`) and the app's revision of it then (`local`).
 * A file whose header differs was written elsewhere; an app revision that differs has edits the file does not have yet.
 */
interface MirrorState {
  tree: string;
  canvases: Record<string, { file: { revision: number; savedBy: string }; local: number }>;
}
const STATE_KEY = "workspaceMirror";

/** The header fields of a canvas file, from its first kilobyte (they come before the objects). */
export function canvasHead(text: string | null): { id: string; revision: number; savedBy: string } | null {
  if (!text) return null;
  const id = /"id":"([0-9a-f]{32})"/.exec(text)?.[1];
  const revision = /"revision":(\d+)/.exec(text)?.[1];
  const savedBy = /"savedBy":"([^"]*)"/.exec(text)?.[1];
  return id && revision !== undefined && savedBy !== undefined ? { id, revision: Number(revision), savedBy } : null;
}

const stamp = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;

export class WorkspaceMirror {
  private readonly dirty = new Set<string>();
  private treeDirty = false;
  private deviceDirty = false;
  /** The boards and canvases as last written to `workspace.json` (where each one is on disk now). */
  private placed: PlacedBoard[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();
  /** Told when a write failed (once per streak), in plain words. */
  onError: ((text: string) => void) | null = null;
  private failing = false;
  private state: MirrorState = { tree: "", canvases: {} };

  constructor(
    private readonly db: IDBDatabase,
    private readonly repo: WorkspaceStore,
    private readonly bridge: DesktopBridge,
    readonly deviceId: string,
  ) {}

  /**
   * At start-up, before anything is shown: the folder and the app's storage are brought together (ADR 0177, "Saving and
   * the cache"). Boards and canvases changed elsewhere (`workspace.json` is not what this device last wrote or read) are
   * taken from the folder; each canvas file another device wrote replaces the app's copy, unless the app has edits the file
   * does not have, when both are kept (the app's as a conflict copy). What the folder lacks is written to it.
   */
  async start(): Promise<void> {
    this.state = (await idbGet<MirrorState>(this.db, "meta", STATE_KEY).catch(() => undefined)) ?? { tree: "", canvases: {} };
    const fileWs = await this.readWorkspaceFile();
    if (!fileWs) return this.everything(); // a new workspace folder: all of it is written
    const tree = JSON.stringify(fileWs.boards);
    if (tree !== this.state.tree) await this.adoptTree(fileWs);
    this.placed = fileWs.boards;
    this.state.tree = tree;
    const cur = await this.repo.current();
    if (!cur) return;
    const records = (await this.repo.tree(cur.workspaceId)).boards.flatMap((b) => b.canvases);
    const files = new Map(fileWs.boards.flatMap((b) => b.canvases.map((c) => [c.id, c.file] as const)));
    for (const c of records) {
      const file = files.get(c.id);
      const head = file ? canvasHead(await this.bridge.head(file)) : null;
      const known = this.state.canvases[c.id];
      if (!file || !head || head.id !== c.id) {
        this.dirty.add(c.id); // not in the folder (or not this canvas there): written
        continue;
      }
      const fileChanged = !known || head.revision !== known.file.revision || head.savedBy !== known.file.savedBy;
      const localChanged = known ? c.revision !== known.local : c.objectCount > 0;
      if (!fileChanged) {
        if (localChanged) this.dirty.add(c.id);
        continue;
      }
      if (localChanged && !(head.savedBy === this.deviceId && head.revision === c.revision)) {
        // Both changed: the app's version is kept as a copy beside the canvas, which takes the folder's version.
        await this.repo.duplicateCanvas(c.id, `${c.name} (conflict ${stamp()})`);
        this.treeDirty = true;
        this.onError?.(`“${c.name}” was changed in the workspace folder and here: the folder's version is kept, and this device's as “${c.name} (conflict …)”.`);
      }
      await this.adoptCanvas(c, file);
    }
    await idbPut(this.db, "meta", STATE_KEY, this.state);
    this.treeDirty = true;
    this.deviceDirty = true;
    this.later();
  }

  private async readWorkspaceFile(): Promise<WorkspaceFile | null> {
    const bytes = await this.bridge.read(WORKSPACE_FILE);
    if (!bytes) return null;
    try {
      const ws = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WorkspaceFile>;
      if (ws.format !== WORKSPACE_FILE_FORMAT || !Array.isArray(ws.boards)) return null;
      // Only well-formed boards and canvases are taken; a damaged entry is left out (and the app's copy stays).
      const boards = ws.boards.filter((b) => b && ID_RE.test(b.id) && typeof b.name === "string" && typeof b.folder === "string" && Array.isArray(b.canvases));
      for (const b of boards) b.canvases = b.canvases.filter((c) => c && ID_RE.test(c.id) && typeof c.name === "string" && typeof c.file === "string");
      if (!boards.some((b) => b.canvases.length)) return null; // nothing to open: written again from the app
      return { ...(ws as WorkspaceFile), boards };
    } catch {
      return null; // damaged: written again from the app's storage
    }
  }

  /**
   * Take the folder's boards and canvases (names, order, which board): new ones are added (empty until their file is read),
   * ones the folder no longer has are deleted, unless the app has edits of them the folder never had (they stay). One transaction.
   */
  private async adoptTree(fileWs: WorkspaceFile): Promise<void> {
    const tx = this.db.transaction(["workspaces", "boards", "canvases", "objects", "frames", "canvasViews", "bookmarks", "meta"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const cur = await req(tx.objectStore("meta").get("current") as IDBRequest<CurrentMeta | undefined>);
    const ws = cur ? await req(tx.objectStore("workspaces").get(cur.workspaceId) as IDBRequest<WorkspaceRecord | undefined>) : undefined;
    if (!cur || !ws) {
      tx.abort();
      await committed.catch(() => undefined);
      return;
    }
    const now = Date.now();
    const inFile = new Set(fileWs.boards.flatMap((b) => b.canvases.map((c) => c.id)));
    const keep: CanvasRecord[] = [];
    for (const bid of ws.boardIds) {
      const board = await req(tx.objectStore("boards").get(bid) as IDBRequest<BoardRecord | undefined>);
      for (const cid of board?.canvasIds ?? []) {
        if (inFile.has(cid)) continue;
        const c = await req(tx.objectStore("canvases").get(cid) as IDBRequest<CanvasRecord | undefined>);
        if (!c) continue;
        const known = this.state.canvases[cid];
        const unsynced = known ? c.revision !== known.local : c.objectCount > 0;
        if (unsynced) {
          keep.push(c);
          continue;
        }
        const range = IDBKeyRange.bound([cid, ""], [cid, "\uffff"]);
        for (const store of ["objects", "frames"]) tx.objectStore(store).delete(range);
        for (const store of ["canvasViews", "bookmarks", "canvases"]) tx.objectStore(store).delete(cid);
        delete this.state.canvases[cid];
      }
      if (board && !fileWs.boards.some((b) => b.id === bid)) tx.objectStore("boards").delete(bid);
    }
    for (const fb of fileWs.boards) {
      const board = (await req(tx.objectStore("boards").get(fb.id) as IDBRequest<BoardRecord | undefined>)) ?? { id: fb.id, workspaceId: ws.id, name: fb.name, canvasIds: [], createdAt: now };
      const kept = keep.filter((c) => c.boardId === fb.id).map((c) => c.id);
      tx.objectStore("boards").put({ ...board, name: fb.name, canvasIds: [...fb.canvases.map((c) => c.id), ...kept] } satisfies BoardRecord);
      for (const fc of fb.canvases) {
        const c = await req(tx.objectStore("canvases").get(fc.id) as IDBRequest<CanvasRecord | undefined>);
        tx.objectStore("canvases").put(c ? { ...c, boardId: fb.id, name: fc.name } : { id: fc.id, boardId: fb.id, name: fc.name, revision: 0, objectCount: 0, updatedAt: now });
      }
    }
    // Canvases kept on a board the folder no longer has go to the first board.
    const first = fileWs.boards.find((b) => b.canvases.length)!;
    const orphans = keep.filter((c) => !fileWs.boards.some((b) => b.id === c.boardId));
    if (orphans.length) {
      const b = (await req(tx.objectStore("boards").get(first.id) as IDBRequest<BoardRecord>));
      tx.objectStore("boards").put({ ...b, canvasIds: [...b.canvasIds, ...orphans.map((c) => c.id)] });
      for (const c of orphans) tx.objectStore("canvases").put({ ...c, boardId: first.id });
    }
    tx.objectStore("workspaces").put({ ...ws, displayName: typeof fileWs.name === "string" && fileWs.name ? fileWs.name : ws.displayName, ...(fileWs.viewGround ? { viewGround: fileWs.viewGround as WorkspaceRecord["viewGround"] } : {}), boardIds: fileWs.boards.map((b) => b.id) });
    if (Array.isArray(fileWs.styles)) tx.objectStore("meta").put(fileWs.styles, "styles");
    if (typeof fileWs.locks?.hidden === "string") tx.objectStore("meta").put(fileWs.locks.hidden, "hiddenLock");
    if (typeof fileWs.locks?.workspace === "string") tx.objectStore("meta").put(fileWs.locks.workspace, "workspaceLock");
    const open = fileWs.boards.some((b) => b.canvases.some((c) => c.id === cur.canvasId)) || keep.some((c) => c.id === cur.canvasId);
    if (!open) tx.objectStore("meta").put({ workspaceId: ws.id, boardId: first.id, canvasId: first.canvases[0]!.id } satisfies CurrentMeta, "current");
    await committed;
    if (keep.length) this.treeDirty = true; // they are written back to the folder
  }

  /** Read a canvas file into the app's storage, in place of what it held (its id kept), at the next revision. */
  private async adoptCanvas(c: CanvasRecord, file: string): Promise<void> {
    const bytes = await this.bridge.read(file);
    if (!bytes) return;
    const read = readCanvasFile(new TextDecoder().decode(bytes), c.name);
    if (read.problems.length) this.onError?.(read.problems.join(" "));
    const tx = this.db.transaction(["canvases", "objects", "frames", "bookmarks"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const range = IDBKeyRange.bound([c.id, ""], [c.id, "\uffff"]);
    tx.objectStore("objects").delete(range);
    tx.objectStore("frames").delete(range);
    tx.objectStore("bookmarks").delete(c.id);
    putCanvasContent(tx, c.id, read.canvas);
    const now = (await req(tx.objectStore("canvases").get(c.id) as IDBRequest<CanvasRecord | undefined>)) ?? c;
    const revision = now.revision + 1;
    tx.objectStore("canvases").put({ ...now, revision, objectCount: read.canvas.objects.length, updatedAt: Date.now() } satisfies CanvasRecord);
    await committed;
    this.state.canvases[c.id] = { file: { revision: read.head.revision, savedBy: read.head.savedBy }, local: revision };
  }

  /** A canvas's content changed. */
  canvas(id: string): void {
    this.dirty.add(id);
    this.later();
  }
  /** Boards or canvases were added, renamed, moved or deleted, or the workspace's name, styles or locks changed. */
  tree(): void {
    this.treeDirty = true;
    this.later();
  }
  /** This device's state changed (open canvas, a camera, the last backup). */
  device(): void {
    this.deviceDirty = true;
    this.later();
  }
  /** Write everything again (start-up, after an import). */
  everything(): void {
    this.treeDirty = true;
    this.deviceDirty = true;
    this.dirty.add("*");
    this.later();
  }

  private later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), MIRROR_DELAY_MS);
  }

  /** Write what changed now; resolves when the folder has it. One write at a time. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = this.running.then(() => this.write()).catch((e: unknown) => {
      if (!this.failing) this.onError?.(`The workspace folder could not be written: ${(e as Error).message}. Your work is kept in the app and is written again with the next change.`);
      this.failing = true;
    });
    return this.running;
  }

  private async write(): Promise<void> {
    const cur = await this.repo.current();
    if (!cur) return;
    const tree = await this.repo.tree(cur.workspaceId);
    const all = this.dirty.has("*");
    if (this.treeDirty || all) {
      this.treeDirty = false;
      await this.writeTree(cur.workspaceId, tree);
    }
    const ids = all ? tree.boards.flatMap((b) => b.canvases.map((c) => c.id)) : [...this.dirty];
    this.dirty.clear();
    const files = new Map(this.placed.flatMap((b) => b.canvases.map((c) => [c.id, c.file] as const)));
    for (const id of ids) {
      const file = files.get(id);
      const record = tree.boards.flatMap((b) => b.canvases).find((c) => c.id === id);
      if (!file || !record) continue; // deleted since
      const known = this.state.canvases[id];
      if (all && known && known.local === record.revision && known.file.savedBy === this.deviceId && known.file.revision === record.revision) continue; // the file has it
      try {
        await this.writeCanvas(id, record.revision, file);
        this.state.canvases[id] = { file: { revision: record.revision, savedBy: this.deviceId }, local: record.revision };
      } catch (e) {
        this.dirty.add(id); // tried again with the next write
        throw e;
      }
    }
    if (this.deviceDirty) {
      this.deviceDirty = false;
      await this.writeDevice(cur);
    }
    await idbPut(this.db, "meta", STATE_KEY, this.state);
    this.failing = false;
  }

  private async writeCanvas(id: string, revision: number, file: string): Promise<void> {
    const tx = this.db.transaction(["objects", "frames", "bookmarks"], "readonly");
    const { json } = await canvasJson(tx, id, { ...canvasFileHead(id, revision, this.deviceId) }, false);
    await this.bridge.write(file, new Uint8Array(await new Blob(json).arrayBuffer()));
  }

  /** Move what was renamed or moved, put what was deleted in the trash, then write `workspace.json`. */
  private async writeTree(workspaceId: string, tree: Awaited<ReturnType<WorkspaceStore["tree"]>>): Promise<void> {
    const next = placeTree(tree.boards.map((b) => ({ id: b.board.id, name: b.board.name, canvases: b.canvases })));
    const before = this.placed;
    const oldFolder = new Map(before.map((b) => [b.id, b.folder]));
    const newFolder = new Map(next.map((b) => [b.id, b.folder]));
    const oldFile = new Map(before.flatMap((b) => b.canvases.map((c) => [c.id, c.file] as const)));
    const newFile = new Map(next.flatMap((b) => b.canvases.map((c) => [c.id, c.file] as const)));
    // Moves go through a parking place first, so swapped names (a → b while b → a) never meet.
    const park = (id: string): string => `.canvast/moving/${id}`;
    const boardMoves = [...newFolder].filter(([id, f]) => oldFolder.has(id) && oldFolder.get(id) !== f);
    for (const [id] of boardMoves) await this.moveIfThere(oldFolder.get(id)!, park(id));
    for (const [id, f] of boardMoves) await this.moveIfThere(park(id), f);
    // A canvas's old file, as it is after its board folder moved.
    const nowAt = (id: string, old: string): string => {
      const board = before.find((b) => b.canvases.some((c) => c.id === id));
      const moved = board && newFolder.has(board.id) ? newFolder.get(board.id)! : board?.folder;
      return board && moved ? `${moved}/${old.slice(board.folder.length + 1)}` : old;
    };
    const fileMoves = [...newFile].filter(([id, f]) => oldFile.has(id) && nowAt(id, oldFile.get(id)!) !== f);
    for (const [id] of fileMoves) await this.moveIfThere(nowAt(id, oldFile.get(id)!), park(id));
    for (const [id, f] of fileMoves) await this.moveIfThere(park(id), f);
    for (const [id, f] of oldFile) if (!newFile.has(id)) await this.bridge.remove(nowAt(id, f));
    for (const [id, f] of oldFolder) if (!newFolder.has(id)) await this.bridge.remove(f);
    for (const [id] of newFile) if (!oldFile.has(id)) this.dirty.add(id); // a new canvas: its file is written below
    const styles = await this.repo.styles().catch(() => undefined);
    const hidden = await idbGet<string>(this.db, "meta", "hiddenLock").catch(() => undefined);
    const lock = await idbGet<string>(this.db, "meta", "workspaceLock").catch(() => undefined);
    const ws: WorkspaceFile = {
      format: WORKSPACE_FILE_FORMAT,
      version: 1,
      id: workspaceId,
      name: tree.workspace.displayName,
      ...(tree.workspace.viewGround ? { viewGround: tree.workspace.viewGround } : {}),
      boards: next,
      styles: Array.isArray(styles) ? styles : [],
      locks: { ...(typeof hidden === "string" ? { hidden } : {}), ...(typeof lock === "string" ? { workspace: lock } : {}) },
    };
    await this.bridge.write(WORKSPACE_FILE, encode(JSON.stringify(ws, null, 1)));
    this.placed = next;
    this.state.tree = JSON.stringify(next);
  }

  private async moveIfThere(from: string, to: string): Promise<void> {
    if (from === to) return;
    try {
      await this.bridge.rename(from, to);
    } catch (e) {
      if (/ENOENT|no such file/i.test((e as Error).message)) return; // not on disk yet: it is written where it belongs
      throw e;
    }
  }

  private async writeDevice(cur: { workspaceId: string; boardId: string; canvasId: string }): Promise<void> {
    const tx = this.db.transaction(["canvasViews", "meta"], "readonly");
    const keys = (await req(tx.objectStore("canvasViews").getAllKeys())) as string[];
    const views = (await req(tx.objectStore("canvasViews").getAll())) as StoredView[];
    const backup = (await req(tx.objectStore("meta").get("backup") as IDBRequest<BackupRecord | undefined>)) ?? null;
    const device = { format: "canvast-device", version: 1, id: this.deviceId, current: { boardId: cur.boardId, canvasId: cur.canvasId }, views: Object.fromEntries(keys.map((k, i) => [k, views[i]])), backup };
    await this.bridge.write(deviceFile(this.deviceId), encode(JSON.stringify(device, null, 1)));
  }
}

/**
 * The same object, with `after[name]` called once each method in it has finished (with its result and arguments). A hook
 * that returns a promise is waited for, and what it resolves to (when not undefined) is the method's result instead.
 * The workspace folder hooks its marks onto the shared storage this way, so no storage logic is written twice.
 */
export function watched<T extends object>(target: T, after: { [K in keyof T]?: T[K] extends (...a: infer A) => Promise<infer R> ? (result: R, ...args: A) => void | Promise<R | void> : never }): T {
  return new Proxy(target, {
    get(t, key, receiver) {
      const value = Reflect.get(t, key, receiver) as unknown;
      const hook = (after as Record<PropertyKey, ((r: unknown, ...a: unknown[]) => void) | undefined>)[key];
      if (typeof value !== "function") return value;
      const bound = (value as (...a: unknown[]) => unknown).bind(t);
      if (!hook) return bound;
      return async (...args: unknown[]) => {
        const result = await bound(...args);
        const replaced = await hook(result, ...args);
        return replaced === undefined ? result : replaced;
      };
    },
  });
}
