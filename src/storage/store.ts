/**
 * What the app asks of storage (ADR 0177): the workspace and its backups, behind interfaces, so the same app runs on the browser's
 * IndexedDB (`WorkspaceRepo`, `IdbBackups`) or, in the desktop build, on a workspace folder. Everything above these interfaces is
 * shared by both builds; only their implementations differ. Types only: nothing here touches a storage API.
 */
import type { FrameRecord } from "../core/frames";
import type { CanvasObject, ObjectId } from "../doc/model";
import type { Bookmark } from "./bookmarks";
import type { BoardRecord, CanvasRecord, CommitResult, CurrentMeta, LoadedCanvas, StoredView, ViewGround, WorkspaceRecord } from "./workspace-repo";
import type { StartupOutcome } from "./migrate-v1";
import type { ExportResult, ExportScope, ImportPlan, ImportResult, ProgressFn } from "./archive";
import type { FilesLayout, FilesPlan, FilesZipResult } from "./files-zip";
import type { MoveReport } from "./folder-move";
import type { AssetFolder, AssetLocation, CatalogEntry, CatalogListing, GcReport, MetaChange, MetaSnapshot, PasswordKind, ThumbRecord } from "../assets/asset-catalog";
import type { AssetRecord } from "../assets/asset-library";
import type { LibraryQuery } from "../assets/library-match";
import type { DeleteMode } from "./desktop-bridge";

export interface WorkspaceTreeRecords {
  workspace: WorkspaceRecord;
  boards: Array<{ board: BoardRecord; canvases: CanvasRecord[] }>;
}

/** An in-canvas tag across the workspace (ADR 0062): its first spelling, how many objects carry it, where, and which assets they show. */
export interface TagUse {
  label: string;
  objects: number;
  canvases: Set<string>;
  assets: Set<string>;
}

/** Boards, canvases and their objects, cameras, bookmarks and saved styles (ADR 0006). */
export interface WorkspaceStore {
  /** Open the workspace to work in: the current one, a converted older one, or a new one. */
  startup(): Promise<StartupOutcome>;
  current(): Promise<CurrentMeta | undefined>;
  setCurrent(cur: CurrentMeta): Promise<void>;
  styles(): Promise<unknown>;
  saveStyles(items: readonly unknown[]): Promise<void>;

  workspace(id: string): Promise<WorkspaceRecord | undefined>;
  board(id: string): Promise<BoardRecord | undefined>;
  canvas(id: string): Promise<CanvasRecord | undefined>;
  tree(workspaceId: string): Promise<WorkspaceTreeRecords>;

  createWorkspace(displayName: string): Promise<CurrentMeta>;
  createBoard(workspaceId: string, name: string): Promise<{ board: BoardRecord; canvas: CanvasRecord }>;
  createCanvas(boardId: string, name: string): Promise<CanvasRecord>;
  duplicateCanvas(canvasId: string, name: string): Promise<CanvasRecord>;
  duplicateBoard(boardId: string, name: string): Promise<{ board: BoardRecord; canvas: CanvasRecord }>;
  moveCanvas(canvasId: string, toBoardId: string, index: number): Promise<CanvasRecord>;
  moveBoard(boardId: string, index: number): Promise<void>;
  renameWorkspace(id: string, name: string): Promise<void>;
  setViewGround(id: string, ground: ViewGround): Promise<void>;
  renameBoard(id: string, name: string): Promise<void>;
  renameCanvas(id: string, name: string): Promise<void>;
  deleteCanvas(canvasId: string, expectedRevision: number): Promise<{ objects: number }>;
  deleteBoard(boardId: string, expected: ReadonlyMap<string, number>): Promise<{ canvases: number; objects: number }>;

  loadCanvas(canvasId: string): Promise<LoadedCanvas>;
  /** One revision-checked write of a canvas's changes; a stale `expectedRevision` is refused (RevisionConflictError). */
  commit(canvasId: string, expectedRevision: number, puts: readonly CanvasObject[], deletes: readonly ObjectId[], frames?: readonly FrameRecord[]): Promise<CommitResult>;
  revision(canvasId: string): Promise<number | undefined>;
  saveBookmarks(canvasId: string, items: readonly Bookmark[], frames?: readonly FrameRecord[], dropFrames?: readonly string[]): Promise<void>;
  saveCamera(canvasId: string, camera: StoredView, frames?: readonly FrameRecord[], dropFrames?: readonly string[]): Promise<void>;

