import type { PathObject } from "../doc/model";
import { pathSubs } from "../doc/model";
import type { SubPath } from "../doc/path";
import { NODE, isLine, nodeCount, segmentsOf } from "../doc/path";
import type { ProjectedObject } from "../render/projection";
import { exactX, exactY, fromPx } from "../render/projection";
import * as D from "../core/dyadic";

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
