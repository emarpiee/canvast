import type { Dyadic } from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { CanvasObject, ObjectId } from "../doc/model";
import type { LassoFilter } from "../render/hit-test";
import { scaleAbout, translate } from "../doc/edit-ops";

export type Tool = "select" | "pen" | "lasso" | "hand" | "text";

const EMPTY: ReadonlySet<ObjectId> = new Set();

/**
 * Transient interaction state. Nothing here is part of the document: previews
 * are derived views of authoritative objects and are discarded or turned into
 * a single transaction when the gesture ends.
 */
export type Preview =
  | { kind: "none" }
  | { kind: "move"; ids: readonly ObjectId[]; dx: Dyadic; dy: Dyadic }
  | { kind: "scale"; ids: readonly ObjectId[]; fixed: WorldPoint; kx: number; ky: number }
  /** A text object open in the editor overlay: hidden on the canvas, which shows the overlay instead. */
  | { kind: "edit"; ids: readonly ObjectId[] };

export interface DraftStroke {
  anchor: WorldPoint;
  unit: number;
  points: number[];
  width: number;
  color: string;
}

export const PEN_COLORS = ["#1f2329", "#2563eb", "#dc2626", "#16a34a"] as const;
/** Pen widths in CSS px at the zoom level where the stroke is drawn. */
export const PEN_WIDTHS = [1.5, 3, 8] as const;

export class EditorState {
  tool: Tool = "select";
  /** Tool restored when a temporary hand (space) ends. */
  heldTool: Tool | null = null;
  selection = new Set<ObjectId>();
  lassoFilter: LassoFilter = "strokes";
  penColor: string = PEN_COLORS[0];
  penWidthPx: number = PEN_WIDTHS[1];
  preview: Preview = { kind: "none" };
  draft: DraftStroke | null = null;
  /** Screen-space lasso polygon or marquee rectangle while dragging. */
  lasso: number[] | null = null;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  message = "";
  /** Another tab holds the writer lease: navigation and selection only. */
  readOnly = false;
  private readonly listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Returns true (and tells the user) when an edit must not happen. */
  blockEdit(): boolean {
    if (!this.readOnly) return false;
    this.message = "Read-only: this workspace is open for editing in another tab. Use “Take over” to edit here.";
    this.changed();
    return true;
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.heldTool = null;
    this.changed();
  }

  select(ids: Iterable<ObjectId>, additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.changed();
  }

  /** Ids of objects whose displayed state differs from the document (empty when idle). */
  previewIds(): ReadonlySet<ObjectId> {
    const p = this.preview;
    return p.kind === "none" ? EMPTY : new Set(p.ids);
  }

  /** Apply the active preview to an object (identity when not affected; null when hidden). */
  previewed(o: CanvasObject): CanvasObject | null {
    const p = this.preview;
    if (p.kind === "edit" && p.ids.includes(o.id)) return null;
    if (p.kind === "move" && p.ids.includes(o.id)) return translate(o, p.dx, p.dy);
    if (p.kind === "scale" && p.ids.includes(o.id)) {
      return scaleAbout(o, p.fixed, p.kx, o.kind === "image" ? p.ky : p.kx);
    }
    return o;
  }
}
