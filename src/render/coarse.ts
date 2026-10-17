import * as D from "../core/dyadic";
import { cropOf } from "../doc/adjust";
import type { WorldPoint } from "../core/camera";
import type { TermSum } from "../core/frames";
import { termsAdd, termsLead, termsScale, termsShift } from "../core/frames";
import type { CanvasObject, ImageObject, PathObject, StrokeObject, TextObject } from "../doc/model";
import { localBounds, pathSubs, pivotOf, strokePoints } from "../doc/model";
import type { FlatPath } from "../doc/path";
import { distanceToOutline, flatten, insideFill } from "../doc/path";
import { paintAt } from "./gradient";
import { cosSin } from "../core/angle";
import { layoutOf } from "../text/layout";
import { fontFor } from "../text/fonts";
import { distToSegment } from "./geometry2d";

/**
 * Objects far coarser than the camera's frame (ADR 0014, reference §7.3).
 *
 * Seen from far below, a coarse object is in one of three states relative to
 * the view: it covers it, it misses it, or an edge of it is near the view.
 * The first two need the camera's position in the object's frame only
 * roughly: if the object's outline is farther from the (rounded) centre than
 * the rounding error plus the view's size, every point of the view is on the
 * same side, so the answer cannot change with the dropped bits. Only an edge
 * near the view needs more, and then the exact path is limited
 * (frame-index.ts COARSE_EXACT_MAX).
 *
 * EVERY KIND OF OBJECT MUST HAVE A SAMPLER (SAMPLERS below is typed over all
 * kinds, so a new kind does not compile without one): the colour of a deep
 * zoom into an object must never silently disappear. `bboxSampler` is the
 * one-line default for a kind that has nothing better.
 */
export interface CoarseInfo {
  /** log2 of the rounded centre's error, in the object frame's units. */
  readonly errLog2: number;
  /** log2 of CSS px per unit of the object's frame (the view's true zoom there). */
  readonly zTrue: number;
}

/** One source pixel of an image over a rectangle of the view (CSS px from the viewport's top-left). */
export interface PixelRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly i: number;
  readonly j: number;
}

/**
 * What the view shows of a coarse object that covers it: one colour over the
 * whole view (strokes, glyphs, anything with a colour), or image pixels.
 */
export interface Cover {
  readonly color?: string;
  readonly rects?: readonly PixelRect[];
  /** An approximation drawn dimmed (an edge in view past COARSE_EXACT_MAX levels, ADR 0016). */
  readonly dim?: boolean;
}

export type CoarseResult = "miss" | "exact" | Cover;

/** Everything a sampler may use: the rounded view centre in the object's local units, and how far to trust it. */
export interface Probe {
  readonly lx: number;
  readonly ly: number;
  /** Margin in local units: the rounding error, the view's size and double rounding. */
  readonly m: number;
  readonly vp: { readonly width: number; readonly height: number };
  readonly info: CoarseInfo;
  /** The view centre as exact term sums in the object's frame (computed on demand; null when off screen). */
  readonly terms: () => { x: TermSum; y: TermSum } | null;
}

export interface CoarseSampler<T extends CanvasObject> {
  /** Called when the view centre is inside the object's bounds (grown by the margin). */
  classify(o: T, p: Probe): CoarseResult;
  /** What to draw (dimmed) when `classify` said "exact" but the exact path is out of range: the object's colour over the view. */
  approx(o: T, p: Probe): Cover;
}

/** Relative double rounding of the local distances below (a few ulps, with room). */
const ROUND = 2 ** -46;

export function classifyCoarse(
  o: CanvasObject,
  center: WorldPoint,
  info: CoarseInfo,
  vp: { width: number; height: number },
  terms: () => { x: TermSum; y: TermSum } | null = () => null,
): CoarseResult {
  const scale = 2 ** o.unit;
  const lx = D.toNumber(D.sub(center.x, o.anchor.x)) / scale;
  const ly = D.toNumber(D.sub(center.y, o.anchor.y)) / scale;
  const viewLog2 = Math.log2(Math.hypot(vp.width, vp.height) / 2 + 8) - info.zTrue; // underflows to 0 at depth
  const b = localBounds(o);
  const mag = Math.max(Math.abs(lx), Math.abs(ly), Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY));
  // Everything that can move the answer, in local units.
  const m = (2 ** info.errLog2 + 2 ** viewLog2) / scale + mag * ROUND;
  if (lx < b.minX - m || lx > b.maxX + m || ly < b.minY - m || ly > b.maxY + m) return "miss";
  const sampler = SAMPLERS[o.kind] as CoarseSampler<CanvasObject>;
  if (o.kind !== "stroke" && o.kind !== "path" && o.rot) {
    // Undo the turn about the pivot, then test the unturned object. Exact pixel boundaries need the unturned centre, so they are not available.
    const { x, y } = unturn(o, lx, ly);
    return sampler.classify(o, { lx: x, ly: y, m, vp, info, terms: () => null });
  }
  return sampler.classify(o, { lx, ly, m, vp, info, terms });
}

