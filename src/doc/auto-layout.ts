import * as D from "../core/dyadic";
import type { FrameSpace } from "../core/frames";
import type { CanvasObject, LayoutSort, LayoutTrack, ObjectId, PathObject, SheetLayout } from "./model";
import { expressObjectIn, homeObject } from "./model";
import { ancestorsOf, descendantsOf, isContainer } from "./containers";
import { normalizeUnit, scaleAbout, translate, unionBounds, worldBounds } from "./edit-ops";
import { ownerOf } from "./belongs";
import { isResult } from "./boolean-group";
import type { DerivationSource } from "./boolean-group";
import { planSheetScale } from "./constraints";
import { drawnParams, drawnSubs } from "./path";
import { roundCorners } from "./rounding";
import { shapedColumns, sortUnits } from "./arrange";
import { plainText } from "../text/markdown";

/**
 * Auto layout (ADR 0186): a sheet whose contents are placed by rules (a row, a column, a wrap or a grid, with a gap, padding and an
 * alignment), not by hand, and which can take the size of its contents (hug). It is a derivation: `withAutoLayout` runs in every
 * transaction (`DocumentStore.transaction`), so whatever is added to, taken off, resized or moved on such a sheet lays it out again in the
 * same undo step, and a sheet that hugs lays out the sheet it is on in turn. Pure: the objects that change.
 *
 * An item is a thing directly on the sheet, or a group of them (its outermost group), at its own size; what belongs to a shape (its words, a
 * connector) follows it by the belongs rule, so it is no item. Hidden things and things marked `inLayout.free` are left where they are. The
 * order of the items is the stacking order, front first (as the Layers panel reads): a thing dropped on the sheet takes the place it is
 * dropped at, by moving in that order.
 */
export type LaidOutSheet = PathObject & { container: { clip: boolean; layout: SheetLayout } };
export const isLaidOut = (o: CanvasObject | undefined | null): o is LaidOutSheet => isContainer(o) && o.container.layout !== undefined && !o.rot;

export const DEFAULT_LAYOUT: SheetLayout = { flow: "row", gap: [0, 0], pad: [0, 0, 0, 0], align: "start", justify: "start", hug: [true, true] };

/** A box in the sheet's units, from its top-left corner. */
export interface Cell { x: number; y: number; w: number; h: number }
/** An item to place: its size, whether it fills the room along an axis (within its least and most share of the room), and in a grid how many columns and rows it covers. */
export interface ItemSize { w: number; h: number; fill?: "x" | "y" | "both"; span?: readonly [number, number]; min?: readonly [number, number]; max?: readonly [number, number] }

const offset = (free: number, how: string): number => (how === "centre" ? free / 2 : how === "end" ? free : 0);
/** A filling item's length on an axis (0 across, 1 down) held between its least and most share of the room. */
const limited = (v: number, it: ItemSize, axis: 0 | 1, room: number): number => {
  const lo = (it.min?.[axis] ?? 0) * room, hi = it.max?.[axis] ? it.max[axis] * room : Infinity;
  return Number.isFinite(room) && room > 0 ? Math.min(Math.max(v, lo), Math.max(lo, hi)) : v;
};
const sum = (vs: readonly number[]): number => vs.reduce((s, v) => s + v, 0);
const median = (vs: readonly number[]): number => [...vs].sort((a, b) => a - b)[Math.floor((vs.length - 1) / 2)] ?? 0;

/**
 * Where items go on a sheet of `W` × `H` (its units): each item's box, and the size the sheet takes (its own, or its contents' on the axes it
 * hugs). Row, column and wrap: items run along the flow (the main axis) with `gap[0]` between them, lines across it with `gap[1]`; `justify`
 * places a line's items in the room along the flow, `align` an item in its line and the block of lines in the room across (only a sheet that
 * does not hug has room); an item that fills takes the room left on its axis (shared, within its limits), or its line's height. A grid, a
 * masonry and justified rows have rules of their own (`placeGrid`, `placeMasonry`, `placeJustified`).
 */
