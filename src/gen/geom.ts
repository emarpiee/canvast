import { corner, smooth } from "./core";
import type { SubPath } from "./core";
import type { GenShape } from "./types";

export type P = readonly [number, number];
const K = 0.5522847498;

export const rect = (x: number, y: number, w: number, h: number): SubPath => ({ n: [...corner(x, y), ...corner(x + w, y), ...corner(x + w, y + h), ...corner(x, y + h)], closed: true });

export const poly = (pts: readonly P[], closed = true): SubPath => ({ n: pts.flatMap(([x, y]) => corner(x, y)), closed });

export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): SubPath {
  const c = Math.cos(rot), s = Math.sin(rot);
  const at = (x: number, y: number): P => [cx + x * c - y * s, cy + x * s + y * c];
  const node = (px: number, py: number, hx: number, hy: number): number[] => {
    const [x, y] = at(px, py), [ix, iy] = at(px - hx, py - hy), [ox, oy] = at(px + hx, py + hy);
    return [x, y, ix, iy, ox, oy];
  };
  return { n: [...node(rx, 0, 0, ry * K), ...node(0, ry, -rx * K, 0), ...node(-rx, 0, 0, -ry * K), ...node(0, -ry, rx * K, 0)], closed: true };
}

/** Nodes of a smooth curve through the points (Catmull-Rom); `tension` 0 is straight corners, 1 the usual curve. */
export function through(pts: readonly P[], closed: boolean, tension = 1): number[] {
  const m = pts.length;
  const out: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = pts[closed ? (i - 1 + m) % m : Math.max(i - 1, 0)]!, b = pts[i]!, c = pts[closed ? (i + 1) % m : Math.min(i + 1, m - 1)]!;
    out.push(...smooth(b[0], b[1], ((c[0] - a[0]) / 6) * tension, ((c[1] - a[1]) / 6) * tension));
  }
  return out;
}

/** A smooth open curve that does not bend at its two ends. */
export function curve(pts: readonly P[], tension = 1): SubPath {
  const n = through(pts, false, tension);
  const e = n.length - 6;
  n[2] = n[0]!; n[3] = n[1]!; n[e + 4] = n[e]!; n[e + 5] = n[e + 1]!;
  return { n, closed: false };
}

/** The area under a curve through the points, down to `bottom` (or up to it), closed. */
export function under(pts: readonly P[], bottom: number, left: number, right: number, tension = 1): SubPath {
  const c = curve(pts, tension);
  return { n: [...c.n, ...corner(right, bottom), ...corner(left, bottom)], closed: true };
}

export const rotated = (pts: readonly P[], cx: number, cy: number, a: number): P[] => {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
};

export const regular = (cx: number, cy: number, r: number, sides: number, rot: number): P[] => Array.from({ length: sides }, (_, i) => [cx + r * Math.cos(rot + (i * 2 * Math.PI) / sides), cy + r * Math.sin(rot + (i * 2 * Math.PI) / sides)]);

export const star = (cx: number, cy: number, r: number, points: number, ratio: number, rot: number): P[] => Array.from({ length: points * 2 }, (_, i) => {
  const a = rot + (i * Math.PI) / points, rr = i % 2 ? r * ratio : r;
  return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
});

export const centroid = (pts: readonly P[]): P => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

/** The points moved toward their centre: `k` 1 leaves them, 0.8 leaves a gap of a fifth. */
export function inset(pts: readonly P[], k: number): P[] {
  const [cx, cy] = centroid(pts);
  return pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/** Shapes of one fill and outline drawn as one path (what lies on top of what does not matter for them); the first one's place in the order is kept. */
export function merged(shapes: readonly GenShape[]): GenShape[] {
  const by = new Map<string, GenShape>();
  for (const s of shapes) {
    const key = JSON.stringify([s.fill, s.stroke, s.width, s.evenodd ?? false]);
    const g = by.get(key);
    if (g) g.sub.push(...s.sub);
    else by.set(key, { ...s, sub: [...s.sub] });
  }
  return [...by.values()];
}

export const solid = (sub: SubPath[], fill: string, name?: string): GenShape => ({ sub, fill, stroke: null, width: 1, ...(name ? { name } : {}) });
export const line = (sub: SubPath[], stroke: string, width: number, name?: string): GenShape => ({ sub, fill: null, stroke, width, ...(name ? { name } : {}) });
