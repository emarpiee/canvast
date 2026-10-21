/**
 * The Painting view's document (ADR 0165): paintings, their pages and the pages' layers, as plain records. Nothing here knows the
 * canvas: positions and sizes are the page's pixels, a page has a size (not a shape), and there is no endless zoom.
 *
 * - A **painting** has a name and an ordered list of pages (stored in the painting's record).
 * - A **page** has a size in px, a resolution (DPI, for physical units), and a background (a colour or none).
 * - A **layer** is a record of its own (one per layer, so a stroke writes one small record): its page, its place in the stack (`z`),
 *   the common layer fields (opacity, blend, hidden, locked, clipped to the layer below) and its kind's own fields. A raster layer's
 *   pixels are 256 px tiles named by the hash of their pixels (`tiles`), stored once each (store.ts).
 */
import { BLEND_MODES, storedAssetOf, type BlendMode, type SerializedObject } from "../doc/model";
import { isPaint, type Paint } from "../doc/paint";
import { validAdjust, type Adjust } from "../doc/adjust";
import { validObjects } from "./objects";

export { TILE, tileKey, tileOf } from "./tiles";
/** Largest page side in px: 8192 × 8192 is 256 MB decoded per layer. */
export const MAX_PAGE_PX = 8192;
export const MAX_NAME = 80;

export interface Page {
  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly dpi: number;
  /** "#rrggbb", or null for a transparent page. */
  readonly bg: string | null;
}

export interface Painting {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly pages: readonly Page[];
  readonly created: number;
  readonly modified: number;
}

/** The fields every layer has, whatever its kind. */
interface LayerBase {
  readonly paintingId: string;
  readonly id: string;
  readonly pageId: string;
  /** Stacking order on its page: larger is above. */
  readonly z: number;
  readonly name: string;
  readonly opacity: number;
  /** Absent: normal. */
  readonly blend?: BlendMode;
  readonly hidden?: true;
  /** Cannot be painted or changed. */
  readonly locked?: true;
  /** Shown only where the nearest layer below it that is not clipped itself has paint (a clipping mask). */
  readonly clipBelow?: true;
}

export interface RasterLayer extends LayerBase {
  readonly kind: "raster";
  /** Painting keeps the layer's transparency: only what has paint is coloured. */
  readonly alphaLock?: true;
  /** Tile key "tx,ty" → the hash of its pixels; a tile not listed is empty. */
  readonly tiles: Readonly<Record<string, string>>;
}

/**
 * Canvas objects on the page (ADR 0166): shapes, paths, texts, pictures, what was pasted from the canvas, a pattern. A page px is a world
 * unit of the canvas at zoom 0, so they are the canvas's own objects, stored as the canvas stores them and drawn by its renderer.
 */
export interface ObjectLayer extends LayerBase {
  readonly kind: "object";
  readonly objs: readonly SerializedObject[];
  /** A pattern (the generator, its seed and settings), so a new seed makes it again. */
  readonly gen?: { readonly id: string; readonly seed: number; readonly v: Readonly<Record<string, number | string | boolean>> };
}

/** The page covered by a paint: a colour, a gradient or a texture. */
export interface FillLayer extends LayerBase {
  readonly kind: "fill";
  readonly paint: Paint;
}

/** An adjustment of everything below it on the page (exposure, colour, levels, curves, ... as the canvas's Adjust panel has them). */
export interface AdjustLayer extends LayerBase {
  readonly kind: "adjust";
  readonly adjust: Adjust;
}

export type Layer = RasterLayer | ObjectLayer | FillLayer | AdjustLayer;
export type LayerKind = Layer["kind"];
/** A layer's own fields, as a new one is made (its painting, id, page and place come from where it goes). */
export type LayerFields = { [K in LayerKind]: Omit<Extract<Layer, { kind: K }>, keyof LayerBase> & Partial<Pick<LayerBase, "opacity" | "blend">> }[LayerKind];

const NO_TILES: Readonly<Record<string, string>> = Object.freeze({});
/** A layer's tiles (only a paint layer has pixels of its own). */
export const tilesOf = (l: Layer): Readonly<Record<string, string>> => (l.kind === "raster" ? l.tiles : NO_TILES);

/** The library assets a layer uses (pictures, fonts, textures): kept by the library's GC while a layer names them. */
export function assetsOf(l: Layer): string[] {
  if (l.kind === "object") return l.objs.flatMap((o) => storedAssetOf(o) ?? []);
  if (l.kind === "fill") return [storedAssetOf({ kind: "path", fill: l.paint }) ?? []].flat();
  return [];
}

/**
 * Every layer kind's own part: what it is called, its icon (a key of ICONS), its fields checked, and how a new one is made. A kind without
 * an entry does not compile.
 */
