/**
 * Non-destructive adjustments of a picture (ADR 0118): numbers kept on the instance, applied when it is drawn, so the original is
 * never touched and every number can be changed again. Each has its own range (`ADJUSTMENTS`, 0: no change): the colour ones go past 100
 * for a stronger change, blur to 400, sharpen and grain to 200; a blur has a type (`blurType`, ADR 0189) and pixelate makes square cells. `adjustPixel` is the whole of the colour part, one pixel at a time, so a picture seen magnified (each source pixel a big
 * rectangle), seen from so far in that it is one colour, and drawn at ordinary size all agree.
 */
import type { GradientStop } from "./paint";
import { MAX_STOPS, isColour, stopsAt } from "./paint";

/** A gradient map (ADR 0122): the brightness of each pixel is looked up in a gradient, and `amount` (1 to 100) says how far the picture goes towards it. A stop with transparency makes the picture clear where the brightness reaches it (not for a picture that plays, nor magnified past its pixels). */
export interface GradientMap {
  readonly stops: readonly GradientStop[];
  readonly amount: number;
}

/** Levels of one channel (ADR 0136): the input from `black` to `white` (0 to 255) is stretched to the whole range, and `gamma` (0.1 to 5; above 1 lightens the middle) bends it. */
export interface Levels {
  readonly black?: number;
  readonly white?: number;
  readonly gamma?: number;
}

/** Levels for all the channels together (`master`) and for each of red, green and blue. */
export interface LevelsSet {
  readonly master?: Levels;
  readonly r?: Levels;
  readonly g?: Levels;
  readonly b?: Levels;
}

/** A curve: points (x in, y out, both 0 to 255) a smooth curve passes through. */
export type CurvePoints = ReadonlyArray<readonly [number, number]>;
export interface CurveSet {
  readonly master?: CurvePoints;
  readonly r?: CurvePoints;
  readonly g?: CurvePoints;
  readonly b?: CurvePoints;
}

export const MAX_CURVE_POINTS = 16;
export const MAX_LAYERS = 8;
export type Channel = "master" | "r" | "g" | "b";
export const CHANNELS: readonly Channel[] = ["master", "r", "g", "b"];

export interface Adjust {
  /** Levels and curves of the whole picture and of each channel, applied last (ADR 0136). */
  readonly levels?: LevelsSet;
  readonly curves?: CurveSet;
  /** A further set of adjustments applied to the result of this one: a stack of adjustments, each with its own numbers (at most MAX_LAYERS in all). */
  readonly next?: Adjust;
  readonly map?: GradientMap;
  readonly exposure?: number;
  readonly contrast?: number;
  readonly highlights?: number;
  readonly shadows?: number;
  readonly temperature?: number;
  readonly tint?: number;
  readonly saturation?: number;
  readonly vibrance?: number;
  /** The share of each primary light added (or taken away): -100 to 100, a stop either way (ADR 0136). */
  readonly red?: number;
  readonly green?: number;
  readonly blue?: number;
  readonly blur?: number;
  /** How the blur spreads (ADR 0189): absent is the usual soft blur; along a line (`blurAngle`), out from the middle, or round it. */
  readonly blurType?: BlurType;
  /** The direction of a motion blur, in degrees (0: across). */
  readonly blurAngle?: number;
  /** Advanced (ADR 0190), each 0 = as before: a motion blur's streak behind (-100) or ahead (100) instead of centred; how many copies make a
   * blur of another type (-100: a quarter, 100: four times); the middle of a zoom or spin blur, a share of half the object across and down. */
  readonly blurOffset?: number;
  readonly blurQuality?: number;
  readonly blurCenterX?: number;
  readonly blurCenterY?: number;
  readonly sharpen?: number;
  /** How wide sharpening looks (0: one pixel, 100: ten). */
  readonly sharpenRadius?: number;
  readonly grain?: number;
  /** How coarse the grain is (0: one pixel, 100: eight), and how much colour it has (0: grey). */
  readonly grainSize?: number;
  readonly grainColour?: number;
  /** Square cells, a share of the object's size (100: a tenth of it). */
  readonly pixelate?: number;
  /** The cells of pixelate: squares (absent) or round dots. */
  readonly pixelShape?: "dots";
  /**
   * Shadows of what is drawn (not of a picture's pixels): a drop shadow behind it and an inner shadow inside its edge. Opacity 0 = none. The offset
   * (`X`, `Y`: -100 to 100, a tenth of the object's size at the ends), the `Blur` and the `Spread` (how far the shadow is grown, or the inner one shrunk: 0 to 100, a twentieth of its size) are shares of the object's own
   * size, so they look the same at any zoom. The colour is `#rrggbb` (black when absent).
   */
  readonly dropOpacity?: number;
  readonly dropX?: number;
  readonly dropY?: number;
  readonly dropBlur?: number;
  readonly dropSpread?: number;
  readonly dropColor?: string;
  readonly innerOpacity?: number;
  readonly innerX?: number;
  readonly innerY?: number;
  readonly innerBlur?: number;
  readonly innerSpread?: number;
  readonly innerColor?: string;
}

