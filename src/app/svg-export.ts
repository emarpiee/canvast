/**
 * Export vector paths as an SVG file (ADR 0107). The paths are put in the units of the first one, exactly (their anchors differ by an exact
 * amount, then one rounding), turned as they are drawn, and the drawing is scaled to a 1000-unit box so any depth of zoom comes out in
 * readable numbers. Kept: fill and outline colour with transparency, linear and radial gradients, width, corners, ends, dashes, the fill
 * rule, opacity and blend mode, names. Not kept: an outline's inside or outside position (drawn centred), which SVG has no word for.
 */
import type { FrameSpace } from "../core/frames";
import * as D from "../core/dyadic";
import type { PathObject } from "../doc/model";
import { expressObjectIn, pathSubs } from "../doc/model";
import type { Gradient, Paint } from "../doc/paint";
import { isGradient } from "../doc/paint";
import { ARROW_LEN, NODE, geometryBounds, mapSubs, miterLimitOf } from "../doc/path";
import type { Arrow } from "../doc/path";
import type { SubPath } from "../doc/path";
import { localGradient } from "../render/gradient";

const SIZE = 1000;

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (v: number): string => String(Math.round(v * 1000) / 1000);

/** "#rrggbbaa" as an SVG colour and its opacity. */
function colour(c: string): { rgb: string; a: number } {
  return { rgb: c.slice(0, 7), a: c.length === 9 ? Math.round((parseInt(c.slice(7, 9), 16) / 255) * 1000) / 1000 : 1 };
}

/** The `d` of sub-paths: a cubic for every segment, a line where both handles lie on their nodes. */
export function pathData(subs: readonly SubPath[]): string {
  const out: string[] = [];
  for (const s of subs) {
    const n = s.n;
    const count = n.length / NODE;
    out.push(`M${num(n[0]!)} ${num(n[1]!)}`);
    const seg = (a: number, b: number): void => {
      const o = a * NODE, p = b * NODE;
      const straight = n[o + 4] === n[o] && n[o + 5] === n[o + 1] && n[p + 2] === n[p] && n[p + 3] === n[p + 1];
      out.push(straight ? `L${num(n[p]!)} ${num(n[p + 1]!)}` : `C${num(n[o + 4]!)} ${num(n[o + 5]!)} ${num(n[p + 2]!)} ${num(n[p + 3]!)} ${num(n[p]!)} ${num(n[p + 1]!)}`);
    };
    for (let k = 0; k + 1 < count; k++) seg(k, k + 1);
    if (s.closed) {
      if (count > 1) seg(count - 1, 0);
      out.push("Z");
    }
  }
  return out.join("");
}

interface Placed {
  o: PathObject;
  subs: SubPath[];
  k: number;
  at: (x: number, y: number) => [number, number];
}