  /** Every in-canvas tag of the workspace, keyed by its lower-case form. */
  tagIndex(): Promise<Map<string, TagUse>>;
  /** The in-canvas tags of every instance of one library asset, with the canvas each is on. */
  tagsOfAssetInstances(hash: string): Promise<Array<{ canvasId: string; tags: string[] }>>;
  changeObjectTag(key: string, target: string | null, skip: string | null): Promise<{ canvases: string[]; objects: number }>;
  removeAssetInstances(hashes: readonly string[], skip: string | null): Promise<{ canvases: string[]; objects: number }>;
  formatStoredTags(): Promise<void>;
}

/** The last backup of the whole workspace (full or incremental). */
export interface BackupRecord {
  /** Full when absent (records made before incremental backups). An incremental one goes on from the one made at its `since`. */
  kind?: "full" | "incremental";
  at: number;
  bytes: number;
  fileName: string;
  boards: number;
  canvases: number;
  objects: number;
  assets: number;
  /** The archive was read back and every checksum matched before it was handed to the browser. */
  verified: boolean;
}

/** `.canvast` archives and plain ZIPs of originals, out of and into the workspace (ADR 0008, 0176). */
export interface BackupStore {
  buildArchive(workspaceId: string, scope: ExportScope, appVersion: string, settings: Record<string, unknown> | undefined, progress?: ProgressFn): Promise<ExportResult>;
  buildFilesZip(workspaceId: string, scope: ExportScope, layout: FilesLayout, progress?: ProgressFn): Promise<FilesZipResult>;
  /** The files such a ZIP would hold, by path, each read when asked for (an export written file by file). */
  planFiles(workspaceId: string, scope: ExportScope, layout: FilesLayout, progress?: ProgressFn): Promise<FilesPlan>;
  hiddenInScope(scope: ExportScope): Promise<number>;
  applyImport(workspaceId: string, boardId: string, plan: ImportPlan, progress?: ProgressFn): Promise<ImportResult>;
  /** Erase originals written by an import that did not finish; how many. */
  sweepImportStaging(): Promise<number>;
  lastBackup(): Promise<BackupRecord | null>;
  recordBackup(rec: BackupRecord): Promise<void>;
}

/**
 * The desktop app's Library view lists from the library's own storage a page at a time (a library of a million items never comes to
 * the page whole): what a scope, search and sort list, in order, the sidebar's counts, the items drawn.
 */
export interface LibraryPages {
  query(q: LibraryQuery): Promise<{ hashes: string; ratios: Float32Array; total: number; bytes: number }>;
  /** The sidebar's counts; of the hidden items in hidden mode (`hidden`). */
  counts(hidden?: boolean): Promise<{ hidden: number; shown: number; favourites: number; unfiled: number; tags: Array<[string, string, number]>; types: Array<[string, number]>; folders: Array<[string, number]> }>;
  fieldKeys(): Promise<string[]>;
  /** Some items' entries, with whether each one's file is there. */
  listed(hashes: readonly string[]): Promise<Array<CatalogEntry & { present: boolean }>>;
  folders(): Promise<AssetFolder[]>;
  /** Where items are placed: instances and canvases of each item used. */
  usage(): Promise<Map<string, { instances: number; canvases: Set<string> }>>;
}

