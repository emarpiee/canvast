import { makeRng } from "../gen/rng";
import type { SubPath } from "./path";
import type { Rng } from "../gen/rng";

/**
 * A speech balloon's outline, made from its numbers: a body of one of many shapes with its tails let into it, one closed outline (so words
 * can flow inside it). Everything here is in the object's local units.
 */
export type P = readonly [number, number];

/** A closed (or open) outline of straight lines through these points. */
export const poly = (pts: readonly P[], closed = true): SubPath => ({ n: pts.flatMap(([x, y]) => [x, y, x, y, x, y]), closed });
/** A round dot. */
export const circle = (x: number, y: number, r: number): SubPath => poly(Array.from({ length: 28 }, (_, i) => [x + r * Math.cos((i / 28) * 2 * Math.PI), y + r * Math.sin((i / 28) * 2 * Math.PI)] as P));

const TAU = Math.PI * 2;
export const STEPS = 144;

export const BODIES: readonly (readonly [string, string])[] = [
  ["oval", "Oval"], ["round", "Rounded box"], ["box", "Box"], ["capsule", "Capsule"], ["octagon", "Cut corners"], ["polygon", "Polygon"],
  ["cloud", "Cloud"], ["burst", "Burst"], ["jagged", "Jagged"], ["wavy", "Wavy"], ["scallop", "Scallop"], ["heart", "Heart"],
];
export const BUMPY = ["cloud", "burst", "jagged", "wavy", "scallop"];

/** A body's outline, clockwise on the screen, inside the half-sizes rx, ry. */
function bodyOf(kind: string, cx: number, cy: number, rx: number, ry: number, round: number, bumps: number, depth: number, sides: number, rng: Rng): P[] {
  const polar = (f: (a: number) => number, steps = STEPS): P[] => Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * TAU;
    const r = f(a);
    return [cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)] as P;
  });
  const d = depth / 100;
  if (kind === "oval") return polar(() => 1);
  if (kind === "cloud") return polar((a) => (1 - d) + d * Math.abs(Math.sin((a * bumps) / 2)), Math.max(STEPS, bumps * 16));
  if (kind === "scallop") return polar((a) => 1 - d * Math.abs(Math.cos((a * bumps) / 2)), Math.max(STEPS, bumps * 16));
  if (kind === "wavy") return polar((a) => 1 - d / 2 + (d / 2) * Math.sin(a * bumps), Math.max(STEPS, bumps * 16));
  if (kind === "burst" || kind === "jagged") {
    const rough = kind === "jagged" ? 0.5 : 0;
    return Array.from({ length: bumps * 2 }, (_, i) => {
      const a = ((i + (rough ? (rng() - 0.5) * rough : 0)) / (bumps * 2)) * TAU;
      const r = i % 2 ? 1 - 2 * d * (rough ? 0.6 + rng() * 0.8 : 1) : 1 - (rough ? rng() * d * 0.4 : 0);
      return [cx + rx * Math.max(0.1, r) * Math.cos(a), cy + ry * Math.max(0.1, r) * Math.sin(a)] as P;
    });
  }
  if (kind === "polygon") return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * TAU - Math.PI / 2;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as P;
  });
  if (kind === "heart") {
    const pts = Array.from({ length: STEPS }, (_, i) => {
      const t = (i / STEPS) * TAU;
      return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))] as P;
    });
    return pts.map(([x, y]) => [cx + (x / 16) * rx, cy + ((y - 2.5) / 14.5) * ry] as P);
  }
  // A box of some rounding: its four corners, each an arc (a straight cut for the octagon).
  const r = kind === "capsule" ? Math.min(rx, ry) : kind === "box" ? 0 : Math.min(rx, ry) * Math.min(1, round / 100);
  const steps = kind === "octagon" ? 1 : 16;
  const cut = kind === "octagon" ? Math.min(rx, ry) * Math.max(0.05, Math.min(1, round / 100)) : r;
  const out: P[] = [];
  for (const [qx, qy, start] of [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]] as const) {
    const ox = cx + qx * (rx - cut), oy = cy + qy * (ry - cut);
    for (let i = 0; i <= steps; i++) {
      const a = ((start + i / steps) * Math.PI) / 2;
      out.push([ox + cut * Math.cos(a), oy + cut * Math.sin(a)]);
    }
  }
  return out;
}

