/**
 * Vector path geometry (ADR 0099): pure functions over plain numbers, no DOM, no document. A path object (model.ts `PathObject`) is a
 * list of sub-paths; a sub-path is a list of nodes, flat, six numbers each:
 *
 *   [x, y,  inX, inY,  outX, outY, ...]
 *
 * (x, y) is the point; (inX, inY) and (outX, outY) are the handles of the curve arriving at and leaving it, as absolute local
 * coordinates, so every affine edit (move, scale, turn) is the same map applied to all three points and stays exact. A handle equal
 * to its point is no handle: a segment whose two ends have no handle is a straight line, otherwise a cubic Bézier
 * P0 = a.point, P1 = a.out, P2 = b.in, P3 = b.point.
 */
export interface SubPath {
  /** Nodes, six numbers each. */
  readonly n: readonly number[];
  readonly closed: boolean;
}

export const NODE = 6;
/** The miter limit the stroke is drawn with and bounded by (canvas default is 10; shapes look better cut earlier). */
export const MITER_LIMIT = 4;
/** The most vertices one path is flattened to (a guard against a degenerate path, not a quality setting). */
export const MAX_FLAT_POINTS = 60_000;

export type Join = "miter" | "bevel";
export type Cap = "butt" | "square";
/** Where the outline sits on the edge: centred on it (absent), wholly inside the shape or wholly outside it. */
export type Align = "inside" | "outside";
export interface StrokeStyle {
  readonly width: number;
  /** Absent: round. */
  readonly join?: Join | undefined;
  readonly cap?: Cap | undefined;
}

export const nodeCount = (s: SubPath): number => s.n.length / NODE;

/** A node with no handles: a corner of straight lines. */
export const corner = (x: number, y: number): number[] => [x, y, x, y, x, y];

/** A smooth node: handles `hx, hy` away along the tangent (the in handle is the mirror of the out handle). */
export const smooth = (x: number, y: number, hx: number, hy: number): number[] => [x, y, x - hx, y - hy, x + hx, y + hy];

const eq = (a: number, b: number, c: number, d: number): boolean => a === c && b === d;

/** Whether the segment from node `i` to node `j` of the sub-path is a straight line. */
export function isLine(n: ArrayLike<number>, i: number, j: number): boolean {
  const a = i * NODE;
  const b = j * NODE;
  return eq(n[a]!, n[a + 1]!, n[a + 4]!, n[a + 5]!) && eq(n[b]!, n[b + 1]!, n[b + 2]!, n[b + 3]!);
}

/** The node pairs (a, b) the sub-path draws, in order; a closed one ends with the segment back to the first node. */
export function* segmentsOf(s: SubPath): Generator<[number, number]> {
  const c = nodeCount(s);
  for (let i = 0; i + 1 < c; i++) yield [i, i + 1];
  if (s.closed && c > 1) yield [c - 1, 0];
}

// ---- Bounds ----------------------------------------------------------------------------------------------------------------------

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const grow = (b: Box, x: number, y: number): void => {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
};

