/**
 * The kinds of blur besides the usual soft one, and pixelate (ADR 0189). A soft blur is the canvas's own filter; these are made from copies of the
 * layer laid over each other on the graphics card (shifted along a line, scaled out from the middle, or turned round it), each the average of what
 * came before, then softened a little so the copies do not show as steps. Nothing is read back from the graphics card.
 */
import type { Adjust, BlurType } from "../doc/adjust";

const scratch: HTMLCanvasElement[] = [];
function layer(i: number, w: number, h: number): CanvasRenderingContext2D {
  const c = (scratch[i] ??= document.createElement("canvas"));
  c.width = w; // (also clears it)
  c.height = h;
  return c.getContext("2d")!;
}

/** Most copies laid over each other: enough for a smooth streak, few enough to stay quick. */
const MAX_COPIES = 40;

/**
 * `src` blurred by `type`, as wide as a soft blur of standard deviation `sigma` (px) spreads (about 6 sigma end to end): a motion blur along
 * `angle` (degrees), a zoom blur out from the middle, a spin blur round it. Returns a canvas of the same size (one of this module's own).
 */
export function typedBlur(src: HTMLCanvasElement, type: BlurType, sigma: number, o: Pick<Adjust, "blurAngle" | "blurOffset" | "blurQuality" | "blurCenterX" | "blurCenterY"> = {}): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const len = 6 * sigma;
  const half = Math.max(1, Math.max(w, h) / 2);
  // (Quality: fewer or more copies than the usual, ADR 0190)
  const q = 2 ** ((o.blurQuality ?? 0) / 50);
  const n = Math.max(4, Math.min(MAX_COPIES * 4, Math.ceil(Math.max(6, Math.min(MAX_COPIES, Math.ceil(len / 2))) * q)));
  const g = layer(0, w, h);
  // (Centre: the middle of a zoom or spin, a share of half the layer from its middle)
  const cx = w / 2 + ((o.blurCenterX ?? 0) / 100) * (w / 2), cy = h / 2 + ((o.blurCenterY ?? 0) / 100) * (h / 2);
  const rad = ((o.blurAngle ?? 0) * Math.PI) / 180;
  const shift = (o.blurOffset ?? 0) / 200; // (Offset: the streak behind or ahead of the picture instead of on both sides)
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1) - 0.5 + shift; // (from -½ to ½ of the streak, moved by the offset)
    g.globalAlpha = 1 / (k + 1); // (each copy the average of those before it)
    if (type === "motion") g.setTransform(1, 0, 0, 1, Math.cos(rad) * len * f, Math.sin(rad) * len * f);
    else if (type === "zoom") {
      const s = 1 + Math.min(1, len / half) * (f + 0.5); // (outward only: the middle stays where it is)
      g.setTransform(s, 0, 0, s, cx - cx * s, cy - cy * s);
    } else {
      const t = Math.min(Math.PI / 2, len / half) * f;
      const c = Math.cos(t), si = Math.sin(t);
      g.setTransform(c, si, -si, c, cx - c * cx + si * cy, cy - si * cx - c * cy);
    }
    g.drawImage(src, 0, 0);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  // (softened by the step between copies, so the streak is smooth)
  const out = layer(1, w, h);
  const step = len / n;
  if (step > 0.5) out.filter = `blur(${(step / 2).toFixed(2)}px)`;
  out.drawImage(g.canvas, 0, 0);
  out.filter = "none";
  return out.canvas;
}

/** `c` made of square cells `cell` px wide (each one colour): drawn small with no smoothing, then large again; `dots`: each cell a round dot. */
export function pixelateInto(c: HTMLCanvasElement, cell: number, dots = false): void {
  if (!(cell >= 2)) return;
  const w = c.width, h = c.height;
  const sw = Math.max(1, Math.round(w / cell)), sh = Math.max(1, Math.round(h / cell));
  const small = layer(2, sw, sh);
  small.imageSmoothingEnabled = true;
  small.imageSmoothingQuality = "high";
  small.drawImage(c, 0, 0, sw, sh);
  const g = c.getContext("2d")!;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.imageSmoothingEnabled = false;
  g.drawImage(small.canvas, 0, 0, sw, sh, 0, 0, w, h);
  if (dots) {
    // (round cells: a dot in each, the rest cleared; one pattern stretched to the cells, so it is one draw however many there are)
    const DOT = 64;
    const d = layer(3, DOT, DOT);
    d.beginPath();
    d.arc(DOT / 2, DOT / 2, DOT * 0.46, 0, Math.PI * 2);
    d.fill();
    const pat = g.createPattern(d.canvas, "repeat");
    if (pat) {
      pat.setTransform(new DOMMatrix().scale(w / sw / DOT, h / sh / DOT));
      g.globalCompositeOperation = "destination-in";
      g.fillStyle = pat;
      g.fillRect(0, 0, w, h);
    }
  }
  g.restore();
}

/** A pixelate cell (px) for a pixelate of `amount` (0 to 100) on an object `ref` px across: at 100 a tenth of it. */
export const pixelCell = (amount: number, ref: number): number => (amount / 100) * 0.1 * ref;
