/**
 * The name above the top-left corner of an item (ADR 0108, 0125): what you press to pick a sheet that has no fill, and what tells items
 * apart. Sheets, pictures, videos, sounds and file cards carry one (a picture by its file name); any other item shows its layer name
 * while it is picked. An item on the canvas itself carries it always, one inside a sheet only while it is picked. Drawn and picked from the same list.
 * Names of picked items never overlap: where they would (a group picked whole, a sheet and what is on it), only the outermost is written, as design
 * tools write the name of a frame or a group and not of every layer in it.
 */
import type { Viewport } from "../core/camera";
import type { ObjectId } from "../doc/model";
import type { CanvasObject } from "../doc/model";
import { isContainer } from "../doc/containers";
import type { ProjectedObject } from "./projection";

export interface ItemLabel {
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
const widths = new Map<string, number>();
const widthOf = (text: string): number => {
  let w = widths.get(text);
  if (w === undefined) {
    ruler ??= document.createElement("canvas").getContext("2d");
    if (ruler) ruler.font = LABEL_FONT;
    w = ruler ? ruler.measureText(text).width : text.length * 7;
    if (widths.size > 2000) widths.clear();
    widths.set(text, w);
  }
  return w;
};

/** Whether an item can carry a name above it at all (what the renderer keeps a list of, so a canvas with none costs nothing). */
export const isLabelled = (o: CanvasObject): boolean => isContainer(o) || o.kind === "image" || o.name !== undefined;

/** The name an item shows: its own layer name, else a sheet's "Sheet", a picture's file name (`fileName` knows it once the catalog has answered); undefined = none. */
export function itemName(o: CanvasObject, fileName: (hash: string) => string | undefined): string | undefined {
  if (o.name) return o.name;
  if (isContainer(o)) return "Sheet";
  return o.kind === "image" ? fileName(o.assetId) || "Picture" : undefined;
}

export function itemLabels(list: readonly ProjectedObject[], picked: ReadonlySet<ObjectId>, vp: Viewport, fileName: (hash: string) => string | undefined, show: "all" | "picked" | "off" = "all"): ItemLabel[] {
  const out: ItemLabel[] = [];
  const shown: ItemLabel[] = []; // (the names of picked items, which are the ones that pile up)
  if (show === "off") return out;
  for (const po of list) {
    const o = po.obj;
    if (!isLabelled(o) || o.hidden || po.cover) continue;
    if ((show === "picked" || o.parent !== undefined || !(isContainer(o) || o.kind === "image")) && !picked.has(o.id)) continue;
    const b = po.box;
    if (!Number.isFinite(b.minX + b.maxX + b.minY) || b.maxX - b.minX < MIN_SHEET_PX || b.maxX < 0 || b.minX > vp.width || b.maxY < 0 || b.minY > vp.height) continue;
    const text = itemName(o, fileName);
    if (!text) continue;
    const w = Math.min(widthOf(text) + 2 * PAD, Math.max(MIN_SHEET_PX, b.maxX - b.minX));
    const y = b.minY - LABEL_H - GAP;
    const label = { id: o.id, x: Math.max(0, b.minX), y: y < 0 ? Math.min(b.minY + GAP, vp.height - LABEL_H) : y, w, h: LABEL_H, text };
    if (picked.has(o.id)) {
      // Several picked items that start at one corner (a group, a sheet and what is on it) would write their names over each other: the first, the outermost, keeps the place.
      if (shown.some((l) => label.x < l.x + l.w && l.x < label.x + label.w && label.y < l.y + l.h && l.y < label.y + label.h)) continue;
      shown.push(label);
    }
    out.push(label);
  }
  return out;
}

export function itemLabelAt(labels: readonly ItemLabel[], x: number, y: number): ItemLabel | null {
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i]!;
    if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return l;
  }
  return null;
}
