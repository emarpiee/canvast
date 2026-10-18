/**
 * PostScript (CFF and CFF2) outlines (ADR 0132): the Type 2 charstrings of an OpenType font with `CFF ` or `CFF2` read into the same lines
 * and quadratics the TrueType reader makes. A cubic Bézier is approximated by quadratics, split until the two are within a tenth of a
 * font unit, so everything downstream (drawing at any depth, outlines, picking) has one kind of curve to deal with. CFF2 (variable) is
 * read at the position of the axes it is given: its `blend` operators add the region-weighted deltas.
 */
import { FontError } from "./font";
import type { Contour, Segment } from "./font";
import { readVarStore } from "./variations";

export interface CffReader {
  glyphCount: number;
  /** The outline of a glyph at normalised axis coordinates (none: the default instance). */
  outline(gid: number, coords?: readonly number[]): Contour[];
}

interface Idx {
  count: number;
  at(i: number): Uint8Array;
}

const TOLERANCE = 0.1;

export function cffReader(table: Uint8Array, version: 1 | 2): CffReader {
  const v = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const bad = (): never => {
    throw new FontError("This font file is damaged.");
  };
  const index = (p: number): { idx: Idx; end: number } => {
    const count = version === 2 ? v.getUint32(p) : v.getUint16(p);
    const head = version === 2 ? 4 : 2;
    if (count === 0) return { idx: { count: 0, at: () => new Uint8Array(0) }, end: p + head };
    const offSize = v.getUint8(p + head);
    const offAt = (i: number): number => {
      let o = 0;
      for (let k = 0; k < offSize; k++) o = o * 256 + v.getUint8(p + head + 1 + i * offSize + k);
      return o;
    };
    const base = p + head + 1 + (count + 1) * offSize - 1;
    return { idx: { count, at: (i) => table.subarray(base + offAt(i), base + offAt(i + 1)) }, end: base + offAt(count) };
  };
  let vstore: ReturnType<typeof readVarStore> | null = null;
  const dict = (b: Uint8Array): Map<number, number[]> => {
    const out = new Map<number, number[]>();
    let ops: number[] = [];
    let dictVs = 0;
    for (let i = 0; i < b.length; ) {
      const b0 = b[i++]!;
      if (b0 === 22) {
        dictVs = ops.pop() ?? 0; // CFF2 vsindex (the data the blends below use)
        out.set(22, [dictVs]);
      }
      else if (b0 === 23) {
        // CFF2 blend in a dictionary: the default values are the ones used (the deltas are for other positions of the axes)
        const k = ops.pop() ?? 0;
        const R = vstore ? vstore.regionCount(dictVs) : 0;
        const base = ops.length - k * (R + 1);
        if (base >= 0) ops = [...ops.slice(0, base), ...ops.slice(base, base + k)];
      } else if (b0 <= 21 || b0 === 24) {
        const op = b0 === 12 ? 1200 + b[i++]! : b0;
        out.set(op, ops);
        ops = [];
      } else if (b0 === 28) {
        ops.push(((b[i]! << 8) | b[i + 1]!) << 16 >> 16);
        i += 2;
      } else if (b0 === 29) {
        ops.push((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
        i += 4;
      } else if (b0 === 30) {
        let s = "";
        for (let done = false; !done && i < b.length; ) {
          const byte = b[i++]!;
          for (const nib of [byte >> 4, byte & 15]) {
            if (nib === 15) { done = true; break; }
            s += nib < 10 ? String(nib) : nib === 10 ? "." : nib === 11 ? "E" : nib === 12 ? "E-" : nib === 14 ? "-" : "";
          }
        }
        ops.push(Number(s));
      } else if (b0 >= 32 && b0 <= 246) ops.push(b0 - 139);
      else if (b0 >= 247 && b0 <= 250) ops.push((b0 - 247) * 256 + b[i++]! + 108);
      else if (b0 >= 251 && b0 <= 254) ops.push(-(b0 - 251) * 256 - b[i++]! - 108);
      else i++;
    }
    return out;
  };

  let top: Map<number, number[]>;
  let globalSubrs: Idx;
  let charStrings: Idx;
  let privateOf: (gid: number) => { subrs: Idx | null; vsindex: number };
  if (version === 1) {
    const hdrSize = v.getUint8(2);
    const name = index(hdrSize);
    const topIdx = index(name.end);
    const strings = index(topIdx.end);
    globalSubrs = index(strings.end).idx;
    top = dict(topIdx.idx.at(0));
  } else {
    const hdrSize = v.getUint8(2);
    const topLen = v.getUint16(3);
    top = dict(table.subarray(hdrSize, hdrSize + topLen));
    globalSubrs = index(hdrSize + topLen).idx;
  }
  if (version === 2 && top.get(24)?.[0] !== undefined) vstore = readVarStore(v, top.get(24)![0]! + 2);
  const csOff = top.get(17)?.[0];
  if (csOff === undefined) bad();
  charStrings = index(csOff!).idx;
  const privateAt = (d: Map<number, number[]>): { subrs: Idx | null; vsindex: number } => {
    const pv = d.get(18);
    if (!pv || pv.length < 2) return { subrs: null, vsindex: 0 };
    const [size, off] = pv as [number, number];
    const pd = dict(table.subarray(off, off + size));
    const subrs = pd.get(19)?.[0];
    return { subrs: subrs === undefined ? null : index(off + subrs).idx, vsindex: pd.get(22)?.[0] ?? 0 };
  };
  const fdArray = top.get(1236)?.[0];
  if (fdArray !== undefined) {
    // a CID-keyed (or CFF2) font: one private dictionary per font dict, chosen per glyph
    const fds = index(fdArray).idx;
    const privs = Array.from({ length: fds.count }, (_, i) => privateAt(dict(fds.at(i))));
    const sel = top.get(1237)?.[0];
    const fdOf = ((): ((gid: number) => number) => {
      if (sel === undefined) return () => 0;
      const fmt = v.getUint8(sel);
      if (fmt === 0) return (g) => v.getUint8(sel + 1 + g);
      if (fmt === 3) {
        const n = v.getUint16(sel + 1);
        return (g) => {
          let lo = 0, hi = n - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (v.getUint16(sel + 3 + 3 * mid) <= g) lo = mid;
            else hi = mid - 1;
          }
          return v.getUint8(sel + 3 + 3 * lo + 2);
        };
      }
      if (fmt === 4) {
        const n = v.getUint32(sel + 1);
        return (g) => {
          let lo = 0, hi = n - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (v.getUint32(sel + 5 + 6 * mid) <= g) lo = mid;
            else hi = mid - 1;
          }
          return v.getUint16(sel + 5 + 6 * lo + 4);
        };
      }
      return bad();
    })();
    privateOf = (g) => privs[fdOf(g)] ?? privs[0] ?? { subrs: null, vsindex: 0 };
  } else {
    const p = privateAt(top);
    privateOf = () => p;
  }
  const bias = (n: number): number => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

  const outline = (gid: number, coords?: readonly number[]): Contour[] => {
    if (gid < 0 || gid >= charStrings.count) return [];
    const priv = privateOf(gid);
    const contours: Contour[] = [];
    let cur: Segment[] = [];
    let x = 0, y = 0, sx = 0, sy = 0;
    let open = false;
    const stack: number[] = [];
    let stems = 0;
    let widthSeen = version === 2;
    let vsindex = priv.vsindex;
    let ended = false;
    const close = (): void => {
      if (open) {
        if (x !== sx || y !== sy) cur.push([x, y, sx, sy]);
        if (cur.length) contours.push(cur);
      }
      cur = [];
      open = false;
    };
    const move = (dx: number, dy: number): void => {
      close();
      x += dx;
      y += dy;
      sx = x;
      sy = y;
      open = true;
    };
    const line = (dx: number, dy: number): void => {
      if (!open) move(0, 0);
      cur.push([x, y, x + dx, y + dy]);
      x += dx;
      y += dy;
    };
    const curve = (d1x: number, d1y: number, d2x: number, d2y: number, d3x: number, d3y: number): void => {
      if (!open) move(0, 0);
      const c1x = x + d1x, c1y = y + d1y, c2x = c1x + d2x, c2y = c1y + d2y, ex = c2x + d3x, ey = c2y + d3y;
      cubicToQuads(x, y, c1x, c1y, c2x, c2y, ex, ey, cur);
      x = ex;
      y = ey;
    };
    const widthArg = (expected: number | ((n: number) => boolean)): void => {
      // The first stack-clearing operator of a version 1 charstring may carry the glyph's width first: it is not a coordinate.
      if (widthSeen) return;
      widthSeen = true;
      const has = typeof expected === "number" ? stack.length > expected : expected(stack.length);
      if (has) stack.shift();
    };
    const run = (cs: Uint8Array, depth: number): void => {
      if (depth > 10) bad();
      for (let i = 0; i < cs.length && !ended; ) {
        const b0 = cs[i++]!;
        if (b0 >= 32 || b0 === 28) {
          if (b0 === 28) { stack.push(((cs[i]! << 8) | cs[i + 1]!) << 16 >> 16); i += 2; }
          else if (b0 <= 246) stack.push(b0 - 139);
          else if (b0 <= 250) stack.push((b0 - 247) * 256 + cs[i++]! + 108);
          else if (b0 <= 254) stack.push(-(b0 - 251) * 256 - cs[i++]! - 108);
          else { stack.push(((cs[i]! << 24) | (cs[i + 1]! << 16) | (cs[i + 2]! << 8) | cs[i + 3]!) / 65536); i += 4; }
          continue;
        }
        const s = stack;
        switch (b0) {
          case 1: case 3: case 18: case 23: // stems
            widthSeen || widthArg((n) => n % 2 === 1);
            stems += s.length >> 1;
            s.length = 0;
            break;
          case 19: case 20: // hintmask, cntrmask (an implied vstem comes first)
            widthSeen || widthArg((n) => n % 2 === 1);
            stems += s.length >> 1;
            s.length = 0;
            i += (stems + 7) >> 3;
            break;
          case 21: widthArg(2); move(s[0] ?? 0, s[1] ?? 0); s.length = 0; break;
          case 22: widthArg(1); move(s[0] ?? 0, 0); s.length = 0; break;
          case 4: widthArg(1); move(0, s[0] ?? 0); s.length = 0; break;
          case 5: for (let k = 0; k + 1 < s.length; k += 2) line(s[k]!, s[k + 1]!); s.length = 0; break;
          case 6: case 7: {
            let horiz = b0 === 6;
            for (const d of s) { line(horiz ? d : 0, horiz ? 0 : d); horiz = !horiz; }
            s.length = 0;
            break;
          }
          case 8: for (let k = 0; k + 5 < s.length; k += 6) curve(s[k]!, s[k + 1]!, s[k + 2]!, s[k + 3]!, s[k + 4]!, s[k + 5]!); s.length = 0; break;
          case 24: { // rcurveline
            let k = 0;
            for (; k + 7 < s.length; k += 6) curve(s[k]!, s[k + 1]!, s[k + 2]!, s[k + 3]!, s[k + 4]!, s[k + 5]!);
            line(s[k]!, s[k + 1]!);
            s.length = 0;
            break;
          }
          case 25: { // rlinecurve
            let k = 0;
            for (; k + 7 < s.length; k += 2) line(s[k]!, s[k + 1]!);
            curve(s[k]!, s[k + 1]!, s[k + 2]!, s[k + 3]!, s[k + 4]!, s[k + 5]!);
            s.length = 0;
            break;
          }
          case 26: { // vvcurveto
            let k = 0;
            let dx1 = 0;
            if (s.length % 4 === 1) dx1 = s[k++]!;
            for (; k + 3 < s.length; k += 4) { curve(dx1, s[k]!, s[k + 1]!, s[k + 2]!, 0, s[k + 3]!); dx1 = 0; }
            s.length = 0;
            break;
          }
          case 27: { // hhcurveto
            let k = 0;
            let dy1 = 0;
            if (s.length % 4 === 1) dy1 = s[k++]!;
            for (; k + 3 < s.length; k += 4) { curve(s[k]!, dy1, s[k + 1]!, s[k + 2]!, s[k + 3]!, 0); dy1 = 0; }
            s.length = 0;
            break;
          }
          case 30: case 31: { // vhcurveto, hvcurveto: alternate the direction every curve
            let horiz = b0 === 31;
            for (let k = 0; k + 3 < s.length; k += 4) {
              const last = s.length - k === 5 ? s[k + 4]! : 0;
              if (horiz) curve(s[k]!, 0, s[k + 1]!, s[k + 2]!, last, s[k + 3]!);
              else curve(0, s[k]!, s[k + 1]!, s[k + 2]!, s[k + 3]!, last);
              horiz = !horiz;
            }
            s.length = 0;
            break;
          }
          case 10: case 29: { // callsubr, callgsubr
            const list = b0 === 10 ? priv.subrs : globalSubrs;
            const n = (s.pop() ?? 0) + (list ? bias(list.count) : 0);
            if (!list || n < 0 || n >= list.count) bad();
            run(list!.at(n), depth + 1);
            break;
          }
          case 11: return;
          case 14: // endchar
            if (version === 1) widthArg((n) => n === 1 || n === 5);
            close();
            ended = true;
            break;
          case 15: vsindex = s.pop() ?? 0; break; // CFF2 vsindex
          case 16: { // CFF2 blend: n defaults, then n × regions deltas
            const n = s.pop() ?? 0;
            const R = vstore ? vstore.regionCount(vsindex) : 0;
            const sc = vstore && coords ? vstore.scalars(vsindex, coords) : [];
            const base = s.length - n * (R + 1);
            if (base < 0) bad();
            for (let k = 0; k < n; k++) {
              let val = s[base + k]!;
              for (let r = 0; r < R; r++) val += (sc[r] ?? 0) * s[base + n + k * R + r]!;
              s[base + k] = val;
            }
            s.length = base + n;
            break;
          }
          case 12: {
            const op = cs[i++]!;
            if (op === 35) { // flex
              curve(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!);
              curve(s[6]!, s[7]!, s[8]!, s[9]!, s[10]!, s[11]!);
            } else if (op === 34) { // hflex
              curve(s[0]!, 0, s[1]!, s[2]!, s[3]!, 0);
              curve(s[4]!, 0, s[5]!, -s[2]!, s[6]!, 0);
            } else if (op === 36) { // hflex1
              curve(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, 0);
              curve(s[5]!, 0, s[6]!, s[7]!, s[8]!, -(s[1]! + s[3]! + s[7]!));
            } else if (op === 37) { // flex1
              const dx = s[0]! + s[2]! + s[4]! + s[6]! + s[8]!, dy = s[1]! + s[3]! + s[5]! + s[7]! + s[9]!;
              curve(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!);
              if (Math.abs(dx) > Math.abs(dy)) curve(s[6]!, s[7]!, s[8]!, s[9]!, s[10]!, -dy);
              else curve(s[6]!, s[7]!, s[8]!, s[9]!, -dx, s[10]!);
            }
            s.length = 0;
            break;
          }
          default: // hints and anything else clear the stack
            s.length = 0;
        }
      }
    };
    run(charStrings.at(gid), 0);
    close();
    return contours;
  };
  return { glyphCount: charStrings.count, outline };
}

