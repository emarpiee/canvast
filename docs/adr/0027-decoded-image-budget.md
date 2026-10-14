# ADR 0027 — Decoded images are a cache with a budget

- Status: accepted (Phase 3, slice 1)
- Related: ADR 0007 (asset library), ADR 0009 (tile cache), engineering plan §14.16 (memory and resource ownership: budgets, eviction, disposal, leak detection) and Phase 3

## Context

Phase 3 asks for resource ownership with budgets and eviction, and for bounded memory when media is placed, removed or a canvas is left. Until now nothing was ever released: `AssetLibrary` kept the decoded pixels of every image that had been drawn for the life of the page. A decoded image costs far more than its file (a 1920x1080 PNG of 1 MB is 8 MB decoded), so a library of a few hundred images drawn once would keep gigabytes alive.

## Decision

Decoded images are a **cache**; the original stays stored and is decoded again when a frame needs it.

- **Budget:** `DEFAULT_DECODED_BUDGET` = 384 MiB of decoded pixels (RGBA, 4 bytes a pixel), settable (`setBudget`).
- **Eviction:** over the budget, the least recently used decoded images are released (`ImageBitmap.close()` frees them at once) until the rest fits. An image a frame asked for in the last 1.5 s is in use and is never released, so what is on screen is never evicted, even if the visible images alone exceed the budget (the budget is soft in that one case).
- **When:** after every decode, on a frame request at most every 500 ms, and on a 2 s timer, so memory goes down while nothing is drawn (looking at an empty region, another canvas, or the Assets view).
- **Dropping:** a released image is simply absent; the next frame that wants it starts the usual asynchronous decode (the placeholder shows meanwhile), exactly like the first time.
- **Visibility:** `decodedStats()` (count, bytes, budget) and `setDecodedBudget()` in the debug hook; the numbers belong in the diagnostics panel of Phase 3.

## Other caches, for the record

- The raster tile cache holds only the tiles around the viewport and releases the rest (ADR 0009).
- Assets-view thumbnails are in-memory object URLs made from the original and revoked when an asset is deleted; persisted thumbnails and a virtualized grid are planned (`docs/plans/asset-thumbnails.md`).
- The density layer and the text raster fall-backs are single canvases sized to the view.

## Not in this slice

A CPU-side budget for the document (1M objects use about 940 MB of heap, see `docs/testing/phase-0c.md`), a GPU texture budget (there is no GPU backend), and the other device tiers of the adaptive-quality work.
