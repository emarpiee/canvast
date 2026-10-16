import { HOME, deserializeCamera, fitRect, zoomLevel } from "../core/camera";
import { deserializeFrameCamera, fromLocal, levelsBetween } from "../core/frames";
import type { AssetLibrary } from "../assets/asset-library";
import { AssetCatalog, AssetInUseError, CatalogInputError } from "../assets/asset-catalog";
import type { GcReport } from "../assets/asset-catalog";
import type { ObjectId } from "../doc/model";
import { plainText } from "../text/markdown";
import { expressObjectIn } from "../doc/model";
import { unionBounds } from "../doc/edit-ops";
import { placeImage, placeImages } from "./actions";
import type { ExportResult, ExportScope, ImportPlan, ImportResult } from "../storage/archive";
import { applyImport, archiveFileName, buildArchive, readArchive } from "../storage/archive";
import type { FilesLayout, FilesZipResult } from "../storage/files-zip";
import { buildFilesZip } from "../storage/files-zip";
import { idbGet } from "../storage/idb";
import type { DocumentStore } from "../doc/document-store";
import type { ViewState } from "./view-state";
import type { EditorState } from "./editor-state";
import { CanvasPersistence } from "../storage/canvas-persistence";
import type { BoardRecord, CanvasRecord, CurrentMeta, WorkspaceRecord } from "../storage/workspace-repo";
import { HierarchyError, RevisionConflictError, WorkspaceRepo } from "../storage/workspace-repo";
import { ensureWorkspace } from "../storage/migrate-v1";
import type { StartupOutcome } from "../storage/migrate-v1";
import { WriterLease } from "../storage/writer-lease";

/** Messages between tabs of the same profile (BroadcastChannel "canvast-commits"). */
type TabMessage =
  | { kind: "commit"; canvasId: string; revision: number }
  | { kind: "tree" }
  | { kind: "assets" };

/** Where an asset is used: one row per canvas, named for display. */
export interface AssetPlace {
  boardId: string;
  boardName: string;
  canvasId: string;
  canvasName: string;
  ids: ObjectId[];
}

/** The last full (workspace) backup, stored in meta["backup"]. */
export interface Backlink {
  canvasId: string;
  canvasName: string;
  id: ObjectId;
  label: string;
}

export interface BackupRecord {
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

declare const __CANVAST_VERSION__: string;

/** Fraction of the viewport that revealed instances fill. */
const REVEAL_FILL = 0.6;

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
export class Session {
  current: CurrentMeta | null = null;
  tree: WorkspaceTree | null = null;
  startup: StartupOutcome | null = null;
  readonly persistence: CanvasPersistence;
  readonly lease: WriterLease;
  readonly catalog: AssetCatalog | null;
  /** The last garbage-collection result (diagnostics and tests). */
  lastGc: GcReport | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly assetListeners = new Set<() => void>();
  private switching: Promise<void> | null = null;
  private channel: BroadcastChannel | null = null;
  /** Deleted assets are still retained by roots: collect again when the roots may have shrunk. */
  private gcPending = true;