/** Hand-drawn: the outline moved in and out, slowly along it. */
function wobbled(pts: P[], cx: number, cy: number, amount: number, rng: Rng): P[] {
  if (!amount) return pts;
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU];
  return pts.map(([x, y], i) => {
    const t = (i / pts.length) * TAU;
    const k = 1 + (amount / 100) * 0.12 * (Math.sin(2 * t + ph[0]!) + Math.sin(3 * t + ph[1]!) * 0.6 + Math.sin(5 * t + ph[2]!) * 0.3);
    return [cx + (x - cx) * k, cy + (y - cy) * k] as P;
  });
}

const dist = (a: P, b: P): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Points every so far along the outline, its corners kept: a tail's feet can then land anywhere, on a long straight side too. */
function evened(pts: readonly P[]): P[] {
  const total = pts.reduce((t, p, i) => t + dist(p, pts[(i + 1) % pts.length]!), 0);
  const most = total / 360;
  const out: P[] = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const many = Math.max(1, Math.ceil(dist(p, q) / most));
    for (let k = 0; k < many; k++) out.push(lerp(p, q, k / many));
  });
  return out;
}
const inside = (pts: readonly P[], [x, y]: P): boolean => {
  let on = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if (pts[i]![1] > y !== pts[j]![1] > y && x < ((pts[j]![0] - pts[i]![0]) * (y - pts[i]![1])) / (pts[j]![1] - pts[i]![1]) + pts[i]![0]) on = !on;
  return on;
};

/** The point of the outline nearest the way to the tip from the middle, moved along the outline by `shift` (a share of the width). */
function baseIndex(pts: readonly P[], c: P, want: number): number {
  let best = 0, gap = Infinity;
  pts.forEach((p, i) => {
    const g = Math.abs(Math.atan2(Math.sin(Math.atan2(p[1] - c[1], p[0] - c[0]) - want), Math.cos(Math.atan2(p[1] - c[1], p[0] - c[0]) - want)));
    if (g < gap) (gap = g), (best = i);
  });
  return best;
}

