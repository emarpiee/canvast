/**
 * The canvast logo: a canvas open on its right side (the canvas goes on) and the dot you zoom into, on an Ultramarine tile, on a 64-unit grid.
 * Its guidelines and the logo files are made by scripts/brand/ (pages.mjs holds the same geometry; keep the two in step). The favicon in
 * index.html is the small-size master, drawn on the 16 px grid for 32 px and under. The colours are the logo's own, not the theme's.
 */
const ULTRAMARINE = "#2A33D6", PAPER = "#F6F4EF", SPARK = "#FF7E45";
const GLYPH = "M52 12H24A12 12 0 0 0 12 24V40A12 12 0 0 0 24 52H52V42H24A2 2 0 0 1 22 40V24A2 2 0 0 1 24 22H52Z";
const GLYPH_SMALL = "M56 8H16A8 8 0 0 0 8 16V48A8 8 0 0 0 16 56H56V44H20V20H56Z";

/** The app icon as inline SVG, sized by CSS. Decorative: the name is always written beside it. */
export function logoSvg(small = false): string {
  const body = small
    ? `<rect width="64" height="64" rx="12" fill="${ULTRAMARINE}"/><path d="${GLYPH_SMALL}" fill="${PAPER}"/><rect x="36" y="24" width="16" height="16" rx="2" fill="${SPARK}"/>`
    : `<rect width="64" height="64" rx="14" fill="${ULTRAMARINE}"/><path d="${GLYPH}" fill="${PAPER}"/><rect x="37" y="27" width="10" height="10" rx="2.5" fill="${SPARK}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
}
