/**
 * Paints (ADR 0100): what a path is filled or outlined with. A paint is a solid colour, "#rrggbb" or "#rrggbbaa", or a gradient.
 * A gradient is placed on the geometry box of the shape (the bounds of its curves, without the outline), in units of that box:
 * (0, 0) is its top-left and (1, 1) its bottom-right, so a gradient follows the shape when it is moved, stretched or turned, and a
 * shape keeps its gradient when its nodes are edited. Stops are offsets from 0 to 1, in order, with a colour each (transparency
 * allowed), and the colour before the first stop and after the last is theirs.
 */
export interface GradientStop {
  readonly o: number;
  readonly c: string;
}

export interface LinearGradient {
  readonly type: "linear";
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly stops: readonly GradientStop[];
}

export interface RadialGradient {
  readonly type: "radial";
  /** Centre, in box units; the radius in units of the box's longer side. */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly stops: readonly GradientStop[];
}

export type Gradient = LinearGradient | RadialGradient;
export type Paint = string | Gradient;

export const MAX_STOPS = 32;
const COLOUR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

export const isGradient = (p: Paint | null | undefined): p is Gradient => typeof p === "object" && p !== null;
export const isColour = (v: unknown): v is string => typeof v === "string" && COLOUR.test(v);

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6;

/** Whether `v` is a paint the document accepts. */
export function isPaint(v: unknown): v is Paint {
  if (typeof v === "string") return COLOUR.test(v);
  if (typeof v !== "object" || v === null) return false;
  const g = v as Record<string, unknown>;
  const stops = g["stops"];
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > MAX_STOPS) return false;
  let last = 0;
  for (const s of stops as Array<Record<string, unknown>>) {
    if (!s || !num(s["o"]) || (s["o"] as number) < 0 || (s["o"] as number) > 1 || (s["o"] as number) < last || !isColour(s["c"])) return false;
    last = s["o"] as number;
  }
  if (g["type"] === "linear") return num(g["x0"]) && num(g["y0"]) && num(g["x1"]) && num(g["y1"]) && (g["x0"] !== g["x1"] || g["y0"] !== g["y1"]);
  if (g["type"] === "radial") return num(g["cx"]) && num(g["cy"]) && num(g["r"]) && (g["r"] as number) > 0;
  return false;
}

export type Rgba = readonly [number, number, number, number];

/** [r, g, b, a] of "#rrggbb" or "#rrggbbaa": bytes and an alpha of 0 to 1. */
export function rgbaOf(c: string): Rgba {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1];
}

