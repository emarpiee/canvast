import type { Dyadic } from "../core/dyadic";
import type { Frame } from "../core/frames";
import { expressExactIn, levelsBetween } from "../core/frames";
import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { CanvasObject, ObjectId, PathObject } from "../doc/model";
import { pivotOf } from "../doc/model";
import type { LassoFilter } from "../render/hit-test";
import { localToWorld, rotateAbout, scaleAbout, translate } from "../doc/edit-ops";
import type { ShapeKind, SubPath } from "../doc/path";
import { roundCorners } from "../doc/rounding";
import type { Paint } from "../doc/paint";
import type { AlignChoice, CapChoice, DashChoice, JoinChoice } from "../doc/stroke-look";

export type Tool = "select" | "pen" | "lasso" | "hand" | "text" | "note" | "eraser" | "shape" | "path" | "node" | "sheet";

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
  | { kind: "scale"; ids: readonly ObjectId[]; frame: Frame; fixed: WorldPoint; kx: number; ky: number; keepWidth?: boolean; keepRadius?: boolean }
  /** Rotate strokes by `delta` (core/angle.ts). `about` null: each stroke about its own centre (a single selection); otherwise a point in `frame`. */
  | { kind: "rotate"; ids: readonly ObjectId[]; frame: Frame; about: WorldPoint | null; delta: number }
  /** A text object open in the editor overlay: hidden on the canvas, which shows the overlay instead. */
  | { kind: "edit"; ids: readonly ObjectId[] }
  /** Nodes of one path being dragged (ADR 0099): the path as it would be (a turned path is baked, so `rot` goes). */
  | { kind: "nodes"; ids: readonly ObjectId[]; sub: readonly SubPath[]; /** Several paths at once (nodes picked together): each path's own sub-paths; `sub` is then unused. */ subs?: ReadonlyMap<ObjectId, readonly SubPath[]> }
  /** The fill and/or outline of paths being changed in the colour picker (ADR 0099); committed once when the picker settles. */
  | { kind: "paint"; ids: readonly ObjectId[]; fill?: Paint | null; stroke?: Paint | null }
  /** Objects shown as they would be after a change being dragged (a corner radius, a star's ratio): replaced whole, stored once when it ends. */
  | { kind: "replace"; ids: readonly ObjectId[]; objs: ReadonlyMap<ObjectId, CanvasObject> };

/** The Shape builder at work (ADR 0145): the regions the picked shapes overlap in, drawn instead of the shapes, and what the person has done with them so far. */
export interface ShapeBuilderState {
  readonly faces: ReadonlyArray<{ readonly inside: readonly number[]; readonly obj: PathObject }>;
  /** The shapes the regions came from (hidden while it is open, replaced when it is finished). */
  readonly srcIds: readonly ObjectId[];
  readonly world: Frame;
  /** Groups of regions (indices) to be united into one shape each. */
  merged: number[][];
  deleted: Set<number>;
  hover: number | null;
  /** The regions the pointer has crossed in the stroke being made, and whether it removes them (Alt) instead of merging. */
  touched: number[];
  removing: boolean;
}

/** A shape being dragged out (the Shape tool): its box in local units of its own anchor, like a stroke's draft. */
export interface DraftShape {
  frame: Frame;
  anchor: WorldPoint;
  unit: number;
  kind: ShapeKind;
  /** Box (kinds but a line) or the line's two ends (x, y, x + w, y + h), local. */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  sides: number;
  tips: number;
  fill: Paint | null;
  stroke: Paint | null;
  /** Outline width in local units. */
  width: number;
}

/** A Bézier path being built, node by node (the Path tool). */
export interface DraftPath {
  frame: Frame;
  anchor: WorldPoint;
  unit: number;
  /** Nodes so far, six numbers each (doc/path.ts), local. */
  n: number[];
  /** The pointer, local, for the line that follows it (null until it moves). */
  cursor: { x: number; y: number } | null;
  fill: Paint | null;
  stroke: Paint | null;
  width: number;
}

export interface DraftStroke {
  /** The frame the stroke started in: its points stay there if the camera rebases mid-stroke (ADR 0014). */
  frame: Frame;
  anchor: WorldPoint;
  unit: number;
  points: number[];
  width: number;
  color: string;
  /** The pen drawing it (interaction/pens.ts), and the extra per-point input that pen may use. */
  kind: PenKind;
  pressure?: number[];
  /** Per point when the pen leans (ADR 0113): how far, 0..1, and which way (radians). */
  tilt?: number[];
  tiltAz?: number[];
  speed?: number[];
}