/** Where the derivative of the 1D cubic through p0..p3 is zero, inside (0, 1): the extremes of a curve along one axis. */
export function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0) {
      const r = Math.sqrt(d);
      out.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

const at = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/** The control points of the segment from node `i` to node `j`: [x0, y0, x1, y1, x2, y2, x3, y3]. */
export function cubicOf(n: ArrayLike<number>, i: number, j: number): [number, number, number, number, number, number, number, number] {
  const a = i * NODE;
  const b = j * NODE;
  return [n[a]!, n[a + 1]!, n[a + 4]!, n[a + 5]!, n[b + 2]!, n[b + 3]!, n[b]!, n[b + 1]!];
}

/** The tight bounds of the curves alone (no stroke). */
export function geometryBounds(subs: readonly SubPath[]): Box {
  const box = emptyBox();
  for (const s of subs) {
    const c = nodeCount(s);
    if (c === 1) grow(box, s.n[0]!, s.n[1]!);
    for (const [i, j] of segmentsOf(s)) {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = cubicOf(s.n, i, j);
      grow(box, x0, y0);
      grow(box, x3, y3);
      if (isLine(s.n, i, j)) continue;
      for (const t of extrema(x0, x1, x2, x3)) grow(box, at(x0, x1, x2, x3, t), at(y0, y1, y2, y3, t));
      for (const t of extrema(y0, y1, y2, y3)) grow(box, at(x0, x1, x2, x3, t), at(y0, y1, y2, y3, t));
    }
  }
  return box;
}

/** The direction a segment leaves its first point and arrives at its last (unit vectors; zero when the segment is a point). */
function tangents(n: ArrayLike<number>, i: number, j: number): { out: [number, number]; into: [number, number] } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = cubicOf(n, i, j);
  const unit = (dx: number, dy: number): [number, number] => {
    const l = Math.hypot(dx, dy);
    return l > 0 ? [dx / l, dy / l] : [0, 0];
  };
  const out = [unit(x1 - x0, y1 - y0), unit(x2 - x0, y2 - y0), unit(x3 - x0, y3 - y0)].find((v) => v[0] || v[1]) ?? [0, 0];
  const into = [unit(x3 - x2, y3 - y2), unit(x3 - x1, y3 - y1), unit(x3 - x0, y3 - y0)].find((v) => v[0] || v[1]) ?? [0, 0];
  return { out, into };
}

/**
 * The bounds of the paint: the curves grown by half the stroke width, plus the tips of mitered corners and the corners of square caps,
 * which stick out past that. `style` null: no stroke.
 */
export function paintBounds(subs: readonly SubPath[], style: StrokeStyle | null): Box {
  const box = geometryBounds(subs);
  if (!style || !(style.width > 0) || box.minX > box.maxX) return box;
  const h = style.width / 2;
  const tips: Array<[number, number]> = [];
  for (const s of subs) {
    const c = nodeCount(s);
    if (c < 2) continue;
    const segs = [...segmentsOf(s)];
    const tan = segs.map(([i, j]) => tangents(s.n, i, j));
    if (style.join === "miter") {
      for (let k = 0; k < segs.length; k++) {
        const next = k + 1 < segs.length ? k + 1 : s.closed ? 0 : -1;
        if (next < 0) continue;
        const t1 = tan[k]!.into;
        const t2 = tan[next]!.out;
        const dx = t1[0] - t2[0];
        const dy = t1[1] - t2[1];
        const l = Math.hypot(dx, dy);
        if (l < 1e-9) continue; // straight on
        const m = 1 / Math.sqrt(Math.max(1e-12, (1 + t1[0] * t2[0] + t1[1] * t2[1]) / 2));
        if (m > MITER_LIMIT) continue; // cut to a bevel by the limit
        const [j] = [segs[k]![1]];
        tips.push([s.n[j * NODE]! + (dx / l) * h * m, s.n[j * NODE + 1]! + (dy / l) * h * m]);
      }
    }
    if (style.cap === "square" && !s.closed) {
      const first = tan[0]!.out;
      const last = tan[tan.length - 1]!.into;
      const ends: Array<[number, number, number, number]> = [
        [s.n[0]!, s.n[1]!, -first[0], -first[1]],
        [s.n[(c - 1) * NODE]!, s.n[(c - 1) * NODE + 1]!, last[0], last[1]],
      ];
      for (const [x, y, tx, ty] of ends) {
        tips.push([x + (tx - ty) * h, y + (ty + tx) * h], [x + (tx + ty) * h, y + (ty - tx) * h]);
      }
    }
  }
  const out: Box = { minX: box.minX - h, minY: box.minY - h, maxX: box.maxX + h, maxY: box.maxY + h };
  for (const [x, y] of tips) grow(out, x, y);
  return out;
}

// ---- Affine edits -----------------------------------------------------------------------------------------------------------------

