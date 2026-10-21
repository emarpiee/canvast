/**
 * The canvas's objects on a page (ADR 0166). A page pixel is a world unit of the canvas at zoom 0, so a shape, a path, a text or a
 * picture on a page is an ordinary canvas object at the page's origin, in the world frame, and is drawn by the canvas's own renderer
 * (`drawObjects`) through a camera made from the Painting view's placement. Fills, outlines, gradients, textures, adjustments, fonts and
 * pictures are therefore the canvas's, exactly; nothing of them is written again here. Objects are kept as the canvas stores them
 * (`SerializedObject`), so they are checked by the canvas's own reader when a layer is loaded.
 */
import * as D from "../core/dyadic";
import { lookAt, type Camera, type Viewport, type WorldPoint } from "../core/camera";
import type { CanvasObject, ImageObject, PathObject, SerializedObject, TextObject } from "../doc/model";
import { deserializeObject, homeObject, newObjectId, serializeObject } from "../doc/model";
import { FrameSpace } from "../core/frames";
import { normalizeUnit, scaleAbout, translate, unionBounds } from "../doc/edit-ops";
import { drawnParams, drawnSubs, type ShapeKind } from "../doc/path";
import type { Paint } from "../doc/paint";
import { isBoolMember, isResult } from "../doc/boolean-group";
import { projectObject, type ProjectedObject } from "../render/projection";
import { drawObjects, type SceneTheme } from "../render/scene-renderer";
import type { AssetLibrary } from "../assets/asset-library";
import { generate, type Generator, type Values } from "../gen";
import { mapSubs } from "../doc/path";

/** The one frame space of every page: only its world frame is used (no endless zoom, so no other frame is ever needed). */
const SPACE = new FrameSpace();

/** What the canvas renderer needs to draw objects: the pictures (decoded by the library) and the theme's colours. */
export interface ObjectEnv {
  readonly assets: AssetLibrary;
  readonly theme: SceneTheme;
}

