/**
 * Theme-aware default ink (ADR 0052). Strokes and text store a colour; the default pen colour is a near-black that cannot be seen on
 * a dark canvas. The stored value never changes: the colour is only mapped when it is drawn (or shown as a swatch), so a drawing made
 * in one theme reads in the other, and exports and archives keep the original colour.
 */
export const DEFAULT_INK = "#1f2329";

let ink: string | null = null;

/** The colour to draw the default ink with now (null: draw it as it is stored). */
export function setThemeInk(color: string | null): void {
  ink = color && color.toLowerCase() !== DEFAULT_INK ? color : null;
}

/** A stored colour as it is drawn in the current theme. */
export function paintColor(stored: string): string {
  return ink !== null && stored.toLowerCase() === DEFAULT_INK ? ink : stored;
}

/** A CSS background for a swatch of a stored colour: the default ink follows the theme (a CSS variable), others show as they are. */
export function swatchBackground(stored: string): string {
  return stored.toLowerCase() === DEFAULT_INK ? "var(--canvas-ink)" : stored;
}
