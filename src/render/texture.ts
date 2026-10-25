/**
 * Texture fills, drawn (ADR 0154): a picture of the library or objects of the canvas as the fill of a shape. `canvasPaint` (render/gradient.ts)
 * is the one place a paint becomes something to fill with; for a texture it comes here and gets a `CanvasPattern` placed by a matrix, so
 * fills, the density preview, Export and every other drawing of a shape show it without knowing about it. The layout (where the tile lies,
 * how big, on what grid) is `doc/texture.ts`; here it is turned into pixels.
 *
 * The app tells this module where pictures and objects come from once, with `setTextureHost`; nothing else here needs the document.
 */
import { radiansFromAngle } from "../core/angle";
import * as D from "../core/dyadic";
import type { Viewport } from "../core/camera";
import type { PathObject } from "../doc/model";
import { geometryBounds } from "../doc/path";
import type { Layout, TexturePaint, TextureVary } from "../doc/texture";
import { copyAt, isVaried, layoutOf, nearOrigin, noVary, varyPeriod } from "../doc/texture";
import { boxToLocal } from "./gradient";
import type { Projection } from "./projection";

export interface TextureHost {
  /** A decoded picture of the library, or null while it is still being decoded (the host asks for a redraw when it is ready). `shownPx`: how big it is drawn, for a reduced copy. */
  picture(hash: string, shownPx: number): { readonly source: CanvasImageSource; readonly w: number; readonly h: number } | null;
  /** Width ÷ height of the objects as they are drawn as a tile, or null when none of them can be drawn. */
  aspect(ids: readonly string[]): number | null;
  /** The objects drawn on a transparent canvas whose longer side is `px` pixels, or null. `version` changes when the drawing would. */
  objects(ids: readonly string[], px: number): { readonly canvas: CanvasImageSource; readonly version: string } | null;
  /**
   * The part `u0`..`u1` × `v0`..`v1` (shares of their box) of the objects, drawn again as they are (vectors) on a `w` × `h` canvas: a copy
   * shown far larger than its tile could hold stays sharp at any depth. Null when it cannot be drawn.
   */
  objectsPart?(ids: readonly string[], u0: number, v0: number, u1: number, v1: number, w: number, h: number): { readonly canvas: CanvasImageSource; readonly pending: boolean } | null;
}

let host: TextureHost | null = null;
export const setTextureHost = (h: TextureHost | null): void => {
  host = h;
  cells.clear();
  samples.clear();
  lastPattern.clear();
};

/** Set when a texture was drawn as its average colour because its picture or tile was not ready; `drawObjects` reads it, so the drawing is not kept as final. */
let notReady = false;
export const takeTexturePending = (): boolean => {
  const v = notReady;
  notReady = false;
  return v;
};

/** The shapes whose tile is being drawn (an objects fill whose source holds an objects fill): a shape already in it, or a fourth level, is its average colour, so a cycle cannot loop. */
const drawing: string[] = [];
const MAX_NESTING = 3;

/** The smallest tile, in px, that is drawn as itself; smaller is the average colour (it would only be noise). */
const MIN_TILE_PX = 2;
const MAX_CELL_PX = 4096;
const CELL_CACHE = 24;
const cells = new Map<string, HTMLCanvasElement>();

const pow2 = (v: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, v)));

/** The colour of a source on average, "#rrggbb": it is drawn into one pixel. */
export function averageColour(source: CanvasImageSource): string {
  const N = 16;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return "#808080";
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  // The colour of what is there, each pixel by its alpha (getImageData is not premultiplied). A 1 x 1 reduction is rounded to 8 bits at its own tiny alpha,
  // so a sparse source, a few small shapes in clear space, came out pale or white.
  let r = 0, gr = 0, b = 0, a = 0;
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3]!;
    r += d[i]! * w;
    gr += d[i + 1]! * w;
    b += d[i + 2]! * w;
    a += w;
  }
  return a > 0 ? `#${[r, gr, b].map((v) => Math.round(v / a).toString(16).padStart(2, "0")).join("")}` : "#808080";
}

/** The flat colour of a texture: its stored average, but for objects the live one (documents made before the average was fixed hold pale values). Not while a tile is drawn, so a cycle cannot recurse. */
const flats = new Map<string, string>();
let measuring = false;
function flat(t: TexturePaint): string {
  if (!host || t.src.kind !== "objects" || measuring || drawing.length) return t.avg;
  measuring = true;
  try {
    const tile = host.objects(t.src.ids, 16);
    if (!tile || tile.version.endsWith("p")) return t.avg;
    const key = `${t.src.ids.join(",")}|${tile.version}`;
    let v = flats.get(key);
    if (v === undefined) {
      v = averageColour(tile.canvas);
      flats.set(key, v);
      if (flats.size > 64) flats.delete(flats.keys().next().value!);
    }
    return v;
  } finally {
    measuring = false;
  }
}

