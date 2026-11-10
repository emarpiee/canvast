import * as D from "../core/dyadic";
import type { FrameSpace } from "../core/frames";
import type { CanvasObject, ObjectId, PathObject, SheetLayout } from "./model";
import { expressObjectIn, homeObject } from "./model";
import { ancestorsOf, descendantsOf, isContainer } from "./containers";
import { normalizeUnit, scaleAbout, translate, unionBounds, worldBounds } from "./edit-ops";
import { ownerOf } from "./belongs";
import { isResult } from "./boolean-group";
import type { DerivationSource } from "./boolean-group";
import { planSheetScale } from "./constraints";
import { drawnParams, drawnSubs } from "./path";
import { roundCorners } from "./rounding";

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
/** An item to place: its size, and whether it fills the room along an axis. */
export interface ItemSize { w: number; h: number; fill?: "x" | "y" | "both" }

/**
 * Where items go on a sheet of `W` × `H` (its units): each item's box, and the size the sheet takes (its own, or its contents' on the axes it
 * hugs). The one rule for row, column, wrap and grid: items run along the flow (the main axis) with `gap[0]` between them, lines across it
 * with `gap[1]`; `justify` places a line's items in the room along the flow, `align` an item in its line and the block of lines in the room
 * across (only a sheet that does not hug has room). A grid has as many columns as `columns` says (else about as many as rows), each as wide
 * as its widest item, each row as tall as its tallest. An item that fills takes the room left on its axis (a fixed sheet), or its line's height.
 */
