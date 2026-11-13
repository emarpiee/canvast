import { isIn, placedIn, sharedPlace } from "./belongs";
import * as D from "../core/dyadic";
import { outlineBox } from "../text/shape-flow";
import { boolGroupsOf, isResult, type DerivationSource } from "./boolean-group";
import type { CanvasObject, ObjectId, PathObject, TextObject } from "./model";
import { pathStyle, pathSubs } from "./model";
import { paintBounds, rotateSubs, type SubPath } from "./path";
import { cosSin } from "../core/angle";
import { balloonSubs, type Box } from "./balloon-geometry";

/** Words flowing inside a shape: the shape's outline is copied to the text, and kept up to date in the transaction that changes the shape. */
export const subArea = (n: readonly number[]): number => {
  const b = outlineBox(n);
  return (b.maxX - b.minX) * (b.maxY - b.minY);
};
export const biggestClosed = (o: PathObject): { n: readonly number[]; closed: boolean } | null =>
  pathSubs(o).filter((s) => s.closed && s.n.length >= 12).reduce<{ n: readonly number[]; closed: boolean } | null>((best, s) => (!best || subArea(s.n) > subArea(best.n) ? s : best), null);

/** A balloon's body without its tails, turned as the balloon is (about the middle of the whole, tails included). */
function bodyOutline(path: PathObject): SubPath {
  const body = balloonSubs(path.params!.box as Box, { ...path.params!.balloon!, tails: [] })[0]!;
  if (!path.rot) return body;
  const b = paintBounds(path.sub, pathStyle(path));
  const { c, s } = cosSin(path.rot);
  return rotateSubs([body], (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, c, s)[0]!;
}

/** The shape or path a text takes its place from. */
export const parentOf = (t: TextObject): ObjectId | undefined => t.inShape?.shape ?? t.onPath?.path;

/** The text along this path as it is now, its options kept; null when it cannot be. The letters are placed by the curve, so the text stays anchored where it is. */
export function fittedOnPath(text: TextObject, path: PathObject): TextObject | null {
  const sub = pathSubs(path).find((s) => s.n.length >= 12);
  if (!sub) return null;
  const k = 2 ** (path.unit - text.unit);
  const dx = D.toNumber(D.shift(D.sub(path.anchor.x, text.anchor.x), -text.unit));
  const dy = D.toNumber(D.shift(D.sub(path.anchor.y, text.anchor.y), -text.unit));
  const n = sub.n.map((v, i) => v * k + (i % 2 === 0 ? dx : dy));
  if (!n.every((v) => Number.isFinite(v))) return null;
  const { inShape: _s, ...straight } = text;
  return { ...straight, onPath: { ...text.onPath, n, closed: sub.closed, path: path.id } };
}

const refit = (t: TextObject, p: PathObject): TextObject | null => (t.onPath ? fittedOnPath(t, p) : fittedInShape(t, p));

/**
 * The outline a text takes its place from: its shape's own, or, when that shape is in a boolean group, the group's result (the outermost
 * one: what is seen). A text set along a circle that is then combined follows the combined outline, and the circle's again when the group
 * is let go. `results` finds a group's result (the transaction's own first, then the document's).
 */
export function shownShape(p: PathObject, results: (gid: string) => CanvasObject | undefined): PathObject {
  const g = boolGroupsOf(p).find((x) => !x.own);
  const r = g && results(g.gid);
  return r?.kind === "path" ? r : p;
}
const resultsIn = (...sources: Array<Iterable<CanvasObject>>) => (gid: string): CanvasObject | undefined => {
  for (const src of sources) for (const o of src) if (isResult(o) && o.result === gid) return o;
  return undefined;
};

/** The text placed by this shape or path, for drawing a change that is still going on. */
export const followed = refit;

const inShapesAt = new WeakMap<object, TextObject[]>();
/** Every text tied to a shape, found once per change of the document: the bars and the frames ask all the time. */
export function textsInShapes(doc: { all(): Iterable<CanvasObject>; readonly lastTransaction: object | undefined }): TextObject[] {
  const scan = (): TextObject[] => [...doc.all()].filter((o): o is TextObject => o.kind === "text" && parentOf(o) !== undefined);
  const at = doc.lastTransaction;
  if (!at) return scan();
  let found = inShapesAt.get(at);
  if (!found) inShapesAt.set(at, (found = scan()));
  return found;
}

/** The text inside this closed shape as it is now: the shape's outline, place and width (its options kept); null when it cannot be. */
export function fittedInShape(text: TextObject, path: PathObject): TextObject | null {
  // (a balloon: its body, without the tails; a boolean result of several pieces: the words go in the biggest)
  const sub = path.params?.balloon ? bodyOutline(path) : biggestClosed(path);
  if (!sub) return null;
  const box = outlineBox(sub.n);
  const k = 2 ** (path.unit - text.unit);
  const n = sub.n.map((v, i) => (v - (i % 2 === 0 ? box.minX : box.minY)) * k);
  const w = (box.maxX - box.minX) * k;
  if (!n.every((v) => Number.isFinite(v)) || !(w > 0)) return null;
  const inner = sub === null || path.params?.balloon ? [] : pathSubs(path).filter((q) => q.closed && q.n.length >= 12 && q.n !== sub.n).filter((q) => { const b = outlineBox(q.n); return b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY; });
  const holes = inner.map((q) => q.n.map((v, i) => (v - (i % 2 === 0 ? box.minX : box.minY)) * k));
  const { onPath: _p, autoWidth: _a, h: _h, ...rest } = text;
  const { holes: _old, ...was } = text.inShape ?? {};
  const anchor = { x: D.add(path.anchor.x, D.shift(D.fromNumber(box.minX), path.unit)), y: D.add(path.anchor.y, D.shift(D.fromNumber(box.minY), path.unit)) };
  // (put in for the first time: centred; after that what the person chose stays, "left" and "top" being no value at all)
  return { ...rest, anchor, w, ...(text.inShape ? {} : { align: "center" as const, valign: "middle" as const }), inShape: { ...was, n, closed: true, shape: path.id, ...(holes.length ? { holes } : {}) } };
}

/**
 * The transaction's objects with the texts inside shapes kept in their shapes, in the same undo step: when the shape changes they follow it, and a text
 * moved or scaled on its own goes back to its shape (scaled, it keeps its new letter size). The shape is what sets where the words go.
 */
/** How far in front of its shape the words sit: in front of a connector's cover piece (half a step), behind the next object (a whole one). */
export const WORDS_IN_FRONT = 0.75;

export function withShapeTexts(src: DerivationSource, next: readonly CanvasObject[], removed: readonly ObjectId[]): CanvasObject[] {
  const paths = next.some((o) => o.kind === "path");
  if (!paths && !removed.length && !next.some((o) => o.kind === "text" && parentOf(o) !== undefined)) return [...next];
  const mine = new Map(next.map((o) => [o.id, o] as const));
  const out = new Map(mine);
  const gone = new Set(removed);
  const follow = (t: TextObject): void => {
    const shape = parentOf(t);
    if (shape === undefined) return;
    const own = gone.has(shape) ? undefined : (mine.get(shape) ?? src.get(shape));
    const path = own?.kind === "path" ? shownShape(own, (gid) => resultsIn(mine.values(), src.all())(gid)) : own;
    if (path?.kind !== "path") {
      // Its shape or path is gone: plain words again, as wide as they were.
      const { inShape: _s, onPath: _p, ...plain } = t;
      out.set(t.id, plain);
      return;
    }
    const made = refit(t, path);
    const base = made ?? t;
    // (they belong to their shape: its groups and sheet, just in front of it, wherever either of them is moved: doc/belongs.ts)
    const place = sharedPlace([path], (id) => mine.get(id) ?? src.get(id));
    const z = path.z + WORDS_IN_FRONT;
    const placed = isIn(base, place) && base.z === z ? base : ({ ...placedIn(base, place), z } as TextObject);
    if (placed !== base) return void out.set(t.id, placed);
    if (!made) return;
    const was = t.onPath ?? t.inShape!, now = made.onPath ?? made.inShape!;
    if (made.w !== t.w || !D.equals(made.anchor.x, t.anchor.x) || !D.equals(made.anchor.y, t.anchor.y) || now.n.join() !== was.n.join() || now.closed !== was.closed || String((now as { holes?: unknown }).holes) !== String((was as { holes?: unknown }).holes)) out.set(t.id, made);
  };
  // (a boolean result the change makes again: the texts on its members follow it too)
  const remade = new Set<string>();
  for (const o of next) if (isResult(o)) remade.add(o.result!);
  const onRemade = (o: TextObject): boolean => {
    if (!remade.size) return false;
    const p = mine.get(parentOf(o)!) ?? src.get(parentOf(o)!);
    return !!p && boolGroupsOf(p).some((g) => !g.own && remade.has(g.gid));
  };
  if (paths || removed.length) for (const o of src.all()) if (o.kind === "text" && !gone.has(o.id) && !mine.has(o.id) && parentOf(o) !== undefined && (mine.has(parentOf(o)!) || gone.has(parentOf(o)!) || onRemade(o))) follow(o);
  for (const o of next) if (o.kind === "text") follow(o);
  return [...out.values()];
}
