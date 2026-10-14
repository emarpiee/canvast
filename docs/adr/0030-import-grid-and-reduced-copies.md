# ADR 0030 — Batch import grid and reduced copies of big images

- Status: accepted (Phase 3, slice 5; owner feedback after importing 300 HD images)
- Related: ADR 0027 (decoded-image budget), ADR 0007 (asset library), engineering plan §14.14 (operations) and §14.16 (memory)

## Context

Importing 300 HD images showed two problems. They were placed on a diagonal, 24 px apart, 60% of the view each, a stack nobody can use. And the app lagged: every image on screen was drawn from its full decode (8 MB each), 300 of them together are 2.4 GB, far beyond the decoded-image budget (images in use are never released), and every one was a separate undoable transaction and a separate save.

## Decision

**Batch import layout.** One image is placed in the middle as before. Several are laid out by `gridLayout` (`app/actions.ts`): cells as large as the largest image, `cols = round(sqrt(n x cellH / cellW))` so the whole grid is about as wide as it is tall (300 HD images: 13 columns by 24 rows), reading order left to right then down in the order the files were given, each image centred in its cell, and the whole grid scaled down (never up) to 90% of the view. Importing is two steps: every file is imported (hashed, decoded, stored, with an "Importing x of n" message for four or more files), then all are placed in one transaction: one undo step, one save.

**Reduced copies.** An image whose longer side is above 512 source pixels, shown at 256 CSS px or less on its longer side, is drawn from a reduced copy decoded straight from the stored bytes at 512 px (`createImageBitmap` with a resize size: the full image is never held): about 0.6 MB instead of 8 MB for a 1920x1080 image, and drawing it is faster. While the copy that is wanted is not ready, the other one is used as a stopgap and the tile that showed it is redrawn when it arrives (`wantedReady`). A browser that cannot decode at a size falls back to the full image for that original. The Assets view's thumbnails are decoded at thumbnail size in the same way.

Reduced copies count in the decoded-image budget and are released with it (ADR 0027); everything else, including every deep-zoom path, still draws from the full image.

## Not in this slice

A stored (persisted) thumbnail, a virtualized Assets grid and progressive tile loading (Phase 4, `docs/plans/asset-thumbnails.md`), and arranging an existing selection in a grid with a chosen order (`docs/plans/arrange-commands.md`, Phase 5; it reuses `gridLayout`).
