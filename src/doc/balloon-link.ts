import * as D from "../core/dyadic";
import { balloonOutline, boxShape, circle, inside, poly, type Box, type P } from "./balloon-geometry";
import type { DerivationSource } from "./boolean-group";
import type { CanvasObject, ObjectId, PathObject } from "./model";
import { newObjectId, pathStyle } from "./model";
import { paintBounds, type SubPath } from "./path";
import { cosSin } from "../core/angle";

/** Balloons joined by a connector: the connector names its two balloons and is made again in every transaction that changes them, so it always follows. */
export type LinkStyle = "neck" | "pinched" | "line" | "dots";
export const LINK_STYLES: readonly (readonly [LinkStyle, string])[] = [["neck", "Neck"], ["pinched", "Pinched"], ["line", "Line"], ["dots", "Dots"]];

export interface BalloonLink {
  readonly a: ObjectId;
  readonly b: ObjectId;
  readonly style: LinkStyle;
  /** Its width, a share of the smaller balloon in percent. */
  readonly width: number;
  /** How far it bows, a share of its length in percent. */
  readonly bend: number;
  /** Where each end stands on its balloon, as shares of its half-sizes from its middle (absent: the middle). */
  readonly aAt?: P;
  readonly bAt?: P;
  /** The half-sizes of its two balloons in its own units, kept when it is made (to turn a handle's drag into a share). */
  readonly ra?: P;
  readonly rb?: P;
  /** The smaller balloon's size in local units (what `width` is a share of), kept when it is made. */
  readonly size?: number;
  /** On the piece that covers the two outlines where a neck joins them: the connector it belongs to. */
  readonly cover?: ObjectId;
}

export const validLink = (l: BalloonLink): boolean => typeof l.a === "string" && typeof l.b === "string" && LINK_STYLES.some(([s]) => s === l.style) && Number.isFinite(l.width) && l.width >= 0 && l.width <= 200 && Number.isFinite(l.bend) && Math.abs(l.bend) <= 100 && (l.size === undefined || Number.isFinite(l.size));

/** Where a connector's handles are: its box is from its first balloon's middle to its second's. */
export function linkHandlePoints(box: readonly number[], l: BalloonLink): Array<{ part: "linkW" | "linkBend" | "linkA" | "linkB"; at: P; dir: P }> {
  const [, , tx, ty] = box as [number, number, number, number];
  const len = Math.hypot(tx, ty) || 1;
  const n: P = [-ty / len, tx / len];
  const bow = (l.bend / 100) * len;
  const mid: P = [tx / 2 + (n[0] * bow) / 2, ty / 2 + (n[1] * bow) / 2];
  const w = ((l.size ?? 0) * l.width) / 100;
  return [{ part: "linkBend", at: mid, dir: n }, { part: "linkW", at: [mid[0] + (n[0] * w) / 2, mid[1] + (n[1] * w) / 2], dir: n }, { part: "linkA", at: [0, 0], dir: n }, { part: "linkB", at: [tx, ty], dir: n }];
}

export function linkDragged(box: readonly number[], l: BalloonLink, part: "linkW" | "linkBend" | "linkA" | "linkB", [x, y]: P): Partial<BalloonLink> {
  const [, , tx, ty] = box as [number, number, number, number];
  const share = (v: number): number => Math.max(-1, Math.min(1, v));
  if (part === "linkA" && l.ra) return { aAt: [share((l.aAt?.[0] ?? 0) + x / l.ra[0]), share((l.aAt?.[1] ?? 0) + y / l.ra[1])] };
  if (part === "linkB" && l.rb) return { bAt: [share((l.bAt?.[0] ?? 0) + (x - tx) / l.rb[0]), share((l.bAt?.[1] ?? 0) + (y - ty) / l.rb[1])] };
  const len = Math.hypot(tx, ty) || 1;
  const nx = -ty / len, ny = tx / len;
  const off = (x - tx / 2) * nx + (y - ty / 2) * ny;
  if (part === "linkBend") return { bend: Math.max(-100, Math.min(100, ((off * 2) / len) * 100)) };
  const bow = (l.bend / 100) * len;
  return { width: Math.max(1, Math.min(200, (Math.abs(off - bow / 2) * 200) / (l.size || 1))) };
}

const isBalloon = (o: CanvasObject | null | undefined): o is PathObject => o?.kind === "path" && o.params?.balloon !== undefined;

