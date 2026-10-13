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
import { expressExactIn } from "../core/frames";
import { normalizeUnit } from "../doc/edit-ops";
import { visibleObjects } from "../render/scene-view";
import type { FrameIndex } from "../scene/frame-index";
import { boxSelect, lassoSelect, pickAll } from "../render/hit-test";
import { HANDLE_SIZE_PX, handlePoints, selectionBox } from "../render/scene-renderer";
import { PanGesture } from "./navigation";
import { deleteSelection, redo, undo } from "../app/actions";

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
/** Smallest scale factor a resize drag can produce (prevents flips/zero size). */
const MIN_SCALE = 1e-6;

type Gesture =
  | { kind: "none" }
  | { kind: "pan" }
  | { kind: "pen"; pointerId: number; last: ScreenPoint }
  | { kind: "lasso"; pointerId: number }
  | { kind: "press"; pointerId: number; start: ScreenPoint; target: CanvasObject | null; additive: boolean }
  | { kind: "move"; pointerId: number; frame: Frame; startWorld: WorldPoint; ids: ObjectId[] }
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
    };

export interface ToolHooks {
  /** Open the text editor on `target`, or on a new text object at `at`. */
  editText(target: TextObject | null, at: WorldPoint): void;
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
  const visible = () => visibleObjects(doc, index, null, view.frameCamera, view.viewport);
  const textAt = (s: ScreenPoint): TextObject | null =>
    (pickAll(visible(), s.x, s.y).find((po) => po.obj.kind === "text")?.obj as TextObject | undefined) ?? null;

  const cancelGesture = (): void => {
    editor.preview = { kind: "none" };
    editor.draft = null;
    editor.lasso = null;
    editor.marquee = null;
    g = { kind: "none" };
    editor.changed();
  };

  const effectiveTool = (): Tool => (spaceDown ? "hand" : editor.tool);

  // ---- pen --------------------------------------------------------------
  const penPoint = (s: ScreenPoint): void => {
    const d = editor.draft!;
    const w = worldIn(s, d.frame);
    // Local units relative to the stroke anchor (exact difference, then one rounding).
    d.points.push(
      D.toNumber(D.shift(D.sub(w.x, d.anchor.x), -d.unit)),
      D.toNumber(D.shift(D.sub(w.y, d.anchor.y), -d.unit)),
    );
  };

  const commitPen = (): void => {
    const d = editor.draft;
    editor.draft = null;
    if (!d || d.points.length < 2) return;
    const stroke: StrokeObject = {
      id: newObjectId(),
      kind: "stroke",
      ...(d.frame === doc.space.world ? {} : { frame: d.frame }),
      anchor: d.anchor,
      unit: d.unit,
      z: doc.topZ() + 1,
      opacity: 1,
      attachmentTargetId: null,
      points: d.points,
      width: d.width,
      color: d.color,
    };
    doc.commit(doc.transaction("Draw stroke", [homeObject(normalizeUnit(stroke), doc.space)]));
  };