function unturn(o: CanvasObject, lx: number, ly: number): { x: number; y: number } {
  const { c, s } = cosSin(o.rot!);
  const pv = pivotOf(o);
  const dx = lx - pv.x;
  const dy = ly - pv.y;
  return { x: pv.x + c * dx + s * dy, y: pv.y - s * dx + c * dy };
}

/**
 * The dimmed stand-in for an object whose edge is in view where the exact
 * path is out of range: its colour (an image: the pixel under the centre)
 * over the whole view, drawn at half strength so it reads as approximate.
 */
export function approxCoarse(o: CanvasObject, center: WorldPoint, info: CoarseInfo, vp: { width: number; height: number }): Cover {
  const scale = 2 ** o.unit;
  const lx = D.toNumber(D.sub(center.x, o.anchor.x)) / scale;
  const ly = D.toNumber(D.sub(center.y, o.anchor.y)) / scale;
  const sampler = SAMPLERS[o.kind] as CoarseSampler<CanvasObject>;
  const at = o.kind !== "stroke" && o.kind !== "path" && o.rot ? unturn(o, lx, ly) : { x: lx, y: ly };
  return { ...sampler.approx(o, { lx: at.x, ly: at.y, m: 0, vp, info, terms: () => null }), dim: true };
}

// ---- samplers ---------------------------------------------------------------

const strokeSampler: CoarseSampler<StrokeObject> = {
  classify(o, { lx, ly, m }) {
    const p = strokePoints(o);
    let d = Infinity;
    if (p.length === 2) d = Math.hypot(lx - p[0]!, ly - p[1]!);
    else for (let i = 0; i + 3 < p.length; i += 2) d = Math.min(d, distToSegment(lx, ly, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!));
    const s = d - o.width / 2; // signed distance to the outline: > 0 outside
    return s > m ? "miss" : s < -m ? { color: o.color } : "exact";
  },
  approx: (o) => ({ color: o.color }),
};

// A path is tested against its own flattened outline, in local units, at a tolerance that is a fraction of its size.
const flatCache = new WeakMap<PathObject, readonly FlatPath[]>();
const EVERYWHERE = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };

function flatOf(o: PathObject): readonly FlatPath[] {
  let f = flatCache.get(o);
  if (!f) {
    const b = localBounds(o);
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
    const subs = pathSubs(o);
    f = flatten(subs, subs.map((s) => Float64Array.from(s.n)), size * 2e-4, EVERYWHERE, 0);
    flatCache.set(o, f);
  }
  return f;
}

const pathSampler: CoarseSampler<PathObject> = {
  classify(o, { lx, ly, m }) {
    const f = flatOf(o);
    const d = distanceToOutline(f, lx, ly);
    if (o.stroke !== null) {
      const h = o.width / 2;
      if (d <= h - m) return { color: paintAt(o, o.stroke, lx, ly) };
      if (d < h + m) return "exact"; // the edge of the outline is within the view
    } else if (d < m) return "exact"; // the edge of the fill is
    return o.fill !== null && insideFill(f, lx, ly, !!o.evenodd) ? { color: paintAt(o, o.fill, lx, ly) } : "miss";
  },
  approx(o, { lx, ly }) {
    const f = flatOf(o);
    if (o.stroke !== null && distanceToOutline(f, lx, ly) <= o.width / 2) return { color: paintAt(o, o.stroke, lx, ly) };
    return { color: o.fill !== null && insideFill(f, lx, ly, !!o.evenodd) ? paintAt(o, o.fill, lx, ly) : "transparent" };
  },
};

/** Where a point of a path's own units lies, with a margin `m` of doubt (the size of the view in those units): see `CoarseSampler.classify`. */
export const classifyPath = (o: PathObject, lx: number, ly: number, m: number): CoarseResult => pathSampler.classify(o, { lx, ly, m, vp: { width: 0, height: 0 }, info: { errLog2: 0, zTrue: 0 }, terms: () => null });

