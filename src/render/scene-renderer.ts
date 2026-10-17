import type { Viewport } from "../core/camera";
import type { FrameCamera } from "../core/frames";
import { cameraIn } from "../scene/frame-index";
import type { EditorState } from "../app/editor-state";
import type { AssetLibrary } from "../assets/asset-library";
import type { ProjectedObject, ScreenBox } from "./projection";
import { projectObject } from "./projection";
import { batchable, drawCover, drawImageObject, drawPath, drawStroke, strokeBatch, strokeLineWidth } from "./draw-objects";
import type { PathObject, StrokeObject } from "../doc/model";
import { NODE, shapeSubs } from "../doc/path";
import { gradientHandles, nodesOnScreen } from "../interaction/path-edit";
import { rasterKey } from "../doc/model";
import { drawText } from "./draw-text";
import type { Pt, SelectionFrame } from "./selection-frame";
import { expandStroke } from "../interaction/pens";
import { itemCorners, rotateHandleAt, selectionFrame } from "./selection-frame";

export interface SceneTheme {
  selection: string;
  handleFill: string;
  lasso: string;
  imagePlaceholder: string;
  /** Eraser brush and its touched boxes. */
  danger: string;
  dangerWash: string;
  /** Snap guide lines. */
  guide: string;
}

export const HANDLE_SIZE_PX = 9;

/**
 * Batch runs over a whole paint-ordered list: consecutive opaque fast-path
 * strokes of one colour and width (within 1/64 px) share a run number;
 * everything else gets a run of its own. A tile draws a subset of the list
 * and keeps these runs, so it batches exactly as a full frame does.
 */
export function batchRuns(list: readonly ProjectedObject[]): Map<ProjectedObject, number> {
  const runs = new Map<ProjectedObject, number>();
  let id = 0;
  let color = "";
  let width = 0;
  let open = false;
  for (const po of list) {
    if (batchable(po)) {
      const w = strokeLineWidth(po);
      const c = (po.obj as StrokeObject).color;
      if (!open || c !== color || Math.abs(w - width) > 1 / 64) {
        id++;
        color = c;
        width = w;
        open = true;
      }
    } else {
      id++;
      open = false;
    }
    runs.set(po, id);
  }
  return runs;
}

/**
 * Draw objects in paint order. Runs of identical opaque strokes share a
 * call (`runs` from batchRuns over the full frame list; computed here when
 * omitted). Returns true if an image was drawn as a placeholder because its
 * original is still loading (or missing).
 */
/** How many CSS px the longer side of a projected image takes on screen. */
const shownEdge = (po: ProjectedObject): number => (po.obj.kind === "image" ? po.proj.ppu * Math.max(po.obj.w, po.obj.h) : Infinity);

export function drawObjects(
  ctx: CanvasRenderingContext2D,
  list: readonly ProjectedObject[],
  assets: AssetLibrary,
  vp: Viewport,
  dpr: number,
  theme: SceneTheme,
  runs: ReadonlyMap<ProjectedObject, number> = batchRuns(list),
): boolean {
  let pending = false;
  let run: ProjectedObject[] = [];
  let runId = -1;
  const flush = (): void => {
    if (run.length) strokeBatch(ctx, run, strokeLineWidth(run[0]!), vp);
    run = [];
  };
  for (const po of list) {
    if (batchable(po)) {
      const r = runs.get(po) ?? -1;
      if (run.length && r !== runId) flush();
      runId = r;
      run.push(po);
      continue;
    }
    flush();
    if (po.rotated) {
      // A turned image or text: draw the unturned one into the widened viewport, with the canvas turned.
      const t = po.rotated;
      ctx.save();
      ctx.translate(t.cx, t.cy);
      ctx.rotate(Math.atan2(t.s, t.c));
      ctx.translate(-t.vvp.width / 2, -t.vvp.height / 2);
      if (po.obj.kind === "text") drawText(ctx, t.inner, t.vvp, dpr);
      else if (po.obj.kind === "image") {
        const shown = shownEdge(t.inner);
        const edge = po.obj.media ? 0 : Math.max(po.obj.pixelW, po.obj.pixelH);
        const key = rasterKey(po.obj);
        const src = assets.get(key, shown, edge);
        if (!src || !assets.wantedReady(key, shown, edge)) pending = true;
        drawImageObject(ctx, t.inner, t.vvp, dpr, src, theme.imagePlaceholder, 0.5);
      }
      ctx.restore();
    } else if (po.cover) {
      const src = po.obj.kind === "image" ? assets.get(rasterKey(po.obj)) : null;
      if (po.obj.kind === "image" && !src) pending = true;
      drawCover(ctx, po, vp, src, theme.imagePlaceholder);
    } else if (po.obj.kind === "stroke") drawStroke(ctx, po, vp);
    else if (po.obj.kind === "text") drawText(ctx, po, vp, dpr);
    else if (po.obj.kind === "path") drawPath(ctx, po, vp);
    else {
      const shown = shownEdge(po);
      const edge = po.obj.media ? 0 : Math.max(po.obj.pixelW, po.obj.pixelH);
      const key = rasterKey(po.obj);
      const src = assets.get(key, shown, edge);
      if (!src || !assets.wantedReady(key, shown, edge)) pending = true;
      drawImageObject(ctx, po, vp, dpr, src, theme.imagePlaceholder);
    }
  }
  flush();
  return pending;
}