function linkSubs(l: BalloonLink, to: P, size: number, inset: number, range: readonly [number, number] = [0, 1]): SubPath[] {
  const len = Math.hypot(to[0], to[1]) || 1;
  const nx = -to[1] / len, ny = to[0] / len;
  const bow = (l.bend / 100) * len;
  const at = (t: number): P => [to[0] * t + nx * bow * 2 * t * (1 - t), to[1] * t + ny * bow * 2 * t * (1 - t)];
  const w = (size * l.width) / 100;
  if (l.style === "line") return [poly(Array.from({ length: 25 }, (_, i) => at(i / 24)), false)];
  if (l.style === "dots") {
    const many = Math.max(2, Math.round(len / (w * 0.9 || 1)));
    return Array.from({ length: many }, (_, i) => { const [x, y] = at((i + 0.5) / many); return circle(x, y, w / 4); });
  }
  const half = (t: number): number => Math.max(0, (w / 2) * (1 - (l.style === "pinched" ? 0.75 : 0.2) * Math.sin(Math.PI * t)) - inset);
  const steps = 24;
  const side = (sign: number, t: number): P => { const [x, y] = at(t); return [x + nx * sign * half(t), y + ny * sign * half(t)]; };
  const [t0, t1] = range;
  const along = (i: number): number => t0 + ((t1 - t0) * i) / steps;
  return [poly([...Array.from({ length: steps + 1 }, (_, i) => side(1, along(i))), ...Array.from({ length: steps + 1 }, (_, i) => side(-1, along(steps - i)))])];
}

/** A point of a balloon's own units, turned as the balloon is drawn (about the middle of the whole). */
function turned(o: PathObject, pts: readonly P[]): P[] {
  if (!o.rot) return [...pts];
  const b = paintBounds(o.sub, pathStyle(o));
  const px = (b.minX + b.maxX) / 2, py = (b.minY + b.maxY) / 2;
  const { c, s } = cosSin(o.rot);
  return pts.map(([x, y]) => [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c] as P);
}

/** Where a connector's end stands: in the balloon's units as drawn, and exactly. */
function endOf(o: PathObject, at: P | undefined): { local: P; world: { x: D.Dyadic; y: D.Dyadic } } {
  const { c, rx, ry } = boxShape(o.params!.box as Box);
  const local = turned(o, [[c[0] + (at?.[0] ?? 0) * rx, c[1] + (at?.[1] ?? 0) * ry]])[0]!;
  return { local, world: { x: D.add(o.anchor.x, D.shift(D.fromNumber(local[0]), o.unit)), y: D.add(o.anchor.y, D.shift(D.fromNumber(local[1]), o.unit)) } };
}

/** The balloon's body, as drawn, without its tails. */
const bodyPts = (o: PathObject): P[] => turned(o, balloonOutline(o.params!.box as Box, { ...o.params!.balloon!, tails: [], double: 0 }).pts);

/** The stretch of a connector between the two bodies, a little into each: what covers the outlines there can never reach the words (null: the bodies overlap). */
function betweenBodies(l: BalloonLink, to: P, A: PathObject, B: PathObject, la: P, lb: P, k: number): readonly [number, number] | null {
  const len = Math.hypot(to[0], to[1]) || 1;
  const nx = -to[1] / len, ny = to[0] / len, bow = (l.bend / 100) * len;
  const at = (t: number): P => [to[0] * t + nx * bow * 2 * t * (1 - t), to[1] * t + ny * bow * 2 * t * (1 - t)];
  const pa = bodyPts(A).map(([x, y]) => [x - la[0], y - la[1]] as P);
  const pb = bodyPts(B).map(([x, y]) => [(x - lb[0]) * k + to[0], (y - lb[1]) * k + to[1]] as P);
  const steps = 240;
  let t0 = 0, t1 = 1;
  for (let i = 0; i <= steps; i++) if (!inside(pa, at(i / steps))) { t0 = i / steps; break; }
  for (let i = steps; i >= 0; i--) if (!inside(pb, at(i / steps))) { t1 = i / steps; break; }
  const into = (A.width * 3) / len;
  return t0 < t1 ? [Math.max(0, t0 - into), Math.min(1, t1 + into)] : null;
}

const LOOK = { kind: "path", opacity: 1, attachmentTargetId: null, shape: "balloon" } as const;

