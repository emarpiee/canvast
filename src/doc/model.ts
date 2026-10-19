import * as D from "../core/dyadic";
import type { WidthProfile } from "./stroker";
import { PROFILE_NAMES } from "./stroker";
import { formatTags, isTag } from "./tags";
import type { WorldPoint } from "../core/camera";
import type { Frame, FrameSpace } from "../core/frames";
import { expressExactIn, levelsBetween, rehome } from "../core/frames";
import { TURN, cosSin } from "../core/angle";
import { layoutOf } from "../text/layout";
import { pathTextBounds } from "../text/glyph-space";

const textPathBounds = (o: TextObject): LocalBounds => {
  let b = pathBoundsCache.get(o);
  if (!b) {
    const r = pathTextBounds(o);
    const p = (TEXT_PAD_EM + (o.outline?.w ?? 0)) * o.size;
    pathBoundsCache.set(o, (b = { minX: r.minX - p, minY: r.minY - p, maxX: r.maxX + p, maxY: r.maxY + p }));
  }
  return b;
};
const pathBoundsCache = new WeakMap<TextObject, LocalBounds>();
import type { TextAlign } from "../text/layout";
import { MAX_MARKDOWN_LENGTH, canonical } from "../text/markdown";
import type { Align, Arrow, Cap, Join, Radius, ShapeKind, ShapeParams, SubPath } from "./path";
import { ARROWS, miterLimitOf } from "./path";
import type { Dash } from "./stroke-look";
import { validAdjust } from "./adjust";
import type { Adjust, Crop } from "./adjust";
import type { Gradient, Paint } from "./paint";
import type { BoolOp } from "./boolean";
import { inkOfPaint, isPaint } from "./paint";
import { NODE, SHAPE_KINDS, paintBounds, rotateSubs } from "./path";

/**
 * Authoritative canvas objects.
 *
 * Every object is independent: it owns its transform and is never implicitly
 * parented to whatever it overlaps. Placement is
 *
 *   world(local) = anchor + local · 2^unit
 *
 * with an exact dyadic `anchor`, an integer `unit` exponent, and local
 * geometry stored as ordinary doubles kept well-conditioned (roughly 1..2^16
 * local units). Objects are immutable; edits replace them through
 * transactions (see document-store.ts).
 *
 * `anchor` and `unit` are in the units of the object's `frame` (ADR 0014);
 * an object without `frame` is in the world frame.
 */
export type ObjectId = string;

interface ObjectBase {
  readonly id: ObjectId;
  /** Coordinate frame of `anchor` and `unit`; absent = the world frame. */
  readonly frame?: Frame;
  readonly anchor: WorldPoint;
  readonly unit: number;
  /** Paint order; larger is on top. */
  readonly z: number;
  /**
   * Object opacity in (0, 1]. The renderer paints each object's coverage once
   * (see draw-objects.ts), so self-overlaps never double-blend.
   */
  readonly opacity: number;
  /** The object this one follows when it moves (ADR 0109); null = not attached. A target that is gone counts as none. */
  readonly attachmentTargetId: ObjectId | null;
  /**
   * Rotation about the centre of the object's own (unrotated) bounds, in whole
   * 2^-32 turns (core/angle.ts, ADR 0018); absent = not rotated.
   */
  readonly rot?: number;
  /** How this object follows its sheet when the sheet is resized (ADR 0108); absent = left and top. */
  readonly constraint?: { readonly h: "left" | "right" | "both" | "center" | "scale"; readonly v: "top" | "bottom" | "both" | "center" | "scale" };
  /** The sheet (a path with `container`, ADR 0108) this object is on; absent = on the canvas itself. A sheet that is gone counts as absent. */
  readonly parent?: ObjectId;
  /** The groups containing this object, outermost first (doc/groups.ts, ADR 0020); absent = not grouped. */
  readonly groups?: readonly string[];
  /** Layer name shown in the Layers panel (ADR 0047); absent = the automatic label. */
  readonly name?: string;
  /** Names of the groups this object is in, by group id (ADR 0047); absent = none named. */
  readonly groupNames?: Readonly<Record<string, string>>;
  /** Which of its groups are boolean groups (ADR 0103), and the operation of each; a member and the result of such a group both carry it. */
  readonly boolOps?: Readonly<Record<string, BoolOp>>;
  /** How the object's paint mixes with what is behind it (ADR 0047); absent = normal. */
  readonly blend?: BlendMode;
  /** In-canvas tags (ADR 0062): labels of this instance, separate from an asset's library tags; absent = none. */
  readonly tags?: readonly string[];
  /** A mask (ADR 0144): the objects of the group `by` (those with `isMask`) hide or show this one, by their opacity (`alpha`) or their brightness (`luminance`); `invert` swaps hidden and shown. */
  readonly mask?: { readonly by: string; readonly mode: "alpha" | "luminance"; readonly invert?: true };
  /** This object is part of a mask (of the group `mask.by` of another object): it is not drawn or picked on its own, only used to cut that object. */
  readonly isMask?: true;
  /** Not drawn, picked or indexed while true (ADR 0021); absent = shown. */
  readonly hidden?: boolean;
  /** Drawn, but cannot be picked, selected or edited while true (ADR 0021); absent = unlocked. */
  readonly locked?: boolean;
}

