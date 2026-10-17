/**
 * GIMP gradients, `.ggr` (ADR 0122; format: developer.gimp.org/core/standards/ggr). Plain text: "GIMP Gradient", "Name: ...", the number of
 * segments, then one line per segment of 15 numbers: left, middle and right position; left and right colour (r g b a, 0 to 1); the
 * blending function (linear, curved, sine, sphere up, sphere down, step); the colouring (RGB, HSV counter-clockwise, HSV clockwise); and
 * the two end types (fixed, or foreground / background, which canvast has not got and reads as the colour written beside it).
 * canvast gradients are plain stops, so a segment that is not a straight RGB blend is turned into several stops that look the same.
 * Pure: no document, no DOM.
 */
import type { Gradient, GradientStop } from "../doc/paint";
import { MAX_STOPS, hexOf, rgbaOf } from "../doc/paint";

export interface GgrGradient {
  readonly name: string;
  readonly gradient: Gradient;
  /** Notes about what could not be kept as it was (shown to the person). */
  readonly notes: readonly string[];
}

interface Seg {
  l: number;
  m: number;
  r: number;
  lc: [number, number, number, number];
  rc: [number, number, number, number];
  blend: number;
  colouring: number;
}

const EPS = 1e-7;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** The blend factor of GIMP's gradient code, for a position 0..1 across a segment whose middle is at `mid` (0..1). */
function factor(blend: number, mid: number, pos: number): number {
  const linear = (): number => (pos <= mid ? (mid < EPS ? 0 : (0.5 * pos) / mid) : 1 - mid < EPS ? 1 : 0.5 + (0.5 * (pos - mid)) / (1 - mid));
  switch (blend) {
    case 1:
      return Math.pow(pos, Math.log(0.5) / Math.log(Math.max(mid, EPS)));
    case 2:
      return (Math.sin(-Math.PI / 2 + Math.PI * linear()) + 1) / 2;
    case 3: {
      const f = linear() - 1;
      return Math.sqrt(Math.max(0, 1 - f * f));
    }
    case 4: {
      const f = linear();
      return 1 - Math.sqrt(Math.max(0, 1 - f * f));
    }
    case 5:
      return pos >= mid ? 1 : 0;
    default:
      return linear();
  }
}

function toHsv([r, g, b]: readonly number[]): [number, number, number] {
  const max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!), d = max - min;
  const h = d === 0 ? 0 : max === r ? ((g! - b!) / d + 6) % 6 : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
  return [h / 6, max === 0 ? 0 : d / max, max];
}

