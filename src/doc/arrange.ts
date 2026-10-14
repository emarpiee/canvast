import * as D from "../core/dyadic";
import type { CanvasObject } from "./model";
import { translate, unionBounds } from "./edit-ops";

/**
 * Arrange, align and distribute (docs/plans/arrange-commands.md). Pure: each command returns the objects to replace,
 * every one moved by one exact translation (`translate`), so sizes, rotation and groups are untouched. A unit is a
 * group (at the level being worked at) or a single object; its box is the exact union of its members' boxes.
 * Positions are decided in doubles relative to the largest unit (so units 2^-1000 and 2^1000 apart do not overflow),
 * and the resulting offsets are exact dyadics.
 */

export interface Unit {
  objects: readonly CanvasObject[];
  /** Name for sorting: a file name, the first words of a text; empty for a stroke. */
  name: string;
}

export type SortKey = "name-asc" | "name-desc" | "size" | "type" | "stack";
export type AlignKey = "left" | "centre" | "right" | "top" | "middle" | "bottom";

interface Box {
  min: { x: D.Dyadic; y: D.Dyadic };
  max: { x: D.Dyadic; y: D.Dyadic };
}

const boxOf = (u: Unit): Box => unionBounds(u.objects)!;
const centre = (a: D.Dyadic, b: D.Dyadic): D.Dyadic => D.shift(D.add(a, b), -1);

/** Smallest power of two (as an exponent) at least as large as the biggest side of any box. */
function scaleOf(boxes: readonly Box[]): number {
  let e = -Infinity;
  for (const b of boxes) {
    for (const d of [D.sub(b.max.x, b.min.x), D.sub(b.max.y, b.min.y)]) if (D.sign(d) > 0) e = Math.max(e, Math.ceil(D.log2Abs(d)));
  }
  return Number.isFinite(e) ? e : 0;
}
const rel = (d: D.Dyadic, e: number): number => D.toNumber(D.shift(d, -e));
const unrel = (v: number, e: number): D.Dyadic => D.shift(D.fromNumber(v), e);

const TYPE_ORDER: Record<CanvasObject["kind"], number> = { image: 0, text: 1, stroke: 2 };
const firstZ = (u: Unit): number => Math.min(...u.objects.map((o) => o.z));

