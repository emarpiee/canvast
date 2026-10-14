import { radiansFromAngle } from "../core/angle";
import type { ProjectedObject } from "./projection";

/**
 * The outline and the box of a selection (ADR 0031). Every object is outlined by the rectangle it really occupies,
 * turned with it; a selection is boxed by a rectangle turned with its members when they all share one rotation
 * (like a design tool), or by the axis-aligned box when they do not or when the user asks for it.
 */
export type Pt = readonly [number, number];

export interface SelectionFrame {
  /** Rotation of the box on screen (radians, clockwise); 0 for an axis-aligned box. */
  angle: number;
  /** Top-left, top-right, bottom-right, bottom-left in the box's own axes. */
  corners: readonly [Pt, Pt, Pt, Pt];
  centre: Pt;
}

const rot = (x: number, y: number, c: number, s: number): Pt => [c * x - s * y, s * x + c * y];

/** The outline of one object on screen: its four corners in order (top-left first in the object's own axes). */
export function itemCorners(po: ProjectedObject): Pt[] {
  const t = po.rotated;
  if (t) {
    const b = t.inner.box;
    return ([[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] as const).map(([x, y]) => {
      const [ox, oy] = rot(x - t.vvp.width / 2, y - t.vvp.height / 2, t.c, t.s);
      return [t.cx + ox, t.cy + oy] as Pt;
    });
  }
  const o = po.obj;
  if (o.kind === "stroke" && !po.cover) {
    // The oriented bounding rectangle of its points, in the direction of its own rotation, grown by the pen radius.
    const a = o.rot ? radiansFromAngle(o.rot) : 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < po.q.length; i += 2) {
      const [x, y] = rot(po.q[i]!, po.q[i + 1]!, c, -s); // into the stroke's axes
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const r = po.radius;
    return ([[minX - r, minY - r], [maxX + r, minY - r], [maxX + r, maxY + r], [minX - r, maxY + r]] as const).map(([x, y]) => rot(x, y, c, s));
  }
  const b = po.box;
  return [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
}

/** The shared rotation of the selected objects in radians, or null when they differ. */
function sharedAngle(selected: readonly ProjectedObject[]): number | null {
  const first = selected[0]?.obj.rot ?? 0;
  return selected.every((po) => (po.obj.rot ?? 0) === first) ? (first ? radiansFromAngle(first) : 0) : null;
}

/** The box of the visible selected objects, or null. `aligned` forces the axis-aligned box. */
export function selectionFrame(selected: readonly ProjectedObject[], aligned = false): SelectionFrame | null {
  if (!selected.length) return null;
  const angle = aligned ? 0 : (sharedAngle(selected) ?? 0);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const po of selected) {
    for (const [px, py] of itemCorners(po)) {
      const [x, y] = rot(px, py, c, -s);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX + minY + maxX + maxY)) return null;
  const corners = [rot(minX, minY, c, s), rot(maxX, minY, c, s), rot(maxX, maxY, c, s), rot(minX, maxY, c, s)] as const;
  return { angle, corners, centre: rot((minX + maxX) / 2, (minY + maxY) / 2, c, s) };
}

/** Distance of the rotate handle from the middle of the box's top edge (px). */
export const ROTATE_HANDLE_OFFSET = 26;
/** The rotate handle is kept below this many px from the top of the view (the toolbar is there) and inside it. */
const TOP_SAFE = 112;

/** Where the rotate handle sits: above the middle of the top edge, kept inside the view for a box that is not. */
export function rotateHandleAt(f: SelectionFrame, vp: { width: number; height: number }): Pt {
  const mx = (f.corners[0][0] + f.corners[1][0]) / 2;
  const my = (f.corners[0][1] + f.corners[1][1]) / 2;
  const hx = mx + Math.sin(f.angle) * ROTATE_HANDLE_OFFSET;
  const hy = my - Math.cos(f.angle) * ROTATE_HANDLE_OFFSET;
  return [Math.min(Math.max(hx, 16), vp.width - 16), Math.min(Math.max(hy, TOP_SAFE), vp.height - 16)];
}
