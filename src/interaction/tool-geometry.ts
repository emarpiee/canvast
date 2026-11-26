import type { EditorState } from "../app/editor-state";
import { TURN, cosSin } from "../core/angle";
import type { ScreenPoint, WorldPoint } from "../core/camera";
import * as D from "../core/dyadic";
import { expressExactIn } from "../core/frames";
import type { Frame } from "../core/frames";
import { worldBounds } from "../doc/edit-ops";
import { pathSubs, pivotOf, unrotatedBounds } from "../doc/model";
import type { CanvasObject, PathObject } from "../doc/model";
import { NODE } from "../doc/path";
import { pointInPolygon } from "../render/geometry2d";
import { exactX, exactY } from "../render/projection";
import type { ProjectedObject, ScreenBox } from "../render/projection";
import { HANDLE_SIZE_PX } from "../render/scene-renderer";
import { itemCorners } from "../render/selection-frame";
import type { SelectionFrame } from "../render/selection-frame";
import { bestEdgeSnap, bestFlushSnap, bestPointSnap } from "./snap-points";
import type { Seg, SnapTargets } from "./snap-points";
// The geometry the tools work with (moved out of tools.ts, as it was, B34): where a press turns the selection, the corners and sides of a
// shape on the screen and in exact coordinates, what a move snaps to, and the resize handles of a selection box.
/** A press this close outside a corner of the selection box (px) turns the selection. */
export const ROTATE_ZONE_PX = 36;

/** Whether a press at `s` turns the selection: on the rotate handle, or just outside a corner of the box (beyond its resize handle). */
export function inRotateZone(s: ScreenPoint, frame: SelectionFrame, handle: readonly [number, number]): boolean {
  if (Math.hypot(s.x - handle[0], s.y - handle[1]) <= HANDLE_SIZE_PX) return true;
  // A press on a resize handle resizes, whatever the box's size: on a small one a corner's handle is within reach of the next corner and on
  // the box's edge, not inside it (a text a line high turned instead). The reach is the resize's own (a side handle is only its square).
  if (resizeHandles(frame).some((h) => { const r = h.edge ? HANDLE_SIZE_PX / 2 + 1 : HANDLE_SIZE_PX; return Math.abs(s.x - h.at[0]) <= r && Math.abs(s.y - h.at[1]) <= r; })) return false;
  const near = frame.corners.some((p) => {
    const d = Math.hypot(s.x - p[0], s.y - p[1]);
    return d > HANDLE_SIZE_PX && d <= ROTATE_ZONE_PX;
  });
  return near && !pointInPolygon(s.x, s.y, frame.corners.flatMap((p) => [p[0], p[1]]));
}
/** Shift while rotating snaps to whole steps of 15 degrees. */
export const ANGLE_STEP = TURN / 24;
/** Smallest scale factor a resize drag can produce (prevents flips/zero size). */
export const MIN_SCALE = 1e-6;
/** The smallest a box can be made by dragging a handle, on the screen. */
export const MIN_BOX_PX = 8;

/** What a move can snap to (interaction/snap.ts), gathered once when the move starts. */
export interface SnapContext {
  /** The moving selection's box in px, and its exact lines in the move's frame. */
  box: ScreenBox;
  src: ExactLines;
  /** Candidates: other visible objects, their px lines and what they are. */
  tx: Array<[number, number, number]>;
  ty: Array<[number, number, number]>;
  objs: CanvasObject[];
  /** A group's box among the candidates: its exact lines, by the candidate's place. */
  groupLines: Map<number, ExactLines>;
  /** The shapes themselves (ADR 0171): corners and sides of the others, and the moving corners (px at the start) and straight sides. */
  shape: { targets: SnapTargets; refs: CornerRef[]; src: number[]; srcRefs: CornerRef[]; srcSegs: Seg[] };
}

/** A corner of an object, to find its exact place: a node of a path (or the middle of the straight side after it), or a box corner. */
export type CornerRef = { o: CanvasObject; s: number; k: number; mid?: true } | { o: CanvasObject; c: 0 | 1 | 2 | 3 };