/** Blend modes offered (the canvas's `globalCompositeOperation` names); absent on an object = normal. */
export const BLEND_MODES = ["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Most in-canvas tags on one object, and the longest one. */
export const MAX_OBJECT_TAGS = 50;
export const MAX_TAG_LENGTH = 64;

/** Longest layer or group name kept. */
export const MAX_NAME_LENGTH = 80;

export interface StrokeObject extends ObjectBase {
  readonly kind: "stroke";
  /** Flat [x0, y0, x1, y1, ...] polyline in local units, relative to anchor. */
  readonly points: readonly number[];
  // `rot` (ObjectBase) turns the points: use `strokePoints` for the geometry that is drawn, hit and indexed.
  /** Stroke diameter in local units. */
  readonly width: number;
  readonly color: string;
}

/** Per-instance state of a video, GIF or audio placed from the library (ADR 0041). Absent on plain images. */
export interface MediaState {
  readonly kind: "video" | "gif" | "audio";
  /** Paused position: seconds for video and audio, a frame index for a GIF. Playback never writes it; pausing does. */
  readonly t: number;
  /** Start again at the end instead of stopping. */
  readonly repeat: boolean;
  /** Video and audio: play only from the first second to the second (ADR 0112); absent = the whole file. */
  readonly range?: readonly [number, number];
  /** How fast it plays, 0.25 to 4 times (ADR 0137); absent = 1. */
  readonly speed?: number;
}

export interface ImageObject extends ObjectBase {
  readonly kind: "image";
  /** Content hash (SHA-256 hex) of the shared source asset. */
  readonly assetId: string;
  /** Displayed size in local units; the anchor is the top-left corner. */
  readonly w: number;
  readonly h: number;
  /** Intrinsic pixel size of the source, for pixel-accurate magnification. */
  readonly pixelW: number;
  readonly pixelH: number;
  readonly media?: MediaState;
  /** The window of the source pixels it shows (ADR 0118), whole pixels; absent = all of them. `w` and `h` (above) are the size of this window as shown. */
  readonly crop?: Crop;
  /** Non-destructive adjustments (ADR 0118); absent = none. */
  readonly adjust?: Adjust;
  /**
   * Rounded corners and an outline, as a shape has them (ADR 0148): the same fields, the same controls. `radius`: local units, one value or one
   * for each corner (top left, top right, bottom right, bottom left); absent = square. `stroke` is a colour or a gradient (placed on the picture's
   * box like a shape's), `width` in local units, and `join`, `cap`, `align`, `dash`, `dashOffset`, `miterAngle` mean what they mean for a path.
   */
  readonly radius?: number | readonly number[];
  readonly stroke?: Paint;
  readonly width?: number;
  readonly join?: Join;
  readonly cap?: Cap;
  readonly align?: Align;
  readonly dash?: readonly [number, number];
  readonly dashOffset?: number;
  readonly miterAngle?: number;
}

/** The picture a shape's texture fill is made of (ADR 0154), read off a fill as stored or as it is in memory. */
const textureAsset = (fill: unknown): string | undefined => {
  const s = (fill as { type?: string; src?: { kind?: string; hash?: string } } | null | undefined);
  return s && s.type === "texture" && s.src?.kind === "asset" ? s.src.hash : undefined;
};

/** The library asset an object uses: a picture's file, the font file a text is set in, or the picture a shape is filled with (undefined: none). */
export const assetOf = (o: CanvasObject): string | undefined => (o.kind === "image" || o.kind === "text" ? o.assetId : o.kind === "path" ? textureAsset(o.fill) : undefined);

/** The same read off a stored record (`data`). */
export const storedAssetOf = (d: Readonly<Record<string, unknown>>): string | undefined => (d["kind"] === "image" || d["kind"] === "text" ? (d["assetId"] as string | undefined) : d["kind"] === "path" ? textureAsset(d["fill"]) : undefined);

/** Key of the decoded picture an image object draws: the poster of a video at its paused time, a GIF at its paused frame (an audio file always shows its waveform), else the asset itself. */
export function rasterKey(o: ImageObject): string {
  if (!o.media || o.media.t <= 0) return o.assetId;
  return o.media.kind === "video" ? `${o.assetId}#${Math.round(o.media.t * 1000)}` : o.media.kind === "gif" ? `${o.assetId}#${o.media.t}` : o.assetId;
}

export interface TextObject extends ObjectBase {
  readonly kind: "text";
  /** Line height as a multiple of the font size (ADR 0113); absent = the standard 1.3. */
  readonly lineHeight?: number;
  /** Extra space after every letter, in em (ADR 0113); absent = none. */
  readonly tracking?: number;
  /** The font file the text is set in: the hash of a library asset (so the library, archives and the clean-up of unused originals know the text uses it). Absent = the bundled font. */
  readonly assetId?: string;
  /** Horizontal alignment of the lines; absent = left. */
  readonly align?: Exclude<TextAlign, "left">;
  /** The width follows the words: no wrapping but at a new paragraph, and `w` is kept equal to the widest line. Absent = a set width the words wrap at. */
  readonly autoWidth?: true;
  /** Canonical Markdown (text/markdown.ts); the anchor is the top-left corner. */
  readonly md: string;
  /** Wrap width in local units (with `autoWidth`, the width of the widest line). */
  readonly w: number;
  /** Body font size (1 em) in local units. */
  readonly size: number;
  readonly color: string;
  /** A gradient the letters are filled with instead of `color`, placed on the text's box (doc/paint.ts); a range with a colour of its own keeps it. */
  readonly gradient?: Gradient;
  /** A line round the letters: its colour and its width in em, drawn outside them (behind the fill). */
  readonly outline?: { readonly c: string; readonly w: number };
  /** A set height in local units: the box is this tall whatever the words need (they may run past it), and `valign` places them in it. Absent = as tall as the words. */
  readonly h?: number;
  /** Where the words sit in a set height; absent = at the top. */
  readonly valign?: "middle" | "bottom";
  /** The space between paragraphs in em; absent = the standard 0.6. */
  readonly paraGap?: number;
  /** The first line of every paragraph starts this far in, in em; absent = none. */
  readonly indent?: number;
  /** A change of case applied to the letters when they are set (the words stay as they were typed); absent = none. */
  readonly caps?: "upper" | "lower" | "title" | "small";
  /** At most this many lines; the last shows "…" when words were cut. Absent = all of them. */
  readonly maxLines?: number;
  /** Kerning of the font between letters; absent = off (older texts keep the layout they had). */
  readonly kerning?: true;
  /** OpenType feature tags that are on (ligatures `liga`, small capitals `smcp`, tabular numerals `tnum`...), sorted. */
  readonly features?: readonly string[];
  /** The values of a variable font's axes (tag → value in the axis's own units). */
  readonly axes?: Readonly<Record<string, number>>;
  /** A card behind the words (a note): its colour, the space round the words and the corner radius, both in em. The box includes the space; the words wrap inside it. */
  readonly card?: { readonly fill: string; readonly pad: number; readonly radius: number };
  /** A curve the words run along (nodes of six numbers, local units of the text; a copy of a path's first sub-path made when the text was put on it). The text does not wrap then; a second line sits below the first. */
  readonly onPath?: { readonly n: readonly number[]; readonly closed: boolean };
}

/**
 * A vector path (ADR 0099): sub-paths of nodes with Bézier handles (doc/path.ts), filled and/or stroked. The geometry is local
 * doubles like a stroke's, placed by the exact anchor and unit; `rot` turns it (see `pathSubs`). Shapes (rectangle, ellipse, line,
 * polygon, star) are made as paths and remember what they were in `shape`, only for their label and tool defaults.
 */
export interface PathObject extends ObjectBase {
  readonly kind: "path";
  readonly sub: readonly SubPath[];
  /** A colour ("#rrggbb" or "#rrggbbaa") or a gradient (doc/paint.ts); null: not filled. */
  readonly fill: Paint | null;
  /** A colour or a gradient; null: no outline. */
  readonly stroke: Paint | null;
  /** Outline width in local units (kept positive even without an outline, so turning one on has a width to show). */
  readonly width: number;
  /** Absent: round. */
  readonly join?: Join;
  /** Absent: round. */
  readonly cap?: Cap;
  /** Present: this path is a sheet (ADR 0108): a rectangle that holds objects (they name it as their `parent`) and, with `clip`, hides what lies outside it. */
  /** A sheet (ADR 0108). `scale`: when the sheet is resized, everything on it grows with it, whatever its pins say (ADR 0133). */
  readonly container?: { readonly clip: boolean; readonly scale?: true; readonly mask?: true; readonly was?: { readonly fill: Paint | null; readonly stroke: Paint | null } };
  /** Absent: a solid outline. Dash and gap, in widths of the outline (ADR 0107). */
  readonly dash?: Dash;
  /** Corners sharper than this many degrees (1 to 90) are cut to a bevel instead of a point; absent = the default (29°). */
  readonly miterAngle?: number;
  /** An arrow head at the first or last node of every open sub-path (ADR 0142); absent = none. */
  readonly arrowStart?: Arrow;
  readonly arrowEnd?: Arrow;
  /** Where in the pattern the outline starts, in widths of the outline (absent: 0). */
  readonly dashOffset?: number;
  /** A vector network (ADR 0146): the sub-paths are edges (chains from one vertex to another; ends at exactly one point are one vertex), and the regions they enclose are filled. */
  readonly net?: true;
  /** A width profile of the outline that stays live (a taper, ADR 0150): the line is drawn as the shape `outlineOf` makes with it. Ignored on a network and at depths doubles cannot place. */
  readonly profile?: WidthProfile;
  /** A fill of their own for some regions of a network (ADR 0150): each region is named by one of the half-edges round it (2·edge, +1 backward); a paint of null leaves it empty. `edges`: how many edges there were when set; if the edges are added or taken away the fills no longer apply. */
  readonly regions?: { readonly edges: number; readonly fills: readonly (readonly [number, Paint | null])[] };
  /** Absent: the outline is centred on the edge. Only closed shapes can have it inside or outside (`alignOf`). */
  readonly align?: Align;
  /** Fill rule: absent is non-zero. */
  readonly evenodd?: true;
  readonly shape?: ShapeKind;
  /**
   * Rounded corners (ADR 0105): the radius in local units, or for a rectangle one per node. `sub` is then the rounded geometry and `base` the
   * sharp one it was made from (what Edit nodes shows and edits), except on the result of a boolean group, which is rounded as it is derived.
   */
  readonly radius?: Radius;
  readonly base?: readonly SubPath[];
  /** Corner smoothing 0 to 1 (ADR 0143): the rounded corners start farther out and blend into the line; absent = a plain circular arc. Only with a radius. */
  readonly smoothing?: number;
  /** The shape as it was when "Set initial shape" was pressed (ADR 0106): kept with the object, so it survives whatever happens after, and can be come back to. */
  readonly initial?: InitialShape;
  /** What the shape is made from (box, sides, points, ratio, corner radius), present while its nodes are still the shape's own (ADR 0105). */
  readonly params?: ShapeParams;
  /** The result of the boolean group with this id (ADR 0103): derived from the group's members, recomputed with every change to them. */
  readonly result?: string;
}

export type CanvasObject = StrokeObject | ImageObject | TextObject | PathObject;

/** The outline style of a path as `paintBounds` takes it (null: no outline). */
export const pathStyle = (o: PathObject): { width: number; join?: Join; cap?: Cap; arrows?: boolean; miter?: number } | null => (o.stroke === null ? null : { width: o.width, ...(o.join ? { join: o.join } : {}), ...(o.cap ? { cap: o.cap } : {}), ...(o.arrowStart || o.arrowEnd ? { arrows: true } : {}), ...(o.miterAngle !== undefined ? { miter: miterLimitOf(o.miterAngle) } : {}) });

/** Where the outline of a path sits: undefined (centred) unless every sub-path is closed and `align` says inside or outside. */
export const alignOf = (o: PathObject): Align | undefined => (o.align && o.stroke !== null && o.sub.length > 0 && o.sub.every((s) => s.closed) ? o.align : undefined);

/** The outline as the bounds of the paint take it: an outline outside the edge reaches its whole width past it, one inside reaches nothing past it. */
export const inkStyle = (o: PathObject): { width: number; join?: Join; cap?: Cap; arrows?: boolean; miter?: number } | null => {
  const a = alignOf(o);
  return a === "inside" ? null : a === "outside" ? { ...pathStyle(o)!, width: o.width * 2 } : pathStyle(o);
};

const turnedPaths = new WeakMap<PathObject, readonly SubPath[]>();

/** The sub-paths that are drawn, hit and indexed: `sub` turned by `rot` about the centre of the unturned bounds (the same array when not turned). */
export function pathSubs(o: PathObject): readonly SubPath[] {
  if (!o.rot) return o.sub;
  let r = turnedPaths.get(o);
  if (!r) {
    const b = paintBounds(o.base ?? o.sub, pathStyle(o)); // (a rounded path turns about the middle of its sharp box: rounding does not move it)
    const { c, s } = cosSin(o.rot);
    turnedPaths.set(o, (r = rotateSubs(o.sub, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, c, s)));
  }
  return r;
}

const turnedBases = new WeakMap<PathObject, readonly SubPath[]>();

/** The sub-paths Edit nodes shows and changes: the sharp base of a rounded path (turned like `pathSubs`), else what is drawn. */
export function editSubs(o: PathObject): readonly SubPath[] {
  if (!o.base) return pathSubs(o);
  if (!o.rot) return o.base;
  let r = turnedBases.get(o);
  if (!r) {
    const b = paintBounds(o.base ?? o.sub, pathStyle(o));
    const { c, s } = cosSin(o.rot);
    turnedBases.set(o, (r = rotateSubs(o.base, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, c, s)));
  }
  return r;
}

/** A path's geometry as saved by "Set initial shape": everything that makes its shape, in its own units (`unit`), without where it is or how it is painted. */
export interface InitialShape {
  readonly sub: readonly SubPath[];
  readonly base?: readonly SubPath[];
  readonly radius?: Radius;
  readonly params?: ShapeParams;
  readonly rot?: number;
  readonly unit: number;
  /** A boolean group's result: the group's operation when it was saved (its shapes keep theirs); the radius and unit are the result's. */
  readonly op?: string;
  /** A shape of a boolean group saved with the group: where its middle was from the middle of the group, in multiples of 2^unit. */
  readonly offset?: { readonly x: number; readonly y: number };
}

/** Margin around a text box (em) for italic overhang, bold and descenders past the line box. */
export const TEXT_PAD_EM = 0.25;

export interface LocalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const rotated = new WeakMap<StrokeObject, readonly number[]>();

/** Centre of a stroke's points (the rotation pivot), in local units. */
export function strokePivot(o: StrokeObject): { x: number; y: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const p = o.points;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]!);
    maxX = Math.max(maxX, p[i]!);
    minY = Math.min(minY, p[i + 1]!);
    maxY = Math.max(maxY, p[i + 1]!);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** The polyline that is drawn: `points` rotated by `rot` about their centre (the same array when not rotated). */
