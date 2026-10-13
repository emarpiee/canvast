import { serializeCamera } from "../core/camera";
import { depthOf, levelsBetween } from "../core/frames";
import { MAX_WORLD_FORM_LEVELS } from "../doc/model";
import type { ViewState } from "../app/view-state";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ObjectId } from "../doc/model";
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
const CAMERA_DEBOUNCE_MS = 600;

export class CanvasPersistence {
  state: SaveState;
  lastError = "";
  lastCommit: (CommitResult & { at: number }) | null = null;
  lastVerifiedAt: number | null = null;
  canvasId: string | null = null;
  revision = 0;
  private readonly dirty = new Set<ObjectId>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private camTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private writable = true;
  private readonly listeners = new Set<() => void>();
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
  attach(canvasId: string, revision: number): void {
    this.canvasId = canvasId;
    this.revision = revision;
    this.dirty.clear();
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
    // shortcut: objects deeper than 2^24 levels cannot be stored until storage holds frames (plan step 4); they stay queued, the rest is saved.
    const waiting: ObjectId[] = [];
    for (const id of ids) {
      const o = this.doc.get(id);
      if (o && o.frame && Math.abs(levelsBetween(o.frame.space.world, o.frame)) > MAX_WORLD_FORM_LEVELS) waiting.push(id);
      else if (o) puts.push(o);
      else deletes.push(id);
    }
    if (!puts.length && !deletes.length) {
      for (const id of waiting) this.dirty.add(id);
      this.lastError = `${waiting.length} object(s) deeper than 2^24 levels are not saved yet (needs the storage update)`;
      this.setState("error");
      return;
    }
    const canvasId = this.canvasId;
    this.setState("saving");
    this.inFlight = (async () => {
      try {
        const result = await this.repo!.commit(canvasId, this.revision, puts, deletes);
        if (canvasId !== this.canvasId) return; // switched canvases meanwhile
        this.revision = result.revision;
        this.lastCommit = { ...result, at: Date.now() };
        this.lastError = "";
        this.setState("committed");
        // Verify: the stored revision must be the one we just committed.
        const stored = await this.repo!.revision(canvasId);
        if (stored === result.revision) {
          this.lastVerifiedAt = Date.now();
          this.onCommitted?.(canvasId, result.revision);
          if (waiting.length) {
            for (const id of waiting) this.dirty.add(id);
            this.lastError = `${waiting.length} object(s) deeper than 2^24 levels are not saved yet (needs the storage update)`;
            this.setState("error");
          } else if (this.dirty.size === 0) this.setState("verified");
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

  async saveCamera(): Promise<void> {
    if (!this.repo || !this.canvasId || !this.writable) return;
    // shortcut: the saved view is absolute until storage holds frames (plan step 4); deeper than 2^24 levels it would be a huge number, so the last view saved is kept.
    const depth = depthOf(this.view.frameCamera).levels;
    if (depth > 2n ** 24n || depth < -(2n ** 24n)) return;
    try {
      await this.repo.saveCamera(this.canvasId, serializeCamera(this.view.worldCamera()));
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
