/**
 * Pens (ADR 0037). A pen turns the points of one gesture into one or more ordinary strokes (polylines with a width
 * and an opacity), so every stroke feature keeps working: exact coordinates at any depth, hit-testing, the object
 * eraser, deep-zoom colour, storage. The pens differ in how they generate those strokes, not in how they are drawn:
 *
 *   fine     the plain pen: one stroke of constant width.
 *   pencil   three thin, translucent passes with a small smooth wander (graphite grain), a darker core and a
 *            softer edge.
 *   ink      a broad nib: width follows the direction of travel (thick across the nib, thin along it) and the
 *            pressure, or the speed where there is no pressure; the line is cut into pieces of similar width.
 *   marker   one wide translucent stroke.
 *
 * All values are in the draft's local units (the same unit as `points` and `width`); nothing here knows the zoom.
 */

/** A lean of this many degrees counts as fully tilted. */
export const TILT_FULL_DEG = 70;
/** Below this lean the pen is taken as upright: the nib keeps its fixed angle. */
const TILT_UPRIGHT = 0.12;

export const PEN_KINDS = ["fine", "pencil", "ink", "marker"] as const;
export type PenKind = (typeof PEN_KINDS)[number];

export interface RawStroke {
  /** x, y pairs. */
  points: readonly number[];
  /** The width the user chose (the fine pen's width). */
  width: number;
  /** Per point, 0..1, when the device reports pressure. */
  pressure?: readonly number[];
  /** Per point, CSS px per ms, when known. */
  speed?: readonly number[];
  /** Per point, how far the pen leans (0..1) and the way (radians), when the device reports it (ADR 0113). */
  tilt?: readonly number[];
  tiltAz?: readonly number[];
}

/** One generated stroke. */
export interface Piece {
  points: number[];
  width: number;
  opacity: number;
}

/** The direction of the ink pen's nib (radians): the line is thinnest when travelling along it. */
const NIB_ANGLE = Math.PI / 4;
const NIB_MIN = 0.3;
/** Widths closer than this ratio are drawn as one piece. */
const INK_STEP = 1.2;
/** The ink pen draws a little bolder than the fine pen at the same size setting. */
const INK_SCALE = 1.6;
const INK_SMOOTH = 0.55;
/** Typical writing speed (CSS px per ms) at which the ink pen has thinned by half of its speed range. */
const INK_SPEED_REF = 1.6;

const MARKER_WIDTH = 3.2;
const MARKER_OPACITY = 0.35;
/** Pencil passes: width, wander amplitude (both as a fraction of the chosen width) and opacity. */
const PENCIL_PASSES = [
  { w: 0.9, a: 0.35, o: 0.5 },
  { w: 0.7, a: 0.45, o: 0.45 },
  { w: 0.5, a: 0.55, o: 0.4 },
];

/** Deterministic hash of an integer to [-1, 1]. */
function hash(i: number, seed: number): number {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x7fffffff - 1;
}
/** Smooth value noise in [-1, 1]. */
function noise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  return hash(i, seed) * (1 - s) + hash(i + 1, seed) * s;
}

function pencil(s: RawStroke): Piece[] {
  const n = s.points.length / 2;
  // Arc length at each point and the unit normal (from the neighbours).
  const arc: number[] = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1]! + Math.hypot(s.points[2 * i]! - s.points[2 * i - 2]!, s.points[2 * i + 1]! - s.points[2 * i - 1]!));
  const seed = Math.round((s.points[0]! * 1e3) % 1e6) ^ n;
  // A leaning pencil lays down a broader, softer line (the side of the lead).
  const lean = s.tilt && s.tilt.length ? s.tilt.reduce((a, b) => a + b, 0) / s.tilt.length : 0;
  return PENCIL_PASSES.map((p0, j) => {
    const p = { w: p0.w * (1 + 1.2 * lean), a: p0.a * (1 + 0.8 * lean), o: p0.o * (1 - 0.35 * lean) };
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = s.points[2 * b]! - s.points[2 * a]!;
      const dy = s.points[2 * b + 1]! - s.points[2 * a + 1]!;
      const len = Math.hypot(dx, dy) || 1;
      const wander = n > 1 ? noise(arc[i]! / (s.width * 6), seed + 31 * j) * p.a * s.width : 0;
      out.push(s.points[2 * i]! - (dy / len) * wander, s.points[2 * i + 1]! + (dx / len) * wander);
    }
    return { points: out, width: s.width * p.w, opacity: p.o };
  });
}

function ink(s: RawStroke): Piece[] {
  const n = s.points.length / 2;
  if (n < 2) return [{ points: [...s.points], width: s.width * INK_SCALE, opacity: 1 }];
  const pieces: Piece[] = [];
  let smooth = NaN;
  let level = NaN;
  let cur: number[] = [];
  for (let i = 1; i < n; i++) {
    const x0 = s.points[2 * i - 2]!;
    const y0 = s.points[2 * i - 1]!;
    const x1 = s.points[2 * i]!;
    const y1 = s.points[2 * i + 1]!;
    const lean = s.tilt?.[i] ?? 0;
    // A leaning pen sets the nib: it is held at the angle of the lean, and a stronger lean is a broader nib.
    const nib = lean > TILT_UPRIGHT && s.tiltAz?.[i] !== undefined ? s.tiltAz[i]! : NIB_ANGLE;
    const across = Math.abs(Math.sin(Math.atan2(y1 - y0, x1 - x0) - nib));
    const p = s.pressure?.[i];
    const v = s.speed?.[i];
    // Pressure where the device has it; otherwise a quick stroke is thinner than a slow one.
    const dynamics = p !== undefined && p > 0 ? 0.4 + 1.1 * Math.min(1, p) : v !== undefined ? 1.25 - 0.6 * Math.min(1, v / INK_SPEED_REF) : 1;
    const raw = (NIB_MIN + (1 - NIB_MIN) * across) * dynamics * (1 + 0.8 * lean);
    smooth = Number.isNaN(smooth) ? raw : INK_SMOOTH * smooth + (1 - INK_SMOOTH) * raw;
    // A level changes only once the width is clearly past it (hysteresis), so a wobble does not chop the line into pieces.
    const exact = Math.log(smooth) / Math.log(INK_STEP);
    const q = Number.isNaN(level) || Math.abs(exact - level) > 0.8 ? Math.round(exact) : level;
    if (q !== level && cur.length) {
      pieces.push({ points: cur, width: s.width * INK_SCALE * INK_STEP ** level, opacity: 1 });
      cur = [x0, y0]; // the next piece starts where this one ended
    }
    if (!cur.length) cur = [x0, y0];
    cur.push(x1, y1);
    level = q;
  }
  pieces.push({ points: cur, width: s.width * INK_SCALE * INK_STEP ** level, opacity: 1 });
  return pieces;
}

/** The strokes a pen makes from one gesture's points. */
export function expandStroke(kind: PenKind, s: RawStroke): Piece[] {
  if (s.points.length < 2) return [];
  switch (kind) {
    case "pencil":
      return pencil(s);
    case "ink":
      return ink(s);
    case "marker":
      return [{ points: [...s.points], width: s.width * MARKER_WIDTH, opacity: MARKER_OPACITY }];
    default:
      return [{ points: [...s.points], width: s.width, opacity: 1 }];
  }
}
