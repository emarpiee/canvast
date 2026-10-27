/**
 * Colour maths for the picker: sRGB hex <-> OKHSL, OKHSV and OKLCH. Pure functions, no DOM, no imports, so it runs in a worker, in Node
 * and in any other project unchanged.
 *
 * OKHSL and OKHSV are Bjorn Ottosson's models (https://bottosson.github.io/posts/colorpicker/, MIT, Copyright (c) 2021 Bjorn
 * Ottosson; the licence text is in LICENSE next to this folder's README, and tests/unit/colour-reference.test.ts keeps it agreeing with his own JavaScript): saturation is relative to the
 * sRGB gamut, so every (h, s, x) triple is a real colour and a slider never leaves the gamut. OKLCH is the standard polar form of OKLab
 * (Ottosson's OKLab, as CSS `oklch()` uses it): lightness is OKLab's own (no "toe"), chroma is absolute, and a chroma that sRGB cannot
 * show at that lightness and hue is reduced to the most it can (the colour is clipped to the gamut; the chroma asked for stays in the
 * triple, so it comes back when the lightness or hue moves back).
 *
 * A triple is { h, s, x }: hue in degrees (0..360), s the saturation (OKHSL, OKHSV) or the chroma as a fraction of CHROMA_REF (OKLCH), x the
 * lightness (OKHSL, OKLCH) or value (OKHSV); s and x run 0..1.
 */
export type Model = "okhsl" | "okhsv" | "oklch";
export const MODELS: readonly Model[] = ["okhsl", "okhsv", "oklch"];

/** The chroma that is 1 on an OKLCH slider: 0.4, the range CSS gives `oklch()` percentages (sRGB tops out near 0.32). */
export const CHROMA_REF = 0.4;
export interface Triple {
  h: number;
  s: number;
  x: number;
}
export type Rgb = readonly [number, number, number];

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- sRGB <-> OKLab ----------------------------------------------------------------------------------------------------------

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

// ---- Gamut geometry (Ottosson) -----------------------------------------------------------------------------------------------

/** The largest saturation (C / L along the lightness-1 edge) of the sRGB gamut for the unit hue direction (a, b). */
function maxSaturation(a: number, b: number): number {
  let k0: number, k1: number, k2: number, k3: number, k4: number, wl: number, wm: number, ws: number;
  if (-1.88170328 * a - 0.80936493 * b > 1) {
    [k0, k1, k2, k3, k4, wl, wm, ws] = [1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245, 4.0767416621, -3.3077115913, 0.2309699292];
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    [k0, k1, k2, k3, k4, wl, wm, ws] = [0.73956515, -0.45954404, 0.08285427, 0.1254107, 0.14503204, -1.2684380046, 2.6097574011, -0.3413193965];
  } else {
    [k0, k1, k2, k3, k4, wl, wm, ws] = [1.35733652, -0.00915799, -1.1513021, -0.50559606, 0.00692167, -0.0041960863, -0.7034186147, 1.707614701];
  }
  let S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548 * b;
  const l_ = 1 + S * kl;
  const m_ = 1 + S * km;
  const s_ = 1 + S * ks;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const f = wl * l + wm * m + ws * s;
  const f1 = wl * 3 * kl * l_ * l_ + wm * 3 * km * m_ * m_ + ws * 3 * ks * s_ * s_;
  const f2 = wl * 6 * kl * kl * l_ + wm * 6 * km * km * m_ + ws * 6 * ks * ks * s_;
  S -= (f * f1) / (f1 * f1 - 0.5 * f * f2); // one Halley step
  return S;
}

/** The cusp of the sRGB gamut for a hue: the lightest, most chromatic colour [L, C]. */
function cusp(a: number, b: number): [number, number] {
  const S = maxSaturation(a, b);
  const [r, g, bl] = oklabToLinear(1, S * a, S * b);
  const L = Math.cbrt(1 / Math.max(r, g, bl));
  return [L, L * S];
}