export type AdjustKey = Exclude<keyof Adjust, "map" | "levels" | "curves" | "next" | "dropColor" | "innerColor" | "blurType" | "pixelShape">;

/** The kinds of blur besides the usual one (ADR 0189). */
export type BlurType = "motion" | "zoom" | "spin";
export const BLUR_TYPES: ReadonlyArray<readonly [BlurType | "", string]> = [["", "Soft"], ["motion", "Motion"], ["zoom", "Zoom"], ["spin", "Spin"]];

export interface AdjustSpec {
  readonly key: AdjustKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** Part of the colour of each pixel (true), or needs the pixels around it (false). */
  readonly pointwise: boolean;
}

/** In the order they are offered. */
export const ADJUSTMENTS: readonly AdjustSpec[] = [
  { key: "exposure", label: "Exposure", min: -200, max: 200, pointwise: true },
  { key: "contrast", label: "Contrast", min: -100, max: 200, pointwise: true },
  { key: "highlights", label: "Highlights", min: -100, max: 100, pointwise: true },
  { key: "shadows", label: "Shadows", min: -100, max: 100, pointwise: true },
  { key: "temperature", label: "Temperature", min: -200, max: 200, pointwise: true },
  { key: "tint", label: "Tint", min: -200, max: 200, pointwise: true },
  { key: "saturation", label: "Saturation", min: -100, max: 200, pointwise: true },
  { key: "vibrance", label: "Vibrance", min: -100, max: 200, pointwise: true },
  { key: "red", label: "Red", min: -200, max: 200, pointwise: true },
  { key: "green", label: "Green", min: -200, max: 200, pointwise: true },
  { key: "blue", label: "Blue", min: -200, max: 200, pointwise: true },
  { key: "blur", label: "Blur", min: 0, max: 400, pointwise: false },
  { key: "blurAngle", label: "Angle", min: 0, max: 359, pointwise: false },
  { key: "blurOffset", label: "Offset", min: -100, max: 100, pointwise: false },
  { key: "blurCenterX", label: "Centre across", min: -100, max: 100, pointwise: false },
  { key: "blurCenterY", label: "Centre down", min: -100, max: 100, pointwise: false },
  { key: "blurQuality", label: "Quality", min: -100, max: 100, pointwise: false },
  { key: "sharpen", label: "Sharpen", min: 0, max: 200, pointwise: false },
  { key: "sharpenRadius", label: "Radius", min: 0, max: 100, pointwise: false },
  { key: "grain", label: "Grain", min: 0, max: 200, pointwise: false },
  { key: "grainSize", label: "Size", min: 0, max: 100, pointwise: false },
  { key: "grainColour", label: "Colour", min: 0, max: 100, pointwise: false },
  { key: "pixelate", label: "Pixelate", min: 0, max: 100, pointwise: false },
  { key: "dropOpacity", label: "Opacity", min: 0, max: 100, pointwise: false },
  { key: "dropX", label: "Across", min: -300, max: 300, pointwise: false },
  { key: "dropY", label: "Down", min: -300, max: 300, pointwise: false },
  { key: "dropBlur", label: "Blur", min: 0, max: 400, pointwise: false },
  { key: "dropSpread", label: "Spread", min: 0, max: 400, pointwise: false },
  { key: "innerOpacity", label: "Opacity", min: 0, max: 100, pointwise: false },
  { key: "innerX", label: "Across", min: -300, max: 300, pointwise: false },
  { key: "innerY", label: "Down", min: -300, max: 300, pointwise: false },
  { key: "innerBlur", label: "Blur", min: 0, max: 400, pointwise: false },
  { key: "innerSpread", label: "Spread", min: 0, max: 400, pointwise: false },
];

