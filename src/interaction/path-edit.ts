import type { PathObject } from "../doc/model";
import { editSubs } from "../doc/model";
import type { SubPath } from "../doc/path";
import { NODE, isLine, nodeCount, segmentsOf } from "../doc/path";
import { cornerAt, maxFor, maxUniform } from "../doc/rounding";
import type { ProjectedObject } from "../render/projection";
import { exactX, exactY, fromPx } from "../render/projection";
import * as D from "../core/dyadic";
import type { Gradient } from "../doc/paint";
import { isGradient } from "../doc/paint";
import { localGradient, localToBox } from "../render/gradient";

/**
 * Editing a path's nodes on screen (ADR 0099): where each node and handle is, and what a press at a point on the screen takes. Works
 * on the projected object, so what can be grabbed is what is drawn. A turned path is edited as it looks (its nodes are the turned
 * ones); the Edit nodes tool bakes the turn into the geometry before it changes anything.
 */
export interface NodeScreen {
  /** Sub-path and node index. */
  s: number;
  k: number;
  p: readonly [number, number];
  /** The handles, as points on screen (equal to `p` when the node has none on that side). */
  i: readonly [number, number];
  o: readonly [number, number];
  hasIn: boolean;
  hasOut: boolean;
}

/** Every node of the object's drawn sub-paths on screen. */
export function nodesOnScreen(po: ProjectedObject): NodeScreen[] {
  const o = po.obj as PathObject;
  const p = po.proj;
  const at = (x: number, y: number): [number, number] => [exactX(p, x), exactY(p, y)];
  const out: NodeScreen[] = [];
  editSubs(o).forEach((sp, s) => {
    for (let k = 0; k < nodeCount(sp); k++) {
      const n = sp.n;
      const b = k * NODE;
      out.push({
        s,
        k,
        p: at(n[b]!, n[b + 1]!),
        i: at(n[b + 2]!, n[b + 3]!),
        o: at(n[b + 4]!, n[b + 5]!),
        hasIn: n[b + 2] !== n[b] || n[b + 3] !== n[b + 1],
        hasOut: n[b + 4] !== n[b] || n[b + 5] !== n[b + 1],
      });
    }
  });
  return out;
}

export type NodeHit =
  | { kind: "point" | "in" | "out"; s: number; k: number }
  | { kind: "seg"; s: number; k: number; t: number };

/** Pixels a press may be from a node or handle, and from a segment, to take it. */
export const NODE_REACH_PX = 8;
const SEG_REACH_PX = 6;
const SAMPLES = 32;

/**
 * What a press at (x, y) takes: first a handle of the selected node, then a node, then a segment of the outline (to add a node on).
 * `sel` is the selected node, whose handles are shown and can be grabbed.
 */
export function hitNodes(po: ProjectedObject, x: number, y: number, sel: { s: number; k: number } | null): NodeHit | null {
  const nodes = nodesOnScreen(po);
  const near = (q: readonly [number, number]): number => Math.hypot(q[0] - x, q[1] - y);
  if (sel) {
    const n = nodes.find((m) => m.s === sel.s && m.k === sel.k);
    if (n) {
      if (n.hasIn && near(n.i) <= NODE_REACH_PX) return { kind: "in", s: n.s, k: n.k };
      if (n.hasOut && near(n.o) <= NODE_REACH_PX) return { kind: "out", s: n.s, k: n.k };
    }
  }
  let best: NodeScreen | null = null;
  for (const n of nodes) if (near(n.p) <= NODE_REACH_PX && (!best || near(n.p) < near(best.p))) best = n;
  if (best) return { kind: "point", s: best.s, k: best.k };
  // The nearest point of any segment, found on a sampled copy of it.
  const byKey = new Map(nodes.map((n) => [`${n.s}:${n.k}`, n] as const));
  let hit: NodeHit | null = null;
  let bestD = SEG_REACH_PX;
  editSubs(po.obj as PathObject).forEach((sp: SubPath, s) => {
    for (const [a, b] of segmentsOf(sp)) {
      const na = byKey.get(`${s}:${a}`)!;
      const nb = byKey.get(`${s}:${b}`)!;
      const line = isLine(sp.n, a, b);
      const c = [na.p[0], na.p[1], na.o[0], na.o[1], nb.i[0], nb.i[1], nb.p[0], nb.p[1]] as const;
      let px = c[0];
      let py = c[1];
      const steps = line ? 1 : SAMPLES;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const qx = u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6];
        const qy = u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7];
        const dx = qx - px;
        const dy = qy - py;
        const l2 = dx * dx + dy * dy;
        const f = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy) / l2));
        const d = Math.hypot(x - (px + f * dx), y - (py + f * dy));
        if (d < bestD) {
          bestD = d;
          const t0 = (i - 1) / steps;
          hit = { kind: "seg", s, k: a, t: t0 + f * (t - t0) };
        }
        px = qx;
        py = qy;
      }
    }
  });
  return hit;
}

