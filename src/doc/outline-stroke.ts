/**
 * Outline stroke and width profiles (ADR 0143): the stroke of a path made into a shape of its own. The geometry is `stroker.ts`; this
 * reads a path's own join, ends, dashes and arrow heads and returns the shapes (closed polygons, to be filled with the non-zero rule).
 */
import type { PathObject } from "./model";
import { pathSubs } from "./model";
import type { Arrow, SubPath } from "./path";
import { ARROW_LEN, NODE, corner, miterLimitOf, nodeCount } from "./path";
import { booleanOp } from "./boolean";
import { alignOf } from "./model";
import { WIDTH_PROFILES, strokeToSubs } from "./stroker";
import type { WidthProfile } from "./stroker";

/** Which way a path leaves (or arrives at) its end: a unit vector out of the line, from the nearest handle or neighbour that is not the end itself. */
function outward(s: SubPath, atStart: boolean): [number, number] {
  const c = nodeCount(s);
  const i = atStart ? 0 : c - 1;
  const j = atStart ? 1 : c - 2;
  const x = s.n[i * NODE]!, y = s.n[i * NODE + 1]!;
  for (const [px, py] of [[s.n[i * NODE + (atStart ? 4 : 2)]!, s.n[i * NODE + (atStart ? 5 : 3)]!], [s.n[j * NODE + (atStart ? 2 : 4)]!, s.n[j * NODE + (atStart ? 3 : 5)]!], [s.n[j * NODE]!, s.n[j * NODE + 1]!]] as const) {
    const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
    if (d > 1e-12) return [dx / d, dy / d];
  }
  return [1, 0];
}

/** An arrow head at the end of a line, as polygons (a triangle, two strokes for an open head, a dot). */
export function arrowSubs(kind: Arrow, x: number, y: number, ux: number, uy: number, width: number): SubPath[] {
  const L = ARROW_LEN * width;
  const wx = -uy * L * 0.5, wy = ux * L * 0.5;
  const bx = x - ux * L, by = y - uy * L;
  const poly = (pts: Array<[number, number]>): SubPath => {
    let a = 0;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      a += p[0] * q[1] - q[0] * p[1];
    });
    return { n: (a < 0 ? [...pts].reverse() : pts).flatMap(([px, py]) => corner(px, py)), closed: true };
  };
  if (kind === "triangle") return [poly([[bx + wx, by + wy], [x, y], [bx - wx, by - wy]])];
  if (kind === "dot") {
    const r = L * 0.4;
    return [poly(Array.from({ length: 24 }, (_, i): [number, number] => [x + r * Math.cos((2 * Math.PI * i) / 24), y + r * Math.sin((2 * Math.PI * i) / 24)]))];
  }
  // open: two strokes of the line's width from the tip back to each wing
  const h = width / 2;
  const stroke = (px: number, py: number): SubPath => {
    const dx = px - x, dy = py - y, l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * h, ny = (dx / l) * h;
    return poly([[x + nx, y + ny], [px + nx, py + ny], [px - nx, py - ny], [x - nx, y - ny]]);
  };
  return [stroke(bx + wx, by + wy), stroke(bx - wx, by - wy)];
}

/** The shapes of a path's stroke: its width, corners, ends, dashes and arrow heads, with a width profile when one is given. */
export function outlineOf(o: PathObject, profile?: WidthProfile): SubPath[] {
  const subs = o.sub.filter((s) => nodeCount(s) >= 1);
  const dotted = o.dash !== undefined && o.dash[0] === 0;
  const out = strokeToSubs(subs, {
    width: o.width,
    join: o.join === "miter" ? "miter" : o.join === "bevel" ? "bevel" : "round",
    cap: dotted ? "round" : o.cap === "square" ? "square" : o.cap === "butt" ? "butt" : "round",
    miterLimit: miterLimitOf(o.miterAngle),
    profile: profile ? WIDTH_PROFILES[profile] : undefined,
    dash: o.dash,
    dashOffset: o.dashOffset,
  });
  for (const s of subs) {
    if (s.closed || nodeCount(s) < 2) continue;
    if (o.arrowStart) {
      const [ux, uy] = outward(s, true);
      out.push(...arrowSubs(o.arrowStart, s.n[0]!, s.n[1]!, ux, uy, o.width));
    }
    if (o.arrowEnd) {
      const c = nodeCount(s);
      const [ux, uy] = outward(s, false);
      out.push(...arrowSubs(o.arrowEnd, s.n[(c - 1) * NODE]!, s.n[(c - 1) * NODE + 1]!, ux, uy, o.width));
    }
  }
  return out;
}

/**
 * The outline of a closed path that sits inside or outside its edge (`align`), as a shape: the centred outline of twice the width, kept
 * where the shape is (inside) or removed from it (outside). A centred path gives `outlineOf`. null when the outlines graze each other in a
 * way the Boolean code cannot settle (the caller then makes the centred one).
 */
export function alignedOutlineOf(o: PathObject, profile?: WidthProfile): SubPath[] | null {
  const align = alignOf(o);
  if (!align) return outlineOf(o, profile);
  // Piece by piece: each piece of the outline is a simple polygon, which the Boolean code settles where the whole (overlapping, non-zero) cannot.
  const shape = { subs: o.sub, evenodd: o.evenodd === true };
  const out: SubPath[] = [];
  for (const piece of outlineOf({ ...o, width: o.width * 2 }, profile)) {
    const r = booleanOp(align === "inside" ? "intersect" : "subtract", [{ subs: [piece], evenodd: false }, shape]);
    if (!r) return null;
    out.push(...r);
  }
  return out;
}

const liveCache = new WeakMap<PathObject, readonly SubPath[]>();

/** The shape a path with a live width profile (`profile`) is drawn as: its outline, in the path's turned local units. Made once per object. */
export function liveOutline(o: PathObject): readonly SubPath[] {
  let out = liveCache.get(o);
  if (!out) {
    const { rot: _r, base: _b, ...flat } = o;
    out = outlineOf({ ...flat, sub: pathSubs(o) }, o.profile);
    liveCache.set(o, out);
  }
  return out;
}
