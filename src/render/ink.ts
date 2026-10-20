/**
 * The default ink (ADR 0052, changed in v0.25.3). The default pen and outline colour is a near-black that cannot be seen on a dark canvas. What
 * is stored is what is drawn and what is exported (the canvas, the picture, SVG and PDF files all use the stored colour as it is): nothing is
 * mapped by the theme when drawing. The default ink is chosen once, when an object is made: on a dark canvas a new object gets the canvas's
 * readable ink (a real colour, stored with it); on a light canvas it gets the near-black. A colour the person chose is always kept.
 */
export const DEFAULT_INK = "#1f2329";

let ink: string | null = null;

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** A CSS colour as "#rrggbb": read from "#rrggbb" or "rgb(r, g, b)" as it is, else (oklch() and the like) by drawing it on a one-pixel canvas. */
function asHex(c: string): string | null {
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

/** The readable ink of the canvas now (the theme's `--canvas-ink`); null when it is the near-black itself, or cannot be read. */
export function setCanvasInk(color: string | null): void {
  const hex = color ? asHex(color) : null;
  ink = hex && hex !== DEFAULT_INK ? hex : null;
}

/** The colour a NEW object gets for a tool colour: the default ink becomes the canvas's readable ink; any other colour is kept. */
export function newInk(chosen: string): string {
  return ink !== null && chosen.toLowerCase() === DEFAULT_INK ? ink : chosen;
}

/** A CSS background for a swatch of a stored colour: as it is. */
export const swatchBackground = (stored: string): string => stored;
