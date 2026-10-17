/**
 * Cropping a picture (ADR 0118): its window of the source pixels moves, and its box (anchor, `w`, `h`) moves with it so what stays in
 * the window stays where it is on the canvas. Nothing of the source is removed: the edges can be pulled back out to the whole of it.
 */
import * as D from "../core/dyadic";
import type { ImageObject } from "./model";
import { cropOf } from "./adjust";
import type { Crop } from "./adjust";

/**
 * Move the four edges of the picture's window by the given amounts in local units (positive cuts in, negative brings back what was
 * cut), rounded to whole source pixels and held inside the source and to at least one pixel. The scale (source pixels per local unit)
 * does not change.
 */
export function cropEdges(o: ImageObject, left: number, top: number, right: number, bottom: number): ImageObject {
  const c = cropOf(o);
  const sx = c.w / o.w, sy = c.h / o.h; // source pixels per local unit
  let x0 = Math.round(c.x + left * sx);
  let y0 = Math.round(c.y + top * sy);
  let x1 = Math.round(c.x + c.w - right * sx);
  let y1 = Math.round(c.y + c.h - bottom * sy);
  x0 = Math.max(0, Math.min(x0, c.x + c.w - 1));
  y0 = Math.max(0, Math.min(y0, c.y + c.h - 1));
  x1 = Math.min(o.pixelW, Math.max(x1, x0 + 1));
  y1 = Math.min(o.pixelH, Math.max(y1, y0 + 1));
  if (x0 === c.x && y0 === c.y && x1 === c.x + c.w && y1 === c.y + c.h) return o;
  const crop: Crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const { crop: _old, ...rest } = o;
  const full = crop.x === 0 && crop.y === 0 && crop.w === o.pixelW && crop.h === o.pixelH;
  return {
    ...rest,
    ...(full ? {} : { crop }),
    w: crop.w / sx,
    h: crop.h / sy,
    anchor: {
      x: D.add(o.anchor.x, D.shift(D.fromNumber((x0 - c.x) / sx), o.unit)),
      y: D.add(o.anchor.y, D.shift(D.fromNumber((y0 - c.y) / sy), o.unit)),
    },
  };
}

/** The picture with all of its source showing again, at the same scale and place. */
export function uncrop(o: ImageObject): ImageObject {
  const c = cropOf(o);
  const sx = c.w / o.w, sy = c.h / o.h;
  return cropEdges(o, -c.x / sx, -c.y / sy, -(o.pixelW - c.x - c.w) / sx, -(o.pixelH - c.y - c.h) / sy);
}
