import * as D from "../core/dyadic";
import type { Camera, Viewport } from "../core/camera";
import type { CanvasObject, ObjectId } from "../doc/model";
import type { ProjectedObject } from "./projection";

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

/**
 * Zoom preview (ADR 0012). In dense scenes, where an exact frame costs more
 * than DENSE_MS, frames during a zoom gesture show the last exact tile set
 * scaled, as long as the zoom is within PREVIEW_MAX_LEVELS of it. An exact
 * set is rebuilt when the zoom moves further, and REFINE_MS after the zoom
 * stops. Sparse scenes never use it: they stay exact on every frame.
 */
const DENSE_MS = 12; // default; the quality governor lowers it (app/quality.ts)
const PREVIEW_MAX_LEVELS = 1;
const REFINE_MS = 150;
/**
 * Idle-time prebuild (ADR 0033): once the view has rested this long in a dense scene, the tile sets one zoom level in
 * and one out are built in slices of at most SLICE_MS, so crossing the preview bound swaps to a ready set instead of
 * rendering one whole exact frame.
 */
const IDLE_MS = 200;
const SLICE_MS = 6;
// Out first: a set scaled down while zooming out leaves a bare border that the shallower set covers; zooming in only blurs.
const AHEAD_LEVELS = [-1, 1] as const;

/** What the prebuild needs to render the tile set `dz` levels from the current one (null: not possible there). */
export type AheadSource = (dz: number) => { cam: Camera; query: QueryVisible; draw: DrawObjects } | null;

/** Objects drawn into one tile, and whether any image in it was still loading. */
interface Tile {
  canvas: HTMLCanvasElement | null;
  ids: Set<ObjectId>;
  pending: boolean;
}

interface Generation {
  key: string;
  /** Zoom of this tile set (preview scaling is relative to it). */
  z: number;
  center: Camera["center"];
  /** Frame of `center` (ADR 0014). */
  frameId: number;
  vp: Viewport;
  tiles: Map<string, Tile>;
  /** The tiles that covered its own view when it was drawn (or that a prebuilt set is made of): what it can be trusted to show. */
  range?: { i0: number; i1: number; j0: number; j1: number };
  /** For a set built ahead of time: how to render its remaining tiles. */
  ahead?: { cam: Camera; query: QueryVisible; draw: DrawObjects };
}

export interface TileFrame {
  /** Tiles covering the viewport this frame. */
  tiles: number;
  /** Tiles rendered this frame (the rest were reused). */
  rendered: number;
  /** Objects found by the visibility query (0 when every tile was reused). */
  visible: number;
  /** True when this frame showed tiles scaled from another zoom (a zoom preview, refined later). */
  preview: boolean;
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
/** Draws the committed objects outside `hole` (CSS px of the viewport) directly, with the context's own transform. */
export type DrawBorder = (ctx: CanvasRenderingContext2D, hole: { l: number; t: number; r: number; b: number }) => void;

const MAX_POOL = 64;

export class TileCache {
  enabled = true;
  /** Tiles rendered since the page loaded (diagnostics and tests). */
  renderedTotal = 0;
  /** Cost of the last full tile-set build (about one exact frame of committed objects). */
  lastFullMs = 0;
  /** A rebuild slower than this makes the scene "dense": zoom frames show a scaled preview. */
  denseMs = DENSE_MS;
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  private refineNow = false;
  private gen: Generation | null = null;
  /** Prebuilt sets one zoom level in (+1) and out (-1) from `gen`. */
  private readonly ahead = new Map<number, Generation>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private aheadArgs: { source: AheadSource; vp: Viewport; dpr: number; reach: Reach } | null = null;
  /** Build the neighbouring zoom levels in idle time (turned off on the lower quality levels). */
  idleBuild = true;
  private lastKey = "";
  private readonly dirty = new Set<ObjectId>();
  private readonly pool: HTMLCanvasElement[] = [];

  constructor(
    private readonly getObject: (id: ObjectId) => CanvasObject | undefined,
    /** Schedules a redraw (used to refine a zoom preview once the zoom stops). */
    private readonly requestFrame: () => void = () => undefined,
  ) {}

  /** Drop everything (document replaced, theme changed). */
  clear(): void {
    if (this.gen) for (const t of this.gen.tiles.values()) this.release(t);
    this.gen = null;
    this.dropAhead();
    this.dirty.clear();
  }

  private dropAhead(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    for (const g of this.ahead.values()) for (const t of g.tiles.values()) this.release(t);
    this.ahead.clear();
  }

