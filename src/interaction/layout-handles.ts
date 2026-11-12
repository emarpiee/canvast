import type { DocumentStore } from "../doc/document-store";
import type { ProjectedObject } from "../render/projection";
import type { SheetLayout } from "../doc/model";
import { isLaidOut, layoutNow } from "../doc/auto-layout";
import type { LaidOutSheet } from "../doc/auto-layout";

/**
 * Handles of a picked sheet's auto layout on the canvas (ADR 0193): one inside each edge for its padding, one between the first two items
 * for the gap along the flow, one between the first two lines for the gap across. Dragged, each changes that length as the bar's numbers do.
 * Where they are is worked out from what is on the sheet now, the same for drawing them and for pressing them.
 */
export type LayoutHandle = { what: "pad"; side: 0 | 1 | 2 | 3; x: number; y: number } | { what: "gap"; axis: 0 | 1; x: number; y: number };

/** How far inside an edge a padding handle sits at least (CSS px): clear of the resize handle on that edge. */
const EDGE_CLEAR_PX = 12;
/** How near a press must be to take a handle (CSS px). */
export const LAYOUT_HANDLE_REACH_PX = 7;

/** The handles of the one picked sheet with auto layout, alone or with what is on it (as picking it by its name does); none for anything else. */
export function layoutHandles(doc: DocumentStore, selected: readonly ProjectedObject[]): { sheet: LaidOutSheet; ppu: number; handles: LayoutHandle[] } | null {
  const sheets = selected.filter((p) => isLaidOut(p.obj));
  if (sheets.length !== 1) return null;
  const po = sheets[0]!;
  const sheet = po.obj;
  if (!isLaidOut(sheet) || sheet.locked) return null;
  const on = (o: { parent?: string }): boolean => {
    for (let at = o.parent, i = 0; at !== undefined && i < 64; at = doc.get(at)?.parent, i++) if (at === sheet.id) return true;
    return false;
  };
  if (!selected.every((p) => p === po || on(p.obj))) return null;
  const { items, W, H } = layoutNow(sheet, doc.ordered(), doc.space);
  const b = po.box;
  const ppu = W > 0 ? (b.maxX - b.minX) / W : 0;
  if (!(ppu > 0 && Number.isFinite(ppu) && Number.isFinite(b.minX + b.minY))) return null;
  const l: SheetLayout = sheet.container.layout;
  const sx = (u: number): number => b.minX + u * ppu, sy = (u: number): number => b.minY + u * ppu;
  const inset = (pad: number): number => Math.max(EDGE_CLEAR_PX, (pad * ppu) / 2);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const handles: LayoutHandle[] = [
    { what: "pad", side: 0, x: cx, y: b.minY + inset(l.pad[0]) },
    { what: "pad", side: 1, x: b.maxX - inset(l.pad[1]), y: cy },
    { what: "pad", side: 2, x: cx, y: b.maxY - inset(l.pad[2]) },
    { what: "pad", side: 3, x: b.minX + inset(l.pad[3]), y: cy },
  ];
  // The gaps: between the first item and the next one along the flow, and the first one on the next line (a masonry's: below it in its column).
  const [a, ...rest] = items;
  if (a) {
    const col = l.flow === "column";
    const next = rest.find((c) => (col ? c.y >= a.y + a.h - 1e-9 && c.x < a.x + a.w : c.x >= a.x + a.w - 1e-9 && c.y < a.y + a.h));
    if (next) handles.push(col ? { what: "gap", axis: 0, x: sx(a.x + a.w / 2), y: sy((a.y + a.h + next.y) / 2) } : { what: "gap", axis: 0, x: sx((a.x + a.w + next.x) / 2), y: sy(a.y + a.h / 2) });
    const below = l.flow === "row" || col ? undefined : rest.find((c) => c.y >= a.y + a.h - 1e-9 && c.x < a.x + a.w && c.x + c.w > a.x);
    if (below) handles.push({ what: "gap", axis: 1, x: sx(a.x + a.w / 2), y: sy((a.y + a.h + below.y) / 2) });
  }
  return { sheet, ppu, handles: handles.filter((h) => h.x >= b.minX - 1 && h.x <= b.maxX + 1 && h.y >= b.minY - 1 && h.y <= b.maxY + 1) };
}

/** The handle under a point, if any. */
export const layoutHandleAt = (handles: readonly LayoutHandle[], x: number, y: number): LayoutHandle | undefined =>
  handles.find((h) => Math.abs(h.x - x) <= LAYOUT_HANDLE_REACH_PX && Math.abs(h.y - y) <= LAYOUT_HANDLE_REACH_PX);

/** Whether a handle's bar lies across (true: it is moved up and down) on the screen. */
export const handleLies = (h: LayoutHandle, flow: SheetLayout["flow"]): boolean => (h.what === "pad" ? h.side === 0 || h.side === 2 : (h.axis === 1) !== (flow === "column"));

/** The length a handle sets, after a drag of (`dx`, `dy`) CSS px from where it started at `v0` (units): inward makes padding more, away from the first item the gap. */
export function draggedLength(h: LayoutHandle, flow: SheetLayout["flow"], v0: number, dx: number, dy: number, ppu: number): number {
  const d = h.what === "pad" ? (h.side === 0 ? dy : h.side === 1 ? -dx : h.side === 2 ? -dy : dx) : handleLies(h, flow) ? dy : dx;
  return Math.max(0, v0 + d / ppu);
}

/** The layout with one handle's length set. */
export function withHandleLength(l: SheetLayout, h: LayoutHandle, v: number): Partial<SheetLayout> {
  if (h.what === "pad") {
    const pad = [...l.pad] as [number, number, number, number];
    pad[h.side] = v;
    return { pad };
  }
  return { gap: h.axis === 0 ? [v, l.gap[1]] : [l.gap[0], v] };
}

/** The length a handle sets now. */
export const handleLength = (l: SheetLayout, h: LayoutHandle): number => (h.what === "pad" ? l.pad[h.side] : l.gap[h.axis]);
