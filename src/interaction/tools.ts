import { lookFromChoices } from "../doc/stroke-look";
import type { NavDir } from "./item-navigation";
import { canvasShortcutsActive } from "./shortcut-scope";
import * as D from "../core/dyadic";
import type { ScreenPoint, WorldPoint } from "../core/camera";
import { screenToWorld } from "../core/camera";
import type { ViewState } from "../app/view-state";
import type { EditorState, Tool } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ObjectId, PathObject, StrokeObject, TextObject } from "../doc/model";
import { editSubs, homeObject, newObjectId } from "../doc/model";
import type { Paint } from "../doc/paint";
import type { ShapeKind, SubPath } from "../doc/path";
import { NODE, SHAPE_NAMES, lineSubs, moveHandle, moveNode, nodeCount, drawnParams, drawnSubs, splitSegment, toggleSmooth, withNode } from "../doc/path";
import { nodesIn, roundCorners } from "../doc/rounding";
import { cornerHandles, hitCornerHandle, gradientHandles, hitGradient, hitNodes, isSmoothNode, localOf, moveGradientHandle } from "./path-edit";
import type { GradHandle } from "./path-edit";
import type { Gradient } from "../doc/paint";
import type { Frame } from "../core/frames";
import { depthOf, expressExactIn } from "../core/frames";
import { penWidthNow } from "./pen-width";
import { ropeFor, ropeStep } from "./stabilizer";
import { expandStroke } from "./pens";
import { normalizeUnit, worldBounds } from "../doc/edit-ops";
import { bestSnap } from "./snap";
import { visibleObjects } from "../render/scene-view";
import type { FrameIndex } from "../scene/frame-index";
import { boxSelect, hitsObject, lassoSelect, pickAll, sweepHits } from "../render/hit-test";
import type { ProjectedObject, ScreenBox } from "../render/projection";
import { HANDLE_SIZE_PX, canRotate, selectedFrame } from "../render/scene-renderer";
import { pointInPolygon } from "../render/geometry2d";
import type { SelectionFrame } from "../render/selection-frame";
import { TURN, angleFromRadians, radiansFromAngle } from "../core/angle";
import { PanGesture } from "./navigation";
import { arrangeSelection, commitCornerAt, commitCorners, commitShape as commitShapeNumbers, commitPaint, deleteSelection, flattenSelection, duplicateSelection, groupSelection, previewPaint, redo, ungroupSelection, undo } from "../app/actions";
import { expandToUnits, groupObjects, isInside } from "../doc/groups";
import { boolGroupsOf, isResult } from "../doc/boolean-group";

/**
 * Pointer routing and tool behaviour.
 *
 * Policies (see docs/adr/0003-objects-selection-and-projection.md):
 * - Pen strokes are always new independent objects; drawing over media never
 *   selects, moves, alters or attaches to it.
 * - Navigation (middle button, Space, Hand tool, two-finger touch) only moves
 *   the camera.
 * - Select tool: a stroke under the pointer is selected and can be dragged
 *   immediately. Media must be selected intentionally (a click) before a drag
 *   moves it; dragging from unselected media starts a box selection instead,
 *   so a viewport-filling image is never grabbed by accident.
 * - Alt+click cycles through overlapping objects.
 * - Text tool: a click on a text object edits it, anywhere else starts a new
 *   one. With the Select tool, a double-click on a text object edits it.
 */

/** Pointer travel (CSS px) that turns a press into a drag. */
const LONG_PRESS_MS = 450;
const DRAG_THRESHOLD_PX = 3;
/** Minimum pen sample spacing in CSS px. */
const PEN_MIN_STEP_PX = 0.75;
/** A press this close outside a corner of the selection box (px) turns the selection. */
const ROTATE_ZONE_PX = 36;

/** Whether a press at `s` turns the selection: on the rotate handle, or just outside a corner of the box (beyond its resize handle). */
function inRotateZone(s: ScreenPoint, frame: SelectionFrame, handle: readonly [number, number]): boolean {
  if (Math.hypot(s.x - handle[0], s.y - handle[1]) <= HANDLE_SIZE_PX) return true;
  const near = frame.corners.some((p) => {
    const d = Math.hypot(s.x - p[0], s.y - p[1]);
    return d > HANDLE_SIZE_PX && d <= ROTATE_ZONE_PX;
  });
  return near && !pointInPolygon(s.x, s.y, frame.corners.flatMap((p) => [p[0], p[1]]));
}
/** Shift while rotating snaps to whole steps of 15 degrees. */
const ANGLE_STEP = TURN / 24;
/** Smallest scale factor a resize drag can produce (prevents flips/zero size). */
const MIN_SCALE = 1e-6;

/** What a move can snap to (interaction/snap.ts), gathered once when the move starts. */
interface SnapContext {
  /** The moving selection's box in px, and its exact lines in the move's frame. */
  box: ScreenBox;
  src: ExactLines;
  /** Candidates: other visible objects, their px lines and what they are. */
  tx: Array<[number, number, number]>;
  ty: Array<[number, number, number]>;
  objs: CanvasObject[];
}

interface ExactLines {
  x: [D.Dyadic, D.Dyadic, D.Dyadic];
  y: [D.Dyadic, D.Dyadic, D.Dyadic];
}

const exactLines = (min: WorldPoint, max: WorldPoint): ExactLines => ({
  x: [min.x, D.shift(D.add(min.x, max.x), -1), max.x],
  y: [min.y, D.shift(D.add(min.y, max.y), -1), max.y],
});

/** The object's exact world bounding box, expressed in frame `f`. */
function boundsIn(o: CanvasObject, f: Frame): { min: WorldPoint; max: WorldPoint } {
  const b = worldBounds(o);
  const of = o.frame ?? f.space.world;
  return of === f ? b : { min: expressExactIn(f.space, of, b.min, f), max: expressExactIn(f.space, of, b.max, f) };
}

const linesOf = (o: CanvasObject, f: Frame): ExactLines => {
  const b = boundsIn(o, f);
  return exactLines(b.min, b.max);
};

type Edge = "n" | "e" | "s" | "w";
interface ResizeHandle {
  at: [number, number];
  /** The opposite corner or side, which stays put. */
  fixed: [number, number];
  edge: Edge | null;
}
const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** The resize handles of a selection box: its four corners, and (for a box that is long enough, turned or not) the middle of each side. */
function resizeHandles(frame: SelectionFrame): ResizeHandle[] {
  const c = frame.corners;
  const out: ResizeHandle[] = c.map((p, i) => ({ at: [p[0], p[1]] as [number, number], fixed: [c[(i + 2) % 4]![0], c[(i + 2) % 4]![1]] as [number, number], edge: null }));
  {
    const w = Math.hypot(c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]);
    const h = Math.hypot(c[3]![0] - c[0]![0], c[3]![1] - c[0]![1]);
    // A side handle needs room: on a thin box it would sit on top of the item itself (and its middle), so the corners alone are used.
    const roomy = w >= 3 * HANDLE_SIZE_PX && h >= 3 * HANDLE_SIZE_PX;
    if (roomy) {
      out.push({ at: mid(c[0]!, c[1]!), fixed: mid(c[3]!, c[2]!), edge: "n" }, { at: mid(c[3]!, c[2]!), fixed: mid(c[0]!, c[1]!), edge: "s" });
    }
    if (roomy) {
      out.push({ at: mid(c[1]!, c[2]!), fixed: mid(c[0]!, c[3]!), edge: "e" }, { at: mid(c[0]!, c[3]!), fixed: mid(c[1]!, c[2]!), edge: "w" });
    }
  }
  return out;
}

