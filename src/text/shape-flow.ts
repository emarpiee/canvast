import { NODE } from "../doc/path";

/** A closed outline words flow inside (nodes of six numbers, local units of the text, its box starting at 0, 0). */
export interface ShapeOutline {
  readonly n: readonly number[];
  readonly closed: boolean;
  readonly padX?: number;
  readonly padY?: number;
  readonly hide?: boolean;
}
/** Where a line may run inside a shape, in em. */
export interface Flow {
  readonly key: string;
  /** Height of the shape in em. */
  readonly height: number;
  /** Words that do not fit are left out. */
  readonly hide: boolean;
  /** The widest stretch inside the shape over the whole of a line's height, or null when no line fits there. */
  span(top: number, bottom: number): { x0: number; x1: number } | null;
}

const STEPS = 24;
/** Space kept between the words and the outline, and the narrowest stretch worth a line, in em. */
const INSET = 0.4;
const NARROWEST = 2;

const polygons = new WeakMap<readonly number[], Float64Array>();
function polygon(n: readonly number[]): Float64Array {
  let p = polygons.get(n);
  if (p) return p;
  const count = n.length / NODE;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * NODE, b = ((i + 1) % count) * NODE;
    const x0 = n[a]!, y0 = n[a + 1]!, x1 = n[a + 4]!, y1 = n[a + 5]!, x2 = n[b + 2]!, y2 = n[b + 3]!, x3 = n[b]!, y3 = n[b + 1]!;
    const straight = x1 === x0 && y1 === y0 && x2 === x3 && y2 === y3;
    for (let k = 0; k < (straight ? 1 : STEPS); k++) {
      const t = straight ? 0 : k / STEPS, u = 1 - t;
      out.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
  }
  polygons.set(n, (p = Float64Array.from(out)));
  return p;
}

/** The box of an outline as drawn (its curves followed, not their handles). */
export function outlineBox(n: readonly number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const p = polygon(n);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]!); maxX = Math.max(maxX, p[i]!);
    minY = Math.min(minY, p[i + 1]!); maxY = Math.max(maxY, p[i + 1]!);
  }
  return { minX, minY, maxX, maxY };
}

/** The widest stretch inside the polygon at height y (even-odd), or null. */
function across(p: Float64Array, y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const y0 = p[j + 1]!, y1 = p[i + 1]!;
    if (y0 <= y !== y1 <= y) xs.push(p[j]! + ((y - y0) / (y1 - y0)) * (p[i]! - p[j]!));
  }
  xs.sort((a, b) => a - b);
  let best: [number, number] | null = null;
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1]! - xs[i]! > best[1] - best[0]) best = [xs[i]!, xs[i + 1]!];
  return best;
}

const keys = new WeakMap<readonly number[], string>();

export function flowOf(shape: ShapeOutline, size: number): Flow {
  const padX = shape.padX ?? INSET, padY = shape.padY ?? 0, hide = shape.hide === true;
  const p = polygon(shape.n);
  let key = keys.get(shape.n);
  if (key === undefined) {
    // (a short fingerprint, worked out once per outline: this key is built for every layout, and an outline is thousands of numbers)
    let h1 = 0x811c9dc5, h2 = 0x1b873593;
    for (const v of shape.n) {
      const x = Math.round(v * 4096) | 0;
      h1 = Math.imul(h1 ^ x, 16777619);
      h2 = Math.imul(h2 ^ (x >>> 3), 2654435761);
    }
    keys.set(shape.n, (key = `${shape.n.length}:${h1 >>> 0}:${h2 >>> 0}`));
  }
  return {
    key: `${size}|${padX}|${padY}|${hide}|${key}`,
    hide,
    height: outlineBox(shape.n).maxY / size,
    span(top, bottom) {
      let x0 = -Infinity, x1 = Infinity;
      for (const em of [top - padY, (top + bottom) / 2, bottom + padY]) {
        const s = across(p, em * size);
        if (!s) return null;
        x0 = Math.max(x0, s[0] / size);
        x1 = Math.min(x1, s[1] / size);
      }
      x0 += padX;
      x1 -= padX;
      return x1 - x0 >= NARROWEST ? { x0, x1 } : null;
    },
  };
}