/** A screen position as local units of the object (exact placement, then one rounding). */
export function localOf(po: ProjectedObject, x: number, y: number): { x: number; y: number } {
  const p = po.proj;
  return { x: D.toNumber(D.add(p.lx, fromPx(p, x - p.cx))), y: D.toNumber(D.add(p.ly, fromPx(p, y - p.cy))) };
}

/** Whether node `k` is smooth: its two handles run opposite each other (so moving one moves the other). */
export function isSmoothNode(sp: SubPath, k: number): boolean {
  const n = sp.n;
  const b = k * NODE;
  const ix = n[b + 2]! - n[b]!;
  const iy = n[b + 3]! - n[b + 1]!;
  const ox = n[b + 4]! - n[b]!;
  const oy = n[b + 5]! - n[b + 1]!;
  if ((!ix && !iy) || (!ox && !oy)) return false;
  const cross = ix * oy - iy * ox;
  return Math.abs(cross) <= 1e-9 * Math.hypot(ix, iy) * Math.hypot(ox, oy) && ix * ox + iy * oy < 0;
}

// ---- Gradient handles (ADR 0100) ----------------------------------------------------------------------------------------------------

export type GradHandle = "p0" | "p1" | "c" | "r";

export interface GradientHandles {
  /** Which paint of the object the gradient is (the fill's when both are gradients). */
  readonly which: "fill" | "stroke";
  readonly g: Gradient;
  /** The handles on screen: a linear gradient's two ends; a radial one's centre and its radius handle. */
  readonly pts: ReadonlyArray<{ id: GradHandle; x: number; y: number }>;
  /** A radial gradient's outer ring, in px. */
  readonly ring?: { x: number; y: number; r: number };
  /** The stops along a linear gradient's axis (for drawing). */
  readonly stops: ReadonlyArray<{ x: number; y: number; c: string }>;
}

const FAR = 1e5;

/** The handles of the gradient of a path, where they are on screen (null: no gradient, or too far out of view to hold). */
export function gradientHandles(po: ProjectedObject, focus: "fill" | "stroke" | null = null): GradientHandles | null {
  const o = po.obj as PathObject;
  if (po.cover) return null;
  const which = focus && isGradient(o[focus]) ? focus : isGradient(o.fill) ? "fill" : isGradient(o.stroke) ? "stroke" : null;
  if (!which) return null;
  const g = o[which] as Gradient;
  const p = po.proj;
  const at = (x: number, y: number): [number, number] => [exactX(p, x), exactY(p, y)];
  const l = localGradient(o, g);
  let out: GradientHandles;
  if (l.type === "linear") {
    const [x0, y0] = at(l.x0, l.y0);
    const [x1, y1] = at(l.x1, l.y1);
    out = {
      which,
      g,
      pts: [{ id: "p0", x: x0, y: y0 }, { id: "p1", x: x1, y: y1 }],
      stops: g.stops.map((s) => ({ x: x0 + (x1 - x0) * s.o, y: y0 + (y1 - y0) * s.o, c: s.c })),
    };
  } else {
    const [cx, cy] = at(l.cx, l.cy);
    const [rx] = at(l.cx + l.R, l.cy);
    out = { which, g, pts: [{ id: "c", x: cx, y: cy }, { id: "r", x: rx, y: cy }], ring: { x: cx, y: cy, r: Math.abs(rx - cx) }, stops: [] };
  }
  return out.pts.every((q) => Math.abs(q.x) < FAR && Math.abs(q.y) < FAR) ? out : null;
}

