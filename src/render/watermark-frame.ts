/**
 * Where a picture's watermark (doc/watermark.ts) is on screen while it is being placed: its box, corners and turn handle, worked out from
 * the picture's own corners on screen (so a turned picture is no different). Shared by the handles drawn (scene-renderer.ts) and the
 * presses on them (interaction/tools.ts).
 */
import type { ImageObject } from "../doc/model";
import { watermarkBox } from "../doc/watermark";

type Pt = readonly [number, number];

export interface WatermarkFrame {
  /** Screen px per local unit along the picture's width and height. */
  readonly ex: Pt;
  readonly ey: Pt;
  readonly centre: Pt;
  /** Top left, top right, bottom right, bottom left of the watermark's box. */
  readonly corners: readonly Pt[];
  /** The turn handle, above the middle of its top side. */
  readonly turn: Pt;
  /** Where the line to the turn handle starts. */
  readonly top: Pt;
}

export const TURN_HANDLE_GAP_PX = 22;

export function watermarkFrame(o: ImageObject, picture: readonly Pt[]): WatermarkFrame | null {
  if (!o.watermark || picture.length < 4) return null;
  const [c0, c1, , c3] = picture as [Pt, Pt, Pt, Pt];
  const ex: Pt = [(c1[0] - c0[0]) / o.w, (c1[1] - c0[1]) / o.w];
  const ey: Pt = [(c3[0] - c0[0]) / o.h, (c3[1] - c0[1]) / o.h];
  const b = watermarkBox(o);
  const at = (x: number, y: number): Pt => [c0[0] + ex[0] * x + ey[0] * y, c0[1] + ex[1] * x + ey[1] * y];
  const centre = at(b.cx, b.cy);
  const cs = Math.cos(b.angle), sn = Math.sin(b.angle);
  // the watermark's own axes, in local units of the picture
  const corner = (u: number, v: number): Pt => at(b.cx + (u * cs - v * sn), b.cy + (u * sn + v * cs));
  const hw = b.w / 2, hh = b.h / 2;
  const corners = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
  const top = corner(0, -hh);
  const up: Pt = [top[0] - centre[0], top[1] - centre[1]];
  const len = Math.hypot(up[0], up[1]) || 1;
  const turn: Pt = [top[0] + (up[0] / len) * TURN_HANDLE_GAP_PX, top[1] + (up[1] / len) * TURN_HANDLE_GAP_PX];
  return { ex, ey, centre, corners, turn, top };
}

/** Whether screen point `p` is inside the convex polygon `poly`. */
export function insidePoly(p: Pt, poly: readonly Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** The screen corners of a part of a picture given as fractions of its box (top left, top right, bottom right, bottom left), and its axes. */
export function areaFrame(o: ImageObject, picture: readonly Pt[], a: { x: number; y: number; w: number; h: number }): { corners: Pt[]; ex: Pt; ey: Pt; origin: Pt } | null {
  if (picture.length < 4) return null;
  const [c0, c1, , c3] = picture as [Pt, Pt, Pt, Pt];
  const ex: Pt = [(c1[0] - c0[0]) / o.w, (c1[1] - c0[1]) / o.w];
  const ey: Pt = [(c3[0] - c0[0]) / o.h, (c3[1] - c0[1]) / o.h];
  const at = (u: number, v: number): Pt => [c0[0] + ex[0] * u * o.w + ey[0] * v * o.h, c0[1] + ex[1] * u * o.w + ey[1] * v * o.h];
  return { corners: [at(a.x, a.y), at(a.x + a.w, a.y), at(a.x + a.w, a.y + a.h), at(a.x, a.y + a.h)], ex, ey, origin: c0 };
}
