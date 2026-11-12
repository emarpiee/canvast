# ADR 0188: Adjustment shapes

- Status: **accepted** (2026-11-12)
- Related: ADR 0118 and 0123 (the Adjust panel), ADR 0105 (shapes), ADR 0108 (sheets), ADR 0144 (masks), ADR 0033 (tiles)

## Decision

- A shape can be an **adjustment shape** (`PathObject.backdrop`): its adjustments are made on what is drawn under it, inside its outline, instead of on the shape itself. A circle with no fill and a blur of 100 over a picture blurs the part of the picture under it.
- **Any shape, but not a path**: only a shape made with a shape tool (rectangle, ellipse, polygon, star, speech balloon), never a line (it has no inside), a sheet, a network or a path (`canBeBackdrop`); the model refuses anything else (`validateObject`). Whatever turns a shape into a path (split into pieces, simplify, a balloon to a path, divide, a boolean result) drops it. Editing a shape's nodes keeps it: the shape remembers what it is.
- **What it reaches**: everything drawn before it on the same canvas (it is cut by a sheet that clips, as anything on it), objects only: the canvas's ground, grid and pattern are not adjusted. Its own fill and outline, if any, are drawn over the adjusted picture, plain. Its opacity is how much of the adjusted picture covers the plain one. Shadows are not made in this mode.
- **Drawing** (`render/adjust-shape.ts` `drawBackdrop`): at its turn, the pixels already drawn under its box, with room for the blur's reach, are taken from the canvas being drawn into (on the graphics card: never read back), put through the same filter as any adjustment (`drawAdjusted`), cut to the outline and put back. A tile under one is drawn with that much more room round it and its middle kept (`TileCache.buildTiles`), so a blur reads its real neighbours and has no seams; the view drawn directly draws the objects on a layer of their own first, so the grid stays plain. Far inside the shape (the view inside it) the whole view is adjusted.
- **Picking**: it is picked anywhere inside, filled or not. In Layers it is named *Adjustment ellipse* (…) with the aperture icon.
- **Turning it on**: the Adjust panel's **Adjust what is under it**, for a selection of such shapes only; one undo step.
- **Exports**: pictures and copies as a picture use the renderer. An SVG cannot read what lies behind: what is drawn before the shape is written again, through its filter, cut by its outline, marked `data-canvast-derived` so this app does not read it back as shapes; the shape itself is written plain. A vector PDF draws a page with adjustments as a picture, as before.

## Consequences

- A blur over a large, busy area costs a frame whenever what is under it changes; at rest the tiles keep it.
- Made into shapes again, an exported SVG gives the shapes under it (not the copy) and the adjustment shape as a plain path: a path cannot be an adjustment shape.
- Older versions ignore the flag: they draw the shape with its adjustments on itself.
