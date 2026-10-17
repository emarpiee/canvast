/**
 * A raster source with the adjustments of its instance applied (ADR 0118), made once per source and set of numbers and kept: moving,
 * zooming and turning draw the kept copy. The colour part is `adjustPixel` over every pixel; blur uses the canvas's own filter; sharpen
 * is a 3 x 3 unsharp mask; grain is the same noise on every draw (it is fixed to the pixel, not to the time).
 */
import type { Adjust } from "../doc/adjust";
import { adjustKey, adjustPixel } from "../doc/adjust";
import type { RasterSource } from "./draw-objects";

/** Beyond this many pixels a source is drawn as it is: adjusting it would stall a frame (it is only so large when zoomed far in, where pixels are drawn one by one and adjusted one by one). */
const MAX_PIXELS = 8_000_000;
const KEEP = 6;
const cache = new WeakMap<object, Map<string, HTMLCanvasElement>>();

const hash = (x: number, y: number): number => {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff - 0.5;
};

/** Draw into `c` what `draw` paints, adjusted: blur while drawing, then the colour of every pixel, sharpening and grain. */
export function adjustInto(c: HTMLCanvasElement, draw: (g: CanvasRenderingContext2D) => void, a: Adjust): boolean {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return false;
  const w = c.width, h = c.height;
  if (a.blur) g.filter = `blur(${((a.blur / 100) * 0.02 * Math.max(w, h)).toFixed(2)}px)`;
  draw(g);
  g.filter = "none";
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const colour = !!(a.exposure || a.contrast || a.highlights || a.shadows || a.temperature || a.tint || a.saturation || a.vibrance);
  if (colour) {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const [r, gg, b] = adjustPixel(d[i]!, d[i + 1]!, d[i + 2]!, a);
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
    }
  }
  if (a.sharpen) {
    // unsharp mask: the pixel plus `amount` times its difference from the average of its four neighbours
    const amount = (a.sharpen / 100) * 1.5;
    const copy = new Uint8ClampedArray(d);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const avg = (copy[i + ch - 4]! + copy[i + ch + 4]! + copy[i + ch - w * 4]! + copy[i + ch + w * 4]!) / 4;
          d[i + ch] = copy[i + ch]! + amount * (copy[i + ch]! - avg);
        }
      }
    }
  }
  if (a.grain) {
    const amount = (a.grain / 100) * 60;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] === 0) continue;
        const n = hash(x, y) * amount;
        d[i] = d[i]! + n;
        d[i + 1] = d[i + 1]! + n;
        d[i + 2] = d[i + 2]! + n;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return true;
}

export function adjustedSource(src: RasterSource, a: Adjust): CanvasImageSource {
  const key = adjustKey(a);
  let per = cache.get(src.source as object);
  if (!per) cache.set(src.source as object, (per = new Map()));
  const hit = per.get(key);
  if (hit) return hit;
  const k = src.scale ?? 1;
  const w = Math.max(1, Math.round(src.pixelW * k)), h = Math.max(1, Math.round(src.pixelH * k));
  if (w * h > MAX_PIXELS) return src.source;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  if (!adjustInto(c, (g) => g.drawImage(src.source, 0, 0, w, h), a)) return src.source;
  per.set(key, c);
  if (per.size > KEEP) per.delete(per.keys().next().value as string); // (the oldest numbers go: a slider being dragged makes many)
  return c;
}

/** A picture as a PNG with its crop and adjustments baked in, at the size of its source pixels (null: it could not be made). */
export async function renderedPicture(blob: Blob, crop: { x: number; y: number; w: number; h: number }, a: Adjust | undefined): Promise<Blob | null> {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return null;
  try {
    const c = document.createElement("canvas");
    c.width = crop.w;
    c.height = crop.h;
    const ok = a ? adjustInto(c, (g) => g.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h), a) : (c.getContext("2d")?.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h), true);
    return ok ? await new Promise<Blob | null>((res) => c.toBlob(res, "image/png")) : null;
  } finally {
    bmp.close();
  }
}