/** The outline with a tail let into it: the part between its two feet taken out, the tail's two sides put in. */
function withTail(outline: P[], c: P, tip: P, kind: string, width: number, bend: number, shift: number, opts: { mark?: (m: TailMark) => void; angle?: number; belly?: number; tipRound?: number } = {}): P[] {
  if (inside(outline, tip)) return outline; // (a tip inside the balloon: no tail to draw)
  const pts = evened(outline);
  const m = pts.length;
  const k = baseIndex(pts, c, opts.angle ?? Math.atan2(tip[1] - c[1], tip[0] - c[0]) + shift);
  const walk = (dir: number): number => {
    let i = k, left = width / 2, n = 0;
    while (left > 0 && n++ < m / 3) {
      const next = (i + dir + m) % m;
      left -= dist(pts[i]!, pts[next]!);
      i = next;
    }
    return i;
  };
  const a = walk(-1), b = walk(1);
  const ring: P[] = [];
  for (let i = b; i !== a; i = (i + 1) % m) ring.push(pts[i]!);
  ring.push(pts[a]!);
  const A = pts[a]!, B = pts[b]!;
  const mid = lerp(A, B, 0.5);
  const len = dist(mid, tip) || 1;
  const nx = -(tip[1] - mid[1]) / len, ny = (tip[0] - mid[0]) / len;
  const bow = (bend / 100) * len;
  // How wide it is half way: the two sides move apart or together from a straight taper; the bend moves them both the same way, so it never changes this.
  const curve = kind === "curved" ? bow : 0;
  const midW = width * ((opts.belly ?? 50) / 100);
  const toA = (A[0] - mid[0]) * nx + (A[1] - mid[1]) * ny >= 0 ? 1 : -1;
  const apart = toA * (midW - dist(A, B) / 2);
  const bendAt: P = [(mid[0] + tip[0]) / 2 + (nx * curve) / 2, (mid[1] + tip[1]) / 2 + (ny * curve) / 2];
  opts.mark?.({ a: A, b: B, base: mid, bendAt, bellyAt: [bendAt[0] - (toA * nx * midW) / 2, bendAt[1] - (toA * ny * midW) / 2], nx, ny, len });
  const side = (from: P, to: P, sag: number): P[] => Array.from({ length: 14 }, (_, i) => {
    const t = (i + 1) / 14, u = 1 - t;
    const cx = (from[0] + to[0]) / 2 + nx * sag, cy = (from[1] + to[1]) / 2 + ny * sag;
    return [u * u * from[0] + 2 * u * t * cx + t * t * to[0], u * u * from[1] + 2 * u * t * cy + t * t * to[1]] as P;
  });
  if (kind === "zigzag") {
    // A bolt: a line that kinks twice, its two sides parallel and narrowing to the tip.
    const kink = width * 0.45;
    const at = (t: number, off: number, side: number): P => {
      const half = (width / 2) * (1 - t);
      const x = mid[0] + (tip[0] - mid[0]) * t + nx * (off + side * half), y = mid[1] + (tip[1] - mid[1]) * t + ny * (off + side * half);
      return [x, y];
    };
    ring.push(at(0.38, kink, -1), at(0.62, -kink, -1), tip, at(0.62, -kink, 1), at(0.38, kink, 1), B);
    ring.pop();
    return ring;
  }
  const out0 = side(A, tip, curve + apart), back = side(tip, B, curve - apart).slice(0, -1);
  const cut = ((opts.tipRound ?? 0) / 100) * len * 0.3;
  if (cut > 0) {
    // A rounded tip: both sides stop short of it and a curve joins them.
    const L = out0.filter((p) => dist(p, tip) > cut), R = back.filter((p) => dist(p, tip) > cut);
    const a0 = L[L.length - 1] ?? A, b0 = R[0] ?? B;
    ring.push(...L, ...Array.from({ length: 9 }, (_, i) => { const t = (i + 1) / 10, u = 1 - t; return [u * u * a0[0] + 2 * u * t * tip[0] + t * t * b0[0], u * u * a0[1] + 2 * u * t * tip[1] + t * t * b0[1]] as P; }), ...R);
  } else ring.push(...out0, ...back);
  return ring;
}

const area = (pts: readonly P[]): number => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * p[1], 0) / 2;

export type TailKind = "point" | "curved" | "zigzag" | "bubbles";
export const TAIL_KINDS: readonly (readonly [TailKind, string])[] = [["point", "Point"], ["curved", "Curved"], ["zigzag", "Zigzag"], ["bubbles", "Thought bubbles"]];

export interface BalloonTail {
  readonly tip: readonly [number, number];
  readonly kind: TailKind;
  /** The width at the body. */
  readonly width: number;
  /** How far it bows, a share of its length in percent (a curved tail). */
  readonly bend: number;
  /** With `follow`: how far its base is moved round the body from the way to the tip, in radians. */
  readonly shift: number;
  /** Where its base is round the body, in radians from the middle: it stays there when the tip moves. */
  readonly angle?: number;
  /** The base goes round the body with the tip. */
  readonly follow?: true;
  /** How round its tip is, 0 to 100. */
  readonly tipRound?: number;
  /** Thought bubbles: how many. */
  readonly bubbles?: number;
  /** Its width half way along, a share of its base in percent (50: a straight taper). */
  readonly belly?: number;
}