/** What a path shows at a point in its own units when its edges are too far out of range to place: its colour there, or null for nothing. */
export function approxPath(o: PathObject, lx: number, ly: number): Cover | null {
  const c = pathSampler.approx(o, { lx, ly, m: 0, vp: { width: 0, height: 0 }, info: { errLog2: 0, zTrue: 0 }, terms: () => null });
  return c.color === "transparent" ? null : c;
}

/** Source pixel boundaries of one image axis near the view: [lo, hi] px offsets from the view centre, per pixel index. */
function axisRuns(t: TermSum, count: number, size: number, ctr: number, unit: number, zTrue: number, half: number): Array<{ lo: number; hi: number; index: number }> {
  const jc = Math.floor((ctr * count) / size);
  const lines: Array<{ j: number; px: number }> = [];
  for (let j = jc - 1; j <= jc + 2; j++) {
    // Line j is at local j·size/count; its offset from the centre is (j·size − centre·count)/count, exact as term sums.
    const num = termsLead(termsAdd(termsScale(t, D.fromNumber(-count)), D.mul(D.fromNumber(j), D.fromNumber(size))));
    lines.push({ j, px: D.toNumber(D.shift(num, unit + zTrue)) / count });
  }
  const runs: Array<{ lo: number; hi: number; index: number }> = [{ lo: -Infinity, hi: lines[0]!.px, index: jc - 2 }];
  for (let k = 0; k + 1 < lines.length; k++) runs.push({ lo: lines[k]!.px, hi: lines[k + 1]!.px, index: lines[k]!.j });
  runs.push({ lo: lines[lines.length - 1]!.px, hi: Infinity, index: jc + 2 });
  return runs.filter((r) => r.index >= 0 && r.index < count && r.hi > -half && r.lo < half && r.hi > r.lo);
}

const imageSampler: CoarseSampler<ImageObject> = {
  classify(o, { lx, ly, m, vp, info, terms }) {
    const cr = cropOf(o); // (a crop shows a window of the source pixels)
    const u = (lx * cr.w) / o.w;
    const v = (ly * cr.h) / o.h;
    const mu = (m * cr.w) / o.w + u * ROUND;
    const mv = (m * cr.h) / o.h + v * ROUND;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const away = lx >= m && lx <= o.w - m && ly >= m && ly <= o.h - m && u - i >= mu && i + 1 - u >= mu && v - j >= mv && j + 1 - v >= mv;
    if (away) return { rects: [{ x0: 0, y0: 0, x1: vp.width, y1: vp.height, i: i + cr.x, j: j + cr.y }] };
    // A pixel boundary (or the image's own edge) is within the view: place it from exact term sums of the centre.
    const t = terms();
    if (!t) return "exact";
    const unit = o.unit;
    const local = (s: TermSum, anchor: D.Dyadic): TermSum => termsAdd(termsShift(s, -unit), D.neg(D.shift(anchor, -unit)));
    const hx = vp.width / 2 + 2;
    const hy = vp.height / 2 + 2;
    const xs = axisRuns(local(t.x, o.anchor.x), cr.w, o.w, lx, unit, info.zTrue, hx);
    const ys = axisRuns(local(t.y, o.anchor.y), cr.h, o.h, ly, unit, info.zTrue, hy);
    const rects: PixelRect[] = [];
    for (const yr of ys) {
      for (const xr of xs) {
        rects.push({
          x0: vp.width / 2 + Math.max(xr.lo, -hx),
          x1: vp.width / 2 + Math.min(xr.hi, hx),
          y0: vp.height / 2 + Math.max(yr.lo, -hy),
          y1: vp.height / 2 + Math.min(yr.hi, hy),
          i: xr.index + cr.x,
          j: yr.index + cr.y,
        });
      }
    }
    return rects.length ? { rects } : "miss";
  },
  approx(o, { lx, ly, vp }) {
    const cr = cropOf(o);
    const i = Math.min(cr.w - 1, Math.max(0, Math.floor((lx * cr.w) / o.w)));
    const j = Math.min(cr.h - 1, Math.max(0, Math.floor((ly * cr.h) / o.h)));
    return { rects: [{ x0: 0, y0: 0, x1: vp.width, y1: vp.height, i: i + cr.x, j: j + cr.y }] };
  },
};