export function placeItems(l: SheetLayout, W: number, H: number, items: readonly ItemSize[]): { cells: Cell[]; w: number; h: number } {
  if (l.flow === "grid") return placeGrid(l, W, H, items);
  if (l.flow === "masonry") return placeMasonry(l, W, H, items);
  if (l.flow === "justified") return placeJustified(l, W, H, items);
  const col = l.flow === "column";
  const [padT, padR, padB, padL] = l.pad;
  const [gapM, gapC] = l.gap;
  const m = (i: ItemSize): number => (col ? i.h : i.w), c = (i: ItemSize): number => (col ? i.w : i.h);
  const fillM = (i: ItemSize): boolean => i.fill === "both" || i.fill === (col ? "y" : "x");
  const fillC = (i: ItemSize): boolean => i.fill === "both" || i.fill === (col ? "x" : "y");
  const axM: 0 | 1 = col ? 1 : 0, axC: 0 | 1 = col ? 0 : 1;
  const padM0 = col ? padT : padL, padM1 = col ? padB : padR, padC0 = col ? padL : padT, padC1 = col ? padR : padB;
  const hugM = col ? l.hug[1] : l.hug[0], hugC = col ? l.hug[0] : l.hug[1];
  const innerM = (col ? H : W) - padM0 - padM1, innerC = (col ? W : H) - padC0 - padC1;
  const n = items.length;
  // (a filling item is at least its least share already, before any room is shared out)
  const at: Array<{ m: number; c: number; lm: number; lc: number }> = items.map((i) => ({ m: 0, c: 0, lm: fillM(i) && !hugM ? limited(m(i), i, axM, innerM) : m(i), lc: c(i) }));
  let contentM = 0, contentC = 0;
  if (n) {
    // the lines: one, or as many as the room along the flow asks for (a wrap)
    const lines: number[][] = [];
    const limit = l.flow === "wrap" && !hugM ? Math.max(0, innerM) : Infinity;
    let line: number[] = [], len = 0;
    items.forEach((it, k) => {
      const add = (line.length ? gapM : 0) + at[k]!.lm;
      if (line.length && len + add > limit + 1e-9) {
        lines.push(line);
        line = [];
        len = at[k]!.lm;
      } else len += add;
      line.push(k);
    });
    lines.push(line);
    const lineM = lines.map((ln) => sum(ln.map((k) => at[k]!.lm)) + (ln.length - 1) * gapM);
    const lineC = lines.map((ln) => Math.max(0, ...ln.map((k) => c(items[k]!))));
    // (a lone line in a sheet that does not hug across: the line is as tall as the room, so an item fills or aligns in all of it)
    if (lines.length === 1 && !hugC) lineC[0] = Math.max(lineC[0]!, innerC);
    contentM = Math.max(...lineM);
    contentC = sum(lineC) + (lines.length - 1) * gapC;
    const freeC = hugC ? 0 : innerC - contentC;
    let cc = padC0 + offset(freeC, l.align);
    lines.forEach((ln, i) => {
      let free = hugM ? 0 : innerM - lineM[i]!;
      // The room left goes to the filling items in equal shares, each within its most; what one cannot take goes to the others.
      let open = ln.filter((k) => fillM(items[k]!));
      for (let round = 0; free > 1e-9 && open.length && round < ln.length; round++) {
        const share = free / open.length, next: number[] = [];
        for (const k of open) {
          const a = at[k]!, got = limited(a.lm + share, items[k]!, axM, innerM);
          free -= got - a.lm;
          if (got >= a.lm + share - 1e-9) next.push(k);
          a.lm = got;
        }
        open = next;
      }
      const spread = l.justify === "between" && ln.length > 1 && free > 0 ? free / (ln.length - 1) : 0;
      let cm = padM0 + (spread ? 0 : offset(free, l.justify));
      for (const k of ln) {
        const a = at[k]!;
        if (fillC(items[k]!)) a.lc = limited(lineC[i]!, items[k]!, axC, innerC);
        a.m = cm;
        a.c = cc + offset(lineC[i]! - a.lc, l.align);
        cm += a.lm + gapM + spread;
      }
      cc += lineC[i]! + gapC;
    });
  }
  const sizeM = hugM ? padM0 + contentM + padM1 : col ? H : W;
  const sizeC = hugC ? padC0 + contentC + padC1 : col ? W : H;
  const cells = at.map((a): Cell => (col ? { x: a.c, y: a.m, w: a.lc, h: a.lm } : { x: a.m, y: a.c, w: a.lm, h: a.lc }));
  return { cells, w: col ? sizeC : sizeM, h: col ? sizeM : sizeC };
}

/**
 * How many columns a grid or a masonry has: its tracks, the number set, else as `columnsBy` says (ADR 0195). By count: about as many as rows
 * from the number of items alone. By shape: from the items' shapes, for a block about as wide as tall, or, on a sheet whose size is set
 * both ways, as wide for its height as the room inside it (it fills the sheet). A grid's cell is its largest item; a masonry's items are
 * scaled to one width, so their heights for a width add up (Σ h/w) and √(Σ h/w × wide/tall) columns fill it.
 */
export function columnsOf(l: SheetLayout, items: readonly ItemSize[], W: number, H: number): number {
  const set = l.cols?.length || l.columns;
  if (set) return Math.max(1, set);
  const n = Math.max(1, items.length);
  if (l.columnsBy !== "shape" || !items.length) return Math.ceil(Math.sqrt(n));
  const innerW = W - l.pad[1] - l.pad[3], innerH = H - l.pad[0] - l.pad[2];
  const ratio = !l.hug[0] && !l.hug[1] && innerW > 0 && innerH > 0 ? innerW / innerH : 1;
  if (l.flow === "masonry") {
    const tall = sum(items.map((i) => (i.w > 0 ? i.h / i.w : 1)));
    return Math.min(n, Math.max(1, Math.round(Math.sqrt(tall * ratio))));
  }
  return shapedColumns(n, Math.max(0, ...items.map((i) => i.w)), Math.max(0, ...items.map((i) => i.h)), l.gap[0], l.gap[1], ratio);
}