/** The SVG text for these paths (hidden ones left out), or null when there is nothing to draw or they are too far apart to be placed together. */
export function exportSvg(paths: readonly PathObject[], space: FrameSpace): string | null {
  const objs = paths.filter((o) => !o.hidden && o.sub.length > 0);
  if (!objs.length) return null;
  const base = objs[0]!;
  const f0 = base.frame ?? space.world;
  const placed: Placed[] = [];
  for (const src of objs) {
    const e = expressObjectIn(src, f0) as PathObject;
    const k = 2 ** (e.unit - base.unit);
    const dx = D.toNumber(D.shift(D.sub(e.anchor.x, base.anchor.x), -base.unit));
    const dy = D.toNumber(D.shift(D.sub(e.anchor.y, base.anchor.y), -base.unit));
    if (!(k > 0 && Number.isFinite(k + dx + dy))) return null;
    const at = (x: number, y: number): [number, number] => [x * k + dx, y * k + dy];
    placed.push({ o: e, subs: mapSubs(pathSubs(e), at), k, at });
  }
  // The box of everything, with half the widest outline around it, scaled to SIZE.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of placed) {
    const b = geometryBounds(p.subs);
    const h = p.o.stroke !== null ? (p.o.width * p.k) / 2 : 0;
    minX = Math.min(minX, b.minX - h);
    minY = Math.min(minY, b.minY - h);
    maxX = Math.max(maxX, b.maxX + h);
    maxY = Math.max(maxY, b.maxY + h);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const sc = SIZE / span;
  const w = (maxX - minX) * sc, h = (maxY - minY) * sc;
  const defs: string[] = [];
  const paintAttr = (p: Placed, which: "fill" | "stroke", paint: Paint | null): string => {
    if (paint === null) return ` ${which}="none"`;
    if (!isGradient(paint)) {
      const c = colour(paint);
      return ` ${which}="${c.rgb}"${c.a < 1 ? ` ${which}-opacity="${c.a}"` : ""}`;
    }
    const id = `g${defs.length}`;
    defs.push(gradientDef(id, p, paint));
    return ` ${which}="url(#${id})"`;
  };
  const gradientDef = (id: string, p: Placed, g: Gradient): string => {
    const lg = localGradient(p.o, g);
    const to = (x: number, y: number): string => {
      const [px, py] = p.at(x, y);
      return `${num((px - minX) * sc)}`.concat(" ", num((py - minY) * sc));
    };
    const stops = g.stops.map((s) => {
      const c = colour(s.c);
      return `<stop offset="${num(s.o)}" stop-color="${c.rgb}"${c.a < 1 ? ` stop-opacity="${c.a}"` : ""}/>`;
    }).join("");
    if (lg.type === "linear") {
      const [x0, y0] = to(lg.x0, lg.y0).split(" ");
      const [x1, y1] = to(lg.x1, lg.y1).split(" ");
      return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}">${stops}</linearGradient>`;
    }
    const [cx, cy] = to(lg.cx, lg.cy).split(" ");
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${num(lg.R * p.k * sc)}">${stops}</radialGradient>`;
  };
  /** The arrow heads of an open path as shapes of the outline's paint, turned along the line at its ends (ADR 0142). */
  const arrowsSvg = (p: Placed, subs: readonly SubPath[], width: number): string => {
    const o = p.o;
    if ((!o.arrowStart && !o.arrowEnd) || o.stroke === null) return "";
    const L = ARROW_LEN * width;
    let out = "";
    const head = (kind: Arrow, x: number, y: number, ux: number, uy: number): void => {
      const wx = -uy * L * 0.5, wy = ux * L * 0.5;
      const bx = x - ux * L, by = y - uy * L;
      const pts = `${num(bx + wx)} ${num(by + wy)} ${num(x)} ${num(y)} ${num(bx - wx)} ${num(by - wy)}`;
      if (kind === "dot") out += `\n  <circle cx="${num(x)}" cy="${num(y)}" r="${num(L * 0.4)}"${paintAttr(p, "fill", o.stroke)}/>`;
      else if (kind === "triangle") out += `\n  <polygon points="${pts}"${paintAttr(p, "fill", o.stroke)}/>`;
      else out += `\n  <polyline points="${pts}" fill="none"${paintAttr(p, "stroke", o.stroke)} stroke-width="${num(width)}" stroke-linejoin="miter"/>`;
    };
    for (const s of subs) {
      const c = s.n.length / NODE;
      if (s.closed || c < 2) continue;
      const dir = (i: number, j: number, hin: number, hout: number): [number, number] => {
        // out of the line at node i: from the nearest control point (or neighbouring node) that is not the node itself
        for (const [x, y] of [[s.n[i * NODE + hin]!, s.n[i * NODE + hin + 1]!], [s.n[j * NODE + hout]!, s.n[j * NODE + hout + 1]!], [s.n[j * NODE]!, s.n[j * NODE + 1]!]] as const) {
          const dx = s.n[i * NODE]! - x, dy = s.n[i * NODE + 1]! - y, d = Math.hypot(dx, dy);
          if (d > 1e-9) return [dx / d, dy / d];
        }
        return [1, 0];
      };
      if (o.arrowEnd) {
        const [ux, uy] = dir(c - 1, c - 2, 2, 4);
        head(o.arrowEnd, s.n[(c - 1) * NODE]!, s.n[(c - 1) * NODE + 1]!, ux, uy);
      }
      if (o.arrowStart) {
        const [ux, uy] = dir(0, 1, 4, 2);
        head(o.arrowStart, s.n[0]!, s.n[1]!, ux, uy);
      }
    }
    return out;
  };
  const body = placed.map((p) => {
    const o = p.o;
    const subs = mapSubs(p.subs, (x, y) => [(x - minX) * sc, (y - minY) * sc]);
    const width = o.width * p.k * sc;
    let a = ` d="${pathData(subs)}"` + paintAttr(p, "fill", o.fill) + paintAttr(p, "stroke", o.stroke);
    if (o.fill !== null && o.evenodd) a += ` fill-rule="evenodd"`;
    if (o.stroke !== null) {
      a += ` stroke-width="${num(width)}"`;
      if (o.join) a += ` stroke-linejoin="${o.join}"`;
      else a += ` stroke-linejoin="round"`;
      if (o.miterAngle !== undefined && o.join === "miter") a += ` stroke-miterlimit="${num(miterLimitOf(o.miterAngle))}"`;
      a += ` stroke-linecap="${o.dash && o.dash[0] === 0 ? "round" : (o.cap ?? "round")}"`;
      if (o.dash) a += ` stroke-dasharray="${num(o.dash[0] * width)} ${num(o.dash[1] * width)}"`;
      if (o.dash && o.dashOffset) a += ` stroke-dashoffset="${num(o.dashOffset * width)}"`;
    }
    if (o.opacity < 1) a += ` opacity="${num(o.opacity)}"`;
    if (o.blend) a += ` style="mix-blend-mode:${o.blend}"`;
    if (o.name) a += ` id="${esc(o.name.replace(/\s+/g, "-"))}"`;
    return `  <path${a}/>` + arrowsSvg(p, subs, width);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(w)} ${num(h)}" width="${num(w)}" height="${num(h)}">\n${defs.length ? `  <defs>${defs.join("")}</defs>\n` : ""}${body.join("\n")}\n</svg>\n`;
}
