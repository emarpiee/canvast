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
};

/** Set when a texture was drawn as its average colour because its picture or tile was not ready; `drawObjects` reads it, so the drawing is not kept as final. */
let notReady = false;
export const takeTexturePending = (): boolean => {
  const v = notReady;
  notReady = false;
  return v;
};

/** How deep tiles are made from tiles (a pattern whose source holds a pattern): one level, so a shape that is its own source cannot loop. */
let depth = 0;

/** The smallest tile, in px, that is drawn as itself; smaller is the average colour (it would only be noise). */
const MIN_TILE_PX = 2;
const MAX_CELL_PX = 4096;
const CELL_CACHE = 24;
const cells = new Map<string, HTMLCanvasElement>();

const pow2 = (v: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, v)));

/** The colour of a source on average, "#rrggbb": it is drawn into one pixel. */
export function averageColour(source: CanvasImageSource): string {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d");
  if (!g) return "#808080";
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  const a = d[3]! / 255;
  const mix = (v: number): number => Math.round(a > 0 ? v / a : 128);
  return `#${[mix(d[0]!), mix(d[1]!), mix(d[2]!)].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("")}`;
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
  if (!host || depth > 0) return t.avg;
  const box = geometryBounds(o.base ?? o.sub);
  const bw = box.maxX - box.minX, bh = box.maxY - box.minY;
  const ppu = p.ppu;
  if (!(bw > 0 && bh > 0 && ppu > 0 && Number.isFinite(ppu))) return t.avg;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  // The source: a picture, or the objects drawn as one.
  let aspect: number;
  let pic: ReturnType<TextureHost["picture"]> = null;
  if (t.src.kind === "asset") {
    pic = host.picture(t.src.hash, Math.min(bw, bh) * ppu * t.scale);
    if (!pic) {
      notReady = true;
      return t.avg;
    }
    aspect = pic.w / pic.h;
  } else {
    const a = host.aspect(t.src.ids);
    if (a === null) return t.avg;
    aspect = a;
  }
  const lay0 = layoutOf(t, { w: bw, h: bh }, aspect);
  const tilePx = Math.max(lay0.tw, lay0.th) * ppu;
  if (!(tilePx >= MIN_TILE_PX) && lay0.repeat) return t.avg;
  if (!Number.isFinite(tilePx)) return t.avg;
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
      if (!made) return t.avg;
      [cell, cw, ch] = [made, made.width, made.height];
    }
  } else {
    const res = Math.min(pow2(tilePx * dpr), 2048);
    depth++;
    let tile: ReturnType<TextureHost["objects"]>;
    try {
      tile = host.objects(t.src.ids, res);
    } finally {
      depth--;
    }
    if (!tile) return t.avg;
    if (tile.version.endsWith("p")) notReady = true; // (its pictures are still being decoded)
    const k = res / Math.max(lay.tw, lay.th);
    if (plain) {
      cell = tile.canvas;
      cw = (tile.canvas as HTMLCanvasElement).width;
      ch = (tile.canvas as HTMLCanvasElement).height;
    } else {
      const made = cellCanvas(`${t.src.ids.join(",")}|${tile.version}|${res}|${t.tile}|${t.spacing}|${t.align}|${lay.tw}`, lay, k, tile.canvas);
      if (!made) return t.avg;
      [cell, cw, ch] = [made, made.width, made.height];
    }
  }
  const pat = ctx.createPattern(cell, lay.repeat ? "repeat" : "no-repeat");
  if (!pat) return t.avg;
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
