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
import { BLOCK_GAP, LINE_HEIGHT, layoutOf } from "./layout";

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
  /** A set height in screen px at the zoom it is read or applied at, like a size; null = as tall as the words. */
  readonly heightPx?: number | null;
  /** Where the words sit in a set height. */
  readonly valign?: "top" | "middle" | "bottom";
  /** Space between paragraphs in em. */
  readonly paraGap?: number;
  /** How far the first line of a paragraph starts in, in em. */
  readonly indent?: number;
  /** A change of case; null = none. */
  readonly caps?: "upper" | "lower" | "title" | "small" | null;
  /** At most this many lines; null = all. */
  readonly maxLines?: number | null;
  /** Kerning of the font between letters. */
  readonly kerning?: boolean;
  /** OpenType feature tags that are on. */
  readonly features?: readonly string[];
  /** The values of the axes of a variable font; null = the font's own defaults. */
  readonly axes?: Readonly<Record<string, number>> | null;
}

/** Feature tags and axis values kept tidy: sorted, no repeats, finite numbers, a few of them. */
const tidyFeatures = (f: readonly string[]): string[] => [...new Set(f.filter((t) => /^[A-Za-z0-9 ]{4}$/.test(t)))].sort().slice(0, 32);
const tidyAxes = (a: Readonly<Record<string, number>>): Record<string, number> => Object.fromEntries(Object.entries(a).filter(([k, v]) => /^[A-Za-z0-9 ]{4}$/.test(k) && Number.isFinite(v)).sort(([x], [y]) => x.localeCompare(y)).slice(0, 8));

/** Size of a new text, in screen px. */
export const NEW_TEXT_PX = 16;

export const LOOK_LIMITS = { sizePx: [1, 2000], lineHeight: [0.5, 5], tracking: [-0.5, 2], paraGap: [0, 5], indent: [0, 20] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v));

/** The look of a text at a zoom (`ppu`: screen px per local unit of the text, 0 when unknown: then there is no size). */
export function lookOf(o: TextObject, ppu: number): Required<Omit<TextLook, "sizePx" | "heightPx">> & { sizePx: number | null; heightPx: number | null } {
  return {
    sizePx: ppu > 0 && ppu < Infinity ? o.size * ppu : null,
    heightPx: o.h !== undefined && ppu > 0 && ppu < Infinity ? o.h * ppu : null,
    valign: o.valign ?? "top",
    paraGap: o.paraGap ?? BLOCK_GAP,
    indent: o.indent ?? 0,
    caps: o.caps ?? null,
    maxLines: o.maxLines ?? null,
    kerning: o.kerning === true,
    features: o.features ?? [],
    axes: o.axes ?? null,
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
    heightPx: null,
    valign: look.valign ?? "top",
    paraGap: look.paraGap ?? BLOCK_GAP,
    indent: look.indent ?? 0,
    caps: look.caps ?? null,
    maxLines: look.maxLines ?? null,
    kerning: look.kerning === true,
    features: look.features ?? [],
    axes: look.axes ?? null,
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
  const { lineHeight: _l, tracking: _t, align: _a, autoWidth: _f, assetId: _i, gradient: _g, outline: _ol, h: _h, valign: _v, paraGap: _pg, indent: _in, caps: _c, maxLines: _ml, kerning: _k, features: _fe, axes: _ax, ...rest } = o;
  const lineHeight = look.lineHeight !== undefined ? clamp(look.lineHeight, LOOK_LIMITS.lineHeight) : o.lineHeight;
  const tracking = look.tracking !== undefined ? clamp(look.tracking, LOOK_LIMITS.tracking) : o.tracking;
  const align = look.align !== undefined ? look.align : o.align;
  const autoWidth = look.autoWidth !== undefined ? look.autoWidth : o.autoWidth === true;
  const assetId = look.assetId !== undefined ? (look.assetId ?? undefined) : o.assetId;
  const gradient = look.gradient !== undefined ? (look.gradient ?? undefined) : o.gradient;
  const outline = look.outline !== undefined ? (look.outline ?? undefined) : o.outline;
  let h = o.h;
  if (look.heightPx === null) h = undefined;
  else if (look.heightPx !== undefined && ppu > 0 && ppu < Infinity) h = look.heightPx / ppu;
  const valign = look.valign !== undefined ? look.valign : o.valign;
  const paraGap = look.paraGap !== undefined ? clamp(look.paraGap, LOOK_LIMITS.paraGap) : o.paraGap;
  const indent = look.indent !== undefined ? clamp(look.indent, LOOK_LIMITS.indent) : o.indent;
  const caps = look.caps !== undefined ? (look.caps ?? undefined) : o.caps;
  const kerning = look.kerning !== undefined ? look.kerning : o.kerning === true;
  const features = look.features !== undefined ? tidyFeatures(look.features) : o.features;
  const axes = look.axes !== undefined ? (look.axes === null ? undefined : tidyAxes(look.axes)) : o.axes;
  const maxLines = look.maxLines !== undefined ? (look.maxLines === null ? undefined : Math.max(1, Math.round(look.maxLines))) : o.maxLines;
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
    ...(h !== undefined ? { h } : {}),
    ...(h !== undefined && valign && valign !== "top" ? { valign } : {}),
    ...(paraGap !== undefined && paraGap !== BLOCK_GAP ? { paraGap } : {}),
    ...(indent ? { indent } : {}),
    ...(caps ? { caps } : {}),
    ...(maxLines !== undefined ? { maxLines } : {}),
    ...(kerning ? { kerning: true as const } : {}),
    ...(features && features.length ? { features } : {}),
    ...(axes && Object.keys(axes).length ? { axes } : {}),
  };
  next = fitWidth(next);
  return look.sizePx !== undefined ? (normalizeUnit(next) as TextObject) : next;
}