export const LAYER_KINDS: { readonly [K in LayerKind]: { readonly label: string; readonly icon: string; valid(l: Extract<Layer, { kind: K }>): boolean; fresh(base: Omit<LayerBase, "name">): Extract<Layer, { kind: K }> } } = {
  raster: {
    label: "Paint layer",
    icon: "paintbrush",
    valid: (o) => (o.alphaLock === undefined || o.alphaLock === true) && typeof o.tiles === "object" && o.tiles !== null && Object.entries(o.tiles).every(([k, h]) => KEY.test(k) && typeof h === "string" && HASH.test(h)),
    fresh: (b) => ({ ...b, name: "", kind: "raster", tiles: {} }),
  },
  object: { label: "Shape layer", icon: "shapeTool", valid: (o) => validObjects(o.objs), fresh: (b) => ({ ...b, name: "", kind: "object", objs: [] }) },
  fill: { label: "Fill layer", icon: "fillLayer", valid: (o) => isPaint(o.paint, true), fresh: (b) => ({ ...b, name: "", kind: "fill", paint: "#ffffff" }) },
  adjust: { label: "Adjustment layer", icon: "slidersVertical", valid: (o) => validAdjust(o.adjust), fresh: (b) => ({ ...b, name: "", kind: "adjust", adjust: {} }) },
};

export const newId = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

const HEX = /^#[0-9a-f]{6}$/i;
const HASH = /^[0-9a-f]{64}$/;
const KEY = /^-?\d+,-?\d+$/;
const isName = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_NAME;
const isSide = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_PAGE_PX;

export function validPage(p: unknown): p is Page {
  const o = p as Page;
  return !!o && typeof o.id === "string" && isName(o.name) && isSide(o.w) && isSide(o.h) && Number.isFinite(o.dpi) && o.dpi >= 1 && o.dpi <= 10000 && (o.bg === null || (typeof o.bg === "string" && HEX.test(o.bg)));
}

export function validPainting(p: unknown): p is Painting {
  const o = p as Painting;
  return !!o && typeof o.id === "string" && typeof o.workspaceId === "string" && isName(o.name) && Array.isArray(o.pages) && o.pages.length >= 1 && o.pages.every(validPage) && Number.isFinite(o.created) && Number.isFinite(o.modified);
}

export function validLayer(l: unknown): l is Layer {
  const o = l as RasterLayer;
  if (!o || typeof o.id !== "string" || typeof o.paintingId !== "string" || typeof o.pageId !== "string" || !Number.isFinite(o.z) || !isName(o.name)) return false;
  if (!(Number.isFinite(o.opacity) && o.opacity >= 0 && o.opacity <= 1)) return false;
  if (o.blend !== undefined && !(BLEND_MODES as readonly string[]).includes(o.blend)) return false;
  for (const f of ["hidden", "locked", "clipBelow"] as const) if (o[f] !== undefined && o[f] !== true) return false;
  const kind = (LAYER_KINDS as Record<string, { valid(l: unknown): boolean } | undefined>)[o.kind];
  return !!kind && kind.valid(o);
}

/** A new page with sensible defaults (1920 × 1080 px, 72 DPI, white). */
export function newPage(o: Partial<Omit<Page, "id">> = {}): Page {
  return { id: newId(), name: o.name ?? "Page 1", w: o.w ?? 1920, h: o.h ?? 1080, dpi: o.dpi ?? 72, bg: o.bg === undefined ? "#ffffff" : o.bg };
}

/** Layers of a page, bottom first. */
export const stackOf = (layers: Iterable<Layer>, pageId: string): Layer[] => [...layers].filter((l) => l.pageId === pageId).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));

/**
 * What a clipped layer is cut by: the nearest layer under it that is not clipped itself (so several clipped layers in a row share one
 * base). Undefined: nothing under it, and then it is not cut. `stack` is bottom first.
 */
export function clipBaseOf(stack: readonly Layer[], i: number): Layer | undefined {
  for (let j = i - 1; j >= 0; j--) if (!stack[j]!.clipBelow) return stack[j];
  return undefined;
}

/** "Name n" with n one more than the highest such name in `names`. */
export function nextName(stem: string, names: Iterable<string>): string {
  let n = 0;
  for (const s of names) {
    const m = new RegExp(`^${stem} (\\d+)$`).exec(s);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${stem} ${n + 1}`;
}

/** Physical units of a page (shown and typed; px is what is stored). */
export const UNITS = { px: 1, in: 1, cm: 2.54, mm: 25.4 } as const;
export type Unit = keyof typeof UNITS;
/** px from a length in `unit` at `dpi`. */
export const toPx = (v: number, unit: Unit, dpi: number): number => (unit === "px" ? v : (v / UNITS[unit]) * dpi);
export const fromPx = (px: number, unit: Unit, dpi: number): number => (unit === "px" ? px : (px / dpi) * UNITS[unit]);