export interface BalloonSpec {
  readonly body: string;
  readonly round: number;
  readonly bumps: number;
  readonly depth: number;
  readonly sides: number;
  readonly wobble: number;
  /** A second line inside the outline, this far in as a share of the body in percent (absent: one line). */
  readonly double?: number;
  readonly seed: number;
  readonly tails: readonly BalloonTail[];
}

export type Box = readonly [number, number, number, number];

/** What a tail stands on, to put its handles there. */
export interface TailMark { a: P; b: P; base: P; bendAt: P; bellyAt: P; nx: number; ny: number; len: number }

/** The middle and half-sizes of a box, whichever way it was drawn or flipped. */
export const boxShape = ([x, y, w, h]: Box): { c: P; rx: number; ry: number } => ({ c: [x + w / 2, y + h / 2], rx: Math.max(Math.abs(w) / 2, 1e-9), ry: Math.max(Math.abs(h) / 2, 1e-9) });

/** A new balloon in a box: an oval with one tail going down to the left. */
export const newBalloon = ([x, y, w, h]: Box): BalloonSpec => {
  const tip: P = [x + w * 0.28, y + h * 1.4];
  const made: BalloonSpec = {
    body: "oval", round: 35, bumps: 12, depth: 18, sides: 6, wobble: 0, seed: 1,
    tails: [{ tip, kind: "point", width: Math.min(Math.abs(w), Math.abs(h)) * 0.22, bend: 28, shift: 0, angle: Math.atan2(tip[1] - (y + h / 2), tip[0] - (x + w / 2)) }],
  };
  return remembered ? withBalloonLook(made, remembered) : made;
};

/** What a balloon looks like, apart from where it is: kept as a style, and for the next balloon drawn. */
export interface BalloonLook {
  readonly body: string; readonly round: number; readonly bumps: number; readonly depth: number; readonly sides: number; readonly wobble: number; readonly seed: number; readonly double?: number;
  readonly tail?: { readonly kind: TailKind; readonly bend: number; readonly belly?: number; readonly tipRound?: number; readonly bubbles?: number };
}
export function balloonLook(s: BalloonSpec): BalloonLook {
  const t = s.tails[0];
  return { body: s.body, round: s.round, bumps: s.bumps, depth: s.depth, sides: s.sides, wobble: s.wobble, seed: s.seed, ...(s.double ? { double: s.double } : {}), ...(t ? { tail: { kind: t.kind, bend: t.bend, ...(t.belly !== undefined ? { belly: t.belly } : {}), ...(t.tipRound !== undefined ? { tipRound: t.tipRound } : {}), ...(t.bubbles !== undefined ? { bubbles: t.bubbles } : {}) } } : {}) };
}
export function withBalloonLook(s: BalloonSpec, l: BalloonLook): BalloonSpec {
  const { tail, double, ...body } = l;
  const { double: _d, ...rest } = s;
  return { ...rest, ...body, ...(double ? { double } : {}), tails: tail ? s.tails.map((t) => ({ ...t, ...tail })) : s.tails };
}
/** The look when it is one (a stored style, a remembered setting); else null. */
export function validLook(d: unknown): BalloonLook | null {
  const l = d as BalloonLook | null;
  if (!l || typeof l !== "object") return null;
  const tail = l.tail ? [{ tip: [2, 2] as const, width: 0.2, shift: 0, ...l.tail }] : [];
  return validBalloon({ ...l, tails: tail } as BalloonSpec) ? l : null;
}
let remembered: BalloonLook | null = null;
/** The look the next balloon is drawn with. */
export const rememberBalloonLook = (l: BalloonLook | null): void => { remembered = l; };