/** An objects fill as what an SVG `<pattern>` needs (ADR 0154): the cell and its tiles, the matrix from the cell to the SVG's units, and the tile as a PNG. Null for a picture or tile not ready (an average colour is written then). */
export interface SvgTexture {
  readonly cw: number;
  readonly ch: number;
  readonly tw: number;
  readonly th: number;
  readonly tiles: ReadonlyArray<readonly [number, number]>;
  readonly matrix: readonly [number, number, number, number, number, number];
  readonly href: string;
  /** False for a picture that fits or covers the shape once (one cell, no repeat). */
  readonly repeat: boolean;
  /** Varied copies (ADR 0173): the cell and tiles above are one cell's, and `href` is the block they repeat after (`period` cells a side). */
  readonly vary?: { readonly v: TextureVary; readonly n: number; readonly period: number };
}
export function svgTexture(o: PathObject, t: TexturePaint, toSvg: (x: number, y: number) => [number, number], withTile = true): SvgTexture | null {
  if (!host) return null;
  const box = geometryBounds(o.base ?? o.sub);
  const [bw, bh] = [box.maxX - box.minX, box.maxY - box.minY];
  // a picture: its decoded copy (null while it is still being decoded: the average is written, and the next export has it), as a PNG of at most 2048 px
  const pic = t.src.kind === "asset" ? host.picture(t.src.hash, SVG_PICTURE_PX) : null;
  const aspect = t.src.kind === "asset" ? (pic ? pic.w / pic.h : null) : host.aspect(t.src.ids);
  if (!(bw > 0 && bh > 0) || aspect === null) return null;
  const lay = layoutOf(t, { w: bw, h: bh }, aspect);
  // local units to the SVG's: from where three local points go
  const [x0, y0] = toSvg(0, 0), [x1, y1] = toSvg(1, 0), [x2, y2] = toSvg(0, 1);
  const tilePx = Math.max(lay.tw, lay.th) * Math.hypot(x1 - x0, y1 - y0);
  const vl = isVaried(t) ? variedLayout(o, t) : null;
  if (vl) {
    // varied copies: one cell's layout, and the block they repeat after as a picture (for many copies)
    const { n, lay0: lv, period } = vl;
    const got = withTile ? piecesOf(o, t, Math.min(Math.max(pow2(tilePx * 2), 64), 1024)) : null;
    if (withTile && (!got || got.pending)) return null;
    const k = Math.min(Math.min(Math.max(pow2(tilePx * 2), 64), 1024) / Math.max(lv.tw, lv.th), MAX_BLOCK_PX / (period * Math.max(lv.cw, lv.ch)));
    const block = got ? blockCanvas(`svg|${got.version}|${JSON.stringify(vl.v)}|${period}|${lv.cw}|${lv.ch}|${Math.round(k * 1e6)}`, lv, vl.v, got.pieces, period, k) : null;
    const m = new DOMMatrix([x1 - x0, y1 - y0, x2 - x0, y2 - y0, x0, y0]).translateSelf(vl.mx, vl.my).rotateSelf((vl.theta * 180) / Math.PI).translateSelf(lv.ox, lv.oy);
    return { cw: lv.cw, ch: lv.ch, tw: lv.tw, th: lv.th, tiles: lv.tiles, matrix: [m.a, m.b, m.c, m.d, m.e, m.f], href: block ? block.toDataURL("image/png") : "", repeat: true, vary: { v: vl.v, n, period } };
  }
  const tile = withTile && t.src.kind === "objects" ? host.objects(t.src.ids, Math.min(Math.max(pow2(tilePx * 2), 64), 1024)) : null;
  if (withTile && t.src.kind === "objects" && (!tile || tile.version.endsWith("p"))) return null;
  let href = tile ? (tile.canvas as HTMLCanvasElement).toDataURL("image/png") : "";
  if (pic) {
    const k = Math.min(1, SVG_PICTURE_PX / Math.max(pic.w, pic.h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(pic.w * k));
    c.height = Math.max(1, Math.round(pic.h * k));
    const g = c.getContext("2d");
    if (!g) return null;
    g.imageSmoothingQuality = "high";
    g.drawImage(pic.source, 0, 0, c.width, c.height);
    href = c.toDataURL("image/png");
  }
  const [mx, my] = boxToLocal(o, 0.5, 0.5);
  const theta = (o.rot ? radiansFromAngle(o.rot) : 0) + (t.rotation * Math.PI) / 180;
  const m = new DOMMatrix([x1 - x0, y1 - y0, x2 - x0, y2 - y0, x0, y0]).translateSelf(mx, my).rotateSelf((theta * 180) / Math.PI).translateSelf(lay.ox, lay.oy);
  return { cw: lay.cw, ch: lay.ch, tw: lay.tw, th: lay.th, tiles: lay.tiles, matrix: [m.a, m.b, m.c, m.d, m.e, m.f], href, repeat: lay.repeat };
}
const SVG_PICTURE_PX = 2048;

const samples = new Map<string, ImageData | null>();

/** The last pattern made for each shape: shown instead of the flat average while the next one is not ready (a picture still being decoded at a new size), so a fill never blinks. */
const lastPattern = new Map<string, CanvasPattern>();
const KEEP_PATTERNS = 64;
/** The last canvas of copies drawn one by one, reused by the other tiles of the same frame. */
let oneByOneLast: { key: string; canvas: HTMLCanvasElement } | null = null;

/** The pixels of a source at a small size, kept (a picture by its hash; objects by their ids and the document's revision, which `version` tells). */
function pixelsOf(key: string, source: CanvasImageSource, w: number, h: number): ImageData | null {
  const hit = samples.get(key);
  if (hit !== undefined) return hit;
  const c = document.createElement("canvas");
  const k = 64 / Math.max(w, h, 1);
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d", { willReadFrequently: true });
  let data: ImageData | null = null;
  if (g) {
    g.drawImage(source, 0, 0, c.width, c.height);
    data = g.getImageData(0, 0, c.width, c.height);
  }
  samples.set(key, data);
  if (samples.size > 32) samples.delete(samples.keys().next().value!);
  return data;
}

/**
 * The colour a texture has at a point of its shape, in the shape's own units, for the places too deep to draw it (the coarse view): the
 * colour of the texture right there, not the average of the whole. "transparent" where a tile has a gap or a placed picture does not reach.
 */
export function textureColourAt(o: PathObject, t: TexturePaint, x: number, y: number): string {
  if (!host) return flat(t);
  if (isVaried(t)) return variedColourAt(o, t, x, y);
  const box = geometryBounds(o.base ?? o.sub);
  const bw = box.maxX - box.minX, bh = box.maxY - box.minY;
  if (!(bw > 0 && bh > 0)) return flat(t);
  let source: CanvasImageSource;
  let sw: number, sh: number, key: string;
  if (t.src.kind === "asset") {
    const pic = host.picture(t.src.hash, 64);
    if (!pic) return flat(t);
    [source, sw, sh, key] = [pic.source, pic.w, pic.h, t.src.hash];
  } else {
    const a = host.aspect(t.src.ids);
    const tile = a === null ? null : host.objects(t.src.ids, 64);
    if (a === null || !tile) return flat(t);
    [source, sw, sh, key] = [tile.canvas, a >= 1 ? 64 : 64 * a, a >= 1 ? 64 / a : 64, `${t.src.ids.join(",")}|${tile.version}`];
  }
  const [mx, my] = boxToLocal(o, 0.5, 0.5);
  const theta = (o.rot ? radiansFromAngle(o.rot) : 0) + (t.rotation * Math.PI) / 180;
  const c = Math.cos(theta), s = Math.sin(theta);
  const u = c * (x - mx) + s * (y - my), v = -s * (x - mx) + c * (y - my);
  const lay = nearOrigin(layoutOf(t, { w: bw, h: bh }, sw / sh), u, v);
  let pu = u - lay.ox, pv = v - lay.oy;
  if (lay.repeat) {
    pu -= Math.floor(pu / lay.cw) * lay.cw;
    pv -= Math.floor(pv / lay.ch) * lay.ch;
  }
  const at = lay.tiles.find(([tx, ty]) => pu >= tx && pu < tx + lay.tw && pv >= ty && pv < ty + lay.th);
  if (!at) return "transparent";
  const px = pixelsOf(key, source, sw, sh);
  if (!px) return flat(t);
  const i = Math.min(px.width - 1, Math.max(0, Math.floor(((pu - at[0]) / lay.tw) * px.width)));
  const j = Math.min(px.height - 1, Math.max(0, Math.floor(((pv - at[1]) / lay.th) * px.height)));
  const d = px.data, n = (j * px.width + i) * 4;
  if (d[n + 3]! < 8) return "transparent";
  return `#${[d[n]!, d[n + 1]!, d[n + 2]!].map((q) => q.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The cell that is repeated, as a canvas: the tile at each place the layout gives it, and the copies that cross the cell's edges (so a hex
 * grid joins up). `k`: px per local unit. Made once for each source, size and grid (the cache is small and least recently used first).
 */
function cellCanvas(key: string, l: Layout, k: number, tile: CanvasImageSource): HTMLCanvasElement | null {
  const hit = cells.get(key);
  if (hit) {
    cells.delete(key);
    cells.set(key, hit);
    return hit;
  }
  const w = Math.max(1, Math.round(l.cw * k)), h = Math.max(1, Math.round(l.ch * k));
  if (w > MAX_CELL_PX || h > MAX_CELL_PX) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  g.imageSmoothingQuality = "high";
  for (const [tx, ty] of l.tiles) {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const x = (tx + i * l.cw) * k, y = (ty + j * l.ch) * k;
        if (x < w && x + l.tw * k > 0 && y < h && y + l.th * k > 0) g.drawImage(tile, x, y, l.tw * k, l.th * k);
      }
    }
  }
  cells.set(key, c);
  if (cells.size > CELL_CACHE) cells.delete(cells.keys().next().value!);
  return c;
}

/**
 * What to fill the shape `o` with for texture `t`, in the view described by `p`: a pattern placed on the shape's box (turned with the shape),
 * or the texture's average colour where it cannot be drawn (not decoded yet, tiles too small to see, deeper than doubles can tell).
 */
export function texturePaint(ctx: CanvasRenderingContext2D, o: PathObject, t: TexturePaint, p: Projection, vp: Viewport): CanvasPattern | string {
  if (!host || drawing.includes(o.id) || drawing.length >= MAX_NESTING) return flat(t);
  if (isVaried(t)) return variedPaint(ctx, o, t, p, vp);
  // an objects fill shown larger than its tile can hold: copy by copy with nothing varied, each drawn again from its objects (sharp at any depth)
  if (t.src.kind === "objects" && t.mode === "tile" && host.objectsPart && plainTilePx(o, t, p) > 2048 * SHARPER) return variedPaint(ctx, o, { ...t, vary: { ...noVary(), each: false } }, p, vp, true);
  const box = geometryBounds(o.base ?? o.sub);
  const bw = box.maxX - box.minX, bh = box.maxY - box.minY;
  const ppu = p.ppu;
  if (!(bw > 0 && bh > 0 && ppu > 0 && Number.isFinite(ppu))) return flat(t);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  // The source: a picture, or the objects drawn as one.
  let pendingTile = false;
  let aspect: number;
  let pic: ReturnType<TextureHost["picture"]> = null;
  if (t.src.kind === "asset") {
    pic = host.picture(t.src.hash, Math.min(bw, bh) * ppu * t.scale);
    if (!pic) {
      notReady = true;
      return lastPattern.get(o.id) ?? flat(t);
    }
    aspect = pic.w / pic.h;
  } else {
    const a = host.aspect(t.src.ids);
    if (a === null) return flat(t);
    aspect = a;
  }
  const lay0 = layoutOf(t, { w: bw, h: bh }, aspect);
  const tilePx = Math.max(lay0.tw, lay0.th) * ppu;
  if (!(tilePx >= MIN_TILE_PX) && lay0.repeat) return flat(t);
  if (!Number.isFinite(tilePx)) return flat(t);
  // The box's own frame: the origin at its middle, turned by the shape's turn and the texture's.
  const [mx, my] = boxToLocal(o, 0.5, 0.5);
  const theta = (o.rot ? radiansFromAngle(o.rot) : 0) + (t.rotation * Math.PI) / 180;
  // where the middle of the view is in local units (the projection's own point need not be the middle)
  const vx = D.toNumber(p.lx) + (vp.width / 2 - p.cx) / ppu - mx, vy = D.toNumber(p.ly) + (vp.height / 2 - p.cy) / ppu - my;
  const c = Math.cos(theta), s = Math.sin(theta);
  const lay = nearOrigin(lay0, c * vx + s * vy, -s * vx + c * vy); // (the view's middle in the box's frame)
  // The cell: the picture itself when it is one tile on a plain grid, else a canvas made of the tiles and the space between them.
  let cell: CanvasImageSource;
  let cw: number, ch: number; // the cell's size in px of its own
  const plain = lay.tiles.length === 1 && lay.tiles[0]![0] === 0 && lay.tiles[0]![1] === 0 && lay.cw === lay.tw && lay.ch === lay.th;
  if (t.src.kind === "asset") {
    const px = pic!;
    if (plain) {
      cell = px.source;
      cw = px.w;
      ch = px.h;
    } else {
      const k = Math.min(pow2(tilePx * dpr), 2048) / Math.max(lay.tw, lay.th);
      const made = cellCanvas(`${t.src.hash}|${Math.round(k * 1e6)}|${t.tile}|${t.spacing}|${t.align}|${lay.tw}`, lay, k, px.source);
      if (!made) return lastPattern.get(o.id) ?? flat(t);
      [cell, cw, ch] = [made, made.width, made.height];
    }
  } else {
    const res = Math.min(pow2(tilePx * dpr), 2048);
    drawing.push(o.id);
    let tile: ReturnType<TextureHost["objects"]>;
    try {
      tile = host.objects(t.src.ids, res);
    } finally {
      drawing.pop();
    }
    if (!tile) return lastPattern.get(o.id) ?? flat(t);
    if (tile.version.endsWith("p")) {
      notReady = true; // (its pictures are still being decoded)
      pendingTile = true;
    }
    const k = res / Math.max(lay.tw, lay.th);
    if (plain) {
      cell = tile.canvas;
      cw = (tile.canvas as HTMLCanvasElement).width;
      ch = (tile.canvas as HTMLCanvasElement).height;
    } else {
      const made = cellCanvas(`${t.src.ids.join(",")}|${tile.version}|${res}|${t.tile}|${t.spacing}|${t.align}|${lay.tw}`, lay, k, tile.canvas);
      if (!made) return flat(t);
      [cell, cw, ch] = [made, made.width, made.height];
    }
  }
  const pat = ctx.createPattern(cell, lay.repeat ? "repeat" : "no-repeat");
  if (!pat) return lastPattern.get(o.id) ?? flat(t);
  // a canvas pattern still waiting for its pictures is not kept as the one to show later (a half-drawn tile would stay)
  if (!pendingTile) {
    lastPattern.delete(o.id);
    lastPattern.set(o.id, pat);
    if (lastPattern.size > KEEP_PATTERNS) lastPattern.delete(lastPattern.keys().next().value!);
  }
  // local units → screen px (the view's middle is `p.lx`, `p.ly`), then the box's frame, then the cell's own pixels.
  const sx = p.cx, sy = p.cy;
  pat.setTransform(
    new DOMMatrix()
      .translateSelf(sx - D.toNumber(p.lx) * ppu, sy - D.toNumber(p.ly) * ppu)
      .scaleSelf(ppu)
      .translateSelf(mx, my)
      .rotateSelf((theta * 180) / Math.PI)
      .translateSelf(lay.ox, lay.oy)
      .scaleSelf(lay.cw / cw, lay.ch / ch),
  );
  return pat;
}


// ---- Varied copies (ADR 0173) -----------------------------------------------------------------------------------------------------

/**
 * A 2D affine map [a, b, c, d, e, f] (as a canvas transform), multiplied out here in doubles. A copy shown a billion times enlarged has
 * offsets near 10^11 px that cancel to a few px on the screen; DOMMatrix did not keep that (the offsets came out wrong), so the maths is
 * done here and only the final, small numbers go to the canvas.
 */
type Affine = readonly [number, number, number, number, number, number];
const ID: Affine = [1, 0, 0, 1, 0, 0];
const mul = ([a, b, c, d, e, f]: Affine, [a2, b2, c2, d2, e2, f2]: Affine): Affine => [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
const move = (m: Affine, x: number, y: number): Affine => mul(m, [1, 0, 0, 1, x, y]);
const grow = (m: Affine, sx: number, sy = sx): Affine => mul(m, [sx, 0, 0, sy, 0, 0]);
const turn = (m: Affine, deg: number): Affine => {
  const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  return mul(m, [cs, sn, -sn, cs, 0, 0]);
};
const invert = ([a, b, c, d, e, f]: Affine): Affine => {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
const apply = ([a, b, c, d, e, f]: Affine, x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
const asDom = (m: Affine): DOMMatrix => new DOMMatrix([...m]);

/** What the copies are drawn from: the picture, each object (Vary's "each"), or the objects as they lie together; with width ÷ height. */
interface Piece {
  readonly img: CanvasImageSource;
  readonly aspect: number;
  /** The objects it is a picture of (so a copy shown large can be drawn from them again); absent for a picture of the library. */
  readonly ids?: readonly string[];
}

/** The pieces of `t` at `px` on their longer side; `pending` when a picture in them is still being decoded. Null: nothing to draw. */
function piecesOf(o: PathObject, t: TexturePaint, px: number): { pieces: Piece[]; pending: boolean; version: string } | null {
  if (!host) return null;
  if (t.src.kind === "asset") {
    const pic = host.picture(t.src.hash, px);
    return pic ? { pieces: [{ img: pic.source, aspect: pic.w / pic.h }], pending: false, version: t.src.hash } : null;
  }
  const groups = t.vary?.each ? t.src.ids.map((id) => [id]) : [t.src.ids];
  const pieces: Piece[] = [];
  let pending = false;
  const versions: string[] = [];
  drawing.push(o.id);
  try {
    for (const ids of groups) {
      const a = host.aspect(ids);
      const tile = a === null ? null : host.objects(ids, px);
      if (!tile || a === null) continue; // (an object that cannot be drawn: the others still are)
      pieces.push({ img: tile.canvas, aspect: a, ids });
      pending ||= tile.version.endsWith("p");
      versions.push(tile.version);
    }
  } finally {
    drawing.pop();
  }
  return pieces.length ? { pieces, pending, version: versions.join(",") } : null;
}

/**
 * The copies of cells `i0`..`i1` × `j0`..`j1` drawn on `g`, whose transform `base` takes the layout's cell space (units of the box, the
 * first cell's top left at 0, 0) to its pixels. Each copy is fitted in its tile, then moved, turned, scaled and mirrored as `copyAt` says.
 */
function drawCopies(g: CanvasRenderingContext2D, base: Affine, l: Layout, v: TextureVary, pieces: readonly Piece[], i0: number, i1: number, j0: number, j1: number, sharp = false): { pending: boolean } {
  let pending = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      l.tiles.forEach(([tx, ty], slot) => {
        const c = copyAt(v, pieces.length, i, j, slot);
        const pc = c.src >= 0 ? pieces[c.src] : undefined;
        if (!pc) return;
        const [w, h] = pc.aspect >= l.tw / l.th ? [l.tw, l.tw / pc.aspect] : [l.th * pc.aspect, l.th];
        const m = grow(turn(move(base, i * l.cw + tx + l.tw / 2 + c.dx * l.cw, j * l.ch + ty + l.th / 2 + c.dy * l.ch), c.rot), c.k * (c.flip ? -1 : 1), c.k);
        // (the transform is set only for a copy that is drawn: most copies here are culled)
        // shown larger than its picture (in a view drawn copy by copy): the part of it in the canvas, drawn again from the objects at that size
        const scale = Math.hypot(m[0], m[1]);
        const px = scale * w, src = pc.img as { width?: number };
        if (sharp && pc.ids && host?.objectsPart && px > (src.width ?? Infinity) * SHARPER) {
          const inv = invert(m);
          const qs = [[0, 0], [g.canvas.width, 0], [0, g.canvas.height], [g.canvas.width, g.canvas.height]].map(([x, y]) => { const [qx, qy] = apply(inv, x!, y!); return { x: qx, y: qy }; });
          const u0 = Math.max(0, (Math.min(...qs.map((q) => q.x)) + w / 2) / w), u1 = Math.min(1, (Math.max(...qs.map((q) => q.x)) + w / 2) / w);
          const v0 = Math.max(0, (Math.min(...qs.map((q) => q.y)) + h / 2) / h), v1 = Math.min(1, (Math.max(...qs.map((q) => q.y)) + h / 2) / h);
          if (!(u1 > u0 && v1 > v0)) return;
          const part = host.objectsPart(pc.ids, u0, v0, u1, v1, Math.min(MAX_BLOCK_PX, Math.ceil((u1 - u0) * w * scale)), Math.min(MAX_BLOCK_PX, Math.ceil((v1 - v0) * h * scale)));
          if (part) {
            pending ||= part.pending;
            // the part's own pixels → the canvas, multiplied out here in doubles: the canvas keeps a transform in single precision, so the
            // huge offsets of a copy shown a billion times enlarged must not reach it (the part itself lies on the canvas: small numbers)
            const pc2 = part.canvas as { width: number; height: number };
            g.setTransform(...grow(move(m, -w / 2 + u0 * w, -h / 2 + v0 * h), ((u1 - u0) * w) / pc2.width, ((v1 - v0) * h) / pc2.height));
            g.drawImage(part.canvas, 0, 0);
            return;
          }
        }
        g.setTransform(...m);
        g.drawImage(pc.img, -w / 2, -h / 2, w, h);
      });
    }
  }
  return { pending };
}
/** A copy is drawn again from its objects once it is shown this many times larger than its picture. */
const SHARPER = 1.5;

/** Most px on a side of a block of varied cells (beyond, the copies are drawn one by one in the view). */
const MAX_BLOCK_PX = 4096;
/** Most copies drawn one by one in a view (beyond, the block is used even if its copies are smaller than they are shown). */
const MAX_VIEW_COPIES = 6000;
/** Cells drawn beyond each edge, for copies that are moved, turned or enlarged past their own cell. */
const MARGIN = 2;

/** A whole block of varied cells (they repeat after it) as a canvas, `k` px per box unit. */
function blockCanvas(key: string, l: Layout, v: TextureVary, pieces: readonly Piece[], period: number, k: number): HTMLCanvasElement | null {
  const hit = cells.get(key);
  if (hit) return hit;
  const w = Math.max(1, Math.round(period * l.cw * k)), h = Math.max(1, Math.round(period * l.ch * k));
  if (w > MAX_BLOCK_PX || h > MAX_BLOCK_PX) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  g.imageSmoothingQuality = "high";
  // (the scale is the block's own, so it repeats without a seam; the cells past its edges are the next block's, which copyAt repeats)
  drawCopies(g, grow(ID, w / (period * l.cw), h / (period * l.ch)), l, v, pieces, -MARGIN, period - 1 + MARGIN, -MARGIN, period - 1 + MARGIN);
  cells.set(key, c);
  if (cells.size > CELL_CACHE) cells.delete(cells.keys().next().value!);
  return c;
}

/** A varied texture (ADR 0173): a repeated block of varied cells, or, when its copies are shown larger than the block can hold, the copies in view drawn one by one. */
function variedPaint(ctx: CanvasRenderingContext2D, o: PathObject, t: TexturePaint, p: Projection, vp: Viewport, oneByOne = false): CanvasPattern | string {
  const vl = variedLayout(o, t);
  const ppu = p.ppu;
  if (!vl || !(ppu > 0 && Number.isFinite(ppu))) return flat(t);
  const { v, lay0, period, mx, my, theta } = vl;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const tilePx = Math.max(lay0.tw, lay0.th) * ppu;
  // copies too small to see one by one: the block is still drawn while it is a few px, so the shape keeps its pattern's look far out
  if (!(period * tilePx >= MIN_TILE_PX) || !Number.isFinite(tilePx)) return flat(t);
  const vx = D.toNumber(p.lx) + (vp.width / 2 - p.cx) / ppu - mx, vy = D.toNumber(p.ly) + (vp.height / 2 - p.cy) / ppu - my;
  const cs = Math.cos(theta), sn = Math.sin(theta);
  const lay = nearOrigin(lay0, cs * vx + sn * vy, -sn * vx + cs * vy, period);
  // cell space → the ctx's own units (as the pattern of a plain texture is placed)
  const toUser = move(turn(move(grow(move(ID, p.cx - D.toNumber(p.lx) * ppu, p.cy - D.toNumber(p.ly) * ppu), ppu), mx, my), (theta * 180) / Math.PI), lay.ox, lay.oy);
  const res = Math.min(Math.max(pow2(tilePx * dpr), 8), 2048);
  const got = piecesOf(o, t, res);
  if (!got) return lastPattern.get(o.id) ?? flat(t);
  if (got.pending) notReady = true;
  const want = res / Math.max(lay.tw, lay.th); // px per box unit the copies need
  const fits = !oneByOne && want * period * Math.max(lay.cw, lay.ch) <= MAX_BLOCK_PX;
  // the cells in view, in cell space
  const inv = invert(toUser);
  const corners = [[0, 0], [vp.width, 0], [0, vp.height], [vp.width, vp.height]].map(([x, y]) => { const [qx, qy] = apply(inv, x!, y!); return { x: qx, y: qy }; });
  const [i0, i1] = [Math.floor(Math.min(...corners.map((q) => q.x)) / lay.cw) - MARGIN, Math.ceil(Math.max(...corners.map((q) => q.x)) / lay.cw) + MARGIN];
  const [j0, j1] = [Math.floor(Math.min(...corners.map((q) => q.y)) / lay.ch) - MARGIN, Math.ceil(Math.max(...corners.map((q) => q.y)) / lay.ch) + MARGIN];
  const copies = (i1 - i0 + 1) * (j1 - j0 + 1) * lay.tiles.length;
  let pat: CanvasPattern | null;
  if (fits || !(copies <= MAX_VIEW_COPIES)) {
    const k = Math.min(want, MAX_BLOCK_PX / (period * Math.max(lay.cw, lay.ch)));
    const block = blockCanvas(`vary|${got.version}|${JSON.stringify(v)}|${period}|${t.tile}|${t.spacing}|${t.align}|${lay.tw}|${lay.th}|${Math.round(k * 1e6)}`, lay, v, got.pieces, period, k);
    if (!block) return flat(t);
    pat = ctx.createPattern(block, "repeat");
    pat?.setTransform(asDom(grow(toUser, (period * lay.cw) / block.width, (period * lay.ch) / block.height)));
  } else {
    // shown large: the copies in view, one by one, at the size they are shown. Every tile of a frame asks for the same view (each one drew
    // all of it again, ~100 ms a time at DPR 2), so the last one is kept while the shape, the view and the pieces stay the same
    const key = `${o.id}|${got.version}|${JSON.stringify(v)}|${JSON.stringify(lay)}|${toUser.join(",")}|${vp.width}x${vp.height}|${dpr}|${i0},${i1},${j0},${j1}`;
    let c = oneByOneLast?.key === key ? oneByOneLast.canvas : null;
    if (!c) {
      c = document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(vp.width * dpr));
      c.height = Math.max(1, Math.ceil(vp.height * dpr));
      const g = c.getContext("2d");
      if (!g) return flat(t);
      g.imageSmoothingQuality = "high";
      const pending = drawCopies(g, mul([dpr, 0, 0, dpr, 0, 0], toUser), lay, v, got.pieces, i0, i1, j0, j1, true).pending;
      if (pending) notReady = true;
      oneByOneLast = pending || got.pending ? null : { key, canvas: c };
    }
    pat = ctx.createPattern(c, "no-repeat");
    pat?.setTransform(new DOMMatrix().scaleSelf(1 / dpr));
  }
  if (!pat) return lastPattern.get(o.id) ?? flat(t);
  if (!got.pending) {
    lastPattern.delete(o.id);
    lastPattern.set(o.id, pat);
    if (lastPattern.size > KEEP_PATTERNS) lastPattern.delete(lastPattern.keys().next().value!);
  }
  return pat;
}

/** How a varied texture lies in its shape: the plain layout of its cells (square cells for each object), the block, the box's middle and turn. */
function variedLayout(o: PathObject, t: TexturePaint): { v: TextureVary; n: number; lay0: Layout; period: number; mx: number; my: number; theta: number } | null {
  const v = t.vary!;
  const box = geometryBounds(o.base ?? o.sub);
  const bw = box.maxX - box.minX, bh = box.maxY - box.minY;
  if (!host || !(bw > 0 && bh > 0)) return null;
  // each object in a square cell of its own; else the cell has the shape of the arrangement (or picture), as without Vary
  const n = t.src.kind === "objects" && v.each ? t.src.ids.length : 1;
  const pic = t.src.kind === "asset" ? host.picture(t.src.hash, 64) : null;
  const aspect = t.src.kind === "asset" ? (pic ? pic.w / pic.h : null) : v.each ? 1 : host.aspect(t.src.ids);
  if (aspect === null) return null;
  const [mx, my] = boxToLocal(o, 0.5, 0.5);
  return { v, n, lay0: layoutOf(t, { w: bw, h: bh }, aspect), period: varyPeriod(v, n), mx, my, theta: (o.rot ? radiansFromAngle(o.rot) : 0) + (t.rotation * Math.PI) / 180 };
}

/**
 * The colour of a varied texture at a point (shape units), for the places too deep to draw it: the copy that is on top there, as `drawCopies`
 * puts it (later cells over earlier ones), read from a small picture of its piece; "transparent" between copies.
 */
function variedColourAt(o: PathObject, t: TexturePaint, x: number, y: number): string {
  const vl = variedLayout(o, t);
  const got = vl && piecesOf(o, t, 64);
  if (!vl || !got) return flat(t);
  const { v, lay0: l, mx, my, theta } = vl;
  const cs = Math.cos(theta), sn = Math.sin(theta);
  const pu = cs * (x - mx) + sn * (y - my) - l.ox, pv = -sn * (x - mx) + cs * (y - my) - l.oy;
  const ci = Math.floor(pu / l.cw), cj = Math.floor(pv / l.ch);
  let hit = "transparent";
  for (let j = cj - MARGIN; j <= cj + MARGIN; j++) {
    for (let i = ci - MARGIN; i <= ci + MARGIN; i++) {
      l.tiles.forEach(([tx, ty], slot) => {
        const c = copyAt(v, got.pieces.length, i, j, slot);
        const pc = c.src >= 0 ? got.pieces[c.src] : undefined;
        if (!pc) return;
        // the point in the copy's own frame: back from its place, turn and scale
        const dx = pu - (i * l.cw + tx + l.tw / 2 + c.dx * l.cw), dy = pv - (j * l.ch + ty + l.th / 2 + c.dy * l.ch);
        const r = (-c.rot * Math.PI) / 180;
        const qx = ((Math.cos(r) * dx - Math.sin(r) * dy) / c.k) * (c.flip ? -1 : 1), qy = (Math.sin(r) * dx + Math.cos(r) * dy) / c.k;
        const [w, h] = pc.aspect >= l.tw / l.th ? [l.tw, l.tw / pc.aspect] : [l.th * pc.aspect, l.th];
        if (Math.abs(qx) >= w / 2 || Math.abs(qy) >= h / 2) return;
        const s = pc.img as { width?: number; height?: number };
        const px = pixelsOf(`vary|${got.version}|${c.src}`, pc.img, s.width ?? 64, s.height ?? 64);
        if (!px) return;
        const a = Math.min(px.width - 1, Math.floor(((qx + w / 2) / w) * px.width)), b = Math.min(px.height - 1, Math.floor(((qy + h / 2) / h) * px.height));
        const d = px.data, n = (b * px.width + a) * 4;
        if (d[n + 3]! >= 8) hit = `#${[d[n]!, d[n + 1]!, d[n + 2]!].map((q) => q.toString(16).padStart(2, "0")).join("")}`;
      });
    }
  }
  return hit;
}

/** The px a plain objects tile is shown at (its longer side). */
function plainTilePx(o: PathObject, t: TexturePaint, p: Projection): number {
  const box = geometryBounds(o.base ?? o.sub);
  const a = t.src.kind === "objects" ? host?.aspect(t.src.ids) : null;
  if (!a) return 0;
  const l = layoutOf(t, { w: box.maxX - box.minX, h: box.maxY - box.minY }, a);
  return Math.max(l.tw, l.th) * p.ppu * (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
}
