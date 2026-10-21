/**
 * Turning what is drawn on a page into a paint layer's tiles (ADR 0166): the drawing is made at 1:1 on a page-sized canvas and cut into
 * 256 px tiles, each named by the hash of its pixels and deflated (codec.ts), the empty ones left out. Rasterize uses it for a layer of any
 * kind (drawn by its kind's own renderer, compose.ts), so it is one function for every kind there will be.
 */
import { deflate, hashOf, isEmpty } from "./codec";
import { TILE, tileKey } from "./model";

export interface Rasterized {
  readonly tiles: Record<string, string>;
  readonly blobs: Array<{ hash: string; data: Blob }>;
  /** Each tile's pixels, by key: drawn into the layer at once, without reading them back from storage. */
  readonly pixels: Map<string, ImageData>;
}

export async function rasterize(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Promise<Rasterized> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  draw(g);
  const out: Rasterized = { tiles: {}, blobs: [], pixels: new Map() };
  const seen = new Set<string>();
  for (let ty = 0; ty * TILE < h; ty++) {
    for (let tx = 0; tx * TILE < w; tx++) {
      // (a tile at the page's right or bottom edge is read as a whole tile: past the edge it is transparent)
      const img = g.getImageData(tx * TILE, ty * TILE, TILE, TILE);
      const rgba = new Uint8Array(img.data.buffer);
      if (isEmpty(rgba)) continue;
      const hash = await hashOf(rgba);
      out.tiles[tileKey(tx, ty)] = hash;
      out.pixels.set(tileKey(tx, ty), img);
      if (!seen.has(hash)) {
        seen.add(hash);
        out.blobs.push({ hash, data: await deflate(rgba) });
      }
    }
  }
  return out;
}
