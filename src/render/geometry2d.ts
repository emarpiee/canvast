/** Small screen-space geometry helpers (doubles, CSS px). */

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Even-odd point-in-polygon; polygon is a flat [x0, y0, x1, y1, ...] array. */
export function pointInPolygon(x: number, y: number, poly: ArrayLike<number>): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = poly[i]!;
    const yi = poly[i + 1]!;
    const xj = poly[j]!;
    const yj = poly[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Liang–Barsky: clip segment a→b to rect. Returns [x0, y0, x1, y1] or null.
 */
export function clipSegment(ax: number, ay: number, bx: number, by: number, r: Rect): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: Array<[number, number]> = [
    [-dx, ax - r.minX],
    [dx, r.maxX - ax],
    [-dy, ay - r.minY],
    [dy, r.maxY - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** Sutherland–Hodgman: clip a convex or concave polygon to an axis-aligned rect. */
export function clipPolygon(poly: number[], r: Rect): number[] {
  type Edge = (x: number, y: number) => number; // >= 0 inside
  const edges: Edge[] = [
    (x) => x - r.minX,
    (x) => r.maxX - x,
    (_x, y) => y - r.minY,
    (_x, y) => r.maxY - y,
  ];
  let out = poly;
  for (const inside of edges) {
    const input = out;
    out = [];
    const n = input.length;
    if (n === 0) break;
    for (let i = 0; i < n; i += 2) {
      const ax = input[(i - 2 + n) % n]!;
      const ay = input[(i - 1 + n) % n]!;
      const bx = input[i]!;
      const by = input[i + 1]!;
      const da = inside(ax, ay);
      const db = inside(bx, by);
      if (db >= 0) {
        if (da < 0) {
          const t = da / (da - db);
          out.push(ax + t * (bx - ax), ay + t * (by - ay));
        }
        out.push(bx, by);
      } else if (da >= 0) {
        const t = da / (da - db);
        out.push(ax + t * (bx - ax), ay + t * (by - ay));
      }
    }
  }
  return out;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}
