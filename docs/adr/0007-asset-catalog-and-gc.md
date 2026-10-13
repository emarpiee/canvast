# ADR 0007 — Asset catalog, Assets view, reference-checked garbage collection, safe deletion

- Status: accepted (Phase 1, slice 2)
- Date: 2026-10-13
- Builds on [ADR 0006](0006-workspace-storage.md), which deferred all of this

## Context

After slice 1, `assets` was a plain hash → bytes store. Nothing listed it,
nothing counted how often an original was used, and nothing ever deleted
one. That was safe, but storage only grew, and boards and canvases could not
be deleted because doing so needed a rule for the originals their images
reference. The spec requires:

- a full Assets view beside Canvas view, sharing one authoritative catalog;
- usage tracking, and navigation from an asset to every instance;
- deletion that never removes an original something still needs, by
  reference reconciliation and deferred mark-and-sweep rather than a
  counter alone;
- missing originals shown as recoverable placeholders, not silently lost.

## Decision

### Three separate things

| Thing | Where | Contents |
| --- | --- | --- |
| Original | `assets[hash]` (unchanged) | the bytes, stored once, never modified |
| Catalog entry | `assetCatalog[hash]` (new, schema 3) | name, type, size, pixel size, imported time, `state` (`active` or `deleted`), `deletedAt`. No bytes, so listing the library reads no image data |
| Instance | image objects in `objects` | a canvas-specific placement that names the hash in `data.assetId` |

### Usage is derived, never counted

Schema 3 adds the index `objects.assetId` on `data.assetId`. Strokes have no
`assetId`, so the index holds image instances only.

- **Usage of one asset:** `index.count(hash)`.
- **Where it is used:** `index.getAllKeys(hash)`, which returns
  `[canvasId, id]` pairs.
- **The whole library:** one key cursor over the index, which reads keys
  only.

No stored counter can drift from the truth, because the truth is the set of
stored objects.

### Deleting from the library

1. An asset with any stored instance cannot be deleted. The button is
   disabled with the reason, and `markDeleted` re-checks the count inside its
   own transaction.
2. Deletion asks for confirmation, then sets `state = "deleted"`. It does
   not erase the bytes.
3. **Mark-and-sweep** (`AssetCatalog.collect(roots)`) runs in one readwrite
   transaction over `assetCatalog`, `assets` and `objects`, so no commit can
   land between the check and the erase. For each deleted entry:
   - a stored instance references it → **restored** to `active` (for
     example, after an undo re-placed it);
   - it is in `roots` → **retained**;
   - otherwise → the bytes and entry are **swept**.
4. **Roots** are what the writer tab can bring back without storage: the
   open document's objects plus every object state in its undo and redo
   history (`DocumentStore.retainedObjects`). Unsaved edits are covered
   because they live in the document; the writer also flushes before
   collecting.
5. **When it runs:**
   - right after a delete;
   - at startup (writer only, after `reconcile`);
   - after a canvas switch clears the history, while anything is retained;
   - after each verified commit, while anything is retained (so an undo
     restores the asset promptly).
6. **Only the writer collects.** Read-only tabs cannot edit, so they hold no
   roots of their own. A tab promoted to writer reloads its canvas, which
   clears its old history before it can edit.

Deleting instances, canvases or boards **never** erases an original. Only an
explicit library delete can, and only through the sweep above.

### Reconcile

At startup the writer runs `reconcile()`. It creates a catalog entry for
every stored original without one: schema-2 data, or an interrupted write.
It never deletes anything. New imports write the bytes and the entry in one
transaction, and re-importing existing bytes adds no copy; it only
reactivates the entry.

### Missing originals

- An instance whose original is absent keeps its id and position and is
  drawn as a placeholder.
- The Assets view lists a catalog entry without bytes as "Original missing".
  An instance hash with no entry at all appears in a separate missing list.
  Both show usage and the Show actions.
- Importing the same file again restores it everywhere, because identity is
  the content hash.

### Deleting canvases and boards

`WorkspaceRepo.deleteCanvas` and `deleteBoard` each work in one
transaction:

- remove the object records (a key-range delete), the saved views, the
  canvas records, and the parent's id-array entry;
- check every affected canvas revision first, so another writer's change
  aborts the delete;
- refuse to delete the board's last canvas, the workspace's last board, and
  the canvas recorded as current.

The session moves the open view to a neighbouring canvas before deleting, and
a confirmation dialog states what is deleted and that originals stay in the
library. Other tabs receive a `tree` message, and a reader viewing the
deleted canvas moves to an existing one. If `meta.current` ever names a
missing canvas, startup reopens the first canvas instead of creating a new
workspace.

### Assets view

- A top-level switch (Canvas | Assets, keyboard-usable tabs) sits before the
  breadcrumb.
- The canvas keeps its camera, selection and history while hidden. Its
  rendering is suspended, and canvas shortcuts are inactive in Assets view
  and inside dialogs.
- The view has:
  - search (name, type or hash prefix);
  - a usage filter;
  - sorting;
  - a thumbnail-size control;
  - a library-only import;
  - an inspector with metadata, usage and a "Where it is used" list, whose
    Show opens the canvas, selects the instances and frames them exactly at
    any depth;
  - Place on the open canvas;
  - Delete from library.
- Thumbnails are made lazily from the original, as in-memory object URLs,
  with pixelated scaling for sources smaller than the thumbnail.

The last view used is remembered per device (localStorage, best effort).

### Exact framing

Show uses `fitRect`, which takes the exact dyadic bounding box of the
instances. Its centre is computed exactly, and the zoom level comes from
`log2Abs` of the extent. That is exact in the exponent at any magnitude, so
an instance placed 1,600 or 5,000 levels in or out is framed like one at
level 0. The level is quantized downwards, so the box never exceeds the
requested fill.

## Consequences

- Storage can now shrink, and only through one audited path.
- The cost of listing the library is O(catalog entries + image instances),
  reading keys only. Thumbnails cost one decode per visible card, once per
  session.
- Board and canvas deletion cannot be undone. The confirmation says so.

## Deferred, with reasons

- **Tags, folders, collections, smart folders, ratings, and duplicate review
  by similarity.** These belong to the next asset slice and need the
  metadata schema settled first.
- **Persisted thumbnails and a virtualized grid** for very large libraries.
  Thumbnails are in memory only for now; the grid renders every card.
- **Trash for boards and canvases** (undoable deletion). Deletion is
  confirmed and permanent.
- **Roots from future sources:** pinned backups, export jobs, sync queues.
  None exist yet; `collect` takes roots as a parameter so they can be added.
- **Drag from Assets view onto a canvas.** Place on the open canvas is
  implemented.