/** The units in the order a grid reads them. A name that is empty (strokes) comes last either way. */
export function sortUnits(units: readonly Unit[], key: SortKey): Unit[] {
  const boxes = new Map(units.map((u) => [u, boxOf(u)] as const));
  const e = scaleOf([...boxes.values()]);
  const area = (u: Unit): number => {
    const b = boxes.get(u)!;
    return rel(D.sub(b.max.x, b.min.x), e) * rel(D.sub(b.max.y, b.min.y), e);
  };
  const byName = (a: Unit, b: Unit, dir: 1 | -1): number => (a.name && !b.name ? -1 : !a.name && b.name ? 1 : dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const cmp: Record<SortKey, (a: Unit, b: Unit) => number> = {
    "name-asc": (a, b) => byName(a, b, 1),
    "name-desc": (a, b) => byName(a, b, -1),
    size: (a, b) => area(b) - area(a),
    type: (a, b) => TYPE_ORDER[a.objects[0]!.kind] - TYPE_ORDER[b.objects[0]!.kind] || byName(a, b, 1),
    stack: () => 0,
  };
  return [...units].sort((a, b) => cmp[key](a, b) || firstZ(a) - firstZ(b));
}

/**
 * Cells of a roughly square grid for boxes of the given sizes (any unit): as large as the largest box, each box
 * centred in its cell, filling left to right then down, columns chosen so the grid is about as wide as it is tall.
 * Returns each box's top-left and the grid's size. Shared with the batch-import grid (ADR 0030).
 */
export function gridCells(sizes: ReadonlyArray<{ w: number; h: number }>, gapFraction: number): { cells: Array<{ x: number; y: number }>; w: number; h: number } {
  const n = sizes.length;
  if (!n) return { cells: [], w: 0, h: 0 };
  const cellW = Math.max(...sizes.map((s) => s.w));
  const cellH = Math.max(...sizes.map((s) => s.h));
  const gap = gapFraction * Math.max(cellW, cellH);
  const cols = Math.min(n, Math.max(1, Math.round(Math.sqrt((n * (cellH + gap)) / (cellW + gap)))));
  const rows = Math.ceil(n / cols);
  return {
    cells: sizes.map((s, i) => ({ x: (i % cols) * (cellW + gap) + (cellW - s.w) / 2, y: Math.floor(i / cols) * (cellH + gap) + (cellH - s.h) / 2 })),
    w: cols * cellW + (cols - 1) * gap,
    h: rows * cellH + (rows - 1) * gap,
  };
}

const GAP = 0.08;

const moveUnit = (u: Unit, dx: D.Dyadic, dy: D.Dyadic): CanvasObject[] => (D.sign(dx) === 0 && D.sign(dy) === 0 ? [] : u.objects.map((o) => translate(o, dx, dy)));

/** Lay the units out in a grid, in the order given, about the centre of the selection. Sizes are kept. */
export function arrangeGrid(units: readonly Unit[], key: SortKey): CanvasObject[] {
  if (units.length < 2) return [];
  const sorted = sortUnits(units, key);
  const boxes = sorted.map(boxOf);
  const e = scaleOf(boxes);
  const all = unionBounds(units.flatMap((u) => u.objects))!;
  const g = gridCells(boxes.map((b) => ({ w: rel(D.sub(b.max.x, b.min.x), e), h: rel(D.sub(b.max.y, b.min.y), e) })), GAP);
  const left = D.sub(centre(all.min.x, all.max.x), unrel(g.w / 2, e));
  const top = D.sub(centre(all.min.y, all.max.y), unrel(g.h / 2, e));
  return sorted.flatMap((u, i) => moveUnit(u, D.sub(D.add(left, unrel(g.cells[i]!.x, e)), boxes[i]!.min.x), D.sub(D.add(top, unrel(g.cells[i]!.y, e)), boxes[i]!.min.y)));
}

/** Line the units up on one edge or centre of the whole selection. */
export function alignUnits(units: readonly Unit[], how: AlignKey): CanvasObject[] {
  if (units.length < 2) return [];
  const all = unionBounds(units.flatMap((u) => u.objects))!;
  return units.flatMap((u) => {
    const b = boxOf(u);
    const zero = D.ZERO;
    switch (how) {
      case "left":
        return moveUnit(u, D.sub(all.min.x, b.min.x), zero);
      case "right":
        return moveUnit(u, D.sub(all.max.x, b.max.x), zero);
      case "centre":
        return moveUnit(u, D.sub(centre(all.min.x, all.max.x), centre(b.min.x, b.max.x)), zero);
      case "top":
        return moveUnit(u, zero, D.sub(all.min.y, b.min.y));
      case "bottom":
        return moveUnit(u, zero, D.sub(all.max.y, b.max.y));
      case "middle":
        return moveUnit(u, zero, D.sub(centre(all.min.y, all.max.y), centre(b.min.y, b.max.y)));
    }
  });
}

/** Space the units evenly along an axis between the first and the last, which stay where they are (three or more). */
export function distributeUnits(units: readonly Unit[], axis: "x" | "y"): CanvasObject[] {
  if (units.length < 3) return [];
  const boxes = new Map(units.map((u) => [u, boxOf(u)] as const));
  const sorted = [...units].sort((a, b) => D.cmp(centre(boxes.get(a)!.min[axis], boxes.get(a)!.max[axis]), centre(boxes.get(b)!.min[axis], boxes.get(b)!.max[axis])));
  const first = boxes.get(sorted[0]!)!;
  const last = boxes.get(sorted[sorted.length - 1]!)!;
  const e = scaleOf([...boxes.values()]);
  const sizeRel = (u: Unit): number => rel(D.sub(boxes.get(u)!.max[axis], boxes.get(u)!.min[axis]), e);
  const span = rel(D.sub(last.max[axis], first.min[axis]), e);
  const gap = (span - sorted.reduce((s, u) => s + sizeRel(u), 0)) / (sorted.length - 1);
  let at = first.min[axis];
  return sorted.flatMap((u, i) => {
    const b = boxes.get(u)!;
    const d = D.sub(at, b.min[axis]);
    at = D.add(at, unrel(sizeRel(u) + gap, e));
    if (i === 0 || i === sorted.length - 1) return []; // the ends stay
    return axis === "x" ? moveUnit(u, d, D.ZERO) : moveUnit(u, D.ZERO, d);
  });
}
