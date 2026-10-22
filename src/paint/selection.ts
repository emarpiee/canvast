/**
 * Pixel selections of the Paint view: a page-sized canvas whose alpha is how much of each pixel is selected (255: all, 0: none; between:
 * a feathered edge). Every way of making one (marquee, lasso, magic wand) gives such a mask; the modes, feather, grow, shrink and invert
 * work on masks, so painting, filling and moving read one thing.
 */

export type SelectMode = "new" | "add" | "subtract" | "intersect";

/** A blank mask of the page's size. */
export function blankMask(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** A mask of a shape drawn by `draw` (a path in page px, filled opaque). */
export function shapeMask(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = blankMask(w, h);
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.beginPath();
  draw(g);
  g.fill();
  return c;
}

/** `next` with its edge softened by `feather` px (a blur of the mask). */
export function feathered(next: HTMLCanvasElement, feather: number): HTMLCanvasElement {
  if (feather <= 0) return next;
  const c = blankMask(next.width, next.height);
  const g = c.getContext("2d")!;
  g.filter = `blur(${feather / 2}px)`;
  g.drawImage(next, 0, 0);
  return c;
}

/** The selection after `next` is made in `mode` over `base` (null: nothing selected). Null when nothing is left. */
export function combine(base: HTMLCanvasElement | null, next: HTMLCanvasElement, mode: SelectMode): HTMLCanvasElement | null {
  if (mode === "new" || !base) return mode === "subtract" || mode === "intersect" ? null : next;
  const c = blankMask(base.width, base.height);
  const g = c.getContext("2d")!;
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = mode === "add" ? "source-over" : mode === "subtract" ? "destination-out" : "destination-in";
  g.drawImage(next, 0, 0);
  return isClear(c) ? null : c;
}

/** Everything not selected (on a page of the mask's size). */
export function inverted(m: HTMLCanvasElement): HTMLCanvasElement | null {
  const c = blankMask(m.width, m.height);
  const g = c.getContext("2d")!;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-out";
  g.drawImage(m, 0, 0);
  return isClear(c) ? null : c;
}

/** The selection made `by` px larger (positive) or smaller (negative): its edge moved out or in, kept hard. */
export function grown(m: HTMLCanvasElement, by: number): HTMLCanvasElement | null {
  if (!by) return m;
  // (a Gaussian blur of sigma by/2 is down to about 2.3 % (alpha 5.8) at 2 sigma = by past a straight edge: kept from there, it moves the
  // edge out by `by`; the inverted mask grown shrinks it)
  const src = by > 0 ? m : inverted(m);
  if (!src) return by > 0 ? m : null;
  const b = feathered(src, Math.abs(by));
  const g = b.getContext("2d", { willReadFrequently: true })!;
  const d = g.getImageData(0, 0, b.width, b.height);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i]! > 5 ? 255 : 0;
  g.putImageData(d, 0, 0);
  return by > 0 ? (isClear(b) ? null : b) : inverted(b);
}

/** The outline of a selection: its pixels that have an unselected pixel beside them, as an opaque image (drawn over the page). */
export function edgeOf(m: HTMLCanvasElement): HTMLCanvasElement {
  const c = blankMask(m.width, m.height);
  const g = c.getContext("2d")!;
  g.drawImage(m, 0, 0);
  g.globalCompositeOperation = "destination-out";
  // (what is left of the mask after it is cut by itself moved one px each way: the pixels at its edge)
  const cut = blankMask(m.width, m.height);
  const k = cut.getContext("2d")!;
  k.drawImage(m, 0, 0);
  k.globalCompositeOperation = "destination-in";
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) k.drawImage(m, dx, dy);
  g.drawImage(cut, 0, 0);
  g.globalCompositeOperation = "source-in"; // (white, for a difference over the page)
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Whether nothing is selected in a mask. */
export function isClear(m: HTMLCanvasElement): boolean {
  const d = m.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, m.width, m.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}

/**
 * The magic wand: the pixels of `img` within `tolerance` (0 to 255, on each channel and alpha) of the pixel at (x, y), only those joined
 * to it when `contiguous`, as a mask of the image's size.
 */
export function wandMask(img: ImageData, x: number, y: number, tolerance: number, contiguous: boolean): HTMLCanvasElement {
  const { width: w, height: h, data: d } = img;
  const out = new ImageData(w, h);
  const o = out.data;
  const at = (Math.floor(y) * w + Math.floor(x)) * 4;
  const r = d[at]!, gg = d[at + 1]!, b = d[at + 2]!, a = d[at + 3]!;
  const near = (i: number): boolean => Math.abs(d[i]! - r) <= tolerance && Math.abs(d[i + 1]! - gg) <= tolerance && Math.abs(d[i + 2]! - b) <= tolerance && Math.abs(d[i + 3]! - a) <= tolerance;
  if (!contiguous) {
    for (let i = 0; i < d.length; i += 4) if (near(i)) o[i + 3] = 255;
  } else {
    const seen = new Uint8Array(w * h);
    const stack = [Math.floor(y) * w + Math.floor(x)];
    seen[stack[0]!] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      if (!near(p * 4)) continue;
      o[p * 4 + 3] = 255;
      const px = p % w;
      for (const q of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q]) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  const c = blankMask(w, h);
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c;
}
