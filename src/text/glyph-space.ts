import type { TextObject } from "../doc/model";
import { NODE } from "../doc/path";
import type { Line, PlacedGlyph } from "./layout";
import { glyphScale, layoutOf } from "./layout";
import { fontFor } from "./fonts";

/**
 * Where a point of a glyph goes (ADR 0131): the one map from a glyph's own coordinates (font units, y up) to the text's local units. A
 * straight text puts each glyph at its place on its line (italic sheared about the baseline); a text on a path puts it on the curve:
 * the glyph is centred on the point at the middle of its advance, turned to the tangent there, and a second line sits further from
 * the curve by the distance between the baselines. Drawing, outlines, bounds and picking all go through it, so what is drawn is what is
 * picked and what is flattened.
 */
export const SKEW = 13 / 64;
const STEPS = 24;

/** A curve as a polyline with the distance along it at every point; before its start and after its end it goes on straight. */
export interface Curve {
  readonly pts: Float64Array;
  readonly cum: Float64Array;
  readonly len: number;
  readonly closed: boolean;
}

const curves = new WeakMap<readonly number[], Curve>();

export function curveOf(n: readonly number[], closed: boolean): Curve {
  let c = curves.get(n);
  if (c && c.closed === closed) return c;
  const count = n.length / NODE;
  const segs = closed ? count : count - 1;
  const pts: number[] = [n[0]!, n[1]!];
  for (let i = 0; i < segs; i++) {
    const a = i * NODE, b = ((i + 1) % count) * NODE;
    const x0 = n[a]!, y0 = n[a + 1]!, x1 = n[a + 4]!, y1 = n[a + 5]!, x2 = n[b + 2]!, y2 = n[b + 3]!, x3 = n[b]!, y3 = n[b + 1]!;
    const straight = x1 === x0 && y1 === y0 && x2 === x3 && y2 === y3;
    for (let k = 1; k <= (straight ? 1 : STEPS); k++) {
      const t = straight ? 1 : k / STEPS, u = 1 - t;
      pts.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
  }
  const cum = new Float64Array(pts.length / 2);
  for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1]! + Math.hypot(pts[2 * i]! - pts[2 * i - 2]!, pts[2 * i + 1]! - pts[2 * i - 1]!);
  c = { pts: Float64Array.from(pts), cum, len: cum[cum.length - 1]!, closed };
  curves.set(n, c);
  return c;
}

/** The point at distance `s` along the curve and the unit tangent there (a closed curve wraps round; an open one goes on straight). */
export function curveAt(c: Curve, s: number, out: { x: number; y: number; tx: number; ty: number }): void {
  const { pts, cum } = c;
  const last = cum.length - 1;
  if (c.closed && c.len > 0) s = ((s % c.len) + c.len) % c.len;
  let i = 1;
  if (s <= 0) i = 1;
  else if (s >= c.len) i = last;
  else {
    let lo = 1, hi = last;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    i = lo;
  }
  const x0 = pts[2 * i - 2]!, y0 = pts[2 * i - 1]!, x1 = pts[2 * i]!, y1 = pts[2 * i + 1]!;
  const d = Math.hypot(x1 - x0, y1 - y0) || 1;
  out.tx = (x1 - x0) / d;
  out.ty = (y1 - y0) / d;
  const t = s - cum[i - 1]!; // (beyond the ends this is more than the piece is long, or negative: the line goes on)
  out.x = x0 + out.tx * t;
  out.y = y0 + out.ty * t;
}

/** The map of one glyph; `at(fx, fy)` sets `x` and `y` (local units) for the point (fx, fy) of the glyph in font units. */
export interface GlyphMap {
  x: number;
  y: number;
  at(fx: number, fy: number): void;
}

const here = { x: 0, y: 0, tx: 1, ty: 0 };

export function glyphMap(o: TextObject, line: Line, g: PlacedGlyph, shiftEm: number): GlyphMap {
  const f = fontFor(o.assetId);
  const c = (o.size * glyphScale(line, g)) / f.unitsPerEm;
  const ox = (g.x + shiftEm) * o.size;
  const oy = line.baseline * o.size;
  const m: GlyphMap = {
    x: 0,
    y: 0,
    at(fx, fy) {
      m.x = ox + (g.italic ? fx + fy * SKEW : fx) * c;
      m.y = oy - fy * c;
    },
  };
  if (!o.onPath) return m;
  // On a path: about the middle of the advance, turned to the tangent there, the baseline on the curve (lines after the first below it).
  const curve = curveOf(o.onPath.n, o.onPath.closed);
  const half = (g.adv * o.size) / 2;
  curveAt(curve, (g.x + g.adv / 2) * o.size, here);
  const { x: px, y: py, tx, ty } = here;
  const dy = (line.baseline - layoutOf(o).lines[0]!.baseline) * o.size;
  const bx = px - ty * dy, by = py + tx * dy; // (the normal on the right of the direction)
  m.at = (fx, fy) => {
    const lx = (g.italic ? fx + fy * SKEW : fx) * c + shiftEm * o.size - half;
    const ly = -fy * c;
    m.x = bx + tx * lx - ty * ly;
    m.y = by + ty * lx + tx * ly;
  };
  return m;
}

/** The box of a text on a path in its local units: the corners of every glyph's advance and height, put on the curve. */
export function pathTextBounds(o: TextObject): { minX: number; minY: number; maxX: number; maxY: number } {
  const f = fontFor(o.assetId);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const lay = layoutOf(o);
  for (const line of lay.lines) {
    for (const g of line.glyphs) {
      const m = glyphMap(o, line, g, 0);
      const gs = glyphScale(line, g);
      const top = f.ascender, bottom = f.descender;
      const w = (g.adv * o.size) / ((o.size * gs) / f.unitsPerEm);
      for (const [fx, fy] of [[0, top], [w, top], [0, bottom], [w, bottom]] as const) {
        m.at(fx, fy);
        minX = Math.min(minX, m.x); maxX = Math.max(maxX, m.x);
        minY = Math.min(minY, m.y); maxY = Math.max(maxY, m.y);
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}
