/**
 * Where an AI agent works (ADR 0205): a pointer with its name and what it did, drawn over the canvas where it made or changed something, so
 * the person sees it. When that place is off the view, the pointer waits at the view's edge and points the way. The view never moves for it.
 */
import { LABEL_FONT } from "./item-label";
import type { SceneTheme } from "./scene-renderer";

const EDGE = 28;

/** Draw the pointer at `p` (screen px), or at the view's edge toward it when it is off the view; `alpha` fades it out. */
export function drawAgentPointer(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, view: { width: number; height: number }, label: string, theme: SceneTheme, alpha: number): void {
  const x = Math.min(Math.max(p.x, EDGE), view.width - EDGE);
  const y = Math.min(Math.max(p.y, EDGE), view.height - EDGE);
  const off = x !== p.x || y !== p.y;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(x, y);
  // (off the view: the pointer turns toward the place; on it, it leans as a mouse pointer does)
  ctx.rotate(off ? Math.atan2(p.y - y, p.x - x) + Math.PI * 0.75 : 0);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(4.5, 13.5);
  ctx.lineTo(8, 21);
  ctx.lineTo(11, 19.5);
  ctx.lineTo(7.5, 12.5);
  ctx.lineTo(13, 12.5);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.handleFill;
  ctx.stroke();
  ctx.fillStyle = theme.selection;
  ctx.fill();
  ctx.restore();
  // its name and what it did, beside it, kept inside the view
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.font = LABEL_FONT;
  const text = label.length > 60 ? `${label.slice(0, 59)}…` : label;
  const w = ctx.measureText(text).width + 12;
  const h = 20;
  const lx = Math.min(x + 14, view.width - w - 4);
  const ly = Math.min(y + 20, view.height - h - 4);
  ctx.beginPath();
  ctx.roundRect(lx, ly, w, h, 6);
  ctx.fillStyle = theme.selection;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.handleFill;
  ctx.stroke();
  ctx.fillStyle = theme.handleFill;
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx + 6, ly + h / 2 + 0.5);
  ctx.restore();
}
