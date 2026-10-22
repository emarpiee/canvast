/** The Eyedropper (one tool for both views): what it reads under the pointer. */

/** The sides of the square it can average, in px (1: the one pixel). */
export const SAMPLE_SIZES = [1, 3, 5, 11, 31, 51, 101] as const;

/** The colour of a canvas round (x, y), in its own px: the mean of the size × size square there, weighted by alpha; null where it is all clear. */
export function sampleAt(c: HTMLCanvasElement, x: number, y: number, size: number): string | null {
  const h = Math.floor(size / 2), cx = Math.floor(x), cy = Math.floor(y);
  const x0 = Math.max(0, cx - h), y0 = Math.max(0, cy - h), x1 = Math.min(c.width, cx + h + 1), y1 = Math.min(c.height, cy + h + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  const d = c.getContext("2d")!.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3]!;
    r += d[i]! * w;
    g += d[i + 1]! * w;
    b += d[i + 2]! * w;
    a += w;
  }
  return a ? `#${[r, g, b].map((v) => Math.round(v / a).toString(16).padStart(2, "0")).join("")}` : null;
}
