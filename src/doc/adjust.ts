/**
 * Non-destructive adjustments of a picture (ADR 0118): numbers kept on the instance, applied when it is drawn, so the original is
 * never touched and every number can be changed again. Each is from -100 to 100 (0: no change), except blur, sharpen and grain, which
 * are 0 to 100. `adjustPixel` is the whole of the colour part, one pixel at a time, so a picture seen magnified (each source pixel a big
 * rectangle), seen from so far in that it is one colour, and drawn at ordinary size all agree.
 */
export interface Adjust {
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

export type AdjustKey = keyof Adjust;

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
export const isNeutral = (a: Adjust | undefined): boolean => !a || ADJUSTMENTS.every((s) => !a[s.key]);

/** Whether the pictures around a pixel matter (blur, sharpen, grain): such an adjustment is drawn at the size seen, never at depth. */
export const needsNeighbours = (a: Adjust | undefined): boolean => !!a && (!!a.blur || !!a.sharpen || !!a.grain);

/** The adjustments with only the nonzero numbers, in range; undefined when nothing is left. */
export function cleanAdjust(a: Adjust): Adjust | undefined {
  const out: Record<string, number> = {};
  for (const s of ADJUSTMENTS) {
    const v = a[s.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const c = Math.max(s.min, Math.min(100, Math.round(v)));
    if (c !== 0) out[s.key] = c;
  }
  return Object.keys(out).length ? (out as Adjust) : undefined;
}

/** A short text that differs whenever the adjustments do (to cache what was drawn with them). */
export const adjustKey = (a: Adjust | undefined): string => (a ? ADJUSTMENTS.map((s) => a[s.key] ?? 0).join(",") : "");

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** The colour of one pixel (0..255) after the adjustments that need no neighbours. */
export function adjustPixel(r: number, g: number, b: number, a: Adjust): [number, number, number] {
  let R = r / 255, G = g / 255, B = b / 255;
  if (a.exposure) {
    // in linear light, a stop doubles it
    const k = 2 ** ((a.exposure / 100) * 2);
    R = linearToSrgb(Math.min(1, srgbToLinear(R) * k));
    G = linearToSrgb(Math.min(1, srgbToLinear(G) * k));
    B = linearToSrgb(Math.min(1, srgbToLinear(B) * k));
  }
  if (a.temperature || a.tint) {
    const t = (a.temperature ?? 0) / 100, n = (a.tint ?? 0) / 100;
    R *= 1 + 0.25 * t;
    B *= 1 - 0.25 * t;
    G *= 1 - 0.18 * n; // towards green when negative, towards magenta when positive
    R *= 1 + 0.06 * n;
    B *= 1 + 0.06 * n;
  }
  if (a.highlights || a.shadows) {
    const y = 0.299 * R + 0.587 * G + 0.114 * B;
    const lift = ((a.shadows ?? 0) / 100) * 0.5 * (1 - y) ** 2 - ((a.highlights ?? 0) / 100) * 0.5 * y ** 2;
    R += lift;
    G += lift;
    B += lift;
  }
  if (a.contrast) {
    const k = 1 + a.contrast / 100;
    R = (R - 0.5) * k + 0.5;
    G = (G - 0.5) * k + 0.5;
    B = (B - 0.5) * k + 0.5;
  }
  if (a.saturation || a.vibrance) {
    const y = 0.299 * R + 0.587 * G + 0.114 * B;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    const sat = mx <= 0 ? 0 : (mx - mn) / mx;
    // vibrance lifts the dull colours more than the vivid ones
    const k = 1 + (a.saturation ?? 0) / 100 + ((a.vibrance ?? 0) / 100) * (1 - sat);
    R = y + (R - y) * k;
    G = y + (G - y) * k;
    B = y + (B - y) * k;
  }
  return [clamp(R * 255), clamp(G * 255), clamp(B * 255)];
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