  constructor(
    readonly repo: WorkspaceRepo | null,
    readonly doc: DocumentStore,
    readonly view: ViewState,
    readonly editor: EditorState,
    readonly assets: AssetLibrary | null = null,
  ) {
    this.persistence = new CanvasPersistence(repo, doc, view);
    this.catalog = repo ? new AssetCatalog(repo.db) : null;
    this.lease = new WriterLease();
    this.lease.subscribe(() => void this.onLease());
    this.persistence.onCommitted = (canvasId, revision) => {
      this.post({ kind: "commit", canvasId, revision });
      this.emitAssets(); // usage counts changed
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

  /** Listen for changes to the asset library or its usage. */
  subscribeAssets(fn: () => void): () => void {
    this.assetListeners.add(fn);
    return () => this.assetListeners.delete(fn);
  }

  private emitAssets(): void {
    for (const fn of this.assetListeners) fn();
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
    this.persistence.setWritable(!this.readOnly);
    this.editor.readOnly = this.readOnly;
    this.startup = await ensureWorkspace(this.repo);
    this.current = this.startup.current;
    await this.refreshTree();
    await this.load(this.current.canvasId);
    if (!this.readOnly && this.catalog) {
      try {
        await this.catalog.reconcile();
        await this.collectGarbage();
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
      this.editor.message = `Skipped ${loaded.skipped.length} damaged item(s) on "${loaded.canvas.name}".`;
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
  gcRoots(): Set<string> {
    const roots = new Set<string>();
    for (const o of this.doc.retainedObjects()) if (o.kind === "image") roots.add(o.assetId);
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
      this.tell(e instanceof AssetInUseError ? `Not deleted: ${e.message}.` : `Could not delete the asset: ${(e as Error).message}`);
      return null;
    }
    this.gcPending = true;
    const report = await this.collectGarbage();
    const erased = !!report?.swept.includes(hash);
    this.tell(erased ? "Deleted from the library. The original was erased." : "Deleted from the library. The original is kept until undo history no longer needs it.");
    this.post({ kind: "assets" });
    this.emitAssets();
    return { erased };
  }

  /**
   * Organize the library (ADR 0011): change an asset's tags, favourite flag or
   * folders, or create, rename and delete folders. Writer only; other tabs
   * refresh. Returns false (with a message) when refused.
   */
  async organize(op: (c: AssetCatalog) => Promise<unknown>): Promise<boolean> {
    if (!this.guardWrite() || !this.catalog) return false;
    try {
      await op(this.catalog);
    } catch (e) {
      this.tell(e instanceof CatalogInputError ? e.message[0]!.toUpperCase() + e.message.slice(1) + "." : `Could not save: ${(e as Error).message}`);
      return false;
    }
    this.post({ kind: "assets" });
    this.emitAssets();
    return true;
  }

  private async assetFileName(hash: string): Promise<string> {
    return (await this.catalog?.entry(hash).catch(() => undefined))?.name ?? "";
  }

  private boardCanvases(): CanvasRecord[] {
    return this.tree?.boards.find((b) => b.board.id === this.current?.boardId)?.canvases ?? [];
  }

  /** Texts and images on the board's other canvases to mention (the picker's second list). */
  async mentionableElsewhere(query: string, limit: number): Promise<Backlink[]> {
    if (!this.repo || !this.current) return [];
    await this.persistence.flush();
    const others = this.boardCanvases().filter((c) => c.id !== this.current!.canvasId);
    const q = query.trim().toLowerCase();
    const hits = await this.repo.findMentionable(new Set(others.map((c) => c.id)), query, limit);
    const out: Backlink[] = [];
    for (const h of hits) {
      if (out.length >= limit) break;
      const label = h.assetId ? (await this.assetFileName(h.assetId)) || h.label : h.label;
      if (h.assetId && !label.toLowerCase().includes(q)) continue;
      out.push({ canvasId: h.canvasId, id: h.id, label, canvasName: others.find((c) => c.id === h.canvasId)!.name });
    }
    return out;
  }

  /** Where objects mentioned by a text are on the board's other canvases; a missing id is not on the board. */
  async locateMentions(ids: readonly ObjectId[]): Promise<Map<ObjectId, Backlink>> {
    const out = new Map<ObjectId, Backlink>();
    if (!this.repo || !this.current) return out;
    await this.persistence.flush();
    const others = this.boardCanvases().filter((c) => c.id !== this.current!.canvasId);
    for (const id of ids) {
      const r = await this.repo.locate(others.map((c) => c.id), id);
      if (!r) continue;
      const d = r.data;
      const label = d["kind"] === "text" ? plainText(String(d["md"]), 28) || "Text" : d["kind"] === "image" ? (await this.assetFileName(String(d["assetId"]))) || `Image ${String(d["pixelW"])}×${String(d["pixelH"])}` : "Stroke";
      out.set(id, { canvasId: r.canvasId, canvasName: others.find((c) => c.id === r.canvasId)!.name, id, label });
    }
    return out;
  }

  /** Texts on the other canvases of this board that mention an object (ADR 0040). */
  async backlinksElsewhere(targetId: ObjectId): Promise<Backlink[]> {
    if (!this.repo || !this.tree || !this.current) return [];
    await this.persistence.flush();
    const canvases = this.boardCanvases();
    const out: Backlink[] = [];
    for (const r of await this.repo.mentionedBy(targetId)) {
      const c = canvases.find((k) => k.id === r.canvasId);
      if (c && c.id !== this.current.canvasId) out.push({ canvasId: c.id, canvasName: c.name, id: r.id, label: plainText(String(r.data["md"])) });
    }
    return out;
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
  async canvasTagIndex(): Promise<Map<string, { label: string; objects: number; canvases: Set<string>; assets: Set<string> }>> {
    const out = new Map<string, { label: string; objects: number; canvases: Set<string>; assets: Set<string> }>();
    if (!this.repo) return out;
    await this.persistence.flush();
    const tx = this.repo.db.transaction("objects", "readonly");
    await new Promise<void>((resolve, reject) => {
      const cur = tx.objectStore("objects").index("tags").openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve();
        const rec = c.value as { canvasId: string; data: { assetId?: string; tags?: string[] } };
        const label = (rec.data.tags ?? []).find((t) => t.toLowerCase() === String(c.key).toLowerCase()) ?? String(c.key);
        const k = String(c.key).toLowerCase();
        const e = out.get(k) ?? { label, objects: 0, canvases: new Set<string>(), assets: new Set<string>() };
        e.objects++;
        e.canvases.add(rec.canvasId);
        if (rec.data.assetId) e.assets.add(rec.data.assetId);
        out.set(k, e);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    return out;
  }

  /** The in-canvas tags carried by instances of one library asset, anywhere in the workspace. */
  async canvasTagsOfAsset(hash: string): Promise<string[]> {
    if (!this.repo) return [];
    await this.persistence.flush();
    const rows = await new Promise<Array<{ data: { tags?: string[] } }>>((resolve, reject) => {
      const r = this.repo!.db.transaction("objects", "readonly").objectStore("objects").index("assetId").getAll(hash);
      r.onsuccess = () => resolve(r.result as Array<{ data: { tags?: string[] } }>);
      r.onerror = () => reject(r.error);
    });
    const seen = new Map<string, string>();
    for (const row of rows) for (const t of row.data.tags ?? []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  /** Place a new instance of a library asset at the centre of the open canvas. */
  async placeAsset(hash: string, withTags = false): Promise<ObjectId | null> {
    if (this.editor.blockEdit() || !this.assets) return null;
    const rec = await this.assets.record(hash);
    if (!rec) {
      this.tell("The original of this asset is missing, so it cannot be placed.");
      return null;
    }
    const tags = withTags ? ((await this.catalog?.entry(hash).catch(() => undefined))?.tags ?? []) : [];
    return placeImage(rec, this.doc, this.view, 0, "Place asset", tags).id;
  }

  /**
   * Place library assets on a chosen canvas: an existing one, a new canvas in a board, or a new board. The canvas is opened first, so
   * the pictures land there; one undo step on that canvas. Returns how many were placed.
   */
  async placeAssetsOn(hashes: readonly string[], target: { canvasId: string } | { newCanvasIn: string } | { newBoard: true }, withTags = false): Promise<number> {
    if (this.editor.blockEdit()) return 0;
    if ("canvasId" in target) await this.openCanvas(target.canvasId);
    else if ("newCanvasIn" in target) await this.newCanvas(target.newCanvasIn);
    else await this.newBoard();
    const n = await this.placeAssets(hashes, withTags);
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
    for (const h of hashes) {
      const rec = await this.assets.record(h);
      if (rec) recs.push(rec);
    }
    if (recs.length < hashes.length) this.tell(`${hashes.length - recs.length} of the originals are missing and were not placed.`);
    if (recs.length === 1) placeImage(recs[0]!, this.doc, this.view, 0, "Place asset", tagsOf.get(recs[0]!.hash) ?? []);
    else if (recs.length > 1) placeImages(recs, this.doc, this.view, `Place ${recs.length} assets`, tagsOf);
    return recs.length;
  }

  /**
   * Delete several assets from the library. Those that instances use are kept; the rest are removed and their originals erased as
   * soon as nothing can need them. One summary is shown. Returns how many were deleted.
   */
  async deleteAssets(hashes: readonly string[]): Promise<number> {
    if (!this.guardWrite() || !this.catalog) return 0;
    await this.persistence.flush();
    const gone: string[] = [];
    let inUse = 0;
    for (const h of hashes) {
      try {
        await this.catalog.markDeleted(h);
        gone.push(h);
      } catch (e) {
        if (e instanceof AssetInUseError) inUse++;
        else {
          this.tell(`Could not delete the asset: ${(e as Error).message}`);
          break;
        }
      }
    }
    if (gone.length) {
      this.gcPending = true;
      await this.collectGarbage();
      this.post({ kind: "assets" });
      this.emitAssets();
    }
    this.tell(`Deleted ${gone.length} asset${gone.length === 1 ? "" : "s"} from the library.${inUse ? ` ${inUse} in use ${inUse === 1 ? "was" : "were"} kept.` : ""}`);
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
  async exportFiles(scope: ExportScope, layout: FilesLayout): Promise<FilesZipResult & { fileName: string }> {
    if (!this.repo || !this.current) throw new Error("storage is unavailable, so there is nothing to export");
    await this.persistence.flush();
    const r = await buildFilesZip(this.repo.db, this.current.workspaceId, scope, layout);
    const tree = this.tree;
    const label =
      scope.kind === "workspace" ? (tree?.workspace.displayName ?? "workspace")
      : scope.kind === "board" ? (tree?.boards.find((b) => b.board.id === scope.boardId)?.board.name ?? "board")
      : scope.kind === "canvas" ? (tree?.boards.flatMap((b) => b.canvases).find((c) => c.id === scope.canvasId)?.name ?? "canvas")
      : "assets";
    const fileName = archiveFileName(`${label}-files`, new Date()).replace(/\.canvast$/, ".zip");
    return { ...r, fileName };
  }

  async exportArchive(scope: ExportScope): Promise<ExportResult & { fileName: string }> {
    if (!this.repo || !this.current) throw new Error("storage is unavailable, so there is nothing to export");
    await this.persistence.flush();
    await this.persistence.saveCamera();
    const version = typeof __CANVAST_VERSION__ === "string" ? __CANVAST_VERSION__ : "dev";
    const r = await buildArchive(this.repo.db, this.current.workspaceId, scope, version);
    const label =
      scope.kind === "workspace" ? r.manifest.workspaceName
      : scope.kind === "assets" ? (r.manifest.assets[0]?.name.replace(/\.[^.]*$/, "") ?? "assets")
      : scope.kind === "board" ? r.manifest.boards[0]!.name
      : `${r.manifest.boards[0]!.name}-${r.manifest.boards[0]!.canvases[0]!.name}`;
    const fileName = archiveFileName(label, new Date(r.manifest.exportedAt));
    if (scope.kind === "workspace" && !this.readOnly) {
      const rec: BackupRecord = {
        at: r.manifest.exportedAt,
        bytes: r.blob.size,
        fileName,
        boards: r.manifest.boards.length,
        canvases: r.canvases,
        objects: r.objects,
        assets: r.manifest.assets.length,
        verified: true,
      };
      const tx = this.repo.db.transaction("meta", "readwrite");
      tx.objectStore("meta").put(rec, "backup");
      await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
    return { ...r, fileName };
  }

  async lastBackup(): Promise<BackupRecord | null> {
    return this.repo ? ((await idbGet<BackupRecord>(this.repo.db, "meta", "backup")) ?? null) : null;
  }

  /** Validate an archive without writing anything. */
  readArchive(file: Blob): Promise<ImportPlan> {
    return readArchive(file);
  }

  /** Write a validated archive into this workspace, then open its first canvas. */
  async applyImport(plan: ImportPlan): Promise<ImportResult | null> {
    if (!this.guardWrite() || !this.current) return null;
    await this.persistence.flush();
    const r = await applyImport(this.repo!.db, this.current.workspaceId, this.current.boardId, plan);
    await this.refreshTree();
    this.post({ kind: "tree" });
    this.post({ kind: "assets" });
    this.emitAssets();
    if (r.firstCanvasId) await this.openCanvas(r.firstCanvasId);
    return r;
  }

  private tell(message: string): void {
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
      this.tell("Read-only: this workspace is open for editing in another tab. Use “Take over” to edit here.");
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