/** A tail more, out from a point of the body. */
export function withTailAt(box: Box, s: BalloonSpec, [x, y]: P): BalloonSpec {
  const { c, rx, ry } = boxShape(box);
  const last = s.tails[s.tails.length - 1];
  const a = Math.atan2(y - c[1], x - c[0]);
  return { ...s, tails: [...s.tails, { tip: [c[0] + (x - c[0]) * 1.5, c[1] + (y - c[1]) * 1.5], kind: last?.kind ?? "point", width: Math.min(rx, ry) * 0.44, bend: 28, shift: 0, angle: a }] };
}

/** Whether a point is within `reach` of the balloon's outline. */
export function nearOutline(box: Box, s: BalloonSpec, [x, y]: P, reach: number): boolean {
  return balloonOutline(box, s).pts.some(([px, py]) => Math.hypot(px - x, py - y) <= reach);
}

/** Where a tail's base is round the body now, in radians. */
export function tailAngle(box: Box, t: BalloonTail): number {
  const { c } = boxShape(box);
  return !t.follow && t.angle !== undefined ? t.angle : Math.atan2(t.tip[1] - c[1], t.tip[0] - c[0]) + t.shift;
}

type Outline = { pts: P[]; marks: Array<TailMark | null>; beads: SubPath[] };
const outlines = new WeakMap<BalloonSpec, { box: Box; made: Outline }>();

/** The outline, and what each tail stands on; worked out once for the same numbers (the handles ask for it at every pointer move and every frame). */
export function balloonOutline(box: Box, s: BalloonSpec): Outline {
  const had = outlines.get(s);
  if (had && had.box.every((v, i) => v === box[i])) return had.made;
  const made = makeOutline(box, s);
  outlines.set(s, { box, made });
  return made;
}

function makeOutline(box: Box, s: BalloonSpec): Outline {
  const { c, rx, ry } = boxShape(box);
  const rng = makeRng(s.seed);
  let pts = wobbled(bodyOf(s.body, c[0], c[1], rx, ry, s.round, s.bumps, s.depth, s.sides, rng), c[0], c[1], s.wobble, rng);
  if (area(pts) < 0) pts = [...pts].reverse();
  const marks: Array<TailMark | null> = [];
  const beads: SubPath[] = [];
  for (const t of s.tails) {
    let m: TailMark | null = null;
    if (t.kind === "bubbles") {
      if (inside(pts, t.tip)) { marks.push(null); continue; }
      // Beads from the body to the tip, getting smaller; the first starts just off the body.
      const on = evened(pts)[baseIndex(evened(pts), c, tailAngle(box, t))]!;
      const len = dist(on, t.tip) || 1;
      const nx = -(t.tip[1] - on[1]) / len, ny = (t.tip[0] - on[0]) / len;
      const many = Math.max(1, Math.round(t.bubbles ?? 3));
      for (let i = 0; i < many; i++) {
        const u = many === 1 ? 1 : i / (many - 1);
        const r = (t.width / 2) * (1 - 0.7 * u);
        const [x, y] = lerp(on, t.tip, 0.12 + 0.88 * u);
        beads.push(circle(x, y, r));
      }
      const half = lerp(on, t.tip, 0.5);
      marks.push({ a: on, b: [on[0] + (nx * t.width) / 2, on[1] + (ny * t.width) / 2], base: on, bendAt: half, bellyAt: half, nx, ny, len });
      continue;
    }
    pts = withTail(pts, c, t.tip, t.kind, t.width, t.bend, t.shift, { mark: (x) => { m = x; }, angle: tailAngle(box, t), ...(t.belly !== undefined ? { belly: t.belly } : {}), ...(t.tipRound !== undefined ? { tipRound: t.tipRound } : {}) });
    marks.push(m);
  }
  return { pts, marks, beads };
}

export const balloonSubs = (box: Box, s: BalloonSpec): SubPath[] => {
  const { pts, beads } = balloonOutline(box, s);
  if (!s.double) return [poly(pts), ...beads];
  const { c } = boxShape(box);
  const k = 1 - s.double / 100;
  return [poly(pts), poly(balloonOutline(box, { ...s, tails: [], double: 0 }).pts.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k] as P)), ...beads];
};