type Gesture =
  | { kind: "none" }
  | { kind: "pan" }
  | { kind: "pen"; pointerId: number; last: ScreenPoint; tip: ScreenPoint; depth: { levels: bigint; frac: number }; px: number; at: number }
  | { kind: "lasso"; pointerId: number }
  | { kind: "erase"; pointerId: number; last: ScreenPoint; picked: Set<ObjectId> }
  | { kind: "press"; pointerId: number; start: ScreenPoint; target: CanvasObject | null; additive: boolean }
  | { kind: "move"; pointerId: number; frame: Frame; startWorld: WorldPoint; startScreen: ScreenPoint; ids: ObjectId[]; snap: SnapContext | null }
  | { kind: "marquee"; pointerId: number; start: ScreenPoint; additive: boolean }
  | { kind: "text"; pointerId: number; start: ScreenPoint }
  /** Dragging a handle of a path's gradient (ADR 0100). */
  | { kind: "grad"; pointerId: number; id: ObjectId; which: "fill" | "stroke"; handle: GradHandle; g: Gradient }
  /** Dragging the corner radius dot or a star's ratio handle (ADR 0105): `r0` the radius in px and `proj0` where along the corner's bisector the press was. */
  | { kind: "round"; pointerId: number; id: ObjectId; what: "main" | "corner" | "ratio" | "count"; index: number; r0: number; proj0: number; x0: number; start: ScreenPoint; moved: boolean; opened: boolean; timer: number }
  /** Dragging a shape out (Shape tool). */
  | { kind: "shape"; pointerId: number; start: ScreenPoint }
  /** A node of the path being built has been placed; dragging pulls its handles out (Path tool). */
  | { kind: "pathnode"; pointerId: number; start: ScreenPoint; dragging: boolean }
  /** A node, a handle or a segment of the selected path (Edit nodes tool); `base` is the path's geometry when the press began. */
  | { kind: "node"; pointerId: number; id: ObjectId; what: "point" | "in" | "out" | "seg"; s: number; k: number; t: number; base: readonly SubPath[]; start: ScreenPoint; startLocal: { x: number; y: number }; moved: boolean; smooth: boolean }
  | {
      kind: "scale";
      pointerId: number;
      ids: ObjectId[];
      fixed: ScreenPoint;
      frame: Frame;
      fixedWorld: WorldPoint;
      start: ScreenPoint;
      /** Where on the handle the pointer took hold: the edge follows the pointer with this offset, and it is the edge that snaps. */
      grab: ScreenPoint;
      /** The box's middle (Alt resizes about it) and, for a side handle, which side. */
      centre: ScreenPoint;
      edge: Edge | null;
      /** The selection may be stretched on one axis (only upright pictures); anything else keeps its proportions. */
      free: boolean;
      /** The box's own axes on screen (its turn): the factors of a resize are along them. */
      axes: { c: number; s: number };
      snap: SnapContext | null;
    }
  | {
      kind: "rotate";
      pointerId: number;
      ids: ObjectId[];
      frame: Frame;
      /** null: a single stroke, turning about its own centre. */
      about: WorldPoint | null;
      centre: ScreenPoint;
      start: number;
      /** The single stroke's angle before the gesture (for snapping to whole steps), else 0. */
      rot0: number;
    };

export interface ToolHooks {
  /** Open the text editor on `target`, or on a new text object at `at`. */
  editText(target: TextObject | null, at: WorldPoint): void;
  /** The tool a plain key picks (rebindable in Settings, ADR 0049). */
  toolForKey(key: string): Tool | undefined;
  /** The direction a plain key steps in (W A S D at first; Settings > Shortcuts), if any (ADR 0058, 0072). */
  navForKey(key: string): NavDir | undefined;
  /** Step the selection to a neighbouring item. */
  navigate(dir: NavDir): void;
  /** Alt: bring the selection into view. */
  focusSelection(): void;
  /** "/", "#" or "@": search the canvas by name, tag or bookmark (ADR 0060). */
  openSearch(prefix: string): void;
}