const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
export const hexOf = (c: Rgba): string => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}${c[3] < 1 ? hex2(c[3] * 255) : ""}`;

/** The colour of a gradient at offset `t` (before the first stop and after the last: theirs), blended as the browser does, premultiplied. */
export function stopsAt(stops: readonly GradientStop[], t: number): Rgba {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (!(t > first.o)) return rgbaOf(first.c);
  if (!(t < last.o)) return rgbaOf(last.c);
  let i = 1;
  while (stops[i]!.o < t) i++;
  const a = stops[i - 1]!;
  const b = stops[i]!;
  const k = b.o === a.o ? 1 : (t - a.o) / (b.o - a.o);
  const ca = rgbaOf(a.c);
  const cb = rgbaOf(b.c);
  const al = ca[3] + (cb[3] - ca[3]) * k;
  if (al <= 0) return [ca[0], ca[1], ca[2], 0];
  const mix = (x: number, y: number): number => (x * ca[3] + (y * cb[3] - x * ca[3]) * k) / al;
  return [mix(ca[0], cb[0]), mix(ca[1], cb[1]), mix(ca[2], cb[2]), al];
}

/** The stops of the part of a gradient between offsets t0 and t1, re-expressed from 0 to 1 (the colours at the ends are exact). */
export function sliceStops(stops: readonly GradientStop[], t0: number, t1: number): GradientStop[] {
  if (!(t1 > t0)) return [{ o: 0, c: hexOf(stopsAt(stops, t0)) }, { o: 1, c: hexOf(stopsAt(stops, t0)) }];
  const out: GradientStop[] = [{ o: 0, c: hexOf(stopsAt(stops, t0)) }];
  for (const s of stops) if (s.o > t0 && s.o < t1) out.push({ o: (s.o - t0) / (t1 - t0), c: s.c });
  out.push({ o: 1, c: hexOf(stopsAt(stops, t1)) });
  return out;
}

/** A solid colour standing for a paint where one is needed (the density preview, the layers list): "#rrggbb" and its opacity. */
export function inkOfPaint(p: Paint): { rgb: string; alpha: number } {
  if (!isGradient(p)) return { rgb: p.slice(0, 7), alpha: p.length === 9 ? parseInt(p.slice(7), 16) / 255 : 1 };
  // The average over the stops, each weighted by the stretch of the gradient it covers.
  const s = p.stops;
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i + 1 < s.length; i++) {
    const w = s[i + 1]!.o - s[i]!.o;
    const mid = stopsAt(s, (s[i]!.o + s[i + 1]!.o) / 2);
    r += mid[0] * mid[3] * w; g += mid[1] * mid[3] * w; b += mid[2] * mid[3] * w; a += mid[3] * w;
  }
  const lead = s[0]!.o;
  const tail = 1 - s[s.length - 1]!.o;
  const c0 = rgbaOf(s[0]!.c);
  const c1 = rgbaOf(s[s.length - 1]!.c);
  r += c0[0] * c0[3] * lead + c1[0] * c1[3] * tail; g += c0[1] * c0[3] * lead + c1[1] * c1[3] * tail; b += c0[2] * c0[3] * lead + c1[2] * c1[3] * tail; a += c0[3] * lead + c1[3] * tail;
  return a > 0 ? { rgb: hexOf([r / a, g / a, b / a, 1]), alpha: a } : { rgb: "#000000", alpha: 0 };
}

/** The colour of a paint at box offset `t` along its gradient (a solid colour is itself). */
export const colourOfPaintAt = (p: Paint, t: number): string => (isGradient(p) ? hexOf(stopsAt(p.stops, t)) : p);

/** A CSS background for a chip or a bar showing the paint: the gradient as it runs across a unit square. */
export function paintCss(p: Paint): string {
  if (!isGradient(p)) return p;
  const list = p.stops.map((s) => `${s.c} ${Math.round(s.o * 1000) / 10}%`).join(", ");
  if (p.type === "radial") return `radial-gradient(circle at ${Math.round(p.cx * 100)}% ${Math.round(p.cy * 100)}%, ${list})`;
  const deg = Math.round(((Math.atan2(p.y1 - p.y0, p.x1 - p.x0) * 180) / Math.PI + 90 + 360) % 360);
  return `linear-gradient(${deg}deg, ${list})`;
}

/** A gradient made from a colour: the colour fading to nothing (linear: across the box, left to right; radial: from the middle). */
export function gradientFrom(colour: string, type: "linear" | "radial"): Gradient {
  const clear = hexOf([...rgbaOf(colour).slice(0, 3), 0] as unknown as Rgba);
  const stops: GradientStop[] = [{ o: 0, c: colour }, { o: 1, c: clear }];
  return type === "linear" ? { type, x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops } : { type, cx: 0.5, cy: 0.5, r: 0.5, stops };
}

/** The same stops as the other kind of gradient. */
export function asKind(g: Gradient, type: "linear" | "radial"): Gradient {
  if (g.type === type) return g;
  return type === "linear" ? { type, x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: g.stops } : { type, cx: 0.5, cy: 0.5, r: 0.5, stops: g.stops };
}

/** The angle of a linear gradient, in degrees (0: left to right, 90: top to bottom). */
export const angleOf = (g: LinearGradient): number => (((Math.atan2(g.y1 - g.y0, g.x1 - g.x0) * 180) / Math.PI) % 360 + 360) % 360;

/** A linear gradient at `deg`, through the middle of the box, long enough to reach its corners. */
export function linearAt(deg: number, stops: readonly GradientStop[]): LinearGradient {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const h = (Math.abs(c) + Math.abs(s)) / 2;
  return { type: "linear", x0: 0.5 - h * c, y0: 0.5 - h * s, x1: 0.5 + h * c, y1: 0.5 + h * s, stops };
}

/** The paint as JSON text, and back (undefined when the text is not a paint): for settings. */
export const paintToText = (p: Paint | null): string => (p === null ? "none" : isGradient(p) ? JSON.stringify(p) : p);
export function paintFromText(t: string): Paint | null | undefined {
  if (t === "none") return null;
  if (t.startsWith("{")) {
    try {
      const v: unknown = JSON.parse(t);
      return isPaint(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }
  return isColour(t) ? t : undefined;
}
