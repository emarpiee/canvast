import type { Font } from "./font";
import type { BlockType } from "./markdown";
import { parse } from "./markdown";

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
}

export interface Line {
  readonly top: number;
  readonly bottom: number;
  readonly baseline: number;
  /** Font size of this line in em of the body size (headings are larger). */
  readonly scale: number;
  readonly glyphs: readonly PlacedGlyph[];
}

export interface TextLayout {
  readonly lines: readonly Line[];
  readonly width: number;
  readonly height: number;
}

export const LINE_HEIGHT = 1.3;
export const BLOCK_GAP = 0.6;
export const ITEM_GAP = 0.2;
export const LIST_INDENT = 1.5;
export const BLOCK_SCALE: Record<BlockType, number> = { p: 1, h1: 2, h2: 1.5, h3: 1.25, ul: 1, ol: 1 };

let font: Font | null = null;
/** Advance in em of a character the bundled font lacks. */
let fallbackAdvance: (cp: number) => number = () => 0.6;
const cache = new Map<string, TextLayout>();
const CACHE_MAX = 256;

export function setFont(f: Font): void {
  font = f;
  cache.clear();
}

export function setFallbackMeasure(fn: (cp: number) => number): void {
  fallbackAdvance = fn;
  cache.clear();
}

export function textFont(): Font {
  if (!font) throw new Error("text font not loaded");
  return font;
}

export function layoutText(md: string, wrapEm: number): TextLayout {
  const key = `${wrapEm}|${md}`;
  let l = cache.get(key);
  if (!l) {
    if (cache.size >= CACHE_MAX) cache.clear();
    l = compute(md, wrapEm);
    cache.set(key, l);
  }
  return l;
}

interface Ch {
  cp: number;
  bold: boolean;
  italic: boolean;
}

function compute(md: string, wrapEm: number): TextLayout {
  const f = textFont();
  const upm = f.unitsPerEm;
  const advance = (cp: number): { gid: number; adv: number } => {
    const gid = f.glyphId(cp);
    return { gid, adv: gid ? f.glyph(gid).advance / upm : fallbackAdvance(cp) };
  };
  const lines: Line[] = [];
  let width = wrapEm;
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
    for (const sp of b.spans) for (const c of sp.text) chars.push({ cp: c.codePointAt(0)!, bold: sp.bold || sp.ref !== undefined, italic: sp.italic || sp.ref !== undefined });
    let line: Array<Ch & { gid: number; adv: number }> = [];
    let first = true;
    const emit = (glyphs: typeof line): void => {
      const lh = LINE_HEIGHT * s;
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
        placed.push({ cp: g.cp, gid: g.gid, x, adv: g.adv * s, bold: g.bold, italic: g.italic });
        x += g.adv * s;
      }
      width = Math.max(width, x);
      const content = ((f.ascender - f.descender) / upm) * s;
      lines.push({ top: y, bottom: y + lh, baseline: y + (lh - content) / 2 + (f.ascender / upm) * s, scale: s, glyphs: placed });
      y += lh;
      first = false;
    };
    let x = 0;
    let lastSpace = -1;
    for (const c of chars) {
      if (c.cp < 32) continue;
      const a = advance(c.cp);
      const adv = a.adv * s;
      if (c.cp !== 32 && x + adv > avail && line.some((g) => g.cp !== 32)) {
        const carry = lastSpace >= 0 ? line.slice(lastSpace + 1) : [];
        emit(lastSpace >= 0 ? line.slice(0, lastSpace) : line);
        line = carry;
        x = carry.reduce((t, g) => t + g.adv * s, 0);
        lastSpace = -1;
      }
      if (c.cp === 32) lastSpace = line.length;
      line.push({ ...c, ...a });
      x += adv;
    }
    emit(line);
    const next = blocks[bi + 1];
    if (next) y += list && next.type === b.type ? ITEM_GAP : BLOCK_GAP;
  });
  return { lines, width, height: Math.max(y, LINE_HEIGHT) };
}