/** Where the page is drawn: target px = page px · scale + (x, y). */
export interface At {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

const cache = new WeakMap<readonly SerializedObject[], CanvasObject[]>();
/** The objects of a stored list, read by the canvas's reader (once per list); damaged ones are left out. */
export function objectsOf(list: readonly SerializedObject[]): CanvasObject[] {
  let out = cache.get(list);
  if (!out) {
    out = [];
    for (const s of list) {
      try {
        out.push(deserializeObject(s, SPACE));
      } catch {
        // (a damaged object is not drawn; the layer's check on load reports it)
      }
    }
    // (what the canvas draws of a boolean group is its result; the shapes it is made of are not drawn on their own, nor masks)
    out = out.filter((o) => (!isBoolMember(o) || isResult(o)) && !o.isMask).sort((a, b) => a.z - b.z);
    cache.set(list, out);
  }
  return out;
}

/** Whether every object of a list reads. */
export function validObjects(list: unknown): list is SerializedObject[] {
  if (!Array.isArray(list) || list.length === 0 || list.length > 10000) return false;
  try {
    for (const s of list) deserializeObject(s as SerializedObject, SPACE);
    return true;
  } catch {
    return false;
  }
}

export const stored = (objs: readonly CanvasObject[]): SerializedObject[] => objs.map((o) => serializeObject(o));

/** The canvas camera that puts page px (x, y) at target px (x·scale + at.x, y·scale + at.y) in a target of `vp`. */
export function cameraFor(at: At, vp: Viewport): Camera {
  const z = Math.log2(at.scale);
  const zi = Math.floor(z);
  const centre: WorldPoint = { x: D.fromNumber((vp.width / 2 - at.x) / at.scale), y: D.fromNumber((vp.height / 2 - at.y) / at.scale) };
  return lookAt(centre, zi, z - zi);
}

/** The objects projected for a target, as the canvas projects them (null ones, off the target, left out). */
export function projected(objs: readonly CanvasObject[], at: At, vp: Viewport): ProjectedObject[] {
  const cam = cameraFor(at, vp);
  return objs.map((o) => projectObject(o, cam, vp, { keepTiny: true })).filter((p): p is ProjectedObject => p !== null);
}

/** Draw objects into `g` (no transform), the canvas's way. True: a picture was not decoded yet (draw again soon). */
export function drawObjectsAt(g: CanvasRenderingContext2D, objs: readonly CanvasObject[], at: At, env: ObjectEnv): boolean {
  const vp: Viewport = { width: g.canvas.width, height: g.canvas.height };
  return drawObjects(g, projected(objs, at, vp), env.assets, vp, 1, env.theme);
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The objects' box in page px (null: none). */
export function boxOf(objs: readonly CanvasObject[]): Box | null {
  const b = objs.length ? unionBounds(objs) : null;
  if (!b) return null;
  const x = D.toNumber(b.min.x), y = D.toNumber(b.min.y);
  return { x, y, w: D.toNumber(b.max.x) - x, h: D.toNumber(b.max.y) - y };
}

export const moved = (objs: readonly CanvasObject[], dx: number, dy: number): CanvasObject[] => objs.map((o) => translate(o, D.fromNumber(dx), D.fromNumber(dy)));

/** Scaled about the page point (fx, fy). */
export function scaled(objs: readonly CanvasObject[], fx: number, fy: number, kx: number, ky: number): CanvasObject[] {
  const fixed = { x: D.fromNumber(fx), y: D.fromNumber(fy) };
  return objs.map((o) => scaleAbout(o, fixed, kx, ky));
}

/** Objects at a page px position and in page px units, kept well-conditioned as the canvas keeps its own. */
const home = <T extends CanvasObject>(o: T): T => homeObject(normalizeUnit(o), SPACE) as T;
const base = (x: number, y: number, z = 1) => ({ id: newObjectId(), anchor: { x: D.fromNumber(x), y: D.fromNumber(y) }, unit: 0, z, opacity: 1, attachmentTargetId: null });

/** A shape drawn from (x0, y0) to (x1, y1) in page px, as the canvas's Shape tool makes it (editable sides, points, corners). */
export function shapeObject(kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, look: { fill: Paint | null; stroke: Paint | null; width: number; sides: number; tips: number }): PathObject {
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  const bx = kind === "line" ? x0 - x : 0, by = kind === "line" ? y0 - y : 0;
  const bw = kind === "line" ? x1 - x0 : Math.abs(x1 - x0), bh = kind === "line" ? y1 - y0 : Math.abs(y1 - y0);
  const params = drawnParams(kind, bx, by, bw, bh, look.sides, look.tips);
  return home({
    ...base(x, y),
    kind: "path",
    sub: drawnSubs(kind, bx, by, bw, bh, look.sides, look.tips),
    ...(params ? { params } : {}),
    fill: kind === "line" ? null : look.fill,
    stroke: kind === "line" && look.stroke === null ? look.fill : look.stroke,
    width: Math.max(look.width, 1e-3),
    ...(kind === "rect" || kind === "polygon" || kind === "star" ? { join: "miter" as const } : {}),
    shape: kind,
  } as PathObject);
}

/** The page covered by a paint (a fill layer is this rectangle, drawn the canvas's way: colours, gradients and textures alike). */
export const fillObject = (paint: Paint, w: number, h: number): PathObject =>
  ({ ...base(0, 0), id: "fill", kind: "path", sub: drawnSubs("rect", 0, 0, w, h, 4, 5), fill: paint, stroke: null, width: 1, shape: "rect" }) as PathObject;

/** A line of text at (x, y), as wide as its words. */
export const textObject = (text: string, x: number, y: number, size: number, color: string): TextObject =>
  home({ ...base(x, y), kind: "text", md: text, w: size, size, color, autoWidth: true } as TextObject);

/** A picture of the library on the page: its pixels at one page px each, made smaller to fit 80 % of the page, centred. */
export function pictureObject(rec: { hash: string; pixelW: number; pixelH: number }, page: { w: number; h: number }): ImageObject {
  const k = Math.min(1, (0.8 * page.w) / rec.pixelW, (0.8 * page.h) / rec.pixelH);
  const w = rec.pixelW * k, h = rec.pixelH * k;
  return home({ ...base((page.w - w) / 2, (page.h - h) / 2), kind: "image", assetId: rec.hash, w, h, pixelW: rec.pixelW, pixelH: rec.pixelH } as ImageObject);
}

/** A pattern generator's shapes over the page (the canvas's Pattern panel makes the same shapes for a sheet). */
export function patternObjects(g: Generator, values: Values, seed: number, w: number, h: number): PathObject[] {
  return generate(g, values, seed, w, h).map((s, i) => home({ ...base(0, 0, i + 1), kind: "path", sub: mapSubs(s.sub, (x, y) => [x, y]), fill: s.fill, stroke: s.stroke, width: s.width, ...(s.evenodd ? { evenodd: true as const } : {}) } as PathObject));
}

/**
 * Objects brought from the canvas (pasted), at the size they were seen at when copied (`depth`: the zoom levels of that view), made
 * smaller to fit 80 % of the page and centred on it. They keep their look, ids made new.
 */
export function placeOnPage(objs: readonly CanvasObject[], depth: number, page: { w: number; h: number }): CanvasObject[] {
  const b = boxOf(objs);
  if (!b || !(b.w > 0 || b.h > 0)) return [...objs];
  const seen = 2 ** depth;
  const k = Math.min(seen, (0.8 * page.w) / Math.max(b.w, 1e-300), (0.8 * page.h) / Math.max(b.h, 1e-300));
  const s = scaled(objs, b.x, b.y, k, k);
  return moved(s, page.w / 2 - b.x - (b.w * k) / 2, page.h / 2 - b.y - (b.h * k) / 2).map((o) => home(o));
}

export const pageSpace = (): FrameSpace => SPACE;
