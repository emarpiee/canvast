/**
 * The fonts a text can be set in (ADR 0127, 0132): the bundled one, and any font file the person imported (TrueType, OpenType, WOFF, WOFF2) (a library asset, named by
 * its content hash). Layout, drawing, outlines and the editor ask here by the hash a text carries (`undefined` = the bundled font), so no
 * code has to know which font a text uses. A font not loaded (yet, or any more) is the bundled one: text is never left without letters.
 */
import type { Font } from "./font";

/** CSS family of the bundled font, and the family a canvas or the page uses for a character no font has. */
export const BUNDLED_FAMILY = "canvast-inter";
export const FALLBACK_FAMILY = "sans-serif";

interface Entry {
  readonly font: Font;
  readonly family: string;
  /** The browser accepted the font file too, so a canvas can draw with it (else letters are drawn from the outlines we read). */
  readonly face: boolean;
}

let bundled: Font | null = null;
const loaded = new Map<string, Entry>();
const listeners = new Set<() => void>();
const changed = (): void => {
  for (const fn of listeners) fn();
};

export function setBundledFont(f: Font): void {
  bundled = f;
  changed();
}

export function registerFont(hash: string, font: Font, family: string, face: boolean): void {
  loaded.set(hash, { font, family, face });
  changed();
}

/** Called whenever a font is installed or replaced (layouts and drawn text made before are out of date). */
export function onFontsChange(fn: () => void): void {
  listeners.add(fn);
}

export const hasFont = (hash: string): boolean => loaded.has(hash);

/** The values of the axes of a variable font a text is set at (axis tag → value in the axis's own units). */
export type Axes = Readonly<Record<string, number>>;

/** The font a text (or one letter of it) is set in, at the values of its axes when it has them. */
export function fontFor(ref?: string, axes?: Axes): Font {
  const e = ref ? loaded.get(ref) : undefined;
  const f = e?.font ?? bundled;
  if (!f) throw new Error("text font not loaded");
  return axes && f.axes.length ? f.instance(axes) : f;
}

/** The font of one placed letter of a text: its own face (a bold or italic file of the family) or the text's. */
export const glyphFont = (o: { assetId?: string | undefined; axes?: Axes | undefined }, g: { face?: string | undefined }): Font => fontFor(g.face ?? o.assetId, o.axes);

/** A font of a family looked up by what is wanted of it (see `variantOf`). */
export interface Variant {
  /** The font file to set the letters in (a library hash); the text's own when it already is the one. */
  readonly ref: string | undefined;
  /** The weight is not in the file: draw it bold by thickening the outline (and likewise slanting for italic). */
  readonly fakeBold: boolean;
  readonly fakeItalic: boolean;
}

const familyKey = (f: Font): string => f.names.family.trim().toLowerCase();

/**
 * Which file to set bold or italic words in: another file of the same family when the library has one (a real bold, a real italic),
 * else the text's own font with the bold made by thickening and the italic by slanting. A text set in a face that is already bold or
 * italic keeps it. The bundled font has no family in the library, so it is always made bold and slanted by the outline.
 */
export function variantOf(ref: string | undefined, bold: boolean, italic: boolean): Variant {
  const plain: Variant = { ref, fakeBold: bold, fakeItalic: italic };
  if ((!bold && !italic) || !ref) return plain;
  const base = loaded.get(ref);
  if (!base) return plain;
  const wantBold = bold && base.font.names.weight < 600;
  const wantItalic = italic && !base.font.names.italic;
  if (!wantBold && !wantItalic) return { ref, fakeBold: false, fakeItalic: false };
  const key = familyKey(base.font);
  let best: { hash: string; score: number } | null = null;
  for (const [hash, e] of loaded) {
    if (familyKey(e.font) !== key) continue;
    const n = e.font.names;
    if (wantItalic && !n.italic) continue;
    if (!wantItalic && n.italic !== base.font.names.italic) continue;
    if (wantBold && n.weight < 600) continue;
    const score = Math.abs(n.weight - (wantBold ? 700 : base.font.names.weight));
    if (!best || score < best.score) best = { hash, score };
  }
  if (!best) return plain;
  const found = loaded.get(best.hash)!.font.names;
  return { ref: best.hash === ref ? ref : best.hash, fakeBold: bold && found.weight < 600, fakeItalic: italic && !found.italic };
}

/** The weight and slant of a font as its file says them (for the editor, which asks the browser for the same face). */
export function faceStyleOf(ref?: string): { weight: number; italic: boolean } {
  const e = ref ? loaded.get(ref) : undefined;
  return e ? { weight: e.font.names.weight, italic: e.font.names.italic } : { weight: 400, italic: false };
}

/** The CSS family to draw or edit a text with (the bundled one while its own font is not usable). */
export function familyFor(ref?: string): string {
  const e = ref ? loaded.get(ref) : undefined;
  return e?.face ? e.family : BUNDLED_FAMILY;
}

/** What the bundled font is called in the font lists. */
export const BUNDLED_FONT_NAME = "Inter (built in)";

/** The font a CSS family name stands for: the regular file of that family (the editor reads the families of the words back as fonts). */
export function hashOfFamily(css: string): string | undefined {
  let best: { hash: string; score: number } | undefined;
  for (const [hash, e] of loaded) {
    if (e.family !== css) continue;
    const score = Math.abs(e.font.names.weight - 400) + (e.font.names.italic ? 1000 : 0);
    if (!best || score < best.score) best = { hash, score };
  }
  return best?.hash;
}

/** Whether a canvas can draw a text set in this font with `fillText` (else from the outlines). */
export const faceReady = (ref?: string): boolean => !ref || loaded.get(ref)?.face === true;