export function strokePoints(o: StrokeObject): readonly number[] {
  if (!o.rot) return o.points;
  let r = rotated.get(o);
  if (!r) {
    const { x: px, y: py } = strokePivot(o);
    const { c, s } = cosSin(o.rot);
    const out = new Array<number>(o.points.length);
    for (let i = 0; i < out.length; i += 2) {
      const dx = o.points[i]! - px;
      const dy = o.points[i + 1]! - py;
      out[i] = px + c * dx - s * dy;
      out[i + 1] = py + s * dx + c * dy;
    }
    rotated.set(o, (r = out));
  }
  return r;
}

/** Bounds of the object's own geometry before `rot` is applied. */
export function unrotatedBounds(o: CanvasObject): LocalBounds {
  // (the box of a rounded path is that of its sharp outline: rounding, or changing a star's ratio, never resizes it)
  if (o.kind === "path") return paintBounds(o.base ?? o.sub, inkStyle(o));
  if (o.kind === "image") return { minX: 0, minY: 0, maxX: o.w, maxY: o.h };
  if (o.kind === "text") {
    if (o.onPath) return textPathBounds(o);
    const l = layoutOf(o);
    const p = (TEXT_PAD_EM + (o.outline?.w ?? 0)) * o.size;
    return { minX: -p, minY: -p, maxX: l.width * o.size + p, maxY: l.height * o.size + p };
  }
  const p = o.points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]!);
    maxX = Math.max(maxX, p[i]!);
    minY = Math.min(minY, p[i + 1]!);
    maxY = Math.max(maxY, p[i + 1]!);
  }
  const r = o.width / 2;
  return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
}