/** Where the line from (L0, 0) towards (L1, C1) leaves the gamut, as a fraction t of that line. */
function gamutIntersection(a: number, b: number, L1: number, C1: number, L0: number, cu: [number, number]): number {
  let t: number;
  if ((L1 - L0) * cu[1] - (cu[0] - L0) * C1 <= 0) {
    t = (cu[1] * L0) / (C1 * cu[0] + cu[1] * (L0 - L1));
  } else {
    t = (cu[1] * (L0 - 1)) / (C1 * (cu[0] - 1) + cu[1] * (L0 - L1));
    const dL = L1 - L0;
    const kl = 0.3963377774 * a + 0.2158037573 * b;
    const km = -0.1055613458 * a - 0.0638541728 * b;
    const ks = -0.0894841775 * a - 1.291485548 * b;
    const ldt = dL + C1 * kl;
    const mdt = dL + C1 * km;
    const sdt = dL + C1 * ks;
    const L = L0 * (1 - t) + t * L1;
    const C = t * C1;
    const l_ = L + C * kl;
    const m_ = L + C * km;
    const s_ = L + C * ks;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    const l1 = 3 * ldt * l_ * l_;
    const m1 = 3 * mdt * m_ * m_;
    const s1 = 3 * sdt * s_ * s_;
    const l2 = 6 * ldt * ldt * l_;
    const m2 = 6 * mdt * mdt * m_;
    const s2 = 6 * sdt * sdt * s_;
    const channel = (cl: number, cm: number, cs: number, minus: number): number => {
      const v = cl * l + cm * m + cs * s - minus;
      const v1 = cl * l1 + cm * m1 + cs * s1;
      const v2 = cl * l2 + cm * m2 + cs * s2;
      const u = v1 / (v1 * v1 - 0.5 * v * v2);
      return u >= 0 ? -v * u : Number.MAX_VALUE;
    };
    const tr = channel(4.0767416621, -3.3077115913, 0.2309699292, 1);
    const tg = channel(-1.2684380046, 2.6097574011, -0.3413193965, 1);
    const tb = channel(-0.0041960863, -0.7034186147, 1.707614701, 1);
    t += Math.min(tr, tg, tb);
  }
  return t;
}

