import { isLine, segmentsOf } from "./core";
import type { Paint, SubPath } from "./core";
import type { GenShape } from "./types";

const f = (v: number): string => String(Math.round(v * 100) / 100);
const stop = (c: string): { c: string; o: number } => ({ c: c.slice(0, 7), o: c.length > 7 ? parseInt(c.slice(7, 9), 16) / 255 : 1 });

/** The `d` of an SVG path for a sub-path: straight segments as `L`, curved ones as `C`, a closed one ends with `Z`. */
export function pathData(s: SubPath): string {
  const n = s.n;
  if (n.length < 6) return "";
  let d = `M${f(n[0]!)} ${f(n[1]!)}`;
  for (const [i, j] of segmentsOf(s)) {
    const a = i * 6, b = j * 6;
    d += isLine(n, i, j) ? `L${f(n[b]!)} ${f(n[b + 1]!)}` : `C${f(n[a + 4]!)} ${f(n[a + 5]!)} ${f(n[b + 2]!)} ${f(n[b + 3]!)} ${f(n[b]!)} ${f(n[b + 1]!)}`;
  }
  return s.closed ? `${d}Z` : d;
}

export interface SvgOptions {
  /** Put before the ids of the gradients, so several SVGs in one page do not share them (default "g"). */
  idPrefix?: string;
  /** The `width` and `height` attributes (any SVG length); without them the SVG fills the space it is put in. */
  width?: string | number;
  height?: string | number;
  /** The `preserveAspectRatio` attribute (default "xMidYMid meet"; "xMidYMid slice" fills a frame of another shape). */
  fit?: string;
}

/**
 * The shapes a generator made, as the text of a standalone SVG picture (a `viewBox` of the box they were made in, `xmlns` included). Shapes
 * stay vector: curves are Bézier paths, gradients are `linearGradient` and `radialGradient`, colours with transparency use `fill-opacity`.
 */
export function toSvg(shapes: readonly GenShape[], w: number, h: number, o: SvgOptions = {}): string {
  const defs: string[] = [];
  const prefix = (o.idPrefix ?? "g").replace(/[^A-Za-z0-9_-]/g, "");
  const paint = (p: Paint | null, attr: "fill" | "stroke"): string => {
    if (p === null) return `${attr}="none"`;
    if (typeof p === "string") return `${attr}="${p.slice(0, 7)}"${p.length > 7 ? ` ${attr}-opacity="${f(stop(p).o)}"` : ""}`;
    const id = `${prefix}${defs.length}`;
    const stops = p.stops.map((s) => `<stop offset="${s.o}" stop-color="${stop(s.c).c}" stop-opacity="${f(stop(s.c).o)}"/>`).join("");
    defs.push(p.type === "linear" ? `<linearGradient id="${id}" x1="${p.x0}" y1="${p.y0}" x2="${p.x1}" y2="${p.y1}">${stops}</linearGradient>` : `<radialGradient id="${id}" cx="${p.cx}" cy="${p.cy}" r="${p.r}">${stops}</radialGradient>`);
    return `${attr}="url(#${id})"`;
  };
  const body = shapes.map((s) => `<path d="${s.sub.map(pathData).join("")}" ${paint(s.fill, "fill")} ${paint(s.stroke, "stroke")}${s.stroke !== null ? ` stroke-width="${f(s.width)}" stroke-linecap="round" stroke-linejoin="round"` : ""}${s.evenodd ? ' fill-rule="evenodd"' : ""}/>`).join("");
  const size = `${o.width !== undefined ? ` width="${o.width}"` : ""}${o.height !== undefined ? ` height="${o.height}"` : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}"${size} preserveAspectRatio="${o.fit ?? "xMidYMid meet"}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body}</svg>`;
}
