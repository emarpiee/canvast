/**
 * Vector networks (ADR 0146). A network is a path object (`net: true`) whose sub-paths are its *edges*: chains of nodes, each chain from one
 * vertex to another. A vertex is where chains end at exactly the same point, so any number of edges can meet at one, and the regions the
 * edges enclose are filled. The edges are stored as plain sub-paths: every move, stretch, turn and unit change of a path therefore works on a
 * network too, and two ends that were at one point stay at one point (the same map gives the same result). The regions are not stored;
 * they are found from the edges when they are needed (`netFaces`).
 *
 * Edges are taken not to cross except at vertices (`buildNetwork` splits edges where one meets another).
 */
import type { SubPath } from "./path";
import { NODE, corner, cubicOf, cubicPoints, moveNode, nodeCount, splitSegment } from "./path";

const key = (x: number, y: number): string => `${x},${y}`;

const first = (c: SubPath): [number, number] => [c.n[0]!, c.n[1]!];
const last = (c: SubPath): [number, number] => [c.n[c.n.length - NODE]!, c.n[c.n.length - NODE + 1]!];

/** The ends of an edge, as vertex keys. */
export const endsOf = (c: SubPath): [string, string] => [key(...first(c)), key(...last(c))];

// ---- Regions ------------------------------------------------------------------------------------------------------------------------

const faceCache = new WeakMap<readonly SubPath[], SubPath[]>();

/** The direction an edge leaves its first (forward) or last (backward) vertex in: toward its first handle, else the next node. */
function leaving(c: SubPath, forward: boolean): [number, number] {
  const k = nodeCount(c);
  const [i, j] = forward ? [0, 1] : [k - 1, k - 2];
  const p = [c.n[i * NODE]!, c.n[i * NODE + 1]!] as const;
  const cands = forward
    ? [[c.n[i * NODE + 4]!, c.n[i * NODE + 5]!], [c.n[j * NODE + 2]!, c.n[j * NODE + 3]!], [c.n[j * NODE]!, c.n[j * NODE + 1]!]]
    : [[c.n[i * NODE + 2]!, c.n[i * NODE + 3]!], [c.n[j * NODE + 4]!, c.n[j * NODE + 5]!], [c.n[j * NODE]!, c.n[j * NODE + 1]!]];
  for (const c of cands) if (c[0]! !== p[0] || c[1]! !== p[1]) return [c[0]! - p[0], c[1]! - p[1]];
  return [1, 0];
}

/** The nodes of an edge in the direction travelled (backward: reversed, the handles swapped). */
function walked(c: SubPath, forward: boolean): number[][] {
  const out: number[][] = [];
  const k = nodeCount(c);
  for (let i = 0; i < k; i++) {
    const b = (forward ? i : k - 1 - i) * NODE;
    const n = c.n;
    out.push(forward ? [n[b]!, n[b + 1]!, n[b + 2]!, n[b + 3]!, n[b + 4]!, n[b + 5]!] : [n[b]!, n[b + 1]!, n[b + 4]!, n[b + 5]!, n[b + 2]!, n[b + 3]!]);
  }
  return out;
}

/** The signed area of a loop of edges (positive: turning the way the regions inside are walked). Curves are sampled. */
function areaOf(nodes: readonly number[][]): number {
  const pts: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    const b = nodes[(i + 1) % nodes.length]!;
    pts.push(a[0]!, a[1]!);
    if (a[4] !== a[0] || a[5] !== a[1] || b[2] !== b[0] || b[3] !== b[1]) {
      cubicPoints(pts, a[0]!, a[1]!, a[4]!, a[5]!, b[2]!, b[3]!, b[0]!, b[1]!, 1e-3 * (Math.abs(a[0]!) + Math.abs(a[1]!) + 1));
      pts.length -= 2; // (the end is the next node's start)
    }
  }
  let s = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length;
    s += pts[i]! * pts[j + 1]! - pts[j]! * pts[i + 1]!;
  }
  return s / 2;
}

/**
 * The regions the edges enclose, as closed sub-paths (curves kept): the faces of the planar graph of the edges. Every face is walked with its
 * inside on the left; the outer boundary of each connected piece is walked the other way round and is left out. Regions inside regions
 * are separate loops (filled together), as are the regions of separate pieces.
 */
