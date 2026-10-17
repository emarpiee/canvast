/**
 * The fonts a text can be set in (ADR 0127): the bundled one, and any TrueType font file the person imported (a library asset, named by
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

export function fontFor(ref?: string): Font {
  const e = ref ? loaded.get(ref) : undefined;
  if (e) return e.font;
  if (!bundled) throw new Error("text font not loaded");
  return bundled;
}

/** The CSS family to draw or edit a text with (the bundled one while its own font is not usable). */
export function familyFor(ref?: string): string {
  const e = ref ? loaded.get(ref) : undefined;
  return e?.face ? e.family : BUNDLED_FAMILY;
}

/** Whether a canvas can draw a text set in this font with `fillText` (else from the outlines). */
export const faceReady = (ref?: string): boolean => !ref || loaded.get(ref)?.face === true;
