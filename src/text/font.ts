/**
 * Minimal TrueType (glyf) reader: metrics, character map and quadratic
 * outlines. Enough to lay out text without the browser and to draw exact
 * glyph outlines at any magnification (see render/draw-text.ts).
 *
 * Coordinates are font units (y up). On-curve points and the implied
 * midpoints between off-curve points are integers or halves, and composite
 * scales are 2.14 fixed point, so every outline coordinate is an exact dyadic.
 */

/** One outline piece: a line [x0, y0, x1, y1] or a quadratic [x0, y0, cx, cy, x1, y1]. */
export type Segment = readonly number[];
export type Contour = readonly Segment[];

export interface Glyph {
  readonly advance: number;
  readonly contours: readonly Contour[];
  /** Outline bounds in font units (all 0 for an empty glyph). */
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

export interface Font {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  /** Glyph id for a code point, or 0 (.notdef) when the font lacks it. */
  glyphId(cp: number): number;
  glyph(gid: number): Glyph;
}

export class FontError extends Error {}

export function parseFont(bytes: Uint8Array): Font {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  const n = v.getUint16(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + 16 * i;
    tables.set(String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)), v.getUint32(o + 8));
  }
  const table = (tag: string): number => {
    const o = tables.get(tag);
    if (o === undefined) throw new FontError(`font has no ${tag} table`);
    return o;
  };
  const head = table("head");
  const hhea = table("hhea");
  const hmtx = table("hmtx");
  const loca = table("loca");
  const glyf = table("glyf");
  const numGlyphs = v.getUint16(table("maxp") + 4);
  const numHMetrics = v.getUint16(hhea + 34);
  const longLoca = v.getInt16(head + 50) === 1;
  const cmap = readCmap(v, table("cmap"));

  const advance = (gid: number): number => v.getUint16(hmtx + 4 * Math.min(gid, numHMetrics - 1));
  const offset = (gid: number): number => (longLoca ? v.getUint32(loca + 4 * gid) : 2 * v.getUint16(loca + 2 * gid));

  const outline = (gid: number, depth: number): Contour[] => {
    if (gid >= numGlyphs || depth > 8) return [];
    const start = offset(gid);
    if (offset(gid + 1) === start) return [];
    const g = glyf + start;
    const nc = v.getInt16(g);
    return nc >= 0 ? simpleOutline(v, g, nc) : compositeOutline(v, g + 10, (c) => outline(c, depth + 1));
  };

  const cache = new Map<number, Glyph>();
  return {
    unitsPerEm: v.getUint16(head + 18),
    ascender: v.getInt16(hhea + 4),
    descender: v.getInt16(hhea + 6),
    lineGap: v.getInt16(hhea + 8),
    glyphId: (cp) => cmap(cp),
    glyph: (gid) => {
      let gl = cache.get(gid);
      if (!gl) {
        const contours = outline(gid, 0);
        let xMin = Infinity;
        let yMin = Infinity;
        let xMax = -Infinity;
        let yMax = -Infinity;
        for (const c of contours) {
          for (const s of c) {
            for (let i = 0; i < s.length; i += 2) {
              xMin = Math.min(xMin, s[i]!);
              xMax = Math.max(xMax, s[i]!);
              yMin = Math.min(yMin, s[i + 1]!);
              yMax = Math.max(yMax, s[i + 1]!);
            }
          }
        }
        if (!contours.length) xMin = yMin = xMax = yMax = 0;
        gl = { advance: advance(gid), contours, xMin, yMin, xMax, yMax };
        cache.set(gid, gl);
      }
      return gl;
    },
  };
}

/** Code point → glyph id, from a format 12 (preferred) or format 4 Unicode subtable. */
function readCmap(v: DataView, cmap: number): (cp: number) => number {
  let f4 = -1;
  let f12 = -1;
  const n = v.getUint16(cmap + 2);
  for (let i = 0; i < n; i++) {
    const o = cmap + 4 + 8 * i;
    const platform = v.getUint16(o);
    const sub = cmap + v.getUint32(o + 4);
    const unicode = platform === 0 || (platform === 3 && (v.getUint16(o + 2) === 1 || v.getUint16(o + 2) === 10));
    if (!unicode) continue;
    const format = v.getUint16(sub);
    if (format === 12) f12 = sub;
    else if (format === 4) f4 = sub;
  }
  if (f12 >= 0) {
    const groups = v.getUint32(f12 + 12);
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = f12 + 16 + 12 * mid;
        if (cp < v.getUint32(g)) hi = mid - 1;
        else if (cp > v.getUint32(g + 4)) lo = mid + 1;
        else return v.getUint32(g + 8) + cp - v.getUint32(g);
      }
      return 0;
    };
  }
  if (f4 < 0) throw new FontError("font has no Unicode character map");
  const segX2 = v.getUint16(f4 + 6);
  const ends = f4 + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segX2; i += 2) {
      if (cp > v.getUint16(ends + i)) continue;
      const s = v.getUint16(starts + i);
      if (cp < s) return 0;
      const ro = v.getUint16(ranges + i);
      if (ro === 0) return (cp + v.getUint16(deltas + i)) & 0xffff;
      const gid = v.getUint16(ranges + i + ro + 2 * (cp - s));
      return gid === 0 ? 0 : (gid + v.getUint16(deltas + i)) & 0xffff;
    }
    return 0;
  };
}

