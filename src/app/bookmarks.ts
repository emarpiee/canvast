import type { Bookmark } from "../storage/bookmarks";
import { MAX_BOOKMARKS, MAX_BOOKMARK_NAME } from "../storage/bookmarks";
import { deserializeFrameCamera, serializeFrameCamera } from "../core/frames";
import { newObjectId } from "../doc/model";
import type { DocumentStore } from "../doc/document-store";
import type { Session } from "./session";
import type { ViewState } from "./view-state";

/**
 * The bookmarks of the open canvas (ADR 0025). They live in the canvas's persistence (so they are saved, kept by frame
 * collection and travel in archives); this is the small API the panel uses.
 */
export class BookmarkList {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly session: Session,
    private readonly view: ViewState,
    private readonly doc: DocumentStore,
  ) {
    session.subscribe(() => this.changed());
  }

  get items(): readonly Bookmark[] {
    return this.session.persistence.bookmarks;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private async set(items: Bookmark[]): Promise<void> {
    await this.session.persistence.saveBookmarks(items);
    this.changed();
  }

  /** Save the current view under the next free "Bookmark n". Returns null when the limit is reached. */
  async add(thumb?: string): Promise<Bookmark | null> {
    if (this.items.length >= MAX_BOOKMARKS) return null;
    const n = this.items.reduce((m, b) => Math.max(m, Number(/^Bookmark (\d+)$/.exec(b.name)?.[1] ?? 0)), 0) + 1;
    const b: Bookmark = { id: newObjectId(), name: `Bookmark ${n}`, view: serializeFrameCamera(this.view.frameCamera), ...(thumb ? { thumb } : {}), at: Date.now() };
    await this.set([...this.items, b]);
    return b;
  }

  async rename(id: string, name: string): Promise<void> {
    const clean = name.trim().slice(0, MAX_BOOKMARK_NAME);
    if (!clean) return;
    await this.set(this.items.map((b) => (b.id === id ? { ...b, name: clean } : b)));
  }

  /** Point a bookmark at the view as it is now, with a new picture (the old one stays when the browser cannot make one). */
  async update(id: string, thumb?: string): Promise<void> {
    const view = serializeFrameCamera(this.view.frameCamera);
    await this.set(this.items.map((b) => (b.id === id ? { ...b, view, ...(thumb ? { thumb } : {}), at: Date.now() } : b)));
  }

  /** Give bookmarks new pictures (by id), keeping their places, names and dates: one write for all. */
  async setThumbs(thumbs: ReadonlyMap<string, string>): Promise<void> {
    if (!thumbs.size) return;
    await this.set(this.items.map((b) => (thumbs.has(b.id) ? { ...b, thumb: thumbs.get(b.id)! } : b)));
  }

  async remove(id: string): Promise<void> {
    await this.set(this.items.filter((b) => b.id !== id));
  }

  /** Go to a bookmark: the camera is set exactly, at any depth. Returns false when its frame is no longer there. */
  go(id: string): boolean {
    const b = this.items.find((x) => x.id === id);
    if (!b) return false;
    try {
      this.view.flyTo(deserializeFrameCamera(this.doc.space, b.view));
      return true;
    } catch {
      return false;
    }
  }
}

/** A small JPEG of the canvas as it is now, or undefined when the browser will not make one. */
export function captureThumb(canvas: HTMLCanvasElement): string | undefined {
  try {
    const w = 128;
    const h = Math.max(1, Math.round((w * canvas.height) / Math.max(1, canvas.width)));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(canvas, 0, 0, w, h);
    const url = c.toDataURL("image/jpeg", 0.6);
    return url.startsWith("data:image/jpeg;base64,") ? url : undefined;
  } catch {
    return undefined;
  }
}