  /** Tiles held by the prebuilt sets (diagnostics and tests). */
  get aheadTiles(): number {
    let n = 0;
    for (const g of this.ahead.values()) n += g.tiles.size;
    return n;
  }

  /** Objects changed (null: the whole document was replaced). Their tiles re-render on the next frame. */
  invalidate(changed: ReadonlySet<ObjectId> | null): void {
    if (!changed) this.clear();
    else {
      this.dropAhead(); // an edit makes the prebuilt sets wrong
      if (this.gen) for (const id of changed) this.dirty.add(id);
    }
  }

  /** An image finished loading: re-render tiles that showed a placeholder. */
  dropPending(): void {
    this.dropAhead();
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
  /**
   * `cam` is the camera in the coordinates of frame `frameId` (ADR 0014); a
   * change of frame starts a new tile generation. `project` projects one
   * object with the camera in its own frame.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    frameId: number,
    vp: Viewport,
    dpr: number,
    query: QueryVisible,
    drawObjects: DrawObjects,
    reach: Reach,
    project: (o: CanvasObject, vp: Viewport) => ProjectedObject | null,
    ahead?: AheadSource,
    border?: DrawBorder,
  ): TileFrame | null {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const td = TILE_CSS * dpr;
    if (!this.enabled || !Number.isInteger(td) || !Number.isInteger(GUARD_CSS * dpr)) return null;
    const key = `${frameId}|${cam.zi}|${cam.zf}|${dpr}`;
    const stable = key === this.lastKey || this.refineNow;
    this.refineNow = false;
    this.lastKey = key;
    const z = cam.zi + cam.zf;
    const dense = this.lastFullMs > this.denseMs;
    if (this.gen && this.gen.key !== key) {
      // The preview scales the last tile set: only within the same frame.
      const preview = !stable && dense && this.gen.frameId === frameId;
      // Zooming out, the scaled set leaves a bare border: a prebuilt set that reaches every edge is shown instead.
      if (preview && !this.dirty.size && !this.covers(this.gen, cam, vp, dpr)) this.takeAhead(z, cam, vp, dpr);
      const pv = preview ? this.preview(ctx, cam, vp, dpr, border) : null;
      if (pv) return pv;
      // Beyond the bound: a prebuilt set within one level takes over (the old set becomes its neighbour).
      const next = preview && !this.dirty.size ? this.takeAhead(z, cam, vp, dpr) : null;
      if (next) {
        const pv2 = this.preview(ctx, cam, vp, dpr, border);
        if (pv2) return pv2;
      }
      this.clear();
    }
    if (!this.gen) {
      // Build tiles only once the zoom has held still for a frame; in a dense
      // scene build now (the zoom moved beyond the preview range).
      if (!stable && !dense) return null;
      this.gen = { key, z, center: cam.center, frameId, vp, tiles: new Map() };
    }
    let off = this.offset(this.gen, cam, vp, dpr);
    if (!off) {
      // Not a whole-device-pixel move: start over at this camera.
      this.clear();
      this.gen = { key, z, center: cam.center, frameId, vp, tiles: new Map() };
      off = { dx: 0, dy: 0 };
    }
    const g = this.gen!;
    const { dx, dy } = off;
    const m = TILE_CSS; // query margin: every tile touching the viewport lies within it
    const infl: Viewport = { width: vp.width + 2 * m, height: vp.height + 2 * m };
    const { i0, i1, j0, j1 } = this.range(dx, dy, vp, dpr);
    const gd = GUARD_CSS * dpr;
    g.range = { i0, i1, j0, j1 };

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
        const po = o && project(o, infl);
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
    const buildStart = performance.now();
    this.renderedTotal += missing.length;
    const visible = missing.length ? this.buildTiles(g, missing, dx, dy, vp, dpr, query, drawObjects, reach, Infinity).visible : 0;

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
    if (missing.length === needed.length && needed.length) this.lastFullMs = performance.now() - buildStart;
    if (ahead && this.idleBuild && this.lastFullMs > this.denseMs && !this.refineTimer) {
      this.aheadArgs = { source: ahead, vp, dpr, reach };
      this.idleTimer = setTimeout(() => this.stepAhead(), IDLE_MS);
    }
    return { tiles: needed.length, rendered: missing.length, visible, preview: false };
  }

  /** The tile range of a set seen from a camera offset by (dx, dy) device px. */
  private range(dx: number, dy: number, vp: Viewport, dpr: number): { i0: number; i1: number; j0: number; j1: number } {
    const td = TILE_CSS * dpr;
    return {
      i0: Math.floor(-dx / td),
      i1: Math.floor((Math.ceil(vp.width * dpr) - 1 - dx) / td),
      j0: Math.floor(-dy / td),
      j1: Math.floor((Math.ceil(vp.height * dpr) - 1 - dy) / td),
    };
  }

  /**
   * Render the `missing` tiles of `g` (seen from a camera offset by dx, dy device px), stopping after `budgetMs`
   * once at least one is done. Returns how many were built and how many objects the query found.
   */
  private buildTiles(
    g: Generation,
    missing: ReadonlyArray<[number, number]>,
    dx: number,
    dy: number,
    vp: Viewport,
    dpr: number,
    query: QueryVisible,
    drawObjects: DrawObjects,
    reach: Reach,
    budgetMs: number,
  ): { built: number; visible: number } {
    const td = TILE_CSS * dpr;
    const gd = GUARD_CSS * dpr; // guard in device px (an integer whenever td is)
    const m = TILE_CSS; // query margin: every tile touching the viewport lies within it
    const infl: Viewport = { width: vp.width + 2 * m, height: vp.height + 2 * m };
    const start = performance.now();
    const list = query(infl);
    let built = 0;
    for (const [i, j] of missing) {
      if (built && performance.now() - start > budgetMs) break;
      built++;
      // Rendered tile rect (with guard) in the inflated viewport's CSS coordinates.
      const l = (i * td + dx) / dpr + m - GUARD_CSS;
      const t = (j * td + dy) / dpr + m - GUARD_CSS;
      const r = { l, t, r: l + TILE_CSS + 2 * GUARD_CSS, b: t + TILE_CSS + 2 * GUARD_CSS };
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
    return { built, visible: list.length };
  }

  /** One idle slice: build some tiles of the next prebuilt set, and schedule the next slice while any remain. */
  private stepAhead(): void {
    this.idleTimer = null;
    const a = this.aheadArgs;
    const cur = this.gen;
    if (!a || !cur || this.dirty.size || !this.idleBuild) return;
    for (const dz of AHEAD_LEVELS) {
      let g = this.ahead.get(dz);
      if (!g) {
        const made = a.source(dz);
        if (!made) continue;
        // One query for the whole set, not one per slice (its camera and viewport are fixed, and an edit drops the set).
        let found: ProjectedObject[] | null = null;
        const src = { ...made, query: (v: Viewport) => (found ??= made.query(v)) };
        g = {
          key: `${cur.frameId}|${src.cam.zi}|${src.cam.zf}|${a.dpr}`,
          z: src.cam.zi + src.cam.zf,
          center: src.cam.center,
          frameId: cur.frameId,
          vp: a.vp,
          tiles: new Map(),
          range: this.range(0, 0, a.vp, a.dpr),
          ahead: src,
        };
        this.ahead.set(dz, g);
      }
      const { i0, i1, j0, j1 } = this.range(0, 0, a.vp, a.dpr);
      const missing: Array<[number, number]> = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!g.tiles.has(`${i},${j}`)) missing.push([i, j]);
      if (!missing.length) continue;
      const src = g.ahead!;
      this.buildTiles(g, missing, 0, 0, a.vp, a.dpr, src.query, src.draw, a.reach, SLICE_MS);
      this.idleTimer = setTimeout(() => this.stepAhead(), 0);
      return;
    }
  }

  /** Make the prebuilt set within one level of zoom `z` that covers the view the current set; the old one becomes its neighbour. */
  private takeAhead(z: number, cam: Camera, vp: Viewport, dpr: number): Generation | null {
    const old = this.gen!;
    for (const dz of AHEAD_LEVELS) {
      const g = this.ahead.get(dz);
      if (!g || !g.tiles.size || Math.abs(g.z - z) > PREVIEW_MAX_LEVELS) continue;
      // A set deeper than the camera is scaled down and leaves a border of bare background (zooming in): take the other one.
      if (!this.covers(g, cam, vp, dpr)) continue;
      this.ahead.delete(dz);
      this.dropAhead();
      delete g.ahead;
      this.gen = g;
      this.ahead.set(-dz, old);
      return g;
    }
    return null;
  }

  /** Whether the tiles of `g`, scaled to this camera, reach every edge of the viewport. */
  private covers(g: Generation, cam: Camera, vp: Viewport, dpr: number): boolean {
    const e = this.extent(g, cam, vp, dpr);
    const slack = 1;
    return !!e && e.l <= slack && e.t <= slack && e.r >= vp.width * dpr - slack && e.b >= vp.height * dpr - slack;
  }

  /** Where the tiles of `g`, scaled to this camera, reach on the screen (device px; null when not a finite place). */
  private extent(g: Generation, cam: Camera, vp: Viewport, dpr: number): { l: number; t: number; r: number; b: number } | null {
    const dz = cam.zi + cam.zf - g.z;
    const s = 2 ** dz;
    const f = 2 ** cam.zf;
    const ox = (vp.width / 2 + D.diffToNumber(g.center.x, cam.center.x, cam.zi) * f) * dpr - (g.vp.width / 2) * dpr * s;
    const oy = (vp.height / 2 + D.diffToNumber(g.center.y, cam.center.y, cam.zi) * f) * dpr - (g.vp.height / 2) * dpr * s;
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !g.range) return null;
    // Only a whole range counts (a prebuilt set still being made, or tiles kept from panning, leave holes in their box).
    const { i0, i1, j0, j1 } = g.range;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!g.tiles.has(`${i},${j}`)) return null;
    const td = TILE_CSS * dpr * s;
    return { l: ox + i0 * td, t: oy + j0 * td, r: ox + (i1 + 1) * td, b: oy + (j1 + 1) * td };
  }

