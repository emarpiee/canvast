/**
 * Drawing a page (ADR 0165, 0166): its background and its layers bottom to top, each with its opacity and blend mode, clipped to the layer
 * below when it says so. How a layer looks is its kind's entry in `RENDER` (typed over the kinds: a new kind does not compile without one):
 * a paint layer is its pixels (with its live stroke while it is painted), a shape layer and a fill layer are drawn by the canvas's own
 * renderer (objects.ts), an adjustment layer is what is below it, adjusted (the canvas's adjustment maths, `adjustInto`). The clip, the
 * opacity and the blend are the same for every kind. One function draws the view (at the camera, with a checkerboard where the page is
 * transparent) and an export (at 1:1), so what is exported is what is seen.
 */
import type { Layer, LayerKind, Page } from "./model";
import { clipBaseOf } from "./model";
import { drawObjectsAt, fillObject, objectsOf, type ObjectEnv } from "./objects";
import { adjustInto } from "../render/adjust-image";
import { isNeutral } from "../doc/adjust";

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
  /** A paint layer's pixels, page-sized in page px (null: nothing to draw yet). */
  image(l: Layer): CanvasImageSource | null;
  readonly live?: Live | null;
  /** What the canvas's renderer needs for shape, text, picture and fill layers. */
  readonly env?: ObjectEnv | null;
  /** The vector layer being edited, drawn as the gesture going on shows it (vector-host.ts); null: not that layer. True: draw again soon. */
  readonly vector?: ((id: string, g: CanvasRenderingContext2D, at: Placement) => boolean | null) | null;
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
  g.filter = "none";
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

/** What a kind's renderer is given: the scene, the placement, the target drawn so far (the page below this layer), and a scratch slot. */
interface Ctx {
  readonly s: Scene;
  readonly at: Placement;
  readonly below: CanvasRenderingContext2D;
  readonly slot: number;
  /** A picture of the layer was not decoded yet: draw again soon. */
  pending: boolean;
}

/**
 * A layer's look, as a target-sized image (no transform), or null for nothing. `replaces`: the image is what the page below becomes (an
 * adjustment), not something put over it.
 */
type Look = { readonly img: HTMLCanvasElement; readonly replaces?: true } | null;

const place = (g: CanvasRenderingContext2D, at: Placement): void => {
  g.setTransform(at.scale, 0, 0, at.scale, at.x, at.y);
  smoothing(g, at.scale);
};

export const RENDER: { readonly [K in LayerKind]: (l: Extract<Layer, { kind: K }>, c: Ctx) => Look } = {
  raster(l, c) {
    const img = c.s.image(l);
    const live = c.s.live && c.s.live.layerId === l.id ? c.s.live : null;
    if (!img && !live) return null;
    const g = layerCtx(c.slot, c.below.canvas.width, c.below.canvas.height);
    place(g, c.at);
    if (img) g.drawImage(img, 0, 0);
    if (live) {
      g.globalCompositeOperation = live.op;
      g.drawImage(live.overlay, 0, 0);
    }
    return { img: g.canvas };
  },
  object(l, c) {
    if (!c.s.env) return null;
    const g = layerCtx(c.slot, c.below.canvas.width, c.below.canvas.height);
    if (c.s.vector?.(l.id, g, c.at) ?? drawObjectsAt(g, objectsOf(l.objs), c.at, c.s.env)) c.pending = true;
    return { img: g.canvas };
  },
  fill(l, c) {
    if (!c.s.env) return null;
    const g = layerCtx(c.slot, c.below.canvas.width, c.below.canvas.height);
    if (drawObjectsAt(g, [fillObject(l.paint, c.s.page.w, c.s.page.h)], c.at, c.s.env)) c.pending = true;
    return { img: g.canvas };
  },
  adjust(l, c) {
    if (isNeutral(l.adjust)) return null;
    const g = layerCtx(c.slot, c.below.canvas.width, c.below.canvas.height);
    // (a blur of 100 % is 2 % of the page's longer side, whatever the zoom, so the look does not change when zooming)
    if (!adjustInto(g.canvas, (x) => x.drawImage(c.below.canvas, 0, 0), l.adjust, Math.max(c.s.page.w, c.s.page.h) * c.at.scale)) return null;
    return { img: g.canvas, replaces: true };
  },
};

const lookOf = (l: Layer, c: Ctx): Look => (RENDER[l.kind] as (l: Layer, c: Ctx) => Look)(l, c);

/**
 * Draw the page into `ctx` (its current transform is ignored: `at` places the page). `colours` are the checkerboard's (theme tokens read by
 * the caller). True: something was not ready to draw (a picture still decoding): draw again soon.
 */
export function composePage(ctx: CanvasRenderingContext2D, s: Scene, at: Placement, colours: { light: string; dark: string } = { light: "#ffffff", dark: "#d9d9d9" }): boolean {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const { page } = s;
  ctx.save();
  place(ctx, at);
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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let pending = false;
  for (let i = 0; i < s.stack.length; i++) {
    const l = s.stack[i]!;
    if (l.hidden) continue;
    const base = l.clipBelow ? clipBaseOf(s.stack, i) : undefined;
    if (base?.hidden) continue; // (a clipped layer shows only where its base does)
    const c: Ctx = { s, at, below: ctx, slot: 0, pending: false };
    const look = lookOf(l, c);
    if (!look) continue;
    let img = look.img;
    if (base) {
      const bc: Ctx = { s, at, below: ctx, slot: 1, pending: false };
      const b = lookOf(base, bc);
      pending ||= bc.pending;
      if (!b) continue;
      const g = layerCtx(2, W, H);
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(b.img, 0, 0);
      img = g.canvas;
    }
    pending ||= c.pending;
    ctx.globalAlpha = l.opacity;
    // (an adjustment at full opacity, not clipped, takes the place of what is below; otherwise it goes over it)
    ctx.globalCompositeOperation = look.replaces && !base && l.opacity >= 1 && !l.blend ? "copy" : (l.blend ?? "source-over");
    ctx.drawImage(img, 0, 0);
  }
  ctx.restore();
  return pending;
}

/** One layer alone at 1:1 on a transparent page-sized target (Rasterize; ADR 0166): the same renderer as the view and exports. */
export function drawLayerAlone(g: CanvasRenderingContext2D, s: Scene, l: Layer): boolean {
  return composePage(g, { ...s, page: { ...s.page, bg: null }, stack: [l] }, { scale: 1, x: 0, y: 0 });
}
