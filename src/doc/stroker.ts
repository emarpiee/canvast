/**
 * The outline of a stroke as shapes (Outline stroke, ADR 0143): pure functions over plain numbers. A stroked path is cut into the
 * pieces it is made of, each a closed polygon turned the same way: one trapezoid per straight piece of the flattened centre line, a
 * wedge or a round fan at each corner for the join, and a cap at each open end. Filled with the non-zero rule the pieces are the stroke
 * (where they overlap they add up to nothing but the same area), so nothing has to be united and no tolerance can fail: the result is
 * correct for any path, with any join, cap, dash or width profile. The width may change along the line (a profile of its length).
 */
import type { SubPath } from "./path";
import { NODE, corner, cubicOf, cubicPoints, nodeCount } from "./path";

export type StrokeJoin = "round" | "miter" | "bevel";
export type StrokeCap = "round" | "butt" | "square";

export interface StrokeOptions {
  /** Full width of the line, in the units of the path. */
  readonly width: number;
  readonly join: StrokeJoin;
  readonly cap: StrokeCap;
  /** The longest miter point as a multiple of the half width before a corner is bevelled. */
  readonly miterLimit: number;
  /** A multiple of the width at a fraction `u` (0 to 1) of the length of each sub-path; absent: 1 everywhere. */
  readonly profile?: ((u: number) => number) | undefined;
  /** Dash and gap in widths; a dash of 0 is a dot (it needs a round cap to show). */
  readonly dash?: readonly [number, number] | undefined;
  /** Where in the pattern the line starts, in widths. */
  readonly dashOffset?: number | undefined;
}

/** The width profiles Outline options offers, as multiples of the width along a fraction of the length. */
export const WIDTH_PROFILES = {
  /** Thin at both ends, full in the middle. */
  taper: (u: number): number => Math.max(0, Math.sin(Math.PI * u)) ** 0.6,
  /** Thin at the start, full at the end. */
  "taper-start": (u: number): number => Math.min(1, u * 1.6),
  /** Full at the start, thin at the end. */
  "taper-end": (u: number): number => Math.min(1, (1 - u) * 1.6),
  /** Never quite thin; fullest in the middle. */
  swell: (u: number): number => 0.3 + 0.7 * Math.max(0, Math.sin(Math.PI * u)),
} as const;
export type WidthProfile = keyof typeof WIDTH_PROFILES;
export const PROFILE_NAMES: readonly WidthProfile[] = ["taper", "taper-start", "taper-end", "swell"];

interface P {
  x: number;
  y: number;
  /** Half width here. */
  r: number;
}

/** The most pieces one stroke is cut into (a guard against a degenerate path, not a quality setting). */
export const MAX_STROKE_POINTS = 120_000;

/** The corner nodes of a polygon turned so its area is positive (every piece turns the same way). */
function poly(pts: ReadonlyArray<readonly [number, number]>): SubPath | null {
  if (pts.length < 3) return null;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  if (!(Math.abs(a) > 0)) return null;
  const ordered = a < 0 ? [...pts].reverse() : pts;
  const n: number[] = [];
  for (const [x, y] of ordered) n.push(...corner(x, y));
  return { n, closed: true };
}

/** A circle of radius r, with enough corners that the flat sides stay within `tol` of it. */
function circle(x: number, y: number, r: number, tol: number): SubPath | null {
  const steps = Math.max(8, Math.min(256, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - tol / Math.max(r, 1e-300))))));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) pts.push([x + r * Math.cos((2 * Math.PI * i) / steps), y + r * Math.sin((2 * Math.PI * i) / steps)]);
  return poly(pts);
}

