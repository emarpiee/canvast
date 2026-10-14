import * as D from "../core/dyadic";
import type { Camera, Viewport } from "../core/camera";
import { screenToWorld } from "../core/camera";
import type { CanvasObject, ObjectId } from "../doc/model";
import type { DocumentStore } from "../doc/document-store";
import { localBounds } from "../doc/model";

/**
 * Multi-scale spatial index over exact world coordinates.
 *
 * Every object is filed at one **level** L: the smallest power of two that
 * is at least its world-space size (so it spans at most 2×2 cells there), in
 * the **cell** (ix, iy) = (⌊minX / 2^L⌋, ⌊minY / 2^L⌋), with BigInt indices.
 * There is no root, world bound, or depth limit: levels are a sparse map, and
 * cells at a level are a sparse hash map, so objects 2^5000 apart or 2^5000
 * times different in size cost nothing extra.
 *
 * A viewport query visits each populated level whose cells are at least
 * MIN_CELL_PX on screen. Through a 2^COARSE_SHIFT-coarser summary of occupied
 * cells it expands only coarse cells that exist near the view, then either
 * enumerates fine cells or walks the occupied ones, whichever is fewer. Cost
 * is O(levels + probed cells + candidates), independent of how many objects
 * are off-screen.
 *
 * The index stores candidates only; the exact per-object projection and hit
 * tests remain authoritative.
 */

/**
 * Levels whose cells are smaller than this on screen are skipped (LOD) and
 * shown by the density preview instead. Projection uses the same level rule
 * (projection.ts tooSmallToDraw), so every object is either drawn
 * individually or in the preview.
 */
export const MIN_CELL_PX = 0.125;
const COARSE_SHIFT = 8n;
/** Mid-size ink summaries: 2^MID_SHIFT cells per side (between a cell and a coarse cell). */
const MID_SHIFT = 4n;

/**
 * Ink summary of a region, for the density preview of content too small to
 * draw object by object: `a` is the covered area (opacity-weighted) in units
 * of the region's own area (1 = fully covered, may exceed 1 where objects
 * overlap); r, g, b are colour channels summed with weight `a`.
 */
export interface Ink {
  a: number;
  r: number;
  g: number;
  b: number;
}

interface InkCell {
  readonly ix: bigint;
  readonly iy: bigint;
  readonly ink: Ink;
  count: number;
}

/** Colour of image instances in the density preview (originals are not decoded for it). */
const IMAGE_INK_RGB: readonly [number, number, number] = [138, 138, 138];

/** Ink of a text character, as a fraction of em² (a typical glyph covers about this much). */
const TEXT_INK_PER_CHAR = 0.3;

/**
 * Covered area of an object in local units² (opacity-weighted) and its
 * colour. Strokes: polyline length × width plus the round caps.
 */
function objectInk(o: CanvasObject): { area: number; rgb: readonly [number, number, number] } {
  if (o.kind === "image") return { area: o.w * o.h * o.opacity, rgb: IMAGE_INK_RGB };
  const c = parseInt(o.color.slice(1), 16);
  const rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const;
  if (o.kind === "text") return { area: o.md.replace(/\s/g, "").length * o.size * o.size * TEXT_INK_PER_CHAR * o.opacity, rgb };
  const p = o.points;
  let len = 0;
  for (let i = 2; i + 1 < p.length; i += 2) len += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  return { area: (len * o.width + (Math.PI * o.width * o.width) / 4) * o.opacity, rgb };
}

function addInk(t: Ink, area: number, rgb: readonly [number, number, number], sign: 1 | -1): void {
  const a = sign * area;
  t.a += a;
  t.r += a * rgb[0];
  t.g += a * rgb[1];
  t.b += a * rgb[2];
  if (t.a < 1e-12) t.a = t.r = t.g = t.b = 0; // remove float residue once empty
}

/** A density-preview square: screen top-left (CSS px), side, coverage and colour. */
export interface DensityCell {
  x: number;
  y: number;
  size: number;
  /** Covered fraction of the square (may exceed 1 where objects overlap). */
  cover: number;
  r: number;
  g: number;
  b: number;
}

