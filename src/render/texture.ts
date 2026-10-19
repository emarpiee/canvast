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
import type { Layout, TexturePaint } from "../doc/texture";
import { layoutOf, nearOrigin } from "../doc/texture";
import { boxToLocal } from "./gradient";
import type { Projection } from "./projection";

export interface TextureHost {
  /** A decoded picture of the library, or null while it is still being decoded (the host asks for a redraw when it is ready). `shownPx`: how big it is drawn, for a reduced copy. */
  picture(hash: string, shownPx: number): { readonly source: CanvasImageSource; readonly w: number; readonly h: number } | null;
  /** Width ÷ height of the objects as they are drawn as a tile, or null when none of them can be drawn. */
  aspect(ids: readonly string[]): number | null;
  /** The objects drawn on a transparent canvas whose longer side is `px` pixels, or null. `version` changes when the drawing would. */
  objects(ids: readonly string[], px: number): { readonly canvas: CanvasImageSource; readonly version: string } | null;
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

/** The shapes whose tile is being drawn (a pattern whose source holds a pattern): a shape already in it, or a fourth level, is its average colour, so a cycle cannot loop. */
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

/** A pattern fill as what an SVG `<pattern>` needs (ADR 0154): the cell and its tiles, the matrix from the cell to the SVG's units, and the tile as a PNG. Null for a picture (an average colour is written) or a tile not ready. */
export interface SvgTexture {
  readonly cw: number;
  readonly ch: number;
  readonly tw: number;
  readonly th: number;
  readonly tiles: ReadonlyArray<readonly [number, number]>;
  readonly matrix: readonly [number, number, number, number, number, number];
  readonly href: string;
}
export function svgTexture(o: PathObject, t: TexturePaint, toSvg: (x: number, y: number) => [number, number], withTile = true): SvgTexture | null {
  if (!host || t.src.kind !== "objects") return null;
  const box = geometryBounds(o.base ?? o.sub);
  const [bw, bh] = [box.maxX - box.minX, box.maxY - box.minY];
  const aspect = host.aspect(t.src.ids);
  if (!(bw > 0 && bh > 0) || aspect === null) return null;
  const lay = layoutOf(t, { w: bw, h: bh }, aspect);
  if (!lay.repeat) return null;
  // local units to the SVG's: from where three local points go
  const [x0, y0] = toSvg(0, 0), [x1, y1] = toSvg(1, 0), [x2, y2] = toSvg(0, 1);
  const tilePx = Math.max(lay.tw, lay.th) * Math.hypot(x1 - x0, y1 - y0);
  const tile = withTile ? host.objects(t.src.ids, Math.min(Math.max(pow2(tilePx * 2), 64), 1024)) : null;
  if (withTile && (!tile || tile.version.endsWith("p"))) return null;
  const [mx, my] = boxToLocal(o, 0.5, 0.5);
  const theta = (o.rot ? radiansFromAngle(o.rot) : 0) + (t.rotation * Math.PI) / 180;
  const m = new DOMMatrix([x1 - x0, y1 - y0, x2 - x0, y2 - y0, x0, y0]).translateSelf(mx, my).rotateSelf((theta * 180) / Math.PI).translateSelf(lay.ox, lay.oy);
  return { cw: lay.cw, ch: lay.ch, tw: lay.tw, th: lay.th, tiles: lay.tiles, matrix: [m.a, m.b, m.c, m.d, m.e, m.f], href: tile ? (tile.canvas as HTMLCanvasElement).toDataURL("image/png") : "" };
}

const samples = new Map<string, ImageData | null>();

/** The last pattern made for each shape: shown instead of the flat average while the next one is not ready (a picture still being decoded at a new size), so a fill never blinks. */
const lastPattern = new Map<string, CanvasPattern>();
const KEEP_PATTERNS = 64;

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
  // a pattern still waiting for its pictures is not kept as the one to show later (a half-drawn tile would stay)
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