/** The library's entries: names, tags, folders, notes and fields, thumbnails, the password locks, usage and garbage collection (ADR 0007). */
export interface CatalogStore {
  /** The desktop app: the Library view lists a page at a time (absent: it lists from `list()`). */
  readonly pages?: LibraryPages;
  list(): Promise<CatalogListing>;
  /** The listing again only when something changed since `prev` (null when nothing did). */
  relist(prev: CatalogListing): Promise<CatalogListing | null>;
  entry(hash: string): Promise<CatalogEntry | undefined>;
  /** The hashes of the active items that are hidden (their pictures are drawn as a padlock on every canvas). */
  hiddenHashes(): Promise<Set<string>>;
  locations(hash: string): Promise<AssetLocation[]>;
  thumb(hash: string): Promise<ThumbRecord | undefined>;
  /** Once, in the background: stored records of folder files drop their empty `blob`. */
  healStubs(): Promise<void>;
  /** The items that have a stored thumbnail. */
  thumbHashes(): Promise<string[]>;
  putThumb(rec: ThumbRecord): Promise<void>;
  healThumbs(): Promise<void>;
  healTags(): Promise<void>;
  renameAssets(changes: ReadonlyArray<{ hash: string; name: string }>): Promise<number>;
  updateMeta(hash: string, change: MetaChange): Promise<CatalogEntry>;
  updateMetaEach(changes: ReadonlyArray<{ hash: string; change: MetaChange }>): Promise<CatalogEntry[]>;
  renameTag(from: string, to: string): Promise<number>;
  deleteTag(tag: string): Promise<number>;
  createFolder(name: string, parentId: string | null, id: string): Promise<AssetFolder>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<{ folders: number; unfiled: number }>;
  /** Hide a folder, its subfolders and every item in them; how many items were hidden. */
  hideFolder(id: string): Promise<number>;
  /** Unhide a folder: it, its subfolders and every item in them (also those hidden one by one), and the folders above it. How many items were shown. */
  showFolder(id: string): Promise<number>;
  snapshotMeta(): Promise<MetaSnapshot>;
  restoreMeta(s: MetaSnapshot): Promise<number>;
  lock(kind: PasswordKind): Promise<string | null>;
  setLock(kind: PasswordKind, lock: string | null): Promise<void>;
  /** Give every stored original a library entry; how many were added. */
  reconcile(): Promise<number>;
  markDeleted(hash: string): Promise<void>;
  markDeletedEach(hashes: readonly string[]): Promise<{ gone: string[]; inUse: number }>;
  /** Erase deleted originals that nothing (no instance, no undo root) can need. */
  collect(roots: ReadonlySet<string>): Promise<GcReport>;
}

/** The bytes of the originals, stored once by SHA-256. */
export interface OriginalStore {
  /** The original with its library name, or undefined when it is not stored (or its file is gone). */
  get(hash: string): Promise<AssetRecord | undefined>;
  /** Whether the original is a hidden item's encrypted file that cannot be read while the Hidden items are locked (desktop build). */
  locked(hash: string): Promise<boolean>;
  /** The state of its library entry, if it has one. */
  entryState(hash: string): Promise<CatalogEntry["state"] | undefined>;
  /** Where the original is a readable file of the workspace folder or library folder: its path there (never a hidden item's sealed file), else null. */
  fileOf(hash: string): Promise<string | null>;
  /** Write the original (when `writeBytes`) and make its library entry active, as one step. Throws ImportError when there is no room. */
  put(record: AssetRecord, writeBytes: boolean): Promise<void>;
  putThumb(rec: ThumbRecord): Promise<void>;
  /** Told when storage is nearly full. */
  onNotice: ((text: string) => void) | null;
}

/** Told while storage opens or changes under the app (an upgrade waiting for, or asked by, another tab or window). */
export interface OpenHooks {
  /** Called while an upgrade waits for other tabs to close their connections. */
  onBlocked?: () => void;
  /** Called when another tab needs this connection closed for an upgrade. */
  onVersionChange?: () => void;
  /** Something the person should know about storage (a failed write to the workspace folder), in plain words. */
  onNotice?: (text: string) => void;
  /** The desktop build: where a deleted file of the workspace folder goes (Settings > Storage); `.trash/` when not given. */
  deleteTo?: () => DeleteMode;
  /** The desktop build: keep hidden items' names, tags and notes out of this device's cache while they are locked (Settings > Privacy). */
  hiddenNamesOff?: () => boolean;
  /** The desktop build: days after which what is in the folder's `.trash/` is erased at start-up (0: never). */
  trashDays?: () => number;
}

/** Whether the hidden items' key exists and is in memory: "none" (no Hidden password in this workspace folder yet), "locked", "open". */
export type HiddenState = "none" | "locked" | "open";

/**
 * The desktop build's encrypted hidden items (ADR 0177): the key wrapped by the Hidden password. Absent in the browser build,
 * where the Hidden password is a gate only.
 */
export interface HiddenStore {
  state(): Promise<HiddenState>;
  /** Open with the password (false when it is not the password); the key stays in memory until `lock` or the app closes. */
  unlock(password: string): Promise<boolean>;
  /** Make the key for a first password, or wrap it with a new one, given the current one (the key in memory cannot be read out). */
  setPassword(password: string, current?: string): Promise<void>;
  /** Whether the key is in memory now. */
  isOpen(): boolean;
  /** Remove the key; refused (false) while any item is hidden, since hidden means encrypted. */
  remove(): Promise<boolean>;
  /** Forget the key: hidden items are locked until the password is given again. */
  lock(): void;
  /** Told when it opens or locks. */
  subscribe(fn: () => void): () => void;
}

