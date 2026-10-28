/**
 * The canvast logo in the app: the one-colour mark (a frame, a window half its size cut from its middle, and the dot half the window's size) in `currentColor`, so CSS gives
 * it a theme token and it follows light, dark and the theme colour. Only the favicon in index.html is the full-colour logo (its small-size
 * master). The guidelines and the logo files are made by scripts/brand/ (pages.mjs holds the same geometry; keep the two in step).
 */
const GLYPH = "M24 12H40A12 12 0 0 1 52 24V40A12 12 0 0 1 40 52H24A12 12 0 0 1 12 40V24A12 12 0 0 1 24 12ZM28 22H36A6 6 0 0 1 42 28V36A6 6 0 0 1 36 42H28A6 6 0 0 1 22 36V28A6 6 0 0 1 28 22Z";

/** The mark as inline SVG, cut to the glyph (the 40 units of the 64-unit grid it fills) and sized by CSS. Decorative: the name is always beside it. */
export function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="12 12 40 40" aria-hidden="true" focusable="false" fill="currentColor"><path d="${GLYPH}" fill-rule="evenodd"/><rect x="27" y="27" width="10" height="10" rx="3"/></svg>`;
}
