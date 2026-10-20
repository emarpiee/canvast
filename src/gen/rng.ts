import { rgbaOf } from "./core";

/** A seeded random source (mulberry32): the same seed always gives the same numbers. */
export interface Rng {
  (): number;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(list: readonly T[]): T;
  chance(p: number): boolean;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = next as Rng;
  r.range = (a, b) => a + next() * (b - a);
  r.int = (a, b) => Math.floor(a + next() * (b - a + 1));
  r.pick = (l) => l[Math.floor(next() * l.length)]!;
  r.chance = (p) => next() < p;
  return r;
}

/** Smooth 2D value noise in 0..1 (two octaves), different for each seed. */
export function makeNoise(seed: number): (x: number, y: number) => number {
  const h = (ix: number, iy: number): number => {
    let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const sm = (t: number): number => t * t * (3 - 2 * t);
  const one = (x: number, y: number): number => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = sm(x - ix), fy = sm(y - iy);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => (one(x, y) * 2 + one(x * 2.1 + 17, y * 2.1 + 31)) / 3;
}

// ---- Colour -----------------------------------------------------------------------------------------------------------------------

const h2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
export const hex = (r: number, g: number, b: number): string => `#${h2(r)}${h2(g)}${h2(b)}`;

/** The colour between `a` and `b` (t 0 to 1), as "#rrggbb". */
export function mix(a: string, b: string, t: number): string {
  const x = rgbaOf(a), y = rgbaOf(b);
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

/** The colour with an opacity of 0 to 1 ("#rrggbbaa"). */
export const alpha = (c: string, a: number): string => `${c.slice(0, 7)}${h2(a * 255)}`;

/** `t` rounded to one of `steps` levels (so shapes of nearly one colour can be drawn as one path). */
export const quant = (t: number, steps: number): number => (steps <= 1 ? 0 : Math.round(Math.max(0, Math.min(1, t)) * (steps - 1)) / (steps - 1));

export function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return hex(f(0), f(8), f(4));
}

/** `n` colours that go together: a first dark or light one for a background, then bright ones on neighbouring or opposite hues. */
export function palette(rng: Rng, n: number): string[] {
  const h = rng.range(0, 360);
  const dark = rng.chance(0.75);
  const out = [hsl(h + rng.range(-20, 20), rng.range(0.3, 0.7), dark ? rng.range(0.07, 0.16) : rng.range(0.9, 0.96))];
  const spread = rng.pick([25, 40, 120, 180]);
  for (let i = 1; i < n; i++) out.push(hsl(h + (i - 1) * spread + rng.range(-12, 12), rng.range(0.55, 0.9), rng.range(0.42, 0.68)));
  return out;
}