/** The exact place of a corner, in frame `f`. */
export function cornerIn(r: CornerRef, f: Frame): WorldPoint {
  const o = r.o;
  if ("c" in r) {
    if (!o.rot || o.kind === "stroke") {
      const b = boundsIn(o, f);
      return { x: r.c === 0 || r.c === 3 ? b.min.x : b.max.x, y: r.c < 2 ? b.min.y : b.max.y };
    }
    // a turned picture, text or player: the corner of its own box, turned with it about its middle (as it is drawn)
    const b = unrotatedBounds(o), m = pivotOf(o), { c, s } = cosSin(o.rot);
    const vx = (r.c === 0 || r.c === 3 ? b.minX : b.maxX) - m.x, vy = (r.c < 2 ? b.minY : b.maxY) - m.y;
    const at = { x: D.add(o.anchor.x, D.shift(D.fromNumber(m.x + c * vx - s * vy), o.unit)), y: D.add(o.anchor.y, D.shift(D.fromNumber(m.y + s * vx + c * vy), o.unit)) };
    const of = o.frame ?? f.space.world;
    return of === f ? at : expressExactIn(f.space, of, at, f);
  }
  const n = pathSubs(o as PathObject)[r.s]!.n;
  const at = (k: number): WorldPoint => ({ x: D.add(o.anchor.x, D.shift(D.fromNumber(n[k * NODE]!), o.unit)), y: D.add(o.anchor.y, D.shift(D.fromNumber(n[k * NODE + 1]!), o.unit)) });
  let p = at(r.k);
  if (r.mid) {
    const q = at((r.k + 1) % (n.length / NODE));
    p = { x: D.shift(D.add(p.x, q.x), -1), y: D.shift(D.add(p.y, q.y), -1) };
  }
  const of = o.frame ?? f.space.world;
  return of === f ? p : expressExactIn(f.space, of, p, f);
}

/** The corners (with their refs) and sides of a projected object on the screen; sides that are straight are listed apart too. */
export function shapeOnScreen(po: ProjectedObject): { pts: number[]; refs: CornerRef[]; mids: number[]; midRefs: CornerRef[]; straight: Seg[]; curved: Seg[] } {
  const o = po.obj;
  const out = { pts: [] as number[], refs: [] as CornerRef[], mids: [] as number[], midRefs: [] as CornerRef[], straight: [] as Seg[], curved: [] as Seg[] };
  if (o.kind === "path") {
    pathSubs(o).forEach((sp, s) => {
      const n = sp.n;
      const count = n.length / NODE;
      const px = (k: number, j: number): [number, number] => [exactX(po.proj, n[k * NODE + j]!), exactY(po.proj, n[k * NODE + j + 1]!)];
      for (let k = 0; k < count; k++) {
        const [x, y] = px(k, 0);
        out.pts.push(x, y);
        out.refs.push({ o, s, k });
        if (k === count - 1 && !sp.closed) continue;
        const k2 = (k + 1) % count;
        const straight = n[k * NODE + 4] === n[k * NODE] && n[k * NODE + 5] === n[k * NODE + 1] && n[k2 * NODE + 2] === n[k2 * NODE] && n[k2 * NODE + 3] === n[k2 * NODE + 1];
        if (!straight) continue; // (a curve's sides come from the drawn outline below)
        const [x2, y2] = px(k2, 0);
        out.straight.push([x, y, x2, y2]);
        out.mids.push((x + x2) / 2, (y + y2) / 2);
        out.midRefs.push({ o, s, k, mid: true });
      }
    });
    for (const fp of po.path ?? []) {
      const p = fp.pts;
      const m = p.length / 2;
      for (let i = 0; i + 1 < m + (fp.closed ? 1 : 0); i++) out.curved.push([p[2 * i]!, p[2 * i + 1]!, p[(2 * (i + 1)) % p.length]!, p[(2 * (i + 1) + 1) % p.length]!]);
    }
  } else if (o.kind !== "stroke") {
    // A picture, text or player, turned or not: its own box is its shape (the corners its selection shows, `cornerIn` gives them exactly).
    const c = itemCorners(po);
    c.forEach(([x, y], i) => {
      out.pts.push(x, y);
      out.refs.push({ o, c: i as 0 | 1 | 2 | 3 });
      const [x2, y2] = c[(i + 1) % 4]!;
      out.straight.push([x, y, x2, y2]);
    });
  }
  return out;
}

