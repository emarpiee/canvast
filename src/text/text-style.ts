/**
 * The look of a text (ADR 0126): everything about how a text is set that is not its words. One place reads it off an object, applies it to
 * one, and keeps the stored form tidy (a default is never stored), so the options bar, the text tool, the editor and saved text styles
 * all go through the same code. A size is in screen px at the zoom it is read or applied at, like a corner radius.
 */
import type { TextObject } from "../doc/model";
import type { Gradient } from "../doc/paint";
import { isPaint } from "../doc/paint";
import { normalizeUnit } from "../doc/edit-ops";
import type { TextAlign } from "./layout";
import { LINE_HEIGHT, layoutOf } from "./layout";

export interface TextLook {
  readonly sizePx?: number;
  readonly lineHeight?: number;
  readonly tracking?: number;
  readonly align?: TextAlign;
  readonly autoWidth?: boolean;
  readonly color?: string;
  /** The font file (library asset hash); null = the bundled font. */
  readonly assetId?: string | null;
  /** A gradient the letters are filled with (instead of the colour); null = a plain colour. */
  readonly gradient?: Gradient | null;
  /** A line round the letters (colour and width in em); null = none. */
  readonly outline?: { readonly c: string; readonly w: number } | null;
}

/** Size of a new text, in screen px. */
export const NEW_TEXT_PX = 16;

export const LOOK_LIMITS = { sizePx: [1, 2000], lineHeight: [0.5, 5], tracking: [-0.5, 2] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v));

/** The look of a text at a zoom (`ppu`: screen px per local unit of the text, 0 when unknown: then there is no size). */
export function lookOf(o: TextObject, ppu: number): Required<Omit<TextLook, "sizePx">> & { sizePx: number | null } {
  return {
    sizePx: ppu > 0 && ppu < Infinity ? o.size * ppu : null,
    lineHeight: o.lineHeight ?? LINE_HEIGHT,
    tracking: o.tracking ?? 0,
    align: o.align ?? "left",
    autoWidth: o.autoWidth === true,
    color: o.color,
    assetId: o.assetId ?? null,
    gradient: o.gradient ?? null,
    outline: o.outline ?? null,
  };
}

/** What the Text tool shows and makes when nothing is being edited: the tool's look filled out with the defaults (and the pen colour). */
export function toolLook(look: TextLook, penColor: string): ReturnType<typeof lookOf> {
  return {
    sizePx: look.sizePx ?? NEW_TEXT_PX,
    lineHeight: look.lineHeight ?? LINE_HEIGHT,
    tracking: look.tracking ?? 0,
    align: look.align ?? "left",
    autoWidth: false,
    color: look.color ?? penColor,
    assetId: look.assetId ?? null,
    gradient: look.gradient ?? null,
    outline: look.outline ?? null,
  };
}

/** The width an auto-width text has: the widest line (kept in `w`, so bounds, picking and scaling need no special case). */
export function fitWidth(o: TextObject): TextObject {
  if (!o.autoWidth) return o;
  const w = layoutOf(o).width * o.size;
  return w > 0 && Number.isFinite(w) && w !== o.w ? { ...o, w } : o;
}

/** The text with the given look fields applied: values kept in range, defaults left out of the stored form, the width refitted. */
export function withLook(o: TextObject, look: TextLook, ppu = 0): TextObject {
  const { lineHeight: _l, tracking: _t, align: _a, autoWidth: _f, assetId: _i, gradient: _g, outline: _ol, ...rest } = o;
  const lineHeight = look.lineHeight !== undefined ? clamp(look.lineHeight, LOOK_LIMITS.lineHeight) : o.lineHeight;
  const tracking = look.tracking !== undefined ? clamp(look.tracking, LOOK_LIMITS.tracking) : o.tracking;
  const align = look.align !== undefined ? look.align : o.align;
  const autoWidth = look.autoWidth !== undefined ? look.autoWidth : o.autoWidth === true;
  const assetId = look.assetId !== undefined ? (look.assetId ?? undefined) : o.assetId;
  const gradient = look.gradient !== undefined ? (look.gradient ?? undefined) : o.gradient;
  const outline = look.outline !== undefined ? (look.outline ?? undefined) : o.outline;
  let next: TextObject = {
    ...rest,
    ...(look.color !== undefined ? { color: look.color } : {}),
    ...(look.sizePx !== undefined && ppu > 0 && ppu < Infinity ? { size: clamp(look.sizePx, LOOK_LIMITS.sizePx) / ppu } : {}),
    ...(lineHeight !== undefined && lineHeight !== LINE_HEIGHT ? { lineHeight } : {}),
    ...(tracking ? { tracking } : {}),
    ...(align && align !== "left" ? { align } : {}),
    ...(autoWidth ? { autoWidth: true as const } : {}),
    ...(assetId ? { assetId } : {}),
    ...(gradient ? { gradient } : {}),
    ...(outline ? { outline: { c: outline.c, w: clamp(outline.w, [0.001, 1]) } } : {}),
  };
  next = fitWidth(next);
  return look.sizePx !== undefined ? (normalizeUnit(next) as TextObject) : next;
}