/** Whether any layer has a drop or an inner shadow. */
export const hasShadow = (a: Adjust | undefined): boolean => layersOf(a).some((l) => !!l.dropOpacity || !!l.innerOpacity);

/** The shadow a layer stack makes of one kind: the first layer that has it on (null: none). */
export function shadowOf(a: Adjust | undefined, kind: "drop" | "inner"): { opacity: number; x: number; y: number; blur: number; spread: number; colour: string } | null {
  const l = layersOf(a).find((v) => !!v[`${kind}Opacity`]);
  return l ? { opacity: l[`${kind}Opacity`]! / 100, x: (l[`${kind}X`] ?? 0) / 100, y: (l[`${kind}Y`] ?? 0) / 100, blur: (l[`${kind}Blur`] ?? 0) / 100, spread: (l[`${kind}Spread`] ?? 0) / 100, colour: (kind === "drop" ? l.dropColor : l.innerColor) ?? "#000000" } : null;
}

/** A full shadow offset is this share of the object's size, and a full shadow blur (its standard deviation) this share. */
export const SHADOW_OFFSET = 0.1;
export const SHADOW_SOFT = 0.05;

/**
 * How far past the object's own box the adjustments paint, as a share of the object's longer side: three standard deviations (twice over, to be
 * safe) of the blur, and a drop shadow's offset and blur. A picture's blur is made in its own pixels and does not count.
 */
export function reachFraction(a: Adjust | undefined, picture: boolean): number {
  if (!a) return 0;
  const blur = picture ? 0 : Math.max(0, ...layersOf(a).map((l) => l.blur ?? 0));
  const d = shadowOf(a, "drop");
  return 3 * (blur / 100) * 0.02 * 2 + (d ? Math.max(Math.abs(d.x), Math.abs(d.y)) * SHADOW_OFFSET + 3 * d.blur * SHADOW_SOFT + d.spread * SHADOW_SOFT : 0);
}

