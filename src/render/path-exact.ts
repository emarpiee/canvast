import * as D from "../core/dyadic";
import type { Viewport } from "../core/camera";
import type { PathObject, StrokeObject } from "../doc/model";
import { pathSubs } from "../doc/model";
import type { FlatPath, SubPath } from "../doc/path";
import { FLAT_TOLERANCE_PX, NODE, cubicOf, cubicPoints, isLine, nodeCount, segmentsOf } from "../doc/path";
import type { Projection } from "./projection";

/**
 * A path's edges when it is too large, for the view, to be placed in doubles (ADR 0099, "exact edges").
 *
 * Doubles place a point to 2^-53 of its distance from the view's centre, which is fine for what is on screen and useless for the
 * far parts of a shape thousands of levels bigger than the view. Only a window of the shape around the view matters, so:
 *
 *  1. Every segment is taken apart in exact dyadic arithmetic (a line or a curve is halved at t = 1/2, which is exact) until each
 *     piece either lies wholly outside a window G around the view (a piece whose bounding box misses G cannot show, nor change which
 *     points of G are inside) or is small compared with G.
 *  2. Pieces that are small and near G become screen coordinates by an exact difference from the view's centre (so they are accurate to
 *     2^-53 of their distance from the *view*, not from the origin); curves among them are flattened as usual.
 *  3. A run of vertices far outside G is replaced by an arc round the view with the same net angle, from where the run left to where it
 *     came back. The fill's winding number at every point of G depends only on how the outline winds round G, so the fill inside is
 *     exactly what the full outline would give, and no coordinate larger than a few windows is ever handed to the rasterizer.
 *
 * `lines` are the pieces near the view as polylines (for the outline: the stroke only needs what is within its width of the view);
 * `fill` is the closed polygons to fill, with the arcs.
 */
export interface ExactPath {
  readonly lines: readonly FlatPath[];
  readonly fill: readonly FlatPath[];
}

interface Vert {
  readonly near: boolean;
  /** Screen position (valid when near) and the direction from the view's centre. */
  readonly x: number;
  readonly y: number;
  readonly ang: number;
}

type Pt = { x: D.Dyadic; y: D.Dyadic };

const TAU = Math.PI * 2;
const wrap = (a: number): number => a - TAU * Math.round(a / TAU);
const STEP = Math.PI / 6; // arcs are polygons of this many radians a side

/** The direction of an exact offset, without overflow (both parts are scaled by the same power of two first). */
function direction(dx: D.Dyadic, dy: D.Dyadic): number {
  const k = Math.max(D.sign(dx) === 0 ? -Infinity : D.log2Abs(dx), D.sign(dy) === 0 ? -Infinity : D.log2Abs(dy));
  if (!Number.isFinite(k)) return 0;
  const s = -Math.ceil(k);
  return Math.atan2(D.toNumber(D.shift(dy, s)), D.toNumber(D.shift(dx, s)));
}

/** A path with only straight segments (its outline can then be drawn exactly with the stroke code at any width). */
export const isStraight = (o: PathObject): boolean => pathSubs(o).every((s) => [...segmentsOf(s)].every(([i, j]) => isLine(s.n, i, j)));

