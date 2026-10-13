import * as D from "../core/dyadic";
import type { Camera, Viewport } from "../core/camera";
import type { CanvasObject, ObjectId } from "../doc/model";
import type { ProjectedObject } from "./projection";
import { projectObject } from "./projection";

/**
 * Raster tile cache for committed objects (ADR 0009, planned in ADR 0005).
 *
 * Committed objects are rendered into screen-aligned tiles of TILE_CSS px,
 * which are reused while the camera pans (and on every redraw that does not
 * move the camera: drawing a new stroke, selecting, hovering). Only tiles
 * newly exposed by a pan, or touched by an edit, are rendered again.
 *
 * Exactness rules (deep zoom must never show a stale or resampled raster):
 * - A tile set (a "generation") belongs to one exact zoom level and DPR. Any
 *   zoom change starts a new generation; while the zoom keeps changing from
 *   frame to frame, frames are rendered directly and no tiles are built.
 * - Tiles are only reused at whole device-pixel offsets: the camera's pan
 *   since the generation began must be an integer number of device pixels
 *   (to 1e-6 px). Otherwise a new generation starts. Tiles are therefore
 *   copied 1:1, never scaled or resampled.
 * - Tiles are rendered by the same drawing code and projection as a direct
 *   frame, so their pixels match it (up to 8-bit compositing rounding).
 * - Tiles are derived state: never saved, dropped on any load.
 *
 * Previews (objects being moved or resized) and overlays (selection, lasso,
 * the stroke being drawn) are never cached; the caller draws them on top or
 * renders the frame directly.
 */
export const TILE_CSS = 256;
/**
 * Each tile is rendered with this many CSS px of extra border, which is then
 * discarded: rasterizers compute antialiased coverage slightly differently
 * where a path is clipped, so the clip edge is kept away from kept pixels
 * (otherwise faint seams appear where strokes cross tile edges).
 */
const GUARD_CSS = 8;

/** Objects drawn into one tile, and whether any image in it was still loading. */
interface Tile {
  canvas: HTMLCanvasElement | null;
  ids: Set<ObjectId>;
  pending: boolean;
}

interface Generation {
  key: string;
  center: Camera["center"];
  vp: Viewport;
  tiles: Map<string, Tile>;
}

export interface TileFrame {
  /** Tiles covering the viewport this frame. */
  tiles: number;
  /** Tiles rendered this frame (the rest were reused). */
  rendered: number;
  /** Objects found by the visibility query (0 when every tile was reused). */
  visible: number;
}

/**
 * Draws `list` (a paint-ordered subset of `all`) into `ctx`, whose transform
 * maps the inflated viewport `vp`. Batching must follow `all` so a tile
 * matches a full frame. Returns true if an image was still loading.
 */
export type DrawObjects = (ctx: CanvasRenderingContext2D, list: readonly ProjectedObject[], all: readonly ProjectedObject[], vp: Viewport) => boolean;
/** Extra CSS px around an object's box for antialiasing and minimum line width. */
export type Reach = (po: ProjectedObject) => number;
/** Visible committed objects for the current camera and the inflated viewport `vp`. */
export type QueryVisible = (vp: Viewport) => ProjectedObject[];

const MAX_POOL = 64;

export class TileCache {
  enabled = true;
  /** Tiles rendered since the page loaded (diagnostics and tests). */
  renderedTotal = 0;
  private gen: Generation | null = null;
  private lastKey = "";
  private readonly dirty = new Set<ObjectId>();
  private readonly pool: HTMLCanvasElement[] = [];

  constructor(private readonly getObject: (id: ObjectId) => CanvasObject | undefined) {}

  /** Drop everything (document replaced, theme changed). */
  clear(): void {
    if (this.gen) for (const t of this.gen.tiles.values()) this.release(t);
    this.gen = null;
    this.dirty.clear();
  }

  /** Objects changed (null: the whole document was replaced). Their tiles re-render on the next frame. */
  invalidate(changed: ReadonlySet<ObjectId> | null): void {
    if (!changed) this.clear();
    else if (this.gen) for (const id of changed) this.dirty.add(id);
  }

  /** An image finished loading: re-render tiles that showed a placeholder. */
  dropPending(): void {
    if (!this.gen) return;
    for (const [k, t] of this.gen.tiles) {
      if (!t.pending) continue;
      this.release(t);
      this.gen.tiles.delete(k);
    }
  }

  get tileCount(): number {
    return this.gen?.tiles.size ?? 0;
  }