/** The parts of a balloon that have a handle. */
export type BalloonPart = "tip" | "base" | "foot" | "bend" | "belly" | "body" | "move" | "size" | "linkW" | "linkBend";
export const BALLOON_LABELS: Record<BalloonPart, string> = { tip: "Tail tip", base: "Tail base", foot: "Tail width", bend: "Tail bend", belly: "Tail middle width", body: "Body shape", move: "Move the body, the tail tip stays", size: "Size of the body, the tail tip stays", linkW: "Connector width", linkBend: "Connector bend" };

/** How far the body handle sits in from the top of the box, for a body that has something to set (null: it has nothing). */
function bodyAmount(s: BalloonSpec, ry: number, rx: number): number | null {
  if (s.body === "round" || s.body === "octagon") return (Math.min(rx, ry) * Math.min(100, s.round)) / 100;
  if (BUMPY.includes(s.body)) return (ry * s.depth) / 60;
  return null;
}

/** Where each handle is, in local units, and the way it points or slides (a unit vector; none for one that has no direction). */
export function balloonHandlePoints(box: Box, s: BalloonSpec): Array<{ part: BalloonPart; tail: number; at: P; dir?: P }> {
  const { c, rx, ry } = boxShape(box);
  const { marks } = balloonOutline(box, s);
  const out: Array<{ part: BalloonPart; tail: number; at: P; dir?: P }> = [];
  const amount = bodyAmount(s, ry, rx);
  out.push({ part: "move", tail: -1, at: c }, { part: "size", tail: -1, at: [c[0] + rx, c[1] + ry] });
  if (amount !== null) out.push({ part: "body", tail: -1, at: [c[0], c[1] - ry + amount] });
  s.tails.forEach((t, i) => {
    const m = marks[i];
    let dir: P = [0, 1];
    if (m) {
      const across: P = [m.nx, m.ny];
      dir = [(t.tip[0] - m.base[0]) / (m.len || 1), (t.tip[1] - m.base[1]) / (m.len || 1)];
      out.push({ part: "base", tail: i, at: m.base }, { part: "foot", tail: i, at: m.b, dir: across });
      if (t.kind === "curved") out.push({ part: "bend", tail: i, at: m.bendAt });
      if (t.kind !== "zigzag" && t.kind !== "bubbles") out.push({ part: "belly", tail: i, at: m.bellyAt, dir: across });
    }
    out.push({ part: "tip", tail: i, at: t.tip, dir });
  });
  return out;
}

/** The balloon after a handle is dragged to a point (local units). */
export function balloonDragged(box: Box, s: BalloonSpec, part: BalloonPart, tail: number, [x, y]: P): BalloonSpec {
  const { c, rx, ry } = boxShape(box);
  if (part === "body") {
    const amount = Math.max(0, Math.min(ry, y - (c[1] - ry)));
    if (s.body === "round" || s.body === "octagon") return { ...s, round: Math.min(100, (Math.min(ry, amount) / Math.min(rx, ry)) * 100) };
    return { ...s, depth: Math.max(2, Math.min(60, (amount / ry) * 60)) };
  }
  const t = s.tails[tail];
  if (!t || part === "move") return s;
  const m = balloonOutline(box, s).marks[tail];
  const put = (next: Partial<BalloonTail>): BalloonSpec => ({ ...s, tails: s.tails.map((q, i) => (i === tail ? { ...q, ...next } : q)) });
  if (part === "tip") return put({ tip: [x, y], ...(t.follow ? {} : { angle: tailAngle(box, t) }) });
  if (!m) return s;
  if (part === "foot") return put({ width: Math.max(Math.min(rx, ry) * 0.02, 2 * Math.hypot(x - m.base[0], y - m.base[1])) });
  if (part === "belly") return put({ belly: Math.max(0, Math.min(150, (Math.abs((x - m.bendAt[0]) * m.nx + (y - m.bendAt[1]) * m.ny) * 200) / (t.width || 1))) });
  if (part === "bend") {
    const half: P = [(m.base[0] + t.tip[0]) / 2, (m.base[1] + t.tip[1]) / 2];
    return put({ bend: Math.max(-100, Math.min(100, (((x - half[0]) * m.nx + (y - half[1]) * m.ny) * 2 * 100) / m.len)) });
  }
  if (!t.follow) return put({ angle: Math.atan2(y - c[1], x - c[0]) });
  const from = Math.atan2(t.tip[1] - c[1], t.tip[0] - c[0]);
  const a = Math.atan2(y - c[1], x - c[0]) - from;
  return put({ shift: Math.max(-1.2, Math.min(1.2, Math.atan2(Math.sin(a), Math.cos(a)))) });
}

