/**
 * The gaps between shapes (ADR 0172): the empty places the shapes close in on every side, as new shapes to fill them. A gap is a hole of
 * the shapes' union (boolean.ts): the union's loops run with the shapes on their left, so a hole runs the other way round. A shape sitting
 * inside a gap (an island) is left out of its fill.
 */
import type { FrameSpace } from "../core/frames";
import type { Region } from "./boolean";
import { booleanOp } from "./boolean";
import { regionIn } from "./boolean-group";
import type { PathObject } from "./model";
import type { SubPath } from "./path";
import { NODE, cubicOf, segmentsOf } from "./path";

/** Most shapes looked at for one search (the union is taken pair by pair). */
export const MAX_GAP_SHAPES = 200;

/** A loop as a polygon: its nodes, and 8 points along each curve. */
export function loopPolygon(s: SubPath): number[] {
  const out: number[] = [];
  for (const [i, j] of segmentsOf(s)) {
    const c = cubicOf(s.n, i, j);
    const line = c[0] === c[2] && c[1] === c[3] && c[4] === c[6] && c[5] === c[7];
    const steps = line ? 1 : 8;
    for (let k = 0; k < steps; k++) {
      const t = k / steps, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
      out.push(a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]);
    }
  }
  return out;
}

/** Twice the signed area of a polygon (x, y pairs). */
export function signedArea(p: readonly number[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i]! * p[j + 1]! - p[j]! * p[i + 1]!;
  }
  return a;
}

/** Whether (x, y) is inside a polygon (even-odd). */
export function insidePolygon(p: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i]!, yi = p[i + 1]!, xj = p[j]!, yj = p[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Gap {
  /** The gap's outline and the outlines of the islands in it (fill it even-odd), in the units of the back shape. */
  readonly subs: SubPath[];
  /** Its outline as a polygon, for finding the gap under a point. */
  readonly poly: number[];
  readonly area: number;
}

/** The gaps among loops of a union (their outer loops and holes): every hole, with the outer loops lying directly inside it. */
export function gapsOfLoops(loops: readonly SubPath[]): Gap[] {
  const polys = loops.map(loopPolygon);
  const areas = polys.map(signedArea);
  let big = 0;
  areas.forEach((a, i) => { if (Math.abs(a) > Math.abs(areas[big]!)) big = i; });
  const outer = Math.sign(areas[big] ?? 0); // (the largest loop is an outer one)
  const holes = loops.map((_, i) => i).filter((i) => Math.sign(areas[i]!) === -outer && areas[i] !== 0);
  return holes.map((h): Gap => {
    const poly = polys[h]!;
    // islands: outer loops inside this hole and not inside a smaller hole that is itself inside it
    const inner = holes.filter((o) => o !== h && Math.abs(areas[o]!) < Math.abs(areas[h]!) && insidePolygon(poly, polys[o]![0]!, polys[o]![1]!));
    const islands = loops.map((_, i) => i).filter((i) => Math.sign(areas[i]!) === outer && insidePolygon(poly, polys[i]![0]!, polys[i]![1]!) && !inner.some((o) => insidePolygon(polys[o]!, polys[i]![0]!, polys[i]![1]!)));
    return { subs: [loops[h]!, ...islands.map((i) => loops[i]!)], poly, area: Math.abs(areas[h]!) / 2 };
  });
}

/** The gaps the shapes close in, in the units of the back one, or a sentence saying why there are none to find. */
export function gapsOf(shapes: readonly PathObject[], space: FrameSpace): { back: PathObject; gaps: Gap[] } | string {
  if (!shapes.length) return "Pick the shapes around the gaps.";
  if (shapes.length > MAX_GAP_SHAPES) return `Gaps are found among up to ${MAX_GAP_SHAPES} shapes at a time.`;
  const back = [...shapes].sort((a, b) => a.z - b.z)[0]!;
  const regions: Region[] = [];
  for (const o of shapes) {
    const r = regionIn(o, back, space);
    if (!r) return "Those shapes cannot be placed together.";
    regions.push({ subs: r.subs.filter((s) => s.closed && s.n.length >= 3 * NODE), evenodd: r.evenodd });
  }
  // (one shape: united with itself, which puts its loops in the union's turning, so a ring's hole is a gap)
  const union = booleanOp("union", regions.length > 1 ? regions : [regions[0]!, regions[0]!]);
  if (!union) return "Those outlines graze each other in a way that cannot be told apart: move one a little and try again.";
  return { back, gaps: gapsOfLoops(union) };
}