  /**
   * Draw committed objects for this frame from tiles, rendering only the
   * missing ones. Returns null when this frame must be rendered directly
   * (cache disabled, zoom changing, or a DPR that does not give whole-pixel tiles).
   */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, query: QueryVisible, drawObjects: DrawObjects, reach: Reach): TileFrame | null {
    const td = TILE_CSS * dpr;
    if (!this.enabled || !Number.isInteger(td) || !Number.isInteger(GUARD_CSS * dpr)) return null;
    const key = `${cam.zi}|${cam.zf}|${dpr}`;
    const stable = key === this.lastKey;
    this.lastKey = key;
    if (this.gen && this.gen.key !== key) this.clear();
    if (!this.gen) {
      // Build tiles only once the zoom has held still for a frame.
      if (!stable) return null;
      this.gen = { key, center: cam.center, vp, tiles: new Map() };
    }
    let off = this.offset(this.gen, cam, vp, dpr);
    if (!off) {
      // Not a whole-device-pixel move: start over at this camera.
      this.clear();
      this.gen = { key, center: cam.center, vp, tiles: new Map() };
      off = { dx: 0, dy: 0 };
    }
    const g = this.gen!;
    const { dx, dy } = off;
    const m = TILE_CSS; // query margin: every tile touching the viewport lies within it
    const infl: Viewport = { width: vp.width + 2 * m, height: vp.height + 2 * m };
    const devW = Math.ceil(vp.width * dpr);
    const devH = Math.ceil(vp.height * dpr);
    const i0 = Math.floor(-dx / td);
    const i1 = Math.floor((devW - 1 - dx) / td);
    const j0 = Math.floor(-dy / td);
    const j1 = Math.floor((devH - 1 - dy) / td);
    const gd = GUARD_CSS * dpr; // guard in device px (an integer whenever td is)
    // Rendered tile rect (with guard) in the inflated viewport's CSS coordinates.
    const rect = (i: number, j: number): { l: number; t: number; r: number; b: number } => {
      const l = (i * td + dx) / dpr + m - GUARD_CSS;
      const t = (j * td + dy) / dpr + m - GUARD_CSS;
      return { l, t, r: l + TILE_CSS + 2 * GUARD_CSS, b: t + TILE_CSS + 2 * GUARD_CSS };
    };

    if (this.dirty.size) {
      // Drop tiles that showed a changed object, or that its new state overlaps.
      for (const [k, t] of g.tiles) {
        for (const id of this.dirty) {
          if (!t.ids.has(id)) continue;
          this.release(t);
          g.tiles.delete(k);
          break;
        }
      }
      for (const id of this.dirty) {
        const o = this.getObject(id);
        const po = o && projectObject(o, cam, infl, { keepTiny: true });
        if (!po) continue;
        const e = reach(po);
        const b = { minX: po.box.minX - e, minY: po.box.minY - e, maxX: po.box.maxX + e, maxY: po.box.maxY + e };
        const ia = Math.floor(((b.minX - m) * dpr - dx) / td);
        const ib = Math.floor(((b.maxX - m) * dpr - dx) / td);
        const ja = Math.floor(((b.minY - m) * dpr - dy) / td);
        const jb = Math.floor(((b.maxY - m) * dpr - dy) / td);
        // Only tiles that exist can be stale; bound the loop by them, not by the box.
        for (const [k, t] of g.tiles) {
          const [i, j] = k.split(",").map(Number) as [number, number];
          if (i < ia || i > ib || j < ja || j > jb) continue;
          this.release(t);
          g.tiles.delete(k);
        }
      }
      this.dirty.clear();
    }

    const needed: Array<[number, number]> = [];
    const missing: Array<[number, number]> = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        needed.push([i, j]);
        if (!g.tiles.has(`${i},${j}`)) missing.push([i, j]);
      }
    }
    let visible = 0;
    if (missing.length) {
      const list = query(infl);
      visible = list.length;
      for (const [i, j] of missing) {
        const r = rect(i, j);
        const mine = list.filter((po) => {
          const e = reach(po);
          return po.box.maxX + e >= r.l && po.box.minX - e <= r.r && po.box.maxY + e >= r.t && po.box.minY - e <= r.b;
        });
        const tile: Tile = { canvas: null, ids: new Set(mine.map((po) => po.obj.id)), pending: false };
        if (mine.length) {
          const canvas = this.pool.pop() ?? document.createElement("canvas");
          const size = td + 2 * gd;
          if (canvas.width !== size) canvas.width = size;
          if (canvas.height !== size) canvas.height = size;
          const tctx = canvas.getContext("2d")!;
          tctx.setTransform(1, 0, 0, 1, 0, 0);
          tctx.globalAlpha = 1;
          tctx.clearRect(0, 0, size, size);
          // Inflated CSS coords → this tile's device pixels (all offsets are whole device pixels).
          tctx.setTransform(dpr, 0, 0, dpr, -(i * td + dx) - m * dpr + gd, -(j * td + dy) - m * dpr + gd);
          tile.pending = drawObjects(tctx, mine, list, infl);
          tile.canvas = canvas;
        }
        g.tiles.set(`${i},${j}`, tile);
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    for (const [i, j] of needed) {
      const c = g.tiles.get(`${i},${j}`)!.canvas;
      if (c) ctx.drawImage(c, gd, gd, td, td, i * td + dx, j * td + dy, td, td);
    }
    ctx.restore();

    // Keep a ring of recently seen tiles for panning back; drop the rest.
    if (g.tiles.size > 3 * needed.length + 16) {
      const keep = new Set(needed.map(([i, j]) => `${i},${j}`));
      for (const [k, t] of g.tiles) {
        if (keep.has(k)) continue;
        this.release(t);
        g.tiles.delete(k);
      }
    }
    this.renderedTotal += missing.length;
    return { tiles: needed.length, rendered: missing.length, visible };
  }

  /**
   * Device-pixel offset of the current view from the generation's, or null
   * if it is not a whole number of device pixels (or is enormous).
   */
  private offset(g: Generation, cam: Camera, vp: Viewport, dpr: number): { dx: number; dy: number } | null {
    const f = 2 ** cam.zf;
    const ax = (D.toNumber(D.shift(D.sub(g.center.x, cam.center.x), cam.zi)) * f + (vp.width - g.vp.width) / 2) * dpr;
    const ay = (D.toNumber(D.shift(D.sub(g.center.y, cam.center.y), cam.zi)) * f + (vp.height - g.vp.height) / 2) * dpr;
    const dx = Math.round(ax);
    const dy = Math.round(ay);
    if (Math.abs(ax - dx) > 1e-6 || Math.abs(ay - dy) > 1e-6 || Math.abs(dx) > 2 ** 30 || Math.abs(dy) > 2 ** 30) return null;
    return { dx, dy };
  }

  private release(t: Tile): void {
    if (t.canvas && this.pool.length < MAX_POOL) this.pool.push(t.canvas);
    t.canvas = null;
  }
}
