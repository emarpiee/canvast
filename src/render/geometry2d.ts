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

/** Whether segments (a, b) and (c, d) cross or touch. */
export function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(ax, ay, bx, by, cx, cy);
  const o2 = o(ax, ay, bx, by, dx, dy);
  const o3 = o(cx, cy, dx, dy, ax, ay);
  const o4 = o(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  const on = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): boolean => Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy);
  return (o1 === 0 && on(ax, ay, bx, by, cx, cy)) || (o2 === 0 && on(ax, ay, bx, by, dx, dy)) || (o3 === 0 && on(cx, cy, dx, dy, ax, ay)) || (o4 === 0 && on(cx, cy, dx, dy, bx, by));
}

/** Whether two polygons (flat [x0, y0, x1, y1, ...]) overlap: an edge crosses, or one lies inside the other. */
export function polygonsOverlap(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  const na = a.length / 2;
  const nb = b.length / 2;
  for (let i = 0; i < na; i++) {
    const j = (i + 1) % na;
    for (let k = 0; k < nb; k++) {
      const l = (k + 1) % nb;
      if (segmentsIntersect(a[2 * i]!, a[2 * i + 1]!, a[2 * j]!, a[2 * j + 1]!, b[2 * k]!, b[2 * k + 1]!, b[2 * l]!, b[2 * l + 1]!)) return true;
    }
  }
  return pointInPolygon(a[0]!, a[1]!, b) || pointInPolygon(b[0]!, b[1]!, a);
}

/** Whether a polyline (flat points; one point counts as a dot) touches a polygon: a point inside, or a segment crossing its edge. */
export function polylineTouchesPolygon(line: ArrayLike<number>, poly: ArrayLike<number>): boolean {
  const n = line.length / 2;
  for (let i = 0; i < n; i++) if (pointInPolygon(line[2 * i]!, line[2 * i + 1]!, poly)) return true;
  const m = poly.length / 2;
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k < m; k++) {
      const l = (k + 1) % m;
      if (segmentsIntersect(line[2 * i]!, line[2 * i + 1]!, line[2 * i + 2]!, line[2 * i + 3]!, poly[2 * k]!, poly[2 * k + 1]!, poly[2 * l]!, poly[2 * l + 1]!)) return true;
    }
  }
  return false;
}
