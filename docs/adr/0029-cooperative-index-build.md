# ADR 0029 — Cooperative index build for big documents

- Status: accepted (Phase 3, slice 3)
- Related: ADR 0004 (multi-scale spatial index), ADR 0014 (frames), ADR 0028 (adaptive quality), engineering plan §14.20 (cooperative scheduling, bounded batches) and §14.23 (workers)

## Context

Phase 3 lists worker scheduling. Before moving anything off the main thread the question is what actually blocks it. Measured in Chromium on the reference machine:

| Work | Main-thread cost |
| --- | --- |
| Loading and indexing 100,000 objects | about 0.9 s (including generating the scene) |
| Loading and indexing 1,000,000 objects | about 19 s |
| Importing twelve 4 MB images (hash, decode, store) | the longest single task 91 ms |

Hashing and decoding are already asynchronous in the browser (`crypto.subtle`, `createImageBitmap`), and they do not block for long. The one real stall is building the index of a big document when a canvas opens: one long synchronous loop of BigInt cell computations.

## Decision

Build it cooperatively, not in a worker.

- Past 20,000 objects, `syncIndex` clears the index and inserts the objects in slices of 8 ms (`fillCooperatively`), yielding to the event loop between slices (a `MessageChannel` message: no timer clamping). The page keeps drawing and taking input while it goes on.
- What is indexed so far is drawn; the rest appears as the build proceeds. The HUD message shows "Indexing N objects… x%" and is cleared at the end.
- A newer build (another canvas opened, a document replaced) stops the older one at its next slice. Edits made while it runs go through the normal incremental path, and inserting an object twice is harmless (an insert first removes).
- `syncIndex(...).ready()` resolves when the index is complete; the benchmark hook waits for it so measured loads and frames always see a full index.

## Why not a worker

The index holds the document's objects, which the main thread reads on every frame and every pointer move. A worker would need the whole document copied or shared and every query answered across a message boundary, to remove a cost that slices already remove. A worker earns its place for work that has no shared state and takes long: that is revisited when such work exists (video frame extraction, large exports; Phases 5 and 6).

## Not in this slice

A faster index build per object (a fast path for small anchors, recorded in Phase 0C) and memory per object (about 940 MB at 1M objects).
