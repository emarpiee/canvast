/**
 * Theme-aware default ink (ADR 0052). Strokes and text store a colour; the default pen colour is a near-black that cannot be seen on
 * a dark canvas. The stored value never changes: the colour is only mapped when it is drawn (or shown as a swatch), so a drawing made
 * in one theme reads in the other, and archives keep the original colour. A picture export draws with the same mapping, so the SVG and PDF
 * writers use `exportColor` (the mapped colour as "#rrggbb"): what a file shows is what the canvas showed.
 */
export const DEFAULT_INK = "#1f2329";

let ink: string | null = null;

/** The colour to draw the default ink with now (null: draw it as it is stored). */
export function setThemeInk(color: string | null): void {
  ink = color && color.toLowerCase() !== DEFAULT_INK ? color : null;
  inkHex = null;
}

let inkHex: string | null = null;
const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** The theme's ink as "#rrggbb": read from "#rrggbb" or "rgb(r, g, b)" as it is, else (a CSS colour such as oklch()) by drawing it on a one-pixel canvas. */
function inkAsHex(c: string): string | null {
  const h = /^#([0-9a-f]{6})$/i.exec(c);
  if (h) return `#${h[1]!.toLowerCase()}`;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  if (m) return `#${hex2(+m[1]!)}${hex2(+m[2]!)}${hex2(+m[3]!)}`;
  if (typeof document === "undefined") return null;
  const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.canvas.width = g.canvas.height = 1;
  g.fillStyle = c;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return `#${hex2(d[0]!)}${hex2(d[1]!)}${hex2(d[2]!)}`;
}

/** A stored colour as a file (SVG, PDF) should write it: the default ink as the canvas draws it now ("#rrggbb"), any other colour as it is. */
export function exportColor(stored: string): string {
  if (ink === null || stored.toLowerCase() !== DEFAULT_INK) return stored;
  return (inkHex ??= inkAsHex(ink) ?? stored);
}

/** A stored colour as it is drawn in the current theme. */
export function paintColor(stored: string): string {
  return ink !== null && stored.toLowerCase() === DEFAULT_INK ? ink : stored;
}

/** A CSS background for a swatch of a stored colour: the default ink follows the theme (a CSS variable), others show as they are. */
export function swatchBackground(stored: string): string {
  return stored.toLowerCase() === DEFAULT_INK ? "var(--canvas-ink)" : stored;
}
