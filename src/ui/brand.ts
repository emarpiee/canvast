/**
 * The canvast logo in the app: the one-colour mark (a canvas open on its right side, and the dot you zoom into) in `currentColor`, so CSS gives
 * it a theme token and it follows light, dark and the theme colour. Only the favicon in index.html is the full-colour logo (its small-size
 * master). The guidelines and the logo files are made by scripts/brand/ (pages.mjs holds the same geometry; keep the two in step).
 */
const GLYPH = "M52 12H24A12 12 0 0 0 12 24V40A12 12 0 0 0 24 52H52V42H24A2 2 0 0 1 22 40V24A2 2 0 0 1 24 22H52Z";

/** The mark as inline SVG, cut to the glyph (the 40 units of the 64-unit grid it fills) and sized by CSS. Decorative: the name is always beside it. */
export function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="12 12 40 40" aria-hidden="true" focusable="false" fill="currentColor"><path d="${GLYPH}"/><rect x="37" y="27" width="10" height="10" rx="2.5"/></svg>`;
}