/**
 * Everything drawn on top of committed objects, never cached: the stroke
 * being drawn, selection outlines and handles (`selected` holds the visible
 * selected objects), lasso and marquee.
 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  selected: readonly ProjectedObject[],
  editor: EditorState,
  fc: FrameCamera,
  vp: Viewport,
  theme: SceneTheme,
  members: readonly ProjectedObject[] = [],
): void {
  // The members of the boolean group that has been entered, as outlines over its result (ADR 0103).
  if (members.length) {
    ctx.save();
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    for (const po of members) {
      if (po.cover || !po.path) continue;
      ctx.beginPath();
      for (const f of po.path) {
        const p = f.pts;
        if (p.length < 4) continue;
        ctx.moveTo(p[0]!, p[1]!);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
        if (f.closed) ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  // Object eraser: the brush, and what the swipe has touched so far (it is removed when the pointer is released).
  if (editor.tool === "eraser" && editor.eraser) {
    ctx.save();
    for (const b of editor.eraser.boxes) {
      ctx.fillStyle = theme.dangerWash;
      ctx.strokeStyle = theme.danger;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    }
    if (editor.eraser.at) {
      ctx.setLineDash([]);
      ctx.strokeStyle = theme.danger;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(editor.eraser.at.x, editor.eraser.at.y, editor.eraserPx / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Snap guides: where the moving selection lines up with another object.
  if (editor.guides) {
    ctx.save();
    ctx.strokeStyle = theme.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (editor.guides.x !== undefined) {
      ctx.moveTo(Math.round(editor.guides.x) + 0.5, 0);
      ctx.lineTo(Math.round(editor.guides.x) + 0.5, vp.height);
    }
    if (editor.guides.y !== undefined) {
      ctx.moveTo(0, Math.round(editor.guides.y) + 0.5);
      ctx.lineTo(vp.width, Math.round(editor.guides.y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }
  // In-progress stroke, drawn through the same projection as committed ones (with the camera in its frame).
  for (const d of [...editor.draftDone, ...(editor.draft ? [editor.draft] : [])]) {
    const cam = cameraIn(fc, d.frame);
    if (!cam || d.points.length < 2) continue;
    // The pen's own strokes, so what is drawn while drawing is what is committed.
    for (const piece of expandStroke(d.kind, { points: d.points, width: d.width, ...(d.pressure ? { pressure: d.pressure } : {}), ...(d.speed ? { speed: d.speed } : {}) })) {
      const draft: StrokeObject = {
        id: DRAFT_ID,
        kind: "stroke",
        anchor: d.anchor,
        unit: d.unit,
        z: Infinity,
        opacity: piece.opacity,
        attachmentTargetId: null,
        points: piece.points,
        width: piece.width,
        color: d.color,
      };
      const po = projectObject(draft, cam, vp, { keepTiny: true });
      if (po) drawStroke(ctx, po, vp);
    }
  }

  // The shape being dragged out and the path being drawn, through the same projection as committed paths.
  const sd = editor.shapeDraft;
  if (sd && (sd.bw || sd.bh)) {
    const cam = cameraIn(fc, sd.frame);
    const draft: PathObject = {
      id: DRAFT_ID,
      kind: "path",
      anchor: sd.anchor,
      unit: sd.unit,
      z: Infinity,
      opacity: 1,
      attachmentTargetId: null,
      sub: shapeSubs(sd.kind, sd.bx, sd.by, sd.bw, sd.bh, sd.sides, sd.tips),
      fill: sd.fill,
      stroke: sd.stroke,
      width: sd.width,
      ...(sd.kind === "rect" || sd.kind === "polygon" || sd.kind === "star" ? { join: "miter" as const } : {}),
    };
    const po = cam && projectObject(draft, cam, vp, { keepTiny: true });
    if (po) drawPath(ctx, po, vp);
  }
  const pd = editor.pathDraft;
  if (pd && pd.n.length) {
    const cam = cameraIn(fc, pd.frame);
    // The nodes so far, and a last segment running to the pointer.
    const n = pd.cursor ? [...pd.n, pd.cursor.x, pd.cursor.y, pd.cursor.x, pd.cursor.y, pd.cursor.x, pd.cursor.y] : pd.n;
    const draft: PathObject = {
      id: DRAFT_ID,
      kind: "path",
      anchor: pd.anchor,
      unit: pd.unit,
      z: Infinity,
      opacity: 1,
      attachmentTargetId: null,
      sub: [{ n, closed: false }],
      fill: null,
      stroke: pd.stroke ?? "#1f2329",
      width: pd.width,
    };
    const po = cam && projectObject(draft, cam, vp, { keepTiny: true });
    if (po && !po.cover) {
      drawPath(ctx, po, vp);
      ctx.save();
      ctx.strokeStyle = theme.selection;
      ctx.fillStyle = theme.handleFill;
      ctx.lineWidth = 1.25;
      const nodes = nodesOnScreen(po);
      nodes.slice(0, pd.n.length / NODE).forEach((m, i) => {
        const h = i === 0 ? HANDLE_SIZE_PX + 2 : HANDLE_SIZE_PX - 2; // the first is larger: pressing it closes the path
        ctx.fillRect(m.p[0] - h / 2, m.p[1] - h / 2, h, h);
        ctx.strokeRect(m.p[0] - h / 2, m.p[1] - h / 2, h, h);
      });
      ctx.restore();
    }
  }

  drawSelection(ctx, selected, editor, theme, vp);
  if (editor.tool === "node") drawNodes(ctx, selected, editor, theme);
  if (editor.tool === "select" || editor.tool === "node") drawGradientHandles(ctx, selected, theme);

  if (editor.lasso && editor.lasso.length >= 4) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = theme.lasso;
    ctx.beginPath();
    ctx.moveTo(editor.lasso[0]!, editor.lasso[1]!);
    for (let i = 2; i < editor.lasso.length; i += 2) ctx.lineTo(editor.lasso[i]!, editor.lasso[i + 1]!);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  if (editor.marquee) {
    const m = editor.marquee;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = theme.lasso;
    ctx.strokeRect(Math.min(m.x0, m.x1) + 0.5, Math.min(m.y0, m.y1) + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    ctx.restore();
  }
}

/** Nodes and handles of the one selected path, for the Edit nodes tool: squares for nodes, circles for the handles of the selected one. */
function drawNodes(ctx: CanvasRenderingContext2D, selected: readonly ProjectedObject[], editor: EditorState, theme: SceneTheme): void {
  if (selected.length !== 1) return;
  const po = selected[0]!;
  if (po.obj.kind !== "path" || po.cover) return;
  const half = HANDLE_SIZE_PX / 2;
  const sel = editor.nodeSel;
  ctx.save();
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1.25;
  const nodes = nodesOnScreen(po);
  for (const n of nodes) {
    if (!sel || n.s !== sel.s || n.k !== sel.k) continue;
    // The handles of the selected node, each on a line from it.
    ctx.fillStyle = theme.handleFill;
    for (const [on, h] of [[n.hasIn, n.i], [n.hasOut, n.o]] as const) {
      if (!on) continue;
      ctx.beginPath();
      ctx.moveTo(n.p[0], n.p[1]);
      ctx.lineTo(h[0], h[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h[0], h[1], half - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  for (const n of nodes) {
    const on = !!sel && n.s === sel.s && n.k === sel.k;
    ctx.fillStyle = on ? theme.selection : theme.handleFill;
    ctx.fillRect(n.p[0] - half + 1, n.p[1] - half + 1, HANDLE_SIZE_PX - 2, HANDLE_SIZE_PX - 2);
    ctx.strokeRect(n.p[0] - half + 1, n.p[1] - half + 1, HANDLE_SIZE_PX - 2, HANDLE_SIZE_PX - 2);
  }
  ctx.restore();
}

/** The axis or the rings of the gradient of the one selected path, with handles to drag (ADR 0100). */
function drawGradientHandles(ctx: CanvasRenderingContext2D, selected: readonly ProjectedObject[], theme: SceneTheme): void {
  if (selected.length !== 1 || selected[0]!.obj.kind !== "path") return;
  const h = gradientHandles(selected[0]!);
  if (!h) return;
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = theme.selection;
  ctx.fillStyle = theme.handleFill;
  if (h.ring) {
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(h.ring.x, h.ring.y, Math.min(h.ring.r, 1e5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.beginPath();
    ctx.moveTo(h.pts[0]!.x, h.pts[0]!.y);
    ctx.lineTo(h.pts[1]!.x, h.pts[1]!.y);
    ctx.stroke();
    for (const s of h.stops) {
      // a stop on the axis, in its own colour
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, HANDLE_SIZE_PX / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = theme.handleFill;
  }
  for (const q of h.pts) {
    ctx.beginPath();
    ctx.arc(q.x, q.y, HANDLE_SIZE_PX / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Placeholder id for the in-progress stroke; never stored. */
const DRAFT_ID = "0".repeat(32);

function clampBox(b: ScreenBox, vp: Viewport): ScreenBox {
  const m = 4;
  return {
    minX: Math.max(b.minX, -m),
    minY: Math.max(b.minY, -m),
    maxX: Math.min(b.maxX, vp.width + m),
    maxY: Math.min(b.maxY, vp.height + m),
  };
}

/** The box of the visible selected objects (turned with them when they share a rotation, see selection-frame.ts). */
export function selectedFrame(visible: readonly ProjectedObject[], editor: EditorState, vp: Viewport): { frame: SelectionFrame; handle: Pt } | null {
  const frame = selectionFrame(visible.filter((po) => editor.selection.has(po.obj.id)), editor.alignBox);
  return frame ? { frame, handle: rotateHandleAt(frame, vp) } : null;
}

/** Rotation is offered when something selected is visible and not a covering approximation. */
export function canRotate(visible: readonly ProjectedObject[], editor: EditorState): boolean {
  let any = false;
  for (const po of visible) {
    if (!editor.selection.has(po.obj.id)) continue;
    if (po.cover) return false;
    any = true;
  }
  return any;
}

const finite = (p: Pt): boolean => Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6;

function drawSelection(
  ctx: CanvasRenderingContext2D,
  visible: readonly ProjectedObject[],
  editor: EditorState,
  theme: SceneTheme,
  vp: Viewport,
): void {
  if (editor.selection.size === 0) {
    editor.selectionBoxOnScreen = null;
    return;
  }
  ctx.save();
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1;
  // Each selected object is outlined by the rectangle it occupies, turned with it.
  for (const po of visible) {
    if (!editor.selection.has(po.obj.id)) continue;
    const c = itemCorners(po);
    if (!c.every(finite)) continue;
    ctx.beginPath();
    ctx.moveTo(c[0]![0], c[0]![1]);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i]![0], c[i]![1]);
    ctx.closePath();
    ctx.stroke();
  }
  // Editing nodes: the nodes are the handles; the selection's own handles would sit on top of them.
  const sel = editor.tool === "node" ? null : selectedFrame(visible, editor, vp);
  if (editor.tool === "node") editor.selectionBoxOnScreen = null;
  if (sel && sel.frame.corners.every(finite)) {
    const { frame, handle } = sel;
    // The box the handles sit on, always drawn: for one object in an axis-aligned box it is not the object's own outline.
    ctx.beginPath();
    ctx.moveTo(frame.corners[0][0], frame.corners[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(frame.corners[i]![0], frame.corners[i]![1]);
    ctx.closePath();
    ctx.stroke();
    editor.selectionBoxOnScreen = { frame, handle, rotatable: canRotate(visible, editor) };
    ctx.fillStyle = theme.handleFill;
    ctx.lineWidth = 1.25;
    const handles: Array<[number, number]> = [...frame.corners.map((c) => [c[0], c[1]] as [number, number])];
    if (frame.angle === 0) {
      // The middle of each side, when the side is long enough to hold a handle beside the corners (tools.ts resizeHandles).
      const [c0, c1, c2, c3] = frame.corners;
      if (Math.abs(c1![0] - c0![0]) >= 3 * HANDLE_SIZE_PX && Math.abs(c3![1] - c0![1]) >= 3 * HANDLE_SIZE_PX) {
        handles.push([(c0![0] + c1![0]) / 2, c0![1]], [(c3![0] + c2![0]) / 2, c3![1]], [c1![0], (c1![1] + c2![1]) / 2], [c0![0], (c0![1] + c3![1]) / 2]);
      }
    }
    for (const [x, y] of handles) {
      const h = HANDLE_SIZE_PX;
      ctx.fillRect(x - h / 2, y - h / 2, h, h);
      ctx.strokeRect(x - h / 2, y - h / 2, h, h);
    }
    if (canRotate(visible, editor)) {
      const top: Pt = [(frame.corners[0][0] + frame.corners[1][0]) / 2, (frame.corners[0][1] + frame.corners[1][1]) / 2];
      ctx.beginPath();
      ctx.moveTo(handle[0], handle[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(handle[0], handle[1], HANDLE_SIZE_PX / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}