/** A file found in the desktop build's `library/` that no library item has: imported where it lies (ADR 0177, "Changes from outside the app"). */
export interface FolderFile {
  /** Its path in the workspace folder. */
  path: string;
  name: string;
  /** The library folder of the folder it was found in (made when there was none), or null for a kind folder. */
  folderId: string | null;
  /** Found in `.hidden/`: it becomes a hidden item (and is sealed). */
  hidden?: boolean;
  /** Its size, and its SHA-256 read in the main process (desktop): one too big to read into the page is taken in from these alone. */
  size?: number;
  hash?: () => Promise<string | null>;
  /** What a sealed file said of its item (its tags, note…), given back to it. */
  meta?: { tags: string[]; favorite: boolean; note: string; fields: Array<{ key: string; value: string }> };
  read(): Promise<Blob | null>;
}

/** What the app does when the desktop build's workspace folder changes outside it (ADR 0177, "Changes from outside the app"). */
export interface FolderHandlers {
  /** Import files found in `library/` that no item has (the app can decode them). */
  importFiles(files: FolderFile[]): Promise<void>;
  /** Library items were relinked, added or changed: lists are drawn again. */
  libraryChanged(): void;
  /** Before canvas files are compared: edits still on their way are saved (so they count as this device's). */
  beforeCheck(): Promise<void>;
  /** Boards or canvases changed; `canvases` were read in from their files (the open one is loaded again). */
  canvasesChanged(canvases: string[]): Promise<void>;
  /** Readable files were put in `.hidden/` while the hidden items are locked: ask for their password (they are encrypted once it is given). */
  hiddenNeedsKey(names: string[]): void;
}

/** The desktop build: the workspace folder's changes from outside the app. */
export interface FolderSync {
  /** Start following the folder: it is looked through at once, then on each change. */
  start(handlers: FolderHandlers): void;
  /**
   * Read every library file of the folder and check its content against its item (SHA-256, in the main process); hidden ones are left
   * out (that needs their key). The names of those gone and those changed (damaged, or replaced by another file).
   * `quick`: only each file's presence and size are looked at (no reading), which a big library does in seconds.
   */
  checkFiles(onStep: (done: number, total: number) => void, quick?: boolean): Promise<{ checked: number; missing: string[]; damaged: string[] }>;
}

/** One opened storage: what a session works on. */
export interface Storage {
  readonly workspace: WorkspaceStore;
  readonly backups: BackupStore;
  readonly catalog: CatalogStore;
  readonly originals: OriginalStore;
  /** The library folder (ADR 0159): only the browser build has one (in the desktop build the workspace is a folder). */
  readonly libraryFolder: LibraryFolderStore | null;
  /** The desktop build's changes from outside the app; null in the browser build. */
  readonly folderSync: FolderSync | null;
  /** The desktop build's encrypted hidden items; null in the browser build. */
  readonly hidden: HiddenStore | null;
  /** The desktop build's workspace folder (its full path); null in the browser build. */
  readonly workspaceFolder: string | null;
  /** Start from scratch: delete everything canvast keeps here, then reload. `onBlocked`: another window still has it open. */
  resetAll(onBlocked?: () => void): Promise<void>;
  /** Write now what is still on its way (the desktop build's workspace folder follows edits by a moment); nothing in the browser. */
  flush(): Promise<void>;
  /** The desktop build: how far a long write of files into the workspace folder is (an import's files); null in the browser. */
  readonly folderWriting: FolderWriting | null;
}

/** How far the files being written into the workspace folder are: `done` of `total` after each file; `total` 0 when it ended. */
export interface FolderWriting {
  /** `encrypting`: the file just done was a hidden item's, encrypted into `.hidden/`. */
  subscribe(fn: (done: number, total: number, encrypting?: boolean) => void): () => void;
  /** The write going on now, if any. */
  now(): { done: number; total: number } | null;
}

/** The browser build's library folder: which originals are kept there, and moving them in and out. */
export interface LibraryFolderStore {
  /** Hashes of the originals kept in the folder. */
  keptHashes(): Promise<string[]>;
  /** How many originals are in the folder (and how many still named by a bare hash) and how many in the browser. */
  counts(): Promise<{ inFolder: number; inBrowser: number; bareNames: number }>;
  choose(): Promise<void>;
  forget(): Promise<void>;
  moveIn(progress: (done: number, total: number) => void): Promise<MoveReport>;
  moveOut(progress: (done: number, total: number) => void): Promise<MoveReport>;
  addExtensions(progress: (done: number, total: number) => void): Promise<MoveReport>;
}