export const sameLook = (a: TextObject, b: TextObject): boolean =>
  a.size === b.size && a.w === b.w && a.color === b.color && a.assetId === b.assetId && a.lineHeight === b.lineHeight && a.tracking === b.tracking && a.align === b.align && a.autoWidth === b.autoWidth && JSON.stringify(a.gradient) === JSON.stringify(b.gradient) && JSON.stringify(a.outline) === JSON.stringify(b.outline) && a.h === b.h && a.valign === b.valign && a.paraGap === b.paraGap && a.indent === b.indent && a.caps === b.caps && a.maxLines === b.maxLines && a.kerning === b.kerning && JSON.stringify(a.features) === JSON.stringify(b.features) && JSON.stringify(a.axes) === JSON.stringify(b.axes);

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
  const paraGap = num("paraGap"), indent = num("indent");
  const caps = r["caps"], valign = r["valign"], maxLines = r["maxLines"];
  if (paraGap === null || indent === null) return null;
  if (caps !== undefined && !(caps === "upper" || caps === "lower" || caps === "title" || caps === "small")) return null;
  if (valign !== undefined && !(valign === "top" || valign === "middle" || valign === "bottom")) return null;
  if (maxLines !== undefined && !(typeof maxLines === "number" && Number.isInteger(maxLines) && maxLines >= 1 && maxLines <= 10000)) return null;
  const kerning = r["kerning"], features = r["features"], axes = r["axes"];
  if (kerning !== undefined && typeof kerning !== "boolean") return null;
  if (features !== undefined && !(Array.isArray(features) && features.every((t) => typeof t === "string" && /^[A-Za-z0-9 ]{4}$/.test(t)))) return null;
  if (axes !== undefined && !(typeof axes === "object" && axes !== null && Object.entries(axes).every(([k, v]) => /^[A-Za-z0-9 ]{4}$/.test(k) && typeof v === "number" && Number.isFinite(v)))) return null;
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
    ...(paraGap !== undefined ? { paraGap } : {}),
    ...(indent !== undefined ? { indent } : {}),
    ...(caps !== undefined ? { caps: caps as "upper" } : {}),
    ...(valign !== undefined ? { valign: valign as "top" } : {}),
    ...(maxLines !== undefined ? { maxLines: maxLines as number } : {}),
    ...(kerning !== undefined ? { kerning: kerning as boolean } : {}),
    ...(features !== undefined ? { features: tidyFeatures(features as string[]) } : {}),
    ...(axes !== undefined ? { axes: tidyAxes(axes as Record<string, number>) } : {}),
    ...(gradient !== undefined ? { gradient: gradient as Gradient } : {}),
    ...(outline !== undefined ? { outline: { c: outline.c as string, w: outline.w as number } } : {}),
  };
  return Object.keys(out).length ? out : null;
}

/** The part of a look a saved style keeps (everything but the width mode, and a size only when it is known). */
export function styleOf(look: ReturnType<typeof lookOf>): TextLook {
  return { ...(look.sizePx !== null ? { sizePx: Math.round(look.sizePx * 100) / 100 } : {}), lineHeight: look.lineHeight, tracking: look.tracking, align: look.align, color: look.color, ...(look.assetId ? { assetId: look.assetId } : {}), ...(look.gradient ? { gradient: look.gradient } : {}), ...(look.outline ? { outline: look.outline } : {}), paraGap: look.paraGap, indent: look.indent, ...(look.caps ? { caps: look.caps } : {}), valign: look.valign, ...(look.maxLines !== null ? { maxLines: look.maxLines } : {}), ...(look.kerning ? { kerning: true } : {}), ...(look.features.length ? { features: look.features } : {}), ...(look.axes ? { axes: look.axes } : {}) };
}
