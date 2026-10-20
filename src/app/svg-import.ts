/**
 * Read an SVG as vector shapes (ADR 0107): paths, rectangles (with rounded corners), circles, ellipses, lines, polylines and polygons, in
 * groups and with transforms (matrix, translate, scale, rotate, skew), each with its fill, outline, width, ends, corners, dashes, fill rule
 * and opacity, and linear and radial gradients. Everything is turned into paths in SVG units; nothing is run (the text is parsed as an
 * image document, never inserted in the page). A `clip-path` is read as a clipping mask (the clip's shapes, in the outermost clip only). Left out: text, images, filters, masks, patterns, markers.
 */
import type { Dash } from "../doc/stroke-look";
import type { Gradient, Paint } from "../doc/paint";
import { isPaint } from "../doc/paint";
import { NODE, geometryBounds, mapSubs } from "../doc/path";
import type { Cap, Join, SubPath } from "../doc/path";
import { parsePathData } from "../doc/svg-path";

export interface SvgShape {
  sub: SubPath[];
  fill: Paint | null;
  stroke: Paint | null;
  /** Outline width in SVG units (already scaled by the transform). */
  width: number;
  join?: Join;
  cap?: Cap;
  dash?: Dash;
  evenodd: boolean;
  opacity: number;
  name?: string;
  /** The clip (an index of `SvgImport.clips`) that cuts this shape, if any. */
  clip?: number;
}

export interface SvgImport {
  shapes: SvgShape[];
  /** The shapes of each `clip-path` used (in SVG units): one clipping mask for each. */
  clips: Array<{ sub: SubPath[] }>;
  /** The drawing's own box (its viewBox, else the box of the shapes). */
  box: { x: number; y: number; w: number; h: number };
}

type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** The matrix of a `transform` attribute (an unknown or malformed one is the identity). */
export function parseTransform(t: string | null | undefined): Matrix {
  let m = IDENTITY;
  if (!t) return m;
  for (const part of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (part[2] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some((v) => !Number.isFinite(v))) return IDENTITY;
    let n: Matrix | null = null;
    switch (part[1]) {
      case "matrix": if (a.length === 6) n = a as unknown as Matrix; break;
      case "translate": n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case "scale": n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
        const rot: Matrix = [c, s, -s, c, 0, 0];
        n = a.length === 3 ? mul(mul([1, 0, 0, 1, a[1]!, a[2]!], rot), [1, 0, 0, 1, -a[1]!, -a[2]!]) : rot;
        break;
      }
      case "skewX": n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case "skewY": n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    if (n) m = mul(m, n);
  }
  return m;
}

