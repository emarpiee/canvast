import type { PathObject } from "../doc/model";
import { pathSubs } from "../doc/model";
import type { SubPath } from "../doc/path";
import { NODE, isLine, nodeCount, segmentsOf } from "../doc/path";
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
  pathSubs(o).forEach((sp, s) => {
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
  pathSubs(po.obj as PathObject).forEach((sp: SubPath, s) => {
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
