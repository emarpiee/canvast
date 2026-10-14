import type { Frame, FrameRecord, FrameSpace } from "../core/frames";
import { serializeFrameCamera } from "../core/frames";
import type { ViewState } from "../app/view-state";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ObjectId } from "../doc/model";
import type { Bookmark } from "./bookmarks";
import type { CommitResult } from "./workspace-repo";
import { RevisionConflictError, WorkspaceRepo } from "./workspace-repo";

/**
 * Saves the active canvas incrementally (ADR 0006).
 *
 * Each document transaction marks the ids it changed. After a short debounce
 * the queued ids are written in **one** IndexedDB transaction that checks and
 * bumps the canvas revision. Transient previews never reach the document, so
 * they are never saved.
 *
 * Save states (shown in the HUD; nothing is called saved before it is):
 *   queued     changes exist that have not been written yet
 *   saving     a commit transaction is in flight
 *   committed  the transaction completed (durability "strict")
 *   verified   the canvas revision was read back and matches the commit
 *   readonly   another tab holds the writer lease; changes are not written
 *   conflict   the stored revision moved on (another writer); saving stopped
 *   error      the commit failed (quota, storage cleared, ...); changes stay queued
 *   unavailable  no storage in this context; work is in memory only
 */
export type SaveState = "verified" | "committed" | "queued" | "saving" | "readonly" | "conflict" | "error" | "unavailable";

const DEBOUNCE_MS = 150;
/** Collect unreferenced frame records once this many were written since the last collection. */
const GC_AFTER = 200;
const CAMERA_DEBOUNCE_MS = 600;

/** What a stored frame says (to find the ones that changed: a dive can be split, a new root added). */
const signature = (r: FrameRecord): string => `${r.parent}|${r.n}|${r.ox}|${r.oy}|${r.level}`;

export class CanvasPersistence {
  state: SaveState;
  lastError = "";
  lastCommit: (CommitResult & { at: number }) | null = null;
  lastVerifiedAt: number | null = null;
  canvasId: string | null = null;
  revision = 0;
  private readonly dirty = new Set<ObjectId>();
  /** Frame records as last written (or loaded), by frame id: only changed ones are written again. */
  private stored = new Map<string, string>();
  private space: FrameSpace | null = null;
  /** Frame records written since the last clean-up of frames nothing refers to. */
  private written = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private camTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private writable = true;
  private readonly listeners = new Set<() => void>();
  /** This canvas's bookmarks (ADR 0025); their frames are kept like the view's. */
  bookmarks: Bookmark[] = [];
  /** Called after each verified commit (used to notify read-only tabs). */
  onCommitted: ((canvasId: string, revision: number) => void) | null = null;