/** Which handle a press at (x, y) takes, if any. */
export function hitGradient(h: GradientHandles, x: number, y: number): GradHandle | null {
  let best: GradHandle | null = null;
  let bestD = NODE_REACH_PX;
  for (const q of h.pts) {
    const d = Math.hypot(q.x - x, q.y - y);
    if (d <= bestD) {
      best = q.id;
      bestD = d;
    }
  }
  return best;
}

/** The gradient with one handle moved to the local point (x, y) of the object. */
export function moveGradientHandle(o: PathObject, g: Gradient, handle: GradHandle, x: number, y: number): Gradient {
  const [u, v] = localToBox(o, x, y);
  if (g.type === "linear") return handle === "p0" ? { ...g, x0: u, y0: v } : { ...g, x1: u, y1: v };
  if (handle === "c") return { ...g, cx: u, cy: v };
  // the radius handle: the distance from the centre, in units of the box's longer side
  const l = localGradient(o, g);
  const side = l.type === "radial" && g.r > 0 ? l.R / g.r : 1;
  return { ...g, r: Math.max(0.005, Math.hypot(x - (l.type === "radial" ? l.cx : 0), y - (l.type === "radial" ? l.cy : 0)) / side) };
}


/**
 * The handles that change a shape's numbers on the canvas (ADR 0105). The *main* dot sets one corner radius for every corner: inside the
 * first corner, and when the corners have been opened out (`expanded`) in the middle of the shape. Each *corner* dot sets the radius of its own
 * corner, at the middle of that corner's arc. A star also has a ratio handle on its first inner corner. Positions are on screen (a turned
 * shape's are the turned ones), measured on the sharp base, so a radius pushed past what a corner can use does not move its dot out of reach.
 */
export interface CornerDot {
  /** The node's place among all the nodes of the sharp outline (what an array radius is indexed by). */
  index: number;
  x: number;
  y: number;
  /** The corner on screen, the unit vector towards where its arc's middle is, the sine of half its angle, and the radius it has now in px (never above what it can use). */
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  sinHalf: number;
  px: number;
  /** The most px radius this corner can use with the others as they are, and the most every corner can have at once. */
  max: number;
  maxAll: number;
}
export interface CornerHandles {
  main: CornerDot | null;
  /** Every corner (only for a path whose corners can each have their own: not the result of a boolean group). */
  corners: CornerDot[];
  /** Where the main dot is when the corners are opened out: the middle of the shape. */
  centre: { x: number; y: number } | null;
  ratio: { x: number; y: number; cx: number; cy: number; outer: number } | null;
}

const MIN_DOT_PX = 18;
const MAX_CORNER_DOTS = 64;

