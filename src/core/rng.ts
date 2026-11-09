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