/** Every point of every node (and its handles) through `f`. */
export function mapSubs(subs: readonly SubPath[], f: (x: number, y: number) => [number, number]): SubPath[] {
  return subs.map((s) => {
    const n = new Array<number>(s.n.length);
    for (let i = 0; i < s.n.length; i += 2) {
      const [x, y] = f(s.n[i]!, s.n[i + 1]!);
      n[i] = x;
      n[i + 1] = y;
    }
    return { n, closed: s.closed };
  });
}

/** Turn by (c, s) = (cos, sin) about (px, py). */
export const rotateSubs = (subs: readonly SubPath[], px: number, py: number, c: number, s: number): SubPath[] =>
  mapSubs(subs, (x, y) => [px + c * (x - px) - s * (y - py), py + s * (x - px) + c * (y - py)]);

export const scaleSubs = (subs: readonly SubPath[], kx: number, ky: number): SubPath[] => mapSubs(subs, (x, y) => [x * kx, y * ky]);

// ---- Flattening ------------------------------------------------------------------------------------------------------------------

/** How far from the true curve (px) a flattened path may be. Antialiasing hides 0.2: a finer tolerance only costs points. */
export const FLAT_TOLERANCE_PX = 0.2;

export interface FlatPath {
  /** Vertices, x then y; a closed outline does not repeat its first vertex. */
  readonly pts: Float64Array;
  readonly closed: boolean;
}

/** A piece that needs at most this many straight pieces is drawn directly; one that needs more is halved (and culled) first. */
const DIRECT_PIECES = 24;
/** Deepest halving of one segment (a guard: a piece this small is a chord). */
const MAX_HALVINGS = 24;

/**
 * Flatten sub-paths whose nodes are already in screen space (`q`: the nodes of each, six numbers each, projected) into polylines.
 * A cubic needs n = ceil(sqrt(3/4 · M / tol)) straight pieces to stay within `tol` of the curve, M being the larger second difference
 * of its control points (Wang's bound): a piece that needs few is evaluated at n even steps; one that needs many is halved at t = 1/2
 * and each half is treated the same way, so work goes only to the parts of a big curve that are on screen. A piece whose control
 * points all lie beyond the same side of `view` (grown by `margin`) cannot show: it is replaced by its chord.
 */
export function flatten(subs: readonly SubPath[], q: readonly Float64Array[], tol: number, view: Box, margin: number): FlatPath[] {
  const out: FlatPath[] = [];
  const minX = view.minX - margin;
  const minY = view.minY - margin;
  const maxX = view.maxX + margin;
  const maxY = view.maxY + margin;
  let budget = MAX_FLAT_POINTS;
  let pts: number[] = [];
  const k = 0.75 / tol;

  const piece = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, depth: number): void => {
    if (
      (x0 < minX && x1 < minX && x2 < minX && x3 < minX) ||
      (x0 > maxX && x1 > maxX && x2 > maxX && x3 > maxX) ||
      (y0 < minY && y1 < minY && y2 < minY && y3 < minY) ||
      (y0 > maxY && y1 > maxY && y2 > maxY && y3 > maxY) ||
      budget <= 0
    ) {
      pts.push(x3, y3);
      budget--;
      return;
    }
    const ax = x0 - 2 * x1 + x2;
    const ay = y0 - 2 * y1 + y2;
    const bx = x1 - 2 * x2 + x3;
    const by = y1 - 2 * y2 + y3;
    const m2 = Math.max(ax * ax + ay * ay, bx * bx + by * by);
    const n = Math.ceil(Math.sqrt(k * Math.sqrt(m2)));
    if (n <= DIRECT_PIECES || depth >= MAX_HALVINGS) {
      // n even steps in t: the cubic in power form, evaluated by Horner.
      const cx = 3 * (x1 - x0);
      const cy = 3 * (y1 - y0);
      const dx = 3 * (x2 - x1) - cx;
      const dy = 3 * (y2 - y1) - cy;
      const ex = x3 - x0 - cx - dx;
      const ey = y3 - y0 - cy - dy;
      const steps = Math.max(1, n);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        pts.push(x0 + t * (cx + t * (dx + t * ex)), y0 + t * (cy + t * (dy + t * ey)));
      }
      pts.push(x3, y3);
      budget -= steps;
      return;
    }
    // de Casteljau at 1/2.
    const abx = (x0 + x1) / 2, aby = (y0 + y1) / 2;
    const bcx = (x1 + x2) / 2, bcy = (y1 + y2) / 2;
    const cdx = (x2 + x3) / 2, cdy = (y2 + y3) / 2;
    const abcx = (abx + bcx) / 2, abcy = (aby + bcy) / 2;
    const bcdx = (bcx + cdx) / 2, bcdy = (bcy + cdy) / 2;
    const mx = (abcx + bcdx) / 2, my = (abcy + bcdy) / 2;
    piece(x0, y0, abx, aby, abcx, abcy, mx, my, depth + 1);
    piece(mx, my, bcdx, bcdy, cdx, cdy, x3, y3, depth + 1);
  };

  subs.forEach((s, si) => {
    const n = q[si]!;
    if (nodeCount(s) === 0) return;
    pts = [n[0]!, n[1]!];
    for (const [i, j] of segmentsOf(s)) {
      const closing = j === 0 && s.closed;
      if (isLine(s.n, i, j)) {
        if (!closing) pts.push(n[j * NODE]!, n[j * NODE + 1]!);
        continue;
      }
      const c = cubicOf(n, i, j);
      piece(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], 0);
      if (closing) pts.length -= 2; // the closing segment ends on the first vertex, which is already there
    }
    out.push({ pts: Float64Array.from(pts), closed: s.closed });
  });
  return out;
}