function fromHsv(h: number, s: number, v: number): [number, number, number] {
  const k = (n: number): number => (n + h * 6) % 6;
  const f = (n: number): number => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

function colourIn(s: Seg, f: number): [number, number, number, number] {
  const a = s.lc[3] + (s.rc[3] - s.lc[3]) * f;
  if (s.colouring === 0) return [0, 1, 2].map((i) => s.lc[i]! + (s.rc[i]! - s.lc[i]!) * f).concat(a) as [number, number, number, number];
  const [h0, s0, v0] = toHsv(s.lc), [h1, s1, v1] = toHsv(s.rc);
  let dh = h1 - h0;
  if (s.colouring === 1 && dh < 0) dh += 1; // counter-clockwise: hue goes up
  else if (s.colouring === 2 && dh > 0) dh -= 1; // clockwise: hue goes down
  const [r, g, b] = fromHsv(((h0 + dh * f) % 1 + 1) % 1, s0 + (s1 - s0) * f, v0 + (v1 - v0) * f);
  return [r, g, b, a];
}

const stopOf = (o: number, c: readonly number[]): GradientStop => ({ o: Math.round(clamp01(o) * 1e4) / 1e4, c: hexOf([c[0]! * 255, c[1]! * 255, c[2]! * 255, clamp01(c[3]!)]) });

/** The gradients of the text of a `.ggr` file, or null when it is not one. */
export function parseGgr(text: string, fallbackName = "Gradient"): GgrGradient | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "GIMP Gradient") return null;
  let at = 1;
  let name = fallbackName;
  if (lines[at]?.startsWith("Name:")) name = lines[at++]!.slice(5).trim() || fallbackName;
  const count = Number(lines[at++]?.trim());
  if (!Number.isInteger(count) || count < 1 || count > 100000) return null;
  const segs: Seg[] = [];
  for (let i = 0; i < count; i++) {
    const p = (lines[at++] ?? "").trim().split(/\s+/).map(Number);
    if (p.length < 13 || p.slice(0, 11).some((v) => !Number.isFinite(v))) return null;
    const [l, m, r] = p as [number, number, number];
    if (!(r >= l)) return null;
    segs.push({ l, m: clamp01(r > l ? (p[1]! - l) / (r - l) : 0.5), r, lc: [p[3]!, p[4]!, p[5]!, p[6]!], rc: [p[7]!, p[8]!, p[9]!, p[10]!], blend: p[11] ?? 0, colouring: p[12] ?? 0 });
    void m;
  }
  const notes: string[] = [];
  const total = segs[segs.length - 1]!.r - segs[0]!.l;
  if (!(total > 0)) return null;
  const at01 = (x: number): number => (x - segs[0]!.l) / total;
  const plain = (s: Seg): boolean => s.colouring === 0 && (s.blend === 0 ? Math.abs(s.m - 0.5) < 1e-3 || s.lc.every((v, i) => Math.abs(v - s.rc[i]!) < 1e-6) : false);
  // Room for the extra stops of segments that are not a plain blend.
  const curved = segs.filter((s) => !plain(s)).length;
  const room = MAX_STOPS - (segs.length + 1);
  const perCurved = curved > 0 ? Math.max(0, Math.min(8, Math.floor(room / curved))) : 0;
  let stops: GradientStop[] = [];
  segs.forEach((s) => {
    stops.push(stopOf(at01(s.l), s.lc));
    if (!plain(s) && perCurved > 0) for (let k = 1; k <= perCurved; k++) {
      const pos = k / (perCurved + 1);
      stops.push(stopOf(at01(s.l) + (at01(s.r) - at01(s.l)) * pos, colourIn(s, factor(s.blend, s.m, pos))));
    }
    stops.push(stopOf(at01(s.r), s.rc));
  });
  // A boundary written twice with the same colour is one stop; two colours at one place stay (a hard edge).
  stops = stops.filter((s, i) => !(i > 0 && stops[i - 1]!.o === s.o && stops[i - 1]!.c === s.c));
  if (stops.length > MAX_STOPS) {
    // Too many segments: sample the whole gradient evenly (looks the same, hard edges soften).
    const colourAt = (t: number): number[] => {
      const x = segs[0]!.l + t * total;
      const s = segs.find((q) => x <= q.r) ?? segs[segs.length - 1]!;
      return colourIn(s, s.r > s.l ? factor(s.blend, s.m, (x - s.l) / (s.r - s.l)) : 0);
    };
    stops = Array.from({ length: MAX_STOPS }, (_, i) => stopOf(i / (MAX_STOPS - 1), colourAt(i / (MAX_STOPS - 1))));
    notes.push(`${segs.length} segments were sampled to ${MAX_STOPS} stops`);
  }
  if (segs.some((s) => !plain(s))) notes.push("curved or hue blends were turned into stops");
  if (stops.length < 2) stops = [stops[0]!, { ...stops[0]!, o: 1 }];
  return { name, gradient: { type: "linear", x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops }, notes };
}

const f6 = (v: number): string => v.toFixed(6);

/** The text of a `.ggr` file for a gradient (a radial one is written along its radius). */
export function serializeGgr(name: string, g: Gradient): string {
  const stops = g.stops;
  const out: string[] = [];
  const seg = (l: number, r: number, a: readonly number[], b: readonly number[]): void => {
    out.push([l, (l + r) / 2, r, ...a, ...b].map(f6).join(" ") + " 0 0 0 0");
  };
  const rgba = (c: string): number[] => {
    const [r, gg, b, a] = rgbaOf(c);
    return [r / 255, gg / 255, b / 255, a];
  };
  const first = stops[0]!, last = stops[stops.length - 1]!;
  if (first.o > 0) seg(0, first.o, rgba(first.c), rgba(first.c));
  for (let i = 0; i + 1 < stops.length; i++) if (stops[i + 1]!.o > stops[i]!.o) seg(stops[i]!.o, stops[i + 1]!.o, rgba(stops[i]!.c), rgba(stops[i + 1]!.c));
  if (last.o < 1) seg(last.o, 1, rgba(last.c), rgba(last.c));
  if (!out.length) seg(0, 1, rgba(first.c), rgba(last.c));
  return `GIMP Gradient\nName: ${name.replace(/[\r\n]+/g, " ")}\n${out.length}\n${out.join("\n")}\n`;
}