function simpleOutline(v: DataView, g: number, nc: number): Contour[] {
  const endPts: number[] = [];
  for (let i = 0; i < nc; i++) endPts.push(v.getUint16(g + 10 + 2 * i));
  const np = nc ? endPts[nc - 1]! + 1 : 0;
  let p = g + 10 + 2 * nc;
  p += 2 + v.getUint16(p); // skip instructions
  const flags: number[] = [];
  while (flags.length < np) {
    const f = v.getUint8(p++);
    flags.push(f);
    if (f & 8) for (let r = v.getUint8(p++); r > 0; r--) flags.push(f);
  }
  const coords = (short: number, same: number): number[] => {
    const out: number[] = [];
    let c = 0;
    for (const f of flags) {
      if (f & short) {
        const d = v.getUint8(p++);
        c += f & same ? d : -d;
      } else if (!(f & same)) {
        c += v.getInt16(p);
        p += 2;
      }
      out.push(c);
    }
    return out;
  };
  const xs = coords(2, 16);
  const ys = coords(4, 32);
  const contours: Contour[] = [];
  let first = 0;
  for (const last of endPts) {
    const pts: Array<[number, number, boolean]> = [];
    for (let i = first; i <= last; i++) pts.push([xs[i]!, ys[i]!, (flags[i]! & 1) === 1]);
    first = last + 1;
    if (pts.length) contours.push(quadContour(pts));
  }
  return contours;
}

/** On/off-curve points → closed list of lines and quadratics (implied on-curve midpoints made explicit). */
function quadContour(pts: Array<[number, number, boolean]>): Contour {
  const n = pts.length;
  // Start at an on-curve point (or the midpoint of the first two off-curve points).
  let s = pts.findIndex((q) => q[2]);
  let start: [number, number];
  if (s < 0) {
    start = [(pts[0]![0] + pts[1 % n]![0]) / 2, (pts[0]![1] + pts[1 % n]![1]) / 2];
    s = 0;
    pts = [...pts.slice(1), pts[0]!];
  } else {
    start = [pts[s]![0], pts[s]![1]];
    pts = [...pts.slice(s + 1), ...pts.slice(0, s + 1)];
  }
  const segs: Segment[] = [];
  let [x, y] = start;
  let ctrl: [number, number] | null = null;
  for (const [px, py, on] of pts) {
    if (on) {
      segs.push(ctrl ? [x, y, ctrl[0], ctrl[1], px, py] : [x, y, px, py]);
      ctrl = null;
      x = px;
      y = py;
    } else if (ctrl) {
      const mx = (ctrl[0] + px) / 2;
      const my = (ctrl[1] + py) / 2;
      segs.push([x, y, ctrl[0], ctrl[1], mx, my]);
      x = mx;
      y = my;
      ctrl = [px, py];
    } else {
      ctrl = [px, py];
    }
  }
  if (ctrl) segs.push([x, y, ctrl[0], ctrl[1], start[0], start[1]]);
  else if (x !== start[0] || y !== start[1]) segs.push([x, y, start[0], start[1]]);
  return segs;
}

function compositeOutline(v: DataView, p: number, child: (gid: number) => Contour[]): Contour[] {
  const out: Contour[] = [];
  const f2dot14 = (o: number): number => v.getInt16(o) / 16384;
  for (;;) {
    const flags = v.getUint16(p);
    const gid = v.getUint16(p + 2);
    p += 4;
    let dx: number;
    let dy: number;
    if (flags & 1) {
      dx = v.getInt16(p);
      dy = v.getInt16(p + 2);
      p += 4;
    } else {
      dx = v.getInt8(p);
      dy = v.getInt8(p + 1);
      p += 2;
    }
    // Point-matched placement (flag 2 clear) is not used by the bundled font; treat as no offset.
    if (!(flags & 2)) dx = dy = 0;
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    if (flags & 8) {
      a = d = f2dot14(p);
      p += 2;
    } else if (flags & 0x40) {
      a = f2dot14(p);
      d = f2dot14(p + 2);
      p += 4;
    } else if (flags & 0x80) {
      a = f2dot14(p);
      b = f2dot14(p + 2);
      c = f2dot14(p + 4);
      d = f2dot14(p + 6);
      p += 8;
    }
    for (const contour of child(gid)) {
      out.push(
        contour.map((s) => {
          const t: number[] = [];
          for (let i = 0; i < s.length; i += 2) t.push(a * s[i]! + c * s[i + 1]! + dx, b * s[i]! + d * s[i + 1]! + dy);
          return t;
        }),
      );
    }
    if (!(flags & 0x20)) break;
  }
  return out;
}
