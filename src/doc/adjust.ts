/**
 * Non-destructive adjustments of a picture (ADR 0118): numbers kept on the instance, applied when it is drawn, so the original is
 * never touched and every number can be changed again. Each is from -100 to 100 (0: no change), except blur, sharpen and grain, which
 * are 0 to 100. `adjustPixel` is the whole of the colour part, one pixel at a time, so a picture seen magnified (each source pixel a big
 * rectangle), seen from so far in that it is one colour, and drawn at ordinary size all agree.
 */
import type { GradientStop } from "./paint";
import { MAX_STOPS, isColour, stopsAt } from "./paint";

/** A gradient map (ADR 0122): the brightness of each pixel is looked up in a gradient, and `amount` (1 to 100) says how far the picture goes towards it. Transparency in the gradient is not used. */
export interface GradientMap {
  readonly stops: readonly GradientStop[];
  readonly amount: number;
}

export interface Adjust {
  readonly map?: GradientMap;
  readonly exposure?: number;
  readonly contrast?: number;
  readonly highlights?: number;
  readonly shadows?: number;
  readonly temperature?: number;
  readonly tint?: number;
  readonly saturation?: number;
  readonly vibrance?: number;
  readonly blur?: number;
  readonly sharpen?: number;
  readonly grain?: number;
}

export type AdjustKey = Exclude<keyof Adjust, "map">;

export interface AdjustSpec {
  readonly key: AdjustKey;
  readonly label: string;
  readonly min: number;
  /** Part of the colour of each pixel (true), or needs the pixels around it (false). */
  readonly pointwise: boolean;
}

/** In the order they are offered. */
export const ADJUSTMENTS: readonly AdjustSpec[] = [
  { key: "exposure", label: "Exposure", min: -100, pointwise: true },
  { key: "contrast", label: "Contrast", min: -100, pointwise: true },
  { key: "highlights", label: "Highlights", min: -100, pointwise: true },
  { key: "shadows", label: "Shadows", min: -100, pointwise: true },
  { key: "temperature", label: "Temperature", min: -100, pointwise: true },
  { key: "tint", label: "Tint", min: -100, pointwise: true },
  { key: "saturation", label: "Saturation", min: -100, pointwise: true },
  { key: "vibrance", label: "Vibrance", min: -100, pointwise: true },
  { key: "blur", label: "Blur", min: 0, pointwise: false },
  { key: "sharpen", label: "Sharpen", min: 0, pointwise: false },
  { key: "grain", label: "Grain", min: 0, pointwise: false },
];

/** Whether anything is changed (an adjustment of 0 is none). */
export const isNeutral = (a: Adjust | undefined): boolean => !a || (!a.map && ADJUSTMENTS.every((s) => !a[s.key]));

/** Whether `m` is a gradient map the document accepts (2 to 32 ordered stops, an amount of 1 to 100). */
export function validMap(m: unknown): m is GradientMap {
  const g = m as { stops?: unknown; amount?: unknown } | null;
  if (!g || typeof g !== "object" || !Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > MAX_STOPS) return false;
  if (typeof g.amount !== "number" || !Number.isInteger(g.amount) || g.amount < 1 || g.amount > 100) return false;
  let last = 0;
  for (const s of g.stops as Array<Record<string, unknown>>) {
    if (!s || typeof s["o"] !== "number" || s["o"] < last || s["o"] > 1 || !isColour(s["c"])) return false;
    last = s["o"];
  }
  return true;
}

/** Whether the pictures around a pixel matter (blur, sharpen, grain): such an adjustment is drawn at the size seen, never at depth. */
export const needsNeighbours = (a: Adjust | undefined): boolean => !!a && (!!a.blur || !!a.sharpen || !!a.grain);