/** Italic shear and bold offset of the bundled font's glyphs (the same constants draw-text.ts uses). */
const SKEW = 13 / 64;
const BOLD_SHIFT_EM = 1 / 32;
/** Pieces per quadratic curve when testing which side of a glyph the view is on. */
const FLATTEN = 10;

const textSampler: CoarseSampler<TextObject> = {
  classify(o, { lx, ly, m }) {
    let font;
    try {
      font = fontFor(o.assetId);
    } catch {
      return "exact"; // the font is not loaded yet
    }
    const lay = layoutOf(o);
    const upm = font.unitsPerEm;
    let inside = false;
    for (const line of lay.lines) {
      const c = (o.size * line.scale) / upm;
      const mg = m + 0.004 * o.size * line.scale; // flattening error of the curves
      if (ly < (line.top - 0.3) * o.size - mg || ly > (line.bottom + 0.3) * o.size + mg) continue;
      for (const g of line.glyphs) {
        if (g.cp === 32) continue;
        if (lx < (g.x - 0.3) * o.size - mg || lx > (g.x + g.adv * line.scale + 0.3) * o.size + mg) continue;
        if (!g.gid) return "exact"; // a character the bundled font lacks (drawn by the system font): no outline to test
        const shifts = g.bold ? [0, BOLD_SHIFT_EM * line.scale] : [0];
        for (const sh of shifts) {
          const ox = (g.x + sh) * o.size;
          const oy = line.baseline * o.size;
          const X = (fx: number, fy: number): number => ox + (g.italic ? fx + fy * SKEW : fx) * c;
          const Y = (fy: number): number => oy - fy * c;
          let winding = 0;
          let dist = Infinity;
          const edge = (ax: number, ay: number, bx: number, by: number): void => {
            dist = Math.min(dist, distToSegment(lx, ly, ax, ay, bx, by));
            const side = (bx - ax) * (ly - ay) - (lx - ax) * (by - ay);
            if (ay <= ly) {
              if (by > ly && side > 0) winding++;
            } else if (by <= ly && side < 0) winding--;
          };
          for (const contour of font.glyph(g.gid).contours) {
            let px = 0;
            let py = 0;
            contour.forEach((s, k) => {
              if (k === 0) {
                px = X(s[0]!, s[1]!);
                py = Y(s[1]!);
              }
              if (s.length === 4) {
                const qx = X(s[2]!, s[3]!);
                const qy = Y(s[3]!);
                edge(px, py, qx, qy);
                px = qx;
                py = qy;
              } else {
                const cx = X(s[2]!, s[3]!);
                const cy = Y(s[3]!);
                const ex = X(s[4]!, s[5]!);
                const ey = Y(s[5]!);
                let ax = px;
                let ay = py;
                for (let n = 1; n <= FLATTEN; n++) {
                  const t = n / FLATTEN;
                  const bx = (1 - t) * (1 - t) * px + 2 * (1 - t) * t * cx + t * t * ex;
                  const by = (1 - t) * (1 - t) * py + 2 * (1 - t) * t * cy + t * t * ey;
                  edge(ax, ay, bx, by);
                  ax = bx;
                  ay = by;
                }
                px = ex;
                py = ey;
              }
            });
          }
          if (dist <= mg) return "exact"; // an outline is within the margin: the sides cannot be told apart
          if (winding !== 0) inside = true;
        }
      }
    }
    return inside ? { color: o.color } : "miss";
  },
  approx: (o) => ({ color: o.color }),
};

/**
 * The default for a kind with nothing better: inside its bounds (away from
 * their edges) it covers the view with its colour; near an edge the exact
 * path decides. Use it for a new kind until it has a real sampler.
 */
export function bboxSampler<T extends CanvasObject>(colour: (o: T) => string): CoarseSampler<T> {
  return {
    classify(o, { lx, ly, m }) {
      const b = localBounds(o);
      return lx > b.minX + m && lx < b.maxX - m && ly > b.minY + m && ly < b.maxY - m ? { color: colour(o) } : "exact";
    },
    approx: (o) => ({ color: colour(o) }),
  };
}

/** One sampler per kind of object. The mapped type makes a new kind a compile error until it has one. */
export const SAMPLERS: { [K in CanvasObject["kind"]]: CoarseSampler<Extract<CanvasObject, { kind: K }>> } = {
  stroke: strokeSampler,
  image: imageSampler,
  text: textSampler,
  path: pathSampler,
};