export function exactPath(o: PathObject, p: Projection, vp: Viewport, marginPx: number): ExactPath {
  const f = p.f;
  const e = p.e;
  const toPx = (d: D.Dyadic): number => D.toNumber(D.shift(d, e)) * f;
  const fromPx = (px: number): D.Dyadic => D.shift(D.fromNumber(px / f), -e);
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const gh = Math.hypot(vp.width, vp.height) / 2 + marginPx + 4096; // half the window, in px
  const box = (k: number) => {
    const h = fromPx(k * gh);
    return { x0: D.sub(p.lx, h), x1: D.add(p.lx, h), y0: D.sub(p.ly, h), y1: D.add(p.ly, h) };
  };
  const G = box(1);
  const N = box(6); // vertices inside this are placed on screen; the rest only by their direction
  const inside = (b: typeof G, q: Pt): boolean => D.cmp(q.x, b.x0) >= 0 && D.cmp(q.x, b.x1) <= 0 && D.cmp(q.y, b.y0) >= 0 && D.cmp(q.y, b.y1) <= 0;
  const screen = (q: Pt): [number, number] => [cx + toPx(D.sub(q.x, p.lx)), cy + toPx(D.sub(q.y, p.ly))];
  const vertex = (q: Pt): Vert => {
    if (inside(N, q)) {
      const [x, y] = screen(q);
      return { near: true, x, y, ang: Math.atan2(y - cy, x - cx) };
    }
    return { near: false, x: 0, y: 0, ang: direction(D.sub(q.x, p.lx), D.sub(q.y, p.ly)) };
  };

  const lines: FlatPath[] = [];
  const fill: FlatPath[] = [];
  const R = 20 * gh;

  const ring = (turns: number): number[] => {
    const n = Math.max(12, Math.ceil((Math.abs(turns) * TAU) / STEP));
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = (turns * TAU * i) / n;
      out.push(cx + R * Math.cos(t), cy + R * Math.sin(t));
    }
    return out;
  };

  const sub = (sp: SubPath): void => {
    const nodes = sp.n;
    const pt = (k: number, m: number): Pt => ({ x: D.fromNumber(nodes[k * NODE + m]!), y: D.fromNumber(nodes[k * NODE + m + 1]!) });
    const verts: Vert[] = [vertex(pt(0, 0))];
    interface Piece {
      p: Pt[]; // four control points (a line: the two ends twice)
      line: boolean;
    }
    for (const [i, j] of segmentsOf(sp)) {
      const line = isLine(nodes, i, j);
      const c = cubicOf(nodes, i, j);
      const q: Pt[] = [0, 1, 2, 3].map((m) => ({ x: D.fromNumber(c[m * 2]!), y: D.fromNumber(c[m * 2 + 1]!) }));
      const stack: Piece[] = [{ p: q, line }];
      while (stack.length) {
        const pc = stack.pop()!;
        let minX = pc.p[0]!.x, maxX = minX, minY = pc.p[0]!.y, maxY = minY;
        for (const r of pc.line ? [pc.p[0]!, pc.p[3]!] : pc.p) {
          if (D.cmp(r.x, minX) < 0) minX = r.x;
          if (D.cmp(r.x, maxX) > 0) maxX = r.x;
          if (D.cmp(r.y, minY) < 0) minY = r.y;
          if (D.cmp(r.y, maxY) > 0) maxY = r.y;
        }
        const end = pc.p[3]!;
        if (D.cmp(maxX, G.x0) < 0 || D.cmp(minX, G.x1) > 0 || D.cmp(maxY, G.y0) < 0 || D.cmp(minY, G.y1) > 0) {
          verts.push(vertex(end)); // wholly outside the window: only where it ends matters
          continue;
        }
        if (Math.max(toPx(D.sub(maxX, minX)), toPx(D.sub(maxY, minY))) <= 4 * gh) {
          if (pc.line) {
            verts.push(vertex(end));
          } else {
            const [a, b, c2, d] = pc.p.map(screen) as [number, number][];
            const out: number[] = [];
            cubicPoints(out, a![0], a![1], b![0], b![1], c2![0], c2![1], d![0], d![1], FLAT_TOLERANCE_PX);
            for (let k = 0; k < out.length; k += 2) verts.push({ near: true, x: out[k]!, y: out[k + 1]!, ang: Math.atan2(out[k + 1]! - cy, out[k]! - cx) });
          }
          continue;
        }
        // Too big to place: halve it (exactly) and look at each half, the first first.
        const mid = (a: Pt, b: Pt): Pt => ({ x: D.shift(D.add(a.x, b.x), -1), y: D.shift(D.add(a.y, b.y), -1) });
        const [p0, p1, p2, p3] = pc.p as [Pt, Pt, Pt, Pt];
        if (pc.line) {
          const m = mid(p0, p3);
          stack.push({ p: [m, m, p3, p3], line: true }, { p: [p0, p0, m, m], line: true });
        } else {
          const ab = mid(p0, p1), bc = mid(p1, p2), cd = mid(p2, p3);
          const abc = mid(ab, bc), bcd = mid(bc, cd);
          const m = mid(abc, bcd);
          stack.push({ p: [m, bcd, cd, p3], line: false }, { p: [p0, ab, abc, m], line: false });
        }
      }
    }
    // A closed outline ends where it began.
    if (sp.closed && verts.length > 1) verts.pop();

    const near = verts.filter((v) => v.near).length;
    // ---- the fill: the outline closed, its far runs replaced by arcs round the view
    if (near === 0) {
      let total = 0;
      for (let i = 0; i < verts.length; i++) total += wrap(verts[(i + 1) % verts.length]!.ang - verts[i]!.ang);
      const w = Math.round(total / TAU);
      if (w !== 0) fill.push({ pts: Float64Array.from(ring(w)), closed: true });
    } else {
      const k = verts.findIndex((v) => v.near);
      const seq = [...verts.slice(k), ...verts.slice(0, k)];
      const out: number[] = [];
      for (let i = 0; i < seq.length; ) {
        const v = seq[i]!;
        if (v.near) {
          out.push(v.x, v.y);
          i++;
          continue;
        }
        let j = i;
        while (j < seq.length && !seq[j]!.near) j++;
        const a = seq[i - 1]!;
        const b = j < seq.length ? seq[j]! : seq[0]!;
        const thA = Math.atan2(a.y - cy, a.x - cx);
        let delta = 0;
        let prev = thA;
        for (let m = i; m < j; m++) {
          delta += wrap(seq[m]!.ang - prev);
          prev = seq[m]!.ang;
        }
        delta += wrap(Math.atan2(b.y - cy, b.x - cx) - prev);
        const n = Math.max(1, Math.ceil(Math.abs(delta) / STEP));
        for (let m = 0; m <= n; m++) {
          const t = thA + (delta * m) / n;
          out.push(cx + R * Math.cos(t), cy + R * Math.sin(t));
        }
        i = j;
      }
      fill.push({ pts: Float64Array.from(out), closed: true });
    }

    // ---- the outline: what is near, as polylines broken where the outline goes far away
    if (near === 0) return;
    const runs: number[][] = [];
    let cur: number[] = [];
    for (const v of verts) {
      if (v.near) cur.push(v.x, v.y);
      else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
    if (sp.closed && verts.every((v) => v.near)) {
      lines.push({ pts: Float64Array.from(runs[0]!), closed: true });
      return;
    }
    // A closed outline whose first and last runs touch is one run.
    if (sp.closed && verts[0]!.near && verts[verts.length - 1]!.near && runs.length > 1) {
      const last = runs.pop()!;
      runs[0] = [...last, ...runs[0]!];
    }
    for (const r of runs) lines.push({ pts: Float64Array.from(r), closed: false });
  };

  for (const sp of pathSubs(o)) if (nodeCount(sp) > 0) sub(sp);
  return { lines, fill };
}

/** The straight sub-paths of a path as strokes (a closed one returns to its first point), to draw their outline exactly at any width. */
export function outlineStrokes(o: PathObject): StrokeObject[] {
  return pathSubs(o).flatMap((s) => {
    const pts: number[] = [];
    for (let k = 0; k < nodeCount(s); k++) pts.push(s.n[k * NODE]!, s.n[k * NODE + 1]!);
    if (s.closed) pts.push(s.n[0]!, s.n[1]!);
    return pts.length >= 2
      ? [{ id: o.id, kind: "stroke" as const, anchor: o.anchor, unit: o.unit, z: o.z, opacity: o.opacity, attachmentTargetId: null, points: pts, width: o.width, color: o.stroke ?? "#000000" }]
      : [];
  });
}
