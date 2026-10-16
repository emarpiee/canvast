# ADR 0068: One "more actions" menu and design tokens

## Status
Accepted (v0.17.0)

## Context
Rows in Layers, Bookmarks, the navigator and the sidebar each had their own menu look, keys and text size. Colours, sizes, spacing and radii were literals scattered through `styles.css`.

## Decision
- `src/ui/more-menu.ts` is the only way to open a row's actions: a `⋯` button (`moreButton`), a `.pop-menu` (`openMoreMenu`, `placeMenu`), Up/Down/Home/End/Esc (`installMenuKeys`). The navigator and sidebar menus share the same CSS.
- Layers has no per-row menu: Rename, Hide and Lock sit in the selection settings and act on the whole selection. Hidden or locked rows show a state button.
- `:root` holds tokens for text size and weight, spacing, icon size, radius, colours and media colours. Menus and panels use `--font-control`, so their text matches.
- `scripts/check-tokens.mjs` (`npm run check:tokens`, part of `npm test`) fails on a new colour, text size, radius or spacing literal in CSS, and on inline `style=""` in `src/ui/*.ts`. `scripts/token-baseline.json` is all zeros.

## Consequences
Off-scale values were snapped to the nearest token (1–2 px changes). Widths, heights and z-index are not checked yet.