import type { PenLock } from "../interaction/pen-width";
import type { PenKind } from "../interaction/pens";
import type { SelectionFrame } from "../render/selection-frame";
import type { TextLook } from "../text/text-style";

export const PEN_COLORS = ["#1f2329", "#2563eb", "#dc2626", "#16a34a"] as const;
/** Pen widths in CSS px at the zoom level where the stroke is drawn. */
export const PEN_WIDTHS = [1.5, 3, 8] as const;

export class EditorState {
  tool: Tool = "select";
  /** Tool restored when a temporary hand (space) ends. */
  heldTool: Tool | null = null;
  selection = new Set<ObjectId>();
  /** The kind of picked item the Properties bar shows when the selection mixes kinds (a chip chooses it; ADR 0128). */
  subject: string | null = null;
  lassoFilter: LassoFilter = "strokes";
  penColor: string = PEN_COLORS[0];
  /** What the Text tool makes (ADR 0126): the look of the next text; a colour left out is the pen colour. */
  textLook: TextLook = {};
  penWidthPx: number = PEN_WIDTHS[1];
  /** Which pen draws (interaction/pens.ts). */
  penKind: PenKind = "fine";
  /** Thickness lock (interaction/pen-width.ts): new strokes keep the same width on the canvas, not on screen. */
  lock: PenLock | null = null;
  /** The floating Layers panel is open (ui/layers-panel.ts). */
  layersOpen = false;
  /** The floating Bookmarks panel is open (ui/bookmarks-panel.ts). */
  bookmarksOpen = false;
  /** The Tags panel is shown (ADR 0076). */
  tagsOpen = false;
  /** The Styles panel is shown (ui/styles-panel.ts). */
  stylesOpen = false;
  /** The Adjust panel is shown (ui/adjust-panel.ts). */
  adjustOpen = false;
  /** Groups the user has entered (ids, outermost first): clicks select inside them (doc/groups.ts). */
  entered: string[] = [];
  /** Object eraser (ADR 0022): brush diameter (CSS px) and whether a swipe takes a whole group or only the members it touches. */
  eraserPx = 16;
  eraseWholeGroups = true;
  /** The eraser cuts parts out of strokes instead of taking whole objects (ADR 0111). */
  eraseParts = false;
  /** While the eraser is active: the brush position, and the boxes of what the swipe has touched so far. */
  eraser: { at: { x: number; y: number } | null; boxes: Array<{ minX: number; minY: number; maxX: number; maxY: number }> } | null = null;
  /** The selection box and rotate handle as last drawn (for the pointer hover; null when nothing is selected). */
  selectionBoxOnScreen: { frame: SelectionFrame; handle: readonly [number, number]; rotatable: boolean } | null = null;
  /** The selection box stays axis-aligned even when the selected objects are turned (otherwise it turns with them). */
  alignBox = false;
  /** Snapping while moving (interaction/snap.ts). */
  snap = true;
  /** Guide lines (screen px) shown while a move is snapped to something. */
  guides: { x?: number; y?: number } | null = null;
  /** Select tool: ignore an object that fills the whole view (zoomed far into it), so it cannot be picked or deleted by accident. */
  ignoreFilling = false;
  /** The Shape and Path tools (ADR 0099): what they make. Fill and outline null: none. */
  shapeKind: ShapeKind = "rect";
  shapeFill: Paint | null = "#2563eb";
  shapeStroke: Paint | null = "#1f2329";
  shapeWidthPx = 2;
  /** Resizing keeps the corner radius its size (off: the radius scales with the shape, so it keeps its look). */
  lockRadius = false;
  /** Resizing a sheet scales what is on it too (all of it grows with the sheet), whatever its pins say. */
  /** Which paint's gradient the canvas handles belong to when both the fill and the outline have one (the last chip opened). */
  /** The shape whose corner radius dots are opened out to one per corner (a double-click or long press on the main dot); closes when another is picked. */
  /** Shapes lit up on the canvas while the pointer is on a colour that they use (Selection colours). */
  highlight: ReadonlySet<ObjectId> | null = null;
  /** The resize handles of the selection box as last drawn (screen px): the corners, then the middles of the sides when they fit. */
  drawnHandles: Array<[number, number]> = [];
  /** A few words beside a handle that is being dragged ("Radius 12", "Count 8"). */
  handleLabel: { x: number; y: number; text: string; /** The line the handle slides along (screen px), drawn with it. */ guide?: { x0: number; y0: number; x1: number; y1: number } | null } | null = null;
  cornersOpen: ObjectId | null = null;
  gradientFocus: "fill" | "stroke" | null = null;
  /** The outline's corners, ends and place on the edge for the next shape (null join: the tool's own, sharp for shapes with corners). */
  shapeJoin: JoinChoice | null = null;
  shapeCap: CapChoice = "round";
  shapeAlign: AlignChoice = "centre";
  shapeDash: DashChoice = "solid";
  shapeSides = 6;
  shapeTips = 5;
  /** Waiting for a click on the object to attach the picked ones to (ADR 0109). */
  attachMode = false;
  /** The Shape builder, while it is open; null otherwise. */
  builder: ShapeBuilderState | null = null;
  /** Painting a brush mask (ADR 0144): the groups new pen strokes join (the masked group and the mask group) and their colour (white shows, black hides); null when not painting. */
  maskEdit: { groups: readonly [string, string]; ink: string } | null = null;
  /** The picture whose crop is being changed (ADR 0118): its box handles move its window instead of its size. */
  cropId: ObjectId | null = null;
  shapeDraft: DraftShape | null = null;
  pathDraft: DraftPath | null = null;
  /** The node being edited (Edit nodes tool): sub-path and node index of the one selected path. */
  nodeSel: { s: number; k: number } | null = null;
  /** The nodes picked together by Shift-click or a lasso in Edit nodes (ADR 0145), per path, as "sub-path:node" keys; they move and are deleted as one. Empty: the single node `nodeSel`, if any, is what is edited. */
  nodeMulti: Map<ObjectId, Set<string>> = new Map();
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
  /** A short message for the user; the notice stack (ui/notices.ts) takes it and shows it. */
  message = "";
  /** Ctrl held and the pointer over the canvas on Select: where, so everything under it shows its outline (set by the tools, drawn with the overlays). */
  revealAt: { x: number; y: number } | null = null;
  /** A clipping mask (a sheet) that has been gone into by a double click: what is on it is picked one by one, as in an entered group. */
  openMask: string | null = null;
  /** Where the pointer is on the canvas (CSS px from its corner), or null when it is elsewhere: pasted things land there. Not a change: nothing redraws for it. */
  pointerAt: { x: number; y: number } | null = null;
  /** A button for the notice that takes `message` (its label and what it does); the notice stack takes it with the message. */
  messageAction: { label: string; run(): void } | null = null;
  /** Work that has finished: the progress notices of these channels ("import", "index") are closed (ui/notices.ts). */
  readonly progressDone = new Set<string>();
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
    this.eraser = null;
    this.heldTool = null;
    this.nodeMulti.clear();
    this.changed();
  }

  select(ids: Iterable<ObjectId>, additive = false): void {
    if (!additive) this.selection.clear();
    this.nodeSel = null;
    this.nodeMulti.clear();
    for (const id of ids) this.selection.add(id);
    if (!this.selection.size) this.openMask = null; // (nothing picked: no mask is gone into)
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
    if (p.kind === "replace") return p.objs.get(o.id) ?? o;
    if (p.kind === "paint" && p.ids.includes(o.id) && o.kind === "path") {
      return { ...o, ...(p.fill !== undefined ? { fill: p.fill } : {}), ...(p.stroke !== undefined ? { stroke: p.stroke } : {}) };
    }
    if (p.kind === "nodes" && p.ids.includes(o.id) && o.kind === "path") {
      const { rot: _turned, ...flat } = o;
      const sub = p.subs?.get(o.id) ?? p.sub;
      return o.base && o.radius !== undefined ? { ...flat, base: sub, sub: roundCorners(sub, o.radius, o.smoothing) } : { ...flat, sub };
    }
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
      return scaleAbout(o, fixed, p.kx, o.kind === "image" || o.kind === "path" ? p.ky : p.kx, p.keepWidth, p.keepRadius);
    }
    return o;
  }
}
