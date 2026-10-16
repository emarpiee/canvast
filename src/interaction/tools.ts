import type { NavDir } from "./item-navigation";
import { canvasShortcutsActive } from "./shortcut-scope";
import * as D from "../core/dyadic";
import type { ScreenPoint, WorldPoint } from "../core/camera";
import { screenToWorld } from "../core/camera";
import type { ViewState } from "../app/view-state";
import type { EditorState, Tool } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ObjectId, StrokeObject, TextObject } from "../doc/model";
import { homeObject, newObjectId } from "../doc/model";
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
import { TURN, angleFromRadians } from "../core/angle";
import { PanGesture } from "./navigation";
import { arrangeSelection, deleteSelection, duplicateSelection, groupSelection, redo, ungroupSelection, undo } from "../app/actions";
import { expandToUnits, groupObjects, isInside } from "../doc/groups";

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
  | {
      kind: "scale";
      pointerId: number;
      ids: ObjectId[];
      fixed: ScreenPoint;
      frame: Frame;
      fixedWorld: WorldPoint;
      start: ScreenPoint;
      uniform: boolean;
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
  /** Ctrl+arrow: step the selection to a neighbouring item (ADR 0058). */
  navigate(dir: NavDir): void;
  /** Alt: bring the selection into view. */
  focusSelection(): void;
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
    const all = visibleObjects(doc, index, null, view.frameCamera, view.viewport);
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

  // ---- select -------------------------------------------------------------
  const startSelectPress = (e: PointerEvent, s: ScreenPoint): void => {
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
          rot0: single?.rot ?? 0,
        };
        return;
      }
    }
    if (sel) {
      const corners = sel.frame.corners;
      for (let i = 0; i < 4; i++) {
        const [hx, hy] = corners[i]!;
        if (Math.abs(s.x - hx) <= HANDLE_SIZE_PX && Math.abs(s.y - hy) <= HANDLE_SIZE_PX && !editor.blockEdit()) {
          const [fx, fy] = corners[(i + 2) % 4]!;
          const ids = [...editor.selection].filter((id) => doc.get(id));
          // A turned image resizes uniformly: stretching its bounding box would shear it. So does anything in a turned box.
          const onlyImage = ids.length === 1 && doc.get(ids[0]!)?.kind === "image" && !doc.get(ids[0]!)?.rot && sel.frame.angle === 0;
          g = {
            kind: "scale",
            pointerId: e.pointerId,
            ids,
            fixed: { x: fx, y: fy },
            frame: view.frame,
            fixedWorld: world({ x: fx, y: fy }),
            start: { x: hx, y: hy },
            uniform: !(onlyImage && e.shiftKey),
          };
          return;
        }
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

  const pressBecomesDrag = (gp: Extract<Gesture, { kind: "press" }>, s: ScreenPoint): void => {
    const t = gp.target;
    const draggable = t && (t.kind === "stroke" || editor.selection.has(t.id)) && !editor.readOnly;
    if (t && draggable) {
      if (!editor.selection.has(t.id)) pick([t.id], gp.additive);
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

  const scaleFactors = (gs: Extract<Gesture, { kind: "scale" }>, s: ScreenPoint): { kx: number; ky: number } => {
    const sx = gs.start.x - gs.fixed.x;
    const sy = gs.start.y - gs.fixed.y;
    let kx = sx !== 0 ? (s.x - gs.fixed.x) / sx : 1;
    let ky = sy !== 0 ? (s.y - gs.fixed.y) / sy : 1;
    if (gs.uniform) {
      // Project onto the diagonal so the corner tracks the pointer smoothly.
      const k = (sx * (s.x - gs.fixed.x) + sy * (s.y - gs.fixed.y)) / (sx * sx + sy * sy || 1);
      kx = ky = k;
    }
    return { kx: Math.max(MIN_SCALE, kx), ky: Math.max(MIN_SCALE, ky) };
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
      const c = b && !el.classList.contains("is-rotate") ? b.frame.corners.find((q) => Math.abs(p.x - q[0]) <= HANDLE_SIZE_PX && Math.abs(p.y - q[1]) <= HANDLE_SIZE_PX) : undefined;
      if (b && c) {
        const deg = (Math.atan2(c[1] - b.frame.centre[1], c[0] - b.frame.centre[0]) * 180) / Math.PI;
        const a = ((deg % 180) + 180) % 180;
        el.dataset["hover"] = a < 22.5 || a >= 157.5 ? "ew" : a < 67.5 ? "nwse" : a < 112.5 ? "ns" : "nesw";
      } else delete el.dataset["hover"];
    }
    if (g.kind === "none" && effectiveTool() === "eraser") {
      editor.eraser = { at: local(e), boxes: [] };
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
        if (Math.hypot(s.x - g.start.x, s.y - g.start.y) >= DRAG_THRESHOLD_PX) pressBecomesDrag(g, s);
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
      case "scale": {
        const { kx, ky } = scaleFactors(g, s);
        editor.preview = { kind: "scale", ids: g.ids, frame: g.frame, fixed: g.fixedWorld, kx, ky, keepWidth: editor.lock !== null };
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
        if (cancelled) editor.preview = { kind: "none" };
        else commitPreview();
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
    if (effectiveTool() !== "select" || editor.readOnly) return;
    const s = local(e);
    // A double-click on a grouped object goes one group deeper; once inside, it edits (text) as before.
    const hit = pickAll(unlocked(visible()), s.x, s.y)[0]?.obj;
    if (hit?.groups && hit.groups.length > editor.entered.length && isInside(hit, editor.entered)) {
      editor.entered = hit.groups.slice(0, editor.entered.length + 1);
      editor.select(expandToUnits(doc.ordered(), [hit], editor.entered));
      return;
    }
    const t = textAt(s);
    if (t) hooks.editText(t, world(s));
  };

  // ---- keyboard ----------------------------------------------------------
  /** Alt pressed and released on its own (no other key or pointer in between) brings the selection into view. */
  let altAlone = false;
  const ARROWS: Record<string, NavDir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!canvasShortcutsActive(e)) return;
    altAlone = e.key === "Alt" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && ARROWS[e.key]) {
      hooks.navigate(ARROWS[e.key]!);
    } else if (mod && key === "z") {
      if (g.kind !== "none") return;
      if (e.shiftKey) redo(doc, editor);
      else undo(doc, editor);
    } else if (mod && key === "y") {
      if (g.kind === "none") redo(doc, editor);
    } else if (mod && key === "a") {
      editor.select(doc.ordered().filter((o) => !o.hidden && !o.locked).map((o) => o.id));
    } else if (mod && key === "d") {
      e.preventDefault(); // not the browser's bookmark
      duplicateSelection(doc, editor, view);
    } else if (mod && key === "g") {
      if (e.shiftKey) ungroupSelection(doc, editor);
      else groupSelection(doc, editor);
    } else if (mod && (e.key === "]" || e.key === "[")) {
      arrangeSelection(doc, editor, e.key === "]" ? "front" : "back");
    } else if (mod || e.altKey) {
      return;
    } else if (e.key === " ") {
      if (!spaceDown) {
        spaceDown = true;
        el.classList.add("is-hand");
      }
    } else if (hooks.toolForKey(key)) editor.setTool(hooks.toolForKey(key)!);
    else if (e.key === "Escape") {
      if (g.kind !== "none" && g.kind !== "pan") cancelGesture();
      else if (editor.tool !== "select") editor.setTool("select"); // Esc: back to the Select tool
      else if (editor.entered.length) {
        // Leave the group entered last; what was picked inside it stays selected.
        editor.entered = editor.entered.slice(0, -1);
        editor.changed();
      } else editor.select([]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      deleteSelection(doc, editor);
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
  };
}
