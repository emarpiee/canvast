# ADR 0047 — Blend modes, layer and group names, relinking missing mentions, audio out of view

- Status: accepted (Phase 6, closes the gaps left by Phase 5 and ADR 0044)
- Related: ADR 0009 (tiles), 0020 (groups), 0024 (Layers panel), 0039–0040 (mentions; the relink part is superseded by ADR 0125), 0044 (background playback)

## Decisions

- **Blend mode** is an optional `blend` on every object (`multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`; absent = normal). It is applied in `paint()` (`render/draw-objects.ts`) together with opacity, so each object is still painted once. Blended strokes are never batched.
- **Tiles hold paint without its backdrop**, so a tile cannot blend. A view that shows any blended object is drawn directly, in exact paint order (`app/main.ts` keeps the set of blended ids and projects them against the viewport). Views without one keep the tile cache. Cost: such a view loses the tile speed-up in very dense scenes.
- **Names:** `name` on an object, and `groupNames` (group id → name) on every member of a group. Both are set from the Layers panel by double-clicking a row; an empty name goes back to the automatic label. Pasting renames the group ids together; ungrouping drops the name of the dissolved group. One undo step each.
- **Relink:** a text's *Missing item* row has a Relink button; a search over this canvas's items and the board's other canvases picks the new target, and the text's mentions of the missing id point at it (`relinkMention` in `text/markdown.ts`), one undo step.
- **Audio keeps playing out of view** (it has no picture to lose and no video decoder to hold), still counted in the limit of 4 playing at once. Video and GIF still stop when they leave the view.
- Mention picker and mention labels name an image by its file name.

## Not built

Blend modes on a group as a whole (each member has its own), blending of the density preview and of sub-pixel content, a per-view exact order when blended objects sit in a tile-cached dense scene (the view is drawn directly instead).
