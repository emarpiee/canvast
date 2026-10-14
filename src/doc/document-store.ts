import { FrameSpace } from "../core/frames";
import type { CanvasObject, ObjectId } from "./model";
import { homeObject, validateObject, worldForm } from "./model";

/**
 * The authoritative document: a set of canvas objects keyed by stable id.
 *
 * Lifecycle: input → transient preview (never stored here) → transaction →
 * validation → atomic mutation → listeners (index/render/persistence).
 *
 * A transaction is a patch of before/after states per object id (null =
 * absent). Undo applies the before states, so it is exact and never relies on
 * re-deriving geometry.
 */
export interface Transaction {
  readonly label: string;
  readonly before: ReadonlyMap<ObjectId, CanvasObject | null>;
  readonly after: ReadonlyMap<ObjectId, CanvasObject | null>;
}

export type ChangeSource = "do" | "undo" | "redo" | "load";

/** Ids whose state changed, or null when the whole document was replaced. */
export type ChangedIds = ReadonlySet<ObjectId> | null;

const HISTORY_LIMIT = 500;

export class DocumentStore {
  private readonly objects = new Map<ObjectId, CanvasObject>();
  private readonly undoStack: Transaction[] = [];
  private readonly redoStack: Transaction[] = [];
  private readonly listeners = new Set<(source: ChangeSource, changed: ChangedIds) => void>();
  private sortedCache: CanvasObject[] | null = null;
  revision = 0;
  /** Coordinate frames of this document's objects (ADR 0014); replaced on load. */
  space = new FrameSpace();

  get(id: ObjectId): CanvasObject | undefined {
    return this.objects.get(id);
  }

  get size(): number {
    return this.objects.size;
  }

  /** Objects in paint order (ascending z, id as tie-breaker). */
  ordered(): readonly CanvasObject[] {
    if (!this.sortedCache) {
      this.sortedCache = [...this.objects.values()].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    }
    return this.sortedCache;
  }

  topZ(): number {
    const o = this.ordered();
    return o.length ? o[o.length - 1]!.z : 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribe(fn: (source: ChangeSource, changed: ChangedIds) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Build a transaction that replaces/creates `next` objects and deletes `removed` ids. */
  transaction(label: string, next: readonly CanvasObject[], removed: readonly ObjectId[] = []): Transaction {
    const before = new Map<ObjectId, CanvasObject | null>();
    const after = new Map<ObjectId, CanvasObject | null>();
    for (const o of next) {
      before.set(o.id, this.objects.get(o.id) ?? null);
      after.set(o.id, o);
    }
    for (const id of removed) {
      before.set(id, this.objects.get(id) ?? null);
      after.set(id, null);
    }
    return { label, before, after };
  }

  /** Validate and apply a transaction atomically, recording it for undo. */
  commit(tx: Transaction): void {
    if (tx.after.size === 0) return;
    this.applyStates(tx.after, tx.before);
    this.undoStack.push(tx);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit("do", new Set(tx.after.keys()));
  }

  undo(): Transaction | null {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    this.applyStates(tx.before, tx.after);
    this.redoStack.push(tx);
    this.emit("undo", new Set(tx.before.keys()));
    return tx;
  }

  redo(): Transaction | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    this.applyStates(tx.after, tx.before);
    this.undoStack.push(tx);
    this.emit("redo", new Set(tx.after.keys()));
    return tx;
  }

  /**
   * Replace the whole document (snapshot load), each object in the frame that suits it. Clears history.
   * `space`: the frames the objects were stored in (they keep them); without it a new tree is made and
   * objects in world-frame (absolute) form are re-expressed exactly.
   */
  load(objects: readonly CanvasObject[], space?: FrameSpace): void {
    for (const o of objects) validateObject(o);
    this.space = space ?? new FrameSpace();
    this.objects.clear();
    for (const o of objects) this.objects.set(o.id, homeObject(o.frame && o.frame.space !== this.space ? worldForm(o) : o, this.space));
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit("load", null);
  }

  private applyStates(
    target: ReadonlyMap<ObjectId, CanvasObject | null>,
    expected: ReadonlyMap<ObjectId, CanvasObject | null>,
  ): void {
    // Validate everything first so a bad state never half-applies.
    for (const [id, o] of target) {
      if (o) {
        if (o.id !== id) throw new Error(`transaction id mismatch ${id}`);
        validateObject(o);
      }
      const current = this.objects.get(id) ?? null;
      if (current !== expected.get(id)) throw new Error(`stale transaction for ${id}`);
    }
    for (const [id, o] of target) {
      if (o) this.objects.set(id, o);
      else this.objects.delete(id);
    }
  }

  /**
   * Every object state the document can still return to without storage:
   * the current objects plus all states held by undo and redo. These are the
   * live roots for asset garbage collection.
   */
  *retainedObjects(): IterableIterator<CanvasObject> {
    yield* this.objects.values();
    for (const tx of [...this.undoStack, ...this.redoStack]) {
      for (const o of tx.before.values()) if (o) yield o;
      for (const o of tx.after.values()) if (o) yield o;
    }
  }

  /** All objects, unordered. */
  all(): IterableIterator<CanvasObject> {
    return this.objects.values();
  }

  private emit(source: ChangeSource, changed: ChangedIds): void {
    this.revision++;
    this.sortedCache = null;
    for (const fn of this.listeners) fn(source, changed);
  }
}
