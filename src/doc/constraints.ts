/**
 * What happens to the objects on a sheet when the sheet is resized (ADR 0108): each follows its constraint, per axis. Left (or top) and
 * right (bottom) keep the distance to that edge, both keep the two distances (the object stretches), centre keeps the middle, scale keeps the
 * place and size as a fraction of the sheet. The default is left and top, so an object stays where it is from the sheet's top-left corner.
 */
import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { CanvasObject, ObjectId } from "./model";
import { isContainer } from "./containers";
import { scaleAbout, translate, worldBounds } from "./edit-ops";

export type HConstraint = "left" | "right" | "both" | "center" | "scale";
export type VConstraint = "top" | "bottom" | "both" | "center" | "scale";
export interface Constraint {
  readonly h: HConstraint;
  readonly v: VConstraint;
}
export const DEFAULT_CONSTRAINT: Constraint = { h: "left", v: "top" };
export const H_CONSTRAINTS: readonly HConstraint[] = ["left", "right", "both", "center", "scale"];
export const V_CONSTRAINTS: readonly VConstraint[] = ["top", "bottom", "both", "center", "scale"];

export const constraintOf = (o: CanvasObject): Constraint => o.constraint ?? DEFAULT_CONSTRAINT;

/** Where the span [c0, c1] of an object goes when the sheet's length along the axis changes from L0 to L1 (all measured from the sheet's start edge). */
export function constrainSpan(kind: HConstraint | VConstraint, L0: number, L1: number, c0: number, c1: number): [number, number] {
  const w = c1 - c0;
  const room = Math.max(w * 1e-6, 1e-12); // (an object squeezed to nothing stays visible)
  switch (kind) {
    case "left":
    case "top":
      return [c0, c1];
    case "right":
    case "bottom": {
      const end = L1 - (L0 - c1);
      return [end - w, end];
    }
    case "both": {
      const end = L1 - (L0 - c1);
      return [c0, Math.max(end, c0 + room)];
    }
    case "center": {
      const mid = (c0 + c1) / 2 - L0 / 2 + L1 / 2;
      return [mid - w / 2, mid + w / 2];
    }
    case "scale": {
      const k = L0 > 0 ? L1 / L0 : 1;
      return [c0 * k, Math.max(c1 * k, c0 * k + room)];
    }
  }
}

/**
 * The new state of everything in `objs` when their top ones are scaled about `fixed`: the sheets and plain objects among them are scaled,
 * what is on a sheet is moved (and stretched) by its constraint to the sheet's old and new box, level by level. Objects in another space
 * than their sheet are left where they are.
 */
export function planSheetScale(objs: readonly CanvasObject[], fixed: WorldPoint, kx: number, ky: number, keepWidth: boolean, keepRadius: boolean): Map<ObjectId, CanvasObject> {
  const byId = new Map(objs.map((o) => [o.id, o]));
  const out = new Map<ObjectId, CanvasObject>();
  const kids = new Map<ObjectId, CanvasObject[]>();
  for (const o of objs) {
    if (o.parent !== undefined && byId.has(o.parent)) (kids.get(o.parent) ?? kids.set(o.parent, []).get(o.parent)!).push(o);
    else out.set(o.id, scaleAbout(o, fixed, kx, o.kind === "image" || o.kind === "path" ? ky : kx, keepWidth, keepRadius));
  }
  const queue = [...out.keys()];
  for (let q = 0; q < queue.length; q++) {
    const pid = queue[q]!;
    const old = byId.get(pid)!;
    const now = out.get(pid)!;
    const list = kids.get(pid);
    if (!list || !isContainer(old)) continue;
    const ob = worldBounds(old);
    const nb = worldBounds(now);
    const u = old.unit;
    const rel = (a: D.Dyadic, from: D.Dyadic): number => D.toNumber(D.shift(D.sub(a, from), -u));
    const Lx0 = rel(ob.max.x, ob.min.x), Ly0 = rel(ob.max.y, ob.min.y);
    const Lx1 = rel(nb.max.x, nb.min.x), Ly1 = rel(nb.max.y, nb.min.y);
    for (const c of list) {
      queue.push(c.id);
      if (c.frame !== old.frame) {
        out.set(c.id, c);
        continue;
      }
      const cb = worldBounds(c);
      const x0 = rel(cb.min.x, ob.min.x), x1 = rel(cb.max.x, ob.min.x);
      const y0 = rel(cb.min.y, ob.min.y), y1 = rel(cb.max.y, ob.min.y);
      const k = constraintOf(c);
      let [nx0, nx1] = constrainSpan(k.h, Lx0, Lx1, x0, x1);
      let [ny0, ny1] = constrainSpan(k.v, Ly0, Ly1, y0, y1);
      const sx = x1 > x0 ? (nx1 - nx0) / (x1 - x0) : 1;
      const sy = y1 > y0 ? (ny1 - ny0) / (y1 - y0) : 1;
      let kxc = sx, kyc = sy;
      // Strokes and text keep their shape (they only scale as a whole); turned objects are only moved.
      if (c.kind === "stroke" || c.kind === "text") kxc = kyc = Math.sqrt(sx * sy);
      if (c.rot && c.kind !== "path") kxc = kyc = 1;
      if (c.rot && c.kind === "path") kxc = kyc = 1;
      if (Math.abs(kxc - 1) < 1e-12) kxc = 1;
      if (Math.abs(kyc - 1) < 1e-12) kyc = 1;
      // (an object that kept its size sits where its start edge went; one that changed size is scaled about its old corner, then moved)
      if (kxc === 1) nx1 = nx0 + (x1 - x0);
      if (kyc === 1) ny1 = ny0 + (y1 - y0);
      const scaled = kxc !== 1 || kyc !== 1 ? scaleAbout(c, cb.min, kxc, kyc, keepWidth, keepRadius) : c;
      const at = (r: number, axis: "x" | "y"): D.Dyadic => D.add(nb.min[axis], D.shift(D.fromNumber(r), u));
      out.set(c.id, translate(scaled, D.sub(at(nx0, "x"), cb.min.x), D.sub(at(ny0, "y"), cb.min.y)));
    }
  }
  return out;
}