  /**
   * Draw the current tile set scaled to this camera's zoom, if allowed: same
   * DPR, no pending edits, and within PREVIEW_MAX_LEVELS. Schedules an exact
   * refinement for when the zoom stops. Areas the set never covered (the
   * border after zooming out with no prebuilt set to take over) are drawn
   * directly by `border`, so the view is never cut off.
   */
  private preview(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, border?: DrawBorder): TileFrame | null {
    const g = this.gen!;
    const dz = cam.zi + cam.zf - g.z;
    if (this.dirty.size || !g.key.endsWith(`|${dpr}`) || Math.abs(dz) > PREVIEW_MAX_LEVELS || !g.tiles.size) return null;
    const s = 2 ** dz;
    const f = 2 ** cam.zf;
    // Device position of the set's reference point (its viewport's top-left) under this camera.
    const ox = (vp.width / 2 + D.diffToNumber(g.center.x, cam.center.x, cam.zi) * f) * dpr - (g.vp.width / 2) * dpr * s;
    const oy = (vp.height / 2 + D.diffToNumber(g.center.y, cam.center.y, cam.zi) * f) * dpr - (g.vp.height / 2) * dpr * s;
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
    const td = TILE_CSS * dpr;
    const gd = GUARD_CSS * dpr;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    let n = 0;
    for (const [k, t] of g.tiles) {
      if (!t.canvas) continue;
      const [i, j] = k.split(",").map(Number) as [number, number];
      // Tiles are positioned in the set's frame (at its own camera, tile i starts at i·td).
      // Whole device pixels, shared by neighbours (rounded outwards), so scaling leaves no hairline seams between tiles.
      const x0 = Math.floor(ox + i * td * s);
      const y0 = Math.floor(oy + j * td * s);
      ctx.drawImage(t.canvas, gd, gd, td, td, x0, y0, Math.ceil(ox + (i + 1) * td * s) - x0, Math.ceil(oy + (j + 1) * td * s) - y0);
      n++;
    }
    ctx.restore();
    if (border && !this.covers(g, cam, vp, dpr)) {
      const e = this.extent(g, cam, vp, dpr);
      // (empty tiles are not drawn, but their place is covered: nothing of them was there)
      border(ctx, e ? { l: e.l / dpr, t: e.t / dpr, r: e.r / dpr, b: e.b / dpr } : { l: 0, t: 0, r: 0, b: 0 });
    }
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = setTimeout(() => {
      this.refineTimer = null;
      this.refineNow = true; // the next frame counts as stable and is rendered exactly
      this.requestFrame();
    }, REFINE_MS);
    return { tiles: n, rendered: 0, visible: 0, preview: true };
  }

  /**
   * Device-pixel offset of the current view from the generation's, or null
   * if it is not a whole number of device pixels (or is enormous).
   */
  private offset(g: Generation, cam: Camera, vp: Viewport, dpr: number): { dx: number; dy: number } | null {
    const f = 2 ** cam.zf;
    const ax = (D.diffToNumber(g.center.x, cam.center.x, cam.zi) * f + (vp.width - g.vp.width) / 2) * dpr;
    const ay = (D.diffToNumber(g.center.y, cam.center.y, cam.zi) * f + (vp.height - g.vp.height) / 2) * dpr;
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
