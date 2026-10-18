/**
 * The regions that overlapping shapes cut the plane into (ADR 0145), as the Shape builder and Divide use them. Each region is where a
 * particular set of the shapes is, and nothing else: the shapes in the set intersected, the other shapes taken out. Pure: it works on
 * Boolean operands (doc/boolean.ts), so curves stay curves.
 */
import type { Region } from "./boolean";
import { booleanOp } from "./boolean";
import type { SubPath } from "./path";

export interface Face {
  /** The shapes (indices into the operands) this region lies inside. */
  readonly inside: readonly number[];
  /** Its outline: one loop, or several (separate pieces and holes). */
  readonly subs: readonly SubPath[];
}

/** Most shapes divided at once (every combination is a possible region: 2^n - 1). */
export const MAX_DIVIDE = 6;

/** Every non-empty region of the shapes; null when there are too many shapes or an outline could not be told apart from another (they graze each other). */
export function facesOf(regions: readonly Region[]): Face[] | null {
  const n = regions.length;
  if (n < 2 || n > MAX_DIVIDE) return null;
  const faces: Face[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const inside = regions.map((_, i) => i).filter((i) => mask & (1 << i));
    const outside = regions.map((_, i) => i).filter((i) => !(mask & (1 << i)));
    let cut: readonly SubPath[] | null = inside.length === 1 ? regions[inside[0]!]!.subs : booleanOp("intersect", inside.map((i) => regions[i]!));
    if (!cut) return null;
    if (!cut.length) continue;
    if (outside.length) {
      const others: readonly SubPath[] | null = outside.length === 1 ? regions[outside[0]!]!.subs : booleanOp("union", outside.map((i) => regions[i]!));
      if (!others) return null;
      if (others.length) {
        const a: Region = { subs: cut, evenodd: inside.length === 1 && regions[inside[0]!]!.evenodd };
        cut = booleanOp("subtract", [a, { subs: others, evenodd: outside.length === 1 && regions[outside[0]!]!.evenodd }]);
        if (!cut) return null;
      }
    }
    if (cut.length) faces.push({ inside, subs: cut });
  }
  return faces;
}
