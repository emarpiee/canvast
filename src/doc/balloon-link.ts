import * as D from "../core/dyadic";
import { ellipse, poly } from "../gen/geom";
import type { P } from "../gen/geom";
import type { DerivationSource } from "./boolean-group";
import type { CanvasObject, ObjectId, PathObject } from "./model";
import { newObjectId } from "./model";
import type { SubPath } from "./path";

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
  /** On the piece that covers the two outlines where a neck joins them: the connector it belongs to. */
  readonly cover?: ObjectId;
}

export const validLink = (l: BalloonLink): boolean => typeof l.a === "string" && typeof l.b === "string" && LINK_STYLES.some(([s]) => s === l.style) && Number.isFinite(l.width) && l.width >= 0 && l.width <= 200 && Number.isFinite(l.bend) && Math.abs(l.bend) <= 100;

const isBalloon = (o: CanvasObject | null | undefined): o is PathObject => o?.kind === "path" && o.params?.balloon !== undefined;

function linkSubs(l: BalloonLink, to: P, size: number, inset: number): SubPath[] {
  const len = Math.hypot(to[0], to[1]) || 1;
  const nx = -to[1] / len, ny = to[0] / len;
  const bow = (l.bend / 100) * len;
  const at = (t: number): P => [to[0] * t + nx * bow * 2 * t * (1 - t), to[1] * t + ny * bow * 2 * t * (1 - t)];
  const w = (size * l.width) / 100;
  if (l.style === "line") return [poly(Array.from({ length: 25 }, (_, i) => at(i / 24)), false)];
  if (l.style === "dots") {
    const many = Math.max(2, Math.round(len / (w * 0.9 || 1)));
    return Array.from({ length: many }, (_, i) => { const [x, y] = at((i + 0.5) / many); return ellipse(x, y, w / 4, w / 4); });
  }
  const half = (t: number): number => Math.max(0, (w / 2) * (1 - (l.style === "pinched" ? 0.75 : 0.2) * Math.sin(Math.PI * t)) - inset);
  const steps = 24;
  const side = (sign: number, t: number): P => { const [x, y] = at(t); return [x + nx * sign * half(t), y + ny * sign * half(t)]; };
  return [poly([...Array.from({ length: steps + 1 }, (_, i) => side(1, i / steps)), ...Array.from({ length: steps + 1 }, (_, i) => side(-1, 1 - i / steps))])];
}

const centreOf = (o: PathObject): { x: D.Dyadic; y: D.Dyadic } => {
  const [x, y, w, h] = o.params!.box;
  return { x: D.add(o.anchor.x, D.shift(D.fromNumber(x + w / 2), o.unit)), y: D.add(o.anchor.y, D.shift(D.fromNumber(y + h / 2), o.unit)) };
};

const LOOK = { kind: "path", opacity: 1, attachmentTargetId: null, shape: "balloon", name: "Balloon connector" } as const;

/** The transaction's objects with the connectors of the balloons it changes made again, those of removed balloons taken away, and the words of removed balloons with them. */
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
    if (o.kind === "text" && o.inShape?.shape !== undefined && gone.has(o.inShape.shape) && isBalloon(src.get(o.inShape.shape))) outGone.add(o.id);
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
    const ca = centreOf(A), cb = centreOf(B);
    const to: P = [D.toNumber(D.shift(D.sub(cb.x, ca.x), -A.unit)), D.toNumber(D.shift(D.sub(cb.y, ca.y), -A.unit))];
    const k = 2 ** (B.unit - A.unit);
    const size = Math.min(Math.abs(A.params!.box[2]), Math.abs(A.params!.box[3]), Math.abs(B.params!.box[2]) * k, Math.abs(B.params!.box[3]) * k);
    const made = { ...(A.frame ? { frame: A.frame } : {}), anchor: ca, unit: A.unit };
    const line = l.style === "line";
    const { frame: _f, ...rest } = o;
    out.set(o.id, { ...rest, ...made, z: Math.min(A.z, B.z) - 0.5, sub: linkSubs(l, to, size, 0), fill: line ? null : A.fill, stroke: A.stroke, width: A.width } as PathObject);
    if (l.style === "neck" || l.style === "pinched") {
      const sub = linkSubs(l, to, size, A.width * 0.75);
      const z = Math.max(A.z, B.z) + 0.5;
      const params = { box: [0, 0, 1, 1] as const, link: { ...l, cover: o.id } };
      if (cover) { const { frame: _c, ...keep } = cover; out.set(cover.id, { ...keep, ...made, z, sub, fill: A.fill, stroke: null, width: A.width, params } as PathObject); }
      else out.set(newObjectId(), { ...LOOK, id: "", ...made, z, sub, fill: A.fill, stroke: null, width: A.width, params } as unknown as PathObject);
    } else if (cover) drop(cover.id);
  }
  return { next: [...out].map(([id, o]) => (o.id === "" ? ({ ...o, id } as CanvasObject) : o)), removed: [...outGone] };
}

/** A connector's object, before it is made from its balloons. */
export const newLinkObject = (a: PathObject, b: PathObject): PathObject => ({
  ...LOOK, id: newObjectId(), ...(a.frame ? { frame: a.frame } : {}), anchor: a.anchor, unit: a.unit, z: Math.min(a.z, b.z) - 0.5, sub: [], fill: a.fill, stroke: a.stroke, width: a.width,
  params: { box: [0, 0, 1, 1], link: { a: a.id, b: b.id, style: "neck", width: 22, bend: 0 } },
} as unknown as PathObject);