/** The rotation pivot: the centre of the unrotated bounds, in local units. */
export function pivotOf(o: CanvasObject): { x: number; y: number } {
  const b = unrotatedBounds(o);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function localBounds(o: CanvasObject): LocalBounds {
  if (o.kind === "path") return o.rot ? paintBounds(o.base ? editSubs(o) : pathSubs(o), inkStyle(o)) : paintBounds(o.base ?? o.sub, inkStyle(o));
  if (o.kind !== "stroke") {
    const b = unrotatedBounds(o);
    if (!o.rot) return b;
    // Bounding box of the turned rectangle.
    const { c, s } = cosSin(o.rot);
    const px = (b.minX + b.maxX) / 2;
    const py = (b.minY + b.maxY) / 2;
    const hx = (b.maxX - b.minX) / 2;
    const hy = (b.maxY - b.minY) / 2;
    const ex = Math.abs(c) * hx + Math.abs(s) * hy;
    const ey = Math.abs(s) * hx + Math.abs(c) * hy;
    return { minX: px - ex, minY: py - ey, maxX: px + ex, maxY: py + ey };
  }
  const p = strokePoints(o);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i]!;
    const y = p[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const r = o.width / 2;
  return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
}

/** The one colour that stands for an object where only one fits (the density preview, the layers list): "#rrggbb" and its opacity, 0 to 1. */
export function inkOf(o: StrokeObject | TextObject | PathObject): { rgb: string; alpha: number } {
  if (o.kind !== "path") return { rgb: o.color, alpha: 1 };
  return inkOfPaint(o.fill ?? o.stroke ?? "#000000");
}

export function newObjectId(): ObjectId {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Validation and serialization

export class InvalidObjectError extends Error {}

const ID_RE = /^[0-9a-f]{32}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
/** A text colour may carry alpha (#rrggbbaa). */
const TEXT_COLOR_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
/** Most sub-paths in a path, and most nodes in all of them (a guard against a hand-edited or hostile file). */
export const MAX_SUBPATHS = 4096;
export const MAX_PATH_NODES = 200_000;

function finite(x: unknown, what: string): number {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new InvalidObjectError(`${what} is not a finite number`);
  return x;
}

function positive(x: unknown, what: string): number {
  const v = finite(x, what);
  if (!(v > 0)) throw new InvalidObjectError(`${what} must be positive`);
  return v;
}

function int(x: unknown, what: string): number {
  if (!Number.isSafeInteger(x)) throw new InvalidObjectError(`${what} is not a safe integer`);
  return x as number;
}

/** Throws InvalidObjectError if the object violates any invariant. */
export function validateObject(o: CanvasObject): CanvasObject {
  if (!ID_RE.test(o.id)) throw new InvalidObjectError(`bad id ${o.id}`);
  int(o.unit, "unit");
  finite(o.z, "z");
  if (!(finite(o.opacity, "opacity") > 0 && o.opacity <= 1)) throw new InvalidObjectError("opacity must be in (0, 1]");
  if (o.attachmentTargetId !== null && !(typeof o.attachmentTargetId === "string" && ID_RE.test(o.attachmentTargetId) && o.attachmentTargetId !== o.id)) throw new InvalidObjectError("bad attachment target");
  if (o.groups !== undefined && !(Array.isArray(o.groups) && o.groups.length > 0 && o.groups.length <= 16 && new Set(o.groups).size === o.groups.length && o.groups.every((g) => ID_RE.test(g)))) throw new InvalidObjectError("bad groups");
  if (o.parent !== undefined && !(typeof o.parent === "string" && ID_RE.test(o.parent) && o.parent !== o.id)) throw new InvalidObjectError("bad parent");
  if (o.constraint !== undefined && !(typeof o.constraint === "object" && o.constraint !== null && ["left", "right", "both", "center", "scale"].includes(o.constraint.h) && ["top", "bottom", "both", "center", "scale"].includes(o.constraint.v))) throw new InvalidObjectError("bad constraint");
  if (o.name !== undefined && !(typeof o.name === "string" && o.name.length > 0 && o.name.length <= MAX_NAME_LENGTH)) throw new InvalidObjectError("bad name");
  if (o.blend !== undefined && !(BLEND_MODES as readonly string[]).includes(o.blend)) throw new InvalidObjectError("bad blend mode");
  if (o.boolOps !== undefined && !(typeof o.boolOps === "object" && o.boolOps !== null && Object.keys(o.boolOps).length > 0 && Object.entries(o.boolOps).every(([k, v]) => (o.groups ?? []).includes(k) && ["union", "intersect", "subtract", "exclude"].includes(v)))) throw new InvalidObjectError("bad boolean groups");
  if (o.groupNames !== undefined && !(typeof o.groupNames === "object" && o.groupNames !== null && Object.entries(o.groupNames).every(([k, v]) => ID_RE.test(k) && typeof v === "string" && v.length > 0 && v.length <= MAX_NAME_LENGTH))) throw new InvalidObjectError("bad group names");
  if (o.tags !== undefined && !(Array.isArray(o.tags) && o.tags.length > 0 && o.tags.length <= MAX_OBJECT_TAGS && new Set(o.tags.map((t) => t.toLowerCase())).size === o.tags.length && o.tags.every((t) => typeof t === "string" && t.length > 0 && t.length <= MAX_TAG_LENGTH && isTag(t)))) throw new InvalidObjectError("bad tags");
  if (o.mask !== undefined && !(typeof o.mask === "object" && o.mask !== null && typeof o.mask.by === "string" && ID_RE.test(o.mask.by) && (o.mask.mode === "alpha" || o.mask.mode === "luminance") && (o.mask.invert === undefined || o.mask.invert === true))) throw new InvalidObjectError("bad mask");
  if (o.isMask !== undefined && o.isMask !== true) throw new InvalidObjectError("isMask is true or absent");
  if ((o.hidden !== undefined && o.hidden !== true) || (o.locked !== undefined && o.locked !== true)) throw new InvalidObjectError("hidden and locked are true or absent");
  if (o.rot !== undefined && !(Number.isInteger(o.rot) && o.rot > 0 && o.rot < TURN)) throw new InvalidObjectError("rot must be a whole angle in (0, 2^32)");
  if (o.kind === "stroke") {
    if (o.points.length < 2 || o.points.length % 2 !== 0) throw new InvalidObjectError("stroke needs at least one point");
    o.points.forEach((v, i) => finite(v, `point[${i}]`));
    positive(o.width, "width");
    if (!COLOR_RE.test(o.color)) throw new InvalidObjectError(`bad color ${o.color}`);
  } else if (o.kind === "image") {
    if (!HASH_RE.test(o.assetId)) throw new InvalidObjectError(`bad asset id ${o.assetId}`);
    positive(o.w, "w");
    positive(o.h, "h");
    if (int(o.pixelW, "pixelW") < 1 || int(o.pixelH, "pixelH") < 1) throw new InvalidObjectError("bad pixel size");
    if (o.crop !== undefined && !(Number.isInteger(o.crop.x) && Number.isInteger(o.crop.y) && Number.isInteger(o.crop.w) && Number.isInteger(o.crop.h) && o.crop.x >= 0 && o.crop.y >= 0 && o.crop.w >= 1 && o.crop.h >= 1 && o.crop.x + o.crop.w <= o.pixelW && o.crop.y + o.crop.h <= o.pixelH)) throw new InvalidObjectError("bad crop");
    if (o.adjust !== undefined && !validAdjust(o.adjust)) throw new InvalidObjectError("bad adjustments");
    if (o.radius !== undefined) {
      const rs = typeof o.radius === "number" ? [o.radius] : o.radius;
      if (!Array.isArray(rs) || (typeof o.radius !== "number" && rs.length !== 4) || !rs.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0)) throw new InvalidObjectError("bad radius");
    }
    if (o.stroke !== undefined && !(isPaint(o.stroke) && o.width !== undefined && Number.isFinite(o.width) && o.width > 0)) throw new InvalidObjectError("bad outline");
    if (o.join !== undefined && o.join !== "miter" && o.join !== "bevel") throw new InvalidObjectError("bad join");
    if (o.cap !== undefined && o.cap !== "butt" && o.cap !== "square") throw new InvalidObjectError("bad cap");
    if (o.align !== undefined && o.align !== "inside" && o.align !== "outside") throw new InvalidObjectError("bad align");
    if (o.dash !== undefined && !(Array.isArray(o.dash) && o.dash.length === 2 && o.dash.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0) && o.dash[0] + o.dash[1] > 0)) throw new InvalidObjectError("bad dash");
    if (o.dashOffset !== undefined && !(typeof o.dashOffset === "number" && Number.isFinite(o.dashOffset))) throw new InvalidObjectError("bad dash offset");
    if (o.miterAngle !== undefined && !(Number.isFinite(o.miterAngle) && o.miterAngle >= 1 && o.miterAngle <= 90)) throw new InvalidObjectError("bad miter angle");
    if (o.media !== undefined && !(["video", "gif", "audio"].includes(o.media.kind) && Number.isFinite(o.media.t) && o.media.t >= 0 && typeof o.media.repeat === "boolean" && (o.media.speed === undefined || (Number.isFinite(o.media.speed) && o.media.speed >= 0.25 && o.media.speed <= 4)) && (o.media.range === undefined || (Array.isArray(o.media.range) && o.media.range.length === 2 && Number.isFinite(o.media.range[0]) && Number.isFinite(o.media.range[1]) && o.media.range[0] >= 0 && o.media.range[1] > o.media.range[0])))) throw new InvalidObjectError("bad media state");
  } else if (o.kind === "path") {
    if (!Array.isArray(o.sub) || o.sub.length < 1 || o.sub.length > MAX_SUBPATHS) throw new InvalidObjectError("a path needs 1 to 4096 sub-paths");
    let nodes = 0;
    for (const s of o.sub) {
      if (!s || !Array.isArray(s.n) || s.n.length === 0 || s.n.length % NODE !== 0 || typeof s.closed !== "boolean") throw new InvalidObjectError("bad sub-path");
      nodes += s.n.length / NODE;
      s.n.forEach((v: number, i: number) => finite(v, `node[${i}]`));
    }
    if (nodes > MAX_PATH_NODES) throw new InvalidObjectError("too many nodes");
    if (o.fill !== null && !isPaint(o.fill, true)) throw new InvalidObjectError(`bad fill ${JSON.stringify(o.fill)}`); // (a texture is for the fill only)
    if (o.stroke !== null && !isPaint(o.stroke)) throw new InvalidObjectError(`bad stroke ${JSON.stringify(o.stroke)}`);
    if (!(finite(o.width, "width") > 0)) throw new InvalidObjectError("width must be positive");
    if (o.join !== undefined && o.join !== "miter" && o.join !== "bevel") throw new InvalidObjectError("bad join");
    if (o.cap !== undefined && o.cap !== "butt" && o.cap !== "square") throw new InvalidObjectError("bad cap");
    if (o.container !== undefined && !(typeof o.container === "object" && o.container !== null && typeof o.container.clip === "boolean" && (o.container.scale === undefined || o.container.scale === true) && (o.container.mask === undefined || o.container.mask === true) && (o.container.was === undefined || (typeof o.container.was === "object" && o.container.was !== null && [o.container.was.fill, o.container.was.stroke].every((v) => v === null || isPaint(v)))))) throw new InvalidObjectError("bad container");
    if (o.dash !== undefined && !(Array.isArray(o.dash) && o.dash.length === 2 && o.dash.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0) && o.dash[0] + o.dash[1] > 0)) throw new InvalidObjectError("bad dash");
    if (o.profile !== undefined && !PROFILE_NAMES.includes(o.profile)) throw new InvalidObjectError("bad width profile");
    if (o.net !== undefined && o.net !== true) throw new InvalidObjectError("net is true or absent");
    if (o.regions !== undefined && !(o.net === true && typeof o.regions === "object" && o.regions !== null && Number.isInteger(o.regions.edges) && Array.isArray(o.regions.fills) && o.regions.fills.every((f: unknown) => Array.isArray(f) && f.length === 2 && Number.isInteger(f[0]) && (f[1] === null || isPaint(f[1]))))) throw new InvalidObjectError("bad regions");
    if (o.smoothing !== undefined && !(Number.isFinite(o.smoothing) && o.smoothing > 0 && o.smoothing <= 1)) throw new InvalidObjectError("bad corner smoothing");
    if (o.miterAngle !== undefined && !(Number.isFinite(o.miterAngle) && o.miterAngle >= 1 && o.miterAngle <= 90)) throw new InvalidObjectError("bad miter angle");
    for (const [what, v] of [["start", o.arrowStart], ["end", o.arrowEnd]] as const) if (v !== undefined && !ARROWS.includes(v)) throw new InvalidObjectError(`bad arrow ${what}`);
    if (o.dashOffset !== undefined && !(typeof o.dashOffset === "number" && Number.isFinite(o.dashOffset))) throw new InvalidObjectError("bad dash offset");
    if (o.align !== undefined && o.align !== "inside" && o.align !== "outside") throw new InvalidObjectError("bad align");
    if (o.radius !== undefined) {
      const rs = typeof o.radius === "number" ? [o.radius] : o.radius;
      if (!Array.isArray(rs) && typeof o.radius !== "number") throw new InvalidObjectError("bad radius");
      if (rs.length > MAX_PATH_NODES || !rs.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) throw new InvalidObjectError("bad radius");
    }
    if (o.base !== undefined) {
      if (o.radius === undefined || !Array.isArray(o.base) || o.base.length !== o.sub.length) throw new InvalidObjectError("bad base");
      for (const b of o.base) if (!Array.isArray(b?.n) || b.n.length % NODE !== 0 || b.n.length > MAX_PATH_NODES * NODE) throw new InvalidObjectError("bad base");
      o.base.forEach((b) => b.n.forEach((v: number, i: number) => finite(v, `base[${i}]`)));
    }
    if (o.initial !== undefined) {
      const q = o.initial;
      if (!Array.isArray(q.sub) || q.sub.length < 1 || q.sub.length > MAX_SUBPATHS || !Number.isInteger(q.unit)) throw new InvalidObjectError("bad initial shape");
      for (const list of [q.sub, q.base ?? []]) {
        if (!Array.isArray(list)) throw new InvalidObjectError("bad initial shape");
        for (const b of list) {
          if (!Array.isArray(b?.n) || b.n.length % NODE !== 0 || b.n.length > MAX_PATH_NODES * NODE) throw new InvalidObjectError("bad initial shape");
          b.n.forEach((v: number, i: number) => finite(v, `initial[${i}]`));
        }
      }
    }
    if (o.evenodd !== undefined && o.evenodd !== true) throw new InvalidObjectError("evenodd is true or absent");
    if (o.shape !== undefined && !SHAPE_KINDS.includes(o.shape)) throw new InvalidObjectError("bad shape");
    if (o.params !== undefined) {
      const q = o.params;
      if (o.shape === undefined || !Array.isArray(q.box) || q.box.length !== 4) throw new InvalidObjectError("bad shape parameters");
      q.box.forEach((v, i) => finite(v, `params.box[${i}]`));
      for (const [k, lo, hi] of [["sides", 3, 24], ["tips", 3, 24], ["inner", 0.01, 0.99]] as const) {
        const v = q[k];
        if (v !== undefined && !(typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi && (k === "inner" || Number.isInteger(v)))) throw new InvalidObjectError(`bad ${k}`);
      }
    }
    if (o.result !== undefined && !(typeof o.result === "string" && (o.groups ?? []).includes(o.result) && o.boolOps?.[o.result] !== undefined)) throw new InvalidObjectError("bad boolean result");
  } else if (o.kind === "text") {
    if (typeof o.md !== "string" || !o.md || o.md.length > MAX_MARKDOWN_LENGTH) throw new InvalidObjectError("bad text");
    positive(o.w, "w");
    positive(o.size, "size");
    if (o.lineHeight !== undefined && !(Number.isFinite(o.lineHeight) && o.lineHeight >= 0.5 && o.lineHeight <= 5)) throw new InvalidObjectError("bad line height");
    if (o.tracking !== undefined && !(Number.isFinite(o.tracking) && o.tracking >= -0.5 && o.tracking <= 2)) throw new InvalidObjectError("bad letter spacing");
    if (o.assetId !== undefined && !HASH_RE.test(o.assetId)) throw new InvalidObjectError("bad font");
    if (o.align !== undefined && !(o.align === "center" || o.align === "right" || o.align === "justify")) throw new InvalidObjectError("bad alignment");
    if (o.autoWidth !== undefined && o.autoWidth !== true) throw new InvalidObjectError("bad auto width");
    if (!TEXT_COLOR_RE.test(o.color)) throw new InvalidObjectError(`bad color ${o.color}`);
    if (o.gradient !== undefined && !(typeof o.gradient === "object" && isPaint(o.gradient))) throw new InvalidObjectError("bad text gradient");
    if (o.outline !== undefined && !(TEXT_COLOR_RE.test(o.outline.c) && Number.isFinite(o.outline.w) && o.outline.w > 0 && o.outline.w <= 1)) throw new InvalidObjectError("bad text outline");
    if (o.card !== undefined && !(typeof o.card === "object" && o.card !== null && TEXT_COLOR_RE.test(o.card.fill) && Number.isFinite(o.card.pad) && o.card.pad >= 0 && o.card.pad <= 5 && Number.isFinite(o.card.radius) && o.card.radius >= 0 && o.card.radius <= 5)) throw new InvalidObjectError("bad text card");
    if (o.h !== undefined) positive(o.h, "h");
    if (o.valign !== undefined && !(o.valign === "middle" || o.valign === "bottom")) throw new InvalidObjectError("bad vertical alignment");
    if (o.paraGap !== undefined && !(Number.isFinite(o.paraGap) && o.paraGap >= 0 && o.paraGap <= 5)) throw new InvalidObjectError("bad paragraph space");
    if (o.indent !== undefined && !(Number.isFinite(o.indent) && o.indent >= 0 && o.indent <= 20)) throw new InvalidObjectError("bad indent");
    if (o.caps !== undefined && !(o.caps === "upper" || o.caps === "lower" || o.caps === "title" || o.caps === "small")) throw new InvalidObjectError("bad case");
    if (o.maxLines !== undefined && !(Number.isInteger(o.maxLines) && o.maxLines >= 1 && o.maxLines <= 10000)) throw new InvalidObjectError("bad line limit");
    if (o.kerning !== undefined && o.kerning !== true) throw new InvalidObjectError("bad kerning");
    if (o.features !== undefined && !(Array.isArray(o.features) && o.features.length <= 32 && o.features.every((f) => typeof f === "string" && /^[A-Za-z0-9 ]{4}$/.test(f)))) throw new InvalidObjectError("bad features");
    if (o.axes !== undefined && !(typeof o.axes === "object" && o.axes !== null && Object.keys(o.axes).length <= 8 && Object.entries(o.axes).every(([k, val]) => /^[A-Za-z0-9 ]{4}$/.test(k) && typeof val === "number" && Number.isFinite(val) && Math.abs(val) < 1e5))) throw new InvalidObjectError("bad axes");
    if (o.onPath !== undefined && !(Array.isArray(o.onPath.n) && o.onPath.n.length >= 12 && o.onPath.n.length % 6 === 0 && o.onPath.n.length <= 6 * 20000 && o.onPath.n.every((v) => Number.isFinite(v)) && typeof o.onPath.closed === "boolean")) throw new InvalidObjectError("bad text path");
  } else {
    throw new InvalidObjectError(`unknown kind ${(o as { kind: unknown }).kind}`);
  }
  return o;
}

