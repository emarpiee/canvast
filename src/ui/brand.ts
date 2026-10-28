/**
 * The canvast logo in the app: the one-colour mark (a frame, a window cut from it a little low and right, and the dot in the window) in `currentColor`, so CSS gives
 * it a theme token and it follows light, dark and the theme colour. Only the favicon in index.html is the full-colour logo (the same
 * drawing). The guidelines and the logo files are made by scripts/brand/ (pages.mjs holds the same geometry; keep the two in step).
 */
const GLYPH = "M24.2 14.667H39.801A9.533 9.533 0 0 1 49.334 24.2V39.801A9.533 9.533 0 0 1 39.801 49.334H24.2A9.533 9.533 0 0 1 14.667 39.801V24.2A9.533 9.533 0 0 1 24.2 14.667ZM30.093 24.2H38.24A5.893 5.893 0 0 1 44.133 30.093V38.24A5.893 5.893 0 0 1 38.24 44.133H30.093A5.893 5.893 0 0 1 24.2 38.24V30.093A5.893 5.893 0 0 1 30.093 24.2Z";

/** The mark as inline SVG, cut to the frame (the 34.7 units of the 64-unit grid it fills) and sized by CSS. Decorative: the name is always beside it. */
export function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="14.667 14.667 34.667 34.667" aria-hidden="true" focusable="false" fill="currentColor"><path d="${GLYPH}" fill-rule="evenodd"/><rect x="30.7" y="30.7" width="6.933" height="6.933" rx="1.907"/></svg>`;
}
