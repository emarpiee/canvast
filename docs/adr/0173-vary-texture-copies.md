# ADR 0173: varied copies of a repeated texture

- Status: accepted (v0.41.0, 2026-10-25)
- Extends: ADR 0154 (texture fills)

## Context

A repeated texture (objects of the canvas, or a picture set to Tile) put the same copy in every cell, so a fill of shapes looked like wallpaper. Owners wanted each copy turned, sized and placed on its own, while the plain fill stays as it is.

## Decision

A texture may carry `vary` (`doc/texture.ts`): turn ± degrees (optionally in whole steps), size ± share, place ± share of the cell, leave out a share of the cells, mirror some, the order of the objects (in turn or shuffled), copies of each object or of the arrangement, and a seed. Absent, or nothing varied (`isVaried`), the texture is drawn exactly as before.

- **Per cell, not per draw.** A copy's values are a hash of the seed, its cell and its slot in the cell (`copyAt`), so a copy is the same at every zoom, after a reload and in an export, and a change to a source changes how the copies look, never where they are. The values repeat after a block of cells: at least 16, a whole number of turns of the objects (`varyPeriod`, at most 31; more than 16 objects: 16).
- **Each object** gets a square cell of its own and is fitted in it. **The arrangement** keeps the cell of the objects as they lie together, as without Vary.
- **Drawing** (`render/texture.ts`): the block of varied cells is drawn once (cached) and repeated as the pattern, with the cells past its edges drawn too so copies that cross them join up. When a copy is shown larger than the block can hold sharply (the block would pass 4096 px), the copies in view are drawn one by one into a canvas of the view, the same copies at their full size; past 6,000 copies the block is used anyway.
- **Shown large** (v0.41.3): a copy shown more than 1.5 times larger than its tile picture is drawn again from its objects (`objectsPart` of the texture host: the visible share of the objects' box, exact, drawn by Export's code), the part in view only. A plain objects fill whose tile is shown larger than its picture goes the same way with nothing varied. The placement is multiplied out in doubles (`Affine`): DOMMatrix lost the offsets near 10^11 px of a copy a billion times enlarged.
- **Export:** SVG writes each piece (each object, or the arrangement) once as vectors and a `<use>` of it for each copy in the shape, with the copy's own move, turn, size and mirror (v0.41.1); past 2,500 copies, or when a source is not all shapes, the block is written as a picture tile. Picture exports draw as the canvas does.

## Consequences

The pattern repeats after a block of 16 to 31 cells. Far inside one copy (past where the texture is drawn), the colour is the copy on top at that point (`variedColourAt`, v0.41.2). Far out, the block is drawn while it is at least 2 px, so the shape stays a pattern after a single copy is too small to see.
