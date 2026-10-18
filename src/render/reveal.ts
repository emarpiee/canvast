/**
 * Reveal (ADR 0149): drawing what is under the pointer (Ctrl held) or what a Layers row stands for, as the outline of each thing's own shape
 * (a path's edge, a pen stroke's line, a picture's or text's rectangle: never a bounding box), whatever its paint, so a shape with no fill
 * and no outline, a sheet and things behind others are seen. The logic that decides what is revealed is `interaction/reveal.ts`.
 */
import type { ProjectedObject } from "./projection";
import { LABEL_FONT } from "./item-label";
import type { SceneTheme } from "./scene-renderer";
import type { DimHit } from "../interaction/reveal";
import { itemCorners } from "./selection-frame";

const finite = (v: readonly [number, number]): boolean => Math.abs(v[0]) < 1e6 && Math.abs(v[1]) < 1e6;

/** One thing's own outline as a path on `ctx`; false when there is nothing to trace. */
export function traceOutline(ctx: CanvasRenderingContext2D, po: ProjectedObject): boolean {
  if (po.cover) return false;
  ctx.beginPath();
  if (po.path) {
    for (const f of po.path) {
      const p = f.pts;
      if (p.length < 4) continue;
      ctx.moveTo(p[0]!, p[1]!);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k]!, p[k + 1]!);
      if (f.closed) ctx.closePath();
    }
    return true;
  }
  if (po.obj.kind === "stroke" && po.q.length >= 4) {
    ctx.moveTo(po.q[0]!, po.q[1]!);
    for (let k = 2; k < po.q.length; k += 2) ctx.lineTo(po.q[k]!, po.q[k + 1]!);
    return true;
  }
  const c = itemCorners(po);
  if (!c.every(finite)) return false;
  ctx.moveTo(c[0]![0], c[0]![1]);
  for (let k = 1; k < c.length; k++) ctx.lineTo(c[k]![0], c[k]![1]);
  ctx.closePath();
  return true;
}

/** The outlines of `hits` (the first is the top one: strong; the others fainter and dashed), each over a pale halo so it shows over an outline of its own colour. */
export function drawRevealOutlines(ctx: CanvasRenderingContext2D, hits: readonly ProjectedObject[], theme: SceneTheme, allStrong = false): void {
  ctx.save();
  for (let i = hits.length - 1; i >= 0; i--) {
    const top = allStrong || i === 0;
    if (!traceOutline(ctx, hits[i]!)) continue;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = theme.handleFill;
    ctx.lineWidth = (top ? 2 : 1) + 3;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = top ? 2 : 1;
    ctx.globalAlpha = top ? 1 : 0.6;
    ctx.setLineDash(top ? [] : [4, 3]);
    ctx.stroke();
  }
  ctx.restore();
}

/** What can be seen under the pointer but not picked (locked, hidden, a mask's part): faint dotted outlines. */
function drawDimOutlines(ctx: CanvasRenderingContext2D, dim: readonly DimHit[], theme: SceneTheme): void {
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1.25;
  for (const d of dim) if (traceOutline(ctx, d.po)) ctx.stroke();
  ctx.restore();
}

/** The words for a thing: its name, and why it cannot be picked when it cannot. */
export const revealWords = (name: string, why?: DimHit["why"]): string => (why ? `${name} (${why === "mask" ? "part of a mask" : why})` : name);

/** The stack under the pointer: outlines, and the names of up to six of them, top first, beside the pointer; what cannot be picked comes last, dotted. */
export function drawReveal(ctx: CanvasRenderingContext2D, hits: readonly ProjectedObject[], at: { x: number; y: number }, theme: SceneTheme, name: (po: ProjectedObject) => string, dim: readonly DimHit[] = []): void {
  if (!hits.length && !dim.length) return;
  drawRevealOutlines(ctx, hits, theme);
  drawDimOutlines(ctx, dim, theme);
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  const all = [...hits.map((po) => revealWords(name(po))), ...dim.map((d) => revealWords(name(d.po), d.why))];
  const rows = all.slice(0, 6);
  const shown = rows;
  const w = Math.max(...rows.map((t) => ctx.measureText(t).width)) + 12;
  const h = rows.length * 16 + 6;
  const x = at.x + 14, y = at.y + 14;
  ctx.fillStyle = theme.handleFill;
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  rows.forEach((t, i) => {
    ctx.fillStyle = i === 0 ? theme.selection : theme.landmarkLabel;
    ctx.fillText(t, x + 6, y + 3 + i * 16 + 8);
  });
  if (all.length > shown.length) {
    ctx.fillStyle = theme.landmarkLabel;
    ctx.fillText(`+ ${all.length - shown.length} more`, x + 6, y + h + 9);
  }
  ctx.restore();
}
