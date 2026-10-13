import type { Viewport } from "../core/camera";
import type { FrameDot, FrameView } from "../scene/frame-index";
import { densityQuery } from "../scene/spatial-index";

/**
 * Density preview (ADR 0010): content too small to draw object by object
 * (the index's sub-pixel levels) is shown as soft colour where it is, instead
 * of disappearing. A cluster of strokes seen from far away becomes a faint
 * patch of their mean colour, darker where there is more ink.
 *
 * Each summary square from the index spreads its covered fraction over the
 * CSS pixels it overlaps (by overlap area). A pixel's total coverage A
 * becomes opacity 1 − e^(−A): sparse ink adds up roughly linearly, and dense
 * ink saturates smoothly instead of clipping. Colour is the coverage-weighted
 * mean. The result is drawn behind all individually drawn objects.
 *
 * Presence floor: the pixel holding the centre of any summary square with
 * ink is at least PRESENCE_ALPHA opaque, so content far smaller than a pixel
 * stays discoverable as a faint dot you can zoom into (as individually drawn
 * strokes never get thinner than 0.6 px). Ink elsewhere is not inflated.
 *
 * It is a preview, not exact rendering: geometry inside a pixel is not
 * resolved, and sub-pixel content does not interleave with visible objects
 * by paint order. It never affects documents, selection or hit testing.
 */
/** Minimum opacity of a pixel that holds sub-pixel content. */
export const PRESENCE_ALPHA = 0.35;

export class DensityLayer {
  enabled = true;
  /** Squares drawn in the last frame that had any (diagnostics and tests). */
  lastCells = 0;
  private canvas: HTMLCanvasElement | null = null;
  private acc = new Float32Array(0);
  private presence = new Uint8Array(0);
  // View lists (one per camera, see FrameIndex.views) and viewports are replaced, never mutated: identity is the cache key.
  private lastViews: readonly FrameView[] | null = null;
  private lastVp: Viewport | null = null;
  private lastRev = -1;
  private cached: { x: number; y: number; w: number; h: number } | null = null;

  /** Draw the preview for this frame into `ctx` (transform: CSS px → device). */
  /** `dots`: frames whose whole content is below a pixel (FrameIndex.dots), drawn as points. */
  draw(ctx: CanvasRenderingContext2D, views: readonly FrameView[], dots: readonly FrameDot[], vp: Viewport, docRevision: number): void {
    if (!this.enabled) return;
    if (views !== this.lastViews || vp !== this.lastVp || docRevision !== this.lastRev) {
      this.lastViews = views;
      this.lastVp = vp;
      this.lastRev = docRevision;
      this.cached = dots.length || views.some((v) => v.index.hasSubPixelLevels(v.cam)) ? this.render(views, dots, vp) : null;
      if (!this.cached) this.lastCells = 0;
    }
    const c = this.cached;
    if (c && this.canvas) ctx.drawImage(this.canvas, 0, 0, c.w, c.h, c.x, c.y, c.w, c.h);
  }

  /** Accumulate and rasterize; returns the touched rectangle (CSS px) or null. */
  private render(views: readonly FrameView[], dots: readonly FrameDot[], vp: Viewport): { x: number; y: number; w: number; h: number } | null {
    // Each frame's squares come from its own index, queried with the camera in its coordinates.
    const cells = views.flatMap((v) => densityQuery(v.index, v.cam, vp, 2).cells);
    for (const d of dots) {
      const size = 2 ** -11; // a point (see below)
      cells.push({ x: vp.width / 2 + d.dx, y: vp.height / 2 + d.dy, size, cover: d.areaPx / size / size, r: d.ink.r / d.ink.a, g: d.ink.g / d.ink.a, b: d.ink.b / d.ink.a });
    }
    this.lastCells = cells.length;
    if (!cells.length) return null;
    const W = Math.ceil(vp.width);
    const H = Math.ceil(vp.height);
    if (this.acc.length < W * H * 5) {
      this.acc = new Float32Array(W * H * 5);
      this.presence = new Uint8Array(W * H);
    }
    const acc = this.acc;
    const presence = this.presence;
    let bx0 = W;
    let by0 = H;
    let bx1 = -1;
    let by1 = -1;
    const touch = (px: number, py: number): void => {
      if (px < bx0) bx0 = px;
      if (px > bx1) bx1 = px;
      if (py < by0) by0 = py;
      if (py > by1) by1 = py;
    };
    const add = (px: number, py: number, a: number, wt: number, c: { r: number; g: number; b: number }): void => {
      const i = (py * W + px) * 5;
      acc[i] = acc[i]! + a;
      acc[i + 1] = acc[i + 1]! + wt;
      acc[i + 2] = acc[i + 2]! + wt * c.r;
      acc[i + 3] = acc[i + 3]! + wt * c.g;
      acc[i + 4] = acc[i + 4]! + wt * c.b;
      touch(px, py);
    };
    for (const c of cells) {
      if (c.size < 2 ** -10) {
        // Far below a pixel (possibly below one double step at this screen
        // position, so its edges would coincide): a point at its centre.
        const px = Math.floor(c.x);
        const py = Math.floor(c.y);
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        // Its coverage may underflow to 0; its colour still counts (a small fixed weight).
        add(px, py, c.cover * c.size * c.size, 1e-20, c);
        presence[py * W + px] = 1;
        touch(px, py);
        continue;
      }
      const x0 = Math.max(0, c.x);
      const y0 = Math.max(0, c.y);
      const x1 = Math.min(W, c.x + c.size);
      const y1 = Math.min(H, c.y + c.size);
      if (x1 <= x0 || y1 <= y0) continue;
      // Coverage per px² of the square (cover is a fraction of the square's area).
      const k = c.cover;
      const cx = Math.floor(c.x + c.size / 2);
      const cy = Math.floor(c.y + c.size / 2);
      if (cx >= 0 && cx < W && cy >= 0 && cy < H) presence[cy * W + cx] = 1;
      for (let py = Math.floor(y0); py < y1; py++) {
        const oy = Math.min(y1, py + 1) - Math.max(y0, py);
        if (oy <= 0) continue;
        for (let px = Math.floor(x0); px < x1; px++) {
          const ox = Math.min(x1, px + 1) - Math.max(x0, px);
          if (ox <= 0) continue;
          const a = k * ox * oy;
          add(px, py, a, a, c);
        }
      }
    }
    if (bx1 < 0) return null;
    const w = bx1 - bx0 + 1;
    const h = by1 - by0 + 1;
    this.canvas ??= document.createElement("canvas");
    if (this.canvas.width < w) this.canvas.width = w;
    if (this.canvas.height < h) this.canvas.height = h;
    const cctx = this.canvas.getContext("2d")!;
    const img = cctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (by0 + y) * W + bx0 + x;
        const i = p * 5;
        const wt = acc[i + 1]!;
        if (wt > 0) {
          const o = (y * w + x) * 4;
          d[o] = acc[i + 2]! / wt;
          d[o + 1] = acc[i + 3]! / wt;
          d[o + 2] = acc[i + 4]! / wt;
          const alpha = 1 - Math.exp(-acc[i]!);
          d[o + 3] = 255 * (presence[p] ? Math.max(alpha, PRESENCE_ALPHA) : alpha);
          acc[i] = acc[i + 1] = acc[i + 2] = acc[i + 3] = acc[i + 4] = 0; // leave the buffers clean for the next frame
          presence[p] = 0;
        }
      }
    }
    cctx.putImageData(img, 0, 0);
    return { x: bx0, y: by0, w, h };
  }
}
