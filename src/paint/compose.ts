/**
 * Drawing a page (ADR 0165): its background and its layers bottom to top, each with its opacity and blend mode, clipped to the layer
 * below when it says so, the layer being painted with its live stroke over it. One function draws the view (at the camera, with a
 * checkerboard where the page is transparent) and an export (at 1:1), so what is exported is what is seen.
 */
import type { Layer, Page } from "./model";
import { clipBaseOf } from "./model";

export interface Live {
  readonly layerId: string;
  /** The stroke as far as it has come, page-sized, in page px. */
  readonly overlay: CanvasImageSource;
  /** How it goes over its layer: normally, inside its paint (alpha lock), or taking it away (erasing). */
  readonly op: GlobalCompositeOperation;
}

export interface Scene {
  readonly page: Page;
  /** The page's layers, bottom first. */
  readonly stack: readonly Layer[];
  /** A layer's pixels, page-sized in page px (null: nothing to draw yet). */
  image(l: Layer): CanvasImageSource | null;
  readonly live?: Live | null;
}

/** Where the page is in the target: target px = page px · scale + (x, y). */
export interface Placement {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  /** Show a transparent page as a checkerboard (the view; an export keeps the transparency). */
  readonly checker?: boolean;
}

const scratch: HTMLCanvasElement[] = [];
/** A scratch layer as big as the target, cleared, with no transform. */
function layerCtx(i: number, w: number, h: number): CanvasRenderingContext2D {
  const c = (scratch[i] ??= document.createElement("canvas"));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, w, h);
  return g;
}

let checkerPattern: { ctx: CanvasRenderingContext2D; p: CanvasPattern } | null = null;
function checker(ctx: CanvasRenderingContext2D, light: string, dark: string): CanvasPattern {
  if (checkerPattern?.ctx === ctx) return checkerPattern.p;
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d")!;
  g.fillStyle = light;
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = dark;
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  checkerPattern = { ctx, p: ctx.createPattern(c, "repeat")! };
  return checkerPattern.p;
}

/** Pixels stay square when magnified (as a painting program shows them), smooth when made smaller. */
function smoothing(g: CanvasRenderingContext2D, scale: number): void {
  g.imageSmoothingEnabled = scale < 2;
  g.imageSmoothingQuality = "high";
}

/**
 * Draw the page into `ctx` (its current transform is ignored: `at` places the page). `colours` are the checkerboard's (theme tokens read
 * by the caller).
 */
export function composePage(ctx: CanvasRenderingContext2D, s: Scene, at: Placement, colours: { light: string; dark: string } = { light: "#ffffff", dark: "#d9d9d9" }): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const { page } = s;
  const place = (g: CanvasRenderingContext2D): void => {
    g.setTransform(at.scale, 0, 0, at.scale, at.x, at.y);
    smoothing(g, at.scale);
  };
  ctx.save();
  place(ctx);
  ctx.beginPath();
  ctx.rect(0, 0, page.w, page.h);
  ctx.clip(); // (nothing past the page's edge)
  if (page.bg) {
    ctx.fillStyle = page.bg;
    ctx.fillRect(0, 0, page.w, page.h);
  } else if (at.checker) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = checker(ctx, colours.light, colours.dark);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  /** A layer's own look (its pixels, and its live stroke when it is the one painted), on a scratch layer in target px; null: none. */
  const look = (l: Layer, slot: number): HTMLCanvasElement | CanvasImageSource | null => {
    const img = s.image(l);
    const live = s.live && s.live.layerId === l.id ? s.live : null;
    if (!live) return img;
    const g = layerCtx(slot, W, H);
    place(g);
    if (img) g.drawImage(img, 0, 0);
    g.globalCompositeOperation = live.op;
    g.drawImage(live.overlay, 0, 0);
    return g.canvas;
  };
  const isTarget = (img: CanvasImageSource): boolean => scratch.includes(img as HTMLCanvasElement);
  for (let i = 0; i < s.stack.length; i++) {
    const l = s.stack[i]!;
    if (l.hidden) continue;
    const base = l.clipBelow ? clipBaseOf(s.stack, i) : undefined;
    if (base?.hidden) continue; // (a clipped layer shows only where its base does)
    let img = look(l, 0);
    if (!img) continue;
    if (base) {
      const b = look(base, 1);
      if (!b) continue;
      const g = layerCtx(2, W, H);
      if (isTarget(img)) g.drawImage(img, 0, 0);
      else {
        place(g);
        g.drawImage(img, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
      g.globalCompositeOperation = "destination-in";
      if (isTarget(b)) g.drawImage(b, 0, 0);
      else {
        place(g);
        g.drawImage(b, 0, 0);
      }
      img = g.canvas;
    }
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend ?? "source-over";
    if (isTarget(img)) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    } else ctx.drawImage(img, 0, 0);
  }
  ctx.restore();
}
