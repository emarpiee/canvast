/**
 * The workspace folder follows the app's storage (ADR 0177, "Saving and the cache"): every edit is committed to IndexedDB
 * as in the browser build, which is the journal and the cache; a moment after changes stop (`MIRROR_DELAY_MS`), and when
 * the window closes, what changed is written to the folder: each canvas as `<board>/<canvas>.cvst`, the boards and
 * canvases with their names and order in `.canvast/workspace.json`, the library in `.canvast/library.json` with each original
 * in its place under `library/` (library-mirror.ts), and this device's state in `.canvast/devices/<id>.json`.
 * Boards and canvases renamed, moved or deleted in the app are renamed, moved or put in `.trash/` on disk.
 */
import { canvasJson, putCanvasContent } from "./archive";
import { canvasFileHead, readCanvasFile } from "./canvas-file";
import type { DeleteMode, DesktopBridge } from "./desktop-bridge";
import { done, idbGet, idbPut, req } from "./idb";
import { LibraryMirror } from "./library-mirror";
import type { HiddenVault } from "./hidden-store";
import type { AssetRecord } from "../assets/asset-library";
import { duplicateRecords } from "../doc/duplicate";
import { serializeObject } from "../doc/model";
import type { BackupRecord, WorkspaceStore } from "./store";
import type { BoardRecord, CanvasRecord, CurrentMeta, StoredView, WorkspaceRecord } from "./workspace-repo";
import type { PlacedBoard } from "./workspace-names";
import { placeTree, safeBase } from "./workspace-names";

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
/** How long a sync tool's copy of a canvas saved by another device waits before this one takes it (that device takes it at once). */
export const SYNC_COPY_WAIT = { ms: 10 * 60_000 };

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
  private libraryDirty = false;
  private readonly lib: LibraryMirror;
  /** The boards and canvases as last written to `workspace.json` (where each one is on disk now). */
  private placed: PlacedBoard[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();
  /** Told when a canvas was not written because another device changed its file meanwhile (it is then compared, as an outside change). */
  onContested: (() => void) | null = null;
  /** Told when a write failed (once per streak), in plain words. */
  onError: ((text: string) => void) | null = null;
  /** Told how far a write of library files is (see LibraryMirror.onProgress). */
  set onProgress(fn: ((done: number, total: number) => void) | null) {
    this.lib.onProgress = fn;
  }
  private failing = false;
  private state: MirrorState = { tree: "", canvases: {} };

  constructor(
    private readonly db: IDBDatabase,
    private readonly repo: WorkspaceStore,
    private readonly bridge: DesktopBridge,
    readonly deviceId: string,
    private readonly vault: HiddenVault,
    private readonly deleteTo: () => DeleteMode = () => "trash",
  ) {
    this.lib = new LibraryMirror(db, bridge, vault, deleteTo);
    this.lib.onNotice = (text) => this.onError?.(text);
    // Opened: what another device hid is read from the sealed index, and what waited for the key (hiding, showing) is done.
    vault.subscribe(() => {
      if (!vault.dataKey) return;
      this.running = this.running
        .then(async () => {
          await this.lib.reread();
          await this.lib.scanHidden(); // (readable files in `.hidden/` waited for the key)
        })
        .catch(() => undefined);
      this.library();
    });
  }

  /**
   * At start-up, before anything is shown: the folder and the app's storage are brought together (ADR 0177, "Saving and
   * the cache"). Boards and canvases changed elsewhere (`workspace.json` is not what this device last wrote or read) are
   * taken from the folder; each canvas file another device wrote replaces the app's copy, unless the app has edits the file
   * does not have, when both are kept (the app's as a conflict copy). What the folder lacks is written to it.
   */
  async start(): Promise<void> {
    try {
      await this.startUp();
    } finally {
      this.started();
    }
  }
  /**
   * Before anything is shown (the lock screen first): the passwords the folder's `workspace.json` carries are taken where this device
   * has none, so a workspace opened with no copy of it on this device (a new device, a moved or renamed folder) asks for its password
   * too. A password is never removed here.
   */
  async adoptLocks(): Promise<void> {
    const bytes = await this.bridge.read(WORKSPACE_FILE);
    if (!bytes) return;
    let locks: WorkspaceFile["locks"] | undefined;
    try {
      locks = (JSON.parse(new TextDecoder().decode(bytes)) as Partial<WorkspaceFile>).locks;
    } catch {
      return;
    }
    for (const [key, value] of [["workspaceLock", locks?.workspace], ["hiddenLock", locks?.hidden]] as const) {
      if (typeof value === "string" && value && (await idbGet<string>(this.db, "meta", key).catch(() => undefined)) === undefined) await idbPut(this.db, "meta", key, value);
    }
  }

  /** Start-up is over (a look through `library/` waits for it: the folder's index explains most files). */
  private started: () => void = () => undefined;
  private readonly ready = new Promise<void>((resolve) => (this.started = resolve));

  private async startUp(): Promise<void> {
    this.state = (await idbGet<MirrorState>(this.db, "meta", STATE_KEY).catch(() => undefined)) ?? { tree: "", canvases: {} };
    await this.lib.start(); // (first: the canvases read below may show items another device added)
    this.libraryDirty = true;
    const fileWs = await this.readWorkspaceFile();
    if (!fileWs) return this.everything(); // a new workspace folder: all of it is written
    await this.mergeTreeCopies(fileWs); // (written back below, with the tree)
    const tree = JSON.stringify(fileWs.boards);
    if (tree !== this.state.tree) await this.adoptTree(fileWs);
    this.placed = fileWs.boards;
    this.state.tree = tree;
    await this.reconcile(fileWs.boards);
    await this.takeSyncCopies();
    await idbPut(this.db, "meta", STATE_KEY, this.state);
    this.treeDirty = true;
    this.deviceDirty = true;
    this.later();
  }

  /**
   * Each canvas against its file: a file another device wrote replaces the app's copy, unless the app has edits the file does
   * not have, when both are kept (the app's as a conflict copy); what the folder lacks is marked to be written. The canvases
   * whose content was read in.
   */
  private async reconcile(boards: readonly PlacedBoard[]): Promise<string[]> {
    const adopted: string[] = [];
    const cur = await this.repo.current();
    if (!cur) return adopted;
    const records = (await this.repo.tree(cur.workspaceId)).boards.flatMap((b) => b.canvases);
    const files = new Map(boards.flatMap((b) => b.canvases.map((c) => [c.id, c.file] as const)));
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
      // A file that does not read (damaged, or a sync tool still bringing it) is skipped: this device's copy stays, and it is read
      // again with the next change. Nothing is written over it (it may be another device's newer version, arriving).
      const readable = await this.readable(file);
      if (!readable) {
        this.tellUnreadable(c.name, file);
        continue;
      }
      if (localChanged && !(head.savedBy === this.deviceId && head.revision === c.revision)) {
        // Both changed: the app's version is kept as a copy beside the canvas, which takes the folder's version.
        await this.repo.duplicateCanvas(c.id, `${c.name} (conflict ${stamp()})`);
        this.treeDirty = true;
        this.onError?.(`“${c.name}” was changed in the workspace folder and here: the folder's version is kept, and this device's as “${c.name} (conflict …)”.`);
      }
      await this.adoptCanvas(c, file);
      this.toldUnreadable.delete(file); // (told again if it breaks again)
      adopted.push(c.id);
    }
    return adopted;
  }

  /** Whether a canvas file reads whole. */
  private async readable(file: string): Promise<boolean> {
    const bytes = await this.bridge.read(file);
    try {
      return !!bytes && !!readCanvasFile(new TextDecoder().decode(bytes), file);
    } catch {
      return false;
    }
  }
  private readonly toldUnreadable = new Set<string>();
  private tellUnreadable(name: string, file: string): void {
    if (this.toldUnreadable.has(file)) return;
    this.toldUnreadable.add(file);
    this.onError?.(`The file of “${name}” in the workspace folder (${file}) could not be read: it is damaged, or your sync tool is still bringing it. This device's copy of the canvas is shown and kept; the file is read again when it changes.`);
  }

  /**
   * While the app runs, the folder changed outside it (another device through a sync tool, or a file manager): boards and
   * canvases another device changed are taken, canvas files and board folders renamed or moved by hand are followed, and each
   * changed canvas file is read in as at start-up. Which canvases were read in (the open one is loaded again), and whether the
   * boards or canvases changed.
   */
  recheck(): Promise<{ canvases: string[]; tree: boolean }> {
    const job = Promise.all([this.running, this.ready]).then(async () => {
      const fileWs = await this.readWorkspaceFile();
      if (!fileWs) return { canvases: [], tree: false };
      let tree = false;
      if (await this.mergeTreeCopies(fileWs)) this.treeDirty = true; // (the kept file gets them)
      const text = JSON.stringify(fileWs.boards);
      if (text !== this.state.tree) {
        await this.adoptTree(fileWs);
        this.placed = fileWs.boards;
        this.state.tree = text;
        tree = true;
      }
      if (await this.followMoved()) tree = true;
      if (await this.takeSyncCopies()) tree = true;
      const canvases = await this.reconcile(this.placed);
      await idbPut(this.db, "meta", STATE_KEY, this.state);
      if (this.treeDirty || this.dirty.size) this.later();
      return { canvases, tree: tree || canvases.length > 0 };
    });
    this.running = job.then(
      () => undefined,
      (e: unknown) => this.onError?.(`The workspace folder could not be read: ${(e as Error).message}.`),
    );
    return job.catch(() => ({ canvases: [], tree: false }));
  }

  /**
   * Canvas files and board folders renamed or moved in a file manager (the file is found by the id in its header): a renamed
   * file renames the canvas, a renamed folder the board (the names as on disk), a file moved into another board's folder moves
   * the canvas there. Their files then take the safe names as any do. A copy, or a canvas this workspace does not have, is left alone.
   */
  private async followMoved(): Promise<boolean> {
    const where = new Map(this.placed.flatMap((b) => b.canvases.map((c) => [c.id, { board: b, canvas: c }] as const)));
    const placedPaths = new Set([...where.values()].map((v) => v.canvas.file.toLowerCase()));
    let changed = false;
    for (const path of await this.bridge.canvasFiles()) {
      if (placedPaths.has(path.toLowerCase())) continue;
      const head = canvasHead(await this.bridge.head(path));
      const was = head && where.get(head.id);
      if (!was || (await this.bridge.exists(was.canvas.file))) continue;
      const folder = path.slice(0, path.lastIndexOf("/"));
      const stem = path.slice(folder.length + 1, -".cvst".length);
      const board = was.board;
      const toBoard = this.placed.find((b) => b.folder.toLowerCase() === folder.toLowerCase());
      if (!toBoard) {
        // The board's folder was renamed (none of its other canvases is where it was): the board takes the folder's name.
        if (!(await Promise.all(board.canvases.filter((c) => c.id !== head.id).map((c) => this.bridge.exists(c.file)))).every((x) => !x)) continue;
        const old = board.folder;
        board.folder = folder;
        for (const c of board.canvases) c.file = `${folder}${c.file.slice(old.length)}`;
        const name = folder.slice(folder.lastIndexOf("/") + 1);
        await this.repo.renameBoard(board.id, name);
        board.name = name;
      } else if (toBoard.id !== board.id) {
        board.canvases.splice(board.canvases.indexOf(was.canvas), 1);
        toBoard.canvases.push(was.canvas);
        await this.repo.moveCanvas(head.id, toBoard.id, toBoard.canvases.length - 1);
      }
      was.canvas.file = path;
      if (safeBase(stem) !== safeBase(was.canvas.name)) {
        await this.repo.renameCanvas(head.id, stem);
        was.canvas.name = stem;
      }
      changed = true;
    }
    if (changed) this.treeDirty = true; // (their files take their safe names)
    return changed;
  }

  /**
   * Canvas files a sync tool made beside a canvas's own (`heroes (1).cvst`, `heroes.sync-conflict-….cvst`): two devices saved it at
   * once and the tool kept both. The other version becomes a canvas of its own on the same board, `<name> (conflict from sync <date>)`
   * (its objects with new ids, as a duplicate's), and the copy goes where deleted files go; a copy the same as the canvas's file only
   * goes. The device that saved the copy takes it (its edits are the ones the canvas lost); another one only once it has waited
   * `SYNC_COPY_WAIT.ms` (that device may never come back), so two devices do not both take it. One that does not read whole yet
   * (still arriving) waits. Whether any was taken.
   */
  private async takeSyncCopies(): Promise<boolean> {
    const now = Date.now();
    let waiting = false;
    const where = new Map(this.placed.flatMap((b) => b.canvases.map((c) => [c.id, { board: b, canvas: c }] as const)));
    const placedPaths = new Set([...where.values()].map((v) => v.canvas.file.toLowerCase()));
    let changed = false;
    for (const path of await this.bridge.canvasFiles()) {
      if (placedPaths.has(path.toLowerCase())) continue;
      const head = canvasHead(await this.bridge.head(path));
      const was = head && where.get(head.id);
      if (!was || !(await this.bridge.exists(was.canvas.file))) continue; // (another workspace's canvas, or a moved file: followed instead)
      const own = canvasHead(await this.bridge.head(was.canvas.file));
      if (!own || own.revision !== head.revision || own.savedBy !== head.savedBy) {
        const since = this.copySeen.get(path) ?? now;
        this.copySeen.set(path, since);
        if (head.savedBy !== this.deviceId && now - since < SYNC_COPY_WAIT.ms) {
          waiting = true;
          continue;
        }
        const bytes = await this.bridge.read(path);
        try {
          readCanvasFile(new TextDecoder().decode(bytes ?? new Uint8Array()), was.canvas.name);
        } catch {
          continue; // not whole yet
        }
        const name = `${was.canvas.name} (conflict from sync ${stamp()})`;
        await this.adoptCanvas(await this.repo.createCanvas(was.board.id, name), path, true);
        this.onError?.(`Your sync tool kept two versions of “${was.canvas.name}” (two devices saved it at once): the other one is kept as “${name}”.`);
      }
      await this.bridge.remove(path, this.deleteTo());
      this.copySeen.delete(path);
      changed = true;
    }
    if (changed) this.treeDirty = true;
    if (waiting && !this.copyTimer)
      this.copyTimer = setTimeout(() => {
        this.copyTimer = 0;
        this.onContested?.(); // (the folder is compared again)
      }, SYNC_COPY_WAIT.ms + 1000) as unknown as number;
    return changed;
  }
  private readonly copySeen = new Map<string, number>();
  private copyTimer = 0;

  /**
   * Copies a sync tool made of `workspace.json` (`workspace (1).json`: two devices changed the boards at once and the tool kept both):
   * canvases in them this device has never known, whose files are there, are added to `fileWs` (made on the other device, and lost
   * from the file the tool kept), on their board (added too when the kept file has none), and written into it. What this device knew
   * and the kept file no longer has was deleted, and is not brought back. The copy then goes where deleted files go. Whether anything
   * was added.
   */
  private async mergeTreeCopies(fileWs: WorkspaceFile): Promise<boolean> {
    const copies = (await this.bridge.list(".canvast")).filter((n) => /^workspace[^/]+\.json$/i.test(n) && n !== "workspace.json" && !n.includes(".tmp-"));
    let added = false;
    for (const name of copies) {
      const copy = await this.readWorkspaceFile(`.canvast/${name}`);
      if (!copy) continue; // (not whole yet, or nothing in it: looked at again with the next change)
      const placed = new Set(fileWs.boards.flatMap((b) => b.canvases.map((c) => c.id)));
      for (const cb of copy.boards) {
        for (const cc of cb.canvases) {
          if (placed.has(cc.id) || this.state.canvases[cc.id]) continue;
          const head = canvasHead(await this.bridge.head(cc.file));
          if (!head || head.id !== cc.id) continue;
          let board = fileWs.boards.find((b) => b.id === cb.id);
          if (!board) fileWs.boards.push((board = { ...cb, canvases: [] }));
          board.canvases.push(cc);
          placed.add(cc.id);
          added = true;
        }
      }
      // The kept file gets them first: a look at the folder before the next save must not find them gone from it (taken as deleted).
      if (added) await this.bridge.write(WORKSPACE_FILE, encode(JSON.stringify(fileWs, null, 1)));
      await this.bridge.remove(`.canvast/${name}`, this.deleteTo());
    }
    return added;
  }

  private async readWorkspaceFile(path = WORKSPACE_FILE): Promise<WorkspaceFile | null> {
    const bytes = await this.bridge.read(path);
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

  /**
   * Read a canvas file into the app's storage, in place of what it held (its id kept), at the next revision. `asNew`: into a canvas
   * just made, as a copy of the file's (its objects get new ids, so no link leads to the canvas it was a version of), to be written.
   */
  private async adoptCanvas(c: CanvasRecord, file: string, asNew = false): Promise<void> {
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
    putCanvasContent(tx, c.id, asNew ? { ...read.canvas, objects: [] } : read.canvas);
    if (asNew) for (const data of duplicateRecords(read.canvas.objects.map(serializeObject))) tx.objectStore("objects").put({ canvasId: c.id, id: data.id, data });
    const now = (await req(tx.objectStore("canvases").get(c.id) as IDBRequest<CanvasRecord | undefined>)) ?? c;
    const revision = now.revision + 1;
    tx.objectStore("canvases").put({ ...now, revision, objectCount: read.canvas.objects.length, updatedAt: Date.now() } satisfies CanvasRecord);
    await committed;
    if (asNew) {
      delete this.state.canvases[c.id];
      this.dirty.add(c.id); // (into a file of its own)
      return;
    }
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
  /** Look through `library/` for files changed outside the app (on the write queue); the library is written after, when it changed. */
  rescan(onChange: () => void, hiddenTouched = false): Promise<void> {
    this.running = Promise.all([this.running, this.ready])
      .then(async () => {
        const scanned = await this.lib.scan();
        if ((await this.lib.scanHidden(hiddenTouched)) || scanned) {
          onChange();
          this.library();
        }
      })
      .catch((e: unknown) => this.onError?.(`The workspace folder could not be looked through: ${(e as Error).message}.`));
    return this.running;
  }
  /** `library.json` or the hidden index changed (another device, through a sync tool): read again (on the write queue). */
  rereadLibrary(onChange: () => void): Promise<void> {
    this.running = Promise.all([this.running, this.ready])
      .then(async () => {
        const took = await this.lib.reread();
        if (took) onChange();
        if (took || this.vault.copiesWaiting) this.library(); // (copies of the hidden index read into it are erased once it is written)
      })
      .catch((e: unknown) => this.onError?.(`The library of the workspace folder could not be read: ${(e as Error).message}.`));
    return this.running;
  }
  /** An import's originals, written straight into `library/` (see LibraryMirror.writeOriginals). */
  writeOriginals(batch: readonly AssetRecord[]): Promise<Map<string, string>> {
    return this.lib.writeOriginals(batch);
  }
  /** Who asks for the hidden items' password when readable files wait in `.hidden/`. */
  set askHiddenKey(fn: LibraryMirror["askKey"]) {
    this.lib.askKey = fn;
  }
  /** Who looks through `.hidden/` again later (a sealed file with no entry waits before it is taken back). */
  set scanHiddenLater(fn: LibraryMirror["scanLater"]) {
    this.lib.scanLater = fn;
  }
  /** Who imports files found in `library/`. */
  set importFiles(fn: LibraryMirror["importFiles"]) {
    this.lib.importFiles = fn;
  }

  /** The library changed: its items, their names, tags or folders, the library folders, or the originals stored. */
  library(): void {
    this.libraryDirty = true;
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
    this.libraryDirty = true;
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
    let contested = false;
    for (const id of ids) {
      const file = files.get(id);
      const record = tree.boards.flatMap((b) => b.canvases).find((c) => c.id === id);
      if (!file || !record) continue; // deleted since
      const known = this.state.canvases[id];
      if (all && known && known.local === record.revision && known.file.savedBy === this.deviceId && known.file.revision === record.revision) continue; // the file has it
      // Never over another device's version: a file changed since this device last wrote or read it is compared first (a conflict copy).
      const head = known ? canvasHead(await this.bridge.head(file)) : null;
      if (head && head.id === id && (head.revision !== known!.file.revision || head.savedBy !== known!.file.savedBy)) {
        contested = true;
        continue;
      }
      try {
        await this.writeCanvas(id, record.revision, file);
        this.state.canvases[id] = { file: { revision: record.revision, savedBy: this.deviceId }, local: record.revision };
      } catch (e) {
        this.dirty.add(id); // tried again with the next write
        throw e;
      }
    }
    if (this.libraryDirty) {
      this.libraryDirty = false;
      try {
        if (!(await this.lib.write())) this.libraryDirty = true; // (not timed again: tried with the next change)
      } catch (e) {
        this.libraryDirty = true;
        throw e;
      }
    }
    if (this.deviceDirty) {
      this.deviceDirty = false;
      await this.writeDevice(cur);
    }
    await idbPut(this.db, "meta", STATE_KEY, this.state);
    this.failing = false;
    if (contested) this.onContested?.();
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
    for (const [id, f] of oldFile) if (!newFile.has(id)) await this.bridge.remove(nowAt(id, f), this.deleteTo());
    for (const [id, f] of oldFolder) if (!newFolder.has(id)) await this.bridge.remove(f, this.deleteTo());
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
