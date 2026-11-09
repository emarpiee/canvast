import * as D from "../core/dyadic";
import { outlineBox } from "../text/shape-flow";
import type { DerivationSource } from "./boolean-group";
import type { CanvasObject, ObjectId, PathObject, TextObject } from "./model";
import { pathSubs } from "./model";
import { balloonSubs } from "./balloon-geometry";

/** Words flowing inside a shape: the shape's outline is copied to the text, and kept up to date in the transaction that changes the shape. */
export const subArea = (n: readonly number[]): number => {
  const b = outlineBox(n);
  return (b.maxX - b.minX) * (b.maxY - b.minY);
};
export const biggestClosed = (o: PathObject): { n: readonly number[]; closed: boolean } | null =>
  pathSubs(o).filter((s) => s.closed && s.n.length >= 12).reduce<{ n: readonly number[]; closed: boolean } | null>((best, s) => (!best || subArea(s.n) > subArea(best.n) ? s : best), null);

/** The text inside this closed shape as it is now: the shape's outline, place and width (its options kept); null when it cannot be. */
export function fittedInShape(text: TextObject, path: PathObject): TextObject | null {
  // (a balloon: its body, without the tails; a boolean result of several pieces: the words go in the biggest)
  const sub = path.params?.balloon ? balloonSubs(path.params.box, { ...path.params.balloon, tails: [] })[0]! : biggestClosed(path);
  if (!sub) return null;
  const box = outlineBox(sub.n);
  const k = 2 ** (path.unit - text.unit);
  const n = sub.n.map((v, i) => (v - (i % 2 === 0 ? box.minX : box.minY)) * k);
  const w = (box.maxX - box.minX) * k;
  if (!n.every((v) => Number.isFinite(v)) || !(w > 0)) return null;
  const { onPath: _p, autoWidth: _a, h: _h, ...rest } = text;
  const anchor = { x: D.add(path.anchor.x, D.shift(D.fromNumber(box.minX), path.unit)), y: D.add(path.anchor.y, D.shift(D.fromNumber(box.minY), path.unit)) };
  // (put in for the first time: centred; after that what the person chose stays, "left" and "top" being no value at all)
  return { ...rest, anchor, w, ...(text.inShape ? {} : { align: "center" as const, valign: "middle" as const }), inShape: { ...text.inShape, n, closed: true, shape: path.id } };
}

/**
 * The transaction's objects with the texts inside shapes kept in their shapes, in the same undo step: when the shape changes they follow it, and a text
 * moved or scaled on its own goes back to its shape (scaled, it keeps its new letter size). The shape is what sets where the words go.
 */
export function withShapeTexts(src: DerivationSource, next: readonly CanvasObject[], removed: readonly ObjectId[]): CanvasObject[] {
  const paths = next.some((o) => o.kind === "path");
  if (!paths && !removed.length && !next.some((o) => o.kind === "text" && o.inShape?.shape !== undefined)) return [...next];
  const mine = new Map(next.map((o) => [o.id, o] as const));
  const out = new Map(mine);
  const gone = new Set(removed);
  const follow = (t: TextObject): void => {
    const shape = t.inShape?.shape;
    if (shape === undefined) return;
    const path = gone.has(shape) ? undefined : (mine.get(shape) ?? src.get(shape));
    if (path?.kind !== "path") {
      // Its shape is gone: plain words again, as wide as they were.
      const { inShape: _s, ...plain } = t;
      out.set(t.id, plain);
      return;
    }
    const made = fittedInShape(t, path);
    if (made && (made.w !== t.w || !D.equals(made.anchor.x, t.anchor.x) || !D.equals(made.anchor.y, t.anchor.y) || made.inShape!.n.join() !== t.inShape!.n.join())) out.set(t.id, made);
  };
  if (paths || removed.length) for (const o of src.all()) if (o.kind === "text" && !gone.has(o.id) && !mine.has(o.id) && o.inShape?.shape !== undefined && (mine.has(o.inShape.shape) || gone.has(o.inShape.shape))) follow(o);
  for (const o of next) if (o.kind === "text") follow(o);
  return [...out.values()];
}
