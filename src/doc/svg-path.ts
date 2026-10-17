/**
 * SVG path data (the `d` of a `<path>`) as sub-paths of nodes with Bézier handles (ADR 0107). Every command is understood: lines, horizontal
 * and vertical lines, cubic and quadratic curves (and their smooth forms), arcs (turned into cubics, at most a quarter turn each) and close.
 * Pure: no document, no DOM, so it is unit-tested apart.
 */
import { NODE } from "./path";
import type { SubPath } from "./path";

/** One piece of a sub-path: from the point before it to `p`, by a cubic with handles `c1` and `c2` (a line has them on its ends). */
type Seg = readonly [c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number];

const TOKEN = /([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** The cubics (at most a quarter turn each) that make an SVG elliptical arc from (x1, y1) to (x2, y2). */
export function arcToCubics(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): Seg[] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (rotDeg * Math.PI) / 180;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  else if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Seg[] = [];
  const at = (t: number): [number, number, number, number] => {
    const c = Math.cos(t), s = Math.sin(t);
    return [cx + rx * c * cp - ry * s * sp, cy + rx * c * sp + ry * s * cp, -rx * s * cp - ry * c * sp, -rx * s * sp + ry * c * cp];
  };
  for (let i = 0; i < n; i++) {
    const [ax, ay, adx, ady] = at(th1 + i * step);
    const [bx, by, bdx, bdy] = at(th1 + (i + 1) * step);
    out.push([ax + k * adx, ay + k * ady, bx - k * bdx, by - k * bdy, i === n - 1 ? x2 : bx, i === n - 1 ? y2 : by]);
  }
  return out;
}

interface Run {
  start: [number, number];
  segs: Seg[];
  closed: boolean;
}

/** The sub-paths of path data; an empty list when it is not path data. A malformed tail is dropped, as browsers do. */
export function parsePathData(d: string): SubPath[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let prevCubic: [number, number] | null = null; // the last cubic's second handle (for S)
  let prevQuad: [number, number] | null = null; // the last quadratic's handle (for T)
  const toks: Array<string | number> = [];
  for (const m of d.matchAll(TOKEN)) toks.push(m[1] ?? Number(m[2]));
  let i = 0;
  let cmd = "";
  const begin = (px: number, py: number): void => {
    cur = { start: [px, py], segs: [], closed: false };
    runs.push(cur);
  };
  const line = (px: number, py: number): void => {
    if (!cur) begin(x, y);
    cur!.segs.push([x, y, px, py, px, py]);
    x = px;
    y = py;
  };
  const cubic = (a: number, b: number, c: number, e: number, px: number, py: number): void => {
    if (!cur) begin(x, y);
    cur!.segs.push([a, b, c, e, px, py]);
    prevCubic = [c, e];
    x = px;
    y = py;
  };
  while (i < toks.length) {
    if (typeof toks[i] === "string") {
      cmd = toks[i++] as string;
      if (!(cmd.toLowerCase() in ARGS)) break;
    } else if (!cmd) break;
    const lower = cmd.toLowerCase();
    const rel = cmd === lower; // (lower case: relative to the current point)
    const need = ARGS[lower]!;
    if (lower === "z") {
      if (cur) {
        (cur as Run).closed = true;
        x = sx;
        y = sy;
        cur = null; // a command after Z starts a new sub-path at the start point
      }
      prevCubic = prevQuad = null;
      continue;
    }
    const a: number[] = [];
    while (a.length < need && typeof toks[i] === "number") a.push(toks[i++] as number);
    if (a.length < need) break;
    const ox = rel ? x : 0, oy = rel ? y : 0;
    const wasCubic = prevCubic as [number, number] | null, wasQuad = prevQuad as [number, number] | null;
    prevCubic = prevQuad = null;
    switch (lower) {
      case "m":
        x = a[0]! + ox;
        y = a[1]! + oy;
        sx = x;
        sy = y;
        begin(x, y);
        cmd = rel ? "l" : "L"; // further pairs are lines
        break;
      case "l":
        line(a[0]! + ox, a[1]! + oy);
        break;
      case "h":
        line(a[0]! + ox, y);
        break;
      case "v":
        line(x, a[0]! + oy);
        break;
      case "c":
        cubic(a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy, a[4]! + ox, a[5]! + oy);
        break;
      case "s": {
        const r = wasCubic ? [2 * x - wasCubic[0], 2 * y - wasCubic[1]] : [x, y];
        cubic(r[0]!, r[1]!, a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy);
        break;
      }
      case "q": {
        const qx = a[0]! + ox, qy = a[1]! + oy, px = a[2]! + ox, py = a[3]! + oy;
        cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py);
        prevQuad = [qx, qy];
        break;
      }
      case "t": {
        const q = wasQuad ? [2 * x - wasQuad[0], 2 * y - wasQuad[1]] : [x, y];
        const px = a[0]! + ox, py = a[1]! + oy;
        cubic(x + (2 / 3) * (q[0]! - x), y + (2 / 3) * (q[1]! - y), px + (2 / 3) * (q[0]! - px), py + (2 / 3) * (q[1]! - py), px, py);
        prevQuad = [q[0]!, q[1]!];
        break;
      }
      case "a": {
        const px = a[5]! + ox, py = a[6]! + oy;
        if (!cur) begin(x, y);
        const segs = arcToCubics(x, y, a[0]!, a[1]!, a[2]!, a[3]! !== 0, a[4]! !== 0, px, py);
        if (!segs.length) break;
        for (const s of segs) cur!.segs.push(s);
        x = px;
        y = py;
        break;
      }
    }
  }
  const subs: SubPath[] = [];
  for (const r of runs) {
    if (!r.segs.length) continue;
    const n: number[] = [];
    const [px, py] = r.start;
    n.push(px, py, px, py, r.segs[0]![0], r.segs[0]![1]);
    r.segs.forEach((s, k) => {
      const next = r.segs[k + 1];
      n.push(s[4], s[5], s[2], s[3], next ? next[0] : s[4], next ? next[1] : s[5]);
    });
    // A closed path that ends where it began is closed by its first node: the last node's incoming handle moves there.
    const last = r.segs.length * NODE;
    if (r.closed && n[last] === n[0] && n[last + 1] === n[1]) {
      n[2] = n[last + 2]!;
      n[3] = n[last + 3]!;
      n.length = last;
    }
    if (n.length >= NODE) subs.push({ n, closed: r.closed });
  }
  return subs;
}
