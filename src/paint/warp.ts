/**
 * Drawing a picture into any four-cornered shape (free and perspective transform of pixels). A parallelogram (moved, scaled, turned,
 * slanted) is one affine draw, exact; any other shape is a perspective: the picture's square is mapped by a homography and drawn as a mesh
 * of small triangles, each an affine draw clipped to itself.
 */

export type Pt = readonly [number, number];
/** Top left, top right, bottom right, bottom left, in page px. */
export type Quad = readonly [Pt, Pt, Pt, Pt];

const MESH = 24;

/** Whether a quad is a parallelogram (an affine image of a rectangle), within a hundredth of a px. */
export function isAffine(q: Quad): boolean {
  return Math.abs(q[0][0] + q[2][0] - q[1][0] - q[3][0]) < 0.01 && Math.abs(q[0][1] + q[2][1] - q[1][1] - q[3][1]) < 0.01;
}

/** The point of the quad at (u, v) of the unit square (0,0 its top left, 1,1 its bottom right): the square-to-quad homography. */
export function quadPoint(q: Quad, u: number, v: number): Pt {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0, h = den ? (dx1 * dy3 - dx3 * dy1) / den : 0;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  const w = g * u + h * v + 1;
  return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w];
}

/** Draw `img` (its whole box) into quad `q`, in the context's current transform. */
export function drawWarp(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, q: Quad): void {
  const w = img.width, h = img.height;
  if (!w || !h) return;
  if (isAffine(q)) {
    g.save();
    g.transform((q[1][0] - q[0][0]) / w, (q[1][1] - q[0][1]) / w, (q[3][0] - q[0][0]) / h, (q[3][1] - q[0][1]) / h, q[0][0], q[0][1]);
    g.drawImage(img, 0, 0);
    g.restore();
    return;
  }
  const at = (i: number, j: number): Pt => quadPoint(q, i / MESH, j / MESH);
  for (let j = 0; j < MESH; j++) {
    for (let i = 0; i < MESH; i++) {
      const s00: Pt = [(i / MESH) * w, (j / MESH) * h], s11: Pt = [((i + 1) / MESH) * w, ((j + 1) / MESH) * h];
      const s10: Pt = [s11[0], s00[1]], s01: Pt = [s00[0], s11[1]];
      const d00 = at(i, j), d10 = at(i + 1, j), d11 = at(i + 1, j + 1), d01 = at(i, j + 1);
      triangle(g, img, [s00, s10, s11], [d00, d10, d11]);
      triangle(g, img, [s00, s11, s01], [d00, d11, d01]);
    }
  }
}

/** One triangle of the picture (`s`, in its px) drawn onto triangle `d`, clipped to it (grown a little, so no seam shows between two). */
function triangle(g: CanvasRenderingContext2D, img: CanvasImageSource, s: readonly [Pt, Pt, Pt], d: readonly [Pt, Pt, Pt]): void {
  const [[u0, v0], [u1, v1], [u2, v2]] = s;
  const [[x0, y0], [x1, y1], [x2, y2]] = d;
  const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (!den) return;
  // the affine map with (u, v) → (x, y) at the three corners
  const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den;
  const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den;
  const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den;
  const e = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den;
  const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
  const grow = (x: number, y: number): Pt => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * 0.6, y + ((y - cy) / l) * 0.6];
  };
  g.save();
  g.beginPath();
  for (const [i, [x, y]] of [grow(x0, y0), grow(x1, y1), grow(x2, y2)].entries()) (i ? g.lineTo(x, y) : g.moveTo(x, y));
  g.closePath();
  g.clip();
  g.transform(a, b, c, e, x0 - a * u0 - c * v0, y0 - b * u0 - e * v0);
  g.drawImage(img, 0, 0);
  g.restore();
}