/** Tracks' sizes: a hug track as large as what is in it alone, a fixed one its length, the shares of the room left, each at least as large as what is in it (`room`, Infinity when the sheet hugs: then a share hugs too). */
function trackSizes(tracks: readonly LayoutTrack[] | undefined, count: number, hug: readonly number[], room: number, gap: number): number[] {
  const t = (i: number): LayoutTrack => tracks?.[i] ?? { size: "hug" };
  const out = Array.from({ length: count }, (_, i) => (t(i).size === "fixed" ? (t(i).v ?? 0) : hug[i] ?? 0));
  const fr = Array.from({ length: count }, (_, i) => i).filter((i) => t(i).size === "fr");
  if (fr.length && Number.isFinite(room)) {
    // (a share is never smaller than what is in it: one held at that size leaves the rest of the room to the others)
    let open = fr, left = room - sum(out.filter((_, i) => t(i).size !== "fr")) - gap * (count - 1);
    for (let round = 0; round < fr.length && open.length; round++) {
      const weight = sum(open.map((i) => t(i).v ?? 1)) || 1;
      const held = open.filter((i) => (left * (t(i).v ?? 1)) / weight < (hug[i] ?? 0));
      if (!held.length) {
        for (const i of open) out[i] = Math.max(0, (left * (t(i).v ?? 1)) / weight);
        break;
      }
      for (const i of held) left -= out[i] = hug[i] ?? 0;
      open = open.filter((i) => !held.includes(i));
    }
  }
  return out;
}

/**
 * A grid: columns and rows of tracks, each as large as what is in it alone, a set length, or a share of the room (ADR 0193). Items take the
 * next free place, row by row, as many columns and rows as they span (one that does not fit on a row goes to the next); a spanning item
 * larger than its tracks widens the ones that hug. An item sits in its place by the alignments, or fills it.
 */
function placeGrid(l: SheetLayout, W: number, H: number, items: readonly ItemSize[]): { cells: Cell[]; w: number; h: number } {
  const [padT, padR, padB, padL] = l.pad;
  const [gapX, gapY] = l.gap;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = items.length;
  if (!n) return { cells: [], w: l.hug[0] ? padL + padR : W, h: l.hug[1] ? padT + padB : H };
  const C = columnsOf(l, items, W, H);
  const taken: boolean[][] = [];
  const free = (r: number, c: number, cs: number, rs: number): boolean => {
    if (c + cs > C) return false;
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if (taken[i]?.[j]) return false;
    return true;
  };
  let r0 = 0, c0 = 0;
  const pos = items.map((it) => {
    const cs = Math.min(C, Math.max(1, it.span?.[0] ?? 1)), rs = Math.max(1, it.span?.[1] ?? 1);
    let r = r0, c = c0;
    while (!free(r, c, cs, rs)) if (++c + cs > C) (c = 0), r++;
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) (taken[i] ??= [])[j] = true;
    r0 = r;
    c0 = c + cs;
    return { r, c, cs, rs };
  });
  const R = taken.length;
  const hugW = Array.from({ length: C }, (_, j) => Math.max(0, ...items.filter((_, k) => pos[k]!.c === j && pos[k]!.cs === 1).map((i) => i.w)));
  const hugH = Array.from({ length: R }, (_, i) => Math.max(0, ...items.filter((_, k) => pos[k]!.r === i && pos[k]!.rs === 1).map((i2) => i2.h)));
  // (an item over several tracks larger than them widens those that hug, in equal shares)
  const widen = (sizes: number[], tracks: readonly LayoutTrack[] | undefined, from: number, count: number, want: number, gap: number): void => {
    const have = sum(sizes.slice(from, from + count)) + gap * (count - 1);
    if (want <= have) return;
    const hugs = Array.from({ length: count }, (_, i) => from + i).filter((i) => (tracks?.[i]?.size ?? "hug") === "hug");
    for (const i of hugs.length ? hugs : [from + count - 1]) sizes[i]! += (want - have) / (hugs.length || 1);
  };
  pos.forEach((p, k) => {
    if (p.cs > 1) widen(hugW, l.cols, p.c, p.cs, items[k]!.w, gapX);
    if (p.rs > 1) widen(hugH, l.rows, p.r, p.rs, items[k]!.h, gapY);
  });
  const colW = trackSizes(l.cols, C, hugW, l.hug[0] ? Infinity : innerW, gapX);
  const rowH = trackSizes(l.rows, R, hugH, l.hug[1] ? Infinity : innerH, gapY);
  const contentW = sum(colW) + (C - 1) * gapX, contentH = sum(rowH) + (R - 1) * gapY;
  const freeW = l.hug[0] ? 0 : innerW - contentW, freeH = l.hug[1] ? 0 : innerH - contentH;
  const spread = l.justify === "between" && C > 1 && freeW > 0 ? freeW / (C - 1) : 0;
  const x0 = padL + (spread ? 0 : offset(freeW, l.justify)), y0 = padT + offset(freeH, l.align);
  const colX = colW.map((_, j) => x0 + sum(colW.slice(0, j)) + j * (gapX + spread));
  const rowY = rowH.map((_, i) => y0 + sum(rowH.slice(0, i)) + i * gapY);
  const cells = items.map((it, k): Cell => {
    const p = pos[k]!;
    const cw = sum(colW.slice(p.c, p.c + p.cs)) + (p.cs - 1) * (gapX + spread), ch = sum(rowH.slice(p.r, p.r + p.rs)) + (p.rs - 1) * gapY;
    const w = it.fill === "x" || it.fill === "both" ? limited(cw, it, 0, innerW) : it.w;
    const h = it.fill === "y" || it.fill === "both" ? limited(ch, it, 1, innerH) : it.h;
    return { x: colX[p.c]! + offset(cw - w, l.justify === "between" ? "start" : l.justify), y: rowY[p.r]! + offset(ch - h, l.align), w, h };
  });
  return { cells, w: l.hug[0] ? padL + contentW + padR : W, h: l.hug[1] ? padT + contentH + padB : H };
}

