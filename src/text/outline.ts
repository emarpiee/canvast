import { cosSin } from "../core/angle";
import type { TextObject } from "../doc/model";
import { pivotOf } from "../doc/model";
import { booleanOp } from "../doc/boolean";
import type { SubPath } from "../doc/path";
import { rotateSubs } from "../doc/path";
import { BOLD_SHIFT_EM, SKEW } from "../render/draw-text";
import { layoutText, textFont } from "./layout";

/**
 * A text object as vector outlines (ADR 0102): every glyph of the layout (text/layout.ts) as closed sub-paths in the object's own local
 * units, placed exactly as drawText places them: the glyph's quadratic outlines scaled by the line's size, italic sheared by SKEW about
 * the baseline, bold the outline together with a copy shifted by BOLD_SHIFT_EM (here joined into one outline by a union, so it has
 * no edges inside it). A quadratic is a cubic with its handles two thirds of the way to the control point, which is exact, so the
 * outlines are the font's own at any zoom. The object's turn is baked into the points (its pivot was the middle of the text box, not
 * of the letters). Characters the bundled font lacks are drawn by the system font, have no outline to give, and are counted in `missing`.
 */
export interface TextOutline {
  readonly sub: SubPath[];
  readonly missing: number;
}

export function textOutline(o: TextObject): TextOutline {
  const f = textFont();
  const lay = layoutText(o.md, o.w / o.size, o.lineHeight, o.tracking);
  const subs: SubPath[] = [];
  let missing = 0;
  for (const line of lay.lines) {
    const c = (o.size * line.scale) / f.unitsPerEm;
    const oy = line.baseline * o.size;
    for (const g of line.glyphs) {
      if (g.cp === 32) continue;
      if (!g.gid) {
        missing++;
        continue;
      }
      const copy = (shiftEm: number): SubPath[] => {
        const ox = (g.x + shiftEm) * o.size;
        const X = (fx: number, fy: number): number => ox + (g.italic ? fx + fy * SKEW : fx) * c;
        const Y = (fy: number): number => oy - fy * c;
        const out: SubPath[] = [];
        for (const contour of f.glyph(g.gid).contours) {
          const n: number[] = [];
          contour.forEach((s, i) => {
            const x0 = X(s[0]!, s[1]!);
            const y0 = Y(s[1]!);
            let ox1 = x0, oy1 = y0;
            if (s.length === 6) {
              // a quadratic as a cubic: the handle at the start is two thirds of the way to the control point
              const cx = X(s[2]!, s[3]!), cy = Y(s[3]!);
              ox1 = x0 + (2 / 3) * (cx - x0);
              oy1 = y0 + (2 / 3) * (cy - y0);
            }
            // the handle coming into this node belongs to the segment before it (the contour closes on itself)
            const prev = contour[(i - 1 + contour.length) % contour.length]!;
            let ix = x0, iy = y0;
            if (prev.length === 6) {
              const cx = X(prev[2]!, prev[3]!), cy = Y(prev[3]!);
              ix = x0 + (2 / 3) * (cx - x0);
              iy = y0 + (2 / 3) * (cy - y0);
            }
            n.push(x0, y0, ix, iy, ox1, oy1);
          });
          if (n.length >= 18) out.push({ n, closed: true });
        }
        return out;
      };
      if (!g.bold) {
        subs.push(...copy(0));
        continue;
      }
      // bold: the outline and a copy shifted right, as one outline
      const joined = booleanOp("union", [{ subs: copy(0), evenodd: false }, { subs: copy(BOLD_SHIFT_EM * line.scale), evenodd: false }]);
      subs.push(...(joined && joined.length ? joined : [...copy(0), ...copy(BOLD_SHIFT_EM * line.scale)]));
    }
  }
  if (!o.rot) return { sub: subs, missing };
  const { x, y } = pivotOf(o);
  const { c, s } = cosSin(o.rot);
  return { sub: rotateSubs(subs, x, y, c, s), missing };
}