export function netFaces(edges: readonly SubPath[]): SubPath[] {
  const cached = faceCache.get(edges);
  if (cached) return cached;
  const chains = edges.filter((c) => nodeCount(c) >= 2);
  const at = new Map<string, number[]>(); // vertex -> the half-edges that leave it
  const dest: string[] = [];
  const angle: number[] = [];
  chains.forEach((c, i) => {
    for (const forward of [true, false]) {
      const h = 2 * i + (forward ? 0 : 1);
      const [ka, kb] = endsOf(c);
      const from = forward ? ka : kb;
      dest[h] = forward ? kb : ka;
      const [dx, dy] = leaving(c, forward);
      angle[h] = Math.atan2(dy, dx);
      (at.get(from) ?? at.set(from, []).get(from)!).push(h);
    }
  });
  for (const list of at.values()) list.sort((a, b) => angle[a]! - angle[b]!);
  const next = (h: number): number => {
    const list = at.get(dest[h]!)!;
    return list[(list.indexOf(h ^ 1) - 1 + list.length) % list.length]!;
  };
  const seen = new Set<number>();
  const out: SubPath[] = [];
  for (let start = 0; start < chains.length * 2; start++) {
    if (seen.has(start)) continue;
    const cycle: number[] = [];
    for (let h = start; !seen.has(h); h = next(h)) {
      seen.add(h);
      cycle.push(h);
    }
    // the nodes round the loop: the join between two edges is one node (arriving handle of the one, leaving handle of the other)
    const nodes: number[][] = [];
    for (const h of cycle) {
      const w = walked(chains[h >> 1]!, (h & 1) === 0);
      if (nodes.length) {
        const prev = nodes[nodes.length - 1]!;
        prev[4] = w[0]![4]!;
        prev[5] = w[0]![5]!;
        w.shift();
      }
      nodes.push(...w);
    }
    // (the last node is the first again: one node closes the loop)
    if (nodes.length > 1) {
      const a = nodes[0]!, z = nodes[nodes.length - 1]!;
      if (a[0] === z[0] && a[1] === z[1]) {
        a[2] = z[2]!;
        a[3] = z[3]!;
        nodes.pop();
      }
    }
    if (nodes.length >= 2 && areaOf(nodes) > 0) out.push({ n: nodes.flat(), closed: true });
  }
  faceCache.set(edges, out);
  return out;
}

// ---- Building a network from paths ------------------------------------------------------------------------------------------------------

/** The edge from node `i` to node `j` of a sub-path, as its own 2-node chain (only the handles that belong to it). */
function segment(s: SubPath, i: number, j: number): SubPath {
  const a = i * NODE, b = j * NODE;
  const n = s.n;
  return { n: [n[a]!, n[a + 1]!, n[a]!, n[a + 1]!, n[a + 4]!, n[a + 5]!, n[b]!, n[b + 1]!, n[b + 2]!, n[b + 3]!, n[b]!, n[b + 1]!], closed: false };
}

/** The nearest point of an edge to (x, y): its distance, the segment and the position along it. */
function nearest(c: SubPath, x: number, y: number): { d: number; k: number; t: number } {
  let best = { d: Infinity, k: 0, t: 0 };
  for (let k = 0; k + 1 < nodeCount(c); k++) {
    const q = cubicOf(c.n, k, k + 1);
    const steps = 64;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      const px = u * u * u * q[0] + 3 * u * u * t * q[2] + 3 * u * t * t * q[4] + t * t * t * q[6];
      const py = u * u * u * q[1] + 3 * u * u * t * q[3] + 3 * u * t * t * q[5] + t * t * t * q[7];
      const d = Math.hypot(px - x, py - y);
      if (d < best.d) best = { d, k, t };
    }
  }
  return best;
}

/** The edge `c` cut at segment `k`, position `t`, into two edges that meet at the vertex `v` (the new node is moved onto it, handles with it). */
function splitAt(c: SubPath, k: number, t: number, v: readonly [number, number]): [SubPath, SubPath] {
  const cut = splitSegment([c], 0, k, t)[0]!;
  const m = (k + 1) * NODE;
  const n = [...cut.n];
  const dx = v[0] - n[m]!, dy = v[1] - n[m + 1]!;
  for (let q = 0; q < NODE; q += 2) {
    n[m + q] = n[m + q]! + dx;
    n[m + q + 1] = n[m + q + 1]! + dy;
  }
  n[m] = v[0];
  n[m + 1] = v[1];
  return [{ n: n.slice(0, m + NODE), closed: false }, { n: n.slice(m), closed: false }];
}

