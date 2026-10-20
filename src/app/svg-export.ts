/**
 * Export vector paths as an SVG file (ADR 0107). The paths are put in the units of the first one, exactly (their anchors differ by an exact
 * amount, then one rounding), turned as they are drawn, and the drawing is scaled to a 1000-unit box so any depth of zoom comes out in
 * readable numbers. Kept: fill and outline colour with transparency, linear and radial gradients, width, corners, ends, dashes, the fill
 * rule, opacity and blend mode, names. Not kept: an outline's inside or outside position (drawn centred), which SVG has no word for.
 */
import { outlineOf } from "../doc/outline-stroke";
import type { FrameSpace } from "../core/frames";
import * as D from "../core/dyadic";
import type { PathObject } from "../doc/model";
import { expressObjectIn, pathSubs } from "../doc/model";
import type { Gradient, Paint } from "../doc/paint";
import { isGradient, solidOf } from "../doc/paint";
import { isTexture } from "../doc/texture";
import { svgTexture } from "../render/texture";
import { regionSplit } from "../doc/network";
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

export interface Placed {
  o: PathObject;
  subs: SubPath[];
  k: number;
  at: (x: number, y: number) => [number, number];
}

/** The sheets that cut a path (those it is on that clip what lies outside them, innermost first); empty = nothing cuts it. */
export type ClipOf = (o: PathObject) => readonly PathObject[];

