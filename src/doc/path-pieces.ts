import { NODE } from "./path";
import type { SubPath } from "./path";

// Which closed paths of a shape lie inside which: an outline and the holes it has. A letter `e` is two: the outer one and its hole.

const STEPS = 8;

/** A sub-path as a polygon: its curves in a few straight pieces. */
function polygonOf(s: SubPath): number[] {
  const n = s.n, count = n.length / NODE, out: number[] = [];
  for (let k = 0; k < count; k++) {
    const a = k * NODE, b = ((k + 1) % count) * NODE;
    if (k === count - 1 && !s.closed) {
      out.push(n[a]!, n[a + 1]!);
      break;
    }
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS, u = 1 - t;
      const at = (j: number): number => u * u * u * n[a + j]! + 3 * u * u * t * n[a + 4 + j]! + 3 * u * t * t * n[b + 2 + j]! + t * t * t * n[b + j]!;
      out.push(at(0), at(1));
    }
  }
  return out;
}

function inside(x: number, y: number, p: readonly number[]): boolean {
  let on = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if (p[i + 1]! > y !== p[j + 1]! > y && x < ((p[j]! - p[i]!) * (y - p[i + 1]!)) / (p[j + 1]! - p[i + 1]!) + p[i]!) on = !on;
  }
  return on;
}

/** For each sub-path, the closed ones it lies in. */
function holdersOf(subs: readonly SubPath[]): number[][] {
  const polys = subs.map((s) => (s.closed && s.n.length >= NODE * 3 ? polygonOf(s) : null));
  return subs.map((s, i) => {
    const out: number[] = [];
    polys.forEach((p, h) => {
      if (p && h !== i && inside(s.n[0]!, s.n[1]!, p)) out.push(h);
    });
    return out;
  });
}

/** The holes directly inside an outline: what must go with it. None for what is itself a hole. */
export function holesOf(subs: readonly SubPath[], s: number): number[] {
  const holders = holdersOf(subs);
  if (holders[s]!.length % 2 === 1) return [];
  return subs.flatMap((_, i) => (holders[i]!.length === holders[s]!.length + 1 && holders[i]!.includes(s) ? [i] : []));
}

/** The shape's separate pieces: each outline with its holes, each as the sub-paths' numbers. */
export function piecesOf(subs: readonly SubPath[]): number[][] {
  const holders = holdersOf(subs);
  return subs.flatMap((_, i) => (holders[i]!.length % 2 === 0 ? [[i, ...subs.flatMap((__, h) => (holders[h]!.length === holders[i]!.length + 1 && holders[h]!.includes(i) ? [h] : []))]] : []));
}