/**
 * Masonry: columns of one width, each item made as wide as a column (its shape kept) and put in the shortest column, so pictures of every
 * shape pack with no holes (ADR 0193). The columns share the sheet's width; a sheet that hugs its width makes them as wide as its widest item.
 */
function placeMasonry(l: SheetLayout, W: number, H: number, items: readonly ItemSize[]): { cells: Cell[]; w: number; h: number } {
  const [padT, padR, padB, padL] = l.pad;
  const [gapX, gapY] = l.gap;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = items.length;
  const C = Math.min(Math.max(1, n), columnsOf(l, items, W, H));
  const colW = l.hug[0] ? Math.max(0, ...items.map((i) => i.w)) : Math.max(0, (innerW - (C - 1) * gapX) / C);
  const heights = new Array<number>(C).fill(0);
  const placed = items.map((it) => {
    const k = heights.indexOf(Math.min(...heights));
    const h = it.w > 0 ? (it.h * colW) / it.w : it.h;
    const cell = { x: padL + k * (colW + gapX), y: padT + heights[k]!, w: colW, h };
    heights[k]! += h + gapY;
    return cell;
  });
  const contentW = C * colW + (C - 1) * gapX, contentH = n ? Math.max(...heights) - gapY : 0;
  const dy = l.hug[1] ? 0 : offset(innerH - contentH, l.align);
  return { cells: placed.map((c) => ({ ...c, y: c.y + dy })), w: l.hug[0] ? padL + contentW + padR : W, h: l.hug[1] ? padT + contentH + padB : H };
}

/**
 * Justified rows: items of one row all one height, the row as wide as the sheet, as a gallery of photographs (ADR 0193). Items are taken at
 * the row height aimed at (`rowHeight`, else their usual height) until the row is as wide as the room, then the row is scaled to fit it
 * exactly; the last row keeps the height aimed at, placed by `justify`. A sheet that hugs its width has no width to fill: one row.
 */
function placeJustified(l: SheetLayout, W: number, H: number, items: readonly ItemSize[]): { cells: Cell[]; w: number; h: number } {
  const [padT, padR, padB, padL] = l.pad;
  const [gapX, gapY] = l.gap;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const room = l.hug[0] ? Infinity : Math.max(0, innerW);
  const target = l.rowHeight ?? median(items.map((i) => i.h).filter((h) => h > 0));
  const at = items.map((i) => (i.h > 0 ? (i.w * target) / i.h : i.w));
  const cells: Cell[] = new Array(items.length);
  let y = padT, row: number[] = [], widest = 0;
  const close = (fit: boolean): void => {
    if (!row.length) return;
    const gaps = (row.length - 1) * gapX, natural = sum(row.map((k) => at[k]!));
    const k = fit && natural > 0 ? Math.max(0, room - gaps) / natural : 1;
    const h = target * k, w = natural * k + gaps;
    let x = padL + (fit ? 0 : offset(Number.isFinite(room) ? room - w : 0, l.justify === "between" ? "start" : l.justify));
    for (const i of row) {
      cells[i] = { x, y, w: at[i]! * k, h };
      x += at[i]! * k + gapX;
    }
    widest = Math.max(widest, w);
    y += h + gapY;
    row = [];
  };
  items.forEach((_, i) => {
    row.push(i);
    if (sum(row.map((k) => at[k]!)) + (row.length - 1) * gapX >= room) close(true);
  });
  close(false);
  const contentH = items.length ? y - gapY - padT : 0;
  const dy = l.hug[1] ? 0 : offset(innerH - contentH, l.align);
  return { cells: cells.map((c) => ({ ...c, y: c.y + dy })), w: l.hug[0] ? padL + widest + padR : W, h: l.hug[1] ? padT + contentH + padB : H };
}

/** An item of a sheet: the objects it is made of (one, or a group's), what they carry (a sheet's contents), and its box in the sheet's units. */
interface Unit { key: string; objs: CanvasObject[]; carried: CanvasObject[]; x0: number; y0: number; x1: number; y1: number; fill?: ItemSize["fill"]; span?: ItemSize["span"]; min?: ItemSize["min"]; max?: ItemSize["max"] }

/** The sheet's box as dyadics in its frame, its unit, and how to read a point of that frame in its units from its corner. */
function frameOf(sheet: LaidOutSheet, space: FrameSpace) {
  const f = sheet.frame ?? space.world;
  const sb = worldBounds(sheet);
  const u = sheet.unit;
  const rel = (a: D.Dyadic, from: D.Dyadic): number => D.toNumber(D.shift(D.sub(a, from), -u));
  return { f, sb, u, rel, W: rel(sb.max.x, sb.min.x), H: rel(sb.max.y, sb.min.y) };
}