/** Append the interior points and the end of a small cubic (control points in screen space) to `out`, within `tol` of the curve (Wang's bound, even steps in t). */
export function cubicPoints(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, tol: number): void {
  const ax = x0 - 2 * x1 + x2;
  const ay = y0 - 2 * y1 + y2;
  const bx = x1 - 2 * x2 + x3;
  const by = y1 - 2 * y2 + y3;
  const m = Math.sqrt(Math.max(ax * ax + ay * ay, bx * bx + by * by));
  const steps = Math.min(4096, Math.max(1, Math.ceil(Math.sqrt((0.75 * m) / tol))));
  const cx = 3 * (x1 - x0);
  const cy = 3 * (y1 - y0);
  const dx = 3 * (x2 - x1) - cx;
  const dy = 3 * (y2 - y1) - cy;
  const ex = x3 - x0 - cx - dx;
  const ey = y3 - y0 - cy - dy;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    out.push(x0 + t * (cx + t * (dx + t * ex)), y0 + t * (cy + t * (dy + t * ey)));
  }
  out.push(x3, y3);
}

// ---- Picking ----------------------------------------------------------------------------------------------------------------------

/** The winding number of the closed polylines around (x, y); open ones count as closed (a fill closes its outline). */
export function winding(flats: readonly FlatPath[], x: number, y: number): number {
  let w = 0;
  for (const f of flats) {
    const p = f.pts;
    const m = p.length / 2;
    if (m < 3) continue;
    let ax = p[(m - 1) * 2]!;
    let ay = p[(m - 1) * 2 + 1]!;
    for (let i = 0; i < m; i++) {
      const bx = p[i * 2]!;
      const by = p[i * 2 + 1]!;
      if (ay <= y) {
        if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
      } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
      ax = bx;
      ay = by;
    }
  }
  return w;
}

/** Whether (x, y) is inside the fill (non-zero winding, or odd for the even-odd rule). */
export const insideFill = (flats: readonly FlatPath[], x: number, y: number, evenOdd: boolean): boolean => {
  const w = winding(flats, x, y);
  return evenOdd ? (w & 1) !== 0 : w !== 0;
};

