import { contentOf } from "../assets/library-match";
import { readOnlyLine } from "../storage/guest-page";
import { WS_AT } from "../settings/settings";
import type { CardLook } from "../ui/file-views";
import { sha256Hex } from "../assets/sha256";
import { stampNote } from "../notes/note-dates";
import { NO_META, fileInlineTags, fileMeta, sameMeta, withFileMeta } from "../notes/frontmatter";
import type { NoteMeta } from "../notes/frontmatter";
import { makeThumb } from "../assets/thumb";
import { isDataText, WIKI, libraryLink, linkTarget, noteKindOf, noteLinks, relativeLink, relinkNote, wikiTarget, wikiKeyOf } from "../notes/note-file";
import type { PathTarget } from "../notes/note-file";
import { nameBase } from "../storage/workspace-names";
import type { NoteKind } from "../notes/note-file";
import { MAX_FIELD_KEY, MAX_FIELD_VALUE, MAX_NOTE, MAX_TAG_TEXT, folderPath } from "../assets/asset-catalog";
import type { AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import type { MetaChange } from "../assets/asset-catalog";
import { HOME, deserializeCamera, fitRect, zoomLevel } from "../core/camera";
import { startStep } from "./startup-log";
import { plural } from "../doc/plural";
import { deserializeFrameCamera, fromLocal, levelsBetween } from "../core/frames";
import type { AssetLibrary } from "../assets/asset-library";
import { withGifFrames } from "../assets/asset-library";
import { beginProgress } from "./progress";
import type { MetaSnapshot, PasswordKind } from "../assets/asset-catalog";
import { AssetInUseError, CatalogInputError, normalizeTags } from "../assets/asset-catalog";
import { StyleLibrary } from "../assets/styles";
import { assetOf, deserializeObject, newObjectId, serializeObject } from "../doc/model";
import type { SerializedObject } from "../doc/model";
import { retargeted } from "../storage/workspace-repo";
import type { GcReport } from "../assets/asset-catalog";
import type { ObjectId, TextObject } from "../doc/model";
import { expressObjectIn } from "../doc/model";
import { unionBounds } from "../doc/edit-ops";
import { changeTagOnCanvas, placeImage, placeImages } from "./actions";
import type { ExportResult, ExportScope, ImportPlan, ImportResult } from "../storage/archive";
import { checkLock, makeLock } from "../assets/hidden-lock";
import { archiveFileName, readArchive, readArchiveChain } from "../storage/archive";
import type { FolderFiles, ProgressFn } from "../storage/archive";
import type { FilesLayout, FilesPlan, FilesZipResult } from "../storage/files-zip";
import type { DocumentStore } from "../doc/document-store";
import type { ViewState } from "./view-state";
import type { EditorState } from "./editor-state";
import { CanvasPersistence } from "../storage/canvas-persistence";
import type { BoardRecord, CanvasRecord, CurrentMeta, ViewGround, WorkspaceRecord } from "../storage/workspace-repo";
import { HierarchyError, RevisionConflictError } from "../storage/workspace-repo";
import type { BackupRecord, BackupStore, CatalogStore, Storage, TagUse, WorkspaceStore } from "../storage/store";
import type { StartupOutcome } from "../storage/migrate-v1";
import { WriterLease } from "../storage/writer-lease";

/** Messages between tabs of the same profile (BroadcastChannel "canvast-commits"). */
type TabMessage =
  | { kind: "commit"; canvasId: string; revision: number }
  | { kind: "tree" }
  | { kind: "styles" }
  | { kind: "settings" }
  | { kind: "assets" };

/** Where an asset is used: one row per canvas, named for display. */
export interface AssetPlace {
  boardId: string;
  boardName: string;
  canvasId: string;
  canvasName: string;
  ids: ObjectId[];
}

export type { BackupRecord } from "../storage/store";

declare const __CANVAST_VERSION__: string;

/** Fraction of the viewport that revealed instances fill. */
const REVEAL_FILL = 0.6;
/** Steps of the library's own undo kept. */
const LIBRARY_UNDO = 50;

export interface WorkspaceTree {
  workspace: WorkspaceRecord;
  boards: Array<{ board: BoardRecord; canvases: CanvasRecord[] }>;
}

/**
 * The open workspace: which canvas is active, loading/switching canvases,
 * creating and renaming boards/canvases, and the writer lease. One canvas's
 * objects are in memory at a time (lazy per-canvas loading); each canvas keeps
 * its own camera.
 */
/** A row of a link card: an item, with the folder it is in. */
export interface LinkRow {
  hash: string;
  name: string;
  folder: string;
}
export interface LinkCards {
  from: LinkRow[];
  to: LinkRow[];
  missing: string[];
}

export class Session {
  current: CurrentMeta | null = null;
  tree: WorkspaceTree | null = null;
  startup: StartupOutcome | null = null;
  readonly persistence: CanvasPersistence;
  readonly lease: WriterLease;
  readonly catalog: CatalogStore | null;
  /** The saved styles (ADR 0120): adjustments, colours, and what comes next. */
  readonly styles: StyleLibrary;
  /** The last garbage-collection result (diagnostics and tests). */
  lastGc: GcReport | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly assetListeners = new Set<(metaOnly: boolean, usageOnly: boolean) => void>();
  private switching: Promise<void> | null = null;
  private channel: BroadcastChannel | null = null;
  /** Deleted assets are still retained by roots: collect again when the roots may have shrunk. */
  private gcPending = true;

  /** Boards, canvases and objects (null when storage could not open). */
  readonly repo: WorkspaceStore | null;
  private readonly backups: BackupStore | null;

  constructor(
    readonly storage: Storage | null,
    readonly doc: DocumentStore,
    readonly view: ViewState,
    readonly editor: EditorState,
    readonly assets: AssetLibrary | null = null,
  ) {
    this.repo = storage?.workspace ?? null;
    this.backups = storage?.backups ?? null;
    this.persistence = new CanvasPersistence(this.repo, doc, view);
    this.catalog = storage?.catalog ?? null;
    this.styles = new StyleLibrary(async (items) => {
      if (!this.repo || this.readOnly) throw new Error("read-only");
      await this.repo.saveStyles(items);
      this.post({ kind: "styles" });
    }, newObjectId);
    this.lease = new WriterLease();
    this.lease.subscribe(() => void this.onLease());
    this.persistence.onCommitted = (canvasId, revision) => {
      // The canvas lists read the tree: its count follows each save (it was read when the tree was, so it went stale after deletes).
      const rec = this.tree?.boards.flatMap((b) => b.canvases).find((c) => c.id === canvasId);
      if (rec && canvasId === this.current?.canvasId) Object.assign(rec, { revision, objectCount: this.doc.size });
      this.post({ kind: "commit", canvasId, revision });
      this.emitAssets(false, true); // usage counts changed
      // An undo may have re-created an instance of an asset deleted from the library.
      if (this.gcPending) void this.collectGarbage();
    };
    // Read-only tabs follow the writer: reload the canvas when it commits.
    if (typeof BroadcastChannel === "function") {
      try {
        this.channel = new BroadcastChannel("canvast-commits");
        this.channel.onmessage = (e: MessageEvent<TabMessage>) => void this.onTabMessage(e.data);
      } catch {
        // BroadcastChannel unavailable (some file:// configurations): read-only tabs refresh on promotion only.
      }
    }
  }

  private post(m: TabMessage): void {
    this.channel?.postMessage(m);
  }

  private async onTabMessage(m: TabMessage): Promise<void> {
    if (m.kind === "commit") {
      if (this.readOnly && this.current && m.canvasId === this.current.canvasId && m.revision !== this.persistence.revision) {
        await this.load(this.current.canvasId);
      }
      this.emitAssets();
    } else if (m.kind === "styles") {
      this.styles.load(await this.repo?.styles().catch(() => undefined));
    } else if (m.kind === "settings") {
      await this.adoptWorkspaceSettings();
    } else if (m.kind === "tree") {
      await this.refreshTree();
      await this.leaveDeletedCanvas();
      this.emitAssets();
    } else {
      this.emitAssets();
    }
  }

  /** If the open canvas no longer exists (deleted in another tab), open the first one that does. */
  private async leaveDeletedCanvas(): Promise<void> {
    if (!this.tree || !this.current) return;
    const cur = this.current;
    if (this.tree.boards.some((b) => b.canvases.some((c) => c.id === cur.canvasId))) return;
    const first = this.tree.boards.find((b) => b.canvases.length);
    if (!first) return;
    this.current = { workspaceId: cur.workspaceId, boardId: first.board.id, canvasId: first.canvases[0]!.id };
    await this.load(this.current.canvasId);
    this.emit();
  }

  /**
   * Listen for changes to the asset library or its usage (`metaOnly`: only its organization changed, nothing was added, removed or placed;
   * `usageOnly`: only where items are placed changed, a canvas edit).
   */
  subscribeAssets(fn: (metaOnly: boolean, usageOnly: boolean) => void): () => void {
    this.assetListeners.add(fn);
    return () => this.assetListeners.delete(fn);
  }

  /**
   * Boards or canvases changed in the desktop build's workspace folder outside the app: the tree again, and the open canvas
   * loaded again (its camera kept) when its file was read in.
   */
  async outsideChanged(canvases: readonly string[]): Promise<void> {
    // (styles and settings another device changed come with it)
    this.styles.load(await this.repo?.styles().catch(() => undefined));
    await this.adoptWorkspaceSettings();
    await this.refreshTree();
    await this.leaveDeletedCanvas();
    if (this.current && canvases.includes(this.current.canvasId)) {
      await this.persistence.saveCamera();
      await this.load(this.current.canvasId);
      this.tell("This canvas was changed in the workspace folder and has been loaded again.");
    }
    this.post({ kind: "tree" });
    this.emitAssets();
    this.emit();
  }

  /** The library changed outside the app (files found in the desktop build's workspace folder): every list is drawn again. */
  libraryChanged(): void {
    this.post({ kind: "assets" });
    this.emitAssets();
  }

  private emitAssets(metaOnly = false, usageOnly = false): void {
    for (const fn of this.assetListeners) fn(metaOnly, usageOnly);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get readOnly(): boolean {
    return this.lease.state === "readonly";
  }

  /** Open storage state: migrate or create the workspace, take the lease, load the current canvas. */
  async start(): Promise<void> {
    if (!this.repo) {
      this.persistence.setWritable(true);
      return;
    }
    await this.lease.acquire();
    startStep("writer lease");
    this.persistence.setWritable(!this.readOnly);
    void this.catalog?.healThumbs().catch(() => undefined);
    void this.catalog?.healStubs().catch(() => undefined);
    // Tags stored in an older form are formatted first (ADR 0084), before any canvas is read.
    await this.catalog?.healTags().catch(() => undefined);
    await this.repo.formatStoredTags().catch(() => undefined);
    startStep("tags checked");
    this.editor.readOnly = this.readOnly;
    this.startup = await this.repo.startup();
    startStep("workspace read (and its folder)");
    this.current = this.startup.current;
    this.styles.load(await this.repo.styles().catch(() => undefined));
    await this.adoptWorkspaceSettings();
    await this.refreshTree();
    await this.load(this.current.canvasId);
    startStep("canvas loaded");
    if (!this.readOnly && this.catalog) {
      try {
        // Originals of an import that did not finish are erased before reconcile, which would give them library entries (ADR 0176).
        await this.backups!.sweepImportStaging();
        await this.catalog.reconcile();
        startStep("library checked");
        await this.collectGarbage();
        startStep("unused files collected");
      } catch (e) {
        console.warn("canvast: asset catalog maintenance failed", e);
      }
    }
  }

  async refreshTree(): Promise<void> {
    if (!this.repo || !this.current) return;
    this.tree = await this.repo.tree(this.current.workspaceId);
    this.emit();
  }

  private async load(canvasId: string): Promise<void> {
    const loaded = await this.repo!.loadCanvas(canvasId);
    this.editor.select([]);
    this.doc.load(loaded.objects, loaded.space);
    let placed = false;
    if (loaded.camera) {
      try {
        if ("v" in loaded.camera) this.view.setFrameCamera(deserializeFrameCamera(loaded.space, loaded.camera));
        else this.view.setWorldCamera(deserializeCamera(loaded.camera));
        placed = true;
      } catch {
        // invalid saved view: start at home
      }
    }
    if (!placed) this.view.setWorldCamera(HOME);
    this.persistence.attach(canvasId, loaded.canvas.revision, loaded.space, loaded.bookmarks);
    if (loaded.skipped.length) {
      this.editor.message = `Skipped ${plural(loaded.skipped.length, "damaged item")} on "${loaded.canvas.name}".`;
      console.warn("canvast: skipped while loading", loaded.skipped);
      this.editor.changed();
    }
  }

  /** Switch to another canvas: flush pending saves and the camera first. */
  async openCanvas(canvasId: string): Promise<void> {
    if (!this.repo || !this.current || canvasId === this.current.canvasId) return;
    while (this.switching) await this.switching;
    this.switching = (async () => {
      await this.persistence.flush();
      await this.persistence.saveCamera();
      const canvas = await this.repo!.canvas(canvasId);
      if (!canvas) throw new Error(`canvas ${canvasId} not found`);
      this.current = { workspaceId: this.current!.workspaceId, boardId: canvas.boardId, canvasId };
      await this.load(canvasId);
      if (!this.readOnly) await this.repo!.setCurrent(this.current);
      this.emit();
    })();
    try {
      await this.switching;
    } finally {
      this.switching = null;
    }
    // Loading cleared the undo history, which may have been the last root of a deleted asset.
    if (this.gcPending) await this.collectGarbage();
  }

  /** Hashes the open document can still bring back without storage: its objects and undo/redo states. */
  /** The desktop app's "Delete library files at once": undo history no longer keeps a deleted original (set by the app). */
  deleteAtOnce: () => boolean = () => false;

  gcRoots(): Set<string> {
    const roots = new Set<string>();
    for (const o of this.deleteAtOnce() ? this.doc.all() : this.doc.retainedObjects()) {
      const a = assetOf(o);
      if (a) roots.add(a);
    }
    return roots;
  }

  /**
   * Erase originals the user deleted from the library once nothing can use
   * them any more (ADR 0007). Only the writer collects; read-only tabs cannot
   * edit, so they hold no roots of their own.
   */
  async collectGarbage(): Promise<GcReport | null> {
    if (!this.catalog || this.readOnly) return null;
    await this.persistence.flush();
    const report = await this.catalog.collect(this.gcRoots());
    this.lastGc = report;
    this.gcPending = report.retained.length > 0;
    for (const h of report.swept) this.assets?.forget(h);
    if (report.swept.length || report.restored.length) {
      this.post({ kind: "assets" });
      this.emitAssets();
    }
    return report;
  }

  /**
   * Delete an asset from the library. Refused while instances use it. The
   * original is erased at once if nothing else needs it, or later when the
   * undo history that could re-create an instance is gone.
   */
  async deleteAsset(hash: string): Promise<{ erased: boolean } | null> {
    if (!this.guardWrite() || !this.catalog) return null;
    await this.persistence.flush();
    try {
      await this.catalog.markDeleted(hash);
    } catch (e) {
      this.tell(e instanceof AssetInUseError ? `Not deleted: ${e.message}.` : `Could not delete the item: ${(e as Error).message}`);
      return null;
    }
    this.gcPending = true;
    const report = await this.collectGarbage();
    const erased = !!report?.swept.includes(hash);
    this.tell(erased ? "Deleted from the library. The file was erased." : "Deleted from the library. The file is kept until undo history no longer needs it.");
    this.post({ kind: "assets" });
    this.emitAssets();
    return { erased };
  }

  /**
   * Organize the library (ADR 0011): change an asset's tags, favourite flag or
   * folders, or create, rename and delete folders. Writer only; other tabs
   * refresh. Returns false (with a message) when refused.
   */
  /** The library's tags, description or properties of these items changed ("*": any). */
  onMetaChanged: ((items: ReadonlySet<string>) => unknown) | null = null;

  async organize(op: (c: CatalogStore) => Promise<unknown>, label = "Library change"): Promise<boolean> {
    if (!this.guardWrite() || !this.catalog) return false;
    let before: MetaSnapshot;
    const touched = new Set<string>();
    const moved = new Map<string, { name: string; path: string[] }>();
    try {
      before = await this.catalog.snapshotMeta();
      await op(this.touching(touched, moved));
    } catch (e) {
      this.tell(e instanceof CatalogInputError ? e.message[0]!.toUpperCase() + e.message.slice(1) + "." : `Could not save: ${(e as Error).message}`);
      return false;
    }
    this.libUndo.push({ label, snap: before });
    if (this.libUndo.length > LIBRARY_UNDO) this.libUndo.shift();
    this.libRedo = [];
    this.post({ kind: "assets" });
    this.emitAssets(true);
    this.onMetaChanged?.(touched);
    void this.writeNoteProps(touched).then(() => (moved.size ? this.relink(moved) : undefined));
    return true;
  }

  /** The catalog as an organizing step sees it, noting the items it changes ("*": any, a tag renamed or deleted everywhere). */
  private touching(seen: Set<string>, moved: Map<string, { name: string; path: string[] }>): CatalogStore {
    const c = this.catalog!;
    // (an item renamed or put in another folder: its name and place before, so the links to it in notes can follow it)
    const before = async (hashes: readonly string[]): Promise<void> => {
      const folders = (await c.list()).folders;
      for (const h of hashes) {
        const e = moved.has(h) ? null : await c.entry(h);
        if (e) moved.set(h, { name: e.name, path: await this.itemPath(e, folders) });
      }
    };
    const moves = (ch: MetaChange): boolean => !!(ch.addFolders?.length || ch.removeFolders?.length || ch.clearFolder);
    return new Proxy(c, {
      get(target, key, recv) {
        const v = Reflect.get(target, key, recv) as unknown;
        if (typeof v !== "function") return v;
        if (key === "updateMeta") return async (h: string, ch: MetaChange) => (seen.add(h), moves(ch) && (await before([h])), c.updateMeta(h, ch));
        if (key === "updateMetaEach")
          return async (chs: ReadonlyArray<{ hash: string; change: MetaChange }>) => {
            chs.forEach((x) => seen.add(x.hash));
            await before(chs.filter((x) => moves(x.change)).map((x) => x.hash));
            return c.updateMetaEach(chs);
          };
        if (key === "renameAssets") return async (chs: ReadonlyArray<{ hash: string; name: string }>) => (await before(chs.map((x) => x.hash)), c.renameAssets(chs));
        if (key === "renameTag" || key === "deleteTag" || key === "restoreMeta") seen.add("*");
        return (v as (...a: unknown[]) => unknown).bind(target);
      },
    });
  }

  /**
   * (Settings > Notes: Write tags and properties into note files.) Notes whose item's tags, note or fields changed in the library get them written into their file (a markdown note's YAML, a rich
   * text note's `<meta>`), as a new version saved like an edit: the file and the library say the same. `*`: every note checks.
   */
  /** Whether the library's tags, note and fields are written into note files (Settings > Notes). */
  writeNoteFiles: () => boolean = () => true;

  private async writeNoteProps(hashes: ReadonlySet<string>): Promise<void> {
    if (!this.catalog || !hashes.size || !this.writeNoteFiles()) return;
    const all = hashes.has("*") ? ((await this.catalog.list().catch(() => null))?.entries ?? []).filter((e) => noteKindOf(e.name)).map((e) => e.hash) : [...hashes];
    for (const hash of all) {
      try {
        const e = await this.catalog.entry(hash);
        const kind = e ? noteKindOf(e.name) : null;
        if (!e || !kind || kind === "txt") continue;
        const rec = await this.assets?.record(hash);
        if (!rec) continue;
        const text = await rec.blob.text();
        const item: NoteMeta = { tags: e.tags ?? [], note: e.note ?? "", fields: e.fields ?? [] };
        if (sameMeta(fileMeta(kind, text) ?? NO_META, item)) continue;
        const written = withFileMeta(kind, text, item);
        if (written !== text) {
          this.ownWrites++;
          await this.saveVersion(hash, new File([stampNote(kind, written, e.importedAt, Date.now())], e.name, { type: rec.type })).finally(() => void this.ownWrites--);
        }
      } catch (err) {
        console.warn(`canvast: the properties of a note could not be written into its file: ${(err as Error).message}`);
      }
    }
  }

  /**
   * A note file's properties become its item's tags, note and fields (the file wins). Run when a note comes in (an import, a new
   * version saved here or elsewhere). A note without properties leaves its item as it is (its tags go into the file at their next change).
   */
  async adoptNoteProps(hash: string): Promise<void> {
    const e = await this.catalog?.entry(hash).catch(() => undefined);
    const kind = e ? noteKindOf(e.name) : null;
    if (!e || !kind || kind === "txt" || !this.catalog) return;
    const text = await (await this.assets?.record(hash).catch(() => undefined))?.blob.text();
    const found = text === undefined ? null : fileMeta(kind, text);
    // No YAML: only its #tags are added (the tags it has in the library stay; they go into the file at their next change).
    const inline = text === undefined ? [] : fileInlineTags(kind, text);
    const missing = inline.filter((t) => !(e.tags ?? []).some((x) => x.toLowerCase() === t.toLowerCase()));
    // (not writing them into files: what the library has that the file does not say stays, or a save would take it away)
    const kept = found && !this.writeNoteFiles() ? { tags: [...new Set([...(e.tags ?? []), ...found.tags])], note: found.note || (e.note ?? ""), fields: [...(e.fields ?? []).filter((f) => !found.fields.some((x) => x.key === f.key)), ...found.fields] } : found;
    const meta = kept ?? (missing.length ? { tags: [...(e.tags ?? []), ...missing], note: e.note ?? "", fields: e.fields ?? [] } : null);
    // (a note's YAML has real lists: an item stored before lists were kept whole takes them)
    const listsNew = kind === "md" && JSON.stringify(meta?.fields) !== JSON.stringify(e.fields ?? []);
    if (!meta || (!listsNew && sameMeta(meta, { tags: e.tags ?? [], note: e.note ?? "", fields: e.fields ?? [] }))) return;
    const clip = (s: string, n: number): string => s.slice(0, n);
    const want = meta.tags.map((t) => clip(t, MAX_TAG_TEXT));
    try {
      await this.catalog.updateMeta(hash, {
        removeTags: (e.tags ?? []).filter((t) => !want.some((w) => w.toLowerCase() === t.toLowerCase())),
        addTags: want,
        note: clip(meta.note, MAX_NOTE),
        fields: meta.fields.filter((f) => f.key.trim()).map((f) => ({ key: clip(f.key, MAX_FIELD_KEY), value: clip(f.value, MAX_FIELD_VALUE), ...(f.items && f.value.length <= MAX_FIELD_VALUE ? { items: f.items } : {}) })),
      });
    } catch (err) {
      this.tell(`The properties of “${e.name}” could not be read into the library: ${(err as Error).message}`);
      return;
    }
    this.post({ kind: "assets" });
    this.emitAssets(true);
  }

  /** Where an item is in the library, as folders and a file name: its file's path in the workspace folder when it has one, else its library folder and name. */
  async itemPath(e: Pick<CatalogEntry, "hash" | "name" | "folderIds">, folders: readonly AssetFolder[]): Promise<string[]> {
    const file = await this.storage?.originals.fileOf(e.hash).catch(() => null);
    if (file) return file.replace(/^library\//, "").split("/");
    const folder = e.folderIds?.[0];
    return [...(folder ? folderPath(folders, folder) : []), e.name || e.hash];
  }

  /** What each note (by its hash: a version's words never change) links to, as written. */
  private readonly noteLinkCache = new Map<string, { wiki: string[]; paths: string[] }>();
  private async linksOf(e: CatalogEntry, kind: NoteKind): Promise<{ wiki: string[]; paths: string[] }> {
    let l = this.noteLinkCache.get(e.hash);
    if (!l) {
      const text = await (await this.assets?.record(e.hash).catch(() => undefined))?.blob.text();
      l = text === undefined ? { wiki: [], paths: [] } : noteLinks(kind, text);
      this.noteLinkCache.set(e.hash, l);
    }
    return l;
  }
  /** The name a `[[link]]` names an item by: a markdown note without `.md`, any other file by its whole name (lower case). */
  private static wikiKey = wikiKeyOf;

  /** The notes that link to an item (`[[its name]]`, a path to it, `canvast:<its hash>`). Hidden notes only when `hidden`. */
  async backlinks(hash: string, hidden = false): Promise<CatalogEntry[]> {
    const listing = await this.catalog?.list().catch(() => null);
    const target = listing?.entries.find((x) => x.hash === hash);
    if (!listing || !target) return [];
    const where = (await this.itemPath(target, listing.folders)).join("/");
    const key = Session.wikiKey(target.name);
    const out: CatalogEntry[] = [];
    for (const e of listing.entries) {
      const kind = noteKindOf(e.name);
      if (!kind || kind === "txt" || e.hash === hash || !e.present || (!hidden && e.hidden)) continue;
      const links = await this.linksOf(e, kind);
      if (!links.wiki.length && !links.paths.length) continue;
      const dir = (await this.itemPath(e, listing.folders)).slice(0, -1);
      const hit =
        links.wiki.some((w) => wikiTarget(w).name === key || w.toLowerCase() === target.name.toLowerCase()) ||
        links.paths.some((p) => {
          const t = linkTarget(p, dir);
          return !!t && ("hash" in t ? t.hash === hash : t.path.join("/") === where || t.root?.join("/") === where);
        });
      if (hit) out.push(e);
    }
    return out;
  }

  /** The two link cards of an item: the notes that link to it, and what it links to (notes, pictures, any file), with links that find nothing. */
  async linkCards(hash: string, hidden = false): Promise<LinkCards> {
    const listing = await this.catalog?.list();
    const self = listing?.entries.find((x) => x.hash === hash);
    if (!listing || !self) return { from: [], to: [], missing: [] };
    const row = async (x: CatalogEntry): Promise<LinkRow> => ({ hash: x.hash, name: x.name, folder: (await this.itemPath(x, listing.folders)).slice(0, -1).join("/") });
    const to = new Map<string, CatalogEntry>();
    const missing = new Set<string>();
    const kind = noteKindOf(self.name);
    if (kind && kind !== "txt") {
      const links = await this.linksOf(self, kind);
      const dir = (await this.itemPath(self, listing.folders)).slice(0, -1);
      // (a hidden item, out of hidden mode, is neither listed nor called missing: the card says nothing of it)
      const found = (x: CatalogEntry | undefined): void => void (x && x.hash !== hash && (hidden || !x.hidden) && to.set(x.hash, x));
      for (const w of links.wiki) {
        if (/^canvas:/i.test(w)) continue;
        const t = wikiTarget(w);
        const named = listing.entries.filter((x) => x.name.toLowerCase() === t.name || wikiKeyOf(x.name) === t.name);
        if (!named.length) missing.add(w);
        else if (named.length < 2 || !t.dirs.length) found(named[0]);
        else {
          let at = named[0];
          for (const x of named) {
            const dirs = (await this.itemPath(x, listing.folders)).slice(0, -1).map((d) => d.toLowerCase());
            if (t.dirs.every((d, i) => dirs[dirs.length - t.dirs.length + i] === d)) {
              at = x;
              break;
            }
          }
          found(at);
        }
      }
      for (const p of links.paths) {
        const t = linkTarget(p, dir);
        if (!t) continue;
        if ("hash" in t) {
          const x = listing.entries.find((y) => y.hash === t.hash);
          if (x) found(x);
          else missing.add(p);
          continue;
        }
        const name = t.path[t.path.length - 1]!.toLowerCase();
        let at: CatalogEntry | undefined;
        for (const x of listing.entries) {
          if (x.name.toLowerCase() !== name) continue;
          const where = (await this.itemPath(x, listing.folders)).join("/");
          if (where === t.path.join("/") || where === t.root?.join("/")) {
            at = x;
            break;
          }
        }
        if (at) found(at);
        else missing.add(t.path[t.path.length - 1]!);
      }
    }
    return { from: await Promise.all((await this.backlinks(hash, hidden)).map(row)), to: await Promise.all([...to.values()].map(row)), missing: [...missing] };
  }

  /**
   * Items were renamed or put in other folders: the notes' links to them follow (`[[old name]]` when that name was theirs alone, a path
   * to their old place), and a note that moved has its own paths written from its new place. Each changed note is saved as a new version.
   */
  private async relink(moved: ReadonlyMap<string, { name: string; path: string[] }>): Promise<void> {
    await this.storage?.flush().catch(() => undefined); // (the desktop app's files in their new places first)
    const listing = await this.catalog?.list().catch(() => null);
    if (!listing) return;
    const now = new Map(listing.entries.map((e) => [e.hash, e]));
    const pathNow = new Map<string, string[]>();
    for (const h of moved.keys()) if (now.has(h)) pathNow.set(h, await this.itemPath(now.get(h)!, listing.folders));
    for (const e of listing.entries) {
      const kind = noteKindOf(e.name);
      if (!kind || kind === "txt" || !e.present) continue;
      const links = await this.linksOf(e, kind);
      if (!links.wiki.length && !links.paths.length) continue;
      const rec = await this.assets?.record(e.hash).catch(() => undefined);
      if (!rec) continue;
      const text = await rec.blob.text();
      const dirNow = (pathNow.get(e.hash) ?? (await this.itemPath(e, listing.folders))).slice(0, -1);
      const dirThen = moved.get(e.hash)?.path.slice(0, -1) ?? dirNow;
      let out = text;
      for (const [h, then] of moved) {
        const cur = now.get(h);
        const to = pathNow.get(h);
        if (!cur || !to) continue;
        const oldKey = Session.wikiKey(then.name);
        const alone = !listing.entries.some((x) => x.hash !== h && Session.wikiKey(x.name) === oldKey);
        const named = then.name !== cur.name && alone;
        out = relinkNote(kind, out, { oldWiki: named ? oldKey : null, newWiki: noteKindOf(cur.name) === "md" ? cur.name.replace(/\.(md|markdown)$/i, "") : cur.name, oldPath: relativeLink(dirThen, then.path), newPath: libraryLink(to) });
        out = relinkNote(kind, out, { oldWiki: null, newWiki: "", oldPath: libraryLink(then.path), newPath: libraryLink(to) }); // (as a note writes a link now)
      }
      // (a note that moved: its paths to items that stayed are written from its new folder)
      if (dirThen.join("/") !== dirNow.join("/")) {
        for (const p of links.paths) {
          const t = linkTarget(p, dirThen);
          if (!t || "hash" in t) continue;
          const stayed = await this.itemAtPath(t, listing.entries, listing.folders);
          if (stayed && !moved.has(stayed.hash)) out = relinkNote(kind, out, { oldWiki: null, newWiki: "", oldPath: p, newPath: libraryLink(await this.itemPath(stayed, listing.folders)) });
        }
      }
      if (out !== text) {
        this.ownWrites++;
        await this.saveVersion(e.hash, new File([out], e.name, { type: rec.type })).finally(() => void this.ownWrites--);
      }
    }
  }

  private outsideMoves = new Map<string, { name: string; path: string[] }>();
  private outsideTimer = 0;
  /** A file renamed or moved outside the app (found now, or at start-up for what happened while it was closed): the links to it in notes follow, as for a change in the library. */
  movedOutside(m: { hash: string; name: string; path: string }): void {
    if (!this.outsideMoves.has(m.hash)) this.outsideMoves.set(m.hash, { name: m.name, path: m.path.replace(/^library\//, "").split("/") });
    clearTimeout(this.outsideTimer);
    this.outsideTimer = window.setTimeout(() => this.followOutsideMoves(), 300);
  }
  private followOutsideMoves(): void {
    if (!this.catalog || this.readOnly) return void (this.outsideTimer = window.setTimeout(() => this.followOutsideMoves(), 1000)); // (the app is still opening)
    const moved = new Map(this.outsideMoves);
    this.outsideMoves.clear();
    void this.relink(moved).then(() => {
      this.post({ kind: "assets" });
      this.emitAssets();
    });
  }

  /** The item a link in a note points at (a path from the note's folder, `canvast:<hash>`, a `[[name]]`), or null. */
  async linkedItem(noteHash: string, link: string): Promise<CatalogEntry | null> {
    const listing = await this.catalog?.list().catch(() => null);
    const note = listing?.entries.find((e) => e.hash === noteHash);
    if (!listing || !note) return null;
    if (link.startsWith(WIKI)) {
      const t = wikiTarget(decodeURIComponent(link.slice(WIKI.length)));
      return listing.entries.find((e) => e.name.toLowerCase() === t.name || Session.wikiKey(e.name) === t.name) ?? null;
    }
    const t = linkTarget(link, (await this.itemPath(note, listing.folders)).slice(0, -1));
    if (!t) return null;
    if ("hash" in t) return listing.entries.find((e) => e.hash === t.hash) ?? null;
    return this.itemAtPath(t, listing.entries, listing.folders);
  }

  /**
   * The item among `entries` a path in a note points at. A file's name on disk is not always the item's (`my cat.png` is `my_cat.png`, the
   * second `image.png` is `image-2.png`), so the file at the path comes first, read from the note's folder, then from the root of the library
   * (a copy of an item's file is that item). Then the item's own name and folders (a build without files), and last the one item of that name
   * anywhere (moved since), which a link written elsewhere with only the file's name also finds.
   */
  async itemAtPath<E extends Pick<CatalogEntry, "hash" | "name" | "folderIds">>(t: PathTarget, entries: readonly E[], folders: readonly AssetFolder[]): Promise<E | null> {
    const ways = [t.path, ...(t.root && t.root.join("/") !== t.path.join("/") ? [t.root] : [])];
    for (const way of ways) {
      const hash = await this.storage?.originals.hashAt(`library/${way.join("/")}`).catch(() => null);
      const found = hash ? entries.find((e) => e.hash === hash) : undefined;
      if (found) return found;
    }
    const last = t.path[t.path.length - 1]!;
    const named = entries.filter((e) => e.name === last);
    for (const way of ways) for (const e of named) if ((await this.itemPath(e, folders)).join("/") === way.join("/")) return e;
    if (named.length) return named.length === 1 ? named[0]! : null;
    // (the file's name as the disk writes it: `my_cat.png` for the item `my cat.png`)
    const ext = (n: string): string => /\.[^.]+$/.exec(n)?.[0].toLowerCase() ?? "";
    const safe = (n: string): string => `${nameBase(n)}${ext(n)}`;
    const onDisk = entries.filter((e) => safe(e.name) === safe(last));
    return onDisk.length === 1 ? onDisk[0]! : null;
  }

  /** Told when an item gets a new version (a note saved, a file changed outside the app): its old hash and its new one. */
  /** The app itself is writing a note's links or properties: a version from this is no change made elsewhere. */
  private ownWrites = 0;
  private readonly versionFns = new Set<(from: string, to: string, own: boolean) => void>();
  onVersion(fn: (from: string, to: string, own: boolean) => void): void {
    this.versionFns.add(fn);
  }

  /** The library's own undo (tags, favourites, folders, names): a snapshot before each change, put back by Ctrl+Z in the Library. */
  private libUndo: Array<{ label: string; snap: MetaSnapshot }> = [];
  private libRedo: Array<{ label: string; snap: MetaSnapshot }> = [];

  /** Undo (or redo) the last change to the library's organization; the label of what was undone, or null when there is nothing to. */
  async undoLibrary(redo = false): Promise<string | null> {
    if (!this.guardWrite() || !this.catalog) return null;
    const from = redo ? this.libRedo : this.libUndo;
    const step = from.pop();
    if (!step) return null;
    try {
      const now = await this.catalog.snapshotMeta();
      await this.catalog.restoreMeta(step.snap);
      (redo ? this.libUndo : this.libRedo).push({ label: step.label, snap: now });
      void this.writeNoteProps(new Set(["*"]));
    } catch (e) {
      this.tell(`Could not ${redo ? "redo" : "undo"}: ${(e as Error).message}`);
      return null;
    }
    this.post({ kind: "assets" });
    this.emitAssets(true);
    this.onMetaChanged?.(new Set(["*"]));
    return step.label;
  }

  /** Every canvas where an asset is placed, with board and canvas names. */
  async assetPlaces(hash: string): Promise<AssetPlace[]> {
    if (!this.catalog || !this.tree) return [];
    await this.persistence.flush();
    const locs = await this.catalog.locations(hash);
    const places: AssetPlace[] = [];
    for (const { board, canvases } of this.tree.boards) {
      for (const c of canvases) {
        const loc = locs.find((l) => l.canvasId === c.id);
        if (loc) places.push({ boardId: board.id, boardName: board.name, canvasId: c.id, canvasName: c.name, ids: loc.ids });
      }
    }
    return places;
  }

  /**
   * Open a canvas, select the given instances and frame them exactly, at
   * whatever depth they were placed.
   */
  async reveal(canvasId: string, ids: readonly ObjectId[]): Promise<void> {
    await this.openCanvas(canvasId);
    const objects = ids.map((id) => this.doc.get(id)).filter((o) => o !== undefined);
    if (objects.length) {
      // Frame them in the first object's frame: the others are re-expressed there exactly.
      const f = objects[0]!.frame ?? this.doc.space.world;
      const bounds = unionBounds(objects.map((o) => expressObjectIn(o, f)))!;
      const fallback = zoomLevel(this.view.camera) + levelsBetween(f, this.view.frame);
      this.view.setFrameCamera(fromLocal(f, fitRect(bounds.min, bounds.max, this.view.viewport, REVEAL_FILL, fallback)));
    }
    this.editor.select(objects.map((o) => o.id));
  }

  /**
   * Every in-canvas tag in the workspace (ADR 0062), read from the objects' "tags" index: the tag as first spelled, how many objects
   * carry it, which canvases, and which library assets those objects are instances of.
   */
  async canvasTagIndex(): Promise<Map<string, TagUse>> {
    if (!this.repo) return new Map();
    await this.persistence.flush();
    return this.repo.tagIndex();
  }

  /**
   * Rename (`to` is a name) or delete (`to` is null) an in-canvas tag on every canvas of the workspace (ADR 0070). The open canvas goes
   * through its document, so one undo brings it back; the other canvases are rewritten in storage. Renaming onto an existing tag merges.
   * Returns how many items changed (0 when refused).
   */
  async changeCanvasTag(from: string, to: string | null): Promise<number> {
    if (!this.guardWrite() || !this.repo) return 0;
    let target: string | null = null;
    if (to !== null) {
      try {
        target = normalizeTags([to])[0] ?? null;
      } catch (e) {
        this.tell(e instanceof CatalogInputError ? e.message[0]!.toUpperCase() + e.message.slice(1) + "." : "That is not a valid tag.");
        return 0;
      }
      if (!target) {
        this.tell("Type a name for the tag.");
        return 0;
      }
    }
    const key = from.replace(/^#+/, "").trim().toLowerCase();
    await this.persistence.flush();
    let n = changeTagOnCanvas(this.doc, this.editor, key, target);
    await this.persistence.flush();
    try {
      const other = await this.repo.changeObjectTag(key, target, this.current?.canvasId ?? null);
      n += other.objects;
      for (const id of other.canvases) this.post({ kind: "commit", canvasId: id, revision: -1 });
    } catch (e) {
      this.tell(`Could not change the tag on other canvases: ${(e as Error).message}`);
    }
    this.emitAssets();
    return n;
  }

  /** The in-canvas tags carried by instances of one library asset, anywhere in the workspace. */
  async canvasTagsOfAsset(hash: string): Promise<Array<{ tag: string; canvases: string[] }>> {
    if (!this.repo) return [];
    await this.persistence.flush();
    const rows = await this.repo.tagsOfAssetInstances(hash);
    // Each tag with the canvases it was put on this picture on (so the person can tell which canvas a tag comes from).
    const seen = new Map<string, { tag: string; canvases: Set<string> }>();
    for (const row of rows) for (const t of row.tags) {
      const e = seen.get(t.toLowerCase()) ?? { tag: t, canvases: new Set<string>() };
      e.canvases.add(row.canvasId);
      seen.set(t.toLowerCase(), e);
    }
    return [...seen.values()].map((e) => ({ tag: e.tag, canvases: [...e.canvases] })).sort((a, b) => a.tag.localeCompare(b.tag));
  }

  /** Place a new instance of a library asset at the centre of the open canvas. */
  async placeAsset(hash: string, withTags = false, card?: CardLook): Promise<ObjectId | null> {
    if (this.editor.blockEdit() || !this.assets) return null;
    const rec = await this.assets.record(hash);
    if (!rec) {
      this.tell("The file of this item is missing, so it cannot be placed.");
      return null;
    }
    const tags = withTags ? ((await this.catalog?.entry(hash).catch(() => undefined))?.tags ?? []) : [];
    // (a copy of a file elsewhere in the library is placed as its content: a canvas names contents, which every version of the app reads)
    const r = await withGifFrames({ ...rec, hash: contentOf(rec.hash) });
    return placeImage(card ? { ...r, pixelW: card.size.w, pixelH: card.size.h } : r, this.doc, this.view, 0, "Place item", tags, card?.preview).id;
  }

  /**
   * Place library assets on a chosen canvas: an existing one, a new canvas in a board, or a new board. The canvas is opened first, so
   * the pictures land there; one undo step on that canvas. Returns how many were placed.
   */
  async placeAssetsOn(hashes: readonly string[], target: { canvasId: string } | { newCanvasIn: string } | { newBoard: true }, withTags = false, card?: CardLook): Promise<number> {
    if (this.editor.blockEdit()) return 0;
    if ("canvasId" in target) await this.openCanvas(target.canvasId);
    else if ("newCanvasIn" in target) await this.newCanvas(target.newCanvasIn);
    else await this.newBoard();
    const n = hashes.length === 1 && card ? Number(!!(await this.placeAsset(hashes[0]!, withTags, card))) : await this.placeAssets(hashes, withTags);
    const cur = this.current;
    const board = this.tree?.boards.find((b) => b.board.id === cur?.boardId);
    const canvas = board?.canvases.find((c) => c.id === cur?.canvasId);
    if (n && board && canvas) this.tell(`Placed ${n} on ${board.board.name} › ${canvas.name}.`);
    return n;
  }

  /** Place several library assets on the open canvas, in a grid, as one undo step. Returns how many were placed. */
  async placeAssets(hashes: readonly string[], withTags = false): Promise<number> {
    if (this.editor.blockEdit() || !this.assets) return 0;
    const tagsOf = new Map<string, readonly string[]>();
    if (withTags) for (const h of hashes) tagsOf.set(h, (await this.catalog?.entry(h).catch(() => undefined))?.tags ?? []);
    const recs = [];
    // (each original is read, from the library folder too: many of them take a while, so it says how far it is)
    const progress = hashes.length > 1 ? beginProgress(this.editor, "place", `Placing ${hashes.length} items`) : null;
    for (const [i, h] of hashes.entries()) {
      progress?.update(i / hashes.length, `${i + 1} of ${hashes.length}`);
      const rec = await this.assets.record(h);
      if (rec) recs.push(await withGifFrames({ ...rec, hash: contentOf(rec.hash) }));
    }
    progress?.done();
    if (recs.length < hashes.length) this.tell(`${hashes.length - recs.length} of the files are missing and were not placed.`);
    if (recs.length === 1) placeImage(recs[0]!, this.doc, this.view, 0, "Place item", tagsOf.get(recs[0]!.hash) ?? []);
    else if (recs.length > 1) placeImages(recs, this.doc, this.view, `Place ${recs.length} items`, tagsOf);
    return recs.length;
  }

  /**
   * Delete assets from the library even though canvases use them: their instances go first, everywhere (on the open canvas as one undo
   * step; on the others for good), a text using one as its font keeps its words in the default font; then they are deleted as usual (the
   * originals are erased once nothing, undo included, can need them). Returns how many were deleted.
   */
  async deleteAssetsEverywhere(hashes: readonly string[]): Promise<number> {
    if (!this.guardWrite() || !this.catalog || !this.repo) return 0;
    const set = new Set(hashes);
    await this.persistence.flush();
    const here = [...this.doc.all()].filter((o) => {
      const a = (o as { assetId?: string }).assetId; // (a picture, a player, a card, or a text whose font it is)
      return a !== undefined && set.has(a);
    });
    if (here.length) {
      const texts = here.filter((o): o is TextObject => o.kind === "text").map((o) => {
        const { assetId: _font, ...rest } = o;
        return rest as TextObject;
      });
      const gone = here.filter((o) => o.kind !== "text").map((o) => o.id);
      this.doc.commit(this.doc.transaction(`Delete ${plural(hashes.length, "item")} everywhere`, texts, gone));
      this.editor.select([...this.editor.selection].filter((id) => !gone.includes(id)));
      await this.persistence.flush();
    }
    try {
      const other = await this.repo.removeAssetInstances(hashes, this.current?.canvasId ?? null);
      for (const id of other.canvases) this.post({ kind: "commit", canvasId: id, revision: -1 });
      await this.refreshTree();
    } catch (e) {
      this.tell(`Could not take them off the other canvases: ${(e as Error).message}`);
      return 0;
    }
    return this.deleteAssets(hashes);
  }

  /**
   * A library file was changed outside the app (saved again by the program it is worked on in, of any kind) and is the asset `to` now:
   * every instance of `from`, on this canvas and the others, uses `to` (`size`: its pixels), and so do the open canvas's undo and redo
   * steps. Not an undo step of its own: the old content is gone.
   */
  async followAsset(from: string, to: string, size: { w: number; h: number }): Promise<void> {
    if (from === to) return;
    for (const fn of this.versionFns) fn(from, to, this.ownWrites > 0);
    await this.adoptNoteProps(to);
    if (!this.repo) return;
    await this.persistence.flush();
    // (in the undo history too: an undo never brings back the old version, and no step finds its object changed under it)
    this.doc.remap((o) => ((o as { assetId?: string }).assetId === from ? deserializeObject(retargeted(serializeObject(o) as unknown as Record<string, unknown>, to, size) as unknown as SerializedObject, this.doc.space) : o));
    await this.persistence.flush();
    try {
      const other = await this.repo.retargetAssetInstances(from, to, size, this.current?.canvasId ?? null);
      for (const id of other.canvases) this.post({ kind: "commit", canvasId: id, revision: -1 });
    } catch (e) {
      this.tell(`Could not point the other canvases at the new version: ${(e as Error).message}`);
    }
  }

  /** An item's thumbnail picture: a note's page made now (it follows the preview look, so it is never stored), else the stored one. */
  async thumbBlob(hash: string): Promise<Blob | undefined> {
    const e = await this.catalog?.entry(hash).catch(() => undefined);
    if (e && noteKindOf(e.name)) {
      const rec = await this.assets?.record(hash).catch(() => undefined);
      return rec ? (await makeThumb(rec))?.blob : undefined;
    }
    return (await this.catalog?.thumb(hash).catch(() => undefined))?.blob;
  }

  /**
   * Save a new version of a library item's file made in the app (a note): it takes the item's place everywhere (its name, folder, tags,
   * notes, and what was placed of it on the canvases). The desktop build writes it over the item's file; elsewhere the new version becomes
   * an item of its own and the old one is deleted. The new version's hash, or null when it was not saved (with a message).
   */
  async saveVersion(old: string, file: File): Promise<string | null> {
    if (!this.guardWrite() || !this.catalog || !this.assets) return null;
    try {
      let bytes = new Uint8Array(await file.arrayBuffer());
      let hash = await sha256Hex(bytes.buffer);
      if (hash === old) return old;
      // A note's words the same as another note's: one line more at its end keeps them two notes (an item is its bytes).
      while (noteKindOf(file.name) && !isDataText(file.name) && (await this.catalog.entry(hash).catch(() => undefined))?.state === "active") {
        bytes = new Uint8Array([...bytes, 10]);
        hash = await sha256Hex(bytes.buffer);
        file = new File([bytes], file.name, { type: file.type });
        if (hash === old) return old;
      }
      await this.persistence.flush();
      if (await this.storage?.folderSync?.saveFile(old, bytes)) return hash;
      const e = await this.catalog.entry(old);
      const { record } = await this.assets.importFileDetailed(file, false);
      if (e) await this.catalog.updateMeta(record.hash, { addFolders: e.folderIds?.slice(0, 1) ?? [], addTags: e.tags ?? [], favorite: !!e.favorite, hidden: !!e.hidden, note: e.note ?? "", fields: e.fields ?? [], ...(e.thumb ? { thumb: e.thumb } : {}) });
      await this.followAsset(old, record.hash, { w: record.pixelW, h: record.pixelH });
      await this.catalog.markDeleted(old);
      this.gcPending = true;
      await this.collectGarbage();
      this.post({ kind: "assets" });
      this.emitAssets();
      return record.hash;
    } catch (e) {
      this.tell(`Not saved: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Delete several assets from the library. Those that instances use are kept; the rest are removed and their originals erased as
   * soon as nothing can need them. One summary is shown. Returns how many were deleted.
   */
  async deleteAssets(hashes: readonly string[]): Promise<number> {
    if (!this.guardWrite() || !this.catalog) return 0;
    await this.persistence.flush();
    let gone: string[] = [];
    let inUse = 0;
    try {
      ({ gone, inUse } = await this.catalog.markDeletedEach(hashes));
    } catch (e) {
      this.tell(`Could not delete the items: ${(e as Error).message}`);
    }
    if (gone.length) {
      this.gcPending = true;
      await this.collectGarbage();
      this.post({ kind: "assets" });
      this.emitAssets();
    }
    this.tell(`Deleted ${gone.length} item${gone.length === 1 ? "" : "s"} from the library.${inUse ? ` ${inUse} in use ${inUse === 1 ? "was" : "were"} kept.` : ""}`);
    return gone.length;
  }

  /**
   * Delete a canvas and its objects. If it is open, switch to a neighbour
   * first. Image originals stay in the asset library.
   */
  async deleteCanvas(canvasId: string): Promise<boolean> {
    if (!this.guardWrite() || !this.tree || !this.current) return false;
    const entry = this.tree.boards.find((b) => b.canvases.some((c) => c.id === canvasId));
    if (!entry) return false;
    if (entry.canvases.length <= 1) {
      this.tell("A board needs at least one canvas. Delete the board instead.");
      return false;
    }
    if (this.current.canvasId === canvasId) {
      const i = entry.canvases.findIndex((c) => c.id === canvasId);
      await this.openCanvas(entry.canvases[i > 0 ? i - 1 : 1]!.id);
    } else {
      await this.persistence.flush();
    }
    return this.structural(async () => {
      // Our own pending edits are flushed above; the revision check now guards against another writer.
      await this.refreshTree();
      const rev = this.findCanvas(canvasId)?.revision ?? -1;
      await this.repo!.deleteCanvas(canvasId, rev);
    });
  }

  private findCanvas(id: string): CanvasRecord | undefined {
    for (const b of this.tree?.boards ?? []) for (const c of b.canvases) if (c.id === id) return c;
    return undefined;
  }

  /** Delete a board with all its canvases. If it is open, switch to a neighbouring board first. */
  async deleteBoard(boardId: string): Promise<boolean> {
    if (!this.guardWrite() || !this.tree || !this.current) return false;
    const boards = this.tree.boards;
    const i = boards.findIndex((b) => b.board.id === boardId);
    if (i < 0) return false;
    if (boards.length <= 1) {
      this.tell("A workspace needs at least one board.");
      return false;
    }
    if (this.current.boardId === boardId) {
      const other = boards[i > 0 ? i - 1 : 1]!;
      await this.openCanvas(other.canvases[0]!.id);
    } else {
      await this.persistence.flush();
    }
    return this.structural(async () => {
      await this.refreshTree();
      const entry = this.tree?.boards.find((b) => b.board.id === boardId);
      const expected = new Map((entry?.canvases ?? []).map((c) => [c.id, c.revision]));
      await this.repo!.deleteBoard(boardId, expected);
    });
  }

  private async structural(op: () => Promise<unknown>): Promise<boolean> {
    try {
      await op();
    } catch (e) {
      if (e instanceof HierarchyError) this.tell(e.message);
      else if (e instanceof RevisionConflictError) this.tell("Not deleted: it changed since you confirmed. Check it and try again.");
      else this.tell(`Could not delete: ${(e as Error).message}`);
      await this.refreshTree();
      return false;
    }
    await this.refreshTree();
    this.post({ kind: "tree" });
    this.emitAssets(); // usage counts changed
    return true;
  }

  /**
   * Build a verified archive. Saves are flushed first, so it includes every
   * edit made so far. Read-only tabs may export (it only reads).
   */
  /** The original files of a scope as a plain ZIP (see `files-zip.ts`), named and grouped as asked. */
  async exportFiles(scope: ExportScope, layout: FilesLayout, progress?: ProgressFn): Promise<FilesZipResult & { fileName: string }> {
    if (!this.repo || !this.current) throw new Error("storage is unavailable, so there is nothing to export");
    await this.persistence.flush();
    const r = await this.backups!.buildFilesZip(this.current.workspaceId, scope, layout, progress);
    const tree = this.tree;
    const label =
      scope.kind === "workspace" ? (tree?.workspace.displayName ?? "workspace")
      : scope.kind === "board" ? (tree?.boards.find((b) => b.board.id === scope.boardId)?.board.name ?? "board")
      : scope.kind === "canvas" ? (tree?.boards.flatMap((b) => b.canvases).find((c) => c.id === scope.canvasId)?.name ?? "canvas")
      : "assets";
    const fileName = archiveFileName(`${label}-files`, new Date()).replace(/\.canvast$/, ".zip");
    return { ...r, fileName };
  }

  /** What an export of `scope` writes, by path, each file read when asked for (an export written file by file, see `files-zip.ts`). */
  async planFiles(scope: ExportScope, layout: FilesLayout, progress?: ProgressFn): Promise<FilesPlan> {
    if (!this.repo || !this.current) throw new Error("storage is unavailable, so there is nothing to export");
    await this.persistence.flush();
    return this.backups!.planFiles(this.current.workspaceId, scope, layout, progress);
  }

  /** How many hidden library items an export of `scope` would carry. */
  async hiddenInExport(scope: ExportScope): Promise<number> {
    return this.backups ? this.backups.hiddenInScope(scope) : 0;
  }

  /** The password gates (assets/hidden-lock.ts): of the Hidden items and of the whole workspace. Whether there is one, set or remove it, check a try. */
  async hasPassword(kind: PasswordKind): Promise<boolean> {
    if (await this.catalog?.lock(kind).catch(() => null)) return true;
    return kind === "hidden" && !!this.storage?.hidden && (await this.storage.hidden.state()) !== "none";
  }

  /**
   * In the desktop build the Hidden password also wraps the key the hidden items are encrypted with (ADR 0177): a new one wraps
   * the same key again, and it cannot be removed while items are hidden.
   */
  async setPassword(kind: PasswordKind, password: string | null, current?: string): Promise<boolean> {
    if (!this.guardWrite() || !this.catalog) return false;
    const hidden = kind === "hidden" ? this.storage?.hidden : null;
    if (hidden && password === null && !(await hidden.remove())) {
      this.tell("Show the hidden items first: in this app hidden items are encrypted with this password, so it stays while there are any.");
      return false;
    }
    if (hidden && password !== null) {
      try {
        await hidden.setPassword(password, current);
      } catch (e) {
        this.tell((e as Error).message);
        return false;
      }
    }
    await this.catalog.setLock(kind, password === null ? null : await makeLock(password));
    return true;
  }

  /** Whether `password` is the right one. In the desktop build a right Hidden password also opens the hidden items' key. */
  async checkPassword(kind: PasswordKind, password: string): Promise<boolean> {
    const hidden = kind === "hidden" ? this.storage?.hidden : null;
    if (hidden && (await hidden.state()) !== "none") return hidden.unlock(password);
    const lock = await this.catalog?.lock(kind).catch(() => null);
    const ok = !lock || (await checkLock(lock, password));
    // (a password set before the key, or brought by a backup: its key is made now; not while another device's key is on its way)
    if (ok && lock && hidden) await hidden.setPassword(password).catch((e: unknown) => this.tell((e as Error).message));
    return ok;
  }

  /** The settings, which travel in a workspace backup and come back on import; those of the workspace are kept in it (set by the app). */
  settingsHook: { snapshot(withPrivacy: boolean): Record<string, unknown>; privacySet(): boolean; restore(from: unknown): number; restorable(from: unknown): number; getAuto(): boolean; setAuto(on: boolean): void; workspace(): Record<string, unknown>; adopt(from: Record<string, unknown>): void; localAt(): number } | null = null;

  /**
   * The workspace's settings, as kept in it: taken here. A workspace that has none yet (made before they were kept there, or by an
   * older version) gets this device's, so nothing changes on opening it.
   */
  async adoptWorkspaceSettings(): Promise<void> {
    const h = this.settingsHook;
    if (!h || !this.repo) return;
    const kept = await this.repo.settings().catch(() => undefined);
    this.settingsRead = true;
    // (newer here: changed just before the app closed or reloaded, before the workspace kept it; then this device's go there)
    const at = kept && typeof kept === "object" && !Array.isArray(kept) ? (kept as Record<string, unknown>)[WS_AT] : undefined;
    if (kept && typeof kept === "object" && !Array.isArray(kept) && !(h.localAt() > (typeof at === "number" ? at : 0))) h.adopt(kept as Record<string, unknown>);
    else if (!this.readOnly) await this.saveWorkspaceSettings(h.workspace());
  }
  /** Whether the workspace's settings were read: none is written before, so a change at start-up never covers the workspace's. */
  private settingsRead = false;

  /** A workspace setting changed here: kept in the workspace (written to its folder in the desktop build), and other tabs told. */
  async saveWorkspaceSettings(values: Record<string, unknown>): Promise<void> {
    if (!this.repo || this.readOnly || !this.settingsRead) return;
    await this.repo.saveSettings(values).catch((e: unknown) => this.tell(`The workspace's settings could not be saved: ${(e as Error).message}`));
    this.post({ kind: "settings" });
  }
  /** Keeps the library index in the library folder up to date (storage/auto-index.ts); set by the app. */
  autoIndex: { poke(): void; flush(): Promise<void> } | null = null;

  async exportArchive(scope: ExportScope, progress?: ProgressFn): Promise<ExportResult & { fileName: string }> {
    if (!this.repo || !this.current) throw new Error("storage is unavailable, so there is nothing to export");
    await this.persistence.flush();
    await this.persistence.saveCamera();
    const version = typeof __CANVAST_VERSION__ === "string" ? __CANVAST_VERSION__ : "dev";
    const withPrivacy = scope.kind === "workspace" && !scope.noBytes && scope.withPrivacy === true; // (chosen when asked; the library index on disk never carries them)
    const r = await this.backups!.buildArchive(this.current.workspaceId, scope, version, this.settingsHook?.snapshot(withPrivacy), progress);
    const label =
      scope.kind === "workspace" ? r.manifest.workspaceName
      : scope.kind === "assets" ? (r.manifest.assets[0]?.name.replace(/\.[^.]*$/, "") ?? "assets")
      : scope.kind === "board" ? r.manifest.boards[0]!.name
      : `${r.manifest.boards[0]!.name}-${r.manifest.boards[0]!.canvases[0]!.name}`;
    const fileName = archiveFileName(label, new Date(r.manifest.exportedAt));
    if (scope.kind === "workspace" && !this.readOnly && !scope.noBytes) {
      const rec: BackupRecord = {
        kind: scope.since !== undefined ? "incremental" : "full",
        at: r.manifest.exportedAt,
        bytes: r.blob.size,
        fileName,
        boards: r.manifest.boards.length,
        canvases: r.canvases,
        objects: r.objects,
        assets: r.manifest.assets.length,
        verified: true,
      };
      await this.backups!.recordBackup(rec);
    }
    return { ...r, fileName };
  }

  async lastBackup(): Promise<BackupRecord | null> {
    return this.backups ? this.backups.lastBackup() : null;
  }

  /** Validate an archive, or a chain of backups (a full one and the incremental ones after it), without writing anything. */
  readArchive(files: Blob | readonly Blob[], folder?: FolderFiles, progress?: ProgressFn): Promise<ImportPlan> {
    return Array.isArray(files) ? readArchiveChain(files as readonly Blob[], progress) : readArchive(files as Blob, folder, progress);
  }

  /** Write a validated archive into this workspace, then open its first canvas. */
  async applyImport(plan: ImportPlan, progress?: ProgressFn): Promise<ImportResult | null> {
    if (!this.guardWrite() || !this.current) return null;
    await this.persistence.flush();
    const r = await this.backups!.applyImport(this.current.workspaceId, this.current.boardId, plan, progress);
    await this.refreshTree();
    this.post({ kind: "tree" });
    this.post({ kind: "assets" });
    this.emitAssets();
    if (r.firstCanvasId) await this.openCanvas(r.firstCanvasId);
    return r;
  }

  tell(message: string): void {
    this.editor.message = message;
    this.editor.changed();
  }

  async newBoard(): Promise<void> {
    if (!this.guardWrite() || !this.current) return;
    const n = (this.tree?.boards.length ?? 0) + 1;
    const { canvas } = await this.repo!.createBoard(this.current.workspaceId, `Board ${n}`);
    await this.refreshTree();
    this.post({ kind: "tree" });
    await this.openCanvas(canvas.id);
  }

  async newCanvas(boardId: string): Promise<void> {
    if (!this.guardWrite()) return;
    const entry = this.tree?.boards.find((b) => b.board.id === boardId);
    const n = (entry?.canvases.length ?? 0) + 1;
    const canvas = await this.repo!.createCanvas(boardId, `Canvas ${n}`);
    await this.refreshTree();
    this.post({ kind: "tree" });
    await this.openCanvas(canvas.id);
  }

  /** A copy of a canvas, opened (ADR 0110). */
  async duplicateCanvas(id: string): Promise<void> {
    if (!this.guardWrite()) return;
    const src = this.tree?.boards.flatMap((b) => b.canvases).find((c) => c.id === id);
    if (!src) return;
    await this.persistence.flush(); // (the copy is made from what is stored)
    const canvas = await this.repo!.duplicateCanvas(id, `${src.name} copy`.slice(0, 120));
    await this.refreshTree();
    this.post({ kind: "tree" });
    await this.openCanvas(canvas.id);
  }

  /** A copy of a board with all its canvases; its first canvas is opened. */
  async duplicateBoard(id: string): Promise<void> {
    if (!this.guardWrite()) return;
    const src = this.tree?.boards.find((b) => b.board.id === id);
    if (!src) return;
    await this.persistence.flush();
    const { canvas } = await this.repo!.duplicateBoard(id, `${src.board.name} copy`.slice(0, 120));
    await this.refreshTree();
    this.post({ kind: "tree" });
    await this.openCanvas(canvas.id);
  }

  /** Put a canvas at `index` of a board (another board too). The open canvas stays open, in its new board. */
  async moveCanvas(id: string, boardId: string, index: number): Promise<void> {
    if (!this.guardWrite()) return;
    try {
      await this.repo!.moveCanvas(id, boardId, index);
    } catch (e) {
      this.tell((e as Error).message);
      return;
    }
    if (this.current?.canvasId === id) {
      this.current = { ...this.current, boardId };
      await this.repo!.setCurrent(this.current);
    }
    await this.refreshTree();
    this.post({ kind: "tree" });
    this.emit();
  }

  /** Put a board at `index` of the workspace. */
  async moveBoard(id: string, index: number): Promise<void> {
    if (!this.guardWrite()) return;
    await this.repo!.moveBoard(id, index);
    await this.refreshTree();
    this.post({ kind: "tree" });
  }

  /** Called after assets are renamed, so the canvas draws its cards again (set by the app). */
  onAssetsRenamed: (() => void) | null = null;

  /** Rename assets in the library (ADR 0085). Returns how many changed (0 when refused). */
  async renameAssets(changes: ReadonlyArray<{ hash: string; name: string }>): Promise<number> {
    let n = 0;
    const ok = await this.organize(async (c) => {
      n = await c.renameAssets(changes);
    });
    if (ok && n) {
      this.assets?.renamed(changes.map((c) => c.hash));
      this.onAssetsRenamed?.();
    }
    return ok ? n : 0;
  }

  /** The ground under see-through pictures in the library viewer (kept with the workspace). */
  /** The sample sentence fonts are shown in (the viewer's button), and who redraws their cards on a canvas when it or the ground changes. */
  fontSample = "";
  onFontLook: (() => void) | null = null;

  get viewGround(): ViewGround {
    return this.tree?.workspace.viewGround ?? "checker";
  }

  async setViewGround(ground: ViewGround): Promise<void> {
    const ws = this.tree?.workspace;
    if (!ws) return;
    ws.viewGround = ground; // (shown at once; kept only where this tab may write)
    if (this.readOnly || !this.repo) return;
    await this.repo.setViewGround(ws.id, ground);
    this.post({ kind: "tree" });
  }

  async renameWorkspace(name: string): Promise<void> {
    const id = this.tree?.workspace.id;
    if (!this.guardWrite() || !id || !name.trim()) return;
    await this.repo!.renameWorkspace(id, name.trim().slice(0, 120));
    await this.refreshTree();
    this.post({ kind: "tree" });
  }

  async renameBoard(id: string, name: string): Promise<void> {
    if (!this.guardWrite() || !name.trim()) return;
    await this.repo!.renameBoard(id, name.trim());
    await this.refreshTree();
    this.post({ kind: "tree" });
  }

  async renameCanvas(id: string, name: string): Promise<void> {
    if (!this.guardWrite() || !name.trim()) return;
    await this.repo!.renameCanvas(id, name.trim());
    await this.refreshTree();
    this.post({ kind: "tree" });
  }

  /** Take over the writer role from another tab. */
  async takeOver(): Promise<void> {
    await this.lease.takeOver();
  }

  private guardWrite(): boolean {
    if (!this.repo) return false;
    if (this.readOnly) {
      this.tell(readOnlyLine());
      return false;
    }
    return true;
  }

  private async onLease(): Promise<void> {
    const ro = this.readOnly;
    this.editor.readOnly = ro;
    if (!ro && this.current && this.repo) {
      // Promoted to writer: reload the canvas so edits start from the latest stored state.
      await this.load(this.current.canvasId);
    }
    this.persistence.setWritable(!ro);
    this.editor.changed();
    this.emit();
  }
}
