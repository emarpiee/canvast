# ADR 0034 — Persisted lower-quality thumbnails

- Status: accepted (Phase 4, slice 2)
- Related: ADR 0007 (asset catalog; it deferred persisted thumbnails), the thumbnails plan (removed 2026-10-29 once built)

## Decision

Each asset gets one **lossy WebP thumbnail** (quality 0.6, longest edge at most 256 px, never enlarged; JPEG where the browser cannot encode WebP), stored in the new IndexedDB store `thumbs` (key: content hash, schema version 6) as `{ hash, blob, w, h }`.

- It is made in the background right after a new original is imported (one at a time, so a batch import does not decode them all at once) and, for older assets that have none, the first time the Assets view needs it (from the original, decoded straight at thumbnail size); then stored; every later view, and every other tab, reads the stored one and never touches the original.
- It is **derived data**: never hashed, never counted as the original, written only for an asset that is in the catalog (so a thumbnail never outlives a swept asset), erased with the asset by garbage collection, regenerated when missing. Any tab may write it (it is idempotent), and a failed write only means it is made again.
- A card whose original is missing or lost keeps its thumbnail with an "Original missing" mark over its bottom edge; Place stays unavailable and the inspector explains it, as before. An asset with no thumbnail yet (imported before this version and never viewed) shows only the mark.

**Slide view.** Clicking the preview in the detail panel opens the original full window (Left and Right step through the current list, Esc or the backdrop closes). Its object URL is released on every change. A lost or undecodable original shows the thumbnail with "The original is missing or damaged; showing its thumbnail."

## Measured (2026-10-15, reference machine, a throwaway probe, not kept as a test)

A library of 1,000 images (600 x 400) imported through the Assets view: import to 1,000 cards 12.7 s (Chromium) and 11.2 s (Firefox), every thumbnail stored 1.2 s later. After a reload, opening the Assets view with all 1,000 cards: grid in place and first thumbnails shown in 184 ms (Chromium) and 227 ms (Firefox), no long task, 6,387 DOM nodes, only the visible cards' pictures loaded. A library of 300 images (1200 x 800) behaved the same (113 ms). So the grid does not need virtualizing at these sizes; revisit if libraries reach tens of thousands.

## Not done yet (plan requirements still open)

Thumbnails inside `.canvast` archives, regenerating a bad stored thumbnail, re-importing from the broken card's own button (importing the same file still restores it). These stay in the thumbnails plan (removed 2026-10-29 once built).
