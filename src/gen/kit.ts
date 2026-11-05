import type { Setting, Values } from "./types";

/** Short builders for the settings of a generator. */
/** How many of something: as far as a designer may want; size-like and share-like settings: see below. */
const MANY = new Set(["count", "crests", "dots", "every", "layers", "levels", "peaks", "points", "rings", "scale", "sides", "spots", "steps", "teeth", "turns", "veins"]);
const GRIDS = new Set(["across", "cells", "cols", "rows"]);
const SIZES = new Set(["amp", "edgew", "gap", "length", "line", "rise", "size", "thick", "weight", "width"]);
/** A share of the whole that was held short of its ends for no reason of its own. */
const SHARES: Record<string, readonly [number, number]> = { decay: [1, 99], level: [0, 100], ratio: [1, 99], spread: [0, 100], start: [0, 100], max: [1, 100], min: [0, 100], overlap: [0, 99], glow: [1, 100], opacity: [1, 100] };
/** The whole span of a setting: what is typed or dragged may go far past its usual one. */
function wideSpan(k: string, min: number, max: number): readonly [number, number] {
  if (MANY.has(k)) return [min, max * 10];
  if (GRIDS.has(k)) return [min, max * 4]; // (these multiply, across by down: past this a pattern is millions of points)
  if (SIZES.has(k)) return [Math.min(min, min > 0 ? 1 : 0), max * 5];
  return SHARES[k] ?? [min, max];
}
export const R = (k: string, label: string, min: number, max: number, def: number, step = 1): Setting => {
  const [lo, hi] = wideSpan(k, min, max);
  return { k, label, t: "range", min: lo, max: hi, step, def, usual: [min, max] };
};
export const C = (k: string, label: string, def: string, hide?: true): Setting => ({ k, label, t: "colour", def, ...(hide ? { hide } : {}) });
export const T = (k: string, label: string, def: boolean): Setting => ({ k, label, t: "toggle", def });
export const Ch = (k: string, label: string, opts: readonly (readonly [string, string])[], def: string): Setting => ({ k, label, t: "choice", opts, def });

/** Read the settings inside `run`. */
export const reader = (v: Values) => ({
  n: (k: string): number => v[k] as number,
  s: (k: string): string => v[k] as string,
  b: (k: string): boolean => v[k] as boolean,
  /** A colour that may be hidden: null when it is. */
  c: (k: string): string | null => ((v[k] as string) || null),
});

/** How loose a regular pattern is: 0 is exact (and the seed changes nothing), more lets the seed move things about. */
export const LOOSE = R("jitter", "Looseness", 0, 100, 0);

export const STYLE = Ch("style", "Style", [["solid", "Solid"], ["outline", "Outline"]], "solid");
