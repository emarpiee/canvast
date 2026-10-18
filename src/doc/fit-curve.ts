/**
 * Fit a smooth Bézier path through a polyline (Schneider, "An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems):
 * as few cubic segments as keep every point within `tol` of the curve. Used by Simplify (the nodes of a path) and by Stroke to path.
 */
import { NODE, cubicPoints, type SubPath } from "./path";

type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1];
const len = (a: V): number => Math.hypot(a[0], a[1]);
const unit = (a: V): V => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};
type Cubic = [V, V, V, V];

const at = (c: Cubic, t: number): V => {
  const u = 1 - t;
  const [a, b, d, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
};
const d1 = (c: Cubic, t: number): V => {
  const u = 1 - t;
  return add(add(mul(sub(c[1], c[0]), 3 * u * u), mul(sub(c[2], c[1]), 6 * u * t)), mul(sub(c[3], c[2]), 3 * t * t));
};
const d2 = (c: Cubic, t: number): V => add(mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * (1 - t)), mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t));

function chord(p: V[], a: number, b: number): number[] {
  const u = [0];
  for (let i = a + 1; i <= b; i++) u.push(u[u.length - 1]! + len(sub(p[i]!, p[i - 1]!)));
  const total = u[u.length - 1]! || 1;
  return u.map((x) => x / total);
}

function generate(p: V[], a: number, b: number, u: number[], t1: V, t2: V): Cubic {
  const p0 = p[a]!;
  const p3 = p[b]!;
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i <= b - a; i++) {
    const t = u[i]!, m = 1 - t;
    const b1 = 3 * t * m * m, b2 = 3 * t * t * m, b0 = m * m * m, b3 = t * t * t;
    const A1 = mul(t1, b1), A2 = mul(t2, b2);
    c00 += dot(A1, A1); c01 += dot(A1, A2); c11 += dot(A2, A2);
    const tmp = sub(p[a + i]!, add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(A1, tmp); x1 += dot(A2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const seg = len(sub(p3, p0));
  let l1 = det ? (x0 * c11 - x1 * c01) / det : 0;
  let l2 = det ? (c00 * x1 - c01 * x0) / det : 0;
  if (!(l1 > 1e-6 * seg) || !(l2 > 1e-6 * seg)) l1 = l2 = seg / 3; // a degenerate fit: a third of the chord each
  return [p0, add(p0, mul(t1, l1)), add(p3, mul(t2, l2)), p3];
}

function reparam(c: Cubic, p: V[], a: number, u: number[]): number[] {
  return u.map((t, i) => {
    const d = sub(at(c, t), p[a + i]!);
    const q = d1(c, t), q2 = d2(c, t);
    const den = dot(q, q) + dot(d, q2);
    return den ? Math.min(1, Math.max(0, t - dot(d, q) / den)) : t;
  });
}

function worst(c: Cubic, p: V[], a: number, u: number[]): { err: number; at: number } {
  let err = 0, k = Math.floor((a + a + u.length) / 2) - a;
  for (let i = 1; i < u.length - 1; i++) {
    const e = len(sub(at(c, u[i]!), p[a + i]!));
    if (e >= err) { err = e; k = i; }
  }
  return { err, at: a + k };
}

function fit(p: V[], a: number, b: number, t1: V, t2: V, tol: number, out: Cubic[]): void {
  if (b - a === 1) {
    const l = len(sub(p[b]!, p[a]!)) / 3;
    out.push([p[a]!, add(p[a]!, mul(t1, l)), add(p[b]!, mul(t2, l)), p[b]!]);
    return;
  }
  let u = chord(p, a, b);
  let c = generate(p, a, b, u, t1, t2);
  let w = worst(c, p, a, u);
  for (let i = 0; i < 4 && w.err > tol && w.err < tol * 16; i++) {
    u = reparam(c, p, a, u);
    c = generate(p, a, b, u, t1, t2);
    w = worst(c, p, a, u);
  }
  if (w.err <= tol) return void out.push(c);
  const m = Math.min(b - 1, Math.max(a + 1, w.at));
  const tc = unit(sub(p[m - 1]!, p[m + 1]!));
  fit(p, a, m, t1, tc, tol, out);
  fit(p, m, b, mul(tc, -1), t2, tol, out);
}

/** The nodes of a smooth path through `pts` ([x0, y0, x1, y1, ...]) within `tol` of every point; the ends stay where they are. */
export function fitPolyline(pts: readonly number[], tol: number): SubPath {
  const p: V[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const v: V = [pts[i]!, pts[i + 1]!];
    const last = p[p.length - 1];
    if (!last || len(sub(v, last)) > 1e-12) p.push(v);
  }
  if (p.length < 2) return { n: p.length ? [...p[0]!, ...p[0]!, ...p[0]!] : [], closed: false };
  const curves: Cubic[] = [];
  fit(p, 0, p.length - 1, unit(sub(p[1]!, p[0]!)), unit(sub(p[p.length - 2]!, p[p.length - 1]!)), tol, curves);
  const n: number[] = [];
  curves.forEach((c, i) => {
    if (i === 0) n.push(c[0][0], c[0][1], c[0][0], c[0][1], c[1][0], c[1][1]);
    else n.splice(n.length - 2, 2, c[1][0], c[1][1]); // the out-handle of the node before
    n.push(c[3][0], c[3][1], c[2][0], c[2][1], c[3][0], c[3][1]); // (its out-handle is set when the next curve starts)
  });
  return { n, closed: false };
}

/** The points of a sub-path as a polyline, a curve cut so no piece strays more than `tol` from it. */
export function polylineOf(s: SubPath, tol: number): number[] {
  const out: number[] = [s.n[0]!, s.n[1]!];
  const count = s.n.length / NODE;
  for (let k = 0; k < (s.closed ? count : count - 1); k++) {
    const i = k * NODE, j = ((k + 1) % count) * NODE;
    cubicPoints(out, s.n[i]!, s.n[i + 1]!, s.n[i + 4]!, s.n[i + 5]!, s.n[j + 2]!, s.n[j + 3]!, s.n[j]!, s.n[j + 1]!, tol);
  }
  return out;
}

/** Fewer nodes for the same shape: the sub-path is cut into a polyline and fitted again within `tol`. A closed one is opened at its first node and closed again. */
export function simplifySub(s: SubPath, tol: number): SubPath {
  if (s.n.length / NODE < 3) return s;
  const pts = polylineOf(s, tol / 4);
  if (s.closed) pts.push(pts[0]!, pts[1]!); // (cubicPoints already ends at the first node when closed; the duplicate is dropped by fitPolyline)
  const fitted = fitPolyline(pts, tol);
  if (fitted.n.length >= s.n.length) return s; // never more nodes than it had
  if (!s.closed) return fitted;
  if (fitted.n.length < 2 * NODE) return s;
  // join the ends: the last node (the same place as the first) is dropped and its in-handle goes to the first
  const n = fitted.n.slice(0, -NODE);
  n[2] = fitted.n[fitted.n.length - NODE + 2]!;
  n[3] = fitted.n[fitted.n.length - NODE + 3]!;
  return { n, closed: true };
}
