import type { Dyadic } from "../core/dyadic";
import type { Frame } from "../core/frames";
import { expressExactIn, levelsBetween } from "../core/frames";
import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { CanvasObject, ObjectId } from "../doc/model";
import { pivotOf } from "../doc/model";
import type { LassoFilter } from "../render/hit-test";
import { localToWorld, rotateAbout, scaleAbout, translate } from "../doc/edit-ops";

export type Tool = "select" | "pen" | "lasso" | "hand" | "text";

const EMPTY: ReadonlySet<ObjectId> = new Set();

/**
 * Transient interaction state. Nothing here is part of the document: previews
 * are derived views of authoritative objects and are discarded or turned into
 * a single transaction when the gesture ends.
 */
export type Preview =
  | { kind: "none" }
  /** `dx`, `dy` and `fixed` are in the units of `frame` (ADR 0014); each object gets them in its own frame. */
  | { kind: "move"; ids: readonly ObjectId[]; frame: Frame; dx: Dyadic; dy: Dyadic }
  | { kind: "scale"; ids: readonly ObjectId[]; frame: Frame; fixed: WorldPoint; kx: number; ky: number; keepWidth?: boolean }
  /** Rotate strokes by `delta` (core/angle.ts). `about` null: each stroke about its own centre (a single selection); otherwise a point in `frame`. */
  | { kind: "rotate"; ids: readonly ObjectId[]; frame: Frame; about: WorldPoint | null; delta: number }
  /** A text object open in the editor overlay: hidden on the canvas, which shows the overlay instead. */
  | { kind: "edit"; ids: readonly ObjectId[] };

export interface DraftStroke {
  /** The frame the stroke started in: its points stay there if the camera rebases mid-stroke (ADR 0014). */
  frame: Frame;
  anchor: WorldPoint;
  unit: number;
  points: number[];
  width: number;
  color: string;
}

import type { PenLock } from "../interaction/pen-width";

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
  /** Thickness lock (interaction/pen-width.ts): new strokes keep the same width on the canvas, not on screen. */
  lock: PenLock | null = null;
  /** Snapping while moving (interaction/snap.ts). */
  snap = true;
  /** Guide lines (screen px) shown while a move is snapped to something. */
  guides: { x?: number; y?: number } | null = null;
  /** Select tool: ignore an object that fills the whole view (zoomed far into it), so it cannot be picked or deleted by accident. */
  ignoreFilling = false;
  /** Pen stabilizer (interaction/stabilizer.ts): on/off and strength 0–100. */
  stabilizer = { on: false, strength: 50 };
  preview: Preview = { kind: "none" };
  draft: DraftStroke | null = null;
  /** Earlier pieces of the stroke being drawn (pen size follows zoom): finished pieces, committed with `draft` in one step. */
  draftDone: DraftStroke[] = [];
  /** While drawing, keep the pen's size on screen when the zoom changes (the stroke is made of pieces of different widths). */
  followZoom = false;
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
    if (p.kind === "move" && p.ids.includes(o.id)) {
      // A displacement only scales between frames: exact shift.
      const L = levelsBetween(o.frame ?? p.frame.space.world, p.frame);
      return translate(o, D.shift(p.dx, -L), D.shift(p.dy, -L));
    }
    if (p.kind === "rotate" && p.ids.includes(o.id)) {
      const pv = pivotOf(o);
      const f = o.frame ?? p.frame.space.world;
      const about = p.about === null ? localToWorld(o, pv.x, pv.y) : f === p.frame ? p.about : expressExactIn(f.space, p.frame, p.about, f);
      return rotateAbout(o, about, p.delta);
    }
    if (p.kind === "scale" && p.ids.includes(o.id)) {
      const f = o.frame ?? p.frame.space.world;
      const fixed = f === p.frame ? p.fixed : expressExactIn(f.space, p.frame, p.fixed, f);
      return scaleAbout(o, fixed, p.kx, o.kind === "image" ? p.ky : p.kx, p.keepWidth);
    }
    return o;
  }
}
