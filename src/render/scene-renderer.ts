import type { Camera, Viewport } from "../core/camera";
import type { EditorState } from "../app/editor-state";
import type { AssetLibrary } from "../assets/asset-library";
import type { ProjectedObject, ScreenBox } from "./projection";
import { projectObject } from "./projection";
import { drawImageObject, drawStroke } from "./draw-objects";
import type { StrokeObject } from "../doc/model";

export interface SceneTheme {
  selection: string;
  handleFill: string;
  lasso: string;
  imagePlaceholder: string;
}

export const HANDLE_SIZE_PX = 9;

export function drawScene(
  ctx: CanvasRenderingContext2D,
  visible: readonly ProjectedObject[],
  editor: EditorState,
  assets: AssetLibrary,
  cam: Camera,
  vp: Viewport,
  dpr: number,
  theme: SceneTheme,
): void {
  for (const po of visible) {
    if (po.obj.kind === "stroke") drawStroke(ctx, po, vp);
    else drawImageObject(ctx, po, vp, dpr, assets.get(po.obj.assetId), theme.imagePlaceholder);
  }

  // In-progress stroke, drawn through the same projection as committed ones.
  const d = editor.draft;
  if (d && d.points.length >= 2) {
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

  drawSelection(ctx, visible, editor, theme, vp);

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
  }
  ctx.restore();
}
