/**
 * Texture fills (ADR 0154): a shape filled with a picture or with other objects repeated over it. One kind of paint for both, so one
 * set of controls and one drawing path: the *source* is a picture of the library (`asset`) or objects of the canvas (`objects`, repeated over the shape),
 * and the same placement says how it lies in the shape: how big, turned, moved, and whether it is repeated (and on what grid).
 *
 * Everything is measured in the shape's own box, like a gradient (ADR 0100): the tile of a repeated source is a share of the box's longer
 * side, offsets are shares of the box, so the texture follows the shape when it is moved, stretched or turned, and is exact at any depth.
 * This file is the pure part (the paint, its validation, and where the tile lies); drawing is `render/texture.ts`.
 */

export type TextureSource =
  | { readonly kind: "asset"; readonly hash: string }
  | { readonly kind: "objects"; readonly ids: readonly string[] };

/** How a picture lies in the shape: `fill` covers it (the overflow is cut), `fit` shows all of it, `crop` is `fill` with the controls free, `tile` repeats it. Objects are always `tile`. */
export type TextureMode = "fill" | "fit" | "crop" | "tile";
/** The grid of repeated tiles: rows one above the other, rows each half a tile across from the one above (`hex-h`), or columns half a tile down from the one beside (`hex-v`). */
export type TileType = "rect" | "hex-h" | "hex-v";
export type TileAlign = "start" | "center" | "end";

export interface TexturePaint {
  readonly type: "texture";
  readonly src: TextureSource;
  readonly mode: TextureMode;
  /** 1 = natural size: a repeated tile is a quarter of the box's longer side; a placed picture covers (`fill`) or fits (`fit`) the box. */
  readonly scale: number;
  /** Degrees clockwise, about the middle of the box (on top of the turn of the shape). */
  readonly rotation: number;
  /** Where the texture is moved to, in shares of the box (0.5 = half its width). */
  readonly offset: readonly [number, number];
  /** Repeated tiles only. */
  readonly tile: TileType;
  /** Space between tiles, in shares of the tile (0 = they touch). */
  readonly spacing: readonly [number, number];
  readonly align: TileAlign;
  /** The average colour of the source, "#rrggbb", shown where the texture itself cannot be (the density preview, a swatch, an SVG). */
  readonly avg: string;
  /** Each repeated copy varied by its own random values (ADR 0173); absent: every copy the same. */
  readonly vary?: TextureVary;
}

/**
 * How the copies of a repeated texture vary (ADR 0173). Each copy's values come from `seed` and its cell alone, so a copy is the same at
 * every zoom, after a reload and in an export, and editing a source changes how the copies look, never where they are.
 */
export interface TextureVary {
  /** Objects: a copy of each object in a cell of its own (true), or of all of them as they lie together (false, as without Vary). */
  readonly each: boolean;
  /** Turned by up to ± this many degrees; with `rotStep`, by whole steps of it. */
  readonly rotation: number;
  readonly rotStep: number;
  /** Bigger or smaller by up to ± this share. */
  readonly size: number;
  /** Moved in its cell by up to ± this share of the cell. */
  readonly jitter: number;
  /** Which object is in a cell: in turn, or at random (`each` only). */
  readonly order: "sequence" | "shuffle";
  readonly flip: boolean;
  /** This share of the cells is left empty. */
  readonly skip: number;
  readonly seed: number;
}

/** The copies repeat after at least this many cells across and down (so a block of them can be drawn once and repeated, at any zoom). */
export const VARY_PERIOD = 16;
/** The repeat for `n` objects in turn: a whole number of turns, so the turn does not jump where the block repeats (more than 16 objects: 16). */
export const varyPeriod = (v: TextureVary, n: number): number => {
  const count = v.each ? Math.max(1, n) : 1;
  return count > VARY_PERIOD ? VARY_PERIOD : count * Math.ceil(VARY_PERIOD / count);
};
export const MAX_VARY_ROTATION = 180;
export const MAX_VARY_SIZE = 0.9;
export const MAX_VARY_JITTER = 0.5;
export const MAX_VARY_SKIP = 0.95;
export const noVary = (seed = 1): TextureVary => ({ each: true, rotation: 0, rotStep: 0, size: 0, jitter: 0, order: "sequence", flip: false, skip: 0, seed });

/** Whether `t` is drawn copy by copy: repeated, with Vary changing anything. */
export const isVaried = (t: TexturePaint): boolean => {
  const v = t.vary;
  return t.mode === "tile" && !!v && (v.each || v.rotation > 0 || v.size > 0 || v.jitter > 0 || v.flip || v.skip > 0 || v.order === "shuffle");
};

