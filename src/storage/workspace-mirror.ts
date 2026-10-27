/**
 * The workspace folder follows the app's storage (ADR 0177, "Saving and the cache"): every edit is committed to IndexedDB
 * as in the browser build, which is the journal and the cache; a moment after changes stop (`MIRROR_DELAY_MS`), and when
 * the window closes, what changed is written to the folder: each canvas as `<board>/<canvas>.cvst`, the boards and
 * canvases with their names and order in `.canvast/workspace.json`, and this device's state in `.canvast/devices/<id>.json`.
 * Boards and canvases renamed, moved or deleted in the app are renamed, moved or put in `.trash/` on disk.
 */
import { canvasJson } from "./archive";
import { canvasFileHead } from "./canvas-file";
import type { DesktopBridge } from "./desktop-bridge";
import { idbGet, req } from "./idb";
import type { BackupRecord, WorkspaceStore } from "./store";
import type { StoredView } from "./workspace-repo";
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

  constructor(
    private readonly db: IDBDatabase,
    private readonly repo: WorkspaceStore,
    private readonly bridge: DesktopBridge,
    readonly deviceId: string,
  ) {}

  /** Read where things are on disk from `workspace.json`; a folder that has none yet gets everything written. */
  async start(): Promise<void> {
    const bytes = await this.bridge.read(WORKSPACE_FILE);
    if (bytes) {
      try {
        const ws = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WorkspaceFile>;
        if (ws.format === WORKSPACE_FILE_FORMAT && Array.isArray(ws.boards)) this.placed = ws.boards;
      } catch {
        // damaged: it is written again from the app's storage below
      }
    }
    this.everything();
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
      try {
        await this.writeCanvas(id, record.revision, file);
      } catch (e) {
        this.dirty.add(id); // tried again with the next write
        throw e;
      }
    }
    if (this.deviceDirty) {
      this.deviceDirty = false;
      await this.writeDevice(cur);
    }
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
 * The same object, with `after[name]` called once each method in it has finished (with its result and arguments).
 * The workspace folder hooks its marks onto the shared storage this way, so no storage logic is written twice.
 */
export function watched<T extends object>(target: T, after: { [K in keyof T]?: T[K] extends (...a: infer A) => Promise<infer R> ? (result: R, ...args: A) => void : never }): T {
  return new Proxy(target, {
    get(t, key, receiver) {
      const value = Reflect.get(t, key, receiver) as unknown;
      const hook = (after as Record<PropertyKey, ((r: unknown, ...a: unknown[]) => void) | undefined>)[key];
      if (typeof value !== "function") return value;
      const bound = (value as (...a: unknown[]) => unknown).bind(t);
      if (!hook) return bound;
      return async (...args: unknown[]) => {
        const result = await bound(...args);
        hook(result, ...args);
        return result;
      };
    },
  });
}