let swatch: CanvasRenderingContext2D | null = null;
/** Any CSS colour as "#rrggbb" or "#rrggbbaa" (the browser reads it), or null when it is not one. */
function cssColour(v: string): string | null {
  swatch ??= document.createElement("canvas").getContext("2d");
  if (!swatch) return null;
  swatch.fillStyle = "#010203";
  swatch.fillStyle = v;
  const out = String(swatch.fillStyle);
  if (out === "#010203" && v.trim().toLowerCase() !== "#010203") return null;
  if (out.startsWith("#")) return out.toLowerCase();
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(out);
  if (!m) return null;
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(+m[1]!)}${h(+m[2]!)}${h(+m[3]!)}${h(+m[4]! * 255)}`;
}

/** The pieces of an argument list split at the commas that are not inside brackets. */
const splitTop = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

/** An angle or position in a CSS gradient as degrees (deg, turn, rad, grad) or, for a percentage, as a fraction of a turn times 360. */
const cssAngle = (v: string): number | null => {
  const m = /^(-?[\d.]+)(deg|turn|rad|grad|%)?$/.exec(v.trim());
  if (!m) return null;
  const x = parseFloat(m[1]!);
  return m[2] === "turn" ? x * 360 : m[2] === "rad" ? (x * 180) / Math.PI : m[2] === "grad" ? x * 0.9 : m[2] === "%" ? x * 3.6 : x;
};

/** A CSS `conic-gradient(from 90deg at 50% 50%, colour 0deg, colour 96deg, ...)`: its first edge in degrees clockwise from the top, its centre as fractions of its box, and its stops. */
function parseConic(css: string): { from: number; at: [number, number]; stops: Array<{ o: number; c: string }> } | null {
  const m = /conic-gradient\(([\s\S]*)\)\s*(?:;|$)/.exec(css) ?? /conic-gradient\(([\s\S]*)\)/.exec(css);
  if (!m) return null;
  const parts = splitTop(m[1]!);
  let from = 0;
  let at: [number, number] = [0.5, 0.5];
  const head = /^(?:from\s+(\S+))?\s*(?:at\s+(\S+)\s+(\S+))?$/.exec(parts[0] ?? "");
  if (head && (head[1] || head[2])) {
    if (head[1]) from = cssAngle(head[1]) ?? 0;
    if (head[2] && head[3]) {
      const p = (s: string): number => (s === "left" || s === "top" ? 0 : s === "right" || s === "bottom" ? 1 : s === "center" ? 0.5 : s.endsWith("%") ? parseFloat(s) / 100 : 0.5);
      at = [p(head[2]), p(head[3])];
    }
    parts.shift();
  }
  const raw: Array<{ o: number | null; c: string }> = [];
  for (const part of parts) {
    const sm = /^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]+|[a-zA-Z]+)\s*(\S*)\s*(\S*)$/.exec(part);
    const c = sm ? cssColour(sm[1]!) : null;
    if (!sm || !c) return null;
    const a = sm[2] ? cssAngle(sm[2]) : null;
    raw.push({ o: a === null ? null : a / 360, c });
    const b = sm[3] ? cssAngle(sm[3]) : null;
    if (b !== null) raw.push({ o: b / 360, c }); // (a colour with two positions is a band)
  }
  if (raw.length < 2) return null;
  if (raw[0]!.o === null) raw[0]!.o = 0;
  if (raw[raw.length - 1]!.o === null) raw[raw.length - 1]!.o = 1;
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i]!.o !== null) continue;
    let j = i;
    while (raw[j]!.o === null) j++;
    const a = raw[i - 1]!.o!, z = raw[j]!.o!;
    for (let k = i; k < j; k++) raw[k]!.o = a + ((z - a) * (k - i + 1)) / (j - i + 1);
  }
  let last = 0;
  const stops = raw.map((s) => ({ o: (last = Math.min(1, Math.max(last, s.o!))), c: s.c }));
  return { from, at, stops };
}

/** The same colour with its alpha multiplied by `k`. */
function fade(c: string, k: number): string {
  if (k >= 1) return c;
  const a = c.length === 9 ? parseInt(c.slice(7, 9), 16) / 255 : 1;
  return c.slice(0, 7) + Math.round(a * Math.max(0, k) * 255).toString(16).padStart(2, "0");
}

interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  cap?: Cap;
  join?: Join;
  dash: number[];
  evenodd: boolean;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
}
const BASE_STYLE: Style = { fill: "black", stroke: "none", strokeWidth: 1, dash: [], evenodd: false, opacity: 1, fillOpacity: 1, strokeOpacity: 1 };

function readStyle(el: Element, parent: Style): Style {
  const s: Style = { ...parent, opacity: 1 }; // (opacity is not inherited; it is multiplied on the way down by the caller)
  const decl = new Map<string, string>();
  for (const a of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "fill-rule", "opacity", "fill-opacity", "stroke-opacity"]) {
    const v = el.getAttribute(a);
    if (v !== null) decl.set(a, v.trim());
  }
  for (const part of (el.getAttribute("style") ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i > 0) decl.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  const n = (k: string): number | undefined => {
    const v = parseFloat(decl.get(k) ?? "");
    return Number.isFinite(v) ? v : undefined;
  };
  if (decl.has("fill")) s.fill = decl.get("fill")!;
  if (decl.has("stroke")) s.stroke = decl.get("stroke")!;
  s.strokeWidth = n("stroke-width") ?? s.strokeWidth;
  const cap = decl.get("stroke-linecap");
  if (cap === "butt" || cap === "square" || cap === "round") { if (cap === "round") delete s.cap; else s.cap = cap; }
  const join = decl.get("stroke-linejoin");
  if (join === "miter" || join === "bevel" || join === "round" || join === "miter-clip" || join === "arcs") { if (join === "round") delete s.join; else s.join = join === "bevel" ? "bevel" : "miter"; }
  if (decl.has("stroke-dasharray")) {
    const d = decl.get("stroke-dasharray")!;
    s.dash = d === "none" ? [] : d.split(/[\s,]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v) && v >= 0);
  }
  if (decl.has("fill-rule")) s.evenodd = decl.get("fill-rule") === "evenodd";
  s.opacity = n("opacity") ?? 1;
  s.fillOpacity = (n("fill-opacity") ?? parent.fillOpacity);
  s.strokeOpacity = (n("stroke-opacity") ?? parent.strokeOpacity);
  return s;
}

/** A length in user units (px and bare numbers; a percentage of `of`). */
function len(v: string | null, of = 0): number {
  if (v === null) return 0;
  const x = parseFloat(v);
  if (!Number.isFinite(x)) return 0;
  return v.trim().endsWith("%") ? (x / 100) * of : x;
}

const K = 0.5522847498307936; // a quarter circle as one cubic
function ellipseData(cx: number, cy: number, rx: number, ry: number): SubPath {
  const n = [
    cx + rx, cy, cx + rx, cy - ry * K, cx + rx, cy + ry * K,
    cx, cy + ry, cx + rx * K, cy + ry, cx - rx * K, cy + ry,
    cx - rx, cy, cx - rx, cy + ry * K, cx - rx, cy - ry * K,
    cx, cy - ry, cx - rx * K, cy - ry, cx + rx * K, cy - ry,
  ];
  return { n, closed: true };
}

function roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number): SubPath[] {
  if (!(rx > 0 || ry > 0)) return [{ n: [x, y, x, y, x, y, x + w, y, x + w, y, x + w, y, x + w, y + h, x + w, y + h, x + w, y + h, x, y + h, x, y + h, x, y + h], closed: true }];
  rx = Math.min(rx || ry, w / 2);
  ry = Math.min(ry || rx, h / 2);
  const d = `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
  return parsePathData(d);
}