export interface IndexEntry {
  readonly obj: CanvasObject;
  readonly cell: IndexCell;
  /** Anchor position inside the cell, in cell units (double; |ax| ≲ 2). */
  readonly ax: number;
  readonly ay: number;
  /** Local units per cell unit: 2^(unit − L). */
  readonly scale: number;
  /** Covered area in this cell's units², and colour (for the density preview). */
  readonly inkArea: number;
  readonly inkRgb: readonly [number, number, number];
}

export interface IndexCell {
  readonly level: number;
  readonly ix: bigint;
  readonly iy: bigint;
  readonly key: string;
  readonly coarseKey: string;
  readonly midKey: string;
  readonly entries: IndexEntry[];
  readonly ink: Ink;
}

interface CoarseCell {
  readonly cx: bigint;
  readonly cy: bigint;
  readonly cells: Set<IndexCell>;
  readonly ink: Ink;
}

interface LevelGrid {
  readonly level: number;
  readonly cells: Map<string, IndexCell>;
  readonly coarse: Map<string, CoarseCell>;
  readonly mid: Map<string, InkCell>;
  /**
   * Conservative bounding range of occupied cell indices (grown on insert,
   * not shrunk on remove). A level whose range misses the viewport is skipped
   * with four comparisons, which keeps queries cheap when most levels hold
   * far-away clusters.
   */
  minIx: bigint;
  maxIx: bigint;
  minIy: bigint;
  maxIy: bigint;
}

export interface IndexQuery {
  /** Cells that may hold visible objects, with their level. */
  readonly cells: IndexCell[];
  readonly levelsVisited: number;
  readonly levelsSkippedSubPixel: number;
  readonly cellsProbed: number;
  readonly candidates: number;
}

function cellKey(ix: bigint, iy: bigint): string {
  return `${ix}|${iy}`;
}

/** Smallest L with object size ≤ 2^L world units. */
export function objectLevel(o: CanvasObject): number {
  const b = localBounds(o);
  const ext = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  let k = Math.ceil(Math.log2(ext));
  if (2 ** k < ext) k++; // guard against log2 rounding just below an integer
  return o.unit + k;
}

export class SpatialIndex {
  private readonly levels = new Map<number, LevelGrid>();
  private readonly byId = new Map<ObjectId, IndexEntry>();
  /** Ink of all objects, in index units² (for a frame seen from far above as one dot, ADR 0014). */
  readonly total: Ink = { a: 0, r: 0, g: 0, b: 0 };
  /** Ink-weighted sums of object anchors (index units): the dot sits at their centroid. */
  private inkX = 0;
  private inkY = 0;

  /** Ink-weighted centre of all objects, in index units (approximate: for a dot below a pixel). */
  get inkCentre(): { x: number; y: number } {
    return this.total.a > 0 ? { x: this.inkX / this.total.a, y: this.inkY / this.total.a } : { x: 0, y: 0 };
  }

  get size(): number {
    return this.byId.size;
  }

  get levelCount(): number {
    return this.levels.size;
  }

  clear(): void {
    this.levels.clear();
    this.byId.clear();
    this.total.a = this.total.r = this.total.g = this.total.b = 0;
    this.inkX = this.inkY = 0;
  }

  rebuild(objects: Iterable<CanvasObject>): void {
    this.clear();
    for (const o of objects) this.insert(o);
  }