export type SerializedObject = Record<string, unknown> & { id: string; kind: string; ax: string; ay: string };

/**
 * Stored form: the anchor and unit are local to the object's frame, and
 * `frame` names it (absent = the world frame, which is exactly the v0.8
 * absolute form, so old records stay valid). The frame's own record is
 * stored beside it (FrameSpace.records).
 */
export function serializeObject(o: CanvasObject): SerializedObject {
  const { anchor, frame, ...rest } = o;
  // `unit + 0` turns -0 (from negating zoom level 0) into 0, so stored and JSON forms agree.
  const s = { ...rest, unit: o.unit + 0, points: o.kind === "stroke" ? [...o.points] : undefined, sub: o.kind === "path" ? o.sub.map((p) => ({ n: [...p.n], closed: p.closed })) : undefined, ...(o.kind === "path" && o.base ? { base: o.base.map((p) => ({ n: [...p.n], closed: p.closed })) } : {}), ax: D.toString(anchor.x), ay: D.toString(anchor.y) } as SerializedObject;
  if (frame && frame !== frame.space.world) s["frame"] = frame.space.uidOf(frame);
  const tex = o.kind === "path" ? textureAsset(o.fill) : undefined;
  if (tex) (s as Record<string, unknown>)["assetId"] = tex; // (the "assetId" index of the store is what tells the library the picture is still used)
  return s;
}

