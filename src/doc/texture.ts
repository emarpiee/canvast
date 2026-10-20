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
    && typeof t["avg"] === "string" && AVG.test(t["avg"]);
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
export function nearOrigin(l: Layout, nx: number, ny: number): Layout {
  if (!l.repeat || !(l.cw > 0) || !(l.ch > 0)) return l;
  const kx = Math.floor((nx - l.ox) / l.cw), ky = Math.floor((ny - l.oy) / l.ch);
  return kx === 0 && ky === 0 ? l : { ...l, ox: l.ox + kx * l.cw, oy: l.oy + ky * l.ch };
}
