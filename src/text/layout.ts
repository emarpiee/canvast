import type { TextObject } from "../doc/model";
import type { Font } from "./font";
import type { BlockType } from "./markdown";
import { parse } from "./markdown";
import { fontFor, onFontsChange, setBundledFont } from "./fonts";

/**
 * Text layout, independent of the browser: greedy word wrap with advances
 * from the bundled font (kerning off, no ligatures), so line breaks and the
 * object's bounds are identical on every device. Characters the font lacks
 * are drawn with a system font; their advance comes from an injectable
 * measurement (the browser's, in the app), so only text using them may lay
 * out slightly differently between systems.
 *
 * All values are in em of the body size, relative to the object's top-left,
 * y down.
 */

export interface PlacedGlyph {
  readonly cp: number;
  /** Glyph id in the bundled font, or 0 when a system font draws it. */
  readonly gid: number;
  readonly x: number;
  readonly adv: number;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Size as a multiple of the line's (a range with its own size); absent = 1. */
  readonly k?: number;
  /** A colour of its own; absent = the text's. */
  readonly color?: string;
  readonly under?: true;
  readonly strike?: true;
}

/** A line under or through a run of glyphs, in em of the body size from the object's left, with the size and colour of the run. */
export interface Deco {
  readonly kind: "under" | "strike";
  readonly x0: number;
  readonly x1: number;
  readonly k: number;
  readonly color?: string;
}

/** Where a decoration sits and how thick it is, in em of the run's own size: below the baseline, and above it. */
export const DECO = { underOffset: 0.12, strikeOffset: 0.28, thick: 0.06 } as const;

/** The size of a glyph in em of the body size: its line's (headings) times its own range's. */
export const glyphScale = (line: Line, g: PlacedGlyph): number => line.scale * (g.k ?? 1);

export interface Line {
  readonly top: number;
  readonly bottom: number;
  readonly baseline: number;
  /** Font size of this line in em of the body size (headings are larger). */
  readonly scale: number;
  readonly glyphs: readonly PlacedGlyph[];
  readonly decos: readonly Deco[];
}

export interface TextLayout {
  readonly lines: readonly Line[];
  readonly width: number;
  readonly height: number;
}

/** Horizontal alignment of the lines (absent on an object = left). Justify spreads the spaces of every line but the last of a paragraph. */
export type TextAlign = "left" | "center" | "right" | "justify";

/** What besides the words changes the layout. */
export interface TextStyle {
  readonly lineHeight?: number;
  readonly tracking?: number;
  readonly align?: TextAlign;
  /** The font file (a library asset's hash) the text is set in; absent = the bundled font. */
  readonly assetId?: string;
}

export const LINE_HEIGHT = 1.3;
export const BLOCK_GAP = 0.6;
export const ITEM_GAP = 0.2;
export const LIST_INDENT = 1.5;
export const BLOCK_SCALE: Record<BlockType, number> = { p: 1, h1: 2, h2: 1.5, h3: 1.25, ul: 1, ol: 1 };

/** Advance in em of a character the bundled font lacks. */
let fallbackAdvance: (cp: number) => number = () => 0.6;
const cache = new Map<string, TextLayout>();
const CACHE_MAX = 256;

onFontsChange(() => cache.clear());

export function setFont(f: Font): void {
  setBundledFont(f);
}

export function setFallbackMeasure(fn: (cp: number) => number): void {
  fallbackAdvance = fn;
  cache.clear();
}

/** The bundled font (a text's own font is `fontFor(o.assetId)`). */
export function textFont(): Font {
  return fontFor();
}

export function layoutText(md: string, wrapEm: number, style: TextStyle = {}): TextLayout {
  const { lineHeight = LINE_HEIGHT, tracking = 0, align = "left", assetId } = style;
  const key = `${wrapEm}|${lineHeight}|${tracking}|${align}|${assetId ?? ""}|${md}`;
  let l = cache.get(key);
  if (!l) {
    if (cache.size >= CACHE_MAX) cache.clear();
    l = compute(md, wrapEm, lineHeight, tracking, align, assetId);
    cache.set(key, l);
  }
  return l;
}

/** The layout of a text object: the one place that knows how its fields (width, auto width, line height, letter spacing, alignment) shape it. */
export function layoutOf(o: TextObject): TextLayout {
  return layoutText(o.md, o.autoWidth ? Infinity : o.w / o.size, o);
}

interface Ch {
  cp: number;
  bold: boolean;
  italic: boolean;
  k: number;
  color: string | undefined;
  under: boolean;
  strike: boolean;
}

