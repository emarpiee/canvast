/**
 * Variable fonts (ADR 0132): the axes of `fvar` (with their names), the mapping of `avar`, the glyph variations of `gvar` (TrueType outlines,
 * with the interpolation of the points a tuple leaves alone), and the `ItemVariationStore` that `HVAR` (advance widths) and CFF2 (`blend`)
 * share. A position is a value for each axis in the axis's own units; it is made into normalised coordinates (−1 to 1, default 0) the way
 * the specification says, and every delta is weighted by the scalar of its region.
 */
export interface Axis {
  readonly tag: string;
  readonly name: string;
  readonly min: number;
  readonly def: number;
  readonly max: number;
}

const f2dot14 = (v: DataView, o: number): number => v.getInt16(o) / 16384;
const tagAt = (v: DataView, o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

/** The axes of a font and the names its `name` table gives them. */
export function readAxes(v: DataView, fvar: number, nameOf: (id: number) => string): Axis[] {
  const offset = v.getUint16(fvar + 4);
  const count = v.getUint16(fvar + 8);
  const size = v.getUint16(fvar + 10);
  const fx = (o: number): number => v.getInt32(o) / 65536;
  const out: Axis[] = [];
  for (let i = 0; i < count; i++) {
    const a = fvar + offset + i * size;
    const tag = tagAt(v, a);
    out.push({ tag, name: nameOf(v.getUint16(a + 18)) || tag, min: fx(a + 4), def: fx(a + 8), max: fx(a + 12) });
  }
  return out;
}

/** The piecewise mapping of each axis from `avar` (null: none). */
export function readAvar(v: DataView, avar: number, axisCount: number): Array<ReadonlyArray<readonly [number, number]>> | null {
  const maps: Array<Array<readonly [number, number]>> = [];
  let p = avar + 8;
  for (let a = 0; a < axisCount; a++) {
    const n = v.getUint16(p);
    p += 2;
    const m: Array<readonly [number, number]> = [];
    for (let i = 0; i < n; i++, p += 4) m.push([f2dot14(v, p), f2dot14(v, p + 2)]);
    maps.push(m);
  }
  return maps;
}

/** Normalised coordinates (−1 to 1) for values in axis units; an axis not given is at its default. */
export function normalise(axes: readonly Axis[], avar: ReturnType<typeof readAvar> | null, values: Readonly<Record<string, number>>): number[] {
  return axes.map((a, i) => {
    const raw = values[a.tag];
    const v = Math.min(a.max, Math.max(a.min, raw === undefined || !Number.isFinite(raw) ? a.def : raw));
    let n = v < a.def ? (a.def === a.min ? 0 : -(a.def - v) / (a.def - a.min)) : v > a.def ? (a.max === a.def ? 0 : (v - a.def) / (a.max - a.def)) : 0;
    const m = avar?.[i];
    if (m && m.length >= 2) {
      let k = 1;
      while (k < m.length - 1 && n > m[k]![0]) k++;
      const [x0, y0] = m[k - 1]!, [x1, y1] = m[k]!;
      n = x1 === x0 ? y0 : y0 + ((n - x0) * (y1 - y0)) / (x1 - x0);
    }
    return Math.max(-1, Math.min(1, n));
  });
}

// ---- ItemVariationStore ------------------------------------------------------------------------------------------------------------

export interface VarStore {
  /** The number of regions the data at `index` has (a CFF2 `blend` needs it to know how many deltas follow). */
  regionCount(index: number): number;
  /** The scalar of each region of the data at `index` at these coordinates. */
  scalars(index: number, coords: readonly number[]): number[];
  /** The delta of one item of the data at `outer`: the region-weighted sum. */
  delta(outer: number, inner: number, coords: readonly number[]): number;
}

export function readVarStore(v: DataView, at: number): VarStore {
  const regionList = at + v.getUint32(at + 2);
  const axisCount = v.getUint16(regionList);
  const regionCount = v.getUint16(regionList + 2);
  const dataCount = v.getUint16(at + 6);
  const regionScalar = (r: number, coords: readonly number[]): number => {
    let s = 1;
    for (let a = 0; a < axisCount; a++) {
      const o = regionList + 4 + (r * axisCount + a) * 6;
      const start = f2dot14(v, o), peak = f2dot14(v, o + 2), end = f2dot14(v, o + 4);
      const c = coords[a] ?? 0;
      if (peak === 0 || start > peak || peak > end || (start < 0 && end > 0 && peak !== 0)) continue;
      if (c === peak) continue;
      if (c <= start || c >= end) return 0;
      s *= c < peak ? (c - start) / (peak - start) : (end - c) / (end - peak);
    }
    return s;
  };
  const data = (i: number): { regions: number[]; items: number; words: number; long: boolean; at: number } | null => {
    if (i < 0 || i >= dataCount) return null;
    const o = at + v.getUint32(at + 8 + 4 * i);
    const itemCount = v.getUint16(o);
    const wd = v.getUint16(o + 2);
    const rc = v.getUint16(o + 4);
    const regions: number[] = [];
    for (let k = 0; k < rc; k++) regions.push(v.getUint16(o + 6 + 2 * k));
    return { regions, items: itemCount, words: wd & 0x7fff, long: (wd & 0x8000) !== 0, at: o + 6 + 2 * rc };
  };
  return {
    regionCount: (i) => data(i)?.regions.length ?? 0,
    scalars: (i, coords) => (data(i)?.regions ?? []).map((r) => (r < regionCount ? regionScalar(r, coords) : 0)),
    delta(outer, inner, coords) {
      const d = data(outer);
      if (!d || inner < 0 || inner >= d.items) return 0;
      const rc = d.regions.length;
      const w = d.long ? 4 : 2, n = d.long ? 2 : 1;
      const row = d.at + inner * (d.words * w + (rc - d.words) * n);
      let sum = 0;
      for (let k = 0; k < rc; k++) {
        const o = k < d.words ? row + k * w : row + d.words * w + (k - d.words) * n;
        const dv = k < d.words ? (d.long ? v.getInt32(o) : v.getInt16(o)) : d.long ? v.getInt16(o) : v.getInt8(o);
        if (dv) sum += dv * (d.regions[k]! < regionCount ? regionScalar(d.regions[k]!, coords) : 0);
      }
      return sum;
    },
  };
}

/** The advance width change of a glyph from `HVAR` (null: the table has no store). */
export function hvarAdvance(v: DataView, hvar: number, store: VarStore, gid: number, coords: readonly number[]): number {
  const mapOff = v.getUint32(hvar + 8);
  let outer = 0, inner = gid;
  if (mapOff) {
    const m = hvar + mapOff;
    const fmt = v.getUint8(m);
    const entryFormat = v.getUint8(m + 1);
    const count = fmt === 0 ? v.getUint16(m + 2) : v.getUint32(m + 2);
    const head = fmt === 0 ? 4 : 6;
    const size = ((entryFormat >> 4) & 3) + 1;
    const bits = (entryFormat & 15) + 1;
    const i = Math.min(gid, count - 1);
    let e = 0;
    for (let k = 0; k < size; k++) e = e * 256 + v.getUint8(m + head + i * size + k);
    outer = Math.floor(e / 2 ** bits);
    inner = e % 2 ** bits;
  }
  return store.delta(outer, inner, coords);
}

// ---- gvar ---------------------------------------------------------------------------------------------------------------------------

/** Where the glyph's own points are (for the interpolation of the points a tuple does not move): the end of each contour; none for a composite. */
export interface GlyphPoints {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly ends: readonly number[];
}

export interface Gvar {
  /** The change of every point (and the four phantom points after them) at these coordinates, or null when the glyph does not vary. */
  deltas(gid: number, coords: readonly number[], pts: GlyphPoints | null, pointCount: number): { dx: Float64Array; dy: Float64Array } | null;
}

export function readGvar(v: DataView, at: number): Gvar {
  const axisCount = v.getUint16(at + 4);
  const sharedCount = v.getUint16(at + 6);
  const sharedAt = at + v.getUint32(at + 8);
  const glyphCount = v.getUint16(at + 12);
  const long = (v.getUint16(at + 14) & 1) === 1;
  const arrayAt = at + v.getUint32(at + 16);
  const offsetAt = at + 20;
  const shared: number[][] = [];
  for (let i = 0; i < sharedCount; i++) shared.push(Array.from({ length: axisCount }, (_, a) => f2dot14(v, sharedAt + (i * axisCount + a) * 2)));
  const glyphOffset = (g: number): number => (long ? v.getUint32(offsetAt + 4 * g) : 2 * v.getUint16(offsetAt + 2 * g));

  /** Packed point numbers: returns the list (null = every point) and the position after it. */
  const points = (p: number): { list: number[] | null; p: number } => {
    let count = v.getUint8(p++);
    if (count & 0x80) count = ((count & 0x7f) << 8) | v.getUint8(p++);
    if (count === 0) return { list: null, p };
    const list: number[] = [];
    let last = 0;
    while (list.length < count) {
      const ctl = v.getUint8(p++);
      const run = (ctl & 0x7f) + 1;
      const words = (ctl & 0x80) !== 0;
      for (let k = 0; k < run && list.length < count; k++) {
        last += words ? v.getUint16(p) : v.getUint8(p);
        p += words ? 2 : 1;
        list.push(last);
      }
    }
    return { list, p };
  };
  const packedDeltas = (p: number, n: number): { d: number[]; p: number } => {
    const out: number[] = [];
    while (out.length < n) {
      const ctl = v.getUint8(p++);
      const run = (ctl & 0x3f) + 1;
      for (let k = 0; k < run && out.length < n; k++) {
        if (ctl & 0x80) out.push(0);
        else if (ctl & 0x40) { out.push(v.getInt16(p)); p += 2; }
        else out.push(v.getInt8(p++));
      }
    }
    return { d: out, p };
  };

  return {
    deltas(gid, coords, pts, pointCount) {
      if (gid < 0 || gid >= glyphCount) return null;
      const start = glyphOffset(gid), end = glyphOffset(gid + 1);
      if (end <= start) return null;
      const g = arrayAt + start;
      const tvc = v.getUint16(g);
      const count = tvc & 0x0fff;
      let hp = g + 4;
      let dataP = g + v.getUint16(g + 2);
      let sharedPoints: number[] | null | undefined;
      if (tvc & 0x8000) {
        const sp = points(dataP);
        sharedPoints = sp.list;
        dataP = sp.p;
      }
      const dx = new Float64Array(pointCount), dy = new Float64Array(pointCount);
      let any = false;
      for (let t = 0; t < count; t++) {
        const size = v.getUint16(hp);
        const idx = v.getUint16(hp + 2);
        hp += 4;
        let peak: number[];
        if (idx & 0x8000) {
          peak = Array.from({ length: axisCount }, (_, a) => f2dot14(v, hp + 2 * a));
          hp += 2 * axisCount;
        } else peak = shared[idx & 0x0fff] ?? new Array(axisCount).fill(0);
        let istart: number[] | null = null, iend: number[] | null = null;
        if (idx & 0x4000) {
          istart = Array.from({ length: axisCount }, (_, a) => f2dot14(v, hp + 2 * a));
          iend = Array.from({ length: axisCount }, (_, a) => f2dot14(v, hp + 2 * axisCount + 2 * a));
          hp += 4 * axisCount;
        }
        let scalar = 1;
        for (let a = 0; a < axisCount && scalar !== 0; a++) {
          const pk = peak[a]!, c = coords[a] ?? 0;
          if (pk === 0 || c === pk) continue;
          const s = istart ? istart[a]! : Math.min(0, pk), e = iend ? iend[a]! : Math.max(0, pk);
          if (c <= s || c >= e) scalar = 0;
          else scalar *= c < pk ? (c - s) / (pk - s) : (e - c) / (e - pk);
        }
        const tupleData = dataP;
        dataP += size;
        if (scalar === 0) continue;
        let p = tupleData;
        let list: number[] | null;
        if (idx & 0x2000) {
          const pp = points(p);
          list = pp.list;
          p = pp.p;
        } else list = sharedPoints ?? null;
        const n = list ? list.length : pointCount;
        const xd = packedDeltas(p, n);
        const yd = packedDeltas(xd.p, n);
        any = true;
        if (!list) {
          for (let i = 0; i < pointCount; i++) { dx[i]! += scalar * xd.d[i]!; dy[i]! += scalar * yd.d[i]!; }
          continue;
        }
        const tx = new Float64Array(pointCount), ty = new Float64Array(pointCount);
        const touched = new Uint8Array(pointCount);
        list.forEach((pi, k) => {
          if (pi < pointCount) { tx[pi] = xd.d[k]!; ty[pi] = yd.d[k]!; touched[pi] = 1; }
        });
        if (pts) interpolateUntouched(pts, touched, tx, ty);
        for (let i = 0; i < pointCount; i++) { dx[i]! += scalar * tx[i]!; dy[i]! += scalar * ty[i]!; }
      }
      return any ? { dx, dy } : null;
    },
  };
}

/** The deltas of the points a tuple does not name, interpolated along their contour between the nearest named ones (IUP). */
function interpolateUntouched(pts: GlyphPoints, touched: Uint8Array, dx: Float64Array, dy: Float64Array): void {
  let first = 0;
  for (const last of pts.ends) {
    iup(pts.xs, touched, dx, first, last);
    iup(pts.ys, touched, dy, first, last);
    first = last + 1;
  }
}

function iup(orig: readonly number[], touched: Uint8Array, delta: Float64Array, first: number, last: number): void {
  const idx: number[] = [];
  for (let i = first; i <= last; i++) if (touched[i]) idx.push(i);
  if (!idx.length) return;
  if (idx.length === 1) {
    for (let i = first; i <= last; i++) delta[i] = delta[idx[0]!]!;
    return;
  }
  const n = last - first + 1;
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k]!, b = idx[(k + 1) % idx.length]!;
    let c1 = orig[a]!, d1 = delta[a]!, c2 = orig[b]!, d2 = delta[b]!;
    for (let i = (a - first + 1) % n; i !== (b - first) % n; i = (i + 1) % n) {
      const p = first + i;
      const c = orig[p]!;
      if (c1 === c2) delta[p] = d1 === d2 ? d1 : 0;
      else {
        let lo = c1, dlo = d1, hi = c2, dhi = d2;
        if (lo > hi) { lo = c2; dlo = d2; hi = c1; dhi = d1; }
        delta[p] = c <= lo ? dlo : c >= hi ? dhi : dlo + ((c - lo) * (dhi - dlo)) / (hi - lo);
      }
    }
    void c1; void c2; void d1; void d2;
  }
}