/** The adjustments with only the nonzero numbers, in range; undefined when nothing is left. */
export function cleanAdjust(a: Adjust): Adjust | undefined {
  const out: Record<string, unknown> = {};
  if (a.map && validMap({ ...a.map, amount: Math.round(a.map.amount) })) out["map"] = { stops: a.map.stops.map((s) => ({ o: s.o, c: s.c.toLowerCase() })), amount: Math.round(a.map.amount) };
  for (const s of ADJUSTMENTS) {
    const v = a[s.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const c = Math.max(s.min, Math.min(100, Math.round(v)));
    if (c !== 0) out[s.key] = c;
  }
  return Object.keys(out).length ? (out as Adjust) : undefined;
}

/** A short text that differs whenever the adjustments do (to cache what was drawn with them). */
export const adjustKey = (a: Adjust | undefined): string => (a ? ADJUSTMENTS.map((s) => a[s.key] ?? 0).join(",") + (a.map ? `|${a.map.amount}:${a.map.stops.map((s) => `${s.o}${s.c}`).join(",")}` : "") : "");

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
/** sRGB byte to linear light, and back (a table of 4096 steps): exposure works in linear light, and a table is far quicker than a power. */
const S2L = new Float32Array(256);
const L2S = new Uint8ClampedArray(4097);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  S2L[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
for (let i = 0; i <= 4096; i++) {
  const c = i / 4096;
  L2S[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
}

/**
 * The colour part of the adjustments made ready once, as a function that changes the first three bytes of the pixel at `i` of `d` in place
 * (RGBA bytes). It allocates nothing, so it can run over every pixel of a picture while a slider is dragged.
 */
export function prepare(a: Adjust): (d: { [i: number]: number }, i: number) => void {
  const expK = a.exposure ? 2 ** ((a.exposure / 100) * 2) : 0;
  const t = (a.temperature ?? 0) / 100, n = (a.tint ?? 0) / 100;
  const warm = !!(t || n);
  const rMul = 1 + 0.25 * t + 0.06 * n, gMul = 1 - 0.18 * n, bMul = 1 - 0.25 * t + 0.06 * n;
  const sh = ((a.shadows ?? 0) / 100) * 0.5, hi = ((a.highlights ?? 0) / 100) * 0.5;
  const tone = !!(sh || hi);
  const ck = 1 + (a.contrast ?? 0) / 100;
  const contrast = !!a.contrast;
  const sat = (a.saturation ?? 0) / 100, vib = (a.vibrance ?? 0) / 100;
  const colourful = !!(a.saturation || a.vibrance);
  // The gradient map: a table of 256 colours, one per brightness.
  const lut = a.map ? new Uint8ClampedArray(256 * 3) : null;
  const mapK = a.map ? a.map.amount / 100 : 0;
  if (lut && a.map) for (let v = 0; v < 256; v++) {
    const [r, g, b] = stopsAt(a.map.stops, v / 255);
    lut[v * 3] = r;
    lut[v * 3 + 1] = g;
    lut[v * 3 + 2] = b;
  }
  return (d, i) => {
    let R: number, G: number, B: number;
    if (expK) {
      R = L2S[Math.min(4096, Math.round(S2L[d[i]!]! * expK * 4096))]! / 255;
      G = L2S[Math.min(4096, Math.round(S2L[d[i + 1]!]! * expK * 4096))]! / 255;
      B = L2S[Math.min(4096, Math.round(S2L[d[i + 2]!]! * expK * 4096))]! / 255;
    } else {
      R = d[i]! / 255;
      G = d[i + 1]! / 255;
      B = d[i + 2]! / 255;
    }
    if (warm) {
      R *= rMul;
      G *= gMul;
      B *= bMul;
    }
    if (tone) {
      const y = 0.299 * R + 0.587 * G + 0.114 * B;
      const lift = sh * (1 - y) ** 2 - hi * y * y;
      R += lift;
      G += lift;
      B += lift;
    }
    if (contrast) {
      R = (R - 0.5) * ck + 0.5;
      G = (G - 0.5) * ck + 0.5;
      B = (B - 0.5) * ck + 0.5;
    }
    if (colourful) {
      const y = 0.299 * R + 0.587 * G + 0.114 * B;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      // vibrance lifts the dull colours more than the vivid ones
      const k = 1 + sat + vib * (1 - (mx <= 0 ? 0 : (mx - mn) / mx));
      R = y + (R - y) * k;
      G = y + (G - y) * k;
      B = y + (B - y) * k;
    }
    if (lut) {
      const y = Math.max(0, Math.min(255, Math.round((0.299 * R + 0.587 * G + 0.114 * B) * 255)));
      R += (lut[y * 3]! / 255 - R) * mapK;
      G += (lut[y * 3 + 1]! / 255 - G) * mapK;
      B += (lut[y * 3 + 2]! / 255 - B) * mapK;
    }
    d[i] = clamp(R * 255);
    d[i + 1] = clamp(G * 255);
    d[i + 2] = clamp(B * 255);
  };
}

let lastKey = "";
let last: ((d: { [i: number]: number }, i: number) => void) | null = null;
const one = [0, 0, 0];

/** The colour of one pixel (0..255) after the adjustments that need no neighbours. */
export function adjustPixel(r: number, g: number, b: number, a: Adjust): [number, number, number] {
  const key = adjustKey(a);
  if (key !== lastKey || !last) {
    last = prepare(a);
    lastKey = key;
  }
  one[0] = r;
  one[1] = g;
  one[2] = b;
  last(one, 0);
  return [one[0]!, one[1]!, one[2]!];
}

/**
 * A CSS filter for what a picture that cannot be repainted pixel by pixel (a video or a GIF while it plays) can show: exposure,
 * contrast, saturation and blur. The rest needs the pixels, which a playing picture does not hand over.
 */
export function cssFilter(a: Adjust | undefined): string {
  if (!a) return "";
  const f: string[] = [];
  if (a.exposure) f.push(`brightness(${(2 ** ((a.exposure / 100) * 1.5)).toFixed(3)})`);
  if (a.contrast) f.push(`contrast(${(1 + a.contrast / 100).toFixed(3)})`);
  if (a.saturation || a.vibrance) f.push(`saturate(${Math.max(0, 1 + ((a.saturation ?? 0) + (a.vibrance ?? 0) * 0.5) / 100).toFixed(3)})`);
  if (a.temperature) f.push(`hue-rotate(${(-(a.temperature / 100) * 12).toFixed(1)}deg)`);
  if (a.blur) f.push(`blur(${((a.blur / 100) * 8).toFixed(2)}px)`);
  return f.join(" ");
}

/** What a picture shows of its source: a window of the source pixels, in whole pixels. */
export interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The window of source pixels an image shows: its crop, else all of it. */
export const cropOf = (o: { readonly pixelW: number; readonly pixelH: number; readonly crop?: Crop | undefined }): Crop => o.crop ?? { x: 0, y: 0, w: o.pixelW, h: o.pixelH };