  insert(o: CanvasObject): void {
    if (this.byId.has(o.id)) this.remove(o.id);
    const level = objectLevel(o);
    const b = localBounds(o);
    const minX = D.add(o.anchor.x, D.shift(D.fromNumber(b.minX), o.unit));
    const minY = D.add(o.anchor.y, D.shift(D.fromNumber(b.minY), o.unit));
    const ix = D.floorDivPow2(minX, level);
    const iy = D.floorDivPow2(minY, level);
    let grid = this.levels.get(level);
    if (!grid) {
      grid = { level, cells: new Map(), coarse: new Map(), mid: new Map(), minIx: ix, maxIx: ix, minIy: iy, maxIy: iy };
      this.levels.set(level, grid);
    } else {
      if (ix < grid.minIx) grid.minIx = ix;
      if (ix > grid.maxIx) grid.maxIx = ix;
      if (iy < grid.minIy) grid.minIy = iy;
      if (iy > grid.maxIy) grid.maxIy = iy;
    }
    const key = cellKey(ix, iy);
    let cell = grid.cells.get(key);
    if (!cell) {
      const coarseKey = cellKey(ix >> COARSE_SHIFT, iy >> COARSE_SHIFT);
      const midKey = cellKey(ix >> MID_SHIFT, iy >> MID_SHIFT);
      cell = { level, ix, iy, key, coarseKey, midKey, entries: [], ink: { a: 0, r: 0, g: 0, b: 0 } };
      grid.cells.set(key, cell);
      let coarse = grid.coarse.get(coarseKey);
      if (!coarse) {
        coarse = { cx: ix >> COARSE_SHIFT, cy: iy >> COARSE_SHIFT, cells: new Set(), ink: { a: 0, r: 0, g: 0, b: 0 } };
        grid.coarse.set(coarseKey, coarse);
      }
      coarse.cells.add(cell);
    }
    const scale = 2 ** (o.unit - level);
    const ink = objectInk(o);
    const entry: IndexEntry = {
      obj: o,
      cell,
      ax: D.toNumber(D.shift(D.sub(o.anchor.x, D.fromBigInt(ix, level)), -level)),
      ay: D.toNumber(D.shift(D.sub(o.anchor.y, D.fromBigInt(iy, level)), -level)),
      scale,
      inkArea: ink.area * scale * scale,
      inkRgb: ink.rgb,
    };
    cell.entries.push(entry);
    this.byId.set(o.id, entry);
    this.updateInk(grid, cell, entry, 1);
  }

  /** Add (+1) or remove (−1) an entry's ink in its cell, mid cell and coarse cell. */
  private updateInk(grid: LevelGrid, cell: IndexCell, e: IndexEntry, sign: 1 | -1): void {
    addInk(cell.ink, e.inkArea, e.inkRgb, sign);
    const area = e.inkArea * 4 ** cell.level;
    addInk(this.total, area, e.inkRgb, sign);
    this.inkX += sign * area * (Number(cell.ix) + e.ax) * 2 ** cell.level;
    this.inkY += sign * area * (Number(cell.iy) + e.ay) * 2 ** cell.level;
    if (this.total.a === 0) this.inkX = this.inkY = 0;
    let mid = grid.mid.get(cell.midKey);
    if (!mid) grid.mid.set(cell.midKey, (mid = { ix: cell.ix >> MID_SHIFT, iy: cell.iy >> MID_SHIFT, ink: { a: 0, r: 0, g: 0, b: 0 }, count: 0 }));
    addInk(mid.ink, e.inkArea / 2 ** Number(2n * MID_SHIFT), e.inkRgb, sign);
    mid.count += sign;
    if (mid.count === 0) grid.mid.delete(cell.midKey);
    const coarse = grid.coarse.get(cell.coarseKey);
    if (coarse) addInk(coarse.ink, e.inkArea / 2 ** Number(2n * COARSE_SHIFT), e.inkRgb, sign);
  }

  remove(id: ObjectId): void {
    const e = this.byId.get(id);
    if (!e) return;
    this.byId.delete(id);
    const cell = e.cell;
    this.updateInk(this.levels.get(cell.level)!, cell, e, -1);
    const i = cell.entries.indexOf(e);
    if (i >= 0) {
      cell.entries[i] = cell.entries[cell.entries.length - 1]!;
      cell.entries.pop();
    }
    if (cell.entries.length === 0) {
      const grid = this.levels.get(cell.level)!;
      grid.cells.delete(cell.key);
      const coarse = grid.coarse.get(cell.coarseKey)!;
      coarse.cells.delete(cell);
      if (coarse.cells.size === 0) grid.coarse.delete(cell.coarseKey);
      if (grid.cells.size === 0) this.levels.delete(cell.level);
    }
  }

  get(id: ObjectId): IndexEntry | undefined {
    return this.byId.get(id);
  }