  // ---- select -------------------------------------------------------------
  const startSelectPress = (e: PointerEvent, s: ScreenPoint): void => {
    const vis = visible();
    // Resize handles take priority when a selection is visible.
    const box = editor.selection.size ? selectionBox(vis, editor) : null;
    if (box) {
      const corners = handlePoints(box);
      for (let i = 0; i < 4; i++) {
        const [hx, hy] = corners[i]!;
        if (Math.abs(s.x - hx) <= HANDLE_SIZE_PX && Math.abs(s.y - hy) <= HANDLE_SIZE_PX && !editor.blockEdit()) {
          const [fx, fy] = corners[(i + 2) % 4]!;
          const ids = [...editor.selection].filter((id) => doc.get(id));
          const onlyImage = ids.length === 1 && doc.get(ids[0]!)?.kind === "image";
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
    const hits = pickAll(vis, s.x, s.y);
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
      if (!editor.selection.has(t.id)) editor.select([t.id], gp.additive);
      const ids = [...editor.selection].filter((id) => doc.get(id));
      g = { kind: "move", pointerId: gp.pointerId, frame: view.frame, startWorld: world(gp.start), ids };
      updateMove(s);
      return;
    }
    g = { kind: "marquee", pointerId: gp.pointerId, start: gp.start, additive: gp.additive };
    editor.marquee = { x0: gp.start.x, y0: gp.start.y, x1: s.x, y1: s.y };
    editor.changed();
  };

  const updateMove = (s: ScreenPoint): void => {
    if (g.kind !== "move") return;
    const w = worldIn(s, g.frame);
    editor.preview = { kind: "move", ids: g.ids, frame: g.frame, dx: D.sub(w.x, g.startWorld.x), dy: D.sub(w.y, g.startWorld.y) };
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
    const p = editor.preview;
    // The committed state is exactly the previewed one, then re-homed if it left its frame's bounds.
    const next = (ids: readonly ObjectId[]): CanvasObject[] =>
      ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o).map((o) => homeObject(editor.previewed(o)!, doc.space));
    if (p.kind === "move" && !(p.dx.m === 0n && p.dy.m === 0n)) {
      const n = next(p.ids);
      editor.preview = { kind: "none" };
      doc.commit(doc.transaction(n.length === 1 ? `Move ${n[0]!.kind}` : `Move ${n.length} objects`, n));
    } else if (p.kind === "scale" && !(p.kx === 1 && p.ky === 1)) {
      const n = next(p.ids);
      editor.preview = { kind: "none" };
      doc.commit(doc.transaction("Resize", n));
    }
    editor.preview = { kind: "none" };
  };

  // ---- pointer events ----------------------------------------------------
  const onPointerDown = (e: PointerEvent): void => {
    const s = local(e);
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
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
        editor.draft = { frame: view.frame, anchor: world(s), unit: -cam.zi, points: [], width: editor.penWidthPx / f, color: editor.penColor };
        penPoint(s);
        g = { kind: "pen", pointerId: e.pointerId, last: s };
        editor.changed();
        break;
      }
      case "lasso":
        editor.lasso = [s.x, s.y];
        g = { kind: "lasso", pointerId: e.pointerId };
        editor.changed();
        break;
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
    if (!("pointerId" in g) || g.pointerId !== e.pointerId) return;
    const s = local(e);
    switch (g.kind) {
      case "pen": {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        for (const ce of events.length ? events : [e]) {
          const p = local(ce);
          if (Math.hypot(p.x - g.last.x, p.y - g.last.y) >= PEN_MIN_STEP_PX) {
            penPoint(p);
            g.last = p;
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
      case "scale": {
        const { kx, ky } = scaleFactors(g, s);
        editor.preview = { kind: "scale", ids: g.ids, frame: g.frame, fixed: g.fixedWorld, kx, ky };
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
      case "pen":
        if (cancelled) editor.draft = null;
        else commitPen();
        break;
      case "lasso": {
        const poly = editor.lasso!;
        editor.lasso = null;
        if (!cancelled) editor.select(lassoSelect(visible(), poly, editor.lassoFilter), e.shiftKey);
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
            editor.select([t.id], g.additive);
          }
        } else if (!g.additive) {
          editor.select([]);
        }
        break;
      }
      case "move":
        if (!cancelled) updateMove(s);
        if (cancelled) editor.preview = { kind: "none" };
        else commitPreview();
        break;
      case "marquee": {
        const m = editor.marquee!;
        editor.marquee = null;
        if (!cancelled) {
          const box = { minX: Math.min(m.x0, m.x1), minY: Math.min(m.y0, m.y1), maxX: Math.max(m.x0, m.x1), maxY: Math.max(m.y0, m.y1) };
          editor.select(boxSelect(visible(), box), g.additive);
        }
        break;
      }
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
    const t = textAt(s);
    if (t) hooks.editText(t, world(s));
  };

  // ---- keyboard ----------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!canvasShortcutsActive(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      if (g.kind !== "none") return;
      if (e.shiftKey) redo(doc, editor);
      else undo(doc, editor);
    } else if (mod && key === "y") {
      if (g.kind === "none") redo(doc, editor);
    } else if (mod && key === "a") {
      editor.select(doc.ordered().map((o) => o.id));
    } else if (mod || e.altKey) {
      return;
    } else if (e.key === " ") {
      if (!spaceDown) {
        spaceDown = true;
        el.classList.add("is-hand");
      }
    } else if (key === "v") editor.setTool("select");
    else if (key === "p") editor.setTool("pen");
    else if (key === "l") editor.setTool("lasso");
    else if (key === "h") editor.setTool("hand");
    else if (key === "t") editor.setTool("text");
    else if (e.key === "Escape") {
      if (g.kind !== "none" && g.kind !== "pan") cancelGesture();
      else editor.select([]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      deleteSelection(doc, editor);
    } else {
      return;
    }
    e.preventDefault();
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === " ") {
      spaceDown = false;
      el.classList.remove("is-hand");
    }
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("dblclick", onDoubleClick);
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
    el.removeEventListener("dblclick", onDoubleClick);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}
