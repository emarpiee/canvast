/**
 * Reveal (ADR 0149): drawing what is under the pointer (Ctrl held) or what a Layers row stands for, as the outline of each thing's own shape
 * (a path's edge, a pen stroke's line, a picture's or text's rectangle: never a bounding box), whatever its paint, so a shape with no fill
 * and no outline, a sheet and things behind others are seen. The logic that decides what is revealed is `interaction/reveal.ts`.
 */
import type { ProjectedObject } from "./projection";
import { LABEL_FONT } from "./item-label";
import type { SceneTheme } from "./scene-renderer";
import { REVEAL_PAD_PX, REVEAL_ROW_PX, REVEAL_ROWS, type DimHit } from "../interaction/reveal";
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

/** Where the list was drawn, and the thing each row stands for (see `EditorState.revealList`). */
export interface RevealListBox {
  x: number;
  y: number;
  w: number;
  h: number;
  ids: Array<string | null>;
  /** How many rows the whole list has (more than `ids` when it scrolls). */
  total: number;
}

/**
 * The stack under the pointer (or what the selection holds): outlines, and the names of all of them, top first, beside the pointer, in a box
 * of `REVEAL_ROWS` rows that scrolls (`scroll` rows past, with a thin bar on its edge); what cannot be picked comes last, dotted. A row of a
 * group's item is indented by `depth`. The names are a list to pick from (Ctrl+click on a row): the picked ones are ticked and the row under
 * the pointer (`hot`) is outlined strong.
 */
export function drawReveal(ctx: CanvasRenderingContext2D, hits: readonly ProjectedObject[], at: { x: number; y: number }, theme: SceneTheme, name: (po: ProjectedObject) => string, dim: readonly DimHit[] = [], picked: ReadonlySet<string> = new Set(), hot: string | null = null, opts: { depth?: (id: string) => number; scroll?: number } = {}): RevealListBox | null {
  if (!hits.length && !dim.length) return null;
  drawRevealOutlines(ctx, hits, theme);
  drawDimOutlines(ctx, dim, theme);
  const hotPo = hot ? hits.find((po) => po.obj.id === hot) : undefined;
  if (hotPo) drawRevealOutlines(ctx, [hotPo], theme, true);
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  const INDENT = 10;
  const all = [...hits.map((po) => ({ t: revealWords(name(po)), id: po.obj.id as string | null, d: opts.depth?.(po.obj.id) ?? 0 })), ...dim.map((d) => ({ t: revealWords(name(d.po), d.why), id: null as string | null, d: 0 }))];
  const scroll = Math.max(0, Math.min(all.length - REVEAL_ROWS, opts.scroll ?? 0));
  const rows = all.slice(scroll, scroll + REVEAL_ROWS);
  const gutter = 14;
  const bar = all.length > rows.length ? 4 : 0;
  // (as wide as its widest row, scrolled to or not, so it does not change width while it scrolls)
  const w = Math.max(...all.map((r) => ctx.measureText(r.t).width + r.d * INDENT)) + 12 + gutter + bar;
  const h = rows.length * REVEAL_ROW_PX + 2 * REVEAL_PAD_PX;
  const x = at.x + 4, y = at.y + 4; // (close enough that the pointer reaches the list)
  ctx.fillStyle = theme.handleFill;
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w - bar, h);
  ctx.clip();
  rows.forEach((r, i) => {
    const ry = y + REVEAL_PAD_PX + i * REVEAL_ROW_PX;
    if (r.id && r.id === hot) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = theme.selection;
      ctx.fillRect(x + 1, ry, w - 2 - bar, REVEAL_ROW_PX);
      ctx.restore();
    }
    ctx.fillStyle = i + scroll === 0 && !opts.depth ? theme.selection : theme.landmarkLabel;
    if (r.id && picked.has(r.id)) ctx.fillText("\u2713", x + 4, ry + REVEAL_ROW_PX / 2);
    ctx.fillText(r.t, x + 6 + gutter + r.d * INDENT, ry + REVEAL_ROW_PX / 2);
  });
  ctx.restore();
  if (bar) {
    // (where the shown rows are in the whole list)
    const inner = h - 2 * REVEAL_PAD_PX;
    ctx.fillStyle = theme.selection;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x + w - bar - 1, y + REVEAL_PAD_PX + (inner * scroll) / all.length, bar - 1, Math.max(6, (inner * rows.length) / all.length));
  }
  ctx.restore();
  return { x, y, w, h, ids: rows.map((r) => r.id), total: all.length };
}