export function attachTools(
  el: HTMLElement,
  view: ViewState,
  doc: DocumentStore,
  index: FrameIndex,
  editor: EditorState,
  hooks: ToolHooks,
): () => void {
  const pan = new PanGesture(view);
  let g: Gesture = { kind: "none" };
  let spaceDown = false;
  let cycleIndex = 0;
  /** Last position of every pointer that is down, for handing touches to navigation. */
  const active = new Map<number, { p: ScreenPoint; touch: boolean }>();

  const local = (e: { clientX: number; clientY: number }): ScreenPoint => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** A screen point in the coordinates of the camera's frame (`view.frame`). */
  const world = (s: ScreenPoint): WorldPoint => screenToWorld(view.camera, view.viewport, s);
  /** A screen point in the coordinates of frame `f` (exact; the camera may have rebased since `f` was chosen). */
  const worldIn = (s: ScreenPoint, f: Frame): WorldPoint => (view.frame === f ? world(s) : expressExactIn(f.space, view.frame, world(s), f));
  /** An object the view is inside of: coarse ones that cover it, or any whose body is under the centre and the four corners. */
  const fillsView = (po: ProjectedObject): boolean => {
    if (po.cover) return true;
    const { width: w, height: h } = view.viewport;
    return [[w / 2, h / 2], [2, 2], [w - 2, 2], [2, h - 2], [w - 2, h - 2]].every(([x, y]) => hitsObject(po, x!, y!, 0));
  };
  /** The objects the pointer can act on (all visible ones, minus those that fill the view when that option is on). */
  const visible = () => {
    // Inside a boolean group the members are what a pointer reaches, not the group's result (ADR 0103).
    const all = visibleObjects(doc, index, null, view.frameCamera, view.viewport, undefined, { entered: editor.entered, mode: "pick" });
    return editor.ignoreFilling ? all.filter((po) => !fillsView(po)) : all;
  };
  /** What a click, lasso or box can take: locked objects are drawn but cannot be picked (ADR 0021). */
  const unlocked = (list: readonly ProjectedObject[]): ProjectedObject[] => list.filter((po) => !po.obj.locked);
  const textAt = (s: ScreenPoint): TextObject | null =>
    (pickAll(unlocked(visible()), s.x, s.y).find((po) => po.obj.kind === "text")?.obj as TextObject | undefined) ?? null;

  /**
   * Select what the user picked, widened to whole groups (at the level they are working at).
   * Picking something outside the group they entered leaves that group.
   */
  const pick = (ids: readonly ObjectId[], additive = false): void => {
    const picked = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
    if (editor.entered.length && !picked.every((o) => isInside(o, editor.entered))) editor.entered = [];
    editor.select(expandToUnits(doc.ordered(), picked, editor.entered), additive);
  };

  // ---- object eraser (ADR 0022) ------------------------------------------
  /** What a swipe will remove: the touched objects, widened to whole groups or not; locked members never. */
  const erasing = (picked: ReadonlySet<ObjectId>): Set<ObjectId> => {
    const objs = [...picked].map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
    const ids = editor.eraseWholeGroups ? expandToUnits(doc.ordered(), objs, []) : objs.map((o) => o.id);
    return new Set(ids.filter((id) => !doc.get(id)?.locked));
  };

  /** Extend a swipe to `to`: every unlocked visible object the brush touches along the way is taken once. */
  const sweep = (gs: Extract<Gesture, { kind: "erase" }>, to: ScreenPoint): void => {
    const items = unlocked(visible());
    const r = editor.eraserPx / 2;
    let added = false;
    for (const po of items) {
      if (!gs.picked.has(po.obj.id) && sweepHits(po, gs.last.x, gs.last.y, to.x, to.y, r)) {
        gs.picked.add(po.obj.id);
        added = true;
      }
    }
    gs.last = to;
    const boxes = editor.eraser?.boxes ?? [];
    const taken = added ? erasing(gs.picked) : null;
    const next = taken ? items.filter((po) => taken.has(po.obj.id)).map((po) => ({ ...po.box })) : boxes;
    editor.eraser = { at: to, boxes: next };
  };

  const cancelGesture = (): void => {
    editor.eraser = null;
    editor.preview = { kind: "none" };
    editor.draft = null;
    editor.draftDone = [];
    editor.shapeDraft = null;
    editor.lasso = null;
    editor.marquee = null;
    editor.guides = null;
    g = { kind: "none" };
    editor.changed();
  };

  const effectiveTool = (): Tool => (spaceDown ? "hand" : editor.tool);

  // ---- pen --------------------------------------------------------------
  const penPoint = (s: ScreenPoint, e?: PointerEvent, last?: { t: number; p: ScreenPoint }): void => {
    const d = editor.draft!;
    // Extra input for the pens that use it: pressure where the device has it, and speed.
    if (d.pressure) d.pressure.push(e && e.pointerType !== "mouse" && e.pressure > 0 ? e.pressure : 0);
    if (d.speed) d.speed.push(e && last && e.timeStamp > last.t ? Math.hypot(s.x - last.p.x, s.y - last.p.y) / (e.timeStamp - last.t) : 0);
    const w = worldIn(s, d.frame);
    // Local units relative to the stroke anchor (exact difference, then one rounding).
    d.points.push(
      D.toNumber(D.shift(D.sub(w.x, d.anchor.x), -d.unit)),
      D.toNumber(D.shift(D.sub(w.y, d.anchor.y), -d.unit)),
    );
  };

  /**
   * Pen size follows zoom: once the width the pen should have, on the canvas, differs from this piece's by
   * a quarter level, finish the piece and continue the line from its last point as a new one.
   */
  const SPLIT_LOG2 = 0.25;
  const splitIfZoomed = (g: Extract<Gesture, { kind: "pen" }>): void => {
    const d = editor.draft!;
    if (!editor.followZoom || d.points.length < 2) return;
    const depth = depthOf(view.frameCamera);
    const px = penWidthNow(editor.penWidthPx, editor.lock, depth);
    const dz = Number(depth.levels - g.depth.levels) + (depth.frac - g.depth.frac);
    const drift = Math.log2(px / g.px) - dz; // log2 of (width the pen should have) / (this piece's width), on the canvas
    if (Number.isFinite(drift) && Math.abs(drift) < SPLIT_LOG2) return;
    const n = d.points.length;
    const at = { x: D.add(d.anchor.x, D.shift(D.fromNumber(d.points[n - 2]!), d.unit)), y: D.add(d.anchor.y, D.shift(D.fromNumber(d.points[n - 1]!), d.unit)) };
    const cam = view.camera;
    editor.draftDone.push(d);
    editor.draft = {
      frame: view.frame,
      anchor: view.frame === d.frame ? at : expressExactIn(d.frame.space, d.frame, at, view.frame),
      unit: -cam.zi,
      points: [0, 0],
      width: px / 2 ** cam.zf,
      color: d.color,
      kind: d.kind,
      ...(d.pressure ? { pressure: [0], speed: [0] } : {}),
    };
    g.depth = depth;
    g.px = px;
  };

  const commitPen = (): void => {
    const pieces = [...editor.draftDone, ...(editor.draft ? [editor.draft] : [])];
    editor.draft = null;
    editor.draftDone = [];
    if (!pieces.length || pieces[pieces.length - 1]!.points.length < 2) return;
    const z = doc.topZ();
    let at = 0;
    // A pen can make several strokes from one gesture (pencil passes, ink pieces); they are grouped to act as one.
    const strokes = pieces.flatMap((d) =>
      expandStroke(d.kind, { points: d.points, width: d.width, ...(d.pressure ? { pressure: d.pressure } : {}), ...(d.speed ? { speed: d.speed } : {}) }).map((piece): CanvasObject => {
        const stroke: StrokeObject = {
          id: newObjectId(),
          kind: "stroke",
          ...(d.frame === doc.space.world ? {} : { frame: d.frame }),
          anchor: d.anchor,
          unit: d.unit,
          z: z + 1 + at++,
          opacity: piece.opacity,
          attachmentTargetId: null,
          points: piece.points,
          width: piece.width,
          color: d.color,
        };
        return homeObject(normalizeUnit(stroke), doc.space);
      }),
    );
    if (!strokes.length) return;
    const made = strokes.length > 1 && pieces.some((d) => d.kind !== "fine") ? groupObjects(strokes, 0) : strokes;
    doc.commit(doc.transaction("Draw stroke", made));
  };

  // ---- shapes and paths (ADR 0099) ---------------------------------------
  /** A screen point as local units of an anchor in frame `frame` (exact difference, then one rounding). */
  const localIn = (frame: Frame, anchor: WorldPoint, unit: number, s: ScreenPoint): { x: number; y: number } => {
    const w = worldIn(s, frame);
    return { x: D.toNumber(D.shift(D.sub(w.x, anchor.x), -unit)), y: D.toNumber(D.shift(D.sub(w.y, anchor.y), -unit)) };
  };
  /** Local units that make one screen pixel at `s` (to measure a distance on screen in a draft's own units). */
  const localPerPx = (frame: Frame, anchor: WorldPoint, unit: number, s: ScreenPoint): number => {
    const a = localIn(frame, anchor, unit, s);
    const b = localIn(frame, anchor, unit, { x: s.x + 1, y: s.y });
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const paintOf = (c: Paint | null): Paint | null => c;

  /** The box of a shape dragged by (dx, dy) from its start: Shift keeps it square (a line: to 45 degree steps), Alt grows it from the start as its centre. */
  const shapeBox = (kind: ShapeKind, dx: number, dy: number, shift: boolean, alt: boolean): { bx: number; by: number; bw: number; bh: number } => {
    if (kind === "line") {
      if (shift) {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        dx = len * Math.cos(a);
        dy = len * Math.sin(a);
      }
      return alt ? { bx: -dx, by: -dy, bw: 2 * dx, bh: 2 * dy } : { bx: 0, by: 0, bw: dx, bh: dy };
    }
    let w = Math.abs(dx);
    let h = Math.abs(dy);
    if (shift) w = h = Math.max(w, h);
    if (alt) return { bx: -w, by: -h, bw: 2 * w, bh: 2 * h };
    return { bx: dx < 0 ? -w : 0, by: dy < 0 ? -h : 0, bw: w, bh: h };
  };

  const startShape = (s: ScreenPoint, e: PointerEvent): void => {
    if (editor.blockEdit()) return;
    const cam = view.camera;
    const width = editor.shapeWidthPx / 2 ** cam.zf;
    editor.shapeDraft = {
      frame: view.frame,
      anchor: world(s),
      unit: -cam.zi,
      kind: editor.shapeKind,
      bx: 0,
      by: 0,
      bw: 0,
      bh: 0,
      sides: editor.shapeSides,
      tips: editor.shapeTips,
      fill: editor.shapeKind === "line" ? null : paintOf(editor.shapeFill),
      stroke: editor.shapeKind === "line" && editor.shapeStroke === null ? "#1f2329" : paintOf(editor.shapeStroke),
      width,
    };
    g = { kind: "shape", pointerId: e.pointerId, start: s };
    editor.changed();
  };

  const updateShape = (s: ScreenPoint, e: PointerEvent): void => {
    const d = editor.shapeDraft;
    if (!d) return;
    const l = localIn(d.frame, d.anchor, d.unit, s);
    editor.shapeDraft = { ...d, ...shapeBox(d.kind, l.x, l.y, e.shiftKey, e.altKey) };
    editor.changed();
  };

  const shapeObject = (d: NonNullable<typeof editor.shapeDraft>, z: number): PathObject => ({
    id: newObjectId(),
    kind: "path",
    ...(d.frame === doc.space.world ? {} : { frame: d.frame }),
    anchor: d.anchor,
    unit: d.unit,
    z,
    opacity: 1,
    attachmentTargetId: null,
    sub: drawnSubs(d.kind, d.bx, d.by, d.bw, d.bh, d.sides, d.tips),
    ...(drawnParams(d.kind, d.bx, d.by, d.bw, d.bh, d.sides, d.tips) ? { params: drawnParams(d.kind, d.bx, d.by, d.bw, d.bh, d.sides, d.tips)! } : {}),
    fill: d.fill,
    stroke: d.stroke,
    width: d.width,
    ...lookFromChoices(editor.shapeJoin, editor.shapeCap, editor.shapeAlign, d.kind === "rect" || d.kind === "polygon" || d.kind === "star" ? "miter" : undefined),
    shape: d.kind,
  });

  const commitShape = (s: ScreenPoint, cancelled: boolean, e: PointerEvent, start: ScreenPoint): void => {
    updateShape(s, e);
    const d = editor.shapeDraft;
    editor.shapeDraft = null;
    // A press without a drag makes nothing (a stray click must not leave a shape behind).
    if (cancelled || !d || Math.hypot(s.x - start.x, s.y - start.y) < DRAG_THRESHOLD_PX || !(Math.abs(d.bw) > 0 || Math.abs(d.bh) > 0)) return;
    const obj = homeObject(normalizeUnit(shapeObject(d, doc.topZ() + 1)), doc.space);
    doc.commit(doc.transaction(`Draw ${SHAPE_NAMES[d.kind].toLowerCase()}`, [obj]));
    editor.select([obj.id]);
  };

  // The Path tool: a click adds a corner, a drag pulls a smooth node's handles out, a click on the first node closes the path;
  // Enter or a double-click ends it open.
  const startPathNode = (s: ScreenPoint, e: PointerEvent): void => {
    if (editor.blockEdit()) return;
    let d = editor.pathDraft;
    if (!d) {
      const cam = view.camera;
      d = editor.pathDraft = { frame: view.frame, anchor: world(s), unit: -cam.zi, n: [], cursor: null, fill: paintOf(editor.shapeFill), stroke: paintOf(editor.shapeStroke), width: editor.shapeWidthPx / 2 ** cam.zf };
    }
    const l = localIn(d.frame, d.anchor, d.unit, s);
    if (d.n.length >= 3 * NODE) {
      const reach = 8 * localPerPx(d.frame, d.anchor, d.unit, s);
      if (Math.hypot(l.x - d.n[0]!, l.y - d.n[1]!) <= reach) {
        commitPath(true);
        return;
      }
    }
    d.n.push(l.x, l.y, l.x, l.y, l.x, l.y);
    d.cursor = l;
    g = { kind: "pathnode", pointerId: e.pointerId, start: s, dragging: false };
    editor.changed();
  };

  const dragPathHandle = (s: ScreenPoint): void => {
    const d = editor.pathDraft;
    if (!d || g.kind !== "pathnode") return;
    const l = localIn(d.frame, d.anchor, d.unit, s);
    const b = d.n.length - NODE;
    const x = d.n[b]!;
    const y = d.n[b + 1]!;
    // The handle follows the pointer; the other side mirrors it (a smooth node).
    d.n[b + 4] = l.x;
    d.n[b + 5] = l.y;
    d.n[b + 2] = 2 * x - l.x;
    d.n[b + 3] = 2 * y - l.y;
    d.cursor = l;
    editor.changed();
  };

  /** End the path being built: closed (the first node was clicked) or open. Fewer than two nodes make nothing. */
  const commitPath = (closed: boolean): void => {
    const d = editor.pathDraft;
    editor.pathDraft = null;
    g = { kind: "none" };
    if (!d || d.n.length < 2 * NODE) {
      editor.changed();
      return;
    }
    // A closed path is a shape to fill; an open one is a line, and never goes unpainted.
    const stroke = d.stroke ?? (closed || d.fill !== null ? null : "#1f2329");
    const obj: PathObject = {
      id: newObjectId(),
      kind: "path",
      ...(d.frame === doc.space.world ? {} : { frame: d.frame }),
      anchor: d.anchor,
      unit: d.unit,
      z: doc.topZ() + 1,
      opacity: 1,
      attachmentTargetId: null,
      sub: [{ n: d.n, closed }],
      fill: closed ? d.fill : null,
      stroke: closed ? d.stroke : (stroke ?? d.stroke),
      width: d.width,
      ...lookFromChoices(editor.shapeJoin, editor.shapeCap, closed ? editor.shapeAlign : "centre", closed ? "miter" : undefined),
    };
    const made = homeObject(normalizeUnit(obj), doc.space);
    doc.commit(doc.transaction(closed ? "Draw closed path" : "Draw path", [made]));
    editor.select([made.id]);
    editor.changed();
  };

  // The Edit nodes tool.
  const nodeTarget = (): { po: ProjectedObject; o: PathObject } | null => {
    if (editor.selection.size !== 1) return null;
    const po = visible().find((p) => editor.selection.has(p.obj.id));
    return po && po.obj.kind === "path" && !po.cover && !po.obj.locked ? { po, o: po.obj } : null;
  };
  /** What a gradient is edited on: the one picked path, or the result of a boolean group picked whole (whose paint is the group's own). */
  const gradientTarget = (): { po: ProjectedObject; o: PathObject } | null => {
    const one = nodeTarget();
    if (one) return one;
    const level = editor.entered.length;
    const objs = [...editor.selection].map((id) => doc.get(id)).filter((o) => !!o);
    const gid = objs[0]?.groups?.[level];
    if (!gid || !objs.every((o) => o!.groups?.[level] === gid && o!.boolOps?.[gid])) return null;
    const res = objs.find((o) => isResult(o!) && (o as PathObject).result === gid);
    const po = res && visible().find((p) => p.obj.id === res.id);
    return po && po.obj.kind === "path" && !po.cover && !po.obj.locked ? { po, o: po.obj } : null;
  };
  /** The geometry as it is drawn (a turn baked in), and the object without its turn. */
  const baked = (o: PathObject): { sub: readonly SubPath[]; flat: PathObject } => {
    const { rot: _turn, ...flat } = o;
    // (a rounded path is edited at its sharp corners: its base, turned)
    const sub = editSubs(o);
    return { sub, flat: { ...flat, sub } };
  };
  const commitSub = (o: PathObject, sub: readonly SubPath[], label: string): void => {
    const { params: _own, ...flat } = baked(o).flat; // (nodes edited by hand are no longer the shape's own)
    // a rounded path keeps its radius: the nodes are the sharp ones, and the rounding is made again
    // (a radius for each corner no longer fits when nodes were added or taken away: it becomes the largest of them)
    const radius = o.radius !== undefined && typeof o.radius !== "number" && o.radius.length !== nodesIn(sub) ? Math.max(...o.radius) : o.radius;
    const next = homeObject(normalizeUnit(o.base && radius !== undefined ? { ...flat, radius, base: sub, sub: roundCorners(sub, radius) } : { ...flat, sub }), doc.space);
    doc.commit(doc.transaction(label, [next]));
  };

  /** A press on a handle of the selected path's gradient takes it. */
  const startGradientPress = (e: PointerEvent, s: ScreenPoint): boolean => {
    const tgt = gradientTarget();
    if (!tgt || editor.blockEdit()) return false;
    const h = gradientHandles(tgt.po, editor.gradientFocus);
    const handle = h && hitGradient(h, s.x, s.y);
    if (!h || !handle) return false;
    g = { kind: "grad", pointerId: e.pointerId, id: tgt.o.id, which: h.which, handle, g: h.g };
    return true;
  };
  /** A press on the main radius dot, one of the corners' own dots (when opened out) or the star's ratio handle takes it; held still, the main dot opens the corners out (or closes them). */
  const toggleCorners = (id: ObjectId): void => {
    editor.cornersOpen = editor.cornersOpen === id ? null : id;
    editor.changed();
  };
  const startCornerPress = (e: PointerEvent, s: ScreenPoint): boolean => {
    const tgt = gradientTarget();
    if (!tgt || editor.blockEdit() || editor.tool !== "select") return false;
    const open = editor.cornersOpen === tgt.o.id;
    const h = cornerHandles(tgt.po, open);
    const pick = h && hitCornerHandle(h, s.x, s.y, open);
    if (!h || !pick) return false;
    const dot = pick.what === "corner" ? pick.dot : pick.what === "main" ? h.main : null;
    const along = dot ? (s.x - dot.cx) * dot.ux + (s.y - dot.cy) * dot.uy : 0;
    const id = tgt.o.id;
    const timer = pick.what === "main" ? window.setTimeout(() => {
      if (g.kind === "round" && !g.moved && g.timer === timer) {
        g.opened = true;
        toggleCorners(id);
      }
    }, LONG_PRESS_MS) : 0;
    g = { kind: "round", pointerId: e.pointerId, id, what: pick.what, index: pick.what === "corner" ? pick.dot.index : 0, r0: dot?.px ?? 0, proj0: along, x0: s.x, start: s, moved: false, opened: false, timer };
    return true;
  };
  const updateCorner = (s: ScreenPoint, final: boolean): void => {
    if (g.kind !== "round") return;
    if (!g.moved && Math.hypot(s.x - g.start.x, s.y - g.start.y) >= DRAG_THRESHOLD_PX) {
      g.moved = true;
      window.clearTimeout(g.timer);
    }
    if (!g.moved) return;
    const tgt = gradientTarget();
    const open = !!tgt && editor.cornersOpen === tgt.o.id;
    const h = tgt && cornerHandles(tgt.po, open);
    if (!tgt || !h) return;
    const ppu = tgt.po.proj.ppu;
    if (g.what === "ratio" && h.ratio) {
      const q = h.ratio;
      const inner = Math.max(0.05, Math.min(0.95, Math.hypot(s.x - q.cx, s.y - q.cy) / Math.max(1e-6, q.outer)));
      commitShapeNumbers(doc, editor, { inner }, final);
      editor.handleLabel = final ? null : { x: s.x, y: s.y, text: `Ratio ${Math.round(inner * 100)}%` };
      return;
    }
    if (g.what === "count" && h.count) {
      // Round the middle, from the first corner: the angle to the second corner is a turn divided by how many there are.
      const q = h.count;
      const turn = (Math.atan2(s.y - q.cy, s.x - q.cx) - q.a0 + 4 * Math.PI) % (2 * Math.PI);
      const n = turn < (2 * Math.PI) / 24 ? 24 : Math.max(3, Math.min(24, Math.round((2 * Math.PI) / turn)));
      commitShapeNumbers(doc, editor, { sides: n, tips: n }, final);
      editor.handleLabel = final ? null : { x: s.x, y: s.y, text: `Count ${n}` };
      return;
    }
    const which = g.index;
    const dot = g.what === "corner" ? h.corners.find((d) => d.index === which) : h.main;
    if (!dot) return;
    // Along the corner's bisector, from where the dot was taken (so it never jumps); the main dot in the middle of an opened-out shape: sideways.
    const delta = g.what === "main" && open ? s.x - g.x0 : ((s.x - dot.cx) * dot.ux + (s.y - dot.cy) * dot.uy - g.proj0) * dot.sinHalf;
    const px = Math.max(0, Math.min(g.what === "corner" ? dot.max : dot.maxAll, g.r0 + delta));
    if (g.what === "corner") commitCornerAt(doc, editor, g.id, g.index, px, ppu, final);
    else commitCorners(doc, editor, [px], () => ppu, final);
    editor.handleLabel = final ? null : { x: s.x, y: s.y, text: `Radius ${Math.round(px * 10) / 10}` };
  };
  const updateGradient = (s: ScreenPoint): void => {
    if (g.kind !== "grad") return;
    const tgt = gradientTarget();
    if (!tgt) return;
    const l = localOf(tgt.po, s.x, s.y);
    previewPaint(doc, editor, { [g.which]: moveGradientHandle(tgt.o, g.g, g.handle, l.x, l.y) });
  };

  const startNodePress = (e: PointerEvent, s: ScreenPoint): boolean => {
    const tgt = nodeTarget();
    if (!tgt || editor.blockEdit()) return false;
    const hit = hitNodes(tgt.po, s.x, s.y, editor.nodeSel);
    if (!hit) return false;
    const base = baked(tgt.o).sub;
    editor.nodeSel = { s: hit.s, k: hit.k };
    g = {
      kind: "node",
      pointerId: e.pointerId,
      id: tgt.o.id,
      what: hit.kind,
      s: hit.s,
      k: hit.k,
      t: hit.kind === "seg" ? hit.t : 0,
      base,
      start: s,
      startLocal: localOf(tgt.po, s.x, s.y),
      moved: false,
      smooth: isSmoothNode(base[hit.s]!, hit.k),
    };
    editor.changed();
    return true;
  };

  const updateNode = (s: ScreenPoint, alt: boolean): void => {
    if (g.kind !== "node" || g.what === "seg") return;
    if (!g.moved && Math.hypot(s.x - g.start.x, s.y - g.start.y) < DRAG_THRESHOLD_PX) return;
    const tgt = nodeTarget();
    if (!tgt) return;
    g.moved = true;
    const l = localOf(tgt.po, s.x, s.y);
    const dx = l.x - g.startLocal.x;
    const dy = l.y - g.startLocal.y;
    const sp = g.base[g.s]!;
    const b = g.k * NODE;
    const sub =
      g.what === "point"
        ? moveNode(g.base, g.s, g.k, dx, dy)
        : moveHandle(g.base, g.s, g.k, g.what === "in" ? 2 : 4, sp.n[b + (g.what === "in" ? 2 : 4)]! + dx, sp.n[b + (g.what === "in" ? 3 : 5)]! + dy, g.smooth && !alt);
    editor.preview = { kind: "nodes", ids: [g.id], sub };
    editor.changed();
  };

  const finishNode = (cancelled: boolean): void => {
    if (g.kind !== "node") return;
    const gs = g;
    const p = editor.preview;
    editor.preview = { kind: "none" };
    const o = doc.get(gs.id);
    if (cancelled || !o || o.kind !== "path") return;
    if (gs.moved && p.kind === "nodes") return commitSub(o, p.sub, gs.what === "point" ? "Move node" : "Move handle");
    if (gs.what === "seg") {
      commitSub(o, splitSegment(gs.base, gs.s, gs.k, gs.t), "Add node");
      editor.nodeSel = { s: gs.s, k: gs.k + 1 };
    } else if (gs.what === "point" && altHeld) commitSub(o, toggleSmooth(gs.base, gs.s, gs.k), "Change node");
  };
  /** Alt held at the release of a press on a node: the click turns the node between a corner and smooth. */
  let altHeld = false;

  /** Delete the selected node (the path goes with its last one). Returns whether there was one. */
  const deleteNode = (): boolean => {
    const tgt = nodeTarget();
    const sel = editor.nodeSel;
    if (!tgt || !sel || editor.blockEdit()) return false;
    const sub = withNode(baked(tgt.o).sub, sel.s, sel.k, null);
    editor.nodeSel = null;
    if (!sub.length) deleteSelection(doc, editor);
    else commitSub(tgt.o, sub, "Delete node");
    return true;
  };

  // ---- select -------------------------------------------------------------
  const startSelectPress = (e: PointerEvent, s: ScreenPoint): void => {
    if (startGradientPress(e, s) || startCornerPress(e, s)) return;
    const vis = visible();
    // Rotate and resize handles take priority when a selection is visible.
    const sel = editor.selection.size ? selectedFrame(vis, editor, view.viewport) : null;
    if (sel && canRotate(vis, editor) && !editor.blockEdit()) {
      const { frame, handle } = sel;
      if (inRotateZone(s, frame, handle)) {
        const ids = [...editor.selection].filter((id) => doc.get(id));
        const centre = { x: frame.centre[0], y: frame.centre[1] };
        const single = ids.length === 1 ? doc.get(ids[0]!) : null;
        g = {
          kind: "rotate",
          pointerId: e.pointerId,
          ids,
          frame: view.frame,
          about: single ? null : world(centre),
          centre,
          start: Math.atan2(s.y - centre.y, s.x - centre.x),
          // the turn the box shows now: Shift snaps the whole angle to steps of 15 degrees, wherever it is from (a group is turned as its shapes are)
          rot0: single ? (single.rot ?? 0) : Math.round(angleFromRadians(frame.angle)),
        };
        return;
      }
    }
    if (sel && !editor.blockEdit()) {
      for (const h of resizeHandles(sel.frame)) {
        // A side handle is only as big as its square: wider, it would take presses meant for the item under it.
        const reach = h.edge ? HANDLE_SIZE_PX / 2 + 1 : HANDLE_SIZE_PX;
        if (Math.abs(s.x - h.at[0]) > reach || Math.abs(s.y - h.at[1]) > reach) continue;
        const ids = [...editor.selection].filter((id) => doc.get(id));
        // Free (one-axis, or both axes apart) for upright pictures and for paths, turned or not, whose turn is the box's: strokes and text keep their shape.
        const turnOf = (rot: number | undefined): number => ((radiansFromAngle(rot ?? 0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const boxTurn = ((sel.frame.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const same = (rot: number | undefined): boolean => Math.abs(turnOf(rot) - boxTurn) < 1e-6 || Math.abs(Math.abs(turnOf(rot) - boxTurn) - 2 * Math.PI) < 1e-6;
        const free = ids.length > 0 && ids.every((id) => {
          const o = doc.get(id)!;
          return o.kind === "path" ? same(o.rot) : o.kind === "image" && !o.rot && sel.frame.angle === 0;
        });
        g = {
          kind: "scale",
          pointerId: e.pointerId,
          ids,
          fixed: { x: h.fixed[0], y: h.fixed[1] },
          frame: view.frame,
          fixedWorld: world({ x: h.fixed[0], y: h.fixed[1] }),
          start: { x: h.at[0], y: h.at[1] },
          grab: { x: s.x - h.at[0], y: s.y - h.at[1] },
          centre: { x: sel.frame.centre[0], y: sel.frame.centre[1] },
          edge: h.edge,
          free,
          axes: { c: Math.cos(sel.frame.angle), s: Math.sin(sel.frame.angle) },
          snap: editor.snap ? snapContext(ids, view.frame) : null,
        };
        return;
      }
    }
    const hits = pickAll(unlocked(vis), s.x, s.y);
    let target: CanvasObject | null = hits[0]?.obj ?? null;
    if (e.altKey && hits.length > 1) {
      cycleIndex = (cycleIndex + 1) % hits.length;
      target = hits[cycleIndex]!.obj;
    } else {
      cycleIndex = 0;
    }
    g = { kind: "press", pointerId: e.pointerId, start: s, target, additive: e.shiftKey };
  };

  const pressBecomesDrag = (gp: Extract<Gesture, { kind: "press" }>, s: ScreenPoint, alt = false): void => {
    const t = gp.target;
    const draggable = t && (t.kind === "stroke" || t.kind === "path" || editor.selection.has(t.id)) && !editor.readOnly;
    if (t && draggable) {
      if (!editor.selection.has(t.id)) pick([t.id], gp.additive);
      // Alt held as the drag starts: the drag carries a copy (placed exactly on the original) and the original stays.
      if (alt && !editor.blockEdit()) duplicateSelection(doc, editor, view, 0);
      const ids = [...editor.selection].filter((id) => doc.get(id));
      g = { kind: "move", pointerId: gp.pointerId, frame: view.frame, startWorld: world(gp.start), startScreen: gp.start, ids, snap: editor.snap ? snapContext(ids, view.frame) : null };
      updateMove(s);
      return;
    }
    g = { kind: "marquee", pointerId: gp.pointerId, start: gp.start, additive: gp.additive };
    editor.marquee = { x0: gp.start.x, y0: gp.start.y, x1: s.x, y1: s.y };
    editor.changed();
  };

  /** Gather what a move of `ids` can snap to; null when there is nothing to measure. */
  const snapContext = (ids: readonly ObjectId[], frame: Frame): SnapContext | null => {
    const vis = visible();
    const chosen = new Set(ids);
    let box: ScreenBox | null = null;
    let ex: { minX: D.Dyadic; minY: D.Dyadic; maxX: D.Dyadic; maxY: D.Dyadic } | null = null;
    const ctx: SnapContext = { box: undefined as unknown as ScreenBox, src: undefined as unknown as ExactLines, tx: [], ty: [], objs: [] };
    for (const po of vis) {
      const b = po.box;
      if (chosen.has(po.obj.id)) {
        box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : { ...b };
        const e = boundsIn(po.obj, frame);
        ex = ex
          ? {
              minX: D.cmp(e.min.x, ex.minX) < 0 ? e.min.x : ex.minX,
              minY: D.cmp(e.min.y, ex.minY) < 0 ? e.min.y : ex.minY,
              maxX: D.cmp(e.max.x, ex.maxX) > 0 ? e.max.x : ex.maxX,
              maxY: D.cmp(e.max.y, ex.maxY) > 0 ? e.max.y : ex.maxY,
            }
          : { minX: e.min.x, minY: e.min.y, maxX: e.max.x, maxY: e.max.y };
      } else if (!po.cover && [b.minX, b.minY, b.maxX, b.maxY].every((v) => Math.abs(v) < 1e7)) {
        ctx.tx.push([b.minX, (b.minX + b.maxX) / 2, b.maxX]);
        ctx.ty.push([b.minY, (b.minY + b.maxY) / 2, b.maxY]);
        ctx.objs.push(po.obj);
      }
    }
    if (!box || !ex || !ctx.objs.length) return null;
    ctx.box = box;
    ctx.src = exactLines({ x: ex.minX, y: ex.minY }, { x: ex.maxX, y: ex.maxY });
    return ctx;
  };

  const updateMove = (s: ScreenPoint): void => {
    if (g.kind !== "move") return;
    const w = worldIn(s, g.frame);
    let dx = D.sub(w.x, g.startWorld.x);
    let dy = D.sub(w.y, g.startWorld.y);
    editor.guides = null;
    const sn = g.snap;
    if (sn && !editor.readOnly) {
      const ox = s.x - g.startScreen.x;
      const oy = s.y - g.startScreen.y;
      const b = sn.box;
      const hx = bestSnap([b.minX + ox, (b.minX + b.maxX) / 2 + ox, b.maxX + ox], sn.tx);
      const hy = bestSnap([b.minY + oy, (b.minY + b.maxY) / 2 + oy, b.maxY + oy], sn.ty);
      // The alignment is exact: target line minus where the moving line started.
      if (hx) {
        const t = linesOf(sn.objs[hx.target]!, g.frame);
        dx = D.sub(t.x[hx.line]!, sn.src.x[hx.source]!);
        editor.guides = { x: sn.tx[hx.target]![hx.line]! };
      }
      if (hy) {
        const t = linesOf(sn.objs[hy.target]!, g.frame);
        dy = D.sub(t.y[hy.line]!, sn.src.y[hy.source]!);
        editor.guides = { ...editor.guides, y: sn.ty[hy.target]![hy.line]! };
      }
    }
    editor.preview = { kind: "move", ids: g.ids, frame: g.frame, dx, dy };
    editor.changed();
  };

  /**
   * The factors of a resize drag, side-handle: a corner or a side follows the pointer; Shift keeps the proportions; Alt resizes about the
   * middle of the box; Ctrl (or Cmd) turns snapping off. The dragged edge snaps to the edges and middles of other objects.
   * Anything but an upright picture keeps its proportions whatever is held (it cannot be stretched).
   */
  const scaleFactors = (gs: Extract<Gesture, { kind: "scale" }>, s: ScreenPoint, mods: { shift: boolean; alt: boolean; noSnap: boolean }): { kx: number; ky: number; fixed: ScreenPoint } => {
    const fixed = mods.alt ? gs.centre : gs.fixed;
    // Along the box's own axes (the same as the screen's for an upright box).
    const { c: ac, s: as } = gs.axes;
    const boxOf = (x: number, y: number): { u: number; v: number } => ({ u: (x - fixed.x) * ac + (y - fixed.y) * as, v: -(x - fixed.x) * as + (y - fixed.y) * ac });
    const st = boxOf(gs.start.x, gs.start.y);
    const sx = st.u;
    const sy = st.v;
    const proportional = mods.shift || !gs.free;
    const moveX = gs.edge !== "n" && gs.edge !== "s";
    const moveY = gs.edge !== "e" && gs.edge !== "w";
    // The dragged edge (not the pointer) is what lines up: it sits where the pointer is, less the offset it was grabbed at, and with the
    // proportions kept it is wherever the proportional size puts it (not where the pointer is).
    const px = s.x - gs.grab.x;
    const py = s.y - gs.grab.y;
    editor.guides = null;
    const sn = gs.snap && !mods.noSnap && as === 0 && ac === 1 ? gs.snap : null; // (the edges to line up with are on the screen's axes)
    const pt = boxOf(px, py);
    let kx = sx !== 0 ? pt.u / sx : 1;
    let ky = sy !== 0 ? pt.v / sy : 1;
    if (proportional) {
      let k: number;
      if (gs.edge) k = gs.edge === "n" || gs.edge === "s" ? ky : kx;
      else k = (sx * pt.u + sy * pt.v) / (sx * sx + sy * sy || 1); // along the diagonal, so the corner tracks the pointer
      if (sn) {
        // Where the edges end up at this size, and the nearer of the two that is within reach holds: the size follows from it.
        const ex = fixed.x + k * sx;
        const ey = fixed.y + k * sy;
        const hx = moveX && sx !== 0 ? bestSnap([ex, ex, ex], sn.tx) : null;
        const hy = moveY && sy !== 0 ? bestSnap([ey, ey, ey], sn.ty) : null;
        if (hx && (!hy || hx.dist <= hy.dist)) {
          const t = sn.tx[hx.target]![hx.line]!;
          k = (t - fixed.x) / sx;
          editor.guides = { x: t };
        } else if (hy) {
          const t = sn.ty[hy.target]![hy.line]!;
          k = (t - fixed.y) / sy;
          editor.guides = { y: t };
        }
      }
      kx = ky = k;
    } else {
      if (!moveX) kx = 1;
      if (!moveY) ky = 1;
      if (sn) {
        const hx = moveX ? bestSnap([px, px, px], sn.tx) : null;
        const hy = moveY ? bestSnap([py, py, py], sn.ty) : null;
        if (hx && sx !== 0) {
          const t = sn.tx[hx.target]![hx.line]!;
          kx = (t - fixed.x) / sx;
          editor.guides = { x: t };
        }
        if (hy && sy !== 0) {
          const t = sn.ty[hy.target]![hy.line]!;
          ky = (t - fixed.y) / sy;
          editor.guides = { ...editor.guides, y: t };
        }
      }
    }
    return { kx: Math.max(MIN_SCALE, kx), ky: Math.max(MIN_SCALE, ky), fixed };
  };

  const commitPreview = (): void => {
    try {
      commitPreviewNow();
    } catch (e) {
      // A change the document refuses must not leave a preview on screen that was never stored.
      editor.preview = { kind: "none" };
      editor.message = `Could not apply that change: ${(e as Error).message}`;
      editor.changed();
    }
  };

  const commitPreviewNow = (): void => {
    const p = editor.preview;
    // The committed state is exactly the previewed one, then re-homed if it left its frame's bounds.
    const next = (ids: readonly ObjectId[]): CanvasObject[] =>
      ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o).map((o) => homeObject(editor.previewed(o)!, doc.space));
    if (p.kind === "move" && !(p.dx.m === 0n && p.dy.m === 0n)) {
      const n = next(p.ids);
      editor.preview = { kind: "none" };
      doc.commit(doc.transaction(n.length === 1 ? `Move ${n[0]!.kind}` : `Move ${n.length} objects`, n));
    } else if (p.kind === "rotate" && p.delta !== 0) {
      const n = next(p.ids);
      editor.preview = { kind: "none" };
      doc.commit(doc.transaction(n.length === 1 ? "Rotate stroke" : `Rotate ${n.length} strokes`, n));
    } else if (p.kind === "scale" && !(p.kx === 1 && p.ky === 1)) {
      const n = next(p.ids);
      editor.preview = { kind: "none" };
      doc.commit(doc.transaction("Resize", n));
    }
    editor.preview = { kind: "none" };
  };

  // ---- pointer events ----------------------------------------------------
  const onPointerDown = (e: PointerEvent): void => {
    altAlone = false;
    const s = local(e);
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    // A gesture whose pointer is gone (its release was lost) must not block this press, nor undo and redo.
    if ("pointerId" in g && g.pointerId !== e.pointerId && !active.has(g.pointerId)) cancelGesture();
    const touch = e.pointerType === "touch";
    active.set(e.pointerId, { p: s, touch });
    const touchesDown = [...active.values()].filter((a) => a.touch).length;
    // A second finger turns any one-finger tool gesture into navigation: the
    // tool gesture is discarded and every finger joins the pan/pinch.
    if (touch && touchesDown >= 2 && g.kind !== "pan") {
      cancelGesture();
      for (const [id, a] of active) if (a.touch && id !== e.pointerId) pan.add(id, a.p);
    }
    const navigate = e.button === 1 || effectiveTool() === "hand" || pan.size > 0;
    if (navigate) {
      pan.add(e.pointerId, s);
      g = { kind: "pan" };
      el.classList.add("is-panning");
      return;
    }
    switch (effectiveTool()) {
      case "pen": {
        if (editor.blockEdit()) {
          g = { kind: "none" };
          break;
        }
        const cam = view.camera;
        const f = 2 ** cam.zf;
        const depth = depthOf(view.frameCamera);
        const px = penWidthNow(editor.penWidthPx, editor.lock, depth);
        editor.draft = { frame: view.frame, anchor: world(s), unit: -cam.zi, points: [], width: px / f, color: editor.penColor, kind: editor.penKind, ...(editor.penKind === "ink" ? { pressure: [], speed: [] } : {}) };
        editor.draftDone = [];
        penPoint(s, e);
        g = { kind: "pen", pointerId: e.pointerId, last: s, tip: s, depth, px, at: e.timeStamp };
        editor.changed();
        break;
      }
      case "lasso":
        editor.lasso = [s.x, s.y];
        g = { kind: "lasso", pointerId: e.pointerId };
        editor.changed();
        break;
      case "eraser": {
        if (editor.blockEdit()) break;
        const gs = { kind: "erase" as const, pointerId: e.pointerId, last: s, picked: new Set<ObjectId>() };
        g = gs;
        sweep(gs, s);
        editor.changed();
        break;
      }
      case "select":
        startSelectPress(e, s);
        break;
      case "text":
        g = { kind: "text", pointerId: e.pointerId, start: s };
        break;
      case "shape":
        startShape(s, e);
        break;
      case "path":
        startPathNode(s, e);
        break;
      case "node": {
        if (startNodePress(e, s) || startGradientPress(e, s)) break;
        // Not on a node: a click picks the path to edit (or clears), a drag from nothing is a box.
        const hit = pickAll(unlocked(visible()), s.x, s.y)[0]?.obj ?? null;
        g = { kind: "press", pointerId: e.pointerId, start: s, target: hit, additive: e.shiftKey };
        break;
      }
      default:
        break;
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    const a = active.get(e.pointerId);
    if (a) a.p = local(e);
    if (pan.has(e.pointerId)) {
      pan.move(e.pointerId, local(e));
      return;
    }
    if (g.kind === "none" && effectiveTool() === "select" && !e.buttons) {
      // A rotate cursor where a press would turn the selection (near a corner outside the box, or on the handle).
      const b = editor.selectionBoxOnScreen;
      const p = local(e);
      el.classList.toggle("is-rotate", !!b && b.rotatable && inRotateZone(p, b.frame, b.handle));
      // A resize cursor over a corner handle, drawn along the diagonal the corner points along (turned boxes included).
      const hit = b && !el.classList.contains("is-rotate") ? resizeHandles(b.frame).find((q) => {
        const reach = q.edge ? HANDLE_SIZE_PX / 2 + 1 : HANDLE_SIZE_PX;
        return Math.abs(p.x - q.at[0]) <= reach && Math.abs(p.y - q.at[1]) <= reach;
      }) : undefined;
      if (b && hit) {
        if (hit.edge) el.dataset["hover"] = hit.edge === "n" || hit.edge === "s" ? "ns" : "ew";
        else {
          const deg = (Math.atan2(hit.at[1] - b.frame.centre[1], hit.at[0] - b.frame.centre[0]) * 180) / Math.PI;
          const a = ((deg % 180) + 180) % 180;
          el.dataset["hover"] = a < 22.5 || a >= 157.5 ? "ew" : a < 67.5 ? "nwse" : a < 112.5 ? "ns" : "nesw";
        }
      } else delete el.dataset["hover"];
    }
    if (g.kind === "none" && effectiveTool() === "eraser") {
      editor.eraser = { at: local(e), boxes: [] };
      editor.changed();
      return;
    }
    if (g.kind === "none" && effectiveTool() === "path" && editor.pathDraft) {
      // The line from the last node follows the pointer.
      const d = editor.pathDraft;
      editor.pathDraft = { ...d, cursor: localIn(d.frame, d.anchor, d.unit, local(e)) };
      editor.changed();
      return;
    }
    if (!("pointerId" in g) || g.pointerId !== e.pointerId) return;
    const s = local(e);
    switch (g.kind) {
      case "erase": {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        for (const ce of events.length ? events : [e]) sweep(g, local(ce));
        editor.changed();
        break;
      }
      case "pen": {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        for (const ce of events.length ? events : [e]) {
          // The brush tip: the pointer itself, or (stabilizer) the end of a rope it pulls.
          const p = editor.stabilizer.on ? (g.tip = ropeStep(g.tip, local(ce), ropeFor(editor.stabilizer.strength))) : local(ce);
          if (Math.hypot(p.x - g.last.x, p.y - g.last.y) >= PEN_MIN_STEP_PX) {
            splitIfZoomed(g);
            penPoint(p, ce, { t: g.at, p: g.last });
            g.last = p;
            g.at = ce.timeStamp;
          }
        }
        editor.changed();
        break;
      }
      case "lasso":
        editor.lasso!.push(s.x, s.y);
        editor.changed();
        break;
      case "press":
        if (Math.hypot(s.x - g.start.x, s.y - g.start.y) >= DRAG_THRESHOLD_PX) pressBecomesDrag(g, s, e.altKey);
        break;
      case "move":
        updateMove(s);
        break;
      case "marquee":
        editor.marquee = { x0: g.start.x, y0: g.start.y, x1: s.x, y1: s.y };
        editor.changed();
        break;
      case "rotate": {
        let delta = angleFromRadians(Math.atan2(s.y - g.centre.y, s.x - g.centre.x) - g.start);
        if (e.shiftKey) {
          // Whole 15 degree steps: of the stroke's own angle when one is selected, else of the turn.
          // (A step is TURN / 24, not a whole number; the angle stored must be one.)
          delta = Math.round(Math.round((g.rot0 + delta) / ANGLE_STEP) * ANGLE_STEP) - g.rot0;
        }
        editor.preview = { kind: "rotate", ids: g.ids, frame: g.frame, about: g.about, delta };
        editor.changed();
        break;
      }
      case "grad":
        updateGradient(s);
        break;
      case "round":
        updateCorner(s, false);
        break;
      case "shape":
        updateShape(s, e);
        break;
      case "pathnode":
        if (!g.dragging && Math.hypot(s.x - g.start.x, s.y - g.start.y) >= DRAG_THRESHOLD_PX) g.dragging = true;
        if (g.dragging) dragPathHandle(s);
        break;
      case "node":
        updateNode(s, e.altKey);
        break;
      case "scale": {
        const { kx, ky, fixed } = scaleFactors(g, s, { shift: e.shiftKey, alt: e.altKey, noSnap: e.ctrlKey || e.metaKey });
        editor.preview = { kind: "scale", ids: g.ids, frame: g.frame, fixed: worldIn(fixed, g.frame), kx, ky, keepWidth: editor.lock !== null, keepRadius: editor.lockRadius };
        editor.changed();
        break;
      }
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    active.delete(e.pointerId);
    if (pan.has(e.pointerId)) {
      pan.remove(e.pointerId);
      if (pan.size === 0) {
        g = { kind: "none" };
        el.classList.remove("is-panning");
      }
      return;
    }
    if (!("pointerId" in g) || g.pointerId !== e.pointerId) return;
    const cancelled = e.type === "pointercancel";
    const s = local(e);
    switch (g.kind) {
      case "erase": {
        const ids = cancelled ? new Set<ObjectId>() : erasing(g.picked);
        editor.eraser = { at: s, boxes: [] };
        if (ids.size) {
          // One transaction for the whole swipe, so one undo brings everything back. Originals are never touched here.
          doc.commit(doc.transaction(ids.size === 1 ? "Erase object" : `Erase ${ids.size} objects`, [], [...ids]));
          for (const id of ids) editor.selection.delete(id);
        }
        break;
      }
      case "pen":
        if (cancelled) {
          editor.draft = null;
          editor.draftDone = [];
        } else commitPen();
        break;
      case "lasso": {
        const poly = editor.lasso!;
        editor.lasso = null;
        if (!cancelled) pick(lassoSelect(unlocked(visible()), poly, editor.lassoFilter), e.shiftKey);
        break;
      }
      case "press": {
        // A click: select what is under the pointer (media included), or clear.
        const t = g.target;
        if (t) {
          if (g.additive && editor.selection.has(t.id)) {
            editor.selection.delete(t.id);
            editor.changed();
          } else {
            pick([t.id], g.additive);
          }
        } else if (!g.additive) {
          editor.select([]);
        }
        break;
      }
      case "move":
        if (!cancelled) updateMove(s);
        editor.guides = null;
        if (cancelled) editor.preview = { kind: "none" };
        else commitPreview();
        break;
      case "marquee": {
        const m = editor.marquee!;
        editor.marquee = null;
        if (!cancelled) {
          const box = { minX: Math.min(m.x0, m.x1), minY: Math.min(m.y0, m.y1), maxX: Math.max(m.x0, m.x1), maxY: Math.max(m.y0, m.y1) };
          pick(boxSelect(unlocked(visible()), box), g.additive);
        }
        break;
      }
      case "rotate":
      case "scale":
        editor.guides = null;
        if (cancelled) editor.preview = { kind: "none" };
        else commitPreview();
        break;
      case "grad": {
        const p = editor.preview;
        if (cancelled || p.kind !== "paint") editor.preview = { kind: "none" };
        else commitPaint(doc, editor, { [g.which]: p[g.which] as Gradient });
        break;
      }
      case "round":
        window.clearTimeout(g.timer);
        editor.handleLabel = null;
        if (cancelled || !g.moved) editor.preview = { kind: "none" };
        else updateCorner(s, true);
        break;
      case "shape":
        commitShape(s, cancelled, e, g.start);
        break;
      case "pathnode":
        break; // the node stays; the path goes on until it is closed or ended
      case "node":
        altHeld = e.altKey;
        finishNode(cancelled);
        break;
      case "text":
        // Opened after the pointer is released, so the editor keeps the focus.
        if (!cancelled && !editor.blockEdit()) hooks.editText(textAt(g.start), world(g.start));
        break;
    }
    g = { kind: "none" };
    editor.changed();
  };

  const onDoubleClick = (e: MouseEvent): void => {
    if (effectiveTool() === "path" && editor.pathDraft) {
      // The two presses of the double-click each placed a node on the same spot: keep one, and end the path.
      const d = editor.pathDraft;
      if (d.n.length > NODE) d.n.splice(d.n.length - NODE, NODE);
      commitPath(false);
      return;
    }
    if (effectiveTool() !== "select" || editor.readOnly) return;
    const s = local(e);
    // A double-click on the main radius dot opens the corners out (or closes them): it is not a double-click on the shape.
    const unit = gradientTarget();
    if (unit) {
      const open = editor.cornersOpen === unit.o.id;
      const dots = cornerHandles(unit.po, open);
      const pick = dots && hitCornerHandle(dots, s.x, s.y, open);
      if (pick?.what === "main") {
        toggleCorners(unit.o.id);
        return;
      }
    }
    // A double-click on a grouped object goes one group deeper; once inside, it edits (text) as before.
    const hit = pickAll(unlocked(visible()), s.x, s.y)[0]?.obj;
    if (hit?.groups && hit.groups.length > editor.entered.length && isInside(hit, editor.entered)) {
      editor.entered = hit.groups.slice(0, editor.entered.length + 1);
      const gid = editor.entered[editor.entered.length - 1]!;
      if (hit.boolOps?.[gid]) {
        // Into a boolean group (ADR 0103): what is under the pointer now is one of its shapes, not the result that was double-clicked.
        const inner = pickAll(unlocked(visible()), s.x, s.y)[0]?.obj;
        editor.select(inner ? expandToUnits(doc.ordered(), [inner], editor.entered) : []);
        return;
      }
      editor.select(expandToUnits(doc.ordered(), [hit], editor.entered));
      return;
    }
    // A double-click on a path edits its nodes.
    if (hit?.kind === "path") {
      editor.select([hit.id]);
      editor.setTool("node");
      return;
    }
    const t = textAt(s);
    if (t) hooks.editText(t, world(s));
  };

  // ---- keyboard ----------------------------------------------------------
  /** Alt pressed and released on its own (no other key or pointer in between) brings the selection into view. */
  let altAlone = false;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!canvasShortcutsActive(e)) return;
    altAlone = e.key === "Alt" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      if (g.kind !== "none") return;
      if (e.shiftKey) redo(doc, editor);
      else undo(doc, editor);
    } else if (mod && key === "y") {
      if (g.kind === "none") redo(doc, editor);
    } else if (mod && key === "a") {
      // everything that shows (the members of a boolean group are what its result is made of: they go with it, and are shown only inside it)
      const shown = doc.ordered().filter((o) => !o.hidden && !o.locked && boolGroupsOf(o).every((g) => g.own || editor.entered.includes(g.gid)));
      editor.select(expandToUnits(doc.ordered(), shown, editor.entered));
    } else if (mod && key === "d") {
      e.preventDefault(); // not the browser's bookmark
      duplicateSelection(doc, editor, view);
    } else if (mod && key === "g") {
      if (e.shiftKey) ungroupSelection(doc, editor);
      else groupSelection(doc, editor);
    } else if (mod && key === "e") {
      e.preventDefault(); // not the browser's search
      flattenSelection(doc, editor);
    } else if (mod && (e.key === "]" || e.key === "[")) {
      arrangeSelection(doc, editor, e.key === "]" ? "front" : "back");
    } else if (mod || e.altKey) {
      return;
    } else if (e.key === "/" || e.key === "#" || e.key === "@") {
      hooks.openSearch(e.key);
    } else if (e.key === " ") {
      if (!spaceDown) {
        spaceDown = true;
        el.classList.add("is-hand");
      }
    } else if (hooks.navForKey(key)) hooks.navigate(hooks.navForKey(key)!);
    else if (hooks.toolForKey(key)) editor.setTool(hooks.toolForKey(key)!);
    else if (e.key === "Enter" && editor.pathDraft) {
      commitPath(false);
    } else if (e.key === "Enter" && editor.tool === "node") {
      editor.setTool("select"); // Enter finishes editing nodes, like Esc
    } else if (e.key === "Enter" && editor.tool === "select" && g.kind === "none" && editor.selection.size === 1 && doc.get([...editor.selection][0]!)?.kind === "path" && !doc.get([...editor.selection][0]!)?.locked) {
      editor.setTool("node"); // Enter on a shape edits its nodes
    } else if (e.key === "Escape") {
      if (editor.pathDraft) commitPath(false); // Esc ends the path being drawn, open
      else if (g.kind !== "none" && g.kind !== "pan") cancelGesture();
      else if (editor.tool !== "select") editor.setTool("select"); // Esc: back to the Select tool
      else if (editor.entered.length) {
        // Leave the group entered last; what was picked inside it stays selected.
        editor.entered = editor.entered.slice(0, -1);
        editor.changed();
      } else editor.select([]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const d = editor.pathDraft;
      if (d) {
        // While a path is being drawn, Backspace takes back its last node.
        d.n.splice(d.n.length - NODE, NODE);
        if (!d.n.length) editor.pathDraft = null;
        editor.changed();
      } else if (!(editor.tool === "node" && deleteNode())) deleteSelection(doc, editor);
    } else {
      return;
    }
    e.preventDefault();
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === "Alt" && altAlone) {
      altAlone = false;
      if (canvasShortcutsActive(e)) {
        e.preventDefault(); // not the browser's menu bar
        hooks.focusSelection();
      }
      return;
    }
    if (e.key === " ") {
      spaceDown = false;
      el.classList.remove("is-hand");
    }
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  // If the browser takes the pointer away (a lost release, the window losing focus), end the gesture as cancelled.
  const onLostCapture = (e: PointerEvent): void => {
    if ("pointerId" in g && g.pointerId === e.pointerId) onPointerUp(new PointerEvent("pointercancel", { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY }));
  };
  el.addEventListener("lostpointercapture", onLostCapture);
  el.addEventListener("dblclick", onDoubleClick);
  // Moving onto a bar or panel over the canvas ends the hover (the resize cursor must not stay on the canvas).
  const onLeave = (): void => {
    delete el.dataset["hover"];
  };
  el.addEventListener("pointerleave", onLeave);
  // Leaving the Path tool ends the path being drawn (open).
  const unsubscribe = editor.subscribe(() => {
    if (editor.pathDraft && editor.tool !== "path") commitPath(false);
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => {
    spaceDown = false;
    el.classList.remove("is-hand");
  });
  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("lostpointercapture", onLostCapture);
    el.removeEventListener("dblclick", onDoubleClick);
    el.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    unsubscribe();
  };
}
