import type { Gradient } from "../doc/paint";
import { cssAngle, cssStops, splitTop } from "./svg-import";

const SIDES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };
const percent = (v: string): number | null => (/^-?[\d.]+%$/.test(v) ? parseFloat(v) / 100 : null);
const at = (s: string): [number, number] | null => {
  const m = /\bat\s+(\S+)(?:\s+(\S+))?/.exec(s);
  if (!m) return [0.5, 0.5];
  const p = (w: string | undefined, horizontal: boolean): number | null =>
    w === undefined || w === "center" ? 0.5 : w === (horizontal ? "left" : "top") ? 0 : w === (horizontal ? "right" : "bottom") ? 1 : percent(w);
  const x = p(m[1], true), y = p(m[2], false);
  return x === null || y === null ? null : [x, y];
};

/**
 * A CSS `linear-gradient(...)`, `radial-gradient(...)` or `conic-gradient(...)` (as copied from a stylesheet, with or without `background:`) as a
 * gradient in box units, or null when it is not one or uses what a gradient here cannot say (repeating, positions in lengths).
 * shortcut: the box is taken as a square (a linear angle and a radial size follow the box's own shape in CSS), upgrade with a box-aware parse.
 */
export function parseCssGradient(text: string): Gradient | null {
  const m = /^\s*(?:background(?:-image)?\s*:\s*)?(linear|radial|conic)-gradient\(([\s\S]*)\)\s*;?\s*$/i.exec(text);
  if (!m) return null;
  const kind = m[1]!.toLowerCase();
  const parts = splitTop(m[2]!);
  const head = parts[0]?.trim() ?? "";
  const isHead = /^(to\s|circle|ellipse|closest|farthest|from\s|at\s|-?[\d.]+(deg|turn|rad|grad)\b)/.test(head); // (else the first part is already a stop)
  const pre = isHead ? (parts.shift() ?? "").trim() : "";
  const stops = cssStops(parts, percent) ?? (kind === "conic" ? cssStops(parts, (v) => { const a = cssAngle(v); return a === null ? null : a / 360; }) : null);
  if (!stops) return null;
  const list = stops.map((s) => ({ o: s.o, c: s.c }));
  if (kind === "linear") {
    let deg = 180; // (the default: to the bottom)
    const to = /^to\s+(top|bottom|left|right)(?:\s+(top|bottom|left|right))?$/.exec(pre);
    if (to) deg = to[2] ? (SIDES[to[1]!]! + SIDES[to[2]]! + (to[1] === "top" && to[2] === "left" ? 360 : 0)) / 2 : SIDES[to[1]!]!;
    else if (pre) {
      const a = cssAngle(pre);
      if (a === null) return null;
      deg = a;
    }
    const t = (deg * Math.PI) / 180, dx = Math.sin(t), dy = -Math.cos(t), h = (Math.abs(dx) + Math.abs(dy)) / 2;
    return { type: "linear", x0: 0.5 - dx * h, y0: 0.5 - dy * h, x1: 0.5 + dx * h, y1: 0.5 + dy * h, stops: list };
  }
  const centre = at(pre);
  if (!centre) return null;
  if (kind === "radial") {
    const [cx, cy] = centre;
    const far = Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)), side = Math.max(cx, 1 - cx, cy, 1 - cy);
    const r = /closest-side/.test(pre) ? Math.min(cx, 1 - cx, cy, 1 - cy) : /farthest-side/.test(pre) ? side : /closest-corner/.test(pre) ? Math.hypot(Math.min(cx, 1 - cx), Math.min(cy, 1 - cy)) : far;
    return r > 0 ? { type: "radial", cx, cy, r, stops: list } : null;
  }
  const from = /\bfrom\s+(\S+)/.exec(pre);
  const f = from ? cssAngle(from[1]!) : 0;
  if (f === null) return null;
  return { type: "angular", cx: centre[0], cy: centre[1], angle: (((f - 90) % 360) + 360) % 360, stops: list }; // (CSS counts from the top, the model from pointing right)
}
