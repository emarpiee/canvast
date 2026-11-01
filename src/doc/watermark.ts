/**
 * A visible watermark on a picture: a text or a small picture (a logo) laid over it, placed anywhere on it, turned and see-through, and cut
 * to the picture's box. It is kept on the picture, so it moves, turns, copies and is deleted with it. Its place and size are fractions of the
 * picture's box (it follows a resize); the drawing is done by the stand-in objects made here (`watermarkObject`), so it is drawn by the
 * same code as a text or a picture.
 */
import * as D from "../core/dyadic";
import { TURN, angleFromRadians, radiansFromAngle } from "../core/angle";
import type { ImageObject, PathObject, TextObject } from "./model";
import { rectSubs } from "./path";
import { layoutOf } from "../text/layout";
import { serialize } from "../text/markdown";

export interface Watermark {
  /** The words (one line or more); absent for a picture. */
  readonly text?: string;
  /** The colour of the words. */
  readonly color?: string;
  readonly bold?: true;
  /** A picture: a PNG as a data URL (at most `LOGO_MAX_PX` on its longer side, kept here so it needs no library file) and its size. */
  readonly logo?: { readonly src: string; readonly w: number; readonly h: number };
  /** The centre, as a fraction of the picture's width and height (0 to 1 is on the picture; it may go past, and is cut). */
  readonly x: number;
  readonly y: number;
  /** Width as a fraction of the picture's width. */
  readonly size: number;
  /** Turn in degrees, clockwise. */
  readonly turn: number;
  /** 0.05 to 1. */
  readonly opacity: number;
  /** Height ÷ width of the watermark (the words as laid out, or the logo). */
  readonly ar: number;
  /** The words' width in em (so the font size follows from `size`). */
  readonly em?: number;
}

export const LOGO_MAX_PX = 512;
export const MAX_WATERMARK_TEXT = 500;
const LOGO_MAX_CHARS = 3_000_000;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const fin = (v: unknown, lo: number, hi: number): boolean => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** Whether `w` is a watermark as stored (anything else is refused, so a damaged or hostile file cannot slip one in). */
export function validWatermark(w: unknown): w is Watermark {
  if (!w || typeof w !== "object") return false;
  const m = w as Record<string, unknown>;
  const text = typeof m["text"] === "string" && m["text"].length > 0 && m["text"].length <= MAX_WATERMARK_TEXT;
  const l = m["logo"] as Record<string, unknown> | undefined;
  const logo = !!l && typeof l === "object" && typeof l["src"] === "string" && l["src"].startsWith("data:image/png;base64,") && l["src"].length <= LOGO_MAX_CHARS && Number.isInteger(l["w"]) && Number.isInteger(l["h"]) && fin(l["w"], 1, LOGO_MAX_PX) && fin(l["h"], 1, LOGO_MAX_PX);
  if (text === logo) return false; // (one or the other)
  if (text && !(typeof m["color"] === "string" && HEX.test(m["color"]) && fin(m["em"], 1e-6, 1e6))) return false;
  if (m["bold"] !== undefined && m["bold"] !== true) return false;
  return fin(m["x"], -10, 11) && fin(m["y"], -10, 11) && fin(m["size"], 1e-4, 100) && fin(m["turn"], -360, 360) && fin(m["opacity"], 0.05, 1) && fin(m["ar"], 1e-6, 1e6);
}

/** Markdown of plain words: each line a paragraph, bold or not. */
const mdOf = (text: string, bold: boolean): string => serialize(text.split("\n").map((line) => ({ type: "p" as const, spans: line ? [{ text: line, bold, italic: false }] : [] })));

/** The words' width in em and their height ÷ width, as the bundled font lays them out (kept on the watermark). */
export function textMetrics(text: string, bold: boolean): { em: number; ar: number } {
  const l = layoutOf({ kind: "text", md: mdOf(text, bold), size: 1, w: 1, autoWidth: true, color: "#000000" } as TextObject);
  const em = Math.max(l.width, 1e-3);
  return { em, ar: Math.max(l.height, 1e-3) / em };
}

/** The watermark's box in the picture's local units: its centre, width, height, and its own turn in radians. */
export function watermarkBox(o: ImageObject, wm: Watermark = o.watermark!): { cx: number; cy: number; w: number; h: number; angle: number } {
  const w = wm.size * o.w;
  return { cx: wm.x * o.w, cy: wm.y * o.h, w, h: w * wm.ar, angle: (wm.turn * Math.PI) / 180 };
}