/** The distance from (x, y) to the nearest line of the flattened outlines (closing segments of closed ones included). */
export function distanceToOutline(flats: readonly FlatPath[], x: number, y: number): number {
  let best = Infinity;
  for (const f of flats) {
    const p = f.pts;
    const m = p.length / 2;
    if (m === 1) best = Math.min(best, Math.hypot(x - p[0]!, y - p[1]!));
    const last = f.closed ? m : m - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % m;
      best = Math.min(best, distSeg(x, y, p[i * 2]!, p[i * 2 + 1]!, p[j * 2]!, p[j * 2 + 1]!));
    }
  }
  return best;
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---- Shapes -----------------------------------------------------------------------------------------------------------------------

export type ShapeKind = "rect" | "ellipse" | "line" | "polygon" | "star";
export const SHAPE_KINDS: readonly ShapeKind[] = ["rect", "ellipse", "line", "polygon", "star"];

/** What a path is called in lists and undo labels. */
export const SHAPE_NAMES: Record<ShapeKind | "path", string> = { rect: "Rectangle", ellipse: "Ellipse", line: "Line", polygon: "Polygon", star: "Star", path: "Path" };

/** The handle length that makes a cubic follow a quarter circle (0.5522847498). */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

export const rectSubs = (x: number, y: number, w: number, h: number): SubPath[] => [
  { n: [...corner(x, y), ...corner(x + w, y), ...corner(x + w, y + h), ...corner(x, y + h)], closed: true },
];

export function ellipseSubs(x: number, y: number, w: number, h: number): SubPath[] {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  // Top, right, bottom, left; clockwise in screen axes (y down): the handles run along the tangent.
  return [
    {
      n: [
        cx, y, cx - kx, y, cx + kx, y,
        x + w, cy, x + w, cy - ky, x + w, cy + ky,
        cx, y + h, cx + kx, y + h, cx - kx, y + h,
        x, cy, x, cy + ky, x, cy - ky,
      ],
      closed: true,
    },
  ];
}

export const lineSubs = (x0: number, y0: number, x1: number, y1: number): SubPath[] => [{ n: [...corner(x0, y0), ...corner(x1, y1)], closed: false }];

/** A regular polygon of `sides` corners inscribed in the ellipse of the box, the first corner at the top. */
export function polygonSubs(x: number, y: number, w: number, h: number, sides: number): SubPath[] {
  const n: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    n.push(...corner(x + w / 2 + (Math.cos(a) * w) / 2, y + h / 2 + (Math.sin(a) * h) / 2));
  }
  return [{ n, closed: true }];
}

/** A star of `points` tips; the inner corners sit at `inner` (0 to 1) of the outer radius. */
export function starSubs(x: number, y: number, w: number, h: number, points: number, inner: number): SubPath[] {
  const n: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const k = i % 2 === 0 ? 1 : inner;
    n.push(...corner(x + w / 2 + (Math.cos(a) * w * k) / 2, y + h / 2 + (Math.sin(a) * h * k) / 2));
  }
  return [{ n, closed: true }];
}

/** The geometry of a shape kind for a box (a line runs corner to corner). */
export function shapeSubs(kind: ShapeKind, x: number, y: number, w: number, h: number, sides = 6, tips = 5, inner = 0.45): SubPath[] {
  switch (kind) {
    case "rect": return rectSubs(x, y, w, h);
    case "ellipse": return ellipseSubs(x, y, w, h);
    case "line": return lineSubs(x, y, x + w, y + h);
    case "polygon": return polygonSubs(x, y, w, h, sides);
    case "star": return starSubs(x, y, w, h, tips, inner);
  }
}

// ---- Parametric shapes: sides, points, ratio and corner radius, editable after drawing (ADR 0105) -----------------------------------

/** What a drawn shape is made from, kept so it can be changed later: its box and the numbers its kind takes (lengths in the object's local units). */
export interface ShapeParams {
  /** x, y, width, height of the unrounded shape's bounds. */
  readonly box: readonly [number, number, number, number];
  readonly sides?: number;
  readonly tips?: number;
  /** A star's inner radius as a fraction of the outer one. */
  readonly inner?: number;
}

