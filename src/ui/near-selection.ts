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

/**
 * Where a bar of w × h goes by the selection (ADR 0198): on the side `prefer` says, else the other side, else at the edge of the room; its
 * centre over the selection's, kept inside the room. One rule for the Actions bar that follows the selection (under it) and the value chips
 * beside it (over it), so the two make one group round what is selected.
 */
export function placeBy(b: ScreenBox, w: number, h: number, prefer: "below" | "above", gap: number, /** From the room's sides (the gap from the selection may be wider). */ side = gap): { left: number; top: number } {
  const above = b.top - gap - h;
  const below = b.bottom + gap;
  const fitsBelow = below + h <= b.roomH - side;
  const fitsAbove = above >= side;
  const top = prefer === "below" ? (fitsBelow ? below : fitsAbove ? above : Math.max(side, b.roomH - h - side)) : fitsAbove ? above : fitsBelow ? below : side;
  const left = Math.max(side, Math.min(b.roomW - w - side, (b.left + b.right) / 2 - w / 2));
  return { left, top };
}