const points = (v: string | null): number[] => (v ?? "").split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));

/** The shapes of SVG text, or null when it is not an SVG document (or has nothing to draw). */
export function parseSvg(text: string): SvgImport | null {
  const docEl = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
  if (!docEl || docEl.localName !== "svg" || docEl.querySelector("parsererror")) return null;
  const gradients = new Map<string, Element>();
  for (const g of docEl.querySelectorAll("linearGradient, radialGradient")) if (g.id) gradients.set(g.id, g);
  const shapes: SvgShape[] = [];
  const clips: Array<{ sub: SubPath[] }> = [];
  const clipOf = new Map<string, number>(); // (a clip with its matrix: one mask for each place it is used)
  let activeClip: number | undefined;
  const stopsOf = (g: Element): Array<{ o: number; c: string }> => {
    let src: Element | undefined = g;
    for (let hops = 0; src && !src.querySelector("stop") && hops < 5; hops++) {
      const ref = (src.getAttribute("href") ?? src.getAttribute("xlink:href") ?? "").replace("#", "");
      src = gradients.get(ref);
    }
    const out: Array<{ o: number; c: string }> = [];
    let last = 0;
    for (const s of src?.querySelectorAll("stop") ?? []) {
      const st = readStyle(s, { ...BASE_STYLE });
      const raw = (s.getAttribute("style")?.match(/stop-color:\s*([^;]+)/)?.[1] ?? s.getAttribute("stop-color") ?? "black").trim();
      const op = parseFloat(s.getAttribute("style")?.match(/stop-opacity:\s*([^;]+)/)?.[1] ?? s.getAttribute("stop-opacity") ?? "1");
      const c = cssColour(raw) ?? "#000000";
      const off = s.getAttribute("offset") ?? "0";
      const o = Math.min(1, Math.max(last, off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off) || 0));
      last = o;
      out.push({ o, c: fade(c, (Number.isFinite(op) ? op : 1) * st.opacity) });
    }
    return out;
  };
  // A paint value: a colour, none, or a url(#gradient) turned into the box units of the shape the gradient is on.
  const paintOf = (value: string, factor: number, sub: readonly SubPath[], m: Matrix): Paint | null => {
    const v = value.trim();
    if (v === "none" || v === "transparent") return null;
    const ref = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(v);
    if (ref) {
      const g = gradients.get(ref[1]!);
      const stops = g ? stopsOf(g) : [];
      if (!g || stops.length === 0) return null;
      const solid = (): Paint => fade(stops[0]!.c, factor);
      if (stops.length < 2) return solid();
      const b = geometryBounds(sub);
      const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
      if (!(bw > 0 && bh > 0)) return solid();
      const user = g.getAttribute("gradientUnits") === "userSpaceOnUse";
      const gt = parseTransform(g.getAttribute("gradientTransform"));
      const at = (x: number, y: number): [number, number] => {
        // user space → the shape's own space (the transform of the element is already in `sub`) → box units
        const gx = gt[0] * x + gt[2] * y + gt[4], gy = gt[1] * x + gt[3] * y + gt[5];
        const [px, py] = user ? [gx * m[0] + gy * m[2] + m[4], gx * m[1] + gy * m[3] + m[5]] : [b.minX + gx * bw, b.minY + gy * bh];
        return [(px - b.minX) / bw, (py - b.minY) / bh];
      };
      const attr = (k: string, d: number): number => {
        const raw = g.getAttribute(k);
        if (raw === null) return d;
        const x = parseFloat(raw);
        return raw.trim().endsWith("%") ? (user ? x : x / 100) : x;
      };
      const st = stops.map((s) => ({ o: s.o, c: fade(s.c, factor) }));
      if (g.localName === "linearGradient") {
        const [x0, y0] = at(attr("x1", 0), attr("y1", 0));
        const [x1, y1] = at(attr("x2", user ? 100 : 1), attr("y2", 0));
        if (x0 === x1 && y0 === y1) return solid();
        return { type: "linear", x0, y0, x1, y1, stops: st } as Gradient;
      }
      const [cx, cy] = at(attr("cx", 0.5), attr("cy", 0.5));
      // (a gradient's own transform scales its radius: design tools write r="1" and size the gradient by gradientTransform; a stretched one counts by its mean scale)
      const r = attr("r", 0.5) * Math.sqrt(Math.abs(gt[0] * gt[3] - gt[1] * gt[2])) * (user ? Math.hypot(m[0], m[1]) / Math.max(bw, bh) : 1);
      return r > 0 ? ({ type: "radial", cx, cy, r, stops: st } as Gradient) : solid();
    }
    const c = cssColour(v);
    return c ? fade(c, factor) : null;
  };
  const add = (el: Element, subs: SubPath[], st: Style, m: Matrix, alpha: number): void => {
    if (!subs.length) return;
    const sub = mapSubs(subs, (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    // an angular gradient written by this app (SVG has none: the file holds a picture, and the gradient rides on the element) is read back as the gradient
    const own = (k: "fill" | "stroke"): Gradient | null => {
      try {
        const g = JSON.parse(el.getAttribute(`data-canvast-${k}`) ?? "null") as unknown;
        return isPaint(g) && typeof g === "object" && (g as Gradient).type === "angular" ? (g as Gradient) : null;
      } catch { return null; }
    };
    const fill = own("fill") ?? paintOf(st.fill, st.fillOpacity, sub, m);
    const stroke = st.strokeWidth > 0 ? (own("stroke") ?? paintOf(st.stroke, st.strokeOpacity, sub, m)) : null;
    if (fill === null && stroke === null) return;
    const width = Math.max(st.strokeWidth * scale, 1e-9);
    // dashes are kept in widths of the outline: the first two lengths (a single one means dash and gap alike)
    const pattern = st.dash.length ? (st.dash.length === 1 ? [st.dash[0]!, st.dash[0]!] : st.dash.slice(0, 2)) : [];
    const dash: Dash | undefined = stroke !== null && pattern.length === 2 && pattern[0]! + pattern[1]! > 0 ? [(pattern[0]! * scale) / width, (pattern[1]! * scale) / width] : undefined;
    const id = el.getAttribute("id");
    shapes.push({
      sub, fill, stroke, width, evenodd: st.evenodd, opacity: Math.min(1, Math.max(0.01, alpha)),
      ...(activeClip !== undefined ? { clip: activeClip } : {}),
      ...(st.join ? { join: st.join } : {}), ...(st.cap ? { cap: st.cap } : {}), ...(dash ? { dash } : {}), ...(id ? { name: id.slice(0, 80) } : {}),
    });
  };
  // <use href="#id">: the referenced shape (or group, or the children of a symbol) drawn again where the use is, moved by its x and y.
  const byId = new Map<string, Element>();
  for (const e of docEl.querySelectorAll("[id]")) if (!byId.has(e.id)) byId.set(e.id, e);
  let useDepth = 0;
  // The outline of one clip shape, in its own units (a path, rectangle, circle, ellipse or polygon).
  const geomOf = (el: Element, vw: number, vh: number): SubPath[] | null => {
    const f = (k: string, of = 0): number => len(el.getAttribute(k), of);
    switch (el.localName) {
      case "path": return parsePathData(el.getAttribute("d") ?? "");
      case "rect": { const w = f("width", vw), h = f("height", vh); return w > 0 && h > 0 ? roundedRect(f("x", vw), f("y", vh), w, h, f("rx", vw), f("ry", vh)) : null; }
      case "circle": { const r = f("r", Math.hypot(vw, vh) / Math.SQRT2); return r > 0 ? [ellipseData(f("cx", vw), f("cy", vh), r, r)] : null; }
      case "ellipse": { const rx = f("rx", vw), ry = f("ry", vh); return rx > 0 && ry > 0 ? [ellipseData(f("cx", vw), f("cy", vh), rx, ry)] : null; }
      case "polygon": {
        const p = points(el.getAttribute("points"));
        const n: number[] = [];
        for (let i = 0; i + 1 < p.length; i += 2) n.push(p[i]!, p[i + 1]!, p[i]!, p[i + 1]!, p[i]!, p[i + 1]!);
        return n.length >= 2 * NODE ? [{ n, closed: true }] : null;
      }
      default: return null;
    }
  };
  const SKIP = new Set(["defs", "clipPath", "mask", "pattern", "marker", "symbol", "style", "script", "title", "desc", "metadata", "linearGradient", "radialGradient", "foreignObject", "text"]);
  const walk = (el: Element, parent: Style, pm: Matrix, alpha: number, vw: number, vh: number, clipDone = false): void => {
    if (shapes.length > 20000) return;
    const name = el.localName;
    if (SKIP.has(name) || el.getAttribute("display") === "none" || /display:\s*none/.test(el.getAttribute("style") ?? "")) return;
    const st = readStyle(el, parent);
    const m = mul(pm, parseTransform(el.getAttribute("transform")));
    const a = alpha * st.opacity;
    const f = (k: string, of = 0): number => len(el.getAttribute(k), of);
    // clip-path="url(#id)": the clip's shapes (in the user space of this element) become a clipping mask for what is inside; the outermost one counts
    const clipRef = /url\(\s*['"]?#([^'")\s]+)/.exec(el.getAttribute("clip-path") ?? /clip-path:\s*([^;]+)/.exec(el.getAttribute("style") ?? "")?.[1] ?? "");
    const clipEl = clipRef ? byId.get(clipRef[1]!) : undefined;
    // A group that holds an HTML box with a CSS conic gradient, cut by a clip path (how another design tool writes an angular gradient, which SVG has
    // none of): the clip's shape is filled with that angular gradient. Where the box is turned or flipped, the gradient follows.
    if ((name === "g" || name === "svg") && clipEl?.localName === "clipPath" && el.querySelector("foreignObject")) {
      const fo = el.querySelector("foreignObject")!;
      const css = (fo.querySelector("div, span")?.getAttribute("style") ?? "").replace(/&quot;/g, '"');
      const conic = parseConic(css);
      if (conic) {
        let mt = m;
        const chain: Element[] = [];
        for (let n: Element | null = fo.parentElement; n && n !== el; n = n.parentElement) chain.unshift(n);
        for (const n of chain) mt = mul(mt, parseTransform(n.getAttribute("transform")));
        const fx = len(fo.getAttribute("x"), vw), fy = len(fo.getAttribute("y"), vh), fw = len(fo.getAttribute("width"), vw), fh = len(fo.getAttribute("height"), vh);
        const sub: SubPath[] = [];
        for (const c of clipEl.children) {
          const cm = mul(m, parseTransform(c.getAttribute("transform")));
          const g = c.localName === "use" ? null : geomOf(c, vw, vh);
          if (g) sub.push(...mapSubs(g, (x, y) => [cm[0] * x + cm[2] * y + cm[4], cm[1] * x + cm[3] * y + cm[5]]).map((q) => ({ ...q, closed: true })));
        }
        const b = geometryBounds(sub);
        const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
        if (sub.length && bw > 0 && bh > 0) {
          const lx = fx + conic.at[0] * fw, ly = fy + conic.at[1] * fh; // the gradient's centre in the box's own units, then in the drawing's
          const X = mt[0] * lx + mt[2] * ly + mt[4], Y = mt[1] * lx + mt[3] * ly + mt[5];
          const th = (conic.from * Math.PI) / 180; // the first edge: up turned by `from`, then by the box's own turn
          const dx = mt[0] * Math.sin(th) - mt[2] * Math.cos(th), dy = mt[1] * Math.sin(th) - mt[3] * Math.cos(th);
          const flipped = mt[0] * mt[3] - mt[1] * mt[2] < 0; // (a mirrored box runs the colours the other way round)
          const stops = flipped ? [...conic.stops].reverse().map((s) => ({ o: 1 - s.o, c: s.c })) : conic.stops;
          const angle = ((((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360;
          const grad = { type: "angular", cx: (X - b.minX) / bw, cy: (Y - b.minY) / bh, angle: flipped ? (360 - angle) % 360 : angle, stops: stops.map((s) => ({ o: s.o, c: fade(s.c, st.fillOpacity) })) } as Gradient;
          shapes.push({ sub, fill: grad, stroke: null, width: 1e-9, evenodd: false, opacity: Math.min(1, Math.max(0.01, a)), ...(activeClip !== undefined ? { clip: activeClip } : {}) });
          return; // (the shape that follows in the file is the outline, if it has one: it is read as any other)
        }
      }
    }
    if (!clipDone && clipEl?.localName === "clipPath" && activeClip === undefined && (name === "g" || name === "use" || name === "svg" || name === "a")) {
      const subs: SubPath[] = [];
      for (const c of clipEl.children) {
        const cm = mul(m, parseTransform(c.getAttribute("transform")));
        const g = c.localName === "use" ? null : geomOf(c, vw, vh);
        if (g) subs.push(...mapSubs(g, (x, y) => [cm[0] * x + cm[2] * y + cm[4], cm[1] * x + cm[3] * y + cm[5]]).map((q) => ({ ...q, closed: true })));
      }
      if (subs.length) {
        const key = `${clipRef![1]}/${m.join(",")}`;
        if (!clipOf.has(key)) { clipOf.set(key, clips.length); clips.push({ sub: subs }); }
        activeClip = clipOf.get(key);
        try { walk(el, parent, pm, alpha, vw, vh, true); } finally { activeClip = undefined; }
        return;
      }
    }
    switch (name) {
      case "svg": case "g": case "a": case "switch":
        for (const c of el.children) walk(c, st, m, a, vw, vh);
        return;
      case "use": {
        const target = byId.get((el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "").replace(/^#/, ""));
        if (!target || target === el || target.contains(el) || useDepth >= 8) return; // (a use of itself, or of what holds it, would never end)
        useDepth++;
        const um = mul(m, [1, 0, 0, 1, f("x", vw), f("y", vh)] as unknown as Matrix);
        if (target.localName === "symbol") for (const c of target.children) walk(c, st, um, a, vw, vh);
        else walk(target, st, um, a, vw, vh);
        useDepth--;
        return;
      }
      case "path": add(el, parsePathData(el.getAttribute("d") ?? ""), st, m, a); return;
      case "rect": {
        const w = f("width", vw), h = f("height", vh);
        if (w > 0 && h > 0) add(el, roundedRect(f("x", vw), f("y", vh), w, h, f("rx", vw), f("ry", vh)), st, m, a);
        return;
      }
      case "circle": { const r = f("r", Math.hypot(vw, vh) / Math.SQRT2); if (r > 0) add(el, [ellipseData(f("cx", vw), f("cy", vh), r, r)], st, m, a); return; }
      case "ellipse": { const rx = f("rx", vw), ry = f("ry", vh); if (rx > 0 && ry > 0) add(el, [ellipseData(f("cx", vw), f("cy", vh), rx, ry)], st, m, a); return; }
      case "line": { const x1 = f("x1", vw), y1 = f("y1", vh), x2 = f("x2", vw), y2 = f("y2", vh); add(el, [{ n: [x1, y1, x1, y1, x1, y1, x2, y2, x2, y2, x2, y2], closed: false }], { ...st, fill: "none" }, m, a); return; }
      case "polyline": case "polygon": {
        const p = points(el.getAttribute("points"));
        const n: number[] = [];
        for (let i = 0; i + 1 < p.length; i += 2) n.push(p[i]!, p[i + 1]!, p[i]!, p[i + 1]!, p[i]!, p[i + 1]!);
        if (n.length >= 2 * NODE) add(el, [{ n, closed: name === "polygon" }], name === "polyline" ? st : st, m, a);
        return;
      }
    }
  };
  const vb = (docEl.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const vbOk = vb.length === 4 && vb.every((v) => Number.isFinite(v)) && vb[2]! > 0 && vb[3]! > 0;
  const vw = vbOk ? vb[2]! : len(docEl.getAttribute("width")) || 100;
  const vh = vbOk ? vb[3]! : len(docEl.getAttribute("height")) || 100;
  walk(docEl, BASE_STYLE, IDENTITY, 1, vw, vh);
  if (!shapes.length) return null;
  let box = vbOk ? { x: vb[0]!, y: vb[1]!, w: vb[2]!, h: vb[3]! } : null;
  if (!box) {
    const b = geometryBounds(shapes.flatMap((s) => s.sub));
    box = { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  }
  return { shapes, clips, box };
}