/** One copy: which object (index into the source's objects; -1: the cell is empty), how far it is moved (shares of the cell), turned (degrees), scaled and mirrored. */
export interface Copy {
  readonly src: number;
  readonly dx: number;
  readonly dy: number;
  readonly rot: number;
  readonly k: number;
  readonly flip: boolean;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** A number in 0..1 for (seed, cell, slot, what): a hash, so each value is independent of the others and of the order they are asked in. */
function unit(seed: number, i: number, j: number, slot: number, what: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i, 0x85ebca77) ^ Math.imul(j, 0xc2b2ae3d) ^ Math.imul(slot + 1, 0x27d4eb2f) ^ Math.imul(what + 7, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** The copy in cell (i, j), tile `slot` of the cell (a brick grid has two), of a source of `n` objects (or one arrangement). */
export function copyAt(v: TextureVary, n: number, i: number, j: number, slot: number): Copy {
  const period = varyPeriod(v, n);
  const [a, b] = [mod(i, period), mod(j, period)];
  const r = (what: number): number => unit(v.seed, a, b, slot, what);
  const count = v.each ? Math.max(1, n) : 1;
  if (v.skip > 0 && r(0) < v.skip) return { src: -1, dx: 0, dy: 0, rot: 0, k: 1, flip: false };
  const src = v.order === "shuffle" ? Math.floor(r(1) * count) % count : mod(a + b + slot, count);
  const spread = (what: number, by: number): number => (r(what) * 2 - 1) * by || 0; // (|| 0: no -0)
  let rot = spread(2, v.rotation);
  if (v.rotStep > 0) rot = Math.round(rot / v.rotStep) * v.rotStep || 0;
  return { src, dx: spread(3, v.jitter), dy: spread(4, v.jitter), rot, k: 1 + spread(5, v.size), flip: v.flip && r(6) < 0.5 };
}

export const TEXTURE_MODES: readonly TextureMode[] = ["fill", "fit", "crop", "tile"];
export const TILE_TYPES: readonly TileType[] = ["rect", "hex-h", "hex-v"];
export const TILE_ALIGNS: readonly TileAlign[] = ["start", "center", "end"];
export const MAX_SOURCE_OBJECTS = 200;
/** The share of the box's longer side that a repeated tile's longer side is at scale 1. */
export const TILE_SHARE = 0.25;
export const MIN_SCALE = 0.01;
export const MAX_SCALE = 100;
export const MAX_SPACING = 20;

const HASH = /^[0-9a-f]{64}$/;
const AVG = /^#[0-9a-f]{6}$/i;
const fin = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const pair = (v: unknown, lo: number, hi: number): boolean => Array.isArray(v) && v.length === 2 && fin(v[0], lo, hi) && fin(v[1], lo, hi);

export const isTexture = (p: unknown): p is TexturePaint => typeof p === "object" && p !== null && (p as { type?: unknown }).type === "texture";

/** Whether `v` is a texture the document accepts. */
export function isTextureValid(v: unknown): v is TexturePaint {
  if (!isTexture(v)) return false;
  const t = v as unknown as Record<string, unknown>;
  const s = t["src"] as Record<string, unknown> | undefined;
  const srcOk = !!s && ((s["kind"] === "asset" && typeof s["hash"] === "string" && HASH.test(s["hash"])) || (s["kind"] === "objects" && Array.isArray(s["ids"]) && s["ids"].length >= 1 && s["ids"].length <= MAX_SOURCE_OBJECTS && s["ids"].every((i) => typeof i === "string" && i.length > 0 && i.length < 100)));
  return srcOk
    && TEXTURE_MODES.includes(t["mode"] as TextureMode)
    && (s!["kind"] === "asset" || t["mode"] === "tile")
    && fin(t["scale"], MIN_SCALE, MAX_SCALE)
    && fin(t["rotation"], -360, 360)
    && pair(t["offset"], -1000, 1000)
    && TILE_TYPES.includes(t["tile"] as TileType)
    && pair(t["spacing"], 0, MAX_SPACING)
    && TILE_ALIGNS.includes(t["align"] as TileAlign)
    && typeof t["avg"] === "string" && AVG.test(t["avg"])
    && (t["vary"] === undefined || isVaryValid(t["vary"]));
}

function isVaryValid(v: unknown): v is TextureVary {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r["each"] === "boolean" && fin(r["rotation"], 0, MAX_VARY_ROTATION) && fin(r["rotStep"], 0, 180) && fin(r["size"], 0, MAX_VARY_SIZE)
    && fin(r["jitter"], 0, MAX_VARY_JITTER) && (r["order"] === "sequence" || r["order"] === "shuffle") && typeof r["flip"] === "boolean"
    && fin(r["skip"], 0, MAX_VARY_SKIP) && Number.isInteger(r["seed"]) && fin(r["seed"], 0, 2 ** 31);
}

/** A texture with the usual starting values: a picture covers the shape, objects repeat. */
export function newTexture(src: TextureSource, avg = "#808080"): TexturePaint {
  return { type: "texture", src, mode: src.kind === "asset" ? "fill" : "tile", scale: 1, rotation: 0, offset: [0, 0], tile: "rect", spacing: [0, 0], align: "center", avg };
}

/** The same texture with another source (objects become `tile`, a picture keeps its mode). */
export const withSource = (t: TexturePaint, src: TextureSource, avg: string): TexturePaint => ({ ...t, src, avg, mode: src.kind === "objects" ? "tile" : t.mode });

/** Whether two textures draw the same (the average colour is not part of it). */
export const sameTexture = (a: TexturePaint, b: TexturePaint): boolean => JSON.stringify({ ...a, avg: 0 }) === JSON.stringify({ ...b, avg: 0 });

export interface Box {
  readonly w: number;
  readonly h: number;
}

/**
 * Where the texture's tiles lie, in the box's own frame: x to the right, y down, the origin at the middle of the box, before the turn.
 * `tw` × `th` is one tile; `cw` × `ch` is the cell that is repeated (the tile and its space, two rows or two columns for a hex grid);
 * `ox`, `oy` is the top left of the first tile's cell; `repeat` says whether the cell is repeated at all.
 */
export interface Layout {
  readonly tw: number;
  readonly th: number;
  readonly cw: number;
  readonly ch: number;
  readonly ox: number;
  readonly oy: number;
  readonly repeat: boolean;
  /** Where the tile lies in the cell (the cell holds one tile, or the two of a hex grid). */
  readonly tiles: ReadonlyArray<readonly [number, number]>;
}

/** The layout of `t` for a source of `aspect` (width ÷ height) in a box of `box`. */
export function layoutOf(t: TexturePaint, box: Box, aspect: number): Layout {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const longer = Math.max(box.w, box.h);
  let tw: number, th: number;
  if (t.mode === "tile") {
    // the tile's longer side is a share of the box's longer side
    const side = TILE_SHARE * longer * t.scale;
    [tw, th] = a >= 1 ? [side, side / a] : [side * a, side];
  } else {
    // cover or contain: scale the picture so its width fills the box (or its height does), whichever the mode asks for
    const widthFills = t.mode === "fit" ? box.w / a <= box.h : box.w / a >= box.h;
    [tw, th] = widthFills ? [box.w, box.w / a] : [box.h * a, box.h];
    tw *= t.scale;
    th *= t.scale;
  }
  const ox = t.offset[0] * box.w, oy = t.offset[1] * box.h;
  if (t.mode !== "tile") return { tw, th, cw: tw, ch: th, ox: -tw / 2 + ox, oy: -th / 2 + oy, repeat: false, tiles: [[0, 0]] };
  const gx = t.spacing[0] * tw, gy = t.spacing[1] * th;
  const cellW = tw + gx, cellH = th + gy;
  const ax = t.align === "start" ? 0 : t.align === "end" ? gx : gx / 2; // (the tile's place across its cell)
  const x0 = -box.w / 2 + ox, y0 = -box.h / 2 + oy;
  if (t.tile === "hex-h") return { tw, th, cw: cellW, ch: 2 * cellH, ox: x0, oy: y0, repeat: true, tiles: [[ax, 0], [ax + cellW / 2, cellH]] };
  if (t.tile === "hex-v") return { tw, th, cw: 2 * cellW, ch: cellH, ox: x0, oy: y0, repeat: true, tiles: [[ax, 0], [ax + cellW, cellH / 2]] };
  return { tw, th, cw: cellW, ch: cellH, ox: x0, oy: y0, repeat: true, tiles: [[ax, 0]] };
}

/**
 * The same layout moved by whole cells so that its first cell lies near (`nx`, `ny`) (the part of the box in view, in the box's own frame):
 * a repeated texture is the same wherever it starts, and small numbers keep the drawing exact when the view is far from the box's corner.
 */
export function nearOrigin(l: Layout, nx: number, ny: number, step = 1): Layout {
  if (!l.repeat || !(l.cw > 0) || !(l.ch > 0)) return l;
  // (by whole `step`s of cells: varied copies repeat only after a block of cells, so the first cell must stay one of the block's)
  const kx = Math.floor((nx - l.ox) / (l.cw * step)) * step, ky = Math.floor((ny - l.oy) / (l.ch * step)) * step;
  return kx === 0 && ky === 0 ? l : { ...l, ox: l.ox + kx * l.cw, oy: l.oy + ky * l.ch };
}