/** The items on a sheet, front first; `all` holds every object as it is now. */
function unitsOf(sheet: LaidOutSheet, all: readonly CanvasObject[], space: FrameSpace): Unit[] {
  const { f, sb, rel } = frameOf(sheet, space);
  const own = all.filter((o) => o.parent === sheet.id && !o.inLayout?.free && ownerOf(o) === undefined && !isResult(o));
  const by = new Map<string, CanvasObject[]>();
  for (const o of own) {
    const key = o.groups?.[0] ?? o.id;
    (by.get(key) ?? by.set(key, []).get(key)!).push(o);
  }
  const units: Unit[] = [];
  for (const [key, objs] of by) {
    const shown = objs.filter((o) => !o.hidden);
    const b = shown.length ? unionBounds(shown.map((o) => expressObjectIn(o, f))) : null;
    if (!b) continue;
    const ids = new Set(objs.map((o) => o.id));
    const carriedIds = new Set(descendantsOf(all, ids));
    const carried = all.filter((o) => carriedIds.has(o.id));
    const one = objs.length === 1 ? objs[0]! : null;
    // (a pen stroke keeps its shape: it scales as a whole only; a turned thing is only moved)
    const fill = one && one.kind !== "stroke" && !one.rot ? one.inLayout?.fill : undefined;
    // (an item's span and limits are those of its first object: a group's or a thing's alone)
    const il = objs[0]!.inLayout;
    units.push({ key, objs, carried, x0: rel(b.min.x, sb.min.x), y0: rel(b.min.y, sb.min.y), x1: rel(b.max.x, sb.min.x), y1: rel(b.max.y, sb.min.y), ...(fill ? { fill } : {}), ...(il?.span ? { span: il.span } : {}), ...(il?.min ? { min: il.min } : {}), ...(il?.max ? { max: il.max } : {}) });
  }
  // (a thing attached to an item goes with it, not as an item of its own)
  const carried = new Set(units.flatMap((u) => u.carried.map((o) => o.id)));
  return units.filter((u) => !u.objs.some((o) => carried.has(o.id))).sort((a, b) => Math.max(...b.objs.map((o) => o.z)) - Math.max(...a.objs.map((o) => o.z)));
}

/**
 * The order of the items with the dropped ones (`moved`) put where they were dropped: before every item whose place in the flow comes after
 * the dropped item's middle (a row: to its right; a column: below it; a wrap or a grid: on a later line, or to its right on its own line).
 */
function orderWithDropped(units: readonly Unit[], flow: SheetLayout["flow"], moved: ReadonlySet<string>): Unit[] {
  const kept = units.filter((u) => !moved.has(u.key));
  const dropped = units.filter((u) => moved.has(u.key));
  const mid = (u: Unit): [number, number] => [(u.x0 + u.x1) / 2, (u.y0 + u.y1) / 2];
  const before = (o: Unit, d: Unit): boolean => {
    const [ox, oy] = mid(o), [dx, dy] = mid(d);
    if (flow === "row") return ox < dx;
    if (flow === "column") return oy < dy;
    return o.y1 <= dy ? true : o.y0 >= dy ? false : ox < dx;
  };
  const out = [...kept];
  for (const d of dropped.sort((a, b) => (flow === "column" ? mid(a)[1] - mid(b)[1] : flow === "row" ? mid(a)[0] - mid(b)[0] : mid(a)[1] - mid(b)[1] || mid(a)[0] - mid(b)[0]))) {
    let i = 0;
    while (i < out.length && before(out[i]!, d)) i++;
    out.splice(i, 0, d);
  }
  return out;
}

/** The items in the order a sort rule says, from what the canvas knows of them: a picture's name as placed and when its file came into the library, a text's first words, its size, its kind. */
function sortedUnits(units: readonly Unit[], key: LayoutSort): Unit[] {
  const nameOf = (o: CanvasObject): string => (o.kind === "text" ? plainText(o.md, 40).trim() : (o.name ?? ""));
  const as = units.map((u) => {
    const first = u.objs[0]!;
    return { objects: u.objs, name: nameOf(first), u, ...(first.kind === "image" && first.added !== undefined ? { date: first.added } : {}) };
  });
  return sortUnits(as, key).map((a) => (a as (typeof as)[number]).u);
}

/**
 * The sheet laid out: the objects that change (items moved, filled items stretched, the sheet resized when it hugs, and the stacking order
 * of dropped items). `moved`: the keys of the items dropped on the sheet in this change (`unitKeyOf`), which take the place they were dropped at.
 */