export function placeItems(l: SheetLayout, W: number, H: number, items: readonly ItemSize[]): { cells: Cell[]; w: number; h: number } {
  const col = l.flow === "column";
  const [padT, padR, padB, padL] = l.pad;
  const [gapM, gapC] = l.gap;
  const m = (i: ItemSize): number => (col ? i.h : i.w), c = (i: ItemSize): number => (col ? i.w : i.h);
  const fillM = (i: ItemSize): boolean => i.fill === "both" || i.fill === (col ? "y" : "x");
  const fillC = (i: ItemSize): boolean => i.fill === "both" || i.fill === (col ? "x" : "y");
  const padM0 = col ? padT : padL, padM1 = col ? padB : padR, padC0 = col ? padL : padT, padC1 = col ? padR : padB;
  const hugM = col ? l.hug[1] : l.hug[0], hugC = col ? l.hug[0] : l.hug[1];
  const innerM = (col ? H : W) - padM0 - padM1, innerC = (col ? W : H) - padC0 - padC1;
  const n = items.length;
  const at: Array<{ m: number; c: number; lm: number; lc: number }> = items.map((i) => ({ m: 0, c: 0, lm: m(i), lc: c(i) }));
  let contentM = 0, contentC = 0;
  const offset = (free: number, how: string): number => (how === "centre" ? free / 2 : how === "end" ? free : 0);
  if (l.flow === "grid" && n) {
    const cols = Math.max(1, Math.min(n, l.columns ?? Math.ceil(Math.sqrt(n))));
    const rows = Math.ceil(n / cols);
    const colM = Array.from({ length: cols }, (_, j) => Math.max(0, ...items.filter((_, k) => k % cols === j).map(m)));
    const rowC = Array.from({ length: rows }, (_, i) => Math.max(0, ...items.slice(i * cols, (i + 1) * cols).map(c)));
    contentM = colM.reduce((s, v) => s + v, 0) + (cols - 1) * gapM;
    contentC = rowC.reduce((s, v) => s + v, 0) + (rows - 1) * gapC;
    const freeM = hugM ? 0 : innerM - contentM, freeC = hugC ? 0 : innerC - contentC;
    const spreadM = l.justify === "between" && cols > 1 && freeM > 0 ? freeM / (cols - 1) : 0;
    let cy = padC0 + offset(freeC, l.align);
    for (let i = 0; i < rows; i++) {
      let cx = padM0 + (spreadM ? 0 : offset(freeM, l.justify));
      for (let j = 0; j < cols && i * cols + j < n; j++) {
        const k = i * cols + j, it = items[k]!, a = at[k]!;
        if (fillM(it)) a.lm = colM[j]!;
        if (fillC(it)) a.lc = rowC[i]!;
        a.m = cx + offset(colM[j]! - a.lm, l.justify === "between" ? "start" : l.justify);
        a.c = cy + offset(rowC[i]! - a.lc, l.align);
        cx += colM[j]! + gapM + spreadM;
      }
      cy += rowC[i]! + gapC;
    }
  } else if (n) {
    // the lines: one, or as many as the room along the flow asks for (a wrap)
    const lines: number[][] = [];
    const limit = l.flow === "wrap" && !hugM ? Math.max(0, innerM) : Infinity;
    let line: number[] = [], len = 0;
    items.forEach((it, k) => {
      const add = (line.length ? gapM : 0) + m(it);
      if (line.length && len + add > limit + 1e-9) {
        lines.push(line);
        line = [];
        len = m(it);
      } else len += add;
      line.push(k);
    });
    lines.push(line);
    const lineM = lines.map((ln) => ln.reduce((s, k) => s + m(items[k]!), 0) + (ln.length - 1) * gapM);
    const lineC = lines.map((ln) => Math.max(0, ...ln.map((k) => c(items[k]!))));
    // (a lone line in a sheet that does not hug across: the line is as tall as the room, so an item fills or aligns in all of it)
    if (lines.length === 1 && !hugC) lineC[0] = Math.max(lineC[0]!, innerC);
    contentM = Math.max(...lineM);
    contentC = lineC.reduce((s, v) => s + v, 0) + (lines.length - 1) * gapC;
    const freeC = hugC ? 0 : innerC - contentC;
    let cc = padC0 + offset(freeC, l.align);
    lines.forEach((ln, i) => {
      let free = hugM ? 0 : innerM - lineM[i]!;
      const fills = ln.filter((k) => fillM(items[k]!));
      if (free > 0 && fills.length) {
        for (const k of fills) at[k]!.lm += free / fills.length;
        free = 0;
      }
      const spread = l.justify === "between" && ln.length > 1 && free > 0 ? free / (ln.length - 1) : 0;
      let cm = padM0 + (spread ? 0 : offset(free, l.justify));
      for (const k of ln) {
        const a = at[k]!;
        if (fillC(items[k]!)) a.lc = lineC[i]!;
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

/** An item of a sheet: the objects it is made of (one, or a group's), what they carry (a sheet's contents), and its box in the sheet's units. */
interface Unit { key: string; objs: CanvasObject[]; carried: CanvasObject[]; x0: number; y0: number; x1: number; y1: number; fill?: ItemSize["fill"] }

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
    units.push({ key, objs, carried, x0: rel(b.min.x, sb.min.x), y0: rel(b.min.y, sb.min.y), x1: rel(b.max.x, sb.min.x), y1: rel(b.max.y, sb.min.y), ...(fill ? { fill } : {}) });
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

/**
 * The sheet laid out: the objects that change (items moved, filled items stretched, the sheet resized when it hugs, and the stacking order
 * of dropped items). `moved`: the keys of the items dropped on the sheet in this change (`unitKeyOf`), which take the place they were dropped at.
 */
export function layOutSheet(sheet: LaidOutSheet, all: readonly CanvasObject[], space: FrameSpace, moved: ReadonlySet<string> = new Set()): CanvasObject[] {
  const l = sheet.container.layout;
  const { f, sb, u, W, H } = frameOf(sheet, space);
  if (!(W > 0 && H > 0 && Number.isFinite(W + H))) return [];
  const units = orderWithDropped(unitsOf(sheet, all, space), l.flow, moved);
  const { cells, w, h } = placeItems(l, W, H, units.map((un) => ({ w: un.x1 - un.x0, h: un.y1 - un.y0, ...(un.fill ? { fill: un.fill } : {}) })));
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
      const corner = worldBounds(one).min;
      // (a sheet that fills takes what is on it along by their pins; anything else is stretched about its corner)
      if (isContainer(one)) group = [...planSheetScale(group, corner, kx, ky, false, false).values()];
      else group = [scaleAbout(one, corner, kx, one.kind === "text" ? 1 : ky), ...group.slice(1)]; // (words only get wider: they wrap again)
    }
    for (const o of group) out.set(o.id, homeObject(translate(o, dx, dy), space));
  });
  // the stacking order of dropped items: the items' z values, dealt again in the new order (each item keeps its own inner order)
  if (moved.size && units.length > 1) {
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
  if (units.length === 0 || !(W > 0 && H > 0)) return { ...DEFAULT_LAYOUT, hug: [hug[0], hug[1]] };
  const pad = (v: number): number => Math.max(0, Math.round(v * 1e6) / 1e6);
  const edges: SheetLayout["pad"] = [pad(Math.min(...units.map((u) => u.y0))), pad(W - Math.max(...units.map((u) => u.x1))), pad(H - Math.max(...units.map((u) => u.y1))), pad(Math.min(...units.map((u) => u.x0)))];
  const overlapY = (a: Unit, b: Unit): boolean => a.y0 < b.y1 && b.y0 < a.y1;
  const overlapX = (a: Unit, b: Unit): boolean => a.x0 < b.x1 && b.x0 < a.x1;
  const median = (vs: number[]): number => (vs.length ? pad([...vs].sort((a, b) => a - b)[Math.floor((vs.length - 1) / 2)]!) : 0);
  const byX = [...units].sort((a, b) => a.x0 - b.x0), byY = [...units].sort((a, b) => a.y0 - b.y0);
  const gapsX = (us: Unit[]): number[] => us.slice(1).map((u, i) => u.x0 - us[i]!.x1);
  const gapsY = (us: Unit[]): number[] => us.slice(1).map((u, i) => u.y0 - us[i]!.y1);
  if (units.length === 1 || byX.every((u, i) => i === 0 || overlapY(u, byX[i - 1]!))) return { ...DEFAULT_LAYOUT, flow: "row", gap: [median(gapsX(byX)), 0], pad: edges, hug: [hug[0], hug[1]] };
  if (byY.every((u, i) => i === 0 || overlapX(u, byY[i - 1]!))) return { ...DEFAULT_LAYOUT, flow: "column", gap: [median(gapsY(byY)), 0], pad: edges, hug: [hug[0], hug[1]] };
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
  return { ...DEFAULT_LAYOUT, flow: grid ? "grid" : "wrap", ...(grid ? { columns: rows[0]!.length } : {}), gap: [gapX, gapY], pad: edges, hug: [hug[0], hug[1]] };
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