  /** True if any populated level is too small to draw individually at this zoom (cheap: no BigInt work). */
  hasSubPixelLevels(cam: Camera): boolean {
    const z = cam.zi + cam.zf;
    for (const L of this.levels.keys()) if (2 ** (L + z) < MIN_CELL_PX) return true;
    return false;
  }

  /** See densityQuery. */
  density(cam: Camera, vp: Viewport, marginPx: number): DensityQuery {
    const out: DensityCell[] = [];
    let visited = 0;
    const z = cam.zi + cam.zf;
    const f = 2 ** cam.zf;
    const w0 = screenToWorld(cam, vp, { x: -marginPx, y: -marginPx });
    const w1 = screenToWorld(cam, vp, { x: vp.width + marginPx, y: vp.height + marginPx });
    for (const grid of this.levels.values()) {
      const L = grid.level;
      const cellPx = 2 ** (L + z);
      if (cellPx >= MIN_CELL_PX) continue; // drawn object by object
      const shift = cellPx * 2 ** Number(COARSE_SHIFT) <= DENSITY_MAX_PX ? COARSE_SHIFT : cellPx * 2 ** Number(MID_SHIFT) <= DENSITY_MAX_PX ? MID_SHIFT : 0n;
      const G = L + Number(shift);
      // Objects can reach one cell beyond the cell they are filed in.
      const x0 = D.floorDivPow2(w0.x, G) - 1n;
      const y0 = D.floorDivPow2(w0.y, G) - 1n;
      const x1 = D.floorDivPow2(w1.x, G);
      const y1 = D.floorDivPow2(w1.y, G);
      if (x1 < grid.minIx >> shift || x0 > grid.maxIx >> shift || y1 < grid.minIy >> shift || y0 > grid.maxIy >> shift) continue;
      // Exact screen position of the summary cell (x0, y0); others are whole steps from it.
      const size = 2 ** (G + z);
      const ox = vp.width / 2 + D.toNumber(D.shift(D.sub(D.fromBigInt(x0, G), cam.center.x), cam.zi)) * f;
      const oy = vp.height / 2 + D.toNumber(D.shift(D.sub(D.fromBigInt(y0, G), cam.center.y), cam.zi)) * f;
      const emit = (ix: bigint, iy: bigint, ink: Ink): void => {
        visited++;
        if (ix < x0 || ix > x1 || iy < y0 || iy > y1 || ink.a <= 0) return;
        out.push({ x: ox + Number(ix - x0) * size, y: oy + Number(iy - y0) * size, size, cover: ink.a, r: ink.r / ink.a, g: ink.g / ink.a, b: ink.b / ink.a });
      };
      if (shift === COARSE_SHIFT) for (const c of grid.coarse.values()) emit(c.cx, c.cy, c.ink);
      else if (shift === MID_SHIFT) for (const c of grid.mid.values()) emit(c.ix, c.iy, c.ink);
      else for (const c of grid.cells.values()) emit(c.ix, c.iy, c.ink);
    }
    return { cells: out, visited };
  }