export function layOutSheet(sheet: LaidOutSheet, all: readonly CanvasObject[], space: FrameSpace, moved: ReadonlySet<string> = new Set()): CanvasObject[] {
  const l = sheet.container.layout;
  const { f, sb, u, W, H } = frameOf(sheet, space);
  if (!(W > 0 && H > 0 && Number.isFinite(W + H))) return [];
  // (a sort rule orders the items whatever their stacking: a dropped one takes its place by the rule)
  const units = l.sort ? sortedUnits(unitsOf(sheet, all, space), l.sort) : orderWithDropped(unitsOf(sheet, all, space), l.flow, moved);
  const { cells, w, h } = placeItems(l, W, H, units.map((un) => ({ w: un.x1 - un.x0, h: un.y1 - un.y0, ...(un.fill ? { fill: un.fill } : {}), ...(un.span ? { span: un.span } : {}), ...(un.min ? { min: un.min } : {}), ...(un.max ? { max: un.max } : {}) })));
  const out = new Map<ObjectId, CanvasObject>();
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  units.forEach((un, i) => {
    const cell = cells[i]!;
    const w0 = un.x1 - un.x0, h0 = un.y1 - un.y0;
    const kx = w0 > 0 && !near(cell.w, w0) ? cell.w / w0 : 1, ky = h0 > 0 && !near(cell.h, h0) ? cell.h / h0 : 1;
    const dx = D.shift(D.fromNumber(cell.x - un.x0), u), dy = D.shift(D.fromNumber(cell.y - un.y0), u);
    const still = D.sign(dx) === 0 && D.sign(dy) === 0 && kx === 1 && ky === 1;
    if (still) return;
    let group: CanvasObject[] = [...un.objs, ...un.carried].map((o) => expressObjectIn(o, f));
    if (kx !== 1 || ky !== 1) {
      const one = group[0]!;
      // (a sheet that fills takes what is on it along by their pins; a thing alone is stretched about its corner; a group, as a masonry or
      // justified rows size it, is scaled as one about its own corner)
      if (un.objs.length === 1 && isContainer(one)) group = [...planSheetScale(group, worldBounds(one).min, kx, ky, false, false).values()];
      else if (un.objs.length === 1) group = [scaleAbout(one, worldBounds(one).min, kx, one.kind === "text" ? 1 : ky), ...group.slice(1)]; // (words only get wider: they wrap again)
      else {
        const corner = unionBounds(group.slice(0, un.objs.length))!.min;
        group = group.map((o) => scaleAbout(o, corner, kx, o.kind === "text" ? 1 : ky));
      }
    }
    for (const o of group) out.set(o.id, homeObject(translate(o, dx, dy), space));
  });
  // the stacking order of dropped items: the items' z values, dealt again in the new order (each item keeps its own inner order)
  if (moved.size && units.length > 1 && !l.sort) {
    const zs = units.flatMap((un) => [...un.objs, ...un.carried].map((o) => o.z)).sort((a, b) => b - a);
    let k = 0;
    for (const un of units) {
      for (const o of [...un.objs, ...un.carried].sort((a, b) => b.z - a.z)) {
        const z = zs[k++]!;
        if (o.z !== z) out.set(o.id, { ...(out.get(o.id) ?? o), z } as CanvasObject);
      }
    }
  }
  // the sheet hugs: as large as its contents, its top-left corner staying where it is
  if ((l.hug[0] && !near(w, W)) || (l.hug[1] && !near(h, H))) {
    const nw = l.hug[0] ? w : W, nh = l.hug[1] ? h : H;
    if (nw > 0 && nh > 0 && Number.isFinite(nw + nh)) {
      const subs = drawnSubs("rect", 0, 0, nw, nh, 6, 5);
      const params = drawnParams("rect", 0, 0, nw, nh, 6, 5);
      const rounded = sheet.radius !== undefined ? { base: subs, sub: roundCorners(subs, sheet.radius, sheet.smoothing) } : { sub: subs };
      out.set(sheet.id, homeObject(normalizeUnit({ ...sheet, anchor: sb.min, ...rounded, ...(params ? { params } : {}) }), space));
    }
  }
  return [...out.values()];
}

/** A laid-out sheet's items, in their order, with their boxes as placed now and the sheet's size (its units): for the handles on the canvas and a new row height. */
export function layoutNow(sheet: LaidOutSheet, all: readonly CanvasObject[], space: FrameSpace): { items: Cell[]; W: number; H: number } {
  const { W, H } = frameOf(sheet, space);
  const l = sheet.container.layout;
  const units = l.sort ? sortedUnits(unitsOf(sheet, all, space), l.sort) : orderWithDropped(unitsOf(sheet, all, space), l.flow, new Set());
  return { items: units.map((u) => ({ x: u.x0, y: u.y0, w: u.x1 - u.x0, h: u.y1 - u.y0 })), W, H };
}

/**
 * Live reflow (ADR 0193): while things are dragged (`shown`: them as they are seen now), the sheets with auto layout they are over laid out
 * again around them, as dropping them there would, without the dragged things themselves (they follow the pointer). A thing dragged off its
 * sheet leaves its place; one dragged over another sheet with auto layout makes room there. Nothing is stored.
 */
export function previewLayout(src: DerivationSource, shown: ReadonlyMap<ObjectId, CanvasObject | null>): CanvasObject[] {
  const moved = [...shown.values()].filter((o): o is CanvasObject => !!o);
  if (!moved.length) return [];
  const sheets = [...src.all()].filter((o): o is LaidOutSheet => isLaidOut(o) && !o.hidden && !shown.has(o.id));
  if (!sheets.length) return [];
  const ids = new Set(moved.map((o) => o.id));
  // (the things dragged whose sheet is not dragged with them: each goes to the topmost laid-out sheet under its middle, or to none)
  const next = moved.map((o) => {
    if (o.parent !== undefined && ids.has(o.parent)) return o;
    const was = o.parent === undefined ? undefined : src.get(o.parent);
    if (was && !isLaidOut(was)) return o;
    let over: LaidOutSheet | undefined;
    for (const sh of sheets) {
      if (sh.id === o.id || (over && sh.z < over.z)) continue;
      try {
        const sb = worldBounds(sh), b = worldBounds(expressObjectIn(o, sh.frame ?? src.space.world));
        const mx = D.shift(D.add(b.min.x, b.max.x), -1), my = D.shift(D.add(b.min.y, b.max.y), -1);
        if (D.cmp(mx, sb.min.x) >= 0 && D.cmp(mx, sb.max.x) <= 0 && D.cmp(my, sb.min.y) >= 0 && D.cmp(my, sb.max.y) <= 0) over = sh;
      } catch {
        // (too far apart in size to compare: not over it)
      }
    }
    if (over?.id === o.parent) return o;
    const { parent: _p, ...off } = o;
    return (over ? { ...o, parent: over.id } : off) as CanvasObject;
  });
  return withAutoLayout(src, next, []).filter((o) => !ids.has(o.id));
}