export interface PathLayout {
  /** The paths in the units of the first, and how to put another path in them. A path wholly outside the sheet that cuts it is left out. */
  readonly placed: Placed[];
  /** The sheets that cut a placed path, in the same units: what lies outside them is not drawn, and does not count in the box. */
  readonly clips: (p: Placed) => readonly Placed[];
  readonly place: (src: PathObject) => Placed | null;
  /** The top left of the box (in those units) and the scale to the 1000-unit box; `w` × `h` is the box after scaling. */
  readonly minX: number;
  readonly minY: number;
  readonly sc: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The paths (hidden ones left out) put in the units of the first, with their box and its scale to 1000 units; null when there is nothing
 * to draw or they are too far apart to be placed together. `evenPad`: every side gets half the widest outline (as Export… frames a pick),
 * else each path adds its own half.
 */
export function layoutPaths(paths: readonly PathObject[], space: FrameSpace, evenPad = false, clipOf?: ClipOf): PathLayout | null {
  const objs = paths.filter((o) => !o.hidden && o.sub.length > 0);
  if (!objs.length) return null;
  const base = objs[0]!;
  const f0 = base.frame ?? space.world;
  const place = (src: PathObject): Placed | null => {
    const e = expressObjectIn(src, f0) as PathObject;
    const k = 2 ** (e.unit - base.unit);
    const dx = D.toNumber(D.shift(D.sub(e.anchor.x, base.anchor.x), -base.unit));
    const dy = D.toNumber(D.shift(D.sub(e.anchor.y, base.anchor.y), -base.unit));
    if (!(k > 0 && Number.isFinite(k + dx + dy))) return null;
    const at = (x: number, y: number): [number, number] => [x * k + dx, y * k + dy];
    return { o: e, subs: mapSubs(pathSubs(e), at), k, at };
  };
  const all: Placed[] = [];
  for (const src of objs) {
    const p = place(src);
    if (!p) return null;
    all.push(p);
  }
  // The box of everything, with half the widest outline around it, scaled to SIZE. What a sheet cuts counts only where the sheet lets it through
  // (the box of a pattern that runs far past its sheet is the sheet's), and a path wholly outside its sheet is not drawn at all.
  const widest = evenPad ? Math.max(0, ...all.map((p) => (p.o.stroke !== null ? (p.o.width * p.k) / 2 : 0))) : 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const placed: Placed[] = [];
  const cut = new Map<Placed, Placed[]>();
  for (const p of all) {
    const b = geometryBounds(p.subs);
    const h = evenPad ? widest : p.o.stroke !== null ? (p.o.width * p.k) / 2 : 0;
    let [x0, y0, x1, y1] = [b.minX - h, b.minY - h, b.maxX + h, b.maxY + h];
    const clips = (clipOf?.(p.o) ?? []).map(place).filter((c): c is Placed => c !== null); // (a sheet that cannot be placed with the rest cuts nothing)
    for (const c of clips) {
      const cb = geometryBounds(c.subs);
      [x0, y0, x1, y1] = [Math.max(x0, cb.minX), Math.max(y0, cb.minY), Math.min(x1, cb.maxX), Math.min(y1, cb.maxY)];
    }
    if (clips.length && !(x0 < x1 && y0 < y1)) continue;
    placed.push(p);
    cut.set(p, clips);
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!placed.length || !(span > 0) || !Number.isFinite(span)) return null;
  const sc = SIZE / span;
  return { placed, clips: (p) => cut.get(p) ?? [], place, minX, minY, sc, w: (maxX - minX) * sc, h: (maxY - minY) * sc };
}

/** The SVG text for these paths (hidden ones left out), or null when there is nothing to draw or they are too far apart to be placed together. */
/** More tile images than this in one fill: a <pattern> instead (the file would be very long). */
const MAX_TILE_USES = 2500;

export function exportSvg(
  paths: readonly PathObject[],
  space: FrameSpace,
  maskOf: (by: string) => readonly PathObject[] = () => [],
  size?: { w: string; h: string },
  /** The shapes an objects fill repeats (null: not all shapes, a picture of the tile is written instead). */
  sourceOf?: (ids: readonly string[]) => readonly PathObject[] | null,
  evenPad = false,
  depth = 0,
  /** The sheets that cut each path: what lies outside them is cut in the SVG too, as on the canvas. */
  clipOf?: ClipOf,
): string | null {
  const lay = layoutPaths(paths, space, evenPad, clipOf);
  if (!lay) return null;
  const { placed, place, minX, minY, sc, w, h } = lay;
  const defs: string[] = [];
  let usesXlink = false;
  let cover = ""; // (what a path's fill needs drawn before it: the images of an objects fill)
  const paintAttr = (p: Placed, which: "fill" | "stroke", paint: Paint | null, d?: string): string => {
    if (paint === null) return ` ${which}="none"`;
    if (isTexture(paint) && which === "fill") {
      // an objects fill: the tile as a picture, put where the canvas puts it, one image for each tile in view, cut to the shape (a <pattern> is
      // left for very many tiles: viewers that read Qt's SVG or import into design tools leave a <pattern> empty); a picture is one image of it, the same way
      const src = paint.src.kind === "objects" && sourceOf && depth < 2 ? sourceOf(paint.src.ids) : null;
      const inner = src?.length ? exportSvg(src, space, maskOf, undefined, sourceOf, true, depth + 1) : null;
      const box = inner ? /viewBox="0 0 ([\d.e+-]+) ([\d.e+-]+)"/.exec(inner) : null;
      const tex = svgTexture(p.o, paint, (x, y) => { const [px, py] = p.at(x, y); return [(px - minX) * sc, (py - minY) * sc]; }, !inner);
      if (tex) {
        usesXlink = true;
        const id = `t${defs.length}`;
        // the shapes of the source, written once (their own gradients and masks with them) and scaled to the tile; a picture of the tile when they are not all shapes
        let img = `<image id="${id}i" xlink:href="${tex.href}" width="${num(tex.tw)}" height="${num(tex.th)}" preserveAspectRatio="none"/>`;
        if (inner && box) {
          const pre = `${id}_`;
          const rename = (t: string): string => t.replace(/\bid="([^"]+)"/g, `id="${pre}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${pre}$1)`).replace(/href="#([^"]+)"/g, `href="#${pre}$1"`);
          const innerDefs = /<defs>([\s\S]*?)<\/defs>/.exec(inner)?.[1] ?? "";
          const content = inner.slice(inner.indexOf(">") + 1, inner.lastIndexOf("</svg>")).replace(/<defs>[\s\S]*?<\/defs>/, "");
          if (inner.includes("xmlns:xlink")) usesXlink = true;
          img = rename(innerDefs) + `<g id="${id}i" transform="scale(${num(tex.tw / Number(box[1]))} ${num(tex.th / Number(box[2]))})">${rename(content)}</g>`;
        }
        const m = new DOMMatrix([...tex.matrix]);
        const inv = m.inverse();
        const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
        const [u0, u1] = [Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x))];
        const [v0, v1] = [Math.min(...corners.map((c) => c.y)), Math.max(...corners.map((c) => c.y))];
        const [i0, i1, j0, j1] = tex.repeat ? [Math.floor(u0 / tex.cw) - 1, Math.ceil(u1 / tex.cw), Math.floor(v0 / tex.ch) - 1, Math.ceil(v1 / tex.ch)] : [0, 0, 0, 0];
        const count = (i1 - i0 + 1) * (j1 - j0 + 1) * tex.tiles.length;
        if (d !== undefined && count <= MAX_TILE_USES) {
          const mat = `matrix(${tex.matrix.map(num).join(" ")})`;
          const uses: string[] = [];
          for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const [tx, ty] of tex.tiles) uses.push(`<use xlink:href="#${id}i" transform="${mat} translate(${num(tx + i * tex.cw)} ${num(ty + j * tex.ch)})"/>`);
          defs.push(img, `<clipPath id="${id}c"><path d="${d}"${p.o.evenodd ? ' clip-rule="evenodd"' : ""}/></clipPath>`);
          cover += `  <g clip-path="url(#${id}c)">${uses.join("")}</g>\n`;
          return ` fill="none"`;
        }
        const cells = tex.tiles.flatMap(([tx, ty]) => [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => `<use xlink:href="#${id}i" x="${num(tx + i * tex.cw)}" y="${num(ty + j * tex.ch)}"/>`)));
        defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(tex.cw)}" height="${num(tex.ch)}" patternTransform="matrix(${tex.matrix.map(num).join(" ")})">${img}${cells.join("")}</pattern>`);
        return ` fill="url(#${id})"`;
      }
    }
    if (!isGradient(paint)) {
      const c = colour(solidOf(paint)); // (a picture still being decoded, or an objects fill not ready: its average colour)
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
    if (lg.type === "angular") {
      // (SVG has no sweep: a linear gradient from the centre along the first edge stands in, over the shape's size)
      const b = geometryBounds(p.o.base ?? p.o.sub);
      const reach = Math.max(b.maxX - b.minX, b.maxY - b.minY);
      const [x0, y0] = to(lg.cx, lg.cy).split(" ");
      const [x1, y1] = to(lg.cx + Math.cos(lg.a0) * reach, lg.cy + Math.sin(lg.a0) * reach).split(" ");
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
  const render = (p: Placed): string => {
    const o = p.o;
    const subs = mapSubs(p.subs, (x, y) => [(x - minX) * sc, (y - minY) * sc]);
    const width = o.width * p.k * sc;
    const map = (xs: readonly SubPath[]): SubPath[] => mapSubs(xs, (x, y) => [(x - minX) * sc, (y - minY) * sc]);
    // A vector network (ADR 0146): the regions its edges enclose are filled, the edges are stroked.
    // A live width profile (ADR 0150): the outline's shape is filled with the outline's paint, and the line itself is not stroked.
    const live = !!o.profile && !o.net && o.stroke !== null;
    const split = o.net ? regionSplit({ sub: p.subs, regions: o.regions }) : null;
    const regions = split ? map(split.base) : null;
    cover = "";
    const d = pathData(subs);
    let a = ` d="${d}"` + (split ? ' fill="none"' : paintAttr(p, "fill", o.fill, live ? undefined : d)) + (live ? "" : paintAttr(p, "stroke", o.stroke));
    if (!split && o.fill !== null && o.evenodd) a += ` fill-rule="evenodd"`;
    if (o.stroke !== null && !live) {
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
    const common = `${o.opacity < 1 ? ` opacity="${num(o.opacity)}"` : ""}${o.blend ? ` style="mix-blend-mode:${o.blend}"` : ""}`;
    const fillPart = split
      ? [...(o.fill !== null && regions!.length ? [`  <path d="${pathData(regions!)}"${paintAttr(p, "fill", o.fill)}${o.evenodd ? ' fill-rule="evenodd"' : ""}${common}/>\n`] : []),
        ...split.own.filter((r) => r.paint !== null).map((r) => `  <path d="${pathData(map([r.sub]))}"${paintAttr(p, "fill", r.paint)}${common}/>\n`)].join("")
      : "";
    if (live) {
      const { rot: _r, base: _b, ...flat } = o;
      const shape = outlineOf({ ...flat, sub: subs, width }, o.profile);
      const common2 = `${o.opacity < 1 ? ` opacity="${num(o.opacity)}"` : ""}${o.blend ? ` style="mix-blend-mode:${o.blend}"` : ""}`;
      return (o.fill !== null ? `  <path${a}/>\n` : "") + `  <path d="${pathData(shape)}"${paintAttr(p, "fill", o.stroke)}${common2}/>`;
    }
    return fillPart + (cover ? cover.replace(/<g clip-path/, `<g${common} clip-path`) : "") + `  <path${a}/>` + arrowsSvg(p, subs, width);
  };
  // Masks (ADR 0144): the mask group's paths become an SVG <mask>; an inverted one is turned by a filter. A mask that cannot be placed is left out.
  const maskIds = new Map<string, string | null>();
  const maskFor = (by: string, mode: "alpha" | "luminance", invert: boolean): string | null => {
    const key = `${by}/${mode}/${invert}`;
    if (maskIds.has(key)) return maskIds.get(key)!;
    const members = maskOf(by).filter((m) => !m.hidden && m.sub.length > 0).map(place);
    const id = `m${maskIds.size}`;
    if (!members.length || members.includes(null)) { maskIds.set(key, null); return null; }
    const inner = members.map((m) => render(m!)).join("\n");
    // luminance counts transparent as black, so a black sheet goes under the shapes; the invert filters flip what they let through
    const sheet = mode === "luminance" ? `<rect width="${num(w)}" height="${num(h)}" fill="#000"/>` : "";
    let content = sheet + inner;
    if (invert) {
      const fid = `i${maskIds.size}`;
      defs.push(mode === "alpha"
        ? `<filter id="${fid}"><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -1 1"/></filter>`
        : `<filter id="${fid}"><feComponentTransfer><feFuncR type="linear" slope="-1" intercept="1"/><feFuncG type="linear" slope="-1" intercept="1"/><feFuncB type="linear" slope="-1" intercept="1"/></feComponentTransfer></filter>`);
      content = `<g filter="url(#${fid})">${content}</g>`;
    }
    defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${num(w)}" height="${num(h)}">${content}</mask>`);
    maskIds.set(key, id);
    return id;
  };
  // The sheets that cut paths (a sheet's own shape, whatever it is, is the clip): one <clipPath> for each, used by every path on it.
  const clipIds = new Map<string, string>();
  const clipFor = (c: Placed): string => {
    let id = clipIds.get(c.o.id);
    if (!id) {
      id = `c${clipIds.size}`;
      clipIds.set(c.o.id, id);
      defs.push(`<clipPath id="${id}"><path d="${pathData(mapSubs(c.subs, (x, y) => [(x - minX) * sc, (y - minY) * sc]))}"${c.o.evenodd ? ' clip-rule="evenodd"' : ""}/></clipPath>`);
    }
    return id;
  };
  const body = placed.map((p) => {
    const m = p.o.mask ? maskFor(p.o.mask.by, p.o.mask.mode, p.o.mask.invert === true) : null;
    let out = render(p);
    if (m) out = `  <g mask="url(#${m})">\n${out}\n  </g>`;
    for (const c of lay.clips(p)) out = `  <g clip-path="url(#${clipFor(c)})">\n${out}\n  </g>`;
    return out;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg"${usesXlink ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ""} viewBox="0 0 ${num(w)} ${num(h)}" width="${size ? esc(size.w) : num(w)}" height="${size ? esc(size.h) : num(h)}">\n${defs.length ? `  <defs>${defs.join("")}</defs>\n` : ""}${body.join("\n")}\n</svg>\n`;
}
