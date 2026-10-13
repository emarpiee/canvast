import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { CanvasObject } from "../doc/model";
import { localBounds } from "../doc/model";
import { distToSegment } from "./geometry2d";

/**
 * Objects far coarser than the camera's frame (ADR 0014, reference §7.3).
 *
 * Seen from far below, a coarse object is in one of three states relative to
 * the view: it covers it, it misses it, or an edge of it is near the view.
 * The first two need the camera's position in the object's frame only
 * roughly: if the object's outline is farther from the (rounded) centre than
 * the rounding error plus the view's size, every point of the view is on the
 * same side, so the answer cannot change with the dropped bits. Only an edge
 * near the view needs the exact centre (O(levels) bits), and that path stays
 * limited (frame-index.ts COARSE_EXACT_MAX).
 */
export interface CoarseInfo {
  /** log2 of the rounded centre's error, in the object frame's units. */
  readonly errLog2: number;
  /** log2 of CSS px per unit of the object's frame (the view's true zoom there). */
  readonly zTrue: number;
}

/** Cover: the whole view is inside the object (an image shows one source pixel). */
export interface Cover {
  readonly pixel?: readonly [number, number];
}

export type CoarseResult = "miss" | "exact" | Cover;

/** Relative double rounding of the local distances below (a few ulps, with room). */
const ROUND = 2 ** -46;

/**
 * Classify `o` against the view whose centre, in the object's frame, is
 * `center` (to within `info.errLog2`). "exact" means an edge is too near to
 * decide from the rounded centre.
 */
export function classifyCoarse(o: CanvasObject, center: WorldPoint, info: CoarseInfo, vp: { width: number; height: number }): CoarseResult {
  const scale = 2 ** o.unit;
  const lx = D.toNumber(D.sub(center.x, o.anchor.x)) / scale;
  const ly = D.toNumber(D.sub(center.y, o.anchor.y)) / scale;
  const viewLog2 = Math.log2(Math.hypot(vp.width, vp.height) / 2 + 8) - info.zTrue; // underflows to 0 at depth
  const b = localBounds(o);
  const mag = Math.max(Math.abs(lx), Math.abs(ly), Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY));
  // Everything that can move the answer, in local units.
  const m = (2 ** info.errLog2 + 2 ** viewLog2) / scale + mag * ROUND;
  if (lx < b.minX - m || lx > b.maxX + m || ly < b.minY - m || ly > b.maxY + m) return "miss";
  if (o.kind === "text") return "exact"; // shortcut: text is not summarised; its glyph edges need the exact centre
  if (o.kind === "image") {
    if (lx < m || lx > o.w - m || ly < m || ly > o.h - m) return "exact";
    const u = (lx * o.pixelW) / o.w;
    const v = (ly * o.pixelH) / o.h;
    const mu = (m * o.pixelW) / o.w + u * ROUND;
    const mv = (m * o.pixelH) / o.h + v * ROUND;
    const i = Math.floor(u);
    const j = Math.floor(v);
    if (u - i < mu || i + 1 - u < mu || v - j < mv || j + 1 - v < mv) return "exact";
    return { pixel: [i, j] };
  }
  const p = o.points;
  let d = Infinity;
  if (p.length === 2) d = Math.hypot(lx - p[0]!, ly - p[1]!);
  else for (let i = 0; i + 3 < p.length; i += 2) d = Math.min(d, distToSegment(lx, ly, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!));
  const s = d - o.width / 2; // signed distance to the outline: > 0 outside
  return s > m ? "miss" : s < -m ? {} : "exact";
}
