/**
 * A raster source with the adjustments of its instance applied (ADR 0118), made once per source and set of numbers and kept: moving,
 * zooming and turning draw the kept copy. The colour part is `adjustPixel` over every pixel; blur uses the canvas's own filter; sharpen
 * is a 3 x 3 unsharp mask; grain is the same noise on every draw (it is fixed to the pixel, not to the time).
 */
import type { Adjust } from "../doc/adjust";
import { adjustKey, isLayerColourNeutral, layersOf, prepare } from "../doc/adjust";
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

/** One layer of a stack without the ones after it. */
const single = (l: Adjust): Adjust => {
  const { next: _n, ...rest } = l;
  return rest;
};

/** Draw into `c` what `draw` paints, adjusted: blur while drawing, then the colour of every pixel, sharpening and grain. */
export function adjustInto(c: HTMLCanvasElement, draw: (g: CanvasRenderingContext2D) => void, a: Adjust): boolean {
  // a stack: the first layer is made from the picture, each next one from the result before it
  const layers = layersOf(a);
  if (layers.length > 1) {
    if (!adjustInto(c, draw, single(layers[0]!))) return false;
    for (const l of layers.slice(1)) {
      const prev = document.createElement("canvas");
      prev.width = c.width;
      prev.height = c.height;
      prev.getContext("2d")!.drawImage(c, 0, 0);
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      if (!adjustInto(c, (g) => g.drawImage(prev, 0, 0), single(l))) return false;
    }
    return true;
  }
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return false;
  const w = c.width, h = c.height;
  if (a.blur) g.filter = `blur(${((a.blur / 100) * 0.02 * Math.max(w, h)).toFixed(2)}px)`;
  draw(g);
  g.filter = "none";
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const colour = !isLayerColourNeutral(a);
  if (colour) {
    const px = prepare(a);
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] !== 0) px(d, i);
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

/** While a slider is being dragged, pictures are adjusted at a smaller size (this many pixels at most), so the picture follows the hand; the full size is made when it is let go. */
const PREVIEW_PIXELS = 500_000;
let previewing = false;
export function setAdjustPreviewing(on: boolean): void {
  previewing = on;
}

/** The adjusted picture and how much smaller than the source it is (1: the same size; less while a slider is being dragged). */
export function adjustedSource(src: RasterSource, a: Adjust): { img: CanvasImageSource; f: number } {
  const quick = previewing && src.pixelW * src.pixelH > PREVIEW_PIXELS;
  const key = adjustKey(a) + (quick ? "|p" : "");
  let per = cache.get(src.source as object);
  if (!per) cache.set(src.source as object, (per = new Map()));
  const hit = per.get(key);
  if (hit) return { img: hit, f: hit.width / src.pixelW };
  // (`pixelW` and `pixelH` are the pixels this source really has: a reduced copy is already smaller than the picture)
  const f = quick ? Math.sqrt(PREVIEW_PIXELS / (src.pixelW * src.pixelH)) : 1;
  const w = Math.max(1, Math.round(src.pixelW * f)), h = Math.max(1, Math.round(src.pixelH * f));
  if (w * h > MAX_PIXELS) return { img: src.source, f: 1 };
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  if (!adjustInto(c, (g) => g.drawImage(src.source, 0, 0, w, h), a)) return { img: src.source, f: 1 };
  per.set(key, c);
  if (per.size > KEEP) per.delete(per.keys().next().value as string); // (the oldest numbers go: a slider being dragged makes many)
  return { img: c, f: w / src.pixelW };
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
