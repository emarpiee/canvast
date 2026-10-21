/**
 * Adjustments of a shape, a pen stroke or a text, and the shadows of any object: they have no pixels of their own, so the object is drawn on a
 * scratch layer the size of its box (cut to the canvas it is drawn on, with room for a blur or a shadow), adjusted there, given its inner shadow,
 * and put on the canvas with its drop shadow and its blend mode. The colour adjustments go through the SVG filter of the adjustments on the
 * graphics card (the pixels are never read back, so zooming stays smooth); where the canvas has no `filter` they are made on the pixels. Blur and
 * shadows are shares of the object's whole size on screen, so zooming does not change how they look.
 */
import type { Adjust } from "../doc/adjust";
import { hasShadow, layersOf, shadowOf } from "../doc/adjust";
import type { ProjectedObject } from "./projection";
import { adjustInto } from "./adjust-image";
import { playingFilter } from "./adjust-filter";

/** Largest scratch layer (device px): a bigger one is drawn unadjusted rather than stalling the frame. */
const MAX_PIXELS = 8_000_000;
/** Room for antialiasing and sharpening beyond the box (px). */
const MARGIN = 6;
/** A full offset is this share of the object's size, and a full shadow blur (the standard deviation) this share. */
const OFFSET = 0.1;
const SOFT = 0.05;
const layers: HTMLCanvasElement[] = [];

/** A scratch canvas of this size, cleared (the context is plain: the pixels stay on the graphics card). */
function layer(i: number, w: number, h: number): CanvasRenderingContext2D {
  const c = (layers[i] ??= document.createElement("canvas"));
  c.width = w; // (also clears it, and resets the state)
  c.height = h;
  return c.getContext("2d")!;
}

const maxBlur = (a: Adjust): number => Math.max(0, ...layersOf(a).map((l) => l.blur ?? 0));

/** The longer side of the object's box on screen (px), or `fallback` when it is unbounded. */
function refSize(po: ProjectedObject, fallback: number): number {
  const w = po.box.maxX - po.box.minX, h = po.box.maxY - po.box.minY;
  const m = Math.max(w, h);
  return Number.isFinite(m) && m > 0 ? m : fallback;
}

/** How far (CSS px) the adjustments spread the object past its box: what a tile must also take in (see TileCache). */
export function adjustReach(po: ProjectedObject, fallback = 1000): number {
  const a = po.obj.adjust;
  if (!a || (po.obj.kind === "image" && !hasShadow(a))) return 0;
  const ref = refSize(po, fallback);
  const b = po.obj.kind === "image" ? 0 : maxBlur(a);
  const d = shadowOf(a, "drop");
  const shadow = d ? (Math.max(Math.abs(d.x), Math.abs(d.y)) * OFFSET + 3 * d.blur * SOFT) * ref : 0;
  return MARGIN + (b ? 3 * (b / 100) * 0.02 * ref * 2 : 0) + shadow;
}

const rgba = (hex: string, a: number): string => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

/**
 * Draw `body` (which paints the object on the context it is given, with the canvas transform of `ctx`) adjusted. `colour`: the adjustments of the
 * colours and the blur are made here too (a picture has them made in its own pixels already: only its shadows are).
 */
export function drawAdjusted(ctx: CanvasRenderingContext2D, po: ProjectedObject, a: Adjust, body: (c: CanvasRenderingContext2D) => void, colour = true): void {
  const t = ctx.getTransform();
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0) return body(ctx); // (the canvas is only ever scaled and moved here)
  const refCss = refSize(po, Math.max(W / t.a, H / t.d));
  const pad = adjustReach(po, refCss) || MARGIN;
  // the box in device px, with room, cut to the canvas and the room
  const x0 = Math.max(Math.floor(po.box.minX * t.a + t.e - pad * t.a), Math.floor(-pad * t.a));
  const y0 = Math.max(Math.floor(po.box.minY * t.d + t.f - pad * t.d), Math.floor(-pad * t.d));
  const x1 = Math.min(Math.ceil(po.box.maxX * t.a + t.e + pad * t.a), Math.ceil(W + pad * t.a));
  const y1 = Math.min(Math.ceil(po.box.maxY * t.d + t.f + pad * t.d), Math.ceil(H + pad * t.d));
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0) || w * h > MAX_PIXELS) return w > 0 && h > 0 ? body(ctx) : undefined;
  const refDev = refCss * t.a;
  const draw = (g: CanvasRenderingContext2D): void => {
    g.setTransform(t.a, 0, 0, t.d, t.e - x0, t.f - y0);
    body(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  let out: HTMLCanvasElement;
  const filter = colour ? playingFilter(a, refDev) : "";
  if (!colour || "filter" in ctx) {
    const g0 = layer(0, w, h);
    draw(g0);
    out = g0.canvas;
    if (filter) {
      // On the graphics card: the layer goes through the SVG filter of the adjustments as it is drawn.
      const g1 = layer(1, w, h);
      g1.filter = filter;
      g1.drawImage(out, 0, 0);
      g1.filter = "none";
      out = g1.canvas;
    }
  } else {
    // (no canvas filter here: the same adjustments are made on the pixels)
    const c = (layers[0] ??= document.createElement("canvas"));
    c.width = w;
    c.height = h;
    if (!adjustInto(c, draw, a, refDev)) return body(ctx);
    out = c;
  }
  const inner = shadowOf(a, "inner");
  if (inner) {
    // the inside of the edge: what is not under the object moved by the offset, blurred, kept where the object is
    const g2 = layer(2, w, h);
    g2.fillStyle = rgba(inner.colour, 1);
    g2.fillRect(0, 0, w, h);
    g2.globalCompositeOperation = "destination-out";
    g2.drawImage(out, inner.x * OFFSET * refDev, inner.y * OFFSET * refDev);
    const g3 = layer(3, w, h);
    if (inner.blur) g3.filter = `blur(${(inner.blur * SOFT * refDev).toFixed(2)}px)`;
    g3.drawImage(g2.canvas, 0, 0);
    g3.filter = "none";
    g3.globalCompositeOperation = "destination-in";
    g3.drawImage(out, 0, 0);
    const base = out.getContext("2d")!;
    base.globalCompositeOperation = "source-atop";
    base.globalAlpha = inner.opacity;
    base.drawImage(g3.canvas, 0, 0);
    base.globalAlpha = 1;
    base.globalCompositeOperation = "source-over";
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const drop = shadowOf(a, "drop");
  if (drop) {
    ctx.shadowColor = rgba(drop.colour, drop.opacity);
    ctx.shadowBlur = 2 * drop.blur * SOFT * refDev; // (the canvas takes twice the standard deviation)
    ctx.shadowOffsetX = drop.x * OFFSET * refDev;
    ctx.shadowOffsetY = drop.y * OFFSET * refDev;
  }
  if (po.obj.blend) ctx.globalCompositeOperation = po.obj.blend;
  ctx.drawImage(out, x0, y0);
  ctx.restore();
}