/** The flattened centre line of a sub-path: points with their half width, and their distance along the line. */
function flatten(s: SubPath, width: number, profile: StrokeOptions["profile"], tol: number): { pts: P[]; closed: boolean } {
  const c = nodeCount(s);
  const raw: Array<[number, number]> = [[s.n[0]!, s.n[1]!]];
  const segs = s.closed ? c : c - 1;
  for (let k = 0; k < segs; k++) {
    const cb = cubicOf(s.n, k, (k + 1) % c);
    const flat: number[] = [];
    cubicPoints(flat, cb[0], cb[1], cb[2], cb[3], cb[4], cb[5], cb[6], cb[7], tol);
    for (let i = 0; i < flat.length; i += 2) raw.push([flat[i]!, flat[i + 1]!]);
  }
  // a closed line ends where it began: that point is not a second one
  if (s.closed && raw.length > 1) {
    const f = raw[0]!, l = raw[raw.length - 1]!;
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-12) raw.pop();
  }
  const pts: P[] = [];
  for (const q of raw) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(q[0] - last.x, q[1] - last.y) > 1e-12 * Math.max(1, Math.abs(q[0]) + Math.abs(q[1]))) pts.push({ x: q[0], y: q[1], r: width / 2 });
  }
  if (profile) {
    const len = [0];
    const m = s.closed ? pts.length + 1 : pts.length;
    for (let i = 1; i < m; i++) {
      const a = pts[i - 1]!, b = pts[i % pts.length]!;
      len.push(len[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const total = len[len.length - 1]! || 1;
    pts.forEach((p, i) => (p.r = (width / 2) * Math.max(0, profile(len[i]! / total))));
  }
  return { pts, closed: s.closed };
}

/** Split a polyline into the pieces a dash pattern leaves (a dash of no length is a single point). */
function dashes(pts: P[], closed: boolean, dash: readonly [number, number], width: number, offset: number): P[][] {
  const on = dash[0] * width, off = dash[1] * width;
  const period = on + off;
  if (!(period > 0)) return [pts];
  const line = closed ? [...pts, pts[0]!] : pts;
  const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: a.r + (b.r - a.r) * t });
  const start = (((offset * width) % period) + period) % period; // where in the pattern the line starts
  const out: P[][] = [];
  if (on === 0) {
    // dots: one at every period, the first where the pattern says
    let next = (period - start) % period;
    let walked = 0;
    for (let i = 1; i < line.length && out.length < MAX_STROKE_POINTS; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (next <= walked + seg && out.length < MAX_STROKE_POINTS) {
        out.push([lerp(a, b, seg > 0 ? (next - walked) / seg : 0)]);
        next += period;
      }
      walked += seg;
    }
    return out;
  }
  let phase = start;
  let cur: P[] = phase < on ? [line[0]!] : [];
  for (let i = 1; i < line.length && out.length < MAX_STROKE_POINTS; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let at = 0;
    while (at < seg) {
      const inDash = phase < on;
      const rem = inDash ? on - phase : period - phase;
      if (rem <= 1e-12) {
        phase = inDash ? on : 0;
        continue;
      }
      if (at + rem > seg) {
        phase += seg - at;
        if (inDash) cur.push(b);
        break;
      }
      at += rem;
      const p = lerp(a, b, at / seg);
      if (inDash) {
        cur.push(p);
        out.push(cur);
        cur = [];
        phase = on;
      } else {
        cur = [p];
        phase = 0;
      }
    }
  }
  if (phase < on && cur.length > 1) out.push(cur);
  return out;
}

