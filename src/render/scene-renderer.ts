import type { Viewport } from "../core/camera";
import type { FrameCamera } from "../core/frames";
import { cameraIn } from "../scene/frame-index";
import type { EditorState } from "../app/editor-state";
import type { AssetLibrary } from "../assets/asset-library";
import type { ProjectedObject, ScreenBox } from "./projection";
import { projectObject } from "./projection";
import { batchable, drawCover, drawImageObject, drawStroke, strokeBatch, strokeLineWidth } from "./draw-objects";
import type { StrokeObject } from "../doc/model";
import { drawText } from "./draw-text";

export interface SceneTheme {
  selection: string;
  handleFill: string;
  lasso: string;
  imagePlaceholder: string;
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
        const src = assets.get(po.obj.assetId);
        if (!src) pending = true;
        drawImageObject(ctx, t.inner, t.vvp, dpr, src, theme.imagePlaceholder, 0.5);
      }
      ctx.restore();
    } else if (po.cover) {
      const src = po.obj.kind === "image" ? assets.get(po.obj.assetId) : null;
      if (po.obj.kind === "image" && !src) pending = true;
      drawCover(ctx, po, vp, src, theme.imagePlaceholder);
    } else if (po.obj.kind === "stroke") drawStroke(ctx, po, vp);
    else if (po.obj.kind === "text") drawText(ctx, po, vp, dpr);
    else {
      const src = assets.get(po.obj.assetId);
      if (!src) pending = true;
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
): void {
  // In-progress stroke, drawn through the same projection as committed ones (with the camera in its frame).
  for (const d of [...editor.draftDone, ...(editor.draft ? [editor.draft] : [])]) {
    const cam = cameraIn(fc, d.frame);
    if (!cam || d.points.length < 2) continue;
    const draft: StrokeObject = {
      id: DRAFT_ID,
      kind: "stroke",
      anchor: d.anchor,
      unit: d.unit,
      z: Infinity,
      opacity: 1,
      attachmentTargetId: null,
      points: d.points,
      width: d.width,
      color: d.color,
    };
    const po = projectObject(draft, cam, vp, { keepTiny: true });
    if (po) drawStroke(ctx, po, vp);
  }

  drawSelection(ctx, selected, editor, theme, vp);

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

/** Union screen box of the visible selected objects, or null. */
export function selectionBox(visible: readonly ProjectedObject[], editor: EditorState): ScreenBox | null {
  let box: ScreenBox | null = null;
  for (const po of visible) {
    if (!editor.selection.has(po.obj.id)) continue;
    const b = po.box;
    box = box
      ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
      : { ...b };
  }
  return box;
}

/** Distance of the rotate handle above the selection box (CSS px). */
export const ROTATE_HANDLE_OFFSET_PX = 26;

/** Centre of the rotate handle: above the middle of the top edge. */
export function rotateHandlePoint(b: ScreenBox): [number, number] {
  return [(b.minX + b.maxX) / 2, b.minY - ROTATE_HANDLE_OFFSET_PX];
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

/** Corner handle centers: tl, tr, br, bl. */
export function handlePoints(b: ScreenBox): Array<[number, number]> {
  return [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY],
  ];
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  visible: readonly ProjectedObject[],
  editor: EditorState,
  theme: SceneTheme,
  vp: Viewport,
): void {
  if (editor.selection.size === 0) return;
  ctx.save();
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1;
  for (const po of visible) {
    if (!editor.selection.has(po.obj.id)) continue;
    const b = clampBox(po.box, vp);
    ctx.strokeRect(b.minX - 2.5, b.minY - 2.5, b.maxX - b.minX + 5, b.maxY - b.minY + 5);
  }
  const box = selectionBox(visible, editor);
  if (box) {
    ctx.fillStyle = theme.handleFill;
    ctx.lineWidth = 1.25;
    for (const [x, y] of handlePoints(box)) {
      if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6) continue;
      const h = HANDLE_SIZE_PX;
      ctx.fillRect(x - h / 2, y - h / 2, h, h);
      ctx.strokeRect(x - h / 2, y - h / 2, h, h);
    }
    if (canRotate(visible, editor)) {
      const [rx, ry] = rotateHandlePoint(box);
      if (Math.abs(rx) < 1e6 && Math.abs(ry) < 1e6) {
        ctx.beginPath();
        ctx.moveTo(rx, ry + HANDLE_SIZE_PX / 2);
        ctx.lineTo(rx, box.minY);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rx, ry, HANDLE_SIZE_PX / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