export const sameLook = (a: TextObject, b: TextObject): boolean =>
  a.size === b.size && a.w === b.w && a.color === b.color && a.assetId === b.assetId && a.lineHeight === b.lineHeight && a.tracking === b.tracking && a.align === b.align && a.autoWidth === b.autoWidth && JSON.stringify(a.gradient) === JSON.stringify(b.gradient) && JSON.stringify(a.outline) === JSON.stringify(b.outline);

/**
 * A look kept as a saved style (a Styles kind): size, line height, letter spacing, alignment, colour, gradient and outline. The width mode is the text's own
 * (a style is applied to texts that are already as wide as they are), so it is not part of it. Null when `d` is not such data.
 */
export function cleanLook(d: unknown): TextLook | null {
  if (!d || typeof d !== "object") return null;
  const r = d as Record<string, unknown>;
  const num = (k: keyof typeof LOOK_LIMITS): number | undefined | null => {
    const v = r[k];
    if (v === undefined) return undefined;
    const [lo, hi] = LOOK_LIMITS[k];
    return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  };
  const sizePx = num("sizePx"), lineHeight = num("lineHeight"), tracking = num("tracking");
  const align = r["align"];
  const color = r["color"];
  const assetId = r["assetId"];
  if (assetId !== undefined && !(typeof assetId === "string" && /^[0-9a-f]{64}$/.test(assetId))) return null;
  const gradient = r["gradient"];
  if (gradient !== undefined && !(typeof gradient === "object" && gradient !== null && isPaint(gradient))) return null;
  const outline = r["outline"] as { c?: unknown; w?: unknown } | undefined;
  if (outline !== undefined && !(typeof outline === "object" && outline !== null && typeof outline.c === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(outline.c) && typeof outline.w === "number" && outline.w > 0 && outline.w <= 1)) return null;
  if (sizePx === null || lineHeight === null || tracking === null) return null;
  if (align !== undefined && !(align === "left" || align === "center" || align === "right" || align === "justify")) return null;
  if (color !== undefined && !(typeof color === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color))) return null;
  const out: TextLook = {
    ...(sizePx !== undefined ? { sizePx } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...(tracking !== undefined ? { tracking } : {}),
    ...(align !== undefined ? { align } : {}),
    ...(color !== undefined ? { color: color.toLowerCase() } : {}),
    ...(assetId !== undefined ? { assetId } : {}),
    ...(gradient !== undefined ? { gradient: gradient as Gradient } : {}),
    ...(outline !== undefined ? { outline: { c: outline.c as string, w: outline.w as number } } : {}),
  };
  return Object.keys(out).length ? out : null;
}

/** The part of a look a saved style keeps (everything but the width mode, and a size only when it is known). */
export function styleOf(look: ReturnType<typeof lookOf>): TextLook {
  return { ...(look.sizePx !== null ? { sizePx: Math.round(look.sizePx * 100) / 100 } : {}), lineHeight: look.lineHeight, tracking: look.tracking, align: look.align, color: look.color, ...(look.assetId ? { assetId: look.assetId } : {}), ...(look.gradient ? { gradient: look.gradient } : {}), ...(look.outline ? { outline: look.outline } : {}) };
}
