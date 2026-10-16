# ADR 0052 — The visual system: oklch with a hue dial, a tool rail and a calmer top

- Status: accepted (Phase 7 follow-up, owner request of 2026-10-16: "oklch as the primary colour system", "cluttered", "no way of changing the hue")
- Related: ADR 0048 (Settings view), 0050 (appearance), 0051 (selection bar)

## Decision

**Colour.** Every colour of the interface is `oklch()` (`src/styles.css`): the chrome, the canvas background, grid, axis, selection, lasso, handles, the eraser and snap overlays, the generated media cards. Two dials sit on the root: `--hue` (0 to 360) and `--vivid` (0 to 1.5). Every tinted token is `oklch(L calc(C * var(--vivid)) var(--hue))` with **L fixed in the token**, so turning either dial changes the colour and never the brightness. Measured over all 360 hues (every 5 degrees) with sRGB clipping: accent text on the accent fill at least 4.7:1 at 150 % colourfulness (5.2:1 at 100 %), body text 13 to 15:1, muted text at least 5.8:1 in light and 6.4:1 in dark. Semantic colours (danger, favourites star) keep their own hue; the origin axis and snap guides are placed relative to the dial.
- **Settings > Appearance:** Theme colour (a hue slider whose track is a rainbow at the accent's lightness, applied while dragging, with five pigment presets: Viridian 178, Ultramarine 265, Violet 310, Madder 15, Ochre 80) and Colourfulness. The canvas colours are re-read and the tile cache cleared when either changes. `readTheme` resolves each token through a probe element so the canvas receives a plain colour, never `var()` or `calc()`.
- **Exceptions, stated:** stored document colours stay hex (the pen palette, and the default ink `#1f2329`, are user data validated as `#rrggbb`; archives and storage keep them). The default ink is drawn as the theme's ink on a dark canvas (`render/ink.ts`) without changing what is stored, which fixes strokes that were invisible on the dark canvas. Pixels of images are untouched.

**Layout, less clutter.**
- **Tool rail** (left, vertical): the six tools. **Dock** (top right): undo, redo, layers, bookmarks, import. **Options bar** (top, between the view tabs and the dock): only the options of the active tool, and gone when the tool has none.
- The bar no longer repeats what the selection bar (ADR 0051) does: Group, Ungroup, Bring to front, Send to back, Hide, Lock and Delete are there only. The bar keeps Arrange, Show all hidden, Unlock all and the three selection switches.
- Side panels start below the options bar (`--bar-bottom`, measured), so they never cover it.
- Sentence-case labels only; no all-caps headings; no middle-dot strings ("Used 2 times on 1 canvas").

## Not built

Per-element colour overrides, user-defined palettes, a separate hue for the dark theme, and a light-table (white or grey surround) canvas mode.
