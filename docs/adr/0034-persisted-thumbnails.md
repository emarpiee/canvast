# ADR 0034 — Persisted lower-quality thumbnails

- Status: accepted (Phase 4, slice 2)
- Related: ADR 0007 (asset catalog; it deferred persisted thumbnails), `docs/plans/asset-thumbnails.md`

## Decision

Each asset gets one **lossy WebP thumbnail** (quality 0.6, longest edge at most 256 px, never enlarged; JPEG where the browser cannot encode WebP), stored in the new IndexedDB store `thumbs` (key: content hash, schema version 6) as `{ hash, blob, w, h }`.

- It is made the first time the Assets view needs it (from the original, decoded straight at thumbnail size) and stored; every later view, and every other tab, reads the stored one and never touches the original.
- It is **derived data**: never hashed, never counted as the original, written only for an asset that is in the catalog (so a thumbnail never outlives a swept asset), erased with the asset by garbage collection, regenerated when missing. Any tab may write it (it is idempotent), and a failed write only means it is made again.
- A card whose original is missing or lost keeps its thumbnail with an "Original missing" mark over its bottom edge; Place stays unavailable and the inspector explains it, as before. An asset that was never viewed has no thumbnail, so such a card shows only the mark.

## Not done in this slice (plan requirements still open)

Generating the thumbnail at import time (it is made on first view, so a library imported but never opened has none), the slide view of the original, thumbnails inside `.canvast` archives, regenerating a bad stored thumbnail, and a virtualized grid. These stay in `docs/plans/asset-thumbnails.md`.
