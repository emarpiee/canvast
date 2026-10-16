/**
 * Colour maths for the picker: sRGB hex <-> OKHSL, OKHSV and OKHCL. Pure functions, no DOM, no imports, so it runs in a worker, in Node
 * and in any other project unchanged.
 *
 * OKHSL and OKHSV are Bjorn Ottosson's models (https://bottosson.github.io/posts/colorpicker/, MIT, Copyright (c) 2021 Bjorn
 * Ottosson; the licence text is in THIRD_PARTY_NOTICES.md): saturation is relative to the
 * sRGB gamut, so every (h, s, x) triple is a real colour and a slider never leaves the gamut. OKHCL is the third view of the same
 * space: hue and lightness are OKLab's (L is not "toe" corrected), chroma is the fraction (0..1) of the most chroma sRGB can show at
 * that lightness and hue.
 *
 * A triple is { h, s, x }: hue in degrees (0..360), s the saturation (OKHSL, OKHSV) or relative chroma (OKHCL), x the lightness
 * (OKHSL, OKHCL) or value (OKHSV); s and x run 0..1.
 */
export type Model = "okhsl" | "okhsv" | "okhcl";
export const MODELS: readonly Model[] = ["okhsl", "okhsv", "okhcl"];
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
function chromas(L: number, a: number, b: number): [number, number, number] {
  const cu = cusp(a, b);
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

// The "toe" maps OKLab L to a lightness that matches how L looks on screen (OKHSL and OKHSV use it, OKHCL does not).
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

function okhclToRgb(hDeg: number, c: number, L: number): Rgb {
  if (L >= 1) return [255, 255, 255];
  if (L <= 0) return [0, 0, 0];
  const a = Math.cos((hDeg * TAU) / 360);
  const b = Math.sin((hDeg * TAU) / 360);
  const cMax = gamutIntersection(a, b, L, 1, L, cusp(a, b));
  const C = c * cMax;
  return rgbOf(L, C * a, C * b);
}

/** The sRGB colour (bytes 0..255) of a triple in a model. */
export function toRgb(model: Model, h: number, s: number, x: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const val = clamp01(x);
  return model === "okhsl" ? okhslToRgb(hue, sat, val) : model === "okhsv" ? okhsvToRgb(hue, sat, val) : okhclToRgb(hue, sat, val);
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
  if (C < GREY) return { h: hue, s: 0, x: clamp01(model === "okhcl" ? L : toe(L)) };
  const a = A / C;
  const bb = B / C;
  const h = (((Math.atan2(B, A) * 180) / Math.PI) % 360 + 360) % 360;
  if (model === "okhcl") {
    const cMax = gamutIntersection(a, bb, clamp01(L), 1, clamp01(L), cusp(a, bb));
    return { h, s: cMax > 1e-9 ? clamp01(C / cMax) : 0, x: clamp01(L) };
  }
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