type Cub = ReturnType<typeof cubicOf>;
const cubicAt = (q: Cub, t: number): [number, number] => {
  const u = 1 - t;
  return [u * u * u * q[0] + 3 * u * u * t * q[2] + 3 * u * t * t * q[4] + t * t * t * q[6], u * u * u * q[1] + 3 * u * u * t * q[3] + 3 * u * t * t * q[5] + t * t * t * q[7]];
};
const cubicSlope = (q: Cub, t: number): [number, number] => {
  const u = 1 - t;
  return [3 * u * u * (q[2] - q[0]) + 6 * u * t * (q[4] - q[2]) + 3 * t * t * (q[6] - q[4]), 3 * u * u * (q[3] - q[1]) + 6 * u * t * (q[5] - q[3]) + 3 * t * t * (q[7] - q[5])];
};

const FLAT = 24;
const EDGE_T = 1e-6;
/** The first place two different edges cross in their insides (not at an end of either, which are vertices already): both positions on the curves. */
function firstCrossing(chains: readonly SubPath[]): { i: number; j: number; a: { k: number; t: number }; b: { k: number; t: number }; x: number; y: number } | null {
  const boxOf = (q: Cub): [number, number, number, number] => [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      for (let ka = 0; ka + 1 < nodeCount(chains[i]!); ka++) {
        const qa = cubicOf(chains[i]!.n, ka, ka + 1), ba = boxOf(qa);
        for (let kb = 0; kb + 1 < nodeCount(chains[j]!); kb++) {
          const qb = cubicOf(chains[j]!.n, kb, kb + 1), bb = boxOf(qb);
          if (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]) continue;
          const pa = Array.from({ length: FLAT + 1 }, (_, p) => cubicAt(qa, p / FLAT));
          const pb = Array.from({ length: FLAT + 1 }, (_, p) => cubicAt(qb, p / FLAT));
          for (let p = 0; p < FLAT; p++) {
            for (let r = 0; r < FLAT; r++) {
              const [x1, y1] = pa[p]!, [x2, y2] = pa[p + 1]!, [x3, y3] = pb[r]!, [x4, y4] = pb[r + 1]!;
              const den = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
              if (Math.abs(den) <= 1e-9 * Math.hypot(x2 - x1, y2 - y1) * Math.hypot(x4 - x3, y4 - y3)) continue; // parallel or lying on each other: no single crossing
              const u = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / den;
              const w = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / den;
              if (u < 0 || u > 1 || w < 0 || w > 1) continue;
              let t = (p + u) / FLAT, s = (r + w) / FLAT;
              for (let it = 0; it < 6; it++) { // Newton on a(t) = b(s)
                const [ax, ay] = cubicAt(qa, t), [bx, by] = cubicAt(qb, s);
                const [da, db] = [cubicSlope(qa, t), cubicSlope(qb, s)];
                const det = -da[0] * db[1] + db[0] * da[1];
                if (Math.abs(det) < 1e-300) break;
                const ex = bx - ax, ey = by - ay;
                t = Math.min(1, Math.max(0, t + (-ex * db[1] + db[0] * ey) / det));
                s = Math.min(1, Math.max(0, s + (da[0] * ey - da[1] * ex) / det));
              }
              if (t < EDGE_T || t > 1 - EDGE_T || s < EDGE_T || s > 1 - EDGE_T) continue;
              const [ax, ay] = cubicAt(qa, t), [bx, by] = cubicAt(qb, s);
              return { i, j, a: { k: ka, t }, b: { k: kb, t: s }, x: (ax + bx) / 2, y: (ay + by) / 2 };
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Edges from paths: closed sub-paths are cut into one edge per segment, open ones are kept as chains. Ends within `tol` of each other
 * become one vertex (the same point), and an end that lies on another edge splits that edge there, so paths that meet become one network.
 */
export function buildNetwork(paths: ReadonlyArray<readonly SubPath[]>, tol: number): SubPath[] {
  let chains: SubPath[] = [];
  for (const subs of paths) {
    for (const s of subs) {
      const k = nodeCount(s);
      if (k < 2) continue;
      if (s.closed) for (let i = 0; i < k; i++) chains.push(segment(s, i, (i + 1) % k));
      else chains.push({ n: [...s.n], closed: false });
    }
  }
  // 1. ends close together are one point
  const reps: Array<[number, number]> = [];
  const snap = (x: number, y: number): [number, number] => {
    for (const r of reps) if (Math.hypot(r[0] - x, r[1] - y) <= tol) return r;
    const r: [number, number] = [x, y];
    reps.push(r);
    return r;
  };
  const moveEnd = (c: SubPath, atStart: boolean): SubPath => {
    const b = atStart ? 0 : c.n.length - NODE;
    const [x, y] = snap(c.n[b]!, c.n[b + 1]!);
    const dx = x - c.n[b]!, dy = y - c.n[b + 1]!;
    if (!dx && !dy) return c;
    const n = [...c.n];
    for (let i = 0; i < NODE; i += 2) {
      n[b + i] = n[b + i]! + dx;
      n[b + i + 1] = n[b + i + 1]! + dy;
    }
    n[b] = x; // (exactly the representative, not the sum)
    n[b + 1] = y;
    return { n, closed: false };
  };
  chains = chains.map((c) => moveEnd(moveEnd(c, true), false));
  // 2. an end on another edge splits it (edges are visited again after a split)
  const vertices = reps;
  for (const v of vertices) {
    for (let i = 0; i < chains.length; i++) {
      const c = chains[i]!;
      const [ka, kb] = endsOf(c);
      if (ka === key(v[0], v[1]) || kb === key(v[0], v[1])) continue;
      const h = nearest(c, v[0], v[1]);
      if (!(h.d <= tol)) continue;
      chains.splice(i, 1, ...splitAt(c, h.k, h.t, v));
    }
  }
  // the same edge twice (two shapes that share a side) is one edge
  const reversed = (c: SubPath): number[] => walked(c, false).flat();
  const kept: SubPath[] = [];
  for (const c of chains) if (!kept.some((k) => k.n.length === c.n.length && (k.n.every((v, i) => v === c.n[i]) || k.n.every((v, i) => v === reversed(c)[i])))) kept.push(c);
  chains = kept;
  // 3. two edges that cross are cut at the crossing, both ends of the cuts at one point (a loop restarts after each cut)
  for (let guard = 0; guard < 10000; guard++) {
    const hit = firstCrossing(chains);
    if (!hit) break;
    const { i, j, a, b, x, y } = hit;
    const ci = chains[i]!, cj = chains[j]!;
    chains.splice(j, 1, ...splitAt(cj, b.k, b.t, [x, y]));
    chains.splice(i, 1, ...splitAt(ci, a.k, a.t, [x, y]));
  }
  return chains.filter((c) => nodeCount(c) >= 2 && !(nodeCount(c) === 2 && first(c)[0] === last(c)[0] && first(c)[1] === last(c)[1]));
}

// ---- Editing a network --------------------------------------------------------------------------------------------------------------------

/** Move the vertex at (x, y), with the ends of every edge that meets there and their handles (a handle keeps its place relative to its end). */
export function moveVertex(edges: readonly SubPath[], x: number, y: number, dx: number, dy: number): SubPath[] {
  return edges.map((c) => {
    const k = nodeCount(c);
    let n: number[] | null = null;
    for (const i of [0, k - 1]) {
      const b = i * NODE;
      if (c.n[b] !== x || c.n[b + 1] !== y) continue;
      n ??= [...c.n];
      for (let q = 0; q < NODE; q += 2) {
        n[b + q] = n[b + q]! + dx;
        n[b + q + 1] = n[b + q + 1]! + dy;
      }
    }
    return n ? { n, closed: false } : c;
  });
}

/** Take the vertex at (x, y) away with every edge that meets it. */
export const deleteVertex = (edges: readonly SubPath[], x: number, y: number): SubPath[] => edges.filter((c) => !endsOf(c).includes(key(x, y)));

/** An edge between two vertices (a straight line). */
export const edgeBetween = (a: readonly [number, number], b: readonly [number, number]): SubPath => ({ n: [...corner(a[0], a[1]), ...corner(b[0], b[1])], closed: false });

/** The vertices of a network and how many edges meet at each. */
export function verticesOf(edges: readonly SubPath[]): Array<{ x: number; y: number; degree: number }> {
  const m = new Map<string, { x: number; y: number; degree: number }>();
  for (const c of edges) {
    for (const [x, y] of [first(c), last(c)]) {
      const v = m.get(key(x, y)) ?? { x, y, degree: 0 };
      v.degree++;
      m.set(key(x, y), v);
    }
  }
  return [...m.values()];
}

/** The nodes `picks` ([sub-path, node]) of a network moved: an end of an edge moves its whole vertex (once, however many of its ends are picked), a node inside an edge moves alone. */
export function moveNodes(edges: readonly SubPath[], picks: ReadonlyArray<readonly [number, number]>, dx: number, dy: number): SubPath[] {
  let out: SubPath[] = [...edges];
  const done = new Set<string>();
  for (const [s, k] of picks) {
    const c = edges[s];
    if (!c) continue;
    if (k !== 0 && k !== nodeCount(c) - 1) {
      out = moveNode(out, s, k, dx, dy);
      continue;
    }
    const x = c.n[k * NODE]!, y = c.n[k * NODE + 1]!;
    if (done.has(key(x, y))) continue;
    done.add(key(x, y));
    out = moveVertex(out, x, y, dx, dy);
  }
  return out;
}