/** The transaction's objects with the connectors of the balloons it changes made again, and those of removed balloons taken away. */
export function withBalloonLinks(src: DerivationSource, next: readonly CanvasObject[], removed: readonly ObjectId[]): { next: CanvasObject[]; removed: ObjectId[] } {
  if (!removed.length && !next.some((o) => o.kind === "path")) return { next: [...next], removed: [...removed] };
  const mine = new Map(next.map((o) => [o.id, o] as const));
  const gone = new Set(removed);
  const now = (id: ObjectId): CanvasObject | undefined => (gone.has(id) ? undefined : (mine.get(id) ?? src.get(id)));
  const out = new Map(mine);
  const outGone = new Set(removed);
  const links: PathObject[] = [], covers = new Map<ObjectId, PathObject>();
  const see = (o: CanvasObject): void => {
    if (gone.has(o.id) || o.kind !== "path" || !o.params?.link) return;
    if (o.params.link.cover !== undefined) covers.set(o.params.link.cover, o);
    else links.push(o);
  };
  for (const o of src.all()) {
    if (!mine.has(o.id)) see(o);
  }
  next.forEach(see);
  const drop = (id: ObjectId): void => { out.delete(id); if (src.get(id)) outGone.add(id); };
  for (const o of links) {
    const l = o.params!.link!;
    if (!mine.has(o.id) && !mine.has(l.a) && !mine.has(l.b) && !gone.has(l.a) && !gone.has(l.b)) continue;
    const cover = covers.get(o.id);
    const A = now(l.a), B = now(l.b);
    if (!isBalloon(A) || !isBalloon(B) || A.frame !== B.frame) {
      drop(o.id);
      if (cover) drop(cover.id);
      continue;
    }
    const ea = endOf(A, l.aAt), eb = endOf(B, l.bAt);
    const to: P = [D.toNumber(D.shift(D.sub(eb.world.x, ea.world.x), -A.unit)), D.toNumber(D.shift(D.sub(eb.world.y, ea.world.y), -A.unit))];
    const k = 2 ** (B.unit - A.unit);
    const sa = boxShape(A.params!.box as Box), sb = boxShape(B.params!.box as Box);
    const size = Math.min(sa.rx, sa.ry, sb.rx * k, sb.ry * k) * 2;
    const made = { ...(A.frame ? { frame: A.frame } : {}), anchor: ea.world, unit: A.unit };
    const line = l.style === "line";
    const { frame: _f, name: _n, ...rest } = o;
    const kept: BalloonLink = { ...l, size, ra: [sa.rx, sa.ry], rb: [sb.rx * k, sb.ry * k] };
    out.set(o.id, { ...rest, ...made, params: { box: [0, 0, to[0], to[1]], link: kept }, z: Math.min(A.z, B.z) - 0.5, sub: linkSubs(l, to, size, 0), fill: line ? null : A.fill, stroke: A.stroke, width: A.width } as PathObject);
    const range = l.style === "neck" || l.style === "pinched" ? betweenBodies(l, to, A, B, ea.local, eb.local, k) : null;
    if (range) {
      // (its edges stop at the inner edge of the neck's lines, so the balloon's outline and the neck's meet)
      const sub = linkSubs(l, to, size, A.width * 0.5, range);
      const z = Math.max(A.z, B.z) + 0.5;
      const params = { box: [0, 0, to[0], to[1]] as const, link: { ...kept, cover: o.id } };
      if (cover) { const { frame: _c, name: _m, ...keep } = cover; out.set(cover.id, { ...keep, ...made, z, sub, fill: A.fill, stroke: null, width: A.width, params } as PathObject); }
      else out.set(newObjectId(), { ...LOOK, id: "", ...made, z, sub, fill: A.fill, stroke: null, width: A.width, params } as unknown as PathObject);
    } else if (cover) drop(cover.id);
  }
  // (a connector deleted by itself takes its covering piece along; so does a piece left behind by an earlier version)
  for (const [under, c] of covers) if (!now(under)) drop(c.id);
  return { next: [...out].map(([id, o]) => (o.id === "" ? ({ ...o, id } as CanvasObject) : o)), removed: [...outGone] };
}

/** A connector's object, before it is made from its balloons. */
export const newLinkObject = (a: PathObject, b: PathObject): PathObject => ({
  ...LOOK, id: newObjectId(), ...(a.frame ? { frame: a.frame } : {}), anchor: a.anchor, unit: a.unit, z: Math.min(a.z, b.z) - 0.5, sub: [], fill: a.fill, stroke: a.stroke, width: a.width,
  params: { box: [0, 0, 1, 1], link: { a: a.id, b: b.id, style: "neck", width: 22, bend: 0 } },
} as unknown as PathObject);
