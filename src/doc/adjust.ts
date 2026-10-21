/**
 * Non-destructive adjustments of a picture (ADR 0118): numbers kept on the instance, applied when it is drawn, so the original is
 * never touched and every number can be changed again. Each is from -100 to 100 (0: no change), except blur, sharpen and grain, which
 * are 0 to 100. `adjustPixel` is the whole of the colour part, one pixel at a time, so a picture seen magnified (each source pixel a big
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
  readonly sharpen?: number;
  readonly grain?: number;
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

export type AdjustKey = Exclude<keyof Adjust, "map" | "levels" | "curves" | "next" | "dropColor" | "innerColor">;

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
  { key: "red", label: "Red", min: -100, pointwise: true },
  { key: "green", label: "Green", min: -100, pointwise: true },
  { key: "blue", label: "Blue", min: -100, pointwise: true },
  { key: "blur", label: "Blur", min: 0, pointwise: false },
  { key: "sharpen", label: "Sharpen", min: 0, pointwise: false },
  { key: "grain", label: "Grain", min: 0, pointwise: false },
  { key: "dropOpacity", label: "Opacity", min: 0, pointwise: false },
  { key: "dropX", label: "Across", min: -100, pointwise: false },
  { key: "dropY", label: "Down", min: -100, pointwise: false },
  { key: "dropBlur", label: "Blur", min: 0, pointwise: false },
  { key: "dropSpread", label: "Spread", min: 0, pointwise: false },
  { key: "innerOpacity", label: "Opacity", min: 0, pointwise: false },
  { key: "innerX", label: "Across", min: -100, pointwise: false },
  { key: "innerY", label: "Down", min: -100, pointwise: false },
  { key: "innerBlur", label: "Blur", min: 0, pointwise: false },
  { key: "innerSpread", label: "Spread", min: 0, pointwise: false },
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
    if (k === "levels") return !!v && typeof v === "object" && Object.entries(v).every(([ch, l]) => CHANNELS.includes(ch as Channel) && cleanLevels(l as Levels) !== undefined);
    if (k === "curves") return !!v && typeof v === "object" && Object.entries(v).every(([ch, c]) => CHANNELS.includes(ch as Channel) && cleanCurve(c as CurvePoints) !== undefined);
    const s = ADJUSTMENTS.find((x) => x.key === k);
    return !!s && typeof v === "number" && Number.isFinite(v) && v >= s.min && v <= 100;
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
export const needsNeighbours = (a: Adjust | undefined): boolean => layersOf(a).some((l) => !!l.blur || !!l.sharpen || !!l.grain);

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
    const c = Math.max(s.min, Math.min(100, Math.round(v)));
    if (c !== 0) out[s.key] = c;
  }
  if (out["dropOpacity"] && isColour(a.dropColor) && a.dropColor.toLowerCase() !== "#000000") out["dropColor"] = a.dropColor.toLowerCase();
  if (out["innerOpacity"] && isColour(a.innerColor) && a.innerColor.toLowerCase() !== "#000000") out["innerColor"] = a.innerColor.toLowerCase();
  return Object.keys(out).length ? (out as Adjust) : undefined;
}

/** A short text that differs whenever the adjustments do (to cache what was drawn with them). */
export const adjustKey = (a: Adjust | undefined): string =>
  a ? ADJUSTMENTS.map((s) => a[s.key] ?? 0).join(",") + (a.map ? `|${a.map.amount}:${a.map.stops.map((s) => `${s.o}${s.c}`).join(",")}` : "") + (a.levels ? `|L${JSON.stringify(a.levels)}` : "") + (a.curves ? `|C${JSON.stringify(a.curves)}` : "") + (a.next ? `|N(${adjustKey(a.next)})` : "") + (a.dropColor ?? "") + (a.innerColor ?? "") : "";

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