function compute(md: string, wrapEm: number, lineHeight: number, tracking: number, align: TextAlign, assetId: string | undefined): TextLayout {
  const f = fontFor(assetId);
  const upm = f.unitsPerEm;
  const advance = (cp: number): { gid: number; adv: number } => {
    const gid = f.glyphId(cp);
    return { gid, adv: (gid ? f.glyph(gid).advance / upm : fallbackAdvance(cp)) + tracking };
  };
  const lines: Line[] = [];
  let width = Number.isFinite(wrapEm) ? wrapEm : 0;
  let y = 0;
  const blocks = parse(md);
  let n = 0;
  blocks.forEach((b, bi) => {
    const s = BLOCK_SCALE[b.type];
    const list = b.type === "ul" || b.type === "ol";
    const indent = list ? LIST_INDENT : 0;
    n = b.type === "ol" && blocks[bi - 1]?.type === "ol" ? n + 1 : 1;
    const avail = wrapEm - indent;
    const chars: Ch[] = [];
    for (const sp of b.spans) for (const c of sp.text) chars.push({ cp: c.codePointAt(0)!, bold: sp.bold, italic: sp.italic, k: sp.scale ?? 1, color: sp.color, under: sp.underline === true, strike: sp.strike === true });
    let line: Array<Ch & { gid: number; adv: number }> = [];
    let first = true;
    const emit = (glyphs: typeof line, last = false): void => {
      // A line is as tall as its biggest range (a line of small text is small); an empty line is the block's.
      const big = glyphs.filter((g) => g.cp !== 32).reduce((m, g) => Math.max(m, g.k), 0) || 1;
      const lh = lineHeight * s * big;
      const placed: PlacedGlyph[] = [];
      if (first && list) {
        let mx = 0.4;
        for (const c of b.type === "ul" ? "•" : `${n}.`) {
          const a = advance(c.codePointAt(0)!);
          placed.push({ cp: c.codePointAt(0)!, gid: a.gid, x: mx, adv: a.adv, bold: false, italic: false });
          mx += a.adv;
        }
      }
      let x = indent;
      for (const g of glyphs) {
        placed.push({ cp: g.cp, gid: g.gid, x, adv: g.adv * s, bold: g.bold, italic: g.italic, ...(g.k !== 1 ? { k: g.k } : {}), ...(g.color ? { color: g.color } : {}), ...(g.under ? { under: true as const } : {}), ...(g.strike ? { strike: true as const } : {}) });
        x += g.adv * s;
      }
      if (align === "justify" && !last && Number.isFinite(wrapEm)) x = justify(placed, glyphs.length, indent, wrapEm);
      width = Math.max(width, x);
      const content = ((f.ascender - f.descender) / upm) * s * big;
      lines.push({ top: y, bottom: y + lh, baseline: y + (lh - content) / 2 + (f.ascender / upm) * s * big, scale: s, glyphs: placed, decos: [] });
      y += lh;
      first = false;
    };
    let x = 0;
    let lastSpace = -1;
    for (const c of chars) {
      if (c.cp < 32) continue;
      const a = advance(c.cp);
      const adv = a.adv * c.k * s;
      if (c.cp !== 32 && x + adv > avail && line.some((g) => g.cp !== 32)) {
        const carry = lastSpace >= 0 ? line.slice(lastSpace + 1) : [];
        emit(lastSpace >= 0 ? line.slice(0, lastSpace) : line);
        line = carry;
        x = carry.reduce((t, g) => t + g.adv * s, 0);
        lastSpace = -1;
      }
      if (c.cp === 32) lastSpace = line.length;
      line.push({ ...c, gid: a.gid, adv: a.adv * c.k });
      x += adv;
    }
    emit(line, true);
    const next = blocks[bi + 1];
    if (next) y += list && next.type === b.type ? ITEM_GAP : BLOCK_GAP;
  });
  if (align === "center" || align === "right") {
    // The width the lines align in: the set width, or (no wrapping) the widest line.
    const W = Number.isFinite(wrapEm) ? Math.max(wrapEm, width) : width;
    lines.forEach((ln, i) => {
      const end = ln.glyphs.reduce((m, g) => Math.max(m, g.x + g.adv), 0);
      const d = align === "center" ? (W - end) / 2 : W - end;
      if (d > 0) lines[i] = { ...ln, glyphs: ln.glyphs.map((g) => ({ ...g, x: g.x + d })) };
    });
  }
  return { lines: lines.map(withDecos), width, height: Math.max(y, lineHeight) };
}

/** The lines under and through the runs of glyphs that ask for them (a run: neighbours with the same kind, size and colour), at the final places. */
function withDecos(line: Line): Line {
  const decos: Deco[] = [];
  for (const kind of ["under", "strike"] as const) {
    let run: { x0: number; x1: number; k: number; color: string | undefined } | null = null;
    const end = (): void => {
      if (run) decos.push({ kind, x0: run.x0, x1: run.x1, k: run.k, ...(run.color ? { color: run.color } : {}) });
      run = null;
    };
    for (const g of line.glyphs) {
      const on = (kind === "under" ? g.under : g.strike) === true;
      const k = g.k ?? 1;
      if (!on || (run && (run.k !== k || run.color !== g.color))) end();
      if (!on) continue;
      if (run) run.x1 = g.x + g.adv;
      else run = { x0: g.x, x1: g.x + g.adv, k, color: g.color };
    }
    end();
  }
  return decos.length ? { ...line, decos } : line;
}

/** Spread the spaces of a line so it ends at the wrap width; returns where it ends. `n` words' glyphs follow any list marker in `placed`. */
function justify(placed: PlacedGlyph[], n: number, indent: number, wrapEm: number): number {
  const from = placed.length - n;
  const spaces = placed.slice(from).filter((g) => g.cp === 32).length;
  const end = placed.length ? placed[placed.length - 1]!.x + placed[placed.length - 1]!.adv : indent;
  if (!spaces || end >= wrapEm) return end;
  const extra = (wrapEm - end) / spaces;
  let shift = 0;
  for (let i = from; i < placed.length; i++) {
    const g = placed[i]!;
    placed[i] = { ...g, x: g.x + shift };
    if (g.cp === 32) shift += extra;
  }
  return wrapEm;
}