export function cornerHandles(po: ProjectedObject, expanded = false): CornerHandles | null {
  const o = po.obj as PathObject;
  if (po.cover || o.kind !== "path") return null;
  const subs = editSubs(o);
  const p = po.proj;
  const dots: CornerDot[] = [];
  const screenSubs: SubPath[] = [];
  let sx = 0, sy = 0, sn = 0;
  for (const sub of subs) {
    // the sub-path on screen, to measure the corners in px
    const n: number[] = [];
    for (let k = 0; k < nodeCount(sub); k++) {
      const b = k * NODE;
      for (let h = 0; h < 6; h += 2) n.push(exactX(p, sub.n[b + h]!), exactY(p, sub.n[b + h + 1]!));
      sx += n[k * NODE]!;
      sy += n[k * NODE + 1]!;
      sn++;
    }
    screenSubs.push({ n, closed: sub.closed });
  }
  // the radius every corner has now, in px (a number for all, or each its own)
  const total = screenSubs.reduce((a, s) => a + nodeCount(s), 0);
  const radiiPx = Array.from({ length: total }, (_, i) => (typeof o.radius === "number" ? o.radius : o.radius ? (o.radius[i] ?? 0) : 0) * p.ppu);
  let index = 0;
  for (const screen of screenSubs) {
    for (let k = 0; k < nodeCount(screen); k++, index++) {
      if (dots.length >= MAX_CORNER_DOTS) continue;
      const corner = cornerAt(screen, k);
      if (!corner) continue;
      let ux = corner.e1[0] + corner.e2[0], uy = corner.e1[1] + corner.e2[1];
      const ul = Math.hypot(ux, uy);
      if (ul < 1e-6) continue;
      ux /= ul;
      uy /= ul;
      const sinHalf = Math.sin(corner.theta / 2);
      // what this corner can use: with the others as they are for its own dot, what they can all have together for the main dot
      const max = maxFor(screenSubs, radiiPx, index);
      const px = Math.min(radiiPx[index]!, max);
      const d = Math.max(MIN_DOT_PX, px / sinHalf);
      dots.push({ index, x: corner.x + ux * d, y: corner.y + uy * d, cx: corner.x, cy: corner.y, ux, uy, sinHalf, px, max, maxAll: maxUniform(screenSubs) });
    }
  }
  let ratio: CornerHandles["ratio"] = null;
  const sub = subs[0];
  if (o.shape === "star" && o.params && sub && nodeCount(sub) >= 6 && nodeCount(sub) % 2 === 0) {
    const c = nodeCount(sub);
    const at = (k: number): [number, number] => [exactX(p, sub.n[k * NODE]!), exactY(p, sub.n[k * NODE + 1]!)];
    let mx = 0, my = 0;
    for (let k = 0; k < c; k += 2) {
      const [x, y] = at(k);
      mx += x;
      my += y;
    }
    mx /= c / 2;
    my /= c / 2;
    const [ox, oy] = at(0);
    const [ix, iy] = at(1);
    ratio = { x: ix, y: iy, cx: mx, cy: my, outer: Math.hypot(ox - mx, oy - my) };
  }
  const first = dots[0] ?? null;
  if (!first && !ratio) return null;
  const centre = sn ? { x: sx / sn, y: sy / sn } : null;
  const main = first && expanded && centre ? { ...first, x: centre.x, y: centre.y } : first;
  const out: CornerHandles = { main, corners: o.result !== undefined ? [] : dots, centre, ratio };
  return !main || (Math.abs(main.x) < FAR && Math.abs(main.y) < FAR) ? out : null;
}

export type CornerPick = { what: "main" } | { what: "corner"; dot: CornerDot } | { what: "ratio" };

/** Which handle a press takes: a corner's own dot (when opened out), the ratio handle, or the main dot. */
export function hitCornerHandle(h: CornerHandles, x: number, y: number, expanded: boolean): CornerPick | null {
  const near = (q: { x: number; y: number } | null): number => (q ? Math.hypot(q.x - x, q.y - y) : Infinity);
  let best: CornerPick | null = null;
  let bestD = NODE_REACH_PX;
  const consider = (pick: CornerPick, d: number): void => {
    if (d <= bestD) {
      best = pick;
      bestD = d;
    }
  };
  if (h.main) consider({ what: "main" }, near(h.main) - 2); // the main one wins a tie: it is the bigger
  if (expanded) for (const dot of h.corners) consider({ what: "corner", dot }, near(dot));
  if (h.ratio) consider({ what: "ratio" }, near(h.ratio));
  return best;
}
