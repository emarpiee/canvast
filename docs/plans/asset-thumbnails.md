# Plan: persisted WebP thumbnails, slide view, and recognisable broken assets

Status: planned (owner request, 2026-10-14). Not started. Extends ADR 0007, which deferred persisted thumbnails.

## Why

Today every card in the Assets view decodes the full original (51 PNG frames of 1-3 MB in the owner's library), and a thumbnail exists only in memory for the session. If an original is missing or corrupt, there is nothing to show, so the user cannot tell which item broke.

## What the engineering plan already says, and what it does not

The engineering plan (§Assets View, "Grid and preview") asks for thumbnails and previews, a "quick preview/lightbox", and missing-asset detection and recovery. It does **not** say that thumbnails are stored, that the grid never touches the original, or that a broken asset keeps a recognisable thumbnail. This note adds those three requirements.

## Requirements

1. **Persisted lower-quality WebP thumbnail per asset.** Made once at import, from the decode that import already does. Lossy WebP (quality about 0.6), longest edge at most 512 px, never upscaled (a smaller image keeps its size). Fallback to JPEG where the browser cannot encode WebP. Stored in IndexedDB next to the asset record, keyed by content hash, so it survives reloads and is shared by every instance.
2. **The grid and the detail panel use only the thumbnail.** The original is never decoded to draw a card. This is the fast path for libraries of large PNGs.
3. **Slide view (lightbox) loads the original.** Clicking the preview in the detail panel (the image the arrow points to in the owner's screenshot) opens a full-window slide view of the original, with next and previous through the current list, and Esc to close. The original decodes only there (and on the canvas).
4. **Broken assets stay recognisable.** If the original is missing, corrupt or fails to decode, the card still shows its thumbnail with a clear "original missing or damaged" mark, name and size from the catalog. Place and Show are disabled; the detail panel says what is wrong and offers re-import (same bytes, same hash, restores it). The slide view shows the thumbnail with the same message instead of failing silently.
5. **Thumbnails are derived data.** Never the source of truth: never hashed, never counted as the original, removed with the asset by garbage collection, regenerated from the original when missing. Included in `.canvast` archives and backups (a few KB each) so a damaged original still has a face after a restore; archive import does not trust them (a bad thumbnail is regenerated or ignored).
6. **Detection.** A failed decode or a missing or hash-mismatched blob marks the asset broken in the catalog (state only; the original is never deleted by this).

## Out of scope for the first slice

Video and audio posters, SVG, animated frame choice (GIF uses its first frame), a virtualized grid, and perceptual hashing.

## Tests (keep it small)

One E2E: import an image, check a WebP thumbnail record exists and is smaller than the original, and that drawing the grid does not decode the original. One E2E: remove the original's bytes (`removeAssetBytes`), then the card shows the thumbnail with the broken mark, and Place is disabled. Extend the existing assets specs rather than adding a new file.
