import { lookFromChoices } from "../doc/stroke-look";
import { sampleAt } from "./eyedropper";
import type { NavDir } from "./item-navigation";
import { shortcutsActive } from "./shortcut-scope";
import * as D from "../core/dyadic";
import type { ScreenPoint, WorldPoint } from "../core/camera";
import { screenToWorld } from "../core/camera";
import type { ViewState } from "../app/view-state";
import type { EditorState, Tool } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ImageObject, ObjectId, PathObject, StrokeObject, TextObject } from "../doc/model";
import { homeObject, newObjectId, strokePoints } from "../doc/model";
import { bakedPath, rebuiltPath } from "../doc/node-edit";
import type { Paint } from "../doc/paint";
import type { ShapeKind, SubPath } from "../doc/path";
import { moveNodes, edgeBetween, deleteVertex, cellAt } from "../doc/network";
import { NODE, SHAPE_NAMES, lineSubs, moveHandle, moveNode, nodeCount, drawnParams, drawnSubs, splitSegment, toggleSmooth, withNode } from "../doc/path";
import { paramsOf } from "../doc/shape-params";
import { DEFAULT_INNER } from "../doc/path";
import { linkAt } from "../text/layout";
import { pictureBox } from "../render/gradient";
import { newInk } from "../render/ink";
import { NODE_REACH_PX, handleGuide, shapeHandles, hitCornerHandle, gradientHandles, gradientHandleLabel, hitGradient, hitNodes, isSmoothNode, localOf, moveGradientHandle, nodesOnScreen } from "./path-edit";
import type { GradHandle } from "./path-edit";
import type { Gradient } from "../doc/paint";
import type { Frame } from "../core/frames";
import { depthOf, expressExactIn } from "../core/frames";
import { penWidthNow } from "./pen-width";
import { ropeFor, ropeStep } from "./stabilizer";
import { TILT_FULL_DEG, expandStroke } from "./pens";
import { normalizeUnit, restack, worldBounds } from "../doc/edit-ops";
import { MAX_SNAP_TARGETS, SNAP_PX, bestSnap } from "./snap";
import { visibleObjects } from "../render/scene-view";
import type { FrameIndex } from "../scene/frame-index";
import { cameraIn } from "../scene/frame-index";
import { boxSelect, edgeDistancePx, hitsObject, insideBody, lassoSelect, pickAll, sweepHits } from "../render/hit-test";
import { EDGE_PICK_PX, createReveal, deepPick, isDeepPress, revealHits } from "./reveal";
import { descendantsOf, isContainer, isMaskSheet, rootsOf } from "../doc/containers";
import { cutStroke } from "../doc/stroke-cut";
import { planSheetScale } from "../doc/constraints";
import { cropEdges } from "../doc/crop";
import { itemLabelAt } from "../render/item-label";
import type { ItemLabel } from "../render/item-label";
import type { ProjectedObject, ScreenBox } from "../render/projection";
import { projectObject } from "../render/projection";
import { HANDLE_SIZE_PX, canRotate, selectedFrame } from "../render/scene-renderer";
import { pointInPolygon } from "../render/geometry2d";
import type { SelectionFrame } from "../render/selection-frame";
import { TURN, angleFromRadians, normAngle, radiansFromAngle } from "../core/angle";
import { formatRatio } from "../app/export-size";
import { PanGesture } from "./navigation";
import { drawSheetOver, finishShapeBuilder, attachSelection, sheetSelection, arrangeSelection, commitCornerAt, commitCornerSet, commitCorners, commitShape as commitShapeNumbers, commitPaint, deleteSelection, flattenSelection, duplicateSelection, groupSelection, previewPaint, redo, ungroupSelection, undo } from "../app/actions";
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
  | { kind: "erase"; pointerId: number; last: ScreenPoint; picked: Set<ObjectId>; trail: ScreenPoint[] }
  /** Cropping the picked picture (ADR 0118): a side or corner of its box moves its window of the source. */
  | { kind: "crop"; pointerId: number; base: ImageObject; sides: { l: boolean; r: boolean; t: boolean; b: boolean }; start: ScreenPoint; ppu: number }
  | { kind: "press"; pointerId: number; start: ScreenPoint; target: CanvasObject | null; additive: boolean; click?: CanvasObject | null; exact?: boolean }
  | { kind: "move"; pointerId: number; frame: Frame; startWorld: WorldPoint; startScreen: ScreenPoint; ids: ObjectId[]; snap: SnapContext | null }
  | { kind: "marquee"; pointerId: number; start: ScreenPoint; additive: boolean }
  | { kind: "text"; pointerId: number; start: ScreenPoint; moved: boolean }
  /** Dragging a handle of a path's gradient (ADR 0100). */
  | { kind: "grad"; pointerId: number; id: ObjectId; which: "fill" | "stroke"; handle: GradHandle; g: Gradient }
  /** Dragging the corner radius dot or a star's ratio handle (ADR 0105): `r0` the radius in px and `proj0` where along the corner's bisector the press was. */
  | { kind: "round"; pointerId: number; id: ObjectId; what: "main" | "corner" | "ratio" | "count"; index: number; ax: number; ay: number; r0: number; proj0: number; x0: number; start: ScreenPoint; moved: boolean; opened: boolean; timer: number; /** Every picked corner taken along (its radius and the most it can have), by node. */ multi?: ReadonlyMap<number, { r0: number; max: number }> }
  /** Dragging a shape out (Shape tool). */
  | { kind: "shape"; pointerId: number; start: ScreenPoint }
  /** A node of the path being built has been placed; dragging pulls its handles out (Path tool). */
  | { kind: "pathnode"; pointerId: number; start: ScreenPoint; dragging: boolean }
  /** A node, a handle or a segment of the selected path (Edit nodes tool); `base` is the path's geometry when the press began. */
  /** Nodes picked together (Shift-click or a lasso) being dragged, over one or several paths (ADR 0145); each path's geometry as the press began. */
  | { kind: "nodes"; pointerId: number; start: ScreenPoint; bases: Map<ObjectId, { po: ProjectedObject; sub: readonly SubPath[]; from: { x: number; y: number } }>; moved: boolean }
  /** Crossing the regions of the Shape builder (ADR 0145). */
  | { kind: "builder"; pointerId: number }
  /** A lasso drawn round nodes of the picked paths (Edit nodes). */
  | { kind: "nodelasso"; pointerId: number; additive: boolean; /** What was under the press: a click without a drag picks it. */ target: CanvasObject | null }
  | { kind: "cornerlasso"; pointerId: number; id: ObjectId; additive: boolean; target: CanvasObject | null }
  | { kind: "node"; pointerId: number; id: ObjectId; what: "point" | "in" | "out" | "seg"; s: number; k: number; t: number; prev: { s: number; k: number } | null; base: readonly SubPath[]; start: ScreenPoint; startLocal: { x: number; y: number }; moved: boolean; smooth: boolean }
  | {
      kind: "scale";
      pointerId: number;
      ids: ObjectId[];
      /** A sheet is among them (ADR 0108): it is resized and what is on it follows its constraints, instead of everything being scaled. */
      sheets: boolean;
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
      /** The box's width and height on screen before the gesture, for the ratio shown while it is resized. */
      size0: { w: number; h: number };
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

/** Narrowest box that counts as a drawn text box (screen px); a narrower drag is a click. */
const MIN_TEXT_BOX_PX = 24;

export interface ToolHooks {
  /** Open the text editor on `target`, or on a new text object at `at` (a click: as wide as its words; a box dragged out: `box.widthPx` wide, `at` its top-left corner). */
  editText(target: TextObject | null, at: WorldPoint, box?: { widthPx: number }): void;
  /** The tool a plain key picks (rebindable in Settings, ADR 0049). */
  toolForKey(key: string): Tool | undefined;
  /** The direction a plain key steps in (W A S D at first; Settings > Shortcuts), if any (ADR 0058, 0072). */
  navForKey(key: string): NavDir | undefined;
  /** Step the selection to a neighbouring item. */
  navigate(dir: NavDir): void;
  /** Alt: bring the selection into view. */
  focusSelection(): void;
  /** The names above the items as last drawn (what you see is what you press). */
  labels(): readonly ItemLabel[];
  /** "#" or "@": search the canvas by name, tag or bookmark (ADR 0060). */
  openSearch(prefix: string): void;
  /** A long press with a finger (no hover, no Ctrl): everything under it, top first, to choose from; `pick` picks one (additive: added to or taken from the pick). */
  revealList(at: ScreenPoint, things: readonly CanvasObject[], pick: (id: ObjectId, additive: boolean) => void): void;
  /** The view whose keys these are (default "canvas"; the Painting view hosts these tools on a vector layer, ADR 0167). */
  scope?: string;
  /** Undo and redo of the host's own history (default the document's). */
  history?: { undo(): void; redo(): void };
  /** False: the pointer is not these tools' now (the host's other tools have it). */
  active?: () => boolean;
  /** False: the keys are not these tools' now (default: as `active`). */
  keysActive?: () => boolean;
  /** The Eyedropper's colour at a point of `el` (CSS px), averaged over `size` px; default: the pixels on screen. */
  sample?: (at: ScreenPoint, size: number) => string | null;
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
  const doUndo = (): void => (hooks.history ? hooks.history.undo() : void undo(doc, editor));
  const doRedo = (): void => (hooks.history ? hooks.history.redo() : void redo(doc, editor));
  const off = (): boolean => hooks.active?.() === false;
  let g: Gesture = { kind: "none" };
  let spaceDown = false;
  let cycleIndex = 0;
  /** Last position of every pointer that is down, for handing touches to navigation. */
  const active = new Map<number, { p: ScreenPoint; touch: boolean; s0: ScreenPoint }>();
  // Touch gestures (ADR 0152): a quick tap with two fingers is undo and with three is redo (the view is put back where it was: a tap may jiggle the pan and zoom).
  // While one finger drags a handle (resize, rotate), the other fingers are the keys: one more finger held down is Shift, two more are Alt.
  let tap: { t: number; last: number; count: number; moved: boolean; cam: typeof view.camera } | null = null;
  const extras = new Set<number>();
  /** When the last touch with more than one finger ended: a finger that comes down right after it is a tap left over, not a pen stroke or a click. */
  let multiEndAt = -Infinity;
  const AFTER_MULTI_MS = 350;
  let touchShift = false;
  let touchAlt = false;
  let modTimer = 0;
  let lastMove: PointerEvent | null = null;
  /** A tap: the last finger down and up again within TAP_MS, the whole touch within TAP_ALL_MS (fingers land one after the other: three take longer than two). */
  const TAP_MS = 400;
  const TAP_ALL_MS = 1000;
  const TAP_SLOP_PX = 24;
  const KEY_HOLD_MS = 250;
  /** The drags that read Shift and Alt as they go (resize, rotate, drawing a shape, moving a node): a finger resting beside the dragging one is the key for them. */
  const keyedGesture = (): boolean => {
    if (g.kind === "scale" || g.kind === "rotate") return true; // (a handle is taken on purpose)
    if (g.kind !== "shape" && g.kind !== "text" && g.kind !== "node") return false;
    // a shape or box being drawn, a node being moved: once the finger has travelled (before that a second finger is a two-finger tap or a pinch)
    const a = active.get(g.pointerId);
    return !!a && Math.hypot(a.p.x - a.s0.x, a.p.y - a.s0.y) > TAP_SLOP_PX;
  };
  /** Shift and Alt of an event, or of the fingers resting beside the dragging one (one place for all the drags). */
  const keys = (e: { shiftKey: boolean; altKey: boolean }): { shift: boolean; alt: boolean } => ({ shift: e.shiftKey || touchShift, alt: e.altKey || touchAlt });
  const touchFlash = (text: string): void => {
    navigator.vibrate?.(12);
    editor.message = text;
    editor.changed();
  };

  /** Where the pointer was last (canvas px): where a move lets go, to find the frame it lands in. */
  let pointer: ScreenPoint = { x: 0, y: 0 };
  const local = (e: { clientX: number; clientY: number }): ScreenPoint => {
    const r = el.getBoundingClientRect();
    return (pointer = { x: e.clientX - r.left, y: e.clientY - r.top });
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
    const all = visibleObjects(doc, index, null, view.frameCamera, view.viewport, undefined, { entered: editor.entered, mode: "pick", also: editor.selection });
    return editor.ignoreFilling ? all.filter((po) => !fillsView(po)) : all;
  };
  /** What a click, lasso or box can take: locked objects are drawn but cannot be picked (ADR 0021). */
  const unlocked = (list: readonly ProjectedObject[]): ProjectedObject[] => list.filter((po) => !po.obj.locked);
  /** The innermost sheet (ADR 0108) holding the point, other than `except` and what is inside them: where a new or moved object is put. */
  const sheetAt = (x: number, y: number, except: ReadonlySet<ObjectId> = new Set()): PathObject | null => {
    const list = visible();
    for (let i = list.length - 1; i >= 0; i--) {
      const po = list[i]!;
      const o = po.obj;
      if (!isContainer(o) || o.hidden || o.locked || except.has(o.id) || (o.parent !== undefined && except.has(o.parent))) continue;
      if (po.clip && !po.clip.every((c) => insideBody(c, x, y))) continue;
      if (insideBody(po, x, y)) return o;
    }
    return null;
  };
  const nextSheetName = (): string => {
    let n = 0;
    for (const o of doc.all()) if (isContainer(o)) n = Math.max(n, Number(/^Sheet (\d+)$/.exec(o.name ?? "")?.[1] ?? 0));
    return `Sheet ${n + 1}`;
  };
  const textAt = (s: ScreenPoint): TextObject | null =>
    (pickAll(unlocked(visible()), s.x, s.y).find((po) => po.obj.kind === "text")?.obj as TextObject | undefined) ?? null;

  /**
   * Select what the user picked, widened to whole groups (at the level they are working at).
   * Picking something outside the group they entered leaves that group.
   */
  // Reveal (interaction/reveal.ts, ADR 0149): Ctrl held over the canvas on Select (and Edit nodes and Lasso, ADR 0153) shows the outline of everything under the pointer.
  const reveal = createReveal(editor, () => g.kind === "none" && (effectiveTool() === "select" || effectiveTool() === "node" || effectiveTool() === "lasso"));
  const hasThingsOn = (sheet: CanvasObject): boolean => {
    for (const k of doc.all()) if (k.parent === sheet.id && !k.hidden) return true;
    return false;
  };
  /** Enter: from a sheet to what is on it (a mask is gone into). Shift+Enter: from what is on a sheet back to the sheet. */
  const intoSheet = (): boolean => {
    const sheets = [...editor.selection].map((id) => doc.get(id)).filter((o): o is CanvasObject => isContainer(o));
    if (sheets.length !== 1) return false;
    const c = sheets[0]!;
    const kids = [...doc.all()].filter((k) => k.parent === c.id && !k.hidden && !k.locked);
    if (!kids.length) return false;
    if (isMaskSheet(c)) editor.openMask = c.id;
    editor.select(kids.map((k) => k.id));
    return true;
  };
  const outOfSheet = (): boolean => {
    const parents = new Set([...editor.selection].map((id) => doc.get(id)?.parent));
    const only = parents.size === 1 ? [...parents][0] : undefined;
    const sheet = only !== undefined ? doc.get(only) : undefined;
    if (!sheet || !isContainer(sheet) || editor.selection.has(sheet.id)) return false;
    editor.openMask = null;
    editor.select(expandToUnits(doc.ordered(), [sheet], editor.entered));
    return true;
  };
  /** The outermost clipping mask above `o` that has not been gone into: what is on a mask is one unit with it. */
  const maskAbove = (o: CanvasObject): CanvasObject | null => {
    let top: CanvasObject | null = null;
    for (let p = o; p.parent !== undefined; ) {
      const s = doc.get(p.parent);
      if (!s) break;
      if (isMaskSheet(s) && editor.openMask !== s.id) top = s;
      p = s;
    }
    return top;
  };
  const inside = (o: CanvasObject, sheetId: string): boolean => {
    for (let p: CanvasObject | undefined = o; p; p = p.parent !== undefined ? doc.get(p.parent) : undefined) if (p.id === sheetId) return true;
    return false;
  };
  const pick = (ids: readonly ObjectId[], additive = false): void => {
    let picked = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
    if (editor.openMask && !picked.every((o) => inside(o, editor.openMask!))) editor.openMask = null; // (picking away from the mask leaves it)
    picked = [...new Map(picked.map((o) => { const m = maskAbove(o) ?? o; return [m.id, m] as const; })).values()];
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
    if (gs.trail.length < 20_000) gs.trail.push(to);
    for (const po of items) {
      if (editor.eraseParts && po.obj.kind !== "stroke") continue; // (parts of a stroke only: everything else is left alone)
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

  /** Cut what the brush swept out of the strokes it touched (ADR 0111): each stroke becomes the pieces that are left, in one undo step. */
  const erasePartsOf = (gs: Extract<Gesture, { kind: "erase" }>): void => {
    if (editor.blockEdit()) return;
    const puts: CanvasObject[] = [];
    const removes: ObjectId[] = [];
    const items = new Map(visible().map((po) => [po.obj.id, po]));
    for (const id of gs.picked) {
      const po = items.get(id);
      const o = po?.obj;
      if (!po || !o || o.kind !== "stroke" || o.locked || po.cover || !(po.proj.ppu > 0) || !Number.isFinite(po.proj.ppu)) continue;
      const reach = (editor.eraserPx / 2 + po.radius) / po.proj.ppu;
      const runs = cutStroke(strokePoints(o), reach, gs.trail.map((p) => localOf(po, p.x, p.y)));
      if (!runs) continue;
      removes.push(o.id);
      const { rot: _turned, ...flat } = o;
      for (const run of runs) puts.push(normalizeUnit({ ...flat, id: newObjectId(), points: run } as CanvasObject));
    }
    if (!removes.length) return;
    doc.commit(doc.transaction("Erase part of a stroke", puts, removes));
    for (const id of removes) editor.selection.delete(id);
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
    if (d.tilt) {
      const tx = e && e.pointerType === "pen" ? e.tiltX : 0, ty = e && e.pointerType === "pen" ? e.tiltY : 0;
      d.tilt.push(Math.min(1, Math.hypot(tx, ty) / TILT_FULL_DEG));
      d.tiltAz!.push(Math.atan2(ty, tx));
    }
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
      ...(d.tilt ? { tilt: [0], tiltAz: [0] } : {}),
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
      expandStroke(d.kind, { points: d.points, width: d.width, ...(d.pressure ? { pressure: d.pressure } : {}), ...(d.speed ? { speed: d.speed } : {}), ...(d.tilt ? { tilt: d.tilt, tiltAz: d.tiltAz! } : {}) }).map((piece): CanvasObject => {
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
          ...(sheetStart && doc.get(sheetStart) ? { parent: sheetStart } : {}),
        };
        return homeObject(normalizeUnit(stroke), doc.space);
      }),
    );
    if (!strokes.length) return;
    const grouped = strokes.length > 1 && pieces.some((d) => d.kind !== "fine") ? groupObjects(strokes, 0) : strokes;
    // Painting a brush mask: the strokes are part of the mask, in its ink, and cut nothing on their own.
    const m = editor.maskEdit;
    const made = m ? grouped.map((o) => ({ ...o, ...(o.kind === "stroke" ? { color: m.ink } : {}), isMask: true as const, groups: [...m.groups, ...(o.groups ?? [])] }) as CanvasObject) : grouped;
    doc.commit(doc.transaction(m ? "Paint the mask" : "Draw stroke", made));
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
  const paintOf = (c: Paint | null): Paint | null => (typeof c === "string" ? newInk(c) : c); // (the default ink becomes the canvas's readable ink when a shape is made: the colour stored is the colour seen)

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

  /** The frame a shape, frame or stroke being drawn started in (ADR 0108). */
  let sheetStart: ObjectId | undefined;
  const startShape = (s: ScreenPoint, e: PointerEvent): void => {
    if (editor.blockEdit()) return;
    const cam = view.camera;
    const width = editor.shapeWidthPx / 2 ** cam.zf;
    editor.shapeDraft = {
      frame: view.frame,
      anchor: world(s),
      unit: -cam.zi,
      kind: editor.tool === "sheet" ? "rect" : editor.shapeKind,
      bx: 0,
      by: 0,
      bw: 0,
      bh: 0,
      sides: editor.shapeSides,
      tips: editor.shapeTips,
      fill: editor.tool === "sheet" ? "#ffffff" : editor.shapeKind === "line" ? null : paintOf(editor.shapeFill),
      stroke: editor.tool === "sheet" ? null : editor.shapeKind === "line" && editor.shapeStroke === null ? newInk("#1f2329") : paintOf(editor.shapeStroke),
      width,
    };
    sheetStart = sheetAt(s.x, s.y)?.id;
    g = { kind: "shape", pointerId: e.pointerId, start: s };
    editor.changed();
  };

  const updateShape = (s: ScreenPoint, e: PointerEvent): void => {
    const d = editor.shapeDraft;
    if (!d) return;
    const l = localIn(d.frame, d.anchor, d.unit, s);
    editor.shapeDraft = { ...d, ...shapeBox(d.kind, l.x, l.y, keys(e).shift, keys(e).alt) };
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
    ...lookFromChoices(editor.shapeJoin, editor.shapeCap, editor.shapeAlign, d.kind === "rect" || d.kind === "polygon" || d.kind === "star" ? "miter" : undefined, editor.shapeDash),
    shape: d.kind,
  });

  const commitShape = (s: ScreenPoint, cancelled: boolean, e: PointerEvent, start: ScreenPoint): void => {
    updateShape(s, e);
    const d = editor.shapeDraft;
    editor.shapeDraft = null;
    // A press without a drag makes nothing (a stray click must not leave a shape behind).
    if (cancelled || !d || Math.hypot(s.x - start.x, s.y - start.y) < DRAG_THRESHOLD_PX || !(Math.abs(d.bw) > 0 || Math.abs(d.bh) > 0)) return;
    const drawn = shapeObject(d, doc.topZ() + 1);
    const made: PathObject = editor.tool === "sheet" ? { ...drawn, stroke: null, container: { clip: true }, name: nextSheetName() } : drawn;
    const obj = homeObject(normalizeUnit(sheetStart && doc.get(sheetStart) ? { ...made, parent: sheetStart } : made), doc.space);
    // A sheet drawn over objects takes the ones wholly inside it that are at its level (not on another sheet, unless the sheet is drawn on that one).
    if (editor.tool === "sheet") {
      const cam = cameraIn(view.frameCamera, obj.frame ?? doc.space.world);
      const sb = cam && projectObject(obj, cam, view.viewport, { keepTiny: true })?.box;
      const level = (o: CanvasObject): ObjectId | undefined => (o.parent !== undefined && doc.get(o.parent) ? o.parent : undefined);
      const here = sheetStart && doc.get(sheetStart) ? sheetStart : undefined;
      if (sb) {
        const inside = visible().filter((po) => {
          const b = po.box;
          return !po.cover && !po.obj.hidden && !po.obj.locked && level(po.obj) === here && b.minX >= sb.minX - 0.5 && b.minY >= sb.minY - 0.5 && b.maxX <= sb.maxX + 0.5 && b.maxY <= sb.maxY + 0.5;
        });
        const all = doc.ordered();
        const taken = expandToUnits(all, inside.map((po) => po.obj), []).map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o && !o.locked);
        const roots = rootsOf(taken).filter((o) => level(o) === here);
        if (roots.length) return drawSheetOver(doc, editor, obj as PathObject, roots);
      }
    }
    doc.commit(doc.transaction(editor.tool === "sheet" ? "Draw sheet" : `Draw ${SHAPE_NAMES[d.kind].toLowerCase()}`, [obj]));
    editor.select([obj.id]);
  };

  // The Path tool: a click adds a corner, a drag pulls a smooth node's handles out, a click on the first node closes the path;
  // Enter or a double-click ends it open.
  let pathSheet: ObjectId | undefined;
  const startPathNode = (s: ScreenPoint, e: PointerEvent): void => {
    if (editor.blockEdit()) return;
    let d = editor.pathDraft;
    if (!d) {
      pathSheet = sheetAt(s.x, s.y)?.id;
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
    const stroke = d.stroke ?? (closed || d.fill !== null ? null : newInk("#1f2329"));
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
      ...lookFromChoices(editor.shapeJoin, editor.shapeCap, closed ? editor.shapeAlign : "centre", closed ? "miter" : undefined, editor.shapeDash),
      ...(pathSheet && doc.get(pathSheet) ? { parent: pathSheet } : {}),
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
    // a picture (ADR 0153): its corner radius and its outline's gradient, on its box as a rectangle path
    if (editor.selection.size === 1) {
      const pic = visible().find((p) => editor.selection.has(p.obj.id));
      if (pic && pic.obj.kind === "image" && !pic.cover && !pic.obj.locked) return { po: pic, o: pictureBox(pic.obj) };
    }
    const level = editor.entered.length;
    const objs = [...editor.selection].map((id) => doc.get(id)).filter((o) => !!o);
    const gid = objs[0]?.groups?.[level];
    if (!gid || !objs.every((o) => o!.groups?.[level] === gid && o!.boolOps?.[gid])) return null;
    const res = objs.find((o) => isResult(o!) && (o as PathObject).result === gid);
    const po = res && visible().find((p) => p.obj.id === res.id);
    return po && po.obj.kind === "path" && !po.cover && !po.obj.locked ? { po, o: po.obj } : null;
  };
  const baked = bakedPath;
  const rebuilt = (o: PathObject, sub: readonly SubPath[]): PathObject => rebuiltPath(o, sub, doc.space);
  const commitSub = (o: PathObject, sub: readonly SubPath[], label: string): void => {
    const next = rebuilt(o, sub);
    doc.commit(doc.transaction(label, [next]));
  };

  /** A press on a handle of the selected path's gradient takes it. */
  const startGradientPress = (e: PointerEvent, s: ScreenPoint): boolean => {
    const tgt = gradientTarget();
    if (!tgt || editor.blockEdit() || editor.tool === "node" || editor.cornersOpen === tgt.o.id) return false; // (its handles are hidden then)
    const h = gradientHandles(tgt.po, editor.gradientFocus);
    const handle = h && hitGradient(h, s.x, s.y);
    if (!h || !handle) return false;
    g = { kind: "grad", pointerId: e.pointerId, id: tgt.o.id, which: h.which, handle, g: h.g };
    return true;
  };
  /** A press on the main radius dot, one of the corners' own dots (when opened out) or the star's ratio handle takes it; held still, the main dot opens the corners out (or closes them). */
  const toggleCorners = (id: ObjectId): void => {
    editor.cornersOpen = editor.cornersOpen === id ? null : id;
    editor.cornerSel = null;
    editor.changed();
  };
  const startCornerPress = (e: PointerEvent, s: ScreenPoint): boolean => {
    const tgt = gradientTarget();
    if (!tgt || editor.blockEdit() || editor.tool !== "select") return false;
    const open = editor.cornersOpen === tgt.o.id;
    const h = shapeHandles(tgt.po, open, editor);
    const pick = h && hitCornerHandle(h, s.x, s.y, open);
    // Corners opened out: a drag that starts on empty ground is a lasso that picks corners, to be moved together.
    if (h && open && !pick) {
      editor.lasso = [s.x, s.y];
      g = { kind: "cornerlasso", pointerId: e.pointerId, id: tgt.o.id, additive: e.shiftKey, target: pickAll(unlocked(visible()), s.x, s.y)[0]?.obj ?? null };
      editor.changed();
      return true;
    }
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
    g = { kind: "round", pointerId: e.pointerId, id, what: pick.what, index: pick.what === "corner" ? pick.dot.index : 0, ax: pick.what === "ratio" && h.ratio ? (h.ratio.x - h.ratio.cx) / Math.max(1e-6, Math.hypot(h.ratio.x - h.ratio.cx, h.ratio.y - h.ratio.cy)) : 0, ay: pick.what === "ratio" && h.ratio ? (h.ratio.y - h.ratio.cy) / Math.max(1e-6, Math.hypot(h.ratio.x - h.ratio.cx, h.ratio.y - h.ratio.cy)) : 0, r0: dot?.px ?? 0, proj0: along, x0: s.x, start: s, moved: false, opened: false, timer };
    const sel = editor.cornerSel;
    if (g.kind === "round" && pick.what === "corner" && sel && sel.id === id && sel.idx.size > 1 && sel.idx.has(pick.dot.index)) {
      g.multi = new Map(h.corners.filter((d) => sel.idx.has(d.index)).map((d) => [d.index, { r0: d.px, max: d.max }]));
    } else if (pick.what === "corner" && sel && !(sel.id === id && sel.idx.has(pick.dot.index))) editor.cornerSel = null; // (another corner: the picked ones are let go)
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
    const h = tgt && shapeHandles(tgt.po, open, editor);
    if (!tgt || !h) return;
    const ppu = tgt.po.proj.ppu;
    if (g.what === "ratio" && h.ratio) {
      const q = h.ratio;
      // Only along its line (from the middle through the handle), wherever the pointer strays to.
      const inner = Math.max(0.05, Math.min(0.95, ((s.x - q.cx) * g.ax + (s.y - q.cy) * g.ay) / Math.max(1e-6, q.outer)));
      commitShapeNumbers(doc, editor, { inner }, final);
      editor.handleLabel = final ? null : { x: s.x, y: s.y, text: `Ratio ${Math.round(inner * 100)}%`, guide: handleGuide(h, { what: "ratio" }, open) };
      return;
    }
    if (g.what === "count" && h.count) {
      // Round the middle, from the first corner: the angle to the second corner is a turn divided by how many there are.
      const q = h.count;
      const turn = (Math.atan2(s.y - q.cy, s.x - q.cx) - q.a0 + 4 * Math.PI) % (2 * Math.PI);
      const n = turn < (2 * Math.PI) / 24 ? 24 : Math.max(3, Math.min(24, Math.round((2 * Math.PI) / turn)));
      commitShapeNumbers(doc, editor, { sides: n, tips: n }, final);
      editor.handleLabel = final ? null : { x: s.x, y: s.y, text: `Count ${n}`, guide: handleGuide(h, { what: "count" }, open) };
      return;
    }
    const which = g.index;
    const dot = g.what === "corner" ? h.corners.find((d) => d.index === which) : h.main;
    if (!dot) return;
    // Along the corner's bisector, from where the dot was taken (so it never jumps); the main dot in the middle of an opened-out shape: sideways.
    const delta = g.what === "main" && open ? s.x - g.x0 : ((s.x - dot.cx) * dot.ux + (s.y - dot.cy) * dot.uy - g.proj0) * dot.sinHalf;
    const px = Math.max(0, Math.min(g.what === "corner" ? dot.max : dot.maxAll, g.r0 + delta));
    if (g.what === "corner" && g.multi) commitCornerSet(doc, editor, g.id, new Map([...g.multi].map(([i, c]) => [i, Math.max(0, Math.min(c.max, c.r0 + delta))])), ppu, final);
    else if (g.what === "corner") commitCornerAt(doc, editor, g.id, g.index, px, ppu, final);
    else commitCorners(doc, editor, [px], () => ppu, final);
    editor.handleLabel = final ? null : { x: s.x, y: s.y, text: `Radius ${Math.round(px * 10) / 10}`, guide: handleGuide(h, g.what === "corner" ? { what: "corner", dot } : { what: "main" }, open) };
  };
  /**
   * A gradient handle with the Snap toggle on (ADR 0019): its x or y lines up with the edges or the middle of anything in view (the shape
   * it paints too: the ends of a gradient go to its sides and centre) or with a node of a path, within SNAP_PX, and the guide shows where.
   */
  const snapGradientPoint = (s: ScreenPoint): ScreenPoint => {
    editor.guides = null;
    if (!editor.snap) return s;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const po of visible().slice(0, MAX_SNAP_TARGETS)) {
      if (po.cover) continue;
      xs.push(po.box.minX, (po.box.minX + po.box.maxX) / 2, po.box.maxX);
      ys.push(po.box.minY, (po.box.minY + po.box.maxY) / 2, po.box.maxY);
      if (po.obj.kind === "path") for (const n of nodesOnScreen(po)) { xs.push(n.p[0]); ys.push(n.p[1]); }
    }
    const nearest = (v: number, list: readonly number[]): number | null => {
      let best: number | null = null;
      for (const c of list) if (Math.abs(c - v) <= SNAP_PX && (best === null || Math.abs(c - v) < Math.abs(best - v))) best = c;
      return best;
    };
    const sx = nearest(s.x, xs);
    const sy = nearest(s.y, ys);
    if (sx !== null) editor.guides = { x: sx };
    if (sy !== null) editor.guides = { ...editor.guides, y: sy };
    return { ...s, x: sx ?? s.x, y: sy ?? s.y };
  };
  const updateGradient = (s0: ScreenPoint): void => {
    if (g.kind !== "grad") return;
    const tgt = gradientTarget();
    if (!tgt) return;
    const s = snapGradientPoint(s0);
    const l = localOf(tgt.po, s.x, s.y);
    const moved = moveGradientHandle(tgt.o, g.g, g.handle, l.x, l.y);
    previewPaint(doc, editor, { [g.which]: moved });
    editor.handleLabel = { x: s.x, y: s.y, text: gradientHandleLabel(g.which, moved, g.handle) }; // (whose gradient, what kind, and the angle as it turns)
  };

  /** Every handle on a shape names its value while the pointer is over it, not only while it is dragged (Radius, Ratio, Count, the gradient's ends). */
  const hoverHandleLabel = (s: ScreenPoint, boxLabel: string | null = null): void => {
    const tgt = gradientTarget();
    let text: string | null = boxLabel;
    let guide: ReturnType<typeof handleGuide> = null;
    if (tgt) {
      const open = editor.cornersOpen === tgt.o.id;
      const h = shapeHandles(tgt.po, open, editor);
      const pick = h && hitCornerHandle(h, s.x, s.y, open);
      if (pick && h) {
        const prm = paramsOf(tgt.o);
        guide = handleGuide(h, pick, open);
        text = pick.what === "ratio" ? `Ratio ${Math.round((prm?.inner ?? DEFAULT_INNER) * 100)}%` : pick.what === "count" ? `Count ${prm?.sides ?? prm?.tips ?? 0}` : `Radius ${Math.round((pick.what === "corner" ? pick.dot.px : h.main?.px ?? 0) * 10) / 10}`;
      } else {
        const gh = editor.tool === "node" || editor.cornersOpen === tgt.o.id ? null : gradientHandles(tgt.po, editor.gradientFocus);
        const hit = gh && hitGradient(gh, s.x, s.y);
        if (hit) text = gradientHandleLabel(gh!.which, gh!.g, hit);
      }
    }
    if (text) editor.handleLabel = editor.handleLabel?.text === text && !guide && boxLabel === text ? editor.handleLabel : { x: s.x, y: s.y, text, guide };
    else if (editor.handleLabel) editor.handleLabel = null;
    else return;
    editor.changed();
  };

  /** The region of the open Shape builder under a screen point, if any (regions already deleted are not there). */
  const builderFaceAt = (s: ScreenPoint): number | null => {
    const b = editor.builder;
    if (!b) return null;
    for (let i = 0; i < b.faces.length; i++) {
      if (b.deleted.has(i)) continue;
      const o = b.faces[i]!.obj;
      const cam = cameraIn(view.frameCamera, o.frame ?? b.world);
      const po = cam && projectObject(o, cam, view.viewport, { keepTiny: true });
      if (po && !po.cover && insideBody(po, s.x, s.y)) return i;
    }
    return null;
  };

  /** Every picked path whose nodes can be edited (the Edit nodes tool works on all of them, ADR 0145). */
  const nodeTargets = (): Array<{ po: ProjectedObject; o: PathObject }> =>
    visible().filter((p) => editor.selection.has(p.obj.id) && p.obj.kind === "path" && !p.cover && !p.obj.locked).map((po) => ({ po, o: po.obj as PathObject }));

  /** A press on a node of several picked paths or of nodes picked together: Shift toggles it in the set; otherwise the picked nodes (or this one) are dragged as one. */
  const startMultiNodePress = (e: PointerEvent, s: ScreenPoint, targets: Array<{ po: ProjectedObject; o: PathObject }>): boolean => {
    let best: { id: ObjectId; s: number; k: number; d: number } | null = null;
    for (const t of targets) {
      for (const n of nodesOnScreen(t.po)) {
        const d = Math.hypot(n.p[0] - s.x, n.p[1] - s.y);
        if (d <= NODE_REACH_PX && (!best || d < best.d)) best = { id: t.o.id, s: n.s, k: n.k, d };
      }
    }
    if (!best) return false;
    const key = `${best.s}:${best.k}`;
    const has = editor.nodeMulti.get(best.id)?.has(key) ?? false;
    if (e.shiftKey) {
      // the one node being edited joins the set
      if (editor.nodeSel && targets.length === 1 && editor.nodeMulti.size === 0) editor.nodeMulti.set(targets[0]!.o.id, new Set([`${editor.nodeSel.s}:${editor.nodeSel.k}`]));
      editor.nodeSel = null;
      const set = editor.nodeMulti.get(best.id) ?? new Set<string>();
      if (has) set.delete(key);
      else set.add(key);
      if (set.size) editor.nodeMulti.set(best.id, set);
      else editor.nodeMulti.delete(best.id);
      editor.changed();
      return true;
    }
    if (!has) {
      editor.nodeMulti.clear();
      editor.nodeMulti.set(best.id, new Set([key]));
    }
    editor.nodeSel = null;
    const bases = new Map<ObjectId, { po: ProjectedObject; sub: readonly SubPath[]; from: { x: number; y: number } }>();
    for (const id of editor.nodeMulti.keys()) {
      const t = targets.find((x) => x.o.id === id);
      if (t) bases.set(id, { po: t.po, sub: baked(t.o).sub, from: localOf(t.po, s.x, s.y) });
    }
    g = { kind: "nodes", pointerId: e.pointerId, start: s, bases, moved: false };
    editor.changed();
    return true;
  };

  const startNodePress = (e: PointerEvent, s: ScreenPoint): boolean => {
    if (editor.blockEdit()) return false;
    const targets = nodeTargets();
    if (targets.length > 1 || (targets.length === 1 && (e.shiftKey || editor.nodeMulti.size > 0))) {
      // (on the only picked path, a plain press on a node that is not one of the picked ones goes back to editing that one node)
      if (targets.length === 1 && !e.shiftKey) {
        const hit = hitNodes(targets[0]!.po, s.x, s.y, null);
        if (!(hit?.kind === "point" && editor.nodeMulti.get(targets[0]!.o.id)?.has(`${hit.s}:${hit.k}`))) editor.nodeMulti.clear();
        else return startMultiNodePress(e, s, targets);
      } else return startMultiNodePress(e, s, targets);
    }
    const tgt = nodeTarget();
    if (!tgt || editor.blockEdit()) return false;
    const hit = hitNodes(tgt.po, s.x, s.y, editor.nodeSel);
    if (!hit) return false;
    const base = baked(tgt.o).sub;
    const prev = editor.nodeSel;
    editor.nodeSel = { s: hit.s, k: hit.k };
    g = {
      kind: "node",
      pointerId: e.pointerId,
      id: tgt.o.id,
      what: hit.kind,
      s: hit.s,
      k: hit.k,
      t: hit.kind === "seg" ? hit.t : 0,
      prev,
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
    // Snapping a node (the Snap toggle): its x or y lines up with another node of this shape or of another shape in view, within SNAP_PX.
    editor.guides = null;
    if (g.what === "point" && editor.snap) {
      const { s: gs, k: gk } = g;
      const self = nodesOnScreen(tgt.po).find((n) => n.s === gs && n.k === gk);
      if (self) {
        const at = { x: self.p[0] + (s.x - g.start.x), y: self.p[1] + (s.y - g.start.y) };
        const others = [
          ...nodesOnScreen(tgt.po).filter((n) => n !== self),
          ...visible().filter((po) => po.obj.kind === "path" && po.obj.id !== tgt.o.id && !po.cover).flatMap((po) => nodesOnScreen(po)),
        ].slice(0, MAX_SNAP_TARGETS);
        const near = (v: number, key: 0 | 1): number | null => {
          let best: number | null = null;
          for (const n of others) if (Math.abs(n.p[key] - v) <= SNAP_PX && (best === null || Math.abs(n.p[key] - v) < Math.abs(best - v))) best = n.p[key];
          return best;
        };
        const sx = near(at.x, 0);
        const sy = near(at.y, 1);
        if (sx !== null) { s = { ...s, x: s.x + (sx - at.x) }; editor.guides = { x: sx }; }
        if (sy !== null) { s = { ...s, y: s.y + (sy - at.y) }; editor.guides = { ...editor.guides, y: sy }; }
      }
    }
    const l = localOf(tgt.po, s.x, s.y);
    const dx = l.x - g.startLocal.x;
    const dy = l.y - g.startLocal.y;
    const sp = g.base[g.s]!;
    const b = g.k * NODE;
    const sub =
      g.what === "point"
        ? (tgt.o.net ? moveNodes(g.base, [[g.s, g.k]], dx, dy) : moveNode(g.base, g.s, g.k, dx, dy))
        : moveHandle(g.base, g.s, g.k, g.what === "in" ? 2 : 4, sp.n[b + (g.what === "in" ? 2 : 4)]! + dx, sp.n[b + (g.what === "in" ? 3 : 5)]! + dy, g.smooth && !alt);
    editor.preview = { kind: "nodes", ids: [g.id], sub };
    editor.changed();
  };

  const finishNode = (cancelled: boolean): void => {
    if (g.kind !== "node") return;
    const gs = g;
    const p = editor.preview;
    editor.preview = { kind: "none" };
    editor.guides = null;
    const o = doc.get(gs.id);
    if (cancelled || !o || o.kind !== "path") return;
    if (gs.moved && p.kind === "nodes") return commitSub(o, p.sub, gs.what === "point" ? "Move node" : "Move handle");
    if (o.net && altHeld && !gs.moved) {
      // In a network, Alt on another end joins the two ends by an edge; Alt on an edge takes the edge away.
      const end = (si: number, ki: number): [number, number] | null => {
        const c = gs.base[si];
        return c && (ki === 0 || ki === nodeCount(c) - 1) ? [c.n[ki * NODE]!, c.n[ki * NODE + 1]!] : null;
      };
      if (gs.what === "seg") return commitSub(o, gs.base.filter((_, i) => i !== gs.s), "Delete edge");
      const a = gs.prev ? end(gs.prev.s, gs.prev.k) : null;
      const b = end(gs.s, gs.k);
      if (gs.what === "point" && a && b && (a[0] !== b[0] || a[1] !== b[1])) return commitSub(o, [...gs.base, edgeBetween(a, b)], "Add edge");
    }
    if (gs.what === "seg") {
      commitSub(o, splitSegment(gs.base, gs.s, gs.k, gs.t), "Add node");
      editor.nodeSel = { s: gs.s, k: gs.k + 1 };
    } else if (gs.what === "point" && altHeld) commitSub(o, toggleSmooth(gs.base, gs.s, gs.k), "Change node");
  };
  /**
   * Edit nodes, pointer over the path: a "+" cursor where a click adds a node, and a few words beside the pointer that name what the keys do there
   * (the same label the radius, ratio and count handles have).
   */
  const hoverNode = (s: ScreenPoint): void => {
    const tgt = nodeTarget();
    const hit = tgt ? hitNodes(tgt.po, s.x, s.y, editor.nodeSel) : null;
    el.classList.toggle("is-add", hit?.kind === "seg" && !tgt!.o.net);
    el.classList.toggle("is-node", hit?.kind === "point" || hit?.kind === "in" || hit?.kind === "out"); // (a node or a handle: it is taken and moved)
    const net = !!tgt?.o.net;
    const inside = !hit && !!tgt && pickAll(unlocked(visible()), s.x, s.y)[0]?.obj.id === tgt.o.id;
    // short, like the names the other handles give (Radius, Ratio, Count): what it is, then its key
    const text = !hit ? (inside ? "Lasso nodes" : null)
      : hit.kind === "seg" ? (net ? "Add node · Alt: cut" : "Add node")
      : hit.kind === "point" ? (net ? "Node · Alt: join · Del" : "Node · Alt: smooth · Del")
      : "Bend";
    if (text) editor.handleLabel = editor.handleLabel?.text === text && editor.handleLabel.x === s.x && editor.handleLabel.y === s.y ? editor.handleLabel : { x: s.x, y: s.y, text };
    else if (editor.handleLabel) editor.handleLabel = null;
    else return;
    editor.changed();
  };
  /** Alt held at the release of a press on a node: the click turns the node between a corner and smooth. */
  let altHeld = false;

  /** Delete the selected node (the path goes with its last one). Returns whether there was one. */
  const deleteNode = (): boolean => {
    if (editor.nodeMulti.size && !editor.blockEdit()) {
      // the nodes picked together, on every path that has some (one undo step)
      const upserts: PathObject[] = [];
      const removes: ObjectId[] = [];
      let count = 0;
      for (const [id, keys] of editor.nodeMulti) {
        const o = doc.get(id);
        if (o?.kind !== "path") continue;
        let sub = baked(o).sub;
        const list = [...keys].map((k) => k.split(":").map(Number) as [number, number]).sort((a, b) => b[0] - a[0] || b[1] - a[1]); // (last first, so the places of the others hold)
        if (o.net) {
          // a vertex takes all its edges; a node inside an edge is just taken out of it
          const gone = new Set<string>();
          for (const [si, ki] of list) {
            const c = sub[si];
            if (!c) continue;
            const ends = ki === 0 || ki === nodeCount(c) - 1;
            if (ends) gone.add(`${c.n[ki * NODE]},${c.n[ki * NODE + 1]}`);
          }
          const interior = list.filter(([si, ki]) => { const c = sub[si]; return !!c && ki !== 0 && ki !== nodeCount(c) - 1; });
          for (const [si, ki] of interior) sub = withNode(sub, si, ki, null);
          for (const v of gone) { const [vx, vy] = v.split(",").map(Number); sub = deleteVertex(sub, vx!, vy!); }
        } else for (const [si, ki] of list) sub = withNode(sub, si, ki, null);
        count += list.length;
        if (!sub.length) removes.push(id);
        else upserts.push(rebuilt(o, sub));
      }
      editor.nodeMulti.clear();
      if (!count) return false;
      for (const id of removes) editor.selection.delete(id);
      doc.commit(doc.transaction(count === 1 ? "Delete node" : `Delete ${count} nodes`, upserts, removes));
      editor.changed();
      return true;
    }
    const tgt = nodeTarget();
    const sel = editor.nodeSel;
    if (!tgt || !sel || editor.blockEdit()) return false;
    const sub0 = baked(tgt.o).sub;
    const picked = sub0[sel.s];
    const sub = tgt.o.net && picked && (sel.k === 0 || sel.k === nodeCount(picked) - 1) ? deleteVertex(sub0, picked.n[sel.k * NODE]!, picked.n[sel.k * NODE + 1]!) : withNode(sub0, sel.s, sel.k, null);
    editor.nodeSel = null;
    if (!sub.length) deleteSelection(doc, editor);
    else commitSub(tgt.o, sub, "Delete node");
    return true;
  };

  // ---- select -------------------------------------------------------------
  const startSelectPress = (e: PointerEvent, s: ScreenPoint): void => {
    const before = [...editor.selection]; // (a finger's press may pick on its way down: a long press gives that back)
    // Attach (ADR 0109): the next press names the object the picked ones follow.
    if (editor.attachMode) {
      editor.attachMode = false;
      const target = pickAll(unlocked(visible()), s.x, s.y)[0]?.obj;
      if (target) attachSelection(doc, editor, target.id);
      editor.changed();
      return;
    }
    if (startGradientPress(e, s) || startCornerPress(e, s)) return;
    // Ctrl or Cmd and a click on a link of a text opens it in a new tab (nothing is picked).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const top = pickAll(unlocked(visible()), s.x, s.y)[0];
      const url = top && top.obj.kind === "text" ? linkAt(top.obj, localOf(top, s.x, s.y)) : null;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
    }
    const vis = visible();
    // Rotate and resize handles take priority when a selection is visible.
    const sel = editor.selection.size ? selectedFrame(vis, editor, view.viewport) : null;
    if (sel && canRotate(vis, editor) && !editor.blockEdit()) {
      const { frame, handle } = sel;
      if (inRotateZone(s, frame, handle) && !itemLabelAt(hooks.labels(), s.x, s.y)) { // (a name above a sheet or picture is picked, not turned, even near a corner)
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
        // Crop mode: the handles move the window of the picture, not its size.
        const pic = ids.length === 1 && editor.cropId === ids[0] ? doc.get(ids[0]!) : undefined;
        const po = pic && vis.find((q) => q.obj.id === pic.id);
        if (pic?.kind === "image" && po && po.proj.ppu > 0 && Number.isFinite(po.proj.ppu)) {
          const [cx, cy] = sel.frame.centre;
          const sides = h.edge ? { l: h.edge === "w", r: h.edge === "e", t: h.edge === "n", b: h.edge === "s" } : { l: h.at[0] < cx, r: h.at[0] > cx, t: h.at[1] < cy, b: h.at[1] > cy };
          g = { kind: "crop", pointerId: e.pointerId, base: pic, sides, start: s, ppu: po.proj.ppu };
          return;
        }
        // Free (one-axis, or both axes apart) for upright pictures and for paths, turned or not, whose turn is the box's: strokes and text keep their shape.
        const turnOf = (rot: number | undefined): number => ((radiansFromAngle(rot ?? 0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const boxTurn = ((sel.frame.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const same = (rot: number | undefined): boolean => Math.abs(turnOf(rot) - boxTurn) < 1e-6 || Math.abs(Math.abs(turnOf(rot) - boxTurn) - 2 * Math.PI) < 1e-6;
        // (with a sheet, what is on it follows constraints: only the top objects decide whether the box may be stretched)
        const sheets = ids.some((id) => isContainer(doc.get(id)));
        const decide = sheets ? ids.filter((id) => !ids.includes(doc.get(id)!.parent ?? "")) : ids;
        const free = decide.length > 0 && decide.every((id) => {
          const o = doc.get(id)!;
          return o.kind === "path" ? same(o.rot) : o.kind === "image" && !o.rot && sel.frame.angle === 0;
        });
        g = {
          kind: "scale",
          pointerId: e.pointerId,
          ids,
          sheets: (replaceCommit = "", sheets),
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
          size0: { w: Math.hypot(sel.frame.corners[1][0] - sel.frame.corners[0][0], sel.frame.corners[1][1] - sel.frame.corners[0][1]), h: Math.hypot(sel.frame.corners[2][0] - sel.frame.corners[1][0], sel.frame.corners[2][1] - sel.frame.corners[1][1]) },
        };
        return;
      }
    }
    // The name above an item picks it (a sheet and what is on it), and a drag from it moves them (ADR 0108, 0125).
    const named = itemLabelAt(hooks.labels(), s.x, s.y);
    const sheet = named ? doc.get(named.id) : undefined;
    if (sheet && !sheet.locked) {
      if (!editor.selection.has(sheet.id)) pick([sheet.id], e.shiftKey);
      g = { kind: "press", pointerId: e.pointerId, start: s, target: sheet, additive: false };
      return;
    }
    const hits = pickAll(unlocked(vis), s.x, s.y);
    let target: CanvasObject | null = hits[0]?.obj ?? null;
    // The empty body of a sheet that has things on it is ground, not the sheet: a click there clears, a drag draws the selection box, so
    // the sheet is not moved or picked by accident. It is picked by its name, its Layers row, or a box over it; a sheet with nothing on it
    // is picked by a click, as there is nothing else to pick there.
    if (target && isContainer(target) && !isMaskSheet(target) && hasThingsOn(target)) target = null;
    // Ctrl (or Cmd) and a click picks the very thing under the pointer, however deep it is in a group or a mask, ground or not (what the outlines show).
    // (Shift adds the thing to what is picked or takes it away; Alt goes on to the one below the one already picked)
    const deep = isDeepPress({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey }) ? deepPick(revealHits(vis, s.x, s.y), editor.selection, e.altKey, s) : null;
    if (deep) {
      target = deep.obj;
      editor.entered = [...(target.groups ?? [])];
      editor.openMask = maskAbove(target)?.id ?? null;
    }
    let click: CanvasObject | undefined;
    // A picked thing can be taken by its outline even when a filled shape covers it (what Ctrl+click on a revealed outline picked): a drag from
    // there moves it; a click that does not move picks the thing on top, as it always did.
    if (!deep && !e.altKey && !e.shiftKey && target && editor.selection.size && !editor.selection.has(target.id)) {
      const held = revealHits(vis, s.x, s.y).find((h) => editor.selection.has(h.obj.id) && edgeDistancePx(h, s.x, s.y) <= EDGE_PICK_PX);
      if (held) {
        click = target;
        target = held.obj;
      }
    }
    if (e.altKey && hits.length > 1) {
      cycleIndex = (cycleIndex + 1) % hits.length;
      const next = hits[cycleIndex]!.obj;
      // Alt on something already picked is a drag that carries a copy (a thing on a sheet has the sheet under it, so more than one thing is always
      // under the pointer): the drag is of the picked one, and only a click that does not move goes on to the next thing down.
      const held = hits.find((h) => editor.selection.has(h.obj.id))?.obj;
      if (held) {
        target = held;
        click = next;
      } else target = next;
    } else {
      cycleIndex = 0;
    }
    g = { kind: "press", pointerId: e.pointerId, start: s, target, additive: e.shiftKey, ...(click ? { click } : {}), ...(deep ? { exact: true } : {}) };
    if (e.pointerType === "touch") {
      // A finger cannot hover or hold Ctrl: held still, it lists everything under it to choose from (the same shapes Ctrl+hover outlines)
      const held = g;
      window.setTimeout(() => {
        if (g !== held) return; // (it moved, lifted or became a pinch)
        const all = revealHits(visible(), s.x, s.y);
        if (!all.length) return;
        g = { kind: "none" };
        if (before.length !== editor.selection.size || before.some((id) => !editor.selection.has(id))) editor.select(before);
        editor.fingerListAt = performance.now();
        navigator.vibrate?.(10);
        hooks.revealList(s, all.map((h) => h.obj), (id, additive) => {
          const o = doc.get(id);
          if (!o) return;
          editor.entered = [...(o.groups ?? [])];
          editor.openMask = maskAbove(o)?.id ?? null;
          pick([id], additive);
        });
      }, LONG_PRESS_MS);
    }
  };

  const pressBecomesDrag = (gp: Extract<Gesture, { kind: "press" }>, s: ScreenPoint, alt = false): void => {
    const t = gp.target;
    // Only what is already selected moves: a press-and-slide on anything else (a shape, a path, a stroke, like a picture) draws the selection box.
    const draggable = t && editor.selection.has(t.id) && !editor.readOnly;
    if (t && draggable) {
      // Alt held as the drag starts: the drag carries a copy (placed exactly on the original) and the original stays.
      if (alt && !editor.blockEdit()) duplicateSelection(doc, editor, view, 0);
      // A sheet always carries what is on it, picked with it or not.
      const picked = [...editor.selection].filter((id) => doc.get(id));
      const carried = descendantsOf(doc.all(), new Set(picked.filter((id) => isContainer(doc.get(id)))));
      const ids = [...new Set([...picked, ...carried])];
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

  /**
   * What was moved goes into the sheet under the pointer where it was let go, or onto the canvas when there is none (ADR 0108): the objects
   * not already inside another moved one change their `parent`, and what changed parent is put in front so that it is not under its frame.
   */
  const intoFrame = (moved: CanvasObject[]): CanvasObject[] => {
    if (![...doc.all()].some((o) => isContainer(o)) || editor.readOnly) return moved;
    const ids = new Set(moved.map((o) => o.id));
    const target = sheetAt(pointer.x, pointer.y, ids)?.id;
    const changed = new Set<ObjectId>();
    const reparented = moved.map((o) => {
      if (o.parent !== undefined && ids.has(o.parent)) return o;
      if (o.parent === target) return o;
      changed.add(o.id);
      const { parent: _p, ...rest } = o;
      return (target ? { ...rest, parent: target } : rest) as CanvasObject;
    });
    if (!changed.size) return moved;
    const front = restack(reparented, doc.ordered().filter((o) => !ids.has(o.id)), "front");
    const z = new Map(front.map((o) => [o.id, o.z]));
    return reparented.map((o) => ({ ...o, z: z.get(o.id) ?? o.z }) as CanvasObject);
  };

  /** The preview now on screen is a `replace` of every object a gesture changes (a sheet resize, a crop): what it is called in the undo list. */
  let replaceCommit = "";
  const commitPreviewNow = (): void => {
    const p = editor.preview;
    if (replaceCommit) {
      const label = replaceCommit;
      replaceCommit = "";
      if (p.kind === "replace") {
        const n = [...p.objs.values()].map((o) => homeObject(o, doc.space));
        editor.preview = { kind: "none" };
        doc.commit(doc.transaction(label, n));
        return;
      }
    }
    // The committed state is exactly the previewed one, then re-homed if it left its frame's bounds.
    const next = (ids: readonly ObjectId[]): CanvasObject[] =>
      ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o).map((o) => homeObject(editor.previewed(o)!, doc.space));
    if (p.kind === "move" && !(p.dx.m === 0n && p.dy.m === 0n)) {
      const n = intoFrame(next(p.ids));
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
    if (off()) return;
    const s = local(e);
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    if (editor.sourcePick) {
      // choosing the source of a texture fill: what is under the press is given to it, nothing is picked or started
      const top = pickAll(visible(), s.x, s.y)[0]?.obj;
      editor.sourcePick.take(top ? expandToUnits(doc.ordered(), [top], editor.entered).map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o) : []);
      return;
    }
    if (editor.tool === "eyedropper" && e.button === 0 && !spaceDown) {
      const dpr = window.devicePixelRatio || 1;
      // shortcut: on screen the square is in device px and includes what is drawn over the canvas (guides, handles); a host that can read its page does
      const c = hooks.sample ? hooks.sample(s, editor.sampleSize) : sampleAt(el as HTMLCanvasElement, s.x * dpr, s.y * dpr, editor.sampleSize);
      if (c) {
        editor.penColor = c;
        editor.changed();
      }
      return;
    }
    // A gesture whose pointer is gone (its release was lost) must not block this press, nor undo and redo.
    if ("pointerId" in g && g.pointerId !== e.pointerId && !active.has(g.pointerId)) cancelGesture();
    const touch = e.pointerType === "touch";
    // The first finger of a touch (isPrimary: the browser says no other is down) starts afresh: a finger whose lift was lost, or that the system took for
    // its own gesture (three fingers), must not count as one more, or a tap is never seen as a tap and a single finger pans.
    if (touch && e.isPrimary) {
      for (const [id, a] of [...active]) if (a.touch && id !== e.pointerId) { active.delete(id); pan.remove(id); }
      extras.clear();
      window.clearTimeout(modTimer);
      touchShift = false;
      touchAlt = false;
      tap = null;
      if (g.kind === "pan") {
        g = { kind: "none" };
        el.classList.remove("is-panning");
      }
    }
    active.set(e.pointerId, { p: s, touch, s0: s });
    const touchesDown = [...active.values()].filter((a) => a.touch).length;
    if (touch) {
      if (touchesDown === 1) {
        tap = { t: performance.now(), last: performance.now(), count: 1, moved: false, cam: view.camera };
        // right after the lift of a tap or pinch a lone finger starts nothing yet (a pen would draw a dot, and an edit clears redo): it waits for a second finger
        if (performance.now() - multiEndAt < AFTER_MULTI_MS) return;
      } else if (tap) {
        tap.count = Math.max(tap.count, touchesDown);
        tap.last = performance.now();
      }
      // While a handle is dragged, the fingers that come after it are keys (see above), not a pinch.
      if (touchesDown >= 2 && keyedGesture() && "pointerId" in g && g.pointerId !== e.pointerId) {
        extras.add(e.pointerId);
        tap = null;
        window.clearTimeout(modTimer);
        modTimer = window.setTimeout(applyKeys, KEY_HOLD_MS); // (held a moment: a brush of a finger is not a key)
        return;
      }
    }
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
    if (editor.builder) {
      // The Shape builder: a stroke across regions merges them (Alt: deletes them).
      editor.builder.removing = e.altKey;
      const first = builderFaceAt(s);
      editor.builder.touched = first === null ? [] : [first];
      g = { kind: "builder", pointerId: e.pointerId };
      editor.changed();
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
        sheetStart = sheetAt(s.x, s.y)?.id;
        editor.draft = { frame: view.frame, anchor: world(s), unit: -cam.zi, points: [], width: px / f, color: newInk(editor.penColor), kind: editor.penKind, ...(editor.penKind === "ink" ? { pressure: [], speed: [] } : {}), ...(editor.penKind === "ink" || editor.penKind === "pencil" ? { tilt: [], tiltAz: [] } : {}) };
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
        const gs = { kind: "erase" as const, pointerId: e.pointerId, last: s, picked: new Set<ObjectId>(), trail: [s] };
        g = gs;
        sweep(gs, s);
        editor.changed();
        break;
      }
      case "select":
        startSelectPress(e, s);
        break;
      case "text":
      case "note":
        g = { kind: "text", pointerId: e.pointerId, start: s, moved: false };
        break;
      case "shape":
      case "sheet":
        startShape(s, e);
        break;
      case "path":
        startPathNode(s, e);
        break;
      case "node": {
        if (startNodePress(e, s) || startGradientPress(e, s)) break;
        // Inside a region of the one picked network: a click picks the region, and the fill then colours it alone (ADR 0150).
        const net = nodeTarget();
        if (net?.o.net && !editor.blockEdit()) {
          const l = localOf(net.po, s.x, s.y);
          const at = cellAt(baked(net.o).sub, l.x, l.y);
          if (at !== null) {
            editor.region = { id: net.o.id, at };
            editor.message = "Region picked: change the fill to colour it alone.";
            editor.changed();
            break;
          }
        }
        editor.region = null;
        // Not on a node: a click picks the path to edit (or clears), a drag from nothing is a box.
        const hit = pickAll(unlocked(visible()), s.x, s.y)[0]?.obj ?? null;
        if (nodeTargets().length && !editor.blockEdit()) {
          // a drag from anywhere that is not a node or an edge, inside a shape too, draws a lasso round nodes to pick (the shape is not moved here: that is the Select
          // tool's); a click without a drag picks what is under it, or clears the selection
          g = { kind: "nodelasso", pointerId: e.pointerId, additive: e.shiftKey, target: hit };
          editor.lasso = [s.x, s.y];
          break;
        }
        g = { kind: "press", pointerId: e.pointerId, start: s, target: hit, additive: e.shiftKey };
        break;
      }
      default:
        break;
    }
  };

  /** The fingers resting beside the one on the handle are Shift (one) and Alt (two); the canvas redraws the drag as the keys change. */
  const applyKeys = (): void => {
    const shift = extras.size === 1;
    const alt = extras.size >= 2;
    if (shift === touchShift && alt === touchAlt) return;
    touchShift = shift;
    touchAlt = alt;
    touchFlash(alt ? "Alt on while two fingers rest" : shift ? "Shift on while a finger rests" : "Keys off");
    if (keyedGesture() && lastMove) onPointerMove(lastMove);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (off() && g.kind === "none") return;
    let boxLabel: string | null = null;
    const a = active.get(e.pointerId);
    if (a) a.p = local(e);
    if (extras.has(e.pointerId)) return; // (a resting finger is a key, it does not steer anything)
    if (a && a.touch && tap && Math.hypot(a.p.x - a.s0.x, a.p.y - a.s0.y) > TAP_SLOP_PX) tap.moved = true;
    if (a?.touch && keyedGesture() && "pointerId" in g && g.pointerId === e.pointerId) lastMove = e;
    if (pan.has(e.pointerId)) {
      pan.move(e.pointerId, local(e));
      return;
    }
    reveal.move(local(e), e.ctrlKey || e.metaKey);
    if (g.kind === "none" && effectiveTool() === "select" && !e.buttons) {
      // A rotate cursor where a press would turn the selection (near a corner outside the box, or on the handle).
      const b = editor.selectionBoxOnScreen;
      const p = local(e);
      const rotating = !!b && b.rotatable && inRotateZone(p, b.frame, b.handle) && !itemLabelAt(hooks.labels(), p.x, p.y);
      el.classList.toggle("is-rotate", rotating);
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
      boxLabel = rotating ? "Rotate" : hit ? (hit.edge ? (hit.edge === "n" || hit.edge === "s" ? "Resize height" : "Resize width") : "Resize") : null;
    }
    if (g.kind === "none" && effectiveTool() === "select" && !e.buttons) hoverHandleLabel(local(e), boxLabel);
    if (effectiveTool() !== "node" || g.kind !== "none" || e.buttons) el.classList.remove("is-add", "is-node");
    else hoverNode(local(e));
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
    if (editor.builder && g.kind === "none") {
      const h = builderFaceAt(local(e));
      if (h !== editor.builder.hover) {
        editor.builder.hover = h;
        editor.changed();
      }
      return;
    }
    if (!("pointerId" in g) || g.pointerId !== e.pointerId) return;
    const s = local(e);
    switch (g.kind) {
      case "builder": {
        const f = builderFaceAt(s);
        if (f !== null && editor.builder && !editor.builder.touched.includes(f)) {
          editor.builder.touched.push(f);
          editor.changed();
        }
        break;
      }
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
      case "nodelasso":
      case "cornerlasso":
        editor.lasso!.push(s.x, s.y);
        editor.changed();
        break;
      case "nodes": {
        if (!g.moved && Math.hypot(s.x - g.start.x, s.y - g.start.y) < DRAG_THRESHOLD_PX) break;
        g.moved = true;
        const subs = new Map<ObjectId, readonly SubPath[]>();
        for (const [id, b] of g.bases) {
          const l = localOf(b.po, s.x, s.y);
          const picks = [...(editor.nodeMulti.get(id) ?? [])].map((key) => key.split(":").map(Number) as [number, number]);
          // (an end of an edge of a network moves its whole vertex: moveNodes does that; a plain path moves the nodes one by one)
          const o = doc.get(id);
          subs.set(id, o?.kind === "path" && o.net ? moveNodes(b.sub, picks, l.x - b.from.x, l.y - b.from.y) : picks.reduce((acc, [si, ki]) => moveNode(acc, si, ki, l.x - b.from.x, l.y - b.from.y), b.sub));
        }
        editor.preview = { kind: "nodes", ids: [...subs.keys()], sub: [...subs.values()][0]!, subs };
        editor.changed();
        break;
      }
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
        if (keys(e).shift) {
          // Whole 15 degree steps: of the stroke's own angle when one is selected, else of the turn.
          // (A step is TURN / 24, not a whole number; the angle stored must be one.)
          delta = Math.round(Math.round((g.rot0 + delta) / ANGLE_STEP) * ANGLE_STEP) - g.rot0;
        }
        editor.preview = { kind: "rotate", ids: g.ids, frame: g.frame, about: g.about, delta };
        // the turn the box has now, in degrees, beside the finger or pointer
        const deg = (normAngle(g.rot0 + delta) / TURN) * 360;
        editor.handleLabel = { x: s.x, y: s.y, text: `${Number(deg.toFixed(1))}°` };
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
      case "text":
        // A box dragged out on empty canvas: a text of that width (a click makes one as wide as its words).
        if (!g.moved && Math.hypot(s.x - g.start.x, s.y - g.start.y) >= DRAG_THRESHOLD_PX && !editor.blockEdit() && !textAt(g.start)) {
          g.moved = true;
          editor.shapeDraft = { frame: view.frame, anchor: world(g.start), unit: -view.camera.zi, kind: "rect", bx: 0, by: 0, bw: 0, bh: 0, sides: 6, tips: 5, fill: null, stroke: "#2563eb", width: 1 / 2 ** view.camera.zf };
        }
        if (g.moved) updateShape(s, e);
        break;
      case "pathnode":
        if (!g.dragging && Math.hypot(s.x - g.start.x, s.y - g.start.y) >= DRAG_THRESHOLD_PX) g.dragging = true;
        if (g.dragging) dragPathHandle(s);
        break;
      case "node":
        updateNode(s, keys(e).alt);
        break;
      case "crop": {
        const dx = (s.x - g.start.x) / g.ppu, dy = (s.y - g.start.y) / g.ppu; // (local units: an upright picture's box is aligned with the screen)
        const next = cropEdges(g.base, g.sides.l ? dx : 0, g.sides.t ? dy : 0, g.sides.r ? -dx : 0, g.sides.b ? -dy : 0);
        editor.preview = { kind: "replace", ids: [next.id], objs: new Map([[next.id, next]]) };
        replaceCommit = "Crop picture";
        editor.changed();
        break;
      }
      case "scale": {
        const { kx, ky, fixed } = scaleFactors(g, s, { shift: keys(e).shift, alt: keys(e).alt, noSnap: e.ctrlKey || e.metaKey });
        // the shape of the box as it is resized, as a ratio (width : height), beside the finger or pointer
        if (g.size0.w > 0 && g.size0.h > 0 && kx > 0 && ky > 0) editor.handleLabel = { x: s.x, y: s.y, text: formatRatio((g.size0.w * kx) / (g.size0.h * ky)) };
        if (g.sheets) {
          const plan = planSheetScale(g.ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o), worldIn(fixed, g.frame), kx, ky, editor.lock !== null, editor.lockRadius);
          editor.preview = { kind: "replace", ids: [...plan.keys()], objs: plan };
          replaceCommit = "Resize";
        } else editor.preview = { kind: "scale", ids: g.ids, frame: g.frame, fixed: worldIn(fixed, g.frame), kx, ky, keepWidth: editor.lock !== null, keepRadius: editor.lockRadius };
        editor.changed();
        break;
      }
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    const wasTouch = active.get(e.pointerId)?.touch === true;
    active.delete(e.pointerId);
    if (extras.delete(e.pointerId)) {
      window.clearTimeout(modTimer);
      applyKeys(); // (a key lifted: off at once)
      return;
    }
    if (wasTouch && [...active.values()].filter((a) => a.touch).length === 0) {
      if (tap && tap.count >= 2) multiEndAt = performance.now();
      window.clearTimeout(modTimer);
      extras.clear();
      touchShift = false;
      touchAlt = false;
      const t = tap;
      tap = null;
      if (t && e.type === "pointerup" && !t.moved && t.count >= 2 && t.count <= 3 && performance.now() - t.last < TAP_MS && performance.now() - t.t < TAP_ALL_MS) {
        // A quick tap of two or three fingers: undo or redo, and the view as it was before the fingers jiggled it
        pan.remove(e.pointerId);
        view.setCamera(t.cam);
        el.classList.remove("is-panning");
        cancelGesture();
        const had = t.count === 2 ? doc.canUndo : doc.canRedo;
        if (t.count === 2) doUndo();
        else doRedo();
        navigator.vibrate?.(had ? 10 : [10, 40, 10]);
        editor.message = had ? (t.count === 2 ? "Undo" : "Redo") : t.count === 2 ? "Nothing to undo" : "Nothing to redo (an edit after an undo clears redo)";
        multiEndAt = performance.now();
        editor.changed();
        return;
      }
    }
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
    if (g.kind === "scale" || g.kind === "rotate") editor.handleLabel = null; // (the number beside the pointer goes with the drag)
    switch (g.kind) {
      case "erase": {
        if (editor.eraseParts) {
          editor.eraser = { at: s, boxes: [] };
          if (!cancelled) erasePartsOf(g);
          break;
        }
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
        const t = g.click ?? g.target;
        if (t) {
          if (g.additive && editor.selection.has(t.id)) {
            editor.selection.delete(t.id);
            editor.changed();
          } else if (g.exact) {
            editor.select([t.id], g.additive); // Ctrl+click: exactly this thing (a sheet without what is on it)
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
        editor.guides = null;
        if (cancelled || p.kind !== "paint") editor.preview = { kind: "none" };
        else commitPaint(doc, editor, { [g.which]: p[g.which] as Gradient });
        break;
      }
      case "crop": {
        const p = editor.preview;
        if (cancelled || p.kind !== "replace" || !replaceCommit) editor.preview = { kind: "none" };
        else commitPreview();
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
      case "builder": {
        const b = editor.builder;
        if (b && !cancelled) {
          if (b.removing) for (const i of b.touched) b.deleted.add(i);
          else if (b.touched.length >= 2) {
            // the regions crossed are one shape now, with any group they were already part of
            const joined = new Set(b.touched);
            const keep = b.merged.filter((grp) => !grp.some((i) => joined.has(i)));
            for (const grp of b.merged) if (grp.some((i) => joined.has(i))) for (const i of grp) joined.add(i);
            b.merged = [...keep, [...joined]];
          }
        }
        if (b) b.touched = [];
        break;
      }
      case "nodes": {
        const p = editor.preview;
        editor.preview = { kind: "none" };
        if (cancelled || !g.moved || p.kind !== "nodes" || !p.subs) break;
        const objs = [...p.subs].flatMap(([id, sub]) => {
          const o = doc.get(id);
          return o?.kind === "path" ? [rebuilt(o, sub)] : [];
        });
        if (objs.length) doc.commit(doc.transaction(objs.length === 1 ? "Move nodes" : `Move nodes of ${objs.length} paths`, objs));
        break;
      }
      case "cornerlasso": {
        const poly = editor.lasso;
        editor.lasso = null;
        if (cancelled || !poly) break;
        const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1);
        if (Math.max(...xs) - Math.min(...xs) < DRAG_THRESHOLD_PX && Math.max(...ys) - Math.min(...ys) < DRAG_THRESHOLD_PX) {
          editor.cornerSel = null;
          if (!g.additive && !g.target) editor.select([]); // a click on empty ground clears, as it did (on the shape or another one it keeps the pick)
          break;
        }
        const tgt = gradientTarget();
        const h = tgt && tgt.o.id === g.id ? shapeHandles(tgt.po, true, editor) : null;
        if (!h) break;
        const inside = h.corners.filter((d) => pointInPolygon(d.x, d.y, poly)).map((d) => d.index);
        const prev = g.additive && editor.cornerSel?.id === g.id ? editor.cornerSel.idx : new Set<number>();
        editor.cornerSel = inside.length || prev.size ? { id: g.id, idx: new Set([...prev, ...inside]) } : null;
        break;
      }
      case "nodelasso": {
        const poly = editor.lasso;
        editor.lasso = null;
        if (cancelled || !poly) break;
        const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1);
        if (Math.max(...xs) - Math.min(...xs) < DRAG_THRESHOLD_PX && Math.max(...ys) - Math.min(...ys) < DRAG_THRESHOLD_PX) {
          if (g.target) {
            // a click on a shape picks it to edit (Shift adds it or takes it away)
            const ids = new Set(g.additive ? editor.selection : []);
            if (ids.has(g.target.id) && g.additive) ids.delete(g.target.id);
            else ids.add(g.target.id);
            editor.select([...ids]);
          } else if (!g.additive) editor.select([]); // a click on empty ground clears, as it did
          break;
        }
        const next = new Map<ObjectId, Set<string>>(g.additive ? [...editor.nodeMulti].map(([id, set]) => [id, new Set(set)]) : []);
        for (const t of nodeTargets()) {
          for (const n of nodesOnScreen(t.po)) {
            if (!pointInPolygon(n.p[0], n.p[1], poly)) continue;
            const set = next.get(t.o.id) ?? new Set<string>();
            set.add(`${n.s}:${n.k}`);
            next.set(t.o.id, set);
          }
        }
        editor.nodeSel = null;
        editor.nodeMulti = next;
        break;
      }
      case "text":
        // Opened after the pointer is released, so the editor keeps the focus.
        editor.shapeDraft = null;
        if (cancelled || editor.blockEdit()) break;
        if (g.moved && Math.abs(s.x - g.start.x) >= MIN_TEXT_BOX_PX) hooks.editText(null, world({ x: Math.min(s.x, g.start.x), y: Math.min(s.y, g.start.y) }), { widthPx: Math.abs(s.x - g.start.x) });
        else hooks.editText(textAt(g.start), world(g.start));
        break;
    }
    g = { kind: "none" };
    editor.changed();
  };

  const onDoubleClick = (e: MouseEvent): void => {
    if (off()) return;
    if (performance.now() - editor.fingerListAt < 1500) return; // (the lift of a long press is not the second click of a double-click)
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
      const dots = shapeHandles(unit.po, open, editor);
      const pick = dots && hitCornerHandle(dots, s.x, s.y, open);
      if (pick?.what === "main") {
        toggleCorners(unit.o.id);
        return;
      }
    }
    // A double-click on what a clipping mask cuts goes into the mask: from then on its things are picked one by one.
    const hit = pickAll(unlocked(visible()), s.x, s.y)[0]?.obj;
    const mask = hit ? maskAbove(hit) : null;
    if (hit && mask) {
      editor.openMask = mask.id;
      editor.select(expandToUnits(doc.ordered(), [hit], editor.entered));
      editor.changed();
      return;
    }
    // A double-click on a grouped object goes one group deeper; once inside, it edits (text) as before.
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
    // A double click on the empty body of a sheet with things on it does nothing (it is ground, as for a click).
    if (hit && isContainer(hit) && !isMaskSheet(hit) && hasThingsOn(hit)) return;
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
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!shortcutsActive(e, hooks.scope ?? "canvas") || (hooks.keysActive ? !hooks.keysActive() : off())) return;
    if (e.key === "Control" || e.key === "Meta") reveal.key(true);
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (editor.builder && g.kind === "none" && (e.key === "Enter" || e.key === "Escape")) {
      finishShapeBuilder(doc, editor, e.key === "Enter");
      e.preventDefault();
      return;
    }
    if (mod && key === "z") {
      if (g.kind !== "none") return;
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (mod && key === "y") {
      if (g.kind === "none") doRedo();
    } else if (mod && key === "a") {
      // everything that shows (the members of a boolean group are what its result is made of: they go with it, and are shown only inside it)
      const shown = doc.ordered().filter((o) => !o.hidden && !o.locked && boolGroupsOf(o).every((g) => g.own || editor.entered.includes(g.gid)));
      editor.select(expandToUnits(doc.ordered(), shown, editor.entered));
    } else if (mod && key === "d") {
      e.preventDefault(); // not the browser's bookmark
      duplicateSelection(doc, editor, view);
    } else if (mod && e.altKey && key === "g") {
      e.preventDefault();
      sheetSelection(doc, editor);
    } else if (mod && key === "g") {
      if (e.shiftKey) ungroupSelection(doc, editor);
      else groupSelection(doc, editor);
    } else if (mod && key === "e") {
      e.preventDefault(); // not the browser's search
      flattenSelection(doc, editor);
    } else if (mod && (e.key === "]" || e.key === "[")) {
      arrangeSelection(doc, editor, e.key === "]" ? "front" : "back");
    } else if (mod && e.key === " ") {
      // The focus key (the keymap sends F here as Ctrl+Space) brings the selection into view; again: everything visible at this zoom (the cycle is in item-navigation.ts)
      e.preventDefault();
      if (!e.repeat && g.kind === "none") hooks.focusSelection();
    } else if (mod || e.altKey) {
      return;
    } else if (e.key === "#" || e.key === "@") {
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
    } else if (e.key === "Enter" && e.shiftKey && editor.tool === "select" && g.kind === "none" && outOfSheet()) {
      // (Shift+Enter: the sheet that holds what is picked)
    } else if (e.key === "Enter" && !e.shiftKey && editor.tool === "select" && g.kind === "none" && intoSheet()) {
      // (Enter: what is on the picked sheet)
    } else if (e.key === "Enter" && editor.tool === "node") {
      editor.setTool("select"); // Enter finishes editing nodes, like Esc
    } else if (e.key === "Enter" && editor.tool === "select" && g.kind === "none" && (editor.cropId || (editor.selection.size === 1 && (() => { const q = doc.get([...editor.selection][0]!); return q?.kind === "image" && !q.media && !q.rot && !q.locked; })()))) {
      editor.cropId = editor.cropId ? null : [...editor.selection][0]!; // Enter on a still picture starts cropping it, and finishes
      editor.changed();
    } else if (e.key === "Enter" && editor.tool === "select" && g.kind === "none" && editor.selection.size === 1 && doc.get([...editor.selection][0]!)?.kind === "path" && !doc.get([...editor.selection][0]!)?.locked) {
      editor.setTool("node"); // Enter on a shape edits its nodes
    } else if (e.key === "Escape") {
      if (editor.attachMode || editor.cropId) {
        editor.attachMode = false; // Esc leaves Attach, or Crop, first
        editor.cropId = null;
        editor.changed();
      } else if (editor.pathDraft) commitPath(false); // Esc ends the path being drawn, open
      else if (g.kind !== "none" && g.kind !== "pan") cancelGesture();
      else if (editor.tool !== "select") editor.setTool("select"); // Esc: back to the Select tool
      else if (editor.openMask) {
        // Leave the clipping mask that was gone into: the mask is picked again, whole.
        const m = doc.get(editor.openMask);
        editor.openMask = null;
        editor.select(m ? expandToUnits(doc.ordered(), [m], editor.entered) : []);
      } else if (editor.entered.length) {
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
    if (e.key === "Control" || e.key === "Meta") reveal.key(false);
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
    reveal.move(null, false);
    delete el.dataset["hover"];
    el.classList.remove("is-add", "is-node");
    if (g.kind === "none" && editor.handleLabel) {
      editor.handleLabel = null;
      editor.changed();
    }
  };
  el.addEventListener("pointerleave", onLeave);
  // Leaving the Path tool ends the path being drawn (open).
  let hadSelection = false;
  const unsubscribe = editor.subscribe(() => {
    if (editor.pathDraft && editor.tool !== "path") commitPath(false);
    const has = editor.selection.size > 0;
    if (g.kind === "none") {
      // Radius and node editing end by themselves when the shape is let go (a click elsewhere, Esc, delete) or another one is picked.
      if (editor.cornersOpen !== null && !(editor.selection.size === 1 && editor.selection.has(editor.cornersOpen))) {
        editor.cornersOpen = null;
        editor.cornerSel = null;
      }
      if (editor.tool === "node" && hadSelection && !has && !editor.pathDraft) editor.setTool("select");
      hadSelection = has; // (not while a gesture runs: a lasso that clears the selection ends the mode when it is over)
    }
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