  /** Cells that may contain objects visible in the viewport grown by `marginPx`. */
  query(cam: Camera, vp: Viewport, marginPx = 8): IndexQuery {
    const w0 = screenToWorld(cam, vp, { x: -marginPx, y: -marginPx });
    const w1 = screenToWorld(cam, vp, { x: vp.width + marginPx, y: vp.height + marginPx });
    const z = cam.zi + cam.zf;
    const cells: IndexCell[] = [];
    let levelsVisited = 0;
    let levelsSkippedSubPixel = 0;
    let cellsProbed = 0;
    let candidates = 0;
    for (const grid of this.levels.values()) {
      const L = grid.level;
      if (2 ** (L + z) < MIN_CELL_PX) {
        levelsSkippedSubPixel++;
        continue;
      }
      // An object filed at (ix, iy) can extend into (ix + 1, iy + 1), so the
      // lower bound is widened by one cell; then clamp to the occupied range.
      let x0 = D.floorDivPow2(w0.x, L) - 1n;
      let y0 = D.floorDivPow2(w0.y, L) - 1n;
      let x1 = D.floorDivPow2(w1.x, L);
      let y1 = D.floorDivPow2(w1.y, L);
      if (x1 < grid.minIx || x0 > grid.maxIx || y1 < grid.minIy || y0 > grid.maxIy) continue;
      if (x0 < grid.minIx) x0 = grid.minIx;
      if (x1 > grid.maxIx) x1 = grid.maxIx;
      if (y0 < grid.minIy) y0 = grid.minIy;
      if (y1 > grid.maxIy) y1 = grid.maxIy;
      levelsVisited++;
      // Coarse-first: only coarse cells that exist are expanded, so levels
      // with nothing near the view cost a few lookups. Inside an occupied
      // coarse cell, enumerate the fine cells in range or walk the occupied
      // set, whichever is smaller.
      const take = (cell: IndexCell | undefined): void => {
        cellsProbed++;
        if (cell && cell.ix >= x0 && cell.ix <= x1 && cell.iy >= y0 && cell.iy <= y1) {
          cells.push(cell);
          candidates += cell.entries.length;
        }
      };
      const cx0 = x0 >> COARSE_SHIFT;
      const cy0 = y0 >> COARSE_SHIFT;
      const cx1 = x1 >> COARSE_SHIFT;
      const cy1 = y1 >> COARSE_SHIFT;
      const nCoarse = (cx1 - cx0 + 1n) * (cy1 - cy0 + 1n);
      const span = 1n << COARSE_SHIFT;
      const expand = (c: CoarseCell): void => {
        const fx0 = x0 > c.cx * span ? x0 : c.cx * span;
        const fx1 = x1 < c.cx * span + span - 1n ? x1 : c.cx * span + span - 1n;
        const fy0 = y0 > c.cy * span ? y0 : c.cy * span;
        const fy1 = y1 < c.cy * span + span - 1n ? y1 : c.cy * span + span - 1n;
        const nFine = (fx1 - fx0 + 1n) * (fy1 - fy0 + 1n);
        if (nFine <= BigInt(c.cells.size)) {
          for (let ix = fx0; ix <= fx1; ix++) for (let iy = fy0; iy <= fy1; iy++) take(grid.cells.get(cellKey(ix, iy)));
        } else {
          for (const cell of c.cells) take(cell);
        }
      };
      if (nCoarse > BigInt(grid.coarse.size)) {
        // More coarse cells in view than occupied ones: filter the occupied ones.
        for (const c of grid.coarse.values()) {
          cellsProbed++;
          if (c.cx >= cx0 && c.cx <= cx1 && c.cy >= cy0 && c.cy <= cy1) expand(c);
        }
        continue;
      }
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          cellsProbed++;
          const c = grid.coarse.get(cellKey(cx, cy));
          if (c) expand(c);
        }
      }
    }
    return { cells, levelsVisited, levelsSkippedSubPixel, cellsProbed, candidates };
  }
}

export interface DensityQuery {
  cells: DensityCell[];
  /** Summary cells visited (all granularities). */
  visited: number;
}

/**
 * Density preview for content too small to draw individually: for every
 * level the viewport query skips (cells under MIN_CELL_PX), squares of the
 * coarsest summary granularity (cell, mid or coarse) that is at most
 * DENSITY_MAX_PX on screen, with their covered fraction and mean colour.
 * Cost is the number of occupied summary cells, not the number of objects.
 */
export const DENSITY_MAX_PX = 2;

export function densityQuery(index: SpatialIndex, cam: Camera, vp: Viewport, marginPx = 8): DensityQuery {
  return index.density(cam, vp, marginPx);
}

/** Keep an index in sync with a document: incremental on transactions, full rebuild on load. */
export function syncIndex(doc: DocumentStore, index: Pick<SpatialIndex, "rebuild" | "remove" | "insert">): () => void {
  index.rebuild(doc.all());
  return doc.subscribe((_source, changed) => {
    if (!changed) {
      index.rebuild(doc.all());
      return;
    }
    for (const id of changed) {
      index.remove(id);
      const o = doc.get(id);
      if (o) index.insert(o);
    }
  });
}
