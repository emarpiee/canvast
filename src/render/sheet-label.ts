/**
 * The name above the top-left corner of a sheet (ADR 0108): what you press to pick a sheet that has no fill, and what tells sheets apart.
 * Sheets on the canvas itself carry one; a sheet inside another only while it is picked. Drawn and picked from the same list.
 */
import type { Viewport } from "../core/camera";
import type { ObjectId } from "../doc/model";
import { isContainer } from "../doc/containers";
import type { ProjectedObject } from "./projection";

export interface SheetLabel {
  id: ObjectId;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export const LABEL_H = 16;
const GAP = 3;
const PAD = 4;
const MIN_SHEET_PX = 24;
export const LABEL_FONT = "500 12px system-ui, sans-serif";

let ruler: CanvasRenderingContext2D | null = null;
const widthOf = (text: string): number => {
  ruler ??= document.createElement("canvas").getContext("2d");
  if (!ruler) return text.length * 7;
  ruler.font = LABEL_FONT;
  return ruler.measureText(text).width;
};

export function sheetLabels(list: readonly ProjectedObject[], picked: ReadonlySet<ObjectId>, vp: Viewport): SheetLabel[] {
  const out: SheetLabel[] = [];
  for (const po of list) {
    const o = po.obj;
    if (!isContainer(o) || o.hidden || po.cover) continue;
    if (o.parent !== undefined && !picked.has(o.id)) continue;
    const b = po.box;
    if (!Number.isFinite(b.minX + b.maxX + b.minY) || b.maxX - b.minX < MIN_SHEET_PX || b.maxX < 0 || b.minX > vp.width || b.maxY < 0 || b.minY > vp.height) continue;
    const text = o.name ?? "Sheet";
    const w = Math.min(widthOf(text) + 2 * PAD, Math.max(MIN_SHEET_PX, b.maxX - b.minX));
    const y = b.minY - LABEL_H - GAP;
    out.push({ id: o.id, x: Math.max(0, b.minX), y: y < 0 ? Math.min(b.minY + GAP, vp.height - LABEL_H) : y, w, h: LABEL_H, text });
  }
  return out;
}

export function sheetLabelAt(labels: readonly SheetLabel[], x: number, y: number): SheetLabel | null {
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i]!;
    if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return l;
  }
  return null;
}