/**
 * The snap to the shapes (ADR 0171), one rule for every gesture (move, node, resize, turn): `pts` and `segs` are the moving corners and
 * straight sides where the gesture would put them now. A corner within reach of a corner always wins (it fixes both axes); else a corner
 * onto a side, or a side flush along one, when that is nearer than `lineDist` (the best of the box lines). `to` is where the moving corner
 * (`source`) goes on the screen; a flush side has no corner (`side` is set instead).
 */
export type ShapeHit = { source: number; to: [number, number]; side: boolean; target: number | null; guides: NonNullable<EditorState["guides"]> };
export function shapeSnap(t: SnapTargets, pts: readonly number[], segs: readonly Seg[], lineDist = Infinity, crossDist = Infinity): ShapeHit | null {
  const pt = bestPointSnap(pts, t);
  if (pt && pt.dist <= crossDist) { // (lines on both axes nearer than the corner hold instead)
    const to: [number, number] = [t.pts[2 * pt.target]!, t.pts[2 * pt.target + 1]!];
    return { source: pt.source, to, side: false, target: pt.target, guides: { pt: to } };
  }
  const edge = bestEdgeSnap(pts, t);
  const flush = segs.length ? bestFlushSnap(segs, t) : null;
  const off = flush && (!edge || flush.dist < edge.dist) ? flush : edge;
  if (!off || off.dist >= lineDist) return null;
  const side = off === flush;
  const [x, y] = side ? [(segs[off.source]![0] + segs[off.source]![2]) / 2, (segs[off.source]![1] + segs[off.source]![3]) / 2] : [pts[2 * off.source]!, pts[2 * off.source + 1]!];
  return { source: off.source, to: [x + off.dx, y + off.dy], side, target: null, guides: { seg: off.seg } };
}

export interface ExactLines {
  x: [D.Dyadic, D.Dyadic, D.Dyadic];
  y: [D.Dyadic, D.Dyadic, D.Dyadic];
}

export const exactLines = (min: WorldPoint, max: WorldPoint): ExactLines => ({
  x: [min.x, D.shift(D.add(min.x, max.x), -1), max.x],
  y: [min.y, D.shift(D.add(min.y, max.y), -1), max.y],
});

/** The object's exact world bounding box, expressed in frame `f`. */
export function boundsIn(o: CanvasObject, f: Frame): { min: WorldPoint; max: WorldPoint } {
  const b = worldBounds(o);
  const of = o.frame ?? f.space.world;
  return of === f ? b : { min: expressExactIn(f.space, of, b.min, f), max: expressExactIn(f.space, of, b.max, f) };
}

export const linesOf = (o: CanvasObject, f: Frame): ExactLines => {
  const b = boundsIn(o, f);
  return exactLines(b.min, b.max);
};

export type Edge = "n" | "e" | "s" | "w";
export interface ResizeHandle {
  at: [number, number];
  /** The opposite corner or side, which stays put. */
  fixed: [number, number];
  edge: Edge | null;
}
export const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** The resize handles of a selection box: its four corners, and (for a box that is long enough, turned or not) the middle of each side. */
export function resizeHandles(frame: SelectionFrame): ResizeHandle[] {
  const c = frame.corners;
  const out: ResizeHandle[] = c.map((p, i) => ({ at: [p[0], p[1]] as [number, number], fixed: [c[(i + 2) % 4]![0], c[(i + 2) % 4]![1]] as [number, number], edge: null }));
  {
    const w = Math.hypot(c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]);
    const h = Math.hypot(c[3]![0] - c[0]![0], c[3]![1] - c[0]![1]);
    // A side handle needs room: on a thin box it would sit on top of the item itself (and its middle), so the corners alone are used.
    const roomy = w >= 3 * HANDLE_SIZE_PX && h >= 3 * HANDLE_SIZE_PX;
    if (roomy) {
      out.push({ at: mid(c[0]!, c[1]!), fixed: mid(c[3]!, c[2]!), edge: "n" }, { at: mid(c[3]!, c[2]!), fixed: mid(c[0]!, c[1]!), edge: "s" });
    }
    if (roomy) {
      out.push({ at: mid(c[1]!, c[2]!), fixed: mid(c[0]!, c[3]!), edge: "e" }, { at: mid(c[0]!, c[3]!), fixed: mid(c[1]!, c[2]!), edge: "w" });
    }
  }
  return out;
}