export const DEFAULT_INNER = 0.45;
/** Shapes with corners that can be rounded. */
export const CORNERED: readonly ShapeKind[] = ["rect", "polygon", "star"];

/** A shape filling `box` exactly (a polygon or star is stretched so that its bounds, not its circle, are the box). */
export function fittedShape(kind: ShapeKind, p: ShapeParams): SubPath[] {
  const g = shapeSubs(kind, 0, 0, 1, 1, p.sides ?? 6, p.tips ?? 5, p.inner ?? DEFAULT_INNER);
  const b = geometryBounds(g);
  const [x, y, w, h] = p.box;
  const sx = b.maxX > b.minX ? w / (b.maxX - b.minX) : 1;
  const sy = b.maxY > b.minY ? h / (b.maxY - b.minY) : 1;
  return mapSubs(g, (px, py) => [x + (px - b.minX) * sx, y + (py - b.minY) * sy]);
}

/** The parameters after the object's local coordinates are scaled. */
export const scaleParams = (p: ShapeParams, kx: number, ky: number): ShapeParams => ({ ...p, box: [p.box[0] * kx, p.box[1] * ky, p.box[2] * kx, p.box[3] * ky] });

/** A corner radius: one for every corner, or (a rectangle) one per node of its first sub-path. */
export type Radius = number | readonly number[];

/** The radius after the object's local units are renamed by a factor (the same world size). */
export const scaleRadius = (r: Radius, k: number): Radius => (typeof r === "number" ? r * k : r.map((v) => v * k));

/** The parameters of a shape just drawn into a box (null for kinds that have none). */
export const drawnParams = (kind: ShapeKind, x: number, y: number, w: number, h: number, sides: number, tips: number): ShapeParams | null =>
  CORNERED.includes(kind) ? { box: [x, y, w, h], ...(kind === "polygon" ? { sides } : {}), ...(kind === "star" ? { tips, inner: DEFAULT_INNER } : {}) } : null;

/** The geometry of a shape being drawn: the same as it will be once drawn (fitted to its box). */
export const drawnSubs = (kind: ShapeKind, x: number, y: number, w: number, h: number, sides: number, tips: number): SubPath[] => {
  const p = drawnParams(kind, x, y, w, h, sides, tips);
  return p ? fittedShape(kind, p) : shapeSubs(kind, x, y, w, h, sides, tips);
};

// ---- Editing nodes ----------------------------------------------------------------------------------------------------------------

/** The sub-paths with node `k` of sub-path `s` replaced (`node` null removes it; a sub-path left with no node is dropped). */
export function withNode(subs: readonly SubPath[], s: number, k: number, node: readonly number[] | null): SubPath[] {
  return subs.flatMap((sp, i) => {
    if (i !== s) return [sp];
    const n = [...sp.n.slice(0, k * NODE), ...(node ?? []), ...sp.n.slice((k + 1) * NODE)];
    return n.length ? [{ n, closed: sp.closed && n.length >= 3 * NODE }] : [];
  });
}

/** Insert a node on the segment after node `k`, splitting the curve at `t` (de Casteljau: the shape does not change). */
export function splitSegment(subs: readonly SubPath[], s: number, k: number, t: number): SubPath[] {
  const sp = subs[s]!;
  const c = nodeCount(sp);
  const j = (k + 1) % c;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = cubicOf(sp.n, k, j);
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  const ax = lerp(x0, x1), ay = lerp(y0, y1);
  const bx = lerp(x1, x2), by = lerp(y1, y2);
  const cx = lerp(x2, x3), cy = lerp(y2, y3);
  const dx = lerp(ax, bx), dy = lerp(ay, by);
  const ex = lerp(bx, cx), ey = lerp(by, cy);
  const mx = lerp(dx, ex), my = lerp(dy, ey);
  const n = [...sp.n];
  // The first node's out handle and the second's in handle shrink to their halves; the new node sits between them.
  n[k * NODE + 4] = ax;
  n[k * NODE + 5] = ay;
  n[j * NODE + 2] = cx;
  n[j * NODE + 3] = cy;
  const fresh = [mx, my, dx, dy, ex, ey];
  const at2 = (k + 1) * NODE;
  n.splice(at2, 0, ...fresh);
  // A segment that closed back to node 0 now ends at the new last node: j moved by one if it wrapped, which `n` already reflects.
  return subs.map((x, i) => (i === s ? { n, closed: x.closed } : x));
}