/** A cubic as one or more quadratics (appended to `out`), split in the middle until each is within TOLERANCE of the cubic. */
function cubicToQuads(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, out: Segment[], depth = 0): void {
  // the quadratic whose control point is the average of the two cubic handle extensions
  const qx = (3 * (x1 + x2) - (x0 + x3)) / 4;
  const qy = (3 * (y1 + y2) - (y0 + y3)) / 4;
  // the cubic and the quadratic differ most near the middle: compare there and at the quarters
  const err = (t: number): number => {
    const u = 1 - t;
    const cx = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const cy = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    const px = u * u * x0 + 2 * u * t * qx + t * t * x3;
    const py = u * u * y0 + 2 * u * t * qy + t * t * y3;
    return Math.hypot(cx - px, cy - py);
  };
  if (depth >= 6 || Math.max(err(0.25), err(0.5), err(0.75)) <= TOLERANCE) {
    out.push([x0, y0, qx, qy, x3, y3]);
    return;
  }
  const m = (a: number, b: number): number => (a + b) / 2;
  const x01 = m(x0, x1), y01 = m(y0, y1), x12 = m(x1, x2), y12 = m(y1, y2), x23 = m(x2, x3), y23 = m(y2, y3);
  const xa = m(x01, x12), ya = m(y01, y12), xb = m(x12, x23), yb = m(y12, y23);
  const xm = m(xa, xb), ym = m(ya, yb);
  cubicToQuads(x0, y0, x01, y01, xa, ya, xm, ym, out, depth + 1);
  cubicToQuads(xm, ym, xb, yb, x23, y23, x3, y3, out, depth + 1);
}