/** A colour `#rrggbb` or `#rrggbbaa` with the colour adjustments made to it (anything else is returned as it is): what a coarse object seen from inside is drawn as. */
export function adjustHex(hex: string, a: Adjust): string {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1]!, 16);
  const [r, g, b] = adjustPixel((v >> 16) & 255, (v >> 8) & 255, v & 255, a);
  const h = (x: number): string => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${m[2] ?? ""}`;
}

/** What the panel puts in when a shadow is first turned on: a soft shadow a little below. */
export const SHADOW_START = { X: 0, Y: 30, Blur: 30 } as const;

/** Whether anything is changed (an adjustment of 0 is none). */
export const isNeutral = (a: Adjust | undefined): boolean => !a || (!a.map && !a.levels && !a.curves && ADJUSTMENTS.every((s) => !a[s.key]) && isNeutral(a.next));

/** The layers of a stack in the order they are applied: the adjustment, then each `next`. */
export function layersOf(a: Adjust | undefined): Adjust[] {
  const out: Adjust[] = [];
  for (let l = a; l && out.length < MAX_LAYERS; l = l.next) out.push(l);
  return out;
}

/** Whether `levels` is a neutral set (nothing stretched or bent). */
const levelNeutral = (l: Levels | undefined): boolean => !l || ((l.black ?? 0) === 0 && (l.white ?? 255) === 255 && (l.gamma ?? 1) === 1);
const curveNeutral = (c: CurvePoints | undefined): boolean => !c || c.every(([x, y]) => x === y);

function cleanLevels(l: Levels | undefined): Levels | undefined {
  if (!l || typeof l !== "object") return undefined;
  const black = Math.max(0, Math.min(254, Math.round(Number(l.black ?? 0))));
  const white = Math.max(black + 1, Math.min(255, Math.round(Number(l.white ?? 255))));
  const gamma = Math.max(0.1, Math.min(5, Math.round(Number(l.gamma ?? 1) * 100) / 100));
  if (![black, white, gamma].every(Number.isFinite)) return undefined;
  const out = { ...(black ? { black } : {}), ...(white !== 255 ? { white } : {}), ...(gamma !== 1 ? { gamma } : {}) };
  return levelNeutral(out) ? undefined : out;
}

function cleanCurve(c: CurvePoints | undefined): CurvePoints | undefined {
  if (!Array.isArray(c)) return undefined;
  const pts = c
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p): [number, number] => [Math.max(0, Math.min(255, Math.round(p[0]))), Math.max(0, Math.min(255, Math.round(p[1])))])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0])
    .slice(0, MAX_CURVE_POINTS);
  return pts.length && !curveNeutral(pts) ? pts : undefined;
}

/** Whether `a` is a set of adjustments the document accepts (every number in range, levels and curves tidy, a stack of at most MAX_LAYERS). */
export function validAdjust(a: unknown, depth = 1): a is Adjust {
  if (typeof a !== "object" || a === null || depth > MAX_LAYERS) return false;
  return Object.entries(a).every(([k, v]) => {
    if (k === "map") return validMap(v);
    if (k === "next") return validAdjust(v, depth + 1);
    if (k === "dropColor" || k === "innerColor") return isColour(v);
    if (k === "blurType") return BLUR_TYPES.some(([t]) => t !== "" && t === v);
    if (k === "pixelShape") return v === "dots";
    if (k === "levels") return !!v && typeof v === "object" && Object.entries(v).every(([ch, l]) => CHANNELS.includes(ch as Channel) && cleanLevels(l as Levels) !== undefined);
    if (k === "curves") return !!v && typeof v === "object" && Object.entries(v).every(([ch, c]) => CHANNELS.includes(ch as Channel) && cleanCurve(c as CurvePoints) !== undefined);
    const s = ADJUSTMENTS.find((x) => x.key === k);
    return !!s && typeof v === "number" && Number.isFinite(v) && v >= s.min && v <= s.max;
  });
}

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
export const needsNeighbours = (a: Adjust | undefined): boolean => layersOf(a).some((l) => !!l.blur || !!l.sharpen || !!l.grain || !!l.pixelate);

/** The adjustments with only the nonzero numbers, in range; undefined when nothing is left. A stack keeps its layers that change something. */
export function cleanAdjust(a: Adjust, depth = 1): Adjust | undefined {
  const out: Record<string, unknown> = {};
  if (a.levels) {
    const lv: Record<string, Levels> = {};
    for (const ch of CHANNELS) {
      const l = cleanLevels(a.levels[ch]);
      if (l) lv[ch] = l;
    }
    if (Object.keys(lv).length) out["levels"] = lv;
  }
  if (a.curves) {
    const cv: Record<string, CurvePoints> = {};
    for (const ch of CHANNELS) {
      const c = cleanCurve(a.curves[ch]);
      if (c) cv[ch] = c;
    }
    if (Object.keys(cv).length) out["curves"] = cv;
  }
  const nextLayer = a.next && depth < MAX_LAYERS ? cleanAdjust(a.next, depth + 1) : undefined;
  if (nextLayer) out["next"] = nextLayer;
  if (a.map && validMap({ ...a.map, amount: Math.round(a.map.amount) })) out["map"] = { stops: a.map.stops.map((s) => ({ o: s.o, c: s.c.toLowerCase() })), amount: Math.round(a.map.amount) };
  for (const s of ADJUSTMENTS) {
    const v = a[s.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const c = Math.max(s.min, Math.min(s.max, Math.round(v)));
    if (c !== 0) out[s.key] = c;
  }
  // (a blur's type only with a blur, and its angle only with a motion blur)
  if (out["blur"] && a.blurType && BLUR_TYPES.some(([t]) => t !== "" && t === a.blurType)) out["blurType"] = a.blurType;
  // (each advanced number only where it means something, ADR 0190)
  const type = out["blurType"];
  if (type !== "motion") (delete out["blurAngle"], delete out["blurOffset"]);
  if (type !== "zoom" && type !== "spin") (delete out["blurCenterX"], delete out["blurCenterY"]);
  if (!type) delete out["blurQuality"];
  if (!out["sharpen"]) delete out["sharpenRadius"];
  if (!out["grain"]) (delete out["grainSize"], delete out["grainColour"]);
  if (out["pixelate"] && a.pixelShape === "dots") out["pixelShape"] = "dots";
  if (out["dropOpacity"] && isColour(a.dropColor) && a.dropColor.toLowerCase() !== "#000000") out["dropColor"] = a.dropColor.toLowerCase();
  if (out["innerOpacity"] && isColour(a.innerColor) && a.innerColor.toLowerCase() !== "#000000") out["innerColor"] = a.innerColor.toLowerCase();
  return Object.keys(out).length ? (out as Adjust) : undefined;
}

/** A short text that differs whenever the adjustments do (to cache what was drawn with them). */
export const adjustKey = (a: Adjust | undefined): string =>
  a ? ADJUSTMENTS.map((s) => a[s.key] ?? 0).join(",") + (a.blurType ? `|B${a.blurType}` : "") + (a.pixelShape ? `|P${a.pixelShape}` : "") + (a.map ? `|${a.map.amount}:${a.map.stops.map((s) => `${s.o}${s.c}`).join(",")}` : "") + (a.levels ? `|L${JSON.stringify(a.levels)}` : "") + (a.curves ? `|C${JSON.stringify(a.curves)}` : "") + (a.next ? `|N(${adjustKey(a.next)})` : "") + (a.dropColor ?? "") + (a.innerColor ?? "") : "";

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
/** An sRGB value (0..1, of a colour already changed by earlier steps) to linear light, by a table of 4096 steps. */
const F2L = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) {
  const c = i / 4096;
  F2L[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const toLin = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : F2L[Math.round(v * 4096)]!);
const toSrgb = (lin: number): number => L2S[lin <= 0 ? 0 : lin >= 1 ? 4096 : Math.round(lin * 4096)]! / 255;
/** The cube root of 0..1 from a table read by the square root (even steps near black, where the root is steepest), between its steps: far
 * quicker than Math.cbrt over every pixel of a large picture, within 0.0002. */
const CBRT_N = 4096;
const CBRT = new Float32Array(CBRT_N + 2);
for (let i = 0; i <= CBRT_N + 1; i++) CBRT[i] = Math.cbrt((i / CBRT_N) ** 2);
const cbrt01 = (x: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return Math.cbrt(x);
  const t = Math.sqrt(x) * CBRT_N, i = t | 0;
  return CBRT[i]! + (CBRT[i + 1]! - CBRT[i]!) * (t - i);
};
/** OKLab of a pixel (sRGB values 0..1), written into `out` (no allocation per pixel). */
function okLab(R: number, G: number, B: number, out: Float64Array): void {
  const r = toLin(R), g = toLin(G), b = toLin(B);
  const l = cbrt01(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt01(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const q = cbrt01(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q;
}
/** The sRGB value (0..1) of the grey as light as OKLab lightness `L`: the brightness a colour's grey keeps, and its place on a gradient map. */
const greyOf = (L: number): number => toSrgb(L * L * L);
/**
 * A colour (sRGB values 0..1) with its OKLab chroma times `k` and its lightness kept, written into `out` in linear light and not yet cut to
 * what sRGB shows (what the grid holds: smooth, so read between its points it stays exact; the cut is made per pixel, `toSrgb`).
 */
function saturateOk(R: number, G: number, B: number, k: number, out: Float64Array): void {
  okLab(R, G, B, out);
  const L = out[0]!, A = out[1]! * k, Bk = out[2]! * k;
  const l_ = L + 0.3963377774 * A + 0.2158037573 * Bk, m_ = L - 0.1055613458 * A - 0.0638541728 * Bk, q_ = L - 0.0894841775 * A - 1.291485548 * Bk;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, q = q_ * q_ * q_;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q;
}
/**
 * A step of the adjustments that works in OKLab (saturation, vibrance, a gradient map's lightness), worked out once for a grid of colours
 * when the settings are set, then read for each pixel between the grid's points (trilinear): OKLab for every pixel of a large picture was
 * three times slower than the RGB formula it replaced; this is as quick. `n` values a point.
 */
const GRID = 33;
function colourGrid(n: number, f: (r: number, g: number, b: number, out: Float64Array) => void): Float32Array {
  const grid = new Float32Array(GRID * GRID * GRID * n);
  const out = new Float64Array(3);
  for (let ri = 0; ri < GRID; ri++) for (let gi = 0; gi < GRID; gi++) for (let bi = 0; bi < GRID; bi++) {
    f(ri / (GRID - 1), gi / (GRID - 1), bi / (GRID - 1), out);
    const at = ((ri * GRID + gi) * GRID + bi) * n;
    for (let c = 0; c < n; c++) grid[at + c] = out[c]!;
  }
  return grid;
}
const cell = (v: number): number => (v <= 0 ? 0 : v >= 1 ? GRID - 1 : v * (GRID - 1));
const G1 = 3, G2 = GRID * 3, G3 = GRID * GRID * 3;
/** `sample` for a grid of three values a point, written out (it runs for every pixel). */
function sample3(grid: Float32Array, R: number, G: number, B: number, out: Float64Array): void {
  const x = cell(R), y = cell(G), z = cell(B);
  const x0 = x >= GRID - 1 ? GRID - 2 : x | 0, y0 = y >= GRID - 1 ? GRID - 2 : y | 0, z0 = z >= GRID - 1 ? GRID - 2 : z | 0;
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const gx = 1 - fx, gy = 1 - fy, gz = 1 - fz;
  const w000 = gx * gy * gz, w100 = fx * gy * gz, w010 = gx * fy * gz, w110 = fx * fy * gz;
  const w001 = gx * gy * fz, w101 = fx * gy * fz, w011 = gx * fy * fz, w111 = fx * fy * fz;
  const p = x0 * G3 + y0 * G2 + z0 * G1;
  for (let c = 0; c < 3; c++) {
    const q = p + c;
    out[c] = w000 * grid[q]! + w100 * grid[q + G3]! + w010 * grid[q + G2]! + w110 * grid[q + G3 + G2]!
      + w001 * grid[q + G1]! + w101 * grid[q + G3 + G1]! + w011 * grid[q + G2 + G1]! + w111 * grid[q + G3 + G2 + G1]!;
  }
}
/** The grid's value at a colour (sRGB values 0..1, outside it as at its edge), between its eight nearest points, into `out`. */
function sample(grid: Float32Array, R: number, G: number, B: number, n: number, out: Float64Array): void {
  const x = cell(R), y = cell(G), z = cell(B);
  const x0 = Math.min(GRID - 2, x | 0), y0 = Math.min(GRID - 2, y | 0), z0 = Math.min(GRID - 2, z | 0);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const s1 = n, s2 = GRID * n, s3 = GRID * GRID * n;
  const a = (x0 * GRID * GRID + y0 * GRID + z0) * n;
  for (let c = 0; c < n; c++) {
    const p = a + c;
    const c00 = grid[p]! + (grid[p + s3]! - grid[p]!) * fx;
    const c01 = grid[p + s1]! + (grid[p + s3 + s1]! - grid[p + s1]!) * fx;
    const c10 = grid[p + s2]! + (grid[p + s3 + s2]! - grid[p + s2]!) * fx;
    const c11 = grid[p + s2 + s1]! + (grid[p + s3 + s2 + s1]! - grid[p + s2 + s1]!) * fx;
    const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
    out[c] = c0 + (c1 - c0) * fz;
  }
}

/**
 * The colour part of the adjustments made ready once, as a function that changes the first three bytes of the pixel at `i` of `d` in place
 * (RGBA bytes). It allocates nothing, so it can run over every pixel of a picture while a slider is dragged.
 */
/** The 256 outputs of levels then a curve, for one channel (identity tables are not made: null). */
function toneTable(levels: readonly (Levels | undefined)[], curves: readonly (CurvePoints | undefined)[]): Uint8ClampedArray | null {
  if (levels.every(levelNeutral) && curves.every(curveNeutral)) return null;
  const t = new Uint8ClampedArray(256);
  const steps = curves.map((c) => (c && !curveNeutral(c) ? curveFn(c) : null));
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    for (const l of levels) {
      if (levelNeutral(l)) continue;
      const b = (l!.black ?? 0) / 255, w = (l!.white ?? 255) / 255;
      v = Math.max(0, Math.min(1, (v - b) / (w - b))) ** (1 / (l!.gamma ?? 1));
    }
    for (const c of steps) if (c) v = c(v * 255) / 255;
    t[i] = Math.round(v * 255);
  }
  return t;
}

/** A smooth monotone curve through the points (extended flat before the first and after the last), as a function of 0..255. */
export function curveFn(pts: CurvePoints): (x: number) => number {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n === 1) return () => p[0]![1];
  // Fritsch-Carlson tangents keep the curve monotone between the points (no overshoot)
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1]![1] - p[i]![1]) / (p[i + 1]![0] - p[i]![0]));
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) m[i] = m[i + 1] = 0;
    else {
      const a = m[i]! / d[i]!, b = m[i + 1]! / d[i]!, h = a * a + b * b;
      if (h > 9) {
        const k = 3 / Math.sqrt(h);
        m[i] = k * a * d[i]!;
        m[i + 1] = k * b * d[i]!;
      }
    }
  }
  return (x) => {
    if (x <= p[0]![0]) return p[0]![1];
    if (x >= p[n - 1]![0]) return p[n - 1]![1];
    let i = 0;
    while (x > p[i + 1]![0]) i++;
    const h = p[i + 1]![0] - p[i]![0], t = (x - p[i]![0]) / h, t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * p[i]![1] + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * p[i + 1]![1] + (t3 - t2) * h * m[i + 1]!;
    return Math.max(0, Math.min(255, y));
  };
}

/** The layers of a stack made ready as one function: each layer's colour part in turn. */
export function prepareStack(a: Adjust): (d: { [i: number]: number }, i: number) => void {
  const fns = layersOf(a).filter((l) => !isLayerColourNeutral(l)).map(prepare);
  return fns.length === 1 ? fns[0]! : (d, i) => { for (const f of fns) f(d, i); };
}

/** Whether a layer changes colour (the numbers that act on one pixel at a time). */
/** Whether the adjustments change colours in a way only the pixels can show exactly (OKLab: saturation, vibrance, a gradient map), not a filter. */
export const needsPixels = (a: Adjust): boolean => layersOf(a).some((l) => !!(l.saturation || l.vibrance || l.map));
export const isLayerColourNeutral = (l: Adjust): boolean => !l.map && !l.levels && !l.curves && !(l.exposure || l.contrast || l.highlights || l.shadows || l.temperature || l.tint || l.saturation || l.vibrance || l.red || l.green || l.blue);

export function prepare(a: Adjust): (d: { [i: number]: number }, i: number) => void {
  const expK = a.exposure ? 2 ** ((a.exposure / 100) * 2) : 0;
  const t = (a.temperature ?? 0) / 100, n = (a.tint ?? 0) / 100;
  const warm = !!(t || n || a.red || a.green || a.blue);
  const gain = (v: number | undefined): number => 2 ** ((v ?? 0) / 100); // a stop of that primary either way
  const rMul = (1 + 0.25 * t + 0.06 * n) * gain(a.red), gMul = (1 - 0.18 * n) * gain(a.green), bMul = (1 - 0.25 * t + 0.06 * n) * gain(a.blue);
  const sh = ((a.shadows ?? 0) / 100) * 0.5, hi = ((a.highlights ?? 0) / 100) * 0.5;
  const tone = !!(sh || hi);
  const ck = 1 + (a.contrast ?? 0) / 100;
  const contrast = !!a.contrast;
  const sat = (a.saturation ?? 0) / 100, vib = (a.vibrance ?? 0) / 100;
  const colourful = !!(a.saturation || a.vibrance);
  // The gradient map: a table of 256 colours, one per brightness.
  const lut = a.map ? new Uint8ClampedArray(256 * 3) : null;
  const lutA = a.map && a.map.stops.some((s) => s.c.length === 9 && s.c.slice(7) !== "ff") ? new Float32Array(256) : null; // the transparency of the gradient, when it has any
  const mapK = a.map ? a.map.amount / 100 : 0;
  if (lut && a.map) for (let v = 0; v < 256; v++) {
    const [r, g, b] = stopsAt(a.map.stops, v / 255);
    lut[v * 3] = r;
    lut[v * 3 + 1] = g;
    lut[v * 3 + 2] = b;
    if (lutA) lutA[v] = stopsAt(a.map.stops, v / 255)[3]!;
  }
  // levels and curves last: the master first, then each channel's own
  const tr = toneTable([a.levels?.master, a.levels?.r], [a.curves?.master, a.curves?.r]);
  const tg = toneTable([a.levels?.master, a.levels?.g], [a.curves?.master, a.curves?.g]);
  const tb = toneTable([a.levels?.master, a.levels?.b], [a.curves?.master, a.curves?.b]);
  const satGrid = colourful ? colourGrid(3, (r, g, b, out) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    // vibrance lifts the dull colours more than the vivid ones
    saturateOk(r, g, b, Math.max(0, 1 + sat + vib * (1 - (mx <= 0 ? 0 : (mx - mn) / mx))), out);
  }) : null;
  const lightGrid = lut ? colourGrid(1, (r, g, b, out) => {
    okLab(r, g, b, out);
    out[0] = greyOf(out[0]!);
  }) : null;
  const px3 = new Float64Array(3);
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
    if (satGrid) {
      // In OKLab: only the chroma changes, the lightness stays, so -100 is the grey as light as the colour looks (a yellow and a blue of
      // one lightness become one grey), not a grey by a brightness formula of the RGB values. (Read from a grid made once for these settings: `colourGrid`.)
      sample3(satGrid, R, G, B, px3);
      R = toSrgb(px3[0]!);
      G = toSrgb(px3[1]!);
      B = toSrgb(px3[2]!);
    }
    if (lut) {
      // its place on the map: how light it looks (the value of the grey as light as it), so a grey keeps its place and colours of one
      // lightness share one
      sample(lightGrid!, R, G, B, 1, px3);
      const y = Math.max(0, Math.min(255, Math.round(px3[0]! * 255)));
      R += (lut[y * 3]! / 255 - R) * mapK;
      G += (lut[y * 3 + 1]! / 255 - G) * mapK;
      B += (lut[y * 3 + 2]! / 255 - B) * mapK;
      if (lutA) d[i + 3] = d[i + 3]! * (1 + (lutA[y]! - 1) * mapK); // (a stop that is clear makes the picture clear there, as far as the amount goes)
    }
    const r8 = clamp(R * 255), g8 = clamp(G * 255), b8 = clamp(B * 255);
    d[i] = tr ? tr[Math.round(r8)]! : r8;
    d[i + 1] = tg ? tg[Math.round(g8)]! : g8;
    d[i + 2] = tb ? tb[Math.round(b8)]! : b8;
  };
}

let lastKey = "";
let last: ((d: { [i: number]: number }, i: number) => void) | null = null;
const one = [0, 0, 0];

/** The colour of one pixel (0..255) after the adjustments that need no neighbours. */
export function adjustPixel(r: number, g: number, b: number, a: Adjust): [number, number, number] {
  const key = adjustKey(a);
  if (key !== lastKey || !last) {
    last = prepareStack(a);
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