/** A picture-local point as an offset from the picture's anchor, the picture's own turn (about its centre) applied. */
function turned(o: ImageObject, x: number, y: number): [number, number] {
  if (!o.rot) return [x, y];
  const a = radiansFromAngle(o.rot), c = Math.cos(a), s = Math.sin(a);
  const px = o.w / 2, py = o.h / 2;
  return [px + c * (x - px) - s * (y - py), py + s * (x - px) + c * (y - py)];
}

const shifted = (o: ImageObject, dx: number, dy: number): ImageObject["anchor"] => ({ x: D.add(o.anchor.x, D.shift(D.fromNumber(dx), o.unit)), y: D.add(o.anchor.y, D.shift(D.fromNumber(dy), o.unit)) });

const angleOf = (rad: number): number | undefined => {
  const a = ((angleFromRadians(rad) % TURN) + TURN) % TURN;
  return a === 0 ? undefined : a;
};

/**
 * The watermark as an object of its own, where it is drawn: a text set in the bundled font, or a picture (its `assetId` is the logo's key,
 * `wm:` and the start of its data). It carries the picture's id, frame and unit: a click on it picks the picture.
 */
export function watermarkObject(o: ImageObject): TextObject | ImageObject | null {
  const wm = o.watermark;
  if (!wm) return null;
  const b = watermarkBox(o, wm);
  const [cx, cy] = turned(o, b.cx, b.cy);
  const rot = angleOf((o.rot ? radiansFromAngle(o.rot) : 0) + b.angle);
  const base = { id: o.id, anchor: shifted(o, cx - b.w / 2, cy - b.h / 2), unit: o.unit, z: o.z, opacity: o.opacity * wm.opacity, attachmentTargetId: null, ...(o.frame ? { frame: o.frame } : {}), ...(rot !== undefined ? { rot } : {}), ...(o.blend ? { blend: o.blend } : {}) };
  if (wm.logo) return { ...base, kind: "image", assetId: logoKey(wm.logo.src), w: b.w, h: b.h, pixelW: wm.logo.w, pixelH: wm.logo.h } as ImageObject;
  const size = b.w / wm.em!;
  return { ...base, kind: "text", md: mdOf(wm.text!, !!wm.bold), size, w: b.w, autoWidth: true, color: wm.color! } as TextObject;
}

/** The picture's box as a shape (its corners rounded as the picture's are): what the watermark is cut to. */
export function watermarkClip(o: ImageObject): PathObject {
  return {
    id: o.id, kind: "path", anchor: o.anchor, unit: o.unit, z: o.z, opacity: 1, attachmentTargetId: null, sub: rectSubs(0, 0, o.w, o.h), fill: "#000000", stroke: null, width: 1e-9,
    ...(o.frame ? { frame: o.frame } : {}), ...(o.rot ? { rot: o.rot } : {}), ...(typeof o.radius === "number" ? { radius: o.radius } : {}),
  } as PathObject;
}

/** A short key for a logo's decoded picture (the data itself is the identity; this is only for the cache). */
export function logoKey(src: string): string {
  let h = 2166136261;
  for (let i = 0; i < src.length; i += Math.max(1, Math.floor(src.length / 4096))) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return `wm:${src.length}:${(h >>> 0).toString(16)}`;
}

/** The place, size and turn of a watermark in picture-local units back to the fractions it is kept as. */
export function placed(o: ImageObject, wm: Watermark, cx: number, cy: number, w: number, angle: number): Watermark {
  const turn = ((((angle * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
  return { ...wm, x: cx / o.w, y: cy / o.h, size: Math.max(1e-4, Math.min(100, w / o.w)), turn: Math.round(turn * 100) / 100 };
}

/** A new watermark in the middle of the picture, half its width. */
export function newWatermark(content: { text: string; color: string; bold?: boolean } | { logo: { src: string; w: number; h: number } }): Watermark {
  const where = { x: 0.5, y: 0.5, size: 0.5, turn: 0, opacity: 0.5 };
  if ("logo" in content) return { ...where, logo: content.logo, ar: content.logo.h / content.logo.w };
  const m = textMetrics(content.text, !!content.bold);
  return { ...where, text: content.text, color: content.color, ...(content.bold ? { bold: true as const } : {}), em: m.em, ar: m.ar };
}