/** The pieces of one flattened line. */
function pieces(pts: P[], closed: boolean, o: StrokeOptions, tol: number, out: SubPath[]): void {
  const add = (s: SubPath | null): void => void (s && out.push(s));
  if (pts.length === 1) {
    const p = pts[0]!;
    if (o.cap === "round" && p.r > 0) add(circle(p.x, p.y, p.r, tol));
    else if (o.cap === "square" && p.r > 0) add(poly([[p.x - p.r, p.y - p.r], [p.x + p.r, p.y - p.r], [p.x + p.r, p.y + p.r], [p.x - p.r, p.y + p.r]]));
    return;
  }
  const n = pts.length;
  const segs = closed ? n : n - 1;
  const dirs: Array<[number, number]> = [];
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const d: [number, number] = [(b.x - a.x) / l, (b.y - a.y) / l];
    dirs.push(d);
    const nx = -d[1], ny = d[0];
    add(poly([[a.x + nx * a.r, a.y + ny * a.r], [b.x + nx * b.r, b.y + ny * b.r], [b.x - nx * b.r, b.y - ny * b.r], [a.x - nx * a.r, a.y - ny * a.r]]));
  }
  // corners
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const v = pts[i]!;
    const d1 = dirs[(i - 1 + segs) % segs]!, d2 = dirs[i % segs]!;
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    const dot = d1[0] * d2[0] + d1[1] * d2[1];
    if (Math.abs(cross) < 1e-9 && dot > 0) continue; // straight on
    if (!(v.r > 0)) continue;
    const s = cross > 0 ? -1 : 1; // the outer side is opposite the turn
    const a: [number, number] = [v.x + s * -d1[1] * v.r, v.y + s * d1[0] * v.r];
    const b: [number, number] = [v.x + s * -d2[1] * v.r, v.y + s * d2[0] * v.r];
    if (o.join === "round") {
      let a1 = Math.atan2(a[1] - v.y, a[0] - v.x);
      let a2 = Math.atan2(b[1] - v.y, b[0] - v.x);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(2, Math.min(128, Math.ceil(Math.abs(da) / Math.acos(Math.max(0, 1 - tol / v.r)))));
      const fan: Array<[number, number]> = [[v.x, v.y]];
      for (let k = 0; k <= steps; k++) {
        const t = a1 + (da * k) / steps;
        fan.push([v.x + v.r * Math.cos(t), v.y + v.r * Math.sin(t)]);
      }
      a1 = a2;
      add(poly(fan));
    } else {
      const wedge: Array<[number, number]> = [[v.x, v.y], a];
      if (o.join === "miter") {
        const m = Math.sqrt(2 / Math.max(1e-12, 1 + dot)); // the miter point's distance from the corner, in half widths
        if (m <= o.miterLimit && dot > -0.999999) {
          const tx = (a[0] - v.x + (b[0] - v.x)), ty = (a[1] - v.y + (b[1] - v.y));
          const tl = Math.hypot(tx, ty) || 1;
          wedge.push([v.x + (tx / tl) * v.r * m, v.y + (ty / tl) * v.r * m]);
        }
      }
      wedge.push(b);
      add(poly(wedge));
    }
  }
  // caps
  if (!closed && o.cap !== "butt") {
    for (const [v, d] of [[pts[0]!, dirs[0]!], [pts[n - 1]!, dirs[segs - 1]!]] as const) {
      if (!(v.r > 0)) continue;
      if (o.cap === "round") add(circle(v.x, v.y, v.r, tol));
      else {
        const sgn = v === pts[0] ? -1 : 1; // outward along the line
        const nx = -d[1], ny = d[0];
        add(poly([[v.x + nx * v.r, v.y + ny * v.r], [v.x + nx * v.r + sgn * d[0] * v.r, v.y + ny * v.r + sgn * d[1] * v.r], [v.x - nx * v.r + sgn * d[0] * v.r, v.y - ny * v.r + sgn * d[1] * v.r], [v.x - nx * v.r, v.y - ny * v.r]]));
      }
    }
  }
}

/** The stroke of `subs` as closed polygons, to be filled with the non-zero rule. */
export function strokeToSubs(subs: readonly SubPath[], o: StrokeOptions): SubPath[] {
  const out: SubPath[] = [];
  if (!(o.width > 0)) return out;
  for (const s of subs) {
    if (nodeCount(s) < 1) continue;
    if (nodeCount(s) === 1) {
      pieces([{ x: s.n[0]!, y: s.n[1]!, r: o.width / 2 }], false, o, o.width * 0.02, out);
      continue;
    }
    const tol = Math.max(o.width * 0.02, 1e-9);
    const flat = flatten(s, o.width, o.profile, tol * 2);
    if (flat.pts.length * 4 > MAX_STROKE_POINTS) break;
    if (o.dash) for (const part of dashes(flat.pts, flat.closed, o.dash, o.width, o.dashOffset ?? 0)) pieces(part, false, o, tol, out);
    else pieces(flat.pts, flat.closed, o, tol, out);
  }
  return out;
}

export { NODE };
