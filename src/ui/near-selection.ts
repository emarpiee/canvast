import type { EditorState } from "../app/editor-state";
import { HANDLE_SIZE_PX } from "../render/scene-renderer";
import { ROTATE_HANDLE_OFFSET } from "../render/selection-frame";

/** How much the interface is zoomed (Settings > Interface size): the bars are drawn zoomed by it, so their places are in its px. */
export const uiScale = (): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;

/** The selection's box on the screen and the room around it, in the interface's px, relative to `host` (null: nothing is selected). */
export interface ScreenBox { left: number; top: number; right: number; bottom: number; roomW: number; roomH: number }

export function selectionBoxIn(host: HTMLElement, editor: EditorState): ScreenBox | null {
  const box = editor.selectionBoxOnScreen;
  if (!box) return null;
  const k = uiScale();
  const xs = box.frame.corners.map((c) => c[0] / k);
  const ys = box.frame.corners.map((c) => c[1] / k);
  const home = host.getBoundingClientRect();
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys), roomW: home.width / k, roomH: home.height / k };
}

/** A gap from the selection's box that keeps its rotate handle (above the box, or on any side when turned) clear, in interface px. */
export const clearOfHandles = (gap: number): number => (ROTATE_HANDLE_OFFSET + HANDLE_SIZE_PX / 2 + 1) / uiScale() + gap;

/** Whether any of the box is in its room (a selection scrolled out of the view is not). */
export const inRoom = (b: ScreenBox): boolean => b.right > 0 && b.bottom > 0 && b.left < b.roomW && b.top < b.roomH;

/** A box in the interface's px, relative to the canvas host. */
export interface Rect { left: number; top: number; right: number; bottom: number }

/** The bars on the edges (the top-left bar, the tool rail, the buttons and panels at the right, the Actions bar, the view controls): drawn over what floats by the selection, so that keeps off them. */
const EDGE_BARS = "#nav > *, .rail, .view-settings, .dock, #side-panels > *, #side-panels-left > *, .ctx-wrap, .hud-controls";

/** The edge bars shown now, as boxes relative to `host` in the interface's px; `self` (and what holds it or is in it) left out. */
export function edgeBarsIn(host: HTMLElement, self: HTMLElement): Rect[] {
  const k = uiScale(), home = host.getBoundingClientRect();
  const out: Rect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(EDGE_BARS)) {
    if (el.contains(self) || self.contains(el) || !el.getClientRects().length || getComputedStyle(el).visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push({ left: (r.left - home.left) / k, top: (r.top - home.top) / k, right: (r.right - home.left) / k, bottom: (r.bottom - home.top) / k });
  }
  return out;
}

/**
 * Where a bar of w × h goes by the selection (ADR 0198): on the side `prefer` says, else the other side, else at the edge of the room; its
 * centre over the selection's, kept inside the room. One rule for the Actions bar that follows the selection (under it) and the value chips
 * beside it (over it), so the two make one group round what is selected. It keeps off the edge bars in `avoid` (they are drawn over it):
 * on a side, where it would stand if that is clear, else just past or beside the bar in the way (the nearest); a side where nothing is clear is passed over.
 */
export function placeBy(b: ScreenBox, w: number, h: number, prefer: "below" | "above", gap: number, /** From the room's sides (the gap from the selection may be wider). */ side = gap, avoid: readonly Rect[] = []): { left: number; top: number } {
  const above = b.top - gap - h;
  const below = b.bottom + gap;
  const fitsBelow = below + h <= b.roomH - side;
  const fitsAbove = above >= side;
  const centred = (b.left + b.right) / 2 - w / 2;
  const clampX = (x: number): number => Math.max(side, Math.min(b.roomW - w - side, x));
  const clearAt = (l: number, t: number): boolean => avoid.every((r) => l >= r.right || l + w <= r.left || t >= r.bottom || t + h <= r.top);
  const lefts = (t: number): number[] => {
    const out = [clampX(centred)];
    for (const r of avoid) if (t < r.bottom && t + h > r.top) out.push(clampX(r.right + side), clampX(r.left - w - side));
    return out;
  };
  // On each side that has room (the preferred one first): its place, or one just past a bar in the way (further from the selection), or one
  // beside it; of the clear ones, the nearest to where it would stand.
  let best: { left: number; top: number; cost: number } | null = null;
  const sides: Array<[number, boolean, -1 | 1]> = prefer === "below" ? [[below, fitsBelow, 1], [above, fitsAbove, -1]] : [[above, fitsAbove, -1], [below, fitsBelow, 1]];
  sides.forEach(([t0, fits, dir], i) => {
    if (!fits) return;
    const tops = [t0];
    for (const r of avoid) if (t0 < r.bottom && t0 + h > r.top) tops.push(dir < 0 ? r.top - side - h : r.bottom + side);
    for (const t of tops) {
      if (t < side || t + h > b.roomH - side || (dir < 0 ? t > t0 : t < t0)) continue;
      for (const l of lefts(t)) {
        const cost = i * 1e6 + Math.abs(l - centred) + Math.abs(t - t0);
        if (clearAt(l, t) && (!best || cost < best.cost)) best = { left: l, top: t, cost };
      }
    }
  });
  if (best) return { left: (best as { left: number }).left, top: (best as { top: number }).top };
  const top = prefer === "below" ? (fitsBelow ? below : fitsAbove ? above : Math.max(side, b.roomH - h - side)) : fitsAbove ? above : fitsBelow ? below : side;
  return { left: lefts(top).find((l) => clearAt(l, top)) ?? clampX(centred), top };
}

/** An element's box on the screen and the room around it, as `selectionBoxIn` gives the selection's (the words being typed, for one). */
export function boxOfElementIn(host: HTMLElement, el: HTMLElement): ScreenBox {
  const k = uiScale();
  const home = host.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { left: (r.left - home.left) / k, top: (r.top - home.top) / k, right: (r.right - home.left) / k, bottom: (r.bottom - home.top) / k, roomW: home.width / k, roomH: home.height / k };
}

/**
 * Put a bar that belongs to what is being worked on just above it (below when there is no room), clear of its rotate handle, inside the
 * room: the Properties chips by the selection and the format bar of the words being typed, one rule (ADR 0198).
 */
export function placeAbove(el: HTMLElement, b: ScreenBox): void {
  const host = el.offsetParent instanceof HTMLElement ? el.offsetParent : el.parentElement;
  const at = placeBy(b, el.offsetWidth, el.offsetHeight, "above", clearOfHandles(6), 6, host ? edgeBarsIn(host, el) : []);
  const [l, t] = [`${Math.round(at.left)}px`, `${Math.round(at.top)}px`];
  if (el.style.left !== l) el.style.left = l;
  if (el.style.top !== t) el.style.top = t;
}
