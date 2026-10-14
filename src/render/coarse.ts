import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { TermSum } from "../core/frames";
import { termsAdd, termsLead, termsScale, termsShift } from "../core/frames";
import type { CanvasObject, ImageObject, StrokeObject, TextObject } from "../doc/model";
import { localBounds } from "../doc/model";
import { layoutText, textFont } from "../text/layout";
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
  return sampler.classify(o, { lx, ly, m, vp, info, terms });
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
  return { ...sampler.approx(o, { lx, ly, m: 0, vp, info, terms: () => null }), dim: true };
}

// ---- samplers ---------------------------------------------------------------

const strokeSampler: CoarseSampler<StrokeObject> = {
  classify(o, { lx, ly, m }) {
    const p = o.points;
    let d = Infinity;
    if (p.length === 2) d = Math.hypot(lx - p[0]!, ly - p[1]!);
    else for (let i = 0; i + 3 < p.length; i += 2) d = Math.min(d, distToSegment(lx, ly, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!));
    const s = d - o.width / 2; // signed distance to the outline: > 0 outside
    return s > m ? "miss" : s < -m ? { color: o.color } : "exact";
  },
  approx: (o) => ({ color: o.color }),
};

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
    const u = (lx * o.pixelW) / o.w;
    const v = (ly * o.pixelH) / o.h;
    const mu = (m * o.pixelW) / o.w + u * ROUND;
    const mv = (m * o.pixelH) / o.h + v * ROUND;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const away = lx >= m && lx <= o.w - m && ly >= m && ly <= o.h - m && u - i >= mu && i + 1 - u >= mu && v - j >= mv && j + 1 - v >= mv;
    if (away) return { rects: [{ x0: 0, y0: 0, x1: vp.width, y1: vp.height, i, j }] };
    // A pixel boundary (or the image's own edge) is within the view: place it from exact term sums of the centre.
    const t = terms();
    if (!t) return "exact";
    const unit = o.unit;
    const local = (s: TermSum, anchor: D.Dyadic): TermSum => termsAdd(termsShift(s, -unit), D.neg(D.shift(anchor, -unit)));
    const hx = vp.width / 2 + 2;
    const hy = vp.height / 2 + 2;
    const xs = axisRuns(local(t.x, o.anchor.x), o.pixelW, o.w, lx, unit, info.zTrue, hx);
    const ys = axisRuns(local(t.y, o.anchor.y), o.pixelH, o.h, ly, unit, info.zTrue, hy);
    const rects: PixelRect[] = [];
    for (const yr of ys) {
      for (const xr of xs) {
        rects.push({
          x0: vp.width / 2 + Math.max(xr.lo, -hx),
          x1: vp.width / 2 + Math.min(xr.hi, hx),
          y0: vp.height / 2 + Math.max(yr.lo, -hy),
          y1: vp.height / 2 + Math.min(yr.hi, hy),
          i: xr.index,
          j: yr.index,
        });
      }
    }
    return rects.length ? { rects } : "miss";
  },
  approx(o, { lx, ly, vp }) {
    const i = Math.min(o.pixelW - 1, Math.max(0, Math.floor((lx * o.pixelW) / o.w)));
    const j = Math.min(o.pixelH - 1, Math.max(0, Math.floor((ly * o.pixelH) / o.h)));
    return { rects: [{ x0: 0, y0: 0, x1: vp.width, y1: vp.height, i, j }] };
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
      font = textFont();
    } catch {
      return "exact"; // the font is not loaded yet
    }
    const lay = layoutText(o.md, o.w / o.size);
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
};