/** The object in world-frame (absolute) form, serialized: for tests, archives of version 1 and debugging. */
export function serializeWorld(o: CanvasObject): SerializedObject {
  return serializeObject(worldForm(o));
}

/** `space` resolves `frame` ids; without it only world-frame (absolute) records are accepted. */
export function deserializeObject(s: SerializedObject, space?: FrameSpace): CanvasObject {
  let frame: Frame | undefined;
  if (s["frame"] !== undefined) {
    frame = typeof s["frame"] === "string" ? space?.frameByUid(s["frame"]) : undefined;
    if (!frame) throw new InvalidObjectError(`unknown frame ${String(s["frame"])}`);
  }
  const anchor = { x: D.parse(String(s.ax)), y: D.parse(String(s.ay)) };
  const base = {
    id: String(s.id),
    anchor,
    unit: s["unit"] as number,
    z: s["z"] as number,
    // Snapshots written before opacity existed are fully opaque.
    opacity: (s["opacity"] ?? 1) as number,
    attachmentTargetId: (s["attachmentTargetId"] ?? null) as ObjectId | null,
    ...(s["rot"] !== undefined ? { rot: s["rot"] as number } : {}),
    ...(s["parent"] !== undefined ? { parent: String(s["parent"]) } : {}),
    ...(s["constraint"] !== undefined ? { constraint: s["constraint"] as { h: "left"; v: "top" } } : {}),
    ...(s["groups"] !== undefined ? { groups: s["groups"] as string[] } : {}),
    ...(s["name"] !== undefined ? { name: s["name"] as string } : {}),
    ...(s["groupNames"] !== undefined ? { groupNames: s["groupNames"] as Record<string, string> } : {}),
    ...(s["boolOps"] !== undefined ? { boolOps: s["boolOps"] as Record<string, BoolOp> } : {}),
    ...(s["blend"] !== undefined ? { blend: s["blend"] as BlendMode } : {}),
    ...(Array.isArray(s["tags"]) && formatTags(s["tags"].filter((t): t is string => typeof t === "string")).length ? { tags: formatTags(s["tags"].filter((t): t is string => typeof t === "string")).slice(0, MAX_OBJECT_TAGS) } : {}), // tags stored in an older form are formatted (ADR 0084)
    ...(s["mask"] !== undefined ? { mask: { ...(s["mask"] as { by: string; mode: "alpha" }) } } : {}),
    ...(s["isMask"] === true ? { isMask: true as const } : {}),
    ...(s["hidden"] === true ? { hidden: true as const } : {}),
    ...(s["locked"] === true ? { locked: true as const } : {}),
    ...(frame && frame !== frame.space.world ? { frame } : {}),
  };
  let o: CanvasObject;
  if (s.kind === "stroke") {
    if (!Array.isArray(s["points"])) throw new InvalidObjectError("points missing");
    o = { ...base, kind: "stroke", points: s["points"] as number[], width: s["width"] as number, color: String(s["color"]) };
  } else if (s.kind === "image") {
    o = {
      ...base,
      kind: "image",
      assetId: String(s["assetId"]),
      w: s["w"] as number,
      h: s["h"] as number,
      pixelW: s["pixelW"] as number,
      pixelH: s["pixelH"] as number,
      ...(s["media"] !== undefined ? { media: s["media"] as MediaState } : {}),
      ...(s["crop"] !== undefined ? { crop: s["crop"] as Crop } : {}),
      ...(s["adjust"] !== undefined ? { adjust: s["adjust"] as Adjust } : {}),
      ...(s["radius"] !== undefined ? { radius: s["radius"] as number | number[] } : {}),
      ...(s["stroke"] !== undefined ? { stroke: s["stroke"] as string } : {}),
      ...(s["width"] !== undefined ? { width: s["width"] as number } : {}),
      ...(s["join"] !== undefined ? { join: s["join"] as Join } : {}),
      ...(s["cap"] !== undefined ? { cap: s["cap"] as Cap } : {}),
      ...(s["align"] !== undefined ? { align: s["align"] as Align } : {}),
      ...(s["dash"] !== undefined ? { dash: s["dash"] as [number, number] } : {}),
      ...(s["dashOffset"] !== undefined ? { dashOffset: s["dashOffset"] as number } : {}),
      ...(s["miterAngle"] !== undefined ? { miterAngle: s["miterAngle"] as number } : {}),
    };
  } else if (s.kind === "path") {
    if (!Array.isArray(s["sub"])) throw new InvalidObjectError("sub-paths missing");
    o = {
      ...base,
      kind: "path",
      sub: (s["sub"] as Array<{ n: number[]; closed: boolean }>).map((p) => ({ n: p?.n as number[], closed: p?.closed as boolean })),
      fill: (s["fill"] ?? null) as Paint | null,
      stroke: (s["stroke"] ?? null) as Paint | null,
      width: s["width"] as number,
      ...(s["join"] !== undefined ? { join: s["join"] as Join } : {}),
      ...(s["cap"] !== undefined ? { cap: s["cap"] as Cap } : {}),
      ...(s["align"] !== undefined ? { align: s["align"] as Align } : {}),
      ...(s["dash"] !== undefined ? { dash: s["dash"] as Dash } : {}),
      ...(s["dashOffset"] !== undefined ? { dashOffset: s["dashOffset"] as number } : {}),
      ...(s["profile"] !== undefined ? { profile: s["profile"] as WidthProfile } : {}),
      ...(s["net"] === true ? { net: true as const } : {}),
      ...(s["regions"] !== undefined ? { regions: s["regions"] as NonNullable<PathObject["regions"]> } : {}),
      ...(s["smoothing"] !== undefined ? { smoothing: s["smoothing"] as number } : {}),
      ...(s["miterAngle"] !== undefined ? { miterAngle: s["miterAngle"] as number } : {}),
      ...(s["arrowStart"] !== undefined ? { arrowStart: s["arrowStart"] as Arrow } : {}),
      ...(s["arrowEnd"] !== undefined ? { arrowEnd: s["arrowEnd"] as Arrow } : {}),
      ...(s["container"] !== undefined ? { container: s["container"] as NonNullable<PathObject["container"]> } : {}),
      ...(s["evenodd"] === true ? { evenodd: true as const } : {}),
      ...(s["shape"] !== undefined ? { shape: s["shape"] as ShapeKind } : {}),
      ...(s["params"] !== undefined ? { params: s["params"] as ShapeParams } : {}),
      ...(s["radius"] !== undefined ? { radius: s["radius"] as Radius } : {}),
      ...(s["initial"] !== undefined ? { initial: s["initial"] as InitialShape } : {}),
      ...(s["base"] !== undefined ? { base: (s["base"] as Array<{ n: number[]; closed: boolean }>).map((p) => ({ n: p?.n as number[], closed: p?.closed as boolean })) } : {}),
      ...(s["result"] !== undefined ? { result: s["result"] as string } : {}),
    };
  } else if (s.kind === "text") {
    // Imported or older text is stored in canonical form.
    o = { ...base, kind: "text", md: canonical(String(s["md"])), w: s["w"] as number, size: s["size"] as number, color: String(s["color"]), ...(s["lineHeight"] !== undefined ? { lineHeight: s["lineHeight"] as number } : {}), ...(s["tracking"] !== undefined ? { tracking: s["tracking"] as number } : {}), ...(s["assetId"] !== undefined ? { assetId: String(s["assetId"]) } : {}), ...(s["align"] !== undefined ? { align: s["align"] as "center" } : {}), ...(s["autoWidth"] === true ? { autoWidth: true as const } : {}), ...(s["gradient"] !== undefined ? { gradient: s["gradient"] as Gradient } : {}), ...(s["outline"] !== undefined ? { outline: s["outline"] as { c: string; w: number } } : {}), ...(s["card"] !== undefined ? { card: { ...(s["card"] as { fill: string; pad: number; radius: number }) } } : {}), ...(s["h"] !== undefined ? { h: s["h"] as number } : {}), ...(s["valign"] !== undefined ? { valign: s["valign"] as "middle" } : {}), ...(s["paraGap"] !== undefined ? { paraGap: s["paraGap"] as number } : {}), ...(s["indent"] !== undefined ? { indent: s["indent"] as number } : {}), ...(s["caps"] !== undefined ? { caps: s["caps"] as "upper" } : {}), ...(s["maxLines"] !== undefined ? { maxLines: s["maxLines"] as number } : {}), ...(s["kerning"] === true ? { kerning: true as const } : {}), ...(s["features"] !== undefined ? { features: [...(s["features"] as string[])] } : {}), ...(s["axes"] !== undefined ? { axes: { ...(s["axes"] as Record<string, number>) } } : {}), ...(s["onPath"] !== undefined ? { onPath: { n: [...((s["onPath"] as { n: number[] }).n ?? [])], closed: (s["onPath"] as { closed: boolean }).closed } } : {}) };
  } else {
    throw new InvalidObjectError(`unknown kind ${s.kind}`);
  }
  return validateObject(o);
}

