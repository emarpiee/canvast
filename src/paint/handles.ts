/**
 * The box handles of the Painting view's Move tool (ADR 0166): the eight handles of a box on screen, which one a point is on, and the box a
 * drag gives (the opposite corner or side stays put; Shift keeps the proportions; at least one px a side). Plain numbers, so it is tested
 * on its own.
 */
import type { Box } from "./objects";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLE_PX = 9;

/** The handles of a screen box, with where each is. */
export function handlesOf(b: Box): Array<{ h: Handle; x: number; y: number }> {
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return [
    { h: "nw", x: x0, y: y0 }, { h: "n", x: mx, y: y0 }, { h: "ne", x: x1, y: y0 }, { h: "e", x: x1, y: my },
    { h: "se", x: x1, y: y1 }, { h: "s", x: mx, y: y1 }, { h: "sw", x: x0, y: y1 }, { h: "w", x: x0, y: my },
  ];
}

/** The handle under (x, y), within `reach` px (a corner before a side when both are), or null. */
export function handleAt(b: Box, x: number, y: number, reach = HANDLE_PX): Handle | null {
  let best: { h: Handle; d: number } | null = null;
  for (const p of handlesOf(b)) {
    const d = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    if (d <= reach && (!best || d < best.d - 1e-9 || (d <= best.d + 1e-9 && p.h.length === 2))) best = { h: p.h, d };
  }
  return best?.h ?? null;
}

/** The box after dragging handle `h` of `b` by (dx, dy). */
export function resized(b: Box, h: Handle, dx: number, dy: number, keepRatio: boolean): Box {
  let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  if (h.includes("w")) x0 += dx;
  if (h.includes("e")) x1 += dx;
  if (h.includes("n")) y0 += dy;
  if (h.includes("s")) y1 += dy;
  // (dragged past the other side, the box stays a pixel wide rather than turning over)
  if (h.includes("w")) x0 = Math.min(x0, x1 - 1);
  if (h.includes("e")) x1 = Math.max(x1, x0 + 1);
  if (h.includes("n")) y0 = Math.min(y0, y1 - 1);
  if (h.includes("s")) y1 = Math.max(y1, y0 + 1);
  if (keepRatio && b.w > 0 && b.h > 0) {
    const sides = h.length === 1;
    const k = sides ? (h === "e" || h === "w" ? (x1 - x0) / b.w : (y1 - y0) / b.h) : Math.max((x1 - x0) / b.w, (y1 - y0) / b.h);
    const w = b.w * k, hh = b.h * k;
    if (h.includes("w")) x0 = x1 - w;
    else if (h.includes("e") || sides) x1 = x0 + w;
    if (h.includes("n")) y0 = y1 - hh;
    else if (h.includes("s") || sides) y1 = y0 + hh;
    if (sides && (h === "e" || h === "w")) {
      const my = b.y + b.h / 2;
      y0 = my - hh / 2;
      y1 = my + hh / 2;
    } else if (sides) {
      const mx = b.x + b.w / 2;
      x0 = mx - w / 2;
      x1 = mx + w / 2;
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
