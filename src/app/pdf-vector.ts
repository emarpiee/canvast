/**
 * Vector PDF (ADR 0153): a page whose picture is the paths themselves, not pixels, so it stays sharp at any print size. Takes what the SVG
 * export takes (`layoutPaths`) and writes it as a PDF content stream: fill and outline colour with transparency, linear and radial
 * gradients (as shadings), width, corners, ends, dashes, the fill rule, opacity and the blend modes PDF knows. A page with anything else
 * (masks, networks, live width profiles, arrow heads, outlines inside or outside, a gradient outline or one with transparent stops, a
 * sweep gradient) gives null and the caller draws that page as a picture instead.
 */
import type { FrameSpace } from "../core/frames";
import type { PathObject } from "../doc/model";
import type { Gradient, Paint } from "../doc/paint";
import { isGradient } from "../doc/paint";
import { NODE, miterLimitOf } from "../doc/path";
import type { SubPath } from "../doc/path";
import { mapSubs } from "../doc/path";
import { localGradient } from "../render/gradient";
import { layoutPaths } from "./svg-export";

/** A page drawn as vectors: its content stream and the named resources the stream uses (dictionary bodies). */
export interface PdfVector {
  readonly content: string;
  readonly gs: readonly string[];
  readonly shadings: readonly string[];
}

const num = (v: number): string => String(Math.round(v * 1000) / 1000);
const BLENDS: Record<string, string> = {
  multiply: "Multiply", screen: "Screen", overlay: "Overlay", darken: "Darken", lighten: "Lighten", "color-dodge": "ColorDodge",
  "color-burn": "ColorBurn", "hard-light": "HardLight", "soft-light": "SoftLight", difference: "Difference", exclusion: "Exclusion",
};

const rgbOf = (c: string): { rg: string; a: number } => ({
  rg: [1, 3, 5].map((i) => num(parseInt(c.slice(i, i + 2), 16) / 255)).join(" "),
  a: c.length === 9 ? parseInt(c.slice(7, 9), 16) / 255 : 1,
});

/** Path painting operators for sub-paths: m, l, c and h. */
function pathOps(subs: readonly SubPath[]): string {
  const out: string[] = [];
  for (const s of subs) {
    const n = s.n;
    const count = n.length / NODE;
    out.push(`${num(n[0]!)} ${num(n[1]!)} m`);
    const seg = (a: number, b: number): void => {
      const o = a * NODE, p = b * NODE;
      const straight = n[o + 4] === n[o] && n[o + 5] === n[o + 1] && n[p + 2] === n[p] && n[p + 3] === n[p + 1];
      out.push(straight ? `${num(n[p]!)} ${num(n[p + 1]!)} l` : `${num(n[o + 4]!)} ${num(n[o + 5]!)} ${num(n[p + 2]!)} ${num(n[p + 3]!)} ${num(n[p]!)} ${num(n[p + 1]!)} c`);
    };
    for (let k = 0; k + 1 < count; k++) seg(k, k + 1);
    if (s.closed) {
      if (count > 1) seg(count - 1, 0);
      out.push("h");
    }
  }
  return out.join("\n");
}

/** A shading dictionary for a gradient, its stops as one stitching function; null for a gradient PDF cannot show as it is. */
function shadingOf(g: Gradient, coords: string, kind: 2 | 3): string | null {
  if (g.stops.some((s) => s.c.length === 9 && s.c.slice(7) !== "ff")) return null; // (transparent stops need a soft mask)
  const stops = [...g.stops].sort((a, b) => a.o - b.o).map((s) => ({ o: Math.min(1, Math.max(0, s.o)), rg: rgbOf(s.c).rg }));
  if (!stops.length) return null;
  if (stops[0]!.o > 0) stops.unshift({ o: 0, rg: stops[0]!.rg });
  if (stops[stops.length - 1]!.o < 1) stops.push({ o: 1, rg: stops[stops.length - 1]!.rg });
  for (let i = 1; i < stops.length; i++) if (stops[i]!.o <= stops[i - 1]!.o) stops[i]!.o = Math.min(1, stops[i - 1]!.o + 1e-6); // (a hard edge: a hair apart)
  const fns = stops.slice(0, -1).map((s, i) => `<< /FunctionType 2 /Domain [0 1] /C0 [${s.rg}] /C1 [${stops[i + 1]!.rg}] /N 1 >>`);
  const fn = fns.length === 1 ? fns[0]! : `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(" ")}] /Bounds [${stops.slice(1, -1).map((s) => num(s.o)).join(" ")}] /Encode [${fns.map(() => "0 1").join(" ")}] >>`;
  return `<< /ShadingType ${kind} /ColorSpace /DeviceRGB /Coords [${coords}] /Function ${fn} /Extend [true true] >>`;
}

