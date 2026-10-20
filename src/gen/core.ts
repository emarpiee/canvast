/**
 * The few shapes this folder shares with the app it was made in (canvast): a sub-path of Bézier nodes, a paint, and a colour parser. They are
 * written out here, in the same form, so that `src/gen` imports nothing from outside its folder and can be built and shipped alone (README.md,
 * `scripts/check-patterns.mjs`). The app's own types accept these as they are (they are the same shapes).
 */

/** A sub-path: nodes of six numbers each, `[x, y, inX, inY, outX, outY, ...]` (a handle equal to its point is no handle), open or closed. */
export interface SubPath {
  readonly n: readonly number[];
  readonly closed: boolean;
}

export interface GradientStop {
  readonly o: number;
  readonly c: string;
}

/** Positions are fractions of the shape's own box (0, 0 is its top left, 1, 1 its bottom right); a radius is a fraction of the box's longer side. */
export type Gradient =
  | { readonly type: "linear"; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly stops: readonly GradientStop[] }
  | { readonly type: "radial"; readonly cx: number; readonly cy: number; readonly r: number; readonly stops: readonly GradientStop[] };

/** A colour, "#rrggbb" or "#rrggbbaa", or a gradient. */
export type Paint = string | Gradient;

export const NODE = 6;

/** A node with no handles: a corner of straight lines. */
export const corner = (x: number, y: number): number[] => [x, y, x, y, x, y];

/** A smooth node: handles `hx, hy` away along the tangent (the in handle is the mirror of the out handle). */
export const smooth = (x: number, y: number, hx: number, hy: number): number[] => [x, y, x - hx, y - hy, x + hx, y + hy];

/** Whether the segment from node `i` to node `j` of the sub-path is a straight line (neither end has a handle). */
export function isLine(n: ArrayLike<number>, i: number, j: number): boolean {
  const a = i * NODE, b = j * NODE;
  return n[a] === n[a + 4] && n[a + 1] === n[a + 5] && n[b] === n[b + 2] && n[b + 1] === n[b + 3];
}

/** The node pairs (a, b) a sub-path draws, in order; a closed one ends with the segment back to the first node. */
export function* segmentsOf(s: SubPath): Generator<[number, number]> {
  const c = s.n.length / NODE;
  for (let i = 0; i + 1 < c; i++) yield [i, i + 1];
  if (s.closed && c > 1) yield [c - 1, 0];
}

/** [r, g, b, a] of "#rrggbb" or "#rrggbbaa": bytes and an alpha of 0 to 1. */
export function rgbaOf(c: string): readonly [number, number, number, number] {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, c.length > 7 ? parseInt(c.slice(7, 9), 16) / 255 : 1];
}
