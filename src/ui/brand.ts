/**
 * The canvast logo in the app: the one-colour mark (a canvas half the size of the tile, with the dot at its centre cut out) in `currentColor`, so CSS gives
 * it a theme token and it follows light, dark and the theme colour. Only the favicon in index.html is the full-colour logo (the same
 * drawing). The guidelines and the logo files are made by scripts/brand/ (pages.mjs holds the same geometry; keep the two in step).
 */
const GLYPH = "M24 16H40A8 8 0 0 1 48 24V40A8 8 0 0 1 40 48H24A8 8 0 0 1 16 40V24A8 8 0 0 1 24 16ZM30 28H34A2 2 0 0 1 36 30V34A2 2 0 0 1 34 36H30A2 2 0 0 1 28 34V30A2 2 0 0 1 30 28Z";

/** The mark as inline SVG, cut to the glyph (the 32 units of the 64-unit grid it fills) and sized by CSS. Decorative: the name is always beside it. */
export function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="16 16 32 32" aria-hidden="true" focusable="false" fill="currentColor"><path d="${GLYPH}" fill-rule="evenodd"/></svg>`;
}