/**
 * The paths as a PDF page of `wPt` × `hPt` points, or null when the page needs something the vector path cannot say (see the head of
 * this file). The paths are framed like a pick in Export… (half the widest outline on every side) and stretched to the page.
 */
export function pdfVectorOf(paths: readonly PathObject[], space: FrameSpace, wPt: number, hPt: number): PdfVector | null {
  const lay = layoutPaths(paths, space, true);
  if (!lay) return null;
  const { placed, minX, minY, sc, w, h } = lay;
  const gs: string[] = [];
  const shadings: string[] = [];
  const gsName = (ca: number, CA: number, bm: string | null): string => {
    const body = `<< /ca ${num(ca)} /CA ${num(CA)}${bm ? ` /BM /${bm}` : ""} >>`;
    let i = gs.indexOf(body);
    if (i < 0) i = gs.push(body) - 1;
    return `/G${i}`;
  };
  // y runs down in the drawing and up on the page: one matrix at the start turns it, so every number below is in the drawing's units
  const out: string[] = [`${num(wPt / w)} 0 0 ${num(-hPt / h)} 0 ${num(hPt)} cm`];
  for (const p of placed) {
    const o = p.o;
    if (o.mask || o.net || o.profile || o.arrowStart || o.arrowEnd || o.align || (o.blend && !BLENDS[o.blend])) return null;
    if (o.stroke !== null && isGradient(o.stroke)) return null;
    if (o.fill !== null && o.stroke !== null && o.opacity < 1) return null; // (a group's opacity is not two opacities)
    const subs = mapSubs(p.subs, (x, y) => [(x - minX) * sc, (y - minY) * sc]);
    const width = o.width * p.k * sc;
    const fill: Paint | null = o.fill, stroke = o.stroke;
    const fc = fill !== null && !isGradient(fill) ? rgbOf(fill) : null;
    const sk = stroke !== null && !isGradient(stroke) ? rgbOf(stroke as string) : null;
    const ops: string[] = ["q", gsName((fc?.a ?? 1) * o.opacity, (sk?.a ?? 1) * o.opacity, o.blend ? BLENDS[o.blend]! : null) + " gs"];
    if (fc) ops.push(`${fc.rg} rg`);
    if (sk) {
      const cap = o.dash && o.dash[0] === 0 ? "round" : (o.cap ?? "round");
      const join = o.join ?? "round";
      ops.push(`${sk.rg} RG`, `${num(width)} w`, `${cap === "butt" ? 0 : cap === "round" ? 1 : 2} J`, `${join === "miter" ? 0 : join === "round" ? 1 : 2} j`);
      if (o.join === "miter") ops.push(`${num(o.miterAngle !== undefined ? miterLimitOf(o.miterAngle) : miterLimitOf(undefined))} M`);
      if (o.dash) ops.push(`[${num(o.dash[0] * width)} ${num(o.dash[1] * width)}] ${num((o.dashOffset ?? 0) * width)} d`);
    }
    const path = pathOps(subs);
    const eo = o.evenodd ? "*" : "";
    if (fill !== null && isGradient(fill)) {
      const lg = localGradient(o, fill);
      const to = (x: number, y: number): [number, number] => {
        const [px, py] = p.at(x, y);
        return [(px - minX) * sc, (py - minY) * sc];
      };
      let sh: string | null = null;
      if (lg.type === "linear") {
        const [x0, y0] = to(lg.x0, lg.y0), [x1, y1] = to(lg.x1, lg.y1);
        sh = shadingOf(fill, [x0, y0, x1, y1].map(num).join(" "), 2);
      } else if (lg.type === "radial") {
        const [cx, cy] = to(lg.cx, lg.cy);
        sh = lg.R > 0 ? shadingOf(fill, [cx, cy, 0, cx, cy, lg.R * p.k * sc].map(num).join(" "), 3) : null;
      }
      if (!sh) return null; // (a sweep gradient, or transparent stops)
      const name = `/S${shadings.push(sh) - 1}`;
      // the fill is the gradient clipped to the shape; the outline, if any, is stroked over it
      ops.push("q", path, `W${eo} n`, `${name} sh`, "Q");
      if (sk) ops.push(path, "S");
    } else {
      ops.push(path, fc && sk ? `B${eo}` : fc ? `f${eo}` : sk ? "S" : "n");
    }
    ops.push("Q");
    out.push(ops.join("\n"));
  }
  return { content: out.join("\n"), gs, shadings };
}