function extentLog2(o: CanvasObject): number {
  const b = localBounds(o);
  const ext = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  if (!(ext > 0)) return 0;
  let k = Math.ceil(Math.log2(ext));
  if (2 ** k < ext) k++; // log2 rounding just below an integer
  return k;
}

function inFrame(o: CanvasObject, f: Frame, anchor: WorldPoint, unit: number): CanvasObject {
  const { frame: _frame, ...rest } = o;
  // (the shape saved as the initial one is in the same units as the object: it moves up or down with them)
  const kept = o.kind === "path" && o.initial ? { initial: { ...o.initial, unit: o.initial.unit + (unit - o.unit) } } : {};
  return (f === f.space.world ? { ...rest, ...kept, anchor, unit } : { ...rest, ...kept, frame: f, anchor, unit }) as CanvasObject;
}

/**
 * The object in the frame that suits its size and position (core/frames.ts
 * `rehome`), exactly: its world geometry does not change by a single bit.
 * Objects in the world frame carry no `frame`.
 */
export function homeObject(o: CanvasObject, space: FrameSpace): CanvasObject {
  const f = o.frame ?? space.world;
  const pl = rehome(space, { f, anchor: o.anchor, unit: o.unit }, extentLog2(o));
  return pl.f === f ? o : inFrame(o, pl.f, pl.anchor, pl.unit);
}

export const MAX_WORLD_FORM_LEVELS = 2 ** 24;

/** The object in world-frame (absolute) form, exactly. Costs about the anchor's absolute size in bits. */
export function worldForm(o: CanvasObject): CanvasObject {
  const f = o.frame;
  if (!f) return o;
  const w = f.space.world;
  const levels = levelsBetween(w, f);
  // Absolute form: the anchor is a number of ~levels bits, so this is only for tests, debugging and version 1 archives (storage holds frames).
  if (Math.abs(levels) > MAX_WORLD_FORM_LEVELS) throw new RangeError("objects deeper than 2^24 levels cannot be saved until storage holds frames");
  return inFrame(o, w, expressExactIn(f.space, f, o.anchor, w), o.unit - levels);
}

/** The object expressed exactly in frame `f` (for comparing objects of different frames; cost: the path between them). */
export function expressObjectIn(o: CanvasObject, f: Frame): CanvasObject {
  const g = o.frame ?? f.space.world;
  if (g === f) return o;
  return inFrame(o, f, expressExactIn(f.space, g, o.anchor, f), o.unit + levelsBetween(g, f));
}
