/**
 * Adjustments of a shape, a pen stroke or a text: they have no pixels of their own, so the object is drawn on a scratch layer the size
 * of its box (cut to the canvas it is drawn on, with room for a blur), adjusted there as a picture is (`adjustInto`), and put on the
 * canvas with its blend mode. The blur is a share of the object's whole size on screen, so zooming does not change how it looks.
 */
import type { Adjust } from "../doc/adjust";
import { layersOf } from "../doc/adjust";
import type { ProjectedObject } from "./projection";
import { adjustInto } from "./adjust-image";
import { playingFilter } from "./adjust-filter";

/** Largest scratch layer (device px): a bigger one is drawn unadjusted rather than stalling the frame. */
const MAX_PIXELS = 8_000_000;
/** Room for antialiasing and sharpening beyond the box (px). */
const MARGIN = 6;
let scratch: HTMLCanvasElement | null = null;

const maxBlur = (a: Adjust): number => Math.max(0, ...layersOf(a).map((l) => l.blur ?? 0));

/** The longer side of the object's box on screen (px), or `fallback` when it is unbounded. */
function refSize(po: ProjectedObject, fallback: number): number {
  const w = po.box.maxX - po.box.minX, h = po.box.maxY - po.box.minY;
  const m = Math.max(w, h);
  return Number.isFinite(m) && m > 0 ? m : fallback;
}

/** How far (CSS px) the adjustments spread the object past its box: what a tile must also take in (see TileCache). */
export function adjustReach(po: ProjectedObject, fallback = 1000): number {
  const a = po.obj.kind === "image" ? undefined : po.obj.adjust;
  if (!a) return 0;
  const b = maxBlur(a);
  return MARGIN + (b ? 3 * (b / 100) * 0.02 * refSize(po, fallback) * 2 : 0);
}

/** Draw `body` (which paints the object on the context it is given, with the canvas transform of `ctx`) adjusted. */
export function drawAdjusted(ctx: CanvasRenderingContext2D, po: ProjectedObject, a: Adjust, body: (c: CanvasRenderingContext2D) => void): void {
  const t = ctx.getTransform();
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0) return body(ctx); // (the canvas is only ever scaled and moved here)
  const refCss = refSize(po, Math.max(W / t.a, H / t.d));
  const pad = adjustReach(po, refCss);
  // the box in device px, with room, cut to the canvas and the room
  const x0 = Math.max(Math.floor(po.box.minX * t.a + t.e - pad * t.a), Math.floor(-pad * t.a));
  const y0 = Math.max(Math.floor(po.box.minY * t.d + t.f - pad * t.d), Math.floor(-pad * t.d));
  const x1 = Math.min(Math.ceil(po.box.maxX * t.a + t.e + pad * t.a), Math.ceil(W + pad * t.a));
  const y1 = Math.min(Math.ceil(po.box.maxY * t.d + t.f + pad * t.d), Math.ceil(H + pad * t.d));
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0) || w * h > MAX_PIXELS) return w > 0 && h > 0 ? body(ctx) : undefined;
  const c = (scratch ??= document.createElement("canvas"));
  c.width = w; // (also clears it)
  c.height = h;
  const draw = (g: CanvasRenderingContext2D): void => {
    g.setTransform(t.a, 0, 0, t.d, t.e - x0, t.f - y0);
    body(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  // On the graphics card: the layer goes through the SVG filter of the adjustments as it is drawn (no pixels are read back, so zooming stays smooth).
  // Where the canvas has no `filter`, the same adjustments are made on the pixels.
  const gpu = "filter" in ctx;
  if (gpu) draw(c.getContext("2d")!);
  else if (!adjustInto(c, draw, a, refCss * t.a)) return body(ctx);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (gpu) ctx.filter = playingFilter(a, refCss * t.a) || "none";
  ctx.globalAlpha = 1;
  if (po.obj.blend) ctx.globalCompositeOperation = po.obj.blend;
  ctx.drawImage(c, x0, y0);
  ctx.restore();
}