function midST(a: number, b: number): [number, number] {
  const S = 0.11516993 + 1 / (7.4477897 + 4.1590124 * b + a * (-2.19557347 + 1.75198401 * b + a * (-2.13704948 - 10.02301043 * b + a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
  const T = 0.11239642 + 1 / (1.6132032 - 0.68124379 * b + a * (0.40370612 + 0.90148123 * b + a * (-0.27087943 + 0.6122399 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
  return [S, T];
}

/** The three chromas OKHSL is built on at a lightness and hue: [C0 (low end), Cmid, Cmax]. */
function chromas(L: number, a: number, b: number, cu: [number, number] = cusp(a, b)): [number, number, number] {
  const cMax = gamutIntersection(a, b, L, 1, L, cu);
  const sMax = cu[1] / cu[0];
  const tMax = cu[1] / (1 - cu[0]);
  const k = cMax / Math.min(L * sMax, (1 - L) * tMax);
  const [sMid, tMid] = midST(a, b);
  let ca = L * sMid;
  let cb = (1 - L) * tMid;
  const cMid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / ca ** 4 + 1 / cb ** 4)));
  ca = L * 0.4;
  cb = (1 - L) * 0.8;
  const c0 = Math.sqrt(1 / (1 / ca ** 2 + 1 / cb ** 2));
  return [c0, cMid, cMax];
}

// The "toe" maps OKLab L to a lightness that matches how L looks on screen (OKHSL and OKHSV use it, OKLCH does not).
const K1 = 0.206;
const K2 = 0.03;
const K3 = (1 + K1) / (1 + K2);
const toe = (x: number): number => 0.5 * (K3 * x - K1 + Math.sqrt((K3 * x - K1) * (K3 * x - K1) + 4 * K2 * K3 * x));
const toeInv = (x: number): number => (x * x + K1 * x) / (K3 * (x + K2));

// ---- Models -> sRGB ----------------------------------------------------------------------------------------------------------

const byte = (lin: number): number => Math.round(clamp01(gamma(clamp01(lin))) * 255);
const rgbOf = (L: number, a: number, b: number): Rgb => {
  const [r, g, bl] = oklabToLinear(L, a, b);
  return [byte(r), byte(g), byte(bl)];
};

const MID = 0.8;
const MID_INV = 1.25;

function okhslToRgb(hDeg: number, s: number, l: number): Rgb {
  if (l >= 1) return [255, 255, 255];
  if (l <= 0) return [0, 0, 0];
  const a = Math.cos((hDeg * TAU) / 360);
  const b = Math.sin((hDeg * TAU) / 360);
  const L = toeInv(l);
  const [c0, cMid, cMax] = chromas(L, a, b);
  let C: number;
  if (s < MID) {
    const t = MID_INV * s;
    const k1 = MID * c0;
    const k2 = 1 - k1 / cMid;
    C = (t * k1) / (1 - k2 * t);
  } else {
    const t = (s - MID) / (1 - MID);
    const k1 = ((1 - MID) * cMid * cMid * MID_INV * MID_INV) / c0;
    const k2 = 1 - k1 / (cMax - cMid);
    C = cMid + (t * k1) / (1 - k2 * t);
  }
  return rgbOf(L, C * a, C * b);
}

function okhsvToRgb(hDeg: number, s: number, v: number): Rgb {
  if (v <= 0) return [0, 0, 0];
  const a = Math.cos((hDeg * TAU) / 360);
  const b = Math.sin((hDeg * TAU) / 360);
  const cu = cusp(a, b);
  const sMax = cu[1] / cu[0];
  const tMax = cu[1] / (1 - cu[0]);
  const S0 = 0.5;
  const k = 1 - S0 / sMax;
  const denom = S0 + tMax - tMax * k * s;
  const Lv = 1 - (s * S0) / denom;
  const Cv = (s * tMax * S0) / denom;
  let L = v * Lv;
  let C = v * Cv;
  const Lvt = toeInv(Lv);
  const Cvt = (Cv * Lvt) / Lv;
  const Lnew = toeInv(L);
  C = (C * Lnew) / L;
  L = Lnew;
  const [sr, sg, sb] = oklabToLinear(Lvt, a * Cvt, b * Cvt);
  const scale = Math.cbrt(1 / Math.max(sr, sg, sb, 1e-9));
  return rgbOf(L * scale, C * scale * a, C * scale * b);
}

/** The most chroma sRGB can show at this lightness and hue. */
function maxChroma(L: number, a: number, b: number): number {
  return gamutIntersection(a, b, L, 1, L, cusp(a, b));
}

/** The chroma, as a fraction of CHROMA_REF, that sRGB can show at this hue (degrees) and lightness: the most a triple's `s` can be on screen. */
export function oklchEdge(hDeg: number, L: number): number {
  if (L <= 0 || L >= 1) return 0;
  const r = (hDeg * TAU) / 360;
  return Math.min(1, maxChroma(L, Math.cos(r), Math.sin(r)) / CHROMA_REF);
}

function oklchModelToRgb(hDeg: number, s: number, L: number): Rgb {
  if (L >= 1) return [255, 255, 255];
  if (L <= 0) return [0, 0, 0];
  const a = Math.cos((hDeg * TAU) / 360);
  const b = Math.sin((hDeg * TAU) / 360);
  const C = Math.min(s * CHROMA_REF, maxChroma(L, a, b));
  return rgbOf(L, C * a, C * b);
}

/** Hue turned at the same lightness and the same share of the gamut (not a model of the picker: what keeps a harmony inside sRGB). */
function relativeChromaToRgb(hDeg: number, c: number, L: number): Rgb {
  if (L >= 1) return [255, 255, 255];
  if (L <= 0) return [0, 0, 0];
  const a = Math.cos((hDeg * TAU) / 360);
  const b = Math.sin((hDeg * TAU) / 360);
  const C = c * maxChroma(L, a, b);
  return rgbOf(L, C * a, C * b);
}

/** The sRGB colour (bytes 0..255) of a triple in a model. */
export function toRgb(model: Model, h: number, s: number, x: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const val = clamp01(x);
  return model === "okhsl" ? okhslToRgb(hue, sat, val) : model === "okhsv" ? okhsvToRgb(hue, sat, val) : oklchModelToRgb(hue, sat, val);
}

// ---- sRGB -> models ----------------------------------------------------------------------------------------------------------

const GREY = 1e-4;

/**
 * The triple of an sRGB colour in a model. A grey has no hue: `hue` (the one the caller already has) is kept so a slider does not
 * jump to 0 when the colour passes through grey.
 */
export function fromRgb(model: Model, r: number, g: number, b: number, hue = 0): Triple {
  const [L, A, B] = linearToOklab(toLinear(clamp01(r / 255)), toLinear(clamp01(g / 255)), toLinear(clamp01(b / 255)));
  const C = Math.hypot(A, B);
  if (C < GREY) return { h: hue, s: 0, x: clamp01(model === "oklch" ? L : toe(L)) };
  const a = A / C;
  const bb = B / C;
  const h = (((Math.atan2(B, A) * 180) / Math.PI) % 360 + 360) % 360;
  if (model === "oklch") return { h, s: clamp01(C / CHROMA_REF), x: clamp01(L) };
  if (model === "okhsl") {
    const [c0, cMid, cMax] = chromas(clamp01(L), a, bb);
    let s: number;
    if (C < cMid) {
      const k1 = MID * c0;
      const k2 = 1 - k1 / cMid;
      s = ((C / (k1 + k2 * C))) * MID;
    } else {
      const k1 = ((1 - MID) * cMid * cMid * MID_INV * MID_INV) / c0;
      const k2 = 1 - k1 / (cMax - cMid);
      const t = (C - cMid) / (k1 + k2 * (C - cMid));
      s = MID + (1 - MID) * t;
    }
    return { h, s: clamp01(s), x: clamp01(toe(L)) };
  }
  // okhsv
  const cu = cusp(a, bb);
  const sMax = cu[1] / cu[0];
  const tMax = cu[1] / (1 - cu[0]);
  const S0 = 0.5;
  const k = 1 - S0 / sMax;
  const t = tMax / (C + L * tMax);
  const Lv = t * L;
  const Cv = t * C;
  const Lvt = toeInv(Lv);
  const Cvt = (Cv * Lvt) / Lv;
  const [sr, sg, sb] = oklabToLinear(Lvt, a * Cvt, bb * Cvt);
  const scale = Math.cbrt(1 / Math.max(sr, sg, sb, 1e-9));
  const Lu = L / scale;
  const Lt = toe(Lu);
  const v = Lt / Lv;
  const s = ((S0 + tMax) * Cv) / (tMax * S0 + tMax * k * Cv);
  return { h, s: clamp01(s), x: clamp01(v) };
}

// ---- Hex ---------------------------------------------------------------------------------------------------------------------

/** "#rrggbb" for bytes (each rounded and clamped). */
export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Bytes of "#rgb", "#rrggbb", "rgb" or "rrggbb" (any case); null for anything else. */
export function parseHex(text: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const tripleToHex = (model: Model, t: Triple): string => rgbToHex(toRgb(model, t.h, t.s, t.x));

/** The triple of a hex colour in a model (null when the hex is not valid). */
export function hexToTriple(model: Model, hex: string, hue = 0): Triple | null {
  const rgb = parseHex(hex);
  return rgb ? fromRgb(model, rgb[0], rgb[1], rgb[2], hue) : null;
}

/** The same colour in another model, keeping the hue through greys. */
export function convert(from: Model, to: Model, t: Triple): Triple {
  if (from === to) return t;
  const [r, g, b] = toRgb(from, t.h, t.s, t.x);
  return fromRgb(to, r, g, b, t.h);
}

/** Relative luminance's cousin for choosing readable text on a colour: true when black text reads better than white on it. */
export function prefersDarkText(rgb: Rgb): boolean {
  const [L] = linearToOklab(toLinear(rgb[0] / 255), toLinear(rgb[1] / 255), toLinear(rgb[2] / 255));
  return L > 0.65;
}

// ---- Speed -------------------------------------------------------------------------------------------------------------------
// A box of colours at one hue shares almost everything between its pixels: the gamut cusp is one number per hue, OKHSL's three
// chromas are one set per row, OKHSV's scale one number per column. `paintPlane` computes those once and does a few multiplies per
// pixel, with a table for the gamma curve, so a 96 x 96 box costs about what 200 single conversions do (scripts/bench-picker.mjs).

const LUT_N = 8192;
const GAMMA_LUT = (() => {
  const t = new Uint8Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) t[i] = Math.round(gamma(i / LUT_N) * 255);
  return t;
})();
const lutByte = (lin: number): number => GAMMA_LUT[lin <= 0 ? 0 : lin >= 1 ? LUT_N : Math.round(lin * LUT_N)]!;

/**
 * Fill `out` (RGBA bytes, `w` x `h`) with the plane of a model at one hue: saturation (or relative chroma) grows to the right,
 * value (or lightness) upwards. Display only: the gamma curve is tabulated, so a byte can differ by one from `toRgb`.
 */
export function paintPlane(model: Model, hueDeg: number, w: number, h: number, out: Uint8ClampedArray): void {
  const hue = (((hueDeg % 360) + 360) % 360 * TAU) / 360;
  const a = Math.cos(hue);
  const b = Math.sin(hue);
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548 * b;
  const cu = cusp(a, b);
  const put = (i: number, L: number, C: number): void => {
    const l = (L + C * kl) ** 3;
    const m = (L + C * km) ** 3;
    const s = (L + C * ks) ** 3;
    out[i] = lutByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    out[i + 1] = lutByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    out[i + 2] = lutByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
    out[i + 3] = 255;
  };
  const black = (i: number): void => {
    out[i] = out[i + 1] = out[i + 2] = 0;
    out[i + 3] = 255;
  };
  const white = (i: number): void => {
    out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 255;
  };
  const cols = Math.max(1, w - 1);
  const rows = Math.max(1, h - 1);
  if (model === "okhsv") {
    const sMax = cu[1] / cu[0];
    const tMax = cu[1] / (1 - cu[0]);
    const k = 1 - 0.5 / sMax;
    const col = new Float64Array(w * 5); // Lv, Cv, Lvt-related factors, scale
    for (let x = 0; x < w; x++) {
      const s = x / cols;
      const denom = 0.5 + tMax - tMax * k * s;
      const Lv = 1 - (s * 0.5) / denom;
      const Cv = (s * tMax * 0.5) / denom;
      const Lvt = toeInv(Lv);
      const Cvt = (Cv * Lvt) / Lv;
      const [sr, sg, sb] = oklabToLinear(Lvt, a * Cvt, b * Cvt);
      col[x * 5] = Lv;
      col[x * 5 + 1] = Cv;
      col[x * 5 + 2] = Math.cbrt(1 / Math.max(sr, sg, sb, 1e-9));
    }
    for (let y = 0; y < h; y++) {
      const v = 1 - y / rows;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (v <= 0) {
          black(i);
          continue;
        }
        const Lv = col[x * 5]!;
        const scale = col[x * 5 + 2]!;
        const L = v * Lv;
        const Ln = toeInv(L);
        put(i, Ln * scale, ((v * col[x * 5 + 1]! * Ln) / L) * scale);
      }
    }
  } else if (model === "okhsl") {
    for (let y = 0; y < h; y++) {
      const l = 1 - y / rows;
      if (l <= 0 || l >= 1) {
        for (let x = 0; x < w; x++) (l <= 0 ? black : white)((y * w + x) * 4);
        continue;
      }
      const L = toeInv(l);
      const [c0, cMid, cMax] = chromas(L, a, b, cu);
      const lowK1 = MID * c0;
      const lowK2 = 1 - lowK1 / cMid;
      const hiK1 = ((1 - MID) * cMid * cMid * MID_INV * MID_INV) / c0;
      const hiK2 = 1 - hiK1 / (cMax - cMid);
      for (let x = 0; x < w; x++) {
        const s = x / cols;
        let C: number;
        if (s < MID) {
          const t = MID_INV * s;
          C = (t * lowK1) / (1 - lowK2 * t);
        } else {
          const t = (s - MID) / (1 - MID);
          C = cMid + (t * hiK1) / (1 - hiK2 * t);
        }
        put((y * w + x) * 4, L, C);
      }
    }
  } else {
    // OKLCH: lightness down, chroma across (0 to CHROMA_REF). What sRGB cannot show at that lightness and hue is left transparent.
    for (let y = 0; y < h; y++) {
      const L = 1 - y / rows;
      if (L <= 0 || L >= 1) {
        for (let x = 0; x < w; x++) (L <= 0 ? black : white)((y * w + x) * 4);
        continue;
      }
      const cMax = gamutIntersection(a, b, L, 1, L, cu);
      for (let x = 0; x < w; x++) {
        const C = (x / cols) * CHROMA_REF;
        if (C <= cMax) put((y * w + x) * 4, L, C);
        else out[(y * w + x) * 4 + 3] = 0;
      }
    }
  }
}

// ---- Alpha, text formats, contrast, harmonies -------------------------------------------------------------------------------

/** A colour with transparency: bytes and an alpha of 0..1. */
export interface Colour {
  rgb: Rgb;
  alpha: number;
}

export type TextFormat = "hex" | "rgb" | "oklch";
export const TEXT_FORMATS: readonly TextFormat[] = ["hex", "rgb", "oklch"];

const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

/** "#rrggbb", or "#rrggbbaa" when alpha is below 1. */
export function colourToHex(c: Colour): string {
  return rgbToHex(c.rgb) + (c.alpha < 1 ? hex2(c.alpha * 255) : "");
}

export function rgbToOklch(rgb: Rgb): { L: number; C: number; h: number } {
  const [L, a, b] = linearToOklab(toLinear(rgb[0] / 255), toLinear(rgb[1] / 255), toLinear(rgb[2] / 255));
  return { L, C: Math.hypot(a, b), h: (((Math.atan2(b, a) * 180) / Math.PI) % 360 + 360) % 360 };
}

export function oklchToRgb(L: number, C: number, hDeg: number): Rgb {
  const r = (hDeg * Math.PI) / 180;
  return rgbOf(L, C * Math.cos(r), C * Math.sin(r));
}

const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

/** A colour as CSS text: "#2563eb", "rgb(37 99 235 / 0.5)" or "oklch(0.55 0.19 262)". */
export function formatColour(c: Colour, format: TextFormat): string {
  const a = c.alpha < 1 ? ` / ${round(c.alpha, 3)}` : "";
  if (format === "hex") return colourToHex(c);
  if (format === "rgb") return `rgb(${c.rgb[0]} ${c.rgb[1]} ${c.rgb[2]}${a})`;
  const o = rgbToOklch(c.rgb);
  return `oklch(${round(o.L, 3)} ${round(o.C, 3)} ${round(o.C < 1e-4 ? 0 : o.h, 1)}${a})`;
}

const num = (t: string, scale: number): number => (t.endsWith("%") ? (parseFloat(t) / 100) * scale : parseFloat(t));

/** Parse "#rgb", "#rgba", "#rrggbb", "#rrggbbaa" (the # is optional), "rgb()" / "rgba()" and "oklch()" (commas or spaces, "/ alpha"). */
export function parseColour(text: string): Colour | null {
  const t = text.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
  if (hex) {
    const h = hex[1]!.length <= 4 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return { rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const n = "(-?[\\d.]+%?)";
  const sep = "(?:\\s*,\\s*|\\s+)";
  const alpha = "(?:\\s*[,/]\\s*([\\d.]+%?))?";
  const rgb = new RegExp(`^rgba?\\(\\s*${n}${sep}${n}${sep}${n}${alpha}\\s*\\)$`).exec(t);
  if (rgb) {
    const v = [1, 2, 3].map((i) => num(rgb[i]!, 255));
    const al = rgb[4] === undefined ? 1 : num(rgb[4], 1);
    if (v.some((x) => !Number.isFinite(x)) || !Number.isFinite(al)) return null;
    return { rgb: [clamp255(v[0]!), clamp255(v[1]!), clamp255(v[2]!)], alpha: clamp01(al) };
  }
  const ok = new RegExp(`^oklch\\(\\s*${n}${sep}${n}${sep}(-?[\\d.]+)(?:deg)?${alpha}\\s*\\)$`).exec(t);
  if (ok) {
    const L = num(ok[1]!, 1);
    const C = num(ok[2]!, 0.4);
    const h = parseFloat(ok[3]!);
    const al = ok[4] === undefined ? 1 : num(ok[4], 1);
    if (![L, C, h, al].every(Number.isFinite)) return null;
    return { rgb: oklchToRgb(clamp01(L), Math.max(0, C), h), alpha: clamp01(al) };
  }
  return null;
}
const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

const luminance = (rgb: Rgb): number => 0.2126 * toLinear(rgb[0] / 255) + 0.7152 * toLinear(rgb[1] / 255) + 0.0722 * toLinear(rgb[2] / 255);

/** WCAG 2 contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Colour harmonies: the colour with its hue turned (each turned at its own lightness and share of the gamut, so it stays inside sRGB). */
export type Harmony = "complementary" | "split" | "triad" | "analogous" | "tetrad";
/** The colour with its hue turned by `deg`, at the same OKLab lightness and the same share of the gamut (`hue`: kept through greys). */
export function turned(rgb: Rgb, deg: number, hue = 0): Rgb {
  const [L, A, B] = linearToOklab(toLinear(rgb[0] / 255), toLinear(rgb[1] / 255), toLinear(rgb[2] / 255));
  const C = Math.hypot(A, B);
  if (C < GREY) return rgb;
  const h = (((Math.atan2(B, A) * 180) / Math.PI) % 360 + 360) % 360;
  const l = clamp01(L);
  const cMax = maxChroma(l, A / C, B / C);
  void hue;
  return relativeChromaToRgb(h + deg, cMax > 1e-9 ? clamp01(C / cMax) : 0, l);
}
export const HARMONIES: Record<Harmony, readonly number[]> = { complementary: [180], split: [150, 210], triad: [120, 240], analogous: [-30, 30], tetrad: [90, 180, 270] };
export function harmonies(rgb: Rgb, kind: Harmony, hue = 0): Rgb[] {
  return HARMONIES[kind].map((d) => turned(rgb, d, hue));
}