  constructor(
    private readonly repo: WorkspaceRepo | null,
    private readonly doc: DocumentStore,
    private readonly view: ViewState,
  ) {
    this.state = repo ? "verified" : "unavailable";
    doc.subscribe((source, changed) => {
      if (source === "load" || !changed || !this.repo) return;
      for (const id of changed) this.dirty.add(id);
      this.setState(this.writable ? "queued" : "readonly");
      this.schedule();
    });
    view.subscribe(() => {
      if (!this.repo || !this.canvasId || !this.writable) return;
      if (this.camTimer) clearTimeout(this.camTimer);
      this.camTimer = setTimeout(() => void this.saveCamera(), CAMERA_DEBOUNCE_MS);
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Bind to a freshly loaded canvas. Pending changes must be flushed first. */
  attach(canvasId: string, revision: number, space: FrameSpace, bookmarks: Bookmark[] = []): void {
    this.bookmarks = bookmarks;
    this.canvasId = canvasId;
    this.revision = revision;
    this.dirty.clear();
    // Frames just loaded are as stored.
    this.space = space;
    this.stored = new Map(space.records([...walk(space.root)]).map((r) => [r.id, signature(r)]));
    this.written = 0;
    if (this.state !== "unavailable") this.setState(this.writable ? "verified" : "readonly");
  }

  /** Writer lease changed. Read-only tabs keep changes queued but never write. */
  setWritable(writable: boolean): void {
    this.writable = writable;
    if (this.state === "unavailable" || this.state === "conflict") return;
    if (!writable) this.setState("readonly");
    else if (this.dirty.size) {
      this.setState("queued");
      this.schedule();
    } else this.setState("verified");
  }

  get pendingCount(): number {
    return this.dirty.size;
  }

  private schedule(): void {
    if (!this.writable) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Write all queued changes now. Resolves when committed and verified (or failed). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight) await this.inFlight;
    if (!this.repo || !this.canvasId || !this.writable || this.state === "conflict" || this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    const puts: CanvasObject[] = [];
    const deletes: ObjectId[] = [];
    for (const id of ids) {
      const o = this.doc.get(id);
      if (o) puts.push(o);
      else deletes.push(id);
    }
    const frames = this.changedFrames(puts.map((o) => o.frame ?? this.doc.space.world));
    const canvasId = this.canvasId;
    this.setState("saving");
    this.inFlight = (async () => {
      try {
        const result = await this.repo!.commit(canvasId, this.revision, puts, deletes, frames);
        if (canvasId !== this.canvasId) return; // switched canvases meanwhile
        for (const r of frames) this.stored.set(r.id, signature(r));
        this.written += frames.length;
        this.revision = result.revision;
        this.lastCommit = { ...result, at: Date.now() };
        this.lastError = "";
        this.setState("committed");
        // Verify: the stored revision must be the one we just committed.
        const stored = await this.repo!.revision(canvasId);
        if (stored === result.revision) {
          this.lastVerifiedAt = Date.now();
          this.onCommitted?.(canvasId, result.revision);
          if (this.dirty.size === 0) this.setState("verified");
        } else {
          throw new RevisionConflictError(canvasId, result.revision, stored ?? -1);
        }
      } catch (e) {
        if (e instanceof RevisionConflictError) {
          this.lastError = e.message;
          this.setState("conflict");
        } else {
          // Keep the changes queued so a later attempt can still save them.
          for (const id of ids) this.dirty.add(id);
          this.lastError = e instanceof Error ? e.message : String(e);
          this.setState("error");
        }
      } finally {
        this.inFlight = null;
      }
    })();
    await this.inFlight;
    // The commit may have changed the state (TypeScript cannot see that across the await).
    const after = this.state as SaveState;
    if (this.dirty.size && after !== "conflict" && after !== "error") await this.flush();
  }

  /** Records of the given frames (with their ancestors and the world chain) that are not stored as they are now. */
  private changedFrames(frames: Iterable<Frame>): FrameRecord[] {
    const space = this.doc.space;
    if (space !== this.space) return [];
    return space.records(frames).filter((r) => this.stored.get(r.id) !== signature(r));
  }

  /** Stored frames that no object, the view or the world frame's chain needs. */
  private unreferenced(view: Frame): string[] {
    const keep = new Set(this.doc.space.records([view, ...this.bookmarkFrames(), ...[...this.doc.all()].flatMap((o) => (o.frame ? [o.frame] : []))]).map((r) => r.id));
    return [...this.stored.keys()].filter((id) => !keep.has(id));
  }

  private bookmarkFrames(): Frame[] {
    return this.bookmarks.flatMap((b) => this.doc.space.frameByUid(b.view.frame) ?? []);
  }

  /** Replace this canvas's bookmarks and save them (with the frames they need). Resolves when stored. */
  async saveBookmarks(items: Bookmark[]): Promise<void> {
    this.bookmarks = items;
    if (!this.repo || !this.canvasId || !this.writable || this.doc.space !== this.space) return;
    try {
      const frames = this.changedFrames(this.bookmarkFrames());
      await this.repo.saveBookmarks(this.canvasId, items, frames);
      for (const r of frames) this.stored.set(r.id, signature(r));
      this.written += frames.length;
    } catch {
      // A failed save of bookmarks is reported by the panel's own state on the next change.
    }
  }

  /** `collect`: clean up unreferenced frames now (tests); otherwise only after GC_AFTER frames were written. */
  async saveCamera(collect = false): Promise<void> {
    if (!this.repo || !this.canvasId || !this.writable) return;
    const fc = this.view.frameCamera;
    if (fc.f.space !== this.space) return; // a canvas is loading
    try {
      const frames = this.changedFrames([fc.f]);
      // Frames of paths the camera has left (and of deleted objects) pile up; collect them with the view, once things are saved.
      const idle = this.dirty.size === 0 && !this.inFlight;
      const gc = idle && (collect || this.written + frames.length >= GC_AFTER);
      const dead = gc ? this.unreferenced(fc.f) : [];
      await this.repo.saveCamera(this.canvasId, serializeFrameCamera(fc), frames, dead);
      for (const r of frames) this.stored.set(r.id, signature(r));
      for (const id of dead) this.stored.delete(id);
      this.written = gc ? 0 : this.written + frames.length;
    } catch {
      // View state is a convenience; object saves report their own errors.
    }
  }

  private setState(s: SaveState): void {
    if (s === this.state) return;
    this.state = s;
    for (const fn of this.listeners) fn();
  }
}

/** Every frame of a tree (root first; iterative: paths can be thousands of frames long). */
function* walk(root: Frame): Generator<Frame> {
  const todo = [root];
  for (let f = todo.pop(); f; f = todo.pop()) {
    yield f;
    todo.push(...f.kids.values());
  }
}
