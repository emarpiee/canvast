import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import type { Frame, FrameSpace } from "../core/frames";
import { expressExactIn, levelsBetween, rehome } from "../core/frames";
import { layoutText } from "../text/layout";
import { MAX_MARKDOWN_LENGTH, canonical } from "../text/markdown";

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
  /** Explicit attachment target. Always null until attach is implemented. */
  readonly attachmentTargetId: ObjectId | null;
}

export interface StrokeObject extends ObjectBase {
  readonly kind: "stroke";
  /** Flat [x0, y0, x1, y1, ...] polyline in local units, relative to anchor. */
  readonly points: readonly number[];
  /** Stroke diameter in local units. */
  readonly width: number;
  readonly color: string;
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
}

export interface TextObject extends ObjectBase {
  readonly kind: "text";
  /** Canonical Markdown (text/markdown.ts); the anchor is the top-left corner. */
  readonly md: string;
  /** Wrap width in local units. */
  readonly w: number;
  /** Body font size (1 em) in local units. */
  readonly size: number;
  readonly color: string;
}

export type CanvasObject = StrokeObject | ImageObject | TextObject;

/** Margin around a text box (em) for italic overhang, bold and descenders past the line box. */
export const TEXT_PAD_EM = 0.25;

export interface LocalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function localBounds(o: CanvasObject): LocalBounds {
  if (o.kind === "image") return { minX: 0, minY: 0, maxX: o.w, maxY: o.h };
  if (o.kind === "text") {
    const l = layoutText(o.md, o.w / o.size);
    const p = TEXT_PAD_EM * o.size;
    return { minX: -p, minY: -p, maxX: l.width * o.size + p, maxY: l.height * o.size + p };
  }
  const p = o.points;
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
  if (o.attachmentTargetId !== null) throw new InvalidObjectError("attachment is not supported yet");
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
  } else if (o.kind === "text") {
    if (typeof o.md !== "string" || !o.md || o.md.length > MAX_MARKDOWN_LENGTH) throw new InvalidObjectError("bad text");
    positive(o.w, "w");
    positive(o.size, "size");
    if (!COLOR_RE.test(o.color)) throw new InvalidObjectError(`bad color ${o.color}`);
  } else {
    throw new InvalidObjectError(`unknown kind ${(o as { kind: unknown }).kind}`);
  }
  return o;
}

export type SerializedObject = Record<string, unknown> & { id: string; kind: string; ax: string; ay: string };

export function serializeObject(o: CanvasObject): SerializedObject {
  // Stored in world-frame form until storage holds frames (plan step 4).
  const w = worldForm(o);
  const { anchor, frame: _frame, ...rest } = w;
  // `unit + 0` turns -0 (from negating zoom level 0) into 0, so stored and JSON forms agree.
  return { ...rest, unit: w.unit + 0, points: w.kind === "stroke" ? [...w.points] : undefined, ax: D.toString(anchor.x), ay: D.toString(anchor.y) } as SerializedObject;
}

export function deserializeObject(s: SerializedObject): CanvasObject {
  const anchor = { x: D.parse(String(s.ax)), y: D.parse(String(s.ay)) };
  const base = {
    id: String(s.id),
    anchor,
    unit: s["unit"] as number,
    z: s["z"] as number,
    // Snapshots written before opacity existed are fully opaque.
    opacity: (s["opacity"] ?? 1) as number,
    attachmentTargetId: (s["attachmentTargetId"] ?? null) as ObjectId | null,
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
    };
  } else if (s.kind === "text") {
    // Imported or older text is stored in canonical form.
    o = { ...base, kind: "text", md: canonical(String(s["md"])), w: s["w"] as number, size: s["size"] as number, color: String(s["color"]) };
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
  return (f === f.space.world ? { ...rest, anchor, unit } : { ...rest, frame: f, anchor, unit }) as CanvasObject;
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
  // shortcut: storage is absolute until it holds frames (plan step 4); deeper, the anchor would be a number of ~levels bits.
  if (Math.abs(levels) > MAX_WORLD_FORM_LEVELS) throw new RangeError("objects deeper than 2^24 levels cannot be saved until storage holds frames");
  return inFrame(o, w, expressExactIn(f.space, f, o.anchor, w), o.unit - levels);
}

/** The object expressed exactly in frame `f` (for comparing objects of different frames; cost: the path between them). */
export function expressObjectIn(o: CanvasObject, f: Frame): CanvasObject {
  const g = o.frame ?? f.space.world;
  if (g === f) return o;
  return inFrame(o, f, expressExactIn(f.space, g, o.anchor, f), o.unit + levelsBetween(g, f));
}