/** A tail more, on the other side of the body from the last one (the first: below it). */
export function withNewTail(box: Box, s: BalloonSpec): BalloonSpec {
  const { c, rx, ry } = boxShape(box);
  const last = s.tails[s.tails.length - 1];
  const a = last ? tailAngle(box, last) + Math.PI * 0.75 : Math.PI / 2;
  const tip: P = [c[0] + Math.cos(a) * rx * 1.6, c[1] + Math.sin(a) * ry * 1.6];
  return { ...s, tails: [...s.tails, { tip, kind: last?.kind ?? "point", width: Math.min(rx, ry) * 0.44, bend: 28, shift: 0, angle: a }] };
}

/** Ready-made balloons: what they change, the rest stays. */
export const BALLOON_PRESETS: readonly (readonly [string, string, string, TailKind])[] = [["speech", "Speech", "oval", "point"], ["thought", "Thought", "cloud", "bubbles"], ["shout", "Shout", "burst", "zigzag"], ["caption", "Caption", "box", "point"], ["soft", "Soft", "round", "curved"]];

/** The numbers after the object's local coordinates are scaled (a flip mirrors how the tails bend and sit). */
export function scaledBalloon(s: BalloonSpec, kx: number, ky: number): BalloonSpec {
  const flip = kx * ky < 0 ? -1 : 1;
  const k = Math.sqrt(Math.abs(kx * ky));
  return { ...s, tails: s.tails.map((t) => ({ ...t, tip: [t.tip[0] * kx, t.tip[1] * ky] as const, width: t.width * k, bend: t.bend * flip, shift: t.shift * flip, ...(t.angle !== undefined ? { angle: Math.atan2(Math.sin(t.angle) * ky, Math.cos(t.angle) * kx) } : {}) })) };
}

const num = (v: unknown, lo: number, hi: number): boolean => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** Whether a stored balloon can be drawn. */
export function validBalloon(s: BalloonSpec): boolean {
  return BODIES.some(([b]) => b === s.body) && num(s.round, 0, 100) && Number.isInteger(s.bumps) && num(s.bumps, 3, 480) && num(s.depth, 0, 60) && Number.isInteger(s.sides) && num(s.sides, 3, 240) && num(s.wobble, 0, 100) && Number.isFinite(s.seed)
    && Array.isArray(s.tails) && s.tails.length <= 32 && s.tails.every((t) => Array.isArray(t.tip) && t.tip.length === 2 && t.tip.every(Number.isFinite) && TAIL_KINDS.some(([k]) => k === t.kind) && num(t.width, 0, Infinity) && num(t.bend, -100, 100) && num(t.shift, -7, 7) && (t.angle === undefined || Number.isFinite(t.angle)) && (t.follow === undefined || t.follow === true) && (t.belly === undefined || num(t.belly, 0, 300)) && (t.bubbles === undefined || num(t.bubbles, 1, 32)) && (t.tipRound === undefined || num(t.tipRound, 0, 100))) && (s.double === undefined || num(s.double, 0, 45));
}
