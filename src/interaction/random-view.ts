/**
 * A random empty view: the dice button of the bottom bar. It picks a random place and zoom level, far from anything on the canvas, and the
 * camera goes there. Candidates are drawn at random and kept when the view, grown by `CLEARANCE` windows on every side, holds no object, no
 * speck of one and no dot of a frame too fine to see. Pure apart from the index it asks, so the pieces are tested on their own.
 */
import type { FrameCamera, FrameSpace } from "../core/frames";
import { fromAbsoluteCamera } from "../core/frames";
import type { Viewport } from "../core/camera";
import * as D from "../core/dyadic";
import type { FrameIndex } from "../scene/frame-index";

/** How many windows of room a view needs on every side to count as far from content. */
export const CLEARANCE = 2;
/** The zoom levels the dice may choose (log2 px per world unit), and the sizes of the offsets from the origin (log2 world units). */
export const ZOOM_RANGE: readonly [number, number] = [-6, 36];
export const OFFSET_RANGE: readonly [number, number] = [0, 48];
const TRIES = 300;

/** A random place and zoom: a signed offset of 2^e world units on each axis (e between the offset limits), and a zoom level. */
export function randomPlace(rand: () => number): { x: D.Dyadic; y: D.Dyadic; z: number } {
  const offset = (): D.Dyadic => {
    const e = Math.floor(OFFSET_RANGE[0] + rand() * (OFFSET_RANGE[1] - OFFSET_RANGE[0] + 1));
    return D.shift(D.fromNumber((rand() < 0.5 ? -1 : 1) * (0.5 + rand() / 2)), e);
  };
  return { x: offset(), y: offset(), z: ZOOM_RANGE[0] + rand() * (ZOOM_RANGE[1] - ZOOM_RANGE[0]) };
}

/** Whether nothing of the canvas lies in the view or within `CLEARANCE` windows of it. */
export function viewIsEmpty(index: FrameIndex, vp: Viewport): (fc: FrameCamera) => boolean {
  const big: Viewport = { width: vp.width * (2 * CLEARANCE + 1), height: vp.height * (2 * CLEARANCE + 1) };
  return (fc) => {
    for (const { cam, index: ix } of index.views(fc)) {
      if (ix.query(cam, big).cells.some((c) => c.entries.length > 0)) return false;
      if (ix.density(cam, big, 8).cells.length > 0) return false;
    }
    return !index.dots(fc).some((d) => Math.abs(d.dx) <= big.width / 2 && Math.abs(d.dy) <= big.height / 2);
  };
}

/** A random empty view, or null when none turned up (a canvas that fills every place the dice may choose). */
export function randomEmptyView(space: FrameSpace, isEmpty: (fc: FrameCamera) => boolean, rand: () => number = Math.random): FrameCamera | null {
  for (let i = 0; i < TRIES; i++) {
    const p = randomPlace(rand);
    const fc = fromAbsoluteCamera(space, { x: p.x, y: p.y }, p.z);
    if (isEmpty(fc)) return fc;
  }
  return null;
}