/** The key of the item a thing on a sheet belongs to (its outermost group, else itself). */
export const unitKeyOf = (o: CanvasObject): string => o.groups?.[0] ?? o.id;

/**
 * A layout that keeps what is on the sheet about where it is: the flow read from the items' places (one line across: a row; one line down: a
 * column; lines of equal counts: a grid; else a wrap), the gap as the usual one between neighbours, the padding as the room between the
 * contents and the sheet's edge. The sheet keeps its size (it does not hug); `hug` says otherwise for a sheet made round the items.
 */
export function guessLayout(sheet: PathObject & { container: { clip: boolean } }, all: readonly CanvasObject[], space: FrameSpace, hug: readonly [boolean, boolean] = [false, false]): SheetLayout {
  const laid = { ...sheet, container: { ...sheet.container, layout: DEFAULT_LAYOUT } } as LaidOutSheet;
  const { W, H } = frameOf(laid, space);
  const units = unitsOf(laid, all, space);
  // (a layout made now chooses its columns by the items' shapes when none are set: ADR 0195)
  if (units.length === 0 || !(W > 0 && H > 0)) return { ...DEFAULT_LAYOUT, columnsBy: "shape", hug: [hug[0], hug[1]] };
  const pad = (v: number): number => Math.max(0, Math.round(v * 1e6) / 1e6);
  const edges: SheetLayout["pad"] = [pad(Math.min(...units.map((u) => u.y0))), pad(W - Math.max(...units.map((u) => u.x1))), pad(H - Math.max(...units.map((u) => u.y1))), pad(Math.min(...units.map((u) => u.x0)))];
  const overlapY = (a: Unit, b: Unit): boolean => a.y0 < b.y1 && b.y0 < a.y1;
  const overlapX = (a: Unit, b: Unit): boolean => a.x0 < b.x1 && b.x0 < a.x1;
  const median = (vs: number[]): number => (vs.length ? pad([...vs].sort((a, b) => a - b)[Math.floor((vs.length - 1) / 2)]!) : 0);
  const byX = [...units].sort((a, b) => a.x0 - b.x0), byY = [...units].sort((a, b) => a.y0 - b.y0);
  const gapsX = (us: Unit[]): number[] => us.slice(1).map((u, i) => u.x0 - us[i]!.x1);
  const gapsY = (us: Unit[]): number[] => us.slice(1).map((u, i) => u.y0 - us[i]!.y1);
  if (units.length === 1 || byX.every((u, i) => i === 0 || overlapY(u, byX[i - 1]!))) return { ...DEFAULT_LAYOUT, columnsBy: "shape", flow: "row", gap: [median(gapsX(byX)), 0], pad: edges, hug: [hug[0], hug[1]] };
  if (byY.every((u, i) => i === 0 || overlapX(u, byY[i - 1]!))) return { ...DEFAULT_LAYOUT, columnsBy: "shape", flow: "column", gap: [median(gapsY(byY)), 0], pad: edges, hug: [hug[0], hug[1]] };
  // lines: items whose vertical spans overlap, top to bottom
  const lines: Unit[][] = [];
  for (const u of byY) {
    const ln = lines.at(-1);
    if (ln && ln.some((v) => overlapY(u, v))) ln.push(u);
    else lines.push([u]);
  }
  const rows = lines.map((ln) => ln.sort((a, b) => a.x0 - b.x0));
  const gapX = median(rows.flatMap(gapsX));
  const gapY = median(rows.slice(1).map((ln, i) => Math.min(...ln.map((u) => u.y0)) - Math.max(...rows[i]!.map((u) => u.y1))));
  const grid = rows.length > 1 && rows.every((ln) => ln.length === rows[0]!.length) && rows[0]!.length > 1;
  return { ...DEFAULT_LAYOUT, columnsBy: "shape", flow: grid ? "grid" : "wrap", ...(grid ? { columns: rows[0]!.length } : {}), gap: [gapX, gapY], pad: edges, hug: [hug[0], hug[1]] };
}

/**
 * The transaction's objects with every sheet with auto layout that the change reaches laid out again: a sheet changed itself (its layout, its
 * size), one that has something added, taken off, moved or resized, and, when a sheet that hugs changes size, the sheet it is on, up the
 * chain. A sheet resized by hand stops hugging on that axis (it keeps the size given). Inner sheets go first, so a sheet sees its inner sheets
 * at their new sizes.
 */