/** Toggle a node between a corner (no handles) and smooth (handles along the line between its neighbours, a third of the way). */
export function toggleSmooth(subs: readonly SubPath[], s: number, k: number): SubPath[] {
  const sp = subs[s]!;
  const c = nodeCount(sp);
  const o = k * NODE;
  const isCorner = eq(sp.n[o]!, sp.n[o + 1]!, sp.n[o + 2]!, sp.n[o + 3]!) && eq(sp.n[o]!, sp.n[o + 1]!, sp.n[o + 4]!, sp.n[o + 5]!);
  const n = [...sp.n];
  if (!isCorner) {
    n.splice(o + 2, 4, n[o]!, n[o + 1]!, n[o]!, n[o + 1]!);
  } else {
    const prev = ((k - 1 + c) % c) * NODE;
    const next = ((k + 1) % c) * NODE;
    const hasPrev = sp.closed || k > 0;
    const hasNext = sp.closed || k < c - 1;
    const px = hasPrev ? sp.n[prev]! : sp.n[o]!;
    const py = hasPrev ? sp.n[prev + 1]! : sp.n[o + 1]!;
    const qx = hasNext ? sp.n[next]! : sp.n[o]!;
    const qy = hasNext ? sp.n[next + 1]! : sp.n[o + 1]!;
    const tx = qx - px;
    const ty = qy - py;
    const tl = Math.hypot(tx, ty) || 1;
    const reach = Math.min(hasPrev ? Math.hypot(sp.n[o]! - px, sp.n[o + 1]! - py) : Infinity, hasNext ? Math.hypot(qx - sp.n[o]!, qy - sp.n[o + 1]!) : Infinity) / 3;
    const hx = (tx / tl) * (Number.isFinite(reach) ? reach : 0);
    const hy = (ty / tl) * (Number.isFinite(reach) ? reach : 0);
    n.splice(o + 2, 4, sp.n[o]! - hx, sp.n[o + 1]! - hy, sp.n[o]! + hx, sp.n[o + 1]! + hy);
  }
  return subs.map((x, i) => (i === s ? { n, closed: x.closed } : x));
}

/** Move node `k` (point and both handles together) by (dx, dy). */
export function moveNode(subs: readonly SubPath[], s: number, k: number, dx: number, dy: number): SubPath[] {
  return subs.map((sp, i) => {
    if (i !== s) return sp;
    const n = [...sp.n];
    for (let m = 0; m < NODE; m += 2) {
      n[k * NODE + m] = n[k * NODE + m]! + dx;
      n[k * NODE + m + 1] = n[k * NODE + m + 1]! + dy;
    }
    return { n, closed: sp.closed };
  });
}

/** Move one handle (`which` 2: in, 4: out) of node `k` to (x, y); `mirror` moves the other opposite and equally long (smooth nodes). */
export function moveHandle(subs: readonly SubPath[], s: number, k: number, which: 2 | 4, x: number, y: number, mirror: boolean): SubPath[] {
  return subs.map((sp, i) => {
    if (i !== s) return sp;
    const n = [...sp.n];
    const o = k * NODE;
    n[o + which] = x;
    n[o + which + 1] = y;
    if (mirror) {
      const other = which === 2 ? 4 : 2;
      n[o + other] = 2 * n[o]! - x;
      n[o + other + 1] = 2 * n[o + 1]! - y;
    }
    return { n, closed: sp.closed };
  });
}