export function withAutoLayout(src: DerivationSource, next: readonly CanvasObject[], removed: readonly ObjectId[]): CanvasObject[] {
  if (!next.length && !removed.length) return [...next];
  const gone = new Set(removed);
  const out = new Map(next.map((o) => [o.id, o] as const));
  const now = (id: ObjectId): CanvasObject | undefined => (gone.has(id) ? undefined : (out.get(id) ?? src.get(id)));
  // (nothing to do on a canvas with no such sheet: the usual case)
  let any = next.some((o) => isLaidOut(o));
  if (!any) for (const o of src.all()) if (isLaidOut(o) && !gone.has(o.id)) { any = true; break; }
  if (!any) return [...next];
  const all = (): CanvasObject[] => {
    const list: CanvasObject[] = [];
    const seen = new Set<ObjectId>();
    for (const o of src.all()) {
      seen.add(o.id);
      const o2 = now(o.id);
      if (o2) list.push(o2);
    }
    for (const [id, o] of out) if (!seen.has(id)) list.push(o);
    return list;
  };
  // the sheets to lay out, and for each the items dropped on it in this change
  const todo = new Map<ObjectId, Set<string>>();
  const mark = (id: ObjectId | undefined, key?: string): void => {
    if (id === undefined) return;
    const s = todo.get(id) ?? todo.set(id, new Set()).get(id)!;
    if (key !== undefined) s.add(key);
  };
  const relMid = (o: CanvasObject, sheet: CanvasObject, space: FrameSpace): [number, number] | null => {
    if (!isContainer(sheet)) return null;
    const f = sheet.frame ?? space.world;
    const sb = worldBounds(sheet), b = worldBounds(expressObjectIn(o, f));
    const r = (a: D.Dyadic, from: D.Dyadic): number => D.toNumber(D.shift(D.sub(a, from), -sheet.unit));
    return [(r(b.min.x, sb.min.x) + r(b.max.x, sb.min.x)) / 2, (r(b.min.y, sb.min.y) + r(b.max.y, sb.min.y)) / 2];
  };
  for (const o of next) {
    const was = src.get(o.id);
    if (isLaidOut(o)) {
      mark(o.id);
      // its layout just turned on: every item takes the place it has (the order read from where they are)
      if (!was || !isLaidOut(was)) for (const k of all().filter((x) => x.parent === o.id)) mark(o.id, unitKeyOf(k));
    }
    if (was?.parent !== undefined && was.parent !== o.parent) mark(was.parent);
    if (o.parent === undefined) continue;
    const sheet = now(o.parent), before = was && was.parent === o.parent ? src.get(was.parent) : undefined;
    if (!isLaidOut(sheet)) continue;
    // dropped: new on the sheet, or moved on it (its middle at another place from the sheet's corner; a resize or a move of the whole sheet is not that)
    const a = relMid(o, sheet, src.space), b = before && was ? relMid(was, before, src.space) : null;
    // (so is one that comes back into the layout: shown again, or no longer kept out of it)
    const back = !!was && ((was.hidden && !o.hidden) || (was.inLayout?.free && !o.inLayout?.free));
    const dropped = back || !b || !a || Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6 * Math.max(1, Math.abs(a[0]), Math.abs(a[1]));
    mark(o.parent, dropped ? unitKeyOf(o) : undefined);
  }
  for (const id of removed) mark(src.get(id)?.parent);
  // a sheet resized by hand (its size in this change differs from before) keeps the size given: it no longer hugs on that axis
  for (const o of next) {
    const was = src.get(o.id);
    if (!isLaidOut(o) || !isLaidOut(was) || !(o.container.layout.hug[0] || o.container.layout.hug[1])) continue;
    const a = worldBounds(o), b = worldBounds(expressObjectIn(was, o.frame ?? src.space.world));
    const same = (p: D.Dyadic, q: D.Dyadic, p2: D.Dyadic, q2: D.Dyadic): boolean => D.equals(D.sub(p, q), D.sub(p2, q2));
    const wSame = same(a.max.x, a.min.x, b.max.x, b.min.x), hSame = same(a.max.y, a.min.y, b.max.y, b.min.y);
    if (wSame && hSame) continue;
    const l = o.container.layout;
    out.set(o.id, { ...o, container: { ...o.container, layout: { ...l, hug: [l.hug[0] && wSame, l.hug[1] && hSame] } } } as CanvasObject);
  }
  const depthOf = (id: ObjectId): number => { const o = now(id); return o ? ancestorsOf(now, o).length : 0; };
  const done = new Set<ObjectId>();
  for (;;) {
    const pending = [...todo.keys()].filter((id) => !done.has(id) && isLaidOut(now(id)));
    if (!pending.length) break;
    const id = pending.sort((a, b) => depthOf(b) - depthOf(a))[0]!;
    done.add(id);
    const sheet = now(id) as LaidOutSheet;
    const before = sheet;
    for (const o of layOutSheet(sheet, all(), src.space, todo.get(id))) out.set(o.id, o);
    const after = now(id);
    // it changed size: the sheet it is on sees another item size
    if (after && after !== before && sheet.parent !== undefined && isLaidOut(now(sheet.parent))) mark(sheet.parent);
  }
  return [...out.values()];
}
